/// <reference types="node" />
// docs/data-model.md section 8 prints its functions as TypeScript, and section 1 says that this
// code reproduced the results of the Apple app. This test takes the printed code out of the
// document, runs it as it stands, and compares the functions of this folder with it: on the
// example vault and on generated input. Where a function here departs from the printed one on
// purpose, the departure is asserted too, so that it cannot grow unnoticed.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import fc from "fast-check";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  emptyVault,
  importDocument,
  parseTags as interchangeParseTags,
  projectNameKey as interchangeProjectNameKey,
  type Vault,
} from "../interchange/index.ts";
import {
  buildSearchText,
  contextPackMarkdown,
  matchesSearch,
  normalizeForSearch,
  parseTags,
  prepareQuery,
  projectComparator,
  projectNameKey,
  sessionContextPack,
  sortProjects,
  timelineGroups,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const DOCS = new URL("../../../docs/", import.meta.url);
const DATA_MODEL = new TextDecoder("utf-8", { fatal: true }).decode(
  readFileSync(new URL("data-model.md", DOCS)),
);

/** A fixed seed, so that a failure can be repeated; VAULT_TEST_SEED tries another. */
const SEED = Number(process.env.VAULT_TEST_SEED ?? 20261120);
function check<T extends unknown[]>(property: fc.IPropertyWithHooks<T>, numRuns: number): void {
  fc.assert(property, { seed: SEED, numRuns });
}

// ---------------------------------------------------------------------------------------------
// The printed code.
// ---------------------------------------------------------------------------------------------

function section8(): string {
  const start = DATA_MODEL.indexOf("\n## 8. Shared pure functions (TypeScript)\n");
  const end = DATA_MODEL.indexOf("\n## 9. Test vectors\n");
  if (start === -1 || end === -1 || end < start) throw new Error("data-model.md has no section 8");
  return DATA_MODEL.slice(start, end);
}

/** The bodies of the ```ts blocks of section 8, in order: 8.1, 8.2, 8.3, 8.4, 8.5. */
const BLOCKS: readonly string[] = [...section8().matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map(
  (match) => match[1] ?? "",
);

function runPrinted(): object {
  // Types are removed and `export` becomes an assignment to `exports`; nothing else is changed.
  const script = ts.transpileModule(BLOCKS.join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const printed = {};
  const load: unknown = vm.runInThisContext(`(function (exports) {${script}\n})`);
  if (typeof load !== "function") throw new Error("the printed code did not compile to a function");
  Reflect.apply(load, undefined, [printed]);
  return printed;
}

const PRINTED = runPrinted();

type Printed = (...args: readonly unknown[]) => unknown;

/** A function of the document by name. */
function printed(name: string): Printed {
  const value: unknown = Reflect.get(PRINTED, name);
  if (typeof value !== "function") throw new Error(`data-model.md section 8 prints no function ${name}`);
  return (...args) => Reflect.apply(value, undefined, args);
}

function asText(value: unknown): string {
  if (typeof value !== "string") throw new Error("the printed function returned no string");
  return value;
}
function asNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error("the printed function returned no number");
  return value;
}
function asBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("the printed function returned no boolean");
  return value;
}

const doc = {
  normalizeForSearch: (s: string): string => asText(printed("normalizeForSearch")(s)),
  buildSearchText: (s: { title: string; summary: string; tags: readonly string[] }): string =>
    asText(printed("buildSearchText")(s)),
  prepareQuery: (raw: string): string => asText(printed("prepareQuery")(raw)),
  matchesSearch: (searchText: string, query: string): boolean =>
    asBoolean(printed("matchesSearch")(searchText, query)),
  parseTags: (input: string): unknown => printed("parseTags")(input),
  contextPackMarkdown: (session: unknown, messages: unknown, options: unknown): string =>
    asText(printed("contextPackMarkdown")(session, messages, options)),
  projectNameKey: (name: string): string => asText(printed("projectNameKey")(name)),
  projectComparator: (locale: string): ((a: unknown, b: unknown) => number) => {
    const compare: unknown = printed("projectComparator")(locale);
    if (typeof compare !== "function") throw new Error("the printed projectComparator returned no function");
    return (a, b) => asNumber(Reflect.apply(compare, undefined, [a, b]));
  },
  timelineGroups: (sessions: unknown, locale: string, timeZone: string): unknown =>
    printed("timelineGroups")(sessions, locale, timeZone),
};

// ---------------------------------------------------------------------------------------------
// Generated input.
// ---------------------------------------------------------------------------------------------

const cp = (...points: number[]): string => String.fromCodePoint(...points);

/** Characters at which the rules of section 8 can go wrong. */
const UNITS: readonly string[] = [
  "a",
  "b",
  "A",
  "Z",
  "e",
  "0",
  "7",
  " ",
  "  ",
  "\t",
  "\n",
  "\r",
  "\r\n",
  ",",
  "#",
  "##",
  "-",
  "*",
  ".",
  "\\",
  "$&",
  cp(0x0b), // vertical tab
  cp(0x0c), // form feed
  cp(0x85), // next line
  cp(0xa0), // no-break space
  cp(0x2003), // em space
  cp(0x200b), // zero width space
  cp(0x2028), // line separator
  cp(0x2029), // paragraph separator
  cp(0x3000), // ideographic space
  cp(0xfeff), // byte-order mark
  cp(0), // NUL
  cp(0xe9), // e with acute, composed
  cp(0x301), // combining acute (class 230)
  cp(0x316), // combining grave below (class 220)
  cp(0x327), // combining cedilla (class 202)
  cp(0x334), // combining tilde overlay (class 1)
  cp(0x345), // combining ypogegrammeni (class 240)
  cp(0x344), // decomposes into two marks
  cp(0xf73), // decomposes into two marks of different classes
  cp(0xc5), // A with ring
  cp(0x212b), // angstrom sign: another spelling of it
  cp(0xdf), // sharp s
  cp(0x130), // I with dot above
  cp(0x131), // dotless i
  cp(0x3a3), // capital sigma
  cp(0x3c3), // small sigma
  cp(0x3c2), // final sigma
  cp(0xff21), // full-width A
  cp(0x1100), // Hangul leading consonant
  cp(0x1161), // Hangul vowel
  cp(0xac00), // Hangul syllable
  cp(0x1f600), // an emoji outside the Basic Multilingual Plane
  cp(0x10400), // Deseret capital, lower-cases outside the plane too
  cp(0xd800), // a lone high surrogate
  cp(0xdc00), // a lone low surrogate
  cp(0xe000), // private use: sorts differently by UTF-16 unit and by code point
  cp(0xffff),
];

const unit = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...UNITS) },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 2 }) },
);
// size "max" everywhere: without it fast-check keeps arrays far below their maximal length.
const anyText = fc.array(unit, { maxLength: 24, size: "max" }).map((units) => units.join(""));
const shortText = fc.array(unit, { maxLength: 6, size: "max" }).map((units) => units.join(""));

