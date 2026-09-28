import "server-only";
import { randomBytes, randomUUID } from "crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, creditLedger, topups, users, type Topup } from "@/db/schema";
import type { WalletView } from "@/game/payloads";
import { findPackage, parseMarkup, STARTER_GIFT_MICROS, walletViewOf } from "./walletRules";

export {
    canSpend, chargeFor, findPackage, LOW_BALANCE_MICROS, PACKAGES, STARTER_GIFT_MICROS, walletViewOf,
    type Package,
} from "./walletRules";

/*
 * The wallet: prepaid credit in micros (millionths of a US dollar).
 *
 * users.creditMicros is a cache of the ledger. It only ever changes inside a
 * transaction that also writes the credit_ledger row, and that row's
 * balanceAfterMicros is the value the same UPDATE … RETURNING produced — so
 * the ledger replays to the balance exactly, even under concurrent calls
 * (the UPDATE takes the user row's lock; each caller sees the one before).
 */

/** model calls are charged at provider cost × this; see walletRules.parseMarkup */
export const USAGE_MARKUP: number = parseMarkup(process.env.USAGE_MARKUP);

/** thrown by completeTopup for a topup that can never be completed — retrying will not help */
export class TopupError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** thrown inside a savepoint to undo a balance change whose ledger row already exists */
class AlreadyApplied extends Error {}

function assertWholeMicros(micros: number, what: string): void {
    if (!Number.isSafeInteger(micros) || micros < 0) {
        throw new Error(`${what} must be a whole, non-negative number of micros (got ${micros}).`);
    }
}

/**
 * Move a wallet by `delta` and write its ledger row, inside the caller's
 * transaction. Returns applied: false (and changes nothing) when a ledger row
 * with the same (reason, ref) already exists.
 *
 * Order: UPDATE the balance first, then INSERT the ledger row with
 * ON CONFLICT DO NOTHING, all inside a savepoint; if the insert hits the
 * (reason, ref) unique index the savepoint is rolled back, undoing the
 * UPDATE. This order was chosen over insert-then-fix because the ledger row
 * is written once, already carrying the balance the UPDATE returned — there
 * is never a row with a placeholder balance. Two concurrent identical calls:
 * the second one's UPDATE waits on the first's row lock; once the first
 * commits, the second's insert sees the committed ledger row, inserts
 * nothing, and its savepoint rolls back — credited once. (If the unique
 * index were hit before the row lock, Postgres likewise makes the second
 * insert wait for the first transaction to finish.)
 */
async function applyDelta(
    tx: Tx, userId: string, delta: number, reason: string, ref: string | null,
): Promise<{ applied: boolean; balanceMicros: number }> {
    try {
        return await tx.transaction(async (sp) => {
            const [updated] = await sp.update(users)
                .set({ creditMicros: sql`${users.creditMicros} + ${delta}` })
                .where(eq(users.id, userId))
                .returning({ creditMicros: users.creditMicros });
            if (!updated) throw new Error("Account not found.");

            const inserted = await sp.insert(creditLedger)
                .values({ userId, deltaMicros: delta, reason, ref, balanceAfterMicros: updated.creditMicros })
                .onConflictDoNothing()
                .returning({ id: creditLedger.id });
            if (inserted.length === 0) throw new AlreadyApplied();
            return { applied: true, balanceMicros: updated.creditMicros };
        });
    } catch (error) {
        if (!(error instanceof AlreadyApplied)) throw error;
        const [current] = await tx.select({ creditMicros: users.creditMicros }).from(users).where(eq(users.id, userId));
        return { applied: false, balanceMicros: current?.creditMicros ?? 0 };
    }
}

async function loadUser(userId: string) {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new Error("Account not found.");
    return user;
}

export async function getWallet(userId: string): Promise<WalletView> {
    return walletViewOf(await loadUser(userId));
}

/**
 * Switch how the storyteller is paid for. Choosing the wallet grants the
 * starter gift — its ref is the user id, so it can only ever land once per
 * account, however often they switch back and forth.
 */
export async function setBillingMode(userId: string, mode: "byok" | "credits"): Promise<WalletView> {
    const [updated] = await db.update(users).set({ billingMode: mode }).where(eq(users.id, userId)).returning({ id: users.id });
    if (!updated) throw new Error("Account not found.");
    if (mode === "credits") await grant(userId, STARTER_GIFT_MICROS, "starter-gift", userId);
    return getWallet(userId);
}

