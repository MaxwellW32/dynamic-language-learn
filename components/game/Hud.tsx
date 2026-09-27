"use client";

import Link from "next/link";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useState } from "react";
import { formatMoney } from "@/server/ai/pricing";
import { Meter } from "@/components/ui/Panel";
import {
    bookAtom, busyAtom, chapterTurnReadyAtom, journalAtom, learnerAtom, modeAtom, nearestAtom,
    questsAtom, sceneAtom, stickAtom, walletAtom, worldReadyAtom,
} from "./state";
import { useGame } from "./useGame";

/** remembered on the device: the hints are for someone's first minutes, not their fiftieth hour */
const hintsSeenAtom = atomWithStorage("wordbound.hints-seen", false);

const TIME_ICON: Record<string, string> = { dawn: "🌅", day: "☀️", golden: "🌤️", dusk: "🌇", night: "🌙" };
const KIND_ICON: Record<string, string> = { talkTo: "💬", persuade: "🎭", defeat: "⚔️", visit: "🧭", inspect: "🔎", learnWords: "✦" };

/** the small things that sit on the world all the time */
export function Hud() {
    const book = useAtomValue(bookAtom);
    const scene = useAtomValue(sceneAtom);
    const mode = useAtomValue(modeAtom);
    const ready = useAtomValue(worldReadyAtom);
    const busy = useAtomValue(busyAtom);
    const nearest = useAtomValue(nearestAtom);
    const learner = useAtomValue(learnerAtom);
    const wallet = useAtomValue(walletAtom);
    const turnReady = useAtomValue(chapterTurnReadyAtom);
    const stick = useAtomValue(stickAtom);
    const setJournal = useSetAtom(journalAtom);
    const game = useGame();

    if (!book || !scene) return null;
    const exploring = mode === "explore" && ready;

    return (
        <>
            {/* where you are */}
            <header className="absolute top-3 left-3 right-3 z-20 flex items-start justify-between gap-3 pointer-events-none">
                <button
                    type="button"
                    onClick={() => setJournal("story")}
                    className="glass pointer-events-auto rounded-lg px-3.5 py-2 text-left cursor-pointer hover:bg-night/75 transition-colors max-w-[62vw]"
                    aria-label="Open the book"
                >
                    <div className="text-xs text-parchment/70 truncate">{book.title}</div>
                    <div className="font-display text-xl leading-tight truncate">
                        <span className="mr-1.5" aria-hidden>{TIME_ICON[scene.region.timeOfDay] ?? "☀️"}</span>
                        {scene.region.name}
                    </div>
                </button>

                <div className="flex items-center gap-2 pointer-events-auto">
                    {learner && (
                        <button
                            type="button"
                            onClick={() => setJournal("words")}
                            className="glass rounded-lg px-3 py-1.5 cursor-pointer hover:bg-night/75 transition-colors hidden sm:block"
                            title={`${learner.wordsKnown} words known · ${learner.wordsDue} due`}
                        >
                            <div className="text-xs text-parchment/70 leading-none">{learner.immersionName}</div>
                            <Meter value={learner.toNext} className="w-24 mt-1.5 !bg-parchment/20" />
                        </button>
                    )}
                    {wallet && wallet.mode === "credits" && (
                        <Link
                            href="/wallet"
                            className={`glass rounded-lg px-3 py-2 text-sm whitespace-nowrap hover:bg-night/75 transition-colors ${wallet.low ? "!border-ember text-gold-bright animate-glint" : ""}`}
                            title={wallet.low ? "Your wallet is running low" : "Your wallet"}
                        >
                            ✦ {formatMoney(Math.max(0, wallet.balanceMicros))}
                        </Link>
                    )}
                    <IconButton label="The book" onClick={() => setJournal("story")}>📖</IconButton>
                    <IconButton label="Quests" onClick={() => setJournal("quests")}>📜</IconButton>
                    <Link href="/" className="glass rounded-lg w-10 h-10 grid place-items-center text-lg hover:bg-night/75 transition-colors" aria-label="Back to your shelf" title="Back to your shelf">
                        🚪
                    </Link>
                </div>
            </header>

            {exploring && <QuestTracker />}

            {/* the page is ready to turn */}
            {exploring && turnReady && book.status === "active" && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 animate-rise">
                    <button
                        type="button"
                        onClick={() => void game.turnChapter()}
                        className="rounded-full bg-gold text-night font-display text-lg px-6 py-2 shadow-float cursor-pointer hover:bg-gold-bright animate-glint"
                    >
                        ✦ Turn the page ✦
                    </button>
                </div>
            )}

            {/* what you could do here */}
            {exploring && nearest && !busy && (
                <div className="absolute bottom-8 sm:bottom-10 left-1/2 -translate-x-1/2 z-20 animate-rise">
                    <button
                        type="button"
                        onClick={() => game.act(nearest)}
                        className="page-float rounded-full pl-2 pr-5 py-1.5 flex items-center gap-2.5 cursor-pointer hover:bg-parchment transition-colors"
                    >
                        <kbd className="hidden sm:grid w-8 h-8 place-items-center rounded-full bg-ember text-parchment font-display text-base">E</kbd>
                        <span className="sm:hidden w-8 h-8 grid place-items-center rounded-full bg-ember text-parchment" aria-hidden>☝</span>
                        <span className="font-display text-lg whitespace-nowrap">
                            {nearest.verb} <span className="text-ember-deep">{nearest.name.replace(/^To /, "to ")}</span>
                        </span>
                    </button>
                </div>
            )}

            {busy && ready && (
                <div className="absolute bottom-8 sm:bottom-10 left-1/2 -translate-x-1/2 z-20 page-float rounded-full px-5 py-2 font-hand text-xl text-ink-soft animate-fade whitespace-nowrap" role="status">
                    <span className="inline-block animate-quill mr-2" aria-hidden>✒️</span>
                    {busy}
                </div>
            )}

            {exploring && <Hints />}

            {/* the joystick, drawn under the thumb that is holding it */}
            {stick && (
                <div className="absolute z-20 pointer-events-none" style={{ left: stick.originX - 56, top: stick.originY - 56 }} aria-hidden>
                    <div className="w-28 h-28 rounded-full border-2 border-parchment/50 bg-night/25" />
                    <div
                        className="absolute w-12 h-12 rounded-full bg-parchment/80 shadow-float"
                        style={{ left: 56 - 24 + stick.x, top: 56 - 24 + stick.y }}
                    />
                </div>
            )}
        </>
    );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="glass rounded-lg w-10 h-10 grid place-items-center text-lg cursor-pointer hover:bg-night/75 transition-colors"
            aria-label={label}
            title={label}
        >
            {children}
        </button>
    );
}

