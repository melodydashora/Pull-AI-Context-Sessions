/// <reference types="node" />
// The entry point for files (HANDOFF.md section 7, phase 1): a `.json` file whose `format` is
// "sessionvault-interchange" goes to the interchange reader, every other file goes to the
// transcript importer. openFile says which way a file went and returns that way's result.
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { importFile } from "../import/index.ts";
import { emptyVault, importDocument, readDocument } from "../interchange/index.ts";
import { type OpenedFile, type OpenedInterchange, type OpenedTranscript, openFile } from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
const WEB = new URL("../../../", import.meta.url);
const FIXTURES = new URL("fixtures/import/", WEB);

function bytesOf(url: URL): Uint8Array {
  return new Uint8Array(readFileSync(url));
}
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const EXAMPLE_BYTES = bytesOf(new URL("docs/example-vault-export.json", WEB));
const EXAMPLE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(EXAMPLE_BYTES);

function interchange(opened: OpenedFile): OpenedInterchange {
  if (opened.route !== "interchange") throw new Error(`the file went to the ${opened.route} route`);
  return opened;
}
function transcript(opened: OpenedFile): OpenedTranscript {
  if (opened.route !== "transcript") throw new Error(`the file went to the ${opened.route} route`);
  return opened;
}

/** A small interchange file with one session, as JSON text. */
function sessionDocument(
  changes: Record<string, unknown> = {},
  session: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    format: "sessionvault-interchange",
    version: 1,
    kind: "session",
    exported_at: "2026-11-20T08:00:00.000Z",
    projects: [],
    sessions: [
      {
        id: "5e550000-0000-4000-8000-0000000000aa",
        title: "Compost bin plan",
        provider: "claude",
        created_at: "2026-11-19T10:00:00.000Z",
        imported_at: "2026-11-19T10:00:00.000Z",
        messages: [
          {
            id: "0e55a9e0-0000-4000-8000-0000000000aa",
            index: 0,
            role: "user",
            segments: [{ type: "text", text: "How many bays?" }],
          },
        ],
        ...session,
      },
    ],
    ...changes,
  });
}

