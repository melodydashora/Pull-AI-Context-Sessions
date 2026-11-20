// One message text as the blocks that are drawn (docs/design.md 4.7.1 and 4.7.4): code blocks,
// and prose in chunks that never get too large for one element. A typed port of renderBlocks,
// splitParagraphs and splitLong in appendix 5.4 of that document.
//
// Two things differ from the reference, as docs/corrections.md 1.5 demands:
//   - the split into prose and code is splitDisplaySegments of ../import/ (import-rules.md 2.9
//     and W13, tested by fixture 57), so the blank test is the full trim and a fence line is
//     trimmed with the inline trim (1.5.1);
//   - nothing is trimmed with an expression that takes quadratic time on a long run of blanks
//     (1.5.13).

import { splitDisplaySegments } from "../import/display.ts";
import { isBlank } from "../import/text.ts";

/** One piece of prose. `continues` marks a piece cut from the paragraph before it: no paragraph gap above. */
export interface ProsePiece {
  readonly text: string;
  readonly continues: boolean;
}

export type RenderBlock =
  | { readonly type: "code"; readonly language: string | null; readonly code: string }
  | { readonly type: "prose"; readonly paragraphs: readonly ProsePiece[] };

/** Prose chunks hold at most this many characters, in whole paragraphs where possible. */
export const MAX_PROSE_CHARS = 6000;
/** A single line longer than this is cut. */
export const MAX_LINE_CHARS = 50000;

const SPACE = /\s/;

function isSpacesAndTabs(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== " " && ch !== "\t") return false;
  }
  return true;
}

/**
 * 4.7.1, rule 7: a blank line (it may hold spaces and tabs) ends a paragraph. Leading
 * indentation of a paragraph is kept, white space at its end is not, and a paragraph that is
 * only white space is dropped.
 */
export function splitParagraphs(prose: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const paragraph = current.join("\n").trimEnd();
    current = [];
    if (paragraph.trim() !== "") out.push(paragraph);
  };
  for (const line of prose.split("\n")) {
    if (isSpacesAndTabs(line)) flush();
    else current.push(line);
  }
  flush();
  return out;
}

/** 4.7.4, rules 2 and 3: a paragraph longer than `maxChars` in pieces cut at line breaks; a longer single line cut every `maxLine`. */
function splitLong(paragraph: string, maxChars: number, maxLine: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const pieces: string[] = [];
  let current: string | null = null;
  const flush = (): void => {
    if (current !== null) {
      pieces.push(current);
      current = null;
    }
  };
  for (const line of paragraph.split("\n")) {
    if (line.length > maxLine) {
      flush();
      for (let k = 0; k < line.length; k += maxLine) pieces.push(line.slice(k, k + maxLine));
      continue;
    }
    if (current !== null && current.length + 1 + line.length > maxChars) flush();
    current = current === null ? line : `${current}\n${line}`;
  }
  flush();
  return pieces;
}

/** The label drawn for a code block: the first word of its language tag. */
function languageLabel(tag: string | null): string | null {
  if (tag === null) return null;
  let end = 0;
  while (end < tag.length && !SPACE.test(tag[end] as string)) end++;
  const word = tag.slice(0, end);
  return word === "" ? null : word;
}

/**
 * design.md 4.7.4: the blocks of one message text. Code blocks keep their code unchanged; a
 * block whose code is empty or only white space is not drawn (4.7.1, rule 5). Prose comes in
 * chunks of at most `maxChars` characters made of whole paragraphs; a longer paragraph is cut at
 * line breaks, and pieces after the first carry `continues`. Nothing is shortened or left out:
 * the pieces of a paragraph joined by line breaks give the paragraph back, unless a single line
 * was longer than `maxLine`.
 */
export function renderBlocks(
  text: string,
  maxChars: number = MAX_PROSE_CHARS,
  maxLine: number = MAX_LINE_CHARS,
): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  for (const segment of splitDisplaySegments(text)) {
    if (segment.type === "code") {
      if (!isBlank(segment.code)) {
        blocks.push({ type: "code", language: languageLabel(segment.language), code: segment.code });
      }
      continue;
    }
    let chunk: ProsePiece[] = [];
    let size = 0;
    const flush = (): void => {
      if (chunk.length > 0) {
        blocks.push({ type: "prose", paragraphs: chunk });
        chunk = [];
        size = 0;
      }
    };
    for (const paragraph of splitParagraphs(segment.text)) {
      splitLong(paragraph, maxChars, maxLine).forEach((piece, k) => {
        if (size > 0 && size + piece.length > maxChars) flush();
        chunk.push({ text: piece, continues: k > 0 });
        size += piece.length;
      });
    }
    flush();
  }
  return blocks;
}
