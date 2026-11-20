/// <reference types="node" />
// Hostile input: files from strangers and values from web pages. The reader returns problems;
// it never throws, never hangs, and nothing it is given can change Object.prototype.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import fc from "fast-check";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  checkVault,
  DEFAULT_LIMITS,
  type DocumentImportContext,
  documentText,
  emptyVault,
  exportDocument,
  importDocument,
  isInterchangeDocument,
  type Problem,
  readDocument,
  validateDocument,
  webGenerator,
} from "./index.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const DOCS = new URL("../../../docs/", import.meta.url);
const readText = (name: string): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(new URL(name, DOCS)));
const EXAMPLE_TEXT = readText("example-vault-export.json");
const example = () => JSON.parse(EXAMPLE_TEXT);
const ajvValidate = new Ajv({ strict: true }).compile(JSON.parse(readText("interchange-schema-v1.json")));

const NOW = new Date("2026-11-20T08:00:00.000Z");
function context(): DocumentImportContext {
  let n = 0;
  return { now: NOW, newId: () => `ffffffff-ffff-4fff-8fff-${String(++n).padStart(12, "0")}` };
}
const exportContext = { now: NOW, generator: webGenerator("0.0.0-test") };

/** Everything Object.prototype and Array.prototype hold, as text. */
function prototypes(): string {
  const describeOne = (prototype: object): string =>
    Reflect.ownKeys(prototype)
      .map((key) => `${String(key)}:${typeof Reflect.get(prototype, key)}`)
      .sort()
      .join(",");
  return `${describeOne(Object.prototype)}|${describeOne(Array.prototype)}|${String(Object.getPrototypeOf(Object.prototype))}`;
}
const PROTOTYPES_BEFORE = prototypes();
function expectPrototypesUntouched(): void {
  expect(prototypes()).toBe(PROTOTYPES_BEFORE);
  for (const name of ["polluted", "isAdmin", "x_capture", "id", "sessions"]) {
    expect(Reflect.get({}, name), name).toBeUndefined();
    expect(Reflect.get([], name), name).toBeUndefined();
  }
}
afterEach(expectPrototypesUntouched);
afterAll(expectPrototypesUntouched);

const rules = (problems: readonly Problem[]): string[] => [
  ...new Set(problems.map((problem) => problem.rule)),
];
const pointer = (path: readonly (string | number)[]): string => path.map((step) => `/${step}`).join("");

type Path = readonly (string | number)[];

