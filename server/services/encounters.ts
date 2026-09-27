import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, encounters, enemies, regions, type Book, type Encounter, type Enemy } from "@/db/schema";
import {
    generateStages, gradeStage, stageCountForTier,
    type ChallengeType, type Submission,
} from "@/game/challenges";
import type { AnswerResult, EncounterView, QuestUpdate } from "@/game/payloads";
import { withinInteractRange } from "@/game/worldgen/layout";
import type { AiContext } from "../ai/client";
import { cardsFor, cardsForSegments } from "./dictionary";
import { chronicle, dueForDirection, runDirector } from "./director";
import { addXp, distractorsFor, planWords, recordAnswer, toChallengeWord } from "./learning";
import { langOf, narrateVictory, questBeat } from "./narration";
import { applyProgress, isChapterTurnReady } from "./quests";

export const MAX_HEARTS = 3;
const XP_PER_ANSWER = 10;
const XP_FOR_VICTORY: Record<Enemy["tier"], number> = { minion: 20, elite: 45, boss: 150 };

function view(encounter: Encounter, enemy: Enemy): EncounterView {
    const stage = encounter.status === "active" ? encounter.stages[encounter.stageIndex] ?? null : null;
    return {
        id: encounter.id,
        enemy: { id: enemy.id, name: enemy.name, tier: enemy.tier, description: enemy.description },
        introLine: enemy.introLine,
        hearts: encounter.hearts,
        maxHearts: MAX_HEARTS,
        stageIndex: encounter.stageIndex,
        totalStages: encounter.stages.length,
        stage: stage ? stage.client : null,
        // no cards up front: a card for a word about to be asked would be the answer
        words: [],
    };
}

export async function getActiveEncounter(book: Pick<Book, "id">): Promise<EncounterView | null> {
    const active = await db.query.encounters.findFirst({
        where: and(eq(encounters.bookId, book.id), eq(encounters.status, "active")),
        with: { enemy: true },
    });
    return active ? view(active, active.enemy) : null;
}

/** the hero backs away mid-battle; the creature stays where it is */
export async function fleeEncounter(book: Pick<Book, "id">, encounterId: string): Promise<void> {
    await db.update(encounters)
        .set({ status: "retreated", endedAt: new Date() })
        .where(and(eq(encounters.id, encounterId), eq(encounters.bookId, book.id), eq(encounters.status, "active")));
}

/**
 * Begin a battle. The stage plan is built from the vocab planner — due words
 * first, because a battle is where a word that is slipping away is caught —
 * and stored with its answers. No model call: a battle costs nothing to fight.
 */
export async function startEncounter(book: Book, enemyId: string): Promise<EncounterView> {
    const existing = await getActiveEncounter(book);
    if (existing) return existing;

    const enemy = await db.query.enemies.findFirst({ where: eq(enemies.id, enemyId) });
    if (!enemy || enemy.bookId !== book.id || enemy.status !== "alive") throw new Error("There is nothing to face here.");
    // generous: a creature that caught the hero has moved since the scene was loaded
    if (enemy.regionId !== book.currentRegionId) throw new Error("It is not here.");
    if (!withinInteractRange({ x: book.x, z: book.z }, enemy, 40)) throw new Error("Get closer before you challenge it.");

    const lang = langOf(book);
    const region = await db.query.regions.findFirst({ where: eq(regions.id, enemy.regionId) });
    const stageCount = stageCountForTier(enemy.tier);

    const planned = await planWords(book.userId, lang, {
        review: stageCount + 3,
        introduce: Math.ceil(stageCount / 2) + 1,
        scene: 2,
        sceneKeys: region?.themeWords ?? [],
    });
    const entries = planned.map((p) => p.entry);
    if (entries.length === 0) throw new Error("There are no words to fight with yet.");

    const pool = await distractorsFor(lang, entries, 12);
    const stages = generateStages({
        words: entries.map(toChallengeWord),
        distractorPool: pool.map(toChallengeWord),
        allowedTypes: enemy.challengeTypes as ChallengeType[],
        stageCount,
    });
    if (stages.length === 0) throw new Error("The challenge could not take shape. Try again.");

    const [encounter] = await db.insert(encounters).values({
        bookId: book.id, enemyId: enemy.id, stages, hearts: MAX_HEARTS,
    }).returning();
    return view(encounter, enemy);
}

function describeSubmission(submission: Submission): string {
    switch (submission.kind) {
        case "choice":
        case "spelling":
            return submission.value;
        case "speak":
            return submission.heard;
        case "order":
            return submission.order.join(",");
        case "matching":
            return submission.pairs.map((p) => `${p.left}=${p.right}`).join(",");
    }
}

