/**
 * The order of a quest's steps.
 *
 * What can always be done again — a talk, a visit, a look — waits its turn:
 * "return to Marta" is not done by having met her. A creature bested or a
 * word learned counts whenever it happens, because it may not be possible
 * twice.
 */
const ANY_TIME: readonly string[] = ["defeat", "learnWords"];

/** the objectives of one quest that can be advanced now: the next step in order, and whatever counts at any time */
export function liveObjectives<T extends { kind: string; status: string; sortIndex: number }>(objectives: T[]): T[] {
    const live: T[] = [];
    let nextFound = false;
    for (const objective of [...objectives].sort((a, b) => a.sortIndex - b.sortIndex)) {
        if (objective.status !== "active") continue;
        if (ANY_TIME.includes(objective.kind)) live.push(objective);
        else if (!nextFound) {
            live.push(objective);
            nextFound = true;
        }
    }
    return live;
}
