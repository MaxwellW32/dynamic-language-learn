/**
 * The shape of the ground. Built once per region into a height grid; every
 * later question ("how high is the ground under this foot?") is a cheap
 * lookup into that grid.
 */
import type { Biome } from "../looks";
import {
    GATE_SIDES, dist, distToTrail, reachAt, troddenAt,
    type RegionLayout, type Vec2,
} from "./layout";
import { clamp, fbm, lerp, smoothstep } from "./rng";

export type TerrainShape = {
    /** height of the long rolling swells */
    swell: number;
    /** height of the small bumps in rough ground */
    rough: number;
    /** how high the rim climbs around the region; negative sinks it into the sea */
    rim: number;
    /** sharpness of the rim: 1 rounded hills, 2+ crags */
    crag: number;
    /** water surface height, or null when the biome has no standing water */
    waterLevel: number | null;
};

export const TERRAIN: Record<Biome, TerrainShape> = {
    meadow: { swell: 3.2, rough: 0.7, rim: 22, crag: 1.1, waterLevel: null },
    forest: { swell: 4.2, rough: 1.0, rim: 26, crag: 1.2, waterLevel: null },
    autumn: { swell: 4.0, rough: 1.0, rim: 26, crag: 1.2, waterLevel: null },
    sakura: { swell: 3.6, rough: 0.8, rim: 30, crag: 1.5, waterLevel: null },
    snow: { swell: 4.5, rough: 0.9, rim: 40, crag: 1.9, waterLevel: null },
    desert: { swell: 5.0, rough: 0.6, rim: 24, crag: 1.4, waterLevel: null },
    coast: { swell: 2.2, rough: 0.5, rim: -9, crag: 1, waterLevel: -1.6 },
    swamp: { swell: 1.6, rough: 0.6, rim: 14, crag: 1, waterLevel: -0.9 },
    highland: { swell: 6.0, rough: 1.3, rim: 44, crag: 2.1, waterLevel: null },
    volcanic: { swell: 4.5, rough: 1.5, rim: 38, crag: 2.2, waterLevel: null },
    crystal: { swell: 3.0, rough: 1.4, rim: 46, crag: 2.4, waterLevel: null },
    twilight: { swell: 3.5, rough: 1.0, rim: 34, crag: 1.8, waterLevel: null },
};

const POND_DEPTH = 2.4;
export const POND_SURFACE = -0.55;

/** the rolling base of the land, before paths and bumps: what a road follows */
function swellAt(layout: RegionLayout, shape: TerrainShape, p: Vec2): number {
    return fbm(layout.spec.seed, p.x / 95, p.z / 95, 3) * shape.swell;
}

/** ground height at any point, computed from scratch (slow — use the grid at run time) */
export function computeHeight(layout: RegionLayout, p: Vec2): number {
    const shape = TERRAIN[layout.spec.biome];
    const seed = layout.spec.seed;
    const trodden = troddenAt(layout, p);

    let height = swellAt(layout, shape, p);
    height += fbm(seed + 7, p.x / 17, p.z / 17, 3) * shape.rough * (1 - trodden);

    // a building needs level ground: its plot settles to the height of its own middle
    for (const plot of layout.plots) {
        const reach = Math.max(plot.width, plot.depth) * 0.75;
        const d = dist(p, plot);
        if (d > reach + 4) continue;
        const level = swellAt(layout, shape, plot);
        height = lerp(height, level, 1 - smoothstep(reach, reach + 4, d));
    }
    if (layout.plaza) {
        const level = swellAt(layout, shape, layout.plaza);
        height = lerp(height, level, 1 - smoothstep(layout.plaza.r * 0.6, layout.plaza.r + 5, dist(p, layout.plaza)));
    }

    for (const pond of layout.ponds) {
        const d = dist(p, pond);
        if (d > pond.r + 3) continue;
        const bowl = 1 - smoothstep(pond.r * 0.35, pond.r + 3, d);
        height = lerp(height, POND_SURFACE - POND_DEPTH * bowl, bowl);
    }

    // the rim: hills, crags or open sea closing the region in
    const d = Math.hypot(p.x, p.z);
    const angle = Math.atan2(p.z, p.x);
    const reach = reachAt(seed, angle);
    let rim = smoothstep(reach + 1, reach + 34, d);
    if (rim > 0) {
        // open gates cut a pass through it
        let pass = 0;
        for (const side of GATE_SIDES) {
            const gate = layout.gates[side];
            if (!gate.open) continue;
            const gateAngle = Math.atan2(gate.z, gate.x);
            const off = Math.abs(Math.atan2(Math.sin(angle - gateAngle), Math.cos(angle - gateAngle))) * d;
            pass = Math.max(pass, 1 - smoothstep(5, 15, off));
        }
        rim *= 1 - pass * 0.96;
        if (shape.rim >= 0) {
            const ridged = 1 - Math.abs(fbm(seed + 53, p.x / 42, p.z / 42, 4));
            height += Math.pow(rim, 1 / shape.crag) * shape.rim * (0.55 + 0.45 * Math.pow(ridged, shape.crag));
        } else {
            height += rim * shape.rim;
        }
    }

    return height;
}

/* ------------------------------------------------------------------ */
/* the height grid                                                     */
/* ------------------------------------------------------------------ */

export type Heightfield = {
    /** cells per side; the grid holds (cells + 1)² samples */
    cells: number;
    half: number;
    step: number;
    data: Float32Array;
    /** ground height under a point, smoothly interpolated */
    at: (x: number, z: number) => number;
    /** steepness under a point: 0 level … 1 cliff */
    slopeAt: (x: number, z: number) => number;
};

export function buildHeightfield(layout: RegionLayout, cells = 160): Heightfield {
    const half = layout.half;
    const step = (half * 2) / cells;
    const side = cells + 1;
    const data = new Float32Array(side * side);

    for (let row = 0; row < side; row++) {
        const z = -half + row * step;
        for (let col = 0; col < side; col++) {
            data[row * side + col] = computeHeight(layout, { x: -half + col * step, z });
        }
    }

    const at = (x: number, z: number) => {
        const gx = clamp((x + half) / step, 0, cells - 0.0001);
        const gz = clamp((z + half) / step, 0, cells - 0.0001);
        const col = Math.floor(gx);
        const row = Math.floor(gz);
        const fx = gx - col;
        const fz = gz - row;
        const i = row * side + col;
        const top = data[i] + (data[i + 1] - data[i]) * fx;
        const bottom = data[i + side] + (data[i + side + 1] - data[i + side]) * fx;
        return top + (bottom - top) * fz;
    };

    const slopeAt = (x: number, z: number) => {
        const dx = at(x + step, z) - at(x - step, z);
        const dz = at(x, z + step) - at(x, z - step);
        return clamp(Math.hypot(dx, dz) / (step * 2.2), 0, 1);
    };

    return { cells, half, step, data, at, slopeAt };
}

/** a trail's own distance check, re-exported so scenery can keep clear of paths */
export const nearTrail = (layout: RegionLayout, p: Vec2, margin: number) =>
    layout.trails.some((trail) => distToTrail(p, trail) < trail.width * 0.5 + margin);
