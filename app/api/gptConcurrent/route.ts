import { chosenGptModel, openai } from "@/lib/openai";
import { NextResponse } from "next/server";
import { areaConnectionResponseSchema, areaResponseSchema, areaType, characterType, gptApiFunctionCallOptionSchema, locationResponseSchema, locationType, makeCharactersBodySchema, makeCharactersBodyType, makeCharactersResponseSchema, makeCharactersResponseType, makeGoalsBodySchema, makeGoalsBodyType, makeGoalsResponseSchema, makeGoalsResponseType, makeLocationsBodySchema, makeLocationsBodyType, makeLocationsResponseSchema, makeLocationsResponseType, makeStoryPremiseBodySchema, makeStoryPremiseBodyType, makeStoryPremiseResponseSchema, makeStoryPremiseResponseType, placeResponseSchema, placeType } from "@/types";
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

async function makeLocations({ storyPremise, option, location, place, allLocations, givenAreas }: makeLocationsBodyType): Promise<makeLocationsResponseType> {
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
- areas must be spaced out sensibly within it's place using it's x,y coordinates.
- generate max 5 areas`

    } else if (option === "areaConnections") {
        if (allLocations === undefined && givenAreas === undefined) throw new Error("need all locations or givenAreas")

        prompt += `You are designing traversal connections for an adventure story world.

WORLD STRUCTURE:
- Each Location contains multiple Places.
- Each Place contains multiple Areas.
- Areas are the smallest navigable unit.

Your job is to create Area-to-Area connections.

${allLocations !== undefined && `All locations:
${JSON.stringify(allLocations)}`}

${givenAreas !== undefined && `Areas:
${JSON.stringify(givenAreas)}

Given these areas and suggestion please connect them in the best way possible. Filling in the travelDescription in the output.`}

CORE RULES:
1) FULL CONNECTIVITY (CRITICAL)
All areas across ALL locations must be reachable from any other area through chaining.
There must be NO isolated areas.
Think of this as designing a connected graph.

2) WITHIN-PLACE CONNECTIONS
Areas inside the same Place should almost always connect logically.
Example:
- Bedroom connects to hallway.
- Hallway connects to kitchen.
- Bathroom connects to hallway.

Avoid unrealistic direct jumps (e.g. bedroom directly to rooftop unless justified).

3) BETWEEN-PLACE CONNECTIONS (SAME LOCATION)
Places inside the same Location should connect through sensible transitional areas.
Example:
- "Childhood Home - Living Room" connects to "Front Yard".
- "Front Yard" connects to "Town Street".

4) BETWEEN-LOCATION CONNECTIONS
Some areas must connect across different Locations to ensure the world is fully traversable.
These connections should feel intentional:
- Roads
- Forest paths
- Portals
- Boats
- Mountains passes
- Hidden tunnels
- Magical gates

Do NOT randomly connect unrelated interior rooms across distant locations.

5) GROUND LOGIC
Areas that are outdoors, streets, roads, courtyards, forests, docks, etc. are good candidates for cross-place and cross-location connections.

6) TRAVEL DESCRIPTION
Each connection must include a short but immersive description explaining how traversal happens.
Examples:
- "Walk through the wooden doorway into the hallway."
- "Step onto the dusty road leading toward the market."
- "Climb the narrow staircase to the attic."
- "Follow the forest trail toward the distant village."

7) NO DUPLICATES
Do not create duplicate or mirrored connections.
If Area A connects to Area B, do not separately create B to A.`

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
                    option === "areas" ? zodTextFormat(areaResponseSchema, "areaResponse") :
                        zodTextFormat(areaConnectionResponseSchema, "areaConnectorResponse")
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

async function makeCharacters({ prompt, baseInstructions }: makeCharactersBodyType): Promise<makeCharactersResponseType> {
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
    type reducedAreaType = Pick<areaType, "id" | "name">
    const reducedAreas: reducedAreaType[] = []
    //add to reduced areas
    locations.map(eachLocation => {
        eachLocation.places.map(eachPlace => {
            eachPlace.areas.map(eachArea => {
                const newReducedArea: reducedAreaType = {
                    id: eachArea.id,
                    name: eachArea.name
                }

                reducedAreas.push(newReducedArea)
            })
        })
    })

    type reducedCharacterType = Pick<characterType, "id" | "name" | "age" | "likes" | "dislikes" | "type" | "status" | "memories" | "skillsAndAbilities">
    const reducedCharacters: reducedCharacterType[] = []
    //add to reduced areas
    characters.map(eachCharacter => {
        const newReducedCharacter: reducedCharacterType = {
            type: eachCharacter.type,
            id: eachCharacter.id,
            name: eachCharacter.name,
            age: eachCharacter.age,
            status: eachCharacter.status,
            skillsAndAbilities: eachCharacter.skillsAndAbilities,
            likes: eachCharacter.likes,
            dislikes: eachCharacter.dislikes,
            memories: eachCharacter.memories,
        }

        reducedCharacters.push(newReducedCharacter)
    })

    const instructions = `You are a narrative game designer generating structured gameplay goals.

Your task:
Generate a progression of high-quality, gameplay-driven goals for the story.

Design Principles:
- Goals must be actionable and completable.
- Think like a quest designer, not a novelist.
- Every goal must move the story forward in major parts - what's needed to complete the story.
- Sub-goals should feel like clear player objectives.
- Avoid filler or vague narrative fluff.

Goal Rules:
- Maximum 10 top-level goals.
- Goals should escalate in stakes or complexity.
- Early goals introduce mechanics and world.
- Mid goals deepen conflict and player agency.
- Final goals resolve major tension.

SubGoal Types:
1. exposition  
   - Used to establish direction or reveal information.
   - Keep concise but meaningful.
   - This is read by another AI that writes the story.
2. area  
   - Player must visit a specific area.
   - Use ONLY valid areaId values from provided areas.

3. defeat-character  
   - Only use characters whose type is "mob" or "boss".
   - Use ONLY valid characterId values.

4. interactive  
   - Small, focused objective involving a character.
   - Examples: convince, recruit, extract info, bargain, threaten.
   - Must use a valid characterId.
   - Should feel achievable in 1–2 scenes.

Design Balance:
- Mix exposition, area, interactive, and combat goals naturally.
- Not every goal needs combat.
- Not every goal needs exposition.
- look at previous goals to see what is needed
- Avoid repetition of the same structure across all goals.
- Avoid chaining multiple exposition subgoals in a row.

Story Premise:
${storyPremise}

Areas:
${JSON.stringify(reducedAreas)}

Characters:
${JSON.stringify(reducedCharacters)}

Prev Goals:
${JSON.stringify(prevGoals)}`

    console.log(`$instructions`, instructions);

    const response = await openai.responses.parse({
        model: chosenGptModel,
        instructions: instructions,
        input: `Generate structured gameplay goals for this story.
Follow all system instructions strictly.`,
        text: {
            format: zodTextFormat(makeGoalsResponseSchema, "makeGoalsResponse"),
        },
    });

    //validate
    const validatedResponse = makeGoalsResponseSchema.parse(response.output_parsed)

    return validatedResponse
}