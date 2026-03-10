"use server"
import { db } from "@/db"
import { chapters } from "@/db/schema"
import { chosenGptModel, openai } from "@/lib/openai"
import { areaConnectionType, bookType, chapterSchema, chapterType, characterType, goalType, locationType, makeChapterSectionsResponseSchema, makeChapterSectionsResponseType, makeChatMessagesResponseSchema, makeChatMessagesResponseType, newChapterSchema, newChapterType, sectionChatMessageType, sectionLoaderType, sectionType, tableFilterTypes } from "@/types"
import { makeWhereClauses } from "@/utility/utility"
import { and, asc, eq, SQLWrapper } from "drizzle-orm"
import { v4 } from "uuid"
import { zodTextFormat } from "openai/helpers/zod";
import { defaultText } from "@/lib/defaultData"

export async function addChapter(newChapterObj: newChapterType) {
    //validation
    const validatedChapter = newChapterSchema.parse(newChapterObj)

    //add new chapter
    const [addedChapter] = await db.insert(chapters).values({
        ...validatedChapter
    }).returning()

    return addedChapter
}

export async function updateChapter(chapterId: chapterType["id"], updatedChapterObj: Partial<chapterType>) {
    //validation
    const validatedUpdatedChapter = chapterSchema.partial().parse(updatedChapterObj)

    //auth
    //userId

    //update
    await db.update(chapters)
        .set({
            ...validatedUpdatedChapter
        })
        .where(eq(chapters.id, chapterId))
}

export async function deleteChapter(chapterId: chapterType["id"]) {
    //auth check

    //validation
    chapterSchema.shape.id.parse(chapterId)

    await db.delete(chapters).where(eq(chapters.id, chapterId));
}

export async function getSpecificChapter(chapterId: chapterType["id"], runAuth = true): Promise<chapterType | undefined> {
    if (runAuth) {
        //auth check
    }

    chapterSchema.shape.id.parse(chapterId)

    const result = await db.query.chapters.findFirst({
        where: eq(chapters.id, chapterId),
    });

    return result
}

export async function getChapters(filter: tableFilterTypes<chapterType>, getWith?: { [key in keyof chapterType]?: true }, limit = 50, offset = 0): Promise<chapterType[]> {
    // Auth check

    //compile filters into proper where clauses
    const whereClauses: SQLWrapper[] = makeWhereClauses(chapterSchema.partial(), filter, chapters)

    const results = await db.query.chapters.findMany({
        where: and(...whereClauses),
        limit,
        offset,
        orderBy: [asc(chapters.index)],
        with: getWith === undefined ? undefined : {
            fromBook: getWith.fromBook,
        }
    });

    return results;
}