/** Marks only, often more than thirty in a row: the input composedForm puts in order itself. */
const MARKS = [cp(0x301), cp(0x316), cp(0x327), cp(0x334), cp(0x345), cp(0x344), cp(0xf73), cp(0x20dd)];
const markRun = fc
  .array(fc.constantFrom(...MARKS), { minLength: 20, maxLength: 80, size: "max" })
  .map((m) => m.join(""));
const LONG_MARK_RUN = /\p{M}{31}/u;
const markedText = fc
  .array(fc.oneof(shortText, markRun), { minLength: 1, maxLength: 4, size: "max" })
  .map((parts) => parts.join(""));

const ZONES = [
  "UTC",
  "Europe/Berlin",
  "America/New_York",
  "America/St_Johns",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
] as const;
const LOCALES = ["en-US", "en", "en-GB", "fr-FR", "de-DE", "ja-JP", "sv", "tr", "ar-EG"] as const;

/** Instants of the years 0001 to 9999, which is what a stored session can hold. */
const instant = fc.oneof(
  fc.integer({ min: -62_135_596_800_000, max: 253_402_300_799_999 }),
  // Near the ends of months and years, where the zone decides.
  fc
    .tuple(
      fc.integer({ min: 1990, max: 2040 }),
      fc.integer({ min: 0, max: 11 }),
      fc.integer({ min: -90_000_000, max: 90_000_000 }),
    )
    .map(([year, month, offset]) => Date.UTC(year, month, 1) + offset),
);

const PROVIDERS = [
  "claude",
  "chatgpt",
  "gemini",
  "other",
  "Claude",
  " ChatGPT ",
  "GEMINI\n",
  "examplebot",
  "",
];
const ROLES = [
  "user",
  "assistant",
  "system",
  "unknown",
  "tool",
  "User",
  " user",
  "constructor",
  "__proto__",
  "",
];

const packSession = fc.record({
  title: anyText,
  provider: fc.oneof(fc.constantFrom(...PROVIDERS), shortText),
  model: fc.oneof(fc.constant(""), shortText),
  source_url: fc.oneof(fc.constant(""), shortText),
  summary: fc.oneof(fc.constant(""), anyText),
  tags: fc.array(shortText, { maxLength: 4, size: "max" }),
  created_at: instant.map((ms) => new Date(ms)),
});
const packMessages = fc.array(
  fc.record({ role: fc.oneof(fc.constantFrom(...ROLES), shortText), text: anyText }),
  { maxLength: 6, size: "max" },
);

