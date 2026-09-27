"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { isLangCode, LANGUAGES } from "@/game/languages";
import { forgeAction } from "@/server/actions/books";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";

const POLL_MS = 2500;

type ForgeStatus = { status: string; note: string; title: string };

/** asked over a plain request: a server action would queue behind the forge it is asking about */
async function forgeStatus(bookId: string): Promise<ForgeStatus | null> {
    try {
        const response = await fetch(`/api/books/${bookId}/forge`, { cache: "no-store" });
        return response.ok ? ((await response.json()) as ForgeStatus) : null;
    } catch {
        return null;
    }
}

/** what the storyteller is doing, for the moments the server has not said */
const MUSINGS = [
    "sharpening a quill…",
    "choosing a name for the wind…",
    "deciding who keeps a secret…",
    "hiding something under a stone…",
    "teaching the villagers their lines…",
    "lighting the lamps…",
    "pressing flowers between the pages…",
];

/**
 * The wait while a world is made — a minute or so. The forge runs as one
 * long request; this screen starts it, and meanwhile asks the server how far
 * along it is so that the wait has something to show.
 */
export function ForgeScreen({ bookId, playerName, language, failed }: {
    bookId: string; playerName: string; language: string; failed: boolean;
}) {
    const router = useRouter();
    const [note, setNote] = useState("Summoning the storyteller…");
    const [title, setTitle] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(failed ? "The last attempt did not finish." : null);
    const [attempt, setAttempt] = useState(failed ? 0 : 1);
    const [musing, setMusing] = useState(0);
    const started = useRef(0);
    const opened = useRef(false);

    // the book is written: open it, once, whoever noticed first
    const open = useCallback(() => {
        if (opened.current) return;
        opened.current = true;
        router.refresh();
    }, [router]);

    // start the forge (at most once per attempt, even when React runs the effect twice in development)
    useEffect(() => {
        if (attempt === 0 || started.current === attempt) return;
        started.current = attempt;
        forgeAction(bookId).then((result) => {
            if (result.ok && result.data.status === "active") open();
            else if (!result.ok) setError(result.error);
        });
    }, [attempt, bookId, open]);

    // and watch it work
    useEffect(() => {
        if (attempt === 0 || error) return;
        const timer = window.setInterval(async () => {
            if (opened.current) return;
            const status = await forgeStatus(bookId);
            if (!status) return;
            if (status.status === "active") {
                open();
                return;
            }
            if (status.note === "failed") setError("The storyteller lost the thread.");
            else if (status.note) setNote(status.note);
            if (status.title && status.title !== "An Unwritten Tale") setTitle(status.title);
        }, POLL_MS);
        return () => window.clearInterval(timer);
    }, [attempt, bookId, error, open]);

    useEffect(() => {
        const timer = window.setInterval(() => setMusing((m) => (m + 1) % MUSINGS.length), 4200);
        return () => window.clearInterval(timer);
    }, []);

    const lang = isLangCode(language) ? LANGUAGES[language] : null;

    return (
        <main className="min-h-dvh grid place-items-center px-4 py-10">
            <Panel framed className="w-full max-w-xl px-6 sm:px-10 py-10 text-center animate-page-in">
                {error ? (
                    <>
                        <p className="text-5xl" aria-hidden>🕯️</p>
                        <h1 className="font-display text-3xl mt-3">The ink ran dry</h1>
                        <p className="text-ink-soft mt-2">{error} Nothing was lost — and you are not charged again for what is rewritten.</p>
                        <div className="mt-6 flex flex-wrap justify-center gap-3">
                            <Button
                                variant="primary"
                                onClick={() => {
                                    setError(null);
                                    setNote("Summoning the storyteller…");
                                    setAttempt((a) => a + 1);
                                }}
                            >
                                Try again
                            </Button>
                            <Link href="/" className="font-display rounded-md border border-b-4 border-wood/50 bg-parchment-deep px-4 py-2 hover:bg-parchment-dark">
                                Back to your shelf
                            </Link>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-6xl inline-block animate-quill" aria-hidden>✒️</p>
                        <p className="font-hand text-2xl text-ember-deep mt-4">a book is being written for {playerName}</p>
                        <h1 className="font-display text-4xl mt-1 min-h-[2.6rem] animate-fade" key={title ?? "untitled"}>
                            {title ?? "…"}
                        </h1>
                        <p className="text-lg text-ink mt-5" role="status">{note}</p>
                        <p className="font-hand text-xl text-ink-faint mt-1 animate-fade" key={musing}>{MUSINGS[musing]}</p>
                        <p className="text-sm text-ink-faint mt-8">
                            A whole world takes about a minute: its places, its people and their secrets
                            {lang ? `, and the ${lang.name} they will teach you` : ""}.
                        </p>
                    </>
                )}
            </Panel>
        </main>
    );
}
