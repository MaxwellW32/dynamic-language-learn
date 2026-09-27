import { NextResponse } from "next/server";
import { requireBook } from "@/server/auth";

/**
 * How far along a book's forge is. A route and not a server action because a
 * browser's actions run one at a time: asked as an action, this question would
 * wait in line behind the forge itself and be answered only once it was over.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ bookId: string }> }) {
    try {
        const { bookId } = await params;
        const { book } = await requireBook(bookId);
        return NextResponse.json(
            { status: book.status, note: book.forgeNote, title: book.title },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "You must be signed in.") return NextResponse.json({ error: message }, { status: 401 });
        return NextResponse.json({ error: "Book not found." }, { status: 404 });
    }
}
