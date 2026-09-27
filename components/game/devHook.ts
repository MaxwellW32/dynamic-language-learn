import type { Gesture, Interactable, WorldEngine } from "@/engine";

/**
 * A handle on the running game for whoever is testing it from outside the
 * page — `scripts/testBrowser.mjs` calls these through `window.__wordbound`.
 * It exists only in development builds.
 *
 * The game screen passes `extras` so a script can also read what the HUD is
 * showing, not just what the engine is drawing.
 */
export type DevHook = {
    report: () => unknown;
    walkTo: (args: { kind?: Interactable["kind"]; id?: string; x?: number; z?: number; act?: boolean }) => Promise<boolean>;
    teleport: (args: { x: number; z: number; rot?: number }) => boolean;
    look: (args: { yaw: number; pitch?: number; distance?: number }) => boolean;
    gesture: (args: { gesture: Gesture }) => boolean;
    celebrate: () => boolean;
} & Record<string, (args: never) => unknown>;

declare global {
    interface Window {
        __wordbound?: DevHook;
    }
}

export function installDevHook(engine: WorldEngine | null, extras: Record<string, (args: never) => unknown>): void {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    if (!engine) {
        delete window.__wordbound;
        return;
    }
    window.__wordbound = {
        ...extras,
        report: () => ({ ...engine.report(), ...(extras.state ? { hud: (extras.state as () => unknown)() } : {}) }),
        walkTo: (args) => {
            if (args.x !== undefined && args.z !== undefined) return engine.walkTo({ x: args.x, z: args.z });
            return engine.walkTo({ kind: args.kind ?? "character", id: args.id }, args.act ?? false);
        },
        teleport: (args) => {
            engine.teleport(args.x, args.z, args.rot);
            return true;
        },
        look: (args) => {
            engine.look(args.yaw, args.pitch, args.distance);
            return true;
        },
        gesture: (args) => {
            engine.heroGesture(args.gesture);
            return true;
        },
        celebrate: () => {
            engine.celebrate();
            return true;
        },
    } as DevHook;
}
