import { test } from "node:test";
import assert from "node:assert/strict";
import { distToTrail, generateLayout, type GateSide, type RegionKind } from "../game/worldgen/layout";
import type { Biome } from "../game/looks";

const SEEDS = [1, 7, 42, 1234, 99991, -5150, 20260927, 314159];
const BIOMES: Biome[] = ["meadow", "forest", "coast", "snow", "desert"];

/**
 * A chapter turn may join a new region to an old one, which opens another
 * gate in the old one. Its people, buildings and landmarks were placed — and
 * stored — from the layout it had before. They must be where they were.
 */
test("opening another gate moves nothing that was already placed", () => {
    const grown: [RegionKind, GateSide[], GateSide[]][] = [
        ["settlement", ["e"], ["e", "n"]],
        ["settlement", ["e", "n"], ["e", "n", "s"]],
        ["settlement", ["e", "n", "s"], ["e", "n", "s", "w"]],
        ["wilds", ["e", "w"], ["e", "w", "n"]],
        ["wilds", ["e", "w", "n"], ["e", "w", "n", "s"]],
    ];
    for (const [kind, before, after] of grown) {
        for (const seed of SEEDS) {
            for (const biome of BIOMES) {
                const was = generateLayout({ seed, kind, biome, gates: before });
                const is = generateLayout({ seed, kind, biome, gates: after });
                const where = `${kind} ${biome} seed ${seed}: ${before.join("")} → ${after.join("")}`;
                assert.deepEqual(is.plots, was.plots, `buildings moved (${where})`);
                assert.deepEqual(is.npcSlots, was.npcSlots, `people moved (${where})`);
                assert.deepEqual(is.mobSlots, was.mobSlots, `creatures moved (${where})`);
                assert.deepEqual(is.landmarkSlots, was.landmarkSlots, `landmarks moved (${where})`);
                assert.deepEqual(is.spawn, was.spawn, `the spawn moved (${where})`);
                assert.deepEqual(is.ponds, was.ponds, `the water moved (${where})`);
                assert.deepEqual(is.clearings, was.clearings, `the clearings moved (${where})`);

                // and the new way out runs into none of it
                const added = after.filter((side) => !before.includes(side));
                const fresh = is.trails.filter((trail) => added.some((side) => distToTrail(is.gates[side], trail) < 0.01));
                assert.equal(fresh.length, added.length, `no road leads to the new gate (${where})`);
                for (const trail of fresh) {
                    for (const plot of was.plots) {
                        assert.ok(distToTrail(plot, trail) > Math.min(plot.width, plot.depth) / 2, `the new road runs through a building (${where})`);
                    }
                    for (const pond of was.ponds) {
                        assert.ok(distToTrail(pond, trail) > pond.r, `the new road runs through water (${where})`);
                    }
                    if (kind === "settlement") {
                        for (const slot of was.landmarkSlots.slice(1)) {
                            assert.ok(distToTrail(slot, trail) > 3, `the new road runs over a landmark (${where})`);
                        }
                    }
                }
                for (const side of before) {
                    assert.deepEqual(is.gates[side], was.gates[side], `the ${side} gate moved (${where})`);
                }
            }
        }
    }
});

test("a layout is the same every time it is made", () => {
    for (const kind of ["settlement", "wilds", "depths"] as RegionKind[]) {
        const gates: GateSide[] = kind === "depths" ? ["w"] : ["e", "w"];
        const one = generateLayout({ seed: 77, kind, biome: "forest", gates });
        const two = generateLayout({ seed: 77, kind, biome: "forest", gates: [...gates].reverse() });
        assert.deepEqual(two, one);
    }
});
