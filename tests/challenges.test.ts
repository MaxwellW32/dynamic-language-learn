import { test } from "node:test";
import assert from "node:assert/strict";
import {
    CHALLENGE_TYPES, findBlank, generateStages, gradeStage, normalizeAnswer, revealsWord,
    sentenceTokens, similarity, stageCountForTier,
    type ChallengeType, type ChallengeWord, type StoredStage, type Submission,
} from "../game/challenges";

let nextId = 1;
function word(lemma: string, gloss: string, extra: Partial<ChallengeWord> = {}): ChallengeWord {
    return {
        id: nextId++, lemma, gloss, reading: null, roman: null,
        exampleTarget: null, exampleNative: null, lang: "es", ...extra,
    };
}

const ES: ChallengeWord[] = [
    word("hablar", "to speak", { exampleTarget: "Hablamos español en casa.", exampleNative: "We speak Spanish at home." }),
    word("casa", "house", { exampleTarget: "Mi casa es pequeña.", exampleNative: "My house is small." }),
    word("perro", "dog", { exampleTarget: "El perro duerme mucho.", exampleNative: "The dog sleeps a lot." }),
    word("comer", "to eat", { exampleTarget: "Comemos juntos cada noche.", exampleNative: "We eat together every night." }),
    word("agua", "water", { exampleTarget: "Quiero un vaso de agua.", exampleNative: "I want a glass of water." }),
    word("libro", "book"),
    word("ciudad", "city", { exampleTarget: "La ciudad es grande.", exampleNative: "The city is big." }),
    word("está", "is (located)"),
    word("ser", "to be"),
    word("estar", "to be"),
    word("mañana", "tomorrow", { exampleTarget: "Nos vemos mañana.", exampleNative: "See you tomorrow." }),
    word("taxi", "taxi"),
];

const JA: ChallengeWord[] = [
    word("食べる", "to eat", { lang: "ja", reading: "たべる", roman: "taberu", exampleTarget: "私はパンを食べる。", exampleNative: "I eat bread." }),
    word("東京", "Tokyo", { lang: "ja", reading: "とうきょう", roman: "toukyou" }),
    word("水", "water", { lang: "ja", reading: "みず", roman: "mizu", exampleTarget: "水を飲みます。", exampleNative: "I drink water." }),
    word("本", "book", { lang: "ja", reading: "ほん", roman: "hon" }),
    word("犬", "dog", { lang: "ja", reading: "いぬ", roman: "inu", exampleTarget: "犬が好きです。", exampleNative: "I like dogs." }),
];

const ZH: ChallengeWord[] = [
    word("我们", "we", { lang: "zh", reading: "wǒ men", roman: "wǒ men", exampleTarget: "我们是朋友。", exampleNative: "We are friends." }),
    word("女人", "woman", { lang: "zh", reading: "nǚ rén", roman: "nǚ rén" }),
    word("书", "book", { lang: "zh", reading: "shū", roman: "shū" }),
    word("狗", "dog", { lang: "zh", reading: "gǒu", roman: "gǒu" }),
    word("水", "water", { lang: "zh", reading: "shuǐ", roman: "shuǐ" }),
];

const KO: ChallengeWord[] = [
    word("학교", "school", { lang: "ko", roman: "hakgyo" }),
    word("물", "water", { lang: "ko", roman: "mul" }),
    word("책", "book", { lang: "ko", roman: "chaek" }),
    word("개", "dog", { lang: "ko", roman: "gae" }),
];

function stagesOf(type: ChallengeType, words: ChallengeWord[], pool = words, count = 20): StoredStage[] {
    return generateStages({ words, distractorPool: pool, allowedTypes: [type], stageCount: count });
}

function wordById(id: number): ChallengeWord {
    const found = [...ES, ...JA, ...ZH, ...KO].find((w) => w.id === id);
    assert.ok(found, `word ${id}`);
    return found;
}

function spelling(stage: StoredStage, value: string) {
    return gradeStage(stage, { kind: "spelling", value });
}

/* ------------------------------------------------------------------ */
/* generators                                                          */
/* ------------------------------------------------------------------ */

test("every type exists in the registry", () => {
    assert.deepEqual([...CHALLENGE_TYPES].sort(), [
        "fillBlank", "listening", "matching", "meaningMatch", "reverseMatch", "sentenceOrder", "speaking", "spelling",
    ]);
});

