// One checker for interchange documents, used in two ways (data-model.md 6.6):
//
//   "strict": what a writer must satisfy. The structural rules of the schema and R1 to R10 are
//             problems, R11 and R12 are warnings, and nothing is changed.
//   "repair": what a reader does. The repair list of 6.6 is applied first; whatever still breaks
//             the schema or R1 to R10 afterwards is a problem and the document is refused whole.
//
// Both ways run the same code, so the repaired form is by construction the form the strict check
// accepts. The work is bounded: the first pass copies the input through an explicit stack with a
// depth and a size limit, and everything after it walks the fixed structure of the format.
//
// corrections.md section 2 settles the open points of 6.6; each place below names its point.
// Order of the repairs (point 3): string cleaning (repair 5) first, in the copy; then the others
// in the order of the list, as each part of the document is checked.

import { decodeBase64 } from "./base64.ts";
import {
  assemble,
  isJsonArray,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  type MutableJsonObject,
  newObject,
  unknownProperties,
} from "./json.ts";
import {
  type CappedList,
  createNoticeLog,
  createProblemLog,
  type Limits,
  type Notice,
  type NoticeList,
  type NoticeLog,
  type Problem,
  type ProblemLog,
  pointerStep,
  type RuleId,
  type SchemaKeyword,
} from "./problems.ts";
import { sha256Hex } from "./sha256.ts";
import {
  hasBase64Shape,
  hasFilenameShape,
  hasMediaTypeShape,
  hasTagShape,
  hasVisibleCharacter,
  isCanonicalUuid,
  isSha256Hex,
  isSha256HexOfAnyCase,
  isUuidOfAnyCase,
} from "./shapes.ts";
import {
  isOpenValueTooLong,
  MAX_OPEN_VALUE_CHARACTERS,
  normaliseTags,
  normalizeOpen,
  projectNameKey,
} from "./shared.ts";
import { cleanString, hasCarriageReturn, hasNulOrLoneSurrogate, normaliseLineEndings } from "./text.ts";
import { parseTimestamp } from "./timestamp.ts";
import {
  ATTACHMENT_KEY_SET,
  type AttachmentSegment,
  DOCUMENT_KEY_SET,
  type DocumentKind,
  FALLBACK_PROVIDER,
  FALLBACK_ROLE,
  FORMAT_MARKER,
  FORMAT_VERSION,
  GENERATOR_KEY_SET,
  type InterchangeAttachment,
  type InterchangeDocument,
  type InterchangeGenerator,
  type InterchangeMessage,
  type InterchangeProject,
  type InterchangeSegment,
  type InterchangeSession,
  isTextSegment,
  KNOWN_PROVIDERS,
  KNOWN_ROLES,
  MESSAGE_KEY_SET,
  PROJECT_KEY_SET,
  SESSION_KEY_SET,
  type TextSegment,
} from "./types.ts";

export type CheckMode = "strict" | "repair";

export interface CheckOptions {
  readonly mode: CheckMode;
  readonly limits: Limits;
  /**
   * Repair 8: ids of the projects of the destination vault. A `project_id` that resolves there is
   * kept although the document does not list the project. Only read in "repair" mode.
   */
  readonly destinationProjectIds?: ReadonlySet<string> | undefined;
}

export interface CheckOutcome {
  /** The document in canonical form, or null when there are problems. */
  readonly doc: InterchangeDocument | null;
  readonly problems: CappedList<Problem>;
  /** What "repair" mode changed. Empty in "strict" mode. */
  readonly repairs: NoticeList;
  readonly warnings: NoticeList;
  /** "repair" mode: the bytes of every inline attachment that matched its descriptor, by SHA-256. */
  readonly inlineBytes: ReadonlyMap<string, Uint8Array>;
}

interface Context {
  readonly repairing: boolean;
  readonly limits: Limits;
  readonly problems: ProblemLog;
  readonly repairs: NoticeLog;
  readonly warnings: NoticeLog;
  readonly destinationProjectIds: ReadonlySet<string> | null;
  readonly inlineBytes: Map<string, Uint8Array>;
  /** R2: message ids seen so far in the whole document. */
  readonly messageIds: Set<string>;
  /**
   * G2: the objects of the copy whose `provider` or `role` was longer than 200 characters as
   * written. The limit is judged before any normalisation, and cleaning can shorten a value.
   */
  readonly overlong: { readonly provider: Set<JsonObject>; readonly role: Set<JsonObject> };
  /** R3: ids of the document's projects; null while a session is checked on its own. */
  projectIds: ReadonlySet<string> | null;
  /** Point 8: how many timestamps lost digits beyond the millisecond. */
  cutTimestamps: number;
}

function createContext(options: CheckOptions): Context {
  return {
    repairing: options.mode === "repair",
    limits: options.limits,
    problems: createProblemLog(options.limits.maxListed),
    repairs: createNoticeLog(options.limits.maxListed),
    warnings: createNoticeLog(options.limits.maxListed),
    destinationProjectIds: options.destinationProjectIds ?? null,
    inlineBytes: new Map(),
    messageIds: new Set(),
    overlong: { provider: new Set(), role: new Set() },
    projectIds: null,
    cutTimestamps: 0,
  };
}

function schemaProblem(c: Context, path: string, keyword: SchemaKeyword, message: string): void {
  c.problems.add({ rule: "schema", keyword, path, message });
}

function ruleProblem(c: Context, rule: RuleId, path: string, message: string): void {
  c.problems.add({ rule, path, message });
}

/** The JSON type of a value, for messages. */
function typeName(value: JsonValue): string {
  if (value === null) return "null";
  if (isJsonArray(value)) return "an array";
  if (isJsonObject(value)) return "an object";
  return `a ${typeof value}`;
}

// ---------------------------------------------------------------------------------------------
// First pass: a clean copy of the input.
// ---------------------------------------------------------------------------------------------

interface ArrayFrame {
  readonly kind: "array";
  readonly source: readonly unknown[];
  readonly target: JsonValue[];
  next: number;
  /** Pointer step of the child being copied. */
  step: string | null;
}

interface ObjectFrame {
  readonly kind: "object";
  readonly source: { readonly [key: string]: unknown };
  readonly keys: readonly string[];
  readonly target: MutableJsonObject;
  next: number;
  step: string | null;
}

