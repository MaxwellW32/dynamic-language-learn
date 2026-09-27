/**
 * Colour and light. A biome says what the land is made of; the time of day
 * says how it is lit. The two are kept apart so that any place can be seen at
 * any hour.
 */
import * as THREE from "three";
import type { Biome, TimeOfDay, Weather } from "@/game/looks";

export type FloraKind =
    | "oak" | "pine" | "birch" | "sakura" | "palm" | "cactus" | "deadtree" | "willow"
    | "mushroomtree" | "crystalspire" | "bush" | "rock" | "fern" | "reed";

export type BiomePalette = {
    /** two grass tones the ground blends between */
    grassA: number;
    grassB: number;
    /** bare earth on paths */
    path: number;
    /** paving in a settlement plaza */
    paving: number;
    /** steep ground and rim crags */
    rock: number;
    /** the tops of the rim */
    peak: number;
    /** shorelines and pond beds */
    shore: number;
    water: number;
    /** what grows here and how thickly (relative weights) */
    flora: Partial<Record<FloraKind, number>>;
    /** trees and rocks per 100 m² in the rough */
    density: number;
    /** leaf tones trees pick from */
    leaves: number[];
    trunk: number;
    /** flower colours; empty means no flowers */
    flowers: number[];
    /** tufts of grass per 100 m² */
    tufts: number;
    /** tint laid over the daylight: a desert is warmer, a snowfield colder */
    lightTint: number;
    fogDensity: number;
    /** the weather this biome drifts into when none is given */
    weather: Weather;
};