function sameSign(a: number, b: number): boolean {
  return Math.sign(a) === Math.sign(b);
}

// ---------------------------------------------------------------------------------------------

describe("the code printed in data-model.md section 8", () => {
  it("is five blocks that define the nine functions of 8.1 to 8.5", () => {
    expect(BLOCKS).toHaveLength(5);
    expect(Object.keys(PRINTED)).toEqual([
      "normalizeForSearch",
      "buildSearchText",
      "prepareQuery",
      "matchesSearch",
      "parseTags",
      "contextPackMarkdown",
      "projectNameKey",
      "projectComparator",
      "timelineGroups",
    ]);
  });

  it("gives the examples the document states for it", () => {
    // 8.2 with the field of 3.2: the leading "#" goes and repeats are dropped (B3).
    expect(doc.parseTags("Garden, Bikes ,, garden,  Two Words , #hash")).toEqual([
      "garden",
      "bikes",
      "two words",
      "hash",
    ]);
    // 9.2: search_text of #2.
    expect(
      doc.buildSearchText({ title: "Tomato blight on the balcony", summary: "", tags: ["garden"] }),
    ).toBe("tomato blight on the balcony\n\ngarden");
  });
});

describe("8.1 search: the functions here return what the printed ones return", () => {
  it("normalizeForSearch, on text of every kind", () => {
    check(
      fc.property(anyText, (text) => {
        expect(normalizeForSearch(text)).toBe(doc.normalizeForSearch(text));
      }),
      2000,
    );
  });

  it("normalizeForSearch, on long runs of combining marks, which this folder orders itself", () => {
    let longRuns = 0;
    check(
      fc.property(markedText, (text) => {
        if (LONG_MARK_RUN.test(text)) longRuns += 1;
        expect(normalizeForSearch(text)).toBe(doc.normalizeForSearch(text));
      }),
      1500,
    );
    // The claim is about runs of more than 30 marks: most of the texts must have had one.
    expect(longRuns).toBeGreaterThan(750);
  });

  it("buildSearchText", () => {
    check(
      fc.property(
        anyText,
        anyText,
        fc.array(shortText, { maxLength: 5, size: "max" }),
        (title, summary, tags) => {
          const session = { title, summary, tags };
          expect(buildSearchText(session)).toBe(doc.buildSearchText(session));
        },
      ),
      1000,
    );
  });

  it("prepareQuery", () => {
    check(
      fc.property(fc.oneof(anyText, markedText), (raw) => {
        expect(prepareQuery(raw)).toBe(doc.prepareQuery(raw));
      }),
      2000,
    );
  });

  it("matchesSearch, with queries that occur, that nearly occur and that are long", () => {
    const letters = fc.array(fc.constantFrom("a", "b", "ab", "aab", "\n", " "), {
      maxLength: 120,
      size: "max",
    });
    const seen = { long: 0, longFound: 0, longMissing: 0, shortFound: 0, shortMissing: 0 };
    check(
      fc.property(
        letters,
        letters,
        fc.nat(200),
        fc.nat(200),
        fc.boolean(),
        (hay, other, from, length, cut) => {
          const text = hay.join("");
          // A piece of the text itself, or another text of the same alphabet.
          const query = cut
            ? text.slice(from % (text.length + 1), (from % (text.length + 1)) + length)
            : other.join("");
          const found = matchesSearch(text, query);
          expect(found).toBe(doc.matchesSearch(text, query));
          if (query.length > 64) {
            seen.long += 1;
            if (found) seen.longFound += 1;
            else seen.longMissing += 1;
          } else if (found) seen.shortFound += 1;
          else seen.shortMissing += 1;
        },
      ),
      3000,
    );
    // Queries of more than 64 units take the path written in this folder: both answers must occur.
    expect(seen.longFound).toBeGreaterThan(200);
    expect(seen.longMissing).toBeGreaterThan(200);
    expect(seen.shortFound).toBeGreaterThan(200);
    expect(seen.shortMissing).toBeGreaterThan(200);
  });

  it("matchesSearch, on text of every kind", () => {
    check(
      fc.property(anyText, shortText, (text, query) => {
        expect(matchesSearch(text, query)).toBe(doc.matchesSearch(text, query));
        const prepared = prepareQuery(query);
        const searchText = buildSearchText({ title: text, summary: query, tags: [] });
        expect(matchesSearch(searchText, prepared)).toBe(doc.matchesSearch(searchText, prepared));
      }),
      1000,
    );
  });
});

