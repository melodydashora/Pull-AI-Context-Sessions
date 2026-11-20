/// <reference types="node" />
// Creating sessions from parser results (docs/data-model.md 8.6, with the batch rule B7): field
// by field, then on every session the import fixtures expect, then on parser results no importer
// would return. Whatever goes in, what comes out must be a session the vault can hold (C9) and
// the interchange format can carry unchanged.
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { ParsedMessage, ParsedSession, Provider, Role } from "../import/index.ts";
import {
  checkVault,
  documentText,
  emptyVault,
  exportDocument,
  importDocument,
  normaliseTags,
  readDocument,
  utf8ByteLength,
  type Vault,
  type VaultSession,
  validateDocument,
  webGenerator,
} from "../interchange/index.ts";
import {
  addParsedSessions,
  buildSearchText,
  createSession,
  createSessions,
  listSessions,
  type NewSessionContext,
  timelineGroups,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
const cp = (...points: number[]): string => String.fromCodePoint(...points);

const NOW = new Date("2026-11-20T08:00:00.000Z");

/** Ids "eeeeeeee-...-000000000001", "...002" and so on, in the order they are asked for. */
function context(now: Date = NOW): NewSessionContext & { readonly given: string[] } {
  const given: string[] = [];
  return {
    now,
    given,
    newId: () => {
      const next = `eeeeeeee-eeee-4eee-8eee-${String(given.length + 1).padStart(12, "0")}`;
      given.push(next);
      return next;
    },
  };
}

function parsed(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    title: "Rose pruning plan",
    provider: "gemini",
    model: "",
    sourceUrl: "https://share.example/EXAMPLE-ROSES",
    createdAt: null,
    summary: "",
    tags: [],
    messages: [
      { role: "user", text: "When should I prune roses?" },
      { role: "assistant", text: "In late winter." },
    ],
    ...overrides,
  };
}

/** A parser result as no importer returns it: the types are the importer's, the values are not. */
function foreign(fields: {
  title?: string;
  provider?: string;
  model?: string;
  sourceUrl?: string;
  createdAt?: string | null;
  summary?: string;
  tags?: readonly string[];
  messages?: readonly { role: string; text: string }[];
}): ParsedSession {
  const base = parsed();
  const candidate: unknown = { ...base, ...fields };
  if (!isParsedShape(candidate)) throw new Error("not the shape of a parser result");
  return candidate;
}

// Only the shape is checked: the point of `foreign` is that the strings are arbitrary.
function isParsedShape(value: unknown): value is ParsedSession {
  return typeof value === "object" && value !== null && "title" in value && "messages" in value;
}

function ms(date: Date): number {
  return date.getTime();
}

const GENERATOR = webGenerator("0.0.0-test");

function exported(vault: Vault): string {
  const result = exportDocument(
    vault,
    { kind: "vault" },
    { now: NOW, generator: GENERATOR },
    { includeBytes: true },
  );
  if (!result.ok) throw new Error(`the vault cannot be exported: ${JSON.stringify(result.problems.items)}`);
  expect(result.warnings.total).toBe(0);
  const text = documentText(result.doc);
  if (text === null) throw new Error("the export is too long for one string");
  return text;
}

/** Everything a stored vault must satisfy, checked through the interchange module. */
function expectStorable(vault: Vault): void {
  const check = checkVault(vault);
  expect(check.problems.items).toEqual([]);
  expect(check.ok).toBe(true);
  const text = exported(vault);
  // What the exporter writes needs no repair: strictly valid, and read back without a change.
  const strict = validateDocument(text);
  expect(strict.problems.items).toEqual([]);
  const read = readDocument(text);
  if (!read.ok) throw new Error("the export of the vault was refused");
  expect(read.repairs.items).toEqual([]);
  expect(read.repairs.total).toBe(0);
  // Importing the vault's own export into it changes nothing.
  const again = importDocument(vault, text, {
    now: NOW,
    newId: () => "ffffffff-ffff-4fff-8fff-ffffffffffff",
  });
  if (!again.ok) throw new Error("the export of the vault could not be imported");
  expect(again.report.counts.unchanged).toBe(vault.sessions.length);
  expect(again.report.counts.added + again.report.counts.updated + again.report.counts.kept).toBe(0);
  expect(again.vault.sessions).toEqual(vault.sessions);
}

