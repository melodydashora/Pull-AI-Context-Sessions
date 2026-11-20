/// <reference types="node" />
// The import algorithm of data-model.md 6.7, case by case.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  checkVault,
  type DocumentImportContext,
  type DocumentImportOptions,
  emptyVault,
  exportDocument,
  importDocument,
  type Vault,
  webGenerator,
} from "./index.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const NOW = new Date("2026-11-20T08:00:00.000Z");
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

const PDF = new TextEncoder().encode("%PDF-1.4 synthetic page");
const PDF_SHA = createHash("sha256").update(PDF).digest("hex");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");

function attachment(bytes: Uint8Array, kind: string, inline: boolean, changes: Loose = {}): Loose {
  return {
    kind,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    media_type: kind === "original_pdf" ? "application/pdf" : "image/png",
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
  expect(checkVault(result.vault).problems.items).toEqual([]);
  return result;
}

function importRefused(vault: Vault, input: unknown, options?: DocumentImportOptions) {
  const before = structuredClone(vault);
  const result = importDocument(vault, input, context(), options);
  expect(vault).toEqual(before);
  if (result.ok) throw new Error("the import should have been refused");
  return result.problems;
}

const find = (vault: Vault, n: number) => vault.sessions.find((candidate) => candidate.id === sessionId(n));
const outcomes = (result: { report: { sessions: readonly { outcome: string }[] } }): string[] =>
  result.report.sessions.map((entry) => entry.outcome);

describe("6.7 step 3: sessions", () => {
  it("new: a session whose id the vault does not have is added with its messages and attachments", () => {
    const result = importOk(
      emptyVault(),
      vaultDocument(
        [project(1)],
        [session(1, { project_id: projectId(1), attachments: [attachment(PDF, "original_pdf", true)] })],
      ),
    );
    expect(result.report.sessions).toEqual([
      { incomingId: sessionId(1), id: sessionId(1), outcome: "added", conflict: false, copyId: null },
    ]);
    expect(result.report.counts).toMatchObject({ added: 1, projectsAdded: 1, blobsStored: 1 });
    const stored = find(result.vault, 1);
    expect(stored).toMatchObject({
      id: sessionId(1),
      project_id: projectId(1),
      message_count: 2,
      title: "Session 1",
    });
    expect(stored?.messages.map((m) => [m.id, m.position, m.role, m.text])).toEqual([
      [messageId(1, 0), 0, "user", "question 1"],
      [messageId(1, 1), 1, "assistant", "answer 1"],
    ]);
    expect(stored?.attachments.map((a) => a.sha256)).toEqual([PDF_SHA]);
    expect(result.vault.blobs.get(PDF_SHA)).toEqual(PDF);
  });

  it("new: keeps the timestamps of the file and never the current time", () => {
    const result = importOk(
      emptyVault(),
      vaultDocument([], [session(1, { created_at: T1, imported_at: T2, updated_at: T3 })]),
    );
    const stored = find(result.vault, 1);
    expect(
      [stored?.created_at, stored?.imported_at, stored?.updated_at].map((d) => d?.toISOString()),
    ).toEqual([T1, T2, T3]);
    expect(JSON.stringify(result.vault.sessions)).not.toContain("2026-11-20");
    // The current time only dates the report.
    expect(result.report.at).toEqual(NOW);
  });

  it("identical: the same content is unchanged, whatever its updated_at says", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1)]));
    for (const updated_at of [T1, T3, "2026-04-01T00:00:00.000Z"]) {
      const second = importOk(first.vault, vaultDocument([], [session(1, { updated_at })]));
      expect(outcomes(second)).toEqual(["unchanged"]);
      expect(second.report.counts).toMatchObject({
        unchanged: 1,
        added: 0,
        updated: 0,
        kept: 0,
        conflicts: 0,
      });
      // Nothing was touched, not even updated_at.
      expect(second.vault.sessions[0]).toBe(first.vault.sessions[0]);
    }
  });

  it("identical: property order, timestamp spelling, letter case of ids and inline bytes do not make a difference", () => {
    const base = session(1, {
      attachments: [attachment(PDF, "original_pdf", false)],
      x_extra: { a: 1, b: [2] },
    });
    const first = importOk(emptyVault(), vaultDocument([], [base]));
    const reordered = Object.fromEntries(Object.entries(base).reverse());
    const variant = {
      ...reordered,
      id: sessionId(1).toUpperCase(),
      created_at: "2026-05-01T10:00:00Z",
      imported_at: "2026-05-01T10:00:00.0Z",
      x_extra: { b: [2], a: 1 },
      attachments: [attachment(PDF, "original_pdf", true)],
    };
    const second = importOk(first.vault, vaultDocument([], [variant]));
    expect(outcomes(second)).toEqual(["unchanged"]);
    // 6.7 step 4: the bytes arrive although the session is unchanged.
    expect(second.report.counts.blobsStored).toBe(1);
    expect(second.vault.sessions[0]).toBe(first.vault.sessions[0]);
  });

  it("identical: an array in another order is other content", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1, { tags: ["a", "b"] })]));
    const second = importOk(first.vault, vaultDocument([], [session(1, { tags: ["b", "a"] })]));
    expect(second.report.sessions[0]).toMatchObject({ outcome: "kept", conflict: true });
  });

  it("newer: a later updated_at replaces all fields, the messages and the attachments", () => {
    const first = importOk(
      emptyVault(),
      vaultDocument(
        [project(1), project(2)],
        [
          session(1, {
            project_id: projectId(1),
            tags: ["old"],
            is_pinned: true,
            summary: "old summary",
            attachments: [attachment(PDF, "original_pdf", true)],
            x_old: "gone after the update",
          }),
        ],
      ),
    );
    const newer = session(1, {
      title: "Renamed",
      provider: "gemini",
      model: "m-2",
      source_url: "https://share.example/EXAMPLE-0002",
      summary: "",
      tags: ["new"],
      is_pinned: false,
      created_at: T2,
      imported_at: T2,
      updated_at: T3,
      project_id: projectId(2),
      attachments: [attachment(PNG, "image", true)],
      messages: [message(1, 7, "only message", { index: 0 })],
      x_new: 1,
    });
    const second = importOk(first.vault, vaultDocument([project(1), project(2)], [newer]));
    expect(second.report.sessions).toEqual([
      { incomingId: sessionId(1), id: sessionId(1), outcome: "updated", conflict: false, copyId: null },
    ]);
    const stored = find(second.vault, 1);
    expect(stored).toMatchObject({
      title: "Renamed",
      provider: "gemini",
      model: "m-2",
      source_url: "https://share.example/EXAMPLE-0002",
      summary: "",
      tags: ["new"],
      is_pinned: false,
      project_id: projectId(2),
      message_count: 1,
      text_bytes: 12,
      extra: { x_new: 1 },
    });
    expect(
      [stored?.created_at, stored?.imported_at, stored?.updated_at].map((d) => d?.toISOString()),
    ).toEqual([T2, T2, T3]);
    expect(stored?.messages.map((m) => m.id)).toEqual([messageId(1, 7)]);
    expect(stored?.attachments.map((a) => a.sha256)).toEqual([PNG_SHA]);
    // Import never deletes bytes: the old blob stays, the new one is stored.
    expect([...second.vault.blobs.keys()].sort()).toEqual([PDF_SHA, PNG_SHA].sort());
    expect(second.vault.sessions.length).toBe(1);
  });

  it("newer by one millisecond is newer", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1)]));
    const second = importOk(
      first.vault,
      vaultDocument([], [session(1, { title: "Later", updated_at: "2026-05-01T10:00:00.001Z" })]),
    );
    expect(outcomes(second)).toEqual(["updated"]);
  });

  it("older: an earlier updated_at keeps the stored session and is no conflict", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1, { updated_at: T2 })]));
    const second = importOk(
      first.vault,
      vaultDocument([], [session(1, { title: "Older text", updated_at: T1 })]),
    );
    expect(second.report.sessions).toEqual([
      { incomingId: sessionId(1), id: sessionId(1), outcome: "kept", conflict: false, copyId: null },
    ]);
    expect(second.report.warnings.total).toBe(0);
    expect(second.vault.sessions[0]).toBe(first.vault.sessions[0]);
  });

  it("compares updated_at at millisecond precision, not as text", () => {
    const first = importOk(
      emptyVault(),
      vaultDocument([], [session(1, { updated_at: "2026-05-01T10:00:00.123Z" })]),
    );
    // Digits beyond the millisecond do not make the incoming copy newer.
    const second = importOk(
      first.vault,
      vaultDocument([], [session(1, { title: "Other", updated_at: "2026-05-01T10:00:00.123999Z" })]),
    );
    expect(second.report.sessions[0]).toMatchObject({ outcome: "kept", conflict: true });
    expect(second.report.repairs.counts).toEqual({ timestamp_precision: 1 });
  });

  it("import never deletes: sessions and projects the file does not mention stay, also for kind vault", () => {
    const first = importOk(
      emptyVault(),
      vaultDocument([project(1), project(2)], [session(1), session(2), session(3)]),
    );
    const second = importOk(
      first.vault,
      vaultDocument([], [session(2, { title: "Two again", updated_at: T2 })]),
    );
    expect(second.vault.sessions.map((s) => s.id).sort()).toEqual([sessionId(1), sessionId(2), sessionId(3)]);
    expect(second.vault.projects.length).toBe(2);
    expect(find(second.vault, 1)).toBe(find(first.vault, 1));
    expect(find(second.vault, 3)).toBe(find(first.vault, 3));
    expect(find(second.vault, 2)?.title).toBe("Two again");
  });

  it("a session document merges like a vault document", () => {
    const first = importOk(emptyVault(), vaultDocument([project(1)], [session(1), session(2)]));
    const single = vaultDocument([project(1)], [session(3, { project_id: projectId(1) })], {
      kind: "session",
    });
    const second = importOk(first.vault, single);
    expect(second.report.kind).toBe("session");
    expect(second.report.counts).toMatchObject({ added: 1, projectsUnchanged: 1 });
    expect(second.vault.sessions.length).toBe(3);
  });
});

