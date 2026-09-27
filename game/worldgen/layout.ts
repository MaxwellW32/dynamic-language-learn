/**
 * Region layout — where everything in a place stands.
 *
 * A region is rebuilt from its seed on every device. The server uses the
 * layout to decide where buildings, people and creatures go (those positions
 * are then stored as rows); the browser uses the very same layout to raise the
 * terrain, lay the paths and scatter the scenery. Nothing here touches three.js
 * or the database.
 *
 * Axes: x grows east, z grows south, y is up. A facing angle `rot` looks along
 * (sin rot, cos rot) — so 0 faces south, π faces north.
 */
import type { Biome, BuildingKind, LandmarkKind } from "../looks";
import { clamp, createRng, fbm, lerp, smoothstep, type Rng } from "./rng";

export type Vec2 = { x: number; z: number };
export type GateSide = "n" | "e" | "s" | "w";
export type RegionKind = "settlement" | "wilds" | "depths";

export const GATE_SIDES: GateSide[] = ["n", "e", "s", "w"];
/** which open gate counts as the way in to a wild place */
const ENTRY_ORDER: GateSide[] = ["w", "s", "n", "e"];
export const OPPOSITE: Record<GateSide, GateSide> = { n: "s", s: "n", e: "w", w: "e" };
const SIDE_ANGLE: Record<GateSide, number> = { e: 0, s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2 };

export type RegionSpec = {
    seed: number;
    kind: RegionKind;
    biome: Biome;
    /** the sides with an open way out */
    gates: GateSide[];
};

export type Slot = Vec2 & { rot: number };
export type Disc = Vec2 & { r: number };
export type Trail = { points: Vec2[]; width: number; kind: "road" | "trail" };
export type Plot = Slot & { width: number; depth: number; kind: BuildingKind; variant: number };
export type LandmarkSlot = Slot & { suggested: LandmarkKind[] };
export type MobSlot = Slot & { tier: "minion" | "elite" };
export type GateSlot = Slot & { side: GateSide; open: boolean; arrival: Slot };

export type RegionLayout = {
    spec: RegionSpec;
    /** the terrain spans [-half, half] on both axes */
    half: number;
    /** how far from the centre the hero can roam, before the rim */
    radius: number;
    spawn: Slot;
    plaza: Disc | null;
    clearings: Disc[];
    trails: Trail[];
    plots: Plot[];
    landmarkSlots: LandmarkSlot[];
    npcSlots: Slot[];
    mobSlots: MobSlot[];
    bossSlot: Slot | null;
    gates: Record<GateSide, GateSlot>;
    ponds: Disc[];
};

export const REGION_RADIUS = 72;
/** how far inside a gate the hero appears: far enough that the camera behind them is inside too */
const ARRIVAL_STEP = 14;
export const REGION_HALF = 120;

/* ------------------------------------------------------------------ */
/* small geometry helpers                                              */
/* ------------------------------------------------------------------ */

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const polar = (angle: number, r: number): Vec2 => ({ x: Math.cos(angle) * r, z: Math.sin(angle) * r });
/** the facing angle that looks from `from` toward `to` */
export const facing = (from: Vec2, to: Vec2) => Math.atan2(to.x - from.x, to.z - from.z);
export const forward = (rot: number): Vec2 => ({ x: Math.sin(rot), z: Math.cos(rot) });

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lengthSq = abx * abx + abz * abz;
    const t = lengthSq === 0 ? 0 : clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / lengthSq, 0, 1);
    return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

export function distToTrail(p: Vec2, trail: Trail): number {
    let best = Infinity;
    for (let i = 0; i < trail.points.length - 1; i++) {
        best = Math.min(best, distToSegment(p, trail.points[i], trail.points[i + 1]));
    }
    return best;
}

/** a gently wandering line from a to b */
function wander(rng: Rng, a: Vec2, b: Vec2, sway: number, steps = 6): Vec2[] {
    const points: Vec2[] = [a];
    const length = dist(a, b);
    const nx = -(b.z - a.z) / (length || 1);
    const nz = (b.x - a.x) / (length || 1);
    let drift = 0;
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        drift = drift * 0.5 + rng.range(-1, 1) * sway;
        // ends stay put; the middle is free to bend
        const bend = drift * Math.sin(t * Math.PI);
        points.push({ x: lerp(a.x, b.x, t) + nx * bend, z: lerp(a.z, b.z, t) + nz * bend });
    }
    points.push(b);
    return smooth(points);
}

