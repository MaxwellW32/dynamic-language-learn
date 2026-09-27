/**
 * People. A figure is a handful of sculpted parts on pivots — hips, chest,
 * head, two arms, two legs — moved by arithmetic rather than by stored
 * animation clips: a walk is two sine waves, a wave is one arm and a wobble.
 *
 * What someone looks like is an `ActorLook`, chosen by the storyteller from
 * fixed lists, so every combination is one this file knows how to build.
 */
import * as THREE from "three";
import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES, type ActorLook } from "@/game/looks";
import { matte, Sculpt } from "./geo";

export type Gesture = "wave" | "cast" | "flinch" | "cheer" | "nod" | "talk" | "bow";

const BOOT = 0x4a3a2c;
const EYE = 0x2a2420;
const GOLD = 0xd9b04a;

const BUILD: Record<ActorLook["build"], { width: number; height: number }> = {
    slim: { width: 0.88, height: 1.02 },
    average: { width: 1, height: 1 },
    stout: { width: 1.24, height: 0.95 },
    tall: { width: 1.02, height: 1.12 },
    small: { width: 0.92, height: 0.86 },
};

const AGE: Record<ActorLook["age"], { scale: number; head: number; stoop: number }> = {
    child: { scale: 0.68, head: 1.28, stoop: 0 },
    adult: { scale: 1, head: 1, stoop: 0 },
    elder: { scale: 0.95, head: 1.02, stoop: 0.2 },
};

function part(sculpt: Sculpt, shadows: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(sculpt.build(), matte());
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    return mesh;
}

/** the long-skirted outfits hide the legs and swing as one piece */
const SKIRTED = new Set<ActorLook["outfit"]>(["robe", "dress", "kimono"]);

export class Actor {
    readonly group = new THREE.Group();
    /** where a name label should float, in the figure's own units */
    readonly height: number;
    readonly look: ActorLook;

    private hips = new THREE.Group();
    private chest = new THREE.Group();
    private head = new THREE.Group();
    private armL = new THREE.Group();
    private armR = new THREE.Group();
    private legL = new THREE.Group();
    private legR = new THREE.Group();
    private eyes: THREE.Mesh | null = null;
    private skirt: THREE.Mesh | null = null;

    private motion = 0;
    private targetMotion = 0;
    private stride = 0;
    private gesture: Gesture | null = null;
    private gestureTime = 0;
    private gestureLength = 0;
    private headTurn = 0;
    private headTurnTarget = 0;
    private readonly phase: number;
    private readonly stoop: number;
    private readonly hipHeight: number;

