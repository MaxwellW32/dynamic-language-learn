/**
 * Story text as DOM, for the places the engine itself puts words on screen
 * (speech bubbles over characters). The React side has its own renderer for
 * panels; both follow the same rule — every target-language word is a button.
 */
import type { Segment } from "@/game/segments";

export function segmentsToElement(
    segments: Segment[],
    onWord: (entryId: number) => void,
    options: { translation: boolean },
): HTMLElement {
    const root = document.createElement("div");
    const line = document.createElement("div");
    line.className = "wb-bark-line";
    root.appendChild(line);

    const wordButton = (text: string, entryId: number) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wb-word";
        button.textContent = text;
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            onWord(entryId);
        });
        return button;
    };

    const translations: string[] = [];
    for (const segment of segments) {
        if (segment.t === "text") {
            line.appendChild(document.createTextNode(segment.v));
        } else if (segment.t === "word") {
            line.appendChild(wordButton(segment.s, segment.id));
        } else {
            const span = document.createElement("span");
            span.className = "wb-tl";
            for (const token of segment.tk) {
                if (token.id !== undefined) span.appendChild(wordButton(token.s, token.id));
                else span.appendChild(document.createTextNode(token.s));
            }
            if (segment.tk.length === 0) span.textContent = segment.v;
            line.appendChild(span);
            translations.push(segment.tr);
        }
    }

    if (options.translation && translations.length > 0) {
        const gloss = document.createElement("div");
        gloss.className = "wb-bark-gloss";
        gloss.textContent = translations.join(" ");
        root.appendChild(gloss);
    }
    return root;
}
