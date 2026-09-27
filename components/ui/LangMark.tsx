import { LANGUAGES, type LangCode } from "@/game/languages";

/**
 * A language's mark: its code on a wax seal of its own colour. Flag emoji are
 * not used — Windows draws them as two letters, and a language is not a
 * country anyway.
 */
const WAX: Record<LangCode, string> = {
    es: "#c2571b", fr: "#3f5fa8", de: "#4a4a52", it: "#3f7a4a",
    pt: "#2f8f6a", ja: "#b8323a", ko: "#3f7fa8", zh: "#a8342a",
};

const SIZE = {
    sm: "w-6 h-6 text-[0.6rem]",
    md: "w-9 h-9 text-xs",
    lg: "w-12 h-12 text-base",
};

export function LangMark({ code, size = "md", className = "" }: { code: LangCode; size?: keyof typeof SIZE; className?: string }) {
    return (
        <span
            className={`inline-grid place-items-center rounded-full font-display tracking-wider text-parchment shadow-card ring-1 ring-black/15 ${SIZE[size]} ${className}`}
            style={{ backgroundColor: WAX[code], backgroundImage: "radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.28), transparent 55%)" }}
            title={LANGUAGES[code].name}
            aria-hidden
        >
            {code.toUpperCase()}
        </span>
    );
}
