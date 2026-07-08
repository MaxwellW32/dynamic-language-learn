import "server-only";
import { db } from "@/db";
import {
    characters, questObjectives, quests, type Story,
} from "@/db/schema";
import type { QuestUpdate, QuestView } from "@/game/payloads";
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

/** all quests of the story's current arc stage are done → the page is ready to turn */
export async function isChapterTurnReady(story: Story): Promise<boolean> {
    const stageQuests = await db.query.quests.findMany({
        where: and(eq(quests.storyId, story.id), eq(quests.arcStage, story.arcStage)),
    });
    return stageQuests.length > 0 && stageQuests.every((q) => q.status !== "active");
}

export async function getQuestViews(storyId: string): Promise<QuestView[]> {
    const rows = await db.query.quests.findMany({
        where: eq(quests.storyId, storyId),
        orderBy: [asc(quests.sortIndex), asc(quests.createdAt)],
        with: { objectives: { orderBy: [asc(questObjectives.sortIndex)] } },
    });

    const giverIds = [...new Set(rows.flatMap((q) => (q.giverCharacterId ? [q.giverCharacterId] : [])))];
    const givers = giverIds.length > 0
        ? await db.query.characters.findMany({ where: inArray(characters.id, giverIds) })
        : [];
    const giverName = new Map(givers.map((c) => [c.id, c.name]));

    return rows.map((q) => ({
        id: q.id,
        title: q.title,
        description: q.description,
        status: q.status,
        giverName: q.giverCharacterId ? giverName.get(q.giverCharacterId) ?? null : null,
        objectives: q.objectives.map((o) => ({
            id: o.id,
            description: o.description,
            status: o.status,
            progress: o.progress,
            targetCount: o.targetCount,
        })),
    }));
}
