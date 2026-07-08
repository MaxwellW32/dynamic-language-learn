import "server-only";
import { db } from "@/db";
import {
    challengeAttempts, storyPacks, vocabWords, wordProgress,
    type Story, type VocabWord, type WordProgress,
} from "@/db/schema";
import { INITIAL_SRS, masteryLevel, passiveExposure, reviewCorrect, reviewWrong } from "@/game/srs";
import { and, asc, count, eq, gte, inArray, isNull, lte, notInArray } from "drizzle-orm";

export type PlannedWord = { word: VocabWord; purpose: "introduce" | "review" };

/**
 * The immersion ladder: how much target language the prose may carry,
 * earned by demonstrated retention (words answered correctly at least twice).
 * Thresholds are deliberately far apart — the book stops translating for you
 * slowly, so each step up feels like growth, not a wall.
 */
export type ImmersionLevel = 0 | 1 | 2 | 3;

const IMMERSION_THRESHOLDS: [number, ImmersionLevel][] = [
    [120, 3], // Storyteller
    [50, 2],  // Speaker
    [15, 1],  // Wanderer
];

export async function getImmersionLevel(userId: string, storyId: string): Promise<ImmersionLevel> {
    const packIds = await packIdsForStory(storyId);
    if (packIds.length === 0) return 0;
    const [{ retained }] = await db
        .select({ retained: count() })
        .from(wordProgress)
        .innerJoin(vocabWords, eq(wordProgress.wordId, vocabWords.id))
        .where(and(
            eq(wordProgress.userId, userId),
            inArray(vocabWords.packId, packIds),
            gte(wordProgress.reps, 2),
        ));
    for (const [threshold, level] of IMMERSION_THRESHOLDS) {
        if (retained >= threshold) return level;
    }
    return 0;
}

/** scene word budgets grow gently with the ladder */
export function planCountsFor(level: ImmersionLevel, context: "narration" | "dialogue"): { introduce: number; review: number } {
    if (context === "narration") {
        return { introduce: 1, review: 2 + level };
    }
    return { introduce: level >= 2 ? 3 : 2, review: 3 + level };
}

async function packIdsForStory(storyId: string): Promise<string[]> {
    const rows = await db.query.storyPacks.findMany({ where: eq(storyPacks.storyId, storyId) });
    return rows.map((r) => r.packId);
}

/**
 * The single gateway for "which words should appear now": new words come from
 * the story's packs in pack order; reviews are whatever the SRS says is due.
 */
export async function buildVocabPlan(
    userId: string,
    story: Story,
    counts: { introduce: number; review: number },
): Promise<PlannedWord[]> {
    const packIds = await packIdsForStory(story.id);
    if (packIds.length === 0) return [];

    const reviews = counts.review > 0 ? await db
        .select({ word: vocabWords })
        .from(wordProgress)
        .innerJoin(vocabWords, eq(wordProgress.wordId, vocabWords.id))
        .where(and(
            eq(wordProgress.userId, userId),
            inArray(vocabWords.packId, packIds),
            lte(wordProgress.dueAt, new Date()),
        ))
        .orderBy(asc(wordProgress.dueAt))
        .limit(counts.review) : [];

    const introductions = counts.introduce > 0 ? await db
        .select({ word: vocabWords })
        .from(vocabWords)
        .leftJoin(wordProgress, and(
            eq(wordProgress.wordId, vocabWords.id),
            eq(wordProgress.userId, userId),
        ))
        .where(and(
            inArray(vocabWords.packId, packIds),
            isNull(wordProgress.id),
        ))
        .orderBy(asc(vocabWords.sortIndex))
        .limit(counts.introduce) : [];

    return [
        ...introductions.map(({ word }) => ({ word, purpose: "introduce" as const })),
        ...reviews.map(({ word }) => ({ word, purpose: "review" as const })),
    ];
}

