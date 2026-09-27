/**
 * Parse the downloaded dictionaries and load them into Postgres.
 *
 *   npx tsx scripts/dict/import.ts --dry          parse everything, print statistics, touch nothing
 *   npx tsx scripts/dict/import.ts --dry es       …for one language
 *   npx tsx scripts/dict/import.ts                load every language
 *   npx tsx scripts/dict/import.ts es ja          load just these
 *
 * Loading is repeatable: headwords are matched on (language, headword, part of
 * speech), so a re-import updates entries in place and every learner's progress
 * stays attached to the same word.
 */
import dotenv from "dotenv";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { glossKeysOf } from "../../game/dictionary";
import { parseCedict } from "./cedict";
import { applyCuration, readCuration } from "./curate";
import { rankByFrequency, type Ranked } from "./frequency";
import { parseJmdict } from "./jmdict";
import { parseKaikki } from "./kaikki";
import { RAW_DIR, SOURCES, type DictSource } from "./sources";

dotenv.config({ path: ".env.local", quiet: true });

const ENTRY_BATCH = 2000;
const FORM_BATCH = 20000;

async function parse(source: DictSource): Promise<Ranked[]> {
    const file = join(RAW_DIR, source.file);
    const parsed =
        source.format === "kaikki" ? await parseKaikki(file, (n) => process.stdout.write(`\r  ${source.lang}: read ${n} lines`)) :
        source.format === "jmdict" ? await parseJmdict(file, join(RAW_DIR, source.lang)) :
        await parseCedict(file);
    if (source.format === "kaikki") process.stdout.write("\n");
    // the model's one-time review (scripts/dict/curate.ts) goes in before ranking,
    // so a word it threw out no longer competes for its homograph's corpus count
    const curation = readCuration(source.lang);
    if (Object.keys(curation).length > 0) {
        const { dropped, revised } = applyCuration(parsed.entries, curation);
        console.log(`  ${source.lang}: curation applied — ${revised} revised, ${dropped} no longer taught`);
    }
    const frequencyFiles = [source.frequencyFile, ...(source.extraFrequencyFiles ?? [])]
        .filter((name): name is string => name !== undefined)
        .map((name) => join(RAW_DIR, name));
    return rankByFrequency(parsed.entries, frequencyFiles, source.lang);
}

function report(lang: string, entries: Ranked[]) {
    const forms = entries.reduce((sum, e) => sum + e.forms.size, 0);
    const ranked = entries.filter((e) => e.freqRank !== null);
    const teachable = entries.filter((e) => e.teachable && e.freqRank !== null);
    const byLevel = [1, 2, 3, 4, 5, 6].map((level) => teachable.filter((e) => e.level === level).length);
    console.log(`\n${lang}: ${entries.length} headwords, ${forms} written forms, ${ranked.length} ranked by frequency`);
    console.log(`  teachable per level A1…C2: ${byLevel.join(" / ")}`);
    console.log(`  with IPA ${entries.filter((e) => e.ipa).length}, reading ${entries.filter((e) => e.reading).length}, audio ${entries.filter((e) => e.audioUrl).length}, examples ${entries.filter((e) => e.senses.some((s) => s.ex)).length}`);

    const top = [...teachable].sort((a, b) => a.freqRank! - b.freqRank!);
    const show = (e: Ranked) => `${e.lemma}${e.reading && e.reading !== e.lemma ? `[${e.reading}]` : ""} (${e.pos}) = ${e.gloss}`;
    console.log(`  first 25:  ${top.slice(0, 25).map(show).join(" · ")}`);
    console.log(`  rank ~1000: ${top.slice(1000, 1008).map(show).join(" · ")}`);
    console.log(`  rank ~5000: ${top.slice(5000, 5006).map(show).join(" · ")}`);
}

const MAX_GLOSS_KEYS = 8;

/**
 * "Which words mean X?" keys, from the short gloss first (curated when
 * curation reviewed the word) and then the first sense. The first sense alone
 * is sometimes an odd one: puente's is "ravine", though its gloss is "bridge".
 */
function lookupKeys(entry: Pick<Ranked, "gloss" | "senses">): string[] {
    const keys = [...glossKeysOf(entry.gloss), ...(entry.senses[0] ? glossKeysOf(entry.senses[0].g) : [])];
    return [...new Set(keys)].slice(0, MAX_GLOSS_KEYS);
}

