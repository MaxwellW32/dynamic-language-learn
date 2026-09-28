import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { books, chapters, characters, goals, regions, type Book, type Chapter, type Goal, type Region } from "@/db/schema";
import { whatIsDue } from "@/game/goals";
import { languageOf } from "@/game/languages";
import { MIN_CHAPTERS, orderStages } from "@/game/outline";
import type { ChapterTurnResult, GoalSettled, ReachResult, StoryStep } from "@/game/payloads";
import type { AiContext } from "../ai/client";
import { writeGoals, writeOutline, type PlanBrief } from "../ai/prompts/planner";
import { bibleOf } from "../ai/prompts/rulebook";
import { summarizeChapter } from "../ai/prompts/scribe";
import type { GoalPlan, GoalSketch } from "../ai/schemas";
import { addPeople, bringOnstage, getPeople } from "./cast";
import { chronicle } from "./chronicle";
import { cardsForSegments } from "./dictionary";
import { buildWorld, claimForge, failForge, forgeNote, forgeRegion, freeSide } from "./forge";
import {
    chapterInHand, chapterViews, chaptersOf, goalInHand, goalsOf, handNext, outlineText,
    persistGoals, settle, standingTell, storySoFar, storyState,
} from "./goals";
import { langOf, tell, type Told } from "./narration";
import { regionList } from "./overview";
import { getScene, regionOf, worldKeys, type WorldKeys, type WorldRefs } from "./scene";
import { getWallet } from "./wallet";

/**
 * The book, moving itself on.
 *
 * A story here is a list of chapters fixed when the book is made, and in each
 * chapter a list of goals taken one at a time. Whenever something has been
 * settled, `advance` does whatever falls to the book rather than the reader:
 * it tells what is to be told, writes the road again after a failure, writes
 * a chapter's goals when it has none. Then it stops, and waits for the reader.
 *
 * Model calls, all told: one to outline the book and its first chapter; one
 * for the goals of each later chapter; one for each run of pages the
 * storyteller tells; one for each road mended. Everything else the reader
 * does — walking, arriving, fighting — costs nothing.
 */

/** a claim older than this was left by a request that died */
const CLAIM_MS = 4 * 60_000;
const BUSY = "The storyteller is still writing. Give them a moment.";

async function claim(bookId: string): Promise<boolean> {
    const rows = await db.update(books)
        .set({ writingSince: new Date() })
        .where(and(
            eq(books.id, bookId),
            or(isNull(books.writingSince), lt(books.writingSince, new Date(Date.now() - CLAIM_MS))),
        ))
        .returning({ id: books.id });
    return rows.length > 0;
}

async function release(bookId: string): Promise<void> {
    await db.update(books).set({ writingSince: null }).where(eq(books.id, bookId));
}

async function reload(bookId: string): Promise<Book> {
    const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
    if (!book) throw new Error("This book is gone.");
    return book;
}

const heartOf = (book: Pick<Book, "bible">): string => book.bible.split("never state it outright): ")[1]?.trim() ?? "";

/* ------------------------------------------------------------------ */
/* planning                                                            */
/* ------------------------------------------------------------------ */

async function planBrief(book: Book, keys: WorldKeys): Promise<PlanBrief> {
    const [outline, soFar] = await Promise.all([outlineText(book.id), storySoFar(book)]);
    const here = [...keys.places.values()].find((region) => region.id === book.currentRegionId);
    return {
        bible: bibleOf(book, [...keys.places.values()], keys.cast),
        outline,
        heart: heartOf(book),
        storySoFar: soFar,
        hero: `${book.playerName} stands in ${here ? `${here.name} (${here.key})` : "no place yet"}. ${book.belongings.length > 0 ? `They carry: ${book.belongings.join("; ")}.` : "They carry nothing of note."}`,
        people: keys.peopleBrief,
        creatures: keys.creaturesBrief,
        places: keys.placesBrief,
        buildings: keys.buildingsBrief,
        landmarks: keys.thingsBrief,
        targetLanguageName: languageOf(langOf(book)).name,
        cacheKey: `${book.id}:plan`,
    };
}