describe("8.6: one parser result, field by field", () => {
  const ctx = context();
  const session = createSession(parsed(), ctx);

  it("the session: new id, the parser's title, provider and link, no project, not pinned", () => {
    expect(session.id).toBe("eeeeeeee-eeee-4eee-8eee-000000000001");
    expect(session.title).toBe("Rose pruning plan");
    expect(session.provider).toBe("gemini");
    expect(session.source_url).toBe("https://share.example/EXAMPLE-ROSES");
    expect(session.model).toBe("");
    expect(session.summary).toBe("");
    expect(session.tags).toEqual([]);
    expect(session.is_pinned).toBe(false);
    expect(session.project_id).toBeNull();
    expect(session.attachments).toEqual([]);
    expect(Object.keys(session.extra)).toEqual([]);
  });

  it("the three dates are the current time when the source carried none", () => {
    expect(ms(session.created_at)).toBe(ms(NOW));
    expect(ms(session.imported_at)).toBe(ms(NOW));
    expect(ms(session.updated_at)).toBe(ms(NOW));
    // New Date objects: the caller's `now` is not handed on.
    expect(session.imported_at).not.toBe(NOW);
  });

  it("the messages: new ids, positions 0 and 1, role and text of the parser, no segments, no date, no model", () => {
    expect(session.messages).toEqual([
      {
        id: "eeeeeeee-eeee-4eee-8eee-000000000002",
        position: 0,
        role: "user",
        text: "When should I prune roses?",
        segments: null,
        text_bytes: 26,
        model: "",
        created_at: null,
        extra: {},
      },
      {
        id: "eeeeeeee-eeee-4eee-8eee-000000000003",
        position: 1,
        role: "assistant",
        text: "In late winter.",
        segments: null,
        text_bytes: 15,
        model: "",
        created_at: null,
        extra: {},
      },
    ]);
  });

  it("the derived values: message_count, text_bytes, and the search text of 8.1", () => {
    expect(session.message_count).toBe(2);
    expect(session.text_bytes).toBe(41);
    expect(buildSearchText(session)).toBe("rose pruning plan\n");
  });

  it("asks for ids in order: the session, then its messages", () => {
    expect(ctx.given).toHaveLength(3);
    expect(ctx.given[0]).toBe(session.id);
    expect(ctx.given.slice(1)).toEqual(session.messages.map((message) => message.id));
  });

  it("the original date is the parser's when the source carried one", () => {
    const dated = createSession(parsed({ createdAt: "2026-03-14T09:30:00.000Z" }), context());
    expect(dated.created_at.toISOString()).toBe("2026-03-14T09:30:00.000Z");
    expect(ms(dated.imported_at)).toBe(ms(NOW));
    expect(ms(dated.updated_at)).toBe(ms(NOW));
    // Milliseconds are kept (import-rules.md W4).
    expect(
      createSession(parsed({ createdAt: "2025-12-31T23:59:59.999Z" }), context()).created_at.toISOString(),
    ).toBe("2025-12-31T23:59:59.999Z");
  });

  it("text_bytes counts UTF-8 bytes, not UTF-16 units (9.1: 58 units, 59 bytes)", () => {
    const first = `Translate 'soup of the day' for a caf${cp(0xe9)} menu.`;
    const second = "Soupe du jour.";
    const cafe = createSession(
      parsed({
        messages: [
          { role: "user", text: first },
          { role: "assistant", text: second },
        ],
      }),
      context(),
    );
    expect(first.length + second.length).toBe(58);
    expect(cafe.text_bytes).toBe(59);
    expect(cafe.messages.map((message) => message.text_bytes)).toEqual([45, 14]);
    const emoji = createSession(parsed({ messages: [{ role: "user", text: cp(0x1f600) }] }), context());
    expect(emoji.text_bytes).toBe(4);
  });

  it("what a context pack carries besides is taken over: model, summary and tags (import-rules.md W14)", () => {
    // 8.6 itself says model = "", summary = "", tags = []: it was written before a parser set them.
    const pack = createSession(
      parsed({ model: "example-model-1", summary: "Prune in late winter.", tags: ["garden", "roses"] }),
      context(),
    );
    expect(pack.model).toBe("example-model-1");
    expect(pack.summary).toBe("Prune in late winter.");
    expect(pack.tags).toEqual(["garden", "roses"]);
    expect(buildSearchText(pack)).toBe("rose pruning plan\nprune in late winter.\ngarden\nroses");
  });

  it("does not change the parser result, and shares no array with it", () => {
    const frozenMessages = Object.freeze([
      Object.freeze({ role: "user", text: "t" } satisfies ParsedMessage),
    ]);
    const frozenTags = Object.freeze(["a"]);
    const input = Object.freeze(parsed({ messages: frozenMessages, tags: frozenTags }));
    const made = createSession(input, context());
    expect(made.tags).toEqual(["a"]);
    expect(made.tags).not.toBe(frozenTags);
    expect(made.messages).not.toBe(frozenMessages);
  });

  it("createSession is createSessions for a list of one", () => {
    expect(createSession(parsed(), context())).toEqual(createSessions([parsed()], context())[0]);
  });
});

