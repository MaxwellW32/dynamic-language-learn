/**
 * Deterministic randomness. The server lays a region out once and the browser
 * rebuilds the identical terrain from the same seed, so nothing here may depend
 * on the JavaScript engine: integer hashing only, no trigonometric tricks.
 */

export type Rng = {
    /** uniform in [0, 1) */
    next: () => number;
    range: (min: number, max: number) => number;
    int: (min: number, maxInclusive: number) => number;
    pick: <T>(list: readonly T[]) => T;
    chance: (probability: number) => boolean;
    /** a fresh stream that does not disturb this one */
    fork: (label: number) => Rng;
};

export function hash2(seed: number, x: number, y: number): number {
    let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(x | 0, 0x85ebca6b) ^ Math.imul(y | 0, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
}

export function hashString(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    }
    return h >>> 0;
}

export function createRng(seed: number): Rng {
    let state = (seed | 0) || 0x1234567;
    const next = () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng: Rng = {
        next,
        range: (min, max) => min + next() * (max - min),
        int: (min, maxInclusive) => Math.floor(min + next() * (maxInclusive - min + 1)),
        pick: (list) => list[Math.floor(next() * list.length)],
        chance: (probability) => next() < probability,
        fork: (label) => createRng(hash2(seed, label, 0x5bd1)),
    };
    return rng;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** smooth value noise in [-1, 1] */
export function noise2(seed: number, x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const corner = (cx: number, cy: number) => hash2(seed, cx, cy) / 4294967295;
    const top = corner(x0, y0) + (corner(x0 + 1, y0) - corner(x0, y0)) * fx;
    const bottom = corner(x0, y0 + 1) + (corner(x0 + 1, y0 + 1) - corner(x0, y0 + 1)) * fx;
    return (top + (bottom - top) * fy) * 2 - 1;
}

/** layered noise in roughly [-1, 1] */
export function fbm(seed: number, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += noise2(seed + i * 1013, x * frequency, y * frequency) * amplitude;
        norm += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return sum / norm;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
};
