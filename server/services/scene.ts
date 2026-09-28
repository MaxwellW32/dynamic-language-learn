import "server-only";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
    books, buildings, characters, conversations, dictEntries, enemies, gates, goals, landmarks, regions,
    type Book, type Building, type Character, type Enemy, type Gate, type Goal, type Landmark, type Region,
} from "@/db/schema";
import { isLangCode } from "@/game/languages";
import { isBiome } from "@/game/looks";
import type { ScenePayload } from "@/game/payloads";
import { clampToReach, generateLayout, withinInteractRange, type GateSide, type RegionLayout } from "@/game/worldgen/layout";
import { castKeys } from "../ai/prompts/rulebook";
import { labelHint, withArticle } from "./worldWords";

/** ordinary creatures come back after this long, so there is always something to practise on */
const RESPAWN_MINUTES = 4;

export async function regionOf(book: Pick<Book, "currentRegionId">): Promise<Region> {
    if (!book.currentRegionId) throw new Error("This book has no world yet.");
    const region = await db.query.regions.findFirst({ where: eq(regions.id, book.currentRegionId) });
    if (!region) throw new Error("This place is missing from the book.");
    return region;
}

async function openSides(regionId: string): Promise<GateSide[]> {
    const rows = await db.query.gates.findMany({ where: eq(gates.regionId, regionId) });
    return [...new Set(rows.map((gate) => gate.side as GateSide))].sort();
}

export async function layoutOf(region: Region): Promise<RegionLayout> {
    return generateLayout({
        seed: region.seed,
        kind: region.kind,
        biome: isBiome(region.biome) ? region.biome : "meadow",
        gates: await openSides(region.id),
    });
}

/* ------------------------------------------------------------------ */
/* what the goal in hand points at                                     */
/* ------------------------------------------------------------------ */

/** the region that holds whatever a goal points at, or null when it points at nothing in the world */
export async function regionOfGoal(goal: Pick<Goal, "targetCharacterId" | "targetEnemyId" | "targetRegionId" | "targetBuildingId" | "targetLandmarkId">): Promise<string | null> {
    if (goal.targetRegionId) return goal.targetRegionId;
    if (goal.targetCharacterId) {
        return (await db.query.characters.findFirst({ where: eq(characters.id, goal.targetCharacterId), columns: { regionId: true } }))?.regionId ?? null;
    }
    if (goal.targetEnemyId) {
        return (await db.query.enemies.findFirst({ where: eq(enemies.id, goal.targetEnemyId), columns: { regionId: true } }))?.regionId ?? null;
    }
    if (goal.targetBuildingId) {
        return (await db.query.buildings.findFirst({ where: eq(buildings.id, goal.targetBuildingId), columns: { regionId: true } }))?.regionId ?? null;
    }
    if (goal.targetLandmarkId) {
        return (await db.query.landmarks.findFirst({ where: eq(landmarks.id, goal.targetLandmarkId), columns: { regionId: true } }))?.regionId ?? null;
    }
    return null;
}

/** the gate to leave by, from one region, to reach another by the fewest gates; null when already there or no way leads there */
export function firstGateToward(all: Gate[], from: string, to: string): Gate | null {
    if (from === to) return null;
    const cameBy = new Map<string, Gate>();
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
        const at = queue.shift()!;
        if (at === to) break;
        for (const gate of all) {
            if (gate.regionId !== at || seen.has(gate.targetRegionId)) continue;
            seen.add(gate.targetRegionId);
            cameBy.set(gate.targetRegionId, gate);
            queue.push(gate.targetRegionId);
        }
    }
    let gate = cameBy.get(to) ?? null;
    while (gate && gate.regionId !== from) gate = cameBy.get(gate.regionId) ?? null;
    return gate;
}

