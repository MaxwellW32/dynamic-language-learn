import "server-only";
import type { Character } from "@/db/schema";
import { generate, type AiContext } from "../client";
import { characterTurnSchema, greetingSchema, type CharacterTurn } from "../schemas";
import type { WordOffer } from "../segments";
import { characterSheet, RULEBOOK } from "./rulebook";
import type { z } from "zod";

export type CharacterBrief = {
    bible: string;
    character: Character;
    playerName: string;
    targetLanguageName: string;
    immersion: number;
    affinity: number;
    /** two sentences on how they feel about the hero, or "" */
    relationship: string;
    /** "- …" lines, already chosen and ranked */
    memories: string;
    /** everything older than the recent lines, in a paragraph, or "" */
    summary: string;
    /** "Name: line" per line, oldest first */
    recent: string;
    scene: string;
    /** "- o1: …" lines, or "" when nothing is at stake */
    objectives: string;
    offer: WordOffer;
};

/** the name a character's turn is asked for under, greeting or reply: see `schemaName` in the client */
const TURN = "character-turn";

const OPTION_RULES =(immersion: number, language: string) => {
    const mix =
        immersion <= 0 ? `All three in English.`
        : immersion === 1 ? `Two in English; one a very short ${language} phrase the hero could manage (one to three words).`
        : immersion === 2 ? `One in English; two in simple ${language} (at most six words each).`
        : `All three in ${language}, in short sentences a learner at this level could say.`;
    return `"options": exactly three things the hero might say next — different in intent, not three phrasings of one thought. One moves the story on, one asks about the person in front of them, one is playful or bold. Each is what the hero would actually say, in the first person, at most twelve words. "tone" is one word (kind, curious, bold, wary, playful…). ${mix} For a ${language} option set "inTarget" true and give "translation"; otherwise "inTarget" false and "translation" null.`;
};

function moving(brief: CharacterBrief): string {
    const c = brief.character;
    return `IMMERSION LEVEL: ${brief.immersion}

YOUR MOOD: ${c.mood}
WHAT YOU WANT RIGHT NOW: ${c.goal || "nothing in particular"}
AFFINITY: ${brief.affinity}${brief.relationship ? ` — ${brief.relationship}` : ""}

WHAT YOU REMEMBER (these are your only memories of the hero — never invent others)
${brief.memories || "(you have never met the hero before)"}

EARLIER IN THIS CONVERSATION
${brief.summary || "(nothing before the lines below)"}

THE SCENE
${brief.scene}

OFFERED WORDS
${brief.offer.brief}
What you say must hold at least one "vocab" or "tl" segment.`;
}

/**
 * The character speaks first: the hero has just walked up. Asked for in the
 * shape of any other turn (with the parts a greeting has no use for left
 * null), so that the first reply after it finds the prompt already cached.
 */
export async function writeGreeting(ctx: AiContext, brief: CharacterBrief): Promise<z.infer<typeof greetingSchema>> {
    const c = brief.character;
    const turn = await generate({
        ctx,
        task: "greeting",
        tier: "story",
        effort: "none",
        cacheKey: `${ctx.bookId}:${c.id}`,
        maxOutputTokens: 1500,
        schema: characterTurnSchema,
        schemaName: TURN,
        instructions: `${RULEBOOK}

${brief.bible}

${characterSheet(c)}`,
        input: `${moving(brief)}
${brief.recent ? `\nTHE LAST LINES, FROM WHEN YOU LAST SPOKE\n${brief.recent}\n` : ""}
${brief.playerName} has just walked up to you. Speak first: one or two short beats — a greeting that fits how well you know them and what you are in the middle of doing. If you have met before, let it show.

- "mood": your mood now.
- "gesture": what your body does as you speak.
- ${OPTION_RULES(brief.immersion, brief.targetLanguageName)}
- Nothing has been said to you yet: "affinityDelta" is 0, and "memory", "note", "objectiveAchieved" and "objectiveFailed" are null.`,
    });
    return { reply: turn.reply, mood: turn.mood, gesture: turn.gesture, options: turn.options };
}

export async function writeReply(ctx: AiContext, brief: CharacterBrief, said: string): Promise<CharacterTurn> {
    const c = brief.character;
    return generate({
        ctx,
        task: "dialogue",
        tier: "story",
        effort: "none",
        cacheKey: `${ctx.bookId}:${c.id}`,
        maxOutputTokens: 2200,
        schema: characterTurnSchema,
        schemaName: TURN,
        instructions: `${RULEBOOK}

${brief.bible}

${characterSheet(c)}`,
        input: `${moving(brief)}

THE LAST LINES
${brief.recent || "(the conversation is just beginning)"}

${brief.playerName} now says: """${said}"""

Answer as ${c.name}.

Then, honestly:
- "mood": your mood now.
- "gesture": what your body does as you speak.
- "affinityDelta": how this exchange moved your feelings, -5 to 5. Usually -1 to 1. Large only for large moments: a kindness, an insult, a promise kept.
- "memory": if this exchange gave you something you would still remember next week — a promise, a kindness, a secret shared, an insult, a fact about the hero — write it in one sentence from YOUR point of view, with "importance" 1 to 10, "kind" (episode: something that happened; fact: something you learned about the hero; promise: something one of you undertook to do), and three to six lower-case "keywords" that should bring it back to mind. Otherwise null. Most exchanges are null.
- ${OPTION_RULES(brief.immersion, brief.targetLanguageName)}
- "note": if the hero's words above contain any ${brief.targetLanguageName}, judge that ${brief.targetLanguageName} as a patient teacher would. "verdict": good (natural as written), close (understood, with slips), off (not understandable). "better": how a native speaker would have said the same thing, or null if theirs was already natural. "tip": the single most useful correction in one short, kind English sentence, or null. "usedWords": the dictionary forms of the ${brief.targetLanguageName} words they used correctly. If they wrote only English, "note" is null.
- "objectiveAchieved": ${brief.objectives ? `the key of an objective below that the hero has now clearly achieved, else null. Judge strictly: you must genuinely have been won over, not merely asked.` : "null — nothing is at stake in this conversation."}
- "objectiveFailed": ${brief.objectives ? `the key of an objective below ONLY if you have just refused so finally that no later conversation could change your mind. Doubt, reluctance and "not yet" are not failure. This is rare.` : "null."}${brief.objectives ? `

WHAT IS AT STAKE
${brief.objectives}` : ""}`,
    });
}
