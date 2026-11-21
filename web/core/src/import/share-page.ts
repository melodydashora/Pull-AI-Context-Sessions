// Share-page text (docs/import-rules.md 2.5.3 `parseClaudeShareText`, in the web form of W6):
// the visible text of a share page, cut into turns at header lines such as "You said:".
//
// The Apple parser takes every text that holds such a line for a share page, begins a turn at
// every such line and drops what stands above the first one (D6). A note or a transcript that
// only quotes a speaker line would lose text that way, so W6 has three rules against it: a
// header that both readings of the fences put inside a closed block is text (when the fences of
// the text pair up), the parser applies only when both speakers have a header, and what stands
// above the first header is dropped only when it is the top of a share page.

import { cleanTranscriptLines, isFurnitureLine } from "./cleaner.ts";
import { closedFenceLines, closesFence, openingTicks, scanFences } from "./fences.ts";
import { HEADER_MARKERS } from "./guards.ts";
import { mostFrequent } from "./provider.ts";
import { cleanTitle, hasFewerGraphemesThan, isBlank, trimFull, trimInline, trimInlineEnd } from "./text.ts";
import type { ParsedMessage, ParsedSession, Provider, Role } from "./types.ts";

interface Header {
  readonly text: string;
  readonly role: Role;
  /** The provider an assistant header names; null for the user header. */
  readonly provider: Exclude<Provider, "other"> | null;
}

/** W6: tested on the inline-trimmed line with "starts with", case-sensitive. */
const PREFIX_HEADERS: readonly Header[] = [
  { text: "You said:", role: "user", provider: null },
  { text: "Claude responded:", role: "assistant", provider: "claude" },
  { text: "Claude said:", role: "assistant", provider: "claude" },
  { text: "ChatGPT said:", role: "assistant", provider: "chatgpt" },
  { text: "Gemini said:", role: "assistant", provider: "gemini" },
];

/**
 * W6: whole-line labels without a colon, used only if BOTH occur as complete lines.
 * Reported for Gemini pages by an earlier review and never checked against a live page;
 * if real pages differ the rule does not fire and the generic parser takes over.
 */
const WHOLE_LINE_HEADERS: readonly Header[] = [
  { text: "You said", role: "user", provider: null },
  { text: "Gemini said", role: "assistant", provider: "gemini" },
];

const ELLIPSIS = String.fromCodePoint(0x2026);

/**
 * The two prefixes of the Apple test. Without a line that starts with one of them, or the pair of
 * whole-line labels, no header of the user can remain: a quick way out, not the test itself.
 */
const TRIGGER_PREFIXES: readonly string[] = ["You said:", "Claude responded:"];

/** A letter, a digit or a combining mark: what continues a word (Unicode categories L, N and M). */
const WORD_CONTINUES = /^[\p{L}\p{N}\p{M}]/u;

/**
 * W6 (defect D19): the text after a speaker header is a preview exactly when the first non-blank
 * line of the turn, after the cleaner has run, begins with it once one trailing U+2026 or "..."
 * and the white space before it have been cut from it, and one of these holds: an ellipsis was
 * cut; the line ends where the text ends; or what follows in the line is not a letter, a digit or
 * a combining mark. So without an ellipsis the text must end where a word ends: "No" is no
 * preview of "Nothing works." and stays as the first line of the turn. With an ellipsis any
 * beginning counts, because a preview can be cut inside a word.
 */
function isPreviewOf(headerText: string, cleanedLines: readonly string[]): boolean {
  let stem = headerText;
  let ellipsisCut = true;
  if (stem.endsWith(ELLIPSIS)) stem = stem.slice(0, -1);
  else if (stem.endsWith("...")) stem = stem.slice(0, -3);
  else ellipsisCut = false;
  stem = trimInline(stem);
  const first = cleanedLines.find((line) => trimInline(line) !== "");
  if (first === undefined) return false;
  const line = trimInline(first);
  if (!line.startsWith(stem)) return false;
  return ellipsisCut || !WORD_CONTINUES.test(line.slice(stem.length));
}

/** The colon header that an inline-trimmed line starts with, if any. */
function prefixHeader(trimmed: string): Header | undefined {
  return PREFIX_HEADERS.find((header) => trimmed.startsWith(header.text));
}

/**
 * W6: for every line, whether a header on it is ordinary text because the line stands
 * inside a closed fenced block. The fences of the whole text are read twice with the rule of W13:
 *   1. the lines as written;
 *   2. the lines as written, except that on a line with a colon header outside a block the text
 *      after the header takes the place of the line, so that a block can open on a speaker
 *      line. The line of such a header is not inside the block that its text opens.
 * A line is text when both readings put it inside a closed block. If either reading ends inside
 * a block that never closes, no line is text: one lone fence would otherwise pair with the
 * opening fence of a later block and hide the turns between them.
 * Why two readings: with the first alone, the closing fence of a block that opened on a speaker
 * line pairs with the next fence line and hides the header between the two.
 */
