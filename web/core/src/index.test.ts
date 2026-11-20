/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as importer from "./import/index.ts";
import * as core from "./index.ts";
import {
  APP_NAME,
  describeBuild,
  formatBuildLabel,
  INTERCHANGE_FORMAT,
  INTERCHANGE_VERSION,
} from "./index.ts";
import * as interchange from "./interchange/index.ts";
import * as vault from "./vault/index.ts";

describe("build description", () => {
  it("names the product and keeps version and build", () => {
    const info = describeBuild("1.2.3", "abc1234");
    expect(info).toEqual({ name: "SessionVault", version: "1.2.3", build: "abc1234" });
    expect(formatBuildLabel(info)).toBe("SessionVault 1.2.3 (build abc1234)");
  });

  it("falls back when the version or the build is unknown", () => {
    expect(describeBuild("  ", "")).toEqual({ name: APP_NAME, version: "0.0.0", build: "dev" });
  });

  it("speaks version 1 of the interchange format", () => {
    expect(INTERCHANGE_VERSION).toBe(1);
    expect(INTERCHANGE_FORMAT).toBe("sessionvault-interchange");
  });
});

// ---------------------------------------------------------------------------------------------
// The public API: everything the three parts export, under the names the header of index.ts gives.
// ---------------------------------------------------------------------------------------------

interface Exported {
  /** The name as the module that declares it exports it. */
  readonly original: string;
  /** The name it is exported under. */
  readonly name: string;
  readonly kind: "type" | "value";
}

/** The `export { ... } from "<specifier>"` lists of a file, by specifier. */
function reExports(file: URL): Map<string, Exported[]> {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file.pathname, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const bySpecifier = new Map<string, Exported[]>();
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier))
      throw new Error("an export without a source");
    // `export *` would hide a name two parts share; every name is listed.
    if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) {
      throw new Error(`${file.pathname} has an export that does not list its names`);
    }
    const list = bySpecifier.get(specifier.text) ?? [];
    for (const element of statement.exportClause.elements) {
      list.push({
        original: (element.propertyName ?? element.name).text,
        name: element.name.text,
        kind: statement.isTypeOnly || element.isTypeOnly ? "type" : "value",
      });
    }
    bySpecifier.set(specifier.text, list);
  }
  return bySpecifier;
}

/** Everything a part exports from its own index, whatever file of the part declares it. */
function exportsOf(part: string): Exported[] {
  const lists = [...reExports(new URL(`./${part}/index.ts`, import.meta.url)).values()];
  return lists.flat().sort((a, b) => (a.name < b.name ? -1 : 1));
}

const CORE = reExports(new URL("./index.ts", import.meta.url));

function coreExportsFrom(part: string): Exported[] {
  return [...(CORE.get(`./${part}/index.ts`) ?? [])].sort((a, b) => (a.original < b.original ? -1 : 1));
}

/** The four names that differ, and the two the interchange module shares with the vault functions. */
const RENAMED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  import: { JsonObject: "ParsedJsonObject" },
  interchange: { FORMAT_MARKER: "INTERCHANGE_FORMAT", FORMAT_VERSION: "INTERCHANGE_VERSION" },
  vault: {},
};
const LEFT_OUT: Readonly<Record<string, readonly string[]>> = {
  import: [],
  // Exported from ./vault/ instead: the same values, in bounded time.
  interchange: ["parseTags", "projectNameKey"],
  vault: [],
};

