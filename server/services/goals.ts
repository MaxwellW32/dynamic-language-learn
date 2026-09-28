import "server-only";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
    books, buildings, chapters, characters, enemies, goals, landmarks, regions,
    type Book, type Chapter, type Goal, type GoalMove,
} from "@/db/schema";
import { checklist, isSpoken, whatIsDue, type GoalKind } from "@/game/goals";
import type { Beacon, ChapterView, GoalSettled, GoalView, ShownGoalKind, StoryDue, StoryState } from "@/game/payloads";
import { doorstep } from "@/game/worldgen/spots";
import { outlineOf } from "../ai/prompts/rulebook";
import type { GoalSketch } from "../ai/schemas";
import { bringOnstage, movePerson } from "./cast";
import { chronicle } from "./chronicle";
import type { WorldRefs } from "./scene";
import { regionOfGoal } from "./scene";

/**
 * A chapter's goals: written all at once, taken one at a time, and settled
 * one way or the other. What is due at any moment is decided by `whatIsDue`
 * (game/goals.ts); this file reads and writes the rows.
 */

/** a chapter holds at most this many goals at a writing, however many the planner would like */
const MAX_GOALS = 12;
/** the hero's pockets are not bottomless, and neither is a prompt */
const MAX_BELONGINGS = 12;

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

export async function chaptersOf(bookId: string): Promise<Chapter[]> {
    return db.query.chapters.findMany({ where: eq(chapters.bookId, bookId), orderBy: [asc(chapters.index)] });
}

/** the chapter being played; a book that has been told to its end has its last chapter in hand, closed */
export function chapterInHand(all: Chapter[]): Chapter | null {
    return all.find((chapter) => chapter.status === "open")
        ?? (all.some((chapter) => chapter.status === "ahead") ? null : all[all.length - 1] ?? null);
}

export async function goalsOf(chapterId: string): Promise<Goal[]> {
    return db.query.goals.findMany({ where: eq(goals.chapterId, chapterId), orderBy: [asc(goals.sortIndex)] });
}

export async function goalInHand(bookId: string): Promise<Goal | null> {
    return await db.query.goals.findFirst({ where: and(eq(goals.bookId, bookId), eq(goals.status, "active")) }) ?? null;
}

export function chapterViews(all: Chapter[]): ChapterView[] {
    return all
        .filter((chapter) => chapter.status !== "ahead")
        .map((chapter) => ({
            id: chapter.id, index: chapter.index, title: chapter.title, summary: chapter.summary,
            open: chapter.status === "open",
        }));
}

export async function outlineText(bookId: string): Promise<string> {
    return outlineOf(await chaptersOf(bookId));
}

/* ------------------------------------------------------------------ */
/* writing goals down                                                  */
/* ------------------------------------------------------------------ */

/**
 * Turn what the planner sketched into rows, dropping whatever points at
 * nothing real, at the place the hero will already be standing in, or at the
 * boss before its time. Returns how many were kept.
 */
