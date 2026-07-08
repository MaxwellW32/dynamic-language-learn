# Wordbound — Architecture & Modernization Plan

*An AI-powered interactive storybook language-learning RPG.*

This document records the analysis of the two prototypes (`dynamic-story`, `dynamic-language-learn`),
the weaknesses found, the redesigned architecture, and the reasoning behind every major decision.

---

## 1. What the prototypes were building

Both projects share one vision, iterated twice:

> The player opens a storybook and becomes its main character. An AI game master narrates a
> persistent world — locations, characters, goals — stored in a database. Vocabulary from the
> language the player is learning is woven naturally into narration and dialogue. "Combat" is a
> language challenge. Conversations with NPCs feel alive, and the world remembers.

**`dynamic-story` (Feb–Mar)** — first prototype. Books → chapters → sections; AI-generated
locations (3-level hierarchy: location → place → area, with meter coordinates), an
**`areaConnections` graph** (edges with travel descriptions) making areas navigable, characters
with memories as string arrays, goals/sub-goals as the story spine, a Character.AI-style chat
section, a pannable/zoomable map, and **AI-adjudicated travel** — the narrator model granted or
denied the player's move requests in-fiction ("still fighting dragon boss"). Its narrator also
emitted a typed `changes[]` mutation array (character/player/subGoal/chapter changes), an early
multi-agent pipeline: quest-designer AI → narrator AI → chat AI. It had **no language-learning
layer at all** and **no voice code** (the author's notes list "chat with characters (text/audio)"
as a future plan).

**`dynamic-language-learn` (Mar–Apr, current repo)** — second iteration. Same skeleton, plus the
language layer: per-language-pair dictionary/grammar JSON files served from `public/`, a
`translatableText` format so AI output can embed vocabulary tokens (`fw` = word from the user's
pack, `gptWord` = ad-hoc word the AI introduces), click-to-reveal word popovers, a mastery map
(1–10 per word) stored on the user row, and `gameMode` sections meant to spawn language challenges
when a `defeat-character` sub-goal triggers (UI never implemented — renders `<p>gameMode</p>`).

### What was genuinely good (and is kept)

- **Structured AI output everywhere.** Every OpenAI call uses `responses.parse` with a zod schema
  (`zodTextFormat`) and re-validates the result. This is the right foundation and is retained.
- **The anti-hallucination instinct.** Prompts already say *"Do NOT invent ids. Only use provided
  characterIds. Only use provided word ids."* The redesign makes this structural instead of
  prompt-hoped.
- **The `translatableText` idea** — story text as a sequence of segments where some segments are
  vocabulary tokens — is excellent and becomes the `Segment[]` rich-text format.
- **Goal pacing vocabulary** (introduction → rising-action → climax → falling-action → resolution)
  survives as quest arc stages.
- **Auth stack** (NextAuth v5 + Drizzle adapter, Google + email) is sound and kept as-is.

---

## 2. Weaknesses and technical debt

### 2.1 The database contradicts the vision (critical)

The vision says *"everything important exists in the database instead of relying on AI memory."*
The implementation has **three domain tables** (`users`, `books`, `chapters`) and stores the entire
world — characters, memories, locations, goals, chat messages — as **JSON blobs in columns**.

Consequences:

- NPC "memory" is a string array inside a JSON column inside `books.characters`. It cannot be
  queried, ranked, capped, or selectively retrieved — so the *whole world* is `JSON.stringify`-ed
  into every prompt (token waste, and the model drowns in irrelevant context).
- Every save rewrites a whole blob. Two racing writes (the app fires several debounced 5-second
  syncs from different components) silently lose data.
- No conversation history table, no event log, no relationship state → conversations restart from
  whatever fits in the blob; "events have consequences" has nowhere to live.

### 2.2 The client owns the game state (critical)

The gameplay loop runs **in the browser**: `ReadBook.tsx`/`ViewChapters.tsx` assemble AI context,
call the server, apply world mutations to local React state, then debounce-push whole objects back
with `updateBook`/`updateChapter`/`updateUser`. This means:

- Closing the tab within the 5s debounce window loses progress.
- The server blindly trusts any world state the client sends (a cheater can set every word to
  mastery 10, or rewrite the story).
- The same context-assembly logic is duplicated three times (`addSectionFunc`, `handleSend`,
  `handleGrade`).

### 2.3 No authorization (critical security hole)

Every server function has an empty `//auth check` comment. `updateUser(anyUserId, …)`,
`updateBook(anyBookId, …)`, `deleteBook(anyBookId)`, `getSpecificBook(anyBookId)` are callable by
anyone with the endpoint. Any user can read, rewrite, or delete any other user's data.