type Frame = ArrayFrame | ObjectFrame;

/**
 * True for an object without a prototype and for one whose prototype is an Object.prototype, of
 * this realm or of another (a frame, a worker's clone). Only own properties are ever read, so
 * nothing a prototype holds can reach the copy.
 */
function isPlainObject(value: object): value is { readonly [key: string]: unknown } {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/**
 * Copy the input into arrays and prototype-less objects, strings cleaned (repair 5) or checked
 * (R9). Returns undefined when there is nothing to go on with. Uses its own stack, so neither deep
 * nesting nor a cycle can exhaust the call stack, and counts every value against `maxNodes`.
 *
 * corrections.md 2, point 3: repair 5 runs first, before every other repair. A tag such as
 * " \u0000 a" would otherwise pass repair 4 and then fail R4.
 */
function cleanCopy(input: unknown, c: Context): JsonValue | undefined {
  const frames: Frame[] = [];
  const ancestors = new Set<object>();
  let nodes = 0;
  let stopped = false;
  // Set when a value could not be copied. The copy goes on, to report every such place, but its
  // result is not checked further: the gaps would only cause misleading follow-up problems.
  let incomplete = false;
  const cannotCopy = (rule: "json" | "limit", at: string, message: string): undefined => {
    ruleProblem(c, rule, at, message);
    incomplete = true;
    return undefined;
  };

  const path = (): string => {
    let pointer = "";
    for (const frame of frames) if (frame.step !== null) pointer += `/${frame.step}`;
    return pointer;
  };

  const tooLarge = (): undefined => {
    if (!stopped) cannotCopy("limit", "", `The input holds more than ${c.limits.maxNodes} values.`);
    stopped = true;
    return undefined;
  };

  const cleanText = (value: string): string => {
    if (!hasNulOrLoneSurrogate(value)) return value;
    if (c.repairing) {
      c.repairs.add("string_cleaned", path(), "Removed U+0000 or replaced a lone surrogate in a string.");
      return cleanString(value);
    }
    ruleProblem(c, "R9", path(), "The string contains U+0000 or a lone surrogate.");
    return value;
  };

  // Start the copy of an array or object; its children are copied by the loop below.
  const open = (value: object): JsonValue | undefined => {
    if (frames.length + 1 > c.limits.maxDepth) {
      return cannotCopy("limit", path(), `Nested more than ${c.limits.maxDepth} levels deep.`);
    }
    if (ancestors.has(value)) return cannotCopy("json", path(), "The value contains itself.");
    if (Array.isArray(value)) {
      const source: readonly unknown[] = value;
      // Also stops an array that claims a huge length and holds nothing.
      if (nodes + source.length > c.limits.maxNodes) return tooLarge();
      const target: JsonValue[] = [];
      ancestors.add(source);
      frames.push({ kind: "array", source, target, next: 0, step: null });
      return target;
    }
    if (!isPlainObject(value)) return cannotCopy("json", path(), "The value is not a plain JSON object.");
    const keys = Object.keys(value);
    if (nodes + keys.length > c.limits.maxNodes) return tooLarge();
    const target = newObject();
    ancestors.add(value);
    frames.push({ kind: "object", source: value, keys, target, next: 0, step: null });
    return target;
  };

  const convert = (value: unknown): JsonValue | undefined => {
    nodes += 1;
    if (nodes > c.limits.maxNodes) return tooLarge();
    switch (typeof value) {
      case "string":
        return cleanText(value);
      case "boolean":
        return value;
      case "number":
        return Number.isFinite(value) ? value : cannotCopy("json", path(), "The number is not finite.");
      case "object":
        return value === null ? null : open(value);
      default:
        return cannotCopy("json", path(), `The value is of type ${typeof value}, which JSON cannot hold.`);
    }
  };

  const root = convert(input);
  while (!stopped) {
    const frame = frames[frames.length - 1];
    if (frame === undefined) break;
    const position = frame.next;
    frame.next += 1;
    if (frame.kind === "array") {
      if (position >= frame.source.length) {
        frames.pop();
        ancestors.delete(frame.source);
        continue;
      }
      frame.step = String(position);
      // A place that could not be copied holds null, so that later places keep their index.
      frame.target.push(convert(frame.source[position]) ?? null);
      continue;
    }
    const key = frame.keys[position];
    if (key === undefined) {
      frames.pop();
      ancestors.delete(frame.source);
      continue;
    }
    frame.step = pointerStep(key, position);
    const value = frame.source[key];
    // JSON.stringify leaves out a property whose value is undefined; so does this copy.
    if (value === undefined) continue;
    if (hasNulOrLoneSurrogate(key)) {
      if (c.repairing) {
        // corrections.md 2, after point 16: a property NAME with U+0000 or a lone surrogate
        // cannot be stored (PostgreSQL jsonb); the property is dropped, with a warning.
        c.warnings.add(
          "property_dropped",
          path(),
          "Dropped a property whose name contains U+0000 or a lone surrogate.",
        );
        continue;
      }
      ruleProblem(c, "R9", path(), "The property name contains U+0000 or a lone surrogate.");
    }
    // G2: measured as written, before the cleaning below can shorten the value.
    if ((key === "provider" || key === "role") && typeof value === "string" && isOpenValueTooLong(value)) {
      c.overlong[key].add(frame.target);
    }
    const copy = convert(value);
    if (copy !== undefined) frame.target[key] = copy;
  }
  return incomplete ? undefined : root;
}

// ---------------------------------------------------------------------------------------------
// Reading one property.
// ---------------------------------------------------------------------------------------------

type Check<T> = (c: Context, value: JsonValue, path: string) => T | undefined;

/** A property the schema requires. A problem is recorded when it is missing or wrong. */
function required<T>(
  c: Context,
  object: JsonObject,
  key: string,
  path: string,
  check: Check<T>,
): T | undefined {
  const value = object[key];
  if (value === undefined) {
    schemaProblem(c, `${path}/${key}`, "required", `The required property "${key}" is missing.`);
    return undefined;
  }
  return check(c, value, `${path}/${key}`);
}

/**
 * A property the schema does not require. Missing gives the fallback. Null gives the fallback too
 * when repairing (repair 3) and is a problem otherwise. A wrong value records a problem and gives
 * the fallback, which is then never used: a document with a problem is refused.
 *
 * corrections.md 2, point 6: null is read as absent for every optional property that version 1
 * defines, generator, its fields and data_base64 included. (An unknown property with the value
 * null never comes here: it is kept as written.)
 */
function optional<T>(
  c: Context,
  object: JsonObject,
  key: string,
  path: string,
  check: Check<T>,
  fallback: T,
): T {
  const value = object[key];
  if (value === undefined) return fallback;
  if (value === null && c.repairing) {
    c.repairs.add("null_default", `${path}/${key}`, `"${key}" was null; the default was used.`);
    return fallback;
  }
  return check(c, value, `${path}/${key}`) ?? fallback;
}

const checkString: Check<string> = (c, value, path) => {
  if (typeof value === "string") return value;
  schemaProblem(c, path, "type", `Expected a string, found ${typeName(value)}.`);
  return undefined;
};

const checkNonEmptyString: Check<string> = (c, value, path) => {
  const text = checkString(c, value, path);
  if (text === undefined) return undefined;
  if (text.length > 0) return text;
  schemaProblem(c, path, "minLength", "The string must not be empty.");
  return undefined;
};

const checkBoolean: Check<boolean> = (c, value, path) => {
  if (typeof value === "boolean") return value;
  schemaProblem(c, path, "type", `Expected true or false, found ${typeName(value)}.`);
  return undefined;
};

const checkArray: Check<readonly JsonValue[]> = (c, value, path) => {
  if (isJsonArray(value)) return value;
  schemaProblem(c, path, "type", `Expected an array, found ${typeName(value)}.`);
  return undefined;
};

/** Repair 1 and definitions.uuid. */
const checkId: Check<string> = (c, value, path) => {
  const text = checkString(c, value, path);
  if (text === undefined) return undefined;
  let id = text;
  if (c.repairing && !isCanonicalUuid(id) && isUuidOfAnyCase(id)) {
    id = id.toLowerCase();
    c.repairs.add("id_lowercased", path, "Wrote the id in lower case.");
  }
  if (isCanonicalUuid(id)) return id;
  schemaProblem(c, path, "pattern", "Expected a UUID in canonical lower-case form.");
  return undefined;
};

/**
 * definitions.sha256, and repair 1 for hashes. corrections.md 2, point 5: repair 1 also lower-cases
 * sha256 values, in attachment descriptors and in attachment segments.
 */
const checkSha256: Check<string> = (c, value, path) => {
  const text = checkString(c, value, path);
  if (text === undefined) return undefined;
  let hash = text;
  if (c.repairing && !isSha256Hex(hash) && isSha256HexOfAnyCase(hash)) {
    hash = hash.toLowerCase();
    c.repairs.add("id_lowercased", path, "Wrote the hash in lower case.");
  }
  if (isSha256Hex(hash)) return hash;
  schemaProblem(c, path, "pattern", "Expected 64 lower-case hexadecimal characters.");
  return undefined;
};

/** A timestamp as text and as an instant. */
interface Stamp {
  readonly text: string;
  readonly ms: number;
}

/** definitions.timestamp and R1. When repairing, the text becomes the writer's form (6.1). */
const checkStamp: Check<Stamp> = (c, value, path) => {
  const text = checkString(c, value, path);
  if (text === undefined) return undefined;
  const reading = parseTimestamp(text);
  if (!reading.ok) {
    if (reading.reason === "pattern") {
      schemaProblem(c, path, "pattern", "Expected an RFC 3339 timestamp in UTC with a literal Z.");
    } else {
      ruleProblem(c, "R1", path, "The timestamp is not a real calendar instant.");
    }
    return undefined;
  }
  if (!c.repairing) return { text, ms: reading.ms };
  // corrections.md 2, point 8: cut, never rounded; reported once for the whole document (outcome).
  if (reading.lossy) c.cutTimestamps += 1;
  return { text: reading.canonical, ms: reading.ms };
};

/**
 * `provider` and `role` (6.2). corrections.md 2, G2: a value longer than 200 characters is refused
 * before any normalisation, by readers and writers alike; repair 2 is normalizeOpen.
 */
function openListValue(
  c: Context,
  object: JsonObject,
  key: "provider" | "role",
  path: string,
  known: readonly string[],
  fallback: string,
): string | undefined {
  const text = required(c, object, key, path, checkString);
  if (text === undefined) return undefined;
  if (c.overlong[key].has(object) || isOpenValueTooLong(text)) {
    ruleProblem(
      c,
      "limit",
      `${path}/${key}`,
      `The value is longer than ${MAX_OPEN_VALUE_CHARACTERS} characters.`,
    );
    return undefined;
  }
  if (!c.repairing) {
    if (text.length > 0) return text;
    schemaProblem(c, `${path}/${key}`, "minLength", "The string must not be empty.");
    return undefined;
  }
  const value = normalizeOpen(text, known, fallback);
  if (value !== text) c.repairs.add("value_folded", `${path}/${key}`, `Normalised the value of "${key}".`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Segments.
// ---------------------------------------------------------------------------------------------

const TYPE_KEY: ReadonlySet<string> = new Set(["type"]);
const TEXT_SEGMENT_KEYS: ReadonlySet<string> = new Set(["type", "text"]);
const ATTACHMENT_SEGMENT_KEYS: ReadonlySet<string> = new Set(["type", "sha256"]);

function checkSegment(c: Context, raw: JsonValue, path: string): InterchangeSegment | undefined {
  if (!isJsonObject(raw)) {
    schemaProblem(c, path, "type", `Expected an object, found ${typeName(raw)}.`);
    return undefined;
  }
  const type = required(c, raw, "type", path, checkNonEmptyString);
  if (type === undefined) return undefined;
  if (type === "text") {
    let text = required(c, raw, "text", path, checkString);
    if (text === undefined) return undefined;
    if (hasCarriageReturn(text)) {
      if (c.repairing) {
        text = normaliseLineEndings(text);
        c.repairs.add("line_endings", `${path}/text`, "Turned CR LF and CR into LF.");
      } else {
        ruleProblem(c, "R10", `${path}/text`, "A text segment contains a carriage return.");
      }
    }
    return assemble<TextSegment>({ type, text }, unknownProperties(raw, TEXT_SEGMENT_KEYS));
  }
  if (type === "attachment") {
    const sha256 = required(c, raw, "sha256", path, checkSha256);
    if (sha256 === undefined) return undefined;
    return assemble<AttachmentSegment>({ type, sha256 }, unknownProperties(raw, ATTACHMENT_SEGMENT_KEYS));
  }
  // An unknown type: kept whole (6.3).
  return assemble<InterchangeSegment>({ type }, unknownProperties(raw, TYPE_KEY));
}

/** Repair 7: text segments that follow each other become one, joined by an empty line. */
function mergeTextRuns(segments: readonly InterchangeSegment[]): InterchangeSegment[] {
  const out: InterchangeSegment[] = [];
  let run: TextSegment[] = [];
  const flush = (): void => {
    const first = run[0];
    if (first === undefined) return;
    if (run.length === 1) {
      out.push(first);
    } else {
      // Unknown properties of the merged segments: the first segment that has a name keeps it.
      const extras = newObject();
      for (const segment of run) {
        for (const key of Object.keys(segment)) {
          const value = segment[key];
          if (!TEXT_SEGMENT_KEYS.has(key) && value !== undefined && !Object.hasOwn(extras, key)) {
            extras[key] = value;
          }
        }
      }
      out.push(assemble<TextSegment>({ type: "text", text: run.map((s) => s.text).join("\n\n") }, extras));
    }
    run = [];
  };
  for (const segment of segments) {
    if (isTextSegment(segment)) {
      run.push(segment);
    } else {
      flush();
      out.push(segment);
    }
  }
  flush();
  return out;
}

function checkSegments(
  c: Context,
  value: JsonValue,
  path: string,
): readonly InterchangeSegment[] | undefined {
  const raw = checkArray(c, value, path);
  if (raw === undefined) return undefined;
  if (raw.length === 0) {
    schemaProblem(c, path, "minItems", "A message needs at least one segment.");
    return undefined;
  }
  const segments: InterchangeSegment[] = [];
  let complete = true;
  let adjacentText = false;
  // The segment right before this one, when it is a sound one: a segment with a problem of its
  // own must not make its two neighbours look adjacent.
  let previous: InterchangeSegment | undefined;
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const segment = item === undefined ? undefined : checkSegment(c, item, `${path}/${i}`);
    if (segment === undefined) {
      complete = false;
      previous = undefined;
      continue;
    }
    if (previous !== undefined && isTextSegment(previous) && isTextSegment(segment)) {
      adjacentText = true;
      if (!c.repairing) ruleProblem(c, "R7", `${path}/${i}`, "Two text segments follow each other.");
    }
    segments.push(segment);
    previous = segment;
  }
  if (!complete) return undefined;
  if (adjacentText && c.repairing) {
    c.repairs.add("segments_merged", path, "Merged text segments that followed each other.");
    return mergeTextRuns(segments);
  }
  return segments;
}

// ---------------------------------------------------------------------------------------------
// Messages.
// ---------------------------------------------------------------------------------------------

interface MessageDraft {
  readonly id: string;
  /** `index` as the file has it. */
  readonly index: number;
  readonly role: string;
  readonly segments: readonly InterchangeSegment[];
  readonly createdAt: string | undefined;
  readonly model: string | undefined;
  readonly extras: JsonObject;
}

/**
 * message.index. A reader only needs a number it can sort by (repair 6 renumbers); a writer needs
 * the schema's integer.
 * corrections.md 2, point 4: an index that is missing or no finite number stays a problem, and
 * then nothing in that session is renumbered (checkMessages).
 */
const checkIndex: Check<number> = (c, value, path) => {
  if (typeof value !== "number") {
    schemaProblem(c, path, "type", `Expected an integer, found ${typeName(value)}.`);
    return undefined;
  }
  if (c.repairing) return value;
  if (!Number.isInteger(value)) {
    schemaProblem(c, path, "type", "Expected an integer.");
    return undefined;
  }
  if (value < 0) {
    schemaProblem(c, path, "minimum", "The index must not be negative.");
    return undefined;
  }
  return value;
};

function checkMessage(c: Context, raw: JsonValue, path: string): MessageDraft | undefined {
  if (!isJsonObject(raw)) {
    schemaProblem(c, path, "type", `Expected an object, found ${typeName(raw)}.`);
    return undefined;
  }
  const before = c.problems.total;
  const id = required(c, raw, "id", path, checkId);
  if (id !== undefined) {
    // R2: unique among all messages of the document.
    if (c.messageIds.has(id)) ruleProblem(c, "R2", `${path}/id`, "Another message has the same id.");
    c.messageIds.add(id);
  }
  const index = required(c, raw, "index", path, checkIndex);
  const role = openListValue(c, raw, "role", path, KNOWN_ROLES, FALLBACK_ROLE);
  const segments = required(c, raw, "segments", path, checkSegments);
  const createdAt = optional<Stamp | undefined>(c, raw, "created_at", path, checkStamp, undefined);
  let model = optional<string | undefined>(c, raw, "model", path, checkString, undefined);
  // corrections.md 2, point 13: "" or null on a message is read as absent; the canonical form
  // leaves it out, and so does the writer (6.8).
  if (model === "" && c.repairing) model = undefined;
  if (c.problems.total !== before) return undefined;
  if (id === undefined || index === undefined || role === undefined || segments === undefined)
    return undefined;
  return {
    id,
    index,
    role,
    segments,
    createdAt: createdAt?.text,
    model,
    extras: unknownProperties(raw, MESSAGE_KEY_SET),
  };
}

function buildMessage(draft: MessageDraft, index: number): InterchangeMessage {
  return assemble<InterchangeMessage>(
    {
      id: draft.id,
      index,
      role: draft.role,
      segments: draft.segments,
      ...(draft.createdAt === undefined ? {} : { created_at: draft.createdAt }),
      ...(draft.model === undefined ? {} : { model: draft.model }),
    },
    draft.extras,
  );
}

/** The `index` of a message as the copy holds it, when it is a number. The copy holds finite numbers only. */
function writtenIndex(item: JsonValue | undefined): number | undefined {
  if (!isJsonObject(item)) return undefined;
  const index = item.index;
  return typeof index === "number" ? index : undefined;
}

/**
 * R6 and repair 6: `messages[i].index === i`.
 * corrections.md 2, point 4: the repair sorts and renumbers only when every message of the session
 * has a finite number as index (ties by array position; a fraction or a negative number sorts and
 * is mended). Otherwise nothing in that session is renumbered and validation refuses the document.
 */
function checkMessages(
  c: Context,
  raw: readonly JsonValue[],
  path: string,
): readonly InterchangeMessage[] | undefined {
  const drafts: MessageDraft[] = [];
  let complete = true;
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const draft = item === undefined ? undefined : checkMessage(c, item, `${path}/${i}`);
    if (draft === undefined) complete = false;
    else drafts.push(draft);
  }
  if (c.repairing && !raw.every((item) => writtenIndex(item) !== undefined)) {
    // Not every index is a finite number (each such place is a problem already): no message of
    // this session is renumbered, so R6 holds or fails for the others as they are written.
    raw.forEach((item, i) => {
      const index = writtenIndex(item);
      if (index !== undefined && index !== i) {
        ruleProblem(c, "R6", `${path}/${i}/index`, "The index is not the position in the array.");
      }
    });
    return undefined;
  }
  if (!complete) return undefined;
  const inOrder = drafts.every((draft, i) => draft.index === i);
  if (!inOrder) {
    if (!c.repairing) {
      drafts.forEach((draft, i) => {
        if (draft.index !== i) {
          ruleProblem(c, "R6", `${path}/${i}/index`, "The index is not the position in the array.");
        }
      });
      return undefined;
    }
    // Array.prototype.sort is stable: equal indexes keep their array order.
    drafts.sort((a, b) => a.index - b.index);
    c.repairs.add("messages_renumbered", path, "Sorted the messages by index and renumbered them.");
  }
  return drafts.map(buildMessage);
}

// ---------------------------------------------------------------------------------------------
// Attachments.
// ---------------------------------------------------------------------------------------------

const checkMediaType: Check<string> = (c, value, path) => {
  const text = checkString(c, value, path);
  if (text === undefined) return undefined;
  if (hasMediaTypeShape(text)) return text;
  schemaProblem(c, path, "pattern", "Expected a lower-case media type without parameters.");
  return undefined;
};

const checkByteLength: Check<number> = (c, value, path) => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    schemaProblem(c, path, "type", `Expected an integer, found ${typeName(value)}.`);
    return undefined;
  }
  if (value < 0) {
    schemaProblem(c, path, "minimum", "The length must not be negative.");
    return undefined;
  }
  return value;
};

