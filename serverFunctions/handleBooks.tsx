"use server"
import { db } from "@/db"
import { books } from "@/db/schema"
import { bookSchema, bookType, newBookSchema, newBookType, tableFilterTypes } from "@/types"
import { makeWhereClauses } from "@/utility/utility"
import { and, desc, eq, SQLWrapper } from "drizzle-orm"
import { v4 } from "uuid"

export async function addBook(newBookObj: newBookType) {
    //validation
    const validatedBook = newBookSchema.parse(newBookObj)

    //add new book
    const [addedBook] = await db.insert(books).values({
        ...validatedBook
    }).returning()

    return addedBook
}

export async function updateBook(bookId: bookType["id"], updatedBookObj: Partial<bookType>) {
    //validation
    const validatedUpdatedBook = bookSchema.partial().parse(updatedBookObj)

    //auth
    //userId

    //update
    await db.update(books)
        .set({
            ...validatedUpdatedBook
        })
        .where(eq(books.id, bookId))
}

export async function fixBook(bookId: bookType["id"],) {
    const seenBook = await getSpecificBook(bookId)
    if (seenBook === undefined) return

    // seenBook.goals = seenBook.goals.map(eachGoal => {
    //     eachGoal.subGoals = eachGoal.subGoals.map(eachSubGoal => {
    //         return eachSubGoal
    //     })

    //     return eachGoal
    // })

    seenBook.locations = seenBook.locations.map(eachLocation => {
        //refresh
        eachLocation = { ...eachLocation }

        //random loc size
        const rndLocWidth = Math.floor(Math.random() * 8000) + 6000

        let rndXLocation = Math.floor(Math.random() * rndLocWidth)
        let rndYLocation = Math.floor(Math.random() * rndLocWidth)

        //flip coordintates
        if (Math.random() > 0.5) rndXLocation *= -1
        if (Math.random() > 0.5) rndYLocation *= -1

        //assign
        eachLocation.size = rndLocWidth
        eachLocation.coordinates.x = rndXLocation
        eachLocation.coordinates.y = rndYLocation

        eachLocation.places = eachLocation.places.map(eachPlace => {
            //refresh
            eachPlace = { ...eachPlace }

            //random place size
            const rndPlacWidth = Math.floor(Math.random() * 600) + 50

            //start min extreme left - max width involved
            const rndXPlace = rndXLocation + (Math.floor(Math.random() * (rndLocWidth / 2)) * (Math.random() > 0.5 ? 1 : -1))
            const rndYPlace = rndYLocation + (Math.floor(Math.random() * (rndLocWidth / 2)) * (Math.random() > 0.5 ? 1 : -1))

            //assign
            eachPlace.size = rndPlacWidth
            eachPlace.coordinates.x = rndXPlace
            eachPlace.coordinates.y = rndYPlace

            eachPlace.areas = eachPlace.areas.map(eachArea => {
                //refresh
                eachArea = { ...eachArea }

                //random area size
                const rndAreaWidth = Math.floor(Math.random() * 60) + 5

                //start min extreme left - max width involved
                const rndXArea = rndXPlace + (Math.floor(Math.random() * (rndPlacWidth / 2)) * (Math.random() > 0.5 ? 1 : -1))
                const rndYArea = rndYPlace + (Math.floor(Math.random() * (rndPlacWidth / 2)) * (Math.random() > 0.5 ? 1 : -1))

                //assign
                eachArea.size = rndAreaWidth
                eachArea.coordinates.x = rndXArea
                eachArea.coordinates.y = rndYArea

                return eachArea
            })

            return eachPlace
        })

        return eachLocation
    })

    await updateBook(bookId, seenBook)
}

export async function deleteBook(bookId: bookType["id"]) {
    //auth check

    //validation
    bookSchema.shape.id.parse(bookId)

    await db.delete(books).where(eq(books.id, bookId));
}

export async function getSpecificBook(bookId: bookType["id"], runAuth = true): Promise<bookType | undefined> {
    if (runAuth) {
        //auth check
    }

    bookSchema.shape.id.parse(bookId)

    const result = await db.query.books.findFirst({
        where: eq(books.id, bookId),
    });

    return result
}

export async function getBooks(filter: tableFilterTypes<bookType>, getWith?: { [key in keyof bookType]?: true }, limit = 50, offset = 0): Promise<bookType[]> {
    // Auth check

    //compile filters into proper where clauses
    const whereClauses: SQLWrapper[] = makeWhereClauses(bookSchema.partial(), filter, books)

    const results = await db.query.books.findMany({
        where: and(...whereClauses),
        limit,
        offset,
        orderBy: [desc(books.dateCreated)],
        with: getWith === undefined ? undefined : {
            fromUser: getWith.fromUser,
        }
    });

    return results;
}