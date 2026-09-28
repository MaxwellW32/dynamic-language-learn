/**
 * A chapter is a checklist of goals, taken one at a time and in order. This
 * file holds what can be said about such a list without asking anyone: which
 * goal is live, and what the book must do next.
 *
 *   tell      the storyteller tells the reader something (exposition). It is
 *             done once it has been told, and is never shown in the checklist.
 *   visit     go somewhere: another region, or a building or landmark in one.
 *   talk      speak with someone about something.
 *   persuade  win someone over. They answer for themselves.
 *   fight     best a creature. Losing is an ending too.
 *   examine   look closely at something.
 *
 * A goal that fails is not a dead end: the goals that came after it are
 * dropped and written again around what happened (`mend`).
 */

export const GOAL_KINDS = ["tell", "visit", "talk", "persuade", "fight", "examine"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/**
 * waiting: its turn has not come · active: the one goal in hand · done, failed:
 * settled · dropped: written for a road the story no longer takes.
 */
export type GoalStatus = "waiting" | "active" | "done" | "failed" | "dropped";

/** the two kinds that are settled in a conversation, by the person spoken to */
export const isSpoken = (kind: GoalKind): kind is "talk" | "persuade" => kind === "talk" || kind === "persuade";

/** where someone stands on what is asked of them: -5 will not hear of it … 5 won */
export const LEAN_MIN = -5;
export const LEAN_MAX = 5;
/** asked for an answer with nothing else to go on, this far toward yes is a yes */
export const LEAN_YES = 2;

/** how many pages the storyteller writes at one sitting, when several tells follow one another */
export const TELLS_AT_ONCE = 3;

type Step = { kind: GoalKind; status: GoalStatus; sortIndex: number; mended?: boolean };

const inOrder = <T extends Step>(goals: T[]): T[] =>
    goals.filter((goal) => goal.status !== "dropped").sort((a, b) => a.sortIndex - b.sortIndex);

export type Due<T> =
    /** the chapter has no goals yet: they are to be written */
    | { what: "plan" }
    /** nothing is in hand and something waits: it takes its turn */
    | { what: "next"; goal: T }
    /** the storyteller has something to tell: these, in order */
    | { what: "tell"; goals: T[] }
    /** the goal in hand is the reader's to do */
    | { what: "reader"; goal: T }
    /** a goal failed and the road ahead has not been written again yet */
    | { what: "mend"; failed: T }
    /** every goal is settled: the chapter is over */
    | { what: "turn" };

/** what the book must do next with a chapter's goals */
export function whatIsDue<T extends Step>(goals: T[]): Due<T> {
    const list = inOrder(goals);
    if (list.length === 0) return { what: "plan" };

    // a failure is mended before anything else is done, even if something is wrongly still in hand
    const settled = list.filter((goal) => goal.status === "done" || goal.status === "failed");
    const last = settled[settled.length - 1];
    if (last && last.status === "failed" && !last.mended) return { what: "mend", failed: last };

    const active = list.find((goal) => goal.status === "active");
    if (!active) {
        const next = list.find((goal) => goal.status === "waiting");
        return next ? { what: "next", goal: next } : { what: "turn" };
    }
    if (active.kind !== "tell") return { what: "reader", goal: active };

    // the tells that follow one another are told at one sitting
    const from = list.indexOf(active);
    const run: T[] = [active];
    for (const goal of list.slice(from + 1)) {
        if (run.length >= TELLS_AT_ONCE || goal.kind !== "tell" || goal.status !== "waiting") break;
        run.push(goal);
    }
    return { what: "tell", goals: run };
}

/** what the reader is shown of a chapter: what is settled and what is in hand, never what the storyteller tells */
export function checklist<T extends Step>(goals: T[]): { shown: T[]; ahead: number } {
    const list = inOrder(goals).filter((goal) => goal.kind !== "tell");
    return {
        shown: list.filter((goal) => goal.status !== "waiting"),
        ahead: list.filter((goal) => goal.status === "waiting").length,
    };
}

/** how a person's lean reads to the reader */
export function leanName(lean: number): string {
    if (lean >= 4) return "all but won";
    if (lean >= 2) return "coming round";
    if (lean >= 1) return "listening";
    if (lean === 0) return "unmoved";
    if (lean >= -2) return "doubtful";
    if (lean >= -4) return "bristling";
    return "about to walk away";
}

export const clampLean = (lean: number): number => Math.max(LEAN_MIN, Math.min(LEAN_MAX, Math.round(lean)));

/**
 * Whether what a person decided in the middle of a conversation is taken as
 * their answer. Nobody is won, or lost, by the first thing said to them; but
 * once asked outright, whatever they say stands.
 */
export function decisionStands(kind: "talk" | "persuade", decision: "yes" | "no" | null, heroLines: number, asked: boolean): boolean {
    if (decision === null) return false;
    if (asked) return true;
    if (kind === "talk") return heroLines >= 1;
    return heroLines >= 2;
}

/** the answer given when someone was asked outright and would not say */
export function answerFromLean(kind: "talk" | "persuade", lean: number): "yes" | "no" {
    if (kind === "talk") return lean <= -3 ? "no" : "yes";
    return lean >= LEAN_YES ? "yes" : "no";
}
