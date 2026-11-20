// Project names (docs/data-model.md 3.1, 8.4, B2, B5): the key two names are compared by, the
// order of the project list, and the rule for creating and renaming.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { projectNameKey as interchangeProjectNameKey } from "../interchange/index.ts";
import {
  checkProjectName,
  type NamedProject,
  projectComparator,
  projectNameKey,
  sortProjects,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
const cp = (...points: number[]): string => String.fromCodePoint(...points);

const E_ACUTE = cp(0xe9);
const CAPITAL_E_ACUTE = cp(0xc9);
const COMBINING_ACUTE = cp(0x301);
const A_RING = cp(0xc5);
const O_UMLAUT = cp(0xf6);

function id(number: number): string {
  return `aaaaaaaa-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function projects(...names: string[]): NamedProject[] {
  return names.map((name, index) => ({ id: id(index + 1), name }));
}

function order(names: string[], locale = "en"): string[] {
  return sortProjects(projects(...names), locale).map((project) => project.name);
}

describe("8.4 projectNameKey: trimmed, in composed form, in lower case", () => {
  it.each([
    ["Garden", "garden"],
    ["  Garden  ", "garden"],
    ["GARDEN", "garden"],
    [`\t${cp(0xa0)}Garden${cp(0x3000)}\n`, "garden"],
    ["Bike workshop", "bike workshop"],
    ["Bike  workshop", "bike  workshop"],
    [`Caf${E_ACUTE}`, `caf${E_ACUTE}`],
    [`Cafe${COMBINING_ACUTE}`, `caf${E_ACUTE}`],
    [`CAF${CAPITAL_E_ACUTE}`, `caf${E_ACUTE}`],
    [`Stra${cp(0xdf)}e`, `stra${cp(0xdf)}e`],
    ["", ""],
    ["   ", ""],
  ])("%j has the key %j", (name, key) => {
    expect(projectNameKey(name)).toBe(key);
  });

  it("names that differ only in case, outer white space or composition share a key; others do not (B2)", () => {
    const same = ["Garden", " garden", "GARDEN ", "gArDeN"];
    expect(new Set(same.map(projectNameKey)).size).toBe(1);
    expect(projectNameKey(`Cafe${COMBINING_ACUTE}`)).toBe(projectNameKey(`caf${E_ACUTE}`));
    expect(projectNameKey("Cafe")).not.toBe(projectNameKey(`Caf${E_ACUTE}`));
    expect(projectNameKey("Strasse")).not.toBe(projectNameKey(`Stra${cp(0xdf)}e`));
    expect(projectNameKey("Bike workshop")).not.toBe(projectNameKey("Bikeworkshop"));
    expect(projectNameKey("a b")).not.toBe(projectNameKey(`a${cp(0xa0)}b`));
  });

  it("is the key the interchange module merges projects by", () => {
    const name = fc
      .array(
        fc.constantFrom(
          "a",
          "B",
          " ",
          "\t",
          E_ACUTE,
          COMBINING_ACUTE,
          cp(0x316),
          cp(0x130),
          cp(0x3a3),
          cp(0xa0),
          "1",
        ),
        { maxLength: 40, size: "max" },
      )
      .map((units) => units.join(""));
    fc.assert(
      fc.property(name, (generated) => {
        expect(projectNameKey(generated)).toBe(interchangeProjectNameKey(generated));
      }),
      { seed: SEED, numRuns: 3000 },
    );
  });

  it("takes time in proportion to the name: 400,000 combining marks in the wrong order", () => {
    // The interchange module's copy hands the name to the platform as it is: 83 s were measured.
    const name = ` Garden${COMBINING_ACUTE.repeat(200_000)}${cp(0x316).repeat(200_000)} `;
    const started = performance.now();
    const key = projectNameKey(name);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(key).toBe(`garde${cp(0x144)}${cp(0x316).repeat(200_000)}${COMBINING_ACUTE.repeat(199_999)}`);
  });
});

describe("8.4 projectComparator: dictionary order without case, digits as numbers (B5)", () => {
  it("9.2: apple pie ideas, Bike workshop, Garden", () => {
    expect(order(["Bike workshop", "Garden", "apple pie ideas"])).toEqual([
      "apple pie ideas",
      "Bike workshop",
      "Garden",
    ]);
  });

  it("B5: 'Zebra' no longer comes before 'apple', nor '10 things' before '2 things'", () => {
    expect(order(["Zebra", "apple"])).toEqual(["apple", "Zebra"]);
    expect(order(["10 things", "2 things"])).toEqual(["2 things", "10 things"]);
    expect(order(["apple 10", "apple 2", "apple 1"])).toEqual(["apple 1", "apple 2", "apple 10"]);
    expect(order(["v1.10", "v1.9", "v1.2"])).toEqual(["v1.2", "v1.9", "v1.10"]);
  });

  it("names that differ only in case or accents are ordered by their UTF-16 units", () => {
    // Capital before small ("A" is 0x41, "a" 0x61); plain before accented ("e" 0x65, capital E acute 0xC9).
    expect(order(["apple", "Apple"])).toEqual(["Apple", "apple"]);
    expect(order([`${CAPITAL_E_ACUTE}clair`, "eclair"])).toEqual(["eclair", `${CAPITAL_E_ACUTE}clair`]);
    expect(order(["banana", "BANANA", "Banana"])).toEqual(["BANANA", "Banana", "banana"]);
  });

  it("projects with one and the same name are ordered by id", () => {
    const twins = [
      { id: id(3), name: "Garden" },
      { id: id(1), name: "Garden" },
      { id: id(2), name: "Garden" },
    ];
    expect(sortProjects(twins, "en").map((project) => project.id)).toEqual([id(1), id(2), id(3)]);
    expect(projectComparator("en")({ id: id(1), name: "Garden" }, { id: id(1), name: "Garden" })).toBe(0);
  });

  it("the fifteen names of 3.1 under the English rules of this platform", () => {
    const names = [
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
      `${A_RING}ngstr${O_UMLAUT}m`,
      `${CAPITAL_E_ACUTE}clair`,
    ];
    expect(order(names)).toEqual([
      " leading space",
      "_x",
      "2 things",
      "10 things",
      `${A_RING}ngstr${O_UMLAUT}m`,
      "Apple",
      "apple",
      "apple 2",
      "apple 10",
      "Banana",
      "banana",
      "eclair",
      `${CAPITAL_E_ACUTE}clair`,
      "Zebra",
      "zebra",
    ]);
    // The same, whatever order the list had.
    expect(order([...names].reverse())).toEqual(order(names));
  });

  it("the locale is the viewer's: in Swedish the A with ring is a letter after Z", () => {
    const names = ["Zebra", `${A_RING}ngstr${O_UMLAUT}m`, "apple"];
    expect(order(names, "en")).toEqual([`${A_RING}ngstr${O_UMLAUT}m`, "apple", "Zebra"]);
    expect(order(names, "sv")).toEqual(["apple", "Zebra", `${A_RING}ngstr${O_UMLAUT}m`]);
  });

  it("is a total order: 0 only for one project, and consistent in threes", () => {
    const project = fc.record({
      id: fc.constantFrom(id(1), id(2), id(3)),
      name: fc.constantFrom("a", "A", "b", "a2", "a10", `${E_ACUTE}`, "e", "E", "", " ", "a b"),
    });
    const compare = projectComparator("en");
    fc.assert(
      fc.property(project, project, project, (a, b, c) => {
        const ab = compare(a, b);
        expect(Math.sign(compare(b, a)) + Math.sign(ab)).toBe(0);
        if (ab === 0) expect(a).toEqual(b);
        if (ab <= 0 && compare(b, c) <= 0) expect(compare(a, c)).toBeLessThanOrEqual(0);
      }),
      { seed: SEED, numRuns: 5000 },
    );
  });

  it("sortProjects returns a new array and keeps everything a project carries", () => {
    const list = Object.freeze([
      Object.freeze({ id: id(1), name: "b", extra: 1 }),
      Object.freeze({ id: id(2), name: "a", extra: 2 }),
    ]);
    const sorted = sortProjects(list, "en");
    expect(sorted).toEqual([list[1], list[0]]);
    expect(sorted[0]).toBe(list[1]);
    expect(list.map((project) => project.name)).toEqual(["b", "a"]);
    expect(sortProjects([], "en")).toEqual([]);
  });

  it("refuses a locale that is no language tag (RangeError) and a missing one (TypeError)", () => {
    expect(() => projectComparator("not a locale")).toThrow(RangeError);
    expect(() => sortProjects(projects("a"), "")).toThrow(RangeError);
    expect(() => Reflect.apply(projectComparator, undefined, [])).toThrow(TypeError);
    expect(() => Reflect.apply(projectComparator, undefined, [undefined])).toThrow(TypeError);
  });
});

describe("8.4 creating and renaming: trim, refuse an empty name, refuse a name whose key is taken", () => {
  const existing = projects("Garden", "Bike workshop", `Caf${E_ACUTE}`);

  it("a new name is accepted, trimmed, with its key", () => {
    expect(checkProjectName("  Apple pie ideas ", existing)).toEqual({
      ok: true,
      name: "Apple pie ideas",
      key: "apple pie ideas",
    });
    expect(checkProjectName("First", [])).toEqual({ ok: true, name: "First", key: "first" });
  });

  it.each(["", " ", "   ", "\t\n", cp(0xa0), cp(0x3000), cp(0), ` ${cp(0)} `])(
    "the empty name %j is refused",
    (name) => {
      expect(checkProjectName(name, existing)).toEqual({ ok: false, reason: "empty", takenBy: null });
      expect(checkProjectName(name, [])).toEqual({ ok: false, reason: "empty", takenBy: null });
    },
  );

  it.each([
    ["Garden", 1],
    ["garden", 1],
    ["  GARDEN ", 1],
    ["bike workshop", 2],
    [`CAFE${COMBINING_ACUTE}`, 3],
  ])("%j is taken by project %i", (name, holder) => {
    expect(checkProjectName(name, existing)).toEqual({ ok: false, reason: "taken", takenBy: id(holder) });
  });

  it("a project may keep its own name, or respell it; it may not take another project's", () => {
    expect(checkProjectName("Garden", existing, id(1))).toEqual({ ok: true, name: "Garden", key: "garden" });
    expect(checkProjectName(" garden", existing, id(1))).toEqual({ ok: true, name: "garden", key: "garden" });
    expect(checkProjectName("Garden", existing, id(2))).toEqual({
      ok: false,
      reason: "taken",
      takenBy: id(1),
    });
    // 6.1: the id is compared in lower case.
    expect(checkProjectName("Garden", existing, id(1).toUpperCase())).toEqual({
      ok: true,
      name: "Garden",
      key: "garden",
    });
  });

  it("C9: U+0000 is removed and a lone surrogate replaced before anything else", () => {
    expect(checkProjectName(`Gar${cp(0)}den`, [])).toEqual({ ok: true, name: "Garden", key: "garden" });
    expect(checkProjectName(`Gar${cp(0)}den`, existing)).toEqual({
      ok: false,
      reason: "taken",
      takenBy: id(1),
    });
    expect(checkProjectName(`${cp(0xd800)}x`, [])).toEqual({
      ok: true,
      name: `${cp(0xfffd)}x`,
      key: `${cp(0xfffd)}x`,
    });
  });

  it("names with one key that a vault already holds twice: the first holder is named", () => {
    const doubled = projects("Garden", "garden");
    expect(checkProjectName("GARDEN", doubled)).toEqual({ ok: false, reason: "taken", takenBy: id(1) });
    // Renaming the first of them, the second still holds the key.
    expect(checkProjectName("GARDEN", doubled, id(1))).toEqual({
      ok: false,
      reason: "taken",
      takenBy: id(2),
    });
  });

  it("an accepted name is one the format accepts: not empty, with a visible character, key not empty", () => {
    const name = fc
      .array(fc.constantFrom("a", "B", " ", "\t", cp(0), cp(0xd800), cp(0xa0), E_ACUTE, cp(0x200b), ","), {
        maxLength: 8,
        size: "max",
      })
      .map((units) => units.join(""));
    const seen = { ok: 0, empty: 0 };
    fc.assert(
      fc.property(name, (generated) => {
        const result = checkProjectName(generated, []);
        if (!result.ok) {
          expect(result.reason).toBe("empty");
          seen.empty += 1;
          return;
        }
        seen.ok += 1;
        expect(/\S/u.test(result.name)).toBe(true);
        expect(result.name).toBe(result.name.trim());
        expect(result.name.includes(cp(0))).toBe(false);
        expect(result.key).toBe(projectNameKey(result.name));
        expect(result.key).not.toBe("");
        // Checking the stored name again changes nothing.
        expect(checkProjectName(result.name, [])).toEqual(result);
      }),
      { seed: SEED, numRuns: 2000 },
    );
    expect(seen.ok).toBeGreaterThan(500);
    expect(seen.empty).toBeGreaterThan(50);
  });
});
