/// <reference types="node" />
// The export algorithm of data-model.md 6.8.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { describe, expect, it, vi } from "vitest";
import {
  checkVault,
  type DocumentExportOptions,
  type DocumentExportScope,
  documentText,
  documentTextChunks,
  emptyVault,
  exportDocument,
  importDocument,
  MAX_INLINE_BYTES,
  makeSession,
  segmentedMessage,
  textMessage,
  type Vault,
  type VaultAttachment,
  type VaultProject,
  type VaultSession,
  validateDocument,
  webGenerator,
} from "./index.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const DOCS = new URL("../../../docs/", import.meta.url);
const readText = (name: string): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(new URL(name, DOCS)));
const EXAMPLE_TEXT = readText("example-vault-export.json");
const ajvValidate = new Ajv({ strict: true }).compile(JSON.parse(readText("interchange-schema-v1.json")));

const NOW = new Date("2026-11-20T08:00:00.000Z");
const CONTEXT = { now: NOW, generator: webGenerator("0.1.0") };
const T1 = new Date("2026-05-01T10:00:00.000Z");
const T2 = new Date("2026-05-02T10:00:00.000Z");

const projectId = (n: number): string => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessionId = (n: number): string => `5e550000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const messageId = (session: number, n: number): string =>
  `0e55${String(session).padStart(4, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

function project(n: number, changes: Partial<VaultProject> = {}): VaultProject {
  return { id: projectId(n), name: `Project ${n}`, created_at: T1, updated_at: T1, extra: {}, ...changes };
}

function session(n: number, changes: Partial<VaultSession> = {}): VaultSession {
  return {
    ...makeSession({
      id: sessionId(n),
      title: `Session ${n}`,
      provider: "claude",
      created_at: T1,
      imported_at: T1,
      updated_at: T1,
      messages: [
        textMessage({ id: messageId(n, 0), position: 0, role: "user", text: `question ${n}` }),
        textMessage({ id: messageId(n, 1), position: 1, role: "assistant", text: `answer ${n}` }),
      ],
    }),
    ...changes,
  };
}

const PDF = new TextEncoder().encode("%PDF-1.4 synthetic page");
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function attachment(bytes: Uint8Array, changes: Partial<VaultAttachment> = {}): VaultAttachment {
  return {
    kind: "original_pdf",
    sha256: sha(bytes),
    media_type: "application/pdf",
    byte_length: bytes.length,
    filename: "",
    created_at: T1,
    extra: {},
    ...changes,
  };
}

function vaultOf(
  projects: VaultProject[],
  sessions: VaultSession[],
  blobs: [string, Uint8Array][] = [],
): Vault {
  return { projects, sessions, blobs: new Map(blobs) };
}

function exported(
  vault: Vault,
  scope: DocumentExportScope = { kind: "vault" },
  options: DocumentExportOptions = { includeBytes: true },
) {
  const before = structuredClone(vault);
  const result = exportDocument(vault, scope, CONTEXT, options);
  // Exporting never changes the vault.
  expect(vault).toEqual(before);
  if (!result.ok)
    throw new Error(
      `export refused: ${result.problems.items.map((p) => `${p.rule} ${p.path} ${p.message}`).join("; ")}`,
    );
  // 6.8: the output passes the schema and R1 to R10 without repair.
  expect(ajvValidate(result.doc)).toBe(true);
  expect(validateDocument(result.doc).problems.items).toEqual([]);
  return result;
}

function refusedExport(vault: Vault, scope: DocumentExportScope = { kind: "vault" }, context = CONTEXT) {
  const result = exportDocument(vault, scope, context, { includeBytes: true });
  if (result.ok) throw new Error("the export should have been refused");
  return result.problems.items.map(
    (p) => `${p.rule}${p.keyword === undefined ? "" : `:${p.keyword}`} ${p.path}`,
  );
}

describe("what is written", () => {
  it("an empty vault is a valid vault document with empty lists", () => {
    const result = exported(emptyVault());
    expect(result.doc).toEqual({
      format: "sessionvault-interchange",
      version: 1,
      kind: "vault",
      exported_at: "2026-11-20T08:00:00.000Z",
      generator: { app: "sessionvault-web", app_version: "0.1.0", platform: "web" },
      projects: [],
      sessions: [],
    });
    expect(documentText(result.doc)).toBe(
      '{"format":"sessionvault-interchange","version":1,"kind":"vault","exported_at":"2026-11-20T08:00:00.000Z",' +
        '"generator":{"app":"sessionvault-web","app_version":"0.1.0","platform":"web"},"projects":[],"sessions":[]}',
    );
  });

  it("every known property of projects, sessions and attachments, also when it holds its default", () => {
    const vault = vaultOf([project(1)], [session(1, { attachments: [attachment(PDF)] })]);
    const result = exported(vault);
    expect(result.doc.projects).toEqual([
      {
        id: projectId(1),
        name: "Project 1",
        created_at: "2026-05-01T10:00:00.000Z",
        updated_at: "2026-05-01T10:00:00.000Z",
      },
    ]);
    expect(result.doc.sessions[0]).toEqual({
      id: sessionId(1),
      title: "Session 1",
      provider: "claude",
      model: "",
      source_url: "",
      summary: "",
      tags: [],
      is_pinned: false,
      created_at: "2026-05-01T10:00:00.000Z",
      imported_at: "2026-05-01T10:00:00.000Z",
      updated_at: "2026-05-01T10:00:00.000Z",
      project_id: null,
      attachments: [
        {
          kind: "original_pdf",
          sha256: sha(PDF),
          media_type: "application/pdf",
          byte_length: PDF.length,
          filename: "",
          created_at: "2026-05-01T10:00:00.000Z",
        },
      ],
      messages: [
        { id: messageId(1, 0), index: 0, role: "user", segments: [{ type: "text", text: "question 1" }] },
        { id: messageId(1, 1), index: 1, role: "assistant", segments: [{ type: "text", text: "answer 1" }] },
      ],
    });
  });

  it("a message's created_at and model only when they are set", () => {
    const messages = [
      textMessage({
        id: messageId(1, 0),
        position: 0,
        role: "user",
        text: "typed in the app",
        created_at: T2,
      }),
      textMessage({
        id: messageId(1, 1),
        position: 1,
        role: "assistant",
        text: "reply",
        created_at: T2,
        model: "claude-opus-5",
      }),
      textMessage({ id: messageId(1, 2), position: 2, role: "unknown", text: "imported" }),
    ];
    const result = exported(vaultOf([], [session(1, { messages, message_count: 3 })]));
    expect(result.doc.sessions[0]?.messages.map((message) => Object.keys(message))).toEqual([
      ["id", "index", "role", "segments", "created_at"],
      ["id", "index", "role", "segments", "created_at", "model"],
      ["id", "index", "role", "segments"],
    ]);
    expect(result.doc.sessions[0]?.messages[1]).toMatchObject({
      created_at: "2026-05-02T10:00:00.000Z",
      model: "claude-opus-5",
    });
  });

  it("stored segments as they are, and one text segment for a message that stores none", () => {
    const toolCall = { type: "tool_use", name: "read_file", input: { path: "notes.md" } };
    const messages = [
      textMessage({ id: messageId(1, 0), position: 0, role: "user", text: "" }),
      segmentedMessage({
        id: messageId(1, 1),
        position: 1,
        role: "assistant",
        segments: [{ type: "text", text: "Looking." }, toolCall],
      }),
      segmentedMessage({
        id: messageId(1, 2),
        position: 2,
        role: "tool",
        segments: [{ type: "tool_result", content: "file text" }],
      }),
    ];
    const result = exported(vaultOf([], [session(1, { messages, message_count: 3 })]));
    expect(result.doc.sessions[0]?.messages.map((message) => message.segments)).toEqual([
      [{ type: "text", text: "" }],
      [{ type: "text", text: "Looking." }, toolCall],
      [{ type: "tool_result", content: "file text" }],
    ]);
    expect(result.doc.sessions[0]?.messages[2]?.role).toBe("tool");
  });

  it("the keys of extra after the known properties; a known property always wins over extra", () => {
    const extra = {
      x_capture: { method: "paste" },
      title: "from extra",
      id: "from extra",
      messages: "from extra",
      x_last: 1,
    };
    const result = exported(
      vaultOf([project(1, { extra: { x_color: "green", name: "from extra" } })], [session(1, { extra })]),
    );
    expect(Object.keys(result.doc.sessions[0] ?? {})).toEqual([
      "id",
      "title",
      "provider",
      "model",
      "source_url",
      "summary",
      "tags",
      "is_pinned",
      "created_at",
      "imported_at",
      "updated_at",
      "project_id",
      "attachments",
      "messages",
      "x_capture",
      "x_last",
    ]);
    expect(result.doc.sessions[0]).toMatchObject({
      id: sessionId(1),
      title: "Session 1",
      x_capture: { method: "paste" },
      x_last: 1,
    });
    expect(result.doc.projects[0]).toEqual({
      id: projectId(1),
      name: "Project 1",
      created_at: "2026-05-01T10:00:00.000Z",
      updated_at: "2026-05-01T10:00:00.000Z",
      x_color: "green",
    });
    // checkVault points at such a bag: the known name in it is lost on export.
    expect(
      checkVault(vaultOf([], [session(1, { extra })])).problems.items.map((p) => `${p.rule} ${p.path}`),
    ).toEqual(["vault /sessions/0/extra"]);
  });

  it("exported_at from the context, with exactly three fraction digits", () => {
    const at = (now: Date) => {
      const result = exportDocument(
        emptyVault(),
        { kind: "vault" },
        { now, generator: webGenerator("1") },
        { includeBytes: false },
      );
      return result.ok ? result.doc.exported_at : null;
    };
    expect(at(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(at(new Date("2026-01-02T03:04:05.678Z"))).toBe("2026-01-02T03:04:05.678Z");
    expect(at(new Date(Number.NaN))).toBeNull();
    expect(at(new Date(8.64e15))).toBeNull();
    expect(
      refusedExport(
        emptyVault(),
        { kind: "vault" },
        { now: new Date(Number.NaN), generator: webGenerator("1") },
      ),
    ).toEqual(["vault "]);
  });

  it("the generator of the context, which must name an app", () => {
    const withGenerator = (generator: Record<string, unknown>) =>
      exportDocument(
        emptyVault(),
        { kind: "vault" },
        { now: NOW, generator: generator as never },
        { includeBytes: false },
      );
    const apple = withGenerator({
      app: "sessionvault-apple",
      app_version: "1.4",
      platform: "macOS",
      x_build: 3,
    });
    expect(apple.ok && apple.doc.generator).toEqual({
      app: "sessionvault-apple",
      app_version: "1.4",
      platform: "macOS",
      x_build: 3,
    });
    const nameless = withGenerator({ app: "" });
    expect(nameless.ok).toBe(false);
    expect(webGenerator("9.9.9")).toEqual({ app: "sessionvault-web", app_version: "9.9.9", platform: "web" });
  });
});

describe("order", () => {
  const shuffled = vaultOf(
    [project(3), project(1), project(2)],
    [session(2), session(3, { project_id: projectId(3) }), session(1)],
  );

  it("projects and sessions by id, whatever their order in the vault", () => {
    const result = exported(shuffled);
    expect(result.doc.projects.map((p) => p.id)).toEqual([projectId(1), projectId(2), projectId(3)]);
    expect(result.doc.sessions.map((s) => s.id)).toEqual([sessionId(1), sessionId(2), sessionId(3)]);
  });

  it("is the same text for the same content in another order", () => {
    const sorted = vaultOf(
      [project(1), project(2), project(3)],
      [session(1), session(2), session(3, { project_id: projectId(3) })],
    );
    expect(documentText(exported(shuffled).doc)).toBe(documentText(exported(sorted).doc));
    expect(documentText(exported(shuffled).doc)).toBe(documentText(exported(shuffled).doc));
  });

  it("messages by position, index being the place in the array", () => {
    const messages = [
      textMessage({ id: messageId(1, 2), position: 2, role: "user", text: "third" }),
      textMessage({ id: messageId(1, 0), position: 0, role: "user", text: "first" }),
      textMessage({ id: messageId(1, 1), position: 1, role: "assistant", text: "second" }),
    ];
    const result = exported(vaultOf([], [session(1, { messages, message_count: 3 })]));
    expect(result.doc.sessions[0]?.messages.map((m) => [m.index, m.segments[0]?.text])).toEqual([
      [0, "first"],
      [1, "second"],
      [2, "third"],
    ]);
    // Positions with gaps are closed: the index is the place in the array.
    const gappy = [
      textMessage({ id: messageId(1, 0), position: 10, role: "user", text: "a" }),
      textMessage({ id: messageId(1, 1), position: 20, role: "user", text: "b" }),
    ];
    expect(
      exported(vaultOf([], [session(1, { messages: gappy })])).doc.sessions[0]?.messages.map((m) => m.index),
    ).toEqual([0, 1]);
  });

  it("attachments and tags in stored order", () => {
    const png = new Uint8Array([1, 2, 3]);
    const attachments = [
      attachment(png, { kind: "image", media_type: "image/png" }),
      attachment(PDF),
      attachment(png, { kind: "file" }),
    ];
    const result = exported(vaultOf([], [session(1, { attachments, tags: ["zebra", "apple", "mango"] })]));
    expect(result.doc.sessions[0]?.attachments.map((a) => a.kind)).toEqual(["image", "original_pdf", "file"]);
    expect(result.doc.sessions[0]?.tags).toEqual(["zebra", "apple", "mango"]);
  });
});

describe("scope", () => {
  const vault = vaultOf(
    [project(1), project(2)],
    [session(1, { project_id: projectId(2) }), session(2), session(3, { project_id: projectId(1) })],
  );

  it("one session: kind session, that session and its project", () => {
    const result = exported(vault, { kind: "session", id: sessionId(1) });
    expect(result.doc.kind).toBe("session");
    expect(result.doc.sessions.map((s) => s.id)).toEqual([sessionId(1)]);
    expect(result.doc.projects.map((p) => p.id)).toEqual([projectId(2)]);
  });

  it("one session without a project: no project", () => {
    const result = exported(vault, { kind: "session", id: sessionId(2) });
    expect(result.doc.projects).toEqual([]);
    expect(result.doc.sessions[0]?.project_id).toBeNull();
  });

  it("finds the session whatever the letter case of the id asked for", () => {
    expect(exported(vault, { kind: "session", id: sessionId(3).toUpperCase() }).doc.sessions[0]?.id).toBe(
      sessionId(3),
    );
  });

  it("an id the vault does not have gives a problem, not an empty document", () => {
    expect(refusedExport(vault, { kind: "session", id: sessionId(9) })).toEqual(["vault "]);
    expect(refusedExport(vault, { kind: "session", id: "" })).toEqual(["vault "]);
  });

  it("the whole vault: all projects, also empty ones, and all sessions", () => {
    const result = exported(vault);
    expect(result.doc.kind).toBe("vault");
    expect(result.doc.projects.length).toBe(2);
    expect(result.doc.sessions.length).toBe(3);
  });

  it("every session document of a vault imports back into the same vault", () => {
    const first = importDocument(emptyVault(), EXAMPLE_TEXT, { now: NOW, newId: () => "" });
    if (!first.ok) throw new Error("the example must import");
    let rebuilt = emptyVault();
    for (const stored of first.vault.sessions) {
      const single = exported(first.vault, { kind: "session", id: stored.id });
      const next = importDocument(rebuilt, single.doc, { now: NOW, newId: () => "" });
      if (!next.ok) throw new Error("a session document must import");
      rebuilt = next.vault;
    }
    // Everything but the project that has no session.
    expect(rebuilt.sessions).toEqual(first.vault.sessions);
    expect(rebuilt.blobs).toEqual(first.vault.blobs);
    expect(rebuilt.projects.map((p) => p.name).sort()).toEqual(["Bike workshop", "Garden"]);
  });
});

describe("bytes (6.4)", () => {
  const withPdf = (blobs: [string, Uint8Array][]) =>
    vaultOf([], [session(1, { attachments: [attachment(PDF)] })], blobs);

  it("inline when asked for and present", () => {
    const result = exported(withPdf([[sha(PDF), PDF]]));
    expect(result.doc.sessions[0]?.attachments[0]?.data_base64).toBe(Buffer.from(PDF).toString("base64"));
    expect(result.warnings.total).toBe(0);
  });

  it("left out when not asked for", () => {
    const result = exported(withPdf([[sha(PDF), PDF]]), { kind: "vault" }, { includeBytes: false });
    expect(result.doc.sessions[0]?.attachments[0]).not.toHaveProperty("data_base64");
    expect(result.warnings.total).toBe(0);
  });

  it("left out, without a warning, when the vault does not have them", () => {
    const result = exported(withPdf([]));
    expect(result.doc.sessions[0]?.attachments[0]).not.toHaveProperty("data_base64");
    expect(result.warnings.total).toBe(0);
  });

  it("the same bytes for every descriptor that names the hash", () => {
    const vault = vaultOf(
      [],
      [
        session(1, { attachments: [attachment(PDF)] }),
        session(2, { attachments: [attachment(PDF, { kind: "file" })] }),
      ],
      [[sha(PDF), PDF]],
    );
    const result = exported(vault);
    expect(result.doc.sessions.map((s) => s.attachments[0]?.data_base64)).toEqual([
      Buffer.from(PDF).toString("base64"),
      Buffer.from(PDF).toString("base64"),
    ]);
  });

  it("left out with a warning when the stored bytes are not the ones the descriptor describes", () => {
    const corrupt = new Uint8Array(PDF);
    corrupt[0] = 0;
    const wrongHash = exported(withPdf([[sha(PDF), corrupt]]));
    expect(wrongHash.doc.sessions[0]?.attachments[0]).not.toHaveProperty("data_base64");
    expect(wrongHash.warnings.items).toEqual([
      {
        code: "bytes_omitted",
        path: "/sessions/0/attachments/0",
        message: "The stored bytes do not have the SHA-256 of the descriptor.",
      },
    ]);
    const wrongLength = exported(withPdf([[sha(PDF), PDF.subarray(1)]]));
    expect(wrongLength.doc.sessions[0]?.attachments[0]).not.toHaveProperty("data_base64");
    expect(wrongLength.warnings.items.map((w) => w.message)).toEqual([
      "The stored bytes have another length than the descriptor says.",
    ]);
    // checkVault finds the same fault.
    expect(
      checkVault(withPdf([[sha(PDF), corrupt]])).problems.items.map((p) => `${p.rule} ${p.path}`),
    ).toEqual([`vault /blobs/${sha(PDF)}`]);
  });

  it("left out with a warning when they are larger than can travel inline", () => {
    // Allocated but never touched: the size is checked before anything reads the bytes.
    const huge = new Uint8Array(MAX_INLINE_BYTES + 1);
    const descriptor = attachment(PDF, { sha256: "0".repeat(64), byte_length: huge.length });
    const vault = vaultOf([], [session(1, { attachments: [descriptor] })], [["0".repeat(64), huge]]);
    const result = exportDocument(vault, { kind: "vault" }, CONTEXT, { includeBytes: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.sessions[0]?.attachments[0]).not.toHaveProperty("data_base64");
    expect(result.warnings.items.map((w) => w.message)).toEqual([
      "The stored bytes are too large to travel inline.",
    ]);
  });
});

describe("a vault that holds what a document may not", () => {
  const codes = (result: { warnings: { items: readonly { code: string; path: string }[] } }): string[] =>
    result.warnings.items.map((w) => `${w.code} ${w.path}`);

  it("is exported repaired, with warnings, when a reader could repair it", () => {
    const messages = [
      textMessage({
        id: messageId(1, 0).toUpperCase(),
        position: 0,
        role: "User",
        text: "line one\r\nline two",
      }),
      segmentedMessage({
        id: messageId(1, 1),
        position: 1,
        role: "assistant",
        segments: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ];
    const vault = vaultOf(
      [],
      [
        session(1, {
          messages,
          tags: ["Garden", "garden"],
          title: "nul\u0000 inside",
          project_id: projectId(7),
          provider: " Claude ",
        }),
      ],
    );
    const result = exported(vault);
    expect(result.doc.sessions[0]).toMatchObject({
      tags: ["garden"],
      title: "nul inside",
      project_id: null,
      provider: "claude",
    });
    expect(result.doc.sessions[0]?.messages).toEqual([
      {
        id: messageId(1, 0),
        index: 0,
        role: "user",
        segments: [{ type: "text", text: "line one\nline two" }],
      },
      { id: messageId(1, 1), index: 1, role: "assistant", segments: [{ type: "text", text: "a\n\nb" }] },
    ]);
    expect(codes(result)).toEqual([
      "vault_repaired ",
      "string_cleaned /sessions/0/title",
      "value_folded /sessions/0/provider",
      "tags_normalised /sessions/0/tags",
      "id_lowercased /sessions/0/messages/0/id",
      "value_folded /sessions/0/messages/0/role",
      "line_endings /sessions/0/messages/0/segments/0/text",
      "segments_merged /sessions/0/messages/1/segments",
      "project_missing /sessions/0/project_id",
    ]);
    expect(result.warnings.items[0]?.message).toBe(
      "The vault held 6 value(s) the format does not allow; the export wrote them repaired.",
    );
    // checkVault names the same faults beforehand, without repairing anything.
    expect(checkVault(vault).ok).toBe(false);
  });

  it("is exported as it is when it is merely unusual: nothing valid is rewritten", () => {
    // A tag with a leading "#" and a provider in mixed case are valid in a document.
    const vault = vaultOf([], [session(1, { tags: ["#hash"], provider: "ExampleBot" })]);
    const result = exported(vault);
    expect(result.doc.sessions[0]).toMatchObject({ tags: ["#hash"], provider: "ExampleBot" });
    expect(result.warnings.total).toBe(0);
  });

  it("is refused when no reader could repair it", () => {
    expect(refusedExport(vaultOf([], [session(1, { id: "not-a-uuid" })]))).toEqual([
      "schema:pattern /sessions/0/id",
    ]);
    expect(refusedExport(vaultOf([], [session(1, { created_at: new Date(Number.NaN) })]))).toEqual([
      "schema:pattern /sessions/0/created_at",
    ]);
    expect(refusedExport(vaultOf([], [session(1), session(1)]))).toEqual([
      "R2 /sessions/1/id",
      "R2 /sessions/1/messages/0/id",
      "R2 /sessions/1/messages/1/id",
    ]);
    expect(refusedExport(vaultOf([project(1, { name: "  " })], []))).toEqual([
      "schema:pattern /projects/0/name",
    ]);
    const twoOriginals = [attachment(PDF), attachment(new Uint8Array([1]))];
    expect(refusedExport(vaultOf([], [session(1, { attachments: twoOriginals })]))).toEqual([
      "R5 /sessions/0/attachments/1",
    ]);
  });

  it("is refused, not thrown about, when it is not a vault at all", () => {
    const broken = { projects: null, sessions: [{}], blobs: new Map() } as unknown as Vault;
    const result = exportDocument(broken, { kind: "vault" }, CONTEXT, { includeBytes: true });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.problems.items).toEqual([
        { rule: "internal", path: "", message: "The vault could not be exported." },
      ]);
    expect(checkVault(broken).ok).toBe(false);
  });

  it("passes R11 and R12 on as warnings", () => {
    const vault = vaultOf(
      [project(1, { name: "Garden" }), project(2, { name: "garden" })],
      [session(1, { updated_at: new Date("2026-04-01T00:00:00.000Z") })],
    );
    const result = exported(vault);
    expect(codes(result)).toEqual(["R11 /projects/1/name", "R12 /sessions/0/updated_at"]);
  });
});

describe("the text of a document", () => {
  const first = importDocument(emptyVault(), EXAMPLE_TEXT, { now: NOW, newId: () => "" });
  if (!first.ok) throw new Error("the example must import");
  const result = exportDocument(first.vault, { kind: "vault" }, CONTEXT, { includeBytes: true });
  if (!result.ok) throw new Error("the example must export");
  const document = result.doc;

  it("comes in pieces: the opening with the projects, one piece per session, the closing", () => {
    const chunks = [...documentTextChunks(document)];
    expect(chunks.length).toBe(1 + 6 + 1);
    expect(
      chunks[0]?.startsWith('{"format":"sessionvault-interchange","version":1,"kind":"vault","exported_at":'),
    ).toBe(true);
    expect(chunks[0]?.endsWith(',"sessions":[')).toBe(true);
    expect(chunks[0]).toContain('"projects":[{"id":"aaaaaaaa-0000-4000-8000-000000000001"');
    expect(chunks[1]?.startsWith('{"id":"5e550000-0000-4000-8000-000000000001"')).toBe(true);
    expect(chunks[2]?.startsWith(',{"id":"5e550000-0000-4000-8000-000000000002"')).toBe(true);
    expect(chunks[7]).toBe("]}");
    for (const chunk of chunks.slice(1, 7))
      expect(JSON.parse(chunk.replace(/^,/, "")).messages).toBeDefined();
  });

  it("joined, the pieces are the document", () => {
    const text = documentText(document);
    expect(text).toBe([...documentTextChunks(document)].join(""));
    expect(JSON.parse(text ?? "")).toEqual(document);
    expect(text).toBe(JSON.stringify(document));
  });

  it("puts unknown top-level properties before the sessions, so that sessions can still be streamed", () => {
    const read = importDocument(emptyVault(), EXAMPLE_TEXT, { now: NOW, newId: () => "" });
    expect(read.ok).toBe(true);
    const withNote = { ...document, x_note: "about the file", sessions: document.sessions };
    const chunks = [...documentTextChunks(withNote)];
    expect(chunks[0]?.endsWith(',"x_note":"about the file","sessions":[')).toBe(true);
    expect(JSON.parse(chunks.join(""))).toEqual(withNote);
  });

  it("holds no line break and no characters outside JSON's escapes for control characters", () => {
    const messages = [
      textMessage({
        id: messageId(1, 0),
        position: 0,
        role: "user",
        text: 'tab\tquote"backslash\\\nnew line \u2028 \u{1F600}',
      }),
    ];
    const text = documentText(exported(vaultOf([], [session(1, { messages, message_count: 1 })])).doc) ?? "";
    expect(text).not.toContain("\n");
    expect(JSON.parse(text).sessions[0].messages[0].segments[0].text).toBe(
      'tab\tquote"backslash\\\nnew line \u2028 \u{1F600}',
    );
  });
});
