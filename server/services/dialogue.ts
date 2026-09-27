import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
    books, characters, conversations, messages, quests, regions, relationships,
    type Book, type Character, type Conversation, type Message, type Relationship,
} from "@/db/schema";
import { languageOf } from "@/game/languages";
import type { DialogueOption, DialogueState, DialogueTurnResult, LanguageNote, MessageView, QuestUpdate } from "@/game/payloads";
import { plannedIdsIn, segmentsToPlainText, type Segment } from "@/game/segments";
import { withinInteractRange } from "@/game/worldgen/layout";
import type { AiContext } from "../ai/client";
import { writeGreeting, writeReply, type CharacterBrief } from "../ai/prompts/character";
import { bibleOf } from "../ai/prompts/rulebook";
import { summarizeConversation } from "../ai/prompts/scribe";
import { offerWords, resolveSegments, toDialogueOptions } from "../ai/segments";
import { cardsForSegments, lookupForm, tokenize } from "./dictionary";
import { chronicle, dueForDirection, runDirector } from "./director";
import { addXp, getImmersion, planWords, recordExposure, recordProduction } from "./learning";
import { consolidate, memoriesBrief, recall, remember } from "./memory";
import { later } from "./later";
import { langOf, questBeat } from "./narration";
import { applyProgress, failObjective, isChapterTurnReady, liveObjectives } from "./quests";
import { sceneBrief, worldKeys } from "./scene";
import { getWallet } from "./wallet";

/** the lines a prompt carries word for word; everything older lives in the summary */
const RECENT_LINES = 8;
/** the summary is refreshed when this many lines have piled up beyond it */
const SUMMARISE_EVERY = 10;
/** after this long apart, a character greets the hero afresh */
const GREET_AFTER_MS = 20 * 60_000;
const MAX_SAID = 500;
const XP_PER_TARGET_LINE = 8;

type Speaker = Character & { relationship: Relationship | null };

async function findCharacter(book: Book, characterId: string): Promise<Speaker> {
    const character = await db.query.characters.findFirst({
        where: eq(characters.id, characterId),
        with: { relationship: true },
    });
    if (!character || character.bookId !== book.id || character.status !== "alive") throw new Error("They are not here.");
    return character;
}

async function conversationWith(bookId: string, characterId: string): Promise<Conversation> {
    const existing = await db.query.conversations.findFirst({
        where: and(eq(conversations.bookId, bookId), eq(conversations.characterId, characterId)),
    });
    if (existing) return existing;
    const [created] = await db.insert(conversations).values({ bookId, characterId }).onConflictDoNothing().returning();
    if (created) return created;
    // lost a race: the row exists now
    const raced = await db.query.conversations.findFirst({
        where: and(eq(conversations.bookId, bookId), eq(conversations.characterId, characterId)),
    });
    if (!raced) throw new Error("The conversation could not begin.");
    return raced;
}

const toView = (m: Message): MessageView => ({ id: m.id, speaker: m.speaker, segments: m.segments, note: m.note ?? null });

/**
 * How many of the latest lines a prompt carries word for word: every line the
 * summary does not cover yet. Carrying only the last few would leave a gap
 * between them and the summary — the lines waiting to be folded in — and the
 * character would forget the middle of the conversation they are having.
 */
function linesToCarry(conversation: Pick<Conversation, "messageCount" | "summarizedCount">): number {
    const unsummarised = conversation.messageCount - conversation.summarizedCount;
    return Math.max(RECENT_LINES, Math.min(RECENT_LINES + SUMMARISE_EVERY + 2, unsummarised));
}

/** what the hero may win this person over to, now: persuasions whose turn in their quest has come */
async function openObjectives(book: Book, characterId: string) {
    const open = await db.query.quests.findMany({
        where: and(eq(quests.bookId, book.id), eq(quests.status, "active")),
        orderBy: [asc(quests.sortIndex)],
        with: { objectives: true },
    });
    const due = open.flatMap((quest) => liveObjectives(quest.objectives))
        .filter((objective) => objective.kind === "persuade" && objective.targetCharacterId === characterId);
    return new Map(due.map((objective, i) => [`o${i + 1}`, objective]));
}

