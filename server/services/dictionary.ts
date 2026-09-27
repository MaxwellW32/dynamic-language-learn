import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dictEntries, dictForms, type DictEntry } from "@/db/schema";
import { glossKeysOf, type WordCard } from "@/game/dictionary";
import { LANGUAGES, normalizeForm, type LangCode } from "@/game/languages";
import { entryIdsIn, type Segment, type Token } from "@/game/segments";

/*
 * The dictionary at run time: word cards, form → headword lookups with the
 * fallbacks real text needs, tokenising target-language text so every word is
 * tappable, and "which words mean X?" for scenes and world labels.
 *
 * Every function here runs a fixed, small number of queries however long its
 * input — never one query per word.
 */

/** the largest candidate list sent in one `form = ANY(...)` query */
const FORM_CHUNK = 4000;
/** longest dictionary form tried when cutting unspaced text into words */
const MAX_UNSPACED_WORD = 8;

/* ------------------------------------------------------------------ */
/* pure helpers (exported for tests)                                   */
/* ------------------------------------------------------------------ */

/** the ranking fields a candidate needs, so light queries can rank without loading senses */
type Rankable = { id: number; lemma: string; freqRank: number | null; teachable: boolean };

/**
 * The best of several headwords a written form could belong to: the one whose
 * own headword *is* the form ("como" the adverb before "comer", of which it is
 * also a form), then the most common, then one fit to teach.
 */
export function rankCandidates<T extends Rankable>(form: string, candidates: T[]): T[] {
    const key = normalizeForm(form);
    const score = (c: T) => (normalizeForm(c.lemma) === key ? 0 : 1);
    return [...candidates].sort((a, b) =>
        score(a) - score(b) ||
        (a.freqRank ?? Number.MAX_SAFE_INTEGER) - (b.freqRank ?? Number.MAX_SAFE_INTEGER) ||
        Number(b.teachable) - Number(a.teachable) ||
        a.id - b.id);
}

const ELISIONS = ["qu'", "l'", "d'", "j'", "n'", "s'", "m'", "t'", "c'"];

const ACUTE: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ê: "e", â: "a", ô: "o" };
const deaccent = (text: string) => text.replace(/[áéíóúêâô]/g, (c) => ACUTE[c]);

/** pronouns glued to the end of a verb: "dámelo" = da + me + lo */
const CLITIC_FIRST: Record<string, string[]> = {
    es: ["me", "te", "se", "nos", "os"],
    it: ["me", "te", "se", "ce", "ve", "glie"],
};
const CLITIC_LAST: Record<string, string[]> = {
    es: ["lo", "la", "los", "las", "le", "les", "me", "te", "se", "nos", "os"],
    it: ["lo", "la", "li", "le", "ne", "mi", "ti", "si", "ci", "vi", "gli"],
    pt: ["lo", "la", "los", "las", "lhe", "lhes", "me", "te", "se", "nos", "o", "a", "os", "as"],
};

function cliticEndings(lang: string): string[] {
    const last = CLITIC_LAST[lang] ?? [];
    const first = CLITIC_FIRST[lang] ?? [];
    const combined = first.flatMap((a) => last.filter((b) => ["lo", "la", "los", "las", "li", "le", "ne"].includes(b)).map((b) => a + b));
    // longest first, so "-melo" is tried before "-lo"
    return [...new Set([...combined, ...last])].sort((a, b) => b.length - a.length);
}

/**
 * Candidate verb forms under a word with pronouns attached. Stripping the
 * pronoun often leaves a written accent that only existed because of it
 * ("dá-melo" → "dá" → "da"); Italian infinitives also lose their final -e
 * ("mangiarlo" → "mangiar" → "mangiare") and some imperatives double the
 * consonant ("dammi" → "dam" → "da").
 */
export function stripClitics(lang: string, word: string): string[] {
    if (lang !== "es" && lang !== "it" && lang !== "pt") return [];
    const out: string[] = [];
    const add = (stem: string) => {
        if ([...stem].length >= 2 && stem !== word && !out.includes(stem)) out.push(stem);
    };
    for (const ending of cliticEndings(lang)) {
        if (!word.endsWith(ending)) continue;
        const stem = word.slice(0, -ending.length);
        if ([...stem].length < 2) continue;
        add(stem);
        add(deaccent(stem));
        if (lang === "it") {
            if (/(ar|er|ir)$/.test(stem)) add(stem + "e");
            // "dammi" = da + mmi: the pronoun's first consonant is doubled onto the stem
            if (stem.endsWith(ending[0]) && !/[aeiou]/.test(ending[0])) add(stem.slice(0, -1));
        }
    }
    return out;
}

