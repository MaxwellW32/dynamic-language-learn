"use client";

/**
 * A moment, in the reader's own time zone. The server renders it in its own
 * zone first; the browser's may differ by a day near midnight, which is
 * harmless, so the mismatch is allowed rather than papered over.
 */
export function LocalDate({ iso }: { iso: string }) {
    const date = new Date(iso);
    const text = date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
