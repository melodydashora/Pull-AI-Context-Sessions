// Tags (docs/data-model.md 3.2, 8.2, B3): the tag field, what it shows, and the tag list of the
// sidebar. Expected values are those of the document; where it only prints the function, they
// are what the printed function gives (contract.test.ts compares the two on generated input).
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { normaliseTags } from "../interchange/index.ts";
import { formatTags, parseTags, tagList } from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
const cp = (...points: number[]): string => String.fromCodePoint(...points);

describe("8.2 parseTags: trim, lower case, no empty tags, no leading '#', no repeats", () => {
  it("the field of 3.2: where the Apple app keeps the repeat and the '#', the web drops both (B3)", () => {
    // Apple: ["garden", "bikes", "garden", "two words", "#hash"].
    expect(parseTags("Garden, Bikes ,, garden,  Two Words , #hash")).toEqual([
      "garden",
      "bikes",
      "two words",
      "hash",
    ]);
  });

  it("the other two examples of 3.2", () => {
    expect(parseTags("a;b")).toEqual(["a;b"]);
    // Apple: ["upper", "upper", "upper"].
    expect(parseTags("UPPER,upper,Upper")).toEqual(["upper"]);
  });

  it.each([
    ["", []],
    [" ", []],
    [",", []],
    [",,, ,", []],
    ["#", []],
    ["##", []],
    [" # ", []],
    ["#,#", []],
    ["one", ["one"]],
    ["one,", ["one"]],
    [",one", ["one"]],
    ["one,two", ["one", "two"]],
    ["one , two", ["one", "two"]],
  ])("%j gives %j", (field, expected) => {
    expect(parseTags(field)).toEqual(expected);
  });

  it("keeps the order of first appearance and drops later repeats, whatever their spelling", () => {
    expect(parseTags("b, a, b")).toEqual(["b", "a"]);
    expect(parseTags("a, A,  a , #a, ##A")).toEqual(["a"]);
    expect(parseTags("z, y, x, y, z, w")).toEqual(["z", "y", "x", "w"]);
  });

  it("removes every leading '#' and trims again, and leaves a '#' elsewhere alone", () => {
    expect(parseTags("#tag")).toEqual(["tag"]);
    expect(parseTags("###tag")).toEqual(["tag"]);
    expect(parseTags("# tag")).toEqual(["tag"]);
    expect(parseTags(" #  tag ")).toEqual(["tag"]);
    expect(parseTags("c#, a#b, tag#")).toEqual(["c#", "a#b", "tag#"]);
  });

  it("the whole leading run of '#' and white space goes at once (corrections.md 2, point 1)", () => {
    // As 8.2 first printed it, "# #a" gave "#a", and the next reading of that tag gave "a".
    expect(parseTags("# #a")).toEqual(["a"]);
    expect(parseTags("#\t# #  ## a#b #")).toEqual(["a#b #"]);
    expect(parseTags("# # #")).toEqual([]);
    // The reader's repair 4 is the same function on the joined tags.
    expect(normaliseTags(["# #a"])).toEqual(["a"]);
    expect(normaliseTags(["# #a", "b,# c"])).toEqual(parseTags("# #a,b,# c"));
  });

  it("keeps what is inside a tag: spaces, punctuation, even a line break", () => {
    expect(parseTags("two   words")).toEqual(["two   words"]);
    expect(parseTags("a.b/c:d;e")).toEqual(["a.b/c:d;e"]);
    expect(parseTags("line\nbreak")).toEqual(["line\nbreak"]);
    expect(parseTags(`no${cp(0xa0)}break`)).toEqual([`no${cp(0xa0)}break`]);
  });

  it("trims every kind of white space JavaScript knows, and only that", () => {
    const spaces = [" ", "\t", "\n", "\r", cp(0x0b), cp(0x0c), cp(0xa0), cp(0x1680), cp(0x2003), cp(0x2028)];
    for (const space of [...spaces, cp(0x2029), cp(0x202f), cp(0x205f), cp(0x3000), cp(0xfeff)]) {
      expect(parseTags(`${space}tag${space}`), JSON.stringify(space)).toEqual(["tag"]);
      expect(parseTags(`${space}#${space}tag`), JSON.stringify(space)).toEqual(["tag"]);
    }
    // The zero width space is no white space to JavaScript (it is to Swift): it stays.
    expect(parseTags(`${cp(0x200b)}tag`)).toEqual([`${cp(0x200b)}tag`]);
    // Neither is U+0085, the next-line control.
    expect(parseTags(`${cp(0x85)}tag`)).toEqual([`${cp(0x85)}tag`]);
  });

  it("lower-cases letters outside ASCII as well", () => {
    expect(parseTags(`${cp(0xc9)}COLE`)).toEqual([`${cp(0xe9)}cole`]);
    expect(parseTags(cp(0x416, 0x423, 0x41a))).toEqual([cp(0x436, 0x443, 0x43a)]);
    // Capital sigma at the end of a word becomes the final form; I with dot becomes i and a dot.
    expect(parseTags(cp(0x39f, 0x394, 0x39f, 0x3a3))).toEqual([cp(0x3bf, 0x3b4, 0x3bf, 0x3c2)]);
    expect(parseTags(`${cp(0x130)}STANBUL`)).toEqual([`i${cp(0x307)}stanbul`]);
    // An emoji and a letter of a script without case are kept.
    expect(parseTags(`${cp(0x1f600)}, ${cp(0x65e5, 0x672c)}`)).toEqual([cp(0x1f600), cp(0x65e5, 0x672c)]);
  });

  it("compares tags as strings: the composed and the decomposed spelling of one word are two tags", () => {
    const composed = `caf${cp(0xe9)}`;
    const decomposed = `cafe${cp(0x301)}`;
    expect(parseTags(`${composed}, ${decomposed}`)).toEqual([composed, decomposed]);
  });

  it("only the comma separates: semicolon, line break and full-width comma do not", () => {
    expect(parseTags("a;b|c\nd")).toEqual(["a;b|c\nd"]);
    expect(parseTags(`a${cp(0xff0c)}b`)).toEqual([`a${cp(0xff0c)}b`]);
    expect(parseTags(`a${cp(0x3001)}b`)).toEqual([`a${cp(0x3001)}b`]);
  });

  it("never returns a tag that is empty, that has a comma, or that has white space at its ends", () => {
    const part = fc.constantFrom("a", "B", " ", "#", ",", "\t", cp(0xa0), cp(0x3000), "x y", cp(0xc9), "");
    let nonEmpty = 0;
    fc.assert(
      fc.property(fc.array(part, { maxLength: 12, size: "max" }), (parts) => {
        const tags = parseTags(parts.join(""));
        if (tags.length > 0) nonEmpty += 1;
        for (const tag of tags) {
          expect(tag).not.toBe("");
          expect(tag.includes(",")).toBe(false);
          expect(tag).toBe(tag.trim());
          expect(tag).toBe(tag.toLowerCase());
        }
        expect(new Set(tags).size).toBe(tags.length);
        // Idempotent (corrections.md 2, point 1): the stored tags are what the field gives again.
        expect(parseTags(tags.join(","))).toEqual(tags);
        for (const tag of tags) expect(parseTags(tag)).toEqual([tag]);
      }),
      { seed: SEED, numRuns: 2000 },
    );
    expect(nonEmpty).toBeGreaterThan(1000);
  });

  it("does not need more time for many different tags than for many equal ones", () => {
    // 200,000 different tags: looking each one up in the list built so far would take minutes.
    const different = Array.from({ length: 200_000 }, (_, index) => `Tag${index}`).join(", ");
    const started = performance.now();
    const tags = parseTags(different);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(tags).toHaveLength(200_000);
    expect(tags[0]).toBe("tag0");
    expect(tags[199_999]).toBe("tag199999");
    expect(parseTags(",".repeat(2_000_000))).toEqual([]);
    expect(parseTags("#".repeat(2_000_000))).toEqual([]);
    expect(parseTags(`${" ".repeat(1_000_000)}a${" ".repeat(1_000_000)}`)).toEqual(["a"]);
  });
});

