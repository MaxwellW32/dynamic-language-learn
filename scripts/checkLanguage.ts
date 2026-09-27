/**
 * Exercise the language services against the real database and print what
 * they return. Touches only the seeded test player's own learning rows.
 *
 *   npx tsx --conditions=react-server scripts/checkLanguage.ts
 *   npx tsx --conditions=react-server scripts/checkLanguage.ts tokens     just one part
 *                                                             (tokens | labels | search | plan | study | race)
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { gradeStage, type ClientChallenge, type StoredStage, type Submission } from "../game/challenges";
import type { LangCode } from "../game/languages";
import { LANDMARK_KIND_LIST } from "../game/looks";
import { testAccounts } from "../lib/testMode";
import { lookupForm, lookupPhrase, searchDictionary, tokenize } from "../server/services/dictionary";
import {
    collectWord, getLearnerView, planWords, recordAnswer, recordExposure, recordProduction, updateLearner,
} from "../server/services/learning";
import { answerStudy, startStudy } from "../server/services/study";
import { studySessions } from "../db/schema";
import { labelsForKinds } from "../server/services/worldWords";

const only = process.argv[2];
const part = (name: string) => !only || only === name || only.startsWith(`${name}-`);

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
    const started = Date.now();
    const result = await run();
    console.log(`  (${label}: ${Date.now() - started} ms)`);
    return result;
}

async function tokens() {
    console.log("\n== tokenize ==");
    const samples: [LangCode, string][] = [
        ["es", "¡Buenos días! ¿Cómo estás, amigo? Dámelo."],
        ["fr", "J'ai mangé l'orange qu'il m'a donnée."],
        ["ja", "私は昨日友達と映画を見ました。"],
        ["zh", "我今天很高兴认识你。"],
        ["ko", "저는 학교에 갑니다."],
        ["de", "Das Haus ist groß."],
    ];
    for (const [lang, text] of samples) {
        const result = await timed(lang, () => tokenize(lang, text));
        const joined = result.map((t) => t.s).join("");
        const ids = [...new Set(result.flatMap((t) => (t.id ? [t.id] : [])))];
        const lemmas = new Map((await Promise.all(ids.map(async (id) => [id, (await db.query.dictEntries.findFirst({ where: (e, { eq }) => eq(e.id, id) }))] as const)))
            .map(([id, e]) => [id, e ? `${e.lemma}/${e.pos}` : "?"]));
        console.log(`${lang} roundtrip=${joined === text} ${result.map((t) => (t.id ? `[${t.s}→${lemmas.get(t.id)}]` : JSON.stringify(t.s))).join(" ")}`);
    }
    const phrase = await lookupPhrase("es", "¡Buenos días!");
    console.log(`lookupPhrase es "¡Buenos días!" → ${phrase ? `${phrase.lemma} (${phrase.pos}) = ${phrase.gloss}` : "null"}`);
    for (const [lang, form] of [["es", "comió"], ["es", "cómpralo"], ["it", "mangiarlo"], ["fr", "l'eau"], ["de", "Häuser"], ["ko", "학생입니다"], ["pt", "fazê-lo"]] as [LangCode, string][]) {
        const entry = await lookupForm(lang, form);
        console.log(`lookupForm ${lang} ${form} → ${entry ? `${entry.lemma} (${entry.pos}) = ${entry.gloss}` : "null"}`);
    }
}

async function labels() {
    console.log("\n== labelsForKinds ==");
    const kinds = ["well", "fountain", "signpost", "noticeboard", "campfire", "greattree", "bridge", "lantern", "chest", "bench"];
    for (const lang of ["es", "fr", "de", "it", "pt", "ja", "ko", "zh"] as LangCode[]) {
        const map = await timed(lang, () => labelsForKinds(lang, LANDMARK_KIND_LIST));
        const shown = only === "labels-all" ? LANDMARK_KIND_LIST : kinds;
        console.log(`${lang} (${map.size}/${LANDMARK_KIND_LIST.length} kinds labelled): ${shown.map((k) => {
            const label = map.get(k);
            return `${k}=${label ? label.text + (label.hint ? `[${label.hint}]` : "") : "—"}`;
        }).join(", ")}`);
    }
}

async function player() {
    const row = await db.query.users.findFirst({ where: eq(users.email, testAccounts.player.email) });
    if (!row || !row.isTest) throw new Error("No test player — run: npm run test:seed");
    return row;
}

async function plan() {
    console.log("\n== planWords (test player) ==");
    const user = await player();
    for (const [lang, level] of [["es", 0], ["es", 2], ["ja", 0]] as [LangCode, number][]) {
        await updateLearner(user.id, lang, { startingLevel: level });
        const words = await timed(`${lang} level ${level}`, () => planWords(user.id, lang, {
            introduce: 12, review: 4, scene: 4, sceneKeys: ["well", "water", "fire", "bread"],
        }));
        const show = (w: (typeof words)[number]) => `${w.entry.lemma}${w.entry.reading && w.entry.reading !== w.entry.lemma ? `[${w.entry.reading}]` : ""}(${w.entry.pos},#${w.entry.freqRank})=${w.entry.gloss}`;
        console.log(`${lang} startingLevel ${level}`);
        console.log(`  reviews+scene: ${words.filter((w) => w.purpose !== "introduce").map((w) => `${w.purpose[0]}:${show(w)}`).join(" | ")}`);
        console.log(`  introduce: ${words.filter((w) => w.purpose === "introduce").map(show).join(" | ")}`);
        await updateLearner(user.id, lang, { startingLevel: 0 });
    }
}

function answerFor(stage: StoredStage, right: boolean): Submission {
    const answer = stage.answer;
    const client: ClientChallenge = stage.client;
    switch (answer.kind) {
        case "choice": {
            const options = client.kind === "choice" || client.kind === "listen" ? client.options : [];
            return { kind: "choice", value: right ? answer.value : options.find((o) => o !== answer.value) ?? "" };
        }
        case "spelling":
            return { kind: "spelling", value: right ? answer.display.split(" (")[0] : "zzz" };
        case "matching":
            return { kind: "matching", pairs: answer.pairs.map((p, i) => ({ left: p.left, right: right ? p.right : answer.pairs[(i + 1) % answer.pairs.length].right })) };
        case "order": {
            const tokens = client.kind === "order" ? client.tokens : [];
            const used = new Set<number>();
            const order = answer.tokens.map((t) => {
                const i = tokens.findIndex((c, j) => c === t && !used.has(j));
                used.add(i);
                return i;
            });
            return { kind: "order", order: right ? order : [...order].reverse() };
        }
        case "speak":
            return { kind: "speak", heard: right ? answer.display : "" };
    }
}

async function study() {
    console.log("\n== study loop (test player, es) ==");
    const user = await player();
    let view = await timed("startStudy", () => startStudy(user.id, "es", 6));
    console.log(`session ${view.id}: ${view.total} stages, words sent up front: ${view.words.length}`);
    let n = 0;
    while (view && n < 20) {
        // the check script may peek at the stored answers; the client never can
        const stored = await db.query.studySessions.findFirst({ where: eq(studySessions.id, view.id) });
        const stage = stored!.stages[stored!.stageIndex];
        const right = n % 3 !== 2;
        const submission = answerFor(stage, right);
        const graded = gradeStage(stage, submission);
        const result = await answerStudy(user.id, view.id, submission);
        console.log(`  #${n} ${stage.type.padEnd(13)} client=${JSON.stringify(stage.client).slice(0, 110)}`);
        console.log(`       sent ${JSON.stringify(submission).slice(0, 80)} → correct=${result.correct} (local grade ${graded.correct}, exact ${graded.exact}) answer="${result.correctAnswer}" xp=${result.xp}`);
        n++;
        if (result.done) {
            console.log(`  done: ${JSON.stringify({ ...result.summary, learned: result.summary?.learned.map((w) => w.lemma) })}`);
            break;
        }
        view = { ...view, index: result.index, stage: result.stage };
    }
    try {
        await answerStudy(user.id, view.id, { kind: "choice", value: "x" });
        console.log("  !! answering a finished session did not throw");
    } catch (error) {
        console.log(`  answering again → ${(error as Error).message}`);
    }
    try {
        await answerStudy("someone-else", view.id, { kind: "choice", value: "x" });
        console.log("  !! another user could answer");
    } catch (error) {
        console.log(`  another user → ${(error as Error).message}`);
    }
    console.log(`  learner view: ${JSON.stringify(await getLearnerView(user.id, "es"))}`);
}

/** the same word answered, seen and collected all at once must neither throw nor lose an update */
async function race() {
    console.log("\n== concurrent writes (test player, es) ==");
    const user = await player();
    const entry = await lookupForm("es", "ventana");
    if (!entry) throw new Error("ventana not found");
    const before = await db.query.wordProgress.findFirst({ where: (w, { and, eq }) => and(eq(w.userId, user.id), eq(w.entryId, entry.id)) });
    await Promise.all([
        recordAnswer(user.id, { entryId: entry.id, lang: "es", correct: true, challengeType: "check", context: "study" }),
        recordAnswer(user.id, { entryId: entry.id, lang: "es", correct: true, challengeType: "check", context: "study" }),
        recordAnswer(user.id, { entryId: entry.id, lang: "es", correct: false, challengeType: "check", context: "study" }),
        recordExposure(user.id, "es", [entry.id, entry.id]),
        recordExposure(user.id, "es", [entry.id]),
        collectWord(user.id, "es", entry.id, true),
        recordProduction(user.id, "es", [entry.id]),
    ]);
    const after = await db.query.wordProgress.findFirst({ where: (w, { and, eq }) => and(eq(w.userId, user.id), eq(w.entryId, entry.id)) });
    console.log(`  ventana before: ${before ? `seen ${before.timesSeen}, correct ${before.timesCorrect}` : "no row"}`);
    console.log(`  after: seen ${after?.timesSeen}, correct ${after?.timesCorrect}, produced ${after?.timesProduced}, lapses ${after?.lapses}, collected ${after?.collected}`);
}

async function search() {
    console.log("\n== searchDictionary ==");
    for (const [lang, q] of [["es", "com"], ["es", "water"], ["de", "haus"], ["ja", "たべ"]] as [LangCode, string][]) {
        const cards = await timed(`${lang} ${q}`, () => searchDictionary(lang, q, 8));
        console.log(`${lang} "${q}": ${cards.map((c) => `${c.lemma}=${c.gloss}`).join(" · ")}`);
    }
}

async function main() {
    if (part("tokens")) await tokens();
    if (part("labels")) await labels();
    if (part("search")) await search();
    if (part("plan")) await plan();
    if (part("study")) await study();
    if (part("race")) await race();
    process.exit(0);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
