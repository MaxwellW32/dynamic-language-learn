/**
 * Plants and rocks. Each species is sculpted once in a few variations; the
 * landscape is then thousands of *instances* of those few shapes, which the
 * graphics card draws in a handful of calls.
 *
 * Leaves are sculpted pure white and tinted per instance, so one oak shape can
 * be spring green here and autumn gold there.
 */
import * as THREE from "three";
import { createRng, type Rng } from "@/game/worldgen/rng";
import { Sculpt } from "./geo";
import type { BiomePalette, FloraKind } from "./palette";

export type Species = {
    kind: FloraKind;
    /** the shapes this species comes in */
    variants: THREE.BufferGeometry[];
    /** how far around its foot the hero cannot walk; 0 for things you walk through */
    footprint: number;
    /** whether instances take a leaf tint (trees) or keep their sculpted colours (rocks) */
    tinted: boolean;
    sways: boolean;
    /** lit from within, 0..1 */
    glow: number;
    minScale: number;
    maxScale: number;
    castsShadow: boolean;
};

const WHITE = 0xffffff;

function oak(rng: Rng, trunk: number): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(2.2, 3.2);
    s.cylinder(0.22, 0.38, height, trunk, { at: [0, height / 2, 0] }, 6);
    const crowns = rng.int(3, 5);
    for (let i = 0; i < crowns; i++) {
        const r = rng.range(1.3, 2.1);
        s.ball(r, WHITE, {
            at: [rng.range(-1.1, 1.1), height + rng.range(0.2, 1.6), rng.range(-1.1, 1.1)],
            scale: [1, rng.range(0.75, 0.95), 1],
            rot: [rng.range(0, 3), rng.range(0, 3), 0],
        }, 1, rng.range(-0.08, 0.02));
    }
    return s.build();
}

function pine(rng: Rng, trunk: number): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(5.5, 8.5);
    s.cylinder(0.14, 0.3, height * 0.4, trunk, { at: [0, height * 0.2, 0] }, 6);
    const tiers = rng.int(3, 5);
    for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        s.cone((1 - t * 0.72) * rng.range(1.7, 2.1), height * 0.42, WHITE, {
            at: [0, height * (0.34 + t * 0.56), 0],
            rot: [0, rng.range(0, 3), 0],
        }, 7, -0.05 + t * 0.06);
    }
    return s.build();
}

function birch(rng: Rng): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(4.2, 5.8);
    s.cylinder(0.11, 0.17, height, 0xe9e4d8, { at: [0, height / 2, 0], rot: [0, 0, rng.range(-0.05, 0.05)] }, 6);
    for (let i = 0; i < 3; i++) s.box(0.24, 0.07, 0.24, 0x3a342e, { at: [0, height * (0.2 + i * 0.22), 0] });
    for (let i = 0; i < 4; i++) {
        s.ball(rng.range(0.8, 1.25), WHITE, {
            at: [rng.range(-0.7, 0.7), height * rng.range(0.72, 1.08), rng.range(-0.7, 0.7)],
            scale: [1, 1.25, 1],
        }, 1, rng.range(-0.05, 0.04));
    }
    return s.build();
}

function sakura(rng: Rng, trunk: number): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(2.0, 2.8);
    s.cylinder(0.2, 0.36, height, trunk, { at: [0, height / 2, 0], rot: [0, 0, rng.range(-0.12, 0.12)] }, 6);
    // spreading boughs, each ending in a cloud of blossom
    const boughs = rng.int(4, 6);
    for (let i = 0; i < boughs; i++) {
        const angle = (i / boughs) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const reach = rng.range(1.2, 2.2);
        const lift = rng.range(0.6, 1.5);
        s.cylinder(0.07, 0.13, reach * 1.2, trunk, {
            at: [Math.cos(angle) * reach * 0.5, height + lift * 0.4, Math.sin(angle) * reach * 0.5],
            rot: [Math.sin(angle) * 0.9, 0, -Math.cos(angle) * 0.9],
        }, 5);
        s.ball(rng.range(1.0, 1.5), WHITE, {
            at: [Math.cos(angle) * reach, height + lift, Math.sin(angle) * reach],
            scale: [1.15, 0.7, 1.15],
        }, 1, rng.range(-0.04, 0.05));
    }
    s.ball(1.5, WHITE, { at: [0, height + 1.5, 0], scale: [1.1, 0.75, 1.1] }, 1);
    return s.build();
}

