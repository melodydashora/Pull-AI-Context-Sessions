// Share-page text (docs/import-rules.md 2.5.3 `parseClaudeShareText`, in the web form of W6):
// the visible text of a share page, cut into turns at header lines such as "You said:".

import { cleanTranscriptLines } from "./cleaner.ts";
import { mostFrequent } from "./provider.ts";
import { cleanTitle, isBlank, trimFull, trimInline } from "./text.ts";
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

/** The two prefixes that make this parser apply, as in the Apple test. */
const TRIGGER_PREFIXES: readonly string[] = ["You said:", "Claude responded:"];

/**
 * W6. null when this parser does not apply: no trigger line, or no turn with text.
 * `lines` are the lines of W1-normalised text. Text before the first header is dropped,
 * and any line that starts with a header starts a turn (3.3 item 4).
 */
export function parseSharePageText(lines: readonly string[], title: string): ParsedSession | null {
  const trimmedLines = lines.map(trimInline);
  const lineSet = new Set(trimmedLines);
  const wholeLineHeaders = WHOLE_LINE_HEADERS.every((header) => lineSet.has(header.text));
  const applies =
    wholeLineHeaders ||
    trimmedLines.some((line) => TRIGGER_PREFIXES.some((prefix) => line.startsWith(prefix)));
  if (!applies) return null;

  const messages: ParsedMessage[] = [];
  const assistantProviders: Exclude<Provider, "other">[] = [];
  let role: Role | null = null;
  let headerText = "";
  let turnLines: string[] = [];
  const flush = (): void => {
    let body = trimFull(cleanTranscriptLines(turnLines).join("\n"));
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
    const prefixHeader = PREFIX_HEADERS.find((header) => line.startsWith(header.text));
    const header =
      prefixHeader ??
      (wholeLineHeaders ? WHOLE_LINE_HEADERS.find((candidate) => line === candidate.text) : undefined);
    if (header !== undefined) {
      flush();
      role = header.role;
      // The text after a prefix header on its own line: a preview of the lines that follow.
      headerText = prefixHeader === undefined ? "" : trimInline(line.slice(prefixHeader.text.length));
      if (header.provider !== null) assistantProviders.push(header.provider);
    } else if (role !== null) {
      turnLines.push(lines[index] ?? "");
    }
  }
  flush();
  if (messages.length === 0) return null;

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