/** everything a character is told before they speak, gathered from rows */
async function briefFor(
    book: Book, character: Speaker, conversation: Conversation, cue: string, recentLines: Message[],
): Promise<{ brief: CharacterBrief; objectives: Awaited<ReturnType<typeof openObjectives>> }> {
    const lang = langOf(book);
    const region = character.regionId
        ? await db.query.regions.findFirst({ where: eq(regions.id, character.regionId) })
        : undefined;

    const [keys, immersion, remembered, planned, scene, objectives] = await Promise.all([
        worldKeys(book),
        getImmersion(book.userId, lang),
        recall(character, `${cue} ${region?.name ?? ""}`),
        planWords(book.userId, lang, { introduce: 2, review: 4, scene: 1, sceneKeys: region?.themeWords ?? [], embed: true }),
        sceneBrief(book),
        openObjectives(book, character.id),
    ]);

    return {
        objectives,
        brief: {
            bible: bibleOf(book, [...keys.places.values()], keys.cast),
            character,
            playerName: book.playerName,
            targetLanguageName: languageOf(lang).name,
            immersion,
            affinity: character.relationship?.affinity ?? 0,
            relationship: character.relationship?.summary ?? "",
            memories: memoriesBrief(remembered),
            summary: conversation.summary,
            recent: recentLines
                .map((m) => `${m.speaker === "player" ? book.playerName : character.name}: ${segmentsToPlainText(m.segments)}`)
                .join("\n"),
            scene,
            objectives: [...objectives].map(([key, o]) => `- ${key}: ${o.description}`).join("\n"),
            offer: offerWords(planned),
        },
    };
}

/* ------------------------------------------------------------------ */
/* opening a conversation                                              */
/* ------------------------------------------------------------------ */

export async function openDialogue(ctx: AiContext, book: Book, characterId: string): Promise<DialogueState> {
    const character = await findCharacter(book, characterId);
    if (character.regionId !== book.currentRegionId || !withinInteractRange({ x: book.x, z: book.z }, character, 6)) {
        throw new Error("Walk over to them first.");
    }
    const lang = langOf(book);
    let conversation = await conversationWith(book.id, characterId);

    const history = (await db.query.messages.findMany({
        where: eq(messages.conversationId, conversation.id),
        orderBy: [desc(messages.createdAt)],
        limit: 30,
    })).reverse();

    // they speak first when meeting, and again after a good while apart
    const apart = Date.now() - conversation.lastMessageAt.getTime();
    const greets = history.length === 0 || apart > GREET_AFTER_MS || conversation.options.length === 0;
    let greeted = false;
    if (greets) {
        const { brief } = await briefFor(book, character, conversation, character.name, history.slice(-linesToCarry(conversation)));
        const greeting = await writeGreeting(ctx, { ...brief, recent: brief.recent });
        const segments = await resolveSegments(lang, greeting.reply, brief.offer);
        const options = await toDialogueOptions(lang, greeting.options);
        const [row] = await db.insert(messages).values({ conversationId: conversation.id, speaker: "character", segments }).returning();
        [conversation] = await db.update(conversations).set({
            messageCount: conversation.messageCount + 1, lastMessageAt: new Date(), options,
        }).where(eq(conversations.id, conversation.id)).returning();
        await db.update(characters).set({ mood: greeting.mood.slice(0, 40) }).where(eq(characters.id, character.id));
        await recordExposure(book.userId, lang, plannedIdsIn(segments));
        history.push(row);
        character.mood = greeting.mood;
        greeted = true;
    }

    return {
        conversationId: conversation.id,
        character: {
            id: character.id, name: character.name, role: character.role, mood: character.mood,
            affinity: character.relationship?.affinity ?? 0, voiceId: character.voiceId,
        },
        messages: history.map(toView),
        options: conversation.options,
        words: await cardsForSegments([...history.map((m) => m.segments), ...conversation.options.map((o) => o.segments)]),
        greeted,
    };
}

/* ------------------------------------------------------------------ */
/* a turn                                                              */
/* ------------------------------------------------------------------ */

/**
 * What the hero said, as stored. Picking an offered reply stores that reply's
 * own segments (so a target-language option stays tappable); typing stores
 * plain text — unless it is written in the target language, in which case it
 * is linked to the dictionary like anything else in that language.
 */
