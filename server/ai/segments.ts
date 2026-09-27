import "server-only";
import type { DictEntry } from "@/db/schema";
import { POS_NAMES } from "@/game/dictionary";
import { LANGUAGES, type LangCode } from "@/game/languages";
import type { DialogueOption, PassageChoice } from "@/game/payloads";
import { respace, type Segment } from "@/game/segments";
import { tokenize } from "../services/dictionary";
import type { PlannedWord } from "../services/learning";
import type { AiSegment } from "./schemas";

/**
 * The vocabulary the model may weave into what it writes, keyed w1, w2, …
 * Real ids never reach the model; a key it makes up is dropped on the way
 * back rather than allowed to corrupt anyone's learning record.
 */
export type WordOffer = {
    brief: string;
    byKey: Map<string, DictEntry>;
};

const PURPOSE: Record<PlannedWord["purpose"], string> = {
    review: "DUE — the reader has met it and should meet it again now",
    scene: "NEW — fits this place",
    introduce: "NEW",
};

export function offerWords(planned: PlannedWord[]): WordOffer {
    const byKey = new Map<string, DictEntry>();
    const lines = planned.map(({ entry, purpose }, i) => {
        const key = `w${i + 1}`;
        byKey.set(key, entry);
        const gender = entry.gender ? `, ${entry.gender}` : "";
        const reading = entry.reading && entry.reading !== entry.lemma ? ` [${entry.reading}]` : "";
        return `- ${key}: ${entry.lemma}${reading} = ${entry.gloss} (${POS_NAMES[entry.pos] ?? entry.pos}${gender}) — ${PURPOSE[purpose]}`;
    });
    return {
        brief: lines.length > 0 ? lines.join("\n") : "(none — write without vocab segments)",
        byKey,
    };
}

export const NO_WORDS: WordOffer = { brief: "(none — write without vocab segments)", byKey: new Map() };

/** turn what the model wrote into what the book stores: keys become ids, target text is linked word by word */
export async function resolveSegments(lang: LangCode, written: AiSegment[], offer: WordOffer): Promise<Segment[]> {
    const resolved = await Promise.all(written.map(async (segment): Promise<Segment | null> => {
        if (segment.t === "text") {
            return segment.v.length > 0 ? { t: "text", v: segment.v } : null;
        }
        if (segment.t === "tl") {
            const target = segment.target.trim();
            if (target.length === 0) return null;
            return { t: "tl", v: target, tr: segment.translation.trim(), tk: await tokenize(lang, target) };
        }
        const entry = offer.byKey.get(segment.key);
        const surface = segment.surface.trim();
        if (entry) return { t: "word", id: entry.id, s: surface || entry.lemma };
        if (surface.length === 0) return null;
        // a made-up key: keep the prose readable, and still let the word be tapped if the dictionary knows it
        const tokens = await tokenize(lang, surface);
        return tokens.some((token) => token.id !== undefined)
            ? { t: "tl", v: surface, tr: "", tk: tokens }
            : { t: "text", v: surface };
    }));

    // neighbouring text runs are merged, so stored passages stay compact
    const out: Segment[] = [];
    for (const segment of resolved) {
        if (!segment) continue;
        const last = out[out.length - 1];
        if (segment.t === "text" && last?.t === "text") last.v += segment.v;
        else out.push(segment);
    }
    // target-language pieces were trimmed above, and the writer sometimes forgets the space beside them
    return respace(out, LANGUAGES[lang].spaced);
}

/** a line the model wrote in one language or the other, as segments */
export async function lineToSegments(lang: LangCode, text: string, translation: string | null, inTarget: boolean): Promise<Segment[]> {
    const line = text.trim();
    if (line.length === 0) return [];
    if (!inTarget) return [{ t: "text", v: line }];
    return [{ t: "tl", v: line, tr: (translation ?? "").trim(), tk: await tokenize(lang, line) }];
}

export async function toDialogueOptions(
    lang: LangCode,
    options: { text: string; translation: string | null; tone: string; inTarget: boolean }[],
): Promise<DialogueOption[]> {
    const built = await Promise.all(options.slice(0, 4).map(async (option, i): Promise<DialogueOption | null> => {
        const segments = await lineToSegments(lang, option.text, option.translation, option.inTarget);
        if (segments.length === 0) return null;
        return { key: `o${i + 1}`, segments, tone: option.tone.slice(0, 24), inTarget: option.inTarget };
    }));
    return built.filter((option): option is DialogueOption => option !== null);
}

export function toChoices(choices: { label: string; tone: string }[] | null): PassageChoice[] | null {
    if (!choices || choices.length < 2) return null;
    return choices.slice(0, 3).map((choice, i) => ({
        key: `c${i + 1}`,
        label: [{ t: "text", v: choice.label.trim() }],
        tone: choice.tone.slice(0, 24),
    }));
}
