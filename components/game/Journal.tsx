"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import toast from "react-hot-toast";
import { turnChapterAction } from "@/server/actions/stories";
import { StorybookButton } from "@/components/ui/StorybookButton";
import { QuillLoader } from "@/components/ui/QuillLoader";
import { SegmentText } from "./SegmentText";
import {
    busyAtom, chapterTurnReadyAtom, chaptersAtom, chronicleAtom, mergeWordsAtom,
    passagesAtom, questsAtom, satchelAtom, storyInfoAtom,
} from "./state";

const TABS = ["Story", "Words", "Chronicle"] as const;
type Tab = (typeof TABS)[number];

/** the right-hand page: the book's text and its ribbon-tabbed journal */
export function Journal() {
    const [tab, setTab] = useState<Tab>("Story");
    return (
        <div className="h-full min-h-0 flex flex-col">
            <nav className="flex gap-1 px-2">
                {TABS.map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`font-display text-sm px-3 py-1.5 rounded-t-md border border-b-0 cursor-pointer transition-colors
                            ${tab === t ? "bg-parchment border-wood/50 text-ink" : "bg-parchment-dark/70 border-transparent text-ink-soft hover:text-ink"}`}
                    >
                        {t}
                    </button>
                ))}
            </nav>
            <div className="parchment rounded-sm flex-1 min-h-0 relative shadow-card">
                {tab === "Story" && <StoryTab />}
                {tab === "Words" && <WordsTab />}
                {tab === "Chronicle" && <ChronicleTab />}
            </div>
        </div>
    );
}

function StoryTab() {
    const story = useAtomValue(storyInfoAtom);
    const chapters = useAtomValue(chaptersAtom);
    const passages = useAtomValue(passagesAtom);
    const [chapterTurnReady, setChapterTurnReady] = useAtom(chapterTurnReadyAtom);
    const setChapters = useSetAtom(chaptersAtom);
    const setPassages = useSetAtom(passagesAtom);
    const setQuests = useSetAtom(questsAtom);
    const mergeWords = useSetAtom(mergeWordsAtom);
    const busy = useAtomValue(busyAtom);
    const [pending, startTransition] = useTransition();
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [passages.length]);

    const currentChapter = chapters[chapters.length - 1];

    function turnPage() {
        if (!story || pending) return;
        startTransition(async () => {
            try {
                const result = await turnChapterAction(story.id);
                mergeWords(result.words);
                setChapters((prev) => [
                    ...prev.slice(0, -1),
                    result.closedChapter,
                    result.newChapter,
                ]);
                setPassages((prev) => [...prev, result.passage]);
                setQuests(result.quests);
                setChapterTurnReady(false);
                if (result.storyCompleted) {
                    toast("📕 The story is complete. Well adventured!", { duration: 8000 });
                } else {
                    toast(`📖 Chapter ${result.newChapter.index}: ${result.newChapter.title}`, { duration: 6000 });
                }
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "The page would not turn.");
            }
        });
    }

    return (
        <div className="absolute inset-0 overflow-y-auto scroll-ink px-6 py-5">
            {currentChapter && (
                <header className="text-center mb-4">
                    <p className="font-hand text-xl text-ink-faint">chapter {currentChapter.index}</p>
                    <h2 className="font-display text-3xl">{currentChapter.title}</h2>
                    <div className="mx-auto mt-2 h-px w-24 bg-wood/40" />
                </header>
            )}

            <div className="prose-story">
                {passages.map((passage, i) => (
                    <p key={passage.id} className={`animate-page-in ${i === 0 ? "drop-cap" : ""} ${passage.kind === "discovery" ? "italic text-ink-soft" : ""}`}>
                        <SegmentText segments={passage.segments} />
                    </p>
                ))}
            </div>

            {pending && (
                <div className="mt-6 grid place-items-center">
                    <QuillLoader label="the page is turning…" />
                </div>
            )}
            {busy && !pending && (
                <div className="mt-6 grid place-items-center">
                    <QuillLoader label={busy} />
                </div>
            )}

            {chapterTurnReady && !pending && story?.status === "active" && (
                <div className="mt-8 grid place-items-center">
                    <StorybookButton onClick={turnPage} className="text-lg px-6">
                        📖 Turn the page
                    </StorybookButton>
                    <p className="font-hand text-xl text-ink-soft mt-2">this chapter&apos;s tales are told…</p>
                </div>
            )}

            {story?.status === "completed" && (
                <p className="text-center font-display text-2xl text-moss-deep mt-8">~ The End ~</p>
            )}

            <div ref={bottomRef} />
        </div>
    );
}

/** mirrors the server's immersion ladder for display (thresholds in learning.ts) */
function immersionTitle(retained: number): { title: string; next: number | null } {
    if (retained >= 120) return { title: "Storyteller", next: null };
    if (retained >= 50) return { title: "Speaker", next: 120 };
    if (retained >= 15) return { title: "Wanderer", next: 50 };
    return { title: "Newcomer", next: 15 };
}

function WordsTab() {
    const satchel = useAtomValue(satchelAtom);
    const retained = satchel.filter((w) => w.mastery >= 2).length;
    const { title, next } = immersionTitle(retained);

    return (
        <div className="absolute inset-0 overflow-y-auto scroll-ink px-5 py-4">
            <p className="font-hand text-2xl text-ink-soft mb-1">
                your word-satchel — {satchel.length} {satchel.length === 1 ? "word" : "words"} gathered
            </p>
            <p className="text-sm text-ink-faint mb-3">
                Immersion: <span className="text-ember-deep font-semibold">{title}</span>
                {next !== null
                    ? ` — hold on to ${next - retained} more ${next - retained === 1 ? "word" : "words"} and the book will translate a little less.`
                    : " — the book barely translates for you anymore."}
            </p>
            {satchel.length === 0 && (
                <p className="text-ink-soft">Words you meet in the story and in battle will gather here.</p>
            )}
            <div className="grid gap-2">
                {satchel.map((word) => (
                    <div key={word.id} className="rounded-md border border-wood/40 bg-parchment-deep/60 px-3 py-2 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                            <span className="font-semibold text-lg">{word.term}</span>
                            {word.pronunciation && <span className="text-ink-faint text-sm ml-2">{word.pronunciation}</span>}
                            <span className="block text-ink-soft text-sm">{word.meaning}</span>
                        </div>
                        <div className="text-right">
                            <span title={`mastery ${word.mastery} of 5`}>
                                {"🪶".repeat(Math.max(1, word.mastery))}
                            </span>
                            {word.due && <span className="block text-xs text-ember-deep">ready to review</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ChronicleTab() {
    const chronicle = useAtomValue(chronicleAtom);
    return (
        <div className="absolute inset-0 overflow-y-auto scroll-ink px-5 py-4">
            <p className="font-hand text-2xl text-ink-soft mb-3">the chronicle — everything the world remembers</p>
            {chronicle.length === 0 && <p className="text-ink-soft">Nothing has happened yet. Change that.</p>}
            <ul className="grid gap-2">
                {chronicle.map((entry) => (
                    <li key={entry.id} className="text-sm text-ink-soft border-l-2 border-gold/60 pl-3">
                        {entry.summary}
                    </li>
                ))}
            </ul>
        </div>
    );
}
