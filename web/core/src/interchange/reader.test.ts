/// <reference types="node" />
// The reader of data-model.md 6.6: the repair list item by item, the canonical forms of 6.1 and
// 6.2, and what stays a problem after repair.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  isInterchangeDocument,
  type Notice,
  type Problem,
  type ReadOptions,
  readDocument,
  validateDocument,
} from "./index.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const EXAMPLE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(
  readFileSync(new URL("../../../docs/example-vault-export.json", import.meta.url)),
);
const example = () => JSON.parse(EXAMPLE_TEXT);

function read(input: unknown, options?: ReadOptions) {
  const result = readDocument(input, options);
  if (!result.ok)
    throw new Error(`refused: ${result.problems.items.map((p) => `${p.rule} ${p.path}`).join(", ")}`);
  return result;
}

function refused(input: unknown, options?: ReadOptions): readonly Problem[] {
  const result = readDocument(input, options);
  if (result.ok) throw new Error("the document should have been refused");
  expect(result.problems.total).toBe(result.problems.items.length);
  return result.problems.items;
}

const codes = (notices: readonly Notice[]): string[] =>
  notices.map((notice) => `${notice.code} ${notice.path}`);
const brief = (problems: readonly Problem[]): string[] =>
  problems.map((p) => `${p.rule}${p.keyword === undefined ? "" : `:${p.keyword}`} ${p.path}`);

describe("format and version are checked first (6.1)", () => {
  it("another format is refused with one problem, whatever else is wrong", () => {
    const document = example();
    document.format = "something-else";
    document.sessions = "not even an array";
    expect(brief(refused(document))).toEqual(["format /format"]);
    delete document.format;
    expect(brief(refused(document))).toEqual(["format /format"]);
  });

  it("a larger version is refused with a clear message and nothing else is looked at", () => {
    const document = example();
    document.version = 2;
    document.sessions = null;
    expect(refused(document)).toEqual([
      {
        rule: "version",
        path: "/version",
        message:
          "The file was written in a newer version of the format; this app reads version 1. Nothing was imported.",
      },
    ]);
    document.version = 1.5;
    expect(refused(document)[0]?.message).toContain("newer version");
  });

  it("any other version value is refused too", () => {
    for (const version of [0, -1, "1", null, [1], true]) {
      const document = example();
      document.version = version;
      expect(refused(document)).toEqual([
        { rule: "version", path: "/version", message: "The format version must be 1." },
      ]);
    }
    const document = example();
    delete document.version;
    expect(brief(refused(document))).toEqual(["version /version"]);
  });

  it("the marker tells interchange files from other JSON", () => {
    expect(isInterchangeDocument(example())).toBe(true);
    expect(isInterchangeDocument({ format: "sessionvault-interchange" })).toBe(true);
    expect(isInterchangeDocument({ format: "sessionvault-interchange", version: 99 })).toBe(true);
    expect(isInterchangeDocument({ Format: "sessionvault-interchange" })).toBe(false);
    expect(isInterchangeDocument([{ title: "A ChatGPT export", mapping: {} }])).toBe(false);
    expect(isInterchangeDocument(Object.create({ format: "sessionvault-interchange" }))).toBe(false);
    expect(isInterchangeDocument(EXAMPLE_TEXT)).toBe(false);
    expect(isInterchangeDocument(undefined)).toBe(false);
  });
});

describe("repair 1: lower-case all ids", () => {
  it("lower-cases project, session, message ids and project references, and reports each", () => {
    const document = example();
    document.projects[0].id = "AAAAAAAA-0000-4000-8000-000000000001";
    document.sessions[0].id = "5E550000-0000-4000-8000-000000000001";
    document.sessions[0].project_id = "AaAaAaAa-0000-4000-8000-000000000001";
    document.sessions[0].messages[1].id = "0E55A9E0-0001-4000-8000-000000000001";
    const result = read(document);
    expect(result.doc).toEqual(example());
    expect(codes(result.repairs.items)).toEqual([
      "id_lowercased /projects/0/id",
      "id_lowercased /sessions/0/id",
      "id_lowercased /sessions/0/project_id",
      "id_lowercased /sessions/0/messages/1/id",
    ]);
  });

  it("finds duplicates only after lower-casing (R2)", () => {
    const document = example();
    document.projects[1].id = document.projects[0].id.toUpperCase();
    document.sessions[1].project_id = document.projects[0].id;
    document.sessions[4].project_id = document.projects[0].id;
    expect(brief(refused(document))).toEqual(["R2 /projects/1/id"]);
  });

  it("lower-cases hashes too: the sha256 of a descriptor and of an attachment segment (corrections.md 2, point 5)", () => {
    const document = example();
    document.sessions[1].attachments[0].sha256 = document.sessions[1].attachments[0].sha256.toUpperCase();
    document.sessions[2].messages[2].segments[1].sha256 =
      document.sessions[2].messages[2].segments[1].sha256.toUpperCase();
    const result = read(document);
    expect(result.doc).toEqual(example());
    expect(codes(result.repairs.items)).toEqual([
      "id_lowercased /sessions/1/attachments/0/sha256",
      "id_lowercased /sessions/2/messages/2/segments/1/sha256",
    ]);
    // A writer must write them in lower case: strict validation does not repair.
    expect(brief(validateDocument(document).problems.items)).toEqual([
      "schema:pattern /sessions/1/attachments/0/sha256",
      "schema:pattern /sessions/2/messages/2/segments/1/sha256",
    ]);
  });

  it("leaves what is not a UUID alone", () => {
    for (const bad of [
      "",
      "ABC",
      "aaaaaaaa-0000-4000-8000-00000000000g",
      "aaaaaaaa00004000800000000000000001",
      "{aaaaaaaa-0000-4000-8000-000000000001}",
    ]) {
      const document = example();
      document.sessions[3].id = bad;
      expect(brief(refused(document)), bad).toEqual(["schema:pattern /sessions/3/id"]);
    }
  });
});

