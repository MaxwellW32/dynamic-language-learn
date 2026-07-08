import "server-only";
import { generate } from "./client";
import { chapterTransitionSchema, narrationSchema } from "./schemas";
import { segmentFormatRules, type WordOffer } from "./segments";
import type { ImmersionLevel } from "../services/learning";
import type { Story } from "@/db/schema";
import type { z } from "zod";

const NARRATOR_PERSONA = (story: Story) => `You are the narrator of "${story.title}", a warm illustrated-storybook adventure. Tone: ${story.tone}. The hero is ${story.playerName} — address them as "you", present tense. You write SHORT passages (40–110 words): one clear moment, vivid and concrete, never filler. You know only what the brief tells you — never invent characters, places, or past events that are not in it.

Premise of the book: ${story.premise}`;

export type NarrationKind = "arrival" | "inspect" | "victory" | "questBeat";

export async function generateNarration(input: {
    story: Story;
    kind: NarrationKind;
    sceneBrief: string;
    chronicleBrief: string;
    recentPassages: string;
    focus: string;
    offer: WordOffer;
    immersionLevel: ImmersionLevel;
}): Promise<z.infer<typeof narrationSchema>> {
    const kindGuidance: Record<NarrationKind, string> = {
        arrival: "The hero has just arrived somewhere. Paint the place through the senses in the ambience notes, and hint at what invites attention here.",
        inspect: "The hero examines something closely. Reveal its lore as discovery — let the object imply history. If it can whisper toward an active quest, let it.",
        victory: "The hero has just prevailed in a challenge of words. Celebrate briefly — warm, a little triumphant — and return them to the scene.",
        questBeat: "Something in the story just moved forward. Mark the moment and point gently toward what's next.",
    };

    return generate({
        task: `narration-${input.kind}`,
        schema: narrationSchema,
        instructions: `${NARRATOR_PERSONA(input.story)}

${kindGuidance[input.kind]}

Set "eventSummary" to one past-tense line for the chronicle if this moment is worth remembering later, else null.

The prose is in ${input.story.nativeLanguage}; the hero is learning ${input.story.targetLanguage}.
${segmentFormatRules(input.immersionLevel)}

OFFERED WORDS:
${input.offer.brief}`,
        input: `SCENE:\n${input.sceneBrief}\n\nRECENTLY IN THE BOOK:\n${input.recentPassages}\n\nCHRONICLE:\n${input.chronicleBrief}\n\nWRITE ABOUT:\n${input.focus}`,
    });
}

export async function generateChapterTransition(input: {
    story: Story;
    closingChapterTitle: string;
    nextArcStage: string;
    chronicleBrief: string;
    offer: WordOffer;
    immersionLevel: ImmersionLevel;
}): Promise<z.infer<typeof chapterTransitionSchema>> {
    return generate({
        task: "chapterTransition",
        schema: chapterTransitionSchema,
        instructions: `${NARRATOR_PERSONA(input.story)}

The chapter "${input.closingChapterTitle}" is complete, and the book turns a page into its "${input.nextArcStage}" stage. Provide:
- "closingSummary": 2–3 past-tense sentences summarizing the finished chapter (for the book's table of contents).
- "nextChapterTitle": a title for the new chapter (2–5 words).
- "passage": a 50–90 word bridge passage — the world shifts, stakes deepen, the hero feels the new chapter begin.
${segmentFormatRules(input.immersionLevel)}

OFFERED WORDS:
${input.offer.brief}`,
        input: `CHRONICLE OF THE FINISHED CHAPTER:\n${input.chronicleBrief}`,
    });
}
