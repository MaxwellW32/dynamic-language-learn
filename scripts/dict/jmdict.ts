/**
 * Reads the jmdict-simplified JSON build of JMdict (Japanese–English).
 */
import { readdirSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { normalizeForm } from "../../game/languages";
import type { DictSense } from "../../game/dictionary";
import { conjugate, kanaToRomaji } from "./japanese";
import { shortGloss } from "./kaikki";
import { entryKey, type ParsedDictionary, type RawEntry } from "./types";

type JmSpelling = { common: boolean; text: string; tags: string[] };

type JmWord = {
    kanji: JmSpelling[];
    kana: JmSpelling[];
    sense: {
        partOfSpeech: string[];
        misc: string[];
        gloss: { text: string }[];
    }[];
};

/** tags that mark a word as something that conjugates like a verb (vt/vi/vs only describe one) */
const isVerbTag = (tag: string) => /^(v1|v2|v4|v5|vk|vn|vr|vz|vs-)/.test(tag);

/** JMdict's fine-grained tags, folded into the parts of speech the game knows */
function posOf(tags: string[]): string {
    const has = (test: (tag: string) => boolean) => tags.some(test);
    if (has((t) => t === "exp")) return "phrase";
    if (has(isVerbTag)) return "verb";
    if (has((t) => t.startsWith("adj"))) return "adj";
    if (has((t) => t.startsWith("adv"))) return "adv";
    if (has((t) => t === "pn")) return "pron";
    if (has((t) => t === "prt")) return "particle";
    if (has((t) => t === "int")) return "intj";
    if (has((t) => t === "conj")) return "conj";
    if (has((t) => t === "ctr")) return "counter";
    if (has((t) => t === "num")) return "num";
    if (has((t) => t === "n" || t.startsWith("n-") || t === "vs")) return "noun";
    return "other";
}

const UNTEACHABLE = new Set(["vulg", "derog", "X", "sens"]);
const FADED = new Set(["arch", "obs", "rare", "dated", "obsc", "hist"]);
/** spellings flagged as search-only, outdated or irregular are kept as forms but never shown as the headword */
const HIDDEN_SPELLING = new Set(["sK", "sk", "oK", "ok", "iK", "ik", "rK", "rk", "io"]);

const KANJI = /[一-鿿々]/;
const shown = (spelling: JmSpelling) => !spelling.tags.some((tag) => HIDDEN_SPELLING.has(tag));

export async function parseJmdict(archive: string, workDir: string): Promise<ParsedDictionary> {
    mkdirSync(workDir, { recursive: true });
    let jsonFile = existsSync(workDir) ? readdirSync(workDir).find((name) => name.endsWith(".json")) : undefined;
    if (!jsonFile) {
        execFileSync("tar", ["-xzf", archive, "-C", workDir]);
        jsonFile = readdirSync(workDir).find((name) => name.endsWith(".json"));
    }
    if (!jsonFile) throw new Error(`No JSON found after extracting ${archive}`);

    const data = JSON.parse(readFileSync(join(workDir, jsonFile), "utf8")) as { words: JmWord[] };
    const entries = new Map<string, RawEntry>();

    for (const word of data.words) {
        const kana = word.kana.find(shown) ?? word.kana[0];
        if (!kana || word.sense.length === 0) continue;

        const kanji = word.kanji.find(shown);
        const first = word.sense[0];
        // "usually written in kana": teach it the way it is actually written
        const writtenInKana = !kanji || first.misc.includes("uk");
        const lemma = writtenInKana ? kana.text : kanji.text;
        if (lemma.length > 24) continue;

        const posTags = [...new Set(word.sense.flatMap((s) => s.partOfSpeech))];
        const pos = posOf(first.partOfSpeech.length > 0 ? first.partOfSpeech : posTags);
        if (pos === "other") continue;

        const kept: DictSense[] = [];
        const faded: DictSense[] = [];
        for (const sense of word.sense) {
            const gloss = sense.gloss.map((g) => g.text).slice(0, 4).join("; ");
            if (gloss.length === 0) continue;
            const built: DictSense = { g: gloss.length > 160 ? gloss.slice(0, 157) + "…" : gloss };
            if (sense.misc.some((m) => FADED.has(m) || UNTEACHABLE.has(m))) faded.push(built);
            else kept.push(built);
        }
        const senses = [...kept, ...faded].slice(0, 8);
        if (senses.length === 0) continue;

        /* what a reader can tap and land here */
        const forms = new Set<string>();
        for (const spelling of [...word.kanji, ...word.kana]) {
            forms.add(normalizeForm(spelling.text));
            // inflect only the spellings in everyday use: that is where readers meet conjugations
            if (spelling.common || spelling === kana || spelling === kanji) {
                for (const form of conjugate(spelling.text, posTags)) forms.add(normalizeForm(form));
            }
        }
        forms.delete("");

        /*
         * What the frequency corpus may have counted this word as. Much
         * narrower than `forms`: rare alternative readings (九 read この) and
         * kana inflections of kanji words collide with everyday kana words and
         * would steal their counts.
         */
        const counted = new Set<string>([normalizeForm(kana.text)]);
        if (kanji) {
            counted.add(normalizeForm(kanji.text));
            for (const form of conjugate(kanji.text, posTags)) counted.add(normalizeForm(form));
            // the corpus cuts inflecting words at the kanji: 言う is counted as 言, 分かる as 分か
            if (pos === "verb" || posTags.includes("adj-i")) {
                const bare = kanji.text.replace(/[぀-ゟ]+$/, "");
                if (bare !== kanji.text && KANJI.test(bare)) counted.add(bare);
                const cut = kanji.text.slice(0, -1);
                if (cut.length >= 2 && KANJI.test(cut)) counted.add(cut);
            }
        }
        if (writtenInKana) {
            for (const form of conjugate(kana.text, posTags)) counted.add(normalizeForm(form));
        }
        counted.delete("");

        const common = word.kanji.some((k) => k.common) || word.kana.some((k) => k.common);

        const key = entryKey(lemma, pos);
        const existing = entries.get(key);
        if (existing) {
            // homographs (same spelling, different word): keep one card, gather every meaning
            existing.senses = [...existing.senses, ...senses].slice(0, 8);
            for (const form of forms) existing.forms.add(form);
            for (const form of counted) existing.counted!.add(form);
            existing.common = existing.common || common;
            continue;
        }

        entries.set(key, {
            lemma, pos,
            reading: kana.text,
            roman: kanaToRomaji(kana.text),
            ipa: null,
            gender: null,
            gloss: shortGloss(senses[0].g),
            senses,
            teachable: kept.length > 0 && !first.misc.some((m) => UNTEACHABLE.has(m)),
            audioUrl: null,
            forms,
            counted,
            common,
            weight: 0,
        });
    }

    return { entries: [...entries.values()].filter((e) => e.gloss.length > 0) };
}
