// The shared pure functions of the vault (docs/data-model.md section 8), with the list rules of
// section 3 they rest on, and the entry point for files. They work on the vault model of
// ../interchange/vault.ts and on anything else that has the same fields, such as a database row.
//
//   openFile              bytes and a file name -> the interchange reader or the transcript importer
//   createSessions        parser results -> sessions (8.6, with the batch rule B7)
//   addParsedSessions     the same, added to a vault
//   contextPackMarkdown   a session as Markdown for another model (8.3)
//   listSessions          filter, search and list order (3.4, 3.6, 7.3)
//   timelineGroups        sessions by month of their original date (8.5)
//   libraryCounts         the numbers and lists of the sidebar (3.4, 7.3)
//   parseTags, projectComparator, buildSearchText, prepareQuery, ...   the small rules of 8.1 to 8.4
//   composedForm          normalize("NFC") in bounded time, which 8.1 and 8.4 rest on
//
// Everything is a pure function: the current time, new ids, the locale and the time zone are
// arguments. Nothing here reads a clock, a random source or a setting of the machine.

export { composedForm } from "./compose.ts";
export {
  type ContextPackMessage,
  type ContextPackOptions,
  type ContextPackSession,
  type ContextPackSource,
  contextPackMarkdown,
  sessionContextPack,
} from "./context-pack.ts";
export {
  type AddedSessions,
  addParsedSessions,
  createSession,
  createSessions,
  type NewSessionContext,
} from "./create-session.ts";
export {
  compareListOrder,
  type FilterableSession,
  filterPredicate,
  type LibraryCounts,
  type ListedSession,
  libraryCounts,
  listSessions,
  matchesFilter,
  type ProjectCount,
  type SessionFilter,
  selectSessions,
  type TagCount,
} from "./lists.ts";
export {
  type OpenedFile,
  type OpenedInterchange,
  type OpenedTranscript,
  type OpenFileOptions,
  openFile,
} from "./open-file.ts";
export { compareCodePoints, compareIds } from "./order.ts";
export {
  checkProjectName,
  type NamedProject,
  type ProjectNameCheck,
  projectComparator,
  projectNameKey,
  sortProjects,
} from "./projects.ts";
export {
  buildSearchText,
  matchesSearch,
  normalizeForSearch,
  prepareQuery,
  type SearchableSession,
  searchSessions,
} from "./search.ts";
export { formatTags, parseTags, tagList } from "./tags.ts";
export {
  compareTimelineOrder,
  type DatedSession,
  sessionCountLabel,
  type TimelineGroup,
  timelineGroups,
} from "./timeline.ts";