/** particles that attach to the end of a Korean word, longest first */
const KO_PARTICLES = ["이에요", "입니다", "에게", "에서", "한테", "까지", "부터", "으로", "예요", "은", "는", "이", "가", "을", "를", "에", "의", "도", "로", "와", "과", "만"]
    .sort((a, b) => b.length - a.length);

export function stripKoreanParticle(word: string): string[] {
    const out: string[] = [];
    for (const particle of KO_PARTICLES) {
        if (word.length > particle.length && word.endsWith(particle)) {
            const stem = word.slice(0, -particle.length);
            if (!out.includes(stem)) out.push(stem);
        }
    }
    return out;
}

/**
 * What else to look up when a written form is not in the dictionary, most
 * likely first: elided articles and pronouns (French, Italian), the part after
 * an apostrophe, the part before a hyphen, glued-on pronouns (Spanish,
 * Italian, Portuguese), one trailing particle (Korean). German needs nothing
 * extra: forms are stored lower-cased, so "Haus" and "haus" already meet.
 */
export function fallbackForms(lang: string, surface: string): string[] {
    const form = normalizeForm(surface);
    const out: string[] = [];
    const add = (candidate: string) => {
        const normalized = normalizeForm(candidate);
        if (normalized.length > 0 && normalized !== form && !out.includes(normalized)) out.push(normalized);
    };
    if (form.length === 0) return out;

    // typographic apostrophes, as a storyteller writes them
    const plain = form.replace(/’/g, "'");
    if (plain !== form) add(plain);

    if (plain.includes("'")) {
        if (lang === "fr" || lang === "it") {
            for (const elision of ELISIONS) if (plain.startsWith(elision)) add(plain.slice(elision.length));
        }
        add(plain.slice(plain.lastIndexOf("'") + 1));
    }

    if (plain.includes("-")) {
        const [head, ...rest] = plain.split("-");
        add(head);
        // Portuguese "fazê-lo" = fazer + o: the infinitive loses its -r before -lo
        if (lang === "pt" && rest.length > 0 && /^l/.test(rest[0])) add(deaccent(head) + "r");
        if (lang === "pt") add(deaccent(head));
    }

    for (const stem of stripClitics(lang, plain)) add(stem);
    if (lang === "ko") for (const stem of stripKoreanParticle(plain)) add(stem);
    return out;
}

export type TextRun = { s: string; word: boolean };

/** a word of a spaced language, apostrophes and hyphens inside it included */
const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;

/** split spaced text into word and non-word runs that concatenate back to the input exactly */
export function splitSpaced(text: string): TextRun[] {
    const runs: TextRun[] = [];
    let cursor = 0;
    for (const match of text.matchAll(WORD_RE)) {
        const at = match.index ?? 0;
        if (at > cursor) runs.push({ s: text.slice(cursor, at), word: false });
        runs.push({ s: match[0], word: true });
        cursor = at + match[0].length;
    }
    if (cursor < text.length) runs.push({ s: text.slice(cursor), word: false });
    return runs;
}

const BREAKS_WORD = /[\s\p{P}\p{S}]/u;

/** every substring (1..max characters, no spaces or punctuation) a forward match could use */
export function unspacedCandidates(text: string, max = MAX_UNSPACED_WORD): string[] {
    const chars = Array.from(text);
    const out = new Set<string>();
    for (let i = 0; i < chars.length; i++) {
        let piece = "";
        for (let length = 1; length <= max && i + length <= chars.length; length++) {
            const char = chars[i + length - 1];
            if (BREAKS_WORD.test(char)) break;
            piece += char;
            out.add(normalizeForm(piece));
        }
    }
    out.delete("");
    return [...out];
}

/**
 * Forward maximum matching: walk left to right, taking the longest known form
 * at each position. A character that starts no known form stands alone,
 * without a dictionary link.
 */
