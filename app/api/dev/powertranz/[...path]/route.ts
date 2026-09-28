import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { testModeEnabled } from "@/lib/testMode";
import { TEST_GATEWAY_ID, testGatewayPassword } from "@/server/payments/powertranz";

/*
 * A pretend PowerTranz, for development only. It answers the same requests
 * in the same shapes as the real gateway, and where the real one would send
 * the player to their bank it shows a page of buttons: approve, decline, fail
 * the verification, and the answers a gateway should never give but might.
 * So the whole road — sale, handoff, bank, return, settlement — can be walked
 * and tested without a merchant account and without a card.
 *
 * It does not exist in a production build (testModeEnabled is false there),
 * and only the seeded test accounts are ever sent to it.
 *
 * It keeps nothing but a short memory of what it was asked, for the tests to
 * read: a transaction lives in the token that is passed along, signed so that
 * it cannot be rewritten on the way.
 */

type Outcome = "approve" | "decline" | "funds" | "fail3ds" | "unverified" | "wrongamount" | "wrongorder";

type Transaction = {
    tx: string;
    order: string;
    amount: number;
    currency: string;
    responseUrl: string;
    stage: "sale" | "final";
    outcome?: Outcome;
    issued: number;
};

type Memory = { used: Set<string>; log: { kind: string; tx: string; at: string }[] };
const memory = ((globalThis as unknown as { __wordboundTestGateway?: Memory }).__wordboundTestGateway ??= { used: new Set(), log: [] });

function remember(kind: string, tx: string): void {
    memory.log.push({ kind, tx, at: new Date().toISOString() });
    if (memory.log.length > 200) memory.log.splice(0, memory.log.length - 200);
}

const secret = () => process.env.TEST_MODE_SECRET ?? "";

function sign(transaction: Transaction): string {
    const body = Buffer.from(JSON.stringify(transaction)).toString("base64url");
    return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}

function read(token: unknown, stage: Transaction["stage"]): Transaction | null {
    if (typeof token !== "string") return null;
    const [body, mark] = token.split(".");
    if (!body || !mark) return null;
    const expected = createHmac("sha256", secret()).update(body).digest("base64url");
    if (mark.length !== expected.length || !timingSafeEqual(Buffer.from(mark), Buffer.from(expected))) return null;
    try {
        const transaction = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Transaction;
        // a real token lives for minutes
        if (transaction.stage !== stage || Date.now() - transaction.issued > 20 * 60_000) return null;
        return transaction;
    } catch {
        return null;
    }
}

function hasCredentials(request: Request): boolean {
    const id = request.headers.get("PowerTranz-PowerTranzId") ?? "";
    const password = request.headers.get("PowerTranz-PowerTranzPassword") ?? "";
    const expected = testGatewayPassword();
    return id === TEST_GATEWAY_ID && password.length === expected.length && timingSafeEqual(Buffer.from(password), Buffer.from(expected));
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c] ?? c);

