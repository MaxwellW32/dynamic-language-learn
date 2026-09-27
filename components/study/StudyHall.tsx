"use client";

import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import toast from "react-hot-toast";
import type { WordCard as Card } from "@/game/dictionary";
import { isLangCode, LANGUAGES } from "@/game/languages";
import type { LearnerView, SatchelWord, StudyView } from "@/game/payloads";
import { SectionTitle } from "@/components/account/PageShell";
import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/Panel";
import { WordCard } from "@/components/words/WordCard";
import { collectedAtom, mergeCardsAtom, openWordAtom } from "@/components/words/store";
import { setImmersionBiasAction } from "@/server/actions/books";
import { satchelAction, searchDictionaryAction } from "@/server/actions/game";
import { startStudyAction } from "@/server/actions/study";
import { StudySession } from "./StudySession";
import { WordTile } from "./WordTile";

const SESSION_SIZE = 10;
const PAGE = 48;

type Filter = "all" | "due" | "collected" | "learning" | "mastered";
const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "due", label: "Due" },
    { key: "collected", label: "Kept" },
    { key: "learning", label: "Learning" },
    { key: "mastered", label: "Mastered" },
];

const BIASES: { value: -1 | 0 | 1; label: string }[] = [
    { value: -1, label: "Cozy" },
    { value: 0, label: "Balanced" },
    { value: 1, label: "Bold" },
];

/** what a book at each immersion level does, in a few words (docs/ARCHITECTURE.md §5) */
function levelMeaning(level: number, language: string): string {
    return [
        `single ${language} words, dropped where the story makes them easy to guess`,
        "greetings and short phrases as well",
        "one short full sentence from its people in every scene",
        `half of what its people say in ${language}`,
        `dialogue mostly in ${language}, with the narration mixing in`,
        `${language} throughout — your own language only ever a tap away`,
    ][level] ?? "";
}

/**
 * The study hall: practice without a story, and a look through one's words.
 * Nothing here calls the storyteller; only a word read aloud costs anything.
 */
