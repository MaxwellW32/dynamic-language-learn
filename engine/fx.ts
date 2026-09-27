/**
 * Spells, sparks and flourishes — the moments that should feel like
 * something happened. Every effect is short-lived: it is given a lifetime when
 * it starts and removes itself when that runs out.
 */
import * as THREE from "three";

type Effect = {
    object: THREE.Object3D;
    age: number;
    life: number;
    step: (t: number, delta: number) => void;
    done?: () => void;
};

const UP = new THREE.Vector3(0, 1, 0);

function additive(color: number, opacity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    });
}

export class Effects {
    readonly group = new THREE.Group();
    private running: Effect[] = [];
    /** a light that flashes with impacts, shared so that effects never add to the light count */
    readonly flash = new THREE.PointLight(0xffffff, 0, 18, 1.6);

    constructor() {
        this.group.name = "effects";
        this.group.add(this.flash);
    }

    private start(effect: Effect): void {
        this.group.add(effect.object);
        this.running.push(effect);
    }

    private flare(at: THREE.Vector3, color: number, strength: number): void {
        this.flash.position.copy(at);
        this.flash.color.setHex(color);
        this.flash.intensity = strength;
    }

    /** a burst of sparks flying outward and falling */
    burst(at: THREE.Vector3, color: number, count = 26, speed = 5, life = 0.8): void {
        const positions = new Float32Array(count * 3);
        const velocity: THREE.Vector3[] = [];
        for (let i = 0; i < count; i++) {
            const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
            velocity.push(dir.multiplyScalar(speed * (0.4 + Math.random() * 0.8)));
            positions[i * 3] = at.x;
            positions[i * 3 + 1] = at.y;
            positions[i * 3 + 2] = at.z;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color, size: 0.26, transparent: true, opacity: 1, depthWrite: false,
            blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        this.start({
            object: points, age: 0, life,
            step: (t, delta) => {
                for (let i = 0; i < count; i++) {
                    velocity[i].y -= 9 * delta;
                    positions[i * 3] += velocity[i].x * delta;
                    positions[i * 3 + 1] += velocity[i].y * delta;
                    positions[i * 3 + 2] += velocity[i].z * delta;
                }
                geometry.attributes.position.needsUpdate = true;
                material.opacity = 1 - t * t;
            },
            done: () => {
                geometry.dispose();
                material.dispose();
            },
        });
    }

    /** a ring that spreads across the ground */
    ripple(at: THREE.Vector3, color: number, radius = 3, life = 0.7): void {
        const mesh = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 36), additive(color, 0.9));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.copy(at).addScaledVector(UP, 0.08);
        this.start({
            object: mesh, age: 0, life,
            step: (t) => {
                mesh.scale.setScalar(0.2 + t * radius);
                (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
            },
            done: () => {
                mesh.geometry.dispose();
                (mesh.material as THREE.Material).dispose();
            },
        });
    }