const checkFilename: Check<string> = (c, value, path) => {
  const text = checkString(c, value, path);
  if (text === undefined) return undefined;
  if (hasFilenameShape(text)) return text;
  schemaProblem(c, path, "pattern", "A file name must not contain a slash or a backslash.");
  return undefined;
};

/** Why inline bytes do not belong to their descriptor, or the bytes when they do (R5). */
function inlineBytes(text: string, byteLength: number, sha256: string): Uint8Array | string {
  let bytes: Uint8Array | null;
  try {
    bytes = decodeBase64(text);
  } catch {
    // The platform could not hold the decoded bytes.
    bytes = null;
  }
  if (bytes === null) return "is not base64";
  if (bytes.length !== byteLength) return "has another length than byte_length";
  if (sha256Hex(bytes) !== sha256) return "has another SHA-256 than sha256";
  return bytes;
}

function checkAttachment(
  c: Context,
  raw: JsonValue,
  path: string,
  sessionImportedAt: Stamp | undefined,
): InterchangeAttachment | undefined {
  if (!isJsonObject(raw)) {
    schemaProblem(c, path, "type", `Expected an object, found ${typeName(raw)}.`);
    return undefined;
  }
  const before = c.problems.total;
  const kind = required(c, raw, "kind", path, checkNonEmptyString);
  const sha256 = required(c, raw, "sha256", path, checkSha256);
  const mediaType = required(c, raw, "media_type", path, checkMediaType);
  const byteLength = required(c, raw, "byte_length", path, checkByteLength);
  const filename = optional(c, raw, "filename", path, checkFilename, "");
  // Repair 3: without its own date an attachment takes the session's imported_at.
  const createdAt = optional<Stamp | undefined>(c, raw, "created_at", path, checkStamp, sessionImportedAt);

  // Repair 9 as corrections.md 2, point 7 words it: data_base64 that is not a string, cannot be
  // decoded, or does not match byte_length or sha256 is removed with a warning; the descriptor
  // stays. (A null is read as absent, point 6.) A writer's data must be right: schema and R5.
  let data: string | undefined;
  const rawData = raw.data_base64;
  if (rawData === null && c.repairing) {
    c.repairs.add("null_default", `${path}/data_base64`, '"data_base64" was null; the bytes are missing.');
  } else if (rawData !== undefined && typeof rawData !== "string" && c.repairing) {
    c.warnings.add(
      "bytes_discarded",
      `${path}/data_base64`,
      "Discarded the inline bytes: the data is not a string.",
    );
  } else if (rawData !== undefined) {
    data = checkString(c, rawData, `${path}/data_base64`);
    if (data !== undefined && !c.repairing && !hasBase64Shape(data)) {
      schemaProblem(c, `${path}/data_base64`, "pattern", "Expected standard base64.");
      data = undefined;
    }
    if (data !== undefined && byteLength !== undefined && sha256 !== undefined) {
      const bytes = inlineBytes(data, byteLength, sha256);
      if (typeof bytes !== "string") {
        if (c.repairing) c.inlineBytes.set(sha256, bytes);
      } else if (c.repairing) {
        c.warnings.add(
          "bytes_discarded",
          `${path}/data_base64`,
          `Discarded the inline bytes: the data ${bytes}.`,
        );
        data = undefined;
      } else {
        ruleProblem(c, "R5", `${path}/data_base64`, `The data ${bytes}.`);
      }
    }
  }

  if (c.problems.total !== before) return undefined;
  if (kind === undefined || sha256 === undefined || mediaType === undefined || byteLength === undefined) {
    return undefined;
  }
  if (createdAt === undefined) return undefined;
  return assemble<InterchangeAttachment>(
    {
      kind,
      sha256,
      media_type: mediaType,
      byte_length: byteLength,
      filename,
      created_at: createdAt.text,
      ...(data === undefined ? {} : { data_base64: data }),
    },
    unknownProperties(raw, ATTACHMENT_KEY_SET),
  );
}