export const BIOMES: Record<Biome, BiomePalette> = {
    meadow: {
        grassA: 0x7cba4e, grassB: 0x9bcb5a, path: 0xc8a871, paving: 0xcdbfa6, rock: 0x8d8a80, peak: 0xa9b59a,
        shore: 0xd9c794, water: 0x4aa3c8,
        flora: { oak: 3, birch: 2, bush: 3, rock: 1.2, fern: 1 },
        density: 0.55, leaves: [0x5fa044, 0x7ab648, 0x4f9348, 0x8cc152], trunk: 0x7a5a3a,
        flowers: [0xffffff, 0xf7d046, 0xe8627a, 0x9f7fe0, 0xf29a4a], tufts: 5,
        lightTint: 0xffffff, fogDensity: 0.0042, weather: "clear",
    },
    forest: {
        grassA: 0x4f8f45, grassB: 0x6aa64c, path: 0x9a7a52, paving: 0xb5a88f, rock: 0x767a73, peak: 0x88967e,
        shore: 0xbfae82, water: 0x3d8fae,
        flora: { pine: 4, oak: 3, bush: 2.5, rock: 1.4, fern: 3 },
        density: 1.25, leaves: [0x3f7d3e, 0x4f9144, 0x356b3a, 0x5a9a48], trunk: 0x5e4630,
        flowers: [0xffffff, 0xb79af0, 0xf7d046], tufts: 4,
        lightTint: 0xf2ffe8, fogDensity: 0.0075, weather: "fireflies",
    },
    autumn: {
        grassA: 0xa69a4a, grassB: 0xbfa24e, path: 0x9c7648, paving: 0xbfae94, rock: 0x857c72, peak: 0x9d917f,
        shore: 0xcab483, water: 0x4c8fa8,
        flora: { oak: 4, birch: 3, bush: 2, rock: 1.2, fern: 1 },
        density: 1.0, leaves: [0xd9772b, 0xe3a02f, 0xc2452d, 0xe8c547, 0xb5602a], trunk: 0x5f4430,
        flowers: [0xf2c14e, 0xd9534f], tufts: 3.5,
        lightTint: 0xfff0dc, fogDensity: 0.0062, weather: "petals",
    },
    sakura: {
        grassA: 0x7fbf6a, grassB: 0xa2d07a, path: 0xc9ab84, paving: 0xd8cbb8, rock: 0x8a8790, peak: 0xb9b3c4,
        shore: 0xe0cfa8, water: 0x5fb0cf,
        flora: { sakura: 5, pine: 1.5, bush: 2, rock: 1.2, fern: 1 },
        density: 0.8, leaves: [0xf7b7cf, 0xf29cbc, 0xfbd0de, 0xee86ad], trunk: 0x5b3f35,
        flowers: [0xffffff, 0xf7b7cf, 0xf2e27a], tufts: 4.5,
        lightTint: 0xfff4f6, fogDensity: 0.0048, weather: "petals",
    },
    snow: {
        grassA: 0xe9eef4, grassB: 0xf7f9fc, path: 0xc3c9d2, paving: 0xbfc5cd, rock: 0x7f8894, peak: 0xffffff,
        shore: 0xd5dde6, water: 0x6fa6c4,
        flora: { pine: 5, deadtree: 1.2, rock: 2, bush: 0.6 },
        density: 0.75, leaves: [0x3d6b57, 0x4a7a63, 0x567f6a], trunk: 0x4f3d31,
        flowers: [], tufts: 0.6,
        lightTint: 0xe6f1ff, fogDensity: 0.0068, weather: "snowfall",
    },
    desert: {
        grassA: 0xe2c07a, grassB: 0xecd093, path: 0xd2a868, paving: 0xd9bf94, rock: 0xb98a5c, peak: 0xcf9d68,
        shore: 0xe8d29a, water: 0x3fb0b8,
        flora: { cactus: 3, palm: 1.4, rock: 3, deadtree: 0.8, bush: 0.6 },
        density: 0.32, leaves: [0x6f9b4a, 0x88a856, 0x5f8a45], trunk: 0x8a6a45,
        flowers: [0xf25c54, 0xf7b267], tufts: 0.8,
        lightTint: 0xfff1d6, fogDensity: 0.0036, weather: "clear",
    },
    coast: {
        grassA: 0x86c25a, grassB: 0xa8d470, path: 0xdcc58d, paving: 0xe0d3b4, rock: 0x94908a, peak: 0xa9a59c,
        shore: 0xf0dfa6, water: 0x38b6d2,
        flora: { palm: 4, bush: 2.5, rock: 1.4, fern: 1.5, oak: 0.8 },
        density: 0.5, leaves: [0x4fa05a, 0x66b35f, 0x3f9160], trunk: 0x8b6c4a,
        flowers: [0xff7aa2, 0xffd166, 0xffffff, 0xf4845f], tufts: 4,
        lightTint: 0xfffbea, fogDensity: 0.0032, weather: "clear",
    },
    swamp: {
        grassA: 0x5b7f47, grassB: 0x718f4c, path: 0x7a6a4a, paving: 0x9a927c, rock: 0x646b60, peak: 0x76806d,
        shore: 0x6f7350, water: 0x4f7a5c,
        flora: { willow: 4, deadtree: 2, mushroomtree: 1, bush: 2, reed: 3, fern: 3, rock: 0.8 },
        density: 0.95, leaves: [0x557a3e, 0x6b8c45, 0x4a6b3a], trunk: 0x4a3c2c,
        flowers: [0xc9e265, 0xb497f0], tufts: 4,
        lightTint: 0xe8f5dc, fogDensity: 0.0115, weather: "mist",
    },
    highland: {
        grassA: 0x7aa657, grassB: 0x98b765, path: 0xa88f68, paving: 0xb7ad99, rock: 0x84817c, peak: 0xe8edf0,
        shore: 0xc3b58c, water: 0x4b94b8,
        flora: { pine: 3, rock: 4, bush: 2, birch: 1, fern: 1 },
        density: 0.6, leaves: [0x4b8047, 0x5f9450, 0x3f7145], trunk: 0x5d4632,
        flowers: [0xb79af0, 0xffffff, 0xf7d046], tufts: 4,
        lightTint: 0xf3f8ff, fogDensity: 0.0055, weather: "mist",
    },
    volcanic: {
        grassA: 0x4a4346, grassB: 0x5c5052, path: 0x6e5a52, paving: 0x7a6e6a, rock: 0x3a3235, peak: 0x8f3b26,
        shore: 0x5a4a44, water: 0xe8622a,
        flora: { deadtree: 3, rock: 5, crystalspire: 0.6 },
        density: 0.55, leaves: [0x6b3a2e, 0x8a4630], trunk: 0x2f2626,
        flowers: [0xff7b3a], tufts: 0.5,
        lightTint: 0xffe0cc, fogDensity: 0.0085, weather: "embers",
    },
    crystal: {
        grassA: 0x4c5a8a, grassB: 0x6473a8, path: 0x8a8fb4, paving: 0x9a9fc4, rock: 0x4a5278, peak: 0x6f7fbf,
        shore: 0x5a6288, water: 0x5fd0e8,
        flora: { crystalspire: 4, rock: 3, mushroomtree: 2, fern: 1 },
        density: 0.7, leaves: [0x6fd6e8, 0x9a8cf0, 0x5fb0e0], trunk: 0x3d3f5c,
        flowers: [0x8ff0ff, 0xc9a7ff], tufts: 1.2,
        lightTint: 0xdfe8ff, fogDensity: 0.0105, weather: "fireflies",
    },
    twilight: {
        grassA: 0x4f6a72, grassB: 0x5f7f80, path: 0x7a7488, paving: 0x8d88a0, rock: 0x4d5063, peak: 0x8088a8,
        shore: 0x6f7590, water: 0x5f8fd0,
        flora: { mushroomtree: 3, willow: 2, deadtree: 1.5, rock: 2, fern: 2, bush: 1.5 },
        density: 0.85, leaves: [0x6f8fd0, 0x9a7fd0, 0x5fa8b8, 0xd07fb8], trunk: 0x3f3a4f,
        flowers: [0xa8f0ff, 0xf0a8ff, 0xfff0a8], tufts: 3,
        lightTint: 0xe6e0ff, fogDensity: 0.0095, weather: "fireflies",
    },
};

