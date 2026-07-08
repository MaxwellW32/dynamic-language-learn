import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { characters } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireStory } from "@/server/auth";
import { openaiForRequest } from "@/server/ai/client";
import { chargeForAi } from "@/server/services/billing";

const bodySchema = z.object({
    storyId: z.string().min(1),
    characterId: z.string().min(1),
    text: z.string().min(1).max(600),
});

/** an NPC line read aloud in that character's assigned voice */
export async function POST(request: Request) {
    try {
        const { storyId, characterId, text } = bodySchema.parse(await request.json());
        const { userId, story } = await requireStory(storyId);

        const character = await db.query.characters.findFirst({ where: eq(characters.id, characterId) });
        if (!character || character.storyId !== story.id) {
            return NextResponse.json({ error: "Character not found." }, { status: 404 });
        }

        await chargeForAi(userId, "speak");
        const openai = await openaiForRequest();
        const speech = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: character.voiceId,
            input: text,
            instructions: `You are ${character.name}, ${character.role} in a warm storybook world. Personality: ${character.personality}. Current mood: ${character.mood}. Speak in character — foreign words pronounced naturally.`,
            response_format: "mp3",
        });

        return new Response(speech.body, {
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
        });
    } catch (error) {
        console.error("[voice/speak]", error);
        return NextResponse.json({ error: "The voice faded away." }, { status: 500 });
    }
}
