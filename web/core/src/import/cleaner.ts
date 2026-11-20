// The furniture cleaner (docs/import-rules.md 2.5.3 `cleanTranscriptLines`, in the web form
// of W7). Removes what a share page prints around a turn: boilerplate lines, bare clock
// times, and a line equal to the kept line before it. Runs on every turn of the share-page
// parser and of a multi-turn capture.

import { closedFenceLines } from "./fences.ts";
import { trimInline, trimInlineEnd } from "./text.ts";

/** 2.5.3: boilerplate, the whole line, case-sensitive. */
const BOILERPLATE_LINES: ReadonlySet<string> = new Set(["Report", "Copy", "Retry", "Share", "Claude"]);

/** 2.5.3: boilerplate, the start of the line, case-sensitive. */
const BOILERPLATE_PREFIXES: readonly string[] = [
  "Shared by ",
  "This is a copy of a chat",
  "Content may include unverified",
  "Shared snapshot may contain",
  "Ask Claude your own question",
  "Claude can make mistakes",
];

/** W7: a bare clock time, ASCII digits only (D18). `10:42`, `10:42 AM`, `9:05PM`. */
const TIME_LINE = /^[0-9]{1,2}:[0-9]{2}\s?(AM|PM)?$/;

function isBoilerplate(line: string): boolean {
  return BOILERPLATE_LINES.has(line) || BOILERPLATE_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * W7. Differences from the Apple cleaner (D5): a line keeps its indentation, an indented line
 * is never removed, and a closed fenced block is copied untouched. Kept on purpose (3.3 item 2):
 * outside fences an unindented line is still removed when it equals the kept line before it,
 * is one of the five furniture words, or is a bare time.
 */
export function cleanTranscriptLines(lines: readonly string[]): string[] {
  const fenced = closedFenceLines(lines);
  const kept: string[] = [];
  let last = "";
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? "";
    if (fenced[index] === true) {
      // W7: copied untouched, blank lines too; the last copied line becomes "last".
      kept.push(raw);
      last = raw;
      continue;
    }
    const probe = trimInline(raw);
    if (probe === "") {
      // A run of blank lines collapses to one; none at the start.
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    const line = trimInlineEnd(raw);
    if (line === probe) {
      // The line is not indented: the three removal rules apply.
      if (isBoilerplate(probe) || TIME_LINE.test(probe)) continue;
      if (line === last) continue;
    }
    last = line;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return kept;
}
