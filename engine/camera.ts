/**
 * The camera follows the hero from behind and above, swings around them when
 * dragged, and never sinks into a hillside. For conversations and battles it
 * glides to a framing of its own and glides back afterwards.
 */
import * as THREE from "three";
import type { Heightfield } from "@/game/worldgen/terrain";

export type Framing =
    | { kind: "follow" }
    /** over one of the hero's shoulders, looking at someone */
    | { kind: "converse"; with: THREE.Vector3; eyeHeight: number; side: 1 | -1 }
    /** side-on to the two fighters, from whichever side has the clearer view */
    | { kind: "duel"; with: THREE.Vector3; foeHeight: number; side: 1 | -1 }
    /** a slow turn around a point: arrivals, victories */
    | { kind: "survey"; around: THREE.Vector3; radius: number; height: number };

const MIN_DISTANCE = 4.5;
const MAX_DISTANCE = 22;
const MIN_PITCH = 0.12;
const MAX_PITCH = 1.15;

export class FollowCamera {
    readonly camera: THREE.PerspectiveCamera;
    /** the compass bearing the camera looks along; the hero's "forward" when walking */
    yaw = Math.PI;
    pitch = 0.3;
    distance = 10.5;

    private framing: Framing = { kind: "follow" };
    private position = new THREE.Vector3();
    private target = new THREE.Vector3();
    private wantPosition = new THREE.Vector3();
    private wantTarget = new THREE.Vector3();
    private settled = false;
    private surveyAngle = 0;
    private shake = 0;
    /** how far back the lens can sit before something solid is in the way; null when nothing is */
    clearance: number | null = null;

    constructor(aspect: number) {
        this.camera = new THREE.PerspectiveCamera(52, aspect, 0.3, 1400);
    }

    orbit(dx: number, dy: number): void {
        if (this.framing.kind !== "follow") return;
        this.yaw -= dx * 0.0062;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0045, MIN_PITCH, MAX_PITCH);
    }

    zoom(amount: number): void {
        if (this.framing.kind !== "follow") return;
        this.distance = THREE.MathUtils.clamp(this.distance + amount * 1.4, MIN_DISTANCE, MAX_DISTANCE);
    }

    frame(framing: Framing): void {
        this.framing = framing;
        if (framing.kind === "survey") this.surveyAngle = this.yaw;
    }

    get framed(): Framing["kind"] {
        return this.framing.kind;
    }

    /** put the camera where it wants to be at once — after travel, so it does not fly across the map */
    snap(): void {
        this.settled = false;
    }

    /** a jolt, for a hit landing */
    jolt(amount: number): void {
        this.shake = Math.max(this.shake, amount);
    }

    /** the way "forward" points on the ground for a camera-relative walk */
    forward(out: THREE.Vector3): THREE.Vector3 {
        return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }

    update(delta: number, hero: THREE.Vector3, heroHeight: number, field: Heightfield | null): void {
        const f = this.framing;

        if (f.kind === "follow") {
            // something solid between the lens and the hero: come in closer rather than stare at a wall
            const reach = this.clearance === null ? this.distance : Math.max(2.6, Math.min(this.distance, this.clearance));
            const flat = Math.cos(this.pitch) * reach;
            // aim above the hero's head and a little ahead, so the frame is mostly world and sky
            const aim = hero.y + heroHeight * 1.18;
            this.wantTarget.set(hero.x + Math.sin(this.yaw) * 1.6, aim, hero.z + Math.cos(this.yaw) * 1.6);
            this.wantPosition.set(
                hero.x - Math.sin(this.yaw) * flat,
                aim + Math.sin(this.pitch) * reach,
                hero.z - Math.cos(this.yaw) * flat,
            );
        } else if (f.kind === "converse") {
            // behind and beside the hero, so both faces are in frame
            const toward = new THREE.Vector3().subVectors(f.with, hero).setY(0);
            const gap = toward.length() || 1;
            toward.divideScalar(gap);
            const side = new THREE.Vector3(toward.z, 0, -toward.x);
            this.wantPosition.copy(hero)
                .addScaledVector(toward, -3.4)
                .addScaledVector(side, 1.9 * f.side)
                .setY(hero.y + heroHeight * 1.05);
            // the conversation fills the lower part of the screen: aim low, so both faces sit above it
            this.wantTarget.copy(f.with).addScaledVector(toward, -gap * 0.32).setY(f.with.y + f.eyeHeight * 0.18);
        } else if (f.kind === "duel") {
            const toward = new THREE.Vector3().subVectors(f.with, hero).setY(0);
            const gap = toward.length() || 1;
            toward.divideScalar(gap);
            const side = new THREE.Vector3(toward.z, 0, -toward.x);
            const middle = new THREE.Vector3().addVectors(hero, f.with).multiplyScalar(0.5);
            const back = Math.max(8.5, gap * 1.2 + f.foeHeight * 1.2);
            this.wantPosition.copy(middle).addScaledVector(side, back * f.side).addScaledVector(toward, -1.2).setY(middle.y + 2.2 + f.foeHeight * 0.3);
            // the challenge card fills the lower half of the screen: aim low, so the fighters stand in the upper half
            this.wantTarget.copy(middle).setY(middle.y - 1.6 + f.foeHeight * 0.1);
        } else {
            this.surveyAngle += delta * 0.22;
            this.wantTarget.copy(f.around).setY(f.around.y + 1.4);
            this.wantPosition.set(
                f.around.x - Math.sin(this.surveyAngle) * f.radius,
                f.around.y + f.height,
                f.around.z - Math.cos(this.surveyAngle) * f.radius,
            );
        }

        // keep out of the ground
        if (field) {
            const floor = field.at(this.wantPosition.x, this.wantPosition.z) + 1.1;
            if (this.wantPosition.y < floor) this.wantPosition.y = floor;
        }

        if (!this.settled) {
            this.position.copy(this.wantPosition);
            this.target.copy(this.wantTarget);
            this.settled = true;
        } else {
            // following is tight; framed shots glide
            const ease = 1 - Math.exp(-delta * (f.kind === "follow" ? 9 : 3.2));
            this.position.lerp(this.wantPosition, ease);
            this.target.lerp(this.wantTarget, 1 - Math.exp(-delta * (f.kind === "follow" ? 14 : 4)));
        }

        this.camera.position.copy(this.position);
        if (this.shake > 0.001) {
            this.camera.position.x += (Math.random() - 0.5) * this.shake;
            this.camera.position.y += (Math.random() - 0.5) * this.shake;
            this.shake *= Math.exp(-delta * 9);
        }
        this.camera.lookAt(this.target);
    }

    resize(aspect: number): void {
        this.camera.aspect = aspect;
        // a tall phone screen needs a wider lens to see the same ground
        this.camera.fov = aspect < 0.8 ? 66 : aspect < 1.2 ? 58 : 52;
        this.camera.updateProjectionMatrix();
    }
}
