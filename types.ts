import { z } from "zod";
//separate 5 spaces
//50 spaces for large differences

//normal types
export const languageOptionSchema = z.object({
    name: z.string().min(1),
    dialects: z.string().min(1).array().min(1).optional(),
})
export type languageOptionType = z.infer<typeof languageOptionSchema>

export const languageOptionChosenSchema = z.object({
    name: z.string().min(1),
    dialect: z.string().min(1).optional(),
})
export type languageOptionChosenType = z.infer<typeof languageOptionChosenSchema>




export const dateSchema = z.preprocess((val) => {
    if (val instanceof Date) return val;  // already a Date
    if (typeof val === "string" || typeof val === "number") return new Date(val); // convert string

    return val;
}, z.date());




//prompt component
export type promptInfoType = {
    prompt: string,
    baseInstructions: string,
    loading: boolean,
    result?: {
        type: "success",
        msg: string,
    } | {
        type: "error",
        msg: string
    }
}




//handle search
export type tableFilterTypes<T> = {
    [key in keyof T]?: T[key]
}

export type searchObjType<T> = {
    searchItems: T[],
    loading?: true,
    limit?: number, //how many
    offset?: number, //increaser
    incrementOffsetBy?: number, //how much to increase by
    refreshAll?: boolean
}




//locations
export const areaConnectionSchema = z.object({
    firstId: z.string().min(1),
    secondId: z.string().min(1),
    travelDescription: z.string().min(1)
})
export type areaConnectionType = z.infer<typeof areaConnectionSchema>

export const areaSchema = z.object({
    //e.g home-village bar kitchen
    id: z.string().min(1),
    name: z.string().min(1),
    visualDescription: z.string(),
    coordinates: z.object({
        x: z.number(),
        y: z.number(),
    }),
    size: z.number().min(1),
    floorLevel: z.number().min(1),
})
export type areaType = z.infer<typeof areaSchema>

export const placeSchema = z.object({
    //e.g home-village bar
    id: z.string().min(1),
    name: z.string().min(1),
    coordinates: z.object({
        x: z.number(),
        y: z.number(),
    }),
    size: z.number().min(1),
    visualDescription: z.string().min(1),
    areas: areaSchema.array()
})
export type placeType = z.infer<typeof placeSchema>

export const locationSchema = z.object({
    //e.g home-village
    id: z.string().min(1),
    name: z.string().min(1),
    coordinates: z.object({
        x: z.number(),
        y: z.number(),
    }),
    size: z.number(),
    visualDescription: z.string().min(1),
    places: placeSchema.array()
})
export type locationType = z.infer<typeof locationSchema>




//characters
export const characterSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    age: z.number(),
    type: z.enum(["player", "npc", "mob", "boss"]),
    personality: z.string().min(1),
    visualDescription: z.string().min(1),
    location: z.union([
        z.object({
            type: z.literal("withPlayer")
        }),
        z.object({
            type: z.literal("area"),
            areaId: areaSchema.shape.id
        }),
    ]),
    status: z.enum(["alive", "dead"]),
    skillsAndAbilities: z.string().min(1).array(),
    likes: z.string().min(1).array(),
    dislikes: z.string().min(1).array(),
    memories: z.string().min(1).array(),
})
export type characterType = z.infer<typeof characterSchema>




//goals
export const goalSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    subGoals: z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        subGoalTypeObj: z.union([
            z.object({
                //exposition ai writes around - determines if complete
                type: z.literal("exposition"),
                text: z.string().min(1)
            }),
            z.object({
                //visit area - complete
                type: z.literal("area"),
                areaId: areaSchema.shape.id
            }),
            z.object({
                //defeat character - complete
                type: z.literal("defeat-character"),
                characterId: characterSchema.shape.id
            }),
            z.object({
                //convince blacksmith, recruit npc - spawns chatroom
                type: z.literal("interactive"),
                goal: z.string().min(1),
                characterId: characterSchema.shape.id
            }),
        ]),
        complete: z.boolean(),
        failed: z.boolean(),
    }).array(),
    complete: z.boolean(),
})
export type goalType = z.infer<typeof goalSchema>




