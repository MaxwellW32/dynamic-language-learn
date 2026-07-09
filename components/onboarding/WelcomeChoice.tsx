"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { setBillingModeAction, validateByokKeyAction } from "@/server/actions/billing";
import { storeByokKey } from "@/lib/byok";
import { StorybookButton } from "@/components/ui/StorybookButton";
import { QuillLoader } from "@/components/ui/QuillLoader";

export function WelcomeChoice({
    currentMode,
    starterSparks,
}: {
    currentMode: "byok" | "credits" | null;
    starterSparks: number;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    // straight to key entry when a BYOK player needs to re-add their key on a new device
    const [panel, setPanel] = useState<"choose" | "byok">(currentMode === "byok" ? "byok" : "choose");
    const [key, setKey] = useState("");

    function chooseSparks() {
        startTransition(async () => {
            try {
                await setBillingModeAction("credits");
                toast(`✨ ${starterSparks} sparks — a gift to begin with`, { duration: 5000 });
                router.push("/");
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Something snagged.");
            }
        });
    }

    function saveKey() {
        const trimmed = key.trim();
        if (trimmed.length < 20) {
            toast.error("That doesn't look like an OpenAI key.");
            return;
        }
        startTransition(async () => {
            try {
                const { valid } = await validateByokKeyAction(trimmed);
                if (!valid) {
                    toast.error("OpenAI didn't accept that key — check it and try again.");
                    return;
                }
                storeByokKey(trimmed);
                await setBillingModeAction("byok");
                toast("🔑 Key saved — on this device only.", { duration: 5000 });
                router.push("/");
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Something snagged.");
            }
        });
    }

    if (pending) {
        return (
            <div className="py-8 grid place-items-center">
                <QuillLoader label="lighting the lantern…" />
            </div>
        );
    }

    if (panel === "byok") {
        return (
            <div className="grid gap-4">
                <div className="rounded-md border border-wood/40 bg-parchment-deep/60 p-4 text-sm text-ink-soft leading-relaxed">
                    <p className="font-display text-base text-ink mb-1">🔑 Your own OpenAI key</p>
                    <p>
                        Your key is kept <strong>only on this device</strong> (browser storage) — it never
                        touches our database. It travels encrypted with each request, is used for that one
                        moment of storytelling, and you pay OpenAI directly at cost. Create a key at
                        platform.openai.com → API keys. If you clear your browser or switch devices,
                        we&apos;ll simply ask for it again.
                    </p>
                </div>
                <div className="flex gap-2">
                    <input
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        type="password"
                        placeholder="sk-…"
                        className="flex-1 rounded-md border border-wood/50 bg-parchment-deep px-3 py-2 outline-none focus:border-ember font-mono text-sm"
                    />
                    <StorybookButton onClick={saveKey} disabled={key.trim().length === 0}>
                        Test &amp; save
                    </StorybookButton>
                </div>
                {currentMode !== "byok" && (
                    <button
                        onClick={() => setPanel("choose")}
                        className="justify-self-start text-ink-soft hover:text-ink underline underline-offset-4 cursor-pointer text-sm"
                    >
                        ← back to the choices
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-md border-2 border-ember/60 bg-gold/10 p-5 flex flex-col gap-3">
                <h2 className="font-display text-xl">✨ Wordbound sparks</h2>
                <p className="text-sm text-ink-soft leading-relaxed flex-1">
                    The simple way: we carry the lantern. Story moments spend sparks
                    (a page of story ≈ 2 sparks, forging a whole new world ≈ 30). Start
                    with <strong>{starterSparks} free sparks</strong>, top up whenever you
                    like, and we&apos;ll nudge you before you run low.
                </p>
                <StorybookButton onClick={chooseSparks}>
                    Begin with {starterSparks} free sparks
                </StorybookButton>
            </div>

            <div className="rounded-md border border-wood/40 bg-parchment-deep/50 p-5 flex flex-col gap-3">
                <h2 className="font-display text-xl">🔑 Bring your own key</h2>
                <p className="text-sm text-ink-soft leading-relaxed flex-1">
                    For OpenAI account holders: use your own API key and pay OpenAI
                    directly at cost — no sparks, no limits from us. The key stays on
                    your device and never touches our servers&apos; storage.
                </p>
                <StorybookButton variant="quiet" onClick={() => setPanel("byok")}>
                    Use my own key
                </StorybookButton>
            </div>
        </div>
    );
}
