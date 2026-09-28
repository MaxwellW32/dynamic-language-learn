/**
 * The shape of a book: its chapters, each at a stage of the story. The planner
 * writes the outline; this file holds it to the shape a story has, whatever
 * was written.
 */

export const STAGES = ["introduction", "rising", "climax", "falling", "resolution"] as const;
export type Stage = (typeof STAGES)[number];

export const MIN_CHAPTERS = 3;
export const MAX_CHAPTERS = 8;

const at = (stage: Stage) => STAGES.indexOf(stage);

/**
 * Put the stages of an outline in order. A story never goes back a stage; it
 * begins no earlier than `from` (a book already under way has stages behind
 * it); it ends at its resolution; and it has a climax before it ends, if there
 * is room for one.
 */
export function orderStages<T extends { stage: Stage }>(chapters: T[], from: Stage = "introduction"): T[] {
    const kept = chapters.slice(0, MAX_CHAPTERS);
    if (kept.length === 0) return [];

    let floor = at(from);
    const staged = kept.map((chapter) => {
        floor = Math.max(floor, at(chapter.stage));
        return floor;
    });

    const last = staged.length - 1;
    staged[last] = at("resolution");
    // a climax, if the story has not had one and there is a chapter to hold it
    const climax = at("climax");
    if (at(from) <= climax && last >= 1 && !staged.slice(0, last).includes(climax)) {
        // the last chapter before the end that has not gone past the climax
        const room = staged.slice(0, last).map((stage, i) => (stage <= climax ? i : -1)).filter((i) => i >= 0).pop();
        if (room !== undefined) staged[room] = climax;
    }
    // nothing after the climax may come before it
    let reached = 0;
    return kept.map((chapter, i) => {
        reached = Math.max(reached, staged[i]);
        return { ...chapter, stage: STAGES[i === last ? at("resolution") : reached] };
    });
}
