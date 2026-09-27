/**
 * Buildings, assembled from parts. A "style kit" decides the materials and
 * the roofline, so the same inn is white-walled and terracotta-roofed in a
 * Spanish book and curve-eaved in a Japanese one.
 *
 * All the buildings of a region are baked into one mesh; their windows into a
 * second, so they can be lit at dusk without touching the walls.
 */
import * as THREE from "three";
import type { BuildingKind } from "@/game/looks";
import type { StyleKit } from "@/game/languages";
import { createRng, type Rng } from "@/game/worldgen/rng";
import { dist, GATE_SIDES, type RegionLayout } from "@/game/worldgen/layout";
import type { Heightfield } from "@/game/worldgen/terrain";
import type { SceneBuilding } from "@/game/payloads";
import type { Obstacles } from "./collide";
import { matte, Sculpt } from "./geo";

type Kit = {
    walls: number[];
    /** the lower course of a wall, or null for none */
    footing: number | null;
    roofs: number[];
    trim: number;
    door: number;
    roof: "gable" | "hip" | "pagoda" | "flat" | "thatch";
    /** exposed timber framing on the walls */
    timbered: boolean;
    storeyHeight: number;
};

const KITS: Record<StyleKit, Kit> = {
    mediterranean: {
        walls: [0xf5ecd8, 0xf0dfc0, 0xf7e7c6, 0xecd2b0], footing: 0xcdb892,
        roofs: [0xc8623c, 0xb9532f, 0xd47848], trim: 0x3f6f8f, door: 0x2f6a8a,
        roof: "hip", timbered: false, storeyHeight: 3.0,
    },
    timber: {
        walls: [0xf2e6cf, 0xeadbbd, 0xe8d3b0], footing: 0x9a9084,
        roofs: [0x8a4a32, 0x6f4a3a, 0x5a5f6e, 0x9a5a3a], trim: 0x5a3f2a, door: 0x6b3f26,
        roof: "gable", timbered: true, storeyHeight: 2.9,
    },
    eastern: {
        walls: [0xf3ead8, 0xe9dcc3, 0xd9c9a8], footing: 0x8f8a80,
        roofs: [0x3f4a5a, 0x35505a, 0x4a3f4f, 0x2f4f4a], trim: 0x9a2f2a, door: 0x5a3a28,
        roof: "pagoda", timbered: true, storeyHeight: 2.8,
    },
    adobe: {
        walls: [0xd9a56f, 0xcf965f, 0xe0b27f, 0xc98a58], footing: null,
        roofs: [0xb9814f, 0xa8703f], trim: 0x3f8f8a, door: 0x2f7f7a,
        roof: "flat", timbered: false, storeyHeight: 3.0,
    },
    nordic: {
        walls: [0xa8503a, 0x3f5f7a, 0xd9b04a, 0x5f7a4f], footing: 0x77726a,
        roofs: [0x3f3f45, 0x4f5a4a], trim: 0xf3efe6, door: 0xf3efe6,
        roof: "thatch", timbered: false, storeyHeight: 2.9,
    },
};

export function isStyleKit(value: string): value is StyleKit {
    return value in KITS;
}

const GLASS = 0xffffff;

/** how tall a building stands, so labels and cameras can clear it */
export function buildingHeight(kind: BuildingKind, kit: Kit): number {
    const storeys = kind === "tower" ? 3 : kind === "inn" || kind === "hall" || kind === "temple" ? 2 : 1;
    return storeys * kit.storeyHeight + (kit.roof === "flat" ? 0.6 : 3);
}

