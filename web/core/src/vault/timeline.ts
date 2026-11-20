// The timeline (docs/data-model.md 3.5, 8.5): sessions by their original date, newest first, in
// one group per calendar month of the viewer's time zone. Pinned sessions are not moved to the top.
// The month a session falls into can differ between two devices; that is expected (C6).

import { compareIds, compareNewestFirst } from "./order.ts";

/** What the timeline looks at in a session. `created_at` is the ORIGINAL date of the conversation. */
export interface DatedSession {
  readonly id: string;
  readonly created_at: Date;
}

/** One section of the timeline. */
export interface TimelineGroup<T> {
  /** The header: month and year in the viewer's locale, "November 2026" in en-US. */
  readonly key: string;
  /** Never empty; newest first. */
  readonly sessions: readonly T[];
}

/**
 * data-model.md 7.3, timeline order: `created_at` descending, then id ascending. The id tie-break
 * is what the Apple app lacks: it leaves sessions with one date in no defined order.
 */
export function compareTimelineOrder(a: DatedSession, b: DatedSession): number {
  return compareNewestFirst(a.created_at, b.created_at) || compareIds(a.id, b.id);
}

/**
 * data-model.md 8.5: the sessions sorted by `created_at` descending and cut into groups wherever
 * the month of the date changes. `locale` and `timeZone` are the viewer's ("en-US" and "UTC" give
 * the vectors of 9.2). The array handed in is not changed; no sessions give no groups.
 *
 * Throws a RangeError when `locale` is no language tag, `timeZone` names no time zone or a
 * `created_at` holds no instant, and a TypeError when locale or time zone is not given: those of
 * the machine are never used in their place.
 */
export function timelineGroups<T extends DatedSession>(
  sessions: readonly T[],
  locale: string,
  timeZone: string,
): TimelineGroup<T>[] {
  if (typeof locale !== "string") throw new TypeError("timelineGroups needs a locale.");
  if (typeof timeZone !== "string") throw new TypeError("timelineGroups needs a time zone.");
  const fmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone });
  // The sort printed in 8.5 ends in `a.id < b.id ? -1 : 1` and so never answers 0; see projects.ts.
  const sorted = [...sessions].sort(compareTimelineOrder);
  const groups: { key: string; sessions: T[] }[] = [];
  for (const s of sorted) {
    const key = fmt.format(s.created_at);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.sessions.push(s);
    else groups.push({ key, sessions: [s] });
  }
  return groups;
}

/** data-model.md 8.5: the count in a timeline header, "1 session", otherwise "N sessions". */
export function sessionCountLabel(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}
