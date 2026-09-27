import type { Segment } from "./segments";
import type { ClientChallenge } from "./challenges/types";
import type { WordCard } from "./dictionary";
import type { ActorLook, CreatureLook } from "./looks";
import type { GateSide, RegionKind } from "./worldgen/layout";

/**
 * Everything the game client is allowed to see. These types are the contract
 * between server actions and the UI — no database rows cross this line, and
 * nothing here ever contains an answer key.
 */

/* ------------------------------------------------------------------ */
/* the scene                                                           */
/* ------------------------------------------------------------------ */

export type SceneRegion = {
    id: string;
    name: string;
    kind: RegionKind;
    biome: string;
    timeOfDay: string;
    weather: string;
    seed: number;
    /** the sides with an open way out — part of what shapes the terrain */
    openSides: GateSide[];
    styleKit: string;
    description: string;
};

export type SceneBuilding = {
    id: string;
    kind: string;
    name: string;
    x: number;
    z: number;
    rot: number;
    width: number;
    depth: number;
    variant: number;
};

/** the word floating over something, in the language being learned */
export type WorldLabel = {
    entryId: number;
    text: string;
    /** reading or romanisation, for scripts a beginner cannot yet sound out */
    hint: string | null;
};

export type SceneLandmark = {
    id: string;
    kind: string;
    name: string;
    x: number;
    z: number;
    rot: number;
    label: WorldLabel | null;
    /** already examined: its passage is in the book and rereads for free */
    examined: boolean;
};

export type SceneGate = {
    id: string;
    side: GateSide;
    x: number;
    z: number;
    rot: number;
    label: string;
};

export type SceneCharacter = {
    id: string;
    name: string;
    role: string;
    mood: string;
    look: ActorLook;
    x: number;
    z: number;
    rot: number;
    affinity: number;
    /** short lines they call out as the hero passes */
    barks: Segment[][];
    /** an open quest objective points at them */
    sought: boolean;
    /** the hero has spoken with them before */
    met: boolean;
};

export type SceneEnemy = {
    id: string;
    name: string;
    description: string;
    tier: "minion" | "elite" | "boss";
    look: CreatureLook;
    x: number;
    z: number;
    /** an open quest objective points at it */
    sought: boolean;
};

export type SceneHero = {
    name: string;
    look: ActorLook;
    x: number;
    z: number;
    rot: number;
};

export type ScenePayload = {
    region: SceneRegion;
    buildings: SceneBuilding[];
    landmarks: SceneLandmark[];
    gates: SceneGate[];
    characters: SceneCharacter[];
    enemies: SceneEnemy[];
    hero: SceneHero;
};

/* ------------------------------------------------------------------ */
/* the book                                                            */
/* ------------------------------------------------------------------ */

/** a fork in the story */
export type PassageChoice = {
    key: string;
    /** what the reader would do, in a few words */
    label: Segment[];
    /** the flavour of the choice: "bold", "kind", "cautious", "curious"… */
    tone: string;
};

export type PassageView = {
    id: string;
    kind: "narration" | "discovery" | "event" | "choice";
    segments: Segment[];
    choices: PassageChoice[] | null;
    chosenKey: string | null;
    chapterIndex: number;
};

export type ChapterView = {
    id: string;
    index: number;
    title: string;
    summary: string;
};

export type ObjectiveKind = "talkTo" | "persuade" | "defeat" | "visit" | "inspect" | "learnWords";

export type QuestView = {
    id: string;
    title: string;
    description: string;
    status: "active" | "completed" | "failed";
    giverName: string | null;
    objectives: {
        id: string;
        description: string;
        kind: ObjectiveKind;
        status: "active" | "completed" | "failed";
        progress: number;
        targetCount: number;
        /** not yet its turn: an earlier step of the quest comes first */
        waiting: boolean;
        /** where to go: the region that holds the target, when it is not this one */
        whereName: string | null;
    }[];
};

export type QuestUpdate = {
    questTitle: string;
    objectiveDescription: string;
    questCompleted: boolean;
    /** a persuasion definitively refused — the quest is lost, the story moves on */
    failed?: boolean;
    /** a quest the story has just handed the hero */
    isNew?: boolean;
};

export type ChronicleEntry = {
    id: string;
    summary: string;
    at: string;
};

/* ------------------------------------------------------------------ */
/* dialogue                                                            */
/* ------------------------------------------------------------------ */

/** a reply the player may pick instead of typing */
export type DialogueOption = {
    key: string;
    /** what would be said; at higher levels this is in the language being learned */
    segments: Segment[];
    tone: string;
    /** the reply is written in the target language, so choosing it counts as practice */
    inTarget: boolean;
};

/** what a character's reply taught about the player's own attempt at the language */
export type LanguageNote = {
    /** "good": natural as written · "close": understood, with slips · "off": not understood */
    verdict: "good" | "close" | "off";
    /** how a native speaker would have put it, when that differs */
    better: string | null;
    /** one short, kind explanation of the most useful correction */
    tip: string | null;
};

