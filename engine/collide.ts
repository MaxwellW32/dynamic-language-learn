/**
 * What the hero bumps into. Trees and rocks are circles, buildings are
 * rectangles; all of them live in a coarse grid so that each step only tests
 * the few obstacles near the hero's feet.
 */

export type Circle = { x: number; z: number; r: number };
export type Rect = { x: number; z: number; rot: number; halfW: number; halfD: number };

const CELL = 8;

export class Obstacles {
    private circles = new Map<number, Circle[]>();
    private rects: Rect[] = [];

    private key(cx: number, cz: number): number {
        return (cx + 512) * 1024 + (cz + 512);
    }

    addCircle(circle: Circle): void {
        const minX = Math.floor((circle.x - circle.r) / CELL);
        const maxX = Math.floor((circle.x + circle.r) / CELL);
        const minZ = Math.floor((circle.z - circle.r) / CELL);
        const maxZ = Math.floor((circle.z + circle.r) / CELL);
        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const key = this.key(cx, cz);
                const bucket = this.circles.get(key);
                if (bucket) bucket.push(circle);
                else this.circles.set(key, [circle]);
            }
        }
    }

    /** take away a circle that was added: whoever stood there has left */
    removeCircle(circle: Circle): void {
        for (const bucket of this.circles.values()) {
            const at = bucket.indexOf(circle);
            if (at >= 0) bucket.splice(at, 1);
        }
    }

    addRect(rect: Rect): void {
        this.rects.push(rect);
    }

    /**
     * Move a body of radius `r` out of anything it overlaps. Mutates and
     * returns `p`. Two passes settle the corner where two obstacles meet.
     */
    resolve(p: { x: number; z: number }, r: number): { x: number; z: number } {
        for (let pass = 0; pass < 2; pass++) {
            const bucket = this.circles.get(this.key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
            if (bucket) {
                for (const circle of bucket) {
                    const dx = p.x - circle.x;
                    const dz = p.z - circle.z;
                    const reach = circle.r + r;
                    const distSq = dx * dx + dz * dz;
                    if (distSq >= reach * reach) continue;
                    const d = Math.sqrt(distSq) || 0.0001;
                    p.x = circle.x + (dx / d) * reach;
                    p.z = circle.z + (dz / d) * reach;
                }
            }

            for (const rect of this.rects) {
                // cheap reject before the rotation
                const far = rect.halfW + rect.halfD + r;
                if (Math.abs(p.x - rect.x) > far || Math.abs(p.z - rect.z) > far) continue;

                // into the rectangle's own frame
                const cos = Math.cos(rect.rot);
                const sin = Math.sin(rect.rot);
                const dx = p.x - rect.x;
                const dz = p.z - rect.z;
                const lx = dx * cos - dz * sin;
                const lz = dx * sin + dz * cos;

                const nearX = Math.max(-rect.halfW, Math.min(rect.halfW, lx));
                const nearZ = Math.max(-rect.halfD, Math.min(rect.halfD, lz));
                let ox = lx - nearX;
                let oz = lz - nearZ;
                const distSq = ox * ox + oz * oz;
                if (distSq >= r * r) continue;

                let push: number;
                if (distSq > 0.000001) {
                    const d = Math.sqrt(distSq);
                    ox /= d;
                    oz /= d;
                    push = r - d;
                } else {
                    // already inside: leave by the nearest wall
                    const gapX = rect.halfW - Math.abs(lx);
                    const gapZ = rect.halfD - Math.abs(lz);
                    if (gapX < gapZ) {
                        ox = Math.sign(lx) || 1;
                        oz = 0;
                        push = gapX + r;
                    } else {
                        ox = 0;
                        oz = Math.sign(lz) || 1;
                        push = gapZ + r;
                    }
                }
                const fx = lx + ox * push;
                const fz = lz + oz * push;
                p.x = rect.x + fx * cos + fz * sin;
                p.z = rect.z - fx * sin + fz * cos;
            }
        }
        return p;
    }

    /**
     * How far along the line from a to b the first building stands, or null
     * if the way is clear. The camera uses it to avoid looking at the back of a
     * wall.
     */
    sightline(ax: number, az: number, bx: number, bz: number): number | null {
        const length = Math.hypot(bx - ax, bz - az);
        if (length < 0.001) return null;
        let nearest: number | null = null;

        for (const rect of this.rects) {
            const cos = Math.cos(rect.rot);
            const sin = Math.sin(rect.rot);
            // the line, in the rectangle's own frame
            const ox = (ax - rect.x) * cos - (az - rect.z) * sin;
            const oz = (ax - rect.x) * sin + (az - rect.z) * cos;
            const dx = ((bx - ax) * cos - (bz - az) * sin) / length;
            const dz = ((bx - ax) * sin + (bz - az) * cos) / length;

            // slab test against the two pairs of walls
            let enter = 0;
            let leave = length;
            let misses = false;
            for (const [o, d, half] of [[ox, dx, rect.halfW], [oz, dz, rect.halfD]] as const) {
                if (Math.abs(d) < 0.000001) {
                    if (Math.abs(o) > half) misses = true;
                    continue;
                }
                let t1 = (-half - o) / d;
                let t2 = (half - o) / d;
                if (t1 > t2) [t1, t2] = [t2, t1];
                enter = Math.max(enter, t1);
                leave = Math.min(leave, t2);
            }
            if (misses || enter > leave) continue;
            if (nearest === null || enter < nearest) nearest = enter;
        }
        return nearest;
    }

    /**
     * How closely a point is crowded by things that stand tall — trees,
     * mostly. Returns the distance to the nearest such thing's edge, or
     * Infinity. The camera uses it to keep out of the leaves.
     */
    crowding(x: number, z: number, minRadius: number): number {
        let nearest = Infinity;
        const cx = Math.floor(x / CELL);
        const cz = Math.floor(z / CELL);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const bucket = this.circles.get(this.key(cx + dx, cz + dz));
                if (!bucket) continue;
                for (const circle of bucket) {
                    if (circle.r < minRadius) continue;
                    nearest = Math.min(nearest, Math.hypot(x - circle.x, z - circle.z) - circle.r);
                }
            }
        }
        return nearest;
    }

    /** is there room to stand here? */
    isFree(x: number, z: number, r: number): boolean {
        const probe = this.resolve({ x, z }, r);
        return Math.abs(probe.x - x) < 0.001 && Math.abs(probe.z - z) < 0.001;
    }
}
