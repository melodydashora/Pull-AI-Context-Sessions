// The inline grammar of one paragraph (docs/design.md 4.7.2): a typed port of the reference
// implementation in appendix 5.4 of that document, with the same results for its golden cases.
//
// The input is text from other people's pages and files. The result is a list of nodes, never
// markup: the caller builds elements from it (4.7.3). A link node exists only for http, https and
// mailto addresses; everything else stays text. Nothing is ever removed from the text.
//
// One difference from the reference, which changes no result: the end of a bare address is found
// with running counts of its brackets instead of counting them again for every character that is
// cut off. Text made of an address followed by two thousand closing brackets, repeated, would
// otherwise take seconds.
//
// Three more differences of the same kind, none of which changes a result (the differential test
// compares this file with the parser as first written, inline-first-written.test-support.ts):
//   - the runs that can close emphasis are listed once per text, so an opening run without a
//     closing one costs a step instead of a search of 2,000 characters;
//   - an address that cannot have a host ("http:///") is refused before the address is read;
//   - a link with a label is read by hand: the end of the label and the destination behind a
//     given "(" are found once, not once for every "[" in front of them.
// Measured on 2026-11-20 by a security review of the first screens: 1 MB of "(*a" repeated took
// 11.7 s, "http:///" 2.7 s, 497 opening brackets and "](" 2.3 s.

export type InlineNode =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "link"; readonly href: string; readonly text: string }
  | { readonly type: "strong"; readonly children: readonly InlineNode[] }
  | { readonly type: "em"; readonly children: readonly InlineNode[] }
  | { readonly type: "strike"; readonly children: readonly InlineNode[] };

/** How far ahead the end of a code span, of emphasis or of an address is looked for. */
const LOOKAHEAD = 2000;
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;
const INERT_AFTER_BACKSLASH = "`*~[]\\";
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;
/** A label holds at most this many characters, a destination at most this many pieces, and a whole link fits in LINK_WINDOW. */
const MAX_LABEL = 500;
const MAX_DESTINATION_PIECES = 2000;
const LINK_WINDOW = 2600;
const BARE = /^https?:\/\/[^\s<>]+/i;
const BARE_HAS_HOST = /^https?:\/\/[^\s/]/i;
const NOT_PART_OF_AN_ADDRESS = ".,;:!?'\"";

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || SPACE.test(ch);
}

function countOf(text: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ch) n++;
  }
  return n;
}

/** The start of the next run of exactly `n` backticks at or after `from`, or -1. */
function findBackticks(s: string, from: number, n: number, lookahead: number): number {
  const end = Math.min(s.length, from + lookahead);
  for (let j = from; j < end; j++) {
    if (s[j] !== "`") continue;
    let run = 1;
    while (s[j + run] === "`") run++;
    if (run === n) return j;
    j += run - 1;
  }
  return -1;
}

/**
 * Where emphasis can close in one text, by the length of the run: a run of exactly that many of
 * `c`, not after white space, not before a letter or digit; a backslash makes the next character
 * inert. The positions are in rising order.
 */
function closingRuns(s: string, c: string): number[][] {
  const byLength: number[][] = [[], [], [], []];
  for (let j = 0; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\\") {
      j++;
      continue;
    }
    if (ch !== c) continue;
    let run = 1;
    while (s[j + run] === c) run++;
    if (run <= 3 && j > 0 && !isSpace(s[j - 1]) && !isWord(s[j + run])) {
      (byLength[run] as number[]).push(j);
    }
    j += run - 1;
  }
  return byLength;
}

/** The closing runs of one text, made when first asked for, with a place in each list that only moves forward. */
class Closers {
  private readonly s: string;
  private readonly lists = new Map<string, number[][]>();
  private readonly at = new Map<string, number>();
  private readonly lookahead: number;

  constructor(s: string, lookahead: number) {
    this.s = s;
    this.lookahead = lookahead;
  }

