import { relations, sql } from "drizzle-orm";
import {
    bigint, boolean, customType, index, integer, json, jsonb, pgEnum, pgTable,
    primaryKey, real, serial, smallint, text, timestamp, uniqueIndex, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "@auth/core/adapters";
import type { Segment } from "@/game/segments";
import type { StoredStage } from "@/game/challenges/types";
import type { ActorLook, CreatureLook } from "@/game/looks";
import type { DictSense } from "@/game/dictionary";
import type { DialogueOption, LanguageNote, PassageChoice } from "@/game/payloads";

const uuid = () => crypto.randomUUID();

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "bytea",
});

/* ------------------------------------------------------------------ */
/* enums                                                               */
/* ------------------------------------------------------------------ */

export const bookStatusEnum = pgEnum("book_status", ["forging", "active", "completed", "abandoned"]);
export const arcStageEnum = pgEnum("arc_stage", ["introduction", "rising", "climax", "falling", "resolution"]);
export const regionKindEnum = pgEnum("region_kind", ["settlement", "wilds", "depths"]);
export const characterStatusEnum = pgEnum("character_status", ["alive", "gone"]);
export const memoryKindEnum = pgEnum("memory_kind", ["episode", "fact", "promise", "rumor", "reflection"]);
export const enemyTierEnum = pgEnum("enemy_tier", ["minion", "elite", "boss"]);
export const enemyStatusEnum = pgEnum("enemy_status", ["alive", "defeated"]);
export const encounterStatusEnum = pgEnum("encounter_status", ["active", "won", "retreated"]);
export const questStatusEnum = pgEnum("quest_status", ["active", "completed", "failed"]);
export const objectiveKindEnum = pgEnum("objective_kind", ["talkTo", "persuade", "defeat", "visit", "inspect", "learnWords"]);
export const objectiveStatusEnum = pgEnum("objective_status", ["active", "completed", "failed"]);
export const threadStatusEnum = pgEnum("thread_status", ["open", "resolved", "dropped"]);
export const speakerEnum = pgEnum("speaker", ["player", "character"]);
export const passageKindEnum = pgEnum("passage_kind", ["narration", "discovery", "event", "choice"]);
export const topupStatusEnum = pgEnum("topup_status", ["pending", "paid", "failed", "refunded"]);

/* ------------------------------------------------------------------ */
/* users (NextAuth adapter shape + app fields)                         */
/* ------------------------------------------------------------------ */

export type UserSettings = {
    /** rendering quality; "auto" lets the engine adapt to the device */
    quality?: "auto" | "low" | "medium" | "high";
    sound?: boolean;
    /** read character lines aloud automatically */
    autoSpeak?: boolean;
};

