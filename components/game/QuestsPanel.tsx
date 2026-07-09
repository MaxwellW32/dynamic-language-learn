"use client";

import { useAtomValue } from "jotai";
import { questsAtom } from "./state";

/**
 * Compact quest list that lives on the map page, so the reader sees where
 * they are and what they're meant to do in one glance. Completed quests sink
 * to the bottom, dimmed.
 */
export function QuestsPanel() {
    const quests = useAtomValue(questsAtom);
    const active = quests.filter((q) => q.status === "active");
    const finished = quests.filter((q) => q.status !== "active");

    return (
        <section className="rounded-md border border-wood/40 bg-parchment-deep/50">
            <h3 className="font-display text-lg px-3 pt-2 flex items-baseline gap-2">
                📜 Quests
                {active.length > 0 && <span className="text-ink-faint text-xs font-body">{active.length} underway</span>}
            </h3>
            <div className="px-3 pb-3 pt-1 grid gap-2 lg:max-h-[34vh] lg:overflow-y-auto scroll-ink">
                {quests.length === 0 && (
                    <p className="text-ink-soft text-sm">No quests yet — go talk to someone.</p>
                )}
                {[...active, ...finished].map((quest) => (
                    <div key={quest.id} className={quest.status !== "active" ? "opacity-50" : ""}>
                        <p className="font-display leading-tight">
                            {quest.status === "completed" ? "✅" : quest.status === "failed" ? "🥀" : "✦"} {quest.title}
                            {quest.giverName && <span className="font-hand text-ink-faint text-base"> — for {quest.giverName}</span>}
                            {quest.status === "failed" && <span className="font-hand text-ember-deep text-base"> — lost</span>}
                        </p>
                        {quest.status === "active" && (
                            <ul className="mt-0.5 grid gap-0.5">
                                {quest.objectives.map((objective) => (
                                    <li key={objective.id} className={`text-sm flex items-baseline gap-1.5 ${objective.status === "completed" ? "line-through text-ink-faint" : objective.status === "failed" ? "line-through text-ember-deep/70" : "text-ink-soft"}`}>
                                        <span>{objective.status === "completed" ? "☑" : objective.status === "failed" ? "☒" : "☐"}</span>
                                        <span className="shrink-0 rounded-sm border border-wood/40 bg-parchment-dark/60 px-1 text-[10px] font-display tracking-wide text-ink-soft whitespace-nowrap">
                                            {objective.tag.icon} {objective.tag.label}
                                        </span>
                                        <span>
                                            {objective.description}
                                            {objective.targetCount > 1 && ` (${objective.progress}/${objective.targetCount})`}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}
