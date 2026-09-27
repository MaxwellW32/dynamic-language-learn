/**
 * Creatures — the things a hero fights with words. Like people they are
 * sculpted from primitives and moved by arithmetic; unlike people each kind has
 * its own way of moving: a slime squashes, a bat flaps, a wisp simply drifts.
 */
import * as THREE from "three";
import { CREATURE_TINTS, type CreatureKind, type CreatureLook } from "@/game/looks";
import { matte, Sculpt } from "./geo";

export type CreatureMood = "idle" | "stalk" | "strike" | "hurt" | "fall";

export type Creature = {
    group: THREE.Group;
    /** where a name should float, in metres above its feet */
    height: number;
    /** how close the hero can come before they touch */
    girth: number;
    /** metres above the ground this kind hovers at; 0 for things that walk */
    hover: number;
    /** `pace` is 0 standing … 1 moving at full speed */
    update: (delta: number, time: number, pace: number) => void;
    play: (mood: CreatureMood, seconds?: number) => void;
    /** 0..1 while falling, then stays 1: the engine removes it once it has fallen */
    fallen: () => number;
    dispose: () => void;
};

const EYE = 0x1f1a24;
const WHITE = 0xffffff;

function mesh(sculpt: Sculpt, shadows = true): THREE.Mesh {
    const made = new THREE.Mesh(sculpt.build(), matte());
    made.castShadow = shadows;
    return made;
}

function glow(geometry: THREE.BufferGeometry, color: number, opacity: number): THREE.Mesh {
    const made = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    made.renderOrder = 3;
    return made;
}

/** a pair of eyes looking down +z */
function eyes(s: Sculpt, y: number, z: number, spread: number, size: number, angry = true): void {
    for (const side of [-1, 1]) {
        s.sphere(size, WHITE, { at: [side * spread, y, z], scale: [1, 1.15, 0.6] });
        s.sphere(size * 0.55, EYE, { at: [side * spread * 0.96, y - size * 0.05, z + size * 0.42], scale: [1, 1.1, 0.6] });
        if (angry) s.box(size * 2.1, size * 0.4, size * 0.4, EYE, { at: [side * spread, y + size * 1.15, z + size * 0.2], rot: [0, 0, side * -0.42] });
    }
}

type Parts = {
    body: THREE.Object3D;
    /** limbs, wings and the like, each moved by the kind's own animation */
    extras: THREE.Object3D[];
    height: number;
    girth: number;
    hover: number;
    animate: (time: number, pace: number, strike: number) => void;
};

const darker = (color: number, amount: number) => new THREE.Color(color).offsetHSL(0, 0, -amount).getHex();
const lighter = (color: number, amount: number) => new THREE.Color(color).offsetHSL(0, 0, amount).getHex();