function pathsOf(root: unknown): Path[] {
  const out: Path[] = [];
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

function setAt(root: unknown, path: Path, value: unknown): void {
  let holder: unknown = root;
  for (const step of path.slice(0, -1)) holder = Reflect.get(Object(holder), step);
  Reflect.set(Object(holder), path[path.length - 1] ?? "", value);
}

function getAt(root: unknown, path: Path): unknown {
  let value: unknown = root;
  for (const step of path) value = Reflect.get(Object(value), step);
  return value;
}

const jsonType = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/**
 * The JSON type the format demands at a path of the example, and whether null stands for the
 * default there (6.6 repair 3). Undefined for paths inside unknown properties, where any type goes.
 */
function demandedType(path: Path, document: unknown): { type: string; nullIsDefault: boolean } | undefined {
  const key = path[path.length - 1];
  const parent = pointer(path.slice(0, -1));
  const must = (type: string) => ({ type, nullIsDefault: false });
  const may = (type: string) => ({ type, nullIsDefault: true });
  if (typeof key === "number") {
    if (/^\/sessions\/\d+\/tags$/.test(parent)) return must("string");
    if (
      /^\/(projects|sessions|sessions\/\d+\/(attachments|messages|messages\/\d+\/segments))$/.test(parent)
    ) {
      return must("object");
    }
    return undefined;
  }
  if (parent === "") {
    const types: Record<string, ReturnType<typeof must>> = {
      format: must("string"),
      version: must("number"),
      kind: must("string"),
      exported_at: must("string"),
      generator: may("object"),
      projects: must("array"),
      sessions: must("array"),
    };
    return types[key ?? ""];
  }
  if (parent === "/generator") {
    return { app: must("string"), app_version: may("string"), platform: may("string") }[key ?? ""];
  }
  if (/^\/projects\/\d+$/.test(parent)) {
    return {
      id: must("string"),
      name: must("string"),
      created_at: must("string"),
      updated_at: may("string"),
    }[key ?? ""];
  }
  if (/^\/sessions\/\d+$/.test(parent)) {
    return {
      id: must("string"),
      title: must("string"),
      provider: must("string"),
      model: may("string"),
      source_url: may("string"),
      summary: may("string"),
      tags: may("array"),
      is_pinned: may("boolean"),
      created_at: must("string"),
      imported_at: must("string"),
      updated_at: may("string"),
      // null is a value of its own here, not a stand-in for a default.
      project_id: may("string"),
      attachments: may("array"),
      messages: must("array"),
    }[key ?? ""];
  }
  if (/^\/sessions\/\d+\/attachments\/\d+$/.test(parent)) {
    return {
      kind: must("string"),
      sha256: must("string"),
      media_type: must("string"),
      byte_length: must("number"),
      filename: may("string"),
      created_at: may("string"),
      data_base64: may("string"),
    }[key ?? ""];
  }
  if (/^\/sessions\/\d+\/messages\/\d+$/.test(parent)) {
    return {
      id: must("string"),
      index: must("number"),
      role: must("string"),
      segments: must("array"),
      created_at: may("string"),
      model: may("string"),
    }[key ?? ""];
  }
  if (/^\/sessions\/\d+\/messages\/\d+\/segments\/\d+$/.test(parent)) {
    const segmentType = Reflect.get(Object(getAt(document, path.slice(0, -1))), "type");
    if (key === "type") return must("string");
    if (key === "text" && segmentType === "text") return must("string");
    if (key === "sha256" && segmentType === "attachment") return must("string");
  }
  return undefined;
}

const SAMPLES: readonly unknown[] = [null, true, 0, 1.5, "", "x", [], [1], {}, { a: 1 }];

describe("wrong types at every level", () => {
  const original = example();
  const paths = pathsOf(original);

  it("covers every level of the format", () => {
    const demanded = paths.filter((path) => demandedType(path, original) !== undefined).map(pointer);
    expect(paths.length).toBe(287);
    expect(demanded.length).toBeGreaterThan(220);
    for (const level of [
      "/format",
      "/generator/app",
      "/projects/0",
      "/projects/0/id",
      "/sessions/0",
      "/sessions/0/tags/0",
      "/sessions/0/is_pinned",
      "/sessions/1/attachments/0",
      "/sessions/1/attachments/0/byte_length",
      "/sessions/2/messages/2",
      "/sessions/2/messages/2/index",
      "/sessions/2/messages/2/segments/1",
      "/sessions/2/messages/2/segments/1/sha256",
      "/sessions/2/messages/2/segments/0/text",
    ]) {
      expect(demanded).toContain(level);
    }
  });

  it("a value of the wrong type at any place is reported at that place, and never thrown about", () => {
    let refused = 0;
    let defaulted = 0;
    let discarded = 0;
    for (const path of paths) {
      const demand = demandedType(path, original);
      if (demand === undefined) continue;
      for (const sample of SAMPLES) {
        if (jsonType(sample) === demand.type) continue;
        const document = example();
        setAt(document, path, sample);
        const label = `${pointer(path)} = ${JSON.stringify(sample)}`;
        const read = readDocument(document);
        if (sample === null && demand.nullIsDefault) {
          // Repair 3: null stands for the default, so the null itself is never the problem. (The
          // default can still break another rule: without attachments an attachment segment
          // has nothing to point at.)
          const at = pointer(path);
          const blamed = read.ok ? [] : read.problems.items.filter((problem) => problem.path === at);
          expect(blamed, label).toEqual([]);
          if (!read.ok) expect(rules(read.problems.items), label).toEqual(["R7"]);
          else defaulted += 1;
          continue;
        }
        if (path[path.length - 1] === "data_base64") {
          // corrections.md 2, point 7 (repair 9): data_base64 that is not a string is removed
          // with a warning and the descriptor stays. Only a writer is refused for it.
          const at = pointer(path);
          expect(read.ok, label).toBe(true);
          if (read.ok) {
            expect(
              read.warnings.items.map((warning) => `${warning.code} ${warning.path}`),
              label,
            ).toEqual([`bytes_discarded ${at}`]);
          }
          expect(validateDocument(document).ok, label).toBe(false);
          expect(ajvValidate(document), label).toBe(false);
          discarded += 1;
          continue;
        }
        expect(read.ok, label).toBe(false);
        if (read.ok) continue;
        refused += 1;
        const at = pointer(path);
        const reported = read.problems.items.map((problem) => problem.path);
        // "format" and "version" stop the reading at once, with their own rule.
        if (at === "/format" || at === "/version") {
          expect(
            read.problems.items.map((problem) => problem.rule),
            label,
          ).toEqual([at.slice(1)]);
        } else {
          expect(reported, label).toContain(at);
          // "kind" is an enum without a type of its own in the schema.
          expect(
            read.problems.items.find((problem) => problem.path === at),
            label,
          ).toMatchObject({
            rule: "schema",
            keyword: at === "/kind" ? "enum" : "type",
          });
        }
        // The strict validator refuses it too, and so does the schema.
        expect(validateDocument(document).ok, label).toBe(false);
        expect(ajvValidate(document), label).toBe(false);
      }
    }
    expect(refused).toBeGreaterThan(2000);
    expect(defaulted).toBeGreaterThan(40);
    // Two attachments of the example carry bytes; seven samples are neither a string nor null.
    expect(discarded).toBe(2 * 7);
  });

  it("any sample value at any place, also inside unknown properties, gives a verdict that Ajv shares", () => {
    let accepted = 0;
    for (const path of paths) {
      for (const sample of SAMPLES) {
        const document = example();
        setAt(document, path, sample);
        const label = `${pointer(path)} = ${JSON.stringify(sample)}`;
        const read = readDocument(document);
        const strict = validateDocument(document);
        const structural = strict.problems.items.filter((p) =>
          ["schema", "format", "version"].includes(p.rule),
        );
        expect(structural.length === 0, label).toBe(ajvValidate(document));
        if (read.ok) {
          accepted += 1;
          expect(ajvValidate(read.doc), label).toBe(true);
        } else {
          expect(read.problems.items.length, label).toBeGreaterThan(0);
        }
      }
    }
    expect(accepted).toBeGreaterThan(400);
  });

  it("the root may be anything", () => {
    for (const root of [
      null,
      true,
      0,
      "",
      "x",
      [],
      [example()],
      "null",
      "[]",
      "{}",
      "1",
      '"text"',
      "",
      "{",
      "\uFEFF",
    ]) {
      const read = readDocument(root);
      expect(read.ok, JSON.stringify(root)).toBe(false);
      expect(validateDocument(root).ok).toBe(false);
      expect(isInterchangeDocument(root)).toBe(false);
      expect(importDocument(emptyVault(), root, context()).ok).toBe(false);
    }
  });

  it("names the rule for text that is not JSON, for other JSON, and for other formats", () => {
    const problemsOf = (input: unknown): Problem[] => {
      const read = readDocument(input);
      return read.ok ? [] : [...read.problems.items];
    };
    expect(problemsOf("{ not json")).toEqual([
      { rule: "json", path: "", message: "The text is not valid JSON." },
    ]);
    expect(problemsOf("")).toEqual([{ rule: "json", path: "", message: "The text is not valid JSON." }]);
    expect(rules(problemsOf("[]"))).toEqual(["schema"]);
    expect(rules(problemsOf("null"))).toEqual(["schema"]);
    expect(problemsOf("{}")).toEqual([
      { rule: "format", path: "/format", message: "This is not a SessionVault interchange file." },
    ]);
    // A ChatGPT export, the other JSON the app imports: not this format.
    expect(rules(problemsOf([{ title: "t", mapping: {} }]))).toEqual(["schema"]);
    expect(rules(problemsOf({ format: "SessionVault-Interchange", version: 1 }))).toEqual(["format"]);
    expect(rules(problemsOf({ format: "sessionvault-interchange" }))).toEqual(["version"]);
    expect(rules(problemsOf({ format: "sessionvault-interchange", version: 1 }))).toEqual(["schema"]);
  });

  it("the messages of problems do not quote the file", () => {
    const secret = "TRANSCRIPT-TEXT-THAT-MUST-NOT-LEAK";
    const document = example();
    document.sessions[0].created_at = secret;
    document.sessions[0].id = secret;
    document.sessions[1].provider = { [secret]: secret };
    document.sessions[2].messages[0].segments[0].text = [secret];
    document.sessions[3].tags = [secret, 5];
    document.projects[0][secret] = "\u0000";
    document.projects[1].name = 7;
    document[secret] = { deep: { [secret]: "\uD800" } };
    for (const result of [readDocument(document), validateDocument(document)]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.problems.items.length).toBeGreaterThan(5);
      expect(JSON.stringify(result.problems)).not.toContain(secret);
    }
    // Neither do repairs and warnings, nor the path to a value that is not JSON at all.
    const repaired = example();
    repaired.sessions[0][secret] = { [secret]: `${secret}\u0000` };
    repaired.sessions[0].title = `${secret}\u0000`;
    repaired.sessions[0].tags = [` ${secret} `];
    repaired.sessions[0].project_id = "cccccccc-0000-4000-8000-000000000001";
    const read = readDocument(repaired);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.repairs.total).toBe(3);
      expect(read.warnings.total).toBe(1);
      expect(JSON.stringify([read.repairs, read.warnings])).not.toContain(secret);
    }
    const notJson = example();
    notJson[secret] = { deep: { [secret]: Number.NaN } };
    const refused = readDocument(notJson);
    expect(!refused.ok && refused.problems.items).toEqual([
      { rule: "json", path: "/(property 9)/(property 1)/(property 1)", message: "The number is not finite." },
    ]);
    const text = readDocument(`{"format": "sessionvault-interchange", "${secret}": }`);
    expect(JSON.stringify(text)).not.toContain(secret);
  });
});

