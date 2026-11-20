// The import algorithm of data-model.md 6.7: merge a document into a vault.
//
// A pure function: the vault that goes in is not changed, a new one comes out. Import never
// deletes: a project or session the document does not mention is left alone.
//
// corrections.md section 2 settles the open points of 6.7: projects with the same id (point 9),
// message ids (point 10) and "same content" (point 11). One vault is one user: with the keys of
// 7.2, (owner_id, id), an id that another user holds never collides, so nothing here knows of
// other users (point 10).

import { type JsonValue, jsonEqual, newObject, unknownProperties } from "./json.ts";
import { toVaultProject, toVaultSession } from "./normalise.ts";
import {
  type CappedList,
  createNoticeLog,
  type Limits,
  type NoticeList,
  type Problem,
  resolveLimits,
} from "./problems.ts";
import { readDocument } from "./reader.ts";
import { sha256Hex } from "./sha256.ts";
import { isCanonicalUuid } from "./shapes.ts";
import { projectNameKey } from "./shared.ts";
import { cleanString } from "./text.ts";
import { parseTimestamp } from "./timestamp.ts";
import type { DocumentKind, InterchangeGenerator, InterchangeProject, InterchangeSession } from "./types.ts";
import { canonicalProject, canonicalSession } from "./validate.ts";
import type { Vault, VaultProject, VaultSession } from "./vault.ts";
import { projectValue, sessionValue } from "./wire.ts";

/**
 * What to do with a conflict: an incoming session with the id of a stored one, different content
 * and the same `updated_at`, so that neither copy is the newer one (6.7).
 * - "keep" (the default): the stored session stays.
 * - "replace": the incoming session replaces it.
 * - `{ copyWithTitleSuffix }`: the stored session stays and the incoming one is added beside it
 *   under new ids, its title followed by the given suffix.
 */
export type ConflictPolicy = "keep" | "replace" | { readonly copyWithTitleSuffix: string };

export interface DocumentImportContext {
  /**
   * The current time. It only dates the report: the merge keeps the timestamps of the file and
   * never puts the current time in their place (6.7 step 3).
   */
  readonly now: Date;
  /**
   * Gives a new random UUID, for example crypto.randomUUID. Called only when an incoming id cannot
   * be used: a message of another session of this vault holds it, or a copy is made.
   */
  readonly newId: () => string;
}

export interface DocumentImportOptions {
  /** Default "keep". */
  readonly onConflict?: ConflictPolicy;
  /**
   * Bytes that came beside the document, by SHA-256: the `blobs/<sha256>` entries of a ZIP bundle
   * (6.4). They are checked against their hash before they are stored. Do not change them afterwards.
   */
  readonly bundleBlobs?: ReadonlyMap<string, Uint8Array>;
  /** Bounds on depth, size and the length of the reported lists. Defaults: DEFAULT_LIMITS. */
  readonly limits?: Partial<Limits>;
}

/**
 * What happened to a project of the document (6.7 step 2, corrections.md 2, point 9).
 * - "added": inserted. "merged": a stored project has the same name (compared by projectNameKey);
 *   that one is used. "updated": same id, the incoming copy was newer and replaced the whole
 *   project. "unchanged": same id and content. "kept": same id, different content, and the
 *   incoming copy was not newer or its name belongs to another project.
 */
export type ProjectOutcome = "added" | "merged" | "updated" | "unchanged" | "kept";

/**
 * What happened to a session of the document (6.7 step 3).
 * - "added": inserted. "unchanged": same id and content. "updated": the incoming copy was newer
 *   and replaced the stored one. "kept": the stored session stays.
 */
export type SessionOutcome = "added" | "updated" | "unchanged" | "kept";

export interface ProjectMergeResult {
  /** The id the document gives the project. */
  readonly incomingId: string;
  /** The id of the project in the vault that now stands for it. */
  readonly id: string;
  readonly outcome: ProjectOutcome;
  /** True when the content differed and `updated_at` was equal: neither copy is the newer one. */
  readonly conflict: boolean;
}

export interface SessionMergeResult {
  /** The id the document gives the session. */
  readonly incomingId: string;
  /** The id of the session in the vault: the same id. */
  readonly id: string;
  readonly outcome: SessionOutcome;
  /** True when the content differed and `updated_at` was equal, whatever the policy then did. */
  readonly conflict: boolean;
  /** The id of the copy made under the policy `copyWithTitleSuffix`, otherwise null. */
  readonly copyId: string | null;
}

