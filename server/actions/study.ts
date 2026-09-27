"use server";

import { z } from "zod";
import { submissionSchema } from "@/game/challenges/types";
import { isLangCode } from "@/game/languages";
import type { StudyAnswer, StudyView } from "@/game/payloads";
import { requireUser } from "../auth";
import { answerStudy, getStudy, startStudy } from "../services/study";
import { attempt, type Result } from "./result";

export async function startStudyAction(lang: string, size = 10): Promise<Result<StudyView>> {
    return attempt("startStudy", async () => {
        const { userId } = await requireUser();
        if (!isLangCode(lang)) throw new Error("Unknown language.");
        return startStudy(userId, lang, z.number().int().min(3).max(30).parse(size));
    });
}

export async function getStudyAction(sessionId: string): Promise<Result<StudyView | null>> {
    return attempt("getStudy", async () => {
        const { userId } = await requireUser();
        return getStudy(userId, z.string().min(1).max(64).parse(sessionId));
    });
}

export async function answerStudyAction(sessionId: string, submission: unknown): Promise<Result<StudyAnswer>> {
    return attempt("answerStudy", async () => {
        const { userId } = await requireUser();
        return answerStudy(userId, z.string().min(1).max(64).parse(sessionId), submissionSchema.parse(submission));
    });
}