function palm(rng: Rng, trunk: number): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(5, 7);
    const lean = rng.range(-0.18, 0.18);
    const segments = 5;
    for (let i = 0; i < segments; i++) {
        const t = i / segments;
        s.cylinder(0.2 - t * 0.06, 0.24 - t * 0.06, height / segments + 0.1, trunk, {
            at: [Math.sin(lean * 2.2 * t) * height * t * 0.5, height * (t + 0.5 / segments), 0],
            rot: [0, 0, -lean * (0.5 + t)],
        }, 6, i % 2 === 0 ? 0 : -0.04);
    }
    const topX = Math.sin(lean * 2.2) * height * 0.5;
    const fronds = rng.int(6, 8);
    for (let i = 0; i < fronds; i++) {
        const angle = (i / fronds) * Math.PI * 2;
        s.box(0.7, 0.08, 2.8, WHITE, {
            at: [topX + Math.sin(angle) * 1.25, height - 0.25, Math.cos(angle) * 1.25],
            rot: [0.55, angle, 0],
        }, i % 2 === 0 ? 0 : -0.06);
    }
    s.ball(0.3, 0x6b4a2a, { at: [topX, height - 0.15, 0] }, 0);
    return s.build();
}

function cactus(rng: Rng): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(2.2, 3.6);
    const green = 0x5f9a54;
    s.cylinder(0.32, 0.36, height, green, { at: [0, height / 2, 0] }, 7);
    s.ball(0.33, green, { at: [0, height, 0] }, 1);
    const arms = rng.int(1, 2);
    for (let i = 0; i < arms; i++) {
        const dir = i === 0 ? 1 : -1;
        const y = height * rng.range(0.35, 0.6);
        s.cylinder(0.2, 0.2, 0.7, green, { at: [dir * 0.6, y, 0], rot: [0, 0, Math.PI / 2] }, 6);
        s.cylinder(0.2, 0.2, 1.0, green, { at: [dir * 0.9, y + 0.5, 0] }, 6);
        s.ball(0.2, green, { at: [dir * 0.9, y + 1.0, 0] }, 1);
    }
    if (rng.chance(0.5)) s.ball(0.14, 0xf25c78, { at: [0.1, height + 0.3, 0] }, 0);
    return s.build();
}

function deadtree(rng: Rng, trunk: number): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(3, 4.5);
    s.cylinder(0.12, 0.3, height, trunk, { at: [0, height / 2, 0], rot: [0, 0, rng.range(-0.1, 0.1)] }, 5);
    for (let i = 0; i < 4; i++) {
        const angle = rng.range(0, Math.PI * 2);
        const length = rng.range(1, 1.9);
        s.cylinder(0.03, 0.09, length, trunk, {
            at: [Math.cos(angle) * length * 0.35, height * rng.range(0.55, 0.95), Math.sin(angle) * length * 0.35],
            rot: [Math.sin(angle) * 1.0, 0, -Math.cos(angle) * 1.0],
        }, 4, -0.03);
    }
    return s.build();
}

function willow(rng: Rng, trunk: number): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(3.2, 4.2);
    s.cylinder(0.26, 0.45, height, trunk, { at: [0, height / 2, 0] }, 6);
    s.ball(2.2, WHITE, { at: [0, height + 0.9, 0], scale: [1.15, 0.6, 1.15] }, 1);
    const strands = 11;
    for (let i = 0; i < strands; i++) {
        const angle = (i / strands) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const reach = rng.range(1.7, 2.4);
        const drop = rng.range(2.0, 3.2);
        s.box(0.5, drop, 0.16, WHITE, {
            at: [Math.cos(angle) * reach, height + 0.7 - drop / 2, Math.sin(angle) * reach],
            rot: [0, -angle, 0],
        }, rng.range(-0.08, 0));
    }
    return s.build();
}

function mushroomtree(rng: Rng): THREE.BufferGeometry {
    const s = new Sculpt();
    const height = rng.range(2.4, 4.2);
    s.cylinder(0.24, 0.4, height, 0xe8dfcf, { at: [0, height / 2, 0] }, 7);
    const r = rng.range(1.5, 2.4);
    s.ball(r, WHITE, { at: [0, height, 0], scale: [1, 0.48, 1] }, 1);
    s.disc(r * 0.92, 0xf3ead8, { at: [0, height - 0.04, 0], rot: [Math.PI, 0, 0] }, 10);
    for (let i = 0; i < 5; i++) {
        const angle = rng.range(0, Math.PI * 2);
        const d = rng.range(0.3, r * 0.7);
        s.ball(rng.range(0.13, 0.24), 0xfff6e0, { at: [Math.cos(angle) * d, height + r * 0.4 * (1 - d / r) + 0.1, Math.sin(angle) * d] }, 0);
    }
    return s.build();
}

