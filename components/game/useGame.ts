"use client";

import { createContext, useContext, useMemo, type RefObject } from "react";
import { atom, useStore } from "jotai";
import toast from "react-hot-toast";
import type { Interactable, WorldEngine } from "@/engine";
import type { Submission } from "@/game/challenges/types";
import type {
    AnswerResult, DialogueTurnResult, GoalSettled, PassageView, StoryState, StoryStep, TravelResult, WalletView,
} from "@/game/payloads";
import {
    advanceAction, answerAction, askForAnswerAction, examineAction, fleeEncounterAction, openChatAction,
    openDialogueAction, reachAction, refreshAction, sayAction, startEncounterAction, travelAction, turnChapterAction,
} from "@/server/actions/game";
import type { Result } from "@/server/actions/result";
import { mergeCardsAtom } from "@/components/words/store";
import { stopSpeech } from "@/components/words/useSpeech";
import {
    addPassageAtom, bookAtom, busyAtom, chaptersAtom, chronicleAtom, dialogueAtom, encounterAtom,
    journalAtom, learnerAtom, modeAtom, nearestAtom, peopleAtom, queueAtom, readingAtom, regionsAtom, sceneAtom,
    storyAtom, walletAtom, worldReadyAtom, type GameMode,
} from "./state";

/** what arriving somewhere settled, held back until the place itself can be seen */
const pendingArrivalAtom = atom<TravelResult | null>(null);
/** the book is writing: asking it again would only be told to wait */
const writingAtom = atom(false);
/** the goal in hand has changed since the world was last brought up to date: what is marked in it is out of date */
const staleAtom = atom(false);

export const EngineContext = createContext<RefObject<WorldEngine | null> | null>(null);

export function useEngine(): RefObject<WorldEngine | null> {
    const ref = useContext(EngineContext);
    if (!ref) throw new Error("useEngine must be used inside the game screen");
    return ref;
}

const SPELL_COLORS = [0x7ad6ff, 0xffe08a, 0xc9a7ff, 0x8affc1, 0xff9ab0];

const WRITING: Record<"page" | "bend" | "plan", string> = {
    page: "the storyteller takes up the pen…",
    bend: "the story finds another way…",
    plan: "the storyteller plans the chapter…",
};

