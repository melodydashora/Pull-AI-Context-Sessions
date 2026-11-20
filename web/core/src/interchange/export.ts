// The export algorithm of data-model.md 6.8: a vault, or one session of it, to a document.
//
// The output is deterministic: the same vault, time, generator and options give the same document.
// Messages are written by position and properties in the order of the schema with the unknown ones
// after them, as 6.8 prescribes. corrections.md 2, point 12: writers emit projects and sessions in
// id order; the order of properties carries no meaning; attachments keep the order of the imported
// array (their order is not decided yet).

import { encodeBase64 } from "./base64.ts";
import { assemble, EMPTY_OBJECT, type JsonObject } from "./json.ts";
import {
  type CappedList,
  createNoticeLog,
  type Limits,
  type NoticeList,
  type NoticeLog,
  type Problem,
  resolveLimits,
} from "./problems.ts";
import { sha256Hex } from "./sha256.ts";
import { dateToTimestamp } from "./timestamp.ts";
import {
  FORMAT_MARKER,
  FORMAT_VERSION,
  type InterchangeDocument,
  type InterchangeGenerator,
} from "./types.ts";
import { checkDocument } from "./validate.ts";
import type { Vault, VaultAttachment, VaultProject, VaultSession } from "./vault.ts";
import { projectValue, sessionValue } from "./wire.ts";

/** What to export: the whole vault (kind "vault") or one session with its project (kind "session"). */
export type DocumentExportScope =
  | { readonly kind: "vault" }
  | { readonly kind: "session"; readonly id: string };

export interface DocumentExportContext {
  /** The current time; it becomes `exported_at`. */
  readonly now: Date;
  /** Which program writes the document, see webGenerator. */
  readonly generator: InterchangeGenerator;
}

export interface DocumentExportOptions {
  /**
   * true: write `data_base64` for every attachment whose bytes the vault holds.
   * false: descriptors only ("export without originals", 6.4).
   */
  readonly includeBytes: boolean;
  /** Bounds for the check of the result. Defaults: DEFAULT_LIMITS. */
  readonly limits?: Partial<Limits>;
}

export type DocumentExportResult =
  | {
      readonly ok: true;
      /** Passes the schema and R1 to R10 without repair. */
      readonly doc: InterchangeDocument;
      /** Bytes that could not travel, values the export had to repair, R11 and R12. */
      readonly warnings: NoticeList;
    }
  | {
      readonly ok: false;
      /** Why no valid document can be written from this vault. */
      readonly problems: CappedList<Problem>;
    };

/** The generator entry of this app: `{ app: "sessionvault-web", app_version, platform: "web" }`. */
export function webGenerator(appVersion: string): InterchangeGenerator {
  return assemble<InterchangeGenerator>(
    { app: "sessionvault-web", app_version: appVersion, platform: "web" },
    EMPTY_OBJECT,
  );
}

/**
 * Largest attachment written inline. Beyond it the base64 text of one session comes close to the
 * longest string some engines can hold; such bytes need the ZIP bundle of 6.4.
 */
export const MAX_INLINE_BYTES = 256 * 1024 * 1024;

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function refused(message: string): DocumentExportResult {
  return { ok: false, problems: { items: [{ rule: "vault", path: "", message }], total: 1 } };
}

/** Base64 text of an attachment's bytes, or undefined (with a warning) when they cannot travel inline. */
function inlineData(
  vault: Vault,
  attachment: VaultAttachment,
  path: string,
  encoded: Map<string, string | null>,
  warnings: NoticeLog,
): string | undefined {
  const bytes = vault.blobs.get(attachment.sha256);
  // 6.4: no bytes is the "omitted" way; the descriptor is exported alone.
  if (bytes === undefined) return undefined;
  if (bytes.length !== attachment.byte_length) {
    warnings.add("bytes_omitted", path, "The stored bytes have another length than the descriptor says.");
    return undefined;
  }
  let text = encoded.get(attachment.sha256);
  if (text === undefined) {
    if (bytes.length > MAX_INLINE_BYTES) text = null;
    else if (sha256Hex(bytes) !== attachment.sha256) text = null;
    else {
      try {
        text = encodeBase64(bytes);
      } catch {
        // The platform could not hold the text.
        text = null;
      }
    }
    encoded.set(attachment.sha256, text);
  }
  if (text === null) {
    const why =
      bytes.length > MAX_INLINE_BYTES
        ? "are too large to travel inline"
        : "do not have the SHA-256 of the descriptor";
    warnings.add("bytes_omitted", path, `The stored bytes ${why}.`);
    return undefined;
  }
  return text;
}