export type Daylight = {
    skyTop: number;
    skyHorizon: number;
    /** colour of the glow around the sun or moon */
    glow: number;
    sun: number;
    sunStrength: number;
    /** light from the sky above and bounced from the ground below */
    ambientSky: number;
    ambientGround: number;
    ambientStrength: number;
    /** height of the sun above the horizon, radians */
    elevation: number;
    /** compass bearing of the sun, radians */
    azimuth: number;
    fog: number;
    stars: number;
    /** 0 dark windows … 1 every window lit */
    lamps: number;
    exposure: number;
};

export const DAYLIGHT: Record<TimeOfDay, Daylight> = {
    dawn: {
        skyTop: 0x6f93c9, skyHorizon: 0xf9c9a3, glow: 0xffb27a, sun: 0xffd2a1, sunStrength: 2.1,
        ambientSky: 0xb9cdec, ambientGround: 0x9a8a74, ambientStrength: 1.5,
        elevation: 0.36, azimuth: 1.15, fog: 0xf0cfb8, stars: 0.15, lamps: 0.5, exposure: 1.0,
    },
    day: {
        skyTop: 0x3f8fe0, skyHorizon: 0xbfe3f7, glow: 0xfff3c9, sun: 0xfff4dd, sunStrength: 2.9,
        ambientSky: 0xcfe3ff, ambientGround: 0x9aa47a, ambientStrength: 1.55,
        elevation: 0.95, azimuth: 0.7, fog: 0xcfe6f4, stars: 0, lamps: 0, exposure: 1.0,
    },
    golden: {
        skyTop: 0x4f7fc4, skyHorizon: 0xffd08a, glow: 0xffa64d, sun: 0xffc37a, sunStrength: 2.6,
        ambientSky: 0xd4d6e6, ambientGround: 0xa88a62, ambientStrength: 1.5,
        elevation: 0.42, azimuth: -1.0, fog: 0xf5d2a0, stars: 0, lamps: 0.35, exposure: 1.02,
    },
    dusk: {
        skyTop: 0x2f3f7a, skyHorizon: 0xf08a6a, glow: 0xff7a4f, sun: 0xffa273, sunStrength: 2.0,
        ambientSky: 0xa9a6dc, ambientGround: 0x8a6f72, ambientStrength: 1.75,
        elevation: 0.24, azimuth: -1.25, fog: 0xc98f8a, stars: 0.5, lamps: 0.9, exposure: 1.1,
    },
    night: {
        skyTop: 0x0c1533, skyHorizon: 0x2b3f73, glow: 0xa9c4ff, sun: 0xb9ceff, sunStrength: 1.5,
        ambientSky: 0x7f93d0, ambientGround: 0x4a4f78, ambientStrength: 1.9,
        elevation: 0.75, azimuth: 0.5, fog: 0x1f2c52, stars: 1, lamps: 1, exposure: 1.2,
    },
};

/** a biome's tint laid over a colour of light */
export function tinted(color: number, tint: number): THREE.Color {
    return new THREE.Color(color).multiply(new THREE.Color(tint));
}

/** where the sun stands, as a direction pointing from the ground toward it */
export function sunDirection(light: Daylight): THREE.Vector3 {
    const horizontal = Math.cos(light.elevation);
    return new THREE.Vector3(
        Math.sin(light.azimuth) * horizontal,
        Math.sin(light.elevation),
        Math.cos(light.azimuth) * horizontal,
    ).normalize();
}

export { isBiome, isTimeOfDay } from "@/game/looks";
