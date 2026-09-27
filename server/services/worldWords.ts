import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { DictEntry } from "@/db/schema";
import type { LangCode } from "@/game/languages";
import { LANDMARK_KINDS } from "@/game/looks";
import type { WorldLabel } from "@/game/payloads";

/*
 * World words: the target-language label floating over a landmark ("el pozo"
 * over the well). Chosen from the dictionary by meaning, so labelling a whole
 * region is one query and no model call.
 */

/* ------------------------------------------------------------------ */
/* articles (pure, exported for tests)                                 */
/* ------------------------------------------------------------------ */

const VOWEL_START = /^[aeiouàâäáéèêëíîïóôöúùûüœæ]/i;

/** French words whose h is "aspirated": they take le/la, not l' */
const FR_ASPIRATED_H = new Set([
    "hache", "haie", "haine", "hall", "halle", "hamac", "hameau", "hamster", "hanche", "handicap",
    "hangar", "hareng", "haricot", "harpe", "hasard", "hausse", "haut", "hauteur", "hérisson", "héros",
    "hêtre", "hibou", "hockey", "homard", "honte", "hors", "housse", "hublot", "huit", "hurlement",
    "hutte", "harpon", "havre", "haillon", "halte", "hotte", "houx", "héron",
]);

/**
 * Feminine Spanish nouns that begin with a stressed a- take "el" in the
 * singular (el agua, el alma) — a written accent on the first a marks the
 * rest of the pattern.
 */
const ES_STRESSED_A = new Set([
    "agua", "alma", "arma", "hambre", "hacha", "ave", "aula", "ala", "hada", "ancla", "asa",
    "arca", "alba", "haba", "área", "águila", "ánima", "arpa", "habla", "aria",
]);

function frenchElides(word: string): boolean {
    const lower = word.toLowerCase();
    if (VOWEL_START.test(lower)) return true;
    return lower.startsWith("h") && !FR_ASPIRATED_H.has(lower);
}

/** "lo" before s+consonant, z, gn, ps, pn, x, y (lo studente, lo zaino, lo gnomo) */
function italianTakesLo(word: string): boolean {
    const lower = word.toLowerCase();
    return /^(s[^aeiouàèéìòù]|z|gn|ps|pn|x|y)/.test(lower);
}

/**
 * The definite article that shows a noun's gender, or null when the language
 * has none or the gender is unknown. French and Italian elide onto the noun
 * ("l'eau"), which the caller signals by `joined`.
 */
export function definiteArticle(lang: string, lemma: string, gender: string | null): { article: string; joined: boolean } | null {
    if (!gender || gender === "common") return null;
    const masculine = gender === "masculine";
    const feminine = gender === "feminine";
    const neuter = gender === "neuter";

    switch (lang) {
        case "es":
            if (masculine) return { article: "el", joined: false };
            if (feminine) return { article: ES_STRESSED_A.has(lemma.toLowerCase()) ? "el" : "la", joined: false };
            return null;
        case "pt":
            if (masculine) return { article: "o", joined: false };
            if (feminine) return { article: "a", joined: false };
            return null;
        case "fr":
            if (!masculine && !feminine) return null;
            if (frenchElides(lemma)) return { article: "l'", joined: true };
            return { article: masculine ? "le" : "la", joined: false };
        case "it":
            if (!masculine && !feminine) return null;
            if (VOWEL_START.test(lemma)) return { article: "l'", joined: true };
            if (feminine) return { article: "la", joined: false };
            return { article: italianTakesLo(lemma) ? "lo" : "il", joined: false };
        case "de":
            if (masculine) return { article: "der", joined: false };
            if (feminine) return { article: "die", joined: false };
            if (neuter) return { article: "das", joined: false };
            return null;
        default:
            return null;
    }
}

/** the headword as a label: with its definite article where gender is worth learning alongside it */
export function articleForm(lang: string, lemma: string, gender: string | null): string {
    const found = definiteArticle(lang, lemma, gender);
    if (!found) return lemma;
    return found.joined ? `${found.article}${lemma}` : `${found.article} ${lemma}`;
}

export function withArticle(lang: LangCode, entry: DictEntry): string {
    // only nouns carry grammatical gender in the dictionary; anything else stays bare
    if (entry.pos !== "noun") return entry.lemma;
    // a German adjective changes with the article ("Schwarzes Brett" → "das Schwarze Brett"); show the headword as is
    if (lang === "de" && entry.lemma.includes(" ")) return entry.lemma;
    return articleForm(lang, entry.lemma, entry.gender);
}

/** reading for Japanese, pinyin for Mandarin, romanisation for Korean */
export function labelHint(lang: string, entry: Pick<DictEntry, "lemma" | "reading" | "roman">): string | null {
    if (lang === "ja") return entry.reading && entry.reading !== entry.lemma ? entry.reading : null;
    if (lang === "zh") return entry.reading;
    if (lang === "ko") return entry.roman;
    return null;
}

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

/** CC-CEDICT gives no part of speech: most of its nouns are filed as plain "word" */
const NOUN_POS: Record<string, string[]> = { zh: ["noun", "word"] };