describe("repair 2 and 6.2: provider and role", () => {
  const withProvider = (provider: unknown) => {
    const document = example();
    document.sessions[0].provider = provider;
    return document;
  };
  const withRole = (role: unknown) => {
    const document = example();
    document.sessions[0].messages[0].role = role;
    return document;
  };

  it("matches known providers without case, trimmed, and stores them in lower case", () => {
    const cases: [string, string][] = [
      ["Claude", "claude"],
      ["CHATGPT", "chatgpt"],
      [" Gemini\t", "gemini"],
      ["Other", "other"],
      ["ChatGPT", "chatgpt"],
    ];
    for (const [written, stored] of cases) {
      const result = read(withProvider(written));
      expect(result.doc.sessions[0]?.provider, written).toBe(stored);
      expect(codes(result.repairs.items), written).toEqual(["value_folded /sessions/0/provider"]);
    }
  });

  it("stores any other provider trimmed and otherwise unchanged", () => {
    expect(read(withProvider("ExampleBot")).doc.sessions[0]?.provider).toBe("ExampleBot");
    expect(read(withProvider("ExampleBot")).repairs.total).toBe(0);
    const spaced = read(withProvider("  Example Bot 2 "));
    expect(spaced.doc.sessions[0]?.provider).toBe("Example Bot 2");
    expect(codes(spaced.repairs.items)).toEqual(["value_folded /sessions/0/provider"]);
  });

  it('makes an empty provider "other"', () => {
    for (const empty of ["", " ", "\n\t "]) {
      const result = read(withProvider(empty));
      expect(result.doc.sessions[0]?.provider).toBe("other");
      expect(result.repairs.counts).toEqual({ value_folded: 1 });
    }
  });

  it('does the same for roles, with the fallback "unknown"', () => {
    const cases: [string, string][] = [
      ["User", "user"],
      ["ASSISTANT", "assistant"],
      [" System ", "system"],
      ["Unknown", "unknown"],
      ["", "unknown"],
      ["  ", "unknown"],
      ["Tool", "Tool"],
      [" subagent ", "subagent"],
    ];
    for (const [written, stored] of cases) {
      expect(read(withRole(written)).doc.sessions[0]?.messages[0]?.role, JSON.stringify(written)).toBe(
        stored,
      );
    }
    expect(read(withRole("tool")).repairs.total).toBe(0);
  });

  it("keeps attachment kinds and segment types exactly as written", () => {
    const document = example();
    document.sessions[1].attachments[0].kind = " Original_PDF ";
    document.sessions[4].messages[2].segments[1].type = " X_Table ";
    const result = read(document);
    expect(result.repairs.total).toBe(0);
    expect(result.doc.sessions[1]?.attachments[0]?.kind).toBe(" Original_PDF ");
    expect(result.doc.sessions[4]?.messages[2]?.segments[1]?.type).toBe(" X_Table ");
  });

  it("refuses a provider or role that is not a string, and an empty one only in strict validation", () => {
    expect(brief(refused(withProvider(null)))).toEqual(["schema:type /sessions/0/provider"]);
    expect(brief(refused(withRole(7)))).toEqual(["schema:type /sessions/0/messages/0/role"]);
    expect(brief(validateDocument(withProvider("")).problems.items)).toEqual([
      "schema:minLength /sessions/0/provider",
    ]);
    expect(validateDocument(withProvider("Claude")).ok).toBe(true);
  });
});