/** a line from the middle of the region outward, ended where it first passes `reach` from the centre */
function cutShort(points: Vec2[], reach: number): Vec2[] {
    const out: Vec2[] = [];
    for (const point of points) {
        const last = out[out.length - 1];
        if (Math.hypot(point.x, point.z) <= reach || !last) {
            out.push(point);
            continue;
        }
        const from = Math.hypot(last.x, last.z);
        const to = Math.hypot(point.x, point.z);
        const t = to === from ? 0 : clamp((reach - from) / (to - from), 0, 1);
        out.push({ x: lerp(last.x, point.x, t), z: lerp(last.z, point.z, t) });
        break;
    }
    return out;
}

/** one round of corner cutting, so trails curve instead of kinking */
function smooth(points: Vec2[]): Vec2[] {
    if (points.length < 3) return points;
    const out: Vec2[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        out.push({ x: lerp(a.x, b.x, 0.25), z: lerp(a.z, b.z, 0.25) });
        out.push({ x: lerp(a.x, b.x, 0.75), z: lerp(a.z, b.z, 0.75) });
    }
    out.push(points[points.length - 1]);
    return out;
}

/** how far the playable ground reaches in a given direction — an uneven, natural outline */
export function reachAt(seed: number, angle: number): number {
    const wobble = fbm(seed + 31, Math.cos(angle) * 1.6 + 5, Math.sin(angle) * 1.6 + 5, 3);
    return REGION_RADIUS * (0.9 + 0.1 * wobble);
}

/* ------------------------------------------------------------------ */
/* shared by every kind of region                                      */
/* ------------------------------------------------------------------ */

function makeGates(spec: RegionSpec, rng: Rng): Record<GateSide, GateSlot> {
    const gates = {} as Record<GateSide, GateSlot>;
    for (const side of GATE_SIDES) {
        const angle = SIDE_ANGLE[side] + rng.range(-0.22, 0.22);
        const at = polar(angle, reachAt(spec.seed, angle) - 2);
        const inward = facing(at, { x: 0, z: 0 });
        const step = forward(inward);
        gates[side] = {
            side,
            open: spec.gates.includes(side),
            x: at.x, z: at.z,
            // a gate faces into its region
            rot: inward,
            arrival: { x: at.x + step.x * ARRIVAL_STEP, z: at.z + step.z * ARRIVAL_STEP, rot: inward },
        };
    }
    return gates;
}

/** scatter discs that keep their distance from each other and from whatever is already there */
function scatterDiscs(
    rng: Rng,
    count: number,
    opts: { maxReach: number; minRadius: number; maxRadius: number; gap: number; avoid: Disc[]; tries?: number },
): Disc[] {
    const placed: Disc[] = [];
    const tries = opts.tries ?? 400;
    for (let attempt = 0; attempt < tries && placed.length < count; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const at = polar(angle, Math.sqrt(rng.next()) * opts.maxReach);
        const disc: Disc = { ...at, r: rng.range(opts.minRadius, opts.maxRadius) };
        const clear = [...placed, ...opts.avoid].every((other) => dist(disc, other) > disc.r + other.r + opts.gap);
        if (clear) placed.push(disc);
    }
    return placed;
}

const LANDMARKS_WILD: LandmarkKind[][] = [
    ["campfire", "tent"], ["greattree", "shrine"], ["stones", "altar"],
    ["arch", "statue"], ["shrine", "lantern"], ["chest", "cart"],
];
const LANDMARKS_DEEP: LandmarkKind[][] = [
    ["crystal", "lantern"], ["altar", "statue"], ["obelisk", "stones"],
    ["chest", "crystal"], ["arch", "obelisk"],
];

/* ------------------------------------------------------------------ */
/* settlement                                                          */
/* ------------------------------------------------------------------ */

const INNER_BUILDINGS: BuildingKind[] = ["inn", "shop", "smithy", "hall", "house", "temple", "house", "shop"];
const OUTER_BUILDINGS: BuildingKind[] = ["house", "barn", "house", "windmill", "house", "tower", "house", "barn"];

