import "server-only";
import { db } from "@/db";
import {
    characters, enemies, events, mapFeatures, maps, passages, stories,
    storyChapters, storyPacks, type Story,
} from "@/db/schema";
import type {
    ChapterTurnResult, ChapterView, NarrationResult, PassageView, WordEntry,
} from "@/game/payloads";
import { withinInteractRange } from "@/game/geometry";
import { WORLD_BLUEPRINT } from "@/game/mapTemplates";
import { and, asc, desc, eq } from "drizzle-orm";
import { generateChapterTransition, generateNarration, type NarrationKind } from "../ai/narrator";
import { generateQuestPlan } from "../ai/forge";
import { offerWords, resolveSegments } from "../ai/segments";
import { segmentsToPlainText, type Segment } from "@/game/segments";
import { buildVocabPlan, getImmersionLevel, planCountsFor, recordExposure } from "./learning";
import { chargeForAi } from "./billing";
import { sceneBrief, wordEntriesFor } from "./scene";
import { applyProgress, getQuestViews, isChapterTurnReady } from "./quests";
import { persistQuestPlan } from "./worldForge";

const ARC_ORDER = ["introduction", "rising", "climax", "falling", "resolution"] as const;
type ArcStage = (typeof ARC_ORDER)[number];

const ARC_GUIDANCE: Record<ArcStage, string> = {
    introduction: "This is the very beginning: meeting the world, its people, and the first hints of the mystery. Keep stakes gentle and local.",
    rising: "The mystery deepens: complications, new dangers in the wilds, allies revealing secrets. Raise the stakes.",
    climax: "The heart of the story: confrontations with what has been lurking, hard choices, the boss's shadow over everything.",
    falling: "After the storm: consequences, mending what broke, thanking and being thanked, one last loose thread.",
    resolution: "The gentle ending: farewells, rewards, the world changed for the better, the hero's place in it affirmed.",
};

/* ------------------------------------------------------------------ */
/* briefs from the chronicle                                           */
/* ------------------------------------------------------------------ */

export async function chronicleBrief(storyId: string, limit = 8): Promise<string> {
    const rows = await db.query.events.findMany({
        where: eq(events.storyId, storyId),
        orderBy: [desc(events.createdAt)],
        limit,
    });
    if (rows.length === 0) return "(nothing yet)";
    return rows.reverse().map((e) => `- ${e.summary}`).join("\n");
}

async function recentPassagesBrief(storyId: string, limit = 3): Promise<string> {
    const rows = await db.query.passages.findMany({
        where: eq(passages.storyId, storyId),
        orderBy: [desc(passages.createdAt)],
        limit,
    });
    if (rows.length === 0) return "(the book is blank)";
    return rows.reverse().map((p) => segmentsToPlainText(p.segments)).join("\n---\n");
}

async function currentChapter(storyId: string) {
    const chapter = await db.query.storyChapters.findFirst({
        where: eq(storyChapters.storyId, storyId),
        orderBy: [desc(storyChapters.index)],
    });
    if (!chapter) throw new Error("This book has no chapters yet.");
    return chapter;
}

async function appendPassage(
    story: Story,
    kind: "narration" | "event" | "discovery",
    segments: Segment[],
): Promise<PassageView> {
    const chapter = await currentChapter(story.id);
    const [row] = await db.insert(passages).values({
        storyId: story.id,
        chapterId: chapter.id,
        kind,
        segments,
        mapId: story.currentMapId,
    }).returning();
    return { id: row.id, kind: row.kind, segments: row.segments };
}

/** used by the encounter service after a win */
export async function appendVictoryPassage(story: Story, segments: Segment[]): Promise<PassageView> {
    return appendPassage(story, "narration", segments);
}

/* ------------------------------------------------------------------ */
/* narration moments                                                   */
/* ------------------------------------------------------------------ */

async function narrate(
    userId: string,
    story: Story,
    kind: NarrationKind,
    focus: string,
): Promise<NarrationResult> {
    await chargeForAi(userId, kind === "victory" ? "victory" : "narration");
    const immersionLevel = await getImmersionLevel(userId, story.id);
    const plan = await buildVocabPlan(userId, story, planCountsFor(immersionLevel, "narration"));
    const offer = offerWords(plan);

    const result = await generateNarration({
        story,
        kind,
        sceneBrief: await sceneBrief(story),
        chronicleBrief: await chronicleBrief(story.id),
        recentPassages: await recentPassagesBrief(story.id),
        focus,
        offer,
        immersionLevel,
    });

    const segments = resolveSegments(result.passage, offer);
    const passage = await appendPassage(story, kind === "inspect" ? "discovery" : "narration", segments);

    if (result.eventSummary) {
        await db.insert(events).values({
            storyId: story.id,
            kind,
            summary: result.eventSummary,
            mapId: story.currentMapId,
        });
    }
    await recordExposure(userId, segments.flatMap((s) => (s.t === "vocab" ? [s.wordId] : [])));

    return {
        passage,
        words: await wordEntriesFor([segments]),
        questUpdates: [],
        chapterTurnReady: await isChapterTurnReady(story),
    };
}

