"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAtom, useAtomValue } from "jotai";
import { clampToMap, distance, INTERACT_RADIUS, PLAYER_SPEED, type Point } from "@/game/geometry";
import { syncPositionAction } from "@/server/actions/game";
import { playerPosAtom, sceneAtom, storyInfoAtom } from "./state";

const PROXIMITY_HZ = 8;
const SERVER_SYNC_MS = 2500;

export type Interactable =
    | { kind: "character"; id: string; x: number; y: number }
    | { kind: "enemy"; id: string; x: number; y: number }
    | { kind: "feature"; id: string; x: number; y: number }
    | { kind: "portal"; id: string; x: number; y: number };

/**
 * Movement + proximity. The player element is moved by writing its transform
 * directly each animation frame; React state (playerPosAtom) only updates a
 * few times a second for proximity checks, so the map never re-renders at
 * frame rate.
 */
export function useMapEngine() {
    const scene = useAtomValue(sceneAtom);
    const story = useAtomValue(storyInfoAtom);
    const [playerPos, setPlayerPos] = useAtom(playerPosAtom);

    const playerElRef = useRef<HTMLDivElement | null>(null);
    const posRef = useRef<Point>({ x: 0, y: 0 });
    const targetRef = useRef<Point | null>(null);
    const keysRef = useRef<Set<string>>(new Set());
    const lastReactSync = useRef(0);
    const lastServerSync = useRef(0);
    const movedSinceServerSync = useRef(false);

    const mapRef = useRef(scene?.map ?? null);
    const storyIdRef = useRef(story?.id ?? null);
    useEffect(() => {
        mapRef.current = scene?.map ?? null;
        storyIdRef.current = story?.id ?? null;
    });

    const applyTransform = useCallback(() => {
        const el = playerElRef.current;
        const map = mapRef.current;
        if (!el || !map) return;
        el.style.left = `${(posRef.current.x / map.width) * 100}%`;
        el.style.top = `${(posRef.current.y / map.height) * 100}%`;
    }, []);

    // adopt the server position whenever the map (or story) changes
    useEffect(() => {
        if (!scene) return;
        posRef.current = { x: scene.player.x, y: scene.player.y };
        targetRef.current = null;
        setPlayerPos(posRef.current);
        applyTransform();
    }, [scene?.map.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // keyboard: WASD / arrows
    useEffect(() => {
        const isTyping = (e: KeyboardEvent) =>
            e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName);
        const down = (e: KeyboardEvent) => {
            if (isTyping(e)) return;
            const key = e.key.toLowerCase();
            if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
                keysRef.current.add(key);
                targetRef.current = null;
                e.preventDefault();
            }
        };
        const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };
    }, []);

    // the movement loop
    useEffect(() => {
        let raf = 0;
        let last = performance.now();

        const tick = (now: number) => {
            raf = requestAnimationFrame(tick);
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            const map = mapRef.current;
            if (!map) return;

            let dx = 0;
            let dy = 0;
            const keys = keysRef.current;
            if (keys.has("w") || keys.has("arrowup")) dy -= 1;
            if (keys.has("s") || keys.has("arrowdown")) dy += 1;
            if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
            if (keys.has("d") || keys.has("arrowright")) dx += 1;

            if (dx === 0 && dy === 0 && targetRef.current) {
                const t = targetRef.current;
                const dist = distance(posRef.current, t);
                if (dist < 0.15) {
                    targetRef.current = null;
                } else {
                    dx = (t.x - posRef.current.x) / dist;
                    dy = (t.y - posRef.current.y) / dist;
                }
            }

            if (dx !== 0 || dy !== 0) {
                const len = Math.hypot(dx, dy) || 1;
                posRef.current = clampToMap({
                    x: posRef.current.x + (dx / len) * PLAYER_SPEED * dt,
                    y: posRef.current.y + (dy / len) * PLAYER_SPEED * dt,
                }, map.width, map.height);
                applyTransform();
                movedSinceServerSync.current = true;

                if (now - lastReactSync.current > 1000 / PROXIMITY_HZ) {
                    lastReactSync.current = now;
                    setPlayerPos({ ...posRef.current });
                }
            }

            if (movedSinceServerSync.current && now - lastServerSync.current > SERVER_SYNC_MS) {
                lastServerSync.current = now;
                movedSinceServerSync.current = false;
                const storyId = storyIdRef.current;
                if (storyId) void syncPositionAction(storyId, posRef.current).catch(() => { });
            }
        };

        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [applyTransform, setPlayerPos]);

    const walkTo = useCallback((p: Point) => {
        targetRef.current = p;
    }, []);

    /** the single nearest thing the player could interact with right now */
    const nearest: Interactable | null = (() => {
        if (!scene) return null;
        const candidates: Interactable[] = [
            ...scene.characters.map((c) => ({ kind: "character" as const, id: c.id, x: c.x, y: c.y })),
            ...scene.enemies.filter((e) => e.status === "alive")
                .map((e) => ({ kind: "enemy" as const, id: e.id, x: e.x, y: e.y })),
            ...scene.features.filter((f) => f.interactive)
                .map((f) => ({ kind: "feature" as const, id: f.id, x: f.x, y: f.y })),
            ...scene.portals.map((p) => ({ kind: "portal" as const, id: p.id, x: p.x, y: p.y })),
        ];
        let best: Interactable | null = null;
        let bestDist = INTERACT_RADIUS;
        for (const c of candidates) {
            const d = distance(playerPos, c);
            if (d <= bestDist) {
                best = c;
                bestDist = d;
            }
        }
        return best;
    })();

    /** immediately place the player (after portal travel) */
    const teleport = useCallback((p: Point) => {
        posRef.current = p;
        targetRef.current = null;
        setPlayerPos(p);
        applyTransform();
    }, [applyTransform, setPlayerPos]);

    /** the exact live position (fresher than the throttled atom) */
    const getPosition = useCallback((): Point => ({ ...posRef.current }), []);

    return { playerElRef, walkTo, nearest, teleport, getPosition };
}