describe("a .json file whose format is 'sessionvault-interchange' goes to the interchange reader", () => {
  it("the example file: read, valid, six sessions and three projects", () => {
    const opened = interchange(openFile(EXAMPLE_BYTES, "example-vault-export.json"));
    expect(opened.flags).toEqual([]);
    if (!opened.result.ok) throw new Error("the example was refused");
    expect(opened.result.doc.kind).toBe("vault");
    expect(opened.result.doc.sessions).toHaveLength(6);
    expect(opened.result.doc.projects).toHaveLength(3);
    expect(opened.result.repairs.total).toBe(0);
    // The two attachments that come with bytes were decoded and checked.
    expect(opened.result.inlineBytes.size).toBe(2);
  });

  it("hands on the parsed JSON as the file has it, document-level extras included", () => {
    const opened = interchange(openFile(EXAMPLE_BYTES, "example-vault-export.json"));
    expect(opened.json).toEqual(JSON.parse(EXAMPLE_TEXT));
    expect(Object.keys(opened.json)).toContain("x_note");
    // The reader's answer is the one it gives when asked directly.
    expect(opened.result).toEqual(readDocument(JSON.parse(EXAMPLE_TEXT)));
  });

  it("that JSON merges into a vault through importDocument (6.7)", () => {
    const opened = interchange(openFile(EXAMPLE_BYTES, "example-vault-export.json"));
    const merged = importDocument(emptyVault(), opened.json, {
      now: new Date("2026-11-20T08:00:00.000Z"),
      newId: () => "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    if (!merged.ok) throw new Error("the example was refused");
    expect(merged.report.counts.added).toBe(6);
    expect(merged.vault.projects).toHaveLength(3);
  });

  it.each(["export.json", "export.JSON", "export.Json", "a.b.json", "x.json", "export.session.json"])(
    "the extension decides, in any letter case: %s",
    (name) => {
      expect(openFile(utf8(sessionDocument()), name).route).toBe("interchange");
    },
  );

  it("a file that needs repair is read, and says what was repaired (6.6)", () => {
    const upper = sessionDocument({}, { id: "5E550000-0000-4000-8000-0000000000AA", provider: "Claude" });
    const opened = interchange(openFile(utf8(upper), "repair.json"));
    if (!opened.result.ok) throw new Error("a repairable file was refused");
    expect(opened.result.doc.sessions[0]?.id).toBe("5e550000-0000-4000-8000-0000000000aa");
    expect(opened.result.doc.sessions[0]?.provider).toBe("claude");
    expect(opened.result.repairs.counts).toEqual({ id_lowercased: 1, value_folded: 1 });
    // The JSON handed on is still the file's own.
    expect(opened.json).toEqual(JSON.parse(upper));
  });

  it("a file of a later version is refused by the reader, and is never tried as a transcript (W3)", () => {
    const opened = interchange(openFile(utf8(sessionDocument({ version: 2 })), "newer.json"));
    expect(opened.result.ok).toBe(false);
    if (opened.result.ok) return;
    expect(opened.result.problems.items.map((problem) => problem.rule)).toEqual(["version"]);
  });

  it("a file with the marker and nothing else right is refused with its problems", () => {
    for (const text of [
      '{"format":"sessionvault-interchange"}',
      '{"format":"sessionvault-interchange","version":1}',
      '{"format":"sessionvault-interchange","version":1,"kind":"vault","exported_at":"x","projects":[],"sessions":{}}',
      sessionDocument({ sessions: [] }),
    ]) {
      const opened = interchange(openFile(utf8(text), "broken.json"));
      expect(opened.result.ok).toBe(false);
      if (!opened.result.ok) expect(opened.result.problems.total).toBeGreaterThan(0);
    }
  });

  it("the marker counts only as an own property of the top-level object, spelled exactly", () => {
    for (const text of [
      '{"format":"SessionVault-Interchange","version":1}',
      '{"format":"sessionvault-interchange "}',
      '{"Format":"sessionvault-interchange"}',
      '[{"format":"sessionvault-interchange"}]',
      '{"data":{"format":"sessionvault-interchange"}}',
      '{"format":["sessionvault-interchange"]}',
      '"sessionvault-interchange"',
    ]) {
      const opened = transcript(openFile(utf8(text), "other.json"));
      expect([opened.result.outcome, opened.result.reason]).toEqual(["rejected", "unrecognised_json"]);
    }
  });
});

describe("the bytes are decoded once, by the importer's rule (import-rules.md W2)", () => {
  const utf16le = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf16le"));
  const swapped = (bytes: Uint8Array): Uint8Array => {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out[i] = bytes[i + 1] ?? 0;
      out[i + 1] = bytes[i] ?? 0;
    }
    return out;
  };
  const withMark = (mark: number[], bytes: Uint8Array): Uint8Array => new Uint8Array([...mark, ...bytes]);
  const expected = readDocument(EXAMPLE_TEXT);

  it("UTF-8 with a byte-order mark: the same document, and no flag", () => {
    const opened = interchange(openFile(withMark([0xef, 0xbb, 0xbf], EXAMPLE_BYTES), "bom.json"));
    expect(opened.flags).toEqual([]);
    expect(opened.result).toEqual(expected);
  });

  it("UTF-16 little-endian and big-endian with a mark: the same document, and the flag of the encoding", () => {
    const little = interchange(openFile(withMark([0xff, 0xfe], utf16le(EXAMPLE_TEXT)), "utf16le.json"));
    expect(little.flags).toEqual(["decoded_as_utf_16le"]);
    expect(little.result).toEqual(expected);
    const big = interchange(openFile(withMark([0xfe, 0xff], swapped(utf16le(EXAMPLE_TEXT))), "utf16be.json"));
    expect(big.flags).toEqual(["decoded_as_utf_16be"]);
    expect(big.result).toEqual(expected);
  });

  it("windows-1252: the letter outside ASCII is read as that encoding has it, and the flag says so", () => {
    // The example has U+00E9 in session 6: one byte, E9, in windows-1252.
    const latin = new Uint8Array(Buffer.from(EXAMPLE_TEXT, "latin1"));
    expect(latin.length).toBeLessThan(EXAMPLE_BYTES.length);
    const opened = interchange(openFile(latin, "ansi.json"));
    expect(opened.flags).toEqual(["decoded_as_windows_1252"]);
    expect(opened.result).toEqual(expected);
  });

  it("CR LF line endings between the JSON tokens change nothing", () => {
    const windows = utf8(EXAMPLE_TEXT.replaceAll("\n", "\r\n"));
    expect(windows.length).toBeGreaterThan(EXAMPLE_BYTES.length);
    expect(interchange(openFile(windows, "crlf.json")).result).toEqual(expected);
  });
});

describe("every other file goes to the transcript importer", () => {
  // import-rules.md 2.1: ".json" has a leading dot and "export.json " a space: neither has an extension.
  it.each([
    "export.txt",
    "export.md",
    "export",
    "export.json.txt",
    "export.jsonl",
    "json",
    ".json",
    "export.json ",
  ])("an interchange document under the name %j is no .json file: it is read as text", (name) => {
    const opened = transcript(openFile(utf8(sessionDocument()), name));
    expect(opened.result.outcome).toBe("imported");
    // C2: the extension decides. The text of the file becomes one note.
    expect(opened.result.sessions).toHaveLength(1);
    expect(opened.result.sessions[0]?.messages).toHaveLength(1);
    expect(
      opened.result.sessions[0]?.messages[0]?.text.startsWith('{"format":"sessionvault-interchange"'),
    ).toBe(true);
  });

  it("with asPlainText an interchange file is sent to the text parsers on purpose (W3)", () => {
    const opened = transcript(openFile(utf8(sessionDocument()), "export.json", { asPlainText: true }));
    expect(opened.result.outcome).toBe("imported");
    expect(opened.result.sessions[0]?.title).toBe("export");
  });

  it("a .json file that is another known format is imported; one that is none is refused, not kept as a note", () => {
    const chatgpt = transcript(
      openFile(bytesOf(new URL("07-chatgpt-export.input.json", FIXTURES)), "conversations.json"),
    );
    expect(chatgpt.result.outcome).toBe("imported");
    expect(chatgpt.result.sessions).toHaveLength(2);
    const payload = transcript(
      openFile(
        bytesOf(new URL("12-json-not-a-chat-export.input.json", FIXTURES)),
        "session_EXAMPLEPAYLOAD.json",
      ),
    );
    expect([payload.result.outcome, payload.result.reason]).toEqual(["rejected", "unrecognised_json"]);
    for (const text of ["{", "not json at all", "null", "[]", "{}", "42", '{"format":"something-else"}']) {
      const opened = transcript(openFile(utf8(text), "data.json"));
      expect([text, opened.result.outcome, opened.result.reason]).toEqual([
        text,
        "rejected",
        "unrecognised_json",
      ]);
    }
  });

  it("no bytes, white space only, and bytes that are no text", () => {
    expect(transcript(openFile(new Uint8Array(), "empty.json")).result.reason).toBe("empty_input");
    expect(transcript(openFile(new Uint8Array(), "empty.txt")).result.reason).toBe("empty_input");
    expect(transcript(openFile(utf8(" \n\t "), "blank.json")).result.reason).toBe("empty_input");
    expect(
      transcript(openFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]), "image.json")).result
        .reason,
    ).toBe("undecodable");
  });
});

