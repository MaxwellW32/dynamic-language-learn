/**
 * Test accounts for test mode (see lib/testMode.ts).
 *
 *   npx tsx scripts/testUsers.ts seed     create / reset the accounts
 *   npx tsx scripts/testUsers.ts clean    delete them and everything they created
 *   npx tsx scripts/testUsers.ts status   show what exists
 *   npx tsx scripts/testUsers.ts books    list the player's books (ids for /book/<id>)
 */
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../db";
import { aiUsage, books, creditLedger, sessions, topups, users } from "../db/schema";
import { TEST_EMAIL_DOMAIN, testAccounts } from "../lib/testMode";

/** enough wallet credit for many full test passes; topped back up on every seed */
const PLAYER_CREDIT_MICROS = 5_000_000;

const command = process.argv[2];

async function testUsers() {
    return db.select().from(users).where(like(users.email, `%${TEST_EMAIL_DOMAIN}`));
}

async function seed() {
    for (const [role, account] of Object.entries(testAccounts)) {
        const onboarded = role === "player";
        await db.transaction(async (tx) => {
            // the balance is never set here directly: it starts at zero and moves only with a ledger row
            const [row] = await tx.insert(users).values({
                email: account.email,
                name: account.name,
                emailVerified: new Date(),
                isTest: true,
                billingMode: onboarded ? "credits" : null,
                creditMicros: 0,
            }).onConflictDoUpdate({
                target: users.email,
                set: {
                    name: account.name,
                    isTest: true,
                    billingMode: onboarded ? "credits" : null,
                },
            }).returning({ id: users.id });

            // payments that were started and never paid: left alone they would count against the next
            // test run, which is allowed only so many unpaid attempts in an hour
            await tx.delete(topups).where(and(eq(topups.userId, row.id), inArray(topups.status, ["pending", "failed"])));

            if (onboarded) {
                // locked, so a model call charging at the same moment cannot slip between the read and the write
                const [current] = await tx.select({ creditMicros: users.creditMicros }).from(users)
                    .where(eq(users.id, row.id)).for("update");
                const delta = PLAYER_CREDIT_MICROS - current.creditMicros;
                if (delta !== 0) {
                    const [updated] = await tx.update(users)
                        .set({ creditMicros: sql`${users.creditMicros} + ${delta}` })
                        .where(eq(users.id, row.id))
                        .returning({ creditMicros: users.creditMicros });
                    await tx.insert(creditLedger).values({
                        userId: row.id,
                        deltaMicros: delta,
                        reason: "test-seed",
                        balanceAfterMicros: updated.creditMicros,
                    });
                }
            } else {
                // the newcomer always starts from nothing: no books, no ledger, so no balance
                await tx.delete(books).where(eq(books.userId, row.id));
                await tx.delete(creditLedger).where(eq(creditLedger.userId, row.id));
                await tx.update(users).set({ creditMicros: 0 }).where(eq(users.id, row.id));
            }
        });
        console.log(`ready: ${account.email} — ${account.about}`);
    }
    console.log("\nSign in with /api/test-login?as=<player|newcomer>&secret=<TEST_MODE_SECRET> while `npm run dev` is running.");
}

async function clean() {
    const found = await testUsers();
    if (found.length === 0) {
        console.log("No test accounts to remove.");
        return;
    }
    // every row handled here must belong to a flagged test account
    const safe = found.filter((user) => user.isTest);
    const ids = safe.map((user) => user.id);
    await db.delete(sessions).where(inArray(sessions.userId, ids));
    // books, progress, ledger and conversations all cascade from the user row
    await db.delete(users).where(inArray(users.id, ids));
    console.log(`Removed ${safe.length} test account(s) and everything they created.`);
}

async function status() {
    const found = await testUsers();
    if (found.length === 0) {
        console.log("No test accounts — run: npm run test:seed");
        return;
    }
    for (const user of found) {
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(books).where(eq(books.userId, user.id));
        const [spend] = await db.select({
            calls: sql<number>`count(*)::int`,
            cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::float8`,
        }).from(aiUsage).where(eq(aiUsage.userId, user.id));
        console.log(
            `${user.email}: ${user.billingMode ?? "not onboarded"}, wallet $${(user.creditMicros / 1e6).toFixed(4)}, ` +
            `${count} book(s), ${spend.calls} AI calls costing $${(spend.cost / 1e6).toFixed(4)}`,
        );
    }
}

async function listBooks() {
    const player = await db.query.users.findFirst({ where: eq(users.email, testAccounts.player.email) });
    if (!player) {
        console.log("No test player — run: npm run test:seed");
        return;
    }
    const rows = await db.query.books.findMany({ where: eq(books.userId, player.id), orderBy: [desc(books.updatedAt)] });
    if (rows.length === 0) console.log("The test player has no books yet.");
    for (const book of rows) console.log(`${book.id}  ${book.status.padEnd(9)} ${book.targetLanguage}  ${book.title}`);
}

async function main() {
    if (command === "seed") await seed();
    else if (command === "clean") await clean();
    else if (command === "status") await status();
    else if (command === "books") await listBooks();
    else {
        console.error("Usage: npx tsx scripts/testUsers.ts <seed|clean|status|books>");
        process.exit(1);
    }
    process.exit(0);
}

main().catch((error) => {
    console.error(`Nothing more was changed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
