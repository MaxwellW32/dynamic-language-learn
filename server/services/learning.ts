import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
    challengeAttempts, learnerProfiles, wordProgress,
    type DictEntry, type LearnerProfile,
} from "@/db/schema";
import type { ChallengeWord } from "@/game/challenges";
import type { LangCode } from "@/game/languages";
import type { LearnerView, SatchelWord } from "@/game/payloads";
import { masteryLevel, reviewCorrect, reviewWrong, type SrsState } from "@/game/srs";
import { toCard, wordsMeaning } from "./dictionary";

/*
 * The learning engine: who knows what, what is due, which words a scene
 * should use, and how far up the immersion ladder the book may climb.
 * Identity always arrives as `userId` from the caller's session.
 */

/* ------------------------------------------------------------------ */
/* the immersion ladder (pure, exported for tests)                     */
/* ------------------------------------------------------------------ */

export type ImmersionLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const IMMERSION_NAMES = ["Newcomer", "Wanderer", "Speaker", "Storyteller", "Voyager", "Immersed"] as const;

/** words a starting level is worth, as if they had already been learned here */
const STARTING_CREDIT = [0, 150, 600, 1500];
/** frequency ranks a starting level is assumed to know already — never introduced */
const STARTING_BASELINE = [0, 300, 1200, 3000];
/** effective known words needed for each immersion level */
const IMMERSION_THRESHOLDS = [0, 20, 80, 250, 700, 1800];

/** parts of speech that carry meaning on their own; a lone preposition in English prose teaches nothing */
export const CONTENT_POS = ["noun", "verb", "adj", "adv", "intj", "num", "phrase", "word"];

/**
 * The kinds of word that read naturally as a single foreign word inside a
 * sentence of the reader's own language: "she hands you a warm pan" works,
 * "can you decir where she is" does not. Verbs and adverbs are taught in
 * battles and the study hall from the start, and join the prose once the
 * book is writing whole sentences in the target language.
 */
export const EMBEDDABLE_POS = ["noun", "adj", "intj", "num", "phrase", "word"];
/** the last immersion level at which prose is still mostly in the reader's own language */
export const EMBED_UNTIL = 1;

/** freshly met words come back within the same session */
const FIRST_REVIEW_MS = 10 * 60 * 1000;
/** a gloss longer than this is a definition, not a meaning a challenge can show */
const MAX_GLOSS = 60;

const clampLevel = (n: number) => Math.max(0, Math.min(3, Math.round(n)));
const clampBias = (n: number) => Math.max(-1, Math.min(1, Math.round(n)));

export function immersionFor(known: number, startingLevel: number, bias: number): { level: ImmersionLevel; toNext: number } {
    const effective = known + STARTING_CREDIT[clampLevel(startingLevel)];
    let base = 0;
    for (let level = IMMERSION_THRESHOLDS.length - 1; level >= 0; level--) {
        if (effective >= IMMERSION_THRESHOLDS[level]) {
            base = level;
            break;
        }
    }
    const level = Math.max(0, Math.min(5, base + clampBias(bias))) as ImmersionLevel;
    if (level === 5 || base === 5) return { level, toNext: 1 };
    const from = IMMERSION_THRESHOLDS[base];
    const to = IMMERSION_THRESHOLDS[base + 1];
    return { level, toNext: Math.max(0, Math.min(1, (effective - from) / (to - from))) };
}

/** yyyy-mm-dd in UTC */
export function utcDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** the streak after studying on `today`, given the last day studied */
export function nextStreak(lastStudyDay: string | null, streakDays: number, today: Date): number {
    const todayKey = utcDay(today);
    const yesterdayKey = utcDay(new Date(today.getTime() - 24 * 60 * 60 * 1000));
    if (lastStudyDay === todayKey) return Math.max(1, streakDays);
    if (lastStudyDay === yesterdayKey) return streakDays + 1;
    return 1;
}

/**
 * Keep one entry per headword across a plan, in the order given (reviews,
 * then scene words, then introductions — each list already best-ranked
 * first), and never anything unteachable or with an essay for a gloss.
 */
