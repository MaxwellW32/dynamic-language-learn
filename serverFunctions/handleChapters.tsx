"use server"
import { db } from "@/db"
import { chapters } from "@/db/schema"
import { chosenGptModel, openai } from "@/lib/openai"
import { bookType, chapterSchema, chapterType, characterType, chosenLanguageOptionType, dictionaryJSONType, goalType, makeGradeInteractiveSubGoalResponseType, interactedLanguageLessonsType, locationType, makeChapterSectionsResponseSchema, makeChapterSectionsResponseType, newChapterSchema, newChapterType, sectionChatMessageType, sectionType, tableFilterTypes, translatableTextType, makeGradeInteractiveSubGoalResponseSchema, makeChatMessagesResponseSchema, makeChatMessagesResponseType } from "@/types"
import { makeWhereClauses } from "@/utility/utility"
import { and, asc, eq, SQLWrapper } from "drizzle-orm"
import { v4 as uuidV4 } from "uuid"
import { zodTextFormat } from "openai/helpers/zod";
import { defaultText } from "@/lib/defaultData"
import { getLatestGoalSubGoal, makeNativeTargetKey } from "@/utility/contextHelpers"

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
        orderBy: [asc(chapters.dateCreated)],
        with: getWith === undefined ? undefined : {
            fromBook: getWith.fromBook,
        }
    });

    return results;
}

function makeNewWordsString(context: contextType) {
    const seenNativeTargetKey = makeNativeTargetKey(context.nativeLanguage, context.targetLanguage)
    console.log(`$seenNativeTargetKey`, seenNativeTargetKey);

    const reducedDictObj = Object.fromEntries(Object.entries(context.interactedLanguageLessons[seenNativeTargetKey].dictionary.new).slice(0, 20).map(eachDictionaryEntry => {
        //reduce to word only
        eachDictionaryEntry[1] = { word: eachDictionaryEntry[1].word } as dictionaryJSONType["KEY"]

        return eachDictionaryEntry
    }))

    return `${JSON.stringify(reducedDictObj)}`
}

type contextType = {
    nativeLanguage: chosenLanguageOptionType,
    targetLanguage: chosenLanguageOptionType,
    storyPremise: bookType["storyPremise"],
    characters: characterType[],
    goals: goalType[],
    locations: locationType[],
    prevSections: sectionType[],
    interactedLanguageLessons: interactedLanguageLessonsType,
    masteryLevel: number
}

function fixUpTranslatableText(textArr: translatableTextType[], context: contextType) {
    //assign proper language to chosen words
    return textArr.map(eachTextArray => {
        if (typeof eachTextArray === "object") {
            eachTextArray.languageName = context.targetLanguage.name
            eachTextArray.languageDialect = context.targetLanguage.dialect === undefined ? null : context.targetLanguage.dialect
        }

        return eachTextArray
    })
}

