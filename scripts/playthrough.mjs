// Plays a book in the browser as the test player and screenshots each step, so a change can be judged by
// looking at the game rather than at the code. Makes real model calls (a few cents).
// Needs `npm run dev` running and a forged book on the test player's shelf (`npm run test:books`).
//
// Usage: node scripts/playthrough.mjs <bookId> [steps…] [--width=1280] [--height=800]
//   steps (default: all, in this order): battle talk examine journal travel
//   e.g. node scripts/playthrough.mjs 93a7… talk examine
import { openBrowser } from "./testBrowser.mjs";

const args = process.argv.slice(2);
const bookId = args.find((a) => !a.startsWith("--") && a.length > 20);
if (bookId === undefined) {
    console.error("Usage: node scripts/playthrough.mjs <bookId> [battle talk examine journal travel]");
    process.exit(1);
}
const asked = args.filter((a) => !a.startsWith("--") && a !== bookId);
const steps = asked.length > 0 ? asked : ["battle", "talk", "examine", "journal", "travel"];
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const me = await openBrowser({ role: "player", width: Number(flag("width", 1280)), height: Number(flag("height", 800)) });
const hud = async () => (await me.game("report")).hud;
const say = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
let shot = 0;
const snap = async (name) => say("  shot", await me.shot(`play-${String(++shot).padStart(2, "0")}-${name}`));

/** whatever is in the way of exploring — an open page, a battle left from last time — is dealt with first */
async function settle() {
    for (let i = 0; i < 12; i++) {
        const state = await hud();
        if (state.mode === "explore" && state.busy === null) return;
        if (state.mode === "reading") await me.click(state.reading?.choices ? "decide later" : "Go on", 900);
        else if (state.mode === "battle") await me.click("back away", 1200);
        else if (state.mode === "dialogue") await me.click("Say goodbye", 1200);
        else await sleep(1500);
    }
}

