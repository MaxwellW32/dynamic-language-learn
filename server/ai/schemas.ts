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
 * goals are referred to by the short keys we hand it (w1, n2, r1…), and
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
    /** two or three things that warm them to someone, a few words each */
    likes: z.array(z.string()),
    /** two or three things that put them off */
    dislikes: z.array(z.string()),
    look: lookSchema,
    voice: z.string().describe(TTS_VOICES.join(" | ")),
    /** three short things they call out in the TARGET language as the hero walks by */
    barks: z.array(z.object({ target: z.string(), translation: z.string() })),
});
export type CastMember = z.infer<typeof castMember>;

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

/* ------------------------------------------------------------------ */
/* the outline and the goals                                           */
/* ------------------------------------------------------------------ */

const chapterSketch = z.object({
    title: z.string().min(1),
    stage: z.enum(["introduction", "rising", "climax", "falling", "resolution"]),
    /** what the chapter is for and where it must end; never shown to the reader */
    description: z.string().min(1),
});
export type ChapterSketch = z.infer<typeof chapterSketch>;

const goalSketch = z.object({
    kind: z.enum(["tell", "visit", "talk", "persuade", "fight", "examine"]),
    /** what the reader's checklist says; for a tell, a working title they never see */
    title: z.string().min(1),
    /** for whoever writes or speaks when the goal comes due */
    brief: z.string().min(1),
    /** tell: null · visit: a place, building or landmark key · talk, persuade: a person key · fight: a creature key · examine: a landmark key */
    targetKey: z.string().nullable(),
    /** what the hero has in hand if it goes well, or null */
    gains: z.string().nullable(),
    /** keys of people who step into the story at this goal */
    enters: z.array(z.string()),
    /** people the story moves once this goal is done; "to" is a place key, or "gone" */
    moves: z.array(z.object({ who: z.string(), to: z.string() })),
});
export type GoalSketch = z.infer<typeof goalSketch>;

/** the whole book in outline, and the goals of the chapter it begins (or goes on) with */
export const outlineSchema = z.object({
    chapters: z.array(chapterSketch),
    goals: z.array(goalSketch),
});
export type Outline = z.infer<typeof outlineSchema>;

const newPerson = castMember.extend({
    /** the key of the place they are found in */
    placeKey: z.string(),
});
export type NewPerson = z.infer<typeof newPerson>;

/** a chapter's goals: all of them when it begins, or the rest of them after one has failed */
export const goalPlanSchema = z.object({
    /** what happened in the chapter that has just ended, for the table of contents; null when none has */
    closingSummary: z.string().nullable(),
    goals: z.array(goalSketch),
    /** people the story now needs who do not exist yet; usually empty */
    newPeople: z.array(newPerson),
    /** a place the story now needs that does not exist yet, or null */
    newPlace: regionSketch.extend({ kind: z.enum(["settlement", "wilds", "depths"]) }).nullable(),
    /** people whose aim has changed because of what happened */
    shifts: z.array(z.object({ who: z.string(), wants: z.string().min(1) })),
});
export type GoalPlan = z.infer<typeof goalPlanSchema>;

/* ------------------------------------------------------------------ */
/* live play                                                           */
/* ------------------------------------------------------------------ */

/** pages the storyteller writes: one for each thing it was asked to tell */
export const tellingSchema = z.object({
    pages: z.array(z.object({
        /** the key the page was asked for under */
        key: z.string(),
        passage: z.array(aiSegmentSchema),
    })),
});
export type Telling = z.infer<typeof tellingSchema>;

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
    /** where they stand on what the hero has come for, -5 … 5; null when nothing is at stake */
    lean: z.number().int().min(-5).max(5).nullable(),
    /** their answer, once they have one; null while they are still making up their mind */
    decision: z.enum(["yes", "no"]).nullable(),
    /** with a decision: one past-tense line for the book's record of what came of it */
    outcome: z.string().nullable(),
});
export type CharacterTurn = z.infer<typeof characterTurnSchema>;

/* ------------------------------------------------------------------ */
/* the scribe                                                          */
/* ------------------------------------------------------------------ */

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
