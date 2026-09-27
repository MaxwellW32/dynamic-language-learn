/*
 * Pure helpers of the language services. The services import "server-only",
 * so this file runs with --conditions=react-server (see the npm test script);
 * nothing here touches the database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    fallbackForms, forwardMaxMatch, meaningKey, rankCandidates, splitSpaced, stripClitics,
    stripKoreanParticle, unspacedCandidates,
} from "../server/services/dictionary";
import { dedupeByLemma, immersionFor, nextStreak, utcDay } from "../server/services/learning";
import { articleForm, definiteArticle, labelHint } from "../server/services/worldWords";
import { applyCuration, validateItem, type Curation } from "../scripts/dict/curate";
import type { RawEntry } from "../scripts/dict/types";

/* ------------------------------------------------------------------ */
/* form fallbacks                                                      */
/* ------------------------------------------------------------------ */

test("French and Italian elisions fall back to the word after the apostrophe", () => {
    assert.deepEqual(fallbackForms("fr", "l'orange").slice(0, 1), ["orange"]);
    assert.ok(fallbackForms("fr", "qu'il").includes("il"));
    assert.ok(fallbackForms("fr", "J'ai").includes("ai"));
    assert.ok(fallbackForms("fr", "l’eau").includes("eau"), "typographic apostrophe");
    assert.ok(fallbackForms("it", "dell'acqua").includes("acqua"));
    assert.ok(fallbackForms("fr", "«l'orange»").includes("orange"), "surrounding punctuation stripped first");
});

test("a hyphenated word falls back to its first part", () => {
    assert.ok(fallbackForms("fr", "donne-moi").includes("donne"));
});

test("Spanish glued-on pronouns are stripped, along with the accent they caused", () => {
    assert.ok(fallbackForms("es", "Dámelo").includes("da"));
    assert.ok(fallbackForms("es", "cómpralo").includes("compra"));
    assert.ok(fallbackForms("es", "diciéndole").includes("diciendo"));
    assert.ok(fallbackForms("es", "comerlo").includes("comer"));
    assert.ok(fallbackForms("es", "levantarse").includes("levantar"));
    assert.ok(fallbackForms("es", "dígaselo").includes("diga"));
    // the longest ending is tried first
    const forms = stripClitics("es", "dámelo");
    assert.ok(forms.indexOf("dá") < forms.indexOf("dáme"));
});

test("Italian infinitives get their -e back and doubled consonants are undone", () => {
    assert.ok(fallbackForms("it", "mangiarlo").includes("mangiare"));
    assert.ok(fallbackForms("it", "dammi").includes("da"));
    assert.ok(fallbackForms("it", "dimmelo").includes("di"));
    assert.ok(fallbackForms("it", "portaglielo").includes("porta"));
});

test("Portuguese hyphenated pronouns restore the infinitive", () => {
    assert.ok(fallbackForms("pt", "fazê-lo").includes("fazer"));
    assert.ok(fallbackForms("pt", "dá-me").includes("da"));
});

test("languages without clitics get no clitic stripping", () => {
    assert.deepEqual(stripClitics("fr", "donnela"), []);
    assert.deepEqual(stripClitics("de", "machen"), []);
    assert.deepEqual(fallbackForms("de", "Haus"), [], "German forms are stored lower-case, so case needs no fallback");
    assert.deepEqual(fallbackForms("es", "   "), []);
});

test("one Korean particle is stripped, longest first", () => {
    assert.deepEqual(stripKoreanParticle("학교에서").slice(0, 1), ["학교"]);
    assert.ok(stripKoreanParticle("저는").includes("저"));
    assert.ok(stripKoreanParticle("학생입니다").includes("학생"));
    assert.ok(fallbackForms("ko", "학교에").includes("학교"));
    // never strips the whole word
    assert.deepEqual(stripKoreanParticle("는"), []);
});

/* ------------------------------------------------------------------ */
/* tokenising                                                          */
/* ------------------------------------------------------------------ */

test("spaced text splits into word and non-word runs that rebuild it exactly", () => {
    const text = "¡Buenos días! ¿Cómo estás, amigo? J'ai vu l'arc-en-ciel…  2 fois.";
    const runs = splitSpaced(text);
    assert.equal(runs.map((r) => r.s).join(""), text);
    assert.deepEqual(runs.filter((r) => r.word).map((r) => r.s),
        ["Buenos", "días", "Cómo", "estás", "amigo", "J'ai", "vu", "l'arc-en-ciel", "2", "fois"]);
    assert.deepEqual(splitSpaced(""), []);
    assert.deepEqual(splitSpaced("..."), [{ s: "...", word: false }]);
});

test("unspaced candidates stop at punctuation and cap at eight characters", () => {
    const candidates = unspacedCandidates("我很好。你呢");
    assert.ok(candidates.includes("我很好"));
    assert.ok(candidates.includes("你呢"));
    assert.ok(!candidates.some((c) => c.includes("。")));
    assert.ok(unspacedCandidates("一二三四五六七八九十").every((c) => [...c].length <= 8));
});

