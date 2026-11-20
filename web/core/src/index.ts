// The shared core of SessionVault for the web.
//
// Everything exported from this package runs unchanged in a browser, in a web worker and on the
// server: no DOM, no Node modules. Every function is pure: the current time, new ids, the locale
// and the time zone are arguments. Three parts (web/HANDOFF.md, phase 1):
//
//   ./import/        the transcript importer (docs/import-rules.md)
//   ./interchange/   the interchange format, version 1, and the vault model (docs/data-model.md 6)
//   ./vault/         the shared functions of the vault (docs/data-model.md 3 and 8)
//
// How a conversation gets into a vault:
//   a file              openFile(bytes, name)   says which of the two it was:
//                         route "interchange":  importDocument(vault, opened.json, ...)
//                         route "transcript":   createSessions(opened.result.sessions, ...)
//   pasted text         importPaste(text, ...)  then createSessions
//   a captured page     importCapture(input)    then createSessions
// How its context gets out again:
//   contextPackMarkdown(session, messages, { timeZone })   the pack to paste into any model
//   exportDocument(vault, scope, ...)                      backup and transfer
//
// Names are those of the three parts, with these exceptions:
//   INTERCHANGE_FORMAT, INTERCHANGE_VERSION   FORMAT_MARKER and FORMAT_VERSION of ./interchange/
//   ParsedJsonObject                          JsonObject of ./import/ (JsonObject is that of ./interchange/)
//   parseTags, projectNameKey                 two parts have them: these are the ones of ./vault/.
//                                             ./interchange/ keeps copies that return the same
//                                             values and take far longer on input built for it.

/** The product name as people see it. */
export const APP_NAME = "SessionVault";

/** What a running copy of the app is: shown on the start page and by the server. */
export interface BuildInfo {
  readonly name: string;
  readonly version: string;
  readonly build: string;
}

/**
 * Describe a build. `version` is the package version; `build` identifies the exact
 * source it was built from (a short commit id, or "dev" when that is unknown).
 */
export function describeBuild(version: string, build: string): BuildInfo {
  return {
    name: APP_NAME,
    version: version.trim() || "0.0.0",
    build: build.trim() || "dev",
  };
}

/** One line for people: "SessionVault 0.1.0 (build abc1234)". */
export function formatBuildLabel(info: BuildInfo): string {
  return `${info.name} ${info.version} (build ${info.build})`;
}

// ---------------------------------------------------------------------------------------------
// The transcript importer: text, files and captured pages to parsed sessions.
// importFile reads transcripts only and answers `interchange` for an interchange file without
// reading it; openFile, further down, is the entry point for any file.
// ---------------------------------------------------------------------------------------------

export {
  type CaptureImportResult,
  type CaptureInput,
  type ChromeStripResult,
  countGraphemes,
  type DecodedText,
  type DisplaySegment,
  type DroppedTurn,
  decodeBytes,
  type FileImportResult,
  type FileNameParts,
  type FileOptions,
  hasFewerGraphemesThan,
  type ImportedResult,
  type ImportFlag,
  type ImportResult,
  type InterchangeResult,
  importCapture,
  importFile,
  importPaste,
  type JsonObject as ParsedJsonObject,
  type LinkResult,
  looksLikeLink,
  looksLikeSignInWall,
  normaliseText,
  type ParsedMessage,
  type ParsedSession,
  type PasteImportResult,
  type PasteOptions,
  type Provider,
  parseChatGPTExport,
  parseText,
  providerForUrl,
  type RejectedResult,
  type RejectReason,
  type Role,
  type RoleMarker,
  roleMarker,
  splitDisplaySegments,
  splitFileName,
  splitLines,
  stripChromeTurns,
  trimFull,
  trimInline,
} from "./import/index.ts";

// ---------------------------------------------------------------------------------------------
// The interchange format, version 1: the types of a file, the reader, the merge into a vault,
// the export, and the in-memory vault they work on.
// ---------------------------------------------------------------------------------------------

