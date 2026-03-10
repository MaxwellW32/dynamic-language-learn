"use client"
import { addChapter, getChapters, getSpecificChapter, makeChapterSections, updateChapter } from '@/serverFunctions/handleChapters'
import { areaConnectionType, areaType, bookType, chapterSchema, chapterType, characterType, locationSchema, locationType, newChapterType } from '@/types'
import { consoleAndToastError } from '@/utility/consoleErrorWithToast'
import React, { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { v4 } from 'uuid'
import ShowMore from '../showMore/ShowMore'
import ViewChatSection from './ViewChatSection'
import { ensurePlayer, getConnectedAreaIds, getImportantCharacters, getImportantLocations, getRelevantAreaConnections, getRelevantGoals, getRelevantSections } from '@/utility/contextHelpers'
import { useAtom } from 'jotai'
import { sectionLoadersGlobal } from '@/utility/globalState'
import { defaultText } from '@/lib/defaultData'

type makeNewChapterPropsType = { prevChapter: chapterType | undefined, chapterStarter: Partial<chapterType>, notify: boolean }

export default function ViewChapters({ book, bookSet, chapters, chaptersSet, syncBookToServerKeysSet }: { book: bookType, bookSet: React.Dispatch<React.SetStateAction<bookType>>, chapters: chapterType[] | undefined, chaptersSet: React.Dispatch<React.SetStateAction<chapterType[] | undefined>>, syncBookToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof bookType)[] | undefined>> }) {
    //get chapters
    useEffect(() => {
        const search = async () => {
            try {
                //get chapter/chapters
                if (book.currentChapterId === "") {
                    const seenChapters = await getChapters({ bookId: book.id })
                    chaptersSet(seenChapters)

                } else {
                    const seenChapter = await getSpecificChapter(book.currentChapterId)
                    if (seenChapter === undefined) throw new Error("not seeing chapter")

                    chaptersSet([seenChapter])
                }

            } catch (error) {
                consoleAndToastError(error)
            }
        }
        search()

    }, [])

    //make new chapter
    async function makeNewChapter(makeNewChapterProps: makeNewChapterPropsType) {
        const newChapter: newChapterType = {
            id: v4(),
            bookId: book.id,
            index: makeNewChapterProps.prevChapter !== undefined ? makeNewChapterProps.prevChapter.index + 1 : 0,
            name: defaultText,
            sections: [],
            shortSummary: ""
        }

        //assign added name
        if (makeNewChapterProps.chapterStarter.name !== undefined) {
            newChapter.name = makeNewChapterProps.chapterStarter.name
        }

        //local change
        chaptersSet(prevChapters => {
            if (prevChapters === undefined) return [newChapter]

            //add new
            const newChapters = [...prevChapters, newChapter]

            return newChapters
        })

        //sync to server
        await addChapter(newChapter)

        //notify
        if (makeNewChapterProps.notify) {
            toast.success("chapter added!")
        }
    }

    return (
        <div className='simpleGrid' style={{ padding: "var(--spacingR)", backgroundColor: "var(--c2)", justifyItems: "center" }}>
            {chapters !== undefined && (
                <>
                    {chapters.map(eachChapter => {
                        return (
                            <ViewChapter key={eachChapter.id} eachChapter={eachChapter} chapters={chapters} book={book} bookSet={bookSet} syncBookToServerKeysSet={syncBookToServerKeysSet}
                                chapterUpdater={(updatedChapter) => {
                                    //local change
                                    chaptersSet(prevChapters => {
                                        if (prevChapters === undefined) return undefined

                                        const newChapters = prevChapters.map(eachChapterMap => {
                                            if (eachChapterMap.id === updatedChapter.id) {
                                                return { ...updatedChapter }
                                            }

                                            return eachChapterMap
                                        })

                                        return newChapters
                                    })
                                }}
                                makeNewChapter={makeNewChapter}
                            />
                        )
                    })}

                    {chapters.length === 0 && (
                        <button className='button2' style={{ justifySelf: "flex-end" }}
                            onClick={() => {
                                makeNewChapter({
                                    prevChapter: undefined,
                                    chapterStarter: {},
                                    notify: true
                                })
                            }}
                        >Add chapter</button>
                    )}
                </>
            )}
        </div>
    )
}

