"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import type { Segment } from "@/game/segments";
import { storyInfoAtom, wordDictAtom } from "./state";
import { tapWordAction } from "@/server/actions/game";

/** word cards close when the reader taps anywhere else on the page */
function useCloseOnOutsideClick(open: boolean, close: () => void) {
    const ref = useRef<HTMLSpanElement | null>(null);
    const closeRef = useRef(close);
    useEffect(() => {
        closeRef.current = close;
    });

    useEffect(() => {
        if (!open) return;
        const onPress = (e: MouseEvent | TouchEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
        };
        document.addEventListener("mousedown", onPress);
        document.addEventListener("touchstart", onPress);
        return () => {
            document.removeEventListener("mousedown", onPress);
            document.removeEventListener("touchstart", onPress);
        };
    }, [open]);

    return ref;
}

/** story text: prose with tappable target-language words woven in */
export function SegmentText({ segments }: { segments: Segment[] }) {
    return (
        <>
            {segments.map((segment, i) => {
                if (segment.t === "text") return <span key={i}>{segment.v}</span>;
                if (segment.t === "vocab") return <VocabWord key={i} wordId={segment.wordId} surface={segment.surface} />;
                return <PhraseWord key={i} target={segment.target} translation={segment.translation} pronunciation={segment.pronunciation} />;
            })}
        </>
    );
}

function WordCard({ term, pronunciation, meaning }: { term: string; pronunciation?: string | null; meaning: string }) {
    return (
        <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-30 w-max max-w-52 rounded-md border border-wood/60 bg-parchment px-3 py-2 shadow-card text-center animate-page-in block">
            <span className="block font-semibold text-lg leading-tight">{term}</span>
            {pronunciation && <span className="block text-ink-faint text-sm">{pronunciation}</span>}
            <span className="block text-ink-soft text-sm mt-0.5">{meaning}</span>
        </span>
    );
}

function VocabWord({ wordId, surface }: { wordId: string; surface: string }) {
    const [open, setOpen] = useState(false);
    const ref = useCloseOnOutsideClick(open, () => setOpen(false));
    const words = useAtomValue(wordDictAtom);
    const story = useAtomValue(storyInfoAtom);
    const word = words[wordId];

    return (
        <span ref={ref} className="relative inline-block">
            <span
                className="vocab-word"
                onClick={() => {
                    setOpen((v) => !v);
                    if (!open && story) void tapWordAction(story.id, wordId).catch(() => { });
                }}
            >
                {surface}
            </span>
            {open && word && (
                <WordCard term={word.term} pronunciation={word.pronunciation} meaning={word.meaning} />
            )}
        </span>
    );
}

function PhraseWord({ target, translation, pronunciation }: { target: string; translation: string; pronunciation?: string }) {
    const [open, setOpen] = useState(false);
    const ref = useCloseOnOutsideClick(open, () => setOpen(false));
    return (
        <span ref={ref} className="relative inline-block">
            <span className="vocab-word" onClick={() => setOpen((v) => !v)}>{target}</span>
            {open && <WordCard term={target} pronunciation={pronunciation} meaning={translation} />}
        </span>
    );
}
