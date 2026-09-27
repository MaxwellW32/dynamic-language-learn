"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { LANG_CODES, LANGUAGES, type LangCode } from "@/game/languages";
import {
    ACCESSORIES, BUILDS, CLOTH_COLORS, HAIR_COLORS, HAIR_STYLES, HATS, OUTFITS, SKIN_TONES,
    type ActorLook,
} from "@/game/looks";
import type { WalletView } from "@/game/payloads";
import { createBookAction } from "@/server/actions/books";
import { Button } from "@/components/ui/Button";
import { LangMark } from "@/components/ui/LangMark";
import { Panel } from "@/components/ui/Panel";
import { HeroPreview } from "./HeroPreview";

const LEVELS = [
    { value: 0, name: "Brand new", blurb: "I know a word or two, if that." },
    { value: 1, name: "A little", blurb: "I can greet people and order a coffee." },
    { value: 2, name: "Getting by", blurb: "I can hold a simple conversation." },
    { value: 3, name: "Comfortable", blurb: "I read and talk, and want to go deeper." },
];

const BOLDNESS = [
    { value: -1, name: "Cozy", blurb: "Ease me in. Keep most of it in English for longer." },
    { value: 0, name: "Balanced", blurb: "Grow with me." },
    { value: 1, name: "Bold", blurb: "Throw me in. I will work it out." },
];

const GENRES = [
    { name: "Cozy fantasy", icon: "🏡" }, { name: "Mystery", icon: "🕯️" }, { name: "Seafaring adventure", icon: "⛵" },
    { name: "Fairy tale", icon: "🦊" }, { name: "Mythic quest", icon: "🗡️" }, { name: "Ghost story", icon: "👻" },
    { name: "Travelling merchants", icon: "🐪" }, { name: "Festival and feast", icon: "🏮" },
];

const TONES = ["warm", "funny", "mysterious", "adventurous", "gentle", "bittersweet", "whimsical", "eerie"];

const STEPS = ["Language", "Story", "Hero"] as const;

const START_LOOK: ActorLook = {
    build: "average", age: "adult", skin: "tan", hair: "short", hairColor: "brown", beard: false,
    outfit: "cloak", primary: "teal", secondary: "crimson", hat: "none", accessory: "satchel",
};

const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

function randomLook(): ActorLook {
    const cloth = Object.keys(CLOTH_COLORS) as ActorLook["primary"][];
    return {
        build: pick(BUILDS), age: "adult",
        skin: pick(Object.keys(SKIN_TONES) as ActorLook["skin"][]),
        hair: pick(HAIR_STYLES),
        hairColor: pick(Object.keys(HAIR_COLORS) as ActorLook["hairColor"][]),
        beard: Math.random() < 0.2,
        outfit: pick(OUTFITS), primary: pick(cloth), secondary: pick(cloth),
        hat: Math.random() < 0.5 ? pick(HATS) : "none",
        accessory: Math.random() < 0.6 ? pick(ACCESSORIES) : "none",
    };
}

