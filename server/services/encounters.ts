import "server-only";
import { db } from "@/db";
import {
    encounters, enemies, events, type Encounter, type Enemy, type Story,
} from "@/db/schema";
import {
    generateStages, gradeStage, stageCountForTier,
    type ChallengeType, type ChallengeWord, type Submission,
} from "@/game/challenges";
import type { AnswerResult, EncounterView } from "@/game/payloads";
import { withinInteractRange } from "@/game/geometry";
import { and, eq } from "drizzle-orm";
import { ensureExamples } from "../ai/examples";
import { generateNarration } from "../ai/narrator";
import { offerWords, resolveSegments } from "../ai/segments";
import { buildVocabPlan, getImmersionLevel, recordChallengeOutcome, samplePackWords } from "./learning";
import { sceneBrief, wordEntriesFor } from "./scene";
import { applyProgress, isChapterTurnReady } from "./quests";
import { appendVictoryPassage, chronicleBrief } from "./story";

const POOL_SIZE = 12;

function toChallengeWord(w: { id: string; term: string; meaning: string; pronunciation: string | null; exampleTarget: string | null; exampleNative: string | null }): ChallengeWord {
    return {
        id: w.id, term: w.term, meaning: w.meaning,
        pronunciation: w.pronunciation, exampleTarget: w.exampleTarget, exampleNative: w.exampleNative,
    };
}

function view(encounter: Encounter, enemy: Enemy): EncounterView {
    const stage = encounter.status === "active" ? encounter.stages[encounter.stageIndex] ?? null : null;
    return {
        id: encounter.id,
        enemy: { id: enemy.id, name: enemy.name, tier: enemy.tier, spriteKey: enemy.spriteKey },
        introLine: enemy.introLine,
        hearts: encounter.hearts,
        stageIndex: encounter.stageIndex,
        totalStages: encounter.stages.length,
        stage: stage ? stage.client : null,
        words: [],
    };
}

export async function getActiveEncounter(story: Story): Promise<EncounterView | null> {
    const active = await db.query.encounters.findFirst({
        where: and(eq(encounters.storyId, story.id), eq(encounters.status, "active")),
        with: { enemy: true },
    });
    return active ? view(active, active.enemy) : null;
}

/** the player slips away mid-battle; the enemy stays on the map */
export async function fleeEncounter(story: Story, encounterId: string): Promise<void> {
    await db.update(encounters)
        .set({ status: "retreated", endedAt: new Date() })
        .where(and(
            eq(encounters.id, encounterId),
            eq(encounters.storyId, story.id),
            eq(encounters.status, "active"),
        ));
}

/**
 * Begin a battle: build the stage plan from the vocab planner (reviews first —
 * combat is where due words come back). Answers stay in the DB.
 */
export async function startEncounter(userId: string, story: Story, enemyId: string): Promise<EncounterView> {
    const existing = await getActiveEncounter(story);
    if (existing) return existing;

    const enemy = await db.query.enemies.findFirst({ where: eq(enemies.id, enemyId) });
    if (!enemy || enemy.storyId !== story.id || enemy.status !== "alive") {
        throw new Error("There is nothing to face here.");
    }
    if (enemy.mapId !== story.currentMapId || !withinInteractRange({ x: story.x, y: story.y }, enemy)) {
        throw new Error("Get closer before you challenge it.");
    }

    const plan = await buildVocabPlan(userId, story, { introduce: 3, review: 8 });
    let pool = plan.map((p) => p.word);
    if (pool.length < POOL_SIZE) {
        pool = [...pool, ...await samplePackWords(story.id, pool.map((w) => w.id), POOL_SIZE - pool.length)];
    }
    if (pool.length === 0) throw new Error("Your word packs are empty — add words before battling.");

    const types = enemy.challengeTypes as ChallengeType[];
    if (types.includes("fillBlank") || types.includes("sentenceOrder")) {
        pool = await ensureExamples(pool.slice(0, 8), story.nativeLanguage, story.targetLanguage)
            .then((withExamples) => [...withExamples, ...pool.slice(8)]);
    }

    const stages = generateStages({
        words: pool.map(toChallengeWord),
        distractorPool: pool.map(toChallengeWord),
        allowedTypes: types,
        stageCount: Math.min(stageCountForTier(enemy.tier), Math.max(1, pool.length)),
    });
    if (stages.length === 0) throw new Error("The challenge could not take shape. Try again.");

    const [encounter] = await db.insert(encounters).values({
        storyId: story.id,
        enemyId: enemy.id,
        stages,
    }).returning();

    return view(encounter, enemy);
}