/**
 * Write a plan into the book: the place and the people it adds, the aims it
 * changes, and its goals. If none of the goals survives, the chapter is given
 * `fallback`, because a chapter with nothing in it could never end.
 */
async function applyPlan(
    ctx: AiContext, book: Book, chapter: Chapter,
    plan: Pick<GoalPlan, "goals" | "newPeople" | "newPlace" | "shifts">,
    keys: WorldKeys, after: number, fallback: GoalSketch,
): Promise<void> {
    const refs: WorldRefs = {
        people: new Map(keys.people), creatures: keys.creatures, places: new Map(keys.places),
        houses: keys.houses, things: keys.things,
    };

    if (plan.newPlace) {
        try {
            const added = await forgeRegion(ctx, book, plan.newPlace);
            if (added) {
                // goals written before the place existed refer to it as "new"
                refs.places.set("new", added);
                await chronicle(book, {
                    kind: "discovery", importance: 5, regionId: null,
                    summary: `Word came of a place called ${added.name}, and a way to it was found.`,
                });
            }
        } catch (error) {
            // the chapter still begins; goals pointing at the missing place are dropped when they are written down
            console.error("[story] the new place could not be made", error);
        }
    }

    const fresh = await addPeople(book, langOf(book), plan.newPeople, refs.places);
    for (const [key, who] of fresh) refs.people.set(key, who);

    for (const shift of plan.shifts.slice(0, 6)) {
        const who = refs.people.get(shift.who.trim());
        if (who) await db.update(characters).set({ goal: shift.wants.trim().slice(0, 200) }).where(eq(characters.id, who.id));
    }

    const kept = await persistGoals(book, chapter, plan.goals, refs, after);
    if (kept === 0) await persistGoals(book, chapter, [fallback], refs, after);

    // someone new whom no goal brings in would wait in the wings for ever: they are simply there
    const written = await goalsOf(chapter.id);
    const broughtIn = new Set(written
        .filter((goal) => goal.status === "waiting" || goal.status === "active")
        .flatMap((goal) => [...goal.enters, ...(goal.targetCharacterId ? [goal.targetCharacterId] : [])]));
    await bringOnstage([...fresh.values()].filter((who) => !broughtIn.has(who.id)).map((who) => who.id));
}

const after = (all: Chapter[], chapter: Chapter) => {
    const next = all.find((other) => other.index === chapter.index + 1);
    return next ? { title: next.title, description: next.description } : null;
};

/** the goals of a chapter that has none: written all at once */
async function planChapter(ctx: AiContext, book: Book, chapter: Chapter, all: Chapter[], closing: Chapter | null): Promise<string | null> {
    const keys = await worldKeys(book);
    const room = await freeSide(book.id);
    const plan = await writeGoals(ctx, {
        brief: await planBrief(book, keys),
        chapter,
        after: after(all, chapter),
        closing: closing ? { index: closing.index, title: closing.title } : null,
        mend: null,
        room: room !== null,
    });
    await applyPlan(ctx, book, chapter, plan, keys, 0, standingTell(
        `Chapter ${chapter.index} begins`,
        `Set the chapter going: ${chapter.description}`,
    ));
    return plan.closingSummary?.trim() || null;
}

