// docs/corrections.md section 2, as far as it speaks of the vault functions: G1 for the write path
// of this folder (createSessions), point 14 (how a stored provider behaves: the context pack of
// 8.3 against the list filter of 7.3) and point 15 (the signatures of 8.3 and 8.5 take readonly
// arrays). Inputs and expected values are taken from the words of the rules.
//
// The context packs of 9.3 (sizes and SHA-256) are pinned in context-pack.test.ts and the vectors
// of 9.2 in vectors.test.ts; both are unchanged by these points.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { ParsedSession } from "../import/index.ts";
import {
  checkVault,
  documentText,
  emptyVault,
  exportDocument,
  importDocument,
  KNOWN_PROVIDERS,
  normaliseSession,
  normalizeOpen,
  readDocument,
  type Vault,
  type VaultSession,
  webGenerator,
} from "../interchange/index.ts";
import {
  addParsedSessions,
  type ContextPackMessage,
  type ContextPackSession,
  contextPackMarkdown,
  createSessions,
  type DatedSession,
  formatTags,
  listSessions,
  matchesFilter,
  type NewSessionContext,
  searchSessions,
  sessionContextPack,
  sortProjects,
  tagList,
  timelineGroups,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

/** Characters by code point: the sources of this folder are plain ASCII. */
const cp = (...points: number[]): string => String.fromCodePoint(...points);
const NBSP = cp(0xa0);
const NOW = new Date("2026-11-20T08:00:00.000Z");
const UTC = { timeZone: "UTC" };

function context(): NewSessionContext {
  let n = 0;
  return { now: NOW, newId: () => `eeeeeeee-eeee-4eee-8eee-${String(++n).padStart(12, "0")}` };
}

/** A parser result as no importer returns it: the types are the importer's, the values are not. */
function foreign(fields: {
  title?: string;
  provider?: string;
  tags?: readonly string[];
  messages?: readonly { role: string; text: string }[];
}): ParsedSession {
  const candidate: unknown = {
    title: "Rose pruning plan",
    provider: "gemini",
    model: "",
    sourceUrl: "",
    createdAt: null,
    summary: "",
    tags: [],
    messages: [
      { role: "user", text: "When should I prune roses?" },
      { role: "assistant", text: "In late winter." },
    ],
    ...fields,
  };
  if (!isParsedShape(candidate)) throw new Error("not the shape of a parser result");
  return candidate;
}
function isParsedShape(value: unknown): value is ParsedSession {
  return typeof value === "object" && value !== null && "title" in value && "messages" in value;
}

function interchangeFile(provider: string): unknown {
  return {
    format: "sessionvault-interchange",
    version: 1,
    kind: "vault",
    exported_at: "2026-06-01T00:00:00.000Z",
    projects: [],
    sessions: [
      {
        id: "5e550000-0000-4000-8000-000000000001",
        title: "From a file",
        provider,
        created_at: "2026-05-01T10:00:00.000Z",
        imported_at: "2026-05-01T10:00:00.000Z",
        messages: [],
      },
    ],
  };
}

/** The provider each write path of the core stores for a value: all of them, side by side. */
function storedBy(provider: string): { create: string; constructor: string; file: string } {
  const created = createSessions([foreign({ provider })], context())[0];
  const normalised = normaliseSession({
    id: "5e550000-0000-4000-8000-000000000002",
    title: "t",
    provider,
    created_at: NOW,
    imported_at: NOW,
    messages: [],
  });
  const imported = importDocument(emptyVault(), interchangeFile(provider), context());
  if (created === undefined || !normalised.ok || !imported.ok)
    throw new Error(`refused: ${JSON.stringify(provider)}`);
  return {
    create: created.provider,
    constructor: normalised.session.provider,
    file: imported.vault.sessions[0]?.provider ?? "",
  };
}

/** The label the context pack prints for a session: the word after "Origin: ". */
function packLabel(session: ContextPackSession): string {
  const pack = contextPackMarkdown(session, [], UTC);
  const line = pack.split("\n").find((candidate) => candidate.startsWith("Origin: ")) ?? "";
  return line.slice("Origin: ".length, line.indexOf(", saved"));
}

/** The provider filter of the sidebar (7.3) that shows a session: exactly one of the four. */
function filterOf(session: VaultSession): string {
  const hits = KNOWN_PROVIDERS.filter((provider) => matchesFilter(session, { kind: "provider", provider }));
  expect(hits.length).toBe(1);
  return hits[0] ?? "";
}

const LABELS: Readonly<Record<string, string>> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  other: "Other",
};

