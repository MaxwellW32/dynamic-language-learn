import "server-only";
import { after } from "next/server";

/**
 * Do something once the player has their answer. Inside a request this is
 * Next's `after`; in a script or a test there is no request to come after, so
 * the work simply runs on its own.
 */
export function later(name: string, work: () => Promise<void>): void {
    const guarded = async () => {
        try {
            await work();
        } catch (error) {
            console.error(`[later] ${name} failed`, error);
        }
    };
    try {
        after(guarded);
    } catch {
        void guarded();
    }
}
