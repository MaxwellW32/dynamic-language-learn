import "server-only";
import type { BookBrief } from "@/db/schema";
import { languageOf } from "@/game/languages";
import type { Sparks } from "@/game/sparks";
import {
    ACCESSORIES, AGES, BIOMES, BOSS_KINDS, BUILDS, CLOTH_COLORS, CREATURE_KINDS, CREATURE_TINTS,
    HAIR_COLORS, HAIR_STYLES, HATS, OUTFITS, SKIN_TONES, TIMES_OF_DAY, TTS_VOICES, WEATHERS,
} from "@/game/looks";
import { generate, type AiContext } from "../client";
import {
    castFillSchema, openingSchema, placesFillSchema, storySeedSchema,
    type Opening, type RegionSketch, type StorySeed, type WorldFill,
} from "../schemas";
import type { WordOffer } from "../segments";
import { RULEBOOK } from "./rulebook";

const AUTHOR = `You are the author of a storybook adventure that a reader will live inside. You write vividly and economically. Wonder over darkness; peril without cruelty; nothing generic — every name, place and person should feel as if it could only belong to this book.`;

const list = (values: readonly string[]) => values.join(", ");
const keys = (object: object) => Object.keys(object).join(", ");

/** call one: the idea of the book and the three places it begins with */
export async function writeSeed(ctx: AiContext, input: {
    playerName: string;
    targetLanguage: string;
    brief: BookBrief;
    startingLevel: number;
    /** drawn by lot for this book, so that no two books begin from the same idea */
    sparks: Sparks;
}): Promise<StorySeed> {
    const target = languageOf(input.targetLanguage);
    return generate({
        ctx,
        task: "forge-seed",
        tier: "story",
        // no deliberation: invention is what this model does unprompted, and thinking first tripled the wait
        effort: "none",
        schema: storySeedSchema,
        instructions: `${AUTHOR}

Invent a new book.

- "title": three to six words, no subtitle.
- "premise": 80 to 130 words, second person, present tense — what the back cover says. It establishes a home the hero starts in, wilder country beyond it, something old and hidden further still, and one mystery pulling the hero onward. Name no characters.
- "tone": three to five adjectives.
- "heart": the question the whole book turns on, in one sentence. The reader never sees this; it keeps the story honest.
- "facts": four to six short statements about this world that must stay true for the whole book (how its magic works, what its people fear, what was lost).
- Three places, each with a name, and:
  - "home": a settlement — where the hero starts, safe and full of people.
  - "wilds": the open country beyond it — where creatures roam.
  - "depths": the old, hidden place where the mystery waits.
  For each: "biome" (one of: ${list(BIOMES)}), "timeOfDay" (one of: ${list(TIMES_OF_DAY)}), "weather" (one of: ${list(WEATHERS)}), "ambience" (one sentence of sound, smell and light), "description" (two sentences: what it is, why it matters), and "themeWords": five to eight plain, common English nouns for things one would find in that particular place — they decide which vocabulary the place teaches, so choose everyday things a child could name, not rare ones.

Let the three places differ from each other in biome and hour, so that travelling between them feels like travelling. The home should be welcoming by daylight or golden light; the depths may be dark.

The world should quietly evoke the places where ${target.name} is spoken — its food, festivals, weather, the shape of its names — without being a real country. All prose is in English.`,
        input: `The hero is called ${input.playerName}. They are learning ${target.name}, ${["from the very beginning", "with a little behind them", "at an intermediate level", "at an advanced level"][input.startingLevel] ?? "from the beginning"}.

The kind of story they asked for: ${input.brief.genre}.
The mood they asked for: ${input.brief.tone}.
${input.brief.wish.trim() ? `In their own words: "${input.brief.wish.trim().slice(0, 500)}". Honour the spirit of this above all.` : "They left the rest to you. Surprise them."}

DRAWN BY LOT FOR THIS BOOK
So that it is like no other book, build it from these. Bend them as the story needs${input.brief.wish.trim() ? ", and drop any that quarrel with what the reader asked for" : ""}, but do not swap them for something more familiar:
- the home and its country: ${input.sparks.land}
- what its people are known for: they are ${input.sparks.folk}
- a thing that matters: ${input.sparks.thing}
- what is strange: ${input.sparks.strange}
- the shape of the title: ${input.sparks.title} (and not "The … Beneath the …")`,
    });
}

