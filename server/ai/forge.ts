import "server-only";
import { generate } from "./client";
import {
    openingSchema, questPlanSchema, storySeedSchema, worldFillSchema,
} from "./schemas";
import { segmentFormatRules, type WordOffer } from "./segments";
import { NPC_SPRITES, ENEMY_SPRITES, TTS_VOICES } from "@/game/sprites";
import type { z } from "zod";

export type StorySeed = z.infer<typeof storySeedSchema>;
export type WorldFill = z.infer<typeof worldFillSchema>;
export type QuestPlan = z.infer<typeof questPlanSchema>;

const FORGE_PERSONA = `You are the author of a warm, magical children's-storybook adventure — cozy fantasy in the spirit of a hand-illustrated adventure journal. The reader IS the hero of the book. Write vividly but economically; suggest wonder, avoid darkness beyond gentle peril; never be generic.`;

export async function generateStorySeed(input: {
    playerName: string;
    nativeLanguage: string;
    targetLanguage: string;
    premiseSeed: string | null;
}): Promise<StorySeed> {
    return generate({
        task: "storySeed",
        schema: storySeedSchema,
        instructions: `${FORGE_PERSONA}

Create the seed of a new story:
- "title": a storybook title (3–6 words, no subtitle).
- "premise": the opening-cover premise, 80–150 words, second person ("you"), present tense. Establish a small starting settlement, a wilder land beyond it, something old and hidden beneath, and one gentle mystery pulling the hero forward. Do not name any characters.
- "tone": 3–6 comma-separated adjectives for the book's mood.

The hero is called ${input.playerName}. The story world subtly evokes places where ${input.targetLanguage} is spoken — food, festivals, names, weather — while the prose itself is written in ${input.nativeLanguage}.`,
        input: input.premiseSeed
            ? `The reader wished for: "${input.premiseSeed}". Honor the spirit of this wish.`
            : `Invent something the reader will fall in love with.`,
    });
}

export async function generateWorldFill(input: {
    seed: StorySeed;
    playerName: string;
    targetLanguage: string;
    mapsBrief: string;
    npcSlotsBrief: string;
    enemySlotsBrief: string;
}): Promise<WorldFill> {
    return generate({
        task: "worldFill",
        schema: worldFillSchema,
        instructions: `${FORGE_PERSONA}

The book's geography is already drawn. Your job is to NAME and FILL it — you may not move, add, or remove anything.

For every map listed: give it a name, a biome word or two, and "ambience" (one sentence of sensory notes a narrator can reuse: sounds, smells, light). For each listed feature slot: a name and 1–2 sentences of "lore" a curious reader discovers on inspection.

For every NPC slot: create a memorable character — name, role (their job/purpose in the story), personality (2–3 vivid traits with a flaw or quirk), appearance (one sentence), backstory (2–3 sentences, include one secret or wish), a spriteKey from [${Object.keys(NPC_SPRITES).join(", ")}], and a voiceId from [${TTS_VOICES.join(", ")}].

For every enemy slot: a creature or foe fitting its map's biome and the story's gentle tone — name, description (one sentence), introLine (what it "says" or how the encounter begins — playful menace), defeatLine (its yielding line), and a spriteKey from [${Object.keys(ENEMY_SPRITES).join(", ")}] (boss-* keys only for the boss slot).

Rules:
- Use every key exactly as given; respond for ALL listed slots.
- Names should feel ${input.targetLanguage}-inflected where natural.
- Characters must interlock: shared history, small tensions, reasons to send the hero to each other.
- The boss is the story's central mystery made flesh — memorable, not merely evil.

Story title: ${input.seed.title}
Premise: ${input.seed.premise}
Tone: ${input.seed.tone}
The hero: ${input.playerName}`,
        input: `MAPS AND FEATURE SLOTS:\n${input.mapsBrief}\n\nNPC SLOTS:\n${input.npcSlotsBrief}\n\nENEMY SLOTS:\n${input.enemySlotsBrief}`,
    });
}

export async function generateQuestPlan(input: {
    seed: Pick<StorySeed, "title" | "premise" | "tone">;
    arcStage: string;
    stageGuidance: string;
    castBrief: string;
    mapsBrief: string;
    chronicleBrief: string;
}): Promise<QuestPlan> {
    return generate({
        task: "questPlan",
        schema: questPlanSchema,
        instructions: `${FORGE_PERSONA}

Design 2–3 quests for the "${input.arcStage}" stage of the story. ${input.stageGuidance}

Each quest: a title, a 1–2 sentence description in second person, optionally the npc key of who gives it, and 1–4 objectives.

Objective kinds and their targetKey:
- "talkTo": meet a character → targetKey = an npc key
- "persuade": win a character over about something specific (say what in the description) → targetKey = an npc key
- "defeat": overcome a foe → targetKey = an enemy key
- "visit": reach a place → targetKey = a map ref
- "learnWords": grow the hero's word-hoard → targetKey = null, wordCount = 3–8

Rules:
- Use ONLY the keys listed in the briefs. Every quest needs at least one objective.
- Mix kinds; at most one learnWords objective across all quests.
- Objectives should chain naturally (meet → learn → persuade → venture → defeat).
- Never re-issue something already done in the chronicle.

Story: ${input.seed.title} — ${input.seed.premise}
Tone: ${input.seed.tone}`,
        input: `CAST:\n${input.castBrief}\n\nPLACES:\n${input.mapsBrief}\n\nCHRONICLE (what has already happened):\n${input.chronicleBrief}`,
    });
}

export async function generateOpening(input: {
    seed: StorySeed;
    playerName: string;
    nativeLanguage: string;
    targetLanguage: string;
    startBrief: string;
    offer: WordOffer;
}): Promise<z.infer<typeof openingSchema>> {
    return generate({
        task: "opening",
        schema: openingSchema,
        instructions: `${FORGE_PERSONA}

Write the very first page of the book: the hero ${input.playerName} arrives at the starting place. 90–140 words, second person, present tense. End on a small forward pull — something worth walking toward. Also give the opening chapter a title (2–5 words).

The prose is in ${input.nativeLanguage}; the language being learned is ${input.targetLanguage}.
${segmentFormatRules(0)}

OFFERED WORDS:
${input.offer.brief}

Story: ${input.seed.title} — ${input.seed.premise}
Tone: ${input.seed.tone}`,
        input: `WHERE THE STORY OPENS:\n${input.startBrief}`,
    });
}
