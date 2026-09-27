import "server-only";
import { testModeEnabled } from "@/lib/testMode";
import { completeTopup } from "../services/wallet";
import type { PaymentProvider } from "./index";

/*
 * The pretend till, for test mode only: it "pays" instantly so the top-up
 * flow can be walked end to end without a card. It never exists in a
 * production build (testModeEnabled is false there), and even in development
 * it only serves the seeded test accounts.
 */
export const manualProvider: PaymentProvider = {
    key: "manual",

    available() {
        return testModeEnabled();
    },

    async startCheckout({ topup, user, returnUrl }) {
        if (!testModeEnabled()) throw new Error("Top-ups are not available right now.");
        if (!user.isTest || topup.userId !== user.id) throw new Error("Top-ups are not available right now.");
        await completeTopup({ topupId: topup.id, provider: "manual", providerRef: `manual-${topup.id}` });
        return { redirectUrl: returnUrl };
    },

    // nothing calls back: the payment completes inside startCheckout
    async readWebhook() {
        return null;
    },
};
