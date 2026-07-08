import { relations } from "drizzle-orm";
import {
    boolean, timestamp, pgTable, pgEnum, text, primaryKey, integer, real,
    index, json, uniqueIndex, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "@auth/core/adapters";
import type { Segment } from "@/game/segments";
import type { StoredStage } from "@/game/challenges/types";

const uuid = () => crypto.randomUUID();

/* ------------------------------------------------------------------ */
/* enums                                                               */
/* ------------------------------------------------------------------ */

export const storyStatusEnum = pgEnum("story_status", ["forging", "active", "completed", "abandoned"]);
export const arcStageEnum = pgEnum("arc_stage", ["introduction", "rising", "climax", "falling", "resolution"]);
export const mapKindEnum = pgEnum("map_kind", ["settlement", "wilds", "dungeon", "interior"]);
export const characterStatusEnum = pgEnum("character_status", ["alive", "dead", "missing"]);
export const memoryKindEnum = pgEnum("memory_kind", ["conversation", "event", "fact"]);
export const enemyTierEnum = pgEnum("enemy_tier", ["minion", "elite", "boss"]);
export const enemyStatusEnum = pgEnum("enemy_status", ["alive", "defeated"]);
export const encounterStatusEnum = pgEnum("encounter_status", ["active", "won", "retreated"]);
export const questStatusEnum = pgEnum("quest_status", ["active", "completed", "failed"]);
export const objectiveKindEnum = pgEnum("objective_kind", ["talkTo", "persuade", "defeat", "visit", "learnWords", "custom"]);
export const objectiveStatusEnum = pgEnum("objective_status", ["active", "completed"]);
export const speakerEnum = pgEnum("speaker", ["player", "character"]);
export const passageKindEnum = pgEnum("passage_kind", ["narration", "dialogue", "event", "discovery"]);

/* ------------------------------------------------------------------ */
/* users (NextAuth adapter shape + app preferences)                    */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
    id: text("id").primaryKey().$defaultFn(uuid),
    name: text("name"),
    email: text("email").unique(),
    emailVerified: timestamp("emailVerified", { mode: "date" }),
    image: text("image"),
    nativeLanguage: text("nativeLanguage").notNull().default("english"),
    /** null until onboarding: "byok" = their own OpenAI key (kept on their device), "credits" = spends sparks */
    billingMode: text("billingMode").$type<"byok" | "credits">(),
    /** cached sparks balance — always changed in the same transaction as a ledger row */
    sparks: integer("sparks").notNull().default(0),
});

export const userRelations = relations(users, ({ many }) => ({
    stories: many(stories),
    wordProgress: many(wordProgress),
}));

/* ------------------------------------------------------------------ */
/* vocabulary packs & learning progress                                */
/* ------------------------------------------------------------------ */

export const vocabPacks = pgTable("vocab_packs", {
    id: text("id").primaryKey().$defaultFn(uuid),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    nativeLanguage: text("nativeLanguage").notNull(),
    targetLanguage: text("targetLanguage").notNull(),
    targetDialect: text("targetDialect"),
    coverEmoji: text("coverEmoji").notNull().default("📖"),
    isBuiltIn: boolean("isBuiltIn").notNull().default(false),
    createdBy: text("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const vocabPackRelations = relations(vocabPacks, ({ many }) => ({
    words: many(vocabWords),
}));

