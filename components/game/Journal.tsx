"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { LEVEL_NAMES } from "@/game/dictionary";
import { isLangCode, LANGUAGES } from "@/game/languages";
import type { SatchelWord } from "@/game/payloads";
import toast from "react-hot-toast";
import { abandonQuestAction, satchelAction } from "@/server/actions/game";
import { LangMark } from "@/components/ui/LangMark";
import { Chip, Meter } from "@/components/ui/Panel";
import { StoryText } from "@/components/words/StoryText";
import { mergeCardsAtom, openWordAtom } from "@/components/words/store";
import {
    bookAtom, chapterTurnReadyAtom, chaptersAtom, chronicleAtom, journalAtom, learnerAtom, passagesAtom, questsAtom,
    readingAtom, regionsAtom, type JournalTab,
} from "./state";
import { useGame } from "./useGame";

const TABS: { key: JournalTab; label: string; icon: string }[] = [
    { key: "story", label: "The story", icon: "📖" },
    { key: "quests", label: "Quests", icon: "📜" },
    { key: "words", label: "Words", icon: "✦" },
    { key: "map", label: "Places", icon: "🧭" },
    { key: "chronicle", label: "Chronicle", icon: "🕯️" },
];

const KIND_ICON: Record<string, string> = { talkTo: "💬", persuade: "🎭", defeat: "⚔️", visit: "🧭", inspect: "🔎", learnWords: "✦" };
const REGION_ICON: Record<string, string> = { settlement: "🏘️", wilds: "🌲", depths: "🕳️" };