describe("the index of the package exports the public API of the three parts", () => {
  it("from exactly the three parts", () => {
    expect([...CORE.keys()].sort()).toEqual([
      "./import/index.ts",
      "./interchange/index.ts",
      "./vault/index.ts",
    ]);
  });

  it.each(["import", "interchange", "vault"])(
    "every name of ./%s/, as a type or as a value as it is there",
    (part) => {
      const expected = exportsOf(part)
        .filter((item) => !(LEFT_OUT[part] ?? []).includes(item.name))
        .map((item) => ({
          original: item.name,
          name: RENAMED[part]?.[item.name] ?? item.name,
          kind: item.kind,
        }))
        .sort((a, b) => (a.original < b.original ? -1 : 1));
      expect(coreExportsFrom(part)).toEqual(expected);
    },
  );

  it("how many: 19 values and 24 types of the importer, 54 and 54 of the interchange module, 30 and 21 of the vault functions", () => {
    const count = (part: string, kind: "type" | "value"): number =>
      coreExportsFrom(part).filter((item) => item.kind === kind).length;
    expect([count("import", "value"), count("import", "type")]).toEqual([19, 24]);
    expect([count("interchange", "value"), count("interchange", "type")]).toEqual([54, 54]);
    expect([count("vault", "value"), count("vault", "type")]).toEqual([30, 21]);
  });

  it("no name is exported twice", () => {
    const names = [...CORE.values()].flat().map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
    for (const own of ["APP_NAME", "BuildInfo", "describeBuild", "formatBuildLabel"])
      expect(names).not.toContain(own);
  });

  it("at run time every value is the very function or constant of its part", () => {
    const parts: Readonly<Record<string, object>> = { import: importer, interchange, vault };
    let checked = 0;
    for (const [part, module] of Object.entries(parts)) {
      for (const item of coreExportsFrom(part)) {
        if (item.kind !== "value") continue;
        expect(Reflect.get(core, item.name), item.name).toBe(Reflect.get(module, item.original));
        expect(Reflect.get(core, item.name), item.name).toBeDefined();
        checked += 1;
      }
    }
    expect(checked).toBe(19 + 54 + 30);
    // With the three of the package itself, that is all there is.
    expect(Object.keys(core).sort()).toEqual(
      [
        "APP_NAME",
        "describeBuild",
        "formatBuildLabel",
        ...["import", "interchange", "vault"].flatMap((part) =>
          coreExportsFrom(part)
            .filter((item) => item.kind === "value")
            .map((item) => item.name),
        ),
      ].sort(),
    );
  });

  it("the two names two parts share are the functions of ./vault/, which return what the others return", () => {
    expect(core.parseTags).toBe(vault.parseTags);
    expect(core.projectNameKey).toBe(vault.projectNameKey);
    expect(core.parseTags).not.toBe(interchange.parseTags);
    for (const field of ["Garden, Bikes ,, garden,  Two Words , #hash", "", "# #a, A, a", ",,"]) {
      expect(core.parseTags(field)).toEqual(interchange.parseTags(field));
    }
    for (const name of ["  Garden ", `CAFE${String.fromCodePoint(0x301)}`, "", "Bike  workshop"]) {
      expect(core.projectNameKey(name)).toBe(interchange.projectNameKey(name));
    }
  });
});

