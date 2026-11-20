/// <reference types="node" />
// The three entry points, rule by rule: docs/import-rules.md W2, W3, W10, W11, W12 and the
// items of part C, beyond what the golden fixtures pin down. All content is invented.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CaptureInput,
  decodeBytes,
  type ImportResult,
  importCapture,
  importFile,
  importPaste,
  type PasteOptions,
  providerForUrl,
  trimFull,
} from "./index.ts";

const chr = (...codes: number[]): string => String.fromCodePoint(...codes);
const NUL = chr(0);
const VT = chr(0x0b);
const FF = chr(0x0c);
const NEL = chr(0x85);
const ZWSP = chr(0x200b);
const LS = chr(0x2028);
const PS = chr(0x2029);
const BOM = chr(0xfeff);
const REPLACEMENT = chr(0xfffd);
const HIGH = chr(0xd800);

/** True when a surrogate stands without its partner: such a string cannot be stored (C5). */
function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    const next = text.charCodeAt(index + 1);
    if (code > 0xdbff || !(next >= 0xdc00 && next <= 0xdfff)) return true;
    index++;
  }
  return false;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function utf16le(text: string, mark: boolean): Uint8Array {
  const out: number[] = mark ? [0xff, 0xfe] : [];
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    out.push(unit & 0xff, unit >> 8);
  }
  return new Uint8Array(out);
}

/** Outcome, reason and flags in one value. */
function verdict(result: ImportResult): [string, string | null, string[]] {
  return [result.outcome, result.reason, [...result.flags]];
}

function turns(result: ImportResult, session = 0): [string, string][] {
  const found = result.sessions[session];
  if (found === undefined) throw new Error(`no session ${session}: ${result.outcome} ${result.reason}`);
  return found.messages.map((message) => [message.role, message.text]);
}

const node = (role: string, text: string, parent?: string): object => ({
  message: { author: { role }, content: { parts: [text] } },
  ...(parent === undefined ? {} : { parent }),
});

const EXPORT = JSON.stringify([{ title: "Bread", mapping: { a: node("user", "How long to prove?") } }]);

describe("importFile: W2 bytes to text", () => {
  it("no bytes, or only white space, is empty_input (D8, fixtures 17 and 18)", () => {
    expect(verdict(importFile(new Uint8Array(0), "empty.txt"))).toEqual(["rejected", "empty_input", []]);
    expect(verdict(importFile(utf8(` \n\t\r\n${ZWSP}`), "blank.md"))).toEqual([
      "rejected",
      "empty_input",
      [],
    ]);
    expect(verdict(importFile(utf8(BOM), "bom-only.txt"))).toEqual(["rejected", "empty_input", []]);
    expect(verdict(importFile(utf8(`${NUL}${NUL}\n`), "nul-only.txt"))).toEqual([
      "rejected",
      "empty_input",
      [],
    ]);
    expect(verdict(importFile(new Uint8Array(0), "empty.json"))).toEqual(["rejected", "empty_input", []]);
  });

  it("a rejection keeps the flag of the encoding that was assumed", () => {
    expect(verdict(importFile(utf16le(" \r\n ", true), "blank-utf16.txt"))).toEqual([
      "rejected",
      "empty_input",
      ["decoded_as_utf_16le"],
    ]);
    expect(verdict(importFile(utf16le('{"a": 1}', true), "other.json"))).toEqual([
      "rejected",
      "unrecognised_json",
      ["decoded_as_utf_16le"],
    ]);
  });

  it("bytes that are not text are undecodable", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    expect(verdict(importFile(png, "picture.txt"))).toEqual(["rejected", "undecodable", []]);
    expect(verdict(importFile(png, "picture.json"))).toEqual(["rejected", "undecodable", []]);
  });

  it("UTF-16 without a byte-order mark is read as UTF-16, not as text with a NUL after every letter (D10)", () => {
    const result = importFile(utf16le("User: hello\r\nAssistant: hi\r\n", false), "notes.txt");
    expect(verdict(result)).toEqual(["imported", null, ["decoded_as_utf_16le"]]);
    expect(turns(result)).toEqual([
      ["user", "hello"],
      ["assistant", "hi"],
    ]);
  });

  it("removes NUL characters and replaces lone surrogates (C5)", () => {
    const result = importFile(utf8(`User: a${NUL}b`), "nul.txt");
    expect(turns(result)).toEqual([["user", "ab"]]);
    // A lone surrogate reaches the text through UTF-16.
    const lone = importFile(utf16le(`User: x${HIGH}y and more text`, true), "lone.txt");
    expect(turns(lone)).toEqual([["user", `x${REPLACEMENT}y and more text`]]);
  });

  it("corrections.md 3, point 1: UTF-16 with an odd last byte is imported, that byte ignored", () => {
    const odd = new Uint8Array([...utf16le("User: hello\r\nAssistant: hi", true), 0x21]);
    const result = importFile(odd, "notes.txt");
    expect(verdict(result)).toEqual(["imported", null, ["decoded_as_utf_16le"]]);
    expect(turns(result)).toEqual([
      ["user", "hello"],
      ["assistant", "hi"],
    ]);
    // The same without a mark.
    const bare = new Uint8Array([...utf16le("User: hello\r\nAssistant: hi", false), 0x21]);
    expect(importFile(bare, "notes.txt")).toEqual(result);
    // A mark and half a character hold no text at all.
    expect(verdict(importFile(new Uint8Array([0xff, 0xfe, 0x41]), "a.txt"))).toEqual([
      "rejected",
      "empty_input",
      ["decoded_as_utf_16le"],
    ]);
  });

  it("corrections.md 3, point 3: a UTF-8 mark before bytes that are not UTF-8 gives the windows-1252 flag and the mark as three characters", () => {
    const file = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("User: caf"), 0xe9]);
    const result = importFile(file, "notes.txt");
    expect(verdict(result)).toEqual(["imported", null, ["decoded_as_windows_1252"]]);
    // The three characters stand in front of "User:", so the line is no marker: the review step shows them.
    expect(turns(result)).toEqual([["unknown", `${chr(0xef, 0xbb, 0xbf)}User: caf${chr(0xe9)}`]]);
  });

  it("corrections.md 3, points 4 and 10: decodeBytes leaves W1 to importFile, which removes every mark", () => {
    const marks = [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf];
    const file = new Uint8Array([...marks, ...utf8("User: q\r\nAssistant: a")]);
    // Five marks in the bytes: the decoder consumes one, the text still starts with four.
    expect(decodeBytes(file)).toEqual({ text: `${BOM.repeat(4)}User: q\r\nAssistant: a`, flag: null });
    expect(turns(importFile(file, "a.txt"))).toEqual([
      ["user", "q"],
      ["assistant", "a"],
    ]);
    // JSON.parse refuses a leading U+FEFF, so every one of them has to be gone before it (fixture 08).
    expect(verdict(importFile(new Uint8Array([...marks, ...utf8(EXPORT)]), "c.json"))).toEqual([
      "imported",
      null,
      [],
    ]);
  });

  it("accepts a Node Buffer, which is a byte array, and refuses anything else", () => {
    expect(importFile(Buffer.from("User: hi"), "a.txt").outcome).toBe("imported");
    const wrong: unknown[] = [
      "User: hi",
      null,
      undefined,
      [85, 115],
      new Uint16Array(4),
      new ArrayBuffer(4),
      {},
    ];
    for (const value of wrong) {
      // @ts-expect-error a caller outside the type system
      expect(verdict(importFile(value, "a.txt"))).toEqual(["rejected", "undecodable", []]);
    }
  });
});

