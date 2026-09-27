import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
    books, characters, enemies, landmarks, questObjectives, quests, regions,
    type Book, type Character, type Enemy, type Landmark, type Region,
} from "@/db/schema";
import type { QuestUpdate, QuestView } from "@/game/payloads";
import { liveObjectives } from "@/game/quests";
import type { QuestSketch } from "../ai/schemas";

export type ProgressTrigger =
    | { kind: "talkTo"; characterId: string }
    /** persuasion is judged per objective by the character, so it names the objective */
    | { kind: "persuade"; characterId: string; objectiveId: string }
    | { kind: "defeat"; enemyId: string }
    | { kind: "visit"; regionId: string }
    | { kind: "inspect"; landmarkId: string }
    | { kind: "learnWords"; count: number };

export { liveObjectives };

/**
 * Apply something the hero did to the open objectives it answers — one step
 * of each quest at most. Returns what changed, in words the HUD can show, and
 * closes quests whose last objective has just closed.
 */
export async function applyProgress(book: Pick<Book, "id">, trigger: ProgressTrigger): Promise<QuestUpdate[]> {
    const [open, hero] = await Promise.all([
        db.query.quests.findMany({
            where: and(eq(quests.bookId, book.id), eq(quests.status, "active")),
            with: { objectives: true },
        }),
        db.query.books.findFirst({ where: eq(books.id, book.id), columns: { currentRegionId: true } }),
    ]);

    const updates: QuestUpdate[] = [];
    for (const quest of open) {
        let changed = false;
        const advance = async (objective: (typeof quest.objectives)[number], step: number) => {
            const progress = Math.min(objective.targetCount, objective.progress + step);
            const done = progress >= objective.targetCount;
            await db.update(questObjectives)
                .set({ progress, status: done ? "completed" : "active" })
                .where(eq(questObjectives.id, objective.id));
            objective.progress = progress;
            objective.status = done ? "completed" : "active";
            changed = true;
            if (done) updates.push({ questTitle: quest.title, objectiveDescription: objective.description, questCompleted: false });
        };

        for (const objective of liveObjectives(quest.objectives)) {
            if (objective.kind !== trigger.kind) continue;
            const matches =
                trigger.kind === "talkTo" ? objective.targetCharacterId === trigger.characterId
                : trigger.kind === "persuade" ? objective.id === trigger.objectiveId
                : trigger.kind === "defeat" ? objective.targetEnemyId === trigger.enemyId
                : trigger.kind === "visit" ? objective.targetRegionId === trigger.regionId
                : trigger.kind === "inspect" ? objective.targetLandmarkId === trigger.landmarkId
                : true;
            if (matches) await advance(objective, trigger.kind === "learnWords" ? trigger.count : 1);
        }

        // a step that has just come due may ask for the place the hero is already standing in
        for (let guard = 0; guard < quest.objectives.length; guard++) {
            const due = liveObjectives(quest.objectives).find((o) =>
                o.kind === "visit" && o.targetRegionId !== null && o.targetRegionId === hero?.currentRegionId);
            if (!due) break;
            await advance(due, 1);
        }

        if (changed && quest.objectives.every((o) => o.status === "completed")) {
            await db.update(quests).set({ status: "completed" }).where(eq(quests.id, quest.id));
            const last = updates[updates.length - 1];
            if (last && last.questTitle === quest.title) last.questCompleted = true;
            else updates.push({ questTitle: quest.title, objectiveDescription: "", questCompleted: true });
        }
    }
    return updates;
}

/**
 * A persuasion was refused for good: the objective and its quest fail.
 * Nothing blocks the book — a failed quest still lets the chapter turn, and
 * the next chapter's quests are written knowing of the refusal.
 */
export async function failObjective(book: Pick<Book, "id">, objectiveId: string): Promise<QuestUpdate[]> {
    const objective = await db.query.questObjectives.findFirst({
        where: eq(questObjectives.id, objectiveId),
        with: { quest: true },
    });
    if (!objective || objective.quest.bookId !== book.id || objective.status !== "active") return [];
    await db.update(questObjectives).set({ status: "failed" }).where(eq(questObjectives.id, objective.id));
    await db.update(quests).set({ status: "failed" }).where(eq(quests.id, objective.questId));
    return [{ questTitle: objective.quest.title, objectiveDescription: objective.description, questCompleted: false, failed: true }];
}

