"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { startTopupAction } from "@/server/actions/wallet";

/** sends the player to pay; the provider brings them back to /wallet */
export function TopupButton({ packageKey, label, disabled }: { packageKey: string; label: string; disabled: boolean }) {
    const [busy, setBusy] = useState(false);

    const buy = async () => {
        setBusy(true);
        const result = await startTopupAction(packageKey);
        if (!result.ok) {
            toast.error(result.error);
            setBusy(false);
            return;
        }
        // stays busy: the page is about to be left
        window.location.assign(result.data.redirectUrl);
    };

    return (
        <Button variant="primary" className="w-full" disabled={disabled || busy} onClick={buy}>
            {busy ? "One moment…" : label}
        </Button>
    );
}