    constructor(look: ActorLook, seed = 0, shadows = true) {
        this.look = look;
        this.phase = (Math.abs(seed) % 1000) / 1000 * Math.PI * 2;

        const build = BUILD[look.build];
        const age = AGE[look.age];
        this.stoop = age.stoop;

        const skin = SKIN_TONES[look.skin];
        const hair = HAIR_COLORS[look.hairColor];
        const primary = CLOTH_COLORS[look.primary];
        const secondary = CLOTH_COLORS[look.secondary];
        const w = build.width;

        const legLength = 0.78 * build.height;
        const torsoLength = 0.62 * build.height;
        this.hipHeight = legLength + 0.04;
        const shoulder = 0.27 * w;

        /* legs */
        const skirted = SKIRTED.has(look.outfit);
        const trousers = look.outfit === "armor" ? 0x6f7480 : look.outfit === "vest" || look.outfit === "apron" ? 0x5a4a3a : secondary;
        for (const side of [-1, 1]) {
            const s = new Sculpt();
            s.cylinder(0.085 * w, 0.1 * w, legLength - 0.12, skirted ? skin : trousers, { at: [0, -(legLength - 0.12) / 2, 0] }, 6);
            s.box(0.17 * w, 0.13, 0.3, look.outfit === "armor" ? 0x5a5f6a : BOOT, { at: [0, -legLength + 0.065, 0.05] });
            if (look.outfit === "armor") s.cylinder(0.11 * w, 0.115 * w, 0.3, 0x8a909c, { at: [0, -legLength + 0.34, 0] }, 6);
            const leg = side < 0 ? this.legL : this.legR;
            leg.add(part(s, shadows));
            leg.position.set(side * 0.105 * w, 0, 0);
            this.hips.add(leg);
        }

        /* torso and whatever hangs from it */
        const torso = new Sculpt();
        const chestW = 0.5 * w;
        const chestD = 0.28 * w;
        switch (look.outfit) {
            case "robe":
            case "kimono": {
                torso.cylinder(0.23 * w, 0.27 * w, torsoLength, primary, { at: [0, torsoLength / 2, 0], scale: [1, 1, 0.78] }, 8);
                torso.box(chestW * 1.02, 0.11, chestD * 1.12, secondary, { at: [0, 0.06, 0] });
                if (look.outfit === "kimono") {
                    // the collar crosses left over right
                    torso.box(0.07, torsoLength * 0.78, 0.04, secondary, { at: [0.06, torsoLength * 0.62, chestD * 0.47], rot: [0, 0, 0.42] });
                    torso.box(0.07, torsoLength * 0.78, 0.04, secondary, { at: [-0.06, torsoLength * 0.62, chestD * 0.47], rot: [0, 0, -0.42] });
                    torso.box(chestW * 1.06, 0.2, chestD * 1.18, secondary, { at: [0, 0.14, 0] }, -0.06);
                } else {
                    torso.box(0.06, torsoLength * 0.9, 0.03, secondary, { at: [0, torsoLength * 0.5, chestD * 0.5] });
                }
                break;
            }
            case "dress": {
                torso.cylinder(0.2 * w, 0.22 * w, torsoLength, primary, { at: [0, torsoLength / 2, 0], scale: [1, 1, 0.78] }, 8);
                torso.box(chestW * 0.9, 0.08, chestD * 1.05, secondary, { at: [0, 0.04, 0] });
                torso.box(chestW * 0.5, 0.1, 0.03, secondary, { at: [0, torsoLength * 0.86, chestD * 0.44] });
                break;
            }
            case "armor": {
                torso.box(chestW, torsoLength, chestD, 0x8a909c, { at: [0, torsoLength / 2, 0] });
                torso.box(chestW * 0.82, torsoLength * 0.56, 0.05, 0xa9afba, { at: [0, torsoLength * 0.62, chestD * 0.5] });
                torso.box(chestW * 0.3, torsoLength * 0.3, 0.06, primary, { at: [0, torsoLength * 0.62, chestD * 0.53] });
                torso.box(chestW * 1.04, 0.1, chestD * 1.08, 0x5a4a3a, { at: [0, 0.05, 0] });
                for (const side of [-1, 1]) torso.ball(0.15 * w, 0xa9afba, { at: [side * shoulder, torsoLength * 0.95, 0], scale: [1.1, 0.7, 1.1] }, 1);
                break;
            }
            case "vest": {
                torso.box(chestW * 0.96, torsoLength, chestD * 0.94, secondary, { at: [0, torsoLength / 2, 0] });
                for (const side of [-1, 1]) torso.box(chestW * 0.34, torsoLength * 0.9, chestD * 1.06, primary, { at: [side * chestW * 0.33, torsoLength * 0.5, 0] });
                torso.box(chestW * 1.02, 0.08, chestD * 1.08, 0x5a4a3a, { at: [0, 0.04, 0] });
                break;
            }
            default: {
                torso.box(chestW, torsoLength, chestD, primary, { at: [0, torsoLength / 2, 0] });
                torso.box(chestW * 1.04, 0.09, chestD * 1.1, 0x5a4a3a, { at: [0, 0.05, 0] });
                torso.box(0.09, 0.11, 0.04, GOLD, { at: [0, 0.05, chestD * 0.56] });
                torso.box(chestW * 0.4, 0.07, 0.03, secondary, { at: [0, torsoLength * 0.92, chestD * 0.5] });
                if (look.outfit === "apron") {
                    torso.box(chestW * 0.74, torsoLength * 0.78, 0.04, secondary, { at: [0, torsoLength * 0.42, chestD * 0.53] });
                }
                if (look.outfit === "cloak") {
                    // a cape that widens as it falls, gathered at the shoulders
                    torso.cylinder(chestW * 0.5, chestW * 0.86, torsoLength * 1.62, secondary, {
                        at: [0, torsoLength * 0.2, -chestD * 0.66], rot: [0.13, 0, 0], scale: [1, 1, 0.2],
                    }, 7);
                    torso.box(chestW * 1.12, 0.13, chestD * 1.24, secondary, { at: [0, torsoLength * 0.97, 0] }, -0.05);
                    torso.ball(0.05, GOLD, { at: [0, torsoLength * 0.95, chestD * 0.62] }, 0);
                }
            }
        }
        // the neck
        torso.cylinder(0.06 * w, 0.07 * w, 0.1, skin, { at: [0, torsoLength + 0.04, 0] }, 6);
        this.chest.add(part(torso, shadows));

        if (skirted) {
            const s = new Sculpt();
            const flare = look.outfit === "dress" ? 0.44 : 0.33;
            s.cylinder(0.22 * w, flare * w, legLength - 0.1, primary, { at: [0, -(legLength - 0.1) / 2, 0], scale: [1, 1, 0.84] }, 9);
            s.cylinder(flare * w, flare * w * 1.02, 0.06, secondary, { at: [0, -(legLength - 0.13), 0], scale: [1, 1, 0.84] }, 9);
            this.skirt = part(s, shadows);
            this.hips.add(this.skirt);
        }

        /* arms */
        const sleeve = look.outfit === "armor" ? 0x8a909c : look.outfit === "vest" ? secondary : primary;
        const wideSleeve = look.outfit === "robe" || look.outfit === "kimono";
        const armLength = 0.6 * build.height;
        for (const side of [-1, 1]) {
            const s = new Sculpt();
            s.cylinder(wideSleeve ? 0.115 * w : 0.07 * w, 0.075 * w, armLength * 0.78, sleeve, { at: [0, -armLength * 0.39, 0] }, 6);
            s.ball(0.075 * w, skin, { at: [0, -armLength * 0.86, 0] }, 1);
            const arm = side < 0 ? this.armL : this.armR;
            arm.add(part(s, shadows));
            arm.position.set(side * (shoulder + 0.03), torsoLength * 0.93, 0);
            arm.rotation.z = side * 0.09;
            this.chest.add(arm);
        }
        this.addAccessory(look, armLength, w, shadows);

        /* head */
        const headR = 0.215 * age.head;
        const skull = new Sculpt();
        skull.sphere(headR, skin, { at: [0, headR, 0], scale: [1, 1.04, 0.98] });
        skull.sphere(headR * 0.16, skin, { at: [0, headR * 0.9, headR * 0.97] }, -0.04);
        for (const side of [-1, 1]) skull.sphere(headR * 0.18, skin, { at: [side * headR * 0.97, headR * 0.98, 0], scale: [0.5, 1, 0.8] });
        // a little colour in the cheeks
        for (const side of [-1, 1]) skull.sphere(headR * 0.17, 0xf0957a, { at: [side * headR * 0.52, headR * 0.72, headR * 0.8], scale: [1, 0.7, 0.35] });
        this.sculptHair(skull, look, headR, hair);
        this.sculptHat(skull, look, headR, primary, secondary);
        if (look.beard) {
            skull.ball(headR * 0.62, hair, { at: [0, headR * 0.34, headR * 0.5], scale: [1.05, 0.95, 0.75] }, 1);
        }
        this.head.add(part(skull, shadows));

        const eyes = new Sculpt();
        for (const side of [-1, 1]) {
            eyes.sphere(headR * 0.13, EYE, { at: [side * headR * 0.36, headR * 1.08, headR * 0.88], scale: [1, 1.25, 0.6] });
            eyes.sphere(headR * 0.045, 0xffffff, { at: [side * headR * 0.33, headR * 1.15, headR * 0.96] });
            if (look.age === "elder") eyes.box(headR * 0.36, headR * 0.06, 0.02, hair, { at: [side * headR * 0.36, headR * 1.34, headR * 0.9], rot: [0, 0, side * -0.18] });
        }
        this.eyes = part(eyes, false);
        this.head.add(this.eyes);

        this.head.position.set(0, torsoLength + 0.07, 0);
        this.chest.add(this.head);

        this.hips.add(this.chest);
        this.hips.position.y = this.hipHeight;
        this.group.add(this.hips);
        this.group.scale.setScalar(age.scale);

        const hatRise = look.hat === "wizard" ? 0.62 : look.hat === "none" || look.hat === "flower" ? 0.06 : 0.22;
        this.height = (this.hipHeight + torsoLength + 0.07 + headR * 2 + hatRise) * age.scale;
    }