//gpt
export async function makeChapterSections({ context, currentChapter }: { context: contextType, currentChapter: chapterType, }): Promise<makeChapterSectionsResponseType> {
    const newWordsString = makeNewWordsString(context)

    const latestGoalSubGoal = getLatestGoalSubGoal({ goals: context.goals } as bookType)
    if (latestGoalSubGoal.latestGoal === undefined || latestGoalSubGoal.latestSubGoal === undefined) {
        throw new Error("$no more goals/subGoals")
    }
    const activeGoal = latestGoalSubGoal.latestGoal
    const activeSubGoal = latestGoalSubGoal.latestSubGoal as goalType["subGoals"][number]

    const instructions = `You are a serialized narrative engine writing the next story sections for an interactive language-learning story game.
Your job is to continue the story while naturally introducing vocabulary the user is trying to learn.

========================
LANGUAGE SETTINGS
========================

Native Language:
${JSON.stringify(context.nativeLanguage)}

Target Language the user is learning:
${JSON.stringify(context.targetLanguage)}

New Words Available:
${newWordsString}

========================
VOCABULARY LEARNING RULES
========================

Your job is to introduce target-language vocabulary naturally inside the story.

Rules:
• if making type "fw" (foreignWord) words select ONLY from the "New Words Available" list. I'll hanlde showing the meaning so ensure you keep the ID. Never invent or hallucinate word ids. When you use a word, include its original id exactly as provided.
• You can introduce new words on your own as type "gptWord" where you provide the meaning and pronounciation in the users native language and the word itself in the target language. Use if you think a particular word would be useful for the user to know in their target language. Or if masteryLevel is high you can return multiple words in the target language to make a full sentence.

Vocabulary must be introduced naturally within dialogue or narration.

Examples of natural usage:
- greetings
- everyday actions
- objects in the environment
- short spoken phrases

Avoid unnatural usage such as:
- listing vocabulary
- explaining translations
- repeating the same word excessively.

========================
VOCABULARY DIFFICULTY
========================

Choose words according to the user's masteryLevel 
MasteryLevel:
${context.masteryLevel}%.

General guidance:

Low mastery:
- Introduce 1–2 new words
- Prefer simple vocabulary

Medium mastery:
- Introduce 2–4 words
- Mix known and new vocabulary
- entire sentence can be foreignWords

High mastery:
- Introduce up to 5 words
- entire sentence usually foreignWords

========================
VOCABULARY INTEGRATION
========================

Vocabulary should appear:
• mostly in dialogue
• occasionally in narration
• during meaningful story moments

Do NOT place many new words inside a single sentence.

Spread them across the sections naturally.

The story must remain readable for a native speaker of the native language.

========================
PRIMARY STORY TASK
========================

Continue the story using the provided context and game state.

Write sections that lead directly into the ACTIVE subGoal.

========================
SUBGOAL HANDLING
========================

The active subGoal determines how the scene should be written.
active goal title:
${activeGoal.title}

activeSubGoal:
${JSON.stringify(activeSubGoal)}

EXPOSITION
• Expand the exposition text into narrative.
• Reveal information or advance the story.
• If the exposition contains an areaId, treat the scene as arriving in that location.

INTERACTIVE
• Set the stage for an interaction with a character.
• Introduce the character naturally.
• Build context and tension for the upcoming dialogue. I will handle the interaction myself with a chatroom after your response.

Do NOT resolve the interaction.

DEFEAT-CHARACTER
• Build tension leading to a confrontation.
• Show the enemy's presence or threat.
• End the scene just before the fight begins.

Do NOT resolve the fight.

========================
STORY CONTINUITY
========================

Use previousSections to maintain narrative continuity.

Rules:
• Do not repeat previously described environments unless something changed.
• Maintain emotional continuity.
• Characters must remember previous events.

========================
CHARACTER RULES
========================

The player character is the user.
Characters with location "with-player" are traveling companions.

They may:
• speak
• react
• give advice

Restrictions:
• Do NOT invent new characters
• Only use provided characterIds
• Preserve personality consistency

========================
SECTION TYPES
========================

Sections are:

EXPOSITION
Primary story narration.

Guidelines:
• move the story forward
• reveal discoveries
• avoid filler
• write vividly but efficiently

Visual objects are optional and should only appear during major cinematic moments.

========================
PACING
========================
Return 2–5 sections.

Scenes should:
• move the story forward
• lead naturally into the active subGoal
• build tension or curiosity

========================
WORLD STATE CHANGES
========================

You may return changes that modify characters based on what occurred in the sections you wrote.
Changes must be logical consequences of the narrative. Do not invent arbitrary updates.
You may include zero or more changes.

A) Character Changes (character-change)
    Use this when events in the chapter meaningfully alter a character.
    You may update:
    location (if non player characters join/leave the player)
    status
    skillsAndAbilities (gained, lost, altered) - array will be replaced with your value - so include wisely
    likes / dislikes (if shifted by events) - array will be replaced as well
    memories (new important memory formed)

    Examples of valid triggers:
    A character joins the player → update location to "with-player".
    A mob is defeated → update status.
    A traumatic revelation → add a new memory.
    A betrayal → modify dislikes.

${currentChapter.name === defaultText ? (` B) Chapter changes
    Please add an entry to the changes array. changeObj:"chapter-change", chapterChangeObj:"name" - come up with a creative name for this chapter.
`) : ""}

========================
CHAPTER HANDLING
========================

Generated sections mainly belong to the current chapter, which is centered around the current MAIN goal (not the subgoal).
Only start a new chapter if the sections introduce a major narrative shift (new arc, setting change, tonal shift, or significant progression).

If a new chapter is truly warranted, fill out the "forNewChapter" object with a short, creative thematic title based on the next goal. Use this sparingly. Most sections should remain within the current chapter.

========================
TECHNICAL RULES
========================
• Do NOT invent ids.
• Only use provided characterIds.
• Only use provided word ids.
• Stay consistent with the provided world data.
• Return only structured output.

========================
STORY CONTEXT
========================

Story Premise:
${JSON.stringify(context.storyPremise)}

Characters:
${JSON.stringify(context.characters)}

Goals:
${JSON.stringify(context.goals)}

Locations:
${JSON.stringify(context.locations)}

Previous Sections:
${JSON.stringify(context.prevSections)}`
    console.log(`$instructions`, instructions);

    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: instructions,
        input: `Generate the next sections of the story.

    Continue naturally from the previous sections.
    Respect character locations, and world state.

    Return sections and any valid world state changes.`,
        text: {
            format: zodTextFormat(makeChapterSectionsResponseSchema, "makeChapterSectionsResponse"),
        },
    });

    //validate
    const validatedResponse = makeChapterSectionsResponseSchema.parse(response.output_parsed)

    //assign ids
    validatedResponse.sections = validatedResponse.sections.map(eachSection => {
        eachSection.id = uuidV4()

        //assign proper language to chosen words
        eachSection.sectionObj.textArr = fixUpTranslatableText(eachSection.sectionObj.textArr, context)

        return eachSection
    })

    return validatedResponse
}