test("choice stages never show their own answer outside the options, and offer it exactly once", () => {
    for (let run = 0; run < 150; run++) {
        for (const [type, words] of [
            ["meaningMatch", ES], ["reverseMatch", ES], ["fillBlank", ES], ["listening", ES],
            ["meaningMatch", JA], ["reverseMatch", JA], ["fillBlank", JA], ["listening", ZH],
        ] as [ChallengeType, ChallengeWord[]][]) {
            for (const stage of stagesOf(type, words)) {
                if (stage.answer.kind !== "choice") continue;
                const client = stage.client;
                assert.ok(client.kind === "choice" || client.kind === "listen");
                const answer = stage.answer.value;
                assert.equal(client.options.filter((o) => o === answer).length, 1, `${stage.type} offers the answer once`);
                assert.equal(new Set(client.options).size, client.options.length, "options are distinct");
                assert.equal(client.options.length, 4);
                const lang = wordById(stage.wordIds[0]).lang;
                const spaced = lang !== "ja" && lang !== "zh";
                if (client.kind === "choice") {
                    for (const shown of [client.prompt, client.promptHint, client.question]) {
                        // the answer is a meaning (English) or a headword (target language)
                        const answerIsMeaning = stage.type === "meaningMatch";
                        assert.ok(!revealsWord(shown, answer, answerIsMeaning ? true : spaced),
                            `${stage.type}: "${shown}" reveals "${answer}"`);
                    }
                } else {
                    // a listening stage carries the entry id for the audio, never the word itself
                    const w = wordById(stage.wordIds[0]);
                    assert.equal(client.entryId, w.id);
                    assert.ok(!JSON.stringify(client).includes(w.lemma), "listen payload has no lemma");
                    if (w.reading) assert.ok(!JSON.stringify(client).includes(w.reading), "listen payload has no reading");
                }
            }
        }
    }
});

test("a distractor never shares the answer's headword or meaning (ser/estar are both 'to be')", () => {
    for (let run = 0; run < 200; run++) {
        for (const stage of stagesOf("reverseMatch", ES)) {
            const w = wordById(stage.wordIds[0]);
            assert.equal(stage.client.kind, "choice");
            if (stage.client.kind !== "choice") continue;
            if (w.lemma === "ser") assert.ok(!stage.client.options.includes("estar"));
            if (w.lemma === "estar") assert.ok(!stage.client.options.includes("ser"));
        }
    }
});

test("a word whose meaning is spelled the same (taxi = taxi) never becomes a free choice point", () => {
    for (let run = 0; run < 100; run++) {
        for (const type of ["meaningMatch", "reverseMatch", "listening"] as ChallengeType[]) {
            const stages = stagesOf(type, [ES[11]], ES, 1);
            assert.ok(stages.every((s) => s.type !== "meaningMatch" && s.type !== "reverseMatch"), type);
        }
    }
});

test("spelling payload does not contain the word; hint is at most two characters", () => {
    for (const w of [...ES, ...JA, ...ZH, ...KO]) {
        const stages = stagesOf("spelling", [w], [w], 1);
        if (w.lemma === "taxi") {
            // nothing can be asked about a word whose meaning is itself: it is skipped
            assert.equal(stages.length, 0);
            continue;
        }
        const [stage] = stages;
        assert.equal(stage.type, "spelling");
        assert.equal(stage.client.kind, "spelling");
        if (stage.client.kind !== "spelling") continue;
        const shown = JSON.stringify(stage.client);
        for (const answer of [w.lemma, w.reading, w.roman]) {
            if (answer && [...answer].length > 2) assert.ok(!shown.includes(answer), `${answer} in ${shown}`);
        }
        assert.ok([...stage.client.pronunciationHint!.replace("…", "")].length <= 2);
    }
});

test("matching uses positional keys and grades each word separately", () => {
    const [stage] = stagesOf("matching", ES.slice(0, 4), ES, 1);
    assert.equal(stage.type, "matching");
    assert.equal(stage.wordIds.length, 4);
    assert.equal(stage.client.kind, "matching");
    if (stage.client.kind !== "matching" || stage.answer.kind !== "matching") return;
    for (const side of [stage.client.left, stage.client.right]) {
        for (const item of side) assert.match(item.key, /^[lr]\d$/);
    }
    const right = stage.answer.pairs.map((p) => ({ left: p.left, right: p.right }));
    const all = gradeStage(stage, { kind: "matching", pairs: right });
    assert.equal(all.correct, true);
    assert.equal(all.exact, true);

    // swap two pairings: exactly those two words are wrong
    const swapped = right.map((p, i) => (i === 0 ? { ...p, right: right[1].right } : i === 1 ? { ...p, right: right[0].right } : p));
    const partial = gradeStage(stage, { kind: "matching", pairs: swapped });
    assert.equal(partial.correct, false);
    assert.deepEqual(partial.perWord.map((p) => p.correct), [false, false, true, true]);
});

