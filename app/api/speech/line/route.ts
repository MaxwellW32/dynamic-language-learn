import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { characters } from "@/db/schema";
import { languageOf } from "@/game/languages";
import { speak, StorytellerError } from "@/server/ai/client";
import { requireBook } from "@/server/auth";

const body = z.object({
    bookId: z.string().min(1).max(64),
    /** whose voice; omitted for the narrator and for loose phrases */
    characterId: z.string().min(1).max(64).optional(),
    text: z.string().trim().min(1).max(600),
});

/** a line read aloud in its speaker's own voice; the same line is only ever generated once */
export async function POST(request: Request) {
    try {
        const { bookId, characterId, text } = body.parse(await request.json());
        const { userId, book } = await requireBook(bookId);
        const language = languageOf(book.targetLanguage);

        let voice = "sage";
        let style = `A warm storyteller reading aloud. Words in ${language.name} are pronounced as a native speaker would.`;
        if (characterId) {
            const character = await db.query.characters.findFirst({ where: eq(characters.id, characterId) });
            if (!character || character.bookId !== book.id) return NextResponse.json({ error: "They are not in this book." }, { status: 404 });
            voice = character.voiceId;
            style = `You are ${character.name}, ${character.role}. ${character.speechStyle} Mood: ${character.mood}. You are a native speaker of ${language.name}: pronounce it as one.`;
        }

        const { audio, mime } = await speak({ ctx: { userId, bookId: book.id }, text, voice, style });
        return new Response(new Uint8Array(audio), {
            headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400" },
        });
    } catch (error) {
        if (error instanceof StorytellerError) return NextResponse.json({ error: error.message, kind: error.kind }, { status: 402 });
        if (error instanceof z.ZodError) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
        if (error instanceof Error && error.constructor === Error) return NextResponse.json({ error: error.message }, { status: 403 });
        console.error("[speech/line]", error);
        return NextResponse.json({ error: "The voice faded away." }, { status: 500 });
    }
}
