import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { studySessions, type DictEntry, type StudySession } from "@/db/schema";
import {
    generateStages, gradeStage,
    type ChallengeType, type StoredStage, type Submission,
} from "@/game/challenges";
import type { LangCode } from "@/game/languages";
import type { StudyAnswer, StudyView } from "@/game/payloads";
import { cardsFor } from "./dictionary";
import { CONTENT_POS, addXp, distractorsFor, planWords, recordAnswer, toChallengeWord } from "./learning";

/*
 * The study hall: review sessions built from the same challenge registry as
 * battles, with no model calls at all. The stage plan — answers included —
 * lives in study_sessions.stages and never leaves the server.
 */

/**
 * Speaking needs a microphone the player may not have granted; a study
 * session should never stall on it. Listening only needs the speech cache.
 */
const STUDY_TYPES: ChallengeType[] = [
    "meaningMatch", "reverseMatch", "matching", "spelling", "fillBlank", "sentenceOrder", "listening",
];
const DEFAULT_SIZE = 10;
const XP_PER_CORRECT = 5;
const XP_FOR_FINISHING = 10;
const MAX_GLOSS = 60;

/**
 * Due reviews first; then the words the player met most recently; then new
 * words from the frequency list. A few more than the stage count, because a
 * matching stage uses four words at once.
 */
async function wordsForStudy(userId: string, lang: LangCode, size: number): Promise<DictEntry[]> {
    const want = size + 3;
    const chosen: DictEntry[] = (await planWords(userId, lang, { introduce: 0, review: want })).map((p) => p.entry);
    const lemmas = new Set(chosen.map((e) => e.lemma.toLowerCase()));
    const add = (entries: DictEntry[]) => {
        for (const entry of entries) {
            if (chosen.length >= want) break;
            const key = entry.lemma.toLowerCase();
            if (lemmas.has(key)) continue;
            lemmas.add(key);
            chosen.push(entry);
        }
    };

    if (chosen.length < want) {
        const ids = chosen.map((e) => e.id);
        const recent = (await db.execute<DictEntry>(sql`
            select e.* from word_progress w join dict_entries e on e.id = w."entryId"
            where w."userId" = ${userId} and w.lang = ${lang}
              and e.teachable and length(e.gloss) <= ${MAX_GLOSS}
              and e.pos = any(${sql.param(CONTENT_POS)}::text[])
              and e.id <> all(${sql.param(ids.length > 0 ? ids : [0])}::int[])
            order by w."createdAt" desc
            limit ${want * 2}`)).rows;
        add(recent);
    }
    if (chosen.length < want) {
        // a player who has met nothing yet starts from the most common words
        const fresh = await planWords(userId, lang, { introduce: want - chosen.length + 4, review: 0 });
        add(fresh.map((p) => p.entry));
    }
    return chosen;
}

/** cards the client may hold: only for stages already answered, so no card can give an answer away */
async function answeredCards(stages: StoredStage[], index: number) {
    return cardsFor(stages.slice(0, index).flatMap((s) => s.wordIds));
}

async function viewOf(session: StudySession): Promise<StudyView> {
    const index = Math.min(session.stageIndex, session.stages.length);
    return {
        id: session.id,
        lang: session.lang,
        index,
        total: session.stages.length,
        stage: session.finished ? null : session.stages[index]?.client ?? null,
        words: await answeredCards(session.stages, index),
    };
}

export async function startStudy(userId: string, lang: LangCode, size = DEFAULT_SIZE): Promise<StudyView> {
    const stageCount = Math.max(1, Math.min(Math.floor(size), 30));
    const entries = await wordsForStudy(userId, lang, stageCount);
    if (entries.length === 0) throw new Error("There are no words to study in this language yet.");

    const pool = await distractorsFor(lang, entries, 12);
    const stages = generateStages({
        words: entries.map(toChallengeWord),
        distractorPool: pool.map(toChallengeWord),
        allowedTypes: STUDY_TYPES,
        stageCount,
    });
    if (stages.length === 0) throw new Error("Could not build a study session from these words.");

    const [session] = await db.insert(studySessions).values({ userId, lang, stages }).returning();
    return viewOf(session);
}

/** only the owner ever sees a session; anyone else gets null, exactly as if it did not exist */
export async function getStudy(userId: string, sessionId: string): Promise<StudyView | null> {
    const session = await db.query.studySessions.findFirst({
        where: and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)),
    });
    return session ? viewOf(session) : null;
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

export async function answerStudy(userId: string, sessionId: string, submission: Submission): Promise<StudyAnswer> {
    const session = await db.query.studySessions.findFirst({
        where: and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)),
    });
    if (!session) throw new Error("Study session not found.");
    if (session.finished) throw new Error("This study session is already finished.");

    const index = session.stageIndex;
    const stage = session.stages[index];
    if (!stage) throw new Error("This study session has no stage left to answer.");

    const grade = gradeStage(stage, submission);
    const nextIndex = index + 1;
    const done = nextIndex >= session.stages.length;
    const correctCount = session.correctCount + (grade.correct ? 1 : 0);
    const stages = session.stages.map((s, i) => (i === index ? { ...s, result: { correct: grade.correct, learnedIds: [] as number[] } } : s));

    // claim the stage first: a double-submitted answer finds the index moved on and changes nothing
    const claimed = await db.update(studySessions)
        .set({ stageIndex: nextIndex, correctCount, finished: done, stages })
        .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId), eq(studySessions.stageIndex, index)))
        .returning({ id: studySessions.id });
    if (claimed.length === 0) throw new Error("That stage was already answered.");

    const learnedIds: number[] = [];
    const answerGiven = describeSubmission(submission);
    for (const { wordId, correct } of grade.perWord) {
        const { firstTimeLearned } = await recordAnswer(userId, {
            entryId: wordId,
            lang: session.lang,
            correct,
            challengeType: stage.type,
            context: "study",
            answerGiven,
        });
        if (firstTimeLearned) learnedIds.push(wordId);
    }
    if (learnedIds.length > 0) {
        stages[index] = { ...stages[index], result: { correct: grade.correct, learnedIds } };
        await db.update(studySessions).set({ stages }).where(eq(studySessions.id, sessionId));
    }

    const xp = (grade.correct ? XP_PER_CORRECT : 0) + (done ? XP_FOR_FINISHING : 0);
    // finishing counts toward the streak even on a bad day
    if (xp > 0) await addXp(userId, session.lang as LangCode, xp);

    const [taught, learned] = await Promise.all([
        cardsFor(stage.wordIds),
        done ? cardsFor(stages.flatMap((s) => s.result?.learnedIds ?? [])) : Promise.resolve([]),
    ]);

    return {
        correct: grade.correct,
        exact: grade.exact,
        correctAnswer: grade.correctAnswer,
        taught,
        index: nextIndex,
        total: session.stages.length,
        stage: done ? null : stages[nextIndex].client,
        done,
        xp,
        summary: done ? { correct: correctCount, total: session.stages.length, learned } : null,
    };
}