function ViewChapter({ eachChapter, chapters, chapterUpdater, book, bookSet, syncBookToServerKeysSet, makeNewChapter }: { eachChapter: chapterType, chapters: chapterType[], chapterUpdater: (chapter: chapterType) => void, book: bookType, bookSet: React.Dispatch<React.SetStateAction<bookType>>, syncBookToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof bookType)[] | undefined>>, makeNewChapter(makeNewChapterProps: makeNewChapterPropsType): Promise<void> }) {
    const [syncChapterToServerKeys, syncChapterToServerKeysSet] = useState<(keyof chapterType)[] | undefined>(undefined)
    const syncChapterToServerDebounce = useRef<{ [key: string]: NodeJS.Timeout | undefined }>({})
    const [sectionLoaders] = useAtom(sectionLoadersGlobal)

    //sync chapter to server
    useEffect(() => {
        try {
            if (syncChapterToServerKeys === undefined) return

            const combinedKeyString = syncChapterToServerKeys.length === 0 ? "general" : syncChapterToServerKeys.join("-")

            if (syncChapterToServerDebounce.current[combinedKeyString]) clearTimeout(syncChapterToServerDebounce.current[combinedKeyString])

            syncChapterToServerDebounce.current[combinedKeyString] = setTimeout(async () => {
                let validatedChapter: Partial<chapterType>

                if (syncChapterToServerKeys.length === 0) {
                    validatedChapter = chapterSchema.parse(eachChapter)

                } else {
                    const pickShape = Object.fromEntries(
                        syncChapterToServerKeys.map((key) => [key, true])
                    ) as Record<keyof chapterType, true>

                    //@ts-expect-error type
                    const reducedSchema = chapterSchema.pick(pickShape)
                    validatedChapter = reducedSchema.parse(eachChapter)
                }

                //sync to server
                await updateChapter(eachChapter.id, validatedChapter)
                console.log(`$sent chapter update to server`)

            }, 5000)

        } catch (error) {
            consoleAndToastError(error)
        }

    }, [syncChapterToServerKeys])

    //respond to global add section events
    useEffect(() => {
        if (sectionLoaders === undefined) return

        //run func
        addSectionFunc()

    }, [sectionLoaders])

    async function addSectionFunc() {
        try {
            //add context here: player, characters with and in area - current goals - selected area to move
            //server accepts: story premise, characters, locations, goals, last 3 sections written
            //send to gpt
            //add response

            //story premise
            const seenStoryPremise = book.storyPremise




            //important characters
            //player, characters in area or with player
            const importantCharacters: characterType[] = getImportantCharacters(book)




            //get player
            const foundPlayer = ensurePlayer(book)
            if (foundPlayer.location.type === "withPlayer") throw new Error("player location can't be 'with player'")




            //important locations
            //get current area
            //get areas connected to it
            const currentAreaId = foundPlayer.location.areaId
            const relevantLocations: locationType[] = getImportantLocations(book, currentAreaId)
            const areaIdsConnected: areaType["id"][] = getConnectedAreaIds(book, currentAreaId)
            const allRelevantAreaIds = [...areaIdsConnected, currentAreaId]



            //relevant area connections
            //only area connections linked to relevant locations
            const relevantAreaConnections = getRelevantAreaConnections(book, allRelevantAreaIds)




            //goals
            //active goal, next 3 goals - prev goal
            const relevantGoals = getRelevantGoals(book, 3, 7)




            //prev sections - context of what was written already - last 3
            const prevSections = getRelevantSections(eachChapter, chapters, 3)




            //get response
            const newSectionResponse = await makeChapterSections({
                storyPremise: seenStoryPremise,
                characters: importantCharacters,
                locations: relevantLocations,
                areaConnections: relevantAreaConnections,
                goals: relevantGoals,
                prevSections: prevSections,
                currentChapter: eachChapter,
                sectionLoader: sectionLoaders
            })
            console.log(`$newSectionResponse`, newSectionResponse)

            const chapterKeysToUpdate: (keyof chapterType)[] = []

            //local add - chapter sections
            const updatedLocalChapter = { ...eachChapter }

            //new chapter
            if (newSectionResponse.forNewChapter !== null) {
                //send up new chapter
                makeNewChapter({
                    prevChapter: eachChapter,
                    chapterStarter: { name: newSectionResponse.forNewChapter.name },
                    notify: false
                })
            } else {
                //add to current chapter
                updatedLocalChapter.sections = [...updatedLocalChapter.sections, ...newSectionResponse.sections]
                chapterKeysToUpdate.push("sections")
            }

            //listen to changes
            if (newSectionResponse.changes.length > 0) {
                for (const change of newSectionResponse.changes) {
                    const seenChangeObj = change.changeObj

                    //update book
                    bookSet(prevBook => {
                        const newBook = { ...prevBook }

                        //character changes
                        if (seenChangeObj.type === "character-change") {
                            const { characterId, ...updates } = seenChangeObj

                            newBook.characters = newBook.characters.map(eachCharacter => {
                                if (eachCharacter.id === characterId) {
                                    //react
                                    eachCharacter = { ...eachCharacter }

                                    //add updates to character obj
                                    if (updates.location !== null) {
                                        eachCharacter.location = updates.location
                                    }
                                    if (updates.status !== null) {
                                        eachCharacter.status = updates.status
                                    }
                                    if (updates.skillsAndAbilities !== null) {
                                        eachCharacter.skillsAndAbilities = updates.skillsAndAbilities
                                    }
                                    if (updates.likes !== null) {
                                        eachCharacter.likes = updates.likes
                                    }
                                    if (updates.dislikes !== null) {
                                        eachCharacter.dislikes = updates.dislikes
                                    }
                                    if (updates.memories !== null) {
                                        eachCharacter.memories = [...eachCharacter.memories, ...updates.memories]
                                    }

                                    return eachCharacter
                                }

                                return eachCharacter
                            })

                            //server book sync
                            syncBookToServerKeysSet(["characters"])
                        }

                        //player changes
                        if (seenChangeObj.type === "player-change") {
                            const { characterId, playerChangeObj } = seenChangeObj

                            newBook.characters = newBook.characters.map(eachCharacter => {
                                if (eachCharacter.id === characterId) {
                                    //react
                                    eachCharacter = { ...eachCharacter }

                                    if (playerChangeObj.type === "location" && eachCharacter.location.type === "area") {
                                        if (playerChangeObj.locationChangeObj.type === "success") {
                                            //react
                                            eachCharacter.location = { ...eachCharacter.location }

                                            eachCharacter.location.areaId = playerChangeObj.locationChangeObj.newAreaId

                                        } else if (playerChangeObj.locationChangeObj.type === "failed") {
                                            toast.error("can't change location")
                                            toast.error(playerChangeObj.locationChangeObj.reason)
                                        }
                                    }

                                    return eachCharacter
                                }

                                return eachCharacter
                            })

                            //server book sync
                            syncBookToServerKeysSet(["characters"])
                        }

                        //goal / subGoal changes
                        if (seenChangeObj.type === "subGoal-change") {
                            const { subGoalId, goalChangeObj } = seenChangeObj

                            newBook.goals = newBook.goals.map(eachGoal => {
                                //react
                                eachGoal = { ...eachGoal }

                                const subGoalIndex = eachGoal.subGoals.findIndex(eachSubGoal => eachSubGoal.id === subGoalId)
                                if (subGoalIndex === -1) return eachGoal

                                // SUCCESS
                                if (goalChangeObj.type === "success") {
                                    eachGoal.subGoals = eachGoal.subGoals.map(eachSubGoal => {
                                        if (eachSubGoal.id === subGoalId) {
                                            return {
                                                ...eachSubGoal,
                                                complete: true
                                            }
                                        }

                                        return eachSubGoal
                                    })

                                    return eachGoal
                                }

                                // FAILED
                                if (goalChangeObj.type === "failed") {
                                    const updatedSubGoals = [...eachGoal.subGoals]

                                    // mark failed subGoal
                                    updatedSubGoals[subGoalIndex] = {
                                        ...updatedSubGoals[subGoalIndex],
                                        complete: true,
                                        failed: true
                                    }

                                    // insert new subGoals AFTER failed one
                                    updatedSubGoals.splice(subGoalIndex + 1, 0, ...goalChangeObj.newSubGoals)

                                    return {
                                        ...eachGoal,
                                        subGoals: updatedSubGoals,
                                        complete: true
                                    }
                                }

                                return eachGoal
                            })

                            //server book sync
                            syncBookToServerKeysSet(["goals"])
                        }

                        return newBook
                    })

                    //chapter changes
                    if (seenChangeObj.type === "chapter-change") {
                        const { chapterChangeObj } = seenChangeObj

                        //update name
                        if (chapterChangeObj.type === "name") {
                            updatedLocalChapter.name = chapterChangeObj.name

                            //signify needed update
                            chapterKeysToUpdate.push("name")
                        }
                    }
                }
            }

            //send off
            chapterUpdater(updatedLocalChapter)

            //server chapter sync
            syncChapterToServerKeysSet(chapterKeysToUpdate)

        } catch (error) {
            consoleAndToastError(error)
        }
    }

    return (
        <div style={{ display: "grid", gap: "var(--spacingR)", maxWidth: "65ch" }}>
            {eachChapter.name !== defaultText && (
                <h2 style={{ justifySelf: "center" }}>{eachChapter.name}</h2>
            )}

            {eachChapter.sections.map(eachSection => {
                return (
                    <div key={eachSection.id} className='simpleContainer'>
                        {eachSection.sectionObj.type === "exposition" && (
                            <>
                                <p>{eachSection.sectionObj.text}</p>

                                {eachSection.sectionObj.visual !== null && (
                                    <ShowMore
                                        label='view visual'
                                        content={(
                                            <p>{eachSection.sectionObj.visual.description}</p>
                                        )}
                                    />
                                )}
                            </>
                        )}

                        {eachSection.sectionObj.type === "chat" && (
                            <>
                                <ViewChatSection seenSectionId={eachSection.id} chatSection={eachSection.sectionObj} book={book} eachChapter={eachChapter} chapters={chapters} chapterUpdater={chapterUpdater} syncChapterToServerKeysSet={syncChapterToServerKeysSet} />
                            </>
                        )}
                    </div>
                )
            })}

            <button className='button2' style={{ justifySelf: "center" }}
                onClick={() => { addSectionFunc() }}
            >Add section</button>
        </div>
    )
}