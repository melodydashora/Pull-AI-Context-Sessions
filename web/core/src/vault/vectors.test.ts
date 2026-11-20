/// <reference types="node" />
// The test vectors of docs/data-model.md 9.2 (lists, filters, search, timeline), on the vault
// obtained by importing docs/example-vault-export.json through the entry point for files.
// "#1" to "#6" are the sessions in file order, as in the document. Expectations are written the
// way the document writes them, so that a row of its tables can be compared at a glance.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyVault, importDocument, type Vault, type VaultSession } from "../interchange/index.ts";
import {
  buildSearchText,
  compareCodePoints,
  formatTags,
  libraryCounts,
  listSessions,
  matchesSearch,
  normalizeForSearch,
  openFile,
  type SessionFilter,
  selectSessions,
  sessionCountLabel,
  sortProjects,
  tagList,
  timelineGroups,
} from "./index.ts";

const DOCS = new URL("../../../docs/", import.meta.url);
const EXAMPLE_BYTES = new Uint8Array(readFileSync(new URL("example-vault-export.json", DOCS)));

function importExample(): Vault {
  const opened = openFile(EXAMPLE_BYTES, "example-vault-export.json");
  if (opened.route !== "interchange") throw new Error("the example did not go to the interchange reader");
  let n = 0;
  const imported = importDocument(emptyVault(), opened.json, {
    now: new Date("2026-11-20T08:00:00.000Z"),
    newId: () => `ffffffff-ffff-4fff-8fff-${String(++n).padStart(12, "0")}`,
  });
  if (!imported.ok) throw new Error("the example was refused");
  return imported.vault;
}

const vault = importExample();

/** Ids of the sessions in file order: position 0 is "#1". */
function fileOrder(): string[] {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(EXAMPLE_BYTES));
  if (typeof parsed !== "object" || parsed === null || !("sessions" in parsed)) {
    throw new Error("the example has no sessions");
  }
  const sessions: unknown = parsed.sessions;
  if (!Array.isArray(sessions)) throw new Error("the sessions of the example are no array");
  return sessions.map((item: unknown) => {
    if (typeof item !== "object" || item === null || !("id" in item) || typeof item.id !== "string") {
      throw new Error("a session of the example has no id");
    }
    return item.id;
  });
}
const FILE_ORDER: readonly string[] = fileOrder();

/** "#2 #5": the sessions by their number in the file, or "none". */
function numbers(sessions: readonly { readonly id: string }[]): string {
  if (sessions.length === 0) return "none";
  return sessions.map((session) => `#${FILE_ORDER.indexOf(session.id) + 1}`).join(" ");
}

function session(number: number): VaultSession {
  const found = vault.sessions.find((candidate) => candidate.id === FILE_ORDER[number - 1]);
  if (found === undefined) throw new Error(`no session #${number}`);
  return found;
}

function list(filter: SessionFilter, query = ""): string {
  return numbers(listSessions(vault.sessions, filter, query));
}

function projectId(name: string): string {
  const project = vault.projects.find((candidate) => candidate.name === name);
  if (project === undefined) throw new Error(`no project ${name}`);
  return project.id;
}

const ALL: SessionFilter = { kind: "all" };

describe("9.1: the example vault the vectors run on", () => {
  it("holds the six sessions of the file, numbered in file order, and three projects", () => {
    expect(FILE_ORDER).toHaveLength(6);
    expect(vault.sessions).toHaveLength(6);
    expect(vault.projects).toHaveLength(3);
    expect([1, 2, 3, 4, 5, 6].map((number) => session(number).title)).toEqual([
      "Truing a bicycle wheel",
      "Tomato blight on the balcony",
      "Sourdough starter schedule",
      "Untitled",
      "Seed order comparison",
      "Caf\u{E9} menu translation",
    ]);
  });
});

