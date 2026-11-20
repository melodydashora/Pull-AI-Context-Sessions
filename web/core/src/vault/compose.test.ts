// composedForm must return exactly what String.prototype.normalize("NFC") returns, for every
// text, and must not need the minutes that method needs on a long run of combining marks.
// Search (data-model.md 8.1) and project names (8.4) rest on it.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { buildSearchText, composedForm, normalizeForSearch, prepareQuery, projectNameKey } from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);

const cp = (...points: number[]): string => String.fromCodePoint(...points);

const ACUTE = cp(0x301); // combining class 230
const GRAVE_BELOW = cp(0x316); // 220
const CEDILLA = cp(0x327); // 202
const OVERLAY = cp(0x334); // 1, the lowest class
const YPOGEGRAMMENI = cp(0x345); // 240, the highest class in use
const TIBETAN_II = cp(0xf73); // decomposes into U+0F71 (129) and U+0F72 (130)
const DIALYTIKA_TONOS = cp(0x344); // decomposes into U+0308 and U+0301
const ENCLOSING_CIRCLE = cp(0x20dd); // a mark of class 0: nothing moves across it
const E_ACUTE = cp(0xe9);

/** The test the module uses, written again here: does canonical ordering exchange the two? */
function isReordered(first: string, second: string): boolean {
  const pair = first + second;
  return pair.normalize("NFD") !== pair;
}
function isNonStarter(point: string): boolean {
  return isReordered(YPOGEGRAMMENI, point) || isReordered(point, OVERLAY);
}

/** Every code point of the platform's Unicode version that is a combining mark. */
const ALL_MARKS: string[] = [];
/** Code points that are no marks and can still be moved by canonical ordering: there must be none. */
const MOVABLE_NON_MARKS: string[] = [];
for (let point = 0; point <= 0x10ffff; point++) {
  if (point >= 0xd800 && point <= 0xdfff) continue;
  const character = cp(point);
  if (/^\p{M}$/u.test(character)) {
    ALL_MARKS.push(character);
    continue;
  }
  // What a character that is no mark decomposes into starts with a starter.
  const [first] = character.normalize("NFD");
  if (first !== undefined && isNonStarter(first)) MOVABLE_NON_MARKS.push(point.toString(16));
}

function elapsed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe("what composedForm takes for granted about the platform", () => {
  it("the two probes are marks of different classes: canonical ordering exchanges them", () => {
    expect(isReordered(YPOGEGRAMMENI, OVERLAY)).toBe(true);
    expect(isReordered(OVERLAY, YPOGEGRAMMENI)).toBe(false);
    expect(isNonStarter(OVERLAY)).toBe(true);
    expect(isNonStarter(YPOGEGRAMMENI)).toBe(true);
    expect(isNonStarter(ACUTE)).toBe(true);
    expect(isNonStarter(ENCLOSING_CIRCLE)).toBe(false);
    expect(isNonStarter("a")).toBe(false);
  });

  it("every character that canonical ordering can move is a combining mark, so only runs of marks need care", () => {
    expect(ALL_MARKS.length).toBeGreaterThan(2000);
    expect(MOVABLE_NON_MARKS).toEqual([]);
  });
});

