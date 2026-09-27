"use client";

import Link from "next/link";
import type { WalletView } from "@/game/payloads";
import { formatMoney } from "@/server/ai/pricing";

/**
 * The wallet in a header: a small pill that says what the storyteller has to
 * write with and leads to the wallet. `tone` picks the surface it sits on —
 * a parchment page, or the smoked glass of the game's HUD.
 */
export function WalletBadge({ wallet, tone = "page", className = "" }: {
    wallet: WalletView;
    tone?: "page" | "glass";
    className?: string;
}) {
    const surface = tone === "glass"
        ? "glass hover:bg-[rgb(36_26_18/0.78)]"
        : "bg-parchment-deep text-ink border border-wood/40 hover:bg-parchment-dark shadow-card";
    const base = `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-display tracking-wide whitespace-nowrap transition-colors ${surface}`;

    if (wallet.mode === null) {
        return (
            <Link href="/welcome" className={`${base} ${className}`}>
                <span aria-hidden className={tone === "glass" ? "text-gold-bright" : "text-gold"}>✦</span>
                choose how to pay
            </Link>
        );
    }

    if (wallet.mode === "byok") {
        return (
            <Link href="/wallet" className={`${base} ${className}`} title="The storyteller writes with your own key">
                <span aria-hidden>🔑</span>
                your key
            </Link>
        );
    }

    // running low: ember, breathing gently, so it is noticed without nagging
    const low = wallet.low
        ? tone === "glass"
            ? "!text-[#ffb98a] !border-ember/70 animate-flicker"
            : "!text-ember-deep !border-ember !bg-ember/10 animate-flicker"
        : "";
    const star = wallet.low ? "text-ember" : tone === "glass" ? "text-gold-bright" : "text-gold";

    return (
        <Link
            href="/wallet"
            className={`${base} ${low} ${className}`}
            title={wallet.low ? "Your wallet is running low" : "Your wallet"}
            aria-label={`Wallet: ${formatMoney(wallet.balanceMicros)}${wallet.low ? ", running low" : ""}`}
        >
            <span aria-hidden className={star}>✦</span>
            <span className="tabular-nums">{formatMoney(wallet.balanceMicros)}</span>
        </Link>
    );
}
