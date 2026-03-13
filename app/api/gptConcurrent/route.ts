import { chosenGptModel, openai } from "@/lib/openai";
import { NextResponse } from "next/server";
import { areaResponseSchema, areaSchema, areaType, characterSchema, characterType, gptApiFunctionCallOptionSchema, locationResponseSchema, locationSchema, locationType, makeCharactersBodySchema, makeCharactersBodyType, makeCharactersResponseSchema, makeCharactersResponseType, makeGoalsBodySchema, makeGoalsBodyType, makeGoalsResponseSchema, makeGoalsResponseType, makeLocationsBodySchema, makeLocationsBodyType, makeLocationsResponseSchema, makeLocationsResponseType, makeStoryPremiseBodySchema, makeStoryPremiseBodyType, makeStoryPremiseResponseSchema, makeStoryPremiseResponseType, placeResponseSchema, placeSchema, placeType } from "@/types";
import { errorZodErrorAsString } from "@/utility/consoleErrorWithToast";
import { zodTextFormat } from "openai/helpers/zod";
import { v4 as uuidV4 } from "uuid"
import { defaultText } from "@/lib/defaultData";

export async function POST(request: Request) {
    const { searchParams } = new URL(request.url);

    //get functionOption
    const functionCallOption = gptApiFunctionCallOptionSchema.parse(searchParams.get("functionCallOption"))

    //get data
    const seenBody = await request.json()

    try {
        if (functionCallOption === "makeStoryPremise") {
            const validatedBody = makeStoryPremiseBodySchema.parse(seenBody)
            return NextResponse.json(await makeStoryPremise(validatedBody))

        } else if (functionCallOption === "makeLocations") {
            const validatedBody = makeLocationsBodySchema.parse(seenBody)
            return NextResponse.json(await makeLocations(validatedBody))

        } else if (functionCallOption === "makeCharacters") {
            const validatedBody = makeCharactersBodySchema.parse(seenBody)
            return NextResponse.json(await makeCharacters(validatedBody))

        } else if (functionCallOption === "makeGoals") {
            const validatedBody = makeGoalsBodySchema.parse(seenBody)
            return NextResponse.json(await makeGoals(validatedBody))

        } else throw new Error("functionOption not supported")

    } catch (error) {
        throw new Error(errorZodErrorAsString(error))
    }
}

async function makeStoryPremise({ prompt, baseInstructions }: makeStoryPremiseBodyType): Promise<makeStoryPremiseResponseType> {
    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: baseInstructions,
        input: prompt,
        text: {
            format: zodTextFormat(makeStoryPremiseResponseSchema, "makeStoryPremiseResponse"),
        },
    });

    //validate
    const validatedResponse = makeStoryPremiseResponseSchema.parse(response.output_parsed)
    // console.log(`$validatedResponse server`, validatedResponse)

    return validatedResponse
}