describe("prototype-polluting keys", () => {
  const POLLUTERS = [
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "__defineGetter__",
  ];

  function withPolluters(): string {
    const payload = POLLUTERS.map((key) => `"${key}": {"polluted": true, "isAdmin": true}`).join(", ");
    // At the top, on a project, a session, an attachment, a message, a segment, and nested in an unknown property.
    return EXAMPLE_TEXT.replace('"format":', `${payload}, "format":`)
      .replace('"x_color": "green"', `"x_color": {"deep": {${payload}}}, ${payload}`)
      .replace('"x_capture": {', `${payload}, "x_capture": {${payload}, `)
      .replace('"x_pages": 1', `"x_pages": 1, ${payload}`)
      .replace('"x_rating": 5', `"x_rating": 5, ${payload}`)
      .replace('"type": "x_table",', `"type": "x_table", ${payload},`);
  }

  it("are read as ordinary data at every level", () => {
    const text = withPolluters();
    expect(text.split('"__proto__"').length - 1).toBe(8);
    const read = readDocument(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expectPrototypesUntouched();
    const project = read.doc.projects[1];
    for (const key of POLLUTERS) {
      expect(Object.hasOwn(read.doc, key), key).toBe(true);
      expect(Object.hasOwn(project ?? {}, key), key).toBe(true);
      expect(project?.[key], key).toEqual({ polluted: true, isAdmin: true });
    }
    // Every object the reader made is free of a prototype, so no key can reach one.
    const check = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(check);
      else if (typeof value === "object" && value !== null) {
        expect(Object.getPrototypeOf(value)).toBeNull();
        Object.values(value).forEach(check);
      }
    };
    check(read.doc);
    expect(Reflect.get(Object(project), "polluted")).toBeUndefined();
  });

  it("survive import and export at their place, and are never stored from the top level", () => {
    const text = withPolluters();
    const imported = importDocument(emptyVault(), text, context());
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expectPrototypesUntouched();
    expect(checkVault(imported.vault).ok).toBe(true);
    const garden = imported.vault.projects.find((project) => project.name === "Garden");
    expect(Object.keys(garden?.extra ?? {})).toEqual(["x_color", ...POLLUTERS]);
    expect(Reflect.get(Object(garden), "isAdmin")).toBeUndefined();
    expect(Reflect.get(Object(garden?.extra), "isAdmin")).toBeUndefined();

    const exported = exportDocument(imported.vault, { kind: "vault" }, exportContext, { includeBytes: true });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(Object.keys(exported.doc)).toEqual([
      "format",
      "version",
      "kind",
      "exported_at",
      "generator",
      "projects",
      "sessions",
    ]);
    const back = JSON.parse(documentText(exported.doc) ?? "");
    const original = JSON.parse(text);
    for (const key of [...POLLUTERS, "x_note", "exported_at", "generator"]) {
      Reflect.deleteProperty(back, key);
      Reflect.deleteProperty(original, key);
    }
    const sortById = (list: { id: string }[]): void => {
      list.sort((a, b) => (a.id < b.id ? -1 : 1));
    };
    for (const document of [back, original]) {
      sortById(document.projects);
      sortById(document.sessions);
    }
    expect(back).toEqual(original);
    // JSON.parse keeps "__proto__" as an own property; the comparison above saw them all.
    expect(Object.hasOwn(back.projects[1], "__proto__")).toBe(true);
    expect(Object.hasOwn(back.sessions[4].x_capture, "__proto__")).toBe(true);
    expectPrototypesUntouched();
  });

  it("do no harm in a value that was built in memory, with real prototype tricks", () => {
    const document = example();
    // A property assigned through the accessor replaces the prototype of that one object.
    const tricked = { type: "x_note" };
    Object.setPrototypeOf(tricked, { text: "inherited text", polluted: true });
    document.sessions[0].messages[0].segments.push(tricked);
    const read = readDocument(document);
    // Not a plain object: refused, not walked into.
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems.items).toEqual([
        {
          rule: "json",
          path: "/sessions/0/messages/0/segments/1",
          message: "The value is not a plain JSON object.",
        },
      ]);
    }
    expectPrototypesUntouched();
  });

  it("known properties cannot be supplied by a prototype", () => {
    const document = example();
    // An object without a prototype is plain data.
    const bare = Object.assign(Object.create(null), document.sessions[0]);
    document.sessions[0] = bare;
    expect(readDocument(document).ok).toBe(true);
    delete bare.title;
    const missing = readDocument(document);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.problems.items).toEqual([
        expect.objectContaining({ keyword: "required", path: "/sessions/0/title" }),
      ]);
    }
    // A prototype that is itself bare passes for an Object.prototype of another realm. What it
    // holds is still not read: only own properties count.
    const supplier = Object.assign(Object.create(null), { title: "from the prototype", polluted: true });
    const inheriting = Object.assign(Object.create(supplier), example().sessions[0]);
    delete inheriting.title;
    expect(inheriting.title).toBe("from the prototype");
    const viaPrototype = example();
    viaPrototype.sessions[0] = inheriting;
    const read = readDocument(viaPrototype);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems.items).toEqual([
        expect.objectContaining({ keyword: "required", path: "/sessions/0/title" }),
      ]);
    }
  });
});

