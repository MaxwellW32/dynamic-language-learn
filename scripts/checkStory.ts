/**
 * Makes a new book as the test player, with no browser, and prints what was
 * made: the idea, the places, the people (with what they like and dislike),
 * the outline of the whole story, the goals of the first chapter and the
 * first pages. Then it talks to someone, examines something and fights
 * something, as a wanderer would with no goal in mind. It makes real model
 * calls (about fifteen cents) and says what each step took and cost.
 *
 *   npx tsx --conditions=react-server scripts/checkStory.ts [lang] [--keep] [--book=<id>]
 *
 * --keep leaves the book on the test player's shelf; --book reuses one instead of making one.
 *
 * To play a book through its goals, chapter after chapter, use checkGrowth.ts.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { aiUsage, books, characters, encounters, enemies, landmarks, memories, regions, users } from "../db/schema";
import type { StoredStage, Submission } from "../game/challenges/types";
import { isLangCode, type LangCode } from "../game/languages";
import { DEFAULT_LOOK } from "../game/looks";
import type { Segment } from "../game/segments";
import { testAccounts } from "../lib/testMode";
import { formatMoney } from "../server/ai/pricing";
import { openDialogue, say } from "../server/services/dialogue";
import { startEncounter, submitAnswer } from "../server/services/encounters";
import { createBook } from "../server/services/forge";
import { chaptersOf, goalsOf } from "../server/services/goals";
import { examine } from "../server/services/narration";
import { getOverview } from "../server/services/overview";
import { syncPosition } from "../server/services/scene";
import { forgeBook } from "../server/services/story";

const args = process.argv.slice(2);
const lang = (args.find((a) => isLangCode(a)) ?? "es") as LangCode;
const keep = args.includes("--keep");
const reuse = args.find((a) => a.startsWith("--book="))?.split("=")[1];

/** story text with the target language marked, so it can be judged at a glance */
function show(segments: Segment[]): string {
    return segments.map((s) => (s.t === "text" ? s.v : s.t === "word" ? `«${s.s}»` : `‹${s.v} = ${s.tr}›`)).join("");
}

async function step<T>(name: string, userId: string, work: () => Promise<T>): Promise<T> {
    const started = new Date();
    const result = await work();
    const calls = await db.query.aiUsage.findMany({ where: and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, started)) });
    const cost = calls.reduce((sum, c) => sum + c.costMicros, 0);
    const input = calls.reduce((sum, c) => sum + c.inputTokens, 0);
    const cached = calls.reduce((sum, c) => sum + c.cachedTokens, 0);
    const output = calls.reduce((sum, c) => sum + c.outputTokens, 0);
    console.log(`\n── ${name}: ${((Date.now() - started.getTime()) / 1000).toFixed(1)}s, ${calls.length} call(s) [${calls.map((c) => `${c.task} ${(c.ms / 1000).toFixed(0)}s`).join(", ")}], in ${input} (cached ${cached}) out ${output}, ${formatMoney(cost)}`);
    return result;
}

