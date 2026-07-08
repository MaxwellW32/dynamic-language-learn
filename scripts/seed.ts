/**
 * Syncs the built-in vocab packs from data/vocab/ into the database.
 * Idempotent AND additive: new packs are created, and words added to a
 * dictionary.json later are appended to the existing pack (matched by term)
 * without disturbing anyone's learning progress.
 *
 *   npm run db:seed
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db";
import { vocabPacks, vocabWords } from "../db/schema";
import { asc, eq } from "drizzle-orm";

type DictionaryJson = Record<string, { word: string; mng: string; prnc: string }>;

const PACKS = [
    {
        slug: "travelers-japanese",
        name: "Traveler's Japanese",
        description: "Everyday Japanese words for the road — the first steps of the journey.",
        nativeLanguage: "english",
        targetLanguage: "japanese",
        coverEmoji: "🏮",
        source: "data/vocab/english__japanese/dictionary.json",
    },
    {
        slug: "travelers-spanish",
        name: "Traveler's Spanish",
        description: "Everyday Spanish words for the road — the first steps of the journey.",
        nativeLanguage: "english",
        targetLanguage: "spanish",
        coverEmoji: "🌞",
        source: "data/vocab/english__spanish/dictionary.json",
    },
];

async function main() {
    for (const pack of PACKS) {
        let row = await db.query.vocabPacks.findFirst({
            where: eq(vocabPacks.slug, pack.slug),
        });
        if (!row) {
            [row] = await db.insert(vocabPacks).values({
                slug: pack.slug,
                name: pack.name,
                description: pack.description,
                nativeLanguage: pack.nativeLanguage,
                targetLanguage: pack.targetLanguage,
                coverEmoji: pack.coverEmoji,
                isBuiltIn: true,
            }).returning();
        }

        const raw = JSON.parse(readFileSync(join(process.cwd(), pack.source), "utf8")) as DictionaryJson;
        const entries = Object.entries(raw).sort(([a], [b]) => Number(a) - Number(b));

        const existing = await db.query.vocabWords.findMany({
            where: eq(vocabWords.packId, row.id),
            orderBy: [asc(vocabWords.sortIndex)],
        });
        const seenTerms = new Set(existing.map((w) => w.term));
        let sortIndex = existing.length;

        const toInsert: (typeof vocabWords.$inferInsert)[] = [];
        for (const [, w] of entries) {
            if (seenTerms.has(w.word)) continue;
            seenTerms.add(w.word);
            toInsert.push({
                packId: row.id,
                term: w.word,
                meaning: w.mng,
                pronunciation: w.prnc,
                sortIndex: sortIndex++,
            });
        }

        if (toInsert.length > 0) await db.insert(vocabWords).values(toInsert);
        console.log(`${pack.slug}: +${toInsert.length} new words (${existing.length + toInsert.length} total)`);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
