# Wordbound

*An AI-powered interactive storybook language-learning RPG.*

You open a book and become its hero. The world is persistent — characters remember your
conversations, relationships grow, events have consequences — and everything important lives in
the database, not in the AI's short-term memory. Vocabulary from the packs you choose is woven
naturally into narration, dialogue, and quests; "combat" means defeating enemies with language
challenges scheduled by spaced repetition.

**Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first** — it documents the analysis of the two
prototypes this grew from, every architectural decision, and the reasoning behind them.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Drizzle ORM + Postgres · NextAuth v5 ·
OpenAI (structured outputs, TTS, transcription) · Tailwind 4 · Jotai

## Setup

1. `.env.local` needs: `DATABASE_URL`, `OPENAI_API_KEY`, `AUTH_SECRET`,
   `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` and/or `EMAIL`/`EMAIL_PASS` (Gmail for magic links).
   Optional: `OPENAI_MODEL` (narrative tier, defaults to `gpt-5.5`) and
   `OPENAI_MODEL_FAST` (mechanical tier, defaults to `gpt-5.4-mini`).
2. Apply the schema — **note:** this will also offer to drop the legacy prototype tables
   (`books`, `chapters`) and two old `users` columns; confirm knowingly:
   ```bash
   npm run db:push
   ```
3. Seed the built-in vocab packs (syncs the dictionaries under `data/vocab/` — re-run any time;
   it appends newly added words to existing packs without touching learner progress):
   ```bash
   npm run db:seed
   ```
4. Run it:
   ```bash
   npm run dev
   ```

## Where things live

```
app/                routes only (bookshelf, story creation, the game, voice API)
components/
  ui/               storybook design system (parchment, wood, quill…)
  game/             the open book: map engine, dialogue, encounters, journal
  story/            creation + forging screens
game/               pure shared logic: segments, SRS, challenge registry,
                    handcrafted map templates, sprite/voice vocabularies
server/
  auth.ts           requireUser / requireStory — every action starts here
  ai/               the game master: one model client, compact context briefs,
                    zod-validated outputs, id-key mapping (anti-hallucination)
  services/         game rules: world forge, scenes, dialogue, encounters,
                    learning (SRS + vocab planner), quests, chapters
  actions/          thin "use server" wrappers: zod-parse → auth → service
db/                 Drizzle schema — the world model (20 tables)
scripts/seed.ts     vocab pack importer
```

## Useful scripts

| command | what it does |
|---|---|
| `npm run typecheck` | strict TypeScript check |
| `npm run lint` | ESLint |
| `npm run db:generate` | write SQL migration files from the schema |
| `npm run db:push` | apply the schema to the database |
| `npm run db:seed` | import built-in vocab packs |
| `npm run db:wipe` | ⚠️ drop everything in the database (dev reset: wipe → push → seed) |
