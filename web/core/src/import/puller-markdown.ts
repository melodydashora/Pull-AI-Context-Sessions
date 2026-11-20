// Puller Markdown (docs/import-rules.md 2.5.2 `parsePullSessionsMarkdown`, in the web form of
// W5): what puller/pull_sessions.py writes. The lines `# <id>` and `Source: <url>`, then the
// turns, each followed by a line `---`. A `--combine` file holds several such transcripts.

import { splitLeadingRoleMarker } from "./markers.ts";
import { providerForUrl, providerFromLabels } from "./provider.ts";
import { cleanTitle, isBlank, isBlankLine, trimFull, trimInline } from "./text.ts";
import type { ParsedMessage, ParsedSession } from "./types.ts";

const TITLE_PREFIX = "# ";
const SOURCE_PREFIX = "Source: ";

/** W5: a "header pair" is a line starting with "# " followed directly by one starting with "Source: ". */
function isHeaderPairAt(lines: readonly string[], index: number): boolean {
  const first = lines[index];
  const second = lines[index + 1];
  return (
    first !== undefined &&
    second !== undefined &&
    first.startsWith(TITLE_PREFIX) &&
    second.startsWith(SOURCE_PREFIX)
  );
}

function buildSession(
  title: string,
  source: string,
  blocks: readonly string[],
  fallbackTitle: string,
): ParsedSession | null {
  const messages: ParsedMessage[] = [];
  const labels: string[] = [];
  for (const rawBlock of blocks) {
    const block = trimFull(rawBlock);
    if (block === "") continue;
    // 2.5.2: a role is found only on the first line of a block; a bare name counts here.
    const marker = splitLeadingRoleMarker(block);
    if (marker === null) {
      messages.push({ role: "unknown", text: block });
      continue;
    }
    labels.push(marker.name);
    // W12: a block that is only a label gives no message.
    if (marker.text !== "") messages.push({ role: marker.role, text: marker.text });
  }
  // W12: a session with no message is not returned.
  if (messages.length === 0) return null;
  return {
    // W5: the text after "# "; if empty, the title passed by the caller. corrections.md 3,
    // point 8: empty after the full trim, so a title of line separators alone falls back too.
    title: isBlank(title) ? cleanTitle(fallbackTitle) : title,
    // W9: the host of the Source line, else the speaker labels.
    provider: providerForUrl(source) ?? providerFromLabels(labels) ?? "other",
    model: "",
    sourceUrl: source,
    createdAt: null,
    summary: "",
    tags: [],
    messages,
  };
}

/**
 * W5. null: the text is not puller Markdown. Otherwise the sessions in file order, possibly
 * none (a header with no turns; the caller rejects that as `no_messages`).
 * `lines` are the lines of W1-normalised text. Kept from Apple: a `---` line inside a turn
 * splits it, because the format cannot say otherwise.
 */
export function parsePullerMarkdown(lines: readonly string[], fallbackTitle: string): ParsedSession[] | null {
  let start = 0;
  while (start < lines.length && isBlankLine(lines[start] ?? "")) start++;
  if (!isHeaderPairAt(lines, start)) return null;

  const sessions: ParsedSession[] = [];
  let title = "";
  let source = "";
  let blocks: string[] = [];
  let block: string[] = [];
  let blockHasText = false;
  let sessionOpen = false;
  const closeSession = (): void => {
    blocks.push(block.join("\n"));
    const session = buildSession(title, source, blocks, fallbackTitle);
    if (session !== null) sessions.push(session);
  };

  let index = start;
  while (index < lines.length) {
    // W5: a header pair starts a NEW session whenever it appears at the start of a block,
    // that is, when only blank lines were seen since the last "---" or the previous pair.
    if (!blockHasText && isHeaderPairAt(lines, index)) {
      if (sessionOpen) closeSession();
      sessionOpen = true;
      title = trimInline((lines[index] ?? "").slice(TITLE_PREFIX.length));
      source = trimInline((lines[index + 1] ?? "").slice(SOURCE_PREFIX.length));
      blocks = [];
      block = [];
      index += 2;
      continue;
    }
    const line = lines[index] ?? "";
    if (trimInline(line) === "---") {
      blocks.push(block.join("\n"));
      block = [];
      blockHasText = false;
    } else {
      block.push(line);
      if (!isBlankLine(line)) blockHasText = true;
    }
    index++;
  }
  if (sessionOpen) closeSession();
  return sessions;
}
