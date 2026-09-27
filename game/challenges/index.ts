import { LANGUAGES, isLangCode } from "../languages";
import {
    CHALLENGE_TYPES, type ChallengeType, type ChallengeWord, type GradeResult,
    type StoredStage, type Submission,
} from "./types";

export * from "./types";

/* ---------------------------------------------------------------- */
/* helpers                                                            */
/* ---------------------------------------------------------------- */

function shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

const COMBINING_ACCENTS = /[̀-ͯ]/g;
const SPACE_AND_PUNCTUATION = /[\s\p{P}\p{S}]/gu;
const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}]";
/** a word of a spaced language, apostrophes and hyphens inside it included */
const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;

/**
 * The forgiving shape of a typed answer: case, spacing, punctuation and
 * accents all ignored. Only the Latin combining accents are dropped — the
 * kana voicing marks (が, ぱ) are part of the letter, not an accent.
 */
export function normalizeAnswer(value: string): string {
    return value
        .normalize("NFD")
        .replace(COMBINING_ACCENTS, "")
        .normalize("NFC")
        .replace(SPACE_AND_PUNCTUATION, "")
        .toLowerCase();
}

/** the strict shape: case, spacing and punctuation ignored, accents and tones kept */
function strictAnswer(value: string): string {
    return value.normalize("NFC").replace(SPACE_AND_PUNCTUATION, "").toLowerCase();
}

function toHiragana(text: string): string {
    let out = "";
    for (const char of text) {
        const code = char.codePointAt(0)!;
        out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
    }
    return out;
}

/**
 * Japanese typed three ways — kanji, kana, rōmaji — and rōmaji itself three
 * ways ("tōkyō", "toukyou", "tokyo"). All of these are the same answer, so the
 * key folds katakana into hiragana and long vowels into one letter. None of
 * this is an accent slip, so it happens before the exact comparison.
 */
