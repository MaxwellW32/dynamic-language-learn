"use client"
import { addChapter, getChapters, getSpecificChapter, makeChapterSections, updateChapter } from '@/serverFunctions/handleChapters'
import { bookType, changeMasteryPropsType, chapterSchema, chapterType, characterType, createSubGoalPropsType, dictionaryJSONType, goalType, interactedLanguageLessonsType, languageLessonType, locationType, newChapterType, sectionType, userType } from '@/types'
import { consoleAndToastError } from '@/utility/consoleErrorWithToast'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { v4 as uuidV4 } from 'uuid'
import ShowMore from '../showMore/ShowMore'
import ViewChatSection from './ViewChatSection'
import { chooseRandomTargetLanguage, ensurePlayer, getImportantCharacters, getImportantLocations, getLatestGoalSubGoal, getRelevantGoals, getRelevantSections, makeNativeTargetKey } from '@/utility/contextHelpers'
import { useAtom } from 'jotai'
import { defaultText } from '@/lib/defaultData'
import DisplayTranslatableTexts from './DisplayTranslatableTexts'

type makeNewChapterPropsType = { chapterStarter: Partial<chapterType>, sections: sectionType[], notify: boolean }

export default function ViewChapters({ user, userSet, book, bookSet, syncUserToServerKeysSet, syncBookToServerKeysSet, interactedLanguageLessons, languageLessons, createSubGoals }: { user: userType, userSet: React.Dispatch<React.SetStateAction<userType>>, book: bookType, bookSet: React.Dispatch<React.SetStateAction<bookType>>, syncUserToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof userType)[] | undefined>>, syncBookToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof bookType)[] | undefined>>, interactedLanguageLessons: interactedLanguageLessonsType, languageLessons: { [key: string]: languageLessonType }, createSubGoals(createSubGoalProps: createSubGoalPropsType): Promise<void> }) {
    const [chapters, chaptersSet] = useState<chapterType[] | undefined>(undefined)
    const [activeChapterId, activeChapterIdSet] = useState<chapterType["id"] | undefined>(undefined)

    //get chapters
    useEffect(() => {
        const search = async () => {
            try {
                async function getChapFunc() {
                    const seenChapters = await getChapters({ bookId: book.id })

                    return seenChapters
                }

                //get chapter/chapters
                if (book.currentChapterId === "") {
                    chaptersSet(await getChapFunc())

                } else {
                    let seenChapter = await getSpecificChapter(book.currentChapterId)

                    if (seenChapter === undefined) {
                        console.log(`$not seeing specific chapter`)

                        //again bulk search
                        chaptersSet(await getChapFunc())

                    } else {
                        chaptersSet([seenChapter])
                    }
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
            bookId: book.id,
            name: defaultText,
            sections: makeNewChapterProps.sections,
            shortSummary: ""
        }

        //assign added name
        if (makeNewChapterProps.chapterStarter.name !== undefined) {
            newChapter.name = makeNewChapterProps.chapterStarter.name
        }

        //sync to server
        const addedChapter = await addChapter(newChapter)

        //notify
        if (makeNewChapterProps.notify) {
            toast.success("chapter added!")
        }

        //local change
        chaptersSet(prevChapters => {
            if (prevChapters === undefined) return [addedChapter]

            //add new
            const newChapters = [...prevChapters, addedChapter]

            return newChapters
        })
    }

    return (
        <div className='simpleGrid' style={{ padding: "var(--spacingR)", backgroundColor: "var(--c2)", justifyItems: "center" }}>
            <div>

            </div>

            {chapters !== undefined && (
                <>
                    {chapters.map(eachChapter => {
                        return (
                            <ViewChapter key={eachChapter.id} user={user} userSet={userSet} eachChapter={eachChapter} chapters={chapters} book={book} bookSet={bookSet} syncUserToServerKeysSet={syncUserToServerKeysSet} syncBookToServerKeysSet={syncBookToServerKeysSet} interactedLanguageLessons={interactedLanguageLessons} languageLessons={languageLessons} createSubGoals={createSubGoals}
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
                                    chapterStarter: {},
                                    sections: [],
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

function ViewChapter({ user, userSet, eachChapter, chapters, chapterUpdater, book, bookSet, syncUserToServerKeysSet, syncBookToServerKeysSet, makeNewChapter, interactedLanguageLessons, languageLessons, createSubGoals }: { user: userType, userSet: React.Dispatch<React.SetStateAction<userType>>, eachChapter: chapterType, chapters: chapterType[], chapterUpdater: (chapter: chapterType) => void, book: bookType, bookSet: React.Dispatch<React.SetStateAction<bookType>>, syncUserToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof userType)[] | undefined>>, syncBookToServerKeysSet: React.Dispatch<React.SetStateAction<(keyof bookType)[] | undefined>>, makeNewChapter(makeNewChapterProps: makeNewChapterPropsType): Promise<void>, interactedLanguageLessons: interactedLanguageLessonsType, languageLessons: { [key: string]: languageLessonType }, createSubGoals(createSubGoalProps: createSubGoalPropsType): Promise<void> }) {
    const [syncChapterToServerKeys, syncChapterToServerKeysSet] = useState<(keyof chapterType)[] | undefined>(undefined)
    const syncChapterToServerDebounce = useRef<{ [key: string]: NodeJS.Timeout | undefined }>({})

    const charactersInArea = useMemo(() => {
        return getImportantCharacters(book, false)
    }, [book.characters])

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
            if (foundPlayer.locationObj.type === "withPlayer") throw new Error("player location can't be 'with player'")




            //important locations
            //get current area
            //get areas connected to it
            const currentAreaId = foundPlayer.locationObj.areaId
            const relevantLocations: locationType[] = getImportantLocations(book, currentAreaId)
            console.log(`$relevantLocations`, relevantLocations);


            //goals
            //active goal, next 3 goals - prev goal
            const relevantGoals = getRelevantGoals(book, 3, 7)
            const latestGoalSubGoal = getLatestGoalSubGoal(book)
            console.log(`$relevantGoals`, relevantGoals);
            console.log(`$latestGoalSubGoal`, latestGoalSubGoal);
            if (latestGoalSubGoal.latestGoal === undefined || latestGoalSubGoal.latestSubGoal === undefined) {
                console.log(`$no more goals/subGoals`);
                return
            }
            const latestGoal = latestGoalSubGoal.latestGoal
            const latestSubGoal = latestGoalSubGoal.latestSubGoal as goalType["subGoals"][number]




            //prev sections - context of what was written already - last 3
            const prevSections = getRelevantSections(eachChapter, chapters, 3)




            //choose one target language at random
            const targetLanguageToGenerate = chooseRandomTargetLanguage(book)

            //get response
            const newSectionResponse = await makeChapterSections({
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
                currentChapter: eachChapter,
            })
            console.log(`$newSectionResponse`, newSectionResponse)

            const bookKeysToUpdate: (keyof bookType)[] = []
            const chapterKeysToUpdate: (keyof chapterType)[] = []

            const sectionsToAdd: sectionType[] = newSectionResponse.sections

            //update exposition subGoal
            bookSet(prevBook => {
                const newBook = { ...prevBook }

                newBook.goals = newBook.goals.map(eachGoal => {
                    if (eachGoal.id === latestGoal.id) {
                        //react
                        eachGoal = { ...eachGoal }

                        //update exposition subGoal as complete
                        eachGoal.subGoals = eachGoal.subGoals.map(eachSubGoal => {
                            //react
                            eachSubGoal = { ...eachSubGoal }

                            if (eachSubGoal.id === latestSubGoal.id && eachSubGoal.subGoalTypeObj.type === "exposition") {
                                eachSubGoal.complete = true
                            }

                            return eachSubGoal
                        })
                    }

                    return eachGoal
                })

                //signify needed update
                bookKeysToUpdate.push("goals")

                return newBook
            })

            //add proper sections - interactive/defeatCharacter
            if (latestSubGoal.subGoalTypeObj.type === "interactive") {
                const newChatSection: sectionType = {
                    id: uuidV4(),
                    sectionObj: {
                        type: "chat",
                        characterIds: importantCharacters.map(each => each.id),
                        interactiveSubGoalId: latestSubGoal.id,
                        messages: [],
                    }
                }

                sectionsToAdd.push(newChatSection)

            } else if (latestSubGoal.subGoalTypeObj.type === "defeat-character") {
                const newGameModeSection: sectionType = {
                    id: uuidV4(),
                    sectionObj: {
                        type: "gameMode",
                        defeatCharacterSubGoalId: latestSubGoal.id,
                        gameModes: latestSubGoal.subGoalTypeObj.gameModes.map(eachGameMode => {
                            //each game mode - get words return em
                            //only return dictionary gamemode for now

                            const nativeTargetKey = makeNativeTargetKey(user.languageSettings.native, targetLanguageToGenerate)
                            const seenLessons = interactedLanguageLessons[nativeTargetKey]

                            if (seenLessons === undefined) throw new Error("not seeing lessons")

                            const seenDictEntries = Object.entries(seenLessons.dictionary.seen)
                            let amtLeft = 10 - seenDictEntries.length
                            if (amtLeft < 0) amtLeft = 0

                            const totalToUseDictEntries = [...Object.entries(seenLessons.dictionary.seen), ...Object.entries(seenLessons.dictionary.new).slice(0, amtLeft)]
                            console.log(`$totalToUseDictEntries`, totalToUseDictEntries);

                            return {
                                type: "meaning",
                                language: targetLanguageToGenerate,
                                words: totalToUseDictEntries.map(eachEntry => {
                                    const eachDictionaryKey = eachEntry[0]

                                    return {
                                        id: eachDictionaryKey,
                                        successStatus: undefined,
                                        gotWrongFirstTime: false,
                                    }
                                })
                            }
                        })
                    }
                }

                sectionsToAdd.push(newGameModeSection)
            }

            //local add - chapter sections
            const updatedLocalChapter = { ...eachChapter }

            //new chapter
            if (newSectionResponse.forNewChapter !== null) {
                //send up new chapter
                makeNewChapter({
                    chapterStarter: { name: newSectionResponse.forNewChapter.name },
                    sections: sectionsToAdd,
                    notify: false
                })

            } else {
                //add to current chapter
                updatedLocalChapter.sections = [...updatedLocalChapter.sections, ...sectionsToAdd]
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
                                        eachCharacter.locationObj = updates.location
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

                            //signify needed update
                            bookKeysToUpdate.push("characters")
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

            //server book sync
            syncBookToServerKeysSet(bookKeysToUpdate)

        } catch (error) {
            consoleAndToastError(error)
        }
    }

    function changeMastery(changeMasteryProps: changeMasteryPropsType) {
        function ensureInRange(seenNum: number, min = 1, max = 10) {
            let localNum = seenNum

            if (seenNum > max) {
                localNum = max

            } else if (seenNum < min) {
                localNum = min
            }

            return localNum
        }

        //update local - mastery
        userSet(prevUser => {
            const newUser = { ...prevUser }

            //react
            newUser.lessonProgress = { ...newUser.lessonProgress }

            //lessonProgress at spectific language pair
            if (newUser.lessonProgress[changeMasteryProps.nativeTargetKey] === undefined) {
                //start off
                newUser.lessonProgress[changeMasteryProps.nativeTargetKey] = {
                    dictionary: {

                    },
                    grammar: {

                    }
                }
            }

            //react
            newUser.lessonProgress[changeMasteryProps.nativeTargetKey] = { ...newUser.lessonProgress[changeMasteryProps.nativeTargetKey] }

            if (changeMasteryProps.option === "dictionary") {
                let isAbsent = false

                //react
                newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary = { ...newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary }

                //doesnt exist
                if (newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary[changeMasteryProps.updateId] === undefined) {
                    isAbsent = true

                    //start off
                    newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary[changeMasteryProps.updateId] = {
                        mastery: 0
                    }
                }

                //react
                newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary[changeMasteryProps.updateId] = { ...newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary[changeMasteryProps.updateId] }

                if (changeMasteryProps.onlyIfAbsent) {
                    if (isAbsent) {
                        //update only once
                        newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary[changeMasteryProps.updateId].mastery = 1
                    }

                    return newUser
                }

                //update
                const newNum = newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary[changeMasteryProps.updateId].mastery + changeMasteryProps.increment
                newUser.lessonProgress[changeMasteryProps.nativeTargetKey].dictionary[changeMasteryProps.updateId].mastery = ensureInRange(newNum)

            } else if (changeMasteryProps.option === "grammar") {
                let isAbsent = false

                //react
                newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar = { ...newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar }

                //doesnt exist
                if (newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar[changeMasteryProps.updateId] === undefined) {
                    isAbsent = true

                    //start off
                    newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar[changeMasteryProps.updateId] = {
                        mastery: 0
                    }
                }

                //react
                newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar[changeMasteryProps.updateId] = { ...newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar[changeMasteryProps.updateId] }

                if (changeMasteryProps.onlyIfAbsent) {
                    if (isAbsent) {
                        //update only once
                        newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar[changeMasteryProps.updateId].mastery = 1
                    }

                    return newUser
                }

                //update
                const newNum = newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar[changeMasteryProps.updateId].mastery + changeMasteryProps.increment
                newUser.lessonProgress[changeMasteryProps.nativeTargetKey].grammar[changeMasteryProps.updateId].mastery = ensureInRange(newNum)
            }

            return newUser
        })

        //send to server
        syncUserToServerKeysSet(["lessonProgress"])
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
                                <DisplayTranslatableTexts user={user} translatableTexts={eachSection.sectionObj.textArr} languageLessons={languageLessons} changeMastery={changeMastery} />

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
                                <ViewChatSection user={user} seenSectionId={eachSection.id} chatSection={eachSection.sectionObj} book={book} bookSet={bookSet} eachChapter={eachChapter} chapters={chapters} chapterUpdater={chapterUpdater} syncChapterToServerKeysSet={syncChapterToServerKeysSet} interactedLanguageLessons={interactedLanguageLessons} languageLessons={languageLessons} changeMastery={changeMastery} syncBookToServerKeysSet={syncBookToServerKeysSet} createSubGoals={createSubGoals} />
                            </>
                        )}

                        {eachSection.sectionObj.type === "gameMode" && (
                            <>
                                <p>gameMode</p>
                            </>
                        )}
                    </div>
                )
            })}

            <button className='button2' style={{ justifySelf: "center" }}
                onClick={() => { addSectionFunc() }}
            >Add section</button>

            {charactersInArea.length > 0 && eachChapter.sections[eachChapter.sections.length - 1].sectionObj.type !== "chat" && (//characters in area, and last section is not a chat room
                <button className='button2' style={{ justifySelf: "flex-end" }}
                    onClick={() => {
                        const updatedLocalChapter = { ...eachChapter }

                        //get all characters
                        const importantCharacters = getImportantCharacters(book)

                        const newChatSection: sectionType = {
                            id: uuidV4(),
                            sectionObj: {
                                type: "chat",
                                characterIds: importantCharacters.map(each => each.id),
                                interactiveSubGoalId: null,
                                messages: [],
                            }
                        }

                        updatedLocalChapter.sections = [...updatedLocalChapter.sections, newChatSection]

                        //send off
                        chapterUpdater(updatedLocalChapter)

                        //server chapter sync
                        syncChapterToServerKeysSet(["sections"])
                    }}
                >Chat</button>
            )}
        </div>
    )
}