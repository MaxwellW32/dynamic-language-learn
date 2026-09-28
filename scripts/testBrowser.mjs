// Sign in as a test account in headless Chrome and look at, or play, the game (test mode — see lib/testMode.ts).
// Needs `npm run dev` running and `npm run test:seed` done once.
//
// Usage: node scripts/testBrowser.mjs <player|newcomer|public> [path] [--width=1280] [--height=800] [--wait=4000] [--out=name] [--full]
//   e.g. node scripts/testBrowser.mjs player /
//        node scripts/testBrowser.mjs player /book/<id> --wait=9000
//        node scripts/testBrowser.mjs public / --width=390 --height=844
// Prints horizontal overflow, console errors and (on a game page) the engine's own report, and saves a PNG to .test-shots/
//
// It can also be imported to script a whole play session:
//   import { openBrowser } from "./scripts/testBrowser.mjs"
//   const me = await openBrowser({ role: "player" })
//   await me.goto("/book/<id>", 9000)
//   await me.hold("KeyW", 1500)                 // walk forward
//   await me.game("walkTo", { kind: "character" })  // or let the engine path there
//   await me.click("Talk"); await me.type("say something", "Hola"); await me.press("Enter")
//   console.log(await me.game("report")); await me.shot("after-talk"); await me.close()
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ENV_FILES = [".env.development.local", ".env.local"];

function readEnv(key) {
    if (process.env[key] !== undefined) return process.env[key];
    for (const file of ENV_FILES) {
        if (!existsSync(file)) continue;
        const match = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
        if (match !== null) return match[1].trim().replace(/^["']|["']$/g, "");
    }
    return undefined;
}

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
    ];
    const found = candidates.find(candidate => candidate !== undefined && existsSync(candidate));
    if (found === undefined) throw new Error("Chrome not found - set CHROME_PATH");
    return found;
}

//key names as the game reads them (KeyboardEvent.code) -> what Chrome's Input domain needs
function keyInfo(code) {
    const named = {
        Enter: { key: "Enter", vk: 13, text: "\r" }, Escape: { key: "Escape", vk: 27 }, Space: { key: " ", vk: 32, text: " " },
        Tab: { key: "Tab", vk: 9 }, Backspace: { key: "Backspace", vk: 8 },
        ArrowLeft: { key: "ArrowLeft", vk: 37 }, ArrowUp: { key: "ArrowUp", vk: 38 }, ArrowRight: { key: "ArrowRight", vk: 39 }, ArrowDown: { key: "ArrowDown", vk: 40 },
        ShiftLeft: { key: "Shift", vk: 16 },
    };
    if (named[code] !== undefined) return { code, ...named[code] };
    const letter = code.match(/^Key([A-Z])$/);
    if (letter !== null) return { code, key: letter[1].toLowerCase(), vk: letter[1].charCodeAt(0), text: letter[1].toLowerCase() };
    const digit = code.match(/^Digit([0-9])$/);
    if (digit !== null) return { code, key: digit[1], vk: digit[1].charCodeAt(0), text: digit[1] };
    throw new Error(`Unknown key code: ${code}`);
}

