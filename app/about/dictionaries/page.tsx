import type { ReactNode } from "react";
import { PageShell } from "@/components/account/PageShell";

export const metadata = { title: "Where the words come from — Wordbound" };

/*
 * Attribution the dictionaries' licences require. Public: no sign-in, so it
 * can be linked from anywhere, including the landing page.
 */

const SOURCES: { name: string; href: string; for: string; by: ReactNode; licence: ReactNode }[] = [
    {
        name: "Wiktionary",
        href: "https://en.wiktionary.org/",
        for: "Spanish, French, German, Italian, Portuguese and Korean",
        by: (
            <>
                the Wiktionary community, extracted by <A href="https://kaikki.org/">kaikki.org</A> using
                Tatu Ylonen’s <A href="https://github.com/tatuylonen/wiktextract">Wiktextract</A>
            </>
        ),
        licence: (
            <>
                <A href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</A> and
                the <A href="https://www.gnu.org/licenses/fdl-1.3.html">GNU Free Documentation Licence</A>
            </>
        ),
    },
    {
        name: "JMdict",
        href: "https://www.edrdg.org/jmdict/j_jmdict.html",
        for: "Japanese",
        by: (
            <>
                the <A href="https://www.edrdg.org/">Electronic Dictionary Research and Development Group</A>, by way
                of the <A href="https://github.com/scriptin/jmdict-simplified">jmdict-simplified</A> project
            </>
        ),
        licence: <A href="https://www.edrdg.org/edrdg/licence.html">CC BY-SA 4.0</A>,
    },
    {
        name: "CC-CEDICT",
        href: "https://cc-cedict.org/wiki/",
        for: "Mandarin Chinese",
        by: <>the CC-CEDICT contributors</>,
        licence: <A href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</A>,
    },
    {
        name: "FrequencyWords",
        href: "https://github.com/hermitdave/FrequencyWords",
        for: "how common each word is, in every language",
        by: (
            <>
                Hermit Dave, built from subtitles collected by <A href="https://www.opensubtitles.org/">OpenSubtitles</A>
            </>
        ),
        licence: <A href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</A>,
    },
];

export default function DictionariesPage() {
    return (
        <PageShell title="Where the words come from">
            <div className="mx-auto max-w-2xl text-lg leading-relaxed">
                <p>
                    Every word card in Wordbound — what a word means, how it sounds, how it is used — comes from open
                    dictionaries that people have written and shared freely. We are grateful to them, and their
                    licences ask that we say so. Here they are.
                </p>

                <ol className="mt-6 border-t-2 border-double border-ink/30">
                    {SOURCES.map((source) => (
                        <li key={source.name} className="border-b border-ink/15 py-4">
                            <h2 className="font-display text-2xl">
                                <A href={source.href}>{source.name}</A>
                            </h2>
                            <p className="mt-1 font-hand text-xl leading-tight text-moss-deep">for {source.for}</p>
                            <p className="mt-1">By {source.by}.</p>
                            <p className="text-ink-soft">Shared under {source.licence}.</p>
                        </li>
                    ))}
                </ol>

                <p className="mt-6">
                    For the most common words, the meanings and example sentences were also reviewed, and sometimes
                    written, with the help of an AI model.
                </p>
            </div>
        </PageShell>
    );
}

function A({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-ember-deep underline decoration-dotted underline-offset-4 hover:text-ember">
            {children}
        </a>
    );
}
