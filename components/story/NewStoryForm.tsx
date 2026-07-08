"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { createStoryAction } from "@/server/actions/stories";
import { StorybookButton } from "@/components/ui/StorybookButton";
import { QuillLoader } from "@/components/ui/QuillLoader";

type PackOption = {
    id: string;
    name: string;
    description: string;
    targetLanguage: string;
    coverEmoji: string;
};

export function NewStoryForm({ packs }: { packs: PackOption[] }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [playerName, setPlayerName] = useState("");
    const [premiseSeed, setPremiseSeed] = useState("");
    const [selectedPacks, setSelectedPacks] = useState<string[]>([]);

    const selectedLanguage = packs.find((p) => selectedPacks.includes(p.id))?.targetLanguage;

    function togglePack(pack: PackOption) {
        setSelectedPacks((prev) => {
            if (prev.includes(pack.id)) return prev.filter((id) => id !== pack.id);
            // one language per story: picking a pack of another language starts over
            const sameLanguage = packs.some((p) => prev.includes(p.id) && p.targetLanguage === pack.targetLanguage);
            return prev.length === 0 || sameLanguage ? [...prev, pack.id] : [pack.id];
        });
    }

    function submit() {
        if (selectedPacks.length === 0) {
            toast.error("Choose at least one word pack.");
            return;
        }
        startTransition(async () => {
            try {
                const { storyId } = await createStoryAction({
                    playerName: playerName.trim() || "The Wanderer",
                    premiseSeed: premiseSeed.trim(),
                    packIds: selectedPacks,
                });
                router.push(`/story/${storyId}`);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "The book refused to open.");
            }
        });
    }

    if (pending) {
        return (
            <div className="py-10 grid place-items-center">
                <QuillLoader label="preparing the first page…" />
            </div>
        );
    }

    return (
        <div className="grid gap-6">
            <label className="grid gap-1">
                <span className="font-display">Your name in the story</span>
                <input
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    maxLength={40}
                    placeholder="The Wanderer"
                    className="rounded-md border border-wood/50 bg-parchment-deep px-3 py-2 outline-none focus:border-ember"
                />
            </label>

            <div className="grid gap-2">
                <span className="font-display">Which words should the world teach you?</span>
                <div className="grid gap-2">
                    {packs.map((pack) => {
                        const selected = selectedPacks.includes(pack.id);
                        const dimmed = selectedLanguage !== undefined && pack.targetLanguage !== selectedLanguage && !selected;
                        return (
                            <button
                                key={pack.id}
                                type="button"
                                onClick={() => togglePack(pack)}
                                className={`text-left rounded-md border px-4 py-3 transition-colors cursor-pointer
                                    ${selected ? "border-ember bg-gold/20" : "border-wood/40 bg-parchment-deep hover:bg-parchment-dark"}
                                    ${dimmed ? "opacity-50" : ""}`}
                            >
                                <span className="font-display">{pack.coverEmoji} {pack.name}</span>
                                <span className="block text-sm text-ink-soft">{pack.description}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <label className="grid gap-1">
                <span className="font-display">A wish for the story <span className="text-ink-faint text-sm">(optional)</span></span>
                <textarea
                    value={premiseSeed}
                    onChange={(e) => setPremiseSeed(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="a seaside village, a lighthouse that went dark, a talking cat…"
                    className="rounded-md border border-wood/50 bg-parchment-deep px-3 py-2 outline-none focus:border-ember resize-none"
                />
            </label>

            <StorybookButton onClick={submit} className="justify-self-start text-lg px-6">
                ✨ Forge my story
            </StorybookButton>
        </div>
    );
}
