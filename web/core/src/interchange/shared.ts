// The small rules that the reader, the merge and every other write path share (corrections.md
// section 2, G1): open values (G2), tags (data-model.md 8.2 with corrections.md 2, point 1) and the
// key of a project name (8.4). Each exists once in the core; the vault functions take them from here.

import { composedForm } from "./compose.ts";

/** corrections.md 2, G2: what an open value is trimmed of. U+0020 and U+0009 to U+000D, nothing else. */
const isOpenValueSpace = (c: number): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d);

/**
 * corrections.md 2, G2: the one normalisation of `provider` and `role`, as given there. Trim; an
 * empty result becomes the fallback; a value that equals a known value when only the ASCII letters
 * A to Z are folded is stored as that known lower-case value; any other value is stored trimmed, as
 * written.
 *
 * The trim is a loop and the fold is ASCII only on purpose: an expression of the form `<class>+$`
 * is quadratic on a long run of blanks, and JavaScript, Swift and SQL must give the same result
 * (never `trim()` or `toLowerCase()` here).
 */
export function normalizeOpen(value: string, known: readonly string[], fallback: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isOpenValueSpace(value.charCodeAt(start))) start++;
  while (end > start && isOpenValueSpace(value.charCodeAt(end - 1))) end--;
  const v = value.slice(start, end);
  if (v === "") return fallback;
  const folded = v.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  return known.includes(folded) ? folded : v;
}

/**
 * corrections.md 2, G2 and data-model.md 7.10: `provider` and a message `role` hold at most this
 * many characters. A longer value is refused, and it is measured as written, before any
 * normalisation: also when trimming would make it short enough.
 */
export const MAX_OPEN_VALUE_CHARACTERS = 200;

/**
 * True when the value is longer than MAX_OPEN_VALUE_CHARACTERS. A character is a code point (a
 * surrogate pair counts once, a lone surrogate once), which is what `char_length` counts in
 * PostgreSQL. At most 400 UTF-16 units are looked at, however long the value is.
 */
export function isOpenValueTooLong(value: string): boolean {
  if (value.length <= MAX_OPEN_VALUE_CHARACTERS) return false;
  // A code point takes one or two UTF-16 units.
  if (value.length > 2 * MAX_OPEN_VALUE_CHARACTERS) return true;
  let characters = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    characters += 1;
  }
  return characters > MAX_OPEN_VALUE_CHARACTERS;
}

/**
 * data-model.md 8.2 with corrections.md 2, point 1: the tags of a comma-separated field. Each part
 * is trimmed and lower-cased and loses its leading run of "#" and white space; empty parts and
 * repeats are dropped, the first of each kept. Idempotent: parseTags(parseTags(x).join(",")) is
 * parseTags(x).
 *
 * "Trimmed" is what String.prototype.trim removes (the set of `\s`) and "lower-case" is
 * toLowerCase(). The expression is anchored at the start, so it is tried at one place only, and
 * repeats are found through a Set: the work grows with the length of the field.
 */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of input.split(",")) {
    // corrections.md 2, point 1: the formula as written there.
    const tag = part
      .trim()
      .toLowerCase()
      .replace(/^[#\s]+/, "")
      .trim();
    if (tag !== "" && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * data-model.md 6.6 repair 4, as corrections.md 2, point 1 words it: `parseTags(tags.join(","))`.
 * That also splits an element that holds a comma and drops repeats across the elements.
 */
export function normaliseTags(elements: readonly string[]): string[] {
  return parseTags(elements.join(","));
}

/**
 * data-model.md 8.4: the value two project names are compared by (`projects.name_key`): trimmed,
 * in composed form, in lower case.
 *
 * The values are those of the function printed in 8.4. That one hands the whole name to
 * normalize("NFC"), which needs quadratic time on a long run of combining marks (a 160 kB file with
 * one such project name held the reader for 3.3 s, four times as long for each doubling);
 * composedForm returns the same text in time that grows with its length.
 */
export function projectNameKey(name: string): string {
  return composedForm(name.trim()).toLowerCase();
}
