/// <reference types="node" />
// Round trips through the functions of this folder:
//   - the tests of docs/data-model.md 9.4 that start at a file, through openFile;
//   - 9.4 test 5: very large messages, from the parser result to the list, the export and back;
//   - a session through its context pack and back through the importer (import-rules.md W14),
//     with what survives that loop and what does not.
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { importFile, importPaste, type ParsedSession } from "../import/index.ts";
import {
  checkVault,
  documentText,
  emptyVault,
  exportDocument,
  importDocument,
  normaliseTags,
  type Vault,
  type VaultSession,
  webGenerator,
} from "../interchange/index.ts";
import {
  addParsedSessions,
  type ContextPackMessage,
  type ContextPackSession,
  contextPackMarkdown,
  createSession,
  libraryCounts,
  listSessions,
  openFile,
  sessionContextPack,
  timelineGroups,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
const cp = (...points: number[]): string => String.fromCodePoint(...points);

const WEB = new URL("../../../", import.meta.url);
const EXAMPLE_BYTES = new Uint8Array(readFileSync(new URL("docs/example-vault-export.json", WEB)));
const EXAMPLE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(EXAMPLE_BYTES);

const NOW = new Date("2026-11-20T08:00:00.000Z");
const UTC = { timeZone: "UTC" };
const GENERATOR = webGenerator("0.0.0-test");

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(12, "0")}`;
}

/** A file through the entry point and, when it is an interchange file, into the vault (6.7). */
function importBytes(vault: Vault, bytes: Uint8Array, name: string) {
  const opened = openFile(bytes, name);
  if (opened.route !== "interchange") throw new Error(`${name} did not go to the interchange reader`);
  const merged = importDocument(vault, opened.json, { now: NOW, newId: ids("ffffffff-ffff-4fff-8fff") });
  if (!merged.ok) throw new Error(`${name} was refused`);
  return merged;
}

function exportText(vault: Vault, includeBytes: boolean): string {
  const result = exportDocument(
    vault,
    { kind: "vault" },
    { now: NOW, generator: GENERATOR },
    { includeBytes },
  );
  if (!result.ok) throw new Error("the vault cannot be exported");
  const text = documentText(result.doc);
  if (text === null) throw new Error("the export is too long for one string");
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 9.4 test 1: arrays sorted by id; exported_at, generator and the document-level x_note left out. */
function comparable(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("no JSON object");
  const byId = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) throw new Error("no array");
    return [...value].sort((a, b) => {
      if (!isRecord(a) || !isRecord(b)) throw new Error("no object in the array");
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  };
  const { exported_at: _exportedAt, generator: _generator, x_note: _note, ...rest } = parsed;
  return { ...rest, projects: byId(parsed.projects), sessions: byId(parsed.sessions) };
}

describe("9.4 test 1: the example file, opened as a file, imported, exported", () => {
  const vault = importBytes(emptyVault(), EXAMPLE_BYTES, "example-vault-export.json").vault;

  it("equals the original after sorting arrays by id and ignoring exported_at, generator and x_note", () => {
    const text = exportText(vault, true);
    expect(comparable(text)).toEqual(comparable(EXAMPLE_TEXT));
    // What is ignored really differs or is gone: the document-level x_note is not stored (6.5).
    expect(text).not.toContain("x_note");
    expect(EXAMPLE_TEXT).toContain("x_note");
  });

  it("every other unknown property, the unknown provider, role and segment, and the bytes survive", () => {
    const text = exportText(vault, true);
    for (const kept of ["x_color", "x_capture", "x_pages", "x_rating", "x_table", "examplebot", '"tool"']) {
      expect(text).toContain(kept);
    }
    expect(vault.blobs.size).toBe(2);
    expect(checkVault(vault).ok).toBe(true);
  });

  it("the export, opened as a file again, gives the same vault", () => {
    const again = importBytes(
      emptyVault(),
      utf8(exportText(vault, true)),
      "sessionvault-vault-20261120-080000.json",
    );
    expect(again.report.counts.added).toBe(6);
    expect(again.vault.sessions.map((session) => session.id).sort()).toEqual(
      vault.sessions.map((session) => session.id).sort(),
    );
    expect(comparable(exportText(again.vault, true))).toEqual(comparable(exportText(vault, true)));
  });
});

describe("9.4 tests 2 and 3, starting at the file", () => {
  it("test 2: importing the example twice reports 6 unchanged and creates nothing", () => {
    const first = importBytes(emptyVault(), EXAMPLE_BYTES, "example.json");
    expect(first.report.counts).toMatchObject({ added: 6, unchanged: 0, projectsAdded: 3 });
    const second = importBytes(first.vault, EXAMPLE_BYTES, "example.json");
    expect(second.report.counts).toMatchObject({
      added: 0,
      updated: 0,
      kept: 0,
      unchanged: 6,
      projectsAdded: 0,
    });
    expect(second.vault.sessions).toEqual(first.vault.sessions);
    expect(second.vault.projects).toEqual(first.vault.projects);
  });

  it("test 3: a later copy with a changed title updates 1; the original then is kept", () => {
    const original = importBytes(emptyVault(), EXAMPLE_BYTES, "example.json").vault;
    const changed = EXAMPLE_TEXT.replace(
      '"title": "Truing a bicycle wheel"',
      '"title": "Truing a wheel"',
    ).replace('"updated_at": "2026-03-15T18:05:40.100Z"', '"updated_at": "2026-11-19T00:00:00.000Z"');
    expect(changed).not.toBe(EXAMPLE_TEXT);
    const updated = importBytes(original, utf8(changed), "edited.json");
    expect(updated.report.counts).toMatchObject({ updated: 1, unchanged: 5, added: 0, kept: 0 });
    expect(updated.vault.sessions.some((session) => session.title === "Truing a wheel")).toBe(true);
    const back = importBytes(updated.vault, EXAMPLE_BYTES, "example.json");
    expect(back.report.counts).toMatchObject({ kept: 1, unchanged: 5, added: 0, updated: 0 });
    expect(back.vault.sessions.some((session) => session.title === "Truing a wheel")).toBe(true);
  });
});

describe("9.4 test 5: a message of 1,000,000 characters and one of 4,000,000 bytes", () => {
  const million = `${"0123456789".repeat(99_999)}123456789\n`.trimEnd();
  const fourMegabytes = cp(0x1f600).repeat(1_000_000);
  const big: ParsedSession = {
    title: "A very long session",
    provider: "claude",
    model: "",
    sourceUrl: "",
    createdAt: "2026-03-14T09:30:00.000Z",
    summary: "",
    tags: ["long"],
    messages: [
      { role: "user", text: million },
      { role: "assistant", text: fourMegabytes },
    ],
  };
  const small = (index: number): ParsedSession => ({
    ...big,
    title: `Session ${index}`,
    tags: [],
    messages: [{ role: "user", text: "short" }],
  });
  const example = importBytes(emptyVault(), EXAMPLE_BYTES, "example.json").vault;
  const added = addParsedSessions(example, [small(1), big, small(2)], {
    now: NOW,
    newId: ids("eeeeeeee-eeee-4eee-8eee"),
  });
  const vault = added.vault;
  const stored = added.sessions[1];

  it("insert succeeds: the session holds both messages whole, with their sizes", () => {
    if (stored === undefined) throw new Error("the large session was not created");
    expect(million.length).toBe(999_999);
    expect(stored.messages.map((message) => message.text_bytes)).toEqual([999_999, 4_000_000]);
    expect(stored.text_bytes).toBe(4_999_999);
    expect(stored.message_count).toBe(2);
    expect(vault.sessions).toHaveLength(9);
    expect(checkVault(vault).ok).toBe(true);
  });

  it("the lists do not get slower: they work on the fields of the session and never touch a message", () => {
    // Rows as a list query returns them: no messages at all.
    const rows = vault.sessions.map(({ messages: _messages, attachments: _attachments, ...row }) => row);
    const started = performance.now();
    for (let round = 0; round < 200; round++) {
      listSessions(rows, { kind: "all" }, "session");
      libraryCounts({ projects: vault.projects, sessions: rows }, "en");
      timelineGroups(rows, "en-US", "UTC");
    }
    expect(performance.now() - started).toBeLessThan(10_000);
    // The batch of three lists in file order, before the six older sessions.
    expect(
      listSessions(rows, { kind: "all" })
        .slice(0, 4)
        .map((row) => row.title),
    ).toEqual(["Tomato blight on the balcony", "Session 1", "A very long session", "Session 2"]);
    expect(listSessions(rows, { kind: "tag", tag: "long" }).map((row) => row.title)).toEqual([
      "A very long session",
    ]);
  });

  it("export and import work: the export, opened as a file, gives the same sessions", () => {
    const text = exportText(vault, false);
    expect(text.length).toBeGreaterThan(3_000_000);
    const again = importBytes(emptyVault(), utf8(text), "large.json");
    expect(again.report.counts.added).toBe(9);
    const copy = again.vault.sessions.find((session) => session.id === stored?.id);
    expect(copy?.messages.map((message) => message.text)).toEqual([million, fourMegabytes]);
    expect(copy).toEqual(stored);
    // And into the vault it came from: nothing changes.
    expect(importBytes(vault, utf8(text), "large.json").report.counts).toMatchObject({
      unchanged: 9,
      added: 0,
    });
  });

  it("its context pack is whole as well, and comes back through the importer", () => {
    if (stored === undefined) throw new Error("the large session was not created");
    const pack = sessionContextPack(stored, UTC);
    expect(utf8(pack).length).toBeGreaterThan(4_999_999);
    expect(
      pack.endsWith(`\n**User:**\n\n${million}\n\n---\n\n**Assistant:**\n\n${fourMegabytes}\n\n---\n`),
    ).toBe(true);
    const imported = importFile(utf8(pack), "A very long session.md");
    expect(imported.outcome).toBe("imported");
    expect(imported.sessions[0]?.messages).toEqual(big.messages);
  });
});

// ---------------------------------------------------------------------------------------------
// A session through its context pack and back.
// ---------------------------------------------------------------------------------------------

/** The name the pack is imported under. No title in these tests is its stem. */
const PACK_FILE = "the-file-of-the-pack.md";
const PACK_FILE_STEM = "the-file-of-the-pack";

/** The pack of a session, imported as a file, stored with the original date: the session that comes back. */
function throughPack(session: ContextPackSession, messages: readonly ContextPackMessage[]) {
  const pack = contextPackMarkdown(session, messages, UTC);
  const imported = importFile(utf8(pack), PACK_FILE);
  if (imported.outcome !== "imported") {
    return { pack, outcome: imported.outcome, reason: imported.reason, back: null, asPack: false };
  }
  const parsed = imported.sessions[0];
  if (parsed === undefined || imported.sessions.length !== 1) throw new Error("a pack gave several sessions");
  // The pack does not carry its date in a form that is read back: the store uses the import time.
  expect(parsed.createdAt).toBeNull();
  const back = createSession(parsed, { now: session.created_at, newId: ids("dddddddd-dddd-4ddd-8ddd") });
  // A text the pack parser does not take goes to the other text parsers, which use the file name as title.
  return {
    pack,
    outcome: imported.outcome,
    reason: imported.reason,
    back,
    asPack: back.title !== PACK_FILE_STEM,
  };
}

function content(session: VaultSession) {
  return {
    title: session.title,
    provider: session.provider,
    model: session.model,
    source_url: session.source_url,
    summary: session.summary,
    tags: session.tags,
    messages: session.messages.map((message) => ({ role: message.role, text: message.text })),
  };
}

describe("the example sessions through their context packs and back through the importer", () => {
  const vault = importBytes(emptyVault(), EXAMPLE_BYTES, "example.json").vault;
  const session = (number: number): VaultSession => {
    const found = vault.sessions.find((candidate) => candidate.id.endsWith(`00000000000${number}`));
    if (found === undefined) throw new Error(`no session #${number}`);
    return found;
  };

  it.each([1, 2, 6])(
    "#%i comes back with everything the pack prints, and gives the same pack again",
    (number) => {
      const original = session(number);
      const { pack, back } = throughPack(original, original.messages);
      if (back === null) throw new Error("the pack was not imported");
      expect(content(back)).toEqual(content(original));
      expect(sessionContextPack(back, UTC)).toBe(pack);
    },
  );

  it("#3 comes back with the flattened text of each message; the attachment between two texts is not in a pack", () => {
    const original = session(3);
    const { pack, back } = throughPack(original, original.messages);
    if (back === null) throw new Error("the pack was not imported");
    expect(content(back)).toEqual(content(original));
    expect(original.messages[2]?.segments).not.toBeNull();
    expect(back.messages[2]?.segments).toBeNull();
    expect(back.messages[2]?.text).toBe("Here is a photo of the jar after six hours.\n\nIs it ready?");
    expect(back.attachments).toEqual([]);
    expect(sessionContextPack(back, UTC)).toBe(pack);
  });

  it("#5 comes back as the pack labels it: the unknown provider as 'other', the role 'tool' as 'unknown'", () => {
    const original = session(5);
    const { pack, back } = throughPack(original, original.messages);
    if (back === null) throw new Error("the pack was not imported");
    expect(original.provider).toBe("examplebot");
    expect(back.provider).toBe("other");
    expect(original.messages.map((message) => message.role)).toEqual(["user", "tool", "assistant"]);
    expect(back.messages.map((message) => message.role)).toEqual(["user", "unknown", "assistant"]);
    expect(back.messages.map((message) => message.text)).toEqual(
      original.messages.map((message) => message.text),
    );
    expect(content(back)).toEqual({
      ...content(original),
      provider: "other",
      messages: content(original).messages.map((message) => ({
        ...message,
        role: message.role === "tool" ? "unknown" : message.role,
      })),
    });
    // The pack itself is the same again: it never showed the difference.
    expect(sessionContextPack(back, UTC)).toBe(pack);
  });

  it("#4, a session without messages: its pack is not read as a pack; the importer keeps the text as one note", () => {
    // The pack parser of the importer returns nothing for a pack without a message, and the text
    // then goes to the other text parsers. Recorded here as it is.
    const original = session(4);
    const { pack, back, asPack } = throughPack(original, original.messages);
    if (back === null) throw new Error("the text was not imported");
    expect(asPack).toBe(false);
    expect(back.title).toBe(PACK_FILE_STEM);
    expect(back.messages).toHaveLength(1);
    expect(back.messages[0]?.role).toBe("unknown");
    expect(back.messages[0]?.text).toBe(pack.trimEnd());
  });

  it("what a pack does not print does not come back: project, pin, ids, import date, unknown properties", () => {
    const original = session(2);
    const { back } = throughPack(original, original.messages);
    if (back === null) throw new Error("the pack was not imported");
    expect([original.is_pinned, original.project_id === null, original.attachments.length]).toEqual([
      true,
      false,
      1,
    ]);
    expect([back.is_pinned, back.project_id, back.attachments.length]).toEqual([false, null, 0]);
    expect(back.id).not.toBe(original.id);
    // The original date survives only because this test stores the session at that very instant.
    expect(back.created_at.getTime()).toBe(original.created_at.getTime());
    expect(back.imported_at.getTime()).toBe(original.created_at.getTime());
  });

  it("the same through the paste field, where the provider picker stands in for 'Other'", () => {
    const original = session(1);
    const pack = sessionContextPack(original, UTC);
    const pasted = importPaste(pack, { title: "Pasted session", pickerProvider: "other" });
    expect(pasted.outcome).toBe("imported");
    expect(pasted.sessions).toEqual(importFile(utf8(pack), "pack.md").sessions);
    // W11: a session the parsers leave at "other" takes the value of the picker.
    const five = importPaste(sessionContextPack(session(5), UTC), {
      title: "Pasted session",
      pickerProvider: "gemini",
    });
    expect(five.sessions[0]?.provider).toBe("gemini");
  });
});

