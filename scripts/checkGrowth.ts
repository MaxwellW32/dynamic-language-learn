/**
 * Plays a book as the test player until its chapter turns, with no browser:
 * every open objective is done the way a player would do it (walk there, talk,
 * examine, fight), forks are taken, one long conversation is held so that the
 * scribe has something to summarise, and then the page is turned. It makes real
 * model calls (twenty to forty cents) and prints what each step produced.
 *
 *   npx tsx --conditions=react-server scripts/checkGrowth.ts [lang] [--book=<id>] [--chapters=2] [--grow] [--keep]
 *
 * --grow adds a region the way a chapter turn may, and walks the hero into it.
 *
 * This is the check for the parts of the story that only happen later: quest
 * beats, the director, chapter turns, new regions, summaries.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db";
import {
    aiUsage, books, buildings, chapters, characters, conversations, encounters, enemies, gates, landmarks, memories,
    questObjectives, quests, regions, threads, users,
    type Book, type QuestObjective,
} from "../db/schema";
import type { StoredStage, Submission } from "../game/challenges/types";
import { isLangCode, type LangCode } from "../game/languages";
import { DEFAULT_LOOK } from "../game/looks";
import type { PassageView, QuestUpdate } from "../game/payloads";
import { segmentsToPlainText, type Segment } from "../game/segments";
import { distToTrail, generateLayout, type GateSide } from "../game/worldgen/layout";
import { testAccounts } from "../lib/testMode";
import { formatMoney } from "../server/ai/pricing";
import { turnChapter } from "../server/services/chapters";
import { openDialogue, say } from "../server/services/dialogue";
import { startEncounter, submitAnswer } from "../server/services/encounters";
import { createBook, forgeRegion, forgeWorld } from "../server/services/forge";
import { choose, examine, handleArrival } from "../server/services/narration";
import { isChapterTurnReady } from "../server/services/quests";
import { syncPosition, travel } from "../server/services/scene";

const args = process.argv.slice(2);
const lang = (args.find((a) => isLangCode(a)) ?? "it") as LangCode;
const keep = args.includes("--keep");
const reuse = args.find((a) => a.startsWith("--book="))?.split("=")[1];
const chaptersToTurn = Number(args.find((a) => a.startsWith("--chapters="))?.split("=")[1] ?? 1);

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

function solve(stage: StoredStage): Submission {
    const a = stage.answer;
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
        await forgeWorld({ userId, bookId }, fresh);
        console.log(`forged in ${((Date.now() - began) / 1000).toFixed(0)}s`);
    }
    const ctx = { userId, bookId };
    const load = async (): Promise<Book> => (await db.query.books.findFirst({ where: eq(books.id, bookId) }))!;
    let book = await load();
    console.log(`\n"${book.title}" (${book.targetLanguage}) — ${book.arcStage}\n${book.premise}`);

    /* ---------------------------------------------------------------- */
    /* what a step may hand back                                         */
    /* ---------------------------------------------------------------- */

    async function after(what: string, result: { passage?: PassageView | null; questUpdates?: QuestUpdate[] }): Promise<void> {
        for (const update of result.questUpdates ?? []) {
            console.log(`   quest: "${update.questTitle}" ${update.isNew ? "GIVEN" : update.failed ? "LOST" : update.questCompleted ? "COMPLETED" : "moved"}${update.objectiveDescription ? ` — ${update.objectiveDescription}` : ""}`);
        }
        let page = result.passage ?? null;
        // a fork is taken as soon as it is offered, and what follows may fork again
        for (let depth = 0; page && depth < 3; depth++) {
            console.log(`   page [${page.kind}]: ${show(page.segments)}`);
            inspect(`${what} page`, page.segments);
            if (!page.choices || page.chosenKey) break;
            const taken = page.choices[depth % page.choices.length];
            console.log(`   fork: ${page.choices.map((c) => `(${c.tone}) ${segmentsToPlainText(c.label)}`).join(" | ")}  → taking "${segmentsToPlainText(taken.label)}"`);
            book = await load();
            const outcome = await choose(ctx, book, page.id, taken.key);
            for (const update of outcome.questUpdates) console.log(`   quest: "${update.questTitle}" moved`);
            page = outcome.passage;
            if (!page) problem(`${what}: the fork wrote nothing`);
        }
    }

    /** walk through gates until the hero stands in the region, reading the arrivals on the way */
    async function goTo(regionId: string): Promise<boolean> {
        book = await load();
        if (book.currentRegionId === regionId) return true;
        const mine = (await db.query.regions.findMany({ where: eq(regions.bookId, book.id) })).map((r) => r.id);
        const usable = await db.query.gates.findMany({ where: inArray(gates.regionId, mine) });
        // breadth first over the gates
        const cameBy = new Map<string, (typeof usable)[number]>();
        const queue = [book.currentRegionId!];
        const seen = new Set(queue);
        while (queue.length > 0) {
            const at = queue.shift()!;
            if (at === regionId) break;
            for (const gate of usable.filter((g) => g.regionId === at)) {
                if (seen.has(gate.targetRegionId)) continue;
                seen.add(gate.targetRegionId);
                cameBy.set(gate.targetRegionId, gate);
                queue.push(gate.targetRegionId);
            }
        }
        const route: (typeof usable)[number][] = [];
        for (let at = regionId; at !== book.currentRegionId; at = cameBy.get(at)!.regionId) {
            const gate = cameBy.get(at);
            if (!gate) {
                problem(`no way from the hero's region to region ${regionId}`);
                return false;
            }
            route.unshift(gate);
        }
        for (const gate of route) {
            book = await syncPosition(await load(), { x: gate.x, z: gate.z });
            const moved = await travel(book, gate.id);
            console.log(`\n── through "${gate.label}" to ${moved.region.name}${moved.firstVisit ? " (first visit)" : ""}`);
            if (Math.hypot(moved.book.x - gate.targetX, moved.book.z - gate.targetZ) > 0.01) problem("the hero did not arrive at the gate's far side");
            const arrival = await handleArrival(ctx, moved.book, moved.region, moved.firstVisit);
            if (moved.firstVisit && !arrival?.passage) problem(`no page was written on first reaching ${moved.region.name}`);
            if (arrival) await after("arrival", arrival);
        }
        book = await load();
        return book.currentRegionId === regionId;
    }

    async function talk(characterId: string, lines: string[], until?: (updates: QuestUpdate[]) => boolean): Promise<void> {
        const who = (await db.query.characters.findFirst({ where: eq(characters.id, characterId) }))!;
        if (!who.regionId || !(await goTo(who.regionId))) return;
        book = await syncPosition(await load(), { x: who.x + 1.5, z: who.z + 1.5 });
        const opened = await openDialogue(ctx, book, who.id);
        console.log(`\n── with ${who.name} (${who.role})`);
        const greeting = opened.messages[opened.messages.length - 1];
        if (opened.greeted) {
            console.log(`   ${who.name}: ${show(greeting.segments)}`);
            inspect(`${who.name}'s greeting`, greeting.segments);
        }
        if (opened.options.length !== 3) problem(`${who.name} offered ${opened.options.length} replies, not 3`);
        for (const line of lines) {
            book = await load();
            const turn = await say(ctx, book, who.id, { text: line });
            console.log(`   > ${line}\n   ${who.name} (${turn.mood}, ${turn.affinityDelta >= 0 ? "+" : ""}${turn.affinityDelta} → ${turn.affinity}): ${show(turn.reply.segments)}`);
            inspect(`${who.name}'s reply`, turn.reply.segments);
            if (/^["“]|I say|I reply|she says|he says/.test(segmentsToPlainText(turn.reply.segments))) problem(`${who.name} narrated instead of speaking`);
            if (turn.playerMessage.note) console.log(`   note: ${JSON.stringify(turn.playerMessage.note)}, xp ${turn.xp}`);
            await after(`talk with ${who.name}`, { passage: turn.beat, questUpdates: turn.questUpdates });
            if (until?.(turn.questUpdates)) break;
        }
    }

    async function fight(enemyId: string): Promise<boolean> {
        const foe = (await db.query.enemies.findFirst({ where: eq(enemies.id, enemyId) }))!;
        if (foe.status !== "alive") {
            problem(`${foe.name} is asked for by a quest but is already ${foe.status}`);
            return false;
        }
        if (!(await goTo(foe.regionId))) return false;
        book = await syncPosition(await load(), { x: foe.x + 1, z: foe.z + 1 });
        const battle = await startEncounter(book, foe.id);
        console.log(`\n── against ${foe.name} (${foe.tier}): "${battle.introLine}" — ${battle.totalStages} stages`);
        for (;;) {
            const row = (await db.query.encounters.findFirst({ where: eq(encounters.id, battle.id) }))!;
            const stage = row.stages[row.stageIndex];
            if (!stage || row.status !== "active") return row.status === "won";
            book = await load();
            const result = await submitAnswer(ctx, book, battle.id, solve(stage));
            if (!result.correct) problem(`the right answer to a ${stage.type} stage was marked wrong (${result.correctAnswer})`);
            if (result.victory) {
                console.log(`   won: "${result.victory.defeatLine}" — learned ${result.victory.learned.map((w) => w.lemma).join(", ") || "nothing new"}`);
                if (foe.tier !== "minion" && !result.victory.passage) problem(`besting ${foe.name} (${foe.tier}) wrote no page`);
                await after(`victory over ${foe.name}`, { passage: result.victory.passage, questUpdates: result.victory.questUpdates });
            }
        }
    }

    async function lookAt(landmarkId: string): Promise<void> {
        const thing = (await db.query.landmarks.findFirst({ where: eq(landmarks.id, landmarkId) }))!;
        if (!(await goTo(thing.regionId))) return;
        book = await syncPosition(await load(), { x: thing.x + 2, z: thing.z + 2 });
        const found = await examine(ctx, book, thing.id);
        console.log(`\n── examining ${thing.name} (${thing.kind})`);
        if (!found.passage) problem(`examining ${thing.name} wrote nothing`);
        await after(`examining ${thing.name}`, found);
    }

    async function learn(objective: QuestObjective): Promise<void> {
        // words are learned by winning them: fight whatever is about, nearest region first
        for (let round = 0; round < 6; round++) {
            const now = await db.query.questObjectives.findFirst({ where: eq(questObjectives.id, objective.id) });
            if (!now || now.status !== "active") return;
            book = await load();
            const about = await db.query.enemies.findMany({ where: and(eq(enemies.bookId, book.id), eq(enemies.status, "alive")) });
            const foe = about.find((e) => e.regionId === book.currentRegionId && e.tier === "minion")
                ?? about.find((e) => e.tier === "minion") ?? about.find((e) => e.tier === "elite");
            if (!foe) {
                problem("there is nothing left to fight, and words still to learn");
                return;
            }
            console.log(`   (${now.progress}/${now.targetCount} words so far)`);
            await fight(foe.id);
        }
    }

    const PERSUASION = [
        "I know this is a lot to ask. Tell me what worries you, and I will listen before I ask again.",
        "You have my word: I will see this through with you, and I will not leave you to face it alone.",
        "I have already helped your neighbours, and I would do the same for you. Will you trust me with this?",
        "Then let us do it together, at your pace. What would you need from me to say yes?",
        "Thank you for hearing me. I will do exactly as you ask. Do we have an agreement?",
    ];

    /* ---------------------------------------------------------------- */
    /* a long conversation, for the scribe                               */
    /* ---------------------------------------------------------------- */

    async function longTalk(): Promise<void> {
        book = await load();
        const who = await db.query.characters.findFirst({ where: and(eq(characters.bookId, book.id), eq(characters.regionId, book.currentRegionId!)) });
        if (!who) return;
        await talk(who.id, [
            "My name is Claude, and I come from a town of clockmakers far to the north.",
            "What is the best thing to eat here?",
            "I am afraid of deep water. I never learned to swim.",
            "Who in this place do you trust the most?",
            "I promise to bring you a gift from wherever I travel next.",
            "What did this place look like when you were a child?",
            "Is there a song people sing here?",
            "What would you do if you could leave for a year?",
            "Do you remember where I said I come from, and what I am afraid of?",
        ]);
        // the scribe works after the answer has been given
        await new Promise((resolve) => setTimeout(resolve, 9000));
        const talkOf = await db.query.conversations.findFirst({ where: and(eq(conversations.bookId, book.id), eq(conversations.characterId, who.id)) });
        const kept = await db.query.memories.findMany({ where: eq(memories.characterId, who.id) });
        console.log(`\n   conversation: ${talkOf?.messageCount} lines, ${talkOf?.summarizedCount} folded into the summary:\n   ${talkOf?.summary || "(no summary)"}`);
        console.log(`   ${who.name} remembers:\n${kept.map((m) => `     (${m.kind}, ${m.importance}) ${m.content}`).join("\n") || "     nothing"}`);
        if ((talkOf?.messageCount ?? 0) >= 18 && !talkOf?.summary) problem("a long conversation was never summarised");
        if (kept.length === 0) problem(`${who.name} remembers nothing of a long conversation`);
    }

    /* ---------------------------------------------------------------- */
    /* play                                                              */
    /* ---------------------------------------------------------------- */

    for (let turned = 0; turned < chaptersToTurn; turned++) {
        book = await load();
        if (book.status !== "active") break;
        console.log(`\n════ ${book.arcStage} ════`);

        for (let pass = 0; pass < 4; pass++) {
            book = await load();
            const open = await db.query.quests.findMany({
                where: and(eq(quests.bookId, book.id), eq(quests.status, "active")),
                orderBy: [asc(quests.sortIndex)],
                with: { objectives: { orderBy: [asc(questObjectives.sortIndex)] } },
            });
            if (open.length === 0) break;
            for (const quest of open) {
                console.log(`\n▶ quest "${quest.title}": ${quest.description}`);
                if (quest.objectives.length === 0) problem(`quest "${quest.title}" has no objectives`);
                for (const objective of quest.objectives) {
                    const now = await db.query.questObjectives.findFirst({ where: eq(questObjectives.id, objective.id) });
                    if (!now || now.status !== "active") continue;
                    console.log(`\n  ○ [${objective.kind}] ${objective.description}`);
                    try {
                        if (objective.kind === "talkTo" && objective.targetCharacterId) {
                            await talk(objective.targetCharacterId, ["Hello! I was told to come and find you. What should I know?"]);
                        } else if (objective.kind === "persuade" && objective.targetCharacterId) {
                            await talk(objective.targetCharacterId, PERSUASION,
                                (updates) => updates.some((u) => u.objectiveDescription === objective.description || u.failed));
                        } else if (objective.kind === "defeat" && objective.targetEnemyId) {
                            await fight(objective.targetEnemyId);
                        } else if (objective.kind === "visit" && objective.targetRegionId) {
                            await goTo(objective.targetRegionId);
                        } else if (objective.kind === "inspect" && objective.targetLandmarkId) {
                            await lookAt(objective.targetLandmarkId);
                        } else if (objective.kind === "learnWords") {
                            await learn(objective);
                        } else {
                            problem(`objective "${objective.description}" (${objective.kind}) points at nothing`);
                        }
                    } catch (error) {
                        problem(`${objective.kind} "${objective.description}" threw: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    const done = await db.query.questObjectives.findFirst({ where: eq(questObjectives.id, objective.id) });
                    if (done?.status === "active") console.log(`   (still open: ${done.progress}/${done.targetCount})`);
                }
            }
        }

        if (turned === 0) await longTalk();

        book = await load();
        const left = await db.query.quests.findMany({ where: and(eq(quests.bookId, book.id), eq(quests.status, "active")), with: { objectives: true } });
        if (!(await isChapterTurnReady(book))) {
            problem(`the chapter cannot turn: ${left.map((q) => `"${q.title}" [${q.objectives.filter((o) => o.status === "active").map((o) => o.kind).join(", ")}]`).join("; ") || "no quests at all"}`);
            break;
        }

        const before = await db.query.regions.findMany({ where: eq(regions.bookId, book.id) });
        const began = Date.now();
        const turn = await turnChapter(ctx, book);
        console.log(`\n════ the page turns (${((Date.now() - began) / 1000).toFixed(0)}s) ════`);
        console.log(`closed "${turn.closedChapter.title}": ${turn.closedChapter.summary}`);
        console.log(`opened "${turn.newChapter.title}"${turn.storyCompleted ? " — THE END" : ""}\n${show(turn.passage.segments)}`);
        inspect("the chapter's first page", turn.passage.segments);
        for (const quest of turn.quests.filter((q) => q.status === "active")) {
            console.log(`  new quest "${quest.title}": ${quest.objectives.map((o) => `[${o.kind}] ${o.description}${o.whereName ? ` (in ${o.whereName})` : ""}`).join("; ")}`);
        }
        book = await load();
        if (!turn.storyCompleted && turn.quests.filter((q) => q.status === "active").length === 0) problem("the new chapter has no quests");
        if (!turn.storyCompleted && await isChapterTurnReady(book)) problem("the new chapter is ready to turn before it has begun");

        await surveyWorld(before.map((r) => r.id));
    }

    /** a place is added the way a chapter turn would add one, whether or not this book's chapters asked for it */
    if (args.includes("--grow")) {
        book = await load();
        const before = await db.query.regions.findMany({ where: eq(regions.bookId, book.id) });
        console.log("\n════ the world grows ════");
        const began = Date.now();
        const added = await forgeRegion(ctx, book, {
            kind: "wilds", name: "The Goat Stairs", biome: "highland", timeOfDay: "golden", weather: "mist",
            ambience: "Wind combs the grass on the high steps, and goat bells answer one another across the mist.",
            description: "A stair of green terraces climbing above the town. The old folk say the first bell was carried down it.",
            themeWords: ["goat", "stone", "wind", "cloud", "path", "bell"],
        });
        console.log(`made in ${((Date.now() - began) / 1000).toFixed(0)}s`);
        if (!added) problem("the world had no room for a new place");
        else {
            await surveyWorld(before.map((r) => r.id));
            await goTo(added.id);
            const someone = await db.query.characters.findFirst({ where: eq(characters.regionId, added.id) });
            if (someone) await talk(someone.id, ["Hello! I have only just climbed up here. Who are you, and what is this place?"]);
        }
    }

    /** what has been added to the world since `known`, and whether every region still agrees with its own layout */
    async function surveyWorld(known: string[]): Promise<void> {
        const places = await db.query.regions.findMany({ where: eq(regions.bookId, bookId!), with: { gates: true } });
        for (const place of places.filter((p) => !known.includes(p.id))) {
            const folk = await db.query.characters.findMany({ where: eq(characters.regionId, place.id) });
            const beasts = await db.query.enemies.findMany({ where: eq(enemies.regionId, place.id) });
            const things = await db.query.landmarks.findMany({ where: eq(landmarks.regionId, place.id) });
            console.log(`  new place ${place.key} ${place.name} (${place.kind}, ${place.biome}): ${folk.map((c) => `${c.name}, ${c.role}`).join("; ") || "nobody"} | ${beasts.map((e) => e.name).join(", ") || "no creatures"} | ${things.map((t) => `${t.name}${t.labelEntryId ? "" : " (no label)"}`).join(", ") || "no landmarks"} | gates ${place.gates.map((g) => g.side).join("")}`);
            if (place.gates.length === 0) problem(`${place.name} cannot be reached: it has no gate`);
            if (folk.length === 0 || beasts.length === 0 || things.length === 0) problem(`${place.name} is missing people, creatures or landmarks`);
        }
        for (const place of places) {
            const sides = place.gates.map((g) => g.side as GateSide);
            const layout = generateLayout({ seed: place.seed, kind: place.kind, biome: place.biome as never, gates: sides });
            // every gate must stand where the layout of its region, as it now is, puts the gate of that side
            for (const gate of place.gates) {
                const slot = layout.gates[gate.side as GateSide];
                if (Math.hypot(slot.x - gate.x, slot.z - gate.z) > 0.01) problem(`the ${gate.side} gate of ${place.name} is not where its layout has it`);
                const far = places.find((p) => p.id === gate.targetRegionId)?.gates.find((g) => g.targetRegionId === place.id);
                if (!far) problem(`the ${gate.side} gate of ${place.name} leads somewhere with no way back`);
            }
            // and nothing that stands in the region may stand on one of its roads
            const [houses, things, folk] = await Promise.all([
                db.query.buildings.findMany({ where: eq(buildings.regionId, place.id) }),
                db.query.landmarks.findMany({ where: eq(landmarks.regionId, place.id) }),
                db.query.characters.findMany({ where: eq(characters.regionId, place.id) }),
            ]);
            for (const trail of layout.trails) {
                for (const house of houses) {
                    if (distToTrail(house, trail) < Math.min(house.width, house.depth) / 2) problem(`a road of ${place.name} runs through ${house.name}`);
                }
                if (place.kind !== "settlement") continue;
                for (const thing of things) {
                    if (Math.hypot(thing.x, thing.z) > 14 && distToTrail(thing, trail) < 2.5) problem(`a road of ${place.name} runs over ${thing.name}`);
                }
                for (const person of folk) {
                    if (Math.hypot(person.x, person.z) > 14 && distToTrail(person, trail) < 1.5) problem(`${person.name} stands in a road of ${place.name}`);
                }
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /* the account of it                                                 */
    /* ---------------------------------------------------------------- */

    book = await load();
    const [written, open, calls] = await Promise.all([
        db.query.chapters.findMany({ where: eq(chapters.bookId, book.id), orderBy: [asc(chapters.index)] }),
        db.query.threads.findMany({ where: eq(threads.bookId, book.id) }),
        db.query.aiUsage.findMany({ where: and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startedAll)) }),
    ]);
    console.log(`\nchapters: ${written.map((c) => `${c.index}. ${c.title}`).join(" | ")}`);
    console.log(`threads: ${open.map((t) => `${t.title} [${t.status}, ${t.importance}]`).join("; ")}`);
    console.log(`director's note: ${book.directorNote || "(none)"}`);

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
    console.log(`  total ${formatMoney(calls.reduce((sum, c) => sum + c.costMicros, 0))}`);

    console.log(problems.length === 0 ? "\nNo problems found." : `\n${problems.length} PROBLEM(S):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    console.log(`book id: ${book.id}`);
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
