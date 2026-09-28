"use server";

import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, wordProgress } from "@/db/schema";
import { submissionSchema } from "@/game/challenges/types";
import type { WordCard } from "@/game/dictionary";
import type {
    AnswerResult, ChapterTurnResult, ChronicleEntry, DialogueState, DialogueTurnResult, EncounterView,
    ExamineResult, LearnerView, PersonView, ReachResult, SatchelWord, ScenePayload, StoryState, StoryStep, TravelResult,
} from "@/game/payloads";
import { requireBook, requireUser } from "../auth";
import { getPeople } from "../services/cast";
import { getChronicle } from "../services/chronicle";
import { askForAnswer, openDialogue, say } from "../services/dialogue";
import { cardsFor, lookupAll, searchDictionary, toCard } from "../services/dictionary";
import { fleeEncounter, getActiveEncounter, startEncounter, submitAnswer } from "../services/encounters";
import { storyState } from "../services/goals";
import { collectWord, getLearnerView, getSatchel, recordExposure } from "../services/learning";
import { examine, langOf } from "../services/narration";
import { getScene, syncPosition, travel } from "../services/scene";
import { advance, arrive, reach, turnChapter } from "../services/story";
import { isLangCode } from "@/game/languages";
import { attempt, type Result } from "./result";

const id = z.string().min(1).max(64);
const spot = z.object({
    x: z.number().finite().min(-400).max(400),
    z: z.number().finite().min(-400).max(400),
    rot: z.number().finite().optional(),
});
type Spot = z.infer<typeof spot>;

/** where the hero stands, saved now and then — and how long they have been playing */
export async function syncPositionAction(bookId: string, at: Spot, seconds = 0): Promise<Result<true>> {
    return attempt("syncPosition", async () => {
        const { book } = await requireBook(id.parse(bookId));
        await syncPosition(book, spot.parse(at));
        const played = Math.max(0, Math.min(120, Math.round(z.number().finite().parse(seconds))));
        if (played > 0) await db.update(books).set({ playSeconds: sql`${books.playSeconds} + ${played}` }).where(eq(books.id, book.id));
        return true as const;
    });
}

/* ------------------------------------------------------------------ */
/* the story                                                           */
/* ------------------------------------------------------------------ */

/**
 * Let the book do whatever falls to it: tell what is to be told, write the
 * road again after a failure, write a chapter's goals. Asked for whenever the
 * story says something is due (`StoryState.due`).
 */
export async function advanceAction(bookId: string): Promise<Result<StoryStep>> {
    return attempt("advance", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        return advance({ userId, bookId: book.id }, book);
    });
}

export async function turnChapterAction(bookId: string): Promise<Result<ChapterTurnResult>> {
    return attempt("turnChapter", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        return turnChapter({ userId, bookId: book.id }, book);
    });
}

/** the hero has walked up to where a goal sent them */
export async function reachAction(bookId: string, goalId: string, at: Spot): Promise<Result<ReachResult>> {
    return attempt("reach", async () => {
        const { book } = await requireBook(id.parse(bookId));
        const here = await syncPosition(book, spot.parse(at));
        return reach(here, id.parse(goalId));
    });
}

export async function travelAction(bookId: string, gateId: string, at: Spot): Promise<Result<TravelResult>> {
    return attempt("travel", async () => {
        const { book } = await requireBook(id.parse(bookId));
        const here = await syncPosition(book, spot.parse(at));
        const { book: moved, region, firstVisit } = await travel(here, id.parse(gateId));
        const settled = await arrive(moved, region, firstVisit);
        const [scene, story] = await Promise.all([getScene(moved), storyState(moved)]);
        return { scene, story, settled };
    });
}

export async function examineAction(bookId: string, landmarkId: string, at: Spot): Promise<Result<ExamineResult>> {
    return attempt("examine", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        const here = await syncPosition(book, spot.parse(at));
        return examine({ userId, bookId: book.id }, here, id.parse(landmarkId));
    });
}

/** the story and the scene as they now stand — asked for after something was settled that called for no writing */
export async function refreshAction(bookId: string): Promise<Result<{
    story: StoryState; scene: ScenePayload; learner: LearnerView; chronicle: ChronicleEntry[]; people: PersonView[];
}>> {
    return attempt("refresh", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        const [story, scene, learner, chronicle, people] = await Promise.all([
            storyState(book), getScene(book), getLearnerView(userId, langOf(book)), getChronicle(book.id), getPeople(book),
        ]);
        return { story, scene, learner, chronicle, people };
    });
}

/* ------------------------------------------------------------------ */
/* talking                                                             */
/* ------------------------------------------------------------------ */

/** walk up to someone and talk: the one way a goal that is theirs to settle can be settled */
export async function openDialogueAction(bookId: string, characterId: string, at: Spot): Promise<Result<DialogueState>> {
    return attempt("openDialogue", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        const here = await syncPosition(book, spot.parse(at));
        return openDialogue({ userId, bookId: book.id }, here, id.parse(characterId));
    });
}