/** add credit; with a ref, idempotent — a second identical grant credits nothing */
export async function grant(
    userId: string, micros: number, reason: string, ref?: string,
): Promise<{ credited: boolean; balanceMicros: number }> {
    assertWholeMicros(micros, "A grant");
    if (micros === 0) throw new Error("A grant must be for more than nothing.");
    const result = await db.transaction((tx) => applyDelta(tx, userId, micros, reason, ref ?? null));
    return { credited: result.applied, balanceMicros: result.balanceMicros };
}

/**
 * Take payment for something already consumed. It never refuses — the model
 * has been paid for by the time this runs — so the balance may go below zero
 * (canSpend is what refuses, before a call). With a ref, charging the same
 * thing twice takes the money once. Returns the new balance.
 */
export async function charge(userId: string, micros: number, reason: string, ref?: string): Promise<number> {
    assertWholeMicros(micros, "A charge");
    if (micros === 0) {
        // nothing to record: a zero row would only clutter the player's activity list
        return (await loadUser(userId)).creditMicros;
    }
    const result = await db.transaction((tx) => applyDelta(tx, userId, -micros, reason, ref ?? null));
    return result.balanceMicros;
}

export async function recentActivity(userId: string, limit = 20) {
    return db.select({
        id: creditLedger.id,
        deltaMicros: creditLedger.deltaMicros,
        reason: creditLedger.reason,
        balanceAfterMicros: creditLedger.balanceAfterMicros,
        createdAt: creditLedger.createdAt,
    })
        .from(creditLedger)
        .where(eq(creditLedger.userId, userId))
        .orderBy(desc(creditLedger.createdAt))
        .limit(Math.max(1, Math.min(200, Math.floor(limit))));
}

