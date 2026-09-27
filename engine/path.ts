/**
 * Finding a way. When the player clicks somewhere — or a script says "go to
 * the innkeeper" — the hero must walk round the inn, not into it.
 *
 * The region is searched as a coarse grid with A*; the jagged grid path is
 * then pulled taut, so the hero walks in long straight legs and turns only
 * where something is actually in the way.
 */

export type Walkable = (x: number, z: number) => boolean;

const CELL = 1.6;
/** the search gives up beyond this many cells: a click is a wish, not an obligation */
const MAX_VISITED = 9000;

type Node = { cx: number; cz: number; cost: number; score: number; from: Node | null };

const keyOf = (cx: number, cz: number) => (cx + 2048) * 4096 + (cz + 2048);

/** a tiny binary heap, lowest score first */
class Frontier {
    private items: Node[] = [];

    get size() {
        return this.items.length;
    }

    push(node: Node): void {
        const items = this.items;
        items.push(node);
        let i = items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (items[parent].score <= items[i].score) break;
            [items[parent], items[i]] = [items[i], items[parent]];
            i = parent;
        }
    }

    pop(): Node | undefined {
        const items = this.items;
        const top = items[0];
        const last = items.pop();
        if (last !== undefined && items.length > 0) {
            items[0] = last;
            let i = 0;
            for (;;) {
                const left = i * 2 + 1;
                const right = left + 1;
                let least = i;
                if (left < items.length && items[left].score < items[least].score) least = left;
                if (right < items.length && items[right].score < items[least].score) least = right;
                if (least === i) break;
                [items[least], items[i]] = [items[i], items[least]];
                i = least;
            }
        }
        return top;
    }
}

/** can one walk straight from a to b? Checked every half step along the way. */
export function clearLine(walkable: Walkable, ax: number, az: number, bx: number, bz: number): boolean {
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(length / (CELL * 0.5)));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (!walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
}

/**
 * The way from `from` to `to`, as the corners to walk through (the start is
 * left out, the goal is the last). If the goal itself cannot be stood on — it
 * is a person, a well — the way leads to the nearest spot beside it that can.
 * Null when there is no way.
 */
export function findPath(
    walkable: Walkable,
    from: { x: number; z: number },
    to: { x: number; z: number },
): { x: number; z: number }[] | null {
    if (clearLine(walkable, from.x, from.z, to.x, to.z)) return [{ x: to.x, z: to.z }];

    const startX = Math.round(from.x / CELL);
    const startZ = Math.round(from.z / CELL);
    const goalX = Math.round(to.x / CELL);
    const goalZ = Math.round(to.z / CELL);

    const free = new Map<number, boolean>();
    const isFree = (cx: number, cz: number) => {
        const key = keyOf(cx, cz);
        let known = free.get(key);
        if (known === undefined) {
            known = walkable(cx * CELL, cz * CELL);
            free.set(key, known);
        }
        return known;
    };
    // wherever the hero actually stands counts as free, even if its cell centre does not
    free.set(keyOf(startX, startZ), true);

    const distance = (cx: number, cz: number) => Math.hypot(cx - goalX, cz - goalZ);
    const frontier = new Frontier();
    const best = new Map<number, number>();
    const start: Node = { cx: startX, cz: startZ, cost: 0, score: distance(startX, startZ), from: null };
    frontier.push(start);
    best.set(keyOf(startX, startZ), 0);

    let nearest = start;
    let nearestGap = distance(startX, startZ);
    let visited = 0;

    while (frontier.size > 0 && visited < MAX_VISITED) {
        const node = frontier.pop()!;
        visited++;
        const gap = distance(node.cx, node.cz);
        if (gap < nearestGap) {
            nearest = node;
            nearestGap = gap;
        }
        if (gap < 0.5) break;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const cx = node.cx + dx;
                const cz = node.cz + dz;
                if (!isFree(cx, cz)) continue;
                // no cutting corners between two blocked cells
                if (dx !== 0 && dz !== 0 && (!isFree(node.cx + dx, node.cz) || !isFree(node.cx, node.cz + dz))) continue;
                const cost = node.cost + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
                const key = keyOf(cx, cz);
                const known = best.get(key);
                if (known !== undefined && known <= cost) continue;
                best.set(key, cost);
                frontier.push({ cx, cz, cost, score: cost + distance(cx, cz), from: node });
            }
        }
    }

    // nowhere nearer than where the hero already is: there is no way
    if (nearest === start) return null;

    const cells: { x: number; z: number }[] = [];
    for (let node: Node | null = nearest; node !== null && node.from !== null; node = node.from) {
        cells.push({ x: node.cx * CELL, z: node.cz * CELL });
    }
    cells.reverse();
    // finish at the wished-for spot itself when it can be reached from the last cell
    const last = cells[cells.length - 1];
    if (last && clearLine(walkable, last.x, last.z, to.x, to.z)) cells.push({ x: to.x, z: to.z });

    // pull it taut: from each corner, skip ahead to the farthest corner that can be seen
    const taut: { x: number; z: number }[] = [];
    let at = { x: from.x, z: from.z };
    let i = 0;
    while (i < cells.length) {
        let reach = i;
        for (let j = cells.length - 1; j > i; j--) {
            if (clearLine(walkable, at.x, at.z, cells[j].x, cells[j].z)) {
                reach = j;
                break;
            }
        }
        taut.push(cells[reach]);
        at = cells[reach];
        i = reach + 1;
    }
    return taut;
}