interface FileCase {
  readonly id: string;
  readonly input: string;
  readonly filename: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly sessions: number;
  readonly flags: readonly string[];
}

/** The file fixtures of the manifest with what their target expects. Never an Apple file. */
function fileCases(): FileCase[] {
  const parse = (name: string): unknown =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytesOf(new URL(name, FIXTURES))));
  const record = (value: unknown, what: string): Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error(`${what}: no object`);
    return Object.fromEntries(Object.entries(value));
  };
  const text = (value: unknown, what: string): string => {
    if (typeof value !== "string") throw new Error(`${what}: no string`);
    return value;
  };
  const list = (value: unknown, what: string): unknown[] => {
    if (!Array.isArray(value)) throw new Error(`${what}: no array`);
    return value;
  };
  const cases: FileCase[] = [];
  for (const item of list(record(parse("manifest.json"), "manifest").cases, "cases")) {
    const entry = record(item, "case");
    if (entry.entry !== "file") continue;
    const targets = record(entry.expected, "expected");
    const target = text(targets.web ?? targets.both, "target");
    if (target.includes(".apple.")) throw new Error("the target is an Apple file");
    const result = record(record(parse(target), target).result, "result");
    cases.push({
      id: text(entry.id, "id"),
      input: text(entry.input, "input"),
      filename: text(record(entry.call, "call").filename, "filename"),
      outcome: text(result.outcome, "outcome"),
      reason: result.reason === null ? null : text(result.reason, "reason"),
      sessions: list(result.sessions, "sessions").length,
      flags: list(result.flags, "flags").map((flag) => text(flag, "flag")),
    });
  }
  return cases;
}

