"use server";

import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, wordProgress } from "@/db/schema";
import { submissionSchema } from "@/game/challenges/types";
import type { WordCard } from "@/game/dictionary";
import type {
    AnswerResult, ChapterTurnResult, ChronicleEntry, DialogueState, DialogueTurnResult, EncounterView,
    LearnerView, NarrationResult, QuestView, SatchelWord, ScenePayload, TravelResult,
} from "@/game/payloads";
import { requireBook, requireUser } from "../auth";
import { turnChapter } from "../services/chapters";
import { openDialogue, say } from "../services/dialogue";
import { cardsFor, lookupAll, searchDictionary, toCard } from "../services/dictionary";
import { chronicle, getChronicle } from "../services/director";
import { fleeEncounter, getActiveEncounter, startEncounter, submitAnswer } from "../services/encounters";
import { collectWord, getLearnerView, getSatchel, recordExposure } from "../services/learning";
import { choose, examine, handleArrival, langOf } from "../services/narration";
import { abandonQuest, getQuestViews, isChapterTurnReady } from "../services/quests";
import { getScene, syncPosition, travel } from "../services/scene";
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

export async function travelAction(bookId: string, gateId: string, at: Spot): Promise<Result<TravelResult>> {
    return attempt("travel", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        const here = await syncPosition(book, spot.parse(at));
        const { book: moved, region, firstVisit } = await travel(here, id.parse(gateId));
        // the scene is what the player is waiting for; the page about it must not delay arrival if it fails
        const [scene, arrival] = await Promise.all([
            getScene(moved),
            handleArrival({ userId, bookId: book.id }, moved, region, firstVisit).catch((error) => {
                console.error("[travel] arrival narration failed", error);
                return null;
            }),
        ]);
        return { scene, arrival };
    });
}

export async function examineAction(bookId: string, landmarkId: string, at: Spot): Promise<Result<NarrationResult>> {
    return attempt("examine", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        const here = await syncPosition(book, spot.parse(at));
        return examine({ userId, bookId: book.id }, here, id.parse(landmarkId));
    });
}

export async function chooseAction(bookId: string, passageId: string, choiceKey: string): Promise<Result<NarrationResult>> {
    return attempt("choose", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        return choose({ userId, bookId: book.id }, book, id.parse(passageId), z.string().min(1).max(8).parse(choiceKey));
    });
}

export async function openDialogueAction(bookId: string, characterId: string, at: Spot): Promise<Result<DialogueState>> {
    return attempt("openDialogue", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        const here = await syncPosition(book, spot.parse(at));
        return openDialogue({ userId, bookId: book.id }, here, id.parse(characterId));
    });
}

const saidSchema = z.union([
    z.object({ text: z.string().trim().min(1).max(500) }),
    z.object({ optionKey: z.string().min(1).max(8) }),
]);

export async function sayAction(bookId: string, characterId: string, said: unknown): Promise<Result<DialogueTurnResult>> {
    return attempt("say", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        return say({ userId, bookId: book.id }, book, id.parse(characterId), saidSchema.parse(said));
    });
}

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
        const { userId, book } = await requireBook(id.parse(bookId));
        return submitAnswer({ userId, bookId: book.id }, book, id.parse(encounterId), submissionSchema.parse(submission));
    });
}

export async function turnChapterAction(bookId: string): Promise<Result<ChapterTurnResult>> {
    return attempt("turnChapter", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        return turnChapter({ userId, bookId: book.id }, book);
    });
}

/** the reader gives a quest up; the story is told, and the chapter stops waiting for it */
export async function abandonQuestAction(bookId: string, questId: string): Promise<Result<{ quests: QuestView[]; chapterTurnReady: boolean }>> {
    return attempt("abandonQuest", async () => {
        const { book } = await requireBook(id.parse(bookId));
        const [lost] = await abandonQuest(book, id.parse(questId));
        if (lost) {
            await chronicle(book, {
                kind: "quest-lost", importance: 4, regionId: book.currentRegionId,
                summary: `${book.playerName} let the quest "${lost.questTitle}" go, and turned to other things.`,
                heard: `${book.playerName} has turned to other things.`,
            });
        }
        const [quests, chapterTurnReady] = await Promise.all([getQuestViews(book), isChapterTurnReady(book)]);
        return { quests, chapterTurnReady };
    });
}

/** the quests and the scene as they now stand — asked for after the story has moved behind the player's back */
export async function refreshAction(bookId: string): Promise<Result<{
    quests: QuestView[]; scene: ScenePayload; learner: LearnerView; chronicle: ChronicleEntry[];
}>> {
    return attempt("refresh", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        const [quests, scene, learner, chronicle] = await Promise.all([
            getQuestViews(book), getScene(book), getLearnerView(userId, langOf(book)), getChronicle(book.id),
        ]);
        return { quests, scene, learner, chronicle };
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