test("matching never pairs two words with the same meaning", () => {
    const words = [ES[8], ES[9], ES[1], ES[2], ES[5]]; // ser, estar ("to be" twice)
    for (let run = 0; run < 50; run++) {
        for (const stage of stagesOf("matching", words, words, 5)) {
            if (stage.client.kind !== "matching") continue;
            const glosses = stage.client.right.map((r) => r.label);
            assert.equal(new Set(glosses).size, glosses.length);
        }
    }
});

test("fillBlank finds the headword or an inflection sharing its first four letters", () => {
    assert.deepEqual(findBlank("Hablamos español en casa.", "hablar", "es"), { start: 0, end: 8, surface: "Hablamos" });
    assert.deepEqual(findBlank("Mi casa es pequeña.", "casa", "es"), { start: 3, end: 7, surface: "casa" });
    assert.deepEqual(findBlank("Comemos juntos cada noche.", "comer", "es"), { start: 0, end: 7, surface: "Comemos" });
    // "comer"/"comió" share only "com" — not enough to be sure it is the same word
    assert.equal(findBlank("Ella comió pan.", "comer", "es"), null);
    // a short headword must appear as written
    assert.equal(findBlank("Soy de aquí.", "ser", "es"), null);
    assert.deepEqual(findBlank("Nos vemos mañana.", "mañana", "es"), { start: 10, end: 16, surface: "mañana" });
    // a whole-word match only: "a" is not found inside "casa"
    assert.equal(findBlank("Mi casa.", "a", "es"), null);
    assert.deepEqual(findBlank("¡Buenos días a todos!", "buenos días", "es"), { start: 1, end: 12, surface: "Buenos días" });
    // unspaced scripts: literal occurrence only
    assert.deepEqual(findBlank("私はパンを食べる。", "食べる", "ja"), { start: 5, end: 8, surface: "食べる" });
    assert.equal(findBlank("私はパンを食べました。", "食べる", "ja"), null);
    assert.deepEqual(findBlank("我们是朋友。", "我们", "zh"), { start: 0, end: 2, surface: "我们" });
});

test("fillBlank blanks the inflected form and grades by headword", () => {
    const hablar = ES[0];
    let seen = 0;
    for (let run = 0; run < 30; run++) {
        const [stage] = stagesOf("fillBlank", [hablar], ES, 1);
        if (stage.type !== "fillBlank") continue;
        seen++;
        assert.equal(stage.client.kind, "choice");
        if (stage.client.kind !== "choice" || stage.answer.kind !== "choice") continue;
        assert.equal(stage.client.prompt, "＿＿＿ español en casa.");
        assert.ok(stage.client.options.includes("hablar"));
        assert.match(stage.client.question, /changed to fit/);
        const right = gradeStage(stage, { kind: "choice", value: "hablar" });
        assert.equal(right.correct, true);
        assert.equal(right.correctAnswer, "Hablamos (hablar)");
        assert.equal(gradeStage(stage, { kind: "choice", value: "casa" }).correct, false);
    }
    assert.ok(seen > 0);
});

test("fillBlank is never offered when the word stays visible in the translation", () => {
    const hotel = word("hotel", "hotel", { exampleTarget: "El hotel es caro.", exampleNative: "The hotel is expensive." });
    for (let run = 0; run < 30; run++) {
        const stages = stagesOf("fillBlank", [hotel], [...ES, hotel], 1);
        assert.ok(stages.every((s) => s.type !== "fillBlank"));
    }
});

test("sentence pieces: spaces for spaced languages, Intl.Segmenter for Japanese and Chinese", () => {
    assert.deepEqual(sentenceTokens("El perro duerme mucho.", "es"), ["El", "perro", "duerme", "mucho."]);
    const ja = sentenceTokens("私はパンを食べる。", "ja");
    assert.equal(ja.join(""), "私はパンを食べる。");
    assert.ok(ja.length >= 3);
    assert.ok(ja.every((t) => t.trim().length > 0 && t !== "。"), "no whitespace or lone punctuation tile");
    const zh = sentenceTokens("我们 是朋友。", "zh");
    assert.equal(zh.join(""), "我们是朋友。");
    assert.ok(zh.every((t) => !/\s/.test(t)));
});

