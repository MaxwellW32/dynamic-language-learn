import { powerTranzByKey } from "@/server/payments/powertranz";
import { takeHandoff } from "@/server/services/wallet";

/*
 * The way out to the bank. The gateway answers a sale with a page that must
 * be opened in the browser (the card form, or the bank's verification); it was
 * kept with the top-up, and is served here once, as a page of its own.
 *
 * A page of its own and not a frame, on purpose: inside a frame the bank's
 * page is a third party, and browsers — Safari and the web views of phone apps
 * above all — keep a third party's cookies from it, which is how a
 * verification comes to fail for no reason the player can see.
 *
 * Nothing is decided here and nothing is credited. The link works once and
 * for fifteen minutes; after that there is nothing behind it.
 */

const page = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title}</title></head><body style="font-family:Georgia,serif;background:#f3ead8;color:#2b2118;text-align:center;padding:3rem 1rem">${body}</body></html>`;

const HEADERS = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex",
};

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    const { provider: key } = await params;
    const url = new URL(request.url);
    const topupId = url.searchParams.get("t") ?? "";
    const handoffKey = url.searchParams.get("k") ?? "";

    const provider = powerTranzByKey(key);
    const html = provider && provider.config() !== null && topupId ? await takeHandoff(topupId, handoffKey, provider.key) : null;

    if (html === null) {
        return new Response(
            page("This link has been used", `<h1>This payment link has been used</h1><p>Nothing was charged. <a href="/wallet">Go back to your wallet</a> to try again.</p>`),
            { status: 410, headers: HEADERS },
        );
    }

    // the gateway sends a whole document; a bare form is given one
    const whole = /<html[\s>]/i.test(html) ? html : page("Going to your bank…", `<p>Taking you to the secure payment page…</p>${html}`);
    return new Response(whole, { headers: HEADERS });
}
