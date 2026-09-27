"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { ClientChallenge, Submission } from "@/game/challenges/types";
import { Button } from "@/components/ui/Button";
import { speakWord, useListening, useSpeaking } from "@/components/words/useSpeech";

type Props = {
    challenge: ClientChallenge;
    lang: string;
    /** true while the answer is on its way to be graded, or has been */
    locked: boolean;
    onSubmit: (submission: Submission) => void;
};

/**
 * One challenge, whatever its kind. It only gathers an answer — grading
 * happens on the server, which is the only place the right answer lives.
 *
 * Give it a `key` that changes with each stage, so its state starts fresh.
 */
export function ChallengeView({ challenge, lang, locked, onSubmit }: Props) {
    switch (challenge.kind) {
        case "choice":
            return (
                <Choice
                    question={challenge.question}
                    prompt={challenge.prompt}
                    hint={challenge.promptHint}
                    options={challenge.options}
                    locked={locked}
                    onPick={(value) => onSubmit({ kind: "choice", value })}
                />
            );
        case "listen":
            return <Listen challenge={challenge} locked={locked} onPick={(value) => onSubmit({ kind: "choice", value })} />;
        case "spelling":
            return <Spelling challenge={challenge} locked={locked} onSubmit={onSubmit} />;
        case "matching":
            return <Matching challenge={challenge} locked={locked} onSubmit={onSubmit} />;
        case "order":
            return <Order challenge={challenge} locked={locked} onSubmit={onSubmit} />;
        case "speak":
            return <Speak challenge={challenge} lang={lang} locked={locked} onSubmit={onSubmit} />;
    }
}

function Question({ children }: { children: React.ReactNode }) {
    return <p className="font-hand text-xl text-ink-soft text-center">{children}</p>;
}

const optionClass = (chosen: boolean) =>
    `w-full rounded-md border-2 px-3 py-2.5 text-left text-lg leading-snug cursor-pointer transition-colors disabled:cursor-default ${
        chosen ? "border-ember bg-ember/15" : "border-wood/30 bg-parchment-deep/70 hover:border-ember/70 hover:bg-parchment-deep disabled:hover:border-wood/30"}`;

