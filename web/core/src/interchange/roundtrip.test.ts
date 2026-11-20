/// <reference types="node" />
// The round trip of docs/example-vault-export.json as HANDOFF.md (phase 1) and data-model.md 9.4
// define it, and the further round-trip tests of 9.4.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  checkVault,
  type DocumentImportContext,
  documentText,
  emptyVault,
  exportDocument,
  importDocument,
  readDocument,
  type Vault,
  validateDocument,
  webGenerator,
} from "./index.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const DOCS = new URL("../../../docs/", import.meta.url);
const EXAMPLE_BYTES = readFileSync(new URL("example-vault-export.json", DOCS));
const EXAMPLE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(EXAMPLE_BYTES);
const example = () => JSON.parse(EXAMPLE_TEXT);

const NOW = new Date("2026-11-20T08:00:00.000Z");
function context(): DocumentImportContext {
  let n = 0;
  return { now: NOW, newId: () => `ffffffff-ffff-4fff-8fff-${String(++n).padStart(12, "0")}` };
}
const exportContext = { now: NOW, generator: webGenerator("0.1.0") };

function importInto(vault: Vault, input: unknown) {
  const result = importDocument(vault, input, context());
  if (!result.ok)
    throw new Error(`import refused: ${result.problems.items.map((p) => `${p.rule} ${p.path}`).join(", ")}`);
  return result;
}

function exportVault(vault: Vault, includeBytes = true) {
  const result = exportDocument(vault, { kind: "vault" }, exportContext, { includeBytes });
  if (!result.ok) throw new Error("export refused");
  return result;
}

/**
 * The comparison of the build brief: sort every array of objects that have an id by that id,
 * and ignore `exported_at`, `generator` and the document-level `x_note`. Nothing else is touched.
 */
function forComparison(document: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(document));
  delete copy.exported_at;
  delete copy.generator;
  delete copy.x_note;
  const sortById = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(sortById);
      if (
        value.length > 0 &&
        value.every((item) => typeof item === "object" && item !== null && typeof item.id === "string")
      ) {
        value.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
    } else if (typeof value === "object" && value !== null) {
      Object.values(value).forEach(sortById);
    }
  };
  sortById(copy);
  return copy;
}

describe("the example file", () => {
  it("is the UTF-8 file without byte-order mark that the tests expect", () => {
    expect(EXAMPLE_BYTES[0]).toBe(0x7b);
    expect(example().format).toBe("sessionvault-interchange");
  });

  it("needs no repair and gives no warning", () => {
    const read = readDocument(EXAMPLE_TEXT);
    expect(read).toMatchObject({ ok: true, repairs: { total: 0 }, warnings: { total: 0 } });
    expect(validateDocument(EXAMPLE_TEXT)).toMatchObject({ ok: true });
    // The reader returns what the file says, top-level unknown properties included.
    if (read.ok) expect(read.doc).toEqual(example());
  });
});