function roofOn(s: Sculpt, kit: Kit, w: number, d: number, y: number, color: number): number {
    const over = 0.55;
    switch (kit.roof) {
        case "gable": {
            const h = Math.min(w, d) * 0.55;
            // the ridge runs along the longer side
            if (w >= d) s.gable(w + over * 2, h, d + over * 2, color, { at: [0, y, 0] });
            else s.gable(d + over * 2, h, w + over * 2, color, { at: [0, y, 0], rot: [0, Math.PI / 2, 0] });
            return h;
        }
        case "hip": {
            const h = Math.min(w, d) * 0.4;
            s.pyramid(w + over * 2, h, d + over * 2, color, { at: [0, y + h / 2, 0] });
            return h;
        }
        case "thatch": {
            const h = Math.min(w, d) * 0.75;
            s.pyramid(w + over * 2.4, h, d + over * 2.4, color, { at: [0, y + h / 2, 0] });
            return h;
        }
        case "flat": {
            s.box(w + 0.3, 0.45, d + 0.3, color, { at: [0, y + 0.22, 0] });
            // beam ends poking through under the parapet
            for (let i = -1; i <= 1; i++) {
                s.cylinder(0.11, 0.11, d + 1, 0x6b4a2f, { at: [i * w * 0.3, y - 0.35, 0], rot: [Math.PI / 2, 0, 0] }, 6);
            }
            return 0.45;
        }
        case "pagoda": {
            // a wide, low skirt that flares, then a steeper cap: the silhouette of a curved eave
            const skirt = Math.min(w, d) * 0.22;
            const cap = Math.min(w, d) * 0.34;
            s.pyramid(w + over * 4.2, skirt, d + over * 4.2, color, { at: [0, y + skirt / 2, 0] });
            s.pyramid(w + over * 0.4, cap, d + over * 0.4, color, { at: [0, y + skirt * 0.55 + cap / 2, 0] }, -0.03);
            // upturned corners
            for (const cx of [-1, 1]) {
                for (const cz of [-1, 1]) {
                    s.cone(0.22, 0.6, color, {
                        at: [cx * (w / 2 + over * 1.9), y + 0.2, cz * (d / 2 + over * 1.9)],
                        rot: [cz * -0.75, 0, cx * 0.75],
                    }, 4, 0.05);
                }
            }
            s.ball(0.2, 0xd9b04a, { at: [0, y + skirt * 0.55 + cap + 0.1, 0] }, 0);
            return skirt * 0.55 + cap;
        }
    }
}

function facade(s: Sculpt, glass: Sculpt, kit: Kit, w: number, d: number, storeys: number, rng: Rng, wide: boolean): void {
    const front = d / 2;
    const doorW = wide ? 1.7 : 1.15;
    const doorH = 2.15;
    s.box(doorW + 0.3, doorH + 0.2, 0.12, kit.trim, { at: [0, (doorH + 0.2) / 2, front + 0.02] });
    s.box(doorW, doorH, 0.12, kit.door, { at: [0, doorH / 2, front + 0.08] });
    s.ball(0.06, 0xd9b04a, { at: [doorW * 0.32, doorH * 0.48, front + 0.17] }, 0);
    // a step up to the door
    s.box(doorW + 0.9, 0.18, 0.7, 0x9a9084, { at: [0, 0.09, front + 0.4] });

    const win = (x: number, y: number, z: number, rotY: number) => {
        const out = 0.04;
        const nx = Math.sin(rotY);
        const nz = Math.cos(rotY);
        s.box(1.0, 1.15, 0.1, kit.trim, { at: [x + nx * out, y, z + nz * out], rot: [0, rotY, 0] });
        glass.box(0.78, 0.92, 0.1, GLASS, { at: [x + nx * (out + 0.05), y, z + nz * (out + 0.05)], rot: [0, rotY, 0] });
        // glazing bars
        s.box(0.06, 0.92, 0.12, kit.trim, { at: [x + nx * (out + 0.07), y, z + nz * (out + 0.07)], rot: [0, rotY, 0] });
        s.box(0.78, 0.06, 0.12, kit.trim, { at: [x + nx * (out + 0.07), y, z + nz * (out + 0.07)], rot: [0, rotY, 0] });
    };

    for (let storey = 0; storey < storeys; storey++) {
        const y = storey * kit.storeyHeight + 1.55;
        const across = Math.max(1, Math.floor((w - 1.6) / 2.3));
        for (let i = 0; i < across; i++) {
            const x = (i - (across - 1) / 2) * 2.3;
            // the door takes the middle of the ground floor
            if (storey === 0 && Math.abs(x) < doorW / 2 + 0.9) continue;
            win(x, y, front, 0);
            if (rng.chance(0.7)) win(x, y, -front, Math.PI);
        }
        const along = Math.max(1, Math.floor((d - 1.6) / 2.6));
        for (let i = 0; i < along; i++) {
            const z = (i - (along - 1) / 2) * 2.6;
            if (rng.chance(0.75)) win(w / 2, y, z, Math.PI / 2);
            if (rng.chance(0.75)) win(-w / 2, y, z, -Math.PI / 2);
        }
    }
}

