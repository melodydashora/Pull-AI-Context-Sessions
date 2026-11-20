/// <reference types="node" />
// Every non-test file of this folder, and the package's index beside it, must run unchanged in a
// browser, in a web worker and in Node (HANDOFF.md: the core has no DOM and no Node dependencies),
// and must be a pure function of its arguments. The compiler cannot enforce that, because the test
// files bring the Node types into the same project. So this test reads the sources themselves:
// their whole text for the words that must not occur at all, and their syntax tree for the rest.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const FOLDER = new URL("./", import.meta.url);
const CORE_INDEX = new URL("../index.ts", import.meta.url);

interface Source {
  /** Name for messages. */
  readonly name: string;
  readonly url: URL;
  /** What the file may import. */
  readonly allowed: RegExp;
}

// A file of this folder imports its siblings and files of the two modules it builds on.
const VAULT_IMPORTS = /^(\.\/[a-z-]+\.ts|\.\.\/(import|interchange)\/[a-z0-9-]+\.ts)$/;
// The index of the package imports the three modules and nothing else.
const INDEX_IMPORTS = /^\.\/(import|interchange|vault)\/index\.ts$/;

const VAULT_SOURCES = readdirSync(FOLDER)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .sort();

const SOURCES: readonly Source[] = [
  ...VAULT_SOURCES.map((name) => ({ name, url: new URL(name, FOLDER), allowed: VAULT_IMPORTS })),
  { name: "../index.ts", url: CORE_INDEX, allowed: INDEX_IMPORTS },
];