export type MessageView = {
    id: string;
    speaker: "player" | "character";
    segments: Segment[];
    note: LanguageNote | null;
};

export type DialogueState = {
    conversationId: string;
    character: {
        id: string;
        name: string;
        role: string;
        mood: string;
        affinity: number;
        voiceId: string;
    };
    messages: MessageView[];
    options: DialogueOption[];
    words: WordCard[];
    /** true when the character has spoken first (a greeting written for this visit) */
    greeted: boolean;
};

export type DialogueTurnResult = {
    playerMessage: MessageView;
    reply: MessageView;
    options: DialogueOption[];
    mood: string;
    affinity: number;
    affinityDelta: number;
    words: WordCard[];
    questUpdates: QuestUpdate[];
    /** narration written into the book when this exchange resolved a quest */
    beat: PassageView | null;
    /** xp earned for producing the target language */
    xp: number;
    chapterTurnReady: boolean;
    wallet: WalletView;
};

/* ------------------------------------------------------------------ */
/* encounters                                                          */
/* ------------------------------------------------------------------ */

export type EncounterView = {
    id: string;
    enemy: { id: string; name: string; tier: "minion" | "elite" | "boss"; description: string };
    introLine: string;
    hearts: number;
    maxHearts: number;
    stageIndex: number;
    totalStages: number;
    stage: ClientChallenge | null;
    words: WordCard[];
};

export type AnswerResult = {
    correct: boolean;
    /** false when the answer was accepted despite a slip such as a missing accent */
    exact: boolean;
    correctAnswer: string;
    /** the word the stage was about, so a miss can show its card */
    taught: WordCard[];
    hearts: number;
    status: "active" | "won" | "retreated";
    stageIndex: number;
    stage: ClientChallenge | null;
    xp: number;
    victory: {
        defeatLine: string;
        passage: PassageView | null;
        words: WordCard[];
        questUpdates: QuestUpdate[];
        chapterTurnReady: boolean;
        /** words answered correctly for the first time in this battle */
        learned: WordCard[];
    } | null;
};

/* ------------------------------------------------------------------ */
/* narration, travel, the wallet                                       */
/* ------------------------------------------------------------------ */

export type NarrationResult = {
    /** null when only quest bookkeeping happened (e.g. revisiting a place) */
    passage: PassageView | null;
    words: WordCard[];
    questUpdates: QuestUpdate[];
    chapterTurnReady: boolean;
    wallet: WalletView;
};

export type TravelResult = {
    scene: ScenePayload;
    arrival: NarrationResult | null;
};

export type WalletView = {
    mode: "byok" | "credits" | null;
    /** millionths of a US dollar */
    balanceMicros: number;
    low: boolean;
};

export type SatchelWord = WordCard & {
    /** 0 unseen … 5 mastered */
    mastery: number;
    due: boolean;
    collected: boolean;
    timesSeen: number;
};

export type LearnerView = {
    lang: string;
    /** 0 Newcomer … 5 Immersed: how much of the book is written in the target language */
    immersion: number;
    immersionName: string;
    wordsMet: number;
    wordsKnown: number;
    wordsDue: number;
    xp: number;
    streakDays: number;
    /** progress toward the next immersion level, 0..1 */
    toNext: number;
    /** how boldly the learner asked their books to use the language: -1 cozy, 0 balanced, 1 bold */
    immersionBias: number;
};

/* ------------------------------------------------------------------ */
/* the study hall                                                      */
/* ------------------------------------------------------------------ */

export type StudyView = {
    id: string;
    lang: string;
    index: number;
    total: number;
    stage: ClientChallenge | null;
    words: WordCard[];
};

export type StudyAnswer = {
    correct: boolean;
    /** false when the answer was accepted despite a slip such as a missing accent */
    exact: boolean;
    correctAnswer: string;
    taught: WordCard[];
    index: number;
    total: number;
    stage: ClientChallenge | null;
    done: boolean;
    xp: number;
    /** present once the session is done */
    summary: { correct: number; total: number; learned: WordCard[] } | null;
};

export type BookOverview = {
    book: {
        id: string;
        title: string;
        premise: string;
        playerName: string;
        nativeLanguage: string;
        targetLanguage: string;
        arcStage: string;
        status: "forging" | "active" | "completed" | "abandoned";
        xp: number;
    };
    scene: ScenePayload;
    /** every region the hero has found, for the map in the journal */
    regions: { id: string; name: string; kind: RegionKind; biome: string; visited: boolean; current: boolean }[];
    quests: QuestView[];
    chapters: ChapterView[];
    passages: PassageView[];
    words: WordCard[];
    chronicle: ChronicleEntry[];
    learner: LearnerView;
    activeEncounter: EncounterView | null;
    chapterTurnReady: boolean;
    wallet: WalletView;
};

export type ChapterTurnResult = {
    closedChapter: ChapterView;
    newChapter: ChapterView;
    passage: PassageView;
    words: WordCard[];
    quests: QuestView[];
    scene: ScenePayload;
    regions: BookOverview["regions"];
    storyCompleted: boolean;
    wallet: WalletView;
};
