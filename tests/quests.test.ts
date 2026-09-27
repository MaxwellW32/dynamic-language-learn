import { test } from "node:test";
import assert from "node:assert/strict";
import { liveObjectives } from "../game/quests";

type Step = { name: string; kind: string; status: string; sortIndex: number };
const step = (name: string, kind: string, sortIndex: number, status = "active"): Step => ({ name, kind, status, sortIndex });
const names = (steps: Step[]) => liveObjectives(steps).map((s) => s.name);

test("steps that can be done again wait their turn", () => {
    const quest = [step("meet Marta", "talkTo", 0), step("read the board", "inspect", 1), step("return to Marta", "talkTo", 2)];
    assert.deepEqual(names(quest), ["meet Marta"]);

    quest[0].status = "completed";
    assert.deepEqual(names(quest), ["read the board"]);

    quest[1].status = "completed";
    assert.deepEqual(names(quest), ["return to Marta"]);
});

test("a creature bested or a word learned counts at any time", () => {
    const quest = [step("meet Pino", "talkTo", 0), step("learn words", "learnWords", 1), step("reach the flats", "visit", 2), step("face the bat", "defeat", 3)];
    assert.deepEqual(names(quest), ["meet Pino", "learn words", "face the bat"]);

    // and they hold nothing up: the visit comes due while words are still being learned
    quest[0].status = "completed";
    assert.deepEqual(names(quest), ["learn words", "reach the flats", "face the bat"]);
});

test("order is by sortIndex, not by the order the rows came in", () => {
    const quest = [step("second", "visit", 1), step("first", "talkTo", 0)];
    assert.deepEqual(names(quest), ["first"]);
});

test("a finished or failed quest has nothing live", () => {
    assert.deepEqual(names([step("a", "talkTo", 0, "completed"), step("b", "defeat", 1, "failed")]), []);
    assert.deepEqual(names([]), []);
});
