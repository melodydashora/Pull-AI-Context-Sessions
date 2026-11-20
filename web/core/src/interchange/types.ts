// The interchange document, version 1, as TypeScript types (data-model.md section 6,
// docs/interchange-schema-v1.json). These are the shapes of the JSON itself: property names are the
// schema's, timestamps are strings, and unknown properties sit beside the known ones.
//
// The types describe a CANONICAL document: what the reader returns after its repairs and what the
// writer emits (6.8: every known property of projects, sessions and attachments is written, also
// when it holds its default). A file as a stranger wrote it is `unknown` until the reader has seen it.
//
// schema.test.ts checks the key lists below against the schema's own property lists.

import type { JsonValue } from "./json.ts";
import { normalizeOpen } from "./shared.ts";

/** Value of `format`: the marker that identifies the file type. Checked before anything else. */
export const FORMAT_MARKER = "sessionvault-interchange";

/** Value of `version`. Additive changes keep it; a larger number is refused whole (6.1). */
export const FORMAT_VERSION = 1;

/**
 * `"vault"`: every project and session of one vault. `"session"`: exactly one session and at most
 * its project.
 */
export type DocumentKind = "vault" | "session";

export const DOCUMENT_KINDS: readonly DocumentKind[] = ["vault", "session"];

// ---------------------------------------------------------------------------------------------
// Open lists (6.2): the property is a string, an unknown value is kept as written and only
// BEHAVES as the fallback.
// ---------------------------------------------------------------------------------------------

export const KNOWN_PROVIDERS = ["claude", "chatgpt", "gemini", "other"] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];
/** How an unknown provider behaves. The "Other" filter is "not claude, chatgpt or gemini". */
export const FALLBACK_PROVIDER: KnownProvider = "other";

export const KNOWN_ROLES = ["user", "assistant", "system", "unknown"] as const;
export type KnownRole = (typeof KNOWN_ROLES)[number];
/** How an unknown role behaves: text with no identified speaker, labelled "Note". */
export const FALLBACK_ROLE: KnownRole = "unknown";

export const KNOWN_ATTACHMENT_KINDS = ["original_pdf", "image", "file", "other"] as const;
export type KnownAttachmentKind = (typeof KNOWN_ATTACHMENT_KINDS)[number];
/** How an unknown attachment kind behaves. */
export const FALLBACK_ATTACHMENT_KIND: KnownAttachmentKind = "other";

export const KNOWN_SEGMENT_TYPES = ["text", "attachment"] as const;
export type KnownSegmentType = (typeof KNOWN_SEGMENT_TYPES)[number];
/**
 * How a segment behaves: an unknown type is opaque (kept, left out of the flattened text, shown as
 * a placeholder).
 */
export type SegmentBehaviour = KnownSegmentType | "opaque";

const PROVIDERS: ReadonlyMap<string, KnownProvider> = new Map(KNOWN_PROVIDERS.map((value) => [value, value]));
const ROLES: ReadonlyMap<string, KnownRole> = new Map(KNOWN_ROLES.map((value) => [value, value]));
const ATTACHMENT_KINDS: ReadonlyMap<string, KnownAttachmentKind> = new Map(
  KNOWN_ATTACHMENT_KINDS.map((value) => [value, value]),
);

/**
 * The known provider a value behaves as: the one it is stored as (corrections.md 2, G2), and
 * "other" for everything else. For a stored value that is the exact comparison of the list filter
 * (data-model.md 7.3), because storage holds no other spelling of a known provider (G1, point 14).
 */
export function providerBehaviour(provider: string): KnownProvider {
  return PROVIDERS.get(normalizeOpen(provider, KNOWN_PROVIDERS, FALLBACK_PROVIDER)) ?? FALLBACK_PROVIDER;
}

/**
 * The known role a stored value behaves as. Compared exactly, as data-model.md 8.3 and the Apple
 * model do ("User" behaves as unknown); every write path stores known roles in lower case (G2).
 */
export function roleBehaviour(role: string): KnownRole {
  return ROLES.get(role) ?? FALLBACK_ROLE;
}

