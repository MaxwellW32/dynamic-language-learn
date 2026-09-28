/**
 * A made-up scene for looking at a region without a story or a database: the
 * engine preview at /dev/world uses it, and so can tests. Everything is
 * derived from the seed, so the same address always shows the same place.
 */
import {
    ACCESSORIES, AGES, BOSS_KINDS, BUILDS, CLOTH_COLORS, CREATURE_KINDS, CREATURE_TINTS, HAIR_COLORS,
    HAIR_STYLES, HATS, OUTFITS, SKIN_TONES, type ActorLook, type Biome, type CreatureLook,
} from "../looks";
import type { ScenePayload } from "../payloads";
import { generateLayout, type GateSide, type RegionKind } from "./layout";
import { createRng, type Rng } from "./rng";

const keys = <T extends object>(object: T) => Object.keys(object) as (keyof T)[];

export function randomLook(rng: Rng): ActorLook {
    return {
        build: rng.pick(BUILDS),
        age: rng.chance(0.15) ? "elder" : rng.chance(0.12) ? "child" : rng.pick(AGES),
        skin: rng.pick(keys(SKIN_TONES)),
        hair: rng.pick(HAIR_STYLES),
        hairColor: rng.pick(keys(HAIR_COLORS)),
        beard: rng.chance(0.2),
        outfit: rng.pick(OUTFITS),
        primary: rng.pick(keys(CLOTH_COLORS)),
        secondary: rng.pick(keys(CLOTH_COLORS)),
        hat: rng.chance(0.45) ? rng.pick(HATS) : "none",
        accessory: rng.chance(0.5) ? rng.pick(ACCESSORIES) : "none",
    };
}

export function randomCreature(rng: Rng, tier: "minion" | "elite" | "boss"): CreatureLook {
    return {
        kind: tier === "boss" ? rng.pick(BOSS_KINDS) : rng.pick(CREATURE_KINDS),
        tint: rng.pick(keys(CREATURE_TINTS)),
        scale: rng.range(0.9, 1.2),
    };
}

const NAMES = ["Marisol", "Teo", "Ines", "Bruno", "Yuki", "Aldo", "Camila", "Rafa", "Noa", "Esteban"];
const ROLES = ["innkeeper", "baker", "blacksmith", "herbalist", "fisher", "scholar", "guard", "weaver", "wanderer", "bell-ringer"];

export function mockScene(options: {
    seed: number;
    kind: RegionKind;
    biome: Biome;
    timeOfDay: string;
    weather: string;
    styleKit: string;
    gates?: GateSide[];
}): ScenePayload {
    const openSides = options.gates ?? (options.kind === "settlement" ? ["e"] : options.kind === "wilds" ? ["w", "e"] : ["w"]);
    const layout = generateLayout({ seed: options.seed, kind: options.kind, biome: options.biome, gates: openSides });
    const rng = createRng(options.seed ^ 0xbeef);

    return {
        region: {
            id: "mock-region",
            name: options.kind === "settlement" ? "Villa Alondra" : options.kind === "wilds" ? "The Whispering Wilds" : "The Hollow Below",
            kind: options.kind,
            biome: options.biome,
            timeOfDay: options.timeOfDay,
            weather: options.weather,
            seed: options.seed,
            openSides,
            styleKit: options.styleKit,
            description: "",
        },
        buildings: layout.plots.map((plot, i) => ({
            id: `b${i}`, kind: plot.kind, name: plot.kind,
            x: plot.x, z: plot.z, rot: plot.rot, width: plot.width, depth: plot.depth, variant: plot.variant,
        })),
        landmarks: layout.landmarkSlots.map((slot, i) => ({
            id: `l${i}`,
            kind: slot.suggested[i % slot.suggested.length],
            name: slot.suggested[i % slot.suggested.length],
            x: slot.x, z: slot.z, rot: slot.rot,
            label: null,
            examined: false,
            sought: i === 1,
        })),
        gates: openSides.map((side, i) => ({
            id: `g${i}`, side,
            x: layout.gates[side].x, z: layout.gates[side].z, rot: layout.gates[side].rot,
            label: "To the road beyond",
            sought: i === 0,
        })),
        characters: layout.npcSlots.slice(0, 7).map((slot, i) => ({
            id: `c${i}`,
            name: NAMES[i % NAMES.length],
            role: ROLES[i % ROLES.length],
            mood: "calm",
            look: randomLook(rng),
            x: slot.x, z: slot.z, rot: slot.rot,
            affinity: 0,
            barks: [[{ t: "tl", v: "¡Buenos días!", tr: "Good morning!", tk: [{ s: "¡" }, { s: "Buenos" }, { s: " " }, { s: "días" }, { s: "!" }] }]],
            sought: i === 0,
            met: i % 2 === 0,
        })),
        enemies: [
            ...layout.mobSlots.map((slot, i) => ({
                id: `e${i}`,
                name: "Wordling",
                description: "",
                tier: slot.tier,
                look: randomCreature(rng, slot.tier),
                x: slot.x, z: slot.z,
                sought: false,
            })),
            ...(layout.bossSlot ? [{
                id: "boss",
                name: "The Silence",
                description: "",
                tier: "boss" as const,
                look: randomCreature(rng, "boss"),
                x: layout.bossSlot.x, z: layout.bossSlot.z,
                sought: true,
            }] : []),
        ],
        hero: {
            name: "Hero",
            look: { build: "average", age: "adult", skin: "tan", hair: "short", hairColor: "brown", beard: false, outfit: "cloak", primary: "teal", secondary: "crimson", hat: "none", accessory: "satchel" },
            x: layout.spawn.x, z: layout.spawn.z, rot: layout.spawn.rot,
        },
    };
}
