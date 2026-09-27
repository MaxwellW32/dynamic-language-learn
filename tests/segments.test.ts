import { test } from "node:test";
import assert from "node:assert/strict";
import { respace, segmentsToPlainText, type Segment } from "../game/segments";

const text = (v: string): Segment => ({ t: "text", v });
const word = (s: string): Segment => ({ t: "word", id: 1, s });
const tl = (v: string): Segment => ({ t: "tl", v, tr: "", tk: [{ s: v }] });
const read = (segments: Segment[], spaced = true) => segmentsToPlainText(respace(segments, spaced));

test("a forgotten space beside the other language is put back", () => {
    assert.equal(read([tl("Hallo, Claude!"), text("I'm Emil.")]), "Hallo, Claude! I'm Emil.");
    assert.equal(read([text("She hands you a warm"), word("pan"), text("and smiles.")]), "She hands you a warm pan and smiles.");
    assert.equal(read([text("*smiles*"), tl("Guten Morgen!")]), "*smiles* Guten Morgen!");
    assert.equal(read([tl("Sehr gern!"), text("*tugs a ribbon* Come.")]), "Sehr gern! *tugs a ribbon* Come.");
});

test("spaces that are already there are not doubled", () => {
    assert.equal(read([text("a warm "), word("pan"), text(" and")]), "a warm pan and");
    assert.equal(read([tl("Hola."), text(" She waves.")]), "Hola. She waves.");
});

test("punctuation keeps hold of its word", () => {
    assert.equal(read([text("You smell fresh"), word("pan"), text(", and follow it.")]), "You smell fresh pan, and follow it.");
    assert.equal(read([text("Is that a"), word("pozo"), text("?")]), "Is that a pozo?");
    assert.equal(read([text("Claude—"), tl("mira"), text("—the door.")]), "Claude—mira—the door.");
    assert.equal(read([text("She calls ("), tl("¡ven!"), text(") and waits.")]), "She calls (¡ven!) and waits.");
    assert.equal(read([text("“"), tl("Buenos días"), text(",” she says.")]), "“Buenos días,” she says.");
    assert.equal(read([text("He says \""), tl("Bonjour"), text("\" and bows.")]), "He says \"Bonjour\" and bows.");
});

test("possessives and elisions are not pulled apart", () => {
    assert.equal(read([text("the"), word("panadero"), text("'s apron")]), "the panadero's apron");
    assert.equal(read([text("a glass of l'"), word("eau")]), "a glass of l'eau");
});

test("two pieces of the language side by side", () => {
    assert.equal(read([tl("Hola."), tl("¿Qué tal?")]), "Hola. ¿Qué tal?");
    assert.equal(read([tl("こんにちは。"), tl("元気ですか。")], false), "こんにちは。元気ですか。");
    assert.equal(read([text("You buy"), word("パン"), text("at the stall.")], false), "You buy パン at the stall.");
    assert.equal(read([tl("元気ですか"), text("。")], false), "元気ですか。");
});

test("what it is given is left as it was", () => {
    const given: Segment[] = [tl("Hallo!"), text("I'm Emil.")];
    respace(given, true);
    assert.deepEqual(given, [tl("Hallo!"), text("I'm Emil.")]);
});