/** the right answer to a stage, read from the stored plan — a script may peek; a browser never can */
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
            language: lang, startingLevel: 0, immersionBias: 0,
            playerName: "Claude",
            heroLook: { ...DEFAULT_LOOK, outfit: "cloak", primary: "teal", secondary: "crimson", accessory: "satchel" },
            brief: { genre: "cozy fantasy mystery", tone: "warm, curious, a little mischievous", wish: "" },
        });
        const fresh = (await db.query.books.findFirst({ where: eq(books.id, bookId) }))!;
        await step("making the book", userId, () => forgeBook({ userId, bookId }, fresh));
    }
    const ctx = { userId, bookId };
    let book = (await db.query.books.findFirst({ where: eq(books.id, bookId) }))!;
    if (book.userId !== userId) throw new Error("That book is not the test player's.");
    console.log(`\n"${book.title}" — ${book.tone}\n${book.premise}\n\n${book.bible}`);

    const places = await db.query.regions.findMany({ where: eq(regions.bookId, book.id) });
    for (const r of places.sort((a, b) => a.sortIndex - b.sortIndex)) {
        console.log(`\n${r.key} ${r.name} — ${r.kind}, ${r.biome}, ${r.timeOfDay}, ${r.weather}; teaches: ${r.themeWords.join(", ")}\n   ${r.description}`);
    }
    const cast = await db.query.characters.findMany({ where: eq(characters.bookId, book.id) });
    for (const c of cast) {
        console.log(`\n${c.name}, ${c.role} [${c.look.outfit}/${c.look.primary}, ${c.look.hair} ${c.look.hairColor}, hat ${c.look.hat}, ${c.look.accessory}; voice ${c.voiceId}]${c.onstage ? "" : " (off stage)"}\n   ${c.personality}\n   wants: ${c.goal}\n   likes: ${c.likes.join("; ") || "?"}\n   dislikes: ${c.dislikes.join("; ") || "?"}\n   secret: ${c.secret}\n   barks: ${c.barks.map(show).join(" | ")}`);
    }
    const foes = await db.query.enemies.findMany({ where: eq(enemies.bookId, book.id) });
    console.log(`\ncreatures: ${foes.map((e) => `${e.name} (${e.tier} ${e.look.kind}/${e.look.tint}${e.respawns ? "" : ", pinned"})`).join("; ")}`);
    const things = await db.query.landmarks.findMany({ where: eq(landmarks.regionId, book.currentRegionId!) });
    console.log(`landmarks here: ${things.map((t) => `${t.name} (${t.kind}${t.labelEntryId ? "" : ", no label"})`).join("; ")}`);

    const outline = await chaptersOf(book.id);
    console.log("\nthe outline:");
    for (const chapter of outline) console.log(`  ${chapter.index}. [${chapter.status}] "${chapter.title}" (${chapter.stage})\n       ${chapter.description}`);
    const first = outline.find((chapter) => chapter.status === "open");
    if (first) {
        console.log(`\nthe goals of chapter ${first.index}:`);
        for (const goal of await goalsOf(first.id)) console.log(`  ${String(goal.sortIndex).padStart(2)}. [${goal.status.padEnd(7)}] ${goal.kind.padEnd(8)} ${goal.title}\n        ${goal.brief}`);
    }

    const overview = await getOverview(book);
    console.log(`\nfirst pages:\n${overview.passages.map((p) => show(p.segments)).join("\n\n")}`);
    console.log(`\nin hand: ${overview.story.goals.find((g) => g.status === "active")?.title ?? "(nothing)"}; due: ${overview.story.due ?? "the reader"}; ${overview.story.ahead} more to come`);
    console.log(`world labels: ${overview.scene.landmarks.map((l) => `${l.name} → ${l.label?.text ?? "—"}`).join("; ")}`);
    console.log(`learner: immersion ${overview.learner.immersion} (${overview.learner.immersionName}), ${overview.learner.wordsMet} words met`);

    /* talk, as a wanderer would: to whoever is nearest, about nothing in particular */
    const who = cast.find((c) => c.regionId === book.currentRegionId && c.onstage)!;
    book = await syncPosition(book, { x: who.x + 1.5, z: who.z + 1.5 });
    const opened = await step(`meet ${who.name}`, userId, () => openDialogue(ctx, book, who.id));
    console.log(`${who.name}: ${show(opened.messages[opened.messages.length - 1].segments)}`);
    console.log(`   offered: ${opened.options.map((o) => `(${o.tone}) ${show(o.segments)}`).join(" | ")}`);
    console.log(`   at stake: ${opened.stake ? `${opened.stake.kind} — ${opened.stake.title}` : "nothing"}`);

    const lines = [
        "Hello! I've only just arrived. What is this place, and who are you?",
        lang === "es" ? "Gracias. Yo quiero comer pan. ¿Dónde está el agua?" : "I promise I will help you with that. What do you need most?",
    ];
    for (const line of lines) {
        const turn = await step(`say "${line.slice(0, 40)}…"`, userId, () => say(ctx, book, who.id, { text: line }));
        console.log(`${who.name} (${turn.mood}, affinity ${turn.affinity}, ${turn.affinityDelta >= 0 ? "+" : ""}${turn.affinityDelta}): ${show(turn.reply.segments)}`);
        if (turn.playerMessage.note) console.log(`   language note: ${JSON.stringify(turn.playerMessage.note)}; xp ${turn.xp}`);
        console.log(`   offered: ${turn.options.map((o) => `(${o.tone}) ${show(o.segments)}`).join(" | ")}`);
        if (turn.settled) console.log(`   settled: ${turn.settled.status} — ${turn.settled.outcome}`);
    }
    const kept = await db.query.memories.findMany({ where: eq(memories.characterId, who.id), orderBy: [desc(memories.createdAt)] });
    console.log(`\n${who.name} now remembers:\n${kept.map((m) => `   (${m.kind}, ${m.importance}) ${m.content} [${m.keywords.join(", ")}]`).join("\n") || "   nothing"}`);

    /* examine */
    const thing = things[0];
    book = await syncPosition(book, { x: thing.x + 2, z: thing.z + 2 });
    const found = await step(`examine ${thing.name}`, userId, () => examine(ctx, book, thing.id));
    console.log(found.page ? show(found.page.segments) : "(nothing written)");
    const again = await step(`re-examine ${thing.name}`, userId, () => examine(ctx, book, thing.id));
    console.log(`   reread the same page: ${again.page?.id === found.page?.id}`);

    /* fight */
    const foe = foes.find((e) => e.regionId === book.currentRegionId && e.tier === "minion") ?? foes.find((e) => e.regionId === book.currentRegionId);
    if (foe) {
        book = await syncPosition(book, { x: foe.x + 1, z: foe.z + 1 });
        const battle = await step(`challenge ${foe.name}`, userId, () => startEncounter(book, foe.id));
        console.log(`"${battle.introLine}" — ${battle.totalStages} stages`);
        let stageIndex = 0;
        for (;;) {
            const row = (await db.query.encounters.findFirst({ where: eq(encounters.id, battle.id) }))!;
            const stage = row.stages[stageIndex];
            if (!stage || row.status !== "active") break;
            console.log(`   stage ${stageIndex + 1} [${stage.type}]: ${JSON.stringify(stage.client).slice(0, 220)}`);
            const result = await submitAnswer(book, battle.id, solve(stage));
            console.log(`   → ${result.correct ? "correct" : "WRONG"} (${result.correctAnswer}), hearts ${result.hearts}, xp ${result.xp}, ${result.status}`);
            if (result.victory) console.log(`   "${result.victory.defeatLine}"\n   learned: ${result.victory.learned.map((w) => `${w.lemma} = ${w.gloss}`).join(", ")}`);
            stageIndex++;
        }
    }

    const all = await db.query.aiUsage.findMany({ where: and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startedAll)) });
    const total = all.reduce((sum, c) => sum + c.costMicros, 0);
    const cachedShare = all.reduce((s, c) => s + c.cachedTokens, 0) / Math.max(1, all.reduce((s, c) => s + c.inputTokens, 0));
    console.log(`\n══ whole session: ${all.length} model calls, ${formatMoney(total)}, ${(cachedShare * 100).toFixed(0)}% of input tokens served from cache`);
    console.log(`book id: ${book.id}`);

    // housekeeping started by the last turn may still be writing
    await new Promise((resolve) => setTimeout(resolve, 4000));
    if (!keep && !reuse) {
        await db.delete(books).where(eq(books.id, book.id));
        console.log("(book deleted — pass --keep to leave it on the shelf)");
    }
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