describe("what the loop keeps and what it loses, case by case", () => {
  const base: ContextPackSession = {
    title: "Compost bin plan",
    provider: "claude",
    model: "example-model-9",
    source_url: "https://share.example/EXAMPLE-0009",
    summary: "Three bays.\n\nTurn weekly.",
    tags: ["garden", "two words"],
    created_at: new Date("2026-03-14T09:30:00.000Z"),
  };
  const turns: readonly ContextPackMessage[] = [
    { role: "user", text: "How many bays?" },
    { role: "assistant", text: "Three." },
  ];
  const loop = (session: Partial<ContextPackSession>, messages: readonly ContextPackMessage[] = turns) => {
    const result = throughPack({ ...base, ...session }, messages);
    if (result.back === null) throw new Error(`not imported: ${result.reason}`);
    return result.back;
  };

  it("kept: a '---' line inside a message, also as its last line", () => {
    const text = "A rule of thumb:\n\n---\n\ncut above a bud.\n---";
    expect(
      loop({}, [{ role: "assistant", text }, turns[0] ?? { role: "user", text: "x" }]).messages[0]?.text,
    ).toBe(text);
    expect(loop({}, [{ role: "assistant", text }]).messages[0]?.text).toBe(text);
    expect(loop({}, [{ role: "user", text: "---" }]).messages[0]?.text).toBe("---");
  });

  it("kept: a message that begins with a line that looks like a role line", () => {
    const back = loop({}, [{ role: "assistant", text: "**User:**\nis how a pack marks you." }]);
    expect(back.messages).toHaveLength(1);
    expect(back.messages[0]).toMatchObject({
      role: "assistant",
      text: "**User:**\nis how a pack marks you.",
    });
  });

  it("kept: headings of the pack itself inside a message, code fences, a model with brackets", () => {
    const text = "## Transcript\n\n## Summary\n\n# Context pack: nested\n\n```\nOrigin: x\n```";
    expect(loop({}, [{ role: "user", text }]).messages[0]?.text).toBe(text);
    expect(loop({ model: "m (beta), saved copy" }).model).toBe("m (beta), saved copy");
    expect(loop({ model: "" }).model).toBe("");
    expect(loop({ source_url: "" }).source_url).toBe("");
    expect(loop({ tags: [] }).tags).toEqual([]);
    expect(loop({ summary: "" }).summary).toBe("");
  });

  it("lost: a '---' line that is followed by a role line cuts the message in two", () => {
    const back = loop({}, [{ role: "assistant", text: "Quote of a pack:\n\n---\n\n**User:**\n\nhello" }]);
    expect(back.messages.map((message) => [message.role, message.text])).toEqual([
      ["assistant", "Quote of a pack:"],
      ["user", "hello"],
    ]);
  });

  it("lost: a message without text, and white space at the ends of a message", () => {
    const back = loop({}, [
      { role: "user", text: "" },
      { role: "assistant", text: "  \n padded \n\n" },
      { role: "user", text: " \t " },
    ]);
    expect(back.messages.map((message) => [message.role, message.text])).toEqual([["assistant", "padded"]]);
  });

  it("lost: white space at the ends of title, model, link and summary; an empty title gets a name", () => {
    expect(loop({ title: "  Padded title\t" }).title).toBe("Padded title");
    expect(loop({ title: "" }).title).toBe("Imported session");
    expect(loop({ model: " m " }).model).toBe("m");
    expect(loop({ source_url: " https://share.example/EXAMPLE-1 " }).source_url).toBe(
      "https://share.example/EXAMPLE-1",
    );
    expect(loop({ summary: "\n  Three bays.  \n" }).summary).toBe("Three bays.");
  });

  it("lost: what stands behind a line break in the title, the model or the link", () => {
    expect(loop({ title: "First line\nsecond line" }).title).toBe("First line");
    expect(loop({ source_url: "https://share.example/EXAMPLE-1\nrest" }).source_url).toBe(
      "https://share.example/EXAMPLE-1",
    );
  });

  it("lost: a summary that holds the words that end it, or the heading of the transcript", () => {
    const cut = loop({
      summary: "Keep this.\nYou are being given the transcript of an earlier conversation\nand lose this.",
    });
    expect(cut.summary).toBe("Keep this.");
    const early = loop({ summary: "Before.\n## Transcript\nAfter." });
    expect(early.summary).toBe("Before.");
    // What followed the false heading has become the start of a note.
    expect(early.messages[0]?.role).toBe("unknown");
    expect(early.messages[0]?.text.startsWith("After.")).toBe(true);
  });

  it("lost on a second pass: a summary line of white space and then the words that end a summary", () => {
    // W14 ends the summary at "the line starting" with those words; with a space in front the
    // line does not start with them. The summary is trimmed, and the next pass ends it there.
    const words = "You are being given the transcript of an earlier conversation";
    const once = loop({ summary: ` ${words} about roses.` });
    expect(once.summary).toBe(`${words} about roses.`);
    const twice = throughPack(once, once.messages).back;
    expect(twice?.summary).toBe("");
    expect(twice?.messages.map((message) => message.text)).toEqual(
      once.messages.map((message) => message.text),
    );
  });

  it("lost on a second pass: a '---' at the start of a message behind a line separator, when a role line follows", () => {
    // The separator U+2028 beside it makes the line no '---' line; the importer trims it from the
    // start of the message, and the next pass cuts there.
    const once = loop({}, [{ role: "user", text: `${cp(0x2028)}---\n**Note:**\nkept as a note` }]);
    expect(once.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "---\n**Note:**\nkept as a note"],
    ]);
    const twice = throughPack(once, once.messages).back;
    expect(twice?.messages.map((message) => [message.role, message.text])).toEqual([
      ["unknown", "kept as a note"],
    ]);
  });

  it("lost pass by pass: zero width spaces at the ends of a tag, and a '#' they hide", () => {
    // import-rules.md W14 trims a tag by the importer's set, which has U+200B; data-model.md 8.2
    // trims with JavaScript's, which does not. Each pass through the pack removes one layer.
    const zero = cp(0x200b);
    const stored = normaliseTags([`${zero}#${zero}garden`]);
    expect(stored).toEqual([`${zero}#${zero}garden`]);
    const once = loop({ tags: stored });
    expect(once.tags).toEqual([`${zero}garden`]);
    const twice = throughPack(once, once.messages).back;
    expect(twice?.tags).toEqual(["garden"]);
  });

  it("lost: the provider when it is none of the three, and every role but user, assistant and system", () => {
    expect(loop({ provider: "examplebot" }).provider).toBe("other");
    expect(loop({ provider: "Claude " }).provider).toBe("claude");
    const back = loop({}, [
      { role: "system", text: "s" },
      { role: "tool", text: "t" },
      { role: "unknown", text: "u" },
      { role: "User", text: "v" },
    ]);
    expect(back.messages.map((message) => message.role)).toEqual(["system", "unknown", "unknown", "unknown"]);
  });

  it("lost: the original date. The session that comes back is dated by its import, and so is its pack", () => {
    const pack = contextPackMarkdown(base, turns, UTC);
    expect(pack).toContain(", saved Mar 14, 2026\n");
    const parsed = importFile(utf8(pack), "pack.md").sessions[0];
    if (parsed === undefined) throw new Error("the pack was not imported");
    const later = createSession(parsed, { now: NOW, newId: ids("dddddddd-dddd-4ddd-8ddd") });
    expect(later.created_at.toISOString()).toBe("2026-11-20T08:00:00.000Z");
    expect(sessionContextPack(later, UTC)).toBe(pack.replace("saved Mar 14, 2026", "saved Nov 20, 2026"));
  });

  it("refused on paste, unless the user says so: a pack that reads like a sign-in page", () => {
    const pack = contextPackMarkdown(
      { ...base, title: "Sign in to continue", summary: "" },
      [{ role: "user", text: "Log in\nSign up\nCreate account\nForgot password?" }],
      UTC,
    );
    const options = { title: "Pasted session", pickerProvider: "other" } as const;
    expect(importPaste(pack, options)).toMatchObject({ outcome: "rejected", reason: "sign_in_suspected" });
    expect(importPaste(pack, { ...options, allowWall: true }).outcome).toBe("imported");
    // A file is not put to that test.
    expect(importFile(utf8(pack), "pack.md").outcome).toBe("imported");
  });
});

