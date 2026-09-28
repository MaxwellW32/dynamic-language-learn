import "server-only";
import { generate, type AiContext } from "../client";
import { tellingSchema, type Telling } from "../schemas";
import type { WordOffer } from "../segments";
import { RULEBOOK } from "./rulebook";

export type NarratorBrief = {
    bible: string;
    /** the whole book in outline: the storyteller knows where it is going, the reader does not */
    outline: string;
    immersion: number;
    /** the chapter in hand: what it is called and what it is for */
    chapter: string;
    /** the chapters behind, and what has come of this one's goals so far */
    storySoFar: string;
    /** the last pages of the book, as plain text */
    lately: string;
    scene: string;
    /** what the hero has come by and still carries, or "" */
    carrying: string;
    offer: WordOffer;
    cacheKey: string;
};

/** something to tell: a goal's pointer, or a thing the hero has bent down to look at */
export type ToTell = { key: string; title: string; brief: string };

/**
 * Turn pointers into pages. Tells that follow one another are written at one
 * sitting, a page each: one request instead of several, and pages that read
 * on from each other because one hand wrote them together.
 */
export async function writeTelling(ctx: AiContext, brief: NarratorBrief, tells: ToTell[], options: {
    task?: string;
    words?: string;
    how?: string;
    /** set when a first attempt came back with a page that had none of the TARGET language in it */
    again?: boolean;
} = {}): Promise<Telling> {
    const many = tells.length > 1;
    return generate({
        ctx,
        task: options.task ?? "tell",
        tier: "story",
        effort: "none",
        cacheKey: brief.cacheKey,
        maxOutputTokens: 900 + tells.length * 1100,
        schema: tellingSchema,
        // one name for every page the storyteller writes: each finds the prefix the last one paid for
        schemaName: "telling",
        instructions: `${RULEBOOK}

${brief.bible}

${brief.outline}`,
        input: `IMMERSION LEVEL: ${brief.immersion}

Write ${many ? `${tells.length} pages of the book, one for each of the things to tell below, in their order` : "the next page of the book"}: ${options.words ?? "60 to 110"} words${many ? " each. Every page stands as a page of its own; together they read on from one another" : ""}.

${options.how ?? "What to tell is a pointer, written for you and not for the reader: tell it as story, in the hero's own present, through what they see and hear and are told. Say what it asks you to say and no more. Leave the hero free: never write what they decide, say or feel about what is asked of them next."}

${many ? "THINGS TO TELL" : "WHAT TO TELL"}
${tells.map((tell) => `- ${tell.key}: ${tell.title}. ${tell.brief}`).join("\n")}

THE CHAPTER IN HAND
${brief.chapter}

THE STORY SO FAR
${brief.storySoFar || "(it has only just begun)"}

THE BOOK'S LAST PAGES
${brief.lately || "(these are its first)"}

THE SCENE
${brief.scene}
${brief.carrying ? `\nTHE HERO CARRIES\n${brief.carrying}\n` : ""}
OFFERED WORDS
${brief.offer.brief}
Every page must hold at least one "vocab" or "tl" segment.${many ? " Use each offered word at most twice across all the pages." : ""}${options.again ? `
You have written this once already, and a page came back with nothing in the TARGET language: the reader learned nothing from it. This time, in every page, something is said or named in the TARGET language — an offered word where one fits, and where none does, a short "tl" segment in someone's mouth.` : ""}

"pages": one entry for each key above, with "key" exactly as given.`,
    });
}
