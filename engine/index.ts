/**
 * The world engine. Give it a scene — a region, who and what is in it, where
 * the hero stands — and it builds that place, lets the hero walk around in it,
 * and reports what they walk up to. It knows nothing of stories, servers or
 * React: it draws, moves and tells.
 */
import * as THREE from "three";
import type { Biome, LandmarkKind } from "@/game/looks";
import type { Beacon, ScenePayload, SceneCharacter, SceneEnemy, SceneGate, SceneLandmark } from "@/game/payloads";
import type { Segment } from "@/game/segments";
import {
    clampToReach, facing, generateLayout, INTERACT_RANGE, withinReach,
    type RegionKind, type RegionLayout,
} from "@/game/worldgen/layout";
import { buildHeightfield, type Heightfield } from "@/game/worldgen/terrain";
import { Actor, type Gesture } from "./actor";
import { buildTown, type Town } from "./buildings";
import { FollowCamera } from "./camera";
import { Obstacles, type Circle } from "./collide";
import { buildCreature, type Creature } from "./creatures";
import { segmentsToElement } from "./dom";
import { Effects } from "./fx";
import { disposeObject, type Uniforms } from "./geo";
import { Input } from "./input";
import { Labels } from "./labels";
import { findPath } from "./path";
import { pave } from "./paving";
import { BIOMES, DAYLIGHT, isBiome, isTimeOfDay, sunDirection, tinted, type BiomePalette, type Daylight } from "./palette";
import { buildGate, buildLandmark, type Prop } from "./props";
import { plant } from "./scatter";
import { buildSky, type Sky } from "./sky";
import { buildTerrainMesh, buildWater, waterSurfaceAt } from "./terrainMesh";
import { buildAir, type Air } from "./weather";

export type Quality = "low" | "medium" | "high";

export type Interactable = {
    kind: "character" | "enemy" | "landmark" | "gate";
    id: string;
    name: string;
    /** what acting on it does: "Talk", "Challenge", "Examine", "Travel" */
    verb: string;
};

/**
 * explore: the hero walks. dialogue, battle: the camera frames the two of them.
 * still: the world goes on but the hero stays put — a page is being read.
 * cinematic: the camera circles the hero. paused: nothing moves or is drawn.
 */
export type EngineMode = "explore" | "dialogue" | "battle" | "still" | "cinematic" | "paused";

export type EngineEvents = {
    /** what the hero could act on changed; null when nothing is in reach */
    onNearest: (target: Interactable | null) => void;
    onAct: (target: Interactable) => void;
    /** a creature caught the hero */
    onContact: (enemyId: string) => void;
    /** the hero has walked up to where a goal sent them */
    onReach: (goalId: string) => void;
    onWord: (entryId: number) => void;
    onStick: (stick: { originX: number; originY: number; x: number; y: number } | null) => void;
};

export type EngineReport = {
    ready: boolean;
    mode: EngineMode;
    quality: Quality;
    fps: number;
    drawCalls: number;
    triangles: number;
    pixelRatio: number;
    shadows: boolean;
    region: { name: string; kind: RegionKind; biome: string; timeOfDay: string } | null;
    hero: { x: number; y: number; z: number; moving: boolean };
    nearest: Interactable | null;
    planted: number;
    characters: { id: string; name: string; x: number; z: number; distance: number }[];
    enemies: { id: string; name: string; tier: string; x: number; z: number; distance: number; state: string }[];
    landmarks: { id: string; name: string; kind: string; x: number; z: number; distance: number }[];
    gates: { id: string; label: string; x: number; z: number; distance: number }[];
    /** the place a goal has sent the hero to, when it is in this region */
    beacon: { goalId: string; name: string; x: number; z: number; distance: number; reached: boolean } | null;
};

type CharacterEntity = {
    data: SceneCharacter;
    actor: Actor;
    /** the ground they take up, so that it can be given back if they leave */
    footing: Circle;
    facing: number;
    homeFacing: number;
    nextBark: number;
    barkIndex: number;
};

type EnemyState = "idle" | "wander" | "chase" | "calm" | "held" | "falling";

type EnemyEntity = {
    data: SceneEnemy;
    creature: Creature;
    home: { x: number; z: number };
    x: number;
    z: number;
    facing: number;
    state: EnemyState;
    goal: { x: number; z: number };
    timer: number;
    pace: number;
};

type LandmarkEntity = { data: SceneLandmark; prop: Prop };
type GateEntity = { data: SceneGate; prop: Prop };

const HERO_RADIUS = 0.42;
const RUN_SPEED = 7.4;
const STROLL_SPEED = 3.1;
const GRAVITY = 24;
const HOP_SPEED = 7.5;
const NOTICE_RANGE = 11;
const LEASH = 26;
const GLOW_LIGHTS = 3;

