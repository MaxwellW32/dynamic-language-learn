import { z } from "zod";

/** the slice of a vocab word the challenge system needs */
export type ChallengeWord = {
    id: string;
    term: string;
    meaning: string;
    pronunciation: string | null;
    exampleTarget: string | null;
    exampleNative: string | null;
};

export const CHALLENGE_TYPES = [
    "meaningMatch",   // see the word → pick its meaning
    "reverseMatch",   // see the meaning → pick the word
    "matching",       // match 4 words to 4 meanings
    "spelling",       // see the meaning → type the word (or its pronunciation)
    "fillBlank",      // cloze: example sentence with the word blanked → pick it
    "sentenceOrder",  // rebuild the example sentence from shuffled pieces
] as const;

export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

/* ---------------------------------------------------------------- */
/* what the client sees (never contains the answer)                  */
/* ---------------------------------------------------------------- */

export type ClientChallenge =
    | {
        kind: "choice";
        /** what's being asked, e.g. the foreign term or a cloze sentence */
        prompt: string;
        promptHint?: string;
        question: string;
        options: string[];
    }
    | {
        kind: "spelling";
        meaning: string;
        pronunciationHint?: string;
        question: string;
    }
    | {
        kind: "matching";
        question: string;
        left: { key: string; label: string }[];
        right: { key: string; label: string }[];
    }
    | {
        kind: "order";
        question: string;
        translation: string;
        tokens: string[];
    };

/* ---------------------------------------------------------------- */
/* what the player submits                                            */
/* ---------------------------------------------------------------- */

export const submissionSchema = z.union([
    z.object({ kind: z.literal("choice"), value: z.string() }),
    z.object({ kind: z.literal("spelling"), value: z.string() }),
    z.object({
        kind: z.literal("matching"),
        pairs: z.array(z.object({ left: z.string(), right: z.string() })),
    }),
    z.object({ kind: z.literal("order"), order: z.array(z.number().int().min(0)) }),
]);

export type Submission = z.infer<typeof submissionSchema>;

/* ---------------------------------------------------------------- */
/* what the server stores (answers included — never serialized out)  */
/* ---------------------------------------------------------------- */

export type StoredAnswer =
    | { kind: "choice"; value: string }
    | { kind: "spelling"; accepted: string[]; display: string }
    | { kind: "matching"; pairs: { left: string; right: string; wordId: string }[] }
    | { kind: "order"; sentence: string };

export type StoredStage = {
    type: ChallengeType;
    /** words being tested — drive SRS updates on grade */
    wordIds: string[];
    client: ClientChallenge;
    answer: StoredAnswer;
};

export type GradeResult = {
    correct: boolean;
    perWord: { wordId: string; correct: boolean }[];
    /** shown to the player after a miss, so every miss still teaches */
    correctAnswer: string;
};
