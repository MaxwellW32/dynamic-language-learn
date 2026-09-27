/**
 * End-to-end check of the wallet and the model door against the real
 * database — on the seeded TEST accounts only. Makes a handful of tiny real
 * model calls (a few tenths of a cent in all) and leaves the test player
 * reseeded at $5.
 *
 *   npx tsx --conditions=react-server scripts/checkWallet.ts
 */
import dotenv from "dotenv";
import { execFileSync } from "child_process";
import path from "path";
import { z } from "zod";

dotenv.config({ path: ".env.local", quiet: true });

let failures = 0;

function check(ok: boolean, label: string): void {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
}

function reseed(): void {
    // the same seed `npm run test:seed` runs; it resets the player's wallet to $5
    const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    execFileSync(process.execPath, [cli, "scripts/testUsers.ts", "seed"], { stdio: "pipe" });
}

async function main() {
    // imported after dotenv so every module sees the environment
    const { and, desc, eq, like, sql } = await import("drizzle-orm");
    const { db } = await import("../db");
    const { aiUsage, creditLedger, topups, ttsCache, users } = await import("../db/schema");
    const { isTestEmail, testAccounts } = await import("../lib/testMode");
    const wallet = await import("../server/services/wallet");
    const { generate, speak, transcribe, StorytellerError, MODELS } = await import("../server/ai/client");
    const { formatMoney } = await import("../server/ai/pricing");
    const { manualProvider } = await import("../server/payments/manual");

    async function testUser(role: "player" | "newcomer") {
        const user = await db.query.users.findFirst({ where: eq(users.email, testAccounts[role].email) });
        // every write below is for a flagged test account, or it does not happen
        if (!user || !user.isTest || !isTestEmail(user.email)) throw new Error(`Test ${role} missing or not flagged — run: npm run test:seed`);
        return user;
    }
    async function balance(userId: string): Promise<number> {
        const [row] = await db.select({ b: users.creditMicros }).from(users).where(eq(users.id, userId));
        return row.b;
    }
    async function usageCount(userId: string): Promise<number> {
        const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(aiUsage).where(eq(aiUsage.userId, userId));
        return row.n;
    }

    const run = `check-${Date.now().toString(36)}`;
    const tiny = z.object({ word: z.string(), meaning: z.string() });

    console.log("1. reseed");
    reseed();
    const player = await testUser("player");
    const userId = player.id;
    console.log("  wallet:", await wallet.getWallet(userId));
    check((await balance(userId)) === 5_000_000, "player starts at $5.00");

    console.log("2. idempotent grant");
    {
        const before = await balance(userId);
        const first = await wallet.grant(userId, 1_000, "check:grant", run);
        const second = await wallet.grant(userId, 1_000, "check:grant", run);
        console.log("  first:", first, "second:", second);
        check(first.credited && !second.credited, "second grant with the same ref credits nothing");
        check((await balance(userId)) === before + 1_000, "balance moved exactly once");
        // concurrent duplicates too
        const racing = await Promise.all([1, 2, 3].map(() => wallet.grant(userId, 1_000, "check:grant", `${run}-race`)));
        check(racing.filter((r) => r.credited).length === 1, "three concurrent identical grants credit once");
        check((await balance(userId)) === before + 2_000, "balance moved once for the race");
    }

    console.log("3. 20 concurrent charges of 1,000");
    {
        const start = await balance(userId);
        await Promise.all(Array.from({ length: 20 }, (_, i) => wallet.charge(userId, 1_000, "check:charge", `${run}-c${i}`)));
        const end = await balance(userId);
        const rows = await db.select({ after: creditLedger.balanceAfterMicros }).from(creditLedger)
            .where(and(eq(creditLedger.userId, userId), like(creditLedger.ref, `${run}-c%`)));
        const distinct = new Set(rows.map((r) => r.after));
        console.log(`  start ${start}, end ${end}, ledger rows ${rows.length}, distinct balances ${distinct.size}`);
        check(end === start - 20_000, "final balance is exactly start − 20,000");
        check(rows.length === 20 && distinct.size === 20, "20 ledger rows with 20 distinct balanceAfter values");
        const expected = new Set(Array.from({ length: 20 }, (_, i) => start - 1_000 * (i + 1)));
        check([...distinct].every((b) => expected.has(b)), "the balances are exactly start−1,000 … start−20,000");
        // charging the same ref again takes nothing
        const again = await wallet.charge(userId, 1_000, "check:charge", `${run}-c0`);
        check(again === end, "a repeated charge with the same ref takes nothing");
    }

    console.log("4. topup completed twice");
    {
        const before = await balance(userId);
        const topup = await wallet.createTopup(userId, "pouch", "manual");
        const first = await wallet.completeTopup({ topupId: topup.id, provider: "manual", providerRef: `manual-${topup.id}` });
        const second = await wallet.completeTopup({ topupId: topup.id, provider: "manual", providerRef: `manual-${topup.id}` });
        console.log("  first:", first, "second:", second);
        check(first.credited && !second.credited, "credited once");
        check((await balance(userId)) === before + 5_000_000, "balance rose by exactly $5.00");
        const [row] = await db.select().from(topups).where(eq(topups.id, topup.id));
        check(row.status === "paid" && row.providerRef === `manual-${topup.id}` && row.paidAt !== null, "topup marked paid with its ref");

        const racer = await wallet.createTopup(userId, "satchel", "manual");
        const mid = await balance(userId);
        const both = await Promise.all([1, 2].map(() => wallet.completeTopup({ topupId: racer.id, provider: "manual", providerRef: `manual-${racer.id}` })));
        check(both.filter((r) => r.credited).length === 1 && (await balance(userId)) === mid + 10_500_000, "two concurrent completions credit once");

        let wrongProvider = false;
        try { await wallet.completeTopup({ topupId: topup.id, provider: "stripe", providerRef: "x" }); } catch { wrongProvider = true; }
        let missing = false;
        try { await wallet.completeTopup({ topupId: `${run}-nope`, provider: "manual", providerRef: "x" }); } catch { missing = true; }
        check(wrongProvider && missing, "another provider's topup and a missing topup both throw");

        const viaCheckout = await wallet.createTopup(userId, "pouch", "manual");
        const beforeCheckout = await balance(userId);
        const checkout = () => manualProvider.startCheckout({
            topup: viaCheckout, pkg: wallet.findPackage("pouch")!, user: player, returnUrl: "http://localhost:3011/wallet",
        });
        if (manualProvider.available()) {
            const redirect = await checkout();
            check(redirect.redirectUrl === "http://localhost:3011/wallet" && (await balance(userId)) === beforeCheckout + 5_000_000,
                "manual checkout credits immediately");
        } else {
            // TEST_MODE_SECRET lives in .env.development.local, which this script does not load
            let refused = false;
            try { await checkout(); } catch { refused = true; }
            check(refused && (await balance(userId)) === beforeCheckout, "manual checkout refuses when test mode is off");
        }
    }

    console.log("5. one real generate per tier");
    for (const tier of ["story", "scribe"] as const) {
        const before = await balance(userId);
        const t = Date.now();
        const result = await generate({
            ctx: { userId }, task: `check-${tier}`, tier,
            instructions: "You are a Spanish tutor. Answer with one common Spanish word and its English meaning.",
            input: "A word for something you find in a kitchen.",
            schema: tiny,
        });
        const wall = Date.now() - t;
        const [usage] = await db.select().from(aiUsage)
            .where(and(eq(aiUsage.userId, userId), eq(aiUsage.task, `check-${tier}`))).orderBy(desc(aiUsage.createdAt)).limit(1);
        const [ledger] = await db.select().from(creditLedger)
            .where(and(eq(creditLedger.reason, `ai:check-${tier}`), eq(creditLedger.ref, usage.id)));
        const after = await balance(userId);
        console.log(`  ${tier}: ${JSON.stringify(result)} model=${usage.model} in=${usage.inputTokens} cached=${usage.cachedTokens} ` +
            `out=${usage.outputTokens} cost=${usage.costMicros}µ charged=${usage.chargedMicros}µ (${formatMoney(usage.chargedMicros)}) ` +
            `api ${usage.ms}ms, wall ${wall}ms`);
        check(usage.model.startsWith(MODELS[tier]), `${tier} used ${MODELS[tier]}`);
        check(Boolean(ledger) && ledger.deltaMicros === -usage.chargedMicros, `${tier} has a matching ledger row`);
        check(before - after === usage.chargedMicros && usage.chargedMicros > 0, `${tier} balance dropped by exactly chargedMicros`);
    }

    console.log("5b. bookkeeping failure never fails a good generation");
    {
        // a bookId that is not a book makes the ai_usage insert fail on its foreign key
        const before = await balance(userId);
        const result = await generate({
            ctx: { userId, bookId: `${run}-no-such-book` }, task: "check-bookkeeping", tier: "scribe",
            instructions: "Answer with one Spanish word and its meaning.", input: "Something to drink.", schema: tiny,
        });
        check(typeof result.word === "string", "the result still came back");
        check((await balance(userId)) === before, "nothing was charged (the failure was logged above)");
    }

    console.log("5c. output that fails validation is retried once, and both attempts are charged");
    {
        const before = await balance(userId);
        const callsBefore = await usageCount(userId);
        // the refinement is invisible to the JSON schema, so the model cannot satisfy it
        const impossible = tiny.refine(() => false, "never valid");
        let kind: string | null = null;
        try {
            await generate({ ctx: { userId }, task: "check-invalid", tier: "scribe", instructions: "Answer with one Spanish word and its meaning.", input: "Bread.", schema: impossible });
        } catch (error) {
            kind = error instanceof StorytellerError ? error.kind : String(error);
        }
        const rows = await db.select().from(aiUsage)
            .where(and(eq(aiUsage.userId, userId), eq(aiUsage.task, "check-invalid"))).orderBy(desc(aiUsage.createdAt)).limit(2);
        const charged = rows.reduce((sum, row) => sum + row.chargedMicros, 0);
        console.log(`  kind=${kind}, attempts recorded ${(await usageCount(userId)) - callsBefore}, ok flags ${rows.map((r) => r.ok)}, charged ${charged}µ`);
        check(kind === "failed", "the caller gets StorytellerError kind failed");
        check((await usageCount(userId)) - callsBefore === 2 && rows.every((r) => !r.ok), "two attempts recorded, both not ok");
        check(before - (await balance(userId)) === charged && charged > 0, "both attempts were charged");
    }

    console.log("6. prompt caching: the same call three times");
    {
        const rules = Array.from({ length: 60 }, (_, i) =>
            `Rule ${i + 1}: when a reader meets new word number ${i + 1} in a scene, the storyteller shows it in context ` +
            `with a gentle hint, never a lecture, and keeps the sentence short enough to guess the meaning from the scene.`);
        const instructions = `You are the Wordbound rulebook.\n${rules.join("\n")}\nAnswer with one Spanish word and its meaning.`;
        const cacheKey = `${run}-cache`;
        for (let i = 1; i <= 3; i++) {
            await generate({ ctx: { userId }, task: "check-cache", tier: "story", instructions, input: `Round ${i}: a word about weather.`, schema: tiny, cacheKey });
            const [usage] = await db.select().from(aiUsage)
                .where(and(eq(aiUsage.userId, userId), eq(aiUsage.task, "check-cache"))).orderBy(desc(aiUsage.createdAt)).limit(1);
            console.log(`  run ${i}: in=${usage.inputTokens} cached=${usage.cachedTokens} out=${usage.outputTokens} cost=${usage.costMicros}µ ${usage.ms}ms`);
            if (i === 1) check(usage.inputTokens >= 1_200, "instructions are at least 1,200 tokens");
        }
    }

    console.log("7. speech is cached");
    {
        const text = `Buenos días, viajero. (${run})`;
        const before = await balance(userId);
        const first = await speak({ ctx: { userId }, text, voice: "alloy" });
        const mid = await balance(userId);
        const second = await speak({ ctx: { userId }, text, voice: "alloy" });
        const after = await balance(userId);
        console.log(`  first: ${first.audio.length} bytes cached=${first.cached} charged ${before - mid}µ; second: cached=${second.cached} charged ${mid - after}µ`);
        check(!first.cached && before - mid > 0, "first call generated and charged");
        check(second.cached && mid === after && second.audio.equals(first.audio), "second call was a free cache hit");

        // tidy first: the check's own line need not stay in the shared cache
        const { createHash } = await import("crypto");
        const key = createHash("sha256").update(`gpt-4o-mini-tts|alloy||${text}`).digest("hex");
        await db.delete(ttsCache).where(eq(ttsCache.key, key));

        // a nameless Blob, the way a browser recording arrives
        const heard = await transcribe({ ctx: { userId }, audio: new Blob([new Uint8Array(first.audio)], { type: "audio/mpeg" }), language: "es" });
        const [usage] = await db.select().from(aiUsage)
            .where(and(eq(aiUsage.userId, userId), eq(aiUsage.task, "transcribe"))).orderBy(desc(aiUsage.createdAt)).limit(1);
        console.log(`  transcribed back: "${heard}" in=${usage.inputTokens} out=${usage.outputTokens} cost=${usage.costMicros}µ`);
        check(heard.toLowerCase().includes("buenos"), "transcription round-trips");
    }

    console.log("8. an empty wallet is refused before the provider");
    {
        const left = await balance(userId);
        if (left > 0) await wallet.charge(userId, left, "check:drain", `${run}-drain`);
        check((await balance(userId)) === 0, "balance is 0");
        const callsBefore = await usageCount(userId);
        let kind: string | null = null;
        let message = "";
        try {
            await generate({ ctx: { userId }, task: "check-empty", tier: "scribe", instructions: "x", input: "y", schema: tiny });
        } catch (error) {
            if (error instanceof StorytellerError) { kind = error.kind; message = error.message; }
        }
        console.log(`  refused: kind=${kind} "${message}"`);
        check(kind === "wallet", "StorytellerError kind wallet");
        check((await usageCount(userId)) === callsBefore, "no provider call was recorded");
    }

    console.log("8b. mode gates (newcomer, no provider calls)");
    {
        const newcomer = await testUser("newcomer");
        let kind: string | null = null;
        try { await generate({ ctx: { userId: newcomer.id }, task: "check-gate", tier: "scribe", instructions: "x", input: "y", schema: tiny }); }
        catch (error) { kind = error instanceof StorytellerError ? `${error.kind}: ${error.message}` : String(error); }
        console.log(`  no mode: ${kind}`);
        check(kind === "wallet: Choose how to power your storyteller first.", "no billing mode is refused");

        await wallet.setBillingMode(newcomer.id, "byok");
        kind = null;
        try { await generate({ ctx: { userId: newcomer.id }, task: "check-gate", tier: "scribe", instructions: "x", input: "y", schema: tiny }); }
        catch (error) { kind = error instanceof StorytellerError ? `${error.kind}: ${error.message}` : String(error); }
        console.log(`  byok without a key: ${kind}`);
        check(kind?.startsWith("key:") ?? false, "BYOK without a key is refused, never served on the app key");

        const giftBefore = await balance(newcomer.id);
        const firstChoice = await wallet.setBillingMode(newcomer.id, "credits");
        await wallet.setBillingMode(newcomer.id, "byok");
        const secondChoice = await wallet.setBillingMode(newcomer.id, "credits");
        console.log(`  starter gift: ${giftBefore} → ${firstChoice.balanceMicros} → ${secondChoice.balanceMicros}`);
        // the gift is once per account forever: on a re-run of this script it is already spent
        check(secondChoice.balanceMicros === firstChoice.balanceMicros, "choosing the wallet again grants nothing more");
    }

    console.log("summary");
    console.log("  ", await wallet.usageSummary(userId, 1));

    reseed();
    const final = await testUser("player");
    console.log(`reseeded: player ${formatMoney(final.creditMicros)}, newcomer mode ${(await testUser("newcomer")).billingMode}`);
    console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error("checkWallet crashed:", error);
    try { reseed(); } catch { /* the crash above is the news */ }
    process.exit(1);
});
