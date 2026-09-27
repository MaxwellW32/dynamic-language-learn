import "server-only";
import { createHash } from "crypto";
import { cookies } from "next/headers";
import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { aiUsage, ttsCache, users, type User } from "@/db/schema";
import { canSpend, charge, chargeFor, USAGE_MARKUP } from "../services/wallet";
import { costMicros, formatMoney, speechCostMicros, transcriptionCostMicros, type Usage } from "./pricing";

/*
 * The one door to the model. Every call goes through here so that every call
 * is gated (wallet or key), metered from the provider's own token counts,
 * recorded in ai_usage, and charged — and so that every failure reaches the
 * caller as a StorytellerError whose message is safe to show a player.
 *
 * Keys: a BYOK player's key comes only from their cookie and is used only in
 * memory; it is never logged, stored, or put in an error. A BYOK player
 * without a key is refused — never quietly served on the app's key.
 */

export const BYOK_COOKIE = "wb_byok";

export type Tier = "story" | "scribe";
export type AiContext = { userId: string; bookId?: string | null };
/** "minimal" and "none" both mean "do not deliberate": models differ in which of the two they accept */
export type Effort = "none" | "minimal" | "low" | "medium" | "high";

export const MODELS: { story: string; scribe: string } = {
    story: process.env.OPENAI_MODEL_STORY || "gpt-6-sol",
    scribe: process.env.OPENAI_MODEL_SCRIBE || "gpt-6-luna",
};

const SPEECH_MODEL = "gpt-4o-mini-tts";
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const MAX_SPEECH_CHARS = 600;
const RETRY_DELAY_MS = 400;
/** our own retry is the only one: the SDK's built-in retries would bill attempts we never see */
const SDK_RETRIES = 0;
/** long enough for a forge-sized structured answer; a hung socket still fails over to the one retry */
const GENERATE_TIMEOUT_MS = 90_000;
const AUDIO_TIMEOUT_MS = 60_000;
/**
 * A transcription response that carries no usage is charged this flat amount:
 * roughly a 15-second clip (≈ 200 audio tokens in, 30 text tokens out) at
 * gpt-4o-mini-transcribe prices, rounded up. Charging nothing would make a
 * missing field mean free.
 */
const TRANSCRIBE_FALLBACK_MICROS = 300;

const MESSAGES = {
    keyMissing: "Your storyteller's key is missing on this device — add it again from your shelf.",
    keyRefused: "Your storyteller's key was turned away by OpenAI — check it, and its credit, from your shelf.",
    busy: "The storyteller is catching their breath — try again in a moment.",
    failed: "The storyteller lost the thread. Please try again.",
    tooLong: "That is too much to say in one breath.",
} as const;

export class StorytellerError extends Error {
    readonly kind: "wallet" | "key" | "busy" | "failed";

    constructor(kind: StorytellerError["kind"], message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "StorytellerError";
        this.kind = kind;
    }
}

/* ------------------------------------------------------------------ */
/* the gate                                                            */
/* ------------------------------------------------------------------ */

type Door = { user: User; client: OpenAI; byok: boolean };

let appClient: OpenAI | null = null;

async function byokKeyFromCookie(): Promise<string | null> {
    try {
        const jar = await cookies();
        const value = jar.get(BYOK_COOKIE)?.value?.trim();
        return value ? value : null;
    } catch {
        // outside a request (scripts, background work) there are no cookies: the key is absent
        return null;
    }
}

/** load the player, refuse before any spend, and pick whose key pays */
async function openDoor(ctx: AiContext): Promise<Door> {
    const user = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
    if (!user) throw new StorytellerError("failed", MESSAGES.failed, { cause: new Error("AI call for an unknown user") });

    const verdict = canSpend(user);
    if (!verdict.ok) throw new StorytellerError("wallet", verdict.message);

    if (user.billingMode === "byok") {
        const key = await byokKeyFromCookie();
        if (!key) throw new StorytellerError("key", MESSAGES.keyMissing);
        return { user, client: new OpenAI({ apiKey: key, maxRetries: SDK_RETRIES }), byok: true };
    }

    const appKey = process.env.OPENAI_API_KEY;
    if (!appKey) throw new StorytellerError("failed", MESSAGES.failed, { cause: new Error("OPENAI_API_KEY is not set") });
    appClient ??= new OpenAI({ apiKey: appKey, maxRetries: SDK_RETRIES });
    return { user, client: appClient, byok: false };
}