/**
 * The known attachment kind a stored value behaves as. Compared exactly; the reader keeps kinds as
 * written.
 */
export function attachmentKindBehaviour(kind: string): KnownAttachmentKind {
  return ATTACHMENT_KINDS.get(kind) ?? FALLBACK_ATTACHMENT_KIND;
}

/** How a segment of this type behaves. Compared exactly. */
export function segmentBehaviour(type: string): SegmentBehaviour {
  return type === "text" || type === "attachment" ? type : "opaque";
}

// ---------------------------------------------------------------------------------------------
// Known property names, in the order of the schema. Everything else on an object is an unknown
// property: kept and written back (6.5), except at the top of the document.
// ---------------------------------------------------------------------------------------------

export const DOCUMENT_KEYS = [
  "format",
  "version",
  "kind",
  "exported_at",
  "generator",
  "projects",
  "sessions",
] as const;
export const GENERATOR_KEYS = ["app", "app_version", "platform"] as const;
export const PROJECT_KEYS = ["id", "name", "created_at", "updated_at"] as const;
export const SESSION_KEYS = [
  "id",
  "title",
  "provider",
  "model",
  "source_url",
  "summary",
  "tags",
  "is_pinned",
  "created_at",
  "imported_at",
  "updated_at",
  "project_id",
  "attachments",
  "messages",
] as const;
export const ATTACHMENT_KEYS = [
  "kind",
  "sha256",
  "media_type",
  "byte_length",
  "filename",
  "created_at",
  "data_base64",
] as const;
export const MESSAGE_KEYS = ["id", "index", "role", "segments", "created_at", "model"] as const;

/** The same lists as sets, for telling known properties from unknown ones. */
export const DOCUMENT_KEY_SET: ReadonlySet<string> = new Set(DOCUMENT_KEYS);
export const GENERATOR_KEY_SET: ReadonlySet<string> = new Set(GENERATOR_KEYS);
export const PROJECT_KEY_SET: ReadonlySet<string> = new Set(PROJECT_KEYS);
export const SESSION_KEY_SET: ReadonlySet<string> = new Set(SESSION_KEYS);
export const ATTACHMENT_KEY_SET: ReadonlySet<string> = new Set(ATTACHMENT_KEYS);
export const MESSAGE_KEY_SET: ReadonlySet<string> = new Set(MESSAGE_KEYS);

// ---------------------------------------------------------------------------------------------
// The document and its parts.
// ---------------------------------------------------------------------------------------------

/** Which program wrote the document. Informational; never stored in a vault. */
export interface InterchangeGenerator {
  /** Known values: "sessionvault-web", "sessionvault-apple". Not empty. */
  readonly app: string;
  readonly app_version?: string;
  /** Free text, for example "web", "macOS", "iOS". */
  readonly platform?: string;
  /** Unknown properties. */
  readonly [extension: string]: JsonValue;
}

export interface InterchangeProject {
  /** UUID, canonical lower-case form. */
  readonly id: string;
  /** Display name, not empty after trimming white space. */
  readonly name: string;
  readonly created_at: string;
  /** Last change to the project. A file may leave it out; the reader then uses `created_at`. */
  readonly updated_at: string;
  /** Unknown properties: kept and written back (6.5). */
  readonly [extension: string]: JsonValue;
}

/** One binary object of a session, described by its content hash (6.4). */
export interface InterchangeAttachment {
  /** Open list, see KNOWN_ATTACHMENT_KINDS. At most one "original_pdf" per session. */
  readonly kind: string;
  /** SHA-256 of the raw bytes: 64 lower-case hexadecimal characters. */
  readonly sha256: string;
  /** IANA media type, lower case, no parameters. It comes from the file: never trust it for display. */
  readonly media_type: string;
  /** Length of the raw bytes. */
  readonly byte_length: number;
  /** Suggested file name without path separators, "" when there is none. */
  readonly filename: string;
  /** A file may leave it out; the reader then uses the session's `imported_at`. */
  readonly created_at: string;
  /** The bytes, standard base64 with padding. Absent when the bytes travel elsewhere or not at all. */
  readonly data_base64?: string;
  /** Unknown properties: kept and written back (6.5). */
  readonly [extension: string]: JsonValue;
}

