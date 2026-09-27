import "server-only";
import { BIOMES, TIMES_OF_DAY, WEATHERS } from "@/game/looks";
import { generate, type AiContext } from "../client";
import { chapterTurnSchema, narrationSchema, type ChapterTurn, type Narration } from "../schemas";
import type { WordOffer } from "../segments";
import { RULEBOOK } from "./rulebook";

export type NarrationKind = "arrival" | "inspect" | "victory" | "beat" | "choice";

export type NarratorBrief = {
    bible: string;
    immersion: number;
    scene: string;
    /** the last passages of the book, as plain text */
    lately: string;
    /** recent chronicle lines */
    chronicle: string;
    /** the director's standing note on where the story should lean */
    lean: string;
    offer: WordOffer;
    cacheKey: string;
};

/**
 * `forks` says when a passage should end in a choice, or null where it never
 * does. A reader who is never asked anything is only being read to: the
 * moments a quest turns on are theirs to steer, and what they choose is
 * written into the chronicle with weight, where the director finds it.
 */
const TASK: Record<NarrationKind, { words: string; how: string; forks: string | null }> = {
    arrival: {
        words: "60 to 100",
        how: "The hero has just arrived somewhere for the first time. Let them take it in through the senses — the ambience notes are yours to use — and let one thing in the scene invite them closer.",
        forks: null,
    },
    inspect: {
        words: "50 to 90",
        how: "The hero examines something closely. Reveal its lore as a discovery: let the object imply its history rather than recite it. If it can whisper toward something the hero is seeking, let it.",
        forks: "if what the hero has found invites them to DO something — open it, take it, follow it, leave it be — end the passage there and offer two or three such ways on. If it only tells them something, null.",
    },
    victory: {
        words: "40 to 70",
        how: "The hero has just bested a creature with words. Let the creature yield in its own way — it is not slain, it is answered. Warm, a little triumphant, then back to the world.",
        forks: null,
    },
    beat: {
        words: "50 to 90",
        how: "Something in the story has just moved. Mark the moment, let its weight land, and turn the hero's eyes toward what comes next.",
        forks: "this is a turning point, and the story is the hero's to steer: end the passage at the moment of deciding and offer two or three ways on that would lead to different things — whom to trust, what to do with what was found, which way to turn. Null only when nothing could reasonably differ.",
    },
    choice: {
        words: "60 to 100",
        how: "The hero has chosen. Write what follows from that choice — it must matter: something is gained, lost, learned or changed because they chose this and not the other.",
        forks: null,
    },
};

export async function writeNarration(ctx: AiContext, brief: NarratorBrief, kind: NarrationKind, about: string): Promise<Narration> {
    const task = TASK[kind];
    return generate({
        ctx,
        task: `narrate-${kind}`,
        tier: "story",
        effort: "none",
        cacheKey: brief.cacheKey,
        maxOutputTokens: 1800,
        schema: narrationSchema,
        // one name for every kind of passage: an arrival can then reuse the prefix a quest beat has just paid for
        schemaName: "narration",
        instructions: `${RULEBOOK}

${brief.bible}`,
        input: `IMMERSION LEVEL: ${brief.immersion}

Write the next passage of the book: ${task.words} words.

${task.how}

WHAT TO WRITE ABOUT
${about}

THE SCENE
${brief.scene}

THE BOOK SO FAR, MOST RECENTLY
${brief.lately || "(these are its first pages)"}

WHAT HAS HAPPENED
${brief.chronicle || "(nothing yet)"}
${brief.lean ? `\nWHERE THE STORY IS LEANING\n${brief.lean}\n` : ""}
OFFERED WORDS
${brief.offer.brief}
The passage must hold at least one "vocab" or "tl" segment.

Also:
- "eventSummary": one past-tense line for the chronicle if this moment is worth remembering later; otherwise null.
- "importance": how much this matters to the story, 1 (a pleasant detail) to 10 (nothing will be the same).
- "choices": ${task.forks
        ? `${task.forks} Each choice is a "label" of at most eight words in the hero's voice ("Follow the sound into the reeds") and a one-word "tone". Choices are things the hero can do here and now, with what the brief says exists.`
        : "null."}`,
    });
}

export async function writeChapterTurn(ctx: AiContext, input: {
    brief: NarratorBrief;
    closing: string;
    nextStage: string | null;
    stageGuidance: string;
    threads: string;
    cast: string;
    creatures: string;
    places: string;
    landmarks: string;
    /** the sides of existing places a new region could be joined to; empty when the world is full */
    room: boolean;
}): Promise<ChapterTurn> {
    const { brief } = input;
    return generate({
        ctx,
        task: "chapter-turn",
        tier: "story",
        effort: "low",
        cacheKey: brief.cacheKey,
        maxOutputTokens: 4500,
        schema: chapterTurnSchema,
        instructions: `${RULEBOOK}

${brief.bible}`,
        input: `IMMERSION LEVEL: ${brief.immersion}

The chapter "${input.closing}" is finished. ${input.nextStage ? `The book turns to ${input.nextStage}. ${input.stageGuidance}` : "This was the last chapter: the book is ending."}

Write:
- "closingSummary": two or three past-tense sentences for the table of contents.
- "nextChapterTitle": two to five words${input.nextStage ? "" : ` (for the epilogue)`}.
- "passage": 70 to 110 words — ${input.nextStage ? "the world shifts, the stakes deepen, the hero feels the new chapter begin." : "the ending: what has changed, who is there to see it, the hero's place in the world they altered."}
- "quests": ${input.nextStage ? `two or three quests for the new chapter, built on what has actually happened — if the hero made a promise, broke one, won a friend or lost one, the quests know it. Use the objective kinds and keys as listed below; use only keys that are listed. Never repeat something already done. Between them the quests ask for more than talk: somewhere to reach, something to examine, a creature to face.` : "an empty list."}
- "newFacts": things that have become true and must not be forgotten — at most three, each one short sentence. Often empty.
- "newRegion": ${input.nextStage && input.room ? `if the story now needs somewhere new — a place spoken of but never seen — describe it: "kind" (settlement, wilds or depths), a name, "biome" (one of: ${BIOMES.join(", ")}), "timeOfDay" (${TIMES_OF_DAY.join(", ")}), "weather" (${WEATHERS.join(", ")}), "ambience", "description", "themeWords". A new quest may send the hero there with a "visit" objective whose targetKey is "new". Otherwise null — do not add a place the story does not need.` : "null."}

Objective kinds and what "targetKey" must be: "talkTo" and "persuade" → a person key; "defeat" → a creature key; "visit" → a place key; "inspect" → a landmark key; "learnWords" → null with "wordCount" 3 to 8.

OPEN THREADS
${input.threads || "(none)"}

WHAT HAPPENED IN THE CHAPTER
${brief.chronicle || "(little)"}
${brief.lean ? `\nWHERE THE STORY IS LEANING\n${brief.lean}\n` : ""}
PEOPLE
${input.cast}

CREATURES STILL AT LARGE
${input.creatures || "(none)"}

PLACES
${input.places}

LANDMARKS
${input.landmarks || "(none)"}

OFFERED WORDS
${brief.offer.brief}`,
    });
}
