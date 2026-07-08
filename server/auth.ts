import "server-only";
import { auth } from "@/auth/auth";
import { db } from "@/db";
import { stories, type Story } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Every server action begins here. Nothing in the game layer trusts a client-
 * supplied user id — identity always comes from the session.
 */
export async function requireUser(): Promise<{ userId: string }> {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new Error("You must be signed in.");
    return { userId };
}

/** loads a story only if the signed-in user owns it */
export async function requireStory(storyId: string): Promise<{ userId: string; story: Story }> {
    const { userId } = await requireUser();
    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story || story.userId !== userId) throw new Error("Story not found.");
    return { userId, story };
}
