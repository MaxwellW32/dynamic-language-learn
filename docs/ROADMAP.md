# Roadmap — deferred work, ready for pickup

Plans agreed with the owner but intentionally not yet built. Read
[ARCHITECTURE.md](ARCHITECTURE.md) first — it explains the system these plug into.
Everything below already has its foundations in place; each item names them.

## 1. Payments (highest priority before store launch)

- **Stripe Checkout for spark bundles.** `/sparks` (app/sparks/page.tsx) already renders the
  bundles (500/$4.99, 1200/$9.99, 3000/$19.99) with disabled buttons. Build: a checkout-session
  server action per bundle + a `/api/stripe/webhook` route handler that, on
  `checkout.session.completed`, calls the existing `grantSparks(userId, amount, "topup-<bundle>")`
  in `server/services/billing.ts` (append-only ledger + atomic cached balance — do NOT write
  `users.sparks` directly). Needs `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` env vars.
  Idempotency: key grants on the Stripe event id (store it in the ledger `reason` or a new column).
- **Google Play**: the app will ship as a TWA. Digital goods sold *inside* a Play app must use
  Play Billing — v1 plan is web-only top-ups (Stripe) with the app consuming balance; Play Billing
  products for bundles can come later. BYOK mode sidesteps store billing entirely.
- **Low-balance email** at ~20% of last top-up (Resend or nodemailer — nodemailer already
  configured for auth emails). In-app badge nudge already exists (`BillingBadge`).
- **Auto top-up** (explicit opt-in only).
- **Refund-on-failure**: 1-spark tasks currently charge before generation
  (`chargeForAi` call sites in services); a failed AI call eats the spark. Add a refund via
  `grantSparks(userId, cost, "refund-<reason>")` in the catch paths. Forge is already safe
  (charged at story creation; retries free).

## 2. Vocabulary content pipeline

- **AI pack forge**: user types any language (or theme, e.g. "Italian for cooking") → ONE AI call
  generates a 100–200 word starter pack → saved as `vocab_packs`/`vocab_words` rows
  (`createdBy` = user, `isBuiltIn` = false) — then it behaves identically to curated packs
  (SRS, challenges, tracking). Schema already supports it. Add a "Forge a new pack" option in
  `components/story/NewStoryForm.tsx` and a prompt module in `server/ai/` (follow the
  `examples.ts` pattern; use `AI_MODEL_FAST`? No — pack quality matters, use flagship).
  Charge sparks for it (add a `packForge` entry to `SPARK_COSTS`).
- **Phrase harvesting ("Gleanings")**: AI dialogue already emits ad-hoc `phrase` segments.
  Add a "collect" button on the phrase tap-card (`components/game/SegmentText.tsx`) → server
  action normalizes it into a per-user per-language "Gleanings" pack (auto-created
  `vocab_packs` row) so it enters the SRS. Dedupe by normalized term.
- **Curated packs**: more languages = drop `dictionary.json` into `data/vocab/<native>__<target>/`
  + add a `PACKS` entry in `scripts/seed.ts` (seed is additive — new words in an existing file are
  appended on re-run). Prefer frequency-ordered lists; `sortIndex` is the teaching order.
  Consider CEFR-tiered packs per language ("Starter / Wayfarer / Scholar").
- **Grammar packs**: `data/vocab/*/grammar.json` holds 40 curated grammar lessons per language
  (title + description), currently unused by gameplay. Integration idea: a `grammar_lessons`
  table mirroring vocab packs; the narrator gets "one grammar point to model naturally" in its
  brief at Speaker+ immersion levels; a grammar challenge type quizzes the pattern.
  Dialect note: folder names are deliberately dialect-free (`english__japanese`) — dialect
  belongs on the pack row (`targetDialect`) if a dialect-specific pack is ever wanted.

## 3. Learning & gameplay

- **More challenge types** (registry at `game/challenges/index.ts` — each type = one
  generator + grader + renderer in `components/game/ChallengeView.tsx`): listening
  (play TTS of the word via `/api/voice/speak` plumbing → pick/type), pronunciation
  (mic + transcribe → compare), synonyms/antonyms (needs those fields on `vocab_words`),
  translation (full sentence), context clues, crosswords.
- **Companion NPCs**: `characters.isCompanion` + nullable `mapId` already modeled; needs
  scene/brief inclusion when travelling, and forge/quest hooks.
- **Rolling conversation summaries**: `conversations.summary` column exists but is never
  refreshed; add a cheap summarize pass (AI_MODEL_FAST) every ~30 messages so very long
  friendships stay in context.
- **Immersion preference**: the ladder (`getImmersionLevel` in `server/services/learning.ts`,
  guidance in `server/ai/segments.ts`) is retention-driven; optionally add a user preference
  ("cozy / brisk") that shifts the level ±1.
- **World variety**: more handcrafted map templates + alternate `WORLD_BLUEPRINT`s in
  `game/mapTemplates.ts` (seaside, mountain, city) — geometry stays authored, forge AI fills.

## 4. Polish

- Real artwork to replace emoji sprite tokens (`game/sprites.ts` maps spriteKey → asset;
  swap emoji for image paths, keep the keys).
- Drop cap currently decorates the first *loaded* passage, not the first of each chapter
  (`components/game/Journal.tsx` StoryTab).
- Push notifications via TWA for low balance / story events (needs service worker).
- Rate limiting on AI actions (per-user, e.g. token bucket in Postgres or Redis) before
  public launch.
