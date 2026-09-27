/**
 * Turns a corpus word count ("comió 48213") into a teaching order for
 * headwords.
 *
 * The corpus counts written forms, not headwords, and many forms are
 * ambiguous: French "est" is both "is" (a form of être) and the noun "east".
 * The count of each ambiguous form is shared between its candidates in
 * proportion to how much evidence each already has from its *other* forms,
 * repeated a few times until it settles (expectation–maximisation). être
 * is backed by suis, sommes, était…; "east" is backed by nothing else, so it
 * ends up with a sliver.
 */
import { existsSync, readFileSync } from "node:fs";
import { normalizeForm } from "../../game/languages";
import { levelForRank } from "../../game/dictionary";
import type { RawEntry } from "./types";

export type Ranked = RawEntry & { freqRank: number | null; level: number };

/** among words spelled alike, grammar words carry the traffic; interjections rarely do */
const POS_WEIGHT: Record<string, number> = {
    article: 1, prep: 1, conj: 1, pron: 1, det: 1, particle: 1, postp: 1, contraction: 0.9,
    verb: 0.9, adv: 0.8, word: 0.8, adj: 0.6, num: 0.6, noun: 0.5, phrase: 0.5,
    classifier: 0.4, counter: 0.4, intj: 0.25, proverb: 0.2,
};

const NOT_A_WORD = /^(the )?name of the [\w-]+[ -]script letter|letter of the [\w ]*alphabet|^(abbreviation|initialism|acronym|clipping|misspelling|eye dialect|superseded spelling|nonstandard (form|spelling)|pronunciation spelling|alternative (form|spelling|letter-case form)) of\b/i;

const ROUNDS = 6;
const HEADWORD_PULL = 4;

/** entries a dictionary rightly lists but a learner should not be handed as vocabulary */
export function isCurio(entry: RawEntry, lang: string): boolean {
    const first = entry.senses[0]?.g ?? "";
    if (NOT_A_WORD.test(first)) return true;
    const cjk = lang === "zh" || lang === "ja" || lang === "ko";
    // single letters as nouns are letter names; a gloss identical to a tiny headword is a note name or symbol
    if (!cjk && entry.pos === "noun" && [...entry.lemma].length === 1) return true;
    if (!cjk && [...entry.lemma].length <= 3 && first.toLowerCase() === entry.lemma.toLowerCase() && entry.pos === "noun") return true;
    // outside German, a capitalised "common" word is nearly always an abbreviation or a name
    if (lang !== "de" && /^\p{Lu}/u.test(entry.lemma) && entry.lemma !== entry.lemma.toLowerCase()) return true;
    return false;
}

function readCounts(files: string[], lang: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const file of files) {
        if (!existsSync(file)) continue;
        for (const line of readFileSync(file, "utf8").split("\n")) {
            const space = line.lastIndexOf(" ");
            if (space <= 0) continue;
            const form = normalizeForm(line.slice(0, space));
            const count = Number(line.slice(space + 1));
            if (form.length === 0 || !Number.isFinite(count)) continue;
            // the Japanese corpus is split so finely that lone kana are mostly fragments of other words
            if (lang === "ja" && form.length === 1 && /^[぀-ヿ]$/.test(form)) continue;
            counts.set(form, (counts.get(form) ?? 0) + count);
        }
    }
    return counts;
}

export function rankByFrequency(entries: RawEntry[], frequencyFiles: string[], lang: string): Ranked[] {
    for (const entry of entries) {
        if (isCurio(entry, lang)) entry.teachable = false;
    }
    const counts = readCounts(frequencyFiles, lang);
    if (counts.size === 0) {
        return entries.map((entry) => ({ ...entry, freqRank: null, level: 6 }));
    }

    /** what kind of word it is, whether it is fit to teach, whether its source calls it common */
    const standing = new Map<RawEntry, number>();
    for (const entry of entries) {
        standing.set(entry,
            (POS_WEIGHT[entry.pos] ?? 0.5)
            * (entry.teachable ? 1 : 0.02)
            * (entry.common === false ? 0.05 : 1));
    }

    /** each corpus form, with the headwords it could be and how strongly it points at each */
    const byForm = new Map<string, { entry: RawEntry; pull: number }[]>();
    for (const entry of entries) {
        const headword = normalizeForm(entry.lemma);
        for (const form of entry.counted ?? entry.forms) {
            if (!counts.has(form)) continue;
            // a form that *is* the headword points at it harder than at a word it merely inflects
            const pull = standing.get(entry)! * (form === headword ? HEADWORD_PULL : 1);
            const list = byForm.get(form);
            if (list) list.push({ entry, pull });
            else byForm.set(form, [{ entry, pull }]);
        }
    }

    for (const entry of entries) entry.weight = 1;
    for (let round = 0; round < ROUNDS; round++) {
        const next = new Map<RawEntry, number>();
        for (const [form, candidates] of byForm) {
            const count = counts.get(form)!;
            let total = 0;
            for (const candidate of candidates) total += candidate.entry.weight * candidate.pull;
            for (const candidate of candidates) {
                const share = count * (candidate.entry.weight * candidate.pull) / total;
                next.set(candidate.entry, (next.get(candidate.entry) ?? 0) + share);
            }
        }
        // a floor keeps a word in the running even if an early round gave it nothing
        for (const entry of entries) entry.weight = (next.get(entry) ?? 0) + 0.01;
    }

    const ordered = [...entries].sort((a, b) => b.weight - a.weight);
    const rankOf = new Map<RawEntry, number>();
    let rank = 0;
    for (const entry of ordered) {
        // a fractional share of one sighting is noise, not evidence
        if (entry.weight < 1) break;
        rankOf.set(entry, ++rank);
    }

    return entries.map((entry) => {
        const freqRank = rankOf.get(entry) ?? null;
        return { ...entry, freqRank, level: levelForRank(freqRank) };
    });
}