describe("8.2 tags: parseTags returns what the printed one returns", () => {
  // Tags from a small pool, so that repeats, leading "#" and empty parts are common.
  const part = fc.oneof(
    {
      weight: 5,
      arbitrary: fc.constantFrom("a", "A", " a ", "#a", "##A", "# a", "b", "B ", "two words", ""),
    },
    { weight: 2, arbitrary: fc.constantFrom(" ", "#", "# #", "\t", cp(0xa0), cp(0x3000), cp(0xfeff)) },
    { weight: 2, arbitrary: shortText },
  );
  const field = fc
    .tuple(fc.array(part, { maxLength: 7, size: "max" }), fc.constantFrom(",", ", ", " ,", ",,"))
    .map(([parts, separator]) => parts.join(separator));

  it("on fields of every kind, and so does the copy the interchange module keeps", () => {
    const seen = { none: 0, several: 0, hash: 0, repeat: 0 };
    check(
      fc.property(field, (input) => {
        const expected = doc.parseTags(input);
        const tags = parseTags(input);
        expect(tags).toEqual(expected);
        expect(interchangeParseTags(input)).toEqual(expected);
        if (tags.length === 0) seen.none += 1;
        if (tags.length > 1) seen.several += 1;
        const parts = input.split(",").map((part) => part.trim().toLowerCase());
        if (parts.some((part) => part.startsWith("#") && part.replace(/^#+/, "").trim() !== ""))
          seen.hash += 1;
        if (new Set(parts.filter((part) => part !== "")).size < parts.filter((part) => part !== "").length) {
          seen.repeat += 1;
        }
      }),
      3000,
    );
    // The generated fields really had empty results, several tags, leading "#" and repeats.
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(100);
  });
});

describe("8.3 context pack: contextPackMarkdown returns the bytes the printed one returns", () => {
  it("for sessions, messages, dates and time zones of every kind", () => {
    const seen = { summary: 0, tags: 0, model: 0, link: 0, messages: 0, known: 0, other: 0, note: 0 };
    check(
      fc.property(packSession, packMessages, fc.constantFrom(...ZONES), (session, messages, timeZone) => {
        const pack = contextPackMarkdown(session, messages, { timeZone });
        expect(pack).toBe(doc.contextPackMarkdown(session, messages, { timeZone }));
        if (session.summary !== "") seen.summary += 1;
        if (session.tags.length > 0) seen.tags += 1;
        if (session.model !== "") seen.model += 1;
        if (session.source_url !== "") seen.link += 1;
        if (messages.length > 0) seen.messages += 1;
        if (pack.includes("\nOrigin: Other")) seen.other += 1;
        else seen.known += 1;
        if (pack.includes("\n**Note:**\n")) seen.note += 1;
      }),
      1500,
    );
    // Every optional part of the template, both kinds of provider and the fallback label occurred.
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(150);
  });

  it("departure: without a time zone the printed one silently uses the zone of the machine; this one throws", () => {
    const session = {
      title: "t",
      provider: "other",
      model: "",
      source_url: "",
      summary: "",
      tags: [],
      created_at: new Date(0),
    };
    expect(doc.contextPackMarkdown(session, [], {})).toContain("Origin: Other, saved ");
    expect(() => Reflect.apply(contextPackMarkdown, undefined, [session, [], {}])).toThrow(TypeError);
  });
});

describe("8.4 project names: key and order are those of the printed functions", () => {
  it("projectNameKey, here and in the interchange module", () => {
    check(
      fc.property(fc.oneof(anyText, markedText), (name) => {
        const expected = doc.projectNameKey(name);
        expect(projectNameKey(name)).toBe(expected);
        expect(interchangeProjectNameKey(name)).toBe(expected);
      }),
      2000,
    );
  });

  it("projectComparator orders two different projects as the printed one does", () => {
    const project = fc.record({
      id: fc.uuid(),
      name: fc.oneof(shortText, fc.constantFrom("a", "A", "a2", "a10")),
    });
    const decidedBy = { collation: 0, units: 0, id: 0 };
    check(
      fc.property(project, project, fc.constantFrom("en", "sv", "de", "tr", "ja"), (a, b, locale) => {
        fc.pre(a.id !== b.id);
        const mine = projectComparator(locale)(a, b);
        expect(sameSign(mine, doc.projectComparator(locale)(a, b))).toBe(true);
        expect(mine).not.toBe(0);
        const collation = new Intl.Collator(locale, { numeric: true, sensitivity: "base" }).compare(
          a.name,
          b.name,
        );
        if (collation !== 0) decidedBy.collation += 1;
        else if (a.name !== b.name) decidedBy.units += 1;
        else decidedBy.id += 1;
      }),
      2000,
    );
    // All three steps of the comparison decided some of the pairs.
    for (const count of Object.values(decidedBy)) expect(count).toBeGreaterThan(30);
  });

  it("departure: for one and the same project the printed comparator answers 1 both ways; this one answers 0", () => {
    const project = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Garden" };
    expect(doc.projectComparator("en")(project, { ...project })).toBe(1);
    expect(projectComparator("en")(project, { ...project })).toBe(0);
  });

  it("sorted lists are the same", () => {
    const projects = fc.uniqueArray(
      fc.record({ id: fc.uuid(), name: fc.oneof(shortText, fc.constantFrom("a", "A", "a2", "a10", "b")) }),
      { maxLength: 12, size: "max", selector: (item) => item.id },
    );
    check(
      fc.property(projects, (list) => {
        const expected = [...list].sort(doc.projectComparator("en"));
        expect(sortProjects(list, "en")).toEqual(expected);
      }),
      500,
    );
  });
});

describe("8.5 timeline: timelineGroups returns the groups the printed one returns", () => {
  it("for sessions with different ids, in every locale and time zone tried", () => {
    // Mostly instants within two years and near the turn of a month, so that months are shared.
    const near = fc
      .tuple(
        fc.integer({ min: 2025, max: 2026 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: -90_000_000, max: 90_000_000 }),
      )
      .map(([year, month, offset]) => Date.UTC(year, month, 1) + offset);
    const sessions = fc.uniqueArray(
      fc.record({
        id: fc.uuid(),
        created_at: fc
          .oneof({ weight: 3, arbitrary: near }, { weight: 1, arbitrary: instant })
          .map((ms) => new Date(ms)),
      }),
      { maxLength: 12, size: "max", selector: (item) => item.id },
    );
    const seen = { severalGroups: 0, sharedGroup: 0 };
    check(
      fc.property(
        sessions,
        fc.constantFrom(...LOCALES),
        fc.constantFrom(...ZONES),
        (list, locale, timeZone) => {
          const groups = timelineGroups(list, locale, timeZone);
          expect(groups).toEqual(doc.timelineGroups(list, locale, timeZone));
          if (groups.length > 1) seen.severalGroups += 1;
          if (groups.some((group) => group.sessions.length > 1)) seen.sharedGroup += 1;
        },
      ),
      1500,
    );
    // Lists with several months occurred, and months with several sessions.
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(150);
  });

  it("also when many sessions share one instant, where only the id decides", () => {
    const sessions = fc.uniqueArray(
      fc.record({
        id: fc.uuid(),
        created_at: fc.constantFrom(0, 1, 2_592_000_000).map((ms) => new Date(ms)),
      }),
      { maxLength: 20, size: "max", selector: (item) => item.id },
    );
    check(
      fc.property(sessions, (list) => {
        expect(timelineGroups(list, "en-US", "UTC")).toEqual(doc.timelineGroups(list, "en-US", "UTC"));
      }),
      500,
    );
  });
});

describe("on the example vault the two agree as well", () => {
  function importExample(): Vault {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      readFileSync(new URL("example-vault-export.json", DOCS)),
    );
    let n = 0;
    const imported = importDocument(emptyVault(), text, {
      now: new Date("2026-11-20T08:00:00.000Z"),
      newId: () => `ffffffff-ffff-4fff-8fff-${String(++n).padStart(12, "0")}`,
    });
    if (!imported.ok) throw new Error("the example was refused");
    return imported.vault;
  }
  const vault = importExample();

  it("every context pack, in two time zones", () => {
    expect(vault.sessions).toHaveLength(6);
    for (const session of vault.sessions) {
      for (const timeZone of ["UTC", "Europe/Berlin"]) {
        expect(sessionContextPack(session, { timeZone })).toBe(
          doc.contextPackMarkdown(session, session.messages, { timeZone }),
        );
      }
    }
  });

  it("every search text, the project order, and the timeline in two time zones", () => {
    for (const session of vault.sessions) {
      expect(buildSearchText(session)).toBe(doc.buildSearchText(session));
    }
    expect(sortProjects(vault.projects, "en")).toEqual([...vault.projects].sort(doc.projectComparator("en")));
    for (const timeZone of ["UTC", "Europe/Berlin"]) {
      expect(timelineGroups(vault.sessions, "en-US", timeZone)).toEqual(
        doc.timelineGroups([...vault.sessions], "en-US", timeZone),
      );
    }
  });
});
