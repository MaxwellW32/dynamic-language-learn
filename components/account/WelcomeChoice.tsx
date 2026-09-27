"use client";

import { useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Panel";
import { storeByokKey } from "@/lib/byok";
import { chooseBillingModeAction, validateByokKeyAction } from "@/server/actions/wallet";

type Mode = "byok" | "credits" | null;

/**
 * The two ways to pay the storyteller. A failure must end in a kind
 * sentence, never a stuck button.
 */
export function WelcomeChoice({ current }: { current: Mode }) {
    const [busy, setBusy] = useState<"credits" | "byok" | null>(null);
    const [key, setKey] = useState("");
    const [refused, setRefused] = useState(false);

    const chooseWallet = async () => {
        setBusy("credits");
        const result = await chooseBillingModeAction("credits");
        if (!result.ok) {
            toast.error(result.error);
            setBusy(null);
            return;
        }
        // a full load, so every header on the shelf reads the new mode
        window.location.assign("/");
    };

    const useKey = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = key.trim();
        if (trimmed.length === 0) return;
        setBusy("byok");
        setRefused(false);
        const checked = await validateByokKeyAction(trimmed);
        if (!checked.ok) {
            toast.error(checked.error);
            setBusy(null);
            return;
        }
        if (!checked.data) {
            setRefused(true);
            setBusy(null);
            return;
        }
        storeByokKey(trimmed);
        const chosen = await chooseBillingModeAction("byok");
        if (!chosen.ok) {
            toast.error(chosen.error);
            setBusy(null);
            return;
        }
        window.location.assign("/");
    };

    return (
        <div className="grid gap-5 md:grid-cols-2 md:gap-6">
            <Choice
                title="A wallet"
                badge={current === null ? <Chip tone="gold">recommended</Chip> : undefined}
                current={current === "credits"}
                icon="✦"
            >
                <p className="text-lg leading-relaxed">
                    Add credit and the storyteller draws on it as you play. You only pay for what is written for
                    you — a conversation turn costs about half a cent.
                </p>
                <p className="mt-3 font-hand text-2xl text-moss-deep leading-tight">
                    {current === "credits" ? "Your wallet is open." : "A new wallet starts with fifty cents, on us."}
                </p>
                <div className="mt-auto pt-5">
                    <Button
                        variant="primary"
                        size="lg"
                        className="w-full"
                        disabled={busy !== null}
                        onClick={chooseWallet}
                    >
                        {busy === "credits" ? "Opening…" : current === "credits" ? "Keep using my wallet" : "Use a wallet"}
                    </Button>
                </div>
            </Choice>

            <Choice title="Your own key" current={current === "byok"} icon="🔑">
                <p className="text-lg leading-relaxed">
                    If you have an OpenAI API key, the storyteller can write with it instead. Nothing is charged here;
                    your OpenAI account pays for what is written.
                </p>
                <p className="mt-3 text-ink-soft">
                    Your key stays on this device only — it is never saved on our side.
                </p>
                <form className="mt-auto pt-5 grid gap-2" onSubmit={useKey}>
                    <label className="grid gap-1">
                        <span className="font-display text-ink-soft">Your OpenAI key</span>
                        <input
                            type="password"
                            value={key}
                            onChange={(event) => {
                                setKey(event.target.value);
                                setRefused(false);
                            }}
                            placeholder="sk-…"
                            autoComplete="off"
                            spellCheck={false}
                            aria-invalid={refused}
                            className={`w-full rounded-md border-2 bg-[#fffaf0] px-3 py-2 text-lg outline-none focus:border-ember ${refused ? "border-rose" : "border-wood/40"}`}
                        />
                    </label>
                    {refused && (
                        <p className="text-rose animate-fade" role="alert">
                            OpenAI did not accept that key. Check it was copied whole, and try again.
                        </p>
                    )}
                    <Button type="submit" variant="quiet" size="lg" className="w-full" disabled={busy !== null || key.trim().length === 0}>
                        {busy === "byok" ? "Checking the key…" : current === "byok" ? "Use this key instead" : "Use my key"}
                    </Button>
                </form>
            </Choice>
        </div>
    );
}

function Choice({ title, badge, current, icon, children }: {
    title: string; badge?: ReactNode; current: boolean; icon: string; children: ReactNode;
}) {
    return (
        <section
            className={`relative flex flex-col rounded-md border p-5 sm:p-6 bg-parchment-deep/50 shadow-card ${current ? "border-moss border-2" : "border-wood/35"}`}
        >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-2xl text-gold" aria-hidden>{icon}</span>
                <h2 className="font-display text-2xl">{title}</h2>
                {badge}
                {current && <Chip tone="moss">your choice now</Chip>}
            </div>
            <div className="mt-3 flex flex-1 flex-col">{children}</div>
        </section>
    );
}
