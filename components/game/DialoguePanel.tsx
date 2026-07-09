"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import toast from "react-hot-toast";
import { sendDialogueAction } from "@/server/actions/game";
import { segmentsToPlainText } from "@/game/segments";
import { npcSprite } from "@/game/sprites";
import { SegmentText } from "./SegmentText";
import { showQuestUpdates } from "./questToasts";
import { useRecorder, useSpeaker } from "./useVoice";
import {
    chapterTurnReadyAtom, dialogueAtom, mergeWordsAtom, passagesAtom, sceneAtom, storyInfoAtom,
} from "./state";

/**
 * A living conversation. The character remembers everything — because
 * memory is a table, not a context window.
 */
export function DialoguePanel() {
    const story = useAtomValue(storyInfoAtom);
    const [dialogue, setDialogue] = useAtom(dialogueAtom);
    const setScene = useSetAtom(sceneAtom);
    const setPassages = useSetAtom(passagesAtom);
    const mergeWords = useSetAtom(mergeWordsAtom);
    const setChapterTurnReady = useSetAtom(chapterTurnReadyAtom);

    const [input, setInput] = useState("");
    const [pending, startTransition] = useTransition();
    const listRef = useRef<HTMLDivElement | null>(null);
    const { speak, speakingKey } = useSpeaker();
    const { recording, start, stop } = useRecorder((text) => setInput((v) => (v ? `${v} ${text}` : text)));

    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }, [dialogue?.messages.length]);

    if (!story || !dialogue) return null;
    const { character } = dialogue;

    function send() {
        const text = input.trim();
        if (!text || pending || !story || !dialogue) return;
        setInput("");
        // optimistic: the hero's words appear immediately
        setDialogue({
            ...dialogue,
            messages: [...dialogue.messages, { id: `local-${Date.now()}`, speaker: "player", segments: [{ t: "text", v: text }] }],
        });

        startTransition(async () => {
            try {
                const result = await sendDialogueAction(story.id, character.id, text);
                mergeWords(result.words);
                setDialogue((current) => current && ({
                    ...current,
                    character: { ...current.character, mood: result.mood, affinity: result.affinity },
                    messages: [...current.messages, result.reply],
                }));
                setScene((scene) => scene && ({
                    ...scene,
                    characters: scene.characters.map((c) =>
                        c.id === character.id ? { ...c, mood: result.mood, affinity: result.affinity } : c),
                }));
                if (result.beat) {
                    const beat = result.beat;
                    setPassages((prev) => [...prev, beat]);
                }
                setChapterTurnReady(result.chapterTurnReady);
                showQuestUpdates(result.questUpdates);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "They didn't hear you.");
            }
        });
    }

    return (
        <div className="absolute inset-0 z-20 parchment rounded-sm flex flex-col animate-page-in">
            <header className="flex items-center gap-3 border-b border-wood/30 px-4 py-3">
                <span className="text-3xl">{npcSprite(character.spriteKey)}</span>
                <div className="flex-1 min-w-0">
                    <h3 className="font-display text-xl leading-tight">{character.name}</h3>
                    <p className="text-ink-soft text-sm truncate">
                        {character.role} · feeling {character.mood}
                        {character.affinity !== 0 && (
                            <span> · {character.affinity > 20 ? "🌼 fond of you" : character.affinity > 0 ? "🙂 warming to you" : character.affinity < -20 ? "🌧 wary of you" : "😐 unsure of you"}</span>
                        )}
                    </p>
                </div>
                <button
                    onClick={() => setDialogue(null)}
                    className="text-ink-soft hover:text-ink text-xl cursor-pointer px-2"
                    aria-label="Close conversation"
                >
                    ✕
                </button>
            </header>

            <div ref={listRef} className="flex-1 overflow-y-auto scroll-ink px-4 py-3 grid gap-3 content-start">
                {dialogue.messages.length === 0 && (
                    <p className="font-hand text-2xl text-ink-soft text-center mt-6">
                        {character.name} looks up as you approach…
                    </p>
                )}
                {dialogue.messages.map((message) => (
                    <div key={message.id} className={`max-w-[85%] ${message.speaker === "player" ? "justify-self-end" : "justify-self-start"}`}>
                        <div className={`rounded-lg px-3 py-2 shadow-card prose-story text-[1rem] ${message.speaker === "player" ? "bg-moss/25" : "bg-parchment-deep"}`}>
                            <SegmentText segments={message.segments} />
                        </div>
                        {message.speaker === "character" && (
                            <button
                                onClick={() => speak(message.id, story.id, character.id, segmentsToPlainText(message.segments))}
                                className="mt-0.5 text-xs text-ink-faint hover:text-ember cursor-pointer"
                            >
                                {speakingKey === message.id ? "🔊 speaking…" : "🔈 hear them"}
                            </button>
                        )}
                    </div>
                ))}
                {pending && <p className="font-hand text-xl text-ink-soft">{character.name} is thinking…</p>}
            </div>

            <footer className="border-t border-wood/30 p-3 flex gap-2">
                <button
                    onMouseDown={start}
                    onMouseUp={stop}
                    onMouseLeave={() => recording && stop()}
                    onTouchStart={(e) => { e.preventDefault(); start(); }}
                    onTouchEnd={stop}
                    className={`px-3 rounded-md border cursor-pointer transition-colors ${recording ? "bg-ember text-parchment border-ember-deep" : "bg-parchment-deep border-wood/50 hover:bg-parchment-dark"}`}
                    title="Hold to speak"
                >
                    🎙️
                </button>
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder={`Say something to ${character.name}…`}
                    maxLength={600}
                    className="flex-1 rounded-md border border-wood/50 bg-parchment-deep px-3 py-2 outline-none focus:border-ember"
                />
                <button
                    onClick={send}
                    disabled={pending || input.trim().length === 0}
                    className="font-display px-4 rounded-md bg-ember text-parchment border-b-4 border-ember-deep shadow-card cursor-pointer disabled:opacity-50 active:translate-y-0.5 active:border-b-2"
                >
                    Send
                </button>
            </footer>
        </div>
    );
}
