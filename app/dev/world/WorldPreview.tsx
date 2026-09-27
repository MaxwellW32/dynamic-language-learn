"use client";

import { useCallback, useMemo, useState } from "react";
import { WorldCanvas } from "@/components/game/WorldCanvas";
import { installDevHook } from "@/components/game/devHook";
import type { EngineEvents, Interactable, Quality, WorldEngine } from "@/engine";
import type { ScenePayload } from "@/game/payloads";

export function WorldPreview({ scene, quality }: { scene: ScenePayload; quality: Quality | "auto" }) {
    const [nearest, setNearest] = useState<Interactable | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const note = useCallback((line: string) => setLog((lines) => [...lines.slice(-5), line]), []);

    const events = useMemo<EngineEvents>(() => ({
        onNearest: setNearest,
        onAct: (target) => note(`act: ${target.verb} ${target.name}`),
        onContact: (id) => note(`caught by ${id}`),
        onWord: (id) => note(`word ${id}`),
        onStick: () => { },
    }), [note]);

    const onEngine = useCallback((engine: WorldEngine | null) => {
        installDevHook(engine, {});
    }, []);

    return (
        <main className="fixed inset-0 bg-night">
            <WorldCanvas scene={scene} quality={quality} events={events} onEngine={onEngine} />
            <div className="absolute top-3 left-3 rounded bg-night/70 text-parchment text-sm px-3 py-2 pointer-events-none">
                <div className="font-display text-lg">{scene.region.name}</div>
                <div>{scene.region.kind} · {scene.region.biome} · {scene.region.timeOfDay} · {scene.region.weather}</div>
                {log.map((line, i) => <div key={i} className="text-gold">{line}</div>)}
            </div>
            {nearest && (
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full bg-parchment text-ink px-5 py-2 shadow-card font-display">
                    E — {nearest.verb} {nearest.name}
                </div>
            )}
        </main>
    );
}
