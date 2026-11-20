// The two string orders every list rests on (docs/data-model.md 3.1, 3.2, 7.3): ids ascending
// as the tie-break, and code-point order for tags, which is what `COLLATE "C"` gives in
// PostgreSQL and `sorted()` gives in the Apple app.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compareCodePoints, compareIds } from "./index.ts";

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
const cp = (...points: number[]): string => String.fromCodePoint(...points);

/** The code points of a string, a lone surrogate counting as one. */
function codePoints(text: string): number[] {
  return [...text].map((character) => character.codePointAt(0) ?? 0);
}

/** Lexicographic order of two lists of numbers: the definition compareCodePoints must meet. */
function compareNumberLists(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}

const UNITS = [
  "a",
  "b",
  "A",
  " ",
  "0",
  "~",
  cp(0xe9),
  cp(0x7ff),
  cp(0x800),
  cp(0xd7ff),
  cp(0xe000),
  cp(0xff21),
  cp(0xffff),
  cp(0x10000),
  cp(0x1f600),
  cp(0x10ffff),
];
const wellFormed = fc.array(fc.constantFrom(...UNITS), { maxLength: 6, size: "max" }).map((u) => u.join(""));
const anyUnits = fc
  .array(fc.constantFrom(...UNITS, cp(0xd800), cp(0xdbff), cp(0xdc00), cp(0xdfff)), {
    maxLength: 6,
    size: "max",
  })
  .map((u) => u.join(""));

describe("compareCodePoints", () => {
  it("3.1: gives the order the document observed in the Apple app for these fifteen names", () => {
    const names = [
      "zebra",
      "Apple",
      "apple 2",
      `${cp(0xc9)}clair`,
      "10 things",
      "banana",
      "_x",
      " leading space",
      "Zebra",
      "apple",
      `${cp(0xc5)}ngstr${cp(0xf6)}m`,
      "2 things",
      "eclair",
      "apple 10",
      "Banana",
    ];
    expect([...names].sort(compareCodePoints)).toEqual([
      " leading space",
      "10 things",
      "2 things",
      "Apple",
      "Banana",
      "Zebra",
      "_x",
      "apple",
      "apple 10",
      "apple 2",
      "banana",
      "eclair",
      "zebra",
      `${cp(0xc5)}ngstr${cp(0xf6)}m`,
      `${cp(0xc9)}clair`,
    ]);
  });

  it("compares by code point where the UTF-16 units of JavaScript's own order say otherwise", () => {
    const privateUse = cp(0xe000);
    const fullWidth = cp(0xff21);
    const emoji = cp(0x1f600);
    // By unit the surrogate D83D of the emoji comes first; by code point it comes last.
    expect(emoji < privateUse).toBe(true);
    expect(compareCodePoints(emoji, privateUse)).toBe(1);
    expect(compareCodePoints(fullWidth, emoji)).toBe(-1);
    expect(compareCodePoints(`a${emoji}`, `a${fullWidth}`)).toBe(1);
    expect([emoji, fullWidth, privateUse, "a"].sort(compareCodePoints)).toEqual([
      "a",
      privateUse,
      fullWidth,
      emoji,
    ]);
  });

  it("a prefix comes first, equal strings give 0, and the empty string is the smallest", () => {
    expect(compareCodePoints("a", "ab")).toBe(-1);
    expect(compareCodePoints("ab", "a")).toBe(1);
    expect(compareCodePoints("ab", "ab")).toBe(0);
    expect(compareCodePoints("", "")).toBe(0);
    expect(compareCodePoints("", " ")).toBe(-1);
    expect(compareCodePoints(cp(0x1f600), cp(0x1f600))).toBe(0);
    expect(compareCodePoints(cp(0x1f600), cp(0x1f600, 0x1f600))).toBe(-1);
  });

  it("is the lexicographic order of the code points, for every pair of strings, lone surrogates included", () => {
    const seen = { less: 0, equal: 0, greater: 0, unitsDisagree: 0 };
    fc.assert(
      fc.property(anyUnits, anyUnits, (a, b) => {
        const result = compareCodePoints(a, b);
        expect(result).toBe(compareNumberLists(codePoints(a), codePoints(b)));
        expect(compareCodePoints(b, a)).toBe(-result === 0 ? 0 : -result);
        if (result < 0) seen.less += 1;
        else if (result > 0) seen.greater += 1;
        else seen.equal += 1;
        const byUnit = a < b ? -1 : a > b ? 1 : 0;
        if (byUnit !== result) seen.unitsDisagree += 1;
      }),
      { seed: SEED, numRuns: 5000 },
    );
    // Both answers occurred, also equality, and pairs on which the order by unit is the other one.
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(50);
  });

  it('is the order of the UTF-8 bytes, which is what COLLATE "C" compares', () => {
    const encoder = new TextEncoder();
    fc.assert(
      fc.property(wellFormed, wellFormed, (a, b) => {
        const bytes = compareNumberLists([...encoder.encode(a)], [...encoder.encode(b)]);
        expect(compareCodePoints(a, b)).toBe(bytes);
      }),
      { seed: SEED, numRuns: 3000 },
    );
  });

  it("sorts a list to one result whatever order the list had", () => {
    fc.assert(
      fc.property(fc.array(anyUnits, { maxLength: 8, size: "max" }), (list) => {
        const sorted = [...list].sort(compareCodePoints);
        expect([...list].reverse().sort(compareCodePoints)).toEqual(sorted);
        for (let i = 1; i < sorted.length; i++) {
          expect(compareCodePoints(sorted[i - 1] ?? "", sorted[i] ?? "")).toBeLessThanOrEqual(0);
        }
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });
});

describe("compareIds", () => {
  it("orders canonical ids as numbers, which is the order of the uuid type in PostgreSQL", () => {
    const value = (id: string): bigint => BigInt(`0x${id.replaceAll("-", "")}`);
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (a, b) => {
        const expected = value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0;
        expect(compareIds(a, b)).toBe(expected);
      }),
      { seed: SEED, numRuns: 3000 },
    );
    expect(compareIds("5e550000-0000-4000-8000-000000000005", "5e550000-0000-4000-8000-000000000006")).toBe(
      -1,
    );
    expect(compareIds("9fffffff-ffff-4fff-8fff-ffffffffffff", "a0000000-0000-4000-8000-000000000000")).toBe(
      -1,
    );
  });

  it("answers 0 only for one and the same id", () => {
    const id = "5e550000-0000-4000-8000-000000000001";
    expect(compareIds(id, id)).toBe(0);
    expect(compareIds(id, `${id.slice(0, -1)}2`)).toBe(-1);
    expect(compareIds(`${id.slice(0, -1)}2`, id)).toBe(1);
  });
});