describe("6.7: conflicts (same id, different content, equal updated_at)", () => {
  const stored = () => importOk(emptyVault(), vaultDocument([], [session(1), session(2)])).vault;
  const conflicting = vaultDocument([], [session(1, { title: "Edited elsewhere" }), session(2)]);

  it("by default keeps the stored session and shows the conflict in the report", () => {
    const vault = stored();
    const result = importOk(vault, conflicting);
    expect(result.report.sessions).toEqual([
      { incomingId: sessionId(1), id: sessionId(1), outcome: "kept", conflict: true, copyId: null },
      { incomingId: sessionId(2), id: sessionId(2), outcome: "unchanged", conflict: false, copyId: null },
    ]);
    expect(result.report.counts).toMatchObject({ kept: 1, unchanged: 1, conflicts: 1, copies: 0 });
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "conflict", path: "/sessions/0" }),
    ]);
    expect(find(result.vault, 1)).toBe(find(vault, 1));
    // The same file again: the same conflict, nothing else.
    expect(importOk(result.vault, conflicting).report.counts).toMatchObject({ kept: 1, conflicts: 1 });
  });

  it('"replace": the incoming session replaces the stored one', () => {
    const result = importOk(stored(), conflicting, { onConflict: "replace" });
    expect(result.report.sessions[0]).toEqual({
      incomingId: sessionId(1),
      id: sessionId(1),
      outcome: "updated",
      conflict: true,
      copyId: null,
    });
    expect(result.report.counts).toMatchObject({ updated: 1, unchanged: 1, conflicts: 1 });
    expect(find(result.vault, 1)?.title).toBe("Edited elsewhere");
    expect(result.vault.sessions.length).toBe(2);
    // Now both copies agree.
    expect(importOk(result.vault, conflicting).report.counts).toMatchObject({ unchanged: 2, conflicts: 0 });
  });

  it("copy: the stored session stays and the incoming one is added under new ids with the title suffix", () => {
    const vault = stored();
    const ctx = context();
    const result = importOk(
      vault,
      conflicting,
      { onConflict: { copyWithTitleSuffix: " (imported copy)" } },
      ctx,
    );
    expect(result.report.sessions[0]).toEqual({
      incomingId: sessionId(1),
      id: sessionId(1),
      outcome: "kept",
      conflict: true,
      copyId: freshId(1),
    });
    expect(result.report.counts).toMatchObject({ kept: 1, unchanged: 1, conflicts: 1, copies: 1, added: 0 });
    expect(find(result.vault, 1)).toBe(find(vault, 1));
    const copy = result.vault.sessions.find((s) => s.id === freshId(1));
    expect(copy).toMatchObject({ title: "Edited elsewhere (imported copy)", message_count: 2 });
    expect(copy?.messages.map((m) => m.id)).toEqual([freshId(2), freshId(3)]);
    expect(copy?.messages.map((m) => m.text)).toEqual(["question 1", "answer 1"]);
    // The copy carries the timestamps of the file too.
    expect(copy?.imported_at.toISOString()).toBe(T1);
    expect(ctx.calls()).toBe(3);
    expect(result.vault.sessions.length).toBe(3);
  });

  it("the policy does not apply when the incoming copy is simply older", () => {
    const vault = importOk(emptyVault(), vaultDocument([], [session(1, { updated_at: T2 })])).vault;
    const older = vaultDocument([], [session(1, { title: "Older", updated_at: T1 })]);
    for (const onConflict of ["replace", { copyWithTitleSuffix: " (copy)" }] as const) {
      const result = importOk(vault, older, { onConflict });
      expect(result.report.sessions[0]).toMatchObject({ outcome: "kept", conflict: false, copyId: null });
      expect(result.vault.sessions).toEqual(vault.sessions);
    }
  });
});

