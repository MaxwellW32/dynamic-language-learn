"use client";

import { Fragment, useState } from "react";
import { useSetAtom } from "jotai";
import type { Segment } from "@/game/segments";
import { openWordAtom } from "./store";

type Props = {
    segments: Segment[];
    /**
     * How translations of whole phrases are shown. "below" prints them under
     * the phrase, for a reader who needs them; "peek" hides them behind a tap,
     * for one who is ready to try without.
     */
    gloss?: "below" | "peek" | "none";
    className?: string;
};

/**
 * Story text. Prose in the reader's language is plain; every word of the
 * language being learned is a button that opens its card.
 */
export function StoryText({ segments, gloss = "peek", className = "" }: Props) {
    const open = useSetAtom(openWordAtom);
    const [peeked, setPeeked] = useState<Record<number, boolean>>({});

    return (
        <span className={className}>
            {segments.map((segment, i) => {
                if (segment.t === "text") return <Prose key={i} text={segment.v} />;
                if (segment.t === "word") {
                    return (
                        <button key={i} type="button" className="wb-word" onClick={() => open({ id: segment.id, surface: segment.s })}>
                            {segment.s}
                        </button>
                    );
                }
                const shown = gloss === "below" || peeked[i] === true;
                return (
                    <Fragment key={i}>
                        <span className="wb-tl" lang="und">
                            {segment.tk.length === 0 ? segment.v : segment.tk.map((token, k) => (
                                token.id !== undefined
                                    ? <button key={k} type="button" className="wb-word" onClick={() => open({ id: token.id!, surface: token.s })}>{token.s}</button>
                                    : <span key={k}>{token.s}</span>
                            ))}
                        </span>
                        {segment.tr && gloss === "peek" && !shown && (
                            <button type="button" className="wb-tl-peek" onClick={() => setPeeked((p) => ({ ...p, [i]: true }))} aria-label="Show what this means">
                                ?
                            </button>
                        )}
                        {segment.tr && shown && <span className="wb-tl-gloss">{segment.tr}</span>}
                    </Fragment>
                );
            })}
        </span>
    );
}

/** prose, with *small actions* set in italics */
function Prose({ text }: { text: string }) {
    const parts = text.split(/(\*[^*\n]{1,120}\*)/g);
    return (
        <>
            {parts.map((part, i) => (
                part.length > 2 && part.startsWith("*") && part.endsWith("*")
                    ? <em key={i} className="text-ink-soft">{part.slice(1, -1)}</em>
                    : <Fragment key={i}>{part}</Fragment>
            ))}
        </>
    );
}
