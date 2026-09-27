"use client";

import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import toast from "react-hot-toast";
import { LEVEL_NAMES, POS_NAMES, type WordCard as Card } from "@/game/dictionary";
import { isLangCode, LANGUAGES } from "@/game/languages";
import { collectWordAction, lookupAction, tapWordAction } from "@/server/actions/game";
import { Chip } from "@/components/ui/Panel";
import { cardsAtom, collectedAtom, mergeCardsAtom, openWordAtom } from "./store";
import { speakWord, useSpeaking } from "./useSpeech";

const GENDER: Record<string, string> = { masculine: "masc.", feminine: "fem.", neuter: "neut.", common: "common" };

/**
 * The card for the word the reader tapped: what it means, how it sounds, how
 * it is used. One card at a time, docked where it will not cover what they
 * were reading.
 */
export function WordCard({ lang }: { lang: string }) {
    const [open, setOpen] = useAtom(openWordAtom);
    const cards = useAtomValue(cardsAtom);
    const merge = useSetAtom(mergeCardsAtom);
    const [collected, setCollected] = useAtom(collectedAtom);
    // kept with the word they belong to, so a stale answer can never show under a newer word
    const [alternatives, setAlternatives] = useState<{ forId: number; list: Card[] }>({ forId: 0, list: [] });
    const speaking = useSpeaking();

    const card = open ? cards[open.id] : undefined;

    // a tap is an exposure; and if the page was never handed this card, fetch it
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        tapWordAction(lang, open.id).then((result) => {
            if (cancelled || !result.ok) return;
            if (result.data.card) merge([result.data.card]);
            setCollected((known) => ({ ...known, [open.id]: result.data.collected }));
        });
        // other headwords the same written form could be
        if (open.surface) {
            lookupAction(lang, open.surface).then((result) => {
                if (!cancelled && result.ok) {
                    setAlternatives({ forId: open.id, list: result.data.filter((c) => c.id !== open.id).slice(0, 3) });
                }
            });
        }
        return () => {
            cancelled = true;
        };
    }, [open, lang, merge, setCollected]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, setOpen]);

    if (!open) return null;

    const others = alternatives.forId === open.id ? alternatives.list : [];
    const language = isLangCode(lang) ? LANGUAGES[lang] : null;
    const kept = collected[open.id] === true;
    const inflected = card && open.surface && open.surface.toLowerCase() !== card.lemma.toLowerCase() ? open.surface : null;
    const sound = card?.reading && card.reading !== card.lemma ? card.reading : null;

    const keep = async () => {
        const next = !kept;
        setCollected((c) => ({ ...c, [open.id]: next }));
        const result = await collectWordAction(lang, open.id, next);
        if (!result.ok) {
            setCollected((c) => ({ ...c, [open.id]: !next }));
            toast.error(result.error);
        } else if (next) {
            toast.success("Kept in your satchel");
        }
    };

    const say = () => {
        if (!card) return;
        speakWord(card.id, card.audioUrl).catch((error) => toast.error(error instanceof Error ? error.message : "The voice faded away."));
    };

    return (
        <aside
            className="page-float fixed z-50 right-3 bottom-3 left-3 sm:left-auto sm:w-[22rem] max-h-[70dvh] overflow-y-auto scroll-ink p-4 animate-rise"
            role="dialog"
            aria-label={card ? `${card.lemma}: ${card.gloss}` : "Word"}
        >
            <button
                type="button"
                onClick={() => setOpen(null)}
                className="absolute top-2 right-3 text-2xl leading-none text-ink-faint hover:text-ink cursor-pointer"
                aria-label="Close"
            >
                ×
            </button>

            {!card ? (
                <p className="font-hand text-xl text-ink-soft py-4">turning to the right page…</p>
            ) : (
                <>
                    <div className="flex items-start gap-3 pr-6">
                        <button
                            type="button"
                            onClick={say}
                            className={`shrink-0 mt-1 w-10 h-10 rounded-full grid place-items-center border border-wood/40 bg-parchment-deep hover:bg-parchment-dark cursor-pointer text-lg ${speaking === `word:${card.id}` ? "animate-glint" : ""}`}
                            aria-label={`Hear ${card.lemma}`}
                            title="Hear it"
                        >
                            🔊
                        </button>
                        <div>
                            <div className="font-display text-3xl leading-tight text-ember-deep break-words" lang={language?.locale}>
                                {card.lemma}
                            </div>
                            {(sound || card.roman || card.ipa) && (
                                <div className="text-sm text-ink-soft">
                                    {[sound, card.roman && card.roman !== sound ? card.roman : null, card.ipa].filter(Boolean).join("  ·  ")}
                                </div>
                            )}
                        </div>
                    </div>

                    {inflected && (
                        <p className="mt-2 text-sm text-ink-soft">
                            you met it as <span className="font-semibold text-ink" lang={language?.locale}>{inflected}</span>
                        </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {card.pos !== "word" && <Chip>{POS_NAMES[card.pos] ?? card.pos}</Chip>}
                        {card.gender && <Chip tone="sky">{GENDER[card.gender] ?? card.gender}</Chip>}
                        {card.level <= 5 && <Chip tone="moss">{LEVEL_NAMES[card.level]}</Chip>}
                    </div>

                    <p className="mt-3 text-xl leading-snug">{card.gloss}</p>

                    {card.senses.length > 0 && (
                        <ol className="mt-3 space-y-2 text-[0.95rem] leading-snug list-decimal list-inside marker:text-ink-faint">
                            {card.senses.slice(0, 4).map((sense, i) => (
                                <li key={i}>
                                    <span>{sense.g}</span>
                                    {sense.l && sense.l.length > 0 && <span className="text-ink-faint text-sm"> ({sense.l.join(", ")})</span>}
                                    {sense.ex?.slice(0, 1).map((example, k) => (
                                        <span key={k} className="block mt-1 ml-5 pl-3 border-l-2 border-gold/60">
                                            <span className="block text-ink" lang={language?.locale}>{example.t}</span>
                                            <span className="block text-sm italic text-ink-soft">{example.n}</span>
                                        </span>
                                    ))}
                                </li>
                            ))}
                        </ol>
                    )}

                    {others.length > 0 && (
                        <div className="mt-3 text-sm text-ink-soft">
                            could also be:{" "}
                            {others.map((other, i) => (
                                <span key={other.id}>
                                    {i > 0 && ", "}
                                    <button
                                        type="button"
                                        className="wb-word"
                                        onClick={() => {
                                            merge([other]);
                                            setOpen({ id: other.id, surface: open.surface });
                                        }}
                                    >
                                        {other.lemma}
                                    </button>{" "}
                                    <span className="text-ink-faint">({other.gloss})</span>
                                </span>
                            ))}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={keep}
                        className={`mt-4 w-full rounded-md border px-3 py-1.5 font-display cursor-pointer transition-colors ${kept ? "bg-moss text-parchment border-moss-deep" : "bg-parchment-deep border-wood/40 hover:bg-parchment-dark"}`}
                    >
                        {kept ? "✓ In your satchel" : "Keep this word"}
                    </button>
                </>
            )}
        </aside>
    );
}