describe("values JSON cannot hold, handed over already parsed", () => {
  const cases: [string, (document: ReturnType<typeof example>) => void, string, string][] = [
    [
      "a function",
      (d) => {
        d.sessions[0].title = () => "x";
      },
      "/sessions/0/title",
      "json",
    ],
    [
      "a symbol",
      (d) => {
        d.sessions[0].title = Symbol("x");
      },
      "/sessions/0/title",
      "json",
    ],
    [
      "a bigint",
      (d) => {
        d.sessions[0].attachments = [{ byte_length: 10n }];
      },
      "/sessions/0/attachments/0/byte_length",
      "json",
    ],
    [
      "NaN",
      (d) => {
        d.sessions[0].messages[0].index = Number.NaN;
      },
      "/sessions/0/messages/0/index",
      "json",
    ],
    [
      "Infinity",
      (d) => {
        d.sessions[1].attachments[0].byte_length = Number.POSITIVE_INFINITY;
      },
      "/sessions/1/attachments/0/byte_length",
      "json",
    ],
    [
      "a Date",
      (d) => {
        d.sessions[0].created_at = new Date(0);
      },
      "/sessions/0/created_at",
      "json",
    ],
    [
      "a Map",
      (d) => {
        d.sessions[4].x_capture = new Map([["a", 1]]);
      },
      "/sessions/4/(property 13)",
      "json",
    ],
    [
      "a typed array",
      (d) => {
        d.sessions[1].attachments[0].data_base64 = new Uint8Array(4);
      },
      "/sessions/1/attachments/0/data_base64",
      "json",
    ],
    [
      "a boxed string",
      (d) => {
        d.sessions[0].title = Object("boxed");
      },
      "/sessions/0/title",
      "json",
    ],
    [
      "an instance of a class",
      (d) => {
        d.projects[0] = new (class Project {
          id = "x";
        })();
      },
      "/projects/0",
      "json",
    ],
    [
      "undefined in an array",
      (d) => {
        d.sessions[0].tags = ["a", undefined];
      },
      "/sessions/0/tags/1",
      "json",
    ],
    [
      "a hole in an array",
      (d) => {
        d.sessions[0].messages[0].segments = new Array(3);
      },
      "/sessions/0/messages/0/segments/0",
      "json",
    ],
    [
      "a cycle",
      (d) => {
        d.sessions[4].x_capture.self = d.sessions[4];
      },
      "/sessions/4/(property 13)/(property 3)",
      "json",
    ],
    [
      "a cycle through the root",
      (d) => {
        d.x_self = d;
      },
      "/(property 9)",
      "json",
    ],
  ];

  for (const [name, change, path, rule] of cases) {
    it(`${name} is refused with its place`, () => {
      const document = example();
      change(document);
      for (const result of [readDocument(document), validateDocument(document)]) {
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.problems.items.map((problem) => [problem.rule, problem.path])).toContainEqual([
          rule,
          path,
        ]);
      }
      const imported = importDocument(emptyVault(), document, context());
      expect(imported.ok).toBe(false);
    });
  }

  it("a property that is undefined counts as absent, as JSON.stringify treats it", () => {
    const document = example();
    document.sessions[0].model = undefined;
    document.sessions[0].x_unset = undefined;
    document.generator = undefined;
    const read = readDocument(document);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.doc.sessions[0]?.model).toBe("");
    expect(Object.hasOwn(read.doc.sessions[0] ?? {}, "x_unset")).toBe(false);
    expect(Object.hasOwn(read.doc, "generator")).toBe(false);
    // Exactly what reading the JSON text of the value gives.
    const fromText = readDocument(JSON.stringify(document));
    expect(fromText.ok && fromText.doc).toEqual(read.doc);
  });

  it("getters that throw, and proxies that throw, give a refusal", () => {
    const withGetter = example();
    Object.defineProperty(withGetter.sessions[0], "title", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const throwing = new Proxy(example(), {
      ownKeys() {
        throw new Error("boom");
      },
      get() {
        throw new Error("boom");
      },
      getPrototypeOf() {
        throw new Error("boom");
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    // The marker itself can be read from the first; the others cannot be looked at.
    expect(isInterchangeDocument(withGetter)).toBe(true);
    expect(isInterchangeDocument(throwing)).toBe(false);
    expect(isInterchangeDocument(revoked.proxy)).toBe(false);
    for (const input of [withGetter, throwing, revoked.proxy]) {
      for (const result of [
        readDocument(input),
        validateDocument(input),
        importDocument(emptyVault(), input, context()),
      ]) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.problems.items).toEqual([expect.objectContaining({ rule: "internal", path: "" })]);
          expect(JSON.stringify(result.problems)).not.toContain("boom");
        }
      }
    }
  });

  it("an array that claims an enormous length is refused without being walked", () => {
    const document = example();
    const sparse: unknown[] = [];
    sparse.length = 4_000_000_000;
    document.sessions[0].tags = sparse;
    const started = Date.now();
    const read = readDocument(document);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(rules(read.problems.items)).toEqual(["limit"]);
  });

  it("a value that shares one object in many places is copied, not refused", () => {
    const document = example();
    const shared = { note: "shared" };
    document.sessions[0].x_a = shared;
    document.sessions[1].x_a = shared;
    document.sessions[1].x_b = [shared, shared];
    const read = readDocument(document);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.doc.sessions[1]?.x_b).toEqual([{ note: "shared" }, { note: "shared" }]);
  });

  it("a value that fans out exponentially through sharing stops at the size limit", () => {
    // 40 levels, each holding the next one twice: a trillion values when written out.
    let bomb: unknown = { leaf: true };
    for (let i = 0; i < 40; i++) bomb = [bomb, bomb];
    const document = example();
    document.sessions[0].x_bomb = bomb;
    const started = Date.now();
    const read = readDocument(document, { limits: { maxNodes: 200_000 } });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems.items).toEqual([
        { rule: "limit", path: "", message: "The input holds more than 200000 values." },
      ]);
    }
  });
});

