"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBillingStatusAction } from "@/server/actions/billing";
import { ensureByokKey } from "@/lib/byok";

type Badge =
    | { kind: "sparks"; sparks: number; low: boolean }
    | { kind: "keyMissing" }
    | null;

/**
 * The little lantern-status in the corner: sparks balance (with a low-balance
 * nudge) for credits players, or a warning when a BYOK device has lost its key.
 */
export function BillingBadge() {
    const [badge, setBadge] = useState<Badge>(null);

    useEffect(() => {
        let cancelled = false;
        getBillingStatusAction()
            .then((status) => {
                if (cancelled) return;
                if (status.mode === "credits") {
                    setBadge({ kind: "sparks", sparks: status.sparks, low: status.low });
                } else if (status.mode === "byok" && !ensureByokKey()) {
                    setBadge({ kind: "keyMissing" });
                }
            })
            .catch(() => { });
        return () => { cancelled = true; };
    }, []);

    if (!badge) return null;

    if (badge.kind === "keyMissing") {
        return (
            <Link
                href="/welcome"
                className="inline-flex items-center gap-1.5 rounded-md border border-ember bg-ember/15 px-2.5 py-1 text-sm text-parchment hover:bg-ember/30 whitespace-nowrap"
            >
                🔑 key missing — tap to re-add
            </Link>
        );
    }

    return (
        <Link
            href="/sparks"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm whitespace-nowrap transition-colors
                ${badge.low
                    ? "border-ember bg-ember/15 text-parchment hover:bg-ember/30"
                    : "border-gold/50 bg-gold/10 text-gold hover:bg-gold/20"}`}
            title={badge.low ? "Running low — top up to keep the story going" : "Your sparks"}
        >
            ✨ {badge.sparks}{badge.low && " — running low!"}
        </Link>
    );
}
