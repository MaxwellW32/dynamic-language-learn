import { test } from "node:test";
import assert from "node:assert/strict";
import {
    answerFromLean, checklist, clampLean, decisionStands, leanName, whatIsDue, TELLS_AT_ONCE,
    type GoalKind, type GoalStatus,
} from "../game/goals";
import { orderStages, type Stage } from "../game/outline";
import { generateLayout, withinReach, type RegionKind } from "../game/worldgen/layout";
import { standingSpot } from "../game/worldgen/spots";

type G = { id: string; kind: GoalKind; status: GoalStatus; sortIndex: number; mended?: boolean };

/** "tell:done visit:active talk" → a chapter's goals, in order; a status left out is "waiting" */
function chapter(spec: string): G[] {
    return spec.trim().split(/\s+/).map((word, i) => {
        const [kind, status = "waiting", mended] = word.split(":");
        return { id: `g${i + 1}`, kind: kind as GoalKind, status: status as GoalStatus, sortIndex: i + 1, mended: mended === "mended" };
    });
}

test("a chapter with no goals is to be planned", () => {
    assert.equal(whatIsDue([]).what, "plan");
    // goals that were all dropped are no goals
    assert.equal(whatIsDue(chapter("tell:dropped talk:dropped")).what, "plan");
});

test("one goal is in hand at a time, and it is the reader's unless it is a tell", () => {
    const due = whatIsDue(chapter("tell:done talk:active visit persuade"));
    assert.equal(due.what, "reader");
    assert.equal(due.what === "reader" && due.goal.id, "g2");
});

test("when nothing is in hand the next waiting goal takes its turn, in order", () => {
    const due = whatIsDue(chapter("tell:done talk:done visit persuade"));
    assert.equal(due.what, "next");
    assert.equal(due.what === "next" && due.goal.id, "g3");
    // order is by sortIndex, not by where a row happens to be in the list
    const shuffled = [...chapter("tell:done talk:done visit persuade")].reverse();
    const again = whatIsDue(shuffled);
    assert.equal(again.what === "next" && again.goal.id, "g3");
});

test("tells that follow one another are told at one sitting, up to a limit", () => {
    const due = whatIsDue(chapter("tell:active tell tell talk tell"));
    assert.equal(due.what, "tell");
    assert.deepEqual(due.what === "tell" && due.goals.map((g) => g.id), ["g1", "g2", "g3"]);

    const many = whatIsDue(chapter("tell:active tell tell tell tell"));
    assert.equal(many.what === "tell" && many.goals.length, TELLS_AT_ONCE);

    // a tell after something the reader must do is not told early
    const one = whatIsDue(chapter("tell:active talk tell"));
    assert.deepEqual(one.what === "tell" && one.goals.map((g) => g.id), ["g1"]);
});

test("a failure is mended before anything else, and only once", () => {
    const failed = whatIsDue(chapter("tell:done persuade:failed tell:dropped fight:dropped"));
    assert.equal(failed.what, "mend");
    assert.equal(failed.what === "mend" && failed.failed.id, "g2");

    // once mended, the new road is simply the rest of the chapter
    const mended = whatIsDue(chapter("tell:done persuade:failed:mended tell:dropped fight:dropped tell talk"));
    assert.equal(mended.what, "next");
    assert.equal(mended.what === "next" && mended.goal.id, "g5");
});

test("a failure on the last goal of a chapter is still mended: the chapter does not end on it", () => {
    assert.equal(whatIsDue(chapter("tell:done fight:failed")).what, "mend");
    assert.equal(whatIsDue(chapter("tell:done fight:failed:mended tell:done")).what, "turn");
});

test("a second failure, on the mended road, is mended too", () => {
    const due = whatIsDue(chapter("tell:done persuade:failed:mended tell:dropped tell:done talk:failed fight:dropped"));
    assert.equal(due.what, "mend");
    assert.equal(due.what === "mend" && due.failed.id, "g5");
});

test("a chapter is over when every goal is settled", () => {
    assert.equal(whatIsDue(chapter("tell:done talk:done fight:done tell:done")).what, "turn");
    assert.equal(whatIsDue(chapter("tell:done talk:done fight:done tell")).what, "next");
});

test("the checklist shows what is settled and what is in hand, and never a tell", () => {
    const { shown, ahead } = checklist(chapter("tell:done talk:done persuade:failed:mended tell:dropped tell:done visit:active fight tell examine"));
    assert.deepEqual(shown.map((g) => g.id), ["g2", "g3", "g6"]);
    assert.equal(ahead, 2);
});

test("nobody is won or lost by the first thing said to them, but an answer asked for stands", () => {
    assert.equal(decisionStands("persuade", "yes", 1, false), false);
    assert.equal(decisionStands("persuade", "no", 1, false), false);
    assert.equal(decisionStands("persuade", "yes", 2, false), true);
    assert.equal(decisionStands("persuade", "no", 3, false), true);
    assert.equal(decisionStands("talk", "yes", 1, false), true);
    assert.equal(decisionStands("talk", "yes", 0, false), false);
    assert.equal(decisionStands("persuade", null, 9, false), false);
    assert.equal(decisionStands("persuade", "no", 1, true), true);
});