    private sculptHair(s: Sculpt, look: ActorLook, r: number, color: number): void {
        const top = r * 1.12;
        if (look.hair === "bald") return;
        // every style starts from a cap over the crown
        const covered = look.hat === "hood" || look.hat === "bandana";
        if (!covered) s.sphere(r * 1.05, color, { at: [0, top, -r * 0.08], scale: [1.02, 0.86, 1.04] });
        switch (look.hair) {
            case "short":
                s.sphere(r * 0.5, color, { at: [0, r * 1.62, r * 0.5], scale: [1.5, 0.5, 0.8] });
                break;
            case "long":
                s.box(r * 1.85, r * 1.9, r * 0.5, color, { at: [0, r * 0.35, -r * 0.72] });
                for (const side of [-1, 1]) s.box(r * 0.34, r * 1.5, r * 0.7, color, { at: [side * r * 0.9, r * 0.5, -r * 0.25] });
                break;
            case "bun":
                s.ball(r * 0.46, color, { at: [0, r * 2.05, -r * 0.35] }, 1);
                break;
            case "braid":
                for (let i = 0; i < 5; i++) s.ball(r * (0.3 - i * 0.03), color, { at: [0, r * (0.75 - i * 0.42), -r * (0.95 + i * 0.05)] }, 0);
                s.ball(r * 0.12, CLOTH_COLORS[look.secondary], { at: [0, -r * 1.05, -r * 1.18] }, 0);
                break;
            case "ponytail":
                s.ball(r * 0.3, color, { at: [0, r * 1.5, -r * 0.98] }, 0);
                s.cone(r * 0.32, r * 1.5, color, { at: [0, r * 0.6, -r * 1.25], rot: [Math.PI + 0.32, 0, 0] }, 6);
                break;
            case "curly":
                for (let i = 0; i < 9; i++) {
                    const angle = (i / 9) * Math.PI * 2;
                    s.ball(r * 0.4, color, { at: [Math.cos(angle) * r * 0.82, r * (1.35 + (i % 2) * 0.24), Math.sin(angle) * r * 0.82 - r * 0.1] }, 0, (i % 3) * 0.02);
                }
                s.ball(r * 0.5, color, { at: [0, r * 1.95, -r * 0.1] }, 0);
                break;
            case "spiky":
                for (let i = 0; i < 7; i++) {
                    const angle = (i / 7) * Math.PI * 2;
                    s.cone(r * 0.3, r * 0.75, color, { at: [Math.cos(angle) * r * 0.55, r * 1.95, Math.sin(angle) * r * 0.55 - r * 0.1], rot: [Math.sin(angle) * 0.6, 0, -Math.cos(angle) * 0.6] }, 4);
                }
                s.cone(r * 0.32, r * 0.85, color, { at: [0, r * 2.2, -r * 0.1] }, 4);
                break;
        }
    }

