import "server-only";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { characters, memories, relationships, type Book, type Character, type Memory } from "@/db/schema";
import type { AiContext } from "../ai/client";
import { reflect } from "../ai/prompts/scribe";

/**
 * What characters remember, and what reaches the prompt.
 *
 * A character may hold dozens of memories; a prompt carries six. They are
 * chosen by score, not by date, so the promise made three chapters ago
 * outranks yesterday's small talk — and what is recalled is reinforced, so the
 * things that keep mattering stay near the top.
 */

export const RECALL_LIMIT = 6;
/** above this many memories, the oldest minor ones are distilled into a few reflections */
const CONSOLIDATE_ABOVE = 40;
const CONSOLIDATE_BATCH = 24;
/** how many memories are weighed for a recall — more than this and the oldest minor ones are not even looked at */
const CANDIDATES = 60;
/** a memory loses half its recency in this many hours of real time */
const HALF_LIFE_HOURS = 72;
/** how many unkept promises stay in every prompt, newest first */
const HELD_PROMISES = 2;
/** events at least this important travel by word of mouth */
export const GOSSIP_FROM = 7;

const STOPWORDS = new Set([
    "the", "and", "you", "your", "that", "this", "with", "have", "has", "had", "for", "are", "was", "were", "not", "but",
    "what", "when", "where", "who", "why", "how", "can", "could", "would", "should", "will", "just", "about", "there",
    "their", "they", "them", "then", "than", "from", "into", "out", "she", "her", "his", "him", "its", "our", "one",
    "all", "any", "some", "been", "being", "did", "does", "doing", "say", "said", "tell", "told", "know", "like",
    "want", "need", "here", "very", "much", "more", "too", "yes", "well", "hero", "please", "thank", "thanks",
]);

/** the words of a sentence that could plausibly be what it is about */
export function keywordsOf(text: string): string[] {
    const seen = new Set<string>();
    for (const raw of text.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u)) {
        if (raw.length < 3 || STOPWORDS.has(raw)) continue;
        seen.add(raw);
    }
    return [...seen];
}

/** how well a memory answers a cue, 0..1 */
export function relevance(memory: Pick<Memory, "content" | "keywords">, cue: Set<string>): number {
    if (cue.size === 0) return 0;
    const own = new Set([...memory.keywords.map((k) => k.toLowerCase()), ...keywordsOf(memory.content)]);
    let hits = 0;
    for (const word of cue) {
        if (own.has(word)) hits++;
        // a shared stem counts for something: "promise" and "promised"
        else if (word.length >= 5 && [...own].some((k) => k.length >= 5 && (k.startsWith(word.slice(0, 5)) || word.startsWith(k.slice(0, 5))))) hits += 0.6;
    }
    return Math.min(1, hits / Math.min(cue.size, 4));
}

export function score(
    memory: Pick<Memory, "content" | "keywords" | "importance" | "kind" | "resolved" | "recallCount" | "createdAt">,
    cue: Set<string>,
    now: Date,
    /** false for a promise that is not among the few held in mind */
    held = true,
): number {
    const ageHours = Math.max(0, (now.getTime() - memory.createdAt.getTime()) / 3_600_000);
    const recency = Math.pow(0.5, ageHours / HALF_LIFE_HOURS);
    const reinforced = Math.min(0.1, memory.recallCount * 0.02);
    // an unkept promise is never out of mind
    const pinned = held && memory.kind === "promise" && !memory.resolved ? 1 : 0;
    return (memory.importance / 10) * 0.45 + recency * 0.2 + relevance(memory, cue) * 0.35 + reinforced + pinned;
}