/** first time the player sets foot on a map, the narrator paints it */
export async function handleArrival(userId: string, story: Story, mapId: string): Promise<NarrationResult | null> {
    const map = await db.query.maps.findFirst({ where: eq(maps.id, mapId) });
    if (!map) return null;

    const questUpdates = await applyProgress(story, { kind: "visit", targetMapId: mapId });

    const alreadyVisited = await db.query.events.findFirst({
        where: and(eq(events.storyId, story.id), eq(events.kind, "arrival"), eq(events.mapId, mapId)),
    });
    if (alreadyVisited) {
        return questUpdates.length === 0 ? null : {
            passage: null,
            words: [],
            questUpdates,
            chapterTurnReady: await isChapterTurnReady(story),
        };
    }

    await db.insert(events).values({
        storyId: story.id,
        kind: "arrival",
        summary: `${story.playerName} reached ${map.name} for the first time.`,
        mapId,
    });

    const result = await narrate(userId, story, "arrival", `Arriving in ${map.name} for the first time.`);
    return { ...result, questUpdates: [...questUpdates, ...result.questUpdates] };
}

/** the player inspects a sign, well, crystal… */
export async function inspectFeature(userId: string, story: Story, featureId: string): Promise<NarrationResult> {
    const feature = await db.query.mapFeatures.findFirst({ where: eq(mapFeatures.id, featureId) });
    if (!feature || feature.mapId !== story.currentMapId || !feature.interactive) {
        throw new Error("There is nothing to examine there.");
    }
    if (!withinInteractRange({ x: story.x, y: story.y }, feature)) {
        throw new Error("Step closer to take a look.");
    }
    return narrate(
        userId, story, "inspect",
        `The hero inspects ${feature.name} (a ${feature.kind}). Its hidden lore: ${feature.lore || "unknown — invent something small and fitting."}`,
    );
}

/* ------------------------------------------------------------------ */
/* turning the page: chapter transitions                               */
/* ------------------------------------------------------------------ */