function timbering(s: Sculpt, kit: Kit, w: number, d: number, height: number): void {
    const beam = 0.16;
    const c = kit.trim;
    for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) {
            s.box(beam * 1.3, height, beam * 1.3, c, { at: [cx * w / 2, height / 2, cz * d / 2] });
        }
    }
    for (const cz of [-1, 1]) {
        s.box(w, beam, beam, c, { at: [0, height - beam / 2, cz * (d / 2 + 0.01)] });
        s.box(w, beam, beam, c, { at: [0, height * 0.5, cz * (d / 2 + 0.01)] });
    }
    for (const cx of [-1, 1]) {
        s.box(beam, beam, d, c, { at: [cx * (w / 2 + 0.01), height - beam / 2, 0] });
        s.box(beam, beam, d, c, { at: [cx * (w / 2 + 0.01), height * 0.5, 0] });
    }
}

/** sculpt one building around its own origin, door facing +z */
function sculptBuilding(s: Sculpt, glass: Sculpt, building: SceneBuilding, kit: Kit): void {
    const rng = createRng(building.variant * 7919 + 13);
    const kind = building.kind as BuildingKind;
    const wall = rng.pick(kit.walls);
    const roof = rng.pick(kit.roofs);
    const w = building.width;
    const d = building.depth;

    if (kind === "tower") {
        const r = Math.min(w, d) * 0.42;
        const height = kit.storeyHeight * 3.4;
        s.cylinder(r * 0.92, r, height, wall, { at: [0, height / 2, 0] }, 10);
        if (kit.footing !== null) s.cylinder(r * 1.04, r * 1.08, 1, kit.footing, { at: [0, 0.5, 0] }, 10);
        s.cylinder(r * 1.15, r * 1.0, 0.7, wall, { at: [0, height + 0.2, 0] }, 10, -0.04);
        s.cone(r * 1.3, r * 2.1, roof, { at: [0, height + 0.5 + r * 1.05, 0] }, 10);
        s.box(1.2, 2.2, 0.2, kit.door, { at: [0, 1.1, r * 0.98] });
        for (let i = 0; i < 3; i++) {
            const angle = i * 2.1 + 0.6;
            glass.box(0.55, 0.95, 0.12, GLASS, {
                at: [Math.sin(angle) * r * 0.96, 3 + i * 2.6, Math.cos(angle) * r * 0.96],
                rot: [0, angle, 0],
            });
        }
        return;
    }

    if (kind === "windmill") {
        const r = Math.min(w, d) * 0.4;
        const height = 8.5;
        s.cylinder(r * 0.62, r, height, wall, { at: [0, height / 2, 0] }, 8);
        s.cone(r * 0.82, 2, roof, { at: [0, height + 1, 0] }, 8);
        s.box(1.1, 2, 0.2, kit.door, { at: [0, 1, r * 0.97] });
        // the sails: they stand still here; the engine turns the real ones
        s.cylinder(0.16, 0.16, 1.4, kit.trim, { at: [0, height - 0.6, r * 0.62 + 0.5], rot: [Math.PI / 2, 0, 0] }, 6);
        for (let i = 0; i < 4; i++) {
            const angle = i * Math.PI / 2 + 0.35;
            s.box(0.22, 5.4, 0.1, kit.trim, {
                at: [Math.sin(angle) * 2.7, height - 0.6 + Math.cos(angle) * 2.7, r * 0.62 + 1.1],
                rot: [0, 0, -angle],
            });
            s.box(1.1, 4.2, 0.05, 0xf3ead8, {
                at: [Math.sin(angle) * 3.1 + Math.cos(angle) * 0.6, height - 0.6 + Math.cos(angle) * 3.1 - Math.sin(angle) * 0.6, r * 0.62 + 1.12],
                rot: [0, 0, -angle],
            });
        }
        glass.box(0.6, 0.9, 0.12, GLASS, { at: [0, 5, r * 0.78], rot: [-0.1, 0, 0] });
        return;
    }

    const storeys = kind === "inn" || kind === "hall" || kind === "temple" ? 2 : 1;
    const height = storeys * kit.storeyHeight;

    s.box(w, height, d, wall, { at: [0, height / 2, 0] });
    if (kit.footing !== null) s.box(w + 0.16, 0.8, d + 0.16, kit.footing, { at: [0, 0.4, 0] });
    if (kit.timbered) timbering(s, kit, w, d, height);

    const roofHeight = roofOn(s, kit, w, d, height, roof);
    facade(s, glass, kit, w, d, storeys, rng, kind === "barn" || kind === "hall" || kind === "temple");

    if (kit.roof !== "flat" && kit.roof !== "pagoda" && kind !== "barn" && kind !== "temple") {
        s.box(0.8, 1.9, 0.8, kit.footing ?? 0x8f8a80, { at: [w * 0.27, height + roofHeight * 0.55, -d * 0.12] });
        s.box(0.95, 0.2, 0.95, 0x6f6a62, { at: [w * 0.27, height + roofHeight * 0.55 + 1, -d * 0.12] });
    }

    switch (kind) {
        case "inn": {
            // a hanging sign and a bench by the door
            s.box(0.1, 0.1, 1.3, kit.trim, { at: [w * 0.34, 3.3, d / 2 + 0.6] });
            s.box(0.9, 0.7, 0.08, 0xd9b04a, { at: [w * 0.34, 2.75, d / 2 + 1.1] });
            s.box(1.9, 0.12, 0.5, 0x8a6a45, { at: [-w * 0.3, 0.5, d / 2 + 0.6] });
            s.box(0.12, 0.5, 0.45, 0x6b4a2f, { at: [-w * 0.3 - 0.8, 0.25, d / 2 + 0.6] });
            s.box(0.12, 0.5, 0.45, 0x6b4a2f, { at: [-w * 0.3 + 0.8, 0.25, d / 2 + 0.6] });
            break;
        }
        case "shop": {
            // a striped awning over a counter
            const stripes = 5;
            for (let i = 0; i < stripes; i++) {
                s.box((w * 0.7) / stripes, 0.08, 1.5, i % 2 === 0 ? 0xd9483b : 0xf3ead8, {
                    at: [-w * 0.35 + (i + 0.5) * (w * 0.7) / stripes, 2.6, d / 2 + 0.7],
                    rot: [0.32, 0, 0],
                });
            }
            s.box(w * 0.5, 0.9, 0.5, 0x8a6a45, { at: [-w * 0.22, 0.45, d / 2 + 0.9] });
            for (let i = 0; i < 3; i++) s.ball(0.17, [0xd9483b, 0xf2c14e, 0x7ab648][i], { at: [-w * 0.36 + i * 0.4, 1.02, d / 2 + 0.9] }, 0);
            break;
        }
        case "smithy": {
            // an open forge under a lean-to, with an anvil and a smoking stack
            s.box(3, 0.14, 2.6, roof, { at: [w / 2 + 1.2, 2.5, 0], rot: [0, 0, -0.2] });
            s.cylinder(0.1, 0.1, 2.4, kit.trim, { at: [w / 2 + 2.5, 1.2, 1.1] }, 6);
            s.cylinder(0.1, 0.1, 2.4, kit.trim, { at: [w / 2 + 2.5, 1.2, -1.1] }, 6);
            s.box(1.2, 1, 1.2, 0x6f6a62, { at: [w / 2 + 1, 0.5, -0.5] });
            s.box(0.7, 0.2, 0.7, 0xf0763a, { at: [w / 2 + 1, 1.02, -0.5] });
            s.box(0.35, 0.5, 0.3, 0x3a3a44, { at: [w / 2 + 1.5, 0.25, 0.9] });
            s.box(0.8, 0.22, 0.32, 0x3a3a44, { at: [w / 2 + 1.5, 0.6, 0.9] });
            break;
        }
        case "temple": {
            // steps, pillars and a bell
            s.box(w * 0.6, 0.3, 1.6, 0xb5ad9f, { at: [0, 0.15, d / 2 + 1] });
            for (const cx of [-1, 1]) {
                s.cylinder(0.24, 0.28, height * 0.8, 0xe8e0cc, { at: [cx * w * 0.24, height * 0.4, d / 2 + 0.9] }, 8);
            }
            s.box(w * 0.62, 0.35, 0.6, kit.trim, { at: [0, height * 0.82, d / 2 + 0.9] });
            s.ball(0.32, 0xd9b04a, { at: [0, height * 0.66, d / 2 + 0.9], scale: [1, 1.15, 1] }, 1);
            break;
        }
        case "barn": {
            s.box(2.4, 2.6, 0.14, 0x7a3a2a, { at: [0, 1.3, d / 2 + 0.06] });
            s.box(2.6, 0.12, 0.16, kit.trim, { at: [0, 1.3, d / 2 + 0.14], rot: [0, 0, 0.8] });
            s.box(2.6, 0.12, 0.16, kit.trim, { at: [0, 1.3, d / 2 + 0.14], rot: [0, 0, -0.8] });
            // hay
            s.cylinder(0.6, 0.6, 1, 0xd9b95a, { at: [w / 2 + 1, 0.6, d * 0.2], rot: [0, 0, Math.PI / 2] }, 8);
            s.cylinder(0.6, 0.6, 1, 0xd9b95a, { at: [w / 2 + 1, 0.6, -d * 0.15], rot: [0, 0, Math.PI / 2] }, 8, -0.04);
            break;
        }
        case "hall": {
            // banners either side of the door
            for (const cx of [-1, 1]) {
                s.box(0.08, 3.2, 0.08, kit.trim, { at: [cx * 1.7, 2.6, d / 2 + 0.25] });
                s.box(0.7, 1.7, 0.05, cx < 0 ? 0xb8323a : 0x3f4f9c, { at: [cx * 1.7, 2.9, d / 2 + 0.32] });
            }
            break;
        }
        default: {
            // a home: flower box, sometimes a rain barrel
            s.box(1.1, 0.24, 0.3, 0x7a5236, { at: [w * 0.3, 1.0, d / 2 + 0.2] });
            for (let i = 0; i < 3; i++) s.ball(0.14, [0xe8627a, 0xf7d046, 0xffffff][i], { at: [w * 0.3 - 0.35 + i * 0.35, 1.2, d / 2 + 0.22] }, 0);
            if (rng.chance(0.5)) {
                s.cylinder(0.36, 0.32, 0.9, 0x7a5236, { at: [-w / 2 - 0.5, 0.45, d * 0.2] }, 8);
                s.cylinder(0.38, 0.38, 0.06, 0x3a3a44, { at: [-w / 2 - 0.5, 0.7, d * 0.2] }, 8);
            }
        }
    }
}

