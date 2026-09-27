import "server-only";
import type { Topup, User } from "@/db/schema";
import type { Package } from "../services/wallet";
import { manualProvider } from "./manual";
import { stripeProvider } from "./stripe";

/*
 * Top-ups go through a PaymentProvider. A provider only ever REPORTS that a
 * payment happened; crediting is always services/wallet.completeTopup, which
 * credits a topup exactly once however many times it is told.
 */

export interface PaymentProvider {
    key: string;
    /** configured and allowed in this environment */
    available(): boolean;
    startCheckout(input: { topup: Topup; pkg: Package; user: User; returnUrl: string }): Promise<{ redirectUrl: string }>;
    /** null for an event that is not about a payment we handle; throws WebhookSignatureError when it is not genuine */
    readWebhook(request: Request): Promise<{ topupId: string; providerRef: string; paid: boolean } | null>;
}

/** the webhook could not be proven to come from the provider */
export class WebhookSignatureError extends Error {}

/** in order of preference */
export const providers: PaymentProvider[] = [stripeProvider, manualProvider];

export function getProvider(key: string): PaymentProvider | null {
    return providers.find((provider) => provider.key === key) ?? null;
}

export function defaultProvider(): PaymentProvider | null {
    return providers.find((provider) => provider.available()) ?? null;
}
