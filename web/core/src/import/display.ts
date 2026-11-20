// The split of one message text into prose and code blocks (docs/import-rules.md 2.9 with
// the fence rule of W13; design.md 4.7.1 specifies the same splitter). It runs each time a
// message is drawn; the stored text is never changed.

import { scanFences } from "./fences.ts";
import { isBlank, normaliseText, splitLines } from "./text.ts";
import type { DisplaySegment } from "./types.ts";

/**
 * W13. Lines outside fenced blocks form prose; prose that is only white space is dropped,
 * and prose that is kept is not trimmed. An unterminated block is code to the end of the
 * text; an empty block is still a segment. `~~~` fences are not recognised.
 * W1 is applied first, so stored text with CR LF still splits correctly (D1).
 * design.md 5.4 tests blank prose with JavaScript trim(); 2.9 and the Swift source say full trim.
 */
export function splitDisplaySegments(text: string): DisplaySegment[] {
  const lines = splitLines(normaliseText(text));
  const segments: DisplaySegment[] = [];
  const pushProse = (from: number, to: number): void => {
    const prose = lines.slice(from, to).join("\n");
    if (!isBlank(prose)) segments.push({ type: "prose", text: prose });
  };
  let next = 0;
  for (const fence of scanFences(lines)) {
    pushProse(next, fence.open);
    const end = fence.close ?? lines.length;
    segments.push({
      type: "code",
      language: fence.info === "" ? null : fence.info,
      code: lines.slice(fence.open + 1, end).join("\n"),
    });
    next = fence.close === null ? lines.length : fence.close + 1;
  }
  pushProse(next, lines.length);
  return segments;
}
