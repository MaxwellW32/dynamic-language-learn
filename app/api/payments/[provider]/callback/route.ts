import { appUrl, powerTranzByKey } from "@/server/payments/powertranz";
import { parseCallback } from "@/server/payments/rules";

/*
 * The way back from the bank: MerchantResponseUrl. The player's browser is
 * sent here when the card form or the bank's verification is done.
 *
 * Nothing in the request is believed. It is asked for one thing, the SpiToken,
 * which is given to the gateway; what the gateway answers decides everything,
 * including whose payment this is (see settle in server/payments/powertranz.ts).
 * So it does not matter that anyone can post here, and the player need not
 * even be signed in on this request — the session cookie is not sent with a
 * form posted from another site.
 *
 * Being told twice is harmless: a top-up is credited once.
 */

const MAX_BODY = 64 * 1024;

async function handle(request: Request, key: string): Promise<Response> {
    const back = (outcome: "paid" | "failed", topupId: string | null) =>
        // 303: the browser came by POST and must go on by GET
        Response.redirect(appUrl(`/wallet?topup=${outcome}${topupId ? `&id=${encodeURIComponent(topupId)}` : ""}`), 303);

    const provider = powerTranzByKey(key);
    if (!provider || provider.config() === null) return new Response("Not found", { status: 404 });

    const url = new URL(request.url);
    let raw = "";
    if (request.method === "POST") {
        raw = await request.text();
        if (raw.length > MAX_BODY) return back("failed", null);
    }
    const posted = parseCallback(request.headers.get("content-type") ?? "", raw, url.searchParams);

    try {
        const outcome = await provider.settle(posted);
        return back(outcome.paid ? "paid" : "failed", outcome.topupId);
    } catch (error) {
        console.error(`[payments] ${key}: the return from the bank could not be handled`, error instanceof Error ? error.message : error);
        return back("failed", typeof posted.OrderIdentifier === "string" ? posted.OrderIdentifier : null);
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    return handle(request, (await params).provider);
}

/** some banks come back with a GET */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    return handle(request, (await params).provider);
}