function settlement(spec: RegionSpec, rng: Rng): RegionLayout {
    const gates = makeGates(spec, rng);
    const plaza: Disc = { x: 0, z: 0, r: 12.5 };
    const trails: Trail[] = [];
    const roadAngles: number[] = [];
    /** the road to each gate, open or not: a story may open a gate later, and its road must find nothing in the way */
    const ways: Trail[] = [];

    for (const side of GATE_SIDES) {
        const gate = gates[side];
        const angle = Math.atan2(gate.z, gate.x);
        roadAngles.push(angle);
        const start = polar(angle, plaza.r - 1);
        const way = wander(rng.fork(side.charCodeAt(0)), start, gate, 3.2);
        ways.push({ points: way, width: 4.6, kind: "road" });
        if (gate.open) {
            // wander as far as the gate, then run straight out through the pass
            trails.push({ points: [...way, polar(angle, REGION_RADIUS + 40)], width: 4.6, kind: "road" });
        } else {
            // a closed side has the same road begun: a lane that peters out among the fields
            trails.push({ points: cutShort(way, REGION_RADIUS * 0.62), width: 3, kind: "road" });
        }
    }

    const awayFromRoads = (angle: number, margin: number) =>
        roadAngles.every((road) => Math.abs(Math.atan2(Math.sin(angle - road), Math.cos(angle - road))) > margin);

    const plots: Plot[] = [];
    const innerKinds = [...INNER_BUILDINGS];
    const outerKinds = [...OUTER_BUILDINGS];

    // the inner ring: two buildings in each quarter between the roads, facing the plaza
    const sorted = [...roadAngles].sort((a, b) => a - b);
    for (let quarter = 0; quarter < sorted.length; quarter++) {
        const from = sorted[quarter];
        const to = quarter === sorted.length - 1 ? sorted[0] + Math.PI * 2 : sorted[quarter + 1];
        for (const t of [0.3, 0.7]) {
            const angle = lerp(from, to, t) + rng.range(-0.05, 0.05);
            const at = polar(angle, rng.range(23, 26));
            const kind = innerKinds.shift() ?? "house";
            const big = kind === "inn" || kind === "hall" || kind === "temple";
            plots.push({
                ...at,
                rot: facing(at, plaza),
                width: big ? rng.range(10, 11.5) : rng.range(7.5, 9),
                depth: big ? rng.range(8, 9) : rng.range(6.5, 7.5),
                kind,
                variant: rng.int(0, 999),
            });
        }
    }

    // the outer ring: homes and farm buildings, set back from the roads
    for (let attempt = 0; attempt < 200 && plots.length < 15; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        if (!awayFromRoads(angle, 0.2)) continue;
        const at = polar(angle, rng.range(40, 54));
        const kind = outerKinds[(plots.length - 8 + outerKinds.length) % outerKinds.length];
        const width = rng.range(7, 9);
        const depth = rng.range(6, 7.5);
        if (plots.some((other) => dist(other, at) < 15)) continue;
        plots.push({ ...at, rot: facing(at, plaza) + rng.range(-0.35, 0.35), width, depth, kind, variant: rng.int(0, 999) });
    }

    const landmarkSlots: LandmarkSlot[] = [
        { x: 0, z: 0, rot: 0, suggested: ["fountain", "well", "statue"] },
    ];
    // around the plaza's edge, between where the roads come in
    const rimKinds: LandmarkKind[][] = [["stall", "cart"], ["noticeboard", "signpost"], ["stall", "barrel"], ["bench", "lantern"]];
    for (let quarter = 0; quarter < sorted.length; quarter++) {
        const from = sorted[quarter];
        const to = quarter === sorted.length - 1 ? sorted[0] + Math.PI * 2 : sorted[quarter + 1];
        const at = polar(lerp(from, to, 0.5), plaza.r - 2.2);
        landmarkSlots.push({ ...at, rot: facing(at, plaza), suggested: rimKinds[quarter % rimKinds.length] });
    }
    // out in the fields
    const outskirts = scatterDiscs(rng, 3, {
        maxReach: REGION_RADIUS * 0.8, minRadius: 5, maxRadius: 6, gap: 4,
        avoid: [{ ...plaza, r: 30 }, ...plots.map((p) => ({ x: p.x, z: p.z, r: 8 }))],
    }).filter((d) => ways.every((way) => distToTrail(d, way) > 7));
    const fieldKinds: LandmarkKind[][] = [["garden", "shrine"], ["pond", "well"], ["shrine", "greattree"]];
    outskirts.forEach((disc, i) => {
        landmarkSlots.push({ x: disc.x, z: disc.z, rot: facing(disc, plaza), suggested: fieldKinds[i % fieldKinds.length] });
    });

    const npcSlots: Slot[] = [];
    for (const plot of plots.slice(0, 8)) {
        const step = forward(plot.rot);
        const side = forward(plot.rot + Math.PI / 2);
        const offset = rng.range(-1.5, 1.5);
        npcSlots.push({
            x: plot.x + step.x * (plot.depth / 2 + 2.6) + side.x * offset,
            z: plot.z + step.z * (plot.depth / 2 + 2.6) + side.z * offset,
            rot: plot.rot,
        });
    }
    for (const slot of landmarkSlots.slice(1, 3)) {
        const step = forward(slot.rot);
        npcSlots.push({ x: slot.x + step.x * 2.4, z: slot.z + step.z * 2.4, rot: slot.rot });
    }

    const mobSlots: MobSlot[] = scatterDiscs(rng, 3, {
        maxReach: REGION_RADIUS * 0.84, minRadius: 4, maxRadius: 4, gap: 6,
        avoid: [{ ...plaza, r: 44 }, ...plots.map((p) => ({ x: p.x, z: p.z, r: 9 }))],
    }).map((disc) => ({ x: disc.x, z: disc.z, rot: rng.range(0, Math.PI * 2), tier: "minion" as const }));

    return {
        spec, half: REGION_HALF, radius: REGION_RADIUS,
        spawn: { x: 0, z: plaza.r - 4, rot: Math.PI },
        plaza, clearings: [], trails, plots, landmarkSlots, npcSlots, mobSlots,
        bossSlot: null, gates, ponds: [],
    };
}

