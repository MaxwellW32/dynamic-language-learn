"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import toast from "react-hot-toast";
import { LEAN_MAX, leanName } from "@/game/goals";
import { isLangCode, LANGUAGES } from "@/game/languages";
import type { GoalSettled, LanguageNote, MessageView, Stake } from "@/game/payloads";
import { segmentsToPlainText } from "@/game/segments";
import { Button } from "@/components/ui/Button";
import { Chip, Quill } from "@/components/ui/Panel";
import { StoryText } from "@/components/words/StoryText";
import { speakLine, useListening, useSpeaking } from "@/components/words/useSpeech";
import { bookAtom, dialogueAtom, learnerAtom, modeAtom } from "./state";
import { useGame } from "./useGame";

const VERDICT: Record<LanguageNote["verdict"], { label: string; tone: "moss" | "gold" | "ember" }> = {
    good: { label: "well said", tone: "moss" },
    close: { label: "nearly", tone: "gold" },
    off: { label: "not understood", tone: "ember" },
};

const STAKE_ICON: Record<Stake["kind"], string> = { talk: "💬", persuade: "🎭" };

/** how someone feels about you, as a word */
function warmth(affinity: number): string {
    if (affinity >= 60) return "devoted";
    if (affinity >= 35) return "fond";
    if (affinity >= 12) return "friendly";
    if (affinity > -12) return "a stranger still";
    if (affinity > -40) return "wary";
    return "cold";
}

/**
 * A conversation. The hero may pick one of the replies on offer, write their
 * own, or say it aloud — in either language. Writing in the language being
 * learned earns more, and the character's answer comes with a quiet note on
 * how it was said.
 *
 * When the hero has come to someone for something, the panel says what, shows
 * what they like and what puts them off, and how they are leaning. They
 * answer for themselves: when asked to, or sooner if their mind is made up.
 */
