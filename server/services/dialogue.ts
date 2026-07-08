import "server-only";
import { db } from "@/db";
import {
    characterMemories, characters, conversations, events, messages,
    questObjectives, quests, relationships, type Story,
} from "@/db/schema";
import type { DialogueState, DialogueTurnResult, QuestUpdate } from "@/game/payloads";
import { withinInteractRange } from "@/game/geometry";
import { segmentsToPlainText } from "@/game/segments";
import { and, desc, eq } from "drizzle-orm";
import { generateCharacterReply } from "../ai/character";
import { offerWords, resolveSegments } from "../ai/segments";
import { buildVocabPlan, getImmersionLevel, planCountsFor, recordExposure } from "./learning";
import { chargeForAi } from "./billing";
import { sceneBrief, wordEntriesFor } from "./scene";
import { applyProgress, isChapterTurnReady } from "./quests";

const RECENT_MESSAGES = 12;
const MEMORY_BUDGET = 8;

async function requireCharacter(story: Story, characterId: string) {
    const character = await db.query.characters.findFirst({
        where: eq(characters.id, characterId),
        with: { relationship: true },
    });
    if (!character || character.storyId !== story.id || character.status !== "alive") {
        throw new Error("They are not here.");
    }
    return character;
}

async function requireNearbyCharacter(story: Story, characterId: string) {
    const character = await requireCharacter(story, characterId);
    if (character.mapId !== story.currentMapId || !withinInteractRange({ x: story.x, y: story.y }, character)) {
        throw new Error("Walk over to them first.");
    }
    return character;
}

async function getOrCreateConversation(storyId: string, characterId: string) {
    const existing = await db.query.conversations.findFirst({
        where: and(eq(conversations.storyId, storyId), eq(conversations.characterId, characterId)),
    });
    if (existing) return existing;
    const [created] = await db.insert(conversations)
        .values({ storyId, characterId })
        .onConflictDoNothing()
        .returning();
    if (created) return created;
    const raced = await db.query.conversations.findFirst({
        where: and(eq(conversations.storyId, storyId), eq(conversations.characterId, characterId)),
    });
    if (!raced) throw new Error("conversation unavailable");
    return raced;
}

/** open (or resume) a conversation — the character remembers everything */
export async function openDialogue(story: Story, characterId: string): Promise<DialogueState> {
    const character = await requireNearbyCharacter(story, characterId);
    const conversation = await getOrCreateConversation(story.id, characterId);

    const history = await db.query.messages.findMany({
        where: eq(messages.conversationId, conversation.id),
        orderBy: [desc(messages.createdAt)],
        limit: 30,
    });
    const ordered = history.reverse();

    return {
        conversationId: conversation.id,
        character: {
            id: character.id, name: character.name, role: character.role,
            mood: character.mood, spriteKey: character.spriteKey,
            x: character.x, y: character.y,
            affinity: character.relationship?.affinity ?? 0,
        },
        voiceId: character.voiceId,
        messages: ordered.map((m) => ({ id: m.id, speaker: m.speaker, segments: m.segments })),
        words: await wordEntriesFor(ordered.map((m) => m.segments)),
    };
}

