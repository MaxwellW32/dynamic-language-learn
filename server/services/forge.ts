import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
    books, buildings, chapters, characters, conversations, enemies, events, gates, landmarks,
    regions, relationships,
    type Book, type BookBrief, type Region,
} from "@/db/schema";
import type { ChallengeType } from "@/game/challenges/types";
import { isLangCode, languageOf, type LangCode } from "@/game/languages";
import {
    isBiome, isTimeOfDay, isWeather, LANDMARK_KIND_LIST, sanitizeCreature, sanitizeLook,
    type ActorLook, type LandmarkKind,
} from "@/game/looks";
import {
    generateLayout, OPPOSITE, type GateSide, type RegionKind, type RegionLayout,
} from "@/game/worldgen/layout";
import { hash2, hashString } from "@/game/worldgen/rng";
import type { AiContext } from "../ai/client";
import { writeSeed, writeWorld, type FillBrief } from "../ai/prompts/forge";
import type { RegionSketch, WorldFill } from "../ai/schemas";
import { personValues } from "./cast";
import { getLearner } from "./learning";
import { canSpend } from "./wallet";
import { labelsForKinds } from "./worldWords";
import { sparksFor } from "@/game/sparks";

/** what each tier of creature may throw at the hero */
export const TIER_CHALLENGES: Record<"minion" | "elite" | "boss", ChallengeType[]> = {
    minion: ["meaningMatch", "reverseMatch", "listening", "spelling"],
    elite: ["meaningMatch", "reverseMatch", "matching", "listening", "fillBlank", "spelling"],
    boss: ["meaningMatch", "reverseMatch", "matching", "listening", "fillBlank", "spelling", "sentenceOrder"],
};

/** how many people and creatures a new region of each kind is given */
const POPULATION: Record<RegionKind, { people: number; creatures: number }> = {
    settlement: { people: 5, creatures: 2 },
    wilds: { people: 2, creatures: 6 },
    depths: { people: 1, creatures: 5 },
};

/** what the waiting reader is told the storyteller is doing */
export async function forgeNote(bookId: string, text: string): Promise<void> {
    await db.update(books).set({ forgeNote: text }).where(eq(books.id, bookId));
}

/** wipe whatever a failed forge left behind, so a retry starts clean */
async function clearWorld(bookId: string): Promise<void> {
    await db.update(books).set({ currentRegionId: null }).where(eq(books.id, bookId));
    // buildings, landmarks, gates, characters and their memories, enemies and encounters all hang off regions and the book;
    // goals and pages hang off chapters
    await db.delete(conversations).where(eq(conversations.bookId, bookId));
    await db.delete(characters).where(eq(characters.bookId, bookId));
    await db.delete(enemies).where(eq(enemies.bookId, bookId));
    await db.delete(chapters).where(eq(chapters.bookId, bookId));
    await db.delete(events).where(eq(events.bookId, bookId));
    await db.delete(regions).where(eq(regions.bookId, bookId));
}

/* ------------------------------------------------------------------ */
/* creating the book                                                   */
/* ------------------------------------------------------------------ */

export async function createBook(userId: string, input: {
    language: LangCode;
    startingLevel: number;
    immersionBias: number;
    playerName: string;
    heroLook: ActorLook;
    brief: BookBrief;
}): Promise<string> {
    const user = await db.query.users.findFirst({ where: (u, { eq: same }) => same(u.id, userId) });
    if (!user) throw new Error("Account not found.");
    const spend = canSpend(user);
    if (!spend.ok) throw new Error(spend.message);

    // the learner's starting point is set by their first book in a language, and kept after that
    await getLearner(userId, input.language, { startingLevel: input.startingLevel, immersionBias: input.immersionBias });

    const playerName = input.playerName.trim().slice(0, 40) || "Wanderer";
    const [book] = await db.insert(books).values({
        userId,
        title: "An Unwritten Tale",
        brief: {
            genre: input.brief.genre.trim().slice(0, 60) || "cozy fantasy",
            tone: input.brief.tone.trim().slice(0, 60) || "warm, adventurous",
            wish: input.brief.wish.trim().slice(0, 500),
        },
        targetLanguage: input.language,
        playerName,
        heroLook: sanitizeLook(input.heroLook),
        worldSeed: hashString(`${userId}:${Date.now()}:${playerName}`) | 0,
        styleKit: languageOf(input.language).styleKit,
        status: "forging",
    }).returning();
    return book.id;
}

