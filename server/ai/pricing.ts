/*
 * What a model call costs, in millionths of a US dollar ("micros").
 *
 * Pure: no I/O and no server-only import, so the unit tests and the browser
 * can use it. Prices are the provider's official list prices (September 2026)
 * in US dollars per million tokens. A dollar per million tokens is exactly one
 * micro per token, so the arithmetic is done in thousandths of a micro per
 * token: every listed price is a whole number in those units and the sums stay
 * exact integers until the single final round-up.
 */

type TokenPrice = { input: number; cached: number; output: number };

/** US dollars per 1M tokens: input / cached input / output (output includes reasoning) */
const TEXT_PRICES: Record<string, TokenPrice> = {
    "gpt-6-astra": { input: 10, cached: 1, output: 50 },
    "gpt-6-sol": { input: 2, cached: 0.2, output: 10 },
    "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
    "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20 },
    "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12 },
    "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
    "gpt-5.5": { input: 5, cached: 0.5, output: 30 },
    "gpt-5.4": { input: 2.5, cached: 0.25, output: 15 },
    "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
    "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
};

/** US dollars per 1M characters of text read aloud */
const SPEECH_PRICES: Record<string, number> = {
    "gpt-4o-mini-tts": 0.6,
};

/** US dollars per 1M tokens: input (audio) / output (text) */
const TRANSCRIPTION_PRICES: Record<string, { input: number; output: number }> = {
    "gpt-4o-mini-transcribe": { input: 1.25, output: 5 },
};

export type Usage = {
    /** the TOTAL input, cached part included (the Responses API's usage.input_tokens) */
    inputTokens: number;
    /** the part of inputTokens served from the prompt cache */
    cachedTokens: number;
    /** includes reasoning tokens */
    outputTokens: number;
};

/** dollars per million → thousandths of a micro per unit; exact for up to three decimals */
function milli(dollarsPerMillion: number): number {
    return Math.round(dollarsPerMillion * 1000);
}

/** thousandths of a micro → whole micros, rounded UP so rounding never undercharges */
function toMicros(milliMicros: number): number {
    return Math.ceil(milliMicros / 1000);
}

function count(value: number): number {
    // token counts come from the provider; a missing or odd value must not turn into NaN money
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const warnedUnknown = new Set<string>();

/**
 * The price for a model id, allowing dated snapshots ("gpt-6-sol-2026-08-01")
 * by longest matching family prefix. An unknown model is priced at the
 * component-wise maximum of every known price — a missing price must never
 * mean free — and warns once per process.
 */
function lookup<T>(table: Record<string, T>, model: string, highest: () => T): T {
    let bestKey: string | null = null;
    for (const key of Object.keys(table)) {
        // the "-" boundary keeps "gpt-5.4" from claiming a hypothetical "gpt-5.45"
        if (model === key || model.startsWith(`${key}-`)) {
            if (bestKey === null || key.length > bestKey.length) bestKey = key;
        }
    }
    if (bestKey !== null) return table[bestKey];
    if (!warnedUnknown.has(model)) {
        warnedUnknown.add(model);
        console.warn(`[pricing] no price for model "${model}" — charging the highest known price`);
    }
    return highest();
}

function highestTextPrice(): TokenPrice {
    const all = Object.values(TEXT_PRICES);
    return {
        input: Math.max(...all.map((p) => p.input)),
        cached: Math.max(...all.map((p) => p.cached)),
        output: Math.max(...all.map((p) => p.output)),
    };
}

/** true when the model (or its dated snapshot) has a listed text price */
export function isKnownModel(model: string): boolean {
    return Object.keys(TEXT_PRICES).some((key) => model === key || model.startsWith(`${key}-`));
}

export function costMicros(model: string, usage: Usage): number {
    const price = lookup(TEXT_PRICES, model, highestTextPrice);
    const input = count(usage.inputTokens);
    // cached can never exceed the total it is part of
    const cached = Math.min(count(usage.cachedTokens), input);
    const output = count(usage.outputTokens);
    const total = (input - cached) * milli(price.input)
        + cached * milli(price.cached)
        + output * milli(price.output);
    return toMicros(total);
}

export function speechCostMicros(model: string, characters: number): number {
    const perMillion = lookup(SPEECH_PRICES, model, () => Math.max(...Object.values(SPEECH_PRICES)));
    return toMicros(count(characters) * milli(perMillion));
}

export function transcriptionCostMicros(model: string, usage: { inputTokens: number; outputTokens: number }): number {
    const price = lookup(TRANSCRIPTION_PRICES, model, () => {
        const all = Object.values(TRANSCRIPTION_PRICES);
        return { input: Math.max(...all.map((p) => p.input)), output: Math.max(...all.map((p) => p.output)) };
    });
    return toMicros(count(usage.inputTokens) * milli(price.input) + count(usage.outputTokens) * milli(price.output));
}

/**
 * "$4.97" for everyday amounts, "$0.004" under a cent (so a single call's
 * cost is still visible), "<$0.001" for a non-zero amount smaller than that.
 */
export function formatMoney(micros: number): string {
    const sign = micros < 0 ? "-" : "";
    const abs = Math.abs(Math.round(micros));
    if (abs === 0) return "$0.00";
    // integer rounding rather than toFixed, which misrounds values like 4.975 held in binary
    if (abs < 10_000) {
        if (abs < 500) return `${sign}<$0.001`;
        const thousandths = Math.round(abs / 1_000);
        // 9,999 micros rounds to ten thousandths — that is a cent, so say it the everyday way
        return thousandths === 10 ? `${sign}$0.01` : `${sign}$0.00${thousandths}`;
    }
    const cents = Math.round(abs / 10_000);
    return `${sign}$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
