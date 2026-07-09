import "server-only";
import { db } from "@/db";
import {
    characters, enemies, questObjectives, quests, type QuestObjective, type Story,
} from "@/db/schema";
import type { ObjectiveTag, QuestUpdate, QuestView } from "@/game/payloads";
import { and, asc, eq, inArray } from "drizzle-orm";

export type ProgressTrigger =
    | { kind: "talkTo"; targetCharacterId: string }
    /** persuasion is judged per-objective by the character AI, so it names the objective */
    | { kind: "persuade"; targetCharacterId: string; objectiveId: string }
    | { kind: "defeat"; targetEnemyId: string }
    | { kind: "visit"; targetMapId: string }
    | { kind: "learnWords"; count: number };

/**
 * Apply a gameplay trigger to every matching active objective. Returns
 * human-readable updates for the UI and marks quests complete when their
 * last objective closes.
 */
export async function applyProgress(story: Story, trigger: ProgressTrigger): Promise<QuestUpdate[]> {
    const activeQuests = await db.query.quests.findMany({
        where: and(eq(quests.storyId, story.id), eq(quests.status, "active")),
        with: { objectives: true },
    });

    const updates: QuestUpdate[] = [];

    for (const quest of activeQuests) {
        let questChanged = false;

        for (const objective of quest.objectives) {
            if (objective.status !== "active" || objective.kind !== trigger.kind) continue;

            const matches =
                trigger.kind === "talkTo"
                    ? objective.targetCharacterId === trigger.targetCharacterId
                    : trigger.kind === "persuade"
                        ? objective.id === trigger.objectiveId
                        : trigger.kind === "defeat"
                            ? objective.targetEnemyId === trigger.targetEnemyId
                            : trigger.kind === "visit"
                                ? objective.targetMapId === trigger.targetMapId
                                : true; // learnWords matches any learnWords objective

            if (!matches) continue;

            const increment = trigger.kind === "learnWords" ? trigger.count : 1;
            const progress = Math.min(objective.targetCount, objective.progress + increment);
            const completed = progress >= objective.targetCount;

            await db.update(questObjectives).set({
                progress,
                status: completed ? "completed" : "active",
            }).where(eq(questObjectives.id, objective.id));

            objective.progress = progress;
            objective.status = completed ? "completed" : "active";
            questChanged = true;

            if (completed) {
                updates.push({
                    questTitle: quest.title,
                    objectiveDescription: objective.description,
                    questCompleted: false,
                });
            }
        }

        if (questChanged && quest.objectives.every((o) => o.status === "completed")) {
            await db.update(quests).set({ status: "completed" }).where(eq(quests.id, quest.id));
            const last = updates[updates.length - 1];
            if (last && last.questTitle === quest.title) last.questCompleted = true;
            else updates.push({ questTitle: quest.title, objectiveDescription: "", questCompleted: true });
        }
    }

    return updates;
}

/**
 * A persuasion was definitively refused: the objective and its quest fail.
 * Nothing blocks the book — failed quests still let the chapter turn, the
 * chronicle records the refusal, and the next chapter's plan reacts to it.
 */
export async function failObjective(story: Story, objectiveId: string): Promise<QuestUpdate[]> {
    const objective = await db.query.questObjectives.findFirst({
        where: eq(questObjectives.id, objectiveId),
        with: { quest: true },
    });
    if (!objective || objective.quest.storyId !== story.id || objective.status !== "active") return [];

    await db.update(questObjectives).set({ status: "failed" }).where(eq(questObjectives.id, objective.id));
    await db.update(quests).set({ status: "failed" }).where(eq(quests.id, objective.questId));

    return [{
        questTitle: objective.quest.title,
        objectiveDescription: objective.description,
        questCompleted: false,
        failed: true,
    }];
}

/** all quests of the story's current arc stage are done → the page is ready to turn */
export async function isChapterTurnReady(story: Story): Promise<boolean> {
    const stageQuests = await db.query.quests.findMany({
        where: and(eq(quests.storyId, story.id), eq(quests.arcStage, story.arcStage)),
    });
    return stageQuests.length > 0 && stageQuests.every((q) => q.status !== "active");
}

/** the label/tag shown beside each objective; boss battles get their crown */
function objectiveTag(objective: QuestObjective, bossEnemyIds: Set<string>): ObjectiveTag {
    switch (objective.kind) {
        case "talkTo": return { label: "Meet", icon: "💬" };
        case "persuade": return { label: "Convince", icon: "🎭" };
        case "defeat":
            return objective.targetEnemyId && bossEnemyIds.has(objective.targetEnemyId)
                ? { label: "Boss", icon: "👑" }
                : { label: "Battle", icon: "⚔️" };
        case "visit": return { label: "Explore", icon: "🧭" };
        case "learnWords": return { label: "Words", icon: "✨" };
        default: return { label: "Deed", icon: "📜" };
    }
}

export async function getQuestViews(storyId: string): Promise<QuestView[]> {
    const rows = await db.query.quests.findMany({
        where: eq(quests.storyId, storyId),
        orderBy: [asc(quests.sortIndex), asc(quests.createdAt)],
        with: { objectives: { orderBy: [asc(questObjectives.sortIndex)] } },
    });

    const giverIds = [...new Set(rows.flatMap((q) => (q.giverCharacterId ? [q.giverCharacterId] : [])))];
    const enemyIds = [...new Set(rows.flatMap((q) =>
        q.objectives.flatMap((o) => (o.targetEnemyId ? [o.targetEnemyId] : []))))];

    const [givers, targetEnemies] = await Promise.all([
        giverIds.length > 0
            ? db.query.characters.findMany({ where: inArray(characters.id, giverIds) })
            : Promise.resolve([]),
        enemyIds.length > 0
            ? db.query.enemies.findMany({ where: inArray(enemies.id, enemyIds) })
            : Promise.resolve([]),
    ]);
    const giverName = new Map(givers.map((c) => [c.id, c.name]));
    const bossEnemyIds = new Set(targetEnemies.filter((e) => e.tier === "boss").map((e) => e.id));

    return rows.map((q) => ({
        id: q.id,
        title: q.title,
        description: q.description,
        status: q.status,
        giverName: q.giverCharacterId ? giverName.get(q.giverCharacterId) ?? null : null,
        objectives: q.objectives.map((o) => ({
            id: o.id,
            description: o.description,
            kind: o.kind,
            tag: objectiveTag(o, bossEnemyIds),
            status: o.status,
            progress: o.progress,
            targetCount: o.targetCount,
        })),
    }));
}