describe("B7: one call is one batch, and the first item of the file lists first", () => {
  const titles = ["first in the file", "second", "third", "fourth"];
  const batch = titles.map((title) => parsed({ title }));
  const sessions = createSessions(batch, context());

  it("item i of n is imported at batch time + (n - 1 - i) milliseconds", () => {
    expect(sessions.map((session) => ms(session.imported_at) - ms(NOW))).toEqual([3, 2, 1, 0]);
  });

  it("the default list shows them in file order (the Apple app shows the last one first)", () => {
    const shuffled = [sessions[2], sessions[0], sessions[3], sessions[1]].flatMap((s) => (s ? [s] : []));
    expect(listSessions(shuffled, { kind: "all" }).map((session) => session.title)).toEqual(titles);
  });

  it("the other two dates follow: updated_at is imported_at, and so is the original date of a source without one", () => {
    for (const session of sessions) {
      expect(ms(session.updated_at)).toBe(ms(session.imported_at));
      expect(ms(session.created_at)).toBe(ms(session.imported_at));
    }
    // So the timeline keeps the file order as well.
    const groups = timelineGroups(sessions, "en-US", "UTC");
    expect(groups.flatMap((group) => group.sessions).map((session) => session.title)).toEqual(titles);
  });

  it("a date from the source stays what it is, whatever the place in the batch", () => {
    const dated = createSessions(
      [
        parsed({ createdAt: "2026-01-01T00:00:00.000Z" }),
        parsed(),
        parsed({ createdAt: "2026-02-02T00:00:00.000Z" }),
      ],
      context(),
    );
    expect(dated.map((session) => session.created_at.toISOString())).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-11-20T08:00:00.001Z",
      "2026-02-02T00:00:00.000Z",
    ]);
    expect(dated.map((session) => ms(session.imported_at) - ms(NOW))).toEqual([2, 1, 0]);
  });

  it("a batch of one is imported at the batch time, and an empty batch gives nothing", () => {
    expect(ms(createSessions([parsed()], context())[0]?.imported_at ?? new Date(0))).toBe(ms(NOW));
    const ctx = context();
    expect(createSessions([], ctx)).toEqual([]);
    expect(ctx.given).toEqual([]);
  });

  it("ids are asked for session by session: a session, its messages, the next session", () => {
    const ctx = context();
    const made = createSessions([parsed(), parsed({ messages: [{ role: "user", text: "only one" }] })], ctx);
    expect(made[0]?.id).toBe(ctx.given[0]);
    expect(made[0]?.messages.map((message) => message.id)).toEqual(ctx.given.slice(1, 3));
    expect(made[1]?.id).toBe(ctx.given[3]);
    expect(made[1]?.messages.map((message) => message.id)).toEqual(ctx.given.slice(4, 5));
    expect(ctx.given).toHaveLength(5);
  });

  it("5,000 conversations of one export keep their order", () => {
    const many = Array.from({ length: 5000 }, (_, index) => parsed({ title: `Conversation ${index}` }));
    const made = createSessions(many, context());
    expect(ms(made[0]?.imported_at ?? new Date(0)) - ms(NOW)).toBe(4999);
    expect(ms(made[4999]?.imported_at ?? new Date(0)) - ms(NOW)).toBe(0);
    const listed = listSessions([...made].reverse(), { kind: "all" });
    expect(listed.map((session) => session.title)).toEqual(many.map((session) => session.title));
  });
});