//sections
export const sectionChatMessageSchema = z.object({
    characterId: characterSchema.shape.id,
    message: z.string().min(1)
})
export type sectionChatMessageType = z.infer<typeof sectionChatMessageSchema>

export const sectionSchema = z.object({
    id: z.string().min(1),
    sectionObj: z.union([
        z.object({
            //regular text ai returns when writing story
            type: z.literal("exposition"),
            text: z.string().min(1),
            visual: z.object({
                description: z.string().min(1),
                src: z.string(),
            }).nullable()
        }),
        z.object({
            //chat room created - relax talk to your fav characters
            type: z.literal("chat"),
            characterIds: characterSchema.shape.id.array(),
            messages: sectionChatMessageSchema.array()
        })
    ]),
})
export type sectionType = z.infer<typeof sectionSchema>



















//gpt
export const gptApiFunctionCallOptionSchema = z.enum(["makeStoryPremise", "makeLocations", "makeCharacters", "makeGoals"])
export type gptApiFunctionCallOptionType = z.infer<typeof gptApiFunctionCallOptionSchema>




//make story - body/response pair
export const makeStoryPremiseBodySchema = z.object({
    baseInstructions: z.string().min(1),
    prompt: z.string().min(1),
})
export type makeStoryPremiseBodyType = z.infer<typeof makeStoryPremiseBodySchema>

export const makeStoryPremiseResponseSchema = z.object({
    newStoryPremise: z.string().min(1),
    newStoryName: z.string().min(1)
})
export type makeStoryPremiseResponseType = z.infer<typeof makeStoryPremiseResponseSchema>




//make locations
const locationOptions = ["locations", "places", "areas", "areaConnections"] as const

export const makeLocationsBodySchema = z.object({
    option: z.enum(locationOptions),
    storyPremise: z.string().min(1),
    location: locationSchema.optional(),
    place: placeSchema.optional(),
    allLocations: locationSchema.array().optional(),
    givenAreas: z.object({
        areas: areaSchema.array(),
        suggestedAreaConnections: areaConnectionSchema.array()
    }).optional(),
})
export type makeLocationsBodyType = z.infer<typeof makeLocationsBodySchema>

export const locationResponseSchema = z.object({
    type: z.literal("locations"),
    locations: locationSchema.array(),
})
export const placeResponseSchema = z.object({
    type: z.literal("places"),
    places: placeSchema.array(),
})
export const areaResponseSchema = z.object({
    type: z.literal("areas"),
    areas: areaSchema.array(),
})
export const areaConnectionResponseSchema = z.object({
    type: z.literal("areaConnections"),
    areaConnections: areaConnectionSchema.array(),
})

export const makeLocationsResponseSchema = z.object({
    results: z.union([locationResponseSchema, placeResponseSchema, areaResponseSchema, areaConnectionResponseSchema]),
})
export type makeLocationsResponseType = z.infer<typeof makeLocationsResponseSchema>




//make characters
export const makeCharactersBodySchema = z.object({
    baseInstructions: z.string().min(1),
    prompt: z.string().min(1),
})
export type makeCharactersBodyType = z.infer<typeof makeCharactersBodySchema>

export const makeCharactersResponseSchema = z.object({
    characters: characterSchema.array()
})
export type makeCharactersResponseType = z.infer<typeof makeCharactersResponseSchema>




//make goals
export const makeGoalsBodySchema = z.object({
    storyPremise: z.string().min(1),
    prevGoals: goalSchema.array(),
    locations: locationSchema.array(),
    characters: characterSchema.array(),
})
export type makeGoalsBodyType = z.infer<typeof makeGoalsBodySchema>

export const makeGoalsResponseSchema = z.object({
    goals: goalSchema.array()
})
export type makeGoalsResponseType = z.infer<typeof makeGoalsResponseSchema>




//make chapter sections
export type sectionLoaderType = {
    wantedAreaId?: areaType["id"],
} | undefined

