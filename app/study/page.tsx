import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/account/PageShell";
import { StudyHall } from "@/components/study/StudyHall";
import { requireUser } from "@/server/auth";
import { myLanguagesAction } from "@/server/actions/account";
import { satchelAction } from "@/server/actions/game";
import { IMMERSION_NAMES } from "@/server/services/learning";

export const metadata = { title: "The study hall — Wordbound" };

export default async function StudyPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
    // redirect() works by throwing, so it must stay outside the catch
    const me = await requireUser().catch(() => null);
    if (!me) redirect("/");

    const languages = await myLanguagesAction();
    const list = languages.ok ? languages.data : [];
    const { lang: asked } = await searchParams;
    const first = list.find((l) => l.lang === asked) ?? list[0];

    if (!first) {
        return (
            <PageShell title="The study hall" subtitle="A quiet place to practise your words.">
                <div className="text-center py-6">
                    <p className="text-xl">The shelves here are empty for now.</p>
                    <p className="mt-2 text-ink-soft">
                        Begin a book, and every word you meet in it will wait for you here to practise.
                    </p>
                    <Link href="/" className="mt-5 inline-block font-display text-lg text-ember-deep underline decoration-dotted underline-offset-4 hover:text-ember">
                        Start a book from your shelf
                    </Link>
                </div>
            </PageShell>
        );
    }

    const satchel = await satchelAction(first.lang, "all");
    return (
        <PageShell title="The study hall" subtitle="A quiet place to practise your words, away from the story." wide>
            <StudyHall
                languages={list}
                initialLang={first.lang}
                initialWords={satchel.ok ? satchel.data.words : []}
                levelNames={[...IMMERSION_NAMES]}
            />
        </PageShell>
    );
}
