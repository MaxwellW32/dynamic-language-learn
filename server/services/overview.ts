import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { books, regions, type Book, type Region } from "@/db/schema";
import type { BookOverview } from "@/game/payloads";
import { getPeople } from "./cast";
import { getChronicle } from "./chronicle";
import { cardsForSegments } from "./dictionary";
import { getActiveEncounter } from "./encounters";
import { chapterViews, chaptersOf, storyState } from "./goals";
import { getLearnerView } from "./learning";
import { getPassageViews, langOf } from "./narration";
import { getScene } from "./scene";
import { getWallet } from "./wallet";

export function regionList(all: Region[], currentId: string | null): BookOverview["regions"] {
    return [...all]
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map((r) => ({ id: r.id, name: r.name, kind: r.kind, biome: r.biome, visited: r.visited, current: r.id === currentId }));
}

/** everything the game screen needs to open a book, in one round trip */
export async function getOverview(book: Book): Promise<BookOverview> {
    const lang = langOf(book);
    const [scene, all, story, people, chapters, passageViews, chronicle, learner, activeEncounter, wallet] = await Promise.all([
        getScene(book),
        db.query.regions.findMany({ where: eq(regions.bookId, book.id) }),
        storyState(book),
        getPeople(book),
        chaptersOf(book.id),
        getPassageViews(book.id),
        getChronicle(book.id),
        getLearnerView(book.userId, lang),
        getActiveEncounter(book),
        getWallet(book.userId),
    ]);

    const words = await cardsForSegments([
        ...passageViews.map((p) => p.segments),
        ...scene.characters.flatMap((c) => c.barks),
    ]);

    return {
        book: {
            id: book.id, title: book.title, premise: book.premise, playerName: book.playerName,
            nativeLanguage: book.nativeLanguage, targetLanguage: book.targetLanguage,
            arcStage: book.arcStage, status: book.status, xp: book.xp,
        },
        scene,
        regions: regionList(all, book.currentRegionId),
        story,
        people,
        chapters: chapterViews(chapters),
        passages: passageViews,
        words,
        chronicle,
        learner,
        activeEncounter,
        wallet,
    };
}

export async function listBooks(userId: string) {
    const rows = await db.query.books.findMany({
        where: eq(books.userId, userId),
        orderBy: [desc(books.updatedAt)],
        with: { regions: true, chapters: true },
    });
    return rows.map((book) => {
        const reached = book.chapters.filter((chapter) => chapter.status !== "ahead").length;
        return {
            id: book.id,
            title: book.title,
            premise: book.premise,
            targetLanguage: book.targetLanguage,
            status: book.status,
            arcStage: book.arcStage,
            playerName: book.playerName,
            xp: book.xp,
            updatedAt: book.updatedAt.toISOString(),
            /** the biome of the home region gives the book's spine its colour */
            biome: book.regions.find((r) => r.key === "r1")?.biome ?? "meadow",
            places: book.regions.filter((r) => r.visited).length,
            /** how far into the book the reader is: chapter 2 of 6 */
            chapter: Math.max(1, reached),
            chapters: Math.max(reached, book.chapters.length),
        };
    });
}

export type BookSummary = Awaited<ReturnType<typeof listBooks>>[number];