/* ------------------------------------------------------------------ */
/* wilds                                                               */
/* ------------------------------------------------------------------ */

function wilds(spec: RegionSpec, rng: Rng): RegionLayout {
    const gates = makeGates(spec, rng);

    const clearings = scatterDiscs(rng, 6, {
        maxReach: REGION_RADIUS * 0.68, minRadius: 8.5, maxRadius: 12.5, gap: 12, avoid: [],
    });
    // walked west to east, so the trail reads as a journey rather than a tangle
    clearings.sort((a, b) => a.x - b.x);

    const trails: Trail[] = [];
    for (let i = 0; i < clearings.length - 1; i++) {
        trails.push({ points: wander(rng.fork(100 + i), clearings[i], clearings[i + 1], 4.5), width: 3, kind: "trail" });
    }
    /** the trail to each gate, open or not: water must not lie where a trail may one day run */
    const ways: Trail[] = [];
    for (const side of GATE_SIDES) {
        const gate = gates[side];
        const nearest = [...clearings].sort((a, b) => dist(a, gate) - dist(b, gate))[0];
        const way = wander(rng.fork(200 + side.charCodeAt(0)), nearest, gate, 3.5);
        ways.push({ points: way, width: 3.4, kind: "trail" });
        if (!gate.open) continue;
        const outside = polar(Math.atan2(gate.z, gate.x), REGION_RADIUS + 40);
        trails.push({ points: [...way, outside], width: 3.4, kind: "trail" });
    }

    const ponds = scatterDiscs(rng, 2, {
        maxReach: REGION_RADIUS * 0.7, minRadius: 6, maxRadius: 9, gap: 5, avoid: clearings,
    }).filter((pond) => [...trails, ...ways].every((trail) => distToTrail(pond, trail) > pond.r + 3));

    // The hero arrives by the way in, and the clearing nearest to it is the safe camp. A world grows eastward from
    // its first village, so the way in is the western gate when there is one; asking in this order also keeps the
    // camp where it is when more gates open later.
    const entry = ENTRY_ORDER.map((side) => gates[side]).find((gate) => gate.open);
    const camp = entry ? [...clearings].sort((a, b) => dist(a, entry) - dist(b, entry))[0] : clearings[0];
    const farthest = [...clearings].sort((a, b) => dist(b, camp) - dist(a, camp))[0];

    const landmarkSlots: LandmarkSlot[] = clearings.map((clearing, i) => {
        const off = polar(rng.range(0, Math.PI * 2), clearing.r * 0.25);
        const at = { x: clearing.x + off.x, z: clearing.z + off.z };
        return {
            ...at,
            rot: rng.range(0, Math.PI * 2),
            suggested: clearing === camp ? ["campfire", "tent"] : LANDMARKS_WILD[(i + 1) % LANDMARKS_WILD.length],
        };
    });
    for (const pond of ponds) landmarkSlots.push({ x: pond.x, z: pond.z, rot: 0, suggested: ["pond"] });

    const npcSlots: Slot[] = [];
    for (const clearing of [camp, ...clearings.filter((c) => c !== camp && c !== farthest).slice(0, 2)]) {
        const off = polar(rng.range(0, Math.PI * 2), clearing.r * 0.55);
        const at = { x: clearing.x + off.x, z: clearing.z + off.z };
        npcSlots.push({ ...at, rot: facing(at, clearing) });
    }

    const mobSlots: MobSlot[] = [];
    for (const clearing of clearings) {
        if (clearing === camp) continue;
        const count = clearing === farthest ? 2 : rng.int(1, 2);
        for (let i = 0; i < count; i++) {
            const off = polar(rng.range(0, Math.PI * 2), clearing.r * rng.range(0.45, 0.85));
            mobSlots.push({
                x: clearing.x + off.x, z: clearing.z + off.z,
                rot: rng.range(0, Math.PI * 2),
                tier: clearing === farthest ? "elite" : "minion",
            });
        }
    }
    // and a few loose on the trail itself
    for (const trail of trails.slice(0, 3)) {
        const mid = trail.points[Math.floor(trail.points.length / 2)];
        if (dist(mid, camp) < camp.r + 12) continue;
        mobSlots.push({ x: mid.x + rng.range(-3, 3), z: mid.z + rng.range(-3, 3), rot: rng.range(0, Math.PI * 2), tier: "minion" });
    }

    const spawn = entry ? entry.arrival : { x: camp.x, z: camp.z, rot: 0 };
    return {
        spec, half: REGION_HALF, radius: REGION_RADIUS, spawn,
        plaza: null, clearings, trails, plots: [], landmarkSlots, npcSlots, mobSlots,
        bossSlot: null, gates, ponds,
    };
}

