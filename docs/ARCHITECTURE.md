# Wordbound — Architecture

*A storybook you walk around inside, that teaches you its language.*

A player creates a book. An AI storyteller forges a world for it; the player explores that world
in 3D, befriends its characters, fights its creatures with words, and reads the story as it writes
itself — with more and more of it in the language they are learning.

This document is the source of truth for how the system is put together and why. Read it before
changing anything structural.

---

## 1. Principles

1. **The database is the world.** Every noun — character, memory, place, goal, word, wallet — is a
   table. The AI reads small *queried* slices and returns *structured changes*; it never owns state.
2. **The server is the game master's desk.** The browser sends intents (talk, fight, answer,
   travel). The server checks ownership and plausibility, applies the rules, saves, and replies.
   The browser never authors world state, and never sees an answer key.
3. **AI where it delights, code where it must be right.** Prose, dialogue, characters' judgement:
   AI. Challenges, grading, scheduling, dictionary lookups, money: deterministic code. A wrong
   "correct answer" in a learning game is poison, so answers are computed, never generated.
4. **Spend tokens like money, because they are.** Every model call is metered and billed. Anything
   that can be written once and reread (landmark lore, barks, speech audio) is. Anything a cheap
   model can do (summaries, bookkeeping) goes to the cheap model. Prompts are laid out so the
   provider's cache can reuse their first thousand tokens.
5. **No assets to download.** The world is sculpted in code from primitives and a seed. A region is
   a few hundred kilobytes of JavaScript, not megabytes of models and textures.

---

## 2. Map of the code

```
app/                     routes only
  api/test-login/        dev-only sign-in for the seeded test accounts (section 10)
engine/                  the 3D world — three.js, no React, no server imports
game/                    pure logic shared by server and browser (no I/O)
  languages.ts           the eight languages and what is particular to each
  looks.ts               the visual vocabulary the AI picks from (hair, outfits, creatures, biomes…)
  segments.ts            rich story text: Segment[]
  dictionary.ts          word-card shapes, frequency → level, gloss keys
  payloads.ts            everything the browser is allowed to see
  srs.ts                 spaced repetition (pure functions)
  challenges/            challenge generators and graders (pure functions)
  worldgen/              seeded region layout + terrain height
server/
  auth.ts                requireUser / requireBook — every action starts here
  ai/                    the one door to the model, prompts, output contracts
  services/              game rules
  actions/               "use server" wrappers: parse input → auth → service
components/              React: screens, the HUD over the 3D canvas
db/schema.ts             the data model
scripts/                 dictionary pipeline, test accounts, test browser
tests/                   unit tests for the pure logic (npm test)
```

Rules of thumb:

- `game/` imports nothing from `server/`, `engine/`, `components/` or `db/` (types from `db/` are
  the one exception the schema itself needs, and they flow the other way).
- `engine/` imports from `game/` only.
- Services are plain TypeScript. They begin with `import "server-only"`, which means scripts and
  tests that import them must run with `--conditions=react-server` (the npm scripts do).
- Server actions are the API. Route handlers exist only for binary data (speech) and webhooks.

---

## 3. Data model

See `db/schema.ts`; every table and unusual column is commented there. The shape in brief:

