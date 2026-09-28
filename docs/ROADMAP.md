# Roadmap — what is not built yet, and where it would go

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. Everything here has its foundation in place; each
item names it. They are ordered by how much they matter before other people are let in.

## 1. Before anyone else plays

- **Run a real payment on PowerTranz staging.** The whole road is built and passes against the
  test gateway, but has never met PowerTranz itself. With staging credentials: make a hosted page
  in the merchant portal, set the variables in the README, pay once, and confirm the four things
  listed at the top of `server/payments/powertranz.ts` (expiry format, the shape of
  `/spi/payment`, the 3-D Secure field, the production host). Then refund it with
  `scripts/refundTopup.ts`.
- **What the bank will ask for before it lets you go live**: terms of service, a privacy policy,
  a refund policy and a way to reach you, all on the site. None of these pages exist yet, and
  what they say is a business decision (is unspent credit refundable? does credit expire?).
- **The app stores.** A web view wrapped as an app may not sell credit by card: Apple and Google
  require their own in-app purchase for digital goods, at 15–30%. In order of effort:
  1. *Web first.* Launch as a website (and an installable PWA). No store, no commission.
  2. *An app that does not sell.* The wrapped app shows the balance and plays the game; credit is
     bought on the website. The app must hide the "Pay" buttons and may not point to them (add a
     `?shell=app` flag that `WalletScreen` reads). Google Play allows such "consumption-only"
     apps. Apple is stricter with games: credit bought elsewhere may be used in the app only if
     it is also sold there by in-app purchase, so expect iOS to need the third way. The rules on
     linking out have been changing since 2025, above all in the United States: read both
     stores' current payment policies before building.
  3. *In-app purchase.* Sell the same packages through the stores (RevenueCat is the usual way),
     crediting the same wallet through `completeTopup` with a new provider. The packages must be
     repriced for the app: at 30%, a $6 pouch leaves $4.20, less than the $5 it credits.
  Bring-your-own-key needs none of this: nothing is sold.
- **Rate limits.** Spending is self-limiting for wallet players (they pay), but the starter gift
  ($0.50 per new account) can be farmed, and speech transcription accepts uploads. Add a per-user
  limit on model calls per minute and per day in `server/ai/client.ts` (`openDoor` is where every
  call already stops to check the wallet), and consider granting the gift only after the first
  top-up or to verified emails.
- **A production build on the server, and a phone in the hand.** The engine adapts its own quality
  to the frame rate it measures, but it has only ever been run in desktop Chrome. Walk through a
  book on a mid-range Android phone and on an iPhone before promising anything about either.
- **Prices drift.** `server/ai/pricing.ts` holds the provider's prices as of September 2026. An
  unknown model is charged at the dearest known price, so a new model can never be free, but the
  table should be checked whenever the default models change.
- **Refund a failed call?** A model call that fails validation twice has been paid for and is
  charged. That is honest but unkind. If it proves common in `ai_usage` (`ok = false`), refund with
  `grant(userId, micros, "refund", usageId)`.

## 2. The world

- **Interiors.** Buildings are scenery with a name. An inn one can walk into is a fourth region
  kind (`interior`): a small walled layout in `game/worldgen/layout.ts`, a door as a gate.
- **Companions.** A character who walks with the hero needs `characters.regionId` to be null while
  travelling, a follow behaviour in `engine/index.ts` beside `moveCharacters`, and their sheet in
  every narrator prompt.
- **Day turning to night.** Each region has one fixed hour. `engine/palette.ts` already separates
  place from light; blending between two `Daylight` entries over time is the missing piece.
- **Sound.** There is speech but no music and no footsteps. WebAudio, a few seconds of generated
  ambience per biome, started on the first tap.
- **More of everything the engine can build.** New creature kinds (`engine/creatures.ts`),
  landmark kinds (`engine/props.ts` + `LANDMARK_KINDS`), building kinds, biomes. Each is one
  function and one entry in `game/looks.ts`; the storyteller starts using them at once.

## 3. The story

- **Items.** The hero owns nothing. An `items` table, a "give" and "take" effect in the director's
  output, and a satchel tab in the journal would let promises be kept with things.
- **Endings that differ.** The book ends when the last chapter turns. The threads a player
  resolved, dropped or never found are all in `threads`; the final chapter prompt could be given
  them and asked for the ending this reader earned.
- **Characters who move.** The director can change what a character wants but not where they
  stand. Add `move` to its shifts, with the target chosen from free `npcSlots` of the layout.
- **Promises kept.** A character remembers a promise (`memories.kind = "promise"`), and the two
  newest are in every prompt, but nothing ever sets `memories.resolved`. Add `keptPromise` to the
  character's turn (the key of a promise shown in the brief), mark it, and let affinity rise.
- **Two tabs at once.** `turnChapter` checks that the chapter is ready and then writes; the same
  book open in two tabs could turn the page twice. Claim the turn first, as the forge and the
  director do (a conditional `update … returning`).

## 4. Learning

- **Grammar.** The book teaches words and whole sentences, never rules. One grammar point per
  chapter, named in the bible, modelled by the narrator, asked about in battles.
- **Speaking challenges in battle.** Built (`speaking` in `game/challenges/`), graded, and left out
  of `TIER_CHALLENGES` and the study hall, because a microphone that fails mid-battle costs a
  heart. Offer it as something the player switches on.
- **Placement.** Players say where they are starting from. A two-minute placement battle would
  know better.
- **Sentences in the satchel.** `saved_phrases` exists; nothing writes to it yet. A "keep this
  sentence" button beside a revealed translation, and a study mode that rebuilds kept sentences.
- **More languages.** A language is an entry in `game/languages.ts`, a source in
  `scripts/dict/sources.ts` and, for anything kaikki.org publishes, no new code.
  A reader's language other than English needs dictionaries glossed in that language.

## 5. Polish

- **A faster forge.** A new book takes about 80 seconds, nearly all of it the model writing the
  cast and the places (two calls of ~2,300 tokens side by side). To halve it: after the seed, one
  short call writes a *roster* (every person, creature and landmark: name and one line), then
  the details are written in three or four parallel calls that all see the roster, so the cast
  still interlocks, and the opening is written beside them. `writeWorld` in
  `server/ai/prompts/forge.ts` is the place. Or let the reader in once the home region is
  written and finish the rest behind them.
- The cover and the forge screen could show the book's own world as soon as its first region is
  known.
- Translations are shown beneath target-language lines until immersion level 3, then hidden behind
  a tap. That switch should be the player's to set.
- The journal's map is a list. The regions and their gates are a graph worth drawing.
