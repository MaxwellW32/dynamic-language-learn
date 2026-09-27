"use client";

import type { WordCard } from "@/game/dictionary";

/** a word that was taught or learned, small enough to sit in a row; a tap opens its card */
export function WordChip({ word, locale, onOpen }: { word: WordCard; locale?: string; onOpen: () => void }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-baseline gap-1.5 rounded-full border border-ember/40 bg-parchment px-3 py-0.5 cursor-pointer hover:bg-gold/20 transition-colors"
        >
            <span className="font-semibold text-ember-deep" lang={locale}>{word.lemma}</span>
            <span className="text-sm text-ink-soft">{word.gloss.length > 28 ? `${word.gloss.slice(0, 27)}…` : word.gloss}</span>
        </button>
    );
}