/** R5 within one session: (kind, sha256) unique, at most one "original_pdf". */
function checkAttachments(
  c: Context,
  raw: readonly JsonValue[],
  path: string,
  sessionImportedAt: Stamp | undefined,
): readonly InterchangeAttachment[] | undefined {
  const attachments: InterchangeAttachment[] = [];
  const kindsByHash = new Map<string, Set<string>>();
  let originals = 0;
  let complete = true;
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const attachment =
      item === undefined ? undefined : checkAttachment(c, item, `${path}/${i}`, sessionImportedAt);
    if (attachment === undefined) {
      complete = false;
      continue;
    }
    const kinds = kindsByHash.get(attachment.sha256) ?? new Set<string>();
    if (kinds.has(attachment.kind)) {
      ruleProblem(c, "R5", `${path}/${i}`, "Another attachment of the session has the same kind and sha256.");
    }
    kinds.add(attachment.kind);
    kindsByHash.set(attachment.sha256, kinds);
    if (attachment.kind === "original_pdf") {
      originals += 1;
      if (originals === 2) ruleProblem(c, "R5", `${path}/${i}`, 'A session has at most one "original_pdf".');
    }
    attachments.push(attachment);
  }
  return complete ? attachments : undefined;
}

// ---------------------------------------------------------------------------------------------
// Sessions and projects.
// ---------------------------------------------------------------------------------------------

