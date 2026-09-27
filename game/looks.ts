/**
 * The visual vocabulary of the world. The storyteller AI never invents
 * geometry or colours — it picks from these lists, and the engine knows how to
 * build every combination. Anything it returns outside a list is replaced by a
 * default (see `sanitize…` below), so a creative answer can never break a scene.
 */

/* ------------------------------------------------------------------ */
/* colours                                                             */
/* ------------------------------------------------------------------ */

export const CLOTH_COLORS = {
    crimson: 0xb8323a, ember: 0xd2622a, amber: 0xe0a43a, straw: 0xd9c27a,
    moss: 0x6f8f4a, forest: 0x3f6b45, teal: 0x2f8f8a, sky: 0x5fa6d6,
    indigo: 0x3f4f9c, plum: 0x7a4a8c, rose: 0xd77a96, cream: 0xefe4cc,
    slate: 0x66707e, charcoal: 0x3a3a44, umber: 0x7a5236, white: 0xf6f3ea,
} as const;
export type ClothColor = keyof typeof CLOTH_COLORS;

export const SKIN_TONES = {
    porcelain: 0xf6dcc8, fair: 0xeec6a4, tan: 0xd9a57a,
    olive: 0xc2925f, brown: 0x9a6a42, deep: 0x6b4429,
} as const;
export type SkinTone = keyof typeof SKIN_TONES;

export const HAIR_COLORS = {
    black: 0x23201f, brown: 0x5a3a24, chestnut: 0x7d4a2a, auburn: 0x9c4a26,
    blonde: 0xd9b45a, red: 0xb5432a, grey: 0x9a9a9a, white: 0xeeeae0,
    blue: 0x3f6fb5, green: 0x4f8a5a, pink: 0xe08ab0,
} as const;
export type HairColor = keyof typeof HAIR_COLORS;

/* ------------------------------------------------------------------ */
/* people                                                              */
/* ------------------------------------------------------------------ */

export const BUILDS = ["slim", "average", "stout", "tall", "small"] as const;
export const AGES = ["child", "adult", "elder"] as const;
export const HAIR_STYLES = ["short", "long", "bun", "braid", "ponytail", "curly", "spiky", "bald"] as const;
export const OUTFITS = ["tunic", "robe", "dress", "armor", "apron", "cloak", "kimono", "vest"] as const;
export const HATS = ["none", "straw", "wizard", "hood", "cap", "crown", "bandana", "flower"] as const;
export const ACCESSORIES = ["none", "staff", "basket", "book", "lantern", "sword", "satchel", "scarf", "broom", "fishingrod"] as const;

export type ActorLook = {
    build: (typeof BUILDS)[number];
    age: (typeof AGES)[number];
    skin: SkinTone;
    hair: (typeof HAIR_STYLES)[number];
    hairColor: HairColor;
    beard: boolean;
    outfit: (typeof OUTFITS)[number];
    primary: ClothColor;
    secondary: ClothColor;
    hat: (typeof HATS)[number];
    accessory: (typeof ACCESSORIES)[number];
};

export const DEFAULT_LOOK: ActorLook = {
    build: "average", age: "adult", skin: "tan", hair: "short", hairColor: "brown", beard: false,
    outfit: "tunic", primary: "teal", secondary: "cream", hat: "none", accessory: "none",
};

/** the OpenAI speech voices a character can be given */
export const TTS_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

/* ------------------------------------------------------------------ */
/* creatures                                                           */
/* ------------------------------------------------------------------ */

export const CREATURE_KINDS = ["slime", "wisp", "shroom", "golem", "bat", "crab", "ghost", "imp", "beetle", "wolf"] as const;
export const BOSS_KINDS = ["wyrm", "titan", "shade", "queen"] as const;
export type CreatureKind = (typeof CREATURE_KINDS)[number] | (typeof BOSS_KINDS)[number];

export const CREATURE_TINTS = {
    jade: 0x58c48a, azure: 0x4fa8e8, violet: 0x9a6ae0, ember: 0xf0763a, gold: 0xf0c040,
    rose: 0xf07a9a, bone: 0xe8e0cc, shadow: 0x4a3a66, frost: 0xa8e0f0, moss: 0x7a9a4a,
} as const;
export type CreatureTint = keyof typeof CREATURE_TINTS;

export type CreatureLook = {
    kind: CreatureKind;
    tint: CreatureTint;
    /** 0.8 – 1.4; bosses are scaled further by the engine */
    scale: number;
};

/* ------------------------------------------------------------------ */
/* places                                                              */
/* ------------------------------------------------------------------ */

export const BIOMES = [
    "meadow", "forest", "autumn", "sakura", "snow", "desert",
    "coast", "swamp", "highland", "volcanic", "crystal", "twilight",
] as const;
export type Biome = (typeof BIOMES)[number];