async function makeLocations({ storyPremise, option, location, place }: makeLocationsBodyType): Promise<makeLocationsResponseType> {
    if (storyPremise === defaultText) throw new Error("need storyPremise")

    let prompt = ``

    if (option === "locations") {
        prompt += `Generate distinct, adventure-rich locations suitable for this story.

Each location must:
- Have a unique identity and tone.
- Suggest conflict, mystery, or opportunity.
- Feel large enough to contain multiple places.
- Be meaningfully different from the others.
- Be spaced out sensibly on a grid using x,y - starts at 0,0 so can have negative values. Coordinates and size are in meters.
- Do not generate any places
- generate max 3 locations`

    } else if (option === "places") {
        if (location === undefined) throw new Error("need location")

        prompt += `Generate interactive places inside the location.

Location:
${JSON.stringify(location)}

Each place must:
- Serve a gameplay purpose (quest hub, danger zone, merchant space, secret area, faction base).
- Feel connected to the location's identity.
- Be distinct from the others.
- Have their coordinates located within it's given location
- Allow multiple internal areas, sized large enough to hold them.
- Do not generate any areas
- Generate max 5 places`

    } else if (option === "areas") {
        if (location === undefined) throw new Error("need location")
        if (place === undefined) throw new Error("need place")

        prompt += `Generate explorable areas inside the place.
Location name: "${location.name}"

Place:
${JSON.stringify(place)}

Areas are specific playable spaces the player can stand in and interact with.

Each area must:
- Have a clear visual identity.
- Contain interactive potential (NPCs, items, secrets, danger, lore).
- Feel physically believable (no impossible layouts unless fantasy-justified).
- areas must be spaced out sensibly within it's place using it's x,y coordinates and size. Can also be outside the designated place (e.g outside pool)
- generate max 5 areas`

    } else {
        throw new Error("invalid option")
    }

    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: `You are a professional fantasy worldbuilder designing structured, explorable environments for an interactive adventure game.

The world has a strict hierarchy:

- Locations: Large regions or major hubs (kingdoms, cities, villages, forests, mountains, dragon lairs).
- Places: Specific points of interest inside a location (guild halls, taverns, castles, markets, outside areas, houses, businesses, workshops, blacksmiths).
- Areas: Playable spaces inside a place (different rooms, floor levels, courtyards, kitchens, bedrooms, balconies, basements).

Design with gameplay in mind.

Every generated item must:
- Feel adventurous and story-relevant.
- Support quests, secrets, and character encounters.
- Avoid generic filler locations.
- Be logically structured.
- Be expandable later.
- Match the tone of the story premise.
- The first "area" in the "place" array is grounding: e.g "front door", "1st floor living room", "receptionist area" is the first area you'd find if visiting a building/establishment as the "place". Work with that in mind, build from areas from the ground up.
- size is in meters. locations have the largest sizes, areas are much more reserved. 

Do not repeat the story premise.
Do not write lore essays.
Be concise but vivid.
Return structured JSON only.
No commentary.

Story Premise:
${storyPremise}
`,
        input: prompt,
        text: {
            format: option === "locations" ? zodTextFormat(locationResponseSchema, "locationResponse") :
                option === "places" ? zodTextFormat(placeResponseSchema, "placeResponse") :
                    zodTextFormat(areaResponseSchema, "areaResponse")
        },
    });

    //validate
    const validatedResponse = makeLocationsResponseSchema.parse({
        results: response.output_parsed
    })
    console.log(`$validatedResponse server`, validatedResponse)

    //go over each assign changes
    if (validatedResponse.results.type === "locations") {
        validatedResponse.results.locations = runSameOnLocations(validatedResponse.results.locations)
    }

    if (validatedResponse.results.type === "places") {
        validatedResponse.results.places = runSameOnPlaces(validatedResponse.results.places)
    }

    if (validatedResponse.results.type === "areas") {
        validatedResponse.results.areas = runSameOnAreas(validatedResponse.results.areas)
    }

    //just overriding id for now
    function runSameOnLocations(seenLocations: locationType[]) {
        seenLocations = seenLocations.map(eachLocation => {
            //assign id
            eachLocation.id = uuidV4()

            //handle places
            eachLocation.places = runSameOnPlaces(eachLocation.places)

            return eachLocation
        })

        return seenLocations
    }
    function runSameOnPlaces(seenPlaces: placeType[]) {
        seenPlaces = seenPlaces.map(eachPlace => {
            //assign id
            eachPlace.id = uuidV4()

            //handle areas
            eachPlace.areas = runSameOnAreas(eachPlace.areas)

            return eachPlace
        })

        return seenPlaces
    }
    function runSameOnAreas(seenAreas: areaType[]) {
        seenAreas = seenAreas.map(eachArea => {
            //assign id
            eachArea.id = uuidV4()

            return eachArea
        })

        return seenAreas
    }

    return validatedResponse
}

async function makeCharacters({ prompt, locations, prevCharacters }: makeCharactersBodyType): Promise<makeCharactersResponseType> {
    const baseInstructions = `You are generating new characters for this world.
Locations:
${JSON.stringify(locations)}

Previously Generated Characters:
${JSON.stringify(prevCharacters)}

CORE RULES:
1) Leave the memories array empty.
2) Keep likes/dislikes array short - realistic for personality.
3) Keep skillsAndAbilities array short.
4) Generate at most 10 characters.

2) PLAYER RULE
There can only ever be ONE player character type in the entire world. That will be the user reading the book.
Please create if it does not exist in "Previously Generated Characters", do not create another. Player location has to be an areaId, cannot be "withPlayer"

3) PURPOSE DRIVEN
Each character must serve a clear gameplay purpose:
- Quest giver
- Ally
- Merchant
- Informant
- Mob enemy
- Boss enemy
- interesting, friendly npc

4) AREA ASSIGNMENT (MANDATORY)
Each character must:
- Belong to a specific Area ID or be travelling with the player - locationObj-"withPlayer".
- Make sense being in that Area.
Example:
- A blacksmith belongs in a forge area.
- A bandit belongs on a road or forest edge.
- A boss might live in a throne room, cave, tower, or dungeon.`
    console.log(`$baseInstructions`, baseInstructions);

    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: baseInstructions,
        input: prompt,
        text: {
            format: zodTextFormat(makeCharactersResponseSchema, "makeCharactersResponse"),
        },
    });

    //validate
    const validatedResponse = makeCharactersResponseSchema.parse(response.output_parsed)

    //assign id's to characters
    validatedResponse.characters = validatedResponse.characters.map(eachCharacter => {
        eachCharacter.id = uuidV4()

        return eachCharacter
    })

    return validatedResponse
}