export async function persistGoals(
    book: Pick<Book, "id" | "currentRegionId">,
    chapter: Pick<Chapter, "id" | "stage">,
    sketches: GoalSketch[],
    refs: WorldRefs,
    /** the goals are added after this index */
    after: number,
): Promise<number> {
    type Row = typeof goals.$inferInsert;
    const rows: Row[] = [];
    /** where the hero will be standing when each goal comes due */
    let at = book.currentRegionId;
    let previous: { kind: GoalKind; target: string | null } | null = null;

    for (const sketch of sketches.slice(0, MAX_GOALS + 4)) {
        if (rows.length >= MAX_GOALS) break;
        const title = sketch.title.trim().replace(/\.$/, "").slice(0, 90);
        const brief = sketch.brief.trim().slice(0, 600);
        if (title.length === 0) continue;

        const target: Partial<Row> = {};
        let where: string | null = at;
        const key = sketch.targetKey?.trim() ?? "";

        if (sketch.kind === "visit") {
            const place = refs.places.get(key);
            const house = refs.houses.get(key);
            const thing = refs.things.get(key);
            if (place) {
                // nobody can be sent to where they already are
                if (place.id === at) continue;
                target.targetRegionId = place.id;
                where = place.id;
            } else if (house) {
                target.targetBuildingId = house.id;
                where = house.regionId;
            } else if (thing) {
                target.targetLandmarkId = thing.id;
                where = thing.regionId;
            } else continue;
        } else if (sketch.kind === "talk" || sketch.kind === "persuade") {
            const who = refs.people.get(key);
            if (!who || who.status !== "alive" || !who.regionId) continue;
            target.targetCharacterId = who.id;
            where = who.regionId;
        } else if (sketch.kind === "fight") {
            const what = refs.creatures.get(key);
            if (!what) continue;
            if (what.tier === "boss" && chapter.stage !== "climax") continue;
            target.targetEnemyId = what.id;
            where = what.regionId;
        } else if (sketch.kind === "examine") {
            const thing = refs.things.get(key);
            if (!thing) continue;
            target.targetLandmarkId = thing.id;
            where = thing.regionId;
        }

        const pointsAt = target.targetCharacterId ?? target.targetEnemyId ?? target.targetRegionId
            ?? target.targetBuildingId ?? target.targetLandmarkId ?? null;
        // the same thing asked twice running is a mistake, not a story
        if (previous && pointsAt !== null && previous.kind === sketch.kind && previous.target === pointsAt) continue;

        const moves = sketch.moves.slice(0, 4).flatMap((move): GoalMove[] => {
            const who = refs.people.get(move.who.trim());
            if (!who) return [];
            if (move.to.trim().toLowerCase() === "gone") return [{ characterId: who.id, toRegionId: null }];
            const to = refs.places.get(move.to.trim());
            return to ? [{ characterId: who.id, toRegionId: to.id }] : [];
        });
        const enters = sketch.enters.flatMap((name) => {
            const who = refs.people.get(name.trim());
            return who ? [who.id] : [];
        });

        rows.push({
            bookId: book.id,
            chapterId: chapter.id,
            sortIndex: after + 1 + rows.length,
            kind: sketch.kind,
            title,
            brief,
            gains: sketch.gains?.trim().slice(0, 120) || null,
            enters,
            moves,
            ...target,
        });
        at = where;
        if (sketch.kind !== "tell") previous = { kind: sketch.kind, target: pointsAt };
    }

    if (rows.length > 0) await db.insert(goals).values(rows);
    return rows.length;
}

/** the tell that is always possible: given to a chapter, or to a mended road, when nothing the planner wrote survived */
export function standingTell(title: string, brief: string): GoalSketch {
    return { kind: "tell", title, brief, targetKey: null, gains: null, enters: [], moves: [] };
}

/* ------------------------------------------------------------------ */
/* taking goals in hand, and settling them                             */
/* ------------------------------------------------------------------ */

/**
 * A goal's turn has come. Whoever it brings into the story steps on stage,
 * and whatever it points at is made sure to be there: a creature that was
 * bested while nothing turned on it is back, and will not wander off again.
 */
async function activate(goal: Goal): Promise<Goal | null> {
    const [row] = await db.update(goals)
        .set({ status: "active", activatedAt: new Date() })
        .where(and(eq(goals.id, goal.id), eq(goals.status, "waiting")))
        .returning();
    if (!row) return null;

    await bringOnstage([...row.enters, ...(row.targetCharacterId ? [row.targetCharacterId] : [])]);
    if (row.kind === "fight" && row.targetEnemyId) {
        await db.update(enemies)
            .set({ status: "alive", defeatedAt: null, respawns: false })
            .where(eq(enemies.id, row.targetEnemyId));
    }
    return row;
}

/**
 * Put the next goal in hand, if none is. A goal that asks the hero to go
 * where they already stand is done the moment it comes due.
 */
export async function handNext(book: Book, chapterId: string): Promise<void> {
    for (let guard = 0; guard < MAX_GOALS; guard++) {
        const due = whatIsDue(await goalsOf(chapterId));
        if (due.what !== "next") return;
        const goal = await activate(due.goal);
        if (!goal) return;
        if (goal.kind !== "visit" || goal.targetRegionId === null || goal.targetRegionId !== book.currentRegionId) return;
        await settle(book, goal, "done", "", { quiet: true });
    }
}

/** what a goal changes once it is done: what the hero now carries, and who has gone where */
async function takeEffect(book: Pick<Book, "id">, goal: Goal): Promise<void> {
    if (goal.gains) {
        const gained = goal.gains;
        const fresh = await db.query.books.findFirst({ where: eq(books.id, book.id), columns: { belongings: true } });
        const had = fresh?.belongings ?? [];
        if (!had.some((thing) => thing.toLowerCase() === gained.toLowerCase())) {
            await db.update(books).set({ belongings: [...had, gained].slice(-MAX_BELONGINGS) }).where(eq(books.id, book.id));
        }
    }
    for (const move of goal.moves) await movePerson(book.id, move.characterId, move.toRegionId);
}