export const users = pgTable("users", {
    id: text("id").primaryKey().$defaultFn(uuid),
    name: text("name"),
    email: text("email").unique(),
    emailVerified: timestamp("emailVerified", { mode: "date" }),
    image: text("image"),
    nativeLanguage: text("nativeLanguage").notNull().default("en"),
    /** null until onboarding: "byok" = their own OpenAI key (kept on their device), "credits" = prepaid wallet */
    billingMode: text("billingMode").$type<"byok" | "credits">(),
    /** cached wallet balance in millionths of a US dollar — only ever changed alongside a ledger row */
    creditMicros: bigint("creditMicros", { mode: "number" }).notNull().default(0),
    /** seeded test accounts (see lib/testMode.ts) — never a real person */
    isTest: boolean("isTest").notNull().default(false),
    settings: json("settings").$type<UserSettings>().notNull().default({}),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const userRelations = relations(users, ({ many }) => ({
    books: many(books),
    learnerProfiles: many(learnerProfiles),
}));

/* ------------------------------------------------------------------ */
/* the dictionary (imported open data — see scripts/dict/)             */
/* ------------------------------------------------------------------ */

export const dictEntries = pgTable("dict_entries", {
    id: serial("id").primaryKey(),
    lang: text("lang").notNull(),
    /** the headword as a learner would look it up */
    lemma: text("lemma").notNull(),
    pos: text("pos").notNull(),
    /** kana for Japanese, tone-marked pinyin for Mandarin */
    reading: text("reading"),
    /** Latin-script rendering for non-Latin scripts */
    roman: text("roman"),
    ipa: text("ipa"),
    gender: text("gender"),
    /** the one short meaning shown in challenges and word offers */
    gloss: text("gloss").notNull(),
    senses: jsonb("senses").$type<DictSense[]>().notNull().default([]),
    /** normalised one-or-two-word English meanings, for "which word means sword?" lookups */
    glossKeys: text("glossKeys").array().notNull().default(sql`'{}'::text[]`),
    /** 1 = most common; null when the word never appears in the frequency list */
    freqRank: integer("freqRank"),
    /** 1–6, a CEFR-like band derived from frequency */
    level: smallint("level").notNull().default(6),
    /** false for vulgar, archaic or otherwise unsuitable words: still look-up-able, never taught */
    teachable: boolean("teachable").notNull().default(true),
    /** a human recording on Wikimedia Commons, when Wiktionary links one */
    audioUrl: text("audioUrl"),
}, (t) => [
    uniqueIndex("dictEntries_lang_lemma_pos_idx").on(t.lang, t.lemma, t.pos),
    index("dictEntries_lang_freq_idx").on(t.lang, t.freqRank),
    index("dictEntries_glossKeys_idx").using("gin", t.glossKeys),
]);

/** every written form that leads to a headword: conjugations, plurals, kana spellings… */
export const dictForms = pgTable("dict_forms", {
    lang: text("lang").notNull(),
    /** normalised with normalizeForm() */
    form: text("form").notNull(),
    entryId: integer("entryId").notNull().references(() => dictEntries.id, { onDelete: "cascade" }),
    /** "dict" from the import, "ai" when the storyteller resolved an unknown form once */
    source: text("source").notNull().default("dict"),
}, (t) => [
    primaryKey({ columns: [t.lang, t.form, t.entryId] }),
    index("dictForms_entry_idx").on(t.entryId),
]);

export const dictEntryRelations = relations(dictEntries, ({ many }) => ({
    forms: many(dictForms),
}));

export const dictFormRelations = relations(dictForms, ({ one }) => ({
    entry: one(dictEntries, { fields: [dictForms.entryId], references: [dictEntries.id] }),
}));

/* ------------------------------------------------------------------ */
/* the learner                                                         */
/* ------------------------------------------------------------------ */

/** one row per language a player studies */
export const learnerProfiles = pgTable("learner_profiles", {
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    lang: text("lang").notNull(),
    /** where they said they were starting from: 0 new … 3 advanced */
    startingLevel: smallint("startingLevel").notNull().default(0),
    /** shifts how much target language the book dares to use: -1 cozy, 0 balanced, 1 bold */
    immersionBias: smallint("immersionBias").notNull().default(0),
    xp: integer("xp").notNull().default(0),
    streakDays: integer("streakDays").notNull().default(0),
    /** yyyy-mm-dd of the last day with study activity */
    lastStudyDay: text("lastStudyDay"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.userId, t.lang] }),
]);

export const learnerProfileRelations = relations(learnerProfiles, ({ one }) => ({
    user: one(users, { fields: [learnerProfiles.userId], references: [users.id] }),
}));

/** per-user spaced-repetition state for one dictionary entry */
export const wordProgress = pgTable("word_progress", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    entryId: integer("entryId").notNull().references(() => dictEntries.id, { onDelete: "cascade" }),
    lang: text("lang").notNull(),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    ease: real("ease").notNull().default(2.5),
    intervalDays: real("intervalDays").notNull().default(0),
    dueAt: timestamp("dueAt", { mode: "date" }).notNull().defaultNow(),
    lastReviewedAt: timestamp("lastReviewedAt", { mode: "date" }),
    timesSeen: integer("timesSeen").notNull().default(0),
    timesCorrect: integer("timesCorrect").notNull().default(0),
    /** times the learner wrote or spoke the word themselves — the strongest evidence */
    timesProduced: integer("timesProduced").notNull().default(0),
    /** the learner chose to keep this word (tapped "collect") rather than merely meeting it */
    collected: boolean("collected").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex("wordProgress_user_entry_idx").on(t.userId, t.entryId),
    index("wordProgress_user_lang_due_idx").on(t.userId, t.lang, t.dueAt),
]);