function toLabel(lang: LangCode, entry: DictEntry): WorldLabel {
    return { entryId: entry.id, text: withArticle(lang, entry), hint: labelHint(lang, entry) };
}

/** how many times more common a word must be to win with the kind as a side meaning rather than its first */
const SIDE_MEANING_PENALTY = 4;

/**
 * Where looking a thing up by its English name finds the wrong word, the
 * right one is simply stated. English "well" is also an adverb, "chest" also a
 * body part, "bench" a seat of any kind — and a dictionary cannot know that
 * the question was about the thing in the village square.
 */
const HEADWORDS: Partial<Record<LangCode, Record<string, string>>> = {
    es: { bench: "banco", chest: "cofre", noticeboard: "tablón", pond: "estanque", shrine: "santuario" },
    fr: { chest: "coffre", barrel: "tonneau", pond: "étang" },
    de: { chest: "Truhe", lantern: "Laterne", crystal: "Kristall", arch: "Bogen" },
    it: { chest: "baule", pond: "stagno", signpost: "cartello", arch: "arco" },
    pt: { bench: "banco", chest: "baú", lantern: "lanterna", signpost: "placa", fountain: "fonte" },
    ja: { chest: "宝箱", barrel: "樽", shrine: "神社", fountain: "噴水", bench: "ベンチ", cart: "荷車" },
    ko: { chest: "상자", shrine: "사당", fountain: "분수", stall: "시장", cart: "수레" },
    zh: { well: "井", chest: "箱子", noticeboard: "布告栏", arch: "拱门" },
};

/**
 * Labels for many landmark kinds in one query. Each kind offers English nouns
 * best first ("signpost", "road sign", "sign"); the first of them that finds
 * a label wins, so a specific word is used when the language has one and a
 * broader one only when it does not. For each English noun: a teachable noun
 * whose `glossKeys` hold it (the importer puts the short gloss's keys first,
 * then the first sense's). A single word beats a phrase; then the most
 * common, where a word for which this is only a side meaning must be four
 * times as common to win (fuente "spring, fountain" beats the rare fontana;
 * the rare 井 "well" beats the common 吹き抜け "atrium, well").
 */
export async function labelsForKinds(lang: LangCode, kinds: string[]): Promise<Map<string, WorldLabel>> {
    const english = new Map<string, readonly string[]>();
    for (const kind of new Set(kinds)) {
        const nouns = (LANDMARK_KINDS as Record<string, readonly string[]>)[kind];
        if (nouns && nouns.length > 0) english.set(kind, nouns);
    }
    const out = new Map<string, WorldLabel>();
    if (english.size === 0) return out;
    const pos = NOUN_POS[lang] ?? ["noun"];

    // the words that are simply stated come first; whatever they do not cover is looked up by meaning
    const stated = Object.entries(HEADWORDS[lang] ?? {}).filter(([kind]) => english.has(kind));
    if (stated.length > 0) {
        const found = await db.execute<DictEntry>(sql`
            select distinct on (e.lemma) e.*
            from dict_entries e
            where e.lang = ${lang} and e.lemma = any(${sql.param(stated.map(([, lemma]) => lemma))}::text[])
              and e.pos = any(${sql.param(pos)}::text[])
            order by e.lemma, coalesce(e."freqRank", 1000000000), e.id`);
        const byLemma = new Map(found.rows.map((entry) => [entry.lemma, entry]));
        for (const [kind, lemma] of stated) {
            const entry = byLemma.get(lemma);
            if (!entry) continue;
            out.set(kind, toLabel(lang, entry));
            english.delete(kind);
        }
        if (english.size === 0) return out;
    }

    const keys = [...new Set([...english.values()].flat().map((noun) => noun.toLowerCase().trim()))];
    // Japanese suffix fragments (っ気, ー…) are filed as nouns but are not words to hang over a well
    const result = await db.execute<DictEntry & { matchedKey: string }>(sql`
        select distinct on (k.key) k.key as "matchedKey", e.*
        from unnest(${sql.param(keys)}::text[]) as k(key)
        join dict_entries e
          on e.lang = ${lang} and e.teachable and e.pos = any(${sql.param(pos)}::text[])
         and e."glossKeys" @> array[k.key]
        where e.lemma !~ '^[っッーゃゅょャュョ〜~]'
        order by k.key,
                 (position(' ' in e.lemma) > 0),
                 coalesce(e."freqRank", 1000000000)::float8 * (case when e."glossKeys"[1] = k.key then 1 else ${SIDE_MEANING_PENALTY} end),
                 e.id`);

    const byKey = new Map<string, DictEntry>();
    for (const { matchedKey, ...entry } of result.rows) byKey.set(matchedKey, entry);
    for (const [kind, nouns] of english) {
        const entry = nouns.map((noun) => byKey.get(noun.toLowerCase().trim())).find((e) => e !== undefined);
        if (entry) out.set(kind, toLabel(lang, entry));
    }
    return out;
}

export async function labelForLandmark(lang: LangCode, kind: string): Promise<WorldLabel | null> {
    return (await labelsForKinds(lang, [kind])).get(kind) ?? null;
}
