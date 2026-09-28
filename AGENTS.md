# Notes for AI assistants working on Wordbound

This file is loaded into every session (CLAUDE.md imports it). Keep it short and current.
Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything structural.

## You can sign in and play the game yourself — do it

Test accounts exist so that any change is **checked in the real app, signed in, before it is
called done**. Do not rely on reading code when a screen or a flow can be run.

| Role | Account |
| --- | --- |
| player | `claude.player@wordbound.test` — onboarded, pays from a wallet that `test:seed` refills to $5, keeps its books between runs |
| newcomer | `claude.newcomer@wordbound.test` — has never onboarded; reset to that state on every seed |

- **Sign in:** `GET /api/test-login?as=<player|newcomer>&secret=<TEST_MODE_SECRET>&to=/some/path`
  on the dev server (port 3011). The secret is in `.env.development.local`. Rules and guards are
  in `lib/testMode.ts`: dev builds only, secret required, flagged test accounts only.
- **Accounts:** `npm run test:seed` (create / reset), `npm run test:status` (wallet, books, what
  the model has cost), `npm run test:books` (book ids), `npm run test:clean` (delete the accounts
  and everything they made).
- **See a screen:** `node scripts/testBrowser.mjs <player|newcomer|public> [path] [--width=1280
  --height=800 --wait=4000 --full]` — signs in with headless Chrome (WebGL on), prints horizontal
  overflow, console errors and the engine's own report, and saves a PNG to `.test-shots/`
  (gitignored). Read the PNG to look at it. Use `--width=390 --height=844` for a phone.
- **Play:** import `openBrowser` from `scripts/testBrowser.mjs` and drive it: `goto`, `click(label)`,
  `type(placeholder, text)`, `press("KeyE")`, `hold("KeyW", 1500)` to walk, `waitForText`, `shot`,
  and `game(command, args)` for the dev hook (`components/game/devHook.ts`):
  `game("report")` says what the engine is drawing and what the HUD shows;
  `game("walkTo", { kind: "character", act: true })` walks the hero to the nearest character and
  starts talking.
- **The engine on its own:** `/dev/world?kind=wilds&biome=sakura&time=dusk&weather=petals` shows a
  made-up region with no story, database or model call. `node scripts/shots.mjs` screenshots a
  dozen of them.
- **The story without a browser:** `npx tsx --conditions=react-server scripts/checkStory.ts es`
  forges a book and plays its first minutes, printing what each step wrote, took and cost.
  `scripts/checkGrowth.ts [lang] [--chapters=2] [--grow] [--keep]` plays on until the chapter
  turns (every quest done, forks taken, a long conversation, a new region) and ends with a list
  of problems found. Run it after touching quests, the director, chapters, memory or the forge.
  For logic, prefer these to screenshots: reading a PNG costs about as much as a page of text
  and proves only what is on the screen.
- **What it has cost:** `npx tsx scripts/usageReport.ts`.
- **Paying:** a test account's wallet pays through the test gateway (`app/api/dev/powertranz`),
  where a page of buttons stands in for the bank. `scripts/checkPayments.ts` walks every outcome.
  `npm run test:seed` also clears a test account's unpaid attempts, of which only six an hour are
  allowed.

### Ground rules for test runs

- The test accounts live in the **same database as real users**. Never sign in as, or write rows
  for, a non-test account.
- Model calls are real and billed to the owner's OpenAI key. A forged book costs about 7 cents, a
  conversation turn about half a cent. Do not loop.
- Headless Chrome with a desktop GPU says nothing about a phone's frame rate — say so.
- Port 3011 may be the owner's own `npm run dev`. Check who owns it before stopping anything; if
  it is theirs, use it and leave it running. If it is their `next start` (a production build,
  where test mode is off), run your own `AUTH_URL=http://localhost:3012 npx next dev -p 3012`,
  pass `baseUrl` to `openBrowser`, and **do not run `next build`**: it replaces the files their
  server is serving.
- Never read, print or edit `.env.local` or `.env.development.local`. Code reads `process.env`.

## Things that are easy to get wrong

- **Scripts that import `server/` must run with `--conditions=react-server`**
  (`npx tsx --conditions=react-server scripts/x.ts`). Every service starts with
  `import "server-only"`, which throws otherwise.
