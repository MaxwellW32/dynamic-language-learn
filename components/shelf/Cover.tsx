"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { EngineEvents, WorldEngine } from "@/engine";
import { LANG_CODES, LANGUAGES } from "@/game/languages";
import type { ScenePayload } from "@/game/payloads";
import { WorldCanvas } from "@/components/game/WorldCanvas";
import { LangMark } from "@/components/ui/LangMark";

const PROMISES = [
    { icon: "🏘️", title: "A world you walk through", text: "Villages, wild country and old hidden places — every book has its own, and it grows as the story does." },
    { icon: "💬", title: "People who remember you", text: "Talk to anyone, about anything. They keep your promises in mind, and they talk to each other." },
    { icon: "✦", title: "A language that creeps in", text: "A word here, a greeting there, then whole sentences — until one day the book is written in it." },
    { icon: "⚔️", title: "Battles won with words", text: "Creatures yield to the right answer. What you are about to forget is what they ask you." },
];

/** the front cover: the world itself, and the way in */
export function Cover({ scene, withGoogle, withEmail }: {
    scene: ScenePayload;
    withGoogle: () => Promise<void>;
    withEmail: (formData: FormData) => Promise<void>;
}) {
    const [shown, setShown] = useState(false);

    const events = useMemo<EngineEvents>(() => ({
        onNearest: () => { }, onAct: () => { }, onContact: () => { }, onReach: () => { }, onWord: () => { }, onStick: () => { },
    }), []);

    const engineRef = useRef<WorldEngine | null>(null);
    const onEngine = useCallback((engine: WorldEngine | null) => {
        engineRef.current = engine;
    }, []);
    // nobody is playing here: once the village stands, the camera drifts round it by itself
    const onLoaded = useCallback(() => {
        engineRef.current?.setMode("cinematic");
        setShown(true);
    }, []);

    return (
        <main className="relative min-h-dvh overflow-x-hidden">
            <div className={`fixed inset-0 transition-opacity duration-[1800ms] ${shown ? "opacity-100" : "opacity-0"}`} aria-hidden>
                <CoverWorld scene={scene} events={events} onEngine={onEngine} onLoaded={onLoaded} />
                <div className="absolute inset-0 bg-gradient-to-b from-night/25 via-transparent to-night/80 pointer-events-none" />
            </div>

            <div className="relative z-10 min-h-dvh grid place-items-center px-4 py-10">
                <div className="w-full max-w-lg">
                    <section className="page-float rounded-lg px-6 sm:px-10 py-9 text-center animate-page-in">
                        <p className="font-hand text-2xl text-ember-deep">a storybook that teaches you its language</p>
                        <h1 className="font-display text-6xl sm:text-7xl mt-1">Wordbound</h1>
                        <p className="text-ink-soft text-lg leading-relaxed mt-4">
                            Open a book and step inside. Walk its villages, befriend its people,
                            and come out speaking their language.
                        </p>

                        <p className="mt-5 flex flex-wrap justify-center gap-1.5" aria-label={`Teaches ${LANG_CODES.map((c) => LANGUAGES[c].name).join(", ")}`}>
                            {LANG_CODES.map((code) => <LangMark key={code} code={code} />)}
                        </p>

                        <div className="mt-6 grid gap-3">
                            <form action={withGoogle}>
                                <button className="w-full font-display text-lg tracking-wide rounded-md border-b-4 px-4 py-2.5 shadow-card bg-ember text-parchment border-ember-deep hover:bg-ember-deep cursor-pointer active:border-b-2 active:translate-y-[2px]">
                                    Open with Google
                                </button>
                            </form>
                            <form action={withEmail} className="flex gap-2">
                                <input
                                    type="email"
                                    name="email"
                                    required
                                    placeholder="or your email, for a key by post…"
                                    aria-label="Your email"
                                    className="flex-1 rounded-md border-2 border-wood/35 bg-[#fffaf0] px-3 py-2 outline-none focus:border-ember"
                                />
                                <button className="font-display rounded-md border border-b-4 px-4 py-2 bg-parchment-deep text-ink border-wood/50 hover:bg-parchment-dark cursor-pointer whitespace-nowrap active:border-b-2 active:translate-y-[2px]">
                                    Send it
                                </button>
                            </form>
                        </div>
                    </section>
                </div>
            </div>

            <section className="relative z-10 px-4 pb-16">
                <div className="max-w-5xl mx-auto grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {PROMISES.map((promise) => (
                        <article key={promise.title} className="glass rounded-lg px-5 py-4">
                            <div className="text-3xl" aria-hidden>{promise.icon}</div>
                            <h2 className="font-display text-xl mt-1 text-gold-bright">{promise.title}</h2>
                            <p className="text-parchment/85 leading-snug mt-1">{promise.text}</p>
                        </article>
                    ))}
                </div>
                <p className="text-center text-parchment/60 text-sm mt-8">
                    Dictionaries are open data — <Link href="/about/dictionaries" className="underline underline-offset-2 hover:text-parchment">who made them</Link>.
                </p>
            </section>
        </main>
    );
}

/** the canvas without its floating names: on the cover the world is scenery */
function CoverWorld(props: { scene: ScenePayload; events: EngineEvents; onEngine: (engine: WorldEngine | null) => void; onLoaded: () => void }) {
    return (
        <div className="absolute inset-0 pointer-events-none [&_.wb-labels]:hidden">
            <WorldCanvas {...props} />
        </div>
    );
}