/* ------------------------------------------------------------------ */
/* regions                                                             */
/* ------------------------------------------------------------------ */

type Slotted = {
    people: { key: string; region: Region; x: number; z: number; rot: number; where: string }[];
    creatures: { key: string; region: Region; x: number; z: number; tier: "minion" | "elite" | "boss" }[];
    things: { key: string; region: Region; x: number; z: number; rot: number; suggested: LandmarkKind[] }[];
    houses: { key: string; region: Region; kind: string; x: number; z: number; rot: number; width: number; depth: number; variant: number }[];
};

/** choose the spots in a region's layout that will be filled, and give each a key */
function slot(region: Region, layout: RegionLayout, into: Slotted): void {
    const population = POPULATION[region.kind];

    layout.plots.forEach((plot) => {
        into.houses.push({
            key: `b${into.houses.length + 1}`, region, kind: plot.kind,
            x: plot.x, z: plot.z, rot: plot.rot, width: plot.width, depth: plot.depth, variant: plot.variant,
        });
    });

    layout.npcSlots.slice(0, population.people).forEach((spot, i) => {
        const plot = layout.plots[i];
        const where = region.kind === "settlement" && plot && i < 8
            ? `outside the ${plot.kind}`
            : region.kind === "settlement" ? "in the plaza"
            : region.kind === "wilds" ? (i === 0 ? "at the camp" : "in a clearing")
            : "just inside the way in";
        into.people.push({ key: `n${into.people.length + 1}`, region, x: spot.x, z: spot.z, rot: spot.rot, where });
    });

    layout.mobSlots.slice(0, population.creatures).forEach((spot) => {
        into.creatures.push({ key: `e${into.creatures.length + 1}`, region, x: spot.x, z: spot.z, tier: spot.tier });
    });
    if (layout.bossSlot) {
        into.creatures.push({ key: `e${into.creatures.length + 1}`, region, x: layout.bossSlot.x, z: layout.bossSlot.z, tier: "boss" });
    }

    layout.landmarkSlots.slice(0, 8).forEach((spot) => {
        into.things.push({ key: `l${into.things.length + 1}`, region, x: spot.x, z: spot.z, rot: spot.rot, suggested: spot.suggested });
    });
}

function fillBrief(slotted: Slotted): FillBrief {
    return {
        people: slotted.people.map((p) => `- ${p.key}: in ${p.region.key} (${p.region.name}), ${p.where}`).join("\n") || "(none)",
        creatures: slotted.creatures.map((c) =>
            `- ${c.key}: ${c.tier === "boss" ? "THE BOSS of the story" : `a${c.tier === "elite" ? "n elite" : " minion"}`} in ${c.region.key} (${c.region.name})`).join("\n") || "(none)",
        landmarks: slotted.things.map((t) => `- ${t.key}: in ${t.region.key} (${t.region.name}) — one of: ${t.suggested.join(", ")}`).join("\n") || "(none)",
        buildings: slotted.houses.map((h) => `- ${h.key}: ${/^[aeiou]/.test(h.kind) ? "an" : "a"} ${h.kind} in ${h.region.key}`).join("\n") || "(none)",
    };
}

async function insertRegion(book: Book, key: string, kind: RegionKind, sketch: RegionSketch, sortIndex: number): Promise<Region> {
    const [region] = await db.insert(regions).values({
        bookId: book.id,
        key,
        name: sketch.name.trim().slice(0, 60),
        kind,
        biome: isBiome(sketch.biome) ? sketch.biome : kind === "settlement" ? "meadow" : kind === "wilds" ? "forest" : "crystal",
        timeOfDay: isTimeOfDay(sketch.timeOfDay) ? sketch.timeOfDay : kind === "depths" ? "night" : "day",
        weather: isWeather(sketch.weather) ? sketch.weather : "clear",
        seed: hash2(book.worldSeed, sortIndex + 1, hashString(key)) | 0,
        ambience: sketch.ambience.trim().slice(0, 300),
        description: sketch.description.trim().slice(0, 400),
        themeWords: sketch.themeWords.map((w) => w.toLowerCase().trim()).filter((w) => w.length > 1).slice(0, 8),
        sortIndex,
    }).returning();
    return region;
}

