"use client";

import { useMemo, useState } from "react";
import type { ClientChallenge, Submission } from "@/game/challenges/types";
import { StorybookButton } from "@/components/ui/StorybookButton";

/**
 * Renders one challenge and collects the player's submission. Purely
 * presentational — grading happens on the server, which holds the answers.
 */
export function ChallengeView({
    challenge,
    disabled,
    onSubmit,
}: {
    challenge: ClientChallenge;
    disabled: boolean;
    onSubmit: (submission: Submission) => void;
}) {
    if (challenge.kind === "choice") {
        return (
            <div className="grid gap-4">
                <p className="text-ink-soft text-center">{challenge.question}</p>
                <p className="text-center font-semibold text-2xl">{challenge.prompt}</p>
                {challenge.promptHint && <p className="text-center text-ink-faint -mt-3">{challenge.promptHint}</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {challenge.options.map((option) => (
                        <button
                            key={option}
                            disabled={disabled}
                            onClick={() => onSubmit({ kind: "choice", value: option })}
                            className="rounded-md border border-wood/50 bg-parchment-deep px-4 py-3 hover:bg-gold/25 cursor-pointer disabled:opacity-60 transition-colors"
                        >
                            {option}
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    if (challenge.kind === "spelling") return <SpellingChallenge challenge={challenge} disabled={disabled} onSubmit={onSubmit} />;
    if (challenge.kind === "matching") return <MatchingChallenge challenge={challenge} disabled={disabled} onSubmit={onSubmit} />;
    return <OrderChallenge challenge={challenge} disabled={disabled} onSubmit={onSubmit} />;
}

function SpellingChallenge({
    challenge, disabled, onSubmit,
}: {
    challenge: Extract<ClientChallenge, { kind: "spelling" }>;
    disabled: boolean;
    onSubmit: (s: Submission) => void;
}) {
    const [value, setValue] = useState("");
    const submit = () => value.trim() && onSubmit({ kind: "spelling", value: value.trim() });
    return (
        <div className="grid gap-4">
            <p className="text-ink-soft text-center">{challenge.question}</p>
            <p className="text-center font-semibold text-2xl">“{challenge.meaning}”</p>
            {challenge.pronunciationHint && (
                <p className="text-center text-ink-faint -mt-3">it begins {challenge.pronunciationHint}</p>
            )}
            <div className="flex gap-2 justify-center">
                <input
                    autoFocus
                    value={value}
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    className="rounded-md border border-wood/50 bg-parchment-deep px-3 py-2 outline-none focus:border-ember text-center text-lg w-56"
                    placeholder="write it…"
                />
                <StorybookButton disabled={disabled || value.trim().length === 0} onClick={submit}>
                    Cast
                </StorybookButton>
            </div>
        </div>
    );
}

function MatchingChallenge({
    challenge, disabled, onSubmit,
}: {
    challenge: Extract<ClientChallenge, { kind: "matching" }>;
    disabled: boolean;
    onSubmit: (s: Submission) => void;
}) {
    const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
    const [pairs, setPairs] = useState<Map<string, string>>(new Map());
    const pairedRight = useMemo(() => new Set(pairs.values()), [pairs]);

    function pickRight(rightKey: string) {
        if (!selectedLeft) return;
        setPairs((prev) => {
            const next = new Map(prev);
            for (const [l, r] of next) if (r === rightKey) next.delete(l);
            next.set(selectedLeft, rightKey);
            return next;
        });
        setSelectedLeft(null);
    }

    const complete = pairs.size === challenge.left.length;

    return (
        <div className="grid gap-4">
            <p className="text-ink-soft text-center">{challenge.question}</p>
            <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2 content-start">
                    {challenge.left.map((item) => (
                        <button
                            key={item.key}
                            disabled={disabled}
                            onClick={() => setSelectedLeft(selectedLeft === item.key ? null : item.key)}
                            className={`rounded-md border px-3 py-2 cursor-pointer transition-colors text-lg
                                ${selectedLeft === item.key ? "border-ember bg-gold/30" : pairs.has(item.key) ? "border-moss bg-moss/20" : "border-wood/50 bg-parchment-deep hover:bg-parchment-dark"}`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <div className="grid gap-2 content-start">
                    {challenge.right.map((item) => (
                        <button
                            key={item.key}
                            disabled={disabled || !selectedLeft && !pairedRight.has(item.key)}
                            onClick={() => pickRight(item.key)}
                            className={`rounded-md border px-3 py-2 cursor-pointer transition-colors
                                ${pairedRight.has(item.key) ? "border-moss bg-moss/20" : "border-wood/50 bg-parchment-deep hover:bg-parchment-dark"}`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>
            <StorybookButton
                className="justify-self-center"
                disabled={disabled || !complete}
                onClick={() => onSubmit({
                    kind: "matching",
                    pairs: [...pairs.entries()].map(([left, right]) => ({ left, right })),
                })}
            >
                Seal the matches
            </StorybookButton>
        </div>
    );
}

function OrderChallenge({
    challenge, disabled, onSubmit,
}: {
    challenge: Extract<ClientChallenge, { kind: "order" }>;
    disabled: boolean;
    onSubmit: (s: Submission) => void;
}) {
    const [arranged, setArranged] = useState<number[]>([]);
    const remaining = challenge.tokens.map((_, i) => i).filter((i) => !arranged.includes(i));

    return (
        <div className="grid gap-4">
            <p className="text-ink-soft text-center">{challenge.question}</p>
            <p className="text-center text-ink-faint">“{challenge.translation}”</p>

            <div className="min-h-12 rounded-md border border-dashed border-wood/50 bg-parchment-deep/60 p-2 flex flex-wrap gap-2 justify-center">
                {arranged.length === 0 && <span className="text-ink-faint self-center">tap the pieces below in order</span>}
                {arranged.map((tokenIndex, position) => (
                    <button
                        key={position}
                        disabled={disabled}
                        onClick={() => setArranged((prev) => prev.filter((_, i) => i !== position))}
                        className="rounded-md bg-gold/30 border border-gold px-3 py-1.5 cursor-pointer text-lg"
                    >
                        {challenge.tokens[tokenIndex]}
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap gap-2 justify-center">
                {remaining.map((tokenIndex) => (
                    <button
                        key={tokenIndex}
                        disabled={disabled}
                        onClick={() => setArranged((prev) => [...prev, tokenIndex])}
                        className="rounded-md border border-wood/50 bg-parchment-deep px-3 py-1.5 hover:bg-parchment-dark cursor-pointer text-lg"
                    >
                        {challenge.tokens[tokenIndex]}
                    </button>
                ))}
            </div>

            <StorybookButton
                className="justify-self-center"
                disabled={disabled || arranged.length !== challenge.tokens.length}
                onClick={() => onSubmit({ kind: "order", order: arranged })}
            >
                Speak the sentence
            </StorybookButton>
        </div>
    );
}
