// The storage invariant (corrections.md section 2, G1): whatever is stored is in the form the
// reader produces, so the exporter's output passes the schema and R1 to R10 without repair, and a
// second import of the app's own export reports every project and session as unchanged.
//
// Every write path runs the same normalisation before storing: the interchange import, the
// transcript import, a capture, an edit through the API or through sync. That normalisation is the
// reader's own repair list (data-model.md 6.6 as corrections.md settles it), and this module is
// its constructor: hand it the fields as the write path has them, store what comes back.
//
//   normaliseSession   a session with its messages and attachment descriptors
//   normaliseProject   a project
//
// Both write the draft as the exporter would and read that back as the reader does, so the result
// is the reader's form by construction and not by a second set of rules. A value the reader would
// refuse (a provider of more than 200 characters, an id that is no UUID, a date no file can hold)
// comes back as problems, and nothing is to be stored.

import {
  assemble,
  EMPTY_OBJECT,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  unknownProperties,
} from "./json.ts";
import { type CappedList, type Limits, type NoticeList, type Problem, resolveLimits } from "./problems.ts";
import { dateToTimestamp, parseTimestamp } from "./timestamp.ts";
import {
  ATTACHMENT_KEY_SET,
  type InterchangeProject,
  type InterchangeSegment,
  type InterchangeSession,
  MESSAGE_KEY_SET,
  PROJECT_KEY_SET,
  SESSION_KEY_SET,
} from "./types.ts";
import { checkProjectAlone, checkSessionAlone } from "./validate.ts";
import {
  makeSession,
  segmentedMessage,
  textSegment,
  type VaultAttachment,
  type VaultProject,
  type VaultSession,
} from "./vault.ts";

// ---------------------------------------------------------------------------------------------
// From the reader's form to the vault's.
// ---------------------------------------------------------------------------------------------

/** A timestamp the reader has already validated, as a date. */
function dateOf(text: string): Date {
  const reading = parseTimestamp(text);
  if (!reading.ok) throw new RangeError("A timestamp changed after it was validated.");
  return new Date(reading.ms);
}

/** A project in the reader's form as the vault holds it, under the given id. */
export function toVaultProject(project: InterchangeProject, id: string): VaultProject {
  return {
    id,
    name: project.name,
    created_at: dateOf(project.created_at),
    updated_at: dateOf(project.updated_at),
    extra: unknownProperties(project, PROJECT_KEY_SET),
  };
}

/**
 * A session in the reader's form as the vault holds it. `messageIds` replaces the id of the
 * message at the same place; where it has no entry the message keeps its own.
 */
export function toVaultSession(
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
    created_at: dateOf(attachment.created_at),
    extra: unknownProperties(attachment, ATTACHMENT_KEY_SET),
  }));
  const messages = session.messages.map((message, position) =>
    segmentedMessage({
      id: messageIds[position] ?? message.id,
      position,
      role: message.role,
      segments: message.segments,
      model: message.model ?? "",
      created_at: message.created_at === undefined ? null : dateOf(message.created_at),
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
    created_at: dateOf(session.created_at),
    imported_at: dateOf(session.imported_at),
    updated_at: dateOf(session.updated_at),
    attachments,
    messages,
    extra: unknownProperties(session, SESSION_KEY_SET),
  });
}

// ---------------------------------------------------------------------------------------------
// Drafts: the fields as a write path has them, before they are in the reader's form.
// ---------------------------------------------------------------------------------------------

/** One message of a session that is about to be stored. A VaultMessage is one too. */
export interface MessageDraft {
  /** A UUID; letters of either case. */
  readonly id: string;
  /** Any string of at most 200 characters; normalised by G2. */
  readonly role: string;
  /** The content as plain text. Read only when `segments` is absent or null. */
  readonly text?: string;
  /** The content as segments (6.3). When given and not null it is the content. */
  readonly segments?: readonly InterchangeSegment[] | null;
  /** Default: not set. "" means not set too (point 13). */
  readonly model?: string;
  /** Default: not known. */
  readonly created_at?: Date | null;
  /** Unknown interchange properties and the app's own "x_" values. Known names in it are ignored. */
  readonly extra?: JsonObject;
}

