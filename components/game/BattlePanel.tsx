"use client";

import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { Submission } from "@/game/challenges/types";
import type { WordCard } from "@/game/dictionary";
import type { AnswerResult } from "@/game/payloads";
import { Button } from "@/components/ui/Button";
import { Hearts, Meter } from "@/components/ui/Panel";
import { ChallengeView } from "@/components/learn/ChallengeView";
import { StoryText } from "@/components/words/StoryText";
import { openWordAtom } from "@/components/words/store";
import { bookAtom, encounterAtom, modeAtom } from "./state";
import { useGame } from "./useGame";

const TIER: Record<string, string> = { minion: "", elite: "Elite", boss: "Boss" };

/**
 * A battle of words. The creature asks; a right answer is a spell cast, a
 * wrong one costs a heart. The panel only gathers answers and shows verdicts —
 * what is right lives on the server.
 */
export function BattlePanel() {
    const battle = useAtomValue(encounterAtom);
    const mode = useAtomValue(modeAtom);
    const book = useAtomValue(bookAtom);
    const game = useGame();

    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<AnswerResult | null>(null);
    const [begun, setBegun] = useState<string | null>(null);

    // Enter moves on from a verdict
    useEffect(() => {
        if (!result) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                event.preventDefault();
                const shown = result;
                setResult(null);
                game.advance(shown);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [result, game]);

    if (!battle || mode !== "battle" || !book) return null;

    const submit = async (submission: Submission) => {
        if (pending || result) return;
        setPending(true);
        const graded = await game.answer(submission);
        setPending(false);
        if (graded) setResult(graded);
    };

    const next = () => {
        if (!result) return;
        const shown = result;
        setResult(null);
        game.advance(shown);
    };

    const opening = begun !== battle.id && battle.stageIndex === 0 && !result;
    const hearts = result ? result.hearts : battle.hearts;
    const done = result ? result.stageIndex : battle.stageIndex;

    return (
        <section className="absolute inset-x-0 bottom-0 z-30 px-2 sm:px-3 pb-2 sm:pb-5 flex justify-center pointer-events-none">
            <div className={`page-float pointer-events-auto w-full max-w-2xl max-h-[74dvh] overflow-y-auto scroll-ink animate-rise ${result && !result.correct ? "animate-shake" : ""}`}>
                <header className="flex items-center justify-between gap-3 px-4 sm:px-6 pt-3 pb-2 border-b border-wood/20">
                    <div>
                        <h2 className="font-display text-2xl leading-tight">
                            {battle.enemy.name}
                            {TIER[battle.enemy.tier] && <span className="ml-2 align-middle text-xs tracking-widest uppercase text-ember-deep">{TIER[battle.enemy.tier]}</span>}
                        </h2>
                        <Meter value={done / battle.totalStages} tone="ember" className="w-40 mt-1.5" />
                    </div>
                    <div className="text-right">
                        <Hearts hearts={hearts} max={battle.maxHearts} />
                        <button type="button" onClick={() => void game.flee()} className="block ml-auto text-sm text-ink-faint underline underline-offset-2 cursor-pointer hover:text-ink">
                            back away
                        </button>
                    </div>
                </header>

                <div className="px-4 sm:px-6 py-4">
                    {opening ? (
                        <div className="text-center grid gap-3 py-2">
                            {battle.enemy.description && <p className="text-ink-soft">{battle.enemy.description}</p>}
                            <p className="prose-story italic">“{battle.introLine}”</p>
                            <p className="font-hand text-xl text-ink-soft">answer its challenges to cast your spells</p>
                            <Button variant="primary" size="lg" className="justify-self-center" onClick={() => setBegun(battle.id)}>Stand your ground</Button>
                        </div>
                    ) : result ? (
                        <Verdict result={result} onNext={next} />
                    ) : battle.stage ? (
                        <ChallengeView
                            key={`${battle.id}:${battle.stageIndex}`}
                            challenge={battle.stage}
                            lang={book.targetLanguage}
                            locked={pending}
                            onSubmit={submit}
                        />
                    ) : null}
                </div>
            </div>
        </section>
    );
}

function WordChips({ words, label }: { words: WordCard[]; label: string }) {
    const open = useSetAtom(openWordAtom);
    if (words.length === 0) return null;
    return (
        <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
            <span className="text-sm text-ink-faint">{label}</span>
            {words.map((word) => (
                <span key={word.id} className="text-lg">
                    <button type="button" className="wb-word" onClick={() => open({ id: word.id, surface: null })}>{word.lemma}</button>
                    <span className="text-ink-soft text-base"> {word.gloss}</span>
                </span>
            ))}
        </div>
    );
}

function Verdict({ result, onNext }: { result: AnswerResult; onNext: () => void }) {
    const won = result.status === "won";
    const lost = result.status === "retreated";

    return (
        <div className="grid gap-3 text-center animate-pop">
            <div className={`font-display text-3xl ${result.correct ? "text-moss-deep" : "text-rose"}`}>
                {won ? "Victory!" : result.correct ? (result.exact ? "Your spell lands!" : "It lands — just") : lost ? "You are driven back" : "It strikes back"}
            </div>

            {result.correct && !result.exact && (
                <p className="text-ink-soft">watch the accents: <span className="font-semibold text-ink">{result.correctAnswer}</span></p>
            )}
            {!result.correct && result.correctAnswer && (
                <p className="text-lg">the answer was <span className="font-semibold text-ember-deep">{result.correctAnswer}</span></p>
            )}

            <WordChips words={result.taught} label={result.correct ? "you used" : "remember"} />

            {result.victory && (
                <div className="grid gap-3 border-t border-wood/20 pt-3">
                    <p className="prose-story italic">“{result.victory.defeatLine}”</p>
                    {result.victory.passage && (
                        <p className="prose-story text-left">
                            <StoryText segments={result.victory.passage.segments} gloss="below" />
                        </p>
                    )}
                    <WordChips words={result.victory.learned} label="learned in this battle" />
                </div>
            )}

            {result.xp > 0 && <p className="font-hand text-xl text-gold">+{result.xp} xp</p>}

            <Button variant={won ? "moss" : "primary"} size="lg" className="justify-self-center" onClick={onNext} autoFocus>
                {won ? "Onward" : lost ? "Fall back" : "Next"}
            </Button>
        </div>
    );
}