export function StudyHall({ languages, initialLang, initialWords, levelNames }: {
    languages: LearnerView[];
    initialLang: string;
    initialWords: SatchelWord[];
    levelNames: string[];
}) {
    const merge = useSetAtom(mergeCardsAtom);
    const openWord = useSetAtom(openWordAtom);
    const setCollected = useSetAtom(collectedAtom);

    const [lang, setLang] = useState(initialLang);
    const [learners, setLearners] = useState<Record<string, LearnerView>>(() => Object.fromEntries(languages.map((l) => [l.lang, l])));
    const [filter, setFilter] = useState<Filter>("all");
    const [words, setWords] = useState<SatchelWord[]>(initialWords);
    const [shown, setShown] = useState(PAGE);
    const [loadingWords, setLoadingWords] = useState(false);
    const [session, setSession] = useState<StudyView | null>(null);
    const [starting, setStarting] = useState(false);
    const [savingBias, setSavingBias] = useState(false);
    const search = useDictionarySearch(lang, merge);

    const learner = learners[lang];
    const language = isLangCode(lang) ? LANGUAGES[lang] : null;
    const languageName = language?.name ?? lang;
    const locale = language?.locale;

    // the satchel's answers may arrive out of order; only the latest asked for is shown
    const satchelTicket = useRef(0);
    const loadSatchel = async (forLang: string, forFilter: Filter) => {
        const ticket = ++satchelTicket.current;
        setLoadingWords(true);
        const result = await satchelAction(forLang, forFilter);
        if (ticket !== satchelTicket.current) return;
        setLoadingWords(false);
        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        setWords(result.data.words);
        setShown(PAGE);
        refreshLearner(result.data.learner);
    };

    const refreshLearner = (view: LearnerView) => {
        setLearners((all) => ({ ...all, [view.lang]: view }));
    };

    const chooseLang = (next: string) => {
        if (next === lang) return;
        setLang(next);
        openWord(null);
        search.clear();
        void loadSatchel(next, filter);
    };

    const chooseFilter = (next: Filter) => {
        if (next === filter) return;
        setFilter(next);
        void loadSatchel(lang, next);
    };

    const chooseBias = async (bias: -1 | 0 | 1) => {
        if (!learner || bias === learner.immersionBias || savingBias) return;
        setSavingBias(true);
        const result = await setImmersionBiasAction(lang, bias);
        setSavingBias(false);
        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        setLearners((all) => ({ ...all, [result.data.lang]: result.data }));
    };

    const begin = async () => {
        setStarting(true);
        const result = await startStudyAction(lang, SESSION_SIZE);
        setStarting(false);
        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        merge(result.data.words);
        openWord(null);
        setSession(result.data);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const leave = () => {
        setSession(null);
        openWord(null);
        // the session moved words along: their mastery, what is due, the xp
        void loadSatchel(lang, filter);
    };

    const openSatchelWord = (word: SatchelWord) => {
        merge([word]);
        // tell the card what the satchel already knows, so "keep" shows the truth at once
        setCollected((known) => (known[word.id] === undefined ? { ...known, [word.id]: word.collected } : known));
        openWord({ id: word.id, surface: null });
    };

    const openCard = (card: Card) => {
        merge([card]);
        openWord({ id: card.id, surface: null });
    };

    return (
        <div className="grid gap-8">
            {languages.length > 1 && !session && (
                <div className="flex flex-wrap justify-center gap-2" role="tablist" aria-label="Languages you study">
                    {languages.map((l) => {
                        const info = isLangCode(l.lang) ? LANGUAGES[l.lang] : null;
                        const active = l.lang === lang;
                        return (
                            <button
                                key={l.lang}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => chooseLang(l.lang)}
                                className={`rounded-full border px-4 py-1 font-display cursor-pointer transition-colors ${active ? "bg-ink text-parchment border-ink" : "border-wood/40 bg-parchment-deep/50 hover:bg-parchment-deep"}`}
                            >
                                <span aria-hidden className="mr-1.5">{info?.flag}</span>
                                {info?.name ?? l.lang}
                            </button>
                        );
                    })}
                </div>
            )}

            {session ? (
                <section className="mx-auto w-full max-w-2xl">
                    <StudySession
                        key={session.id}
                        view={session}
                        locale={locale}
                        starting={starting}
                        onAgain={begin}
                        onLeave={leave}
                    />
                </section>
            ) : (
                <>
                    {learner && (
                        <LearnerHeader
                            learner={learner}
                            languageName={languageName}
                            flag={language?.flag}
                            levelNames={levelNames}
                            saving={savingBias}
                            onBias={chooseBias}
                        />
                    )}

                    <section className="text-center">
                        <Button variant="primary" size="lg" className="w-full sm:w-auto sm:min-w-[18rem] text-xl" onClick={begin} disabled={starting}>
                            {starting ? "Setting out the words…" : `Practise ${SESSION_SIZE} words`}
                        </Button>
                        <p className="mt-2 text-ink-soft">
                            {learner && learner.wordsDue > 0
                                ? `${learner.wordsDue} ${learner.wordsDue === 1 ? "word is" : "words are"} due for review — they come first.`
                                : "Words you have met come first, then the next most common ones."}
                        </p>
                    </section>

                    <section>
                        <SectionTitle aside={<span className="text-sm text-ink-faint">{loadingWords ? "turning the pages…" : `${words.length} ${words.length === 1 ? "word" : "words"}`}</span>}>
                            Your satchel
                        </SectionTitle>
                        <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Show words">
                            {FILTERS.map((f) => (
                                <button
                                    key={f.key}
                                    type="button"
                                    aria-pressed={filter === f.key}
                                    onClick={() => chooseFilter(f.key)}
                                    className={`rounded-full border px-3 py-0.5 text-sm cursor-pointer transition-colors ${filter === f.key ? "bg-ember text-parchment border-ember-deep" : "border-wood/35 hover:bg-parchment-deep"}`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        {words.length === 0 ? (
                            <p className="text-ink-soft italic py-4 text-center">{emptySatchel(filter)}</p>
                        ) : (
                            <>
                                <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 transition-opacity ${loadingWords ? "opacity-60" : ""}`}>
                                    {words.slice(0, shown).map((word) => (
                                        <WordTile
                                            key={word.id}
                                            word={word}
                                            mastery={word.mastery}
                                            due={word.due}
                                            kept={word.collected}
                                            locale={locale}
                                            onOpen={() => openSatchelWord(word)}
                                        />
                                    ))}
                                </div>
                                {words.length > shown && (
                                    <div className="mt-4 text-center">
                                        <Button variant="quiet" onClick={() => setShown((n) => n + PAGE)}>
                                            Show {Math.min(PAGE, words.length - shown)} more
                                        </Button>
                                    </div>
                                )}
                            </>
                        )}
                    </section>

                    <section>
                        <SectionTitle>Look up a word</SectionTitle>
                        <input
                            type="search"
                            value={search.query}
                            onChange={(event) => search.change(event.target.value)}
                            placeholder={`a word in ${languageName} or English…`}
                            aria-label="Look up a word"
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full rounded-md border-2 border-wood/40 bg-[#fffaf0] px-4 py-2.5 text-lg outline-none focus:border-ember placeholder:text-ink-faint placeholder:italic"
                        />
                        <div className="mt-3 min-h-8">
                            {search.searching && <p className="font-hand text-xl text-ink-soft">leafing through the dictionary…</p>}
                            {!search.searching && search.results !== null && search.results.length === 0 && (
                                <p className="text-ink-soft italic">Nothing found for “{search.query.trim()}”.</p>
                            )}
                            {search.results !== null && search.results.length > 0 && (
                                <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 ${search.searching ? "opacity-60" : ""}`}>
                                    {search.results.map((card) => (
                                        <WordTile key={card.id} word={card} locale={locale} onOpen={() => openCard(card)} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                </>
            )}

            <WordCard lang={lang} />
        </div>
    );
}

function emptySatchel(filter: Filter): string {
    switch (filter) {
        case "due": return "Nothing is due — every word is resting.";
        case "collected": return "You have not kept any words yet. Tap a word anywhere and choose “Keep this word”.";
        case "mastered": return "No word is mastered yet. Keep practising — they will come.";
        case "learning": return "No words in progress just now.";
        default: return "Your satchel is empty. Words you meet in your books gather here.";
    }
}

/**
 * Dictionary search, debounced: it waits until the reader pauses, needs two
 * characters, and shows only the answer to the latest thing typed.
 */
function useDictionarySearch(lang: string, merge: (cards: Card[]) => void) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Card[] | null>(null);
    const [searching, setSearching] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ticket = useRef(0);

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    const change = (value: string) => {
        setQuery(value);
        if (timer.current) clearTimeout(timer.current);
        const wanted = value.trim();
        const mine = ++ticket.current;
        if (wanted.length < 2) {
            setResults(null);
            setSearching(false);
            return;
        }
        timer.current = setTimeout(async () => {
            setSearching(true);
            const result = await searchDictionaryAction(lang, wanted);
            if (mine !== ticket.current) return;
            setSearching(false);
            if (!result.ok) {
                toast.error(result.error);
                return;
            }
            merge(result.data);
            setResults(result.data);
        }, 300);
    };

    const clear = () => {
        if (timer.current) clearTimeout(timer.current);
        ticket.current++;
        setQuery("");
        setResults(null);
        setSearching(false);
    };

    return { query, results, searching, change, clear };
}

function LearnerHeader({ learner, languageName, flag, levelNames, saving, onBias }: {
    learner: LearnerView;
    languageName: string;
    flag?: string;
    levelNames: string[];
    saving: boolean;
    onBias: (bias: -1 | 0 | 1) => void;
}) {
    const nextName = levelNames[learner.immersion + 1];
    const stats: { value: number; label: string }[] = [
        { value: learner.wordsMet, label: "met" },
        { value: learner.wordsKnown, label: "known" },
        { value: learner.wordsDue, label: "due" },
        { value: learner.streakDays, label: learner.streakDays === 1 ? "day streak" : "days streak" },
        { value: learner.xp, label: "xp" },
    ];

    return (
        <section className="grid gap-6">
            <div className="text-center">
                <div className="font-display text-ink-soft tracking-wide">
                    <span aria-hidden className="mr-1.5">{flag}</span>{languageName}
                </div>
                <div className="font-display text-4xl sm:text-5xl leading-tight">{learner.immersionName}</div>
                <div className="mx-auto mt-2 max-w-sm">
                    <Meter value={learner.toNext} />
                    <p className="mt-1 text-sm text-ink-faint">
                        {nextName ? `on the way to ${nextName}` : "the top of the ladder"}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-5 sm:flex sm:justify-center">
                {stats.map((stat, i) => (
                    <div key={stat.label} className={`px-1 sm:px-6 text-center ${i > 0 ? "border-l border-ink/20" : ""}`}>
                        <div className="font-display text-2xl sm:text-3xl leading-none tabular-nums">{stat.value}</div>
                        <div className="mt-1 text-xs sm:text-sm leading-tight text-ink-soft">{stat.label}</div>
                    </div>
                ))}
            </div>

            <div className="rounded-md border border-wood/30 bg-parchment-deep/40 px-4 py-4 text-center">
                <p className="font-display text-lg">How boldly should your books use {languageName}?</p>
                <div className="mt-3 inline-flex rounded-full border border-wood/50 bg-parchment p-1" role="radiogroup" aria-label="Immersion">
                    {BIASES.map((bias) => {
                        const chosen = learner.immersionBias === bias.value;
                        return (
                            <button
                                key={bias.value}
                                type="button"
                                role="radio"
                                aria-checked={chosen}
                                disabled={saving}
                                onClick={() => onBias(bias.value)}
                                className={`rounded-full px-3 sm:px-5 py-1 font-display cursor-pointer transition-colors disabled:cursor-wait ${chosen ? "bg-ember text-parchment shadow-card" : "text-ink-soft hover:text-ink hover:bg-parchment-deep"}`}
                            >
                                {bias.label}
                            </button>
                        );
                    })}
                </div>
                <p className="mt-3 text-ink-soft">
                    Your books are now at <span className="font-semibold text-ink">{learner.immersionName}</span>:{" "}
                    {levelMeaning(learner.immersion, languageName)}.
                </p>
            </div>
        </section>
    );
}