const kinds: Record<CreatureKind, (tint: number) => Parts> = {
    slime: (tint) => {
        const s = new Sculpt();
        s.sphere(0.72, tint, { at: [0, 0.55, 0], scale: [1, 0.78, 1] });
        s.sphere(0.3, lighter(tint, 0.14), { at: [-0.22, 0.98, 0.3], scale: [1, 0.6, 0.6] });
        eyes(s, 0.62, 0.62, 0.24, 0.12);
        s.box(0.22, 0.05, 0.05, EYE, { at: [0, 0.4, 0.69] });
        const body = mesh(s);
        return {
            body, extras: [], height: 1.5, girth: 0.8, hover: 0,
            animate: (time, pace, strike) => {
                const bounce = Math.abs(Math.sin(time * (3 + pace * 3)));
                body.scale.set(1 + (1 - bounce) * 0.16 + strike * 0.2, 0.82 + bounce * 0.3 - strike * 0.2, 1 + (1 - bounce) * 0.16 + strike * 0.2);
                body.position.y = bounce * (0.16 + pace * 0.3);
            },
        };
    },
    wisp: (tint) => {
        const core = glow(new THREE.IcosahedronGeometry(0.34, 1), lighter(tint, 0.25), 0.95);
        const halo = glow(new THREE.IcosahedronGeometry(0.62, 1), tint, 0.32);
        const face = new Sculpt();
        eyes(face, 0, 0.3, 0.13, 0.07, false);
        const body = new THREE.Group();
        body.add(core, halo, mesh(face, false));
        const sparks: THREE.Object3D[] = [];
        for (let i = 0; i < 4; i++) {
            const spark = glow(new THREE.IcosahedronGeometry(0.07, 0), lighter(tint, 0.3), 0.9);
            sparks.push(spark);
            body.add(spark);
        }
        return {
            body, extras: [], height: 2.1, girth: 0.6, hover: 1.2,
            animate: (time, _pace, strike) => {
                body.position.y = Math.sin(time * 1.9) * 0.18;
                halo.scale.setScalar(1 + Math.sin(time * 3.1) * 0.12 + strike * 0.6);
                core.rotation.set(time * 0.7, time * 0.9, 0);
                sparks.forEach((spark, i) => {
                    const angle = time * 1.6 + (i / sparks.length) * Math.PI * 2;
                    spark.position.set(Math.cos(angle) * 0.85, Math.sin(angle * 1.7) * 0.3, Math.sin(angle) * 0.85);
                });
            },
        };
    },
    shroom: (tint) => {
        const s = new Sculpt();
        s.cylinder(0.3, 0.4, 0.8, 0xf0e6d2, { at: [0, 0.5, 0] }, 8);
        eyes(s, 0.6, 0.33, 0.15, 0.09);
        const cap = new Sculpt();
        cap.ball(0.85, tint, { at: [0, 0, 0], scale: [1, 0.56, 1] }, 1);
        for (let i = 0; i < 6; i++) {
            const angle = i * 1.05 + 0.3;
            cap.ball(0.13, 0xfff6e0, { at: [Math.cos(angle) * 0.5, 0.3, Math.sin(angle) * 0.5] }, 0);
        }
        const capMesh = mesh(cap);
        capMesh.position.y = 1.0;
        const feet: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const f = new Sculpt();
            f.ball(0.17, 0xd9cbb0, { at: [0, 0, 0.05], scale: [1, 0.6, 1.4] }, 0);
            const foot = mesh(f);
            foot.position.set(side * 0.2, 0.1, 0);
            feet.push(foot);
        }
        const body = new THREE.Group();
        body.add(mesh(s), capMesh, ...feet);
        return {
            body, extras: feet, height: 1.9, girth: 0.7, hover: 0,
            animate: (time, pace, strike) => {
                const step = Math.sin(time * (4 + pace * 5));
                feet[0].position.z = step * 0.16 * pace;
                feet[1].position.z = -step * 0.16 * pace;
                body.rotation.z = step * 0.07 * (0.3 + pace);
                capMesh.scale.set(1 + strike * 0.3, 1 - strike * 0.25 + Math.sin(time * 2.2) * 0.03, 1 + strike * 0.3);
            },
        };
    },
    golem: (tint) => {
        const rock = darker(tint, 0.18);
        const s = new Sculpt();
        s.ball(0.75, rock, { at: [0, 1.1, 0], scale: [1.1, 1, 0.9] }, 0);
        s.ball(0.5, rock, { at: [0, 0.45, 0], scale: [1, 0.8, 0.9] }, 0, -0.04);
        s.ball(0.42, rock, { at: [0, 1.95, 0.05] }, 0, 0.04);
        const face = new Sculpt();
        for (const side of [-1, 1]) face.box(0.13, 0.07, 0.05, 0xffffff, { at: [side * 0.16, 2.0, 0.4] });
        const gaze = glow(face.build(), lighter(tint, 0.2), 1);
        const heart = glow(new THREE.IcosahedronGeometry(0.2, 0), tint, 0.9);
        heart.position.set(0, 1.2, 0.62);
        const arms: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const a = new Sculpt();
            a.ball(0.3, rock, { at: [0, -0.35, 0], scale: [0.8, 1.3, 0.8] }, 0);
            a.ball(0.36, rock, { at: [0, -0.95, 0] }, 0, 0.03);
            const arm = mesh(a);
            arm.position.set(side * 0.95, 1.5, 0);
            arms.push(arm);
        }
        const body = new THREE.Group();
        body.add(mesh(s), gaze, heart, ...arms);
        return {
            body, extras: arms, height: 2.9, girth: 1.1, hover: 0,
            animate: (time, pace, strike) => {
                const step = Math.sin(time * (2.2 + pace * 2.4));
                arms[0].rotation.x = step * 0.5 * (0.2 + pace) - strike * 2.2;
                arms[1].rotation.x = -step * 0.5 * (0.2 + pace) - strike * 2.2;
                body.position.y = Math.abs(step) * 0.07 * pace;
                body.rotation.z = step * 0.04 * pace;
                heart.scale.setScalar(1 + Math.sin(time * 2.6) * 0.18);
            },
        };
    },
    bat: (tint) => {
        const s = new Sculpt();
        s.sphere(0.34, tint, { at: [0, 0, 0], scale: [1, 1.1, 1] });
        for (const side of [-1, 1]) s.cone(0.11, 0.34, tint, { at: [side * 0.2, 0.42, 0], rot: [0, 0, side * -0.25] }, 4);
        eyes(s, 0.06, 0.28, 0.12, 0.075);
        for (const side of [-1, 1]) s.cone(0.03, 0.1, WHITE, { at: [side * 0.06, -0.13, 0.3], rot: [Math.PI, 0, 0] }, 4);
        const wings: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const w = new Sculpt();
            const dark = darker(tint, 0.12);
            w.box(0.95, 0.04, 0.5, dark, { at: [side * 0.5, 0, 0] });
            w.cone(0.25, 0.5, dark, { at: [side * 0.95, 0, 0.2], rot: [Math.PI / 2, 0, 0] }, 3);
            w.cone(0.25, 0.5, dark, { at: [side * 0.55, 0, 0.3], rot: [Math.PI / 2, 0, 0] }, 3);
            const wing = mesh(w);
            wing.position.set(side * 0.22, 0.05, 0);
            wings.push(wing);
        }
        const body = new THREE.Group();
        body.add(mesh(s), ...wings);
        return {
            body, extras: wings, height: 2.5, girth: 0.6, hover: 1.7,
            animate: (time, pace, strike) => {
                const flap = Math.sin(time * (11 + pace * 6));
                wings[0].rotation.z = -flap * 0.75;
                wings[1].rotation.z = flap * 0.75;
                body.position.y = Math.sin(time * 2.3) * 0.22 - flap * 0.05;
                body.rotation.x = 0.2 + pace * 0.25 + strike * 0.8;
            },
        };
    },
    crab: (tint) => {
        const s = new Sculpt();
        s.ball(0.62, tint, { at: [0, 0.5, 0], scale: [1.35, 0.55, 1] }, 1);
        for (const side of [-1, 1]) {
            s.cylinder(0.03, 0.03, 0.34, tint, { at: [side * 0.2, 0.92, 0.3] }, 5);
            s.sphere(0.1, WHITE, { at: [side * 0.2, 1.12, 0.3] });
            s.sphere(0.055, EYE, { at: [side * 0.2, 1.13, 0.37] });
        }
        const limbs: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const c = new Sculpt();
            c.cylinder(0.07, 0.08, 0.5, tint, { at: [side * 0.28, 0.1, 0.1], rot: [0, 0, side * -1.0] }, 5);
            c.ball(0.26, lighter(tint, 0.06), { at: [side * 0.62, 0.3, 0.2], scale: [1, 0.8, 1.2] }, 0);
            c.cone(0.11, 0.34, lighter(tint, 0.06), { at: [side * 0.62, 0.52, 0.42], rot: [0.9, 0, 0] }, 4);
            const claw = mesh(c);
            claw.position.set(side * 0.62, 0.5, 0.3);
            limbs.push(claw);
        }
        const legs: THREE.Object3D[] = [];
        for (let i = 0; i < 6; i++) {
            const side = i < 3 ? -1 : 1;
            const l = new Sculpt();
            l.cylinder(0.04, 0.05, 0.62, darker(tint, 0.08), { at: [side * 0.26, -0.18, 0], rot: [0, 0, side * -0.95] }, 4);
            const leg = mesh(l, false);
            leg.position.set(side * 0.62, 0.42, -0.3 + (i % 3) * 0.28);
            legs.push(leg);
        }
        const body = new THREE.Group();
        body.add(mesh(s), ...limbs, ...legs);
        return {
            body, extras: limbs, height: 1.7, girth: 1.0, hover: 0,
            animate: (time, pace, strike) => {
                legs.forEach((leg, i) => {
                    leg.rotation.z = Math.sin(time * (7 + pace * 9) + i * 1.3) * 0.3 * (0.2 + pace);
                });
                limbs[0].rotation.z = Math.sin(time * 2.4) * 0.16 + strike * 0.9;
                limbs[1].rotation.z = -Math.sin(time * 2.4 + 1) * 0.16 - strike * 0.9;
                body.position.y = Math.abs(Math.sin(time * 6)) * 0.035 * pace;
            },
        };
    },
    ghost: (tint) => {
        const s = new Sculpt();
        s.sphere(0.55, tint, { at: [0, 1.25, 0] });
        s.cylinder(0.55, 0.62, 0.9, tint, { at: [0, 0.8, 0] }, 10);
        for (let i = 0; i < 7; i++) {
            const angle = (i / 7) * Math.PI * 2;
            s.cone(0.2, 0.46, tint, { at: [Math.cos(angle) * 0.44, 0.2, Math.sin(angle) * 0.44], rot: [Math.PI, 0, 0] }, 5);
        }
        eyes(s, 1.32, 0.46, 0.2, 0.11, false);
        s.sphere(0.1, EYE, { at: [0, 1.04, 0.52], scale: [1, 1.4, 0.5] });
        const made = new THREE.Mesh(s.build(), new THREE.MeshLambertMaterial({
            vertexColors: true, flatShading: true, transparent: true, opacity: 0.84,
            emissive: tint, emissiveIntensity: 0.22,
        }));
        const arms: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const a = new Sculpt();
            a.ball(0.2, tint, { at: [0, -0.2, 0.1], scale: [0.8, 1.4, 0.8] }, 0);
            const arm = new THREE.Mesh(a.build(), made.material);
            arm.position.set(side * 0.6, 1.05, 0.1);
            arms.push(arm);
        }
        const body = new THREE.Group();
        body.add(made, ...arms);
        return {
            body, extras: arms, height: 2.6, girth: 0.75, hover: 0.35,
            animate: (time, pace, strike) => {
                body.position.y = Math.sin(time * 1.6) * 0.16;
                body.rotation.z = Math.sin(time * 1.1) * 0.06;
                arms[0].rotation.x = -0.4 - strike * 1.6 + Math.sin(time * 2) * 0.2;
                arms[1].rotation.x = -0.4 - strike * 1.6 + Math.sin(time * 2 + 1) * 0.2;
                body.scale.set(1 + pace * 0.04, 1 + Math.sin(time * 2.4) * 0.03, 1 + pace * 0.04);
            },
        };
    },
    imp: (tint) => {
        const s = new Sculpt();
        s.ball(0.36, tint, { at: [0, 0.62, 0], scale: [1, 1.15, 0.9] }, 1);
        s.sphere(0.34, tint, { at: [0, 1.22, 0.04] });
        for (const side of [-1, 1]) {
            s.cone(0.08, 0.34, 0xf3ead8, { at: [side * 0.2, 1.6, 0], rot: [0, 0, side * -0.4] }, 5);
            s.cone(0.12, 0.34, tint, { at: [side * 0.4, 1.26, 0], rot: [0, 0, side * -1.35] }, 4);
        }
        eyes(s, 1.26, 0.27, 0.13, 0.085);
        s.box(0.24, 0.045, 0.04, WHITE, { at: [0, 1.05, 0.31] });
        const limbs: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const a = new Sculpt();
            a.cylinder(0.05, 0.06, 0.46, tint, { at: [0, -0.23, 0] }, 5);
            a.ball(0.08, darker(tint, 0.1), { at: [0, -0.5, 0] }, 0);
            const arm = mesh(a);
            arm.position.set(side * 0.38, 0.92, 0);
            limbs.push(arm);
        }
        for (const side of [-1, 1]) {
            const l = new Sculpt();
            l.cylinder(0.06, 0.07, 0.34, tint, { at: [0, -0.17, 0] }, 5);
            l.box(0.13, 0.07, 0.24, darker(tint, 0.12), { at: [0, -0.35, 0.05] });
            const leg = mesh(l);
            leg.position.set(side * 0.16, 0.38, 0);
            limbs.push(leg);
        }
        const wings: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const w = new Sculpt();
            w.cone(0.34, 0.62, darker(tint, 0.14), { at: [side * 0.3, 0.12, 0], rot: [0, 0, side * -0.7], scale: [1, 1, 0.12] }, 3);
            const wing = mesh(w, false);
            wing.position.set(side * 0.16, 0.95, -0.22);
            wings.push(wing);
        }
        const t = new Sculpt();
        t.cylinder(0.025, 0.04, 0.72, tint, { at: [0, 0.2, -0.3], rot: [-0.9, 0, 0] }, 4);
        t.cone(0.09, 0.2, darker(tint, 0.14), { at: [0, 0.48, -0.62], rot: [-0.9, 0, 0] }, 4);
        const tail = mesh(t, false);
        tail.position.y = 0.4;
        const body = new THREE.Group();
        body.add(mesh(s), ...limbs, ...wings, tail);
        return {
            body, extras: limbs, height: 2.1, girth: 0.6, hover: 0,
            animate: (time, pace, strike) => {
                const step = Math.sin(time * (6 + pace * 6));
                limbs[2].rotation.x = step * 0.8 * pace;
                limbs[3].rotation.x = -step * 0.8 * pace;
                limbs[0].rotation.x = -step * 0.7 * pace - strike * 2;
                limbs[1].rotation.x = step * 0.7 * pace - strike * 2;
                wings[0].rotation.y = Math.sin(time * 9) * 0.4;
                wings[1].rotation.y = -Math.sin(time * 9) * 0.4;
                tail.rotation.y = Math.sin(time * 3) * 0.4;
                body.position.y = Math.abs(Math.sin(time * 5)) * 0.1 * (0.3 + pace);
            },
        };
    },
    beetle: (tint) => {
        const s = new Sculpt();
        s.ball(0.62, tint, { at: [0, 0.55, -0.1], scale: [1, 0.72, 1.3] }, 1);
        s.box(0.035, 0.03, 1.5, darker(tint, 0.2), { at: [0, 1.0, -0.1] });
        s.ball(0.32, darker(tint, 0.22), { at: [0, 0.48, 0.72], scale: [1.1, 0.85, 1] }, 1);
        s.cone(0.09, 0.62, darker(tint, 0.3), { at: [0, 0.78, 1.0], rot: [0.85, 0, 0] }, 5);
        eyes(s, 0.55, 0.95, 0.2, 0.07, false);
        const legs: THREE.Object3D[] = [];
        for (let i = 0; i < 6; i++) {
            const side = i < 3 ? -1 : 1;
            const l = new Sculpt();
            l.cylinder(0.035, 0.045, 0.62, darker(tint, 0.3), { at: [side * 0.24, -0.16, 0], rot: [0, 0, side * -1.0] }, 4);
            const leg = mesh(l, false);
            leg.position.set(side * 0.52, 0.4, -0.5 + (i % 3) * 0.5);
            legs.push(leg);
        }
        const body = new THREE.Group();
        body.add(mesh(s), ...legs);
        return {
            body, extras: legs, height: 1.7, girth: 0.95, hover: 0,
            animate: (time, pace, strike) => {
                legs.forEach((leg, i) => {
                    leg.rotation.y = Math.sin(time * (6 + pace * 9) + (i % 2) * Math.PI) * 0.4 * (0.15 + pace);
                });
                body.rotation.x = -strike * 0.4;
                body.position.y = Math.sin(time * 5) * 0.02;
            },
        };
    },
    wolf: (tint) => {
        const s = new Sculpt();
        s.ball(0.5, tint, { at: [0, 0.95, -0.15], scale: [0.85, 0.85, 1.6] }, 1);
        s.ball(0.42, lighter(tint, 0.06), { at: [0, 1.05, 0.5], scale: [0.95, 0.95, 1.1] }, 1);
        const head = new Sculpt();
        head.ball(0.34, tint, { at: [0, 0, 0], scale: [1, 0.95, 1.1] }, 1);
        head.cone(0.19, 0.5, lighter(tint, 0.08), { at: [0, -0.06, 0.4], rot: [Math.PI / 2, 0, 0] }, 6);
        head.ball(0.06, EYE, { at: [0, -0.02, 0.66] }, 0);
        for (const side of [-1, 1]) head.cone(0.1, 0.28, tint, { at: [side * 0.2, 0.32, -0.04], rot: [-0.15, 0, side * -0.2] }, 4);
        eyes(head, 0.08, 0.26, 0.14, 0.065);
        const headMesh = mesh(head);
        headMesh.position.set(0, 1.32, 0.86);
        const legs: THREE.Object3D[] = [];
        for (let i = 0; i < 4; i++) {
            const l = new Sculpt();
            l.cylinder(0.075, 0.095, 0.7, tint, { at: [0, -0.35, 0] }, 5);
            l.ball(0.1, darker(tint, 0.1), { at: [0, -0.72, 0.04], scale: [1, 0.6, 1.3] }, 0);
            const leg = mesh(l);
            leg.position.set(i % 2 === 0 ? -0.24 : 0.24, 0.78, i < 2 ? 0.48 : -0.62);
            legs.push(leg);
        }
        const t = new Sculpt();
        t.cone(0.15, 0.85, lighter(tint, 0.05), { at: [0, 0, -0.4], rot: [-Math.PI / 2 + 0.5, 0, 0] }, 6);
        const tail = mesh(t);
        tail.position.set(0, 1.05, -0.85);
        const body = new THREE.Group();
        body.add(mesh(s), headMesh, ...legs, tail);
        return {
            body, extras: legs, height: 2.2, girth: 1.0, hover: 0,
            animate: (time, pace, strike) => {
                const gait = time * (4 + pace * 7);
                legs[0].rotation.x = Math.sin(gait) * 0.7 * pace;
                legs[3].rotation.x = Math.sin(gait) * 0.7 * pace;
                legs[1].rotation.x = -Math.sin(gait) * 0.7 * pace;
                legs[2].rotation.x = -Math.sin(gait) * 0.7 * pace;
                headMesh.rotation.x = Math.sin(time * 1.4) * 0.08 - strike * 0.5;
                headMesh.position.z = 0.86 + strike * 0.35;
                tail.rotation.y = Math.sin(time * 3.2) * 0.35;
                body.position.y = Math.abs(Math.sin(gait)) * 0.06 * pace;
            },
        };
    },

    /* ------------------------------ bosses ------------------------------ */

    wyrm: (tint) => {
        const body = new THREE.Group();
        const segments: THREE.Object3D[] = [];
        const count = 9;
        for (let i = 0; i < count; i++) {
            const s = new Sculpt();
            const r = 0.62 - (i / count) * 0.4;
            s.ball(r, i % 2 === 0 ? tint : darker(tint, 0.07), { at: [0, 0, 0], scale: [1, 0.92, 1.25] }, 1);
            s.cone(r * 0.34, r * 0.8, lighter(tint, 0.16), { at: [0, r * 0.95, 0] }, 4);
            const segment = mesh(s);
            segments.push(segment);
            body.add(segment);
        }
        const h = new Sculpt();
        h.ball(0.72, tint, { at: [0, 0, 0], scale: [1, 0.85, 1.25] }, 1);
        h.box(0.78, 0.4, 0.95, lighter(tint, 0.05), { at: [0, -0.12, 0.85] });
        for (const side of [-1, 1]) {
            h.cone(0.14, 0.85, 0xf3ead8, { at: [side * 0.36, 0.62, -0.3], rot: [-0.6, 0, side * -0.25] }, 5);
            h.cone(0.06, 0.24, WHITE, { at: [side * 0.24, -0.4, 1.18], rot: [Math.PI, 0, 0] }, 4);
            h.ball(0.06, EYE, { at: [side * 0.18, 0.04, 1.34] }, 0);
        }
        const headMesh = mesh(h);
        const gaze = new Sculpt();
        for (const side of [-1, 1]) gaze.sphere(0.13, WHITE, { at: [side * 0.34, 0.2, 0.55], scale: [1, 0.7, 0.6] });
        const gazeMesh = glow(gaze.build(), 0xffe08a, 1);
        headMesh.add(gazeMesh);
        body.add(headMesh);
        const wings: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const w = new Sculpt();
            w.cone(1.5, 2.6, darker(tint, 0.14), { at: [side * 1.2, 0.5, 0], rot: [0, 0, side * -1.05], scale: [1, 1, 0.07] }, 3);
            w.cylinder(0.06, 0.09, 2.6, darker(tint, 0.24), { at: [side * 1.2, 0.5, 0.06], rot: [0, 0, side * -1.05] }, 5);
            const wing = mesh(w);
            wings.push(wing);
            body.add(wing);
        }
        return {
            body, extras: wings, height: 3.9, girth: 1.8, hover: 0,
            animate: (time, pace, strike) => {
                segments.forEach((segment, i) => {
                    const t = i / count;
                    // an S-curve that travels down the body
                    segment.position.set(
                        Math.sin(time * 1.6 - t * 5) * 0.55 * (0.4 + t),
                        1.9 - t * 1.5 + Math.sin(time * 2.1 - t * 4) * 0.16,
                        -t * 3.6,
                    );
                });
                headMesh.position.set(Math.sin(time * 1.6 + 0.6) * 0.3, 2.4 + Math.sin(time * 2.1) * 0.16 + strike * 0.3, 0.6 + strike * 1.1);
                headMesh.rotation.set(-0.1 + strike * 0.4, Math.sin(time * 1.2) * 0.2, 0);
                wings.forEach((wing, i) => {
                    wing.position.set(0, 1.7, -0.9);
                    wing.rotation.z = (i === 0 ? -1 : 1) * (Math.sin(time * (2.4 + pace * 2)) * 0.3 + 0.1);
                });
            },
        };
    },
    titan: (tint) => {
        const rock = darker(tint, 0.26);
        const s = new Sculpt();
        s.ball(0.95, rock, { at: [0, 1.7, 0], scale: [1.25, 1.05, 0.95] }, 0);
        s.ball(0.72, rock, { at: [0, 0.85, 0], scale: [1.05, 0.8, 0.9] }, 0, -0.04);
        s.ball(0.5, rock, { at: [0, 2.75, 0.06] }, 0, 0.05);
        for (const side of [-1, 1]) {
            s.ball(0.42, rock, { at: [side * 0.5, 0.3, 0], scale: [0.9, 1, 1.1] }, 0, 0.02);
            s.ball(0.5, rock, { at: [side * 1.15, 2.25, 0], scale: [1.1, 0.8, 1] }, 0, 0.04);
        }
        // moss and a broken crown of stone
        s.ball(0.36, 0x5f8a45, { at: [0.5, 2.5, -0.2], scale: [1.3, 0.4, 1] }, 0);
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            s.cone(0.1, 0.4, lighter(rock, 0.12), { at: [Math.cos(angle) * 0.36, 3.25, Math.sin(angle) * 0.36 + 0.06] }, 4);
        }
        const face = new Sculpt();
        for (const side of [-1, 1]) face.box(0.17, 0.08, 0.05, WHITE, { at: [side * 0.2, 2.8, 0.5] });
        const gaze = glow(face.build(), lighter(tint, 0.25), 1);
        const heart = glow(new THREE.IcosahedronGeometry(0.34, 1), tint, 0.95);
        heart.position.set(0, 1.8, 0.78);
        const arms: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const a = new Sculpt();
            a.ball(0.4, rock, { at: [0, -0.5, 0], scale: [0.8, 1.4, 0.8] }, 0);
            a.ball(0.52, rock, { at: [0, -1.4, 0.05] }, 0, 0.03);
            const arm = mesh(a);
            arm.position.set(side * 1.35, 2.2, 0);
            arms.push(arm);
        }
        const body = new THREE.Group();
        body.add(mesh(s), gaze, heart, ...arms);
        return {
            body, extras: arms, height: 4.1, girth: 1.8, hover: 0,
            animate: (time, pace, strike) => {
                const step = Math.sin(time * (1.5 + pace * 1.6));
                arms[0].rotation.x = step * 0.4 * (0.2 + pace) - strike * 2.4;
                arms[1].rotation.x = -step * 0.4 * (0.2 + pace) - strike * 2.4;
                body.position.y = Math.abs(step) * 0.1 * pace;
                body.rotation.z = step * 0.03;
                heart.scale.setScalar(1 + Math.sin(time * 1.9) * 0.2 + strike * 0.5);
            },
        };
    },
    shade: (tint) => {
        const dark = darker(tint, 0.2);
        const s = new Sculpt();
        s.cylinder(0.5, 1.15, 3.0, dark, { at: [0, 1.5, 0] }, 9);
        s.sphere(0.5, dark, { at: [0, 3.25, 0] });
        s.sphere(0.62, darker(dark, 0.1), { at: [0, 3.3, -0.14], scale: [1.05, 1.1, 1.05] });
        for (let i = 0; i < 9; i++) {
            const angle = (i / 9) * Math.PI * 2;
            s.cone(0.3, 0.72, dark, { at: [Math.cos(angle) * 0.95, 0.22, Math.sin(angle) * 0.95], rot: [Math.PI, 0, 0] }, 5);
        }
        for (let i = 0; i < 5; i++) {
            const angle = -0.8 + (i / 4) * 1.6;
            s.cone(0.07, 0.5, 0xd9b04a, { at: [Math.sin(angle) * 0.48, 3.85, Math.cos(angle) * 0.2 - 0.05], rot: [0, 0, -angle * 0.4] }, 4);
        }
        const robe = new THREE.Mesh(s.build(), new THREE.MeshLambertMaterial({
            vertexColors: true, flatShading: true, transparent: true, opacity: 0.93, emissive: tint, emissiveIntensity: 0.12,
        }));
        robe.castShadow = true;
        const face = new Sculpt();
        for (const side of [-1, 1]) face.sphere(0.085, WHITE, { at: [side * 0.18, 3.28, 0.44], scale: [1.3, 0.6, 0.5] });
        const gaze = glow(face.build(), lighter(tint, 0.35), 1);
        const arms: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const a = new Sculpt();
            a.cylinder(0.09, 0.2, 1.5, dark, { at: [0, -0.75, 0] }, 6);
            for (let f = 0; f < 3; f++) a.cone(0.035, 0.34, 0xd9d2c4, { at: [(f - 1) * 0.08, -1.62, 0.04], rot: [Math.PI, 0, 0] }, 4);
            const arm = new THREE.Mesh(a.build(), robe.material);
            arm.position.set(side * 0.72, 2.75, 0.1);
            arms.push(arm);
        }
        const aura = glow(new THREE.TorusGeometry(1.5, 0.05, 6, 28), tint, 0.5);
        aura.rotation.x = Math.PI / 2;
        aura.position.y = 0.3;
        const body = new THREE.Group();
        body.add(robe, gaze, aura, ...arms);
        return {
            body, extras: arms, height: 4.6, girth: 1.5, hover: 0.3,
            animate: (time, _pace, strike) => {
                body.position.y = Math.sin(time * 1.2) * 0.18;
                arms[0].rotation.set(-0.3 - strike * 1.5, 0, -0.25 - Math.sin(time * 1.5) * 0.12);
                arms[1].rotation.set(-0.3 - strike * 1.5, 0, 0.25 + Math.sin(time * 1.5 + 1) * 0.12);
                aura.scale.setScalar(1 + Math.sin(time * 2) * 0.1 + strike * 0.5);
                aura.rotation.z = time * 0.6;
            },
        };
    },
    queen: (tint) => {
        const s = new Sculpt();
        s.cylinder(0.24, 0.85, 1.9, tint, { at: [0, 1.0, 0] }, 10);
        s.cylinder(0.85, 0.9, 0.08, lighter(tint, 0.18), { at: [0, 0.08, 0] }, 10);
        s.ball(0.34, lighter(tint, 0.1), { at: [0, 2.1, 0], scale: [1, 1.2, 0.8] }, 1);
        s.sphere(0.3, 0xf6dcc8, { at: [0, 2.72, 0] });
        s.sphere(0.34, lighter(tint, 0.3), { at: [0, 2.8, -0.1], scale: [1.05, 1, 1.05] });
        s.box(0.5, 1.2, 0.2, lighter(tint, 0.3), { at: [0, 2.2, -0.3] });
        eyes(s, 2.74, 0.25, 0.11, 0.06, false);
        for (let i = 0; i < 5; i++) {
            const angle = -0.9 + (i / 4) * 1.8;
            s.cone(0.05, 0.34 + (i === 2 ? 0.14 : 0), 0xd9b04a, { at: [Math.sin(angle) * 0.28, 3.14, Math.cos(angle) * 0.12], rot: [0, 0, -angle * 0.3] }, 4);
        }
        const wings: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            for (const tier of [0, 1]) {
                const wing = glow(new THREE.CircleGeometry(1, 5), lighter(tint, 0.2), 0.42);
                wing.scale.set(tier === 0 ? 1.5 : 1.0, tier === 0 ? 0.62 : 0.5, 1);
                wing.position.set(side * (tier === 0 ? 1.1 : 0.85), tier === 0 ? 2.55 : 1.75, -0.25);
                wing.rotation.z = side * (tier === 0 ? 0.5 : -0.4);
                (wing.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
                wings.push(wing);
            }
        }
        const arms: THREE.Object3D[] = [];
        for (const side of [-1, 1]) {
            const a = new Sculpt();
            a.cylinder(0.05, 0.065, 0.85, 0xf6dcc8, { at: [0, -0.42, 0] }, 5);
            const arm = mesh(a);
            arm.position.set(side * 0.34, 2.35, 0);
            arms.push(arm);
        }
        const orb = glow(new THREE.IcosahedronGeometry(0.2, 1), lighter(tint, 0.3), 0.95);
        const body = new THREE.Group();
        body.add(mesh(s), ...wings, ...arms, orb);
        return {
            body, extras: arms, height: 4.0, girth: 1.3, hover: 0.5,
            animate: (time, _pace, strike) => {
                body.position.y = Math.sin(time * 1.4) * 0.2;
                wings.forEach((wing, i) => {
                    const side = i < 2 ? -1 : 1;
                    wing.rotation.y = side * (0.3 + Math.sin(time * 7 + i) * 0.45);
                });
                arms[0].rotation.set(-0.2, 0, -0.5 - strike * 1.2);
                arms[1].rotation.set(-0.5 - strike * 1.3, 0, 0.4);
                orb.position.set(0.6, 2.0 + Math.sin(time * 2.4) * 0.1 + strike * 0.5, 0.5 + strike * 0.9);
                orb.scale.setScalar(1 + Math.sin(time * 4) * 0.15 + strike);
            },
        };
    },
};

