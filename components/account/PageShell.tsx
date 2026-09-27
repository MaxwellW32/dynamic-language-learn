import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";

/**
 * A page of the account and study side: one framed sheet of parchment laid
 * on the desk, with the way back to the shelf always in the same corner.
 */
export function PageShell({ title, subtitle, children, wide = false }: {
    title: string;
    subtitle?: ReactNode;
    children: ReactNode;
    /** the study hall holds a grid of words and wants a little more room */
    wide?: boolean;
}) {
    return (
        <main className="min-h-dvh px-3 py-6 sm:px-6 sm:py-10">
            {/* a fade, not a slide: a transform here would become the containing block of the fixed word card and pin it to the page instead of the screen */}
            <div className={`mx-auto ${wide ? "max-w-[60rem]" : "max-w-[56rem]"} animate-fade`}>
                <Link
                    href="/"
                    className="inline-block mb-3 font-display text-parchment/80 hover:text-parchment tracking-wide"
                >
                    ← your shelf
                </Link>
                <Panel framed className="px-4 py-6 sm:px-10 sm:py-10">
                    <header className="text-center mb-6 sm:mb-8">
                        <h1 className="font-display text-3xl sm:text-4xl text-ink leading-tight">{title}</h1>
                        {subtitle && <p className="mt-2 text-lg text-ink-soft">{subtitle}</p>}
                        <Flourish />
                    </header>
                    {children}
                </Panel>
            </div>
        </main>
    );
}

/** a small printer's ornament under a heading */
export function Flourish({ className = "" }: { className?: string }) {
    return (
        <div className={`flex items-center justify-center gap-3 mt-3 text-gold ${className}`} aria-hidden>
            <span className="h-px w-16 bg-linear-to-r from-transparent to-wood/50" />
            <span className="text-sm">❦</span>
            <span className="h-px w-16 bg-linear-to-l from-transparent to-wood/50" />
        </div>
    );
}

/** a section heading inside a page */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-double border-wood/40 pb-1 mb-4">
            <h2 className="font-display text-2xl text-ink">{children}</h2>
            {aside}
        </div>
    );
}
