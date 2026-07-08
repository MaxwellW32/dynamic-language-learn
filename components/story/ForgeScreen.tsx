"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { forgeStatusAction, runForgeAction } from "@/server/actions/stories";
import { Parchment } from "@/components/ui/Parchment";
import { StorybookButton } from "@/components/ui/StorybookButton";

/**
 * Shown while the world is being written. Kicks the forge off once,
 * polls for the storyteller's progress notes, and turns the page when done.
 */
export function ForgeScreen({ storyId, initialNote }: { storyId: string; initialNote: string }) {
    const router = useRouter();
    const [note, setNote] = useState(initialNote);
    const [failed, setFailed] = useState(initialNote === "failed");
    const kicked = useRef(false);

    useEffect(() => {
        if (kicked.current) return;
        kicked.current = true;
        runForgeAction(storyId).catch(() => setFailed(true));
    }, [storyId]);

    useEffect(() => {
        const timer = setInterval(async () => {
            try {
                const status = await forgeStatusAction(storyId);
                if (status.status !== "forging") {
                    clearInterval(timer);
                    router.refresh();
                    return;
                }
                setFailed(status.forgeNote === "failed");
                if (status.forgeNote && status.forgeNote !== "failed") setNote(status.forgeNote);
            } catch {
                // keep polling — transient errors shouldn't kill the screen
            }
        }, 2500);
        return () => clearInterval(timer);
    }, [storyId, router]);

    return (
        <main className="min-h-dvh grid place-items-center px-6">
            <Parchment framed className="max-w-md w-full p-10 text-center">
                {failed ? (
                    <>
                        <span className="text-4xl">🕯️</span>
                        <h1 className="font-display text-2xl mt-3 mb-2">The candle guttered…</h1>
                        <p className="text-ink-soft mb-6">The world could not be finished. No page was wasted — try again.</p>
                        <StorybookButton
                            onClick={() => {
                                setFailed(false);
                                setNote("Summoning the storyteller…");
                                runForgeAction(storyId).catch(() => setFailed(true));
                            }}
                        >
                            Relight the forge
                        </StorybookButton>
                    </>
                ) : (
                    <>
                        <span className="text-4xl animate-flicker inline-block">🕯️</span>
                        <h1 className="font-display text-2xl mt-3 mb-2">Your story is being written</h1>
                        <p className="font-hand text-2xl text-ember-deep min-h-8">{note || "Summoning the storyteller…"}</p>
                        <p className="text-ink-faint text-sm mt-6">maps are drawn, villagers named, quests plotted — a minute or two</p>
                    </>
                )}
            </Parchment>
        </main>
    );
}