//gpt
export async function makeChapterSections({ storyPremise, characters, goals, locations, areaConnections, prevSections, currentChapter, sectionLoader }: { storyPremise: bookType["storyPremise"], characters: characterType[], goals: goalType[], locations: locationType[], areaConnections: areaConnectionType[], prevSections: sectionType[], currentChapter: chapterType, sectionLoader: sectionLoaderType }): Promise<makeChapterSectionsResponseType> {
    const instructions = `You are a serialized narrative engine writing the next story sections.

    Your task:
    Continue the story using the provided context and game state.
    Write structured sections that move the player toward active goals.
    
    CORE DESIGN RULES:

    1. Story Direction
    - The storyPremise defines the expected overall direction.
    - Goals define what the player is actively trying to accomplish.
    - Each section must meaningfully progress at least one active goal.
    - Do not stall progression unless building tension intentionally.

    2. Continuity
    - Use prevSections to avoid repetition.
    - Do not restate previously described environments unless something has changed.
    - Maintain emotional, physical, and narrative continuity.
    - Character knowledge must remain consistent with past events.

    3. Characters
    - The player character is the user.
    - Characters with location "with-player" are traveling companions → Include them in dialogue, reactions, or decisions.
    - Characters in the same area may appear naturally in scenes.
    - Do not invent new characters.
    - Preserve personality consistency.
    - Dialogue should reflect goals and current tension.

    4. Goals
    - Identify which goals are incomplete.
    - Prioritize subGoals that are achievable in the current area.
    - If a defeat-character goal exists and the character is present, escalate tension.
    - If an interactive goal exists, create opportunity for dialogue.

    5. Locations & Travel
    - The current area is where the scene begins.
    - Adjacent areas are defined in areaConnections.
    - If traveling, describe movement using the visual descriptions of the areaConnections connecting them.
    - Travel should feel physical and atmospheric.
    - Do not teleport the player without narrative transition.

    6. Section Types - A section may be:
    A) exposition
    - Primary story narration.
    - Advance plot, tension, or discovery.
    - Avoid filler introspection.
    - Write vividly but efficiently.
    - Visual object is OPTIONAL.
    - Only include visual for peak cinematic moments.

    B) chat
    - This is a personal chat room between the user "player" and other characters - managed by a different AI
    - The user will fill this with messages later - so leave empty
    - Simply include the character Id's you think would be needed between involved characters

    7. Visual Rules
    - Use visual.description only for strong visual beats:
      - Major reveals
      - First arrival in a striking location
      - Boss confrontation
      - Emotional turning points
    - Do NOT overuse visuals.
    - Most sections should not include a visual.

    8. Pacing
    - Return 2–5 sections.
    - At least one section must meaningfully move a goal forward.
    - Avoid ending mid-conversation unless intentional cliffhanger.
    - Do not resolve the entire story unless goals indicate finale.

    9. Technical Constraints
    - Do not invent IDs.
    - Only use provided characterIds.
    - Stay consistent with provided data.
    - No commentary outside structured response.

    10. World State Changes
        You may return changes that modify characters or goals based on what occurred in the sections you wrote.
        Changes must be logical consequences of the narrative. Do not invent arbitrary updates.
        You may include zero or more changes.

        A) Character Changes (character-change)
            Use this when events in the chapter meaningfully alter a character.
            You may update:
            location (if non player characters join/leave the player)
            status
            skillsAndAbilities (gained, lost, altered)
            likes / dislikes (if shifted by events)
            memories (new important memory formed)

            Examples of valid triggers:
            A character joins the player → update location to "with-player".
            A mob is defeated → update status.
            A traumatic revelation → add a new memory.
            A betrayal → modify dislikes.

        B) Player changes
        ${sectionLoader !== undefined && sectionLoader.wantedAreaId !== undefined && (`
            Location:
            Use this when player wants to move locations, decide whether you'll grant the location change or not depending on the circumstances. If granted please add an entry to the changes array changeObj:"player-change", playerChangeObj:"location" and assign the newAreaId: ${sectionLoader.wantedAreaId}. If not give a rejection reason if player can't change location. e.g still fighting dragon boss.`)}
            
        C) Sub-goal Changes
            Use this when a sub-goal meaningfully progresses or fails.
            You may:
            Mark as success

            Mark as failed only if the narrative makes the original objective impossible or fundamentally altered.
            Provide newSubGoals that redefine how the main goal can now be achieved.
            New subGoals must provide another way to accomplish main goal

        ${currentChapter.name === defaultText ? (` d) Chapter changes
            Please add an entry to the changes array. changeObj:"chapter-change", chapterChangeObj:"name" - come up with a creative name for this chapter.
    `) : ""}

    11. Chapter handling
        Generated sections mainly belong to the current chapter, which is centered around the current MAIN goal (not the subgoal).
        Only start a new chapter if the sections introduce a major narrative shift (new arc, setting change, tonal shift, or significant progression).

        If a new chapter is truly warranted, fill out the "forNewChapter" object with a short, creative thematic title based on the next goal. Use this sparingly. Most sections should remain within the current chapter.

    Note:
    Only modify characters that appeared or were directly affected.
    Changes must reflect what clearly happened in the sections.
    Do not rewrite entire character profiles unnecessarily.
    Keep updates minimal and precise.
    Never modify unrelated characters or goals.
    Changes must reflect what clearly happened in the sections.

    Story Premise:
    ${JSON.stringify(storyPremise)}

    Characters:
    ${JSON.stringify(characters)}

    Goals:
    ${JSON.stringify(goals)}

    Locations:
    ${JSON.stringify(locations)}

    Area Connections:
    ${JSON.stringify(areaConnections)}

    Previous Sections:
    ${JSON.stringify(prevSections)}`
    console.log(`$instructions`, instructions);

    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: instructions,
        input: `Generate the next sections of the story.

    Continue naturally from the previous sections.
    Progress the player toward active goals.
    Respect character locations, area connections, and world state.

    Return sections and any valid world state changes.`,
        text: {
            format: zodTextFormat(makeChapterSectionsResponseSchema, "makeChapterSectionsResponse"),
        },
    });

    //validate
    const validatedResponse = makeChapterSectionsResponseSchema.parse(response.output_parsed)

    return validatedResponse
}

