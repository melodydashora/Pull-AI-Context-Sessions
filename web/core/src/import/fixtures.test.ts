/// <reference types="node" />
// The acceptance tests of the importer: the golden files in web/fixtures/import, driven by
// manifest.json as fixtures/import/README.md describes. Inputs are read as bytes and never
// as text; their SHA-256 is verified before any parser runs.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type CaptureInput,
  countGraphemes,
  type DisplaySegment,
  type ImportResult,
  importCapture,
  importFile,
  importPaste,
  looksLikeSignInWall,
  normaliseText,
  type ParsedSession,
  type PasteOptions,
  type Provider,
  splitDisplaySegments,
  stripChromeTurns,
} from "./index.ts";

const FIXTURE_DIR = new URL("../../../fixtures/import/", import.meta.url);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = { [key: string]: Json };

function readBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, FIXTURE_DIR)));
}

function readJson(name: string): Json {
  const parsed: Json = JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), "utf8"));
  return parsed;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Accessors that check what they read, so that a damaged manifest fails here and not later.
function record(value: Json | undefined, what: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what}: expected an object`);
  }
  return value;
}
function list(value: Json | undefined, what: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`${what}: expected an array`);
  return value;
}
function text(value: Json | undefined, what: string): string {
  if (typeof value !== "string") throw new Error(`${what}: expected a string`);
  return value;
}
function optionalText(value: Json | undefined, what: string): string | undefined {
  return value === undefined ? undefined : text(value, what);
}
function optionalFlag(value: Json | undefined, what: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${what}: expected true or false`);
  return value;
}
function provider(value: Json | undefined, what: string): Provider {
  if (value === "claude" || value === "chatgpt" || value === "gemini" || value === "other") return value;
  throw new Error(`${what}: expected a provider`);
}

type Entry = "file" | "paste" | "capture" | "guards" | "display-segments";

interface FixtureCase {
  readonly id: string;
  readonly kind: string;
  readonly entry: Entry;
  readonly input: string;
  readonly inputBytes: number;
  readonly inputSha256: string;
  readonly call: JsonRecord;
  /** `expected.web` where one exists, otherwise `expected.both`. Never `expected.apple`. */
  readonly target: string;
}

function entryOf(value: Json | undefined, what: string): Entry {
  if (
    value === "file" ||
    value === "paste" ||
    value === "capture" ||
    value === "guards" ||
    value === "display-segments"
  ) {
    return value;
  }
  throw new Error(`${what}: unknown entry`);
}

function loadCases(): FixtureCase[] {
  const manifest = record(readJson("manifest.json"), "manifest");
  return list(manifest.cases, "manifest.cases").map((item, index) => {
    const what = `manifest.cases[${index}]`;
    const entry = record(item, what);
    const expected = record(entry.expected, `${what}.expected`);
    const target =
      optionalText(expected.web, `${what}.expected.web`) ?? text(expected.both, `${what}.expected.both`);
    const inputBytes = entry.input_bytes;
    if (typeof inputBytes !== "number") throw new Error(`${what}.input_bytes: expected a number`);
    return {
      id: text(entry.id, `${what}.id`),
      kind: text(entry.kind, `${what}.kind`),
      entry: entryOf(entry.entry, `${what}.entry`),
      input: text(entry.input, `${what}.input`),
      inputBytes,
      inputSha256: text(entry.input_sha256, `${what}.input_sha256`),
      call: record(entry.call, `${what}.call`),
      target,
    };
  });
}

const CASES = loadCases();

// ---------------------------------------------------------------------------------------
// From the importer's types to the result shape of the expected files (README "Result format").
// ---------------------------------------------------------------------------------------

interface FixtureSession {
  title: string;
  provider: string;
  model: string;
  source_url: string;
  created_at: string | null;
  summary: string;
  tags: string[];
  messages: { role: string; text: string; display_segments: DisplaySegment[] }[];
}

function sessionShape(session: ParsedSession): FixtureSession {
  return {
    title: session.title,
    provider: session.provider,
    model: session.model,
    source_url: session.sourceUrl,
    created_at: session.createdAt,
    summary: session.summary,
    tags: [...session.tags],
    messages: session.messages.map((message) => ({
      role: message.role,
      text: message.text,
      display_segments: splitDisplaySegments(message.text),
    })),
  };
}