export function DialoguePanel() {
    const dialogue = useAtomValue(dialogueAtom);
    const mode = useAtomValue(modeAtom);
    const book = useAtomValue(bookAtom);
    const learner = useAtomValue(learnerAtom);
    const game = useGame();
    const speaking = useSpeaking();

    const [draft, setDraft] = useState("");
    const [waiting, setWaiting] = useState<string | null>(null);
    /** the hero has reached for "ask for their answer", and has yet to say they mean it */
    const [asking, setAsking] = useState(false);
    const [about, setAbout] = useState(false);
    const scroller = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const lang = book && isLangCode(book.targetLanguage) ? book.targetLanguage : "es";
    const mic = useListening(lang);

    const lines = dialogue?.messages.length ?? 0;
    const settled = dialogue?.settled ?? null;
    useEffect(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    }, [lines, waiting, settled]);

    useEffect(() => {
        if (mode !== "dialogue") return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") game.leaveDialogue();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [mode, game]);

    if (!dialogue || mode !== "dialogue" || !book) return null;

    const language = LANGUAGES[lang];
    const gloss = (learner?.immersion ?? 0) >= 3 ? "peek" as const : "below" as const;
    const { character, stake } = dialogue;
    const tastes = character.likes.length > 0 || character.dislikes.length > 0;
    // with something to win, what they like is what the hero needs to see; otherwise it is there for the asking
    const showTastes = tastes && (about || stake?.kind === "persuade");

    const send = async (said: { text: string } | { optionKey: string }, shown: string) => {
        if (waiting !== null) return;
        setAsking(false);
        setWaiting(shown);
        setDraft("");
        const ok = await game.say(said);
        setWaiting(null);
        if (!ok && "text" in said) setDraft(said.text);
        input.current?.focus();
    };

    const ask = async () => {
        if (waiting !== null) return;
        setAsking(false);
        setWaiting("");
        await game.askForAnswer();
        setWaiting(null);
    };

    const leave = () => {
        setAsking(false);
        setAbout(false);
        setDraft("");
        game.leaveDialogue();
    };

    const hear = (message: MessageView) => {
        speakLine(book.id, segmentsToPlainText(message.segments).replace(/\*[^*]*\*/g, " "), character.id)
            .catch((error) => toast.error(error instanceof Error ? error.message : "The voice faded away."));
    };

    return (
        <section className="absolute inset-x-0 bottom-0 z-30 px-2 sm:px-3 pb-2 sm:pb-5 flex justify-center pointer-events-none">
            <div className="page-float pointer-events-auto w-full max-w-3xl flex flex-col max-h-[72dvh] sm:max-h-[64dvh] animate-rise">
                <header className="flex items-center justify-between gap-3 px-4 sm:px-6 pt-3 pb-2 border-b border-wood/20">
                    <div className="min-w-0">
                        <h2 className="font-display text-2xl leading-tight truncate">{character.name}</h2>
                        <p className="text-sm text-ink-soft">
                            {character.role} · <span className="italic">{character.mood}</span> · {warmth(character.affinity)}
                            {dialogue.remote && <span> · from afar</span>}
                        </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {tastes && stake?.kind !== "persuade" && (
                            <Button variant="ghost" size="sm" onClick={() => setAbout((shown) => !shown)} aria-expanded={about}>
                                {about ? "Hide" : "About them"}
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={leave}>{dialogue.remote ? "Put down the pen" : "Say goodbye"}</Button>
                    </div>
                </header>

                {(stake || showTastes) && (
                    <div className="px-4 sm:px-6 py-2 border-b border-wood/20 bg-gold/10 grid gap-1.5">
                        {stake && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="font-display text-lg leading-tight">
                                    <span className="mr-1.5" aria-hidden>{STAKE_ICON[stake.kind]}</span>{stake.title}
                                </span>
                                {stake.lean !== null && <Lean lean={stake.lean} name={character.name} />}
                            </div>
                        )}
                        {showTastes && <Tastes likes={character.likes} dislikes={character.dislikes} />}
                    </div>
                )}

                <div ref={scroller} className="flex-1 min-h-24 overflow-y-auto scroll-ink px-4 sm:px-6 py-3 grid gap-3 content-start">
                    {dialogue.messages.slice(-14).map((message) => (
                        <Line
                            key={message.id}
                            message={message}
                            name={message.speaker === "player" ? book.playerName : character.name}
                            gloss={gloss}
                            speaking={speaking !== null && speaking.includes(segmentsToPlainText(message.segments).slice(0, 40))}
                            onHear={message.speaker === "character" ? () => hear(message) : undefined}
                        />
                    ))}
                    {waiting !== null && (
                        <>
                            {waiting && <div className="justify-self-end max-w-[85%] rounded-lg rounded-br-sm bg-ember/12 border border-ember/25 px-3 py-1.5 text-lg opacity-70">{waiting}</div>}
                            <Quill label={waiting ? `${character.name} is thinking…` : `${character.name} makes up their mind…`} />
                        </>
                    )}
                    {settled && <Settled settled={settled} name={character.name} />}
                </div>

                {settled ? (
                    <footer className="px-4 sm:px-6 pt-2 pb-3 border-t border-wood/20 flex justify-end">
                        <Button variant={settled.status === "done" ? "moss" : "primary"} onClick={leave} autoFocus>Go on</Button>
                    </footer>
                ) : (
                    <footer className="px-4 sm:px-6 pt-2 pb-3 border-t border-wood/20 grid gap-2">
                        {dialogue.options.length > 0 && waiting === null && (
                            <div className="grid gap-1.5 sm:grid-cols-3">
                                {dialogue.options.map((option) => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onClick={() => void send({ optionKey: option.key }, segmentsToPlainText(option.segments))}
                                        className={`text-left rounded-md border px-3 py-1.5 leading-snug cursor-pointer transition-colors ${option.inTarget ? "border-gold bg-gold/10 hover:bg-gold/20" : "border-wood/30 bg-parchment-deep/60 hover:bg-parchment-deep"}`}
                                    >
                                        <StoryText segments={option.segments} gloss="below" />
                                        <span className="block text-xs text-ink-faint italic mt-0.5">
                                            {option.tone}{option.inTarget ? ` · in ${language.name}` : ""}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <form
                            className="flex gap-2 items-center"
                            onSubmit={(event) => {
                                event.preventDefault();
                                const text = draft.trim();
                                if (text.length > 0) void send({ text }, text);
                            }}
                        >
                            <input
                                ref={input}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                disabled={waiting !== null}
                                maxLength={500}
                                placeholder={dialogue.remote ? `write to ${character.name} — in English, or try ${language.name}…` : `say something — in English, or try ${language.name}…`}
                                aria-label="What you say"
                                autoComplete="off"
                                className="flex-1 min-w-0 rounded-md border-2 border-wood/35 bg-[#fffaf0] px-3 py-2 text-lg outline-none focus:border-ember disabled:opacity-60"
                            />
                            {mic.supported && (
                                <button
                                    type="button"
                                    disabled={waiting !== null || mic.state === "thinking"}
                                    onPointerDown={() => mic.start().catch(() => toast.error("The microphone would not open."))}
                                    onPointerUp={async () => {
                                        try {
                                            const heard = await mic.stop();
                                            if (heard) setDraft((d) => (d ? `${d} ${heard}` : heard));
                                        } catch (error) {
                                            toast.error(error instanceof Error ? error.message : "The words were lost on the wind.");
                                        }
                                    }}
                                    className={`shrink-0 w-11 h-11 rounded-full border-2 text-xl cursor-pointer select-none touch-none ${mic.state === "recording" ? "border-rose bg-rose/20 animate-glint" : "border-wood/40 bg-parchment-deep hover:bg-parchment-dark"}`}
                                    aria-label="Hold to speak"
                                    title={`Hold to speak in ${language.name}`}
                                >
                                    {mic.state === "thinking" ? "…" : "🎙️"}
                                </button>
                            )}
                            <Button type="submit" variant="primary" disabled={waiting !== null || draft.trim().length === 0}>Say</Button>
                        </form>

                        {stake && waiting === null && (
                            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-ink-soft">
                                {asking ? (
                                    <>
                                        <span>{character.name} will say yes or no, and it will stand.</span>
                                        <Button variant="moss" size="sm" onClick={() => void ask()}>Ask them</Button>
                                        <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>Not yet</Button>
                                    </>
                                ) : (
                                    <>
                                        {!stake.canAsk && <span className="italic">say what you came to say first</span>}
                                        <Button variant="quiet" size="sm" disabled={!stake.canAsk} onClick={() => setAsking(true)}>
                                            {stake.kind === "persuade" ? "Ask for their answer" : "I have what I came for"}
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}
                    </footer>
                )}
            </div>
        </section>
    );
}

/** where someone stands on what is asked of them: a needle on a short scale, and a word for it */
function Lean({ lean, name }: { lean: number; name: string }) {
    const at = ((lean + LEAN_MAX) / (LEAN_MAX * 2)) * 100;
    return (
        <span className="flex items-center gap-2 text-sm text-ink-soft" title={`How ${name} is leaning`}>
            <span className="relative w-28 h-2 rounded-full bg-gradient-to-r from-rose/50 via-ink/10 to-moss/60" role="img" aria-label={`How ${name} is leaning: ${leanName(lean)}`}>
                <span className="absolute top-1/2 w-3.5 h-3.5 -mt-[7px] -ml-[7px] rounded-full bg-ink border-2 border-parchment shadow transition-[left] duration-500" style={{ left: `${at}%` }} />
            </span>
            <span className="italic">{leanName(lean)}</span>
        </span>
    );
}

function Tastes({ likes, dislikes }: { likes: string[]; dislikes: string[] }) {
    return (
        <div className="grid gap-1 text-sm leading-snug">
            {likes.length > 0 && (
                <p><span className="text-moss-deep font-semibold">warms to</span> <span className="text-ink-soft">{likes.join(" · ")}</span></p>
            )}
            {dislikes.length > 0 && (
                <p><span className="text-rose font-semibold">put off by</span> <span className="text-ink-soft">{dislikes.join(" · ")}</span></p>
            )}
        </div>
    );
}

/** they have answered: what came of it, said as a friend would say it */
function Settled({ settled, name }: { settled: GoalSettled; name: string }) {
    const won = settled.status === "done";
    return (
        <div className={`rounded-md border-2 px-4 py-2.5 animate-pop ${won ? "border-moss/50 bg-moss/10" : "border-wood/30 bg-parchment-deep/70"}`} role="status">
            <p className="font-display text-xl leading-tight">
                <span className="mr-1.5" aria-hidden>{won ? "✓" : "🍃"}</span>
                <span className={won ? "" : "line-through decoration-rose/60"}>{settled.title}</span>
            </p>
            <p className="text-ink-soft leading-snug mt-0.5">{settled.outcome}</p>
            {!won && <p className="font-hand text-lg text-ink-soft mt-1">{name} has given their answer. The story will find another way.</p>}
        </div>
    );
}

function Line({ message, name, gloss, speaking, onHear }: {
    message: MessageView; name: string; gloss: "below" | "peek"; speaking: boolean; onHear?: () => void;
}) {
    const mine = message.speaker === "player";
    return (
        <div className={`max-w-[88%] ${mine ? "justify-self-end" : "justify-self-start"}`}>
            <div className={`rounded-lg px-3 py-1.5 text-lg leading-relaxed ${mine ? "rounded-br-sm bg-ember/12 border border-ember/25" : "rounded-bl-sm bg-[#fffaf0]/80 border border-wood/20"}`}>
                <span className="sr-only">{name}: </span>
                <StoryText segments={message.segments} gloss={gloss} />
                {onHear && (
                    <button
                        type="button"
                        onClick={onHear}
                        className={`ml-2 align-middle text-base cursor-pointer rounded-full w-7 h-7 inline-grid place-items-center hover:bg-ink/10 ${speaking ? "animate-glint" : ""}`}
                        aria-label={`Hear ${name} say this`}
                        title="Hear it"
                    >
                        🔊
                    </button>
                )}
            </div>
            {message.note && <Note note={message.note} />}
        </div>
    );
}

/** what the reply taught about how the hero said it */
function Note({ note }: { note: LanguageNote }) {
    const verdict = VERDICT[note.verdict];
    return (
        <div className="mt-1 text-sm text-ink-soft text-right grid gap-0.5 justify-items-end">
            <Chip tone={verdict.tone}>{verdict.label}</Chip>
            {note.better && <span>more naturally: <span className="text-ink font-semibold">{note.better}</span></span>}
            {note.tip && <span className="italic">{note.tip}</span>}
        </div>
    );
}