describe("importFile: the extension decides (2.1, C2)", () => {
  it("the fallback title is the file name without its extension", () => {
    expect(importFile(utf8("plain note"), "my.session.notes.md").sessions[0]?.title).toBe("my.session.notes");
    expect(importFile(utf8("plain note"), "README").sessions[0]?.title).toBe("README");
    expect(importFile(utf8("plain note"), ".notes").sessions[0]?.title).toBe(".notes");
    expect(importFile(utf8("plain note"), "name.").sessions[0]?.title).toBe("name.");
    expect(importFile(utf8("plain note"), "Mr. Smith notes").sessions[0]?.title).toBe("Mr. Smith notes");
    expect(importFile(utf8("plain note"), "").sessions[0]?.title).toBe("Imported session");
    expect(importFile(utf8("plain note"), "  .txt").sessions[0]?.title).toBe("Imported session");
  });

  it("the title can always be stored: W1 applies to the file name too (C5)", () => {
    expect(importFile(utf8("plain note"), `a${HIGH}b${NUL}c.txt`).sessions[0]?.title).toBe(
      `a${REPLACEMENT}bc`,
    );
  });

  it("`json` in any letter case goes to the JSON rules", () => {
    for (const name of ["conversations.json", "conversations.JSON", "c.Json", "a.b.jSoN"]) {
      const result = importFile(utf8(EXPORT), name);
      expect(verdict(result)).toEqual(["imported", null, []]);
      expect(result.sessions[0]?.provider).toBe("chatgpt");
    }
  });

  it("a ChatGPT export under another extension goes to the text parsers, as in the Apple app", () => {
    for (const name of [
      "conversations.txt",
      "conversations.json.bak",
      ".json",
      "json",
      "conversations.json ",
    ]) {
      const result = importFile(utf8(EXPORT), name);
      expect(result.outcome).toBe("imported");
      expect(turns(result)).toEqual([["unknown", EXPORT]]);
    }
  });
});

describe("importFile: W3 JSON files", () => {
  it.each([
    ["malformed JSON", '{"mapping": '],
    ["text that is not JSON", "User: hello"],
    ["an empty array", "[]"],
    ["an object that is no export", '{"conversation": [{"sender": "human", "text": "hi"}]}'],
    ["an array without a conversation", '[1, "two", {"title": "x"}]'],
    ["a top-level string", '"mapping"'],
    ["a top-level number", "42"],
    ["null", "null"],
    ["two documents", "[] []"],
  ])("%s is unrecognised_json: the raw text is never imported silently (D9, fixture 12)", (_name, text) => {
    const result = importFile(utf8(text), "data.json");
    expect(verdict(result)).toEqual(["rejected", "unrecognised_json", []]);
    expect(result.sessions).toEqual([]);
  });

  it("a recognised export without any message is no_messages", () => {
    expect(verdict(importFile(utf8('[{"mapping": {}}]'), "c.json"))).toEqual(["rejected", "no_messages", []]);
    const onlySystem = JSON.stringify({ mapping: { a: node("system", "hidden") } });
    expect(verdict(importFile(utf8(onlySystem), "c.json"))).toEqual(["rejected", "no_messages", []]);
  });

  it("W1 runs before JSON.parse: a byte-order mark and CR LF do not matter (fixture 08)", () => {
    const withMark = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(EXPORT.replaceAll(",", ",\r\n"))]);
    expect(verdict(importFile(withMark, "c.json"))).toEqual(["imported", null, []]);
    expect(verdict(importFile(utf16le(EXPORT, true), "c.json"))).toEqual([
      "imported",
      null,
      ["decoded_as_utf_16le"],
    ]);
  });

  it("`asPlainText` sends a .json file to the text parsers on purpose ('keep as a plain-text note')", () => {
    const text = '{"notes": "User: not a marker here"}';
    expect(verdict(importFile(utf8(text), "data.json"))).toEqual(["rejected", "unrecognised_json", []]);
    const kept = importFile(utf8(text), "data.json", { asPlainText: true });
    expect(verdict(kept)).toEqual(["imported", null, []]);
    expect(kept.sessions[0]?.title).toBe("data");
    expect(turns(kept)).toEqual([["unknown", text]]);
    // The other rules still hold.
    expect(verdict(importFile(utf8("  "), "data.json", { asPlainText: true }))).toEqual([
      "rejected",
      "empty_input",
      [],
    ]);
    expect(importFile(utf8(text), "data.json", { asPlainText: false }).outcome).toBe("rejected");
    expect(importFile(utf8(text), "data.json", {}).outcome).toBe("rejected");
  });

  it("ties among node ids that look like array indices follow the JSON text (W4)", () => {
    const entry = (id: string): string => `"${id}":${JSON.stringify(node("user", `text ${id}`))}`;
    const text = `{"mapping":{${["10", "9", "b", "2"].map(entry).join(",")}}}`;
    expect(turns(importFile(utf8(text), "c.json")).map(([, value]) => value)).toEqual([
      "text 10",
      "text 9",
      "text b",
      "text 2",
    ]);
  });
});

