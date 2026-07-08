import "server-only";
import { db } from "@/db";
import {
    characters, conversations, enemies, events, mapFeatures,
    maps, passages, portals, quests, questObjectives, relationships, stories,
    storyChapters, type Story,
} from "@/db/schema";
import { MAP_TEMPLATES, WORLD_BLUEPRINT, arrivalPoint } from "@/game/mapTemplates";
import { ENEMY_SPRITES, NPC_SPRITES, TTS_VOICES } from "@/game/sprites";
import type { ChallengeType } from "@/game/challenges/types";
import { and, eq, inArray } from "drizzle-orm";
import { generateOpening, generateQuestPlan, generateStorySeed, generateWorldFill, type QuestPlan } from "../ai/forge";
import { offerWords, resolveSegments } from "../ai/segments";
import { buildVocabPlan } from "./learning";

const TIER_CHALLENGES: Record<"minion" | "elite" | "boss", ChallengeType[]> = {
    minion: ["meaningMatch", "reverseMatch", "spelling"],
    elite: ["meaningMatch", "reverseMatch", "matching", "fillBlank", "spelling"],
    boss: ["meaningMatch", "reverseMatch", "matching", "fillBlank", "spelling", "sentenceOrder"],
};

async function setForgeNote(storyId: string, note: string) {
    await db.update(stories).set({ forgeNote: note }).where(eq(stories.id, storyId));
}

/** wipe any partial world left by a failed forge so a retry starts clean */
async function clearWorld(storyId: string) {
    await db.delete(maps).where(eq(maps.storyId, storyId));
    await db.delete(characters).where(eq(characters.storyId, storyId));
    await db.delete(enemies).where(eq(enemies.storyId, storyId));
    await db.delete(quests).where(eq(quests.storyId, storyId));
    await db.delete(storyChapters).where(eq(storyChapters.storyId, storyId));
    await db.delete(events).where(eq(events.storyId, storyId));
    await db.delete(conversations).where(eq(conversations.storyId, storyId));
}

/**
 * One-click world creation. Geometry comes from handcrafted templates; the
 * AI names and fills. Roughly four model calls: seed → world fill → quests →
 * opening page.
 */
