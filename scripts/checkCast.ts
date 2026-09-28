/**
 * People who come into a story after it has begun: written in, kept off stage
 * until the goal that brings them in comes due, moved from place to place,
 * and gone when the story says so. This walks one made-up person through all
 * of that in a book of the test player's, checks the world after each step,
 * and takes them out again. No model is called and nothing is left behind.
 *
 *   npx tsx --conditions=react-server scripts/checkCast.ts [--book=<id>]
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { books, buildings, characters, goals, regions, users } from "../db/schema";
import { isLangCode } from "../game/languages";
import { DEFAULT_LOOK } from "../game/looks";
import { testAccounts } from "../lib/testMode";
import type { NewPerson } from "../server/ai/schemas";
import { addPeople, bringOnstage, getPeople, movePerson } from "../server/services/cast";
import { chapterInHand, chaptersOf, goalsOf, persistGoals, settle, standingTell, storyState } from "../server/services/goals";
import { getScene, worldKeys } from "../server/services/scene";

const reuse = process.argv.find((a) => a.startsWith("--book="))?.split("=")[1];
let failed = 0;
const check = (what: string, ok: boolean, detail = "") => {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};

const stranger: NewPerson = {
    key: "new1",
    name: "Quillon Testwright",
    role: "travelling test pilot",
    personality: "Patient, exact, fond of lists.",
    appearance: "A tall figure in a grey coat, carrying a clipboard.",
    backstory: "Came to see whether the world holds together.",
    secret: "Is not from this book at all.",
    goal: "To be placed somewhere sensible.",
    speechStyle: "Short sentences. Counts things aloud.",
    likes: ["being asked what was checked", "tidy rows"],
    dislikes: ["being stood in a wall", "vagueness"],
    look: { ...DEFAULT_LOOK },
    voice: "alloy",
    barks: [],
    placeKey: "r1",
};

async function main() {
    const player = await db.query.users.findFirst({ where: eq(users.email, testAccounts.player.email) });
    if (!player) throw new Error("No test player — run: npm run test:seed");
    const book = reuse
        ? await db.query.books.findFirst({ where: and(eq(books.id, reuse), eq(books.userId, player.id)) })
        : await db.query.books.findFirst({ where: and(eq(books.userId, player.id), eq(books.status, "active")), orderBy: [desc(books.updatedAt)] });
    if (!book) throw new Error("The test player has no book to check. Make one: npx tsx --conditions=react-server scripts/checkStory.ts --keep");
    const lang = isLangCode(book.targetLanguage) ? book.targetLanguage : "es";
    console.log(`"${book.title}"`);

    const keys = await worldKeys(book);
    const places = [...keys.places.values()];
    const home = keys.places.get("r1")!;
    const elsewhere = places.find((region) => region.id !== home.id);
    const before = await db.query.characters.findMany({ where: eq(characters.bookId, book.id) });
    const keysBefore = [...keys.people].map(([key, who]) => `${key}:${who.id}`).join(",");

    // leftovers of a run that was cut short
    await db.delete(characters).where(and(eq(characters.bookId, book.id), eq(characters.name, stranger.name)));

    console.log("\nwritten in");
    const added = await addPeople(book, lang, [stranger], keys.places);
    const who = added.get("new1");
    check("the person was written into the book", who !== undefined);
    if (!who) throw new Error("nothing more can be checked");
    try {
        check("they are off stage until brought in", who.onstage === false);
        check("they were given their likes and dislikes", who.likes.length === 2 && who.dislikes.length === 2);
        check("a second person of the same name is not written", (await addPeople(book, lang, [stranger], keys.places)).size === 0);

        const homeBook = { ...book, currentRegionId: home.id };
        let scene = await getScene(homeBook);
        check("off stage, they are not in the world", !scene.characters.some((c) => c.id === who.id));
        const after = await worldKeys(book);
        check("nobody else's key shifted", [...after.people].slice(0, keys.people.size).map(([key, c]) => `${key}:${c.id}`).join(",") === keysBefore);
        check("they have the last key", [...after.people].pop()?.[1].id === who.id, [...after.people].pop()?.[0]);
        check("the planner is told they are not yet in the story", after.peopleBrief.includes(`${stranger.name}, ${stranger.role} — in r1, not yet in the story`));

        const folk = before.filter((c) => c.regionId === home.id && c.status === "alive");
        const houses = await db.query.buildings.findMany({ where: eq(buildings.regionId, home.id) });
        const nearest = Math.min(...folk.map((c) => Math.hypot(c.x - who.x, c.z - who.z)));
        check("they stand clear of everyone", nearest > 1.5, `${nearest.toFixed(1)} m from the nearest person`);
        check("they stand outside every building", houses.every((h) => Math.hypot(h.x - who.x, h.z - who.z) >= Math.min(h.width, h.depth) / 2));

        console.log("\nbrought in by a goal");
        const chapter = chapterInHand(await chaptersOf(book.id));
        if (!chapter) throw new Error("the book has no chapter in hand");
        const list = await goalsOf(chapter.id);
        const last = Math.max(0, ...list.map((goal) => goal.sortIndex));
        const refs = { ...after };
        refs.people.set("new1", who);
        const kept = await persistGoals(homeBook, chapter, [
            { kind: "talk", title: "Speak with the test pilot", brief: "A check.", targetKey: "new1", gains: "a stamped clipboard", enters: ["new1"], moves: elsewhere ? [{ who: "new1", to: elsewhere.key }] : [] },
            { kind: "talk", title: "Speak with nobody", brief: "A check.", targetKey: "n999", gains: null, enters: [], moves: [] },
            { kind: "visit", title: "Go where you are", brief: "A check.", targetKey: "r1", gains: null, enters: [], moves: [] },
            standingTell("A check", "A check."),
        ], refs, last + 100);
        check("a goal pointing at nobody, and one sending the hero where they stand, are dropped", kept === 2, `${kept} kept`);
        const mine = (await goalsOf(chapter.id)).filter((goal) => goal.sortIndex > last + 100);
        const talk = mine.find((goal) => goal.kind === "talk")!;
        check("the goal names the person by id", talk.targetCharacterId === who.id && talk.enters.includes(who.id));
        check("it is waiting its turn", talk.status === "waiting");
        check("the checklist does not show what is still to come", !(await storyState(book)).goals.some((goal) => goal.id === talk.id));

        await bringOnstage(talk.enters);
        scene = await getScene(homeBook);
        check("brought on stage, they are in the world", scene.characters.some((c) => c.id === who.id));
        check("and are not among those met until spoken to", !(await getPeople(homeBook)).some((p) => p.id === who.id));

        console.log("\nmoved, and gone");
        if (elsewhere) {
            // the goal is settled as the story would settle it, so that what it gives and whom it moves are seen to happen
            await db.update(goals).set({ status: "active", activatedAt: new Date() }).where(eq(goals.id, talk.id));
            const others = await db.query.goals.findMany({ where: and(eq(goals.bookId, book.id), eq(goals.status, "active")) });
            const inHand = others.find((goal) => goal.id !== talk.id);
            if (inHand) await db.update(goals).set({ status: "waiting" }).where(eq(goals.id, inHand.id));
            const carried = (await db.query.books.findFirst({ where: eq(books.id, book.id) }))!.belongings;
            const settled = await settle(homeBook, { ...talk, status: "active" }, "done", "", { quiet: true });
            check("the goal was settled", settled?.status === "done");
            check("settling it twice does nothing", (await settle(homeBook, { ...talk, status: "active" }, "failed", "", { quiet: true })) === null);
            const moved = (await db.query.characters.findFirst({ where: eq(characters.id, who.id) }))!;
            check("the person it moves has moved", moved.regionId === elsewhere.id, (await db.query.regions.findFirst({ where: eq(regions.id, moved.regionId!) }))?.name);
            scene = await getScene(homeBook);
            check("they are no longer in the place they left", !scene.characters.some((c) => c.id === who.id));
            scene = await getScene({ ...book, currentRegionId: elsewhere.id });
            check("they are in the place they went to", scene.characters.some((c) => c.id === who.id));
            const there = (await db.query.characters.findMany({ where: and(eq(characters.regionId, elsewhere.id), eq(characters.status, "alive")) })).filter((c) => c.id !== who.id);
            check("and stand clear of everyone there", there.every((c) => Math.hypot(c.x - moved.x, c.z - moved.z) > 1.5));
            const now = (await db.query.books.findFirst({ where: eq(books.id, book.id) }))!.belongings;
            check("what the goal gives, the hero carries", now.includes("a stamped clipboard"));
            // as it was
            await db.update(books).set({ belongings: carried }).where(eq(books.id, book.id));
            await db.update(goals).set({ status: "dropped" }).where(and(eq(goals.chapterId, chapter.id), eq(goals.status, "active")));
            if (inHand) await db.update(goals).set({ status: "active" }).where(eq(goals.id, inHand.id));
        }
        await movePerson(book.id, who.id, null);
        const gone = (await db.query.characters.findFirst({ where: eq(characters.id, who.id) }))!;
        check("sent out of the book, they are gone", gone.status === "gone");
        const last2 = await worldKeys(book);
        check("the planner is told they have left", last2.peopleBrief.includes(`${stranger.name}, ${stranger.role} — HAS LEFT THE STORY`));
        check("and they keep their key", [...last2.people].some(([, c]) => c.id === who.id));
        for (const region of places) {
            scene = await getScene({ ...book, currentRegionId: region.id });
            check(`they are nowhere in ${region.name}`, !scene.characters.some((c) => c.id === who.id));
        }

        await db.delete(goals).where(and(eq(goals.chapterId, chapter.id), eq(goals.title, "Speak with the test pilot")));
        await db.delete(goals).where(and(eq(goals.chapterId, chapter.id), eq(goals.title, "A check")));
    } finally {
        await db.delete(characters).where(eq(characters.id, who.id));
    }

    const left = await db.query.characters.findMany({ where: eq(characters.bookId, book.id) });
    check("the book is as it was", left.length === before.length && (await storyState(book)).goals.every((goal) => goal.title !== "Speak with the test pilot"));
    console.log(failed === 0 ? "\nEvery check passed." : `\n${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 2);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
