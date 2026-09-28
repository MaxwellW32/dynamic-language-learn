import type { Segment } from "./segments";
import type { ClientChallenge } from "./challenges/types";
import type { WordCard } from "./dictionary";
import type { GoalKind } from "./goals";
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
    /** the goal in hand is to examine it */
    sought: boolean;
};

export type SceneGate = {
    id: string;
    side: GateSide;
    x: number;
    z: number;
    rot: number;
    label: string;
    /** the goal in hand lies through it */
    sought: boolean;
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
    /** the goal in hand points at them */
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
    /** the goal in hand points at it */
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

export type PassageView = {
    id: string;
    /** narration: what the storyteller told · discovery: what the hero found by looking */
    kind: "narration" | "discovery" | "event" | "choice";
    segments: Segment[];
    chapterIndex: number;
};

/** a chapter the hero has reached; those still ahead are never sent */
export type ChapterView = {
    id: string;
    index: number;
    title: string;
    summary: string;
    open: boolean;
};

/** the kinds of goal a reader is shown: everything but what the storyteller tells */
export type ShownGoalKind = Exclude<GoalKind, "tell">;

export type GoalView = {
    id: string;
    kind: ShownGoalKind;
    title: string;
    status: "active" | "done" | "failed";
    /** how it ended, in a line; empty while it is in hand */
    outcome: string;
    /** where to go: the region that holds what it points at, when that is not this one */
    whereName: string | null;
    /** who or what it points at, by name */
    targetName: string | null;
};

/** a place to walk to, marked in the world by a column of light */
export type Beacon = {
    goalId: string;
    regionId: string;
    x: number;
    z: number;
    /** how near counts as having arrived */
    radius: number;
    name: string;
};

/**
 * What the book will do next without being asked:
 * page: the storyteller has something to tell · bend: a goal failed and the
 * road ahead is to be written again · plan: the chapter's goals are to be
 * written · turn: the chapter is over, and waits for the page to be turned ·
 * null: the goal in hand is the reader's to do.
 */
export type StoryDue = "page" | "bend" | "plan" | "turn" | null;

export type StoryState = {
    chapter: { id: string; index: number; title: string; of: number };
    /** this chapter's goals, in order: what is settled and what is in hand */
    goals: GoalView[];
    /** how many more the chapter holds after the one in hand */
    ahead: number;
    due: StoryDue;
    beacon: Beacon | null;
    /** what the hero has come by and still carries */
    carrying: string[];
};

/** a goal has just ended, one way or the other */
export type GoalSettled = {
    goalId: string;
    title: string;
    status: "done" | "failed";
    outcome: string;
};

export type ChronicleEntry = {
    id: string;
    summary: string;
    at: string;
};

/** someone the hero has met, and may write to from anywhere */
export type PersonView = {
    id: string;
    name: string;
    role: string;
    mood: string;
    affinity: number;
    likes: string[];
    dislikes: string[];
    whereName: string | null;
    /** in the region the hero is in */
    here: boolean;
    /** has left the story: what they said can be reread, but they cannot be written to */
    gone: boolean;
    /** how many lines have passed between them and the hero */
    lines: number;
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

/**
 * What the hero has come to someone for, when the goal in hand is theirs to
 * settle. They answer for themselves: when asked, or of their own accord if
 * they are won — or have had enough.
 */
export type Stake = {
    goalId: string;
    kind: "talk" | "persuade";
    title: string;
    /** persuade: where they stand, -5 … 5; null when there is nothing to be swayed on */
    lean: number | null;
    /** the hero has said enough for an answer to be asked for */
    canAsk: boolean;
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
        likes: string[];
        dislikes: string[];
    };
    messages: MessageView[];
    options: DialogueOption[];
    words: WordCard[];
    /** true when the character has spoken first (a greeting written for this visit) */
    greeted: boolean;
    stake: Stake | null;
    /** the two are not in the same place: words pass between them from afar, and no goal can be settled */
    remote: boolean;
};

export type DialogueTurnResult = {
    playerMessage: MessageView;
    reply: MessageView;
    options: DialogueOption[];
    mood: string;
    affinity: number;
    affinityDelta: number;
    words: WordCard[];
    /** xp earned for producing the target language */
    xp: number;
    /** what is still at stake after this exchange; null when nothing is, or when it has just been settled */
    stake: Stake | null;
    /** they gave their answer in this exchange */
    settled: GoalSettled | null;
    story: StoryState;
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
    /** the goal in hand is to best this creature: being driven back will end it */
    atStake: string | null;
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
        /** words answered correctly for the first time in this battle */
        learned: WordCard[];
    } | null;
    /** the battle was the goal in hand, and has settled it: won, or lost */
    settled: GoalSettled | null;
    /** present once the battle is over */
    story: StoryState | null;
};

/* ------------------------------------------------------------------ */
/* the story moving, travel, the wallet                                */
/* ------------------------------------------------------------------ */

/** what the storyteller wrote, and how the story stands after it */
export type StoryStep = {
    /** in the order they are to be read; empty when nothing was told */
    pages: PassageView[];
    words: WordCard[];
    story: StoryState;
    /** the region as it now is: people may have come, gone or moved */
    scene: ScenePayload;
    regions: BookOverview["regions"];
    people: PersonView[];
    settled: GoalSettled | null;
    wallet: WalletView;
};

/** the hero bent down to look at something */
export type ExamineResult = {
    page: PassageView | null;
    words: WordCard[];
    story: StoryState;
    /** looking at it was the goal in hand */
    settled: GoalSettled | null;
    wallet: WalletView;
};

/** the hero walked up to where a goal sent them */
export type ReachResult = {
    story: StoryState;
    settled: GoalSettled | null;
};

export type TravelResult = {
    scene: ScenePayload;
    story: StoryState;
    /** arriving was the goal in hand */
    settled: GoalSettled | null;
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
    story: StoryState;
    people: PersonView[];
    chapters: ChapterView[];
    passages: PassageView[];
    words: WordCard[];
    chronicle: ChronicleEntry[];
    learner: LearnerView;
    activeEncounter: EncounterView | null;
    wallet: WalletView;
};

export type ChapterTurnResult = StoryStep & {
    closedChapter: ChapterView;
    /** null when the chapter that closed was the last */
    newChapter: ChapterView | null;
    chapters: ChapterView[];
    storyCompleted: boolean;
};
