"use server";

import { z } from "zod";
import { requireStory } from "../auth";
import { getScene, syncPosition, travelThroughPortal } from "../services/scene";
import { handleArrival, inspectFeature } from "../services/story";
import { openDialogue, sendDialogue } from "../services/dialogue";
import { fleeEncounter, getActiveEncounter, startEncounter, submitAnswer } from "../services/encounters";
import { recordExposure } from "../services/learning";
import { submissionSchema } from "@/game/challenges/types";
import type {
    AnswerResult, DialogueState, DialogueTurnResult, EncounterView,
    NarrationResult, TravelResult,
} from "@/game/payloads";

const id = z.string().min(1);
const point = z.object({ x: z.number().finite(), y: z.number().finite() });
type Point = z.infer<typeof point>;

/** throttled position sync — cosmetic, but keeps proximity checks honest across devices */
export async function syncPositionAction(storyId: string, p: Point): Promise<void> {
    const { story } = await requireStory(id.parse(storyId));
    await syncPosition(story, point.parse(p));
}

export async function enterPortalAction(storyId: string, portalId: string, at: Point): Promise<TravelResult> {
    const { userId, story } = await requireStory(id.parse(storyId));
    const here = await syncPosition(story, point.parse(at));
    const { map, x, y } = await travelThroughPortal(here, id.parse(portalId));
    const moved = { ...here, currentMapId: map.id, x, y };
    return {
        scene: await getScene(moved),
        arrival: await handleArrival(userId, moved, map.id),
    };
}

export async function inspectFeatureAction(storyId: string, featureId: string, at: Point): Promise<NarrationResult> {
    const { userId, story } = await requireStory(id.parse(storyId));
    const here = await syncPosition(story, point.parse(at));
    return inspectFeature(userId, here, id.parse(featureId));
}

export async function openDialogueAction(storyId: string, characterId: string, at: Point): Promise<DialogueState> {
    const { story } = await requireStory(id.parse(storyId));
    const here = await syncPosition(story, point.parse(at));
    return openDialogue(here, id.parse(characterId));
}

export async function sendDialogueAction(
    storyId: string,
    characterId: string,
    text: string,
): Promise<DialogueTurnResult> {
    const { userId, story } = await requireStory(id.parse(storyId));
    return sendDialogue(userId, story, id.parse(characterId), z.string().min(1).max(600).parse(text));
}

export async function startEncounterAction(storyId: string, enemyId: string, at: Point): Promise<EncounterView> {
    const { userId, story } = await requireStory(id.parse(storyId));
    const here = await syncPosition(story, point.parse(at));
    return startEncounter(userId, here, id.parse(enemyId));
}

export async function resumeEncounterAction(storyId: string): Promise<EncounterView | null> {
    const { story } = await requireStory(id.parse(storyId));
    return getActiveEncounter(story);
}

export async function fleeEncounterAction(storyId: string, encounterId: string): Promise<void> {
    const { story } = await requireStory(id.parse(storyId));
    await fleeEncounter(story, id.parse(encounterId));
}

export async function submitAnswerAction(
    storyId: string,
    encounterId: string,
    submission: unknown,
): Promise<AnswerResult> {
    const { userId, story } = await requireStory(id.parse(storyId));
    return submitAnswer(userId, story, id.parse(encounterId), submissionSchema.parse(submission));
}

/** the reader tapped a word — count the exposure */
export async function tapWordAction(storyId: string, wordId: string): Promise<void> {
    const { userId } = await requireStory(id.parse(storyId));
    await recordExposure(userId, [id.parse(wordId)]);
}
