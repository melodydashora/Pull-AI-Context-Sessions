// The string primitives of docs/import-rules.md 2.3 and the normalisation of W1, tested with
// the document's own statements and examples.
//
// Every special character is built from its code point, so that this file stays plain ASCII
// and no editor or tool can change what a test means.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  countGraphemes,
  hasFewerGraphemesThan,
  isBlank,
  isBlankLine,
  normaliseText,
  splitLines,
  trimFull,
  trimInline,
  trimInlineEnd,
} from "./text.ts";

const chr = (...codes: number[]): string => String.fromCodePoint(...codes);
const NUL = chr(0x00);
const VT = chr(0x0b);
const FF = chr(0x0c);
const NEL = chr(0x85);
const NBSP = chr(0xa0);
const EM_SPACE = chr(0x2003);
const ZWSP = chr(0x200b);
const ZWJ = chr(0x200d);
const LS = chr(0x2028);
const PS = chr(0x2029);
const IDEOGRAPHIC_SPACE = chr(0x3000);
const BOM = chr(0xfeff);
const REPLACEMENT = chr(0xfffd);
const HIGH = chr(0xd800); // a lone high surrogate
const LOW = chr(0xdc00); // a lone low surrogate
const BICYCLE = chr(0x1f6b2);
const ACUTE = chr(0x301); // combining acute accent
const E_ACUTE = chr(0xe9);

/** 2.3: "any of these 19 code points (found by testing every Unicode scalar)". */
const INLINE_SET = [
  0x0009, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x200b, 0x202f, 0x205f, 0x3000,
];
/** 2.3: "the 19 above plus U+000A, U+000B, U+000C, U+000D, U+0085, U+2028, U+2029 (26 in all)". */
const FULL_SET = [...INLINE_SET, 0x000a, 0x000b, 0x000c, 0x000d, 0x0085, 0x2028, 0x2029];

/** With the u flag a surrogate class matches lone surrogates only. */
const LONE_SURROGATES = /[\uD800-\uDFFF]/gu;

/** The code points a trim removes from both ends of `<c>x<c>`, tested on every Unicode scalar. */
function removedBy(trim: (value: string) => string): number[] {
  const removed: number[] = [];
  for (let code = 0; code <= 0x10ffff; code++) {
    if (code >= 0xd800 && code <= 0xdfff) continue; // surrogates are not scalars
    const character = chr(code);
    const trimmed = trim(`${character}x${character}`);
    if (trimmed === "x") removed.push(code);
    else if (trimmed !== `${character}x${character}`)
      throw new Error(`U+${code.toString(16)} was half removed`);
  }
  return removed;
}

const ascending = (codes: readonly number[]): number[] => [...codes].sort((a, b) => a - b);

describe("2.3 split into lines", () => {
  it('cuts at every LF and nowhere else: "a\\n" gives "a" and ""', () => {
    expect(splitLines("a\n")).toEqual(["a", ""]);
    expect(splitLines("a")).toEqual(["a"]);
    expect(splitLines("")).toEqual([""]);
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
  });

  it("leaves a CR at the end of its line", () => {
    expect(splitLines("a\r\nb")).toEqual(["a\r", "b"]);
    expect(splitLines("a\rb")).toEqual(["a\rb"]);
  });

  it("does not cut at any other line separator", () => {
    const line = `a${LS}b${PS}c${NEL}d${VT}e${FF}f`;
    expect(splitLines(line)).toEqual([line]);
  });
});

describe("2.3 inline trim (Swift .whitespaces)", () => {
  it("removes exactly the 19 listed code points, tested on every Unicode scalar", {
    timeout: 120_000,
  }, () => {
    expect(new Set(INLINE_SET).size).toBe(19);
    expect(removedBy(trimInline)).toEqual(ascending(INLINE_SET));
  });

  it("does NOT remove CR, LF or U+FEFF", () => {
    expect(trimInline("\rx\r")).toBe("\rx\r");
    expect(trimInline("\nx\n")).toBe("\nx\n");
    expect(trimInline(`${BOM}x${BOM}`)).toBe(`${BOM}x${BOM}`);
    expect(trimInline(" \t x\r")).toBe("x\r");
  });

  it("removes U+200B (zero width space), unlike JavaScript trim()", () => {
    expect(trimInline(`${ZWSP}x${ZWSP}`)).toBe("x");
    expect(`${ZWSP}x${ZWSP}`.trim()).toBe(`${ZWSP}x${ZWSP}`);
  });

  it("removes from both ends only, in any mixture", () => {
    expect(trimInline(` \t${NBSP}${IDEOGRAPHIC_SPACE} a b ${EM_SPACE}${ZWSP}\t`)).toBe("a b");
    expect(trimInline("a \t b")).toBe("a \t b");
    expect(trimInline("   ")).toBe("");
    expect(trimInline("")).toBe("");
  });

  it("the end-only form keeps indentation (W7)", () => {
    expect(trimInlineEnd("    code  \t")).toBe("    code");
    expect(trimInlineEnd(`  \t${ZWSP} `)).toBe("");
    expect(trimInlineEnd("x\n ")).toBe("x\n");
  });
});

