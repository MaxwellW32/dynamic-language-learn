import "server-only";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
    books, characters, conversations, goals, messages, regions, relationships,
    type Book, type Character, type Conversation, type Goal, type Message, type Relationship,
} from "@/db/schema";
import { answerFromLean, clampLean, decisionStands } from "@/game/goals";
import { languageOf } from "@/game/languages";
import type {
    DialogueOption, DialogueState, DialogueTurnResult, GoalSettled, LanguageNote, MessageView, Stake,
} from "@/game/payloads";
import { plannedIdsIn, segmentsToPlainText, type Segment } from "@/game/segments";
import { withinInteractRange } from "@/game/worldgen/layout";
import type { AiContext } from "../ai/client";
import { writeAnswer, writeGreeting, writeReply, type CharacterBrief, type StakeBrief } from "../ai/prompts/character";
import { bibleOf } from "../ai/prompts/rulebook";
import { summarizeConversation } from "../ai/prompts/scribe";
import type { CharacterTurn } from "../ai/schemas";
import { offerWords, resolveSegments, toDialogueOptions } from "../ai/segments";
import { chronicle } from "./chronicle";
import { cardsForSegments, lookupForm, tokenize } from "./dictionary";
import { settle, stakeWith, storyState } from "./goals";
import { addXp, getImmersion, planWords, recordExposure, recordProduction } from "./learning";
import { consolidate, memoriesBrief, recall, remember } from "./memory";
import { later } from "./later";
import { langOf } from "./narration";
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
/** what is set down as the hero's line when they ask for an answer */
const ASKING = "*waits for an answer*";

type Speaker = Character & { relationship: Relationship | null };

/** how the hero has come to be talking to someone: standing beside them, or from afar */
export type Reach = { remote: boolean };