// ---------------------------------------------------------------------------------------------
// G1, for the write path of this folder
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, G1: what createSessions makes is in the form the reader produces", () => {
  const dirty = (): ParsedSession[] => [
    foreign({
      title: `Tomato${cp(0)} blight`,
      provider: " Claude\t",
      tags: ["Garden", " b ,C", "#x", "garden", "# #y"],
      messages: [
        { role: "USER", text: "one\r\ntwo" },
        { role: " Tool ", text: `half ${cp(0xd83d)}` },
        { role: "", text: "x" },
      ],
    }),
    foreign({ provider: "", tags: [" "], messages: [{ role: "Assistant\n", text: "a\rb" }] }),
  ];

  it("the session is what the one normalising constructor gives, and normalising it again changes nothing", () => {
    const sessions = createSessions(dirty(), context());
    expect(sessions.map((s) => s.provider)).toEqual(["claude", "other"]);
    expect(sessions[0]?.title).toBe("Tomato blight");
    expect(sessions[0]?.tags).toEqual(["garden", "b", "c", "x", "y"]);
    expect(sessions[0]?.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "one\ntwo"],
      ["Tool", `half ${cp(0xfffd)}`],
      ["unknown", "x"],
    ]);
    expect(sessions[1]?.tags).toEqual([]);
    expect(sessions[1]?.messages.map((m) => [m.role, m.text])).toEqual([["assistant", "a\nb"]]);
    for (const session of sessions) {
      const again = normaliseSession(session);
      if (!again.ok) throw new Error("a created session was refused");
      expect(again.repairs.total).toBe(0);
      expect(again.warnings.total).toBe(0);
      expect(again.session).toEqual(session);
    }
  });

  it("a second import of the vault's own export reports every session as unchanged, and reading it repairs nothing", () => {
    const { vault } = addParsedSessions(emptyVault(), dirty(), context());
    expect(checkVault(vault).problems.items).toEqual([]);
    const exported = exportDocument(
      vault,
      { kind: "vault" },
      { now: NOW, generator: webGenerator("0.0.0-test") },
      { includeBytes: true },
    );
    if (!exported.ok) throw new Error("the vault cannot be exported");
    expect(exported.warnings.total).toBe(0);
    const text = documentText(exported.doc);
    if (text === null) throw new Error("the export has no text");
    const read = readDocument(text);
    expect(read.ok && read.repairs.total).toBe(0);
    const again = importDocument(vault, text, context());
    if (!again.ok) throw new Error("the export was not imported");
    expect(again.report.sessions.map((entry) => entry.outcome)).toEqual(["unchanged", "unchanged"]);
    expect(again.report.repairs.total).toBe(0);
    again.vault.sessions.forEach((stored, i) => {
      expect(stored).toBe(vault.sessions[i]);
    });
  });

  it("G2: a provider or a role of more than 200 characters is refused, before any trimming", () => {
    expect(createSessions([foreign({ provider: "p".repeat(200) })], context())[0]?.provider).toBe(
      "p".repeat(200),
    );
    expect(() => createSessions([foreign({ provider: "p".repeat(201) })], context())).toThrow(RangeError);
    // 201 characters of which 200 are blanks: the limit is checked before the trim.
    expect(() => createSessions([foreign({ provider: `${" ".repeat(200)}x` })], context())).toThrow(
      RangeError,
    );
    expect(() =>
      createSessions([foreign({ messages: [{ role: "r".repeat(201), text: "t" }] })], context()),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 14
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 14: how a stored provider behaves (8.3 against 7.3)", () => {
  /** What G2 trims: U+0020 and U+0009 to U+000D. */
  const G2_BLANKS = [" ", "\t", "\n", cp(0x0b), cp(0x0c), "\r"];

  it("a stored `Claude` cannot exist: every write path stores the known lower-case value", () => {
    const spellings: [string, string][] = [
      ["Claude", "claude"],
      ["CLAUDE", "claude"],
      ["cLaUdE", "claude"],
      [" Claude", "claude"],
      ["Claude\n", "claude"],
      [`\t\r${cp(0x0b)}${cp(0x0c)} claude \n`, "claude"],
      ["ChatGPT", "chatgpt"],
      ["CHATGPT ", "chatgpt"],
      ["Gemini", "gemini"],
      ["Other", "other"],
      ["OTHER", "other"],
      ["", "other"],
      [" \t\n", "other"],
    ];
    for (const [written, stored] of spellings) {
      expect(storedBy(written), JSON.stringify(written)).toEqual({
        create: stored,
        constructor: stored,
        file: stored,
      });
    }
  });

  it("so the context pack and the list filter agree, for every value the write paths store", () => {
    const pad = fc.array(fc.constantFrom(...G2_BLANKS), { maxLength: 3 }).map((parts) => parts.join(""));
    const anyCase = (word: string) =>
      fc
        .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
        .map((flags) => [...word].map((ch, i) => (flags[i] ? ch.toUpperCase() : ch)).join(""));
    const core = fc.oneof(
      ...KNOWN_PROVIDERS.map(anyCase),
      fc.constantFrom("", "copilot", "Claude 3", "claudes", "le chat", "ExampleBot", "CLAUDE-2", "c laude"),
    );
    const seen = new Set<string>();
    fc.assert(
      fc.property(pad, core, pad, (before, word, after) => {
        const written = before + word + after;
        const stored = storedBy(written);
        expect(stored.create).toBe(stored.file);
        expect(stored.constructor).toBe(stored.file);
        const session = createSessions([foreign({ provider: written })], context())[0];
        if (session === undefined) throw new Error("no session");
        // No stored value differs from a known value by letter case or by the blanks G2 trims.
        expect(session.provider).toBe(normalizeOpen(session.provider, KNOWN_PROVIDERS, "other"));
        // The filter that lists the session and the label its context pack prints are the same provider.
        const filter = filterOf(session);
        expect(packLabel(session)).toBe(LABELS[filter]);
        expect(sessionContextPack(session, UTC).split("\n")[2]).toMatch(
          new RegExp(`^Origin: ${LABELS[filter]}, saved `),
        );
        seen.add(filter);
      }),
      { numRuns: 400, seed: 20261120 },
    );
    expect([...seen].sort()).toEqual(["chatgpt", "claude", "gemini", "other"]);
  });

  it("the list filter compares the stored value exactly", () => {
    const stored = (provider: string): VaultSession => {
      const session = createSessions([foreign({})], context())[0];
      if (session === undefined) throw new Error("no session");
      // A value no write path of the core stores, as a vault built by other means could hold it.
      return { ...session, provider };
    };
    const shown = (provider: string): string => filterOf(stored(provider));
    expect(shown("claude")).toBe("claude");
    expect(shown("chatgpt")).toBe("chatgpt");
    expect(shown("gemini")).toBe("gemini");
    expect(shown("other")).toBe("other");
    // Exactly: no fold, no trim. What is none of the three names is under "Other" (6.2).
    expect(shown("Claude")).toBe("other");
    expect(shown("claude ")).toBe("other");
    expect(shown("CHATGPT")).toBe("other");
    expect(shown("copilot")).toBe("other");
    expect(shown("")).toBe("other");
    // And checkVault says that such a vault is not in the stored form (G1).
    const byHand: Vault = { projects: [], sessions: [stored("Claude")], blobs: new Map() };
    expect(checkVault(byHand).ok).toBe(false);
  });

  it("the tolerance inside contextPackMarkdown stays: it is a pure function that can be called with foreign values", () => {
    const session = (provider: string): ContextPackSession => ({
      title: "t",
      provider,
      model: "",
      source_url: "",
      summary: "",
      tags: [],
      created_at: new Date("2026-03-14T09:30:00.000Z"),
    });
    expect(packLabel(session("Claude"))).toBe("Claude");
    expect(packLabel(session("  CLAUDE\n"))).toBe("Claude");
    expect(packLabel(session("chatGPT"))).toBe("ChatGPT");
    expect(packLabel(session(" Gemini "))).toBe("Gemini");
    expect(packLabel(session("OTHER"))).toBe("Other");
    expect(packLabel(session("copilot"))).toBe("Other");
    expect(packLabel(session(""))).toBe("Other");
    expect(contextPackMarkdown(session("Claude"), [], UTC)).toBe(
      contextPackMarkdown(session("claude"), [], UTC),
    );
  });

  it("where the two still differ: a value padded with white space that G2 does not trim (reported as a doubt)", () => {
    // G2 trims six characters; the tolerance of 8.3 trims what trim() removes. U+00A0 is in the
    // second set only: the write paths store the value as written, the filter lists it under
    // "Other", and the pack prints "Claude". Nothing is lost; the label and the filter disagree.
    const written = `${NBSP}Claude`;
    expect(storedBy(written)).toEqual({ create: written, constructor: written, file: written });
    const session = createSessions([foreign({ provider: written })], context())[0];
    if (session === undefined) throw new Error("no session");
    expect(filterOf(session)).toBe("other");
    expect(packLabel(session)).toBe("Claude");
  });
});

// ---------------------------------------------------------------------------------------------
// Point 15
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 15: the signatures of 8.3 and 8.5 take readonly arrays", () => {
  // The compiler is the test here: a `readonly T[]` is not assignable to a `T[]` parameter, so
  // these calls only compile (npx tsc -p core) while the signatures say readonly. The arrays are
  // frozen as well, so a function that wrote to its argument would throw when the test runs.
  const messages: readonly ContextPackMessage[] = Object.freeze([
    Object.freeze({ role: "user", text: "When should I prune roses?" }),
    Object.freeze({ role: "assistant", text: "In late winter." }),
  ]);
  const tags: readonly string[] = Object.freeze(["garden", "roses"]);
  const packSession: ContextPackSession = Object.freeze({
    title: "Rose pruning plan",
    provider: "gemini",
    model: "",
    source_url: "",
    summary: "",
    tags,
    created_at: new Date("2026-03-14T09:30:00.000Z"),
  });

  it("8.3: contextPackMarkdown(session, messages, options) and the tags of the session", () => {
    const pack = contextPackMarkdown(packSession, messages, UTC);
    expect(pack.split("\n").slice(0, 4)).toEqual([
      "# Context pack: Rose pruning plan",
      "",
      "Origin: Gemini, saved Mar 14, 2026",
      "Tags: garden, roses",
    ]);
    // The parameter types themselves, spelled out.
    const second: Parameters<typeof contextPackMarkdown>[1] = messages;
    const sessionTags: Parameters<typeof contextPackMarkdown>[0]["tags"] = tags;
    expect(second).toBe(messages);
    expect(sessionTags).toBe(tags);
    // sessionContextPack sorts a copy: the stored messages keep their order.
    const stored = Object.freeze({
      ...packSession,
      messages: Object.freeze([
        Object.freeze({ role: "assistant", text: "In late winter.", position: 1 }),
        Object.freeze({ role: "user", text: "When should I prune roses?", position: 0 }),
      ]),
    });
    expect(sessionContextPack(stored, UTC)).toBe(pack);
    expect(stored.messages.map((m) => m.position)).toEqual([1, 0]);
  });

  it("8.5: timelineGroups(sessions, locale, timeZone)", () => {
    const sessions: readonly DatedSession[] = Object.freeze([
      Object.freeze({
        id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date("2026-03-14T09:30:00.000Z"),
      }),
      Object.freeze({
        id: "00000000-0000-4000-8000-000000000001",
        created_at: new Date("2026-04-02T09:30:00.000Z"),
      }),
      Object.freeze({
        id: "00000000-0000-4000-8000-000000000003",
        created_at: new Date("2026-03-01T00:00:00.000Z"),
      }),
    ]);
    const first: Parameters<typeof timelineGroups>[0] = sessions;
    expect(first).toBe(sessions);
    const groups = timelineGroups(sessions, "en-US", "UTC");
    expect(groups.map((group) => [group.key, group.sessions.map((s) => s.id.slice(-1))])).toEqual([
      ["April 2026", ["1"]],
      ["March 2026", ["2", "3"]],
    ]);
    // The argument is as it was.
    expect(sessions.map((s) => s.id.slice(-1))).toEqual(["2", "1", "3"]);
  });

  it("the other list functions of section 8 take them too, and none writes to its argument", () => {
    const created = Object.freeze(
      createSessions(
        [foreign({ title: "B", tags: ["roses"] }), foreign({ title: "A", tags: ["garden", "roses"] })],
        context(),
      ),
    );
    const frozen: readonly VaultSession[] = created;
    expect(tagList(frozen)).toEqual(["garden", "roses"]);
    expect(formatTags(tags)).toBe("garden, roses");
    expect(searchSessions(frozen, "ROSES").length).toBe(2);
    expect(listSessions(frozen, { kind: "all" }, "").map((s) => s.title)).toEqual(["B", "A"]);
    const projects: readonly { id: string; name: string }[] = Object.freeze([
      Object.freeze({ id: "aaaaaaaa-0000-4000-8000-000000000002", name: "b" }),
      Object.freeze({ id: "aaaaaaaa-0000-4000-8000-000000000001", name: "A" }),
    ]);
    expect(sortProjects(projects, "en-US").map((p) => p.name)).toEqual(["A", "b"]);
    expect(projects.map((p) => p.name)).toEqual(["b", "A"]);
    expect(frozen.map((s) => s.title)).toEqual(["B", "A"]);
  });
});
