import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, characters, events, quests, threads, type Book } from "@/db/schema";
import type { ChronicleEntry, QuestUpdate } from "@/game/payloads";
import type { AiContext } from "../ai/client";
import { bibleOf } from "../ai/prompts/rulebook";
import { direct } from "../ai/prompts/scribe";
import { gossip, remember } from "./memory";
import { MAX_STAGE_QUESTS, persistQuests } from "./quests";
import { worldKeys } from "./scene";

/**
 * The feedback loop. Everything that happens is written to the chronicle with
 * a weight; the weights add up on the book; when enough has happened the
 * director reads the recent chronicle once and decides what it means — which
 * threads moved, who has heard what, whether the story now calls for something
 * new. The narrator and the characters then write from a world that has
 * already taken the hero's actions into account.
 */

/** how much has to happen before the director looks up from the desk */
export const DIRECT_AT = 14;
/** a story with more open errands than this gets no more until some are done */
const MAX_OPEN_QUESTS = 4;

export async function chronicle(book: Pick<Book, "id">, event: {
    kind: string;
    summary: string;
    importance: number;
    regionId?: string | null;
    characterId?: string | null;
    /** how the people of the place would tell it, when the chronicle's own words are not theirs (they know no quest by its title) */
    heard?: string;
}): Promise<void> {
    const importance = Math.max(1, Math.min(10, Math.round(event.importance)));
    const summary = event.summary.trim().slice(0, 300);
    if (summary.length === 0) return;
    await db.insert(events).values({
        bookId: book.id, kind: event.kind, summary, importance,
        regionId: event.regionId ?? null, characterId: event.characterId ?? null,
    });
    await db.update(books)
        .set({ significance: sql`${books.significance} + ${importance}` })
        .where(eq(books.id, book.id));
    await gossip(book, {
        summary: event.heard?.trim().slice(0, 300) || summary,
        importance, regionId: event.regionId ?? null, exceptCharacterId: event.characterId,
    });
}

/** the recent past in a few lines, oldest first: the last few events, plus anything weighty from further back */
export async function chronicleBrief(bookId: string, recent = 8, weighty = 4): Promise<string> {
    const [latest, heavy] = await Promise.all([
        db.query.events.findMany({ where: eq(events.bookId, bookId), orderBy: [desc(events.createdAt)], limit: recent }),
        db.query.events.findMany({
            where: and(eq(events.bookId, bookId), gte(events.importance, 7)),
            orderBy: [desc(events.createdAt)],
            limit: recent + weighty,
        }),
    ]);
    const seen = new Set(latest.map((e) => e.id));
    const older = heavy.filter((e) => !seen.has(e.id)).slice(0, weighty);
    return [...older, ...latest]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((e) => `- ${e.summary}`)
        .join("\n");
}

export async function getChronicle(bookId: string, limit = 40): Promise<ChronicleEntry[]> {
    const rows = await db.query.events.findMany({
        where: eq(events.bookId, bookId), orderBy: [desc(events.createdAt)], limit,
    });
    return rows.map((e) => ({ id: e.id, summary: e.summary, at: e.createdAt.toISOString() }));
}

export async function dueForDirection(bookId: string): Promise<boolean> {
    const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
    return !!book && book.status === "active" && book.significance >= DIRECT_AT;
}

/**
 * Run the director once and apply what it decides. Returns any quest the
 * story has just handed the hero, so the HUD can announce it.
 */
export async function runDirector(ctx: AiContext, bookId: string): Promise<QuestUpdate[]> {
    // claim the run by zeroing the counter: two triggers at once must not both direct
    const [book] = await db.update(books)
        .set({ significance: 0 })
        .where(and(eq(books.id, bookId), eq(books.status, "active"), gte(books.significance, 1)))
        .returning();
    if (!book) return [];

    try {
        const [keys, open, active, recent] = await Promise.all([
            worldKeys(book),
            db.query.threads.findMany({
                where: and(eq(threads.bookId, book.id), eq(threads.status, "open")),
                orderBy: [asc(threads.createdAt)],
            }),
            db.query.quests.findMany({
                where: eq(quests.bookId, book.id),
                orderBy: [asc(quests.sortIndex)],
                with: { objectives: true },
            }),
            chronicleBrief(book.id, 14, 3),
        ]);
        const threadKeys = new Map(open.map((thread, i) => [`t${i + 1}`, thread]));
        const openQuests = active.filter((q) => q.status === "active").length;
        // A chapter ends when its quests are settled. One more is given only to a chapter that is still under way and
        // has room: never to one that has just been finished, which would take the turning page out of the reader's hand.
        const chapterOpen = active.some((q) => q.arcStage === book.arcStage && q.status === "active");
        const chapterFull = active.filter((q) => q.arcStage === book.arcStage).length >= MAX_STAGE_QUESTS;
        const mayAddQuest = chapterOpen && !chapterFull && openQuests < MAX_OPEN_QUESTS;

        const decided = await direct(ctx, {
            bible: bibleOf(book, [...keys.places.values()], keys.cast),
            heart: book.bible.split("never state it outright): ")[1]?.trim() ?? "",
            threads: [...threadKeys].map(([key, t]) => `- ${key} (${t.kind}, weight ${t.importance}): ${t.title} — ${t.summary}`).join("\n"),
            quests: active.slice(-8).map((q) =>
                `- "${q.title}" — ${q.status}: ${q.objectives.map((o) => `${o.description} [${o.status}]`).join("; ")}`).join("\n"),
            chronicle: recent,
            cast: keys.peopleBrief,
            creatures: keys.creaturesBrief,
            places: keys.placesBrief,
            landmarks: keys.thingsBrief,
            mayAddQuest,
            cacheKey: `${book.id}:director`,
        });

        for (const thread of decided.threads.slice(0, 6)) {
            const existing = thread.key ? threadKeys.get(thread.key) : undefined;
            const values = {
                title: thread.title.trim().slice(0, 80),
                kind: thread.kind,
                summary: thread.summary.trim().slice(0, 400),
                status: thread.status,
                importance: thread.importance,
            };
            if (existing) await db.update(threads).set(values).where(eq(threads.id, existing.id));
            else if (thread.status === "open") await db.insert(threads).values({ bookId: book.id, ...values });
        }

        for (const shift of decided.shifts.slice(0, 8)) {
            const who = keys.people.get(shift.key);
            if (!who) continue;
            const changes: Partial<typeof characters.$inferInsert> = {};
            if (shift.goal) changes.goal = shift.goal.trim().slice(0, 200);
            if (shift.mood) changes.mood = shift.mood.trim().slice(0, 40);
            if (Object.keys(changes).length > 0) await db.update(characters).set(changes).where(eq(characters.id, who.id));
            if (shift.heard) await remember(book.id, who.id, { content: shift.heard, importance: 5, kind: "rumor" });
        }

        await db.update(books).set({ directorNote: decided.note.trim().slice(0, 400) }).where(eq(books.id, book.id));

        if (decided.quest && mayAddQuest) {
            const { created } = await persistQuests(book.id, book.arcStage, [decided.quest], keys, book.currentRegionId);
            return created.map((title) => ({
                questTitle: title, objectiveDescription: decided.quest!.description, questCompleted: false, isNew: true,
            }));
        }
        return [];
    } catch (error) {
        // the story goes on without its director this once; what happened stays counted for the next run
        console.error("[director] failed", error);
        await db.update(books)
            .set({ significance: sql`${books.significance} + ${book.significance}` })
            .where(eq(books.id, bookId));
        return [];
    }
}
