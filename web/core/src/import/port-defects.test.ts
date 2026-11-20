/// <reference types="node" />
// The known defects of the reference port (docs/corrections.md section 3, points 11 to 15;
// reference/import-port/README.md "Known defects") must not exist in the product: "the product
// importer has a test for each, among them one line of 1,000,000 blanks that must be parsed
// within a second". These are those tests. What the port itself does on the same inputs is
// shown, next to the product's result, in core/differential/import.differential.test.ts.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  type CaptureInput,
  type ImportResult,
  importCapture,
  importFile,
  importPaste,
  looksLikeLink,
  looksLikeSignInWall,
  normaliseText,
  parseChatGPTExport,
  parseText,
  splitDisplaySegments,
  stripChromeTurns,
  trimFull,
  trimInline,
} from "./index.ts";

const FOLDER = new URL("./", import.meta.url);

const chr = (code: number): string => String.fromCodePoint(code);
const LS = chr(0x2028);
const PS = chr(0x2029);
const REPLACEMENT = chr(0xfffd);
const HIGH = chr(0xd800);
const LOW = chr(0xdc00);
const F = "```";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function turns(result: ImportResult): [string, string][] {
  const session = result.sessions[0];
  if (session === undefined) throw new Error(`no session: ${result.outcome} ${result.reason}`);
  return session.messages.map((message) => [message.role, message.text]);
}

function capture(kind: CaptureInput["kind"], list: readonly string[]): CaptureInput {
  return {
    sourceUrl: "https://example.invalid/share/EXAMPLE",
    detectedTitle: null,
    typedName: "",
    kind,
    turns: list,
    allowWall: true,
  };
}

describe("corrections.md 3, point 11: ties in the time order follow the keys of the JSON text", () => {
  const node = (text: string, time?: number): string =>
    JSON.stringify({
      message: {
        author: { role: "user" },
        ...(time === undefined ? {} : { create_time: time }),
        content: { parts: [text] },
      },
    });

  it("also for mapping keys that look like integers, which Object.keys moves to the front", () => {
    const text = `{"mapping":{"10":${node("ten")},"b":${node("b")},"2":${node("two")},"a":${node("a")},"0":${node("zero")}}}`;
    // The order the defect follows: JSON.parse has already moved the integer-like keys.
    const parsed: { mapping: object } = JSON.parse(text);
    expect(Object.keys(parsed.mapping)).toEqual(["0", "2", "10", "b", "a"]);
    // The order W4 asks for: that of the text.
    expect(turns(importFile(utf8(text), "conversations.json")).map(([, value]) => value)).toEqual([
      "ten",
      "b",
      "two",
      "a",
      "zero",
    ]);
  });

  it("the time still sorts first; only equal times fall back to the text, in every conversation of a file", () => {
    const first = `{"mapping":{"7":${node("seven", 2)},"3":${node("three", 1)},"5":${node("five", 2)},"1":${node("one", 1)}}}`;
    const second = `{"mapping":{"9":${node("nine")},"x":${node("x")},"8":${node("eight")}}}`;
    const result = importFile(utf8(`[${first}, "junk", ${second}]`), "conversations.json");
    expect(result.sessions.map((session) => session.messages.map((message) => message.text))).toEqual([
      ["three", "one", "seven", "five"],
      ["nine", "x", "eight"],
    ]);
    // A caller that has only the parsed value cannot know the text: it passes the text along.
    const value: unknown = JSON.parse(second);
    expect(parseChatGPTExport(value, second)?.[0]?.messages.map((message) => message.text)).toEqual([
      "nine",
      "x",
      "eight",
    ]);
  });
});

