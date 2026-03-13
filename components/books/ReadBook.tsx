"use client"
import styles from "./style.module.css"
import { areaType, bookSchema, bookType, characterType, dictionaryJSONType, gptApiFunctionCallOptionType, grammarJSONType, interactedLanguageLessonsType, languageLessonType, locationType, makeCharactersBodySchema, makeCharactersBodyType, makeCharactersResponseSchema, makeGoalsBodySchema, makeGoalsBodyType, makeGoalsResponseSchema, makeLocationsBodySchema, makeLocationsBodyType, makeLocationsResponseSchema, makeStoryPremiseBodySchema, makeStoryPremiseBodyType, makeStoryPremiseResponseSchema, placeType, promptInfoType, userSchema, userType } from '@/types'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import ShowMore from '../showMore/ShowMore'
import EditPromptInfo from '../promptInfo/EditPromptInfo'
import TextArea from '../inputs/textArea/TextArea'
import { updateBook } from '@/serverFunctions/handleBooks'
import { consoleAndToastError } from '@/utility/consoleErrorWithToast'
import TextInput from '../inputs/textInput/TextInput'
import toast from 'react-hot-toast'
import UseRateLimit from '../rateLimit/UseRateLimit'
import ViewChapters from "../chapters/ViewChapters"
import ViewLocations from "./ViewLocations"
import ViewGoalsSubGoals from "./ViewGoalsSubGoals"
import { defaultText } from "@/lib/defaultData"
import { getAreaFromId, getCharacterFromId, makeNativeTargetKey } from "@/utility/contextHelpers"
import { updateUser } from "@/serverFunctions/handleUsers"

