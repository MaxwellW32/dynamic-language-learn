"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStore, Provider, useAtomValue, useSetAtom, useStore } from "jotai";
import type { EngineEvents, Interactable, WorldEngine } from "@/engine";
import type { BookOverview } from "@/game/payloads";
import { segmentsToPlainText } from "@/game/segments";
import { syncPositionAction } from "@/server/actions/game";
import { cardsAtom, openWordAtom } from "@/components/words/store";
import { WordCard } from "@/components/words/WordCard";
import { BattlePanel } from "./BattlePanel";
import { installDevHook } from "./devHook";
import { DialoguePanel } from "./DialoguePanel";
import { Hud } from "./Hud";
import { Journal } from "./Journal";
import { PassagePanel } from "./PassagePanel";
import {
    bookAtom, busyAtom, chaptersAtom, chronicleAtom, dialogueAtom, encounterAtom,
    journalAtom, learnerAtom, modeAtom, nearestAtom, passagesAtom, peopleAtom, queueAtom, readingAtom, regionsAtom,
    sceneAtom, stickAtom, storyAtom, walletAtom, worldReadyAtom,
} from "./state";
import { EngineContext, useEngine, useGame } from "./useGame";
import { WorldCanvas } from "./WorldCanvas";

const SYNC_EVERY_MS = 8000;

/** an open book: the world, and the pages laid over it */
export function GameScreen({ initial }: { initial: BookOverview }) {
    const [store] = useState(() => {
        const s = createStore();
        s.set(bookAtom, initial.book);
        s.set(sceneAtom, initial.scene);
        s.set(regionsAtom, initial.regions);
        s.set(storyAtom, initial.story);
        s.set(peopleAtom, initial.people);
        s.set(chaptersAtom, initial.chapters);
        s.set(passagesAtom, initial.passages);
        s.set(chronicleAtom, initial.chronicle);
        s.set(learnerAtom, initial.learner);
        s.set(walletAtom, initial.wallet);
        s.set(encounterAtom, initial.activeEncounter);
        s.set(cardsAtom, Object.fromEntries(initial.words.map((w) => [w.id, w])));
        // a book opened for the first time begins with its first pages in front of the reader
        const untouched = initial.chronicle.length <= 1 && initial.story.chapter.index === 1
            && initial.story.goals.every((goal) => goal.status === "active");
        if (untouched && initial.passages.length > 0 && initial.passages.length <= 3) {
            s.set(readingAtom, initial.passages[0]);
            s.set(queueAtom, initial.passages.slice(1));
        }
        return s;
    });
    const engineRef = useRef<WorldEngine | null>(null);

    return (
        <Provider store={store}>
            <EngineContext.Provider value={engineRef}>
                <Book />
            </EngineContext.Provider>
        </Provider>
    );
}

