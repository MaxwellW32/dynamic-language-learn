"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import toast from "react-hot-toast";
import { isLangCode, LANGUAGES } from "@/game/languages";
import type { LanguageNote, MessageView } from "@/game/payloads";
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
    const scroller = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const lang = book && isLangCode(book.targetLanguage) ? book.targetLanguage : "es";
    const mic = useListening(lang);

    const lines = dialogue?.messages.length ?? 0;
    useEffect(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    }, [lines, waiting]);

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

    const send = async (said: { text: string } | { optionKey: string }, shown: string) => {
        if (waiting !== null) return;
        setWaiting(shown);
        setDraft("");
        const ok = await game.say(said);
        setWaiting(null);
        if (!ok && "text" in said) setDraft(said.text);
        input.current?.focus();
    };

    const hear = (message: MessageView) => {
        speakLine(book.id, segmentsToPlainText(message.segments).replace(/\*[^*]*\*/g, " "), dialogue.character.id)
            .catch((error) => toast.error(error instanceof Error ? error.message : "The voice faded away."));
    };

    return (
        <section className="absolute inset-x-0 bottom-0 z-30 px-2 sm:px-3 pb-2 sm:pb-5 flex justify-center pointer-events-none">
            <div className="page-float pointer-events-auto w-full max-w-3xl flex flex-col max-h-[58dvh] animate-rise">
                <header className="flex items-center justify-between gap-3 px-4 sm:px-6 pt-3 pb-2 border-b border-wood/20">
                    <div>
                        <h2 className="font-display text-2xl leading-tight">{dialogue.character.name}</h2>
                        <p className="text-sm text-ink-soft">
                            {dialogue.character.role} · <span className="italic">{dialogue.character.mood}</span> · {warmth(dialogue.character.affinity)}
                        </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={game.leaveDialogue}>Say goodbye</Button>
                </header>

                <div ref={scroller} className="flex-1 min-h-24 overflow-y-auto scroll-ink px-4 sm:px-6 py-3 grid gap-3 content-start">
                    {dialogue.messages.slice(-14).map((message) => (
                        <Line
                            key={message.id}
                            message={message}
                            name={message.speaker === "player" ? book.playerName : dialogue.character.name}
                            gloss={gloss}
                            speaking={speaking !== null && speaking.includes(segmentsToPlainText(message.segments).slice(0, 40))}
                            onHear={message.speaker === "character" ? () => hear(message) : undefined}
                        />
                    ))}
                    {waiting !== null && (
                        <>
                            <div className="justify-self-end max-w-[85%] rounded-lg rounded-br-sm bg-ember/12 border border-ember/25 px-3 py-1.5 text-lg opacity-70">{waiting}</div>
                            <Quill label={`${dialogue.character.name} is thinking…`} />
                        </>
                    )}
                </div>

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
                            placeholder={`say something — in English, or try ${language.name}…`}
                            aria-label="What you say"
                            autoComplete="off"
                            className="flex-1 rounded-md border-2 border-wood/35 bg-[#fffaf0] px-3 py-2 text-lg outline-none focus:border-ember disabled:opacity-60"
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
                </footer>
            </div>
        </section>
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