/* ------------------------------------------------------------------ */
/* failures                                                            */
/* ------------------------------------------------------------------ */

/** worth one more try: rate limits, provider errors, network trouble, timeouts */
function isTransient(error: unknown): boolean {
    if (error instanceof OpenAI.APIConnectionError) return true; // includes timeouts
    if (error instanceof OpenAI.APIError && typeof error.status === "number") {
        // an exhausted quota is a 429 that no amount of waiting fixes
        if (error.status === 429) return error.code !== "insufficient_quota";
        return error.status >= 500;
    }
    return false;
}

function isKeyProblem(error: unknown): boolean {
    return error instanceof OpenAI.APIError
        && (error.status === 401 || (error.status === 429 && error.code === "insufficient_quota"));
}

/** a short description for the logs — status and code only, never prompt text or a key */
function describe(error: unknown): string {
    if (error instanceof OpenAI.APIError) return `${error.constructor.name} ${error.status ?? ""} ${error.code ?? ""}`.trim();
    if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 200)}`;
    return String(error).slice(0, 200);
}

function toStorytellerError(error: unknown, transient: boolean, byok: boolean): StorytellerError {
    if (error instanceof StorytellerError) return error;
    if (byok && isKeyProblem(error)) return new StorytellerError("key", MESSAGES.keyRefused, { cause: error });
    if (transient) return new StorytellerError("busy", MESSAGES.busy, { cause: error });
    return new StorytellerError("failed", MESSAGES.failed, { cause: error });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** run a provider call with the one retry allowed for transient failures */
async function withOneRetry<T>(label: string, byok: boolean, call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (first) {
        if (!isTransient(first)) throw toStorytellerError(first, false, byok);
        console.warn(`[ai] ${label} attempt 1 failed (${describe(first)}), retrying`);
        await sleep(RETRY_DELAY_MS);
        try {
            return await call();
        } catch (second) {
            throw toStorytellerError(second, isTransient(second), byok);
        }
    }
}

/* ------------------------------------------------------------------ */
/* bookkeeping                                                         */
/* ------------------------------------------------------------------ */

type UsageRecord = {
    door: Door;
    ctx: AiContext;
    task: string;
    model: string;
    usage: Usage;
    characters?: number;
    costMicros: number;
    ms: number;
    ok: boolean;
};

/**
 * Write the ai_usage row and charge the wallet. This runs after the provider
 * has already been paid, so it must never turn a good result into a failure:
 * anything that goes wrong here is logged and swallowed.
 */
async function record(entry: UsageRecord): Promise<void> {
    const charged = entry.door.byok ? 0 : chargeFor(entry.costMicros, USAGE_MARKUP);
    console.info(
        `[ai] ${entry.task} ${entry.model} ${entry.ms}ms in=${entry.usage.inputTokens} cached=${entry.usage.cachedTokens} ` +
        `out=${entry.usage.outputTokens}${entry.characters ? ` chars=${entry.characters}` : ""} ` +
        `cost=${formatMoney(entry.costMicros)}${entry.door.byok ? " (byok)" : ""}${entry.ok ? "" : " NOT OK"}`,
    );
    try {
        const [row] = await db.insert(aiUsage).values({
            userId: entry.ctx.userId,
            bookId: entry.ctx.bookId ?? null,
            task: entry.task,
            model: entry.model,
            inputTokens: entry.usage.inputTokens,
            cachedTokens: entry.usage.cachedTokens,
            outputTokens: entry.usage.outputTokens,
            characters: entry.characters ?? 0,
            costMicros: entry.costMicros,
            chargedMicros: charged,
            byok: entry.door.byok,
            ms: entry.ms,
            ok: entry.ok,
        }).returning({ id: aiUsage.id });
        // the usage row id is the ref, so this call can never be charged twice
        if (charged > 0) await charge(entry.ctx.userId, charged, `ai:${entry.task}`, row.id);
    } catch (error) {
        console.error("[ai] bookkeeping failed", { task: entry.task, model: entry.model, costMicros: entry.costMicros, error: describe(error) });
    }
}

/* ------------------------------------------------------------------ */
/* generate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Reasoning-effort fallbacks, remembered for the life of the process.
 * Measured September 2026: gpt-6-sol and gpt-6-luna reject "minimal"
 * (they offer none/low/medium/high/xhigh/max), and leaving `reasoning` out
 * makes them run at "medium" — the opposite of what "minimal" asked for. So a
 * rejected "minimal" is first retried as "none", the nearest level that is no
 * more expensive; only if the model rejects effort outright is the field
 * dropped.
 */
// the two defaults are known to want "none": seeding them saves every fresh process one rejected request
const MINIMAL_AS_NONE = new Set<string>(["gpt-6-sol", "gpt-6-luna"]);
const NO_REASONING = new Set<string>();

type ApiEffort = Effort;

function effortFor(model: string, requested: Effort): ApiEffort | null {
    if (NO_REASONING.has(model)) return null;
    if (requested === "minimal" && MINIMAL_AS_NONE.has(model)) return "none";
    return requested;
}

function isEffortRejection(error: unknown): boolean {
    return error instanceof OpenAI.BadRequestError
        && (error.param === "reasoning.effort" || error.param === "reasoning");
}

/** OpenAI's structured-output name must match /^[a-zA-Z0-9_-]+$/ and be at most 64 characters */
function formatName(task: string): string {
    const cleaned = task.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64);
    return cleaned || "result";
}

function usageOf(response: OpenAIResponse): Usage {
    const usage = response.usage;
    if (!usage) console.warn(`[ai] response ${response.model} carried no usage — nothing can be charged for it`);
    return {
        inputTokens: usage?.input_tokens ?? 0,
        cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
    };
}

function refused(response: OpenAIResponse): boolean {
    return response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
}

/** the API takes cache keys of at most 64 characters; two ids joined are longer, so long keys are hashed */
const MAX_CACHE_KEY = 64;

function cacheKeyOf(key: string | undefined): string | undefined {
    if (key === undefined || key.length <= MAX_CACHE_KEY) return key;
    return createHash("sha256").update(key).digest("hex").slice(0, 48);
}

/** a structured request, stepping down the effort if the model rejects it (a rejected request costs nothing) */
async function createResponse(
    client: OpenAI, params: Omit<OpenAI.Responses.ResponseCreateParamsNonStreaming, "reasoning">, requested: Effort,
    timeoutMs: number,
): Promise<OpenAIResponse> {
    const model = params.model as string;
    for (;;) {
        const effort = effortFor(model, requested);
        try {
            return await client.responses.create(
                effort ? { ...params, reasoning: { effort } } : params,
                { timeout: timeoutMs },
            );
        } catch (error) {
            if (!isEffortRejection(error) || effort === null) throw error;
            if (effort === "minimal") {
                MINIMAL_AS_NONE.add(model);
                console.warn(`[ai] ${model} rejects reasoning effort "minimal" — using "none" from now on`);
            } else {
                NO_REASONING.add(model);
                console.warn(`[ai] ${model} rejects reasoning effort "${effort}" — sending no reasoning setting from now on`);
            }
        }
    }
}

/**
 * Ask the model for a structured answer. `instructions` is the stable prefix
 * (rulebook, bible, character sheet) and `input` what changes every call, so
 * the provider's prompt cache can reuse the prefix; `cacheKey` keeps
 * consecutive calls for the same book or character on the same cache.
 *
 * At most one retry: for a transient failure, or for output that fails the
 * schema. Every attempt that reached the provider is recorded and charged,
 * the failed ones included — they were paid for.
 */
export async function generate<S extends z.ZodType>(opts: {
    ctx: AiContext;
    task: string;
    tier: Tier;
    instructions: string;
    input: string;
    schema: S;
    /**
     * The name the schema is sent under; the task's own name when left out.
     * The provider puts the schema and its name at the very front of the
     * prompt, so tasks that share a schema must also share this name, or the
     * cached prefix of one is no use to the other.
     */
    schemaName?: string;
    cacheKey?: string;
    effort?: Effort;
    maxOutputTokens?: number;
    /** how long to wait for an answer; raise it for the few calls that write thousands of tokens */
    timeoutMs?: number;
}): Promise<z.infer<S>> {
    const { ctx, task, tier, schema } = opts;
    const door = await openDoor(ctx);
    const model = MODELS[tier];
    const cacheKey = cacheKeyOf(opts.cacheKey);
    const requested: Effort = opts.effort ?? (tier === "story" ? "low" : "minimal");
    // created with `create`, not `parse`: parse throws on unparseable output
    // and takes the response (and its usage) with it — we must still bill that attempt
    const format = zodTextFormat(schema, formatName(opts.schemaName ?? task));

    let lastError: unknown = null;
    let lastTransient = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt === 2) await sleep(RETRY_DELAY_MS);
        const started = Date.now();

        let response: OpenAIResponse;
        try {
            response = await createResponse(door.client, {
                model,
                instructions: opts.instructions,
                input: opts.input,
                text: { format },
                prompt_cache_key: cacheKey,
                max_output_tokens: opts.maxOutputTokens ?? 4000,
                store: false,
            }, requested, opts.timeoutMs ?? GENERATE_TIMEOUT_MS);
        } catch (error) {
            lastError = error;
            lastTransient = isTransient(error);
            console.warn(`[ai] ${task} attempt ${attempt} failed: ${describe(error)}`);
            if (!lastTransient) break;
            continue;
        }

        const ms = Date.now() - started;
        const usage = usageOf(response);
        const wasRefused = refused(response);
        let parsed: z.infer<S> | undefined;
        let invalid: unknown = null;
        if (!wasRefused) {
            try {
                parsed = schema.parse(JSON.parse(response.output_text));
            } catch (error) {
                invalid = error;
            }
        }
        await record({
            door, ctx, task, model: response.model || model, usage,
            costMicros: costMicros(response.model || model, usage), ms, ok: !wasRefused && invalid === null,
        });

        if (wasRefused) {
            lastError = new Error(`${task}: the model refused`);
            lastTransient = false;
            break;
        }
        if (invalid === null) return parsed as z.infer<S>;
        lastError = invalid;
        lastTransient = false;
        console.warn(`[ai] ${task} attempt ${attempt} returned output that failed validation (status ${response.status})`);
    }
    throw toStorytellerError(lastError, lastTransient, door.byok);
}

/* ------------------------------------------------------------------ */
/* speech                                                              */
/* ------------------------------------------------------------------ */

/**
 * Read a line aloud. Audio is made once per (model, voice, style, text) and
 * replayed from tts_cache for everyone after that, free. The cache is checked
 * before the wallet gate on purpose: replaying stored audio costs nothing, so
 * an empty wallet need not silence lines already spoken once.
 */
export async function speak(opts: {
    ctx: AiContext; text: string; voice: string; style?: string;
}): Promise<{ audio: Buffer; mime: string; cached: boolean }> {
    const text = opts.text;
    if (text.trim() === "") throw new StorytellerError("failed", MESSAGES.failed, { cause: new Error("speak: empty text") });
    if (text.length > MAX_SPEECH_CHARS) throw new StorytellerError("failed", MESSAGES.tooLong);

    const style = opts.style ?? "";
    const key = createHash("sha256").update(`${SPEECH_MODEL}|${opts.voice}|${style}|${text}`).digest("hex");

    const [hit] = await db.update(ttsCache)
        .set({ hits: sql`${ttsCache.hits} + 1` })
        .where(eq(ttsCache.key, key))
        .returning({ audio: ttsCache.audio, mime: ttsCache.mime });
    if (hit) return { audio: hit.audio, mime: hit.mime, cached: true };

    const door = await openDoor(opts.ctx);
    const started = Date.now();
    const audio = await withOneRetry("speak", door.byok, async () => {
        const response = await door.client.audio.speech.create({
            model: SPEECH_MODEL,
            voice: opts.voice,
            input: text,
            ...(style ? { instructions: style } : {}),
            response_format: "mp3",
        }, { timeout: AUDIO_TIMEOUT_MS });
        return Buffer.from(await response.arrayBuffer());
    });
    const ms = Date.now() - started;
    const mime = "audio/mpeg";

    try {
        // two players asking for the same new line at once both pay the provider; neither may fail on the insert
        await db.insert(ttsCache).values({ key, mime, audio, characters: text.length }).onConflictDoNothing();
    } catch (error) {
        console.error("[ai] speech cache write failed", { error: describe(error) });
    }
    await record({
        door, ctx: opts.ctx, task: "speak", model: SPEECH_MODEL,
        usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, characters: text.length,
        costMicros: speechCostMicros(SPEECH_MODEL, text.length), ms, ok: true,
    });
    return { audio, mime, cached: false };
}

/* ------------------------------------------------------------------ */
/* transcription                                                       */
/* ------------------------------------------------------------------ */

/**
 * The provider tells audio formats apart by file extension, so a nameless
 * Blob needs a name that matches its type: MediaRecorder gives webm in
 * Chrome and mp4 in Safari, and a wrong extension is rejected as corrupt.
 */
const AUDIO_EXTENSIONS: Record<string, string> = {
    "audio/webm": "webm", "video/webm": "webm",
    "audio/mp4": "mp4", "video/mp4": "mp4", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
    "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/flac": "flac",
};

function audioFileName(audio: Blob | File): string {
    if (audio instanceof File && /\.[a-z0-9]+$/i.test(audio.name)) return audio.name;
    const mime = audio.type.split(";")[0].trim().toLowerCase();
    return `speech.${AUDIO_EXTENSIONS[mime] ?? "webm"}`;
}

export async function transcribe(opts: { ctx: AiContext; audio: Blob | File; language?: string }): Promise<string> {
    const door = await openDoor(opts.ctx);
    const name = audioFileName(opts.audio);
    const file = await toFile(opts.audio, name, { type: opts.audio.type || undefined });
    const started = Date.now();
    const result = await withOneRetry("transcribe", door.byok, () => door.client.audio.transcriptions.create({
        file,
        model: TRANSCRIBE_MODEL,
        ...(opts.language ? { language: opts.language } : {}),
    }, { timeout: AUDIO_TIMEOUT_MS }));
    const ms = Date.now() - started;

    const usage = result.usage?.type === "tokens" ? result.usage : null;
    const tokens: Usage = {
        inputTokens: usage?.input_tokens ?? 0,
        cachedTokens: 0,
        outputTokens: usage?.output_tokens ?? 0,
    };
    await record({
        door, ctx: opts.ctx, task: "transcribe", model: TRANSCRIBE_MODEL, usage: tokens,
        costMicros: usage ? transcriptionCostMicros(TRANSCRIBE_MODEL, tokens) : TRANSCRIBE_FALLBACK_MICROS,
        ms, ok: true,
    });
    return result.text;
}

/* ------------------------------------------------------------------ */
/* keys                                                                */
/* ------------------------------------------------------------------ */

/** a free probe: listing models costs nothing and fails fast on a bad key */
export async function validateKey(key: string): Promise<boolean> {
    try {
        const probe = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 15_000 });
        await probe.models.list();
        return true;
    } catch {
        return false;
    }
}