// corrections.md 3, point 10: the fourth outcome of importFile, `interchange`, carries the parsed
// document; the caller hands it to the interchange reader. It is never `unrecognised_json`.
describe("importFile: W3 interchange files are handed over, not imported here (corrections.md 3, point 10)", () => {
  const interchange = {
    format: "sessionvault-interchange",
    version: 1,
    kind: "vault",
    exported_at: "2026-11-19T12:00:00.000Z",
    projects: [],
    sessions: [],
  };

  it("a .json file whose format is sessionvault-interchange comes back as outcome interchange", () => {
    const result = importFile(utf8(JSON.stringify(interchange)), "sessionvault-vault-EXAMPLE.json");
    expect(result.outcome).toBe("interchange");
    expect(result.reason).toBeNull();
    expect(result.sessions).toEqual([]);
    expect(result.flags).toEqual([]);
    if (result.outcome === "interchange") expect(result.json).toEqual(interchange);
  });

  it("the version and everything else is the reader's business: any such file is handed over", () => {
    for (const extra of [{ version: 99 }, { mapping: { a: node("user", "x") } }, { sessions: "broken" }]) {
      const result = importFile(utf8(JSON.stringify({ ...interchange, ...extra })), "v.JSON");
      expect(result.outcome).toBe("interchange");
    }
    expect(importFile(utf8('{"format":"sessionvault-interchange"}'), "v.json").outcome).toBe("interchange");
  });

  it("keeps the flag of an assumed encoding", () => {
    const result = importFile(utf16le(JSON.stringify(interchange), true), "v.json");
    expect(verdict(result)).toEqual(["interchange", null, ["decoded_as_utf_16le"]]);
  });

  it("only the top-level `format` of a .json file counts", () => {
    const text = JSON.stringify(interchange);
    expect(importFile(utf8(text), "v.txt").outcome).toBe("imported"); // a note, as any text file
    expect(importFile(utf8(`[${text}]`), "v.json").reason).toBe("unrecognised_json");
    expect(importFile(utf8('{"format":"SessionVault-Interchange"}'), "v.json").reason).toBe(
      "unrecognised_json",
    );
    expect(importFile(utf8('{"format":["sessionvault-interchange"]}'), "v.json").reason).toBe(
      "unrecognised_json",
    );
    expect(importFile(utf8('{"data":{"format":"sessionvault-interchange"}}'), "v.json").reason).toBe(
      "unrecognised_json",
    );
    expect(importFile(utf8(text), "v.json", { asPlainText: true }).outcome).toBe("imported");
  });
});

describe("W9 the provider of a link", () => {
  it.each([
    ["https://claude.ai/share/EXAMPLE", "claude"],
    ["https://www.claude.ai/share/EXAMPLE", "claude"],
    ["http://CLAUDE.AI/x", "claude"],
    ["https://chatgpt.com/share/EXAMPLE", "chatgpt"],
    ["https://chat.openai.com/share/EXAMPLE", "chatgpt"],
    ["https://gemini.google.com/share/EXAMPLE", "gemini"],
    ["https://gemini.google/EXAMPLE", "gemini"],
    ["https://share.gemini.google/EXAMPLE", "gemini"],
    ["https://bard.google.com/share/EXAMPLE", "gemini"],
    ["https://g.co/gemini/share/EXAMPLE", "gemini"],
    ["https://x.g.co/gemini", "gemini"],
    // A scheme the URL parser does not know keeps the letter case of its host: the match ignores case.
    ["git://Claude.AI/EXAMPLE", "claude"],
  ])("%s is %s", (url, provider) => {
    expect(providerForUrl(url)).toBe(provider);
  });

  it.each([
    "https://g.co/other/EXAMPLE",
    "https://g.co/",
    "https://openai.com/x",
    "https://google.com/gemini",
    "https://notclaude.ai/x",
    "https://claude.ai.example.invalid/x",
    "https://example.invalid/?from=claude.ai",
    "https://claude.ai./x",
    "claude.ai/share/EXAMPLE",
    "not a link",
    "",
  ])("%j names no provider", (url) => {
    expect(providerForUrl(url)).toBeNull();
  });
});