describe("6.7: ids that are already in use (owner scoping)", () => {
  it("a session id of another owner: the session gets a new id and is added", () => {
    const ctx = context();
    const result = importOk(
      emptyVault(),
      vaultDocument([], [session(1), session(2)]),
      {
        reservedIds: { sessions: new Set([sessionId(1)]) },
      },
      ctx,
    );
    expect(result.report.sessions).toEqual([
      { incomingId: sessionId(1), id: freshId(1), outcome: "added", conflict: false, copyId: null },
      { incomingId: sessionId(2), id: sessionId(2), outcome: "added", conflict: false, copyId: null },
    ]);
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "id_replaced", path: "/sessions/0/id" }),
    ]);
    expect(result.vault.sessions.map((s) => s.id)).toEqual([freshId(1), sessionId(2)]);
    expect(result.vault.sessions[0]?.title).toBe("Session 1");
    expect(ctx.calls()).toBe(1);
  });

  it("a project id of another owner: the project gets a new id and the sessions of the file follow it", () => {
    const result = importOk(
      emptyVault(),
      vaultDocument(
        [project(1), project(2)],
        [session(1, { project_id: projectId(1) }), session(2, { project_id: projectId(2) })],
      ),
      { reservedIds: { projects: new Set([projectId(1)]) } },
    );
    expect(result.report.projects).toEqual([
      { incomingId: projectId(1), id: freshId(1), outcome: "added" },
      { incomingId: projectId(2), id: projectId(2), outcome: "added" },
    ]);
    expect(find(result.vault, 1)?.project_id).toBe(freshId(1));
    expect(find(result.vault, 2)?.project_id).toBe(projectId(2));
    expect(result.vault.projects.map((p) => [p.id, p.name])).toEqual([
      [freshId(1), "Project 1"],
      [projectId(2), "Project 2"],
    ]);
  });

  it("a message id of another owner: the message gets a new id", () => {
    const result = importOk(emptyVault(), vaultDocument([], [session(1)]), {
      reservedIds: { messages: new Set([messageId(1, 1)]) },
    });
    expect(find(result.vault, 1)?.messages.map((m) => m.id)).toEqual([messageId(1, 0), freshId(1)]);
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "id_replaced", path: "/sessions/0/messages/1/id" }),
    ]);
  });

  it("a message id that a message of another session in the vault has: the incoming message gets a new id", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1)]));
    // Session 2 arrives in another file and reuses a message id of session 1.
    const clashing = session(2, {
      messages: [message(1, 0, "same id, other session"), message(2, 1, "own id")],
    });
    const second = importOk(first.vault, vaultDocument([], [clashing]));
    expect(outcomes(second)).toEqual(["added"]);
    expect(find(second.vault, 2)?.messages.map((m) => m.id)).toEqual([freshId(1), messageId(2, 1)]);
    expect(find(second.vault, 1)?.messages.map((m) => m.id)).toEqual([messageId(1, 0), messageId(1, 1)]);
    expect(second.report.warnings.counts).toEqual({ id_replaced: 1 });
    // The export of such a vault is valid: message ids are unique in it (R2).
    const exported = exportDocument(
      second.vault,
      { kind: "vault" },
      { now: NOW, generator: webGenerator("0") },
      { includeBytes: false },
    );
    expect(exported.ok).toBe(true);
  });

  it("an update may keep the message ids the session already has", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1)]));
    const newer = session(1, {
      updated_at: T2,
      messages: [message(1, 1, "now first", { index: 0 }), message(1, 5, "new", { index: 1 })],
    });
    const second = importOk(first.vault, vaultDocument([], [newer]));
    expect(outcomes(second)).toEqual(["updated"]);
    expect(find(second.vault, 1)?.messages.map((m) => m.id)).toEqual([messageId(1, 1), messageId(1, 5)]);
    expect(second.report.warnings.total).toBe(0);
  });

  it("an id freed by an update can be taken by another session later", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1)]));
    const second = importOk(first.vault, vaultDocument([], [session(1, { updated_at: T2, messages: [] })]));
    const third = importOk(
      second.vault,
      vaultDocument([], [session(2, { messages: [message(1, 0, "reused id")] })]),
    );
    expect(find(third.vault, 2)?.messages.map((m) => m.id)).toEqual([messageId(1, 0)]);
    expect(third.report.warnings.total).toBe(0);
  });

  it("refuses the whole import when the id generator gives nothing usable, without throwing", () => {
    const options: DocumentImportOptions = { reservedIds: { sessions: new Set([sessionId(1)]) } };
    for (const newId of [() => "not a uuid", () => sessionId(2), () => sessionId(1)]) {
      let calls = 0;
      const start = emptyVault();
      const result = importDocument(
        start,
        vaultDocument([], [session(1), session(2)]),
        {
          now: NOW,
          newId: () => {
            calls += 1;
            return newId();
          },
        },
        options,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.problems.items).toEqual([expect.objectContaining({ rule: "internal", path: "" })]);
      expect(start).toEqual(emptyVault());
      // Bounded: the generator is not asked forever.
      expect(calls).toBe(16);
    }
    const throwing = importDocument(
      emptyVault(),
      vaultDocument([], [session(1)]),
      {
        now: NOW,
        newId: () => {
          throw new Error("no entropy");
        },
      },
      options,
    );
    expect(throwing.ok).toBe(false);
  });

  it("accepts an upper-case id from the generator and uses it in lower case", () => {
    const result = importDocument(
      emptyVault(),
      vaultDocument([], [session(1)]),
      { now: NOW, newId: () => freshId(9).toUpperCase() },
      {
        reservedIds: { sessions: new Set([sessionId(1)]) },
      },
    );
    expect(result.ok && result.vault.sessions[0]?.id).toBe(freshId(9));
  });
});

