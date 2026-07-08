/**
 * Placeholder art vocabulary. Every entity on a map renders as a lightweight
 * emoji token inside a styled disc until real artwork exists; the AI picks
 * from these fixed keys so rendering never depends on generated strings.
 */

export const NPC_SPRITES: Record<string, string> = {
    villager: "🧑‍🌾",
    elder: "🧙",
    merchant: "🧺",
    bard: "🪕",
    guard: "🛡️",
    healer: "🌿",
    scholar: "📜",
    child: "🧒",
    ranger: "🏹",
    innkeep: "🍺",
};

export const ENEMY_SPRITES: Record<string, string> = {
    slime: "🫧",
    wolf: "🐺",
    bat: "🦇",
    bandit: "🗡️",
    spirit: "👻",
    golem: "🗿",
    crow: "🐦‍⬛",
    serpent: "🐍",
    "boss-dragon": "🐉",
    "boss-witch": "🔮",
    "boss-knight": "⚔️",
};

export const FEATURE_SPRITES: Record<string, string> = {
    building: "🏠",
    well: "⛲",
    sign: "🪧",
    garden: "🌻",
    tree: "🌳",
    lantern: "🏮",
    campfire: "🔥",
    bridge: "🌉",
    rock: "🪨",
    crystal: "💎",
    chest: "🧰",
    statue: "🗿",
    counter: "🍶",
    hearth: "🔥",
    table: "🪑",
    bookshelf: "📚",
};

export function npcSprite(key: string): string {
    return NPC_SPRITES[key] ?? "🧑";
}

export function enemySprite(key: string): string {
    return ENEMY_SPRITES[key] ?? "👾";
}

export function featureSprite(kind: string): string {
    return FEATURE_SPRITES[kind] ?? "✨";
}

/** OpenAI TTS voices the forge can assign to characters */
export const TTS_VOICES = [
    "alloy", "ash", "ballad", "coral", "echo",
    "fable", "onyx", "nova", "sage", "shimmer",
] as const;