/**
 * The hero lets a quest go. It is lost, like one refused for good, and the
 * chapter no longer waits on it: whatever a story asks, a reader must be able
 * to go on without it.
 */
export async function abandonQuest(book: Pick<Book, "id">, questId: string): Promise<QuestUpdate[]> {
    const quest = await db.query.quests.findFirst({ where: and(eq(quests.id, questId), eq(quests.bookId, book.id)) });
    if (!quest || quest.status !== "active") return [];
    await db.update(questObjectives).set({ status: "failed" })
        .where(and(eq(questObjectives.questId, quest.id), eq(questObjectives.status, "active")));
    await db.update(quests).set({ status: "failed" }).where(eq(quests.id, quest.id));
    return [{ questTitle: quest.title, objectiveDescription: "", questCompleted: false, failed: true }];
}

/** every quest of the book's current stage is settled → the page is ready to turn */
export async function isChapterTurnReady(book: Pick<Book, "id" | "arcStage" | "status">): Promise<boolean> {
    if (book.status !== "active") return false;
    const stage = await db.query.quests.findMany({
        where: and(eq(quests.bookId, book.id), eq(quests.arcStage, book.arcStage)),
    });
    return stage.length > 0 && stage.every((q) => q.status !== "active");
}

export async function openQuestCount(bookId: string): Promise<number> {
    const rows = await db.query.quests.findMany({ where: and(eq(quests.bookId, bookId), eq(quests.status, "active")) });
    return rows.length;
}

/* ------------------------------------------------------------------ */
/* keys: how the model refers to things it may point a quest at        */
/* ------------------------------------------------------------------ */

export type QuestRefs = {
    people: Map<string, Character>;
    creatures: Map<string, Enemy>;
    places: Map<string, Region>;
    things: Map<string, Landmark>;
};

/** a chapter holds at most this many quests, however many the story would like to add */
export const MAX_STAGE_QUESTS = 5;

/**
 * The errand that is always possible. A chapter with no quests could never
 * end (see isChapterTurnReady), so when none of what the model sketched
 * survives, the chapter is given this one.
 */
export function standingQuest(title: string): QuestSketch {
    return {
        title,
        description: "The story has turned a page. Walk on, listen, and let its words become yours.",
        giverKey: null,
        objectives: [{ kind: "learnWords", description: "Learn four new words, in battle, in study or in talk.", targetKey: null, wordCount: 4 }],
    };
}

/**
 * Turn what the model sketched into rows, dropping any objective that points
 * at nothing real — or at the place the hero is already standing in (`here`),
 * which cannot be travelled to.
 */
export async function persistQuests(
    bookId: string,
    arcStage: Book["arcStage"],
    sketches: QuestSketch[],
    refs: QuestRefs,
    here: string | null = null,
): Promise<{ created: string[]; defeatTargets: string[] }> {
    type ObjectiveRow = Omit<typeof questObjectives.$inferInsert, "questId">;
    const existing = await db.query.quests.findMany({ where: eq(quests.bookId, bookId) });
    let sortIndex = existing.length;
    const created: string[] = [];
    const defeatTargets: string[] = [];

    for (const sketch of sketches.slice(0, 4)) {
        // the same errand twice is a mistake, not a story
        if (existing.some((q) => q.title.toLowerCase() === sketch.title.trim().toLowerCase())) continue;

        const rows = sketch.objectives.slice(0, 4).flatMap((o, i): ObjectiveRow[] => {
            const base = { description: o.description.trim(), sortIndex: i };
            const key = o.targetKey ?? "";
            if (o.kind === "talkTo" || o.kind === "persuade") {
                const who = refs.people.get(key);
                return who ? [{ ...base, kind: o.kind, targetCharacterId: who.id }] : [];
            }
            if (o.kind === "defeat") {
                const what = refs.creatures.get(key);
                if (what) defeatTargets.push(what.id);
                return what ? [{ ...base, kind: o.kind, targetEnemyId: what.id }] : [];
            }
            if (o.kind === "visit") {
                const where = refs.places.get(key);
                return where && where.id !== here ? [{ ...base, kind: o.kind, targetRegionId: where.id }] : [];
            }
            if (o.kind === "inspect") {
                const thing = refs.things.get(key);
                return thing ? [{ ...base, kind: o.kind, targetLandmarkId: thing.id }] : [];
            }
            return [{ ...base, kind: "learnWords", targetCount: Math.max(3, Math.min(12, o.wordCount ?? 5)) }];
        });
        if (rows.length === 0) continue;

        const giver = sketch.giverKey ? refs.people.get(sketch.giverKey) : undefined;
        const [quest] = await db.insert(quests).values({
            bookId,
            title: sketch.title.trim().slice(0, 80),
            description: sketch.description.trim().slice(0, 400),
            arcStage,
            giverCharacterId: giver?.id ?? null,
            sortIndex: sortIndex++,
        }).returning();
        await db.insert(questObjectives).values(rows.map((row) => ({ ...row, questId: quest.id })));
        created.push(quest.title);
    }

    // a creature a quest depends on must stay defeated once defeated
    if (defeatTargets.length > 0) {
        await db.update(enemies).set({ respawns: false }).where(inArray(enemies.id, defeatTargets));
    }
    return { created, defeatTargets };
}