test("forward maximum matching takes the longest known form and leaves strangers alone", () => {
    const dict = new Map([["私", 1], ["は", 2], ["昨日", 3], ["見ました", 4], ["見", 5], ["映画", 6]]);
    const text = "私は昨日映画を見ました。";
    const tokens = forwardMaxMatch(text, (form) => dict.get(form));
    assert.equal(tokens.map((t) => t.s).join(""), text);
    assert.deepEqual(tokens, [
        { s: "私", id: 1 }, { s: "は", id: 2 }, { s: "昨日", id: 3 }, { s: "映画", id: 6 },
        { s: "を" }, { s: "見ました", id: 4 }, { s: "。" },
    ]);
});

test("ranking prefers the entry that is its own headword, then frequency, then teachable", () => {
    const como = { id: 1, lemma: "como", freqRank: 20, teachable: true };
    const comer = { id: 2, lemma: "comer", freqRank: 5, teachable: true };
    assert.equal(rankCandidates("como", [comer, como])[0].id, 1);
    const Haus = { id: 3, lemma: "Haus", freqRank: 90, teachable: true };
    const hausen = { id: 4, lemma: "hausen", freqRank: 10, teachable: true };
    assert.equal(rankCandidates("haus", [hausen, Haus])[0].id, 3, "case-insensitive");
    const rare = { id: 5, lemma: "fue", freqRank: null, teachable: true };
    const ir = { id: 6, lemma: "ir", freqRank: 14, teachable: true };
    const ser = { id: 7, lemma: "ser", freqRank: 3, teachable: true };
    assert.deepEqual(rankCandidates("fue", [ir, ser, rare]).map((c) => c.id), [5, 7, 6]);
    const a = { id: 8, lemma: "x", freqRank: null, teachable: false };
    const b = { id: 9, lemma: "y", freqRank: null, teachable: true };
    assert.equal(rankCandidates("z", [a, b])[0].id, 9);
});

test("meaning keys take the shape glossKeys are stored in", () => {
    assert.equal(meaningKey("To Eat"), "eat");
    assert.equal(meaningKey("the Sword (weapon)"), "sword");
    assert.equal(meaningKey("!!"), null);
});

/* ------------------------------------------------------------------ */
/* articles                                                            */
/* ------------------------------------------------------------------ */

test("definite articles show gender", () => {
    const cases: [string, string, string | null, string][] = [
        ["es", "pozo", "masculine", "el pozo"],
        ["es", "casa", "feminine", "la casa"],
        ["es", "agua", "feminine", "el agua"],
        ["es", "águila", "feminine", "el águila"],
        ["fr", "puits", "masculine", "le puits"],
        ["fr", "fontaine", "feminine", "la fontaine"],
        ["fr", "arbre", "masculine", "l'arbre"],
        ["fr", "eau", "feminine", "l'eau"],
        ["fr", "hôtel", "masculine", "l'hôtel"],
        ["fr", "héros", "masculine", "le héros"],
        ["fr", "haie", "feminine", "la haie"],
        ["it", "libro", "masculine", "il libro"],
        ["it", "studente", "masculine", "lo studente"],
        ["it", "zaino", "masculine", "lo zaino"],
        ["it", "gnomo", "masculine", "lo gnomo"],
        ["it", "psicologo", "masculine", "lo psicologo"],
        ["it", "amico", "masculine", "l'amico"],
        ["it", "acqua", "feminine", "l'acqua"],
        ["it", "casa", "feminine", "la casa"],
        ["it", "scuola", "feminine", "la scuola"],
        ["pt", "poço", "masculine", "o poço"],
        ["pt", "ponte", "feminine", "a ponte"],
        ["de", "Brunnen", "masculine", "der Brunnen"],
        ["de", "Brücke", "feminine", "die Brücke"],
        ["de", "Haus", "neuter", "das Haus"],
        ["es", "pozo", null, "pozo"],
        ["de", "Leute", "common", "Leute"],
        ["ja", "井戸", "masculine", "井戸"],
        ["ko", "학교", null, "학교"],
        ["zh", "桥", null, "桥"],
    ];
    for (const [lang, lemma, gender, want] of cases) assert.equal(articleForm(lang, lemma, gender), want, `${lang} ${lemma}`);
    assert.equal(definiteArticle("es", "casa", "neuter"), null);
});

test("label hints: kana for Japanese, pinyin for Mandarin, romanisation for Korean", () => {
    assert.equal(labelHint("ja", { lemma: "井戸", reading: "いど", roman: "ido" }), "いど");
    assert.equal(labelHint("ja", { lemma: "ランプ", reading: "ランプ", roman: "ranpu" }), null);
    assert.equal(labelHint("zh", { lemma: "桥", reading: "qiáo", roman: "qiáo" }), "qiáo");
    assert.equal(labelHint("ko", { lemma: "다리", reading: null, roman: "dari" }), "dari");
    assert.equal(labelHint("es", { lemma: "puente", reading: null, roman: null }), null);
});

/* ------------------------------------------------------------------ */
/* the learner                                                         */
/* ------------------------------------------------------------------ */

