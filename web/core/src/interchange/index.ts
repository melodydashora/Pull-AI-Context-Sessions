// The interchange format, version 1 (docs/data-model.md section 6): types, reader, import, export,
// and the in-memory vault they work on. Everything here is a pure function over plain values.
//
//   readDocument      JSON text or parsed value -> typed document, or the problems (6.6). Never throws.
//   validateDocument  the strict check a writer's output must pass (6.8)
//   importDocument    vault + document -> new vault + report (6.7)
//   exportDocument    vault or one session -> document (6.8); documentText turns it into JSON text
//   normaliseSession, normaliseProject   what every write path stores: the reader's form
//                     (corrections.md section 2, G1)
//   Vault, VaultSession, ...   the model the functions of section 8 are built on (vault.ts)
//   checkVault        a consistency check for vault values, for tests

export { decodeBase64, encodeBase64 } from "./base64.ts";
export { type BundleEntry, classifyBundleEntry, type DocumentParts, splitDocument } from "./bundle.ts";
export { checkVault, type VaultCheck } from "./check.ts";
export {
  type DocumentExportContext,
  type DocumentExportOptions,
  type DocumentExportResult,
  type DocumentExportScope,
  documentText,
  documentTextChunks,
  exportDocument,
  MAX_INLINE_BYTES,
  webGenerator,
} from "./export.ts";
export { fileSystemSafe, suggestedFileName } from "./filename.ts";
export {
  type ConflictPolicy,
  type DocumentImportContext,
  type DocumentImportCounts,
  type DocumentImportOptions,
  type DocumentImportReport,
  type DocumentImportResult,
  importDocument,
  type ProjectMergeResult,
  type ProjectOutcome,
  type SessionMergeResult,
  type SessionOutcome,
} from "./import.ts";
export { EMPTY_OBJECT, type JsonObject, type JsonValue, jsonEqual } from "./json.ts";
export {
  type AttachmentDraft,
  type MessageDraft,
  type NormalisedProject,
  type NormalisedSession,
  type NormaliseOptions,
  normaliseProject,
  normaliseSession,
  type ProjectDraft,
  type SessionDraft,
} from "./normalise.ts";
export {
  type CappedList,
  DEFAULT_LIMITS,
  type Limits,
  type Notice,
  type NoticeCode,
  type NoticeList,
  type Problem,
  type RuleId,
  type SchemaKeyword,
} from "./problems.ts";
export {
  isInterchangeDocument,
  type ReadOptions,
  type ReadResult,
  readDocument,
  type ValidationResult,
  validateDocument,
} from "./reader.ts";
export { sha256Hex } from "./sha256.ts";
export {
  isOpenValueTooLong,
  MAX_OPEN_VALUE_CHARACTERS,
  normaliseTags,
  normalizeOpen,
  parseTags,
  projectNameKey,
} from "./shared.ts";
export { utf8ByteLength } from "./text.ts";
export { dateToTimestamp, formatTimestamp, parseTimestamp, type TimestampReading } from "./timestamp.ts";
export {
  ATTACHMENT_KEYS,
  type AttachmentSegment,
  attachmentKindBehaviour,
  DOCUMENT_KEYS,
  type DocumentKind,
  FALLBACK_ATTACHMENT_KIND,
  FALLBACK_PROVIDER,
  FALLBACK_ROLE,
  FORMAT_MARKER,
  FORMAT_VERSION,
  GENERATOR_KEYS,
  type InterchangeAttachment,
  type InterchangeDocument,
  type InterchangeGenerator,
  type InterchangeMessage,
  type InterchangeProject,
  type InterchangeSegment,
  type InterchangeSession,
  isAttachmentSegment,
  isTextSegment,
  KNOWN_ATTACHMENT_KINDS,
  KNOWN_PROVIDERS,
  KNOWN_ROLES,
  KNOWN_SEGMENT_TYPES,
  type KnownAttachmentKind,
  type KnownProvider,
  type KnownRole,
  type KnownSegmentType,
  MESSAGE_KEYS,
  PROJECT_KEYS,
  providerBehaviour,
  roleBehaviour,
  SESSION_KEYS,
  type SegmentBehaviour,
  segmentBehaviour,
  type TextSegment,
} from "./types.ts";
export {
  emptyVault,
  flattenText,
  isPlainText,
  type MessageInit,
  makeSession,
  messageSegments,
  type SessionInit,
  segmentedMessage,
  textMessage,
  textSegment,
  type Vault,
  type VaultAttachment,
  type VaultMessage,
  type VaultProject,
  type VaultSession,
} from "./vault.ts";
