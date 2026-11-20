// What the reader, the import and the export report: problems (the document is refused),
// repairs (the reader changed something, data-model.md 6.6) and warnings (for the user to look at).
//
// Messages and paths never quote the file, neither its values nor the property names it invents:
// they may be logged, and transcript text, titles and the like must not reach a log (HANDOFF.md
// section 8).

import {
  ATTACHMENT_KEYS,
  DOCUMENT_KEYS,
  GENERATOR_KEYS,
  MESSAGE_KEYS,
  PROJECT_KEYS,
  SESSION_KEYS,
} from "./types.ts";

/**
 * The rule a problem breaks.
 * - "json": the input is not JSON text, or holds something JSON cannot (a function, NaN, a cycle).
 * - "limit": nested too deeply or too large to check (see Limits).
 * - "format", "version": the first two checks of data-model.md 6.1.
 * - "schema": a structural rule of docs/interchange-schema-v1.json; `keyword` names which.
 * - "R1" to "R10": data-model.md 6.6. R11 and R12 are warnings only: see NoticeCode.
 * - "vault": a vault handed to the export or to checkVault breaks its own invariants.
 * - "internal": the code failed unexpectedly; nothing was imported or exported.
 */
export type RuleId =
  | "json"
  | "limit"
  | "format"
  | "version"
  | "schema"
  | "R1"
  | "R2"
  | "R3"
  | "R4"
  | "R5"
  | "R6"
  | "R7"
  | "R8"
  | "R9"
  | "R10"
  | "vault"
  | "internal";

/**
 * The schema keyword a "schema" problem breaks. (The two `const` keywords of the schema have rules
 * of their own: "format" and "version".)
 */
export type SchemaKeyword =
  | "type"
  | "required"
  | "enum"
  | "pattern"
  | "minLength"
  | "minimum"
  | "minItems"
  | "maxItems"
  | "uniqueItems";

/** One reason a document is refused. */
export interface Problem {
  readonly rule: RuleId;
  /** Present when `rule` is "schema". */
  readonly keyword?: SchemaKeyword;
  /**
   * JSON Pointer (RFC 6901) to the place in the document; "" is the document itself. A property
   * the format does not define appears as "(property N)", N being its place in its object.
   */
  readonly path: string;
  /** For people. Never quotes a value of the document. */
  readonly message: string;
}

/**
 * What a repair or a warning is about.
 *
 * Repairs, the reader's list of data-model.md 6.6:
 * - "id_lowercased" (1), "value_folded" (2: provider or role folded, trimmed, or empty made the
 *   fallback), "null_default" (3: a null stood where a default applies), "tags_normalised" (4),
 *   "string_cleaned" (5: U+0000 removed, lone surrogate replaced), "line_endings" (5: CR in a text
 *   segment), "messages_renumbered" (6), "segments_merged" (7).
 * - "timestamp_precision": digits beyond the millisecond were cut off (6.1).
 * - "property_dropped": two property names became equal after cleaning; the later one was dropped.
 *
 * Warnings:
 * - "project_missing" (repair 8), "bytes_discarded" (repair 9).
 * - "R11" (project names equal when trimmed and compared without case), "R12" (updated_at earlier
 *   than imported_at).
 * - Import (6.7): "project_name_taken" (step 2a: the new name belongs to another project),
 *   "id_replaced" (an incoming id was already used elsewhere and got a fresh one), "conflict"
 *   (same id, different content, equal updated_at), "bytes_rejected" (bytes that came with the
 *   document do not match their descriptor).
 * - Export (6.8): "bytes_omitted" (stored bytes do not match their descriptor or are too large to
 *   travel inline), "vault_repaired" (the vault held something a document may not; the export wrote
 *   the repaired value).
 */
export type NoticeCode =
  | "id_lowercased"
  | "value_folded"
  | "null_default"
  | "tags_normalised"
  | "string_cleaned"
  | "line_endings"
  | "messages_renumbered"
  | "segments_merged"
  | "timestamp_precision"
  | "property_dropped"
  | "project_missing"
  | "bytes_discarded"
  | "R11"
  | "R12"
  | "project_name_taken"
  | "id_replaced"
  | "conflict"
  | "bytes_rejected"
  | "bytes_omitted"
  | "vault_repaired";

/** One repair or one warning. */
export interface Notice {
  readonly code: NoticeCode;
  /** JSON Pointer to the place in the document. */
  readonly path: string;
  /** For people. Never quotes a value of the document. */
  readonly message: string;
}

/** A list that stays short however large or hostile the input is. */
export interface CappedList<T> {
  /** The first entries, at most `Limits.maxListed`. */
  readonly items: readonly T[];
  /** How many entries there were in all. */
  readonly total: number;
}

