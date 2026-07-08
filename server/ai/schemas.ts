import { z } from "zod";

/**
 * Output contracts for every AI task. Rules for structured outputs:
 * use .nullable() (never .optional()), no z.record — and the model never sees
 * real database ids: words, characters, objectives and maps are referred to by
 * short stable keys we hand it (w1, n2, o3…) and re-validate on the way back.
 */

/** segments as the AI writes them — `key` refers to a word we offered */
export const aiSegmentSchema = z.union([
    z.object({ t: z.literal("text"), v: z.string() }),
    z.object({ t: z.literal("vocab"), key: z.string(), surface: z.string() }),
    z.object({
        t: z.literal("phrase"),
        target: z.string(),
        translation: z.string(),
        pronunciation: z.string().nullable(),
    }),
]);
export type AiSegment = z.infer<typeof aiSegmentSchema>;

/* ------------------------------------------------------------------ */
/* world forge                                                         */
/* ------------------------------------------------------------------ */

export const storySeedSchema = z.object({
    title: z.string().min(1),
    premise: z.string().min(1),
    tone: z.string().min(1),
});

export const worldFillSchema = z.object({
    maps: z.array(z.object({
        ref: z.string(),
        name: z.string().min(1),
        biome: z.string().min(1),
        ambience: z.string().min(1),
        /** names + inspection lore for the interactive feature slots we listed */
        features: z.array(z.object({
            key: z.string(),
            name: z.string().min(1),
            lore: z.string().min(1),
        })),
    })),
    npcs: z.array(z.object({
        key: z.string(),
        name: z.string().min(1),
        role: z.string().min(1),
        personality: z.string().min(1),
        appearance: z.string().min(1),
        backstory: z.string().min(1),
        spriteKey: z.string(),
        voiceId: z.string(),
    })),
    enemies: z.array(z.object({
        key: z.string(),
        name: z.string().min(1),
        description: z.string().min(1),
        introLine: z.string().min(1),
        defeatLine: z.string().min(1),
        spriteKey: z.string(),
    })),
});

export const questPlanSchema = z.object({
    quests: z.array(z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        giverNpcKey: z.string().nullable(),
        objectives: z.array(z.object({
            description: z.string().min(1),
            kind: z.enum(["talkTo", "persuade", "defeat", "visit", "learnWords"]),
            /** npc key (talkTo/persuade), enemy key (defeat), map ref (visit) — null for learnWords */
            targetKey: z.string().nullable(),
            /** only for learnWords */
            wordCount: z.number().int().min(1).max(20).nullable(),
        })),
    })),
});

export const openingSchema = z.object({
    chapterTitle: z.string().min(1),
    passage: z.array(aiSegmentSchema),
});

/* ------------------------------------------------------------------ */
/* live play                                                           */
/* ------------------------------------------------------------------ */

export const narrationSchema = z.object({
    passage: z.array(aiSegmentSchema),
    /** one line for the chronicle if something worth remembering happened */
    eventSummary: z.string().nullable(),
});

export const characterReplySchema = z.object({
    reply: z.array(aiSegmentSchema),
    /** the character's mood after this exchange, e.g. "amused", "wary" */
    mood: z.string().min(1),
    /** a durable memory this character will keep, or null if nothing memorable */
    memory: z.object({
        content: z.string().min(1),
        importance: z.number().int().min(1).max(10),
    }).nullable(),
    /** how this exchange shifted the character's feelings toward the player */
    affinityDelta: z.number().int().min(-5).max(5),
    /** objective key from the brief if the player just clearly achieved it */
    objectiveAchieved: z.string().nullable(),
});

export const chapterTransitionSchema = z.object({
    closingSummary: z.string().min(1),
    nextChapterTitle: z.string().min(1),
    passage: z.array(aiSegmentSchema),
});

export const examplesSchema = z.object({
    examples: z.array(z.object({
        key: z.string(),
        /** natural sentence in the target language using the word; separate words with spaces */
        exampleTarget: z.string().min(1),
        exampleNative: z.string().min(1),
    })),
});
