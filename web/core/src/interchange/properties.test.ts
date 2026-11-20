/// <reference types="node" />
// Property tests over two families of input:
//   1. the example file with random damage (wrong types, missing parts, hostile strings and keys);
//   2. random valid documents built from small pools, so that ids, names and timestamps collide.
// They pin down what must hold for every input, not for chosen examples.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import fc from "fast-check";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  checkVault,
  type DocumentImportContext,
  emptyVault,
  exportDocument,
  importDocument,
  type Notice,
  type NoticeList,
  readDocument,
  splitDocument,
  type Vault,
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
function context(): DocumentImportContext {
  let n = 0;
  return { now: NOW, newId: () => `ffffffff-ffff-4fff-8fff-${String(++n).padStart(12, "0")}` };
}
const EXPORT_CONTEXT = { now: NOW, generator: webGenerator("0.0.0-test") };

/**
 * The warnings of an export that need an explanation. Not among them: the two "should" rules, which
 * say something about the data, and bytes left out for a descriptor whose byte_length contradicts
 * the stored bytes of its own hash (a file can claim two lengths for one hash; one of them is wrong).
 */
function unexplained(vault: Vault, warnings: NoticeList): Notice[] {
  const contradicted = vault.sessions.some((session) =>
    session.attachments.some((attachment) => {
      const bytes = vault.blobs.get(attachment.sha256);
      return bytes !== undefined && bytes.length !== attachment.byte_length;
    }),
  );
  return warnings.items.filter(
    (notice) =>
      notice.code !== "R11" && notice.code !== "R12" && !(contradicted && notice.code === "bytes_omitted"),
  );
}

const prototypeKeys = (): string => Object.getOwnPropertyNames(Object.prototype).sort().join(",");
const PROTOTYPE_BEFORE = prototypeKeys();
afterAll(() => {
  // No input may have added to or removed from Object.prototype.
  expect(prototypeKeys()).toBe(PROTOTYPE_BEFORE);
  expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
});

// ---------------------------------------------------------------------------------------------
// Family 1: the example with random damage.
// ---------------------------------------------------------------------------------------------

type Path = readonly (string | number)[];

function pathsOf(root: unknown): Path[] {
  const out: Path[] = [[]];
  const walk = (value: unknown, path: Path): void => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        out.push([...path, i]);
        walk(item, [...path, i]);
      });
    } else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) {
        out.push([...path, key]);
        walk(item, [...path, key]);
      }
    }
  };
  walk(root, []);
  return out;
}

/** The container that holds the value at `path`, and its key there. Null for the root. */
function parentOf(
  root: unknown,
  path: Path,
): { holder: Record<string | number, unknown>; key: string | number } | null {
  let holder: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof holder !== "object" || holder === null) return null;
    holder = Reflect.get(holder, path[i] ?? "");
  }
  const key = path[path.length - 1];
  if (key === undefined || typeof holder !== "object" || holder === null) return null;
  // Arrays and objects are both indexable containers here.
  return { holder: holder as Record<string | number, unknown>, key };
}

/** Store a property even when it is named "__proto__". */
function define(holder: object, key: string | number, value: unknown): void {
  Object.defineProperty(holder, key, { value, enumerable: true, writable: true, configurable: true });
}

const PNG_SHA = "a0a4337e393b5dcba561013018a5261d56c20d164d4fa0be4b31456b211a3fd7";

