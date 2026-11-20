// The import algorithm of data-model.md 6.7: merge a document into a vault.
//
// A pure function: the vault that goes in is not changed, a new one comes out. Import never
// deletes: a project or session the document does not mention is left alone.

import { type JsonValue, jsonEqual, newObject, unknownProperties } from "./json.ts";
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
import { parseTimestamp } from "./timestamp.ts";
import {
  ATTACHMENT_KEY_SET,
  type DocumentKind,
  type InterchangeGenerator,
  type InterchangeProject,
  type InterchangeSession,
  MESSAGE_KEY_SET,
  PROJECT_KEY_SET,
  SESSION_KEY_SET,
} from "./types.ts";
import { canonicalProject, canonicalSession } from "./validate.ts";
import {
  makeSession,
  segmentedMessage,
  type Vault,
  type VaultAttachment,
  type VaultProject,
  type VaultSession,
} from "./vault.ts";
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
   * be used: it belongs to another owner, to a message of another session, or a copy is made.
   */
  readonly newId: () => string;
}

/**
 * Ids that exist in the store under another owner (6.7, owner scoping). An incoming entity that
 * would be inserted under one of them gets a new id, and references in the document follow.
 */
export interface ReservedIds {
  readonly projects?: ReadonlySet<string>;
  readonly sessions?: ReadonlySet<string>;
  readonly messages?: ReadonlySet<string>;
}

export interface DocumentImportOptions {
  /** Default "keep". */
  readonly onConflict?: ConflictPolicy;
  /**
   * Bytes that came beside the document, by SHA-256: the `blobs/<sha256>` entries of a ZIP bundle
   * (6.4). They are checked against their hash before they are stored. Do not change them afterwards.
   */
  readonly bundleBlobs?: ReadonlyMap<string, Uint8Array>;
  readonly reservedIds?: ReservedIds;
  /** Bounds on depth, size and the length of the reported lists. Defaults: DEFAULT_LIMITS. */
  readonly limits?: Partial<Limits>;
}

/**
 * What happened to a project of the document (6.7 step 2).
 * - "added": inserted. "merged": a stored project has the same name (compared by projectNameKey);
 *   that one is used. "updated": same id, the incoming copy was newer. "unchanged": same id and
 *   content. "kept": same id, different content, the incoming copy was not newer or its new name
 *   belongs to another project.
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
}

export interface SessionMergeResult {
  /** The id the document gives the session. */
  readonly incomingId: string;
  /** The id of the session in the vault. Differs from `incomingId` only when the id was reserved. */
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

function toVaultProject(project: InterchangeProject, id: string): VaultProject {
  return {
    id,
    name: project.name,
    created_at: date(project.created_at),
    updated_at: date(project.updated_at),
    extra: unknownProperties(project, PROJECT_KEY_SET),
  };
}

function toVaultSession(
  session: InterchangeSession,
  id: string,
  title: string,
  projectId: string | null,
  messageIds: readonly string[],
): VaultSession {
  const attachments: VaultAttachment[] = session.attachments.map((attachment) => ({
    kind: attachment.kind,
    sha256: attachment.sha256,
    media_type: attachment.media_type,
    byte_length: attachment.byte_length,
    filename: attachment.filename,
    created_at: date(attachment.created_at),
    extra: unknownProperties(attachment, ATTACHMENT_KEY_SET),
  }));
  const messages = session.messages.map((message, position) =>
    segmentedMessage({
      id: messageIds[position] ?? message.id,
      position,
      role: message.role,
      segments: message.segments,
      model: message.model ?? "",
      created_at: message.created_at === undefined ? null : date(message.created_at),
      extra: unknownProperties(message, MESSAGE_KEY_SET),
    }),
  );
  return makeSession({
    id,
    project_id: projectId,
    title,
    provider: session.provider,
    model: session.model,
    source_url: session.source_url,
    summary: session.summary,
    tags: session.tags,
    is_pinned: session.is_pinned,
    created_at: date(session.created_at),
    imported_at: date(session.imported_at),
    updated_at: date(session.updated_at),
    attachments,
    messages,
    extra: unknownProperties(session, SESSION_KEY_SET),
  });
}

const UPDATED_AT: ReadonlySet<string> = new Set(["updated_at"]);
const DATA_BASE64: ReadonlySet<string> = new Set(["data_base64"]);

