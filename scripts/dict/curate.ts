/**
 * A model reviews the most common teachable words of a language, once.
 *
 *   npx tsx scripts/dict/curate.ts <lang> [--top=4000] [--batch=40] [--concurrency=6] [--model=gpt-6-luna] [--limit=<n>]
 *
 * The frequency ranking is a heuristic: now and then a rare homograph steals a
 * common word's count (Spanish "pollo" the adjective, "inexperienced", ranked
 * above the chicken), and some glosses read like grammar notes ("forms the
 * present perfect…" for German "sein"). For each entry the model says whether
 * it is genuinely an everyday word, gives its best short meaning, and writes
 * one simple example sentence.
 *
 * Results go to data/dict-curation/<lang>.json after every batch, so an
 * interrupted run loses nothing and a re-run only pays for what is missing.
 * The importer (scripts/dict/import.ts) applies the file on every import.
 */
import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { Pool } from "pg";
import { z } from "zod";
import type { DictSense } from "../../game/dictionary";
import type { RawEntry } from "./types";

dotenv.config({ path: ".env.local", quiet: true });

export const CURATION_DIR = "data/dict-curation";

export type Curation = {
    keep: boolean;
    gloss: string;
    example: string | null;
    exampleEn: string | null;
};

export const curationKey = (lemma: string, pos: string) => `${lemma}\t${pos}`;

export function curationFile(lang: string): string {
    return join(CURATION_DIR, `${lang}.json`);
}

export function readCuration(lang: string): Record<string, Curation> {
    const file = curationFile(lang);
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, Curation>;
}

/** examples kept per sense after curation's own is put first */
const EXAMPLES_PER_SENSE = 2;

/**
 * Apply a curation file to freshly parsed entries, before ranking: words the
 * review threw out stop being teachable (so the ranking hands their corpus
 * count to the word that deserves it), kept words get the better gloss and
 * lead with the reviewed example.
 */
export function applyCuration(entries: RawEntry[], curation: Record<string, Curation>): { dropped: number; revised: number } {
    let dropped = 0;
    let revised = 0;
    for (const entry of entries) {
        const review = curation[curationKey(entry.lemma, entry.pos)];
        if (!review) continue;
        if (!review.keep) {
            entry.teachable = false;
            dropped++;
            continue;
        }
        entry.gloss = review.gloss;
        if (review.example && review.exampleEn && entry.senses.length > 0) {
            const first: DictSense = entry.senses[0];
            const others = (first.ex ?? []).filter((ex) => ex.t !== review.example);
            entry.senses[0] = { ...first, ex: [{ t: review.example, n: review.exampleEn }, ...others].slice(0, EXAMPLES_PER_SENSE) };
        }
        revised++;
    }
    return { dropped, revised };
}