export async function turnChapter(userId: string, story: Story): Promise<ChapterTurnResult> {
    if (!(await isChapterTurnReady(story))) throw new Error("This chapter is not finished yet.");
    await chargeForAi(userId, "chapterTurn");

    const chapter = await currentChapter(story.id);
    const stageIndex = ARC_ORDER.indexOf(story.arcStage);
    const nextStage = ARC_ORDER[stageIndex + 1];

    const immersionLevel = await getImmersionLevel(userId, story.id);
    const plan = await buildVocabPlan(userId, story, planCountsFor(immersionLevel, "narration"));
    const offer = offerWords(plan);
    const transition = await generateChapterTransition({
        story,
        closingChapterTitle: chapter.title,
        nextArcStage: nextStage ?? "the story's end",
        chronicleBrief: await chronicleBrief(story.id, 14),
        offer,
        immersionLevel,
    });

    await db.update(storyChapters).set({ summary: transition.closingSummary })
        .where(eq(storyChapters.id, chapter.id));

    const [newChapter] = await db.insert(storyChapters).values({
        storyId: story.id,
        index: chapter.index + 1,
        title: transition.nextChapterTitle,
    }).returning();

    const segments = resolveSegments(transition.passage, offer);
    const [passageRow] = await db.insert(passages).values({
        storyId: story.id,
        chapterId: newChapter.id,
        kind: "narration",
        segments,
        mapId: story.currentMapId,
    }).returning();

    await db.insert(events).values({
        storyId: story.id,
        kind: "chapter",
        summary: `The chapter "${chapter.title}" ended: ${transition.closingSummary}`,
    });

    let storyCompleted = false;
    if (nextStage) {
        await db.update(stories).set({ arcStage: nextStage }).where(eq(stories.id, story.id));

        // new quests for the new stage, built from the world as it now stands
        const [cast, foes, worldMaps] = await Promise.all([
            db.query.characters.findMany({ where: and(eq(characters.storyId, story.id), eq(characters.status, "alive")) }),
            db.query.enemies.findMany({ where: and(eq(enemies.storyId, story.id), eq(enemies.status, "alive")) }),
            db.query.maps.findMany({ where: eq(maps.storyId, story.id) }),
        ]);
        const npcIdByKey = new Map(cast.map((c, i) => [`n${i + 1}`, c.id]));
        const enemyIdByKey = new Map(foes.map((e, i) => [`e${i + 1}`, e.id]));
        const refByTemplate = new Map(WORLD_BLUEPRINT.maps.map((m) => [m.templateKey, m.ref]));
        const mapIdByRef = new Map(worldMaps.map((m) => [refByTemplate.get(m.templateKey) ?? m.templateKey, m.id]));

        const questPlan = await generateQuestPlan({
            seed: { title: story.title, premise: story.premise, tone: story.tone },
            arcStage: nextStage,
            stageGuidance: ARC_GUIDANCE[nextStage],
            castBrief: [
                ...cast.map((c, i) => `- n${i + 1} (npc): ${c.name}, ${c.role}`),
                ...foes.map((e, i) => `- e${i + 1} (enemy, ${e.tier}): ${e.name} — ${e.description}`),
            ].join("\n"),
            mapsBrief: worldMaps.map((m) => `- ${refByTemplate.get(m.templateKey) ?? m.templateKey}: ${m.name}`).join("\n"),
            chronicleBrief: await chronicleBrief(story.id, 14),
        });
        await persistQuestPlan(story.id, nextStage, questPlan, { npcIdByKey, enemyIdByKey, mapIdByRef });
    } else {
        storyCompleted = true;
        await db.update(stories).set({ status: "completed" }).where(eq(stories.id, story.id));
    }

    await recordExposure(userId, segments.flatMap((s) => (s.t === "vocab" ? [s.wordId] : [])));

    const toView = (c: typeof chapter): ChapterView => ({ id: c.id, index: c.index, title: c.title, summary: c.summary });
    return {
        closedChapter: { ...toView(chapter), summary: transition.closingSummary },
        newChapter: toView(newChapter),
        passage: { id: passageRow.id, kind: "narration", segments },
        words: await wordEntriesFor([segments]),
        quests: await getQuestViews(story.id),
        storyCompleted,
    };
}

/* ------------------------------------------------------------------ */
/* story lifecycle                                                     */
/* ------------------------------------------------------------------ */

export async function createStory(userId: string, input: {
    playerName: string;
    premiseSeed: string;
    packIds: string[];
}): Promise<string> {
    // the forge is the expensive act — charged once here, retries are free
    await chargeForAi(userId, "forge");
    const packs = await db.query.vocabPacks.findMany();
    const chosen = packs.filter((p) => input.packIds.includes(p.id));
    if (chosen.length === 0) throw new Error("Choose at least one word pack.");
    const target = chosen[0];
    if (!chosen.every((p) => p.targetLanguage === target.targetLanguage)) {
        throw new Error("All packs in one story must teach the same language.");
    }

    const [story] = await db.insert(stories).values({
        userId,
        title: "An Unwritten Tale",
        premise: input.premiseSeed.trim(),
        nativeLanguage: target.nativeLanguage,
        targetLanguage: target.targetLanguage,
        targetDialect: target.targetDialect,
        playerName: input.playerName.trim() || "The Wanderer",
        status: "forging",
    }).returning();

    await db.insert(storyPacks).values(chosen.map((p) => ({ storyId: story.id, packId: p.id })));
    return story.id;
}

export async function listStories(userId: string) {
    return db.query.stories.findMany({
        where: eq(stories.userId, userId),
        orderBy: [desc(stories.updatedAt)],
        with: { packs: { with: { pack: true } } },
    });
}

export async function getChapterViews(storyId: string): Promise<ChapterView[]> {
    const rows = await db.query.storyChapters.findMany({
        where: eq(storyChapters.storyId, storyId),
        orderBy: [asc(storyChapters.index)],
    });
    return rows.map((c) => ({ id: c.id, index: c.index, title: c.title, summary: c.summary }));
}

export async function getPassageViews(storyId: string, limit = 40): Promise<{ passages: PassageView[]; words: WordEntry[] }> {
    const rows = await db.query.passages.findMany({
        where: eq(passages.storyId, storyId),
        orderBy: [desc(passages.createdAt)],
        limit,
    });
    const ordered = rows.reverse();
    return {
        passages: ordered.map((p) => ({ id: p.id, kind: p.kind, segments: p.segments })),
        words: await wordEntriesFor(ordered.map((p) => p.segments)),
    };
}