    private sculptHat(s: Sculpt, look: ActorLook, r: number, primary: number, secondary: number): void {
        switch (look.hat) {
            case "straw":
                s.cylinder(r * 1.9, r * 1.95, 0.035, 0xd9c27a, { at: [0, r * 1.78, 0] }, 12);
                s.cylinder(r * 0.72, r * 0.95, r * 0.62, 0xe3cf8c, { at: [0, r * 2.08, 0] }, 10);
                s.cylinder(r * 0.97, r * 0.97, 0.05, secondary, { at: [0, r * 1.86, 0] }, 10);
                break;
            case "wizard":
                s.cylinder(r * 1.7, r * 1.75, 0.04, primary, { at: [0, r * 1.75, 0] }, 12, -0.06);
                s.cone(r * 0.95, r * 2.7, primary, { at: [0, r * 3.1, -r * 0.1], rot: [-0.14, 0, 0.06] }, 9, -0.06);
                s.cylinder(r * 0.98, r * 1.0, 0.09, GOLD, { at: [0, r * 1.86, 0] }, 9);
                break;
            case "hood":
                s.sphere(r * 1.2, primary, { at: [0, r * 1.1, -r * 0.14], scale: [1.02, 1.06, 1.06] }, -0.05);
                s.cone(r * 0.5, r * 0.8, primary, { at: [0, r * 2.05, -r * 0.62], rot: [-1.0, 0, 0] }, 6, -0.05);
                break;
            case "cap":
                s.sphere(r * 1.08, primary, { at: [0, r * 1.36, -r * 0.04], scale: [1, 0.62, 1.04] });
                s.box(r * 1.4, 0.035, r * 0.85, primary, { at: [0, r * 1.5, r * 1.0], rot: [0.12, 0, 0] }, -0.06);
                break;
            case "crown":
                s.cylinder(r * 0.8, r * 0.76, r * 0.34, GOLD, { at: [0, r * 1.98, 0] }, 8);
                for (let i = 0; i < 6; i++) {
                    const angle = (i / 6) * Math.PI * 2;
                    s.cone(r * 0.13, r * 0.34, GOLD, { at: [Math.cos(angle) * r * 0.76, r * 2.3, Math.sin(angle) * r * 0.76] }, 4);
                }
                s.ball(r * 0.13, 0xd9483b, { at: [0, r * 2.0, r * 0.8] }, 0);
                break;
            case "bandana":
                s.sphere(r * 1.07, primary, { at: [0, r * 1.26, -r * 0.05], scale: [1.02, 0.74, 1.04] });
                s.cone(r * 0.26, r * 0.72, primary, { at: [r * 0.24, r * 0.98, -r * 1.12], rot: [2.5, 0, 0.3] }, 4);
                s.cone(r * 0.22, r * 0.6, primary, { at: [-r * 0.2, r * 1.0, -r * 1.1], rot: [2.3, 0, -0.35] }, 4);
                break;
            case "flower":
                for (let i = 0; i < 5; i++) {
                    const angle = (i / 5) * Math.PI * 2;
                    s.ball(r * 0.16, secondary, { at: [r * 0.84 + Math.cos(angle) * r * 0.05, r * 1.52 + Math.sin(angle) * r * 0.2, r * 0.42 + Math.cos(angle) * r * 0.2] }, 0);
                }
                s.ball(r * 0.13, 0xf7d046, { at: [r * 0.9, r * 1.52, r * 0.42] }, 0);
                break;
        }
    }