/**
 * A tell has been told: its page is in the book. The storyteller's words move
 * nothing by themselves, so what the page said happened is made to happen
 * here: whoever it brought in steps on stage, what it gave is given, whom it
 * sent elsewhere goes.
 */
export async function told(book: Pick<Book, "id">, goal: Goal, passageId: string): Promise<void> {
    const [row] = await db.update(goals)
        .set({ status: "done", passageId, settledAt: new Date(), activatedAt: goal.activatedAt ?? new Date() })
        .where(and(eq(goals.id, goal.id), eq(goals.bookId, book.id), inArray(goals.status, ["active", "waiting"])))
        .returning();
    if (!row) return;
    await bringOnstage(row.enters);
    await takeEffect(book, row);
}

const WEIGHT: Record<GoalKind, { done: number; failed: number }> = {
    tell: { done: 2, failed: 2 },
    visit: { done: 3, failed: 3 },
    examine: { done: 4, failed: 4 },
    talk: { done: 5, failed: 7 },
    persuade: { done: 7, failed: 7 },
    fight: { done: 7, failed: 7 },
};

/**
 * A goal ends, one way or the other. Done: what it gives is given, whom it
 * moves is moved, and the next goal takes its turn. Failed: the goals that
 * were to follow are dropped, and the road waits to be written again.
 *
 * Returns null when the goal was not in hand: it has been settled already,
 * and must not be settled twice.
 */
export async function settle(
    book: Book, goal: Goal, status: "done" | "failed", outcome: string,
    options: { quiet?: boolean; characterId?: string | null } = {},
): Promise<GoalSettled | null> {
    const line = outcome.trim().slice(0, 300);
    const [row] = await db.update(goals)
        .set({ status, outcome: line, settledAt: new Date() })
        .where(and(eq(goals.id, goal.id), eq(goals.status, "active")))
        .returning();
    if (!row) return null;

    if (status === "done") {
        await takeEffect(book, row);
    } else {
        await db.update(goals).set({ status: "dropped" })
            .where(and(eq(goals.chapterId, row.chapterId), eq(goals.status, "waiting"), gt(goals.sortIndex, row.sortIndex)));
    }

    if (!options.quiet && line.length > 0) {
        await chronicle(book, {
            kind: status === "done" ? `goal-${row.kind}` : "goal-failed",
            summary: line,
            importance: WEIGHT[row.kind][status],
            regionId: await regionOfGoal(row) ?? book.currentRegionId,
            characterId: options.characterId ?? row.targetCharacterId,
        });
    }
    if (status === "done") await handNext(book, row.chapterId);
    return { goalId: row.id, title: row.title, status, outcome: line };
}

/* ------------------------------------------------------------------ */
/* what the book remembers of itself                                   */
/* ------------------------------------------------------------------ */

/**
 * The story so far, for whoever writes next: what happened in the chapters
 * behind, and what has come of each goal of the chapter in hand. This, and
 * not a window of recent events, is the book's memory of itself: nothing
 * falls out of it for being long ago.
 */
