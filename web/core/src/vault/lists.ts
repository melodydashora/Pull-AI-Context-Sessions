// Lists, filters and counts (docs/data-model.md 3.3, 3.4, 7.3): which sessions a list shows, in
// which order, and the numbers of the sidebar. Nothing here reads a message: lists work on the
// fields of the session alone (C4).

import type { KnownProvider } from "../interchange/index.ts";
import { compareCodePoints, compareIds, compareNewestFirst } from "./order.ts";
import { type NamedProject, projectComparator } from "./projects.ts";
import { buildSearchText, matchesSearch, prepareQuery, type SearchableSession } from "./search.ts";

/**
 * data-model.md 3.4: exactly one filter is active; the default is "all". "timeline" removes
 * nothing: it shows every session, grouped (8.5). The sidebar offers all four providers.
 */
export type SessionFilter =
  | { readonly kind: "all" }
  | { readonly kind: "pinned" }
  | { readonly kind: "timeline" }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "provider"; readonly provider: KnownProvider }
  | { readonly kind: "tag"; readonly tag: string };

/** What a filter looks at in a session. */
export interface FilterableSession {
  readonly is_pinned: boolean;
  readonly project_id: string | null;
  readonly provider: string;
  readonly tags: readonly string[];
}

/** What the list order looks at in a session. */
export interface ListedSession {
  readonly id: string;
  readonly is_pinned: boolean;
  readonly imported_at: Date;
}

// data-model.md 6.2: the "Other" filter is "not one of these three", not "equals other".
const NAMED_PROVIDERS: ReadonlySet<string> = new Set(["claude", "chatgpt", "gemini"]);

/** The test of a filter, prepared once for many sessions. */
export function filterPredicate(filter: SessionFilter): (session: FilterableSession) => boolean {
  switch (filter.kind) {
    case "all":
    case "timeline":
      return () => true;
    case "pinned":
      return (session) => session.is_pinned;
    case "project": {
      // 6.1: ids are compared in their canonical lower-case form.
      const projectId = filter.projectId.toLowerCase();
      return (session) => session.project_id === projectId;
    }
    case "provider": {
      // The stored value is compared exactly, as in the SQL of 7.3 and in the Apple model (2.3).
      // 8.3 folds case for the label of the context pack; values the reader stored never differ.
      const provider = filter.provider;
      if (provider === "other") return (session) => !NAMED_PROVIDERS.has(session.provider);
      return (session) => session.provider === provider;
    }
    case "tag": {
      // 3.2: exact string equality, without the "#" that rows display.
      const tag = filter.tag;
      return (session) => session.tags.includes(tag);
    }
  }
}

/** data-model.md 3.4: whether the filter shows the session. */
export function matchesFilter(session: FilterableSession, filter: SessionFilter): boolean {
  return filterPredicate(filter)(session);
}

/**
 * data-model.md 7.3: the order of every list except the timeline: pinned before unpinned, then
 * `imported_at` descending, then id ascending. The id tie-break is what the Apple app lacks.
 */
export function compareListOrder(a: ListedSession, b: ListedSession): number {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
  return compareNewestFirst(a.imported_at, b.imported_at) || compareIds(a.id, b.id);
}

/**
 * data-model.md 3.4, 3.6: the sessions the active filter shows and, inside those, the ones the
 * search finds. `rawQuery` is the search field as typed; "" or white space means no search (B4).
 * The order is that of the array handed in: sort with compareListOrder, or group with
 * timelineGroups.
 */
export function selectSessions<T extends FilterableSession & SearchableSession>(
  sessions: readonly T[],
  filter: SessionFilter,
  rawQuery = "",
): T[] {
  const shown = filterPredicate(filter);
  const query = prepareQuery(rawQuery);
  return sessions.filter(
    (session) => shown(session) && (query === "" || matchesSearch(buildSearchText(session), query)),
  );
}

/**
 * data-model.md 3.4: a list as it is shown: filtered, searched, and in list order. For the
 * timeline hand the result of selectSessions to timelineGroups instead.
 */
export function listSessions<T extends FilterableSession & SearchableSession & ListedSession>(
  sessions: readonly T[],
  filter: SessionFilter,
  rawQuery = "",
): T[] {
  return selectSessions(sessions, filter, rawQuery).sort(compareListOrder);
}

/** A project of the sidebar with its badge. */
export interface ProjectCount {
  readonly id: string;
  readonly name: string;
  /** Sessions whose `project_id` is this project (3.4). */
  readonly sessionCount: number;
}

/** A tag of the sidebar. */
export interface TagCount {
  readonly tag: string;
  /** Sessions that carry the tag. */
  readonly sessionCount: number;
}

/** The numbers and lists of the sidebar (data-model.md 3.4, 7.3 "Sidebar"). */
export interface LibraryCounts {
  /** Badge of "All Sessions". */
  readonly all: number;
  /** Badge of "Pinned". */
  readonly pinned: number;
  /** Every project, also one without sessions, in the order of projectComparator (8.4). */
  readonly projects: readonly ProjectCount[];
  /** The distinct tags in code-point order (8.2). */
  readonly tags: readonly TagCount[];
}

/**
 * data-model.md 3.4, 7.3: what the sidebar shows. `locale` orders the projects (8.4): the
 * viewer's locale in the browser, "en" in tests.
 */
export function libraryCounts(
  vault: {
    readonly projects: readonly NamedProject[];
    readonly sessions: readonly FilterableSession[];
  },
  locale: string,
): LibraryCounts {
  let pinned = 0;
  const byProject = new Map<string, number>();
  const byTag = new Map<string, number>();
  for (const session of vault.sessions) {
    if (session.is_pinned) pinned += 1;
    if (session.project_id !== null) {
      byProject.set(session.project_id, (byProject.get(session.project_id) ?? 0) + 1);
    }
    // A session counts once for a tag, also if a vault built by other means lists the tag twice.
    for (const tag of new Set(session.tags)) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
  }
  const projects = [...vault.projects]
    .sort(projectComparator(locale))
    .map((project) => ({ id: project.id, name: project.name, sessionCount: byProject.get(project.id) ?? 0 }));
  const tags = [...byTag.keys()]
    .sort(compareCodePoints)
    .map((tag) => ({ tag, sessionCount: byTag.get(tag) ?? 0 }));
  return { all: vault.sessions.length, pinned, projects, tags };
}
