"use server"
import { db } from "@/db"
import { users } from "@/db/schema"
import { userSchema, userType, newUserSchema, newUserType, tableFilterTypes } from "@/types"
import { makeWhereClauses } from "@/utility/utility"
import { and, eq, SQLWrapper } from "drizzle-orm"

export async function addUser(newUserObj: newUserType) {
    //validation
    const validatedUser = newUserSchema.parse(newUserObj)

    //add new user
    const [addedUser] = await db.insert(users).values({
        ...validatedUser
    }).returning()

    return addedUser
}

export async function updateUser(userId: userType["id"], updatedUserObj: Partial<userType>): Promise<userType> {
    //validation
    const validatedUpdatedUser = userSchema.partial().parse(updatedUserObj)

    //auth
    //userId

    //update
    const [updatedUser] = await db.update(users)
        .set({
            ...validatedUpdatedUser
        })
        .where(eq(users.id, userId)).returning()

    return updatedUser
}

export async function deleteUser(userId: userType["id"]) {
    //auth check

    //validation
    userSchema.shape.id.parse(userId)

    await db.delete(users).where(eq(users.id, userId));
}

export async function getSpecificUser(userId: userType["id"], runAuth = true): Promise<userType | undefined> {
    if (runAuth) {
        //auth check
    }

    userSchema.shape.id.parse(userId)

    const result = await db.query.users.findFirst({
        where: eq(users.id, userId),
    });

    return result
}

export async function getUsers(filter: tableFilterTypes<userType>, getWith?: { [key in keyof userType]?: true }, limit = 50, offset = 0): Promise<userType[]> {
    // Auth check

    //compile filters into proper where clauses
    const whereClauses: SQLWrapper[] = makeWhereClauses(userSchema.partial(), filter, users)

    const results = await db.query.users.findMany({
        where: and(...whereClauses),
        limit,
        offset,
        with: getWith === undefined ? undefined : {
            books: getWith.books,
        }
    });

    return results;
}