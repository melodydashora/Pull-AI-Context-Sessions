// The reader: from JSON text or an already parsed value to a typed document or a list of
// problems (data-model.md 6.6). It never throws.

import {
  type CappedList,
  type Limits,
  NO_NOTICES,
  type NoticeList,
  type Problem,
  resolveLimits,
} from "./problems.ts";
import { FORMAT_MARKER, type InterchangeDocument } from "./types.ts";
import { type CheckMode, type CheckOutcome, checkDocument } from "./validate.ts";

export interface ReadOptions {
  /**
   * Ids of the projects of the vault the document is meant for. A session's `project_id` that the
   * document does not list is kept when it is one of these, and becomes null with a warning
   * otherwise (6.6 repair 8). Left out: no destination, so every such `project_id` becomes null.
   */
  readonly destinationProjectIds?: ReadonlySet<string>;
  /** Bounds on depth, size and the length of the reported lists. Defaults: DEFAULT_LIMITS. */
  readonly limits?: Partial<Limits>;
}

/** What reading gave: the document in canonical form, or the reasons it is refused as a whole. */
export type ReadResult =
  | {
      readonly ok: true;
      /**
       * Repaired and valid: it passes the schema and R1 to R10 as it is. One exception, by design
       * of repair 8: a `project_id` may name a project of `destinationProjectIds` that the document
       * itself does not list, which strict validation reports as R3.
       */
      readonly doc: InterchangeDocument;
      /** What the reader changed (6.6 repairs 1 to 7 and the canonical forms of 6.1). */
      readonly repairs: NoticeList;
      /** For the user: repairs 8 and 9, R11 and R12. */
      readonly warnings: NoticeList;
      /** The bytes of every inline attachment that matched its descriptor, by SHA-256. */
      readonly inlineBytes: ReadonlyMap<string, Uint8Array>;
    }
  | {
      readonly ok: false;
      /** Every rule the document still breaks after repair, with the place. Nothing may be imported. */
      readonly problems: CappedList<Problem>;
    };

/** What strict validation gave. `ok` is true when the document needs no repair at all. */
export interface ValidationResult {
  readonly ok: boolean;
  /** Breaches of the schema and of R1 to R10. */
  readonly problems: CappedList<Problem>;
  /** R11 and R12. */
  readonly warnings: NoticeList;
}

function refused(problem: Problem): CappedList<Problem> {
  return { items: [problem], total: 1 };
}

/** JSON text to a value. A leading byte-order mark is tolerated; JSON.parse itself rejects one. */
function parseText(text: string): { readonly value: unknown } | Problem {
  try {
    const value: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return { value };
  } catch (error) {
    // The engine's message quotes the text; it is not passed on.
    return error instanceof SyntaxError
      ? { rule: "json", path: "", message: "The text is not valid JSON." }
      : { rule: "internal", path: "", message: "The text could not be parsed." };
  }
}

type Checked =
  | { readonly parsed: true; readonly outcome: CheckOutcome }
  | { readonly parsed: false; readonly problems: CappedList<Problem> };

function check(input: unknown, mode: CheckMode, options: ReadOptions | undefined): Checked {
  let value = input;
  if (typeof input === "string") {
    const parsed = parseText(input);
    if (!("value" in parsed)) return { parsed: false, problems: refused(parsed) };
    value = parsed.value;
  }
  const outcome = checkDocument(value, {
    mode,
    limits: resolveLimits(options?.limits),
    destinationProjectIds: options?.destinationProjectIds,
  });
  return { parsed: true, outcome };
}

const UNREADABLE: Problem = { rule: "internal", path: "", message: "The input could not be read." };

/**
 * Read an interchange document leniently: check `format` and `version`, apply the repair list of
 * data-model.md 6.6, then validate. `input` is the JSON text or the value parsed from it.
 *
 * Never throws: whatever goes wrong comes back as a problem. A value handed over already parsed
 * is expected to be plain data; one whose property getters throw is refused as a whole.
 */
export function readDocument(input: unknown, options?: ReadOptions): ReadResult {
  try {
    const result = check(input, "repair", options);
    if (!result.parsed) return { ok: false, problems: result.problems };
    const { doc, problems, repairs, warnings, inlineBytes } = result.outcome;
    if (doc === null) return { ok: false, problems };
    return { ok: true, doc, repairs, warnings, inlineBytes };
  } catch {
    return { ok: false, problems: refused(UNREADABLE) };
  }
}

/**
 * Validate a document strictly, as a writer's output must pass (6.8): the schema and R1 to R10
 * without any repair. R11 and R12 come back as warnings. Never throws.
 */
export function validateDocument(input: unknown, options?: Pick<ReadOptions, "limits">): ValidationResult {
  try {
    const result = check(input, "strict", options);
    if (!result.parsed) return { ok: false, problems: result.problems, warnings: NO_NOTICES };
    const { problems, warnings } = result.outcome;
    return { ok: problems.total === 0, problems, warnings };
  } catch {
    return { ok: false, problems: refused(UNREADABLE), warnings: NO_NOTICES };
  }
}

/**
 * True when a parsed JSON value carries the marker of this format. A `.json` file for which this
 * holds goes to readDocument; every other file goes to the transcript importer (HANDOFF.md, phase 1).
 * Says nothing about whether the document is valid.
 */
export function isInterchangeDocument(value: unknown): boolean {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return Object.hasOwn(value, "format") && Reflect.get(value, "format") === FORMAT_MARKER;
  } catch {
    return false;
  }
}
