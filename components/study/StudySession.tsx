"use client";

import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import toast from "react-hot-toast";
import type { ClientChallenge, Submission } from "@/game/challenges/types";
import type { StudyAnswer, StudyView } from "@/game/payloads";
import { ChallengeView } from "@/components/learn/ChallengeView";
import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/Panel";
import { mergeCardsAtom, openWordAtom } from "@/components/words/store";
import { answerStudyAction } from "@/server/actions/study";
import { WordChip } from "./WordChip";

/**
 * One practice session: a stage, the verdict on it, the next stage, and a
 * summary at the end. Give it a `key` of the session id so a new session
 * starts from a clean slate.
 */
export function StudySession({ view, locale, starting, onAgain, onLeave }: {
    view: StudyView;
    locale?: string;
    /** a new session is being fetched ("Practise again") */
    starting: boolean;
    onAgain: () => void;
    onLeave: () => void;
}) {
    const merge = useSetAtom(mergeCardsAtom);
    const openWord = useSetAtom(openWordAtom);
    const [stage, setStage] = useState<ClientChallenge | null>(view.stage);
    const [index, setIndex] = useState(view.index);
    const [answer, setAnswer] = useState<StudyAnswer | null>(null);
    const [locked, setLocked] = useState(false);
    const [xp, setXp] = useState(0);
    const [finished, setFinished] = useState(false);
    const verdict = useRef<HTMLDivElement>(null);

    const submit = async (submission: Submission) => {
        if (locked) return;
        setLocked(true);
        const result = await answerStudyAction(view.id, submission);
        if (!result.ok) {
            toast.error(result.error);
            setLocked(false);
            return;
        }
        merge([...result.data.taught, ...(result.data.summary?.learned ?? [])]);
        setXp((total) => total + result.data.xp);
        setAnswer(result.data);
    };

    const next = () => {
        if (!answer) return;
        if (answer.done) {
            setFinished(true);
            return;
        }
        setStage(answer.stage);
        setIndex(answer.index);
        setAnswer(null);
        setLocked(false);
    };

    // with the verdict showing, Enter moves on — and the Next button takes focus so it is where the eye goes
    useEffect(() => {
        if (!answer || finished) return;
        verdict.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        const nextButton = verdict.current?.querySelector<HTMLButtonElement>("button[data-next]") ?? null;
        nextButton?.focus({ preventScroll: true });
        const onKey = (event: KeyboardEvent) => {
            // a focused Next button already turns Enter into a click; do not advance twice
            if (event.key !== "Enter" || event.target === nextButton) return;
            event.preventDefault();
            next();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // next() reads only `answer`, which is a dependency already
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [answer, finished]);

    const open = (id: number) => openWord({ id, surface: null });

    if (finished && answer?.summary) {
        const { correct, total, learned } = answer.summary;
        return (
            <div className="text-center animate-page-in">
                <div className="font-hand text-3xl text-moss-deep">{praise(correct, total)}</div>
                <div className="mt-2 font-display text-6xl leading-none">
                    {correct}<span className="text-ink-faint text-4xl"> of {total}</span>
                </div>
                <p className="mt-2 text-lg text-ink-soft">
                    You earned <span className="font-semibold text-ink">{xp} xp</span>.
                </p>

                <div className="mt-6">
                    {learned.length > 0 ? (
                        <>
                            <p className="font-display text-xl">Learned for the first time</p>
                            <div className="mt-2 flex flex-wrap justify-center gap-2">
                                {learned.map((word) => <WordChip key={word.id} word={word} locale={locale} onOpen={() => open(word.id)} />)}
                            </div>
                        </>
                    ) : (
                        <p className="text-ink-soft italic">
                            {correct === 0 ? "These words will come round again soon." : "No new words this time — every one was an old friend."}
                        </p>
                    )}
                </div>

                <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                    <Button variant="primary" size="lg" onClick={onAgain} disabled={starting}>
                        {starting ? "Setting out the words…" : "Practise again"}
                    </Button>
                    <Button variant="quiet" size="lg" onClick={onLeave}>Back to the hall</Button>
                </div>
            </div>
        );
    }

    const answered = answer ? answer.index : index;
    return (
        <div className="grid gap-5">
            <div className="flex items-center gap-3">
                <Meter value={answered / view.total} tone="moss" className="flex-1" />
                <span className="font-display text-ink-soft whitespace-nowrap tabular-nums">
                    {Math.min(index + 1, view.total)} of {view.total}
                </span>
                <button
                    type="button"
                    onClick={onLeave}
                    className="text-sm text-ink-faint hover:text-ink underline decoration-dotted underline-offset-4 cursor-pointer"
                >
                    leave
                </button>
            </div>

            {stage ? (
                <div className={answer && !answer.correct ? "animate-shake" : ""} key={`stage-${index}`}>
                    <ChallengeView challenge={stage} lang={view.lang} locked={locked} onSubmit={submit} />
                </div>
            ) : (
                <p className="text-center text-ink-soft italic">This session has no stage left.</p>
            )}

            {answer && (
                <div
                    ref={verdict}
                    role="status"
                    className={`animate-rise rounded-md border-l-4 px-4 py-3 ${answer.correct ? "border-moss bg-moss/12" : "border-ember bg-ember/10"}`}
                >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex-1">
                            <p className={`font-display text-2xl ${answer.correct ? "text-moss-deep" : "text-ember-deep"}`}>
                                {answer.correct ? (answer.exact ? "Just so." : "Right — watch the accent.") : "Not quite."}
                            </p>
                            {(!answer.correct || !answer.exact) && (
                                <p className="text-lg">
                                    {answer.correct ? "Written exactly: " : "The answer was "}
                                    <span className="font-semibold text-ember-deep" lang={locale}>{answer.correctAnswer}</span>
                                </p>
                            )}
                            {answer.taught.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {answer.taught.map((word) => <WordChip key={word.id} word={word} locale={locale} onOpen={() => open(word.id)} />)}
                                </div>
                            )}
                        </div>
                        <Button data-next variant="primary" size="lg" onClick={next} className="sm:self-center">
                            {answer.done ? "See how you did" : "Next"}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

function praise(correct: number, total: number): string {
    const share = total > 0 ? correct / total : 0;
    if (share === 1) return "Not a single slip!";
    if (share >= 0.8) return "Beautifully done.";
    if (share >= 0.5) return "Good work — it is sinking in.";
    return "Every miss is a word you will know next time.";
}