describe("8.2 formatTags: what the tag field shows", () => {
  it("joins with a comma and a space", () => {
    expect(formatTags([])).toBe("");
    expect(formatTags(["garden"])).toBe("garden");
    expect(formatTags(["garden", "two words", "bikes"])).toBe("garden, two words, bikes");
  });

  it("the field shown for stored tags parses back to the same tags", () => {
    expect(parseTags(formatTags(["garden", "two words", "bikes"]))).toEqual(["garden", "two words", "bikes"]);
    // For every list of tags in the form the reader stores (6.6 repair 4).
    const element = fc.constantFrom("a", "B", " ", "#", ",", "x y", cp(0xc9), cp(0x3a3), cp(0x130), "", "c");
    fc.assert(
      fc.property(
        fc.array(fc.array(element, { maxLength: 6, size: "max" }), { maxLength: 6, size: "max" }),
        (lists) => {
          const stored = normaliseTags(lists.map((parts) => parts.join("")));
          expect(parseTags(formatTags(stored))).toEqual(stored);
        },
      ),
      { seed: SEED, numRuns: 2000 },
    );
  });
});

describe("8.2 tagList: the distinct tags of all sessions in code-point order", () => {
  const sessions = (...lists: string[][]): { tags: string[] }[] => lists.map((tags) => ({ tags }));

  it("an empty vault and sessions without tags have no tag list", () => {
    expect(tagList([])).toEqual([]);
    expect(tagList(sessions([], []))).toEqual([]);
  });

  it("lists every tag once, whichever session and position it has", () => {
    expect(tagList(sessions(["garden", "bikes"], ["bikes"], [], ["repair", "garden"]))).toEqual([
      "bikes",
      "garden",
      "repair",
    ]);
  });

  it("orders by code point: digits, then ASCII letters, then everything else, a prefix first", () => {
    const tags = ["b", "a b", "ab", "a", "10", "2", "z", cp(0xe9), "_x", "a-b", cp(0x436), "zz"];
    expect(tagList(sessions(tags))).toEqual([
      "10",
      "2",
      "_x",
      "a",
      "a b",
      "a-b",
      "ab",
      "b",
      "z",
      "zz",
      cp(0xe9),
      cp(0x436),
    ]);
  });

  it("orders by code point where UTF-16 units would say otherwise", () => {
    // U+FF21 comes before U+1F600 by code point; its UTF-16 unit FF21 comes after D83D.
    const wide = `${cp(0xff21)}x`;
    const emoji = `${cp(0x1f600)}x`;
    expect([emoji, wide].sort()).toEqual([emoji, wide]);
    expect(tagList(sessions([emoji, wide]))).toEqual([wide, emoji]);
    expect(tagList(sessions([wide], [emoji]))).toEqual([wide, emoji]);
  });

  it("does not change the sessions it is given", () => {
    const frozen = [Object.freeze({ tags: Object.freeze(["b", "a"]) })];
    expect(tagList(frozen)).toEqual(["a", "b"]);
    expect(frozen[0]?.tags).toEqual(["b", "a"]);
  });
});
