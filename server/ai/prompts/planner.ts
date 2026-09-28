import "server-only";
import { BIOMES, TIMES_OF_DAY, WEATHERS } from "@/game/looks";
import { generate, type AiContext } from "../client";
import { goalPlanSchema, outlineSchema, type GoalPlan, type Outline } from "../schemas";
import { LOOKS, personFields } from "./forge";

/**
 * The planner: it never writes a word the reader reads. It outlines the book
 * once, when the book is made, and writes each chapter's goals when the
 * chapter begins — all of them at once — and again, from the point of failure
 * on, when a goal fails.
 *
 * Never interpolate into PLANNER: it is the cached head of every planning call.
 */
const PLANNER = `You plan a storybook adventure that a reader lives inside. You never write a word they read: you decide what each chapter asks of them, and a storyteller and the people of the book do the rest.

The reader is the hero. They walk a small world on foot, talk with the people who live in it, face its creatures in battles of words, and learn a language as they go.

# How the book works

The whole book is outlined before it begins: a handful of chapters, each with a title and a description. Where each chapter ends is fixed. How the hero gets there is not, and that is the fun of it.

A chapter is a checklist of goals, taken strictly one at a time, in the order you give them. There are six kinds:

- "tell": the storyteller tells the reader something: sets a scene, brings a person in, says what came of what has just happened. Your "brief" is the pointer the storyteller writes the page from: what to tell, and what feeling to leave. The reader never sees a tell in their checklist; it is done once it has been told. "targetKey" is null.
- "visit": the hero goes somewhere. "targetKey" is a place key (r…), or a building key (b…) or landmark key (l…) to walk up to.
- "talk": the hero speaks with someone about something. "targetKey" is a person key. The brief says what the talk is for and what this person has to tell, so that they can tell it.
- "persuade": the hero must win someone over to something particular. "targetKey" is a person key. The brief says exactly what is asked of them, why they are unwilling, and what might move them; draw on what they like and what puts them off. They may refuse. That is allowed to happen.
- "fight": the hero faces a creature. "targetKey" is a creature key. The hero may be driven back. That is allowed to happen.
- "examine": the hero looks closely at something. "targetKey" is a landmark key.

# What makes a good chapter

- Six to ten goals. The first is a tell that sets the chapter going. The last is a tell that lands the chapter where its description says it ends.
- Between a third and a half of the goals are tells. After a goal whose result matters, a tell says what came of it, written as though it went well. (When one goes badly you are asked to write the road again from there.)
- Vary what the hero does. A chapter of nothing but talk is a lecture: most chapters send the hero somewhere, have them speak with someone, and have them win something or face something.
- Every goal must be possible with what exists. Use only keys you are given, exactly as given. Never point two goals running at the same target. Never send the hero to the place they already stand in.
- A title is what a checklist says: short and plain, beginning with what to do. It never gives away what will come of it.
- The boss may be fought only in the chapter of the climax.
- Goals follow from one another and from what has already happened, and they leave the chapters still to come possible: nothing a later chapter turns on may be settled early.

# The world changes only through what you write down

The storyteller's pages are words; they move nothing. Whatever the story changes, you record in the fields, or it has not happened:
- "gains": what the hero has in hand once the goal is done, in a few words, or null. The book remembers it from then on.
- "moves": people the story moves once the goal is done. "who" is a person key; "to" is a place key, or "gone" when they leave the book.
- "enters": the keys of people who step into the story at this goal. Until someone has entered, nobody can meet them. People who have always lived in the world need no entering; new people do.`;

export type PlanBrief = {
    bible: string;
    /** the outline, once there is one */
    outline: string;
    heart: string;
    storySoFar: string;
    /** where the hero stands and what they carry */
    hero: string;
    people: string;
    creatures: string;
    places: string;
    buildings: string;
    landmarks: string;
    targetLanguageName: string;
    cacheKey: string;
};

const world = (brief: PlanBrief) => `PEOPLE
${brief.people || "(none)"}

CREATURES STILL AT LARGE
${brief.creatures || "(none)"}

PLACES
${brief.places || "(none)"}

BUILDINGS
${brief.buildings || "(none)"}

LANDMARKS
${brief.landmarks || "(none)"}`;