/** A session as "same content" compares it (6.7): without updated_at and without inline bytes. */
function comparableSession(session: InterchangeSession, projectId: string | null): JsonValue {
  const out = newObject();
  for (const key of Object.keys(session)) {
    const value = session[key];
    if (key === "updated_at" || value === undefined) continue;
    if (key === "project_id") out[key] = projectId;
    else if (key === "attachments") {
      out[key] = session.attachments.map((attachment) => unknownProperties(attachment, DATA_BASE64));
    } else out[key] = value;
  }
  return out;
}

/**
 * 6.7 "same content": the incoming session, after repair, equals what the exporter would write
 * for the stored one.
 * Departure from data-model.md 6.7: the exporter's output is read the way the incoming document
 * was, so both sides are in the reader's form whatever the vault holds. Compared as written, a
 * stored value the reader would repair makes the vault's own export look like a conflict.
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

type IdKind = "projects" | "sessions" | "messages";

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
  const reserved = options.reservedIds ?? {};

  // Ids no new entity may take: those of the vault, of the document, and those handed out below.
  const taken: Record<IdKind, Set<string>> = {
    projects: new Set(vault.projects.map((project) => project.id)),
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
  for (const project of doc.projects) taken.projects.add(project.id);
  for (const session of doc.sessions) {
    taken.sessions.add(session.id);
    for (const message of session.messages) taken.messages.add(message.id);
  }

  const freshId = (kind: IdKind): string => {
    // A generator that keeps returning used or malformed ids must not hold the import up.
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = context.newId();
      const id = typeof candidate === "string" ? candidate.toLowerCase() : "";
      if (isCanonicalUuid(id) && !taken[kind].has(id) && reserved[kind]?.has(id) !== true) {
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
      // 2a: a project with the same id exists.
      // Open point in data-model.md 6.7: it names only the name. A newer copy replaces the whole
      // project here; a refused rename changes nothing; equal content is reported as "unchanged".
      let outcome: ProjectOutcome = "kept";
      if (sameProject(incoming, existing, limits)) {
        outcome = "unchanged";
      } else if (date(incoming.updated_at).getTime() > existing.updated_at.getTime()) {
        const holder = projectByKey.get(key);
        if (holder !== undefined && holder !== existing.id) {
          warnings.add(
            "project_name_taken",
            `/projects/${i}/name`,
            "Another project already has this name; the project keeps its old name.",
          );
        } else {
          const oldKey = projectNameKey(existing.name);
          if (projectByKey.get(oldKey) === existing.id) projectByKey.delete(oldKey);
          projectByKey.set(key, existing.id);
          projects[index] = toVaultProject(incoming, existing.id);
          outcome = "updated";
        }
      }
      projectTarget.set(incoming.id, existing.id);
      projectResults.push({ incomingId: incoming.id, id: existing.id, outcome });
      return;
    }
    const holder = projectByKey.get(key);
    if (holder !== undefined) {
      // 2b: a project with the same name key exists; use it.
      projectTarget.set(incoming.id, holder);
      projectResults.push({ incomingId: incoming.id, id: holder, outcome: "merged" });
      return;
    }
    // 2c: insert it with the incoming id, unless that id belongs to another owner.
    let id = incoming.id;
    if (reserved.projects?.has(id) === true) {
      id = freshId("projects");
      warnings.add(
        "id_replaced",
        `/projects/${i}/id`,
        "The id is in use elsewhere; the project got a new one.",
      );
    }
    projectIndex.set(id, projects.length);
    projects.push(toVaultProject(incoming, id));
    projectByKey.set(key, id);
    projectTarget.set(incoming.id, id);
    projectResults.push({ incomingId: incoming.id, id, outcome: "added" });
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
   * Open point in data-model.md 6.7: it gives a new id only to what another owner already has. A
   * message id held by another session of this vault gets the same treatment, or R2 would break.
   */
  const messageIdsFor = (
    incoming: InterchangeSession,
    owner: string,
    path: string,
    allNew: boolean,
  ): string[] =>
    incoming.messages.map((message, m) => {
      if (allNew) return freshId("messages");
      const holder = messageOwner.get(message.id);
      const elsewhere = holder === undefined ? reserved.messages?.has(message.id) === true : holder !== owner;
      if (!elsewhere) return message.id;
      warnings.add(
        "id_replaced",
        `${path}/messages/${m}/id`,
        "The id is in use by a message of another session; the message got a new one.",
      );
      return freshId("messages");
    });

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
      let id = incoming.id;
      if (reserved.sessions?.has(id) === true) {
        id = freshId("sessions");
        warnings.add("id_replaced", `${path}/id`, "The id is in use elsewhere; the session got a new one.");
      }
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
      `${incoming.title}${policy.copyWithTitleSuffix}`,
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