/**
 * One part of a message (6.3). `type` is an open list: "text" and "attachment" are known, a segment
 * of any other type is kept whole and unchanged. Use isTextSegment and isAttachmentSegment to read one.
 * Tool calls, tool results and the like arrive as segments of other types.
 */
export interface InterchangeSegment {
  readonly type: string;
  /** Everything else the segment carries. */
  readonly [property: string]: JsonValue;
}

/** Markdown source exactly as stored; may be empty. Fenced code stays inside the text. */
export interface TextSegment extends InterchangeSegment {
  readonly type: "text";
  readonly text: string;
}

/** A binary object shown at this place. The hash is listed in the same session's `attachments`. */
export interface AttachmentSegment extends InterchangeSegment {
  readonly type: "attachment";
  readonly sha256: string;
}

export function isTextSegment(segment: InterchangeSegment): segment is TextSegment {
  return segment.type === "text" && typeof segment.text === "string";
}

export function isAttachmentSegment(segment: InterchangeSegment): segment is AttachmentSegment {
  return segment.type === "attachment" && typeof segment.sha256 === "string";
}

export interface InterchangeMessage {
  /** UUID, canonical lower-case form. Unique among all messages of the document. */
  readonly id: string;
  /** Zero-based position in the session: `messages[i].index === i`. */
  readonly index: number;
  /** Open list, see KNOWN_ROLES. Roles such as "tool" are kept as written. */
  readonly role: string;
  /** The content in order: at least one segment, never two text segments in a row. */
  readonly segments: readonly InterchangeSegment[];
  /** When the message was written, if known. Absent for imported transcripts. */
  readonly created_at?: string;
  /** Model id that produced the message through the app's own API call. Absent otherwise; never "". */
  readonly model?: string;
  /** Unknown properties: kept and written back (6.5). */
  readonly [extension: string]: JsonValue;
}

export interface InterchangeSession {
  /** UUID, canonical lower-case form. */
  readonly id: string;
  /** May be empty; apps display an empty title as "Untitled". */
  readonly title: string;
  /** Open list, see KNOWN_PROVIDERS. */
  readonly provider: string;
  /** Free-text model label, "" when unknown. Never validated against a list. */
  readonly model: string;
  /** The link the session was captured or pulled from, "" when there is none. */
  readonly source_url: string;
  /** Free text with line breaks, "" when there is none. */
  readonly summary: string;
  /** Ordered; each tag trimmed, lower-case, not empty, without commas, and present once. */
  readonly tags: readonly string[];
  readonly is_pinned: boolean;
  /** The ORIGINAL date of the conversation. Not the time a record was created. */
  readonly created_at: string;
  /** When the session first entered any vault. Carried along unchanged between apps. */
  readonly imported_at: string;
  /** Last change to the session or to its message list. */
  readonly updated_at: string;
  /** Id of an entry in `projects`, or null. */
  readonly project_id: string | null;
  /** Every binary object the session refers to. */
  readonly attachments: readonly InterchangeAttachment[];
  /** In conversation order. */
  readonly messages: readonly InterchangeMessage[];
  /** Unknown properties: kept and written back (6.5). */
  readonly [extension: string]: JsonValue;
}

export interface InterchangeDocument {
  readonly format: typeof FORMAT_MARKER;
  readonly version: typeof FORMAT_VERSION;
  readonly kind: DocumentKind;
  /** When the file was written. */
  readonly exported_at: string;
  readonly generator?: InterchangeGenerator;
  /** Order carries no meaning. */
  readonly projects: readonly InterchangeProject[];
  /** Order carries no meaning. */
  readonly sessions: readonly InterchangeSession[];
  /** Unknown properties describe the file, not the vault: read, never stored (6.5 item 2). */
  readonly [extension: string]: JsonValue;
}