/** the outline of the whole book, and the goals of the chapter it opens with */
export async function writeOutline(ctx: AiContext, input: {
    brief: PlanBrief;
    startPlace: string;
}): Promise<Outline> {
    const { brief } = input;
    return generate({
        ctx,
        task: "outline",
        tier: "story",
        effort: "low",
        cacheKey: brief.cacheKey,
        maxOutputTokens: 6000,
        timeoutMs: 170_000,
        schema: outlineSchema,
        schemaName: "outline",
        instructions: `${PLANNER}

${brief.bible}`,
        input: `Outline the whole book, and write the goals of its first chapter.

"chapters": five to seven, in order from the first to the last. For each: "title" (two to five words); "stage" (introduction, rising, climax, falling, resolution: the stages come in that order, each at least once, and the rising action may take two or three chapters); and "description": two to four sentences for your own later use. Say what the chapter is for, who and what it turns on, and the state of things it must end in. Name people, places and creatures that exist by their names. The climax faces the boss. The last chapter ends the book, gently.

Make it one story from its first page to its last: what the first chapter plants, a later one must harvest. Give the people of the book their parts across it, and let the places be reached in an order that feels like a journey.

"goals": the goals of chapter 1. Its first goal is a tell: the hero arrives at ${input.startPlace}. In this chapter nobody enters who is not listed below, so "enters" is empty throughout.

What the book is really about (never stated outright): ${brief.heart}

THE HERO
${brief.hero}

${world(brief)}`,
    });
}

/** the goals of a chapter that is beginning, or the rest of a chapter in which a goal has just failed */
export async function writeGoals(ctx: AiContext, input: {
    brief: PlanBrief;
    chapter: { index: number; title: string; stage: string; description: string };
    /** the chapter after this one, or null when this is the last */
    after: { title: string; description: string } | null;
    /** set when a chapter has just ended and this one begins */
    closing: { index: number; title: string } | null;
    /** set when a goal has failed and the road is to be written again */
    mend: { failed: string; how: string; dropped: string } | null;
    /** whether the world has room for one more place */
    room: boolean;
}): Promise<GoalPlan> {
    const { brief, chapter, mend, closing } = input;
    const task = mend
        ? `In chapter ${chapter.index}, "${chapter.title}", the hero has just failed at something: "${mend.failed}". ${mend.how}

The failure stands: it happened, and the book does not pretend otherwise. Nor does it scold. The road bends here, and goes on to the same place.

Write the goals from here to the end of the chapter: another way to where the chapter must end.
- The first is a tell that says what the failure meant, kindly, and turns the hero toward the new way.
- Do not ask the same thing of the same person or creature again. Find a different way: someone else who could help, another place to look, a thing done by stealth instead of asking, a price paid.
- If the new way needs someone who does not exist, make them in "newPeople", and have them enter at the goal where the hero first needs them.
- Four to eight goals. The last is a tell that lands the chapter where its description says it ends.

THE ROAD THAT WAS PLANNED, AND IS NOW DROPPED
${mend.dropped || "(nothing was left of it)"}

"closingSummary": null.`
        : `${closing
            ? `Chapter ${closing.index}, "${closing.title}", has just ended. "closingSummary": two or three past-tense sentences on what happened in it, for the table of contents: what truly happened, failures and all.`
            : `"closingSummary": null.`}

Write the goals of chapter ${chapter.index}, "${chapter.title}": all of them, from its first to its last.`;

    return generate({
        ctx,
        task: mend ? "goals-mend" : "goals",
        tier: "story",
        effort: "low",
        cacheKey: brief.cacheKey,
        maxOutputTokens: 6000,
        timeoutMs: 170_000,
        schema: goalPlanSchema,
        schemaName: "goals",
        instructions: `${PLANNER}

${brief.bible}

${brief.outline}`,
        input: `${task}

WHAT THIS CHAPTER IS FOR (${chapter.stage})
${chapter.description}

WHAT COMES AFTER IT
${input.after ? `"${input.after.title}": ${input.after.description}` : "Nothing: this is the last chapter, and its last tell is the end of the book."}

What the book is really about (never stated outright): ${brief.heart}

THE STORY SO FAR
${brief.storySoFar || "(it has only just begun)"}

THE HERO
${brief.hero}

${world(brief)}

Also:
- "newPeople": people the story now needs who do not exist. At most two, and usually none: the people already in the book should carry it where they can. Give each the key "new1" or "new2", and "placeKey": the key of the place they are found in. ${personFields(brief.targetLanguageName)} No name may be one that anyone above already bears. Refer to them in goals by their key.
${LOOKS}
- "newPlace": ${!mend && input.room
            ? `if this chapter must go somewhere that does not exist yet, describe it: "kind" (settlement, wilds or depths), a name, "biome" (one of: ${BIOMES.join(", ")}), "timeOfDay" (${TIMES_OF_DAY.join(", ")}), "weather" (${WEATHERS.join(", ")}), "ambience" (one sentence of sound, smell and light), "description" (two sentences), "themeWords" (five to eight plain English nouns for things found there). A "visit" goal may send the hero there with the targetKey "new". Otherwise null: do not add a place the story can do without.`
            : "null."}
- "shifts": people whose aim has changed because of what has happened: "who" (a person key) and "wants" (what they want now, concretely, in one sentence). Leave out anyone whose aim is what it was.`,
    });
}