function headerLinesAsText(lines: readonly string[], trimmedLines: readonly string[]): readonly boolean[] {
  const asWritten = scanFences(lines);
  // No block in the first reading: no line is inside a block of both.
  if (asWritten.length === 0) return NO_LINE_IS_TEXT;
  const asText = new Array<boolean>(lines.length).fill(false);
  if (asWritten.some((fence) => fence.close === null)) return asText;

  const inSecond = new Array<boolean>(lines.length).fill(false);
  let index = 0;
  while (index < lines.length) {
    const line = trimmedLines[index] ?? "";
    const header = prefixHeader(line);
    const ticks = openingTicks(header === undefined ? line : trimInline(line.slice(header.text.length)));
    if (ticks === 0) {
      index++;
      continue;
    }
    let close = index + 1;
    while (close < lines.length && !closesFence(trimmedLines[close] ?? "", ticks)) close++;
    if (close >= lines.length) return asText;
    for (let inside = header === undefined ? index : index + 1; inside <= close; inside++) {
      inSecond[inside] = true;
    }
    index = close + 1;
  }
  for (const fence of asWritten) {
    for (let inside = fence.open; inside <= (fence.close ?? -1); inside++) {
      asText[inside] = inSecond[inside] === true;
    }
  }
  return asText;
}

/** For a text without fences: no line is text. */
const NO_LINE_IS_TEXT: readonly boolean[] = [];

/** W6: the top of a share page has at most this many lines that are not blank, */
const TOP_LINES_MAX = 12;
/** and fewer than this many characters, counted over those lines joined by line feeds. */
const TOP_CHARS_LIMIT = 700;
/** W6: the phrases of a page top, in lower case: the HEADER list of 2.6 and two more. */
const TOP_PHRASES: readonly string[] = [...HEADER_MARKERS, "skip to content", "conversation with gemini"];

/**
 * W6: whether the lines above the first header are the top of a share page. They are
 * when they are few and short and one of them is a sign of a page: a line that the cleaner of
 * W7 removes as boilerplate or as a time, or a line that holds one of the phrases of a page
 * header. Only a line that the cleaner could remove is looked at for the sign: one that is not
 * indented and stands outside a closed fenced block, the fences being those of these lines read
 * alone. An indented "Report" or "log in" inside a block of code is text that somebody wrote.
 * The length is counted in user-perceived characters (W15), over the lines that are not blank,
 * inline-trimmed and joined with line feeds.
 */
function isSharePageTop(lines: readonly string[], trimmedLines: readonly string[], end: number): boolean {
  // The lead is lines[0] up to, not including, `end`. Only its lines that are not blank count, and
  // only twelve of them can: a blank line neither opens nor closes a block (W13), so the fences of
  // these lines alone pair up as those of the whole lead.
  const shown: string[] = [];
  const raw: string[] = [];
  for (let index = 0; index < end; index++) {
    const line = trimmedLines[index] ?? "";
    if (line === "") continue;
    if (shown.length === TOP_LINES_MAX) return false;
    shown.push(line);
    raw.push(lines[index] ?? "");
  }
  if (!hasFewerGraphemesThan(shown.join("\n"), TOP_CHARS_LIMIT)) return false;
  const fenced = closedFenceLines(raw);
  return shown.some((line, index) => {
    if (fenced[index] === true) return false;
    // Indented: the cleaner keeps an indented line whatever it says.
    if (line !== trimInlineEnd(raw[index] ?? "")) return false;
    if (isFurnitureLine(line)) return true;
    const lowered = line.toLowerCase();
    return TOP_PHRASES.some((phrase) => lowered.includes(phrase));
  });
}

/**
 * W6. null when this parser does not apply: no turn with text, or not at least one header of
 * each speaker. The text then goes on to the generic parser, which keeps what stands above its
 * first marker. `lines` are the lines of W1-normalised text.
 *
 * A line that starts with a header starts a turn (3.3 item 4), unless both readings of the fences
 * put it inside a closed block and neither reading ends in a block that never closes. The lines
 * above the first header are dropped when they are the top of a share page; otherwise they are
 * the first message, with role unknown.
 */