/** grade one answer on the server; every answer feeds the schedule */
export async function submitAnswer(ctx: AiContext, book: Book, encounterId: string, submission: Submission): Promise<AnswerResult> {
    const encounter = await db.query.encounters.findFirst({
        where: eq(encounters.id, encounterId),
        with: { enemy: true },
    });
    if (!encounter || encounter.bookId !== book.id || encounter.status !== "active") throw new Error("This battle is over.");
    const index = encounter.stageIndex;
    const stage = encounter.stages[index];
    if (!stage) throw new Error("This battle is over.");

    const lang = langOf(book);
    const grade = gradeStage(stage, submission);
    const hearts = grade.correct ? encounter.hearts : encounter.hearts - 1;
    const nextIndex = index + 1;
    const outOfHearts = hearts <= 0;
    const cleared = !outOfHearts && nextIndex >= encounter.stages.length;
    const status = outOfHearts ? "retreated" as const : cleared ? "won" as const : "active" as const;

    // claim the stage first: a double-submitted answer finds the index moved on and changes nothing
    const claimed = await db.update(encounters)
        .set({ hearts, stageIndex: nextIndex, status, endedAt: status === "active" ? null : new Date() })
        .where(and(eq(encounters.id, encounter.id), eq(encounters.stageIndex, index), eq(encounters.status, "active")))
        .returning({ id: encounters.id });
    if (claimed.length === 0) throw new Error("That was already answered.");

    const learnedIds: number[] = [];
    for (const { wordId, correct } of grade.perWord) {
        const { firstTimeLearned } = await recordAnswer(book.userId, {
            entryId: wordId, lang, correct,
            challengeType: stage.type, context: "battle", bookId: book.id,
            answerGiven: describeSubmission(submission),
        });
        if (firstTimeLearned) learnedIds.push(wordId);
    }

    let xp = grade.correct ? XP_PER_ANSWER : 0;
    const questUpdates: QuestUpdate[] = learnedIds.length > 0
        ? await applyProgress(book, { kind: "learnWords", count: learnedIds.length })
        : [];

    let victory: AnswerResult["victory"] = null;
    if (status === "won") {
        const enemy = encounter.enemy;
        xp += XP_FOR_VICTORY[enemy.tier];
        await db.update(enemies).set({ status: "defeated", defeatedAt: new Date() }).where(eq(enemies.id, enemy.id));
        questUpdates.push(...await applyProgress(book, { kind: "defeat", enemyId: enemy.id }));

        const region = await db.query.regions.findFirst({ where: eq(regions.id, enemy.regionId) });
        const resolved = questUpdates.find((u) => u.questCompleted);
        let passage = null;

        if (region && resolved) {
            const { written, fresh } = await questBeat(ctx, book, region, resolved,
                `${book.playerName} bested ${enemy.name} (${enemy.description}) in a battle of words.`);
            passage = written;
            questUpdates.push(...fresh);
        } else {
            await chronicle(book, {
                kind: "victory", regionId: enemy.regionId,
                importance: enemy.tier === "boss" ? 9 : enemy.tier === "elite" ? 5 : 2,
                summary: `${book.playerName} bested ${enemy.name} in a battle of words.`,
            });
            // an ordinary creature yields with its own line; only the ones that matter get a page
            if (region && enemy.tier !== "minion") {
                passage = await narrateVictory(ctx, book, region,
                    `The hero has just bested ${enemy.name} (${enemy.description}). It yields, saying: "${enemy.defeatLine}"`);
            }
            if (await dueForDirection(book.id)) questUpdates.push(...await runDirector(ctx, book.id));
        }

        // every word asked in the battle, first-time ones marked: the victory screen shows what was practised
        const asked = [...new Set(encounter.stages.flatMap((s) => s.wordIds))];
        const allLearned = await learnedInBattle(book.userId, encounter.id, asked, learnedIds);
        victory = {
            defeatLine: enemy.defeatLine,
            passage: passage?.passage ?? null,
            words: passage ? await cardsForSegments([passage.segments]) : [],
            questUpdates,
            chapterTurnReady: await isChapterTurnReady(book),
            learned: await cardsFor(allLearned),
        };
    }

    if (xp > 0) {
        await addXp(book.userId, lang, xp);
        await db.update(books).set({ xp: sql`${books.xp} + ${xp}` }).where(eq(books.id, book.id));
    }

    return {
        correct: grade.correct,
        exact: grade.exact,
        correctAnswer: grade.correctAnswer,
        taught: await cardsFor(stage.wordIds),
        hearts,
        status,
        stageIndex: nextIndex,
        stage: status === "active" ? encounter.stages[nextIndex]?.client ?? null : null,
        xp,
        victory,
    };
}

/**
 * The words first answered correctly during this battle. Earlier stages'
 * first-time words are found from the attempt log, since each answer is its
 * own request.
 */
async function learnedInBattle(userId: string, encounterId: string, asked: number[], justNow: number[]): Promise<number[]> {
    void encounterId;
    if (asked.length === 0) return justNow;
    const rows = await db.query.wordProgress.findMany({
        where: (w, { and: all, eq: same, inArray: among }) => all(same(w.userId, userId), among(w.entryId, asked)),
    });
    // answered correctly exactly once ever, and that once was in this battle
    const first = rows.filter((w) => w.timesCorrect === 1).map((w) => w.entryId);
    return [...new Set([...justNow, ...first])];
}