  /** The start of the run that closes `delim`, at or after `from` and less than LOOKAHEAD further, or -1. `from` never goes back. */
  find(from: number, delim: string): number {
    const c = delim[0] as string;
    let lists = this.lists.get(c);
    if (lists === undefined) {
      lists = closingRuns(this.s, c);
      this.lists.set(c, lists);
    }
    const list = lists[delim.length] as number[];
    let k = this.at.get(delim) ?? 0;
    while (k < list.length && (list[k] as number) < from) k++;
    this.at.set(delim, k);
    const found = list[k];
    return found !== undefined && found < from + this.lookahead ? found : -1;
  }
}

/**
 * The index of the ")" that ends a destination starting at `from`, or -1. A destination is 1 to
 * 2,000 pieces, each one character that is neither white space nor a round bracket, or a pair of
 * round brackets around such characters. Nothing at or after `limit` is read.
 */
function destinationEnd(s: string, from: number, limit: number): number {
  const end = Math.min(s.length, limit);
  let j = from;
  let pieces = 0;
  while (j < end) {
    const ch = s[j] as string;
    if (ch === ")") return pieces >= 1 ? j : -1;
    if (pieces === MAX_DESTINATION_PIECES || SPACE.test(ch)) return -1;
    if (ch === "(") {
      let k = j + 1;
      while (k < end && s[k] !== "(" && s[k] !== ")" && !SPACE.test(s[k] as string)) k++;
      if (k >= end || s[k] !== ")") return -1;
      j = k + 1;
    } else {
      j++;
    }
    pieces++;
  }
  return -1;
}

/** Links with a label in one text: what is found once and asked for by every "[" before it. */
class Links {
  private readonly s: string;
  private nextClose = -1;
  private nextBreak = -1;
  private paren = -1;
  private parenEnd = -1;

  constructor(s: string) {
    this.s = s;
  }

  /** The label and destination of the link whose "[" is at `start`, and the index after it, or null. `start` never goes back. */
  at(start: number): { label: string; destination: string; after: number } | null {
    const s = this.s;
    if (this.nextClose <= start) {
      const found = s.indexOf("]", start + 1);
      this.nextClose = found === -1 ? Number.POSITIVE_INFINITY : found;
    }
    const close = this.nextClose;
    if (close - start - 1 > MAX_LABEL) return null;
    if (this.nextBreak <= start) {
      const found = s.indexOf("\n", start + 1);
      this.nextBreak = found === -1 ? Number.POSITIVE_INFINITY : found;
    }
    if (this.nextBreak < close || s[close + 1] !== "(") return null;
    if (this.paren !== close + 1) {
      this.paren = close + 1;
      // No "[" of this label is further back than MAX_LABEL + 1, so this limit is past every window.
      this.parenEnd = destinationEnd(s, close + 2, close + 2 + LINK_WINDOW);
    }
    const last = this.parenEnd;
    if (last === -1 || last >= start + LINK_WINDOW) return null;
    return { label: s.slice(start + 1, close), destination: s.slice(close + 2, last), after: last + 1 };
  }
}

/** A bare address without what is not part of it: closing punctuation and unbalanced closing brackets. */
function trimBareAddress(found: string): string {
  let end = found.length;
  const openRound = countOf(found, "(");
  const openSquare = countOf(found, "[");
  let closeRound = countOf(found, ")");
  let closeSquare = countOf(found, "]");
  for (;;) {
    const last = found[end - 1];
    if (last === undefined) break;
    if (NOT_PART_OF_AN_ADDRESS.includes(last)) {
      end--;
    } else if (last === ")" && openRound < closeRound) {
      end--;
      closeRound--;
    } else if (last === "]" && openSquare < closeSquare) {
      end--;
      closeSquare--;
    } else {
      break;
    }
  }
  return found.slice(0, end);
}

