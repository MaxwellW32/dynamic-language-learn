import type { Segment } from "./segments";
import type { ClientChallenge } from "./challenges/types";

/**
 * Everything the game client is allowed to see. These types are the contract
 * between server actions and UI components — no Drizzle rows cross this line,
 * and nothing here ever contains an answer key.
 */

export type WordEntry = {
    id: string;
    term: string;
    meaning: string;
    pronunciation: string | null;
};

export type ScenePlayer = { mapId: string; x: number; y: number };

export type SceneMap = {
    id: string;
    name: string;
    kind: "settlement" | "wilds" | "dungeon" | "interior";
    templateKey: string;
    biome: string;
    width: number;
    height: number;
};

export type SceneFeature = {
    id: string;
    kind: string;
    name: string;
    x: number;
    y: number;
    interactive: boolean;
};

export type ScenePortal = {
    id: string;
    x: number;
    y: number;
    label: string;
};

export type SceneCharacter = {
    id: string;
    name: string;
    role: string;
    mood: string;
    spriteKey: string;
    x: number;
    y: number;
    affinity: number;
};

export type SceneEnemy = {
    id: string;
    name: string;
    description: string;
    tier: "minion" | "elite" | "boss";
    spriteKey: string;
    status: "alive" | "defeated";
    x: number;
    y: number;
};

export type ScenePayload = {
    map: SceneMap;
    features: SceneFeature[];
    portals: ScenePortal[];
    characters: SceneCharacter[];
    enemies: SceneEnemy[];
    player: ScenePlayer;
};

export type PassageView = {
    id: string;
    kind: "narration" | "dialogue" | "event" | "discovery";
    segments: Segment[];
    /** speaker name for dialogue passages */
    speaker?: string;
};

export type QuestView = {
    id: string;
    title: string;
    description: string;
    status: "active" | "completed" | "failed";
    giverName: string | null;
    objectives: {
        id: string;
        description: string;
        status: "active" | "completed";
        progress: number;
        targetCount: number;
    }[];
};

export type ChapterView = {
    id: string;
    index: number;
    title: string;
    summary: string;
};

export type ChronicleEntry = {
    id: string;
    summary: string;
    at: string;
};

export type QuestUpdate = {
    questTitle: string;
    objectiveDescription: string;
    questCompleted: boolean;
};

export type MessageView = {
    id: string;
    speaker: "player" | "character";
    segments: Segment[];
};

export type DialogueState = {
    conversationId: string;
    character: SceneCharacter;
    voiceId: string;
    messages: MessageView[];
    words: WordEntry[];
};

export type DialogueTurnResult = {
    reply: MessageView;
    mood: string;
    affinity: number;
    words: WordEntry[];
    questUpdates: QuestUpdate[];
    chapterTurnReady: boolean;
};

export type EncounterView = {
    id: string;
    enemy: { id: string; name: string; tier: "minion" | "elite" | "boss"; spriteKey: string };
    introLine: string;
    hearts: number;
    stageIndex: number;
    totalStages: number;
    stage: ClientChallenge | null;
    words: WordEntry[];
};

export type AnswerResult = {
    correct: boolean;
    correctAnswer: string;
    hearts: number;
    status: "active" | "won" | "retreated";
    stageIndex: number;
    stage: ClientChallenge | null;
    victory: {
        defeatLine: string;
        passage: PassageView | null;
        words: WordEntry[];
        questUpdates: QuestUpdate[];
        chapterTurnReady: boolean;
    } | null;
};

export type NarrationResult = {
    /** null when only quest bookkeeping happened (e.g. revisiting a map) */
    passage: PassageView | null;
    words: WordEntry[];
    questUpdates: QuestUpdate[];
    chapterTurnReady: boolean;
};

export type TravelResult = {
    scene: ScenePayload;
    arrival: NarrationResult | null;
};

export type SatchelWordView = {
    id: string;
    term: string;
    meaning: string;
    pronunciation: string | null;
    mastery: number;
    due: boolean;
};

export type StoryOverview = {
    story: {
        id: string;
        title: string;
        premise: string;
        playerName: string;
        nativeLanguage: string;
        targetLanguage: string;
        arcStage: string;
        status: "forging" | "active" | "completed" | "abandoned";
    };
    scene: ScenePayload;
    quests: QuestView[];
    chapters: ChapterView[];
    passages: PassageView[];
    words: WordEntry[];
    satchel: SatchelWordView[];
    chronicle: ChronicleEntry[];
    activeEncounter: EncounterView | null;
    chapterTurnReady: boolean;
};

export type ChapterTurnResult = {
    closedChapter: ChapterView;
    newChapter: ChapterView;
    passage: PassageView;
    words: WordEntry[];
    quests: QuestView[];
    storyCompleted: boolean;
};