/** write to someone the hero has met, from wherever the hero is */
export async function openChatAction(bookId: string, characterId: string): Promise<Result<DialogueState>> {
    return attempt("openChat", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        return openDialogue({ userId, bookId: book.id }, book, id.parse(characterId), { remote: true });
    });
}

const saidSchema = z.union([
    // a NUL cannot be stored, and nobody ever meant to say one
    z.object({ text: z.string().transform((text) => text.replace(/\u0000/g, "").trim()).pipe(z.string().min(1).max(500)) }),
    z.object({ optionKey: z.string().min(1).max(8) }),
]);

export async function sayAction(bookId: string, characterId: string, said: unknown, remote = false): Promise<Result<DialogueTurnResult>> {
    return attempt("say", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        return say({ userId, bookId: book.id }, book, id.parse(characterId), saidSchema.parse(said), { remote: z.boolean().parse(remote) });
    });
}

/** the hero has made their case, and asks for an answer: whatever is said stands */
export async function askForAnswerAction(bookId: string, characterId: string): Promise<Result<DialogueTurnResult>> {
    return attempt("askForAnswer", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        return askForAnswer({ userId, bookId: book.id }, book, id.parse(characterId));
    });
}

/* ------------------------------------------------------------------ */
/* fighting                                                            */
/* ------------------------------------------------------------------ */

export async function startEncounterAction(bookId: string, enemyId: string, at: Spot): Promise<Result<EncounterView>> {
    return attempt("startEncounter", async () => {
        const { book } = await requireBook(id.parse(bookId));
        const here = await syncPosition(book, spot.parse(at));
        return startEncounter(here, id.parse(enemyId));
    });
}

export async function resumeEncounterAction(bookId: string): Promise<Result<EncounterView | null>> {
    return attempt("resumeEncounter", async () => {
        const { book } = await requireBook(id.parse(bookId));
        return getActiveEncounter(book);
    });
}

export async function fleeEncounterAction(bookId: string, encounterId: string): Promise<Result<true>> {
    return attempt("fleeEncounter", async () => {
        const { book } = await requireBook(id.parse(bookId));
        await fleeEncounter(book, id.parse(encounterId));
        return true as const;
    });
}

export async function answerAction(bookId: string, encounterId: string, submission: unknown): Promise<Result<AnswerResult>> {
    return attempt("answer", async () => {
        const { book } = await requireBook(id.parse(bookId));
        return submitAnswer(book, id.parse(encounterId), submissionSchema.parse(submission));
    });
}

/* ------------------------------------------------------------------ */
/* words                                                               */
/* ------------------------------------------------------------------ */

const language = z.string().refine(isLangCode, "unknown language");

/** the reader tapped a word: count it as seen, and hand back its card and whether they have kept it */
export async function tapWordAction(lang: string, entryId: number): Promise<Result<{ card: WordCard | null; collected: boolean }>> {
    return attempt("tapWord", async () => {
        const { userId } = await requireUser();
        const code = language.parse(lang);
        const entry = z.number().int().positive().parse(entryId);
        if (!isLangCode(code)) return { card: null, collected: false };
        await recordExposure(userId, code, [entry]);
        const [[card], progress] = await Promise.all([
            cardsFor([entry]),
            db.query.wordProgress.findFirst({ where: and(eq(wordProgress.userId, userId), eq(wordProgress.entryId, entry)) }),
        ]);
        return { card: card ?? null, collected: progress?.collected ?? false };
    });
}

export async function collectWordAction(lang: string, entryId: number, collected: boolean): Promise<Result<true>> {
    return attempt("collectWord", async () => {
        const { userId } = await requireUser();
        const code = language.parse(lang);
        if (!isLangCode(code)) throw new Error("Unknown language.");
        await collectWord(userId, code, z.number().int().positive().parse(entryId), z.boolean().parse(collected));
        return true as const;
    });
}

/** every headword a written form could be — for a word card's "could also be" */
export async function lookupAction(lang: string, surface: string): Promise<Result<WordCard[]>> {
    return attempt("lookup", async () => {
        await requireUser();
        const code = language.parse(lang);
        if (!isLangCode(code)) return [];
        const found = await lookupAll(code, z.string().trim().min(1).max(60).parse(surface), 6);
        return found.map(toCard);
    });
}

export async function searchDictionaryAction(lang: string, query: string): Promise<Result<WordCard[]>> {
    return attempt("searchDictionary", async () => {
        await requireUser();
        const code = language.parse(lang);
        if (!isLangCode(code)) return [];
        return searchDictionary(code, z.string().trim().min(1).max(60).parse(query), 24);
    });
}

export async function satchelAction(lang: string, filter: "all" | "due" | "collected" | "learning" | "mastered" = "all"): Promise<Result<{ words: SatchelWord[]; learner: LearnerView }>> {
    return attempt("satchel", async () => {
        const { userId } = await requireUser();
        const code = language.parse(lang);
        if (!isLangCode(code)) throw new Error("Unknown language.");
        const [words, learner] = await Promise.all([
            getSatchel(userId, code, { limit: 400, filter: z.enum(["all", "due", "collected", "learning", "mastered"]).parse(filter) }),
            getLearnerView(userId, code),
        ]);
        return { words, learner };
    });
}
