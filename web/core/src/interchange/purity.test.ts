/// <reference types="node" />
// Every non-test file of this folder must run unchanged in a browser, in a web worker and in
// Node (HANDOFF.md: the core has no DOM and no Node dependencies). This test parses each of them
// and fails on an import from "node:", on any import that is not a sibling file, and on any use
// of a name that only exists on one platform.
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const FOLDER = new URL("./", import.meta.url);

/**
 * Names of things that exist only in Node or only in a page, and of things that do input or output
 * or keep time. No identifier of the sources may be one of them, not even as a property name.
 */
const PLATFORM_NAMES = new Set([
  "Buffer",
  "process",
  "window",
  "document",
  "require",
  "module",
  "global",
  "__dirname",
  "__filename",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "fetch",
  "XMLHttpRequest",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "performance",
  "console",
  "alert",
  "atob",
  "btoa",
]);

/** Sources of non-determinism: the functions here take the time and new ids as arguments. */
const IMPURE_CALLS = ["Date.now", "Math.random", "crypto.randomUUID", "crypto.getRandomValues"];

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

function sourceFiles(): string[] {
  return readdirSync(FOLDER, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

function inspect(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const report = (node: ts.Node, what: string): void => {
    findings.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, what });
  };
  const checkSpecifier = (node: ts.Node, specifier: string): void => {
    if (specifier.startsWith("node:")) report(node, `import from "${specifier}"`);
    else if (!/^\.\/[a-z0-9-]+\.ts$/.test(specifier))
      report(node, `import of "${specifier}", which is not a sibling file`);
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined
    ) {
      if (ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node, node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, "dynamic import");
    }
    if (ts.isIdentifier(node) && PLATFORM_NAMES.has(node.text)) report(node, `the name "${node.text}"`);
    if (ts.isPropertyAccessExpression(node) && IMPURE_CALLS.includes(node.getText(source))) {
      report(node, `a call of ${node.getText(source)}`);
    }
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(source) === "Date" &&
      (node.arguments?.length ?? 0) === 0
    ) {
      report(node, "new Date() without an argument (the clock)");
    }
    // Messages are written for people and may be logged: they do not name platform objects either.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) {
      const word = /\b(Buffer|process|window|document)\b/.exec(node.text);
      if (word !== null && !ts.isImportDeclaration(node.parent))
        report(node, `the word "${word[0]}" in a string`);
    }
    // Erasable syntax only: Node runs these files by stripping the types.
    if (ts.isEnumDeclaration(node)) report(node, "an enum");
    if (ts.isModuleDeclaration(node)) report(node, "a namespace");
    if (
      ts.isParameter(node) &&
      ts.isConstructorDeclaration(node.parent) &&
      (ts.getModifiers(node)?.length ?? 0) > 0
    ) {
      report(node, "a parameter property");
    }
    if (ts.isDecorator(node)) report(node, "a decorator");
    ts.forEachChild(node, visit);
  };
  visit(source);
  // Belt and braces for the one rule that matters most, comments included.
  text.split("\n").forEach((line, index) => {
    if (/["']node:/.test(line)) findings.push({ file, line: index + 1, what: 'the text "node:' });
  });
  return findings;
}

describe("the sources of the interchange module", () => {
  const files = sourceFiles();

  it("are all found", () => {
    expect(files).toEqual([
      "base64.ts",
      "bundle.ts",
      "check.ts",
      "compose.ts",
      "export.ts",
      "filename.ts",
      "import.ts",
      "index.ts",
      "json.ts",
      "normalise.ts",
      "problems.ts",
      "reader.ts",
      "sha256.ts",
      "shapes.ts",
      "shared.ts",
      "text.ts",
      "timestamp.ts",
      "types.ts",
      "validate.ts",
      "vault.ts",
      "wire.ts",
    ]);
  });

  it("import nothing from node:, use no platform name, no clock, no randomness, and only erasable syntax", () => {
    const findings = files.flatMap((file) => inspect(file, readFileSync(new URL(file, FOLDER), "utf8")));
    expect(findings).toEqual([]);
  });

  it("and their tests are plain ASCII with LF line endings: every other character is written as an escape", () => {
    // Invisible characters (a no-break space, a combining accent, a byte-order mark) must be
    // visible in a file whose tests depend on them, and safe from editors that normalise text.
    const unusual: string[] = [];
    for (const file of readdirSync(FOLDER, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts")) continue;
      const bytes = readFileSync(new URL(file, FOLDER));
      bytes.forEach((byte, index) => {
        if (byte > 126 || (byte < 32 && byte !== 10)) unusual.push(`${file} byte ${index}: ${byte}`);
      });
    }
    expect(unusual).toEqual([]);
  });

  it("the check itself notices what it is there for", () => {
    const bad = [
      'import { readFileSync } from "node:fs";',
      'import x from "fast-check";',
      'import y from "../index.ts";',
      'export * from "node:path";',
      "const a = Buffer.from([]);",
      "const b = process.env.HOME;",
      "const c = window.location;",
      "const d = document.title;",
      "const e = result.document;",
      "const f = require('x');",
      "const g = await import('./x.ts');",
      "const h = Date.now();",
      "const i = new Date();",
      "const j = Math.random();",
      "const k = crypto.randomUUID();",
      "enum Colour { Red }",
      "namespace N { export const x = 1; }",
      "class P { constructor(private readonly q: string) {} }",
      'const m = "the document is broken";',
      "console.log(1);",
    ].join("\n");
    const found = inspect("bad.ts", bad).map((finding) => `${finding.line}: ${finding.what}`);
    expect(found).toEqual([
      '1: import from "node:fs"',
      '2: import of "fast-check", which is not a sibling file',
      '3: import of "../index.ts", which is not a sibling file',
      '4: import from "node:path"',
      '5: the name "Buffer"',
      '6: the name "process"',
      '7: the name "window"',
      '8: the name "document"',
      '9: the name "document"',
      '10: the name "require"',
      "11: dynamic import",
      "12: a call of Date.now",
      "13: new Date() without an argument (the clock)",
      "14: a call of Math.random",
      "15: a call of crypto.randomUUID",
      "16: an enum",
      "17: a namespace",
      "18: a parameter property",
      '19: the word "document" in a string',
      '20: the name "console"',
      '1: the text "node:',
      '4: the text "node:',
    ]);
    const good = [
      'import { a } from "./a.ts";',
      "// a comment may speak of the document, of a window of time and of a process",
      "const stamp = new Date(0).toISOString();",
      "export const b = a + stamp;",
    ].join("\n");
    expect(inspect("good.ts", good)).toEqual([]);
  });
});