export function parseSharePageText(lines: readonly string[], title: string): ParsedSession | null {
  const trimmedLines = lines.map(trimInline);
  const lineSet = new Set(trimmedLines);
  const wholeLineHeaders = WHOLE_LINE_HEADERS.every((header) => lineSet.has(header.text));
  // The quick way out for text that is no share page. It follows from the rule about both
  // speakers below: without one of these lines no header of the user can remain.
  const applies =
    wholeLineHeaders ||
    trimmedLines.some((line) => TRIGGER_PREFIXES.some((prefix) => line.startsWith(prefix)));
  if (!applies) return null;
  const asText = headerLinesAsText(lines, trimmedLines);

  const messages: ParsedMessage[] = [];
  const assistantProviders: Exclude<Provider, "other">[] = [];
  /** Where the first header that remains stands: the lead is the lines above it. */
  let leadEnd = -1;
  let sawUser = false;
  let sawAssistant = false;
  let role: Role | null = null;
  let headerText = "";
  let turnLines: string[] = [];
  const flush = (): void => {
    // W6: the lines of the turn are read twice for the fences of W7: alone, and with the text of
    // the speaker line in front as their first line (once if there is no such text). A line that
    // either reading puts inside a closed fenced block is copied untouched by the cleaner, in
    // both runs below. Read alone, a block that opens on the speaker line is no block: its lines
    // went as page furniture and its closing fence passed for the text that the speaker line
    // previews.
    const alone = closedFenceLines(turnLines);
    // Which lines the cleaner copies untouched, and whether the text of the speaker line is one.
    // When that text opens no block it closes none either, being the first line: read with it,
    // the lines of the turn have the fences they have alone, and only one reading is made.
    let fenced: readonly boolean[] = alone;
    let labelFenced = false;
    if (openingTicks(headerText) > 0) {
      const withLabel = closedFenceLines([headerText, ...turnLines]);
      fenced = alone.map((inside, at) => inside || withLabel[at + 1] === true);
      labelFenced = withLabel[0] === true;
    }
    let kept = cleanTranscriptLines(turnLines, fenced);
    // W6 (D19): the text on a speaker line is the first line of its turn, unless it is a preview
    // of what follows. The Apple app drops it whenever more text follows, and loses words when a
    // person wrote "You said: first sentence" and went on below. When it is kept, the cleaner runs
    // over it followed by the lines of the turn.
    if (headerText !== "" && !isPreviewOf(headerText, kept)) {
      kept = cleanTranscriptLines(turnLines, fenced, { line: headerText, fenced: labelFenced });
    }
    let body = trimFull(kept.join("\n"));
    // W6: a turn whose only text sits on its header line keeps that text (D6).
    if (body === "") body = headerText;
    // corrections.md 3, point 8: "empty" is empty after the full trim. The header-line text is
    // only inline-trimmed, so it can be blank without being empty: that is no message (W12).
    // A message that is kept is stored as before.
    if (role !== null && !isBlank(body)) messages.push({ role, text: body });
    turnLines = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = trimmedLines[index] ?? "";
    // A line that both readings put inside a closed block is neither a colon header nor a
    // whole-line label (when the fences of the text pair up).
    const isText = asText[index] === true;
    const colonHeader = isText ? undefined : prefixHeader(line);
    const header =
      colonHeader ??
      (wholeLineHeaders && !isText
        ? WHOLE_LINE_HEADERS.find((candidate) => line === candidate.text)
        : undefined);
    if (header !== undefined) {
      if (leadEnd === -1) leadEnd = index;
      flush();
      role = header.role;
      if (header.role === "user") sawUser = true;
      else sawAssistant = true;
      // The text after a colon header on its line: the first line of the turn, or a preview of it.
      headerText = colonHeader === undefined ? "" : trimInline(line.slice(colonHeader.text.length));
      if (header.provider !== null) assistantProviders.push(header.provider);
    } else if (role !== null) {
      turnLines.push(lines[index] ?? "");
    }
  }
  flush();
  if (messages.length === 0) return null;
  // One speaker alone makes no share page. A header of either kind counts, also one whose
  // turn gave no message.
  if (!sawUser || !sawAssistant) return null;
  // What stands above the first header is kept, unless it is the top of a share page.
  if (leadEnd > 0 && !isSharePageTop(lines, trimmedLines, leadEnd)) {
    const note = trimFull(cleanTranscriptLines(lines.slice(0, leadEnd)).join("\n"));
    if (note !== "") messages.unshift({ role: "unknown", text: note });
  }

  return {
    title: cleanTitle(title),
    // W6: the provider named by most assistant headers, the first seen winning a tie.
    provider: mostFrequent(assistantProviders) ?? "other",
    model: "",
    sourceUrl: "",
    createdAt: null,
    summary: "",
    tags: [],
    messages,
  };
}