describe("9.4 test 1: import the example, export the vault, compare", () => {
  const imported = importInto(emptyVault(), EXAMPLE_TEXT);
  const exported = exportVault(imported.vault);

  it("imports six sessions, three projects and the two inline attachments", () => {
    expect(imported.report.counts).toEqual({
      added: 6,
      updated: 0,
      unchanged: 0,
      kept: 0,
      conflicts: 0,
      copies: 0,
      blobsStored: 2,
      projectsAdded: 3,
      projectsMerged: 0,
      projectsUpdated: 0,
      projectsUnchanged: 0,
      projectsKept: 0,
    });
    expect(imported.report.warnings.total).toBe(0);
    expect(imported.report.repairs.total).toBe(0);
    expect(imported.report.kind).toBe("vault");
    expect(imported.report.exportedAt.toISOString()).toBe("2026-11-19T12:00:00.000Z");
    expect(imported.report.generator).toEqual({
      app: "sessionvault-web",
      app_version: "0.0.0-example",
      platform: "web",
    });
    expect(imported.report.at).toEqual(NOW);
    expect(checkVault(imported.vault)).toMatchObject({ ok: true });
  });

  it("exports a document equal to the original after sorting arrays by id and ignoring exported_at, generator and x_note", () => {
    expect(forComparison(exported.doc)).toEqual(forComparison(example()));
    expect(exported.warnings.total).toBe(0);
  });

  it("gives the same result through the text of the export", () => {
    const text = documentText(exported.doc);
    expect(text).not.toBeNull();
    expect(forComparison(JSON.parse(text ?? ""))).toEqual(forComparison(example()));
  });

  it("writes its own exported_at and generator and no document-level unknown property", () => {
    expect(Object.keys(exported.doc)).toEqual([
      "format",
      "version",
      "kind",
      "exported_at",
      "generator",
      "projects",
      "sessions",
    ]);
    expect(exported.doc.exported_at).toBe("2026-11-20T08:00:00.000Z");
    expect(exported.doc.generator).toEqual({
      app: "sessionvault-web",
      app_version: "0.1.0",
      platform: "web",
    });
    // 6.5 item 2: x_note describes the file and is not stored anywhere in the vault.
    expect(JSON.stringify(imported.vault.projects) + JSON.stringify(imported.vault.sessions)).not.toContain(
      "Synthetic example data",
    );
  });

  it("keeps every other unknown property at its place", () => {
    const byId = new Map(exported.doc.sessions.map((session) => [session.id, session]));
    const garden = exported.doc.projects.find((project) => project.name === "Garden");
    expect(garden?.x_color).toBe("green");
    const five = byId.get("5e550000-0000-4000-8000-000000000005");
    expect(five?.x_capture).toEqual({ method: "paste", note: "unknown field, must survive a round trip" });
    expect(five?.messages[2]?.x_rating).toBe(5);
    expect(five?.messages[2]?.segments[1]).toEqual({
      type: "x_table",
      columns: ["seed", "price_per_row"],
      rows: [
        ["carrot", "0.40"],
        ["beet", "0.55"],
      ],
    });
    const two = byId.get("5e550000-0000-4000-8000-000000000002");
    expect(two?.attachments[0]?.x_pages).toBe(1);
  });

  it("keeps the tool role, the examplebot provider and the PDF descriptor without bytes", () => {
    const five = exported.doc.sessions.find(
      (session) => session.id === "5e550000-0000-4000-8000-000000000005",
    );
    expect(five?.provider).toBe("examplebot");
    expect(five?.messages[1]?.role).toBe("tool");
    expect(five?.attachments).toEqual([
      {
        kind: "original_pdf",
        sha256: "d10c0f337641f502b997b7e3537d94cabaca39d0335037853d21696816cc78ab",
        media_type: "application/pdf",
        byte_length: 623,
        filename: "Seed order comparison.pdf",
        created_at: "2026-11-01T10:00:00.000Z",
      },
    ]);
  });

  it("writes the inline bytes back exactly", () => {
    const original = example();
    const byId = new Map(exported.doc.sessions.map((session) => [session.id, session]));
    for (const session of original.sessions) {
      for (const [index, attachment] of session.attachments.entries()) {
        expect(byId.get(session.id)?.attachments[index]?.data_base64).toBe(attachment.data_base64);
      }
    }
    for (const [sha256, bytes] of imported.vault.blobs) {
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    }
    expect([...imported.vault.blobs.values()].map((bytes) => bytes.length).sort((a, b) => a - b)).toEqual([
      73, 616,
    ]);
  });

  it("without originals, exports the same document minus the bytes", () => {
    const withoutBytes = exportVault(imported.vault, false);
    const expected = example();
    for (const session of expected.sessions)
      for (const attachment of session.attachments) delete attachment.data_base64;
    expect(forComparison(withoutBytes.doc)).toEqual(forComparison(expected));
  });

  it("is deterministic: the same vault, time and options give the same text", () => {
    const again = exportVault(importInto(emptyVault(), EXAMPLE_TEXT).vault);
    expect(documentText(again.doc)).toBe(documentText(exported.doc));
  });
});

describe("9.4 test 2: import the example twice", () => {
  it("reports 6 unchanged the second time and creates nothing", () => {
    const first = importInto(emptyVault(), EXAMPLE_TEXT);
    const second = importInto(first.vault, EXAMPLE_TEXT);
    expect(second.report.counts).toMatchObject({
      added: 0,
      updated: 0,
      unchanged: 6,
      kept: 0,
      conflicts: 0,
      blobsStored: 0,
      projectsAdded: 0,
      projectsUnchanged: 3,
    });
    expect(second.vault).toEqual(first.vault);
    // Not merely equal: the very same sessions, projects and bytes.
    second.vault.sessions.forEach((session, i) => {
      expect(session).toBe(first.vault.sessions[i]);
    });
    second.vault.projects.forEach((project, i) => {
      expect(project).toBe(first.vault.projects[i]);
    });
    expect(second.vault.blobs).toBe(first.vault.blobs);
  });
});

