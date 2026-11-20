// Bytes to text: the decision table of docs/import-rules.md W2, row by row, and the file
// name rule of 2.1.

import { describe, expect, it } from "vitest";
import { decodeBytes } from "./decode.ts";
import { splitFileName } from "./file-name.ts";

const chr = (code: number): string => String.fromCodePoint(code);
const BOM = chr(0xfeff);
const REPLACEMENT = chr(0xfffd);

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function utf16(text: string, order: "le" | "be"): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (order === "le") out.push(unit & 0xff, unit >> 8);
    else out.push(unit >> 8, unit & 0xff);
  }
  return out;
}

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe("W2 decode bytes explicitly", () => {
  it("plain ASCII and UTF-8 are UTF-8, without a flag", () => {
    expect(decodeBytes(bytes(...ascii("User: hello\n")))).toEqual({ text: "User: hello\n", flag: null });
    // "caf" + e with acute accent + a bicycle, as UTF-8
    expect(decodeBytes(bytes(0x63, 0x61, 0x66, 0xc3, 0xa9, 0xf0, 0x9f, 0x9a, 0xb2))).toEqual({
      text: `caf${chr(0xe9)}${chr(0x1f6b2)}`,
      flag: null,
    });
  });

  it("starts with EF BB BF: UTF-8, strict; the mark is consumed (fixtures 03, 08)", () => {
    expect(decodeBytes(bytes(0xef, 0xbb, 0xbf, ...ascii("# x")))).toEqual({ text: "# x", flag: null });
  });

  it("a second byte-order mark is left for W1 to remove", () => {
    expect(decodeBytes(bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41))).toEqual({
      text: `${BOM}A`,
      flag: null,
    });
  });

  it("starts with FF FE: UTF-16LE, flagged (fixture 24)", () => {
    expect(decodeBytes(bytes(0xff, 0xfe, ...utf16(`User: caf${chr(0xe9)}`, "le")))).toEqual({
      text: `User: caf${chr(0xe9)}`,
      flag: "decoded_as_utf_16le",
    });
  });

  it("starts with FE FF: UTF-16BE, flagged", () => {
    expect(decodeBytes(bytes(0xfe, 0xff, ...utf16("User: hi", "be")))).toEqual({
      text: "User: hi",
      flag: "decoded_as_utf_16be",
    });
  });

  it("a UTF-16 byte-order mark decides, also for text without a single zero byte", () => {
    // Two tea characters (U+8336): no zeros, so the test for UTF-16 without a mark would not fire.
    expect(decodeBytes(bytes(0xff, 0xfe, 0x36, 0x83, 0x36, 0x83))).toEqual({
      text: chr(0x8336) + chr(0x8336),
      flag: "decoded_as_utf_16le",
    });
    expect(decodeBytes(bytes(0xfe, 0xff, 0x83, 0x36, 0x83, 0x36))).toEqual({
      text: chr(0x8336) + chr(0x8336),
      flag: "decoded_as_utf_16be",
    });
  });

  it("no byte-order mark, zeros in the second bytes: UTF-16LE, flagged (D10)", () => {
    expect(decodeBytes(bytes(...utf16("User: hello there", "le")))).toEqual({
      text: "User: hello there",
      flag: "decoded_as_utf_16le",
    });
  });

  it("no byte-order mark, zeros in the first bytes: UTF-16BE, flagged", () => {
    expect(decodeBytes(bytes(...utf16("User: hello there", "be")))).toEqual({
      text: "User: hello there",
      flag: "decoded_as_utf_16be",
    });
  });

  it("the test for UTF-16 looks at pairs: exactly 40 % zeros in one column and 5 % in the other is enough", () => {
    // 20 pairs. Second bytes: 8 zeros of 20 = 40 %. First bytes: 1 zero of 20 = 5 %.
    const pairs: number[] = [];
    for (let pair = 0; pair < 20; pair++) pairs.push(pair === 0 ? 0x00 : 0x41, pair < 8 ? 0x00 : 0x42);
    expect(decodeBytes(bytes(...pairs))?.flag).toBe("decoded_as_utf_16le");
    // One zero fewer in the second bytes: 35 %. Not UTF-16; the bytes are valid UTF-8.
    pairs[15] = 0x42;
    expect(decodeBytes(bytes(...pairs))?.flag).toBe(null);
    // Two zeros in the first bytes: 10 %. Not UTF-16 either.
    pairs[15] = 0x00;
    pairs[2] = 0x00;
    expect(decodeBytes(bytes(...pairs))?.flag).toBe(null);
  });

  it("the test for UTF-16 looks at the first 4096 bytes only", () => {
    const head = utf16("a".repeat(2048), "le"); // 4096 bytes that look like UTF-16LE
    const tail = ascii("x".repeat(6000)); // no zeros at all
    expect(decodeBytes(bytes(...head, ...tail))?.flag).toBe("decoded_as_utf_16le");
    const plainHead = ascii("x".repeat(4096));
    expect(decodeBytes(bytes(...plainHead, ...utf16("a".repeat(3000), "le")))?.flag).toBe(null);
    // 100 bytes that look like UTF-16LE, then plain text: over 4096 bytes the zeros are far below 40 %.
    const mixed = bytes(...utf16("a".repeat(50), "le"), ...ascii("x".repeat(3996)));
    expect(decodeBytes(mixed)?.flag).toBe(null);
  });

  it("an odd number of bytes is rounded down for the test, and the text is still decoded", () => {
    const odd = [...utf16("hello", "le"), 0x21];
    expect(decodeBytes(bytes(...odd))).toEqual({ text: `hello${REPLACEMENT}`, flag: "decoded_as_utf_16le" });
  });

  it("a single pair says nothing: two or three bytes are never taken for UTF-16 without a mark", () => {
    // W2 names no smallest sample; this follows the reference port.
    expect(decodeBytes(bytes(0x41, 0x00))).toEqual({ text: "A\u0000", flag: null });
    expect(decodeBytes(bytes(0x00, 0x41))).toEqual({ text: "\u0000A", flag: null });
    expect(decodeBytes(bytes(0x41, 0x00, 0x42))).toEqual({ text: "A\u0000B", flag: null });
    expect(decodeBytes(bytes(0x41, 0x00, 0x42, 0x00))?.flag).toBe("decoded_as_utf_16le");
  });

  it("not UTF-8 and no control bytes: windows-1252, flagged (fixture 25)", () => {
    // "caf" + E9, an en dash (96) and curly quotes (93, 94)
    expect(decodeBytes(bytes(0x63, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x93, 0x78, 0x94))).toEqual({
      text: `caf${chr(0xe9)} ${chr(0x2013)} ${chr(0x201c)}x${chr(0x201d)}`,
      flag: "decoded_as_windows_1252",
    });
  });

  it("windows-1252 gives every byte a character: the five unassigned ones become C1 controls", () => {
    const decoded = decodeBytes(bytes(0x80, 0x81, 0x8d, 0x8f, 0x90, 0x9d, 0x9f, 0xff));
    expect(decoded?.flag).toBe("decoded_as_windows_1252");
    expect(Array.from(decoded?.text ?? "", (character) => character.charCodeAt(0))).toEqual([
      0x20ac, 0x81, 0x8d, 0x8f, 0x90, 0x9d, 0x178, 0xff,
    ]);
  });

  it("not UTF-8 and a control byte other than 09, 0A, 0C, 0D: not text", () => {
    expect(decodeBytes(bytes(0xff, 0x41, 0x00, 0x42, 0x43, 0x44, 0x45, 0x46))).toBeNull(); // NUL
    expect(decodeBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull(); // the start of a PNG file
    expect(decodeBytes(bytes(0xe9, 0x1f))).toBeNull();
    expect(decodeBytes(bytes(0xe9, 0x0b))).toBeNull(); // 0B is not on the list
    // The four that text may have:
    expect(decodeBytes(bytes(0xe9, 0x09, 0x0a, 0x0c, 0x0d))?.flag).toBe("decoded_as_windows_1252");
  });

  it("valid UTF-8 with control bytes is still UTF-8: W1 deals with U+0000 later", () => {
    expect(decodeBytes(bytes(0x41, 0x00, 0x1b, 0x42, 0x43, 0x44, 0x45))).toEqual({
      text: "A\u0000\u001bBCDE",
      flag: null,
    });
  });

  it("a UTF-8 mark in front of bytes that are not UTF-8 falls through to the later rows", () => {
    expect(decodeBytes(bytes(0xef, 0xbb, 0xbf, 0xe9))?.flag).toBe("decoded_as_windows_1252");
    expect(decodeBytes(bytes(0xef, 0xbb, 0xbf, 0xe9, 0x00))).toBeNull();
  });

  it("UTF-16 is decoded leniently: an unpaired surrogate becomes U+FFFD, as W1 would make it", () => {
    // FF FE, a lone high surrogate D800, then "A". The reference port does the same.
    expect(decodeBytes(bytes(0xff, 0xfe, 0x00, 0xd8, 0x41, 0x00))).toEqual({
      text: `${REPLACEMENT}A`,
      flag: "decoded_as_utf_16le",
    });
  });

  it("zero bytes decode to the empty text (importFile rejects them before decoding)", () => {
    expect(decodeBytes(bytes())).toEqual({ text: "", flag: null });
  });
});

describe("2.1 file names", () => {
  it.each([
    ["notes.txt", "txt", "notes"],
    ["my.session.notes.md", "md", "my.session.notes"],
    ["conversations.JSON", "JSON", "conversations"],
    ["README", "", "README"],
    [".notes", "", ".notes"],
    [".json", "", ".json"],
    ["name.", "", "name."],
    ["Mr. Smith notes", "", "Mr. Smith notes"],
    ["", "", ""],
    ["a.b c.md", "md", "a.b c"],
    ["archive.tar.gz", "gz", "archive.tar"],
  ])("%j has extension %j and title %j", (filename, extension, stem) => {
    expect(splitFileName(filename)).toEqual({ stem, extension });
  });
});