export type Town = {
    group: THREE.Group;
    /** sets how brightly the windows burn: 0 by day, 1 at night */
    setLamps: (amount: number) => void;
    /** where the street lamps hang, for the engine to put real light at the nearest few */
    lampSpots: THREE.Vector3[];
};

const IRON = 0x3a3a44;
const BUNTING = [0xd9483b, 0xf2c14e, 0x3f8f8a, 0xf3ead8, 0x3f6f9c, 0xe8627a];

/** lamp posts along the roads, alternating sides */
function streetLamps(walls: Sculpt, glass: Sculpt, layout: RegionLayout, field: Heightfield, obstacles: Obstacles): THREE.Vector3[] {
    const spots: THREE.Vector3[] = [];
    walls.within(null);
    glass.within(null);
    for (const trail of layout.trails) {
        if (trail.kind !== "road" || trail.width < 4) continue;
        let travelled = 0;
        let next = 5;
        let side = 1;
        for (let i = 0; i < trail.points.length - 1; i++) {
            const a = trail.points[i];
            const b = trail.points[i + 1];
            const length = dist(a, b);
            if (length < 0.001) continue;
            while (next <= travelled + length) {
                const t = (next - travelled) / length;
                const ux = (b.x - a.x) / length;
                const uz = (b.z - a.z) / length;
                const offset = side * (trail.width / 2 + 0.9);
                const x = a.x + (b.x - a.x) * t - uz * offset;
                const z = a.z + (b.z - a.z) * t + ux * offset;
                next += 15;
                if (Math.hypot(x, z) > layout.radius - 9) continue;
                const y = field.at(x, z);
                // the arm reaches back over the road
                const armX = uz * side * 0.55;
                const armZ = -ux * side * 0.55;
                walls.cylinder(0.07, 0.1, 3.5, IRON, { at: [x, y + 1.75, z] }, 6);
                walls.cylinder(0.16, 0.2, 0.3, IRON, { at: [x, y + 0.15, z] }, 6);
                walls.box(0.06, 0.06, 0.62, IRON, { at: [x + armX * 0.5, y + 3.4, z + armZ * 0.5], rot: [0, Math.atan2(armX, armZ), 0] });
                walls.pyramid(0.42, 0.2, 0.42, IRON, { at: [x + armX, y + 3.32, z + armZ] });
                glass.box(0.26, 0.34, 0.26, 0xffffff, { at: [x + armX, y + 3.04, z + armZ] });
                walls.box(0.3, 0.05, 0.3, IRON, { at: [x + armX, y + 2.85, z + armZ] });
                obstacles.addCircle({ x, z, r: 0.22 });
                spots.push(new THREE.Vector3(x + armX, y + 3.0, z + armZ));
                side = -side;
            }
            travelled += length;
        }
    }
    return spots;
}