describe("2.3 full trim (Swift .whitespacesAndNewlines)", () => {
  it("removes exactly the 26 listed code points, tested on every Unicode scalar", {
    timeout: 120_000,
  }, () => {
    expect(new Set(FULL_SET).size).toBe(26);
    expect(removedBy(trimFull)).toEqual(ascending(FULL_SET));
  });

  it("does not remove U+FEFF, which JavaScript trim() and \\s do", () => {
    expect(trimFull(`${BOM}x${BOM}`)).toBe(`${BOM}x${BOM}`);
    expect(`${BOM}x${BOM}`.trim()).toBe("x");
  });

  it("removes U+200B and U+0085 at the ends, which JavaScript trim() does not (fixture 23)", () => {
    expect(trimFull(`Merci.${ZWSP}\n`)).toBe("Merci.");
    expect(trimFull(`De rien.${ZWSP}\n${NEL}\n`)).toBe("De rien.");
    expect(`De rien.${ZWSP}\n${NEL}\n`.trim()).toBe(`De rien.${ZWSP}\n${NEL}`);
  });

  it("leaves lone surrogates and everything inside the text alone", () => {
    expect(trimFull(` ${HIGH} `)).toBe(HIGH);
    expect(trimFull("\n a \n b \n")).toBe("a \n b");
  });

  it("the blank tests agree with the trims", () => {
    expect(isBlank(` \t\n${NEL}${LS}${ZWSP}`)).toBe(true);
    expect(isBlank(` ${BOM} `)).toBe(false);
    expect(isBlank("")).toBe(true);
    expect(isBlankLine(` \t${NBSP}${ZWSP}`)).toBe(true);
    expect(isBlankLine(" \n")).toBe(false);
    expect(isBlankLine("\r")).toBe(false);
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 12 }), (value) => {
        expect(isBlank(value)).toBe(trimFull(value) === "");
        expect(isBlankLine(value)).toBe(trimInline(value) === "");
      }),
      { seed: 20261120, numRuns: 500 },
    );
  });
});

describe("2.3 length (Swift String.count) and W15", () => {
  it("an emoji counts 1", () => {
    expect(countGraphemes(BICYCLE)).toBe(1);
    expect(BICYCLE.length).toBe(2);
  });

  it("a joined family sequence counts 1 (fixture 23)", () => {
    const family = chr(0x1f468) + ZWJ + chr(0x1f469) + ZWJ + chr(0x1f467);
    expect(countGraphemes(family)).toBe(1);
    expect(family.length).toBe(8);
  });

  it("a letter with a combining accent counts 1, composed or decomposed", () => {
    expect(countGraphemes(`e${ACUTE}`)).toBe(1);
    expect(countGraphemes(E_ACUTE)).toBe(1);
    expect(countGraphemes(`cafe${ACUTE}`)).toBe(4);
  });

  it("the pair CR LF counts 1", () => {
    expect(countGraphemes("\r\n")).toBe(1);
    expect(countGraphemes("a\r\nb")).toBe(3);
    expect(countGraphemes("a\nb")).toBe(3); // so W1 does not change a length (W15)
    expect(countGraphemes("\r\r")).toBe(2);
  });

  it("counts the empty text as 0 and plain text by its characters", () => {
    expect(countGraphemes("")).toBe(0);
    expect(countGraphemes("seed seed")).toBe(9);
  });

  it("the threshold test agrees with the count at the boundary (fixture 55: 60 bicycles)", () => {
    const short = "x".repeat(1139) + BICYCLE.repeat(60); // 1199 characters, 1259 UTF-16 units
    const long = "x".repeat(1140) + BICYCLE.repeat(60); // 1200 characters, 1260 UTF-16 units
    expect(short.length).toBe(1259);
    expect(countGraphemes(short)).toBe(1199);
    expect(hasFewerGraphemesThan(short, 1200)).toBe(true);
    expect(countGraphemes(long)).toBe(1200);
    expect(hasFewerGraphemesThan(long, 1200)).toBe(false);
  });

  it("the threshold test equals count < limit for any text", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme", maxLength: 40 }),
        fc.integer({ min: 0, max: 60 }),
        (value, limit) => {
          expect(hasFewerGraphemesThan(value, limit)).toBe(countGraphemes(value) < limit);
        },
      ),
      { seed: 20261120, numRuns: 300 },
    );
  });
});

