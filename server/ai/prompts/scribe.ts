import "server-only";
import { generate, type AiContext } from "../client";
import { lemmaSchema, reflectionSchema, summarySchema } from "../schemas";
import type { z } from "zod";

/**
 * The cheap tier's work: bookkeeping that keeps the expensive prompts small.
 * None of this is prose a reader sees, so none of it needs the story model.
 */

/** fold older lines of a conversation into its running summary */
export async function summarizeConversation(ctx: AiContext, input: {
    characterName: string;
    playerName: string;
    summary: string;
    lines: string;
}): Promise<string> {
    const result = await generate({
        ctx,
        task: "summarise",
        tier: "scribe",
        maxOutputTokens: 700,
        schema: summarySchema,
        instructions: `You keep the running summary of a conversation between ${input.playerName} (the hero of a storybook) and ${input.characterName}. You are given the summary so far and the lines that followed it. Write the new summary: at most 110 words, past tense, third person. Keep what would matter if the two spoke again tomorrow — what was asked, promised, refused, revealed, felt. Drop pleasantries. Do not invent anything.`,
        input: `SUMMARY SO FAR\n${input.summary || "(none)"}\n\nLINES SINCE\n${input.lines}`,
    });
    return result.summary.trim();
}

/** too many small memories: keep their meaning, drop their number */
export async function reflect(ctx: AiContext, input: {
    characterName: string;
    playerName: string;
    relationship: string;
    memories: string;
}): Promise<z.infer<typeof reflectionSchema>> {
    return generate({
        ctx,
        task: "reflect",
        tier: "scribe",
        maxOutputTokens: 1200,
        schema: reflectionSchema,
        instructions: `You are the memory of ${input.characterName}, a character in a storybook, thinking back over many small memories of ${input.playerName}, the hero. Distil them.

"reflections": three to five memories that together keep everything that matters in the list — each one sentence, from ${input.characterName}'s point of view, with "importance" 1 to 10 and three to six lower-case "keywords". Merge what repeats. Keep anything promised, owed or confided. Invent nothing.
"relationship": two sentences on how ${input.characterName} now feels about ${input.playerName}, and why.`,
        input: `HOW THEY FELT BEFORE\n${input.relationship || "(no settled view)"}\n\nTHE MEMORIES\n${input.memories}`,
    });
}

/** the last entry in the table of contents: what happened in the chapter that ended the book */
export async function summarizeChapter(ctx: AiContext, input: {
    bookTitle: string;
    chapterTitle: string;
    playerName: string;
    happened: string;
}): Promise<string> {
    const result = await generate({
        ctx,
        task: "chapter-summary",
        tier: "scribe",
        maxOutputTokens: 500,
        schema: summarySchema,
        instructions: `You keep the table of contents of a storybook, "${input.bookTitle}", whose hero is ${input.playerName}. Given what came of each thing a chapter asked of the hero, write what happened in the chapter: two or three past-tense sentences, third person, plain and warm. Say what truly happened, failures and all. Invent nothing.`,
        input: `THE CHAPTER: "${input.chapterTitle}"

WHAT CAME OF IT
${input.happened}`,
    });
    return result.summary.trim();
}

/** the dictionary could not place these words: what are their dictionary forms? */
export async function findLemmas(ctx: AiContext, input: { languageName: string; words: { key: string; surface: string; sentence: string }[] }): Promise<z.infer<typeof lemmaSchema>> {
    return generate({
        ctx,
        task: "lemmas",
        tier: "scribe",
        maxOutputTokens: 600,
        schema: lemmaSchema,
        instructions: `You are a lexicographer of ${input.languageName}. For each word, as it appears in its sentence, give the form under which a dictionary lists it: the infinitive of a verb, the singular of a noun, the masculine singular of an adjective, without articles or attached pronouns. If it is a name, a number written in digits, or not a ${input.languageName} word, give null. Answer for every key and no others.`,
        input: input.words.map((w) => `- ${w.key}: "${w.surface}" in: ${w.sentence}`).join("\n"),
    });
}