/** strings of little flags around the plaza, slung between poles */
function bunting(walls: Sculpt, layout: RegionLayout, field: Heightfield, obstacles: Obstacles): void {
    const plaza = layout.plaza;
    if (!plaza) return;
    walls.within(null);
    const roads = GATE_SIDES.map((side) => Math.atan2(layout.gates[side].z, layout.gates[side].x)).sort((a, b) => a - b);
    roads.forEach((from, quarter) => {
        const to = quarter === roads.length - 1 ? roads[0] + Math.PI * 2 : roads[quarter + 1];
        const poles = [0.2, 0.8].map((t) => {
            const angle = from + (to - from) * t;
            const x = plaza.x + Math.cos(angle) * (plaza.r + 0.9);
            const z = plaza.z + Math.sin(angle) * (plaza.r + 0.9);
            return { x, z, y: field.at(x, z) };
        });
        for (const pole of poles) {
            walls.cylinder(0.06, 0.09, 4.6, 0x6b4a2f, { at: [pole.x, pole.y + 2.3, pole.z] }, 6);
            walls.ball(0.12, 0xd9b04a, { at: [pole.x, pole.y + 4.65, pole.z] }, 0);
            obstacles.addCircle({ x: pole.x, z: pole.z, r: 0.2 });
        }
        const [a, b] = poles;
        const span = Math.hypot(b.x - a.x, b.z - a.z);
        const bearing = Math.atan2(b.x - a.x, b.z - a.z);
        const flags = Math.floor(span / 0.62);
        for (let i = 1; i < flags; i++) {
            const t = i / flags;
            const sag = 4 * 0.85 * t * (1 - t);
            const x = a.x + (b.x - a.x) * t;
            const z = a.z + (b.z - a.z) * t;
            const y = a.y + (b.y - a.y) * t + 4.5 - sag;
            walls.cone(0.17, 0.36, BUNTING[(i + quarter) % BUNTING.length], { at: [x, y - 0.18, z], rot: [Math.PI, bearing, 0], scale: [0.14, 1, 1] }, 3);
            walls.box(0.02, 0.02, span / flags + 0.04, 0x5a4a3a, { at: [x, y, z], rot: [0, bearing, 0] });
        }
    });
}