export const makeChapterSectionsResponseSchema = z.object({
    sections: sectionSchema.array(),
    forNewChapter: z.object({
        name: z.string().min(1)
    }).nullable(),
    changes: z.object({//ai can make changes to characters
        changeObj: z.union([
            z.object({
                type: z.literal("character-change"),
                characterId: characterSchema.shape.id,
                location: characterSchema.shape.location.nullable(),
                status: characterSchema.shape.status.nullable(),
                skillsAndAbilities: characterSchema.shape.skillsAndAbilities.nullable(),
                likes: characterSchema.shape.likes.nullable(),
                dislikes: characterSchema.shape.dislikes.nullable(),
                memories: characterSchema.shape.memories.nullable(),
            }),
            z.object({
                type: z.literal("player-change"),
                characterId: characterSchema.shape.id,
                playerChangeObj: z.union([
                    z.object({//if player can change location
                        type: z.literal("location"),
                        locationChangeObj: z.union([
                            z.object({
                                type: z.literal("success"),
                                newAreaId: areaSchema.shape.id,
                            }),
                            z.object({
                                type: z.literal("failed"),
                                reason: z.string().min(1)
                            }),
                        ]),
                    }),
                ]),
            }),
            z.object({
                type: z.literal("subGoal-change"),
                subGoalId: goalSchema.shape.id,
                goalChangeObj: z.union([
                    z.object({//will mark successful
                        type: z.literal("success"),
                    }),
                    z.object({//replace all sub goals with new way to accomplsh main goal
                        type: z.literal("failed"),
                        newSubGoals: goalSchema.shape.subGoals
                    }),
                ]),
            }),
            z.object({
                type: z.literal("chapter-change"),
                chapterChangeObj: z.union([
                    z.object({
                        type: z.literal("name"),
                        name: z.string().min(1)
                    })
                ]),
            }),
        ]),
    }).array(),
})
export type makeChapterSectionsResponseType = z.infer<typeof makeChapterSectionsResponseSchema>




export const makeChatMessagesResponseSchema = z.object({
    chatMessages: sectionChatMessageSchema.array(),
})
export type makeChatMessagesResponseType = z.infer<typeof makeChatMessagesResponseSchema>




















//db
export const userSchema = z.object({
    //defaults
    id: z.string().min(1, "please add a user id"),
    languageSettings: z.object({
        native: languageOptionChosenSchema,
        targets: languageOptionChosenSchema.array(),
    }),
    wordProgress: z.record(
        z.string().min(1),//english(american)|japanese
        z.record(
            z.string().min(1),//word num code
            z.object({
                mastery: z.number().min(1).max(10),
            })
        )
    ),

    //regular

    //null
    name: z.string().min(1).nullable(),
    email: z.string().email().nullable(),
    emailVerified: dateSchema.nullable(),
    image: z.string().min(1).nullable(),
})
export type userType = z.infer<typeof userSchema> & {
    books?: bookType[],
}

export const newUserSchema = userSchema.omit({ id: true })
export type newUserType = z.infer<typeof newUserSchema>




export const bookSchema = z.object({
    id: z.string().min(1),
    dateCreated: dateSchema,
    name: z.string().min(1),
    readyToRead: z.boolean(),
    storyPremise: z.string().min(1),
    locations: locationSchema.array(),
    characters: characterSchema.array(),
    goals: goalSchema.array(),
    areaConnections: areaConnectionSchema.array(),
    currentChapterId: z.string(),

    userId: userSchema.shape.id,
})
export type bookType = z.infer<typeof bookSchema> & {
    fromUser?: userType,
    chapters?: chapterType[],
}

export const newBookSchema = bookSchema.pick({ userId: true })
export type newBookType = z.infer<typeof newBookSchema>

export const updateBookSchema = bookSchema.omit({ id: true, dateCreated: true, userId: true })
export type updateBookType = z.infer<typeof updateBookSchema>




export const chapterSchema = z.object({
    //each chapter stores info for the book
    id: z.string().min(1),
    bookId: bookSchema.shape.id,

    name: z.string().min(1),
    index: z.number(),
    sections: sectionSchema.array(),
    shortSummary: z.string(),
})
export type chapterType = z.infer<typeof chapterSchema> & {
    fromBook?: bookType,
}

export const newChapterSchema = chapterSchema.omit({})
export type newChapterType = z.infer<typeof newChapterSchema>

export const updateChapterSchema = chapterSchema.omit({})
export type updateChapterType = z.infer<typeof updateChapterSchema>