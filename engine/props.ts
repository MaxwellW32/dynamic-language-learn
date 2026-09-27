/**
 * Landmarks — the wells, shrines and standing stones a hero can walk up to —
 * and the gates that lead out of a region. Each is sculpted into its own small
 * mesh so it can glow when the hero is near enough to examine it.
 */
import * as THREE from "three";
import type { LandmarkKind } from "@/game/looks";
import { LANDMARK_KINDS } from "@/game/looks";
import { createRng } from "@/game/worldgen/rng";
import { matte, Sculpt } from "./geo";

const STONE = 0x9a958c;
const STONE_DARK = 0x77726a;
const WOOD = 0x8a6a45;
const WOOD_DARK = 0x5f4630;
const GOLD = 0xd9b04a;
const CLOTH_RED = 0xc8483b;
const CLOTH_CREAM = 0xf3ead8;

export type Prop = {
    object: THREE.Object3D;
    /** how far around it the hero cannot walk */
    footprint: number;
    /** how high above the ground its name should float */
    labelHeight: number;
    /** a light it carries, if it burns or glows */
    glow: { color: number; height: number; strength: number } | null;
    /** called every frame for things that flicker, spin or bob */
    animate: ((time: number) => void) | null;
};

type Made = Omit<Prop, "object" | "animate"> & { sculpt: Sculpt; extra?: THREE.Object3D; animate?: (time: number) => void };

/** an unlit, additive shape: flames, crystal hearts, anything that should read as light itself */
function ember(geometry: THREE.BufferGeometry, color: number, opacity = 0.9): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    mesh.renderOrder = 2;
    return mesh;
}