describe("corrections.md 3, point 12: a context pack has exactly four role lines", () => {
  /** What every object inherits: `constructor`, `toString`, `__proto__` and their like. */
  const INHERITED = Object.getOwnPropertyNames(Object.prototype);
  const ROLES = ["user", "assistant", "system", "unknown"];

  it("a line named like something every object inherits is ordinary text, after --- and anywhere else", () => {
    expect(INHERITED).toEqual(expect.arrayContaining(["constructor", "toString", "__proto__", "valueOf"]));
    for (const name of INHERITED) {
      // After "---": not a role line, so the "---" belongs to the message and so does the line.
      const after = `# Context pack: T\n\n## Transcript\n\n**User:**\n\nabove\n\n---\n\n${name}\n\nbelow\n\n---\n`;
      expect(parseText(after, "t")[0]?.messages, name).toEqual([
        { role: "user", text: `above\n\n---\n\n${name}\n\nbelow` },
      ]);
      // As the first line of a chunk: a chunk without a role line is a note, the line is its text.
      const leading = `# Context pack: T\n\n## Transcript\n\n${name}\n\ntext\n\n---\n\n**Assistant:**\n\na\n\n---\n`;
      const messages = importPaste(leading, { title: "t", pickerProvider: "other" }).sessions[0]?.messages;
      expect(messages, name).toEqual([
        { role: "unknown", text: `${name}\n\ntext` },
        { role: "assistant", text: "a" },
      ]);
      for (const message of messages ?? []) {
        expect(typeof message.role).toBe("string");
        expect(ROLES).toContain(message.role);
      }
    }
  });

  it("the same care everywhere a name from the input is looked up: an Origin, an author role, a node id", () => {
    for (const name of INHERITED) {
      const pack = `# Context pack: T\n\nOrigin: ${name} (${name}), saved x\n\n## Transcript\n\n**User:**\n\nq\n\n---\n`;
      expect(parseText(pack, "t")[0], name).toMatchObject({ provider: "other", model: name });
      const mapping = {
        a: { message: { author: { role: name }, content: { parts: ["x"] } }, parent: name },
      };
      // No node has that id, so the walk from current_node finds nothing and the time order is used.
      const sessions = parseChatGPTExport({ current_node: name, mapping });
      expect(sessions?.[0]?.messages, name).toEqual([{ role: "unknown", text: "x" }]);
    }
  });
});

describe("corrections.md 3, point 13: U+2028 and U+2029 are ordinary characters of a line", () => {
  it.each([
    ["U+2028", LS],
    ["U+2029", PS],
  ])(
    "a fence line that holds %s is a fence line: display, generic parser and cleaner agree",
    (_name, separator) => {
      // W13: the display splitter. The text after the backticks is the language, whatever it holds.
      expect(splitDisplaySegments(`before\n${F}js${separator}x\ncode\n${F}\nafter`)).toEqual([
        { type: "prose", text: "before" },
        { type: "code", language: `js${separator}x`, code: "code" },
        { type: "prose", text: "after" },
      ]);
      // W8: a marker-like line inside that closed block is no marker.
      const dialogue = `User: q\nAssistant: a\n${F}yaml${separator}\nuser: deploy\n${F}\ndone`;
      expect(turns(importPaste(dialogue, { title: "t", pickerProvider: "other" }))).toEqual([
        ["user", "q"],
        ["assistant", `a\n${F}yaml${separator}\nuser: deploy\n${F}\ndone`],
      ]);
      // W7: a furniture line inside that closed block is copied untouched.
      const turn = `Assistant: run this\n${F}sh${separator}\nCopy\n10:42\n${F}\nCopy`;
      expect(turns(importCapture(capture("turns", [turn])))).toEqual([
        ["assistant", `run this\n${F}sh${separator}\nCopy\n10:42\n${F}`],
      ]);
    },
  );

  it.each([
    ["U+2028", LS],
    ["U+2029", PS],
  ])("an Origin line that holds %s is read: provider and model", (_name, separator) => {
    const pack =
      `# Context pack: T\n\nOrigin: Gemini (mo${separator}del), saved 19${separator}Nov\n\n` +
      "## Transcript\n\n**User:**\n\nq\n\n---\n";
    expect(parseText(pack, "t")[0]).toMatchObject({ provider: "gemini", model: `mo${separator}del` });
  });

  it("lines are cut at LF only: neither character ends a line anywhere", () => {
    // One line, so one marker: the text behind the separator is not a second message.
    expect(
      turns(importPaste(`User: q${LS}Assistant: a${PS}more`, { title: "t", pickerProvider: "other" })),
    ).toEqual([["user", `q${LS}Assistant: a${PS}more`]]);
  });
});