/** the ids in this region that the goal in hand marks: who to find, what to face, which gate to leave by */
async function soughtHere(book: Book, region: Region): Promise<Set<string>> {
    const ids = new Set<string>();
    const goal = await db.query.goals.findFirst({ where: and(eq(goals.bookId, book.id), eq(goals.status, "active")) });
    if (!goal || goal.kind === "tell") return ids;

    const where = await regionOfGoal(goal);
    if (where === null) return ids;
    if (where === region.id) {
        for (const id of [goal.targetCharacterId, goal.targetEnemyId, goal.targetLandmarkId]) {
            if (id) ids.add(id);
        }
        return ids;
    }
    const mine = await db.query.regions.findMany({ where: eq(regions.bookId, book.id), columns: { id: true } });
    const all = await db.query.gates.findMany({ where: inArray(gates.regionId, mine.map((r) => r.id)) });
    const way = firstGateToward(all, region.id, where);
    if (way) ids.add(way.id);
    return ids;
}

/* ------------------------------------------------------------------ */
/* the scene                                                           */
/* ------------------------------------------------------------------ */

export async function getScene(book: Book): Promise<ScenePayload> {
    const region = await regionOf(book);

    // creatures that were bested long enough ago have wandered back
    await db.update(enemies)
        .set({ status: "alive", defeatedAt: null })
        .where(and(
            eq(enemies.regionId, region.id),
            eq(enemies.respawns, true),
            eq(enemies.status, "defeated"),
            lt(enemies.defeatedAt, new Date(Date.now() - RESPAWN_MINUTES * 60_000)),
        ));

    const [houses, things, ways, cast, foes, sought, talked] = await Promise.all([
        db.query.buildings.findMany({ where: eq(buildings.regionId, region.id) }),
        db.query.landmarks.findMany({ where: eq(landmarks.regionId, region.id) }),
        db.query.gates.findMany({ where: eq(gates.regionId, region.id) }),
        db.query.characters.findMany({
            // whoever the story has not brought in yet stands nowhere
            where: and(eq(characters.regionId, region.id), eq(characters.status, "alive"), eq(characters.onstage, true)),
            with: { relationship: true },
        }),
        db.query.enemies.findMany({ where: and(eq(enemies.regionId, region.id), eq(enemies.status, "alive")) }),
        soughtHere(book, region),
        db.query.conversations.findMany({ where: eq(conversations.bookId, book.id) }),
    ]);

    const labelIds = [...new Set(things.flatMap((t) => (t.labelEntryId !== null ? [t.labelEntryId] : [])))];
    const labelEntries = labelIds.length > 0
        ? await db.query.dictEntries.findMany({ where: inArray(dictEntries.id, labelIds) })
        : [];
    const entryById = new Map(labelEntries.map((entry) => [entry.id, entry]));
    const lang = isLangCode(book.targetLanguage) ? book.targetLanguage : "es";
    const met = new Set(talked.filter((c) => c.messageCount > 0).map((c) => c.characterId));

    return {
        region: {
            id: region.id,
            name: region.name,
            kind: region.kind,
            biome: region.biome,
            timeOfDay: region.timeOfDay,
            weather: region.weather,
            seed: region.seed,
            openSides: [...new Set(ways.map((gate) => gate.side as GateSide))].sort(),
            styleKit: book.styleKit,
            description: region.description,
        },
        buildings: houses.map((b) => ({
            id: b.id, kind: b.kind, name: b.name, x: b.x, z: b.z, rot: b.rot,
            width: b.width, depth: b.depth, variant: b.variant,
        })),
        landmarks: things.map((t) => {
            const entry = t.labelEntryId !== null ? entryById.get(t.labelEntryId) : undefined;
            return {
                id: t.id, kind: t.kind, name: t.name, x: t.x, z: t.z, rot: t.rot,
                label: entry ? { entryId: entry.id, text: withArticle(lang, entry), hint: labelHint(lang, entry) } : null,
                examined: t.passageId !== null,
                sought: sought.has(t.id),
            };
        }),
        gates: ways.map((g) => ({ id: g.id, side: g.side as GateSide, x: g.x, z: g.z, rot: g.rot, label: g.label, sought: sought.has(g.id) })),
        characters: cast.map((c) => ({
            id: c.id, name: c.name, role: c.role, mood: c.mood, look: c.look,
            x: c.x, z: c.z, rot: c.facing,
            affinity: c.relationship?.affinity ?? 0,
            barks: c.barks,
            sought: sought.has(c.id),
            met: met.has(c.id),
        })),
        enemies: foes.map((e) => ({
            id: e.id, name: e.name, description: e.description, tier: e.tier, look: e.look,
            x: e.x, z: e.z, sought: sought.has(e.id),
        })),
        hero: { name: book.playerName, look: book.heroLook, x: book.x, z: book.z, rot: book.facing },
    };
}

