/// <reference types="node" />
// docs/corrections.md section 2, as far as it speaks of the merge, the writer and what is stored:
// the storage invariant G1 with its normalising constructor, and the points 9 to 12. One describe
// per point; inputs and expected values are taken from the words of the rule.
//
// The reader's points are in corrections.test.ts, the file names of point 16 in filename.test.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  checkVault,
  type DocumentImportContext,
  type DocumentImportOptions,
  documentText,
  emptyVault,
  exportDocument,
  type InterchangeDocument,
  importDocument,
  makeSession,
  normaliseProject,
  normaliseSession,
  type ProjectDraft,
  readDocument,
  type SessionDraft,
  segmentedMessage,
  textMessage,
  type Vault,
  type VaultSession,
  validateDocument,
  webGenerator,
} from "./index.ts";

// Property tests and large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const DOCS = new URL("../../../docs/", import.meta.url);
const readText = (name: string): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(new URL(name, DOCS)));
const EXAMPLE_TEXT = readText("example-vault-export.json");
const ajvValidate = new Ajv({ strict: true }).compile(JSON.parse(readText("interchange-schema-v1.json")));

/** Characters by code point: the sources of this folder are plain ASCII. */
const cp = (...points: number[]): string => String.fromCodePoint(...points);
const NUL = cp(0);
const LONE_HIGH = cp(0xd83d);
const REPLACEMENT = cp(0xfffd);

const NOW = new Date("2026-11-20T08:00:00.000Z");
const T0 = "2026-04-01T10:00:00.000Z";
const T1 = "2026-05-01T10:00:00.000Z";
const T2 = "2026-05-02T10:00:00.000Z";
const T3 = "2026-05-03T10:00:00.000Z";