export const TIMES_OF_DAY = ["dawn", "day", "golden", "dusk", "night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const WEATHERS = ["clear", "mist", "rain", "snowfall", "petals", "fireflies", "embers"] as const;
export type Weather = (typeof WEATHERS)[number];

export const isBiome = (value: unknown): value is Biome =>
    typeof value === "string" && (BIOMES as readonly string[]).includes(value);
export const isTimeOfDay = (value: unknown): value is TimeOfDay =>
    typeof value === "string" && (TIMES_OF_DAY as readonly string[]).includes(value);
export const isWeather = (value: unknown): value is Weather =>
    typeof value === "string" && (WEATHERS as readonly string[]).includes(value);

export const BUILDING_KINDS =["house", "inn", "shop", "smithy", "temple", "tower", "barn", "windmill", "hall"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/**
 * Things the hero can walk up to and examine. Each kind also names the
 * everyday English nouns it could be called, best first, which is how the
 * world gets labelled in the language being learned (see
 * server/services/worldWords.ts). Several are listed because dictionaries
 * differ in which English word they file a thing under, and a too-general
 * word ("notice", "sign") finds the wrong sense entirely.
 */
export const LANDMARK_KINDS = {
    well: ["well"],
    fountain: ["fountain"],
    signpost: ["signpost", "road sign", "sign"],
    noticeboard: ["noticeboard", "bulletin board", "board"],
    stall: ["market", "stall"],
    statue: ["statue"],
    shrine: ["shrine", "temple"],
    campfire: ["campfire", "bonfire", "fire"],
    greattree: ["tree"],
    stones: ["stone", "rock"],
    arch: ["arch", "gate"],
    // never plain "chest": in most dictionaries that word leads to the body part
    chest: ["treasure chest", "coffer", "trunk", "box"],
    crystal: ["crystal", "gem"],
    bridge: ["bridge"],
    lantern: ["lantern", "lamp"],
    cart: ["cart", "wagon"],
    boat: ["boat"],
    altar: ["altar"],
    obelisk: ["obelisk", "pillar", "tower"],
    tent: ["tent"],
    garden: ["garden"],
    bench: ["bench", "seat"],
    barrel: ["barrel", "cask"],
    pond: ["pond", "lake"],
} as const satisfies Record<string, readonly string[]>;
export type LandmarkKind = keyof typeof LANDMARK_KINDS;
export const LANDMARK_KIND_LIST = Object.keys(LANDMARK_KINDS) as LandmarkKind[];

/* ------------------------------------------------------------------ */
/* sanitising AI picks                                                 */
/* ------------------------------------------------------------------ */

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** stable pseudo-random pick, so a fallback look is still varied between characters */
function seeded<T>(list: readonly T[], seed: number): T {
    return list[Math.abs(Math.floor(seed)) % list.length];
}

export function sanitizeLook(raw: Partial<Record<keyof ActorLook, unknown>> | null | undefined, seed = 0): ActorLook {
    const r = raw ?? {};
    return {
        build: pick(r.build, BUILDS, seeded(BUILDS, seed)),
        age: pick(r.age, AGES, "adult"),
        skin: pick(r.skin, Object.keys(SKIN_TONES) as SkinTone[], seeded(Object.keys(SKIN_TONES) as SkinTone[], seed + 1)),
        hair: pick(r.hair, HAIR_STYLES, seeded(HAIR_STYLES, seed + 2)),
        hairColor: pick(r.hairColor, Object.keys(HAIR_COLORS) as HairColor[], seeded(["black", "brown", "chestnut", "auburn", "blonde"] as HairColor[], seed + 3)),
        beard: r.beard === true,
        outfit: pick(r.outfit, OUTFITS, seeded(OUTFITS, seed + 4)),
        primary: pick(r.primary, Object.keys(CLOTH_COLORS) as ClothColor[], seeded(Object.keys(CLOTH_COLORS) as ClothColor[], seed + 5)),
        secondary: pick(r.secondary, Object.keys(CLOTH_COLORS) as ClothColor[], seeded(Object.keys(CLOTH_COLORS) as ClothColor[], seed + 9)),
        hat: pick(r.hat, HATS, "none"),
        accessory: pick(r.accessory, ACCESSORIES, "none"),
    };
}

export function sanitizeCreature(
    raw: Partial<Record<keyof CreatureLook, unknown>> | null | undefined,
    tier: "minion" | "elite" | "boss",
    seed = 0,
): CreatureLook {
    const r = raw ?? {};
    const kinds: readonly CreatureKind[] = tier === "boss" ? BOSS_KINDS : CREATURE_KINDS;
    const scale = typeof r.scale === "number" && Number.isFinite(r.scale) ? r.scale : 1;
    return {
        kind: pick(r.kind, kinds, seeded(kinds, seed)),
        tint: pick(r.tint, Object.keys(CREATURE_TINTS) as CreatureTint[], seeded(Object.keys(CREATURE_TINTS) as CreatureTint[], seed + 1)),
        scale: Math.min(1.4, Math.max(0.8, scale)),
    };
}

export function sanitizeVoice(value: unknown, seed = 0): TtsVoice {
    return pick(value, TTS_VOICES, seeded(TTS_VOICES, seed));
}
