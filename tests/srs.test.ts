import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_SRS, masteryLevel, passiveExposure, reviewCorrect, reviewWrong, type SrsState } from "../game/srs";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-27T12:00:00Z");
const fresh: SrsState = { ...INITIAL_SRS, dueAt: now };

test("correct answers stretch the interval 1 → 3 → × ease days", () => {
    const first = reviewCorrect(fresh, now);
    assert.equal(first.reps, 1);
    assert.equal(first.intervalDays, 1);
    assert.equal(first.dueAt.getTime(), now.getTime() + DAY);
    assert.equal(first.ease, 2.55);
    assert.equal(first.timesSeen, 1);
    assert.equal(first.timesCorrect, 1);

    const second = reviewCorrect(first, now);
    assert.equal(second.intervalDays, 3);
    assert.equal(second.dueAt.getTime(), now.getTime() + 3 * DAY);

    const third = reviewCorrect(second, now);
    assert.equal(third.intervalDays, Math.round(3 * second.ease));
    assert.equal(third.reps, 3);
});

test("ease never climbs above 2.8 nor falls below 1.3", () => {
    let s = fresh;
    for (let i = 0; i < 30; i++) s = reviewCorrect(s, now);
    assert.equal(s.ease, 2.8);
    for (let i = 0; i < 30; i++) s = reviewWrong(s, now);
    assert.equal(s.ease, 1.3);
});

test("a miss resets the run, counts a lapse and comes back within ten minutes", () => {
    const learned = reviewCorrect(reviewCorrect(fresh, now), now);
    const missed = reviewWrong(learned, now);
    assert.equal(missed.reps, 0);
    assert.equal(missed.lapses, 1);
    assert.equal(missed.intervalDays, 0);
    assert.ok(Math.abs(missed.ease - (learned.ease - 0.2)) < 1e-9);
    assert.equal(missed.dueAt.getTime(), now.getTime() + 10 * 60 * 1000);
    assert.equal(missed.timesSeen, learned.timesSeen + 1);
    assert.equal(missed.timesCorrect, learned.timesCorrect, "a miss is not a correct answer");
});

test("reading exposure touches the counter and nothing else", () => {
    const seen = passiveExposure(fresh);
    assert.deepEqual(seen, { ...fresh, timesSeen: 1 });
});

test("mastery follows the interval", () => {
    assert.equal(masteryLevel({ reps: 0, intervalDays: 100 }), 0);
    assert.equal(masteryLevel({ reps: 1, intervalDays: 1 }), 1);
    assert.equal(masteryLevel({ reps: 2, intervalDays: 3 }), 2);
    assert.equal(masteryLevel({ reps: 3, intervalDays: 7 }), 3);
    assert.equal(masteryLevel({ reps: 4, intervalDays: 16 }), 4);
    assert.equal(masteryLevel({ reps: 5, intervalDays: 35 }), 5);
});

test("the functions never mutate their input", () => {
    const before = JSON.stringify(fresh);
    reviewCorrect(fresh, now);
    reviewWrong(fresh, now);
    passiveExposure(fresh);
    assert.equal(JSON.stringify(fresh), before);
});