export function dedupeByLemma<T extends { entry: Pick<DictEntry, "id" | "lemma" | "teachable" | "gloss"> }>(items: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
        const { lemma, teachable, gloss } = item.entry;
        if (!teachable || gloss.length > MAX_GLOSS) continue;
        const key = lemma.normalize("NFC").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* the learner profile                                                 */
/* ------------------------------------------------------------------ */

export async function getLearner(
    userId: string,
    lang: LangCode,
    init?: { startingLevel?: number; immersionBias?: number },
): Promise<LearnerProfile> {
    const existing = await db.query.learnerProfiles.findFirst({
        where: and(eq(learnerProfiles.userId, userId), eq(learnerProfiles.lang, lang)),
    });
    if (existing) return existing;
    // two first visits at once: one insert wins, the other reads what it wrote
    const [created] = await db.insert(learnerProfiles).values({
        userId,
        lang,
        startingLevel: clampLevel(init?.startingLevel ?? 0),
        immersionBias: clampBias(init?.immersionBias ?? 0),
    }).onConflictDoNothing().returning();
    if (created) return created;
    const again = await db.query.learnerProfiles.findFirst({
        where: and(eq(learnerProfiles.userId, userId), eq(learnerProfiles.lang, lang)),
    });
    if (!again) throw new Error("Could not create the learner profile.");
    return again;
}

export async function updateLearner(
    userId: string,
    lang: LangCode,
    patch: { startingLevel?: number; immersionBias?: number },
): Promise<LearnerProfile> {
    await getLearner(userId, lang, patch);
    const set: Partial<Pick<LearnerProfile, "startingLevel" | "immersionBias">> = {};
    if (patch.startingLevel !== undefined) set.startingLevel = clampLevel(patch.startingLevel);
    if (patch.immersionBias !== undefined) set.immersionBias = clampBias(patch.immersionBias);
    if (Object.keys(set).length === 0) return getLearner(userId, lang);
    const [row] = await db.update(learnerProfiles).set(set)
        .where(and(eq(learnerProfiles.userId, userId), eq(learnerProfiles.lang, lang)))
        .returning();
    return row;
}

/** the SQL test for "known": recognised twice in a row, or produced twice */
const KNOWN = sql`(${wordProgress.reps} >= 2 or ${wordProgress.timesProduced} >= 2)`;

export async function knownWordCount(userId: string, lang: LangCode): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(wordProgress)
        .where(and(eq(wordProgress.userId, userId), eq(wordProgress.lang, lang), KNOWN));
    return row?.n ?? 0;
}

/**
 * What the ladder needs, in one round trip: the profile's settings and the
 * known-word count. A first visit creates the profile (a rarer, slower path).
 */
async function learnerState(userId: string, lang: LangCode): Promise<{ startingLevel: number; immersionBias: number; known: number }> {
    const result = await db.execute<{ startingLevel: number; immersionBias: number; known: number }>(sql`
        select p."startingLevel", p."immersionBias",
               (select count(*)::int from word_progress w
                where w."userId" = p."userId" and w.lang = p.lang
                  and (w.reps >= 2 or w."timesProduced" >= 2)) as known
        from learner_profiles p
        where p."userId" = ${userId} and p.lang = ${lang}`);
    const row = result.rows[0];
    if (row) return row;
    const [profile, known] = await Promise.all([getLearner(userId, lang), knownWordCount(userId, lang)]);
    return { startingLevel: profile.startingLevel, immersionBias: profile.immersionBias, known };
}

export async function getImmersion(userId: string, lang: LangCode): Promise<ImmersionLevel> {
    const state = await learnerState(userId, lang);
    return immersionFor(state.known, state.startingLevel, state.immersionBias).level;
}

export async function getLearnerView(userId: string, lang: LangCode): Promise<LearnerView> {
    const [profile, [counts]] = await Promise.all([
        getLearner(userId, lang),
        db.select({
            met: sql<number>`count(*)::int`,
            known: sql<number>`(count(*) filter (where ${KNOWN}))::int`,
            due: sql<number>`(count(*) filter (where ${wordProgress.dueAt} <= now()))::int`,
        }).from(wordProgress).where(and(eq(wordProgress.userId, userId), eq(wordProgress.lang, lang))),
    ]);
    const { level, toNext } = immersionFor(counts.known, profile.startingLevel, profile.immersionBias);
    return {
        lang,
        immersion: level,
        immersionName: IMMERSION_NAMES[level],
        wordsMet: counts.met,
        wordsKnown: counts.known,
        wordsDue: counts.due,
        xp: profile.xp,
        streakDays: profile.streakDays,
        toNext,
        immersionBias: profile.immersionBias,
    };
}

