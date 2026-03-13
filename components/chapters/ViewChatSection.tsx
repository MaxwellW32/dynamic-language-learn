import { makeChatMessagesResponse } from "@/serverFunctions/handleChapters"
import { areaType, bookType, chapterType, characterType, languageLessonType, locationType, sectionChatMessageType, sectionType, userType } from "@/types"
import { consoleAndToastError } from "@/utility/consoleErrorWithToast"
import { ensurePlayer, getImportantCharacters, getImportantLocations, getRelevantGoals, getRelevantSections } from "@/utility/contextHelpers"
import React, { useState, useRef, useEffect } from "react"
import toast from "react-hot-toast"
import DisplayTranslatableTexts from "./DisplayTranslatableTexts"

export default function ViewChatSection({ user, seenSectionId, chatSection, eachChapter, chapters, chapterUpdater, book, syncChapterToServerKeysSet, languageLessons }: { user: userType, seenSectionId: sectionType["id"], chatSection: Extract<sectionType["sectionObj"], { type: "chat" }>, eachChapter: chapterType, chapters: chapterType[], chapterUpdater: (chapter: chapterType) => void, book: bookType, syncChapterToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof chapterType)[] | undefined>>, languageLessons: { [key: string]: languageLessonType } }) {
    const [input, setInput] = useState("")
    const messageContRef = useRef<HTMLDivElement | null>(null)

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




            //get response
            const newChatMessagesResponse = await makeChatMessagesResponse({
                storyPremise: seenStoryPremise,
                characters: importantCharacters,
                locations: relevantLocations,
                goals: relevantGoals,
                prevSections: prevSections,
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

    function getCharacter(id: string) {
        const found = book.characters.find(c => c.id === id)

        return found
    }

    return (
        <div style={{ display: "grid", gridTemplateRows: "300px auto", overflow: "auto", gap: "var(--spacingR)" }}>
            <div ref={messageContRef} className="simpleGrid" style={{ overflow: "auto" }}>
                {chatSection.messages.length === 0 && (
                    <>
                        <b>Chat with</b>

                        <div className="simpleGrid">
                            {chatSection.characterIds.map(eachCharacterId => {
                                const foundCharacter = getCharacter(eachCharacterId)
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
                    const seenCharacter = getCharacter(eachMessage.characterId)

                    return (
                        <div key={index}>
                            {seenCharacter !== undefined && (
                                <b>{seenCharacter.name}{seenCharacter.type === "player" ? " (you)" : ""}</b>
                            )}

                            <DisplayTranslatableTexts user={user} translatableTexts={eachMessage.messageArr} languageLessons={languageLessons} />
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
            </div>
        </div>
    )
}