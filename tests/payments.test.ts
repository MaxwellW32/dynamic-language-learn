import { test } from "node:test";
import assert from "node:assert/strict";
import {
    answersFor, authenticationOf, cardExpiration, declineMessage, formatPrice, isApproved, parseCallback,
    passesLuhn, priceOf, readCard, toMajorUnits,
} from "../server/payments/rules";

const now = new Date("2026-09-27T12:00:00Z");
const good = { name: "Ada Lovelace", number: "4012 0000 0002 0006", expiry: "12/28", cvv: "123" };

test("a package costs what it says in US dollars", () => {
    assert.deepEqual(priceOf(600, "USD", null), { currency: "USD", minor: 600 });
    assert.equal(formatPrice(priceOf(1200, "USD", null)), "$12.00");
    assert.equal(toMajorUnits(600), 6);
    assert.equal(toMajorUnits(1234), 12.34);
});

test("in Jamaican dollars it is the owner's rate, rounded up to a whole dollar", () => {
    assert.deepEqual(priceOf(600, "JMD", 160), { currency: "JMD", minor: 96_000 });
    assert.equal(formatPrice(priceOf(600, "JMD", 160)), "J$960");
    // 6 × 158.37 = 950.22: never less than the value of what is sold
    assert.deepEqual(priceOf(600, "JMD", 158.37), { currency: "JMD", minor: 95_100 });
    assert.equal(formatPrice(priceOf(3000, "JMD", 158.37)), "J$4,752");
    assert.throws(() => priceOf(600, "JMD", null));
    assert.throws(() => priceOf(600, "JMD", 0));
    assert.throws(() => priceOf(0, "USD", null));
});

test("a card that could be real is read", () => {
    const read = readCard(good, now);
    assert.ok(read.ok);
    if (read.ok) {
        assert.deepEqual(read.card, { name: "Ada Lovelace", pan: "4012000000020006", month: 12, year: 28, cvv: "123" });
        assert.equal(cardExpiration(read.card, "YYMM"), "2812");
        assert.equal(cardExpiration(read.card, "MMYY"), "1228");
    }
    assert.ok(readCard({ ...good, expiry: "0927" }, now).ok, "good to the end of the month written on it");
    assert.ok(readCard({ ...good, number: "378282246310005", cvv: "1234" }, now).ok, "fifteen digits and a four digit code");
});

test("a card that could not be real is refused, and never quoted", () => {
    const refused = [
        readCard({ ...good, number: "4012 0000 0002 0007" }, now),
        readCard({ ...good, number: "1234" }, now),
        readCard({ ...good, expiry: "08/26" }, now),
        readCard({ ...good, expiry: "13/28" }, now),
        readCard({ ...good, expiry: "12/60" }, now),
        readCard({ ...good, cvv: "12" }, now),
        readCard({ ...good, name: "" }, now),
        readCard(null, now),
        readCard("4012000000020006", now),
        readCard({ number: 4012000000020006 }, now),
    ];
    for (const one of refused) {
        assert.equal(one.ok, false);
        if (!one.ok) assert.doesNotMatch(one.message, /\d{4}/, "a message must not repeat what was typed");
    }
    assert.ok(passesLuhn("4012000000020006"));
    assert.ok(!passesLuhn("4012000000020016"));
    assert.ok(!passesLuhn("4012-0000"));
});

