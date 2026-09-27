import { z } from "zod";
import {
    ACCESSORIES, AGES, BIOMES, BOSS_KINDS, BUILDS, CLOTH_COLORS, CREATURE_KINDS, CREATURE_TINTS,
    HAIR_COLORS, HAIR_STYLES, HATS, LANDMARK_KIND_LIST, OUTFITS, SKIN_TONES, TIMES_OF_DAY,
    TTS_VOICES, WEATHERS,
} from "@/game/looks";

/**
 * Output contracts for every model task.
 *
 * Rules for structured output: `.nullable()`, never `.optional()`; no
 * records. The model never sees a database id — words, people, places and
 * objectives are referred to by the short keys we hand it (w1, n2, o3…), and
 * every key is checked against what was offered on the way back.
 *
 * Wherever the model chooses how something *looks*, the schema is a plain
 * string rather than an enum: a creative answer outside the list is replaced
 * by a default in code (game/looks.ts), which is kinder than a failed request.
 */

const keysOf = (object: object) => Object.keys(object).join(" | ");

/* ------------------------------------------------------------------ */
/* story text                                                          */
/* ------------------------------------------------------------------ */

/** segments as the model writes them — `key` names a word it was offered */
export const aiSegmentSchema = z.union([
    z.object({ t: z.literal("text"), v: z.string() }),
    z.object({ t: z.literal("vocab"), key: z.string(), surface: z.string() }),
    z.object({ t: z.literal("tl"), target: z.string(), translation: z.string() }),
]);
export type AiSegment = z.infer<typeof aiSegmentSchema>;

/* ------------------------------------------------------------------ */
/* the forge                                                           */
/* ------------------------------------------------------------------ */

const regionSketch = z.object({
    name: z.string().min(1),
    biome: z.string().describe(BIOMES.join(" | ")),
    timeOfDay: z.string().describe(TIMES_OF_DAY.join(" | ")),
    weather: z.string().describe(WEATHERS.join(" | ")),
    /** one sentence of sound, smell and light a narrator can reuse */
    ambience: z.string().min(1),
    /** two sentences: what this place is and why it matters to the story */
    description: z.string().min(1),
    /** five to eight plain English nouns for things found here: vocabulary that fits the place */
    themeWords: z.array(z.string()),
});

export const storySeedSchema = z.object({
    title: z.string().min(1),
    premise: z.string().min(1),
    tone: z.string().min(1),
    /** the question the whole book turns on, in one sentence — never shown to the reader */
    heart: z.string().min(1),
    /** four to six short facts about this world that must stay true */
    facts: z.array(z.string()),
    home: regionSketch,
    wilds: regionSketch,
    depths: regionSketch,
});
export type StorySeed = z.infer<typeof storySeedSchema>;
export type RegionSketch = z.infer<typeof regionSketch>;

const lookSchema = z.object({
    build: z.string().describe(BUILDS.join(" | ")),
    age: z.string().describe(AGES.join(" | ")),
    skin: z.string().describe(keysOf(SKIN_TONES)),
    hair: z.string().describe(HAIR_STYLES.join(" | ")),
    hairColor: z.string().describe(keysOf(HAIR_COLORS)),
    beard: z.boolean(),
    outfit: z.string().describe(OUTFITS.join(" | ")),
    primary: z.string().describe(keysOf(CLOTH_COLORS)),
    secondary: z.string().describe(keysOf(CLOTH_COLORS)),
    hat: z.string().describe(HATS.join(" | ")),
    accessory: z.string().describe(ACCESSORIES.join(" | ")),
});

const castMember = z.object({
    key: z.string(),
    name: z.string().min(1),
    role: z.string().min(1),
    personality: z.string().min(1),
    appearance: z.string().min(1),
    backstory: z.string().min(1),
    secret: z.string().min(1),
    goal: z.string().min(1),
    speechStyle: z.string().min(1),
    look: lookSchema,
    voice: z.string().describe(TTS_VOICES.join(" | ")),
    /** three short things they call out in the TARGET language as the hero walks by */
    barks: z.array(z.object({ target: z.string(), translation: z.string() })),
});

const creature = z.object({
    key: z.string(),
    name: z.string().min(1),
    description: z.string().min(1),
    introLine: z.string().min(1),
    defeatLine: z.string().min(1),
    kind: z.string().describe(`${CREATURE_KINDS.join(" | ")} — bosses: ${BOSS_KINDS.join(" | ")}`),
    tint: z.string().describe(keysOf(CREATURE_TINTS)),
});

const landmark = z.object({
    key: z.string(),
    /** one of the kinds suggested for that spot */
    kind: z.string().describe(LANDMARK_KIND_LIST.join(" | ")),
    name: z.string().min(1),
    lore: z.string().min(1),
});

/**
 * The world is filled by two requests that run side by side — the people, and
 * everything else — because one request writing both takes longer than a
 * player should be asked to wait.
 */
export const castFillSchema = z.object({
    cast: z.array(castMember),
});

export const placesFillSchema = z.object({
    creatures: z.array(creature),
    landmarks: z.array(landmark),
    /** names for the buildings listed in the brief */
    buildings: z.array(z.object({ key: z.string(), name: z.string().min(1) })),
});

export type WorldFill = z.infer<typeof castFillSchema> & z.infer<typeof placesFillSchema>;

