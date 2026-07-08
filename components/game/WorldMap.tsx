"use client";

import { useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { enemySprite, featureSprite, npcSprite } from "@/game/sprites";
import { sceneAtom } from "./state";
import type { Interactable } from "./useMapEngine";

/** biome washes painted under the entities, per map kind */
const MAP_BACKGROUNDS: Record<string, string> = {
    settlement: "bg-[radial-gradient(ellipse_at_30%_20%,#dcd9a8,transparent_60%),radial-gradient(ellipse_at_70%_80%,#b8c48b,transparent_55%)] bg-[#c9cf96]",
    wilds: "bg-[radial-gradient(ellipse_at_20%_30%,#8fae6f,transparent_55%),radial-gradient(ellipse_at_80%_70%,#5f7a45,transparent_60%)] bg-[#7d9a5e]",
    dungeon: "bg-[radial-gradient(ellipse_at_50%_20%,#6e6a75,transparent_60%),radial-gradient(ellipse_at_30%_80%,#3f3b46,transparent_55%)] bg-[#565160]",
    interior: "bg-[repeating-linear-gradient(90deg,#a97a4d_0_3.5rem,#9a6d42_3.5rem_7rem)]",
};

function Token({
    x, y, mapW, mapH, children, label, onClick, highlight = false, faded = false,
}: {
    x: number; y: number; mapW: number; mapH: number;
    children: ReactNode; label?: string;
    onClick?: () => void; highlight?: boolean; faded?: boolean;
}) {
    return (
        <div
            className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center select-none ${faded ? "opacity-40" : ""}`}
            style={{ left: `${(x / mapW) * 100}%`, top: `${(y / mapH) * 100}%` }}
            onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
        >
            <span className={`text-2xl leading-none drop-shadow ${highlight ? "animate-bob" : ""}`}>{children}</span>
            {label && (
                <span className="mt-0.5 rounded bg-night/60 px-1.5 py-px text-[10px] leading-tight text-parchment whitespace-nowrap">
                    {label}
                </span>
            )}
        </div>
    );
}

/**
 * The illustrated left page: a handcrafted scene with a handful of
 * meaningful things on it. Clicking the ground walks the hero there.
 */
export function WorldMap({
    playerElRef,
    playerName,
    nearest,
    onWalk,
    onInteract,
}: {
    playerElRef: React.RefObject<HTMLDivElement | null>;
    playerName: string;
    nearest: Interactable | null;
    onWalk: (p: { x: number; y: number }) => void;
    onInteract: (target: Interactable) => void;
}) {
    const scene = useAtomValue(sceneAtom);
    if (!scene) return null;
    const { map } = scene;

    const nearestEntity = nearest && {
        character: scene.characters.find((c) => nearest.kind === "character" && c.id === nearest.id),
        enemy: scene.enemies.find((e) => nearest.kind === "enemy" && e.id === nearest.id),
        feature: scene.features.find((f) => nearest.kind === "feature" && f.id === nearest.id),
        portal: scene.portals.find((p) => nearest.kind === "portal" && p.id === nearest.id),
    };

    const prompt = !nearest || !nearestEntity ? null
        : nearest.kind === "character" ? { icon: "💬", text: `Talk to ${nearestEntity.character?.name}` }
        : nearest.kind === "enemy" ? { icon: "⚔️", text: `Challenge ${nearestEntity.enemy?.name}` }
        : nearest.kind === "feature" ? { icon: "🔍", text: `Inspect ${nearestEntity.feature?.name}` }
        : { icon: "🚪", text: nearestEntity.portal?.label ?? "Enter" };

    return (
        <div className="relative w-full">
            <div
                className={`relative w-full rounded-sm overflow-hidden shadow-card ${MAP_BACKGROUNDS[map.kind] ?? MAP_BACKGROUNDS.settlement}`}
                style={{ aspectRatio: `${map.width} / ${map.height}` }}
                onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    onWalk({
                        x: ((e.clientX - rect.left) / rect.width) * map.width,
                        y: ((e.clientY - rect.top) / rect.height) * map.height,
                    });
                }}
            >
                {/* vignette so the scene sits inside the page like an illustration */}
                <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_50px_rgb(58_45_34/0.45)]" />

                {scene.features.map((f) => (
                    <Token key={f.id} x={f.x} y={f.y} mapW={map.width} mapH={map.height}
                        label={f.interactive ? f.name : undefined}
                        highlight={nearest?.kind === "feature" && nearest.id === f.id}
                    >
                        {featureSprite(f.kind)}
                    </Token>
                ))}

                {scene.portals.map((p) => (
                    <Token key={p.id} x={p.x} y={p.y} mapW={map.width} mapH={map.height}
                        label={p.label}
                        highlight={nearest?.kind === "portal" && nearest.id === p.id}
                    >
                        🚪
                    </Token>
                ))}

                {scene.enemies.map((e) => (
                    <Token key={e.id} x={e.x} y={e.y} mapW={map.width} mapH={map.height}
                        label={e.status === "alive" ? `${e.name}${e.tier === "boss" ? " 👑" : ""}` : undefined}
                        faded={e.status === "defeated"}
                        highlight={nearest?.kind === "enemy" && nearest.id === e.id}
                    >
                        {e.status === "alive" ? enemySprite(e.spriteKey) : "💫"}
                    </Token>
                ))}

                {scene.characters.map((c) => (
                    <Token key={c.id} x={c.x} y={c.y} mapW={map.width} mapH={map.height}
                        label={c.name}
                        highlight={nearest?.kind === "character" && nearest.id === c.id}
                    >
                        {npcSprite(c.spriteKey)}
                    </Token>
                ))}

                {/* the hero — position driven directly by the map engine */}
                <div
                    ref={playerElRef}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center pointer-events-none"
                    style={{ left: "50%", top: "50%" }}
                >
                    <span className="grid place-items-center w-8 h-8 rounded-full bg-ember border-2 border-parchment shadow-card text-lg">
                        🧭
                    </span>
                    <span className="mt-0.5 rounded bg-ember-deep px-1.5 py-px text-[10px] leading-tight text-parchment whitespace-nowrap">
                        {playerName}
                    </span>
                </div>

                {/* proximity prompt */}
                {prompt && nearest && (
                    <div
                        className="absolute -translate-x-1/2 z-20"
                        style={{
                            left: `${(nearest.x / map.width) * 100}%`,
                            top: `${Math.max(0, (nearest.y / map.height) * 100 - 12)}%`,
                        }}
                    >
                        <button
                            onClick={(e) => { e.stopPropagation(); onInteract(nearest); }}
                            className="parchment rounded-md border border-wood/60 px-3 py-1.5 shadow-card font-display text-sm whitespace-nowrap cursor-pointer hover:bg-parchment-deep animate-page-in"
                        >
                            {prompt.icon} {prompt.text}
                        </button>
                    </div>
                )}
            </div>

            <p className="text-ink-faint text-xs text-right mt-1">
                walk with WASD / arrows, or click the ground
            </p>
        </div>
    );
}
