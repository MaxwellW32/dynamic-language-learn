import "server-only";
import Stripe from "stripe";
import type { PaymentProvider } from "./index";
import { WebhookSignatureError } from "./index";

/*
 * Stripe Checkout. UNTESTED against the live API: there are no Stripe keys in
 * the development environment, so this file has only been typechecked. Test
 * it with Stripe's test keys and `stripe listen --forward-to
 * localhost:3011/api/payments/stripe/webhook` before taking real money.
 *
 * Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. The webhook endpoint
 * should be subscribed to checkout.session.completed and
 * checkout.session.async_payment_succeeded.
 */

let client: Stripe | null = null;

function stripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Stripe is not configured.");
    client ??= new Stripe(key);
    return client;
}

/** returnUrl with ?topup=<outcome>; Stripe's {CHECKOUT_SESSION_ID} placeholder must stay unencoded */
function outcomeUrl(returnUrl: string, outcome: "success" | "cancelled"): string {
    const url = new URL(returnUrl);
    url.searchParams.set("topup", outcome);
    const base = url.toString();
    return outcome === "success" ? `${base}&session_id={CHECKOUT_SESSION_ID}` : base;
}

export const stripeProvider: PaymentProvider = {
    key: "stripe",

    available() {
        return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
    },

    async startCheckout({ topup, pkg, user, returnUrl }) {
        const session = await stripe().checkout.sessions.create({
            mode: "payment",
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: "usd",
                    // the price comes from the stored topup, which was priced from the package on our side
                    unit_amount: topup.paidCents,
                    product_data: { name: `Wordbound — ${pkg.name}`, description: pkg.blurb },
                },
            }],
            client_reference_id: topup.id,
            metadata: { topupId: topup.id },
            ...(user.email ? { customer_email: user.email } : {}),
            success_url: outcomeUrl(returnUrl, "success"),
            cancel_url: outcomeUrl(returnUrl, "cancelled"),
        });
        if (!session.url) throw new Error("Stripe did not return a checkout page.");
        return { redirectUrl: session.url };
    },

    async readWebhook(request) {
        const signature = request.headers.get("stripe-signature");
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!signature || !secret) throw new WebhookSignatureError("Missing Stripe signature.");
        // the signature covers the exact bytes Stripe sent, so read the raw body, never re-serialised JSON
        const raw = Buffer.from(await request.arrayBuffer());
        let event: Stripe.Event;
        try {
            event = stripe().webhooks.constructEvent(raw, signature, secret);
        } catch (error) {
            throw new WebhookSignatureError(error instanceof Error ? error.message : "Bad Stripe signature.");
        }

        // async_payment_succeeded is the late "paid" for methods (bank debits) that complete after checkout
        if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
            return null;
        }
        const session = event.data.object;
        const topupId = session.metadata?.topupId ?? session.client_reference_id;
        if (!topupId) return null;
        return { topupId, providerRef: session.id, paid: session.payment_status === "paid" };
    },
};