function Choice({ question, prompt, hint, options, locked, onPick }: {
    question: string; prompt: string | null; hint?: string; options: string[]; locked: boolean; onPick: (value: string) => void;
}) {
    const [picked, setPicked] = useState<string | null>(null);

    // 1–4 on the keyboard pick an answer: a battle should not need the mouse
    useEffect(() => {
        if (locked) return;
        const onKey = (event: KeyboardEvent) => {
            const index = Number(event.key) - 1;
            if (Number.isInteger(index) && index >= 0 && index < options.length) {
                setPicked(options[index]);
                onPick(options[index]);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [locked, options, onPick]);

    return (
        <div className="grid gap-3">
            <Question>{question}</Question>
            {prompt !== null && (
                <div className="text-center">
                    <div className="font-display text-3xl sm:text-4xl text-ember-deep leading-tight break-words">{prompt}</div>
                    {hint && <div className="text-sm text-ink-soft mt-1">{hint}</div>}
                </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
                {options.map((option, i) => (
                    <button
                        key={option}
                        type="button"
                        disabled={locked}
                        className={optionClass(picked === option)}
                        onClick={() => {
                            setPicked(option);
                            onPick(option);
                        }}
                    >
                        <span className="text-ink-faint text-sm mr-2">{i + 1}</span>
                        {option}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Listen({ challenge, locked, onPick }: {
    challenge: Extract<ClientChallenge, { kind: "listen" }>; locked: boolean; onPick: (value: string) => void;
}) {
    const speaking = useSpeaking();
    const play = () => speakWord(challenge.entryId).catch((error) => toast.error(error instanceof Error ? error.message : "The voice faded away."));
    const played = useRef(false);

    useEffect(() => {
        if (played.current) return;
        played.current = true;
        play();
        // the word is said once when the stage appears; after that the reader asks for it
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="grid gap-3">
            <div className="grid place-items-center">
                <button
                    type="button"
                    onClick={play}
                    className={`w-20 h-20 rounded-full border-2 border-ember bg-parchment-deep hover:bg-parchment-dark text-4xl cursor-pointer ${speaking === `word:${challenge.entryId}` ? "animate-glint" : ""}`}
                    aria-label="Hear the word again"
                >
                    🔊
                </button>
            </div>
            <Choice question={challenge.question} prompt={null} options={challenge.options} locked={locked} onPick={onPick} />
        </div>
    );
}

function Spelling({ challenge, locked, onSubmit }: {
    challenge: Extract<ClientChallenge, { kind: "spelling" }>; locked: boolean; onSubmit: (submission: Submission) => void;
}) {
    const [value, setValue] = useState("");
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => input.current?.focus(), []);

    return (
        <form
            className="grid gap-3"
            onSubmit={(event) => {
                event.preventDefault();
                if (value.trim().length > 0 && !locked) onSubmit({ kind: "spelling", value: value.trim() });
            }}
        >
            <Question>{challenge.question}</Question>
            <div className="text-center">
                <div className="font-display text-3xl text-ember-deep leading-tight">{challenge.meaning}</div>
                {challenge.pronunciationHint && <div className="text-sm text-ink-soft mt-1">it begins: {challenge.pronunciationHint}</div>}
            </div>
            <div className="flex gap-2">
                <input
                    ref={input}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    disabled={locked}
                    placeholder="write the word…"
                    aria-label="Your answer"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="flex-1 rounded-md border-2 border-wood/40 bg-[#fffaf0] px-3 py-2 text-xl outline-none focus:border-ember"
                />
                <Button type="submit" variant="primary" disabled={locked || value.trim().length === 0}>Cast</Button>
            </div>
        </form>
    );
}

function Matching({ challenge, locked, onSubmit }: {
    challenge: Extract<ClientChallenge, { kind: "matching" }>; locked: boolean; onSubmit: (submission: Submission) => void;
}) {
    const [left, setLeft] = useState<string | null>(null);
    const [pairs, setPairs] = useState<Record<string, string>>({});
    const takenRight = new Set(Object.values(pairs));
    const complete = Object.keys(pairs).length === challenge.left.length;

    const pairUp = (rightKey: string) => {
        if (locked || left === null) return;
        setPairs((current) => {
            const next: Record<string, string> = {};
            // a meaning can belong to one word only: taking it frees whoever held it
            for (const [l, r] of Object.entries(current)) if (r !== rightKey && l !== left) next[l] = r;
            next[left] = rightKey;
            return next;
        });
        setLeft(null);
    };

    const numberOf = (leftKey: string) => challenge.left.findIndex((item) => item.key === leftKey) + 1;

    return (
        <div className="grid gap-3">
            <Question>{challenge.question}</Question>
            <p className="text-center text-sm text-ink-faint -mt-2">tap a word, then its meaning</p>
            <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2 content-start">
                    {challenge.left.map((item, i) => (
                        <button
                            key={item.key}
                            type="button"
                            disabled={locked}
                            onClick={() => setLeft(item.key)}
                            className={`${optionClass(left === item.key)} ${pairs[item.key] ? "!border-moss/70 !bg-moss/10" : ""}`}
                        >
                            <span className="text-ink-faint text-sm mr-2">{i + 1}</span>
                            <span className="font-semibold text-ember-deep">{item.label}</span>
                        </button>
                    ))}
                </div>
                <div className="grid gap-2 content-start">
                    {challenge.right.map((item) => {
                        const owner = Object.entries(pairs).find(([, r]) => r === item.key)?.[0];
                        return (
                            <button
                                key={item.key}
                                type="button"
                                disabled={locked || (left === null && !owner)}
                                onClick={() => (left !== null ? pairUp(item.key) : owner && setPairs((current) => {
                                    const next = { ...current };
                                    delete next[owner];
                                    return next;
                                }))}
                                className={`${optionClass(false)} ${takenRight.has(item.key) ? "!border-moss/70 !bg-moss/10" : ""}`}
                            >
                                {owner && <span className="text-moss-deep text-sm mr-2">{numberOf(owner)}</span>}
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            <Button
                variant="primary"
                disabled={locked || !complete}
                onClick={() => onSubmit({ kind: "matching", pairs: Object.entries(pairs).map(([l, r]) => ({ left: l, right: r })) })}
            >
                Cast
            </Button>
        </div>
    );
}

function Order({ challenge, locked, onSubmit }: {
    challenge: Extract<ClientChallenge, { kind: "order" }>; locked: boolean; onSubmit: (submission: Submission) => void;
}) {
    const [order, setOrder] = useState<number[]>([]);
    const used = new Set(order);

    return (
        <div className="grid gap-3">
            <Question>{challenge.question}</Question>
            <p className="text-center text-lg italic text-ink-soft">“{challenge.translation}”</p>

            <div className="min-h-14 rounded-md border-2 border-dashed border-wood/40 bg-[#fffaf0]/70 p-2 flex flex-wrap gap-1.5 content-start">
                {order.length === 0 && <span className="text-ink-faint px-1">tap the pieces in order…</span>}
                {order.map((index, position) => (
                    <button
                        key={`${index}-${position}`}
                        type="button"
                        disabled={locked}
                        onClick={() => setOrder((current) => current.filter((_, i) => i !== position))}
                        className="rounded border border-ember/60 bg-ember/10 px-2.5 py-1 text-lg cursor-pointer hover:bg-ember/20"
                    >
                        {challenge.tokens[index]}
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap gap-1.5 justify-center">
                {challenge.tokens.map((token, index) => (
                    <button
                        key={index}
                        type="button"
                        disabled={locked || used.has(index)}
                        onClick={() => setOrder((current) => [...current, index])}
                        className="rounded border border-wood/40 bg-parchment-deep px-2.5 py-1 text-lg cursor-pointer hover:bg-parchment-dark disabled:opacity-25 disabled:cursor-default"
                    >
                        {token}
                    </button>
                ))}
            </div>

            <Button
                variant="primary"
                disabled={locked || order.length !== challenge.tokens.length}
                onClick={() => onSubmit({ kind: "order", order })}
            >
                Cast
            </Button>
        </div>
    );
}

function Speak({ challenge, lang, locked, onSubmit }: {
    challenge: Extract<ClientChallenge, { kind: "speak" }>; lang: string; locked: boolean; onSubmit: (submission: Submission) => void;
}) {
    const { state, start, stop, supported } = useListening(lang);
    const [typed, setTyped] = useState("");

    const finish = async () => {
        try {
            const heard = await stop();
            if (heard.length === 0) {
                toast("Nothing was heard — hold the button while you speak.");
                return;
            }
            onSubmit({ kind: "speak", heard });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "The words were lost on the wind.");
        }
    };

    return (
        <div className="grid gap-3">
            <Question>{challenge.question}</Question>
            <div className="text-center">
                <div className="font-display text-4xl text-ember-deep leading-tight">{challenge.prompt}</div>
                {challenge.promptHint && <div className="text-sm text-ink-soft mt-1">{challenge.promptHint}</div>}
                <div className="text-ink-soft italic mt-1">{challenge.meaning}</div>
            </div>
            {supported ? (
                <div className="grid place-items-center gap-1">
                    <button
                        type="button"
                        disabled={locked || state === "thinking"}
                        onPointerDown={() => start().catch(() => toast.error("The microphone would not open."))}
                        onPointerUp={finish}
                        className={`w-20 h-20 rounded-full border-2 text-4xl cursor-pointer select-none touch-none ${state === "recording" ? "border-rose bg-rose/20 animate-glint" : "border-ember bg-parchment-deep hover:bg-parchment-dark"}`}
                        aria-label="Hold to speak"
                    >
                        🎙️
                    </button>
                    <span className="font-hand text-lg text-ink-soft">
                        {state === "recording" ? "listening…" : state === "thinking" ? "making it out…" : "hold to speak"}
                    </span>
                </div>
            ) : (
                <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (typed.trim().length > 0 && !locked) onSubmit({ kind: "speak", heard: typed.trim() });
                    }}
                >
                    <input
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        disabled={locked}
                        placeholder="no microphone here — write it instead"
                        aria-label="Your answer"
                        className="flex-1 rounded-md border-2 border-wood/40 bg-[#fffaf0] px-3 py-2 text-xl outline-none focus:border-ember"
                    />
                    <Button type="submit" variant="primary" disabled={locked || typed.trim().length === 0}>Cast</Button>
                </form>
            )}
        </div>
    );
}