describe("9.1: the table of the example file, on the imported vault", () => {
  // #, title, provider, pinned, project, tags, created_at, imported_at, messages, text_bytes.
  const TABLE = [
    [
      1,
      "Truing a bicycle wheel",
      "chatgpt",
      false,
      "Bike workshop",
      "bikes, repair",
      "2026-03-14T09:30:00.000Z",
      "2026-03-15T18:02:11.482Z",
      4,
      166,
    ],
    [
      2,
      "Tomato blight on the balcony",
      "gemini",
      true,
      "Garden",
      "garden",
      "2026-08-02T16:45:00.000Z",
      "2026-08-02T16:45:03.250Z",
      1,
      162,
    ],
    [
      3,
      "Sourdough starter schedule",
      "claude",
      false,
      "none",
      "baking, bread",
      "2026-10-10T08:00:00.000Z",
      "2026-10-10T08:00:00.000Z",
      4,
      283,
    ],
    [
      4,
      "Untitled",
      "other",
      false,
      "none",
      "none",
      "2026-01-05T12:00:00.000Z",
      "2026-01-05T12:00:00.000Z",
      0,
      0,
    ],
    [
      5,
      "Seed order comparison",
      "examplebot",
      false,
      "Garden",
      "garden, shopping",
      "2026-10-31T23:30:00.000Z",
      "2026-11-01T10:00:00.000Z",
      3,
      111,
    ],
    [
      6,
      "Caf\u{E9} menu translation",
      "claude",
      false,
      "none",
      "travel, two words",
      "2025-12-31T23:59:59.000Z",
      "2026-11-01T10:00:00.000Z",
      2,
      59,
    ],
  ] as const;

  it.each(TABLE)(
    "#%i %s",
    (number, title, provider, pinned, project, tags, createdAt, importedAt, messages, bytes) => {
      const stored = session(number);
      const projectName =
        vault.projects.find((candidate) => candidate.id === stored.project_id)?.name ?? "none";
      expect({
        title: stored.title,
        provider: stored.provider,
        pinned: stored.is_pinned,
        project: projectName,
        tags: formatTags(stored.tags) || "none",
        createdAt: stored.created_at.toISOString(),
        importedAt: stored.imported_at.toISOString(),
        messages: stored.message_count,
        bytes: stored.text_bytes,
      }).toEqual({ title, provider, pinned, project, tags, createdAt, importedAt, messages, bytes });
    },
  );

  it("what the file exercises on purpose: a project without sessions, two sessions imported at one instant", () => {
    const counts = libraryCounts(vault, "en");
    expect(counts.projects.find((project) => project.name === "apple pie ideas")?.sessionCount).toBe(0);
    expect(session(5).imported_at.getTime()).toBe(session(6).imported_at.getTime());
    // #3, index 2: text, attachment, text; its flattened text has 57 bytes.
    expect(session(3).messages[2]?.text).toBe("Here is a photo of the jar after six hours.\n\nIs it ready?");
    expect(session(3).messages[2]?.text_bytes).toBe(57);
    // #6: 58 UTF-16 code units, 59 UTF-8 bytes.
    expect(session(6).messages.reduce((sum, message) => sum + message.text.length, 0)).toBe(58);
  });
});

describe("9.2: lists and filters", () => {
  it("All Sessions: #2 #5 #6 #3 #1 #4 (#5 before #6 by the id tie-break)", () => {
    expect(list(ALL)).toBe("#2 #5 #6 #3 #1 #4");
    // The pair the Apple app leaves undefined really has one import time.
    expect(session(5).imported_at.getTime()).toBe(session(6).imported_at.getTime());
  });

  it("the order does not depend on the order the vault holds the sessions in", () => {
    const reversed = [...vault.sessions].reverse();
    expect(numbers(listSessions(reversed, ALL))).toBe("#2 #5 #6 #3 #1 #4");
    const rotated = [...vault.sessions.slice(3), ...vault.sessions.slice(0, 3)];
    expect(numbers(listSessions(rotated, ALL))).toBe("#2 #5 #6 #3 #1 #4");
  });

  it("Pinned: #2", () => {
    expect(list({ kind: "pinned" })).toBe("#2");
  });

  it("Provider Claude / ChatGPT / Gemini / Other: #6 #3 / #1 / #2 / #5 #4", () => {
    expect(list({ kind: "provider", provider: "claude" })).toBe("#6 #3");
    expect(list({ kind: "provider", provider: "chatgpt" })).toBe("#1");
    expect(list({ kind: "provider", provider: "gemini" })).toBe("#2");
    // #5 has the unknown provider "examplebot": it is kept as written and listed under Other.
    expect(session(5).provider).toBe("examplebot");
    expect(list({ kind: "provider", provider: "other" })).toBe("#5 #4");
  });

  it("Project Bike workshop / Garden / apple pie ideas: #1 / #2 #5 / none", () => {
    expect(list({ kind: "project", projectId: projectId("Bike workshop") })).toBe("#1");
    expect(list({ kind: "project", projectId: projectId("Garden") })).toBe("#2 #5");
    expect(list({ kind: "project", projectId: projectId("apple pie ideas") })).toBe("none");
  });

  it("Tag list: baking, bikes, bread, garden, repair, shopping, travel, two words", () => {
    const expected = ["baking", "bikes", "bread", "garden", "repair", "shopping", "travel", "two words"];
    expect(tagList(vault.sessions)).toEqual(expected);
    expect(libraryCounts(vault, "en").tags.map((entry) => entry.tag)).toEqual(expected);
  });

  it("Tag garden: #2 #5", () => {
    expect(list({ kind: "tag", tag: "garden" })).toBe("#2 #5");
  });

  it("Project order, web (8.4): apple pie ideas, Bike workshop, Garden", () => {
    const expected = ["apple pie ideas", "Bike workshop", "Garden"];
    expect(sortProjects(vault.projects, "en").map((project) => project.name)).toEqual(expected);
    expect(libraryCounts(vault, "en").projects.map((project) => project.name)).toEqual(expected);
  });

  it("Project order, Apple today (code points), is the other one: Bike workshop, Garden, apple pie ideas", () => {
    // B5: a defect that is not built. The row is here to show that the two orders really differ
    // on this vault, and that plain code-point order is what the document says the Apple app has.
    const names = vault.projects.map((project) => project.name);
    expect([...names].sort(compareCodePoints)).toEqual(["Bike workshop", "Garden", "apple pie ideas"]);
  });

  it("Row label counts: 4, 1, 4, 0, 3, 2", () => {
    expect([1, 2, 3, 4, 5, 6].map((number) => session(number).message_count)).toEqual([4, 1, 4, 0, 3, 2]);
    expect([1, 2, 3, 4, 5, 6].map((number) => session(number).messages.length)).toEqual([4, 1, 4, 0, 3, 2]);
  });

  it("search_text of #2", () => {
    expect(buildSearchText(session(2))).toBe("tomato blight on the balcony\n\ngarden");
  });

  it("search_text of #6", () => {
    expect(buildSearchText(session(6))).toBe(
      "caf\u{E9} menu translation\nmenu terms for a bicycle caf\u{E9}.\ntravel\ntwo words",
    );
  });

  it("the badges of the sidebar: 6 sessions, 1 pinned, and 1, 2 and 0 sessions in the projects (3.4)", () => {
    const counts = libraryCounts(vault, "en");
    expect(counts.all).toBe(6);
    expect(counts.pinned).toBe(1);
    expect(counts.projects.map((project) => [project.name, project.sessionCount])).toEqual([
      ["apple pie ideas", 0],
      ["Bike workshop", 1],
      ["Garden", 2],
    ]);
    expect(counts.tags.find((entry) => entry.tag === "garden")?.sessionCount).toBe(2);
  });
});