/** session.tags: the schema's shape, R4, and repair 4. */
const checkTags: Check<readonly string[]> = (c, value, path) => {
  const raw = checkArray(c, value, path);
  if (raw === undefined) return undefined;
  const tags: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const tag = item === undefined ? undefined : checkString(c, item, `${path}/${i}`);
    if (tag !== undefined) tags.push(tag);
  }
  if (tags.length !== raw.length) return undefined;
  if (c.repairing) {
    const normalised = normaliseTags(tags);
    const changed = normalised.length !== tags.length || normalised.some((tag, i) => tag !== tags[i]);
    if (changed) c.repairs.add("tags_normalised", path, "Normalised the tags.");
    return normalised;
  }
  const seen = new Set<string>();
  let valid = true;
  tags.forEach((tag, i) => {
    if (tag.length === 0) {
      schemaProblem(c, `${path}/${i}`, "minLength", "A tag must not be empty.");
      valid = false;
    } else if (!hasTagShape(tag)) {
      schemaProblem(c, `${path}/${i}`, "pattern", "A tag must not contain a comma.");
      valid = false;
    }
    if (seen.has(tag)) {
      schemaProblem(c, `${path}/${i}`, "uniqueItems", "The tag is listed twice.");
      valid = false;
    }
    seen.add(tag);
    if (tag !== tag.trim() || tag !== tag.toLowerCase()) {
      ruleProblem(c, "R4", `${path}/${i}`, "A tag must be trimmed and lower-case.");
      valid = false;
    }
  });
  return valid ? tags : undefined;
};