/** one player turn: persist → brief the character AI → persist its structured delta */
export async function sendDialogue(
    userId: string,
    story: Story,
    characterId: string,
    text: string,
): Promise<DialogueTurnResult> {
    const playerText = text.trim().slice(0, 600);
    if (playerText.length === 0) throw new Error("Say something first.");
    await chargeForAi(userId, "dialogue");

    // proximity was checked when the conversation opened; walking mid-sentence is fine
    const character = await requireCharacter(story, characterId);
    const conversation = await getOrCreateConversation(story.id, characterId);

    await db.insert(messages).values({
        conversationId: conversation.id,
        speaker: "player",
        segments: [{ t: "text", v: playerText }],
    });

    // --- build the brief entirely from the database ---
    const [memories, recent, openObjectives] = await Promise.all([
        db.query.characterMemories.findMany({
            where: eq(characterMemories.characterId, character.id),
            orderBy: [desc(characterMemories.importance), desc(characterMemories.createdAt)],
            limit: MEMORY_BUDGET,
        }),
        db.query.messages.findMany({
            where: eq(messages.conversationId, conversation.id),
            orderBy: [desc(messages.createdAt)],
            limit: RECENT_MESSAGES,
        }),
        db.select({ objective: questObjectives, questTitle: quests.title })
            .from(questObjectives)
            .innerJoin(quests, eq(questObjectives.questId, quests.id))
            .where(and(
                eq(quests.storyId, story.id),
                eq(quests.status, "active"),
                eq(questObjectives.status, "active"),
                eq(questObjectives.kind, "persuade"),
                eq(questObjectives.targetCharacterId, character.id),
            )),
    ]);

    const objectiveKeys = new Map(openObjectives.map(({ objective }, i) => [`o${i + 1}`, objective]));
    const objectivesBrief = [...objectiveKeys.entries()]
        .map(([key, o]) => `- ${key}: ${o.description}`)
        .join("\n");

    const immersionLevel = await getImmersionLevel(userId, story.id);
    const plan = await buildVocabPlan(userId, story, planCountsFor(immersionLevel, "dialogue"));
    const offer = offerWords(plan);

    const reply = await generateCharacterReply({
        immersionLevel,
        story,
        character,
        relationship: character.relationship ?? null,
        memoriesBrief: memories.length > 0
            ? memories.map((m) => `- ${m.content}`).join("\n")
            : "(you have never spoken with the hero before)",
        conversationSummary: conversation.summary,
        recentMessages: recent.reverse()
            .map((m) => `${m.speaker === "player" ? story.playerName : character.name}: ${segmentsToPlainText(m.segments)}`)
            .join("\n"),
        sceneBrief: await sceneBrief(story),
        objectivesBrief,
        offer,
        playerMessage: playerText,
    });

    // --- persist the structured consequences ---
    const segments = resolveSegments(reply.reply, offer);
    const [replyRow] = await db.insert(messages).values({
        conversationId: conversation.id,
        speaker: "character",
        segments,
    }).returning();

    const newAffinity = Math.max(-100, Math.min(100,
        (character.relationship?.affinity ?? 0) + reply.affinityDelta));

    await Promise.all([
        db.update(conversations).set({
            messageCount: conversation.messageCount + 2,
            lastMessageAt: new Date(),
        }).where(eq(conversations.id, conversation.id)),
        db.update(characters).set({ mood: reply.mood }).where(eq(characters.id, character.id)),
        db.insert(relationships).values({ characterId: character.id, affinity: newAffinity })
            .onConflictDoUpdate({ target: relationships.characterId, set: { affinity: newAffinity } }),
        reply.memory ? db.insert(characterMemories).values({
            characterId: character.id,
            kind: "conversation",
            content: reply.memory.content,
            importance: reply.memory.importance,
        }) : Promise.resolve(),
        recordExposure(userId, segments.flatMap((s) => (s.t === "vocab" ? [s.wordId] : []))),
    ]);

    // quest progress: first contact + any persuade objective the AI judged achieved
    const questUpdates: QuestUpdate[] = await applyProgress(story, {
        kind: "talkTo",
        targetCharacterId: character.id,
    });
    if (reply.objectiveAchieved && objectiveKeys.has(reply.objectiveAchieved)) {
        const achieved = objectiveKeys.get(reply.objectiveAchieved)!;
        questUpdates.push(...await applyProgress(story, {
            kind: "persuade",
            targetCharacterId: character.id,
            objectiveId: achieved.id,
        }));
        await db.insert(events).values({
            storyId: story.id,
            kind: "persuasion",
            summary: `${story.playerName} won ${character.name} over: ${achieved.description}`,
            characterId: character.id,
            mapId: story.currentMapId,
        });
    }

    return {
        reply: { id: replyRow.id, speaker: "character", segments },
        mood: reply.mood,
        affinity: newAffinity,
        words: await wordEntriesFor([segments]),
        questUpdates,
        chapterTurnReady: await isChapterTurnReady(story),
    };
}
