// Fenced code blocks (docs/import-rules.md W13, the CommonMark rule for backtick fences).
// One scan serves the display splitter (W13), the furniture cleaner (W7) and the generic
// parser (W8), which all mean the same thing by "fenced block".

import { trimInline } from "./text.ts";

export interface Fence {
  /** Index of the opening line. */
  readonly open: number;
  /** Index of the closing line; null when the block runs to the end of the text. */
  readonly close: number | null;
  /** The text after the opening backticks, inline-trimmed; "" when there is none. */
  readonly info: string;
}

const BACKTICK = 0x60;

function countLeadingBackticks(line: string): number {
  let count = 0;
  while (count < line.length && line.charCodeAt(count) === BACKTICK) count++;
  return count;
}

/**
 * W13, the opening line: 3 or more backticks followed by text that has no backtick. `trimmed` is
 * the inline trim of a line. The number of backticks that open a block there, 0 when none does.
 */
export function openingTicks(trimmed: string): number {
  const ticks = countLeadingBackticks(trimmed);
  return ticks < 3 || trimmed.indexOf("`", ticks) !== -1 ? 0 : ticks;
}

/**
 * W13, the closing line of a block that `ticks` backticks opened: only backticks, that many or
 * more. `trimmed` is the inline trim of a line.
 */
export function closesFence(trimmed: string, ticks: number): boolean {
  return trimmed.length >= ticks && countLeadingBackticks(trimmed) === trimmed.length;
}

/**
 * W13:
 * - opening line: its inline trim is 3 or more backticks followed by text that has no backtick;
 * - closing line for an opening of n backticks: a later line whose inline trim is only
 *   backticks, n or more of them; the first one closes the block;
 * - with no closing line the block runs to the end; lines inside a block never open one.
 * Lines are cut at LF only (2.3), so U+2028 and U+2029 are ordinary characters of a line.
 * design.md 4.7.1 trims fence lines of spaces and tabs only; W13 and the Swift source say inline trim.
 */
export function scanFences(lines: readonly string[]): Fence[] {
  const fences: Fence[] = [];
  let index = 0;
  // Every line is looked at once: after a closed block the scan goes on behind it, and an
  // open block ends the scan.
  while (index < lines.length) {
    const opening = trimInline(lines[index] ?? "");
    const ticks = openingTicks(opening);
    if (ticks === 0) {
      index++;
      continue;
    }
    const info = trimInline(opening.slice(ticks));
    let close = index + 1;
    while (close < lines.length && !closesFence(trimInline(lines[close] ?? ""), ticks)) close++;
    if (close >= lines.length) {
      fences.push({ open: index, close: null, info });
      break;
    }
    fences.push({ open: index, close, info });
    index = close + 1;
  }
  return fences;
}

/**
 * For every line, whether it lies inside a CLOSED fenced block, opening and closing lines
 * included. A block without a closing line protects nothing (W7, W8).
 */
export function closedFenceLines(lines: readonly string[]): boolean[] {
  const inside = new Array<boolean>(lines.length).fill(false);
  for (const fence of scanFences(lines)) {
    if (fence.close === null) continue;
    for (let index = fence.open; index <= fence.close; index++) inside[index] = true;
  }
  return inside;
}