export async function forgeWorld(story: Story): Promise<void> {
    // claim the run — a second concurrent call gets nothing back and exits
    const claimed = await db.update(stories)
        .set({ forgeNote: "Summoning the storyteller…" })
        .where(and(
            eq(stories.id, story.id),
            eq(stories.status, "forging"),
            inArray(stories.forgeNote, ["", "failed"]),
        ))
        .returning();
    if (claimed.length === 0) return;

    try {
        await clearWorld(story.id);

        /* 1 — the seed */
        const seed = await generateStorySeed({
            playerName: story.playerName,
            nativeLanguage: story.nativeLanguage,
            targetLanguage: story.targetLanguage,
            premiseSeed: story.premise || null,
        });
        await db.update(stories).set({
            title: seed.title, premise: seed.premise, tone: seed.tone,
            forgeNote: "Drawing the maps…",
        }).where(eq(stories.id, story.id));

        /* 2 — geometry from the blueprint */
        const mapIdByRef = new Map<string, string>();
        for (const bp of WORLD_BLUEPRINT.maps) {
            const template = MAP_TEMPLATES[bp.templateKey];
            const [row] = await db.insert(maps).values({
                storyId: story.id,
                name: bp.ref,
                kind: template.kind,
                templateKey: template.key,
                width: template.width,
                height: template.height,
            }).returning();
            mapIdByRef.set(bp.ref, row.id);
        }

        /* 3 — briefs for the fill call */
        type FeatureRef = { key: string; mapRef: string; slotIndex: number };
        type NpcRef = { key: string; mapRef: string; slotIndex: number };
        type EnemyRef = { key: string; mapRef: string; slotIndex: number | "boss"; tier: "minion" | "elite" | "boss" };

        const featureRefs: FeatureRef[] = [];
        const npcRefs: NpcRef[] = [];
        const enemyRefs: EnemyRef[] = [];

        const mapsBriefLines: string[] = [];
        for (const bp of WORLD_BLUEPRINT.maps) {
            const template = MAP_TEMPLATES[bp.templateKey];
            const slotLines: string[] = [];
            template.features.forEach((slot, slotIndex) => {
                if (!slot.interactive) return;
                const key = `f${featureRefs.length + 1}`;
                featureRefs.push({ key, mapRef: bp.ref, slotIndex });
                slotLines.push(`  - ${key}: a ${slot.kind}`);
            });
            mapsBriefLines.push(
                `- "${bp.ref}": a ${template.kind} (${template.key} layout)\n${slotLines.join("\n")}`,
            );
        }

        for (const bp of WORLD_BLUEPRINT.maps) {
            const template = MAP_TEMPLATES[bp.templateKey];
            template.npcSlots.forEach((_, slotIndex) => {
                npcRefs.push({ key: `n${npcRefs.length + 1}`, mapRef: bp.ref, slotIndex });
            });
        }
        for (const bp of WORLD_BLUEPRINT.maps) {
            const template = MAP_TEMPLATES[bp.templateKey];
            template.enemySlots.forEach((_, slotIndex) => {
                const tier: "minion" | "elite" =
                    template.kind === "dungeon" ? "elite" :
                    template.kind === "wilds" && slotIndex === 2 ? "elite" : "minion";
                enemyRefs.push({ key: `e${enemyRefs.length + 1}`, mapRef: bp.ref, slotIndex, tier });
            });
            if (template.bossSlot) {
                enemyRefs.push({ key: `e${enemyRefs.length + 1}`, mapRef: bp.ref, slotIndex: "boss", tier: "boss" });
            }
        }

        const fill = await generateWorldFill({
            seed,
            playerName: story.playerName,
            targetLanguage: story.targetLanguage,
            mapsBrief: mapsBriefLines.join("\n"),
            npcSlotsBrief: npcRefs.map((r) => `- ${r.key}: lives in "${r.mapRef}"`).join("\n"),
            enemySlotsBrief: enemyRefs.map((r) =>
                `- ${r.key}: a ${r.tier} in "${r.mapRef}"${r.tier === "boss" ? " — THE BOSS of the story" : ""}`,
            ).join("\n"),
        });
        await setForgeNote(story.id, "Naming the villagers…");

        /* 4 — persist the filled world */
        const fillMapByRef = new Map(fill.maps.map((m) => [m.ref, m]));
        const fillFeatureByKey = new Map(fill.maps.flatMap((m) => m.features.map((f) => [f.key, f] as const)));
        const fillNpcByKey = new Map(fill.npcs.map((n) => [n.key, n]));
        const fillEnemyByKey = new Map(fill.enemies.map((e) => [e.key, e]));

        for (const bp of WORLD_BLUEPRINT.maps) {
            const filled = fillMapByRef.get(bp.ref);
            if (!filled) continue;
            await db.update(maps).set({
                name: filled.name, biome: filled.biome, ambience: filled.ambience,
            }).where(eq(maps.id, mapIdByRef.get(bp.ref)!));
        }

        for (const bp of WORLD_BLUEPRINT.maps) {
            const template = MAP_TEMPLATES[bp.templateKey];
            const mapId = mapIdByRef.get(bp.ref)!;
            await db.insert(mapFeatures).values(template.features.map((slot, slotIndex) => {
                const ref = featureRefs.find((r) => r.mapRef === bp.ref && r.slotIndex === slotIndex);
                const filled = ref ? fillFeatureByKey.get(ref.key) : undefined;
                return {
                    mapId,
                    kind: slot.kind,
                    name: filled?.name ?? slot.kind,
                    lore: filled?.lore ?? "",
                    x: slot.x,
                    y: slot.y,
                    interactive: slot.interactive ?? false,
                };
            }));
        }

        // portals, both directions, labeled with the destination's name
        const nameByRef = new Map(WORLD_BLUEPRINT.maps.map((bp) => [bp.ref, fillMapByRef.get(bp.ref)?.name ?? bp.ref]));
        for (const link of WORLD_BLUEPRINT.links) {
            const fromTemplate = MAP_TEMPLATES[WORLD_BLUEPRINT.maps.find((m) => m.ref === link.from.map)!.templateKey];
            const toTemplate = MAP_TEMPLATES[WORLD_BLUEPRINT.maps.find((m) => m.ref === link.to.map)!.templateKey];
            const fromSlot = fromTemplate.portalSlots[link.from.portal];
            const toSlot = toTemplate.portalSlots[link.to.portal];
            const fromArrive = arrivalPoint(fromTemplate, fromSlot);
            const toArrive = arrivalPoint(toTemplate, toSlot);
            await db.insert(portals).values([
                {
                    mapId: mapIdByRef.get(link.from.map)!,
                    x: fromSlot.x, y: fromSlot.y,
                    label: `To ${nameByRef.get(link.to.map)}`,
                    targetMapId: mapIdByRef.get(link.to.map)!,
                    targetX: toArrive.x, targetY: toArrive.y,
                },
                {
                    mapId: mapIdByRef.get(link.to.map)!,
                    x: toSlot.x, y: toSlot.y,
                    label: `To ${nameByRef.get(link.from.map)}`,
                    targetMapId: mapIdByRef.get(link.from.map)!,
                    targetX: fromArrive.x, targetY: fromArrive.y,
                },
            ]);
        }

        const characterIdByKey = new Map<string, string>();
        for (const ref of npcRefs) {
            const filled = fillNpcByKey.get(ref.key);
            if (!filled) continue;
            const template = MAP_TEMPLATES[WORLD_BLUEPRINT.maps.find((m) => m.ref === ref.mapRef)!.templateKey];
            const slot = template.npcSlots[ref.slotIndex];
            const [row] = await db.insert(characters).values({
                storyId: story.id,
                mapId: mapIdByRef.get(ref.mapRef)!,
                x: slot.x, y: slot.y,
                name: filled.name,
                role: filled.role,
                personality: filled.personality,
                appearance: filled.appearance,
                backstory: filled.backstory,
                spriteKey: filled.spriteKey in NPC_SPRITES ? filled.spriteKey : "villager",
                voiceId: (TTS_VOICES as readonly string[]).includes(filled.voiceId) ? filled.voiceId : "alloy",
            }).returning();
            characterIdByKey.set(ref.key, row.id);
            await db.insert(relationships).values({ characterId: row.id });
        }

        const enemyIdByKey = new Map<string, string>();
        for (const ref of enemyRefs) {
            const filled = fillEnemyByKey.get(ref.key);
            if (!filled) continue;
            const template = MAP_TEMPLATES[WORLD_BLUEPRINT.maps.find((m) => m.ref === ref.mapRef)!.templateKey];
            const slot = ref.slotIndex === "boss" ? template.bossSlot! : template.enemySlots[ref.slotIndex];
            const [row] = await db.insert(enemies).values({
                storyId: story.id,
                mapId: mapIdByRef.get(ref.mapRef)!,
                x: slot.x, y: slot.y,
                name: filled.name,
                description: filled.description,
                tier: ref.tier,
                spriteKey: filled.spriteKey in ENEMY_SPRITES ? filled.spriteKey : (ref.tier === "boss" ? "boss-dragon" : "slime"),
                introLine: filled.introLine,
                defeatLine: filled.defeatLine,
                challengeTypes: TIER_CHALLENGES[ref.tier],
            }).returning();
            enemyIdByKey.set(ref.key, row.id);
        }

        /* 5 — opening quests */
        await setForgeNote(story.id, "Plotting the first quests…");
        const castBrief = [
            ...npcRefs.map((r) => {
                const n = fillNpcByKey.get(r.key);
                return n ? `- ${r.key} (npc): ${n.name}, ${n.role}, found in "${r.mapRef}"` : null;
            }),
            ...enemyRefs.map((r) => {
                const e = fillEnemyByKey.get(r.key);
                return e ? `- ${r.key} (enemy, ${r.tier}): ${e.name} — ${e.description}, lurks in "${r.mapRef}"` : null;
            }),
        ].filter(Boolean).join("\n");
        const questMapsBrief = WORLD_BLUEPRINT.maps
            .map((bp) => `- ${bp.ref}: ${nameByRef.get(bp.ref)}`)
            .join("\n");

        const questPlan = await generateQuestPlan({
            seed,
            arcStage: "introduction",
            stageGuidance: "This is the very beginning: meeting the world, its people, and the first hints of the mystery. Keep stakes gentle and local.",
            castBrief,
            mapsBrief: questMapsBrief,
            chronicleBrief: "(the story has not begun)",
        });
        await persistQuestPlan(story.id, "introduction", questPlan, {
            npcIdByKey: characterIdByKey,
            enemyIdByKey,
            mapIdByRef,
        });

        /* 6 — the opening page */
        await setForgeNote(story.id, "Writing the first page…");
        const startRef = WORLD_BLUEPRINT.startMapRef;
        const startTemplate = MAP_TEMPLATES[WORLD_BLUEPRINT.maps.find((m) => m.ref === startRef)!.templateKey];
        const startMapId = mapIdByRef.get(startRef)!;
        const startFill = fillMapByRef.get(startRef);

        const plan = await buildVocabPlan(story.userId, story, { introduce: 3, review: 0 });
        const offer = offerWords(plan);
        const opening = await generateOpening({
            seed,
            playerName: story.playerName,
            nativeLanguage: story.nativeLanguage,
            targetLanguage: story.targetLanguage,
            startBrief: `${startFill?.name ?? "the village"} — ${startFill?.biome ?? ""}. ${startFill?.ambience ?? ""}`,
            offer,
        });

        const [chapter] = await db.insert(storyChapters).values({
            storyId: story.id, index: 1, title: opening.chapterTitle,
        }).returning();
        await db.insert(passages).values({
            storyId: story.id,
            chapterId: chapter.id,
            kind: "narration",
            segments: resolveSegments(opening.passage, offer),
            mapId: startMapId,
        });
        await db.insert(events).values({
            storyId: story.id,
            kind: "arrival",
            summary: `${story.playerName} arrived in ${startFill?.name ?? "the village"} and the story began.`,
            mapId: startMapId,
        });

        await db.update(stories).set({
            status: "active",
            forgeNote: "",
            currentMapId: startMapId,
            x: startTemplate.spawn.x,
            y: startTemplate.spawn.y,
        }).where(eq(stories.id, story.id));
    } catch (error) {
        console.error("[forge] failed", error);
        await setForgeNote(story.id, "failed");
        throw new Error("The forge sputtered — the world could not be finished. Try again.");
    }
}