/**
 * design.md 4.7.2: the nodes of one paragraph. At each position the first rule that matches is
 * applied; otherwise the character is plain text.
 *
 * 1. A backslash before one of ` * ~ [ ] \ keeps both characters and makes the second inert.
 * 2. A run of n backticks up to the next run of exactly n backticks is inline code.
 * 3. [label](destination) and ![label](destination) are a link, for a safe scheme only; an image
 *    is never loaded.
 * 4. A bare http or https address is a link.
 * 5. ***text***, **text**, *text* and ~~text~~ are bold italic, bold, italic and struck through.
 * 6. Underscores, single tildes, #, >, -, numbers, vertical bars and HTML tags are always text.
 */
export function parseInline(s: string): InlineNode[] {
  return parseInlineWith(s, LOOKAHEAD);
}

/** parseInline with another look-ahead than 2,000: for tests, which reach the edge of a small window with short texts. */
export function parseInlineWith(s: string, lookahead: number): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = "";
  const push = (node: InlineNode | null): void => {
    if (buf !== "") {
      out.push({ type: "text", text: buf });
      buf = "";
    }
    if (node !== null) out.push(node);
  };
  const closers = new Closers(s, lookahead);
  const links = new Links(s);
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    const next = s[i + 1];

    // 1. A backslash makes the next delimiter character inert. Nothing is removed.
    if (ch === "\\" && next !== undefined && INERT_AFTER_BACKSLASH.includes(next)) {
      buf += ch + next;
      i += 2;
      continue;
    }

    // 2. Code span.
    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n++;
      const close = findBackticks(s, i + n, n, lookahead);
      if (close !== -1) {
        let text = s.slice(i + n, close);
        if (text.length > 2 && text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "") {
          text = text.slice(1, -1);
        }
        push({ type: "code", text });
        i = close + n;
        continue;
      }
      buf += s.slice(i, i + n);
      i += n;
      continue;
    }

    // 3. A link with a label, only for safe schemes.
    if (ch === "[" || (ch === "!" && next === "[")) {
      const start = ch === "!" ? i + 1 : i;
      const link = links.at(start);
      if (link !== null && SAFE_LINK.test(link.destination)) {
        push({
          type: "link",
          href: link.destination,
          text: link.label === "" ? link.destination : link.label,
        });
        i = link.after;
        continue;
      }
    }

    // 4. A bare http or https address.
    if ((ch === "h" || ch === "H") && !isWord(s[i - 1]) && BARE_HAS_HOST.test(s.slice(i, i + 9))) {
      const m = BARE.exec(s.slice(i, i + lookahead));
      if (m) {
        const url = trimBareAddress(m[0]);
        if (BARE_HAS_HOST.test(url)) {
          push({ type: "link", href: url, text: url });
          i += url.length;
          continue;
        }
      }
    }

    // 5. Emphasis and strikethrough. Underscores are never markup.
    if (ch === "*" || ch === "~") {
      let run = 1;
      while (s[i + run] === ch) run++;
      const delim = ch === "*" ? (run <= 3 ? ch.repeat(run) : null) : run === 2 ? "~~" : null;
      if (delim !== null && !isSpace(s[i + run]) && !isWord(s[i - 1])) {
        const close = closers.find(i + run, delim);
        if (close !== -1) {
          const children = parseInlineWith(s.slice(i + run, close), lookahead);
          const node: InlineNode =
            delim === "~~"
              ? { type: "strike", children }
              : delim === "*"
                ? { type: "em", children }
                : delim === "**"
                  ? { type: "strong", children }
                  : { type: "strong", children: [{ type: "em", children }] };
          push(node);
          i = close + run;
          continue;
        }
      }
      buf += s.slice(i, i + run);
      i += run;
      continue;
    }

    buf += ch;
    i++;
  }
  push(null);
  return out;
}

/** The text of the nodes as a reader sees it: what is drawn, without the markup characters. */
export function inlineText(nodes: readonly InlineNode[]): string {
  let text = "";
  for (const node of nodes) {
    text +=
      node.type === "text" || node.type === "code" || node.type === "link"
        ? node.text
        : inlineText(node.children);
  }
  return text;
}