/** session.project_id: null or a UUID. */
const checkProjectId: Check<string | null> = (c, value, path) =>
  value === null ? null : checkId(c, value, path);

/** `seen` is told the id as soon as it is known to be one, whatever else is wrong with the session. */
function checkSession(
  c: Context,
  raw: JsonValue,
  path: string,
  seen: (id: string) => void,
): InterchangeSession | undefined {
  if (!isJsonObject(raw)) {
    schemaProblem(c, path, "type", `Expected an object, found ${typeName(raw)}.`);
    return undefined;
  }
  const before = c.problems.total;
  const id = required(c, raw, "id", path, checkId);
  if (id !== undefined) seen(id);
  const title = required(c, raw, "title", path, checkString);
  const provider = openListValue(c, raw, "provider", path, KNOWN_PROVIDERS, FALLBACK_PROVIDER);
  const model = optional(c, raw, "model", path, checkString, "");
  const sourceUrl = optional(c, raw, "source_url", path, checkString, "");
  const summary = optional(c, raw, "summary", path, checkString, "");
  const tags = optional<readonly string[]>(c, raw, "tags", path, checkTags, []);
  const isPinned = optional(c, raw, "is_pinned", path, checkBoolean, false);
  const createdAt = required(c, raw, "created_at", path, checkStamp);
  const importedAt = required(c, raw, "imported_at", path, checkStamp);
  // Repair 3: without its own value updated_at is imported_at.
  const updatedAt = optional<Stamp | undefined>(c, raw, "updated_at", path, checkStamp, importedAt);
  if (updatedAt !== undefined && importedAt !== undefined && updatedAt.ms < importedAt.ms) {
    c.warnings.add("R12", `${path}/updated_at`, "updated_at is earlier than imported_at.");
  }

  // project_id: absent is null. A null needs no repair notice, it is the value itself.
  const rawProjectId = raw.project_id;
  let projectId = rawProjectId === undefined ? null : checkProjectId(c, rawProjectId, `${path}/project_id`);
  if (typeof projectId === "string" && c.projectIds !== null && !c.projectIds.has(projectId)) {
    if (!c.repairing) {
      ruleProblem(c, "R3", `${path}/project_id`, "The file lists no project with this id.");
    } else if (c.destinationProjectIds === null || !c.destinationProjectIds.has(projectId)) {
      // Repair 8: resolves neither in the document nor in the destination vault.
      // corrections.md 2, point 2: repair 8 stands. R3 is the writer's rule; a reader checks it
      // after repair 8 and counts the projects of the destination vault as present.
      c.warnings.add(
        "project_missing",
        `${path}/project_id`,
        "The project of this session is not in the file; the session has no project now.",
      );
      projectId = null;
    }
  }

  const rawAttachments = optional<readonly JsonValue[]>(c, raw, "attachments", path, checkArray, []);
  const attachments = checkAttachments(c, rawAttachments, `${path}/attachments`, importedAt);
  const rawMessages = required(c, raw, "messages", path, checkArray);
  const messages = rawMessages === undefined ? undefined : checkMessages(c, rawMessages, `${path}/messages`);

  // R7: an attachment segment names an attachment of the same session.
  if (attachments !== undefined && messages !== undefined) {
    const listed = new Set(attachments.map((attachment) => attachment.sha256));
    messages.forEach((message, m) => {
      message.segments.forEach((segment, s) => {
        if (
          segment.type === "attachment" &&
          typeof segment.sha256 === "string" &&
          !listed.has(segment.sha256)
        ) {
          ruleProblem(
            c,
            "R7",
            `${path}/messages/${m}/segments/${s}/sha256`,
            "The session lists no attachment with this sha256.",
          );
        }
      });
    });
  }

  if (c.problems.total !== before) return undefined;
  if (id === undefined || title === undefined || provider === undefined) return undefined;
  if (createdAt === undefined || importedAt === undefined || updatedAt === undefined) return undefined;
  if (projectId === undefined || attachments === undefined || messages === undefined) return undefined;
  return assemble<InterchangeSession>(
    {
      id,
      title,
      provider,
      model,
      source_url: sourceUrl,
      summary,
      tags,
      is_pinned: isPinned,
      created_at: createdAt.text,
      imported_at: importedAt.text,
      updated_at: updatedAt.text,
      project_id: projectId,
      attachments,
      messages,
    },
    unknownProperties(raw, SESSION_KEY_SET),
  );
}

