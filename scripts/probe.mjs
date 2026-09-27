// Ask a page a question: opens it as a test account and prints what a JavaScript expression evaluates to.
// Needs `npm run dev` running.
//
// Usage: node scripts/probe.mjs <player|newcomer|public> <path> "<expression>" [--wait=4000]
//   e.g. node scripts/probe.mjs public / "getComputedStyle(document.querySelector('.page-float')).backgroundColor"
import { openBrowser } from "./testBrowser.mjs";

const [role = "public", rawPath = "/", expression = "document.title", ...flags] = process.argv.slice(2);
const pagePath = rawPath.replace(/^[A-Za-z]:[\\/]Program Files[\\/]Git/i, "");
const wait = Number(flags.find((f) => f.startsWith("--wait="))?.split("=")[1] ?? 4000);

const browser = await openBrowser({ role });
try {
    await browser.goto(pagePath, wait);
    console.log(JSON.stringify(await browser.evaluate(expression), null, 2));
    if (browser.problems.length > 0) console.log("errors:", JSON.stringify(browser.problems));
} finally {
    await browser.close();
}
