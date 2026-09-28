import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
    buildings, characters, conversations, landmarks, regions, relationships,
    type Book, type Character, type Region,
} from "@/db/schema";
import type { LangCode } from "@/game/languages";
import { sanitizeLook, sanitizeVoice } from "@/game/looks";
import type { PersonView } from "@/game/payloads";
import { standingSpot } from "@/game/worldgen/spots";
import { hashString } from "@/game/worldgen/rng";
import type { CastMember, NewPerson } from "../ai/schemas";
import { lineToSegments } from "../ai/segments";
import { layoutOf } from "./scene";

/**
 * The people of a book after it has been made: those the story writes in
 * later, where they stand, where they go, and who the hero has met.
 */

const tidy = (list: string[], each = 60, most = 3) =>
    [...new Set(list.map((item) => item.trim().replace(/\.$/, "")).filter((item) => item.length > 1))]
        .slice(0, most).map((item) => item.slice(0, each));

/** the columns of a person, from what the model wrote of them */
export async function personValues(bookId: string, lang: LangCode, made: CastMember, key: string) {
    const seed = hashString(`${bookId}:${key}:${made.name}`);
    const barks = (await Promise.all(made.barks.slice(0, 3).map((bark) =>
        lineToSegments(lang, bark.target, bark.translation, true)))).filter((segments) => segments.length > 0);
    return {
        name: made.name.trim().slice(0, 40),
        role: made.role.trim().slice(0, 60),
        personality: made.personality.trim().slice(0, 300),
        appearance: made.appearance.trim().slice(0, 300),
        backstory: made.backstory.trim().slice(0, 600),
        secret: made.secret.trim().slice(0, 300),
        goal: made.goal.trim().slice(0, 200),
        speechStyle: made.speechStyle.trim().slice(0, 200),
        likes: tidy(made.likes),
        dislikes: tidy(made.dislikes),
        look: sanitizeLook(made.look, seed),
        voiceId: sanitizeVoice(made.voice, seed),
        barks,
    };
}

/** somewhere in a region for one more person to stand */
async function spotIn(region: Region, except?: string): Promise<{ x: number; z: number; rot: number }> {
    const [layout, folk, things, houses] = await Promise.all([
        layoutOf(region),
        // whoever is written for this place has their spot kept, on stage or not
        db.query.characters.findMany({
            where: and(eq(characters.regionId, region.id), eq(characters.status, "alive"), except ? ne(characters.id, except) : undefined),
        }),
        db.query.landmarks.findMany({ where: eq(landmarks.regionId, region.id) }),
        db.query.buildings.findMany({ where: eq(buildings.regionId, region.id) }),
    ]);
    return standingSpot(
        layout,
        folk,
        [
            ...things.map((thing) => ({ x: thing.x, z: thing.z, r: 2 })),
            ...houses.map((house) => ({ x: house.x, z: house.z, r: Math.max(house.width, house.depth) / 2 + 0.5 })),
        ],
    );
}

/**
 * Write new people into the book. They are given somewhere to stand at once,
 * but stay off stage: nobody can see or speak to them until the goal that
 * brings them in comes due (`enters`).
 */
export async function addPeople(
    book: Book, lang: LangCode, people: NewPerson[], places: Map<string, Region>,
): Promise<Map<string, Character>> {
    const added = new Map<string, Character>();
    if (people.length === 0) return added;
    const existing = await db.query.characters.findMany({ where: eq(characters.bookId, book.id) });
    const names = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    // after everyone already in the book, so that nobody's key shifts
    let at = Math.max(Date.now(), ...existing.map((c) => c.createdAt.getTime())) + 1;
    const home = book.currentRegionId ? [...places.values()].find((r) => r.id === book.currentRegionId) : undefined;

    for (const made of people.slice(0, 2)) {
        const name = made.name.trim().toLowerCase();
        // a second person of the same name would be a mistake, and a confusing one
        if (name.length === 0 || names.has(name)) continue;
        const region = places.get(made.placeKey) ?? home ?? [...places.values()][0];
        if (!region) continue;
        const spot = await spotIn(region);
        const [row] = await db.insert(characters).values({
            bookId: book.id, regionId: region.id,
            x: spot.x, z: spot.z, facing: spot.rot,
            ...(await personValues(book.id, lang, made, made.key)),
            onstage: false,
            createdAt: new Date(at++),
        }).returning();
        await db.insert(relationships).values({ characterId: row.id });
        names.add(name);
        added.set(made.key, row);
    }
    return added;
}

/** bring people into the story: from now on they stand in the world and can be met */
export async function bringOnstage(ids: string[]): Promise<void> {
    for (const id of new Set(ids)) {
        await db.update(characters).set({ onstage: true }).where(and(eq(characters.id, id), eq(characters.onstage, false)));
    }
}

/** the story moves someone: to another place, or out of the book */
export async function movePerson(bookId: string, characterId: string, toRegionId: string | null): Promise<void> {
    const who = await db.query.characters.findFirst({ where: eq(characters.id, characterId) });
    if (!who || who.bookId !== bookId) return;
    if (toRegionId === null) {
        await db.update(characters).set({ status: "gone" }).where(eq(characters.id, who.id));
        return;
    }
    if (who.regionId === toRegionId && who.status === "alive") return;
    const region = await db.query.regions.findFirst({ where: eq(regions.id, toRegionId) });
    if (!region || region.bookId !== bookId) return;
    const spot = await spotIn(region, who.id);
    await db.update(characters)
        .set({ regionId: region.id, x: spot.x, z: spot.z, facing: spot.rot, status: "alive", onstage: true })
        .where(eq(characters.id, who.id));
}

/** everyone the hero has met, for the journal: they can be written to from anywhere */
export async function getPeople(book: Pick<Book, "id" | "currentRegionId">): Promise<PersonView[]> {
    const [cast, talks, places] = await Promise.all([
        db.query.characters.findMany({
            where: eq(characters.bookId, book.id),
            orderBy: [asc(characters.createdAt)],
            with: { relationship: true },
        }),
        db.query.conversations.findMany({ where: eq(conversations.bookId, book.id) }),
        db.query.regions.findMany({ where: eq(regions.bookId, book.id) }),
    ]);
    const lines = new Map(talks.map((talk) => [talk.characterId, talk.messageCount]));
    const lastAt = new Map(talks.map((talk) => [talk.characterId, talk.lastMessageAt.getTime()]));
    const placeName = new Map(places.map((r) => [r.id, r.name]));

    return cast
        .filter((c) => (lines.get(c.id) ?? 0) > 0)
        .sort((a, b) => (lastAt.get(b.id) ?? 0) - (lastAt.get(a.id) ?? 0))
        .map((c) => ({
            id: c.id,
            name: c.name,
            role: c.role,
            mood: c.mood,
            affinity: c.relationship?.affinity ?? 0,
            likes: c.likes,
            dislikes: c.dislikes,
            whereName: c.regionId ? placeName.get(c.regionId) ?? null : null,
            here: c.regionId !== null && c.regionId === book.currentRegionId,
            gone: c.status !== "alive",
            lines: lines.get(c.id) ?? 0,
        }));
}