function japaneseKey(value: string): string {
    let text = toHiragana(value.normalize("NFC").toLowerCase());
    if (/^[\p{Script=Latin}\s'’\-.]+$/u.test(text)) {
        text = text
            .normalize("NFD").replace(COMBINING_ACCENTS, "").normalize("NFC")
            .replace(/n['’]/g, "n")
            .replace(/ou|oo/g, "o")
            .replace(/uu/g, "u")
            .replace(/aa/g, "a")
            .replace(/ii/g, "i")
            .replace(/ee|ei/g, "e");
    }
    return text.replace(SPACE_AND_PUNCTUATION, "");
}

/** pinyin typed without tone marks, with tone numbers, or with v for ü */
function pinyinLenient(value: string): string {
    return normalizeAnswer(value).replace(/[1-5]/g, "").replace(/v/g, "u");
}

/** the keys a typed answer is compared under: [exact, lenient] */
function answerKeys(value: string, lang: string): { exact: string; lenient: string } {
    if (lang === "ja") {
        const key = japaneseKey(value);
        return { exact: key, lenient: normalizeAnswer(key) };
    }
    if (lang === "zh") return { exact: strictAnswer(value), lenient: pinyinLenient(value) };
    return { exact: strictAnswer(value), lenient: normalizeAnswer(value) };
}

/** every spelling that counts as writing this word */
function acceptedSpellings(word: ChallengeWord): string[] {
    const out = [word.lemma];
    if (word.lang === "ja") {
        if (word.reading) out.push(word.reading);
        if (word.roman) out.push(word.roman);
    } else if (word.lang === "zh") {
        if (word.reading) out.push(word.reading);
        if (word.roman && word.roman !== word.reading) out.push(word.roman);
    } else if (word.lang === "ko") {
        if (word.roman) out.push(word.roman);
    }
    return out.filter((s) => s.trim().length > 0);
}

function isSpaced(lang: string): boolean {
    return isLangCode(lang) ? LANGUAGES[lang].spaced : true;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `text` show `needle` to the player? In a spaced script this means as a
 * whole word ("a" is not visible inside "casa"); in Japanese and Chinese any
 * occurrence counts.
 */
export function revealsWord(text: string | undefined | null, needle: string, spaced = true): boolean {
    if (!text || needle.trim().length === 0) return false;
    const haystack = text.normalize("NFC").toLowerCase();
    const target = needle.normalize("NFC").toLowerCase().trim();
    if (!spaced) return haystack.includes(target);
    const pattern = new RegExp(`(?<!${WORD_CHAR})${escapeRegExp(target)}(?!${WORD_CHAR})`, "u");
    return pattern.test(haystack);
}

const same = (a: string, b: string) => a.normalize("NFC").toLowerCase().trim() === b.normalize("NFC").toLowerCase().trim();

/**
 * Wrong options for a choice. A candidate is refused when it shares the
 * word's headword or meaning: "que" (who) as a wrong answer for "que" (that),
 * or "estar" as a wrong answer for "to be" when "ser" is right, would both be
 * right too.
 */
function distractors(word: ChallengeWord, pool: ChallengeWord[], field: "gloss" | "lemma", n: number): string[] {
    const taken = [word[field]];
    const out: string[] = [];
    for (const candidate of shuffle(pool)) {
        if (candidate.id === word.id) continue;
        if (same(candidate.lemma, word.lemma) || same(candidate.gloss, word.gloss)) continue;
        if (candidate[field].trim().length === 0 || taken.some((t) => same(t, candidate[field]))) continue;
        taken.push(candidate[field]);
        out.push(candidate[field]);
        if (out.length === n) break;
    }
    return out;
}

/** a choice between the answer and three wrong options, or null when the pool cannot supply three */
function fourOptions(word: ChallengeWord, pool: ChallengeWord[], field: "gloss" | "lemma"): string[] | null {
    const wrong = distractors(word, pool, field, 3);
    return wrong.length === 3 ? shuffle([word[field], ...wrong]) : null;
}

function segmenterFor(lang: string): Intl.Segmenter {
    const locale = isLangCode(lang) ? LANGUAGES[lang].locale : lang;
    return new Intl.Segmenter(locale, { granularity: "word" });
}

/**
 * The pieces of a sentence-ordering challenge. Spaced languages split on
 * spaces (punctuation stays on its word). Japanese and Chinese are cut into
 * words by Intl.Segmenter; punctuation joins the piece before it (or after
 * it, at the start) so no tile is a lone "。".
 */
export function sentenceTokens(sentence: string, lang: string): string[] {
    const text = sentence.trim();
    if (isSpaced(lang)) return text.split(/\s+/).filter(Boolean);

    const tokens: string[] = [];
    let pending = "";
    for (const part of segmenterFor(lang).segment(text)) {
        if (part.segment.trim().length === 0) continue;
        if (!part.isWordLike) {
            if (tokens.length === 0) pending += part.segment;
            else tokens[tokens.length - 1] += part.segment;
            continue;
        }
        tokens.push(pending + part.segment);
        pending = "";
    }
    if (pending) {
        if (tokens.length === 0) tokens.push(pending);
        else tokens[tokens.length - 1] += pending;
    }
    return tokens;
}

function commonPrefixLength(a: string, b: string): number {
    const x = [...a];
    const y = [...b];
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    return i;
}

export type Blank = { start: number; end: number; surface: string };

/**
 * Where the word sits in its example sentence. The sentence may inflect it
 * ("comió" for "comer"), so in a spaced language any word sharing the
 * headword's first four letters or more counts. Japanese and Chinese only
 * qualify when the headword itself appears — there is no safe way to guess
 * where an inflection starts and ends without a dictionary at hand.
 */
export function findBlank(example: string, lemma: string, lang: string): Blank | null {
    const text = example.normalize("NFC");
    const target = lemma.normalize("NFC").trim();
    if (target.length === 0) return null;

    if (!isSpaced(lang)) {
        const at = text.indexOf(target);
        return at === -1 ? null : { start: at, end: at + target.length, surface: target };
    }

    const lowerTarget = target.toLowerCase();
    // a multi-word headword ("buenos días") is found as a phrase
    if (/\s/.test(target)) {
        const pattern = new RegExp(`(?<!${WORD_CHAR})${escapeRegExp(lowerTarget)}(?!${WORD_CHAR})`, "u");
        const match = pattern.exec(text.toLowerCase());
        return match ? { start: match.index, end: match.index + match[0].length, surface: text.slice(match.index, match.index + match[0].length) } : null;
    }

    const words = [...text.matchAll(WORD_RE)];
    const exact = words.find((m) => m[0].toLowerCase() === lowerTarget);
    const found = exact ?? ([...lowerTarget].length >= 4
        ? words.find((m) => commonPrefixLength(m[0].toLowerCase(), lowerTarget) >= 4)
        : undefined);
    if (!found || found.index === undefined) return null;
    return { start: found.index, end: found.index + found[0].length, surface: found[0] };
}

/** Levenshtein distance over code points */
function editDistance(a: string, b: string): number {
    const x = [...a];
    const y = [...b];
    let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
        const current = [i];
        for (let j = 1; j <= y.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[y.length];
}

/** 1 = identical, 0 = nothing in common */
export function similarity(a: string, b: string): number {
    const longest = Math.max([...a].length, [...b].length);
    return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

/** what speech recognition may hand back for this word: the headword, and for ja/zh also its reading */
function spokenForms(word: ChallengeWord): string[] {
    const out = [word.lemma];
    if (word.lang === "ja") {
        if (word.reading) out.push(word.reading);
        if (word.roman) out.push(word.roman);
    } else if (word.lang === "zh") {
        if (word.reading) out.push(word.reading);
    } else if (word.lang === "ko" && word.roman) {
        out.push(word.roman);
    }
    return out;
}

const SPEECH_MATCH = 0.8;

/* ---------------------------------------------------------------- */
/* per-type generators                                                */
/* ---------------------------------------------------------------- */

type GeneratorContext = {
    word: ChallengeWord;
    /** the words still waiting for a stage, `word` first */
    queue: ChallengeWord[];
    pool: ChallengeWord[];
};

/** a stage and the words it used up, or null when this type does not fit this word */
type Generated = { stage: StoredStage; used: ChallengeWord[] } | null;

const one = (word: ChallengeWord, stage: StoredStage): Generated => ({ stage, used: [word] });

/**
 * A choice stage is only offered when the answer cannot be read off the
 * question: a word whose meaning is spelled the same ("taxi" = "taxi") would
 * be a free point, not practice.
 */
function leaks(answer: string, texts: (string | undefined)[], spaced: boolean): boolean {
    return texts.some((text) => revealsWord(text, answer, spaced));
}

const generators: Record<ChallengeType, (ctx: GeneratorContext) => Generated> = {
    meaningMatch: ({ word, pool }) => {
        const options = fourOptions(word, pool, "gloss");
        const promptHint = word.reading && word.reading !== word.lemma ? word.reading : word.roman ?? undefined;
        if (!options || leaks(word.gloss, [word.lemma, promptHint], true)) return null;
        return one(word, {
            type: "meaningMatch",
            wordIds: [word.id],
            client: { kind: "choice", prompt: word.lemma, promptHint, question: "What does this word mean?", options },
            answer: { kind: "choice", value: word.gloss },
        });
    },

    reverseMatch: ({ word, pool }) => {
        const options = fourOptions(word, pool, "lemma");
        if (!options || leaks(word.lemma, [word.gloss], isSpaced(word.lang))) return null;
        return one(word, {
            type: "reverseMatch",
            wordIds: [word.id],
            client: { kind: "choice", prompt: word.gloss, question: "Which word means this?", options },
            answer: { kind: "choice", value: word.lemma },
        });
    },

    matching: ({ word, queue }) => {
        const chosen = [word];
        for (const candidate of queue) {
            if (chosen.length === 4) break;
            if (chosen.some((c) => c.id === candidate.id || same(c.lemma, candidate.lemma) || same(c.gloss, candidate.gloss))) continue;
            chosen.push(candidate);
        }
        if (chosen.length < 4) return null;
        // keys are positional on both sides so the pairing cannot be derived client-side
        const left = chosen.map((w, i) => ({ key: `l${i}`, label: w.lemma }));
        const shuffled = shuffle(chosen);
        const right = shuffled.map((w, i) => ({ key: `r${i}`, label: w.gloss }));
        const rightKeyOf = new Map(shuffled.map((w, i) => [w.id, `r${i}`]));
        return {
            used: chosen,
            stage: {
                type: "matching",
                wordIds: chosen.map((w) => w.id),
                client: { kind: "matching", question: "Match each word to its meaning.", left, right: shuffle(right) },
                answer: {
                    kind: "matching",
                    pairs: chosen.map((w, i) => ({ left: `l${i}`, right: rightKeyOf.get(w.id)!, wordId: w.id })),
                },
            },
        };
    },

    spelling: ({ word }) => {
        const spellings = acceptedSpellings(word);
        if (spellings.length === 0 || leaks(word.lemma, [word.gloss], isSpaced(word.lang))) return null;
        const hintSource = word.reading ?? word.lemma;
        const hintLength = [...hintSource].length > 4 ? 2 : 1;
        return one(word, {
            type: "spelling",
            wordIds: [word.id],
            client: {
                kind: "spelling",
                meaning: word.gloss,
                pronunciationHint: `${[...hintSource].slice(0, hintLength).join("")}…`,
                question: "Write the word for:",
            },
            answer: {
                kind: "spelling",
                lang: word.lang,
                exact: [...new Set(spellings.map((s) => answerKeys(s, word.lang).exact))],
                lenient: [...new Set(spellings.map((s) => answerKeys(s, word.lang).lenient))],
                display: word.reading && word.reading !== word.lemma ? `${word.lemma} (${word.reading})` : word.lemma,
            },
        });
    },

    fillBlank: ({ word, pool }) => {
        if (!word.exampleTarget) return null;
        const blank = findBlank(word.exampleTarget, word.lemma, word.lang);
        if (!blank) return null;
        const example = word.exampleTarget.normalize("NFC");
        const prompt = `${example.slice(0, blank.start)}＿＿＿${example.slice(blank.end)}`;
        const promptHint = word.exampleNative ?? undefined;
        const spaced = isSpaced(word.lang);
        // the word must not still be visible elsewhere in the sentence or its translation
        if (leaks(word.lemma, [prompt, promptHint], spaced) || leaks(blank.surface, [prompt], spaced)) return null;
        const options = fourOptions(word, pool, "lemma");
        if (!options) return null;
        const inflected = !same(blank.surface, word.lemma);
        return one(word, {
            type: "fillBlank",
            wordIds: [word.id],
            client: {
                kind: "choice",
                prompt,
                promptHint,
                question: inflected
                    ? "Which word completes the sentence? (It may be changed to fit.)"
                    : "Which word completes the sentence?",
                options,
            },
            answer: { kind: "choice", value: word.lemma, display: inflected ? `${blank.surface} (${word.lemma})` : undefined },
        });
    },

    sentenceOrder: ({ word }) => {
        if (!word.exampleTarget) return null;
        const tokens = sentenceTokens(word.exampleTarget, word.lang);
        if (tokens.length < 3 || tokens.length > 12) return null;
        const sep = isSpaced(word.lang) ? " " : "";
        const sentence = tokens.join(sep);
        // a shuffle that happens to be the answer is no challenge
        let shuffled = shuffle(tokens);
        for (let tries = 0; tries < 10 && shuffled.join(sep) === sentence; tries++) shuffled = shuffle(tokens);
        if (shuffled.join(sep) === sentence) return null;
        return one(word, {
            type: "sentenceOrder",
            wordIds: [word.id],
            client: {
                kind: "order",
                question: "Rebuild the sentence.",
                translation: word.exampleNative ?? word.gloss,
                tokens: shuffled,
            },
            // graded by reconstructed text so identical twin tokens are interchangeable
            answer: { kind: "order", tokens, sep },
        });
    },

    listening: ({ word, pool }) => {
        const options = fourOptions(word, pool, "gloss");
        // hearing "taxi" and picking "taxi" teaches nothing
        if (!options || leaks(word.lemma, [word.gloss], isSpaced(word.lang))) return null;
        return one(word, {
            type: "listening",
            wordIds: [word.id],
            client: { kind: "listen", entryId: word.id, question: "Listen. What does this word mean?", options },
            answer: { kind: "choice", value: word.gloss },
        });
    },

    speaking: ({ word }) => {
        if (!isLangCode(word.lang)) return null;
        const hint = word.lang === "ja" ? word.reading ?? word.roman
            : word.lang === "zh" ? word.reading
            : word.roman;
        return one(word, {
            type: "speaking",
            wordIds: [word.id],
            client: {
                kind: "speak",
                prompt: word.lemma,
                promptHint: hint && hint !== word.lemma ? hint : undefined,
                meaning: word.gloss,
                locale: LANGUAGES[word.lang].locale,
                question: "Say this word aloud.",
            },
            answer: {
                kind: "speak",
                lang: word.lang,
                accepted: [...new Set(spokenForms(word).map((s) => answerKeys(s, word.lang).lenient))],
                display: word.lemma,
            },
        });
    },
};

/* ---------------------------------------------------------------- */
/* stage plan generation                                              */
/* ---------------------------------------------------------------- */

export function generateStages(opts: {
    words: ChallengeWord[];
    /** larger pool for distractors (plan words + a sample of similar words) */
    distractorPool: ChallengeWord[];
    allowedTypes: ChallengeType[];
    stageCount: number;
}): StoredStage[] {
    const { words, distractorPool, stageCount } = opts;
    const allowed = opts.allowedTypes.filter((t): t is ChallengeType =>
        (CHALLENGE_TYPES as readonly string[]).includes(t));
    const types = allowed.length > 0 ? allowed : ["meaningMatch" as ChallengeType];
    const pool = [...distractorPool, ...words.filter((w) => !distractorPool.some((d) => d.id === w.id))];

    const stages: StoredStage[] = [];
    const queue = shuffle(words);
    let typeCursor = 0;

    while (stages.length < stageCount && queue.length > 0) {
        const word = queue[0];
        // rotate through allowed types, falling back to whatever fits this word
        const start = typeCursor % types.length;
        const rotation = [...types.slice(start), ...types.slice(0, start)];
        typeCursor++;

        let made: Generated = null;
        for (const type of [...rotation, "meaningMatch", "spelling"] as ChallengeType[]) {
            made = generators[type]({ word, queue, pool });
            if (made) break;
        }
        if (!made) {
            // nothing fits (an empty headword): skip the word rather than stall
            queue.shift();
            continue;
        }
        stages.push(made.stage);
        const usedIds = new Set(made.used.map((w) => w.id));
        for (let i = queue.length - 1; i >= 0; i--) if (usedIds.has(queue[i].id)) queue.splice(i, 1);
    }

    return stages;
}

/* ---------------------------------------------------------------- */
/* grading                                                            */
/* ---------------------------------------------------------------- */

function allWords(stage: StoredStage, correct: boolean) {
    return stage.wordIds.map((wordId) => ({ wordId, correct }));
}

export function gradeStage(stage: StoredStage, submission: Submission): GradeResult {
    const answer = stage.answer;

    if (answer.kind === "choice" && submission.kind === "choice") {
        const correct = submission.value === answer.value;
        return { correct, exact: correct, perWord: allWords(stage, correct), correctAnswer: answer.display ?? answer.value };
    }

    if (answer.kind === "spelling" && submission.kind === "spelling") {
        const keys = answerKeys(submission.value, answer.lang);
        const exact = keys.exact.length > 0 && answer.exact.includes(keys.exact);
        const correct = exact || (keys.lenient.length > 0 && answer.lenient.includes(keys.lenient));
        return { correct, exact, perWord: allWords(stage, correct), correctAnswer: answer.display };
    }

    if (answer.kind === "matching" && submission.kind === "matching") {
        const submitted = new Map(submission.pairs.map((p) => [p.left, p.right]));
        const perWord = answer.pairs.map((p) => ({ wordId: p.wordId, correct: submitted.get(p.left) === p.right }));
        const correct = perWord.every((p) => p.correct);
        return { correct, exact: correct, perWord, correctAnswer: "each word matched to its meaning" };
    }

    if (answer.kind === "order" && submission.kind === "order") {
        const clientTokens = stage.client.kind === "order" ? stage.client.tokens : [];
        const isPermutation =
            submission.order.length === clientTokens.length &&
            new Set(submission.order).size === submission.order.length &&
            submission.order.every((i) => i < clientTokens.length);
        const sentence = answer.tokens.join(answer.sep);
        const correct = isPermutation && submission.order.map((i) => clientTokens[i]).join(answer.sep) === sentence;
        return { correct, exact: correct, perWord: allWords(stage, correct), correctAnswer: sentence };
    }

    if (answer.kind === "speak" && submission.kind === "speak") {
        const heard = answerKeys(submission.heard, answer.lang).lenient;
        const correct = heard.length > 0 && answer.accepted.some((form) => form === heard || similarity(form, heard) >= SPEECH_MATCH);
        return { correct, exact: correct, perWord: allWords(stage, correct), correctAnswer: answer.display };
    }

    // submission kind didn't match the stage — treat as wrong, never throw mid-battle
    const shown =
        answer.kind === "choice" ? answer.display ?? answer.value :
        answer.kind === "spelling" || answer.kind === "speak" ? answer.display :
        answer.kind === "order" ? answer.tokens.join(answer.sep) : "";
    return { correct: false, exact: false, perWord: allWords(stage, false), correctAnswer: shown };
}

/** how many stages an enemy of a given tier throws */
export function stageCountForTier(tier: "minion" | "elite" | "boss"): number {
    return tier === "minion" ? 3 : tier === "elite" ? 4 : 6;
}
