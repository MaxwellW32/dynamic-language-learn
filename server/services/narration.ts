import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { chapters, landmarks, passages, regions, type Book, type Passage, type Region } from "@/db/schema";
import { isLangCode, type LangCode } from "@/game/languages";
import type { ChapterView, NarrationResult, PassageChoice, PassageView, QuestUpdate } from "@/game/payloads";
import { plannedIdsIn, segmentsToPlainText, type Segment } from "@/game/segments";
import { withinInteractRange } from "@/game/worldgen/layout";
import type { AiContext } from "../ai/client";
import { writeNarration, type NarrationKind, type NarratorBrief } from "../ai/prompts/narrator";
import { bibleOf } from "../ai/prompts/rulebook";
import { offerWords, resolveSegments, toChoices, type WordOffer } from "../ai/segments";
import { cardsForSegments } from "./dictionary";
import { chronicle, chronicleBrief, runDirector } from "./director";
import { getImmersion, planWords, recordExposure } from "./learning";
import { applyProgress, isChapterTurnReady } from "./quests";
import { sceneBrief, worldKeys } from "./scene";
import { getWallet } from "./wallet";

export const langOf = (book: Pick<Book, "targetLanguage">): LangCode =>
    isLangCode(book.targetLanguage) ? book.targetLanguage : "es";

/* ------------------------------------------------------------------ */
/* the book's pages                                                    */
/* ------------------------------------------------------------------ */

export async function currentChapter(bookId: string) {
    const chapter = await db.query.chapters.findFirst({
        where: eq(chapters.bookId, bookId), orderBy: [desc(chapters.index)],
    });
    if (!chapter) throw new Error("This book has no chapters yet.");
    return chapter;
}

const toView = (row: Passage, chapterIndex: number): PassageView => ({
    id: row.id, kind: row.kind, segments: row.segments,
    choices: row.choices ?? null, chosenKey: row.chosenKey, chapterIndex,
});

export async function appendPassage(
    book: Pick<Book, "id" | "currentRegionId">,
    kind: Passage["kind"],
    segments: Segment[],
    choices: PassageChoice[] | null = null,
): Promise<PassageView> {
    const chapter = await currentChapter(book.id);
    const [row] = await db.insert(passages).values({
        bookId: book.id, chapterId: chapter.id, kind, segments, choices, regionId: book.currentRegionId,
    }).returning();
    return toView(row, chapter.index);
}

export async function getChapterViews(bookId: string): Promise<ChapterView[]> {
    const rows = await db.query.chapters.findMany({ where: eq(chapters.bookId, bookId), orderBy: [asc(chapters.index)] });
    return rows.map((c) => ({ id: c.id, index: c.index, title: c.title, summary: c.summary }));
}

export async function getPassageViews(bookId: string, limit = 60): Promise<PassageView[]> {
    const rows = await db.query.passages.findMany({
        where: eq(passages.bookId, bookId), orderBy: [desc(passages.createdAt)], limit,
        with: { chapter: true },
    });
    return rows.reverse().map((row) => toView(row, row.chapter.index));
}

async function lately(bookId: string, limit = 3): Promise<string> {
    const rows = await db.query.passages.findMany({
        where: eq(passages.bookId, bookId), orderBy: [desc(passages.createdAt)], limit,
    });
    return rows.reverse().map((p) => segmentsToPlainText(p.segments)).join("\n---\n");
}

/* ------------------------------------------------------------------ */
/* writing a passage                                                   */
/* ------------------------------------------------------------------ */

export async function narratorBrief(
    book: Book,
    region: Region,
    words: { introduce: number; review: number; scene: number },
): Promise<{ brief: NarratorBrief; offer: WordOffer; lang: LangCode }> {
    const lang = langOf(book);
    const [keys, immersion, planned, scene, recent, happened] = await Promise.all([
        worldKeys(book),
        getImmersion(book.userId, lang),
        planWords(book.userId, lang, { ...words, sceneKeys: region.themeWords, embed: true }),
        sceneBrief(book),
        lately(book.id),
        chronicleBrief(book.id),
    ]);
    const offer = offerWords(planned);
    return {
        lang,
        offer,
        brief: {
            bible: bibleOf(book, [...keys.places.values()], keys.cast),
            immersion,
            scene,
            lately: recent,
            chronicle: happened,
            lean: book.directorNote,
            offer,
            cacheKey: book.id,
        },
    };
}