describe("6.7 and 6.6 repair 8: references to projects that are missing", () => {
  it("a project_id that is neither in the file nor in the vault becomes null, with a warning", () => {
    const result = importOk(
      emptyVault(),
      vaultDocument(
        [project(1)],
        [session(1, { project_id: projectId(7) }), session(2, { project_id: projectId(1) })],
      ),
    );
    expect(find(result.vault, 1)?.project_id).toBeNull();
    expect(find(result.vault, 2)?.project_id).toBe(projectId(1));
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "project_missing", path: "/sessions/0/project_id" }),
    ]);
    expect(result.report.counts.added).toBe(2);
  });

  it("a project_id that only the vault knows is kept", () => {
    const first = importOk(emptyVault(), vaultDocument([project(7)], []));
    const second = importOk(
      first.vault,
      vaultDocument([], [session(1, { project_id: projectId(7).toUpperCase() })]),
    );
    expect(find(second.vault, 1)?.project_id).toBe(projectId(7));
    expect(second.report.warnings.total).toBe(0);
    // Importing the same file again finds the same content.
    expect(
      outcomes(importOk(second.vault, vaultDocument([], [session(1, { project_id: projectId(7) })]))),
    ).toEqual(["unchanged"]);
  });

  it("a session document whose project is missing from the file still imports", () => {
    const single = vaultDocument([], [session(1, { project_id: projectId(7) })], { kind: "session" });
    const result = importOk(emptyVault(), single);
    expect(find(result.vault, 1)?.project_id).toBeNull();
    expect(result.report.warnings.counts).toEqual({ project_missing: 1 });
  });

  it("a stored session keeps its project when a later file no longer carries the project", () => {
    const first = importOk(
      emptyVault(),
      vaultDocument([project(1)], [session(1, { project_id: projectId(1) })]),
    );
    const second = importOk(first.vault, vaultDocument([], [session(1, { project_id: projectId(1) })]));
    expect(outcomes(second)).toEqual(["unchanged"]);
    expect(find(second.vault, 1)?.project_id).toBe(projectId(1));
  });
});

