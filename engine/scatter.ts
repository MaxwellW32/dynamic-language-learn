/**
 * Planting the landscape: where each tree, rock, tuft and flower goes.
 *
 * Every candidate spot is drawn from the region's seed *before* it is judged,
 * so adding a path later (a gate opening) removes the trees in its way
 * without moving any of the others.
 */
import * as THREE from "three";
import { dist, reachAt, troddenAt, type RegionLayout } from "@/game/worldgen/layout";
import { createRng, fbm } from "@/game/worldgen/rng";
import { TERRAIN, type Heightfield } from "@/game/worldgen/terrain";
import type { Obstacles } from "./collide";
import { buildSpecies, flower, grassTuft, type Species } from "./flora";
import { living, matte, type Uniforms } from "./geo";
import type { BiomePalette, FloraKind } from "./palette";

export type Planting = {
    group: THREE.Group;
    /** instances placed, for the engine's report */
    count: number;
};

export type PlantingBudget = {
    /** multiplies how much grows: 1 on a capable device, less on a weak one */
    density: number;
    shadows: boolean;
};

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

type Placed = { x: number; y: number; z: number; rot: number; scale: number; tint: number; lean: number };

export function plant(
    layout: RegionLayout,
    field: Heightfield,
    palette: BiomePalette,
    obstacles: Obstacles,
    uniforms: Uniforms,
    budget: PlantingBudget,
): Planting {
    const group = new THREE.Group();
    group.name = "flora";
    const seed = layout.spec.seed;
    const rng = createRng(seed ^ 0x7a11);
    const shape = TERRAIN[layout.spec.biome];
    // in places that are dark by nature, what grows there carries its own light
    const dark = layout.spec.biome === "crystal" || layout.spec.biome === "twilight" || layout.spec.biome === "volcanic";
    const species = buildSpecies(palette, seed, dark);

    const weights = species.map((s) => palette.flora[s.kind] ?? 0);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const pickSpecies = (roll: number): Species => {
        let cursor = roll * totalWeight;
        for (let i = 0; i < species.length; i++) {
            cursor -= weights[i];
            if (cursor <= 0) return species[i];
        }
        return species[species.length - 1];
    };

    /** things nothing may grow on top of */
    const keepOff = [
        ...layout.landmarkSlots.map((s) => ({ x: s.x, z: s.z, r: 3.2 })),
        ...layout.npcSlots.map((s) => ({ x: s.x, z: s.z, r: 2.2 })),
        ...layout.mobSlots.map((s) => ({ x: s.x, z: s.z, r: 2.2 })),
        ...layout.plots.map((p) => ({ x: p.x, z: p.z, r: Math.max(p.width, p.depth) * 0.75 + 1 })),
        ...(layout.bossSlot ? [{ x: layout.bossSlot.x, z: layout.bossSlot.z, r: 8 }] : []),
        { x: layout.spawn.x, z: layout.spawn.z, r: 3 },
    ];
    const blocked = (x: number, z: number, margin: number) => keepOff.some((k) => dist(k, { x, z }) < k.r + margin);

    const placed = new Map<FloraKind, Placed[][]>();
    for (const s of species) placed.set(s.kind, s.variants.map(() => []));

    /* trees, rocks, bushes: a jittered grid, thinned by what the ground allows */
    const spacing = 3.4;
    const span = layout.half - 6;
    let count = 0;
    for (let gz = -span; gz < span; gz += spacing) {
        for (let gx = -span; gx < span; gx += spacing) {
            // every draw happens whether or not the spot is used: that is what keeps the rest still
            const x = gx + rng.range(0, spacing);
            const z = gz + rng.range(0, spacing);
            const roll = rng.next();
            const speciesRoll = rng.next();
            const variantRoll = rng.next();
            const rot = rng.range(0, Math.PI * 2);
            const scaleRoll = rng.next();
            const tintRoll = rng.next();
            const lean = rng.range(-0.06, 0.06);

            const d = Math.hypot(x, z);
            const reach = reachAt(seed, Math.atan2(z, x));
            const beyond = d > reach;

            // thickets and glades: growth comes in drifts, not an even sprinkle
            const drift = fbm(seed + 211, x / 34, z / 34, 2) * 0.5 + 0.5;
            let chance = palette.density * spacing * spacing * 0.01 * (0.35 + drift * 1.3);
            // the rim is wooded more heavily, which hides the edge of the world
            if (beyond) chance *= d > reach + 38 ? 0.35 : 1.7;
            chance *= budget.density;
            if (roll > chance) continue;

            const p = { x, z };
            if (troddenAt(layout, p) > 0.12) continue;
            if (blocked(x, z, 0.5)) continue;
            if (layout.ponds.some((pond) => dist(pond, p) < pond.r + 2.5)) continue;

            const y = field.at(x, z);
            if (shape.waterLevel !== null && y < shape.waterLevel + 0.35) continue;
            if (field.slopeAt(x, z) > 0.82) continue;

            const chosen = pickSpecies(speciesRoll);
            // reeds want wet feet; everything else wants dry ones
            if (chosen.kind === "reed" && shape.waterLevel !== null && y > shape.waterLevel + 1.6) continue;

            const variant = Math.floor(variantRoll * chosen.variants.length);
            const scale = chosen.minScale + scaleRoll * (chosen.maxScale - chosen.minScale);
            placed.get(chosen.kind)![variant].push({
                x, y: y - 0.08, z, rot, scale, lean,
                tint: palette.leaves[Math.floor(tintRoll * palette.leaves.length)],
            });
            count++;

            if (chosen.footprint > 0 && !beyond) obstacles.addCircle({ x, z, r: chosen.footprint * scale });
        }
    }

    for (const s of species) {
        const sway = !s.sways ? 0 : s.kind === "fern" || s.kind === "reed" ? 2.2 : 1;
        const material = s.tinted || s.sways || s.glow > 0 ? living(uniforms, sway, { glow: s.glow }) : matte();
        s.variants.forEach((geometry, variant) => {
            const spots = placed.get(s.kind)![variant];
            if (spots.length === 0) return;
            const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
            spots.forEach((spot, i) => {
                dummy.position.set(spot.x, spot.y, spot.z);
                dummy.rotation.set(spot.lean, spot.rot, spot.lean * 0.6);
                dummy.scale.setScalar(spot.scale);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                if (s.tinted) mesh.setColorAt(i, tint.setHex(spot.tint));
            });
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.castShadow = budget.shadows && s.castsShadow;
            mesh.receiveShadow = true;
            // instances are spread across the whole region: one bound around them all
            mesh.computeBoundingSphere();
            mesh.name = `flora:${s.kind}:${variant}`;
            group.add(mesh);
        });
    }

    count += carpet(layout, field, palette, uniforms, budget, group, blocked);
    return { group, count };
}