describe("the 25 file fixtures of fixtures/import go to the transcript importer, with the result their target states", () => {
  const cases = fileCases();

  it("there are 25, and none of them is an interchange file", () => {
    expect(cases).toHaveLength(25);
  });

  it.each(cases)("$id", (fixture) => {
    const bytes = bytesOf(new URL(fixture.input, FIXTURES));
    const opened = transcript(openFile(bytes, fixture.filename));
    expect(opened.result.outcome).toBe(fixture.outcome);
    expect(opened.result.reason).toBe(fixture.reason);
    expect(opened.result.sessions).toHaveLength(fixture.sessions);
    expect([...opened.result.flags].sort()).toEqual([...fixture.flags].sort());
    // And it is what the importer itself answers for the file.
    expect(opened.result).toEqual(importFile(bytes, fixture.filename));
  });
});

describe("the options for an interchange file", () => {
  const PROJECT = "aaaaaaaa-0000-4000-8000-0000000000bb";
  const withProject = utf8(sessionDocument({}, { project_id: PROJECT }));

  it("a project the file does not list is dropped with a warning, unless the destination vault has it (repair 8)", () => {
    const alone = interchange(openFile(withProject, "session.json"));
    if (!alone.result.ok) throw new Error("the file was refused");
    expect(alone.result.doc.sessions[0]?.project_id).toBeNull();
    expect(alone.result.warnings.counts).toEqual({ project_missing: 1 });

    const known = interchange(
      openFile(withProject, "session.json", { destinationProjectIds: new Set([PROJECT]) }),
    );
    if (!known.result.ok) throw new Error("the file was refused");
    expect(known.result.doc.sessions[0]?.project_id).toBe(PROJECT);
    expect(known.result.warnings.total).toBe(0);
  });

  it("the limits reach the reader", () => {
    const nested = `{"format":"sessionvault-interchange","version":1,"x_deep":${"[".repeat(200)}${"]".repeat(200)}}`;
    const defaults = interchange(openFile(utf8(nested), "deep.json"));
    expect(defaults.result.ok).toBe(false);
    if (!defaults.result.ok)
      expect(defaults.result.problems.items.some((problem) => problem.rule === "limit")).toBe(true);

    const tight = interchange(openFile(EXAMPLE_BYTES, "example.json", { limits: { maxNodes: 10 } }));
    expect(tight.result.ok).toBe(false);
    if (!tight.result.ok)
      expect(tight.result.problems.items.map((problem) => problem.rule)).toEqual(["limit"]);

    const listed = interchange(
      openFile(utf8(sessionDocument({ projects: 1, sessions: 2, kind: 3 })), "wrong.json", {
        limits: { maxListed: 1 },
      }),
    );
    expect(listed.result.ok).toBe(false);
    if (!listed.result.ok) {
      expect(listed.result.problems.items).toHaveLength(1);
      expect(listed.result.problems.total).toBeGreaterThan(1);
    }
  });
});