/** a goal failed: the road from there to the chapter's end is written again */
async function mend(ctx: AiContext, book: Book, chapter: Chapter, all: Chapter[], failed: Goal, list: Goal[]): Promise<void> {
    const keys = await worldKeys(book);
    const dropped = list.filter((goal) => goal.status === "dropped" && goal.sortIndex > failed.sortIndex);
    const fallback = standingTell(
        "The road bends",
        `Say, kindly, what it meant that the hero failed at "${failed.title}" (${failed.outcome || "it did not come off"}), and how the story found another way to where this chapter must end: ${chapter.description}`,
    );
    const last = Math.max(0, ...list.map((goal) => goal.sortIndex));
    try {
        const plan = await writeGoals(ctx, {
            brief: await planBrief(book, keys),
            chapter,
            after: after(all, chapter),
            closing: null,
            mend: {
                failed: failed.title,
                how: failed.outcome,
                dropped: dropped.map((goal) => `- (${goal.kind}) ${goal.title}: ${goal.brief}`).join("\n"),
            },
            room: false,
        });
        await applyPlan(ctx, book, chapter, { ...plan, newPlace: null }, keys, last, fallback);
    } catch (error) {
        // the planner stumbled: the chapter must still be able to end
        console.error("[story] the road could not be mended", error);
        await persistGoals(book, chapter, [fallback], { ...keys }, last);
    }
    await db.update(goals).set({ mended: true }).where(eq(goals.id, failed.id));
}

/* ------------------------------------------------------------------ */
/* the first chapter                                                   */
/* ------------------------------------------------------------------ */

/** the story of a new book: its outline from first chapter to last, the goals of the first, and its first pages */
async function beginStory(ctx: AiContext, book: Book, home: Region): Promise<void> {
    await forgeNote(book.id, "Outlining the story…");
    const keys = await worldKeys(book);
    const outline = await writeOutline(ctx, { brief: await planBrief(book, keys), startPlace: home.name });
    const sketched = orderStages(outline.chapters);
    if (sketched.length < MIN_CHAPTERS) throw new Error("The storyteller could not find the shape of the story. Please try again.");

    const rows = await db.insert(chapters).values(sketched.map((chapter, i) => ({
        bookId: book.id,
        index: i + 1,
        title: chapter.title.trim().slice(0, 80),
        description: chapter.description.trim().slice(0, 700),
        stage: chapter.stage,
        status: i === 0 ? "open" as const : "ahead" as const,
    }))).returning();
    const first = rows.find((row) => row.index === 1)!;
    await db.update(books).set({ arcStage: first.stage }).where(eq(books.id, book.id));

    await applyPlan(ctx, book, first, { goals: outline.goals, newPeople: [], newPlace: null, shifts: [] }, keys, 0, standingTell(
        `Arriving in ${home.name}`,
        `The hero arrives in ${home.name}. ${home.description} Set the chapter going: ${first.description}`,
    ));

    await forgeNote(book.id, "Writing the first page…");
    await handNext(book, first.id);
    const due = whatIsDue(await goalsOf(first.id));
    // the book opens on a page that is already written: nobody should wait twice to begin reading
    if (due.what === "tell") await tell(ctx, book, home, first, due.goals);
}

/**
 * Make a book: its world, then its story. Safe to call twice: the second
 * caller finds the making already claimed and returns at once.
 */
export async function forgeBook(ctx: AiContext, book: Book): Promise<void> {
    if (!(await claimForge(book))) return;
    try {
        const world = await buildWorld(ctx, book);
        await beginStory(ctx, world.book, world.home);
        await db.update(books).set({ status: "active", forgeNote: "", writingSince: null }).where(eq(books.id, book.id));
    } catch (error) {
        console.error("[forge] failed", error);
        await failForge(book.id);
        throw error;
    }
}

/* ------------------------------------------------------------------ */
/* moving on                                                           */
/* ------------------------------------------------------------------ */

/** everything the screen needs after the story has moved */
async function stepOf(bookId: string, pages: Told[], settled: GoalSettled | null): Promise<StoryStep> {
    const book = await reload(bookId);
    const [words, story, scene, all, people, wallet] = await Promise.all([
        cardsForSegments(pages.map((told) => told.segments)),
        storyState(book),
        getScene(book),
        db.query.regions.findMany({ where: eq(regions.bookId, book.id) }),
        getPeople(book),
        getWallet(book.userId),
    ]);
    return {
        pages: pages.map((told) => told.page),
        words, story, scene,
        regions: regionList(all, book.currentRegionId),
        people, settled, wallet,
    };
}