/** Values that are interesting somewhere in the format, valid or not. */
const VALUES: readonly unknown[] = [
  null,
  true,
  false,
  0,
  1,
  2,
  -1,
  1.5,
  1e21,
  "",
  " ",
  "x",
  "Garden",
  " garden ",
  "#tag",
  "# #tag",
  "a,b",
  "UPPER",
  "one\r\ntwo\rthree",
  "nul\u0000inside",
  "\uD800 lone",
  "claude",
  "Claude ",
  "USER",
  "tool",
  "text",
  "attachment",
  "x_table",
  "original_pdf",
  "vault",
  "session",
  "sessionvault-interchange",
  "image/png",
  "Image/PNG",
  "a/b/c",
  "2026-01-01T00:00:00Z",
  "2026-01-01T00:00:00.5Z",
  "2026-01-01T00:00:00.123456789Z",
  "2026-02-30T00:00:00.000Z",
  "2026-01-01 00:00:00",
  "9999-12-31T23:59:59.999Z",
  "aaaaaaaa-0000-4000-8000-000000000001",
  "AAAAAAAA-0000-4000-8000-000000000002",
  "5e550000-0000-4000-8000-000000000001",
  "5e550000-0000-4000-8000-000000000009",
  "0e55a9e0-0001-4000-8000-000000000000",
  "not-a-uuid",
  PNG_SHA,
  PNG_SHA.toUpperCase(),
  "AAAA",
  "AA==",
  "****",
  [],
  [null],
  ["a", "a"],
  ["Garden", " b ,c"],
  {},
  { a: 1 },
  { type: "text", text: "more" },
  { type: "text" },
  { type: "attachment", sha256: PNG_SHA },
  { type: "attachment", sha256: "0".repeat(64) },
  { type: "x_tool_call", input: { constructor: 1, prototype: 2 } },
  JSON.parse('{"__proto__": {"polluted": true}}'),
];

const KEYS: readonly string[] = [
  "x_extra",
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "id",
  "updated_at",
  "model",
  "created_at",
  "data_base64",
  "project_id",
  "tags",
  "segments",
  "7",
  "nul\u0000key",
  "",
];

type Damage =
  | { readonly op: "set"; readonly at: number; readonly value: number }
  | { readonly op: "delete"; readonly at: number }
  | { readonly op: "add"; readonly at: number; readonly key: number; readonly value: number }
  | { readonly op: "duplicate"; readonly at: number }
  | { readonly op: "swap"; readonly at: number }
  | { readonly op: "upper"; readonly at: number }
  | { readonly op: "copy"; readonly at: number; readonly from: number };

const damageArbitrary: fc.Arbitrary<Damage> = fc.oneof(
  fc.record({ op: fc.constant("set" as const), at: fc.nat(), value: fc.nat(VALUES.length - 1) }),
  fc.record({ op: fc.constant("delete" as const), at: fc.nat() }),
  fc.record({
    op: fc.constant("add" as const),
    at: fc.nat(),
    key: fc.nat(KEYS.length - 1),
    value: fc.nat(VALUES.length - 1),
  }),
  fc.record({ op: fc.constant("duplicate" as const), at: fc.nat() }),
  fc.record({ op: fc.constant("swap" as const), at: fc.nat() }),
  fc.record({ op: fc.constant("upper" as const), at: fc.nat() }),
  fc.record({ op: fc.constant("copy" as const), at: fc.nat(), from: fc.nat() }),
);

/** The example with the given damage applied, one step after the other. */
function damaged(steps: readonly Damage[]): unknown {
  const root: unknown = JSON.parse(EXAMPLE_TEXT);
  for (const step of steps) {
    const paths = pathsOf(root);
    const path = paths[step.at % paths.length] ?? [];
    const target = parentOf(root, path);
    if (target === null) continue;
    const { holder, key } = target;
    const current = holder[key];
    switch (step.op) {
      case "set":
        define(holder, key, structuredClone(VALUES[step.value]));
        break;
      case "delete":
        if (Array.isArray(holder)) holder.splice(Number(key), 1);
        else delete holder[key];
        break;
      case "add":
        if (typeof current === "object" && current !== null && !Array.isArray(current)) {
          define(current, KEYS[step.key] ?? "x", structuredClone(VALUES[step.value]));
        } else if (Array.isArray(current)) {
          current.push(structuredClone(VALUES[step.value]));
        }
        break;
      case "duplicate":
        if (Array.isArray(holder)) holder.splice(Number(key), 0, structuredClone(current));
        break;
      case "swap":
        if (Array.isArray(holder) && holder.length > 1) {
          const other = (Number(key) + 1) % holder.length;
          [holder[Number(key)], holder[other]] = [holder[other], holder[Number(key)]];
        }
        break;
      case "upper":
        if (typeof current === "string") define(holder, key, current.toUpperCase());
        break;
      case "copy": {
        const source = parentOf(root, paths[step.from % paths.length] ?? []);
        if (source !== null) define(holder, key, structuredClone(source.holder[source.key]));
        break;
      }
    }
  }
  return root;
}