function crystalspire(rng: Rng): THREE.BufferGeometry {
    const s = new Sculpt();
    const shards = rng.int(3, 5);
    for (let i = 0; i < shards; i++) {
        const height = i === 0 ? rng.range(2.6, 4.2) : rng.range(1, 2.4);
        const angle = rng.range(0, Math.PI * 2);
        const d = i === 0 ? 0 : rng.range(0.4, 0.9);
        const tilt = i === 0 ? 0 : rng.range(0.2, 0.5);
        const r = height * 0.16;
        const at: [number, number, number] = [Math.cos(angle) * d, height * 0.5, Math.sin(angle) * d];
        const rot: [number, number, number] = [Math.sin(angle) * tilt, 0, -Math.cos(angle) * tilt];
        s.cylinder(r, r * 0.85, height * 0.8, WHITE, { at, rot }, 5, rng.range(-0.06, 0.04));
        s.cone(r, height * 0.3, WHITE, {
            at: [at[0] - rot[2] * height * 0.5, height * 0.95, at[2] + rot[0] * height * 0.5],
            rot,
        }, 5, 0.06);
    }
    return s.build();
}

function bush(rng: Rng): THREE.BufferGeometry {
    const s = new Sculpt();
    const blobs = rng.int(2, 4);
    for (let i = 0; i < blobs; i++) {
        s.ball(rng.range(0.45, 0.8), WHITE, {
            at: [rng.range(-0.5, 0.5), rng.range(0.3, 0.55), rng.range(-0.5, 0.5)],
            scale: [1, 0.8, 1],
        }, 1, rng.range(-0.06, 0.03));
    }
    if (rng.chance(0.4)) {
        for (let i = 0; i < 4; i++) {
            s.ball(0.08, 0xd9483b, { at: [rng.range(-0.6, 0.6), rng.range(0.4, 0.9), rng.range(-0.6, 0.6)] }, 0);
        }
    }
    return s.build();
}

function rock(rng: Rng, color: number): THREE.BufferGeometry {
    const s = new Sculpt();
    const lumps = rng.int(1, 3);
    for (let i = 0; i < lumps; i++) {
        const r = i === 0 ? rng.range(0.7, 1.4) : rng.range(0.35, 0.7);
        s.ball(r, color, {
            at: [i === 0 ? 0 : rng.range(-1, 1), r * 0.35, i === 0 ? 0 : rng.range(-1, 1)],
            scale: [rng.range(0.9, 1.35), rng.range(0.55, 0.95), rng.range(0.9, 1.25)],
            rot: [rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)],
        }, 0, rng.range(-0.05, 0.05));
    }
    return s.build();
}

function fern(rng: Rng): THREE.BufferGeometry {
    const s = new Sculpt();
    const fronds = rng.int(5, 7);
    for (let i = 0; i < fronds; i++) {
        const angle = (i / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
        s.box(0.2, 0.04, 0.85, WHITE, {
            at: [Math.sin(angle) * 0.36, 0.3, Math.cos(angle) * 0.36],
            rot: [-0.6, angle, 0],
        }, rng.range(-0.05, 0.03));
    }
    return s.build();
}

function reed(rng: Rng): THREE.BufferGeometry {
    const s = new Sculpt();
    const stalks = rng.int(4, 7);
    for (let i = 0; i < stalks; i++) {
        const height = rng.range(1.1, 1.9);
        const x = rng.range(-0.35, 0.35);
        const z = rng.range(-0.35, 0.35);
        s.cylinder(0.025, 0.035, height, WHITE, { at: [x, height / 2, z], rot: [rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1)] }, 4);
        if (rng.chance(0.6)) s.cylinder(0.06, 0.06, 0.3, 0x6b4a2f, { at: [x, height, z] }, 5);
    }
    return s.build();
}

const VARIANTS = 3;

