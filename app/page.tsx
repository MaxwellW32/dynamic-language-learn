import { auth, signIn, signOut } from "@/auth/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { listStories } from "@/server/services/story";
import { Parchment } from "@/components/ui/Parchment";
import { BillingBadge } from "@/components/onboarding/BillingBadge";
import Link from "next/link";

export default async function Home() {
    const session = await auth();

    if (!session?.user?.id) {
        return <CoverPage />;
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
    if (user && !user.billingMode) redirect("/welcome");

    const stories = await listStories(session.user.id);

    return (
        <main className="min-h-dvh px-6 py-10 max-w-5xl mx-auto">
            <header className="flex items-end justify-between mb-8 gap-4">
                <div>
                    <h1 className="font-display text-4xl text-parchment drop-shadow">Your Bookshelf</h1>
                    <p className="font-hand text-2xl text-gold mt-1">every book is a world that teaches you its words</p>
                </div>
                <div className="flex items-center gap-3">
                    <BillingBadge />
                    <form action={async () => { "use server"; await signOut(); }}>
                        <button className="text-parchment/70 hover:text-parchment underline underline-offset-4 cursor-pointer whitespace-nowrap">
                            sign out
                        </button>
                    </form>
                </div>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {stories.map((story) => (
                    <Link key={story.id} href={`/story/${story.id}`} className="group">
                        <Parchment framed className="p-5 h-56 flex flex-col justify-between transition-transform group-hover:-translate-y-1">
                            <div>
                                <h2 className="font-display text-2xl leading-tight">{story.title}</h2>
                                <p className="text-ink-soft mt-2 line-clamp-3 text-sm">{story.premise || "An unwritten tale…"}</p>
                            </div>
                            <div className="flex items-center justify-between text-sm text-ink-soft">
                                <span className="font-hand text-lg">
                                    {story.packs.map((p) => p.pack.coverEmoji).join(" ")} learning {story.targetLanguage}
                                </span>
                                <span className="capitalize">
                                    {story.status === "forging" ? "✨ being written" : story.status === "completed" ? "📕 finished" : `📖 ${story.arcStage}`}
                                </span>
                            </div>
                        </Parchment>
                    </Link>
                ))}

                <Link href="/story/new" className="group">
                    <div className="h-56 rounded-sm border-2 border-dashed border-parchment/40 flex flex-col items-center justify-center gap-2 text-parchment/70 transition-colors group-hover:border-gold group-hover:text-gold">
                        <span className="text-4xl">✒️</span>
                        <span className="font-display text-xl">Begin a new story</span>
                    </div>
                </Link>
            </div>
        </main>
    );
}

function CoverPage() {
    return (
        <main className="min-h-dvh grid place-items-center px-6">
            <Parchment framed className="max-w-lg w-full p-10 text-center animate-page-in">
                <p className="font-hand text-2xl text-ember-deep">a storybook that teaches you its language</p>
                <h1 className="font-display text-6xl mt-2 mb-4">Wordbound</h1>
                <p className="text-ink-soft leading-relaxed mb-8">
                    Open the cover and step inside: a world that remembers you,
                    characters who become your friends, and foes bested not with
                    swords — but with words you are learning.
                </p>
                <div className="grid gap-3">
                    <form action={async () => { "use server"; await signIn("google", { redirectTo: "/" }); }}>
                        <button className="w-full font-display tracking-wide rounded-md border-b-4 px-4 py-2 shadow-card bg-ember text-parchment border-ember-deep hover:bg-ember-deep cursor-pointer">
                            Open with Google
                        </button>
                    </form>
                    <form
                        action={async (formData: FormData) => {
                            "use server";
                            await signIn("nodemailer", {
                                email: String(formData.get("email") ?? ""),
                                redirectTo: "/",
                            });
                        }}
                        className="flex gap-2"
                    >
                        <input
                            type="email"
                            name="email"
                            required
                            placeholder="or enter your email…"
                            className="flex-1 rounded-md border border-wood/50 bg-parchment-deep px-3 py-2 outline-none focus:border-ember"
                        />
                        <button className="font-display rounded-md border-b-4 px-4 py-2 shadow-card bg-parchment-deep text-ink border-wood/60 hover:bg-parchment-dark cursor-pointer">
                            Send key
                        </button>
                    </form>
                </div>
            </Parchment>
        </main>
    );
}
