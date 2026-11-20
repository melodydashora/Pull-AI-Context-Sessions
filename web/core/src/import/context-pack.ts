// Context pack (docs/import-rules.md W14, optional): the app's own export, pasted back in.
// The Apple importer has no parser for it and re-imports it badly (D15). The template is in
// data-model.md 4.1.

import { cleanTitle, isBlankLine, trimFull, trimInline } from "./text.ts";
import type { ParsedMessage, ParsedSession, Provider, Role } from "./types.ts";

const TITLE_PREFIX = "# Context pack: ";
const ORIGIN_PREFIX = "Origin: ";
const SOURCE_PREFIX = "Source: ";
const TAGS_PREFIX = "Tags: ";
const SUMMARY_HEADING = "## Summary";
const TRANSCRIPT_HEADING = "## Transcript";
/** First line of the paragraph that follows the summary in every pack. */
const PREAMBLE_START = "You are being given the transcript of an earlier conversation";
const SEPARATOR = "---";

/** W14 role lines. A Map, so that no other line can ever look like one. */
const ROLE_LINES: ReadonlyMap<string, Role> = new Map<string, Role>([
  ["**User:**", "user"],
  ["**Assistant:**", "assistant"],
  ["**System:**", "system"],
  ["**Note:**", "unknown"],
]);

const PROVIDERS_BY_NAME: ReadonlyMap<string, Provider> = new Map<string, Provider>([
  ["claude", "claude"],
  ["chatgpt", "chatgpt"],
  ["gemini", "gemini"],
]);

interface Origin {
  readonly provider: Provider;
  readonly model: string;
}

// W14: "Origin: <Provider>[ (<model>)], saved <date>". The date text depends on the locale
// of the device that wrote it and is not read. Plain string searches: nothing can backtrack.
function parseOrigin(value: string): Origin {
  const saved = value.lastIndexOf(", saved ");
  const origin = saved === -1 ? value : value.slice(0, saved);
  let name = origin;
  let model = "";
  const open = origin.indexOf(" (");
  if (open !== -1 && origin.endsWith(")")) {
    name = origin.slice(0, open);
    model = trimInline(origin.slice(open + 2, -1));
  }
  return { provider: PROVIDERS_BY_NAME.get(trimInline(name).toLowerCase()) ?? "other", model };
}

/** W14: tags are split at commas, trimmed and lower-cased; empty ones are dropped. */
function parseTags(value: string): string[] {
  const tags: string[] = [];
  for (const part of value.split(",")) {
    const tag = trimInline(part).toLowerCase();
    if (tag !== "") tags.push(tag);
  }
  return tags;
}

// W14: a message ends at a "---" line that is followed, after blank lines, by a role line or
// by nothing. A "---" that is followed by anything else belongs to the message text.
function parseTranscript(body: readonly string[]): ParsedMessage[] {
  // nextText[i]: the inline trim of the first non-blank line at or after i; null when none.
  const nextText = new Array<string | null>(body.length + 1).fill(null);
  for (let index = body.length - 1; index >= 0; index--) {
    const line = body[index] ?? "";
    nextText[index] = isBlankLine(line) ? (nextText[index + 1] ?? null) : trimInline(line);
  }

  const messages: ParsedMessage[] = [];
  let chunk: string[] = [];
  const closeChunk = (): void => {
    let first = 0;
    while (first < chunk.length && isBlankLine(chunk[first] ?? "")) first++;
    if (first < chunk.length) {
      const role = ROLE_LINES.get(trimInline(chunk[first] ?? ""));
      const text = trimFull(chunk.slice(role === undefined ? first : first + 1).join("\n"));
      if (text !== "") messages.push({ role: role ?? "unknown", text });
    }
    chunk = [];
  };
  for (let index = 0; index < body.length; index++) {
    const line = body[index] ?? "";
    if (trimInline(line) === SEPARATOR) {
      const next = nextText[index + 1] ?? null;
      if (next === null || ROLE_LINES.has(next)) {
        closeChunk();
        continue;
      }
    }
    chunk.push(line);
  }
  closeChunk();
  return messages;
}

/**
 * W14. null when the text is not a context pack, or holds no message. Applies if the first
 * non-blank line starts with "# Context pack: " and a line "## Transcript" follows.
 * `lines` are the lines of W1-normalised text.
 */
export function parseContextPack(lines: readonly string[]): ParsedSession | null {
  let start = 0;
  while (start < lines.length && isBlankLine(lines[start] ?? "")) start++;
  const titleLine = lines[start];
  if (titleLine === undefined || !titleLine.startsWith(TITLE_PREFIX)) return null;
  let transcript = -1;
  for (let index = start + 1; index < lines.length; index++) {
    if (trimInline(lines[index] ?? "") === TRANSCRIPT_HEADING) {
      transcript = index;
      break;
    }
  }
  if (transcript === -1) return null;

  // The header lines, up to "## Summary" or "## Transcript". A later line wins over an earlier one.
  let origin: Origin = { provider: "other", model: "" };
  let source = "";
  let tags: string[] = [];
  let index = start + 1;
  for (; index < transcript; index++) {
    const line = lines[index] ?? "";
    if (trimInline(line) === SUMMARY_HEADING) break;
    if (line.startsWith(ORIGIN_PREFIX)) origin = parseOrigin(line.slice(ORIGIN_PREFIX.length));
    else if (line.startsWith(SOURCE_PREFIX)) source = trimInline(line.slice(SOURCE_PREFIX.length));
    else if (line.startsWith(TAGS_PREFIX)) tags = parseTags(line.slice(TAGS_PREFIX.length));
  }

  // W14: the summary is what stands between "## Summary" and the hand-over paragraph.
  let summary = "";
  if (index < transcript) {
    const collected: string[] = [];
    for (index = index + 1; index < transcript; index++) {
      const line = lines[index] ?? "";
      if (line.startsWith(PREAMBLE_START)) break;
      collected.push(line);
    }
    summary = trimFull(collected.join("\n"));
  }

  const messages = parseTranscript(lines.slice(transcript + 1));
  if (messages.length === 0) return null;
  return {
    title: cleanTitle(titleLine.slice(TITLE_PREFIX.length)),
    provider: origin.provider,
    model: origin.model,
    sourceUrl: source,
    createdAt: null,
    summary,
    tags,
    messages,
  };
}
