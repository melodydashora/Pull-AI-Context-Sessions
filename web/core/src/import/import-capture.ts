// Entry point for a capture result whose strings carry no roles from markup
// (docs/import-rules.md W10; 2.6). Results with roles from markup belong to capture.md 7.3.

import { cleanTranscriptLines } from "./cleaner.ts";
import { isSignInWall, stripChrome } from "./guards.ts";
import { splitLeadingRoleMarker } from "./markers.ts";
import { parseText } from "./parse-text.ts";
import { parseUrl, percentDecode } from "./platform.ts";
import { providerForUrl, providerFromLabels } from "./provider.ts";
import { imported, rejected } from "./result.ts";
import { isBlank, normaliseText, splitLines, trimFull } from "./text.ts";
import type {
  CaptureImportResult,
  CaptureInput,
  DroppedTurn,
  ParsedMessage,
  ParsedSession,
} from "./types.ts";

// W10: the last non-empty path segment of the link, percent-decoded. null when the link has
// none. W1 on the decoded text, which can hold what the link itself cannot (C5).
function lastPathSegment(sourceUrl: string): string | null {
  const url = parseUrl(sourceUrl);
  if (url === null) return null;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const last = segments[segments.length - 1];
  if (last === undefined) return null;
  return normaliseText(percentDecode(last) ?? last);
}

/**
 * W10: the first non-empty of the typed name, the detected title, the last path segment of
 * the link, the link. A capture of `https://host/` is called by its link, not `/` (D13).
 * D13 also rules out a title that is empty or all white space, so a blank candidate does not
 * count, and a capture with a blank link is an "Imported session" (W8).
 */
function captureTitle(typedName: string, detectedTitle: string, sourceUrl: string): string {
  const typed = trimFull(typedName);
  if (typed !== "") return typed;
  const detected = trimFull(detectedTitle);
  if (detected !== "") return detected;
  const segment = lastPathSegment(sourceUrl);
  if (segment !== null && !isBlank(segment)) return segment;
  return isBlank(sourceUrl) ? "Imported session" : sourceUrl;
}

// W10, kind "turns". The order of the steps on a turn is fixed: header lines and the chrome
// test on the raw turn, then the cleaner, then the full trim, then the leading marker.
function sessionFromTurns(
  turns: readonly string[],
  title: string,
  sourceUrl: string,
): { readonly session: ParsedSession | null; readonly dropped: DroppedTurn[] } {
  const { kept, dropped } = stripChrome(turns);
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

  // W1 on the link and the names too: they are stored with the session (C5).
  const sourceUrl = normaliseText(stringOr(input.sourceUrl, ""));
  const title = captureTitle(
    normaliseText(stringOr(input.typedName, "")),
    normaliseText(stringOr(input.detectedTitle, "")),
    sourceUrl,
  );

  if (kind === "page-text") {
    const session = sessionFromPageText(turns.join("\n"), title, sourceUrl);
    return session === null ? rejected("no_conversation_found") : imported([session]);
  }
  const { session, dropped } = sessionFromTurns(turns, title, sourceUrl);
  return session === null ? rejected("no_conversation_found", [], dropped) : imported([session], [], dropped);
}