export async function makeChatMessagesResponse({ context, prevChatMessages }: { context: contextType, prevChatMessages: sectionChatMessageType[], }): Promise<makeChatMessagesResponseType> {
    const newWordsString = makeNewWordsString(context)

    const instructions = `You are generating in-world character chat responses in a live conversation.
This should feel like Character AI (c.ai) — emotionally engaging, immersive, personal.

Your role:
Continue the conversation ONLY as non-player characters.
NEVER generate dialogue for the player character (type: "player"). The player is the user.

========================
LANGUAGE SETTINGS
========================

Native Language:
${JSON.stringify(context.nativeLanguage)}

Target Language the user is learning:
${JSON.stringify(context.targetLanguage)}

New Words Available:
${newWordsString}

========================
VOCABULARY LEARNING RULES
========================

Your job is to introduce target-language vocabulary inside the dialogue if flows naturally.

Rules:
• if making type "fw" (foreignWord) words select ONLY from the "New Words Available" list. I'll hanlde showing the meaning so ensure you keep the ID. Never invent or hallucinate word ids. When you use a word, include its original id exactly as provided.
• You can introduce new words on your own as type "gptWord" where you provide the meaning and pronounciation in the users native language and the word itself in the target language. Use if you think a particular word would be useful for the user to know in their target language. Or if masteryLevel is high you can return multiple words in the target language to make a full sentence.

Avoid unnatural usage such as:
- listing vocabulary
- repeating the same word excessively.

========================
VOCABULARY DIFFICULTY
========================

Choose words according to the user's masteryLevel 
MasteryLevel:
${context.masteryLevel}%.

General guidance:

Low mastery:
- Introduce 1–2 new words

High mastery:
- Introduce up to 5 words
- entire sentence usually foreignWords

The story must remain readable for a native speaker of the native language.

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
${JSON.stringify(context.storyPremise)}

Characters:
${JSON.stringify(context.characters)}

Goals:
${JSON.stringify(context.goals)}

Locations:
${JSON.stringify(context.locations)}

Previous Sections:
${JSON.stringify(context.prevSections)}

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

    //fix up chat messages
    validatedResponse.chatMessages = validatedResponse.chatMessages.map(eachChatMessage => {
        eachChatMessage.messageArr = fixUpTranslatableText(eachChatMessage.messageArr, context)

        return eachChatMessage
    })

    return validatedResponse
}




export async function gradeInteractiveSubGoal({ subGoal, characters, prevSections, prevChatMessages }: { subGoal: goalType["subGoals"][number], characters: characterType[], prevSections: sectionType[], prevChatMessages: sectionChatMessageType[], }): Promise<makeGradeInteractiveSubGoalResponseType> {
    const instructions = `You are evaluating whether the player successfully completed a subGoal during a conversation.

Your task is to determine if the player achieved the subGoal.

Evaluation rules:

1. The player must clearly attempt to achieve the goal.
2. The target character must logically accept or agree.
3. The conversation must reach a clear outcome.

If the character would realistically refuse, the goal is NOT complete.

Be faithful to the character's personality and motivations.

Do NOT be generous. Only mark complete if the goal was clearly achieved.

Player = the user.

SubGoal:
${JSON.stringify(subGoal)}

Characters:
${JSON.stringify(characters)}

Previous Story Sections:
${JSON.stringify(prevSections)}

Chat Messages:
${JSON.stringify(prevChatMessages)}`
    console.log(`$instructions`, instructions);

    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: instructions,
        input: `Determine whether this subGoal was complete or not`,
        text: {
            format: zodTextFormat(makeGradeInteractiveSubGoalResponseSchema, "makeGradeInteractiveSubGoalResponse"),
        },
    });

    //validate
    const validatedResponse = makeGradeInteractiveSubGoalResponseSchema.parse(response.output_parsed)

    return validatedResponse
}