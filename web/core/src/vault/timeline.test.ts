// The timeline (docs/data-model.md 3.5, 8.5): sessions by their original date, newest first, one
// group per calendar month of the viewer's time zone. The two vectors of 9.2 are in
// vectors.test.ts; here are the verified examples of 3.5 and the boundaries of months and years.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  compareTimelineOrder,
  type DatedSession,
  selectSessions,
  sessionCountLabel,
  timelineGroups,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
const cp = (...points: number[]): string => String.fromCodePoint(...points);

function id(number: number): string {
  return `5e550000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function dated(number: number, iso: string): DatedSession {
  return { id: id(number), created_at: new Date(iso) };
}

/** "November 2026: 3 1 | October 2026: 2": the groups with the numbers of their sessions. */
function shape(sessions: readonly DatedSession[], timeZone: string, locale = "en-US"): string {
  return timelineGroups(sessions, locale, timeZone)
    .map(
      (group) => `${group.key}: ${group.sessions.map((session) => Number(session.id.slice(-12))).join(" ")}`,
    )
    .join(" | ");
}

describe("3.5: the group key is month and year in the viewer's locale and time zone", () => {
  const november = [dated(1, "2026-11-19T12:00:00.000Z")];

  it("the three locales the document observed", () => {
    expect(shape(november, "UTC", "en-US")).toBe("November 2026: 1");
    expect(shape(november, "UTC", "fr-FR")).toBe("novembre 2026: 1");
    expect(shape(november, "UTC", "ja-JP")).toBe(`2026${cp(0x5e74)}11${cp(0x6708)}: 1`);
  });

  it("the instant 2025-12-31T23:59:59Z is December 2025 in Honolulu and January 2026 in Auckland", () => {
    const session = [dated(1, "2025-12-31T23:59:59.000Z")];
    expect(shape(session, "Pacific/Honolulu")).toBe("December 2025: 1");
    expect(shape(session, "Pacific/Auckland")).toBe("January 2026: 1");
    expect(shape(session, "UTC")).toBe("December 2025: 1");
  });

  it("all twelve months have their English names", () => {
    const year = Array.from({ length: 12 }, (_, month) => ({
      id: id(month + 1),
      created_at: new Date(Date.UTC(2026, month, 15, 12)),
    }));
    expect(timelineGroups(year, "en-US", "UTC").map((group) => group.key)).toEqual([
      "December 2026",
      "November 2026",
      "October 2026",
      "September 2026",
      "August 2026",
      "July 2026",
      "June 2026",
      "May 2026",
      "April 2026",
      "March 2026",
      "February 2026",
      "January 2026",
    ]);
  });
});

describe("8.5: boundaries of months and years", () => {
  // The last millisecond of 2025 and the first of 2026, in UTC.
  const turnOfYear = [dated(1, "2025-12-31T23:59:59.999Z"), dated(2, "2026-01-01T00:00:00.000Z")];

  it("one millisecond apart across the year: two groups in UTC", () => {
    expect(shape(turnOfYear, "UTC")).toBe("January 2026: 2 | December 2025: 1");
  });

  it("the same two sessions are one group east of the date line and one group west of it", () => {
    // Kiritimati is 14 hours ahead of UTC, Pago Pago 11 hours behind.
    expect(shape(turnOfYear, "Pacific/Kiritimati")).toBe("January 2026: 2 1");
    expect(shape(turnOfYear, "Pacific/Pago_Pago")).toBe("December 2025: 2 1");
  });

  it("the local midnight decides, also in a zone that is 5 hours 45 minutes ahead", () => {
    // 18:15 UTC is midnight in Kathmandu.
    const sessions = [dated(1, "2026-04-30T18:14:59.999Z"), dated(2, "2026-04-30T18:15:00.000Z")];
    expect(shape(sessions, "Asia/Kathmandu")).toBe("May 2026: 2 | April 2026: 1");
    expect(shape(sessions, "UTC")).toBe("April 2026: 2 1");
  });

  it("the end of February in a leap year and in a common year", () => {
    const leap = [dated(1, "2024-02-29T23:59:59.999Z"), dated(2, "2024-03-01T00:00:00.000Z")];
    expect(shape(leap, "UTC")).toBe("March 2024: 2 | February 2024: 1");
    const common = [dated(1, "2026-02-28T23:59:59.999Z"), dated(2, "2026-03-01T00:00:00.000Z")];
    expect(shape(common, "UTC")).toBe("March 2026: 2 | February 2026: 1");
  });

  it("the hour that summer time skips or repeats does not move a session into another month", () => {
    // Berlin: 31 March 2024 02:00 becomes 03:00; 27 October 2024 03:00 becomes 02:00 again.
    const sessions = [
      dated(1, "2024-03-31T00:59:59.999Z"),
      dated(2, "2024-03-31T01:00:00.000Z"),
      dated(3, "2024-10-27T00:30:00.000Z"),
      dated(4, "2024-10-27T01:30:00.000Z"),
      // Midnight at the start of April in Berlin is 22:00 UTC on 31 March.
      dated(5, "2024-03-31T21:59:59.999Z"),
      dated(6, "2024-03-31T22:00:00.000Z"),
    ];
    expect(shape(sessions, "Europe/Berlin")).toBe("October 2024: 4 3 | April 2024: 6 | March 2024: 5 2 1");
  });

  it("the same month of another year is another group", () => {
    const sessions = [dated(1, "2025-03-10T00:00:00.000Z"), dated(2, "2026-03-10T00:00:00.000Z")];
    expect(shape(sessions, "UTC")).toBe("March 2026: 2 | March 2025: 1");
  });

  it("the first and the last instant a stored session can hold", () => {
    expect(shape([dated(1, "9999-12-31T23:59:59.999Z")], "UTC")).toBe("December 9999: 1");
    expect(shape([dated(1, "1970-01-01T00:00:00.000Z")], "UTC")).toBe("January 1970: 1");
    expect(shape([dated(1, "1970-01-01T00:00:00.000Z")], "America/New_York")).toBe("December 1969: 1");
  });
});

describe("8.5: order", () => {
  it("newest first across groups and within a group", () => {
    const sessions = [
      dated(1, "2026-03-01T00:00:00.000Z"),
      dated(2, "2026-03-31T23:59:59.000Z"),
      dated(3, "2026-02-14T00:00:00.000Z"),
      dated(4, "2026-03-15T00:00:00.000Z"),
    ];
    expect(shape(sessions, "UTC")).toBe("March 2026: 2 4 1 | February 2026: 3");
  });

  it("sessions with one and the same date are ordered by id, whatever order they come in", () => {
    const instant = "2026-06-01T08:00:00.000Z";
    const sessions = [dated(3, instant), dated(1, instant), dated(4, instant), dated(2, instant)];
    expect(shape(sessions, "UTC")).toBe("June 2026: 1 2 3 4");
    expect(shape([...sessions].reverse(), "UTC")).toBe("June 2026: 1 2 3 4");
    expect(
      shape(
        [sessions[1], sessions[3], sessions[0], sessions[2]].flatMap((s) => (s ? [s] : [])),
        "UTC",
      ),
    ).toBe("June 2026: 1 2 3 4");
  });

  it("a pinned session stays where its date puts it (3.5)", () => {
    const sessions = [
      { ...dated(1, "2026-01-10T00:00:00.000Z"), is_pinned: true },
      { ...dated(2, "2026-05-10T00:00:00.000Z"), is_pinned: false },
    ];
    expect(shape(sessions, "UTC")).toBe("May 2026: 2 | January 2026: 1");
  });

  it("compareTimelineOrder is a total order: 0 only for one id at one instant", () => {
    const session = fc.record({
      id: fc.constantFrom(id(1), id(2), id(3)),
      created_at: fc.constantFrom(0, 1, 2).map((ms) => new Date(ms)),
    });
    fc.assert(
      fc.property(session, session, session, (a, b, c) => {
        const ab = compareTimelineOrder(a, b);
        expect(Math.sign(compareTimelineOrder(b, a)) + Math.sign(ab)).toBe(0);
        if (ab === 0) expect([a.id, a.created_at.getTime()]).toEqual([b.id, b.created_at.getTime()]);
        if (ab <= 0 && compareTimelineOrder(b, c) <= 0)
          expect(compareTimelineOrder(a, c)).toBeLessThanOrEqual(0);
      }),
      { seed: SEED, numRuns: 3000 },
    );
    expect(
      compareTimelineOrder(dated(1, "2026-01-02T00:00:00.000Z"), dated(2, "2026-01-01T00:00:00.000Z")),
    ).toBe(-1);
    expect(
      compareTimelineOrder(dated(2, "2026-01-01T00:00:00.000Z"), dated(1, "2026-01-01T00:00:00.000Z")),
    ).toBe(1);
  });
});

describe("8.5: the groups as a whole", () => {
  const ZONES = ["UTC", "Europe/Berlin", "Pacific/Kiritimati", "America/St_Johns"] as const;

  it("every session is in exactly one group, the groups in order are the sorted list, and neighbours differ", () => {
    const sessions = fc.uniqueArray(
      fc.record({
        id: fc.uuid(),
        // Within fourteen months, so that months are shared and boundaries are hit.
        created_at: fc
          .integer({ min: Date.UTC(2025, 10, 1), max: Date.UTC(2027, 0, 1) })
          .map((ms) => new Date(ms)),
      }),
      { maxLength: 30, size: "max", selector: (item) => item.id },
    );
    let shared = 0;
    fc.assert(
      fc.property(sessions, fc.constantFrom(...ZONES), (list, timeZone) => {
        const groups = timelineGroups(list, "en-US", timeZone);
        const flat = groups.flatMap((group) => group.sessions);
        expect(flat).toEqual([...list].sort(compareTimelineOrder));
        const format = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone });
        groups.forEach((group, index) => {
          expect(group.sessions.length).toBeGreaterThan(0);
          for (const session of group.sessions) expect(format.format(session.created_at)).toBe(group.key);
          if (index > 0) expect(groups[index - 1]?.key).not.toBe(group.key);
          if (group.sessions.length > 1) shared += 1;
        });
      }),
      { seed: SEED, numRuns: 1000 },
    );
    expect(shared).toBeGreaterThan(500);
  });

  it("no sessions give no groups", () => {
    expect(timelineGroups([], "en-US", "UTC")).toEqual([]);
  });

  it("keeps the sessions themselves, with everything they carry, and does not change the list", () => {
    const sessions = Object.freeze([
      Object.freeze({ ...dated(1, "2026-01-10T00:00:00.000Z"), title: "older" }),
      Object.freeze({ ...dated(2, "2026-05-10T00:00:00.000Z"), title: "newer" }),
    ]);
    const groups = timelineGroups(sessions, "en-US", "UTC");
    expect(groups[0]?.sessions[0]).toBe(sessions[1]);
    expect(groups[1]?.sessions[0]).toBe(sessions[0]);
    expect(sessions.map((session) => session.title)).toEqual(["older", "newer"]);
  });

  it("3.5 step 1: the timeline shows the filtered and searched list", () => {
    const stored = [
      {
        ...dated(1, "2026-01-10T00:00:00.000Z"),
        title: "Garden",
        summary: "",
        tags: [],
        is_pinned: false,
        project_id: null,
        provider: "claude",
      },
      {
        ...dated(2, "2026-05-10T00:00:00.000Z"),
        title: "Bikes",
        summary: "",
        tags: ["garden"],
        is_pinned: true,
        project_id: null,
        provider: "other",
      },
      {
        ...dated(3, "2026-05-20T00:00:00.000Z"),
        title: "Bread",
        summary: "",
        tags: [],
        is_pinned: false,
        project_id: null,
        provider: "claude",
      },
    ];
    expect(shape(selectSessions(stored, { kind: "timeline" }), "UTC")).toBe(
      "May 2026: 3 2 | January 2026: 1",
    );
    expect(shape(selectSessions(stored, { kind: "timeline" }, "garden"), "UTC")).toBe(
      "May 2026: 2 | January 2026: 1",
    );
    expect(shape(selectSessions(stored, { kind: "provider", provider: "claude" }), "UTC")).toBe(
      "May 2026: 3 | January 2026: 1",
    );
  });

  it("100,000 sessions are grouped in well under ten seconds", () => {
    const many = Array.from({ length: 100_000 }, (_, index) => ({
      id: id(index + 1),
      created_at: new Date(Date.UTC(2020, 0, 1) + ((index * 7919) % 2000) * 86_400_000),
    }));
    const started = performance.now();
    const groups = timelineGroups(many, "en-US", "UTC");
    expect(performance.now() - started).toBeLessThan(10_000);
    // 2,000 days from 1 January 2020 reach into June 2025: 66 months.
    expect(groups).toHaveLength(66);
    expect(groups[0]?.key).toBe("June 2025");
    expect(groups[65]?.key).toBe("January 2020");
    expect(groups.reduce((sum, group) => sum + group.sessions.length, 0)).toBe(100_000);
  });
});

describe("8.5: the count in a group header", () => {
  it.each([
    [1, "1 session"],
    [0, "0 sessions"],
    [2, "2 sessions"],
    [11, "11 sessions"],
    [21, "21 sessions"],
    [1000, "1000 sessions"],
  ])("%i is %j", (count, label) => {
    expect(sessionCountLabel(count)).toBe(label);
  });
});

describe("what timelineGroups refuses", () => {
  const one = [dated(1, "2026-01-10T00:00:00.000Z")];

  it("a time zone or a locale that does not exist: RangeError", () => {
    expect(() => timelineGroups(one, "en-US", "Not/AZone")).toThrow(RangeError);
    expect(() => timelineGroups(one, "en-US", "")).toThrow(RangeError);
    expect(() => timelineGroups(one, "not a locale", "UTC")).toThrow(RangeError);
    // Also when there is nothing to group: a wrong argument is not hidden by an empty list.
    expect(() => timelineGroups([], "en-US", "Not/AZone")).toThrow(RangeError);
  });

  it("no locale or no time zone at all: TypeError, never those of the machine", () => {
    expect(() => Reflect.apply(timelineGroups, undefined, [one, undefined, "UTC"])).toThrow(TypeError);
    expect(() => Reflect.apply(timelineGroups, undefined, [one, "en-US", undefined])).toThrow(TypeError);
    expect(() => Reflect.apply(timelineGroups, undefined, [one, "en-US"])).toThrow(TypeError);
  });

  it("a date that holds no instant: RangeError", () => {
    expect(() => timelineGroups([{ id: id(1), created_at: new Date(Number.NaN) }], "en-US", "UTC")).toThrow(
      RangeError,
    );
  });
});