export default function ReadBook({ seenUser, seenBook }: { seenUser: userType, seenBook: bookType }) {
    const { rateLimit: makeLocationPlacesRateLimit } = UseRateLimit({})
    const { rateLimit: makePlaceAreasRateLimit } = UseRateLimit({})

    const [user, userSet] = useState({ ...seenUser })
    const [book, bookSet] = useState({ ...seenBook })
    const [languageLessons, languageLessonsSet] = useState<{ [key: string]: languageLessonType }>({})

    const sortedLanguageLessons = useMemo<interactedLanguageLessonsType>(() => {
        const newInteractedLanguageLessons: interactedLanguageLessonsType = {}
        //amt of mastery tracked in user obj
        //want to send to gpt not interacted with

        Object.entries(languageLessons).map(eachLanguageLessonEntry => {
            const eachLanguageLessonKey = eachLanguageLessonEntry[0] //combined native/target pair
            const eachLanguageLessonObj = eachLanguageLessonEntry[1]

            const seenDictionaryWords: dictionaryJSONType = {}
            const newDictionaryWords: dictionaryJSONType = {}

            const seenGrammarLessons: grammarJSONType = {}
            const newGrammarLessons: grammarJSONType = {}

            //dictionary - get words seen already
            const allDictionaryEntries = Object.entries(eachLanguageLessonObj.dictionary)
            allDictionaryEntries.map(eachDictionaryEntry => {
                const eachDictionaryKey = eachDictionaryEntry[0]
                const eachDictionaryObj = eachDictionaryEntry[1]

                if (user.lessonProgress[eachLanguageLessonKey] !== undefined) {
                    if (user.lessonProgress[eachLanguageLessonKey].dictionary[eachDictionaryKey] !== undefined) {
                        //add onto seenDictionaryWords
                        seenDictionaryWords[eachDictionaryKey] = eachDictionaryObj

                    } else {
                        //newDictionaryWords
                        newDictionaryWords[eachDictionaryKey] = eachDictionaryObj
                    }

                } else {
                    //no results yet so add everything
                    newDictionaryWords[eachDictionaryKey] = eachDictionaryObj
                }
            })

            //grammar - get grammar lessons seen already
            const allGrammarEntries = Object.entries(eachLanguageLessonObj.grammar)
            allGrammarEntries.map(eachGrammarEntry => {
                const eachGrammarKey = eachGrammarEntry[0]
                const eachGrammarObj = eachGrammarEntry[1]

                if (user.lessonProgress[eachLanguageLessonKey] !== undefined) {
                    if (user.lessonProgress[eachLanguageLessonKey].grammar[eachGrammarKey] !== undefined) {
                        //add onto seenGrammarWords
                        seenGrammarLessons[eachGrammarKey] = eachGrammarObj

                    } else {
                        //newGrammarWords
                        newGrammarLessons[eachGrammarKey] = eachGrammarObj
                    }

                } else {
                    //no results yet so add everything
                    newGrammarLessons[eachGrammarKey] = eachGrammarObj
                }
            })

            //write onto newInteracted obj
            newInteractedLanguageLessons[eachLanguageLessonKey] = {
                dictionary: {
                    seen: seenDictionaryWords,
                    new: newDictionaryWords
                },
                grammar: {
                    seen: seenGrammarLessons,
                    new: newGrammarLessons
                }
            }
        })
        console.log(`$newInteractedLanguageLessons`, newInteractedLanguageLessons)

        return newInteractedLanguageLessons
    }, [user.lessonProgress, languageLessons])

    const [showingSetupMenu, showingSetupMenuSet] = useState(!book.readyToRead)
    const [showingSideMenu, showingSideMenuSet] = useState(false)

    const [createStoryPremisePromptInfo, createStoryPremisePromptInfoSet] = useState<promptInfoType>({
        prompt: `Generate a compelling adventure story premise for an interactive quest-based storybook game.`,
        baseInstructions: `You are a professional adventure novelist and narrative designer creating story premises for an interactive, player-driven storybook game.

Your job is to generate compelling, expandable adventure story premises that feel cinematic, immersive, and emotionally engaging. Dont mention any character names.

Each premise must:
- Begin with a strong hook.
- Establish a clear protagonist situation.
- Introduce an intriguing world or setting.
- Present a central conflict or mystery.
- Imply high stakes.
- Naturally suggest quest potential and future branching paths.

Tone:
- Adventurous
- Imaginative
- Slightly dramatic
- Vivid but not overly verbose

Constraints:
- Write in third person.
- Do NOT write dialogue.
- Do NOT format with bullet points.
- Do NOT include section labels.
- Do not exceed 400 words.
- Do not name any characters.

The premise should feel like the opening description of an epic interactive adventure.`,
        loading: false,
        result: undefined
    })
    const [createCharactersPromptInfo, createCharactersPromptInfoSet] = useState<promptInfoType>({
        prompt: `Make compelling characters`,
        baseInstructions: ``,
        loading: false,
        result: undefined
    })

    const syncUserToServerDebounce = useRef<{ [key: string]: NodeJS.Timeout | undefined }>({})
    const [syncUserToServerKeys, syncUserToServerKeysSet] = useState<(keyof userType)[] | undefined>(undefined)
    const syncBookToServerDebounce = useRef<{ [key: string]: NodeJS.Timeout | undefined }>({})
    const [syncBookToServerKeys, syncBookToServerKeysSet] = useState<(keyof bookType)[] | undefined>(undefined)

    //validation checks
    const targetLanguagesValid = useMemo(() => {
        return checkTargetLanguagesValid()
    }, [book.targetLanguages])
    const storyPremiseValid = useMemo(() => {
        return checkStoryPremiseValid()
    }, [book.storyPremise, book.name])
    const locationsValid = useMemo(() => {
        return checkLocationsValid()

    }, [book.locations])
    const [charactersValid, charactersValidSet] = useState<boolean | undefined>(undefined)
    const [goalsValid, goalsValidSet] = useState<boolean | undefined>(undefined)
    const storyValid = targetLanguagesValid && storyPremiseValid && locationsValid && charactersValid && goalsValid

    //respond to changes above - user
    useEffect(() => {
        userSet({ ...seenUser })

        console.log(`$ran here - user`)

    }, [seenUser])

    //sync user to server
    useEffect(() => {
        try {
            if (syncUserToServerKeys === undefined) return

            const combinedKeyString = syncUserToServerKeys.length === 0 ? "general" : syncUserToServerKeys.join("-")

            if (syncUserToServerDebounce.current[combinedKeyString]) clearTimeout(syncUserToServerDebounce.current[combinedKeyString])
            syncUserToServerDebounce.current[combinedKeyString] = setTimeout(async () => {
                let validatedUser: Partial<userType>

                if (syncUserToServerKeys.length === 0) {
                    validatedUser = userSchema.parse(user)

                } else {
                    const pickShape = Object.fromEntries(
                        syncUserToServerKeys.map((key) => [key, true])
                    ) as Record<keyof userType, true>

                    //@ts-expect-error type
                    const reducedSchema = userSchema.pick(pickShape)
                    validatedUser = reducedSchema.parse(user)
                }

                //sync to server
                await updateUser(user.id, validatedUser)
                console.log(`$sent user update to server`)
            }, 5000)

        } catch (error) {
            consoleAndToastError(error)
        }

    }, [syncUserToServerKeys])

    //sync book to server
    useEffect(() => {
        try {
            if (syncBookToServerKeys === undefined) return

            const combinedKeyString = syncBookToServerKeys.length === 0 ? "general" : syncBookToServerKeys.join("-")

            if (syncBookToServerDebounce.current[combinedKeyString]) clearTimeout(syncBookToServerDebounce.current[combinedKeyString])
            syncBookToServerDebounce.current[combinedKeyString] = setTimeout(async () => {
                let validatedBook: Partial<bookType>

                if (syncBookToServerKeys.length === 0) {
                    validatedBook = bookSchema.parse(book)

                } else {
                    const pickShape = Object.fromEntries(
                        syncBookToServerKeys.map((key) => [key, true])
                    ) as Record<keyof bookType, true>

                    //@ts-expect-error type
                    const reducedSchema = bookSchema.pick(pickShape)
                    validatedBook = reducedSchema.parse(book)
                }

                //sync to server
                await updateBook(book.id, validatedBook)
                console.log(`$sent book update to server`)
            }, 5000)

        } catch (error) {
            consoleAndToastError(error)
        }

    }, [syncBookToServerKeys])

    //load languageLessons
    useEffect(() => {
        //if native language or target languages change refresh
        const search = async () => {
            try {
                await Promise.all(book.targetLanguages.map(async eachTargetLanguage => {
                    const seenNativeTargetKey = makeNativeTargetKey(user.languageSettings.native, eachTargetLanguage)

                    //get dictionary
                    const dictionaryRes = await fetch(`/languageLessons/${seenNativeTargetKey}/dictionary.json`)
                    const seenDictionary = await dictionaryRes.json()

                    //get grammar lessons
                    const grammarRes = await fetch(`/languageLessons/${seenNativeTargetKey}/grammar.json`)
                    const seenGrammar = await grammarRes.json()

                    languageLessonsSet(prevLanguageLessons => {
                        const newLanguageLessons = { ...prevLanguageLessons }

                        newLanguageLessons[seenNativeTargetKey] = {
                            dictionary: seenDictionary,
                            grammar: seenGrammar
                        }

                        return newLanguageLessons
                    })
                }))

            } catch (error) {
                consoleAndToastError(error)
            }
        }
        search()

    }, [user.languageSettings.native, book.targetLanguages])

    //check book valid on launch
    useEffect(() => {
        let storyValidLocal = true

        if (!checkTargetLanguagesValid()) storyValidLocal = false
        if (!checkStoryPremiseValid()) storyValidLocal = false
        if (!checkLocationsValid()) storyValidLocal = false
        if (!checkCharactersValid(false)) storyValidLocal = false
        if (!checkGoalsValid(false)) storyValidLocal = false

        if (storyValidLocal !== book.readyToRead) {
            //save change to server

            //asign change locally
            bookSet(prevBook => {
                const newBook = { ...prevBook }
                newBook.readyToRead = storyValidLocal
                return newBook
            })

            //sync to server
            syncBookToServerKeysSet(["readyToRead"])
        }
    }, [])

    //check side menu
    useEffect(() => {
        if (window.innerWidth > 600) {
            showingSideMenuSet(true)
        }
    }, [])

    //validation functions
    function checkTargetLanguagesValid() {
        return book.targetLanguages.length > 0
    }
    function checkStoryPremiseValid() {
        //parse storypremise and name
        const storyPremiseCheck = bookSchema.shape.storyPremise.safeParse(book.storyPremise)
        if (storyPremiseCheck.error !== undefined) return false
        const nameCheck = bookSchema.shape.name.safeParse(book.name)
        if (nameCheck.error !== undefined) return false

        if (book.storyPremise === defaultText || book.name === defaultText) {
            return false
        }

        return true
    }
    function checkLocationsValid() {
        //ensure has an area 
        //ensure has a place
        if (book.locations.length === 0) return false

        let foundPlace = false
        let foundArea = false

        book.locations.map(eachL => {
            if (eachL.places.length > 0) {
                foundPlace = true

                eachL.places.map(eachP => {
                    if (eachP.areas.length > 0) {
                        foundArea = true
                    }
                })
            }
        })

        return foundPlace && foundArea
    }
    function checkCharactersValid(showNotifs = true) {
        try {
            //start off
            charactersValidSet(false)

            //ensure that player is present
            let seenPlayers: characterType[] = []

            book.characters.map(eachCMap => {
                if (eachCMap.type === "player") {
                    seenPlayers.push(eachCMap)
                }
            })

            if (seenPlayers.length === 0) throw new Error("not seeing player")

            if (seenPlayers.length > 1) throw new Error("more than 1 player")

            //ensure that all area id's accounted for
            book.characters.map(eachCharacter => {
                if (eachCharacter.locationObj.type === "area") {
                    let foundCharacterArea = false

                    //check each area
                    book.locations.map(eachLMap => {
                        eachLMap.places.map(eachPMap => {
                            eachPMap.areas.map(eachAMap => {
                                if (eachCharacter.locationObj.type === "area" && eachAMap.id === eachCharacter.locationObj.areaId) {
                                    foundCharacterArea = true
                                }
                            })
                        })
                    })

                    if (!foundCharacterArea) {
                        console.log(`$eachCharacter.location`, eachCharacter.locationObj);
                        throw new Error("not seeing area id for character location")
                    }
                }
            })

            if (showNotifs) toast.success("all good!")

            //set valid
            charactersValidSet(true)

            return true

        } catch (error) {
            if (showNotifs) {
                consoleAndToastError(error)
            }

            return false
        }
    }
    function checkGoalsValid(showNotifs = true) {
        try {
            //start off
            goalsValidSet(false)

            book.goals.map(eachGoal => {
                eachGoal.subGoals.map(eachSubGoal => {
                    //ensure that all area id's accounted for
                    if (eachSubGoal.subGoalTypeObj.type === "exposition" && eachSubGoal.subGoalTypeObj.areaId !== null) {
                        let foundGoalArea = getAreaFromId(book, eachSubGoal.subGoalTypeObj.areaId)

                        if (foundGoalArea === undefined) {
                            console.log(`$eachSubGoal.subGoalTypeObj.areaId`, eachSubGoal.subGoalTypeObj.areaId);
                            throw new Error("not seeing area id for goal")
                        }
                    }

                    //ensure that all character id's accounted for
                    if (eachSubGoal.subGoalTypeObj.type === "defeat-character" || eachSubGoal.subGoalTypeObj.type === "interactive") {
                        let foundGoalCharacter = getCharacterFromId(book, eachSubGoal.subGoalTypeObj.characterId)

                        if (foundGoalCharacter === undefined) {
                            console.log(`$eachSubGoal.subGoalTypeObj.characterId`, eachSubGoal.subGoalTypeObj.characterId);
                            throw new Error("not seeing character id for goal")
                        }
                    }
                })
            })

            if (showNotifs) toast.success("all good!")

            //set valid
            goalsValidSet(true)

            return true

        } catch (error) {
            if (showNotifs) {
                consoleAndToastError(error)
            }

            return false
        }
    }

    return (
        <main style={{ display: "grid", position: "relative", zIndex: 0, overflow: "auto", }}>
            <div style={{ display: showingSetupMenu ? "grid" : "none", alignContent: "flex-start", position: "absolute", top: 0, left: 0, bottom: 0, right: 0, backgroundColor: "var(--bg2)", zIndex: 2, padding: "var(--spacingR)", gap: "var(--spacingR)", overflow: "auto" }}>
                <button style={{ justifySelf: "flex-end" }}
                    onClick={() => {
                        if (!storyValid) {
                            toast.error("please complete story setup")

                            return
                        }

                        showingSetupMenuSet(false)
                    }}
                >
                    <svg className="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M183.1 137.4C170.6 124.9 150.3 124.9 137.8 137.4C125.3 149.9 125.3 170.2 137.8 182.7L275.2 320L137.9 457.4C125.4 469.9 125.4 490.2 137.9 502.7C150.4 515.2 170.7 515.2 183.2 502.7L320.5 365.3L457.9 502.6C470.4 515.1 490.7 515.1 503.2 502.6C515.7 490.1 515.7 469.8 503.2 457.3L365.8 320L503.1 182.6C515.6 170.1 515.6 149.8 503.1 137.3C490.6 124.8 470.3 124.8 457.8 137.3L320.5 274.7L183.1 137.4z" /></svg>
                </button>

                <h3 style={{ textAlign: "center" }}>Setup Menu</h3>

                <ShowMore
                    label='Language Selection'
                    startShowing={book.targetLanguages.length === 0}
                    content={(
                        <div className="simpleGrid">
                            <p>Please select target language(s)</p>

                            <div className="simpleFlex">
                                {user.languageSettings.targets.map(eachUserLanguageTarget => {
                                    const selected = book.targetLanguages.find(eachTargetLanguageMap => eachTargetLanguageMap.name === eachUserLanguageTarget.name && eachTargetLanguageMap.dialect === eachUserLanguageTarget.dialect)

                                    return (
                                        <button key={eachUserLanguageTarget.name} className="button2" style={{ backgroundColor: selected ? "var(--c1)" : "" }}
                                            onClick={() => {
                                                //asign change locally
                                                bookSet(prevBook => {
                                                    const newBook = { ...prevBook }

                                                    const inArr = newBook.targetLanguages.find(eachTargetLanguageMap => eachTargetLanguageMap.name === eachUserLanguageTarget.name && eachTargetLanguageMap.dialect === eachUserLanguageTarget.dialect)

                                                    if (inArr) {
                                                        newBook.targetLanguages = newBook.targetLanguages.filter(eachTargetLanguageFilter => !(eachTargetLanguageFilter.name === eachUserLanguageTarget.name && eachTargetLanguageFilter.dialect === eachUserLanguageTarget.dialect))
                                                    } else {
                                                        newBook.targetLanguages = [...newBook.targetLanguages, eachUserLanguageTarget]
                                                    }

                                                    return newBook
                                                })

                                                //sync to server
                                                syncBookToServerKeysSet(["targetLanguages"])
                                            }}
                                        >
                                            <p>{eachUserLanguageTarget.name}{eachUserLanguageTarget.dialect !== undefined && (<b> {eachUserLanguageTarget.dialect}</b>)}</p>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                />

                <ShowMore
                    label='Story Premise'
                    content={(
                        <div className='simpleGrid'>
                            <ShowMore
                                label='Generate'
                                content={(
                                    <EditPromptInfo name='locations' promptInfo={createStoryPremisePromptInfo} promptInfoSet={createStoryPremisePromptInfoSet}
                                        searchFunc={async () => {
                                            //what function to call
                                            const gptApiFunctionCallOption: gptApiFunctionCallOptionType = "makeStoryPremise"

                                            //make body
                                            const newBody: makeStoryPremiseBodyType = {
                                                prompt: createStoryPremisePromptInfo.prompt,
                                                baseInstructions: createStoryPremisePromptInfo.baseInstructions
                                            }
                                            const validatedBody = makeStoryPremiseBodySchema.parse(newBody)

                                            //send off to gpt api
                                            const response = await fetch(`/api/gptConcurrent?functionCallOption=${gptApiFunctionCallOption}`, {
                                                method: "POST",
                                                headers: {
                                                    "Content-Type": "application/json"
                                                },
                                                body: JSON.stringify(validatedBody)
                                            })

                                            //handle response
                                            const seenResponse = await response.json()
                                            const validatedResponse = makeStoryPremiseResponseSchema.parse(seenResponse)
                                            console.log(`$validatedResponse`, validatedResponse);

                                            //asign change locally
                                            bookSet(prevBook => {
                                                const newBook = { ...prevBook }
                                                newBook.name = validatedResponse.newStoryName
                                                newBook.storyPremise = validatedResponse.newStoryPremise

                                                return newBook
                                            })

                                            //sync to server
                                            syncBookToServerKeysSet(["name", "storyPremise"])
                                        }}
                                    />
                                )}
                            />

                            <TextInput
                                name={"storyName"}
                                value={book.name}
                                type={"text"}
                                label={"book name"}
                                placeHolder={"enter book name"}
                                onChange={(e) => {
                                    bookSet(prevBook => {
                                        const newBook = { ...prevBook }
                                        newBook.name = e.target.value

                                        return newBook
                                    })

                                    //sync to server
                                    syncBookToServerKeysSet(["name"])
                                }}
                                onBlur={() => { }}
                            />

                            <TextArea
                                name={`storyPremise`}
                                label='premise'
                                value={book.storyPremise}
                                placeHolder={"enter the premise of the story"}
                                onChange={(e) => {
                                    bookSet(prevBook => {
                                        const newBook = { ...prevBook }
                                        newBook.storyPremise = e.target.value

                                        return newBook
                                    })

                                    //sync to server
                                    syncBookToServerKeysSet(["storyPremise"])
                                }}
                                onBlur={() => {
                                    //check here
                                    //show errors
                                }}
                            />
                        </div>
                    )}
                />

                <ShowMore
                    label='Locations'
                    content={(
                        <div className='simpleGrid'>
                            <div className='simpleFlex'>
                                <button className='button2'
                                    onClick={async () => {
                                        try {
                                            toast.success("loading!")

                                            //what function to call
                                            const gptApiFunctionCallOption: gptApiFunctionCallOptionType = "makeLocations"

                                            //make body
                                            const newBody: makeLocationsBodyType = {
                                                option: "locations",
                                                storyPremise: book.storyPremise
                                            }
                                            const validatedBody = makeLocationsBodySchema.parse(newBody)

                                            //send off to gpt api
                                            const response = await fetch(`/api/gptConcurrent?functionCallOption=${gptApiFunctionCallOption}`, {
                                                method: "POST",
                                                headers: {
                                                    "Content-Type": "application/json"
                                                },
                                                body: JSON.stringify(validatedBody)
                                            })

                                            //handle response
                                            const seenResponse = await response.json()
                                            const validatedResponse = makeLocationsResponseSchema.parse(seenResponse)
                                            console.log(`$validatedResponse`, validatedResponse);

                                            if (validatedResponse.results.type !== "locations") return

                                            //asign change locally
                                            bookSet(prevBook => {
                                                const newBook = { ...prevBook }

                                                if (validatedResponse.results.type === "locations") {
                                                    newBook.locations = [...newBook.locations, ...validatedResponse.results.locations]
                                                }

                                                return newBook
                                            })

                                            //sync to server
                                            syncBookToServerKeysSet(["locations"])

                                        } catch (error) {
                                            consoleAndToastError(error)
                                        }
                                    }}
                                >Add locations</button>

                                {book.locations.length > 0 && (
                                    <button className='button2'
                                        onClick={async () => {
                                            toast.success("loading!")

                                            book.locations.map(async eachLocation => {
                                                //only run on empty locations
                                                if (eachLocation.places.length > 0) return

                                                //rate limit
                                                await makeLocationPlacesRateLimit(async () => {
                                                    await actualRun(eachLocation)
                                                })

                                                // after all resolved
                                                toast.success("generated!")
                                            })

                                            toast.success("generated!")

                                            async function actualRun(eachLocation: locationType) {
                                                try {
                                                    //what function to call
                                                    const gptApiFunctionCallOption: gptApiFunctionCallOptionType = "makeLocations"

                                                    //make body
                                                    const newBody: makeLocationsBodyType = {
                                                        option: "places",
                                                        storyPremise: book.storyPremise,
                                                        location: eachLocation
                                                    }
                                                    const validatedBody = makeLocationsBodySchema.parse(newBody)

                                                    //send off to gpt api
                                                    const response = await fetch(`/api/gptConcurrent?functionCallOption=${gptApiFunctionCallOption}`, {
                                                        method: "POST",
                                                        headers: {
                                                            "Content-Type": "application/json"
                                                        },
                                                        body: JSON.stringify(validatedBody)
                                                    })

                                                    //handle response
                                                    const seenResponse = await response.json()
                                                    const validatedResponse = makeLocationsResponseSchema.parse(seenResponse)
                                                    console.log(`$validatedResponse`, validatedResponse);

                                                    if (validatedResponse.results.type !== "places") return

                                                    //asign change locally
                                                    bookSet(prevBook => {
                                                        const newBook = { ...prevBook }
                                                        newBook.locations = newBook.locations.map(eachLocationMap => {
                                                            if (eachLocationMap.id === eachLocation.id) {
                                                                //react
                                                                eachLocationMap = { ...eachLocationMap }

                                                                if (validatedResponse.results.type === "places") {
                                                                    eachLocationMap.places = [...eachLocationMap.places, ...validatedResponse.results.places]
                                                                }
                                                            }

                                                            return eachLocationMap
                                                        })

                                                        return newBook
                                                    })

                                                    //sync to server
                                                    syncBookToServerKeysSet(["locations"])

                                                } catch (error) {
                                                    consoleAndToastError(error)
                                                }
                                            }
                                        }}
                                    >Add places</button>
                                )}

                                {book.locations.find(eachL => eachL.places.length > 0) !== undefined && (
                                    <button className='button2'
                                        onClick={async () => {
                                            toast.success("loading!")

                                            book.locations.map(async eachLocation => {
                                                eachLocation.places.map(async eachPlace => {
                                                    //only run on empty places
                                                    if (eachPlace.areas.length > 0) return

                                                    //rate limit
                                                    await makePlaceAreasRateLimit(async () => {
                                                        await actualRun(eachLocation, eachPlace)
                                                    })

                                                    //after all resolved
                                                    toast.success("generated!")
                                                })
                                            })

                                            async function actualRun(eachLocation: locationType, eachPlace: placeType) {
                                                try {
                                                    //what function to call
                                                    const gptApiFunctionCallOption: gptApiFunctionCallOptionType = "makeLocations"

                                                    //make body
                                                    const newBody: makeLocationsBodyType = {
                                                        option: "areas",
                                                        storyPremise: book.storyPremise,
                                                        location: eachLocation,
                                                        place: eachPlace
                                                    }
                                                    const validatedBody = makeLocationsBodySchema.parse(newBody)

                                                    //send off to gpt api
                                                    const response = await fetch(`/api/gptConcurrent?functionCallOption=${gptApiFunctionCallOption}`, {
                                                        method: "POST",
                                                        headers: {
                                                            "Content-Type": "application/json"
                                                        },
                                                        body: JSON.stringify(validatedBody)
                                                    })

                                                    //handle response
                                                    const seenResponse = await response.json()
                                                    const validatedResponse = makeLocationsResponseSchema.parse(seenResponse)
                                                    console.log(`$validatedResponse`, validatedResponse);

                                                    if (validatedResponse.results.type !== "areas") return

                                                    //asign change locally
                                                    bookSet(prevBook => {
                                                        const newBook = { ...prevBook }

                                                        newBook.locations = newBook.locations.map(eachLocationMap => {
                                                            if (eachLocationMap.id === eachLocation.id) {
                                                                //react
                                                                eachLocationMap = { ...eachLocationMap }

                                                                eachLocationMap.places = eachLocationMap.places.map(eachPlaceMap => {
                                                                    if (eachPlaceMap.id === eachPlace.id) {
                                                                        //react
                                                                        eachPlaceMap = { ...eachPlaceMap }

                                                                        if (validatedResponse.results.type === "areas") {
                                                                            eachPlaceMap.areas = [...eachPlaceMap.areas, ...validatedResponse.results.areas]
                                                                        }
                                                                    }

                                                                    return eachPlaceMap
                                                                })
                                                            }

                                                            return eachLocationMap
                                                        })

                                                        return newBook
                                                    })

                                                    //sync to server
                                                    syncBookToServerKeysSet(["locations"])

                                                } catch (error) {
                                                    consoleAndToastError(error)
                                                }
                                            }
                                        }}
                                    >Add areas</button>
                                )}
                            </div>

                            <div className='gridColumn snap'>
                                {book.locations.length === 0 && (
                                    <p>no locations yet</p>
                                )}

                                {book.locations.map(eachLocation => {
                                    return (
                                        <div key={eachLocation.id} className='simpleContainer'>
                                            <h3>{eachLocation.name}</h3>

                                            <b>Places:</b>

                                            <div className='gridColumn snap'>
                                                {eachLocation.places.length === 0 && (
                                                    <p>No places in location yet</p>
                                                )}

                                                {eachLocation.places.map(eachPlace => {
                                                    return (
                                                        <div key={eachPlace.id} className='simpleContainer'>
                                                            <h3>{eachPlace.name}</h3>

                                                            <b>Areas:</b>

                                                            <div className='gridColumn snap'>
                                                                {eachPlace.areas.length === 0 && (
                                                                    <p>No areas in place yet</p>
                                                                )}

                                                                {eachPlace.areas.map(eachArea => {
                                                                    return (
                                                                        <div key={eachArea.id} className='simpleContainer'>
                                                                            <h3>{eachArea.name}</h3>
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            {book.locations.length !== 0 && (
                                <div style={{ maxHeight: "400px", display: "grid", overflow: "auto" }}>
                                    <ViewLocations book={book} locations={book.locations} />
                                </div>
                            )}
                        </div>
                    )}
                />

                <ShowMore
                    label='Characters'
                    content={(
                        <div className='simpleGrid'>
                            <ShowMore
                                label='Generate'
                                content={(
                                    <EditPromptInfo name='characters' promptInfo={createCharactersPromptInfo} promptInfoSet={createCharactersPromptInfoSet} show={{ baseInstructions: false }}
                                        searchFunc={async () => {
                                            try {
                                                //start off
                                                charactersValidSet(false)

                                                //complain
                                                if (book.locations.length === 0) throw new Error("need locations")

                                                //what function to call
                                                const gptApiFunctionCallOption: gptApiFunctionCallOptionType = "makeCharacters"

                                                //make body
                                                const newBody: makeCharactersBodyType = {
                                                    prompt: createCharactersPromptInfo.prompt,
                                                    prevCharacters: book.characters,
                                                    locations: book.locations
                                                }
                                                const validatedBody = makeCharactersBodySchema.parse(newBody)

                                                //send off to gpt api
                                                const response = await fetch(`/api/gptConcurrent?functionCallOption=${gptApiFunctionCallOption}`, {
                                                    method: "POST",
                                                    headers: {
                                                        "Content-Type": "application/json"
                                                    },
                                                    body: JSON.stringify(validatedBody)
                                                })

                                                //handle response
                                                const seenResponse = await response.json()
                                                const validatedResponse = makeCharactersResponseSchema.parse(seenResponse)
                                                console.log(`$validatedResponse`, validatedResponse);

                                                //asign change locally
                                                bookSet(prevBook => {
                                                    const newBook = { ...prevBook }

                                                    newBook.characters = [...newBook.characters, ...validatedResponse.characters]

                                                    return newBook
                                                })

                                                //sync to server
                                                syncBookToServerKeysSet(["characters"])

                                            } catch (error) {
                                                consoleAndToastError(error)
                                            }
                                        }}
                                    />
                                )}
                            />

                            {book.characters.length > 0 && (
                                <button className='button2'
                                    onClick={() => checkCharactersValid()}
                                >validate</button>
                            )}

                            <div className='gridColumn snap'>
                                {book.characters.length === 0 && (
                                    <p>no characters yet</p>
                                )}

                                {book.characters.map(eachCharacter => {
                                    let currentArea: areaType | undefined = undefined

                                    if (eachCharacter.locationObj.type === "area") {
                                        currentArea = getAreaFromId(book, eachCharacter.locationObj.areaId)
                                    }

                                    return (
                                        <div key={eachCharacter.id} className='simpleContainer'>
                                            <h3>{eachCharacter.name}</h3>

                                            <p>{eachCharacter.type}</p>

                                            <div className="simpleGrid">
                                                <b>location</b>

                                                {eachCharacter.locationObj.type === "withPlayer" ? (
                                                    <>
                                                        <p>with player</p>
                                                    </>
                                                ) : (
                                                    <>
                                                        {currentArea !== undefined ? (
                                                            <p>{currentArea.name}</p>
                                                        ) : (
                                                            <p>not seeing area</p>
                                                        )}
                                                    </>
                                                )}
                                            </div>

                                            <ShowMore
                                                label="show more"
                                                content={(
                                                    <div className="simpleGrid" style={{ gap: "var(--spacingR)" }}>
                                                        <div>
                                                            <label>Age</label>
                                                            <p>{eachCharacter.age}</p>
                                                        </div>

                                                        <ShowMore
                                                            label="personality"
                                                            content={(
                                                                <>
                                                                    <p>{eachCharacter.personality}</p>
                                                                </>
                                                            )}
                                                        />

                                                        <ShowMore
                                                            label="visual descriptions"
                                                            content={(
                                                                <>
                                                                    <p>{eachCharacter.visualDescription}</p>
                                                                </>
                                                            )}
                                                        />

                                                        <div>
                                                            <label>status</label>
                                                            <p>{eachCharacter.status}</p>
                                                        </div>

                                                        <ShowMore
                                                            label="likes"
                                                            content={(
                                                                <div className='simpleGrid'>
                                                                    {eachCharacter.likes.map((each, eachIndex) => {
                                                                        return (
                                                                            <p key={eachIndex}>{each}</p>
                                                                        )
                                                                    })}
                                                                </div>
                                                            )}
                                                        />

                                                        <ShowMore
                                                            label="dislikes"
                                                            content={(
                                                                <div className='simpleGrid'>
                                                                    {eachCharacter.dislikes.map((each, eachIndex) => {
                                                                        return (
                                                                            <p key={eachIndex}>{each}</p>
                                                                        )
                                                                    })}
                                                                </div>
                                                            )}
                                                        />

                                                        <ShowMore
                                                            label="skills/abilities"
                                                            content={(
                                                                <div className='simpleGrid'>
                                                                    {eachCharacter.skillsAndAbilities.map((each, eachIndex) => {
                                                                        return (
                                                                            <p key={eachIndex}>{each}</p>
                                                                        )
                                                                    })}
                                                                </div>
                                                            )}
                                                        />

                                                        <ShowMore
                                                            label="memories"
                                                            content={(
                                                                <div className='simpleGrid'>
                                                                    {eachCharacter.memories.map((each, eachIndex) => {
                                                                        return (
                                                                            <p key={eachIndex}>{each}</p>
                                                                        )
                                                                    })}
                                                                </div>
                                                            )}
                                                        />
                                                    </div>
                                                )}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                />

                <ShowMore
                    label='Goals'
                    content={(
                        <div className='simpleGrid' style={{ gap: "var(--spacingR)" }}>
                            <div className='simpleFlex'>
                                <button className='button2'
                                    onClick={async () => {
                                        try {
                                            //start off
                                            goalsValidSet(false)

                                            toast.success("loading!")

                                            //what function to call
                                            const gptApiFunctionCallOption: gptApiFunctionCallOptionType = "makeGoals"

                                            //make body
                                            const newBody: makeGoalsBodyType = {
                                                storyPremise: book.storyPremise,
                                                prevGoals: book.goals,
                                                characters: book.characters,
                                                locations: book.locations
                                            }
                                            const validatedBody = makeGoalsBodySchema.parse(newBody)

                                            //send off to gpt api
                                            const response = await fetch(`/api/gptConcurrent?functionCallOption=${gptApiFunctionCallOption}`, {
                                                method: "POST",
                                                headers: {
                                                    "Content-Type": "application/json"
                                                },
                                                body: JSON.stringify(validatedBody)
                                            })

                                            //handle response
                                            const seenResponse = await response.json()
                                            const validatedResponse = makeGoalsResponseSchema.parse(seenResponse)
                                            console.log(`$validatedResponse`, validatedResponse);

                                            //asign change locally
                                            bookSet(prevBook => {
                                                const newBook = { ...prevBook }

                                                newBook.goals = [...newBook.goals, ...validatedResponse.goals]

                                                return newBook
                                            })

                                            //sync to server
                                            syncBookToServerKeysSet(["goals"])

                                        } catch (error) {
                                            consoleAndToastError(error)
                                        }
                                    }}
                                >Add goals</button>

                                {book.goals.length > 0 && (
                                    <button className='button2'
                                        onClick={() => checkGoalsValid()}
                                    >validate</button>
                                )}
                            </div>

                            <div className='gridColumn snap'>
                                {book.goals.length === 0 && (
                                    <p>no goals yet</p>
                                )}

                                {book.goals.map((eachGoal) => {
                                    return (
                                        <div key={eachGoal.id} className='simpleContainer'>
                                            <h3 style={{ position: "relative" }}>
                                                {eachGoal.title}

                                                <div style={{ backgroundColor: eachGoal.complete ? "var(--c1)" : "", height: "1rem", width: ".5rem", top: 0, right: 0, position: "absolute" }}></div>
                                            </h3>

                                            <b>Sub-goals:</b>

                                            <div className='gridColumn snap'>
                                                {eachGoal.subGoals.length === 0 && (
                                                    <p>No sub-goals yet</p>
                                                )}

                                                {eachGoal.subGoals.map((eachSubGoal) => {
                                                    let currentArea: areaType | undefined = undefined
                                                    let seenCharacterToConvince: characterType | undefined = undefined
                                                    let seenCharacterToDefeat: characterType | undefined = undefined

                                                    //get referenced area
                                                    if (eachSubGoal.subGoalTypeObj.type === "exposition" && eachSubGoal.subGoalTypeObj.areaId !== null) {
                                                        currentArea = getAreaFromId(book, eachSubGoal.subGoalTypeObj.areaId)
                                                    }

                                                    //get seenCharacterToDefeat
                                                    if (eachSubGoal.subGoalTypeObj.type === "defeat-character") {
                                                        seenCharacterToDefeat = getCharacterFromId(book, eachSubGoal.subGoalTypeObj.characterId)
                                                    }

                                                    //get seenCharacterToConvince
                                                    if (eachSubGoal.subGoalTypeObj.type === "interactive") {
                                                        seenCharacterToConvince = getCharacterFromId(book, eachSubGoal.subGoalTypeObj.characterId)
                                                    }

                                                    return (
                                                        <div key={eachSubGoal.id} className='simpleContainer'>
                                                            <h3 style={{ position: "relative" }}>
                                                                {eachSubGoal.title}

                                                                <div style={{ backgroundColor: eachSubGoal.complete ? "var(--c1)" : "", height: "1rem", width: ".5rem", top: 0, right: 0, position: "absolute" }}></div>
                                                            </h3>

                                                            <b>{eachSubGoal.subGoalTypeObj.type}</b>

                                                            {eachSubGoal.subGoalTypeObj.type === "exposition" && (
                                                                <>
                                                                    <p>{eachSubGoal.subGoalTypeObj.text}</p>

                                                                    {eachSubGoal.subGoalTypeObj.areaId !== null && (
                                                                        <>
                                                                            {currentArea !== undefined ? (
                                                                                <>
                                                                                    <p>Area:</p>
                                                                                    <p>{
                                                                                        currentArea.name
                                                                                    }</p>
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <p>not seeing area</p>
                                                                                </>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </>
                                                            )}

                                                            {eachSubGoal.subGoalTypeObj.type === "defeat-character" && (
                                                                <>
                                                                    {seenCharacterToDefeat !== undefined ? (
                                                                        <>
                                                                            <p>defeat:</p>
                                                                            <p>{
                                                                                seenCharacterToDefeat.name
                                                                            }</p>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <p>not seeing character</p>
                                                                        </>
                                                                    )}
                                                                </>
                                                            )}

                                                            {eachSubGoal.subGoalTypeObj.type === "interactive" && (
                                                                <>
                                                                    {seenCharacterToConvince !== undefined ? (
                                                                        <>
                                                                            <p>{
                                                                                seenCharacterToConvince.name
                                                                            }</p>

                                                                            <p>{eachSubGoal.subGoalTypeObj.goal}</p>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <p>not seeing character</p>
                                                                        </>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                />

                {storyValid && (
                    <div>
                        <button className='button2'
                            onClick={() => {
                                bookSet(prevBook => {
                                    const newBook = { ...prevBook }

                                    newBook.readyToRead = true

                                    return newBook
                                })

                                //sync to server
                                syncBookToServerKeysSet(["readyToRead"])

                                showingSetupMenuSet(false)
                            }}
                        >Start Reading</button>
                    </div>
                )}
            </div>

            {!book.readyToRead ? (
                <div>
                    <p>Book not ready to read</p>
                    <button
                        onClick={() => { showingSetupMenuSet(true) }}
                    >open settings</button>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateRows: "auto 1fr", overflow: "auto" }}>
                    <div className="simpleFlex" style={{ padding: "var(--spacingR)", borderBlock: "1px solid var(--shade1)" }}>
                        <button style={{ justifySelf: "flex-start" }}
                            onClick={async () => {
                                // await fixBook(book.id)
                                // toast.success("fixed")
                                // return

                                showingSetupMenuSet(true)
                            }}
                        >
                            <svg className="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M64 160C64 142.3 78.3 128 96 128L480 128C497.7 128 512 142.3 512 160C512 177.7 497.7 192 480 192L96 192C78.3 192 64 177.7 64 160zM128 320C128 302.3 142.3 288 160 288L544 288C561.7 288 576 302.3 576 320C576 337.7 561.7 352 544 352L160 352C142.3 352 128 337.7 128 320zM512 480C512 497.7 497.7 512 480 512L96 512C78.3 512 64 497.7 64 480C64 462.3 78.3 448 96 448L480 448C497.7 448 512 462.3 512 480z" /></svg>
                        </button>

                        {!showingSideMenu && (
                            <button style={{ justifySelf: "flex-start" }}
                                onClick={() => {
                                    showingSideMenuSet(true)
                                }}
                            >
                                <svg className="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M439.1 297.4C451.6 309.9 451.6 330.2 439.1 342.7L279.1 502.7C266.6 515.2 246.3 515.2 233.8 502.7C221.3 490.2 221.3 469.9 233.8 457.4L371.2 320L233.9 182.6C221.4 170.1 221.4 149.8 233.9 137.3C246.4 124.8 266.7 124.8 279.2 137.3L439.2 297.3z" /></svg>
                            </button>
                        )}
                    </div>

                    <div className={styles.readingAreaContainer} style={{ gridTemplateColumns: showingSideMenu ? "1fr 300px" : "1fr" }}>
                        <div className={styles.readingArea}>
                            <ViewChapters user={user} userSet={userSet} book={book} bookSet={bookSet} syncUserToServerKeysSet={syncUserToServerKeysSet} syncBookToServerKeysSet={syncBookToServerKeysSet} interactedLanguageLessons={sortedLanguageLessons} languageLessons={languageLessons} />
                        </div>

                        <div className={styles.sideMenu} style={{ display: showingSideMenu ? "" : "none" }}>
                            <div style={{ overflow: "auto", display: "grid", gridTemplateRows: "auto 1fr" }}>
                                <div className="simpleFlex">
                                    <button style={{ marginLeft: "auto" }}
                                        onClick={() => {
                                            showingSideMenuSet(false)
                                        }}
                                    >
                                        <svg className="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M183.1 137.4C170.6 124.9 150.3 124.9 137.8 137.4C125.3 149.9 125.3 170.2 137.8 182.7L275.2 320L137.9 457.4C125.4 469.9 125.4 490.2 137.9 502.7C150.4 515.2 170.7 515.2 183.2 502.7L320.5 365.3L457.9 502.6C470.4 515.1 490.7 515.1 503.2 502.6C515.7 490.1 515.7 469.8 503.2 457.3L365.8 320L503.1 182.6C515.6 170.1 515.6 149.8 503.1 137.3C490.6 124.8 470.3 124.8 457.8 137.3L320.5 274.7L183.1 137.4z" /></svg>
                                    </button>
                                </div>

                                <ViewGoalsSubGoals book={book} />
                            </div>

                            <ViewLocations book={book} locations={book.locations} />
                        </div>
                    </div>
                </div>
            )}
        </main>
    )
}