/** the species a biome grows, each sculpted in a few shapes */
export function buildSpecies(palette: BiomePalette, seed: number, dark = false): Species[] {
    const rng = createRng(seed ^ 0x51ed);
    const sculptors: Record<FloraKind, { make: (r: Rng) => THREE.BufferGeometry } & Omit<Species, "kind" | "variants">> = {
        oak: { make: (r) => oak(r, palette.trunk), footprint: 0.55, tinted: true, sways: true, glow: 0, minScale: 0.85, maxScale: 1.35, castsShadow: true },
        pine: { make: (r) => pine(r, palette.trunk), footprint: 0.5, tinted: true, sways: true, glow: 0, minScale: 0.8, maxScale: 1.3, castsShadow: true },
        birch: { make: (r) => birch(r), footprint: 0.35, tinted: true, sways: true, glow: 0, minScale: 0.85, maxScale: 1.25, castsShadow: true },
        sakura: { make: (r) => sakura(r, palette.trunk), footprint: 0.55, tinted: true, sways: true, glow: 0, minScale: 0.9, maxScale: 1.35, castsShadow: true },
        palm: { make: (r) => palm(r, palette.trunk), footprint: 0.4, tinted: true, sways: true, glow: 0, minScale: 0.85, maxScale: 1.2, castsShadow: true },
        cactus: { make: (r) => cactus(r), footprint: 0.5, tinted: false, sways: false, glow: 0, minScale: 0.8, maxScale: 1.3, castsShadow: true },
        deadtree: { make: (r) => deadtree(r, palette.trunk), footprint: 0.45, tinted: false, sways: false, glow: 0, minScale: 0.85, maxScale: 1.3, castsShadow: true },
        willow: { make: (r) => willow(r, palette.trunk), footprint: 0.6, tinted: true, sways: true, glow: 0, minScale: 0.9, maxScale: 1.3, castsShadow: true },
        mushroomtree: { make: (r) => mushroomtree(r), footprint: 0.5, tinted: true, sways: false, glow: dark ? 0.4 : 0, minScale: 0.7, maxScale: 1.4, castsShadow: true },
        crystalspire: { make: (r) => crystalspire(r), footprint: 0.9, tinted: true, sways: false, glow: 0.75, minScale: 0.7, maxScale: 1.5, castsShadow: true },
        bush: { make: (r) => bush(r), footprint: 0, tinted: true, sways: true, glow: 0, minScale: 0.8, maxScale: 1.4, castsShadow: false },
        rock: { make: (r) => rock(r, palette.rock), footprint: 0.9, tinted: false, sways: false, glow: 0, minScale: 0.6, maxScale: 1.7, castsShadow: true },
        fern: { make: (r) => fern(r), footprint: 0, tinted: true, sways: true, glow: 0, minScale: 0.8, maxScale: 1.5, castsShadow: false },
        reed: { make: (r) => reed(r), footprint: 0, tinted: true, sways: true, glow: 0, minScale: 0.8, maxScale: 1.3, castsShadow: false },
    };

    const species: Species[] = [];
    for (const kind of Object.keys(palette.flora) as FloraKind[]) {
        const { make, ...traits } = sculptors[kind];
        const variants: THREE.BufferGeometry[] = [];
        for (let i = 0; i < VARIANTS; i++) variants.push(make(rng.fork(kind.length * 31 + i)));
        species.push({ kind, variants, ...traits });
    }
    return species;
}

/**
 * A tuft of grass: a fan of single-triangle blades, grey so that each
 * instance can take its own green, darker at the root than at the tip. Every
 * normal points straight up — a blade is lit exactly like the ground it grows
 * from, so grass reads as texture on the land rather than as dark spikes.
 */
export function grassTuft(): THREE.BufferGeometry {
    const rng = createRng(0x6a55);
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const blades = 7;
    for (let i = 0; i < blades; i++) {
        const angle = (i / blades) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const reach = rng.range(0.03, 0.2);
        const height = rng.range(0.28, 0.58);
        const half = rng.range(0.035, 0.06);
        const lean = rng.range(0.08, 0.26);
        const rootX = Math.cos(angle) * reach;
        const rootZ = Math.sin(angle) * reach;
        // the blade is broad across the direction it leans in
        const acrossX = -Math.sin(angle) * half;
        const acrossZ = Math.cos(angle) * half;
        positions.push(
            rootX - acrossX, 0, rootZ - acrossZ,
            rootX + acrossX, 0, rootZ + acrossZ,
            rootX + Math.cos(angle) * lean, height, rootZ + Math.sin(angle) * lean,
        );
        normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
        colors.push(0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 1.08, 1.08, 1.08);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
}

/** a flower: stem and a bright head, tinted per instance */
export function flower(): THREE.BufferGeometry {
    const s = new Sculpt();
    s.cylinder(0.018, 0.018, 0.4, 0x5a9a48, { at: [0, 0.2, 0] }, 4);
    s.ball(0.11, WHITE, { at: [0, 0.44, 0], scale: [1, 0.6, 1] }, 0);
    return s.build();
}
