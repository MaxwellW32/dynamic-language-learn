import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth/auth";
import { db } from "@/db";
import { books, users, type Book, type User } from "@/db/schema";

/*
 * Every server action starts here. Identity comes only from the session,
 * never from anything the browser sends.
 */

export async function requireUser(): Promise<{ userId: string; user: User }> {
    const session = await auth();
    const userId = session?.user?.id;
    if (typeof userId !== "string" || userId === "") throw new Error("You must be signed in.");
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    // a session outliving its account is the same as no session
    if (!user) throw new Error("You must be signed in.");
    return { userId, user };
}

/**
 * The book, only if it belongs to the signed-in player. A book that does not
 * exist and a book that belongs to someone else give the same answer, so ids
 * cannot be probed.
 */
export async function requireBook(bookId: string): Promise<{ userId: string; user: User; book: Book }> {
    const { userId, user } = await requireUser();
    if (typeof bookId !== "string" || bookId === "") throw new Error("Book not found.");
    const book = await db.query.books.findFirst({ where: and(eq(books.id, bookId), eq(books.userId, userId)) });
    if (!book) throw new Error("Book not found.");
    return { userId, user, book };
}