export async function storySoFar(book: Pick<Book, "id">): Promise<string> {
    const all = await chaptersOf(book.id);
    const inHand = chapterInHand(all);
    const behind = all.filter((chapter) => chapter.status === "closed" && chapter.id !== inHand?.id);
    const list = inHand ? (await goalsOf(inHand.id)).filter((goal) => goal.status === "done" || goal.status === "failed") : [];

    const parts: string[] = [];
    if (behind.length > 0) {
        parts.push(`The chapters behind the hero:\n${behind.map((chapter) =>
            `${chapter.index}. "${chapter.title}": ${chapter.summary.trim() || "(nothing was set down of it)"}`).join("\n")}`);
    }
    if (list.length > 0) {
        parts.push(`In the chapter in hand, so far:\n${list.map((goal) => {
            if (goal.kind === "tell") return `- told: ${goal.title}`;
            const how = goal.outcome || (goal.status === "done" ? "done" : "it did not come off");
            return `- ${goal.status === "failed" ? "FAILED" : "done"}: ${goal.title} — ${how}`;
        }).join("\n")}`);
    }
    return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/* what the reader is shown                                            */
/* ------------------------------------------------------------------ */

const DUE: Record<ReturnType<typeof whatIsDue>["what"], StoryDue> = {
    plan: "plan", next: "page", tell: "page", mend: "bend", turn: "turn", reader: null,
};

/** the names of what a list of goals points at, and the regions that hold them */
async function targetsOf(list: Goal[]): Promise<Map<string, { name: string; regionId: string | null }>> {
    const ids = (pick: (goal: Goal) => string | null) => [...new Set(list.flatMap((goal) => pick(goal) ?? []))];
    const people = ids((g) => g.targetCharacterId);
    const foes = ids((g) => g.targetEnemyId);
    const places = ids((g) => g.targetRegionId);
    const houses = ids((g) => g.targetBuildingId);
    const things = ids((g) => g.targetLandmarkId);
    const [a, b, c, d, e] = await Promise.all([
        people.length ? db.query.characters.findMany({ where: inArray(characters.id, people) }) : [],
        foes.length ? db.query.enemies.findMany({ where: inArray(enemies.id, foes) }) : [],
        places.length ? db.query.regions.findMany({ where: inArray(regions.id, places) }) : [],
        houses.length ? db.query.buildings.findMany({ where: inArray(buildings.id, houses) }) : [],
        things.length ? db.query.landmarks.findMany({ where: inArray(landmarks.id, things) }) : [],
    ]);
    return new Map<string, { name: string; regionId: string | null }>([
        ...a.map((row) => [row.id, { name: row.name, regionId: row.regionId }] as const),
        ...b.map((row) => [row.id, { name: row.name, regionId: row.regionId }] as const),
        ...c.map((row) => [row.id, { name: row.name, regionId: row.id }] as const),
        ...d.map((row) => [row.id, { name: row.name, regionId: row.regionId }] as const),
        ...e.map((row) => [row.id, { name: row.name, regionId: row.regionId }] as const),
    ]);
}

const targetId = (goal: Goal): string | null =>
    goal.targetCharacterId ?? goal.targetEnemyId ?? goal.targetBuildingId ?? goal.targetLandmarkId ?? goal.targetRegionId;

/** where to walk to, for a goal that asks the hero to go to a building or a landmark */
async function beaconFor(goal: Goal | undefined): Promise<Beacon | null> {
    if (!goal || goal.kind !== "visit") return null;
    if (goal.targetBuildingId) {
        const house = await db.query.buildings.findFirst({ where: eq(buildings.id, goal.targetBuildingId) });
        if (!house) return null;
        return { goalId: goal.id, regionId: house.regionId, ...doorstep(house), radius: 4.5, name: house.name };
    }
    if (goal.targetLandmarkId) {
        const thing = await db.query.landmarks.findFirst({ where: eq(landmarks.id, goal.targetLandmarkId) });
        if (!thing) return null;
        return { goalId: goal.id, regionId: thing.regionId, x: thing.x, z: thing.z, radius: 6, name: thing.name };
    }
    return null;
}

export async function storyState(book: Pick<Book, "id" | "status" | "currentRegionId" | "belongings">): Promise<StoryState> {
    const all = await chaptersOf(book.id);
    const inHand = chapterInHand(all);
    const carrying = book.belongings ?? [];
    if (!inHand) {
        return { chapter: { id: "", index: 1, title: "", of: Math.max(1, all.length) }, goals: [], ahead: 0, due: null, beacon: null, carrying };
    }

    const list = await goalsOf(inHand.id);
    const { shown, ahead } = checklist(list);
    const [names, places] = await Promise.all([
        targetsOf(shown),
        db.query.regions.findMany({ where: eq(regions.bookId, book.id) }),
    ]);
    const placeName = new Map(places.map((region) => [region.id, region.name]));

    const views: GoalView[] = shown.map((goal) => {
        const target = names.get(targetId(goal) ?? "");
        const elsewhere = target?.regionId && target.regionId !== book.currentRegionId;
        return {
            id: goal.id,
            kind: goal.kind as ShownGoalKind,
            title: goal.title,
            status: goal.status === "active" ? "active" : goal.status === "failed" ? "failed" : "done",
            outcome: goal.outcome,
            whereName: goal.status === "active" && elsewhere ? placeName.get(target.regionId!) ?? null : null,
            targetName: target?.name ?? null,
        };
    });

    const due = book.status !== "active" ? null : DUE[whatIsDue(list).what];

    return {
        chapter: { id: inHand.id, index: inHand.index, title: inHand.title, of: all.length },
        goals: views,
        ahead,
        due,
        beacon: await beaconFor(list.find((goal) => goal.status === "active")),
        carrying,
    };
}

/* ------------------------------------------------------------------ */
/* what is at stake in a conversation                                  */
/* ------------------------------------------------------------------ */

/** the goal in hand, if it is this person's to settle */
export async function stakeWith(bookId: string, characterId: string): Promise<Goal | null> {
    const goal = await goalInHand(bookId);
    return goal && isSpoken(goal.kind) && goal.targetCharacterId === characterId ? goal : null;
}