function exportUnchecked(
  vault: Vault,
  scope: DocumentExportScope,
  context: DocumentExportContext,
  options: DocumentExportOptions,
): DocumentExportResult {
  const limits = resolveLimits(options.limits);
  const warnings = createNoticeLog(limits.maxListed);

  let projects: readonly VaultProject[];
  let sessions: readonly VaultSession[];
  if (scope.kind === "vault") {
    projects = [...vault.projects].sort(byId);
    sessions = [...vault.sessions].sort(byId);
  } else {
    const wanted = scope.id.toLowerCase();
    const session = vault.sessions.find((candidate) => candidate.id === wanted);
    if (session === undefined) return refused("The vault has no session with this id.");
    // 6.8: its project, if any.
    const project = vault.projects.find((candidate) => candidate.id === session.project_id);
    projects = project === undefined ? [] : [project];
    sessions = [session];
  }

  const exportedAt = dateToTimestamp(context.now);
  if (exportedAt === null) return refused("The export time is not a date the format can hold.");

  const encoded = new Map<string, string | null>();
  const value: JsonObject = assemble<JsonObject>(
    {
      format: FORMAT_MARKER,
      version: FORMAT_VERSION,
      kind: scope.kind,
      exported_at: exportedAt,
      generator: context.generator,
      projects: projects.map(projectValue),
      sessions: sessions.map((session, s) =>
        sessionValue(session, (attachment, a) =>
          options.includeBytes
            ? inlineData(vault, attachment, `/sessions/${s}/attachments/${a}`, encoded, warnings)
            : undefined,
        ),
      ),
    },
    EMPTY_OBJECT,
  );

  // 6.8: the output must pass the schema and R1 to R10 without repair.
  const strict = checkDocument(value, { mode: "strict", limits });
  if (strict.doc !== null) {
    warnings.addAll(strict.warnings);
    return { ok: true, doc: strict.doc, warnings: warnings.list() };
  }
  // The vault holds something a document may not. Write what a reader would make of it, and say so.
  const repaired = checkDocument(value, { mode: "repair", limits });
  if (repaired.doc === null) return { ok: false, problems: repaired.problems };
  warnings.add(
    "vault_repaired",
    "",
    `The vault held ${strict.problems.total} value(s) the format does not allow; the export wrote them repaired.`,
  );
  warnings.addAll(repaired.repairs);
  warnings.addAll(repaired.warnings);
  return { ok: true, doc: repaired.doc, warnings: warnings.list() };
}

/**
 * Export a vault or one of its sessions (data-model.md 6.8). Never changes the vault. A vault that
 * cannot be written as a valid document gives problems instead of a document.
 */
export function exportDocument(
  vault: Vault,
  scope: DocumentExportScope,
  context: DocumentExportContext,
  options: DocumentExportOptions,
): DocumentExportResult {
  try {
    return exportUnchecked(vault, scope, context, options);
  } catch {
    return {
      ok: false,
      problems: {
        items: [{ rule: "internal", path: "", message: "The vault could not be exported." }],
        total: 1,
      },
    };
  }
}

/**
 * The JSON text of a document in pieces: first everything up to the opening of `sessions`, then
 * one piece per session, then the closing. A large vault can be written out piece by piece without
 * ever holding its whole text (6.8). Joined, the pieces are one JSON document.
 */
export function* documentTextChunks(doc: InterchangeDocument): Generator<string, void, undefined> {
  const head: string[] = [];
  for (const key of Object.keys(doc)) {
    const value = doc[key];
    if (key === "sessions" || value === undefined) continue;
    head.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  }
  head.push('"sessions":[');
  yield `{${head.join(",")}`;
  let first = true;
  for (const session of doc.sessions) {
    yield first ? JSON.stringify(session) : `,${JSON.stringify(session)}`;
    first = false;
  }
  yield "]}";
}

/** The JSON text of a document, or null when it is longer than a string of this platform can be. */
export function documentText(doc: InterchangeDocument): string | null {
  try {
    return [...documentTextChunks(doc)].join("");
  } catch {
    return null;
  }
}