export const wordProgressRelations = relations(wordProgress, ({ one }) => ({
    user: one(users, { fields: [wordProgress.userId], references: [users.id] }),
    entry: one(dictEntries, { fields: [wordProgress.entryId], references: [dictEntries.id] }),
}));

/** every challenge answer ever given — feeds the schedule and the progress charts */
export const challengeAttempts = pgTable("challenge_attempts", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    bookId: text("bookId").references(() => books.id, { onDelete: "set null" }),
    entryId: integer("entryId").references(() => dictEntries.id, { onDelete: "set null" }),
    lang: text("lang").notNull(),
    challengeType: text("challengeType").notNull(),
    /** "battle" inside a story, "study" in the study hall */
    context: text("context").notNull().default("battle"),
    correct: boolean("correct").notNull(),
    answerGiven: text("answerGiven"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("challengeAttempts_user_created_idx").on(t.userId, t.createdAt),
]);

/** a review session in the study hall. `stages` holds answers — never sent to the client. */
export const studySessions = pgTable("study_sessions", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    lang: text("lang").notNull(),
    stages: json("stages").$type<StoredStage[]>().notNull().default([]),
    stageIndex: integer("stageIndex").notNull().default(0),
    correctCount: integer("correctCount").notNull().default(0),
    finished: boolean("finished").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("studySessions_user_idx").on(t.userId, t.createdAt),
]);

/** whole phrases and sentences the learner chose to keep */
export const savedPhrases = pgTable("saved_phrases", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    lang: text("lang").notNull(),
    target: text("target").notNull(),
    translation: text("translation").notNull(),
    bookId: text("bookId").references(() => books.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex("savedPhrases_user_lang_target_idx").on(t.userId, t.lang, t.target),
]);

/* ------------------------------------------------------------------ */
/* paying the storyteller                                              */
/* ------------------------------------------------------------------ */

/** append-only: every change to a wallet, with the balance it left behind */
export const creditLedger = pgTable("credit_ledger", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** positive = credit added, negative = spent; millionths of a US dollar */
    deltaMicros: bigint("deltaMicros", { mode: "number" }).notNull(),
    /** "starter-gift", "topup", "ai:dialogue", "refund", "adjustment"… */
    reason: text("reason").notNull(),
    /** the topup or usage row this entry settles */
    ref: text("ref"),
    balanceAfterMicros: bigint("balanceAfterMicros", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("creditLedger_user_created_idx").on(t.userId, t.createdAt),
    // a payment or a gift can only ever be credited once
    uniqueIndex("creditLedger_reason_ref_idx").on(t.reason, t.ref).where(sql`${t.ref} is not null`),
]);

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
    user: one(users, { fields: [creditLedger.userId], references: [users.id] }),
}));

/** one row per model call: what it cost us and what the player was charged */
export const aiUsage = pgTable("ai_usage", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").references(() => users.id, { onDelete: "set null" }),
    bookId: text("bookId").references(() => books.id, { onDelete: "set null" }),
    task: text("task").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("inputTokens").notNull().default(0),
    /** the part of inputTokens served from the provider's prompt cache */
    cachedTokens: integer("cachedTokens").notNull().default(0),
    outputTokens: integer("outputTokens").notNull().default(0),
    /** speech is priced per character, not per token */
    characters: integer("characters").notNull().default(0),
    costMicros: bigint("costMicros", { mode: "number" }).notNull().default(0),
    chargedMicros: bigint("chargedMicros", { mode: "number" }).notNull().default(0),
    byok: boolean("byok").notNull().default(false),
    ms: integer("ms").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("aiUsage_user_created_idx").on(t.userId, t.createdAt),
    index("aiUsage_book_idx").on(t.bookId),
]);

