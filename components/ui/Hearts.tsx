/** the hero's courage in a battle of words */
export function Hearts({ count, max = 3 }: { count: number; max?: number }) {
    return (
        <div className="flex gap-1" aria-label={`${count} of ${max} hearts`}>
            {Array.from({ length: max }, (_, i) => (
                <span
                    key={i}
                    className={`text-xl transition-transform ${i < count ? "text-ember scale-100" : "text-ink-faint/40 scale-90"}`}
                >
                    {i < count ? "❤️" : "🖤"}
                </span>
            ))}
        </div>
    );
}
