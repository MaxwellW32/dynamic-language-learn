import type { User } from "@/db/schema";
import type { WalletView } from "@/game/payloads";

/*
 * The wallet's pure rules: packages, the markup, who may spend. They live
 * apart from services/wallet.ts (which touches the database and is
 * server-only) so the unit tests can import them with plain `tsx --test`.
 * services/wallet.ts re-exports everything here; import from there.
 */

/** $0.50, once per account, the first time it chooses the wallet */
export const STARTER_GIFT_MICROS = 500_000;

/** below this the wallet shows as running low */
export const LOW_BALANCE_MICROS = 250_000;

export const MIN_MARKUP = 1;
export const MAX_MARKUP = 5;

export type Package = {
    key: string;
    name: string;
    /** what the player pays, in US cents */
    paidCents: number;
    /** what lands in the wallet, in micros */
    creditMicros: number;
    blurb: string;
};

/**
 * The platform's margin is taken here, at top-up, not per call: model calls
 * are charged at cost × USAGE_MARKUP (default 1), and the packages credit
 * less than is paid. Bigger packages keep a smaller share.
 */
export const PACKAGES: Package[] = [
    { key: "pouch", name: "Pouch", paidCents: 600, creditMicros: 5_000_000, blurb: "$5 of storytelling for $6." },
    { key: "satchel", name: "Satchel", paidCents: 1_200, creditMicros: 10_500_000, blurb: "$10.50 of storytelling for $12." },
    { key: "chest", name: "Chest", paidCents: 3_000, creditMicros: 27_500_000, blurb: "$27.50 of storytelling for $30." },
];

export function findPackage(key: string): Package | null {
    return PACKAGES.find((pkg) => pkg.key === key) ?? null;
}

/** the platform's share of a package, in micros (paid minus credited) */
export function packageMarginMicros(pkg: Package): number {
    return pkg.paidCents * 10_000 - pkg.creditMicros;
}

/**
 * USAGE_MARKUP from the environment: default 1, clamped to [1, 5]. Below 1
 * would sell calls under cost; anything unreadable falls back to 1.
 */
export function parseMarkup(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === "") return MIN_MARKUP;
    const value = Number(raw);
    if (!Number.isFinite(value)) return MIN_MARKUP;
    return Math.min(MAX_MARKUP, Math.max(MIN_MARKUP, value));
}

/**
 * What the player is charged for a call that cost us `costMicros`, rounded
 * up. The tiny epsilon stops float noise (110 × 1.1 = 121.00000000000001)
 * from adding a micro that was never earned.
 */
export function chargeFor(costMicros: number, markup: number): number {
    if (!(costMicros > 0)) return 0;
    return Math.ceil(costMicros * markup - 1e-9);
}

export function walletViewOf(user: Pick<User, "billingMode" | "creditMicros">): WalletView {
    return {
        mode: user.billingMode ?? null,
        balanceMicros: user.creditMicros,
        low: user.billingMode === "credits" && user.creditMicros < LOW_BALANCE_MICROS,
    };
}

export const WALLET_EMPTY_MESSAGE = "Your wallet is empty — add credit to keep the story going.";
export const CHOOSE_MODE_MESSAGE = "Choose how to power your storyteller first.";

/**
 * Asked BEFORE a model call. Wallet users need a positive balance; BYOK users
 * always pass here (whether their key is on this device is the client's check).
 */
export function canSpend(user: Pick<User, "billingMode" | "creditMicros">): { ok: true } | { ok: false; message: string } {
    if (user.billingMode === "byok") return { ok: true };
    if (user.billingMode === "credits") {
        return user.creditMicros > 0 ? { ok: true } : { ok: false, message: WALLET_EMPTY_MESSAGE };
    }
    return { ok: false, message: CHOOSE_MODE_MESSAGE };
}