describe("JSON text at the edges of what the platform can hold", () => {
  it("a number too large for the platform is refused rather than stored as something else", () => {
    const text = EXAMPLE_TEXT.replace('"x_pages": 1', '"x_pages": 1e400');
    expect(text).not.toBe(EXAMPLE_TEXT);
    const read = readDocument(text);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems.items).toEqual([
        {
          rule: "json",
          path: "/sessions/1/attachments/0/(property 8)",
          message: "The number is not finite.",
        },
      ]);
    }
  });

  it("a property written twice counts once, with its last value, as JSON.parse reads it", () => {
    const text = EXAMPLE_TEXT.replace('"kind": "vault",', '"kind": "session", "kind": "vault",');
    expect(text).not.toBe(EXAMPLE_TEXT);
    const read = readDocument(text);
    expect(read.ok && read.doc.kind).toBe("vault");
  });

  it("negative zero and exponents in unknown properties survive as the numbers they are", () => {
    const text = EXAMPLE_TEXT.replace('"x_pages": 1', '"x_pages": [-0, 1.5e3, 1E-7, 9007199254740991]');
    const imported = importDocument(emptyVault(), text, context());
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const exported = exportDocument(imported.vault, { kind: "vault" }, exportContext, {
      includeBytes: false,
    });
    expect(exported.ok && documentText(exported.doc)).toContain('"x_pages":[0,1500,1e-7,9007199254740991]');
  });
});

