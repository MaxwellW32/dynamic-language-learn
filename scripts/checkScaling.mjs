// Every page, and the hero step of the new-book wizard, at display scalings other than 100%.
//
//   node scripts/checkScaling.mjs [bookId] [--base=http://localhost:3011]
//
// A canvas is drawn in device pixels. At 100% those are the same as CSS pixels, so a canvas that was never given
// a CSS size looks right; at 125%, 150% or on any phone it is bigger than its holder, the holder grows to fit,
// the bigger holder is measured, and the page runs away downward. It was found by a person, not by a test,
// because the tests all ran at 100%. This is the test.
//
// With a book id the game itself is checked too. Makes no model calls.
import { openBrowser } from "./testBrowser.mjs";

const args = process.argv.slice(2);
const bookId = args.find((arg) => !arg.startsWith("--")) ?? null;
const baseUrl = args.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "http://localhost:3011";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SCREENS = [
    { width: 1280, height: 800, scale: 1 },
    { width: 1280, height: 800, scale: 1.25 },
    { width: 1536, height: 864, scale: 1.5 },
    { width: 390, height: 844, scale: 3 },
    { width: 412, height: 915, scale: 2.625 },
];
const PAGES = ["/", "/wallet", "/study", "/about/dictionaries", "/book/new", ...(bookId ? [`/book/${bookId}`] : [])];

const MEASURE = `JSON.stringify((() => ({
    page: document.documentElement.scrollHeight,
    wide: document.documentElement.scrollWidth - window.innerWidth,
    canvases: [...document.querySelectorAll("canvas")].map((canvas) => {
        const box = canvas.getBoundingClientRect();
        const holder = canvas.parentElement.getBoundingClientRect();
        return { shown: [Math.round(box.width), Math.round(box.height)], holder: [Math.round(holder.width), Math.round(holder.height)], drawn: [canvas.width, canvas.height] };
    }),
}))())`;

/** measure twice, a moment apart: a page that is running away is a different height each time */
async function problemsOn(me, settle) {
    await wait(settle);
    const first = JSON.parse(await me.evaluate(MEASURE));
    await wait(2000);
    const second = JSON.parse(await me.evaluate(MEASURE));
    const problems = [];
    if (first.page !== second.page) problems.push(`the page is changing height: ${first.page} → ${second.page} px`);
    if (second.page > 12000) problems.push(`the page is ${second.page} px tall`);
    if (second.wide > 1) problems.push(`the page is ${second.wide} px too wide`);
    for (const canvas of second.canvases) {
        if (Math.abs(canvas.shown[0] - canvas.holder[0]) > 2 || Math.abs(canvas.shown[1] - canvas.holder[1]) > 2) {
            problems.push(`a canvas is shown at ${canvas.shown} in a holder of ${canvas.holder}`);
        }
        // the engine may draw at less than the screen's scale to keep its frame rate, never at more than three times
        const ratio = canvas.drawn[0] / Math.max(1, canvas.shown[0]);
        if (ratio < 0.45 || ratio > 3.05) problems.push(`a canvas shown at ${canvas.shown} is drawn at ${canvas.drawn}`);
    }
    const overflow = await me.overflow();
    if (overflow.length > 0) problems.push(`runs off the side: ${JSON.stringify(overflow).slice(0, 160)}`);
    return { problems, canvases: second.canvases };
}

let failed = 0;
const report = (name, { problems, canvases }) => {
    if (problems.length > 0) failed++;
    const drawn = canvases.map((canvas) => `canvas ${canvas.shown} drawn ${canvas.drawn}`).join("; ");
    console.log(`  ${problems.length === 0 ? "PASS" : "FAIL"}  ${name}${drawn ? `  (${drawn})` : ""}${problems.map((problem) => `\n        ${problem}`).join("")}`);
};

for (const screen of SCREENS) {
    console.log(`\n${screen.width}×${screen.height} at ${Math.round(screen.scale * 100)}%`);
    const me = await openBrowser({ role: "player", baseUrl, ...screen });
    try {
        for (const page of PAGES) {
            await me.goto(page);
            const game = bookId !== null && page === `/book/${bookId}`;
            if (game) await me.waitFor("window.__wordbound !== undefined && window.__wordbound.report().hud.ready", 90000, 1000);
            report(game ? "the game" : page, await problemsOn(me, game ? 2500 : 1500));
        }

        // the hero step is the third of the wizard, and holds the only canvas outside the game
        await me.goto("/book/new", 3500);
        if (!(await me.click("Spanish", 600))) throw new Error("the wizard did not offer Spanish");
        await me.click("Brand new", 300);
        await me.click("Go on", 900);
        await me.click("Fairy tale", 300);
        await me.click("whimsical", 300);
        await me.click("Go on", 900);
        await me.waitForText("who are you", 20000);
        const hero = await problemsOn(me, 1200);
        if (hero.canvases.length !== 1) hero.problems.push(`${hero.canvases.length} canvases where the hero should stand`);
        await me.click("Surprise me", 1200);
        const again = await problemsOn(me, 300);
        report("the wizard's hero step", { problems: [...hero.problems, ...again.problems.map((problem) => `after "Surprise me": ${problem}`)], canvases: hero.canvases });

        const errors = (me.errors ?? []).filter((error) => !/favicon/.test(String(error)));
        if (errors.length > 0) report("the console", { problems: errors.map((error) => String(error).slice(0, 200)), canvases: [] });
    } catch (error) {
        report("the walk through", { problems: [error instanceof Error ? error.message : String(error)], canvases: [] });
    } finally {
        await me.close();
    }
}

console.log(failed === 0 ? "\nEvery page holds its shape at every scaling." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 2);
