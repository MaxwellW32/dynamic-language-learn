"use client";

import { createContext, useContext, useMemo, type RefObject } from "react";
import { atom, useStore } from "jotai";
import toast from "react-hot-toast";
import type { Interactable, WorldEngine } from "@/engine";
import type { Submission } from "@/game/challenges/types";
import type { AnswerResult, NarrationResult, PassageView, QuestUpdate, WalletView } from "@/game/payloads";
import {
    answerAction, chooseAction, examineAction, fleeEncounterAction, openDialogueAction,
    refreshAction, sayAction, startEncounterAction, travelAction, turnChapterAction,
} from "@/server/actions/game";
import type { Result } from "@/server/actions/result";
import { mergeCardsAtom } from "@/components/words/store";
import { stopSpeech } from "@/components/words/useSpeech";
import {
    addPassageAtom, bookAtom, busyAtom, chapterTurnReadyAtom, chaptersAtom, chronicleAtom, dialogueAtom, encounterAtom,
    learnerAtom, modeAtom, nearestAtom, questsAtom, readingAtom, regionsAtom, sceneAtom,
    walletAtom, worldReadyAtom, type GameMode,
} from "./state";

/** the page about a place, held back until the place itself can be seen */
const pendingArrivalAtom = atom<NarrationResult | null>(null);
/** a page written while the hero was mid-conversation, held back until the talking is done */
const pendingBeatAtom = atom<PassageView | null>(null);

export const EngineContext = createContext<RefObject<WorldEngine | null> | null>(null);

export function useEngine(): RefObject<WorldEngine | null> {
    const ref = useContext(EngineContext);
    if (!ref) throw new Error("useEngine must be used inside the game screen");
    return ref;
}

const SPELL_COLORS = [0x7ad6ff, 0xffe08a, 0xc9a7ff, 0x8affc1, 0xff9ab0];

function announce(updates: QuestUpdate[]): void {
    for (const update of updates) {
        if (update.isNew) toast(`A new quest: ${update.questTitle}`, { icon: "📜", duration: 6000 });
        else if (update.failed) toast(`Quest lost: ${update.questTitle}`, { icon: "🥀", duration: 6000 });
        else if (update.questCompleted) toast.success(`Quest complete: ${update.questTitle}`, { duration: 6000 });
        else if (update.objectiveDescription) toast(update.objectiveDescription, { icon: "✓", duration: 4000 });
    }
}

/**
 * Everything the player can do, as functions. Each one asks the server,
 * then tells the store what changed and the engine what to show. The
 * components that call these know nothing of either.
 */