/** the few memories that matter for this moment, best first */
export async function recall(character: Pick<Character, "id">, cue: string, limit = RECALL_LIMIT): Promise<Memory[]> {
    const candidates = await db.query.memories.findMany({
        where: eq(memories.characterId, character.id),
        orderBy: [desc(memories.importance), desc(memories.createdAt)],
        limit: CANDIDATES,
    });
    if (candidates.length === 0) return [];

    const words = new Set(keywordsOf(cue));
    const now = new Date();
    // Only the newest promises are held in mind whatever the talk is about. Nothing marks a promise as kept, so
    // if all of them were, a long friendship would fill every place in the prompt with promises and nothing else;
    // the older ones are still recalled when the conversation turns to them.
    const held = new Set(candidates
        .filter((memory) => memory.kind === "promise" && !memory.resolved)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, HELD_PROMISES)
        .map((memory) => memory.id));
    const chosen = candidates
        .map((memory) => ({ memory, value: score(memory, words, now, held.has(memory.id)) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit)
        .map(({ memory }) => memory);

    // what is recalled is reinforced — fire and forget, a recall must not wait on it
    void db.update(memories)
        .set({ recallCount: sql`${memories.recallCount} + 1`, lastRecalledAt: now })
        .where(inArray(memories.id, chosen.map((m) => m.id)))
        .catch((error) => console.error("[memory] reinforcement failed", error));

    return chosen;
}

const KIND_MARK: Record<Memory["kind"], string> = {
    episode: "", fact: "", promise: "(a promise) ", rumor: "(heard, not seen) ", reflection: "",
};

export function memoriesBrief(chosen: Memory[]): string {
    return chosen.map((m) => `- ${KIND_MARK[m.kind]}${m.content}`).join("\n");
}

/** do two sets of keywords tell of the same thing? More than half of the shorter is found in the longer. */
export function sameNews(a: string[], b: string[]): boolean {
    const [few, many] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
    if (few.length < 3) return false;
    return few.filter((word) => many.has(word)).length / few.length > 0.5;
}

export async function remember(bookId: string, characterId: string, memory: {
    content: string;
    importance: number;
    kind: Memory["kind"];
    keywords?: string[];
}): Promise<void> {
    const content = memory.content.trim().slice(0, 400);
    if (content.length === 0) return;
    const keywords = [...new Set([...(memory.keywords ?? []).map((k) => k.toLowerCase().trim()), ...keywordsOf(content)])]
        .filter((k) => k.length >= 3)
        .slice(0, 12);

    // news reaches people by more than one road; hearing it twice is still one thing heard
    if (memory.kind === "rumor") {
        const lately = await db.query.memories.findMany({
            where: and(eq(memories.characterId, characterId), eq(memories.kind, "rumor")),
            orderBy: [desc(memories.createdAt)],
            limit: 4,
        });
        if (lately.some((other) => sameNews(keywords, other.keywords))) return;
    }
    await db.insert(memories).values({
        bookId, characterId, content, keywords,
        kind: memory.kind,
        importance: Math.max(1, Math.min(10, Math.round(memory.importance))),
    });
}

/**
 * Word gets around. When something important happens, the people of that
 * region come to have heard of it — by rule, with no model call. Whoever was
 * part of it is left out: they remember it first-hand.
 */
export async function gossip(book: Pick<Book, "id">, event: {
    summary: string;
    importance: number;
    regionId: string | null;
    exceptCharacterId?: string | null;
}): Promise<void> {
    if (event.importance < GOSSIP_FROM || !event.regionId) return;
    const hearers = await db.query.characters.findMany({
        where: and(
            eq(characters.bookId, book.id),
            eq(characters.regionId, event.regionId),
            eq(characters.status, "alive"),
            event.exceptCharacterId ? ne(characters.id, event.exceptCharacterId) : undefined,
        ),
    });
    if (hearers.length === 0) return;
    await db.insert(memories).values(hearers.map((hearer) => ({
        bookId: book.id,
        characterId: hearer.id,
        kind: "rumor" as const,
        content: `People are saying: ${event.summary}`,
        // hearsay weighs less than having been there
        importance: Math.max(3, event.importance - 3),
        keywords: keywordsOf(event.summary).slice(0, 12),
    })));
}

/**
 * When someone's memories have piled up, the scribe distils the oldest minor
 * ones into a few reflections and rewrites how they feel about the hero.
 * Promises and anything weighty are never folded away.
 */
export async function consolidate(ctx: AiContext, character: Pick<Character, "id" | "name" | "bookId">, playerName: string): Promise<boolean> {
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
        .from(memories).where(eq(memories.characterId, character.id));
    if (total <= CONSOLIDATE_ABOVE) return false;

    const minor = await db.query.memories.findMany({
        where: and(
            eq(memories.characterId, character.id),
            lt(memories.importance, 7),
            ne(memories.kind, "promise"),
            ne(memories.kind, "reflection"),
        ),
        orderBy: [asc(memories.createdAt)],
        limit: CONSOLIDATE_BATCH,
    });
    if (minor.length < 8) return false;

    const relationship = await db.query.relationships.findFirst({ where: eq(relationships.characterId, character.id) });
    const distilled = await reflect(ctx, {
        characterName: character.name,
        playerName,
        relationship: relationship?.summary ?? "",
        memories: memoriesBrief(minor),
    });
    if (distilled.reflections.length === 0) return false;

    await db.transaction(async (tx) => {
        await tx.delete(memories).where(inArray(memories.id, minor.map((m) => m.id)));
        await tx.insert(memories).values(distilled.reflections.slice(0, 5).map((reflection) => ({
            bookId: character.bookId,
            characterId: character.id,
            kind: "reflection" as const,
            content: reflection.content.trim().slice(0, 400),
            importance: Math.max(1, Math.min(10, reflection.importance)),
            keywords: reflection.keywords.map((k) => k.toLowerCase()).slice(0, 12),
        })));
        await tx.insert(relationships)
            .values({ characterId: character.id, summary: distilled.relationship.trim().slice(0, 400) })
            .onConflictDoUpdate({ target: relationships.characterId, set: { summary: distilled.relationship.trim().slice(0, 400) } });
    });
    return true;
}
