import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { books, chapters, passages, regions, threads, type Book } from "@/db/schema";
import type { ChapterTurnResult } from "@/game/payloads";
import { plannedIdsIn } from "@/game/segments";
import type { AiContext } from "../ai/client";
import { writeChapterTurn } from "../ai/prompts/narrator";
import { resolveSegments } from "../ai/segments";
import { cardsForSegments } from "./dictionary";
import { chronicle, chronicleBrief } from "./director";
import { forgeRegion, freeSide } from "./forge";
import { recordExposure } from "./learning";
import { currentChapter, narratorBrief } from "./narration";
import { getQuestViews, isChapterTurnReady, persistQuests, standingQuest } from "./quests";
import { getScene, regionOf, worldKeys } from "./scene";
import { regionList } from "./overview";
import { getWallet } from "./wallet";

const ARC = ["introduction", "rising", "climax", "falling", "resolution"] as const;

const GUIDANCE: Record<(typeof ARC)[number], string> = {
    introduction: "Meeting the world, its people, and the first hints of the mystery. Stakes are gentle and local.",
    rising: "The mystery deepens: complications, new dangers in the wild places, allies revealing what they held back. Raise the stakes. The hero may now be sent into the depths.",
    climax: "The heart of the story: what has been lurking must be faced. One quest must lead to the boss, if it still stands.",
    falling: "After the storm: consequences, mending what broke, thanks given and received, one last loose thread.",
    resolution: "The gentle ending: farewells, rewards, the world changed for the better and the hero's place in it.",
};

/**
 * Turn the page. One story-tier call closes the chapter, opens the next,
 * writes its quests from what actually happened, and may open a new place.
 * If it does, a second call peoples that place.
 */
export async function turnChapter(ctx: AiContext, book: Book): Promise<ChapterTurnResult> {
    if (!(await isChapterTurnReady(book))) throw new Error("This chapter is not finished yet.");

    const chapter = await currentChapter(book.id);
    const region = await regionOf(book);
    const nextStage = ARC[ARC.indexOf(book.arcStage) + 1] ?? null;

    const [{ brief, offer, lang }, keys, open, room, happened] = await Promise.all([
        narratorBrief(book, region, { introduce: 2, review: 3, scene: 1 }),
        worldKeys(book),
        db.query.threads.findMany({
            where: and(eq(threads.bookId, book.id), eq(threads.status, "open")),
            orderBy: [asc(threads.createdAt)],
        }),
        freeSide(book.id),
        chronicleBrief(book.id, 16, 4),
    ]);

    const turn = await writeChapterTurn(ctx, {
        brief: { ...brief, chronicle: happened },
        closing: chapter.title,
        nextStage,
        stageGuidance: nextStage ? GUIDANCE[nextStage] : "",
        threads: open.map((t) => `- (${t.kind}, weight ${t.importance}) ${t.title}: ${t.summary}`).join("\n"),
        cast: keys.peopleBrief,
        creatures: keys.creaturesBrief,
        places: keys.placesBrief,
        landmarks: keys.thingsBrief,
        room: room !== null,
    });

    await db.update(chapters).set({ summary: turn.closingSummary.trim() }).where(eq(chapters.id, chapter.id));
    const [next] = await db.insert(chapters).values({
        bookId: book.id, index: chapter.index + 1, title: turn.nextChapterTitle.trim().slice(0, 80),
    }).returning();

    const segments = await resolveSegments(lang, turn.passage, offer);
    const [page] = await db.insert(passages).values({
        bookId: book.id, chapterId: next.id, kind: "narration", segments, regionId: book.currentRegionId,
    }).returning();
    await recordExposure(book.userId, lang, plannedIdsIn(segments));

    // what has become true joins the bible — the one moment the cached prefix is allowed to change
    const facts = turn.newFacts.map((fact) => fact.trim()).filter((fact) => fact.length > 0).slice(0, 3);
    const bible = facts.length > 0
        ? book.bible.replace("\n\nWhat the book is really about", `\n${facts.map((fact) => `- ${fact}`).join("\n")}\n\nWhat the book is really about`)
        : book.bible;

    let moved: Book = { ...book, bible };
    let storyCompleted = false;

    if (nextStage) {
        await db.update(books).set({ arcStage: nextStage, bible, significance: 0 }).where(eq(books.id, book.id));
        moved = { ...moved, arcStage: nextStage };

        const refs = await worldKeys(moved);
        if (turn.newRegion) {
            try {
                const added = await forgeRegion(ctx, moved, turn.newRegion);
                if (added) {
                    // quests written before the place existed refer to it as "new"
                    refs.places.set("new", added);
                    await chronicle(moved, {
                        kind: "discovery", importance: 6, regionId: null,
                        summary: `Word came of a place called ${added.name}, and a way to it was found.`,
                    });
                }
            } catch (error) {
                // the chapter still turns; quests pointing at the missing place are dropped by persistQuests
                console.error("[chapters] the new region could not be made", error);
            }
        }
        const { created } = await persistQuests(book.id, nextStage, turn.quests, refs, book.currentRegionId);
        if (created.length === 0) {
            const given = await persistQuests(book.id, nextStage, [standingQuest(next.title)], refs);
            if (given.created.length === 0) await persistQuests(book.id, nextStage, [standingQuest(`Chapter ${next.index}`)], refs);
        }
    } else {
        storyCompleted = true;
        await db.update(books).set({ status: "completed", bible }).where(eq(books.id, book.id));
        moved = { ...moved, status: "completed" };
    }

    await chronicle(moved, {
        kind: "chapter", importance: 5, regionId: book.currentRegionId,
        summary: `The chapter "${chapter.title}" ended: ${turn.closingSummary.trim()}`,
    });
    // the turn itself is the director's work done: start the new chapter with a clean count
    await db.update(books).set({ significance: 0 }).where(eq(books.id, book.id));

    const all = await db.query.regions.findMany({ where: eq(regions.bookId, book.id) });
    const [words, questViews, scene, wallet] = await Promise.all([
        cardsForSegments([segments]),
        getQuestViews(moved),
        getScene(moved),
        getWallet(book.userId),
    ]);

    return {
        closedChapter: { id: chapter.id, index: chapter.index, title: chapter.title, summary: turn.closingSummary.trim() },
        newChapter: { id: next.id, index: next.index, title: next.title, summary: "" },
        passage: { id: page.id, kind: "narration", segments, choices: null, chosenKey: null, chapterIndex: next.index },
        words,
        quests: questViews,
        scene,
        regions: regionList(all, moved.currentRegionId),
        storyCompleted,
        wallet,
    };
}