describe("composedForm returns what normalize('NFC') returns", () => {
  it.each([
    ["the empty text", ""],
    ["plain ASCII", "The quick brown fox, 1234567890 times."],
    ["a composed letter", `caf${E_ACUTE}`],
    ["a decomposed letter", `cafe${ACUTE}`],
    ["two marks in the wrong order", `a${ACUTE}${GRAVE_BELOW}`],
    ["30 marks, the longest run left to the platform", `a${(ACUTE + GRAVE_BELOW).repeat(15)}`],
    ["31 marks, the shortest run ordered here", `a${(ACUTE + GRAVE_BELOW).repeat(15)}${CEDILLA}`],
    [
      "a long run in descending order of class",
      `a${ACUTE.repeat(40)}${GRAVE_BELOW.repeat(40)}${OVERLAY.repeat(40)}`,
    ],
    ["a long run that alternates", `a${(ACUTE + GRAVE_BELOW + YPOGEGRAMMENI + OVERLAY).repeat(25)}`],
    ["marks that decompose into two classes", `${cp(0xf40)}${TIBETAN_II.repeat(40)}`],
    ["marks that decompose into two marks of one class", `a${DIALYTIKA_TONOS.repeat(40)}${GRAVE_BELOW}`],
    ["a mark of class 0 inside the run", `a${ACUTE.repeat(20)}${ENCLOSING_CIRCLE}${GRAVE_BELOW.repeat(20)}`],
    ["a run right after a composed letter", `${E_ACUTE}${GRAVE_BELOW.repeat(40)}`],
    ["a base that composes with a mark behind 40 lower ones", `a${GRAVE_BELOW.repeat(40)}${ACUTE}`],
    ["a base whose mark is blocked by 40 equal ones", `a${cp(0x300).repeat(40)}${ACUTE}`],
    ["a run at the very start of the text", `${(ACUTE + GRAVE_BELOW).repeat(20)}a`],
    [
      "two long runs and short ones between",
      `x${(ACUTE + OVERLAY).repeat(20)}y${ACUTE}z${(GRAVE_BELOW + CEDILLA).repeat(20)}`,
    ],
    [
      "Hangul letters that compose",
      `${cp(0x1100, 0x1161, 0x11a8)}${(ACUTE + GRAVE_BELOW).repeat(20)}${cp(0x1100, 0x1161)}`,
    ],
    ["a lone surrogate before a run", `${cp(0xd800)}${(ACUTE + GRAVE_BELOW).repeat(20)}${cp(0xdc00)}`],
    ["marks outside the Basic Multilingual Plane", `a${(cp(0x1d165) + cp(0x1d16d) + ACUTE).repeat(15)}`],
    [
      "the angstrom sign and the kelvin sign",
      `${cp(0x212b)}${cp(0x212a)}${(ACUTE + GRAVE_BELOW).repeat(16)}`,
    ],
  ])("%s", (_name, text) => {
    expect(composedForm(text)).toBe(text.normalize("NFC"));
  });

  it("really puts a run of 31 marks and more in order itself: the result is the same whichever way the run is shuffled", () => {
    const sorted = `a${OVERLAY.repeat(20)}${CEDILLA.repeat(20)}${GRAVE_BELOW.repeat(20)}${ACUTE.repeat(20)}`;
    const reversed = `a${ACUTE.repeat(20)}${GRAVE_BELOW.repeat(20)}${CEDILLA.repeat(20)}${OVERLAY.repeat(20)}`;
    const mixed = `a${(ACUTE + OVERLAY + GRAVE_BELOW + CEDILLA).repeat(20)}`;
    expect(composedForm(reversed)).toBe(composedForm(sorted));
    expect(composedForm(mixed)).toBe(composedForm(sorted));
    // The cedilla composes with nothing here and the acute does: a + 20 overlays ... + acute.
    expect(composedForm(sorted)).toBe(sorted.normalize("NFC"));
    expect(composedForm(sorted).length).toBe(sorted.length - 1);
  });

  it("keeps the order of marks of one class: only marks of different classes change places", () => {
    // U+0300 and U+0301 are both of class 230: their order is part of the text.
    const text = `e${(cp(0x300) + ACUTE + GRAVE_BELOW).repeat(20)}`;
    const composed = composedForm(text);
    expect(composed).toBe(text.normalize("NFC"));
    expect(composed).not.toBe(`e${(ACUTE + cp(0x300) + GRAVE_BELOW).repeat(20)}`.normalize("NFC"));
  });

  it("on generated text made of every combining mark the platform knows", () => {
    const bases = [
      "a",
      "e",
      "A",
      E_ACUTE,
      " ",
      "x",
      cp(0x1100),
      cp(0x1161),
      cp(0xac00),
      cp(0x9c7),
      cp(0xf40),
    ];
    const base = fc.constantFrom(...bases, cp(0x5d0), cp(0x627), cp(0x915), cp(0xd800), cp(0x212b));
    const anyMark = fc.nat(ALL_MARKS.length - 1).map((index) => ALL_MARKS[index] ?? ACUTE);
    const fewMarks = fc.constantFrom(
      ACUTE,
      GRAVE_BELOW,
      CEDILLA,
      OVERLAY,
      YPOGEGRAMMENI,
      TIBETAN_II,
      DIALYTIKA_TONOS,
    );
    // size "max": without it the arrays stay far below their maximal length.
    const run = fc.oneof(
      fc.array(fewMarks, { maxLength: 120, size: "max" }),
      fc.array(anyMark, { maxLength: 120, size: "max" }),
      fc.array(fc.oneof(fewMarks, anyMark), { maxLength: 400, size: "max" }),
    );
    const text = fc
      .array(fc.tuple(base, run), { minLength: 1, maxLength: 4 })
      .map((pieces) => pieces.map(([letter, marks]) => letter + marks.join("")).join(""));
    let longRuns = 0;
    fc.assert(
      fc.property(text, (generated) => {
        if (/\p{M}{31}/u.test(generated)) longRuns += 1;
        expect(composedForm(generated)).toBe(generated.normalize("NFC"));
      }),
      { seed: SEED, numRuns: 3000 },
    );
    // The property is about long runs: most of the generated texts must have had one.
    expect(longRuns).toBeGreaterThan(1500);
  });

  it("on every combining mark of the platform at once, in code-point order and reversed", () => {
    const forwards = `a${ALL_MARKS.join("")}`;
    const backwards = `a${[...ALL_MARKS].reverse().join("")}`;
    expect(composedForm(forwards)).toBe(forwards.normalize("NFC"));
    expect(composedForm(backwards)).toBe(backwards.normalize("NFC"));
  });
});

