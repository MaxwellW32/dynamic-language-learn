// Creates a book in the browser as the test player, the way a person would: through the wizard, through the
// forge, into the world. Makes real model calls (about 7 cents). Needs `npm run dev` running.
//
// Usage: node scripts/newBook.mjs [language name] [--width=1280] [--height=800]
//   e.g. node scripts/newBook.mjs Japanese
//        node scripts/newBook.mjs French --width=390 --height=844
import { openBrowser } from "./testBrowser.mjs";

const args = process.argv.slice(2);
const language = args.find((a) => !a.startsWith("--")) ?? "Japanese";
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const me = await openBrowser({ role: "player", width: Number(flag("width", 1280)), height: Number(flag("height", 800)) });
const say = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const tag = language.toLowerCase();

try {
    await me.goto("/book/new", 4000);
    await me.shot(`new-${tag}-1-language`);
    if (!(await me.click(language, 600))) throw new Error(`no language called ${language} on the page`);
    await me.click("Brand new", 300);
    await me.shot(`new-${tag}-1-chosen`, { full: true });
    await me.click("Go on", 900);

    await me.click("Fairy tale", 300);
    await me.click("whimsical", 300);
    await me.shot(`new-${tag}-2-story`, { full: true });
    await me.click("Go on", 1500);

    await me.type("villagers will call you", "Claude");
    await me.click("Surprise me", 1800);
    await me.shot(`new-${tag}-3-hero`, { full: true });
    say("overflow in the wizard", await me.overflow());

    const started = Date.now();
    await me.click("Write my book", 4000);
    say("forging at", await me.evaluate("location.pathname"));
    await me.shot(`new-${tag}-4-forging`);
    await sleep(20000);
    await me.shot(`new-${tag}-5-forging-later`);

    await me.waitFor("window.__wordbound !== undefined && window.__wordbound.report().hud.ready", 300000, 1000);
    say("forged in", `${Math.round((Date.now() - started) / 1000)}s`);
    await sleep(2500);
    const report = await me.game("report");
    say("book", { region: report.region, hud: report.hud, characters: report.characters.map((c) => c.name), enemies: report.enemies.map((e) => e.name) });
    await me.shot(`new-${tag}-6-first-page`);

    await me.click("Go on", 1500);
    await sleep(1000);
    await me.shot(`new-${tag}-7-world`);
    say("labels in the world", await me.evaluate(`[...document.querySelectorAll(".wb-label-word")].map(e => e.textContent)`));
    say("book id", (await me.evaluate("location.pathname")).split("/").pop());
    say("console errors", me.problems);
} catch (error) {
    console.error(`stopped: ${error instanceof Error ? error.message : error}`);
    await me.shot(`new-${tag}-stopped`);
    say("page says", (await me.text().catch(() => "")).slice(0, 400));
    say("console errors", me.problems);
    process.exitCode = 1;
} finally {
    await me.close();
}