describe("6.7 step 2: projects", () => {
  const base = () =>
    importOk(
      emptyVault(),
      vaultDocument([project(1, { name: "Garden", x_color: "green" }), project(2, { name: "Bikes" })], []),
    ).vault;
  const named = (vault: Vault): [string, string][] => vault.projects.map((p) => [p.id, p.name]);

  it("2a: the same id with a later updated_at takes the new name and properties", () => {
    const result = importOk(
      base(),
      vaultDocument([project(1, { name: "Balcony garden", updated_at: T2, x_color: "red" })], []),
    );
    expect(result.report.projects).toEqual([
      { incomingId: projectId(1), id: projectId(1), outcome: "updated" },
    ]);
    expect(named(result.vault)).toEqual([
      [projectId(1), "Balcony garden"],
      [projectId(2), "Bikes"],
    ]);
    expect(result.vault.projects[0]).toMatchObject({ extra: { x_color: "red" } });
    expect(result.vault.projects[0]?.updated_at.toISOString()).toBe(T2);
    // The old name is free again.
    const reuse = importOk(result.vault, vaultDocument([project(3, { name: "garden" })], []));
    expect(reuse.report.projects).toEqual([{ incomingId: projectId(3), id: projectId(3), outcome: "added" }]);
  });

  it("2a: the same id with the same or an earlier updated_at keeps the stored project", () => {
    const vault = base();
    for (const updated_at of [T1, "2026-04-01T00:00:00.000Z"]) {
      const result = importOk(vault, vaultDocument([project(1, { name: "Other name", updated_at })], []));
      expect(result.report.projects).toEqual([
        { incomingId: projectId(1), id: projectId(1), outcome: "kept" },
      ]);
      expect(result.vault.projects).toEqual(vault.projects);
    }
  });

  it("2a: the same id and content is unchanged", () => {
    const vault = base();
    const result = importOk(
      vault,
      vaultDocument([project(1, { name: "Garden", x_color: "green", updated_at: T3 })], []),
    );
    expect(result.report.projects).toEqual([
      { incomingId: projectId(1), id: projectId(1), outcome: "unchanged" },
    ]);
    expect(result.vault.projects[0]).toBe(vault.projects[0]);
  });

  it("2a: a new name that belongs to another project is refused: the old name stays, with a warning", () => {
    const vault = base();
    const result = importOk(vault, vaultDocument([project(1, { name: " BIKES ", updated_at: T2 })], []));
    expect(result.report.projects).toEqual([{ incomingId: projectId(1), id: projectId(1), outcome: "kept" }]);
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "project_name_taken", path: "/projects/0/name" }),
    ]);
    expect(result.vault.projects).toEqual(vault.projects);
  });

  it("2b: another id with the same name (trimmed, without case, NFC) uses the stored project", () => {
    const vault = base();
    const incoming = vaultDocument(
      [project(8, { name: "  GARDEN " }), project(9, { name: "Bikes", x_other: true })],
      [session(1, { project_id: projectId(8) }), session(2, { project_id: projectId(9) })],
    );
    const result = importOk(vault, incoming);
    expect(result.report.projects).toEqual([
      { incomingId: projectId(8), id: projectId(1), outcome: "merged" },
      { incomingId: projectId(9), id: projectId(2), outcome: "merged" },
    ]);
    expect(result.vault.projects).toEqual(vault.projects);
    expect(find(result.vault, 1)?.project_id).toBe(projectId(1));
    expect(find(result.vault, 2)?.project_id).toBe(projectId(2));
    // The same file again: the remembered mapping makes the sessions unchanged.
    expect(outcomes(importOk(result.vault, incoming))).toEqual(["unchanged", "unchanged"]);
  });

  it("2b: composed and decomposed forms of a name are the same name", () => {
    const first = importOk(emptyVault(), vaultDocument([project(1, { name: "Caf\u00E9" })], []));
    const second = importOk(first.vault, vaultDocument([project(2, { name: "CAFE\u0301" })], []));
    expect(second.report.projects).toEqual([
      { incomingId: projectId(2), id: projectId(1), outcome: "merged" },
    ]);
  });

  it("2c: a project with a new id and a new name is inserted with its id, also without sessions", () => {
    const result = importOk(
      base(),
      vaultDocument([project(5, { name: "apple pie ideas", updated_at: T2 })], []),
    );
    expect(result.report.projects).toEqual([
      { incomingId: projectId(5), id: projectId(5), outcome: "added" },
    ]);
    expect(result.vault.projects[2]).toMatchObject({ id: projectId(5), name: "apple pie ideas" });
    expect(result.vault.projects[2]?.created_at.toISOString()).toBe(T1);
    expect(result.vault.projects[2]?.updated_at.toISOString()).toBe(T2);
  });

  it("a project without updated_at counts as changed when it was made", () => {
    const withoutUpdated = project(1, { name: "Garden", created_at: T2 });
    delete withoutUpdated.updated_at;
    const result = importOk(emptyVault(), vaultDocument([withoutUpdated], []));
    expect(result.vault.projects[0]?.updated_at.toISOString()).toBe(T2);
  });
});

