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
 * W7: whether the cleaner removes this line as boilerplate or as a bare time, when the line is
 * not indented and stands outside a closed fenced block. `trimmed` is the inline trim of a line.
 */
export function isFurnitureLine(trimmed: string): boolean {
  return isBoilerplate(trimmed) || TIME_LINE.test(trimmed);
}

/**
 * W7. Differences from the Apple cleaner (D5): a line keeps its indentation, an indented line
 * is never removed, and a closed fenced block is copied untouched. Kept on purpose (3.3 item 2):
 * outside fences an unindented line is still removed when it equals the kept line before it,
 * is one of the five furniture words, or is a bare time.
 *
 * `fenced` says for every line whether it is copied untouched as a line of a closed fenced
 * block. Left out, the lines are read for their fences as they stand. The share-page parser
 * reads a turn twice and passes the lines that either reading protects (W6). `first` is a line
 * that comes before `lines`: the text of a speaker line, which the parser cleans with its turn
 * without copying the turn into a new list.
 */
export function cleanTranscriptLines(
  lines: readonly string[],
  fenced: readonly boolean[] = closedFenceLines(lines),
  first?: { readonly line: string; readonly fenced: boolean },
): string[] {
  const kept: string[] = [];
  let last = "";
  const take = (raw: string, isFenced: boolean): void => {
    if (isFenced) {
      // W7: copied untouched, blank lines too; the last copied line becomes "last".
      kept.push(raw);
      last = raw;
      return;
    }
    const probe = trimInline(raw);
    if (probe === "") {
      // A run of blank lines collapses to one; none at the start.
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      return;
    }
    const line = trimInlineEnd(raw);
    if (line === probe) {
      // The line is not indented: the three removal rules apply.
      if (isFurnitureLine(probe)) return;
      if (line === last) return;
    }
    last = line;
    kept.push(line);
  };
  if (first !== undefined) take(first.line, first.fenced);
  for (let index = 0; index < lines.length; index++) take(lines[index] ?? "", fenced[index] === true);
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return kept;
}