describe("repair 3: null or missing stands for the default", () => {
  it("fills every optional property of a minimal document", () => {
    const minimal = {
      format: "sessionvault-interchange",
      version: 1,
      kind: "vault",
      exported_at: "2026-11-19T12:00:00Z",
      projects: [
        { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Garden", created_at: "2026-07-20T08:15:00Z" },
      ],
      sessions: [
        {
          id: "5e550000-0000-4000-8000-000000000001",
          title: "",
          provider: "claude",
          created_at: "2026-03-14T09:30:00Z",
          imported_at: "2026-03-15T18:02:11.482Z",
          attachments: [
            { kind: "original_pdf", sha256: "0".repeat(64), media_type: "application/pdf", byte_length: 0 },
          ],
          messages: [
            {
              id: "0e55a9e0-0001-4000-8000-000000000000",
              index: 0,
              role: "user",
              segments: [{ type: "text", text: "" }],
            },
          ],
        },
      ],
    };
    // Valid as it stands: the schema requires nothing more.
    expect(validateDocument(minimal).ok).toBe(true);
    const result = read(minimal);
    // Missing optional properties are not repairs.
    expect(result.repairs.total).toBe(0);
    expect(result.doc).toEqual({
      format: "sessionvault-interchange",
      version: 1,
      kind: "vault",
      exported_at: "2026-11-19T12:00:00.000Z",
      projects: [
        {
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          name: "Garden",
          created_at: "2026-07-20T08:15:00.000Z",
          // project: updated_at -> created_at
          updated_at: "2026-07-20T08:15:00.000Z",
        },
      ],
      sessions: [
        {
          id: "5e550000-0000-4000-8000-000000000001",
          title: "",
          provider: "claude",
          model: "",
          source_url: "",
          summary: "",
          tags: [],
          is_pinned: false,
          created_at: "2026-03-14T09:30:00.000Z",
          imported_at: "2026-03-15T18:02:11.482Z",
          // session: updated_at -> imported_at
          updated_at: "2026-03-15T18:02:11.482Z",
          project_id: null,
          attachments: [
            {
              kind: "original_pdf",
              sha256: "0".repeat(64),
              media_type: "application/pdf",
              byte_length: 0,
              filename: "",
              // attachment: created_at -> the session's imported_at
              created_at: "2026-03-15T18:02:11.482Z",
            },
          ],
          // A message's created_at and model stay absent when absent.
          messages: [
            {
              id: "0e55a9e0-0001-4000-8000-000000000000",
              index: 0,
              role: "user",
              segments: [{ type: "text", text: "" }],
            },
          ],
        },
      ],
    });
  });

  it("treats null like missing and reports it", () => {
    const document = example();
    const session = document.sessions[1];
    Object.assign(session, {
      model: null,
      source_url: null,
      summary: null,
      tags: null,
      is_pinned: null,
      updated_at: null,
    });
    session.attachments[0].filename = null;
    session.attachments[0].created_at = null;
    session.attachments[0].data_base64 = null;
    session.messages[0].created_at = null;
    session.messages[0].model = null;
    document.projects[1].updated_at = null;
    document.generator = null;
    const result = read(document);
    expect(codes(result.repairs.items)).toEqual([
      "null_default /generator",
      "null_default /projects/1/updated_at",
      "null_default /sessions/1/model",
      "null_default /sessions/1/source_url",
      "null_default /sessions/1/summary",
      "null_default /sessions/1/tags",
      "null_default /sessions/1/is_pinned",
      "null_default /sessions/1/updated_at",
      "null_default /sessions/1/attachments/0/filename",
      "null_default /sessions/1/attachments/0/created_at",
      "null_default /sessions/1/attachments/0/data_base64",
      "null_default /sessions/1/messages/0/created_at",
      "null_default /sessions/1/messages/0/model",
    ]);
    const stored = result.doc.sessions[1];
    expect(stored).toMatchObject({ model: "", source_url: "", summary: "", tags: [], is_pinned: false });
    expect(stored?.updated_at).toBe(stored?.imported_at);
    expect(stored?.attachments[0]).toMatchObject({ filename: "", created_at: stored?.imported_at });
    expect(stored?.attachments[0]).not.toHaveProperty("data_base64");
    expect(Object.keys(stored?.messages[0] ?? {})).toEqual(["id", "index", "role", "segments"]);
    expect(result.doc.projects[1]?.updated_at).toBe(result.doc.projects[1]?.created_at);
    expect(result.doc).not.toHaveProperty("generator");
    // The strict validator accepts none of these nulls.
    expect(validateDocument(document).problems.total).toBe(13);
  });

  it("a null project_id is a value, not a repair; a missing one is null", () => {
    const document = example();
    delete document.sessions[0].project_id;
    const result = read(document);
    expect(result.doc.sessions[0]?.project_id).toBeNull();
    expect(result.repairs.total).toBe(0);
  });

  it("does not invent values for required properties", () => {
    for (const [key, path] of [
      ["title", "/sessions/0/title"],
      ["provider", "/sessions/0/provider"],
      ["created_at", "/sessions/0/created_at"],
      ["imported_at", "/sessions/0/imported_at"],
      ["messages", "/sessions/0/messages"],
      ["id", "/sessions/0/id"],
    ]) {
      const missing = example();
      delete missing.sessions[0][key ?? ""];
      expect(brief(refused(missing)), key).toEqual([`schema:required ${path}`]);
      const asNull = example();
      asNull.sessions[0][key ?? ""] = null;
      expect(brief(refused(asNull)), key).toEqual([`schema:type ${path}`]);
    }
  });

  it("an empty model on a message means not set and is left out", () => {
    const document = example();
    document.sessions[0].messages[0].model = "";
    const result = read(document);
    expect(result.doc.sessions[0]?.messages[0]).not.toHaveProperty("model");
    expect(result.doc).toEqual(example());
    // A session's model is a different property: it is always written.
    expect(result.doc.sessions[1]?.model).toBe("");
  });
});

describe("repair 4: tags", () => {
  const tagsOf = (tags: unknown) => {
    const document = example();
    document.sessions[0].tags = tags;
    return read(document);
  };

  it("trims, lower-cases, strips leading #, splits on commas, drops empties and repeats", () => {
    const result = tagsOf([
      "Garden",
      " Bikes ",
      "",
      "garden",
      "  Two Words ",
      "#hash",
      "a,b , A",
      "##x",
      "   ",
    ]);
    expect(result.doc.sessions[0]?.tags).toEqual(["garden", "bikes", "two words", "hash", "a", "b", "x"]);
    expect(codes(result.repairs.items)).toEqual(["tags_normalised /sessions/0/tags"]);
  });

  it("leaves normal tags alone and says nothing", () => {
    const result = tagsOf(["garden", "two words", "\u00E9t\u00E9", "a#b", "c#"]);
    expect(result.doc.sessions[0]?.tags).toEqual(["garden", "two words", "\u00E9t\u00E9", "a#b", "c#"]);
    expect(result.repairs.total).toBe(0);
  });

  it("gives a tag that needs no further repair when read again", () => {
    // One pass of parseTags would turn "# #a" into "#a", and the next reading into "a".
    const result = tagsOf(["# #a", "#\t# # b", "#"]);
    expect(result.doc.sessions[0]?.tags).toEqual(["a", "b"]);
    const again = read(result.doc);
    expect(again.repairs.total).toBe(0);
    expect(again.doc).toEqual(result.doc);
  });

  it("refuses tags that are not strings, and a tags value that is no array", () => {
    const withNumber = example();
    withNumber.sessions[0].tags = ["a", 5, null];
    expect(brief(refused(withNumber))).toEqual([
      "schema:type /sessions/0/tags/1",
      "schema:type /sessions/0/tags/2",
    ]);
    const asString = example();
    asString.sessions[0].tags = "garden, bikes";
    expect(brief(refused(asString))).toEqual(["schema:type /sessions/0/tags"]);
  });

  it("strict validation names each breach instead: empty, comma, repeat, case, white space", () => {
    const document = example();
    document.sessions[0].tags = ["", "a,b", "x", "x", "Upper", " padded"];
    expect(brief(validateDocument(document).problems.items)).toEqual([
      "schema:minLength /sessions/0/tags/0",
      "schema:pattern /sessions/0/tags/1",
      "schema:uniqueItems /sessions/0/tags/3",
      "R4 /sessions/0/tags/4",
      "R4 /sessions/0/tags/5",
    ]);
  });
});

describe("repair 5: strings", () => {
  it("removes U+0000 and replaces lone surrogates in every string, also in unknown properties", () => {
    const document = example();
    document.sessions[0].title = "A\u0000B";
    document.sessions[0].summary = "half \uD83D pair";
    document.sessions[0].messages[0].segments[0].text = "\u0000start \uDE00 end\u0000";
    document.sessions[4].x_capture.note = ["nested\u0000", { key: "v\uDFFF" }];
    document.projects[0].name = "Bike\u0000 workshop";
    const result = read(document);
    expect(result.doc.sessions[0]?.title).toBe("AB");
    expect(result.doc.sessions[0]?.summary).toBe("half \uFFFD pair");
    expect(result.doc.sessions[0]?.messages[0]?.segments[0]?.text).toBe("start \uFFFD end");
    expect(result.doc.sessions[4]?.x_capture).toEqual({
      method: "paste",
      note: ["nested", { key: "v\uFFFD" }],
    });
    expect(result.doc.projects[0]?.name).toBe("Bike workshop");
    expect(result.repairs.counts).toEqual({ string_cleaned: 6 });
    expect(result.warnings.total).toBe(0);
    expect(validateDocument(result.doc).ok).toBe(true);
    // Strict validation calls each of them R9.
    expect(validateDocument(document).problems.items.map((p) => p.rule)).toEqual(
      Array.from({ length: 6 }, () => "R9"),
    );
  });

  it("drops a property whose NAME holds U+0000 or a lone surrogate, with a warning (corrections.md 2)", () => {
    const document = example();
    document.sessions[4].x_capture.note = [
      "nested",
      { "k\u0000ey": "v\uDFFF", kept: 1, "half\uD83D": [1, 2] },
    ];
    const result = read(document);
    // The value goes with the name: it is neither cleaned nor kept.
    expect(result.doc.sessions[4]?.x_capture).toEqual({ method: "paste", note: ["nested", { kept: 1 }] });
    expect(result.repairs.total).toBe(0);
    expect(result.warnings.counts).toEqual({ property_dropped: 2 });
    expect(validateDocument(result.doc).ok).toBe(true);
    // A writer may not emit such a name at all: R9, for each name and for the string under the first.
    expect(validateDocument(document).problems.items.map((p) => p.rule)).toEqual(["R9", "R9", "R9"]);
  });

  it("keeps valid surrogate pairs and other unusual characters", () => {
    const document = example();
    const text = "\u{1F600} \u{10FFFF} \uFFFD \uFEFF \u200B tab\t";
    document.sessions[0].messages[0].segments[0].text = text;
    const result = read(document);
    expect(result.doc.sessions[0]?.messages[0]?.segments[0]?.text).toBe(text);
    expect(result.repairs.total).toBe(0);
  });

  it("turns CR LF and CR into LF in text segments only", () => {
    const document = example();
    document.sessions[0].messages[0].segments[0].text = "one\r\ntwo\rthree\n\r\nfour";
    document.sessions[0].summary = "kept\r\nas written";
    document.sessions[0].title = "also\rkept";
    document.sessions[4].messages[2].segments[1].rows = [["carrot\r\n", "0.40"]];
    const result = read(document);
    expect(result.doc.sessions[0]?.messages[0]?.segments[0]?.text).toBe("one\ntwo\nthree\n\nfour");
    expect(result.doc.sessions[0]?.summary).toBe("kept\r\nas written");
    expect(result.doc.sessions[0]?.title).toBe("also\rkept");
    expect(result.doc.sessions[4]?.messages[2]?.segments[1]?.rows).toEqual([["carrot\r\n", "0.40"]]);
    expect(codes(result.repairs.items)).toEqual(["line_endings /sessions/0/messages/0/segments/0/text"]);
  });

  it("a name is never cleaned into another name: such properties are dropped, the clean one stays", () => {
    const text = EXAMPLE_TEXT.replace(
      '"x_color": "green"',
      '"x_color": "green", "x_\\u0000color": "red", "x_c\\u0000olor": "blue"',
    );
    const result = read(text);
    expect(result.doc.projects[1]?.x_color).toBe("green");
    expect(Object.keys(result.doc.projects[1] ?? {})).toEqual([
      "id",
      "name",
      "created_at",
      "updated_at",
      "x_color",
    ]);
    expect(result.repairs.total).toBe(0);
    expect(result.warnings.counts).toEqual({ property_dropped: 2 });
    // Also when the name would be a known one after cleaning: it is not that property.
    const title = EXAMPLE_TEXT.replace('"title": "Untitled"', '"ti\\u0000tle": "Untitled"');
    expect(title).not.toBe(EXAMPLE_TEXT);
    expect(brief(refused(title))).toEqual(["schema:required /sessions/3/title"]);
  });

  it("a string that is empty after cleaning is judged as the empty string", () => {
    const name = example();
    name.projects[0].name = "\u0000";
    expect(brief(refused(name))).toEqual(["schema:minLength /projects/0/name"]);
    const provider = example();
    provider.sessions[0].provider = "\u0000";
    expect(read(provider).doc.sessions[0]?.provider).toBe("other");
  });
});

describe("repair 6: messages are sorted by index and renumbered", () => {
  const withIndexes = (indexes: unknown[]) => {
    const document = example();
    const messages = document.sessions[0].messages;
    indexes.forEach((index, i) => {
      messages[i].index = index;
    });
    return document;
  };
  const order = (document: unknown): string[] =>
    read(document).doc.sessions[0]?.messages.map((m) => `${m.index}:${m.id.slice(-1)}`) ?? [];

  it("sorts by index, keeps the array order among equal indexes, and renumbers from 0", () => {
    expect(order(withIndexes([3, 2, 1, 0]))).toEqual(["0:3", "1:2", "2:1", "3:0"]);
    expect(order(withIndexes([10, 20, 30, 40]))).toEqual(["0:0", "1:1", "2:2", "3:3"]);
    expect(order(withIndexes([1, 1, 0, 0]))).toEqual(["0:2", "1:3", "2:0", "3:1"]);
    expect(order(withIndexes([5, 5, 5, 5]))).toEqual(["0:0", "1:1", "2:2", "3:3"]);
    expect(order(withIndexes([0, 1, 2, 2]))).toEqual(["0:0", "1:1", "2:2", "3:3"]);
    // Whatever number can be sorted by is good enough for a reader.
    expect(order(withIndexes([-1, 2.5, 1e9, -7]))).toEqual(["0:3", "1:0", "2:1", "3:2"]);
  });

  it("reports one repair per session, and none when the indexes are right", () => {
    expect(codes(read(withIndexes([3, 2, 1, 0])).repairs.items)).toEqual([
      "messages_renumbered /sessions/0/messages",
    ]);
    expect(read(withIndexes([0, 1, 2, 3])).repairs.total).toBe(0);
  });

  it("does not make up an index that is missing or not a number", () => {
    const missing = example();
    delete missing.sessions[0].messages[1].index;
    expect(brief(refused(missing))).toEqual(["schema:required /sessions/0/messages/1/index"]);
    expect(brief(refused(withIndexes(["0", 1, 2, 3])))).toEqual(["schema:type /sessions/0/messages/0/index"]);
    expect(brief(refused(withIndexes([0, null, 2, 3])))).toEqual([
      "schema:type /sessions/0/messages/1/index",
    ]);
  });

  it("strict validation wants the schema's integer and the exact position", () => {
    expect(brief(validateDocument(withIndexes([0, 1.5, 2, 3])).problems.items)).toEqual([
      "schema:type /sessions/0/messages/1/index",
    ]);
    expect(brief(validateDocument(withIndexes([-1, 1, 2, 3])).problems.items)).toEqual([
      "schema:minimum /sessions/0/messages/0/index",
    ]);
    expect(brief(validateDocument(withIndexes([1, 0, 2, 3])).problems.items)).toEqual([
      "R6 /sessions/0/messages/0/index",
      "R6 /sessions/0/messages/1/index",
    ]);
  });
});

describe("repair 7 and 6.3: segments", () => {
  const withSegments = (segments: unknown) => {
    const document = example();
    document.sessions[0].messages[0].segments = segments;
    return document;
  };
  const segmentsOf = (document: unknown) => read(document).doc.sessions[0]?.messages[0]?.segments;

  it("merges text segments that follow each other with an empty line", () => {
    const merged = read(
      withSegments([
        { type: "text", text: "one" },
        { type: "text", text: "two" },
        { type: "text", text: "" },
      ]),
    );
    expect(merged.doc.sessions[0]?.messages[0]?.segments).toEqual([{ type: "text", text: "one\n\ntwo\n\n" }]);
    expect(codes(merged.repairs.items)).toEqual(["segments_merged /sessions/0/messages/0/segments"]);
  });

  it("merges only runs: other segments keep text segments apart", () => {
    const sha256 = example().sessions[2].attachments[0].sha256;
    const document = example();
    document.sessions[2].messages[0].segments = [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
      { type: "attachment", sha256 },
      { type: "text", text: "c" },
      { type: "x_note", text: "not a text segment" },
      { type: "text", text: "d" },
      { type: "text", text: "e" },
    ];
    expect(read(document).doc.sessions[2]?.messages[0]?.segments).toEqual([
      { type: "text", text: "a\n\nb" },
      { type: "attachment", sha256 },
      { type: "text", text: "c" },
      { type: "x_note", text: "not a text segment" },
      { type: "text", text: "d\n\ne" },
    ]);
  });

  it("keeps the unknown properties of merged segments, the first one winning", () => {
    expect(
      segmentsOf(
        withSegments([
          { type: "text", text: "one", x_lang: "en", x_first: 1 },
          { type: "text", text: "two", x_lang: "fr", x_second: 2 },
        ]),
      ),
    ).toEqual([{ type: "text", text: "one\n\ntwo", x_lang: "en", x_first: 1, x_second: 2 }]);
  });

  it("keeps segments of unknown types whole and in place", () => {
    const toolCall = {
      type: "tool_use",
      id: "toolu_EXAMPLE",
      name: "read_file",
      input: { path: "notes.md", constructor: "x" },
    };
    const toolResult = {
      type: "tool_result",
      tool_use_id: "toolu_EXAMPLE",
      content: [{ type: "text", text: "file text" }],
      is_error: false,
    };
    const result = read(withSegments([{ type: "text", text: "Let me look." }, toolCall, toolResult]));
    expect(result.doc.sessions[0]?.messages[0]?.segments).toEqual([
      { type: "text", text: "Let me look." },
      toolCall,
      toolResult,
    ]);
    expect(result.repairs.total).toBe(0);
    // The text nested inside the unknown segment is not a text segment: CR stays as it is.
    const nested = read(withSegments([{ type: "tool_result", content: [{ type: "text", text: "a\r\nb" }] }]));
    expect(nested.doc.sessions[0]?.messages[0]?.segments[0]).toEqual({
      type: "tool_result",
      content: [{ type: "text", text: "a\r\nb" }],
    });
  });

  it("an empty text segment is a message; no segment at all is not", () => {
    expect(segmentsOf(withSegments([{ type: "text", text: "" }]))).toEqual([{ type: "text", text: "" }]);
    expect(brief(refused(withSegments([])))).toEqual(["schema:minItems /sessions/0/messages/0/segments"]);
  });

  it("refuses segments that break the schema", () => {
    const cases: [unknown, string][] = [
      [[{ text: "no type" }], "schema:required /sessions/0/messages/0/segments/0/type"],
      [[{ type: "" }], "schema:minLength /sessions/0/messages/0/segments/0/type"],
      [[{ type: 5 }], "schema:type /sessions/0/messages/0/segments/0/type"],
      [[{ type: "text" }], "schema:required /sessions/0/messages/0/segments/0/text"],
      [[{ type: "text", text: null }], "schema:type /sessions/0/messages/0/segments/0/text"],
      [[{ type: "attachment" }], "schema:required /sessions/0/messages/0/segments/0/sha256"],
      [[{ type: "attachment", sha256: "abc" }], "schema:pattern /sessions/0/messages/0/segments/0/sha256"],
      [["text"], "schema:type /sessions/0/messages/0/segments/0"],
      [{ type: "text", text: "not in an array" }, "schema:type /sessions/0/messages/0/segments"],
    ];
    for (const [segments, problem] of cases)
      expect(brief(refused(withSegments(segments))), problem).toEqual([problem]);
  });

  it("a text property on other types and a sha256 on text segments are just unknown properties", () => {
    const segments = [
      { type: "x_note", text: 5, sha256: "short" },
      { type: "text", text: "t", sha256: 7 },
    ];
    expect(segmentsOf(withSegments(segments))).toEqual(segments);
    expect(validateDocument(withSegments(segments)).ok).toBe(true);
  });
});

describe("repair 8: a project_id that resolves nowhere", () => {
  const dangling = "cccccccc-0000-4000-8000-000000000001";
  const withDangling = () => {
    const document = example();
    document.sessions[3].project_id = dangling;
    return document;
  };

  it("becomes null with a warning when there is no destination", () => {
    const result = read(withDangling());
    expect(result.doc.sessions[3]?.project_id).toBeNull();
    expect(codes(result.warnings.items)).toEqual(["project_missing /sessions/3/project_id"]);
    expect(result.repairs.total).toBe(0);
  });

  it("is kept when the destination vault has the project", () => {
    const result = read(withDangling(), { destinationProjectIds: new Set([dangling]) });
    expect(result.doc.sessions[3]?.project_id).toBe(dangling);
    expect(result.warnings.total).toBe(0);
    const other = read(withDangling(), {
      destinationProjectIds: new Set(["cccccccc-0000-4000-8000-000000000002"]),
    });
    expect(other.doc.sessions[3]?.project_id).toBeNull();
  });

  it("is compared after lower-casing", () => {
    const document = withDangling();
    document.sessions[3].project_id = dangling.toUpperCase();
    expect(read(document, { destinationProjectIds: new Set([dangling]) }).doc.sessions[3]?.project_id).toBe(
      dangling,
    );
  });
});

describe("repair 9: inline bytes that do not match the descriptor", () => {
  const pdf = () => example().sessions[1].attachments[0];

  it("are verified by length and SHA-256 and handed out when they match", () => {
    const result = read(EXAMPLE_TEXT);
    expect([...result.inlineBytes.keys()].sort()).toEqual([
      "1810cb5406ca55b31aaa3be7458db38d90a4fb0afe45831ebbaaebb3c9cd5746",
      "a0a4337e393b5dcba561013018a5261d56c20d164d4fa0be4b31456b211a3fd7",
    ]);
    for (const [sha256, bytes] of result.inlineBytes) {
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    }
    expect(result.inlineBytes.get(pdf().sha256)?.length).toBe(616);
  });

  it("are discarded with a warning; the descriptor stays", () => {
    const cases: [string, (attachment: ReturnType<typeof pdf>) => void][] = [
      [
        "another length",
        (a) => {
          a.data_base64 = a.data_base64.slice(0, -4);
        },
      ],
      [
        "another hash",
        (a) => {
          a.data_base64 = `K${a.data_base64.slice(1)}`;
        },
      ],
      [
        "a wrong byte_length",
        (a) => {
          a.byte_length = 615;
        },
      ],
      [
        "a wrong sha256",
        (a) => {
          a.sha256 = "0".repeat(64);
        },
      ],
      [
        "not base64",
        (a) => {
          a.data_base64 = `${a.data_base64.slice(0, 20)}\n${a.data_base64.slice(20)}`;
        },
      ],
      [
        "url-safe base64",
        (a) => {
          a.data_base64 = "AA-_";
        },
      ],
      [
        "one stray character",
        (a) => {
          a.data_base64 = "A";
        },
      ],
      [
        "empty data for 616 bytes",
        (a) => {
          a.data_base64 = "";
        },
      ],
    ];
    for (const [name, change] of cases) {
      const document = example();
      change(document.sessions[1].attachments[0]);
      const result = read(document);
      expect(codes(result.warnings.items), name).toEqual([
        "bytes_discarded /sessions/1/attachments/0/data_base64",
      ]);
      const kept = result.doc.sessions[1]?.attachments[0];
      expect(kept, name).not.toHaveProperty("data_base64");
      expect(kept, name).toMatchObject({
        kind: "original_pdf",
        filename: "Tomato blight on the balcony.pdf",
        x_pages: 1,
      });
      expect(result.inlineBytes.size, name).toBe(1);
    }
  });

  it("accept base64 without padding when the bytes are right", () => {
    const document = example();
    const attachment = document.sessions[2].attachments[0];
    attachment.data_base64 = attachment.data_base64.replace(/=+$/, "");
    const result = read(document);
    expect(result.warnings.total).toBe(0);
    expect(result.doc.sessions[2]?.attachments[0]?.data_base64).toBe(attachment.data_base64);
    expect(result.inlineBytes.get(attachment.sha256)?.length).toBe(73);
  });

  it("accept empty data for an attachment of no bytes", () => {
    const document = example();
    const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    document.sessions[3].attachments = [
      { kind: "file", sha256: empty, media_type: "text/plain", byte_length: 0, data_base64: "" },
    ];
    const result = read(document);
    expect(result.warnings.total).toBe(0);
    expect(result.doc.sessions[3]?.attachments[0]?.data_base64).toBe("");
    expect(result.inlineBytes.get(empty)).toEqual(new Uint8Array(0));
  });

  it("data that is not a string is removed with a warning too; the descriptor stays (corrections.md 2, point 7)", () => {
    for (const data of [[1, 2, 3], 7, true, { base64: "AAAA" }]) {
      const document = example();
      document.sessions[1].attachments[0].data_base64 = data;
      const result = read(document);
      expect(codes(result.warnings.items)).toEqual(["bytes_discarded /sessions/1/attachments/0/data_base64"]);
      expect(result.doc.sessions[1]?.attachments[0]).not.toHaveProperty("data_base64");
      expect(result.doc.sessions[1]?.attachments[0]).toMatchObject({
        kind: "original_pdf",
        byte_length: 616,
      });
      expect(result.inlineBytes.size).toBe(1);
      // A writer's data must be a string.
      expect(brief(validateDocument(document).problems.items)).toEqual([
        "schema:type /sessions/1/attachments/0/data_base64",
      ]);
    }
  });
});

describe("timestamps (6.1)", () => {
  it("are accepted with 0 to 9 fraction digits and returned with exactly three", () => {
    const document = example();
    document.exported_at = "2026-11-19T12:00:00Z";
    document.sessions[0].created_at = "2026-03-14T09:30:00.5Z";
    document.sessions[0].imported_at = "2026-03-15T18:02:11.48200Z";
    document.sessions[0].updated_at = "2026-03-15T18:05:40.100000000Z";
    const result = read(document);
    expect(result.doc.exported_at).toBe("2026-11-19T12:00:00.000Z");
    expect(result.doc.sessions[0]).toMatchObject({
      created_at: "2026-03-14T09:30:00.500Z",
      imported_at: "2026-03-15T18:02:11.482Z",
      updated_at: "2026-03-15T18:05:40.100Z",
    });
    // Nothing was lost, so nothing is reported.
    expect(result.repairs.total).toBe(0);
  });

  it("are cut to milliseconds, never rounded up, and that is reported in one line for the file", () => {
    const document = example();
    document.sessions[0].updated_at = "2026-03-15T18:05:40.999999999Z";
    const result = read(document);
    expect(result.doc.sessions[0]?.updated_at).toBe("2026-03-15T18:05:40.999Z");
    expect(result.repairs.items).toEqual([
      { code: "timestamp_precision", path: "", message: "Cut 1 timestamp to milliseconds.", count: 1 },
    ]);
  });

  it("are checked everywhere they occur", () => {
    const places: [string, (document: ReturnType<typeof example>, value: unknown) => void][] = [
      [
        "/exported_at",
        (d, v) => {
          d.exported_at = v;
        },
      ],
      [
        "/projects/0/created_at",
        (d, v) => {
          d.projects[0].created_at = v;
        },
      ],
      [
        "/projects/0/updated_at",
        (d, v) => {
          d.projects[0].updated_at = v;
        },
      ],
      [
        "/sessions/2/created_at",
        (d, v) => {
          d.sessions[2].created_at = v;
        },
      ],
      [
        "/sessions/2/imported_at",
        (d, v) => {
          d.sessions[2].imported_at = v;
        },
      ],
      [
        "/sessions/2/updated_at",
        (d, v) => {
          d.sessions[2].updated_at = v;
        },
      ],
      [
        "/sessions/2/attachments/0/created_at",
        (d, v) => {
          d.sessions[2].attachments[0].created_at = v;
        },
      ],
      [
        "/sessions/2/messages/3/created_at",
        (d, v) => {
          d.sessions[2].messages[3].created_at = v;
        },
      ],
    ];
    for (const [path, set] of places) {
      const shape = example();
      set(shape, "19 November 2026");
      expect(brief(refused(shape))).toEqual([`schema:pattern ${path}`]);
      const calendar = example();
      set(calendar, "2026-11-31T00:00:00Z");
      expect(brief(refused(calendar))).toEqual([`R1 ${path}`]);
      const type = example();
      set(type, 1_763_553_600_000);
      expect(brief(refused(type))).toEqual([`schema:type ${path}`]);
    }
  });
});

describe("the document level", () => {
  it("keeps unknown top-level properties in what it returns", () => {
    const result = read(EXAMPLE_TEXT);
    expect(result.doc.x_note).toBe(
      "Synthetic example data. Nothing in this file comes from a real conversation.",
    );
    expect(Object.keys(result.doc)).toEqual([
      "format",
      "version",
      "kind",
      "exported_at",
      "generator",
      "projects",
      "sessions",
      "x_note",
    ]);
  });

  it("reads the generator and keeps what else it says", () => {
    const document = example();
    document.generator = { app: "sessionvault-apple", app_version: "1.4 (22)", platform: "iOS", x_build: 7 };
    expect(read(document).doc.generator).toEqual({
      app: "sessionvault-apple",
      app_version: "1.4 (22)",
      platform: "iOS",
      x_build: 7,
    });
    delete document.generator;
    expect(read(document).doc).not.toHaveProperty("generator");
    document.generator = { app: "" };
    expect(brief(refused(document))).toEqual(["schema:minLength /generator/app"]);
    document.generator = { platform: "web" };
    expect(brief(refused(document))).toEqual(["schema:required /generator/app"]);
    document.generator = "sessionvault-web";
    expect(brief(refused(document))).toEqual(["schema:type /generator"]);
    document.generator = { app: "a", app_version: 2 };
    expect(brief(refused(document))).toEqual(["schema:type /generator/app_version"]);
  });

  it("checks kind", () => {
    const document = example();
    document.kind = "backup";
    expect(brief(refused(document))).toEqual(["schema:enum /kind"]);
    delete document.kind;
    expect(brief(refused(document))).toEqual(["schema:required /kind"]);
  });

  it("a session document holds exactly one session and at most one project, the session's own", () => {
    const base = () => {
      const document = example();
      document.kind = "session";
      document.projects = [document.projects[0]];
      document.sessions = [document.sessions[0]];
      return document;
    };
    expect(read(base()).doc.kind).toBe("session");
    const none = base();
    none.sessions = [];
    expect(brief(refused(none))).toEqual(["schema:minItems /sessions"]);
    const two = base();
    two.sessions.push(example().sessions[3]);
    expect(brief(refused(two))).toEqual(["schema:maxItems /sessions"]);
    const projects = base();
    projects.projects.push(example().projects[1]);
    expect(brief(refused(projects))).toEqual(["schema:maxItems /projects"]);
    const foreign = base();
    foreign.projects = [example().projects[1]];
    // The session's project is not listed: repair 8 clears it. The listed project is then not its own.
    expect(brief(refused(foreign))).toEqual(["R8 /projects/0"]);
    const without = base();
    without.projects = [];
    expect(read(without).doc.sessions[0]?.project_id).toBeNull();
    expect(
      read(without, { destinationProjectIds: new Set([example().projects[0].id]) }).doc.sessions[0]
        ?.project_id,
    ).toBe(example().projects[0].id);
  });

  it("checks projects", () => {
    const cases: [(project: Record<string, unknown>) => void, string][] = [
      [
        (p) => {
          p.name = "";
        },
        "schema:minLength /projects/0/name",
      ],
      [
        (p) => {
          p.name = " \t\u00A0\u3000";
        },
        "schema:pattern /projects/0/name",
      ],
      [
        (p) => {
          p.name = ["Garden"];
        },
        "schema:type /projects/0/name",
      ],
      [
        (p) => {
          delete p.name;
        },
        "schema:required /projects/0/name",
      ],
      [
        (p) => {
          delete p.id;
        },
        "schema:required /projects/0/id",
      ],
      [
        (p) => {
          delete p.created_at;
        },
        "schema:required /projects/0/created_at",
      ],
    ];
    for (const [change, problem] of cases) {
      const document = example();
      change(document.projects[0]);
      expect(brief(refused(document)), problem).toEqual([problem]);
    }
    // A name keeps its outer white space: only the key it is compared by is trimmed.
    const padded = example();
    padded.projects[0].name = "  Bike workshop ";
    expect(read(padded).doc.projects[0]?.name).toBe("  Bike workshop ");
  });

  it("checks attachments", () => {
    const cases: [(attachment: Record<string, unknown>) => void, string][] = [
      [
        (a) => {
          a.kind = "";
        },
        "schema:minLength /sessions/1/attachments/0/kind",
      ],
      [
        (a) => {
          delete a.kind;
        },
        "schema:required /sessions/1/attachments/0/kind",
      ],
      [
        (a) => {
          delete a.sha256;
        },
        "schema:required /sessions/1/attachments/0/sha256",
      ],
      [
        (a) => {
          a.media_type = "Application/PDF";
        },
        "schema:pattern /sessions/1/attachments/0/media_type",
      ],
      [
        (a) => {
          a.media_type = "application/pdf; q=1";
        },
        "schema:pattern /sessions/1/attachments/0/media_type",
      ],
      [
        (a) => {
          delete a.media_type;
        },
        "schema:required /sessions/1/attachments/0/media_type",
      ],
      [
        (a) => {
          a.byte_length = -1;
        },
        "schema:minimum /sessions/1/attachments/0/byte_length",
      ],
      [
        (a) => {
          a.byte_length = 616.5;
        },
        "schema:type /sessions/1/attachments/0/byte_length",
      ],
      [
        (a) => {
          a.byte_length = "616";
        },
        "schema:type /sessions/1/attachments/0/byte_length",
      ],
      [
        (a) => {
          delete a.byte_length;
        },
        "schema:required /sessions/1/attachments/0/byte_length",
      ],
      [
        (a) => {
          a.filename = "../../etc/passwd";
        },
        "schema:pattern /sessions/1/attachments/0/filename",
      ],
      [
        (a) => {
          a.filename = "C:\\temp\\x.pdf";
        },
        "schema:pattern /sessions/1/attachments/0/filename",
      ],
    ];
    for (const [change, problem] of cases) {
      const document = example();
      change(document.sessions[1].attachments[0]);
      expect(brief(refused(document)), problem).toEqual([problem]);
    }
  });

  it("reports every problem of a document, each with its place", () => {
    const document = example();
    document.projects[0].name = " ";
    document.sessions[0].created_at = "2026-02-30T00:00:00Z";
    document.sessions[1].is_pinned = "yes";
    document.sessions[2].messages[1].segments = [];
    document.sessions[5].id = document.sessions[4].id;
    delete document.exported_at;
    expect(brief(refused(document))).toEqual([
      "schema:required /exported_at",
      "schema:pattern /projects/0/name",
      "R1 /sessions/0/created_at",
      "schema:type /sessions/1/is_pinned",
      "schema:minItems /sessions/2/messages/1/segments",
      "R2 /sessions/5/id",
    ]);
  });
});

describe("reading is stable", () => {
  it("a document that was read once reads the same again, without repairs", () => {
    const document = example();
    document.sessions[0].id = document.sessions[0].id.toUpperCase();
    document.sessions[0].tags = ["# #Bikes", "REPAIR,x"];
    document.sessions[0].provider = " ChatGPT";
    document.sessions[0].messages.reverse();
    document.sessions[0].messages[0].segments.push({ type: "text", text: "more\r\n" });
    document.sessions[0].updated_at = "2026-03-15T18:05:40.1009Z";
    document.sessions[3].project_id = "cccccccc-0000-4000-8000-000000000001";
    document.sessions[1].attachments[0].data_base64 = "AAAA";
    const first = read(document);
    expect(first.repairs.total).toBeGreaterThan(5);
    expect(first.warnings.total).toBe(2);
    const second = read(first.doc);
    expect(second.repairs.total).toBe(0);
    expect(second.warnings.total).toBe(0);
    expect(second.doc).toEqual(first.doc);
    expect(validateDocument(first.doc)).toMatchObject({ ok: true, warnings: { total: 0 } });
  });

  it("does not change what it is given", () => {
    const document = example();
    document.sessions[0].id = document.sessions[0].id.toUpperCase();
    document.sessions[0].messages.reverse();
    const before = JSON.stringify(document);
    read(document);
    validateDocument(document);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("returns objects that share nothing with the input", () => {
    const document = example();
    const result = read(document);
    document.sessions[4].x_capture.method = "changed afterwards";
    document.sessions[0].tags.push("late");
    expect(result.doc.sessions[4]?.x_capture).toEqual({
      method: "paste",
      note: "unknown field, must survive a round trip",
    });
    expect(result.doc.sessions[0]?.tags).toEqual(["bikes", "repair"]);
  });
});