test("sentenceOrder: shuffled, graded by rebuilt text, twin tokens interchangeable, bad orders rejected", () => {
    const twins = word("mucho", "a lot", { exampleTarget: "muy muy bien hecho", exampleNative: "very very well done" });
    for (let run = 0; run < 30; run++) {
        const [stage] = stagesOf("sentenceOrder", [twins], ES, 1);
        assert.equal(stage.type, "sentenceOrder");
        if (stage.client.kind !== "order" || stage.answer.kind !== "order") continue;
        const tokens = stage.client.tokens;
        assert.notEqual(tokens.join(" "), "muy muy bien hecho", "the shuffle is never the answer");
        const want = ["muy", "muy", "bien", "hecho"];
        const used = new Set<number>();
        const order = want.map((t) => {
            const i = tokens.findIndex((c, j) => c === t && !used.has(j));
            used.add(i);
            return i;
        });
        assert.equal(gradeStage(stage, { kind: "order", order }).correct, true);
        // the two "muy" tiles swapped is still the same sentence
        const muys = order.slice(0, 2).reverse();
        assert.equal(gradeStage(stage, { kind: "order", order: [...muys, ...order.slice(2)] }).correct, true);
        assert.equal(gradeStage(stage, { kind: "order", order: [...order].reverse() }).correct, false);
        assert.equal(gradeStage(stage, { kind: "order", order: [order[0], order[0], order[2], order[3]] }).correct, false, "repeated index");
        assert.equal(gradeStage(stage, { kind: "order", order: order.slice(0, 3) }).correct, false, "too short");
    }
});

test("speaking payload carries the word, hint and locale; answer is not a choice", () => {
    const [stage] = stagesOf("speaking", [JA[0]], JA, 1);
    assert.equal(stage.type, "speaking");
    assert.deepEqual(stage.client, {
        kind: "speak", prompt: "食べる", promptHint: "たべる", meaning: "to eat", locale: "ja-JP", question: "Say this word aloud.",
    });
});

test("generateStages respects the stage count and falls back when a type does not fit", () => {
    const stages = generateStages({ words: ES, distractorPool: ES, allowedTypes: ["sentenceOrder"], stageCount: 5 });
    assert.equal(stages.length, 5);
    for (const s of stages) {
        const w = wordById(s.wordIds[0]);
        if (!w.exampleTarget) assert.notEqual(s.type, "sentenceOrder");
    }
    const unknown = generateStages({ words: ES, distractorPool: ES, allowedTypes: ["nonsense" as ChallengeType], stageCount: 2 });
    assert.equal(unknown.length, 2);
    // with a pool too small for four options, choice types give way to spelling
    const tiny = generateStages({ words: [ES[1]], distractorPool: [], allowedTypes: ["meaningMatch"], stageCount: 1 });
    assert.equal(tiny[0].type, "spelling");
});

/* ------------------------------------------------------------------ */
/* graders                                                             */
/* ------------------------------------------------------------------ */

test("choice grading is exact string equality", () => {
    const [stage] = stagesOf("meaningMatch", [ES[1]], ES, 1);
    assert.equal(stage.type, "meaningMatch");
    assert.deepEqual(gradeStage(stage, { kind: "choice", value: "house" }), {
        correct: true, exact: true, perWord: [{ wordId: ES[1].id, correct: true }], correctAnswer: "house",
    });
    assert.equal(gradeStage(stage, { kind: "choice", value: "House" }).correct, false);
    assert.equal(gradeStage(stage, { kind: "choice", value: "dog" }).correct, false);
});

test("spelling forgives accents but says so", () => {
    const [stage] = stagesOf("spelling", [ES[10]], ES, 1); // mañana
    assert.deepEqual([spelling(stage, "mañana").correct, spelling(stage, "mañana").exact], [true, true]);
    assert.deepEqual([spelling(stage, "  Mañana! ").correct, spelling(stage, "  Mañana! ").exact], [true, true]);
    assert.deepEqual([spelling(stage, "manana").correct, spelling(stage, "manana").exact], [true, false]);
    assert.equal(spelling(stage, "mañanas").correct, false);
    assert.equal(spelling(stage, "").correct, false);

    const [esta] = stagesOf("spelling", [ES[7]], ES, 1);
    assert.deepEqual([spelling(esta, "está").correct, spelling(esta, "está").exact], [true, true]);
    assert.deepEqual([spelling(esta, "esta").correct, spelling(esta, "esta").exact], [true, false]);
    assert.equal(spelling(esta, "estar").correct, false);
});

