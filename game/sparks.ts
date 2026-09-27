/**
 * Sparks: what a new book is built around, drawn by lot.
 *
 * Asked to invent a story from nothing, a model invents the same story every
 * time — the first seven books forged here were all about a bell and a loaf
 * of bread. Asked to invent one around a kite, a salt marsh and a road that
 * is longer going home, it cannot fall back on its favourite. The lists are
 * deliberately plain: they are starting points, and the storyteller is told
 * it may bend them.
 */
import { createRng } from "./worldgen/rng";

const FOLK = [
    "beekeepers", "glassblowers", "kite makers", "salt rakers", "shepherds", "boat builders", "dyers", "clockmakers",
    "tea growers", "paper makers", "potters", "fishers", "weavers", "lighthouse keepers", "mushroom foragers",
    "stone carvers", "vine growers", "cheesemakers", "puppeteers", "map makers", "bakers", "bell founders",
    "ferry keepers", "lamp lighters", "seed savers", "instrument makers", "ice cutters", "herb gatherers",
    "rope walkers", "letter carriers", "well diggers", "silk farmers", "charcoal burners", "orchard keepers",
] as const;

const LAND = [
    "a harbour town built on stilts", "terraced hills above a river", "an island joined to the shore at low tide",
    "a market on an old bridge", "a village around a hot spring", "a town at the edge of the dunes",
    "a high mountain pass", "a river delta of a hundred channels", "a clearing among very tall trees",
    "a town of canals", "a village on a cliff above the sea", "the shore of a great lake",
    "a plateau of windmills", "a valley that floods each spring", "a crossroads inn and the hamlet around it",
    "a quarry town cut into white stone", "a hillside of caves made into homes", "a fishing village under northern lights",
    "a caravan halt beside an oasis", "a walled garden city", "a moorland of standing stones", "a snowbound monastery town",
] as const;

const THING = [
    "a kite", "a compass", "a loom", "a key", "a mask", "a teapot", "a ladder", "a drum", "a mirror", "a map",
    "a candle", "a thimble", "a rowing boat", "a kettle", "a pocket watch", "a feather", "a jar of honey", "a glass bead",
    "an umbrella", "a fiddle", "an anchor", "a chess piece", "a scarf", "a spyglass", "a bottle of ink", "a music box",
    "a weather vane", "a pair of red shoes", "a basket of eggs", "a spinning top", "a walking stick", "a bundle of letters",
    "a seed", "a wooden spoon", "a paper lantern", "a fishing net", "a ring of keys", "a quilt",
] as const;

const STRANGE = [
    "a season that has not come", "a road that is longer going home than going out", "every animal gathering in one place",
    "a colour that has gone missing from the town", "letters arriving from someone nobody knows", "a door in a tree",
    "a well with a staircase inside it", "footprints that begin in the middle of a field",
    "a festival nobody remembers founding", "a tune everyone hums and nobody was taught",
    "a fog that arrives at the same hour every day", "a river that runs the other way at night",
    "shadows that point the wrong way", "an echo that answers a day late", "a house that was not there last week",
    "a name everyone has forgotten at once", "a lamp that lights itself", "a tide in a lake that has none",
    "a map that shows a street too many", "birds that will not cross a certain field", "a clock tower that strikes thirteen",
    "a garden that blooms only for strangers", "snow that falls on one roof only", "a bridge that ends halfway across",
] as const;

/** the shape of the title: left alone, every book is called "The Something Beneath the Something" */
const TITLE = [
    "two things joined by \"and\"",
    "a place, named, and what it is like",
    "a person's name and the thing they keep",
    "a moment in time, as one would begin an anecdote",
    "a question",
    "one thing, plainly named, with its article",
    "a warning or an instruction",
    "who someone is, by what they do",
    "a number of things",
    "a season or an hour, and what happens in it",
] as const;

export type Sparks = { folk: string; land: string; thing: string; strange: string; title: string };

/** the same sparks for the same seed, so a forge that is tried again writes the same book */
export function sparksFor(seed: number): Sparks {
    const rng = createRng(seed ^ 0x5bab);
    return {
        folk: rng.pick(FOLK), land: rng.pick(LAND), thing: rng.pick(THING), strange: rng.pick(STRANGE),
        title: rng.pick(TITLE),
    };
}

export const SPARK_COUNTS = { folk: FOLK.length, land: LAND.length, thing: THING.length, strange: STRANGE.length };
