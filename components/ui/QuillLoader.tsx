/** a writing quill for waiting moments */
export function QuillLoader({ label }: { label?: string }) {
    return (
        <div className="flex items-center gap-3 text-ink-soft">
            <span className="text-2xl animate-bob inline-block">🪶</span>
            <span className="font-hand text-xl">{label ?? "the ink is drying…"}</span>
        </div>
    );
}
