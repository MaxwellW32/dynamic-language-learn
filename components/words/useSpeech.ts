"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Plays speech. One voice at a time across the whole page: starting a line
 * stops whatever was being said. Audio fetched once is kept for the visit, so
 * replaying a word costs nothing and starts at once.
 */
let current: HTMLAudioElement | null = null;
const fetched = new Map<string, string>();
const listeners = new Set<(key: string | null) => void>();
let playing: string | null = null;

function announce(key: string | null) {
    playing = key;
    for (const listener of listeners) listener(key);
}

async function load(key: string, request: () => Promise<Response>): Promise<string> {
    const known = fetched.get(key);
    if (known) return known;
    const response = await request();
    if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "The voice faded away.");
    }
    const url = URL.createObjectURL(await response.blob());
    fetched.set(key, url);
    return url;
}

export function stopSpeech(): void {
    current?.pause();
    current = null;
    announce(null);
}

async function play(key: string, request: () => Promise<Response>): Promise<void> {
    stopSpeech();
    announce(key);
    try {
        const audio = new Audio(await load(key, request));
        // a newer line may have started while this one was being fetched
        if (playing !== key) return;
        current = audio;
        audio.addEventListener("ended", () => {
            if (current === audio) stopSpeech();
        });
        await audio.play();
    } catch (error) {
        if (playing === key) announce(null);
        throw error;
    }
}

export const speakWord = (entryId: number, recordingUrl?: string | null) =>
    play(`word:${entryId}`, () => fetch(recordingUrl && recordingUrl.endsWith(".mp3") ? recordingUrl : `/api/speech/word?id=${entryId}`)
        // a recording that will not load is no reason for silence: fall back to our own voice
        .then((response) => (response.ok || !recordingUrl ? response : fetch(`/api/speech/word?id=${entryId}`)))
        .catch(() => fetch(`/api/speech/word?id=${entryId}`)));

export const speakLine = (bookId: string, text: string, characterId?: string) =>
    play(`line:${characterId ?? "narrator"}:${text}`, () => fetch("/api/speech/line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, characterId, text: text.slice(0, 600) }),
    }));

/** which line is being spoken right now, for showing a speaker as busy */
export function useSpeaking(): string | null {
    const [key, setKey] = useState<string | null>(playing);
    useEffect(() => {
        listeners.add(setKey);
        return () => {
            listeners.delete(setKey);
        };
    }, []);
    return key;
}

/**
 * Hold-to-talk: records from the microphone and returns what was said as
 * text. `supported` is false where the browser cannot record.
 */
export function useListening(lang: string) {
    const [state, setState] = useState<"idle" | "recording" | "thinking">("idle");
    const recorder = useRef<MediaRecorder | null>(null);
    const chunks = useRef<Blob[]>([]);
    const supported = typeof window !== "undefined"
        && typeof navigator.mediaDevices?.getUserMedia === "function"
        && typeof window.MediaRecorder === "function";

    const start = useCallback(async () => {
        if (!supported || recorder.current) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const made = new MediaRecorder(stream);
        chunks.current = [];
        made.addEventListener("dataavailable", (event) => {
            if (event.data.size > 0) chunks.current.push(event.data);
        });
        made.start();
        recorder.current = made;
        setState("recording");
    }, [supported]);

    const stop = useCallback(async (): Promise<string> => {
        const made = recorder.current;
        if (!made) return "";
        recorder.current = null;
        const done = new Promise<void>((resolve) => made.addEventListener("stop", () => resolve(), { once: true }));
        made.stop();
        await done;
        for (const track of made.stream.getTracks()) track.stop();

        const audio = new Blob(chunks.current, { type: made.mimeType || "audio/webm" });
        if (audio.size < 800) {
            setState("idle");
            return "";
        }
        setState("thinking");
        try {
            const form = new FormData();
            form.append("audio", audio);
            form.append("lang", lang);
            const response = await fetch("/api/speech/hear", { method: "POST", body: form });
            const body = await response.json() as { text?: string; error?: string };
            if (!response.ok) throw new Error(body.error ?? "The words were lost on the wind.");
            return body.text ?? "";
        } finally {
            setState("idle");
        }
    }, [lang]);

    useEffect(() => () => {
        recorder.current?.stream.getTracks().forEach((track) => track.stop());
    }, []);

    return { state, start, stop, supported };
}
