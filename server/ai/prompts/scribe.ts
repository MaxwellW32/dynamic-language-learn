import "server-only";
import { generate, type AiContext } from "../client";
import { directorSchema, lemmaSchema, reflectionSchema, summarySchema, type Direction } from "../schemas";
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

/** the director: read what happened, decide what it means for the story */
export async function direct(ctx: AiContext, input: {
    bible: string;
    heart: string;
    threads: string;
    quests: string;
    chronicle: string;
    cast: string;
    creatures: string;
    places: string;
    landmarks: string;
    /** whether the story may be handed a further quest right now */
    mayAddQuest: boolean;
    cacheKey: string;
}): Promise<Direction> {
    return generate({
        ctx,
        task: "direct",
        tier: "scribe",
        effort: "low",
        cacheKey: input.cacheKey,
        maxOutputTokens: 2500,
        schema: directorSchema,
        instructions: `You are the director of a living storybook: you never write a word the reader sees. You read what has happened and decide what it means, so that the story remembers its own past and the world answers what the hero does.

${input.bible}`,
        input: `What the book is really about: ${input.heart}

OPEN THREADS
${input.threads || "(none)"}

QUESTS
${input.quests || "(none)"}

WHAT HAS HAPPENED LATELY, OLDEST FIRST
${input.chronicle}

PEOPLE
${input.cast}

CREATURES STILL AT LARGE
${input.creatures || "(none)"}

PLACES
${input.places}

LANDMARKS
${input.landmarks || "(none)"}

Decide:
- "threads": every thread that changed, and any that has just begun. To update one, give its key and its new summary, status and importance. To open one, give key null. Resolve a thread when the story has answered it; drop one the story has walked away from. Leave unchanged threads out.
- "shifts": for each person who would be changed by what happened — because they were there, or because word would reach them — their key, and whichever of these changed: "goal" (what they want now), "mood", "heard" (what they have heard, in one sentence in their own words — people talk). Leave unchanged fields null. Leave unaffected people out. People only hear of things that were public or that someone would tell them.
- "quest": ${input.mayAddQuest ? `if what happened calls for something new — a consequence, a favour asked, a door that opened — one quest: title, description (one or two sentences, second person), "giverKey" (a person key or null), and one to three objectives. Objective kinds and their "targetKey": "talkTo" and "persuade" → a person key; "defeat" → a creature key; "visit" → a place key; "inspect" → a landmark key; "learnWords" → null with "wordCount". Use only keys listed above. Usually null: a story with too many errands has no shape.` : "null."}
- "note": one or two sentences for the narrator on where the story should lean next.`,
    });
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
