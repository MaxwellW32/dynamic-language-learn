import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, type Book } from "@/db/schema";
import type { ChronicleEntry } from "@/game/payloads";
import { gossip } from "./memory";

/**
 * The chronicle: what has happened, as the world remembers it. The reader can
 * leaf through it, and what is weighty in it travels by word of mouth, so that
 * the people of a place have heard what the hero did there.
 *
 * It is a record, not a plan. What the story does next is decided by its
 * goals (server/services/story.ts); what it is told of its own past is each
 * goal's outcome and each chapter's summary (`storySoFar`).
 */
export async function chronicle(book: Pick<Book, "id">, event: {
    kind: string;
    summary: string;
    importance: number;
    regionId?: string | null;
    characterId?: string | null;
    /** how the people of the place would tell it, when the chronicle's own words are not theirs */
    heard?: string;
}): Promise<void> {
    const importance = Math.max(1, Math.min(10, Math.round(event.importance)));
    const summary = event.summary.trim().slice(0, 300);
    if (summary.length === 0) return;
    await db.insert(events).values({
        bookId: book.id, kind: event.kind, summary, importance,
        regionId: event.regionId ?? null, characterId: event.characterId ?? null,
    });
    await gossip(book, {
        summary: event.heard?.trim().slice(0, 300) || summary,
        importance, regionId: event.regionId ?? null, exceptCharacterId: event.characterId,
    });
}

export async function getChronicle(bookId: string, limit = 40): Promise<ChronicleEntry[]> {
    const rows = await db.query.events.findMany({
        where: eq(events.bookId, bookId), orderBy: [desc(events.createdAt)], limit,
    });
    return rows.map((e) => ({ id: e.id, summary: e.summary, at: e.createdAt.toISOString() }));
}
