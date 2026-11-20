// Detection order for text (docs/import-rules.md 2.2, with the web parsers of 3.2).

import { parseContextPack } from "./context-pack.ts";
import { parseGenericText } from "./generic-text.ts";
import { parsePullerMarkdown } from "./puller-markdown.ts";
import { parseSharePageText } from "./share-page.ts";
import { normaliseText, splitLines } from "./text.ts";
import type { ParsedSession } from "./types.ts";

/**
 * Turns text into sessions: context pack (W14), puller Markdown (W5), share-page text (W6),
 * generic text (W8), in this order; the first parser that applies decides.
 *
 * The text is normalised first (W1), like every string that enters the importer; on text an
 * entry point has normalised already, that removes at most one more leading U+FEFF, as in
 * the reference port. The result is empty when nothing is left to store (W12): only white
 * space, or a puller header without turns. `title` is the fallback title; parsers that find
 * a title of their own use that.
 */
export function parseText(text: string, title: string): ParsedSession[] {
  const normal = normaliseText(text);
  const lines = splitLines(normal);
  const pack = parseContextPack(lines);
  if (pack !== null) return [pack];
  const pulled = parsePullerMarkdown(lines, title);
  if (pulled !== null) return pulled;
  const shared = parseSharePageText(lines, title);
  if (shared !== null) return [shared];
  const generic = parseGenericText(normal, lines, title);
  return generic === null ? [] : [generic];
}