//`scale` is how many device pixels make one CSS pixel: a phone has 2 or 3, a Windows laptop is usually set to
//125% or 150%. Anything that sizes a canvas must be checked at a scale that is not 1 - at 1 a canvas is by chance
//the same size in both kinds of pixel, and a missing CSS size goes unseen.
export async function openBrowser({ role = "public", width = 1280, height = 800, baseUrl = "http://localhost:3011", software = false, scale } = {}) {
    const isMobile = width < 900;
    const deviceScaleFactor = scale ?? (isMobile ? 2 : 1);
    const port = 9400 + Math.floor(Math.random() * 500);
    const profile = path.join(os.tmpdir(), `wb-test-profile-${port}`);
    //the game is WebGL: use the real GPU when there is one, or Chrome's software renderer with { software: true }
    const gl = software
        ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        : ["--ignore-gpu-blocklist", "--enable-gpu"];
    const chrome = spawn(findChrome(), [
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--hide-scrollbars",
        "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
        ...gl, "about:blank",
    ], { stdio: "ignore" });

    let wsUrl;
    for (let attempt = 0; attempt < 60 && wsUrl === undefined; attempt++) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
            wsUrl = targets.find(target => target.type === "page")?.webSocketDebuggerUrl;
        } catch { /* chrome is still starting */ }
        if (wsUrl === undefined) await sleep(200);
    }
    if (wsUrl === undefined) throw new Error("Chrome did not start");

    const ws = new WebSocket(wsUrl);
    await new Promise(resolve => ws.addEventListener("open", resolve));

    let nextId = 1;
    const pending = new Map();
    const problems = [];
    ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== undefined && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        }
        if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") problems.push(message.params.args.map(arg => arg.value ?? arg.description ?? "").join(" ").slice(0, 400));
        if (message.method === "Runtime.exceptionThrown") problems.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`.slice(0, 400));
        if (message.method === "Network.responseReceived" && message.params.response.status >= 500) problems.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`.slice(0, 300));
    });
    const send = (method, params = {}) => new Promise(resolve => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: isMobile });
    if (isMobile) {
        await send("Emulation.setTouchEmulationEnabled", { enabled: true });
        await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
    }

    const evaluate = async (expression) => {
        const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (reply.result?.exceptionDetails !== undefined) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
        return reply.result?.result?.value;
    };

    //finds what a person would call "the X button": visible, enabled, whose text or label contains the words
    const locate = (label, selector) => `(() => {
        const wanted = ${JSON.stringify(label)}.toLowerCase()
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getClientRects().length > 0 && !e.disabled && ((e.textContent ?? "") + " " + (e.getAttribute("aria-label") ?? "") + " " + (e.getAttribute("title") ?? "") + " " + (e.placeholder ?? "")).toLowerCase().includes(wanted))
        if (el === undefined) return null
        el.scrollIntoView({ block: "center", inline: "center" })
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`;

    const browser = {
        role,
        problems,
        evaluate,

        //the first visit signs the role in through /api/test-login and lands on the path; later visits are plain navigations
        async goto(pagePath = "/", wait = 4000) {
            let url = `${baseUrl}${pagePath}`;
            if (role !== "public" && browser.signedIn !== true) {
                const secret = readEnv("TEST_MODE_SECRET");
                if (secret === undefined || secret.length < 16) throw new Error("TEST_MODE_SECRET is missing from .env.development.local");
                url = `${baseUrl}/api/test-login?as=${role}&secret=${encodeURIComponent(secret)}&to=${encodeURIComponent(pagePath)}`;
                browser.signedIn = true;
            }
            await send("Page.navigate", { url });
            await sleep(wait);
            return evaluate("location.pathname + location.search + location.hash");
        },

        //wait until a page expression becomes truthy, e.g. waitFor("document.querySelector('canvas') !== null")
        async waitFor(expression, timeout = 30000, every = 300) {
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                try {
                    const value = await evaluate(expression);
                    if (value) return value;
                } catch { /* the page may be mid-navigation */ }
                await sleep(every);
            }
            throw new Error(`Timed out after ${timeout}ms waiting for: ${expression}`);
        },

        waitForText: (text, timeout = 30000) => browser.waitFor(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`, timeout),

        //a real mouse click (the 3D canvas and React both see it) on the first visible control whose text contains the label
        async click(label, wait = 1200) {
            const at = await evaluate(locate(label, "button, a, [role=button], [role=tab], [role=option], label, summary, [data-click]"));
            if (at === null || at === undefined) return false;
            await browser.clickAt(at.x, at.y, 0);
            await sleep(wait);
            return true;
        },

        async clickAt(x, y, wait = 600) {
            await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
            await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
            await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
            await sleep(wait);
        },

        //type into an input found by its placeholder or label, the way React expects (native setter + input event)
        async type(placeholderPart, text, wait = 300) {
            const typed = await evaluate(`(() => {
                const wanted = ${JSON.stringify(placeholderPart)}.toLowerCase()
                const el = [...document.querySelectorAll("input, textarea")].find(e => e.getClientRects().length > 0 && ((e.placeholder ?? "") + " " + (e.getAttribute("aria-label") ?? "") + " " + (e.name ?? "")).toLowerCase().includes(wanted))
                if (el === undefined) return false
                el.focus()
                const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
                Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(text)})
                el.dispatchEvent(new Event("input", { bubbles: true }))
                return true
            })()`);
            await sleep(wait);
            return typed;
        },

        //press and release a key (KeyboardEvent.code names: "KeyE", "Enter", "Escape", "Space", "ArrowUp"…)
        async press(code, wait = 400) {
            await browser.hold(code, 60);
            await sleep(wait);
        },

        //hold a key down for a while - this is how to walk: hold("KeyW", 2000)
        async hold(code, ms) {
            const info = keyInfo(code);
            await send("Input.dispatchKeyEvent", { type: info.text !== undefined ? "keyDown" : "rawKeyDown", code: info.code, key: info.key, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk, text: info.text });
            await sleep(ms);
            await send("Input.dispatchKeyEvent", { type: "keyUp", code: info.code, key: info.key, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk });
        },

        text: () => evaluate("document.body.innerText"),

        //talk to the running game through its dev hook (components/game/devHook.ts): game("report"), game("walkTo", {kind:"enemy"})…
        game: (command, args = {}) => evaluate(`(async () => {
            const hook = window.__wordbound
            if (hook === undefined) return { error: "no game on this page" }
            const fn = hook[${JSON.stringify(command)}]
            if (typeof fn !== "function") return { error: "unknown command", commands: Object.keys(hook) }
            return await fn(${JSON.stringify(args)})
        })()`),

        //elements that stick out past the screen edge (ignores intentional horizontal scrollers)
        overflow: () => evaluate(`(() => {
            const out = []
            for (const el of document.querySelectorAll("body *")) {
                const r = el.getBoundingClientRect()
                if (r.width === 0 || r.height === 0 || (r.right <= innerWidth + 1 && r.left >= -1)) continue
                if (el.closest("[data-offscreen-ok]") !== null) continue
                let p = el.parentElement, clipped = false
                while (p !== null && p !== document.body) { const s = getComputedStyle(p); if (s.overflowX !== "visible") { clipped = true; break } p = p.parentElement }
                if (!clipped) out.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 60) + " [" + Math.round(r.left) + "-" + Math.round(r.right) + "]")
            }
            return out.slice(0, 10)
        })()`),

        async shot(name, { full = false } = {}) {
            mkdirSync(".test-shots", { recursive: true });
            const file = path.join(".test-shots", `${name}.png`);
            if (full) {
                const tall = await evaluate(`(() => { let h = document.documentElement.scrollHeight; for (const el of document.querySelectorAll("body *")) { const s = getComputedStyle(el); if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4) h = Math.max(h, el.scrollHeight + 160) } return Math.min(h, 6000) })()`);
                await send("Emulation.setDeviceMetricsOverride", { width, height: Math.max(height, tall), deviceScaleFactor: 1, mobile: isMobile });
                await sleep(600);
            }
            const capture = await send("Page.captureScreenshot", { format: "png" });
            writeFileSync(file, Buffer.from(capture.result.data, "base64"));
            if (full) await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: isMobile });
            return file;
        },

        async close() {
            ws.close();
            chrome.kill();
            await sleep(400);
            try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows can hold the folder for a moment */ }
        },
    };

    return browser;
}

//command line use
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [role = "public", rawPath = "/", ...flags] = process.argv.slice(2);
    //Git Bash on Windows rewrites an argument like /book into C:/Program Files/Git/book - undo that
    const pagePath = rawPath.replace(/^[A-Za-z]:[\\/]Program Files[\\/]Git/i, "");
    const flag = (name, fallback) => flags.find(f => f.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

    const browser = await openBrowser({ role, width: Number(flag("width", 1280)), height: Number(flag("height", 800)), software: flags.includes("--software") });
    try {
        const landed = await browser.goto(pagePath, Number(flag("wait", 4000)));
        const name = flag("out", `${role}${pagePath.replace(/[^a-z0-9]+/gi, "-")}`.replace(/-$/, ""));
        console.log(`landed on: ${landed}`);
        console.log(`overflow:  ${JSON.stringify(await browser.overflow())}`);
        console.log(`errors:    ${JSON.stringify(browser.problems)}`);
        const report = await browser.game("report");
        if (report?.error === undefined) console.log(`game:      ${JSON.stringify(report)}`);
        console.log(`saved:     ${await browser.shot(name, { full: flags.includes("--full") })}`);
    } finally {
        await browser.close();
    }
}