describe("ids", () => {
  it("are stored in lower case, as 6.1 asks of writers", () => {
    let n = 0;
    const made = createSession(parsed(), {
      now: NOW,
      newId: () => `ABCDEF00-AAAA-4AAA-8AAA-${String(++n).padStart(12, "0")}`,
    });
    expect(made.id).toBe("abcdef00-aaaa-4aaa-8aaa-000000000001");
    expect(made.messages[0]?.id).toBe("abcdef00-aaaa-4aaa-8aaa-000000000002");
  });

  it("a generator that repeats itself, or gives something that is no UUID, is asked again", () => {
    const answers = [
      "eeeeeeee-eeee-4eee-8eee-000000000001", // the session
      "not a uuid",
      "eeeeeeee-eeee-4eee-8eee-000000000002", // message 0
      "eeeeeeee-eeee-4eee-8eee-000000000002", // a repeat: asked again
      "",
      "EEEEEEEE-EEEE-4EEE-8EEE-000000000002", // the same id in capitals: asked again
      "eeeeeeee-eeee-4eee-8eee-000000000003", // message 1
    ];
    let next = 0;
    const made = createSession(parsed(), { now: NOW, newId: () => answers[next++] ?? "exhausted" });
    expect(made.id).toBe("eeeeeeee-eeee-4eee-8eee-000000000001");
    expect(made.messages.map((message) => message.id)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-000000000002",
      "eeeeeeee-eeee-4eee-8eee-000000000003",
    ]);
    expect(next).toBe(7);
  });

  it("a session and a message may be given the same id: only ids of one kind must differ (6.6 R2)", () => {
    const same = "eeeeeeee-eeee-4eee-8eee-000000000001";
    const made = createSession(parsed({ messages: [{ role: "user", text: "t" }] }), {
      now: NOW,
      newId: () => same,
    });
    expect(made.id).toBe(same);
    expect(made.messages[0]?.id).toBe(same);
    expectStorable({ projects: [], sessions: [made], blobs: new Map() });
  });

  it("a generator that never gives an unused UUID ends the call with an error after 16 tries", () => {
    let calls = 0;
    const stuck: NewSessionContext = {
      now: NOW,
      newId: () => {
        calls += 1;
        return "eeeeeeee-eeee-4eee-8eee-000000000001";
      },
    };
    // The session takes the id; the first message can never get one.
    expect(() => createSession(parsed(), stuck)).toThrow("The id generator gave no unused UUID");
    expect(calls).toBe(1 + 1 + 16);
    let junk = 0;
    expect(() =>
      createSession(parsed(), {
        now: NOW,
        newId: () => {
          junk += 1;
          return "junk";
        },
      }),
    ).toThrow(Error);
    expect(junk).toBe(16);
  });

  it("addParsedSessions never repeats an id the vault already uses, for a session or for a message", () => {
    const first = addParsedSessions(emptyVault(), [parsed()], context());
    // The same generator again: it gives the three ids the vault now holds, then new ones.
    const ctx = context();
    const second = addParsedSessions(first.vault, [parsed()], ctx);
    expect(second.sessions[0]?.id).toBe("eeeeeeee-eeee-4eee-8eee-000000000002");
    expect(second.sessions[0]?.messages.map((message) => message.id)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-000000000004",
      "eeeeeeee-eeee-4eee-8eee-000000000005",
    ]);
    const sessionIds = second.vault.sessions.map((session) => session.id);
    const messageIds = second.vault.sessions.flatMap((session) =>
      session.messages.map((message) => message.id),
    );
    expect(new Set(sessionIds).size).toBe(2);
    expect(new Set(messageIds).size).toBe(4);
    expectStorable(second.vault);
  });
});

