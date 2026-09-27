import { test } from "node:test";
import assert from "node:assert/strict";
import { SPARK_COUNTS, sparksFor } from "../game/sparks";

test("the same seed draws the same sparks", () => {
    assert.deepEqual(sparksFor(123456), sparksFor(123456));
});

test("different seeds draw differently", () => {
    const drawn = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
        const s = sparksFor(seed * 7919);
        drawn.add(`${s.folk}|${s.land}|${s.thing}|${s.strange}`);
    }
    // two hundred books, and hardly any two begin alike
    assert.ok(drawn.size >= 195, `only ${drawn.size} different beginnings in 200`);
});

test("every spark can be drawn", () => {
    const seen = { folk: new Set<string>(), land: new Set<string>(), thing: new Set<string>(), strange: new Set<string>() };
    for (let seed = 1; seed <= 4000; seed++) {
        const s = sparksFor(seed * 104729);
        seen.folk.add(s.folk);
        seen.land.add(s.land);
        seen.thing.add(s.thing);
        seen.strange.add(s.strange);
    }
    assert.equal(seen.folk.size, SPARK_COUNTS.folk);
    assert.equal(seen.land.size, SPARK_COUNTS.land);
    assert.equal(seen.thing.size, SPARK_COUNTS.thing);
    assert.equal(seen.strange.size, SPARK_COUNTS.strange);
});