const checkProjectName: Check<string> = (c, value, path) => {
  const text = checkString(c, value, path);
  if (text === undefined) return undefined;
  if (text.length === 0) {
    schemaProblem(c, path, "minLength", "A project name must not be empty.");
    return undefined;
  }
  if (!hasVisibleCharacter(text)) {
    schemaProblem(c, path, "pattern", "A project name must not be white space only.");
    return undefined;
  }
  return text;
};

/** `seen` is told the id as soon as it is known to be one, whatever else is wrong with the project. */
function checkProject(
  c: Context,
  raw: JsonValue,
  path: string,
  seen: (id: string) => void,
): InterchangeProject | undefined {
  if (!isJsonObject(raw)) {
    schemaProblem(c, path, "type", `Expected an object, found ${typeName(raw)}.`);
    return undefined;
  }
  const before = c.problems.total;
  const id = required(c, raw, "id", path, checkId);
  if (id !== undefined) seen(id);
  const name = required(c, raw, "name", path, checkProjectName);
  const createdAt = required(c, raw, "created_at", path, checkStamp);
  // Repair 3: without its own value updated_at is created_at.
  const updatedAt = optional<Stamp | undefined>(c, raw, "updated_at", path, checkStamp, createdAt);
  if (c.problems.total !== before) return undefined;
  if (id === undefined || name === undefined || createdAt === undefined || updatedAt === undefined) {
    return undefined;
  }
  return assemble<InterchangeProject>(
    { id, name, created_at: createdAt.text, updated_at: updatedAt.text },
    unknownProperties(raw, PROJECT_KEY_SET),
  );
}

// ---------------------------------------------------------------------------------------------
// The document.
// ---------------------------------------------------------------------------------------------

const checkGenerator: Check<InterchangeGenerator> = (c, raw, path) => {
  if (!isJsonObject(raw)) {
    schemaProblem(c, path, "type", `Expected an object, found ${typeName(raw)}.`);
    return undefined;
  }
  const before = c.problems.total;
  const app = required(c, raw, "app", path, checkNonEmptyString);
  const appVersion = optional<string | undefined>(c, raw, "app_version", path, checkString, undefined);
  const platform = optional<string | undefined>(c, raw, "platform", path, checkString, undefined);
  if (c.problems.total !== before || app === undefined) return undefined;
  return assemble<InterchangeGenerator>(
    {
      app,
      ...(appVersion === undefined ? {} : { app_version: appVersion }),
      ...(platform === undefined ? {} : { platform }),
    },
    unknownProperties(raw, GENERATOR_KEY_SET),
  );
};

const checkKind: Check<DocumentKind> = (c, value, path) => {
  if (value === "vault" || value === "session") return value;
  schemaProblem(c, path, "enum", 'Expected "vault" or "session".');
  return undefined;
};