    private addAccessory(look: ActorLook, armLength: number, w: number, shadows: boolean): void {
        const s = new Sculpt();
        const hand = -armLength * 0.86;
        let holder: THREE.Group | null = this.armR;
        switch (look.accessory) {
            case "staff":
                s.cylinder(0.025, 0.032, 1.95, 0x6b4a2f, { at: [0, hand + 0.5, 0.1] }, 6);
                s.ball(0.095, CLOTH_COLORS[look.secondary], { at: [0, hand + 1.55, 0.1] }, 0);
                s.torus(0.12, 0.02, 0x6b4a2f, { at: [0, hand + 1.55, 0.1] });
                break;
            case "basket":
                s.cylinder(0.2, 0.15, 0.2, 0xc8a04a, { at: [0, hand - 0.13, 0.04] }, 9);
                s.torus(0.17, 0.018, 0xa88434, { at: [0, hand + 0.02, 0.04], rot: [0, Math.PI / 2, 0] });
                for (let i = 0; i < 3; i++) s.ball(0.06, [0xd9483b, 0x7ab648, 0xf2c14e][i], { at: [-0.07 + i * 0.07, hand - 0.02, 0.04] }, 0);
                break;
            case "book":
                s.box(0.23, 0.3, 0.07, CLOTH_COLORS[look.secondary], { at: [0.02, hand, 0.1], rot: [0.2, 0.3, 0] });
                s.box(0.2, 0.27, 0.075, 0xf3ead8, { at: [0.035, hand, 0.1], rot: [0.2, 0.3, 0] });
                break;
            case "lantern":
                s.cylinder(0.01, 0.01, 0.22, 0x3a3a44, { at: [0, hand - 0.1, 0.05] }, 4);
                s.box(0.15, 0.2, 0.15, 0x3a3a44, { at: [0, hand - 0.3, 0.05] });
                s.box(0.11, 0.15, 0.11, 0xffd27a, { at: [0, hand - 0.3, 0.05] }, 0.2);
                break;
            case "sword":
                holder = null;
                s.box(0.06, 0.95, 0.025, 0xc9ced8, { at: [-0.3 * w, 0.05, -0.12], rot: [0, 0, 0.35] });
                s.box(0.24, 0.05, 0.05, GOLD, { at: [-0.14 * w, 0.5, -0.12], rot: [0, 0, 0.35] });
                s.cylinder(0.025, 0.025, 0.2, 0x5a4a3a, { at: [-0.1 * w, 0.6, -0.12], rot: [0, 0, 0.35] }, 5);
                break;
            case "satchel":
                holder = null;
                s.box(0.3, 0.24, 0.12, 0x8a6a45, { at: [0.3 * w, 0.0, 0.02] });
                s.box(0.3, 0.1, 0.13, 0x6b4a2f, { at: [0.3 * w, 0.08, 0.02] });
                s.box(0.05, 0.9, 0.02, 0x6b4a2f, { at: [0.05, 0.36, 0.16 * w], rot: [0, 0, -0.62] });
                break;
            case "scarf":
                holder = null;
                s.torus(0.13 * w, 0.05, CLOTH_COLORS[look.secondary], { at: [0, 0.6, 0], rot: [Math.PI / 2, 0, 0] });
                s.box(0.1, 0.42, 0.035, CLOTH_COLORS[look.secondary], { at: [0.08, 0.4, 0.15 * w], rot: [0, 0, 0.1] });
                break;
            case "broom":
                s.cylinder(0.02, 0.02, 1.6, 0x8a6a45, { at: [0, hand + 0.4, 0.08] }, 5);
                s.cone(0.13, 0.4, 0xd9b95a, { at: [0, hand - 0.55, 0.08], rot: [Math.PI, 0, 0] }, 7);
                break;
            case "fishingrod":
                s.cylinder(0.01, 0.022, 2.2, 0x6b4a2f, { at: [0, hand + 0.8, 0.45], rot: [0.5, 0, 0] }, 5);
                s.cylinder(0.004, 0.004, 1.0, 0xf3ead8, { at: [0, hand + 1.25, 1.0] }, 3);
                break;
            default:
                return;
        }
        const mesh = part(s, shadows);
        if (holder) holder.add(mesh);
        else this.chest.add(mesh);
    }