describe("the loop on generated sessions", () => {
  // Lines a message may hold without being cut: among them the lines a pack itself is made of.
  const LINES = [
    "Tighten the spoke.",
    "a  b",
    "",
    "---",
    "  ---  ",
    "**User:**",
    "**Note:**",
    "**Assistant:** inline",
    "## Transcript",
    "## Summary",
    "# Context pack: nested",
    "Origin: Gemini (m), saved Jan 1, 2026",
    "Tags: x, y",
    "```sh",
    "```",
    `caf${cp(0xe9)} ${cp(0x1f600)}`,
    "    indented",
    "You are being given the transcript of an earlier conversation",
  ];
  const ROLE_LINES = new Set(["**User:**", "**Assistant:**", "**System:**", "**Note:**"]);

  /** True when a "---" line is followed, after blank lines, by a role line: the one cut W14 makes. */
  function isCut(lines: readonly string[]): boolean {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.trim() !== "---") continue;
      let next = i + 1;
      while (next < lines.length && lines[next]?.trim() === "") next += 1;
      if (next < lines.length && ROLE_LINES.has(lines[next]?.trim() ?? "")) return true;
    }
    return false;
  }

  const word = fc.constantFrom(
    "Compost",
    "bin",
    "plan (v2)",
    `caf${cp(0xe9)}`,
    cp(0x65e5, 0x672c),
    cp(0x1f600),
    "a, b",
    "x: y",
    "#1",
  );
  const phrase = fc.array(word, { minLength: 1, maxLength: 4, size: "max" }).map((words) => words.join(" "));
  const messageText = fc
    .array(fc.constantFrom(...LINES), { minLength: 1, maxLength: 8, size: "max" })
    .filter((lines) => lines[0]?.trim() !== "" && lines[lines.length - 1]?.trim() !== "" && !isCut(lines))
    .map((lines) => lines.join("\n").trim())
    .filter((text) => text !== "");
  const safeSession = fc.record({
    title: phrase,
    provider: fc.constantFrom("claude", "chatgpt", "gemini", "other"),
    model: fc.oneof(fc.constant(""), phrase),
    source_url: fc.oneof(
      fc.constant(""),
      fc.constantFrom("https://share.example/EXAMPLE-1", "share.example/x?y=(z)"),
    ),
    summary: fc.oneof(
      fc.constant(""),
      fc
        .array(fc.oneof(phrase, fc.constantFrom("", "## Summary", "---", "**User:**")), {
          minLength: 1,
          maxLength: 4,
          size: "max",
        })
        .filter((lines) => lines[0] !== "" && lines[lines.length - 1] !== "")
        .map((lines) => lines.join("\n")),
    ),
    tags: fc.uniqueArray(
      fc.constantFrom("garden", "two words", `caf${cp(0xe9)}`, "a.b", "x:y", cp(0x1f600)),
      { maxLength: 4, size: "max" },
    ),
    created_at: fc
      .integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2040, 0, 1) })
      .map((ms) => new Date(ms)),
  });
  const safeMessages = fc.array(
    fc.record({ role: fc.constantFrom("user", "assistant", "system", "unknown"), text: messageText }),
    { minLength: 1, maxLength: 5, size: "max" },
  );

  it("a session whose fields have no white space at their ends and no cut in its messages comes back as it was", () => {
    const seen = { dashes: 0, roleLine: 0, summary: 0, model: 0 };
    fc.assert(
      fc.property(safeSession, safeMessages, (session, messages) => {
        const { pack, back } = throughPack(session, messages);
        if (back === null) throw new Error("the pack was not imported");
        expect(content(back)).toEqual({
          title: session.title,
          provider: session.provider,
          model: session.model,
          source_url: session.source_url,
          summary: session.summary,
          tags: session.tags,
          messages,
        });
        expect(sessionContextPack(back, UTC)).toBe(pack);
        if (messages.some((message) => message.text.includes("---"))) seen.dashes += 1;
        if (messages.some((message) => message.text.includes("**User:**"))) seen.roleLine += 1;
        if (session.summary !== "") seen.summary += 1;
        if (session.model !== "") seen.model += 1;
      }),
      { seed: SEED, numRuns: 1500 },
    );
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(300);
  });

  it("any session at all: what comes back is storable, and from then on the loop changes nothing but, once, the summary", () => {
    const UNITS = [
      "a",
      "B",
      " ",
      "\t",
      "\n",
      "\n\n",
      "---",
      "\n---\n",
      "**User:**",
      "\n**Note:**\n",
      "## Transcript",
      "## Summary",
      "# Context pack: ",
      "Origin: Gemini (x), saved y",
      "Source: z",
      "Tags: p, q",
      ", saved ",
      " (",
      ")",
      "#",
      ",",
      cp(0xa0),
      cp(0x200b),
      cp(0xe9),
      cp(0x1f600),
      "You are being given the transcript of an earlier conversation",
    ];
    // Not among them: U+FEFF. import-rules.md W1 removes one leading U+FEFF each time a string
    // passes, so a title of a space and that mark is the mark after one pass and empty after two.
    // Nor the five characters the importer trims from the ends of a field but does not take for
    // white space inside a line (U+000B, U+000C, U+0085, U+2028, U+2029): beside one of them a
    // "---" or a "## Transcript" is no such line on the first pass and is one on the second
    // (see the case with U+2028 above).
    const chunk = fc
      .array(fc.constantFrom(...UNITS), { maxLength: 7, size: "max" })
      .map((units) => units.join(""));
    const textChunk = chunk;
    const anySession = fc.record({
      title: chunk,
      provider: fc.oneof(fc.constantFrom("claude", "ChatGPT", "gemini", "other", "examplebot"), chunk),
      model: chunk,
      source_url: chunk,
      summary: chunk,
      // Tags as a vault holds them, without the zero width space: to the importer it is white
      // space at the ends of a tag, to the tag rule of 8.2 it is not (see the case above).
      tags: fc
        .array(chunk, { maxLength: 4, size: "max" })
        .map((tags) => normaliseTags(tags.map((tag) => tag.replaceAll(cp(0x200b), "")))),
      created_at: fc.constant(new Date("2026-03-14T09:30:00.000Z")),
    });
    const anyMessages = fc.array(
      fc.record({ role: fc.constantFrom("user", "assistant", "system", "unknown", "tool"), text: textChunk }),
      { maxLength: 5, size: "max" },
    );
    const seen = { imported: 0, changed: 0, notAsPack: 0, summaryCut: 0 };
    fc.assert(
      fc.property(anySession, anyMessages, (session, messages) => {
        const first = throughPack(session, messages);
        // A pack is never empty, so something is always imported.
        if (first.back === null) throw new Error("a pack was rejected");
        const stored = first.back;
        expect(checkVault({ projects: [], sessions: [stored], blobs: new Map() }).ok).toBe(true);
        expect(stored.messages.length).toBeGreaterThan(0);
        for (const message of stored.messages) expect(message.text).not.toBe("");
        if (!first.asPack) {
          // No message of the pack was left with text: the importer read the whole text with its
          // other parsers (see #4). What it made of it is storable; no more is claimed here.
          seen.notAsPack += 1;
          return;
        }
        seen.imported += 1;
        if (first.pack !== sessionContextPack(stored, UTC)) seen.changed += 1;
        const second = throughPack(stored, stored.messages);
        if (second.back === null || !second.asPack)
          throw new Error("the pack of an imported session was not read as a pack");
        if (second.back.summary !== stored.summary) {
          // The one corner: the summary was trimmed on the first pass, and its first line now
          // starts with the words that end a summary (see the case named so above).
          expect(
            stored.summary.startsWith("You are being given the transcript of an earlier conversation"),
          ).toBe(true);
          expect(second.back.summary).toBe("");
          seen.summaryCut += 1;
        }
        expect({ ...content(second.back), summary: "" }).toEqual({ ...content(stored), summary: "" });
        // A third pass changes nothing at all.
        const third = throughPack(second.back, second.back.messages);
        if (third.back === null) throw new Error("the pack of an imported session was not imported");
        expect(content(third.back)).toEqual(content(second.back));
        expect(sessionContextPack(third.back, UTC)).toBe(third.pack);
      }),
      { seed: SEED, numRuns: 3000 },
    );
    expect(seen.imported).toBeGreaterThan(2000);
    expect(seen.notAsPack).toBeGreaterThan(50);
    // Most of these sessions lose something on the first pass.
    expect(seen.changed).toBeGreaterThan(1000);
    // How often the corner of the summary was met depends on the seed; the case above pins it.
    expect(seen.summaryCut).toBeLessThan(seen.imported);
  });
});