async function load(client: PoolClient, lang: string, parsed: Ranked[]) {
    const started = Date.now();
    const idByKey = new Map<string, number>();

    // one row per (headword, part of speech): the upsert cannot touch a row twice in a statement
    const unique = new Map<string, Ranked>();
    for (const entry of parsed) {
        const key = `${entry.lemma}\t${entry.pos}`;
        const kept = unique.get(key);
        if (!kept) unique.set(key, entry);
        else for (const form of entry.forms) kept.forms.add(form);
    }
    const entries = [...unique.values()];

    for (let i = 0; i < entries.length; i += ENTRY_BATCH) {
        const batch = entries.slice(i, i + ENTRY_BATCH);
        const result = await client.query<{ id: number; lemma: string; pos: string }>(
            `INSERT INTO dict_entries
                (lang, lemma, pos, reading, roman, ipa, gender, gloss, senses, "glossKeys", "freqRank", level, teachable, "audioUrl")
             SELECT $1, t.lemma, t.pos, t.reading, t.roman, t.ipa, t.gender, t.gloss, t.senses::jsonb,
                    ARRAY(SELECT jsonb_array_elements_text(t.keys::jsonb)), t.rank, t.level, t.teachable, t.audio
             FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
                         $9::text[], $10::text[], $11::int[], $12::smallint[], $13::boolean[], $14::text[])
                  AS t(lemma, pos, reading, roman, ipa, gender, gloss, senses, keys, rank, level, teachable, audio)
             ON CONFLICT (lang, lemma, pos) DO UPDATE SET
                reading = EXCLUDED.reading, roman = EXCLUDED.roman, ipa = EXCLUDED.ipa, gender = EXCLUDED.gender,
                gloss = EXCLUDED.gloss, senses = EXCLUDED.senses, "glossKeys" = EXCLUDED."glossKeys",
                "freqRank" = EXCLUDED."freqRank", level = EXCLUDED.level, teachable = EXCLUDED.teachable,
                "audioUrl" = EXCLUDED."audioUrl"
             RETURNING id, lemma, pos`,
            [
                lang,
                batch.map((e) => e.lemma), batch.map((e) => e.pos), batch.map((e) => e.reading),
                batch.map((e) => e.roman), batch.map((e) => e.ipa), batch.map((e) => e.gender),
                batch.map((e) => e.gloss), batch.map((e) => JSON.stringify(e.senses)),
                batch.map((e) => JSON.stringify(lookupKeys(e))),
                batch.map((e) => e.freqRank), batch.map((e) => e.level), batch.map((e) => e.teachable),
                batch.map((e) => e.audioUrl),
            ],
        );
        for (const row of result.rows) idByKey.set(`${row.lemma}\t${row.pos}`, row.id);
        process.stdout.write(`\r  ${lang}: ${Math.min(i + ENTRY_BATCH, entries.length)}/${entries.length} headwords`);
    }
    process.stdout.write("\n");

    // forms the storyteller resolved at play time (source = 'ai') are kept
    await client.query(`DELETE FROM dict_forms WHERE lang = $1 AND source = 'dict'`, [lang]);

    const forms: string[] = [];
    const ids: number[] = [];
    const flush = async () => {
        if (forms.length === 0) return;
        await client.query(
            `INSERT INTO dict_forms (lang, form, "entryId", source)
             SELECT $1, t.form, t.id, 'dict' FROM unnest($2::text[], $3::int[]) AS t(form, id)
             ON CONFLICT DO NOTHING`,
            [lang, forms, ids],
        );
        forms.length = 0;
        ids.length = 0;
    };

    let total = 0;
    for (const entry of entries) {
        const id = idByKey.get(`${entry.lemma}\t${entry.pos}`);
        if (id === undefined) continue;
        for (const form of entry.forms) {
            forms.push(form);
            ids.push(id);
            total++;
            if (forms.length >= FORM_BATCH) {
                await flush();
                process.stdout.write(`\r  ${lang}: ${total} forms`);
            }
        }
    }
    await flush();
    console.log(`\r  ${lang}: ${total} forms — loaded in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

async function main() {
    const args = process.argv.slice(2);
    const dry = args.includes("--dry");
    const wanted = args.filter((a) => !a.startsWith("--"));
    const sources = wanted.length > 0 ? SOURCES.filter((s) => wanted.includes(s.lang)) : SOURCES;

    const pool = dry ? null : new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

    for (const source of sources) {
        const entries = await parse(source);
        report(source.lang, entries);
        if (!pool) continue;

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await load(client, source.lang, entries);
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK").catch(() => { });
            throw error;
        } finally {
            client.release();
        }
    }

    if (pool) {
        const size = await pool.query(`
            SELECT pg_size_pretty(pg_total_relation_size('dict_entries')) AS entries,
                   pg_size_pretty(pg_total_relation_size('dict_forms')) AS forms,
                   pg_size_pretty(pg_database_size(current_database())) AS database
        `);
        console.log("\nsize on disk:", size.rows[0]);
        await pool.query("ANALYZE dict_entries; ANALYZE dict_forms;");
        await pool.end();
    }
}

main().catch((error) => {
    console.error("\n", error instanceof Error ? error.stack : error);
    process.exit(1);
});