export function forwardMaxMatch(text: string, known: (form: string) => number | undefined, max = MAX_UNSPACED_WORD): Token[] {
    const chars = Array.from(text);
    const tokens: Token[] = [];
    let i = 0;
    while (i < chars.length) {
        let taken = 0;
        let id: number | undefined;
        if (!BREAKS_WORD.test(chars[i])) {
            for (let length = Math.min(max, chars.length - i); length >= 1; length--) {
                const piece = chars.slice(i, i + length);
                if (piece.some((c) => BREAKS_WORD.test(c))) continue;
                const hit = known(normalizeForm(piece.join("")));
                if (hit !== undefined) {
                    taken = length;
                    id = hit;
                    break;
                }
            }
        }
        if (taken === 0) {
            tokens.push({ s: chars[i] });
            i++;
        } else {
            tokens.push({ s: chars.slice(i, i + taken).join(""), id });
            i += taken;
        }
    }
    return tokens;
}

/* ------------------------------------------------------------------ */
/* cards                                                               */
/* ------------------------------------------------------------------ */

export function toCard(entry: DictEntry): WordCard {
    return {
        id: entry.id,
        lang: entry.lang,
        lemma: entry.lemma,
        pos: entry.pos,
        reading: entry.reading,
        roman: entry.roman,
        ipa: entry.ipa,
        gender: entry.gender,
        gloss: entry.gloss,
        senses: entry.senses,
        level: entry.level,
        audioUrl: entry.audioUrl,
    };
}

export async function entriesByIds(ids: number[]): Promise<DictEntry[]> {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
    if (unique.length === 0) return [];
    const rows = await db.select().from(dictEntries)
        .where(sql`${dictEntries.id} = any(${sql.param(unique)}::int[])`);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return unique.flatMap((id) => byId.get(id) ?? []);
}

/** word cards in the order asked for; unknown ids are dropped */
export async function cardsFor(ids: number[]): Promise<WordCard[]> {
    return (await entriesByIds(ids)).map(toCard);
}

/** the cards for every dictionary word some pieces of story text touch */
export async function cardsForSegments(groups: Segment[][]): Promise<WordCard[]> {
    return cardsFor(groups.flatMap((segments) => entryIdsIn(segments)));
}

/* ------------------------------------------------------------------ */
/* form lookups                                                        */
/* ------------------------------------------------------------------ */

/** full entries for each of these normalised forms */
async function entriesForForms(lang: LangCode, forms: string[]): Promise<Map<string, DictEntry[]>> {
    const byForm = new Map<string, DictEntry[]>();
    const unique = [...new Set(forms)].filter((f) => f.length > 0);
    for (let i = 0; i < unique.length; i += FORM_CHUNK) {
        const chunk = unique.slice(i, i + FORM_CHUNK);
        const rows = await db
            .select({ form: dictForms.form, entry: dictEntries })
            .from(dictForms)
            .innerJoin(dictEntries, eq(dictEntries.id, dictForms.entryId))
            .where(and(eq(dictForms.lang, lang), sql`${dictForms.form} = any(${sql.param(chunk)}::text[])`));
        for (const row of rows) {
            const list = byForm.get(row.form);
            if (list) list.push(row.entry);
            else byForm.set(row.form, [row.entry]);
        }
    }
    return byForm;
}

/** the same, carrying only what ranking needs — tokenising touches many forms and never needs senses */
async function rankablesForForms(lang: LangCode, forms: string[]): Promise<Map<string, Rankable[]>> {
    const byForm = new Map<string, Rankable[]>();
    const unique = [...new Set(forms)].filter((f) => f.length > 0);
    for (let i = 0; i < unique.length; i += FORM_CHUNK) {
        const chunk = unique.slice(i, i + FORM_CHUNK);
        const rows = await db
            .select({
                form: dictForms.form,
                id: dictEntries.id,
                lemma: dictEntries.lemma,
                freqRank: dictEntries.freqRank,
                teachable: dictEntries.teachable,
            })
            .from(dictForms)
            .innerJoin(dictEntries, eq(dictEntries.id, dictForms.entryId))
            .where(and(eq(dictForms.lang, lang), sql`${dictForms.form} = any(${sql.param(chunk)}::text[])`));
        for (const { form, ...entry } of rows) {
            const list = byForm.get(form);
            if (list) list.push(entry);
            else byForm.set(form, [entry]);
        }
    }
    return byForm;
}

/**
 * Every headword a written form may belong to, best first. When the form
 * itself is unknown, the fallbacks are tried (all in one query) and the first
 * that finds anything is used.
 */