export const vocabWords = pgTable("vocab_words", {
    id: text("id").primaryKey().$defaultFn(uuid),
    packId: text("packId").notNull().references(() => vocabPacks.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    meaning: text("meaning").notNull(),
    pronunciation: text("pronunciation"),
    partOfSpeech: text("partOfSpeech"),
    /** target-language example sentence containing the term (used for cloze / ordering challenges) */
    exampleTarget: text("exampleTarget"),
    exampleNative: text("exampleNative"),
    sortIndex: integer("sortIndex").notNull().default(0),
}, (t) => [
    index("vocabWords_packId_idx").on(t.packId),
]);

export const vocabWordRelations = relations(vocabWords, ({ one }) => ({
    pack: one(vocabPacks, { fields: [vocabWords.packId], references: [vocabPacks.id] }),
}));

/** per-user spaced-repetition state for one word (SM-2-lite) */
export const wordProgress = pgTable("word_progress", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    wordId: text("wordId").notNull().references(() => vocabWords.id, { onDelete: "cascade" }),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    ease: real("ease").notNull().default(2.5),
    intervalDays: real("intervalDays").notNull().default(0),
    dueAt: timestamp("dueAt", { mode: "date" }).notNull().defaultNow(),
    lastReviewedAt: timestamp("lastReviewedAt", { mode: "date" }),
    timesSeen: integer("timesSeen").notNull().default(0),
    timesCorrect: integer("timesCorrect").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex("wordProgress_user_word_idx").on(t.userId, t.wordId),
    index("wordProgress_user_due_idx").on(t.userId, t.dueAt),
]);

export const wordProgressRelations = relations(wordProgress, ({ one }) => ({
    user: one(users, { fields: [wordProgress.userId], references: [users.id] }),
    word: one(vocabWords, { fields: [wordProgress.wordId], references: [vocabWords.id] }),
}));

/** append-only money/usage trail: every spark granted, bought, or spent */
export const creditLedger = pgTable("credit_ledger", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** positive = grant/top-up, negative = spend */
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    balanceAfter: integer("balanceAfter").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("creditLedger_user_created_idx").on(t.userId, t.createdAt),
]);

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
    user: one(users, { fields: [creditLedger.userId], references: [users.id] }),
}));

/** every challenge answer ever given — feeds SRS and analytics */
export const challengeAttempts = pgTable("challenge_attempts", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    storyId: text("storyId").references(() => stories.id, { onDelete: "set null" }),
    encounterId: text("encounterId").references(() => encounters.id, { onDelete: "set null" }),
    wordId: text("wordId").references(() => vocabWords.id, { onDelete: "set null" }),
    challengeType: text("challengeType").notNull(),
    correct: boolean("correct").notNull(),
    answerGiven: text("answerGiven"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("challengeAttempts_userId_idx").on(t.userId),
]);

/* ------------------------------------------------------------------ */
/* stories                                                             */
/* ------------------------------------------------------------------ */

export const stories = pgTable("stories", {
    id: text("id").primaryKey().$defaultFn(uuid),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    premise: text("premise").notNull().default(""),
    tone: text("tone").notNull().default("cozy adventure"),
    nativeLanguage: text("nativeLanguage").notNull(),
    targetLanguage: text("targetLanguage").notNull(),
    targetDialect: text("targetDialect"),
    playerName: text("playerName").notNull(),
    status: storyStatusEnum("status").notNull().default("forging"),
    /** short human-readable note shown on the forging screen ("Naming the villagers…") */
    forgeNote: text("forgeNote").notNull().default(""),
    arcStage: arcStageEnum("arcStage").notNull().default("introduction"),
    currentMapId: text("currentMapId").references((): AnyPgColumn => maps.id, { onDelete: "set null" }),
    x: real("x").notNull().default(0),
    y: real("y").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
    index("stories_userId_idx").on(t.userId),
]);

export const storyRelations = relations(stories, ({ one, many }) => ({
    user: one(users, { fields: [stories.userId], references: [users.id] }),
    packs: many(storyPacks),
    maps: many(maps),
    characters: many(characters),
    enemies: many(enemies),
    quests: many(quests),
    chapters: many(storyChapters),
}));

/** which vocab packs feed this story */
export const storyPacks = pgTable("story_packs", {
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    packId: text("packId").notNull().references(() => vocabPacks.id, { onDelete: "cascade" }),
}, (t) => [
    primaryKey({ columns: [t.storyId, t.packId] }),
]);

export const storyPackRelations = relations(storyPacks, ({ one }) => ({
    story: one(stories, { fields: [storyPacks.storyId], references: [stories.id] }),
    pack: one(vocabPacks, { fields: [storyPacks.packId], references: [vocabPacks.id] }),
}));