describe("9.2: search within All Sessions, the column 'Web (query trimmed)'", () => {
  it.each([
    ["bicycle", "#6 #1"],
    ["BREAD", "#3"],
    ["cafe", "none"],
    ["caf\u{E9}", "#6"],
    ["CAF\u{C9}", "#6"],
    ["cafe\u{301}", "#6"],
    ["garden", "#2 #5"],
    ["wo wo", "#6"],
    ["quarter", "#1"],
    ["spoke", "none"],
    ["claude", "none"],
    ["example", "none"],
    ["untitled", "#4"],
    [" ", "#2 #5 #6 #3 #1 #4"],
    [" garden ", "#2 #5"],
  ])("%j finds %s", (query, expected) => {
    expect(list(ALL, query)).toBe(expected);
  });

  it("'garden' while the Pinned filter is active: #2", () => {
    expect(list({ kind: "pinned" }, "garden")).toBe("#2");
  });

  it("what is not searched really is there: 'spoke' in a message, 'claude' and 'example' in provider, model and link", () => {
    expect(session(1).messages.some((message) => message.text.includes("spoke"))).toBe(true);
    expect(session(3).provider).toBe("claude");
    expect(session(3).model).toBe("claude-opus-5");
    expect(session(1).model).toContain("example");
    expect(session(1).source_url).toContain("example");
  });

  it("the two rows where the web differs from the Apple column differ only by the trimming (B4)", () => {
    // Not built: the Apple app compares the query untrimmed. Done here by hand on the same search
    // text, it gives the Apple column of the document for both rows.
    const untrimmed = (raw: string): string =>
      numbers(
        listSessions(vault.sessions, ALL).filter((candidate) =>
          matchesSearch(buildSearchText(candidate), normalizeForSearch(raw)),
        ),
      );
    expect(untrimmed(" ")).toBe("#2 #5 #6 #3 #1");
    expect(untrimmed(" garden ")).toBe("none");
    // #4 is the one session without a space in title, summary or tags.
    expect(buildSearchText(session(4))).toBe("untitled\n");
  });
});

describe("9.2: timeline (en-US month names)", () => {
  function timeline(timeZone: string): string {
    const groups = timelineGroups(selectSessions(vault.sessions, { kind: "timeline" }), "en-US", timeZone);
    return groups
      .map(
        (group) => `${group.key} (${sessionCountLabel(group.sessions.length)}: ${numbers(group.sessions)})`,
      )
      .join(", ");
  }

  it("UTC", () => {
    expect(timeline("UTC")).toBe(
      "October 2026 (2 sessions: #5 #3), August 2026 (1 session: #2), March 2026 (1 session: #1), " +
        "January 2026 (1 session: #4), December 2025 (1 session: #6)",
    );
  });

  it("Europe/Berlin", () => {
    expect(timeline("Europe/Berlin")).toBe(
      "November 2026 (1 session: #5), October 2026 (1 session: #3), August 2026 (1 session: #2), " +
        "March 2026 (1 session: #1), January 2026 (2 sessions: #4 #6)",
    );
  });

  it("the pinned session is not moved to the top (3.5)", () => {
    const first = timelineGroups(vault.sessions, "en-US", "UTC")[0];
    expect(first?.sessions[0]?.is_pinned).toBe(false);
    expect(session(2).is_pinned).toBe(true);
  });

  it("the two sessions at the month and year boundary are #5 and #6 (9.1)", () => {
    expect(session(5).created_at.toISOString()).toBe("2026-10-31T23:30:00.000Z");
    expect(session(6).created_at.toISOString()).toBe("2025-12-31T23:59:59.000Z");
  });
});
