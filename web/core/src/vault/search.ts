// Search (docs/data-model.md 3.6, 8.1): a substring test over title, summary and tags, without
// regard to letter case. Message text, model, link, provider and project name are not searched.
// The normalisation is done here, never in SQL, so that server, browser and tests agree (C5).
//
// Every function returns what the function of that name printed in 8.1 returns. Two of them do
// less work than the printed ones on input built to be slow: see composedForm and matchesSearch.

import { composedForm } from "../interchange/compose.ts";

/** What search looks at in a session. */
export interface SearchableSession {
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
}

/** data-model.md 8.1: composed form, then lower case. Applied to the stored text and to the query. */
export function normalizeForSearch(s: string): string {
  return composedForm(s).toLowerCase();
}

/**
 * data-model.md 8.1: the value of `sessions.search_text`. Recompute it whenever title, summary or
 * tags change. The fields are joined by a line feed, which a prepared query cannot contain, so a
 * match never spans two fields.
 */
export function buildSearchText(s: SearchableSession): string {
  return [s.title, s.summary, ...s.tags].map(normalizeForSearch).join("\n");
}

/**
 * data-model.md 8.1: the query as it is compared. Line breaks become spaces and the ends are
 * trimmed (B4: the Apple app does not trim). The empty result means "no search".
 */
export function prepareQuery(raw: string): string {
  return normalizeForSearch(raw.replace(/[\r\n]+/g, " ").trim());
}

/** Up to this length the platform's own search is used: its worst case is text length times this. */
const LONGEST_PLAIN_QUERY = 64;

/**
 * Whether `text` holds `query`, as `text.includes(query)` answers, by the method of Knuth, Morris
 * and Pratt: the work is the sum of the two lengths. The platform's search can need their product
 * (measured: a query of 100,000 characters in 2,000,000 characters of text, 31 s).
 */
function includesLongQuery(text: string, query: string): boolean {
  // fallback[i]: the length of the longest proper prefix of the query that ends at its place i.
  const fallback = new Int32Array(query.length);
  let matched = 0;
  for (let i = 1; i < query.length; i++) {
    const unit = query.charCodeAt(i);
    while (matched > 0 && unit !== query.charCodeAt(matched)) matched = fallback[matched - 1] ?? 0;
    if (unit === query.charCodeAt(matched)) matched += 1;
    fallback[i] = matched;
  }
  matched = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    while (matched > 0 && unit !== query.charCodeAt(matched)) matched = fallback[matched - 1] ?? 0;
    if (unit === query.charCodeAt(matched)) matched += 1;
    if (matched === query.length) return true;
  }
  return false;
}

/** data-model.md 8.1: whether a `search_text` holds a prepared query; "" matches everything. */
export function matchesSearch(searchText: string, preparedQuery: string): boolean {
  if (preparedQuery === "") return true;
  if (preparedQuery.length <= LONGEST_PLAIN_QUERY) return searchText.includes(preparedQuery);
  return includesLongQuery(searchText, preparedQuery);
}

/**
 * The search of 3.6 on sessions held in memory: those that match the raw query as typed, in the
 * order given. The query is prepared once.
 */
export function searchSessions<T extends SearchableSession>(sessions: readonly T[], rawQuery: string): T[] {
  const query = prepareQuery(rawQuery);
  if (query === "") return [...sessions];
  return sessions.filter((session) => matchesSearch(buildSearchText(session), query));
}
