import "server-only";
import type { Segment } from "@/game/segments";
import type { VocabWord } from "@/db/schema";
import type { AiSegment } from "./schemas";

/**
 * The vocabulary the AI is allowed to weave into text, keyed w1, w2, …
 * Real ids never reach the model; unknown keys coming back are demoted to
 * plain text instead of corrupting learning data.
 */
export type WordOffer = {
    brief: string;
    byKey: Map<string, VocabWord>;
};

export function offerWords(words: { word: VocabWord; purpose: "introduce" | "review" }[]): WordOffer {
    const byKey = new Map<string, VocabWord>();
    const lines = words.map(({ word, purpose }, i) => {
        const key = `w${i + 1}`;
        byKey.set(key, word);
        const prn = word.pronunciation ? `, pronounced "${word.pronunciation}"` : "";
        return `- ${key}: "${word.term}" = "${word.meaning}"${prn} (${purpose === "introduce" ? "NEW — introduce gently with context" : "REVIEW — reinforce naturally"})`;
    });
    return {
        brief: lines.length > 0 ? lines.join("\n") : "(none this scene — write natively)",
        byKey,
    };
}

/** validate AI segments against the offer and produce storable segments */
export function resolveSegments(aiSegments: AiSegment[], offer: WordOffer): Segment[] {
    const out: Segment[] = [];
    for (const seg of aiSegments) {
        if (seg.t === "text") {
            if (seg.v.length > 0) out.push({ t: "text", v: seg.v });
        } else if (seg.t === "phrase") {
            out.push({
                t: "phrase",
                target: seg.target,
                translation: seg.translation,
                pronunciation: seg.pronunciation ?? undefined,
            });
        } else {
            const word = offer.byKey.get(seg.key);
            if (word) {
                out.push({ t: "vocab", wordId: word.id, surface: seg.surface || word.term });
            } else if (seg.surface) {
                // hallucinated key — keep the prose readable, drop the claim
                out.push({ t: "text", v: seg.surface });
            }
        }
    }
    return out;
}

/**
 * How much target language the prose may carry, by immersion level (0–3).
 * The reader earns each step by retaining words, so the escalation is slow
 * and every tap still reveals a translation — immersion, never a wall.
 */
const IMMERSION_GUIDANCE = [
    // 0 — Newcomer
    `- The reader is brand new. Use offered words as single words inside otherwise native-language sentences, where context makes the meaning guessable.
- At most 1 short phrase in the whole scene.`,
    // 1 — Wanderer
    `- The reader knows a handful of words. Use offered words freely and let characters greet, exclaim, and name everyday things in the target language (1–2 short phrases).`,
    // 2 — Speaker
    `- The reader is getting comfortable. Besides offered words, you may build ONE short full sentence in the target language per scene — composed mostly of REVIEW words the reader already knows (as a phrase segment with its translation).`,
    // 3 — Storyteller
    `- The reader is strong. Characters may speak 1–2 complete target-language lines per scene (phrase segments with translations), built mostly from REVIEW words; narration stays mostly native so the story remains effortless to follow.`,
];

export function segmentFormatRules(immersionLevel: 0 | 1 | 2 | 3 = 0): string {
    return `
WRITING FORMAT — the text you write is a JSON array of segments:
- { "t": "text", "v": "…" } — prose in the player's native language.
- { "t": "vocab", "key": "w1", "surface": "…" } — ONE of the offered vocabulary words, written in the target language exactly where it belongs in the sentence. "surface" is the word as it appears (it may be conjugated). Use ONLY keys from the offered list — never invent keys.
- { "t": "phrase", "target": "…", "translation": "…", "pronunciation": "…" } — a short extra target-language phrase you chose yourself (greeting, exclamation, everyday expression), with its native translation.

VOCABULARY RULES:
- Weave offered words into dialogue and narration so their meaning is guessable from context. The sentence must still read naturally.
- Never list words, never explain like a textbook, never translate inline in the prose (the game shows meanings when tapped).
- Use each offered word at most twice; you don't have to use them all.
- Keep phrases short (1–6 words).
${IMMERSION_GUIDANCE[immersionLevel]}`;
}
