"use client";

import { useState, useTransition } from "react";
import { Provider, createStore, useAtomValue, useSetAtom } from "jotai";
import Link from "next/link";
import toast from "react-hot-toast";
import type { StoryOverview } from "@/game/payloads";
import {
    enterPortalAction, inspectFeatureAction, openDialogueAction, startEncounterAction,
} from "@/server/actions/game";
import {
    busyAtom, chapterTurnReadyAtom, chaptersAtom, chronicleAtom, dialogueAtom,
    encounterAtom, mergeWordsAtom, passagesAtom, playerPosAtom, questsAtom,
    satchelAtom, sceneAtom, storyInfoAtom, wordDictAtom,
} from "./state";
import { useMapEngine, type Interactable } from "./useMapEngine";
import { WorldMap } from "./WorldMap";
import { QuestsPanel } from "./QuestsPanel";
import { BillingBadge } from "@/components/onboarding/BillingBadge";
import { Journal } from "./Journal";
import { DialoguePanel } from "./DialoguePanel";
import { EncounterOverlay } from "./EncounterOverlay";
import { showQuestUpdates } from "./questToasts";

/** the open book: map illustration on the left page, living text on the right */
export function GameScreen({ initial }: { initial: StoryOverview }) {
    const [store] = useState(() => {
        const s = createStore();
        s.set(storyInfoAtom, initial.story);
        s.set(sceneAtom, initial.scene);
        s.set(questsAtom, initial.quests);
        s.set(chaptersAtom, initial.chapters);
        s.set(passagesAtom, initial.passages);
        s.set(satchelAtom, initial.satchel);
        s.set(chronicleAtom, initial.chronicle);
        s.set(chapterTurnReadyAtom, initial.chapterTurnReady);
        s.set(encounterAtom, initial.activeEncounter);
        s.set(wordDictAtom, Object.fromEntries(initial.words.map((w) => [w.id, w])));
        s.set(playerPosAtom, { x: initial.scene.player.x, y: initial.scene.player.y });
        return s;
    });

    return (
        <Provider store={store}>
            <BookSpread />
        </Provider>
    );
}

function BookSpread() {
    const story = useAtomValue(storyInfoAtom);
    const scene = useAtomValue(sceneAtom);
    const setScene = useSetAtom(sceneAtom);
    const setDialogue = useSetAtom(dialogueAtom);
    const setEncounter = useSetAtom(encounterAtom);
    const setPassages = useSetAtom(passagesAtom);
    const setChapterTurnReady = useSetAtom(chapterTurnReadyAtom);
    const setBusy = useSetAtom(busyAtom);
    const mergeWords = useSetAtom(mergeWordsAtom);

    const { playerElRef, walkTo, nearest, teleport, getPosition } = useMapEngine();
    const [, startTransition] = useTransition();

    if (!story || !scene) return null;

    function interact(target: Interactable) {
        if (!story) return;
        const at = getPosition();
        startTransition(async () => {
            try {
                if (target.kind === "character") {
                    setDialogue(await openDialogueAction(story.id, target.id, at));
                } else if (target.kind === "enemy") {
                    setBusy("the challenger steps forward…");
                    setEncounter(await startEncounterAction(story.id, target.id, at));
                } else if (target.kind === "feature") {
                    setBusy("the narrator leans in…");
                    const result = await inspectFeatureAction(story.id, target.id, at);
                    mergeWords(result.words);
                    if (result.passage) {
                        const passage = result.passage;
                        setPassages((prev) => [...prev, passage]);
                    }
                    setChapterTurnReady(result.chapterTurnReady);
                    showQuestUpdates(result.questUpdates);
                } else {
                    setBusy("walking on…");
                    const result = await enterPortalAction(story.id, target.id, at);
                    setScene(result.scene);
                    teleport({ x: result.scene.player.x, y: result.scene.player.y });
                    if (result.arrival) {
                        mergeWords(result.arrival.words);
                        if (result.arrival.passage) {
                            const passage = result.arrival.passage;
                            setPassages((prev) => [...prev, passage]);
                        }
                        setChapterTurnReady(result.arrival.chapterTurnReady);
                        showQuestUpdates(result.arrival.questUpdates);
                    }
                }
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "The world didn't respond.");
            } finally {
                setBusy(null);
            }
        });
    }

    return (
        <main className="min-h-dvh p-3 sm:p-6 flex flex-col">
            <header className="flex items-center justify-between px-1 pb-3">
                <Link href="/" className="text-parchment/70 hover:text-parchment underline underline-offset-4">
                    ← the shelf
                </Link>
                <h1 className="font-display text-xl sm:text-2xl text-parchment text-center drop-shadow px-2">
                    {story.title}
                </h1>
                <div className="flex items-center gap-3">
                    <span className="font-hand text-xl text-gold whitespace-nowrap hidden sm:inline">{scene.map.name}</span>
                    <BillingBadge />
                </div>
            </header>

            {/* the open book */}
            <div className="flex-1 min-h-0 grid gap-3 lg:grid-cols-2 lg:gap-0 max-w-7xl w-full mx-auto">
                {/* right page first on mobile — the story stays visible; left page on desktop */}
                <div className="relative min-h-[60dvh] lg:min-h-0 order-1 lg:order-2 lg:border-l-4 lg:border-night/30 flex flex-col">
                    <Journal />
                    <DialoguePanel />
                </div>

                {/* left page: what to do (quests) above where you are (the map); the column scrolls */}
                <div className="parchment wood-frame rounded-l-sm min-h-0 order-2 lg:order-1 lg:overflow-y-auto scroll-ink">
                    <div className="p-3 sm:p-4 grid gap-3 content-start">
                        <QuestsPanel />
                        <WorldMap
                            playerElRef={playerElRef}
                            playerName={story.playerName}
                            nearest={nearest}
                            onWalk={walkTo}
                            onInteract={interact}
                        />
                    </div>
                </div>
            </div>

            <EncounterOverlay />
        </main>
    );
}
