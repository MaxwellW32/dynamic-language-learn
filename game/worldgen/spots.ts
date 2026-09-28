/**
 * Somewhere to stand, for someone who joins a region after it was peopled: a
 * person the story has just written, or one it has sent here from elsewhere.
 * The layout itself is never touched: it is a pure function of its seed, and
 * everything already standing in the region was placed by it.
 */
import { dist, distToTrail, facing, withinReach, type Disc, type RegionLayout, type Slot, type Vec2 } from "./layout";

/** how much room a person needs around them */
const ELBOW = 2.6;

/** the middle of things in a region: where a newcomer would wait to be found */
function heart(layout: RegionLayout): Disc {
    if (layout.plaza) return layout.plaza;
    // the clearing nearest the way in: the camp of a wild place, the first chamber of a deep one
    const nearest = [...layout.clearings].sort((a, b) => dist(a, layout.spawn) - dist(b, layout.spawn))[0];
    return nearest ?? { x: layout.spawn.x, z: layout.spawn.z, r: 8 };
}

/**
 * A free spot: one of the layout's own places for people if any is left, else
 * somewhere round the heart of the region, clear of people, of things one can
 * bump into, and of the roads.
 *
 * `taken` is where people already stand; `solid` is what cannot be stood in
 * (landmarks, buildings), as discs.
 */
export function standingSpot(layout: RegionLayout, taken: Vec2[], solid: Disc[]): Slot {
    const free = (p: Vec2) =>
        withinReach(layout, p, 3)
        && taken.every((other) => dist(other, p) >= ELBOW)
        && solid.every((thing) => dist(thing, p) >= thing.r + 1.2);

    for (const slot of layout.npcSlots) {
        if (free(slot)) return slot;
    }

    const middle = heart(layout);
    // rings round the middle, widening; angles offset ring by ring so that spots do not line up
    for (let ring = 0; ring < 5; ring++) {
        const reach = Math.max(4, middle.r - 3) + ring * 3.5;
        for (let step = 0; step < 12; step++) {
            const angle = (step / 12) * Math.PI * 2 + ring * 0.37;
            const p = { x: middle.x + Math.cos(angle) * reach, z: middle.z + Math.sin(angle) * reach };
            // off the plaza, a road is no place to stand about in
            const onRoad = ring > 0 && layout.trails.some((trail) => distToTrail(p, trail) < trail.width / 2 + 1);
            if (!onRoad && free(p)) return { ...p, rot: facing(p, middle) };
        }
    }
    // a region so full that nowhere is free: beside where the hero arrives, which is always open ground
    return { x: layout.spawn.x + 2.5, z: layout.spawn.z + 1.5, rot: layout.spawn.rot + Math.PI };
}

/** the spot in front of a building's door, where someone who has "gone to" it would stand */
export function doorstep(building: { x: number; z: number; rot: number; depth: number }): Vec2 {
    return {
        x: building.x + Math.sin(building.rot) * (building.depth / 2 + 2.4),
        z: building.z + Math.cos(building.rot) * (building.depth / 2 + 2.4),
    };
}
