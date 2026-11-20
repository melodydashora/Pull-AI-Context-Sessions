/// <reference types="node" />
// The small building blocks: SHA-256, base64, string hygiene, timestamps, JSON equality.
// Each is compared with the platform's own implementation, which the product code may not use.
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import { assemble, type JsonValue, jsonEqual, newObject, unknownProperties } from "./json.ts";
import { sha256Hex } from "./sha256.ts";
import {
  cleanString,
  hasCarriageReturn,
  hasNulOrLoneSurrogate,
  normaliseLineEndings,
  utf8ByteLength,
} from "./text.ts";
import { dateToTimestamp, formatTimestamp, hasTimestampShape, parseTimestamp } from "./timestamp.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const encoder = new TextEncoder();

/** A value as JSON text would deliver it. */
function reparse(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value));
}

/** A form in which two JSON values are equal exactly when their text is: object keys sorted, containers tagged. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return ["array", ...value.map(sortKeys)];
  if (typeof value !== "object" || value === null) return value;
  const sorted = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return ["object", ...sorted.map(([key, item]) => [key, sortKeys(item)])];
}

function nodeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("sha256Hex", () => {
  it("gives the published digests", () => {
    // FIPS 180-4 examples and the digest of no bytes.
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(encoder.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("agrees with the platform at every length around the block boundaries", () => {
    for (let length = 0; length <= 200; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 31 + length) & 255;
      expect(sha256Hex(bytes)).toBe(nodeSha256(bytes));
    }
  });

  it("agrees with the platform on random bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(nodeSha256(bytes));
      }),
      { numRuns: 300 },
    );
  });

  it("hashes a view into a larger buffer, not the buffer", () => {
    const buffer = new Uint8Array(300).map((_, i) => i & 255);
    const view = buffer.subarray(7, 207);
    expect(sha256Hex(view)).toBe(nodeSha256(view));
  });
});

describe("base64", () => {
  it("encodes the RFC 4648 examples", () => {
    const cases: [string, string][] = [
      ["", ""],
      ["f", "Zg=="],
      ["fo", "Zm8="],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg=="],
      ["fooba", "Zm9vYmE="],
      ["foobar", "Zm9vYmFy"],
    ];
    for (const [plain, encoded] of cases) {
      expect(encodeBase64(encoder.encode(plain))).toBe(encoded);
      expect(decodeBase64(encoded)).toEqual(encoder.encode(plain));
    }
  });

  it("agrees with the platform in both directions", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 30_000 }), (bytes) => {
        const expected = Buffer.from(bytes).toString("base64");
        expect(encodeBase64(bytes)).toBe(expected);
        expect(decodeBase64(expected)).toEqual(bytes);
      }),
      { numRuns: 300 },
    );
  });

  it("accepts padding as optional and refuses everything that cannot be decoded (corrections.md 2, point 7)", () => {
    // Only A-Z a-z 0-9 + /, then at most two "="; without the "=" the length is not 1 modulo 4.
    expect(decodeBase64("Zg")).toEqual(encoder.encode("f"));
    expect(decodeBase64("Zm8")).toEqual(encoder.encode("fo"));
    expect(decodeBase64("Zg==")).toEqual(encoder.encode("f"));
    expect(decodeBase64("Zm8=")).toEqual(encoder.encode("fo"));
    // Whether the "=" complete a group of four is not asked: length and hash judge the bytes.
    expect(decodeBase64("Zg=")).toEqual(encoder.encode("f"));
    expect(decodeBase64("Zm8==")).toEqual(encoder.encode("fo"));
    expect(decodeBase64("Zm9v=")).toEqual(encoder.encode("foo"));
    expect(decodeBase64("Zm9v==")).toEqual(encoder.encode("foo"));
    expect(decodeBase64("")).toEqual(new Uint8Array(0));
    expect(decodeBase64("=")).toEqual(new Uint8Array(0));
    expect(decodeBase64("==")).toEqual(new Uint8Array(0));
    for (const bad of [
      // The length without "=" is 1 modulo 4.
      "Z",
      "Z=",
      "Z==",
      "Zm9vZ",
      "Zm9vZ==",
      // More than two "=", or one that is not at the end.
      "Zg===",
      "====",
      "Z===",
      "Zg=g",
      "=Zg",
      // White space, and the URL-safe alphabet.
      "Zm 9v",
      " Zm9v",
      "Zm9v ",
      "Zm9v\n",
      "Zm9v\r\n",
      "Zm\t9v",
      "Zm9-",
      "Zm9_",
      // Anything else.
      `Z${String.fromCodePoint(0xe9)}==`,
      "Zm9v.",
      "Zm9v\u0000",
    ]) {
      expect(decodeBase64(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("decodes exactly what the rule admits: the schema's pattern, and a length that is not 1 modulo 4", () => {
    const pattern = /^[A-Za-z0-9+/]*={0,2}$/u;
    const alphabet = fc.constantFrom(..."ABab01+/=-_ \n");
    let decoded = 0;
    fc.assert(
      fc.property(fc.string({ unit: alphabet, maxLength: 12 }), (text) => {
        let end = text.length;
        while (end > 0 && text[end - 1] === "=") end -= 1;
        const admitted = pattern.test(text) && end % 4 !== 1;
        expect(decodeBase64(text) !== null, JSON.stringify(text)).toBe(admitted);
        if (admitted) decoded += 1;
      }),
      { numRuns: 4000 },
    );
    expect(decoded).toBeGreaterThan(50);
  });
});

describe("string hygiene", () => {
  it("counts UTF-8 bytes like an encoder", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("a\u00E9\u20AC\u{1F600}")).toBe(1 + 2 + 3 + 4);
    expect(utf8ByteLength("\uD800")).toBe(3);
    expect(utf8ByteLength("\uDC00x")).toBe(4);
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), fc.string({ unit: "grapheme" }), (a, b) => {
        expect(utf8ByteLength(a + b)).toBe(encoder.encode(a + b).length);
      }),
      { numRuns: 500 },
    );
  });

  it("finds and removes U+0000 and lone surrogates (R9, repair 5)", () => {
    expect(hasNulOrLoneSurrogate("plain \u{1F600} text")).toBe(false);
    expect(hasNulOrLoneSurrogate("a\u0000b")).toBe(true);
    expect(hasNulOrLoneSurrogate("a\uD83Db")).toBe(true);
    expect(hasNulOrLoneSurrogate("a\uDE00b")).toBe(true);
    expect(cleanString("a\u0000b\u0000")).toBe("ab");
    expect(cleanString("a\uD83Db\uDE00c")).toBe("a\uFFFDb\uFFFDc");
    expect(cleanString("ok \u{1F600}")).toBe("ok \u{1F600}");
    // Removing the NUL joins the two halves into one valid pair, so nothing is replaced.
    expect(cleanString("\uD83D\u0000\uDE00")).toBe("\u{1F600}");
  });

  it("cleans every string into one that needs no cleaning", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        const cleaned = cleanString(text);
        expect(hasNulOrLoneSurrogate(cleaned)).toBe(false);
        expect(cleanString(cleaned)).toBe(cleaned);
        if (!hasNulOrLoneSurrogate(text)) expect(cleaned).toBe(text);
      }),
      { numRuns: 1000 },
    );
  });

  it("turns CR LF and CR into LF (R10, repair 5)", () => {
    expect(hasCarriageReturn("a\nb")).toBe(false);
    expect(hasCarriageReturn("a\r\nb")).toBe(true);
    expect(normaliseLineEndings("a\r\nb\rc\n\rd\r\r\n")).toBe("a\nb\nc\n\nd\n\n");
    expect(normaliseLineEndings("a\nb")).toBe("a\nb");
  });
});

describe("timestamps", () => {
  it("reads both written forms and cuts to milliseconds", () => {
    const plain = parseTimestamp("2026-03-14T09:30:00Z");
    expect(plain).toEqual({
      ok: true,
      ms: Date.UTC(2026, 2, 14, 9, 30, 0),
      canonical: "2026-03-14T09:30:00.000Z",
      lossy: false,
    });
    expect(parseTimestamp("2026-03-14T09:30:00.5Z")).toMatchObject({
      canonical: "2026-03-14T09:30:00.500Z",
      lossy: false,
    });
    expect(parseTimestamp("2026-03-14T09:30:00.482Z")).toMatchObject({
      canonical: "2026-03-14T09:30:00.482Z",
      lossy: false,
    });
    expect(parseTimestamp("2026-03-14T09:30:00.482000000Z")).toMatchObject({ lossy: false });
    expect(parseTimestamp("2026-03-14T09:30:00.999999999Z")).toMatchObject({
      ms: Date.UTC(2026, 2, 14, 9, 30, 0, 999),
      canonical: "2026-03-14T09:30:00.999Z",
      lossy: true,
    });
  });

  it("refuses shapes the schema refuses", () => {
    for (const bad of [
      "",
      "2026-03-14",
      "2026-03-14T09:30:00",
      "2026-03-14T09:30:00+00:00",
      "2026-03-14t09:30:00Z",
      "2026-03-14T09:30:00z",
      "2026-03-14 09:30:00Z",
      "2026-03-14T09:30:00.Z",
      "2026-03-14T09:30:00.1234567890Z",
      "2026-3-14T09:30:00Z",
      " 2026-03-14T09:30:00Z",
      "2026-03-14T09:30:00Z\n",
      "\u0662\u0660\u0662\u0666-03-14T09:30:00Z",
    ]) {
      expect(parseTimestamp(bad), bad).toEqual({ ok: false, reason: "pattern" });
      expect(hasTimestampShape(bad), bad).toBe(false);
    }
  });

  it("refuses instants that do not exist (R1)", () => {
    for (const bad of [
      "2026-02-30T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "1900-02-29T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-00-10T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-01-00T00:00:00Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T23:60:00Z",
      "2026-12-31T23:59:60Z",
    ]) {
      expect(parseTimestamp(bad), bad).toEqual({ ok: false, reason: "calendar" });
      expect(hasTimestampShape(bad), bad).toBe(true);
    }
    expect(parseTimestamp("2024-02-29T00:00:00Z").ok).toBe(true);
    expect(parseTimestamp("2000-02-29T00:00:00Z").ok).toBe(true);
  });

  it("the year is 0001 to 9999 (corrections.md 2, point 8)", () => {
    expect(parseTimestamp("0001-01-01T00:00:00Z")).toMatchObject({ ms: -62_135_596_800_000 });
    expect(parseTimestamp("9999-12-31T23:59:59.999Z")).toMatchObject({ ms: 253_402_300_799_999 });
    // The schema's pattern admits the year 0000; it is no year of the calendar.
    for (const text of ["0000-01-01T00:00:00Z", "0000-12-31T23:59:59.999Z", "0000-02-29T12:00:00.5Z"]) {
      expect(hasTimestampShape(text), text).toBe(true);
      expect(parseTimestamp(text), text).toEqual({ ok: false, reason: "calendar" });
    }
    expect(formatTimestamp(-62_135_596_800_000)).toBe("0001-01-01T00:00:00.000Z");
    expect(formatTimestamp(253_402_300_799_999)).toBe("9999-12-31T23:59:59.999Z");
    expect(formatTimestamp(253_402_300_800_000)).toBeNull();
    expect(formatTimestamp(-62_135_596_800_001)).toBeNull();
    expect(formatTimestamp(-62_167_219_200_000)).toBeNull();
    expect(formatTimestamp(Number.NaN)).toBeNull();
    expect(formatTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
    expect(dateToTimestamp(new Date(Number.NaN))).toBeNull();
    expect(dateToTimestamp(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
  });

  it("writing cuts a fraction of a millisecond, never rounds: the text is never later than the instant", () => {
    expect(formatTimestamp(1.9)).toBe("1970-01-01T00:00:00.001Z");
    expect(formatTimestamp(0.999)).toBe("1970-01-01T00:00:00.000Z");
    expect(formatTimestamp(-0.5)).toBe("1969-12-31T23:59:59.999Z");
    expect(formatTimestamp(-1.000001)).toBe("1969-12-31T23:59:59.998Z");
    expect(formatTimestamp(253_402_300_799_999.5)).toBe("9999-12-31T23:59:59.999Z");
    expect(formatTimestamp(-62_135_596_800_000.5)).toBeNull();
  });

  it("agrees with the platform's calendar for every instant it can write", () => {
    fc.assert(
      fc.property(fc.integer({ min: -62_135_596_800_000, max: 253_402_300_799_999 }), (ms) => {
        const text = formatTimestamp(ms);
        expect(text).toBe(new Date(ms).toISOString());
        if (text === null) return;
        expect(parseTimestamp(text)).toEqual({ ok: true, ms, canonical: text, lossy: false });
      }),
      { numRuns: 2000 },
    );
  });
});

describe("JSON helpers", () => {
  it("compares deeply, ignoring property order but not array order", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(jsonEqual({ a: null }, { b: null })).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual({}, [])).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual("1", 1)).toBe(false);
    expect(jsonEqual(0, false)).toBe(false);
    expect(jsonEqual("", "")).toBe(true);
  });

  it("does not take an inherited property for an own one", () => {
    expect(jsonEqual({ toString: 1 }, {})).toBe(false);
    expect(jsonEqual({}, { toString: 1 })).toBe(false);
  });

  it("agrees with a structural comparison on random values", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (first, second) => {
        const a = reparse(first);
        const b = reparse(second);
        expect(jsonEqual(a, a)).toBe(true);
        expect(jsonEqual(a, reparse(first))).toBe(true);
        expect(jsonEqual(a, b)).toBe(jsonEqual(b, a));
        expect(jsonEqual(a, b)).toBe(JSON.stringify(sortKeys(first)) === JSON.stringify(sortKeys(second)));
      }),
      { numRuns: 500 },
    );
  });

  it("compares values nested deeper than the call stack allows", () => {
    const deep = (depth: number, leaf: number): JsonValue =>
      JSON.parse(`${"[".repeat(depth)}${leaf}${"]".repeat(depth)}`);
    expect(jsonEqual(deep(200_000, 1), deep(200_000, 1))).toBe(true);
    expect(jsonEqual(deep(200_000, 1), deep(200_000, 2))).toBe(false);
  });

  it("builds objects without a prototype, so __proto__ is an ordinary key", () => {
    const bag = newObject();
    const name = "__proto__";
    bag[name] = { polluted: true };
    expect(Object.getPrototypeOf(bag)).toBeNull();
    expect(Object.keys(bag)).toEqual(["__proto__"]);
    const built = assemble({ id: "x" }, bag);
    expect(Object.getPrototypeOf(built)).toBeNull();
    expect(Object.keys(built)).toEqual(["id", "__proto__"]);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(JSON.stringify(built)).toBe('{"id":"x","__proto__":{"polluted":true}}');
  });

  it("splits unknown properties from known ones, in order", () => {
    const source = JSON.parse('{"x_b": 1, "id": "i", "x_a": [2], "__proto__": 3}');
    const rest = unknownProperties(source, new Set(["id"]));
    expect(Object.keys(rest)).toEqual(["x_b", "x_a", "__proto__"]);
    expect(Object.getPrototypeOf(rest)).toBeNull();
    expect(Object.keys(unknownProperties({ id: "i" }, new Set(["id"])))).toEqual([]);
  });
});
