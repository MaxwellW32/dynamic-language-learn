"use server";

import { z } from "zod";
import type { WalletView } from "@/game/payloads";
import { validateKey } from "@/server/ai/client";
import { requireUser } from "@/server/auth";
import { providerFor } from "@/server/payments";
import { formatPrice, MAX_ATTEMPTS_PER_HOUR, readCard, type Card } from "@/server/payments/rules";
import {
    createTopup, findPackage, getWallet, PACKAGES, recentActivity, recentAttempts, setBillingMode, topupOf, usageSummary,
} from "@/server/services/wallet";
import { attempt, type Result } from "./result";

/* The wallet screen's API: parse input → who is asking → the wallet service. */

export async function getWalletAction(): Promise<Result<WalletView>> {
    return attempt("getWallet", async () => {
        const { userId } = await requireUser();
        return getWallet(userId);
    });
}

export async function chooseBillingModeAction(mode: unknown): Promise<Result<WalletView>> {
    return attempt("chooseBillingMode", async () => {
        const parsed = z.enum(["byok", "credits"]).parse(mode);
        const { userId } = await requireUser();
        return setBillingMode(userId, parsed);
    });
}

/** checks a player's own key with a free probe; the key is never stored or logged */
export async function validateByokKeyAction(key: unknown): Promise<Result<boolean>> {
    return attempt("validateByokKey", async () => {
        const parsed = z.string().trim().min(1).max(512).parse(key);
        // signed-in only, so this is not an open key-checking service
        await requireUser();
        return validateKey(parsed);
    });
}

/**
 * Set out to pay. Answers with where the browser should go: the way to the
 * bank. `card` is only given when the player types their card into our own
 * form; it is checked, handed to the gateway and forgotten — never stored,
 * never logged, and no message made here repeats any of it.
 */
export async function startTopupAction(packageKey: unknown, card?: unknown): Promise<Result<{ url: string }>> {
    return attempt("startTopup", async () => {
        const parsed = z.string().min(1).max(40).parse(packageKey);
        const { userId, user } = await requireUser();
        const pkg = findPackage(parsed);
        if (!pkg) throw new Error("That package does not exist.");
        const provider = providerFor(user);
        if (!provider) throw new Error("Card payments are not set up yet.");

        let typed: Card | null = null;
        if (provider.needsCard()) {
            const read = readCard(card, new Date());
            if (!read.ok) throw new Error(read.message);
            typed = read.card;
        }

        if (await recentAttempts(userId) >= MAX_ATTEMPTS_PER_HOUR) {
            throw new Error("That is a lot of attempts in a short while. Please wait an hour and try again.");
        }
        const topup = await createTopup(userId, pkg.key, provider.key, provider.priceOf(pkg));
        return provider.startCheckout({ topup, pkg, user, card: typed });
    });
}

/** how the player pays, as the wallet page needs to know it */
export type CheckoutView = {
    available: boolean;
    /** the player types their card into our own form */
    needsCard: boolean;
    /** what each package costs, as it will be charged: "$6.00", or "J$960" */
    prices: Record<string, string>;
    /** the test gateway: no card is charged */
    test: boolean;
};

/** what came of a payment the player has just returned from */
export type TopupOutcome = { paid: true; creditMicros: number } | { paid: false; message: string };

export async function walletActivityAction(returned?: { outcome: string | null; topupId: string | null }) {
    return attempt("walletActivity", async () => {
        const { userId, user } = await requireUser();
        const [wallet, activity, usage, topup] = await Promise.all([
            getWallet(userId),
            recentActivity(userId),
            usageSummary(userId),
            returned?.topupId ? topupOf(userId, returned.topupId.slice(0, 64)) : Promise.resolve(null),
        ]);

        const provider = providerFor(user);
        const checkout: CheckoutView = {
            available: provider !== null,
            needsCard: provider?.needsCard() ?? false,
            prices: Object.fromEntries(PACKAGES.map((pkg) => [pkg.key, formatPrice(provider ? provider.priceOf(pkg) : { currency: "USD", minor: pkg.paidCents })])),
            test: provider?.key === "powertranz-test",
        };

        // what the address bar says is a hint; what the top-up's own row says is the answer
        let outcome: TopupOutcome | null = null;
        if (topup?.status === "paid") outcome = { paid: true, creditMicros: topup.creditMicros };
        else if (returned?.outcome === "paid" || returned?.outcome === "failed") {
            outcome = { paid: false, message: topup?.message ?? "The payment did not go through. Nothing was charged." };
        }
        return { wallet, activity, usage, packages: PACKAGES, checkout, outcome };
    });
}