/**
 * Do whatever falls to the book: write the goals of a chapter that has none,
 * mend the road after a failure, tell what is to be told. Stops as soon as pages have been written (they are
 * read before anything more is), or when the next thing is the reader's to
 * do.
 */
async function work(ctx: AiContext, bookId: string): Promise<Told[]> {
    for (let guard = 0; guard < 5; guard++) {
        const book = await reload(bookId);
        if (book.status !== "active") return [];
        const all = await chaptersOf(book.id);
        const chapter = chapterInHand(all);
        if (!chapter) return [];
        // a book made before outlines has nothing to be planned from: say so, rather than write goals for a chapter
        // that could never be turned
        if (chapter.status !== "open" || chapter.description.trim().length === 0) {
            throw new Error("This book was begun before the story was rebuilt, and has no outline to go on from. Begin a new book.");
        }
        const list = await goalsOf(chapter.id);
        const due = whatIsDue(list);

        if (due.what === "plan") await planChapter(ctx, book, chapter, all, null);
        else if (due.what === "mend") await mend(ctx, book, chapter, all, due.failed, list);
        else if (due.what === "next") await handNext(book, chapter.id);
        else if (due.what === "tell") {
            const pages = await tell(ctx, book, await regionOf(book), chapter, due.goals);
            if (pages.length === 0) throw new Error("The storyteller lost the thread. Please try again.");
            return pages;
        } else return [];
    }
    return [];
}

export async function advance(ctx: AiContext, book: Pick<Book, "id">): Promise<StoryStep> {
    if (!(await claim(book.id))) throw new Error(BUSY);
    try {
        return await stepOf(book.id, await work(ctx, book.id), null);
    } finally {
        await release(book.id);
    }
}

/**
 * Turn the page. The chapter in hand is closed, the next is opened, and its
 * goals are written: one call, which also says what happened in the chapter
 * that ended. Then the new chapter's first pages are told.
 *
 * The turn is made only once the plan is in hand: if the planner stumbles,
 * the chapter is still open, and the page can be turned again.
 */