const documentOf = (body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Test bank</title>` +
    `<style>body{font-family:system-ui,sans-serif;background:#eef1f5;color:#14171f;margin:0;padding:2rem 1rem}main{max-width:26rem;margin:0 auto;background:#fff;border-radius:12px;padding:1.5rem;box-shadow:0 2px 12px #0002}` +
    `h1{font-size:1.2rem;margin:0 0 .25rem}p{margin:.4rem 0;color:#475067}button{display:block;width:100%;margin:.9rem 0 .1rem;padding:.75rem;border-radius:8px;border:1px solid #c5cbd8;background:#f7f8fb;font-size:1rem;cursor:pointer}` +
    `button.yes{background:#1d6f42;color:#fff;border-color:#1d6f42}small{color:#7a8296}</style></head><body><main>${body}</main></body></html>`;

const html = (body: string) => new NextResponse(documentOf(body), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
});

const money = (t: Pick<Transaction, "amount" | "currency">) =>
    `${t.currency === "388" ? "J$" : "$"}${t.amount.toFixed(2)} ${t.currency === "388" ? "JMD" : t.currency === "840" ? "USD" : t.currency}`;

/* ------------------------------------------------------------------ */

function sale(body: Record<string, unknown>, origin: string): NextResponse {
    const extended = (body.ExtendedData ?? {}) as Record<string, unknown>;
    const source = body.Source as Record<string, unknown> | undefined;
    const problems: string[] = [];

    const tx = typeof body.TransactionIdentifier === "string" ? body.TransactionIdentifier : "";
    const order = typeof body.OrderIdentifier === "string" ? body.OrderIdentifier : "";
    const amount = typeof body.TotalAmount === "number" ? body.TotalAmount : NaN;
    const currency = typeof body.CurrencyCode === "string" ? body.CurrencyCode : "";
    const responseUrl = typeof extended.MerchantResponseUrl === "string" ? extended.MerchantResponseUrl : "";

    if (!/^[0-9a-f-]{36}$/i.test(tx)) problems.push("TransactionIdentifier must be a GUID");
    if (order.length === 0 || order.length > 50) problems.push("OrderIdentifier is required, 50 characters at most");
    if (!(amount > 0) || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) problems.push("TotalAmount must be a positive amount with two decimals at most");
    if (!/^\d{3}$/.test(currency)) problems.push("CurrencyCode must be an ISO 4217 numeric code");
    if (!/^https?:\/\//.test(responseUrl)) problems.push("ExtendedData.MerchantResponseUrl must be an absolute url");
    if (body.ThreeDSecure !== true) problems.push("ThreeDSecure must be true for /spi/sale");

    if (extended.HostedPage === undefined) {
        if (!source) problems.push("either Source or ExtendedData.HostedPage is required");
        else {
            const expiry = typeof source.CardExpiration === "string" ? source.CardExpiration : "";
            if (!/^\d{13,19}$/.test(String(source.CardPan ?? ""))) problems.push("Source.CardPan is not a card number");
            if (!/^\d{3,4}$/.test(String(source.CardCvv ?? ""))) problems.push("Source.CardCvv is not a security code");
            // YYMM: the month comes last
            if (!/^\d{4}$/.test(expiry) || Number(expiry.slice(2)) < 1 || Number(expiry.slice(2)) > 12) problems.push("Source.CardExpiration must be YYMM");
            if (String(source.CardholderName ?? "").trim().length === 0) problems.push("Source.CardholderName is required");
        }
    }

    if (problems.length > 0) {
        return NextResponse.json({
            Approved: false, TransactionIdentifier: tx, OrderIdentifier: order,
            IsoResponseCode: "SP1", ResponseMessage: "Request is not valid",
            Errors: problems.map((message) => ({ Code: "400", Message: message })),
        });
    }

    const token = sign({ tx, order, amount, currency, responseUrl, stage: "sale", issued: Date.now() });
    remember("sale", tx);

    const button = (outcome: Outcome | "cancel", label: string, note: string, primary = false) =>
        `<form method="post" action="${escape(origin)}/api/dev/powertranz/acs"><input type="hidden" name="token" value="${escape(token)}">` +
        `<input type="hidden" name="outcome" value="${outcome}"><button type="submit"${primary ? ` class="yes"` : ""}>${label}</button><small>${note}</small></form>`;

    const page = documentOf(
        `<h1>Test bank</h1><p>This is the test gateway. No card is charged.</p><p><strong>${escape(money({ amount, currency }))}</strong> to Wordbound</p>` +
        button("approve", "Approve the payment", "The bank verifies the cardholder and the payment goes through.", true) +
        button("decline", "Decline", "The bank says no (05).") +
        button("funds", "Not enough funds", "The bank says no (51).") +
        button("fail3ds", "Fail the verification", "The cardholder could not be verified; the sale must not be finished.") +
        button("cancel", "Go back without paying", "The player gives up on the bank's page.") +
        `<p style="margin-top:1.5rem"><small>What a gateway should never answer, to see that it is caught:</small></p>` +
        button("unverified", "Approve without verifying", "Approved, but the cardholder was not verified.") +
        button("wrongamount", "Approve another amount", "Approved, for a different amount than was asked.") +
        button("wrongorder", "Approve another order", "Approved, for an order that does not exist."),
    );

    return NextResponse.json({
        TransactionType: 2, Approved: false, TransactionIdentifier: tx, TotalAmount: amount, CurrencyCode: currency,
        IsoResponseCode: "SP4", ResponseMessage: "SPI Preprocessing complete", OrderIdentifier: order,
        SpiToken: token, RedirectData: page,
    });
}

/** the bank has decided: send the browser back to the merchant, as the real one does, by a form that posts itself */
function acs(form: URLSearchParams): NextResponse {
    const started = read(form.get("token"), "sale");
    if (!started) return html(`<h1>This page has expired</h1><p><a href="/wallet">Back to the wallet</a></p>`);

    const chosen = form.get("outcome") ?? "";
    if (chosen === "cancel") {
        remember("cancel", started.tx);
        return postBack(started.responseUrl, {
            TransactionType: 2, Approved: false, TransactionIdentifier: started.tx, OrderIdentifier: started.order,
            IsoResponseCode: "3D1", ResponseMessage: "3D-Secure not completed",
        });
    }
    const outcomes: Outcome[] = ["approve", "decline", "funds", "fail3ds", "unverified", "wrongamount", "wrongorder"];
    const outcome = outcomes.find((one) => one === chosen);
    if (!outcome) return html(`<h1>Unknown answer</h1>`);

    const final = sign({ ...started, stage: "final", outcome, issued: Date.now() });
    remember(`bank:${outcome}`, started.tx);
    const failed = outcome === "fail3ds";
    return postBack(started.responseUrl, {
        TransactionType: 2, Approved: false, TransactionIdentifier: started.tx, TotalAmount: started.amount,
        CurrencyCode: started.currency, OrderIdentifier: started.order, SpiToken: final,
        IsoResponseCode: failed ? "3D1" : "3D0",
        ResponseMessage: failed ? "3D-Secure authentication failed" : "3D-Secure complete",
        ...(outcome === "unverified" ? {} : { RiskManagement: { ThreeDSecure: { AuthenticationStatus: failed ? "N" : "Y", Eci: failed ? "07" : "05" } } }),
    });
}

function postBack(responseUrl: string, response: Record<string, unknown>): NextResponse {
    return html(
        `<h1>Returning to Wordbound…</h1>` +
        `<form id="back" method="post" action="${escape(responseUrl)}"><input type="hidden" name="Response" value="${escape(JSON.stringify(response))}">` +
        `<noscript><button type="submit" class="yes">Continue</button></noscript></form>` +
        `<script>document.getElementById("back").submit()</script>`,
    );
}

function payment(token: unknown): NextResponse {
    const transaction = read(token, "final");
    if (!transaction || !transaction.outcome) {
        return NextResponse.json({ Approved: false, IsoResponseCode: "SP2", ResponseMessage: "SpiToken is not valid" });
    }
    if (memory.used.has(transaction.tx)) {
        return NextResponse.json({
            Approved: false, TransactionIdentifier: transaction.tx, OrderIdentifier: transaction.order,
            IsoResponseCode: "SP3", ResponseMessage: "SpiToken has already been used",
        });
    }
    memory.used.add(transaction.tx);
    remember(`payment:${transaction.outcome}`, transaction.tx);

    const base = {
        TransactionType: 2, TransactionIdentifier: transaction.tx, TotalAmount: transaction.amount,
        CurrencyCode: transaction.currency, OrderIdentifier: transaction.order, CardBrand: "Visa", CardSuffix: "0006",
    };
    const verified = { RiskManagement: { ThreeDSecure: { AuthenticationStatus: "Y", Eci: "05", ResponseCode: "3D0" } } };
    const approved = { Approved: true, AuthorizationCode: "TEST01", RRN: String(Date.now()).slice(-12), IsoResponseCode: "00", ResponseMessage: "Transaction is approved" };

    switch (transaction.outcome) {
        case "approve":
            return NextResponse.json({ ...base, ...approved, ...verified });
        case "unverified":
            return NextResponse.json({ ...base, ...approved, RiskManagement: { ThreeDSecure: { AuthenticationStatus: "N", Eci: "07" } } });
        case "wrongamount":
            return NextResponse.json({ ...base, ...approved, ...verified, TotalAmount: Math.round((transaction.amount + 1) * 100) / 100 });
        case "wrongorder":
            return NextResponse.json({ ...base, ...approved, ...verified, OrderIdentifier: "no-such-order" });
        case "funds":
            return NextResponse.json({ ...base, ...verified, Approved: false, IsoResponseCode: "51", ResponseMessage: "Insufficient funds" });
        default:
            return NextResponse.json({ ...base, ...verified, Approved: false, IsoResponseCode: "05", ResponseMessage: "Do not honour" });
    }
}

/* ------------------------------------------------------------------ */

const notThere = () => new NextResponse("Not found", { status: 404 });

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
    if (!testModeEnabled()) return notThere();
    const path = (await params).path.join("/").toLowerCase();

    // the bank's own page posts a form and has no credentials, as a browser has none
    if (path === "acs") return acs(new URLSearchParams(await request.text()));

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ Approved: false, IsoResponseCode: "SP1", ResponseMessage: "Request is not JSON" }, { status: 400 });
    }

    // as the specification has it, finishing a sale needs the token and nothing else
    if (path === "spi/payment") return payment(body);

    if (!hasCredentials(request)) return NextResponse.json({ ResponseMessage: "Unauthorized" }, { status: 401 });
    const fields = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};

    if (path === "spi/sale") return sale(fields, new URL(request.url).origin);
    if (path === "void" || path === "refund") {
        const tx = typeof fields.TransactionIdentifier === "string" ? fields.TransactionIdentifier : "";
        if (!tx) return NextResponse.json({ Approved: false, IsoResponseCode: "SP1", ResponseMessage: "TransactionIdentifier is required" });
        remember(path, tx);
        return NextResponse.json({ Approved: true, TransactionIdentifier: tx, IsoResponseCode: "00", ResponseMessage: path === "void" ? "Transaction is voided" : "Transaction is refunded" });
    }
    return notThere();
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
    if (!testModeEnabled()) return notThere();
    const path = (await params).path.join("/").toLowerCase();
    if (!hasCredentials(request)) return NextResponse.json({ ResponseMessage: "Unauthorized" }, { status: 401 });
    if (path === "alive") return NextResponse.json({ alive: true });
    // what it has been asked, newest last: for the tests
    if (path === "log") return NextResponse.json({ log: memory.log });
    return notThere();
}