describe("deep nesting", () => {
  const nested = (depth: number): string => `${"[".repeat(depth)}1${"]".repeat(depth)}`;
  const withNesting = (depth: number): string =>
    EXAMPLE_TEXT.replace('"x_color": "green"', `"x_color": ${nested(depth)}`);

  it("far beyond the call stack is refused as too deep, as text and as a value", () => {
    const text = withNesting(200_000);
    for (const input of [text, JSON.parse(text)]) {
      for (const result of [
        readDocument(input),
        validateDocument(input),
        importDocument(emptyVault(), input, context()),
      ]) {
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.problems.items.length).toBe(1);
        expect(result.problems.items[0]).toMatchObject({
          rule: "limit",
          message: "Nested more than 128 levels deep.",
        });
        // x_color is the fifth property of the project; its name is not one the format defines.
        expect(result.problems.items[0]?.path.startsWith("/projects/1/(property 5)/0/0/0")).toBe(true);
      }
    }
  });

  it("is accepted up to the limit and refused one level beyond it", () => {
    // /projects/1/x_color is at level 4 (document, projects, project, value), so 125 arrays reach level 128.
    const atLimit = readDocument(withNesting(DEFAULT_LIMITS.maxDepth - 3));
    expect(atLimit.ok).toBe(true);
    const beyond = readDocument(withNesting(DEFAULT_LIMITS.maxDepth - 2));
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(rules(beyond.problems.items)).toEqual(["limit"]);
  });

  it("at the limit survives import, export and the text form", () => {
    const text = withNesting(DEFAULT_LIMITS.maxDepth - 3);
    const imported = importDocument(emptyVault(), text, context());
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const exported = exportDocument(imported.vault, { kind: "vault" }, exportContext, { includeBytes: true });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const written = documentText(exported.doc);
    expect(written).toContain(nested(DEFAULT_LIMITS.maxDepth - 3));
    expect(importDocument(imported.vault, written, context())).toMatchObject({
      ok: true,
      report: { counts: { unchanged: 6 } },
    });
  });

  it("can be bounded more tightly by the caller", () => {
    const tight = readDocument(EXAMPLE_TEXT, { limits: { maxDepth: 6 } });
    expect(tight.ok).toBe(false);
    if (!tight.ok) {
      expect(rules(tight.problems.items)).toContain("limit");
      expect(tight.problems.items[0]?.message).toBe("Nested more than 6 levels deep.");
    }
    // The deepest value of the example is a row of the x_table segment: level 9.
    expect(readDocument(EXAMPLE_TEXT, { limits: { maxDepth: 8 } }).ok).toBe(false);
    expect(readDocument(EXAMPLE_TEXT, { limits: { maxDepth: 9 } }).ok).toBe(true);
    const small = readDocument(EXAMPLE_TEXT, { limits: { maxNodes: 100 } });
    expect(small.ok).toBe(false);
    if (!small.ok) expect(rules(small.problems.items)).toEqual(["limit"]);
    // Nonsense limits fall back to the defaults.
    expect(
      readDocument(EXAMPLE_TEXT, { limits: { maxDepth: Number.NaN, maxNodes: -1, maxListed: 0 } }).ok,
    ).toBe(true);
  });
});

describe("huge strings", () => {
  const MEGA = 4_000_000;

  it("in every kind of field are handled in time", () => {
    const big = "a".repeat(MEGA);
    const changes: [string, (document: ReturnType<typeof example>) => void, boolean][] = [
      [
        "title",
        (d) => {
          d.sessions[0].title = big;
        },
        true,
      ],
      [
        "summary",
        (d) => {
          d.sessions[0].summary = `${big}\r\n${big}`;
        },
        true,
      ],
      [
        "text with CR LF on every line",
        (d) => {
          d.sessions[0].messages[0].segments[0].text = "line\r\n".repeat(MEGA / 8);
        },
        true,
      ],
      [
        "text of NULs",
        (d) => {
          d.sessions[0].messages[0].segments[0].text = "\u0000".repeat(MEGA);
        },
        true,
      ],
      [
        "text of lone surrogates",
        (d) => {
          d.sessions[0].messages[0].segments[0].text = "\uD800".repeat(MEGA / 4);
        },
        true,
      ],
      [
        "tag",
        (d) => {
          d.sessions[0].tags = [big];
        },
        true,
      ],
      [
        "tag of commas",
        (d) => {
          d.sessions[0].tags = [",".repeat(MEGA / 4)];
        },
        true,
      ],
      [
        "tag of hashes and spaces",
        (d) => {
          d.sessions[0].tags = ["# ".repeat(MEGA / 4)];
        },
        true,
      ],
      // corrections.md 2, G2: a provider or a role of more than 200 characters is refused before
      // any normalisation, also when trimming would leave nothing.
      [
        "provider of spaces",
        (d) => {
          d.sessions[0].provider = " ".repeat(MEGA);
        },
        false,
      ],
      [
        "role",
        (d) => {
          d.sessions[0].messages[0].role = big;
        },
        false,
      ],
      [
        "project name of spaces",
        (d) => {
          d.projects[0].name = " ".repeat(MEGA);
        },
        false,
      ],
      [
        "id",
        (d) => {
          d.sessions[0].id = "A".repeat(MEGA);
        },
        false,
      ],
      [
        "timestamp",
        (d) => {
          d.sessions[0].created_at = "2".repeat(MEGA);
        },
        false,
      ],
      [
        "sha256",
        (d) => {
          d.sessions[1].attachments[0].sha256 = "a".repeat(MEGA);
        },
        false,
      ],
      [
        "media type without a slash",
        (d) => {
          d.sessions[1].attachments[0].media_type = big;
        },
        false,
      ],
      [
        "media type of slashes",
        (d) => {
          d.sessions[1].attachments[0].media_type = "/".repeat(MEGA);
        },
        false,
      ],
      [
        "file name",
        (d) => {
          d.sessions[1].attachments[0].filename = `${big}/`;
        },
        false,
      ],
      [
        "base64 that is not the attachment",
        (d) => {
          d.sessions[1].attachments[0].data_base64 = "A".repeat(MEGA);
        },
        true,
      ],
      [
        "base64 of padding",
        (d) => {
          d.sessions[1].attachments[0].data_base64 = "=".repeat(MEGA);
        },
        true,
      ],
      [
        "unknown property",
        (d) => {
          d.sessions[0].x_big = { [big.slice(0, 100_000)]: big };
        },
        true,
      ],
      [
        "kind of an attachment",
        (d) => {
          d.sessions[1].attachments[0].kind = big;
        },
        true,
      ],
    ];
    for (const [name, change, acceptable] of changes) {
      const document = example();
      change(document);
      const started = Date.now();
      const read = readDocument(document);
      const strict = validateDocument(document);
      const elapsed = Date.now() - started;
      expect(elapsed, name).toBeLessThan(4000);
      expect(read.ok, name).toBe(acceptable);
      expect(typeof strict.ok, name).toBe("boolean");
      if (!read.ok) expect(read.problems.items.length, name).toBeGreaterThan(0);
    }
  }, 120_000);

  it("a tag of four million characters is normalised, not rejected", () => {
    const document = example();
    document.sessions[0].tags = [`  #${"Tag".repeat(1_000_000)}  `, "x"];
    const read = readDocument(document);
    expect(read.ok && read.doc.sessions[0]?.tags[0]?.length).toBe(3_000_000);
    expect(read.ok && read.doc.sessions[0]?.tags[1]).toBe("x");
  });

  it("an unknown property name of a megabyte is not quoted in a path", () => {
    const document = example();
    document.sessions[0][`key-${"k".repeat(1_000_000)}`] = "\u0000";
    const strict = validateDocument(document);
    expect(strict.problems.items).toEqual([
      {
        rule: "R9",
        path: "/sessions/0/(property 15)",
        message: "The string contains U+0000 or a lone surrogate.",
      },
    ]);
  });
});

