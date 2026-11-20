// The transcript importer of SessionVault for the web: how conversations get into the vault.
//
// It implements docs/import-rules.md: part A where the web keeps the behaviour of the Apple
// app, the rules W1 to W15 where it must not, and the items of part C that concern a pure
// module. The acceptance tests are the golden files in fixtures/import/.
//
// Everything here is a pure function of its arguments: no input or output, no clock, no
// randomness. It runs unchanged in a browser, in a worker and on the server (C4).

export { parseChatGPTExport } from "./chatgpt-export.ts";
export type { DecodedText } from "./decode.ts";
export { decodeBytes } from "./decode.ts";
export { splitDisplaySegments } from "./display.ts";
export type { FileNameParts } from "./file-name.ts";
export { splitFileName } from "./file-name.ts";
export type { ChromeStripResult } from "./guards.ts";
export { looksLikeSignInWall, stripChromeTurns } from "./guards.ts";
export { importCapture } from "./import-capture.ts";
export { importFile } from "./import-file.ts";
export { importPaste } from "./import-paste.ts";
export { looksLikeLink } from "./link.ts";
export type { RoleMarker } from "./markers.ts";
export { roleMarker } from "./markers.ts";
export { parseText } from "./parse-text.ts";
export { providerForUrl } from "./provider.ts";
export {
  countGraphemes,
  hasFewerGraphemesThan,
  normaliseText,
  splitLines,
  trimFull,
  trimInline,
} from "./text.ts";
export type {
  CaptureImportResult,
  CaptureInput,
  DisplaySegment,
  DroppedTurn,
  FileImportResult,
  FileOptions,
  ImportedResult,
  ImportFlag,
  ImportResult,
  InterchangeResult,
  JsonObject,
  LinkResult,
  ParsedMessage,
  ParsedSession,
  PasteImportResult,
  PasteOptions,
  Provider,
  RejectedResult,
  RejectReason,
  Role,
} from "./types.ts";
