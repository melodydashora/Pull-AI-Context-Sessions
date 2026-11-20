// Suggested file names for exported documents (data-model.md 6.4):
// `sessionvault-vault-YYYYMMDD-HHMMSS.json` and `<title made file-system safe>.session.json`,
// and the one function that makes a title safe as a file name (5.1 B15, corrections.md 2, point 16).

import { parseTimestamp } from "./timestamp.ts";
import type { InterchangeDocument } from "./types.ts";

/** Point 16: the longest name, in UTF-8 bytes. With a suffix it stays far below the 255 bytes file systems allow. */
const MAX_NAME_BYTES = 120;

/** The characters Windows forbids in a file name: \ / : * ? " < > | */
const FORBIDDEN_CODES: ReadonlySet<number> = new Set([0x5c, 0x2f, 0x3a, 0x2a, 0x3f, 0x22, 0x3c, 0x3e, 0x7c]);

/**
 * What is replaced by "-": the forbidden characters and the control characters (U+0000 to U+001F,
 * U+007F to U+009F). A surrogate without its partner is replaced too: no file name can hold one.
 */
function isReplaced(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    FORBIDDEN_CODES.has(code)
  );
}

/**
 * White space as String.prototype.trim removes it, without the control characters U+0009 to
 * U+000D: those were replaced by "-" before anything is trimmed.
 */
function isTrimmedSpace(code: number): boolean {
  return (
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function utf8Bytes(code: number): number {
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

/** Without trailing white space, dots and spaces. A loop: an expression of the form `<class>+$` is quadratic. */
function trimTrailing(text: string): string {
  let end = text.length;
  while (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code !== 0x2e && !isTrimmedSpace(code)) break;
    end -= 1;
  }
  return text.slice(0, end);
}

function isAsciiLetter(code: number, upper: number): boolean {
  return code === upper || code === upper + 32;
}

/**
 * The device names of Windows, in any letter case: CON, PRN, AUX, NUL, COM0 to COM9, LPT0 to LPT9,
 * and COM and LPT followed by a superscript 1, 2 or 3 (U+00B9, U+00B2, U+00B3). The list is the
 * one of Microsoft's page "Naming Files, Paths, and Namespaces" as corrections.md 2, point 16
 * recalls it.
 */
function isWindowsDeviceName(stem: string): boolean {
  const is = (first: number, second: number, third: number): boolean =>
    isAsciiLetter(stem.charCodeAt(0), first) &&
    isAsciiLetter(stem.charCodeAt(1), second) &&
    isAsciiLetter(stem.charCodeAt(2), third);
  if (stem.length === 3) {
    return (
      is(0x43, 0x4f, 0x4e) || // CON
      is(0x50, 0x52, 0x4e) || // PRN
      is(0x41, 0x55, 0x58) || // AUX
      is(0x4e, 0x55, 0x4c) // NUL
    );
  }
  if (stem.length !== 4) return false;
  if (!is(0x43, 0x4f, 0x4d) && !is(0x4c, 0x50, 0x54)) return false; // COM, LPT
  const last = stem.charCodeAt(3);
  return (last >= 0x30 && last <= 0x39) || last === 0xb9 || last === 0xb2 || last === 0xb3;
}

/**
 * data-model.md 5.1 B15 as corrections.md 2, point 16 decides it: a title, or any text, as a file
 * name. One function, in this order:
 *
 *   1. `\ / : * ? " < > |` and control characters become "-";
 *   2. white space goes at both ends, and trailing dots and spaces;
 *   3. the name is cut to at most 120 UTF-8 bytes without splitting a code point, and trailing
 *      dots and spaces go again;
 *   4. an empty result becomes "session";
 *   5. if the part before the first dot is a Windows device name in any letter case, "_" is put
 *      in front.
 *
 * The work is bounded by the leading white space and 120 bytes, however long the title is:
 * what lies behind the cut never decides the result.
 */
export function fileSystemSafe(title: string): string {
  // Step 2, the front. Every white space character is one UTF-16 unit.
  let index = 0;
  while (index < title.length && isTrimmedSpace(title.charCodeAt(index))) index += 1;
  // Steps 1 and 3 together: replace, and stop where the next code point would pass 120 bytes.
  let safe = "";
  let bytes = 0;
  while (index < title.length) {
    const code = title.codePointAt(index) ?? 0;
    index += code > 0xffff ? 2 : 1;
    const kept = isReplaced(code) ? 0x2d : code;
    const size = utf8Bytes(kept);
    if (bytes + size > MAX_NAME_BYTES) break;
    safe += String.fromCodePoint(kept);
    bytes += size;
  }
  // Steps 2 and 3, the end: what a longer text would lose before the cut, it loses after it too.
  safe = trimTrailing(safe);
  if (safe === "") safe = "session";
  const dot = safe.indexOf(".");
  return isWindowsDeviceName(dot === -1 ? safe : safe.slice(0, dot)) ? `_${safe}` : safe;
}

/** The suggested name for the file a document is saved in. The media type is application/json. */
export function suggestedFileName(doc: InterchangeDocument): string {
  if (doc.kind === "session") {
    return `${fileSystemSafe(doc.sessions[0]?.title ?? "")}.session.json`;
  }
  // The time of the export, in UTC as the document states it.
  const reading = parseTimestamp(doc.exported_at);
  if (!reading.ok) return "sessionvault-vault.json";
  const digits = reading.canonical.replaceAll("-", "").replaceAll(":", "");
  return `sessionvault-vault-${digits.slice(0, 8)}-${digits.slice(9, 15)}.json`;
}