function toFixtureShape(result: ImportResult, entry: Entry): JsonRecord | object {
  const shape: Record<string, unknown> = {
    outcome: result.outcome,
    reason: result.reason,
    flags: [...result.flags].sort(), // compared as a set
    sessions: result.sessions.map(sessionShape),
  };
  if (result.outcome === "link") shape.link_url = result.linkUrl;
  if (entry === "capture") shape.dropped_turns = result.droppedTurns.map((turn) => ({ ...turn }));
  return shape;
}

// The expected side, with the two things the README defines as equal made equal:
// `flags` is a set, and an absent `summary` or `tags` means "" and [].
function expectedShape(result: Json): Json {
  const expected = record(result, "expected result");
  const shaped: JsonRecord = { ...expected };
  if (expected.flags !== undefined) {
    shaped.flags = list(expected.flags, "flags")
      .map((flag) => text(flag, "flag"))
      .sort();
  }
  if (expected.sessions !== undefined) {
    shaped.sessions = list(expected.sessions, "sessions").map((item) => {
      const session = record(item, "session");
      return { ...session, summary: session.summary ?? "", tags: session.tags ?? [] };
    });
  }
  return shaped;
}

// ---------------------------------------------------------------------------------------
// One call per entry point (README "Input formats").
// ---------------------------------------------------------------------------------------

function pasteOptions(call: JsonRecord): PasteOptions {
  const sourceUrl = optionalText(call.source_url, "call.source_url");
  const allowWall = optionalFlag(call.allow_wall, "call.allow_wall");
  return {
    title: text(call.title, "call.title"),
    pickerProvider: provider(call.picker_provider, "call.picker_provider"),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(allowWall === undefined ? {} : { allowWall }),
  };
}

function captureInput(value: Json): CaptureInput {
  const input = record(value, "capture input");
  const kind = input.kind;
  if (kind !== "page-text" && kind !== "turns") throw new Error("capture input: unknown kind");
  const detectedTitle = input.detected_title;
  if (detectedTitle !== null && typeof detectedTitle !== "string") {
    throw new Error("capture input: detected_title must be a string or null");
  }
  const allowWall = optionalFlag(input.allow_wall, "allow_wall");
  return {
    sourceUrl: text(input.source_url, "source_url"),
    detectedTitle,
    typedName: text(input.typed_name, "typed_name"),
    kind,
    turns: list(input.turns, "turns").map((turn) => text(turn, "turn")),
    ...(allowWall === undefined ? {} : { allowWall }),
  };
}

function tableCases(value: Json): JsonRecord[] {
  return list(record(value, "table").cases, "cases").map((item) => record(item, "case"));
}

function turnsOf(item: JsonRecord): string[] {
  return list(item.turns, "turns").map((turn) => text(turn, "turn"));
}

