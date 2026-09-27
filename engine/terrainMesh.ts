/**
 * The ground and the water, as meshes. The ground is a single grid whose
 * vertices are coloured by what lies there — grass, path, shore, crag — so the
 * whole landscape is one draw call with no textures to download.
 */
import * as THREE from "three";
import { pavedAt, troddenAt, type RegionLayout } from "@/game/worldgen/layout";
import { fbm, lerp, smoothstep } from "@/game/worldgen/rng";
import { POND_SURFACE, TERRAIN, type Heightfield } from "@/game/worldgen/terrain";
import type { BiomePalette } from "./palette";
import type { Uniforms } from "./geo";

export function buildTerrainMesh(layout: RegionLayout, field: Heightfield, palette: BiomePalette): THREE.Mesh {
    const { cells, half, step, data } = field;
    const side = cells + 1;
    const shape = TERRAIN[layout.spec.biome];
    const seed = layout.spec.seed;

    const positions = new Float32Array(side * side * 3);
    const colors = new Float32Array(side * side * 3);

    const grassA = new THREE.Color(palette.grassA);
    const grassB = new THREE.Color(palette.grassB);
    const path = new THREE.Color(palette.path);
    const paving = new THREE.Color(palette.paving);
    const rock = new THREE.Color(palette.rock);
    const peak = new THREE.Color(palette.peak);
    const shore = new THREE.Color(palette.shore);
    const color = new THREE.Color();
    const waterLevel = shape.waterLevel;

    for (let row = 0; row < side; row++) {
        const z = -half + row * step;
        for (let col = 0; col < side; col++) {
            const x = -half + col * step;
            const i = row * side + col;
            const height = data[i];
            positions[i * 3] = x;
            positions[i * 3 + 1] = height;
            positions[i * 3 + 2] = z;

            // grass: two tones in broad patches, freckled so no two facets match exactly
            const patch = fbm(seed + 91, x / 26, z / 26, 2) * 0.5 + 0.5;
            const freckle = fbm(seed + 17, x / 3.1, z / 3.1, 1) * 0.06;
            color.copy(grassA).lerp(grassB, patch);
            color.offsetHSL(0, 0, freckle);

            const p = { x, z };
            const worn = troddenAt(layout, p);
            // trodden ground is a little paler and drier even off the path itself
            if (worn > 0) color.lerp(path, worn * 0.22);

            const paved = pavedAt(layout, p);
            if (paved > 0) {
                const inPlaza = layout.plaza !== null && Math.hypot(x - layout.plaza.x, z - layout.plaza.z) < layout.plaza.r + 1;
                color.lerp(inPlaza ? paving : path, paved * 0.92);
            }

            // slope: steep ground shows its rock
            const left = data[row * side + Math.max(0, col - 1)];
            const right = data[row * side + Math.min(cells, col + 1)];
            const up = data[Math.max(0, row - 1) * side + col];
            const down = data[Math.min(cells, row + 1) * side + col];
            const slope = Math.hypot(right - left, down - up) / (step * 2);
            color.lerp(rock, smoothstep(0.8, 1.5, slope) * 0.85);

            // height: the rim fades to its peak colour
            if (shape.rim > 0) color.lerp(peak, smoothstep(shape.rim * 0.45, shape.rim * 0.95, height));

            // shorelines
            if (waterLevel !== null) color.lerp(shore, 1 - smoothstep(waterLevel + 0.2, waterLevel + 1.8, height));
            for (const pond of layout.ponds) {
                const d = Math.hypot(x - pond.x, z - pond.z);
                if (d < pond.r + 4) color.lerp(shore, 1 - smoothstep(pond.r * 0.8, pond.r + 3, d));
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
    }

    const index = new Uint32Array(cells * cells * 6);
    let cursor = 0;
    for (let row = 0; row < cells; row++) {
        for (let col = 0; col < cells; col++) {
            const a = row * side + col;
            const b = a + 1;
            const c = a + side;
            const d = c + 1;
            // alternate the diagonal so the facets do not all lean the same way
            if ((row + col) % 2 === 0) {
                index[cursor++] = a; index[cursor++] = c; index[cursor++] = b;
                index[cursor++] = b; index[cursor++] = c; index[cursor++] = d;
            } else {
                index[cursor++] = a; index[cursor++] = c; index[cursor++] = d;
                index[cursor++] = a; index[cursor++] = d; index[cursor++] = b;
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.receiveShadow = true;
    mesh.name = "terrain";
    return mesh;
}

/** water that laps: a gentle swell in the vertex shader and a brighter rim where it meets the sky */
function waterMaterial(color: number, uniforms: Uniforms, glowing: boolean): THREE.Material {
    const material = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: glowing ? 0.95 : 0.78,
        emissive: glowing ? color : 0x000000,
        emissiveIntensity: glowing ? 0.9 : 0,
        depthWrite: false,
    });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTime;")
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                vec4 lapWorld = modelMatrix * vec4(position, 1.0);
                transformed.y += sin(uTime * 0.9 + lapWorld.x * 0.35) * 0.06 + sin(uTime * 1.3 + lapWorld.z * 0.27) * 0.05;`,
            );
    };
    material.customProgramCacheKey = () => "water";
    return material;
}

export function buildWater(layout: RegionLayout, palette: BiomePalette, uniforms: Uniforms): THREE.Object3D | null {
    const shape = TERRAIN[layout.spec.biome];
    const group = new THREE.Group();
    group.name = "water";
    const glowing = layout.spec.biome === "volcanic" || layout.spec.biome === "crystal";

    if (shape.waterLevel !== null) {
        const sea = new THREE.Mesh(
            new THREE.PlaneGeometry(layout.half * 2.6, layout.half * 2.6, 48, 48),
            waterMaterial(palette.water, uniforms, glowing),
        );
        sea.rotation.x = -Math.PI / 2;
        sea.position.y = shape.waterLevel;
        sea.renderOrder = 1;
        group.add(sea);
    }

    for (const pond of layout.ponds) {
        const surface = new THREE.Mesh(
            new THREE.CircleGeometry(pond.r + 2.5, 28),
            waterMaterial(palette.water, uniforms, glowing),
        );
        surface.rotation.x = -Math.PI / 2;
        surface.position.set(pond.x, POND_SURFACE, pond.z);
        surface.renderOrder = 1;
        group.add(surface);
    }

    return group.children.length > 0 ? group : null;
}

/** the y a swimmer would float at, or null on dry land */
export function waterSurfaceAt(layout: RegionLayout, x: number, z: number): number | null {
    for (const pond of layout.ponds) {
        if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 2.5) return POND_SURFACE;
    }
    return TERRAIN[layout.spec.biome].waterLevel;
}

export const mix = lerp;