describe("importPaste: W11", () => {
  const options: PasteOptions = { title: "Pasted session", pickerProvider: "claude" };
  const wall =
    "Sign in\nGemini\nMeet Gemini, your personal AI assistant\nGoogle Terms and the Privacy Policy apply.";

  it("only white space is empty_input (fixture 33)", () => {
    expect(verdict(importPaste("", options))).toEqual(["rejected", "empty_input", []]);
    expect(verdict(importPaste(` \r\n\t${ZWSP}\n`, options))).toEqual(["rejected", "empty_input", []]);
    expect(verdict(importPaste(`${BOM}${NUL}`, options))).toEqual(["rejected", "empty_input", []]);
  });

  it("a text that is just a link is outcome link, and nothing is imported (fixture 31)", () => {
    const result = importPaste("  claude.ai/share/EXAMPLE-0000 \r\n", options);
    expect(result.outcome).toBe("link");
    expect(result.sessions).toEqual([]);
    if (result.outcome === "link") expect(result.linkUrl).toBe("https://claude.ai/share/EXAMPLE-0000");
  });

  it("a word with a full stop is not a link (D12, fixture 32); two links are text", () => {
    expect(turns(importPaste("Thanks.", options))).toEqual([["unknown", "Thanks."]]);
    const two = importPaste("https://example.invalid/a\r\nhttps://example.invalid/b", options);
    expect(turns(two)).toEqual([["unknown", "https://example.invalid/a\nhttps://example.invalid/b"]]);
  });

  it("text that looks like a sign-in page is sign_in_suspected; allowWall imports it (D3, fixture 36)", () => {
    expect(verdict(importPaste(wall, options))).toEqual(["rejected", "sign_in_suspected", []]);
    expect(verdict(importPaste(wall, { ...options, allowWall: false }))).toEqual([
      "rejected",
      "sign_in_suspected",
      [],
    ]);
    const allowed = importPaste(wall, { ...options, allowWall: true });
    expect(allowed.outcome).toBe("imported");
    expect(turns(allowed)).toEqual([["unknown", wall]]);
  });

  it("the link test comes before the wall test, and both before the parsers", () => {
    // A puller header alone would be no_messages; with wall phrases it is flagged first.
    const text = "# Sign in\nSource: privacy policy\n";
    expect(verdict(importPaste(text, options))).toEqual(["rejected", "sign_in_suspected", []]);
    expect(verdict(importPaste(text, { ...options, allowWall: true }))).toEqual([
      "rejected",
      "no_messages",
      [],
    ]);
  });

  it("a puller header without turns is no_messages (W12)", () => {
    expect(verdict(importPaste("# session_EXAMPLE\nSource: https://claude.ai/code/x\n", options))).toEqual([
      "rejected",
      "no_messages",
      [],
    ]);
  });

  it("the picker replaces the provider only when the parsers found none (2.1)", () => {
    const provider = (text: string, picker: PasteOptions["pickerProvider"]): string | undefined =>
      importPaste(text, { title: "t", pickerProvider: picker }).sessions[0]?.provider;
    expect(provider("User: q\nAssistant: a", "gemini")).toBe("gemini");
    expect(provider("User: q\nAssistant: a", "other")).toBe("other");
    expect(provider("User: q\nGemini: a", "chatgpt")).toBe("gemini");
    expect(provider("You said: q\nq\nClaude responded: a\na", "chatgpt")).toBe("claude");
    // Words in the content are never used (W9, D2): the picker labels this one.
    expect(provider("I asked Gemini and it mentioned Claude.", "chatgpt")).toBe("chatgpt");
  });

  it("a given link is stored, and its host decides the provider whatever the picker says (fixture 37)", () => {
    const withLink = (sourceUrl: string, text = "User: q\nClaude: a") =>
      importPaste(text, { title: "t", pickerProvider: "gemini", sourceUrl }).sessions[0];
    expect(withLink("https://chatgpt.com/share/EXAMPLE")).toMatchObject({
      provider: "chatgpt",
      sourceUrl: "https://chatgpt.com/share/EXAMPLE",
    });
    // An unknown host: the link is stored, the labels decide, then the picker.
    expect(withLink("https://example.invalid/x")).toMatchObject({
      provider: "claude",
      sourceUrl: "https://example.invalid/x",
    });
    expect(withLink("https://example.invalid/x", "plain note")).toMatchObject({ provider: "gemini" });
    // No link at all.
    expect(withLink("")).toMatchObject({ provider: "claude", sourceUrl: "" });
  });

  it("a given link replaces the link the text itself names, on every session", () => {
    const text =
      "# one\nSource: https://claude.ai/code/ONE\n\nUser: q\n\n---\n\n# two\nSource: https://claude.ai/code/TWO\n\nUser: q\n";
    const result = importPaste(text, {
      title: "t",
      pickerProvider: "other",
      sourceUrl: "https://gemini.google.com/share/EXAMPLE",
    });
    expect(result.sessions.map((session) => [session.title, session.provider, session.sourceUrl])).toEqual([
      ["one", "gemini", "https://gemini.google.com/share/EXAMPLE"],
      ["two", "gemini", "https://gemini.google.com/share/EXAMPLE"],
    ]);
    const without = importPaste(text, { title: "t", pickerProvider: "other" });
    expect(without.sessions.map((session) => session.sourceUrl)).toEqual([
      "https://claude.ai/code/ONE",
      "https://claude.ai/code/TWO",
    ]);
  });

  it("the link can always be stored: W1 applies to it too (C5)", () => {
    const result = importPaste("note", {
      title: "t",
      pickerProvider: "other",
      sourceUrl: `${BOM}https://claude.ai/share/E${NUL}XAMPLE\r\n`,
    });
    expect(result.sessions[0]).toMatchObject({
      provider: "claude",
      sourceUrl: "https://claude.ai/share/EXAMPLE\n",
    });
  });

  it("the caller's title goes to the parsers, cleaned; a title in the text wins", () => {
    expect(importPaste("note", { title: "  My paste \n", pickerProvider: "other" }).sessions[0]?.title).toBe(
      "My paste",
    );
    expect(importPaste("note", { title: "", pickerProvider: "other" }).sessions[0]?.title).toBe(
      "Imported session",
    );
    expect(importPaste("note", { title: `a${NUL}b\r\nc`, pickerProvider: "other" }).sessions[0]?.title).toBe(
      "ab\nc",
    );
    const puller = importPaste("# from the text\nSource: x\n\nturn", options);
    expect(puller.sessions[0]?.title).toBe("from the text");
  });

  it("text pasted on Windows gives exactly the result of the same text with LF (C3, D1)", () => {
    const lf = "Intro\n\nUser: q\n\n**Assistant:** a\n```sh\nUser: not a marker\n```\n\n## Human\nmore\n";
    expect(importPaste(lf.replaceAll("\n", "\r\n"), options)).toEqual(importPaste(lf, options));
    expect(importPaste(lf.replaceAll("\n", "\r"), options)).toEqual(importPaste(lf, options));
  });

  it("refuses input from outside the type system instead of throwing", () => {
    // @ts-expect-error a caller outside the type system
    expect(verdict(importPaste(null, options))).toEqual(["rejected", "empty_input", []]);
    // @ts-expect-error a caller outside the type system
    expect(verdict(importPaste(42, options))).toEqual(["rejected", "empty_input", []]);
    // @ts-expect-error a caller outside the type system
    expect(importPaste("note", undefined).sessions[0]).toMatchObject({
      title: "Imported session",
      provider: "other",
    });
    // @ts-expect-error a caller outside the type system
    expect(importPaste("note", { title: 5, pickerProvider: "bard", sourceUrl: 7 }).sessions[0]).toMatchObject(
      {
        title: "Imported session",
        provider: "other",
        sourceUrl: "",
      },
    );
  });
});