/** extra words to fill an encounter or serve as distractors */
export async function samplePackWords(storyId: string, excludeIds: string[], limit: number): Promise<VocabWord[]> {
    const packIds = await packIdsForStory(storyId);
    if (packIds.length === 0) return [];
    return db.query.vocabWords.findMany({
        where: and(
            inArray(vocabWords.packId, packIds),
            excludeIds.length > 0 ? notInArray(vocabWords.id, excludeIds) : undefined,
        ),
        orderBy: [asc(vocabWords.sortIndex)],
        limit,
    });
}

async function getOrCreateProgress(userId: string, wordId: string): Promise<WordProgress> {
    const existing = await db.query.wordProgress.findFirst({
        where: and(eq(wordProgress.userId, userId), eq(wordProgress.wordId, wordId)),
    });
    if (existing) return existing;
    const [created] = await db.insert(wordProgress)
        .values({ userId, wordId, ...INITIAL_SRS, dueAt: new Date() })
        .onConflictDoNothing()
        .returning();
    if (created) return created;
    // lost a race — the row exists now
    const row = await db.query.wordProgress.findFirst({
        where: and(eq(wordProgress.userId, userId), eq(wordProgress.wordId, wordId)),
    });
    if (!row) throw new Error("word progress unavailable");
    return row;
}

/**
 * Record one challenge answer: SRS update + attempt log.
 * Returns whether this was the word's first-ever correct answer (drives
 * learnWords quest objectives).
 */
export async function recordChallengeOutcome(userId: string, outcome: {
    wordId: string;
    correct: boolean;
    challengeType: string;
    storyId?: string;
    encounterId?: string;
    answerGiven?: string;
}): Promise<{ firstTimeLearned: boolean }> {
    const progress = await getOrCreateProgress(userId, outcome.wordId);
    const now = new Date();
    const next = outcome.correct ? reviewCorrect(progress, now) : reviewWrong(progress, now);
    const firstTimeLearned = outcome.correct && progress.timesCorrect === 0;

    await Promise.all([
        db.update(wordProgress).set({
            reps: next.reps,
            lapses: next.lapses,
            ease: next.ease,
            intervalDays: next.intervalDays,
            dueAt: next.dueAt,
            lastReviewedAt: now,
            timesSeen: next.timesSeen,
            timesCorrect: next.timesCorrect,
        }).where(eq(wordProgress.id, progress.id)),
        db.insert(challengeAttempts).values({
            userId,
            wordId: outcome.wordId,
            storyId: outcome.storyId,
            encounterId: outcome.encounterId,
            challengeType: outcome.challengeType,
            correct: outcome.correct,
            answerGiven: outcome.answerGiven,
        }),
    ]);

    return { firstTimeLearned };
}

/** a vocab segment was rendered/tapped while reading — light touch, no scheduling */
export async function recordExposure(userId: string, wordIds: string[]): Promise<void> {
    await Promise.all([...new Set(wordIds)].map(async (wordId) => {
        const progress = await getOrCreateProgress(userId, wordId);
        const next = passiveExposure(progress);
        await db.update(wordProgress)
            .set({ timesSeen: next.timesSeen })
            .where(eq(wordProgress.id, progress.id));
    }));
}

export type SatchelWord = {
    id: string;
    term: string;
    meaning: string;
    pronunciation: string | null;
    mastery: number;
    due: boolean;
};

/** the hero's word-hoard, for the journal UI */
export async function getSatchel(userId: string, storyId: string): Promise<SatchelWord[]> {
    const packIds = await packIdsForStory(storyId);
    if (packIds.length === 0) return [];
    const rows = await db
        .select({ word: vocabWords, progress: wordProgress })
        .from(wordProgress)
        .innerJoin(vocabWords, eq(wordProgress.wordId, vocabWords.id))
        .where(and(eq(wordProgress.userId, userId), inArray(vocabWords.packId, packIds)))
        .orderBy(asc(vocabWords.sortIndex));

    const now = Date.now();
    return rows.map(({ word, progress }) => ({
        id: word.id,
        term: word.term,
        meaning: word.meaning,
        pronunciation: word.pronunciation,
        mastery: masteryLevel(progress),
        due: progress.dueAt.getTime() <= now,
    }));
}
