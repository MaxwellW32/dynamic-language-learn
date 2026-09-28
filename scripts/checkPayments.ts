/**
 * Walks card payments from end to end against the test gateway
 * (app/api/dev/powertranz), as the seeded test player: the sale, the handoff,
 * the bank's page, the return, the settlement — and the returns that must NOT
 * be believed. No card is charged and no model is called.
 *
 *   npx tsx --conditions=react-server scripts/checkPayments.ts
 *
 * Needs the dev server running (port 3011): the gateway and the return route
 * are reached over HTTP, as a browser and the real gateway would reach them.
 */
import dotenv from "dotenv";
dotenv.config({ path: [".env.development.local", ".env.local"], quiet: true });

import { execFileSync } from "child_process";
import path from "path";

const BASE = (process.env.AUTH_URL ?? "http://localhost:3011").replace(/\/+$/, "");

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n        ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
}

const unescape = (text: string) => text
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** the hidden fields of the form on a page whose `outcome` is the one wanted, or of its only form */
function formOf(html: string, outcome?: string): { action: string; fields: Record<string, string> } | null {
    for (const match of html.matchAll(/<form[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/g)) {
        const fields: Record<string, string> = {};
        for (const input of match[2].matchAll(/<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g)) fields[input[1]] = unescape(input[2]);
        if (outcome === undefined || fields.outcome === outcome) return { action: unescape(match[1]), fields };
    }
    return null;
}

const asForm = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

async function main() {
    const { and, eq, inArray } = await import("drizzle-orm");
    const { db } = await import("../db");
    const { creditLedger, topups, users } = await import("../db/schema");
    const { testAccounts } = await import("../lib/testMode");
    const { providerFor } = await import("../server/payments");
    const { powerTranz, powerTranzTest, TEST_GATEWAY_ID, testGatewayPassword } = await import("../server/payments/powertranz");
    const { formatPrice, readCard } = await import("../server/payments/rules");
    const wallet = await import("../server/services/wallet");

    const player = await db.query.users.findFirst({ where: eq(users.email, testAccounts.player.email) });
    if (!player) throw new Error("No test player — run: npm run test:seed");
    const userId = player.id;
    const pouch = wallet.findPackage("pouch")!;
    const credentials = { "PowerTranz-PowerTranzId": TEST_GATEWAY_ID, "PowerTranz-PowerTranzPassword": testGatewayPassword() };
    const made: string[] = [];

    const balance = async () => (await db.query.users.findFirst({ where: eq(users.id, userId) }))!.creditMicros;
    const rowOf = async (id: string) => (await db.query.topups.findFirst({ where: eq(topups.id, id) }))!;
    const creditsFor = async (id: string) =>
        (await db.query.creditLedger.findMany({ where: and(eq(creditLedger.reason, "topup"), eq(creditLedger.ref, id)) })).length;
    const gatewayLog = async (): Promise<{ kind: string; tx: string }[]> =>
        ((await (await fetch(`${BASE}/api/dev/powertranz/log`, { headers: credentials })).json()) as { log: { kind: string; tx: string }[] }).log;

    /** set out to pay, as the wallet's action does, and open the page the browser would be sent to */
    async function begin(card: Parameters<typeof powerTranzTest.startCheckout>[0]["card"] = null) {
        const provider = providerFor(player!)!;
        const topup = await wallet.createTopup(userId, pouch.key, provider.key, provider.priceOf(pouch));
        made.push(topup.id);
        const { url } = await provider.startCheckout({ topup, pkg: pouch, user: player!, card });
        const page = await fetch(`${BASE}${url}`);
        return { topup, url, status: page.status, html: await page.text() };
    }

    /** press a button on the bank's page and follow the browser back to the merchant; returns where it ends up */
    async function bank(html: string, outcome: string): Promise<{ location: string; returned: { action: string; fields: Record<string, string> } }> {
        const button = formOf(html, outcome);
        if (!button) throw new Error(`the bank's page has no "${outcome}" button`);
        const answered = await fetch(button.action, { method: "POST", headers: FORM, body: asForm(button.fields) });
        const returned = formOf(await answered.text());
        if (!returned) throw new Error("the bank did not send the browser back");
        const landed = await fetch(returned.action, { method: "POST", headers: FORM, body: asForm(returned.fields), redirect: "manual" });
        return { location: landed.headers.get("location") ?? `(status ${landed.status})`, returned };
    }

    console.log("0. the test gateway is there, and is the one a test account is given");
    {
        const alive = await fetch(`${BASE}/api/dev/powertranz/alive`, { headers: credentials }).catch(() => null);
        if (!alive?.ok) throw new Error(`The dev server is not answering at ${BASE} — start it with: npm run dev`);
        check(true, "the gateway answers");
        check((await fetch(`${BASE}/api/dev/powertranz/alive`)).status === 401, "and refuses whoever has no credentials");
        check(providerFor(player)?.key === "powertranz-test", "a test account pays through the test gateway", providerFor(player)?.key);
        check(!powerTranz.availableTo(player), "and is never given the real one");
        check(!powerTranzTest.availableTo({ ...player, isTest: false }), "an ordinary account is never given the test gateway");
    }

    console.log("1. a payment that goes through");
    let replay: { action: string; fields: Record<string, string> };
    {
        const before = await balance();
        const { topup, url, status, html } = await begin();
        check(status === 200 && /Test bank/.test(html), "the handoff serves the gateway's page");
        check(topup.chargedMinor === 600 && topup.chargedCurrency === "USD" && html.includes("$6.00 USD"), "for the price of the package", { charged: topup.chargedMinor });
        check((await fetch(`${BASE}${url}`)).status === 410, "and serves it once only");

        const { location, returned } = await bank(html, "approve");
        replay = returned;
        const row = await rowOf(topup.id);
        check(location.endsWith(`/wallet?topup=paid&id=${topup.id}`), "the player is brought back to the wallet", location);
        check(row.status === "paid" && row.paidAt !== null && row.providerRef === topup.transactionId, "the top-up is paid, under the gateway's reference", row.status);
        check(row.cardBrand === "Visa" && row.cardLast4 === "0006" && row.authCode === "TEST01", "with the card's brand and last four digits, and no more");
        check(row.handoff === null && row.handoffKey === null, "and the way to the bank is closed behind it");
        check((await balance()) === before + pouch.creditMicros, "the wallet rose by exactly the package's credit");
        check((await creditsFor(topup.id)) === 1, "with one line in the ledger");

        const again = await fetch(replay.action, { method: "POST", headers: FORM, body: asForm(replay.fields), redirect: "manual" });
        check((again.headers.get("location") ?? "").includes("topup=paid"), "the same return a second time still says paid");
        check((await balance()) === before + pouch.creditMicros && (await creditsFor(topup.id)) === 1, "and credits nothing more");
    }

    console.log("2. payments the bank refuses");
    for (const [outcome, words] of [["decline", /declined/], ["funds", /enough funds/]] as const) {
        const before = await balance();
        const { topup, html } = await begin();
        const { location } = await bank(html, outcome);
        const row = await rowOf(topup.id);
        check(location.includes("topup=failed") && row.status === "failed", `${outcome}: the top-up failed`, { location, status: row.status });
        check(words.test(row.message ?? ""), `${outcome}: the player is told why, in plain words`, row.message);
        check((await balance()) === before && (await creditsFor(topup.id)) === 0, `${outcome}: nothing was credited`);
    }

    console.log("3. a cardholder the bank could not verify");
    {
        const before = await balance();
        const { topup, html } = await begin();
        const { location } = await bank(html, "fail3ds");
        const asked = (await gatewayLog()).filter((entry) => entry.tx === topup.transactionId).map((entry) => entry.kind);
        check(location.includes("topup=failed"), "the player is told it did not go through", location);
        check(!asked.some((kind) => kind.startsWith("payment")), "the sale was never finished, so nothing was charged", asked);
        check((await balance()) === before && (await rowOf(topup.id)).status === "pending", "and nothing was credited");
    }

    console.log("4. a player who turns back at the bank");
    {
        const before = await balance();
        const { topup, html } = await begin();
        const { location } = await bank(html, "cancel");
        check(location.includes("topup=failed") && (await balance()) === before && (await rowOf(topup.id)).status === "pending", "nothing happens", location);
    }

    console.log("5. approvals that must not be kept");
    for (const [outcome, what] of [["unverified", "the cardholder was not verified"], ["wrongamount", "the amount is not the one asked for"]] as const) {
        const before = await balance();
        const { topup, html } = await begin();
        const { location } = await bank(html, outcome);
        const asked = (await gatewayLog()).filter((entry) => entry.tx === topup.transactionId).map((entry) => entry.kind);
        const row = await rowOf(topup.id);
        check(location.includes("topup=failed") && row.status === "failed", `${what}: the top-up failed`, { location, status: row.status });
        check(asked.includes("void"), `${what}: the money was given back at once`, asked);
        check((await balance()) === before && (await creditsFor(topup.id)) === 0, `${what}: nothing was credited`);
    }
    {
        const before = await balance();
        const { topup, html } = await begin();
        const { location } = await bank(html, "wrongorder");
        const asked = (await gatewayLog()).filter((entry) => entry.tx === topup.transactionId).map((entry) => entry.kind);
        check(location.includes("topup=failed") && asked.includes("void"), "an approval for an order that does not exist is given back", { location, asked });
        check((await balance()) === before && (await rowOf(topup.id)).status === "pending", "and credits nobody");
    }

    console.log("6. returns that were never from the bank");
    {
        const before = await balance();
        const { topup } = await begin();
        const callback = `${BASE}/api/payments/powertranz-test/callback`;
        const forged = [
            { Approved: true, IsoResponseCode: "00", OrderIdentifier: topup.id, TransactionIdentifier: topup.transactionId, TotalAmount: 6, CurrencyCode: "840", SpiToken: "made-up" },
            { Approved: true, IsoResponseCode: "00", OrderIdentifier: topup.id, TransactionIdentifier: topup.transactionId, TotalAmount: 6 },
            // a token that did pay — for someone else's top-up
            { ...JSON.parse(replay.fields.Response) as Record<string, unknown>, OrderIdentifier: topup.id },
        ];
        for (const body of forged) {
            const landed = await fetch(callback, { method: "POST", headers: FORM, body: asForm({ Response: JSON.stringify(body) }), redirect: "manual" });
            check(landed.status === 303, "a forged return is answered like any other", landed.status);
        }
        const asJson = await fetch(callback, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(forged[0]), redirect: "manual" });
        const empty = await fetch(callback, { redirect: "manual" });
        check(asJson.status === 303 && empty.status === 303, "whatever shape it comes in");
        check((await balance()) === before && (await rowOf(topup.id)).status === "pending" && (await creditsFor(topup.id)) === 0, "and none of them credits anything");
        check((await fetch(`${BASE}/api/payments/no-such-gateway/callback`, { method: "POST", redirect: "manual" })).status === 404, "a gateway that does not exist is not found");
        check((await fetch(`${BASE}/api/payments/powertranz-test/handoff?t=${topup.id}&k=${"x".repeat(32)}`)).status === 410, "the way to the bank does not open without its key");
    }

    console.log("7. a card typed into our own form");
    {
        process.env.POWERTRANZ_CARD_FORM = "own";
        const before = await balance();
        check(providerFor(player)!.needsCard(), "the form is asked for");
        let refused = "";
        const bare = await wallet.createTopup(userId, pouch.key, "powertranz-test", powerTranzTest.priceOf(pouch));
        made.push(bare.id);
        try { await powerTranzTest.startCheckout({ topup: bare, pkg: pouch, user: player, card: null }); } catch (error) { refused = error instanceof Error ? error.message : ""; }
        check(/card details/.test(refused), "setting out without a card is refused", refused);

        const typed = readCard({ name: "Test Player", number: "4012 0000 0002 0006", expiry: "12/30", cvv: "123" }, new Date());
        if (!typed.ok) throw new Error("the test card was refused");
        const { topup, html } = await begin(typed.card);
        const { location } = await bank(html, "approve");
        check(location.includes("topup=paid") && (await balance()) === before + pouch.creditMicros, "the gateway takes the card and the payment goes through", location);
        const kept = JSON.stringify(await rowOf(topup.id));
        check(!kept.includes("4012000000020006") && !kept.includes("\"123\""), "and nothing of the card is kept but its last four digits");
        delete process.env.POWERTRANZ_CARD_FORM;
    }

    console.log("8. a merchant account in Jamaican dollars");
    {
        process.env.POWERTRANZ_CURRENCY = "JMD";
        process.env.POWERTRANZ_JMD_PER_USD = "160";
        const before = await balance();
        check(formatPrice(providerFor(player)!.priceOf(pouch)) === "J$960", "the pouch costs J$960 at 160 to the dollar");
        const { topup, html } = await begin();
        check(topup.chargedMinor === 96_000 && topup.chargedCurrency === "JMD" && topup.paidCents === 600 && html.includes("J$960.00 JMD"), "the card is charged in JMD", { charged: topup.chargedMinor, currency: topup.chargedCurrency });
        const { location } = await bank(html, "approve");
        check(location.includes("topup=paid") && (await balance()) === before + pouch.creditMicros, "and the wallet is credited the same US dollars", location);
        delete process.env.POWERTRANZ_CURRENCY;
        delete process.env.POWERTRANZ_JMD_PER_USD;
    }

    console.log("9. a payment given back");
    {
        const before = await balance();
        const { topup, html } = await begin();
        await bank(html, "approve");
        const first = await wallet.markRefunded(topup.id);
        const second = await wallet.markRefunded(topup.id);
        check(first.reversed && !second.reversed && (await balance()) === before, "the credit leaves the wallet once", { first, second });
        check((await rowOf(topup.id)).status === "refunded", "and the top-up says so");
        let kept = false;
        try { await wallet.completeTopup({ topupId: topup.id, provider: "powertranz-test", providerRef: "again" }); } catch { kept = true; }
        check(kept && (await balance()) === before, "a payment given back cannot be credited again");
    }

    console.log("10. someone trying card after card");
    {
        const unpaid = await wallet.recentAttempts(userId);
        const rows = await db.query.topups.findMany({ where: inArray(topups.id, made) });
        const expected = rows.filter((row) => row.status === "pending" || row.status === "failed").length;
        check(unpaid >= expected && expected >= 8, `${unpaid} unpaid attempts in the last hour are counted; the ones that paid are not`, { unpaid, expected });
    }

    // leave the test player as it was found: no unpaid attempts to hold up the next run, and $5 in the wallet
    await db.delete(topups).where(and(inArray(topups.id, made), inArray(topups.status, ["pending", "failed"])));
    const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    execFileSync(process.execPath, [cli, "scripts/testUsers.ts", "seed"], { stdio: "pipe" });

    console.log(failures === 0 ? "\nAll payment checks passed." : `\n${failures} CHECK(S) FAILED.`);
    process.exit(failures === 0 ? 0 : 2);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