/** the book itself: everything written so far, and everything it is keeping track of */
export function Journal() {
    const [tab, setTab] = useAtom(journalAtom);
    const book = useAtomValue(bookAtom);

    useEffect(() => {
        if (tab === null) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setTab(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [tab, setTab]);

    if (tab === null || !book) return null;

    return (
        <div className="absolute inset-0 z-40 bg-night/60 backdrop-blur-sm grid place-items-center p-2 sm:p-6 animate-fade" onClick={() => setTab(null)}>
            <div
                className="parchment wood-frame w-full max-w-4xl h-[88dvh] flex flex-col animate-page-in"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-label={book.title}
            >
                <header className="px-4 sm:px-8 pt-4 flex items-start justify-between gap-3">
                    <div>
                        <h2 className="font-display text-3xl leading-tight">{book.title}</h2>
                        <p className="font-hand text-xl text-ink-soft">the tale of {book.playerName}</p>
                    </div>
                    <button type="button" onClick={() => setTab(null)} className="text-3xl leading-none text-ink-faint hover:text-ink cursor-pointer" aria-label="Close the book">×</button>
                </header>

                <nav className="px-2 sm:px-6 mt-2 flex gap-1 overflow-x-auto border-b border-wood/30" role="tablist">
                    {TABS.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            role="tab"
                            aria-selected={tab === t.key}
                            onClick={() => setTab(t.key)}
                            className={`px-3 sm:px-4 py-1.5 font-display text-lg whitespace-nowrap cursor-pointer rounded-t-md border border-b-0 transition-colors ${tab === t.key ? "bg-[#fffaf0]/80 border-wood/30 text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
                        >
                            <span className="mr-1.5" aria-hidden>{t.icon}</span>{t.label}
                        </button>
                    ))}
                </nav>

                <div className="flex-1 overflow-y-auto scroll-ink px-4 sm:px-8 py-4">
                    {tab === "story" && <Story />}
                    {tab === "quests" && <Quests />}
                    {tab === "words" && <Words />}
                    {tab === "map" && <Places />}
                    {tab === "chronicle" && <Chronicle />}
                </div>
            </div>
        </div>
    );
}

function Story() {
    const book = useAtomValue(bookAtom);
    const chapters = useAtomValue(chaptersAtom);
    const passages = useAtomValue(passagesAtom);
    const learner = useAtomValue(learnerAtom);
    const setReading = useSetAtom(readingAtom);
    const setTab = useSetAtom(journalAtom);
    const game = useGame();
    const gloss = (learner?.immersion ?? 0) >= 3 ? "peek" as const : "below" as const;

    return (
        <div className="max-w-2xl mx-auto">
            <p className="text-ink-soft italic leading-relaxed mb-6">{book?.premise}</p>
            {chapters.map((chapter) => {
                const pages = passages.filter((p) => p.chapterIndex === chapter.index);
                return (
                    <section key={chapter.id} className="mb-8">
                        <h3 className="font-display text-2xl text-center">
                            <span className="block font-hand text-lg text-ember-deep">chapter {chapter.index}</span>
                            {chapter.title}
                        </h3>
                        {chapter.summary && <p className="text-center text-sm text-ink-soft italic mt-1 mb-3">{chapter.summary}</p>}
                        <div className="mt-3">
                            {pages.map((page, i) => {
                                const open = page.choices && page.chosenKey === null;
                                const taken = page.choices?.find((c) => c.key === page.chosenKey);
                                return (
                                    <div key={page.id} className="mb-4">
                                        <p className={`prose-story ${i === 0 ? "drop-cap" : ""}`}>
                                            <StoryText segments={page.segments} gloss={gloss} />
                                        </p>
                                        {taken && (
                                            <p className="font-hand text-lg text-ink-soft mt-1 pl-4 border-l-2 border-gold/60">
                                                you chose: <StoryText segments={taken.label} />
                                            </p>
                                        )}
                                        {open && (
                                            <button
                                                type="button"
                                                className="mt-1 font-hand text-lg text-ember-deep underline underline-offset-2 cursor-pointer"
                                                onClick={() => {
                                                    setTab(null);
                                                    setReading(page);
                                                    game.setMode("reading");
                                                }}
                                            >
                                                this moment still waits for your choice →
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                            {pages.length === 0 && <p className="text-center text-ink-faint italic">these pages are still blank</p>}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function Quests() {
    const book = useAtomValue(bookAtom);
    const [quests, setQuests] = useAtom(questsAtom);
    const setTurnReady = useSetAtom(chapterTurnReadyAtom);
    /** the quest the reader has asked to give up, until they say they mean it */
    const [letting, setLetting] = useState<string | null>(null);
    const active = quests.filter((q) => q.status === "active");
    const past = quests.filter((q) => q.status !== "active");

    async function letGo(questId: string) {
        setLetting(null);
        if (!book) return;
        const result = await abandonQuestAction(book.id, questId);
        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        setQuests(result.data.quests);
        setTurnReady(result.data.chapterTurnReady);
        toast("You let it go. The story will find another way.", { icon: "🍃", duration: 5000 });
    }

    const card = (quest: (typeof quests)[number]) => (
        <article key={quest.id} className={`rounded-md border border-wood/30 bg-[#fffaf0]/60 px-4 py-3 ${quest.status !== "active" ? "opacity-70" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
                <h4 className="font-display text-xl leading-tight">{quest.title}</h4>
                {quest.status === "completed" && <Chip tone="moss">done</Chip>}
                {quest.status === "failed" && <Chip tone="ember">lost</Chip>}
            </div>
            {quest.giverName && <p className="text-sm text-ink-faint">from {quest.giverName}</p>}
            <p className="text-ink-soft mt-1 leading-snug">{quest.description}</p>
            <ul className="mt-2 grid gap-1">
                {quest.objectives.map((o) => (
                    <li key={o.id} className={`flex gap-2 leading-snug ${o.status === "completed" ? "text-ink-faint line-through" : o.status === "failed" ? "text-rose line-through" : o.waiting ? "text-ink-faint" : ""}`}>
                        <span aria-hidden>{o.status === "completed" ? "✓" : KIND_ICON[o.kind] ?? "•"}</span>
                        <span>
                            {o.waiting && <span className="italic">then: </span>}
                            {o.description}
                            {o.targetCount > 1 && <span className="text-ink-faint"> ({o.progress}/{o.targetCount})</span>}
                            {o.whereName && o.status === "active" && <span className="text-ink-faint"> — in {o.whereName}</span>}
                            {o.kind === "learnWords" && o.status === "active" && (
                                <span className="block text-sm text-ink-faint no-underline">
                                    A word is learned the first time you get it right: in a battle, in the study hall, or by using it when you speak.
                                </span>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
            {quest.status === "active" && (
                <p className="mt-2 text-right text-sm text-ink-faint">
                    {letting === quest.id ? (
                        <>
                            Give this quest up for good?{" "}
                            <button type="button" className="underline underline-offset-2 cursor-pointer text-rose hover:text-ink" onClick={() => void letGo(quest.id)}>yes, let it go</button>
                            {" · "}
                            <button type="button" className="underline underline-offset-2 cursor-pointer hover:text-ink" onClick={() => setLetting(null)}>no, keep it</button>
                        </>
                    ) : (
                        <button type="button" className="underline underline-offset-2 cursor-pointer hover:text-ink" onClick={() => setLetting(quest.id)}>let this quest go</button>
                    )}
                </p>
            )}
        </article>
    );

    return (
        <div className="max-w-2xl mx-auto grid gap-3">
            {active.length === 0 && <p className="text-center text-ink-soft italic py-4">Nothing is asked of you just now. The world is yours to wander.</p>}
            {active.map(card)}
            {past.length > 0 && <h3 className="font-hand text-xl text-ink-soft mt-4">behind you</h3>}
            {past.map(card)}
        </div>
    );
}

function Words() {
    const book = useAtomValue(bookAtom);
    const learner = useAtomValue(learnerAtom);
    const merge = useSetAtom(mergeCardsAtom);
    const open = useSetAtom(openWordAtom);
    const [words, setWords] = useState<SatchelWord[] | null>(null);
    const lang = book && isLangCode(book.targetLanguage) ? book.targetLanguage : null;

    useEffect(() => {
        if (!lang) return;
        let cancelled = false;
        satchelAction(lang, "all").then((result) => {
            if (cancelled || !result.ok) return;
            merge(result.data.words);
            setWords(result.data.words);
        });
        return () => {
            cancelled = true;
        };
    }, [lang, merge]);

    if (!lang || !learner) return null;
    const language = LANGUAGES[lang];

    return (
        <div className="max-w-3xl mx-auto">
            <div className="rounded-md border border-wood/30 bg-[#fffaf0]/60 px-4 py-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                    <div className="font-display text-2xl flex items-center gap-2"><LangMark code={lang} size="sm" /> {language.name} · {learner.immersionName}</div>
                    <p className="text-sm text-ink-soft">
                        {learner.wordsKnown} words known · {learner.wordsMet} met · {learner.wordsDue} due for review · {learner.xp} xp
                        {learner.streakDays > 1 && ` · ${learner.streakDays} days running`}
                    </p>
                    <Meter value={learner.toNext} className="mt-2 max-w-xs" />
                    <p className="text-xs text-ink-faint mt-1">
                        {learner.immersion < 5 ? "as you learn, more of the book is written in the language itself" : "the book is written in the language itself"}
                    </p>
                </div>
                <Link href="/study" className="font-display rounded-md border-b-4 px-4 py-2 bg-moss text-parchment border-moss-deep hover:bg-moss-deep text-center">
                    Practise in the study hall
                </Link>
            </div>

            <div className="mt-4 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {words === null && <p className="col-span-full font-hand text-xl text-ink-soft">opening your satchel…</p>}
                {words?.length === 0 && <p className="col-span-full text-ink-soft italic">Your satchel is empty. Tap any word of {language.name} you meet to look at it.</p>}
                {words?.map((word) => (
                    <button
                        key={word.id}
                        type="button"
                        onClick={() => open({ id: word.id, surface: null })}
                        className="text-left rounded-md border border-wood/30 bg-[#fffaf0]/60 hover:bg-[#fffaf0] px-3 py-2 cursor-pointer transition-colors"
                    >
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-lg text-ember-deep break-words">{word.lemma}</span>
                            {word.due && <span className="text-xs text-rose whitespace-nowrap">due</span>}
                        </div>
                        <div className="text-sm text-ink-soft leading-snug line-clamp-2">{word.gloss}</div>
                        <div className="mt-1 flex items-center gap-1" aria-label={`mastery ${word.mastery} of 5`}>
                            {Array.from({ length: 5 }, (_, i) => (
                                <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < word.mastery ? "bg-moss" : "bg-ink/15"}`} />
                            ))}
                            {word.level <= 5 && <span className="ml-auto text-[0.65rem] text-ink-faint">{LEVEL_NAMES[word.level]}</span>}
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

function Places() {
    const regions = useAtomValue(regionsAtom);
    return (
        <div className="max-w-xl mx-auto grid gap-2">
            <p className="text-ink-soft italic text-center mb-2">The places of this book. Gates at the edge of each lead to the next.</p>
            {regions.map((region, i) => (
                <div key={region.id}>
                    {i > 0 && <div className="text-center text-ink-faint leading-none py-1" aria-hidden>⋮</div>}
                    <div className={`rounded-md border px-4 py-3 flex items-center gap-3 ${region.current ? "border-ember bg-ember/10" : "border-wood/30 bg-[#fffaf0]/60"} ${region.visited ? "" : "opacity-60"}`}>
                        <span className="text-2xl" aria-hidden>{REGION_ICON[region.kind] ?? "📍"}</span>
                        <div className="flex-1">
                            <div className="font-display text-xl leading-tight">{region.visited ? region.name : "somewhere not yet seen"}</div>
                            <div className="text-sm text-ink-soft">{region.visited ? `${region.kind} · ${region.biome}` : "you have heard of it"}</div>
                        </div>
                        {region.current && <Chip tone="ember">you are here</Chip>}
                    </div>
                </div>
            ))}
        </div>
    );
}

function Chronicle() {
    const entries = useAtomValue(chronicleAtom);
    return (
        <div className="max-w-2xl mx-auto">
            <p className="text-ink-soft italic text-center mb-3">What has happened, as the world remembers it.</p>
            <ol className="grid gap-2 border-l-2 border-gold/50 pl-4">
                {entries.map((entry) => (
                    <li key={entry.id} className="leading-snug">
                        <span className="block text-xs text-ink-faint">{new Date(entry.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        {entry.summary}
                    </li>
                ))}
            </ol>
        </div>
    );
}
