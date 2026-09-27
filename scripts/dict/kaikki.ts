/**
 * Reads a kaikki.org Wiktionary extract (one JSON object per line, gzipped).
 *
 * Wiktionary lists every inflected form as its own entry ("pies: plural of
 * pie"). Those are folded into a form → headword lookup rather than kept as
 * words, which is what lets a reader tap "comió" and land on "comer".
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { normalizeForm } from "../../game/languages";
import type { DictExample, DictSense } from "../../game/dictionary";
import { entryKey, type ParsedDictionary, type RawEntry } from "./types";

type KaikkiSense = {
    glosses?: string[];
    tags?: string[];
    form_of?: { word: string }[];
    alt_of?: { word: string }[];
    examples?: { text?: string; translation?: string; english?: string; type?: string }[];
};

type KaikkiEntry = {
    word: string;
    pos: string;
    senses?: KaikkiSense[];
    sounds?: { ipa?: string; mp3_url?: string; ogg_url?: string }[];
    forms?: { form: string; tags?: string[] }[];
};

const KEPT_POS = new Set([
    "noun", "verb", "adj", "adv", "pron", "prep", "conj", "det", "article", "num",
    "intj", "phrase", "particle", "prep_phrase", "proverb", "contraction", "postp",
    "classifier", "counter", "adv_phrase",
]);

/** senses carrying these are real but belong at the bottom of the card */
const FADED = new Set(["obsolete", "archaic", "dated", "rare", "historical", "dialectal", "uncommon"]);
/** a word whose main sense carries one of these is never chosen for teaching */
const UNTEACHABLE = new Set(["vulgar", "offensive", "derogatory", "slur", "pejorative", "ethnic", "sexual"]);
const SHOWN_LABELS = new Set([
    "colloquial", "informal", "formal", "figuratively", "slang", "literary", "poetic",
    "humorous", "transitive", "intransitive", "reflexive", "impersonal", "polite",
    "honorific", "humble", "childish", "familiar",
]);
/** rows of an inflection table that describe the table rather than spell a form */
const NOT_A_FORM = new Set([
    "table-tags", "inflection-template", "class", "romanization", "obsolete",
    "multiword-construction", "error-unrecognized-form",
]);
const GENDERS = ["masculine", "feminine", "neuter", "common-gender"];

function cleanGloss(gloss: string): string {
    let text = gloss.replace(/\s+/g, " ").trim().replace(/[.:;]+$/, "");
    if (text.length > 160) {
        const cut = text.lastIndexOf("; ", 160);
        text = (cut > 40 ? text.slice(0, cut) : text.slice(0, 157)) + "…";
    }
    return text;
}

/** the one short meaning used in challenges: first alternative, no asides, no essay */
export function shortGloss(gloss: string): string {
    const first = gloss.split(";")[0];
    const bare = first.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    let text = bare.length >= 2 ? bare : first.trim();
    if (text.length > 48) {
        const parts = text.split(", ");
        text = parts[0];
        for (const part of parts.slice(1)) {
            if ((text + ", " + part).length > 48) break;
            text += ", " + part;
        }
        if (text.length > 60) text = text.slice(0, 57) + "…";
    }
    return text;
}

/**
 * "allomorph of 나", "pre-reform spelling of detetive", "compound of the
 * infinitive rivedere with la" → the headword being pointed at, or null when
 * the gloss is a real meaning.
 */