export {
  ATTACHMENT_KEYS,
  type AttachmentSegment,
  attachmentKindBehaviour,
  type BundleEntry,
  type CappedList,
  type ConflictPolicy,
  checkVault,
  classifyBundleEntry,
  DEFAULT_LIMITS,
  DOCUMENT_KEYS,
  type DocumentExportContext,
  type DocumentExportOptions,
  type DocumentExportResult,
  type DocumentExportScope,
  type DocumentImportContext,
  type DocumentImportCounts,
  type DocumentImportOptions,
  type DocumentImportReport,
  type DocumentImportResult,
  type DocumentKind,
  type DocumentParts,
  dateToTimestamp,
  decodeBase64,
  documentText,
  documentTextChunks,
  EMPTY_OBJECT,
  emptyVault,
  encodeBase64,
  exportDocument,
  FALLBACK_ATTACHMENT_KIND,
  FALLBACK_PROVIDER,
  FALLBACK_ROLE,
  FORMAT_MARKER as INTERCHANGE_FORMAT,
  FORMAT_VERSION as INTERCHANGE_VERSION,
  fileSystemSafe,
  flattenText,
  formatTimestamp,
  GENERATOR_KEYS,
  type InterchangeAttachment,
  type InterchangeDocument,
  type InterchangeGenerator,
  type InterchangeMessage,
  type InterchangeProject,
  type InterchangeSegment,
  type InterchangeSession,
  importDocument,
  isAttachmentSegment,
  isInterchangeDocument,
  isPlainText,
  isTextSegment,
  type JsonObject,
  type JsonValue,
  jsonEqual,
  KNOWN_ATTACHMENT_KINDS,
  KNOWN_PROVIDERS,
  KNOWN_ROLES,
  KNOWN_SEGMENT_TYPES,
  type KnownAttachmentKind,
  type KnownProvider,
  type KnownRole,
  type KnownSegmentType,
  type Limits,
  MAX_INLINE_BYTES,
  MESSAGE_KEYS,
  type MessageInit,
  makeSession,
  messageSegments,
  type Notice,
  type NoticeCode,
  type NoticeList,
  normaliseTags,
  PROJECT_KEYS,
  type Problem,
  type ProjectMergeResult,
  type ProjectOutcome,
  parseTimestamp,
  providerBehaviour,
  type ReadOptions,
  type ReadResult,
  type ReservedIds,
  type RuleId,
  readDocument,
  roleBehaviour,
  type SchemaKeyword,
  SESSION_KEYS,
  type SegmentBehaviour,
  type SessionInit,
  type SessionMergeResult,
  type SessionOutcome,
  segmentBehaviour,
  segmentedMessage,
  sha256Hex,
  splitDocument,
  suggestedFileName,
  type TextSegment,
  type TimestampReading,
  textMessage,
  textSegment,
  utf8ByteLength,
  type ValidationResult,
  type Vault,
  type VaultAttachment,
  type VaultCheck,
  type VaultMessage,
  type VaultProject,
  type VaultSession,
  validateDocument,
  webGenerator,
} from "./interchange/index.ts";

// ---------------------------------------------------------------------------------------------
// The shared functions of the vault: the entry point for files, sessions from parser results,
// the context pack, lists, filters and counts, search, tags, project names, the timeline.
// ---------------------------------------------------------------------------------------------

export {
  type AddedSessions,
  addParsedSessions,
  buildSearchText,
  type ContextPackMessage,
  type ContextPackOptions,
  type ContextPackSession,
  type ContextPackSource,
  checkProjectName,
  compareCodePoints,
  compareIds,
  compareListOrder,
  compareTimelineOrder,
  composedForm,
  contextPackMarkdown,
  createSession,
  createSessions,
  type DatedSession,
  type FilterableSession,
  filterPredicate,
  formatTags,
  type LibraryCounts,
  type ListedSession,
  libraryCounts,
  listSessions,
  matchesFilter,
  matchesSearch,
  type NamedProject,
  type NewSessionContext,
  normalizeForSearch,
  type OpenedFile,
  type OpenedInterchange,
  type OpenedTranscript,
  type OpenFileOptions,
  openFile,
  type ProjectCount,
  type ProjectNameCheck,
  parseTags,
  prepareQuery,
  projectComparator,
  projectNameKey,
  type SearchableSession,
  type SessionFilter,
  searchSessions,
  selectSessions,
  sessionContextPack,
  sessionCountLabel,
  sortProjects,
  type TagCount,
  type TimelineGroup,
  tagList,
  timelineGroups,
} from "./vault/index.ts";