/** One attachment descriptor of a session that is about to be stored. A VaultAttachment is one too. */
export interface AttachmentDraft {
  readonly kind: string;
  /** 64 hexadecimal characters; letters of either case. */
  readonly sha256: string;
  readonly media_type: string;
  readonly byte_length: number;
  /** Default "". */
  readonly filename?: string;
  /** Default: the session's `imported_at`. */
  readonly created_at?: Date;
  readonly extra?: JsonObject;
}

/**
 * A session that is about to be stored: what an importer parsed, what a request carried, or a
 * stored session with some fields changed. A VaultSession is one too. Messages are in conversation
 * order: the place in the array is the position.
 */
export interface SessionDraft {
  /** A UUID; letters of either case. */
  readonly id: string;
  /** Default null. */
  readonly project_id?: string | null;
  readonly title: string;
  /** Any string of at most 200 characters; normalised by G2. */
  readonly provider: string;
  /** Default "". */
  readonly model?: string;
  /** Default "". */
  readonly source_url?: string;
  /** Default "". */
  readonly summary?: string;
  /** Default: none. Normalised by parseTags (8.2). */
  readonly tags?: readonly string[];
  /** Default false. */
  readonly is_pinned?: boolean;
  /** The ORIGINAL date of the conversation. */
  readonly created_at: Date;
  readonly imported_at: Date;
  /** Default: `imported_at`. */
  readonly updated_at?: Date;
  /** Default: none. They keep their order. */
  readonly attachments?: readonly AttachmentDraft[];
  readonly messages: readonly MessageDraft[];
  /** Unknown interchange properties and the app's own "x_" values. Known names in it are ignored. */
  readonly extra?: JsonObject;
}

/** A project that is about to be stored. A VaultProject is one too. */
export interface ProjectDraft {
  /** A UUID; letters of either case. */
  readonly id: string;
  /** Not empty after trimming white space. Kept as written apart from string cleaning. */
  readonly name: string;
  readonly created_at: Date;
  /** Default: `created_at`. */
  readonly updated_at?: Date;
  readonly extra?: JsonObject;
}

export interface NormaliseOptions {
  /**
   * The ids of the projects the session may belong to. A `project_id` that is none of them
   * becomes null, with a warning (6.6 repair 8). Left out: the id is kept as it is, and the
   * caller answers for the project being there.
   */
  readonly projectIds?: ReadonlySet<string>;
  /** Bounds on depth, size and the length of the reported lists. Defaults: DEFAULT_LIMITS. */
  readonly limits?: Partial<Limits>;
}

/** What normalising a session gave: the session to store, or why it cannot be stored. */
export type NormalisedSession =
  | {
      readonly ok: true;
      /** In the reader's form, with `message_count`, `text_bytes`, positions and texts derived. */
      readonly session: VaultSession;
      /** What had to change to get there (the reader's repair codes); empty for a stored session. */
      readonly repairs: NoticeList;
      /** Repair 8, repair 9, a dropped property, R12. */
      readonly warnings: NoticeList;
    }
  | {
      readonly ok: false;
      /** Paths start at the session: "/provider", "/messages/3/role". */
      readonly problems: CappedList<Problem>;
    };

/** What normalising a project gave: the project to store, or why it cannot be stored. */
export type NormalisedProject =
  | {
      readonly ok: true;
      readonly project: VaultProject;
      readonly repairs: NoticeList;
      readonly warnings: NoticeList;
    }
  | { readonly ok: false; readonly problems: CappedList<Problem> };

/** A date as interchange text. A date no file can hold becomes "", which the reader refuses. */
function stamp(date: Date): string {
  return dateToTimestamp(date) ?? "";
}

/**
 * The unknown properties a draft carries. The type says an object; a caller in JavaScript can hand
 * over anything, and the keys of an array or of a string ("0", "1") must never be stored as
 * properties: such a draft is refused as a whole (the caller of this function catches).
 */
function extraOf(extra: JsonObject | undefined, known: ReadonlySet<string>): JsonObject {
  if (extra === undefined || extra === null) return EMPTY_OBJECT;
  if (!isJsonObject(extra)) throw new TypeError("extra is not an object");
  return unknownProperties(extra, known);
}

function messageDraftValue(message: MessageDraft, index: number): JsonObject {
  const segments: readonly JsonValue[] = message.segments ?? [textSegment(message.text ?? "")];
  return assemble<JsonObject>(
    {
      id: message.id,
      index,
      role: message.role,
      segments,
      ...(message.created_at === undefined || message.created_at === null
        ? {}
        : { created_at: stamp(message.created_at) }),
      ...(message.model === undefined ? {} : { model: message.model }),
    },
    extraOf(message.extra, MESSAGE_KEY_SET),
  );
}