/**
 * Everything the player can do, as functions. Each one asks the server,
 * then tells the store what changed and the engine what to show. The
 * components that call these know nothing of either.
 *
 * The story moves by itself whenever something falls to the book rather than
 * the reader (`story.due`): a page to tell, a road to mend. `moveOn` asks for
 * that, and is called wherever the reader has just finished with something —
 * closed a page, left a conversation, walked out of a battle, arrived.
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
            // words exchanged from afar: there is nobody to turn the camera to
            else if (mode === "dialogue") engine.setMode("still");
            else if (mode === "battle" && focus) engine.setMode("battle", focus);
            else if (mode === "turning") engine.setMode("cinematic");
            else if (mode === "travelling") engine.setMode("paused");
            // a page is open: the world goes on around the hero, who stays put until it is read
            else if (mode === "reading") engine.setMode("still");
            else engine.setMode("explore");
        }

        /**
         * Something is being waited for: the world holds its breath, so that
         * nothing can catch the hero while they stand there. `release` lets
         * it go again, unless a panel has taken the screen in the meantime.
         */
        function hold(what: string) {
            store.set(busyAtom, what);
            engineRef.current?.setMode("still");
        }
        function release() {
            store.set(busyAtom, null);
            if (store.get(modeAtom) === "explore") engineRef.current?.setMode("explore");
        }

        function takeWallet(wallet: WalletView | undefined) {
            if (wallet) store.set(walletAtom, wallet);
        }

        /** how the story now stands: the checklist, and the light that marks where to go */
        function takeStory(story: StoryState) {
            const was = store.get(storyAtom);
            const inHand = (state: StoryState | null) => state?.goals.find((goal) => goal.status === "active")?.id ?? null;
            if (inHand(was) !== inHand(story)) store.set(staleAtom, true);
            store.set(storyAtom, story);
            if (was?.beacon?.goalId !== story.beacon?.goalId) engineRef.current?.setBeacon(story.beacon);
        }

        /** a goal has just ended: say so, the way a friend would */
        function announce(settled: GoalSettled | null) {
            if (!settled) return;
            if (settled.status === "done") {
                toast.success(settled.title, { duration: 5000 });
                engineRef.current?.celebrate();
            } else {
                toast(`${settled.title} — it did not come off. The story will find another way.`, { icon: "🍃", duration: 7000 });
            }
        }

        /** who is marked, who has come and gone: the world as it now is, without rebuilding it */
        async function refresh() {
            const fresh = taken(await refreshAction(bookId()));
            if (!fresh) return;
            takeStory(fresh.story);
            store.set(staleAtom, false);
            store.set(learnerAtom, fresh.learner);
            store.set(chronicleAtom, fresh.chronicle);
            store.set(peopleAtom, fresh.people);
            engineRef.current?.refresh({
                characters: fresh.scene.characters, enemies: fresh.scene.enemies,
                landmarks: fresh.scene.landmarks, gates: fresh.scene.gates,
            });
        }

        /** lay pages in front of the reader, one after another */
        function read(pages: PassageView[]) {
            if (pages.length === 0) return;
            for (const page of pages) store.set(addPassageAtom, page);
            store.set(readingAtom, pages[0]);
            store.set(queueAtom, pages.slice(1));
            setMode("reading");
        }

        /** the book has moved: take in what it wrote and how things now stand */
        function takeStep(step: StoryStep) {
            store.set(mergeCardsAtom, step.words);
            takeWallet(step.wallet);
            takeStory(step.story);
            // the step brings the world as it now is
            store.set(staleAtom, false);
            store.set(peopleAtom, step.people);
            store.set(regionsAtom, step.regions);
            const before = store.get(sceneAtom);
            // a gate may have opened where there was none: the region must be rebuilt to show it
            if (before && before.region.id === step.scene.region.id && before.gates.length !== step.scene.gates.length) {
                store.set(worldReadyAtom, false);
                store.set(sceneAtom, step.scene);
            } else {
                engineRef.current?.refresh({
                    characters: step.scene.characters, enemies: step.scene.enemies,
                    landmarks: step.scene.landmarks, gates: step.scene.gates,
                });
            }
            read(step.pages);
        }

        /**
         * Let the book do what falls to it, if anything does. Safe to call at
         * any time: it does nothing while the reader is in the middle of
         * something, or when the next thing is theirs to do.
         */
        async function moveOn() {
            const due = store.get(storyAtom)?.due;
            if (due !== "page" && due !== "bend" && due !== "plan") return;
            if (store.get(modeAtom) !== "explore" || store.get(writingAtom) || store.get(bookAtom)?.status !== "active") return;
            store.set(writingAtom, true);
            hold(WRITING[due]);
            try {
                const step = taken(await advanceAction(bookId()));
                if (step) takeStep(step);
            } finally {
                store.set(writingAtom, false);
                release();
            }
        }

        /** the reader has finished with something: the story takes its turn, or the world is brought up to date */
        function after(changed: boolean) {
            const due = store.get(storyAtom)?.due;
            if (due === "page" || due === "bend" || due === "plan") void moveOn();
            else if (changed || store.get(staleAtom)) void refresh();
        }

        /* ------------------------------------------------------------ */
        /* talking                                                       */
        /* ------------------------------------------------------------ */

        async function talk(characterId: string) {
            hold("they turn toward you…");
            try {
                const opened = taken(await openDialogueAction(bookId(), characterId, here()));
                if (!opened) return;
                store.set(mergeCardsAtom, opened.words);
                store.set(dialogueAtom, { ...opened, settled: null });
                setMode("dialogue", { kind: "character", id: characterId });
                if (opened.greeted) engineRef.current?.characterGesture(characterId, "wave", 1.4);
            } finally {
                release();
            }
        }

        /** write to someone the hero has met, from wherever the hero is */
        async function write(characterId: string) {
            if (store.get(modeAtom) !== "explore" || store.get(busyAtom)) return;
            store.set(journalAtom, null);
            hold("your words find their way…");
            try {
                const opened = taken(await openChatAction(bookId(), characterId));
                if (!opened) return;
                store.set(mergeCardsAtom, opened.words);
                store.set(dialogueAtom, { ...opened, settled: null });
                setMode("dialogue");
            } finally {
                release();
            }
        }

        function takeTurn(characterId: string, turn: DialogueTurnResult) {
            store.set(mergeCardsAtom, turn.words);
            takeWallet(turn.wallet);
            takeStory(turn.story);
            const current = store.get(dialogueAtom);
            if (current && current.character.id === characterId) {
                store.set(dialogueAtom, {
                    ...current,
                    character: { ...current.character, mood: turn.mood, affinity: turn.affinity },
                    messages: [...current.messages, turn.playerMessage, turn.reply],
                    options: turn.settled ? [] : turn.options,
                    stake: turn.stake,
                    settled: turn.settled ?? current.settled,
                });
            }
            engineRef.current?.characterGesture(characterId, turn.settled?.status === "done" ? "cheer" : "talk", 2.2);
            if (turn.xp > 0) toast(`+${turn.xp} xp for speaking`, { icon: "✦", duration: 2500 });
            if (turn.settled?.status === "done") engineRef.current?.celebrate();
        }

        async function say(said: { text: string } | { optionKey: string }) {
            const dialogue = store.get(dialogueAtom);
            if (!dialogue) return false;
            engineRef.current?.heroGesture("talk", 1.6);
            const turn = taken(await sayAction(bookId(), dialogue.character.id, said, dialogue.remote));
            if (!turn) return false;
            takeTurn(dialogue.character.id, turn);
            return true;
        }

        /** the hero has made their case, and asks for an answer */
        async function askForAnswer() {
            const dialogue = store.get(dialogueAtom);
            if (!dialogue || !dialogue.stake) return false;
            const turn = taken(await askForAnswerAction(bookId(), dialogue.character.id));
            if (!turn) return false;
            takeTurn(dialogue.character.id, turn);
            return true;
        }

        function leaveDialogue() {
            const dialogue = store.get(dialogueAtom);
            stopSpeech();
            if (dialogue && !dialogue.remote) engineRef.current?.characterGesture(dialogue.character.id, "wave", 1.2);
            store.set(dialogueAtom, null);
            setMode("explore");
            // someone met for the first time now has a name over their head; an answer given moves the story on
            after(true);
        }

        /* ------------------------------------------------------------ */
        /* looking, walking                                              */
        /* ------------------------------------------------------------ */

        async function examine(landmarkId: string) {
            hold("you look closer…");
            try {
                const result = taken(await examineAction(bookId(), landmarkId, here()));
                if (!result) return;
                store.set(mergeCardsAtom, result.words);
                takeWallet(result.wallet);
                takeStory(result.story);
                announce(result.settled);
                const scene = store.get(sceneAtom);
                const landmark = scene?.landmarks.find((l) => l.id === landmarkId);
                if (landmark && !landmark.examined) engineRef.current?.refresh({ landmarks: [{ ...landmark, examined: true, sought: false }] });
                if (result.page) read([result.page]);
                else after(result.settled !== null);
            } finally {
                release();
            }
        }

        /** the hero has walked into the light that marks where a goal sent them */
        async function reached(goalId: string) {
            if (store.get(modeAtom) !== "explore") return;
            const result = await reachAction(bookId(), goalId, here());
            if (!result.ok) {
                // not near enough by the server's reckoning: let the light be walked into again
                engineRef.current?.setBeacon(store.get(storyAtom)?.beacon ?? null);
                return;
            }
            takeStory(result.data.story);
            announce(result.data.settled);
            after(result.data.settled !== null);
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
            store.set(pendingArrivalAtom, result);
            store.set(sceneAtom, result.scene);
        }

        /** the world has finished building: lift the veil, and let the story take its turn */
        function arrived() {
            store.set(worldReadyAtom, true);
            store.set(busyAtom, null);
            const arrival = store.get(pendingArrivalAtom);
            store.set(pendingArrivalAtom, null);
            // a region newly built is built from the scene as the server has just given it
            store.set(staleAtom, false);
            // the light that marks a place is shown in its own region: tell the engine again now that it has one
            engineRef.current?.setBeacon(store.get(storyAtom)?.beacon ?? null);
            if (store.get(readingAtom)) {
                setMode("reading");
                return;
            }
            setMode("explore");
            if (arrival) {
                takeStory(arrival.story);
                announce(arrival.settled);
            }
            after(false);
        }

        /* ------------------------------------------------------------ */
        /* fighting                                                      */
        /* ------------------------------------------------------------ */

        async function fight(enemyId: string) {
            if (store.get(encounterAtom) || store.get(modeAtom) === "battle") return;
            // A creature may catch the hero at any moment, and that moment may be one in which something else is
            // already under way: a conversation opening, a page being written. Then it is sent off, not fought.
            if (store.get(modeAtom) !== "explore" || store.get(busyAtom) || store.get(writingAtom)) {
                engineRef.current?.calmEnemy(enemyId, 10);
                return;
            }
            hold("it turns to face you…");
            try {
                const battle = taken(await startEncounterAction(bookId(), enemyId, here()));
                if (!battle) {
                    engineRef.current?.calmEnemy(enemyId, 10);
                    return;
                }
                if (store.get(modeAtom) !== "explore") {
                    // something else took the screen while the creature was turning round
                    engineRef.current?.calmEnemy(enemyId, 12);
                    void fleeEncounterAction(bookId(), battle.id);
                    return;
                }
                store.set(encounterAtom, battle);
                setMode("battle", { kind: "enemy", id: battle.enemy.id });
            } finally {
                release();
            }
        }

        async function answer(submission: Submission): Promise<AnswerResult | null> {
            const battle = store.get(encounterAtom);
            if (!battle) return null;
            const result = taken(await answerAction(bookId(), battle.id, submission));
            if (!result) return null;

            store.set(mergeCardsAtom, [...result.taught, ...(result.victory?.learned ?? [])]);
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
                if (!result.settled) toast("You fall back to catch your breath. It will be here when you are ready.", { icon: "🍃", duration: 5000 });
            }
            setMode("explore");
            if (result.story) takeStory(result.story);
            announce(result.settled);
            after(true);
        }

        async function flee() {
            const battle = store.get(encounterAtom);
            if (!battle) return;
            store.set(encounterAtom, null);
            engineRef.current?.calmEnemy(battle.enemy.id, 16);
            setMode("explore");
            await fleeEncounterAction(bookId(), battle.id);
        }

        /* ------------------------------------------------------------ */
        /* pages                                                         */
        /* ------------------------------------------------------------ */

        /** the page has been read: the next one written, if there is one; else back to the world */
        function closeReading() {
            stopSpeech();
            const [next, ...rest] = store.get(queueAtom);
            if (next) {
                store.set(readingAtom, next);
                store.set(queueAtom, rest);
                return;
            }
            store.set(readingAtom, null);
            if (store.get(modeAtom) === "reading") setMode("explore");
            after(false);
        }

        /** take an old page down from the shelf to read again */
        function reread(page: PassageView) {
            if (store.get(modeAtom) !== "explore") return;
            store.set(journalAtom, null);
            store.set(queueAtom, []);
            store.set(readingAtom, page);
            setMode("reading");
        }

        async function turnChapter() {
            if (store.get(writingAtom)) return;
            store.set(writingAtom, true);
            setMode("turning");
            store.set(busyAtom, "the page turns…");
            try {
                const turn = taken(await turnChapterAction(bookId()));
                if (!turn) {
                    setMode("explore");
                    return;
                }
                store.set(chaptersAtom, turn.chapters);
                const book = store.get(bookAtom);
                if (book && turn.storyCompleted) store.set(bookAtom, { ...book, status: "completed" });
                engineRef.current?.celebrate(0xc9a7ff);
                setMode("explore");
                takeStep(turn);
                if (turn.storyCompleted) toast("The End. The world is still yours to wander.", { icon: "📖", duration: 9000 });
                else if (turn.newChapter) toast(`Chapter ${turn.newChapter.index}: ${turn.newChapter.title}`, { icon: "📖", duration: 7000 });
            } finally {
                store.set(writingAtom, false);
                store.set(busyAtom, null);
            }
            // the first pages could not be written with the turn: they are written now
            if (store.get(modeAtom) === "explore") after(false);
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
            act, talk, write, say, askForAnswer, leaveDialogue, examine, reached, travel, arrived,
            fight, answer, advance, flee, closeReading, reread, turnChapter, refresh, moveOn, setMode, read,
            nearest: () => store.get(nearestAtom),
        };
    }, [store, engineRef]);
}

export type Game = ReturnType<typeof useGame>;