/** shared by the forge and later chapter turns */
export async function persistQuestPlan(
    storyId: string,
    arcStage: "introduction" | "rising" | "climax" | "falling" | "resolution",
    plan: QuestPlan,
    refs: {
        npcIdByKey: Map<string, string>;
        enemyIdByKey: Map<string, string>;
        mapIdByRef: Map<string, string>;
    },
): Promise<void> {
    type ObjectiveInsert = Omit<typeof questObjectives.$inferInsert, "questId">;

    let sortIndex = 0;
    for (const quest of plan.quests) {
        const giverId = quest.giverNpcKey ? refs.npcIdByKey.get(quest.giverNpcKey) ?? null : null;
        const objectives = quest.objectives.flatMap((o, i): ObjectiveInsert[] => {
            const base = { description: o.description, sortIndex: i };
            if (o.kind === "talkTo" || o.kind === "persuade") {
                const id = o.targetKey ? refs.npcIdByKey.get(o.targetKey) : undefined;
                return id ? [{ ...base, kind: o.kind, targetCharacterId: id }] : [];
            }
            if (o.kind === "defeat") {
                const id = o.targetKey ? refs.enemyIdByKey.get(o.targetKey) : undefined;
                return id ? [{ ...base, kind: o.kind, targetEnemyId: id }] : [];
            }
            if (o.kind === "visit") {
                const id = o.targetKey ? refs.mapIdByRef.get(o.targetKey) : undefined;
                return id ? [{ ...base, kind: o.kind, targetMapId: id }] : [];
            }
            return [{ ...base, kind: o.kind, targetCount: o.wordCount ?? 5 }];
        });
        if (objectives.length === 0) continue; // every reference was hallucinated — drop the quest

        const [row] = await db.insert(quests).values({
            storyId,
            title: quest.title,
            description: quest.description,
            arcStage,
            giverCharacterId: giverId,
            sortIndex: sortIndex++,
        }).returning();
        await db.insert(questObjectives).values(objectives.map((o) => ({ ...o, questId: row.id })));
    }
}