/** what the story is asking of you, kept small at the edge of the world */
function QuestTracker() {
    const quests = useAtomValue(questsAtom);
    const [open, setOpen] = useState(true);
    const active = quests.filter((q) => q.status === "active").slice(0, 3);
    if (active.length === 0) return null;

    return (
        <aside className="absolute top-20 left-3 z-10 w-64 max-w-[70vw] hidden md:block">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="glass rounded-t-lg px-3 py-1 text-xs tracking-widest uppercase text-parchment/80 cursor-pointer w-full text-left flex justify-between"
                aria-expanded={open}
            >
                Quests <span aria-hidden>{open ? "–" : "+"}</span>
            </button>
            {open && (
                <div className="glass rounded-b-lg !border-t-0 px-3 py-2 grid gap-2.5">
                    {active.map((quest) => (
                        <div key={quest.id}>
                            <div className="font-display text-base leading-tight text-gold-bright">{quest.title}</div>
                            <ul className="mt-0.5 grid gap-0.5">
                                {quest.objectives.map((o) => (
                                    <li key={o.id} className={`text-sm leading-snug flex gap-1.5 ${o.status === "completed" ? "text-parchment/45 line-through" : o.waiting ? "text-parchment/50" : "text-parchment/90"}`}>
                                        <span aria-hidden className="no-underline">{o.status === "completed" ? "✓" : KIND_ICON[o.kind] ?? "•"}</span>
                                        <span>
                                            {o.description}
                                            {o.targetCount > 1 && o.status !== "completed" && <span className="text-parchment/60"> {o.progress}/{o.targetCount}</span>}
                                            {o.whereName && o.status !== "completed" && <span className="text-parchment/55"> — in {o.whereName}</span>}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </aside>
    );
}

/** how to move, shown until the player has plainly worked it out */
function Hints() {
    const [seen, setSeen] = useAtom(hintsSeenAtom);
    if (seen) return null;
    return (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 glass rounded-lg px-4 py-2 text-sm text-center animate-fade max-w-[90vw]">
            <span className="hidden sm:inline">
                <b>W A S D</b> to walk · <b>drag</b> to look around · <b>scroll</b> to zoom · <b>click</b> the ground to go there
            </span>
            <span className="sm:hidden">
                <b>left thumb</b> to walk · <b>right thumb</b> to look around · <b>tap</b> the ground to go there
            </span>
            <button type="button" onClick={() => setSeen(true)} className="ml-3 underline underline-offset-2 cursor-pointer text-parchment/80">got it</button>
        </div>
    );
}
