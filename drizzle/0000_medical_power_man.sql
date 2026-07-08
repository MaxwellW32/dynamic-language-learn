CREATE TYPE "public"."arc_stage" AS ENUM('introduction', 'rising', 'climax', 'falling', 'resolution');--> statement-breakpoint
CREATE TYPE "public"."character_status" AS ENUM('alive', 'dead', 'missing');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('active', 'won', 'retreated');--> statement-breakpoint
CREATE TYPE "public"."enemy_status" AS ENUM('alive', 'defeated');--> statement-breakpoint
CREATE TYPE "public"."enemy_tier" AS ENUM('minion', 'elite', 'boss');--> statement-breakpoint
CREATE TYPE "public"."map_kind" AS ENUM('settlement', 'wilds', 'dungeon', 'interior');--> statement-breakpoint
CREATE TYPE "public"."memory_kind" AS ENUM('conversation', 'event', 'fact');--> statement-breakpoint
CREATE TYPE "public"."objective_kind" AS ENUM('talkTo', 'persuade', 'defeat', 'visit', 'learnWords', 'custom');--> statement-breakpoint
CREATE TYPE "public"."objective_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."passage_kind" AS ENUM('narration', 'dialogue', 'event', 'discovery');--> statement-breakpoint
CREATE TYPE "public"."quest_status" AS ENUM('active', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."speaker" AS ENUM('player', 'character');--> statement-breakpoint
CREATE TYPE "public"."story_status" AS ENUM('forging', 'active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text
);
--> statement-breakpoint
CREATE TABLE "authenticator" (
	"credentialID" text NOT NULL,
	"userId" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"credentialPublicKey" text NOT NULL,
	"counter" integer NOT NULL,
	"credentialDeviceType" text NOT NULL,
	"credentialBackedUp" boolean NOT NULL,
	"transports" text,
	CONSTRAINT "authenticator_credentialID_unique" UNIQUE("credentialID")
);
--> statement-breakpoint
CREATE TABLE "challenge_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"storyId" text,
	"encounterId" text,
	"wordId" text,
	"challengeType" text NOT NULL,
	"correct" boolean NOT NULL,
	"answerGiven" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"characterId" text NOT NULL,
	"kind" "memory_kind" DEFAULT 'event' NOT NULL,
	"content" text NOT NULL,
	"importance" integer DEFAULT 5 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"mapId" text,
	"x" real DEFAULT 0 NOT NULL,
	"y" real DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"personality" text NOT NULL,
	"appearance" text NOT NULL,
	"backstory" text DEFAULT '' NOT NULL,
	"mood" text DEFAULT 'neutral' NOT NULL,
	"voiceId" text DEFAULT 'alloy' NOT NULL,
	"spriteKey" text DEFAULT 'npc' NOT NULL,
	"status" character_status DEFAULT 'alive' NOT NULL,
	"isCompanion" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"characterId" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"lastMessageAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"enemyId" text NOT NULL,
	"status" "encounter_status" DEFAULT 'active' NOT NULL,
	"stages" json DEFAULT '[]'::json NOT NULL,
	"stageIndex" integer DEFAULT 0 NOT NULL,
	"hearts" integer DEFAULT 3 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"endedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "enemies" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"mapId" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tier" "enemy_tier" DEFAULT 'minion' NOT NULL,
	"spriteKey" text DEFAULT 'enemy' NOT NULL,
	"introLine" text DEFAULT '' NOT NULL,
	"defeatLine" text DEFAULT '' NOT NULL,
	"challengeTypes" json DEFAULT '[]'::json NOT NULL,
	"status" "enemy_status" DEFAULT 'alive' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"mapId" text,
	"characterId" text,
	"data" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_features" (
	"id" text PRIMARY KEY NOT NULL,
	"mapId" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"lore" text DEFAULT '' NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"interactive" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maps" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"name" text NOT NULL,
	"kind" "map_kind" NOT NULL,
	"templateKey" text NOT NULL,
	"biome" text DEFAULT '' NOT NULL,
	"ambience" text DEFAULT '' NOT NULL,
	"width" real NOT NULL,
	"height" real NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"speaker" "speaker" NOT NULL,
	"segments" json DEFAULT '[]'::json NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"chapterId" text NOT NULL,
	"kind" "passage_kind" DEFAULT 'narration' NOT NULL,
	"segments" json DEFAULT '[]'::json NOT NULL,
	"mapId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portals" (
	"id" text PRIMARY KEY NOT NULL,
	"mapId" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"label" text NOT NULL,
	"targetMapId" text NOT NULL,
	"targetX" real NOT NULL,
	"targetY" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_objectives" (
	"id" text PRIMARY KEY NOT NULL,
	"questId" text NOT NULL,
	"description" text NOT NULL,
	"kind" "objective_kind" NOT NULL,
	"targetCharacterId" text,
	"targetEnemyId" text,
	"targetMapId" text,
	"targetCount" integer DEFAULT 1 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"status" "objective_status" DEFAULT 'active' NOT NULL,
	"sortIndex" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"arcStage" "arc_stage" DEFAULT 'introduction' NOT NULL,
	"giverCharacterId" text,
	"status" "quest_status" DEFAULT 'active' NOT NULL,
	"sortIndex" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"characterId" text PRIMARY KEY NOT NULL,
	"affinity" integer DEFAULT 0 NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"title" text NOT NULL,
	"premise" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT 'cozy adventure' NOT NULL,
	"nativeLanguage" text NOT NULL,
	"targetLanguage" text NOT NULL,
	"targetDialect" text,
	"playerName" text NOT NULL,
	"status" "story_status" DEFAULT 'forging' NOT NULL,
	"forgeNote" text DEFAULT '' NOT NULL,
	"arcStage" "arc_stage" DEFAULT 'introduction' NOT NULL,
	"currentMapId" text,
	"x" real DEFAULT 0 NOT NULL,
	"y" real DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"index" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_packs" (
	"storyId" text NOT NULL,
	"packId" text NOT NULL,
	CONSTRAINT "story_packs_storyId_packId_pk" PRIMARY KEY("storyId","packId")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	"nativeLanguage" text DEFAULT 'english' NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocab_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"nativeLanguage" text NOT NULL,
	"targetLanguage" text NOT NULL,
	"targetDialect" text,
	"coverEmoji" text DEFAULT '📖' NOT NULL,
	"isBuiltIn" boolean DEFAULT false NOT NULL,
	"createdBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vocab_packs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "vocab_words" (
	"id" text PRIMARY KEY NOT NULL,
	"packId" text NOT NULL,
	"term" text NOT NULL,
	"meaning" text NOT NULL,
	"pronunciation" text,
	"partOfSpeech" text,
	"exampleTarget" text,
	"exampleNative" text,
	"sortIndex" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"wordId" text NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"intervalDays" real DEFAULT 0 NOT NULL,
	"dueAt" timestamp DEFAULT now() NOT NULL,
	"lastReviewedAt" timestamp,
	"timesSeen" integer DEFAULT 0 NOT NULL,
	"timesCorrect" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authenticator" ADD CONSTRAINT "authenticator_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_encounterId_encounters_id_fk" FOREIGN KEY ("encounterId") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_wordId_vocab_words_id_fk" FOREIGN KEY ("wordId") REFERENCES "public"."vocab_words"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_memories" ADD CONSTRAINT "character_memories_characterId_characters_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_mapId_maps_id_fk" FOREIGN KEY ("mapId") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_characterId_characters_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_enemyId_enemies_id_fk" FOREIGN KEY ("enemyId") REFERENCES "public"."enemies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enemies" ADD CONSTRAINT "enemies_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enemies" ADD CONSTRAINT "enemies_mapId_maps_id_fk" FOREIGN KEY ("mapId") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_mapId_maps_id_fk" FOREIGN KEY ("mapId") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_characterId_characters_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_features" ADD CONSTRAINT "map_features_mapId_maps_id_fk" FOREIGN KEY ("mapId") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maps" ADD CONSTRAINT "maps_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_conversations_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_chapterId_story_chapters_id_fk" FOREIGN KEY ("chapterId") REFERENCES "public"."story_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_mapId_maps_id_fk" FOREIGN KEY ("mapId") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_mapId_maps_id_fk" FOREIGN KEY ("mapId") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_targetMapId_maps_id_fk" FOREIGN KEY ("targetMapId") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_objectives" ADD CONSTRAINT "quest_objectives_questId_quests_id_fk" FOREIGN KEY ("questId") REFERENCES "public"."quests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_objectives" ADD CONSTRAINT "quest_objectives_targetCharacterId_characters_id_fk" FOREIGN KEY ("targetCharacterId") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_objectives" ADD CONSTRAINT "quest_objectives_targetEnemyId_enemies_id_fk" FOREIGN KEY ("targetEnemyId") REFERENCES "public"."enemies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_objectives" ADD CONSTRAINT "quest_objectives_targetMapId_maps_id_fk" FOREIGN KEY ("targetMapId") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_giverCharacterId_characters_id_fk" FOREIGN KEY ("giverCharacterId") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_characterId_characters_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_currentMapId_maps_id_fk" FOREIGN KEY ("currentMapId") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_chapters" ADD CONSTRAINT "story_chapters_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_packs" ADD CONSTRAINT "story_packs_storyId_stories_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_packs" ADD CONSTRAINT "story_packs_packId_vocab_packs_id_fk" FOREIGN KEY ("packId") REFERENCES "public"."vocab_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_packs" ADD CONSTRAINT "vocab_packs_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_words" ADD CONSTRAINT "vocab_words_packId_vocab_packs_id_fk" FOREIGN KEY ("packId") REFERENCES "public"."vocab_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_progress" ADD CONSTRAINT "word_progress_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_progress" ADD CONSTRAINT "word_progress_wordId_vocab_words_id_fk" FOREIGN KEY ("wordId") REFERENCES "public"."vocab_words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challengeAttempts_userId_idx" ON "challenge_attempts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "characterMemories_characterId_idx" ON "character_memories" USING btree ("characterId");--> statement-breakpoint
CREATE INDEX "characters_storyId_idx" ON "characters" USING btree ("storyId");--> statement-breakpoint
CREATE INDEX "characters_mapId_idx" ON "characters" USING btree ("mapId");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_story_character_idx" ON "conversations" USING btree ("storyId","characterId");--> statement-breakpoint
CREATE INDEX "encounters_storyId_idx" ON "encounters" USING btree ("storyId");--> statement-breakpoint
CREATE INDEX "enemies_storyId_idx" ON "enemies" USING btree ("storyId");--> statement-breakpoint
CREATE INDEX "enemies_mapId_idx" ON "enemies" USING btree ("mapId");--> statement-breakpoint
CREATE INDEX "events_story_created_idx" ON "events" USING btree ("storyId","createdAt");--> statement-breakpoint
CREATE INDEX "mapFeatures_mapId_idx" ON "map_features" USING btree ("mapId");--> statement-breakpoint
CREATE INDEX "maps_storyId_idx" ON "maps" USING btree ("storyId");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversationId","createdAt");--> statement-breakpoint
CREATE INDEX "passages_storyId_idx" ON "passages" USING btree ("storyId");--> statement-breakpoint
CREATE INDEX "passages_chapterId_idx" ON "passages" USING btree ("chapterId");--> statement-breakpoint
CREATE INDEX "portals_mapId_idx" ON "portals" USING btree ("mapId");--> statement-breakpoint
CREATE INDEX "questObjectives_questId_idx" ON "quest_objectives" USING btree ("questId");--> statement-breakpoint
CREATE INDEX "quests_storyId_idx" ON "quests" USING btree ("storyId");--> statement-breakpoint
CREATE INDEX "stories_userId_idx" ON "stories" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "storyChapters_storyId_idx" ON "story_chapters" USING btree ("storyId");--> statement-breakpoint
CREATE INDEX "vocabWords_packId_idx" ON "vocab_words" USING btree ("packId");--> statement-breakpoint
CREATE UNIQUE INDEX "wordProgress_user_word_idx" ON "word_progress" USING btree ("userId","wordId");--> statement-breakpoint
CREATE INDEX "wordProgress_user_due_idx" ON "word_progress" USING btree ("userId","dueAt");