describe("corrections.md 3, point 14: nothing is quadratic on a long run of blanks", () => {
  const MILLION = 1_000_000;
  const LIMIT_MS = 1000;

  // The time a call took: the smaller of the time on the clock and the processor time used, so
  // that other work on a shared machine does not fail the test. Typical here is a few milliseconds.
  function withinASecond<T>(label: string, run: () => T): T {
    const started = performance.now();
    const before = process.cpuUsage();
    const result = run();
    const used = process.cpuUsage(before);
    const elapsed = Math.min(performance.now() - started, (used.user + used.system) / 1000);
    expect(elapsed, `${label} took ${Math.round(elapsed)} ms`).toBeLessThan(LIMIT_MS);
    return result;
  }

  /** Every way a line reaches the importer. */
  function parseEverywhere(line: string): void {
    const bytes = utf8(line);
    withinASecond("importFile", () => importFile(bytes, "line.txt"));
    withinASecond("importFile .md", () => importFile(bytes, "line.md"));
    withinASecond("importPaste", () =>
      importPaste(line, { title: "t", pickerProvider: "other", allowWall: true }),
    );
    withinASecond("importCapture page-text", () => importCapture(capture("page-text", [line])));
    withinASecond("importCapture turns", () =>
      importCapture(capture("turns", ["User: q", line, "AI Overview"])),
    );
    withinASecond("parseText", () => parseText(line, "t"));
    withinASecond("splitDisplaySegments", () => splitDisplaySegments(line));
    withinASecond("looksLikeSignInWall", () => looksLikeSignInWall([line]));
    withinASecond("stripChromeTurns", () => stripChromeTurns([line, line], [0]));
    withinASecond("looksLikeLink", () => looksLikeLink(line));
    withinASecond("trimInline", () => trimInline(line));
    withinASecond("trimFull", () => trimFull(line));
  }

  it("one line of 1,000,000 blanks is parsed within a second", { timeout: 120_000 }, () => {
    const blanks = " ".repeat(MILLION);
    // The case that takes an expression of the form <class>+$ minutes: the run does not end the line.
    const inside = `x${blanks}x`;
    parseEverywhere(inside);
    const result = withinASecond("importPaste", () =>
      importPaste(`User: a${blanks}b\nAssistant: c${blanks}`, { title: "t", pickerProvider: "other" }),
    );
    expect(result.sessions[0]?.messages.map((message) => [message.role, message.text.length])).toEqual([
      ["user", MILLION + 2],
      ["assistant", 1],
    ]);
    // Nothing of the run is lost or changed: it is text between two letters.
    expect(turns(importPaste(inside, { title: "t", pickerProvider: "other" }))).toEqual([
      ["unknown", inside],
    ]);
    // The whole line, the start of a line and the end of a line that is not the end of the text.
    parseEverywhere(blanks);
    parseEverywhere(`${blanks}x`);
    parseEverywhere(`x${blanks}\ny`);
  });

  it.each([
    ["tabs", "\t"],
    ["no-break spaces", chr(0xa0)],
    ["zero width spaces", chr(0x200b)],
    ["ideographic spaces", chr(0x3000)],
    ["line separators (blank for the full trim only)", LS],
    ["next-line characters (blank for the full trim only)", chr(0x85)],
  ])("the same for 1,000,000 %s", { timeout: 120_000 }, (_name, blank) => {
    const run = blank.repeat(MILLION);
    parseEverywhere(`x${run}x`);
    parseEverywhere(`x${run}\ny`);
    parseEverywhere(run);
  });

  it("the same where the run stands on a line that the parsers look at closely", { timeout: 120_000 }, () => {
    const blanks = " ".repeat(MILLION);
    const lines = [
      `# title${blanks}x\nSource: https://claude.ai/x${blanks}x\n\nUser: q${blanks}x\n\n---${blanks}\n`,
      `You said:${blanks}x\nbody${blanks}x\nClaude responded:${blanks}\nCopy${blanks}\n10:42${blanks}x`,
      `${F}js${blanks}x\ncode${blanks}\n${F}${blanks}\nUser${blanks}:${blanks}q`,
      `# Context pack: T${blanks}x\n\nOrigin: Claude${blanks}(m${blanks}), saved${blanks}x\nTags: a${blanks},${blanks}b\n\n## Transcript${blanks}\n\n**User:**${blanks}\n\nq${blanks}x\n\n---${blanks}\n`,
      `Sign in${blanks}x\nShared conversation${blanks}\nUser: q`,
    ];
    for (const text of lines) parseEverywhere(text);
  });

  it("the Origin line of a context pack with ' (' repeated 500,000 times is read within a second", {
    timeout: 120_000,
  }, () => {
    const pack = `# Context pack: T\n\nOrigin: ${" (".repeat(MILLION / 2)}\n\n## Transcript\n\n**User:**\n\nq\n\n---\n`;
    const result = withinASecond("importPaste", () =>
      importPaste(pack, { title: "t", pickerProvider: "other" }),
    );
    expect(turns(result)).toEqual([["user", "q"]]);
    expect(result.sessions[0]?.provider).toBe("other");
  });

  // That no source holds an expression of the form <class>+$ at all is checked by purity.test.ts.
});

