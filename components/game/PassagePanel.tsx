"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import toast from "react-hot-toast";
import { segmentsToPlainText } from "@/game/segments";
import { Button } from "@/components/ui/Button";
import { StoryText } from "@/components/words/StoryText";
import { speakLine, useSpeaking } from "@/components/words/useSpeech";
import { bookAtom, chaptersAtom, learnerAtom, modeAtom, queueAtom, readingAtom } from "./state";
import { useGame } from "./useGame";

/**
 * A page of the book, laid over the world. New pages appear here as the
 * storyteller writes them; when several were written at one sitting they are
 * read one after another.
 */
export function PassagePanel() {
    const passage = useAtomValue(readingAtom);
    const queue = useAtomValue(queueAtom);
    const mode = useAtomValue(modeAtom);
    const book = useAtomValue(bookAtom);
    const chapters = useAtomValue(chaptersAtom);
    const learner = useAtomValue(learnerAtom);
    const speaking = useSpeaking();
    const game = useGame();

    const open = passage !== null && mode === "reading";

    // Enter or Space reads on
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            const typing = (event.target as HTMLElement | null)?.tagName === "INPUT";
            if (!typing && (event.key === "Enter" || event.key === " " || event.key === "Escape")) {
                event.preventDefault();
                game.closeReading();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, game]);

    if (!open || !passage || !book) return null;

    const chapter = chapters.find((c) => c.index === passage.chapterIndex);
    const text = segmentsToPlainText(passage.segments);
    const lineKey = `line:narrator:${text}`;

    return (
        <section className="absolute inset-x-0 bottom-0 z-30 px-3 pb-3 sm:pb-6 flex justify-center pointer-events-none" aria-live="polite">
            <div key={passage.id} className="page-float pointer-events-auto w-full max-w-3xl max-h-[62dvh] overflow-y-auto scroll-ink px-5 sm:px-8 py-5 animate-rise">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="font-hand text-xl text-ember-deep">
                        {passage.kind === "discovery" ? "a discovery" : chapter ? `chapter ${chapter.index} · ${chapter.title}` : "the story"}
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

                <div className="mt-4 flex items-center justify-end gap-3">
                    {queue.length > 0 && (
                        <span className="font-hand text-lg text-ink-soft">
                            {queue.length === 1 ? "one more page" : `${queue.length} more pages`}
                        </span>
                    )}
                    <Button variant="primary" onClick={game.closeReading}>{queue.length > 0 ? "Read on" : "Go on"}</Button>
                </div>
            </div>
        </section>
    );
}