/** Repairs or warnings: the first ones in full, and a count of every kind. */
export interface NoticeList extends CappedList<Notice> {
  /** How many notices of each code there were in all. Codes that did not occur are absent. */
  readonly counts: Readonly<Partial<Record<NoticeCode, number>>>;
}

/** Bounds on the work one document may cause (web-platform.md 11.5 asks for size limits). */
export interface Limits {
  /** Deepest nesting of arrays and objects, counted from the document itself as level 1. */
  readonly maxDepth: number;
  /** Most values (objects, arrays, strings, numbers, ...) a document may hold. */
  readonly maxNodes: number;
  /** Most problems, repairs or warnings listed in full; the rest are only counted. */
  readonly maxListed: number;
}

export const DEFAULT_LIMITS: Limits = { maxDepth: 128, maxNodes: 10_000_000, maxListed: 500 };

/** The limits to work with: the defaults, with every usable value of `given` in their place. */
export function resolveLimits(given: Partial<Limits> | undefined): Limits {
  const pick = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
  return {
    maxDepth: pick(given?.maxDepth, DEFAULT_LIMITS.maxDepth),
    maxNodes: pick(given?.maxNodes, DEFAULT_LIMITS.maxNodes),
    maxListed: pick(given?.maxListed, DEFAULT_LIMITS.maxListed),
  };
}

/** Collects problems; keeps the first `maxListed` and counts the rest. */
export interface ProblemLog {
  add(problem: Problem): void;
  readonly total: number;
  list(): CappedList<Problem>;
}

export function createProblemLog(maxListed: number): ProblemLog {
  const items: Problem[] = [];
  let total = 0;
  return {
    add(problem) {
      total += 1;
      if (items.length < maxListed) items.push(problem);
    },
    get total() {
      return total;
    },
    list: () => ({ items: [...items], total }),
  };
}

/** Collects repairs or warnings; keeps the first `maxListed` and counts every code. */
export interface NoticeLog {
  add(code: NoticeCode, path: string, message: string): void;
  /** Take over everything another list holds, as far as there is room. */
  addAll(other: NoticeList): void;
  readonly total: number;
  list(): NoticeList;
}

export function createNoticeLog(maxListed: number): NoticeLog {
  const items: Notice[] = [];
  const counts = new Map<NoticeCode, number>();
  let total = 0;
  const count = (code: NoticeCode, by: number): void => {
    counts.set(code, (counts.get(code) ?? 0) + by);
    total += by;
  };
  return {
    add(code, path, message) {
      count(code, 1);
      if (items.length < maxListed) items.push({ code, path, message });
    },
    addAll(other) {
      for (const [code, by] of Object.entries(other.counts)) {
        // Object.entries widens the keys to string; the list's own items name the codes exactly.
        const known = NOTICE_CODES.get(code);
        if (known !== undefined && by !== undefined) count(known, by);
      }
      for (const item of other.items) if (items.length < maxListed) items.push(item);
    },
    get total() {
      return total;
    },
    list: () => ({ items: [...items], total, counts: Object.fromEntries(counts) }),
  };
}

const ALL_NOTICE_CODES: readonly NoticeCode[] = [
  "id_lowercased",
  "value_folded",
  "null_default",
  "tags_normalised",
  "string_cleaned",
  "line_endings",
  "messages_renumbered",
  "segments_merged",
  "timestamp_precision",
  "property_dropped",
  "project_missing",
  "bytes_discarded",
  "R11",
  "R12",
  "project_name_taken",
  "id_replaced",
  "conflict",
  "bytes_rejected",
  "bytes_omitted",
  "vault_repaired",
];
const NOTICE_CODES: ReadonlyMap<string, NoticeCode> = new Map(ALL_NOTICE_CODES.map((code) => [code, code]));

/** An empty list of notices. */
export const NO_NOTICES: NoticeList = { items: [], total: 0, counts: {} };

/** Every property name the format itself defines. Only these are ever quoted in a path. */
const FORMAT_VOCABULARY: ReadonlySet<string> = new Set([
  ...DOCUMENT_KEYS,
  ...GENERATOR_KEYS,
  ...PROJECT_KEYS,
  ...SESSION_KEYS,
  ...ATTACHMENT_KEYS,
  ...MESSAGE_KEYS,
  "type",
  "text",
]);

/**
 * One step of a JSON Pointer for a property name. A name the format does not define is not
 * quoted but given by its place among the properties of its object: a hostile file chooses its
 * own property names, and paths may be logged.
 */
export function pointerStep(key: string, position: number): string {
  return FORMAT_VOCABULARY.has(key) ? key : `(property ${position + 1})`;
}