    /** the hero's spell: a bright bolt that arcs to its mark and bursts there */
    bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, onHit: () => void): void {
        const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), additive(color, 1));
        const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), additive(color, 0.35));
        const group = new THREE.Group();
        group.add(head, halo);

        const trailCount = 14;
        const trailPositions = new Float32Array(trailCount * 3);
        const trailGeometry = new THREE.BufferGeometry();
        trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
        const trailMaterial = new THREE.PointsMaterial({
            color, size: 0.3, transparent: true, opacity: 0.8, depthWrite: false,
            blending: THREE.AdditiveBlending, toneMapped: false,
        });
        const trail = new THREE.Points(trailGeometry, trailMaterial);
        trail.frustumCulled = false;
        for (let i = 0; i < trailCount; i++) trailPositions.set([from.x, from.y, from.z], i * 3);
        this.group.add(trail);

        const arc = from.distanceTo(to) * 0.22;
        const spot = new THREE.Vector3();
        let cursor = 0;
        this.start({
            object: group, age: 0, life: 0.42,
            step: (t) => {
                spot.lerpVectors(from, to, t);
                spot.y += Math.sin(t * Math.PI) * arc;
                group.position.copy(spot);
                head.rotation.set(t * 9, t * 7, 0);
                halo.scale.setScalar(1 + Math.sin(t * 40) * 0.2);
                trailPositions.set([spot.x, spot.y, spot.z], cursor * 3);
                cursor = (cursor + 1) % trailCount;
                trailGeometry.attributes.position.needsUpdate = true;
            },
            done: () => {
                this.group.remove(trail);
                trailGeometry.dispose();
                trailMaterial.dispose();
                head.geometry.dispose();
                halo.geometry.dispose();
                (head.material as THREE.Material).dispose();
                (halo.material as THREE.Material).dispose();
                this.burst(to, color, 30, 6, 0.7);
                this.ripple(new THREE.Vector3(to.x, to.y - 0.8, to.z), color, 3.2, 0.5);
                this.flare(to, color, 60);
                onHit();
            },
        });
    }

    /** the creature's answer to a wrong word: a dark lash at the hero */
    lash(from: THREE.Vector3, to: THREE.Vector3, color: number, onHit: () => void): void {
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 5), additive(color, 0.95));
        const direction = new THREE.Vector3().subVectors(to, from).normalize();
        mesh.quaternion.setFromUnitVectors(UP, direction);
        this.start({
            object: mesh, age: 0, life: 0.3,
            step: (t) => {
                mesh.position.lerpVectors(from, to, t);
                mesh.scale.set(1, 1 + Math.sin(t * Math.PI) * 1.3, 1);
            },
            done: () => {
                mesh.geometry.dispose();
                (mesh.material as THREE.Material).dispose();
                this.burst(to, color, 16, 4, 0.5);
                this.flare(to, color, 35);
                onHit();
            },
        });
    }

    /** a column of rising light: a victory, a word learned, a chapter turning */
    fountain(at: THREE.Vector3, color: number, life = 2.2): void {
        const count = 60;
        const positions = new Float32Array(count * 3);
        const seeds: { angle: number; radius: number; speed: number; offset: number }[] = [];
        for (let i = 0; i < count; i++) {
            seeds.push({ angle: Math.random() * Math.PI * 2, radius: 0.3 + Math.random() * 1.3, speed: 1.5 + Math.random() * 2.5, offset: Math.random() });
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color, size: 0.24, transparent: true, opacity: 1, depthWrite: false,
            blending: THREE.AdditiveBlending, toneMapped: false,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;

        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 7, 14, 1, true), additive(color, 0.2));
        pillar.position.copy(at).addScaledVector(UP, 3.5);
        this.group.add(pillar);
        this.ripple(at, color, 4.5, 0.9);
        this.flare(new THREE.Vector3(at.x, at.y + 1.5, at.z), color, 45);

        this.start({
            object: points, age: 0, life,
            step: (t) => {
                const elapsed = t * life;
                for (let i = 0; i < count; i++) {
                    const s = seeds[i];
                    const rise = ((elapsed * s.speed * 0.5 + s.offset * 4) % 4.5);
                    const angle = s.angle + elapsed * 1.6;
                    positions[i * 3] = at.x + Math.cos(angle) * s.radius * (1 - rise / 7);
                    positions[i * 3 + 1] = at.y + rise;
                    positions[i * 3 + 2] = at.z + Math.sin(angle) * s.radius * (1 - rise / 7);
                }
                geometry.attributes.position.needsUpdate = true;
                const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
                material.opacity = fade;
                (pillar.material as THREE.MeshBasicMaterial).opacity = 0.22 * fade;
                pillar.rotation.y = elapsed * 0.7;
            },
            done: () => {
                this.group.remove(pillar);
                pillar.geometry.dispose();
                (pillar.material as THREE.Material).dispose();
                geometry.dispose();
                material.dispose();
            },
        });
    }

    /** a soft pulse where the hero clicked to walk */
    marker(at: THREE.Vector3): void {
        this.ripple(at, 0xfff1c9, 1.3, 0.55);
    }

    update(delta: number): void {
        this.flash.intensity *= Math.exp(-delta * 7);
        for (let i = this.running.length - 1; i >= 0; i--) {
            const effect = this.running[i];
            effect.age += delta;
            const t = Math.min(1, effect.age / effect.life);
            effect.step(t, delta);
            if (t >= 1) {
                this.group.remove(effect.object);
                this.running.splice(i, 1);
                effect.done?.();
            }
        }
    }

    clear(): void {
        for (const effect of this.running) {
            this.group.remove(effect.object);
            effect.done?.();
        }
        this.running = [];
        this.flash.intensity = 0;
    }
}
