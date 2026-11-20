// The in-memory vault: the projects, sessions, messages, attachments and attachment bytes one
// person owns. The import (data-model.md 6.7) and the export (6.8) work on it, and the functions of
// section 8 (search, tags, timeline, context pack) read it.
//
// The shapes follow the tables of data-model.md 7.2 without `owner_id`: one Vault is one owner.
// Property names are the interchange names, so a VaultSession can be handed to the functions of
// section 8 as it is. Timestamps are Date objects with millisecond precision.
//
// A vault is a value: nothing here changes one in place. Treat every object, array, Map and Date in
// it as read-only (a Date can be changed through its setters; never call them on a stored date).
//
// What every vault must satisfy; checkVault tests all of it:
//   - ids are canonical lower-case UUIDs, unique among projects, among sessions, and among all
//     messages of the vault; a session's project_id is null or the id of a project of the vault;
//   - what the format demands of a document holds for the stored values too: tags trimmed,
//     lower-case, without commas and not repeated; no U+0000 or lone surrogate in any string; no
//     carriage return in message text; at most one "original_pdf" and no repeated (kind, sha256)
//     per session; attachment segments that name an attachment of their session;
//   - the derived values are right: position, text, text_bytes, message_count;
//   - `extra` never holds a known property name, and every blob is stored under its own hash.
// Project names should also differ when compared by projectNameKey; checkVault warns when not.
// Not stored here: `search_text` and `name_key` of data-model.md 7.2. Derive them with
// buildSearchText (8.1) and projectNameKey (8.4) when they are needed.

import { assemble, EMPTY_OBJECT, type JsonObject } from "./json.ts";
import { utf8ByteLength } from "./text.ts";
import type { InterchangeSegment, TextSegment } from "./types.ts";

/** A project: only a name (data-model.md 3.1). A session belongs to at most one. */
export interface VaultProject {
  /** UUID in canonical lower-case form. Unique among the projects of the vault. */
  readonly id: string;
  /**
   * Display name, not empty after trimming. Unique in the vault when compared by
   * projectNameKey (trimmed, NFC, lower case): the import merges projects whose keys are equal.
   */
  readonly name: string;
  /** When the project was made. */
  readonly created_at: Date;
  /** Last change to the project. The import compares it to decide which copy is newer. */
  readonly updated_at: Date;
  /**
   * Unknown interchange properties of the project, written back on export (6.5), and the app's own
   * values under keys that start with "x_" (7.6). Never holds a known property name.
   */
  readonly extra: JsonObject;
}

/**
 * One binary object a session refers to, described by its content hash (6.4). The bytes are in
 * Vault.blobs.
 */
export interface VaultAttachment {
  /**
   * Open list: "original_pdf" (the page snapshot, at most one per session), "image", "file",
   * "other"; others are kept and behave as "other".
   */
  readonly kind: string;
  /**
   * SHA-256 of the raw bytes, 64 lower-case hexadecimal characters. With `kind` it is unique within
   * the session.
   */
  readonly sha256: string;
  /**
   * IANA media type, lower case, no parameters. It comes from a file: serve inline only from an
   * allow-list (5.2 C12).
   */
  readonly media_type: string;
  /** Length of the raw bytes. */
  readonly byte_length: number;
  /** Suggested file name without path separators, "" when there is none. */
  readonly filename: string;
  /** When the object was attached. */
  readonly created_at: Date;
  /** Unknown interchange properties of the descriptor and the app's own "x_" values. */
  readonly extra: JsonObject;
}