/** one compact paragraph of "here and now", for any prompt */
export async function sceneBrief(book: Book): Promise<string> {
    if (!book.currentRegionId) return "Nowhere yet.";
    const region = await regionOf(book);
    const [cast, foes, things] = await Promise.all([
        db.query.characters.findMany({ where: and(eq(characters.regionId, region.id), eq(characters.status, "alive"), eq(characters.onstage, true)) }),
        db.query.enemies.findMany({ where: and(eq(enemies.regionId, region.id), eq(enemies.status, "alive")) }),
        db.query.landmarks.findMany({ where: eq(landmarks.regionId, region.id) }),
    ]);

    // nearest first: what the hero can see from where they stand matters most
    const near = <T extends { x: number; z: number }>(list: T[]) =>
        [...list].sort((a, b) => Math.hypot(a.x - book.x, a.z - book.z) - Math.hypot(b.x - book.x, b.z - book.z));

    return [
        `Place: ${region.name} — ${region.biome}, ${region.timeOfDay}${region.weather !== "clear" ? `, ${region.weather}` : ""}. ${region.ambience}`,
        cast.length > 0 ? `People here: ${near(cast).slice(0, 6).map((c) => `${c.name} (${c.role}, ${c.mood})`).join("; ")}.` : "No one else is here.",
        foes.length > 0 ? `Creatures about: ${[...new Set(near(foes).slice(0, 5).map((e) => e.name))].join(", ")}.` : "",
        things.length > 0 ? `Things of note: ${near(things).slice(0, 6).map((t) => t.name).join(", ")}.` : "",
    ].filter(Boolean).join("\n");
}

/**
 * Save where the hero stands and return the book as moved. Position is the
 * one thing the browser decides — walking is smooth because it is local — so
 * it is clamped to the walkable ground rather than trusted.
 */
export async function syncPosition(book: Book, at: { x: number; z: number; rot?: number }): Promise<Book> {
    if (!book.currentRegionId) return book;
    const region = await regionOf(book);
    const spot = clampToReach(await layoutOf(region), { x: at.x, z: at.z });
    const facing = at.rot !== undefined && Number.isFinite(at.rot) ? at.rot : book.facing;
    await db.update(books).set({ x: spot.x, z: spot.z, facing }).where(eq(books.id, book.id));
    return { ...book, x: spot.x, z: spot.z, facing };
}

/** the hero walks through a gate */
export async function travel(book: Book, gateId: string): Promise<{ book: Book; region: Region; firstVisit: boolean }> {
    const gate = await db.query.gates.findFirst({ where: eq(gates.id, gateId) });
    if (!gate || gate.regionId !== book.currentRegionId) throw new Error("That way is not open from here.");
    if (!withinInteractRange({ x: book.x, z: book.z }, gate, 6)) throw new Error("Walk up to the gate first.");

    const target = await db.query.regions.findFirst({ where: eq(regions.id, gate.targetRegionId) });
    if (!target || target.bookId !== book.id) throw new Error("That road leads nowhere.");

    const firstVisit = !target.visited;
    await db.update(books).set({
        currentRegionId: target.id, x: gate.targetX, z: gate.targetZ, facing: gate.targetFacing,
    }).where(eq(books.id, book.id));
    if (firstVisit) await db.update(regions).set({ visited: true }).where(eq(regions.id, target.id));

    return {
        book: { ...book, currentRegionId: target.id, x: gate.targetX, z: gate.targetZ, facing: gate.targetFacing },
        region: { ...target, visited: true },
        firstVisit,
    };
}

/* ------------------------------------------------------------------ */
/* keys for prompts                                                    */
/* ------------------------------------------------------------------ */

/** everything a goal may point at, under the keys the model is given */
export type WorldRefs = {
    people: Map<string, Character>;
    creatures: Map<string, Enemy>;
    places: Map<string, Region>;
    houses: Map<string, Building>;
    things: Map<string, Landmark>;
};