const SCHEMA_RULES = new Set(["schema", "format", "version"]);

describe("the example with random damage", () => {
  const seen = { accepted: 0, refused: 0, repaired: 0, schemaValid: 0, schemaInvalid: 0, strictValid: 0 };

  it("is read without throwing, and what the reader accepts is canonical and schema-valid", () => {
    fc.assert(
      fc.property(fc.array(damageArbitrary, { minLength: 1, maxLength: 4 }), (steps) => {
        const input = damaged(steps);
        const result = readDocument(input);
        if (!result.ok) {
          seen.refused += 1;
          expect(result.problems.total).toBeGreaterThan(0);
          expect(result.problems.items.length).toBeGreaterThan(0);
          return;
        }
        seen.accepted += 1;
        if (result.repairs.total > 0) seen.repaired += 1;
        // Accepted documents validate against the schema, with Ajv and with the strict validator.
        const valid = ajvValidate(result.doc);
        expect(ajvValidate.errors ?? []).toEqual([]);
        expect(valid).toBe(true);
        const strict = validateDocument(result.doc);
        expect(strict.problems.items).toEqual([]);
        expect(strict.ok).toBe(true);
        // Reading the result again changes nothing: it is the reader's fixed point.
        const again = readDocument(result.doc);
        expect(again.ok).toBe(true);
        if (again.ok) {
          expect(again.repairs.items).toEqual([]);
          expect(again.doc).toEqual(result.doc);
        }
        // The text form gives the same result as the parsed value.
        const fromText = readDocument(JSON.stringify(input));
        expect(fromText.ok).toBe(true);
        if (fromText.ok) expect(fromText.doc).toEqual(result.doc);
      }),
      { numRuns: 1500 },
    );
    expect(seen.accepted).toBeGreaterThan(100);
    expect(seen.refused).toBeGreaterThan(100);
    expect(seen.repaired).toBeGreaterThan(20);
  });

  it("is judged by the strict validator exactly as Ajv judges it against the schema", () => {
    fc.assert(
      fc.property(fc.array(damageArbitrary, { minLength: 1, maxLength: 3 }), (steps) => {
        const input = damaged(steps);
        const strict = validateDocument(input);
        const structural = strict.problems.items.filter((problem) => SCHEMA_RULES.has(problem.rule));
        const expected = ajvValidate(input);
        if (expected) seen.schemaValid += 1;
        else seen.schemaInvalid += 1;
        if (strict.ok) seen.strictValid += 1;
        expect({ structural, valid: structural.length === 0 }).toMatchObject({ valid: expected });
        // A document that needs no repair is accepted by the reader too.
        if (strict.ok) expect(readDocument(input).ok).toBe(true);
      }),
      { numRuns: 3000 },
    );
    expect(seen.schemaValid).toBeGreaterThan(200);
    expect(seen.schemaInvalid).toBeGreaterThan(200);
    expect(seen.strictValid).toBeGreaterThan(50);
  });

  it("is imported or refused whole, and an accepted import leaves a sound, re-importable vault", () => {
    let imported = 0;
    fc.assert(
      fc.property(fc.array(damageArbitrary, { minLength: 1, maxLength: 4 }), (steps) => {
        const input = damaged(steps);
        const start = emptyVault();
        const first = importDocument(start, input, context());
        expect(start).toEqual(emptyVault());
        if (!first.ok) {
          expect(first.problems.total).toBeGreaterThan(0);
          return;
        }
        imported += 1;
        expect(checkVault(first.vault).problems.items).toEqual([]);
        // The same input again: nothing new, nothing replaced, no conflict.
        const second = importDocument(first.vault, input, context());
        expect(second.ok).toBe(true);
        if (second.ok) {
          expect(second.report.counts).toMatchObject({
            added: 0,
            updated: 0,
            kept: 0,
            conflicts: 0,
            blobsStored: 0,
          });
          expect(second.vault).toEqual(first.vault);
        }
        // What the vault exports is valid as it is, and importing it changes nothing.
        const exported = exportDocument(first.vault, { kind: "vault" }, EXPORT_CONTEXT, {
          includeBytes: true,
        });
        expect(exported.ok).toBe(true);
        if (!exported.ok) return;
        expect(unexplained(first.vault, exported.warnings)).toEqual([]);
        expect(ajvValidate(exported.doc)).toBe(true);
        expect(validateDocument(exported.doc).ok).toBe(true);
        const third = importDocument(first.vault, exported.doc, context());
        expect(third.ok).toBe(true);
        if (third.ok) {
          expect(third.report.counts).toMatchObject({
            added: 0,
            updated: 0,
            kept: 0,
            conflicts: 0,
            blobsStored: 0,
          });
          expect(third.report.repairs.items).toEqual([]);
        }
      }),
      { numRuns: 600 },
    );
    expect(imported).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------------------------
// Family 2: random valid documents from small pools.
// ---------------------------------------------------------------------------------------------

const uuid = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const BLOBS = [new Uint8Array([1, 2, 3]), new Uint8Array(0), new Uint8Array(700).fill(7)].map((bytes) => ({
  sha256: createHash("sha256").update(bytes).digest("hex"),
  byte_length: bytes.length,
  data_base64: Buffer.from(bytes).toString("base64"),
}));

const TIMES = [
  "2026-01-05T12:00:00.000Z",
  "2026-03-14T09:30:00.000Z",
  "2026-03-14T09:30:00.001Z",
  "2026-11-01T10:00:00.000Z",
  // corrections.md 2, point 8: the year is 0001 to 9999.
  "0001-01-01T00:00:00.000Z",
  "9999-12-31T23:59:59.999Z",
];
const time = fc.constantFrom(...TIMES);
const TEXTS = [
  "",
  "plain",
  "two\n\nparagraphs",
  "caf\u00E9 \u{1F600}",
  "```sh\necho hi\n```",
  " leading and trailing ",
];
const text = fc.constantFrom(...TEXTS);

/** Unknown properties: any JSON value under a key that is not a known property name. */
const extras = fc.dictionary(
  fc.constantFrom("x_a", "x_b", "__proto__", "constructor", "prototype", "9", "x key"),
  fc.jsonValue({ maxDepth: 2 }),
  { maxKeys: 2 },
);

interface SegmentPlan {
  readonly kind: "text" | "attachment" | "unknown";
  readonly text: string;
  readonly pick: number;
  readonly extra: Record<string, unknown>;
}
const segmentPlan: fc.Arbitrary<SegmentPlan> = fc.record({
  kind: fc.constantFrom("text" as const, "attachment" as const, "unknown" as const),
  text,
  pick: fc.nat(),
  extra: extras,
});

const messagePlan = fc.record({
  role: fc.constantFrom("user", "assistant", "system", "unknown", "tool", "Subagent"),
  segments: fc.array(segmentPlan, { minLength: 1, maxLength: 4 }),
  created_at: fc.option(time, { nil: undefined }),
  model: fc.option(fc.constantFrom("claude-opus-5", "m"), { nil: undefined }),
  sharedId: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined, freq: 8 }),
  extra: extras,
});

const attachmentPlan = fc.record({
  blob: fc.nat(BLOBS.length - 1),
  kind: fc.constantFrom("original_pdf", "image", "file", "other", "x_kind"),
  inline: fc.boolean(),
  filename: fc.constantFrom("", "page.pdf", "a b.png"),
  created_at: time,
  extra: extras,
});

const sessionPlan = fc.record({
  id: fc.integer({ min: 1, max: 5 }),
  title: fc.constantFrom("", "Untitled", "Tomatoes", "Caf\u00E9"),
  provider: fc.constantFrom("claude", "chatgpt", "gemini", "other", "examplebot"),
  model: fc.constantFrom("", "example-model-1"),
  source_url: fc.constantFrom("", "https://share.example/EXAMPLE-0001"),
  summary: fc.constantFrom("", "One line.", "Two\nlines."),
  tags: fc.uniqueArray(fc.constantFrom("garden", "bikes", "two words", "#hash"), { maxLength: 3 }),
  is_pinned: fc.boolean(),
  created_at: time,
  imported_at: time,
  updated_at: time,
  project: fc.option(fc.nat(), { nil: undefined }),
  attachments: fc.array(attachmentPlan, { maxLength: 3 }),
  messages: fc.array(messagePlan, { maxLength: 4 }),
  extra: extras,
});

const projectPlan = fc.record({
  id: fc.integer({ min: 1, max: 4 }),
  name: fc.constantFrom("Garden", " garden", "Bike workshop", "\u00C5ngstr\u00F6m", "apple pie ideas"),
  created_at: time,
  updated_at: time,
  extra: extras,
});

const documentPlan = fc.record({
  projects: fc.uniqueArray(projectPlan, { maxLength: 3, selector: (project) => project.id }),
  sessions: fc.uniqueArray(sessionPlan, { maxLength: 4, selector: (session) => session.id }),
  extra: extras,
  exported_at: time,
});

type DocumentPlan = typeof documentPlan extends fc.Arbitrary<infer T> ? T : never;

/** A property bag with the extras after the known properties, hostile names stored as plain keys. */
function withExtras(known: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...known };
  for (const [key, value] of Object.entries(extra)) if (!Object.hasOwn(known, key)) define(out, key, value);
  return out;
}

/** A valid, canonical document from a plan. */
function build(plan: DocumentPlan): Record<string, unknown> {
  const usedMessageIds = new Set<string>();
  const projects = plan.projects.map((project) =>
    withExtras(
      {
        id: uuid("aaaaaaaa", project.id),
        name: project.name,
        created_at: project.created_at,
        updated_at: project.updated_at,
      },
      project.extra,
    ),
  );
  const sessions = plan.sessions.map((session) => {
    // R5: (kind, sha256) unique, at most one original_pdf.
    const seen = new Set<string>();
    const attachments = session.attachments
      .filter((attachment) => {
        const blob = BLOBS[attachment.blob];
        const key = `${attachment.kind}|${blob?.sha256}`;
        const repeatedOriginal =
          attachment.kind === "original_pdf" && [...seen].some((k) => k.startsWith("original_pdf|"));
        if (seen.has(key) || repeatedOriginal) return false;
        seen.add(key);
        return true;
      })
      .map((attachment) => {
        const blob = BLOBS[attachment.blob];
        return withExtras(
          {
            kind: attachment.kind,
            sha256: blob?.sha256,
            media_type: "application/octet-stream",
            byte_length: blob?.byte_length,
            filename: attachment.filename,
            created_at: attachment.created_at,
            ...(attachment.inline ? { data_base64: blob?.data_base64 } : {}),
          },
          attachment.extra,
        );
      });
    const messages = session.messages.map((message, index) => {
      // R2: unique in the document. Shared ids make two documents clash on purpose.
      let id =
        message.sharedId === undefined
          ? uuid(`0e55${String(session.id).padStart(4, "0")}`, index)
          : uuid("0e55ffff", message.sharedId);
      if (usedMessageIds.has(id)) id = uuid(`0e55${String(session.id).padStart(4, "0")}`, 100 + index);
      usedMessageIds.add(id);
      // R7: no two text segments in a row; an attachment segment names a listed attachment.
      const segments: Record<string, unknown>[] = [];
      for (const segment of message.segments) {
        const previous = segments[segments.length - 1];
        const listed = attachments[segment.pick % Math.max(attachments.length, 1)];
        if (segment.kind === "attachment" && listed !== undefined) {
          segments.push(withExtras({ type: "attachment", sha256: listed.sha256 }, segment.extra));
        } else if (segment.kind === "text" && previous?.type !== "text") {
          segments.push(withExtras({ type: "text", text: segment.text }, segment.extra));
        } else {
          segments.push(
            withExtras(
              { type: "x_tool_call", name: "lookup", input: { query: segment.text } },
              segment.extra,
            ),
          );
        }
      }
      return withExtras(
        {
          id,
          index,
          role: message.role,
          segments,
          ...(message.created_at === undefined ? {} : { created_at: message.created_at }),
          ...(message.model === undefined ? {} : { model: message.model }),
        },
        message.extra,
      );
    });
    const project =
      session.project === undefined ? undefined : projects[session.project % Math.max(projects.length, 1)];
    return withExtras(
      {
        id: uuid("5e550000", session.id),
        title: session.title,
        provider: session.provider,
        model: session.model,
        source_url: session.source_url,
        summary: session.summary,
        tags: session.tags.map((tag) => tag.replace("#", "")),
        is_pinned: session.is_pinned,
        created_at: session.created_at,
        imported_at: session.imported_at,
        updated_at: session.updated_at,
        project_id: project?.id ?? null,
        attachments,
        messages,
      },
      session.extra,
    );
  });
  return withExtras(
    {
      format: "sessionvault-interchange",
      version: 1,
      kind: "vault",
      exported_at: plan.exported_at,
      generator: { app: "sessionvault-test", app_version: "0", platform: "test" },
      projects,
      sessions,
    },
    plan.extra,
  );
}

/**
 * A document reduced to what a round trip must keep: arrays sorted by id, the file's own
 * properties removed, and the inline bytes left out (a vault stores bytes once per hash, so a
 * descriptor that came without bytes is exported with them when another one brought them).
 */
function comparable(document: unknown): unknown {
  const copy = structuredClone(document) as Record<string, unknown>;
  for (const key of Object.keys(copy)) {
    if (key !== "format" && key !== "version" && key !== "kind" && key !== "projects" && key !== "sessions") {
      delete copy[key];
    }
  }
  const sort = (value: unknown, key: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (key === "attachments" && typeof item === "object" && item !== null) delete item.data_base64;
        sort(item, "");
      }
      if (value.every((item) => typeof item === "object" && item !== null && typeof item.id === "string")) {
        value.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [name, item] of Object.entries(value)) sort(item, name);
    }
  };
  sort(copy, "");
  return copy;
}

