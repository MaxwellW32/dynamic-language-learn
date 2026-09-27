import { NextResponse } from "next/server";
import { getProvider, WebhookSignatureError } from "@/server/payments";
import { completeTopup, TopupError } from "@/server/services/wallet";

/*
 * Payment processors call here when money moves. Receiving the same event
 * twice is harmless: completeTopup credits a topup exactly once.
 *
 *   200  handled, or an event we do not act on (so the processor stops retrying)
 *   400  the signature did not check out
 *   404  no such provider, or not configured here
 *   500  something on our side failed; the processor will retry later
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    const { provider: key } = await params;
    const provider = getProvider(key);
    if (!provider || !provider.available()) return new NextResponse("Not found", { status: 404 });

    let event: Awaited<ReturnType<typeof provider.readWebhook>>;
    try {
        event = await provider.readWebhook(request);
    } catch (error) {
        if (error instanceof WebhookSignatureError) {
            return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
        }
        console.error(`[payments] ${key} webhook could not be read`, error instanceof Error ? error.message : error);
        return NextResponse.json({ error: "Could not read the event." }, { status: 500 });
    }

    if (!event || !event.paid) return NextResponse.json({ received: true, handled: false });

    try {
        const result = await completeTopup({ topupId: event.topupId, provider: provider.key, providerRef: event.providerRef });
        return NextResponse.json({ received: true, handled: true, credited: result.credited });
    } catch (error) {
        if (error instanceof TopupError) {
            // a payment for a topup we cannot credit needs a human, not a retry storm — log loudly, acknowledge
            console.error(`[payments] ${key} webhook for an uncreditable topup`, error.message);
            return NextResponse.json({ received: true, handled: false });
        }
        console.error(`[payments] ${key} webhook failed to credit`, error instanceof Error ? error.message : error);
        return NextResponse.json({ error: "Could not credit the payment." }, { status: 500 });
    }
}