describe("6.7: duplicates inside one document", () => {
  it("two sessions with one id: the document is refused whole (R2)", () => {
    const problems = importRefused(
      emptyVault(),
      vaultDocument([], [session(1), session(2), session(1, { title: "again", messages: [] })]),
    );
    expect(problems.items).toEqual([expect.objectContaining({ rule: "R2", path: "/sessions/2/id" })]);
  });

  it("two sessions whose ids differ only in letter case: refused too, ids are compared in lower case", () => {
    const upper = session(1, { id: sessionId(1).replace("5e55", "5E55"), messages: [] });
    const problems = importRefused(emptyVault(), vaultDocument([], [session(1), upper]));
    expect(problems.items.map((p) => p.rule)).toEqual(["R2"]);
  });

  it("two projects with one id: refused (R2)", () => {
    const problems = importRefused(
      emptyVault(),
      vaultDocument([project(1), project(1, { name: "Other" })], []),
    );
    expect(problems.items).toEqual([expect.objectContaining({ rule: "R2", path: "/projects/1/id" })]);
  });

  it("two messages with one id, in one session or in two: refused (R2)", () => {
    const inOne = session(1, { messages: [message(1, 0, "a"), message(1, 0, "b", { index: 1 })] });
    expect(
      importRefused(emptyVault(), vaultDocument([], [inOne])).items.map((p) => [p.rule, p.path]),
    ).toEqual([["R2", "/sessions/0/messages/1/id"]]);
    const inTwo = [session(1), session(2, { messages: [message(1, 1, "borrowed id", { index: 0 })] })];
    expect(importRefused(emptyVault(), vaultDocument([], inTwo)).items.map((p) => [p.rule, p.path])).toEqual([
      ["R2", "/sessions/1/messages/0/id"],
    ]);
  });

  it("the same attachment twice in one session: refused (R5)", () => {
    const twice = session(1, {
      attachments: [attachment(PNG, "image", true), attachment(PNG, "image", false)],
    });
    expect(
      importRefused(emptyVault(), vaultDocument([], [twice])).items.map((p) => [p.rule, p.path]),
    ).toEqual([["R5", "/sessions/0/attachments/1"]]);
  });

  it("two projects with the same name: a warning (R11), and they become one project", () => {
    const incoming = vaultDocument(
      [project(1, { name: "Garden" }), project(2, { name: "garden " })],
      [session(1, { project_id: projectId(1) }), session(2, { project_id: projectId(2) })],
    );
    const result = importOk(emptyVault(), incoming);
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "R11", path: "/projects/1/name" }),
    ]);
    expect(result.report.projects).toEqual([
      { incomingId: projectId(1), id: projectId(1), outcome: "added" },
      { incomingId: projectId(2), id: projectId(1), outcome: "merged" },
    ]);
    expect(result.vault.projects.map((p) => p.name)).toEqual(["Garden"]);
    expect(result.vault.sessions.map((s) => s.project_id)).toEqual([projectId(1), projectId(1)]);
  });

  it("a tag listed twice is one tag (repair 4), no refusal", () => {
    const result = importOk(
      emptyVault(),
      vaultDocument([], [session(1, { tags: ["garden", "Garden", " garden "] })]),
    );
    expect(find(result.vault, 1)?.tags).toEqual(["garden"]);
    expect(result.report.repairs.counts).toEqual({ tags_normalised: 1 });
  });

  it("a session and a project may share one UUID", () => {
    const result = importOk(
      emptyVault(),
      vaultDocument([project(1, { id: sessionId(1) })], [session(1, { project_id: sessionId(1) })]),
    );
    expect(result.report.counts).toMatchObject({ added: 1, projectsAdded: 1 });
  });

  it("a refused document imports nothing, not even its valid sessions and projects", () => {
    const start = importOk(emptyVault(), vaultDocument([], [session(9)])).vault;
    const mixed = vaultDocument(
      [project(1)],
      [session(1), session(2, { created_at: "2026-02-30T00:00:00Z" })],
    );
    const problems = importRefused(start, mixed);
    expect(problems.items).toEqual([expect.objectContaining({ rule: "R1", path: "/sessions/1/created_at" })]);
  });
});

