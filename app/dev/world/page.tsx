import { notFound } from "next/navigation";
import { BIOMES, TIMES_OF_DAY, WEATHERS, type Biome } from "@/game/looks";
import { mockScene } from "@/game/worldgen/mock";
import type { RegionKind } from "@/game/worldgen/layout";
import { WorldPreview } from "./WorldPreview";

const pick = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T =>
    value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/**
 * The engine on its own, with a made-up scene — for working on how the world
 * looks and runs without a story, a database or a model call.
 *
 *   /dev/world?kind=wilds&biome=sakura&time=dusk&weather=petals&kit=eastern&seed=7
 */
export default async function DevWorldPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
    if (process.env.NODE_ENV === "production") notFound();

    const query = await searchParams;
    const scene = mockScene({
        seed: Number(query.seed ?? 11) || 11,
        kind: pick<RegionKind>(query.kind, ["settlement", "wilds", "depths"], "settlement"),
        biome: pick<Biome>(query.biome, BIOMES, "meadow"),
        timeOfDay: pick(query.time, TIMES_OF_DAY, "day"),
        weather: pick(query.weather, WEATHERS, "clear"),
        styleKit: query.kit ?? "mediterranean",
    });

    return <WorldPreview scene={scene} quality={pick(query.quality, ["auto", "low", "medium", "high"] as const, "auto")} />;
}