/** One message of a session. Messages are never edited after they are made (data-model.md 4.3). */
export interface VaultMessage {
  /** UUID in canonical lower-case form. Unique among all messages of the vault. */
  readonly id: string;
  /**
   * Zero-based place in the session: `session.messages[i].position === i`. Called `index` in the
   * interchange JSON.
   */
  readonly position: number;
  /**
   * Who spoke. Open list: "user", "assistant", "system", "unknown"; any other value (for example
   * "tool") is kept as written and behaves as "unknown" (label "Note"). See roleBehaviour.
   */
  readonly role: string;
  /**
   * The flattened text (6.3): the text segments joined by an empty line. This is what search,
   * context packs and the Claude history use. Always equal to flattenText(messageSegments(m)).
   */
  readonly text: string;
  /**
   * The full content when the message is more than one plain text segment: attachments, segments
   * of unknown types (tool calls and the like) or text segments with extra properties. Null means
   * exactly `[{ "type": "text", "text": text }]`, which is every message an importer of plain
   * transcripts produces. Read it through messageSegments.
   */
  readonly segments: readonly InterchangeSegment[] | null;
  /** Length of `text` in UTF-8 bytes. */
  readonly text_bytes: number;
  /** Model id that produced the message through the app's own API call, "" otherwise. */
  readonly model: string;
  /** When the message was written, null for imported transcripts. */
  readonly created_at: Date | null;
  /** Unknown interchange properties of the message and the app's own "x_" values (7.6: "x_claude"). */
  readonly extra: JsonObject;
}

/** One saved conversation with its messages and attachment descriptors. */
export interface VaultSession {
  /** UUID in canonical lower-case form. Unique among the sessions of the vault. */
  readonly id: string;
  /** Id of a project of the same vault, or null. */
  readonly project_id: string | null;
  /** May be empty; display an empty title as "Untitled". */
  readonly title: string;
  /**
   * Which assistant the conversation came from. Open list: "claude", "chatgpt", "gemini", "other";
   * any other value is kept as written and behaves as "other". See providerBehaviour.
   */
  readonly provider: string;
  /** Free-text model label, "" when unknown. Never validated. */
  readonly model: string;
  /**
   * The link the session was captured or pulled from, "" when there is none. Untrusted: link it
   * only when it is http or https.
   */
  readonly source_url: string;
  /** Free text with line breaks, "" when there is none. */
  readonly summary: string;
  /** Ordered; each tag trimmed, lower-case, not empty, without commas, and present once. */
  readonly tags: readonly string[];
  /** Pinned sessions list first, except in the timeline. */
  readonly is_pinned: boolean;
  /** The ORIGINAL date of the conversation; the user can change it. Not the time the record was made. */
  readonly created_at: Date;
  /** When the session first entered any vault. Never changes; the default list order. */
  readonly imported_at: Date;
  /**
   * Last change to the session, its messages or its attachments. The import compares it to decide
   * which copy is newer.
   */
  readonly updated_at: Date;
  /** Number of messages: `messages.length`. Kept beside the session so that lists never need the messages. */
  readonly message_count: number;
  /** Sum of the messages' `text_bytes`. */
  readonly text_bytes: number;
  /** Unknown interchange properties of the session and the app's own "x_" values (7.6: "x_capture"). */
  readonly extra: JsonObject;
  /** Every binary object the session refers to, in the order they were given. */
  readonly attachments: readonly VaultAttachment[];
  /** The messages in conversation order. */
  readonly messages: readonly VaultMessage[];
}

/** Everything one person owns. */
export interface Vault {
  /** In no particular order; sort for display with the project comparator of data-model.md 8.4. */
  readonly projects: readonly VaultProject[];
  /** In no particular order; lists sort by `is_pinned`, `imported_at` and `id` (7.3). */
  readonly sessions: readonly VaultSession[];
  /**
   * The attachment bytes that are present, by SHA-256 (lower-case hexadecimal), stored once however
   * many sessions refer to them. A descriptor without an entry here has its bytes missing (6.4).
   */
  readonly blobs: ReadonlyMap<string, Uint8Array>;
}

/** A vault with nothing in it. */
export function emptyVault(): Vault {
  return { projects: [], sessions: [], blobs: new Map() };
}

/**
 * data-model.md 6.3: the flattened text of a message. Text segments joined by an empty line;
 * attachment segments and segments of unknown types are left out.
 */
