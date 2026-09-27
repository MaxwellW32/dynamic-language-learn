import { z } from "zod";

/** the slice of a dictionary entry the challenge system needs */
export type ChallengeWord = {
    /** dictionary entry id */
    id: number;
    lemma: string;
    /** the one short English meaning */
    gloss: string;
    /** kana for Japanese, tone-marked pinyin for Mandarin */
    reading: string | null;
    /** Latin-script rendering (romaji, pinyin, Korean romanisation) */
    roman: string | null;
    exampleTarget: string | null;
    exampleNative: string | null;
    lang: string;
};

export const CHALLENGE_TYPES = [
    "meaningMatch",   // see the word → pick its meaning
    "reverseMatch",   // see the meaning → pick the word
    "matching",       // match 4 words to 4 meanings
    "spelling",       // see the meaning → type the word (or its reading)
    "fillBlank",      // cloze: example sentence with the word blanked → pick it
    "sentenceOrder",  // rebuild the example sentence from shuffled pieces
    "listening",      // hear the word → pick its meaning
    "speaking",       // see the word → say it aloud
] as const;

export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

/* ---------------------------------------------------------------- */
/* what the client sees (never contains the answer)                  */
/* ---------------------------------------------------------------- */

export type ClientChallenge =
    | {
        kind: "choice";
        /** what's being asked, e.g. the foreign word or a cloze sentence */
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
    }
    | {
        /** the client asks for the audio of `entryId`; the word itself is never in the payload */
        kind: "listen";
        entryId: number;
        question: string;
        /** meanings */
        options: string[];
    }
    | {
        kind: "speak";
        /** the word to say */
        prompt: string;
        /** its reading or romanisation, for scripts a beginner cannot yet sound out */
        promptHint?: string;
        meaning: string;
        /** locale for speech recognition */
        locale: string;
        question: string;
    };

/* ---------------------------------------------------------------- */
/* what the player submits                                            */
/* ---------------------------------------------------------------- */

export const submissionSchema = z.union([
    // also the answer to a "listen" stage: the meaning picked
    z.object({ kind: z.literal("choice"), value: z.string().max(400) }),
    z.object({ kind: z.literal("spelling"), value: z.string().max(200) }),
    z.object({
        kind: z.literal("matching"),
        pairs: z.array(z.object({ left: z.string(), right: z.string() })).max(12),
    }),
    z.object({ kind: z.literal("order"), order: z.array(z.number().int().min(0)).max(40) }),
    z.object({ kind: z.literal("speak"), heard: z.string().max(400) }),
]);

export type Submission = z.infer<typeof submissionSchema>;

/* ---------------------------------------------------------------- */
/* what the server stores (answers included — never serialized out)  */
/* ---------------------------------------------------------------- */

export type StoredAnswer =
    /** `display` is what a miss shows when it differs from the option text (a cloze with an inflected form) */
    | { kind: "choice"; value: string; display?: string }
    /**
     * `exact` keys match the answer as written (accents and tones included);
     * `lenient` keys forgive accents — a match there is correct but not exact.
     */
    | { kind: "spelling"; lang: string; exact: string[]; lenient: string[]; display: string }
    | { kind: "matching"; pairs: { left: string; right: string; wordId: number }[] }
    /** tokens in their true order; `sep` joins them back into the sentence */
    | { kind: "order"; tokens: string[]; sep: string }
    | { kind: "speak"; lang: string; accepted: string[]; display: string };

export type StoredStage = {
    type: ChallengeType;
    /** words being tested — drive SRS updates on grade */
    wordIds: number[];
    client: ClientChallenge;
    answer: StoredAnswer;
    /** filled in once the stage is answered, so a finished session can be summarised */
    result?: { correct: boolean; learnedIds: number[] };
};

export type GradeResult = {
    correct: boolean;
    /** false when the answer was only accepted by forgiving accents or tones ("watch the accent") */
    exact: boolean;
    perWord: { wordId: number; correct: boolean }[];
    /** shown to the player after a miss, so every miss still teaches */
    correctAnswer: string;
};
