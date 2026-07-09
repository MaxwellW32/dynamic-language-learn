import toast from "react-hot-toast";
import type { QuestUpdate } from "@/game/payloads";

export function showQuestUpdates(updates: QuestUpdate[]) {
    for (const update of updates) {
        if (update.failed) {
            toast(`🥀 Quest lost: ${update.questTitle}`, { duration: 6000 });
        } else if (update.questCompleted) {
            toast(`📜 Quest complete: ${update.questTitle}`, { duration: 5000, icon: "🎉" });
        } else if (update.objectiveDescription) {
            toast(`✒️ ${update.objectiveDescription}`, { duration: 4000 });
        }
    }
}