test("what the gateway's answer means", () => {
    assert.ok(isApproved({ Approved: true, IsoResponseCode: "00" }));
    assert.ok(isApproved({ IsoResponseCode: "00" }));
    assert.ok(!isApproved({ Approved: false, IsoResponseCode: "00" }), "an explicit no is a no");
    assert.ok(!isApproved({ IsoResponseCode: "SP4" }));
    assert.ok(!isApproved({}));

    const status = (code: string) => authenticationOf({ RiskManagement: { ThreeDSecure: { AuthenticationStatus: code } } });
    assert.equal(status("Y"), "passed");
    assert.equal(status("a"), "passed");
    assert.equal(status("N"), "failed");
    assert.equal(status("U"), "failed");
    assert.equal(status("R"), "failed");
    assert.equal(authenticationOf({}), "unknown");
    assert.equal(authenticationOf({ RiskManagement: {} }), "unknown");

    assert.match(declineMessage({ IsoResponseCode: "51" }), /enough funds/);
    assert.match(declineMessage({ IsoResponseCode: "3D1" }), /could not verify/);
    assert.match(declineMessage({ IsoResponseCode: "ZZ", ResponseMessage: "System.NullReferenceException at…" }), /did not go through/);
    assert.doesNotMatch(declineMessage({ ResponseMessage: "System.NullReferenceException" }), /Exception/, "the gateway's own words are not shown");
});

test("what is posted on the way back is read in every shape it comes in", () => {
    const answer = { IsoResponseCode: "3D0", SpiToken: "abc", OrderIdentifier: "o-1" };
    const asForm = `Response=${encodeURIComponent(JSON.stringify(answer))}`;
    assert.deepEqual(parseCallback("application/x-www-form-urlencoded", asForm, new URLSearchParams()), answer);
    assert.deepEqual(parseCallback("application/json; charset=utf-8", JSON.stringify(answer), new URLSearchParams()), answer);
    assert.deepEqual(parseCallback("application/x-www-form-urlencoded", "SpiToken=abc&IsoResponseCode=3D0", new URLSearchParams()), { SpiToken: "abc", IsoResponseCode: "3D0" });
    assert.deepEqual(parseCallback("", "", new URLSearchParams("SpiToken=abc")), { SpiToken: "abc" });
    // what is in the body is not overwritten by the address
    assert.equal(parseCallback("application/json", JSON.stringify(answer), new URLSearchParams("SpiToken=other")).SpiToken, "abc");
    assert.deepEqual(parseCallback("application/json", "not json", new URLSearchParams()), {});
    assert.deepEqual(parseCallback("application/json", "[1,2]", new URLSearchParams()), {});
    assert.deepEqual(parseCallback("application/x-www-form-urlencoded", "Response=%7Bbroken", new URLSearchParams()), {});
});

test("an approval counts only for the top-up it is about", () => {
    const topup = { id: "t-1", transactionId: "0F8FAD5B-D9CB-469F-A165-70867728950E", chargedMinor: 600, chargedCurrency: "USD" };
    const answer = { OrderIdentifier: "t-1", TransactionIdentifier: "0f8fad5b-d9cb-469f-a165-70867728950e", TotalAmount: 6, CurrencyCode: "840" };

    assert.deepEqual(answersFor(topup, answer), { ok: true });
    assert.deepEqual(answersFor(topup, { ...answer, CurrencyCode: undefined }), { ok: true });
    assert.equal(answersFor(topup, { ...answer, OrderIdentifier: "t-2" }).ok, false);
    assert.equal(answersFor(topup, { ...answer, TransactionIdentifier: "another" }).ok, false);
    assert.equal(answersFor(topup, { ...answer, TotalAmount: 0.06 }).ok, false, "six cents is not six dollars");
    assert.equal(answersFor(topup, { ...answer, TotalAmount: 600 }).ok, false);
    assert.equal(answersFor(topup, { ...answer, TotalAmount: undefined }).ok, false);
    assert.equal(answersFor(topup, { ...answer, CurrencyCode: "388" }).ok, false, "six Jamaican dollars is not six US dollars");
    assert.equal(answersFor({ ...topup, transactionId: null }, answer).ok, false);
    assert.equal(answersFor({ ...topup, chargedMinor: null }, answer).ok, false);

    const jamaican = { id: "t-3", transactionId: "abc", chargedMinor: 96_000, chargedCurrency: "JMD" };
    assert.deepEqual(answersFor(jamaican, { OrderIdentifier: "t-3", TransactionIdentifier: "abc", TotalAmount: 960, CurrencyCode: "388" }), { ok: true });
});
