import { auth } from "@/auth/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Parchment } from "@/components/ui/Parchment";
import { recentLedger, SPARK_COSTS } from "@/server/services/billing";

/** top-up bundles — wire these to Stripe Checkout when payments go live */
const BUNDLES = [
    { sparks: 400, price: "$4.99", note: "a few evenings of adventuring" },
    { sparks: 1000, price: "$9.99", note: "most popular", featured: true },
    { sparks: 2500, price: "$19.99", note: "a whole saga" },
];

const REASON_LABELS: Record<string, string> = {
    "starter-gift": "🎁 starter gift",
    forge: "⚒️ forged a world",
    narration: "📖 a page of story",
    dialogue: "💬 a conversation",
    chapterTurn: "📑 turned a chapter",
    speak: "🔈 a spoken line",
};

export default async function SparksPage() {
    const session = await auth();
    if (!session?.user?.id) redirect("/");

    const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
    if (!user) redirect("/");
    if (!user.billingMode) redirect("/welcome");

    const ledger = await recentLedger(session.user.id);

    return (
        <main className="min-h-dvh px-6 py-10 max-w-3xl mx-auto">
            <Link href="/" className="text-parchment/70 hover:text-parchment underline underline-offset-4">
                ← back to the shelf
            </Link>

            <Parchment framed className="p-8 mt-4 animate-page-in">
                <h1 className="font-display text-3xl">✨ Sparks</h1>
                <p className="font-hand text-2xl text-ember-deep mb-4">what keeps the lantern lit</p>

                {user.billingMode === "byok" ? (
                    <p className="text-ink-soft leading-relaxed">
                        You&apos;re using your own OpenAI key, so there&apos;s nothing to top up —
                        you pay OpenAI directly. To switch to sparks instead, choose again on the{" "}
                        <Link href="/welcome" className="underline underline-offset-2">welcome page</Link>.
                    </p>
                ) : (
                    <>
                        <p className="text-4xl font-display mb-1">{user.sparks} <span className="text-xl text-ink-soft">sparks</span></p>
                        <p className="text-sm text-ink-faint mb-6">
                            a page of story ≈ {SPARK_COSTS.narration}, a conversation turn ≈ {SPARK_COSTS.dialogue},
                            forging a new world ≈ {SPARK_COSTS.forge}
                        </p>

                        <div className="grid sm:grid-cols-3 gap-3 mb-3">
                            {BUNDLES.map((bundle) => (
                                <div
                                    key={bundle.sparks}
                                    className={`rounded-md border p-4 text-center ${bundle.featured ? "border-ember bg-gold/15" : "border-wood/40 bg-parchment-deep/50"}`}
                                >
                                    <p className="font-display text-2xl">✨ {bundle.sparks}</p>
                                    <p className="text-ink-soft">{bundle.price}</p>
                                    <p className="font-hand text-lg text-ink-faint">{bundle.note}</p>
                                    <button
                                        disabled
                                        className="mt-2 w-full font-display rounded-md border-b-4 px-3 py-1.5 bg-parchment-dark text-ink-faint border-wood/40 cursor-not-allowed"
                                        title="Payments are coming soon"
                                    >
                                        coming soon
                                    </button>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-ink-faint mb-6">
                            Top-ups arrive with the next update. Until then, your starter sparks are on us.
                        </p>
                    </>
                )}

                {ledger.length > 0 && (
                    <>
                        <h2 className="font-display text-xl mb-2">The ledger</h2>
                        <ul className="grid gap-1">
                            {ledger.map((entry) => (
                                <li key={entry.id} className="flex justify-between text-sm border-b border-wood/20 pb-1">
                                    <span className="text-ink-soft">{REASON_LABELS[entry.reason] ?? entry.reason}</span>
                                    <span className={entry.delta > 0 ? "text-moss-deep" : "text-ink-faint"}>
                                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta} → {entry.balanceAfter}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </Parchment>
        </main>
    );
}