describe("importCapture: W10", () => {
  const capture = (overrides: Partial<CaptureInput>): CaptureInput => ({
    sourceUrl: "https://claude.ai/share/EXAMPLE-0000",
    detectedTitle: null,
    typedName: "",
    kind: "turns",
    turns: [],
    ...overrides,
  });
  const wall = "Sign in\nMeet Gemini, your personal AI assistant\nGoogle Terms and the Privacy Policy apply.";

  it("no string at all is no_conversation_found (fixture 51)", () => {
    expect(verdict(importCapture(capture({ kind: "turns" })))).toEqual([
      "rejected",
      "no_conversation_found",
      [],
    ]);
    expect(verdict(importCapture(capture({ kind: "page-text" })))).toEqual([
      "rejected",
      "no_conversation_found",
      [],
    ]);
  });

  it("the kind is stated by the capture layer and never guessed from the number of strings", () => {
    // One string that is a harvested turn: the turn steps run, not the text parsers.
    const oneTurn = importCapture(
      capture({ kind: "turns", turns: ["User: q\nAssistant: not a second message\nCopy"] }),
    );
    expect(turns(oneTurn)).toEqual([["user", "q\nAssistant: not a second message"]]);
    // The same string as page text: the text parsers split it and nothing is cleaned.
    const pageText = importCapture(
      capture({ kind: "page-text", turns: ["User: q\nAssistant: a second message\nCopy"] }),
    );
    expect(turns(pageText)).toEqual([
      ["user", "q"],
      ["assistant", "a second message\nCopy"],
    ]);
    // Several strings stated to be page text are one text.
    const joined = importCapture(capture({ kind: "page-text", turns: ["User: q", "Assistant: a"] }));
    expect(turns(joined)).toEqual([
      ["user", "q"],
      ["assistant", "a"],
    ]);
  });

  it("the wall test applies to whole-page text only, and allowWall overrides it (D3, fixtures 44 to 46)", () => {
    expect(verdict(importCapture(capture({ kind: "page-text", turns: [wall] })))).toEqual([
      "rejected",
      "sign_in_suspected",
      [],
    ]);
    const allowed = importCapture(capture({ kind: "page-text", turns: [wall], allowWall: true }));
    expect(turns(allowed)).toEqual([["unknown", wall]]);
    // As harvested turns the same strings are never tested for a wall; chrome stripping judges them.
    const asTurns = importCapture(
      capture({ kind: "turns", turns: ["User: how do I log in?", "Assistant: use the cookie"] }),
    );
    expect(turns(asTurns)).toEqual([
      ["user", "how do I log in?"],
      ["assistant", "use the cookie"],
    ]);
  });

  it("title: the typed name, else the detected title, else the last path segment, else the link", () => {
    const title = (overrides: Partial<CaptureInput>): string | undefined =>
      importCapture(capture({ turns: ["User: q"], ...overrides })).sessions[0]?.title;
    expect(title({ typedName: "  Typed \n", detectedTitle: "Detected" })).toBe("Typed");
    expect(title({ typedName: " \t ", detectedTitle: "  Detected  " })).toBe("Detected");
    expect(title({ detectedTitle: " \n " })).toBe("EXAMPLE-0000");
    expect(title({ sourceUrl: "https://chatgpt.com/share/EXAMPLE-RYE/?x=1#frag" })).toBe("EXAMPLE-RYE");
    expect(title({ sourceUrl: "https://example.invalid/a/Bread%20notes%20%F0%9F%8D%9E" })).toBe(
      `Bread notes ${chr(0x1f35e)}`,
    );
    // Escapes that are not valid UTF-8 stay as they are.
    expect(title({ sourceUrl: "https://example.invalid/a/%E0%A4%A" })).toBe("%E0%A4%A");
  });

  it("a capture of https://host/ is called by its link, not '/' (D13)", () => {
    const title = (sourceUrl: string): string | undefined =>
      importCapture(capture({ turns: ["User: q"], sourceUrl })).sessions[0]?.title;
    expect(title("https://example.invalid/")).toBe("https://example.invalid/");
    expect(title("https://example.invalid")).toBe("https://example.invalid");
    expect(title("not a link")).toBe("not a link");
  });

  describe("the title chain of corrections.md 3, point 6", () => {
    const title = (overrides: Partial<CaptureInput>): string | undefined =>
      importCapture(capture({ turns: ["User: q"], ...overrides })).sessions[0]?.title;
    // Blank for the full trim, though not for the inline trim: U+000B, U+000C, U+0085, U+2028, U+2029.
    const blankOnlyForTheFullTrim = `${VT}${FF}${NEL}${LS}${PS}`;

    it("1. the typed name, through W1 and the full trim", () => {
      expect(title({ typedName: `${BOM}${BOM}Ty${NUL}ped\r\n`, detectedTitle: "Detected" })).toBe("Typed");
      expect(title({ typedName: `${LS}Typed${NEL}`, detectedTitle: "Detected" })).toBe("Typed");
      expect(title({ typedName: `a${HIGH}b` })).toBe(`a${REPLACEMENT}b`);
    });

    it("2. else the detected title, through W1 and the full trim", () => {
      expect(title({ typedName: "", detectedTitle: `${BOM}De${NUL}tected ${PS}` })).toBe("Detected");
      // A typed name that is empty only after the full trim does not count (point 8).
      expect(title({ typedName: blankOnlyForTheFullTrim, detectedTitle: "Detected" })).toBe("Detected");
      expect(title({ typedName: `${BOM}${NUL} \r\n`, detectedTitle: "Detected" })).toBe("Detected");
    });

    it("3. else the last non-empty path segment of the link, percent-decoded, through W1 and the full trim", () => {
      const blank = { typedName: " ", detectedTitle: blankOnlyForTheFullTrim };
      expect(title({ ...blank, sourceUrl: "https://example.invalid/a/%20Bread%20notes%20%0A" })).toBe(
        "Bread notes",
      );
      expect(title({ ...blank, sourceUrl: "https://example.invalid/first/second//" })).toBe("second");
      // What the decoded segment can hold and a title must not: U+0000, CR, a mark at the start.
      expect(title({ ...blank, sourceUrl: "https://example.invalid/a%00b%0D%0Ac" })).toBe("ab\nc");
      expect(title({ ...blank, sourceUrl: "https://example.invalid/%EF%BB%BF%EF%BB%BFx" })).toBe("x");
      // If decoding fails, the segment as written.
      expect(title({ ...blank, sourceUrl: "https://example.invalid/a/%E0%A4%A" })).toBe("%E0%A4%A");
      expect(title({ ...blank, sourceUrl: "https://example.invalid/100%" })).toBe("100%");
    });

    it("4. else the link itself, through W1 and the full trim", () => {
      // No path segment at all.
      expect(title({ sourceUrl: "https://example.invalid/" })).toBe("https://example.invalid/");
      expect(title({ sourceUrl: `${BOM}https://example.invalid${NUL}/\r\n` })).toBe(
        "https://example.invalid/",
      );
      expect(title({ sourceUrl: `  not a link ${LS}` })).toBe("not a link");
      // A last path segment that is empty after decoding and the full trim does not count.
      expect(title({ sourceUrl: "https://example.invalid/a/%20%09" })).toBe(
        "https://example.invalid/a/%20%09",
      );
      expect(title({ sourceUrl: "https://example.invalid/a/%E2%80%A8%C2%85" })).toBe(
        "https://example.invalid/a/%E2%80%A8%C2%85",
      );
      expect(title({ sourceUrl: "https://example.invalid/a/%00" })).toBe("https://example.invalid/a/%00");
    });

    it("5. and last the constant 'Captured session'", () => {
      expect(title({ sourceUrl: "" })).toBe("Captured session");
      expect(title({ sourceUrl: " \t " })).toBe("Captured session");
      expect(title({ sourceUrl: `${BOM}${NUL}\r\n` })).toBe("Captured session");
      expect(title({ sourceUrl: blankOnlyForTheFullTrim, typedName: blankOnlyForTheFullTrim })).toBe(
        "Captured session",
      );
      // The same for whole-page text, where the capture title always replaces the parser's.
      expect(title({ kind: "page-text", sourceUrl: "", turns: ["a page of text"] })).toBe("Captured session");
    });

    it("so a title is never blank and never holds U+0000, whatever the three strings are", () => {
      const pieces = [
        BOM,
        NUL,
        "\r",
        "\n",
        " ",
        "\t",
        VT,
        FF,
        NEL,
        LS,
        PS,
        ZWSP,
        HIGH,
        "%00",
        "%20",
        "/",
        "a",
      ];
      const piece = fc.constantFrom(...pieces);
      const text = fc.array(piece, { maxLength: 6 }).map((parts) => parts.join(""));
      const link = fc.oneof(
        text,
        text.map((path) => `https://example.invalid/${path}`),
      );
      let fallbacks = 0;
      fc.assert(
        fc.property(text, fc.option(text, { nil: null }), link, (typedName, detectedTitle, sourceUrl) => {
          const found = title({ typedName, detectedTitle, sourceUrl });
          if (found === undefined) throw new Error("no session");
          expect(found).not.toBe("");
          expect(trimFull(found)).toBe(found);
          expect(found.includes(NUL)).toBe(false);
          expect(found.includes("\r")).toBe(false);
          expect(hasLoneSurrogate(found)).toBe(false);
          if (found === "Captured session") fallbacks++;
        }),
        { seed: 20261120, numRuns: 2000 },
      );
      expect(fallbacks).toBeGreaterThan(20);
    });
  });

  it("page text: the capture title always wins, also over a puller header in the text (D13)", () => {
    const text = "# from the page\nSource: https://chatgpt.com/share/OTHER\n\nUser: q\n";
    const session = importCapture(
      capture({
        kind: "page-text",
        turns: [text],
        typedName: "Typed",
        sourceUrl: "https://example.invalid/x",
      }),
    ).sessions[0];
    expect(session).toMatchObject({
      title: "Typed",
      sourceUrl: "https://example.invalid/x",
      provider: "chatgpt",
    });
  });

  it("page text: the host of the link decides the provider when it is a known one (D2, fixture 48)", () => {
    const provider = (sourceUrl: string, text: string): string | undefined =>
      importCapture(capture({ kind: "page-text", turns: [text], sourceUrl })).sessions[0]?.provider;
    const page = "Gemini\nA long page that mentions Claude and has no speaker labels at all.";
    expect(provider("https://gemini.google.com/share/EXAMPLE", page)).toBe("gemini");
    expect(provider("https://example.invalid/share/EXAMPLE", page)).toBe("other");
    expect(provider("https://example.invalid/share/EXAMPLE", "User: q\nChatGPT: a")).toBe("chatgpt");
    expect(provider("https://claude.ai/share/EXAMPLE", "User: q\nChatGPT: a")).toBe("claude");
  });

  it("page text with nothing to store is no_conversation_found", () => {
    expect(verdict(importCapture(capture({ kind: "page-text", turns: [" \n "] })))).toEqual([
      "rejected",
      "no_conversation_found",
      [],
    ]);
    expect(verdict(importCapture(capture({ kind: "page-text", turns: ["# t\nSource: x\n"] })))).toEqual([
      "rejected",
      "no_conversation_found",
      [],
    ]);
  });

  it("turns: header lines and the chrome test on the raw turn, then the cleaner, the trim, the marker", () => {
    const result = importCapture(
      capture({
        turns: [
          "AI Overview",
          "Shared conversation\n\n  User: q  \nCopy\n10:42 AM",
          "Searched the web\nSearched the web\n  indented stays  \nAssistant: not a marker here",
          "This assistant can make mistakes.",
        ],
      }),
    );
    expect(turns(result)).toEqual([
      ["user", "q"],
      ["unknown", "Searched the web\n  indented stays\nAssistant: not a marker here"],
    ]);
    expect(result.droppedTurns).toEqual([
      { position: "leading", index: 0, text: "AI Overview" },
      { position: "trailing", index: 3, text: "This assistant can make mistakes." },
    ]);
  });

  it("turns: a turn that is only a label, or only furniture, gives no message (W12, fixture 52)", () => {
    const result = importCapture(
      capture({ turns: ["User: q", "Assistant", "User:", "Copy\n10:42", " \n", "Claude: a"] }),
    );
    expect(turns(result)).toEqual([
      ["user", "q"],
      ["assistant", "a"],
    ]);
  });

  it("turns: provider from the host of the link, else from the labels, else other (W9, fixture 40)", () => {
    const provider = (sourceUrl: string, list: string[]): string | undefined =>
      importCapture(capture({ sourceUrl, turns: list })).sessions[0]?.provider;
    expect(provider("https://chatgpt.com/share/EXAMPLE", ["User: q", "Gemini: a"])).toBe("chatgpt");
    expect(provider("https://chat.openai.com/share/EXAMPLE", ["q"])).toBe("chatgpt");
    expect(provider("https://share.gemini.google/EXAMPLE", ["q"])).toBe("gemini");
    expect(provider("https://g.co/gemini/share/EXAMPLE", ["q"])).toBe("gemini");
    expect(provider("https://g.co/other/EXAMPLE", ["q"])).toBe("other");
    expect(provider("https://bard.google.com/share/EXAMPLE", ["q"])).toBe("gemini");
    expect(provider("https://www.claude.ai/share/EXAMPLE", ["q"])).toBe("claude");
    expect(provider("https://notclaude.ai/share/EXAMPLE", ["q"])).toBe("other");
    expect(provider("https://claude.ai.example.invalid/share/EXAMPLE", ["q"])).toBe("other");
    expect(provider("https://example.invalid/?from=claude.ai", ["User: q", "Gemini: a", "Gemini"])).toBe(
      "gemini",
    );
    // A label counts even when its turn gives no message.
    expect(provider("https://example.invalid/x", ["User: q", "Gemini"])).toBe("gemini");
  });

  it("turns: when nothing is left the dropped turns are still reported (fixture 50)", () => {
    const result = importCapture(capture({ turns: ["Sign in", "Assistant", "can make mistakes"] }));
    expect(verdict(result)).toEqual(["rejected", "no_conversation_found", []]);
    expect(result.droppedTurns).toEqual([
      { position: "leading", index: 0, text: "Sign in" },
      { position: "trailing", index: 2, text: "can make mistakes" },
    ]);
  });

  it("W1 on each string: CR LF, NUL and a leading U+FEFF do not change the result", () => {
    const plain = ["User: q\nmore", "Assistant: a\n```\ncode\n```"];
    const dirty = [`${BOM}User: q\r\nmo${NUL}re`, "Assistant: a\r```\rcode\r```"];
    expect(importCapture(capture({ turns: dirty }))).toEqual(importCapture(capture({ turns: plain })));
  });

  it("refuses input from outside the type system instead of throwing", () => {
    const wrong: unknown[] = [
      null,
      undefined,
      "text",
      {},
      { turns: "User: q", kind: "turns" },
      { turns: ["User: q", 5], kind: "turns" },
      { turns: ["User: q"], kind: "guess" },
      { turns: ["User: q"] },
    ];
    for (const value of wrong) {
      // @ts-expect-error a caller outside the type system
      expect(verdict(importCapture(value))).toEqual(["rejected", "no_conversation_found", []]);
    }
    // Missing names and link are treated as empty: the last title of the chain is left.
    // @ts-expect-error a caller outside the type system
    expect(importCapture({ kind: "turns", turns: ["User: q"] }).sessions[0]).toMatchObject({
      title: "Captured session",
      sourceUrl: "",
      provider: "other",
    });
    const mistyped = { kind: "turns", turns: ["User: q"], typedName: 5, detectedTitle: {}, sourceUrl: [] };
    // @ts-expect-error a caller outside the type system
    expect(importCapture(mistyped).sessions[0]).toMatchObject({ title: "Captured session", sourceUrl: "" });
  });
});

