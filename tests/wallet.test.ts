import { test } from "node:test";
import assert from "node:assert/strict";
import {
    canSpend, chargeFor, findPackage, LOW_BALANCE_MICROS, packageMarginMicros, PACKAGES, parseMarkup,
    STARTER_GIFT_MICROS, walletViewOf,
} from "../server/services/walletRules";

test("packages pay and credit what they promise", () => {
    const byKey = Object.fromEntries(PACKAGES.map((pkg) => [pkg.key, pkg]));
    assert.deepEqual(Object.keys(byKey), ["pouch", "satchel", "chest"]);
    assert.equal(byKey.pouch.paidCents, 600);
    assert.equal(byKey.pouch.creditMicros, 5_000_000);
    assert.equal(byKey.satchel.paidCents, 1_200);
    assert.equal(byKey.satchel.creditMicros, 10_500_000);
    assert.equal(byKey.chest.paidCents, 3_000);
    assert.equal(byKey.chest.creditMicros, 27_500_000);
});

test("every package keeps a margin, and bigger ones keep a smaller share", () => {
    let lastShare = Infinity;
    for (const pkg of PACKAGES) {
        const margin = packageMarginMicros(pkg);
        assert.ok(margin > 0, `${pkg.key} must credit less than is paid`);
        const share = margin / (pkg.paidCents * 10_000);
        assert.ok(share < lastShare, `${pkg.key} should be better value than the one before`);
        lastShare = share;
    }
    assert.equal(packageMarginMicros(findPackage("pouch")!), 1_000_000);
    assert.equal(findPackage("vault"), null);
});

test("the markup defaults to 1 and is clamped to [1, 5]", () => {
    assert.equal(parseMarkup(undefined), 1);
    assert.equal(parseMarkup(""), 1);
    assert.equal(parseMarkup("  "), 1);
    assert.equal(parseMarkup("abc"), 1);
    assert.equal(parseMarkup("1.5"), 1.5);
    assert.equal(parseMarkup("0.5"), 1);
    assert.equal(parseMarkup("-2"), 1);
    assert.equal(parseMarkup("9"), 5);
    assert.equal(parseMarkup("Infinity"), 1);
});

test("charges round up without float noise", () => {
    assert.equal(chargeFor(0, 1), 0);
    assert.equal(chargeFor(1_234, 1), 1_234);
    // 110 × 1.1 is 121.00000000000001 in floating point — still 121
    assert.equal(chargeFor(110, 1.1), 121);
    // 3 × 1.5 = 4.5 → 5
    assert.equal(chargeFor(3, 1.5), 5);
    assert.equal(chargeFor(1, 5), 5);
});

test("who may spend", () => {
    assert.deepEqual(canSpend({ billingMode: "byok", creditMicros: 0 }), { ok: true });
    assert.deepEqual(canSpend({ billingMode: "credits", creditMicros: 1 }), { ok: true });
    assert.deepEqual(canSpend({ billingMode: "credits", creditMicros: 0 }), {
        ok: false, message: "Your wallet is empty — add credit to keep the story going.",
    });
    assert.equal(canSpend({ billingMode: "credits", creditMicros: -500 }).ok, false);
    assert.deepEqual(canSpend({ billingMode: null, creditMicros: 5_000_000 }), {
        ok: false, message: "Choose how to power your storyteller first.",
    });
});

test("the wallet view flags a low balance only for wallet users", () => {
    assert.equal(STARTER_GIFT_MICROS, 500_000);
    assert.equal(walletViewOf({ billingMode: "credits", creditMicros: LOW_BALANCE_MICROS - 1 }).low, true);
    assert.equal(walletViewOf({ billingMode: "credits", creditMicros: LOW_BALANCE_MICROS }).low, false);
    assert.equal(walletViewOf({ billingMode: "byok", creditMicros: 0 }).low, false);
    assert.deepEqual(walletViewOf({ billingMode: null, creditMicros: 0 }), { mode: null, balanceMicros: 0, low: false });
});