/* ------------------------------------------------------------------ */
/* world: maps, features, portals                                      */
/* ------------------------------------------------------------------ */

export const maps = pgTable("maps", {
    id: text("id").primaryKey().$defaultFn(uuid),
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: mapKindEnum("kind").notNull(),
    /** which handcrafted layout template this map uses (see game/mapTemplates.ts) */
    templateKey: text("templateKey").notNull(),
    biome: text("biome").notNull().default(""),
    /** sensory notes fed to the narrator ("woodsmoke, distant bells, wet cobblestones") */
    ambience: text("ambience").notNull().default(""),
    width: real("width").notNull(),
    height: real("height").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("maps_storyId_idx").on(t.storyId),
]);

export const mapRelations = relations(maps, ({ one, many }) => ({
    story: one(stories, { fields: [maps.storyId], references: [stories.id] }),
    features: many(mapFeatures),
    portals: many(portals, { relationName: "portalFrom" }),
}));

/** scenery and inspectable objects: trees, signs, campfires, buildings, wells… */
export const mapFeatures = pgTable("map_features", {
    id: text("id").primaryKey().$defaultFn(uuid),
    mapId: text("mapId").notNull().references(() => maps.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** flavor text revealed when the player inspects it (may be forged lazily) */
    lore: text("lore").notNull().default(""),
    x: real("x").notNull(),
    y: real("y").notNull(),
    interactive: boolean("interactive").notNull().default(false),
}, (t) => [
    index("mapFeatures_mapId_idx").on(t.mapId),
]);

export const mapFeatureRelations = relations(mapFeatures, ({ one }) => ({
    map: one(maps, { fields: [mapFeatures.mapId], references: [maps.id] }),
}));

/** doors and exits: standing near one lets the player travel to the target map */
export const portals = pgTable("portals", {
    id: text("id").primaryKey().$defaultFn(uuid),
    mapId: text("mapId").notNull().references(() => maps.id, { onDelete: "cascade" }),
    x: real("x").notNull(),
    y: real("y").notNull(),
    label: text("label").notNull(),
    targetMapId: text("targetMapId").notNull().references((): AnyPgColumn => maps.id, { onDelete: "cascade" }),
    targetX: real("targetX").notNull(),
    targetY: real("targetY").notNull(),
}, (t) => [
    index("portals_mapId_idx").on(t.mapId),
]);

export const portalRelations = relations(portals, ({ one }) => ({
    map: one(maps, { fields: [portals.mapId], references: [maps.id], relationName: "portalFrom" }),
}));

/* ------------------------------------------------------------------ */
/* characters, memory, relationships                                   */
/* ------------------------------------------------------------------ */

export const characters = pgTable("characters", {
    id: text("id").primaryKey().$defaultFn(uuid),
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    /** null while travelling with the player */
    mapId: text("mapId").references(() => maps.id, { onDelete: "set null" }),
    x: real("x").notNull().default(0),
    y: real("y").notNull().default(0),
    name: text("name").notNull(),
    role: text("role").notNull(),
    personality: text("personality").notNull(),
    appearance: text("appearance").notNull(),
    backstory: text("backstory").notNull().default(""),
    mood: text("mood").notNull().default("neutral"),
    /** OpenAI TTS voice used when this character speaks aloud */
    voiceId: text("voiceId").notNull().default("alloy"),
    spriteKey: text("spriteKey").notNull().default("npc"),
    status: characterStatusEnum("status").notNull().default("alive"),
    isCompanion: boolean("isCompanion").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("characters_storyId_idx").on(t.storyId),
    index("characters_mapId_idx").on(t.mapId),
]);

export const characterRelations = relations(characters, ({ one, many }) => ({
    story: one(stories, { fields: [characters.storyId], references: [stories.id] }),
    map: one(maps, { fields: [characters.mapId], references: [maps.id] }),
    memories: many(characterMemories),
    relationship: one(relationships),
}));

/** queryable long-term memory — "the NPC remembers because a row says so" */
export const characterMemories = pgTable("character_memories", {
    id: text("id").primaryKey().$defaultFn(uuid),
    characterId: text("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
    kind: memoryKindEnum("kind").notNull().default("event"),
    content: text("content").notNull(),
    importance: integer("importance").notNull().default(5),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("characterMemories_characterId_idx").on(t.characterId),
]);

export const characterMemoryRelations = relations(characterMemories, ({ one }) => ({
    character: one(characters, { fields: [characterMemories.characterId], references: [characters.id] }),
}));

/** how this NPC currently feels about the player */
export const relationships = pgTable("relationships", {
    characterId: text("characterId").primaryKey().references(() => characters.id, { onDelete: "cascade" }),
    affinity: integer("affinity").notNull().default(0),
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
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    mapId: text("mapId").notNull().references(() => maps.id, { onDelete: "cascade" }),
    x: real("x").notNull(),
    y: real("y").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    tier: enemyTierEnum("tier").notNull().default("minion"),
    spriteKey: text("spriteKey").notNull().default("enemy"),
    introLine: text("introLine").notNull().default(""),
    defeatLine: text("defeatLine").notNull().default(""),
    /** which challenge types this enemy may throw (subset of the registry) */
    challengeTypes: json("challengeTypes").$type<string[]>().notNull().default([]),
    status: enemyStatusEnum("status").notNull().default("alive"),
}, (t) => [
    index("enemies_storyId_idx").on(t.storyId),
    index("enemies_mapId_idx").on(t.mapId),
]);

export const enemyRelations = relations(enemies, ({ one }) => ({
    story: one(stories, { fields: [enemies.storyId], references: [stories.id] }),
    map: one(maps, { fields: [enemies.mapId], references: [maps.id] }),
}));

/** a battle in progress (or finished). `stages` holds answers — never sent to the client. */
export const encounters = pgTable("encounters", {
    id: text("id").primaryKey().$defaultFn(uuid),
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    enemyId: text("enemyId").notNull().references(() => enemies.id, { onDelete: "cascade" }),
    status: encounterStatusEnum("status").notNull().default("active"),
    stages: json("stages").$type<StoredStage[]>().notNull().default([]),
    stageIndex: integer("stageIndex").notNull().default(0),
    hearts: integer("hearts").notNull().default(3),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    endedAt: timestamp("endedAt", { mode: "date" }),
}, (t) => [
    index("encounters_storyId_idx").on(t.storyId),
]);

export const encounterRelations = relations(encounters, ({ one }) => ({
    story: one(stories, { fields: [encounters.storyId], references: [stories.id] }),
    enemy: one(enemies, { fields: [encounters.enemyId], references: [enemies.id] }),
}));

/* ------------------------------------------------------------------ */
/* quests                                                              */
/* ------------------------------------------------------------------ */

export const quests = pgTable("quests", {
    id: text("id").primaryKey().$defaultFn(uuid),
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    arcStage: arcStageEnum("arcStage").notNull().default("introduction"),
    giverCharacterId: text("giverCharacterId").references(() => characters.id, { onDelete: "set null" }),
    status: questStatusEnum("status").notNull().default("active"),
    sortIndex: integer("sortIndex").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("quests_storyId_idx").on(t.storyId),
]);

export const questRelations = relations(quests, ({ one, many }) => ({
    story: one(stories, { fields: [quests.storyId], references: [stories.id] }),
    objectives: many(questObjectives),
}));

export const questObjectives = pgTable("quest_objectives", {
    id: text("id").primaryKey().$defaultFn(uuid),
    questId: text("questId").notNull().references(() => quests.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    kind: objectiveKindEnum("kind").notNull(),
    targetCharacterId: text("targetCharacterId").references(() => characters.id, { onDelete: "set null" }),
    targetEnemyId: text("targetEnemyId").references(() => enemies.id, { onDelete: "set null" }),
    targetMapId: text("targetMapId").references(() => maps.id, { onDelete: "set null" }),
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

/* ------------------------------------------------------------------ */
/* conversations & messages                                            */
/* ------------------------------------------------------------------ */

/** one persistent thread per NPC per story */
export const conversations = pgTable("conversations", {
    id: text("id").primaryKey().$defaultFn(uuid),
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    characterId: text("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
    /** rolling summary of everything older than the recent-message window */
    summary: text("summary").notNull().default(""),
    messageCount: integer("messageCount").notNull().default(0),
    startedAt: timestamp("startedAt", { mode: "date" }).notNull().defaultNow(),
    lastMessageAt: timestamp("lastMessageAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex("conversations_story_character_idx").on(t.storyId, t.characterId),
]);

export const conversationRelations = relations(conversations, ({ one, many }) => ({
    story: one(stories, { fields: [conversations.storyId], references: [stories.id] }),
    character: one(characters, { fields: [conversations.characterId], references: [characters.id] }),
    messages: many(messages),
}));

export const messages = pgTable("messages", {
    id: text("id").primaryKey().$defaultFn(uuid),
    conversationId: text("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    speaker: speakerEnum("speaker").notNull(),
    segments: json("segments").$type<Segment[]>().notNull().default([]),
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

export const storyChapters = pgTable("story_chapters", {
    id: text("id").primaryKey().$defaultFn(uuid),
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("storyChapters_storyId_idx").on(t.storyId),
]);

export const storyChapterRelations = relations(storyChapters, ({ one, many }) => ({
    story: one(stories, { fields: [storyChapters.storyId], references: [stories.id] }),
    passages: many(passages),
}));

export const passages = pgTable("passages", {
    id: text("id").primaryKey().$defaultFn(uuid),
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    chapterId: text("chapterId").notNull().references(() => storyChapters.id, { onDelete: "cascade" }),
    kind: passageKindEnum("kind").notNull().default("narration"),
    segments: json("segments").$type<Segment[]>().notNull().default([]),
    mapId: text("mapId").references(() => maps.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("passages_storyId_idx").on(t.storyId),
    index("passages_chapterId_idx").on(t.chapterId),
]);

export const passageRelations = relations(passages, ({ one }) => ({
    story: one(stories, { fields: [passages.storyId], references: [stories.id] }),
    chapter: one(storyChapters, { fields: [passages.chapterId], references: [storyChapters.id] }),
}));

/* ------------------------------------------------------------------ */
/* the chronicle: everything that ever happened                        */
/* ------------------------------------------------------------------ */

export const events = pgTable("events", {
    id: text("id").primaryKey().$defaultFn(uuid),
    storyId: text("storyId").notNull().references(() => stories.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    mapId: text("mapId").references(() => maps.id, { onDelete: "set null" }),
    characterId: text("characterId").references(() => characters.id, { onDelete: "set null" }),
    data: json("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
    index("events_story_created_idx").on(t.storyId, t.createdAt),
]);

export const eventRelations = relations(events, ({ one }) => ({
    story: one(stories, { fields: [events.storyId], references: [stories.id] }),
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
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type VocabPack = typeof vocabPacks.$inferSelect;
export type VocabWord = typeof vocabWords.$inferSelect;
export type WordProgress = typeof wordProgress.$inferSelect;
export type Story = typeof stories.$inferSelect;
export type GameMap = typeof maps.$inferSelect;
export type MapFeature = typeof mapFeatures.$inferSelect;
export type Portal = typeof portals.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type CharacterMemory = typeof characterMemories.$inferSelect;
export type Relationship = typeof relationships.$inferSelect;
export type Enemy = typeof enemies.$inferSelect;
export type Encounter = typeof encounters.$inferSelect;
export type Quest = typeof quests.$inferSelect;
export type QuestObjective = typeof questObjectives.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type StoryChapter = typeof storyChapters.$inferSelect;
export type Passage = typeof passages.$inferSelect;
export type WorldEvent = typeof events.$inferSelect;
