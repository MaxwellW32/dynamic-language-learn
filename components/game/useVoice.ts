"use client";

import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";

/** play an NPC line aloud in their assigned voice */
export function useSpeaker() {
    const [speakingKey, setSpeakingKey] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const speak = useCallback(async (key: string, storyId: string, characterId: string, text: string) => {
        try {
            audioRef.current?.pause();
            setSpeakingKey(key);
            const res = await fetch("/api/voice/speak", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ storyId, characterId, text }),
            });
            if (!res.ok) throw new Error();
            const blob = await res.blob();
            const audio = new Audio(URL.createObjectURL(blob));
            audioRef.current = audio;
            audio.onended = () => setSpeakingKey(null);
            await audio.play();
        } catch {
            setSpeakingKey(null);
            toast.error("Their voice faded away…");
        }
    }, []);

    return { speak, speakingKey };
}

/** hold-to-speak: records the mic and transcribes on release */
export function useRecorder(onText: (text: string) => void) {
    const [recording, setRecording] = useState(false);
    const recorderRef = useRef<MediaRecorder | null>(null);

    const start = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            const chunks: Blob[] = [];
            recorder.ondataavailable = (e) => chunks.push(e.data);
            recorder.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                const blob = new Blob(chunks, { type: recorder.mimeType });
                if (blob.size < 1000) return; // an accidental tap
                try {
                    // Safari records mp4; the filename extension must match or transcription rejects it
                    const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
                    const form = new FormData();
                    form.append("audio", new File([blob], `speech.${ext}`, { type: blob.type }));
                    const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
                    if (!res.ok) throw new Error();
                    const { text } = (await res.json()) as { text: string };
                    if (text.trim()) onText(text.trim());
                } catch {
                    toast.error("Couldn't make out the words.");
                }
            };
            recorderRef.current = recorder;
            recorder.start();
            setRecording(true);
        } catch {
            toast.error("The microphone stayed silent.");
        }
    }, [onText]);

    const stop = useCallback(() => {
        recorderRef.current?.stop();
        recorderRef.current = null;
        setRecording(false);
    }, []);

    return { recording, start, stop };
}