const TIER_SCALE = { minion: 1, elite: 1.35, boss: 1.55 } as const;

export function buildCreature(look: CreatureLook, tier: "minion" | "elite" | "boss"): Creature {
    const tint = CREATURE_TINTS[look.tint];
    const parts = (kinds[look.kind] ?? kinds.slime)(tint);
    const scale = look.scale * TIER_SCALE[tier];

    const group = new THREE.Group();
    const lift = new THREE.Group();
    lift.add(parts.body);
    lift.position.y = parts.hover;
    group.add(lift);
    group.scale.setScalar(scale);
    group.name = `creature:${look.kind}`;

    // elites and bosses stand in a ring of their own colour
    let ring: THREE.Mesh | null = null;
    if (tier !== "minion") {
        ring = glow(new THREE.RingGeometry(parts.girth * 1.15, parts.girth * 1.3, 28), tint, tier === "boss" ? 0.75 : 0.5);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        group.add(ring);
    }

    let mood: CreatureMood = "idle";
    let moodTime = 0;
    let moodLength = 0;
    let fall = 0;

    return {
        group,
        height: parts.height * scale + parts.hover * scale,
        girth: parts.girth * scale,
        hover: parts.hover * scale,
        update(delta, time, pace) {
            moodTime += delta;
            let strike = 0;
            if (mood === "strike") {
                strike = Math.sin(Math.min(1, moodTime / moodLength) * Math.PI);
                lift.position.z = strike * 0.7;
            } else if (mood === "hurt") {
                const t = Math.min(1, moodTime / moodLength);
                lift.position.z = -Math.sin(t * Math.PI) * 0.5;
                lift.rotation.x = -Math.sin(t * Math.PI) * 0.3;
                // a quick shudder
                lift.position.x = Math.sin(moodTime * 60) * 0.06 * (1 - t);
            } else if (mood === "fall") {
                fall = Math.min(1, fall + delta / moodLength);
                const shrink = 1 - fall * fall;
                group.scale.setScalar(scale * Math.max(0.001, shrink));
                lift.rotation.y += delta * 9;
                lift.position.y = parts.hover + fall * 1.2;
            }
            if ((mood === "strike" || mood === "hurt") && moodTime >= moodLength) {
                mood = "idle";
                lift.position.set(0, parts.hover, 0);
                lift.rotation.set(0, 0, 0);
            }
            parts.animate(time, pace, strike);
            if (ring) {
                ring.rotation.z = time * 0.5;
                (ring.material as THREE.MeshBasicMaterial).opacity = (tier === "boss" ? 0.6 : 0.4) + Math.sin(time * 2.2) * 0.15;
            }
        },
        play(next, seconds = 0.6) {
            mood = next;
            moodTime = 0;
            moodLength = seconds;
        },
        fallen: () => fall,
        dispose() {
            group.traverse((child) => {
                const made = child as THREE.Mesh;
                if (made.geometry) made.geometry.dispose();
                const material = made.material as THREE.Material | undefined;
                if (material && material !== matte()) material.dispose();
            });
        },
    };
}
