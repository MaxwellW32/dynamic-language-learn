import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { landmarks, passages, regions, type Book, type Chapter, type Goal, type Passage, type Region } from "@/db/schema";
import { isLangCode, type LangCode } from "@/game/languages";
import type { ExamineResult, PassageView } from "@/game/payloads";
import { plannedIdsIn, segmentsToPlainText, type Segment } from "@/game/segments";
import { withinInteractRange } from "@/game/worldgen/layout";
import type { AiContext } from "../ai/client";
import { writeTelling, type NarratorBrief, type ToTell } from "../ai/prompts/narrator";
import { bibleOf } from "../ai/prompts/rulebook";
import { offerWords, resolveSegments, type WordOffer } from "../ai/segments";
import { cardsForSegments } from "./dictionary";
import { chapterInHand, chaptersOf, goalInHand, handNext, outlineText, settle, storySoFar, storyState, told } from "./goals";
import { getImmersion, planWords, recordExposure } from "./learning";
import { sceneBrief, worldKeys } from "./scene";
import { getWallet } from "./wallet";

export const langOf = (book: Pick<Book, "targetLanguage">): LangCode =>
    isLangCode(book.targetLanguage) ? book.targetLanguage : "es";

/* ------------------------------------------------------------------ */
/* the book's pages                                                    */
/* ------------------------------------------------------------------ */

export async function currentChapter(bookId: string): Promise<Chapter> {
    const chapter = chapterInHand(await chaptersOf(bookId));
    if (!chapter) throw new Error("This book has no chapters yet.");
    return chapter;
}

const toView = (row: Passage, chapterIndex: number): PassageView => ({
    id: row.id, kind: row.kind, segments: row.segments, chapterIndex,
});

export async function appendPassage(
    book: Pick<Book, "id" | "currentRegionId">, chapter: Pick<Chapter, "id" | "index">,
    kind: Passage["kind"], segments: Segment[],
): Promise<PassageView> {
    const [row] = await db.insert(passages).values({
        bookId: book.id, chapterId: chapter.id, kind, segments, regionId: book.currentRegionId,
    }).returning();
    return toView(row, chapter.index);
}

export async function getPassageViews(bookId: string, limit = 80): Promise<PassageView[]> {
    const rows = await db.query.passages.findMany({
        where: eq(passages.bookId, bookId), orderBy: [desc(passages.createdAt)], limit,
        with: { chapter: true },
    });
    return rows.reverse().map((row) => toView(row, row.chapter.index));
}

async function lately(bookId: string, limit = 2): Promise<string> {
    const rows = await db.query.passages.findMany({
        where: eq(passages.bookId, bookId), orderBy: [desc(passages.createdAt)], limit,
    });
    return rows.reverse().map((p) => segmentsToPlainText(p.segments)).join("\n---\n");
}

/* ------------------------------------------------------------------ */
/* writing pages                                                       */
/* ------------------------------------------------------------------ */

export async function narratorBrief(
    book: Book,
    region: Region,
    chapter: Pick<Chapter, "index" | "title" | "description">,
    words: { introduce: number; review: number; scene: number },
): Promise<{ brief: NarratorBrief; offer: WordOffer; lang: LangCode }> {
    const lang = langOf(book);
    const [keys, immersion, planned, scene, recent, soFar, outline] = await Promise.all([
        worldKeys(book),
        getImmersion(book.userId, lang),
        planWords(book.userId, lang, { ...words, sceneKeys: region.themeWords, embed: true }),
        sceneBrief(book),
        lately(book.id),
        storySoFar(book),
        outlineText(book.id),
    ]);
    const offer = offerWords(planned);
    return {
        lang,
        offer,
        brief: {
            bible: bibleOf(book, [...keys.places.values()], keys.cast),
            outline,
            immersion,
            chapter: `Chapter ${chapter.index}, "${chapter.title}". ${chapter.description}`.trim(),
            storySoFar: soFar,
            lately: recent,
            scene,
            carrying: book.belongings.join("; "),
            offer,
            cacheKey: book.id,
        },
    };
}

export type Told = { goal: Goal; page: PassageView; segments: Segment[] };

/** a page teaches only if something in it is in the language being learned */
const teaches = (passage: { t: string }[]): boolean => passage.some((segment) => segment.t !== "text");

/**
 * Ask for pages, and once more if any of them came back with none of the
 * language being learned in it. It is rare, and a page like that is a page
 * wasted; if the second attempt is no better, the first is kept.
 */