export async function turnChapter(ctx: AiContext, bookIn: Pick<Book, "id">): Promise<ChapterTurnResult> {
    if (!(await claim(bookIn.id))) throw new Error(BUSY);
    try {
        const book = await reload(bookIn.id);
        const all = await chaptersOf(book.id);
        const chapter = chapterInHand(all);
        if (book.status !== "active" || !chapter || chapter.status !== "open") throw new Error("This chapter is not finished yet.");
        const list = await goalsOf(chapter.id);
        if (whatIsDue(list).what !== "turn") throw new Error("This chapter is not finished yet.");

        const happened = list
            .filter((goal) => goal.kind !== "tell" && (goal.status === "done" || goal.status === "failed"))
            .map((goal) => `- ${goal.status === "failed" ? "failed" : "done"}: ${goal.title}${goal.outcome ? ` — ${goal.outcome}` : ""}`)
            .join("\n");
        const plainly = list.filter((goal) => goal.outcome).map((goal) => goal.outcome).slice(-3).join(" ") || chapter.description;
        const next = all.find((other) => other.index === chapter.index + 1 && other.status === "ahead") ?? null;

        if (!next) {
            const summary = await summarizeChapter(ctx, {
                bookTitle: book.title, chapterTitle: chapter.title, playerName: book.playerName, happened,
            }).catch(() => plainly);
            await db.update(chapters).set({ status: "closed", summary: summary.slice(0, 600) }).where(eq(chapters.id, chapter.id));
            await db.update(books).set({ status: "completed" }).where(eq(books.id, book.id));
            await chronicle(book, {
                kind: "chapter", importance: 6, regionId: book.currentRegionId,
                summary: `The last chapter, "${chapter.title}", ended, and with it the tale of ${book.playerName}.`,
            });
            const closed = { ...chapter, status: "closed" as const, summary };
            return {
                ...(await stepOf(book.id, [], null)),
                closedChapter: chapterViews([closed])[0],
                newChapter: null,
                chapters: chapterViews(await chaptersOf(book.id)),
                storyCompleted: true,
            };
        }

        // written as of the chapter to come: the bible says which stage the story is at
        const moved: Book = { ...book, arcStage: next.stage };
        const keys = await worldKeys(moved);
        const room = await freeSide(book.id);
        const plan = await writeGoals(ctx, {
            brief: await planBrief(moved, keys),
            chapter: next,
            after: after(all, next),
            closing: { index: chapter.index, title: chapter.title },
            mend: null,
            room: room !== null,
        });

        const summary = (plan.closingSummary?.trim() || plainly).slice(0, 600);
        await db.update(chapters).set({ status: "closed", summary }).where(eq(chapters.id, chapter.id));
        const [opened] = await db.update(chapters).set({ status: "open" }).where(eq(chapters.id, next.id)).returning();
        await db.update(books).set({ arcStage: next.stage }).where(eq(books.id, book.id));
        await applyPlan(ctx, moved, opened, plan, keys, 0, standingTell(
            `Chapter ${next.index} begins`,
            `Set the chapter going: ${next.description}`,
        ));
        await chronicle(moved, {
            kind: "chapter", importance: 5, regionId: book.currentRegionId,
            summary: `The chapter "${chapter.title}" ended: ${summary}`,
        });

        // the first pages of the new chapter; if the storyteller stumbles here the chapter has still turned,
        // and the pages are written when the book is next asked to move on
        const pages = await work(ctx, book.id).catch((error) => {
            console.error("[story] the first pages of the chapter could not be written", error);
            return [] as Told[];
        });
        const chaptersNow = await chaptersOf(book.id);
        return {
            ...(await stepOf(book.id, pages, null)),
            closedChapter: chapterViews([{ ...chapter, status: "closed", summary }])[0],
            newChapter: chapterViews([opened])[0],
            chapters: chapterViews(chaptersNow),
            storyCompleted: false,
        };
    } finally {
        await release(bookIn.id);
    }
}

/* ------------------------------------------------------------------ */
/* goals the hero settles by walking                                   */
/* ------------------------------------------------------------------ */

/** the hero has stepped into a region: if going there was the goal in hand, it is done */
export async function arrive(book: Book, region: Region, firstVisit: boolean): Promise<GoalSettled | null> {
    if (firstVisit) {
        await chronicle(book, {
            kind: "arrival", importance: 3, regionId: region.id,
            summary: `${book.playerName} reached ${region.name} for the first time.`,
        });
    }
    const goal = await goalInHand(book.id);
    if (!goal || goal.kind !== "visit" || goal.targetRegionId !== region.id) return null;
    return settle(book, goal, "done", `${book.playerName} reached ${region.name}.`);
}

/** the hero has walked up to the building or landmark a goal sent them to */
export async function reach(book: Book, goalId: string): Promise<ReachResult> {
    const goal = await goalInHand(book.id);
    const state = await storyState(book);
    if (!goal || goal.id !== goalId || goal.kind !== "visit" || !state.beacon) return { story: state, settled: null };
    if (state.beacon.regionId !== book.currentRegionId) throw new Error("That is somewhere else.");
    // generous: the hero keeps walking while the request is in flight
    if (Math.hypot(book.x - state.beacon.x, book.z - state.beacon.z) > state.beacon.radius + 5) throw new Error("A little closer.");
    const settled = await settle(book, goal, "done", `${book.playerName} came to ${state.beacon.name}.`);
    return { story: await storyState(await reload(book.id)), settled };
}