function decodePaste(bytes: Uint8Array): string {
  // Exactly the string the bytes spell: strict, and a byte-order mark would stay in it.
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function runCase(fixture: FixtureCase, bytes: Uint8Array): unknown {
  switch (fixture.entry) {
    case "file":
      return toFixtureShape(importFile(bytes, text(fixture.call.filename, "call.filename")), "file");
    case "paste":
      return toFixtureShape(importPaste(decodePaste(bytes), pasteOptions(fixture.call)), "paste");
    case "capture": {
      const input: Json = JSON.parse(decodePaste(bytes));
      return toFixtureShape(importCapture(captureInput(input)), "capture");
    }
    case "guards": {
      const table: Json = JSON.parse(decodePaste(bytes));
      const cases = tableCases(table);
      // Fixture 55 is the sign-in-wall table, fixture 56 the chrome-turns table.
      if (fixture.id.startsWith("55-")) {
        return {
          results: cases.map((item) => ({
            name: item.name,
            joined_length: countGraphemes(turnsOf(item).map(normaliseText).join("\n")),
            sign_in_wall: looksLikeSignInWall(turnsOf(item)),
          })),
        };
      }
      return {
        results: cases.map((item) => {
          const stripped = stripChromeTurns(turnsOf(item));
          return { name: item.name, kept: stripped.kept, dropped_turns: stripped.dropped };
        }),
      };
    }
    case "display-segments": {
      const table: Json = JSON.parse(decodePaste(bytes));
      return {
        results: tableCases(table).map((item) => ({
          name: item.name,
          display_segments: splitDisplaySegments(text(item.text, "text")),
        })),
      };
    }
  }
}

function expectedResult(fixture: FixtureCase): Json {
  const result = record(readJson(fixture.target), fixture.target).result;
  if (result === undefined) throw new Error(`${fixture.target}: no result`);
  return fixture.entry === "file" || fixture.entry === "paste" || fixture.entry === "capture"
    ? expectedShape(result)
    : result;
}

// ---------------------------------------------------------------------------------------

/** Ids of the fixtures whose input bytes do not match the manifest. */
function alteredInputs(): string[] {
  const altered: string[] = [];
  for (const fixture of CASES) {
    const bytes = readBytes(fixture.input);
    if (bytes.length !== fixture.inputBytes || sha256Hex(bytes) !== fixture.inputSha256)
      altered.push(fixture.id);
  }
  return altered;
}

describe("import fixtures (web/fixtures/import)", () => {
  // First of all, before any parser is called: the bytes of every input are those of the manifest.
  beforeAll(() => {
    const altered = alteredInputs();
    if (altered.length > 0) {
      throw new Error(
        `FIXTURE BYTES WERE ALTERED: ${altered.join(", ")}. An editor, a formatter or git changed them; ` +
          "restore the files before trusting any result of this suite.",
      );
    }
  });

  it("the manifest lists every input file in the folder, each case once", () => {
    // 57 cases when this was written; more may be added, none may go missing.
    expect(CASES.length).toBeGreaterThanOrEqual(57);
    expect(new Set(CASES.map((fixture) => fixture.id)).size).toBe(CASES.length);
    const inputsOnDisk = readdirSync(FIXTURE_DIR)
      .filter((name) => name.includes(".input."))
      .sort();
    expect(CASES.map((fixture) => fixture.input).sort()).toEqual(inputsOnDisk);
  });

  it("the input bytes of every fixture match their SHA-256 in the manifest", () => {
    expect(alteredInputs()).toEqual([]);
  });

  it("the target is the web file where one exists, else the common file, never the Apple record", () => {
    for (const fixture of CASES) {
      expect(fixture.target).not.toContain(".expected.apple.");
      // Parity fixtures have one expected file; defect fixes and extensions have a web target.
      const suffix = fixture.kind === "parity" ? ".expected.json" : ".expected.web.json";
      expect(fixture.target, fixture.id).toBe(`${fixture.id}${suffix}`);
    }
  });

  for (const fixture of CASES) {
    const note = fixture.kind === "web-extension" ? " (optional web extension: built, not skipped)" : "";
    it(`${fixture.id}${note}`, () => {
      const bytes = readBytes(fixture.input);
      expect(sha256Hex(bytes), "fixture bytes were altered").toBe(fixture.inputSha256);
      expect(runCase(fixture, bytes)).toStrictEqual(expectedResult(fixture));
    });
  }

  it("the optional extensions (37, 38, 46) are all built: no fixture is skipped", () => {
    // Each ran above as a test of its own, against its web target.
    const extensions = CASES.filter((fixture) => fixture.kind === "web-extension").map(
      (fixture) => fixture.id,
    );
    expect(extensions).toEqual(
      expect.arrayContaining([
        "37-paste-with-source-link",
        "38-paste-context-pack",
        "46-capture-wall-override",
      ]),
    );
  });

  // W1: "the CRLF fixtures (02, 14, 27) must give exactly the result of their LF twins (01, 13, 26)".
  it.each([
    ["02-puller-markdown-crlf", "01-puller-markdown-lf"],
    ["14-generic-markers-crlf", "13-generic-markers-lf"],
    ["27-paste-share-page-claude-crlf", "26-paste-share-page-claude"],
  ])("%s gives exactly the result of %s", (crlfId, lfId) => {
    const run = (id: string): unknown => {
      const fixture = CASES.find((candidate) => candidate.id === id);
      if (fixture === undefined) throw new Error(`no fixture ${id}`);
      return runCase(fixture, readBytes(fixture.input));
    };
    expect(run(crlfId)).toStrictEqual(run(lfId));
  });
});