/* ------------------------------------------------------------------ */
/* for the HUD                                                         */
/* ------------------------------------------------------------------ */

export async function getQuestViews(book: Pick<Book, "id" | "currentRegionId">): Promise<QuestView[]> {
    const rows = await db.query.quests.findMany({
        where: eq(quests.bookId, book.id),
        orderBy: [asc(quests.sortIndex), asc(quests.createdAt)],
        with: { objectives: { orderBy: [asc(questObjectives.sortIndex)] } },
    });
    if (rows.length === 0) return [];

    const [cast, foes, things, places] = await Promise.all([
        db.query.characters.findMany({ where: eq(characters.bookId, book.id) }),
        db.query.enemies.findMany({ where: eq(enemies.bookId, book.id) }),
        db.select({ id: landmarks.id, regionId: landmarks.regionId })
            .from(landmarks).innerJoin(regions, eq(landmarks.regionId, regions.id))
            .where(eq(regions.bookId, book.id)),
        db.query.regions.findMany({ where: eq(regions.bookId, book.id) }),
    ]);
    const nameOf = new Map(cast.map((c) => [c.id, c.name]));
    const placeName = new Map(places.map((r) => [r.id, r.name]));
    const regionOf = new Map<string, string | null>([
        ...cast.map((c) => [c.id, c.regionId] as const),
        ...foes.map((e) => [e.id, e.regionId] as const),
        ...things.map((l) => [l.id, l.regionId] as const),
    ]);

    return rows.map((quest) => ({
        id: quest.id,
        title: quest.title,
        description: quest.description,
        status: quest.status,
        giverName: quest.giverCharacterId ? nameOf.get(quest.giverCharacterId) ?? null : null,
        objectives: quest.objectives.map((o) => {
            const targetRegion = o.targetRegionId
                ?? regionOf.get(o.targetCharacterId ?? o.targetEnemyId ?? o.targetLandmarkId ?? "")
                ?? null;
            return {
                id: o.id,
                description: o.description,
                kind: o.kind,
                status: o.status,
                progress: o.progress,
                targetCount: o.targetCount,
                waiting: o.status === "active" && !liveObjectives(quest.objectives).includes(o),
                // only say where when it is somewhere else
                whereName: targetRegion && targetRegion !== book.currentRegionId ? placeName.get(targetRegion) ?? null : null,
            };
        }),
    }));
}

/** ids that a quest's next step points at, so the world can mark them */
export async function soughtIds(bookId: string): Promise<Set<string>> {
    const open = await db.query.quests.findMany({
        where: and(eq(quests.bookId, bookId), eq(quests.status, "active")),
        with: { objectives: true },
    });
    const ids = new Set<string>();
    for (const quest of open) {
        for (const objective of liveObjectives(quest.objectives)) {
            for (const id of [objective.targetCharacterId, objective.targetEnemyId, objective.targetLandmarkId]) {
                if (id) ids.add(id);
            }
        }
    }
    return ids;
}