try {
    await me.goto(`/book/${bookId}`, 3000);
    await me.waitFor("window.__wordbound !== undefined && window.__wordbound.report().hud.ready", 90000);
    await sleep(1500);
    say("opened", await hud());
    await snap("opened");

    if (steps.includes("battle")) {
        console.log("\n— battle —");
        await settle();
        const before = await me.game("report");
        const foe = before.enemies.sort((a, b) => a.distance - b.distance)[0];
        if (foe === undefined) {
            console.log("no creature in this region");
        } else {
            await me.game("walkTo", { kind: "enemy", id: foe.id, act: true });
            await me.waitFor("window.__wordbound.report().hud.battle !== null", 30000);
            await sleep(1200);
            await snap("battle-intro");
            await me.click("Stand your ground", 900);
            for (let stage = 0; stage < 8; stage++) {
                const state = await hud();
                if (state.battle === null) break;
                say(`  stage ${state.battle.stage}/${state.battle.of}`, state.battle.kind);
                if (stage === 0) await snap("battle-stage");
                // a script cannot know the answers, and should not: answer as a guessing player would
                if (state.battle.kind === "choice" || state.battle.kind === "listen") await me.press("Digit1", 300);
                else if (state.battle.kind === "spelling") { await me.type("write the word", "agua"); await me.press("Enter", 300); }
                else if (state.battle.kind === "matching") {
                    for (let pair = 1; pair <= 4; pair++) {
                        await me.evaluate(`(() => { const cols = document.querySelectorAll("section .grid.grid-cols-2 > div"); cols[0].querySelectorAll("button")[${pair - 1}].click() })()`);
                        await sleep(150);
                        await me.evaluate(`(() => { const cols = document.querySelectorAll("section .grid.grid-cols-2 > div"); cols[1].querySelectorAll("button")[${pair - 1}].click() })()`);
                        await sleep(150);
                    }
                    await me.click("Cast", 300);
                } else if (state.battle.kind === "order") {
                    await me.evaluate(`(() => { for (const b of [...document.querySelectorAll("section .justify-center > button")]) b.click() })()`);
                    await sleep(300);
                    await me.click("Cast", 300);
                } else if (state.battle.kind === "speak") { await me.type("write it instead", "hola"); await me.press("Enter", 300); }
                await me.waitFor(`document.body.innerText.includes("xp") || /Next|Onward|Fall back/.test(document.body.innerText)`, 30000);
                await sleep(1300);
                if (stage === 0) await snap("battle-verdict");
                const text = await me.text();
                const ended = /Onward|Fall back/.test(text);
                if (ended) await snap("battle-end");
                await me.press("Enter", 1500);
                if (ended) break;
            }
            say("  after", await hud());
        }
    }

    if (steps.includes("talk")) {
        console.log("\n— talk —");
        await settle();
        await me.game("walkTo", { kind: "character", act: true });
        await me.waitFor("window.__wordbound.report().hud.dialogue !== null", 60000);
        await sleep(2500);
        say("  greeting", (await hud()).dialogue);
        await snap("talk-greeting");

        const linesAtStart = (await hud()).dialogue.lines;
        await me.evaluate(`document.querySelector("footer .grid button")?.click()`);
        await me.waitFor(`window.__wordbound.report().hud.dialogue?.lines >= ${linesAtStart + 2}`, 60000);
        await sleep(1500);
        say("  after an offered reply", (await hud()).dialogue);

        await me.type("say something", "Hola, me gusta el pan. ¿Cómo te llamas?");
        await me.press("Enter", 500);
        await me.waitFor(`window.__wordbound.report().hud.dialogue?.lines >= ${linesAtStart + 4}`, 60000);
        await sleep(1500);
        say("  after writing Spanish", (await hud()).dialogue);
        await snap("talk-spanish");

        // tap a word of the language in what they said
        const tapped = await me.evaluate(`(() => { const w = document.querySelector("section .wb-word"); if (!w) return null; w.click(); return w.textContent })()`);
        await sleep(2500);
        say("  tapped word", tapped);
        await snap("word-card");
        await me.press("Escape", 500);

        await me.click("Say goodbye", 1500);
        say("  after", await hud());
    }

    if (steps.includes("examine")) {
        console.log("\n— examine —");
        await settle();
        await me.game("walkTo", { kind: "landmark", act: true });
        await me.waitFor("window.__wordbound.report().hud.reading !== null", 60000);
        await sleep(1200);
        say("  page", (await hud()).reading);
        await snap("examine");
        await settle();
    }

    if (steps.includes("journal")) {
        console.log("\n— journal —");
        await settle();
        for (const [tab, label] of [["story", "The book"], ["quests", "Quests"], ["words", "Words"], ["map", "Places"]]) {
            if (tab === "story") await me.click(label, 1200);
            else await me.evaluate(`[...document.querySelectorAll("[role=tab]")].find(t => t.textContent.includes(${JSON.stringify(label)}))?.click()`);
            await sleep(tab === "words" ? 3000 : 900);
            await snap(`journal-${tab}`);
        }
        await me.press("Escape", 800);
    }

    if (steps.includes("travel")) {
        console.log("\n— travel —");
        await settle();
        const from = (await hud()).region;
        await me.game("walkTo", { kind: "gate", act: true });
        await me.waitFor(`window.__wordbound.report().hud.region !== ${JSON.stringify(from)} && window.__wordbound.report().hud.ready`, 120000);
        await sleep(2500);
        say("  arrived", await hud());
        await snap("travel-arrived");
        await settle();
        await sleep(800);
        await snap("travel-exploring");
    }

    const last = await me.game("report");
    console.log(`\nframe rate ${last.fps} fps, ${last.drawCalls} draw calls, ${Math.round(last.triangles / 1000)}k triangles, quality ${last.quality}`);
    console.log(`console errors: ${JSON.stringify(me.problems)}`);
} catch (error) {
    console.error(`\nstopped: ${error instanceof Error ? error.message : error}`);
    await snap("stopped");
    say("state", await hud().catch(() => "unavailable"));
    console.log(`console errors: ${JSON.stringify(me.problems)}`);
    process.exitCode = 1;
} finally {
    await me.close();
}