### 2.4 God components and prop drilling

`ReadBook.tsx` is ~1,480 lines mixing setup wizard, validation, AI orchestration, a hand-rolled
debounced sync engine, and layout. `ViewChapter` threads **13 props** down the tree, including
three different `set…` dispatchers. Inline styles everywhere; three different state-sync patterns.

### 2.5 The player is exposed to the machinery

To start a story the user must manually click *Add locations → Add places → Add areas → Add
characters → Add goals → validate* and review raw JSON-shaped cards. That's a developer console,
not "opening an illustrated storybook." World-building must be one delightful action.

### 2.6 A pre-scripted story pretending to be dynamic

The AI pre-generates up to **20 goals × ~15 sub-goals** (a ~300-item checklist) up front, then the
story engine linearly walks it. This is brittle (one bad id breaks validation), expensive, and
contradicts the "living world" goal — the story can't react to what the player actually does.

### 2.7 The learning engine barely exists

- Mastery only ever changes when a player *clicks* a word (`+1, onlyIfAbsent`) — reading well is
  indistinguishable from ignoring the word.
- No spaced repetition, no due dates, no review scheduling.
- Combat (`gameMode`) — the core educational mechanic — is unimplemented.
- Vocabulary lives in static `public/*.json` files fetched by the client; users can't have packs,
  progress can't join against words.

### 2.8 Assorted

- `next dev` without Turbopack config, no tests, two pre-existing type errors, `console.log` of
  entire prompts in production paths, rate limiting is a client-side toy, secrets loaded via
  `dotenv` in every file instead of Next's built-in env handling.

---

## 3. The redesign

### 3.1 Principles

1. **The database is the world.** Every noun in the vision (character, memory, relationship,
   location, event, quest, conversation, word, progress) is a table. The AI reads compact,
   *queried* slices and returns *structured deltas*; it never owns state.
2. **The server is the game master's desk.** Clients send *intents* (move, talk, fight, answer);
   the server validates ownership + proximity, runs the rules, persists, and returns the new scene.
   No client-authored world state, ever.
3. **AI where it delights, code where it must be reliable.** Narration, dialogue, world-forging,
   judging persuasion: AI. Challenge generation, grading, scheduling, progression math:
   deterministic TypeScript. (A wrong "correct answer" in a learning game is poison — so answers
   are computed, not generated.)
4. **The whole app is a book.** One UI metaphor: a two-page spread. Left page = the illustrated
   map. Right page = the living story (narration, dialogue, encounters). Everything is parchment,
   ink, and wood.

### 3.2 Domain model (Postgres via Drizzle)

```
users                     auth + language settings (kept, minus lessonProgress blob)

vocab_packs               a dictionary/vocab pack for a language pair
vocab_words               words in a pack (term, meaning, pronunciation, examples)
word_progress             per-user SRS state per word (due date, interval, ease, streaks)
challenge_attempts        every answer ever given (feeds SRS + analytics)

stories                   one playthrough: owner, title, premise, target language, status,
                          player position (current map + x/y), arc stage
story_packs               which vocab packs feed this story

maps                      handcrafted scenes: name, kind (overworld/settlement/interior/dungeon),
                          biome, logical width/height, ambience notes
map_features              scenery + interactables: trees, signs, campfires, buildings… (x, y, kind,
                          sprite key, lore)
portals                   doors/exits: mapId + position → targetMapId + position

characters                NPCs & companions: personality, appearance, backstory, mood, position
character_memories        queryable memory rows (content, importance, kind, timestamp)
relationships             per-character affinity (-100..100) + rolling relationship summary

enemies                   learning encounters: tier (minion/elite/boss), biome flavor,
                          challenge types, position, status
encounters                an active/finished battle: staged challenge plan (answers server-side),
                          hearts, outcome

quests                    title, description, giver, arc stage, status
quest_objectives          typed steps: talkTo / defeat / visit / collect / learnWords / custom

conversations             one thread per NPC per story (rolling summary + last-message time)
messages                  speaker + rich Segment[] content

chapters                  the story log's structure (index, title, summary)
passages                  narration/dialogue/event entries as Segment[] (the "book text")

events                    the world chronicle: everything that happened, queryable, feeds AI
                          grounding and the journal UI
```

**Why:** every "the AI should remember / the world should persist" requirement becomes a `SELECT`.
"Top 8 memories this NPC has about the player" is a query, not a prayer. Writes are row-sized, not
book-sized; races disappear; and prompts shrink from "the whole world" to "the relevant slice."

**Rich text.** All story text (passages, messages) is stored as `Segment[]`:

