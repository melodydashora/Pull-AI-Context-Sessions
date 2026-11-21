// The guards around captured text (docs/import-rules.md 2.6, used as W10 and W11 say):
// the sign-in-wall test, the page-chrome test and the header-line stripper. The three tests
// are ported unchanged from the Apple app; what changes is how they are used. They match
// substrings, so they err in both directions (3.3 item 1): hence `allowWall` and `droppedTurns`.

import { hasFewerGraphemesThan, normaliseText, trimFull, trimInline } from "./text.ts";
import type { DroppedTurn } from "./types.ts";

/** 2.6 MARKERS: phrases of signed-out landing and consent pages, in lower case. */
const WALL_MARKERS: readonly string[] = [
  "sign in",
  "log in",
  "meet gemini",
  "google terms",
  "terms of service",
  "just a moment",
  "verify you are human",
  "welcome back",
  "your personal ai assistant",
  "cookie",
  "privacy policy",
];

/** 2.6 HEADER: what page-header residue at the top of the first turn contains, in lower case. */
export const HEADER_MARKERS: readonly string[] = [
  "sign in",
  "log in",
  "created with",
  "conversation transcript",
  "shared conversation",
  "ai overview",
];

/** 2.10: the thresholds, in user-perceived characters (W15). */
const WALL_SHORT = 1200;
const WALL_LONG = 2500;
const CHROME_LIMIT = 700;
const HEADER_LINE_LIMIT = 90;
const HEADER_LINES_MAX = 12;

// Each marker counts once, however often it occurs.
function countWallMarkers(lowered: string): number {
  let hits = 0;
  for (const marker of WALL_MARKERS) {
    if (lowered.includes(marker)) hits++;
  }
  return hits;
}

function containsHeaderMarker(lowered: string): boolean {
  return HEADER_MARKERS.some((marker) => lowered.includes(marker));
}

/** 2.6 `looksLikeSignInWall` on W1-normalised strings. */
export function isSignInWall(turns: readonly string[]): boolean {
  const joined = turns.join("\n");
  // Nothing is a wall at 2500 characters or more: decided before the text is searched.
  if (!hasFewerGraphemesThan(joined, WALL_LONG)) return false;
  const hits = countWallMarkers(joined.toLowerCase());
  return hasFewerGraphemesThan(joined, WALL_SHORT) ? hits >= 2 : hits >= 4;
}

/** 2.6 `isChrome` on a W1-normalised string: a turn of 700 characters or more is never chrome. */
export function isChromeTurn(text: string): boolean {
  if (!hasFewerGraphemesThan(text, CHROME_LIMIT)) return false;
  const lowered = text.toLowerCase();
  return (
    lowered.includes("ai overview") ||
    lowered.includes("can make mistakes") ||
    lowered.includes("sign in") ||
    countWallMarkers(lowered) >= 2
  );
}

/**
 * 2.6 `stripLeadingHeaderLines` on a W1-normalised string: removes leading lines, at most 12,
 * while the line is blank, or is shorter than 90 characters and contains a header phrase.
 * The rest is full-trimmed, also when no line is removed; if nothing is left the text comes
 * back unchanged.
 */
export function stripLeadingHeaderLines(text: string): string {
  let offset = 0; // start of the first line that stays
  let removed = 0;
  let allLinesRemoved = false;
  while (removed < HEADER_LINES_MAX) {
    const lineEnd = text.indexOf("\n", offset);
    const line = trimInline(lineEnd === -1 ? text.slice(offset) : text.slice(offset, lineEnd));
    const isHeader =
      line === "" ||
      (hasFewerGraphemesThan(line, HEADER_LINE_LIMIT) && containsHeaderMarker(line.toLowerCase()));
    if (!isHeader) break;
    removed++;
    if (lineEnd === -1) {
      allLinesRemoved = true;
      break;
    }
    offset = lineEnd + 1;
  }
  const rest = allLinesRemoved ? "" : trimFull(text.slice(offset));
  return rest === "" ? text : rest;
}

export interface ChromeStripResult {
  /**
   * The turns that stay, in input order: the first one the scan kept without its header
   * lines, and among them every dropped turn that `keepDropped` put back.
   */
  readonly kept: string[];
  /** The turns removed as page chrome that stay removed, in input order. */
  readonly dropped: DroppedTurn[];
}

// W10 "restore": `keep_dropped` is a list of input indexes, empty when absent. Whatever is
// no index of a turn names no dropped turn and is ignored; so is a value of another type
// from a caller outside the type system. A set, so that a long list costs one pass.
function restoredIndexes(keepDropped: unknown, turnCount: number): ReadonlySet<number> {
  const indexes = new Set<number>();
  if (!Array.isArray(keepDropped)) return indexes;
  for (const value of keepDropped) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < turnCount) {
      indexes.add(value);
    }
  }
  return indexes;
}

/**
 * W10 `stripChromeTurns`, web form, on W1-normalised strings.
 * From the front: header lines are stripped first and the rest is judged (D4, fixture 42);
 * a chrome turn is dropped, the first other turn is kept without its header lines.
 * From the end: turns are dropped while they are chrome, never the first kept turn.
 * Restore: `keepDropped` does not change the two scans. Afterwards every dropped turn whose
 * index is in the list goes back to its place in input order: one dropped from the front as
 * `stripLeadingHeaderLines` left it, one dropped from the end as it is.
 */
export function stripChrome(turns: readonly string[], keepDropped?: readonly number[]): ChromeStripResult {
  let first = 0;
  let firstStripped: string | null = null;
  while (first < turns.length) {
    const stripped = stripLeadingHeaderLines(turns[first] ?? "");
    if (!isChromeTurn(stripped)) {
      firstStripped = stripped;
      break;
    }
    first++;
  }
  let end = turns.length;
  while (end - 1 > first && isChromeTurn(turns[end - 1] ?? "")) end--;

  const restored = restoredIndexes(keepDropped, turns.length);
  const kept: string[] = [];
  const dropped: DroppedTurn[] = [];
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index] ?? "";
    if (index >= first && index < end) {
      kept.push(index === first && firstStripped !== null ? firstStripped : turn);
    } else if (restored.has(index)) {
      kept.push(index < first ? stripLeadingHeaderLines(turn) : turn);
    } else {
      dropped.push({ position: index < first ? "leading" : "trailing", index, text: turn });
    }
  }
  return { kept, dropped };
}

/**
 * The sign-in-wall test of 2.6: under 1200 characters, two marker phrases make a wall; under
 * 2500, four; nothing longer is one. A warning the user can override, not a verdict (W10, W11).
 * W1 is applied to each string first.
 */
export function looksLikeSignInWall(turns: readonly string[]): boolean {
  return isSignInWall(turns.map(normaliseText));
}

/**
 * The page-chrome stripper of W10 for the turns of a capture. W1 is applied to each string
 * first; `dropped` holds the normalised texts with their positions in the input.
 *
 * `keepDropped` (W10 `keep_dropped`) lists input indexes of dropped turns that the user wants
 * back: each returns to its place among `kept` and leaves `dropped`. An index that names no
 * dropped turn is ignored.
 */
export function stripChromeTurns(
  turns: readonly string[],
  keepDropped?: readonly number[],
): ChromeStripResult {
  return stripChrome(turns.map(normaliseText), keepDropped);
}