describe("corrections.md 3, point 7: W1 applies to every stored string", () => {
  // Two marks at the start, U+0000, CR LF, a lone surrogate and a lone CR: everything W1 acts on.
  const dirty = `${BOM}${BOM}a${NUL}b\r\nc${HIGH}\rd`;
  const clean = `ab\nc${REPLACEMENT}\nd`;
  const captureOf = (overrides: Partial<CaptureInput>): CaptureInput => ({
    sourceUrl: "https://example.invalid/share/EXAMPLE",
    detectedTitle: null,
    typedName: "",
    kind: "turns",
    turns: ["User: q"],
    ...overrides,
  });

  it("the title passed by the caller", () => {
    expect(importPaste("note", { title: dirty, pickerProvider: "other" }).sessions[0]?.title).toBe(clean);
    // Also where a parser other than the generic one uses it: share-page text, a puller file without a title.
    expect(importPaste("You said: q\nq", { title: dirty, pickerProvider: "other" }).sessions[0]?.title).toBe(
      clean,
    );
    expect(
      importPaste("# \nSource: x\n\nturn", { title: dirty, pickerProvider: "other" }).sessions[0]?.title,
    ).toBe(clean);
  });

  it("the source link, of a paste and of a capture of either kind", () => {
    const pasted = importPaste("note", { title: "t", pickerProvider: "other", sourceUrl: dirty });
    expect(pasted.sessions[0]?.sourceUrl).toBe(clean);
    expect(importCapture(captureOf({ sourceUrl: dirty })).sessions[0]?.sourceUrl).toBe(clean);
    expect(importCapture(captureOf({ sourceUrl: dirty, kind: "page-text" })).sessions[0]?.sourceUrl).toBe(
      clean,
    );
    // The link stays as written otherwise: W1, not a trim.
    const padded = importPaste("note", { title: "t", pickerProvider: "other", sourceUrl: "  x \n" });
    expect(padded.sessions[0]?.sourceUrl).toBe("  x \n");
  });

  it("the file-name stem", () => {
    expect(importFile(utf8("note"), `${dirty}.txt`).sessions[0]?.title).toBe(clean);
    expect(importFile(utf8("You said: q\nq"), `${dirty}.md`).sessions[0]?.title).toBe(clean);
    expect(importFile(utf8("# \nSource: x\n\nturn"), `${dirty}.md`).sessions[0]?.title).toBe(clean);
  });

  it("the typed name and the detected title of a capture", () => {
    expect(importCapture(captureOf({ typedName: dirty })).sessions[0]?.title).toBe(clean);
    expect(importCapture(captureOf({ detectedTitle: dirty })).sessions[0]?.title).toBe(clean);
    expect(importCapture(captureOf({ typedName: dirty, kind: "page-text" })).sessions[0]?.title).toBe(clean);
  });

  it("the strings a file itself carries: a puller title and link, a ChatGPT title, each message, each dropped turn", () => {
    const puller = importFile(utf8(`# ti${NUL}tle\r\nSource: li${NUL}nk\r\n\r\nUser: q${HIGH}\r\n`), "p.md");
    expect(puller.sessions[0]).toMatchObject({
      title: "title",
      sourceUrl: "link",
      messages: [{ role: "user", text: `q${REPLACEMENT}` }],
    });
    const exported = JSON.stringify({ title: dirty, mapping: { a: node("user", dirty) } });
    expect(importFile(utf8(exported), "c.json").sessions[0]).toMatchObject({
      title: clean,
      messages: [{ role: "user", text: clean }],
    });
    const dropped = importCapture(captureOf({ turns: [`${BOM}Sign${NUL} in\r\n`, "User: q"] })).droppedTurns;
    expect(dropped).toEqual([{ position: "leading", index: 0, text: "Sign in\n" }]);
  });
});
