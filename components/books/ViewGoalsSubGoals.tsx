import { areaType, bookType, characterType, locationType } from '@/types'
import { useMemo } from 'react'

type foundCharacterSubGoalObjType = { character: characterType | undefined, inArea: areaType | undefined }

export default function ViewGoalsSubGoals({ book }: { book: bookType }) {
    const activeGoal = useMemo(() => {
        return book.goals.find(eachGoal => !eachGoal.complete)
    }, [book.goals])

    const activeSubGoal = useMemo(() => {
        if (activeGoal === undefined) return undefined

        return activeGoal.subGoals.find(eachSubGoal => !eachSubGoal.complete)
    }, [activeGoal])

    const foundAreaForSubGoal = useMemo<areaType | undefined>(() => {
        if (activeSubGoal === undefined) return undefined

        if (activeSubGoal.subGoalTypeObj.type !== "area") return undefined

        return findArea(book.locations, activeSubGoal.subGoalTypeObj.areaId)

    }, [activeSubGoal, book.locations])

    const foundCharacterSubGoalObj = useMemo(() => {
        const starterResults: foundCharacterSubGoalObjType = { character: undefined, inArea: undefined }

        if (activeSubGoal === undefined) return starterResults

        if (activeSubGoal.subGoalTypeObj.type !== "defeat-character" && activeSubGoal.subGoalTypeObj.type !== "interactive") return starterResults

        starterResults.character = book.characters.find(eachCharacter => {
            if (activeSubGoal.subGoalTypeObj.type !== "defeat-character" && activeSubGoal.subGoalTypeObj.type !== "interactive") return undefined

            if (eachCharacter.id === activeSubGoal.subGoalTypeObj.characterId) {
                return eachCharacter
            }
        })

        //since found character get area
        if (starterResults.character !== undefined && starterResults.character.location.type === "area") {
            starterResults.inArea = findArea(book.locations, starterResults.character.location.areaId)
        }

        return starterResults

    }, [activeSubGoal, book.characters, book.locations])

    function findArea(seenLocations: locationType[], areaId: areaType["id"]) {
        let foundArea: areaType | undefined = undefined

        seenLocations.map(eachL => {
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

    return (
        <div style={{ display: "grid", overflow: "auto", gap: "var(--spacingR)", padding: "var(--spacingR)" }}>
            {activeGoal === undefined ? (
                <p>no active goal</p>
            ) : (
                <>
                    {activeSubGoal !== undefined && (
                        <>
                            {activeSubGoal.subGoalTypeObj.type === "area" && (
                                <div>
                                    <b>Visit:</b>
                                    <p>
                                        {foundAreaForSubGoal !== undefined
                                            ? foundAreaForSubGoal.name
                                            : "Area not found."}
                                    </p>
                                </div>
                            )}

                            {activeSubGoal.subGoalTypeObj.type === "exposition" && (
                                null
                            )}

                            {activeSubGoal.subGoalTypeObj.type === "defeat-character" && (
                                <div>
                                    <b>Defeat:</b>

                                    <DisplayCharacterPair foundCharacterSubGoalObj={foundCharacterSubGoalObj} />
                                </div>
                            )}

                            {activeSubGoal.subGoalTypeObj.type === "interactive" && (
                                <div>
                                    <b>Interact:</b>

                                    <DisplayCharacterPair foundCharacterSubGoalObj={foundCharacterSubGoalObj} />

                                    <p style={{ fontSize: 12, opacity: 0.8 }}>{activeSubGoal.subGoalTypeObj.goal}</p>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    )
}

function DisplayCharacterPair({ foundCharacterSubGoalObj }: { foundCharacterSubGoalObj: foundCharacterSubGoalObjType }) {
    return (
        <>
            <p>
                {foundCharacterSubGoalObj.character !== undefined
                    ? foundCharacterSubGoalObj.character.name
                    : "Character not found."}
            </p>

            {foundCharacterSubGoalObj.inArea !== undefined && (
                <b style={{ fontSize: "var(--fontSizeS)" }}>In: {foundCharacterSubGoalObj.inArea.name}</b>
            )}
        </>
    )
}