test("Japanese spelling accepts kanji, hiragana, katakana and romaji in its common spellings", () => {
    const [taberu] = stagesOf("spelling", [JA[0]], JA, 1);
    for (const value of ["食べる", "たべる", "タベル", "taberu", "TABERU", "ta-beru"]) {
        const result = spelling(taberu, value);
        assert.equal(result.correct, true, value);
        assert.equal(result.exact, true, value);
    }
    assert.equal(spelling(taberu, "たべた").correct, false);
    assert.equal(spelling(taberu, "nomu").correct, false);

    const [tokyo] = stagesOf("spelling", [JA[1]], JA, 1);
    for (const value of ["東京", "とうきょう", "toukyou", "tōkyō", "tokyo"]) assert.equal(spelling(tokyo, value).correct, true, value);
    assert.equal(spelling(tokyo, "kyoto").correct, false);
});

test("Mandarin spelling accepts hanzi and pinyin with or without tones and spaces", () => {
    const [women] = stagesOf("spelling", [ZH[0]], ZH, 1);
    assert.deepEqual([spelling(women, "我们").correct, spelling(women, "我们").exact], [true, true]);
    assert.deepEqual([spelling(women, "wǒ men").correct, spelling(women, "wǒ men").exact], [true, true]);
    assert.deepEqual([spelling(women, "wǒmen").correct, spelling(women, "wǒmen").exact], [true, true]);
    assert.deepEqual([spelling(women, "women").correct, spelling(women, "women").exact], [true, false]);
    assert.deepEqual([spelling(women, "wo men").correct, spelling(women, "wo men").exact], [true, false]);
    assert.deepEqual([spelling(women, "wo3men5").correct, spelling(women, "wo3men5").exact], [true, false]);
    assert.equal(spelling(women, "nimen").correct, false);

    const [nvren] = stagesOf("spelling", [ZH[1]], ZH, 1);
    for (const value of ["nǚrén", "nüren", "nvren", "nu3ren2"]) assert.equal(spelling(nvren, value).correct, true, value);
});

test("Korean spelling accepts hangul or romanisation", () => {
    const [school] = stagesOf("spelling", [KO[0]], KO, 1);
    assert.equal(spelling(school, "학교").correct, true);
    assert.equal(spelling(school, "hakgyo").correct, true);
    assert.equal(spelling(school, "학생").correct, false);
});

test("speaking: normalised equality or 80% similarity against the word (and readings for ja/zh)", () => {
    const gracias = word("gracias", "thank you");
    const [stage] = stagesOf("speaking", [gracias], [gracias], 1);
    const heard = (text: string) => gradeStage(stage, { kind: "speak", heard: text }).correct;
    assert.equal(heard("Gracias."), true);
    assert.equal(heard("grasias"), true); // 1 edit in 7
    assert.equal(heard("gracia"), true);
    assert.equal(heard("gordas"), false);
    assert.equal(heard(""), false);

    const hola = word("hola", "hello");
    const [short] = stagesOf("speaking", [hola], [hola], 1);
    assert.equal(gradeStage(short, { kind: "speak", heard: "ola" }).correct, false, "one edit in four is below 80%");
    assert.equal(gradeStage(short, { kind: "speak", heard: "¡Hola!" }).correct, true);

    const [taberu] = stagesOf("speaking", [JA[0]], JA, 1);
    for (const text of ["食べる", "たべる", "taberu"]) assert.equal(gradeStage(taberu, { kind: "speak", heard: text }).correct, true, text);
    const [women] = stagesOf("speaking", [ZH[0]], ZH, 1);
    for (const text of ["我们", "wǒ men", "women"]) assert.equal(gradeStage(women, { kind: "speak", heard: text }).correct, true, text);
});

test("a submission of the wrong kind is simply wrong, never a throw", () => {
    const [stage] = stagesOf("spelling", [ES[1]], ES, 1);
    const result = gradeStage(stage, { kind: "choice", value: "casa" } as Submission);
    assert.deepEqual(result, { correct: false, exact: false, perWord: [{ wordId: ES[1].id, correct: false }], correctAnswer: "casa" });
});

test("helpers", () => {
    assert.equal(normalizeAnswer("  ¿Mañana, Señor?! "), "mananasenor");
    assert.equal(normalizeAnswer("が"), "が", "kana voicing marks are not accents");
    assert.equal(similarity("abc", "abc"), 1);
    assert.equal(similarity("", ""), 1);
    assert.ok(Math.abs(similarity("gracias", "grasias") - 6 / 7) < 1e-9);
    assert.equal(revealsWord("la casa", "a"), false);
    assert.equal(revealsWord("a casa", "a"), true);
    assert.equal(revealsWord("私は水を飲む", "水", false), true);
    assert.deepEqual(["minion", "elite", "boss"].map((t) => stageCountForTier(t as "minion")), [3, 4, 6]);
});
