import "server-only";
import type { Character } from "@/db/schema";
import { LEAN_MAX, LEAN_MIN } from "@/game/goals";
import { generate, type AiContext } from "../client";
import { characterTurnSchema, type CharacterTurn } from "../schemas";
import type { WordOffer } from "../segments";
import { characterSheet, RULEBOOK } from "./rulebook";

/** what the hero has come to this person for, when the goal in hand is theirs to settle */
export type StakeBrief = {
    kind: "talk" | "persuade";
    title: string;
    brief: string;
    /** persuade: where they stood after the last thing said */
    lean: number;
    /** how many things the hero has said to them about it so far */
    heroLines: number;
};

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
    /** what the hero carries, or "" */
    carrying: string;
    stake: StakeBrief | null;
    /** the two are not in the same place */
    remote: boolean;
    offer: WordOffer;
};

/** the name a character's turn is asked for under, whatever kind of turn: see `schemaName` in the client */
const TURN = "character-turn";

const OPTION_RULES = (brief: CharacterBrief) => {
    const language = brief.targetLanguageName;
    const mix =
        brief.immersion <= 0 ? `All three in English.`
        : brief.immersion === 1 ? `Two in English; one a very short ${language} phrase the hero could manage (one to three words).`
        : brief.immersion === 2 ? `One in English; two in simple ${language} (at most six words each).`
        : `All three in ${language}, in short sentences a learner at this level could say.`;
    const intents = brief.stake
        ? "One takes up what the hero has come for, one asks about the person in front of them, one is playful or bold."
        : "One moves the story on, one asks about the person in front of them, one is playful or bold.";
    return `"options": exactly three things the hero might say next — different in intent, not three phrasings of one thought. ${intents} Each is what the hero would actually say, in the first person, at most twelve words. "tone" is one word (kind, curious, bold, wary, playful…). ${mix} For a ${language} option set "inTarget" true and give "translation"; otherwise "inTarget" false and "translation" null.`;
};

function atStake(brief: CharacterBrief): string {
    const stake = brief.stake;
    if (!stake) return "";
    return stake.kind === "persuade"
        ? `
WHAT THE HERO HAS COME TO ASK OF YOU
${stake.title}. ${stake.brief}
(This is what is in the hero's mind, not yet in yours: you learn of it as they speak of it.)
WHERE YOU STAND ON IT: ${stake.lean}, on a scale from ${LEAN_MIN} (you will not hear of it) to ${LEAN_MAX} (you are won).
`
        : `
WHAT THE HERO HAS COME TO YOU FOR
${stake.title}. ${stake.brief}
(What you have to tell them, tell them in your own way and your own time: a person, not a noticeboard.)
`;
}

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
${brief.remote
        ? `${brief.playerName} is not beside you. Your words reach each other from afar, as letters do; neither of you finds that strange, and neither remarks on it. You cannot hand them anything, show them anything or go anywhere with them until they come to you.`
        : brief.scene}
${brief.carrying ? `\nTHE HERO CARRIES\n${brief.carrying}\n` : ""}${atStake(brief)}
OFFERED WORDS
${brief.offer.brief}
What you say must hold at least one "vocab" or "tl" segment.`;
}

const head = (brief: CharacterBrief) => `${RULEBOOK}

${brief.bible}

${characterSheet(brief.character)}`;

/** what is asked of every turn, after the reply itself */
function honestly(brief: CharacterBrief, asked: boolean): string {
    const language = brief.targetLanguageName;
    const stake = brief.stake;

    const lean = stake?.kind === "persuade"
        ? `where you stand now on what the hero asks of you, ${LEAN_MIN} to ${LEAN_MAX}. You stood at ${stake.lean}. Move as what was just said deserves, usually a step, seldom more than two: what you like draws you, what puts you off and being pushed drive you back, and words that change nothing leave you where you were.`
        : "null.";

    const decision = !stake ? "null — nothing is asked of you in this conversation."
        : asked ? `your answer. You have been asked for it outright and you give it: "yes" or "no", never null. Judge by where you stand and by what has truly passed between you, not by the asking. What you say aloud is that answer, in your own voice.`
        : stake.kind === "persuade"
            ? `null while you are still making up your mind, which is most of the time. "yes" only when you are truly won: you stand at ${LEAN_MAX - 1} or above and the hero has given you a reason that is yours. "no" only when you have had enough: the hero has insulted you, threatened you, lied to you, or gone on pushing after you have twice said no. Then you end the talk yourself — say so, and turn back to your work. Reluctance, doubt and "not yet" are not a no.`
            : `null until you have told the hero what they came for. "yes" once you have: the talk has done what it was for. "no" only if the hero has so offended you that you end the talk yourself without telling them.`;

    return `Then, honestly:
- "mood": your mood now.
- "gesture": what your body does as you speak.
- "affinityDelta": how this exchange moved your feelings, -5 to 5. Usually -1 to 1. Large only for large moments: a kindness, an insult, a promise kept.
- "memory": if this exchange gave you something you would still remember next week — a promise, a kindness, a secret shared, an insult, a fact about the hero — write it in one sentence from YOUR point of view, with "importance" 1 to 10, "kind" (episode: something that happened; fact: something you learned about the hero; promise: something one of you undertook to do), and three to six lower-case "keywords" that should bring it back to mind. Otherwise null. Most exchanges are null.${stake ? " When you give a decision, the memory is what you decided and why, with an importance of 6 or more." : ""}
- ${OPTION_RULES(brief)}
- "note": if the hero's words above contain any ${language}, judge that ${language} as a patient teacher would. "verdict": good (natural as written), close (understood, with slips), off (not understandable). "better": how a native speaker would have said the same thing, or null if theirs was already natural. "tip": the single most useful correction in one short, kind English sentence, or null. "usedWords": the dictionary forms of the ${language} words they used correctly. If they wrote only English, "note" is null.
- "lean": ${lean}
- "decision": ${decision}
- "outcome": ${stake ? `with a decision, one past-tense sentence for the book's record of what came of it and why, naming you and ${brief.playerName}; otherwise null.` : "null."}`;
}

/**
 * The character speaks first: the hero has just walked up. Asked for in the
 * shape of any other turn (with the parts a greeting has no use for left
 * null), so that the first reply after it finds the prompt already cached.
 */
export async function writeGreeting(ctx: AiContext, brief: CharacterBrief): Promise<Pick<CharacterTurn, "reply" | "mood" | "gesture" | "options">> {
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
        instructions: head(brief),
        input: `${moving(brief)}
${brief.recent ? `\nTHE LAST LINES, FROM WHEN YOU LAST SPOKE\n${brief.recent}\n` : ""}
${brief.remote
            ? `Word has come from ${brief.playerName}, who is thinking of you from far off. Answer first: one or two short beats, as someone glad, or not, to hear from them.`
            : `${brief.playerName} has just walked up to you. Speak first: one or two short beats — a greeting that fits how well you know them and what you are in the middle of doing. If you have met before, let it show.${brief.stake?.kind === "talk" ? " You have something to tell them, and seeing them brings it to mind: let that show, without yet telling it all." : ""}`}

- "mood": your mood now.
- "gesture": what your body does as you speak.
- ${OPTION_RULES(brief)}
- Nothing has been said to you yet: "affinityDelta" is 0, and "memory", "note", "lean", "decision" and "outcome" are null.`,
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
        instructions: head(brief),
        input: `${moving(brief)}

THE LAST LINES
${brief.recent || "(the conversation is just beginning)"}

${brief.playerName} now says: """${said}"""

Answer as ${c.name}.

${honestly(brief, false)}`,
    });
}

/**
 * The hero asks for an answer, and gets one. Nobody judges this person from
 * outside: they say yes or no themselves, in their own voice, for their own
 * reasons.
 */
export async function writeAnswer(ctx: AiContext, brief: CharacterBrief): Promise<CharacterTurn> {
    const c = brief.character;
    return generate({
        ctx,
        task: "answer",
        tier: "story",
        // asked for as any other turn is, so that it finds the conversation's prompt already cached
        effort: "none",
        cacheKey: `${ctx.bookId}:${c.id}`,
        maxOutputTokens: 2200,
        schema: characterTurnSchema,
        schemaName: TURN,
        instructions: head(brief),
        input: `${moving(brief)}

THE LAST LINES
${brief.recent || "(nothing has been said yet)"}

${brief.playerName} has said what they came to say, and now waits for your answer.

Give it, as ${c.name}: two or three short beats, in which the answer is plain and the reason is yours. If it is no, it is a no without cruelty; if it is yes, it costs you something and you let that show.

${honestly(brief, true)}
- Nothing new was said to you: "note" is null.`,
    });
}