describe("addParsedSessions", () => {
  it("returns a new vault with the new sessions after the old ones, and leaves the old vault as it was", () => {
    const blobs = new Map([["0".repeat(64), new Uint8Array([1])]]);
    const projects = [
      {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        name: "Garden",
        created_at: NOW,
        updated_at: NOW,
        extra: {},
      },
    ];
    const start: Vault = { projects, sessions: [], blobs };
    const once = addParsedSessions(start, [parsed({ title: "one" })], context());
    const twice = addParsedSessions(
      once.vault,
      [parsed({ title: "two" }), parsed({ title: "three" })],
      context(new Date(ms(NOW) + 60_000)),
    );
    expect(start.sessions).toEqual([]);
    expect(once.vault.sessions.map((session) => session.title)).toEqual(["one"]);
    expect(twice.vault.sessions.map((session) => session.title)).toEqual(["one", "two", "three"]);
    expect(twice.sessions.map((session) => session.title)).toEqual(["two", "three"]);
    // Projects and stored bytes are the very same objects.
    expect(twice.vault.projects).toBe(projects);
    expect(twice.vault.blobs).toBe(blobs);
  });

  it("importing the same thing twice gives two sessions (B2: duplicates are allowed)", () => {
    const once = addParsedSessions(emptyVault(), [parsed()], context());
    const twice = addParsedSessions(once.vault, [parsed()], context(new Date(ms(NOW) + 1)));
    expect(twice.vault.sessions).toHaveLength(2);
    expect(twice.vault.sessions[0]?.title).toBe(twice.vault.sessions[1]?.title);
    expect(twice.vault.sessions[0]?.id).not.toBe(twice.vault.sessions[1]?.id);
  });
});

