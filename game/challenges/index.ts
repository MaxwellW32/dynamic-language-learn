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

/** normalize typed answers: case, whitespace, hyphens, diacritics */
export function normalizeAnswer(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[\s\-·.。、,!?¡¿'"]/g, "")
        .toLowerCase();
}

function distractors(word: ChallengeWord, pool: ChallengeWord[], field: "meaning" | "term", n: number): string[] {
    const seen = new Set([word[field]]);
    const out: string[] = [];
    for (const candidate of shuffle(pool)) {
        if (candidate.id === word.id || seen.has(candidate[field])) continue;
        seen.add(candidate[field]);
        out.push(candidate[field]);
        if (out.length === n) break;
    }
    return out;
}

/** split an example sentence into orderable pieces (space-delimited only) */
function sentenceTokens(sentence: string): string[] {
    return sentence.trim().split(/\s+/).filter(Boolean);
}

/* ---------------------------------------------------------------- */
/* per-type generators                                                */
/* ---------------------------------------------------------------- */

type GeneratorContext = { word: ChallengeWord; group: ChallengeWord[]; pool: ChallengeWord[] };

const generators: Record<ChallengeType, {
    eligible: (ctx: GeneratorContext) => boolean;
    /** how many words from the plan one stage of this type consumes */
    wordsPerStage: number;
    generate: (ctx: GeneratorContext) => StoredStage;
}> = {
    meaningMatch: {
        eligible: ({ pool }) => pool.length >= 4,
        wordsPerStage: 1,
        generate: ({ word, pool }) => ({
            type: "meaningMatch",
            wordIds: [word.id],
            client: {
                kind: "choice",
                prompt: word.term,
                promptHint: word.pronunciation ?? undefined,
                question: "What does this word mean?",
                options: shuffle([word.meaning, ...distractors(word, pool, "meaning", 3)]),
            },
            answer: { kind: "choice", value: word.meaning },
        }),
    },

    reverseMatch: {
        eligible: ({ pool }) => pool.length >= 4,
        wordsPerStage: 1,
        generate: ({ word, pool }) => ({
            type: "reverseMatch",
            wordIds: [word.id],
            client: {
                kind: "choice",
                prompt: word.meaning,
                question: "Which word means this?",
                options: shuffle([word.term, ...distractors(word, pool, "term", 3)]),
            },
            answer: { kind: "choice", value: word.term },
        }),
    },

    matching: {
        eligible: ({ group }) => group.length >= 4,
        wordsPerStage: 4,
        generate: ({ group }) => {
            const words = group.slice(0, 4);
            const left = words.map((w) => ({ key: w.id, label: w.term }));
            // right keys are positional so the pairing can't be derived client-side
            const shuffled = shuffle(words);
            const right = shuffled.map((w, i) => ({ key: `r${i}`, label: w.meaning }));
            const rightKeyByWordId = new Map(shuffled.map((w, i) => [w.id, `r${i}`]));
            return {
                type: "matching",
                wordIds: words.map((w) => w.id),
                client: { kind: "matching", question: "Match each word to its meaning.", left, right },
                answer: {
                    kind: "matching",
                    pairs: words.map((w) => ({ left: w.id, right: rightKeyByWordId.get(w.id)!, wordId: w.id })),
                },
            };
        },
    },

    spelling: {
        eligible: () => true,
        wordsPerStage: 1,
        generate: ({ word }) => ({
            type: "spelling",
            wordIds: [word.id],
            client: {
                kind: "spelling",
                meaning: word.meaning,
                pronunciationHint: word.pronunciation
                    ? `${word.pronunciation.slice(0, 2)}…`
                    : undefined,
                question: "Write the word for:",
            },
            answer: {
                kind: "spelling",
                accepted: [
                    normalizeAnswer(word.term),
                    ...(word.pronunciation ? [normalizeAnswer(word.pronunciation)] : []),
                ],
                display: word.term,
            },
        }),
    },

    fillBlank: {
        eligible: ({ word, pool }) =>
            pool.length >= 4 &&
            word.exampleTarget !== null &&
            word.exampleTarget.includes(word.term),
        wordsPerStage: 1,
        generate: ({ word, pool }) => ({
            type: "fillBlank",
            wordIds: [word.id],
            client: {
                kind: "choice",
                prompt: word.exampleTarget!.replace(word.term, "＿＿＿"),
                promptHint: word.exampleNative ?? undefined,
                question: "Which word completes the sentence?",
                options: shuffle([word.term, ...distractors(word, pool, "term", 3)]),
            },
            answer: { kind: "choice", value: word.term },
        }),
    },

    sentenceOrder: {
        eligible: ({ word }) =>
            word.exampleTarget !== null && sentenceTokens(word.exampleTarget).length >= 3,
        wordsPerStage: 1,
        generate: ({ word }) => {
            const tokens = sentenceTokens(word.exampleTarget!);
            return {
                type: "sentenceOrder",
                wordIds: [word.id],
                client: {
                    kind: "order",
                    question: "Rebuild the sentence.",
                    translation: word.exampleNative ?? word.meaning,
                    tokens: shuffle(tokens),
                },
                // graded by reconstructed text so identical twin tokens are interchangeable
                answer: { kind: "order", sentence: tokens.join(" ") },
            };
        },
    },
};

/* ---------------------------------------------------------------- */
/* stage plan generation                                              */
/* ---------------------------------------------------------------- */

export function generateStages(opts: {
    words: ChallengeWord[];
    /** larger pool for distractors (plan words + a pack sample) */
    distractorPool: ChallengeWord[];
    allowedTypes: ChallengeType[];
    stageCount: number;
}): StoredStage[] {
    const { words, distractorPool, stageCount } = opts;
    const allowed = opts.allowedTypes.filter((t): t is ChallengeType =>
        (CHALLENGE_TYPES as readonly string[]).includes(t));
    const types = allowed.length > 0 ? allowed : ["meaningMatch" as ChallengeType];
    const pool = distractorPool.length >= 4 ? distractorPool : words;

    const stages: StoredStage[] = [];
    const queue = shuffle(words);
    let typeCursor = 0;

    while (stages.length < stageCount && queue.length > 0) {
        const word = queue[0];
        // rotate through allowed types, falling back to whatever is eligible
        const rotation = [...types.slice(typeCursor % types.length), ...types.slice(0, typeCursor % types.length)];
        typeCursor++;

        const eligibleType =
            rotation.find((t) => generators[t].eligible({ word, group: queue, pool })) ??
            (generators.meaningMatch.eligible({ word, group: queue, pool }) ? "meaningMatch" : "spelling");

        const gen = generators[eligibleType];
        stages.push(gen.generate({ word, group: queue, pool }));
        queue.splice(0, gen.wordsPerStage);
    }

    return stages;
}

/* ---------------------------------------------------------------- */
/* grading                                                            */
/* ---------------------------------------------------------------- */

export function gradeStage(stage: StoredStage, submission: Submission): GradeResult {
    const answer = stage.answer;

    if (answer.kind === "choice" && submission.kind === "choice") {
        const correct = submission.value === answer.value;
        return {
            correct,
            perWord: stage.wordIds.map((wordId) => ({ wordId, correct })),
            correctAnswer: answer.value,
        };
    }

    if (answer.kind === "spelling" && submission.kind === "spelling") {
        const correct = answer.accepted.includes(normalizeAnswer(submission.value));
        return {
            correct,
            perWord: stage.wordIds.map((wordId) => ({ wordId, correct })),
            correctAnswer: answer.display,
        };
    }

    if (answer.kind === "matching" && submission.kind === "matching") {
        const submitted = new Map(submission.pairs.map((p) => [p.left, p.right]));
        const perWord = answer.pairs.map((p) => ({
            wordId: p.wordId,
            correct: submitted.get(p.left) === p.right,
        }));
        return {
            correct: perWord.every((p) => p.correct),
            perWord,
            correctAnswer: "each word matched to its meaning",
        };
    }

    if (answer.kind === "order" && submission.kind === "order") {
        const clientTokens = stage.client.kind === "order" ? stage.client.tokens : [];
        const attempt = submission.order.map((i) => clientTokens[i] ?? "").join(" ");
        const correct = attempt === answer.sentence;
        return {
            correct,
            perWord: stage.wordIds.map((wordId) => ({ wordId, correct })),
            correctAnswer: answer.sentence,
        };
    }

    // submission kind didn't match the stage — treat as wrong, never throw mid-battle
    return {
        correct: false,
        perWord: stage.wordIds.map((wordId) => ({ wordId, correct: false })),
        correctAnswer: "",
    };
}

/** how many stages an enemy of a given tier throws */
export function stageCountForTier(tier: "minion" | "elite" | "boss"): number {
    return tier === "minion" ? 3 : tier === "elite" ? 4 : 6;
}
