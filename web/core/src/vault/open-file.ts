// The entry point for a picked or dropped file (HANDOFF.md section 7, phase 1): a `.json` file
// whose `format` is "sessionvault-interchange" goes to the interchange reader of data-model.md
// 6.6; every other file goes to the transcript importer of import-rules.md.

import {
  type ImportedResult,
  type ImportFlag,
  importFile,
  type JsonObject as ParsedJsonObject,
  type RejectedResult,
} from "../import/index.ts";
import { type Limits, type ReadOptions, type ReadResult, readDocument } from "../interchange/index.ts";

export interface OpenFileOptions {
  /**
   * import-rules.md W3, "keep as a plain-text note": send the text of a `.json` file to the text
   * parsers on purpose. Such a file is then never read as an interchange file.
   */
  readonly asPlainText?: boolean;
  /**
   * For an interchange file: the ids of the projects of the vault it is meant for, so that a
   * session keeps a project the file does not list (data-model.md 6.6 repair 8).
   */
  readonly destinationProjectIds?: ReadonlySet<string>;
  /** For an interchange file: bounds on depth, size and the length of the reported lists. */
  readonly limits?: Partial<Limits>;
}

/** The file was a transcript, or nothing the app can read: the transcript importer answered. */
export interface OpenedTranscript {
  readonly route: "transcript";
  /** Sessions to create with createSessions (data-model.md 8.6), or the reason there are none. */
  readonly result: ImportedResult | RejectedResult;
}

/** The file carries the marker of the interchange format: the interchange reader answered. */
export interface OpenedInterchange {
  readonly route: "interchange";
  /** The repaired, valid file with what was repaired, or the problems that refuse it as a whole. */
  readonly result: ReadResult;
  /** import-rules.md W2: the encoding that was assumed when the bytes were not UTF-8. */
  readonly flags: readonly ImportFlag[];
  /**
   * The parsed JSON as the file has it. To merge the file into a vault hand THIS to
   * importDocument, which reads it again against that vault; `result` is for showing what the
   * file holds before anything is saved.
   */
  readonly json: ParsedJsonObject;
}

/** Which of the two ways a file went, and what came of it. */
export type OpenedFile = OpenedTranscript | OpenedInterchange;

/**
 * Open the bytes of one file. `filename` is the name without a folder, as `File.name` gives it.
 *
 * The bytes are decoded once (import-rules.md W2) and the extension decides, as everywhere in the
 * importer (C2): only a file whose extension is `json`, in any letter case, can be an interchange
 * file, and it is one when its top level is an object whose `format` is
 * "sessionvault-interchange". What counts as an extension is the importer's rule (import-rules.md
 * 2.1): a file named just `.json` has none. Whether the file is valid, or of a version this app
 * reads, is the reader's answer; it is never tried as a transcript afterwards (W3).
 *
 * Nothing is saved and nothing is thrown, whatever the bytes hold.
 */
export function openFile(bytes: Uint8Array, filename: string, options?: OpenFileOptions): OpenedFile {
  const imported = importFile(bytes, filename, options?.asPlainText === true ? { asPlainText: true } : {});
  if (imported.outcome !== "interchange") return { route: "transcript", result: imported };
  const destinationProjectIds = options?.destinationProjectIds;
  const limits = options?.limits;
  const readOptions: ReadOptions = {
    ...(destinationProjectIds === undefined ? {} : { destinationProjectIds }),
    ...(limits === undefined ? {} : { limits }),
  };
  return {
    route: "interchange",
    result: readDocument(imported.json, readOptions),
    flags: imported.flags,
    json: imported.json,
  };
}