type Written = { passage: PassageView; segments: Segment[] };

/** write one passage into the book, and the event it may amount to into the chronicle */
async function write(
    ctx: AiContext, book: Book, region: Region, kind: NarrationKind, about: string,
    options: { storeAs?: Passage["kind"]; characterId?: string | null; minImportance?: number } = {},
): Promise<Written> {
    const counts = kind === "victory" ? { introduce: 0, review: 3, scene: 0 } : { introduce: 1, review: 3, scene: 2 };
    const { brief, offer, lang } = await narratorBrief(book, region, counts);
    const written = await writeNarration(ctx, brief, kind, about);

    const segments = await resolveSegments(lang, written.passage, offer);
    const choices = toChoices(written.choices);
    const storeAs = options.storeAs ?? (choices ? "choice" : kind === "inspect" ? "discovery" : kind === "beat" || kind === "choice" ? "event" : "narration");
    const passage = await appendPassage(book, storeAs, segments, choices);

    if (written.eventSummary) {
        await chronicle(book, {
            kind,
            summary: written.eventSummary,
            importance: Math.max(options.minImportance ?? 1, written.importance),
            regionId: region.id,
            characterId: options.characterId ?? null,
        });
    }
    await recordExposure(book.userId, lang, plannedIdsIn(segments));
    return { passage, segments };
}

export async function finish(
    book: Book, written: Written | null, questUpdates: QuestUpdate[],
): Promise<NarrationResult> {
    const [words, chapterTurnReady, wallet] = await Promise.all([
        written ? cardsForSegments([written.segments, ...(written.passage.choices ?? []).map((c) => c.label)]) : Promise.resolve([]),
        isChapterTurnReady(book),
        getWallet(book.userId),
    ]);
    return { passage: written?.passage ?? null, words, questUpdates, chapterTurnReady, wallet };
}

/**
 * A quest has just been completed or lost. The book marks the moment, and the
 * director — in the same breath, so the player waits once, not twice —
 * decides what the story does about it.
 */
export async function questBeat(
    ctx: AiContext, book: Book, region: Region, resolved: QuestUpdate, how: string, characterId?: string | null,
): Promise<{ written: Written | null; fresh: QuestUpdate[] }> {
    await chronicle(book, {
        kind: resolved.failed ? "quest-lost" : "quest-done",
        summary: resolved.failed
            ? `${book.playerName} lost the quest "${resolved.questTitle}": ${how}`
            : `${book.playerName} completed the quest "${resolved.questTitle}": ${how}`,
        importance: 7,
        regionId: region.id,
        characterId,
        // what happened, without the asides meant for the narrator
        heard: how.replace(/\s*\([^)]*\)/g, "").split(". ")[0].replace(/\.?$/, "."),
    });
    const about = resolved.failed
        ? `${how} The quest "${resolved.questTitle}" is lost. Mark the setback with warmth: the road bends, and goes on.`
        : `${how} This completed the quest "${resolved.questTitle}". Let the moment carry that weight.`;
    const [written, fresh] = await Promise.all([
        write(ctx, book, region, "beat", about, { characterId }).catch((error) => {
            // the quest stands completed even if the narrator stumbles; the HUD still announces it
            console.error("[narration] quest beat failed", error);
            return null;
        }),
        runDirector(ctx, book.id),
    ]);
    return { written, fresh };
}

/* ------------------------------------------------------------------ */
/* moments                                                             */
/* ------------------------------------------------------------------ */

/** the hero has stepped into a region */
export async function handleArrival(ctx: AiContext, book: Book, region: Region, firstVisit: boolean): Promise<NarrationResult | null> {
    const questUpdates = await applyProgress(book, { kind: "visit", regionId: region.id });
    const resolved = questUpdates.find((u) => u.questCompleted);

    if (resolved) {
        const { written, fresh } = await questBeat(ctx, book, region, resolved, `${book.playerName} reached ${region.name}.`);
        return finish(book, written, [...questUpdates, ...fresh]);
    }
    if (!firstVisit) return questUpdates.length > 0 ? finish(book, null, questUpdates) : null;

    await chronicle(book, {
        kind: "arrival", importance: 3, regionId: region.id,
        summary: `${book.playerName} reached ${region.name} for the first time.`,
    });
    const written = await write(ctx, book, region, "arrival",
        `Arriving in ${region.name} for the first time. ${region.description}`);
    return finish(book, written, questUpdates);
}