describe("what createSessions refuses", () => {
  it("a current time that holds no instant: RangeError, and no id is taken", () => {
    const ctx = context(new Date(Number.NaN));
    expect(() => createSessions([parsed()], ctx)).toThrow(RangeError);
    expect(ctx.given).toEqual([]);
  });

  it("a current time no timestamp of the format can express, also when only the batch reaches past it", () => {
    expect(() => createSessions([parsed()], context(new Date("+010000-01-01T00:00:00.000Z")))).toThrow(
      RangeError,
    );
    expect(() => createSessions([parsed()], context(new Date(8.64e15)))).toThrow(RangeError);
    // 9999-12-31T23:59:59.999Z is the last instant; a batch of two needs one millisecond more.
    const last = new Date("9999-12-31T23:59:59.999Z");
    expect(createSessions([parsed()], context(last))[0]?.imported_at.toISOString()).toBe(
      "9999-12-31T23:59:59.999Z",
    );
    expect(() => createSessions([parsed(), parsed()], context(last))).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Every session the import fixtures expect.
// ---------------------------------------------------------------------------------------------

const FIXTURES = new URL("../../../fixtures/import/", import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function field(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what}: expected a string`);
  return value;
}
function items(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what}: expected an array`);
  return value;
}
function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what}: expected an object`);
  return value;
}
function provider(value: unknown): Provider {
  if (value === "claude" || value === "chatgpt" || value === "gemini" || value === "other") return value;
  throw new Error("a fixture names an unknown provider");
}
function role(value: unknown): Role {
  if (value === "user" || value === "assistant" || value === "system" || value === "unknown") return value;
  throw new Error("a fixture names an unknown role");
}
function readJson(name: string): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(new URL(name, FIXTURES))));
}

interface Expected {
  readonly fixture: string;
  readonly session: ParsedSession;
}

/** The sessions of every expected file that is a target: `web` where there is one, else `both`. */
function expectedSessions(): Expected[] {
  const manifest = record(readJson("manifest.json"), "manifest");
  const out: Expected[] = [];
  for (const item of items(field(manifest, "cases"), "cases")) {
    const entry = record(item, "case");
    const fixture = text(field(entry, "id"), "id");
    const targets = record(field(entry, "expected"), "expected");
    const target = field(targets, "web") ?? field(targets, "both");
    const name = text(target, `${fixture}: target`);
    // Never an Apple file: those record defects.
    if (name.includes(".apple.")) throw new Error(`${fixture}: the target is an Apple file`);
    const result = field(record(readJson(name), name), "result");
    if (!isRecord(result)) continue;
    const sessions = field(result, "sessions");
    if (sessions === undefined) continue;
    for (const raw of items(sessions, `${fixture}: sessions`)) {
      const session = record(raw, `${fixture}: session`);
      const createdAt = field(session, "created_at");
      const tags = field(session, "tags");
      out.push({
        fixture,
        session: {
          title: text(field(session, "title"), "title"),
          provider: provider(field(session, "provider")),
          model: text(field(session, "model") ?? "", "model"),
          sourceUrl: text(field(session, "source_url"), "source_url"),
          createdAt: createdAt === null ? null : text(createdAt, "created_at"),
          summary: text(field(session, "summary") ?? "", "summary"),
          tags: tags === undefined ? [] : items(tags, "tags").map((tag) => text(tag, "tag")),
          messages: items(field(session, "messages"), "messages").map((raw) => {
            const message = record(raw, "message");
            return { role: role(field(message, "role")), text: text(field(message, "text"), "text") };
          }),
        },
      });
    }
  }
  return out;
}

describe("every session the import fixtures expect becomes a session of the vault, unchanged", () => {
  const expected = expectedSessions();

  it("there are 49 of them, with 146 messages, all four roles and all four providers", () => {
    expect(expected).toHaveLength(49);
    expect(expected.reduce((sum, item) => sum + item.session.messages.length, 0)).toBe(146);
    expect(
      new Set(expected.flatMap((item) => item.session.messages.map((message) => message.role))).size,
    ).toBe(4);
    expect(new Set(expected.map((item) => item.session.provider)).size).toBe(4);
  });

  it.each(expected.map((item, index) => [item.fixture, index] as const))(
    "%s (session %i of all)",
    (_fixture, index) => {
      const item = expected[index];
      if (item === undefined) throw new Error("no such session");
      const session = createSession(item.session, context());
      // Not one character of what the importer returned is changed.
      expect(session.title).toBe(item.session.title);
      expect(session.provider).toBe(item.session.provider);
      expect(session.model).toBe(item.session.model);
      expect(session.source_url).toBe(item.session.sourceUrl);
      expect(session.summary).toBe(item.session.summary);
      expect(session.tags).toEqual(item.session.tags);
      expect(session.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual(
        item.session.messages,
      );
      expect(session.messages.map((message) => message.position)).toEqual(
        item.session.messages.map((_message, position) => position),
      );
      expect(session.created_at.toISOString()).toBe(item.session.createdAt ?? NOW.toISOString());
      expect(session.message_count).toBe(item.session.messages.length);
      expect(session.text_bytes).toBe(
        item.session.messages.reduce(
          (sum, message) => sum + new TextEncoder().encode(message.text).length,
          0,
        ),
      );
    },
  );

  it("all of them together are one storable vault, in fixture order in the list", () => {
    const added = addParsedSessions(
      emptyVault(),
      expected.map((item) => item.session),
      context(),
    );
    expect(added.vault.sessions).toHaveLength(49);
    expectStorable(added.vault);
    expect(listSessions(added.vault.sessions, { kind: "all" }).map((session) => session.title)).toEqual(
      expected.map((item) => item.session.title),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Parser results no importer returns.
// ---------------------------------------------------------------------------------------------

describe("whatever the strings of a parser result hold, the session is in the form the reader stores (6.6)", () => {
  it("provider: a known name in any case becomes the lower-case name; another is trimmed; none is 'other'", () => {
    const made = (value: string): string => createSession(foreign({ provider: value }), context()).provider;
    expect(made("Claude")).toBe("claude");
    expect(made(" ChatGPT\n")).toBe("chatgpt");
    expect(made("GEMINI")).toBe("gemini");
    expect(made("Other")).toBe("other");
    expect(made(" examplebot ")).toBe("examplebot");
    expect(made("ExampleBot")).toBe("ExampleBot");
    expect(made("")).toBe("other");
    expect(made(" \t ")).toBe("other");
    expect(made(cp(0))).toBe("other");
  });

  it("role: the same rule with the fallback 'unknown'; a role such as 'tool' is kept as written", () => {
    const made = (value: string): string =>
      createSession(foreign({ messages: [{ role: value, text: "t" }] }), context()).messages[0]?.role ?? "";
    expect(made("User")).toBe("user");
    expect(made(" ASSISTANT ")).toBe("assistant");
    expect(made("System")).toBe("system");
    expect(made("tool")).toBe("tool");
    expect(made(" Tool ")).toBe("Tool");
    expect(made("")).toBe("unknown");
    expect(made("constructor")).toBe("constructor");
  });

  it("tags: the rule of 8.2 as the reader applies it, with repeats dropped", () => {
    const made = (tags: readonly string[]): readonly string[] =>
      createSession(foreign({ tags }), context()).tags;
    expect(made(["Garden", "#garden", " garden ", "Bikes"])).toEqual(["garden", "bikes"]);
    expect(made(["a,b", "# #c", "", "  "])).toEqual(["a", "b", "c"]);
    expect(made([`Caf${cp(0xe9)}`, cp(0)])).toEqual([`caf${cp(0xe9)}`]);
  });

  it("C9: U+0000 is removed and a lone surrogate replaced in every string", () => {
    const nul = cp(0);
    const lone = cp(0xd800);
    const made = createSession(
      foreign({
        title: `ti${nul}tle${lone}`,
        model: `mo${nul}del`,
        sourceUrl: `li${nul}nk`,
        summary: `sum${lone}mary`,
        tags: [`ta${nul}g`],
        messages: [{ role: `us${nul}er`, text: `te${nul}xt${lone}` }],
      }),
      context(),
    );
    expect(made.title).toBe(`title${cp(0xfffd)}`);
    expect(made.model).toBe("model");
    expect(made.source_url).toBe("link");
    expect(made.summary).toBe(`sum${cp(0xfffd)}mary`);
    expect(made.tags).toEqual(["tag"]);
    expect(made.messages[0]?.role).toBe("user");
    expect(made.messages[0]?.text).toBe(`text${cp(0xfffd)}`);
    // A surrogate pair is a character and stays.
    expect(createSession(foreign({ title: cp(0x1f600) }), context()).title).toBe(cp(0x1f600));
  });

  it("B13: message text has line feeds only", () => {
    const made = createSession(
      foreign({ messages: [{ role: "user", text: "a\r\nb\rc\n\r\nd" }] }),
      context(),
    );
    expect(made.messages[0]?.text).toBe("a\nb\nc\n\nd");
    expect(made.messages[0]?.text_bytes).toBe(8);
  });

  it("a date the format cannot read counts as no date", () => {
    for (const createdAt of [
      "yesterday",
      "2026-02-30T00:00:00.000Z",
      "2026-03-14",
      "",
      "2026-03-14T09:30:00+01:00",
    ]) {
      expect(ms(createSession(foreign({ createdAt }), context()).created_at)).toBe(ms(NOW));
    }
    // Digits beyond the millisecond are cut off, as the reader does.
    expect(
      createSession(
        foreign({ createdAt: "2026-03-14T09:30:00.123456789Z" }),
        context(),
      ).created_at.toISOString(),
    ).toBe("2026-03-14T09:30:00.123Z");
  });

  it("a session without messages and a message without text are stored as they are (W12 is the importer's rule)", () => {
    const empty = createSession(foreign({ messages: [] }), context());
    expect(empty.messages).toEqual([]);
    expect(empty.message_count).toBe(0);
    expect(empty.text_bytes).toBe(0);
    const blank = createSession(foreign({ title: "", messages: [{ role: "user", text: "" }] }), context());
    expect(blank.title).toBe("");
    expect(blank.messages[0]?.text).toBe("");
    expectStorable({
      projects: [],
      sessions: [empty, blank].map((session, index) => ({
        ...session,
        id: `eeeeeeee-eeee-4eee-8eee-00000000010${index}`,
      })),
      blobs: new Map(),
    });
  });

  it("titles and tags with characters outside ASCII and odd white space are kept as given", () => {
    const title = `  ${cp(0x65e5, 0x672c, 0x8a9e)} ${cp(0x1f600)}${cp(0xa0)}Caf${cp(0xe9)}\t${cp(0x200b)} `;
    const made = createSession(
      foreign({
        title,
        summary: `line 1\n\n  line 2${cp(0x2028)}`,
        tags: [`${cp(0xc9)}t${cp(0xe9)}`, "two  words"],
      }),
      context(),
    );
    expect(made.title).toBe(title);
    expect(made.summary).toBe(`line 1\n\n  line 2${cp(0x2028)}`);
    expect(made.tags).toEqual([`${cp(0xe9)}t${cp(0xe9)}`, "two  words"]);
    expectStorable({ projects: [], sessions: [made], blobs: new Map() });
  });

  it("generated parser results of every kind give a vault that can be stored, exported and read back unchanged", () => {
    const UNITS = [
      "a",
      "B",
      " ",
      "\t",
      "\n",
      "\r",
      "\r\n",
      ",",
      "#",
      cp(0),
      cp(0xd800),
      cp(0xdc00),
      cp(0xe9),
      cp(0x301),
      cp(0xa0),
      cp(0x2028),
      cp(0xfeff),
      cp(0x1f600),
      "Claude",
      "user",
      "---",
      "**User:**",
    ];
    const chunk = fc
      .array(fc.constantFrom(...UNITS), { maxLength: 8, size: "max" })
      .map((units) => units.join(""));
    const session = fc.record({
      title: chunk,
      provider: fc.oneof(fc.constantFrom("claude", "ChatGPT", " gemini ", "other", ""), chunk),
      model: chunk,
      sourceUrl: chunk,
      createdAt: fc.oneof(
        fc.constant(null),
        fc.constantFrom(
          "2026-03-14T09:30:00.000Z",
          "0000-01-01T00:00:00Z",
          "9999-12-31T23:59:59.999999999Z",
          "x",
        ),
      ),
      summary: chunk,
      tags: fc.array(chunk, { maxLength: 5, size: "max" }),
      messages: fc.array(
        fc.record({ role: fc.oneof(fc.constantFrom("user", "Assistant", "tool", ""), chunk), text: chunk }),
        {
          maxLength: 5,
          size: "max",
        },
      ),
    });
    const seen = { cleaned: 0, carriageReturn: 0, tagsChanged: 0 };
    fc.assert(
      fc.property(fc.array(session, { minLength: 1, maxLength: 4, size: "max" }), (list) => {
        const batch = list.map((fields) => foreign(fields));
        const added = addParsedSessions(emptyVault(), batch, context());
        expect(added.sessions).toHaveLength(batch.length);
        expectStorable(added.vault);
        added.sessions.forEach((made, index) => {
          const source = batch[index];
          if (source === undefined) throw new Error("no source");
          // Derived values are right.
          expect(made.message_count).toBe(source.messages.length);
          expect(made.text_bytes).toBe(
            made.messages.reduce((sum, message) => sum + utf8ByteLength(message.text), 0),
          );
          expect(made.tags).toEqual(normaliseTags(made.tags));
          if (source.title.includes(cp(0)) || source.title.includes(cp(0xd800))) seen.cleaned += 1;
          if (source.messages.some((message) => message.text.includes("\r"))) seen.carriageReturn += 1;
          if (made.tags.join("|") !== source.tags.join("|")) seen.tagsChanged += 1;
        });
      }),
      { seed: SEED, numRuns: 400 },
    );
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(50);
  });
});

describe("large input", () => {
  it("a message of 1,000,000 characters and one of 4,000,000 bytes (9.4 test 5)", () => {
    const million = "0123456789".repeat(100_000);
    const fourMegabytes = cp(0x1f600).repeat(1_000_000);
    const started = performance.now();
    const made = createSession(
      parsed({
        messages: [
          { role: "user", text: million },
          { role: "assistant", text: fourMegabytes },
        ],
      }),
      context(),
    );
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(made.messages.map((message) => message.text_bytes)).toEqual([1_000_000, 4_000_000]);
    expect(made.text_bytes).toBe(5_000_000);
    expect(made.messages[0]?.text).toBe(million);
    expect(made.messages[1]?.text).toBe(fourMegabytes);
  });

  it("a session of 100,000 messages", () => {
    const messages = Array.from({ length: 100_000 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `turn ${index}`,
    }));
    const started = performance.now();
    const made = createSession(parsed({ messages }), context());
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(made.message_count).toBe(100_000);
    expect(made.messages[99_999]?.position).toBe(99_999);
    expect(made.messages[99_999]?.text).toBe("turn 99999");
    expect(new Set(made.messages.map((message) => message.id)).size).toBe(100_000);
  });
});

describe("the sessions of one vault", () => {
  it("made in several batches are distinct sessions of a vault that checks", () => {
    let vault = emptyVault();
    const titles: string[] = [];
    // One source of ids for all batches, as a running app has.
    const ids = context();
    for (let batch = 0; batch < 5; batch++) {
      const list = Array.from({ length: 3 }, (_, index) => parsed({ title: `batch ${batch} item ${index}` }));
      // Each batch a minute after the one before.
      const added = addParsedSessions(vault, list, {
        now: new Date(ms(NOW) + batch * 60_000),
        newId: ids.newId,
      });
      vault = added.vault;
      titles.unshift(...list.map((session) => session.title));
    }
    expect(vault.sessions).toHaveLength(15);
    expectStorable(vault);
    // Newest batch first, and inside every batch the order of the file.
    const listed: readonly VaultSession[] = listSessions(vault.sessions, { kind: "all" });
    expect(listed.map((session) => session.title)).toEqual(titles);
  });
});
