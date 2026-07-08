import { auth } from "@/auth/auth";
import { db } from "@/db";
import { stories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getOverview } from "@/server/services/overview";
import { ForgeScreen } from "@/components/story/ForgeScreen";
import { GameScreen } from "@/components/game/GameScreen";

export const maxDuration = 300;

export default async function StoryPage({ params }: { params: Promise<{ storyId: string }> }) {
    const { storyId } = await params;

    const session = await auth();
    if (!session?.user?.id) redirect("/");

    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story || story.userId !== session.user.id) notFound();

    if (story.status === "forging") {
        return <ForgeScreen storyId={story.id} initialNote={story.forgeNote} />;
    }

    const overview = await getOverview(session.user.id, story);
    return <GameScreen initial={overview} />;
}
