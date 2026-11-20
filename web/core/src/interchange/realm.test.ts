/// <reference types="node" />
// The sources run in a realm that has nothing but the ECMAScript built-ins: no process, no Buffer,
// no TextEncoder, no URL, no crypto, no timers. That is the common ground of a browser page, a web
// worker and Node, so what works here works in all three. (The engine puts a console into every
// realm; purity.test.ts makes sure the sources do not use it.)
import { readdirSync, readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as index from "./index.ts";
import {
  documentText,
  emptyVault,
  exportDocument,
  importDocument,
  readDocument,
  webGenerator,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const FOLDER = new URL("./", import.meta.url);
const EXAMPLE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(
  readFileSync(new URL("../../../docs/example-vault-export.json", import.meta.url)),
);

type Factory = (exports: object, load: (specifier: string) => object) => void;

/** Load the module's index inside a fresh realm and return its exports. */
function loadInBareRealm(): { exports: Record<string, unknown>; realm: object; names: string[] } {
  const realm = createContext({});
  const names: string[] = runInContext("Object.getOwnPropertyNames(globalThis)", realm);
  const factories = new Map<string, Factory>();
  for (const file of readdirSync(FOLDER)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    // Types stripped and import/export turned into calls: the code itself is unchanged.
    const { outputText } = ts.transpileModule(readFileSync(new URL(file, FOLDER), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        verbatimModuleSyntax: false,
      },
      fileName: file,
    });
    factories.set(
      `./${file}`,
      runInContext(`(function (exports, require) {${outputText}\n})`, realm, { filename: file }),
    );
  }
  const loaded = new Map<string, object>();
  const load = (specifier: string): object => {
    const ready = loaded.get(specifier);
    if (ready !== undefined) return ready;
    const factory = factories.get(specifier);
    if (factory === undefined)
      throw new Error(`a source imports ${specifier}, which is not a file of this folder`);
    const exports = {};
    loaded.set(specifier, exports);
    factory(exports, load);
    return exports;
  };
  return { exports: Object.fromEntries(Object.entries(load("./index.ts"))), realm, names };
}

describe("in a realm with only the ECMAScript built-ins", () => {
  const bare = loadInBareRealm();

  it("there is no platform object to lean on", () => {
    for (const name of [
      "process",
      "Buffer",
      "require",
      "window",
      "document",
      "TextEncoder",
      "TextDecoder",
      "URL",
      "crypto",
      "setTimeout",
      "atob",
      "btoa",
      "structuredClone",
      "fetch",
    ]) {
      expect(bare.names, name).not.toContain(name);
    }
    expect(bare.names).toContain("JSON");
    expect(bare.names).toContain("Uint8Array");
  });

  it("the module loads and exports what it exports in Node", () => {
    expect(Object.keys(bare.exports).sort()).toEqual(Object.keys(index).sort());
    expect(Object.keys(bare.exports).length).toBeGreaterThan(40);
  });

  it("the example imports, exports and round-trips with the same result as in Node", () => {
    // The whole exchange runs inside the bare realm; only text goes in and comes out.
    const driver = `(function (api, text) {
      let n = 0;
      const context = { now: new Date(1795161600000), newId: () => "ffffffff-ffff-4fff-8fff-" + String(++n).padStart(12, "0") };
      const first = api.importDocument(api.emptyVault(), text, context);
      if (!first.ok) return JSON.stringify({ failed: first.problems });
      const exported = api.exportDocument(first.vault, { kind: "vault" }, { now: context.now, generator: api.webGenerator("0.1.0") }, { includeBytes: true });
      if (!exported.ok) return JSON.stringify({ failed: exported.problems });
      const second = api.importDocument(first.vault, api.documentText(exported.doc), context);
      const hostile = api.readDocument('{"format":"sessionvault-interchange","version":1,"__proto__":{"polluted":true},"sessions":5}');
      return JSON.stringify({
        counts: first.report.counts,
        again: second.ok ? second.report.counts : null,
        text: api.documentText(exported.doc),
        sizes: first.vault.sessions.map((session) => [session.message_count, session.text_bytes]),
        blobs: [...first.vault.blobs.keys()].sort(),
        check: api.checkVault(first.vault).ok,
        hostile: hostile.ok ? null : hostile.problems.items.map((problem) => problem.rule + " " + problem.path),
        polluted: {}.polluted === undefined ? "no" : "yes",
      });
    })`;
    const run: (api: object, text: string) => string = runInContext(driver, bare.realm);
    const inside = JSON.parse(run(bare.exports, EXAMPLE_TEXT));

    let n = 0;
    const context = {
      now: new Date(1795161600000),
      newId: () => `ffffffff-ffff-4fff-8fff-${String(++n).padStart(12, "0")}`,
    };
    const first = importDocument(emptyVault(), EXAMPLE_TEXT, context);
    if (!first.ok) throw new Error("the example must import");
    const exported = exportDocument(
      first.vault,
      { kind: "vault" },
      { now: context.now, generator: webGenerator("0.1.0") },
      { includeBytes: true },
    );
    if (!exported.ok) throw new Error("the example must export");

    expect(inside.failed).toBeUndefined();
    expect(inside.counts).toEqual(first.report.counts);
    expect(inside.again).toMatchObject({ unchanged: 6, added: 0, updated: 0, kept: 0 });
    expect(inside.text).toBe(documentText(exported.doc));
    expect(inside.sizes).toEqual([
      [4, 166],
      [1, 162],
      [4, 283],
      [0, 0],
      [3, 111],
      [2, 59],
    ]);
    expect(inside.blobs).toEqual([...first.vault.blobs.keys()].sort());
    expect(inside.check).toBe(true);
    expect(inside.hostile).toEqual([
      "schema /kind",
      "schema /exported_at",
      "schema /projects",
      "schema /sessions",
    ]);
    expect(inside.polluted).toBe("no");
  });

  it("a value parsed in another realm is read like one parsed here", () => {
    const foreign: unknown = runInContext("(text) => JSON.parse(text)", bare.realm)(EXAMPLE_TEXT);
    // Its objects have the other realm's Object.prototype.
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
    const fromForeign = readDocument(foreign);
    const fromHere = readDocument(JSON.parse(EXAMPLE_TEXT));
    expect(fromForeign.ok).toBe(true);
    expect(fromForeign.ok && fromHere.ok && JSON.stringify(fromForeign.doc)).toBe(
      fromHere.ok && JSON.stringify(fromHere.doc),
    );
  });
});