export async function lookupAll(lang: LangCode, surface: string, limit = 10): Promise<DictEntry[]> {
    const form = normalizeForm(surface);
    if (form.length === 0) return [];
    const direct = await entriesForForms(lang, [form]);
    const hits = direct.get(form);
    if (hits && hits.length > 0) return rankCandidates(form, hits).slice(0, limit);

    const fallbacks = fallbackForms(lang, surface);
    if (fallbacks.length === 0) return [];
    const found = await entriesForForms(lang, fallbacks);
    for (const candidate of fallbacks) {
        const list = found.get(candidate);
        if (list && list.length > 0) return rankCandidates(candidate, list).slice(0, limit);
    }
    return [];
}

/** the one headword a written form most likely belongs to */
export async function lookupForm(lang: LangCode, surface: string): Promise<DictEntry | null> {
    return (await lookupAll(lang, surface, 1))[0] ?? null;
}

/**
 * A short phrase that is itself a dictionary entry ("buenos días"). The
 * tokeniser always links words one by one; whether to also offer the whole
 * phrase is the caller's choice.
 */
export async function lookupPhrase(lang: LangCode, text: string): Promise<DictEntry | null> {
    const form = normalizeForm(text).replace(/\s+/g, " ");
    if (form.length === 0) return null;
    if (LANGUAGES[lang].spaced ? form.split(" ").length > 4 : Array.from(form).length > 12) return null;
    const hits = (await entriesForForms(lang, [form])).get(form);
    return hits && hits.length > 0 ? rankCandidates(form, hits)[0] : null;
}

/**
 * Cut target-language text into tokens whose `s` values concatenate back to
 * the text exactly; words found in the dictionary carry their entry id.
 */
export async function tokenize(lang: LangCode, text: string): Promise<Token[]> {
    if (text.length === 0) return [];

    if (!LANGUAGES[lang].spaced) {
        const hits = await rankablesForForms(lang, unspacedCandidates(text));
        const best = new Map<string, number>();
        for (const [form, list] of hits) best.set(form, rankCandidates(form, list)[0].id);
        return forwardMaxMatch(text, (form) => best.get(form));
    }

    const runs = splitSpaced(text);
    const words = [...new Set(runs.filter((r) => r.word).map((r) => normalizeForm(r.s)))];
    const direct = await rankablesForForms(lang, words);
    const idOf = new Map<string, number>();
    for (const [form, list] of direct) idOf.set(form, rankCandidates(form, list)[0].id);

    // one more query for everything the first missed
    const missed = words.filter((w) => !idOf.has(w));
    if (missed.length > 0) {
        const tries = new Map(missed.map((w) => [w, fallbackForms(lang, w)]));
        const found = await rankablesForForms(lang, [...tries.values()].flat());
        for (const [word, candidates] of tries) {
            for (const candidate of candidates) {
                const list = found.get(candidate);
                if (list && list.length > 0) {
                    idOf.set(word, rankCandidates(candidate, list)[0].id);
                    break;
                }
            }
        }
    }

    return runs.map((run) => {
        if (!run.word) return { s: run.s };
        const id = idOf.get(normalizeForm(run.s));
        return id === undefined ? { s: run.s } : { s: run.s, id };
    });
}

/**
 * Remember how the storyteller's own spelling maps to a headword, so the next
 * lookup of it needs no model call.
 */
export async function rememberForm(lang: LangCode, surface: string, entryId: number): Promise<void> {
    const form = normalizeForm(surface);
    if (form.length === 0) return;
    await db.insert(dictForms).values({ lang, form, entryId, source: "ai" }).onConflictDoNothing();
}

/* ------------------------------------------------------------------ */
/* lookups by meaning                                                  */
/* ------------------------------------------------------------------ */

/** "To Eat", "the sword" → "eat", "sword": the shape `glossKeys` are stored in */
export function meaningKey(text: string): string | null {
    return glossKeysOf(text)[0] ?? null;
}

export type MeaningOptions = {
    /** highest CEFR-like level (1–6) allowed */
    maxLevel?: number;
    pos?: string[];
    limit?: number;
    teachableOnly?: boolean;
    /** leave out headwords this user already has progress on (used by the vocab planner) */
    excludeKnownBy?: string;
};