export interface DocumentImportCounts {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly kept: number;
  /** Sessions whose content differed at an equal `updated_at`. Each is also counted under its outcome. */
  readonly conflicts: number;
  /** Copies made under the policy `copyWithTitleSuffix`. Not part of `added`. */
  readonly copies: number;
  readonly blobsStored: number;
  readonly projectsAdded: number;
  readonly projectsMerged: number;
  readonly projectsUpdated: number;
  readonly projectsUnchanged: number;
  readonly projectsKept: number;
}

/** 6.7 step 5: what the import did. */
export interface DocumentImportReport {
  /** When the import ran: the `now` of the context. */
  readonly at: Date;
  /** `kind` of the document. */
  readonly kind: DocumentKind;
  /** `exported_at` of the document. */
  readonly exportedAt: Date;
  /** `generator` of the document, or null when it names none. */
  readonly generator: InterchangeGenerator | null;
  readonly counts: DocumentImportCounts;
  /** One entry per project of the document, in its order. */
  readonly projects: readonly ProjectMergeResult[];
  /** One entry per session of the document, in its order. */
  readonly sessions: readonly SessionMergeResult[];
  /** SHA-256 of every blob this import stored. */
  readonly blobsStored: readonly string[];
  /** For the user to look at: see NoticeCode. */
  readonly warnings: NoticeList;
  /** What the reader changed before the merge (6.6). */
  readonly repairs: NoticeList;
}

export type DocumentImportResult =
  | { readonly ok: true; readonly vault: Vault; readonly report: DocumentImportReport }
  | {
      readonly ok: false;
      /** Why the document is refused as a whole. The vault is unchanged. */
      readonly problems: CappedList<Problem>;
    };

/** Ends the import from deep inside; importDocument turns it into a refusal. */
class Abort extends Error {
  readonly problem: Problem;
  constructor(message: string) {
    super(message);
    this.problem = { rule: "internal", path: "", message };
  }
}

/** A timestamp the reader has already validated, as a date. */
function date(text: string): Date {
  const reading = parseTimestamp(text);
  if (!reading.ok) throw new Abort("A timestamp changed after it was validated; nothing was imported.");
  return new Date(reading.ms);
}

const UPDATED_AT: ReadonlySet<string> = new Set(["updated_at"]);
const DATA_BASE64: ReadonlySet<string> = new Set(["data_base64"]);
const MESSAGE_ID: ReadonlySet<string> = new Set(["id"]);

/**
 * A session as "same content" compares it. corrections.md 2, point 11: ignored are `updated_at`,
 * the presence of `data_base64`, message ids and the order of properties (jsonEqual does not look
 * at that order). Everything else counts, the order of every array included.
 */
function comparableSession(session: InterchangeSession, projectId: string | null): JsonValue {
  const out = newObject();
  for (const key of Object.keys(session)) {
    const value = session[key];
    if (key === "updated_at" || value === undefined) continue;
    if (key === "project_id") out[key] = projectId;
    else if (key === "attachments") {
      out[key] = session.attachments.map((attachment) => unknownProperties(attachment, DATA_BASE64));
    } else if (key === "messages") {
      out[key] = session.messages.map((message) => unknownProperties(message, MESSAGE_ID));
    } else out[key] = value;
  }
  return out;
}

/**
 * 6.7 "same content". corrections.md 2, point 11: both sides are compared in reader form, the
 * incoming session after repair and the exporter's output for the stored session passed through
 * the same repair. (With the storage invariant G1 that repair changes nothing; it is what makes
 * the comparison right for a vault built by other means.)
 */
function sameSession(
  incoming: InterchangeSession,
  projectId: string | null,
  existing: VaultSession,
  limits: Limits,
): boolean {
  const written = canonicalSession(
    sessionValue(existing, () => undefined),
    limits,
  );
  if (written === null) return false;
  return jsonEqual(comparableSession(incoming, projectId), comparableSession(written, written.project_id));
}

function sameProject(incoming: InterchangeProject, existing: VaultProject, limits: Limits): boolean {
  const written = canonicalProject(projectValue(existing), limits);
  if (written === null) return false;
  return jsonEqual(unknownProperties(incoming, UPDATED_AT), unknownProperties(written, UPDATED_AT));
}

type IdKind = "sessions" | "messages";

