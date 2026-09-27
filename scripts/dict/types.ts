import type { DictSense } from "../../game/dictionary";

/** one headword as the parsers hand it to the loader */
export type RawEntry = {
    lemma: string;
    pos: string;
    reading: string | null;
    roman: string | null;
    ipa: string | null;
    gender: string | null;
    gloss: string;
    senses: DictSense[];
    teachable: boolean;
    audioUrl: string | null;
    /** normalised written forms that lead here, the lemma included */
    forms: Set<string>;
    /**
     * The spellings the frequency corpus may have counted this word under,
     * when that differs from `forms` (Japanese: verb stems cut loose by the
     * corpus tokeniser are added, rare alternative readings are left out).
     */
    counted?: Set<string>;
    /** the source's own judgement that this is an everyday word; undefined when it offers none */
    common?: boolean;
    /** accumulated occurrences in the frequency corpus */
    weight: number;
};

export type ParsedDictionary = {
    entries: RawEntry[];
};

export const entryKey = (lemma: string, pos: string) => `${lemma}\t${pos}`;