function describedTarget(gloss: string): string | null {
    const match =
        gloss.match(/^(?:[\p{L}\p{N}' -]{0,60}?)\b(?:form|allomorph|spelling|variant|contraction|participle|plural|singular|tense|gerund) of ([^\s,;:()“”"]+)/iu) ??
        gloss.match(/^compound of (?:the )?(?:[a-z-]+ )*?(?:infinitive|gerund|imperative|participle)?\s*([^\s,;:()“”"]+) (?:with|and|\+)/i);
    if (!match) return null;
    const target = match[1].replace(/[.…]+$/, "");
    return target.length > 0 ? target : null;
}

function exampleOf(sense: KaikkiSense): DictExample | null {
    for (const example of sense.examples ?? []) {
        const translation = example.translation ?? example.english;
        if (example.type !== "example" || !example.text || !translation) continue;
        if (example.text.length > 110 || translation.length > 140) continue;
        return { t: example.text.trim(), n: translation.trim() };
    }
    return null;
}

export async function parseKaikki(file: string, onProgress?: (lines: number) => void): Promise<ParsedDictionary> {
    const entries = new Map<string, RawEntry & { faded: DictSense[]; examples: number }>();
    /** "this written form belongs to that headword", resolved once every headword is known */
    const links: { form: string; lemma: string; pos: string }[] = [];

    const lines = createInterface({
        input: createReadStream(file).pipe(createGunzip()),
        crlfDelay: Infinity,
    });

    let count = 0;
    for await (const line of lines) {
        if (line.length === 0) continue;
        count++;
        if (onProgress && count % 100000 === 0) onProgress(count);

        const raw = JSON.parse(line) as KaikkiEntry;
        if (!raw.word || !KEPT_POS.has(raw.pos) || raw.word.length > 40) continue;
        if (raw.word.split(" ").length > 4) continue;

        const real: KaikkiSense[] = [];
        for (const sense of raw.senses ?? []) {
            const tags = sense.tags ?? [];
            const target = sense.form_of?.[0]?.word ?? sense.alt_of?.[0]?.word;
            if (target && (sense.form_of || sense.alt_of || tags.includes("form-of") || tags.includes("alt-of"))) {
                links.push({ form: normalizeForm(raw.word), lemma: target, pos: raw.pos });
                continue;
            }
            if (tags.includes("no-gloss") || !sense.glosses || sense.glosses.length === 0) continue;
            real.push(sense);
        }
        if (real.length === 0) continue;

        const pos = raw.pos === "adv_phrase" || raw.pos === "prep_phrase" ? "phrase" : raw.pos;
        const key = entryKey(raw.word, pos);
        let entry = entries.get(key);
        if (!entry) {
            entry = {
                lemma: raw.word, pos,
                reading: null, roman: null, ipa: null, gender: null, gloss: "",
                senses: [], faded: [], examples: 0, teachable: true, audioUrl: null,
                forms: new Set([normalizeForm(raw.word)]), weight: 0,
            };
            entries.set(key, entry);
        }

        for (const sound of raw.sounds ?? []) {
            if (sound.ipa && (!entry.ipa || (sound.ipa.startsWith("/") && !entry.ipa.startsWith("/")))) entry.ipa = sound.ipa;
            if (!entry.audioUrl && (sound.mp3_url || sound.ogg_url)) entry.audioUrl = sound.mp3_url ?? sound.ogg_url ?? null;
        }

        for (const form of raw.forms ?? []) {
            const tags = form.tags ?? [];
            if (tags.includes("romanization")) {
                if (!entry.roman) entry.roman = form.form;
                continue;
            }
            if (tags.some((tag) => NOT_A_FORM.has(tag))) continue;
            if (!form.form || form.form === "-" || form.form.length > 40 || form.form.includes(" ")) continue;
            const normalized = normalizeForm(form.form);
            if (normalized.length > 0) entry.forms.add(normalized);
        }

        for (const sense of real) {
            const tags = sense.tags ?? [];
            const gloss = cleanGloss(sense.glosses![sense.glosses!.length - 1]);
            if (gloss.length === 0) continue;

            if (!entry.gender && entry.pos === "noun") {
                const gender = GENDERS.find((g) => tags.includes(g));
                if (gender) entry.gender = gender === "common-gender" ? "common" : gender;
            }

            const built: DictSense = { g: gloss };
            const labels = tags.filter((tag) => SHOWN_LABELS.has(tag));
            if (labels.length > 0) built.l = labels.slice(0, 3);
            if (entry.examples < 3) {
                const example = exampleOf(sense);
                if (example) {
                    built.ex = [example];
                    entry.examples++;
                }
            }

            const unteachable = tags.some((tag) => UNTEACHABLE.has(tag));
            const faded = tags.some((tag) => FADED.has(tag));
            // judged on the first sense a learner would meet
            if (entry.senses.length === 0 && entry.faded.length === 0 && unteachable) entry.teachable = false;
            if (faded || unteachable) entry.faded.push(built);
            else entry.senses.push(built);
        }
    }

    const byLemma = new Map<string, RawEntry[]>();
    const finished: RawEntry[] = [];
    for (const entry of entries.values()) {
        const { faded, examples: _examples, ...rest } = entry;
        void _examples;
        // a word known only through faded senses is kept for lookup but not taught
        if (rest.senses.length === 0) rest.teachable = false;
        rest.senses = [...rest.senses, ...faded].slice(0, 8);
        if (rest.senses.length === 0) continue;

        // some inflections are described in prose rather than tagged ("topic-marked form of 나")
        const targets = rest.senses.map((sense) => describedTarget(sense.g));
        if (targets.every((target) => target !== null)) {
            for (const target of new Set(targets)) {
                for (const form of rest.forms) links.push({ form, lemma: target!, pos: rest.pos });
            }
            continue;
        }

        rest.gloss = shortGloss(rest.senses[0].g);
        if (rest.gloss.length === 0) continue;
        finished.push(rest);
        const list = byLemma.get(rest.lemma);
        if (list) list.push(rest);
        else byLemma.set(rest.lemma, [rest]);
    }

    for (const link of links) {
        if (link.form.length === 0) continue;
        const candidates = byLemma.get(link.lemma);
        if (!candidates) continue;
        const samePos = candidates.filter((c) => c.pos === link.pos);
        for (const target of samePos.length > 0 ? samePos : candidates) target.forms.add(link.form);
    }

    return { entries: finished };
}
