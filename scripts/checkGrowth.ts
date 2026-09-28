/**
 * Plays a book as the test player, with no browser, the way the book is meant
 * to be played: one goal at a time, in order. It walks where a goal sends it,
 * talks to whom a goal names (and asks for their answer), fights what a goal
 * points at, reads what the storyteller tells, and turns the page when a
 * chapter is done. It makes real model calls (thirty to sixty cents) and
 * prints what each step produced.
 *
 *   npx tsx --conditions=react-server scripts/checkGrowth.ts [lang] [--book=<id>] [--chapters=2] [--fail=persuade|fight|talk] [--keep]
 *
 * --fail makes the hero fail the first goal of that kind, on purpose: the road
 *        must then be written again, and the chapter must still end.
 * --book plays a book that already exists, from wherever it stands.
 *
 * It ends with a list of what it found wrong. Run it after touching goals, the
 * planner, the storyteller, conversations or the forge.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db";
import {
    aiUsage, books, buildings, chapters, characters, conversations, encounters, enemies, gates, goals, landmarks, memories,
    regions, users,
    type Book, type Goal,
} from "../db/schema";
import type { StoredStage, Submission } from "../game/challenges/types";
import { checklist, whatIsDue } from "../game/goals";
import { isLangCode, type LangCode } from "../game/languages";
import { DEFAULT_LOOK } from "../game/looks";
import type { GoalSettled, PassageView, StoryState } from "../game/payloads";
import { segmentsToPlainText, type Segment } from "../game/segments";
import { distToTrail, generateLayout, type GateSide } from "../game/worldgen/layout";
import { testAccounts } from "../lib/testMode";
import { formatMoney } from "../server/ai/pricing";
import { getPeople } from "../server/services/cast";
import { askForAnswer, openDialogue, say } from "../server/services/dialogue";
import { startEncounter, submitAnswer } from "../server/services/encounters";
import { createBook } from "../server/services/forge";
import { chaptersOf, goalsOf, storySoFar, storyState } from "../server/services/goals";
import { examine } from "../server/services/narration";
import { firstGateToward, getScene, syncPosition, travel } from "../server/services/scene";
import { advance, arrive, forgeBook, reach, turnChapter } from "../server/services/story";

const args = process.argv.slice(2);
const lang = (args.find((a) => isLangCode(a)) ?? "it") as LangCode;
const keep = args.includes("--keep");
const reuse = args.find((a) => a.startsWith("--book="))?.split("=")[1];
const chaptersToTurn = Number(args.find((a) => a.startsWith("--chapters="))?.split("=")[1] ?? 1);
const failAt = args.find((a) => a.startsWith("--fail="))?.split("=")[1] ?? null;

const problems: string[] = [];
const problem = (text: string) => {
    problems.push(text);
    console.log(`   !! ${text}`);
};

const show = (segments: Segment[]) =>
    segments.map((s) => (s.t === "text" ? s.v : s.t === "word" ? `«${s.s}»` : `‹${s.v} = ${s.tr}›`)).join("");

/** the same checks a reader's eye would make of any piece of story text */
function inspect(what: string, segments: Segment[]): void {
    const plain = segmentsToPlainText(segments);
    if (plain.trim().length === 0) problem(`${what}: empty`);
    if (/[a-zà-ÿ][.!?][A-Z]/.test(plain)) problem(`${what}: words run together — "${plain.match(/.{0,18}[a-zà-ÿ][.!?][A-Z].{0,18}/)?.[0]}"`);
    if (!segments.some((s) => s.t !== "text")) problem(`${what}: nothing in the language being learned`);
    for (const s of segments) if (s.t === "tl" && s.tr.trim().length === 0) problem(`${what}: «${s.v}» has no translation`);
}