    /** 0 standing, 0.5 walking, 1 running */
    setMotion(amount: number): void {
        this.targetMotion = amount;
    }

    play(gesture: Gesture, seconds = 1.1): void {
        this.gesture = gesture;
        this.gestureTime = 0;
        this.gestureLength = seconds;
    }

    get gesturing(): boolean {
        return this.gesture !== null;
    }

    /** turn the head toward a bearing relative to the body, in radians; null to look ahead */
    lookToward(relativeBearing: number | null): void {
        this.headTurnTarget = relativeBearing === null ? 0 : THREE.MathUtils.clamp(relativeBearing, -1.1, 1.1);
    }

    update(delta: number, time: number): void {
        this.motion += (this.targetMotion - this.motion) * Math.min(1, delta * 9);
        const m = this.motion;
        this.stride += delta * (5.2 + m * 5.5) * (m > 0.02 ? 1 : 0);
        const swing = Math.sin(this.stride) * (0.5 + m * 0.42) * Math.min(1, m * 3);

        // breathing keeps a standing figure from looking like a statue
        const breath = Math.sin(time * 1.7 + this.phase);
        this.chest.scale.y = 1 + breath * 0.012;
        this.chest.rotation.x = this.stoop + m * 0.12;
        this.chest.rotation.y = swing * 0.12;
        this.hips.position.y = this.hipHeight + Math.abs(Math.cos(this.stride)) * 0.05 * Math.min(1, m * 3);

        this.legL.rotation.x = swing;
        this.legR.rotation.x = -swing;
        if (this.skirt) this.skirt.rotation.x = Math.sin(this.stride * 2) * 0.04 * m;

        const idleSway = breath * 0.035;
        this.armL.rotation.set(-swing * 0.85 + idleSway, 0, -0.09);
        this.armR.rotation.set(swing * 0.85 - idleSway, 0, 0.09);

        this.headTurn += (this.headTurnTarget - this.headTurn) * Math.min(1, delta * 5);
        this.head.rotation.set(Math.sin(time * 0.6 + this.phase) * 0.03 - this.stoop * 0.6, this.headTurn, 0);

        // a blink every few seconds
        if (this.eyes) {
            const cycle = (time * 0.31 + this.phase) % 1;
            this.eyes.scale.y = cycle > 0.965 ? 0.15 : 1;
            this.eyes.position.y = cycle > 0.965 ? 0.215 * 0.92 : 0;
        }

        if (this.gesture) {
            this.gestureTime += delta;
            const t = Math.min(1, this.gestureTime / this.gestureLength);
            // rises quickly, holds, settles
            const ease = Math.sin(Math.min(1, t * 1.25) * Math.PI);
            this.applyGesture(this.gesture, ease, time);
            if (t >= 1) this.gesture = null;
        }
    }

