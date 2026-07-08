"use client";

import { atom } from "jotai";
import type {
    ChapterView, ChronicleEntry, DialogueState, EncounterView, PassageView,
    QuestView, SatchelWordView, ScenePayload, StoryOverview, WordEntry,
} from "@/game/payloads";

/**
 * Client game state, one atom per concern. The server is authoritative —
 * these only mirror what actions return.
 */

export const storyInfoAtom = atom<StoryOverview["story"] | null>(null);
export const sceneAtom = atom<ScenePayload | null>(null);
export const questsAtom = atom<QuestView[]>([]);
export const chaptersAtom = atom<ChapterView[]>([]);
export const passagesAtom = atom<PassageView[]>([]);
export const satchelAtom = atom<SatchelWordView[]>([]);
export const chronicleAtom = atom<ChronicleEntry[]>([]);
export const chapterTurnReadyAtom = atom(false);

/** dictionary of every word the client has seen segments for */
export const wordDictAtom = atom<Record<string, WordEntry>>({});

export const dialogueAtom = atom<DialogueState | null>(null);
export const encounterAtom = atom<EncounterView | null>(null);

/** live player position (client-side, synced to the server on a throttle) */
export const playerPosAtom = atom<{ x: number; y: number }>({ x: 0, y: 0 });

/** a label while a long action runs ("the narrator is writing…") */
export const busyAtom = atom<string | null>(null);

export const mergeWordsAtom = atom(null, (get, set, words: WordEntry[]) => {
    if (words.length === 0) return;
    const dict = { ...get(wordDictAtom) };
    for (const w of words) dict[w.id] = w;
    set(wordDictAtom, dict);
});
