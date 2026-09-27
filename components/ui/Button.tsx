import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "quiet" | "ghost" | "moss" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
    // the thing to do next: ember, pressed into the page
    primary: "bg-ember text-parchment border-ember-deep hover:bg-ember-deep border-b-4 active:border-b-2 active:translate-y-[2px] shadow-card",
    // everything else you may do: parchment on parchment
    quiet: "bg-parchment-deep text-ink border-wood/50 hover:bg-parchment-dark border border-b-4 active:border-b-2 active:translate-y-[2px]",
    moss: "bg-moss text-parchment border-moss-deep hover:bg-moss-deep border-b-4 active:border-b-2 active:translate-y-[2px] shadow-card",
    danger: "bg-rose text-parchment border-[#8a3145] hover:bg-[#a53f55] border-b-4 active:border-b-2 active:translate-y-[2px]",
    ghost: "bg-transparent text-current border border-transparent hover:bg-ink/10",
};

const SIZE: Record<Size, string> = {
    sm: "px-3 py-1 text-sm rounded",
    md: "px-4 py-2 text-base rounded-md",
    lg: "px-6 py-3 text-lg rounded-md",
};

export function Button({
    variant = "quiet", size = "md", className = "", children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; children: ReactNode }) {
    return (
        <button
            type="button"
            {...rest}
            className={`font-display tracking-wide cursor-pointer select-none transition-[background,transform,border] duration-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
        >
            {children}
        </button>
    );
}