/** one line per entry, keys sorted: an interrupted run's file and a finished one diff cleanly */
function writeCuration(lang: string, curation: Record<string, Curation>) {
    mkdirSync(CURATION_DIR, { recursive: true });
    const keys = Object.keys(curation).sort();
    const body = keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(curation[key])}`).join(",\n");
    writeFileSync(curationFile(lang), keys.length === 0 ? "{}\n" : `{\n${body}\n}\n`, "utf8");
}

/* ------------------------------------------------------------------ */
/* validation (pure, exported for tests)                               */
/* ------------------------------------------------------------------ */

const LANGUAGE_NAMES: Record<string, string> = {
    es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese",
    ja: "Japanese", ko: "Korean", zh: "Mandarin Chinese (simplified characters)",
};

/** a sentence in a non-Latin-script language must contain that script, or it is English */
const SCRIPT: Record<string, RegExp> = {
    ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
    zh: /\p{Script=Han}/u,
    ko: /\p{Script=Hangul}/u,
};

const MAX_EXAMPLE_WORDS = 12;
const MAX_EXAMPLE_CHARS = 60;

export type ModelItem = { key: string; keep: boolean; gloss: string; example: string | null; exampleEn: string | null };

/**
 * A model answer we trust enough to keep, or null (it will be asked again next
 * run). A rejected word's gloss is never shown, so when the model leaves it
 * empty the dictionary's own stands in rather than the verdict being lost.
 */
export function validateItem(item: ModelItem, lang: string, sentKeys: Set<string>, currentGloss = ""): Curation | null {
    if (!sentKeys.has(item.key)) return null;
    const gloss = item.gloss.trim();
    if (!item.keep) {
        const kept = gloss.length >= 1 && gloss.length <= 60 ? gloss : currentGloss.trim().slice(0, 60);
        return kept.length > 0 ? { keep: false, gloss: kept, example: null, exampleEn: null } : null;
    }
    if (gloss.length < 1 || gloss.length > 60) return null;

    const example = item.example?.trim() ?? "";
    const exampleEn = item.exampleEn?.trim() ?? "";
    if (example.length === 0 || exampleEn.length === 0) return null;
    if (example.length > MAX_EXAMPLE_CHARS * 2 || exampleEn.length > 200) return null;
    const script = SCRIPT[lang];
    if (script) {
        if (!script.test(example) || example.length > MAX_EXAMPLE_CHARS) return null;
    } else {
        if (example.split(/\s+/).length > MAX_EXAMPLE_WORDS) return null;
        // the "example" is just the translation again
        if (example.toLowerCase() === exampleEn.toLowerCase()) return null;
    }
    return { keep: true, gloss, example, exampleEn };
}

/* ------------------------------------------------------------------ */
/* the run                                                             */
/* ------------------------------------------------------------------ */

/** US dollars per million tokens: [input, cached input, output] */
const PRICES: Record<string, [number, number, number]> = {
    "gpt-6-luna": [0.10, 0.01, 0.50],
    "gpt-6-sol": [2.00, 0.20, 10.00],
};

type Candidate = { id: number; lemma: string; pos: string; reading: string | null; gloss: string; senses: DictSense[] };

const itemSchema = z.object({
    key: z.string(),
    keep: z.boolean(),
    gloss: z.string(),
    example: z.string().nullable(),
    exampleEn: z.string().nullable(),
});
const replySchema = z.object({ items: z.array(itemSchema) });

function instructionsFor(lang: string): string {
    const name = LANGUAGE_NAMES[lang] ?? lang;
    return [
        `You are reviewing the vocabulary list of a ${name} course for English-speaking beginners.`,
        "Each entry is a dictionary headword with its part of speech and the meanings the dictionary lists.",
        "The list was ordered by how often each written form appears in film subtitles, and that ordering is sometimes fooled:",
        "a rare word that happens to be spelled like a very common one can inherit its count.",
        "",
        "For every entry return an item with the same key and:",
        "- keep: true only if this headword, WITH THIS PART OF SPEECH AND THESE MEANINGS, is a word a learner genuinely meets in everyday speech.",
        "  false for: fragments and suffixes, abbreviations, names of people or places, letters, rare or technical homographs",
        "  of a common word (e.g. an obscure adjective spelled like a common noun), archaic or vulgar words,",
        "  and anything else unsuitable to teach.",
        "  Judge the word, not the dictionary's wording: a common word whose listed meanings are odd or badly phrased",
        "  is kept, with a good gloss. keep is false only when the headword itself, in this part of speech, is not an",
        "  everyday word.",
        "- gloss: always required, even when keep is false. The best short English meaning for a learner, 1 to 4 words.",
        "  Verbs as \"to …\". Give the sense people use most in everyday speech, which is not always the first one the",
        "  dictionary lists, and never a grammatical description (the German verb sein is \"to be\", not \"forms the perfect tense\").",
        `- example: when keep is true, one natural, simple ${name} sentence of at most 9 words that uses the word`,
        "  (inflected if that is natural), in the sense given by gloss. Plain everyday language a beginner could follow.",
        "  null when keep is false.",
        "- exampleEn: a natural English translation of example; null when keep is false.",
        "",
        "Return exactly one item per entry. Never invent keys.",
    ].join("\n");
}

function inputFor(batch: Candidate[], keys: string[]): string {
    const lines = batch.map((entry, i) => JSON.stringify({
        key: keys[i],
        word: entry.lemma,
        pos: entry.pos,
        ...(entry.reading && entry.reading !== entry.lemma ? { reading: entry.reading } : {}),
        gloss: entry.gloss,
        senses: entry.senses.slice(0, 3).map((s) => s.g),
    }));
    return `Entries:\n${lines.join("\n")}`;
}

function parseArgs(argv: string[]) {
    const flags = new Map<string, string>();
    const positional: string[] = [];
    for (const arg of argv) {
        const match = arg.match(/^--([a-z]+)=(.*)$/);
        if (match) flags.set(match[1], match[2]);
        else positional.push(arg);
    }
    const number = (name: string, fallback: number) => {
        const value = Number(flags.get(name) ?? fallback);
        if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
        return Math.floor(value);
    };
    return {
        lang: positional[0],
        top: number("top", 4000),
        batch: number("batch", 40),
        concurrency: number("concurrency", 6),
        model: flags.get("model") ?? "gpt-6-luna",
        limit: flags.has("limit") ? number("limit", 1) : Infinity,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.lang || !LANGUAGE_NAMES[args.lang]) {
        console.error("Usage: npx tsx scripts/dict/curate.ts <es|fr|de|it|pt|ja|ko|zh> [--top=4000] [--batch=40] [--concurrency=6] [--model=gpt-6-luna] [--limit=<n>]");
        process.exit(1);
    }
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set in .env.local");
    const prices = PRICES[args.model];
    if (!prices) console.warn(`No price known for ${args.model}; cost will read 0.`);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const { rows } = await pool.query<Candidate>(
        `SELECT id, lemma, pos, reading, gloss, senses FROM dict_entries
         WHERE lang = $1 AND teachable AND "freqRank" IS NOT NULL
         ORDER BY "freqRank" LIMIT $2`,
        [args.lang, args.top],
    );
    await pool.end();

    const curation = readCuration(args.lang);
    const todo = rows.filter((row) => !(curationKey(row.lemma, row.pos) in curation)).slice(0, args.limit);
    const already = rows.filter((row) => curationKey(row.lemma, row.pos) in curation).length;
    console.log(`${args.lang}: ${rows.length} candidates in the top ${args.top}, ${already} already reviewed, ${todo.length} to review now with ${args.model}`);

    const batches: Candidate[][] = [];
    for (let i = 0; i < todo.length; i += args.batch) batches.push(todo.slice(i, i + args.batch));

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const instructions = instructionsFor(args.lang);
    const totals = { input: 0, cached: 0, output: 0, saved: 0, kept: 0, dropped: 0, invalid: 0, unanswered: 0, failedBatches: 0 };

    async function review(batch: Candidate[]) {
        const keys = batch.map((_, i) => `e${i + 1}`);
        const byKey = new Map(batch.map((entry, i) => [keys[i], entry]));
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const response = await client.responses.parse({
                    model: args.model,
                    instructions,
                    input: inputFor(batch, keys),
                    text: { format: zodTextFormat(replySchema, "curation") },
                });
                totals.input += response.usage?.input_tokens ?? 0;
                totals.cached += response.usage?.input_tokens_details?.cached_tokens ?? 0;
                totals.output += response.usage?.output_tokens ?? 0;

                const items = response.output_parsed?.items ?? [];
                const sent = new Set(keys);
                const answered = new Set<string>();
                for (const item of items) {
                    if (answered.has(item.key)) continue;
                    const entry = byKey.get(item.key);
                    const valid = validateItem(item, args.lang, sent, entry?.gloss);
                    if (!valid || !entry) {
                        totals.invalid++;
                        console.warn(`\n  skipped ${entry ? entry.lemma : "unknown key"}: ${JSON.stringify(item).slice(0, 200)}`);
                        continue;
                    }
                    answered.add(item.key);
                    curation[curationKey(entry.lemma, entry.pos)] = valid;
                    totals.saved++;
                    if (valid.keep) totals.kept++;
                    else totals.dropped++;
                }
                totals.unanswered += batch.length - answered.size;
                writeCuration(args.lang, curation);
                process.stdout.write(`\r  reviewed ${totals.saved}/${todo.length}`);
                return;
            } catch (error) {
                if (attempt === 2) {
                    totals.failedBatches++;
                    console.error(`\n  batch starting at ${batch[0].lemma} failed: ${error instanceof Error ? error.message : error}`);
                }
            }
        }
    }

    // a small pool of workers pulling batches off one queue
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(args.concurrency, batches.length) }, async () => {
        while (next < batches.length) await review(batches[next++]);
    }));

    const [inPrice, cachedPrice, outPrice] = prices ?? [0, 0, 0];
    const cost = ((totals.input - totals.cached) * inPrice + totals.cached * cachedPrice + totals.output * outPrice) / 1e6;
    console.log(`\n\n${args.lang} with ${args.model}:`);
    console.log(`  entries reviewed: ${totals.saved} (kept ${totals.kept}, dropped ${totals.dropped}); invalid answers skipped: ${totals.invalid}; left unanswered (retried next run): ${totals.unanswered}; failed batches: ${totals.failedBatches}`);
    console.log(`  tokens: input ${totals.input} (cached ${totals.cached}), output ${totals.output}`);
    console.log(`  cost: $${cost.toFixed(4)}${totals.saved > 0 ? ` — $${(cost / totals.saved * 1000).toFixed(4)} per 1,000 entries` : ""}`);
    console.log(`  saved to ${curationFile(args.lang)} (${Object.keys(curation).length} entries in total)`);
}

// imported by the importer for applyCuration; only a direct run reviews anything
if (/curate\.ts$/.test(process.argv[1] ?? "")) {
    main().catch((error) => {
        console.error("\n", error instanceof Error ? error.stack : error);
        process.exit(1);
    });
}