/* ------------------------------------------------------------------ */
/* depths                                                              */
/* ------------------------------------------------------------------ */

function depths(spec: RegionSpec, rng: Rng): RegionLayout {
    const gates = makeGates(spec, rng);
    const entrySide = spec.gates[0] ?? "w";
    const entry = gates[entrySide];

    // the place runs from the way in to an arena at the far end
    const axis = Math.atan2(-entry.z, -entry.x);
    const arenaAt = polar(axis, REGION_RADIUS * 0.56);
    const arena: Disc = { ...arenaAt, r: 17 };

    const chambers: Disc[] = [];
    const across = { x: -Math.sin(axis), z: Math.cos(axis) };
    for (let i = 0; i < 3; i++) {
        const along = lerp(-0.55, 0.12, i / 2) * REGION_RADIUS;
        const lateral = (i % 2 === 0 ? 1 : -1) * rng.range(12, 24);
        chambers.push({
            x: Math.cos(axis) * along + across.x * lateral,
            z: Math.sin(axis) * along + across.z * lateral,
            r: rng.range(9.5, 12),
        });
    }

    const stops: Vec2[] = [entry, ...chambers, arena];
    const trails: Trail[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
        trails.push({ points: wander(rng.fork(300 + i), stops[i], stops[i + 1], 3.5), width: 3.2, kind: "trail" });
    }
    const outside = polar(Math.atan2(entry.z, entry.x), REGION_RADIUS + 40);
    trails.push({ points: [entry, outside], width: 3.4, kind: "trail" });
    for (const side of GATE_SIDES) {
        if (side === entrySide || !gates[side].open) continue;
        const gate = gates[side];
        const nearest = [...chambers].sort((a, b) => dist(a, gate) - dist(b, gate))[0];
        trails.push({ points: [...wander(rng.fork(400 + side.charCodeAt(0)), nearest, gate, 3), polar(Math.atan2(gate.z, gate.x), REGION_RADIUS + 40)], width: 3.2, kind: "trail" });
    }

    const landmarkSlots: LandmarkSlot[] = chambers.map((chamber, i) => {
        const off = polar(rng.range(0, Math.PI * 2), chamber.r * 0.3);
        return { x: chamber.x + off.x, z: chamber.z + off.z, rot: rng.range(0, Math.PI * 2), suggested: LANDMARKS_DEEP[i % LANDMARKS_DEEP.length] };
    });
    // something stands at the arena's threshold, and something waits behind whoever rules it
    const threshold = polar(axis, REGION_RADIUS * 0.56 - arena.r + 1);
    landmarkSlots.push({ ...threshold, rot: facing(threshold, arena), suggested: ["arch", "obelisk"] });
    const behind = polar(axis, REGION_RADIUS * 0.56 + arena.r * 0.62);
    landmarkSlots.push({ ...behind, rot: facing(behind, arena), suggested: ["altar", "crystal", "chest"] });

    const first = chambers[0];
    const npcOff = polar(rng.range(0, Math.PI * 2), first.r * 0.5);
    const npcAt = { x: first.x + npcOff.x, z: first.z + npcOff.z };
    const npcSlots: Slot[] = [{ ...npcAt, rot: facing(npcAt, first) }];

    const mobSlots: MobSlot[] = [];
    chambers.forEach((chamber, i) => {
        for (let k = 0; k < 2; k++) {
            const off = polar(rng.range(0, Math.PI * 2), chamber.r * rng.range(0.4, 0.8));
            mobSlots.push({
                x: chamber.x + off.x, z: chamber.z + off.z,
                rot: rng.range(0, Math.PI * 2),
                tier: i === 0 ? "minion" : "elite",
            });
        }
    });

    return {
        spec, half: REGION_HALF, radius: REGION_RADIUS,
        spawn: entry.arrival,
        plaza: null, clearings: [...chambers, arena], trails, plots: [], landmarkSlots, npcSlots, mobSlots,
        bossSlot: { x: arena.x, z: arena.z, rot: facing(arena, threshold) },
        gates, ponds: [],
    };
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

const layoutCache = new Map<string, RegionLayout>();

export function generateLayout(spec: RegionSpec): RegionLayout {
    const key = `${spec.seed}:${spec.kind}:${spec.biome}:${[...spec.gates].sort().join("")}`;
    const cached = layoutCache.get(key);
    if (cached) return cached;

    const rng = createRng(spec.seed);
    const layout =
        spec.kind === "settlement" ? settlement(spec, rng) :
        spec.kind === "wilds" ? wilds(spec, rng) :
        depths(spec, rng);

    if (layoutCache.size > 24) layoutCache.clear();
    layoutCache.set(key, layout);
    return layout;
}

/* ------------------------------------------------------------------ */
/* ground queries                                                      */
/* ------------------------------------------------------------------ */

/** 1 on trodden ground (paths, plaza, clearings, building plots), fading to 0 in the rough */
export function troddenAt(layout: RegionLayout, p: Vec2): number {
    let value = 0;
    if (layout.plaza) value = Math.max(value, 1 - smoothstep(layout.plaza.r - 1, layout.plaza.r + 3, dist(p, layout.plaza)));
    for (const clearing of layout.clearings) {
        value = Math.max(value, 0.85 * (1 - smoothstep(clearing.r * 0.7, clearing.r + 3, dist(p, clearing))));
    }
    for (const trail of layout.trails) {
        const d = distToTrail(p, trail);
        value = Math.max(value, 1 - smoothstep(trail.width * 0.5, trail.width * 0.5 + 2.2, d));
    }
    for (const plot of layout.plots) {
        const reach = Math.max(plot.width, plot.depth) * 0.75;
        value = Math.max(value, 0.9 * (1 - smoothstep(reach, reach + 3, dist(p, plot))));
    }
    return value;
}

/** 1 on a worn path or paving, 0 elsewhere — what gets drawn as road */
export function pavedAt(layout: RegionLayout, p: Vec2): number {
    let value = 0;
    if (layout.plaza) value = Math.max(value, 1 - smoothstep(layout.plaza.r - 1.5, layout.plaza.r + 0.5, dist(p, layout.plaza)));
    for (const trail of layout.trails) {
        const d = distToTrail(p, trail);
        value = Math.max(value, 1 - smoothstep(trail.width * 0.5 - 0.4, trail.width * 0.5 + 0.9, d));
    }
    return value;
}

/** is this spot inside the walkable part of the region? */
export function withinReach(layout: RegionLayout, p: Vec2, margin = 0): boolean {
    const d = Math.hypot(p.x, p.z);
    if (d < layout.radius * 0.8) return true;
    const limit = reachAt(layout.spec.seed, Math.atan2(p.z, p.x)) - margin;
    if (d <= limit) return true;
    // the passes at open gates let the hero walk out through the rim
    for (const side of GATE_SIDES) {
        const gate = layout.gates[side];
        if (gate.open && dist(p, gate) < 6) return true;
    }
    return false;
}

/** pull a point back inside the region if it has strayed past the rim */
export function clampToReach(layout: RegionLayout, p: Vec2): Vec2 {
    if (withinReach(layout, p)) return p;
    const angle = Math.atan2(p.z, p.x);
    return polar(angle, reachAt(layout.spec.seed, angle) - 0.5);
}

export const INTERACT_RANGE = 4.2;

export function withinInteractRange(a: Vec2, b: Vec2, range = INTERACT_RANGE): boolean {
    // generous on the server: the hero keeps moving while a request is in flight
    return dist(a, b) <= range + 3;
}
