/**
 * The languages a book can teach. Everything language-specific the game needs —
 * how text is tokenised, which voice locale reads it aloud, what the world's
 * architecture leans toward — hangs off this table.
 */

export type LangCode = "es" | "fr" | "de" | "it" | "pt" | "ja" | "ko" | "zh";

export type StyleKit = "mediterranean" | "timber" | "eastern" | "adobe" | "nordic";

export type Language = {
    code: LangCode;
    name: string;
    endonym: string;
    /** locale handed to speech synthesis, transcription and Intl.Segmenter */
    locale: string;
    flag: string;
    /** false for scripts written without spaces between words */
    spaced: boolean;
    /** what the word card shows beside the headword */
    pronunciationLabel: "IPA" | "reading" | "pinyin" | "romanisation";
    /** the look buildings lean toward, so the world quietly evokes where the language lives */
    styleKit: StyleKit;
    greeting: string;
};

export const LANGUAGES: Record<LangCode, Language> = {
    es: { code: "es", name: "Spanish", endonym: "Español", locale: "es-ES", flag: "🇪🇸", spaced: true, pronunciationLabel: "IPA", styleKit: "mediterranean", greeting: "¡Hola!" },
    fr: { code: "fr", name: "French", endonym: "Français", locale: "fr-FR", flag: "🇫🇷", spaced: true, pronunciationLabel: "IPA", styleKit: "timber", greeting: "Bonjour !" },
    de: { code: "de", name: "German", endonym: "Deutsch", locale: "de-DE", flag: "🇩🇪", spaced: true, pronunciationLabel: "IPA", styleKit: "timber", greeting: "Hallo!" },
    it: { code: "it", name: "Italian", endonym: "Italiano", locale: "it-IT", flag: "🇮🇹", spaced: true, pronunciationLabel: "IPA", styleKit: "mediterranean", greeting: "Ciao!" },
    pt: { code: "pt", name: "Portuguese", endonym: "Português", locale: "pt-BR", flag: "🇧🇷", spaced: true, pronunciationLabel: "IPA", styleKit: "mediterranean", greeting: "Olá!" },
    ja: { code: "ja", name: "Japanese", endonym: "日本語", locale: "ja-JP", flag: "🇯🇵", spaced: false, pronunciationLabel: "reading", styleKit: "eastern", greeting: "こんにちは" },
    ko: { code: "ko", name: "Korean", endonym: "한국어", locale: "ko-KR", flag: "🇰🇷", spaced: true, pronunciationLabel: "romanisation", styleKit: "eastern", greeting: "안녕하세요" },
    zh: { code: "zh", name: "Mandarin Chinese", endonym: "中文", locale: "zh-CN", flag: "🇨🇳", spaced: false, pronunciationLabel: "pinyin", styleKit: "eastern", greeting: "你好" },
};

export const LANG_CODES = Object.keys(LANGUAGES) as LangCode[];

export function isLangCode(value: unknown): value is LangCode {
    return typeof value === "string" && value in LANGUAGES;
}

export function languageOf(code: string): Language {
    if (!isLangCode(code)) throw new Error(`Unknown language: ${code}`);
    return LANGUAGES[code];
}

/**
 * The shape every lookup key takes: lower-cased, composed, no surrounding
 * punctuation. Accents are kept — "si" and "sí" are different words.
 */
export function normalizeForm(surface: string): string {
    return surface
        .normalize("NFC")
        .toLowerCase()
        .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
}