export function useGame() {
    const store = useStore();
    const engineRef = useEngine();

    return useMemo(() => {
        const bookId = () => store.get(bookAtom)?.id ?? "";
        const here = () => engineRef.current?.heroPosition() ?? { x: 0, z: 0, rot: 0 };

        /** unwrap a result, saying what went wrong when something did */
        function taken<T>(result: Result<T>): T | null {
            if (result.ok) return result.data;
            // the same refusal twice is one message, not two
            toast.error(result.error, { id: result.error, duration: result.kind === "wallet" || result.kind === "key" ? 8000 : 4000 });
            return null;
        }

        function setMode(mode: GameMode, focus?: { kind: "character" | "enemy"; id: string }) {
            store.set(modeAtom, mode);
            const engine = engineRef.current;
            if (!engine) return;
            if (mode === "dialogue" && focus) engine.setMode("dialogue", focus);
            else if (mode === "battle" && focus) engine.setMode("battle", focus);
            else if (mode === "turning") engine.setMode("cinematic");
            else if (mode === "travelling") engine.setMode("paused");
            // a page is open: the world goes on around the hero, who stays put until it is read
            else if (mode === "reading") engine.setMode("still");
            else engine.setMode("explore");
        }

        function takeWallet(wallet: WalletView | undefined) {
            if (wallet) store.set(walletAtom, wallet);
        }

        /** what the story did behind the player's back: refresh quests and who is marked in the world */
        async function refresh() {
            const fresh = taken(await refreshAction(bookId()));
            if (!fresh) return;
            store.set(questsAtom, fresh.quests);
            store.set(learnerAtom, fresh.learner);
            store.set(chronicleAtom, fresh.chronicle);
            engineRef.current?.refresh({
                characters: fresh.scene.characters, enemies: fresh.scene.enemies, landmarks: fresh.scene.landmarks,
            });
        }

        /** a page has been written: put it in the book and in front of the reader */
        function takeNarration(result: NarrationResult, show = true) {
            store.set(mergeCardsAtom, result.words);
            store.set(chapterTurnReadyAtom, result.chapterTurnReady);
            takeWallet(result.wallet);
            announce(result.questUpdates);
            if (result.passage) {
                store.set(addPassageAtom, result.passage);
                if (show) {
                    store.set(readingAtom, result.passage);
                    setMode("reading");
                }
            }
            if (result.questUpdates.length > 0) void refresh();
            if (result.questUpdates.some((u) => u.questCompleted)) engineRef.current?.celebrate();
        }

        async function talk(characterId: string) {
            store.set(busyAtom, "they turn toward you…");
            try {
                const opened = taken(await openDialogueAction(bookId(), characterId, here()));
                if (!opened) return;
                store.set(mergeCardsAtom, opened.words);
                store.set(dialogueAtom, opened);
                setMode("dialogue", { kind: "character", id: characterId });
                const greeting = opened.messages[opened.messages.length - 1];
                if (opened.greeted && greeting) engineRef.current?.characterGesture(characterId, "wave", 1.4);
            } finally {
                store.set(busyAtom, null);
            }
        }

        async function say(said: { text: string } | { optionKey: string }) {
            const dialogue = store.get(dialogueAtom);
            if (!dialogue) return false;
            const characterId = dialogue.character.id;
            engineRef.current?.heroGesture("talk", 1.6);

            const turn = taken(await sayAction(bookId(), characterId, said));
            if (!turn) return false;

            store.set(mergeCardsAtom, turn.words);
            takeWallet(turn.wallet);
            store.set(chapterTurnReadyAtom, turn.chapterTurnReady);
            const current = store.get(dialogueAtom);
            if (current && current.character.id === characterId) {
                store.set(dialogueAtom, {
                    ...current,
                    character: { ...current.character, mood: turn.mood, affinity: turn.affinity },
                    messages: [...current.messages, turn.playerMessage, turn.reply],
                    options: turn.options,
                });
            }
            engineRef.current?.characterGesture(characterId, "talk", 2.2);
            if (turn.xp > 0) toast(`+${turn.xp} xp for speaking`, { icon: "✦", duration: 2500 });
            announce(turn.questUpdates);
            if (turn.beat) {
                store.set(addPassageAtom, turn.beat);
                store.set(pendingBeatAtom, turn.beat);
            }
            if (turn.questUpdates.length > 0) void refresh();
            return true;
        }

        function leaveDialogue() {
            const dialogue = store.get(dialogueAtom);
            stopSpeech();
            if (dialogue) engineRef.current?.characterGesture(dialogue.character.id, "wave", 1.2);
            store.set(dialogueAtom, null);
            // a quest that resolved mid-conversation wrote a page: read it now that the talking is done
            const beat = store.get(pendingBeatAtom);
            store.set(pendingBeatAtom, null);
            if (beat) {
                store.set(readingAtom, beat);
                setMode("reading");
                engineRef.current?.celebrate();
            } else {
                setMode("explore");
            }
        }

        async function examine(landmarkId: string) {
            store.set(busyAtom, "you look closer…");
            try {
                const result = taken(await examineAction(bookId(), landmarkId, here()));
                if (!result) return;
                takeNarration(result);
                const scene = store.get(sceneAtom);
                const landmark = scene?.landmarks.find((l) => l.id === landmarkId);
                if (landmark && !landmark.examined) engineRef.current?.refresh({ landmarks: [{ ...landmark, examined: true }] });
            } finally {
                store.set(busyAtom, null);
            }
        }

        async function travel(gateId: string, label: string) {
            setMode("travelling");
            store.set(worldReadyAtom, false);
            store.set(busyAtom, label.replace(/^To /, "Walking to "));
            const result = taken(await travelAction(bookId(), gateId, here()));
            if (!result) {
                store.set(worldReadyAtom, true);
                store.set(busyAtom, null);
                setMode("explore");
                return;
            }
            store.set(regionsAtom, store.get(regionsAtom).map((r) => ({
                ...r, current: r.id === result.scene.region.id, visited: r.visited || r.id === result.scene.region.id,
            })));
            // the canvas sees the new scene and rebuilds; GameScreen lifts the veil when the engine reports ready
            store.set(pendingArrivalAtom, result.arrival);
            store.set(sceneAtom, result.scene);
        }

        /** the world has finished building after travel: lift the veil and read the page about it */
        function arrived() {
            store.set(worldReadyAtom, true);
            store.set(busyAtom, null);
            const arrival = store.get(pendingArrivalAtom);
            store.set(pendingArrivalAtom, null);
            setMode("explore");
            if (arrival) takeNarration(arrival);
        }

        async function fight(enemyId: string) {
            if (store.get(encounterAtom) || store.get(modeAtom) === "battle") return;
            store.set(busyAtom, "it turns to face you…");
            try {
                const battle = taken(await startEncounterAction(bookId(), enemyId, here()));
                if (!battle) {
                    engineRef.current?.calmEnemy(enemyId, 10);
                    return;
                }
                store.set(encounterAtom, battle);
                setMode("battle", { kind: "enemy", id: battle.enemy.id });
            } finally {
                store.set(busyAtom, null);
            }
        }

        async function answer(submission: Submission): Promise<AnswerResult | null> {
            const battle = store.get(encounterAtom);
            if (!battle) return null;
            const result = taken(await answerAction(bookId(), battle.id, submission));
            if (!result) return null;

            store.set(mergeCardsAtom, [...result.taught, ...(result.victory?.words ?? []), ...(result.victory?.learned ?? [])]);
            const engine = engineRef.current;
            const color = SPELL_COLORS[battle.stageIndex % SPELL_COLORS.length];
            if (result.correct) engine?.castSpell(battle.enemy.id, color);
            else engine?.enemyStrike(battle.enemy.id);

            if (result.status === "won") {
                // let the last spell land before the creature falls
                window.setTimeout(() => engine?.defeatEnemy(battle.enemy.id), 750);
                const scene = store.get(sceneAtom);
                if (scene) store.set(sceneAtom, { ...scene, enemies: scene.enemies.filter((e) => e.id !== battle.enemy.id) });
            }
            if (result.victory) {
                store.set(chapterTurnReadyAtom, result.victory.chapterTurnReady);
                if (result.victory.passage) store.set(addPassageAtom, result.victory.passage);
            }
            return result;
        }

        /** move the battle on to what the last answer led to */
        function advance(result: AnswerResult) {
            const battle = store.get(encounterAtom);
            if (!battle) return;
            if (result.status === "active") {
                store.set(encounterAtom, { ...battle, hearts: result.hearts, stageIndex: result.stageIndex, stage: result.stage });
                return;
            }
            store.set(encounterAtom, null);
            if (result.status === "retreated") {
                engineRef.current?.calmEnemy(battle.enemy.id, 16);
                toast("You fall back to catch your breath. It will be here when you are ready.", { icon: "🍃", duration: 5000 });
            }
            if (result.victory) announce(result.victory.questUpdates);
            setMode("explore");
            void refresh();
        }

        async function flee() {
            const battle = store.get(encounterAtom);
            if (!battle) return;
            store.set(encounterAtom, null);
            engineRef.current?.calmEnemy(battle.enemy.id, 16);
            setMode("explore");
            await fleeEncounterAction(bookId(), battle.id);
        }

        async function choose(passageId: string, choiceKey: string) {
            store.set(busyAtom, "the story bends…");
            try {
                const current = store.get(readingAtom);
                if (current && current.id === passageId) {
                    const chosen = { ...current, chosenKey: choiceKey };
                    store.set(readingAtom, chosen);
                    store.set(addPassageAtom, chosen);
                }
                const result = taken(await chooseAction(bookId(), passageId, choiceKey));
                if (result) takeNarration(result);
            } finally {
                store.set(busyAtom, null);
            }
        }

        function closeReading() {
            stopSpeech();
            store.set(readingAtom, null);
            if (store.get(modeAtom) === "reading") setMode("explore");
            // the director may have acted while the page was being read
            void refresh();
        }

        async function turnChapter() {
            setMode("turning");
            store.set(busyAtom, "the page turns…");
            try {
                const turn = taken(await turnChapterAction(bookId()));
                if (!turn) {
                    setMode("explore");
                    return;
                }
                store.set(mergeCardsAtom, turn.words);
                takeWallet(turn.wallet);
                store.set(chaptersAtom, [
                    ...store.get(chaptersAtom).map((c) => (c.id === turn.closedChapter.id ? turn.closedChapter : c)),
                    turn.newChapter,
                ]);
                store.set(addPassageAtom, turn.passage);
                store.set(questsAtom, turn.quests);
                store.set(regionsAtom, turn.regions);
                store.set(chapterTurnReadyAtom, false);
                const book = store.get(bookAtom);
                if (book && turn.storyCompleted) store.set(bookAtom, { ...book, status: "completed" });
                engineRef.current?.refresh({
                    characters: turn.scene.characters, enemies: turn.scene.enemies, landmarks: turn.scene.landmarks,
                });
                // a gate may have opened where there was none: the region must be rebuilt to show it
                const before = store.get(sceneAtom);
                if (before && before.gates.length !== turn.scene.gates.length) {
                    store.set(worldReadyAtom, false);
                    store.set(sceneAtom, turn.scene);
                }
                engineRef.current?.celebrate(0xc9a7ff);
                store.set(readingAtom, turn.passage);
                store.set(modeAtom, "reading");
                toast(`Chapter ${turn.newChapter.index}: ${turn.newChapter.title}`, { icon: "📖", duration: 7000 });
            } finally {
                store.set(busyAtom, null);
            }
        }

        /** the hero walked up to something and chose to act on it */
        function act(target: Interactable) {
            if (store.get(modeAtom) !== "explore" || store.get(busyAtom)) return;
            if (target.kind === "character") void talk(target.id);
            else if (target.kind === "landmark") void examine(target.id);
            else if (target.kind === "gate") void travel(target.id, target.name);
            else void fight(target.id);
        }

        return {
            act, talk, say, leaveDialogue, examine, travel, arrived, fight, answer, advance, flee,
            choose, closeReading, turnChapter, refresh, setMode,
            nearest: () => store.get(nearestAtom),
        };
    }, [store, engineRef]);
}

export type Game = ReturnType<typeof useGame>;
