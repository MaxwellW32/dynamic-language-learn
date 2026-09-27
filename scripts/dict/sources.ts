/**
 * Where each language's dictionary comes from. All sources are open data:
 *
 * - kaikki.org     machine-readable Wiktionary (CC BY-SA / GFDL) — headwords, senses, IPA,
 *                  inflected forms, examples
 * - JMdict         Japanese–English (EDRDG, CC BY-SA 4.0) via the jmdict-simplified JSON build
 * - CC-CEDICT      Mandarin–English (CC BY-SA 4.0)
 * - FrequencyWords word frequency from film subtitles (CC BY-SA 4.0) — the teaching order
 *
 * Attribution is shown in the app under /about/dictionaries.
 */

export type LangCode = "es" | "fr" | "de" | "it" | "pt" | "ja" | "ko" | "zh";

export type DictSource = {
    lang: LangCode;
    /** which parser reads the main file */
    format: "kaikki" | "jmdict" | "cedict";
    /** resolved at download time when the URL depends on a release tag */
    url: string | "jmdict-latest";
    file: string;
    /** subtitle frequency list, when one exists */
    frequencyUrl?: string;
    frequencyFile?: string;
    /** further count files to fold in: [url, file] */
    extraFrequency?: [string, string][];
    extraFrequencyFiles?: string[];
};

const kaikki = (name: string) =>
    `https://kaikki.org/dictionary/${name}/kaikki.org-dictionary-${name}.jsonl.gz`;
const frequency = (code: string) =>
    `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${code}/${code}_50k.txt`;

export const SOURCES: DictSource[] = [
    { lang: "es", format: "kaikki", url: kaikki("Spanish"), file: "es.jsonl.gz", frequencyUrl: frequency("es"), frequencyFile: "es.freq.txt" },
    { lang: "fr", format: "kaikki", url: kaikki("French"), file: "fr.jsonl.gz", frequencyUrl: frequency("fr"), frequencyFile: "fr.freq.txt" },
    { lang: "de", format: "kaikki", url: kaikki("German"), file: "de.jsonl.gz", frequencyUrl: frequency("de"), frequencyFile: "de.freq.txt" },
    { lang: "it", format: "kaikki", url: kaikki("Italian"), file: "it.jsonl.gz", frequencyUrl: frequency("it"), frequencyFile: "it.freq.txt" },
    { lang: "pt", format: "kaikki", url: kaikki("Portuguese"), file: "pt.jsonl.gz", frequencyUrl: frequency("pt"), frequencyFile: "pt.freq.txt" },
    { lang: "ko", format: "kaikki", url: kaikki("Korean"), file: "ko.jsonl.gz", frequencyUrl: frequency("ko"), frequencyFile: "ko.freq.txt" },
    // the subtitle corpus has no 50k cut for Japanese; its kana-only words sit in a second "ignored" list
    {
        lang: "ja", format: "jmdict", url: "jmdict-latest", file: "ja.jmdict.json.tgz",
        frequencyUrl: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ja/ja_full.txt",
        frequencyFile: "ja.freq.txt",
        extraFrequency: [["https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ja/ja_ignored.txt", "ja.freq-ignored.txt"]],
        extraFrequencyFiles: ["ja.freq-ignored.txt"],
    },
    { lang: "zh", format: "cedict", url: "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz", file: "zh.cedict.txt.gz", frequencyUrl: frequency("zh_cn"), frequencyFile: "zh.freq.txt" },
];

export const RAW_DIR = "data/dict-raw";