describe("many problems", () => {
  it("are counted in full and listed up to the limit", () => {
    const document = example();
    document.sessions = Array.from({ length: 20_000 }, () => null);
    const read = readDocument(document);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems.total).toBe(20_000);
    expect(read.problems.items.length).toBe(DEFAULT_LIMITS.maxListed);
    expect(read.problems.items[0]).toEqual({
      rule: "schema",
      keyword: "type",
      path: "/sessions/0",
      message: "Expected an object, found null.",
    });
    const few = readDocument(document, { limits: { maxListed: 3 } });
    expect(!few.ok && [few.problems.items.length, few.problems.total]).toEqual([3, 20_000]);
  });

  it("repairs are counted in full and listed up to the limit", () => {
    const document = example();
    const one = document.sessions[3];
    document.sessions = Array.from({ length: 3000 }, (_unused, i) => ({
      ...one,
      id: `5E550000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const read = readDocument(document);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.repairs.total).toBe(3000);
    expect(read.repairs.counts).toEqual({ id_lowercased: 3000 });
    expect(read.repairs.items.length).toBe(DEFAULT_LIMITS.maxListed);
  });
});

describe("ten thousand sessions", () => {
  const COUNT = 10_000;
  const id = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

  function manySessions(): Record<string, unknown> {
    const document = example();
    const template = document.sessions[0];
    document.sessions = Array.from({ length: COUNT }, (_unused, i) => ({
      ...template,
      id: id("5e550000", i),
      title: `Session ${i}`,
      messages: template.messages.map((message: Record<string, unknown>, m: number) => ({
        ...message,
        id: id(`0e55${String(m).padStart(4, "0")}`, i),
      })),
    }));
    return document;
  }

  it("are read, imported, imported again and exported in time", () => {
    const document = manySessions();
    const started = Date.now();
    const read = readDocument(document);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.doc.sessions.length).toBe(COUNT);
    expect(read.repairs.total).toBe(0);

    const first = importDocument(emptyVault(), document, context());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.report.counts).toMatchObject({ added: COUNT, projectsAdded: 3 });
    expect(first.vault.sessions.length).toBe(COUNT);

    const second = importDocument(first.vault, document, context());
    expect(second.ok && second.report.counts).toMatchObject({ unchanged: COUNT, added: 0 });

    const exported = exportDocument(first.vault, { kind: "vault" }, exportContext, { includeBytes: false });
    expect(exported.ok && exported.doc.sessions.length).toBe(COUNT);
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 120_000);

  it("with one duplicated id among them are refused, naming the duplicate", () => {
    const document = manySessions();
    const sessions = document.sessions as { id: string; messages: unknown[] }[];
    const last = sessions[COUNT - 1];
    if (last === undefined) throw new Error("no sessions");
    last.id = id("5e550000", 17);
    last.messages = [];
    const read = readDocument(document);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems.items).toEqual([
        { rule: "R2", path: `/sessions/${COUNT - 1}/id`, message: "Another session has the same id." },
      ]);
    }
  }, 120_000);

  it("all with the same id are refused with every duplicate counted", () => {
    const document = example();
    const one = { ...document.sessions[3] };
    document.sessions = Array.from({ length: COUNT }, () => one);
    const read = readDocument(document);
    expect(!read.ok && read.problems.total).toBe(COUNT - 1);
    expect(!read.ok && rules(read.problems.items)).toEqual(["R2"]);
  }, 120_000);
});

describe("one session with tens of thousands of parts", () => {
  it("40,000 attachments with inline bytes are read, imported and exported in time", () => {
    const COUNT = 40_000;
    const document = example();
    const session = document.sessions[3];
    session.attachments = Array.from({ length: COUNT }, (_unused, i) => {
      const bytes = new Uint8Array([i & 255, (i >> 8) & 255, 7]);
      return {
        kind: "file",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        media_type: "application/octet-stream",
        byte_length: 3,
        data_base64: Buffer.from(bytes).toString("base64"),
      };
    });
    const started = Date.now();
    const first = importDocument(emptyVault(), document, context());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // These, and the two inline attachments the example has anyway.
    expect(first.report.counts.blobsStored).toBe(COUNT + 2);
    const again = importDocument(first.vault, document, context());
    expect(again.ok && again.report.counts).toMatchObject({ unchanged: 6, blobsStored: 0 });
    const exported = exportDocument(first.vault, { kind: "vault" }, exportContext, { includeBytes: true });
    expect(exported.ok && exported.warnings.total).toBe(0);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("40,000 messages and 40,000 segments in one message are read and imported in time", () => {
    const COUNT = 40_000;
    const id = (n: number): string => `0e55a9e0-0004-4000-8000-${String(n).padStart(12, "0")}`;
    const document = example();
    document.sessions[3].messages = Array.from({ length: COUNT }, (_unused, i) => ({
      id: id(i),
      index: COUNT - 1 - i,
      role: "user",
      segments: [{ type: "text", text: `message ${i}` }],
    }));
    document.sessions[5].messages[0].segments = Array.from({ length: COUNT }, (_unused, i) => ({
      type: "text",
      text: `part ${i}`,
    }));
    const started = Date.now();
    const first = importDocument(emptyVault(), document, context());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const big = first.vault.sessions.find((candidate) => candidate.id === document.sessions[3].id);
    expect(big?.message_count).toBe(COUNT);
    // Repair 6 put them in the order of their indexes.
    expect(big?.messages[0]?.text).toBe(`message ${COUNT - 1}`);
    const merged = first.vault.sessions.find((candidate) => candidate.id === document.sessions[5].id);
    // Repair 7 made one text segment of them.
    expect(merged?.messages[0]?.segments).toBeNull();
    expect(merged?.messages[0]?.text.split("\n\n").length).toBe(COUNT);
    expect(first.report.repairs.counts).toEqual({ messages_renumbered: 1, segments_merged: 1 });
    const again = importDocument(first.vault, document, context());
    expect(again.ok && again.report.counts).toMatchObject({ unchanged: 6 });
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("40,000 tags and 40,000 projects are read in time", () => {
    const COUNT = 40_000;
    const document = example();
    document.sessions[0].tags = Array.from({ length: COUNT }, (_unused, i) => `Tag ${i % 20_000}`);
    document.projects = Array.from({ length: COUNT }, (_unused, i) => ({
      id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Project ${i % 30_000}`,
      created_at: "2026-03-01T10:00:00.000Z",
    }));
    const started = Date.now();
    const read = readDocument(document);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.doc.sessions[0]?.tags.length).toBe(20_000);
    expect(read.warnings.counts).toEqual({ R11: 10_000 });
    const imported = importDocument(emptyVault(), document, context());
    expect(imported.ok && imported.report.counts).toMatchObject({
      projectsAdded: 30_000,
      projectsMerged: 10_000,
    });
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});