describe("W1 normalise text at the boundary", () => {
  it("(1) removes one leading U+FEFF, and only one, and only at the start", () => {
    expect(normaliseText(`${BOM}abc`)).toBe("abc");
    expect(normaliseText(`${BOM}${BOM}abc`)).toBe(`${BOM}abc`);
    expect(normaliseText(`a${BOM}bc`)).toBe(`a${BOM}bc`);
  });

  it("(2) replaces CR LF by LF, then every remaining CR by LF", () => {
    expect(normaliseText("a\r\nb")).toBe("a\nb");
    expect(normaliseText("a\rb")).toBe("a\nb");
    expect(normaliseText("a\r\r\nb")).toBe("a\n\nb");
    expect(normaliseText("a\n\rb")).toBe("a\n\nb");
    expect(normaliseText("\r\n\r\n")).toBe("\n\n");
    expect(normaliseText("one\r\ntwo\rthree\nfour")).toBe("one\ntwo\nthree\nfour");
  });

  it("(3) removes U+0000", () => {
    expect(normaliseText(`a${NUL}b${NUL}`)).toBe("ab");
    // The steps run in the stated order: the CR is replaced before the NUL goes.
    expect(normaliseText(`a\r${NUL}\nb`)).toBe("a\n\nb");
  });

  it("(4) replaces lone surrogates by U+FFFD and keeps pairs", () => {
    expect(normaliseText(`a${HIGH}b`)).toBe(`a${REPLACEMENT}b`);
    expect(normaliseText(`a${LOW}b`)).toBe(`a${REPLACEMENT}b`);
    expect(normaliseText(BICYCLE)).toBe(BICYCLE);
    expect(normaliseText(HIGH + BICYCLE + LOW)).toBe(REPLACEMENT + BICYCLE + REPLACEMENT);
    expect(normaliseText(LOW + HIGH)).toBe(REPLACEMENT + REPLACEMENT);
    expect(normaliseText(`x${HIGH}`)).toBe(`x${REPLACEMENT}`);
    expect(normaliseText(HIGH + HIGH + LOW)).toBe(`${REPLACEMENT}${HIGH}${LOW}`);
  });

  it("(4) equals String.prototype.toWellFormed on any string", () => {
    // The built-in is newer than the compile target, so it is looked up at run time.
    const builtIn: unknown = Reflect.get(String.prototype, "toWellFormed");
    expect(typeof builtIn).toBe("function");
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 60 }), (value) => {
        // Leave only step 4 to do.
        const plain = value.replaceAll("\r", "x").replaceAll(NUL, "x").replaceAll(BOM, "x");
        expect(normaliseText(plain)).toBe(plain.replace(LONE_SURROGATES, REPLACEMENT));
        if (typeof builtIn === "function")
          expect(normaliseText(plain)).toBe(Reflect.apply(builtIn, plain, []));
      }),
      { seed: 20261120, numRuns: 1000 },
    );
  });

  it("does not apply Unicode normalisation (fixture 23 has both forms of an accented letter)", () => {
    const both = `th${E_ACUTE} and cafe${ACUTE}`;
    expect(normaliseText(both)).toBe(both);
    expect(normaliseText(both)).not.toBe(both.normalize("NFC"));
  });

  it("leaves no CR, no U+0000 and no lone surrogate in any string", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 80 }), (value) => {
        const normal = normaliseText(value);
        expect(normal.includes("\r")).toBe(false);
        expect(normal.includes(NUL)).toBe(false);
        expect(normal.replace(LONE_SURROGATES, "")).toBe(normal);
        // A second pass changes nothing, except that it would remove one more leading U+FEFF.
        if (!normal.startsWith(BOM)) expect(normaliseText(normal)).toBe(normal);
      }),
      { seed: 20261120, numRuns: 1000 },
    );
  });

  it("returns clean text unchanged", () => {
    const clean = `User: hello\n${BICYCLE} caf${E_ACUTE}\n`;
    expect(normaliseText(clean)).toBe(clean);
  });
});

describe("W8 title cleaning", () => {
  it("full-trims, and falls back to 'Imported session' when nothing is left", () => {
    expect(cleanTitle("  notes \n")).toBe("notes");
    expect(cleanTitle("")).toBe("Imported session");
    expect(cleanTitle(` \t\n${ZWSP}`)).toBe("Imported session");
  });

  it("applies W1 first, so that a title can always be stored (C5)", () => {
    expect(cleanTitle(`${BOM}a${NUL}b\r\nc${HIGH}`)).toBe(`ab\nc${REPLACEMENT}`);
  });
});