export type FillBrief = {
    /** "- n1: stands outside the inn" */
    people: string;
    /** "- e1: a minion in the wilds" */
    creatures: string;
    /** "- l1: in the plaza of r1 — one of: fountain, well, statue" */
    landmarks: string;
    /** "- b1: an inn in r1" */
    buildings: string;
};

const LOOKS = `For each person's "look", choose from these lists only:
build: ${list(BUILDS)} · age: ${list(AGES)} · skin: ${keys(SKIN_TONES)} · hair: ${list(HAIR_STYLES)} · hairColor: ${keys(HAIR_COLORS)} · outfit: ${list(OUTFITS)} · primary and secondary (cloth colours): ${keys(CLOTH_COLORS)} · hat: ${list(HATS)} · accessory: ${list(ACCESSORIES)}
"voice" is one of: ${list(TTS_VOICES)}.
Make people look different from one another, and let the look say who they are: a baker in an apron, a scholar with a book.`;

type FillInput = {
    seed: Pick<StorySeed, "title" | "premise" | "tone" | "heart" | "facts">;
    places: string;
    targetLanguage: string;
    playerName: string;
    brief: FillBrief;
};

const theBook = (input: FillInput) => `THE BOOK
Title: ${input.seed.title}
Premise: ${input.seed.premise}
Tone: ${input.seed.tone}
What it is really about: ${input.seed.heart}
What is true of this world:
${input.seed.facts.map((fact) => `- ${fact}`).join("\n")}
The hero: ${input.playerName}

PLACES
${input.places}`;

/** the long forge calls write thousands of tokens: give them room before calling it a failure */
const FORGE_TIMEOUT_MS = 170_000;

/** who lives here */
async function writeCast(ctx: AiContext, input: FillInput) {
    const target = languageOf(input.targetLanguage);
    return generate({
        ctx,
        task: "forge-cast",
        tier: "story",
        effort: "none",
        maxOutputTokens: 7000,
        timeoutMs: FORGE_TIMEOUT_MS,
        schema: castFillSchema,
        instructions: `${AUTHOR}

The geography of the book is already drawn. People it. Answer for every key in the brief, using each key exactly as given, and no others.

For each person: a name; "role" (their place in the world, two to four words); "personality" (two or three vivid traits, one of them a flaw or quirk); "appearance" (one sentence); "backstory" (two or three sentences); "secret" (one thing they would only tell a friend — it should matter to the story); "goal" (what they want right now, concretely); "speechStyle" (how they talk: rhythm, pet phrases, formality); "look"; "voice"; and "barks": three short things they call out in ${target.name} as the hero passes — a greeting, a remark about the weather or their work, an invitation — each with its English translation. Barks are one to five words of simple, natural ${target.name}.

The cast must interlock: shared history, small tensions, reasons to send the hero to one another. At least one of them knows more about the mystery than they admit.

${LOOKS}

Names should sound like ${target.name} names where that is natural. Everything else is in English.`,
        input: `${theBook(input)}

PEOPLE TO CREATE
${input.brief.people}`,
    });
}

