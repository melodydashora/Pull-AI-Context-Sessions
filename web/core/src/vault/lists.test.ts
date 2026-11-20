// Lists, filters and counts (docs/data-model.md 3.3, 3.4, 7.3) on an invented vault. The vectors
// of 9.2 on the example file are in vectors.test.ts; this file covers what they do not reach:
// every filter one by one, sessions with one timestamp, an empty vault, and lists of many rows.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { emptyVault, makeSession, textMessage, type VaultSession } from "../interchange/index.ts";
import {
  compareListOrder,
  filterPredicate,
  libraryCounts,
  listSessions,
  matchesFilter,
  type SessionFilter,
  selectSessions,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
const cp = (...points: number[]): string => String.fromCodePoint(...points);

const GARDEN = "aaaaaaaa-0000-4000-8000-0000000000a1";
const BIKES = "aaaaaaaa-0000-4000-8000-0000000000a2";
const EMPTY_PROJECT = "aaaaaaaa-0000-4000-8000-0000000000a3";

const T0 = Date.UTC(2026, 4, 1, 10, 0, 0);

interface Row {
  readonly number: number;
  readonly title?: string;
  readonly summary?: string;
  readonly provider?: string;
  readonly tags?: readonly string[];
  readonly pinned?: boolean;
  readonly project?: string | null;
  /** Milliseconds after T0. */
  readonly imported?: number;
}

function id(number: number): string {
  return `5e550000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function row(input: Row): VaultSession {
  const at = new Date(T0 + (input.imported ?? 0));
  return makeSession({
    id: id(input.number),
    title: input.title ?? `Session ${input.number}`,
    provider: input.provider ?? "claude",
    summary: input.summary ?? "",
    tags: input.tags ?? [],
    is_pinned: input.pinned ?? false,
    project_id: input.project ?? null,
    created_at: at,
    imported_at: at,
    updated_at: at,
    messages: [
      textMessage({
        id: `0e55a9e0-0000-4000-8000-${String(input.number).padStart(12, "0")}`,
        position: 0,
        role: "user",
        text: "hello",
      }),
    ],
  });
}

// Eight sessions. Import times: 1 is the oldest; 5, 6 and 7 share one instant.
const SESSIONS: readonly VaultSession[] = [
  row({ number: 1, imported: 0, provider: "claude", tags: ["garden"], project: GARDEN }),
  row({
    number: 2,
    imported: 1000,
    provider: "chatgpt",
    tags: ["garden", "bikes"],
    project: BIKES,
    pinned: true,
  }),
  row({ number: 3, imported: 2000, provider: "gemini", tags: [], project: null }),
  row({ number: 4, imported: 3000, provider: "other", tags: ["Garden"], project: GARDEN, pinned: true }),
  row({ number: 7, imported: 4000, provider: "examplebot", tags: ["gardening"], project: null }),
  row({ number: 5, imported: 4000, provider: "Claude", tags: ["bikes"], project: BIKES }),
  row({
    number: 6,
    imported: 4000,
    provider: "claude",
    tags: ["garden"],
    project: null,
    title: "Garden shed",
  }),
  row({
    number: 8,
    imported: 5000,
    provider: " gemini",
    tags: [],
    project: null,
    summary: "About the garden.",
  }),
];

function numbers(sessions: readonly { readonly id: string }[]): number[] {
  return sessions.map((session) => Number(session.id.slice(-12)));
}

function list(filter: SessionFilter, query = ""): number[] {
  return numbers(listSessions(SESSIONS, filter, query));
}

const ALL: SessionFilter = { kind: "all" };

describe("3.4 and 7.3: the order of every list except the timeline", () => {
  it("pinned before unpinned, then the newest import first, then the id ascending", () => {
    // Pinned: 4 (3000) before 2 (1000). Unpinned: 8 (5000), then 5, 6, 7 at one instant by id, 3, 1.
    expect(list(ALL)).toEqual([4, 2, 8, 5, 6, 7, 3, 1]);
  });

  it("is the same whatever order the sessions are handed over in: all 40,320 arrangements of the eight", () => {
    const expected = [4, 2, 8, 5, 6, 7, 3, 1];
    const arrangement = [...SESSIONS];
    // Heap's algorithm: every permutation by single exchanges.
    const counters = arrangement.map(() => 0);
    let checked = 1;
    expect(numbers(listSessions(arrangement, ALL))).toEqual(expected);
    let i = 0;
    while (i < arrangement.length) {
      if ((counters[i] ?? 0) < i) {
        const other = i % 2 === 0 ? 0 : (counters[i] ?? 0);
        const held = arrangement[other];
        const moved = arrangement[i];
        if (held === undefined || moved === undefined) throw new Error("the arrangement lost a session");
        arrangement[other] = moved;
        arrangement[i] = held;
        if (numbers(listSessions(arrangement, ALL)).join() !== expected.join()) {
          throw new Error(`another order for the arrangement ${numbers(arrangement).join()}`);
        }
        checked += 1;
        counters[i] = (counters[i] ?? 0) + 1;
        i = 0;
      } else {
        counters[i] = 0;
        i += 1;
      }
    }
    expect(checked).toBe(40_320);
  });

  it("compareListOrder is a total order: 0 only for one and the same place, and consistent in threes", () => {
    const session = fc.record({
      id: fc.constantFrom(id(1), id(2), id(3)),
      is_pinned: fc.boolean(),
      imported_at: fc.constantFrom(0, 1, 2, Number.NaN).map((ms) => new Date(ms)),
    });
    const seen = { equal: 0, byPin: 0, byTime: 0, byId: 0 };
    fc.assert(
      fc.property(session, session, session, (a, b, c) => {
        const ab = compareListOrder(a, b);
        expect(Math.sign(compareListOrder(b, a))).toBe(Math.sign(-ab) === 0 ? 0 : Math.sign(-ab));
        expect(compareListOrder(a, a)).toBe(0);
        // Transitivity.
        if (ab <= 0 && compareListOrder(b, c) <= 0) expect(compareListOrder(a, c)).toBeLessThanOrEqual(0);
        const sameTime = Object.is(a.imported_at.getTime(), b.imported_at.getTime());
        if (ab === 0) {
          expect([a.id, a.is_pinned, sameTime]).toEqual([b.id, b.is_pinned, true]);
          seen.equal += 1;
        } else if (a.is_pinned !== b.is_pinned) seen.byPin += 1;
        else if (!sameTime) seen.byTime += 1;
        else seen.byId += 1;
      }),
      { seed: SEED, numRuns: 5000 },
    );
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(100);
  });

  it("sessions that are equal in everything the order looks at keep the order they came in", () => {
    const twin = (title: string): VaultSession => ({ ...row({ number: 9, imported: 0 }), title });
    const sessions = [twin("first"), twin("second"), twin("third")];
    expect(listSessions(sessions, ALL).map((session) => session.title)).toEqual(["first", "second", "third"]);
    expect(listSessions([...sessions].reverse(), ALL).map((session) => session.title)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("a session whose import date holds no instant lists last among its kind and breaks nothing", () => {
    const broken = { ...row({ number: 9 }), imported_at: new Date(Number.NaN) };
    const pinnedBroken = { ...row({ number: 10, pinned: true }), imported_at: new Date(Number.NaN) };
    expect(numbers(listSessions([broken, ...SESSIONS, pinnedBroken], ALL))).toEqual([
      4, 2, 10, 8, 5, 6, 7, 3, 1, 9,
    ]);
  });

  it("does not change the array it is given", () => {
    const frozen = Object.freeze([...SESSIONS]);
    expect(numbers(listSessions(frozen, ALL))).toEqual([4, 2, 8, 5, 6, 7, 3, 1]);
    expect(numbers(frozen)).toEqual([1, 2, 3, 4, 7, 5, 6, 8]);
  });
});

describe("3.4: the filters, one by one", () => {
  it("all and timeline remove nothing", () => {
    expect(list({ kind: "all" })).toHaveLength(8);
    expect(list({ kind: "timeline" })).toEqual(list({ kind: "all" }));
    expect(numbers(selectSessions(SESSIONS, { kind: "timeline" }))).toEqual([1, 2, 3, 4, 7, 5, 6, 8]);
  });

  it("pinned", () => {
    expect(list({ kind: "pinned" })).toEqual([4, 2]);
  });

  it("project: the sessions whose project it is; a session without project is in none", () => {
    expect(list({ kind: "project", projectId: GARDEN })).toEqual([4, 1]);
    expect(list({ kind: "project", projectId: BIKES })).toEqual([2, 5]);
    expect(list({ kind: "project", projectId: EMPTY_PROJECT })).toEqual([]);
    // 6.1: ids are compared in lower case.
    expect(list({ kind: "project", projectId: GARDEN.toUpperCase() })).toEqual([4, 1]);
  });

  it("provider: the stored value, compared exactly as the query of 7.3 does", () => {
    expect(list({ kind: "provider", provider: "claude" })).toEqual([6, 1]);
    expect(list({ kind: "provider", provider: "chatgpt" })).toEqual([2]);
    expect(list({ kind: "provider", provider: "gemini" })).toEqual([3]);
  });

  it("provider Other: every session that is not one of claude, chatgpt, gemini (6.2)", () => {
    // "other" itself, the unknown "examplebot", and the spellings "Claude" and " gemini" that
    // the reader would never store: all are "not one of the three".
    expect(list({ kind: "provider", provider: "other" })).toEqual([4, 8, 5, 7]);
    // The four provider lists together are the whole vault, each session once.
    const together = [
      ...list({ kind: "provider", provider: "claude" }),
      ...list({ kind: "provider", provider: "chatgpt" }),
      ...list({ kind: "provider", provider: "gemini" }),
      ...list({ kind: "provider", provider: "other" }),
    ];
    expect([...together].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("tag: exact equality with a stored tag, not a part of it, not another case, not with '#'", () => {
    expect(list({ kind: "tag", tag: "garden" })).toEqual([2, 6, 1]);
    expect(list({ kind: "tag", tag: "bikes" })).toEqual([2, 5]);
    expect(list({ kind: "tag", tag: "Garden" })).toEqual([4]);
    expect(list({ kind: "tag", tag: "gardening" })).toEqual([7]);
    expect(list({ kind: "tag", tag: "gard" })).toEqual([]);
    expect(list({ kind: "tag", tag: "#garden" })).toEqual([]);
    expect(list({ kind: "tag", tag: "" })).toEqual([]);
  });

  it("matchesFilter answers for one session what the list shows", () => {
    const filters: SessionFilter[] = [
      { kind: "all" },
      { kind: "pinned" },
      { kind: "timeline" },
      { kind: "project", projectId: GARDEN },
      { kind: "provider", provider: "other" },
      { kind: "provider", provider: "claude" },
      { kind: "tag", tag: "garden" },
    ];
    for (const filter of filters) {
      const shown = new Set(list(filter));
      const test = filterPredicate(filter);
      for (const session of SESSIONS) {
        const number = Number(session.id.slice(-12));
        expect(matchesFilter(session, filter)).toBe(shown.has(number));
        expect(test(session)).toBe(shown.has(number));
      }
    }
  });
});

describe("3.6: search works inside the active filter, and the result is in list order", () => {
  it("finds title, summary and tags within All Sessions", () => {
    // 'garden': tags of 1, 2 and 6, 'Garden' of 4, 'gardening' of 7, the title of 6, the summary of 8.
    expect(list(ALL, "garden")).toEqual([4, 2, 8, 6, 7, 1]);
    expect(list(ALL, "GARDEN SHED")).toEqual([6]);
    expect(list(ALL, "about the")).toEqual([8]);
    expect(list(ALL, "nothing like it")).toEqual([]);
  });

  it("only among the sessions the filter shows", () => {
    expect(list({ kind: "pinned" }, "garden")).toEqual([4, 2]);
    expect(list({ kind: "project", projectId: BIKES }, "garden")).toEqual([2]);
    expect(list({ kind: "provider", provider: "gemini" }, "garden")).toEqual([]);
    expect(list({ kind: "tag", tag: "bikes" }, "garden")).toEqual([2]);
    expect(list({ kind: "timeline" }, "garden")).toEqual([4, 2, 8, 6, 7, 1]);
  });

  it("an empty query, or one of white space, shows what the filter shows (B4)", () => {
    for (const query of ["", " ", "\t\n", cp(0x3000)]) {
      expect(list(ALL, query)).toEqual([4, 2, 8, 5, 6, 7, 3, 1]);
      expect(list({ kind: "pinned" }, query)).toEqual([4, 2]);
    }
  });

  it("selectSessions keeps the order of the array, for the timeline to sort by date", () => {
    expect(numbers(selectSessions(SESSIONS, ALL, "garden"))).toEqual([1, 2, 4, 7, 6, 8]);
    expect(numbers(selectSessions(SESSIONS, { kind: "pinned" }))).toEqual([2, 4]);
  });
});

describe("3.4 and 7.3: the numbers and lists of the sidebar", () => {
  const PROJECTS = [
    { id: BIKES, name: "Bike workshop" },
    { id: EMPTY_PROJECT, name: "apple pie ideas" },
    { id: GARDEN, name: "Garden" },
  ];

  it("badges: all sessions, pinned sessions, and the sessions of each project, also 0", () => {
    const counts = libraryCounts({ projects: PROJECTS, sessions: SESSIONS }, "en");
    expect(counts.all).toBe(8);
    expect(counts.pinned).toBe(2);
    expect(counts.projects).toEqual([
      { id: EMPTY_PROJECT, name: "apple pie ideas", sessionCount: 0 },
      { id: BIKES, name: "Bike workshop", sessionCount: 2 },
      { id: GARDEN, name: "Garden", sessionCount: 2 },
    ]);
  });

  it("the tag list: distinct tags in code-point order, each with its number of sessions", () => {
    const counts = libraryCounts({ projects: PROJECTS, sessions: SESSIONS }, "en");
    expect(counts.tags).toEqual([
      { tag: "Garden", sessionCount: 1 },
      { tag: "bikes", sessionCount: 2 },
      { tag: "garden", sessionCount: 3 },
      { tag: "gardening", sessionCount: 1 },
    ]);
    // Each number is the length of the list the tag filter shows.
    for (const entry of counts.tags)
      expect(list({ kind: "tag", tag: entry.tag })).toHaveLength(entry.sessionCount);
  });

  it("the tag list is in code-point order also where UTF-16 units would say otherwise", () => {
    // U+FF21 comes before U+1F600 by code point; its UTF-16 unit FF21 comes after D83D.
    const wide = `${cp(0xff21)}x`;
    const emoji = `${cp(0x1f600)}x`;
    const tagged = [
      { ...row({ number: 9 }), tags: [emoji, "plain"] },
      { ...row({ number: 10 }), tags: [wide] },
    ];
    expect(libraryCounts({ projects: [], sessions: tagged }, "en").tags.map((entry) => entry.tag)).toEqual([
      "plain",
      wide,
      emoji,
    ]);
  });

  it("an empty vault: zeros and empty lists", () => {
    expect(libraryCounts(emptyVault(), "en")).toEqual({ all: 0, pinned: 0, projects: [], tags: [] });
    expect(listSessions([], ALL)).toEqual([]);
    expect(listSessions([], { kind: "pinned" }, "x")).toEqual([]);
    expect(selectSessions([], { kind: "timeline" })).toEqual([]);
  });

  it("a project without sessions is listed; sessions of a project the vault does not have are not counted anywhere", () => {
    const stray = row({ number: 9, project: "aaaaaaaa-0000-4000-8000-0000000000ff" });
    const counts = libraryCounts({ projects: [{ id: GARDEN, name: "Garden" }], sessions: [stray] }, "en");
    expect(counts.projects).toEqual([{ id: GARDEN, name: "Garden", sessionCount: 0 }]);
    expect(counts.all).toBe(1);
  });

  it("a session counts once for a tag, also when a list built by other means repeats the tag", () => {
    const repeated = { ...row({ number: 9 }), tags: ["a", "a", "b"] };
    expect(libraryCounts({ projects: [], sessions: [repeated] }, "en").tags).toEqual([
      { tag: "a", sessionCount: 1 },
      { tag: "b", sessionCount: 1 },
    ]);
  });
});

describe("C4: lists never read message text", () => {
  it("rows without any messages are enough for every list function", () => {
    // What a list query returns (7.3): the fields of the session, no messages.
    const rows = SESSIONS.map((session) => ({
      id: session.id,
      title: session.title,
      summary: session.summary,
      tags: session.tags,
      provider: session.provider,
      is_pinned: session.is_pinned,
      project_id: session.project_id,
      imported_at: session.imported_at,
    }));
    expect(numbers(listSessions(rows, ALL, "garden"))).toEqual([4, 2, 8, 6, 7, 1]);
    expect(libraryCounts({ projects: [], sessions: rows }, "en").all).toBe(8);
  });

  it("a session whose messages cannot be read is listed all the same", () => {
    const guarded = SESSIONS.map((session) =>
      Object.defineProperty({ ...session }, "messages", {
        get(): never {
          throw new Error("a list read the messages");
        },
      }),
    );
    expect(numbers(listSessions(guarded, ALL, "garden"))).toEqual([4, 2, 8, 6, 7, 1]);
    expect(numbers(listSessions(guarded, { kind: "tag", tag: "bikes" }))).toEqual([2, 5]);
    expect(libraryCounts({ projects: [], sessions: guarded }, "en").pinned).toBe(2);
  });
});

describe("many sessions", () => {
  it("100,000 sessions are filtered, searched, ordered and counted in well under ten seconds", () => {
    const many = Array.from({ length: 100_000 }, (_, index) =>
      row({
        number: index + 1,
        imported: (index * 7919) % 5000,
        pinned: index % 97 === 0,
        tags: [`tag${index % 50}`, "common"],
        provider: index % 3 === 0 ? "claude" : "other",
        title: index % 1000 === 0 ? "Needle in the list" : `Session ${index}`,
      }),
    );
    const started = performance.now();
    const all = listSessions(many, ALL);
    const found = listSessions(many, { kind: "provider", provider: "claude" }, "needle");
    const counts = libraryCounts({ projects: [], sessions: many }, "en");
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(all).toHaveLength(100_000);
    // Pinned first; within each part never an older import before a newer one.
    const firstUnpinned = all.findIndex((session) => !session.is_pinned);
    expect(firstUnpinned).toBe(Math.ceil(100_000 / 97));
    expect(all.slice(firstUnpinned).every((session) => !session.is_pinned)).toBe(true);
    for (let i = 1; i < all.length; i++) {
      const previous = all[i - 1];
      const current = all[i];
      if (previous === undefined || current === undefined) throw new Error("a hole in the list");
      expect(compareListOrder(previous, current)).toBeLessThan(0);
    }
    // Every thousandth session has the title; a third of those is of the provider (index % 3 === 0).
    expect(found).toHaveLength(34);
    expect(counts.tags).toHaveLength(51);
    expect(counts.tags.find((entry) => entry.tag === "common")?.sessionCount).toBe(100_000);
    expect(counts.pinned).toBe(Math.ceil(100_000 / 97));
  });
});