const projectId = (n: number): string => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessionId = (n: number): string => `5e550000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const messageId = (session: number, n: number): string =>
  `0e55${String(session).padStart(4, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const freshId = (n: number): string => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, "0")}`;

function context(): DocumentImportContext & { readonly calls: () => number } {
  let n = 0;
  return { now: NOW, newId: () => freshId(++n), calls: () => n };
}

type Loose = Record<string, unknown>;

function project(n: number, changes: Loose = {}): Loose {
  return { id: projectId(n), name: `Project ${n}`, created_at: T1, updated_at: T1, ...changes };
}

function message(session: number, n: number, text: string, changes: Loose = {}): Loose {
  return {
    id: messageId(session, n),
    index: n,
    role: n % 2 === 0 ? "user" : "assistant",
    segments: [{ type: "text", text }],
    ...changes,
  };
}

function session(n: number, changes: Loose = {}): Loose {
  return {
    id: sessionId(n),
    title: `Session ${n}`,
    provider: "claude",
    model: "",
    source_url: "",
    summary: "",
    tags: [],
    is_pinned: false,
    created_at: T1,
    imported_at: T1,
    updated_at: T1,
    project_id: null,
    attachments: [],
    messages: [message(n, 0, `question ${n}`), message(n, 1, `answer ${n}`)],
    ...changes,
  };
}

function vaultDocument(projects: Loose[], sessions: Loose[], changes: Loose = {}): Loose {
  return {
    format: "sessionvault-interchange",
    version: 1,
    kind: "vault",
    exported_at: "2026-06-01T00:00:00.000Z",
    projects,
    sessions,
    ...changes,
  };
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const PDF = new TextEncoder().encode("%PDF-1.4 synthetic page");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const TXT = new TextEncoder().encode("a note");

function attachment(bytes: Uint8Array, kind: string, inline: boolean, changes: Loose = {}): Loose {
  return {
    kind,
    sha256: sha256(bytes),
    media_type: kind === "original_pdf" ? "application/pdf" : "application/octet-stream",
    byte_length: bytes.length,
    filename: "",
    created_at: T1,
    ...(inline ? { data_base64: Buffer.from(bytes).toString("base64") } : {}),
    ...changes,
  };
}

function importOk(vault: Vault, input: unknown, options?: DocumentImportOptions, ctx = context()) {
  const before = structuredClone(vault);
  const result = importDocument(vault, input, ctx, options);
  // Whatever happens, the vault that went in is untouched.
  expect(vault).toEqual(before);
  if (!result.ok)
    throw new Error(`import refused: ${result.problems.items.map((p) => `${p.rule} ${p.path}`).join(", ")}`);
  return result;
}

const EXPORT_CONTEXT = { now: NOW, generator: webGenerator("0.0.0-test") };

function exportOk(vault: Vault, includeBytes = true): InterchangeDocument {
  const exported = exportDocument(vault, { kind: "vault" }, EXPORT_CONTEXT, { includeBytes });
  if (!exported.ok)
    throw new Error(
      `export refused: ${exported.problems.items.map((p) => `${p.rule} ${p.path}`).join(", ")}`,
    );
  // G1: nothing had to be repaired on the way out.
  expect(exported.warnings.items.filter((notice) => notice.code === "vault_repaired")).toEqual([]);
  return exported.doc;
}

const find = (vault: Vault, n: number) => vault.sessions.find((candidate) => candidate.id === sessionId(n));
const findProject = (vault: Vault, n: number) =>
  vault.projects.find((candidate) => candidate.id === projectId(n));
const outcomes = (result: { report: { sessions: readonly { outcome: string }[] } }): string[] =>
  result.report.sessions.map((entry) => entry.outcome);
const projectOutcomes = (result: { report: { projects: readonly { outcome: string }[] } }): string[] =>
  result.report.projects.map((entry) => entry.outcome);

/**
 * G1 as a check on a vault: it holds the reader's form, its export passes the schema and R1 to
 * R10 without repair, reading that export repairs nothing, and importing it again reports every
 * project and session as unchanged.
 */
function expectStorageInvariant(vault: Vault): void {
  expect(checkVault(vault).problems.items).toEqual([]);
  for (const includeBytes of [true, false]) {
    const doc = exportOk(vault, includeBytes);
    expect(ajvValidate(doc)).toBe(true);
    const strict = validateDocument(doc);
    expect(strict.problems.items).toEqual([]);
    const read = readDocument(doc);
    if (!read.ok) throw new Error("the vault's own export was refused");
    expect(read.repairs.items).toEqual([]);
    expect(read.doc).toEqual(doc);
    // The same through the text of a file.
    const text = documentText(doc);
    if (text === null) throw new Error("the export has no text");
    const again = importDocument(vault, text, context());
    if (!again.ok) throw new Error("the vault's own export was not imported");
    expect(again.report.repairs.items).toEqual([]);
    expect(again.report.projects.map((entry) => entry.outcome)).toEqual(
      vault.projects.map(() => "unchanged"),
    );
    expect(again.report.sessions.map((entry) => entry.outcome)).toEqual(
      vault.sessions.map(() => "unchanged"),
    );
    expect(again.report.counts).toMatchObject({
      added: 0,
      updated: 0,
      kept: 0,
      conflicts: 0,
      copies: 0,
      blobsStored: 0,
      unchanged: vault.sessions.length,
      projectsAdded: 0,
      projectsMerged: 0,
      projectsUpdated: 0,
      projectsKept: 0,
      projectsUnchanged: vault.projects.length,
    });
    // Nothing was touched: the very same objects are in the vault that comes back.
    expect(again.vault.sessions).toEqual(vault.sessions);
    again.vault.sessions.forEach((stored, i) => {
      expect(stored).toBe(vault.sessions[i]);
    });
    again.vault.projects.forEach((stored, i) => {
      expect(stored).toBe(vault.projects[i]);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// G1: the normalising constructor
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, G1: one normalising constructor that every write path can use", () => {
  const hashOf = sha256(PNG);

  /** A session as a careless write path might hand it over: everything the reader would repair. */
  const dirtyDraft = (): SessionDraft => ({
    id: sessionId(1).toUpperCase(),
    project_id: projectId(1).toUpperCase(),
    title: `Tomato${NUL} blight`,
    provider: " Claude\t",
    model: "claude-opus-5",
    source_url: "https://share.example/EXAMPLE-0001",
    summary: `half a pair ${LONE_HIGH}`,
    tags: ["Garden", " b ,C", "#x", "garden", "# #y"],
    is_pinned: true,
    created_at: new Date(T0),
    imported_at: new Date(T1),
    updated_at: new Date(T2),
    attachments: [
      {
        kind: "image",
        sha256: hashOf.toUpperCase(),
        media_type: "image/png",
        byte_length: PNG.length,
        extra: { x_pages: 1, [`bad${NUL}name`]: 2 },
      },
    ],
    messages: [
      { id: messageId(1, 0).toUpperCase(), role: "USER", text: "one\r\ntwo\rthree" },
      {
        id: messageId(1, 1),
        role: " Tool ",
        segments: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
          { type: "attachment", sha256: hashOf.toUpperCase() },
          { type: "x_tool_call", input: { query: `q${NUL}` } },
        ],
        model: "",
        created_at: new Date(T2),
        extra: { x_rating: 5 },
      },
      { id: messageId(1, 2), role: "", text: "" },
    ],
    // A known name in `extra` is not an unknown property: it is ignored.
    extra: { x_capture: { method: "paste" }, title: "not this one", [`x_${LONE_HIGH}`]: 1 },
  });

  /** The same session as a file would hold it: written by hand, not by the code under test. */
  const sameAsFile = (): Loose =>
    vaultDocument(
      [project(1)],
      [
        {
          id: sessionId(1).toUpperCase(),
          project_id: projectId(1).toUpperCase(),
          title: `Tomato${NUL} blight`,
          provider: " Claude\t",
          model: "claude-opus-5",
          source_url: "https://share.example/EXAMPLE-0001",
          summary: `half a pair ${LONE_HIGH}`,
          tags: ["Garden", " b ,C", "#x", "garden", "# #y"],
          is_pinned: true,
          created_at: T0,
          imported_at: T1,
          updated_at: T2,
          attachments: [
            {
              kind: "image",
              sha256: hashOf.toUpperCase(),
              media_type: "image/png",
              byte_length: PNG.length,
              x_pages: 1,
              [`bad${NUL}name`]: 2,
            },
          ],
          messages: [
            {
              id: messageId(1, 0).toUpperCase(),
              index: 0,
              role: "USER",
              segments: [{ type: "text", text: "one\r\ntwo\rthree" }],
            },
            {
              id: messageId(1, 1),
              index: 1,
              role: " Tool ",
              segments: [
                { type: "text", text: "first" },
                { type: "text", text: "second" },
                { type: "attachment", sha256: hashOf.toUpperCase() },
                { type: "x_tool_call", input: { query: `q${NUL}` } },
              ],
              model: "",
              created_at: T2,
              x_rating: 5,
            },
            { id: messageId(1, 2), index: 2, role: "", segments: [{ type: "text", text: "" }] },
          ],
          x_capture: { method: "paste" },
          [`x_${LONE_HIGH}`]: 1,
        },
      ],
    );

  it("stores what the reader would make of a file that holds the same values", () => {
    const normalised = normaliseSession(dirtyDraft());
    if (!normalised.ok) throw new Error("the draft was refused");
    const viaFile = importOk(emptyVault(), sameAsFile());
    expect(normalised.session).toEqual(viaFile.vault.sessions[0]);
  });

  it("the result, rule by rule: what repairs 1 to 7 and G2 give", () => {
    const normalised = normaliseSession(dirtyDraft());
    if (!normalised.ok) throw new Error("the draft was refused");
    const stored = normalised.session;
    expect(stored.id).toBe(sessionId(1));
    expect(stored.project_id).toBe(projectId(1));
    expect(stored.title).toBe("Tomato blight");
    expect(stored.provider).toBe("claude");
    expect(stored.summary).toBe(`half a pair ${REPLACEMENT}`);
    expect(stored.tags).toEqual(["garden", "b", "c", "x", "y"]);
    expect(stored.is_pinned).toBe(true);
    expect([stored.created_at, stored.imported_at, stored.updated_at].map((d) => d.toISOString())).toEqual([
      T0,
      T1,
      T2,
    ]);
    expect(stored.attachments).toEqual([
      {
        kind: "image",
        sha256: hashOf,
        media_type: "image/png",
        byte_length: PNG.length,
        filename: "",
        // Without a date of its own an attachment takes the session's imported_at (repair 3).
        created_at: new Date(T1),
        extra: { x_pages: 1 },
      },
    ]);
    expect(stored.extra).toEqual({ x_capture: { method: "paste" } });
    expect(stored.messages.map((m) => [m.id, m.position, m.role, m.model])).toEqual([
      [messageId(1, 0), 0, "user", ""],
      [messageId(1, 1), 1, "Tool", ""],
      [messageId(1, 2), 2, "unknown", ""],
    ]);
    expect(stored.messages[0]).toMatchObject({ text: "one\ntwo\nthree", segments: null, text_bytes: 13 });
    expect(stored.messages[1]?.segments).toEqual([
      { type: "text", text: "first\n\nsecond" },
      { type: "attachment", sha256: hashOf },
      { type: "x_tool_call", input: { query: "q" } },
    ]);
    expect(stored.messages[1]).toMatchObject({
      text: "first\n\nsecond",
      created_at: new Date(T2),
      extra: { x_rating: 5 },
    });
    expect(stored.messages[2]).toMatchObject({ text: "", segments: null, created_at: null });
    // The derived values.
    expect(stored.message_count).toBe(3);
    expect(stored.text_bytes).toBe(13 + 13 + 0);
    // What was changed is reported with the reader's codes, paths starting at the session.
    expect(normalised.repairs.counts).toEqual({
      string_cleaned: 3,
      id_lowercased: 5,
      value_folded: 4,
      tags_normalised: 1,
      line_endings: 1,
      segments_merged: 1,
    });
    expect(normalised.repairs.items.map((notice) => notice.path)).toContain("/messages/1/role");
    expect(normalised.warnings.counts).toEqual({ property_dropped: 2 });
  });

  it("normalising what is normal already changes nothing and reports no repair", () => {
    const first = normaliseSession(dirtyDraft());
    if (!first.ok) throw new Error("the draft was refused");
    // A stored session is a draft too.
    const second = normaliseSession(first.session);
    if (!second.ok) throw new Error("the stored session was refused");
    expect(second.session).toEqual(first.session);
    expect(second.repairs.total).toBe(0);
    expect(second.warnings.total).toBe(0);
  });

  it("fills what a draft leaves out with the defaults of repair 3", () => {
    const minimal = normaliseSession({
      id: sessionId(2),
      title: "",
      provider: "",
      created_at: new Date(T0),
      imported_at: new Date(T1),
      messages: [{ id: messageId(2, 0), role: "user" }],
    });
    if (!minimal.ok) throw new Error("the draft was refused");
    expect(minimal.session).toEqual(
      makeSession({
        id: sessionId(2),
        title: "",
        provider: "other",
        created_at: new Date(T0),
        imported_at: new Date(T1),
        updated_at: new Date(T1),
        messages: [textMessage({ id: messageId(2, 0), position: 0, role: "user", text: "" })],
      }),
    );
    expect(minimal.session).toMatchObject({
      project_id: null,
      model: "",
      source_url: "",
      summary: "",
      tags: [],
      is_pinned: false,
      attachments: [],
      extra: {},
    });
  });

  it("refuses what the reader refuses, and says where", () => {
    const base = (): SessionDraft => ({
      id: sessionId(3),
      title: "t",
      provider: "claude",
      created_at: new Date(T0),
      imported_at: new Date(T1),
      messages: [
        { id: messageId(3, 0), role: "user", text: "a" },
        { id: messageId(3, 1), role: "assistant", text: "b" },
      ],
    });
    const refusal = (draft: SessionDraft): string[] => {
      const result = normaliseSession(draft);
      if (result.ok) throw new Error("the draft should have been refused");
      return result.problems.items.map((p) => `${p.rule} ${p.path}`);
    };
    // G2: more than 200 characters, before any normalisation.
    expect(refusal({ ...base(), provider: "p".repeat(201) })).toEqual(["limit /provider"]);
    expect(refusal({ ...base(), provider: `claude${" ".repeat(195)}` })).toEqual(["limit /provider"]);
    expect(
      refusal({
        ...base(),
        messages: [{ id: messageId(3, 0), role: `${"r".repeat(200)}${NUL}`, text: "a" }],
      }),
    ).toEqual(["limit /messages/0/role"]);
    // Ids, dates, repeated ids, attachments.
    expect(refusal({ ...base(), id: "not-a-uuid" })).toEqual(["schema /id"]);
    expect(refusal({ ...base(), created_at: new Date(Number.NaN) })).toEqual(["schema /created_at"]);
    expect(refusal({ ...base(), imported_at: new Date("0000-06-01T00:00:00.000Z") })).toEqual([
      "schema /imported_at",
    ]);
    expect(refusal({ ...base(), updated_at: new Date(8.64e15) })).toEqual(["schema /updated_at"]);
    expect(
      refusal({
        ...base(),
        messages: [
          { id: messageId(3, 0), role: "user", text: "a" },
          { id: messageId(3, 0).toUpperCase(), role: "user", text: "b" },
        ],
      }),
    ).toEqual(["R2 /messages/1/id"]);
    const descriptor = { kind: "image", sha256: hashOf, media_type: "image/png", byte_length: 7 };
    expect(
      refusal({ ...base(), attachments: [descriptor, { ...descriptor, sha256: hashOf.toUpperCase() }] }),
    ).toEqual(["R5 /attachments/1"]);
    expect(
      refusal({
        ...base(),
        messages: [{ id: messageId(3, 0), role: "user", segments: [{ type: "attachment", sha256: hashOf }] }],
      }),
    ).toEqual(["R7 /messages/0/segments/0/sha256"]);
    expect(refusal({ ...base(), attachments: [{ ...descriptor, media_type: "Image/PNG" }] })).toEqual([
      "schema /attachments/0/media_type",
    ]);
    // 200 characters are fine.
    expect(normaliseSession({ ...base(), provider: "p".repeat(200) }).ok).toBe(true);
  });

  it("repair 8: with the ids of the projects given, a project_id that is none of them becomes null, with a warning", () => {
    const draft = (): SessionDraft => ({
      id: sessionId(4),
      project_id: projectId(7),
      title: "t",
      provider: "claude",
      created_at: new Date(T0),
      imported_at: new Date(T1),
      messages: [],
    });
    const unknown = normaliseSession(draft(), { projectIds: new Set([projectId(1)]) });
    expect(unknown.ok && unknown.session.project_id).toBeNull();
    expect(unknown.ok && unknown.warnings.counts).toEqual({ project_missing: 1 });
    const known = normaliseSession(draft(), { projectIds: new Set([projectId(7)]) });
    expect(known.ok && known.session.project_id).toBe(projectId(7));
    expect(known.ok && known.warnings.total).toBe(0);
    // Without the option the caller answers for the project.
    const unchecked = normaliseSession(draft());
    expect(unchecked.ok && unchecked.session.project_id).toBe(projectId(7));
  });

  it("never throws and never changes the draft, whatever it is given", () => {
    const frozen = structuredClone(dirtyDraft());
    const draft = dirtyDraft();
    normaliseSession(draft);
    expect(draft).toEqual(frozen);
    const hostile: unknown[] = [
      null,
      undefined,
      7,
      "session",
      [],
      {},
      { id: sessionId(1) },
      { ...dirtyDraft(), messages: null },
      { ...dirtyDraft(), messages: [null, 7, "x"] },
      { ...dirtyDraft(), created_at: "2026-01-01" },
      { ...dirtyDraft(), tags: "garden" },
      { ...dirtyDraft(), attachments: [null] },
      { ...dirtyDraft(), extra: [1, 2] },
      { ...dirtyDraft(), title: 7, provider: null },
    ];
    for (const value of hostile) {
      // The type says SessionDraft; a caller in JavaScript can pass anything.
      const result = Reflect.apply(normaliseSession, undefined, [value]);
      expect(result.ok, JSON.stringify(value)?.slice(0, 60)).toBe(false);
      expect(result.problems.total).toBeGreaterThan(0);
      const asProject = Reflect.apply(normaliseProject, undefined, [value]);
      expect(asProject.ok).toBe(false);
    }
  });

  it("normaliseProject: the reader's form of a project", () => {
    const draft: ProjectDraft = {
      id: projectId(1).toUpperCase(),
      name: ` Bike${NUL} workshop `,
      created_at: new Date(T0),
      extra: { x_color: "teal", name: "ignored", [`x${NUL}`]: 1 },
    };
    const normalised = normaliseProject(draft);
    if (!normalised.ok) throw new Error("the project was refused");
    expect(normalised.project).toEqual({
      id: projectId(1),
      // Cleaned, and otherwise as written: the reader does not trim a project name.
      name: " Bike workshop ",
      created_at: new Date(T0),
      updated_at: new Date(T0),
      extra: { x_color: "teal" },
    });
    expect(normalised.repairs.counts).toEqual({ string_cleaned: 1, id_lowercased: 1 });
    expect(normalised.warnings.counts).toEqual({ property_dropped: 1 });
    const again = normaliseProject(normalised.project);
    expect(again.ok && again.project).toEqual(normalised.project);
    expect(again.ok && again.repairs.total).toBe(0);
    for (const name of ["", " ", `${NUL}`, "\t\n"]) {
      const refused = normaliseProject({ ...draft, name });
      expect(refused.ok, JSON.stringify(name)).toBe(false);
    }
    expect(normaliseProject({ ...draft, id: "x" }).ok).toBe(false);
    expect(normaliseProject({ ...draft, created_at: new Date(Number.NaN) }).ok).toBe(false);
  });

  it("on generated drafts: the result is a fixed point, checks as a vault, and is what the file route stores", () => {
    const text = fc.constantFrom(
      "",
      "plain",
      " padded ",
      "two\r\nlines",
      `nul${NUL}`,
      `lone ${LONE_HIGH}`,
      "Claude",
      " USER ",
      "#Tag, other",
      `caf${cp(0xe9)} ${cp(0x1f600)}`,
    );
    const role = fc.constantFrom("user", "USER", " Assistant", "system", "", "tool", "Tool ", `x${NUL}`);
    const provider = fc.constantFrom(
      "claude",
      "Claude",
      " CHATGPT ",
      "gemini",
      "",
      "ExampleBot",
      `${cp(0xa0)}other`,
    );
    const draftArbitrary = fc.record({
      title: text,
      provider,
      model: text,
      summary: text,
      tags: fc.array(text, { maxLength: 4 }),
      is_pinned: fc.boolean(),
      upper: fc.boolean(),
      messages: fc.array(
        fc.record({ role, text, model: fc.constantFrom(undefined, "", "m"), split: fc.boolean() }),
        { maxLength: 4 },
      ),
    });
    let repaired = 0;
    fc.assert(
      fc.property(draftArbitrary, (plan) => {
        const id = plan.upper ? sessionId(9).toUpperCase() : sessionId(9);
        const draft: SessionDraft = {
          id,
          title: plan.title,
          provider: plan.provider,
          model: plan.model,
          summary: plan.summary,
          tags: plan.tags,
          is_pinned: plan.is_pinned,
          created_at: new Date(T0),
          imported_at: new Date(T1),
          messages: plan.messages.map((m, n) => ({
            id: messageId(9, n),
            role: m.role,
            ...(m.split
              ? {
                  segments: [
                    { type: "text", text: m.text },
                    { type: "text", text: "more" },
                  ],
                }
              : { text: m.text }),
            ...(m.model === undefined ? {} : { model: m.model }),
          })),
        };
        const normalised = normaliseSession(draft);
        if (!normalised.ok) throw new Error("a generated draft was refused");
        if (normalised.repairs.total > 0) repaired += 1;
        const stored = normalised.session;
        // A fixed point.
        const again = normaliseSession(stored);
        expect(again.ok && again.session).toEqual(stored);
        expect(again.ok && again.repairs.total).toBe(0);
        // A vault of it satisfies the storage invariant.
        expectStorageInvariant({ projects: [], sessions: [stored], blobs: new Map() });
        // And it is what importing a file with the same values stores.
        const asFile = vaultDocument(
          [],
          [
            {
              id,
              title: plan.title,
              provider: plan.provider,
              model: plan.model,
              summary: plan.summary,
              tags: plan.tags,
              is_pinned: plan.is_pinned,
              created_at: T0,
              imported_at: T1,
              messages: plan.messages.map((m, n) => ({
                id: messageId(9, n),
                index: n,
                role: m.role,
                segments: m.split
                  ? [
                      { type: "text", text: m.text },
                      { type: "text", text: "more" },
                    ]
                  : [{ type: "text", text: m.text }],
                ...(m.model === undefined ? {} : { model: m.model }),
              })),
            },
          ],
        );
        expect(importOk(emptyVault(), asFile).vault.sessions[0]).toEqual(stored);
      }),
      { numRuns: 300, seed: 20261120 },
    );
    expect(repaired).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------------------------
// G1: the storage invariant
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, G1: whatever is stored is in the form the reader produces", () => {
  /** A file that needs every repair the reader has, and is accepted. */
  const dirtyFile = (): Loose =>
    vaultDocument(
      [
        { id: projectId(1).toUpperCase(), name: `Garden${NUL}`, created_at: "2026-05-01T10:00:00Z" },
        project(2, { name: "Bikes", updated_at: null, x_color: null }),
      ],
      [
        {
          id: sessionId(1).toUpperCase(),
          title: `A${NUL}B`,
          provider: " Claude ",
          tags: ["Garden", "#bikes, garden", "# #x"],
          created_at: "2026-05-01T10:00:00.123456Z",
          imported_at: "2026-05-01T10:00:00Z",
          project_id: projectId(1),
          model: null,
          attachments: [
            {
              kind: "original_pdf",
              sha256: sha256(PDF).toUpperCase(),
              media_type: "application/pdf",
              byte_length: PDF.length,
              data_base64: Buffer.from(PDF).toString("base64").replace(/=+$/, ""),
            },
            { ...attachment(PNG, "image", false), data_base64: "not base64 at all!" },
          ],
          messages: [
            {
              id: messageId(1, 1),
              index: 7,
              role: "ASSISTANT",
              model: "",
              segments: [
                { type: "text", text: "one\r\n" },
                { type: "text", text: "two" },
                { type: "attachment", sha256: sha256(PNG).toUpperCase() },
              ],
            },
            {
              id: messageId(1, 0).toUpperCase(),
              index: 2.5,
              role: " tool",
              segments: [{ type: "x_call", [`n${NUL}`]: 1, input: `q ${LONE_HIGH}` }],
            },
          ],
          [`x_${NUL}`]: "dropped",
        },
        session(2, { provider: "ExampleBot", project_id: projectId(9), updated_at: "2026-04-01T00:00:00Z" }),
      ],
    );

  it("the interchange import: a file that needs every repair leaves a vault that needs none", () => {
    const imported = importOk(emptyVault(), dirtyFile());
    // The file really needed them.
    expect(Object.keys(imported.report.repairs.counts).sort()).toEqual(
      [
        "id_lowercased",
        "line_endings",
        "messages_renumbered",
        "null_default",
        "segments_merged",
        "string_cleaned",
        "tags_normalised",
        "timestamp_precision",
        "value_folded",
      ].sort(),
    );
    expect(Object.keys(imported.report.warnings.counts).sort()).toEqual(
      ["R12", "bytes_discarded", "project_missing", "property_dropped"].sort(),
    );
    expectStorageInvariant(imported.vault);
    // The same file again: unchanged too, although it is not the app's own export.
    const again = importOk(imported.vault, dirtyFile());
    expect(outcomes(again)).toEqual(["unchanged", "unchanged"]);
    expect(projectOutcomes(again)).toEqual(["unchanged", "unchanged"]);
  });

  it("a second import of the core's own export reports every project and session as unchanged: the example file", () => {
    const imported = importOk(emptyVault(), EXAMPLE_TEXT);
    expect(imported.report.counts).toMatchObject({ added: 6, projectsAdded: 3 });
    expectStorageInvariant(imported.vault);
  });

  it("the copy a conflict policy makes: the caller's title suffix is stored cleaned", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1)]));
    const conflicting = vaultDocument([], [session(1, { title: "Other title" })]);
    const copied = importOk(first.vault, conflicting, {
      onConflict: { copyWithTitleSuffix: ` (copy${NUL})${LONE_HIGH}` },
    });
    expect(copied.report.sessions[0]).toMatchObject({ outcome: "kept", conflict: true, copyId: freshId(1) });
    const copy = copied.vault.sessions.find((candidate) => candidate.id === freshId(1));
    expect(copy?.title).toBe(`Other title (copy)${REPLACEMENT}`);
    expectStorageInvariant(copied.vault);
  });

  it("checkVault tells a vault that holds another form: a spelling the reader would change", () => {
    const at = (changes: Partial<VaultSession>, messageRole = "user") => {
      const stored = makeSession({
        id: sessionId(1),
        title: "t",
        provider: "claude",
        created_at: new Date(T0),
        imported_at: new Date(T1),
        updated_at: new Date(T1),
        messages: [textMessage({ id: messageId(1, 0), position: 0, role: messageRole, text: "hello" })],
      });
      const vault: Vault = { projects: [], sessions: [{ ...stored, ...changes }], blobs: new Map() };
      return checkVault(vault).problems.items.map((p) => `${p.rule} ${p.path}`);
    };
    expect(at({})).toEqual([]);
    // Valid for a writer (schema and R1 to R10), and still not what the reader would store.
    expect(at({ provider: "Claude" })).toEqual(["vault /sessions/0"]);
    expect(at({ provider: " claude" })).toEqual(["vault /sessions/0"]);
    expect(at({ tags: ["#garden"] })).toEqual(["vault /sessions/0"]);
    expect(at({}, "USER")).toEqual(["vault /sessions/0"]);
    expect(at({}, " tool ")).toEqual(["vault /sessions/0"]);
    // What breaks a rule of the format is named by that rule, once.
    expect(at({ tags: ["Garden"] })).toEqual(["R4 /sessions/0/tags/0"]);
    expect(at({ provider: "p".repeat(201) })).toEqual(["limit /sessions/0/provider"]);
    // An unknown provider or role in stored form is fine.
    expect(at({ provider: "ExampleBot" }, "Tool")).toEqual([]);
    // A project is checked the same way: nothing in the reader's form of a project can differ
    // from what a writer may write, so a sound project passes.
    const withProject: Vault = {
      projects: [
        { id: projectId(1), name: " Garden ", created_at: new Date(T0), updated_at: new Date(T0), extra: {} },
      ],
      sessions: [],
      blobs: new Map(),
    };
    expect(checkVault(withProject).ok).toBe(true);
  });

  it("a vault built by other means is exported repaired, and what is imported from that export satisfies the invariant", () => {
    // Stored "Claude" cannot come from a write path of the core; a vault built by hand can hold it.
    const byHand: Vault = {
      projects: [],
      sessions: [
        makeSession({
          id: sessionId(1),
          title: "t",
          provider: "Claude",
          tags: ["#garden", "garden"],
          created_at: new Date(T0),
          imported_at: new Date(T1),
          updated_at: new Date(T1),
          messages: [textMessage({ id: messageId(1, 0), position: 0, role: "USER", text: "hello" })],
        }),
      ],
      blobs: new Map(),
    };
    expect(checkVault(byHand).ok).toBe(false);
    const exported = exportDocument(byHand, { kind: "vault" }, EXPORT_CONTEXT, { includeBytes: false });
    if (!exported.ok) throw new Error("not exported");
    const fresh = importOk(emptyVault(), exported.doc);
    expect(fresh.vault.sessions[0]).toMatchObject({ provider: "claude", tags: ["garden"] });
    expect(fresh.vault.sessions[0]?.messages[0]?.role).toBe("user");
    expectStorageInvariant(fresh.vault);
  });

  it("on generated histories of dirty files: after every import the vault satisfies the invariant", () => {
    const dirtyText = fc.constantFrom(
      "plain",
      " padded ",
      "a\r\nb",
      `n${NUL}`,
      `s ${LONE_HIGH}`,
      "",
      "#x, y",
    );
    const sessionPlan = fc.record({
      id: fc.integer({ min: 1, max: 4 }),
      upper: fc.boolean(),
      title: dirtyText,
      provider: fc.constantFrom("claude", "Claude ", "CHATGPT", "", "ExampleBot", ` ${cp(0x212a)}`),
      tags: fc.array(fc.constantFrom("Garden", "#x", "a,b", "# #y", " ", "two words"), { maxLength: 3 }),
      stamp: fc.constantFrom(T0, T1, T2, "2026-05-02T10:00:00.0009Z", "2026-05-01T10:00:00Z"),
      project: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
      bytes: fc.constantFrom("none", "inline", "unpadded", "wrong", "number"),
      messages: fc.array(
        fc.record({
          shared: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined, freq: 4 }),
          index: fc.constantFrom(0, 1, 2, -1, 1.5),
          role: fc.constantFrom("user", "USER", " assistant\n", "", "Tool"),
          text: dirtyText,
          model: fc.constantFrom(undefined, "", null, "m"),
        }),
        { maxLength: 3 },
      ),
    });
    const filePlan = fc.record({
      projects: fc.uniqueArray(
        fc.record({
          id: fc.integer({ min: 1, max: 3 }),
          name: fc.constantFrom("Garden", " garden", "GARDEN", "Bikes", `Caf${cp(0xe9)}`, `CAFE${cp(0x301)}`),
          stamp: fc.constantFrom(T0, T1, T2),
          color: fc.constantFrom(undefined, "red", null),
        }),
        { maxLength: 3, selector: (p) => p.id },
      ),
      sessions: fc.uniqueArray(sessionPlan, { maxLength: 3, selector: (s) => s.id }),
    });
    type FilePlan = typeof filePlan extends fc.Arbitrary<infer T> ? T : never;
    const build = (plan: FilePlan): Loose => {
      const used = new Set<string>();
      return vaultDocument(
        plan.projects.map((p) => ({
          id: projectId(p.id),
          name: p.name,
          created_at: T0,
          updated_at: p.stamp,
          ...(p.color === undefined ? {} : { x_color: p.color }),
        })),
        plan.sessions.map((s) => {
          const base = sessionId(s.id);
          const data =
            s.bytes === "inline"
              ? Buffer.from(TXT).toString("base64")
              : s.bytes === "unpadded"
                ? Buffer.from(TXT).toString("base64").replace(/=+$/, "")
                : s.bytes === "wrong"
                  ? "QUJD"
                  : s.bytes === "number"
                    ? 7
                    : undefined;
          return {
            id: s.upper ? base.toUpperCase() : base,
            title: s.title,
            provider: s.provider,
            tags: s.tags,
            created_at: s.stamp,
            imported_at: T1,
            updated_at: s.stamp,
            project_id: s.project === undefined ? null : projectId(s.project),
            attachments: [
              {
                kind: "file",
                sha256: s.upper ? sha256(TXT).toUpperCase() : sha256(TXT),
                media_type: "text/plain",
                byte_length: TXT.length,
                ...(data === undefined ? {} : { data_base64: data }),
              },
            ],
            messages: s.messages.map((m, n) => {
              // Ids are unique in one file; shared ids make two files clash on purpose (point 10).
              let id = m.shared === undefined ? messageId(s.id, n) : messageId(99, m.shared);
              if (used.has(id)) id = messageId(s.id, 50 + n);
              used.add(id);
              return {
                id,
                index: m.index,
                role: m.role,
                segments: [{ type: "text", text: m.text }],
                ...(m.model === undefined ? {} : { model: m.model }),
              };
            }),
          };
        }),
      );
    };
    const seen = new Set<string>();
    fc.assert(
      fc.property(fc.array(filePlan, { minLength: 1, maxLength: 3 }), (plans) => {
        let vault = emptyVault();
        for (const plan of plans) {
          const file = build(plan);
          const result = importOk(vault, file);
          vault = result.vault;
          for (const entry of result.report.sessions) seen.add(entry.conflict ? "conflict" : entry.outcome);
          for (const entry of result.report.projects) seen.add(`project ${entry.outcome}`);
          for (const code of Object.keys(result.report.warnings.counts)) seen.add(code);
          expectStorageInvariant(vault);
          // The same file at once again adds, updates and replaces no session, and no project
          // either, with one exception that follows from the words of 6.7 step 2 (projects are
          // taken one by one, a later one sees what an earlier one did): when the file merged
          // one of its projects into a stored project by NAME and then renamed a stored project
          // by ID, the name is free the second time and the first project is added then. The
          // test "a file that merges by name and renames by id" below shows that case alone.
          const again = importOk(vault, file);
          expect(again.report.counts).toMatchObject({ added: 0, updated: 0, projectsUpdated: 0 });
          expect(again.vault.sessions).toEqual(vault.sessions);
          for (const entry of again.report.sessions) seen.add(entry.conflict ? "conflict" : entry.outcome);
          const first = result.report.projects.map((entry) => entry.outcome);
          if (!(first.includes("merged") && first.includes("updated"))) {
            expect(again.report.counts.projectsAdded).toBe(0);
            expect(again.vault.projects).toEqual(vault.projects);
          }
        }
      }),
      { numRuns: 150, seed: 20261120 },
    );
    // The histories really reached the branches of the merge.
    for (const outcome of [
      "added",
      "updated",
      "unchanged",
      "kept",
      "conflict",
      "project added",
      "project merged",
      "project updated",
      "project unchanged",
      "project kept",
      "id_replaced",
      "bytes_discarded",
      "project_missing",
    ]) {
      expect([...seen], outcome).toContain(outcome);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Point 9
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 9: projects in a merge (6.7 step 2), same id", () => {
  /** Project 1 "Garden" changed at T2, with two unknown properties; project 2 "Bikes". */
  const stored = (): Vault =>
    importOk(
      emptyVault(),
      vaultDocument(
        [
          project(1, { name: "Garden", created_at: T1, updated_at: T2, x_color: "green", x_old: 1 }),
          project(2, { name: "Bikes" }),
        ],
        [session(1, { project_id: projectId(1) })],
      ),
    ).vault;
  const incoming = (changes: Loose): Loose =>
    vaultDocument(
      [
        project(1, {
          name: "Garden",
          created_at: T1,
          updated_at: T2,
          x_color: "green",
          x_old: 1,
          ...changes,
        }),
      ],
      [],
    );

  it("equal content is unchanged, whatever updated_at says", () => {
    const vault = stored();
    for (const updated_at of [T2, T3, T1, "2026-05-02T10:00:00Z"]) {
      const result = importOk(vault, incoming({ updated_at }));
      expect(result.report.projects).toEqual([
        { incomingId: projectId(1), id: projectId(1), outcome: "unchanged", conflict: false },
      ]);
      expect(result.report.counts).toMatchObject({
        projectsUnchanged: 1,
        projectsUpdated: 0,
        projectsKept: 0,
      });
      // Nothing was written: the stored project is the same object, with its own updated_at.
      expect(result.vault.projects[0]).toBe(vault.projects[0]);
      expect(result.report.warnings.total).toBe(0);
    }
    // The order of properties is no content.
    const reordered = vaultDocument(
      [{ x_old: 1, updated_at: T3, x_color: "green", created_at: T1, name: "Garden", id: projectId(1) }],
      [],
    );
    expect(projectOutcomes(importOk(vault, reordered))).toEqual(["unchanged"]);
  });

  it("a later updated_at replaces the whole project: name, name key, created_at, updated_at, unknown properties", () => {
    const vault = stored();
    const result = importOk(
      vault,
      vaultDocument(
        [{ id: projectId(1), name: "Balcony", created_at: T0, updated_at: T3, x_color: "red", x_new: 2 }],
        [],
      ),
    );
    expect(result.report.projects).toEqual([
      { incomingId: projectId(1), id: projectId(1), outcome: "updated", conflict: false },
    ]);
    // The whole project: the unknown property the newer copy does not have is gone.
    expect(findProject(result.vault, 1)).toEqual({
      id: projectId(1),
      name: "Balcony",
      created_at: new Date(T0),
      updated_at: new Date(T3),
      extra: { x_color: "red", x_new: 2 },
    });
    expect(findProject(result.vault, 2)).toBe(findProject(vault, 2));
    // Its sessions stay with it.
    expect(find(result.vault, 1)?.project_id).toBe(projectId(1));
    // The name key went with the name: "garden" is free again, "balcony" is this project's.
    const free = importOk(result.vault, vaultDocument([project(3, { name: " GARDEN " })], []));
    expect(free.report.projects[0]).toMatchObject({ id: projectId(3), outcome: "added" });
    const taken = importOk(result.vault, vaultDocument([project(4, { name: "BALCONY" })], []));
    expect(taken.report.projects[0]).toMatchObject({ id: projectId(1), outcome: "merged" });
    // Later by one millisecond is later.
    const byOne = importOk(vault, incoming({ name: "Other", updated_at: "2026-05-02T10:00:00.001Z" }));
    expect(projectOutcomes(byOne)).toEqual(["updated"]);
  });

  it("an equal updated_at with different content is kept and reported, as for sessions: a conflict", () => {
    const vault = stored();
    for (const changes of [{ name: "Other" }, { created_at: T0 }, { x_color: "red" }, { x_more: true }]) {
      const result = importOk(vault, incoming(changes));
      expect(result.report.projects).toEqual([
        { incomingId: projectId(1), id: projectId(1), outcome: "kept", conflict: true },
      ]);
      expect(result.report.counts).toMatchObject({
        projectsKept: 1,
        projectsUpdated: 0,
        projectsUnchanged: 0,
      });
      expect(result.report.warnings.items).toEqual([
        expect.objectContaining({ code: "conflict", path: "/projects/0" }),
      ]);
      expect(result.vault.projects).toEqual(vault.projects);
      expect(result.vault.projects[0]).toBe(vault.projects[0]);
    }
    // An unknown property that is missing is different content too.
    const missing = vaultDocument(
      [project(1, { name: "Garden", created_at: T1, updated_at: T2, x_color: "green" })],
      [],
    );
    expect(importOk(vault, missing).report.projects[0]).toMatchObject({ outcome: "kept", conflict: true });
  });

  it("an earlier updated_at with different content is kept and reported", () => {
    const vault = stored();
    for (const updated_at of [T1, T0, "2026-05-02T09:59:59.999Z"]) {
      const result = importOk(vault, incoming({ name: "Older name", x_color: "blue", updated_at }));
      expect(result.report.projects).toEqual([
        { incomingId: projectId(1), id: projectId(1), outcome: "kept", conflict: false },
      ]);
      expect(result.report.counts).toMatchObject({ projectsKept: 1 });
      // The stored copy is simply the newer one: nothing to warn about.
      expect(result.report.warnings.total).toBe(0);
      expect(result.vault.projects[0]).toBe(vault.projects[0]);
    }
  });

  it("if the incoming name's key already belongs to another project, nothing of the project is changed and a warning is given", () => {
    const vault = stored();
    // Later, and different in every part; the name is the one of project 2 in another spelling.
    for (const name of ["Bikes", " BIKES ", "bikes\t"]) {
      const result = importOk(
        vault,
        vaultDocument(
          [{ id: projectId(1), name, created_at: T0, updated_at: T3, x_color: "red", x_new: 2 }],
          [session(5, { project_id: projectId(1) })],
        ),
      );
      expect(result.report.projects).toEqual([
        { incomingId: projectId(1), id: projectId(1), outcome: "kept", conflict: false },
      ]);
      expect(result.report.warnings.items).toEqual([
        expect.objectContaining({ code: "project_name_taken", path: "/projects/0/name" }),
      ]);
      // Nothing of the project: not the name, not created_at, not updated_at, not the unknown properties.
      expect(findProject(result.vault, 1)).toBe(findProject(vault, 1));
      expect(findProject(result.vault, 1)).toEqual({
        id: projectId(1),
        name: "Garden",
        created_at: new Date(T1),
        updated_at: new Date(T2),
        extra: { x_color: "green", x_old: 1 },
      });
      expect(result.vault.projects.length).toBe(2);
      // A session of the file that names the project still lands in it.
      expect(find(result.vault, 5)?.project_id).toBe(projectId(1));
    }
    // Composed and decomposed spellings are one key (8.4).
    const accented = importOk(
      emptyVault(),
      vaultDocument([project(1, { name: "Garden" }), project(2, { name: `Caf${cp(0xe9)}` })], []),
    ).vault;
    const decomposed = importOk(
      accented,
      vaultDocument([project(1, { name: `CAFE${cp(0x301)}`, updated_at: T3 })], []),
    );
    expect(decomposed.report.projects[0]).toMatchObject({ outcome: "kept" });
    expect(decomposed.report.warnings.counts).toEqual({ project_name_taken: 1 });
    // Its own key is not another project's: a respelling of its own name is taken over.
    const respelled = importOk(vault, incoming({ name: " GARDEN", updated_at: T3 }));
    expect(projectOutcomes(respelled)).toEqual(["updated"]);
    expect(findProject(respelled.vault, 1)?.name).toBe(" GARDEN");
  });

  it("a file that merges by name and renames by id: the second import adds the project (6.7 step 2 as worded)", () => {
    // Projects are taken one by one and a later one sees what an earlier one did. Stored: project 3
    // "Bikes". The file: project 1 "Bikes" (no such id; the name is held by 3: merged into 3), then
    // project 3 "Garden" with a later updated_at (same id: the whole project is replaced). After
    // that nobody holds "Bikes", so the same file a second time ADDS project 1. Nothing is lost,
    // but one import is not the end state; reported as a doubt about the rule, not decided here.
    const vault = importOk(
      emptyVault(),
      vaultDocument([project(3, { name: "Bikes", updated_at: T1 })], []),
    ).vault;
    const file = vaultDocument(
      [project(1, { name: "Bikes" }), project(3, { name: "Garden", updated_at: T2 })],
      [session(1, { project_id: projectId(1) })],
    );
    const first = importOk(vault, file);
    expect(projectOutcomes(first)).toEqual(["merged", "updated"]);
    expect(first.vault.projects.map((p) => [p.id, p.name])).toEqual([[projectId(3), "Garden"]]);
    // The session of the file's "Bikes" is in the project that is now called "Garden".
    expect(find(first.vault, 1)?.project_id).toBe(projectId(3));
    expectStorageInvariant(first.vault);
    const second = importOk(first.vault, file);
    expect(projectOutcomes(second)).toEqual(["added", "unchanged"]);
    // The stored session differs now (another project) at the same updated_at: kept, a conflict.
    expect(second.report.sessions[0]).toMatchObject({ outcome: "kept", conflict: true });
    expect(find(second.vault, 1)?.project_id).toBe(projectId(3));
    expectStorageInvariant(second.vault);
    // From then on the file changes nothing.
    const third = importOk(second.vault, file);
    expect(projectOutcomes(third)).toEqual(["unchanged", "unchanged"]);
    expect(third.vault.projects).toEqual(second.vault.projects);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 10
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 10: message ids", () => {
  it("an incoming message id that a message of another session of the same user holds gets a fresh id, with one warning per session", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1), session(2)]));
    const ctx = context();
    const second = importOk(
      first.vault,
      vaultDocument(
        [],
        [
          // Three of its four ids are held by sessions 1 and 2.
          session(3, {
            messages: [
              message(1, 0, "a"),
              message(1, 1, "b"),
              message(3, 2, "c"),
              message(2, 0, "d", { index: 3 }),
            ],
          }),
          // One of one.
          session(4, { messages: [message(2, 1, "e", { index: 0 })] }),
          // None.
          session(5),
        ],
      ),
      undefined,
      ctx,
    );
    expect(outcomes(second)).toEqual(["added", "added", "added"]);
    expect(find(second.vault, 3)?.messages.map((m) => m.id)).toEqual([
      freshId(1),
      freshId(2),
      messageId(3, 2),
      freshId(3),
    ]);
    expect(find(second.vault, 4)?.messages.map((m) => m.id)).toEqual([freshId(4)]);
    expect(find(second.vault, 5)?.messages.map((m) => m.id)).toEqual([messageId(5, 0), messageId(5, 1)]);
    expect(ctx.calls()).toBe(4);
    // One warning per session, not one per message.
    expect(second.report.warnings.items).toEqual([
      expect.objectContaining({ code: "id_replaced", path: "/sessions/0", count: 3 }),
      expect.objectContaining({ code: "id_replaced", path: "/sessions/1", count: 1 }),
    ]);
    expect(second.report.warnings.counts).toEqual({ id_replaced: 2 });
    // The sessions that held the ids keep them, and the text went with the new ids.
    expect(find(second.vault, 1)?.messages.map((m) => m.id)).toEqual([messageId(1, 0), messageId(1, 1)]);
    expect(find(second.vault, 3)?.messages.map((m) => m.text)).toEqual(["a", "b", "c", "d"]);
    // Message ids are unique in the vault (R2, and the key of 7.2).
    const all = second.vault.sessions.flatMap((s) => s.messages.map((m) => m.id));
    expect(new Set(all).size).toBe(all.length);
    expectStorageInvariant(second.vault);
  });

  it("the same when the session is replaced by a newer copy; ids of its own are no collision", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1), session(2)]));
    const newer = session(2, {
      updated_at: T2,
      messages: [
        // Its own two ids in the other order, one new id, and one that session 1 holds.
        message(2, 1, "now first", { index: 0 }),
        message(2, 0, "now second", { index: 1 }),
        message(2, 7, "new", { index: 2 }),
        message(1, 0, "taken", { index: 3 }),
      ],
    });
    const second = importOk(first.vault, vaultDocument([], [newer]));
    expect(outcomes(second)).toEqual(["updated"]);
    expect(find(second.vault, 2)?.messages.map((m) => m.id)).toEqual([
      messageId(2, 1),
      messageId(2, 0),
      messageId(2, 7),
      freshId(1),
    ]);
    expect(second.report.warnings.items).toEqual([
      expect.objectContaining({ code: "id_replaced", path: "/sessions/0", count: 1 }),
    ]);
  });

  it("an id held by another user never collides: two users hold the same ids, and nobody gets a fresh id because of another user", () => {
    // One vault is one user. The same file goes into the vaults of two users.
    const file = vaultDocument([project(1)], [session(1, { project_id: projectId(1) }), session(2)]);
    const ctx = context();
    const alice = importOk(emptyVault(), file, undefined, ctx);
    const bob = importOk(emptyVault(), file, undefined, ctx);
    for (const user of [alice, bob]) {
      expect(user.vault.projects.map((p) => p.id)).toEqual([projectId(1)]);
      expect(user.vault.sessions.map((s) => s.id)).toEqual([sessionId(1), sessionId(2)]);
      expect(user.vault.sessions.flatMap((s) => s.messages.map((m) => m.id))).toEqual([
        messageId(1, 0),
        messageId(1, 1),
        messageId(2, 0),
        messageId(2, 1),
      ]);
      expect(user.report.warnings.total).toBe(0);
    }
    expect(ctx.calls()).toBe(0);
    // The import has no way to be told of ids that other users hold.
    const options: DocumentImportOptions = {
      // @ts-expect-error the option for ids reserved by other owners is gone (point 10)
      reservedIds: {
        projects: new Set([projectId(1)]),
        sessions: new Set([sessionId(1)]),
        messages: new Set([messageId(1, 0)]),
      },
    };
    const carol = importOk(emptyVault(), file, options, ctx);
    expect(carol.vault).toEqual(alice.vault);
    expect(ctx.calls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 11
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 11: same content", () => {
  /** A session with every kind of part: a project, two attachments, messages with extras. */
  const rich = (changes: Loose = {}): Loose =>
    session(1, {
      title: "Tomato blight",
      model: "example-model-1",
      source_url: "https://share.example/EXAMPLE-0001",
      summary: "One line.",
      tags: ["garden", "balcony"],
      is_pinned: true,
      created_at: T0,
      imported_at: T1,
      updated_at: T2,
      project_id: projectId(1),
      attachments: [
        attachment(PDF, "original_pdf", true, { filename: "page.pdf", x_pages: 1 }),
        attachment(PNG, "image", false),
      ],
      messages: [
        message(1, 0, "How do I stop blight?", { created_at: T1, x_rating: 4 }),
        message(1, 1, "", {
          model: "claude-opus-5",
          segments: [
            { type: "text", text: "Remove the leaves." },
            { type: "attachment", sha256: sha256(PNG) },
            { type: "x_table", rows: [["a", "b"]] },
          ],
        }),
      ],
      x_capture: { method: "paste", nested: [1, { two: 2 }] },
      ...changes,
    });
  const fileOf = (changes: Loose = {}): Loose => vaultDocument([project(1)], [rich(changes)]);
  const stored = (): Vault => importOk(emptyVault(), fileOf()).vault;
  const outcomeOf = (vault: Vault, file: unknown): string => {
    const result = importOk(vault, file);
    // "unchanged" means untouched: the stored session is the very same object.
    if (result.report.sessions[0]?.outcome === "unchanged")
      expect(find(result.vault, 1)).toBe(find(vault, 1));
    return `${result.report.sessions[0]?.outcome}${result.report.sessions[0]?.conflict ? " (conflict)" : ""}`;
  };

  it("ignored: updated_at", () => {
    const vault = stored();
    for (const updated_at of [T3, T1, "2026-05-02T10:00:00.000Z"]) {
      expect(outcomeOf(vault, fileOf({ updated_at }))).toBe("unchanged");
    }
    expect(find(vault, 1)?.updated_at.toISOString()).toBe(T2);
  });

  it("ignored: the presence of data_base64", () => {
    // Stored with the bytes of the PDF; the file comes without them.
    const withBytes = stored();
    expect([...withBytes.blobs.keys()]).toEqual([sha256(PDF)]);
    const bare = fileOf({
      attachments: [
        attachment(PDF, "original_pdf", false, { filename: "page.pdf", x_pages: 1 }),
        attachment(PNG, "image", false),
      ],
    });
    expect(outcomeOf(withBytes, bare)).toBe("unchanged");
    // Stored without; the file brings the bytes of both. Still the same content (and step 4 stores them).
    const withoutBytes = importOk(emptyVault(), bare).vault;
    expect(withoutBytes.blobs.size).toBe(0);
    const full = fileOf({
      attachments: [
        attachment(PDF, "original_pdf", true, { filename: "page.pdf", x_pages: 1 }),
        attachment(PNG, "image", true),
      ],
    });
    const result = importOk(withoutBytes, full);
    expect(outcomes(result)).toEqual(["unchanged"]);
    expect(result.report.counts.blobsStored).toBe(2);
    // Padded or not, the same bytes.
    const unpadded = fileOf({
      attachments: [
        attachment(PDF, "original_pdf", true, {
          filename: "page.pdf",
          x_pages: 1,
          data_base64: Buffer.from(PDF).toString("base64").replace(/=+$/, ""),
        }),
        attachment(PNG, "image", false),
      ],
    });
    expect(outcomeOf(withBytes, unpadded)).toBe("unchanged");
  });

  it("ignored: message ids", () => {
    const vault = stored();
    const otherIds = fileOf({
      messages: [
        message(7, 5, "How do I stop blight?", { index: 0, role: "user", created_at: T1, x_rating: 4 }),
        message(7, 6, "", {
          index: 1,
          role: "assistant",
          model: "claude-opus-5",
          segments: [
            { type: "text", text: "Remove the leaves." },
            { type: "attachment", sha256: sha256(PNG) },
            { type: "x_table", rows: [["a", "b"]] },
          ],
        }),
      ],
    });
    expect(outcomeOf(vault, otherIds)).toBe("unchanged");
    // The stored ids stay.
    expect(find(vault, 1)?.messages.map((m) => m.id)).toEqual([messageId(1, 0), messageId(1, 1)]);
  });

  it("so a file whose message ids had to be replaced is unchanged when it comes again", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1)]));
    const clashing = vaultDocument(
      [],
      [session(2, { messages: [message(1, 0, "taken id"), message(2, 1, "own id")] })],
    );
    const second = importOk(first.vault, clashing);
    expect(second.report.warnings.counts).toEqual({ id_replaced: 1 });
    const third = importOk(second.vault, clashing);
    expect(outcomes(third)).toEqual(["unchanged"]);
    expect(third.report.warnings.total).toBe(0);
    expect(third.vault.sessions).toEqual(second.vault.sessions);
  });

  it("ignored: the order of properties", () => {
    const vault = stored();
    const reversed = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reversed);
      if (typeof value !== "object" || value === null) return value;
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, item]) => [key, reversed(item)]),
      );
    };
    const file = reversed(fileOf());
    expect(Object.keys(Object(Reflect.get(Object(file), "sessions"))[0])[0]).toBe("x_capture");
    expect(outcomeOf(vault, file)).toBe("unchanged");
  });

  it("both sides in reader form: the incoming session is compared after repair", () => {
    const vault = stored();
    const dirty = fileOf({
      id: sessionId(1).toUpperCase(),
      title: `Tomato${NUL} blight`,
      provider: " Claude\n",
      tags: ["Garden", "#balcony", "garden"],
      created_at: "2026-04-01T10:00:00Z",
      imported_at: "2026-05-01T10:00:00.0000001Z",
      project_id: projectId(1).toUpperCase(),
      attachments: [
        attachment(PDF, "original_pdf", true, {
          filename: "page.pdf",
          x_pages: 1,
          sha256: sha256(PDF).toUpperCase(),
        }),
        attachment(PNG, "image", false, { filename: null }),
      ],
      messages: [
        message(1, 1, "", {
          index: 9,
          role: "ASSISTANT",
          model: "claude-opus-5",
          segments: [
            { type: "text", text: "Remove the" },
            { type: "text", text: "leaves." },
            { type: "attachment", sha256: sha256(PNG).toUpperCase() },
            { type: "x_table", rows: [["a", "b"]] },
          ],
        }),
        message(1, 0, "How do I stop blight?", {
          index: 3,
          role: "User",
          model: "",
          created_at: T1,
          x_rating: 4,
        }),
      ],
    });
    // The second message was "Remove the leaves." in one segment; two segments merge with an empty
    // line. So the content differs, and at the same updated_at (T2) that is a conflict, kept (6.7).
    expect(outcomeOf(vault, dirty)).toBe("kept (conflict)");
    // With a later updated_at the same file replaces the stored session.
    const later = structuredClone(dirty);
    Object.assign(Object(Reflect.get(later, "sessions"))[0], { updated_at: T3 });
    expect(outcomeOf(vault, later)).toBe("updated");
    const merged = fileOf({
      messages: [
        message(1, 0, "How do I stop blight?", { created_at: T1, x_rating: 4 }),
        message(1, 1, "", {
          model: "claude-opus-5",
          segments: [
            { type: "text", text: "Remove the\n\nleaves." },
            { type: "attachment", sha256: sha256(PNG) },
            { type: "x_table", rows: [["a", "b"]] },
          ],
        }),
      ],
    });
    const mergedVault = importOk(emptyVault(), merged).vault;
    // Against the vault that holds what the repair gives, the dirty file is the same content.
    expect(outcomeOf(mergedVault, dirty)).toBe("unchanged");
  });

  it("both sides in reader form: the exporter's output for the stored session goes through the same repair", () => {
    // A vault built by other means, with spellings no write path of the core stores.
    const byHand: Vault = {
      projects: [],
      sessions: [
        makeSession({
          id: sessionId(1),
          title: "By hand",
          provider: "Claude",
          tags: ["#garden", "garden", "Balcony"],
          created_at: new Date(T0),
          imported_at: new Date(T1),
          updated_at: new Date(T2),
          messages: [
            textMessage({ id: messageId(1, 0), position: 0, role: "USER", text: "one\r\ntwo" }),
            segmentedMessage({
              id: messageId(1, 1),
              position: 1,
              role: " assistant ",
              segments: [
                { type: "text", text: "a" },
                { type: "text", text: "b" },
              ],
            }),
          ],
        }),
      ],
      blobs: new Map(),
    };
    const clean = vaultDocument(
      [],
      [
        session(1, {
          title: "By hand",
          provider: "claude",
          tags: ["garden", "balcony"],
          created_at: T0,
          imported_at: T1,
          updated_at: T2,
          messages: [message(1, 0, "one\ntwo"), message(1, 1, "a\n\nb")],
        }),
      ],
    );
    const result = importDocument(byHand, clean, context());
    expect(result.ok && result.report.sessions[0]?.outcome).toBe("unchanged");
    // Compared as written, "Claude" against "claude" would have been a conflict at the same updated_at.
    const differs = importDocument(
      byHand,
      vaultDocument([], [session(1, { title: "Else", updated_at: T2 })]),
      context(),
    );
    expect(differs.ok && differs.report.sessions[0]).toMatchObject({ outcome: "kept", conflict: true });
  });

  it("everything else is content: one change to anything else is not the same content", () => {
    const vault = stored();
    const changes: [string, Loose][] = [
      ["title", { title: "Tomato blight!" }],
      ["provider", { provider: "gemini" }],
      ["model", { model: "" }],
      ["source_url", { source_url: "" }],
      ["summary", { summary: "One line. " }],
      ["a tag", { tags: ["garden"] }],
      ["the order of the tags", { tags: ["balcony", "garden"] }],
      ["is_pinned", { is_pinned: false }],
      ["created_at", { created_at: T1 }],
      ["imported_at", { imported_at: T0 }],
      ["project_id", { project_id: null }],
      ["an unknown property of the session", { x_capture: { method: "paste", nested: [1, { two: 3 }] } }],
      ["a new unknown property", { x_more: null }],
      [
        "the order of the attachments",
        {
          attachments: [
            attachment(PNG, "image", false),
            attachment(PDF, "original_pdf", true, { filename: "page.pdf", x_pages: 1 }),
          ],
        },
      ],
      [
        "a property of a descriptor",
        {
          attachments: [
            attachment(PDF, "original_pdf", true, { filename: "other.pdf", x_pages: 1 }),
            attachment(PNG, "image", false),
          ],
        },
      ],
      [
        "a message less",
        {
          attachments: [attachment(PDF, "original_pdf", true, { filename: "page.pdf", x_pages: 1 })],
          messages: [message(1, 0, "How do I stop blight?", { created_at: T1, x_rating: 4 })],
        },
      ],
    ];
    const messageChanges: [string, Loose, Loose][] = [
      ["the text of a message", { segments: [{ type: "text", text: "How do I stop blight" }] }, {}],
      ["the role of a message", { role: "system" }, {}],
      ["the created_at of a message", { created_at: T2 }, {}],
      ["an unknown property of a message", { x_rating: 5 }, {}],
      ["the model of a message", {}, { model: "other-model" }],
      [
        "an unknown segment",
        {},
        {
          segments: [
            { type: "text", text: "Remove the leaves." },
            { type: "attachment", sha256: sha256(PNG) },
            { type: "x_table", rows: [["a", "c"]] },
          ],
        },
      ],
    ];
    for (const [name, first, second] of messageChanges) {
      changes.push([
        name,
        {
          messages: [
            message(1, 0, "How do I stop blight?", { created_at: T1, x_rating: 4, ...first }),
            message(1, 1, "", {
              model: "claude-opus-5",
              segments: [
                { type: "text", text: "Remove the leaves." },
                { type: "attachment", sha256: sha256(PNG) },
                { type: "x_table", rows: [["a", "b"]] },
              ],
              ...second,
            }),
          ],
        },
      ]);
    }
    expect(changes.length).toBe(22);
    for (const [name, change] of changes) {
      // Later: the newer copy replaces. Equal: a conflict, kept. Earlier: kept.
      expect(outcomeOf(vault, fileOf({ ...change, updated_at: T3 })), name).toBe("updated");
      expect(outcomeOf(vault, fileOf({ ...change, updated_at: T2 })), name).toBe("kept (conflict)");
      expect(outcomeOf(vault, fileOf({ ...change, updated_at: T1 })), name).toBe("kept");
    }
    // The order of the messages is content as well: the same two messages the other way round.
    const swapped = fileOf({
      updated_at: T3,
      messages: [
        message(1, 1, "", {
          index: 0,
          model: "claude-opus-5",
          segments: [
            { type: "text", text: "Remove the leaves." },
            { type: "attachment", sha256: sha256(PNG) },
            { type: "x_table", rows: [["a", "b"]] },
          ],
        }),
        message(1, 0, "How do I stop blight?", { index: 1, created_at: T1, x_rating: 4 }),
      ],
    });
    expect(outcomeOf(vault, swapped)).toBe("updated");
  });
});

// ---------------------------------------------------------------------------------------------
// Point 12
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 12: order in a file", () => {
  const ids = {
    low: "00000000-0000-4000-8000-000000000001",
    nine: "99999999-0000-4000-8000-000000000001",
    a: "a0000000-0000-4000-8000-000000000001",
    a2: "a0000000-0000-4000-8000-000000000002",
    f: "ffffffff-0000-4000-8000-000000000001",
  };
  const inFileOrder = [ids.f, ids.a2, ids.low, ids.nine, ids.a];
  const inIdOrder = [ids.low, ids.nine, ids.a, ids.a2, ids.f];

  it("writers emit projects and sessions in id order, whatever order the vault holds them in", () => {
    const file = vaultDocument(
      inFileOrder.map((id, n) => ({ id, name: `Project ${n}`, created_at: T1 })),
      inFileOrder.map((id, n) => ({
        id,
        title: `Session ${n}`,
        provider: "claude",
        created_at: T1,
        imported_at: T1,
        messages: [],
      })),
    );
    const imported = importOk(emptyVault(), file);
    // The vault keeps the order of arrival; the writer does not.
    expect(imported.vault.sessions.map((s) => s.id)).toEqual(inFileOrder);
    const doc = exportOk(imported.vault);
    expect(doc.projects.map((p) => p.id)).toEqual(inIdOrder);
    expect(doc.sessions.map((s) => s.id)).toEqual(inIdOrder);
    // The same from a vault that holds them the other way round.
    const turned: Vault = {
      projects: [...imported.vault.projects].reverse(),
      sessions: [...imported.vault.sessions].reverse(),
      blobs: imported.vault.blobs,
    };
    expect(exportOk(turned)).toEqual(doc);
    // And the text of the file lists them so.
    const text = documentText(doc) ?? "";
    const at = inIdOrder.map((id) => text.lastIndexOf(`"id":"${id}"`));
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });

  it("the order of properties inside an object carries no meaning: two spellings of one file are one document", () => {
    const forwards = JSON.parse(EXAMPLE_TEXT);
    const reversed = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reversed);
      if (typeof value !== "object" || value === null) return value;
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, item]) => [key, reversed(item)]),
      );
    };
    const backwards = reversed(forwards);
    expect(JSON.stringify(backwards)).not.toBe(JSON.stringify(forwards));
    const one = readDocument(forwards);
    const other = readDocument(backwards);
    if (!one.ok || !other.ok) throw new Error("the example was refused");
    // Compared as parsed values, never as bytes.
    expect(other.doc).toEqual(one.doc);
    const vault = importOk(emptyVault(), forwards).vault;
    const again = importOk(vault, backwards);
    expect(outcomes(again)).toEqual(Array.from({ length: 6 }, () => "unchanged"));
    expect(projectOutcomes(again)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(exportOk(importOk(emptyVault(), backwards).vault)).toEqual(exportOk(vault));
  });

  it("attachments keep the order of the imported array", () => {
    // Sorted by nothing: not by kind, not by hash, not by file name.
    const listed = [
      attachment(TXT, "other", false, { filename: "c.txt" }),
      attachment(PDF, "original_pdf", false, { filename: "a.pdf" }),
      attachment(PNG, "image", false, { filename: "b.png" }),
      attachment(PNG, "file", false, { filename: "0.bin" }),
    ];
    const names = (document: InterchangeDocument): string[] =>
      document.sessions[0]?.attachments.map((entry) => entry.filename) ?? [];
    const first = importOk(emptyVault(), vaultDocument([], [session(1, { attachments: listed })]));
    expect(find(first.vault, 1)?.attachments.map((entry) => entry.filename)).toEqual([
      "c.txt",
      "a.pdf",
      "b.png",
      "0.bin",
    ]);
    expect(names(exportOk(first.vault))).toEqual(["c.txt", "a.pdf", "b.png", "0.bin"]);
    // A newer copy with another order: that order is kept from then on.
    const turned = importOk(
      first.vault,
      vaultDocument([], [session(1, { updated_at: T2, attachments: [...listed].reverse() })]),
    );
    expect(outcomes(turned)).toEqual(["updated"]);
    expect(names(exportOk(turned.vault))).toEqual(["0.bin", "b.png", "a.pdf", "c.txt"]);
    // Through an export and an import into another vault as well.
    const moved = importOk(emptyVault(), exportOk(turned.vault));
    expect(names(exportOk(moved.vault))).toEqual(["0.bin", "b.png", "a.pdf", "c.txt"]);
  });
});