/* ------------------------------------------------------------------ */
/* the vocab planner                                                   */
/* ------------------------------------------------------------------ */

export type PlannedWord = { entry: DictEntry; purpose: "introduce" | "review" | "scene" };

/**
 * The single gateway for "which words should appear now": due reviews, then
 * words that fit the scene, then the next most common words the player has
 * not met. Four queries at most, however many words are asked for.
 */
export async function planWords(
    userId: string,
    lang: LangCode,
    opts: {
        introduce: number; review: number; scene?: number; sceneKeys?: string[]; contentOnly?: boolean;
        /**
         * The words are for weaving into prose one at a time. While the
         * reader is a beginner that prose is in their own language, and only
         * some kinds of word survive being dropped into it (see EMBEDDABLE_POS).
         */
        embed?: boolean;
    },
): Promise<PlannedWord[]> {
    const introduce = Math.max(0, Math.floor(opts.introduce));
    const review = Math.max(0, Math.floor(opts.review));
    const scene = Math.max(0, Math.floor(opts.scene ?? 0));

    const profile = await learnerState(userId, lang);
    const needsImmersion = scene > 0 && (opts.sceneKeys?.length ?? 0) > 0;
    const immersion = immersionFor(profile.known, profile.startingLevel, profile.immersionBias).level;

    const pos = opts.embed && immersion <= EMBED_UNTIL ? EMBEDDABLE_POS
        : opts.contentOnly === false ? null : CONTENT_POS;
    const posFilter = pos ? sql`and e.pos = any(${sql.param(pos)}::text[])` : sql``;

    // extra rows so that dropping repeated headwords still fills each quota
    const [reviews, sceneWords, fresh] = await Promise.all([
        review === 0 ? [] : db.execute<DictEntry>(sql`
            select e.* from word_progress w join dict_entries e on e.id = w."entryId"
            where w."userId" = ${userId} and w.lang = ${lang} and w."dueAt" <= now()
              and e.teachable and length(e.gloss) <= ${MAX_GLOSS} ${posFilter}
              and lower(e.lemma) <> lower(e.gloss)
            order by w."dueAt" asc
            limit ${review * 2 + 4}`).then((r) => r.rows),
        // a place's theme words name things: "bread" should find the loaf, not the verb "to bread"
        !needsImmersion ? [] : wordsMeaning(lang, opts.sceneKeys!, {
            maxLevel: immersion + 2,
            pos: lang === "zh" ? ["noun", "word"] : ["noun"],
            teachableOnly: true,
            limit: scene * 3 + 4,
            excludeKnownBy: userId,
        }),
        introduce === 0 ? [] : db.execute<DictEntry>(sql`
            select e.* from dict_entries e
            where e.lang = ${lang} and e.teachable and e."freqRank" > ${STARTING_BASELINE[clampLevel(profile.startingLevel)]}
              and length(e.gloss) <= ${MAX_GLOSS} ${posFilter}
              -- a word that is the same in both languages (oh, no, radio) needs no teaching
              and lower(e.lemma) <> lower(e.gloss)
              and not exists (
                  select 1 from word_progress w join dict_entries seen on seen.id = w."entryId"
                  where w."userId" = ${userId} and seen.lang = e.lang and seen.lemma = e.lemma)
            order by e."freqRank" asc
            limit ${introduce * 2 + 8}`).then((r) => r.rows),
    ]);

    const plan: PlannedWord[] = [];
    const taken = new Set<string>();
    const take = (entries: DictEntry[], purpose: PlannedWord["purpose"], quota: number) => {
        let count = 0;
        for (const item of dedupeByLemma(entries.map((entry) => ({ entry })))) {
            if (count === quota) break;
            const key = item.entry.lemma.normalize("NFC").toLowerCase();
            if (taken.has(key)) continue;
            taken.add(key);
            plan.push({ entry: item.entry, purpose });
            count++;
        }
    };
    take(reviews, "review", review);
    // wordsMeaning already takes turns between the scene's meanings, most common first within each
    take(sceneWords, "scene", scene);
    take(fresh, "introduce", introduce);
    return plan;
}