describe("nothing is thrown, whatever is handed in", () => {
  it("arguments of the wrong type end in a rejection of the transcript route", () => {
    const wrong: readonly unknown[][] = [
      [undefined, "a.json"],
      [null, "a.json"],
      ["text, not bytes", "a.json"],
      [[1, 2, 3], "a.json"],
      [new ArrayBuffer(4), "a.json"],
      [EXAMPLE_BYTES, undefined],
      [EXAMPLE_BYTES, null],
      [EXAMPLE_BYTES, 42],
      [EXAMPLE_BYTES, "a.json", null],
      [EXAMPLE_BYTES, "a.json", "options"],
    ];
    for (const args of wrong) {
      const opened: unknown = Reflect.apply(openFile, undefined, args);
      expect(opened).toMatchObject({ route: expect.stringMatching(/^(transcript|interchange)$/) });
    }
    // Bytes that are no byte array are not text; a name that is no string has no extension.
    expect(Reflect.apply(openFile, undefined, ["text", "a.json"])).toMatchObject({
      route: "transcript",
      result: { outcome: "rejected", reason: "undecodable" },
    });
    expect(Reflect.apply(openFile, undefined, [EXAMPLE_BYTES, 42])).toMatchObject({ route: "transcript" });
  });

  it("generated bytes under generated names", () => {
    const name = fc.constantFrom("a.json", "a.JSON", "a.txt", "a.md", "a", "", ".json");
    const body = fc.oneof(
      fc.uint8Array({ maxLength: 64, size: "max" }),
      // A JSON object that carries the marker, with any of these properties behind it.
      fc
        .subarray([
          ',"version":1',
          ',"kind":"vault"',
          ',"exported_at":"2026-11-20T08:00:00.000Z"',
          ',"projects":[]',
          ',"sessions":[]',
          ',"x":[{}]',
        ])
        .map((parts) => utf8(`{"format":"sessionvault-interchange"${parts.join("")}}`)),
      fc
        .array(
          fc.constantFrom(
            '{"format":"sessionvault-interchange"',
            ',"version":1',
            ',"version":2',
            ',"kind":"vault"',
            ',"sessions":[]',
            ',"projects":[{}]',
            "}",
            "[",
            "]",
            '"',
            "\\",
            "\u0000",
            "User: hi\n",
          ),
          { maxLength: 8, size: "max" },
        )
        .map((parts) => utf8(parts.join(""))),
    );
    const seen = { interchange: 0, transcript: 0 };
    fc.assert(
      fc.property(body, name, fc.boolean(), (bytes, filename, plain) => {
        const opened = openFile(bytes, filename, plain ? { asPlainText: true } : undefined);
        seen[opened.route] += 1;
        if (opened.route === "interchange") {
          // Only a .json file, read as JSON, can go this way.
          expect(filename.toLowerCase().endsWith(".json")).toBe(true);
          expect(plain).toBe(false);
          expect(opened.json.format).toBe("sessionvault-interchange");
        } else {
          expect(["imported", "rejected"]).toContain(opened.result.outcome);
        }
      }),
      { seed: SEED, numRuns: 3000 },
    );
    expect(seen.interchange).toBeGreaterThan(100);
    expect(seen.transcript).toBeGreaterThan(1000);
  });

  it("a vault file of 2,000 sessions is read in well under ten seconds", () => {
    const sessions = Array.from({ length: 2000 }, (_, index) => {
      const suffix = String(index).padStart(12, "0");
      return {
        id: `5e550000-0000-4000-8000-${suffix}`,
        title: `Session ${index}`,
        provider: "other",
        created_at: "2026-11-19T10:00:00.000Z",
        imported_at: "2026-11-19T10:00:00.000Z",
        messages: [
          {
            id: `0e55a9e0-0000-4000-8000-${suffix}`,
            index: 0,
            role: "user",
            segments: [{ type: "text", text: "x".repeat(500) }],
          },
        ],
      };
    });
    const text = JSON.parse(sessionDocument({ kind: "vault", sessions }));
    const started = performance.now();
    const opened = interchange(openFile(utf8(JSON.stringify(text)), "vault.json"));
    expect(performance.now() - started).toBeLessThan(10_000);
    if (!opened.result.ok) throw new Error("the vault file was refused");
    expect(opened.result.doc.sessions).toHaveLength(2000);
  });
});
