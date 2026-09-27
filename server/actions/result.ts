import { ZodError } from "zod";
import { StorytellerError } from "../ai/client";

/**
 * What every server action returns. Actions never throw to the browser: in a
 * production build a thrown error reaches the client with its message
 * stripped, and the player would be told nothing useful.
 */
export type Result<T> =
    | { ok: true; data: T }
    | {
        ok: false;
        /** always safe and friendly to show */
        error: string;
        /** wallet: out of credit · key: their own key is missing or refused · busy: try again · rule: the game said no */
        kind: "wallet" | "key" | "busy" | "failed" | "rule";
    };

export async function attempt<T>(name: string, work: () => Promise<T>): Promise<Result<T>> {
    try {
        return { ok: true, data: await work() };
    } catch (error) {
        if (error instanceof StorytellerError) {
            return { ok: false, error: error.message, kind: error.kind };
        }
        if (error instanceof ZodError) {
            return { ok: false, error: "That did not look right. Please try again.", kind: "rule" };
        }
        // the game's own refusals are plain Errors with a message written for the player;
        // anything else (a database error, a bug) carries a message that is not
        if (error instanceof Error && error.constructor === Error && error.message.length > 0 && error.message.length < 200) {
            return { ok: false, error: error.message, kind: "rule" };
        }
        console.error(`[action] ${name} failed`, error);
        return { ok: false, error: "Something went wrong in the book. Please try again.", kind: "failed" };
    }
}
