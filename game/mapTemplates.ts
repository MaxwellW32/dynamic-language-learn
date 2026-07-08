import type { Point } from "./geometry";

/**
 * Maps are handcrafted, not generated: every template's geometry (sizes, slot
 * positions) is authored here so layouts are always readable and playable.
 * The world-forge AI only *fills* slots — names, lore, cast — it never invents
 * geometry. This is both the "focused handcrafted maps" requirement and an
 * anti-hallucination boundary.
 */

export type MapKind = "settlement" | "wilds" | "dungeon" | "interior";

export type FeatureSlot = {
    kind: string;
    x: number;
    y: number;
    /** interactive features get AI-named lore and an Inspect action */
    interactive?: boolean;
};

export type MapTemplate = {
    key: string;
    kind: MapKind;
    width: number;
    height: number;
    /** where the player stands when arriving without a portal target */
    spawn: Point;
    features: FeatureSlot[];
    npcSlots: Point[];
    enemySlots: Point[];
    bossSlot?: Point;
    /** named anchor points the world blueprint wires portals into */
    portalSlots: Record<string, Point>;
};

export const MAP_TEMPLATES: Record<string, MapTemplate> = {
    village: {
        key: "village",
        kind: "settlement",
        width: 32,
        height: 18,
        spawn: { x: 16, y: 12 },
        features: [
            { kind: "building", x: 7, y: 5, interactive: true },   // slot 0: the tavern (door portal wired below)
            { kind: "building", x: 16, y: 4, interactive: true },
            { kind: "building", x: 25, y: 6, interactive: true },
            { kind: "well", x: 15, y: 9, interactive: true },
            { kind: "sign", x: 18.5, y: 12, interactive: true },
            { kind: "garden", x: 10, y: 13 },
            { kind: "tree", x: 3, y: 3 },
            { kind: "tree", x: 28, y: 14 },
            { kind: "tree", x: 4, y: 15 },
            { kind: "lantern", x: 21, y: 9 },
        ],
        npcSlots: [
            { x: 13, y: 10 },
            { x: 20, y: 6.5 },
            { x: 24, y: 11 },
            { x: 8, y: 11 },
        ],
        enemySlots: [{ x: 29, y: 3 }],
        portalSlots: {
            east: { x: 31, y: 10 },
            "tavern-door": { x: 7, y: 7 },
        },
    },

    forest: {
        key: "forest",
        kind: "wilds",
        width: 32,
        height: 18,
        spawn: { x: 3, y: 10 },
        features: [
            { kind: "tree", x: 6, y: 4 },
            { kind: "tree", x: 11, y: 7 },
            { kind: "tree", x: 9, y: 14 },
            { kind: "tree", x: 17, y: 3 },
            { kind: "tree", x: 22, y: 12 },
            { kind: "tree", x: 27, y: 8 },
            { kind: "tree", x: 15, y: 16 },
            { kind: "campfire", x: 13, y: 11, interactive: true },
            { kind: "bridge", x: 19, y: 9, interactive: true },
            { kind: "rock", x: 24, y: 15 },
            { kind: "sign", x: 5, y: 9, interactive: true },
        ],
        npcSlots: [
            { x: 14, y: 12.5 },
            { x: 25, y: 5 },
        ],
        enemySlots: [
            { x: 10, y: 4.5 },
            { x: 21, y: 14 },
            { x: 28, y: 11 },
            { x: 17, y: 6 },
        ],
        portalSlots: {
            west: { x: 1, y: 10 },
            deep: { x: 30, y: 4 },
        },
    },

    cave: {
        key: "cave",
        kind: "dungeon",
        width: 28,
        height: 16,
        spawn: { x: 3, y: 12 },
        features: [
            { kind: "rock", x: 6, y: 5 },
            { kind: "rock", x: 12, y: 13 },
            { kind: "crystal", x: 10, y: 7, interactive: true },
            { kind: "crystal", x: 19, y: 4, interactive: true },
            { kind: "chest", x: 24, y: 12, interactive: true },
            { kind: "statue", x: 16, y: 9, interactive: true },
        ],
        npcSlots: [{ x: 7, y: 11 }],
        enemySlots: [
            { x: 13, y: 5 },
            { x: 18, y: 12 },
        ],
        bossSlot: { x: 23, y: 6 },
        portalSlots: {
            mouth: { x: 2, y: 13 },
        },
    },

    tavern: {
        key: "tavern",
        kind: "interior",
        width: 16,
        height: 10,
        spawn: { x: 8, y: 7 },
        features: [
            { kind: "counter", x: 4, y: 3, interactive: true },
            { kind: "hearth", x: 12, y: 2.5, interactive: true },
            { kind: "table", x: 8, y: 5 },
            { kind: "table", x: 12, y: 6.5 },
            { kind: "bookshelf", x: 1.5, y: 2, interactive: true },
        ],
        npcSlots: [
            { x: 5, y: 4.5 },
            { x: 11, y: 4 },
        ],
        enemySlots: [],
        portalSlots: {
            door: { x: 8, y: 9 },
        },
    },
};

/* ---------------------------------------------------------------- */
/* the v1 world graph: which maps exist and how portals connect them */
/* ---------------------------------------------------------------- */

export type WorldBlueprint = {
    /** `ref` is the stable key the forge AI uses to talk about a map */
    maps: { ref: string; templateKey: string }[];
    startMapRef: string;
    links: {
        from: { map: string; portal: string };
        to: { map: string; portal: string };
    }[];
};

export const WORLD_BLUEPRINT: WorldBlueprint = {
    maps: [
        { ref: "village", templateKey: "village" },
        { ref: "wilds", templateKey: "forest" },
        { ref: "depths", templateKey: "cave" },
        { ref: "tavern", templateKey: "tavern" },
    ],
    startMapRef: "village",
    links: [
        { from: { map: "village", portal: "east" }, to: { map: "wilds", portal: "west" } },
        { from: { map: "wilds", portal: "deep" }, to: { map: "depths", portal: "mouth" } },
        { from: { map: "village", portal: "tavern-door" }, to: { map: "tavern", portal: "door" } },
    ],
};

/** where the player lands when coming through a portal: just inside, toward the map center */
export function arrivalPoint(template: MapTemplate, portal: Point): Point {
    const cx = template.width / 2;
    const cy = template.height / 2;
    const dx = cx - portal.x;
    const dy = cy - portal.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: portal.x + (dx / len) * 1.6, y: portal.y + (dy / len) * 1.6 };
}