export function flattenText(segments: readonly InterchangeSegment[]): string {
  const texts: string[] = [];
  for (const segment of segments) {
    if (segment.type === "text") texts.push(typeof segment.text === "string" ? segment.text : "");
  }
  return texts.join("\n\n");
}

/**
 * True when the segments are exactly one text segment with no other property: what `segments: null`
 * stands for.
 */
export function isPlainText(segments: readonly InterchangeSegment[]): boolean {
  const only = segments[0];
  return (
    segments.length === 1 &&
    only !== undefined &&
    only.type === "text" &&
    typeof only.text === "string" &&
    Object.keys(only).length === 2
  );
}

/** A text segment holding `text`. */
export function textSegment(text: string): TextSegment {
  return assemble<TextSegment>({ type: "text", text }, EMPTY_OBJECT);
}

/** The content of a message as segments, whether or not it stores any (6.8). */
export function messageSegments(message: VaultMessage): readonly InterchangeSegment[] {
  return message.segments ?? [textSegment(message.text)];
}

/** What a new message needs besides its content. */
export interface MessageInit {
  readonly id: string;
  readonly position: number;
  readonly role: string;
  /** Default "". */
  readonly model?: string;
  /** Default null. */
  readonly created_at?: Date | null;
  /** Default: none. */
  readonly extra?: JsonObject;
}

/** A message that is plain text, as a transcript importer produces it (data-model.md 8.6). */
export function textMessage(init: MessageInit & { readonly text: string }): VaultMessage {
  return {
    id: init.id,
    position: init.position,
    role: init.role,
    text: init.text,
    segments: null,
    text_bytes: utf8ByteLength(init.text),
    model: init.model ?? "",
    created_at: init.created_at ?? null,
    extra: init.extra ?? EMPTY_OBJECT,
  };
}

/**
 * A message from segments. `text` and `text_bytes` are derived; `segments` is stored only when the
 * content is more than one plain text segment. No segments at all is the empty message.
 */
export function segmentedMessage(
  init: MessageInit & { readonly segments: readonly InterchangeSegment[] },
): VaultMessage {
  const text = flattenText(init.segments);
  const plain = init.segments.length === 0 || isPlainText(init.segments);
  return { ...textMessage({ ...init, text }), segments: plain ? null : init.segments };
}

/** What a new session needs. Everything left out takes the default of data-model.md 8.6. */
export interface SessionInit {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly created_at: Date;
  readonly imported_at: Date;
  readonly updated_at: Date;
  readonly messages: readonly VaultMessage[];
  /** Default null. */
  readonly project_id?: string | null;
  /** Default "". */
  readonly model?: string;
  /** Default "". */
  readonly source_url?: string;
  /** Default "". */
  readonly summary?: string;
  /** Default: none. */
  readonly tags?: readonly string[];
  /** Default false. */
  readonly is_pinned?: boolean;
  /** Default: none. */
  readonly attachments?: readonly VaultAttachment[];
  /** Default: none. */
  readonly extra?: JsonObject;
}

/** A session with `message_count` and `text_bytes` derived from its messages. */
export function makeSession(init: SessionInit): VaultSession {
  let textBytes = 0;
  for (const message of init.messages) textBytes += message.text_bytes;
  return {
    id: init.id,
    project_id: init.project_id ?? null,
    title: init.title,
    provider: init.provider,
    model: init.model ?? "",
    source_url: init.source_url ?? "",
    summary: init.summary ?? "",
    tags: init.tags ?? [],
    is_pinned: init.is_pinned ?? false,
    created_at: init.created_at,
    imported_at: init.imported_at,
    updated_at: init.updated_at,
    message_count: init.messages.length,
    text_bytes: textBytes,
    extra: init.extra ?? EMPTY_OBJECT,
    attachments: init.attachments ?? [],
    messages: init.messages,
  };
}