/** three questions and a book: what to learn, what kind of story, who you are in it */
export function NewBookWizard({ defaultName, wallet }: { defaultName: string; wallet: WalletView }) {
    const router = useRouter();
    const [step, setStep] = useState(0);
    const [language, setLanguage] = useState<LangCode | null>(null);
    const [level, setLevel] = useState(0);
    const [bias, setBias] = useState(0);
    const [genre, setGenre] = useState(GENRES[0].name);
    const [tones, setTones] = useState<string[]>(["warm", "adventurous"]);
    const [wish, setWish] = useState("");
    const [name, setName] = useState(defaultName);
    const [look, setLook] = useState<ActorLook>(START_LOOK);
    const [creating, setCreating] = useState(false);

    const broke = wallet.mode === "credits" && wallet.balanceMicros <= 0;
    const canGoOn = step === 0 ? language !== null : step === 1 ? genre.length > 0 : name.trim().length > 0;

    const create = async () => {
        if (!language || creating) return;
        setCreating(true);
        const result = await createBookAction({
            language, startingLevel: level, immersionBias: bias,
            playerName: name.trim(), heroLook: look,
            genre, tone: tones.join(", ") || "warm", wish: wish.trim(),
        });
        if (result.ok) {
            router.push(`/book/${result.data.bookId}`);
        } else {
            toast.error(result.error);
            setCreating(false);
        }
    };

    const toggleTone = (tone: string) =>
        setTones((current) => (current.includes(tone) ? current.filter((t) => t !== tone) : current.length < 3 ? [...current, tone] : current));

    return (
        <main className="min-h-dvh px-3 sm:px-6 py-6 sm:py-10">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <Link href="/" className="text-parchment/70 hover:text-parchment underline underline-offset-4">← your shelf</Link>
                    <ol className="flex items-center gap-2 text-parchment/80 font-display">
                        {STEPS.map((label, i) => (
                            <li key={label} className="flex items-center gap-2">
                                {i > 0 && <span className="text-parchment/30" aria-hidden>—</span>}
                                <button
                                    type="button"
                                    disabled={i > step}
                                    onClick={() => setStep(i)}
                                    className={`cursor-pointer disabled:cursor-default ${i === step ? "text-gold-bright" : i < step ? "text-parchment/80 hover:text-parchment" : "text-parchment/35"}`}
                                    aria-current={i === step ? "step" : undefined}
                                >
                                    {label}
                                </button>
                            </li>
                        ))}
                    </ol>
                </div>

                <Panel framed className="px-4 sm:px-10 py-6 sm:py-8 animate-page-in" key={step}>
                    {step === 0 && (
                        <section>
                            <h1 className="font-display text-4xl text-center">What would you like to learn?</h1>
                            <p className="font-hand text-2xl text-ink-soft text-center">the book will teach it to you as you live in it</p>

                            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {LANG_CODES.map((code) => {
                                    const lang = LANGUAGES[code];
                                    return (
                                        <button
                                            key={code}
                                            type="button"
                                            onClick={() => setLanguage(code)}
                                            aria-pressed={language === code}
                                            className={`rounded-md border-2 px-3 py-3 text-center cursor-pointer transition-all ${language === code ? "border-ember bg-ember/12 -translate-y-0.5 shadow-card" : "border-wood/30 bg-[#fffaf0]/60 hover:border-ember/60"}`}
                                        >
                                            <LangMark code={code} size="lg" />
                                            <div className="font-display text-xl leading-tight mt-1">{lang.name}</div>
                                            <div className="text-ink-soft text-sm">{lang.endonym}</div>
                                            <div className="font-hand text-lg text-ember-deep mt-1" lang={lang.locale}>{lang.greeting}</div>
                                        </button>
                                    );
                                })}
                            </div>

                            <h2 className="font-display text-2xl mt-8">Where are you starting from?</h2>
                            <div className="mt-2 grid sm:grid-cols-4 gap-2">
                                {LEVELS.map((option) => (
                                    <Option key={option.value} chosen={level === option.value} onClick={() => setLevel(option.value)} name={option.name} blurb={option.blurb} />
                                ))}
                            </div>

                            <h2 className="font-display text-2xl mt-6">How boldly should the book use it?</h2>
                            <div className="mt-2 grid sm:grid-cols-3 gap-2">
                                {BOLDNESS.map((option) => (
                                    <Option key={option.value} chosen={bias === option.value} onClick={() => setBias(option.value)} name={option.name} blurb={option.blurb} />
                                ))}
                            </div>
                        </section>
                    )}

                    {step === 1 && (
                        <section>
                            <h1 className="font-display text-4xl text-center">What kind of story?</h1>
                            <p className="font-hand text-2xl text-ink-soft text-center">choose a shelf — the storyteller will do the rest</p>

                            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {GENRES.map((option) => (
                                    <button
                                        key={option.name}
                                        type="button"
                                        onClick={() => setGenre(option.name)}
                                        aria-pressed={genre === option.name}
                                        className={`rounded-md border-2 px-3 py-3 text-center cursor-pointer transition-all ${genre === option.name ? "border-ember bg-ember/12 shadow-card" : "border-wood/30 bg-[#fffaf0]/60 hover:border-ember/60"}`}
                                    >
                                        <div className="text-3xl" aria-hidden>{option.icon}</div>
                                        <div className="font-display text-lg leading-tight mt-1">{option.name}</div>
                                    </button>
                                ))}
                            </div>

                            <h2 className="font-display text-2xl mt-7">And its mood? <span className="text-base text-ink-faint font-body">up to three</span></h2>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {TONES.map((tone) => (
                                    <button
                                        key={tone}
                                        type="button"
                                        onClick={() => toggleTone(tone)}
                                        aria-pressed={tones.includes(tone)}
                                        className={`rounded-full border-2 px-4 py-1 text-lg cursor-pointer transition-colors ${tones.includes(tone) ? "border-ember bg-ember/15" : "border-wood/30 bg-[#fffaf0]/60 hover:border-ember/60"}`}
                                    >
                                        {tone}
                                    </button>
                                ))}
                            </div>

                            <h2 className="font-display text-2xl mt-7">Anything you wish for? <span className="text-base text-ink-faint font-body">or leave it to the storyteller</span></h2>
                            <textarea
                                value={wish}
                                onChange={(event) => setWish(event.target.value)}
                                maxLength={500}
                                rows={3}
                                placeholder="a lighthouse keeper who has lost her light… a town where it is always the evening before a festival…"
                                aria-label="Your wish for the story"
                                className="mt-2 w-full rounded-md border-2 border-wood/35 bg-[#fffaf0] px-3 py-2 text-lg leading-snug outline-none focus:border-ember resize-y"
                            />
                        </section>
                    )}

                    {step === 2 && (
                        <section>
                            <h1 className="font-display text-4xl text-center">And who are you, in it?</h1>
                            <div className="mt-5 grid md:grid-cols-[18rem_1fr] gap-6 items-start">
                                <div>
                                    <div className="rounded-md overflow-hidden border border-wood/30 bg-gradient-to-b from-[#bfe3f7] to-[#f7ecd4]">
                                        <HeroPreview look={look} className="w-full aspect-[3/4]" />
                                    </div>
                                    <Button variant="quiet" className="w-full mt-2" onClick={() => setLook(randomLook())}>🎲 Surprise me</Button>
                                </div>

                                <div className="grid gap-4">
                                    <label className="grid gap-1">
                                        <span className="font-display text-xl">Your name</span>
                                        <input
                                            value={name}
                                            onChange={(event) => setName(event.target.value)}
                                            maxLength={40}
                                            placeholder="what the villagers will call you"
                                            className="rounded-md border-2 border-wood/35 bg-[#fffaf0] px-3 py-2 text-xl outline-none focus:border-ember"
                                        />
                                    </label>

                                    <Swatches label="Skin" colors={SKIN_TONES} value={look.skin} onPick={(skin) => setLook({ ...look, skin })} />
                                    <Choices label="Hair" options={HAIR_STYLES} value={look.hair} onPick={(hair) => setLook({ ...look, hair })} />
                                    <Swatches label="Hair colour" colors={HAIR_COLORS} value={look.hairColor} onPick={(hairColor) => setLook({ ...look, hairColor })} />
                                    <Choices label="Clothes" options={OUTFITS} value={look.outfit} onPick={(outfit) => setLook({ ...look, outfit })} />
                                    <Swatches label="Their colour" colors={CLOTH_COLORS} value={look.primary} onPick={(primary) => setLook({ ...look, primary })} />
                                    <Swatches label="And trim" colors={CLOTH_COLORS} value={look.secondary} onPick={(secondary) => setLook({ ...look, secondary })} />
                                    <Choices label="On your head" options={HATS} value={look.hat} onPick={(hat) => setLook({ ...look, hat })} />
                                    <Choices label="You carry" options={ACCESSORIES} value={look.accessory} onPick={(accessory) => setLook({ ...look, accessory })} />
                                    <Choices label="Build" options={BUILDS} value={look.build} onPick={(build) => setLook({ ...look, build })} />
                                </div>
                            </div>
                        </section>
                    )}

                    <footer className="mt-8 flex items-center justify-between gap-3">
                        {step > 0 ? <Button variant="quiet" onClick={() => setStep(step - 1)}>← Back</Button> : <span />}
                        {step < STEPS.length - 1 ? (
                            <Button variant="primary" size="lg" disabled={!canGoOn} onClick={() => setStep(step + 1)}>Go on →</Button>
                        ) : (
                            <div className="text-right">
                                <Button variant="primary" size="lg" disabled={!canGoOn || creating || broke} onClick={create}>
                                    {creating ? "Opening the cover…" : "✒️ Write my book"}
                                </Button>
                                <p className="text-sm text-ink-faint mt-1">
                                    {broke ? <>Your wallet is empty — <Link href="/wallet" className="underline">add credit</Link> first.</>
                                        : wallet.mode === "credits" ? "Writing a world costs about 7 cents from your wallet."
                                        : "Written with your own key."}
                                </p>
                            </div>
                        )}
                    </footer>
                </Panel>
            </div>
        </main>
    );
}