function solve(stage: StoredStage, rightly: boolean): Submission {
    const a = stage.answer;
    if (!rightly) {
        if (a.kind === "choice") return { kind: "choice", value: "not this, surely" };
        if (a.kind === "spelling") return { kind: "spelling", value: "zzzz" };
        if (a.kind === "matching") return { kind: "matching", pairs: [] };
        if (a.kind === "speak") return { kind: "speak", heard: "zzzz" };
        return { kind: "order", order: [] };
    }
    if (a.kind === "choice") return { kind: "choice", value: a.value };
    if (a.kind === "spelling") return { kind: "spelling", value: a.display };
    if (a.kind === "matching") return { kind: "matching", pairs: a.pairs.map((p) => ({ left: p.left, right: p.right })) };
    if (a.kind === "speak") return { kind: "speak", heard: a.display };
    const shown = stage.client.kind === "order" ? [...stage.client.tokens] : [];
    const order = a.tokens.map((token) => {
        const at = shown.indexOf(token);
        shown[at] = "\u0000";
        return at;
    });
    return { kind: "order", order };
}

const WINNING = [
    "I know this is a lot to ask. Tell me what worries you, and I will listen before I ask again.",
    "You have my word: I will see this through with you, and I will not leave you to face it alone.",
    "I would not ask if it did not matter. What would you need from me to say yes?",
    "Then let us do it your way, at your pace. I will do exactly as you ask.",
];
const LOSING = [
    "Just hand it over. I have no time for your stories.",
    "You are a fool, and nobody here would miss your work. Give me what I want.",
    "I will take it whether you like it or not. Do not make me ask again.",
];
const ASKING = [
    "Hello! I was told to come and find you. What should I know?",
    "Thank you. Is there anything else I ought to hear before I go?",
];

