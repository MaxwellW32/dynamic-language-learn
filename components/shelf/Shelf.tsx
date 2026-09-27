"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { isLangCode, LANGUAGES } from "@/game/languages";
import { LangMark } from "@/components/ui/LangMark";
import type { WalletView } from "@/game/payloads";
import { formatMoney } from "@/server/ai/pricing";
import { deleteBookAction } from "@/server/actions/books";
import type { BookSummary } from "@/server/services/overview";

/** cloth for a book's cover, by the land its story begins in */
const BINDING: Record<string, [string, string]> = {
    meadow: ["#5f8a45", "#3f6330"], forest: ["#3f6b45", "#2a4a30"], autumn: ["#b8632a", "#84421a"],
    sakura: ["#c9708c", "#8f4a62"], snow: ["#6f8fae", "#4a6783"], desert: ["#c9974a", "#8f6a2f"],
    coast: ["#2f8f9a", "#1f6570"], swamp: ["#5a6b45", "#3d4a30"], highland: ["#6a7a8a", "#47535f"],
    volcanic: ["#8a3a2a", "#5a241a"], crystal: ["#5a5fa8", "#3a3f78"], twilight: ["#6a4f8a", "#47345f"],
};

const STAGE: Record<string, string> = {
    introduction: "just begun", rising: "the plot thickens", climax: "at its height",
    falling: "after the storm", resolution: "drawing to a close",
};

function ago(iso: string): string {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 2) return "just now";
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
}

export function Shelf({ name, books, wallet, leave }: {
    name: string | null;
    books: BookSummary[];
    wallet: WalletView;
    leave: () => Promise<void>;
}) {
    return (
        <main className="min-h-dvh px-4 sm:px-8 py-8 max-w-6xl mx-auto">
            <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
                <div>
                    <h1 className="font-display text-4xl sm:text-5xl text-parchment drop-shadow">{name ? `${name}’s shelf` : "Your shelf"}</h1>
                    <p className="font-hand text-2xl text-gold-bright mt-1">every book is a world that teaches you its words</p>
                </div>
                <nav className="flex flex-wrap items-center gap-2 text-parchment">
                    <Link href="/study" className="glass rounded-lg px-3.5 py-2 hover:bg-night/80 transition-colors">✦ Study hall</Link>
                    <Link
                        href={wallet.mode ? "/wallet" : "/welcome"}
                        className={`glass rounded-lg px-3.5 py-2 hover:bg-night/80 transition-colors ${wallet.low ? "!border-ember text-gold-bright animate-glint" : ""}`}
                    >
                        {wallet.mode === "credits" ? `Wallet · ${formatMoney(Math.max(0, wallet.balanceMicros))}` : wallet.mode === "byok" ? "🔑 Your key" : "Choose how to pay"}
                    </Link>
                    <form action={leave}>
                        <button className="rounded-lg px-3 py-2 text-parchment/70 hover:text-parchment underline underline-offset-4 cursor-pointer">sign out</button>
                    </form>
                </nav>
            </header>

            {/* the shelf itself: books stand on a plank */}
            <div className="grid gap-x-6 gap-y-10 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {books.map((book) => <BookCover key={book.id} book={book} />)}

                <Link href="/book/new" className="group block">
                    <div className="aspect-[3/4] rounded-r-md rounded-l-sm border-2 border-dashed border-parchment/35 grid place-items-center text-center px-4 text-parchment/70 transition-colors group-hover:border-gold-bright group-hover:text-gold-bright">
                        <div>
                            <div className="text-5xl" aria-hidden>✒️</div>
                            <div className="font-display text-2xl mt-2">Begin a new book</div>
                            {books.length === 0 && <p className="font-hand text-xl mt-1">your shelf is empty — start here</p>}
                        </div>
                    </div>
                    <div className="h-3 mt-2 rounded-sm bg-gradient-to-b from-wood to-wood-dark shadow-card" aria-hidden />
                </Link>
            </div>
        </main>
    );
}

function BookCover({ book }: { book: BookSummary }) {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [cloth, shade] = BINDING[book.biome] ?? BINDING.meadow;
    const language = isLangCode(book.targetLanguage) ? LANGUAGES[book.targetLanguage] : null;

    const remove = async () => {
        setRemoving(true);
        const result = await deleteBookAction(book.id);
        if (result.ok) {
            toast("The book is gone from your shelf.");
            router.refresh();
        } else {
            toast.error(result.error);
            setRemoving(false);
            setConfirming(false);
        }
    };

    return (
        <div className={`group relative ${removing ? "opacity-40 pointer-events-none" : ""}`}>
            <Link href={`/book/${book.id}`} className="block transition-transform duration-200 group-hover:-translate-y-2">
                <div
                    className="relative aspect-[3/4] rounded-r-md rounded-l-sm shadow-page overflow-hidden flex flex-col justify-between px-4 sm:px-5 py-5 text-parchment"
                    style={{ background: `linear-gradient(135deg, ${cloth}, ${shade})` }}
                >
                    {/* the spine, and a tooled border */}
                    <div className="absolute inset-y-0 left-0 w-3 bg-black/25" aria-hidden />
                    <div className="absolute inset-2 left-5 border border-gold-bright/45 rounded-sm pointer-events-none" aria-hidden />

                    <div className="relative pl-3">
                        {language && <LangMark code={language.code} />}
                        <h2 className="font-display text-2xl sm:text-[1.7rem] leading-[1.1] mt-2 drop-shadow break-words">{book.title}</h2>
                    </div>
                    <div className="relative pl-3 text-sm text-parchment/85 leading-snug">
                        {book.status === "forging" ? (
                            <span className="font-hand text-xl text-gold-bright">still being written…</span>
                        ) : (
                            <>
                                <div className="font-hand text-xl text-gold-bright">{book.status === "completed" ? "the end" : STAGE[book.arcStage] ?? ""}</div>
                                <div>{language ? `learning ${language.name}` : ""}</div>
                                <div className="text-parchment/65">opened {ago(book.updatedAt)}</div>
                            </>
                        )}
                    </div>
                </div>
            </Link>
            <div className="h-3 mt-2 rounded-sm bg-gradient-to-b from-wood to-wood-dark shadow-card" aria-hidden />

            {confirming ? (
                <div className="absolute inset-x-2 top-2 page-float rounded-md p-3 text-center z-10 animate-rise">
                    <p className="leading-snug">Take <b>{book.title}</b> off your shelf for good?</p>
                    <div className="mt-2 flex justify-center gap-2">
                        <button type="button" onClick={remove} className="font-display rounded px-3 py-1 bg-rose text-parchment cursor-pointer hover:bg-[#a53f55]">Yes, remove it</button>
                        <button type="button" onClick={() => setConfirming(false)} className="font-display rounded px-3 py-1 border border-wood/40 cursor-pointer hover:bg-parchment-dark">Keep it</button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-night/50 text-parchment/80 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer hover:bg-night/80"
                    aria-label={`Remove ${book.title}`}
                    title="Remove from shelf"
                >
                    ×
                </button>
            )}
        </div>
    );
}
