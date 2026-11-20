// Entry point for a capture result whose strings carry no roles from markup
// (docs/import-rules.md W10; 2.6). Results with roles from markup belong to capture.md 7.3.

import { cleanTranscriptLines } from "./cleaner.ts";
import { isSignInWall, stripChrome } from "./guards.ts";
import { splitLeadingRoleMarker } from "./markers.ts";
import { parseText } from "./parse-text.ts";
import { parseUrl, percentDecode } from "./platform.ts";
import { providerForUrl, providerFromLabels } from "./provider.ts";
import { imported, rejected } from "./result.ts";
import { normaliseText, splitLines, trimFull } from "./text.ts";
import type {
  CaptureImportResult,
  CaptureInput,
  DroppedTurn,
  ParsedMessage,
  ParsedSession,
} from "./types.ts";

/** corrections.md 3, point 6: the title of a capture when every other candidate is empty. */
const LAST_TITLE = "Captured session";

// corrections.md 3, point 6: every candidate goes through W1 and the full trim. The decoded
// path segment needs W1 too: it can hold what the link itself cannot, U+0000 for one (C5).
function titleCandidate(value: string): string {
  return trimFull(normaliseText(value));
}

// W10: the last non-empty path segment of the link, percent-decoded; as written if decoding
// fails. null when the link has none: it is no URL, or its path holds nothing but slashes.
function lastPathSegment(sourceUrl: string): string | null {
  const url = parseUrl(sourceUrl);
  if (url === null) return null;
  const path = url.pathname;
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 0x2f) end--;
  if (end === 0) return null;
  const segment = path.slice(path.lastIndexOf("/", end - 1) + 1, end);
  return percentDecode(segment) ?? segment;
}

/**
 * W10 with corrections.md 3, point 6: the first candidate that is not empty after W1 and the
 * full trim: the typed name, the detected title, the last non-empty path segment of the link,
 * the link itself, and last the constant "Captured session". So a title is never blank and
 * never holds U+0000 (D13), and a capture of `https://host/` is called by its link, not `/`.
 */
function captureTitle(typedName: string, detectedTitle: string, sourceUrl: string): string {
  const typed = titleCandidate(typedName);
  if (typed !== "") return typed;
  const detected = titleCandidate(detectedTitle);
  if (detected !== "") return detected;
  const segment = lastPathSegment(sourceUrl);
  if (segment !== null) {
    const fromPath = titleCandidate(segment);
    if (fromPath !== "") return fromPath;
  }
  const link = titleCandidate(sourceUrl);
  return link === "" ? LAST_TITLE : link;
}

// W10, kind "turns". The order of the steps on a turn is fixed: header lines and the chrome
// test on the raw turn, then the cleaner, then the full trim, then the leading marker.
// A dropped turn that `keepDropped` puts back is then treated like any kept turn, so one that
// holds nothing but furniture lines still gives no message.
function sessionFromTurns(
  turns: readonly string[],
  title: string,
  sourceUrl: string,
  keepDropped: readonly number[] | undefined,
): { readonly session: ParsedSession | null; readonly dropped: DroppedTurn[] } {
  const { kept, dropped } = stripChrome(turns, keepDropped);
  const messages: ParsedMessage[] = [];
  const labels: string[] = [];
  for (const turn of kept) {
    const cleaned = trimFull(cleanTranscriptLines(splitLines(turn)).join("\n"));
    if (cleaned === "") continue;
    // A turn has a role only when its first line is a marker (3.3 item 5); a bare name counts.
    const marker = splitLeadingRoleMarker(cleaned);
    if (marker === null) {
      messages.push({ role: "unknown", text: cleaned });
      continue;
    }
    labels.push(marker.name);
    // W12: a turn that is only a label gives no message.
    if (marker.text !== "") messages.push({ role: marker.role, text: marker.text });
  }
  if (messages.length === 0) return { session: null, dropped };
  const session: ParsedSession = {
    title,
    // W9: the host of the link, else the speaker labels.
    provider: providerForUrl(sourceUrl) ?? providerFromLabels(labels) ?? "other",
    model: "",
    sourceUrl,
    createdAt: null,
    summary: "",
    tags: [],
    messages,
  };
  return { session, dropped };
}

// W10, kind "page-text": the whole page goes to the text parsers, like a paste.
function sessionFromPageText(pageText: string, title: string, sourceUrl: string): ParsedSession | null {
  const first = parseText(pageText, title)[0];
  if (first === undefined) return null;
  // The capture title always wins over one found in the page text (D13), and the host of
  // the link over the labels (W9).
  return { ...first, title, sourceUrl, provider: providerForUrl(sourceUrl) ?? first.provider };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Imports the strings a capture harvested from a page.
 *
 * W10: W1 on each string; no string: `no_conversation_found`. For whole-page text that looks
 * like a sign-in or landing page, `sign_in_suspected` unless `allowWall` is set; the test is
 * never applied to harvested turns (capture.md 7.4). Page text then goes to the text parsers;
 * turns lose leading and trailing page chrome, which is reported in `droppedTurns`, and are
 * cleaned one by one. Nothing left: `no_conversation_found`.
 *
 * `keepDropped` (W10 `keep_dropped`, kind "turns" only) puts dropped turns back: the user
 * interface shows `droppedTurns` and repeats the call with the indexes the user chose.
 * `droppedTurns` then holds only the turns that stay dropped.
 */
export function importCapture(input: CaptureInput): CaptureImportResult {
  // Callers outside the type system: anything but a list of strings is no capture.
  const rawTurns: unknown = input?.turns;
  if (!Array.isArray(rawTurns) || !rawTurns.every((turn) => typeof turn === "string")) {
    return rejected("no_conversation_found");
  }
  const kind = input.kind;
  if (kind !== "page-text" && kind !== "turns") return rejected("no_conversation_found");

  const turns = input.turns.map(normaliseText);
  if (turns.length === 0) return rejected("no_conversation_found");
  if (kind === "page-text" && input.allowWall !== true && isSignInWall(turns)) {
    return rejected("sign_in_suspected");
  }

  // corrections.md 3, point 7: W1 on the link too, which is stored with the session (C5).
  const sourceUrl = normaliseText(stringOr(input.sourceUrl, ""));
  const title = captureTitle(stringOr(input.typedName, ""), stringOr(input.detectedTitle, ""), sourceUrl);

  if (kind === "page-text") {
    const session = sessionFromPageText(turns.join("\n"), title, sourceUrl);
    return session === null ? rejected("no_conversation_found") : imported([session]);
  }
  const { session, dropped } = sessionFromTurns(turns, title, sourceUrl, input.keepDropped);
  return session === null ? rejected("no_conversation_found", [], dropped) : imported([session], [], dropped);
}
