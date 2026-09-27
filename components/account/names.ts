/*
 * Plain names for what the storyteller did, for the wallet page. Task names
 * come from server/ai (the `task` of each model call); ledger reasons are
 * "ai:<task>" for a call's charge, plus the wallet's own reasons.
 */

/** a kind of work, as a heading in the usage list */
export function taskName(task: string): string {
    if (task === "dialogue") return "Conversations";
    if (task === "greeting") return "Greetings";
    if (task.startsWith("narrate")) return "Pages of story";
    if (task.startsWith("forge")) return "Forging a world";
    if (task === "chapter-turn") return "Turning chapters";
    if (["direct", "summarise", "reflect", "lemmas"].includes(task)) return "Keeping the story's memory";
    if (task === "speak") return "Reading aloud";
    if (task === "transcribe") return "Listening to you";
    return humanise(task);
}

/** one ledger line, in a few words */
export function reasonName(reason: string): string {
    if (reason === "topup") return "Credit added";
    if (reason === "starter-gift") return "A gift to begin with";
    if (reason === "test-seed") return "Test refill";
    if (reason.startsWith("ai:")) {
        const task = reason.slice(3);
        if (task === "dialogue") return "A conversation";
        if (task === "greeting") return "A greeting";
        if (task.startsWith("narrate")) return "A page of story";
        if (task.startsWith("forge")) return "Forging a world";
        if (task === "chapter-turn") return "Turning a chapter";
        if (task === "speak") return "Reading aloud";
        if (task === "transcribe") return "Listening to you";
        return taskName(task);
    }
    return humanise(reason);
}

/** "some-thing:else" → "Some thing else", for anything not named above */
function humanise(raw: string): string {
    const words = raw.replace(/[-_:]+/g, " ").trim();
    return words.length === 0 ? "Other" : words[0].toUpperCase() + words.slice(1);
}