/** the hero examines a landmark: written once, reread for nothing ever after */
export async function examine(ctx: AiContext, book: Book, landmarkId: string): Promise<NarrationResult> {
    const thing = await db.query.landmarks.findFirst({ where: eq(landmarks.id, landmarkId) });
    if (!thing || thing.regionId !== book.currentRegionId) throw new Error("There is nothing to examine there.");
    if (!withinInteractRange({ x: book.x, z: book.z }, thing, 7)) throw new Error("Step closer to take a look.");

    const region = await db.query.regions.findFirst({ where: eq(regions.id, thing.regionId) });
    if (!region) throw new Error("This place is missing from the book.");

    // asked before anything is reread: a quest may have been given for a thing the hero looked at long ago
    const questUpdates = await applyProgress(book, { kind: "inspect", landmarkId: thing.id });
    const resolved = questUpdates.find((u) => u.questCompleted);

    if (resolved) {
        const { written, fresh } = await questBeat(ctx, book, region, resolved, `${book.playerName} examined ${thing.name}. ${thing.lore}`);
        // what was first found here stays what is reread here
        if (written && !thing.passageId) await db.update(landmarks).set({ passageId: written.passage.id }).where(eq(landmarks.id, thing.id));
        return finish(book, written, [...questUpdates, ...fresh]);
    }

    if (thing.passageId) {
        const stored = await db.query.passages.findFirst({
            where: and(eq(passages.id, thing.passageId), eq(passages.bookId, book.id)),
            with: { chapter: true },
        });
        if (stored) {
            const passage = toView(stored, stored.chapter.index);
            return finish(book, { passage, segments: stored.segments }, questUpdates);
        }
    }

    const about = `The hero examines ${thing.name} (a ${thing.kind}). What there is to discover: ${thing.lore || "nothing is recorded — find something small and fitting."}`;

    const written = await write(ctx, book, region, "inspect", about);
    await db.update(landmarks).set({ passageId: written.passage.id }).where(eq(landmarks.id, thing.id));
    return finish(book, written, questUpdates);
}

/** the hero takes one of the ways a passage offered */
export async function choose(ctx: AiContext, book: Book, passageId: string, choiceKey: string): Promise<NarrationResult> {
    // claim the fork: a double click must not write two outcomes
    const [fork] = await db.update(passages)
        .set({ chosenKey: choiceKey })
        .where(and(eq(passages.id, passageId), eq(passages.bookId, book.id), isNull(passages.chosenKey)))
        .returning();
    if (!fork || !fork.choices) throw new Error("That moment has passed.");
    const taken = fork.choices.find((c) => c.key === choiceKey);
    if (!taken) throw new Error("That was not one of the ways open to you.");

    const region = await db.query.regions.findFirst({ where: eq(regions.id, book.currentRegionId ?? "") });
    if (!region) throw new Error("This place is missing from the book.");

    const others = fork.choices.filter((c) => c.key !== choiceKey).map((c) => `"${segmentsToPlainText(c.label)}"`);
    const written = await write(ctx, book, region, "choice",
        `The passage before this one ended at a fork:\n"${segmentsToPlainText(fork.segments)}"\nThe hero chose: "${segmentsToPlainText(taken.label)}" (${taken.tone}).${others.length > 0 ? ` They did not choose: ${others.join(" or ")}.` : ""}`,
        { minImportance: 5 });
    return finish(book, written, []);
}

/** victory prose, for the battles that deserve a page of their own */
export async function narrateVictory(ctx: AiContext, book: Book, region: Region, about: string): Promise<Written | null> {
    try {
        return await write(ctx, book, region, "victory", about);
    } catch (error) {
        // the win stands even if the narrator stumbles
        console.error("[narration] victory failed", error);
        return null;
    }
}