export type WorldKeys = WorldRefs & {
    /** everyone ever written into the book, in the order the bible lists them: keys never shift */
    cast: Character[];
    /** the briefs themselves, ready to paste into a prompt */
    peopleBrief: string;
    creaturesBrief: string;
    placesBrief: string;
    buildingsBrief: string;
    thingsBrief: string;
};

/**
 * Everything in the book the model may refer to, under short keys. People
 * and places use the same keys as the book's bible, so a prompt is consistent
 * from its first line to its last.
 *
 * Someone who has left the story keeps their key and is said to have left:
 * were they dropped from the list, everyone after them would change keys, and
 * the planner would not know that they are gone.
 */
export async function worldKeys(book: Book): Promise<WorldKeys> {
    const places = await db.query.regions.findMany({ where: eq(regions.bookId, book.id), orderBy: [asc(regions.sortIndex)] });
    const placeIds = places.map((r) => r.id);
    const [cast, foes, things, houses] = await Promise.all([
        db.query.characters.findMany({ where: eq(characters.bookId, book.id) }),
        db.query.enemies.findMany({
            where: and(eq(enemies.bookId, book.id), eq(enemies.status, "alive")),
            orderBy: [asc(enemies.regionId), asc(enemies.id)],
        }),
        placeIds.length > 0
            ? db.query.landmarks.findMany({ where: inArray(landmarks.regionId, placeIds), orderBy: [asc(landmarks.regionId), asc(landmarks.id)] })
            : Promise.resolve([] as Landmark[]),
        placeIds.length > 0
            ? db.query.buildings.findMany({ where: inArray(buildings.regionId, placeIds), orderBy: [asc(buildings.regionId), asc(buildings.id)] })
            : Promise.resolve([] as Building[]),
    ]);

    const placeKey = new Map(places.map((r) => [r.id, r.key]));
    const people = castKeys(cast);
    const creatures = new Map<string, Enemy>(foes.map((e, i) => [`e${i + 1}`, e]));
    const thingsByKey = new Map<string, Landmark>(things.map((t, i) => [`l${i + 1}`, t]));
    // only buildings with a name of their own are worth walking to: "house" is not somewhere a story sends anyone
    const named = houses.filter((h) => h.name.trim().toLowerCase() !== h.kind.toLowerCase());
    const housesByKey = new Map<string, Building>(named.map((h, i) => [`b${i + 1}`, h]));

    const tastes = (c: Character) => [
        c.likes.length > 0 ? `likes: ${c.likes.join(", ")}` : "",
        c.dislikes.length > 0 ? `dislikes: ${c.dislikes.join(", ")}` : "",
    ].filter(Boolean).join("; ");

    return {
        cast,
        people,
        creatures,
        places: new Map(places.map((r) => [r.key, r])),
        houses: housesByKey,
        things: thingsByKey,
        peopleBrief: [...people].map(([key, c]) => {
            if (c.status !== "alive") return `- ${key}: ${c.name}, ${c.role} — HAS LEFT THE STORY: nothing can be asked of them`;
            const where = `in ${placeKey.get(c.regionId ?? "") ?? "?"}${c.onstage ? "" : ", not yet in the story"}`;
            return `- ${key}: ${c.name}, ${c.role} — ${where}; wants: ${c.goal || "nothing in particular"}${tastes(c) ? `; ${tastes(c)}` : ""}`;
        }).join("\n"),
        creaturesBrief: [...creatures].map(([key, e]) =>
            `- ${key}: ${e.name} (${e.tier === "boss" ? "THE BOSS" : e.tier}) — ${e.description} In ${placeKey.get(e.regionId) ?? "?"}.`).join("\n"),
        placesBrief: places.map((r) => `- ${r.key}: ${r.name} (${r.kind}${r.visited ? "" : ", not yet visited"})`).join("\n"),
        buildingsBrief: [...housesByKey].map(([key, h]) => `- ${key}: ${h.name} (${/^[aeiou]/.test(h.kind) ? "an" : "a"} ${h.kind}) in ${placeKey.get(h.regionId) ?? "?"}`).join("\n"),
        thingsBrief: [...thingsByKey].map(([key, t]) =>
            `- ${key}: ${t.name} (a ${t.kind}) in ${placeKey.get(t.regionId) ?? "?"}`).join("\n"),
    };
}