const QUALITY: Record<Quality, { pixelRatio: number; shadowSize: number; density: number; cells: number; air: number }> = {
    low: { pixelRatio: 1, shadowSize: 0, density: 0.55, cells: 128, air: 0.5 },
    medium: { pixelRatio: 1.5, shadowSize: 1024, density: 0.8, cells: 160, air: 0.8 },
    high: { pixelRatio: 2, shadowSize: 2048, density: 1, cells: 192, air: 1 },
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** shortest way round from one bearing to another */
function turnToward(current: number, target: number, maxStep: number): number {
    const gap = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + THREE.MathUtils.clamp(gap, -maxStep, maxStep);
}

export function guessQuality(): Quality {
    if (typeof navigator === "undefined") return "medium";
    const cores = navigator.hardwareConcurrency ?? 4;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const phone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (phone) return cores >= 8 && memory >= 6 ? "medium" : "low";
    if (cores >= 8 && memory >= 8) return "high";
    return cores >= 4 ? "medium" : "low";
}

export class WorldEngine {
    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private view: FollowCamera;
    private input: Input;
    private labels: Labels;
    private fx = new Effects();
    private uniforms: Uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

    private sun = new THREE.DirectionalLight(0xffffff, 2);
    private hemisphere = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
    private glowLights: THREE.PointLight[] = [];
    /** the hero carries a little light of their own after dark */
    private lantern = new THREE.PointLight(0xffc98a, 0, 17, 1.5);
    private toSun = new THREE.Vector3(0.4, 0.8, 0.4);

    /** everything belonging to the loaded region; emptied and rebuilt on travel */
    private world = new THREE.Group();
    private layout: RegionLayout | null = null;
    private field: Heightfield | null = null;
    private palette: BiomePalette = BIOMES.meadow;
    private daylight: Daylight = DAYLIGHT.day;
    private obstacles = new Obstacles();
    private sky: Sky | null = null;
    private air: Air | null = null;
    private town: Town | null = null;
    private planted = 0;
    private payload: ScenePayload | null = null;

    private hero: Actor | null = null;
    private heroSpot = new THREE.Vector3();
    private heroFacing = Math.PI;
    private heroVelocity = new THREE.Vector3();
    private heroLift = 0;
    private heroRise = 0;
    private heroMoving = false;
    /** where a click or a script has sent the hero walking */
    private errand: {
        /** the corners still to walk through; the last is the goal */
        path: { x: number; z: number }[];
        goal: { x: number; z: number };
        then: Interactable | null;
        stopAt: number;
    } | null = null;

    private characters = new Map<string, CharacterEntity>();
    private enemies = new Map<string, EnemyEntity>();
    private landmarks = new Map<string, LandmarkEntity>();
    private gates = new Map<string, GateEntity>();
    private animated: ((time: number) => void)[] = [];
    /** where a goal has sent the hero; kept across regions, shown in the one it belongs to */
    private beacon: Beacon | null = null;
    private beaconLight: { group: THREE.Group; animate: (time: number) => void } | null = null;
    /** the goal whose place has been reached, so that arriving is told once */
    private reached: string | null = null;
    private glowing: { at: THREE.Vector3; color: number; strength: number }[] = [];

    private mode: EngineMode = "explore";
    private nearest: Interactable | null = null;
    private focus: { kind: "character" | "enemy"; id: string } | null = null;
    private ready = false;
    private running = false;
    private frame = 0;
    private clock = new THREE.Clock();
    private time = 0;
    private sinceScan = 0;
    private sinceLights = 0;

    private quality: Quality;
    private adaptive: boolean;
    private pixelRatio: number;
    private shadowsOn: boolean;
    private frames = 0;
    private frameWindow = 0;
    private fps = 60;
    private slowWindows = 0;
    private fastWindows = 0;

    private width = 1;
    private height = 1;
    private resizeObserver: ResizeObserver;
    private readonly onVisibility: () => void;
    private scratch = new THREE.Vector3();
    private scratch2 = new THREE.Vector3();

    constructor(
        private canvas: HTMLCanvasElement,
        labelLayer: HTMLElement,
        private events: EngineEvents,
        options: { quality?: Quality | "auto" } = {},
    ) {
        this.adaptive = options.quality === undefined || options.quality === "auto";
        this.quality = this.adaptive ? guessQuality() : (options.quality as Quality);
        const q = QUALITY[this.quality];
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
        this.shadowsOn = q.shadowSize > 0;

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: this.quality !== "low",
            powerPreference: "high-performance",
            alpha: false,
            stencil: false,
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.renderer.shadowMap.enabled = this.shadowsOn;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.info.autoReset = true;

        this.view = new FollowCamera(1);
        this.scene.add(this.world, this.fx.group, this.hemisphere, this.sun, this.sun.target, this.lantern);

        this.sun.castShadow = this.shadowsOn;
        if (this.shadowsOn) {
            this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
            const lens = this.sun.shadow.camera;
            lens.left = -42;
            lens.right = 42;
            lens.top = 42;
            lens.bottom = -42;
            lens.near = 10;
            lens.far = 260;
            lens.updateProjectionMatrix();
            this.sun.shadow.bias = -0.0005;
            this.sun.shadow.normalBias = 0.5;
            // shade, not ink: the ground under a tree should still be green
            this.sun.shadow.intensity = 0.62;
        }

        // a fixed pool: changing the *number* of lights would recompile every material
        for (let i = 0; i < GLOW_LIGHTS; i++) {
            const light = new THREE.PointLight(0xffc46a, 0, 16, 1.7);
            this.glowLights.push(light);
            this.scene.add(light);
        }

        this.labels = new Labels(labelLayer, (entryId) => this.events.onWord(entryId));
        this.input = new Input(canvas, {
            onAct: () => {
                if (this.mode === "explore" && this.nearest) this.events.onAct(this.nearest);
            },
            onHop: () => {
                if (this.mode === "explore" && this.heroLift === 0) this.heroRise = HOP_SPEED;
            },
            onTap: (x, y) => this.tap(x, y),
            onOrbit: (dx, dy) => this.view.orbit(dx, dy),
            onZoom: (amount) => this.view.zoom(amount),
            onStick: (stick) => this.events.onStick(stick),
        });

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas.parentElement ?? canvas);
        this.resize();

        // a hidden tab should cost nothing
        this.onVisibility = () => {
            if (document.hidden) this.stop();
            else if (this.ready) this.start();
        };
        document.addEventListener("visibilitychange", this.onVisibility);
    }

    /* ---------------------------------------------------------------- */
    /* building a region                                                 */
    /* ---------------------------------------------------------------- */

    async load(payload: ScenePayload): Promise<void> {
        this.ready = false;
        this.clearWorld();
        this.payload = payload;
        const region = payload.region;
        const q = QUALITY[this.quality];

        const biome: Biome = isBiome(region.biome) ? region.biome : "meadow";
        this.palette = BIOMES[biome];
        this.daylight = DAYLIGHT[isTimeOfDay(region.timeOfDay) ? region.timeOfDay : "day"];
        this.layout = generateLayout({ seed: region.seed, kind: region.kind, biome, gates: region.openSides });
        await nextFrame();

        this.field = buildHeightfield(this.layout, q.cells);
        this.obstacles = new Obstacles();
        this.light();
        await nextFrame();

        this.world.add(buildTerrainMesh(this.layout, this.field, this.palette));
        const water = buildWater(this.layout, this.palette, this.uniforms);
        if (water) this.world.add(water);

        this.town = buildTown(payload.buildings, region.styleKit, this.layout, this.field, this.obstacles, this.daylight.lamps, this.shadowsOn);
        if (this.town) {
            this.world.add(this.town.group);
            for (const at of this.town.lampSpots) this.glowing.push({ at, color: 0xffc46a, strength: 11 });
        }
        const paving = pave(this.layout, this.field, this.palette, q.density);
        if (paving) this.world.add(paving);
        await nextFrame();

        for (const landmark of payload.landmarks) this.addLandmark(landmark);
        for (const gate of payload.gates) this.addGate(gate, region.styleKit);

        const planting = plant(this.layout, this.field, this.palette, this.obstacles, this.uniforms, {
            density: q.density,
            shadows: this.shadowsOn,
        });
        this.world.add(planting.group);
        this.planted = planting.count;
        await nextFrame();

        for (const character of payload.characters) this.addCharacter(character);
        for (const enemy of payload.enemies) this.addEnemy(enemy);

        const weather = region.weather === "clear" ? "clear" : region.weather;
        this.air = buildAir(weather, region.seed, q.air);
        if (this.air) this.world.add(this.air.object);

        this.hero?.dispose();
        this.hero = new Actor(payload.hero.look, 1, this.shadowsOn);
        this.hero.group.name = "hero";
        this.world.add(this.hero.group);
        this.teleport(payload.hero.x, payload.hero.z, payload.hero.rot);

        this.raiseBeacon();

        this.setMode("explore");
        this.ready = true;
        this.start();
        // compile every material now, so the first step is not a stutter
        this.renderer.compile(this.scene, this.view.camera);
    }

    private light(): void {
        const light = this.daylight;
        const palette = this.palette;
        this.toSun.copy(sunDirection(light));

        this.sun.color.copy(tinted(light.sun, palette.lightTint));
        this.sun.intensity = light.sunStrength;
        this.hemisphere.color.copy(tinted(light.ambientSky, palette.lightTint));
        this.hemisphere.groundColor.setHex(light.ambientGround).lerp(new THREE.Color(palette.grassA), 0.35);
        this.hemisphere.intensity = light.ambientStrength;
        this.renderer.toneMappingExposure = light.exposure;

        const fog = new THREE.Color(light.fog).lerp(tinted(light.skyHorizon, palette.lightTint), 0.4);
        this.scene.fog = new THREE.FogExp2(fog, palette.fogDensity);
        this.scene.background = fog;

        this.sky?.dispose();
        if (this.sky) this.scene.remove(this.sky.group);
        const cloudiness = this.payload?.region.weather === "rain" || this.payload?.region.weather === "mist" ? 1.6 : 1;
        this.sky = buildSky(light, fog, this.payload?.region.seed ?? 1, this.quality === "low" ? 0.6 : cloudiness);
        this.scene.add(this.sky.group);

        this.uniforms.uWind.value = this.payload?.region.weather === "rain" ? 2 : 1;
        this.lantern.intensity = light.lamps > 0.6 ? 16 * light.lamps : 0;
    }

    private groundAt(x: number, z: number): number {
        return this.field ? this.field.at(x, z) : 0;
    }

    private addLandmark(data: SceneLandmark): void {
        const leafTone = this.palette.leaves[0];
        const prop = buildLandmark(data.kind, data.id, leafTone);
        const y = this.groundAt(data.x, data.z);
        prop.object.position.set(data.x, data.kind === "pond" ? Math.max(y, -0.5) : y - 0.05, data.z);
        prop.object.rotation.y = data.rot;
        this.world.add(prop.object);
        if (prop.footprint > 0) this.obstacles.addCircle({ x: data.x, z: data.z, r: prop.footprint });
        if (prop.animate) this.animated.push(prop.animate);
        if (prop.glow) {
            this.glowing.push({
                at: new THREE.Vector3(data.x, y + prop.glow.height, data.z),
                color: prop.glow.color,
                strength: prop.glow.strength,
            });
        }
        this.landmarks.set(data.id, { data, prop });
        this.labelLandmark(data, prop);
    }

    private labelLandmark(data: SceneLandmark, prop: Prop): void {
        this.labels.add({
            id: `landmark:${data.id}`,
            kind: "landmark",
            title: data.name,
            word: data.label ? { entryId: data.label.entryId, text: data.label.text, hint: data.label.hint } : undefined,
            sought: data.sought,
            // what a goal points at is seen from further off
            range: data.sought ? 34 : 17,
        }, prop.object, prop.labelHeight);
    }

    private addGate(data: SceneGate, styleKit: string): void {
        const prop = buildGate(styleKit);
        prop.object.position.set(data.x, this.groundAt(data.x, data.z) - 0.05, data.z);
        prop.object.rotation.y = data.rot;
        this.world.add(prop.object);
        // the posts, not the opening
        const across = { x: Math.cos(data.rot), z: -Math.sin(data.rot) };
        for (const side of [-1, 1]) {
            this.obstacles.addCircle({ x: data.x + across.x * 2.6 * side, z: data.z + across.z * 2.6 * side, r: 0.7 });
        }
        if (prop.animate) this.animated.push(prop.animate);
        this.gates.set(data.id, { data, prop });
        this.labelGate(data, prop);
    }

    private labelGate(data: SceneGate, prop: Prop): void {
        this.labels.add({
            id: `gate:${data.id}`, kind: "gate", title: data.label, sought: data.sought, range: data.sought ? 60 : 30,
        }, prop.object, prop.labelHeight);
    }

    private addCharacter(data: SceneCharacter): void {
        const seed = [...data.id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) | 0, 3);
        const actor = new Actor(data.look, seed, this.shadowsOn);
        actor.group.position.set(data.x, this.groundAt(data.x, data.z), data.z);
        actor.group.rotation.y = data.rot;
        actor.group.name = `character:${data.id}`;
        this.world.add(actor.group);
        const footing = { x: data.x, z: data.z, r: 0.5 };
        this.obstacles.addCircle(footing);
        this.characters.set(data.id, {
            data, actor, footing, facing: data.rot, homeFacing: data.rot,
            nextBark: 4 + (Math.abs(seed) % 9), barkIndex: Math.abs(seed) % Math.max(1, data.barks.length),
        });
        this.labelCharacter(data, actor);
    }

    private labelCharacter(data: SceneCharacter, actor: Actor): void {
        this.labels.add({
            id: `character:${data.id}`,
            kind: "character",
            title: data.met ? data.name : data.role,
            subtitle: data.met ? data.role : undefined,
            sought: data.sought,
            range: data.sought ? 34 : 20,
        }, actor.group, actor.height + 0.25);
    }

    /** someone has left this place: for another, or for good */
    private removeCharacter(id: string): void {
        const entity = this.characters.get(id);
        if (!entity) return;
        this.labels.remove(`character:${id}`);
        this.labels.remove(`bark:${id}`);
        this.obstacles.removeCircle(entity.footing);
        this.world.remove(entity.actor.group);
        entity.actor.dispose();
        this.characters.delete(id);
        if (this.nearest?.kind === "character" && this.nearest.id === id) {
            this.nearest = null;
            this.events.onNearest(null);
        }
    }

    private addEnemy(data: SceneEnemy): void {
        const creature = buildCreature(data.look, data.tier);
        creature.group.position.set(data.x, this.groundAt(data.x, data.z), data.z);
        this.world.add(creature.group);
        this.enemies.set(data.id, {
            data, creature,
            home: { x: data.x, z: data.z }, x: data.x, z: data.z,
            facing: Math.random() * Math.PI * 2,
            // a creature takes a moment to notice anyone: the hero is not set upon the instant a place is entered
            state: "calm", goal: { x: data.x, z: data.z },
            timer: 5 + Math.random() * 3, pace: 0,
        });
        this.labelEnemy(data, creature);
    }

    private labelEnemy(data: SceneEnemy, creature: Creature): void {
        this.labels.add({
            id: `enemy:${data.id}`,
            kind: "enemy",
            title: data.name,
            subtitle: data.tier === "boss" ? "Boss" : data.tier === "elite" ? "Elite" : undefined,
            sought: data.sought,
            range: data.sought ? 40 : 24,
        }, creature.group, creature.height / creature.group.scale.y + 0.3);
    }

    private clearWorld(): void {
        this.stop();
        this.labels.clear();
        this.fx.clear();
        for (const character of this.characters.values()) character.actor.dispose();
        for (const enemy of this.enemies.values()) enemy.creature.dispose();
        this.characters.clear();
        this.enemies.clear();
        this.landmarks.clear();
        this.gates.clear();
        this.animated = [];
        this.glowing = [];
        this.beaconLight = null;
        this.air?.dispose();
        this.air = null;
        this.town = null;
        this.errand = null;
        this.nearest = null;
        this.focus = null;
        for (const light of this.glowLights) light.intensity = 0;

        const hero = this.hero?.group ?? null;
        for (const child of [...this.world.children]) {
            this.world.remove(child);
            if (child !== hero) {
                disposeObject(child);
                child.traverse((node) => {
                    const mesh = node as THREE.InstancedMesh;
                    if (mesh.isInstancedMesh) mesh.dispose();
                });
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /* what the game tells the engine                                    */
    /* ---------------------------------------------------------------- */

    setMode(mode: EngineMode, focus?: { kind: "character" | "enemy"; id: string }): void {
        this.mode = mode;
        this.focus = focus ?? null;
        this.input.enabled = mode === "explore";
        if (mode !== "explore") {
            this.input.release();
            this.errand = null;
        }
        this.labels.setVisible(mode === "explore");

        if (mode === "dialogue" && focus) {
            const character = this.characters.get(focus.id);
            if (character && this.hero) {
                this.heroFacing = facing(this.heroSpot2d(), character.data);
                this.view.frame({
                    kind: "converse",
                    with: character.actor.group.position.clone(),
                    eyeHeight: character.actor.height,
                    side: this.clearerShoulder(character.data),
                });
            }
        } else if (mode === "battle" && focus) {
            const enemy = this.enemies.get(focus.id);
            if (enemy) {
                this.squareOff(enemy);
                this.view.frame({
                    kind: "duel",
                    with: enemy.creature.group.position.clone(),
                    foeHeight: enemy.creature.height,
                    side: this.clearerSide(enemy),
                });
            }
        } else if (mode === "cinematic") {
            // high enough to clear the rooftops it circles over
            this.view.frame({ kind: "survey", around: this.heroSpot.clone(), radius: 17, height: 11 });
        } else if (mode === "still") {
            this.view.frame({ kind: "follow" });
        } else if (mode === "explore") {
            this.view.frame({ kind: "follow" });
            for (const enemy of this.enemies.values()) {
                if (enemy.state === "held") {
                    enemy.state = "calm";
                    enemy.timer = 8;
                }
            }
        }
        if (this.nearest && mode !== "explore") {
            this.nearest = null;
            this.events.onNearest(null);
        }
    }

    /** over which of the hero's shoulders a conversation is watched: the one without a wall behind it */
    private clearerShoulder(other: { x: number; z: number }): 1 | -1 {
        const from = this.heroSpot2d();
        const gap = Math.hypot(other.x - from.x, other.z - from.z) || 1;
        const toward = { x: (other.x - from.x) / gap, z: (other.z - from.z) / gap };
        const side = { x: toward.z, z: -toward.x };
        const blocked = (sign: number) => {
            const x = from.x - toward.x * 3.4 + side.x * 1.9 * sign;
            const z = from.z - toward.z * 3.4 + side.z * 1.9 * sign;
            let score = 0;
            if (this.obstacles.sightline(from.x, from.z, x, z) !== null) score += 4;
            if (this.obstacles.sightline(x, z, other.x, other.z) !== null) score += 4;
            if (this.obstacles.crowding(x, z, 0.25) < 1.6) score += 1;
            return score;
        };
        return blocked(1) <= blocked(-1) ? 1 : -1;
    }

    /** which side of a duel the camera should stand on: the one with less in the way */
    private clearerSide(enemy: EnemyEntity): 1 | -1 {
        const from = this.heroSpot2d();
        const toward = { x: enemy.x - from.x, z: enemy.z - from.z };
        const gap = Math.hypot(toward.x, toward.z) || 1;
        const side = { x: toward.z / gap, z: -toward.x / gap };
        const middle = { x: (from.x + enemy.x) / 2, z: (from.z + enemy.z) / 2 };
        const crowded = (sign: number) => {
            let score = 0;
            for (let out = 2; out <= 10; out += 2) {
                const x = middle.x + side.x * out * sign;
                const z = middle.z + side.z * out * sign;
                if (this.obstacles.crowding(x, z, 0.25) < 2.4) score += 1;
                if (this.obstacles.sightline(middle.x, middle.z, x, z) !== null) score += 3;
            }
            return score;
        };
        return crowded(1) <= crowded(-1) ? 1 : -1;
    }

    /** stand the two fighters a fair distance apart, facing each other */
    private squareOff(enemy: EnemyEntity): void {
        enemy.state = "held";
        const gap = 5.2 + enemy.creature.girth;
        const from = this.heroSpot2d();
        let bearing = facing(from, enemy);
        if (Math.hypot(enemy.x - from.x, enemy.z - from.z) < 0.5) bearing = this.heroFacing;
        enemy.x = from.x + Math.sin(bearing) * gap;
        enemy.z = from.z + Math.cos(bearing) * gap;
        const spot = clampToReach(this.layout!, { x: enemy.x, z: enemy.z });
        enemy.x = spot.x;
        enemy.z = spot.z;
        enemy.facing = bearing + Math.PI;
        enemy.creature.group.position.set(enemy.x, this.groundAt(enemy.x, enemy.z), enemy.z);
        enemy.creature.group.rotation.y = enemy.facing;
        this.heroFacing = bearing;
    }

    /** the hero's spell flies; `onHit` fires as it lands */
    castSpell(enemyId: string, color: number, onHit?: () => void): void {
        const enemy = this.enemies.get(enemyId);
        if (!enemy || !this.hero) return;
        this.hero.play("cast", 0.8);
        const from = this.scratch.copy(this.heroSpot).setY(this.heroSpot.y + this.hero.height * 0.72).clone();
        const to = enemy.creature.group.position.clone().setY(enemy.creature.group.position.y + enemy.creature.height * 0.5);
        window.setTimeout(() => {
            this.fx.bolt(from, to, color, () => {
                enemy.creature.play("hurt", 0.5);
                this.view.jolt(0.18);
                onHit?.();
            });
        }, 260);
    }

    /** the creature strikes back */
    enemyStrike(enemyId: string, onHit?: () => void): void {
        const enemy = this.enemies.get(enemyId);
        if (!enemy || !this.hero) return;
        enemy.creature.play("strike", 0.6);
        const from = enemy.creature.group.position.clone().setY(enemy.creature.group.position.y + enemy.creature.height * 0.5);
        const to = this.heroSpot.clone().setY(this.heroSpot.y + this.hero.height * 0.6);
        window.setTimeout(() => {
            this.fx.lash(from, to, 0x9a5cf0, () => {
                this.hero?.play("flinch", 0.6);
                this.view.jolt(0.3);
                onHit?.();
            });
        }, 220);
    }

    /** the creature is beaten: it spins away in light and is gone */
    defeatEnemy(enemyId: string): void {
        const enemy = this.enemies.get(enemyId);
        if (!enemy) return;
        enemy.state = "falling";
        enemy.creature.play("fall", 1.1);
        this.labels.remove(`enemy:${enemyId}`);
        const at = enemy.creature.group.position.clone();
        this.fx.fountain(at, 0xffe08a, 2.4);
        this.fx.burst(at.clone().setY(at.y + 1), 0xfff1c9, 40, 7, 1.1);
        this.hero?.play("cheer", 1.6);
    }

    /** the hero backed away: the creature loses interest for a while */
    calmEnemy(enemyId: string, seconds = 14): void {
        const enemy = this.enemies.get(enemyId);
        if (!enemy) return;
        enemy.state = "calm";
        enemy.timer = seconds;
        // and the hero steps back out of reach
        const away = facing(enemy, this.heroSpot2d());
        const spot = clampToReach(this.layout!, {
            x: this.heroSpot.x + Math.sin(away) * 4,
            z: this.heroSpot.z + Math.cos(away) * 4,
        });
        this.heroSpot.x = spot.x;
        this.heroSpot.z = spot.z;
    }

    heroGesture(gesture: Gesture, seconds?: number): void {
        this.hero?.play(gesture, seconds);
    }

    characterGesture(id: string, gesture: Gesture, seconds?: number): void {
        this.characters.get(id)?.actor.play(gesture, seconds);
    }

    /** a flourish of light at the hero's feet: a quest done, a word learned */
    celebrate(color = 0xffe08a): void {
        this.fx.fountain(this.heroSpot.clone(), color, 2);
        this.hero?.play("cheer", 1.4);
    }

    /** someone says something aloud, in a bubble over their head */
    say(characterId: string, segments: Segment[], seconds = 5): void {
        const character = this.characters.get(characterId);
        if (!character) return;
        const content = segmentsToElement(segments, (entryId) => this.events.onWord(entryId), { translation: true });
        this.labels.say(`bark:${characterId}`, character.actor.group, character.actor.height + 0.95, content, seconds, this.time);
        character.actor.play("talk", Math.min(seconds, 2.4));
    }

    /**
     * The scene changed without travel: a goal now points elsewhere, someone
     * has stepped into the story or left it, a creature has come back. What is
     * given is the whole of each list: whoever is not in it is no longer here.
     */
    refresh(update: { characters?: SceneCharacter[]; enemies?: SceneEnemy[]; landmarks?: SceneLandmark[]; gates?: SceneGate[] }): void {
        if (update.characters) {
            const here = new Set(update.characters.map((data) => data.id));
            for (const id of [...this.characters.keys()]) if (!here.has(id)) this.removeCharacter(id);
            for (const data of update.characters) {
                const entity = this.characters.get(data.id);
                if (!entity) {
                    this.addCharacter(data);
                    // they arrive in a little light, so that a newcomer is noticed
                    this.fx.fountain(new THREE.Vector3(data.x, this.groundAt(data.x, data.z), data.z), 0xc9a7ff, 1.6);
                } else if (Math.hypot(entity.data.x - data.x, entity.data.z - data.z) > 0.5) {
                    // moved within the region: simplest to let them leave and come again
                    this.removeCharacter(data.id);
                    this.addCharacter(data);
                } else {
                    entity.data = data;
                    this.labelCharacter(data, entity.actor);
                }
            }
        }
        if (update.enemies) {
            const here = new Set(update.enemies.map((data) => data.id));
            for (const [id, entity] of [...this.enemies]) {
                // one that is falling is on its way out by itself
                if (here.has(id) || entity.state === "falling") continue;
                this.labels.remove(`enemy:${id}`);
                this.world.remove(entity.creature.group);
                entity.creature.dispose();
                this.enemies.delete(id);
            }
            for (const data of update.enemies) {
                const entity = this.enemies.get(data.id);
                if (!entity) this.addEnemy(data);
                else if (entity.state !== "falling") {
                    const marked = entity.data.sought !== data.sought;
                    entity.data = data;
                    if (marked) this.labelEnemy(data, entity.creature);
                }
            }
        }
        for (const data of update.landmarks ?? []) {
            const entity = this.landmarks.get(data.id);
            if (!entity) continue;
            const marked = entity.data.sought !== data.sought;
            entity.data = data;
            if (marked) this.labelLandmark(data, entity.prop);
        }
        for (const data of update.gates ?? []) {
            const entity = this.gates.get(data.id);
            if (!entity) continue;
            const marked = entity.data.sought !== data.sought;
            entity.data = data;
            if (marked) this.labelGate(data, entity.prop);
        }
    }

    /**
     * Mark the place a goal has sent the hero to with a column of light, or
     * take the mark away (null). It is shown only in the region it belongs to,
     * and the engine tells when the hero has walked up to it.
     */
    setBeacon(beacon: Beacon | null): void {
        this.beacon = beacon;
        this.reached = null;
        if (this.ready) this.raiseBeacon();
    }

    private raiseBeacon(): void {
        if (this.beaconLight) {
            const old = this.beaconLight;
            this.animated = this.animated.filter((animate) => animate !== old.animate);
            this.labels.remove("beacon");
            this.world.remove(old.group);
            disposeObject(old.group);
            this.beaconLight = null;
        }
        const beacon = this.beacon;
        if (!beacon || beacon.regionId !== this.payload?.region.id) return;

        const glow = (opacity: number) => new THREE.MeshBasicMaterial({
            color: 0xffd36a, transparent: true, opacity, blending: THREE.AdditiveBlending,
            depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false,
        });
        const group = new THREE.Group();
        group.name = "beacon";
        const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.1, 26, 16, 1, true), glow(0.2));
        column.position.y = 13;
        const ring = new THREE.Mesh(new THREE.RingGeometry(beacon.radius * 0.5 - 0.22, beacon.radius * 0.5, 40), glow(0.75));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.12;
        group.add(column, ring);
        group.position.set(beacon.x, this.groundAt(beacon.x, beacon.z), beacon.z);

        const animate = (time: number) => {
            const beat = 0.5 + 0.5 * Math.sin(time * 2.2);
            (column.material as THREE.MeshBasicMaterial).opacity = 0.14 + beat * 0.12;
            column.rotation.y = time * 0.4;
            ring.scale.setScalar(0.85 + beat * 0.3);
            (ring.material as THREE.MeshBasicMaterial).opacity = 0.85 - beat * 0.45;
        };
        this.world.add(group);
        this.animated.push(animate);
        this.beaconLight = { group, animate };
        this.labels.add({ id: "beacon", kind: "landmark", title: beacon.name, sought: true, range: 90 }, group, 3.2);
    }

    teleport(x: number, z: number, rot?: number): void {
        const spot = this.layout ? clampToReach(this.layout, { x, z }) : { x, z };
        this.heroSpot.set(spot.x, this.groundAt(spot.x, spot.z), spot.z);
        this.heroVelocity.set(0, 0, 0);
        this.heroLift = 0;
        this.heroRise = 0;
        if (rot !== undefined) {
            this.heroFacing = rot;
            this.view.yaw = rot;
        }
        this.errand = null;
        this.view.snap();
    }

    /** send the hero walking to a spot or to something; resolves when they arrive or give up */
    walkTo(target: { x: number; z: number } | { kind: Interactable["kind"]; id?: string }, act = false): Promise<boolean> {
        let goal: { x: number; z: number } | null = null;
        let then: Interactable | null = null;
        let stopAt = 0.5;

        if ("x" in target) {
            goal = { x: target.x, z: target.z };
        } else {
            const found = this.find(target.kind, target.id);
            if (found) {
                goal = found.at;
                then = act ? found.what : null;
                stopAt = found.stopAt;
            }
        }
        if (!goal || !this.setErrand(goal, then, stopAt)) return Promise.resolve(false);

        const started = this.time;
        return new Promise((resolve) => {
            const check = () => {
                if (!this.errand) {
                    resolve(Math.hypot(this.heroSpot.x - goal!.x, this.heroSpot.z - goal!.z) <= stopAt + 1.5);
                } else if (this.time - started > 60) {
                    this.errand = null;
                    resolve(false);
                } else {
                    window.setTimeout(check, 120);
                }
            };
            check();
        });
    }

    /**
     * Walk to whatever is marked in this region — whom the goal in hand names,
     * what it points at, the gate it lies through — and act on it.
     */
    walkToSought(): Promise<boolean> {
        for (const c of this.characters.values()) if (c.data.sought) return this.walkTo({ kind: "character", id: c.data.id }, true);
        for (const e of this.enemies.values()) if (e.data.sought && e.state !== "falling") return this.walkTo({ kind: "enemy", id: e.data.id }, true);
        for (const l of this.landmarks.values()) if (l.data.sought) return this.walkTo({ kind: "landmark", id: l.data.id }, true);
        for (const g of this.gates.values()) if (g.data.sought) return this.walkTo({ kind: "gate", id: g.data.id }, true);
        return Promise.resolve(false);
    }

    /** plan a walk; false when there is no way there */
    private setErrand(goal: { x: number; z: number }, then: Interactable | null, stopAt: number): boolean {
        const here = this.heroSpot2d();
        const path = findPath((x, z) => this.walkable({ x, z }), here, goal);
        if (!path) {
            // no nearer spot than this one, and the thing is within arm's reach: that is arriving, not failing
            const gap = Math.hypot(goal.x - here.x, goal.z - here.z);
            if (then === null || gap > Math.max(INTERACT_RANGE, stopAt + 1.5)) return false;
        }
        this.errand = { path: path ?? [], goal: { x: goal.x, z: goal.z }, then, stopAt };
        return true;
    }

    /** the nearest thing of a kind, or one by id */
    private find(kind: Interactable["kind"], id?: string): { at: { x: number; z: number }; what: Interactable; stopAt: number } | null {
        const here = this.heroSpot2d();
        const candidates: { at: { x: number; z: number }; what: Interactable; stopAt: number }[] = [];
        if (kind === "character") {
            for (const c of this.characters.values()) candidates.push({ at: c.data, what: this.describe("character", c.data.id)!, stopAt: 2.2 });
        } else if (kind === "enemy") {
            for (const e of this.enemies.values()) {
                if (e.state !== "falling") candidates.push({ at: { x: e.x, z: e.z }, what: this.describe("enemy", e.data.id)!, stopAt: 2.4 + e.creature.girth });
            }
        } else if (kind === "landmark") {
            for (const l of this.landmarks.values()) candidates.push({ at: l.data, what: this.describe("landmark", l.data.id)!, stopAt: l.prop.footprint + 1.6 });
        } else {
            for (const g of this.gates.values()) candidates.push({ at: g.data, what: this.describe("gate", g.data.id)!, stopAt: 1.5 });
        }
        const pool = id ? candidates.filter((c) => c.what.id === id) : candidates;
        pool.sort((a, b) => Math.hypot(a.at.x - here.x, a.at.z - here.z) - Math.hypot(b.at.x - here.x, b.at.z - here.z));
        return pool[0] ?? null;
    }

    private describe(kind: Interactable["kind"], id: string): Interactable | null {
        if (kind === "character") {
            const c = this.characters.get(id);
            return c ? { kind, id, name: c.data.met ? c.data.name : c.data.role, verb: "Talk" } : null;
        }
        if (kind === "enemy") {
            const e = this.enemies.get(id);
            return e ? { kind, id, name: e.data.name, verb: "Challenge" } : null;
        }
        if (kind === "landmark") {
            const l = this.landmarks.get(id);
            return l ? { kind, id, name: l.data.name, verb: l.data.examined ? "Reread" : "Examine" } : null;
        }
        const g = this.gates.get(id);
        return g ? { kind, id, name: g.data.label, verb: "Travel" } : null;
    }

    heroPosition(): { x: number; z: number; rot: number } {
        return { x: this.heroSpot.x, z: this.heroSpot.z, rot: this.heroFacing };
    }

    private heroSpot2d(): { x: number; z: number } {
        return { x: this.heroSpot.x, z: this.heroSpot.z };
    }

    /* ---------------------------------------------------------------- */
    /* the frame                                                         */
    /* ---------------------------------------------------------------- */

    private start(): void {
        if (this.running) return;
        this.running = true;
        this.clock.getDelta();
        const tick = () => {
            if (!this.running) return;
            this.frame = requestAnimationFrame(tick);
            this.step(Math.min(0.05, this.clock.getDelta()));
        };
        this.frame = requestAnimationFrame(tick);
    }

    private stop(): void {
        this.running = false;
        cancelAnimationFrame(this.frame);
    }

    private step(delta: number): void {
        if (!this.ready || !this.hero || !this.field || !this.layout) return;
        if (this.mode === "paused") return;

        this.time += delta;
        this.uniforms.uTime.value = this.time;

        this.moveHero(delta);
        this.moveCharacters(delta);
        this.moveEnemies(delta);
        for (const animate of this.animated) animate(this.time);

        this.sinceScan += delta;
        if (this.sinceScan > 0.12) {
            this.sinceScan = 0;
            this.scan();
        }
        this.sinceLights += delta;
        if (this.sinceLights > 0.5) {
            this.sinceLights = 0;
            this.placeGlows();
        }

        this.lantern.position.set(this.heroSpot.x, this.heroSpot.y + 2.1, this.heroSpot.z);
        this.watchSightline();
        this.view.update(delta, this.heroSpot, this.hero.height, this.field);
        this.followSun();
        this.sky?.update(this.view.camera, this.time, delta);
        this.air?.update(delta, this.time, this.heroSpot);
        this.fx.update(delta);
        this.labels.update(this.view.camera, this.heroSpot, this.width, this.height, this.time, this.behindWall);

        this.renderer.render(this.scene, this.view.camera);
        this.measure(delta);
    }

    private moveHero(delta: number): void {
        const hero = this.hero!;
        const layout = this.layout!;
        const field = this.field!;
        const move = this.input.state.move;
        let wantX = 0;
        let wantZ = 0;
        let speed = 0;

        const steering = this.mode === "explore" && (Math.abs(move.x) > 0.02 || Math.abs(move.y) > 0.02);
        if (steering) {
            this.errand = null;
            const forward = this.view.forward(this.scratch);
            // camera-relative: forward is away from the camera, right is to its right
            wantX = forward.x * move.y - forward.z * move.x;
            wantZ = forward.z * move.y + forward.x * move.x;
            const strength = Math.min(1, Math.hypot(move.x, move.y));
            speed = (this.input.state.stroll ? STROLL_SPEED : RUN_SPEED) * strength;
        } else if (this.errand && this.mode === "explore") {
            const errand = this.errand;
            const toGoal = Math.hypot(errand.goal.x - this.heroSpot.x, errand.goal.z - this.heroSpot.z);
            // corners are passed; only the goal is arrived at
            while (errand.path.length > 1 && Math.hypot(errand.path[0].x - this.heroSpot.x, errand.path[0].z - this.heroSpot.z) < 0.9) {
                errand.path.shift();
            }
            const next = errand.path[0];
            const gap = next ? Math.hypot(next.x - this.heroSpot.x, next.z - this.heroSpot.z) : 0;
            if (toGoal <= errand.stopAt || !next || (errand.path.length === 1 && gap < 0.35)) {
                this.errand = null;
                if (errand.then) this.events.onAct(errand.then);
            } else {
                wantX = (next.x - this.heroSpot.x) / gap;
                wantZ = (next.z - this.heroSpot.z) / gap;
                // ease off only when the goal itself is near, not at every corner
                speed = RUN_SPEED * Math.min(1, toGoal / 2 + 0.35);
            }
        }

        const length = Math.hypot(wantX, wantZ);
        if (length > 0.001) {
            wantX /= length;
            wantZ /= length;
        }
        // velocity eases toward what is wanted: quick to start, quick to stop, never instant
        const ease = 1 - Math.exp(-delta * 12);
        this.heroVelocity.x += (wantX * speed - this.heroVelocity.x) * ease;
        this.heroVelocity.z += (wantZ * speed - this.heroVelocity.z) * ease;

        const pace = Math.hypot(this.heroVelocity.x, this.heroVelocity.z);
        this.heroMoving = pace > 0.25;

        if (this.heroMoving) {
            const next = { x: this.heroSpot.x + this.heroVelocity.x * delta, z: this.heroSpot.z + this.heroVelocity.z * delta };
            this.obstacles.resolve(next, HERO_RADIUS);

            let blocked = !withinReach(layout, next);
            if (!blocked) {
                const ground = field.at(next.x, next.z);
                const surface = waterSurfaceAt(layout, next.x, next.z);
                // wading is fine; swimming is not
                if (surface !== null && ground < surface - 0.75) blocked = true;
                // too steep to climb
                if (ground - this.heroSpot.y > 0.9 * Math.max(0.5, pace * delta * 4) && field.slopeAt(next.x, next.z) > 0.95) blocked = true;
            }
            if (blocked) {
                // slide along the edge rather than stop dead
                const slideX = { x: next.x, z: this.heroSpot.z };
                const slideZ = { x: this.heroSpot.x, z: next.z };
                if (this.walkable(slideX)) { next.x = slideX.x; next.z = slideX.z; }
                else if (this.walkable(slideZ)) { next.x = slideZ.x; next.z = slideZ.z; }
                else { next.x = this.heroSpot.x; next.z = this.heroSpot.z; this.errand = null; }
            }
            this.heroSpot.x = next.x;
            this.heroSpot.z = next.z;
            this.heroFacing = turnToward(this.heroFacing, Math.atan2(this.heroVelocity.x, this.heroVelocity.z), delta * 11);
        }

        // hopping
        if (this.heroLift > 0 || this.heroRise > 0) {
            this.heroRise -= GRAVITY * delta;
            this.heroLift += this.heroRise * delta;
            if (this.heroLift <= 0) {
                this.heroLift = 0;
                this.heroRise = 0;
            }
        }

        const ground = field.at(this.heroSpot.x, this.heroSpot.z);
        const surface = waterSurfaceAt(layout, this.heroSpot.x, this.heroSpot.z);
        const floor = surface !== null && ground < surface - 0.5 ? surface - 0.5 : ground;
        // ease onto the ground so bumps do not jolt the camera
        this.heroSpot.y += (floor - this.heroSpot.y) * (1 - Math.exp(-delta * 18));

        hero.group.position.set(this.heroSpot.x, this.heroSpot.y + this.heroLift, this.heroSpot.z);
        hero.group.rotation.y = this.heroFacing;
        hero.setMotion(this.heroLift > 0 ? 0.2 : Math.min(1, pace / RUN_SPEED));

        // in a conversation the hero looks at who they are talking to
        if (this.mode === "dialogue" && this.focus) {
            const other = this.characters.get(this.focus.id);
            if (other) hero.group.rotation.y = this.heroFacing = turnToward(this.heroFacing, facing(this.heroSpot2d(), other.data), delta * 6);
        }
        hero.update(delta, this.time);
    }

    private walkable(p: { x: number; z: number }): boolean {
        if (!withinReach(this.layout!, p)) return false;
        const ground = this.field!.at(p.x, p.z);
        const surface = waterSurfaceAt(this.layout!, p.x, p.z);
        if (surface !== null && ground < surface - 0.75) return false;
        return this.obstacles.isFree(p.x, p.z, HERO_RADIUS * 0.9);
    }

    private moveCharacters(delta: number): void {
        const here = this.heroSpot2d();
        for (const character of this.characters.values()) {
            const { data, actor } = character;
            const gap = Math.hypot(data.x - here.x, data.z - here.z);
            const attentive = gap < 8 || (this.mode === "dialogue" && this.focus?.id === data.id);

            // turn to whoever comes near; turn back to their work when left alone
            const want = attentive ? facing(data, here) : character.homeFacing;
            character.facing = turnToward(character.facing, want, delta * 3.2);
            actor.group.rotation.y = character.facing;

            if (gap < 14 && !attentive) {
                const bearing = facing(data, here) - character.facing;
                actor.lookToward(Math.atan2(Math.sin(bearing), Math.cos(bearing)));
            } else {
                actor.lookToward(null);
            }

            if (this.mode === "explore" && data.barks.length > 0 && gap < 9 && gap > 2.5) {
                character.nextBark -= delta;
                if (character.nextBark <= 0 && !this.labels.has(`bark:${data.id}`)) {
                    this.say(data.id, data.barks[character.barkIndex % data.barks.length], 5.5);
                    actor.play("wave", 1.3);
                    character.barkIndex++;
                    character.nextBark = 38 + Math.random() * 30;
                }
            }

            if (this.mode === "dialogue" && this.focus?.id === data.id && !actor.gesturing && Math.random() < delta * 0.35) {
                actor.play("nod", 0.9);
            }
            actor.update(delta, this.time);
        }
    }

    private moveEnemies(delta: number): void {
        const here = this.heroSpot2d();
        const layout = this.layout!;

        for (const [id, enemy] of this.enemies) {
            const { creature } = enemy;

            if (enemy.state === "falling") {
                creature.update(delta, this.time, 0);
                if (creature.fallen() >= 1) {
                    this.world.remove(creature.group);
                    creature.dispose();
                    this.enemies.delete(id);
                }
                continue;
            }

            const gap = Math.hypot(enemy.x - here.x, enemy.z - here.z);
            let speed = 0;

            if (enemy.state === "held") {
                // standing its ground in a battle
                enemy.facing = turnToward(enemy.facing, facing(enemy, here), delta * 5);
            } else if (this.mode !== "explore") {
                // the world holds its breath while a panel is open
            } else {
                enemy.timer -= delta;
                const strayed = Math.hypot(enemy.x - enemy.home.x, enemy.z - enemy.home.z);

                if (enemy.state === "calm") {
                    if (enemy.timer <= 0) enemy.state = "idle";
                } else if (gap < NOTICE_RANGE && strayed < LEASH) {
                    enemy.state = "chase";
                } else if (enemy.state === "chase") {
                    enemy.state = "wander";
                    enemy.goal = { ...enemy.home };
                }

                if (enemy.state === "chase") {
                    enemy.goal = here;
                    speed = enemy.data.tier === "boss" ? 2.3 : enemy.data.tier === "elite" ? 3.6 : 3.1;
                    if (gap < creature.girth + 1.15) {
                        enemy.state = "held";
                        this.events.onContact(id);
                        continue;
                    }
                } else if (enemy.state === "idle" || enemy.state === "calm") {
                    if (enemy.timer <= 0 && enemy.state === "idle") {
                        const angle = Math.random() * Math.PI * 2;
                        const reach = 2 + Math.random() * 6;
                        enemy.goal = clampToReach(layout, { x: enemy.home.x + Math.cos(angle) * reach, z: enemy.home.z + Math.sin(angle) * reach });
                        enemy.state = "wander";
                    }
                } else if (enemy.state === "wander") {
                    speed = 1.3;
                    if (Math.hypot(enemy.goal.x - enemy.x, enemy.goal.z - enemy.z) < 0.6) {
                        enemy.state = "idle";
                        enemy.timer = 2 + Math.random() * 4;
                    }
                }

                if (speed > 0) {
                    const bearing = facing(enemy, enemy.goal);
                    enemy.facing = turnToward(enemy.facing, bearing, delta * 5);
                    const next = { x: enemy.x + Math.sin(enemy.facing) * speed * delta, z: enemy.z + Math.cos(enemy.facing) * speed * delta };
                    this.obstacles.resolve(next, Math.min(0.9, creature.girth * 0.7));
                    if (withinReach(layout, next, 2)) {
                        enemy.x = next.x;
                        enemy.z = next.z;
                    } else {
                        enemy.state = "idle";
                        enemy.timer = 1;
                    }
                }
            }

            enemy.pace += ((speed > 0 ? Math.min(1, speed / 3.4) : 0) - enemy.pace) * Math.min(1, delta * 6);
            const ground = this.groundAt(enemy.x, enemy.z);
            const surface = waterSurfaceAt(layout, enemy.x, enemy.z);
            creature.group.position.set(enemy.x, surface !== null ? Math.max(ground, surface) : ground, enemy.z);
            creature.group.rotation.y = enemy.facing;
            creature.update(delta, this.time, enemy.pace);
        }
    }

    /** tell the camera how far back it can sit before a building is in the way */
    private watchSightline(): void {
        const reach = this.view.distance * Math.cos(this.view.pitch);
        const hit = this.obstacles.sightline(
            this.heroSpot.x, this.heroSpot.z,
            this.heroSpot.x - Math.sin(this.view.yaw) * reach, this.heroSpot.z - Math.cos(this.view.yaw) * reach,
        );
        let clear = hit === null ? Infinity : hit - 0.7;

        // and out of the leaves: a lens inside a tree crown sees nothing but green
        const stepX = -Math.sin(this.view.yaw);
        const stepZ = -Math.cos(this.view.yaw);
        for (let along = 3; along <= reach; along += 1.5) {
            if (along >= clear) break;
            const crowd = this.obstacles.crowding(this.heroSpot.x + stepX * along, this.heroSpot.z + stepZ * along, 0.3);
            // a trunk is an obstacle of about half a metre; its crown reaches some two metres further
            if (crowd < 1.9) {
                clear = Math.max(3, along - 1.2);
                break;
            }
        }
        this.view.clearance = clear === Infinity ? null : clear / Math.max(0.2, Math.cos(this.view.pitch));
    }

    /** is a building standing between the camera and this spot? */
    private behindWall = (x: number, z: number): boolean => {
        const eye = this.view.camera.position;
        const gap = Math.hypot(x - eye.x, z - eye.z);
        const hit = this.obstacles.sightline(eye.x, eye.z, x, z);
        return hit !== null && hit < gap - 1.2;
    };

    /** what is the hero standing next to? */
    private scan(): void {
        if (this.mode !== "explore") return;
        const here = this.heroSpot2d();

        const beacon = this.beacon;
        if (beacon && this.beaconLight && this.reached !== beacon.goalId
            && Math.hypot(beacon.x - here.x, beacon.z - here.z) <= beacon.radius) {
            this.reached = beacon.goalId;
            this.events.onReach(beacon.goalId);
        }
        let best: Interactable | null = null;
        let bestGap = Infinity;

        const consider = (kind: Interactable["kind"], id: string, x: number, z: number, reach: number) => {
            const gap = Math.hypot(x - here.x, z - here.z) - reach;
            if (gap < INTERACT_RANGE && gap < bestGap) {
                const described = this.describe(kind, id);
                if (described) {
                    best = described;
                    bestGap = gap;
                }
            }
        };
        for (const c of this.characters.values()) consider("character", c.data.id, c.data.x, c.data.z, 0);
        for (const l of this.landmarks.values()) consider("landmark", l.data.id, l.data.x, l.data.z, l.prop.footprint);
        for (const g of this.gates.values()) consider("gate", g.data.id, g.data.x, g.data.z, 1.5);
        for (const e of this.enemies.values()) {
            if (e.state !== "falling") consider("enemy", e.data.id, e.x, e.z, e.creature.girth);
        }

        const found = best as Interactable | null;
        const changed = found?.id !== this.nearest?.id || found?.kind !== this.nearest?.kind || found?.verb !== this.nearest?.verb;
        if (changed) {
            this.nearest = found;
            this.events.onNearest(found);
        }
    }

    /** move the few real lights to the glowing things nearest the hero */
    private placeGlows(): void {
        const strength = 0.25 + this.daylight.lamps * 0.75;
        const near = this.glowing
            .map((glow) => ({ glow, gap: glow.at.distanceTo(this.heroSpot) }))
            .filter((entry) => entry.gap < 48)
            .sort((a, b) => a.gap - b.gap);
        this.glowLights.forEach((light, i) => {
            const entry = near[i];
            if (!entry) {
                light.intensity = 0;
                return;
            }
            light.position.copy(entry.glow.at);
            light.color.setHex(entry.glow.color);
            light.intensity = entry.glow.strength * strength;
        });
    }

    /** the shadow-casting sun stays over the hero, moving in whole steps so shadows do not shimmer */
    private followSun(): void {
        const stepSize = 2;
        const x = Math.round(this.heroSpot.x / stepSize) * stepSize;
        const z = Math.round(this.heroSpot.z / stepSize) * stepSize;
        this.sun.target.position.set(x, this.heroSpot.y, z);
        this.sun.position.set(x, this.heroSpot.y, z).addScaledVector(this.toSun, 120);
        this.sun.target.updateMatrixWorld();
    }

    private tap(px: number, py: number): void {
        if (this.mode !== "explore" || !this.field) return;
        const spot = this.groundUnder(px, py);
        if (!spot) return;

        // a tap on or beside something is a wish to go and use it
        let chosen: { at: { x: number; z: number }; what: Interactable; stopAt: number } | null = null;
        let nearest = 2.6;
        for (const kind of ["character", "enemy", "landmark", "gate"] as const) {
            const ids = kind === "character" ? [...this.characters.keys()]
                : kind === "enemy" ? [...this.enemies.keys()]
                : kind === "landmark" ? [...this.landmarks.keys()]
                : [...this.gates.keys()];
            for (const id of ids) {
                const found = this.find(kind, id);
                if (!found) continue;
                const gap = Math.hypot(found.at.x - spot.x, found.at.z - spot.z);
                if (gap < nearest) {
                    nearest = gap;
                    chosen = found;
                }
            }
        }

        if (chosen) {
            this.setErrand(chosen.at, chosen.what, chosen.stopAt);
        } else if (this.setErrand(spot, null, 0.45)) {
            this.fx.marker(this.scratch2.set(spot.x, this.groundAt(spot.x, spot.z), spot.z));
        }
    }

    /** where a ray through a screen pixel meets the terrain */
    private groundUnder(px: number, py: number): { x: number; z: number } | null {
        const camera = this.view.camera;
        const origin = camera.position.clone();
        const direction = new THREE.Vector3((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1, 0.5)
            .unproject(camera).sub(origin).normalize();
        if (direction.y > -0.02) return null;

        const point = origin.clone();
        let previous = origin.clone();
        for (let travelled = 0; travelled < 220; travelled += 1.2) {
            previous.copy(point);
            point.addScaledVector(direction, 1.2);
            if (point.y <= this.groundAt(point.x, point.z)) {
                // close in on the crossing
                for (let i = 0; i < 6; i++) {
                    const middle = previous.clone().add(point).multiplyScalar(0.5);
                    if (middle.y <= this.groundAt(middle.x, middle.z)) point.copy(middle);
                    else previous = middle;
                }
                return { x: point.x, z: point.z };
            }
        }
        return null;
    }

    /* ---------------------------------------------------------------- */
    /* keeping the frame rate                                            */
    /* ---------------------------------------------------------------- */

    private measure(delta: number): void {
        this.frames++;
        this.frameWindow += delta;
        if (this.frameWindow < 1) return;
        this.fps = this.frames / this.frameWindow;
        this.frames = 0;
        this.frameWindow = 0;
        if (!this.adaptive || this.time < 4) return;

        if (this.fps < 42) {
            this.fastWindows = 0;
            if (++this.slowWindows >= 3) {
                this.slowWindows = 0;
                this.ease();
            }
        } else if (this.fps > 57) {
            this.slowWindows = 0;
            if (++this.fastWindows >= 8) {
                this.fastWindows = 0;
                const cap = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].pixelRatio);
                if (this.pixelRatio < cap) {
                    this.pixelRatio = Math.min(cap, this.pixelRatio + 0.25);
                    this.renderer.setPixelRatio(this.pixelRatio);
                }
            }
        } else {
            this.slowWindows = 0;
        }
    }

    /** give up a little beauty for smoothness: resolution first, then shadows */
    private ease(): void {
        if (this.pixelRatio > 0.8) {
            this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
            this.renderer.setPixelRatio(this.pixelRatio);
        } else if (this.shadowsOn) {
            this.shadowsOn = false;
            this.sun.castShadow = false;
            this.renderer.shadowMap.enabled = false;
            this.scene.traverse((node) => {
                const mesh = node as THREE.Mesh;
                if (mesh.material) (mesh.material as THREE.Material).needsUpdate = true;
            });
        }
    }

    private resize(): void {
        const holder = this.canvas.parentElement ?? this.canvas;
        this.width = Math.max(1, holder.clientWidth);
        this.height = Math.max(1, holder.clientHeight);
        this.renderer.setSize(this.width, this.height, false);
        this.view.resize(this.width / this.height);
    }

    /* ---------------------------------------------------------------- */
    /* looking in                                                        */
    /* ---------------------------------------------------------------- */

    report(): EngineReport {
        const here = this.heroSpot2d();
        const gapTo = (x: number, z: number) => Math.round(Math.hypot(x - here.x, z - here.z) * 10) / 10;
        const round = (n: number) => Math.round(n * 10) / 10;
        const region = this.payload?.region;
        return {
            ready: this.ready,
            mode: this.mode,
            quality: this.quality,
            fps: Math.round(this.fps),
            drawCalls: this.renderer.info.render.calls,
            triangles: this.renderer.info.render.triangles,
            pixelRatio: this.pixelRatio,
            shadows: this.shadowsOn,
            region: region ? { name: region.name, kind: region.kind, biome: region.biome, timeOfDay: region.timeOfDay } : null,
            hero: { x: round(here.x), y: round(this.heroSpot.y), z: round(here.z), moving: this.heroMoving },
            nearest: this.nearest,
            planted: this.planted,
            characters: [...this.characters.values()].map((c) => ({ id: c.data.id, name: c.data.name, x: round(c.data.x), z: round(c.data.z), distance: gapTo(c.data.x, c.data.z) })),
            enemies: [...this.enemies.values()].map((e) => ({ id: e.data.id, name: e.data.name, tier: e.data.tier, x: round(e.x), z: round(e.z), distance: gapTo(e.x, e.z), state: e.state })),
            landmarks: [...this.landmarks.values()].map((l) => ({ id: l.data.id, name: l.data.name, kind: l.data.kind, x: round(l.data.x), z: round(l.data.z), distance: gapTo(l.data.x, l.data.z) })),
            gates: [...this.gates.values()].map((g) => ({ id: g.data.id, label: g.data.label, x: round(g.data.x), z: round(g.data.z), distance: gapTo(g.data.x, g.data.z) })),
            beacon: this.beacon && this.beaconLight
                ? { goalId: this.beacon.goalId, name: this.beacon.name, x: round(this.beacon.x), z: round(this.beacon.z), distance: gapTo(this.beacon.x, this.beacon.z), reached: this.reached === this.beacon.goalId }
                : null,
        };
    }

    /** turn the camera to a bearing — for framing screenshots */
    look(yaw: number, pitch?: number, distance?: number): void {
        this.view.yaw = yaw;
        if (pitch !== undefined) this.view.pitch = pitch;
        if (distance !== undefined) this.view.distance = distance;
        this.view.snap();
    }

    dispose(): void {
        this.stop();
        document.removeEventListener("visibilitychange", this.onVisibility);
        this.resizeObserver.disconnect();
        this.input.destroy();
        this.clearWorld();
        this.hero?.dispose();
        this.sky?.dispose();
        this.renderer.dispose();
    }
}

export type { Gesture, LandmarkKind };
