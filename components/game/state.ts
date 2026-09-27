"use client";

import { atom } from "jotai";
import type { Interactable } from "@/engine";
import type {
    BookOverview, ChapterView, ChronicleEntry, DialogueState, EncounterView, LearnerView,
    PassageView, QuestView, ScenePayload, WalletView,
} from "@/game/payloads";

/**
 * What the game screen knows. One store per open book (GameScreen provides
 * it), filled from the overview and kept current by what each action returns —
 * the server is the authority; these atoms are its latest word.
 */

export type GameMode = "explore" | "dialogue" | "battle" | "reading" | "travelling" | "turning";

export const bookAtom = atom<BookOverview["book"] | null>(null);
export const sceneAtom = atom<ScenePayload | null>(null);
export const regionsAtom = atom<BookOverview["regions"]>([]);
export const questsAtom = atom<QuestView[]>([]);
export const chaptersAtom = atom<ChapterView[]>([]);
export const passagesAtom = atom<PassageView[]>([]);
export const chronicleAtom = atom<ChronicleEntry[]>([]);
export const learnerAtom = atom<LearnerView | null>(null);
export const walletAtom = atom<WalletView | null>(null);
export const chapterTurnReadyAtom = atom(false);

export const modeAtom = atom<GameMode>("explore");
/** the thing the hero is standing next to and could act on */
export const nearestAtom = atom<Interactable | null>(null);
/** a short line about what is being waited for; null when nothing is */
export const busyAtom = atom<string | null>(null);

export const dialogueAtom = atom<DialogueState | null>(null);
export const encounterAtom = atom<EncounterView | null>(null);
/** the passage laid over the world for reading: new pages, and old ones reread */
export const readingAtom = atom<PassageView | null>(null);

export type JournalTab = "story" | "quests" | "words" | "map" | "chronicle";
export const journalAtom = atom<JournalTab | null>(null);

/** the joystick under a thumb, in screen pixels, while it is held */
export const stickAtom = atom<{ originX: number; originY: number; x: number; y: number } | null>(null);

/** the world has been built and can be seen */
export const worldReadyAtom = atom(false);

export const addPassageAtom = atom(null, (get, set, passage: PassageView) => {
    const pages = get(passagesAtom);
    if (pages.some((p) => p.id === passage.id)) {
        set(passagesAtom, pages.map((p) => (p.id === passage.id ? passage : p)));
    } else {
        set(passagesAtom, [...pages, passage]);
    }
});