test("immersion climbs with known words plus the starting credit", () => {
    const at = (known: number, start = 0, bias = 0) => immersionFor(known, start, bias).level;
    assert.deepEqual([0, 19, 20, 79, 80, 249, 250, 699, 700, 1799, 1800, 99999].map((k) => at(k)),
        [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    assert.equal(at(0, 1), 2, "150 credited words");
    assert.equal(at(0, 2), 3, "600");
    assert.equal(at(0, 3), 4, "1500");
    assert.equal(at(300, 3), 5);
    assert.equal(at(0, 0, -1), 0, "clamped at 0");
    assert.equal(at(20, 0, -1), 0);
    assert.equal(at(20, 0, 1), 2);
    assert.equal(at(5000, 0, 1), 5, "clamped at 5");
});

test("toNext measures progress through the current band", () => {
    assert.equal(immersionFor(0, 0, 0).toNext, 0);
    assert.equal(immersionFor(10, 0, 0).toNext, 0.5);
    assert.equal(immersionFor(20, 0, 0).toNext, 0);
    assert.equal(immersionFor(50, 0, 0).toNext, 0.5);
    assert.equal(immersionFor(1800, 0, 0).toNext, 1);
    assert.equal(immersionFor(700, 0, 1).toNext, 1, "level 5 through bias is full");
});

test("streaks: yesterday extends, today holds, anything older restarts", () => {
    const now = new Date("2026-09-27T00:30:00Z");
    assert.equal(utcDay(now), "2026-09-27");
    assert.equal(nextStreak("2026-09-26", 4, now), 5);
    assert.equal(nextStreak("2026-09-27", 4, now), 4);
    assert.equal(nextStreak("2026-09-25", 4, now), 1);
    assert.equal(nextStreak(null, 0, now), 1);
});

test("one entry per headword, never unteachable, never an essay for a gloss", () => {
    const e = (id: number, lemma: string, gloss = "x", teachable = true) => ({ entry: { id, lemma, gloss, teachable } });
    const kept = dedupeByLemma([
        e(1, "que"), e(2, "que"), e(3, "Que"), e(4, "casa", "x", false), e(5, "casa"),
        e(6, "largo", "a very long definition that goes on and on well past sixty characters"), e(7, "pan"),
    ]);
    assert.deepEqual(kept.map((k) => k.entry.id), [1, 5, 7]);
});

/* ------------------------------------------------------------------ */
/* curation                                                            */
/* ------------------------------------------------------------------ */

function raw(lemma: string, pos: string, gloss: string): RawEntry {
    return {
        lemma, pos, gloss, reading: null, roman: null, ipa: null, gender: null, teachable: true, audioUrl: null,
        senses: [{ g: gloss, ex: [{ t: "old one", n: "o1" }, { t: "old two", n: "o2" }] }], forms: new Set([lemma]), weight: 0,
    };
}

test("curation drops rejected words from teaching and revises kept ones", () => {
    const entries = [raw("sein", "verb", "forms the present perfect"), raw("pollo", "adj", "inexperienced"), raw("casa", "noun", "house")];
    const curation: Record<string, Curation> = {
        "sein\tverb": { keep: true, gloss: "to be", example: "Ich bin müde.", exampleEn: "I am tired." },
        "pollo\tadj": { keep: false, gloss: "inexperienced", example: null, exampleEn: null },
    };
    assert.deepEqual(applyCuration(entries, curation), { dropped: 1, revised: 1 });
    assert.equal(entries[0].gloss, "to be");
    assert.deepEqual(entries[0].senses[0].ex, [{ t: "Ich bin müde.", n: "I am tired." }, { t: "old one", n: "o1" }]);
    assert.equal(entries[1].teachable, false);
    assert.equal(entries[2].gloss, "house", "untouched");
});

test("curation answers are validated before they are trusted", () => {
    const sent = new Set(["e1", "e2"]);
    const ok = { key: "e1", keep: true, gloss: "to eat", example: "Como pan.", exampleEn: "I eat bread." };
    assert.deepEqual(validateItem(ok, "es", sent), { keep: true, gloss: "to eat", example: "Como pan.", exampleEn: "I eat bread." });
    assert.equal(validateItem({ ...ok, key: "e9" }, "es", sent), null, "a key we never sent");
    assert.equal(validateItem({ ...ok, gloss: "" }, "es", sent), null);
    assert.equal(validateItem({ ...ok, gloss: "x".repeat(61) }, "es", sent), null);
    assert.equal(validateItem({ ...ok, example: null }, "es", sent), null);
    assert.equal(validateItem({ ...ok, example: "I eat bread." }, "es", sent), null, "the translation twice");
    assert.equal(validateItem({ ...ok, example: "I eat bread." }, "ja", sent), null, "English where Japanese belongs");
    assert.ok(validateItem({ ...ok, example: "パンを食べる。" }, "ja", sent));
    assert.equal(validateItem({ ...ok, example: "I eat." }, "ko", sent), null);
    // a rejected word keeps its verdict even when the model left the gloss empty
    assert.deepEqual(validateItem({ key: "e2", keep: false, gloss: "", example: null, exampleEn: null }, "es", sent, "a voucher"),
        { keep: false, gloss: "a voucher", example: null, exampleEn: null });
});