test("asked outright and saying nothing, a person answers by where they stand", () => {
    assert.equal(answerFromLean("persuade", 2), "yes");
    assert.equal(answerFromLean("persuade", 1), "no");
    assert.equal(answerFromLean("persuade", -4), "no");
    // a talk has nothing to be won: it has done its work unless it was soured
    assert.equal(answerFromLean("talk", 0), "yes");
    assert.equal(answerFromLean("talk", -4), "no");
});

test("a lean is kept within its scale and always has a name", () => {
    assert.equal(clampLean(9), 5);
    assert.equal(clampLean(-9), -5);
    assert.equal(clampLean(1.6), 2);
    for (let lean = -5; lean <= 5; lean++) assert.ok(leanName(lean).length > 0);
    assert.notEqual(leanName(5), leanName(-5));
});

/* ------------------------------------------------------------------ */
/* the outline                                                         */
/* ------------------------------------------------------------------ */

const stages = (list: Stage[], from?: Stage) => orderStages(list.map((stage) => ({ stage })), from).map((c) => c.stage);

test("an outline that is already in order is left as it is", () => {
    const told: Stage[] = ["introduction", "rising", "rising", "climax", "falling", "resolution"];
    assert.deepEqual(stages(told), told);
});

test("a story never goes back a stage, always has a climax, and ends at its resolution", () => {
    assert.deepEqual(stages(["rising", "introduction", "climax", "rising", "falling"]), ["rising", "rising", "climax", "climax", "resolution"]);
    assert.deepEqual(stages(["introduction", "rising", "rising", "falling", "resolution"]), ["introduction", "rising", "climax", "falling", "resolution"]);
    assert.deepEqual(stages(["rising", "rising", "rising", "rising", "rising"]), ["rising", "rising", "rising", "climax", "resolution"]);
    for (const told of [stages(["introduction", "introduction", "introduction"]), stages(["resolution", "climax", "introduction", "rising"])]) {
        assert.equal(told[told.length - 1], "resolution");
        const order = told.map((stage) => ["introduction", "rising", "climax", "falling", "resolution"].indexOf(stage));
        assert.deepEqual(order, [...order].sort((a, b) => a - b), `out of order: ${told.join(", ")}`);
    }
});

test("a book already under way is outlined from the stage it has reached", () => {
    assert.deepEqual(stages(["introduction", "rising", "climax", "resolution"], "rising"), ["rising", "rising", "climax", "resolution"]);
    // past its climax, it is not given another
    assert.deepEqual(stages(["rising", "falling", "resolution"], "falling"), ["falling", "falling", "resolution"]);
    assert.deepEqual(stages(["introduction"], "falling"), ["resolution"]);
});

test("an outline is kept to a length a book can carry", () => {
    const long = Array.from({ length: 14 }, (): Stage => "rising");
    assert.equal(stages(long).length, 8);
    assert.deepEqual(stages([]), []);
});

/* ------------------------------------------------------------------ */
/* somewhere to stand                                                  */
/* ------------------------------------------------------------------ */

test("someone who joins a region is given ground of their own, however full the region is", () => {
    for (const kind of ["settlement", "wilds", "depths"] as RegionKind[]) {
        for (const seed of [7, 1234, 99991]) {
            const layout = generateLayout({ seed, kind, biome: "meadow", gates: ["w", "e"] });
            const taken: { x: number; z: number }[] = [];
            // more newcomers than the layout ever planned for
            for (let i = 0; i < layout.npcSlots.length + 8; i++) {
                const spot = standingSpot(layout, taken, []);
                assert.ok(withinReach(layout, spot), `${kind} ${seed}: newcomer ${i} stands outside the region`);
                for (const other of taken) {
                    assert.ok(Math.hypot(other.x - spot.x, other.z - spot.z) > 1.2, `${kind} ${seed}: newcomer ${i} stands on someone`);
                }
                taken.push(spot);
            }
        }
    }
});

test("a newcomer does not stand in anything solid", () => {
    const layout = generateLayout({ seed: 42, kind: "settlement", biome: "meadow", gates: ["e"] });
    const solid = layout.plots.map((plot) => ({ x: plot.x, z: plot.z, r: Math.max(plot.width, plot.depth) / 2 + 0.5 }));
    const taken: { x: number; z: number }[] = [];
    for (let i = 0; i < 14; i++) {
        const spot = standingSpot(layout, taken, solid);
        for (const thing of solid) {
            assert.ok(Math.hypot(thing.x - spot.x, thing.z - spot.z) >= thing.r, `newcomer ${i} stands inside a building`);
        }
        taken.push(spot);
    }
});

test("where a newcomer stands does not change the layout itself", () => {
    const spec = { seed: 5150, kind: "wilds" as const, biome: "forest" as const, gates: ["w" as const] };
    const before = JSON.stringify(generateLayout(spec));
    standingSpot(generateLayout(spec), [], []);
    assert.equal(JSON.stringify(generateLayout(spec)), before);
});
