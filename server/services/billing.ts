import "server-only";
import { cookies } from "next/headers";
import OpenAI from "openai";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger, users, type User } from "@/db/schema";

/**
 * Two ways to pay the storyteller:
 * - "byok": the player's own OpenAI key, kept on their device (cookie +
 *   localStorage). It rides each request over TLS, is used in memory, and is
 *   never logged or persisted server-side.
 * - "credits": the app's key, metered in ✨sparks — an append-only ledger
 *   with a cached balance, spent atomically before each AI task.
 */

export const BYOK_COOKIE = "wb_byok";

/** sparks per AI task — the one place pricing lives */
export const SPARK_COSTS = {
    forge: 25,        // creating a whole world (~4 flagship calls)
    narration: 1,     // arrivals, inspections, quest beats
    dialogue: 1,      // one character reply
    chapterTurn: 3,   // transition + next stage's quest plan
    victory: 0,       // victory prose is a reward, on the house
    speak: 1,         // one NPC line read aloud
    transcribe: 0,    // mic input — cheap, keep the mic frictionless
} as const;

export type SparkReason = keyof typeof SPARK_COSTS;

export const STARTER_SPARKS = 50;
export const LOW_SPARKS_THRESHOLD = 10;

export async function getByokKey(): Promise<string | null> {
    const jar = await cookies();
    return jar.get(BYOK_COOKIE)?.value || null;
}

/**
 * Gate an AI task. BYOK users must have their key present (we never fall back
 * to the app's key for them); credits users atomically spend sparks.
 */
export async function chargeForAi(userId: string, reason: SparkReason): Promise<void> {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new Error("Account not found.");

    if (user.billingMode === "byok") {
        if (!(await getByokKey())) {
            throw new Error("Your storyteller's key is missing on this device — add it again from the bookshelf.");
        }
        return;
    }

    if (user.billingMode !== "credits") {
        throw new Error("Choose how to power your storyteller first — visit the bookshelf.");
    }

    const cost = SPARK_COSTS[reason];
    if (cost === 0) return;

    const [updated] = await db.update(users)
        .set({ sparks: sql`${users.sparks} - ${cost}` })
        .where(and(eq(users.id, userId), gte(users.sparks, cost)))
        .returning({ sparks: users.sparks });
    if (!updated) {
        throw new Error("You're out of sparks ✨ — top up from the bookshelf to keep the story going.");
    }
    await db.insert(creditLedger).values({
        userId,
        delta: -cost,
        reason,
        balanceAfter: updated.sparks,
    });
}

/** grants (starter gift, future top-ups) — positive deltas only */
export async function grantSparks(userId: string, amount: number, reason: string): Promise<number> {
    const [updated] = await db.update(users)
        .set({ sparks: sql`${users.sparks} + ${amount}` })
        .where(eq(users.id, userId))
        .returning({ sparks: users.sparks });
    if (!updated) throw new Error("Account not found.");
    await db.insert(creditLedger).values({
        userId,
        delta: amount,
        reason,
        balanceAfter: updated.sparks,
    });
    return updated.sparks;
}

export async function setBillingMode(userId: string, mode: "byok" | "credits"): Promise<void> {
    await db.update(users).set({ billingMode: mode }).where(eq(users.id, userId));

    if (mode === "credits") {
        // the starter gift, exactly once per account
        const alreadyGranted = await db.query.creditLedger.findFirst({
            where: and(eq(creditLedger.userId, userId), eq(creditLedger.reason, "starter-gift")),
        });
        if (!alreadyGranted) await grantSparks(userId, STARTER_SPARKS, "starter-gift");
    }
}

/** a cheap, free API call proves the key works before we accept it */
export async function validateOpenAiKey(key: string): Promise<boolean> {
    try {
        const probe = new OpenAI({ apiKey: key });
        await probe.models.list();
        return true;
    } catch {
        return false;
    }
}

export type BillingStatus = {
    mode: "byok" | "credits" | null;
    sparks: number;
    low: boolean;
};

export function billingStatusOf(user: User): BillingStatus {
    return {
        mode: user.billingMode,
        sparks: user.sparks,
        low: user.billingMode === "credits" && user.sparks < LOW_SPARKS_THRESHOLD,
    };
}

export async function recentLedger(userId: string, limit = 20) {
    return db.query.creditLedger.findMany({
        where: eq(creditLedger.userId, userId),
        orderBy: [desc(creditLedger.createdAt)],
        limit,
    });
}