/**
 * Wrong options for choice challenges: teachable words of similar frequency
 * and the same kinds of word, whose meanings differ from the words asked.
 */
export async function distractorsFor(lang: LangCode, entries: DictEntry[], count: number): Promise<DictEntry[]> {
    if (count <= 0) return [];
    const ids = entries.map((e) => e.id);
    const maxRank = Math.max(0, ...entries.map((e) => e.freqRank ?? 0));
    const ceiling = Math.max(800, maxRank * 2);
    const posList = [...new Set(entries.map((e) => e.pos))];
    const pos = posList.length > 0 ? posList : CONTENT_POS;
    const rows = (await db.execute<DictEntry>(sql`
        select e.* from dict_entries e
        where e.lang = ${lang} and e.teachable and e."freqRank" <= ${ceiling}
          and e.pos = any(${sql.param(pos)}::text[])
          and e.id <> all(${sql.param(ids.length > 0 ? ids : [0])}::int[])
          and length(e.gloss) <= ${MAX_GLOSS}
        order by random()
        limit ${count * 3 + 6}`)).rows;

    const glosses = new Set(entries.map((e) => e.gloss.toLowerCase()));
    const lemmas = new Set(entries.map((e) => e.lemma.toLowerCase()));
    const out: DictEntry[] = [];
    for (const row of rows) {
        const gloss = row.gloss.toLowerCase();
        const lemma = row.lemma.toLowerCase();
        if (glosses.has(gloss) || lemmas.has(lemma)) continue;
        glosses.add(gloss);
        lemmas.add(lemma);
        out.push(row);
        if (out.length === count) break;
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* evidence: seen, recognised, produced                                */
/* ------------------------------------------------------------------ */

/**
 * The words appeared in text the player read. One statement for the whole
 * list: missing rows are created (due in ten minutes, so freshly met words
 * come up in the same session), existing rows count one more sighting.
 * Ids from another language are ignored.
 */
export async function recordExposure(userId: string, lang: LangCode, entryIds: number[]): Promise<void> {
    const ids = [...new Set(entryIds.filter((id) => Number.isInteger(id)))];
    if (ids.length === 0) return;
    await db.execute(sql`
        insert into word_progress (id, "userId", "entryId", lang, "timesSeen", "dueAt")
        select gen_random_uuid()::text, ${userId}, e.id, e.lang, 1, now() + ${`${FIRST_REVIEW_MS / 1000} seconds`}::interval
        from dict_entries e
        where e.id = any(${sql.param(ids)}::int[]) and e.lang = ${lang}
        on conflict ("userId", "entryId") do update set "timesSeen" = word_progress."timesSeen" + 1`);
}

type ProgressRow = typeof wordProgress.$inferSelect;

function srsOf(row: ProgressRow): SrsState {
    return {
        reps: row.reps,
        lapses: row.lapses,
        ease: row.ease,
        intervalDays: row.intervalDays,
        dueAt: row.dueAt,
        timesSeen: row.timesSeen,
        timesCorrect: row.timesCorrect,
    };
}

/**
 * Make sure a progress row exists for each entry (of this language) and lock
 * them for the rest of the transaction, so two answers arriving at once are
 * applied one after the other instead of both reading the old state.
 */
async function lockProgress(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    lang: string,
    ids: number[],
): Promise<Map<number, ProgressRow>> {
    await tx.execute(sql`
        insert into word_progress (id, "userId", "entryId", lang, "dueAt")
        select gen_random_uuid()::text, ${userId}, e.id, e.lang, now()
        from dict_entries e
        where e.id = any(${sql.param(ids)}::int[]) and e.lang = ${lang}
        on conflict ("userId", "entryId") do nothing`);
    const rows = await tx.select().from(wordProgress)
        .where(and(eq(wordProgress.userId, userId), sql`${wordProgress.entryId} = any(${sql.param(ids)}::int[])`))
        .orderBy(wordProgress.entryId)
        .for("update");
    return new Map(rows.map((row) => [row.entryId, row]));
}

/** a challenge was answered: move the schedule and keep the attempt */
export async function recordAnswer(userId: string, a: {
    entryId: number;
    lang: string;
    correct: boolean;
    challengeType: string;
    context: "battle" | "study";
    bookId?: string;
    answerGiven?: string;
}): Promise<{ firstTimeLearned: boolean }> {
    const now = new Date();
    return db.transaction(async (tx) => {
        const rows = await lockProgress(tx, userId, a.lang, [a.entryId]);
        const row = rows.get(a.entryId);
        if (!row) throw new Error(`Unknown ${a.lang} dictionary entry ${a.entryId}.`);

        const next = a.correct ? reviewCorrect(srsOf(row), now) : reviewWrong(srsOf(row), now);
        await tx.update(wordProgress).set({ ...next, lastReviewedAt: now }).where(eq(wordProgress.id, row.id));
        await tx.insert(challengeAttempts).values({
            userId,
            bookId: a.bookId ?? null,
            entryId: a.entryId,
            lang: a.lang,
            challengeType: a.challengeType,
            context: a.context,
            correct: a.correct,
            answerGiven: a.answerGiven?.slice(0, 500) ?? null,
        });
        return { firstTimeLearned: a.correct && row.timesCorrect === 0 };
    });
}

/**
 * The player wrote or said these words themselves, correctly — the strongest
 * evidence there is. It counts as a correct review, but only when the word was
 * due (or never reviewed): using a word five times in one conversation should
 * not push its next review months away.
 */
export async function recordProduction(userId: string, lang: LangCode, entryIds: number[]): Promise<{ firstTimeLearned: number[] }> {
    const ids = [...new Set(entryIds.filter((id) => Number.isInteger(id)))];
    if (ids.length === 0) return { firstTimeLearned: [] };
    const now = new Date();
    return db.transaction(async (tx) => {
        const rows = await lockProgress(tx, userId, lang, ids);
        const updates = [...rows.values()].map((row) => {
            const reviewNow = row.reps === 0 || row.dueAt.getTime() <= now.getTime();
            const next = reviewNow ? reviewCorrect(srsOf(row), now) : srsOf(row);
            return { row, next, reviewed: reviewNow };
        });
        // the same test a battle uses: never got right before, got right now
        const firstTimeLearned = updates.filter((u) => u.reviewed && u.row.timesCorrect === 0).map((u) => u.row.entryId);
        if (updates.length === 0) return { firstTimeLearned };
        await tx.execute(sql`
            update word_progress w set
                reps = u.reps, ease = u.ease, "intervalDays" = u.interval, "dueAt" = u.due,
                "timesSeen" = u.seen, "timesCorrect" = u.correct,
                "timesProduced" = w."timesProduced" + 1,
                "lastReviewedAt" = case when u.reviewed then ${now.toISOString()}::timestamp else w."lastReviewedAt" end
            from unnest(
                ${sql.param(updates.map((u) => u.row.id))}::text[],
                ${sql.param(updates.map((u) => u.next.reps))}::int[],
                ${sql.param(updates.map((u) => u.next.ease))}::real[],
                ${sql.param(updates.map((u) => u.next.intervalDays))}::real[],
                ${sql.param(updates.map((u) => u.next.dueAt.toISOString()))}::timestamp[],
                ${sql.param(updates.map((u) => u.next.timesSeen))}::int[],
                ${sql.param(updates.map((u) => u.next.timesCorrect))}::int[],
                ${sql.param(updates.map((u) => u.reviewed))}::boolean[]
            ) as u(id, reps, ease, interval, due, seen, correct, reviewed)
            where w.id = u.id`);
        return { firstTimeLearned };
    });
}

/** the player tapped "collect" (or un-collected) a word */
export async function collectWord(userId: string, lang: LangCode, entryId: number, collected: boolean): Promise<void> {
    await db.execute(sql`
        insert into word_progress (id, "userId", "entryId", lang, collected, "dueAt")
        select gen_random_uuid()::text, ${userId}, e.id, e.lang, ${collected}, now()
        from dict_entries e where e.id = ${entryId} and e.lang = ${lang}
        on conflict ("userId", "entryId") do update set collected = excluded.collected`);
}

/* ------------------------------------------------------------------ */
/* the satchel (the player's word book)                                */
/* ------------------------------------------------------------------ */

export async function getSatchel(
    userId: string,
    lang: LangCode,
    opts: { limit?: number; filter?: "all" | "due" | "collected" | "learning" | "mastered" } = {},
): Promise<SatchelWord[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
    const filter = opts.filter ?? "all";
    // "mastered" is the top of the 0–5 scale in game/srs.ts masteryLevel
    const where =
        filter === "due" ? sql`and w."dueAt" <= now()` :
        filter === "collected" ? sql`and w.collected` :
        filter === "mastered" ? sql`and w.reps > 0 and w."intervalDays" >= 35` :
        filter === "learning" ? sql`and not (w.reps > 0 and w."intervalDays" >= 35)` :
        sql``;
    const order = filter === "due" ? sql`w."dueAt" asc` : sql`coalesce(w."lastReviewedAt", w."createdAt") desc`;

    // "due" is decided by the database clock, the same one every other due check uses
    const rows = (await db.execute<DictEntry & {
        p_reps: number; p_interval: number; p_due: boolean; p_collected: boolean; p_seen: number;
    }>(sql`
        select e.*, w.reps as p_reps, w."intervalDays" as p_interval, (w."dueAt" <= now()) as p_due,
               w.collected as p_collected, w."timesSeen" as p_seen
        from word_progress w join dict_entries e on e.id = w."entryId"
        where w."userId" = ${userId} and w.lang = ${lang} ${where}
        order by ${order}
        limit ${limit}`)).rows;

    return rows.map(({ p_reps, p_interval, p_due, p_collected, p_seen, ...entry }) => ({
        ...toCard(entry),
        mastery: masteryLevel({ reps: p_reps, intervalDays: p_interval }),
        due: p_due,
        collected: p_collected,
        timesSeen: p_seen,
    }));
}

/* ------------------------------------------------------------------ */
/* xp and streak                                                       */
/* ------------------------------------------------------------------ */

/** one statement, so two awards at once cannot lose either */
export async function addXp(userId: string, lang: LangCode, amount: number): Promise<{ xp: number; streakDays: number }> {
    await getLearner(userId, lang);
    const now = new Date();
    const today = utcDay(now);
    const yesterday = utcDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const gain = Math.max(0, Math.floor(amount));
    const [row] = await db.update(learnerProfiles).set({
        xp: sql`${learnerProfiles.xp} + ${gain}`,
        streakDays: sql`case
            when ${learnerProfiles.lastStudyDay} = ${today} then greatest(${learnerProfiles.streakDays}, 1)
            when ${learnerProfiles.lastStudyDay} = ${yesterday} then ${learnerProfiles.streakDays} + 1
            else 1 end`,
        lastStudyDay: today,
    })
        .where(and(eq(learnerProfiles.userId, userId), eq(learnerProfiles.lang, lang)))
        .returning({ xp: learnerProfiles.xp, streakDays: learnerProfiles.streakDays });
    return row;
}

/* ------------------------------------------------------------------ */
/* entries → challenge words                                           */
/* ------------------------------------------------------------------ */

/** the example a cloze or ordering challenge uses: the first sense's, else any */
function exampleOf(entry: DictEntry): { t: string; n: string } | null {
    for (const sense of entry.senses ?? []) {
        const example = sense.ex?.find((ex) => ex.t && ex.t.trim().length > 0);
        if (example) return example;
    }
    return null;
}

export function toChallengeWord(entry: DictEntry): ChallengeWord {
    const example = exampleOf(entry);
    return {
        id: entry.id,
        lemma: entry.lemma,
        gloss: entry.gloss,
        reading: entry.reading,
        roman: entry.roman,
        exampleTarget: example ? example.t.trim() : null,
        exampleNative: example?.n ? example.n.trim() : null,
        lang: entry.lang,
    };
}