async function findCharacter(book: Book, characterId: string): Promise<Speaker> {
    const character = await db.query.characters.findFirst({
        where: eq(characters.id, characterId),
        with: { relationship: true },
    });
    if (!character || character.bookId !== book.id || !character.onstage) throw new Error("They are not here.");
    if (character.status !== "alive") throw new Error(`${character.name} has left the story.`);
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

/* ------------------------------------------------------------------ */
/* what is at stake                                                    */
/* ------------------------------------------------------------------ */

type AtStake = { goal: Goal; heroLines: number; linesSince: number };

/**
 * The goal in hand, if it is this person's to settle and the hero is standing
 * in front of them: nothing is ever settled from afar.
 */
async function atStake(book: Book, characterId: string, conversationId: string, reach: Reach): Promise<AtStake | null> {
    if (reach.remote) return null;
    const goal = await stakeWith(book.id, characterId);
    if (!goal) return null;
    const since = goal.activatedAt ?? goal.createdAt;
    const said = await db.query.messages.findMany({
        where: and(eq(messages.conversationId, conversationId), gt(messages.createdAt, since)),
        columns: { speaker: true },
    });
    return { goal, heroLines: said.filter((line) => line.speaker === "player").length, linesSince: said.length };
}

const stakeView = (stake: AtStake, lean = stake.goal.lean, heroLines = stake.heroLines): Stake => ({
    goalId: stake.goal.id,
    kind: stake.goal.kind as "talk" | "persuade",
    title: stake.goal.title,
    lean: stake.goal.kind === "persuade" ? lean : null,
    canAsk: heroLines >= 1,
});

const stakeBrief = (stake: AtStake): StakeBrief => ({
    kind: stake.goal.kind as "talk" | "persuade",
    title: stake.goal.title,
    brief: stake.goal.brief,
    lean: stake.goal.lean,
    heroLines: stake.heroLines,
});

/** everything a character is told before they speak, gathered from rows */
async function briefFor(
    book: Book, character: Speaker, conversation: Conversation, cue: string, recentLines: Message[],
    stake: AtStake | null, reach: Reach,
): Promise<CharacterBrief> {
    const lang = langOf(book);
    const region = character.regionId
        ? await db.query.regions.findFirst({ where: eq(regions.id, character.regionId) })
        : undefined;

    const [keys, immersion, remembered, planned, scene] = await Promise.all([
        worldKeys(book),
        getImmersion(book.userId, lang),
        recall(character, `${cue} ${region?.name ?? ""} ${stake?.goal.title ?? ""}`),
        planWords(book.userId, lang, { introduce: 2, review: 4, scene: 1, sceneKeys: region?.themeWords ?? [], embed: true }),
        sceneBrief(book),
    ]);

    return {
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
        carrying: book.belongings.join("; "),
        stake: stake ? stakeBrief(stake) : null,
        remote: reach.remote,
        offer: offerWords(planned),
    };
}

/* ------------------------------------------------------------------ */
/* opening a conversation                                              */
/* ------------------------------------------------------------------ */

/**
 * Begin talking to someone. Standing beside them, anything can be said and a
 * goal can be settled; from afar (`remote`), only someone already met can be
 * written to, and nothing is at stake.
 */
export async function openDialogue(ctx: AiContext, book: Book, characterId: string, reach: Reach = { remote: false }): Promise<DialogueState> {
    const character = await findCharacter(book, characterId);
    let conversation = await conversationWith(book.id, characterId);
    if (reach.remote) {
        if (conversation.messageCount === 0) throw new Error("You have not met them yet.");
    } else if (character.regionId !== book.currentRegionId || !withinInteractRange({ x: book.x, z: book.z }, character, 6)) {
        throw new Error("Walk over to them first.");
    }
    const lang = langOf(book);
    const stake = await atStake(book, characterId, conversation.id, reach);

    const history = (await db.query.messages.findMany({
        where: eq(messages.conversationId, conversation.id),
        orderBy: [desc(messages.createdAt)],
        limit: 30,
    })).reverse();

    // they speak first when meeting, after a good while apart, and when the hero has come about something new
    const apart = Date.now() - conversation.lastMessageAt.getTime();
    const greets = history.length === 0 || apart > GREET_AFTER_MS || conversation.options.length === 0
        || (stake !== null && stake.linesSince === 0);
    let greeted = false;
    if (greets) {
        const brief = await briefFor(book, character, conversation, character.name, history.slice(-linesToCarry(conversation)), stake, reach);
        const greeting = await writeGreeting(ctx, brief);
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
            likes: character.likes, dislikes: character.dislikes,
        },
        messages: history.map(toView),
        options: conversation.options,
        words: await cardsForSegments([...history.map((m) => m.segments), ...conversation.options.map((o) => o.segments)]),
        greeted,
        stake: stake ? stakeView(stake) : null,
        remote: reach.remote,
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
async function heroLine(conversation: Conversation, said: { text?: string; optionKey?: string }): Promise<{
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

/** whoever is spoken to must be within reach: beside the hero, or already met */
async function within(book: Book, character: Speaker, conversation: Conversation, reach: Reach): Promise<void> {
    if (reach.remote) {
        if (conversation.messageCount === 0) throw new Error("You have not met them yet.");
    } else if (character.regionId !== book.currentRegionId) {
        // closeness was checked when the conversation opened; drifting a step mid-sentence is fine
        throw new Error("They are not here.");
    }
}

/**
 * What a turn changed: the lines themselves, how the character feels, what
 * they will remember — and, if something was at stake, where they now stand
 * on it and whether they have given their answer.
 */
async function conclude(
    ctx: AiContext, book: Book, character: Speaker, conversation: Conversation,
    turn: CharacterTurn, brief: CharacterBrief, stake: AtStake | null,
    hero: { segments: Segment[]; note: LanguageNote | null; heroLines: number; asked: boolean },
): Promise<Omit<DialogueTurnResult, "xp">> {
    const lang = langOf(book);
    const replySegments = await resolveSegments(lang, turn.reply, brief.offer);
    const options = await toDialogueOptions(lang, turn.options);

    const [heroRow] = await db.insert(messages).values({
        conversationId: conversation.id, speaker: "player", segments: hero.segments, note: hero.note,
    }).returning();
    const [replyRow] = await db.insert(messages).values({
        conversationId: conversation.id, speaker: "character", segments: replySegments,
        // a moment later, so the two never tie when sorted by time
        createdAt: new Date(heroRow.createdAt.getTime() + 1),
    }).returning();

    /* where they stand, and whether they have answered */
    let settled: GoalSettled | null = null;
    let lean = stake?.goal.lean ?? 0;
    if (stake) {
        const kind = stake.goal.kind as "talk" | "persuade";
        if (kind === "persuade" && turn.lean !== null) {
            lean = clampLean(turn.lean);
            await db.update(goals).set({ lean }).where(eq(goals.id, stake.goal.id));
        }
        const decision = hero.asked ? turn.decision ?? answerFromLean(kind, lean) : turn.decision;
        if (decisionStands(kind, decision, hero.heroLines, hero.asked)) {
            const won = decision === "yes";
            const outcome = turn.outcome?.trim()
                || (won
                    ? kind === "persuade" ? `${book.playerName} won ${character.name} over.` : `${book.playerName} spoke with ${character.name}, and learned what they came for.`
                    : kind === "persuade" ? `${character.name} would not be moved by ${book.playerName}.` : `${character.name} ended the talk with ${book.playerName}, and told them nothing.`);
            settled = await settle(book, stake.goal, won ? "done" : "failed", outcome, { characterId: character.id });
            // whatever else they remember of it, they remember how it ended
            if (settled && !turn.memory) {
                await remember(book.id, character.id, { content: outcome, importance: 7, kind: "episode" });
            }
        }
    }

    /* what it changed between them */
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

    // something weighty passed between them even though no goal turned on it
    if (!settled && turn.memory && turn.memory.importance >= 7) {
        await chronicle(book, {
            kind: "conversation", importance: turn.memory.importance - 1,
            summary: `Between ${book.playerName} and ${character.name}: ${turn.memory.content}`,
            regionId: character.regionId, characterId: character.id,
        });
    }

    /* housekeeping, after the player has their answer */
    later("dialogue housekeeping", async () => {
        await summariseIfDue(ctx, book, character, conversation.id);
        await consolidate(ctx, character, book.playerName);
    });

    const fresh = await db.query.books.findFirst({ where: eq(books.id, book.id) }) ?? book;
    const [words, story, wallet] = await Promise.all([
        cardsForSegments([replySegments, hero.segments, ...options.map((o) => o.segments)]),
        storyState(fresh),
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
        stake: stake && !settled ? stakeView(stake, lean, hero.heroLines) : null,
        settled,
        story,
        wallet,
    };
}

export async function say(
    ctx: AiContext, book: Book, characterId: string, said: { text?: string; optionKey?: string },
    reach: Reach = { remote: false },
): Promise<DialogueTurnResult> {
    const character = await findCharacter(book, characterId);
    const lang = langOf(book);
    const conversation = await conversationWith(book.id, characterId);
    await within(book, character, conversation, reach);
    const line = await heroLine(conversation, said);
    const stake = await atStake(book, characterId, conversation.id, reach);

    const before = (await db.query.messages.findMany({
        where: eq(messages.conversationId, conversation.id),
        orderBy: [desc(messages.createdAt)],
        limit: linesToCarry(conversation),
    })).reverse();

    const brief = await briefFor(book, character, conversation, line.plain, before, stake, reach);
    const turn = await writeReply(ctx, brief, line.plain);

    // choosing a target-language reply is practice too, and is judged kindly: the words were offered
    const note: LanguageNote | null = turn.note
        ? { verdict: turn.note.verdict, better: turn.note.better?.trim() || null, tip: turn.note.tip?.trim() || null }
        : null;
    let heroSegments = line.segments;
    if (!line.option && note && note.verdict !== "off") {
        heroSegments = [{ t: "tl", v: line.plain, tr: "", tk: await tokenize(lang, line.plain) }];
    }

    const result = await conclude(ctx, book, character, conversation, turn, brief, stake, {
        segments: heroSegments, note, heroLines: (stake?.heroLines ?? 0) + 1, asked: false,
    });

    /* what the hero earned by speaking the language */
    let xp = 0;
    const spokeTarget = (line.option?.inTarget ?? false) || (note !== null && note.verdict !== "off");
    if (spokeTarget) {
        const used = line.option
            ? line.option.segments.flatMap((s) => (s.t === "tl" ? s.tk.flatMap((t) => (t.id !== undefined ? [t.id] : [])) : []))
            : (await Promise.all((turn.note?.usedWords ?? []).slice(0, 8).map((word) => lookupForm(lang, word))))
                .flatMap((entry) => (entry ? [entry.id] : []));
        // typing it yourself is production; picking it from a list is recognition
        if (line.option) await recordExposure(book.userId, lang, used);
        else await recordProduction(book.userId, lang, used);
        xp = XP_PER_TARGET_LINE * (line.option ? 1 : note?.verdict === "good" ? 3 : 2);
        await Promise.all([
            addXp(book.userId, lang, xp),
            db.update(books).set({ xp: sql`${books.xp} + ${xp}` }).where(eq(books.id, book.id)),
        ]);
    }
    return { ...result, xp };
}

/**
 * The hero asks for an answer, and the person gives one: yes or no, in their
 * own voice and for their own reasons. Whatever they say stands.
 */
export async function askForAnswer(ctx: AiContext, book: Book, characterId: string): Promise<DialogueTurnResult> {
    const character = await findCharacter(book, characterId);
    const conversation = await conversationWith(book.id, characterId);
    await within(book, character, conversation, { remote: false });
    const stake = await atStake(book, characterId, conversation.id, { remote: false });
    if (!stake) throw new Error("There is nothing to ask them for just now.");
    if (stake.heroLines < 1) throw new Error("Say what you have come to say first.");

    const before = (await db.query.messages.findMany({
        where: eq(messages.conversationId, conversation.id),
        orderBy: [desc(messages.createdAt)],
        limit: linesToCarry(conversation),
    })).reverse();

    const brief = await briefFor(book, character, conversation, stake.goal.title, before, stake, { remote: false });
    const turn = await writeAnswer(ctx, brief);
    const result = await conclude(ctx, book, character, conversation, turn, brief, stake, {
        segments: [{ t: "text", v: ASKING }], note: null, heroLines: stake.heroLines, asked: true,
    });
    return { ...result, xp: 0 };
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
