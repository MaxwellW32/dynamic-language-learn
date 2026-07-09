import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { getByokKey } from "../services/billing";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * BYOK players carry their own key on the request; everyone else uses the
 * app's. The billing gate has already verified the caller is allowed to be
 * here, so a present key simply wins.
 */
export async function openaiForRequest(): Promise<OpenAI> {
    const byok = await getByokKey();
    return byok ? new OpenAI({ apiKey: byok }) : openai;
}

/**
 * Model tiers:
 * - BYOK players run the full flagship on their own key.
 * - Credits (sparks) players run the half-price flagship-class model — still
 *   strong prose, and it's what makes spark bundles profitable.
 * - The fast tier handles mechanical fill-in work (example sentences).
 */
export const AI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";
export const AI_MODEL_CREDITS = process.env.OPENAI_MODEL_CREDITS ?? "gpt-5.4";
export const AI_MODEL_FAST = process.env.OPENAI_MODEL_FAST ?? "gpt-5.4-mini";

/**
 * The single door to the model. Every generation task gives its name (for
 * logs), a system prompt, an input brief, and a zod schema; the result is
 * parsed AND re-validated. One retry on transient failure.
 */
export async function generate<S extends z.ZodType>(opts: {
    task: string;
    instructions: string;
    input: string;
    schema: S;
    model?: string;
}): Promise<z.infer<S>> {
    const { task, instructions, input, schema } = opts;
    const started = Date.now();
    const byok = await getByokKey();
    const client = byok ? new OpenAI({ apiKey: byok }) : openai;
    const model = opts.model ?? (byok ? AI_MODEL : AI_MODEL_CREDITS);

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await client.responses.parse({
                model,
                instructions,
                input,
                text: { format: zodTextFormat(schema, task) },
            });
            const parsed = schema.parse(response.output_parsed);
            console.info(`[ai] ${task} ok in ${Date.now() - started}ms`);
            return parsed;
        } catch (error) {
            lastError = error;
            console.warn(`[ai] ${task} attempt ${attempt + 1} failed`, error);
        }
    }
    throw new Error(`The storyteller lost the thread (${task}). Please try again.`, { cause: lastError });
}
