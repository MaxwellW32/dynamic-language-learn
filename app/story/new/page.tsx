import { auth } from "@/auth/auth";
import { db } from "@/db";
import { redirect } from "next/navigation";
import { NewStoryForm } from "@/components/story/NewStoryForm";
import { Parchment } from "@/components/ui/Parchment";
import Link from "next/link";

export default async function NewStoryPage() {
    const session = await auth();
    if (!session?.user?.id) redirect("/");

    const packs = await db.query.vocabPacks.findMany();

    return (
        <main className="min-h-dvh px-6 py-10 max-w-2xl mx-auto">
            <Link href="/" className="text-parchment/70 hover:text-parchment underline underline-offset-4">
                ← back to the shelf
            </Link>

            <Parchment framed className="p-8 mt-4 animate-page-in">
                <h1 className="font-display text-3xl mb-1">A blank book opens…</h1>
                <p className="font-hand text-2xl text-ember-deep mb-6">tell it who you are and which words to teach you</p>

                {packs.length === 0 ? (
                    <p className="text-ink-soft">
                        No word packs are seeded yet. Run <code className="bg-parchment-dark px-1 rounded">npm run db:seed</code> first.
                    </p>
                ) : (
                    <NewStoryForm
                        packs={packs.map((p) => ({
                            id: p.id,
                            name: p.name,
                            description: p.description,
                            targetLanguage: p.targetLanguage,
                            coverEmoji: p.coverEmoji,
                        }))}
                    />
                )}
            </Parchment>
        </main>
    );
}
