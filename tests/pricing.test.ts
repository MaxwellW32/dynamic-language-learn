import { test } from "node:test";
import assert from "node:assert/strict";
import { costMicros, formatMoney, isKnownModel, speechCostMicros, transcriptionCostMicros } from "../server/ai/pricing";

test("a million uncached input tokens costs the list price", () => {
    assert.equal(costMicros("gpt-6-sol", { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 }), 2_000_000);
    assert.equal(costMicros("gpt-6-sol", { inputTokens: 0, cachedTokens: 0, outputTokens: 1_000_000 }), 10_000_000);
    assert.equal(costMicros("gpt-6-astra", { inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0 }), 1_000_000);
});

test("cached tokens are part of inputTokens and priced at the cached rate", () => {
    // gpt-6-sol: 1,000 uncached × $2/M = 2,000 µ; 3,000 cached × $0.20/M = 600 µ; 500 out × $10/M = 5,000 µ
    assert.equal(costMicros("gpt-6-sol", { inputTokens: 4_000, cachedTokens: 3_000, outputTokens: 500 }), 7_600);
});

test("cached tokens can never exceed the total input", () => {
    const capped = costMicros("gpt-6-sol", { inputTokens: 100, cachedTokens: 500, outputTokens: 0 });
    assert.equal(capped, costMicros("gpt-6-sol", { inputTokens: 100, cachedTokens: 100, outputTokens: 0 }));
});

test("fractional costs round UP to the next micro", () => {
    // gpt-6-luna input $0.10/M = 0.1 µ per token: one token is 0.1 µ → 1 µ
    assert.equal(costMicros("gpt-6-luna", { inputTokens: 1, cachedTokens: 0, outputTokens: 0 }), 1);
    // 10 tokens = exactly 1 µ, no rounding
    assert.equal(costMicros("gpt-6-luna", { inputTokens: 10, cachedTokens: 0, outputTokens: 0 }), 1);
    // 11 tokens = 1.1 µ → 2
    assert.equal(costMicros("gpt-6-luna", { inputTokens: 11, cachedTokens: 0, outputTokens: 0 }), 2);
    // gpt-5.4-mini cached $0.075/M: 1,000 cached = 75 µ exactly (no float drift)
    assert.equal(costMicros("gpt-5.4-mini", { inputTokens: 1_000, cachedTokens: 1_000, outputTokens: 0 }), 75);
});

test("zero usage costs nothing; odd values do not become NaN", () => {
    assert.equal(costMicros("gpt-6-sol", { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }), 0);
    assert.equal(costMicros("gpt-6-sol", { inputTokens: Number.NaN, cachedTokens: -5, outputTokens: 10 }), 100);
});

test("a dated snapshot resolves to its family by longest prefix", () => {
    const usage = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 };
    assert.equal(costMicros("gpt-6-sol-2026-08-01", usage), 2_000_000);
    // gpt-5.4-mini-… must not be priced as gpt-5.4
    assert.equal(costMicros("gpt-5.4-mini-2026-03-01", usage), 750_000);
    assert.equal(costMicros("gpt-5.4-2026-03-01", usage), 2_500_000);
    assert.equal(isKnownModel("gpt-5.6-terra-2026-09-01"), true);
});

test("an unknown model is priced at the highest known price, never free", () => {
    const usage = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 1_000_000 };
    assert.equal(isKnownModel("gpt-9-mystery"), false);
    assert.equal(costMicros("gpt-9-mystery", usage), costMicros("gpt-6-astra", usage));
    // a family-looking prefix without the dash boundary is still unknown
    assert.equal(isKnownModel("gpt-5.45"), false);
});

test("speech is priced per character", () => {
    assert.equal(speechCostMicros("gpt-4o-mini-tts", 1_000_000), 600_000);
    // 100 chars × 0.6 µ = 60 µ
    assert.equal(speechCostMicros("gpt-4o-mini-tts", 100), 60);
    // 1 char = 0.6 µ → 1
    assert.equal(speechCostMicros("gpt-4o-mini-tts", 1), 1);
    assert.equal(speechCostMicros("some-future-tts", 100), 60);
});

test("transcription is priced per token in and out", () => {
    // 200 in × 1.25 µ = 250; 30 out × 5 µ = 150
    assert.equal(transcriptionCostMicros("gpt-4o-mini-transcribe", { inputTokens: 200, outputTokens: 30 }), 400);
    assert.equal(transcriptionCostMicros("gpt-4o-mini-transcribe", { inputTokens: 1, outputTokens: 0 }), 2);
});

test("money reads naturally", () => {
    assert.equal(formatMoney(4_970_000), "$4.97");
    assert.equal(formatMoney(5_000_000), "$5.00");
    assert.equal(formatMoney(27_500_000), "$27.50");
    // 4.975 is 4.97499… in binary; integer rounding still gives the right cent
    assert.equal(formatMoney(4_975_000), "$4.98");
    assert.equal(formatMoney(10_000), "$0.01");
    assert.equal(formatMoney(4_000), "$0.004");
    assert.equal(formatMoney(4_400), "$0.004");
    assert.equal(formatMoney(9_999), "$0.01");
    assert.equal(formatMoney(120), "<$0.001");
    assert.equal(formatMoney(0), "$0.00");
    assert.equal(formatMoney(-20_000), "-$0.02");
    assert.equal(formatMoney(-3_000), "-$0.003");
});
