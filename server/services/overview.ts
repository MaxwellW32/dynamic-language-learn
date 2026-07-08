import "server-only";
import { db } from "@/db";
import { events, type Story } from "@/db/schema";
import type { StoryOverview } from "@/game/payloads";
import { desc, eq } from "drizzle-orm";
import { getScene } from "./scene";
import { getQuestViews, isChapterTurnReady } from "./quests";
import { getChapterViews, getPassageViews } from "./story";
import { getSatchel } from "./learning";
import { getActiveEncounter } from "./encounters";

/** everything the game screen needs, in one server round-trip */
export async function getOverview(userId: string, story: Story): Promise<StoryOverview> {
    const [scene, quests, chapters, passageData, satchel, chronicleRows, activeEncounter, chapterTurnReady] =
        await Promise.all([
            getScene(story),
            getQuestViews(story.id),
            getChapterViews(story.id),
            getPassageViews(story.id),
            getSatchel(userId, story.id),
            db.query.events.findMany({
                where: eq(events.storyId, story.id),
                orderBy: [desc(events.createdAt)],
                limit: 30,
            }),
            getActiveEncounter(story),
            isChapterTurnReady(story),
        ]);

    return {
        story: {
            id: story.id,
            title: story.title,
            premise: story.premise,
            playerName: story.playerName,
            nativeLanguage: story.nativeLanguage,
            targetLanguage: story.targetLanguage,
            arcStage: story.arcStage,
            status: story.status,
        },
        scene,
        quests,
        chapters,
        passages: passageData.passages,
        words: passageData.words,
        satchel,
        chronicle: chronicleRows.reverse().map((e) => ({
            id: e.id,
            summary: e.summary,
            at: e.createdAt.toISOString(),
        })),
        activeEncounter,
        chapterTurnReady,
    };
}