```ts
type Segment =
  | { t: "text";  v: string }                                    // native-language prose
  | { t: "vocab"; wordId: string; surface: string }              // a pack word, in target language
  | { t: "phrase"; target: string; translation: string;         // ad-hoc target-language phrase
      pronunciation?: string }
```

The AI selects `vocab` words **only from the word list the vocab planner hands it** (ids are
re-validated server-side; unknown ids are demoted to plain `phrase` segments — structural
anti-hallucination, not prompt-hoped).

### 3.3 Server architecture

```
server/
  auth.ts                 requireUser(), requireStory(storyId) — every action starts here
  services/
    worldForge.ts         one-click story creation: premise → maps → cast → quests → opening
    scene.ts              scene snapshots: map + features + characters + enemies near player
    movement.ts           position updates, portal transitions (validated)
    dialogue.ts           conversation turns: context → AI → persist → memory/relationship deltas
    narration.ts          passages: arrivals, inspections, quest beats
    encounters.ts         start/answer/resolve battles; stage generation; hearts
    learning.ts           the vocab planner + SRS scheduler (SM-2-lite) + mastery stats
    quests.ts             objective progress, arc advancement
  ai/
    client.ts             one generate<T>() helper: model, zod schema, usage logging, retries
    context.ts            compact context builders (character card, memory slice, scene brief)
    prompts/              worldForge, narrator, character, judge, encounterFlavor
  actions/                "use server" — thin: zod-parse input → auth → service → return
```

- **Server actions are the only API surface** (the `gptConcurrent` route-vs-server-functions split
  is gone). Voice endpoints (audio streaming) are the one place API routes remain.
- Services are plain TypeScript — no React, no Next imports — so game rules are unit-testable.

### 3.4 The AI game-master layer

Every generation task gets: a **fixed system prompt** (who the AI is), a **compact context brief**
(built from queries, with hard caps: ≤8 memories, ≤12 messages, ≤6 events, summaries beyond that),
and a **zod output schema**. All IDs the AI may reference are provided as short stable keys in the
brief; everything it returns is re-validated against the DB before persisting.

| Task | Trigger | Output (structured) |
|---|---|---|
| World forge | story creation | premise, cast, map contents, opening quests + passage |
| Narrator | arrivals, inspections, beats | `Segment[]` passage + optional event + objective hints |
| Character | each dialogue turn | in-character `Segment[]` reply + mood + memory candidates |
| Judge | conversation ends / objective check | objective verdicts, affinity delta, memory extraction |
| Encounter flavor | battle start/end, fill-blank needs | intro/defeat lines, cloze sentences |

**Conversation memory pipeline** (the "NPCs remember" requirement): after a conversation goes
idle, the judge pass extracts durable memories → `character_memories`, updates
`relationships.affinity` + summary, and appends to `events`. The next conversation's brief includes
exactly that — so an NPC greets you differently because a *row* says you saved their dog.

### 3.5 The learning engine

- **`word_progress` + SM-2-lite.** Correct answers grow the review interval (1 → 3 → 7 → 16 →
  35 days… scaled by ease); misses reset it and mark a lapse. Every challenge answer is recorded.
- **The vocab planner** is the single gateway the AI and encounters use to get words:
  `plan = { introduce: Word[], review: Word[] }` — new words come from the packs in pack order;
  reviews are whatever is due. Narration and dialogue naturally re-expose due words; encounters
  test them. Passive exposure (a `vocab` segment rendered) counts as a light touch; active recall
  (challenges) drives the schedule.
- **Reading interactions**: tapping a word flips a small parchment card (meaning + pronunciation +
  "add to satchel"), and marks first exposure.

### 3.6 Encounters ("combat")

- An enemy is a **staged challenge plan** generated *deterministically* from the vocab plan:
  minion = 2–3 stages, elite = 4, boss = 3 acts × 2 stages with a finisher. The AI contributes
  only flavor (intro taunt, defeat line, cloze sentences) — never answers.
- Challenge types are a **registry** (`game/challenges/`), each type = one generator + one grader +
  one renderer. V1 ships: word→meaning choice, meaning→word choice, pair matching, spelling,
  fill-in-the-blank, sentence arranging. The registry makes the other listed types (listening,
  synonyms, antonyms, translation, crosswords…) drop-in additions.
- Wrong answers cost a heart (3 hearts); at 0 the player *retreats* (cozy, not punitive — the enemy
  stays on the map). Victory records an event, advances `defeat` objectives, and updates SRS.
- Client never receives answers: grading happens server-side against the stored plan.

### 3.7 The world & map system

