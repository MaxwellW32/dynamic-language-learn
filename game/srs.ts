/**
 * SM-2-lite spaced repetition. Pure functions — no I/O — so the scheduling
 * rules are unit-testable and identical everywhere they're applied.
 */

export type SrsState = {
    reps: number;
    lapses: number;
    ease: number;
    intervalDays: number;
    dueAt: Date;
    timesSeen: number;
    timesCorrect: number;
};

export const INITIAL_SRS: Omit<SrsState, "dueAt"> = {
    reps: 0,
    lapses: 0,
    ease: 2.5,
    intervalDays: 0,
    timesSeen: 0,
    timesCorrect: 0,
};

const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const DAY_MS = 24 * 60 * 60 * 1000;
/** a missed word comes back within the same play session */
const LAPSE_RETRY_MS = 10 * 60 * 1000;

export function reviewCorrect(s: SrsState, now: Date): SrsState {
    const reps = s.reps + 1;
    const intervalDays =
        reps === 1 ? 1 :
        reps === 2 ? 3 :
        Math.round(s.intervalDays * s.ease);
    return {
        ...s,
        reps,
        intervalDays,
        ease: Math.min(MAX_EASE, s.ease + 0.05),
        dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
        timesSeen: s.timesSeen + 1,
        timesCorrect: s.timesCorrect + 1,
    };
}

export function reviewWrong(s: SrsState, now: Date): SrsState {
    return {
        ...s,
        reps: 0,
        lapses: s.lapses + 1,
        intervalDays: 0,
        ease: Math.max(MIN_EASE, s.ease - 0.2),
        dueAt: new Date(now.getTime() + LAPSE_RETRY_MS),
        timesSeen: s.timesSeen + 1,
    };
}

/** reading exposure (a vocab segment rendered / tapped) — touches, never schedules backwards */
export function passiveExposure(s: SrsState): SrsState {
    return { ...s, timesSeen: s.timesSeen + 1 };
}

/**
 * 0–5 "quill level" for the UI. Interval is the honest signal of retention.
 */
export function masteryLevel(s: Pick<SrsState, "reps" | "intervalDays">): number {
    if (s.reps === 0) return 0;
    if (s.intervalDays >= 35) return 5;
    if (s.intervalDays >= 16) return 4;
    if (s.intervalDays >= 7) return 3;
    if (s.intervalDays >= 3) return 2;
    return 1;
}
