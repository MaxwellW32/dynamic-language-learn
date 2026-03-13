import { areaType, bookType, chapterType, characterType, chosenLanguageOptionType, goalType, locationSchema, locationType } from "@/types"

export function makeNativeTargetKey(native: chosenLanguageOptionType, target: chosenLanguageOptionType) {
    return `${native.name.toLowerCase()}${native.dialect !== undefined ? `(${native.dialect.toLowerCase()})` : ""}__${target.name.toLowerCase()}${target.dialect !== undefined ? `(${target.dialect.toLowerCase()})` : ""}`
}

export function getImportantCharacters(book: bookType) {
    const importantCharacters: characterType[] = []

    //get player
    const foundPlayer = getPlayer(book)
    if (foundPlayer === undefined) throw new Error("not seeing player")
    if (foundPlayer.locationObj.type === "withPlayer") throw new Error("player location can't be 'with player'")

    //add player
    importantCharacters.push(foundPlayer)

    //add companions
    const charactersWithPlayer = book.characters.filter(eachCharacter => eachCharacter.locationObj.type === "withPlayer")
    importantCharacters.push(...charactersWithPlayer)

    //get characters in same area
    const otherCharactersInSameArea = book.characters.filter(eachCharacter => {
        if (foundPlayer.locationObj.type === "withPlayer") throw new Error("player location can't be 'with player'")

        //match same area id - ensure not player
        if (eachCharacter.locationObj.type === "area" && eachCharacter.locationObj.areaId === foundPlayer.locationObj.areaId && eachCharacter.id !== foundPlayer.id) {
            return true
        }

        return false
    })
    importantCharacters.push(...otherCharactersInSameArea)

    return importantCharacters
}

export function getImportantLocations(book: bookType, currentAreaId: areaType["id"]) {
    //just containing the areaID

    //filter locations/places/areas
    const relevantLocations: locationType[] = book.locations
        .map(eachLocation => {

            const filteredPlaces = eachLocation.places
                .map(eachPlace => {
                    let hasArea = false

                    eachPlace.areas.map(eachArea => {
                        if (eachArea.id === currentAreaId) {
                            hasArea = true
                        }
                    })

                    if (!hasArea) return null

                    return eachPlace
                })
                .filter(Boolean)

            if (filteredPlaces.length === 0) return null

            return {
                ...eachLocation,
                places: filteredPlaces
            }
        })
        .filter(Boolean).map(eachPre => {
            return locationSchema.parse(eachPre)
        })

    return relevantLocations
}


export function getLatestGoalSubGoal(book: bookType) {
    let latestGoal: goalType | undefined = undefined
    let latestSubGoal: goalType["subGoals"][number] | undefined = undefined

    latestGoal = book.goals.find(eachGoal => {
        if (!eachGoal.complete) {
            latestSubGoal = eachGoal.subGoals.find(eachSubGoal => !eachSubGoal.complete)

            return eachGoal
        }
    })

    return {
        latestGoal, latestSubGoal
    }

}
export function getRelevantGoals(book: bookType, goalLimit: number, subGoalLimit: number) {
    const latestGoalIndex = book.goals.findIndex(eachGoal => !eachGoal.complete)
    const relevantGoals = book.goals.filter((eachGoal, eachGoalIndex) => {
        if (latestGoalIndex !== -1) {
            if (eachGoalIndex >= latestGoalIndex && eachGoalIndex <= latestGoalIndex + goalLimit) {
                return true
            }
        }

        return false
    }).map((eachGoal, eachGoalIndex) => {
        //return only next 3 sub goals - no sub goals at all - just next goal
        //if each goal index is not chosen dont return it

        //react
        eachGoal = { ...eachGoal }

        const latestSubGoalIndex = eachGoal.subGoals.findIndex((eachsubGoal) => !eachsubGoal.complete)

        const relevantSubGoals = eachGoal.subGoals.filter((eachSubGoal, eachSubGoalIndex) => {
            if (latestSubGoalIndex !== -1) {//gets 7 sub goals
                if (eachSubGoalIndex >= latestSubGoalIndex && eachSubGoalIndex <= latestSubGoalIndex + subGoalLimit) {
                    return true
                }
            }

            return false
        })

        //assign new subGoals - only for active goal, rest are empty
        eachGoal.subGoals = eachGoalIndex === 0 ? relevantSubGoals : []

        return eachGoal
    })

    return relevantGoals
}

export function getRelevantSections(eachChapter: chapterType, chapters: chapterType[], MAX: number) {
    // 1. Get current chapter sections (up to 3)
    const currentSections = eachChapter.sections.slice(-MAX);

    // 2. If we already have 3, return
    if (currentSections.length === MAX) {
        return currentSections;
    }

    // 3. Find previous chapter (by index)
    const currentChapterIndex = chapters.findIndex((c) => c.id === eachChapter.id);
    if (currentChapterIndex === -1) {
        return currentSections;
    }

    //get prev chapter
    const previousChapter = chapters[currentChapterIndex - 1];
    if (previousChapter === undefined || previousChapter.sections.length === 0) {
        return currentSections;
    }

    // 4. Calculate how many more we need
    const remainingNeeded = MAX - currentSections.length;

    const previousSections = previousChapter.sections.slice(-remainingNeeded);

    // 5. Combine in correct chronological order
    return [...previousSections, ...currentSections];
}




export function ensurePlayer(book: bookType) {
    const foundPlayer = getPlayer(book)
    if (foundPlayer === undefined) throw new Error("not seeing player")

    return foundPlayer
}
export function getPlayer(book: bookType) {
    return book.characters.find(eachCharacter => eachCharacter.type === "player")
}
export function getPlayerArea(book: bookType, playerCharacter: characterType) {
    if (playerCharacter.type !== "player") {
        console.log(`$not a player`);
        return undefined
    }

    if (playerCharacter.locationObj.type === "withPlayer") {
        console.log(`$player can't be with player`);
        return undefined
    }

    const seenPlayerAreaId = playerCharacter.locationObj.areaId

    let foundArea: areaType | undefined = undefined

    book.locations.map(eachL => {
        eachL.places.map(eachP => {
            eachP.areas.map(eachA => {
                if (eachA.id === seenPlayerAreaId) {
                    foundArea = eachA
                }
            })
        })
    })

    return foundArea
}
export function getAreaFromId(book: bookType, areaId: areaType["id"]): areaType | undefined {
    let foundArea: areaType | undefined = undefined

    book.locations.map(eachL => {
        eachL.places.map(eachP => {
            eachP.areas.map(eachA => {
                if (eachA.id === areaId) {
                    foundArea = eachA
                }
            })
        })
    })

    return foundArea
}
export function getCharacterFromId(book: bookType, characterId: characterType["id"]): characterType | undefined {
    let foundCharacter: characterType | undefined = undefined

    book.characters.map(eachCharacter => {
        if (eachCharacter.id === characterId) {
            foundCharacter = eachCharacter
        }
    })

    return foundCharacter
}