    private applyGesture(gesture: Gesture, ease: number, time: number): void {
        switch (gesture) {
            case "wave":
                this.armR.rotation.set(0, 0, 0.09 + ease * 2.5);
                this.armR.rotation.x = Math.sin(time * 11) * 0.3 * ease;
                break;
            case "cast":
                this.armR.rotation.set(-ease * 1.7, 0, 0.09 + ease * 0.2);
                this.armL.rotation.set(-ease * 0.5, 0, -0.09 - ease * 0.3);
                this.chest.rotation.y = -ease * 0.3;
                break;
            case "flinch":
                this.chest.rotation.x = this.stoop - ease * 0.4;
                this.armL.rotation.set(-ease * 0.9, 0, -0.09 - ease * 0.5);
                this.armR.rotation.set(-ease * 0.9, 0, 0.09 + ease * 0.5);
                this.head.rotation.x = -ease * 0.3;
                break;
            case "cheer":
                this.armL.rotation.set(0, 0, -0.09 - ease * 2.6);
                this.armR.rotation.set(0, 0, 0.09 + ease * 2.6);
                this.hips.position.y = this.hipHeight + Math.abs(Math.sin(time * 9)) * 0.22 * ease;
                break;
            case "nod":
                this.head.rotation.x = Math.sin(time * 9) * 0.22 * ease;
                break;
            case "talk":
                this.armR.rotation.set(-ease * 0.75 + Math.sin(time * 6) * 0.14 * ease, 0, 0.09 + ease * 0.3);
                this.armL.rotation.set(-ease * 0.3 + Math.sin(time * 5 + 1) * 0.1 * ease, 0, -0.09 - ease * 0.15);
                this.head.rotation.x += Math.sin(time * 7) * 0.07 * ease;
                break;
            case "bow":
                this.chest.rotation.x = this.stoop + ease * 0.7;
                this.head.rotation.x = ease * 0.3;
                break;
        }
    }

    dispose(): void {
        this.group.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
        });
    }
}