describe("never throws", () => {
  const anything = fc.anything({
    withBigInt: true,
    withBoxedValues: true,
    withDate: true,
    withMap: true,
    withNullPrototype: true,
    withObjectString: true,
    withSet: true,
    withSparseArray: true,
    withTypedArray: true,
    withUnicodeString: true,
    maxDepth: 4,
  });

  const settle = (input: unknown): void => {
    const read = readDocument(input);
    expect(typeof read.ok).toBe("boolean");
    if (!read.ok) {
      expect(read.problems.total).toBeGreaterThan(0);
      expect(read.problems.items.length).toBeGreaterThan(0);
      for (const problem of read.problems.items) {
        expect(typeof problem.rule).toBe("string");
        expect(typeof problem.path).toBe("string");
        expect(problem.message.length).toBeGreaterThan(0);
      }
    }
    const strict = validateDocument(input);
    expect(typeof strict.ok).toBe("boolean");
    expect(strict.ok).toBe(strict.problems.total === 0);
    // What needs no repair is acceptable to the reader.
    if (strict.ok) expect(read.ok).toBe(true);
    expect(typeof isInterchangeDocument(input)).toBe("boolean");
    const imported = importDocument(emptyVault(), input, context());
    expect(imported.ok).toBe(read.ok);
  };

  it("on anything at all", () => {
    fc.assert(fc.property(anything, settle), { numRuns: 1500 });
  });

  it("on any string", () => {
    fc.assert(fc.property(fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.json()), settle), {
      numRuns: 1500,
    });
  });

  it("on anything that carries the format marker", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), anything), fc.constantFrom(1, 2, "1", null), (rest, version) => {
        settle({ ...rest, format: "sessionvault-interchange", version });
      }),
      { numRuns: 1500 },
    );
  });

  it("on the example with anything put anywhere", () => {
    const paths = pathsOf(example());
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(paths.length - 1), anything), { minLength: 1, maxLength: 3 }),
        (changes) => {
          const document = example();
          for (const [at, value] of changes) {
            try {
              setAt(document, paths[at] ?? [], value);
            } catch {
              // An earlier change removed the place; the document is damaged enough.
            }
          }
          settle(document);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("on the text of the example cut off or with bytes changed", () => {
    fc.assert(
      fc.property(
        fc.nat(EXAMPLE_TEXT.length),
        fc.string({ maxLength: 5 }),
        fc.boolean(),
        (at, noise, cut) => {
          settle(
            cut
              ? EXAMPLE_TEXT.slice(0, at)
              : EXAMPLE_TEXT.slice(0, at) + noise + EXAMPLE_TEXT.slice(at + noise.length),
          );
        },
      ),
      { numRuns: 1500 },
    );
  });
});