describe("corrections.md 3, point 15: written for a strict compiler, and W1 needs no newer platform", () => {
  it("the sources compile under the strict settings of web/tsconfig.base.json, without the types of any platform", {
    timeout: 300_000,
  }, () => {
    const configPath = fileURLToPath(new URL("../../../tsconfig.base.json", FOLDER));
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const settings: unknown = read.config?.compilerOptions;
    const parsed = ts.convertCompilerOptionsFromJson(settings, fileURLToPath(new URL("../../../", FOLDER)));
    expect(parsed.errors).toEqual([]);
    // The settings that make it strict are really the ones in force.
    expect(parsed.options).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      erasableSyntaxOnly: true,
      verbatimModuleSyntax: true,
    });
    const sources = readdirSync(FOLDER)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => fileURLToPath(new URL(name, FOLDER)));
    expect(sources.length).toBeGreaterThanOrEqual(20);
    // `types: []`: neither the Node types nor any other package's globals. Only the language.
    const program = ts.createProgram({ rootNames: sources, options: { ...parsed.options, types: [] } });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map(
        (item) => `${item.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`,
      );
    expect(diagnostics).toEqual([]);
    // Only the importer's own files and the language's library were needed.
    const others = program
      .getSourceFiles()
      .map((file) => file.fileName)
      .filter(
        (name) =>
          !sources.includes(name) && !/[\\/]typescript[\\/]lib[\\/]lib\.[a-z0-9.]+\.d\.ts$/.test(name),
      );
    expect(others).toEqual([]);
  });

  it("W1 replaces lone surrogates also where String.prototype.toWellFormed does not exist", () => {
    const sample = `a${HIGH}b${LOW}c${HIGH}${LOW}d${LOW}${HIGH}`;
    const expected = `a${REPLACEMENT}b${REPLACEMENT}c${HIGH}${LOW}d${REPLACEMENT}${REPLACEMENT}`;
    const original = Object.getOwnPropertyDescriptor(String.prototype, "toWellFormed");
    expect(original).toBeDefined();
    try {
      // An older platform: the method is gone.
      Reflect.deleteProperty(String.prototype, "toWellFormed");
      expect(Reflect.get(String.prototype, "toWellFormed")).toBeUndefined();
      expect(normaliseText(sample)).toBe(expected);
      const pasted = importPaste(`User: x${HIGH}y`, { title: `t${LOW}`, pickerProvider: "other" });
      expect(pasted.sessions[0]).toMatchObject({
        title: `t${REPLACEMENT}`,
        messages: [{ role: "user", text: `x${REPLACEMENT}y` }],
      });
    } finally {
      if (original !== undefined) Object.defineProperty(String.prototype, "toWellFormed", original);
    }
    expect(typeof Reflect.get(String.prototype, "toWellFormed")).toBe("function");
    // With the method back, the result is the same.
    expect(normaliseText(sample)).toBe(expected);
    // And no source calls it.
    const sources = readdirSync(FOLDER).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    for (const name of sources) {
      expect(readFileSync(new URL(name, FOLDER), "utf8"), name).not.toMatch(/toWellFormed\s*[?(.]/);
    }
  });
});