describe("9.4 test 3: a newer copy, then the original again", () => {
  it("reports 1 updated, then 1 kept", () => {
    const first = importInto(emptyVault(), EXAMPLE_TEXT);
    const copy = example();
    copy.sessions[0].title = "Truing a bicycle wheel, second try";
    copy.sessions[0].updated_at = "2026-03-16T08:00:00.000Z";
    const second = importInto(first.vault, copy);
    expect(second.report.counts).toMatchObject({ added: 0, updated: 1, unchanged: 5, kept: 0, conflicts: 0 });
    const updated = second.vault.sessions.find((session) => session.id === copy.sessions[0].id);
    expect(updated?.title).toBe("Truing a bicycle wheel, second try");
    expect(updated?.updated_at.toISOString()).toBe("2026-03-16T08:00:00.000Z");

    const third = importInto(second.vault, EXAMPLE_TEXT);
    expect(third.report.counts).toMatchObject({ added: 0, updated: 0, unchanged: 5, kept: 1, conflicts: 0 });
    expect(third.report.sessions[0]).toEqual({
      incomingId: copy.sessions[0].id,
      id: copy.sessions[0].id,
      outcome: "kept",
      conflict: false,
      copyId: null,
    });
    expect(third.vault).toEqual(second.vault);
  });
});

describe("9.4 test 4: the repair list makes an upper-case-id, CR LF, unsorted copy valid", () => {
  it("validates after repair and imports as the same six sessions", () => {
    const copy = example();
    for (const project of copy.projects) project.id = project.id.toUpperCase();
    for (const session of copy.sessions) {
      session.id = session.id.toUpperCase();
      if (session.project_id !== null) session.project_id = session.project_id.toUpperCase();
      session.messages.reverse();
      for (const message of session.messages) {
        message.id = message.id.toUpperCase();
        for (const segment of message.segments) {
          if (segment.type === "text") segment.text = segment.text.replaceAll("\n", "\r\n");
        }
      }
    }
    expect(validateDocument(copy).ok).toBe(false);
    const read = readDocument(copy);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(validateDocument(read.doc)).toMatchObject({ ok: true });
    expect(read.doc).toEqual(example());
    // 3 projects, 6 sessions, 3 project references and 14 messages; 4 sessions with more than one
    // message; 3 text segments with a line break.
    expect(read.repairs.counts).toEqual({ id_lowercased: 26, messages_renumbered: 4, line_endings: 3 });

    // Imported into a vault that holds the original, nothing differs.
    const first = importInto(emptyVault(), EXAMPLE_TEXT);
    expect(importInto(first.vault, copy).report.counts).toMatchObject({
      unchanged: 6,
      added: 0,
      updated: 0,
      kept: 0,
    });
  });
});

describe("9.4 test 5: very large messages", () => {
  it("imports, exports and imports again a message of 1,000,000 characters and one of 4,000,000 bytes", () => {
    const million = "The rim moves toward the tightened spoke. ".repeat(25_000).slice(0, 1_000_000);
    // U+20AC is three bytes in UTF-8; with one ASCII letter this is 4,000,000 bytes.
    const fourMegabytes = `a${"\u20AC".repeat(1_333_333)}`;
    const copy = example();
    copy.sessions[3].messages = [
      {
        id: "0e55a9e0-0004-4000-8000-000000000000",
        index: 0,
        role: "user",
        segments: [{ type: "text", text: million }],
      },
      {
        id: "0e55a9e0-0004-4000-8000-000000000001",
        index: 1,
        role: "assistant",
        segments: [{ type: "text", text: fourMegabytes }],
      },
    ];
    const first = importInto(emptyVault(), copy);
    const big = first.vault.sessions.find((session) => session.id === copy.sessions[3].id);
    expect(big?.message_count).toBe(2);
    expect(big?.messages.map((message) => message.text_bytes)).toEqual([1_000_000, 4_000_000]);
    expect(big?.text_bytes).toBe(5_000_000);
    expect(big?.messages[0]?.text.length).toBe(1_000_000);

    const exported = exportVault(first.vault);
    expect(forComparison(exported.doc)).toEqual(forComparison(copy));
    const text = documentText(exported.doc);
    expect(text?.length).toBeGreaterThan(2_300_000);
    const second = importInto(first.vault, text);
    expect(second.report.counts).toMatchObject({ unchanged: 6, added: 0, updated: 0, kept: 0 });
  }, 60_000);
});