function checkDocumentValue(c: Context, raw: JsonValue): InterchangeDocument | undefined {
  if (!isJsonObject(raw)) {
    schemaProblem(c, "", "type", `Expected a JSON object, found ${typeName(raw)}.`);
    return undefined;
  }
  // 6.1: the marker first, then the version. Either one wrong ends the reading at once.
  if (raw.format !== FORMAT_MARKER) {
    ruleProblem(c, "format", "/format", "This is not a SessionVault interchange file.");
    return undefined;
  }
  const version = raw.version;
  if (version !== FORMAT_VERSION) {
    const newer = typeof version === "number" && version > FORMAT_VERSION;
    const message = newer
      ? "The file was written in a newer version of the format; this app reads version 1. Nothing was imported."
      : "The format version must be 1.";
    ruleProblem(c, "version", "/version", message);
    return undefined;
  }

  const before = c.problems.total;
  const kind = required(c, raw, "kind", "", checkKind);
  const exportedAt = required(c, raw, "exported_at", "", checkStamp);
  const generator = optional<InterchangeGenerator | undefined>(
    c,
    raw,
    "generator",
    "",
    checkGenerator,
    undefined,
  );
  const rawProjects = required(c, raw, "projects", "", checkArray);
  const rawSessions = required(c, raw, "sessions", "", checkArray);

  if (kind === "session") {
    if (rawSessions !== undefined && rawSessions.length !== 1) {
      const keyword = rawSessions.length === 0 ? "minItems" : "maxItems";
      schemaProblem(c, "/sessions", keyword, 'A file of kind "session" holds exactly one session.');
    }
    if (rawProjects !== undefined && rawProjects.length > 1) {
      schemaProblem(c, "/projects", "maxItems", 'A file of kind "session" holds at most one project.');
    }
  }

  const projects: InterchangeProject[] = [];
  const projectIds = new Set<string>();
  const projectKeys = new Set<string>();
  (rawProjects ?? []).forEach((item, i) => {
    const project = checkProject(c, item, `/projects/${i}`, (id) => {
      // R2: unique among projects.
      if (projectIds.has(id)) ruleProblem(c, "R2", `/projects/${i}/id`, "Another project has the same id.");
      projectIds.add(id);
    });
    if (project === undefined) return;
    // R11, a warning: names should differ when trimmed and compared without case.
    const key = projectNameKey(project.name);
    if (projectKeys.has(key)) {
      c.warnings.add(
        "R11",
        `/projects/${i}/name`,
        "Another project has the same name, ignoring case and outer white space.",
      );
    }
    projectKeys.add(key);
    projects.push(project);
  });

  c.projectIds = projectIds;
  const sessions: InterchangeSession[] = [];
  const sessionIds = new Set<string>();
  (rawSessions ?? []).forEach((item, i) => {
    const session = checkSession(c, item, `/sessions/${i}`, (id) => {
      // R2: unique among sessions.
      if (sessionIds.has(id)) ruleProblem(c, "R2", `/sessions/${i}/id`, "Another session has the same id.");
      sessionIds.add(id);
    });
    if (session !== undefined) sessions.push(session);
  });

  // R8: a "session" document lists no project other than the session's own.
  const onlySession = sessions[0];
  const onlyProject = projects[0];
  if (kind === "session" && onlySession !== undefined && onlyProject !== undefined) {
    if (onlySession.project_id !== onlyProject.id) {
      ruleProblem(c, "R8", "/projects/0", "The listed project is not the project of the session.");
    }
  }

  if (c.problems.total !== before) return undefined;
  if (kind === undefined || exportedAt === undefined) return undefined;
  return assemble<InterchangeDocument>(
    {
      format: FORMAT_MARKER,
      version: FORMAT_VERSION,
      kind,
      exported_at: exportedAt.text,
      ...(generator === undefined ? {} : { generator }),
      projects,
      sessions,
    },
    unknownProperties(raw, DOCUMENT_KEY_SET),
  );
}

/**
 * What was repaired. corrections.md 2, point 8: timestamps cut to milliseconds give one repair
 * line for the whole document, with the count. It stands first, so that the cap on listed
 * notices never hides it.
 */
function repairsOf(c: Context): NoticeList {
  const list = c.repairs.list();
  if (c.cutTimestamps === 0) return list;
  const line: Notice = {
    code: "timestamp_precision",
    path: "",
    message:
      c.cutTimestamps === 1
        ? "Cut 1 timestamp to milliseconds."
        : `Cut ${c.cutTimestamps} timestamps to milliseconds.`,
    count: c.cutTimestamps,
  };
  return {
    items: [line, ...list.items].slice(0, c.limits.maxListed),
    total: list.total + 1,
    counts: { ...list.counts, timestamp_precision: 1 },
  };
}

function outcome(c: Context, doc: InterchangeDocument | undefined): CheckOutcome {
  return {
    doc: c.problems.total === 0 && doc !== undefined ? doc : null,
    problems: c.problems.list(),
    repairs: repairsOf(c),
    warnings: c.warnings.list(),
    inlineBytes: c.inlineBytes,
  };
}

/** Check a parsed value as a whole document. Never throws on a value made of plain data. */
export function checkDocument(input: unknown, options: CheckOptions): CheckOutcome {
  const c = createContext(options);
  const copy = cleanCopy(input, c);
  const doc = copy === undefined ? undefined : checkDocumentValue(c, copy);
  if (doc === undefined && c.problems.total === 0) {
    // Nothing was built and nothing was said: refuse rather than accept silently.
    ruleProblem(c, "internal", "", "The input could not be checked.");
  }
  return outcome(c, doc);
}

/** What checking one session or one project on its own gave. Paths start at that object. */
export interface PartOutcome<T> {
  /** The part in the form the reader gives it, or null when there are problems. */
  readonly value: T | null;
  readonly problems: CappedList<Problem>;
  readonly repairs: NoticeList;
  readonly warnings: NoticeList;
}

function partOutcome<T>(c: Context, value: T | undefined): PartOutcome<T> {
  if (value === undefined && c.problems.total === 0) {
    ruleProblem(c, "internal", "", "The input could not be checked.");
  }
  return {
    value: c.problems.total === 0 && value !== undefined ? value : null,
    problems: c.problems.list(),
    repairs: repairsOf(c),
    warnings: c.warnings.list(),
  };
}

/**
 * Check one session on its own, in "repair" mode: the form the reader would give it.
 * `projectIds` are the projects the session may belong to (repair 8); left out, every project id
 * counts as resolving.
 */
export function checkSessionAlone(
  input: unknown,
  limits: Limits,
  projectIds?: ReadonlySet<string>,
): PartOutcome<InterchangeSession> {
  const c = createContext({ mode: "repair", limits, destinationProjectIds: projectIds });
  // A session on its own comes with no project list: only `projectIds` can resolve its project.
  if (projectIds !== undefined) c.projectIds = new Set();
  const copy = cleanCopy(input, c);
  return partOutcome(c, copy === undefined ? undefined : checkSession(c, copy, "", () => {}));
}

/** Check one project on its own, in "repair" mode: the form the reader would give it. */
export function checkProjectAlone(input: unknown, limits: Limits): PartOutcome<InterchangeProject> {
  const c = createContext({ mode: "repair", limits });
  const copy = cleanCopy(input, c);
  return partOutcome(c, copy === undefined ? undefined : checkProject(c, copy, "", () => {}));
}

/** The form the reader would give one session, or null when the value is not an acceptable session. */
export function canonicalSession(input: unknown, limits: Limits): InterchangeSession | null {
  return checkSessionAlone(input, limits).value;
}

/** The form the reader would give one project, or null when the value is not an acceptable project. */
export function canonicalProject(input: unknown, limits: Limits): InterchangeProject | null {
  return checkProjectAlone(input, limits).value;
}