async function main() {
    const player = await db.query.users.findFirst({ where: eq(users.email, testAccounts.player.email) });
    if (!player) throw new Error("No test player — run: npm run test:seed");
    const userId = player.id;
    const startedAll = new Date();

    let bookId = reuse;
    if (!bookId) {
        bookId = await createBook(userId, {
            language: lang, startingLevel: 0, immersionBias: 0, playerName: "Claude",
            heroLook: { ...DEFAULT_LOOK, outfit: "cloak", primary: "teal", secondary: "crimson", accessory: "satchel" },
            brief: { genre: "cozy fantasy mystery", tone: "warm, curious, a little mischievous", wish: "" },
        });
        const fresh = (await db.query.books.findFirst({ where: eq(books.id, bookId) }))!;
        const began = Date.now();
        await forgeBook({ userId, bookId }, fresh);
        console.log(`forged in ${((Date.now() - began) / 1000).toFixed(0)}s`);
    }
    const ctx = { userId, bookId };
    const load = async (): Promise<Book> => (await db.query.books.findFirst({ where: eq(books.id, bookId) }))!;
    let book = await load();
    if (book.userId !== userId) throw new Error("That book is not the test player's.");
    console.log(`\n"${book.title}" (${book.targetLanguage}) — ${book.arcStage}\n${book.premise}`);

    /* ---------------------------------------------------------------- */
    /* looking at what was written                                       */
    /* ---------------------------------------------------------------- */

    async function showOutline(): Promise<void> {
        const all = await chaptersOf(bookId!);
        console.log("\nthe outline:");
        for (const chapter of all) {
            console.log(`  ${chapter.index}. [${chapter.status}] "${chapter.title}" (${chapter.stage})\n       ${chapter.description || "(no description)"}`);
        }
        const outlined = all.filter((chapter) => chapter.description.trim().length > 0);
        if (outlined.length > 0) {
            if (!all.some((chapter) => chapter.status === "open")) problem("no chapter is open");
            if (all[all.length - 1].stage !== "resolution") problem("the last chapter is not the resolution");
            if (!all.some((chapter) => chapter.stage === "climax") && book.arcStage !== "falling" && book.arcStage !== "resolution") problem("the outline has no climax");
            for (const chapter of outlined) if (chapter.description.length < 60) problem(`chapter ${chapter.index} is described in ${chapter.description.length} characters`);
        }
    }

    async function showGoals(chapterId: string, heading: string): Promise<Goal[]> {
        const list = await goalsOf(chapterId);
        const names = new Map<string, string>([
            ...(await db.query.characters.findMany({ where: eq(characters.bookId, bookId!) })).map((c) => [c.id, `${c.name}${c.onstage ? "" : " (off stage)"}`] as const),
            ...(await db.query.enemies.findMany({ where: eq(enemies.bookId, bookId!) })).map((e) => [e.id, `${e.name} (${e.tier})`] as const),
            ...(await db.query.regions.findMany({ where: eq(regions.bookId, bookId!) })).map((r) => [r.id, r.name] as const),
        ]);
        for (const thing of await db.query.landmarks.findMany()) names.set(thing.id, thing.name);
        for (const house of await db.query.buildings.findMany()) names.set(house.id, house.name);
        console.log(`\n${heading}`);
        for (const goal of list) {
            const target = goal.targetCharacterId ?? goal.targetEnemyId ?? goal.targetBuildingId ?? goal.targetLandmarkId ?? goal.targetRegionId;
            console.log(`  ${String(goal.sortIndex).padStart(2)}. [${goal.status.padEnd(7)}] ${goal.kind.padEnd(8)} ${goal.title}${target ? ` → ${names.get(target) ?? "?"}` : ""}${goal.gains ? `  (gains: ${goal.gains})` : ""}${goal.enters.length ? `  (enters: ${goal.enters.map((id) => names.get(id)).join(", ")})` : ""}${goal.moves.length ? `  (moves: ${goal.moves.map((m) => `${names.get(m.characterId)} to ${m.toRegionId ? names.get(m.toRegionId) : "gone"}`).join(", ")})` : ""}`);
            console.log(`        ${goal.brief}`);
        }
        const live = list.filter((goal) => goal.status !== "dropped");
        if (live.length < 3) problem(`the chapter has ${live.length} goals`);
        const tells = live.filter((goal) => goal.kind === "tell").length;
        if (tells === 0) problem("the chapter tells nothing");
        if (tells === live.length) problem("the chapter asks nothing of the hero");
        if (live.filter((goal) => goal.status === "active").length > 1) problem("more than one goal is in hand");
        return list;
    }

    function readPages(what: string, pages: PassageView[]): void {
        for (const page of pages) {
            console.log(`   page [${page.kind}]: ${show(page.segments)}`);
            inspect(`${what} page`, page.segments);
            const words = segmentsToPlainText(page.segments).split(/\s+/).length;
            if (words > 170) problem(`${what} page runs to ${words} words`);
        }
    }

    function note(settled: GoalSettled | null): void {
        if (settled) console.log(`   ${settled.status === "done" ? "✓ DONE" : "✗ FAILED"}: ${settled.title} — ${settled.outcome}`);
    }

    /* ---------------------------------------------------------------- */
    /* getting about                                                     */
    /* ---------------------------------------------------------------- */

    /** walk through gates until the hero stands in the region */
    async function goTo(regionId: string): Promise<boolean> {
        book = await load();
        const mine = (await db.query.regions.findMany({ where: eq(regions.bookId, book.id) })).map((r) => r.id);
        const usable = await db.query.gates.findMany({ where: inArray(gates.regionId, mine) });
        for (let steps = 0; steps < 8 && book.currentRegionId !== regionId; steps++) {
            const gate = firstGateToward(usable, book.currentRegionId!, regionId);
            if (!gate) {
                problem(`no way from the hero's region to region ${regionId}`);
                return false;
            }
            const scene = await getScene(book);
            if (!scene.gates.some((g) => g.id === gate.id && g.sought)) problem(`the gate to leave by ("${gate.label}") is not marked`);
            book = await syncPosition(await load(), { x: gate.x, z: gate.z });
            const moved = await travel(book, gate.id);
            console.log(`\n── through "${gate.label}" to ${moved.region.name}${moved.firstVisit ? " (first visit)" : ""}`);
            note(await arrive(moved.book, moved.region, moved.firstVisit));
            book = await load();
        }
        return book.currentRegionId === regionId;
    }

    /** talk until they have answered, or until it is time to ask them to */
    async function talk(goal: Goal, lines: string[]): Promise<void> {
        const who = (await db.query.characters.findFirst({ where: eq(characters.id, goal.targetCharacterId!) }))!;
        if (!who.onstage) problem(`${who.name} is the target of the goal in hand but is off stage`);
        if (!who.regionId || !(await goTo(who.regionId))) return;
        const scene = await getScene(book);
        if (!scene.characters.some((c) => c.id === who.id && c.sought)) problem(`${who.name} is not marked in the world`);
        book = await syncPosition(await load(), { x: who.x + 1.5, z: who.z + 1.5 });

        const opened = await openDialogue(ctx, book, who.id);
        console.log(`\n── with ${who.name} (${who.role}) — likes: ${opened.character.likes.join(", ") || "?"}; dislikes: ${opened.character.dislikes.join(", ") || "?"}`);
        if (opened.character.likes.length === 0 || opened.character.dislikes.length === 0) problem(`${who.name} has no likes or dislikes to go by`);
        if (!opened.stake) problem(`nothing is at stake with ${who.name}, though the goal in hand is theirs`);
        if (!opened.greeted) problem(`${who.name} did not speak first, though the hero came about something new`);
        const greeting = opened.messages[opened.messages.length - 1];
        console.log(`   ${who.name}: ${show(greeting.segments)}`);
        inspect(`${who.name}'s greeting`, greeting.segments);
        if (opened.options.length !== 3) problem(`${who.name} offered ${opened.options.length} replies, not 3`);

        let settled: GoalSettled | null = null;
        for (const line of lines) {
            book = await load();
            const turn = await say(ctx, book, who.id, { text: line });
            console.log(`   > ${line}\n   ${who.name} (${turn.mood}, ${turn.affinityDelta >= 0 ? "+" : ""}${turn.affinityDelta}${turn.stake?.lean !== null && turn.stake ? `, stands at ${turn.stake.lean}` : ""}): ${show(turn.reply.segments)}`);
            inspect(`${who.name}'s reply`, turn.reply.segments);
            if (/^["“]|I say|I reply|she says|he says/.test(segmentsToPlainText(turn.reply.segments))) problem(`${who.name} narrated instead of speaking`);
            if (turn.settled) {
                settled = turn.settled;
                console.log("   (they answered of their own accord)");
                break;
            }
            if (!turn.stake) problem(`the stake vanished from the talk with ${who.name} without being settled`);
        }
        if (!settled) {
            book = await load();
            const answer = await askForAnswer(ctx, book, who.id);
            console.log(`   > (asks for their answer)\n   ${who.name}: ${show(answer.reply.segments)}`);
            inspect(`${who.name}'s answer`, answer.reply.segments);
            settled = answer.settled;
            if (!settled) problem(`${who.name} was asked for an answer and gave none`);
        }
        note(settled);
        const kept = await db.query.memories.findMany({ where: eq(memories.characterId, who.id) });
        if (settled && kept.length === 0) problem(`${who.name} remembers nothing of having given their answer`);
    }

    async function fight(goal: Goal, toWin: boolean): Promise<void> {
        const foe = (await db.query.enemies.findFirst({ where: eq(enemies.id, goal.targetEnemyId!) }))!;
        if (foe.status !== "alive") problem(`${foe.name} is the goal in hand but is ${foe.status}`);
        if (foe.respawns) problem(`${foe.name} is the goal in hand but would wander back if bested`);
        if (!(await goTo(foe.regionId))) return;
        book = await syncPosition(await load(), { x: foe.x + 1, z: foe.z + 1 });
        const battle = await startEncounter(book, foe.id);
        console.log(`\n── against ${foe.name} (${foe.tier}): "${battle.introLine}" — ${battle.totalStages} stages${toWin ? "" : " (losing on purpose)"}`);
        if (!battle.atStake) problem(`the battle with ${foe.name} does not say that a goal turns on it`);
        for (;;) {
            const row = (await db.query.encounters.findFirst({ where: eq(encounters.id, battle.id) }))!;
            const stage = row.stages[row.stageIndex];
            if (!stage || row.status !== "active") return;
            book = await load();
            const result = await submitAnswer(book, battle.id, solve(stage, toWin));
            if (toWin && !result.correct) problem(`the right answer to a ${stage.type} stage was marked wrong (${result.correctAnswer})`);
            if (result.status !== "active") {
                console.log(`   ${result.status}${result.victory ? `: "${result.victory.defeatLine}"` : ""}`);
                note(result.settled);
                if (!result.settled) problem(`the battle with ${foe.name} ended and settled nothing`);
                if (!result.story) problem("the battle ended without saying how the story stands");
            }
        }
    }

    async function visit(goal: Goal, state: StoryState): Promise<void> {
        if (goal.targetRegionId) {
            await goTo(goal.targetRegionId);
            return;
        }
        if (!state.beacon) {
            problem(`"${goal.title}" sends the hero somewhere, and nothing marks where`);
            return;
        }
        if (!(await goTo(state.beacon.regionId))) return;
        console.log(`\n── walking to ${state.beacon.name}`);
        book = await syncPosition(await load(), { x: state.beacon.x, z: state.beacon.z });
        if (Math.hypot(book.x - state.beacon.x, book.z - state.beacon.z) > state.beacon.radius) problem(`${state.beacon.name} cannot be walked up to: the nearest ground is ${Math.hypot(book.x - state.beacon.x, book.z - state.beacon.z).toFixed(1)} m away`);
        const arrived = await reach(book, goal.id);
        note(arrived.settled);
        if (!arrived.settled) problem(`reaching ${state.beacon.name} settled nothing`);
    }

    async function look(goal: Goal): Promise<void> {
        const thing = (await db.query.landmarks.findFirst({ where: eq(landmarks.id, goal.targetLandmarkId!) }))!;
        if (!(await goTo(thing.regionId))) return;
        const scene = await getScene(book);
        if (!scene.landmarks.some((l) => l.id === thing.id && l.sought)) problem(`${thing.name} is not marked in the world`);
        book = await syncPosition(await load(), { x: thing.x + 2, z: thing.z + 2 });
        const found = await examine(ctx, book, thing.id);
        console.log(`\n── examining ${thing.name} (${thing.kind})`);
        if (found.page) readPages(`examining ${thing.name}`, [found.page]);
        else problem(`examining ${thing.name} wrote nothing`);
        note(found.settled);
        if (!found.settled) problem(`examining ${thing.name} settled nothing`);
    }

    /* ---------------------------------------------------------------- */
    /* play                                                              */
    /* ---------------------------------------------------------------- */

    let failed = false;
    let turned = 0;
    await showOutline();
    {
        const inHand = (await chaptersOf(bookId)).find((chapter) => chapter.status === "open");
        if (inHand) await showGoals(inHand.id, `the goals of chapter ${inHand.index}:`);
    }

    for (let step = 0; step < 90 && turned < chaptersToTurn; step++) {
        book = await load();
        if (book.status !== "active") break;
        const state = await storyState(book);

        if (state.due === "page" || state.due === "bend" || state.due === "plan") {
            console.log(`\n── the book ${state.due === "page" ? "tells" : state.due === "bend" ? "bends: the road is written again" : "is outlined, and its goals written"}`);
            const began = Date.now();
            const before = state.due;
            const moved = await advance(ctx, book);
            console.log(`   (${((Date.now() - began) / 1000).toFixed(0)}s)`);
            readPages("told", moved.pages);
            if (before !== "page") {
                await showOutline();
                const inHand = (await chaptersOf(book.id)).find((chapter) => chapter.status === "open");
                if (inHand) {
                    const list = await showGoals(inHand.id, before === "bend" ? "the road, written again:" : "the goals:");
                    if (before === "bend") {
                        if (!list.some((goal) => goal.status === "failed" && goal.mended)) problem("the failure was not marked as mended");
                        if (!list.some((goal) => goal.status === "dropped")) console.log("   (nothing was left of the old road to drop)");
                        const fresh = list.filter((goal) => goal.status !== "dropped" && goal.status !== "failed" && goal.sortIndex > Math.max(...list.filter((g) => g.status === "failed").map((g) => g.sortIndex)));
                        if (fresh.length === 0) problem("no new road was written after the failure");
                        else if (fresh[0].kind !== "tell") problem("the new road does not begin by telling what the failure meant");
                    }
                }
            }
            if (moved.pages.length === 0 && moved.story.due === before) {
                problem(`the book was asked to move on and did not: still "${before}"`);
                break;
            }
            continue;
        }

        if (state.due === "turn") {
            const before = await db.query.regions.findMany({ where: eq(regions.bookId, book.id) });
            const began = Date.now();
            const turn = await turnChapter(ctx, book);
            turned++;
            console.log(`\n════ the page turns (${((Date.now() - began) / 1000).toFixed(0)}s) ════`);
            console.log(`closed "${turn.closedChapter.title}": ${turn.closedChapter.summary}`);
            if (turn.closedChapter.summary.length < 40) problem("the closed chapter has next to no summary");
            if (turn.storyCompleted) {
                console.log("THE END");
                break;
            }
            console.log(`opened "${turn.newChapter?.title}"`);
            readPages("the chapter's first", turn.pages);
            if (turn.pages.length === 0) problem("the new chapter began without a page");
            if (turn.story.goals.length === 0 && turn.story.ahead === 0) problem("the new chapter asks nothing of the hero");
            const opened = (await chaptersOf(book.id)).find((chapter) => chapter.status === "open");
            if (opened) await showGoals(opened.id, "its goals:");
            await surveyWorld(before.map((r) => r.id));
            continue;
        }

        // the goal in hand is the hero's to do
        const inHand = (await chaptersOf(book.id)).find((chapter) => chapter.status === "open");
        if (!inHand) {
            problem("no chapter is open, and the book says nothing is due");
            break;
        }
        const list = await goalsOf(inHand.id);
        const due = whatIsDue(list);
        if (due.what !== "reader") {
            problem(`the story says the next thing is the reader's, and the goals say "${due.what}"`);
            break;
        }
        const goal = due.goal;
        const shown = checklist(list).shown;
        if (state.goals.length !== shown.length) problem("the checklist shown is not the checklist");
        if (state.goals.some((view) => (view.kind as string) === "tell")) problem("a tell is shown in the checklist");
        console.log(`\n▶ [${goal.kind}] ${goal.title}${state.goals.find((g) => g.id === goal.id)?.whereName ? ` — in ${state.goals.find((g) => g.id === goal.id)?.whereName}` : ""}   (${state.ahead} more to come)`);

        const fail = !failed && failAt === goal.kind;
        try {
            if (goal.kind === "visit") await visit(goal, state);
            else if (goal.kind === "talk") await talk(goal, fail ? LOSING : ASKING);
            else if (goal.kind === "persuade") await talk(goal, fail ? LOSING : WINNING);
            else if (goal.kind === "fight") await fight(goal, !fail);
            else if (goal.kind === "examine") await look(goal);
        } catch (error) {
            problem(`${goal.kind} "${goal.title}" threw: ${error instanceof Error ? error.message : String(error)}`);
            break;
        }
        const after = await db.query.goals.findFirst({ where: eq(goals.id, goal.id) });
        if (after?.status === "active") {
            problem(`"${goal.title}" is still in hand after being played`);
            break;
        }
        if (fail) {
            failed = true;
            if (after?.status !== "failed") console.log(`   (the hero tried to fail and could not: ${after?.status})`);
        }
    }

    if (failAt && !failed) console.log(`\n(no ${failAt} goal came up, so none was failed)`);

    /* ---------------------------------------------------------------- */
    /* writing to someone from afar                                      */
    /* ---------------------------------------------------------------- */

    book = await load();
    const met = (await getPeople(book)).filter((person) => !person.gone);
    if (met.length > 0 && book.status === "active") {
        const friend = met[0];
        console.log(`\n── writing to ${friend.name} from afar (${friend.here ? "though they are near" : `they are in ${friend.whereName}`})`);
        const opened = await openDialogue(ctx, book, friend.id, { remote: true });
        if (!opened.remote) problem("a talk opened from afar does not say so");
        if (opened.stake) problem("something is at stake in a talk from afar");
        const turn = await say(ctx, book, friend.id, { text: "I was thinking of you. Do you remember what we last spoke about?" }, { remote: true });
        console.log(`   ${friend.name}: ${show(turn.reply.segments)}`);
        inspect(`${friend.name}'s letter`, turn.reply.segments);
        if (turn.settled) problem("a goal was settled from afar");
    } else if (book.status === "active") {
        console.log("\n(the hero has met nobody yet, so nobody could be written to)");
    }
    const stranger = await db.query.characters.findFirst({
        where: and(eq(characters.bookId, book.id), eq(characters.status, "alive")),
        with: { relationship: true },
    });
    const strangers = (await db.query.characters.findMany({ where: eq(characters.bookId, book.id) }))
        .filter((c) => !met.some((m) => m.id === c.id));
    if (stranger && strangers.length > 0) {
        const refused = await openDialogue(ctx, book, strangers[0].id, { remote: true }).then(() => false, () => true);
        if (!refused) problem(`${strangers[0].name}, whom the hero has never met, could be written to from afar`);
    }

    /** what has been added to the world since `known`, and whether every region still agrees with its own layout */
    async function surveyWorld(known: string[]): Promise<void> {
        const places = await db.query.regions.findMany({ where: eq(regions.bookId, bookId!), with: { gates: true } });
        for (const place of places.filter((p) => !known.includes(p.id))) {
            const folk = await db.query.characters.findMany({ where: eq(characters.regionId, place.id) });
            const beasts = await db.query.enemies.findMany({ where: eq(enemies.regionId, place.id) });
            const things = await db.query.landmarks.findMany({ where: eq(landmarks.regionId, place.id) });
            console.log(`  new place ${place.key} ${place.name} (${place.kind}, ${place.biome}): ${folk.map((c) => `${c.name}, ${c.role}`).join("; ") || "nobody"} | ${beasts.map((e) => e.name).join(", ") || "no creatures"} | ${things.map((t) => t.name).join(", ") || "no landmarks"} | gates ${place.gates.map((g) => g.side).join("")}`);
            if (place.gates.length === 0) problem(`${place.name} cannot be reached: it has no gate`);
        }
        for (const place of places) {
            const sides = place.gates.map((g) => g.side as GateSide);
            const layout = generateLayout({ seed: place.seed, kind: place.kind, biome: place.biome as never, gates: sides });
            for (const gate of place.gates) {
                const slot = layout.gates[gate.side as GateSide];
                if (Math.hypot(slot.x - gate.x, slot.z - gate.z) > 0.01) problem(`the ${gate.side} gate of ${place.name} is not where its layout has it`);
            }
            const [houses, folk] = await Promise.all([
                db.query.buildings.findMany({ where: eq(buildings.regionId, place.id) }),
                db.query.characters.findMany({ where: and(eq(characters.regionId, place.id), eq(characters.status, "alive")) }),
            ]);
            // nobody may stand inside a building, on top of anybody else, or out in a road
            for (const person of folk) {
                for (const house of houses) {
                    if (Math.hypot(house.x - person.x, house.z - person.z) < Math.min(house.width, house.depth) / 2) problem(`${person.name} stands inside ${house.name}`);
                }
                for (const other of folk) {
                    if (other.id !== person.id && Math.hypot(other.x - person.x, other.z - person.z) < 1.2) problem(`${person.name} stands on top of ${other.name}`);
                }
                if (place.kind === "settlement" && Math.hypot(person.x, person.z) > 14) {
                    for (const trail of layout.trails) if (distToTrail(person, trail) < 1.5) problem(`${person.name} stands in a road of ${place.name}`);
                }
            }
        }
    }
    await surveyWorld((await db.query.regions.findMany({ where: eq(regions.bookId, book.id) })).map((r) => r.id));

    /* ---------------------------------------------------------------- */
    /* the account of it                                                 */
    /* ---------------------------------------------------------------- */

    book = await load();
    const [written, calls, talks] = await Promise.all([
        db.query.chapters.findMany({ where: eq(chapters.bookId, book.id), orderBy: [asc(chapters.index)] }),
        db.query.aiUsage.findMany({ where: and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startedAll)) }),
        db.query.conversations.findMany({ where: eq(conversations.bookId, book.id) }),
    ]);
    console.log(`\nchapters: ${written.map((c) => `${c.index}. ${c.title} [${c.status}]`).join(" | ")}`);
    console.log(`the hero carries: ${book.belongings.join("; ") || "nothing"}`);
    console.log(`conversations: ${talks.length}, ${talks.reduce((sum, t) => sum + t.messageCount, 0)} lines in all`);
    console.log(`\nwhat the book remembers of itself:\n${await storySoFar(book)}`);
    if (book.writingSince) problem("the book is still marked as being written");

    const byTask = new Map<string, { calls: number; failed: number; ms: number; cost: number; input: number; cached: number }>();
    for (const call of calls) {
        const row = byTask.get(call.task) ?? { calls: 0, failed: 0, ms: 0, cost: 0, input: 0, cached: 0 };
        row.calls++;
        if (!call.ok) row.failed++;
        row.ms += call.ms;
        row.cost += call.costMicros;
        row.input += call.inputTokens;
        row.cached += call.cachedTokens;
        byTask.set(call.task, row);
    }
    console.log("\nmodel calls:");
    for (const [task, row] of [...byTask].sort((a, b) => b[1].cost - a[1].cost)) {
        console.log(`  ${task.padEnd(18)} ${String(row.calls).padStart(3)} call(s)${row.failed ? `, ${row.failed} FAILED` : ""}, ${(row.ms / row.calls / 1000).toFixed(1)}s each, ${Math.round((100 * row.cached) / Math.max(1, row.input))}% cached, ${formatMoney(row.cost)}`);
        if (row.failed > 0) problem(`${row.failed} ${task} call(s) failed`);
    }
    console.log(`  total ${calls.length} calls, ${formatMoney(calls.reduce((sum, c) => sum + c.costMicros, 0))}`);

    console.log(problems.length === 0 ? "\nNo problems found." : `\n${problems.length} PROBLEM(S):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    console.log(`book id: ${book.id}`);
    // housekeeping started by the last turn may still be writing
    await new Promise((resolve) => setTimeout(resolve, 4000));
    if (!keep && !reuse) {
        await db.delete(books).where(eq(books.id, book.id));
        console.log("(book deleted — pass --keep to leave it on the shelf)");
    }
    process.exit(problems.length === 0 ? 0 : 2);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
