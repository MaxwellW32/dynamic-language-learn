import { redirect } from "next/navigation";
import { PageShell } from "@/components/account/PageShell";
import { WelcomeChoice } from "@/components/account/WelcomeChoice";
import { requireUser } from "@/server/auth";

export const metadata = { title: "How to pay the storyteller — Wordbound" };

export default async function WelcomePage() {
    // redirect() works by throwing, so it must stay outside the catch
    const me = await requireUser().catch(() => null);
    if (!me) redirect("/");

    const mode = me.user.billingMode ?? null;
    return (
        <PageShell
            title={mode === null ? "Welcome to Wordbound" : "How you pay the storyteller"}
            subtitle={mode === null
                ? "Every page of your book is written for you as you play. First, choose how the storyteller is paid."
                : "You can change this whenever you like."}
        >
            <WelcomeChoice current={mode} />
        </PageShell>
    );
}