const makers: Record<LandmarkKind, (seed: number, accent: number) => Made> = {
    well: () => {
        const s = new Sculpt();
        s.cylinder(1.05, 1.15, 0.9, STONE, { at: [0, 0.45, 0] }, 10);
        s.cylinder(0.82, 0.82, 0.1, 0x2f4f6a, { at: [0, 0.82, 0] }, 10);
        s.torus(1.05, 0.14, STONE_DARK, { at: [0, 0.92, 0], rot: [Math.PI / 2, 0, 0] });
        for (const cx of [-1, 1]) s.box(0.16, 2.2, 0.16, WOOD_DARK, { at: [cx * 0.95, 1.9, 0] });
        s.gable(2.6, 0.8, 1.7, 0xa8563a, { at: [0, 2.95, 0] });
        s.cylinder(0.08, 0.08, 1.9, WOOD, { at: [0, 2.5, 0], rot: [0, 0, Math.PI / 2] }, 6);
        s.cylinder(0.2, 0.17, 0.32, WOOD, { at: [0.2, 1.6, 0] }, 7);
        return { sculpt: s, footprint: 1.3, labelHeight: 3.7, glow: null };
    },
    fountain: () => {
        const s = new Sculpt();
        s.cylinder(2.3, 2.45, 0.55, STONE, { at: [0, 0.27, 0] }, 12);
        s.cylinder(2.0, 2.0, 0.1, 0x5fb4d6, { at: [0, 0.52, 0] }, 12);
        s.cylinder(0.3, 0.42, 1.5, STONE, { at: [0, 1.1, 0] }, 8);
        s.cylinder(1.0, 0.5, 0.3, STONE_DARK, { at: [0, 1.95, 0] }, 10);
        s.cylinder(0.85, 0.85, 0.08, 0x6fc4e0, { at: [0, 2.08, 0] }, 10);
        s.cylinder(0.14, 0.2, 0.7, STONE, { at: [0, 2.4, 0] }, 6);
        s.ball(0.24, GOLD, { at: [0, 2.9, 0] }, 1);
        const spray = ember(new THREE.ConeGeometry(0.5, 1.1, 7, 1, true), 0xbfeaff, 0.32);
        spray.position.set(0, 2.55, 0);
        spray.rotation.x = Math.PI;
        return {
            sculpt: s, footprint: 2.5, labelHeight: 3.6, glow: null, extra: spray,
            animate: (time) => {
                spray.scale.setScalar(1 + Math.sin(time * 5) * 0.06);
                spray.rotation.y = time * 0.8;
            },
        };
    },
    signpost: (seed) => {
        const s = new Sculpt();
        const rng = createRng(seed);
        s.cylinder(0.09, 0.12, 2.9, WOOD_DARK, { at: [0, 1.45, 0] }, 6);
        for (let i = 0; i < 3; i++) {
            const angle = rng.range(0, Math.PI * 2);
            s.box(1.35, 0.32, 0.08, WOOD, { at: [Math.cos(angle) * 0.5, 2.55 - i * 0.44, -Math.sin(angle) * 0.5], rot: [0, angle, 0] }, i * 0.03);
        }
        return { sculpt: s, footprint: 0.35, labelHeight: 3.3, glow: null };
    },
    noticeboard: () => {
        const s = new Sculpt();
        for (const cx of [-1, 1]) s.box(0.16, 2.5, 0.16, WOOD_DARK, { at: [cx * 1.1, 1.25, 0] });
        s.box(2.4, 1.5, 0.12, WOOD, { at: [0, 1.6, 0] });
        s.gable(2.8, 0.4, 0.6, 0x8a4a32, { at: [0, 2.45, 0] });
        const notes = [CLOTH_CREAM, 0xf2e3a8, CLOTH_CREAM, 0xe9d7c0];
        notes.forEach((c, i) => {
            s.box(0.5, 0.62, 0.03, c, { at: [-0.75 + i * 0.5, 1.62 + (i % 2) * 0.16, 0.08], rot: [0, 0, (i - 1.5) * 0.07] });
            s.ball(0.04, CLOTH_RED, { at: [-0.75 + i * 0.5, 1.9 + (i % 2) * 0.16, 0.1] }, 0);
        });
        return { sculpt: s, footprint: 1.2, labelHeight: 3.2, glow: null };
    },
    stall: (seed, accent) => {
        const s = new Sculpt();
        const rng = createRng(seed);
        s.box(2.6, 0.9, 1.2, WOOD, { at: [0, 0.45, 0] });
        for (const cx of [-1, 1]) for (const cz of [-1, 1]) s.box(0.1, 2.5, 0.1, WOOD_DARK, { at: [cx * 1.25, 1.25, cz * 0.55] });
        for (let i = 0; i < 6; i++) {
            s.box(0.48, 0.07, 1.7, i % 2 === 0 ? accent : CLOTH_CREAM, { at: [-1.2 + i * 0.48, 2.5, 0.12], rot: [0.22, 0, 0] });
        }
        const goods = [0xd9483b, 0xf2c14e, 0x7ab648, 0xf29a4a, 0x9f7fe0];
        for (let i = 0; i < 9; i++) {
            s.ball(rng.range(0.11, 0.17), rng.pick(goods), { at: [rng.range(-1.05, 1.05), 0.98, rng.range(-0.35, 0.35)] }, 0);
        }
        return { sculpt: s, footprint: 1.5, labelHeight: 3.2, glow: null };
    },
    statue: () => {
        const s = new Sculpt();
        s.box(1.5, 0.5, 1.5, STONE_DARK, { at: [0, 0.25, 0] });
        s.box(1.1, 0.9, 1.1, STONE, { at: [0, 0.95, 0] });
        // a robed figure with one arm raised
        s.cylinder(0.3, 0.52, 1.7, 0xbab5aa, { at: [0, 2.25, 0] }, 7);
        s.sphere(0.3, 0xbab5aa, { at: [0, 3.35, 0] });
        s.cylinder(0.09, 0.11, 1.0, 0xbab5aa, { at: [0.42, 3.05, 0], rot: [0, 0, -0.75] }, 5);
        s.cylinder(0.09, 0.11, 0.85, 0xbab5aa, { at: [-0.4, 2.45, 0.1], rot: [0.3, 0, 0.35] }, 5);
        s.ball(0.15, GOLD, { at: [0.8, 3.5, 0] }, 0);
        return { sculpt: s, footprint: 1.2, labelHeight: 4.2, glow: null };
    },
    shrine: (_seed, accent) => {
        const s = new Sculpt();
        s.box(1.7, 0.3, 1.5, STONE_DARK, { at: [0, 0.15, 0] });
        s.box(1.3, 0.25, 1.1, STONE, { at: [0, 0.42, 0] });
        s.box(0.9, 1.0, 0.75, accent, { at: [0, 1.05, 0] });
        s.box(0.5, 0.62, 0.06, 0x2f2a26, { at: [0, 1.0, 0.38] });
        s.pyramid(1.7, 0.6, 1.5, 0x4a4f5a, { at: [0, 1.85, 0] });
        s.ball(0.11, GOLD, { at: [0, 2.2, 0] }, 0);
        s.cylinder(0.05, 0.05, 0.3, CLOTH_CREAM, { at: [0.5, 0.7, 0.4] }, 5);
        const flame = ember(new THREE.SphereGeometry(0.09, 6, 5), 0xffc46a);
        flame.position.set(0.5, 0.92, 0.4);
        return {
            sculpt: s, footprint: 1.1, labelHeight: 2.8, extra: flame,
            glow: { color: 0xffc46a, height: 1, strength: 5 },
            animate: (time) => flame.scale.setScalar(1 + Math.sin(time * 9) * 0.18),
        };
    },
    campfire: () => {
        const s = new Sculpt();
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            s.ball(0.27, i % 2 === 0 ? STONE : STONE_DARK, { at: [Math.cos(angle) * 0.85, 0.12, Math.sin(angle) * 0.85], scale: [1, 0.7, 1] }, 0);
        }
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + 0.4;
            s.cylinder(0.1, 0.12, 1.2, WOOD_DARK, { at: [Math.cos(angle) * 0.24, 0.35, Math.sin(angle) * 0.24], rot: [Math.sin(angle) * 0.9, 0, -Math.cos(angle) * 0.9] }, 5);
        }
        // seats
        s.cylinder(0.3, 0.3, 1.8, WOOD, { at: [2.1, 0.3, 0.2], rot: [Math.PI / 2, 0, 0.2] }, 7);
        s.cylinder(0.3, 0.3, 1.6, WOOD, { at: [-1.5, 0.3, 1.6], rot: [Math.PI / 2, 0, -0.9] }, 7);

        const flames = new THREE.Group();
        const outer = ember(new THREE.ConeGeometry(0.45, 1.3, 6), 0xff8a3a, 0.85);
        outer.position.y = 0.85;
        const inner = ember(new THREE.ConeGeometry(0.26, 0.85, 6), 0xffe08a, 0.95);
        inner.position.y = 0.7;
        flames.add(outer, inner);
        return {
            sculpt: s, footprint: 1.1, labelHeight: 2.4, extra: flames,
            glow: { color: 0xff9a4a, height: 1.1, strength: 22 },
            animate: (time) => {
                outer.scale.set(1 + Math.sin(time * 11) * 0.1, 1 + Math.sin(time * 7.3) * 0.16, 1 + Math.cos(time * 9) * 0.1);
                inner.scale.set(1 + Math.cos(time * 13) * 0.12, 1 + Math.sin(time * 9.1) * 0.2, 1);
                flames.rotation.y = time * 1.4;
            },
        };
    },
    greattree: (seed, accent) => {
        const s = new Sculpt();
        const rng = createRng(seed);
        s.cylinder(0.8, 1.35, 5.4, 0x5b4632, { at: [0, 2.7, 0] }, 9);
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2 + rng.range(-0.2, 0.2);
            s.cylinder(0.2, 0.46, 2.0, 0x5b4632, { at: [Math.cos(angle) * 1.4, 0.3, Math.sin(angle) * 1.4], rot: [Math.sin(angle) * 1.15, 0, -Math.cos(angle) * 1.15] }, 5, -0.03);
        }
        for (let i = 0; i < 9; i++) {
            const angle = rng.range(0, Math.PI * 2);
            const reach = rng.range(0.5, 3.6);
            s.ball(rng.range(2.0, 3.2), accent, { at: [Math.cos(angle) * reach, rng.range(5.4, 8.6), Math.sin(angle) * reach], scale: [1, 0.78, 1] }, 1, rng.range(-0.07, 0.04));
        }
        // prayer ribbons tied round the trunk
        s.torus(1.12, 0.06, CLOTH_CREAM, { at: [0, 1.7, 0], rot: [Math.PI / 2, 0, 0] });
        for (let i = 0; i < 5; i++) {
            const angle = i * 1.26;
            s.box(0.16, 0.5, 0.03, i % 2 === 0 ? CLOTH_RED : CLOTH_CREAM, { at: [Math.cos(angle) * 1.17, 1.4, Math.sin(angle) * 1.17], rot: [0, -angle + Math.PI / 2, 0] });
        }
        return { sculpt: s, footprint: 1.7, labelHeight: 5.2, glow: null };
    },
    stones: (seed) => {
        const s = new Sculpt();
        const rng = createRng(seed);
        const count = 7;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const height = rng.range(2.0, 3.4);
            s.box(rng.range(0.7, 1.0), height, rng.range(0.45, 0.6), i % 2 === 0 ? STONE : STONE_DARK, {
                at: [Math.cos(angle) * 3.1, height / 2 - 0.1, Math.sin(angle) * 3.1],
                rot: [rng.range(-0.06, 0.06), -angle, rng.range(-0.08, 0.08)],
            });
        }
        s.box(1.3, 0.5, 0.9, STONE, { at: [0, 0.25, 0], rot: [0, 0.4, 0] });
        return { sculpt: s, footprint: 0.9, labelHeight: 3.9, glow: null };
    },
    arch: () => {
        const s = new Sculpt();
        for (const cx of [-1, 1]) {
            s.box(0.95, 3.7, 0.95, STONE, { at: [cx * 1.7, 1.85, 0] });
            s.box(1.15, 0.4, 1.15, STONE_DARK, { at: [cx * 1.7, 0.2, 0] });
        }
        s.box(4.5, 0.75, 1.0, STONE_DARK, { at: [0, 4.05, 0] });
        s.box(1.0, 1.0, 1.05, STONE, { at: [0, 4.1, 0], rot: [0, 0, Math.PI / 4] });
        // ivy
        for (let i = 0; i < 7; i++) s.ball(0.24, 0x4f8a45, { at: [-1.7 + (i % 2) * 0.25 - 0.3, 1.0 + i * 0.42, 0.5] }, 0, (i % 3) * 0.03);
        return { sculpt: s, footprint: 0, labelHeight: 5, glow: null };
    },
    chest: () => {
        const s = new Sculpt();
        s.box(1.3, 0.7, 0.85, WOOD, { at: [0, 0.35, 0] });
        s.cylinder(0.425, 0.425, 1.3, WOOD_DARK, { at: [0, 0.7, 0], rot: [0, 0, Math.PI / 2] }, 8);
        for (const cx of [-0.5, 0.5]) {
            s.box(0.12, 0.75, 0.9, GOLD, { at: [cx, 0.37, 0] });
            s.torus(0.44, 0.05, GOLD, { at: [cx, 0.7, 0], rot: [0, Math.PI / 2, 0] });
        }
        s.box(0.24, 0.3, 0.1, GOLD, { at: [0, 0.6, 0.45] });
        return { sculpt: s, footprint: 0.8, labelHeight: 1.9, glow: { color: 0xffd27a, height: 0.8, strength: 3 } };
    },
    crystal: (seed, accent) => {
        const s = new Sculpt();
        const rng = createRng(seed);
        s.ball(1.0, STONE_DARK, { at: [0, 0.2, 0], scale: [1.4, 0.45, 1.3] }, 0);
        const heart = new THREE.Group();
        for (let i = 0; i < 5; i++) {
            const height = i === 0 ? 3.0 : rng.range(1.1, 2.1);
            const angle = rng.range(0, Math.PI * 2);
            const d = i === 0 ? 0 : rng.range(0.4, 0.85);
            const tilt = i === 0 ? 0 : rng.range(0.25, 0.55);
            const shard = new THREE.Mesh(
                new THREE.ConeGeometry(height * 0.17, height, 5),
                new THREE.MeshLambertMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.75, flatShading: true, transparent: true, opacity: 0.92 }),
            );
            shard.position.set(Math.cos(angle) * d, height / 2 + 0.2, Math.sin(angle) * d);
            shard.rotation.set(Math.sin(angle) * tilt, 0, -Math.cos(angle) * tilt);
            heart.add(shard);
        }
        return {
            sculpt: s, footprint: 1.1, labelHeight: 3.8, extra: heart,
            glow: { color: accent, height: 1.6, strength: 14 },
            animate: (time) => {
                for (const shard of heart.children) {
                    const material = (shard as THREE.Mesh).material as THREE.MeshLambertMaterial;
                    material.emissiveIntensity = 0.65 + Math.sin(time * 1.6 + shard.position.x * 3) * 0.25;
                }
            },
        };
    },
    bridge: () => {
        const s = new Sculpt();
        for (let i = 0; i < 9; i++) {
            const t = (i - 4) / 4;
            s.box(0.62, 0.14, 2.6, i % 2 === 0 ? WOOD : WOOD_DARK, { at: [t * 2.6, 0.5 + (1 - t * t) * 0.5, 0], rot: [0, 0, -t * 0.4] });
        }
        for (const cz of [-1, 1]) {
            for (let i = 0; i < 3; i++) {
                const t = i - 1;
                s.box(0.14, 1.1, 0.14, WOOD_DARK, { at: [t * 2.2, 1.35 - Math.abs(t) * 0.4, cz * 1.2] });
            }
            s.box(5, 0.1, 0.1, WOOD_DARK, { at: [0, 1.7, cz * 1.2] });
        }
        return { sculpt: s, footprint: 0, labelHeight: 2.9, glow: null };
    },
    lantern: () => {
        const s = new Sculpt();
        s.box(0.7, 0.26, 0.7, STONE_DARK, { at: [0, 0.13, 0] });
        s.cylinder(0.12, 0.16, 1.7, STONE, { at: [0, 1.1, 0] }, 6);
        s.box(0.62, 0.12, 0.62, STONE_DARK, { at: [0, 2.0, 0] });
        for (const cx of [-1, 1]) for (const cz of [-1, 1]) s.box(0.06, 0.5, 0.06, STONE_DARK, { at: [cx * 0.22, 2.3, cz * 0.22] });
        s.pyramid(0.95, 0.4, 0.95, STONE_DARK, { at: [0, 2.75, 0] });
        s.ball(0.07, STONE, { at: [0, 3.0, 0] }, 0);
        const light = ember(new THREE.BoxGeometry(0.36, 0.42, 0.36), 0xffd27a, 0.95);
        light.position.y = 2.3;
        return {
            sculpt: s, footprint: 0.45, labelHeight: 3.4, extra: light,
            glow: { color: 0xffc46a, height: 2.3, strength: 9 },
            animate: (time) => light.scale.setScalar(1 + Math.sin(time * 6.3) * 0.04),
        };
    },
    cart: (seed) => {
        const s = new Sculpt();
        const rng = createRng(seed);
        s.box(2.5, 0.16, 1.4, WOOD, { at: [0, 0.85, 0] });
        for (const cz of [-1, 1]) s.box(2.5, 0.5, 0.1, WOOD_DARK, { at: [0, 1.15, cz * 0.7] });
        s.box(0.1, 0.5, 1.4, WOOD_DARK, { at: [-1.25, 1.15, 0] });
        for (const cz of [-1, 1]) {
            s.torus(0.62, 0.07, WOOD_DARK, { at: [0, 0.62, cz * 0.85] });
            for (let i = 0; i < 4; i++) s.box(1.2, 0.06, 0.06, WOOD, { at: [0, 0.62, cz * 0.85], rot: [0, 0, (i * Math.PI) / 4] });
        }
        s.box(1.9, 0.09, 0.09, WOOD_DARK, { at: [2.05, 0.7, 0.45], rot: [0, 0, -0.18] });
        s.box(1.9, 0.09, 0.09, WOOD_DARK, { at: [2.05, 0.7, -0.45], rot: [0, 0, -0.18] });
        for (let i = 0; i < 5; i++) {
            s.ball(rng.range(0.24, 0.34), rng.pick([0xd9b95a, 0xc8a04a, 0x8a6a45]), { at: [rng.range(-0.9, 0.9), 1.2, rng.range(-0.4, 0.4)] }, 0);
        }
        return { sculpt: s, footprint: 1.4, labelHeight: 2.4, glow: null };
    },
    boat: (_seed, accent) => {
        const s = new Sculpt();
        s.box(3.3, 0.5, 1.2, WOOD, { at: [0, 0.4, 0] });
        s.cone(0.7, 1.3, WOOD, { at: [2.25, 0.4, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.86] }, 4);
        s.box(3.1, 0.12, 1.0, WOOD_DARK, { at: [0, 0.6, 0] });
        s.box(0.24, 0.1, 1.1, WOOD_DARK, { at: [-0.4, 0.75, 0] });
        s.cylinder(0.06, 0.07, 2.9, WOOD_DARK, { at: [0.5, 2.0, 0] }, 5);
        s.box(0.05, 1.9, 1.5, accent, { at: [0.5, 2.3, 0], rot: [0, 0.2, 0] });
        return { sculpt: s, footprint: 1.6, labelHeight: 3.9, glow: null };
    },
    altar: (_seed, accent) => {
        const s = new Sculpt();
        s.box(3.1, 0.3, 2.3, STONE_DARK, { at: [0, 0.15, 0] });
        s.box(2.5, 0.3, 1.7, STONE, { at: [0, 0.45, 0] });
        s.box(1.9, 0.9, 1.0, STONE, { at: [0, 1.05, 0] });
        s.box(2.2, 0.2, 1.3, STONE_DARK, { at: [0, 1.6, 0] });
        s.box(1.5, 0.04, 0.6, accent, { at: [0, 1.72, 0] });
        const orb = ember(new THREE.IcosahedronGeometry(0.28, 1), accent, 0.9);
        orb.position.y = 2.35;
        return {
            sculpt: s, footprint: 1.6, labelHeight: 3.3, extra: orb,
            glow: { color: accent, height: 2.3, strength: 12 },
            animate: (time) => {
                orb.position.y = 2.35 + Math.sin(time * 1.7) * 0.12;
                orb.rotation.y = time * 0.9;
            },
        };
    },
    obelisk: (_seed, accent) => {
        const s = new Sculpt();
        s.box(1.5, 0.4, 1.5, STONE_DARK, { at: [0, 0.2, 0] });
        s.cylinder(0.36, 0.6, 5, STONE, { at: [0, 2.9, 0], rot: [0, Math.PI / 4, 0] }, 4);
        s.pyramid(0.52, 0.7, 0.52, accent, { at: [0, 5.75, 0] });
        const runes = new THREE.Group();
        for (let i = 0; i < 4; i++) {
            const rune = ember(new THREE.BoxGeometry(0.22, 0.22, 0.03), accent, 0.85);
            rune.position.set(0, 1.4 + i * 0.9, 0.42 - i * 0.04);
            runes.add(rune);
        }
        return {
            sculpt: s, footprint: 0.9, labelHeight: 6.4, extra: runes,
            glow: { color: accent, height: 3, strength: 8 },
            animate: (time) => runes.children.forEach((rune, i) => {
                ((rune as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(time * 2 + i * 1.1) * 0.4;
            }),
        };
    },
    tent: (_seed, accent) => {
        const s = new Sculpt();
        s.gable(3.1, 2.1, 3.6, accent, { at: [0, 0, 0], rot: [0, Math.PI / 2, 0] });
        s.box(0.08, 2.3, 0.08, WOOD_DARK, { at: [0, 1.15, 1.85] });
        s.box(0.7, 1.4, 0.04, 0x2f2a26, { at: [0, 0.7, 1.82] });
        s.box(1.8, 0.14, 0.7, CLOTH_CREAM, { at: [1.9, 0.07, 1.4], rot: [0, 0.3, 0] });
        return { sculpt: s, footprint: 1.9, labelHeight: 2.9, glow: null };
    },
    garden: (seed) => {
        const s = new Sculpt();
        const rng = createRng(seed);
        for (let row = 0; row < 3; row++) {
            s.box(4.2, 0.24, 0.85, 0x6b4a32, { at: [0, 0.12, (row - 1) * 1.25] });
            for (let i = 0; i < 7; i++) {
                const x = -1.8 + i * 0.6;
                const crop = (row + i) % 3;
                if (crop === 0) s.ball(0.24, 0x5f9a44, { at: [x, 0.38, (row - 1) * 1.25], scale: [1, 0.8, 1] }, 0);
                else if (crop === 1) s.cone(0.14, 0.62, 0x7ab648, { at: [x, 0.5, (row - 1) * 1.25] }, 5);
                else s.ball(0.17, rng.pick([0xd9483b, 0xf29a4a, 0xf2c14e]), { at: [x, 0.36, (row - 1) * 1.25] }, 0);
            }
        }
        // a scarecrow keeps watch
        s.box(0.09, 2.0, 0.09, WOOD_DARK, { at: [2.6, 1.0, 0] });
        s.box(1.3, 0.09, 0.09, WOOD_DARK, { at: [2.6, 1.5, 0] });
        s.ball(0.24, 0xd9b95a, { at: [2.6, 2.05, 0] }, 1);
        s.cone(0.38, 0.4, 0x8a6a45, { at: [2.6, 2.4, 0] }, 7);
        return { sculpt: s, footprint: 0, labelHeight: 2.9, glow: null };
    },
    bench: () => {
        const s = new Sculpt();
        s.box(2.1, 0.12, 0.62, WOOD, { at: [0, 0.55, 0] });
        s.box(2.1, 0.62, 0.1, WOOD, { at: [0, 1.0, -0.28], rot: [-0.14, 0, 0] });
        for (const cx of [-1, 1]) s.box(0.12, 0.55, 0.55, WOOD_DARK, { at: [cx * 0.9, 0.27, 0] });
        return { sculpt: s, footprint: 1.0, labelHeight: 2.0, glow: null };
    },
    barrel: (seed) => {
        const s = new Sculpt();
        const rng = createRng(seed);
        const stand = (x: number, z: number, y: number) => {
            s.cylinder(0.4, 0.4, 1.0, WOOD, { at: [x, y + 0.5, z] }, 9);
            s.cylinder(0.43, 0.43, 0.08, 0x3a3a44, { at: [x, y + 0.25, z] }, 9);
            s.cylinder(0.43, 0.43, 0.08, 0x3a3a44, { at: [x, y + 0.75, z] }, 9);
        };
        stand(0, 0, 0);
        stand(0.9, 0.2, 0);
        stand(0.45, 0.12, 1.0);
        s.box(0.85, 0.7, 0.85, WOOD_DARK, { at: [-0.95, 0.35, 0.3], rot: [0, rng.range(0, 1), 0] });
        return { sculpt: s, footprint: 1.2, labelHeight: 2.6, glow: null };
    },
    pond: () => {
        // the water itself belongs to the terrain; this is what grows at its edge
        const s = new Sculpt();
        for (let i = 0; i < 4; i++) {
            const angle = i * 1.7;
            s.disc(0.55, 0x4f9a54, { at: [Math.cos(angle) * 1.4, 0.04, Math.sin(angle) * 1.4] }, 8);
            if (i % 2 === 0) s.ball(0.17, 0xf7b7cf, { at: [Math.cos(angle) * 1.4, 0.14, Math.sin(angle) * 1.4], scale: [1, 0.6, 1] }, 0);
        }
        return { sculpt: s, footprint: 0, labelHeight: 1.5, glow: null };
    },
};

export function isLandmarkKind(value: string): value is LandmarkKind {
    return value in LANDMARK_KINDS;
}

const ACCENTS = [0x6fd6e8, 0x9a8cf0, 0xf0a86a, 0x7ad69a, 0xf07a9a, 0xc8483b, 0x3f6f9c];

export function buildLandmark(kind: string, id: string, leafTone: number): Prop {
    const seed = [...id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) | 0, 7);
    const resolved: LandmarkKind = isLandmarkKind(kind) ? kind : "stones";
    // living things take the biome's leaf colour; everything else gets an accent of its own
    const accent = resolved === "greattree" ? leafTone : ACCENTS[Math.abs(seed) % ACCENTS.length];
    const made = makers[resolved](seed, accent);

    const group = new THREE.Group();
    if (!made.sculpt.isEmpty) {
        const mesh = new THREE.Mesh(made.sculpt.build(), matte());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    }
    if (made.extra) group.add(made.extra);
    group.name = `landmark:${resolved}`;

    return {
        object: group,
        footprint: made.footprint,
        labelHeight: made.labelHeight,
        glow: made.glow,
        animate: made.animate ?? null,
    };
}