Maps are **handcrafted scenes, not tile engines** — a logical unit grid (e.g. 32×18) rendered as a
painterly CSS/SVG page. A few landmarks, 2–5 NPCs, 2–6 enemies, a couple of portals. Entities are
DOM nodes positioned in percentages; the player token moves with click-to-move + WASD via a
`requestAnimationFrame` hook that writes `transform` directly (no re-render per frame). Proximity
(distance check) surfaces a quill-bubble: *Talk / Fight / Inspect / Enter*. Buildings are portals
to small interior maps. Biome templates (village, forest, cave, interior…) give the world-forge AI
a fixed visual vocabulary: it picks layouts and names things; it does not invent geometry.

### 3.8 UI: the book

- **Design system**: Tailwind 4 `@theme` tokens — parchment, ink, wood, moss, ember, gold; grain
  and vignette textures in CSS; storybook serif for display, readable serif for prose
  (`next/font`). Primitives: `Parchment`, `WoodFrame`, `StorybookButton`, `Ribbon`, `Hearts`,
  `WordCard`, `PageTurn`.
- **Screens**: a warm cover page → **the bookshelf** (your stories as book spines) → *opening* a
  book plays a page-turn into the **two-page spread**: left page is the map illustration, right
  page is the living text (story log, dialogue, encounters as an overlaid "battle card"). The
  journal (quests, vocab satchel, chronicle) is a ribbon-tabbed flip. Mobile: the two pages become
  two tabs.
- Animations are small and purposeful: page turns, a bobbing player token, candle-flicker on
  interactables, cards flipping.

### 3.9 Voice

Neither prototype ever implemented audio — it was a stated goal in the author's notes. Here it
becomes real plumbing: dialogue gets a mic button (hold-to-speak → `/api/voice/transcribe`, OpenAI transcription) and a
speaker button per NPC line (`/api/voice/speak`, OpenAI TTS with a per-character voice). The same
plumbing later powers listening/pronunciation challenge types.

### 3.10 Paying the storyteller (billing)

Every AI moment costs real money, so onboarding (`/welcome`) makes new users choose a mode
(stored as `users.billingMode`; switchable any time):

- **✨ Sparks (credits)** — the app's OpenAI key, metered in sparks. Balances live in an
  **append-only `credit_ledger`** plus a cached `users.sparks` column that is only ever changed in
  the same transaction as a ledger row; spending is atomic
  (`UPDATE … WHERE sparks >= cost RETURNING`), so concurrent actions can never overdraw. Prices
  per task live in one place (`SPARK_COSTS` in `server/services/billing.ts`: page of story 1,
  dialogue turn 1, chapter turn 3, world forge 25 — charged at story creation so forge *retries*
  are free; victory prose and mic input are free). New credits users get a one-time 50-spark
  starter gift (guarded by ledger reason). The UI shows the balance everywhere
  (`BillingBadge`), nudges below 10 sparks, and `/sparks` lists top-up bundles (Stripe-ready
  scaffold) and the ledger.
- **🔑 BYOK** — the player's own OpenAI key. It is validated once with a free `models.list`
  probe, then stored **only on the device** (cookie + localStorage mirror) — never in the
  database, never logged. It rides each request over TLS and `openaiForRequest()` uses it in
  memory. If the device loses it (new browser, cleared storage), the badge detects the absence
  and prompts re-entry; the server refuses to fall back to the app's key for BYOK users.

Store note: consumable credits sold *inside* a Play-distributed app must use Google Play Billing;
the intended v1 is web top-ups (Stripe) with the app consuming the balance, and BYOK sidesteps
billing entirely.

### 3.11 Scale posture

Stateless server actions + row-sized writes + capped AI context = horizontally scalable and
bounded cost per interaction. Indexes on every FK and on `word_progress.dueAt`. The expensive
operation (world forge) happens once per story and shows a progress page.

---

## 4. Migration

- New tables coexist by name (`stories`, not `books`). `npm run db:push` applies the new schema —
  drizzle will *prompt* before dropping the legacy `books`/`chapters` tables and the two old
  `users` JSON columns; confirm knowingly (it's prototype data). `npm run db:seed` imports the
  existing `public/languageLessons/*.json` dictionaries as built-in vocab packs.
- Old gameplay code (`components/books|chapters`, `serverFunctions`, `gptConcurrent` route,
  root `types.ts`) is removed once the new game screen replaces it.

## 5. Incremental build order

1. Schema + seed (vocab packs from existing JSON)
2. Learning engine (SRS + planner) and challenge registry — pure, testable
3. AI layer (client, context builders, prompts)
4. World forge + story creation flow
5. Scene/movement/dialogue/encounter services + server actions
6. Design system + bookshelf + two-page game screen
7. Map engine hook + encounter UI + dialogue UI
8. Voice endpoints
9. Delete legacy, verify (typecheck/lint/build)
