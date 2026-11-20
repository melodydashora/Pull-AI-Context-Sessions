// Types of the transcript importer (docs/import-rules.md section 5, fixtures/import/README.md).

/** Provider identifiers of data-model.md. The Apple app stores display names instead. */
export type Provider = "claude" | "chatgpt" | "gemini" | "other";

/** `unknown` is shown as "Note". */
export type Role = "user" | "assistant" | "system" | "unknown";

export interface ParsedMessage {
  readonly role: Role;
  /** Never empty (W12). Full-trimmed, LF line endings only (W1). */
  readonly text: string;
}

/** What a parser returns for one conversation; data-model.md 8.6 turns it into rows. */
export interface ParsedSession {
  readonly title: string;
  readonly provider: Provider;
  /** "" unless a context pack names a model (W14). */
  readonly model: string;
  /** "" when the input came with no link. Untrusted: link it only if it is http(s) (C7). */
  readonly sourceUrl: string;
  /** RFC 3339, UTC, milliseconds. null: the source has no date, the store uses the import time (2.7). */
  readonly createdAt: string | null;
  /** "" unless a context pack carries a summary (W14). */
  readonly summary: string;
  /** Empty unless a context pack carries tags (W14). */
  readonly tags: readonly string[];
  /** Never empty (W12). */
  readonly messages: readonly ParsedMessage[];
}

/** W2: which encoding was assumed. The user has to be told. */
export type ImportFlag = "decoded_as_utf_16le" | "decoded_as_utf_16be" | "decoded_as_windows_1252";

/** fixtures/import/README.md "Result format"; capture codes are those of capture.md 7.5. */
export type RejectReason =
  | "empty_input"
  | "undecodable"
  | "unrecognised_json"
  | "no_messages"
  | "no_conversation_found"
  | "sign_in_suspected";

/** W10: a captured turn removed as page chrome. Never silent: the user can restore it. */
export interface DroppedTurn {
  readonly position: "leading" | "trailing";
  /** Position of the turn in the input. */
  readonly index: number;
  readonly text: string;
}

/** A parsed JSON object. */
export type JsonObject = Readonly<Record<string, unknown>>;

interface ResultBase {
  readonly flags: readonly ImportFlag[];
  /** Captures only; empty otherwise. */
  readonly droppedTurns: readonly DroppedTurn[];
}

/** At least one session is to be saved. */
export interface ImportedResult extends ResultBase {
  readonly outcome: "imported";
  readonly reason: null;
  /** In source order (C9). Never empty. */
  readonly sessions: readonly ParsedSession[];
}

/** Nothing is saved; `reason` says why. */
export interface RejectedResult extends ResultBase {
  readonly outcome: "rejected";
  readonly reason: RejectReason;
  readonly sessions: readonly [];
}

/** W11: the pasted text is a link. Nothing is saved. */
export interface LinkResult extends ResultBase {
  readonly outcome: "link";
  readonly reason: null;
  /** The link, with the scheme forced to https (capture.md 8.1). */
  readonly linkUrl: string;
  readonly sessions: readonly [];
}

/**
 * W3: the file is a SessionVault interchange file. Nothing is imported here: `json` goes to the
 * interchange reader of data-model.md 6.7, which checks the version and everything else.
 */
export interface InterchangeResult extends ResultBase {
  readonly outcome: "interchange";
  readonly reason: null;
  readonly json: JsonObject;
  readonly sessions: readonly [];
}

export type FileImportResult = ImportedResult | RejectedResult | InterchangeResult;
export type PasteImportResult = ImportedResult | RejectedResult | LinkResult;
export type CaptureImportResult = ImportedResult | RejectedResult;
export type ImportResult = ImportedResult | RejectedResult | LinkResult | InterchangeResult;

export interface FileOptions {
  /**
   * W3 "keep as a plain-text note": skip the JSON rules and send the text of a `.json` file to
   * the text parsers on purpose. Offered by the user interface after `unrecognised_json`.
   */
  readonly asPlainText?: boolean;
}

export interface PasteOptions {
  /** Title the caller passes to the parsers; the Apple constant is "Pasted session". */
  readonly title: string;
  /** Value of the provider picker. Replaces the provider only when the parsers found none. */
  readonly pickerProvider: Provider;
  /** The link the text was copied from (capture.md 8.1). */
  readonly sourceUrl?: string;
  /** The user answered the sign-in-wall warning with "import anyway". */
  readonly allowWall?: boolean;
}

/** W10: what the capture layer hands over when its strings carry no roles from markup. */
export interface CaptureInput {
  readonly sourceUrl: string;
  /** Title found on the page, already cleaned by the capture layer. */
  readonly detectedTitle: string | null;
  /** What the user typed into the name field, possibly empty. */
  readonly typedName: string;
  /** Stated by the capture layer, never guessed from the number of turns. */
  readonly kind: "page-text" | "turns";
  readonly turns: readonly string[];
  readonly allowWall?: boolean;
  /**
   * W10 `keep_dropped`: input indexes of turns that were dropped as page chrome and that the
   * user wants back, after seeing `droppedTurns`. Each goes back to its place and is then
   * treated like any kept turn. Empty when absent; an index that names no dropped turn is
   * ignored. Kind "turns" only.
   */
  readonly keepDropped?: readonly number[];
}

/** W13: one piece of a message as it is drawn. Computed on display, never stored. */
export type DisplaySegment =
  | { readonly type: "prose"; readonly text: string }
  | { readonly type: "code"; readonly language: string | null; readonly code: string };