/** a way out of the region: two posts, a lintel and a shimmer between them */
export function buildGate(styleKit: string): Prop {
    const s = new Sculpt();
    const eastern = styleKit === "eastern";
    const post = eastern ? 0xb8322a : STONE;
    const beam = eastern ? 0x2f2a2a : STONE_DARK;

    const lamps = new THREE.Group();
    const lamp = (x: number, y: number) => {
        const glowing = ember(new THREE.BoxGeometry(0.26, 0.34, 0.26), 0xffd27a, 0.95);
        glowing.position.set(x, y, 0);
        lamps.add(glowing);
    };

    if (eastern) {
        // a torii: two round posts, a tie beam, and a lintel that sweeps up at its ends
        for (const cx of [-1, 1]) {
            s.cylinder(0.24, 0.29, 5.2, post, { at: [cx * 2.6, 2.6, 0] }, 8);
            s.cylinder(0.36, 0.4, 0.4, beam, { at: [cx * 2.6, 0.2, 0] }, 8);
        }
        s.box(6.3, 0.3, 0.42, post, { at: [0, 4.35, 0] });
        s.box(0.5, 0.6, 0.46, post, { at: [0, 4.8, 0] });
        s.box(7.0, 0.34, 0.6, beam, { at: [0, 5.25, 0] });
        for (const cx of [-1, 1]) s.box(1.1, 0.34, 0.6, beam, { at: [cx * 3.9, 5.37, 0], rot: [0, 0, cx * 0.22] });
    } else {
        // stone posts carrying a timber beam, a lantern hung from each end
        for (const cx of [-1, 1]) {
            s.box(0.72, 4.0, 0.72, post, { at: [cx * 2.6, 2.0, 0] });
            s.box(0.96, 0.36, 0.96, beam, { at: [cx * 2.6, 0.18, 0] });
            s.box(0.9, 0.22, 0.9, beam, { at: [cx * 2.6, 4.1, 0] });
            s.pyramid(0.9, 0.5, 0.9, beam, { at: [cx * 2.6, 4.46, 0] });
            s.box(0.05, 0.5, 0.05, 0x3a3a44, { at: [cx * 1.9, 3.55, 0] });
            s.box(0.34, 0.06, 0.34, 0x3a3a44, { at: [cx * 1.9, 3.06, 0] });
            s.box(0.34, 0.06, 0.34, 0x3a3a44, { at: [cx * 1.9, 3.46, 0] });
            lamp(cx * 1.9, 3.26);
        }
        s.box(6.0, 0.34, 0.4, WOOD_DARK, { at: [0, 3.85, 0] });
        // a banner in the middle, so the way out can be seen from across the region
        s.box(1.5, 1.15, 0.05, CLOTH_RED, { at: [0, 3.1, 0] });
        s.cone(0.75, 0.5, CLOTH_RED, { at: [0, 2.28, 0], rot: [Math.PI, Math.PI / 4, 0], scale: [1, 1, 0.05] }, 4);
        s.ball(0.2, GOLD, { at: [0, 3.2, 0.04], scale: [1, 1, 0.2] }, 1);
    }

    const veil = new THREE.Mesh(
        new THREE.PlaneGeometry(4.4, eastern ? 4.0 : 3.5),
        new THREE.MeshBasicMaterial({
            color: 0xfff1c9, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
    );
    veil.position.y = eastern ? 2.1 : 1.85;
    veil.renderOrder = 2;

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(s.build(), matte());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh, veil, lamps);
    group.name = "gate";

    return {
        object: group,
        footprint: 0,
        labelHeight: eastern ? 6.2 : 5.3,
        glow: eastern ? null : { color: 0xffc46a, height: 3.2, strength: 10 },
        animate: (time) => {
            (veil.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(time * 1.5) * 0.06;
        },
    };
}