describe("9.4, the further cases its reference implementation passed", () => {
  it("bytes filled in by a later import, although every session is then unchanged (6.7 step 4)", () => {
    const withoutBytes = example();
    for (const session of withoutBytes.sessions)
      for (const attachment of session.attachments) delete attachment.data_base64;
    const first = importInto(emptyVault(), withoutBytes);
    expect(first.vault.blobs.size).toBe(0);
    expect(first.report.counts).toMatchObject({ added: 6, blobsStored: 0 });

    const second = importInto(first.vault, EXAMPLE_TEXT);
    expect(second.report.counts).toMatchObject({
      unchanged: 6,
      added: 0,
      updated: 0,
      kept: 0,
      blobsStored: 2,
    });
    expect([...second.vault.blobs.keys()].sort()).toEqual([
      "1810cb5406ca55b31aaa3be7458db38d90a4fb0afe45831ebbaaebb3c9cd5746",
      "a0a4337e393b5dcba561013018a5261d56c20d164d4fa0be4b31456b211a3fd7",
    ]);
    expect(second.report.blobsStored.length).toBe(2);
    // The sessions themselves were not touched.
    second.vault.sessions.forEach((session, i) => {
      expect(session).toBe(first.vault.sessions[i]);
    });
    expect(forComparison(exportVault(second.vault).doc)).toEqual(forComparison(example()));
  });

  it("project merge by name: a project with another id and the same name becomes the stored one", () => {
    const first = importInto(emptyVault(), EXAMPLE_TEXT);
    const other = example();
    other.projects = [
      {
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        name: "  GARDEN ",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    other.sessions = [
      {
        ...other.sessions[3],
        id: "5e550000-0000-4000-8000-000000000099",
        project_id: "bbbbbbbb-0000-4000-8000-000000000001",
      },
    ];
    const second = importInto(first.vault, other);
    expect(second.report.projects).toEqual([
      {
        incomingId: "bbbbbbbb-0000-4000-8000-000000000001",
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        outcome: "merged",
      },
    ]);
    expect(second.vault.projects.length).toBe(3);
    const added = second.vault.sessions.find(
      (session) => session.id === "5e550000-0000-4000-8000-000000000099",
    );
    expect(added?.project_id).toBe("aaaaaaaa-0000-4000-8000-000000000002");
    // The stored project keeps its own name and properties.
    expect(
      second.vault.projects.find((project) => project.id === "aaaaaaaa-0000-4000-8000-000000000002"),
    ).toBe(first.vault.projects.find((project) => project.id === "aaaaaaaa-0000-4000-8000-000000000002"));
    // The same file again finds everything in place.
    expect(importInto(second.vault, other).report.counts).toMatchObject({
      unchanged: 1,
      added: 0,
      projectsMerged: 1,
    });
  });

  it("a dangling project_id becomes null, with a warning", () => {
    const copy = example();
    copy.sessions[0].project_id = "cccccccc-0000-4000-8000-000000000001";
    const result = importInto(emptyVault(), copy);
    expect(
      result.vault.sessions.find((session) => session.id === copy.sessions[0].id)?.project_id,
    ).toBeNull();
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "project_missing", path: "/sessions/0/project_id" }),
    ]);
  });

  it("a __proto__ property is kept as data and changes no prototype", () => {
    const text = EXAMPLE_TEXT.replace(
      '"x_color": "green"',
      '"x_color": "green", "__proto__": {"polluted": true}',
    );
    expect(text).not.toBe(EXAMPLE_TEXT);
    const result = importInto(emptyVault(), text);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(Reflect.get({}, "polluted")).toBeUndefined();
    const garden = result.vault.projects.find((project) => project.name === "Garden");
    expect(Object.keys(garden?.extra ?? {})).toEqual(["x_color", "__proto__"]);
    expect(Reflect.get(Object(garden), "polluted")).toBeUndefined();
    // It is written back at the same place.
    const exported = documentText(exportVault(result.vault).doc) ?? "";
    expect(exported).toContain('"x_color":"green","__proto__":{"polluted":true}');
    expect(forComparison(JSON.parse(exported))).toEqual(forComparison(JSON.parse(text)));
  });

  it("corrupt inline bytes are discarded with a warning; the descriptor stays", () => {
    const copy = example();
    const attachment = copy.sessions[1].attachments[0];
    attachment.data_base64 = attachment.data_base64.replace("JVBERi0xLjQK", "JVBERi0xLjUK");
    const result = importInto(emptyVault(), copy);
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "bytes_discarded", path: "/sessions/1/attachments/0/data_base64" }),
    ]);
    expect(result.report.counts.blobsStored).toBe(1);
    expect(result.vault.blobs.has(attachment.sha256)).toBe(false);
    const stored = result.vault.sessions.find((session) => session.id === copy.sessions[1].id);
    expect(stored?.attachments).toEqual([
      expect.objectContaining({ kind: "original_pdf", sha256: attachment.sha256, byte_length: 616 }),
    ]);
    // The descriptor is exported again unchanged, without bytes (6.4 "omitted").
    const exported = exportVault(result.vault).doc.sessions.find(
      (session) => session.id === copy.sessions[1].id,
    );
    const expected = { ...example().sessions[1].attachments[0] };
    delete expected.data_base64;
    expect(exported?.attachments).toEqual([expected]);
  });

  it("a version 2 file is refused with a clear message and nothing is imported", () => {
    const copy = example();
    copy.version = 2;
    const start = emptyVault();
    const result = importDocument(start, copy, context());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.items).toEqual([
      {
        rule: "version",
        path: "/version",
        message:
          "The file was written in a newer version of the format; this app reads version 1. Nothing was imported.",
      },
    ]);
    expect(start).toEqual(emptyVault());
  });
});

