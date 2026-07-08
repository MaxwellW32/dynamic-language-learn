import "server-only";
import { db } from "@/db";
import { vocabWords, type VocabWord } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AI_MODEL_FAST, generate } from "./client";
import { examplesSchema } from "./schemas";

/**
 * Some challenge types (cloze, sentence ordering) need example sentences.
 * Packs may not ship them, so we backfill lazily with one AI call and cache
 * the result on the word row — each word pays this cost at most once, ever.
 */
export async function ensureExamples(words: VocabWord[], nativeLanguage: string, targetLanguage: string): Promise<VocabWord[]> {
    const missing = words.filter((w) => !w.exampleTarget);
    if (missing.length === 0) return words;

    const byKey = new Map(missing.map((w, i) => [`w${i + 1}`, w]));

    try {
        const result = await generate({
            task: "examples",
            model: AI_MODEL_FAST,
            schema: examplesSchema,
            instructions: `You write example sentences for language learners (${nativeLanguage} speakers learning ${targetLanguage}).

For each listed word, return:
- "exampleTarget": one short, natural, beginner-friendly sentence in ${targetLanguage} that contains the word EXACTLY as written. Separate every word in the sentence with a single space (even in languages not normally written with spaces) so the sentence can be split into pieces.
- "exampleNative": its ${nativeLanguage} translation.

Use everyday, concrete situations. Keep sentences 3–8 words long.`,
            input: [...byKey.entries()]
                .map(([key, w]) => `- ${key}: "${w.term}" (meaning: ${w.meaning})`)
                .join("\n"),
        });

        const updated = new Map<string, { exampleTarget: string; exampleNative: string }>();
        for (const ex of result.examples) {
            const word = byKey.get(ex.key);
            if (!word || !ex.exampleTarget.includes(word.term)) continue;
            updated.set(word.id, { exampleTarget: ex.exampleTarget, exampleNative: ex.exampleNative });
        }

        await Promise.all([...updated.entries()].map(([wordId, ex]) =>
            db.update(vocabWords).set(ex).where(eq(vocabWords.id, wordId))
        ));

        return words.map((w) => {
            const ex = updated.get(w.id);
            return ex ? { ...w, ...ex } : w;
        });
    } catch {
        // examples are an enhancement — a battle can proceed without them
        return words;
    }
}
