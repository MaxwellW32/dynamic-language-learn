import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dictEntries } from "@/db/schema";
import { languageOf } from "@/game/languages";
import { speak, StorytellerError } from "@/server/ai/client";
import { requireUser } from "@/server/auth";

const query = z.object({ id: z.coerce.number().int().positive() });

/**
 * A dictionary word read aloud. The audio for a word is made once, ever, and
 * replayed for everyone after that (tts_cache), so this route is nearly always
 * free — and the browser is told to keep its copy too.
 */
export async function GET(request: NextRequest) {
    try {
        const { userId } = await requireUser();
        const { id } = query.parse({ id: request.nextUrl.searchParams.get("id") });

        const entry = await db.query.dictEntries.findFirst({ where: eq(dictEntries.id, id) });
        if (!entry) return NextResponse.json({ error: "No such word." }, { status: 404 });

        const language = languageOf(entry.lang);
        // kana reads unambiguously where kanji may not
        const text = entry.lang === "ja" && entry.reading ? entry.reading : entry.lemma;
        const { audio, mime } = await speak({
            ctx: { userId },
            text,
            voice: "coral",
            style: `A native ${language.name} teacher saying one word clearly and warmly, at an unhurried pace. Speak only in ${language.name}.`,
        });
        return new Response(new Uint8Array(audio), {
            headers: { "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable" },
        });
    } catch (error) {
        if (error instanceof StorytellerError) return NextResponse.json({ error: error.message, kind: error.kind }, { status: 402 });
        if (error instanceof z.ZodError) return NextResponse.json({ error: "Which word?" }, { status: 400 });
        if (error instanceof Error && error.message === "You must be signed in.") return NextResponse.json({ error: error.message }, { status: 401 });
        console.error("[speech/word]", error);
        return NextResponse.json({ error: "The voice faded away." }, { status: 500 });
    }
}
