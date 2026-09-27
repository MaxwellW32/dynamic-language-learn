"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import toast from "react-hot-toast";
import { segmentsToPlainText } from "@/game/segments";
import { Button } from "@/components/ui/Button";
import { StoryText } from "@/components/words/StoryText";
import { speakLine, useSpeaking } from "@/components/words/useSpeech";
import { bookAtom, busyAtom, chaptersAtom, learnerAtom, modeAtom, readingAtom } from "./state";
import { useGame } from "./useGame";

const TONE_ICON: Record<string, string> = {
    bold: "🔥", brave: "🔥", kind: "🌿", gentle: "🌿", curious: "🔎", cautious: "🕯️", wary: "🕯️",
    playful: "🎈", clever: "🦊", patient: "⏳", honest: "🤝",
};

/**
 * A page of the book, laid over the world. New pages appear here as they are
 * written; if the page ends at a fork, the ways on are offered beneath it.
 */
export function PassagePanel() {
    const passage = useAtomValue(readingAtom);
    const mode = useAtomValue(modeAtom);
    const book = useAtomValue(bookAtom);
    const chapters = useAtomValue(chaptersAtom);
    const learner = useAtomValue(learnerAtom);
    const busy = useAtomValue(busyAtom);
    const speaking = useSpeaking();
    const game = useGame();

    const open = passage !== null && mode === "reading";
    const fork = passage?.choices && passage.chosenKey === null ? passage.choices : null;

    // Enter or Space turns on, unless the page is waiting for a choice
    useEffect(() => {
        if (!open || fork) return;
        const onKey = (event: KeyboardEvent) => {
            const typing = (event.target as HTMLElement | null)?.tagName === "INPUT";
            if (!typing && (event.key === "Enter" || event.key === " " || event.key === "Escape")) {
                event.preventDefault();
                game.closeReading();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, fork, game]);

    if (!open || !passage || !book) return null;

    const chapter = chapters.find((c) => c.index === passage.chapterIndex);
    const text = segmentsToPlainText(passage.segments);
    const lineKey = `line:narrator:${text}`;

    return (
        <section className="absolute inset-x-0 bottom-0 z-30 px-3 pb-3 sm:pb-6 flex justify-center pointer-events-none" aria-live="polite">
            <div className="page-float pointer-events-auto w-full max-w-3xl max-h-[62dvh] overflow-y-auto scroll-ink px-5 sm:px-8 py-5 animate-rise">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="font-hand text-xl text-ember-deep">
                        {passage.kind === "discovery" ? "a discovery" : passage.kind === "event" ? "the story moves" : chapter ? `chapter ${chapter.index} · ${chapter.title}` : "the story"}
                    </span>
                    <button
                        type="button"
                        onClick={() => speakLine(book.id, text).catch((error) => toast.error(error instanceof Error ? error.message : "The voice faded away."))}
                        className={`text-lg cursor-pointer rounded-full w-9 h-9 grid place-items-center hover:bg-ink/10 ${speaking === lineKey ? "animate-glint" : ""}`}
                        aria-label="Read this page aloud"
                        title="Read aloud"
                    >
                        🔊
                    </button>
                </div>

                <p className={`prose-story ${passage.kind === "narration" ? "drop-cap" : ""}`}>
                    <StoryText segments={passage.segments} gloss={(learner?.immersion ?? 0) >= 3 ? "peek" : "below"} />
                </p>

                {fork ? (
                    <div className="mt-4 grid gap-2">
                        <p className="font-hand text-xl text-ink-soft">what do you do?</p>
                        {fork.map((choice) => (
                            <button
                                key={choice.key}
                                type="button"
                                disabled={busy !== null}
                                onClick={() => void game.choose(passage.id, choice.key)}
                                className="text-left rounded-md border-2 border-wood/30 bg-parchment-deep/70 hover:border-ember/70 hover:bg-parchment-deep px-4 py-2.5 text-lg cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-wait"
                            >
                                <span className="mr-2" aria-hidden>{TONE_ICON[choice.tone.toLowerCase()] ?? "➳"}</span>
                                <StoryText segments={choice.label} />
                                <span className="ml-2 text-sm text-ink-faint italic">{choice.tone}</span>
                            </button>
                        ))}
                        <button type="button" onClick={game.closeReading} className="justify-self-end text-sm text-ink-faint underline underline-offset-2 cursor-pointer hover:text-ink">
                            decide later
                        </button>
                    </div>
                ) : (
                    <div className="mt-4 flex justify-end">
                        <Button variant="primary" onClick={game.closeReading}>Go on</Button>
                    </div>
                )}
            </div>
        </section>
    );
}
