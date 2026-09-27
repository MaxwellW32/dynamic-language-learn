/**
 * A small sculpting kit. Everything in the world — houses, trees, people —
 * is assembled from a handful of primitive shapes, each given a colour, and
 * baked into ONE geometry with per-vertex colour. One geometry, one material,
 * one draw call: that is where the frame rate comes from.
 */
import * as THREE from "three";

const scratchMatrix = new THREE.Matrix4();
const scratchNormal = new THREE.Matrix3();
const scratchColor = new THREE.Color();
const scratchVec = new THREE.Vector3();

export type Placement = {
    at?: [number, number, number];
    /** Euler angles in radians, applied in XYZ order */
    rot?: [number, number, number];
    scale?: [number, number, number] | number;
};

function matrixOf(placement: Placement | undefined, target: THREE.Matrix4): THREE.Matrix4 {
    const at = placement?.at ?? [0, 0, 0];
    const rot = placement?.rot ?? [0, 0, 0];
    const scale = placement?.scale ?? 1;
    const s: [number, number, number] = typeof scale === "number" ? [scale, scale, scale] : scale;
    return target.compose(
        new THREE.Vector3(at[0], at[1], at[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], "XYZ")),
        new THREE.Vector3(s[0], s[1], s[2]),
    );
}

/** primitive geometries are reused: a thousand trunks share one cylinder */
const primitiveCache = new Map<string, THREE.BufferGeometry>();

function primitive(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = primitiveCache.get(key);
    if (!geometry) {
        const made = make();
        // faceted shading needs every triangle to own its vertices
        geometry = made.index ? made.toNonIndexed() : made;
        if (made !== geometry) made.dispose();
        geometry.computeVertexNormals();
        primitiveCache.set(key, geometry);
    }
    return geometry;
}

export class Sculpt {
    private positions: number[] = [];
    private normals: number[] = [];
    private colors: number[] = [];
    /** an origin every following shape is placed relative to */
    private base = new THREE.Matrix4();

    /** place the following shapes relative to this transform (replaces any earlier one) */
    within(placement: Placement | null): this {
        if (placement) matrixOf(placement, this.base);
        else this.base.identity();
        return this;
    }

    add(geometry: THREE.BufferGeometry, color: number, placement?: Placement, shade = 0): this {
        const matrix = matrixOf(placement, scratchMatrix).premultiply(this.base);
        scratchNormal.getNormalMatrix(matrix);

        const position = geometry.getAttribute("position");
        const normal = geometry.getAttribute("normal");
        scratchColor.setHex(color);
        if (shade !== 0) scratchColor.offsetHSL(0, 0, shade);

        for (let i = 0; i < position.count; i++) {
            scratchVec.fromBufferAttribute(position, i).applyMatrix4(matrix);
            this.positions.push(scratchVec.x, scratchVec.y, scratchVec.z);
            scratchVec.fromBufferAttribute(normal, i).applyMatrix3(scratchNormal).normalize();
            this.normals.push(scratchVec.x, scratchVec.y, scratchVec.z);
            this.colors.push(scratchColor.r, scratchColor.g, scratchColor.b);
        }
        return this;
    }

    box(w: number, h: number, d: number, color: number, placement?: Placement, shade = 0): this {
        return this.add(primitive("box", () => new THREE.BoxGeometry(1, 1, 1)), color, scaled(placement, w, h, d), shade);
    }

    /** a cylinder or, with different radii, a tapered trunk or cone frustum */
    cylinder(rTop: number, rBottom: number, h: number, color: number, placement?: Placement, sides = 8, shade = 0): this {
        const ratio = Math.round((rTop / Math.max(rBottom, 0.0001)) * 100) / 100;
        const geometry = primitive(`cyl:${ratio}:${sides}`, () => new THREE.CylinderGeometry(ratio, 1, 1, sides, 1));
        return this.add(geometry, color, scaled(placement, rBottom, h, rBottom), shade);
    }

    cone(r: number, h: number, color: number, placement?: Placement, sides = 8, shade = 0): this {
        return this.add(primitive(`cone:${sides}`, () => new THREE.ConeGeometry(1, 1, sides, 1)), color, scaled(placement, r, h, r), shade);
    }

    /** a faceted ball; detail 0 is a gem, 1 is a boulder or a tree crown */
    ball(r: number, color: number, placement?: Placement, detail = 1, shade = 0): this {
        return this.add(primitive(`ico:${detail}`, () => new THREE.IcosahedronGeometry(1, detail)), color, scaled(placement, r, r, r), shade);
    }

    /** a smooth-ish sphere, for heads and eyes */
    sphere(r: number, color: number, placement?: Placement, shade = 0): this {
        return this.add(primitive("sphere", () => new THREE.SphereGeometry(1, 12, 9)), color, scaled(placement, r, r, r), shade);
    }

    /** a four-sided pyramid roof over a w × d footprint */
    pyramid(w: number, h: number, d: number, color: number, placement?: Placement, shade = 0): this {
        const geometry = primitive("pyramid", () => {
            const cone = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
            cone.rotateY(Math.PI / 4);
            return cone;
        });
        return this.add(geometry, color, scaled(placement, w, h, d), shade);
    }

