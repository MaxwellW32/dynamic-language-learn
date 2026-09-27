"use client";

import { atom } from "jotai";
import type { WordCard } from "@/game/dictionary";

/**
 * Every word card the page has been handed, by entry id. Server responses
 * carry the cards for the words they mention; merging them here means a tap
 * on any word opens at once, without a round trip.
 */
export const cardsAtom = atom<Record<number, WordCard>>({});

export const mergeCardsAtom = atom(null, (get, set, cards: WordCard[]) => {
    if (cards.length === 0) return;
    const known = get(cardsAtom);
    const fresh = cards.filter((card) => known[card.id] === undefined);
    if (fresh.length === 0) return;
    set(cardsAtom, { ...known, ...Object.fromEntries(fresh.map((card) => [card.id, card])) });
});

/** the word whose card is open, and the form it was tapped in ("comió" for comer) */
export const openWordAtom = atom<{ id: number; surface: string | null } | null>(null);

/** words the reader has chosen to keep, as far as this page knows */
export const collectedAtom = atom<Record<number, boolean>>({});
