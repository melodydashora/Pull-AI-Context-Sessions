/// <reference types="node" />
// The importer has to run unchanged in a browser, in a web worker and in Node
// (docs/import-rules.md C4), and Node runs the .ts files directly. The type check cannot
// enforce that here, because the test files bring the Node types into the same project.
// So this test reads the sources themselves.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FOLDER = new URL("./", import.meta.url);

/** Every source of the module that is not a test. */
const SOURCES = readdirSync(FOLDER)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .sort();

/**
 * What a source must not contain, anywhere, comments included: a whole-file search has no
 * blind spots. Each rule is a name and a pattern.
 */
const FORBIDDEN: readonly (readonly [rule: string, pattern: RegExp])[] = [
  ["an import from node:", /["']node:/],
  ["require()", /\brequire\s*\(/],
  ["Buffer", /\bBuffer\b/],
  ["process", /\bprocess\b/],
  ["window", /\bwindow\b/],
  ["document", /\bdocument\b/],
  [
    "another browser or Node global",
    /\b(navigator|localStorage|sessionStorage|globalThis|__dirname|__filename)\b/,
  ],
  ["input or output", /\b(fetch|XMLHttpRequest|WebSocket|console)\b/],
  ["the clock", /\bDate\.now\b|\bnew Date\(\s*\)|\bperformance\b|\bsetTimeout\b|\bsetInterval\b/],
  ["randomness", /\bMath\.random\b|\bcrypto\b/],
  [
    "syntax that cannot be erased",
    /\benum\s+[A-Za-z_]|\bnamespace\s+[A-Za-z_]|\bconstructor\s*\([^)]*\b(public|private|protected|readonly)\b/,
  ],
  ["a suppressed type error", /@ts-ignore|@ts-expect-error|@ts-nocheck/],
  ["a character that is not printable ASCII, a tab or a line feed", /[^\t\n -~]/],
  // corrections.md 2 and 3, point 14: a trim or a search of the form <class>+$ takes quadratic
  // time on a long run that does not end the text. A repeat without an upper limit must not
  // stand directly before "$"; trims are loops.
  ["a repeat without limit directly before the end of the text", /[+*]\$|,\}\$/],
];

function violations(source: string): string[] {
  const found = FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(([rule]) => rule);
  // Every import is a relative one inside this folder and names its file with the extension.
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)) {
    const specifier = match[1] ?? match[2] ?? "";
    if (!/^\.\/[a-z-]+\.ts$/.test(specifier)) found.push(`the import "${specifier}"`);
  }
  return found;
}

describe("the non-test sources of the importer are portable and pure", () => {
  it("finds the sources", () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(20);
    expect(SOURCES).toContain("index.ts");
    expect(SOURCES).toContain("import-file.ts");
    expect(SOURCES).toContain("platform.ts");
  });

  it.each(SOURCES)(
    "%s imports nothing from node: and uses no Buffer, process, window or document",
    (name) => {
      expect(violations(readFileSync(new URL(name, FOLDER), "utf8"))).toEqual([]);
    },
  );

  it("the search itself works: each forbidden thing is found in a sample", () => {
    const samples: Record<string, string> = {
      'import { readFileSync } from "node:fs";': "an import from node:",
      "const fs = await import('node:fs');": "an import from node:",
      'const fs = require("fs");': "require()",
      "Buffer.from(bytes)": "Buffer",
      "process.env.HOME": "process",
      "window.location.href": "window",
      "document.title": "document",
      "navigator.clipboard": "another browser or Node global",
      "globalThis.URL": "another browser or Node global",
      "await fetch(url)": "input or output",
      "console.log(text)": "input or output",
      "const now = Date.now();": "the clock",
      "const now = new Date();": "the clock",
      "Math.random()": "randomness",
      "crypto.randomUUID()": "randomness",
      "enum Role { User }": "syntax that cannot be erased",
      "namespace Importer {}": "syntax that cannot be erased",
      "constructor(private readonly text: string) {}": "syntax that cannot be erased",
      "// @ts-ignore": "a suppressed type error",
      [`const dash = "${String.fromCodePoint(0x2014)}";`]:
        "a character that is not printable ASCII, a tab or a line feed",
      [`const mark = "${String.fromCodePoint(0xfeff)}";`]:
        "a character that is not printable ASCII, a tab or a line feed",
      "line one\r\nline two": "a character that is not printable ASCII, a tab or a line feed",
      // The trims of the reference port, and their like.
      'const RE_RTRIM_INLINE = new RegExp("[" + INLINE_WS + "]+$");':
        "a repeat without limit directly before the end of the text",
      "text.replace(/^[ \\t]+|[ \\t]+$/g, '')": "a repeat without limit directly before the end of the text",
      "/\\s*$/.exec(line)": "a repeat without limit directly before the end of the text",
      "/[0-9]{2,}$/.test(line)": "a repeat without limit directly before the end of the text",
      'import { x } from "../vault/x.ts";': 'the import "../vault/x.ts"',
      'import { x } from "./text";': 'the import "./text"',
      'import fc from "fast-check";': 'the import "fast-check"',
    };
    for (const [sample, rule] of Object.entries(samples)) expect(violations(sample), sample).toContain(rule);
    // What the sources do contain is not flagged.
    expect(
      violations('import { trimFull } from "./text.ts";\nnew Date(milliseconds).toISOString();'),
    ).toEqual([]);
    expect(violations("declare const URL: new (input: string) => ParsedUrl;")).toEqual([]);
    // The time line of W7 ends in an optional group, not in a repeat without limit.
    expect(violations("const TIME_LINE = /^[0-9]{1,2}:[0-9]{2}\\s?(AM|PM)?$/;")).toEqual([]);
  });

  it("runs under Node directly, as the server will load it: type stripping only, no build step", {
    timeout: 120_000,
  }, () => {
    const script = `
      const importer = await import(${JSON.stringify(new URL("index.ts", FOLDER).href)});
      const pasted = importer.importPaste("User: hello\\r\\nAssistant: hi", { title: "t", pickerProvider: "other" });
      const file = importer.importFile(new TextEncoder().encode("# x\\nSource: https://claude.ai/y\\n\\nturn"), "a.md");
      const link = importer.importPaste("claude.ai/share/EXAMPLE", { title: "t", pickerProvider: "other" });
      console.log(JSON.stringify({
        exports: Object.keys(importer).sort(),
        roles: pasted.sessions[0].messages.map((message) => message.role),
        provider: file.sessions[0].provider,
        link: link.linkUrl,
        segments: importer.splitDisplaySegments("a\\n\`\`\`js\\nb\\n\`\`\`").length,
      }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: fileURLToPath(FOLDER),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({
      exports: [
        "countGraphemes",
        "decodeBytes",
        "hasFewerGraphemesThan",
        "importCapture",
        "importFile",
        "importPaste",
        "looksLikeLink",
        "looksLikeSignInWall",
        "normaliseText",
        "parseChatGPTExport",
        "parseText",
        "providerForUrl",
        "roleMarker",
        "splitDisplaySegments",
        "splitFileName",
        "splitLines",
        "stripChromeTurns",
        "trimFull",
        "trimInline",
      ],
      roles: ["user", "assistant"],
      provider: "claude",
      link: "https://claude.ai/share/EXAMPLE",
      segments: 2,
    });
  });
});
