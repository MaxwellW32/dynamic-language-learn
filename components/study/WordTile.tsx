"use client";

import type { WordCard } from "@/game/dictionary";

/**
 * One word, small: for the satchel and for dictionary results. Mastery and
 * "due" are only known for words the player has met, so both are optional.
 */
export function WordTile({ word, mastery, due, kept, locale, onOpen }: {
    word: WordCard;
    mastery?: number;
    due?: boolean;
    kept?: boolean;
    locale?: string;
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="group relative flex flex-col gap-1 rounded-md border border-wood/30 bg-parchment-deep/45 px-3 pt-2.5 pb-2 text-left cursor-pointer transition-[background,border,transform] hover:bg-parchment-deep hover:border-ember/50 hover:-translate-y-px"
            aria-label={`${word.lemma}: ${word.gloss}${due ? " (due for review)" : ""}`}
        >
            {due && (
                <span className="absolute top-1.5 right-2 font-hand text-base leading-none text-ember-deep" aria-hidden>
                    due
                </span>
            )}
            <span className={`font-display text-xl leading-tight text-ember-deep break-words ${due ? "pr-8" : ""}`} lang={locale}>
                {word.lemma}
            </span>
            {word.reading && word.reading !== word.lemma && (
                <span className="text-xs text-ink-faint -mt-1" lang={locale}>{word.reading}</span>
            )}
            <span className="text-sm leading-snug text-ink-soft line-clamp-2">{word.gloss}</span>
            {(mastery !== undefined || kept) && (
                <span className="mt-auto pt-1 flex items-center gap-2">
                    {mastery !== undefined && <MasteryDots value={mastery} />}
                    {kept && <span className="ml-auto text-xs text-moss-deep" title="Kept in your satchel">✓ kept</span>}
                </span>
            )}
        </button>
    );
}

/** 0 unseen … 5 mastered, as five small inked dots */
export function MasteryDots({ value }: { value: number }) {
    const filled = Math.max(0, Math.min(5, Math.round(value)));
    return (
        <span className="inline-flex gap-[3px]" role="img" aria-label={`mastery ${filled} of 5`} title={`mastery ${filled} of 5`}>
            {Array.from({ length: 5 }, (_, i) => (
                <span
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full ${i < filled ? (filled === 5 ? "bg-moss" : "bg-gold") : "bg-ink/15"}`}
                />
            ))}
        </span>
    );
}