export function buildTown(
    buildings: SceneBuilding[],
    styleKit: string,
    layout: RegionLayout,
    field: Heightfield,
    obstacles: Obstacles,
    lamps: number,
    shadows: boolean,
): Town | null {
    if (buildings.length === 0) return null;
    const kit = KITS[isStyleKit(styleKit) ? styleKit : "timber"];

    const walls = new Sculpt();
    const glass = new Sculpt();
    for (const building of buildings) {
        const y = field.at(building.x, building.z) - 0.12;
        const placement = { at: [building.x, y, building.z] as [number, number, number], rot: [0, building.rot, 0] as [number, number, number] };
        walls.within(placement);
        glass.within(placement);
        sculptBuilding(walls, glass, building, kit);

        const round = building.kind === "tower" || building.kind === "windmill";
        if (round) obstacles.addCircle({ x: building.x, z: building.z, r: Math.min(building.width, building.depth) * 0.45 });
        else obstacles.addRect({ x: building.x, z: building.z, rot: building.rot, halfW: building.width / 2 + 0.1, halfD: building.depth / 2 + 0.1 });
    }

    const lampSpots = streetLamps(walls, glass, layout, field, obstacles);
    bunting(walls, layout, field, obstacles);

    const group = new THREE.Group();
    group.name = "town";

    const wallMesh = new THREE.Mesh(walls.build(), matte());
    wallMesh.castShadow = shadows;
    wallMesh.receiveShadow = true;
    group.add(wallMesh);

    const dark = new THREE.Color(0x3f5f7a);
    const lit = new THREE.Color(0xffd27a);
    const glassMaterial = new THREE.MeshBasicMaterial({ color: dark.clone().lerp(lit, lamps) });
    // lit windows should glow through the dusk rather than be dimmed by tone mapping
    glassMaterial.toneMapped = lamps < 0.5;
    if (!glass.isEmpty) group.add(new THREE.Mesh(glass.build(), glassMaterial));

    return {
        group,
        lampSpots,
        setLamps(amount) {
            glassMaterial.color.copy(dark).lerp(lit, amount);
            glassMaterial.toneMapped = amount < 0.5;
        },
    };
}
