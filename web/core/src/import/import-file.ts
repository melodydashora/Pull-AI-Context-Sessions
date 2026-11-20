// Entry point for a picked or dropped file (docs/import-rules.md W2, W3; C2).

import { isJsonObject, parseChatGPTExport } from "./chatgpt-export.ts";
import { decodeBytes } from "./decode.ts";
import { splitFileName } from "./file-name.ts";
import { parseText } from "./parse-text.ts";
import { imported, rejected } from "./result.ts";
import { isBlank, normaliseText } from "./text.ts";
import type { FileImportResult, FileOptions, ImportFlag, JsonObject } from "./types.ts";

/** data-model.md 6.1: the `format` of an interchange file. "Check it first." */
const INTERCHANGE_FORMAT = "sessionvault-interchange";

function isInterchange(json: unknown): json is JsonObject {
  return isJsonObject(json) && Object.hasOwn(json, "format") && json.format === INTERCHANGE_FORMAT;
}

// A byte array of this or of another realm, such as a worker.
function isByteArray(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === "[object Uint8Array]";
}

/**
 * Imports the bytes of one file. `filename` is the name without a folder, as `File.name`
 * gives it; its extension alone decides between the JSON rules and the text parsers, and its
 * stem is the fallback title (2.1).
 *
 * W2: the bytes are decoded explicitly, then normalised (W1). No bytes, or only white space:
 * `empty_input`. Not text: `undecodable`.
 * W3, extension `json` in any letter case: an interchange file is handed back untouched as
 * outcome `interchange`; a ChatGPT export is imported (W4); anything else, also text that is
 * not JSON, is `unrecognised_json`. The raw JSON is never imported silently (D9); with
 * `asPlainText` the caller sends it to the text parsers on purpose.
 * Every other file goes to the text parsers; nothing to store is `no_messages` (W12).
 */
export function importFile(bytes: Uint8Array, filename: string, options: FileOptions = {}): FileImportResult {
  // Callers outside the type system: bytes that are no byte array are not text.
  if (!isByteArray(bytes)) return rejected("undecodable");
  if (bytes.length === 0) return rejected("empty_input");
  const decoded = decodeBytes(bytes);
  if (decoded === null) return rejected("undecodable");
  const flags: ImportFlag[] = decoded.flag === null ? [] : [decoded.flag];
  const text = normaliseText(decoded.text);
  if (isBlank(text)) return rejected("empty_input", flags);

  const { stem, extension } = splitFileName(typeof filename === "string" ? filename : "");
  if (extension.toLowerCase() === "json" && options?.asPlainText !== true) {
    let json: unknown;
    try {
      // W1 has removed a leading U+FEFF, which JSON.parse would refuse (fixture 08).
      json = JSON.parse(text);
    } catch {
      return rejected("unrecognised_json", flags);
    }
    if (isInterchange(json)) {
      return { outcome: "interchange", reason: null, json, flags, sessions: [], droppedTurns: [] };
    }
    const sessions = parseChatGPTExport(json, text);
    if (sessions === null) return rejected("unrecognised_json", flags);
    if (sessions.length === 0) return rejected("no_messages", flags);
    return imported(sessions, flags);
  }

  const sessions = parseText(text, stem);
  if (sessions.length === 0) return rejected("no_messages", flags);
  return imported(sessions, flags);
}