/**
 * Words whose meaning is one of `keys`, most common first. Each key gets its
 * share of the result (round-robin), so one very common meaning cannot crowd
 * out the others. One query however many keys.
 */
export async function wordsMeaning(lang: LangCode, keys: string[], opts: MeaningOptions = {}): Promise<DictEntry[]> {
    const normalized = [...new Set(keys.map((k) => meaningKey(k)).filter((k): k is string => k !== null))];
    if (normalized.length === 0) return [];
    const limit = Math.max(1, Math.min(opts.limit ?? 20, 200));

    const filters = [sql`e.lang = ${lang}`, sql`e."glossKeys" @> array[k.key]`];
    if (opts.maxLevel !== undefined) filters.push(sql`e.level <= ${opts.maxLevel}`);
    if (opts.pos && opts.pos.length > 0) filters.push(sql`e.pos = any(${sql.param(opts.pos)}::text[])`);
    if (opts.teachableOnly) filters.push(sql`e.teachable`);
    if (opts.excludeKnownBy) {
        filters.push(sql`not exists (
            select 1 from word_progress w join dict_entries seen on seen.id = w."entryId"
            where w."userId" = ${opts.excludeKnownBy} and seen.lang = e.lang and seen.lemma = e.lemma)`);
    }

    const result = await db.execute<DictEntry & { matchedKey: string }>(sql`
        select k.key as "matchedKey", e.*
        from unnest(${sql.param(normalized)}::text[]) with ordinality as k(key, ord)
        cross join lateral (
            select * from dict_entries e
            where ${sql.join(filters, sql` and `)}
            order by e."freqRank" asc nulls last, e.id
            limit ${limit}
        ) e
        order by k.ord`);

    const perKey = new Map<string, DictEntry[]>();
    for (const { matchedKey, ...entry } of result.rows) {
        const list = perKey.get(matchedKey);
        if (list) list.push(entry);
        else perKey.set(matchedKey, [entry]);
    }
    const lists = normalized.map((k) => perKey.get(k) ?? []);
    const out: DictEntry[] = [];
    const seen = new Set<number>();
    for (let round = 0; out.length < limit && lists.some((l) => l.length > round); round++) {
        for (const list of lists) {
            const entry = list[round];
            if (!entry || seen.has(entry.id)) continue;
            seen.add(entry.id);
            out.push(entry);
            if (out.length === limit) break;
        }
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* search (the word-book's search box)                                 */
/* ------------------------------------------------------------------ */

/**
 * Search by written form, by headword prefix, or by English meaning. Exact
 * form matches come first, then headwords starting with the query, then words
 * meaning it; each group most common first.
 */
export async function searchDictionary(lang: LangCode, query: string, limit = 20): Promise<WordCard[]> {
    const form = normalizeForm(query).replace(/\s+/g, " ");
    if (form.length === 0) return [];
    const cap = Math.max(1, Math.min(limit, 50));

    // headwords are stored as written (German nouns capitalised), so the prefix is tried both ways
    const prefixes = [...new Set([form, form.charAt(0).toUpperCase() + form.slice(1)])];
    const prefixFilter = sql.join(
        prefixes.map((p) => sql`(e.lemma >= ${p} and e.lemma < ${p + "￿"})`),
        sql` or `,
    );
    const key = meaningKey(query);

    const [exact, prefix, meaning] = await Promise.all([
        entriesForForms(lang, [form]).then((m) => rankCandidates(form, m.get(form) ?? [])),
        form.length < 2 ? Promise.resolve([] as DictEntry[]) : db.execute<DictEntry>(sql`
            select e.* from dict_entries e
            where e.lang = ${lang} and (${prefixFilter})
            order by e."freqRank" asc nulls last, length(e.lemma), e.id
            limit ${cap}`).then((r) => r.rows),
        key === null ? Promise.resolve([] as DictEntry[]) : db.execute<DictEntry>(sql`
            select e.* from dict_entries e
            where e.lang = ${lang} and e."glossKeys" @> array[${key}]::text[]
            order by e."freqRank" asc nulls last, e.id
            limit ${cap}`).then((r) => r.rows),
    ]);

    const out: DictEntry[] = [];
    const seen = new Set<number>();
    for (const entry of [...exact, ...prefix, ...meaning]) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        out.push(entry);
        if (out.length === cap) break;
    }
    return out.map(toCard);
}
