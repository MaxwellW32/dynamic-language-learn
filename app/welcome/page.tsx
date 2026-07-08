import { auth } from "@/auth/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Parchment } from "@/components/ui/Parchment";
import { WelcomeChoice } from "@/components/onboarding/WelcomeChoice";
import { STARTER_SPARKS } from "@/server/services/billing";

export default async function WelcomePage() {
    const session = await auth();
    if (!session?.user?.id) redirect("/");

    const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });

    return (
        <main className="min-h-dvh grid place-items-center px-6 py-10">
            <Parchment framed className="max-w-2xl w-full p-8 animate-page-in">
                <p className="font-hand text-2xl text-ember-deep">before the first page turns…</p>
                <h1 className="font-display text-3xl mt-1 mb-3">Every storyteller needs a lantern</h1>
                <p className="text-ink-soft leading-relaxed mb-6">
                    Wordbound&apos;s living world — its narrator, its characters, its voices — runs on
                    OpenAI. That costs a small amount each time the story moves. Choose how yours is powered
                    (you can change this any time):
                </p>
                <WelcomeChoice
                    currentMode={user?.billingMode ?? null}
                    starterSparks={STARTER_SPARKS}
                />
            </Parchment>
        </main>
    );
}