/** join two regions with a gate on each side */
async function joinRegions(a: Region, sideA: GateSide, b: Region, openA: GateSide[], openB: GateSide[]): Promise<void> {
    const sideB = OPPOSITE[sideA];
    const layoutA = generateLayout({ seed: a.seed, kind: a.kind, biome: a.biome as never, gates: openA });
    const layoutB = generateLayout({ seed: b.seed, kind: b.kind, biome: b.biome as never, gates: openB });
    const gateA = layoutA.gates[sideA];
    const gateB = layoutB.gates[sideB];
    await db.insert(gates).values([
        {
            regionId: a.id, side: sideA, x: gateA.x, z: gateA.z, rot: gateA.rot, label: `To ${b.name}`,
            targetRegionId: b.id, targetX: gateB.arrival.x, targetZ: gateB.arrival.z, targetFacing: gateB.arrival.rot,
        },
        {
            regionId: b.id, side: sideB, x: gateB.x, z: gateB.z, rot: gateB.rot, label: `To ${a.name}`,
            targetRegionId: a.id, targetX: gateA.arrival.x, targetZ: gateA.arrival.z, targetFacing: gateA.arrival.rot,
        },
    ]);
}

/**
 * Write what the model invented into the world, in the spots that were chosen
 * for it. The four kinds of thing are written side by side: they do not depend
 * on one another, and a world is many rows.
 */
async function populate(book: Book, lang: LangCode, slotted: Slotted, fill: WorldFill, castBase: number): Promise<void> {
    await Promise.all([
        raiseBuildings(slotted, fill),
        placeLandmarks(lang, slotted, fill),
        settlePeople(book, lang, slotted, fill, castBase),
        looseCreatures(book, slotted, fill),
    ]);
}

async function raiseBuildings(slotted: Slotted, fill: WorldFill): Promise<void> {
    const named = new Map(fill.buildings.map((b) => [b.key, b.name]));
    if (slotted.houses.length > 0) {
        await db.insert(buildings).values(slotted.houses.map((h) => ({
            regionId: h.region.id, kind: h.kind,
            name: (named.get(h.key) ?? h.kind).trim().slice(0, 60),
            x: h.x, z: h.z, rot: h.rot, width: h.width, depth: h.depth, variant: h.variant,
        })));
    }
}

async function placeLandmarks(lang: LangCode, slotted: Slotted, fill: WorldFill): Promise<void> {
    const things = new Map(fill.landmarks.map((l) => [l.key, l]));
    const chosenKinds = slotted.things.map((spot) => {
        const made = things.get(spot.key);
        // the model may only choose among the kinds that suit the spot
        const kind = made && (spot.suggested as string[]).includes(made.kind) ? made.kind
            : made && (LANDMARK_KIND_LIST as string[]).includes(made.kind) && spot.suggested.length === 0 ? made.kind
            : spot.suggested[0];
        return { spot, made, kind };
    });
    const labels = await labelsForKinds(lang, [...new Set(chosenKinds.map((c) => c.kind))]);
    if (chosenKinds.length > 0) {
        await db.insert(landmarks).values(chosenKinds.map(({ spot, made, kind }) => ({
            regionId: spot.region.id, kind,
            name: (made?.name ?? kind).trim().slice(0, 60),
            lore: (made?.lore ?? "").trim().slice(0, 500),
            x: spot.x, z: spot.z, rot: spot.rot,
            labelEntryId: labels.get(kind)?.entryId ?? null,
        })));
    }
}

async function settlePeople(book: Book, lang: LangCode, slotted: Slotted, fill: WorldFill, castBase: number): Promise<void> {
    const cast = new Map(fill.cast.map((c) => [c.key, c]));
    // explicit, increasing timestamps: the order people were made in is the order the bible lists them in,
    // whatever order their rows happen to be written in
    const base = Date.now() + castBase;
    await Promise.all(slotted.people.map(async (spot, i) => {
        const made = cast.get(spot.key);
        if (!made) return;
        const [row] = await db.insert(characters).values({
            bookId: book.id, regionId: spot.region.id,
            x: spot.x, z: spot.z, facing: spot.rot,
            ...(await personValues(book.id, lang, made, spot.key)),
            createdAt: new Date(base + i),
        }).returning();
        await db.insert(relationships).values({ characterId: row.id });
    }));
}

