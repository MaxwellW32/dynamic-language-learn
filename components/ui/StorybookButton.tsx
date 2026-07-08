"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "quiet" | "moss";

const STYLES: Record<Variant, string> = {
    primary: "bg-ember text-parchment border-ember-deep hover:bg-ember-deep",
    quiet: "bg-parchment-deep text-ink border-wood/60 hover:bg-parchment-dark",
    moss: "bg-moss text-parchment border-moss-deep hover:bg-moss-deep",
};

export function StorybookButton({
    variant = "primary",
    className = "",
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
    return (
        <button
            {...props}
            className={`font-display tracking-wide rounded-md border-b-4 px-4 py-2 shadow-card transition-all
                active:translate-y-0.5 active:border-b-2 active:shadow-none
                disabled:opacity-50 disabled:pointer-events-none cursor-pointer
                ${STYLES[variant]} ${className}`}
        />
    );
}