    /** a triangular prism: the classic pitched roof, ridge running along x */
    gable(w: number, h: number, d: number, color: number, placement?: Placement, shade = 0): this {
        const geometry = primitive("gable", () => {
            const shape = new THREE.Shape();
            shape.moveTo(-0.5, 0);
            shape.lineTo(0.5, 0);
            shape.lineTo(0, 1);
            shape.closePath();
            const prism = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
            // extruded along z with the triangle in xy: turn it so the ridge runs along x
            prism.translate(0, 0, -0.5);
            prism.rotateY(Math.PI / 2);
            return prism;
        });
        return this.add(geometry, color, scaled(placement, w, h, d), shade);
    }

    torus(r: number, tube: number, color: number, placement?: Placement, shade = 0): this {
        const ratio = Math.round((tube / r) * 100) / 100;
        const geometry = primitive(`torus:${ratio}`, () => new THREE.TorusGeometry(1, ratio, 6, 14));
        return this.add(geometry, color, scaled(placement, r, r, r), shade);
    }

    /** a flat disc lying on the ground */
    disc(r: number, color: number, placement?: Placement, sides = 16, shade = 0): this {
        const geometry = primitive(`disc:${sides}`, () => {
            const circle = new THREE.CircleGeometry(1, sides);
            circle.rotateX(-Math.PI / 2);
            return circle;
        });
        return this.add(geometry, color, scaled(placement, r, 1, r), shade);
    }

    get isEmpty(): boolean {
        return this.positions.length === 0;
    }

    build(): THREE.BufferGeometry {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        return geometry;
    }
}

/** fold a shape's own dimensions into the placement's scale */
function scaled(placement: Placement | undefined, x: number, y: number, z: number): Placement {
    const scale = placement?.scale ?? 1;
    const s: [number, number, number] = typeof scale === "number" ? [scale, scale, scale] : scale;
    return { at: placement?.at, rot: placement?.rot, scale: [s[0] * x, s[1] * y, s[2] * z] };
}

/* ------------------------------------------------------------------ */
/* materials                                                           */
/* ------------------------------------------------------------------ */

let sharedMatte: THREE.MeshLambertMaterial | null = null;

/** the one material nearly everything wears: matte, faceted, coloured by its vertices */
export function matte(): THREE.MeshLambertMaterial {
    if (!sharedMatte) {
        sharedMatte = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    }
    return sharedMatte;
}

export type Uniforms = { uTime: { value: number }; uWind: { value: number } };

/**
 * The material for instanced plants. Two things set it apart from `matte`:
 *
 * - Tinting. Leaves are sculpted in greys and each instance carries a colour;
 *   only the grey vertices take that colour (keeping their light-and-dark), so
 *   a trunk stays brown while its crown turns spring green or autumn gold.
 * - Sway. Vertices lean with a travelling wave, more the higher they sit
 *   above their root.
 */
export function living(
    uniforms: Uniforms,
    sway: number,
    options: {
        /** 0 none … 1 lit from within: crystals and the mushrooms of dark places */
        glow?: number;
        /** blades of grass are lit like the ground they grow from, from both sides */
        blades?: boolean;
    } = {},
): THREE.MeshLambertMaterial {
    const glow = options.glow ?? 0;
    const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: !options.blades,
        side: options.blades ? THREE.DoubleSide : THREE.FrontSide,
    });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.uniforms.uWind = uniforms.uWind;
        if (options.blades) {
            // a blade seen from behind must not flip its normal to face the ground, or it turns black
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <normal_fragment_begin>",
                `#include <normal_fragment_begin>
                normal = normalize(vNormal);`,
            );
        }
        if (glow > 0) {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <emissivemap_fragment>",
                `#include <emissivemap_fragment>
                totalEmissiveRadiance += vColor.rgb * ${glow.toFixed(3)};`,
            );
        }
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWind;")
            .replace(
                "#include <color_vertex>",
                `vColor = vec4(1.0);
                #ifdef USE_COLOR
                    vColor.rgb *= color;
                #endif
                #ifdef USE_INSTANCING_COLOR
                    float tintSpread = max(abs(color.r - color.g), abs(color.g - color.b));
                    vColor.rgb *= mix(instanceColor.rgb, vec3(1.0), step(0.015, tintSpread));
                #endif`,
            )
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                #ifdef USE_INSTANCING
                    vec3 swayRoot = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                #else
                    vec3 swayRoot = vec3(0.0);
                #endif
                float swayLift = max(position.y, 0.0);
                float swayPhase = uTime * 1.3 + swayRoot.x * 0.21 + swayRoot.z * 0.17;
                float swayBend = (sin(swayPhase) + 0.5 * sin(swayPhase * 2.3 + 1.7)) * ${sway.toFixed(3)} * uWind * 0.035;
                transformed.x += swayBend * swayLift * swayLift * 0.35;
                transformed.z += swayBend * swayLift * swayLift * 0.2;`,
            );
    };
    material.customProgramCacheKey = () => `living:${sway}:${glow}:${options.blades ? 1 : 0}`;
    return material;
}

export function disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry && !isCached(mesh.geometry)) mesh.geometry.dispose();
    });
}

function isCached(geometry: THREE.BufferGeometry): boolean {
    for (const cached of primitiveCache.values()) if (cached === geometry) return true;
    return false;
}