/** grade one answer server-side; every answer feeds the SRS */
export async function submitAnswer(
    userId: string,
    story: Story,
    encounterId: string,
    submission: Submission,
): Promise<AnswerResult> {
    const encounter = await db.query.encounters.findFirst({
        where: eq(encounters.id, encounterId),
        with: { enemy: true },
    });
    if (!encounter || encounter.storyId !== story.id || encounter.status !== "active") {
        throw new Error("This battle is over.");
    }
    const stage = encounter.stages[encounter.stageIndex];
    if (!stage) throw new Error("This battle is over.");

    const grade = gradeStage(stage, submission);

    let firstTimeLearned = 0;
    for (const { wordId, correct } of grade.perWord) {
        const outcome = await recordChallengeOutcome(userId, {
            wordId,
            correct,
            challengeType: stage.type,
            storyId: story.id,
            encounterId: encounter.id,
            answerGiven: "value" in submission ? String(submission.value) : undefined,
        });
        if (outcome.firstTimeLearned) firstTimeLearned++;
    }

    const hearts = grade.correct ? encounter.hearts : encounter.hearts - 1;
    const nextIndex = encounter.stageIndex + 1;
    const outOfHearts = hearts <= 0;
    const cleared = !outOfHearts && nextIndex >= encounter.stages.length;
    const status = outOfHearts ? "retreated" as const : cleared ? "won" as const : "active" as const;

    await db.update(encounters).set({
        hearts,
        stageIndex: nextIndex,
        status,
        endedAt: status === "active" ? null : new Date(),
    }).where(eq(encounters.id, encounter.id));

    const questUpdates = firstTimeLearned > 0
        ? await applyProgress(story, { kind: "learnWords", count: firstTimeLearned })
        : [];

    let victory: AnswerResult["victory"] = null;
    if (status === "won") {
        await db.update(enemies).set({ status: "defeated" }).where(eq(enemies.id, encounter.enemyId));
        await db.insert(events).values({
            storyId: story.id,
            kind: "victory",
            summary: `${story.playerName} bested ${encounter.enemy.name} in a battle of words.`,
            mapId: story.currentMapId,
        });
        questUpdates.push(...await applyProgress(story, { kind: "defeat", targetEnemyId: encounter.enemyId }));

        victory = {
            defeatLine: encounter.enemy.defeatLine,
            passage: null,
            words: [],
            questUpdates,
            chapterTurnReady: await isChapterTurnReady(story),
        };
        try {
            const immersionLevel = await getImmersionLevel(userId, story.id);
            const offer = offerWords(await buildVocabPlan(userId, story, { introduce: 0, review: 2 }));
            const narration = await generateNarration({
                story,
                kind: "victory",
                sceneBrief: await sceneBrief(story),
                chronicleBrief: await chronicleBrief(story.id),
                recentPassages: "(mid-battle)",
                focus: `The hero just defeated ${encounter.enemy.name} (${encounter.enemy.description}).`,
                offer,
                immersionLevel,
            });
            const segments = resolveSegments(narration.passage, offer);
            victory.passage = await appendVictoryPassage(story, segments);
            victory.words = await wordEntriesFor([segments]);
        } catch {
            // the win stands even if the narrator stumbles
        }
    }

    return {
        correct: grade.correct,
        correctAnswer: grade.correctAnswer,
        hearts,
        status,
        stageIndex: nextIndex,
        stage: status === "active" ? encounter.stages[nextIndex]?.client ?? null : null,
        victory,
    };
}
