import { z } from "zod";

/**
 * All story text — narration, dialogue, messages — is a sequence of segments.
 * `text` is native-language prose; `vocab` is a word from the player's packs
 * (validated against the DB — the anti-hallucination boundary); `phrase` is an
 * ad-hoc target-language expression the AI translated itself.
 */
export const segmentSchema = z.union([
    z.object({
        t: z.literal("text"),
        v: z.string(),
    }),
    z.object({
        t: z.literal("vocab"),
        wordId: z.string().min(1),
        /** the word as it appears in this sentence (may be conjugated) */
        surface: z.string().min(1),
    }),
    z.object({
        t: z.literal("phrase"),
        target: z.string().min(1),
        translation: z.string().min(1),
        pronunciation: z.string().optional(),
    }),
]);

export type Segment = z.infer<typeof segmentSchema>;

export function segmentsToPlainText(segments: Segment[]): string {
    return segments
        .map((s) => (s.t === "text" ? s.v : s.t === "vocab" ? s.surface : s.target))
        .join("")
        .trim();
}

export function plainText(v: string): Segment[] {
    return [{ t: "text", v }];
}