function Book() {
    const store = useStore();
    const game = useGame();
    const engineRef = useEngine();
    const book = useAtomValue(bookAtom);
    const scene = useAtomValue(sceneAtom);
    const ready = useAtomValue(worldReadyAtom);
    const busy = useAtomValue(busyAtom);
    const setNearest = useSetAtom(nearestAtom);
    const setStick = useSetAtom(stickAtom);
    const openWord = useSetAtom(openWordAtom);

    // the engine calls these for as long as it lives, so they read the store rather than close over state
    const events = useMemo<EngineEvents>(() => ({
        onNearest: (target: Interactable | null) => setNearest(target),
        onAct: (target) => game.act(target),
        onContact: (enemyId) => void game.fight(enemyId),
        onReach: (goalId) => void game.reached(goalId),
        onWord: (entryId) => openWord({ id: entryId, surface: null }),
        onStick: (stick) => setStick(stick),
    }), [game, setNearest, setStick, openWord]);

    const onEngine = useCallback((engine: WorldEngine | null) => {
        engineRef.current = engine;
        installDevHook(engine, {
            /** what the pages over the world are showing, for a script that cannot see */
            state: () => {
                const dialogue = store.get(dialogueAtom);
                const battle = store.get(encounterAtom);
                const reading = store.get(readingAtom);
                return {
                    mode: store.get(modeAtom),
                    busy: store.get(busyAtom),
                    ready: store.get(worldReadyAtom),
                    region: store.get(sceneAtom)?.region.name ?? null,
                    nearest: store.get(nearestAtom),
                    reading: reading ? { id: reading.id, text: segmentsToPlainText(reading.segments).slice(0, 300), more: store.get(queueAtom).length } : null,
                    dialogue: dialogue ? {
                        with: dialogue.character.name, mood: dialogue.character.mood, affinity: dialogue.character.affinity,
                        lines: dialogue.messages.length,
                        last: segmentsToPlainText(dialogue.messages[dialogue.messages.length - 1]?.segments ?? []).slice(0, 300),
                        options: dialogue.options.map((o) => segmentsToPlainText(o.segments)),
                        likes: dialogue.character.likes, dislikes: dialogue.character.dislikes,
                        stake: dialogue.stake, settled: dialogue.settled, remote: dialogue.remote,
                    } : null,
                    battle: battle ? { enemy: battle.enemy.name, hearts: battle.hearts, stage: battle.stageIndex + 1, of: battle.totalStages, kind: battle.stage?.kind ?? null } : null,
                    story: store.get(storyAtom),
                    people: store.get(peopleAtom).map((person) => person.name),
                    wallet: store.get(walletAtom)?.balanceMicros ?? null,
                    journal: store.get(journalAtom),
                };
            },
            act: () => {
                const target = store.get(nearestAtom);
                if (target) game.act(target);
                return target;
            },
            /** walk the hero to whatever the goal in hand points at in this region, and act on it */
            seek: async () => {
                const engine = engineRef.current;
                if (!engine) return false;
                const beacon = store.get(storyAtom)?.beacon;
                if (beacon && beacon.regionId === store.get(sceneAtom)?.region.id) return engine.walkTo({ x: beacon.x, z: beacon.z });
                return engine.walkToSought();
            },
        });
    }, [engineRef, game, store]);

    /** a region has finished building: the first one when the book opens, later ones after travel */
    const onLoaded = useCallback(() => {
        game.arrived();
        // an encounter left open when the tab was closed is picked up where it stood
        const battle = store.get(encounterAtom);
        if (battle) game.setMode("battle", { kind: "enemy", id: battle.enemy.id });
    }, [game, store]);

    // where the hero stands is saved now and then, and when the tab is put away
    useEffect(() => {
        if (!book) return;
        let last = { x: NaN, z: NaN };
        let lastAt = Date.now();
        const save = () => {
            const engine = engineRef.current;
            if (!engine || store.get(modeAtom) === "travelling") return;
            const at = engine.heroPosition();
            const seconds = Math.min(120, Math.round((Date.now() - lastAt) / 1000));
            if (Math.hypot(at.x - last.x, at.z - last.z) < 0.5 && seconds < 60) return;
            last = at;
            lastAt = Date.now();
            void syncPositionAction(book.id, at, document.hidden ? 0 : seconds);
        };
        const timer = window.setInterval(save, SYNC_EVERY_MS);
        const onHide = () => {
            if (document.hidden) save();
        };
        document.addEventListener("visibilitychange", onHide);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onHide);
            save();
        };
    }, [book, engineRef, store]);

    if (!book || !scene) return null;

    return (
        <main className="fixed inset-0 overflow-hidden bg-night">
            <WorldCanvas scene={scene} events={events} onEngine={onEngine} onLoaded={onLoaded} />

            {/* the veil: parchment drawn across the world while it is being built */}
            <div
                className={`absolute inset-0 z-30 grid place-items-center parchment transition-opacity duration-700 ${ready ? "opacity-0 pointer-events-none" : "opacity-100"}`}
                aria-hidden={ready}
            >
                <div className="text-center px-6">
                    <p className="font-hand text-2xl text-ink-soft">{busy ?? "opening the book…"}</p>
                    <h2 className="font-display text-4xl sm:text-5xl text-ink mt-1">{scene.region.name}</h2>
                    <p className="mt-3 text-ink-soft max-w-md mx-auto">{scene.region.description}</p>
                </div>
            </div>

            <Hud />
            <PassagePanel />
            <DialoguePanel />
            <BattlePanel />
            <Journal />
            <WordCard lang={book.targetLanguage} />
        </main>
    );
}
