import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { openaiForRequest } from "@/server/ai/client";
import { chargeForAi } from "@/server/services/billing";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** hold-to-speak: browser audio in, text out */
export async function POST(request: Request) {
    try {
        const { userId } = await requireUser();
        await chargeForAi(userId, "transcribe");

        const form = await request.formData();
        const audio = form.get("audio");
        if (!(audio instanceof File) || audio.size === 0) {
            return NextResponse.json({ error: "No audio received." }, { status: 400 });
        }
        if (audio.size > MAX_AUDIO_BYTES) {
            return NextResponse.json({ error: "Recording too long." }, { status: 413 });
        }

        const openai = await openaiForRequest();
        const result = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file: audio,
        });

        return NextResponse.json({ text: result.text });
    } catch (error) {
        console.error("[voice/transcribe]", error);
        return NextResponse.json({ error: "Couldn't make out the words." }, { status: 500 });
    }
}