| Group | Tables |
|---|---|
| Accounts | `users` (+ NextAuth's `account`, `session`, `verificationToken`, `authenticator`) |
| Dictionary | `dict_entries` (813k headwords), `dict_forms` (5.8M written forms → headword) |
| Learner | `learner_profiles`, `word_progress`, `challenge_attempts`, `saved_phrases` |
| Money | `credit_ledger` (append-only), `ai_usage` (one row per model call), `topups`, `tts_cache` |
| Book | `books`, `chapters` (the outline), `goals` (each chapter's checklist), `passages`, `events` (the chronicle) |
| World | `regions`, `buildings`, `landmarks`, `gates` |
| People | `characters`, `memories`, `relationships`, `conversations`, `messages` |
| Conflict | `enemies`, `encounters` |

Coordinates are metres on the ground plane: `x` east, `z` south. A facing angle `rot` looks along
`(sin rot, cos rot)`. Height is never stored — it comes from the terrain.

### Rich text

All story text is `Segment[]` (`game/segments.ts`):

```ts
type Segment =
  | { t: "text"; v: string }                          // the reader's own language
  | { t: "word"; id: number; s: string }              // one planned dictionary word, in the target language
  | { t: "tl"; v: string; tr: string; tk: Token[] }   // a target-language phrase or sentence + translation
type Token = { s: string; id?: number }               // a word of it, linked to the dictionary if found
```

The AI never sees database ids. It is offered words under short keys (`w1`, `w2`…) and writes
`{t:"vocab", key:"w1", surface:"comió"}`; the server swaps keys for ids and drops any key it did not
offer. For `tl` spans the AI writes only the text and translation; the **server** tokenises the
text and links each token to the dictionary. Every target-language word on screen is therefore
tappable, at no token cost.

---

## 4. The dictionary

Open data, imported by `scripts/dict/` (download → parse → rank → load):

| Language | Source |
|---|---|
| Spanish, French, German, Italian, Portuguese, Korean | kaikki.org machine-readable Wiktionary |
| Japanese | JMdict (via jmdict-simplified), with generated verb and adjective inflections |
| Mandarin | CC-CEDICT |
| Teaching order, all languages | subtitle word frequencies (hermitdave/FrequencyWords) |

- Wiktionary lists every inflected form as its own entry. Those are folded into `dict_forms`, so
  tapping *comió* lands on *comer*.
- `freqRank` orders headwords by how common they are; `level` (1–6, A1–C2-like) is derived from it.
  Ambiguous written forms share their corpus count between candidate headwords by
  expectation–maximisation (`scripts/dict/frequency.ts` explains why).
- `teachable = false` keeps a word look-up-able but out of lessons (vulgar, archaic, letter names…).
- `glossKeys` are normalised one- or two-word English meanings under a GIN index: "which Spanish
  words mean *well*?" is one indexed query. That is how scenery gets labelled in the target
  language and how a scene about a tavern can be offered tavern vocabulary.
- A re-import matches on (language, headword, part of speech) and updates in place, so learners'
  progress stays attached.
- **Curation** (`scripts/dict/curate.ts`): the top few thousand words per language are reviewed once
  by a model — is this really a common word, what is its best short meaning, give one simple
  example sentence. Results are saved under `data/dict-curation/` and applied by the importer, so
  the review is paid for once and survives re-imports. Example sentences from curation are what
  cloze and sentence-ordering challenges use, which removes a model call from every battle.

At run time (`server/services/dictionary.ts`), unknown forms fall back to: strip punctuation → try
lower-case → (spaced languages) strip common clitics. A form the storyteller itself used and the
dictionary cannot place may be resolved once by the cheap model and remembered in `dict_forms`
with `source = 'ai'`.

---

## 5. The learning engine

- **Spaced repetition** (`game/srs.ts`): SM-2-lite over `word_progress`. Correct answers stretch
  the interval (1 → 3 → ×ease days); a miss brings the word back within the session.
- **Three strengths of evidence.** *Seen* (the word appeared in text the player read),
  *recognised* (a challenge answered), *produced* (the player wrote or spoke it themselves in
  dialogue). Only recognition and production move the schedule.
- **The vocab planner** (`planWords` in `server/services/learning.ts`) is the single gateway for
  "which words should appear now": due reviews first, then words that fit the scene (looked up by
  meaning), then the next most common words the player has not met. One entry per headword; content
  words only at low immersion, because a lone preposition embedded in an English sentence teaches
  nothing.
- **The immersion ladder** decides how much of the book is written in the target language:

  | Level | Name | The book… |
  |---|---|---|
  | 0 | Newcomer | drops single words into sentences where context makes them guessable |
  | 1 | Wanderer | adds greetings and short phrases |
  | 2 | Speaker | lets characters say one short full sentence per scene |
  | 3 | Storyteller | has characters speak half their lines in the target language |
  | 4 | Voyager | writes dialogue mostly in the target language; narration mixes |
  | 5 | Immersed | is written in the target language; the reader's own is only ever a tap away |

  The level comes from how many words the player demonstrably knows, plus the level they said
  they started at, shifted by their preference (cozy / balanced / bold).
- **Production is judged.** When the player types in the target language, the character's reply
  carries a `LanguageNote`: a verdict, a more natural phrasing, one short tip. Words they used
  correctly count as produced.
- **World words.** Landmarks carry a floating label in the target language (*el pozo* over the
  well), chosen from the dictionary by meaning — no model call.
- **Pronunciation.** Word cards show IPA, reading or romanisation from the dictionary. Audio is
  generated once per (voice, text) and cached for everyone in `tts_cache`; a human recording from
  Wikimedia Commons is used when the dictionary has one.
- **The study hall** (`/study`) runs review sessions from the same challenge registry with no model
  calls at all.

---

## 6. The storyteller (AI layer)

### One door

`server/ai/client.ts` exports `generate({ task, tier, instructions, input, schema, cacheKey })`.
It picks the model for the tier, requests structured output against a zod schema, re-validates,
retries once, records an `ai_usage` row with token counts and cost, and charges the wallet.

| Tier | Default model | Used for |
|---|---|---|
| `story` | `gpt-6-sol` | dialogue, the storyteller's pages, the forge, the outline and the goals |
| `scribe` | `gpt-6-luna` | summaries, memory consolidation, word resolution |

Override with `OPENAI_MODEL_STORY` / `OPENAI_MODEL_SCRIBE`. Prices live in `server/ai/pricing.ts`.

Both models are asked for **no reasoning effort** on everything a player waits for (dialogue,
pages, the forge) and a little on the outline and the goals, which are plans. Measured: leaving the
setting out runs at "medium" and triples the wait; these models reject "minimal".

A book begins from **sparks** drawn by lot from its seed (`game/sparks.ts`): a kind of country, what
its people are known for, a thing that matters, something strange, and the shape of the title.
Asked to invent a story from nothing, the model wrote the same one every time (seven books in a
row about a bell and a loaf); asked to build one around a kite, a salt marsh and a road that is
longer going home, it cannot. What the reader asks for in their own words outranks the sparks.

Making a book is five calls: the idea; then the people and everything else side by side; then
the outline of the whole story with the goals of its first chapter; then the first page.
Written as one request, the world alone took a minute and a half. Measured now: about 85
seconds of writing (13 + 41 + 24 + 5) and 90 from the button to the first page. The model's writing
speed, some 58 tokens a second, is what is left. The forge runs as one long server action; the
screen that waits on it asks `GET /api/books/[bookId]/forge` how far along it is, because a
second server action would queue behind the first.

### Prompt layout and caching

OpenAI caches prompt prefixes of 1,024 tokens or more and bills cached input at a tenth of the
price. Every prompt is therefore laid out stable-first:

1. the rulebook — how to write segments, the immersion ladder (identical for every call)
2. the book's **bible** — title, premise, tone, the world's fixed facts, its places and people
   (changes when a chapter begins, or someone new enters the story)
3. the **outline**, for the storyteller and the planner, or the **character sheet**, for a person
   (neither ever changes; no character is ever shown the outline)
4. *then* everything that moves: memories, recent lines, the scene, offered words, the player's message

Parts 1–3 go in `instructions`, part 4 in `input`, and `prompt_cache_key` is set to the book (and
character), so consecutive turns of a conversation reuse the same cached prefix.

The provider places the output schema, and the name it is sent under, *before* the instructions.
Two tasks therefore share a cache only if they share both: a greeting is asked for in the shape
of any other turn, and so is the answer a person gives when asked for one
(`schemaName: "character-turn"`); every page the storyteller writes is a `"telling"`.

### Memory

A character's prompt never contains "everything". It contains:

- **every line the summary does not cover yet**, verbatim: eight at least, eighteen or so at
  most. (Carrying only the last eight left a gap: the lines waiting to be summarised were in
  neither place, and a character forgot the middle of the conversation they were having.)
- **a rolling summary** of the rest (`conversations.summary`), refreshed by the scribe every ten
  messages
- **up to six memories**, chosen by score: `importance × recency × relevance`, where relevance is
  keyword overlap with what the player just said and where they are. The two newest promises
  are always included (nothing marks a promise as kept, so holding all of them would in time
  leave room for nothing else). Recalled memories are reinforced (`recallCount`), so what
  matters stays sharp.
- **the relationship**: affinity and a two-sentence summary

Memories are written by the same call that produces the reply (no extra request). When a character
holds more than forty, the scribe consolidates the oldest minor ones into a few reflections.

**Gossip.** When something important happens (importance ≥ 7), characters in the same region get a
`rumor` memory of it — by rule, with no model call. Defeat the thing in the woods and the innkeeper
has heard by the time you walk back.

### The story: an outline, and a checklist

The whole loop is this, and is meant to stay this small:

1. **A book is outlined when it is made**: five to seven chapters, each with a title, a stage
   (introduction, rising, climax, falling, resolution) and a description of what it is for and
   where it must end. The outline never changes. *Where a chapter ends is fixed; how the hero gets
   there is not.* The reader never sees a description, or a chapter they have not reached.
2. **Entering a chapter writes all of its goals, at once** (`goals` table): one call, which also
   says what happened in the chapter that has just ended.
3. **Goals are taken one at a time, in order.** There are six kinds:

   | Kind | What it is | How it ends |
   |---|---|---|
   | `tell` | the storyteller tells the reader something: the goal is a *pointer*, the page is written when it comes due | told; never shown in the checklist |
   | `visit` | go to a region, or walk up to a building or landmark | on arriving; a column of light marks the place |
   | `talk` | speak with someone about something | they answer for themselves |
   | `persuade` | win someone over | they answer for themselves, yes or no |
   | `fight` | best a creature | won, or driven back. Backing away settles nothing |
   | `examine` | look closely at a landmark | on looking |

4. **A goal that fails is not a dead end.** It is crossed out, kindly; the goals that were to
   follow are dropped; and the road from there to the chapter's fixed end is written again, in
   one call (`mend`). A failure is mended even on a chapter's last goal.
5. **When every goal is settled the page can be turned**, and step 2 begins again.

`whatIsDue` (`game/goals.ts`, pure, tested) says which of these is next; `advance`
(`server/services/story.ts`) does whatever falls to the book rather than the reader, and stops.
A claim on the book (`writingSince`) keeps two requests from writing the same thing twice.

**People answer for themselves.** When the goal in hand is someone's to settle, walking up to
them opens the conversation with that at stake: the panel says what the hero has come for, shows
what the person warms to and is put off by, and how they are leaning (`lean`, -5 to 5, which
they report themselves with each reply). They may decide of their own accord — agree if truly
won, or end the talk if insulted or pushed — and the hero may **ask for their answer**, which is
one more turn of the same conversation in which they must say yes or no. Nothing judges them
from outside. Nobody is won or lost by the first thing said to them (`decisionStands`).

**Writing to someone from afar.** Anyone the hero has met can be written to from anywhere, at
any time (journal → People). Nothing is ever at stake from afar: a goal is settled face to face.

**The world changes only through a goal's fields.** The storyteller's pages are words and move
nothing. A goal may say what the hero `gains` (kept in `books.belongings`, and told to every
later prompt), whom it `moves` (to another region, or out of the book), and who `enters` at it.
Someone written mid-story is given somewhere to stand at once (`game/worldgen/spots.ts`) but
stays off stage, in nobody's scene, until the goal that brings them in comes due. Someone who
leaves keeps their key, so that nobody else's shifts.

**What the book remembers of itself** (`storySoFar`) is the summary of every chapter behind the
hero and the outcome of every goal of the chapter in hand, one line each: nothing falls out of
it for having happened long ago. It is given to the planner and the storyteller. Characters are
given only what they would know: their own memories, and what has reached them as gossip.

**Model calls, all told**: the outline, once; a chapter's goals, once a chapter; a run of pages,
when tells come due (those that follow one another are written in one request); a road mended,
once a failure; and the conversations themselves. Walking, arriving, fighting and rereading cost
nothing.

`scripts/checkGrowth.ts` plays all of this through with real model calls, failing a goal on
purpose if asked, and lists what broke. `scripts/checkCast.ts` checks people entering, moving
and leaving, with no model call.

### What costs nothing at play time

Written once and reread: landmark lore (first examination writes the passage; later ones reread
it), character barks (written at the forge), speech audio, world labels, challenge content.

---

## 7. The world

A book has a handful of **regions** (a settlement, wilds, depths; more as the story grows), joined
by **gates**. A region is rebuilt from its `seed` on every device:

- `game/worldgen/layout.ts` decides where the plaza, roads, clearings, building plots and slots for
  people and creatures go. The server uses it at the forge to place things (stored as rows); the
  browser uses the identical layout to build the terrain.
- `game/worldgen/terrain.ts` raises the ground: rolling swells, rough detail away from paths, a rim
  of hills (or open sea) closing the region in, passes cut where gates are open.
- A new chapter may add a region, which opens a gate in one that is already peopled. Nothing
  placed there may move, and the new road may run into none of it: so the road to each of the
  four gates is drawn from the start, a closed side shows only its first stretch as a lane, and
  buildings, landmarks and water keep clear of all four.
- The AI **fills** the layout — names, lore, cast, which biome and hour — by choosing from the
  enumerations in `game/looks.ts`. It never invents geometry, so it cannot produce an unplayable
  map.

### The engine (`engine/`)

Plain three.js, driven imperatively; React only draws the HUD on top.

- Everything is sculpted from primitives into merged geometry with per-vertex colour and drawn
  with one shared matte material (`engine/geo.ts`). Vegetation is instanced and sways in the
  vertex shader. A whole region is on the order of fifty draw calls.
- One shadow-casting sun that follows the hero; hemisphere light for the rest. Fog melts the rim
  into the sky.
- The engine watches its own frame time and lowers resolution, then shadows, then foliage density
  before it lets the frame rate drop.
- Names and target-language labels are HTML positioned over the canvas, so CJK text is crisp and
  costs no texture memory.

### Combat

Walking into a creature starts an **encounter**: a staged plan of challenges built deterministically
from the vocab planner (due words first). Each correct answer is a spell cast; each miss costs a
heart. Out of hearts, the hero is driven back — the creature stays. Ordinary creatures return after a
while, so there is always something to practise on. The creature a goal points at is brought
back when the goal comes due and does not wander off again; losing to it fails the goal, and
backing away does not. A creature takes a few seconds to notice anyone, so the hero is not set
upon the instant a place is entered.

---

## 8. Paying for it

Two modes, chosen at onboarding and switchable:

- **Wallet.** Prepaid credit in micro-dollars. Each model call is metered from the provider's own
  token counts and charged at cost × `USAGE_MARKUP` (default 1). The platform's margin is taken at
  **top-up**: packages in `server/services/wallet.ts` say what is paid and what is credited
  (pay $6, receive $5). `users.creditMicros` is a cache of the ledger and only ever changes in the
  same transaction as a `credit_ledger` row. A call is refused when the balance is at or below
  zero; it may dip slightly negative on the last call, never further.
- **Bring your own key.** The player's OpenAI key lives only on their device (cookie + local
  storage), rides each request, and is never stored or logged. Usage is still recorded, uncharged.

Top-ups go through a `PaymentProvider` interface. A payment is credited exactly once: the ledger
has a unique index on (reason, ref) and `topups` on (provider, providerRef), so being told twice
is a no-op.

### Card payments: PowerTranz

The merchant is in Jamaica, where Stripe does not operate; PowerTranz (First Atlantic Commerce)
is the gateway. `server/payments/powertranz.ts` talks to it, `server/payments/rules.ts` holds what
can be tested without it.

1. **Set out.** `startTopupAction` writes a `topups` row (what will be charged, in which currency,
   under which transaction id) and asks the gateway for a sale with 3-D Secure. The gateway
   answers with a page.
2. **Handoff.** The page is kept on the row and the browser is sent to
   `/api/payments/powertranz/handoff`, which serves it once. It is kept in the database, not in
   memory, because on a serverless host the next request may reach another machine. The player
   leaves for the card form and their bank **as a page of its own, not in a frame**: framed, the
   bank is a third party and Safari and phone web views keep its cookies from it.
3. **Return.** The bank sends the browser to `/api/payments/powertranz/callback` with an SpiToken.
4. **Settle.** The token is given to the gateway (`/spi/payment`), and **only the gateway's answer
   is believed** — including which top-up the payment is for. What the browser posted can be
   written by anyone. The answer must be approved, must name this top-up, its transaction id, its
   amount and its currency, and the bank must have verified the cardholder. An approval that
   fails any of these is voided on the spot.

Prices are in US dollars because what they buy is. A merchant account that takes only Jamaican
dollars charges the same value at the owner's rate (`POWERTRANZ_JMD_PER_USD`), rounded up.

**Who takes the card.** With a hosted payment page, PowerTranz does, and this app never sees a
card number (PCI SAQ A). With `POWERTRANZ_CARD_FORM=own` the player types it into
`components/account/CardForm.tsx`; it passes through the server once, to the gateway, and is
neither stored nor logged — but the server is then in scope for PCI DSS (SAQ A-EP at the least).
Prefer the hosted page.

**Abuse.** Six unpaid attempts in an hour and the player is asked to wait: someone testing stolen
card numbers fails over and over. 3-D Secure is always asked for.

**The test gateway** (`app/api/dev/powertranz`) is a pretend PowerTranz that exists only in
development and serves only the seeded test accounts, who in turn are never sent to the real one.
Where the bank would be it shows buttons: approve, decline, fail the verification, and answers no
gateway should give (approved but unverified, the wrong amount, the wrong order).
`scripts/checkPayments.ts` presses them all.

### Selling through the app stores

A web view of this site in an App Store or Play Store app may not sell credit by card. Both
stores require their own in-app purchase for digital goods used inside the app, and take 15–30%
of it — more than the margin on a package. The roadmap sets out the ways round this.

---

## 9. Security

- Identity always comes from the session (`requireUser`). Book access always goes through
  `requireBook`, which checks ownership.
- Every server action parses its input with zod before anything else.
- Answers to challenges are stored server-side in `encounters.stages` and never serialised out.
- The player's typed messages are data in a prompt, never instructions: they are quoted into the
  `input`, after the rules.

---

## 10. Test mode — Claude can play

So that changes are checked in the real app rather than assumed from reading code:

- `npm run test:seed` creates two accounts, flagged `isTest`: **player** (onboarded, wallet credit)
  and **newcomer** (never onboarded).
- `/api/test-login?as=player&secret=…&to=/path` signs one in. It exists only outside production
  builds, only when `TEST_MODE_SECRET` is set (in `.env.development.local`), and only ever for a
  flagged test account.
- `scripts/testBrowser.mjs` drives headless Chrome with WebGL: navigate, click by label, type, hold
  keys to walk, screenshot, and call the game's dev hook (`window.__wordbound`) to ask the engine
  what it sees or to walk the hero to the nearest character.

See `AGENTS.md` for how to use it.
