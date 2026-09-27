"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { books } from "@/db/schema";
import { LANG_CODES, type LangCode } from "@/game/languages";
import type { ActorLook } from "@/game/looks";
import { sanitizeLook } from "@/game/looks";
import type { BookOverview } from "@/game/payloads";
import { requireBook, requireUser } from "../auth";
import { createBook, forgeWorld } from "../services/forge";
import { getLearnerView, updateLearner } from "../services/learning";
import { getOverview } from "../services/overview";
import { attempt, type Result } from "./result";

const id = z.string().min(1).max(64);

const newBookSchema = z.object({
    language: z.enum(LANG_CODES as [LangCode, ...LangCode[]]),
    startingLevel: z.number().int().min(0).max(3),
    immersionBias: z.number().int().min(-1).max(1),
    playerName: z.string().trim().min(1).max(40),
    heroLook: z.record(z.string(), z.unknown()),
    genre: z.string().trim().max(60),
    tone: z.string().trim().max(60),
    wish: z.string().trim().max(500),
});

export async function createBookAction(input: unknown): Promise<Result<{ bookId: string }>> {
    return attempt("createBook", async () => {
        const parsed = newBookSchema.parse(input);
        const { userId } = await requireUser();
        const bookId = await createBook(userId, {
            language: parsed.language,
            startingLevel: parsed.startingLevel,
            immersionBias: parsed.immersionBias,
            playerName: parsed.playerName,
            heroLook: sanitizeLook(parsed.heroLook as Partial<Record<keyof ActorLook, unknown>>),
            brief: { genre: parsed.genre, tone: parsed.tone, wish: parsed.wish },
        });
        revalidatePath("/");
        return { bookId };
    });
}

/** make the world. Safe to call twice: the second caller finds the forge already claimed and returns at once */
export async function forgeAction(bookId: string): Promise<Result<{ status: string }>> {
    return attempt("forge", async () => {
        const { userId, book } = await requireBook(id.parse(bookId));
        if (book.status === "forging") await forgeWorld({ userId, bookId: book.id }, book);
        const fresh = await db.query.books.findFirst({ where: eq(books.id, book.id) });
        revalidatePath("/");
        return { status: fresh?.status ?? book.status };
    });
}

export async function overviewAction(bookId: string): Promise<Result<BookOverview>> {
    return attempt("overview", async () => {
        const { book } = await requireBook(id.parse(bookId));
        if (book.status === "forging") throw new Error("This book is still being written.");
        return getOverview(book);
    });
}

export async function deleteBookAction(bookId: string): Promise<Result<{ deleted: true }>> {
    return attempt("deleteBook", async () => {
        const { book } = await requireBook(id.parse(bookId));
        // the world, its people and its pages all hang off the book row
        await db.delete(books).where(eq(books.id, book.id));
        revalidatePath("/");
        return { deleted: true as const };
    });
}

/** how boldly the book uses the language being learned: -1 cozy, 0 balanced, 1 bold */
export async function setImmersionBiasAction(language: string, bias: number) {
    return attempt("setImmersionBias", async () => {
        const { userId } = await requireUser();
        const lang = z.enum(LANG_CODES as [LangCode, ...LangCode[]]).parse(language);
        await updateLearner(userId, lang, { immersionBias: z.number().int().min(-1).max(1).parse(bias) });
        return getLearnerView(userId, lang);
    });
}
