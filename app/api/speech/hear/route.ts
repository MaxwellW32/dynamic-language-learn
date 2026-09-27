import { NextResponse } from "next/server";
import { isLangCode } from "@/game/languages";
import { StorytellerError, transcribe } from "@/server/ai/client";
import { requireUser } from "@/server/auth";

const MAX_BYTES = 4 * 1024 * 1024;

/** what the player said into the microphone, as text — for speaking in conversations and in challenges */
export async function POST(request: Request) {
    try {
        const { userId } = await requireUser();
        const form = await request.formData();
        const audio = form.get("audio");
        const lang = form.get("lang");
        if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "Nothing was heard." }, { status: 400 });
        if (audio.size > MAX_BYTES) return NextResponse.json({ error: "That was too long to take in at once." }, { status: 413 });

        const text = await transcribe({
            ctx: { userId },
            audio,
            language: typeof lang === "string" && (isLangCode(lang) || lang === "en") ? lang : undefined,
        });
        return NextResponse.json({ text: text.trim() });
    } catch (error) {
        if (error instanceof StorytellerError) return NextResponse.json({ error: error.message, kind: error.kind }, { status: 402 });
        if (error instanceof Error && error.message === "You must be signed in.") return NextResponse.json({ error: error.message }, { status: 401 });
        console.error("[speech/hear]", error);
        return NextResponse.json({ error: "The words were lost on the wind." }, { status: 500 });
    }
}
