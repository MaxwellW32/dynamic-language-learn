"use client";

import { useEffect, useRef } from "react";
import type { ScenePayload } from "@/game/payloads";
import type { EngineEvents, Quality, WorldEngine } from "@/engine";

type Props = {
    scene: ScenePayload;
    quality?: Quality | "auto";
    events: EngineEvents;
    /** handed the engine as soon as it exists, and null when it is torn down */
    onEngine: (engine: WorldEngine | null) => void;
    /** called each time a region has finished building and can be seen */
    onLoaded?: () => void;
};

/**
 * The 3D world. React owns the two elements — the canvas and the layer names
 * float in — and nothing else: the engine draws and moves without ever causing
 * a render here.
 */
export function WorldCanvas({ scene, quality = "auto", events, onEngine, onLoaded }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const labelsRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<WorldEngine | null>(null);
    const loadedRef = useRef<ScenePayload | null>(null);

    // the engine calls back through these, so handlers can change without rebuilding the world
    const eventsRef = useRef(events);
    const onEngineRef = useRef(onEngine);
    const onLoadedRef = useRef(onLoaded);
    useEffect(() => {
        eventsRef.current = events;
        onEngineRef.current = onEngine;
        onLoadedRef.current = onLoaded;
    });

    useEffect(() => {
        let cancelled = false;
        const canvas = canvasRef.current;
        const layer = labelsRef.current;
        if (!canvas || !layer) return;

        // three.js is large: it is fetched only when a world is actually opened
        import("@/engine").then(async ({ WorldEngine }) => {
            if (cancelled) return;
            const engine = new WorldEngine(canvas, layer, {
                onNearest: (target) => eventsRef.current.onNearest(target),
                onAct: (target) => eventsRef.current.onAct(target),
                onContact: (id) => eventsRef.current.onContact(id),
                onReach: (goalId) => eventsRef.current.onReach(goalId),
                onWord: (id) => eventsRef.current.onWord(id),
                onStick: (stick) => eventsRef.current.onStick(stick),
            }, { quality });
            engineRef.current = engine;
            loadedRef.current = scene;
            onEngineRef.current(engine);
            await engine.load(scene);
            if (cancelled) return;
            onLoadedRef.current?.();
        });

        return () => {
            cancelled = true;
            onEngineRef.current(null);
            engineRef.current?.dispose();
            engineRef.current = null;
            loadedRef.current = null;
        };
        // the engine is built once; a new scene is loaded into it by the effect below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quality]);

    // travelling: a different region arrives as a new scene
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || loadedRef.current === scene) return;
        loadedRef.current = scene;
        let cancelled = false;
        engine.load(scene).then(() => {
            if (!cancelled) onLoadedRef.current?.();
        });
        return () => {
            cancelled = true;
        };
    }, [scene]);

    return (
        // isolate: floating names stack among themselves, never above the pages laid over the world
        <div className="absolute inset-0 overflow-hidden select-none touch-none isolate">
            <canvas ref={canvasRef} className="block w-full h-full outline-none" tabIndex={-1} aria-label="The world" />
            <div ref={labelsRef} className="wb-labels" />
        </div>
    );
}