- **The model never sees a database id.** It is handed short keys (`w1`, `n2`, `r1`, `e3`, `l4`,
  `o1`) and every key it returns is checked against what was offered. People and places use the
  keys the book's bible lists them under (`castKeys` in `server/ai/prompts/rulebook.ts`).
- **Prompts are laid out stable-first** so the provider can cache them: `instructions` holds the
  rulebook, the bible and the character sheet; `input` holds everything that changes per turn.
  Never interpolate into `RULEBOOK`. Putting an immersion level, a memory or a word list in
  `instructions` silently makes every call cost several times more.
- **Reasoning effort is `"none"`, `"low"`, `"medium"` or `"high"`.** These models reject
  `"minimal"`. Leaving the field out runs at medium, which is slow.
- **Server actions return `Result<T>`** (`server/actions/result.ts`); they never throw to the
  browser. Services throw plain `Error`s whose messages are written for the player.
- **A browser's server actions run one at a time.** Anything asked *while* a long action is in
  flight (the forge's progress) must be a route handler fetched with `fetch`
  (`app/api/books/[bookId]/forge`), or it waits until the long one is over.
- **World labels are looked up by English meaning, and English is ambiguous** ("chest", "well").
  When a label is wrong, state the word in `HEADWORDS` (`server/services/worldWords.ts`), then run
  `npx tsx --conditions=react-server scripts/relabel.ts --show` to see every language's labels
  and refresh the books that already exist.
- **Money** changes only in a transaction that also writes a `credit_ledger` row
  (`server/services/wallet.ts`). Never write `users.creditMicros` directly.
- **A payment is believed only on the gateway's own answer** (`settle` in
  `server/payments/powertranz.ts`). Nothing the browser posts to the callback may credit anyone,
  name the top-up, or mark one failed. **Card numbers are never logged, stored or put in an error
  message**; when touching the card form or the gateway client, check every `console` call and
  every thrown message.
- **`drizzle-kit push --force` skips the question it asks before dropping data.** Use
  `npm run db:push` and answer it.
- **Answers never reach the browser.** Challenge stages are stored with their answers
  (`StoredStage`); only `stage.client` is ever sent.
- **A canvas must be given its size in CSS, and must not take part in the layout.** It is drawn
  in device pixels; left to size itself it is bigger than its holder on every screen that is not
  at 100%, which is every phone and most laptops, and the page grows without end. Test anything
  with a canvas at a scale other than 1: `node scripts/checkScaling.mjs [bookId]`, or
  `openBrowser({ scale: 1.5 })`. The default desktop test browser is at 100% and will not show it.
- **The engine takes no React state and causes no renders.** It writes `transform` on label
  elements itself. HUD components talk to it through the handle `WorldCanvas` gives them.
- **Region layout is a pure function of (seed, kind, biome, open gate sides)**
  (`game/worldgen/layout.ts`). Changing how it draws random numbers moves every building in every
  existing book: people would be standing inside walls. **Only the roads may depend on which
  gates are open**: a chapter turn can open a gate in a region that is already peopled, so the
  road to every gate is drawn and kept clear from the start (`tests/layout.test.ts` holds this).
- **Tasks that share a schema must share a `schemaName`** (`server/ai/client.ts`). The provider
  puts the schema and its name in front of the prompt; a greeting and a reply, or two kinds of
  narration, only reuse each other's cached prefix if both are identical.
- **A chapter ends when every quest of its stage is settled** (`isChapterTurnReady`). So a
  chapter must always have a quest (`standingQuest`), the director may not add one to a chapter
  that has just been finished, and every objective must be possible: progress is applied before
  anything is reread or skipped.
- **Schema changes:** edit `db/schema.ts`, then `npm run db:push`. Additive changes only without
  asking. The dictionary tables hold 6.6M rows — never drop them; `npm run dict:import` upserts.
- Lint forbids `setState` directly inside an effect. Derive the value, or set it from the
  callback that caused the change.
- Two files at the repo root, `notes.tsx` and `notes json area.tsx`, are the owner's scratch
  notes. Leave them alone.
