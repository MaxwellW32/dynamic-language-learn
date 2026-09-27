import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ForgeScreen } from "@/components/book/ForgeScreen";
import { GameScreen } from "@/components/game/GameScreen";
import { requireBook } from "@/server/auth";
import { getOverview } from "@/server/services/overview";

export const metadata: Metadata = { title: "Wordbound" };

export default async function BookPage({ params }: { params: Promise<{ bookId: string }> }) {
    const { bookId } = await params;

    let found;
    try {
        found = await requireBook(bookId);
    } catch (error) {
        if (error instanceof Error && error.message === "You must be signed in.") redirect("/");
        notFound();
    }
    const { book } = found;

    if (book.status === "forging") {
        return <ForgeScreen bookId={book.id} playerName={book.playerName} language={book.targetLanguage} failed={book.forgeNote === "failed"} />;
    }
    return <GameScreen initial={await getOverview(book)} />;
}
