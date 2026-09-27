/**
 * Dictionary shapes shared by the importer, the server and the word card.
 */

export type DictExample = {
    /** the sentence in the target language */
    t: string;
    /** its translation */
    n: string;
};

export type DictSense = {
    /** the meaning, as a short English definition */
    g: string;
    /** usage labels worth showing: "colloquial", "formal", "Mexico"… */
    l?: string[];
    ex?: DictExample[];
};

/** what the client holds for every word it may need to show a card for */
export type WordCard = {
    id: number;
    lang: string;
    lemma: string;
    pos: string;
    reading: string | null;
    roman: string | null;
    ipa: string | null;
    gender: string | null;
    gloss: string;
    senses: DictSense[];
    level: number;
    audioUrl: string | null;
};

/** frequency rank → a CEFR-like band. The edges are where coverage of everyday text jumps. */
export function levelForRank(rank: number | null): number {
    if (rank === null) return 6;
    if (rank <= 500) return 1;
    if (rank <= 1500) return 2;
    if (rank <= 3500) return 3;
    if (rank <= 7000) return 4;
    if (rank <= 15000) return 5;
    return 6;
}

export const LEVEL_NAMES = ["", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const POS_NAMES: Record<string, string> = {
    noun: "noun", verb: "verb", adj: "adjective", adv: "adverb", pron: "pronoun",
    prep: "preposition", conj: "conjunction", det: "determiner", article: "article",
    num: "number", intj: "interjection", phrase: "phrase", particle: "particle",
    classifier: "measure word", counter: "counter", postp: "postposition",
    contraction: "contraction", proverb: "proverb", prep_phrase: "phrase", name: "name",
};

/**
 * Turn an English definition into lookup keys: "to eat (food)" → ["eat"],
 * "foot (a part of the body)" → ["foot"]. Only short, plain meanings become
 * keys — a key is a promise that the word simply *means* that.
 */
export function glossKeysOf(gloss: string): string[] {
    const keys = new Set<string>();
    for (const part of gloss.split(/[;,]/)) {
        const cleaned = part
            .replace(/\([^)]*\)/g, " ")
            .replace(/\[[^\]]*\]/g, " ")
            .toLowerCase()
            .replace(/^\s*(to|a|an|the)\s+/, "")
            .replace(/[^a-z' -]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (cleaned.length < 2 || cleaned.length > 24) continue;
        if (cleaned.split(" ").length > 2) continue;
        keys.add(cleaned);
    }
    return [...keys].slice(0, 6);
}