async function looseCreatures(book: Book, slotted: Slotted, fill: WorldFill): Promise<void> {
    const beasts = new Map(fill.creatures.map((c) => [c.key, c]));
    const rows = slotted.creatures.flatMap((spot) => {
        const made = beasts.get(spot.key);
        if (!made) return [];
        return [{
            bookId: book.id, regionId: spot.region.id, x: spot.x, z: spot.z,
            name: made.name.trim().slice(0, 50),
            description: made.description.trim().slice(0, 300),
            tier: spot.tier,
            look: sanitizeCreature({ kind: made.kind, tint: made.tint, scale: 1 }, spot.tier, hashString(`${book.id}:${spot.key}`)),
            introLine: made.introLine.trim().slice(0, 240),
            defeatLine: made.defeatLine.trim().slice(0, 240),
            challengeTypes: TIER_CHALLENGES[spot.tier],
            // ordinary creatures return; a quest that names one will pin it (see persistQuests)
            respawns: spot.tier === "minion",
        }];
    });
    if (rows.length > 0) await db.insert(enemies).values(rows);
}

/* ------------------------------------------------------------------ */
/* the forge                                                           */
/* ------------------------------------------------------------------ */

/** claim the making of a book: a second caller gets false, and leaves */
export async function claimForge(book: Pick<Book, "id">): Promise<boolean> {
    const claimed = await db.update(books)
        .set({ forgeNote: "Summoning the storyteller…" })
        .where(and(eq(books.id, book.id), eq(books.status, "forging"), inArray(books.forgeNote, ["", "failed"])))
        .returning();
    return claimed.length > 0;
}

export async function failForge(bookId: string): Promise<void> {
    await forgeNote(bookId, "failed");
}

/**
 * Make the world of a new book: its idea, its three places, and who and what
 * is in them. Geometry comes from the seeded layouts; the model names and
 * fills. Three story-tier calls, two of them side by side.
 *
 * The book is left "forging": its story has yet to be outlined and begun
 * (`beginStory` in server/services/story.ts).
 */
export async function buildWorld(ctx: AiContext, book: Book): Promise<{ book: Book; home: Region }> {
    const lang: LangCode = isLangCode(book.targetLanguage) ? book.targetLanguage : "es";
    await clearWorld(book.id);
    const learner = await getLearner(book.userId, lang);

    /* 1 — the idea */
    const seed = await writeSeed(ctx, {
        playerName: book.playerName,
        targetLanguage: lang,
        brief: book.brief,
        startingLevel: learner.startingLevel,
        sparks: sparksFor(book.worldSeed),
    });
    const facts = seed.facts.map((fact) => `- ${fact.trim()}`).join("\n");
    const bible = `What is true of this world:\n${facts}\n\nWhat the book is really about (never state it outright): ${seed.heart.trim()}`;
    await db.update(books).set({
        title: seed.title.trim().slice(0, 80),
        premise: seed.premise.trim(),
        tone: seed.tone.trim().slice(0, 100),
        bible,
        belongings: [],
        forgeNote: "Drawing the maps…",
    }).where(eq(books.id, book.id));
    const named: Book = { ...book, title: seed.title.trim(), premise: seed.premise.trim(), tone: seed.tone.trim(), bible, belongings: [] };

    /* 2 — three places, joined west to east */
    const [home, wilds, depths] = await Promise.all([
        insertRegion(named, "r1", "settlement", seed.home, 0),
        insertRegion(named, "r2", "wilds", seed.wilds, 1),
        insertRegion(named, "r3", "depths", seed.depths, 2),
    ]);
    const open: Record<string, GateSide[]> = { r1: ["e"], r2: ["e", "w"], r3: ["w"] };
    await Promise.all([
        joinRegions(home, "e", wilds, open.r1, open.r2),
        joinRegions(wilds, "e", depths, open.r2, open.r3),
    ]);

    const slotted: Slotted = { people: [], creatures: [], things: [], houses: [] };
    for (const region of [home, wilds, depths]) {
        slot(region, generateLayout({ seed: region.seed, kind: region.kind, biome: region.biome as never, gates: open[region.key] }), slotted);
    }

    /* 3 — who and what is there */
    await forgeNote(book.id, "Waking the villagers…");
    const fill = await writeWorld(ctx, {
        seed,
        playerName: book.playerName,
        targetLanguage: lang,
        places: [home, wilds, depths].map((r) => `- ${r.key}: ${r.name} — ${r.kind}, ${r.biome}, ${r.timeOfDay}. ${r.description}`).join("\n"),
        brief: fillBrief(slotted),
    });
    await populate(named, lang, slotted, fill, 0);

    // the hero stands at the door of the story before it is written: whoever plans it must know where they are
    const spawn = generateLayout({ seed: home.seed, kind: home.kind, biome: home.biome as never, gates: open.r1 }).spawn;
    await db.update(regions).set({ visited: true }).where(eq(regions.id, home.id));
    await db.update(books).set({
        currentRegionId: home.id, x: spawn.x, z: spawn.z, facing: spawn.rot,
    }).where(eq(books.id, book.id));
    await db.insert(events).values({
        bookId: book.id, kind: "arrival", importance: 4, regionId: home.id,
        summary: `${book.playerName} arrived in ${home.name}, and the story began.`,
    });

    return {
        book: { ...named, currentRegionId: home.id, x: spawn.x, z: spawn.z, facing: spawn.rot },
        home: { ...home, visited: true },
    };
}