const questSketch = z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    giverKey: z.string().nullable(),
    objectives: z.array(z.object({
        description: z.string().min(1),
        kind: z.enum(["talkTo", "persuade", "defeat", "visit", "inspect", "learnWords"]),
        /** npc key (talkTo, persuade), creature key (defeat), region key (visit), landmark key (inspect); null for learnWords */
        targetKey: z.string().nullable(),
        /** learnWords only */
        wordCount: z.number().int().min(1).max(20).nullable(),
    })),
});
export type QuestSketch = z.infer<typeof questSketch>;

const threadSketch = z.object({
    title: z.string().min(1),
    kind: z.enum(["mystery", "promise", "conflict", "bond"]),
    summary: z.string().min(1),
    importance: z.number().int().min(1).max(10),
});

export const openingSchema = z.object({
    chapterTitle: z.string().min(1),
    passage: z.array(aiSegmentSchema),
    quests: z.array(questSketch),
    threads: z.array(threadSketch),
});
export type Opening = z.infer<typeof openingSchema>;

/* ------------------------------------------------------------------ */
/* live play                                                           */
/* ------------------------------------------------------------------ */

export const narrationSchema = z.object({
    passage: z.array(aiSegmentSchema),
    /** one past-tense line for the chronicle, or null if nothing worth remembering happened */
    eventSummary: z.string().nullable(),
    /** how much this moment matters to the story, 1 trivial … 10 defining */
    importance: z.number().int().min(1).max(10),
    /** two or three things the reader may do next, only at a real fork; otherwise null */
    choices: z.array(z.object({ label: z.string().min(1), tone: z.string().min(1) })).nullable(),
});
export type Narration = z.infer<typeof narrationSchema>;

export const characterTurnSchema = z.object({
    reply: z.array(aiSegmentSchema),
    /** the character's mood after this exchange, one or two words */
    mood: z.string().min(1),
    gesture: z.enum(["none", "nod", "wave", "bow", "cheer", "talk"]),
    /** how this exchange moved their feelings about the hero */
    affinityDelta: z.number().int().min(-5).max(5),
    /** something durable to remember, or null */
    memory: z.object({
        content: z.string().min(1),
        importance: z.number().int().min(1).max(10),
        kind: z.enum(["episode", "fact", "promise"]),
        keywords: z.array(z.string()),
    }).nullable(),
    /** three things the hero might say next */
    options: z.array(z.object({
        text: z.string().min(1),
        /** the reader's-language meaning when `text` is in the target language, else null */
        translation: z.string().nullable(),
        tone: z.string().min(1),
        inTarget: z.boolean(),
    })),
    /** feedback on the hero's own use of the target language; null if they used none */
    note: z.object({
        verdict: z.enum(["good", "close", "off"]),
        better: z.string().nullable(),
        tip: z.string().nullable(),
        /** dictionary forms of the target-language words the hero used correctly */
        usedWords: z.array(z.string()),
    }).nullable(),
    objectiveAchieved: z.string().nullable(),
    objectiveFailed: z.string().nullable(),
});
export type CharacterTurn = z.infer<typeof characterTurnSchema>;

export const greetingSchema = z.object({
    reply: z.array(aiSegmentSchema),
    mood: z.string().min(1),
    gesture: z.enum(["none", "nod", "wave", "bow", "cheer", "talk"]),
    options: characterTurnSchema.shape.options,
});

export const chapterTurnSchema = z.object({
    closingSummary: z.string().min(1),
    nextChapterTitle: z.string().min(1),
    passage: z.array(aiSegmentSchema),
    quests: z.array(questSketch),
    /** facts that have become true and must be remembered from now on */
    newFacts: z.array(z.string()),
    /** a new place the story opens up, or null */
    newRegion: regionSketch.extend({ kind: z.enum(["settlement", "wilds", "depths"]) }).nullable(),
});
export type ChapterTurn = z.infer<typeof chapterTurnSchema>;

/* ------------------------------------------------------------------ */
/* the director and the scribe                                         */
/* ------------------------------------------------------------------ */

export const directorSchema = z.object({
    threads: z.array(z.object({
        /** the key of a thread from the brief, or null to open a new one */
        key: z.string().nullable(),
        title: z.string().min(1),
        kind: z.enum(["mystery", "promise", "conflict", "bond"]),
        summary: z.string().min(1),
        status: z.enum(["open", "resolved", "dropped"]),
        importance: z.number().int().min(1).max(10),
    })),
    /** how characters have been changed by what happened */
    shifts: z.array(z.object({
        key: z.string(),
        goal: z.string().nullable(),
        mood: z.string().nullable(),
        /** something they have now heard about, in their own words, or null */
        heard: z.string().nullable(),
    })),
    /** a quest the story now calls for, or null */
    quest: questSketch.nullable(),
    /** one or two sentences telling the narrator where to lean next */
    note: z.string(),
});
export type Direction = z.infer<typeof directorSchema>;

export const summarySchema = z.object({
    summary: z.string().min(1),
});

export const reflectionSchema = z.object({
    reflections: z.array(z.object({
        content: z.string().min(1),
        importance: z.number().int().min(1).max(10),
        keywords: z.array(z.string()),
    })),
    /** two sentences on how this character now feels about the hero */
    relationship: z.string().min(1),
});

export const lemmaSchema = z.object({
    words: z.array(z.object({
        key: z.string(),
        /** the dictionary form, or null if this is a name or not a word */
        lemma: z.string().nullable(),
    })),
});