describe("6.7 step 4: bytes", () => {
  const generator = { now: NOW, generator: webGenerator("0") };

  it("stores each blob once, however many sessions list it", () => {
    const result = importOk(
      emptyVault(),
      vaultDocument(
        [],
        [
          session(1, { attachments: [attachment(PNG, "image", true)] }),
          session(2, { attachments: [attachment(PNG, "file", true), attachment(PDF, "original_pdf", true)] }),
        ],
      ),
    );
    expect([...result.report.blobsStored].sort()).toEqual([PDF_SHA, PNG_SHA].sort());
    expect(result.vault.blobs.size).toBe(2);
  });

  it("stores bytes for a kept session when the stored session lists the hash", () => {
    const first = importOk(
      emptyVault(),
      vaultDocument(
        [],
        [session(1, { updated_at: T2, attachments: [attachment(PDF, "original_pdf", false)] })],
      ),
    );
    expect(first.vault.blobs.size).toBe(0);
    const older = session(1, {
      title: "Older copy",
      updated_at: T1,
      attachments: [attachment(PDF, "original_pdf", true)],
    });
    const second = importOk(first.vault, vaultDocument([], [older]));
    expect(outcomes(second)).toEqual(["kept"]);
    expect(second.report.blobsStored).toEqual([PDF_SHA]);
    expect(second.vault.blobs.get(PDF_SHA)).toEqual(PDF);
  });

  it("does not store bytes the destination session does not list", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1, { updated_at: T2 })]));
    const older = session(1, {
      title: "Older copy",
      updated_at: T1,
      attachments: [attachment(PDF, "original_pdf", true)],
    });
    const second = importOk(first.vault, vaultDocument([], [older]));
    expect(outcomes(second)).toEqual(["kept"]);
    expect(second.vault.blobs.size).toBe(0);
    expect(second.report.counts.blobsStored).toBe(0);
  });

  it("leaves a blob that is already stored alone", () => {
    const first = importOk(
      emptyVault(),
      vaultDocument([], [session(1, { attachments: [attachment(PNG, "image", true)] })]),
    );
    const second = importOk(
      first.vault,
      vaultDocument([], [session(2, { attachments: [attachment(PNG, "image", true)] })]),
    );
    expect(second.report.counts.blobsStored).toBe(0);
    expect(second.vault.blobs).toBe(first.vault.blobs);
  });

  it("takes bytes from a bundle for descriptors without inline data, after checking hash and length", () => {
    const file = vaultDocument(
      [],
      [
        session(1, {
          attachments: [attachment(PDF, "original_pdf", false), attachment(PNG, "image", false)],
        }),
      ],
    );
    const wrong = new Uint8Array(PNG);
    wrong[6] = 9;
    const result = importOk(emptyVault(), file, {
      bundleBlobs: new Map([
        [PDF_SHA, PDF],
        [PNG_SHA, wrong],
      ]),
    });
    expect(result.report.blobsStored).toEqual([PDF_SHA]);
    expect(result.report.warnings.items).toEqual([
      expect.objectContaining({ code: "bytes_rejected", path: "/sessions/0/attachments/1" }),
    ]);
    expect(result.vault.blobs.has(PNG_SHA)).toBe(false);
  });

  it("rejects bundle bytes of another length than the descriptor says, even with the right hash", () => {
    const lying = attachment(PDF, "original_pdf", false, { byte_length: PDF.length + 1 });
    const result = importOk(emptyVault(), vaultDocument([], [session(1, { attachments: [lying] })]), {
      bundleBlobs: new Map([[PDF_SHA, PDF]]),
    });
    expect(result.vault.blobs.size).toBe(0);
    expect(result.report.warnings.counts).toEqual({ bytes_rejected: 1 });
  });

  it("gives the copy made for a conflict its bytes", () => {
    const first = importOk(emptyVault(), vaultDocument([], [session(1)]));
    const other = session(1, { title: "With a picture", attachments: [attachment(PNG, "image", true)] });
    const second = importOk(first.vault, vaultDocument([], [other]), {
      onConflict: { copyWithTitleSuffix: " (copy)" },
    });
    expect(second.report.counts).toMatchObject({ conflicts: 1, copies: 1, blobsStored: 1 });
    expect(second.vault.blobs.get(PNG_SHA)).toEqual(PNG);
  });

  it("exports the bytes again exactly, or leaves them out on request", () => {
    const result = importOk(
      emptyVault(),
      vaultDocument([], [session(1, { attachments: [attachment(PDF, "original_pdf", true)] })]),
    );
    const withBytes = exportDocument(result.vault, { kind: "vault" }, generator, { includeBytes: true });
    const without = exportDocument(result.vault, { kind: "vault" }, generator, { includeBytes: false });
    expect(withBytes.ok && withBytes.doc.sessions[0]?.attachments[0]?.data_base64).toBe(
      Buffer.from(PDF).toString("base64"),
    );
    expect(without.ok && without.doc.sessions[0]?.attachments[0]).not.toHaveProperty("data_base64");
  });
});