async function telling(
    ctx: AiContext, brief: NarratorBrief, asked: ToTell[], options: Parameters<typeof writeTelling>[3] = {},
): Promise<Awaited<ReturnType<typeof writeTelling>>> {
    const first = await writeTelling(ctx, brief, asked, options);
    if (first.pages.length > 0 && first.pages.every((page) => teaches(page.passage))) return first;
    try {
        const second = await writeTelling(ctx, brief, asked, { ...options, again: true });
        const better = second.pages.length >= first.pages.length && second.pages.every((page) => teaches(page.passage));
        return better ? second : first;
    } catch {
        return first;
    }
}

/**
 * The storyteller tells what it has been given to tell: one request, a page
 * for each pointer. Each goal is done once its page is in the book. Returns
 * the pages in the order they are to be read; a pointer the storyteller
 * passed over is left in hand and told the next time.
 */
export async function tell(ctx: AiContext, book: Book, region: Region, chapter: Chapter, run: Goal[]): Promise<Told[]> {
    if (run.length === 0) return [];
    // more pages, more words to weave through them
    const { brief, offer, lang } = await narratorBrief(book, region, chapter, {
        introduce: 1 + run.length, review: 2 + run.length, scene: 2,
    });
    const asked: (ToTell & { goal: Goal })[] = run.map((goal, i) => ({ key: `t${i + 1}`, title: goal.title, brief: goal.brief, goal }));
    const written = await telling(ctx, brief, asked);

    const pages: Told[] = [];
    for (const ask of asked) {
        const found = written.pages.find((page) => page.key === ask.key) ?? (asked.length === 1 ? written.pages[0] : undefined);
        const segments = found ? await resolveSegments(lang, found.passage, offer) : [];
        // pages are read in order: one that is missing stops the telling there
        if (segments.length === 0) break;
        const page = await appendPassage(book, chapter, "narration", segments);
        await told(book, ask.goal, page.id);
        await recordExposure(book.userId, lang, plannedIdsIn(segments));
        pages.push({ goal: ask.goal, page, segments });
    }
    if (pages.length > 0) await handNext(book, chapter.id);
    return pages;
}

/**
 * The hero examines a landmark. Its page is written the first time and reread
 * for nothing ever after; if looking at it is the goal in hand, the goal is
 * done either way, before anything is reread.
 */
export async function examine(ctx: AiContext, book: Book, landmarkId: string): Promise<ExamineResult> {
    const thing = await db.query.landmarks.findFirst({ where: eq(landmarks.id, landmarkId) });
    if (!thing || thing.regionId !== book.currentRegionId) throw new Error("There is nothing to examine there.");
    if (!withinInteractRange({ x: book.x, z: book.z }, thing, 7)) throw new Error("Step closer to take a look.");

    const region = await db.query.regions.findFirst({ where: eq(regions.id, thing.regionId) });
    if (!region) throw new Error("This place is missing from the book.");
    const chapter = await currentChapter(book.id);

    let written: { page: PassageView; segments: Segment[] } | null = null;
    if (thing.passageId) {
        const stored = await db.query.passages.findFirst({
            where: and(eq(passages.id, thing.passageId), eq(passages.bookId, book.id)),
            with: { chapter: true },
        });
        if (stored) written = { page: toView(stored, stored.chapter.index), segments: stored.segments };
    }
    if (!written) {
        const { brief, offer, lang } = await narratorBrief(book, region, chapter, { introduce: 1, review: 3, scene: 2 });
        const found = await telling(ctx, brief, [{
            key: "t1",
            title: `The hero examines ${thing.name} (a ${thing.kind})`,
            brief: `What there is to discover: ${thing.lore || "nothing is recorded — find something small and fitting."}`,
        }], {
            task: "tell-examine",
            words: "50 to 90",
            how: "The hero looks closely at something. Reveal what there is to discover as a discovery: let the thing imply its history rather than recite it. It changes nothing in the world; it is a page for the curious.",
        });
        const segments = await resolveSegments(lang, found.pages[0]?.passage ?? [], offer);
        if (segments.length === 0) throw new Error("The storyteller lost the thread. Please try again.");
        const page = await appendPassage(book, chapter, "discovery", segments);
        await db.update(landmarks).set({ passageId: page.id }).where(eq(landmarks.id, thing.id));
        await recordExposure(book.userId, lang, plannedIdsIn(segments));
        written = { page, segments };
    }

    const inHand = await goalInHand(book.id);
    const settled = inHand && inHand.kind === "examine" && inHand.targetLandmarkId === thing.id
        ? await settle(book, inHand, "done", `${book.playerName} looked closely at ${thing.name}.`)
        : null;

    const [words, story, wallet] = await Promise.all([
        cardsForSegments([written.segments]),
        storyState(book),
        getWallet(book.userId),
    ]);
    return { page: written.page, words, story, settled, wallet };
}
