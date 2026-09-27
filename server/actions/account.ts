"use server";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { learnerProfiles } from "@/db/schema";
import { isLangCode } from "@/game/languages";
import type { LearnerView } from "@/game/payloads";
import { requireUser } from "../auth";
import { getLearnerView } from "../services/learning";
import { attempt, type Result } from "./result";

/** every language the player has a learner profile in, oldest first */
export async function myLanguagesAction(): Promise<Result<LearnerView[]>> {
    return attempt("myLanguages", async () => {
        const { userId } = await requireUser();
        const profiles = await db.select({ lang: learnerProfiles.lang })
            .from(learnerProfiles)
            .where(eq(learnerProfiles.userId, userId))
            .orderBy(asc(learnerProfiles.createdAt));
        // a profile for a language the game no longer teaches is skipped, not shown broken
        const langs = profiles.flatMap((p) => (isLangCode(p.lang) ? [p.lang] : []));
        return Promise.all(langs.map((lang) => getLearnerView(userId, lang)));
    });
}
