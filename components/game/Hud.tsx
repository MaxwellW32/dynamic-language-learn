"use client";

import Link from "next/link";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useState } from "react";
import { formatMoney } from "@/server/ai/pricing";
import { Meter } from "@/components/ui/Panel";
import {
    bookAtom, busyAtom, journalAtom, learnerAtom, modeAtom, nearestAtom,
    sceneAtom, stickAtom, storyAtom, walletAtom, worldReadyAtom,
} from "./state";
import { useGame } from "./useGame";

/** remembered on the device: the hints are for someone's first minutes, not their fiftieth hour */
const hintsSeenAtom = atomWithStorage("wordbound.hints-seen", false);

const TIME_ICON: Record<string, string> = { dawn: "🌅", day: "☀️", golden: "🌤️", dusk: "🌇", night: "🌙" };
export const GOAL_ICON: Record<string, string> = { talk: "💬", persuade: "🎭", fight: "⚔️", visit: "🧭", examine: "🔎" };

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
    const story = useAtomValue(storyAtom);
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
                    <IconButton label="What the story asks" onClick={() => setJournal("goals")}>📜</IconButton>
                    <IconButton label="People you have met" onClick={() => setJournal("people")}>✉️</IconButton>
                    <Link href="/" className="glass rounded-lg w-10 h-10 grid place-items-center text-lg hover:bg-night/75 transition-colors" aria-label="Back to your shelf" title="Back to your shelf">
                        🚪
                    </Link>
                </div>
            </header>

            {exploring && <GoalTracker />}

            {/* the page is ready to turn */}
            {exploring && !busy && story?.due === "turn" && book.status === "active" && (
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

/**
 * What the story asks, kept small at the edge of the world: the chapter's
 * checklist, one goal in hand at a time. What has been done is ticked; what
 * did not come off is crossed out, kindly; what is still to come stays unseen.
 * On a small screen only the goal in hand is shown.
 */
function GoalTracker() {
    const story = useAtomValue(storyAtom);
    const setJournal = useSetAtom(journalAtom);
    const [open, setOpen] = useState(true);
    if (!story || story.chapter.title === "") return null;

    const inHand = story.goals.find((goal) => goal.status === "active");
    const behind = story.goals.filter((goal) => goal.status !== "active").slice(-4);
    const resting = story.due === "turn" ? "the chapter is told — turn the page"
        : story.due !== null ? "the storyteller is writing…"
        : null;

    return (
        <aside className="absolute top-[4.6rem] left-3 z-10 w-72 max-w-[78vw]">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="glass rounded-t-lg px-3 py-1 text-xs tracking-widest uppercase text-parchment/80 cursor-pointer w-full text-left flex justify-between gap-2"
                aria-expanded={open}
            >
                <span className="truncate">Chapter {story.chapter.index} of {story.chapter.of} · {story.chapter.title}</span>
                <span aria-hidden>{open ? "–" : "+"}</span>
            </button>
            {open && (
                <div className="glass rounded-b-lg !border-t-0 px-3 py-2 grid gap-1">
                    <ul className="hidden md:grid gap-0.5">
                        {behind.map((goal) => (
                            <li key={goal.id} className={`text-sm leading-snug flex gap-1.5 ${goal.status === "failed" ? "text-parchment/45" : "text-parchment/50"}`}>
                                <span aria-hidden>{goal.status === "failed" ? "🍃" : "✓"}</span>
                                <span className={goal.status === "failed" ? "line-through decoration-rose/70" : "line-through"}>{goal.title}</span>
                            </li>
                        ))}
                    </ul>
                    {inHand ? (
                        <button type="button" onClick={() => setJournal("goals")} className="text-left flex gap-2 cursor-pointer">
                            <span aria-hidden>{GOAL_ICON[inHand.kind] ?? "•"}</span>
                            <span className="leading-snug">
                                <span className="font-display text-base text-gold-bright">{inHand.title}</span>
                                {inHand.whereName && <span className="block text-sm text-parchment/65">in {inHand.whereName} — follow the marked gate</span>}
                            </span>
                        </button>
                    ) : (
                        <p className="text-sm text-parchment/75 italic">{resting ?? "the world is yours to wander"}</p>
                    )}
                    {story.ahead > 0 && inHand && (
                        <p className="hidden md:block text-xs text-parchment/45">{story.ahead === 1 ? "one more thing" : `${story.ahead} more things`} after this</p>
                    )}
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