function Option({ chosen, onClick, name, blurb }: { chosen: boolean; onClick: () => void; name: string; blurb: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={chosen}
            className={`rounded-md border-2 px-3 py-2 text-left cursor-pointer transition-colors ${chosen ? "border-ember bg-ember/12" : "border-wood/30 bg-[#fffaf0]/60 hover:border-ember/60"}`}
        >
            <div className="font-display text-xl leading-tight">{name}</div>
            <div className="text-sm text-ink-soft leading-snug">{blurb}</div>
        </button>
    );
}

function Swatches<K extends string>({ label, colors, value, onPick }: {
    label: string; colors: Record<K, number>; value: K; onPick: (key: K) => void;
}) {
    return (
        <div>
            <div className="font-display text-lg leading-tight">{label}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
                {(Object.keys(colors) as K[]).map((key) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => onPick(key)}
                        aria-pressed={value === key}
                        aria-label={key}
                        title={key}
                        className={`w-8 h-8 rounded-full cursor-pointer border-2 transition-transform ${value === key ? "border-ink scale-110 shadow-card" : "border-wood/30 hover:scale-105"}`}
                        style={{ backgroundColor: hex(colors[key]) }}
                    />
                ))}
            </div>
        </div>
    );
}

function Choices<T extends string>({ label, options, value, onPick }: {
    label: string; options: readonly T[]; value: T; onPick: (option: T) => void;
}) {
    return (
        <div>
            <div className="font-display text-lg leading-tight">{label}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <button
                        key={option}
                        type="button"
                        onClick={() => onPick(option)}
                        aria-pressed={value === option}
                        className={`rounded-full border px-3 py-0.5 cursor-pointer transition-colors ${value === option ? "border-ember bg-ember/15" : "border-wood/30 bg-[#fffaf0]/60 hover:border-ember/60"}`}
                    >
                        {option === "fishingrod" ? "fishing rod" : option}
                    </button>
                ))}
            </div>
        </div>
    );
}
