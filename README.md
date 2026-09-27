# Wordbound

*A storybook you walk around inside, that teaches you its language.*

You create a book. An AI storyteller forges a world for it — a village, wild country, something
old and hidden — with people who have secrets and want things. You explore it in 3D, talk to
anyone about anything, fight creatures with words, and read the story as it writes itself, with
more and more of it in the language you are learning. Spanish, French, German, Italian,
Portuguese, Japanese, Korean and Mandarin, each backed by a full open dictionary.

**Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.** It explains how the system is put
together and why. [AGENTS.md](AGENTS.md) explains how to sign in as the test player and check
changes in the real app. [docs/ROADMAP.md](docs/ROADMAP.md) lists what is deliberately not built
yet.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · three.js · Drizzle ORM + Postgres · NextAuth v5 ·
OpenAI (structured output, speech, transcription) · Tailwind 4 · Jotai

## Setup

1. `.env.local` needs `DATABASE_URL`, `OPENAI_API_KEY`, `AUTH_SECRET`, `AUTH_URL`, and
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and/or `EMAIL` / `EMAIL_PASS` (Gmail, for sign-in links).
   Optional: `OPENAI_MODEL_STORY` (default `gpt-6-sol`), `OPENAI_MODEL_SCRIBE` (default
   `gpt-6-luna`), `USAGE_MARKUP` (default 1), `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`.
2. Apply the schema: `npm run db:push`
3. Load the dictionaries (about 620 MB to download, 1 GB in Postgres, ten minutes):
   ```bash
   npm run dict:download
   npm run dict:import
   ```
   The reviewed meanings and example sentences under `data/dict-curation/` are applied by the
   import; `npm run dict:curate <lang>` extends them.
4. For test mode, put `TEST_MODE_SECRET=<16+ random characters>` in `.env.development.local`,
   then `npm run test:seed`.
5. `npm run dev` — the app is on port 3011.

## Where things live

```
app/                routes: cover and shelf, book wizard, the game, study hall, wallet
engine/             the 3D world: terrain, plants, buildings, people, creatures, camera, effects
game/               pure logic shared by server and browser: languages, looks, story text,
                    dictionary shapes, spaced repetition, challenges, region layout
server/
  ai/               the one door to the model, prompts, output contracts, prices
  services/         game rules: forge, scene, dialogue, memory, narration, director, quests,
                    encounters, chapters, learning, dictionary, study, wallet
  actions/          "use server" wrappers: parse input → who is asking → service → Result
  payments/         payment providers behind one interface
components/
  game/             the game screen: canvas, HUD, dialogue, battle, reading, journal
  book/ shelf/      wizard, forge screen, cover, bookshelf
  words/ learn/     story text with tappable words, the word card, challenges
  study/ account/   study hall, wallet, onboarding
db/schema.ts        the data model
scripts/            dictionary pipeline, test accounts, test browser, checks
tests/              unit tests for the pure logic
```

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | the app, on port 3011 |
| `npm test` | unit tests (challenges, scheduling, dictionary helpers, prices, wallet rules, story text, region layout) |
| `npm run typecheck` · `npm run lint` | TypeScript · ESLint |
| `npm run db:push` | apply `db/schema.ts` to the database |
| `npm run db:status` | database size and row counts |
| `npm run db:reset-game` | ⚠️ drop every game table, keeping accounts and the dictionary |
| `npm run dict:download` · `dict:import` · `dict:curate <lang>` | the dictionary pipeline |
| `npm run test:seed` · `test:status` · `test:books` · `test:clean` | the test accounts |
| `node scripts/testBrowser.mjs <role> <path>` | screenshot a page as a test account |
| `node scripts/newBook.mjs [language]` | create a book through the wizard, in a browser |
| `node scripts/playthrough.mjs <bookId>` | play a book in a browser, with screenshots |
| `node scripts/shots.mjs` | screenshot a dozen made-up regions of the engine |
| `npx tsx --conditions=react-server scripts/checkStory.ts es` | forge and play a book with no browser |
| `npx tsx --conditions=react-server scripts/checkGrowth.ts it --chapters=2 --grow` | play a book until its chapters turn, and list what went wrong |
| `npx tsx --conditions=react-server scripts/relabel.ts --show` | print every language's world labels; refresh them in existing books |
| `npx tsx scripts/usageReport.ts` | what the model calls have taken and cost |

## What it costs to run

Measured with the default models (September 2026 prices):

| | model calls | cost |
|---|---|---|
| Forging a book | 4 | about 7 cents |
| A conversation turn | 1 | about 0.4 cents, once the prompt prefix is cached |
| Examining something, arriving somewhere | 1 | about 0.7 cents, first time only |
| A battle | 0 (1 for a victory page over an elite or boss) | nothing, or 0.7 cents |
| The director | 1, every so often, on the cheap model | about 0.05 cents |
| Turning a chapter | 1 (3 if the story opens a new place) | about 1 cent (6 with a new place) |
| A whole first chapter, forge included | about 30 | about 23 cents |
| Looking up, hearing or studying a word | 0 after the first time anyone heard it | nothing |

Players pay from a prepaid wallet metered on real token cost, with the platform's margin taken at
top-up (pay $6, receive $5 of credit), or bring their own OpenAI key.

## Dictionaries

Open data: Wiktionary via [kaikki.org](https://kaikki.org) (CC BY-SA 4.0 / GFDL),
[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) (CC BY-SA 4.0),
[CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) (CC BY-SA 4.0), and word
frequencies from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0).
The app credits them at `/about/dictionaries`.
