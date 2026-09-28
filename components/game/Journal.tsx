"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { LEVEL_NAMES } from "@/game/dictionary";
import { isLangCode, LANGUAGES } from "@/game/languages";
import type { SatchelWord } from "@/game/payloads";
import { satchelAction } from "@/server/actions/game";
import { LangMark } from "@/components/ui/LangMark";
import { Chip, Meter } from "@/components/ui/Panel";
import { StoryText } from "@/components/words/StoryText";
import { mergeCardsAtom, openWordAtom } from "@/components/words/store";
import { GOAL_ICON } from "./Hud";
import {
    bookAtom, chaptersAtom, chronicleAtom, journalAtom, learnerAtom, modeAtom, passagesAtom, peopleAtom,
    regionsAtom, storyAtom, type JournalTab,
} from "./state";
import { useGame } from "./useGame";

const TABS: { key: JournalTab; label: string; icon: string }[] = [
    { key: "story", label: "The story", icon: "📖" },
    { key: "goals", label: "Goals", icon: "📜" },
    { key: "people", label: "People", icon: "✉️" },
    { key: "words", label: "Words", icon: "✦" },
    { key: "map", label: "Places", icon: "🧭" },
    { key: "chronicle", label: "Chronicle", icon: "🕯️" },
];

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
                            aria-label={t.label}
                            title={t.label}
                            // never squeezed: six tabs on a phone scroll sideways, and only the open one spells out its name
                            className={`shrink-0 px-3 sm:px-4 py-1.5 font-display text-lg whitespace-nowrap cursor-pointer rounded-t-md border border-b-0 transition-colors ${tab === t.key ? "bg-[#fffaf0]/80 border-wood/30 text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
                        >
                            <span aria-hidden>{t.icon}</span>
                            <span className={`ml-1.5 ${tab === t.key ? "" : "hidden sm:inline"}`}>{t.label}</span>
                        </button>
                    ))}
                </nav>

                <div className="flex-1 overflow-y-auto scroll-ink px-4 sm:px-8 py-4">
                    {tab === "story" && <Story />}
                    {tab === "goals" && <Goals />}
                    {tab === "people" && <People />}
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
                            {pages.map((page, i) => (
                                <div key={page.id} className="mb-4">
                                    <p className={`prose-story ${i === 0 ? "drop-cap" : ""}`}>
                                        <StoryText segments={page.segments} gloss={gloss} />
                                    </p>
                                </div>
                            ))}
                            {pages.length === 0 && <p className="text-center text-ink-faint italic">these pages are still blank</p>}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

/** what the chapter in hand asks: a checklist, taken one thing at a time */
function Goals() {
    const story = useAtomValue(storyAtom);
    const book = useAtomValue(bookAtom);
    if (!story || !book) return null;
    const inHand = story.goals.find((goal) => goal.status === "active");
    const behind = story.goals.filter((goal) => goal.status !== "active");

    return (
        <div className="max-w-2xl mx-auto grid gap-4">
            <header className="text-center">
                <span className="block font-hand text-lg text-ember-deep">chapter {story.chapter.index} of {story.chapter.of}</span>
                <h3 className="font-display text-2xl">{story.chapter.title}</h3>
            </header>

            {inHand ? (
                <article className="rounded-md border-2 border-gold/70 bg-gold/10 px-4 py-3">
                    <p className="text-sm text-ink-faint">in hand</p>
                    <h4 className="font-display text-xl leading-tight">
                        <span className="mr-2" aria-hidden>{GOAL_ICON[inHand.kind] ?? "•"}</span>{inHand.title}
                    </h4>
                    <p className="text-ink-soft mt-1 leading-snug">
                        {HOW[inHand.kind]}
                        {inHand.whereName && <> It is in <span className="text-ink">{inHand.whereName}</span>: the gate to leave by is marked.</>}
                    </p>
                </article>
            ) : (
                <p className="text-center text-ink-soft italic py-2">
                    {book.status === "completed" ? "The book is told. The world is still yours to wander."
                        : story.due === "turn" ? "Everything this chapter asked is settled. Turn the page when you are ready."
                        : story.due !== null ? "The storyteller is writing what comes next."
                        : "Nothing is asked of you just now."}
                </p>
            )}

            {story.ahead > 0 && (
                <p className="text-center text-sm text-ink-faint">
                    {story.ahead === 1 ? "One more thing" : `${story.ahead} more things`} will be asked before the chapter ends. One at a time.
                </p>
            )}

            {behind.length > 0 && (
                <section>
                    <h4 className="font-hand text-xl text-ink-soft">behind you in this chapter</h4>
                    <ul className="mt-1 grid gap-2">
                        {[...behind].reverse().map((goal) => (
                            <li key={goal.id} className="rounded-md border border-wood/30 bg-[#fffaf0]/60 px-4 py-2 flex gap-3">
                                <span aria-hidden className="text-lg">{goal.status === "failed" ? "🍃" : "✓"}</span>
                                <div className="leading-snug">
                                    <span className={`font-display text-lg ${goal.status === "failed" ? "line-through decoration-rose/60 text-ink-soft" : ""}`}>{goal.title}</span>
                                    {goal.status === "failed" && <Chip tone="ember" className="ml-2 align-middle">did not come off</Chip>}
                                    {goal.outcome && <p className="text-ink-soft text-sm">{goal.outcome}</p>}
                                    {goal.status === "failed" && <p className="font-hand text-base text-ink-soft">The story found another way.</p>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section>
                <h4 className="font-hand text-xl text-ink-soft">what you carry</h4>
                {story.carrying.length === 0
                    ? <p className="text-ink-faint italic">Nothing yet but your own two feet.</p>
                    : (
                        <ul className="mt-1 flex flex-wrap gap-2">
                            {story.carrying.map((thing) => (
                                <li key={thing} className="rounded-full border border-wood/40 bg-[#fffaf0]/70 px-3 py-0.5">{thing}</li>
                            ))}
                        </ul>
                    )}
            </section>
        </div>
    );
}

const HOW: Record<string, string> = {
    visit: "Walk there: a column of light marks the place.",
    talk: "Find them and hear what they have to say. They are marked in the world.",
    persuade: "Find them and make your case. What they like will help you; what puts them off will not. They answer for themselves.",
    fight: "Find it and stand your ground. If you are driven back, the story goes another way.",
    examine: "Find it and look closely. It is marked in the world.",
};

/** everyone the hero has met: they can be written to from anywhere, at any time */
function People() {
    const people = useAtomValue(peopleAtom);
    const mode = useAtomValue(modeAtom);
    const game = useGame();

    if (people.length === 0) {
        return <p className="text-center text-ink-soft italic py-4">You have met nobody yet. Walk up to someone and say hello: after that, you can write to them from anywhere.</p>;
    }
    return (
        <div className="max-w-2xl mx-auto grid gap-3">
            <p className="text-ink-soft italic text-center">Everyone you have met. They remember you, and what has passed between you.</p>
            {people.map((person) => (
                <article key={person.id} className={`rounded-md border border-wood/30 bg-[#fffaf0]/60 px-4 py-3 ${person.gone ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h4 className="font-display text-xl leading-tight">{person.name}</h4>
                            <p className="text-sm text-ink-soft">
                                {person.role} · <span className="italic">{person.mood}</span>
                                {person.gone ? " · has left the story" : person.here ? " · here" : person.whereName ? ` · in ${person.whereName}` : ""}
                            </p>
                        </div>
                        {!person.gone && (
                            <button
                                type="button"
                                disabled={mode !== "explore"}
                                onClick={() => void game.write(person.id)}
                                className="shrink-0 font-display rounded-md border-b-4 px-3 py-1 bg-moss text-parchment border-moss-deep hover:bg-moss-deep cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Write to them
                            </button>
                        )}
                    </div>
                    {(person.likes.length > 0 || person.dislikes.length > 0) && (
                        <div className="mt-2 grid gap-0.5 text-sm leading-snug">
                            {person.likes.length > 0 && <p><span className="text-moss-deep font-semibold">warms to</span> <span className="text-ink-soft">{person.likes.join(" · ")}</span></p>}
                            {person.dislikes.length > 0 && <p><span className="text-rose font-semibold">put off by</span> <span className="text-ink-soft">{person.dislikes.join(" · ")}</span></p>}
                        </div>
                    )}
                </article>
            ))}
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
