import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, encounters, enemies, regions, type Book, type Encounter, type Enemy, type Goal } from "@/db/schema";
import {
    generateStages, gradeStage, stageCountForTier,
    type ChallengeType, type Submission,
} from "@/game/challenges";
import type { AnswerResult, EncounterView, GoalSettled } from "@/game/payloads";
import { withinInteractRange } from "@/game/worldgen/layout";
import { chronicle } from "./chronicle";
import { cardsFor } from "./dictionary";
import { goalInHand, settle, storyState } from "./goals";
import { addXp, distractorsFor, planWords, recordAnswer, toChallengeWord } from "./learning";
import { langOf } from "./narration";

export const MAX_HEARTS = 3;
const XP_PER_ANSWER = 10;
const XP_FOR_VICTORY: Record<Enemy["tier"], number> = { minion: 20, elite: 45, boss: 150 };

/** the goal in hand, if it is to best this creature */
async function fightFor(bookId: string, enemyId: string): Promise<Goal | null> {
    const goal = await goalInHand(bookId);
    return goal && goal.kind === "fight" && goal.targetEnemyId === enemyId ? goal : null;
}

function view(encounter: Encounter, enemy: Enemy, atStake: string | null): EncounterView {
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
        atStake,
    };
}

export async function getActiveEncounter(book: Pick<Book, "id">): Promise<EncounterView | null> {
    const active = await db.query.encounters.findFirst({
        where: and(eq(encounters.bookId, book.id), eq(encounters.status, "active")),
        with: { enemy: true },
    });
    return active ? view(active, active.enemy, (await fightFor(book.id, active.enemyId))?.title ?? null) : null;
}

/** the hero backs away mid-battle; the creature stays where it is, and nothing is lost by it */
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
    return view(encounter, enemy, (await fightFor(book.id, enemy.id))?.title ?? null);
}

/** what was answered, as kept in the record of attempts; a text column cannot hold a NUL */
function describeSubmission(submission: Submission): string {
    return answered(submission).replace(/\u0000/g, "").slice(0, 300);
}

function answered(submission: Submission): string {
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

/**
 * Grade one answer on the server; every answer feeds the schedule. When the
 * battle was the goal in hand, its end settles the goal: won, or lost. Being
 * driven back is an ending too, and the story goes on from it.
 */
export async function submitAnswer(book: Book, encounterId: string, submission: Submission): Promise<AnswerResult> {
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
    const enemy = encounter.enemy;
    let victory: AnswerResult["victory"] = null;
    let settled: GoalSettled | null = null;

    if (status === "won") {
        xp += XP_FOR_VICTORY[enemy.tier];
        await db.update(enemies).set({ status: "defeated", defeatedAt: new Date() }).where(eq(enemies.id, enemy.id));
        const goal = await fightFor(book.id, enemy.id);
        if (goal) {
            settled = await settle(book, goal, "done", `${book.playerName} bested ${enemy.name} in a battle of words.`);
        } else {
            await chronicle(book, {
                kind: "victory", regionId: enemy.regionId,
                importance: enemy.tier === "boss" ? 9 : enemy.tier === "elite" ? 5 : 2,
                summary: `${book.playerName} bested ${enemy.name} in a battle of words.`,
            });
        }
        // every word asked in the battle, first-time ones marked: the victory screen shows what was practised
        const asked = [...new Set(encounter.stages.flatMap((s) => s.wordIds))];
        victory = {
            defeatLine: enemy.defeatLine,
            learned: await cardsFor(await learnedInBattle(book.userId, encounter.id, asked, learnedIds)),
        };
    } else if (status === "retreated") {
        const goal = await fightFor(book.id, enemy.id);
        if (goal) settled = await settle(book, goal, "failed", `${enemy.name} drove ${book.playerName} back.`);
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
        settled,
        story: status === "active" ? null : await storyState(await db.query.books.findFirst({ where: eq(books.id, book.id) }) ?? book),
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
