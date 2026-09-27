// Take a set of screenshots of the engine preview (/dev/world) in one go, for judging how the world looks.
// Needs `npm run dev` running.
//
// Usage: node scripts/shots.mjs [name-filter] [--width=1280] [--height=800]
//   e.g. node scripts/shots.mjs            every view
//        node scripts/shots.mjs sakura     only views whose name contains "sakura"
import { openBrowser } from "./testBrowser.mjs";

const VIEWS = [
    { name: "village-day", query: "kind=settlement&biome=meadow&time=day&kit=mediterranean&seed=11" },
    { name: "village-timber-golden", query: "kind=settlement&biome=autumn&time=golden&kit=timber&seed=23&weather=petals" },
    { name: "village-eastern-dusk", query: "kind=settlement&biome=sakura&time=dusk&kit=eastern&seed=5&weather=petals" },
    { name: "wilds-forest-day", query: "kind=wilds&biome=forest&time=day&seed=7&weather=fireflies" },
    { name: "wilds-sakura-dawn", query: "kind=wilds&biome=sakura&time=dawn&seed=9&weather=petals" },
    { name: "wilds-snow", query: "kind=wilds&biome=snow&time=day&seed=4&weather=snowfall" },
    { name: "wilds-desert-golden", query: "kind=wilds&biome=desert&time=golden&seed=8&kit=adobe" },
    { name: "coast-day", query: "kind=settlement&biome=coast&time=day&seed=31&kit=mediterranean" },
    { name: "swamp-mist", query: "kind=wilds&biome=swamp&time=dusk&seed=6&weather=mist" },
    { name: "depths-crystal-night", query: "kind=depths&biome=crystal&time=night&seed=3&weather=fireflies" },
    { name: "depths-volcanic", query: "kind=depths&biome=volcanic&time=dusk&seed=12&weather=embers" },
    { name: "twilight-night", query: "kind=wilds&biome=twilight&time=night&seed=14&weather=fireflies" },
];

const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const browser = await openBrowser({ role: "public", width: Number(flag("width", 1280)), height: Number(flag("height", 800)) });
try {
    for (const view of VIEWS) {
        if (filter !== undefined && !view.name.includes(filter)) continue;
        await browser.goto(`/dev/world?${view.query}`, 500);
        await browser.waitFor("window.__wordbound !== undefined && window.__wordbound.report().ready", 60000);
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const report = await browser.game("report");
        console.log(`${view.name}: ${report.fps} fps, ${report.drawCalls} draws, ${Math.round(report.triangles / 1000)}k tris, ${report.planted} plants, errors ${JSON.stringify(browser.problems)}`);
        console.log(`  saved ${await browser.shot(`world-${view.name}`)}`);
        browser.problems.length = 0;
    }
} finally {
    await browser.close();
}
