// Suggested file names for exported documents (data-model.md 6.4):
// `sessionvault-vault-YYYYMMDD-HHMMSS.json` and `<title made file-system safe>.session.json`.

import { utf8ByteLength } from "./text.ts";
import { parseTimestamp } from "./timestamp.ts";
import type { InterchangeDocument } from "./types.ts";

/**
 * Longest title part of a file name, in UTF-8 bytes. With the suffix it stays far below the 255
 * bytes file systems allow. Open point in data-model.md 5.1 B15: "cap the length" names no number.
 */
const MAX_TITLE_BYTES = 120;

function trimTrailingDotsAndSpaces(text: string): string {
  let end = text.length;
  while (end > 0 && (text.charCodeAt(end - 1) === 0x2e || text.charCodeAt(end - 1) === 0x20)) end -= 1;
  return text.slice(0, end);
}

/**
 * A title as part of a file name, by the rule of data-model.md 5.1 B15: the characters Windows
 * forbids in file names and control characters become "-", trailing dots and spaces go, the
 * length is capped, and nothing left gives "session".
 */
export function fileSystemSafe(title: string): string {
  let safe = "";
  let bytes = 0;
  for (const character of title) {
    const code = character.codePointAt(0) ?? 0;
    const forbidden =
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      '\\/:*?"<>|'.includes(character);
    const next = forbidden ? "-" : character;
    bytes += utf8ByteLength(next);
    if (bytes > MAX_TITLE_BYTES) break;
    safe += next;
  }
  return trimTrailingDotsAndSpaces(safe) || "session";
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
