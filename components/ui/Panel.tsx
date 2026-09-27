import type { HTMLAttributes, ReactNode } from "react";

/**
 * A sheet of parchment. `framed` gives it the carved wooden border used for
 * whole pages; `floating` is the lighter sheet laid over the 3D world.
 */
export function Panel({
    framed = false, floating = false, className = "", children, ...rest
}: HTMLAttributes<HTMLDivElement> & { framed?: boolean; floating?: boolean; children: ReactNode }) {
    const surface = floating ? "page-float rounded-lg" : `parchment rounded-sm ${framed ? "wood-frame" : "shadow-card"}`;
    return (
        <div {...rest} className={`${surface} ${className}`}>
            {children}
        </div>
    );
}

/** a title on a ribbon, for the head of a panel */
export function Ribbon({ children, className = "" }: { children: ReactNode; className?: string }) {
    return (
        <div className={`inline-block bg-ember text-parchment font-display tracking-wide px-5 py-1 shadow-card [clip-path:polygon(0_0,100%_0,calc(100%-10px)_50%,100%_100%,0_100%,10px_50%)] ${className}`}>
            {children}
        </div>
    );
}

/** a small label: a part of speech, a level, a tone */
export function Chip({ children, tone = "ink", className = "" }: { children: ReactNode; tone?: "ink" | "moss" | "ember" | "gold" | "sky"; className?: string }) {
    const tones = {
        ink: "bg-ink/10 text-ink-soft",
        moss: "bg-moss/15 text-moss-deep",
        ember: "bg-ember/15 text-ember-deep",
        gold: "bg-gold/25 text-[#7a5c10]",
        sky: "bg-sky/15 text-sky",
    };
    return (
        <span className={`inline-block rounded-full px-2 py-px text-xs tracking-wide whitespace-nowrap ${tones[tone]} ${className}`}>
            {children}
        </span>
    );
}

/** how far along: a quest, a level, a session */
export function Meter({ value, className = "", tone = "gold" }: { value: number; className?: string; tone?: "gold" | "moss" | "ember" }) {
    const fill = { gold: "bg-gold", moss: "bg-moss", ember: "bg-ember" }[tone];
    const width = Math.max(0, Math.min(1, value)) * 100;
    return (
        <div className={`h-2 rounded-full bg-ink/15 overflow-hidden ${className}`} role="progressbar" aria-valuenow={Math.round(width)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full transition-[width] duration-500 ${fill}`} style={{ width: `${width}%` }} />
        </div>
    );
}

export function Hearts({ hearts, max = 3, className = "" }: { hearts: number; max?: number; className?: string }) {
    return (
        <span className={`inline-flex gap-1 ${className}`} aria-label={`${hearts} of ${max} hearts`}>
            {Array.from({ length: max }, (_, i) => (
                <span key={i} className={`text-xl leading-none transition-all duration-300 ${i < hearts ? "text-rose" : "text-ink/20 scale-90"}`}>
                    ♥
                </span>
            ))}
        </span>
    );
}

/** the storyteller is writing */
export function Quill({ label = "the storyteller is writing…", className = "" }: { label?: string; className?: string }) {
    return (
        <span className={`inline-flex items-center gap-2 font-hand text-xl text-ink-soft ${className}`} role="status">
            <span className="inline-block animate-quill" aria-hidden>✒️</span>
            {label}
        </span>
    );
}