describe("a session with tool calls, tool results and subagent messages (HANDOFF.md section 5)", () => {
  // The shape a structured Claude Code transcript would take in this format: roles and segment
  // types version 1 does not know. Everything here is invented.
  const coding = () => ({
    id: "5e550000-0000-4000-8000-0000000000c0",
    title: "Rename a helper across the project",
    provider: "claude",
    model: "example-model-1",
    source_url: "",
    summary: "",
    tags: ["code"],
    is_pinned: false,
    created_at: "2026-11-10T09:00:00.000Z",
    imported_at: "2026-11-10T09:30:00.000Z",
    updated_at: "2026-11-10T09:30:00.000Z",
    project_id: null,
    x_capture: { method: "structured", extractor_version: "0-example" },
    attachments: [],
    messages: [
      {
        id: "0e55c0de-0000-4000-8000-000000000000",
        index: 0,
        role: "user",
        segments: [{ type: "text", text: "Rename `oldName` to `newName` everywhere." }],
      },
      {
        id: "0e55c0de-0000-4000-8000-000000000001",
        index: 1,
        role: "assistant",
        model: "example-model-1",
        created_at: "2026-11-10T09:00:05.000Z",
        segments: [
          { type: "thinking", thinking: "Find the uses first.", signature: "EXAMPLE" },
          { type: "text", text: "I'll search for the uses first." },
          {
            type: "tool_use",
            id: "toolu_EXAMPLE_01",
            name: "Grep",
            input: {
              pattern: "oldName",
              path: "src",
              flags: ["-n"],
              constructor: "kept",
              options: { limit: 20, nested: { deep: [1, 2, { x: null }] } },
            },
          },
          { type: "tool_use", id: "toolu_EXAMPLE_02", name: "Bash", input: { command: "ls -la\r\n" } },
        ],
      },
      {
        id: "0e55c0de-0000-4000-8000-000000000002",
        index: 2,
        role: "tool",
        segments: [
          {
            type: "tool_result",
            tool_use_id: "toolu_EXAMPLE_01",
            is_error: false,
            content: [{ type: "text", text: "src/a.ts:3: oldName()\r\nsrc/b.ts:9: oldName()" }],
          },
          {
            type: "tool_result",
            tool_use_id: "toolu_EXAMPLE_02",
            is_error: true,
            content: "permission denied",
          },
        ],
      },
      {
        id: "0e55c0de-0000-4000-8000-000000000003",
        index: 3,
        role: "subagent",
        x_agent: {
          id: "agent-EXAMPLE",
          parent_message: "0e55c0de-0000-4000-8000-000000000001",
          sidechain: true,
        },
        segments: [
          { type: "text", text: "Two files use it." },
          { type: "x_usage", input_tokens: 120, output_tokens: 8 },
          { type: "text", text: "Both are safe to change." },
        ],
      },
      {
        id: "0e55c0de-0000-4000-8000-000000000004",
        index: 4,
        role: "system",
        segments: [{ type: "x_event", event: "session_initialised" }],
      },
      {
        id: "0e55c0de-0000-4000-8000-000000000005",
        index: 5,
        role: "assistant",
        segments: [{ type: "text", text: "Done: renamed in 2 files." }],
      },
    ],
  });
  const file = () => {
    const document = example();
    document.sessions = [coding()];
    document.projects = [];
    return document;
  };

  it("is valid as written, without any repair", () => {
    expect(validateDocument(file())).toMatchObject({ ok: true, warnings: { total: 0 } });
    expect(readDocument(file())).toMatchObject({ ok: true, repairs: { total: 0 }, warnings: { total: 0 } });
  });

  it("survives import and export exactly, nested tool inputs and results included", () => {
    const imported = importInto(emptyVault(), file());
    expect(forComparison(exportVault(imported.vault).doc)).toEqual(forComparison(file()));
    // A second import finds nothing to do.
    expect(importInto(imported.vault, file()).report.counts).toMatchObject({
      unchanged: 1,
      added: 0,
      updated: 0,
      kept: 0,
    });
  });

  it("keeps every role as written and stores the segments of every message that is more than plain text", () => {
    const stored = importInto(emptyVault(), file()).vault.sessions[0];
    expect(stored?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "subagent",
      "system",
      "assistant",
    ]);
    expect(
      stored?.messages.map((message) => message.segments?.map((segment) => segment.type) ?? null),
    ).toEqual([
      null,
      ["thinking", "text", "tool_use", "tool_use"],
      ["tool_result", "tool_result"],
      ["text", "x_usage", "text"],
      ["x_event"],
      null,
    ]);
    expect(stored?.messages[3]?.extra).toEqual({
      x_agent: {
        id: "agent-EXAMPLE",
        parent_message: "0e55c0de-0000-4000-8000-000000000001",
        sidechain: true,
      },
    });
    expect(stored?.extra).toEqual({ x_capture: { method: "structured", extractor_version: "0-example" } });
  });

  it("flattens to the text segments only, so tool activity is kept but is not part of the text", () => {
    const stored = importInto(emptyVault(), file()).vault.sessions[0];
    expect(stored?.messages.map((message) => message.text)).toEqual([
      "Rename `oldName` to `newName` everywhere.",
      "I'll search for the uses first.",
      "",
      "Two files use it.\n\nBoth are safe to change.",
      "",
      "Done: renamed in 2 files.",
    ]);
    expect(stored?.message_count).toBe(6);
    expect(stored?.text_bytes).toBe(41 + 31 + 0 + 43 + 0 + 25);
    const encoder = new TextEncoder();
    expect(stored?.messages.map((message) => message.text_bytes)).toEqual(
      stored?.messages.map((message) => encoder.encode(message.text).length),
    );
  });

  it("leaves text inside unknown segments untouched: only text segments are normalised", () => {
    const stored = importInto(emptyVault(), file()).vault.sessions[0];
    const result = stored?.messages[2]?.segments?.[0];
    expect(result).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_EXAMPLE_01",
      is_error: false,
      content: [{ type: "text", text: "src/a.ts:3: oldName()\r\nsrc/b.ts:9: oldName()" }],
    });
    expect(stored?.messages[1]?.segments?.[3]).toEqual({
      type: "tool_use",
      id: "toolu_EXAMPLE_02",
      name: "Bash",
      input: { command: "ls -la\r\n" },
    });
  });

  it("exports alone as a session document", () => {
    const imported = importInto(emptyVault(), file());
    const single = exportDocument(imported.vault, { kind: "session", id: coding().id }, exportContext, {
      includeBytes: true,
    });
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    expect(validateDocument(single.doc).ok).toBe(true);
    expect(single.doc.sessions[0]?.messages[1]?.segments[2]).toEqual(coding().messages[1]?.segments[2]);
  });
});