/** what the storyteller has cost over the last `days`, and how much of the input the cache served */
export async function usageSummary(userId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since));
    // sums come back from Postgres as numeric strings; ::float8 keeps them numbers (exact well past any real total)
    const [totals] = await db.select({
        calls: sql<number>`count(*)::int`,
        costMicros: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::float8`,
        chargedMicros: sql<number>`coalesce(sum(${aiUsage.chargedMicros}), 0)::float8`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::float8`,
        cachedTokens: sql<number>`coalesce(sum(${aiUsage.cachedTokens}), 0)::float8`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::float8`,
    }).from(aiUsage).where(where);
    const byTask = await db.select({
        task: aiUsage.task,
        calls: sql<number>`count(*)::int`,
        chargedMicros: sql<number>`coalesce(sum(${aiUsage.chargedMicros}), 0)::float8`,
    }).from(aiUsage).where(where).groupBy(aiUsage.task).orderBy(sql`3 desc`);
    return {
        ...totals,
        cachedShare: totals.inputTokens > 0 ? totals.cachedTokens / totals.inputTokens : 0,
        byTask,
    };
}

/**
 * A pending purchase, recorded before the player is sent to pay. `price` is
 * what the card will be charged, which is the package's price in US cents
 * unless the merchant account takes another currency.
 */
export async function createTopup(
    userId: string, packageKey: string, providerKey: string, price?: { currency: string; minor: number },
): Promise<Topup> {
    const pkg = findPackage(packageKey);
    if (!pkg) throw new Error("That package does not exist.");
    const [row] = await db.insert(topups).values({
        userId,
        packageKey: pkg.key,
        paidCents: pkg.paidCents,
        creditMicros: pkg.creditMicros,
        provider: providerKey,
        transactionId: randomUUID(),
        chargedMinor: price?.minor ?? pkg.paidCents,
        chargedCurrency: price?.currency ?? "USD",
    }).returning();
    return row;
}

/**
 * How many times this player has set out to pay in the last hour and not
 * paid. Someone trying out stolen card numbers fails over and over; someone
 * who pays is not held back for having paid.
 */
export async function recentAttempts(userId: string): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(topups)
        .where(and(
            eq(topups.userId, userId),
            inArray(topups.status, ["pending", "failed"]),
            gte(topups.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
        ));
    return row?.n ?? 0;
}

/** how long the page that leads to the bank may wait to be opened */
const HANDOFF_MINUTES = 15;

/**
 * Keep the gateway's page with the top-up until the browser asks for it. It
 * is kept in the database and not in memory because the request that asks may
 * be answered by another server than the one that was given the page.
 */
export async function parkHandoff(topupId: string, html: string): Promise<string> {
    const key = randomBytes(24).toString("base64url");
    await db.update(topups).set({ handoff: html, handoffKey: key }).where(eq(topups.id, topupId));
    return key;
}

/** the page, once: whoever asks a second time, or too late, or without the key, gets nothing */
export async function takeHandoff(topupId: string, key: string, providerKey: string): Promise<string | null> {
    if (key.length < 16) return null;
    // one statement reads the page and clears it, so two requests at once cannot both be served
    const result = await db.execute<{ handoff: string | null }>(sql`
        update topups t set handoff = null, "handoffKey" = null
        from (
            select id, handoff from topups
            where id = ${topupId} and "handoffKey" = ${key} and provider = ${providerKey} and status = 'pending'
              and handoff is not null
              and "createdAt" > now() - ${`${HANDOFF_MINUTES} minutes`}::interval
            for update
        ) held
        where t.id = held.id
        returning held.handoff`);
    return result.rows[0]?.handoff ?? null;
}

/** a payment did not happen. Only a top-up still waiting can fail: one that has been paid stays paid */
export async function failTopup(topupId: string, message: string): Promise<void> {
    await db.update(topups)
        .set({ status: "failed", message: message.slice(0, 300), handoff: null, handoffKey: null })
        .where(and(eq(topups.id, topupId), eq(topups.status, "pending")));
}

/** the player's own top-up, to tell them what came of it */
export async function topupOf(userId: string, topupId: string): Promise<Topup | null> {
    const row = await db.query.topups.findFirst({ where: and(eq(topups.id, topupId), eq(topups.userId, userId)) });
    return row ?? null;
}

/**
 * The payment went through: mark the topup paid and credit it, in one
 * transaction. Safe to call again for the same payment (a repeated webhook):
 * the ledger's (reason "topup", ref topup id) row already exists, so nothing
 * more is credited and credited: false comes back.
 */
export async function completeTopup(input: {
    topupId: string; provider: string; providerRef: string;
    /** what the gateway said of the card: its brand and last four digits, never more */
    card?: { brand: string | null; last4: string | null; authCode: string | null };
}): Promise<{ credited: boolean; balanceMicros: number }> {
    return db.transaction(async (tx) => {
        // FOR UPDATE: two returns from the bank for the same payment queue here instead of racing
        const [topup] = await tx.select().from(topups).where(eq(topups.id, input.topupId)).for("update");
        if (!topup) throw new TopupError(`Topup ${input.topupId} does not exist.`);
        if (topup.provider !== input.provider) {
            throw new TopupError(`Topup ${input.topupId} belongs to provider "${topup.provider}", not "${input.provider}".`);
        }
        // "failed" may still be paid: it was marked so when a first answer could not be had, and the gateway has now said yes
        if (topup.status === "refunded") {
            throw new TopupError(`Topup ${input.topupId} is ${topup.status} and cannot be completed.`);
        }
        if (topup.status !== "paid") {
            await tx.update(topups)
                .set({
                    status: "paid", providerRef: topup.providerRef ?? input.providerRef, paidAt: new Date(),
                    message: null, handoff: null, handoffKey: null,
                    cardBrand: input.card?.brand?.slice(0, 40) ?? null,
                    cardLast4: input.card?.last4 ?? null,
                    authCode: input.card?.authCode?.slice(0, 40) ?? null,
                })
                .where(eq(topups.id, topup.id));
        }
        const result = await applyDelta(tx, topup.userId, topup.creditMicros, "topup", topup.id);
        return { credited: result.applied, balanceMicros: result.balanceMicros };
    });
}

/**
 * The payment has been given back by the gateway: the credit it bought leaves
 * the wallet, once. If some of it has been spent the balance goes below zero,
 * and the storyteller waits until it is made up — the player has their money.
 */
export async function markRefunded(topupId: string): Promise<{ reversed: boolean; balanceMicros: number }> {
    return db.transaction(async (tx) => {
        const [topup] = await tx.select().from(topups).where(eq(topups.id, topupId)).for("update");
        if (!topup) throw new TopupError(`Topup ${topupId} does not exist.`);
        if (topup.status !== "paid" && topup.status !== "refunded") {
            throw new TopupError(`Topup ${topupId} is ${topup.status}: there is nothing to give back.`);
        }
        if (topup.status === "paid") await tx.update(topups).set({ status: "refunded" }).where(eq(topups.id, topup.id));
        const result = await applyDelta(tx, topup.userId, -topup.creditMicros, "refund", topup.id);
        return { reversed: result.applied, balanceMicros: result.balanceMicros };
    });
}
