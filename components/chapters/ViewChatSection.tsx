import { gradeInteractiveSubGoal, makeChatMessagesResponse } from "@/serverFunctions/handleChapters"
import { bookType, changeMasteryPropsType, chapterType, characterType, createSubGoalPropsType, goalType, interactedLanguageLessonsType, languageLessonType, locationType, sectionChatMessageType, sectionType, userType } from "@/types"
import { consoleAndToastError } from "@/utility/consoleErrorWithToast"
import { chooseRandomTargetLanguage, ensurePlayer, getCharacterFromId, getImportantCharacters, getImportantLocations, getRelevantGoals, getRelevantSections } from "@/utility/contextHelpers"
import React, { useState, useRef, useEffect, useMemo } from "react"
import toast from "react-hot-toast"
import DisplayTranslatableTexts from "./DisplayTranslatableTexts"

export default function ViewChatSection({ user, seenSectionId, chatSection, eachChapter, chapters, chapterUpdater, book, syncChapterToServerKeysSet, interactedLanguageLessons, languageLessons, changeMastery, bookSet, syncBookToServerKeysSet, createSubGoals }: {
    user: userType, seenSectionId: sectionType["id"], chatSection: Extract<sectionType["sectionObj"], { type: "chat" }>, eachChapter: chapterType, chapters: chapterType[], chapterUpdater: (chapter: chapterType) => void, book: bookType, syncChapterToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof chapterType)[] | undefined>>, interactedLanguageLessons: interactedLanguageLessonsType, languageLessons: { [key: string]: languageLessonType }, changeMastery(changeMasteryProps: changeMasteryPropsType): void, bookSet: React.Dispatch<React.SetStateAction<bookType>>, syncBookToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof bookType)[] | undefined>>, createSubGoals(createSubGoalProps: createSubGoalPropsType): Promise<void>
}) {
    const [input, setInput] = useState("")
    const messageContRef = useRef<HTMLDivElement | null>(null)

    const interactiveSubGoal = useMemo<goalType["subGoals"][number] | undefined>(() => {
        if (chatSection.interactiveSubGoalId === null) return undefined

        let seenSubGoal: goalType["subGoals"][number] | undefined = undefined

        book.goals.map(eachGoal => {
            eachGoal.subGoals.map(eachSubGoal => {
                if (eachSubGoal.id === chatSection.interactiveSubGoalId) {
                    seenSubGoal = eachSubGoal
                }
            })
        })

        return seenSubGoal

    }, [book.goals, chatSection.interactiveSubGoalId])

    // auto scroll to bottom when messages change
    useEffect(() => {
        if (messageContRef.current === null) return

        //scroll to bottom of cont
        messageContRef.current.scrollTop = messageContRef.current.scrollHeight
    }, [chatSection.messages.length])

    async function handleSend() {
        try {
            if (!input.trim()) return

            toast.success("sending")

            //story premise
            const seenStoryPremise = book.storyPremise




            //important characters
            const importantCharacters: characterType[] = getImportantCharacters(book)




            //get player
            const foundPlayer = ensurePlayer(book)
            if (foundPlayer.locationObj.type === "withPlayer") throw new Error("player location can't be 'with player'")




            //add my message
            const myMessage: sectionChatMessageType = { characterId: foundPlayer.id, messageArr: [input] }


            //filter locations/places/areas
            const currentAreaId = foundPlayer.locationObj.areaId
            const relevantLocations: locationType[] = getImportantLocations(book, currentAreaId)




            //goals - next 3 goals - 7 subGoals
            const relevantGoals = getRelevantGoals(book, 3, 7)



            //prev sections - context of what was written already - last 3
            const prevSections = getRelevantSections(eachChapter, chapters, 3)




            //choose one target language at random
            const targetLanguageToGenerate = chooseRandomTargetLanguage(book)

            //get response
            const newChatMessagesResponse = await makeChatMessagesResponse({
                context: {
                    storyPremise: seenStoryPremise,
                    characters: importantCharacters,
                    locations: relevantLocations,
                    goals: relevantGoals,
                    prevSections: prevSections,
                    nativeLanguage: user.languageSettings.native,
                    targetLanguage: targetLanguageToGenerate,
                    interactedLanguageLessons: interactedLanguageLessons,
                    masteryLevel: 0,
                },
                prevChatMessages: [...chatSection.messages.slice(0, 100), myMessage] //up to 100 past messages
            })
            console.log(`$newChatMessagesResponse`, newChatMessagesResponse)

            const chapterKeysToUpdate: (keyof chapterType)[] = []

            //local add - chapter sections
            const updatedLocalChapter = { ...eachChapter }
            chapterKeysToUpdate.push("sections")


            //add to chat messages
            updatedLocalChapter.sections = updatedLocalChapter.sections.map(eachSection => {
                if (eachSection.id === seenSectionId) {
                    //react
                    eachSection = { ...eachSection }

                    if (eachSection.sectionObj.type === "chat") {
                        //react
                        eachSection.sectionObj = { ...eachSection.sectionObj }

                        eachSection.sectionObj.messages = [...eachSection.sectionObj.messages, myMessage, ...newChatMessagesResponse.chatMessages]
                    }
                }

                return eachSection
            })

            //send off
            chapterUpdater(updatedLocalChapter)

            //server chapter sync
            syncChapterToServerKeysSet(chapterKeysToUpdate)

            //reset
            setInput("")

        } catch (error) {
            consoleAndToastError(error)
        }
    }

    async function handleGrade() {
        try {
            if (interactiveSubGoal === undefined) return
            toast.success("grading")




            //important characters
            const importantCharacters: characterType[] = getImportantCharacters(book)




            //get player
            const foundPlayer = ensurePlayer(book)
            if (foundPlayer.locationObj.type === "withPlayer") throw new Error("player location can't be 'with player'")




            //prev sections - context of what was written already - last 3
            const prevSections = getRelevantSections(eachChapter, chapters, 3)

            //get response
            const newGradeInteractiveSubGoalResponse = await gradeInteractiveSubGoal({
                subGoal: interactiveSubGoal,
                characters: importantCharacters,
                prevSections: prevSections,
                prevChatMessages: chatSection.messages.slice(0, 100) //up to 100 past messages
            })
            console.log(`$newGradeInteractiveSubGoalResponse`, newGradeInteractiveSubGoalResponse)

            const bookKeysToUpdate: (keyof bookType)[] = []

            //local - update interactive subGoal
            bookSet(prevBook => {
                const newBook = { ...prevBook }
                if (interactiveSubGoal === undefined) return prevBook

                newBook.goals = newBook.goals.map(eachGoal => {
                    //react
                    eachGoal = { ...eachGoal }

                    //update exposition subGoal as complete
                    eachGoal.subGoals = eachGoal.subGoals.map(eachSubGoal => {
                        //react
                        eachSubGoal = { ...eachSubGoal }

                        if (eachSubGoal.id === interactiveSubGoal.id) {
                            if (newGradeInteractiveSubGoalResponse.complete) {
                                toast.success("completed!")

                            } else {
                                eachSubGoal.failed = true
                                toast.success("failed!")
                            }

                            //mark complete
                            eachSubGoal.complete = true
                        }

                        return eachSubGoal
                    })

                    return eachGoal
                })

                //signify needed update
                bookKeysToUpdate.push("goals")

                return newBook
            })

            let seenGoalId = ""
            book.goals.map(eachGoal => {
                let foundMatch = false

                eachGoal.subGoals.map(eachSubGoal => {
                    if (eachSubGoal.id === chatSection.interactiveSubGoalId) {
                        foundMatch = true
                    }
                })

                if (foundMatch) {
                    seenGoalId = eachGoal.id
                }
            })

            //create new subGoals
            if (!newGradeInteractiveSubGoalResponse.complete) {
                await createSubGoals({
                    goalId: seenGoalId,
                    failedSubGoalId: interactiveSubGoal.id
                })
            }

            //server book sync
            syncBookToServerKeysSet(bookKeysToUpdate)

        } catch (error) {
            consoleAndToastError(error)
        }
    }

    return (
        <div style={{ display: "grid", gridTemplateRows: "300px auto", overflow: "auto", gap: "var(--spacingR)" }}>
            <div ref={messageContRef} className="simpleGrid" style={{ overflow: "auto", gap: "var(--spacingR)" }}>
                {interactiveSubGoal !== undefined && interactiveSubGoal.subGoalTypeObj.type === "interactive" && (
                    <div className="simpleGrid" style={{ paddingBlock: "var(--spacingR)" }}>
                        <p>Interact:</p>
                        <p><b>Goal:</b> {interactiveSubGoal.subGoalTypeObj.goal}</p>
                    </div>
                )}

                {chatSection.messages.length === 0 && (
                    <>
                        <b>Chat with</b>

                        <div className="simpleGrid">
                            {chatSection.characterIds.map(eachCharacterId => {
                                const foundCharacter = getCharacterFromId(book, eachCharacterId)
                                if (foundCharacter === undefined) return null

                                if (foundCharacter.type === "player") return null

                                return (
                                    <p key={eachCharacterId}>{foundCharacter.name}</p>
                                )
                            })}
                        </div>
                    </>
                )}

                {chatSection.messages.map((eachMessage, index) => {
                    const seenCharacter = getCharacterFromId(book, eachMessage.characterId)

                    return (
                        <div key={index}>
                            {seenCharacter !== undefined && (
                                <b>{seenCharacter.name}{seenCharacter.type === "player" ? " (you)" : ""}</b>
                            )}

                            <DisplayTranslatableTexts user={user} translatableTexts={eachMessage.messageArr} languageLessons={languageLessons} changeMastery={changeMastery} />
                        </div>
                    )
                })}
            </div>

            <div className="simpleFlex">
                <input value={input} style={{ flex: 1 }}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault()

                            handleSend()
                        }
                    }}
                />

                <button onClick={handleSend} className="button2">
                    Send
                </button>

                {chatSection.interactiveSubGoalId !== null && chatSection.messages.length > 0 && interactiveSubGoal !== undefined && !interactiveSubGoal.complete && (
                    <button onClick={handleGrade} className="button2">
                        Grade
                    </button>
                )}
            </div>
        </div>
    )
}