/** grass tufts and flowers: the fine grain that makes ground look alive up close */
function carpet(
    layout: RegionLayout,
    field: Heightfield,
    palette: BiomePalette,
    uniforms: Uniforms,
    budget: PlantingBudget,
    group: THREE.Group,
    blocked: (x: number, z: number, margin: number) => boolean,
): number {
    const seed = layout.spec.seed;
    const rng = createRng(seed ^ 0x3c0f);
    const shape = TERRAIN[layout.spec.biome];
    const grassTone = new THREE.Color(palette.grassB).offsetHSL(0, 0.03, 0.035);

    const tufts: Placed[] = [];
    const blooms: Placed[] = [];
    const spacing = 1.25;
    // only where the hero can actually walk: the rim is seen from too far to need it
    const span = layout.radius + 6;

    for (let gz = -span; gz < span; gz += spacing) {
        for (let gx = -span; gx < span; gx += spacing) {
            const x = gx + rng.range(0, spacing);
            const z = gz + rng.range(0, spacing);
            const roll = rng.next();
            const bloomRoll = rng.next();
            const rot = rng.range(0, Math.PI * 2);
            const scale = rng.range(0.8, 1.7);
            const shade = rng.range(-0.07, 0.07);
            const colorRoll = rng.next();

            if (Math.hypot(x, z) > span) continue;
            const patch = fbm(seed + 307, x / 15, z / 15, 2) * 0.5 + 0.5;
            if (roll > palette.tufts * spacing * spacing * 0.034 * (0.35 + patch * 1.5) * budget.density) continue;

            const p = { x, z };
            if (troddenAt(layout, p) > 0.35) continue;
            if (blocked(x, z, -1)) continue;
            const y = field.at(x, z);
            if (shape.waterLevel !== null && y < shape.waterLevel + 0.3) continue;
            if (layout.ponds.some((pond) => dist(pond, p) < pond.r + 2)) continue;

            // flowers gather in their own patches
            const meadow = fbm(seed + 401, x / 11, z / 11, 2);
            if (palette.flowers.length > 0 && meadow > 0.18 && bloomRoll < 0.45) {
                blooms.push({ x, y, z, rot, scale, lean: 0, tint: palette.flowers[Math.floor(colorRoll * palette.flowers.length)] });
            } else {
                tufts.push({ x, y, z, rot, scale, lean: shade, tint: 0 });
            }
        }
    }

    const make = (geometry: THREE.BufferGeometry, material: THREE.Material, spots: Placed[], name: string, colorOf: (spot: Placed) => THREE.Color) => {
        if (spots.length === 0) return;
        const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
        spots.forEach((spot, i) => {
            dummy.position.set(spot.x, spot.y - 0.03, spot.z);
            dummy.rotation.set(0, spot.rot, 0);
            dummy.scale.setScalar(spot.scale);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, colorOf(spot));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        mesh.name = name;
        group.add(mesh);
    };

    make(grassTuft(), living(uniforms, 2.6, { blades: true }), tufts, "flora:tufts", (spot) => tint.copy(grassTone).offsetHSL(spot.lean * 0.25, 0, spot.lean));
    make(flower(), living(uniforms, 2.6), blooms, "flora:flowers", (spot) => tint.setHex(spot.tint));
    return tufts.length + blooms.length;
}
