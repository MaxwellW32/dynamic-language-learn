/**
 * Reads CC-CEDICT (Mandarin–English): one entry per line,
 *   傳統 传统 [chuan2 tong3] /tradition/traditional/convention/
 *
 * The same characters often appear several times with different readings
 * (说 shuō "to speak", shuì "to persuade"). A learner wants one card per
 * word, led by the everyday reading — taken here to be the one CC-CEDICT
 * gives the most meanings for.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { normalizeForm } from "../../game/languages";
import type { DictSense } from "../../game/dictionary";
import { shortGloss } from "./kaikki";
import type { ParsedDictionary, RawEntry } from "./types";

const TONE_MARKS: Record<string, string[]> = {
    a: ["ā", "á", "ǎ", "à"], e: ["ē", "é", "ě", "è"], i: ["ī", "í", "ǐ", "ì"],
    o: ["ō", "ó", "ǒ", "ò"], u: ["ū", "ú", "ǔ", "ù"], ü: ["ǖ", "ǘ", "ǚ", "ǜ"],
};

/** "chuan2" → "chuán". The mark goes on a or e if present, on the o of ou, else on the last vowel. */
export function markTone(syllable: string): string {
    const match = syllable.match(/^([a-zü:]+?)([1-5])$/i);
    if (!match) return syllable;
    const base = match[1].toLowerCase().replace(/u:/g, "ü").replace(/v/g, "ü");
    const tone = Number(match[2]);
    if (tone === 5) return base;

    let index = base.search(/[ae]/);
    if (index === -1) index = base.indexOf("ou");
    if (index === -1) {
        for (let i = base.length - 1; i >= 0; i--) {
            if ("aeiouü".includes(base[i])) {
                index = i;
                break;
            }
        }
    }
    if (index === -1) return base;
    return base.slice(0, index) + TONE_MARKS[base[index]][tone - 1] + base.slice(index + 1);
}

export const pinyinOf = (numbered: string) => numbered.split(/\s+/).map(markTone).join(" ");

/**
 * CC-CEDICT has no part-of-speech field. Where the English meaning makes it
 * plain we say so; otherwise the card shows none rather than a guess.
 */
function guessPos(gloss: string): string {
    if (/^to [a-z]/.test(gloss)) return "verb";
    if (/^(classifier|measure word) for/.test(gloss)) return "classifier";
    if (/\((idiom|saying|proverb)\)/.test(gloss)) return "phrase";
    if (/\bparticle\b/.test(gloss)) return "particle";
    if (/^\(?(interjection|exclamation)/.test(gloss)) return "intj";
    return "word";
}

const SKIP_GLOSS = /^(variant of|old variant of|erhua variant of|see |surname |abbr\. for|also written|also pr\.|used in |\(bound form\)$)/i;
const UNTEACHABLE = /\b(vulgar|derog|offensive|taboo|slang\) (penis|vagina)|to fuck|prostitute)\b/i;

type Variant = { traditional: string; pinyin: string; glosses: string[] };

export async function parseCedict(file: string): Promise<ParsedDictionary> {
    const variantsByWord = new Map<string, Variant[]>();
    const lines = createInterface({
        input: createReadStream(file).pipe(createGunzip()),
        crlfDelay: Infinity,
    });

    for await (const line of lines) {
        if (line.startsWith("#") || line.length === 0) continue;
        const match = line.match(/^(\S+) (\S+) \[([^\]]+)\] \/(.+)\/\s*$/);
        if (!match) continue;
        const [, traditional, simplified, numbered, glossField] = match;
        if (simplified.length > 8) continue;
        // capitalised pinyin marks a proper noun
        if (/^[A-Z]/.test(numbered)) continue;

        const glosses = glossField.split("/")
            .map((g) => g.replace(/\[[a-z0-9: ]+\]/gi, "").replace(/\s+/g, " ").trim())
            .filter((g) => g.length > 0 && !/^CL:/.test(g) && !SKIP_GLOSS.test(g));
        if (glosses.length === 0) continue;

        const variant: Variant = { traditional, pinyin: pinyinOf(numbered), glosses };
        const list = variantsByWord.get(simplified);
        if (list) list.push(variant);
        else variantsByWord.set(simplified, [variant]);
    }

    const entries: RawEntry[] = [];
    for (const [simplified, variants] of variantsByWord) {
        variants.sort((a, b) => b.glosses.length - a.glosses.length);
        const lead = variants[0];

        const senses: DictSense[] = [];
        for (const variant of variants) {
            for (const gloss of variant.glosses) {
                if (senses.length >= 8) break;
                const text = gloss.length > 160 ? gloss.slice(0, 157) + "…" : gloss;
                // a meaning that belongs to a secondary reading says which one
                senses.push(variant === lead ? { g: text } : { g: text, l: [variant.pinyin] });
            }
        }

        const gloss = shortGloss(lead.glosses.slice(0, 2).join(", "));
        if (gloss.length === 0) continue;

        entries.push({
            lemma: simplified,
            pos: guessPos(lead.glosses[0]),
            reading: lead.pinyin,
            roman: lead.pinyin,
            ipa: null,
            gender: null,
            gloss,
            senses,
            teachable: !UNTEACHABLE.test(lead.glosses.join("/")),
            audioUrl: null,
            forms: new Set([normalizeForm(simplified), ...variants.map((v) => normalizeForm(v.traditional))]),
            weight: 0,
        });
    }

    return { entries };
}
