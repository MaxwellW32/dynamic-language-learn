"use client";

import { useState, useTransition } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import toast from "react-hot-toast";
import { fleeEncounterAction, submitAnswerAction } from "@/server/actions/game";
import type { Submission } from "@/game/challenges/types";
import type { AnswerResult } from "@/game/payloads";
import { enemySprite } from "@/game/sprites";
import { Hearts } from "@/components/ui/Hearts";
import { Parchment } from "@/components/ui/Parchment";
import { StorybookButton } from "@/components/ui/StorybookButton";
import { ChallengeView } from "./ChallengeView";
import { SegmentText } from "./SegmentText";
import { showQuestUpdates } from "./questToasts";
import {
    chapterTurnReadyAtom, encounterAtom, mergeWordsAtom, passagesAtom, sceneAtom, storyInfoAtom,
} from "./state";

/**
 * A battle of words. Every answer round-trips to the server, which holds the
 * answer key and updates the spaced-repetition schedule.
 */
export function EncounterOverlay() {
    const story = useAtomValue(storyInfoAtom);
    const [encounter, setEncounter] = useAtom(encounterAtom);
    const setScene = useSetAtom(sceneAtom);
    const setPassages = useSetAtom(passagesAtom);
    const mergeWords = useSetAtom(mergeWordsAtom);
    const setChapterTurnReady = useSetAtom(chapterTurnReadyAtom);

    const [feedback, setFeedback] = useState<AnswerResult | null>(null);
    const [pending, startTransition] = useTransition();

    if (!story || !encounter) return null;
    const done = feedback && feedback.status !== "active";

    function submit(submission: Submission) {
        if (pending || !story || !encounter) return;
        startTransition(async () => {
            try {
                const result = await submitAnswerAction(story.id, encounter.id, submission);
                setFeedback(result);
                if (result.victory) {
                    mergeWords(result.victory.words);
                    if (result.victory.passage) {
                        const passage = result.victory.passage;
                        setPassages((prev) => [...prev, passage]);
                    }
                    setScene((scene) => scene && ({
                        ...scene,
                        enemies: scene.enemies.map((e) =>
                            e.id === encounter.enemy.id ? { ...e, status: "defeated" as const } : e),
                    }));
                    setChapterTurnReady(result.victory.chapterTurnReady);
                    showQuestUpdates(result.victory.questUpdates);
                }
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "The challenge slipped away.");
            }
        });
    }

    function continueAfterFeedback() {
        if (!feedback || !encounter) return;
        if (feedback.status === "active") {
            setEncounter({
                ...encounter,
                hearts: feedback.hearts,
                stageIndex: feedback.stageIndex,
                stage: feedback.stage,
            });
            setFeedback(null);
        } else {
            setEncounter(null);
            setFeedback(null);
        }
    }

    return (
        <div className="fixed inset-0 z-40 bg-night/70 grid place-items-center p-4 animate-page-in">
            <Parchment framed className="w-full max-w-xl p-6">
                <header className="flex items-center gap-3 mb-5">
                    <span className={`text-4xl ${done ? "" : "animate-bob inline-block"}`}>
                        {feedback?.status === "won" ? "💫" : enemySprite(encounter.enemy.spriteKey)}
                    </span>
                    <div className="flex-1">
                        <h3 className="font-display text-2xl leading-tight">
                            {encounter.enemy.name}
                            {encounter.enemy.tier === "boss" && <span className="text-gold"> 👑</span>}
                        </h3>
                        <p className="text-ink-soft text-sm">
                            trial {Math.min((feedback?.stageIndex ?? encounter.stageIndex) + (feedback?.status === "active" ? 0 : 1), encounter.totalStages)} of {encounter.totalStages}
                        </p>
                    </div>
                    <Hearts count={feedback?.hearts ?? encounter.hearts} />
                    {!done && (
                        <button
                            onClick={() => {
                                void fleeEncounterAction(story.id, encounter.id).catch(() => { });
                                setEncounter(null);
                                setFeedback(null);
                            }}
                            className="text-ink-faint hover:text-ink text-sm cursor-pointer ml-1"
                            title="Slip away — the foe remains"
                        >
                            🏃 flee
                        </button>
                    )}
                </header>

                {!feedback && encounter.stageIndex === 0 && encounter.introLine && (
                    <p className="font-hand text-2xl text-ember-deep text-center mb-4">“{encounter.introLine}”</p>
                )}

                {feedback ? (
                    <div className="grid gap-4 text-center">
                        {feedback.status === "won" && feedback.victory ? (
                            <>
                                <p className="font-display text-3xl text-moss-deep">Victory!</p>
                                <p className="font-hand text-2xl text-ink-soft">“{feedback.victory.defeatLine}”</p>
                                {feedback.victory.passage && (
                                    <div className="prose-story text-left bg-parchment-deep/60 rounded-md p-4">
                                        <SegmentText segments={feedback.victory.passage.segments} />
                                    </div>
                                )}
                                <StorybookButton variant="moss" className="justify-self-center" onClick={continueAfterFeedback}>
                                    Return to the story
                                </StorybookButton>
                            </>
                        ) : feedback.status === "retreated" ? (
                            <>
                                <p className="font-display text-3xl text-ember-deep">You retreat…</p>
                                <p className="text-ink-soft">
                                    No shame in it — the words will be waiting when you return, and so will {encounter.enemy.name}.
                                </p>
                                <StorybookButton variant="quiet" className="justify-self-center" onClick={continueAfterFeedback}>
                                    Slip away
                                </StorybookButton>
                            </>
                        ) : (
                            <>
                                <p className={`font-display text-3xl ${feedback.correct ? "text-moss-deep" : "text-ember-deep"}`}>
                                    {feedback.correct ? "Well said!" : "Not quite…"}
                                </p>
                                {!feedback.correct && feedback.correctAnswer && (
                                    <p className="text-ink-soft">the answer was <span className="font-semibold">{feedback.correctAnswer}</span></p>
                                )}
                                <StorybookButton className="justify-self-center" onClick={continueAfterFeedback}>
                                    {feedback.correct ? "Press on" : "Shake it off"}
                                </StorybookButton>
                            </>
                        )}
                    </div>
                ) : encounter.stage ? (
                    <ChallengeView challenge={encounter.stage} disabled={pending} onSubmit={submit} />
                ) : null}
            </Parchment>
        </div>
    );
}