function merge(
  vault: Vault,
  input: unknown,
  context: DocumentImportContext,
  options: DocumentImportOptions,
): DocumentImportResult {
  const limits = resolveLimits(options.limits);
  // Step 1: parse, check format and version, repair, validate.
  const read = readDocument(input, {
    destinationProjectIds: new Set(vault.projects.map((project) => project.id)),
    limits,
  });
  if (!read.ok) return { ok: false, problems: read.problems };
  const doc = read.doc;
  const warnings = createNoticeLog(limits.maxListed);
  warnings.addAll(read.warnings);
  const policy = options.onConflict ?? "keep";

  // Ids no new entity may take: those of the vault, of the document, and those handed out below.
  const taken: Record<IdKind, Set<string>> = {
    sessions: new Set(vault.sessions.map((session) => session.id)),
    messages: new Set(),
  };
  /** Which session of the vault owns a message id. */
  const messageOwner = new Map<string, string>();
  for (const session of vault.sessions) {
    for (const message of session.messages) {
      messageOwner.set(message.id, session.id);
      taken.messages.add(message.id);
    }
  }
  for (const session of doc.sessions) {
    taken.sessions.add(session.id);
    for (const message of session.messages) taken.messages.add(message.id);
  }

  const freshId = (kind: IdKind): string => {
    // A generator that keeps returning used or malformed ids must not hold the import up.
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = context.newId();
      const id = typeof candidate === "string" ? candidate.toLowerCase() : "";
      if (isCanonicalUuid(id) && !taken[kind].has(id)) {
        taken[kind].add(id);
        return id;
      }
    }
    throw new Abort("The id generator gave no unused UUID; nothing was imported.");
  };

  // Step 2: projects, in the order of the document. Later ones see what earlier ones did.
  const projects = [...vault.projects];
  const projectIndex = new Map<string, number>();
  /** The project that holds a name key; with duplicates in the vault, the first. */
  const projectByKey = new Map<string, string>();
  projects.forEach((project, index) => {
    projectIndex.set(project.id, index);
    const key = projectNameKey(project.name);
    if (!projectByKey.has(key)) projectByKey.set(key, project.id);
  });
  /** Incoming project id to the id of the project in the vault that stands for it. */
  const projectTarget = new Map<string, string>();
  const projectResults: ProjectMergeResult[] = [];

  doc.projects.forEach((incoming, i) => {
    const key = projectNameKey(incoming.name);
    const index = projectIndex.get(incoming.id);
    const existing = index === undefined ? undefined : projects[index];
    if (index !== undefined && existing !== undefined) {
      // 2a: a project with the same id exists. corrections.md 2, point 9:
      //   equal content                      -> "unchanged";
      //   a later updated_at                 -> the whole project is replaced (name, name key,
      //                                         created_at, updated_at, unknown properties), unless
      //                                         the incoming name's key belongs to another project:
      //                                         then nothing of the project changes, with a warning;
      //   an equal or earlier updated_at
      //   with different content             -> "kept" and reported, as for sessions (an equal
      //                                         updated_at is a conflict).
      let outcome: ProjectOutcome = "kept";
      let conflict = false;
      const incomingTime = date(incoming.updated_at).getTime();
      const existingTime = existing.updated_at.getTime();
      if (sameProject(incoming, existing, limits)) {
        outcome = "unchanged";
      } else if (incomingTime > existingTime) {
        const holder = projectByKey.get(key);
        if (holder !== undefined && holder !== existing.id) {
          warnings.add(
            "project_name_taken",
            `/projects/${i}/name`,
            "Another project already has this name; nothing of the project was changed.",
          );
        } else {
          const oldKey = projectNameKey(existing.name);
          if (projectByKey.get(oldKey) === existing.id) projectByKey.delete(oldKey);
          projectByKey.set(key, existing.id);
          projects[index] = toVaultProject(incoming, existing.id);
          outcome = "updated";
        }
      } else if (incomingTime === existingTime) {
        conflict = true;
        warnings.add(
          "conflict",
          `/projects/${i}`,
          "The stored project differs at the same updated_at; it was kept.",
        );
      }
      projectTarget.set(incoming.id, existing.id);
      projectResults.push({ incomingId: incoming.id, id: existing.id, outcome, conflict });
      return;
    }
    const holder = projectByKey.get(key);
    if (holder !== undefined) {
      // 2b: a project with the same name key exists; use it.
      projectTarget.set(incoming.id, holder);
      projectResults.push({ incomingId: incoming.id, id: holder, outcome: "merged", conflict: false });
      return;
    }
    // 2c: insert it with the incoming id.
    const id = incoming.id;
    projectIndex.set(id, projects.length);
    projects.push(toVaultProject(incoming, id));
    projectByKey.set(key, id);
    projectTarget.set(incoming.id, id);
    projectResults.push({ incomingId: incoming.id, id, outcome: "added", conflict: false });
  });

  // Step 3: sessions.
  const sessions = [...vault.sessions];
  const sessionIndex = new Map<string, number>();
  sessions.forEach((session, index) => {
    sessionIndex.set(session.id, index);
  });
  const sessionResults: SessionMergeResult[] = [];

  /**
   * The ids the messages of an incoming session get in the vault session `owner`.
   * corrections.md 2, point 10: an incoming message id that a message of another session of the
   * same user already holds gets a fresh id, with one warning per session. (R2 and the key of 7.2
   * need message ids unique in a vault.)
   */
  const messageIdsFor = (
    incoming: InterchangeSession,
    owner: string,
    path: string,
    allNew: boolean,
  ): string[] => {
    let replaced = 0;
    const ids = incoming.messages.map((message) => {
      if (allNew) return freshId("messages");
      const holder = messageOwner.get(message.id);
      if (holder === undefined || holder === owner) return message.id;
      replaced += 1;
      return freshId("messages");
    });
    if (replaced > 0) {
      warnings.add(
        "id_replaced",
        path,
        replaced === 1
          ? "1 message id is in use by a message of another session; that message got a new id."
          : `${replaced} message ids are in use by messages of other sessions; those messages got new ids.`,
        replaced,
      );
    }
    return ids;
  };

  const claim = (session: VaultSession): void => {
    for (const message of session.messages) messageOwner.set(message.id, session.id);
  };

  doc.sessions.forEach((incoming, i) => {
    const path = `/sessions/${i}`;
    // The reader made sure the project is in the document or in the vault (repair 8); step 2
    // may have given a document project another id.
    const projectId =
      incoming.project_id === null ? null : (projectTarget.get(incoming.project_id) ?? incoming.project_id);
    const index = sessionIndex.get(incoming.id);
    const existing = index === undefined ? undefined : sessions[index];

    if (index === undefined || existing === undefined) {
      const id = incoming.id;
      const added = toVaultSession(
        incoming,
        id,
        incoming.title,
        projectId,
        messageIdsFor(incoming, id, path, false),
      );
      sessionIndex.set(id, sessions.length);
      sessions.push(added);
      claim(added);
      sessionResults.push({ incomingId: incoming.id, id, outcome: "added", conflict: false, copyId: null });
      return;
    }

    const replace = (): void => {
      // "replace all session fields, delete and re-insert its messages and attachments"
      const ids = messageIdsFor(incoming, existing.id, path, false);
      for (const message of existing.messages) {
        if (messageOwner.get(message.id) === existing.id) messageOwner.delete(message.id);
      }
      const replaced = toVaultSession(incoming, existing.id, incoming.title, projectId, ids);
      sessions[index] = replaced;
      claim(replaced);
    };

    if (sameSession(incoming, projectId, existing, limits)) {
      sessionResults.push({
        incomingId: incoming.id,
        id: existing.id,
        outcome: "unchanged",
        conflict: false,
        copyId: null,
      });
      return;
    }
    const incomingTime = date(incoming.updated_at).getTime();
    const existingTime = existing.updated_at.getTime();
    if (incomingTime > existingTime) {
      replace();
      sessionResults.push({
        incomingId: incoming.id,
        id: existing.id,
        outcome: "updated",
        conflict: false,
        copyId: null,
      });
      return;
    }
    if (incomingTime !== existingTime) {
      // The stored copy is the newer one.
      sessionResults.push({
        incomingId: incoming.id,
        id: existing.id,
        outcome: "kept",
        conflict: false,
        copyId: null,
      });
      return;
    }
    // Different content and equal timestamps: a conflict.
    if (policy === "replace") {
      replace();
      warnings.add(
        "conflict",
        path,
        "The stored session differed at the same updated_at; the incoming one replaced it.",
      );
      sessionResults.push({
        incomingId: incoming.id,
        id: existing.id,
        outcome: "updated",
        conflict: true,
        copyId: null,
      });
      return;
    }
    if (policy === "keep") {
      warnings.add("conflict", path, "The stored session differs at the same updated_at; it was kept.");
      sessionResults.push({
        incomingId: incoming.id,
        id: existing.id,
        outcome: "kept",
        conflict: true,
        copyId: null,
      });
      return;
    }
    const copyId = freshId("sessions");
    const copy = toVaultSession(
      incoming,
      copyId,
      // G1: the suffix comes from the caller; the title is stored cleaned, as the reader gives one.
      cleanString(`${incoming.title}${policy.copyWithTitleSuffix}`),
      projectId,
      messageIdsFor(incoming, copyId, path, true),
    );
    sessionIndex.set(copyId, sessions.length);
    sessions.push(copy);
    claim(copy);
    warnings.add(
      "conflict",
      path,
      "The stored session differs at the same updated_at; the incoming one was added as a copy.",
    );
    sessionResults.push({
      incomingId: incoming.id,
      id: existing.id,
      outcome: "kept",
      conflict: true,
      copyId,
    });
  });

  // Step 4: bytes, for every session of the document whatever step 3 decided.
  let blobs: Map<string, Uint8Array> | null = null;
  const blobsStored: string[] = [];
  doc.sessions.forEach((incoming, i) => {
    const result = sessionResults[i];
    if (result === undefined) return;
    // The lengths the destination session lists for each hash; with it, the copy made of the
    // incoming session when there is one.
    const listedLengths = new Map<string, Set<number>>();
    for (const id of [result.id, result.copyId]) {
      const index = id === null ? undefined : sessionIndex.get(id);
      const destination = index === undefined ? undefined : sessions[index];
      for (const listed of destination?.attachments ?? []) {
        const lengths = listedLengths.get(listed.sha256) ?? new Set<number>();
        lengths.add(listed.byte_length);
        listedLengths.set(listed.sha256, lengths);
      }
    }
    incoming.attachments.forEach((attachment, a) => {
      const sha256 = attachment.sha256;
      if ((blobs ?? vault.blobs).has(sha256)) return;
      // Inline bytes were checked against their descriptor by the reader (repair 9).
      const inline = attachment.data_base64 === undefined ? undefined : read.inlineBytes.get(sha256);
      const bytes = inline ?? options.bundleBlobs?.get(sha256);
      if (bytes === undefined) return;
      const lengths = listedLengths.get(sha256);
      if (lengths === undefined) return;
      // "verify length and hash and store the blob"
      const lengthFits = lengths.has(bytes.length);
      const hashFits = inline !== undefined || sha256Hex(bytes) === sha256;
      if (!lengthFits || !hashFits) {
        warnings.add(
          "bytes_rejected",
          `/sessions/${i}/attachments/${a}`,
          "The bytes that came with the file do not match the stored descriptor; they were not stored.",
        );
        return;
      }
      blobs ??= new Map(vault.blobs);
      blobs.set(sha256, bytes);
      blobsStored.push(sha256);
    });
  });

  // Step 5: the report.
  const count = <T>(results: readonly T[], test: (result: T) => boolean): number =>
    results.filter(test).length;
  const report: DocumentImportReport = {
    at: new Date(context.now.getTime()),
    kind: doc.kind,
    exportedAt: date(doc.exported_at),
    generator: doc.generator ?? null,
    counts: {
      added: count(sessionResults, (r) => r.outcome === "added"),
      updated: count(sessionResults, (r) => r.outcome === "updated"),
      unchanged: count(sessionResults, (r) => r.outcome === "unchanged"),
      kept: count(sessionResults, (r) => r.outcome === "kept"),
      conflicts: count(sessionResults, (r) => r.conflict),
      copies: count(sessionResults, (r) => r.copyId !== null),
      blobsStored: blobsStored.length,
      projectsAdded: count(projectResults, (r) => r.outcome === "added"),
      projectsMerged: count(projectResults, (r) => r.outcome === "merged"),
      projectsUpdated: count(projectResults, (r) => r.outcome === "updated"),
      projectsUnchanged: count(projectResults, (r) => r.outcome === "unchanged"),
      projectsKept: count(projectResults, (r) => r.outcome === "kept"),
    },
    projects: projectResults,
    sessions: sessionResults,
    blobsStored,
    warnings: warnings.list(),
    repairs: read.repairs,
  };
  return { ok: true, vault: { projects, sessions, blobs: blobs ?? vault.blobs }, report };
}

/**
 * Merge an interchange document into a vault (data-model.md 6.7). `input` is the JSON text or the
 * value parsed from it; it is always read, repaired and validated here, whatever was done before.
 *
 * Returns a new vault and a report, or the problems that make the document unacceptable. In that
 * case nothing was imported. The vault handed in is never changed. Never throws.
 */
export function importDocument(
  vault: Vault,
  input: unknown,
  context: DocumentImportContext,
  options: DocumentImportOptions = {},
): DocumentImportResult {
  try {
    return merge(vault, input, context, options);
  } catch (error) {
    const problem: Problem =
      error instanceof Abort
        ? error.problem
        : { rule: "internal", path: "", message: "The import failed unexpectedly; nothing was imported." };
    return { ok: false, problems: { items: [problem], total: 1 } };
  }
}
