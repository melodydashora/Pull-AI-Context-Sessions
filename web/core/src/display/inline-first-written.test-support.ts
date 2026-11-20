// THE PARSER AS FIRST WRITTEN, kept only so that inline.differential.test.ts can compare results. Not exported, not used by any screen.
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
const LINK = /^\[([^\]\n]{0,500})\]\(((?:[^\s()]|\([^\s()]*\)){1,2000})\)/;
const BARE_START = /^https?:\/\//i;
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

/** The start of the run that closes `delim`: same character, same length, not after white space, not before a letter or digit. */
function findCloser(s: string, from: number, delim: string, lookahead: number): number {
  const end = Math.min(s.length, from + lookahead);
  const c = delim[0];
  for (let j = from; j < end; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] !== c) continue;
    let run = 1;
    while (s[j + run] === c) run++;
    if (run === delim.length && j > from && !isSpace(s[j - 1]) && !isWord(s[j + run])) return j;
    j += run - 1;
  }
  return -1;
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

/** The one change to the parser as first written: the look-ahead is a parameter, so that tests reach the edge of a small window. */
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
      const m = LINK.exec(s.slice(start, start + 2600));
      const label = m?.[1];
      const destination = m?.[2];
      if (m && label !== undefined && destination !== undefined && SAFE_LINK.test(destination)) {
        push({ type: "link", href: destination, text: label === "" ? destination : label });
        i = start + m[0].length;
        continue;
      }
    }

    // 4. A bare http or https address.
    if ((ch === "h" || ch === "H") && !isWord(s[i - 1]) && BARE_START.test(s.slice(i, i + 8))) {
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
        const close = findCloser(s, i + run, delim, lookahead);
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