async function heroLine(book: Book, conversation: Conversation, said: { text?: string; optionKey?: string }): Promise<{
    segments: Segment[]; plain: string; option: DialogueOption | null;
}> {
    if (said.optionKey) {
        const option = conversation.options.find((o) => o.key === said.optionKey);
        if (!option) throw new Error("That reply is no longer on offer.");
        return { segments: option.segments, plain: segmentsToPlainText(option.segments), option };
    }
    const plain = (said.text ?? "").trim().slice(0, MAX_SAID);
    if (plain.length === 0) throw new Error("Say something first.");
    return { segments: [{ t: "text", v: plain }], plain, option: null };
}

export async function say(
    ctx: AiContext, book: Book, characterId: string, said: { text?: string; optionKey?: string },
): Promise<DialogueTurnResult> {
    // closeness was checked when the conversation opened; drifting a step mid-sentence is fine
    const character = await findCharacter(book, characterId);
    if (character.regionId !== book.currentRegionId) throw new Error("They are not here.");
    const lang = langOf(book);
    const conversation = await conversationWith(book.id, characterId);
    const line = await heroLine(book, conversation, said);

    const before = (await db.query.messages.findMany({
        where: eq(messages.conversationId, conversation.id),
        orderBy: [desc(messages.createdAt)],
        limit: linesToCarry(conversation),
    })).reverse();

    const { brief, objectives } = await briefFor(book, character, conversation, line.plain, before);
    const turn = await writeReply(ctx, brief, line.plain);

    /* what was said */
    const replySegments = await resolveSegments(lang, turn.reply, brief.offer);
    const options = await toDialogueOptions(lang, turn.options);

    // choosing a target-language reply is practice too, and is judged kindly: the words were offered
    const note: LanguageNote | null = turn.note
        ? { verdict: turn.note.verdict, better: turn.note.better?.trim() || null, tip: turn.note.tip?.trim() || null }
        : null;
    let heroSegments = line.segments;
    if (!line.option && note && note.verdict !== "off") {
        heroSegments = [{ t: "tl", v: line.plain, tr: "", tk: await tokenize(lang, line.plain) }];
    }

    const [heroRow] = await db.insert(messages).values({
        conversationId: conversation.id, speaker: "player", segments: heroSegments, note,
    }).returning();
    const [replyRow] = await db.insert(messages).values({
        conversationId: conversation.id, speaker: "character", segments: replySegments,
        // a moment later, so the two never tie when sorted by time
        createdAt: new Date(heroRow.createdAt.getTime() + 1),
    }).returning();

    /* what it changed */
    const affinity = Math.max(-100, Math.min(100, (character.relationship?.affinity ?? 0) + turn.affinityDelta));
    await Promise.all([
        db.update(conversations).set({
            messageCount: conversation.messageCount + 2, lastMessageAt: new Date(), options,
        }).where(eq(conversations.id, conversation.id)),
        db.update(characters).set({ mood: turn.mood.trim().slice(0, 40) }).where(eq(characters.id, character.id)),
        db.insert(relationships).values({ characterId: character.id, affinity })
            .onConflictDoUpdate({ target: relationships.characterId, set: { affinity } }),
        turn.memory ? remember(book.id, character.id, turn.memory) : Promise.resolve(),
        recordExposure(book.userId, lang, plannedIdsIn(replySegments)),
    ]);

    /* what the hero earned by speaking the language */
    let xp = 0;
    let learned = 0;
    const spokeTarget = (line.option?.inTarget ?? false) || (note !== null && note.verdict !== "off");
    if (spokeTarget) {
        const used = line.option
            ? line.option.segments.flatMap((s) => (s.t === "tl" ? s.tk.flatMap((t) => (t.id !== undefined ? [t.id] : [])) : []))
            : (await Promise.all((turn.note?.usedWords ?? []).slice(0, 8).map((word) => lookupForm(lang, word))))
                .flatMap((entry) => (entry ? [entry.id] : []));
        // typing it yourself is production; picking it from a list is recognition
        if (line.option) await recordExposure(book.userId, lang, used);
        else learned = (await recordProduction(book.userId, lang, used)).firstTimeLearned.length;
        xp = XP_PER_TARGET_LINE * (line.option ? 1 : note?.verdict === "good" ? 3 : 2);
        await Promise.all([
            addXp(book.userId, lang, xp),
            db.update(books).set({ xp: sql`${books.xp} + ${xp}` }).where(eq(books.id, book.id)),
        ]);
    }

    /* what it means for the story */
    const questUpdates: QuestUpdate[] = await applyProgress(book, { kind: "talkTo", characterId: character.id });
    // a word used rightly in talk is a word learned, as much as one won in battle
    if (learned > 0) questUpdates.push(...await applyProgress(book, { kind: "learnWords", count: learned }));
    let how = `${book.playerName} spoke with ${character.name}.`;
    if (turn.objectiveAchieved && objectives.has(turn.objectiveAchieved)) {
        const won = objectives.get(turn.objectiveAchieved)!;
        questUpdates.push(...await applyProgress(book, { kind: "persuade", characterId: character.id, objectiveId: won.id }));
        how = `${book.playerName} won ${character.name} over: ${won.description}`;
        await chronicle(book, { kind: "persuasion", summary: how, importance: 6, regionId: character.regionId, characterId: character.id });
    } else if (turn.objectiveFailed && objectives.has(turn.objectiveFailed)) {
        const lost = objectives.get(turn.objectiveFailed)!;
        questUpdates.push(...await failObjective(book, lost.id));
        how = `${character.name} refused ${book.playerName} once and for all: ${lost.description}`;
    } else if (turn.memory && turn.memory.importance >= 7) {
        // something weighty passed between them even though no quest turned on it
        await chronicle(book, {
            kind: "conversation", importance: turn.memory.importance - 1,
            summary: `Between ${book.playerName} and ${character.name}: ${turn.memory.content}`,
            regionId: character.regionId, characterId: character.id,
        });
    }

    let beat = null;
    const resolved = questUpdates.find((u) => u.questCompleted || u.failed);
    if (resolved && character.regionId) {
        const region = await db.query.regions.findFirst({ where: eq(regions.id, character.regionId) });
        if (region) {
            const { written, fresh } = await questBeat(ctx, book, region, resolved, how, character.id);
            beat = written?.passage ?? null;
            questUpdates.push(...fresh);
        }
    }

    /* housekeeping, after the player has their answer */
    later("dialogue housekeeping", async () => {
        await summariseIfDue(ctx, book, character, conversation.id);
        await consolidate(ctx, character, book.playerName);
        if (!resolved && await dueForDirection(book.id)) await runDirector(ctx, book.id);
    });

    const [words, chapterTurnReady, wallet] = await Promise.all([
        cardsForSegments([replySegments, heroSegments, ...options.map((o) => o.segments), ...(beat ? [beat.segments] : [])]),
        isChapterTurnReady(book),
        getWallet(book.userId),
    ]);
    return {
        playerMessage: toView(heroRow),
        reply: toView(replyRow),
        options,
        mood: turn.mood,
        affinity,
        affinityDelta: turn.affinityDelta,
        words,
        questUpdates,
        beat,
        xp,
        chapterTurnReady,
        wallet,
    };
}

/** fold the lines that have scrolled out of the recent window into the running summary */
async function summariseIfDue(ctx: AiContext, book: Book, character: Character, conversationId: string): Promise<void> {
    const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
    if (!conversation) return;
    const unsummarised = conversation.messageCount - conversation.summarizedCount;
    if (unsummarised < RECENT_LINES + SUMMARISE_EVERY) return;

    const all = await db.query.messages.findMany({
        where: eq(messages.conversationId, conversationId),
        orderBy: [asc(messages.createdAt)],
    });
    // everything except the lines the next prompt will still carry word for word
    const fold = all.slice(conversation.summarizedCount, all.length - RECENT_LINES);
    if (fold.length === 0) return;

    const summary = await summarizeConversation(ctx, {
        characterName: character.name,
        playerName: book.playerName,
        summary: conversation.summary,
        lines: fold.map((m) => `${m.speaker === "player" ? book.playerName : character.name}: ${segmentsToPlainText(m.segments)}`).join("\n"),
    });
    await db.update(conversations)
        .set({ summary, summarizedCount: conversation.summarizedCount + fold.length })
        // only if nobody summarised in the meantime
        .where(and(eq(conversations.id, conversationId), eq(conversations.summarizedCount, conversation.summarizedCount)));
}