describe("the pipeline through the index: a conversation into the vault, and its context out again", () => {
  const NOW = new Date("2026-11-20T08:00:00.000Z");
  const ids = (prefix: string): (() => string) => {
    let n = 0;
    return () => `${prefix}-${String(++n).padStart(12, "0")}`;
  };

  it("a transcript file, a paste and an interchange file end in one vault; a context pack comes out", () => {
    // A transcript file.
    const file = core.openFile(
      new TextEncoder().encode("User: How deep do I plant garlic?\n\nAssistant: Five centimetres."),
      "garlic.txt",
    );
    if (file.route !== "transcript" || file.result.outcome !== "imported")
      throw new Error("the file was not imported");
    let state = core.addParsedSessions(core.emptyVault(), file.result.sessions, {
      now: NOW,
      newId: ids("eeeeeeee-eeee-4eee-8eee"),
    }).vault;

    // A paste.
    const paste = core.importPaste("You: And onions?\nClaude: The same.", {
      title: "Onions",
      pickerProvider: "claude",
    });
    if (paste.outcome !== "imported") throw new Error("the paste was not imported");
    state = core.addParsedSessions(state, paste.sessions, {
      now: new Date(NOW.getTime() + 60_000),
      newId: ids("dddddddd-dddd-4ddd-8ddd"),
    }).vault;

    // An interchange file: the export of the vault itself, with one more session.
    const exported = core.exportDocument(
      state,
      { kind: "vault" },
      { now: NOW, generator: core.webGenerator("0.0.0-test") },
      { includeBytes: true },
    );
    if (!exported.ok) throw new Error("the vault was not exported");
    const text = core.documentText(exported.doc);
    if (text === null) throw new Error("the export was too long");
    const opened = core.openFile(new TextEncoder().encode(text), core.suggestedFileName(exported.doc));
    if (opened.route !== "interchange" || !opened.result.ok) throw new Error("the export was not read");
    const merged = core.importDocument(state, opened.json, {
      now: NOW,
      newId: ids("ffffffff-ffff-4fff-8fff"),
    });
    if (!merged.ok) throw new Error("the export was not merged");
    expect(merged.report.counts).toMatchObject({ unchanged: 2, added: 0 });
    state = merged.vault;

    expect(core.checkVault(state).ok).toBe(true);
    const listed = core.listSessions(state.sessions, { kind: "all" });
    expect(listed.map((session) => session.title)).toEqual(["Onions", "garlic"]);
    expect(
      core.listSessions(state.sessions, { kind: "all" }, " GARLIC ").map((session) => session.title),
    ).toEqual(["garlic"]);
    expect(core.timelineGroups(state.sessions, "en-US", "UTC").map((group) => group.key)).toEqual([
      "November 2026",
    ]);

    const garlic = listed[1];
    if (garlic === undefined) throw new Error("the session is missing");
    expect(core.sessionContextPack(garlic, { timeZone: "UTC" })).toBe(
      "# Context pack: garlic\n" +
        "\n" +
        "Origin: Other, saved Nov 20, 2026\n" +
        "\n" +
        "You are being given the transcript of an earlier conversation the user had\n" +
        "with another AI assistant. Read it, treat its decisions and facts as established\n" +
        "context, and continue helping from where it left off.\n" +
        "\n" +
        "## Transcript\n" +
        "\n" +
        "**User:**\n\nHow deep do I plant garlic?\n\n---\n" +
        "\n" +
        "**Assistant:**\n\nFive centimetres.\n\n---\n",
    );
  });
});

describe("the package as the server loads it", () => {
  it("runs under Node directly by its package name: type stripping only, no build step", {
    timeout: 120_000,
  }, () => {
    // From the folder of the server, as `node server/src/main.ts` resolves it.
    const script = `
      const core = await import("@sessionvault/core");
      const opened = core.openFile(new TextEncoder().encode("User: hello\\nAssistant: hi"), "chat.txt");
      const sessions = core.createSessions(opened.result.sessions, {
        now: new Date(0),
        newId: (() => { let n = 0; return () => "eeeeeeee-eeee-4eee-8eee-" + String(++n).padStart(12, "0"); })(),
      });
      const pack = core.sessionContextPack(sessions[0], { timeZone: "UTC" });
      console.log(JSON.stringify({
        values: Object.keys(core).length,
        label: core.formatBuildLabel(core.describeBuild("1.0.0", "abc")),
        format: core.INTERCHANGE_FORMAT,
        version: core.INTERCHANGE_VERSION,
        route: opened.route,
        roles: sessions[0].messages.map((message) => message.role),
        packLines: pack.split("\\n").length,
        empty: core.checkVault(core.emptyVault()).ok,
      }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: fileURLToPath(new URL("../../server/", import.meta.url)),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({
      values: 3 + 19 + 54 + 30,
      label: "SessionVault 1.0.0 (build abc)",
      format: "sessionvault-interchange",
      version: 1,
      route: "transcript",
      roles: ["user", "assistant"],
      // Ten lines of the template and six for each of the two messages.
      packLines: 22,
      empty: true,
    });
  });
});
