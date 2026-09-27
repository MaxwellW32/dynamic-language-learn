/**
 * The sky: a gradient dome with a glow around the sun, drifting clouds, and
 * stars that come out as the light goes. It follows the camera, so the
 * horizon is always infinitely far away.
 */
import * as THREE from "three";
import { createRng } from "@/game/worldgen/rng";
import { Sculpt } from "./geo";
import { sunDirection, type Daylight } from "./palette";

export type Sky = {
    group: THREE.Group;
    update: (camera: THREE.Camera, time: number, delta: number) => void;
    dispose: () => void;
};

const DOME_RADIUS = 900;

export function buildSky(light: Daylight, fogColor: THREE.Color, seed: number, cloudiness: number): Sky {
    const group = new THREE.Group();
    group.name = "sky";
    const toSun = sunDirection(light);

    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(DOME_RADIUS, 32, 16),
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
                uTop: { value: new THREE.Color(light.skyTop) },
                uHorizon: { value: new THREE.Color(light.skyHorizon) },
                uFog: { value: fogColor.clone() },
                uGlow: { value: new THREE.Color(light.glow) },
                uSun: { value: toSun.clone() },
            },
            vertexShader: /* glsl */`
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: /* glsl */`
                uniform vec3 uTop;
                uniform vec3 uHorizon;
                uniform vec3 uFog;
                uniform vec3 uGlow;
                uniform vec3 uSun;
                varying vec3 vDir;
                void main() {
                    vec3 dir = normalize(vDir);
                    float up = clamp(dir.y, 0.0, 1.0);
                    vec3 color = mix(uHorizon, uTop, pow(up, 0.55));
                    // the band at the horizon takes the fog's colour, so distant hills melt into the sky
                    color = mix(uFog, color, smoothstep(-0.02, 0.22, dir.y));
                    float toward = max(dot(dir, uSun), 0.0);
                    color += uGlow * (pow(toward, 6.0) * 0.28 + pow(toward, 90.0) * 0.55);
                    color += vec3(1.0, 0.98, 0.9) * smoothstep(0.9992, 0.9996, toward);
                    gl_FragColor = vec4(color, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    group.add(dome);

    /* stars */
    let stars: THREE.Points | null = null;
    if (light.stars > 0.05) {
        const rng = createRng(seed ^ 0x57a2);
        const count = 700;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            // even over the upper hemisphere
            const u = rng.next();
            const v = rng.next();
            const theta = u * Math.PI * 2;
            const y = 0.06 + v * 0.94;
            const ring = Math.sqrt(1 - y * y);
            positions[i * 3] = Math.cos(theta) * ring * (DOME_RADIUS - 20);
            positions[i * 3 + 1] = y * (DOME_RADIUS - 20);
            positions[i * 3 + 2] = Math.sin(theta) * ring * (DOME_RADIUS - 20);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        stars = new THREE.Points(geometry, new THREE.PointsMaterial({
            color: 0xffffff, size: 2.2, sizeAttenuation: false,
            transparent: true, opacity: light.stars * 0.9, depthWrite: false, fog: false,
        }));
        stars.renderOrder = -9;
        stars.frustumCulled = false;
        group.add(stars);
    }

    /* clouds: a few faceted puffs, instanced, high and far */
    const clouds: THREE.InstancedMesh | null = cloudiness > 0 ? buildClouds(seed, light, cloudiness) : null;
    if (clouds) group.add(clouds);

    const drift = new THREE.Vector3();
    return {
        group,
        update(camera, _time, delta) {
            dome.position.copy(camera.position);
            if (stars) stars.position.copy(camera.position);
            if (clouds) {
                drift.x += delta * 1.1;
                clouds.position.set(camera.position.x * 0.9 + (drift.x % 600) - 300, 0, camera.position.z * 0.9);
            }
        },
        dispose() {
            dome.geometry.dispose();
            (dome.material as THREE.Material).dispose();
            if (stars) {
                stars.geometry.dispose();
                (stars.material as THREE.Material).dispose();
            }
            if (clouds) {
                clouds.geometry.dispose();
                (clouds.material as THREE.Material).dispose();
            }
        },
    };
}

function buildClouds(seed: number, light: Daylight, cloudiness: number): THREE.InstancedMesh {
    const rng = createRng(seed ^ 0xc10d);
    const puff = new Sculpt();
    puff.ball(1, 0xffffff, { at: [0, 0, 0], scale: [1.5, 0.62, 1] }, 1);
    puff.ball(0.8, 0xffffff, { at: [1.3, -0.08, 0.2], scale: [1.2, 0.6, 1] }, 1);
    puff.ball(0.72, 0xffffff, { at: [-1.25, -0.1, -0.15], scale: [1.2, 0.58, 1] }, 1);
    puff.ball(0.66, 0xffffff, { at: [0.35, 0.34, -0.1], scale: [1, 0.62, 1] }, 1);
    const geometry = puff.build();

    const count = Math.round(16 * cloudiness);
    // lit from beneath by the horizon at dawn and dusk, from above by day
    const color = new THREE.Color(0xffffff).lerp(new THREE.Color(light.skyHorizon), 0.35);
    const material = new THREE.MeshLambertMaterial({
        color, emissive: color, emissiveIntensity: 0.32,
        flatShading: true, transparent: true, opacity: 0.93, fog: false, depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        dummy.position.set(rng.range(-620, 620), rng.range(150, 250), rng.range(-620, 620));
        dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
        const size = rng.range(22, 52);
        dummy.scale.set(size, size * rng.range(0.55, 0.8), size * rng.range(0.7, 1));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = -8;
    mesh.name = "clouds";
    return mesh;
}
