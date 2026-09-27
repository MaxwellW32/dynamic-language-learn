/**
 * What drifts through the air: petals, snow, rain, fireflies, embers, mist.
 * One small cloud of points that stays centred on the hero — a particle that
 * leaves one side of the cloud re-enters on the other, so a few hundred
 * points fill the whole world.
 */
import * as THREE from "three";
import type { Weather } from "@/game/looks";
import { createRng } from "@/game/worldgen/rng";

export type Air = {
    object: THREE.Object3D;
    update: (delta: number, time: number, hero: THREE.Vector3) => void;
    dispose: () => void;
};

type Recipe = {
    count: number;
    color: number;
    size: number;
    /** metres per second: x and z are a steady wind, y is rise (positive) or fall */
    drift: [number, number, number];
    /** how far each point wanders about its path */
    wander: number;
    /** the box the cloud fills: half-width, height */
    box: [number, number];
    additive: boolean;
    opacity: number;
    /** points pulse in brightness: fireflies, embers */
    twinkle: boolean;
    round: boolean;
};

const RECIPES: Partial<Record<Weather, Recipe>> = {
    petals: { count: 170, color: 0xffc3d8, size: 0.2, drift: [1.2, -0.85, 0.5], wander: 1.3, box: [26, 14], additive: false, opacity: 0.95, twinkle: false, round: true },
    snowfall: { count: 420, color: 0xffffff, size: 0.12, drift: [0.6, -1.7, 0.2], wander: 0.7, box: [26, 16], additive: false, opacity: 0.9, twinkle: false, round: true },
    rain: { count: 520, color: 0xbcd8f0, size: 0.1, drift: [1.5, -19, 0.4], wander: 0.05, box: [22, 16], additive: false, opacity: 0.55, twinkle: false, round: true },
    fireflies: { count: 90, color: 0xe8ff8a, size: 0.17, drift: [0.12, 0.05, 0.08], wander: 1.9, box: [24, 5], additive: true, opacity: 1, twinkle: true, round: true },
    embers: { count: 130, color: 0xff8a3a, size: 0.13, drift: [0.5, 1.5, 0.2], wander: 0.9, box: [24, 12], additive: true, opacity: 1, twinkle: true, round: true },
    mist: { count: 60, color: 0xffffff, size: 5.5, drift: [0.5, 0, 0.18], wander: 0.4, box: [34, 3], additive: false, opacity: 0.09, twinkle: false, round: true },
};

let dotTexture: THREE.Texture | null = null;

/** a soft round dot, drawn once */
function dot(): THREE.Texture {
    if (dotTexture) return dotTexture;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.85)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    dotTexture = new THREE.CanvasTexture(canvas);
    return dotTexture;
}

export function buildAir(weather: string, seed: number, density: number): Air | null {
    const recipe = RECIPES[weather as Weather];
    if (!recipe) return null;

    const count = Math.max(12, Math.round(recipe.count * density));
    const rng = createRng(seed ^ 0xa12);
    const [half, tall] = recipe.box;

    const positions = new Float32Array(count * 3);
    /** each point's place inside the cloud, before the cloud is centred on the hero */
    const home = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        home[i * 3] = rng.range(-half, half);
        home[i * 3 + 1] = rng.range(0, tall);
        home[i * 3 + 2] = rng.range(-half, half);
        phase[i] = rng.range(0, Math.PI * 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: recipe.color,
        size: recipe.size,
        sizeAttenuation: true,
        transparent: true,
        opacity: recipe.opacity,
        depthWrite: false,
        blending: recipe.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        map: recipe.round ? dot() : null,
        alphaTest: recipe.round ? 0 : 0.01,
        toneMapped: !recipe.additive,
        fog: !recipe.additive,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    points.name = `air:${weather}`;

    const wrap = (value: number, span: number) => ((value % span) + span) % span;

    return {
        object: points,
        update(_delta, time, hero) {
            const [dx, dy, dz] = recipe.drift;
            for (let i = 0; i < count; i++) {
                const p = phase[i];
                const x = home[i * 3] + dx * time + Math.sin(time * 0.7 + p) * recipe.wander;
                const y = home[i * 3 + 1] + dy * time + Math.sin(time * 0.9 + p * 1.7) * recipe.wander * 0.4;
                const z = home[i * 3 + 2] + dz * time + Math.cos(time * 0.6 + p) * recipe.wander;
                // wrap inside a box that travels with the hero
                positions[i * 3] = hero.x - half + wrap(x - hero.x + half, half * 2);
                positions[i * 3 + 1] = hero.y - 0.5 + wrap(y, tall);
                positions[i * 3 + 2] = hero.z - half + wrap(z - hero.z + half, half * 2);
            }
            geometry.attributes.position.needsUpdate = true;
            if (recipe.twinkle) material.opacity = recipe.opacity * (0.7 + Math.sin(time * 2.4) * 0.3);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
