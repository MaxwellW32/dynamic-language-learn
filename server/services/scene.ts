import "server-only";
import { db } from "@/db";
import {
    characters, enemies, mapFeatures, maps, portals, stories,
    vocabWords, type GameMap, type Story,
} from "@/db/schema";
import type { ScenePayload, WordEntry } from "@/game/payloads";
import type { Segment } from "@/game/segments";
import { clampToMap, withinInteractRange, type Point } from "@/game/geometry";
import { and, eq, inArray } from "drizzle-orm";

export async function getScene(story: Story): Promise<ScenePayload> {
    if (!story.currentMapId) throw new Error("This story has no world yet.");

    const map = await db.query.maps.findFirst({ where: eq(maps.id, story.currentMapId) });
    if (!map) throw new Error("The current map is missing.");

    const [features, mapPortals, cast, foes] = await Promise.all([
        db.query.mapFeatures.findMany({ where: eq(mapFeatures.mapId, map.id) }),
        db.query.portals.findMany({ where: eq(portals.mapId, map.id) }),
        db.query.characters.findMany({
            where: and(eq(characters.mapId, map.id), eq(characters.status, "alive")),
            with: { relationship: true },
        }),
        db.query.enemies.findMany({ where: eq(enemies.mapId, map.id) }),
    ]);

    return {
        map: {
            id: map.id,
            name: map.name,
            kind: map.kind,
            templateKey: map.templateKey,
            biome: map.biome,
            width: map.width,
            height: map.height,
        },
        features: features.map((f) => ({
            id: f.id, kind: f.kind, name: f.name, x: f.x, y: f.y, interactive: f.interactive,
        })),
        portals: mapPortals.map((p) => ({ id: p.id, x: p.x, y: p.y, label: p.label })),
        characters: cast.map((c) => ({
            id: c.id, name: c.name, role: c.role, mood: c.mood, spriteKey: c.spriteKey,
            x: c.x, y: c.y, affinity: c.relationship?.affinity ?? 0,
        })),
        enemies: foes.map((e) => ({
            id: e.id, name: e.name, description: e.description, tier: e.tier,
            spriteKey: e.spriteKey, status: e.status, x: e.x, y: e.y,
        })),
        player: { mapId: map.id, x: story.x, y: story.y },
    };
}

/** one compact paragraph describing "here and now" for any AI brief */
export async function sceneBrief(story: Story): Promise<string> {
    if (!story.currentMapId) return "Nowhere yet.";
    const map = await db.query.maps.findFirst({ where: eq(maps.id, story.currentMapId) });
    if (!map) return "Nowhere yet.";

    const [cast, foes, features] = await Promise.all([
        db.query.characters.findMany({
            where: and(eq(characters.mapId, map.id), eq(characters.status, "alive")),
        }),
        db.query.enemies.findMany({
            where: and(eq(enemies.mapId, map.id), eq(enemies.status, "alive")),
        }),
        db.query.mapFeatures.findMany({
            where: and(eq(mapFeatures.mapId, map.id), eq(mapFeatures.interactive, true)),
        }),
    ]);

    const lines = [
        `Place: ${map.name} (${map.biome}). ${map.ambience}`,
        cast.length > 0 ? `Present: ${cast.map((c) => `${c.name} (${c.role}, mood ${c.mood})`).join("; ")}.` : "No one else is here.",
        foes.length > 0 ? `Lurking: ${foes.map((e) => e.name).join(", ")}.` : "",
        features.length > 0 ? `Notable: ${features.map((f) => f.name).join(", ")}.` : "",
    ];
    return lines.filter(Boolean).join("\n");
}

/**
 * Clamp + persist the player's position and return the story as-moved.
 * Position is cosmetic (movement is client-smooth); what matters — answers,
 * progress, world changes — is validated elsewhere. Interaction intents call
 * this first so proximity checks don't lag behind the walk.
 */
export async function syncPosition(story: Story, p: Point): Promise<Story> {
    if (!story.currentMapId) return story;
    const map = await db.query.maps.findFirst({ where: eq(maps.id, story.currentMapId) });
    if (!map) return story;
    const clamped = clampToMap(p, map.width, map.height);
    await db.update(stories).set({ x: clamped.x, y: clamped.y }).where(eq(stories.id, story.id));
    return { ...story, x: clamped.x, y: clamped.y };
}

/** the player walks through a door/exit */
export async function travelThroughPortal(story: Story, portalId: string): Promise<{ map: GameMap; x: number; y: number }> {
    const portal = await db.query.portals.findFirst({ where: eq(portals.id, portalId) });
    if (!portal || portal.mapId !== story.currentMapId) throw new Error("That way is not open from here.");
    if (!withinInteractRange({ x: story.x, y: story.y }, portal)) throw new Error("Step closer to the way out first.");

    const target = await db.query.maps.findFirst({ where: eq(maps.id, portal.targetMapId) });
    if (!target || target.storyId !== story.id) throw new Error("That path leads nowhere.");

    await db.update(stories).set({
        currentMapId: target.id,
        x: portal.targetX,
        y: portal.targetY,
    }).where(eq(stories.id, story.id));

    return { map: target, x: portal.targetX, y: portal.targetY };
}

/** collect dictionary entries for every vocab segment so the client can show meanings instantly */
export async function wordEntriesFor(segmentGroups: Segment[][]): Promise<WordEntry[]> {
    const ids = [...new Set(
        segmentGroups.flat().flatMap((s) => (s.t === "vocab" ? [s.wordId] : [])),
    )];
    if (ids.length === 0) return [];
    const rows = await db.query.vocabWords.findMany({ where: inArray(vocabWords.id, ids) });
    return rows.map((w) => ({ id: w.id, term: w.term, meaning: w.meaning, pronunciation: w.pronunciation }));
}