/* ------------------------------------------------------------------ */
/* a world that grows                                                  */
/* ------------------------------------------------------------------ */

const SIDES: GateSide[] = ["n", "s", "w", "e"];

/** a side of some existing region that nothing is joined to yet, settlements first */
export async function freeSide(bookId: string): Promise<{ region: Region; side: GateSide; open: GateSide[] } | null> {
    const places = await db.query.regions.findMany({ where: eq(regions.bookId, bookId), with: { gates: true } });
    const order: RegionKind[] = ["settlement", "wilds", "depths"];
    places.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.sortIndex - b.sortIndex);
    for (const place of places) {
        // the depths stay a dead end: the way in is the way out
        if (place.kind === "depths") continue;
        const taken = place.gates.map((gate) => gate.side as GateSide);
        const side = SIDES.find((candidate) => !taken.includes(candidate));
        if (side) return { region: place, side, open: taken };
    }
    return null;
}

/**
 * Add a place to a book already under way: a chapter began and the story
 * needed somewhere new. Two story-tier calls, side by side, fill it.
 */
export async function forgeRegion(ctx: AiContext, book: Book, sketch: RegionSketch & { kind: RegionKind }): Promise<Region | null> {
    const room = await freeSide(book.id);
    if (!room) return null;
    const lang: LangCode = isLangCode(book.targetLanguage) ? book.targetLanguage : "es";

    const existing = await db.query.regions.findMany({ where: eq(regions.bookId, book.id) });
    const key = `r${existing.length + 1}`;
    const region = await insertRegion(book, key, sketch.kind, sketch, existing.length);
    const open: GateSide[] = [OPPOSITE[room.side]];

    // opening a gate reshapes the older region's paths: its layout is rebuilt from the same seed with one more way out
    await joinRegions(room.region, room.side, region, [...room.open, room.side], open);

    const slotted: Slotted = { people: [], creatures: [], things: [], houses: [] };
    slot(region, generateLayout({ seed: region.seed, kind: region.kind, biome: region.biome as never, gates: open }), slotted);

    // whoever is written now must not share a name with anyone the reader has already met
    const [cast, beasts] = await Promise.all([
        db.query.characters.findMany({ where: eq(characters.bookId, book.id) }),
        db.query.enemies.findMany({ where: eq(enemies.bookId, book.id) }),
    ]);
    const known = [
        `Already in the book, and not to be written again: ${cast.map((c) => `${c.name} (${c.role})`).join("; ") || "nobody yet"}.`,
        beasts.length > 0 ? `Its creatures so far: ${[...new Set(beasts.map((e) => e.name))].join("; ")}.` : "",
        "Everyone and everything you create now is new to the story: give each a name, first name and family name alike, that no one above bears, and give the people some tie to those who are already here.",
    ].filter(Boolean).join("\n");

    const fill = await writeWorld(ctx, {
        seed: {
            title: book.title, premise: book.premise, tone: book.tone,
            heart: book.bible.split("never state it outright): ")[1]?.trim() ?? "",
            facts: book.bible.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2)),
        },
        playerName: book.playerName,
        targetLanguage: lang,
        places: `- ${region.key}: ${region.name} — ${region.kind}, ${region.biome}, ${region.timeOfDay}. ${region.description}\n\n${known}`,
        brief: fillBrief(slotted),
    });
    // later than anyone already in the book, so existing keys do not shift
    await populate(book, lang, slotted, fill, 1000);
    return region;
}