describe("6.7 step 1: nothing is imported from a document that is refused", () => {
  const vault = () => importOk(emptyVault(), vaultDocument([project(1)], [session(1)])).vault;

  it("not this format", () => {
    expect(importRefused(vault(), { mapping: {} }).items.map((p) => p.rule)).toEqual(["format"]);
    expect(importRefused(vault(), "[]").items.map((p) => p.rule)).toEqual(["schema"]);
    expect(importRefused(vault(), "{ not json").items.map((p) => p.rule)).toEqual(["json"]);
  });

  it("a later version, whatever else the file holds", () => {
    const later = vaultDocument([], [session(2)], { version: 2, kind: "something new" });
    expect(importRefused(vault(), later).items.map((p) => [p.rule, p.path])).toEqual([
      ["version", "/version"],
    ]);
    expect(importRefused(vault(), vaultDocument([], [], { version: "1" })).items.map((p) => p.rule)).toEqual([
      "version",
    ]);
    expect(importRefused(vault(), vaultDocument([], [], { version: 0 })).items.map((p) => p.rule)).toEqual([
      "version",
    ]);
  });

  it("reads the text form and the parsed form alike", () => {
    const file = vaultDocument([project(2)], [session(2)]);
    const fromValue = importOk(vault(), file);
    const fromText = importOk(vault(), JSON.stringify(file));
    const withMark = importOk(vault(), `\uFEFF${JSON.stringify(file, null, 2)}`);
    expect(fromText.vault).toEqual(fromValue.vault);
    expect(withMark.vault).toEqual(fromValue.vault);
  });
});