/** a purchase of credit: what was paid, what was granted, and who processed it */
export const topups = pgTable("topups", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    packageKey: text("packageKey").notNull(),
    paidCents: integer("paidCents").notNull(),
    creditMicros: bigint("creditMicros", { mode: "number" }).notNull(),
    provider: text("provider").notNull(),
    /** the processor's own id for the payment — unique, so a repeated webhook cannot credit twice */
    providerRef: text("providerRef"),
    status: topupStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    paidAt: timestamp("paidAt", { mode: "date" }),
}, (t) => [
    index("topups_user_idx").on(t.userId),
    uniqueIndex("topups_provider_ref_idx").on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`),
]);

/** speech is generated once and replayed forever, for everyone */
export const ttsCache = pgTable("tts_cache", {
    /** sha-256 of model + voice + style + text */
    key: text("key").primaryKey(),
    mime: text("mime").notNull().default("audio/mpeg"),
    audio: bytea("audio").notNull(),
    characters: integer("characters").notNull(),
    hits: integer("hits").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* books                                                               */
/* ------------------------------------------------------------------ */

/** what the player asked for when they created the book */
export type BookBrief = {
    genre: string;
    tone: string;
    /** their own words, or empty for "surprise me" */
    wish: string;
};

export const books = pgTable("books", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    premise: text("premise").notNull().default(""),
    tone: text("tone").notNull().default("warm, adventurous"),
    brief: json("brief").$type<BookBrief>().notNull(),
    nativeLanguage: text("nativeLanguage").notNull().default("en"),
    targetLanguage: text("targetLanguage").notNull(),
    playerName: text("playerName").notNull(),
    heroLook: json("heroLook").$type<ActorLook>().notNull(),
    status: bookStatusEnum("status").notNull().default("forging"),
    /** short note shown on the forging screen ("Naming the villagers…"); "failed" after an error */
    forgeNote: text("forgeNote").notNull().default(""),
    arcStage: arcStageEnum("arcStage").notNull().default("introduction"),
    /** everything procedural about this world derives from this number */
    worldSeed: integer("worldSeed").notNull(),
    styleKit: text("styleKit").notNull().default("timber"),
    /**
     * The story bible: the stable facts every prompt opens with. It changes
     * only at chapter turns, which is what lets the provider cache it.
     */
    bible: text("bible").notNull().default(""),
    /** the director's running note to the narrator about where the story should lean next */
    directorNote: text("directorNote").notNull().default(""),
    /** story weight accumulated since the director last looked; it runs when this crosses a threshold */
    significance: integer("significance").notNull().default(0),
    currentRegionId: text("currentRegionId").references((): AnyPgColumn => regions.id, { onDelete: "set null" }),
    x: real("x").notNull().default(0),
    z: real("z").notNull().default(0),
    facing: real("facing").notNull().default(0),
    xp: integer("xp").notNull().default(0),
    playSeconds: integer("playSeconds").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
    index("books_userId_idx").on(t.userId),
]);

export const bookRelations = relations(books, ({ one, many }) => ({
    user: one(users, { fields: [books.userId], references: [users.id] }),
    regions: many(regions),
    characters: many(characters),
    enemies: many(enemies),
    quests: many(quests),
    chapters: many(chapters),
    threads: many(threads),
}));

/* ------------------------------------------------------------------ */
/* the world: regions, landmarks, gates                                */
/* ------------------------------------------------------------------ */

export const regions = pgTable("regions", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    /** short stable key the storyteller uses to talk about the place (r1, r2…) */
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: regionKindEnum("kind").notNull(),
    biome: text("biome").notNull(),
    timeOfDay: text("timeOfDay").notNull().default("day"),
    weather: text("weather").notNull().default("clear"),
    /** the terrain, paths and scenery are rebuilt from this on every device */
    seed: integer("seed").notNull(),
    /** sensory notes the narrator reuses ("woodsmoke, distant bells, wet cobblestones") */
    ambience: text("ambience").notNull().default(""),
    description: text("description").notNull().default(""),
    /** plain English nouns for things found here: they decide which vocabulary the place teaches */
    themeWords: text("themeWords").array().notNull().default(sql`'{}'::text[]`),
    visited: boolean("visited").notNull().default(false),
    sortIndex: integer("sortIndex").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("regions_bookId_idx").on(t.bookId),
]);

export const regionRelations = relations(regions, ({ one, many }) => ({
    book: one(books, { fields: [regions.bookId], references: [books.id] }),
    landmarks: many(landmarks),
    gates: many(gates, { relationName: "gateFrom" }),
    buildings: many(buildings),
}));

export const buildings = pgTable("buildings", {
    id: text("id").primaryKey().$defaultFn(uuid),
    regionId: text("regionId").notNull().references(() => regions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    x: real("x").notNull(),
    z: real("z").notNull(),
    rot: real("rot").notNull().default(0),
    width: real("width").notNull(),
    depth: real("depth").notNull(),
    /** varies roof colour, storeys and trim between neighbours */
    variant: integer("variant").notNull().default(0),
}, (t) => [
    index("buildings_regionId_idx").on(t.regionId),
]);

export const buildingRelations = relations(buildings, ({ one }) => ({
    region: one(regions, { fields: [buildings.regionId], references: [regions.id] }),
}));

/** things the hero can walk up to and examine */
export const landmarks = pgTable("landmarks", {
    id: text("id").primaryKey().$defaultFn(uuid),
    regionId: text("regionId").notNull().references(() => regions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** what a curious reader discovers; written once at the forge */
    lore: text("lore").notNull().default(""),
    x: real("x").notNull(),
    z: real("z").notNull(),
    rot: real("rot").notNull().default(0),
    /** the dictionary word floating over it in the language being learned */
    labelEntryId: integer("labelEntryId").references(() => dictEntries.id, { onDelete: "set null" }),
    /** the passage written the first time it was examined — later visits reread it for free */
    passageId: text("passageId"),
}, (t) => [
    index("landmarks_regionId_idx").on(t.regionId),
]);

export const landmarkRelations = relations(landmarks, ({ one }) => ({
    region: one(regions, { fields: [landmarks.regionId], references: [regions.id] }),
}));

/** the ways out of a region */
export const gates = pgTable("gates", {
    id: text("id").primaryKey().$defaultFn(uuid),
    regionId: text("regionId").notNull().references(() => regions.id, { onDelete: "cascade" }),
    /** which edge of the region it stands on: n, e, s or w */
    side: text("side").notNull(),
    x: real("x").notNull(),
    z: real("z").notNull(),
    rot: real("rot").notNull().default(0),
    label: text("label").notNull(),
    targetRegionId: text("targetRegionId").notNull().references((): AnyPgColumn => regions.id, { onDelete: "cascade" }),
    targetX: real("targetX").notNull(),
    targetZ: real("targetZ").notNull(),
    targetFacing: real("targetFacing").notNull().default(0),
}, (t) => [
    index("gates_regionId_idx").on(t.regionId),
]);

export const gateRelations = relations(gates, ({ one }) => ({
    region: one(regions, { fields: [gates.regionId], references: [regions.id], relationName: "gateFrom" }),
}));

/* ------------------------------------------------------------------ */
/* characters, memory, relationships                                   */
/* ------------------------------------------------------------------ */

export const characters = pgTable("characters", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    regionId: text("regionId").references(() => regions.id, { onDelete: "set null" }),
    x: real("x").notNull().default(0),
    z: real("z").notNull().default(0),
    facing: real("facing").notNull().default(0),
    name: text("name").notNull(),
    role: text("role").notNull(),
    personality: text("personality").notNull(),
    appearance: text("appearance").notNull().default(""),
    backstory: text("backstory").notNull().default(""),
    /** something they will not say until they trust the hero */
    secret: text("secret").notNull().default(""),
    /** what they want right now; the director may change it as the story moves */
    goal: text("goal").notNull().default(""),
    /** how they talk: rhythm, pet phrases, formality */
    speechStyle: text("speechStyle").notNull().default(""),
    mood: text("mood").notNull().default("calm"),
    look: json("look").$type<ActorLook>().notNull(),
    voiceId: text("voiceId").notNull().default("alloy"),
    /** short lines they call out as the hero passes — written at the forge, so they cost nothing to show */
    barks: json("barks").$type<Segment[][]>().notNull().default([]),
    status: characterStatusEnum("status").notNull().default("alive"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("characters_bookId_idx").on(t.bookId),
    index("characters_regionId_idx").on(t.regionId),
]);

export const characterRelations = relations(characters, ({ one, many }) => ({
    book: one(books, { fields: [characters.bookId], references: [books.id] }),
    region: one(regions, { fields: [characters.regionId], references: [regions.id] }),
    memories: many(memories),
    relationship: one(relationships),
}));

/**
 * Long-term memory. A character remembers because a row says so; what reaches
 * the prompt is the handful that score highest for the moment at hand
 * (see server/services/memory.ts).
 */
export const memories = pgTable("memories", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    characterId: text("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
    kind: memoryKindEnum("kind").notNull().default("episode"),
    /** one sentence, from the character's point of view */
    content: text("content").notNull(),
    /** 1 trivial … 10 life-changing */
    importance: smallint("importance").notNull().default(5),
    /** lower-cased words that should bring this memory back when they come up */
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    /** promises stay pinned in the prompt until they are kept or broken */
    resolved: boolean("resolved").notNull().default(false),
    recallCount: integer("recallCount").notNull().default(0),
    lastRecalledAt: timestamp("lastRecalledAt", { mode: "date" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("memories_character_idx").on(t.characterId, t.importance),
]);

export const memoryRelations = relations(memories, ({ one }) => ({
    character: one(characters, { fields: [memories.characterId], references: [characters.id] }),
}));

/** how this character currently feels about the hero */
export const relationships = pgTable("relationships", {
    characterId: text("characterId").primaryKey().references(() => characters.id, { onDelete: "cascade" }),
    /** -100 hostile … 100 devoted */
    affinity: integer("affinity").notNull().default(0),
    /** two or three sentences, rewritten when memories are consolidated */
    summary: text("summary").notNull().default(""),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const relationshipRelations = relations(relationships, ({ one }) => ({
    character: one(characters, { fields: [relationships.characterId], references: [characters.id] }),
}));

/* ------------------------------------------------------------------ */
/* enemies & encounters                                                */
/* ------------------------------------------------------------------ */

export const enemies = pgTable("enemies", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    regionId: text("regionId").notNull().references(() => regions.id, { onDelete: "cascade" }),
    x: real("x").notNull(),
    z: real("z").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    tier: enemyTierEnum("tier").notNull().default("minion"),
    look: json("look").$type<CreatureLook>().notNull(),
    introLine: text("introLine").notNull().default(""),
    defeatLine: text("defeatLine").notNull().default(""),
    /** which challenge types this enemy may throw (subset of the registry) */
    challengeTypes: json("challengeTypes").$type<string[]>().notNull().default([]),
    status: enemyStatusEnum("status").notNull().default("alive"),
    /** ordinary creatures return after a while, so there is always something to practise on */
    respawns: boolean("respawns").notNull().default(false),
    defeatedAt: timestamp("defeatedAt", { mode: "date" }),
}, (t) => [
    index("enemies_bookId_idx").on(t.bookId),
    index("enemies_regionId_idx").on(t.regionId),
]);

export const enemyRelations = relations(enemies, ({ one }) => ({
    book: one(books, { fields: [enemies.bookId], references: [books.id] }),
    region: one(regions, { fields: [enemies.regionId], references: [regions.id] }),
}));

/** a battle in progress (or finished). `stages` holds answers — never sent to the client. */
export const encounters = pgTable("encounters", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    enemyId: text("enemyId").notNull().references(() => enemies.id, { onDelete: "cascade" }),
    status: encounterStatusEnum("status").notNull().default("active"),
    stages: json("stages").$type<StoredStage[]>().notNull().default([]),
    stageIndex: integer("stageIndex").notNull().default(0),
    hearts: integer("hearts").notNull().default(3),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    endedAt: timestamp("endedAt", { mode: "date" }),
}, (t) => [
    index("encounters_bookId_idx").on(t.bookId),
]);

export const encounterRelations = relations(encounters, ({ one }) => ({
    book: one(books, { fields: [encounters.bookId], references: [books.id] }),
    enemy: one(enemies, { fields: [encounters.enemyId], references: [enemies.id] }),
}));

/* ------------------------------------------------------------------ */
/* quests & story threads                                              */
/* ------------------------------------------------------------------ */

export const quests = pgTable("quests", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    arcStage: arcStageEnum("arcStage").notNull().default("introduction"),
    giverCharacterId: text("giverCharacterId").references(() => characters.id, { onDelete: "set null" }),
    status: questStatusEnum("status").notNull().default("active"),
    sortIndex: integer("sortIndex").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("quests_bookId_idx").on(t.bookId),
]);

export const questRelations = relations(quests, ({ one, many }) => ({
    book: one(books, { fields: [quests.bookId], references: [books.id] }),
    objectives: many(questObjectives),
}));

export const questObjectives = pgTable("quest_objectives", {
    id: text("id").primaryKey().$defaultFn(uuid),
    questId: text("questId").notNull().references(() => quests.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    kind: objectiveKindEnum("kind").notNull(),
    targetCharacterId: text("targetCharacterId").references(() => characters.id, { onDelete: "set null" }),
    targetEnemyId: text("targetEnemyId").references(() => enemies.id, { onDelete: "set null" }),
    targetRegionId: text("targetRegionId").references(() => regions.id, { onDelete: "set null" }),
    targetLandmarkId: text("targetLandmarkId").references(() => landmarks.id, { onDelete: "set null" }),
    targetCount: integer("targetCount").notNull().default(1),
    progress: integer("progress").notNull().default(0),
    status: objectiveStatusEnum("status").notNull().default("active"),
    sortIndex: integer("sortIndex").notNull().default(0),
}, (t) => [
    index("questObjectives_questId_idx").on(t.questId),
]);

export const questObjectiveRelations = relations(questObjectives, ({ one }) => ({
    quest: one(quests, { fields: [questObjectives.questId], references: [quests.id] }),
}));

/**
 * What the story is still holding open: mysteries, promises, feuds, bonds.
 * The director reads and rewrites these — they are how a choice made in
 * chapter one can still matter in chapter four.
 */
export const threads = pgTable("threads", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("mystery"),
    summary: text("summary").notNull(),
    status: threadStatusEnum("status").notNull().default("open"),
    importance: smallint("importance").notNull().default(5),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
    index("threads_book_status_idx").on(t.bookId, t.status),
]);

export const threadRelations = relations(threads, ({ one }) => ({
    book: one(books, { fields: [threads.bookId], references: [books.id] }),
}));

/* ------------------------------------------------------------------ */
/* conversations & messages                                            */
/* ------------------------------------------------------------------ */

/** one persistent thread per character per book */
export const conversations = pgTable("conversations", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    characterId: text("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
    /** rolling summary of everything older than the recent-message window */
    summary: text("summary").notNull().default(""),
    /** how many messages the summary already covers */
    summarizedCount: integer("summarizedCount").notNull().default(0),
    messageCount: integer("messageCount").notNull().default(0),
    /** the replies currently on offer, so reopening the conversation shows the same choices */
    options: json("options").$type<DialogueOption[]>().notNull().default([]),
    startedAt: timestamp("startedAt", { mode: "date" }).notNull().defaultNow(),
    lastMessageAt: timestamp("lastMessageAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex("conversations_book_character_idx").on(t.bookId, t.characterId),
]);

export const conversationRelations = relations(conversations, ({ one, many }) => ({
    book: one(books, { fields: [conversations.bookId], references: [books.id] }),
    character: one(characters, { fields: [conversations.characterId], references: [characters.id] }),
    messages: many(messages),
}));

export const messages = pgTable("messages", {
    id: text("id").primaryKey().$defaultFn(uuid),
    conversationId: text("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    speaker: speakerEnum("speaker").notNull(),
    segments: json("segments").$type<Segment[]>().notNull().default([]),
    /** on a player message: what the character's reply taught about their target-language attempt */
    note: json("note").$type<LanguageNote>(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
]);

export const messageRelations = relations(messages, ({ one }) => ({
    conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
}));

/* ------------------------------------------------------------------ */
/* the book itself: chapters & passages                                */
/* ------------------------------------------------------------------ */

export const chapters = pgTable("chapters", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("chapters_bookId_idx").on(t.bookId),
]);

export const chapterRelations = relations(chapters, ({ one, many }) => ({
    book: one(books, { fields: [chapters.bookId], references: [books.id] }),
    passages: many(passages),
}));

export const passages = pgTable("passages", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    chapterId: text("chapterId").notNull().references(() => chapters.id, { onDelete: "cascade" }),
    kind: passageKindEnum("kind").notNull().default("narration"),
    segments: json("segments").$type<Segment[]>().notNull().default([]),
    /** a fork in the story: what the reader may do next */
    choices: json("choices").$type<PassageChoice[]>(),
    /** which choice they took; null while the fork is still open */
    chosenKey: text("chosenKey"),
    regionId: text("regionId").references(() => regions.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("passages_book_created_idx").on(t.bookId, t.createdAt),
]);

export const passageRelations = relations(passages, ({ one }) => ({
    book: one(books, { fields: [passages.bookId], references: [books.id] }),
    chapter: one(chapters, { fields: [passages.chapterId], references: [chapters.id] }),
}));

/* ------------------------------------------------------------------ */
/* the chronicle: everything that ever happened                        */
/* ------------------------------------------------------------------ */

export const events = pgTable("events", {
    id: text("id").primaryKey().$defaultFn(uuid),
    bookId: text("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    /** 1 trivial … 10 story-defining; feeds the director's threshold and what the chronicle keeps */
    importance: smallint("importance").notNull().default(3),
    regionId: text("regionId").references(() => regions.id, { onDelete: "set null" }),
    characterId: text("characterId").references(() => characters.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("events_book_created_idx").on(t.bookId, t.createdAt),
]);

export const eventRelations = relations(events, ({ one }) => ({
    book: one(books, { fields: [events.bookId], references: [books.id] }),
}));

/* ------------------------------------------------------------------ */
/* NextAuth adapter tables (unchanged)                                 */
/* ------------------------------------------------------------------ */

export const accounts = pgTable("account",
    {
        userId: text("userId")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        type: text("type").$type<AdapterAccountType>().notNull(),
        provider: text("provider").notNull(),
        providerAccountId: text("providerAccountId").notNull(),
        refresh_token: text("refresh_token"),
        access_token: text("access_token"),
        expires_at: integer("expires_at"),
        token_type: text("token_type"),
        scope: text("scope"),
        id_token: text("id_token"),
        session_state: text("session_state"),
    },
    (account) => [
        {
            compoundKey: primaryKey({
                columns: [account.provider, account.providerAccountId],
            }),
        },
    ]
);

export const sessions = pgTable("session", {
    sessionToken: text("sessionToken").primaryKey(),
    userId: text("userId")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verificationToken",
    {
        identifier: text("identifier").notNull(),
        token: text("token").notNull(),
        expires: timestamp("expires", { mode: "date" }).notNull(),
    },
    (verificationToken) => [
        {
            compositePk: primaryKey({
                columns: [verificationToken.identifier, verificationToken.token],
            }),
        },
    ]
);

export const authenticators = pgTable("authenticator",
    {
        credentialID: text("credentialID").notNull().unique(),
        userId: text("userId")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        providerAccountId: text("providerAccountId").notNull(),
        credentialPublicKey: text("credentialPublicKey").notNull(),
        counter: integer("counter").notNull(),
        credentialDeviceType: text("credentialDeviceType").notNull(),
        credentialBackedUp: boolean("credentialBackedUp").notNull(),
        transports: text("transports"),
    },
    (authenticator) => [
        {
            compositePK: primaryKey({
                columns: [authenticator.userId, authenticator.credentialID],
            }),
        },
    ]
);

/* ------------------------------------------------------------------ */
/* inferred row types                                                  */
/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type DictEntry = typeof dictEntries.$inferSelect;
export type LearnerProfile = typeof learnerProfiles.$inferSelect;
export type WordProgress = typeof wordProgress.$inferSelect;
export type StudySession = typeof studySessions.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
export type Topup = typeof topups.$inferSelect;
export type Book = typeof books.$inferSelect;
export type Region = typeof regions.$inferSelect;
export type Building = typeof buildings.$inferSelect;
export type Landmark = typeof landmarks.$inferSelect;
export type Gate = typeof gates.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type Relationship = typeof relationships.$inferSelect;
export type Enemy = typeof enemies.$inferSelect;
export type Encounter = typeof encounters.$inferSelect;
export type Quest = typeof quests.$inferSelect;
export type QuestObjective = typeof questObjectives.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type Passage = typeof passages.$inferSelect;
export type WorldEvent = typeof events.$inferSelect;
