/** Shared spatial math for map logic (client movement + server validation). */

export type Point = { x: number; y: number };

/** how close the player must be to talk / fight / inspect / enter */
export const INTERACT_RADIUS = 2.2;
/** player movement speed in map units per second */
export const PLAYER_SPEED = 5;

export function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function withinInteractRange(a: Point, b: Point): boolean {
    return distance(a, b) <= INTERACT_RADIUS;
}

export function clampToMap(p: Point, width: number, height: number, margin = 0.5): Point {
    return {
        x: Math.min(width - margin, Math.max(margin, p.x)),
        y: Math.min(height - margin, Math.max(margin, p.y)),
    };
}