/** The hashes of the attachments that travel with their bytes. */
function inlineHashes(document: unknown): string[] {
  const hashes = new Set<string>();
  const sessions: unknown = Reflect.get(Object(document), "sessions");
  for (const session of Array.isArray(sessions) ? sessions : []) {
    for (const attachment of session.attachments) {
      if (typeof attachment.data_base64 === "string") hashes.add(attachment.sha256);
    }
  }
  return [...hashes].sort();
}

function sessionIds(vault: Vault): string[] {
  return vault.sessions.map((session) => session.id).sort();
}

describe("random valid documents", () => {
  it("are valid for the strict validator and for Ajv (the generator and both validators agree)", () => {
    fc.assert(
      fc.property(documentPlan, (plan) => {
        const document = build(plan);
        expect(ajvValidate(document)).toBe(true);
        const strict = validateDocument(document);
        expect(strict.problems.items).toEqual([]);
        const read = readDocument(document);
        expect(read.ok).toBe(true);
        if (read.ok) {
          // Nothing to repair in a canonical document. A dangling project cannot occur here.
          expect(read.repairs.items).toEqual([]);
          expect(read.doc).toEqual(document);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("survive import into an empty vault and export unchanged, unknown properties included", () => {
    fc.assert(
      fc.property(documentPlan, (plan) => {
        const document = build(plan);
        const imported = importDocument(emptyVault(), document, context());
        expect(imported.ok).toBe(true);
        if (!imported.ok) return;
        expect(checkVault(imported.vault).problems.items).toEqual([]);
        const exported = exportDocument(imported.vault, { kind: "vault" }, EXPORT_CONTEXT, {
          includeBytes: true,
        });
        expect(exported.ok).toBe(true);
        if (!exported.ok) return;
        expect(ajvValidate(exported.doc)).toBe(true);
        expect(validateDocument(exported.doc).ok).toBe(true);

        // Projects with the same name become one (6.7 step 2b); only then may the export differ.
        const merged = imported.report.counts.projectsMerged > 0;
        if (!merged) expect(comparable(exported.doc)).toEqual(comparable(document));
        // Every blob that came inline is stored, and is exported wherever its hash is listed.
        expect([...imported.vault.blobs.keys()].sort()).toEqual(inlineHashes(document));
        expect(inlineHashes(exported.doc)).toEqual(inlineHashes(document));
        for (const session of exported.doc.sessions) {
          for (const attachment of session.attachments) {
            expect(attachment.data_base64 !== undefined).toBe(imported.vault.blobs.has(attachment.sha256));
          }
        }

        // Importing either form again changes nothing.
        for (const again of [document, exported.doc]) {
          const second = importDocument(imported.vault, again, context());
          expect(second.ok).toBe(true);
          if (second.ok) {
            expect(second.report.counts).toMatchObject({ added: 0, updated: 0, kept: 0, conflicts: 0 });
            expect(second.vault).toEqual(imported.vault);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  /** Import the documents in the given order, some of them more than once, and check every step. */
  function mergeHistory(
    plans: readonly DocumentPlan[],
    order: readonly number[],
    outcomes: Set<string>,
  ): void {
    let vault = emptyVault();
    // The documents in a random order, some of them more than once.
    for (const pick of order) {
      const plan = plans[pick % plans.length];
      if (plan === undefined) continue;
      const document = build(plan);
      const before = vault;
      const snapshot = structuredClone(before);
      const result = importDocument(before, document, context());
      // The vault that went in is untouched.
      expect(before).toEqual(snapshot);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      vault = result.vault;
      for (const session of result.report.sessions)
        outcomes.add(session.conflict ? "conflict" : session.outcome);
      for (const project of result.report.projects) outcomes.add(`project ${project.outcome}`);
      if (result.report.warnings.counts.id_replaced !== undefined) outcomes.add("id_replaced");

      // Import never deletes (6.7).
      expect(sessionIds(vault)).toEqual(expect.arrayContaining(sessionIds(before)));
      expect(vault.projects.length).toBeGreaterThanOrEqual(before.projects.length);
      for (const [sha256, bytes] of before.blobs) expect(vault.blobs.get(sha256)).toBe(bytes);
      // The counts add up to the sessions of the document.
      const { added, updated, unchanged, kept } = result.report.counts;
      expect(added + updated + unchanged + kept).toBe(plan.sessions.length);
      // The vault stays sound: ids unique, references resolve, derived values right, hashes right.
      expect(checkVault(vault).problems.items).toEqual([]);
      // Timestamps come from the file, never from the clock (6.7 step 3).
      for (const session of vault.sessions) {
        for (const stamp of [session.created_at, session.imported_at, session.updated_at]) {
          expect(TIMES).toContain(stamp.toISOString());
        }
      }
    }
    // Whatever the history, the vault exports as a valid document that imports back unchanged.
    const exported = exportDocument(vault, { kind: "vault" }, EXPORT_CONTEXT, { includeBytes: true });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(unexplained(vault, exported.warnings)).toEqual([]);
    expect(ajvValidate(exported.doc)).toBe(true);
    const back = importDocument(vault, exported.doc, context());
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.report.counts).toMatchObject({
        added: 0,
        updated: 0,
        kept: 0,
        conflicts: 0,
        blobsStored: 0,
      });
    }
    const fresh = importDocument(emptyVault(), exported.doc, context());
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      const again = exportDocument(fresh.vault, { kind: "vault" }, EXPORT_CONTEXT, {
        includeBytes: true,
      });
      expect(again.ok && again.doc).toEqual(exported.doc);
    }
  }

  const histories = [
    fc.array(documentPlan, { minLength: 2, maxLength: 3 }),
    fc.array(fc.nat(2), { minLength: 2, maxLength: 6 }),
  ] as const;

  it("merge into each other without ever deleting, duplicating an id or breaking the vault", () => {
    fc.assert(
      fc.property(...histories, (plans, order) => mergeHistory(plans, order, new Set())),
      { numRuns: 300 },
    );
  });

  it("reach every branch of 6.7 while doing so (a fixed seed, so that the claim is checked the same way each time)", () => {
    const outcomes = new Set<string>();
    fc.assert(
      fc.property(...histories, (plans, order) => mergeHistory(plans, order, outcomes)),
      { numRuns: 400, seed: 20261120 },
    );
    // The pools are small enough that every branch is reached.
    expect([...outcomes].sort()).toEqual(
      [
        "added",
        "conflict",
        "id_replaced",
        "kept",
        "project added",
        "project kept",
        "project merged",
        "project unchanged",
        "project updated",
        "unchanged",
        "updated",
      ].sort(),
    );
  });

  it("split into the documents of a bundle import to the same vault as the whole", () => {
    fc.assert(
      fc.property(documentPlan, (plan) => {
        const read = readDocument(build(plan));
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        const parts = splitDocument(read.doc);
        expect(parts.sessions.length).toBe(read.doc.sessions.length);
        let vault = emptyVault();
        for (const part of [parts.vault, ...parts.sessions]) {
          expect(ajvValidate(part)).toBe(true);
          expect(validateDocument(part).problems.items).toEqual([]);
          const next = importDocument(vault, part, context());
          expect(next.ok).toBe(true);
          if (!next.ok) return;
          vault = next.vault;
        }
        const whole = importDocument(emptyVault(), read.doc, context());
        expect(whole.ok && whole.vault).toEqual(vault);
      }),
      { numRuns: 300 },
    );
  });

  it("export one session as a valid session document that imports alone", () => {
    fc.assert(
      fc.property(documentPlan, (plan) => {
        const imported = importDocument(emptyVault(), build(plan), context());
        expect(imported.ok).toBe(true);
        if (!imported.ok) return;
        for (const session of imported.vault.sessions) {
          const single = exportDocument(imported.vault, { kind: "session", id: session.id }, EXPORT_CONTEXT, {
            includeBytes: false,
          });
          expect(single.ok).toBe(true);
          if (!single.ok) continue;
          expect(ajvValidate(single.doc)).toBe(true);
          expect(validateDocument(single.doc).ok).toBe(true);
          expect(single.doc.kind).toBe("session");
          expect(single.doc.sessions.length).toBe(1);
          expect(single.doc.projects.length).toBe(session.project_id === null ? 0 : 1);
          const alone = importDocument(emptyVault(), single.doc, context());
          expect(alone.ok).toBe(true);
          if (alone.ok) {
            // Without bytes the descriptors travel alone (6.4 "omitted").
            expect(alone.vault.blobs.size).toBe(0);
            expect(alone.vault.sessions).toEqual([session]);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
