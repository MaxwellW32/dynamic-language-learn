/**
 * Stones underfoot. The terrain's own colouring can only suggest a path —
 * its grid is too coarse for an edge. Laying real stones along roads and
 * across the plaza gives the ground something crisp to read, and they are
 * instances of one small shape, so a thousand of them are one draw call.
 */
import * as THREE from "three";
import { dist, type RegionLayout } from "@/game/worldgen/layout";
import { createRng } from "@/game/worldgen/rng";
import type { Heightfield } from "@/game/worldgen/terrain";
import type { BiomePalette } from "./palette";

type Stone = { x: number; z: number; size: number; rot: number; shade: number; squash: number };

const dummy = new THREE.Object3D();
const color = new THREE.Color();

export function pave(layout: RegionLayout, field: Heightfield, palette: BiomePalette, density: number): THREE.InstancedMesh | null {
    const rng = createRng(layout.spec.seed ^ 0x9a7e);
    const stones: Stone[] = [];
    const put = (x: number, z: number, size: number) => {
        stones.push({ x, z, size, rot: rng.range(0, Math.PI), shade: rng.range(-0.09, 0.07), squash: rng.range(0.75, 1.2) });
    };

    /* the plaza: rings of stones, widening outward from whatever stands in the middle */
    if (layout.plaza) {
        const plaza = layout.plaza;
        for (let ring = 2.9; ring < plaza.r - 0.2; ring += 1.0) {
            const around = Math.floor((Math.PI * 2 * ring) / 1.05);
            const offset = rng.range(0, Math.PI * 2);
            for (let i = 0; i < around; i++) {
                const skip = rng.next();
                const jitter = rng.range(-0.1, 0.1);
                const size = rng.range(0.4, 0.54);
                // a few gaps, so it reads as laid by hand rather than printed
                if (skip < 0.06) continue;
                const angle = offset + (i / around) * Math.PI * 2;
                put(plaza.x + Math.cos(angle) * (ring + jitter), plaza.z + Math.sin(angle) * (ring + jitter), size);
            }
        }
    }

    /* roads are cobbled edge to edge; trails have stepping stones down the middle and pebbles at the sides */
    for (const trail of layout.trails) {
        const cobbled = trail.kind === "road";
        const spacing = cobbled ? 0.95 : 1.7;
        let carried = 0;
        for (let i = 0; i < trail.points.length - 1; i++) {
            const a = trail.points[i];
            const b = trail.points[i + 1];
            const length = dist(a, b);
            if (length < 0.001) continue;
            const ux = (b.x - a.x) / length;
            const uz = (b.z - a.z) / length;
            for (let travelled = carried; travelled < length; travelled += spacing) {
                const cx = a.x + ux * travelled;
                const cz = a.z + uz * travelled;
                const across = cobbled ? Math.max(2, Math.round(trail.width / 1.0)) : 1;
                for (let k = 0; k < across; k++) {
                    const lateral = cobbled
                        ? ((k + 0.5) / across - 0.5) * (trail.width - 0.5) + rng.range(-0.16, 0.16)
                        : rng.range(-0.55, 0.55);
                    const along = rng.range(-0.25, 0.25);
                    const size = cobbled ? rng.range(0.36, 0.5) : rng.range(0.34, 0.62);
                    const keep = rng.next();
                    const x = cx - uz * lateral + ux * along;
                    const z = cz + ux * lateral + uz * along;
                    // past the rim nobody is looking at their feet
                    if (Math.hypot(x, z) > layout.radius + 6) continue;
                    if (layout.plaza && dist({ x, z }, layout.plaza) < layout.plaza.r - 0.3) continue;
                    if (keep > density * (cobbled ? 0.86 : 0.8)) continue;
                    put(x, z, size);
                }
                if (!cobbled) {
                    const side = rng.chance(0.5) ? 1 : -1;
                    const lateral = side * (trail.width * 0.5 + rng.range(-0.2, 0.5));
                    const size = rng.range(0.14, 0.26);
                    if (rng.chance(0.55 * density)) put(cx - uz * lateral, cz + ux * lateral, size);
                }
            }
            carried = (carried + Math.ceil((length - carried) / spacing) * spacing) - length;
        }
    }

    if (stones.length === 0) return null;

    // a low six-sided pad, a little narrower on top so its edge catches the light
    const geometry = new THREE.CylinderGeometry(0.86, 1, 1, 6, 1).toNonIndexed();
    geometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({ flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, stones.length);
    const base = new THREE.Color(layout.plaza ? palette.paving : palette.rock).lerp(new THREE.Color(palette.path), layout.plaza ? 0.15 : 0.35);

    stones.forEach((stone, i) => {
        const height = 0.09 + stone.size * 0.06;
        dummy.position.set(stone.x, field.at(stone.x, stone.z) + height * 0.28, stone.z);
        dummy.rotation.set(0, stone.rot, 0);
        dummy.scale.set(stone.size * stone.squash, height, stone.size / stone.squash);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.copy(base).offsetHSL(0, 0, stone.shade));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = "paving";
    return mesh;
}
