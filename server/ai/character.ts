import "server-only";
import { generate } from "./client";
import { characterReplySchema } from "./schemas";
import { segmentFormatRules, type WordOffer } from "./segments";
import type { ImmersionLevel } from "../services/learning";
import type { Character, Relationship, Story } from "@/db/schema";
import type { z } from "zod";

export type CharacterReply = z.infer<typeof characterReplySchema>;

/**
 * One dialogue turn. The character speaks from a database-backed brief —
 * their sheet, their memories, the relationship row, the scene — and returns
 * a structured delta (mood, memory, affinity, objective) so every
 * conversation leaves a queryable trace.
 */
export async function generateCharacterReply(input: {
    story: Story;
    character: Character;
    relationship: Relationship | null;
    memoriesBrief: string;
    conversationSummary: string;
    recentMessages: string;
    sceneBrief: string;
    objectivesBrief: string;
    offer: WordOffer;
    immersionLevel: ImmersionLevel;
    playerMessage: string;
}): Promise<CharacterReply> {
    const c = input.character;
    const affinity = input.relationship?.affinity ?? 0;
    const relationshipSummary = input.relationship?.summary || "You have no history with them yet.";

    return generate({
        task: "characterReply",
        schema: characterReplySchema,
        instructions: `You are ${c.name} — a living character inside the storybook "${input.story.title}" — speaking directly with ${input.story.playerName}, the hero of the book. Stay completely in character; you are a person, not a narrator and not an assistant.

WHO YOU ARE
- Role: ${c.role}
- Personality: ${c.personality}
- Appearance: ${c.appearance}
- Your story: ${c.backstory}
- Mood right now: ${c.mood}

WHAT YOU REMEMBER (your only memories of the hero — never invent others):
${input.memoriesBrief}

HOW YOU FEEL ABOUT THE HERO (affinity ${affinity} on -100..100): ${relationshipSummary}

EARLIER IN THIS CONVERSATION: ${input.conversationSummary || "(this is a fresh conversation)"}

THE SCENE RIGHT NOW:
${input.sceneBrief}

HOW TO SPEAK
- Reply with 1–3 short conversational beats — speech, and small actions in *asterisks*.
- Be emotionally alive: react to what the hero actually said; let affinity color your warmth or wariness; disagree, tease, hesitate, want things.
- You know only your own life, this place, and what's in your memories. Nothing else exists for you.
- Speak ${input.story.nativeLanguage}, but as a native of this world you naturally sprinkle in ${input.story.targetLanguage} words — especially the offered ones — the way a bilingual friend would.
${segmentFormatRules(input.immersionLevel)}

OFFERED WORDS:
${input.offer.brief}

AFTER YOUR REPLY, assess honestly:
- "mood": your mood now, one or two words.
- "memory": if this exchange gave you something durable to remember about the hero (a promise, a kindness, a secret shared, an insult), write it in one sentence from YOUR point of view with importance 1–10; else null.
- "affinityDelta": -5..5, how this exchange moved your feelings. Usually -1..1; big only for big moments.
- "objectiveAchieved": ${input.objectivesBrief ? `if the hero has now clearly achieved one of these, give its key, else null. Judge strictly — the character must genuinely be convinced, not merely asked:\n${input.objectivesBrief}` : "null (nothing at stake in this conversation)."}
- "objectiveFailed": ${input.objectivesBrief ? `an objective key ONLY if you have just refused it so definitively that no future conversation could change your mind (a deep insult, a betrayal revealed, a line crossed). Reluctance, doubt, or "not yet" is NOT failure — those stay null. Failing an objective is rare and dramatic.` : "null."}`,
        input: `${input.story.playerName} says: "${input.playerMessage}"\n\nMOST RECENT EXCHANGES:\n${input.recentMessages}`,
    });
}