function attachmentDraftValue(attachment: AttachmentDraft): JsonObject {
  return assemble<JsonObject>(
    {
      kind: attachment.kind,
      sha256: attachment.sha256,
      media_type: attachment.media_type,
      byte_length: attachment.byte_length,
      ...(attachment.filename === undefined ? {} : { filename: attachment.filename }),
      ...(attachment.created_at === undefined ? {} : { created_at: stamp(attachment.created_at) }),
    },
    extraOf(attachment.extra, ATTACHMENT_KEY_SET),
  );
}

/** The draft as an interchange session: what a file would say that holds it as it is. */
function sessionDraftValue(draft: SessionDraft): JsonObject {
  return assemble<JsonObject>(
    {
      id: draft.id,
      title: draft.title,
      provider: draft.provider,
      ...(draft.model === undefined ? {} : { model: draft.model }),
      ...(draft.source_url === undefined ? {} : { source_url: draft.source_url }),
      ...(draft.summary === undefined ? {} : { summary: draft.summary }),
      ...(draft.tags === undefined ? {} : { tags: draft.tags }),
      ...(draft.is_pinned === undefined ? {} : { is_pinned: draft.is_pinned }),
      created_at: stamp(draft.created_at),
      imported_at: stamp(draft.imported_at),
      ...(draft.updated_at === undefined ? {} : { updated_at: stamp(draft.updated_at) }),
      project_id: draft.project_id ?? null,
      attachments: (draft.attachments ?? []).map(attachmentDraftValue),
      messages: draft.messages.map(messageDraftValue),
    },
    extraOf(draft.extra, SESSION_KEY_SET),
  );
}

function projectDraftValue(draft: ProjectDraft): JsonObject {
  return assemble<JsonObject>(
    {
      id: draft.id,
      name: draft.name,
      created_at: stamp(draft.created_at),
      ...(draft.updated_at === undefined ? {} : { updated_at: stamp(draft.updated_at) }),
    },
    extraOf(draft.extra, PROJECT_KEY_SET),
  );
}

function failed(message: string): CappedList<Problem> {
  return { items: [{ rule: "internal", path: "", message }], total: 1 };
}

/**
 * corrections.md 2, G1: the session as it is to be stored, in the form the reader produces.
 *
 * Every write path calls this before storing, whatever it has in hand: a parser result with new
 * ids, the body of a request, a stored session with an edited title. What the reader would repair
 * is repaired the same way (strings cleaned, provider and roles by G2, tags by parseTags, ids and
 * hashes in lower case, line endings, adjacent text segments); what it would refuse is refused.
 * Normalising a session that is in this form already changes nothing and reports no repair.
 *
 * Never throws.
 */
export function normaliseSession(draft: SessionDraft, options: NormaliseOptions = {}): NormalisedSession {
  try {
    const checked = checkSessionAlone(
      sessionDraftValue(draft),
      resolveLimits(options.limits),
      options.projectIds,
    );
    const session = checked.value;
    if (session === null) return { ok: false, problems: checked.problems };
    return {
      ok: true,
      session: toVaultSession(session, session.id, session.title, session.project_id, []),
      repairs: checked.repairs,
      warnings: checked.warnings,
    };
  } catch {
    return { ok: false, problems: failed("The session could not be normalised.") };
  }
}

/**
 * corrections.md 2, G1: the project as it is to be stored, in the form the reader produces. The
 * name is kept as written apart from string cleaning; whether it is free is the caller's
 * question (data-model.md 8.4, checkProjectName). Never throws.
 */
export function normaliseProject(draft: ProjectDraft, options: NormaliseOptions = {}): NormalisedProject {
  try {
    const checked = checkProjectAlone(projectDraftValue(draft), resolveLimits(options.limits));
    const project = checked.value;
    if (project === null) return { ok: false, problems: checked.problems };
    return {
      ok: true,
      project: toVaultProject(project, project.id),
      repairs: checked.repairs,
      warnings: checked.warnings,
    };
  } catch {
    return { ok: false, problems: failed("The project could not be normalised.") };
  }
}