/** what lurks here, what there is to find, what the signboards say */
async function writePlaces(ctx: AiContext, input: FillInput) {
    const target = languageOf(input.targetLanguage);
    return generate({
        ctx,
        task: "forge-places",
        tier: "story",
        effort: "none",
        maxOutputTokens: 7000,
        timeoutMs: FORGE_TIMEOUT_MS,
        schema: placesFillSchema,
        instructions: `${AUTHOR}

The geography of the book is already drawn. Fill it. You may not add, move or remove anything: answer for every key in the brief, using each key exactly as given, and no others.

CREATURES. For each: a name; "description" (one sentence); "introLine" (how the encounter begins — playful menace, one sentence); "defeatLine" (how it yields, one sentence); "kind" (ordinary creatures: ${list(CREATURE_KINDS)}; the boss only: ${list(BOSS_KINDS)}); "tint" (${keys(CREATURE_TINTS)}).
These are creatures of a gentle book: they are bested with words, and they yield rather than die. Vary their kinds. The boss is the mystery made flesh — memorable, and not merely wicked.

LANDMARKS. For each: "kind" — one of the kinds offered for that spot; "name"; "lore": one or two sentences a curious reader discovers on examining it. Let at least two landmarks hold a clue to the mystery.

BUILDINGS. For each: a name of the kind a signboard would carry.

Names should sound like ${target.name} names where that is natural. Everything else is in English.`,
        input: `${theBook(input)}

CREATURES TO CREATE
${input.brief.creatures}

LANDMARKS TO CREATE
${input.brief.landmarks}

BUILDINGS TO NAME
${input.brief.buildings}`,
    });
}

/**
 * Call two, in two halves that run side by side: the people, and everything
 * else. Written as one request the world took a minute and a half; halved, the
 * wait is that of the longer half.
 */
export async function writeWorld(ctx: AiContext, input: FillInput): Promise<WorldFill> {
    const [people, places] = await Promise.all([writeCast(ctx, input), writePlaces(ctx, input)]);
    return { ...people, ...places };
}

/** call three: the first page, the first quests, and the threads the story will pull on */
export async function writeOpening(ctx: AiContext, input: {
    bible: string;
    heart: string;
    cast: string;
    creatures: string;
    places: string;
    landmarks: string;
    startPlace: string;
    offer: WordOffer;
    immersion: number;
    cacheKey: string;
}): Promise<Opening> {
    return generate({
        ctx,
        task: "forge-opening",
        tier: "story",
        effort: "none",
        timeoutMs: FORGE_TIMEOUT_MS,
        cacheKey: input.cacheKey,
        schema: openingSchema,
        instructions: `${RULEBOOK}

${input.bible}`,
        input: `Write the opening of the book.

"chapterTitle": two to five words.

"passage": the first page — the hero arrives at ${input.startPlace}. 90 to 130 words. End on something worth walking toward.

"quests": two or three quests for the beginning of the story: meeting the world and its people, and the first hints of the mystery. Stakes are gentle and local. Each has a title, a description of one or two sentences in second person, "giverKey" (the key of the person who gives it, or null), and one to four objectives.
Objective kinds, and what "targetKey" must be:
- "talkTo": meet someone → a person key
- "persuade": win someone over about something specific — say what, in the description → a person key
- "defeat": best a creature → a creature key
- "visit": reach a place → a place key
- "inspect": examine a landmark → a landmark key
- "learnWords": grow the hero's vocabulary → null, with "wordCount" 3 to 8
Use only keys listed below. Objectives should chain naturally: meet, then learn, then venture, then face. At most one "learnWords" objective in all. The first objective of the first quest must be something the hero can do in ${input.startPlace}. Do not ask the hero to defeat the boss yet.

"threads": three or four threads the story will pull on — a mystery, a promise, a conflict, a bond. Each has a title, a kind, a summary of one or two sentences, and an importance from 1 to 10. They are notes to yourself: the reader does not see them.

What the book is really about (never state it outright): ${input.heart}

IMMERSION LEVEL: ${input.immersion}

OFFERED WORDS
${input.offer.brief}

PEOPLE
${input.cast}

CREATURES
${input.creatures}

PLACES
${input.places}

LANDMARKS
${input.landmarks}`,
    });
}

/** the look of a region that joins the world later, as a story grows */
export type { RegionSketch };
