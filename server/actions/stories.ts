"use server";

import { z } from "zod";
import { db } from "@/db";
import { stories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireStory, requireUser } from "../auth";
import { createStory, turnChapter } from "../services/story";
import { forgeWorld } from "../services/worldForge";
import type { ChapterTurnResult } from "@/game/payloads";

const createStorySchema = z.object({
    playerName: z.string().min(1).max(40),
    premiseSeed: z.string().max(500),
    packIds: z.array(z.string().min(1)).min(1).max(5),
});

export async function createStoryAction(input: z.infer<typeof createStorySchema>): Promise<{ storyId: string }> {
    const { userId } = await requireUser();
    const parsed = createStorySchema.parse(input);
    const storyId = await createStory(userId, parsed);
    return { storyId };
}

/** kicked off by the forging screen; safe to call twice (the claim guards it) */
export async function runForgeAction(storyId: string): Promise<void> {
    const { story } = await requireStory(z.string().min(1).parse(storyId));
    if (story.status !== "forging") return;
    await forgeWorld(story);
}

/** the forging screen polls this for progress copy */
export async function forgeStatusAction(storyId: string): Promise<{ status: string; forgeNote: string }> {
    const { story } = await requireStory(z.string().min(1).parse(storyId));
    return { status: story.status, forgeNote: story.forgeNote };
}

export async function turnChapterAction(storyId: string): Promise<ChapterTurnResult> {
    const { userId, story } = await requireStory(z.string().min(1).parse(storyId));
    return turnChapter(userId, story);
}

export async function deleteStoryAction(storyId: string): Promise<void> {
    const { story } = await requireStory(z.string().min(1).parse(storyId));
    await db.delete(stories).where(eq(stories.id, story.id));
}