/** What must not occur anywhere in a source, comments included: a search of the text has no blind spots. */
const FORBIDDEN_TEXT: readonly (readonly [rule: string, pattern: RegExp])[] = [
  ["an import from node:", /["']node:/],
  ["Buffer", /\bBuffer\b/],
  ["process", /\bprocess\b/],
  ["window", /\bwindow\b/],
  ["document", /\bdocument\b/],
  ["require()", /\brequire\s*\(/],
  ["a suppressed type error", /@ts-ignore|@ts-expect-error|@ts-nocheck/],
  ["a character that is not printable ASCII or a line feed", /[^\n -~]/],
];

/** Names that exist on one platform only, or that do input or output, or that read a clock. */
const PLATFORM_NAMES = new Set([
  "globalThis",
  "global",
  "self",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "console",
  "alert",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "performance",
  "crypto",
  "atob",
  "btoa",
  "eval",
  "Function",
]);

/** The clock and randomness: the functions here take the time and new ids as arguments. */
const IMPURE_ACCESS = ["Date.now", "Math.random"];

function textFindings(text: string): string[] {
  return FORBIDDEN_TEXT.filter(([, pattern]) => pattern.test(text)).map(([rule]) => rule);
}

function syntaxFindings(name: string, text: string, allowed: RegExp): string[] {
  const findings: string[] = [];
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const report = (node: ts.Node, what: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    findings.push(`${line}: ${what}`);
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !allowed.test(node.moduleSpecifier.text)
    ) {
      report(node, `the import "${node.moduleSpecifier.text}"`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, "a dynamic import");
    }
    if (ts.isIdentifier(node) && PLATFORM_NAMES.has(node.text)) report(node, `the name "${node.text}"`);
    if (ts.isPropertyAccessExpression(node) && IMPURE_ACCESS.includes(node.getText(source))) {
      report(node, node.getText(source));
    }
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(source) === "Date" &&
      (node.arguments?.length ?? 0) === 0
    ) {
      report(node, "new Date() without an argument (the clock)");
    }
    // Erasable syntax only: Node runs these files by stripping the types.
    if (ts.isEnumDeclaration(node)) report(node, "an enum");
    if (ts.isModuleDeclaration(node)) report(node, "a namespace");
    if (ts.isDecorator(node)) report(node, "a decorator");
    if (
      ts.isParameter(node) &&
      ts.isConstructorDeclaration(node.parent) &&
      (ts.getModifiers(node)?.length ?? 0) > 0
    ) {
      report(node, "a parameter property");
    }
    // Types are stated honestly: no "any", no assertion that stands in for a check.
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, "the type any");
    if (ts.isAsExpression(node) && node.type.getText(source) !== "const") report(node, "a type assertion");
    if (ts.isTypeAssertionExpression(node)) report(node, "a type assertion");
    if (ts.isNonNullExpression(node)) report(node, "a non-null assertion");
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function findings(source: Source): string[] {
  const text = readFileSync(source.url, "utf8");
  return [...textFindings(text), ...syntaxFindings(source.name, text, source.allowed)];
}

describe("the non-test sources of the vault functions and the index of the package", () => {
  it("are all found", () => {
    expect(VAULT_SOURCES).toEqual([
      "compose.ts",
      "context-pack.ts",
      "create-session.ts",
      "index.ts",
      "lists.ts",
      "open-file.ts",
      "order.ts",
      "projects.ts",
      "search.ts",
      "tags.ts",
      "timeline.ts",
    ]);
  });

  it.each(SOURCES)(
    "$name imports nothing from node: and uses no Buffer, process, window or document, no clock and no randomness",
    (source) => {
      expect(findings(source)).toEqual([]);
    },
  );

  it("the tests of this folder are plain ASCII with LF line endings: every other character is written as an escape", () => {
    // An invisible character (a no-break space, a combining accent, a byte-order mark) must be
    // visible in a file whose tests depend on it, and safe from tools that normalise text.
    const unusual: string[] = [];
    const files = [
      ...readdirSync(FOLDER)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => new URL(name, FOLDER)),
      CORE_INDEX,
      new URL("../index.test.ts", import.meta.url),
    ];
    for (const file of files) {
      const bytes = readFileSync(file);
      bytes.forEach((byte, index) => {
        if (byte > 126 || (byte < 32 && byte !== 10)) unusual.push(`${file.pathname} byte ${index}: ${byte}`);
      });
    }
    expect(unusual).toEqual([]);
  });

  it("the check itself notices what it is there for", () => {
    const text: Record<string, string> = {
      'import { readFileSync } from "node:fs";': "an import from node:",
      "const fs = await import('node:fs');": "an import from node:",
      "const a = Buffer.from([]);": "Buffer",
      "const b = process.env.HOME;": "process",
      "const c = window.location;": "window",
      "const d = document.title;": "document",
      "// even a comment about the document": "document",
      'const e = require("fs");': "require()",
      "// @ts-ignore": "a suppressed type error",
      [`const f = "${String.fromCodePoint(0xe9)}";`]:
        "a character that is not printable ASCII or a line feed",
      "one\r\ntwo": "a character that is not printable ASCII or a line feed",
      "one\ttwo": "a character that is not printable ASCII or a line feed",
    };
    for (const [sample, rule] of Object.entries(text)) expect(textFindings(sample), sample).toContain(rule);

    const bad = [
      'import x from "fast-check";',
      'import { y } from "../index.ts";',
      'export * from "../server/app.ts";',
      "const a = await import('./x.ts');",
      "const b = globalThis.URL;",
      "const c = Date.now();",
      "const d = new Date();",
      "const e = Math.random();",
      "const f = crypto.randomUUID();",
      "console.log(1);",
      "enum Colour { Red }",
      "namespace N { export const x = 1; }",
      "class P { constructor(private readonly q: string) {} }",
      "const g: any = 1;",
      "const h = value as string;",
      "const i = value!;",
      "const j = <string>value;",
    ].join("\n");
    expect(syntaxFindings("bad.ts", bad, VAULT_IMPORTS)).toEqual([
      '1: the import "fast-check"',
      '2: the import "../index.ts"',
      '3: the import "../server/app.ts"',
      "4: a dynamic import",
      '5: the name "globalThis"',
      "6: Date.now",
      "7: new Date() without an argument (the clock)",
      "8: Math.random",
      '9: the name "crypto"',
      '10: the name "console"',
      "11: an enum",
      "12: a namespace",
      "13: a parameter property",
      "14: the type any",
      "15: a type assertion",
      "16: a non-null assertion",
      "17: a type assertion",
    ]);

    // What the sources do contain is not reported.
    const good = [
      'import { cleanString } from "../interchange/text.ts";',
      'import type { ParsedSession } from "../import/index.ts";',
      'import { compareIds } from "./order.ts";',
      "// a comment may name crypto.randomUUID as an example for the caller",
      "const KNOWN = [1, 2] as const;",
      "const stamp = new Date(0).toISOString();",
      'const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });',
      "export const b = compareIds(stamp, cleanString(String(KNOWN.length))) + fmt.format(0);",
    ].join("\n");
    expect([...textFindings(good), ...syntaxFindings("good.ts", good, VAULT_IMPORTS)]).toEqual([]);
    // The index of the package may import the three modules only.
    expect(syntaxFindings("index.ts", 'export { a } from "./vault/index.ts";', INDEX_IMPORTS)).toEqual([]);
    expect(syntaxFindings("index.ts", 'export { a } from "./vault/tags.ts";', INDEX_IMPORTS)).toEqual([
      '1: the import "./vault/tags.ts"',
    ]);
  });

  it("run under Node directly, as the server will load them: type stripping only, no build step", {
    timeout: 120_000,
  }, () => {
    const script = `
      const vault = await import(${JSON.stringify(new URL("index.ts", FOLDER).href)});
      const pack = vault.contextPackMarkdown(
        { title: "t", provider: "claude", model: "", source_url: "", summary: "", tags: [], created_at: new Date(0) },
        [{ role: "user", text: "hello" }],
        { timeZone: "UTC" },
      );
      const opened = vault.openFile(new TextEncoder().encode("User: hello\\nAssistant: hi"), "chat.txt");
      console.log(JSON.stringify({
        exports: Object.keys(vault).length,
        firstLine: pack.split("\\n")[0],
        route: opened.route,
        tags: vault.parseTags("A, #b"),
      }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({
      exports: 30,
      firstLine: "# Context pack: t",
      route: "transcript",
      tags: ["a", "b"],
    });
  });
});
