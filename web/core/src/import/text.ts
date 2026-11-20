// String primitives with the semantics of Swift and Foundation (docs/import-rules.md 2.3),
// and the normalisation every input goes through (W1). JavaScript's trim(), length and \s
// are close to these but not equal, so nothing here uses them.

/** 2.3: the 19 code points of `CharacterSet.whitespaces`. All are single UTF-16 units. */
function isInlineSpace(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200b) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** 2.3: the 26 code points of `CharacterSet.whitespacesAndNewlines`. U+FEFF is not one of them. */
function isFullSpace(code: number): boolean {
  return (
    isInlineSpace(code) ||
    (code >= 0x0a && code <= 0x0d) ||
    code === 0x85 ||
    code === 0x2028 ||
    code === 0x2029
  );
}

// The trims scan from both ends: linear, where an expression such as /[ \t]+$/ is quadratic
// on a long run of blanks in the middle of a line.
function trimWith(text: string, isSpace: (code: number) => boolean): string {
  let start = 0;
  let end = text.length;
  while (start < end && isSpace(text.charCodeAt(start))) start++;
  while (end > start && isSpace(text.charCodeAt(end - 1))) end--;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

/** 2.3 "inline trim": Swift `trimmingCharacters(in: .whitespaces)`. Keeps CR, LF and U+FEFF. */
export function trimInline(text: string): string {
  return trimWith(text, isInlineSpace);
}

/** 2.3 "full trim": Swift `trimmingCharacters(in: .whitespacesAndNewlines)`. Keeps U+FEFF. */
export function trimFull(text: string): string {
  return trimWith(text, isFullSpace);
}

/** W7: the line without trailing inline white space; indentation is kept. */
export function trimInlineEnd(text: string): string {
  let end = text.length;
  while (end > 0 && isInlineSpace(text.charCodeAt(end - 1))) end--;
  return end === text.length ? text : text.slice(0, end);
}

/** True when the full trim of the text is empty. */
export function isBlank(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!isFullSpace(text.charCodeAt(i))) return false;
  }
  return true;
}

/** True when the inline trim of the line is empty. */
export function isBlankLine(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (!isInlineSpace(line.charCodeAt(i))) return false;
  }
  return true;
}

/** 2.3: lines are cut at every LF and nowhere else. `"a\n"` gives `"a"` and `""`. */
export function splitLines(text: string): string[] {
  return text.split("\n");
}

let graphemeSegmenter: Intl.Segmenter | null = null;

// A fixed locale, so that the result never depends on the locale of the machine.
function graphemesOf(text: string): Intl.Segments {
  graphemeSegmenter ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  return graphemeSegmenter.segment(text);
}

/** 2.3 "length": Swift `String.count`, the number of user-perceived characters (W15). */
export function countGraphemes(text: string): number {
  let count = 0;
  for (const _grapheme of graphemesOf(text)) count++;
  return count;
}

/** W15: `length(text) < limit` without walking a long text further than the limit. */
export function hasFewerGraphemesThan(text: string, limit: number): boolean {
  if (limit <= 0) return false;
  if (text.length < limit) return true; // a grapheme has at least one UTF-16 unit
  let count = 0;
  for (const _grapheme of graphemesOf(text)) {
    count++;
    if (count >= limit) return false;
  }
  return true;
}

/** U+0000 and U+FFFD, written as numbers so that the source stays plain ASCII. */
const NUL = String.fromCharCode(0x0000);
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

const ANY_SURROGATE = /[\uD800-\uDFFF]/;

// W1 step 4. The same result as String.prototype.toWellFormed, which the compile target lacks.
function replaceLoneSurrogates(text: string): string {
  if (!ANY_SURROGATE.test(text)) return text;
  let parts: string[] | null = null;
  let copied = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1); // NaN past the end
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      i += 2; // a valid pair
      continue;
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      parts ??= [];
      if (i > copied) parts.push(text.slice(copied, i));
      parts.push(REPLACEMENT_CHARACTER);
      copied = i + 1;
    }
    i++;
  }
  if (parts === null) return text;
  parts.push(text.slice(copied));
  return parts.join("");
}

/**
 * W1: (1) remove one leading U+FEFF, (2) CR LF and then every other CR become LF,
 * (3) remove U+0000, (4) lone surrogates become U+FFFD. No Unicode normalisation.
 * Applied to every string that enters the importer; afterwards the text can be stored (C5).
 */
export function normaliseText(text: string): string {
  let result = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (result.includes("\r")) result = result.replace(/\r\n?/g, "\n");
  if (result.includes(NUL)) result = result.replaceAll(NUL, "");
  return replaceLoneSurrogates(result);
}

/** W8: a title is full-trimmed; an empty one becomes "Imported session". W1 first (C5). */
export function cleanTitle(title: string): string {
  const cleaned = trimFull(normaliseText(title));
  return cleaned === "" ? "Imported session" : cleaned;
}
