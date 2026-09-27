/**
 * Rich story text. Every passage, dialogue line and bark is stored as a list
 * of segments, so the language being learned is structure — never markup to
 * be parsed out of prose later.
 *
 * Keys are deliberately short: these arrays are stored per message and sent
 * to the client on every turn.
 */

/**
 * One piece of a target-language span. Words, spaces and punctuation are each
 * their own token, so the tokens of a span joined together reproduce it
 * exactly; only words the dictionary knows carry an id.
 */
export type Token = {
    s: string;
    /** dictionary entry id, when the word was found */
    id?: number;
};

export type Segment =
    /** prose in the reader's own language */
    | { t: "text"; v: string }
    /** one planned dictionary word, written in the target language where it belongs in the sentence */
    | { t: "word"; id: number; s: string }
    /** a phrase or whole sentence in the target language, with its translation */
    | { t: "tl"; v: string; tr: string; tk: Token[] };

export function segmentsToPlainText(segments: Segment[]): string {
    return segments.map(plain).join("");
}

/** every dictionary entry a piece of text touches — what the client needs word cards for */
export function entryIdsIn(segments: Segment[]): number[] {
    const ids = new Set<number>();
    for (const seg of segments) {
        if (seg.t === "word") ids.add(seg.id);
        else if (seg.t === "tl") for (const token of seg.tk) if (token.id !== undefined) ids.add(token.id);
    }
    return [...ids];
}

/** only the words the vocab planner chose (they alone count as study exposure) */
export function plannedIdsIn(segments: Segment[]): number[] {
    return [...new Set(segments.flatMap((seg) => (seg.t === "word" ? [seg.id] : [])))];
}

/** how much of a passage is written in the target language, 0..1 */
export function targetShare(segments: Segment[]): number {
    let target = 0;
    let total = 0;
    for (const seg of segments) {
        const length = seg.t === "text" ? seg.v.length : seg.t === "word" ? seg.s.length : seg.v.length;
        total += length;
        if (seg.t !== "text") target += length;
    }
    return total === 0 ? 0 : target / total;
}

const plain = (seg: Segment) => (seg.t === "text" ? seg.v : seg.t === "word" ? seg.s : seg.v);

/** marks that hug the word before them, in either script */
const CLOSES = /^[)\]}»”.,;:!?…\-–—/。、！？」』）：；]/;
/** marks that hug the word after them */
const OPENS = /[(\[{«“‘¿¡\-–—/「『（]$/;

/** would these two pieces run together as "Hallo!I'm" if nothing were put between them? */
function runsTogether(left: string, right: string): boolean {
    if (left.length === 0 || right.length === 0) return false;
    if (/\s$/.test(left) || /^\s/.test(right)) return false;
    if (CLOSES.test(right) || OPENS.test(left)) return false;
    // Greta's, don't — and l'eau, d'accord
    if (/^['’](s|t|d|m|re|ll|ve)(?!\p{L})/iu.test(right)) return false;
    if (/(^|\s)\p{L}{1,2}['’]$/u.test(left)) return false;
    // a straight quote or an asterisk opens after a gap and closes after a word
    if (/(^|\s)["'*]$/.test(left)) return false;
    if (/^["'*](\s|$|[.,;:!?])/.test(right)) return false;
    return true;
}

/**
 * Segments are joined with nothing between them, and a writer who forgets the
 * space after a phrase in the other language produces "Hallo!I'm Emil". This
 * puts the missing spaces back, wherever one side of the join is in the
 * language being learned. Two such pieces side by side are left alone in a
 * language written without spaces.
 */
export function respace(segments: Segment[], spaced: boolean): Segment[] {
    const out: Segment[] = [];
    for (const segment of segments) {
        const last = out[out.length - 1];
        const next: Segment = { ...segment };
        if (last && (last.t !== "text" || next.t !== "text") && runsTogether(plain(last), plain(next))) {
            if (next.t === "text") next.v = ` ${next.v}`;
            else if (last.t === "text") last.v = `${last.v} `;
            else if (spaced) out.push({ t: "text", v: " " });
        }
        out.push(next);
    }
    return out;
}

export function textSegment(v: string): Segment[] {
    return v.length > 0 ? [{ t: "text", v }] : [];
}
