import type { ReactNode } from "react";

/** the basic surface of the book: a grained parchment panel */
export function Parchment({
    children,
    className = "",
    framed = false,
}: {
    children: ReactNode;
    className?: string;
    framed?: boolean;
}) {
    return (
        <div className={`parchment rounded-sm ${framed ? "wood-frame" : "shadow-card"} ${className}`}>
            {children}
        </div>
    );
}

/** a small banner title pinned across a parchment panel */
export function Ribbon({ children, className = "" }: { children: ReactNode; className?: string }) {
    return (
        <div className={`inline-block bg-ember-deep text-parchment font-display px-4 py-1 text-sm tracking-wide shadow-card [clip-path:polygon(0_0,100%_0,calc(100%-0.6rem)_50%,100%_100%,0_100%,0.6rem_50%)] ${className}`}>
            {children}
        </div>
    );
}
