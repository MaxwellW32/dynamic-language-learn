/**
 * Japanese helpers for the importer: kana → rōmaji, and the everyday
 * conjugated forms of verbs and adjectives.
 *
 * JMdict lists dictionary forms only, but a story says 食べました, not 食べる.
 * Generating the common inflections here is what lets a tapped word resolve.
 */

const DIGRAPHS: Record<string, string> = {
    きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho",
    ちゃ: "cha", ちゅ: "chu", ちょ: "cho", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
    ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
    りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
    じゃ: "ja", じゅ: "ju", じょ: "jo", びゃ: "bya", びゅ: "byu", びょ: "byo",
    ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo", ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
    てぃ: "ti", でぃ: "di", うぃ: "wi", うぇ: "we", うぉ: "wo", ゔぁ: "va", ゔぃ: "vi",
    しぇ: "she", じぇ: "je", ちぇ: "che", とぅ: "tu", どぅ: "du",
};

const MONOGRAPHS: Record<string, string> = {
    あ: "a", い: "i", う: "u", え: "e", お: "o",
    か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
    さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
    た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
    な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
    は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
    ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
    や: "ya", ゆ: "yu", よ: "yo",
    ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
    わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
    が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
    ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
    だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
    ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
    ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
    ゔ: "vu", ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
    ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
};

/** katakana → hiragana; everything else passes through */
export function toHiragana(text: string): string {
    let out = "";
    for (const char of text) {
        const code = char.codePointAt(0)!;
        out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
    }
    return out;
}

/** Hepburn rōmaji with macron-free long vowels ("toukyou"), readable at a glance */
export function kanaToRomaji(kana: string): string {
    const text = toHiragana(kana);
    let out = "";
    let geminate = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === "っ") {
            geminate = true;
            continue;
        }
        if (char === "ー") {
            // the long-vowel mark repeats whatever vowel came before
            const last = out[out.length - 1];
            if (last && "aiueo".includes(last)) out += last;
            continue;
        }
        const pair = text.slice(i, i + 2);
        let syllable = DIGRAPHS[pair];
        if (syllable) i++;
        else syllable = MONOGRAPHS[char];

        if (!syllable) {
            out += char;
            geminate = false;
            continue;
        }
        if (geminate) {
            out += syllable.startsWith("ch") ? "t" : syllable[0];
            geminate = false;
        }
        // "n" before a vowel or y needs an apostrophe to stay unambiguous: しんや → shin'ya
        if (out.endsWith("n") && text[i - (DIGRAPHS[pair] ? 2 : 1)] === "ん" && /^[aiueoy]/.test(syllable)) out += "'";
        out += syllable;
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* conjugation                                                         */
/* ------------------------------------------------------------------ */

/** for each godan ending: [i-row, a-row, e-row, o-row, て, た] */
const GODAN: Record<string, [string, string, string, string, string, string]> = {
    う: ["い", "わ", "え", "お", "って", "った"],
    く: ["き", "か", "け", "こ", "いて", "いた"],
    ぐ: ["ぎ", "が", "げ", "ご", "いで", "いだ"],
    す: ["し", "さ", "せ", "そ", "して", "した"],
    つ: ["ち", "た", "て", "と", "って", "った"],
    ぬ: ["に", "な", "ね", "の", "んで", "んだ"],
    ぶ: ["び", "ば", "べ", "ぼ", "んで", "んだ"],
    む: ["み", "ま", "め", "も", "んで", "んだ"],
    る: ["り", "ら", "れ", "ろ", "って", "った"],
};

const POLITE = ["ます", "ません", "ました", "ませんでした", "ましょう", "たい", "たくない", "たかった", "ながら"];

function fromStems(stem: string, i: string, a: string, e: string, o: string, te: string, ta: string): string[] {
    return [
        stem + i,
        ...POLITE.map((ending) => stem + i + ending),
        stem + a + "ない", stem + a + "なかった", stem + a + "なくて", stem + a + "れる", stem + a + "せる",
        stem + te, stem + ta, stem + ta + "ら", stem + ta + "り",
        stem + te + "いる", stem + te + "います", stem + te + "いた", stem + te + "ください",
        stem + e + "ば", stem + e + "る", stem + e + "ます", stem + e,
        stem + o + "う",
    ];
}

/**
 * The inflected forms a learner actually meets. `word` may be written in
 * kanji or kana — only its ending is touched.
 */
export function conjugate(word: string, posTags: string[]): string[] {
    const has = (tag: string) => posTags.includes(tag);
    const stem = word.slice(0, -1);
    const ending = word.slice(-1);

    if (has("v1") && ending === "る") {
        return [
            stem,
            ...POLITE.map((e) => stem + e),
            stem + "ない", stem + "なかった", stem + "なくて", stem + "られる", stem + "させる",
            stem + "て", stem + "た", stem + "たら", stem + "たり",
            stem + "ている", stem + "ています", stem + "ていた", stem + "てください",
            stem + "れば", stem + "よう", stem + "ろ",
        ];
    }

    // 行く is godan but takes って/った
    if (has("v5k-s") && ending === "く") return fromStems(stem, "き", "か", "け", "こ", "って", "った");
    // ある: negative is ない, never あらない
    if (has("v5r-i") && ending === "る") return fromStems(stem, "り", "ら", "れ", "ろ", "って", "った").filter((f) => !f.includes("らな"));

    const godanTag = posTags.find((tag) => /^v5[ukgstnbmr]$/.test(tag));
    if (godanTag && GODAN[ending]) {
        const [i, a, e, o, te, ta] = GODAN[ending];
        return fromStems(stem, i, a, e, o, te, ta);
    }

    if ((has("vs-i") || has("vs-s")) && word.endsWith("する")) {
        const base = word.slice(0, -2);
        return [
            base + "し", ...POLITE.map((e) => base + "し" + e),
            base + "しない", base + "しなかった", base + "して", base + "した", base + "している",
            base + "しています", base + "してください", base + "すれば", base + "しよう", base + "される", base + "させる",
        ];
    }
    if (has("vk") && (word.endsWith("くる") || word.endsWith("来る"))) {
        const base = word.slice(0, -2);
        const kanji = word.endsWith("来る");
        const k = (kana: string) => base + (kanji ? "来" : kana);
        return [
            ...POLITE.map((e) => k("き") + e),
            k("こ") + "ない", k("こ") + "なかった", k("き") + "て", k("き") + "た", k("き") + "ている",
            k("き") + "てください", k("く") + "れば", k("こ") + "よう", k("こ") + "られる",
        ];
    }

    if (has("adj-i") && ending === "い") {
        return [
            stem + "く", stem + "くない", stem + "くなかった", stem + "かった", stem + "くて",
            stem + "ければ", stem + "さ", stem + "そう", stem + "すぎる",
        ];
    }
    if (has("adj-ix") && word.endsWith("いい")) {
        const base = word.slice(0, -2) + "よ";
        return [base + "く", base + "くない", base + "かった", base + "くて", base + "ければ"];
    }

    // a する-noun: 勉強 → 勉強する and its everyday forms
    if (has("vs")) {
        return [
            word + "する", word + "します", word + "しました", word + "しません", word + "して",
            word + "した", word + "しない", word + "している", word + "しています",
        ];
    }
    if (has("adj-na")) return [word + "な", word + "に", word + "だ", word + "です", word + "じゃない", word + "だった"];

    return [];
}
