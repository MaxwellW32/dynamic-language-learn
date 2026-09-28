"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { startTopupAction } from "@/server/actions/wallet";
import { CardForm } from "./CardForm";

/**
 * Sets out to pay. The player is sent to the secure payment page and their
 * bank, and brought back to the wallet when it is done. Where the merchant
 * takes cards through our own form, that form comes first.
 */
export function TopupButton({ packageKey, packageName, price, disabled, needsCard }: {
    packageKey: string; packageName: string; price: string; disabled: boolean; needsCard: boolean;
}) {
    const [busy, setBusy] = useState(false);
    const [asking, setAsking] = useState(false);

    const pay = async (card?: { name: string; number: string; expiry: string; cvv: string }): Promise<string | null> => {
        setBusy(true);
        const result = await startTopupAction(packageKey, card);
        if (!result.ok) {
            setBusy(false);
            return result.error;
        }
        // stays busy: the page is about to be left
        window.location.assign(result.data.url);
        return null;
    };

    const clicked = async () => {
        if (needsCard) {
            setAsking(true);
            return;
        }
        const problem = await pay();
        if (problem) toast.error(problem, { duration: 6000 });
    };

    return (
        <>
            <Button variant="primary" className="w-full" disabled={disabled || busy} onClick={clicked}>
                {busy && !asking ? "One moment…" : `Pay ${price}`}
            </Button>
            {asking && (
                <CardForm
                    title={`${packageName} · ${price}`}
                    busy={busy}
                    onPay={pay}
                    onClose={() => {
                        if (!busy) setAsking(false);
                    }}
                />
            )}
        </>
    );
}