describe("composedForm needs time in proportion to the text, where the platform needs its square", () => {
  // Measured on the machine this was written on: normalize("NFC") alone took 83 s for DESCENDING
  // and 164 s for DECOMPOSING below, and 1.7 s for a fifth of ALTERNATING. composedForm takes
  // about 0.1 s for each. The limit only has to tell seconds from minutes.
  const LIMIT_MS = 10_000;
  const ALTERNATING = `a${(ACUTE + GRAVE_BELOW).repeat(200_000)}`;
  const DESCENDING = `a${ACUTE.repeat(200_000)}${GRAVE_BELOW.repeat(200_000)}`;
  const DECOMPOSING = `${cp(0xf40)}${TIBETAN_II.repeat(400_000)}`;

  it("400,000 marks that alternate between two classes", () => {
    let composed = "";
    expect(elapsed(() => (composed = composedForm(ALTERNATING)))).toBeLessThan(LIMIT_MS);
    // a + acute composes; the marks below come first, then the remaining acutes.
    expect(composed).toBe(`${cp(0xe1)}${GRAVE_BELOW.repeat(200_000)}${ACUTE.repeat(199_999)}`);
  });

  it("200,000 marks of a high class followed by 200,000 of a lower one", () => {
    let composed = "";
    expect(elapsed(() => (composed = composedForm(DESCENDING)))).toBeLessThan(LIMIT_MS);
    expect(composed).toBe(`${cp(0xe1)}${GRAVE_BELOW.repeat(200_000)}${ACUTE.repeat(199_999)}`);
  });

  it("400,000 marks that each decompose into two classes", () => {
    let composed = "";
    expect(elapsed(() => (composed = composedForm(DECOMPOSING)))).toBeLessThan(LIMIT_MS);
    // U+0F73 is excluded from composition: the result stays decomposed, class 129 before 130.
    expect(composed).toBe(`${cp(0xf40)}${cp(0xf71).repeat(400_000)}${cp(0xf72).repeat(400_000)}`);
  });

  it("a million marks of every kind in random order", () => {
    let state = 20261120;
    const next = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state;
    };
    const marks: string[] = [];
    for (let i = 0; i < 1_000_000; i++) marks.push(ALL_MARKS[next() % ALL_MARKS.length] ?? ACUTE);
    const text = `a${marks.join("")}`;
    let composed = "";
    expect(elapsed(() => (composed = composedForm(text)))).toBeLessThan(LIMIT_MS);
    // The platform cannot be asked for the whole answer in reasonable time. What can be checked:
    // the result is in composed form (on text in canonical order the platform is quick) ...
    expect(composed.normalize("NFC")).toBe(composed);
    // ... it holds the code points of the input, each decomposed on its own, and no others ...
    const decomposedOneByOne = [...text].map((character) => character.normalize("NFD")).join("");
    expect([...composed.normalize("NFD")].sort()).toEqual([...decomposedOneByOne].sort());
    // ... and a piece of it the platform can still manage comes out as the platform has it.
    const piece = text.slice(0, 3_001);
    expect(composedForm(piece)).toBe(piece.normalize("NFC"));
  });

  it("400,000 marks that alternate between the highest and the lowest class", () => {
    let composed = "";
    const text = `a${(YPOGEGRAMMENI + OVERLAY).repeat(200_000)}`;
    expect(elapsed(() => (composed = composedForm(text)))).toBeLessThan(LIMIT_MS);
    expect(composed).toBe(`a${OVERLAY.repeat(200_000)}${YPOGEGRAMMENI.repeat(200_000)}`);
  });

  it("5,000,000 marks in one run: more than a quantifier of the regular-expression engine can take", () => {
    // Measured in Node 24: /\p{M}+/u throws "Maximum call stack size exceeded" on this run (it
    // still works on 2,000,000 marks). The module reads a run in pieces of 1024 marks.
    const text = `a${(ACUTE + GRAVE_BELOW).repeat(2_500_000)}`;
    let composed = "";
    expect(elapsed(() => (composed = composedForm(text)))).toBeLessThan(LIMIT_MS);
    expect(composed.length).toBe(5_000_000);
    expect(composed.startsWith(`${cp(0xe1)}${GRAVE_BELOW.repeat(100)}`)).toBe(true);
    expect(composed.endsWith(`${GRAVE_BELOW}${ACUTE.repeat(2_499_999)}`)).toBe(true);
  });

  it("3,000,000 marks outside the Basic Multilingual Plane, and 2,000,000 marks that never move", () => {
    // Musical stems and dots, classes 216 and 226.
    const stem = cp(0x1d165);
    const dot = cp(0x1d16d);
    const astral = `a${(dot + stem).repeat(1_500_000)}`;
    let composed = "";
    expect(elapsed(() => (composed = composedForm(astral)))).toBeLessThan(LIMIT_MS);
    expect(composed === `a${stem.repeat(1_500_000)}${dot.repeat(1_500_000)}`).toBe(true);
    // Enclosing circles have class 0: the platform is quick on them, and the answer is the text itself.
    const circles = `a${ENCLOSING_CIRCLE.repeat(2_000_000)}${ACUTE}`;
    expect(elapsed(() => (composed = composedForm(circles)))).toBeLessThan(LIMIT_MS);
    expect(composed === circles.normalize("NFC")).toBe(true);
    expect(composed === circles).toBe(true);
  });

  it("60,000 runs of 31 marks, and 5,000,000 characters with no mark at all", () => {
    const runs = `a${(ACUTE + GRAVE_BELOW).repeat(15)}${CEDILLA}`.repeat(60_000);
    expect(elapsed(() => composedForm(runs))).toBeLessThan(LIMIT_MS);
    const plain = "plain text ".repeat(454_546);
    let composed = "";
    expect(elapsed(() => (composed = composedForm(plain)))).toBeLessThan(LIMIT_MS);
    expect(composed).toBe(plain);
  });

  it("so do the functions built on it: the search text, the query and the project key", () => {
    expect(
      elapsed(() => {
        expect(normalizeForSearch(DESCENDING).length).toBe(400_000);
        expect(buildSearchText({ title: ALTERNATING, summary: DESCENDING, tags: [DECOMPOSING] }).length).toBe(
          400_000 + 1 + 400_000 + 1 + 800_001,
        );
        expect(prepareQuery(` ${DESCENDING}\r\n`).length).toBe(400_000);
        expect(projectNameKey(` ${ALTERNATING} `).length).toBe(400_000);
      }),
    ).toBeLessThan(LIMIT_MS);
  });
});