async function makeGoals({ storyPremise, locations, characters, prevGoals }: makeGoalsBodyType): Promise<makeGoalsResponseType> {
    //add to reduced areas
    characters = characters.map(eachCharacter => {
        //reduce
        eachCharacter = characterSchema.omit({ visualDescription: true }).parse(eachCharacter) as characterType

        return eachCharacter
    })

    const instructions = `You are a narrative game designer creating structured gameplay progression for an AI-driven story game. Your job is to design major story goals and the actionable subGoals that the player must complete to progress through the story.

Goals represent the major narrative beats of the story.
SubGoals represent the concrete actions the player performs to achieve each goal.

The final output must feel like a well-paced novel combined with a playable RPG quest system.
========================
STORY STRUCTURE
========================

Each goal must belong to one of the following narrative stages:
- introduction
- rising-action
- climax
- falling-action
- resolution

Pacing guidance:

Introduction:
- Establish the world, location, and key characters.
- Focus on discovery and small interactions.

Rising Action:
- Expand the conflict.
- Introduce new characters, dangers, and mysteries.
- Stakes should increase.

Climax:
- The major confrontation or turning point of the story.

Falling Action:
- Consequences of the climax.
- Remaining problems being resolved.

Resolution:
- Wrap up the story.
- Final character outcomes and world state.


========================
GOAL DESIGN RULES
========================
Each goal must:
- Move the story forward in a meaningful way.
- Escalate the stakes or deepen the narrative.
- Be achievable through its subGoals.
- Avoid filler or generic objectives.

Goals should feel like major chapters of a novel.
Generate up to 20 major goals that map the entire story arc.

Avoid repeating identical patterns.
Examples of bad structure:
exposition → exposition → exposition → exposition → exposition

Good structure example:
exposition → interactive → exposition → defeat-character → interactive → exposition

========================
SUBGOAL STRUCTURE
========================
Each goal must contain roughly 15 subGoals.
SubGoals represent the individual actions the player performs.
They should form a logical sequence that progresses the player through the goal.

========================
SUBGOAL TYPES
========================
1. exposition
Purpose:
Reveal information, advance narrative, or change player location.

Rules:
- Concise narrative direction.
- Another AI will expand this into story text.
- Include an areaId ONLY when the story requires the player to move to a new area.
- When an areaId is provided, the player will move to that area and subsequent subGoals should take place there unless another areaId is specified.

Use this for:
- discoveries
- story revelations
- moving the player through the map

2. interactive
Purpose:
A focused interaction with a character.

Examples:
- convince
- recruit
- question
- negotiate
- threaten
- persuade
- investigate

Rules:
- Must reference a valid characterId
- Should feel achievable in 1–2 scenes


3. defeat-character
Purpose:
The player defeats a mob or boss.

Rules:
- Use only characters whose type is "mob" or "boss".
- Must reference a valid characterId.
- Each defeat spawns language-learning minigames.

GameModes determine which minigames appear.

Available modes:
- meaning
- pronunciation
- grammar

Design guidance:

Mob fights:
- 1–2 gameModes

Boss fights:
- as many gameModes as you think is warranted for the boss
Boss fights should represent major story confrontations.

========================
DESIGN BALANCE
========================
SubGoals within a goal should mix:
- exposition
- interactive objectives
- combat encounters

========================
WORLD TRAVERSAL
========================
The player exists within the world map.

Locations contain places and areas.
Rules:
- Consider the player's current areaId when generating new exposition steps.
- Areas have coordinates (x, y) in meters.
- When moving the player choose appropriate areas.
- Story movement across the map should feel natural and progressive.

========================
CHARACTER USAGE
========================
Use characters in meaningful ways:

NPC characters:
- used for interactive subGoals

Mob characters:
- used for combat encounters

Boss characters:
- used for major narrative confrontations

========================
REPETITION RULES
========================
Avoid repeating:
- identical interaction types
- identical narrative beats

Each goal should introduce something new to the story.
========================
CURRENT STORY CONTEXT
========================

Story Premise:
${storyPremise}

Locations:
${JSON.stringify(locations)}

Characters:
${JSON.stringify(characters)}

Previously Generated Goals:
${JSON.stringify(prevGoals)}

========================
IMPORTANT OUTPUT RULES
========================
- Generate ONLY goals needed to continue the story progression.
- Do not repeat previously generated goals.
- Ensure goals logically follow previous ones.
- Only use valid characterId and areaId values.`

    console.log(`$instructions`, instructions);

    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: instructions,
        input: `Generate structured gameplay goals for this story.`,
        text: {
            format: zodTextFormat(makeGoalsResponseSchema, "makeGoalsResponse"),
        },
    });

    //validate
    const validatedResponse = makeGoalsResponseSchema.parse(response.output_parsed)

    //assign ids to each goal and subGoal
    validatedResponse.goals = validatedResponse.goals.map(eachGoal => {
        //assign id
        eachGoal.id = uuidV4()

        eachGoal.subGoals = eachGoal.subGoals.map(eachSubGoal => {
            //assign id
            eachSubGoal.id = uuidV4()

            return eachSubGoal
        })

        return eachGoal
    })

    return validatedResponse
}