export async function makeChatMessagesResponse({ storyPremise, characters, goals, locations, areaConnections, prevSections, prevChatMessages }: { storyPremise: bookType["storyPremise"], characters: characterType[], goals: goalType[], locations: locationType[], areaConnections: areaConnectionType[], prevSections: sectionType[], prevChatMessages: sectionChatMessageType[] }): Promise<makeChatMessagesResponseType> {
    const instructions = `You are generating in-world character chat responses in a live conversation.
This should feel like Character AI (c.ai) — emotionally engaging, immersive, personal.

Your role:
Continue the conversation ONLY as non-player characters.
NEVER generate dialogue for the player character (type: "player"). The player is the user.

CORE BEHAVIOR RULES
1) Character Authenticity
- Each character must speak in a voice consistent with their personality, background, emotional state, and past actions.
- Preserve tone, speech quirks, vocabulary style, and emotional tendencies.
- Characters should react dynamically to what the player says.
- Avoid generic responses. Make each character feel distinct and alive.

2) Emotional Depth
- Build connection with the player.
- Allow vulnerability, tension, humor, suspicion, attraction, rivalry, etc. where appropriate.
- Characters should remember how the player treats them.
- Emotional reactions should evolve naturally over time.

3) Continuity
- Use prevChatMessages to continue the exact ongoing conversation.
- Maintain narrative, emotional, and factual consistency.
- Do not contradict established events, knowledge, or relationships.
- Characters cannot reference information they do not know.

4) Goals Awareness
- Be aware of the player’s current goals.
- If a goal involves interacting with a character, subtly steer conversation toward meaningful progression.
- Do not mechanically state goals unless it fits naturally in dialogue.

5) World Awareness
- Respect current location and areaConnections.
- Characters cannot teleport or reference places they are not present in.
- Keep the scene grounded in the current area.

6) Immersion
- No meta commentary.
- No narrator voice unless a character would naturally describe something.
- No system explanations.
- Keep everything in-character.

7) Output Structure
- Return only structured chat messages.
- Use only existing characterIds.
- Do NOT invent characters or IDs.
- Do NOT include commentary outside the structured response.

8) Pacing
- Return as many messages as feel natural for the moment.
- Conversations can be short or layered depending on emotional intensity.
- Allow pauses, tension, interruptions if appropriate.

WORLD CONTEXT:
Story Premise:
${JSON.stringify(storyPremise)}

Characters:
${JSON.stringify(characters)}

Goals:
${JSON.stringify(goals)}

Locations:
${JSON.stringify(locations)}

Area Connections:
${JSON.stringify(areaConnections)}

Previous Sections:
${JSON.stringify(prevSections)}

Previous Chat Messages:
${JSON.stringify(prevChatMessages)}
`
    console.log(`$instructions`, instructions);

    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: instructions,
        input: `Generate the next chat responses in this scene.

Deepen emotional connection where natural.
React to the player’s last message meaningfully.
Keep personality, tension, and goals in mind.
Keep responses immersive and character-driven.`,
        text: {
            format: zodTextFormat(makeChatMessagesResponseSchema, "makeChatMessagesResponse"),
        },
    });

    //validate
    const validatedResponse = makeChatMessagesResponseSchema.parse(response.output_parsed)

    return validatedResponse
}