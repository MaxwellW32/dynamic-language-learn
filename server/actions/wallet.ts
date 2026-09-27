"use server";

import { z } from "zod";
import type { WalletView } from "@/game/payloads";
import { validateKey } from "@/server/ai/client";
import { requireUser } from "@/server/auth";
import { defaultProvider } from "@/server/payments";
import {
    createTopup, findPackage, getWallet, PACKAGES, recentActivity, setBillingMode, usageSummary,
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

export async function startTopupAction(packageKey: unknown): Promise<Result<{ redirectUrl: string }>> {
    return attempt("startTopup", async () => {
        const parsed = z.string().min(1).max(40).parse(packageKey);
        const { userId, user } = await requireUser();
        const pkg = findPackage(parsed);
        if (!pkg) throw new Error("That package does not exist.");
        const provider = defaultProvider();
        if (!provider) throw new Error("Top-ups are not available right now.");
        const topup = await createTopup(userId, pkg.key, provider.key);
        const returnUrl = `${process.env.AUTH_URL ?? "http://localhost:3011"}/wallet`;
        return provider.startCheckout({ topup, pkg, user, returnUrl });
    });
}

export async function walletActivityAction() {
    return attempt("walletActivity", async () => {
        const { userId } = await requireUser();
        const [wallet, activity, usage] = await Promise.all([
            getWallet(userId),
            recentActivity(userId),
            usageSummary(userId),
        ]);
        return { wallet, activity, usage, packages: PACKAGES, provider: defaultProvider()?.key ?? null };
    });
}
