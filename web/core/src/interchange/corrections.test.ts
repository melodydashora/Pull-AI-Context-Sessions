/// <reference types="node" />
// docs/corrections.md section 2, as far as it speaks of the reader: the general rule G2, the points
// 1 to 8 and 13, and the rule about property names. One describe per point. The inputs and the
// expected values are taken from the words of the rule, not from the code; where the rule gives a
// formula, the test writes that formula again and compares.
//
// The merge, the writer and the storage invariant G1 are in corrections-merge.test.ts, the file
// names of point 16 in filename.test.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  classifyBundleEntry,
  decodeBase64,
  emptyVault,
  encodeBase64,
  exportDocument,
  FALLBACK_PROVIDER,
  FALLBACK_ROLE,
  importDocument,
  isOpenValueTooLong,
  KNOWN_PROVIDERS,
  KNOWN_ROLES,
  MAX_OPEN_VALUE_CHARACTERS,
  type Notice,
  normaliseTags,
  normalizeOpen,
  type Problem,
  parseTags,
  parseTimestamp,
  projectNameKey,
  type ReadOptions,
  readDocument,
  validateDocument,
  webGenerator,
} from "./index.ts";

// Property tests and large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const EXAMPLE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(
  readFileSync(new URL("../../../docs/example-vault-export.json", import.meta.url)),
);
const example = () => JSON.parse(EXAMPLE_TEXT);

/** Characters by code point: the sources of this folder are plain ASCII. */
const cp = (...points: number[]): string => String.fromCodePoint(...points);
const NUL = cp(0);
const LONE_HIGH = cp(0xd83d);
const REPLACEMENT = cp(0xfffd);

function read(input: unknown, options?: ReadOptions) {
  const result = readDocument(input, options);
  if (!result.ok)
    throw new Error(`refused: ${result.problems.items.map((p) => `${p.rule} ${p.path}`).join(", ")}`);
  return result;
}

function refused(input: unknown, options?: ReadOptions): readonly Problem[] {
  const result = readDocument(input, options);
  if (result.ok) throw new Error("the document should have been refused");
  return result.problems.items;
}

const codes = (notices: readonly Notice[]): string[] =>
  notices.map((notice) => `${notice.code} ${notice.path}`);
const brief = (problems: readonly Problem[]): string[] =>
  problems.map((p) => `${p.rule}${p.keyword === undefined ? "" : `:${p.keyword}`} ${p.path}`);

function elapsed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

// A small document of its own, so that a test states everything it depends on.
const T1 = "2026-05-01T10:00:00.000Z";
const PROJECT_1 = "aaaaaaaa-0000-4000-8000-000000000001";
const SESSION_1 = "5e550000-0000-4000-8000-000000000001";
const messageId = (n: number): string => `0e550001-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Loose = Record<string, unknown>;

function message(n: number, changes: Loose = {}): Loose {
  return {
    id: messageId(n),
    index: n,
    role: "user",
    segments: [{ type: "text", text: `text ${n}` }],
    ...changes,
  };
}

function session(changes: Loose = {}): Loose {
  return {
    id: SESSION_1,
    title: "A session",
    provider: "claude",
    created_at: T1,
    imported_at: T1,
    messages: [message(0), message(1, { role: "assistant" })],
    ...changes,
  };
}

function documentOf(sessions: Loose[], projects: Loose[] = [], changes: Loose = {}): Loose {
  return {
    format: "sessionvault-interchange",
    version: 1,
    kind: "vault",
    exported_at: "2026-06-01T00:00:00.000Z",
    projects,
    sessions,
    ...changes,
  };
}

const firstSession = (input: unknown, options?: ReadOptions) => {
  const found = read(input, options).doc.sessions[0];
  if (found === undefined) throw new Error("the document has no session");
  return found;
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------------------------
// G2
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, G2: provider and role are normalised by one function, normalizeOpen", () => {
  /** The six characters the rule names: U+0020, U+0009, U+000A, U+000B, U+000C, U+000D. */
  const TRIMMED = [0x20, 0x09, 0x0a, 0x0b, 0x0c, 0x0d];
  /** White space to other rules (JavaScript's trim, Unicode, Java, Python): not to this one. */
  const NOT_TRIMMED = [
    0xa0, 0x85, 0x1680, 0x2000, 0x2003, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff, 0x200b, 0x1c,
    0x1d, 0x1e, 0x1f, 0x00, 0x08, 0x0e, 0x7f,
  ];
  const provider = (value: string): string => normalizeOpen(value, KNOWN_PROVIDERS, FALLBACK_PROVIDER);
  const role = (value: string): string => normalizeOpen(value, KNOWN_ROLES, FALLBACK_ROLE);

  /** The rule again, sentence by sentence, with other means than the function under test. */
  function byTheWords(value: string, known: readonly string[], fallback: string): string {
    const units = [...value].map((character) => character);
    const isBlank = (character: string | undefined): boolean =>
      character !== undefined && character.length === 1 && TRIMMED.includes(character.charCodeAt(0));
    // "trim": only those six characters, at both ends.
    while (isBlank(units[0])) units.shift();
    while (isBlank(units[units.length - 1])) units.pop();
    const trimmed = units.join("");
    // "an empty result becomes the fallback"
    if (trimmed === "") return fallback;
    // "if the value equals a known value when only the ASCII letters A to Z are folded, the known
    // lower-case value is stored"
    const folded = units
      .map((character) => {
        const at = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(character);
        return at === -1 ? character : "abcdefghijklmnopqrstuvwxyz".charAt(at);
      })
      .join("");
    for (const candidate of known) if (candidate === folded) return candidate;
    // "otherwise the trimmed value is stored as written"
    return trimmed;
  }

  it("a known value in any ASCII letter case is stored as the known lower-case value", () => {
    expect(provider("claude")).toBe("claude");
    expect(provider("Claude")).toBe("claude");
    expect(provider("CLAUDE")).toBe("claude");
    expect(provider("ChatGPT")).toBe("chatgpt");
    expect(provider("GeMiNi")).toBe("gemini");
    expect(provider("OTHER")).toBe("other");
    expect(role("User")).toBe("user");
    expect(role("ASSISTANT")).toBe("assistant");
    expect(role("sYSTEM")).toBe("system");
    expect(role("Unknown")).toBe("unknown");
  });

  it("any other value is stored trimmed and otherwise as written: its letters keep their case", () => {
    expect(provider("ExampleBot")).toBe("ExampleBot");
    expect(provider("  Example  Bot 2\t")).toBe("Example  Bot 2");
    expect(provider("CLAUDE 5")).toBe("CLAUDE 5");
    expect(role("Tool")).toBe("Tool");
    expect(role("\nSUBAGENT\n")).toBe("SUBAGENT");
    // A known role is no known provider, and the other way round.
    expect(provider("User")).toBe("User");
    expect(role("Claude")).toBe("Claude");
  });

  it("an empty result becomes the fallback: other for a provider, unknown for a role", () => {
    for (const empty of ["", " ", "\t", "\n\n", " \t\n\u000b\u000c\r ", "\r\n"]) {
      expect(provider(empty), JSON.stringify(empty)).toBe("other");
      expect(role(empty), JSON.stringify(empty)).toBe("unknown");
    }
  });

  it("the trim removes exactly U+0020, U+0009, U+000A, U+000B, U+000C and U+000D", () => {
    for (const code of TRIMMED) {
      const blank = cp(code);
      expect(provider(`${blank}Claude${blank}`), `U+${code.toString(16)}`).toBe("claude");
      expect(provider(`${blank}${blank}Example Bot${blank}`), `U+${code.toString(16)}`).toBe("Example Bot");
      expect(role(blank), `U+${code.toString(16)}`).toBe("unknown");
    }
    for (const code of NOT_TRIMMED) {
      const other = cp(code);
      // Not trimmed, so the value is no known one and is stored as written, capital letter included.
      expect(provider(`${other}Claude`), `U+${code.toString(16)}`).toBe(`${other}Claude`);
      expect(provider(`Claude${other}`), `U+${code.toString(16)}`).toBe(`Claude${other}`);
      // And it is not empty: no fallback.
      expect(role(other), `U+${code.toString(16)}`).toBe(other);
    }
  });

  it("the fold is ASCII only: a letter that only Unicode lower-casing turns into an ASCII letter is not folded", () => {
    // U+212A KELVIN SIGN: toLowerCase() gives "k", so "UN" + sign + "NOWN" would become "unknown".
    const kelvin = cp(0x212a);
    expect(`UN${kelvin}NOWN`.toLowerCase()).toBe("unknown");
    expect(role(`UN${kelvin}NOWN`)).toBe(`UN${kelvin}NOWN`);
    expect(role(`un${kelvin}nown`)).toBe(`un${kelvin}nown`);
    // U+0130, U+0131 (dotted capital I, dotless small i) and full-width letters stay too.
    expect(provider(`GEM${cp(0x130)}N${cp(0x130)}`)).toBe(`GEM${cp(0x130)}N${cp(0x130)}`);
    expect(provider(`gem${cp(0x131)}n${cp(0x131)}`)).toBe(`gem${cp(0x131)}n${cp(0x131)}`);
    expect(provider(cp(0xff23, 0xff2c, 0xff21, 0xff35, 0xff24, 0xff25))).toBe(
      cp(0xff23, 0xff2c, 0xff21, 0xff35, 0xff24, 0xff25),
    );
    // A letter with an accent is another letter.
    expect(provider(`Cl${cp(0xe1)}ude`)).toBe(`Cl${cp(0xe1)}ude`);
  });

  it("is the rule, sentence by sentence, on generated values; applying it twice changes nothing", () => {
    const unit = fc.constantFrom(
      ..."claudeCLAUDEusrUSR",
      " ",
      "\t",
      "\n",
      "\r",
      cp(0x0b),
      cp(0x0c),
      cp(0xa0),
      cp(0x2028),
      cp(0x212a),
      cp(0x130),
      NUL,
      cp(0x1f600),
    );
    const pools = [
      fc.string({ unit, maxLength: 12 }),
      fc.constantFrom(
        "claude",
        "CHATGPT",
        "Gemini",
        "other",
        "user",
        "Assistant",
        "SYSTEM",
        "unknown",
        "tool",
      ),
      // Nothing but blanks of the rule: the fallback.
      fc.constantFrom("", " ", "\t\n", " \r ", "\n\n\n"),
    ] as const;
    // Mostly the blanks of the rule around a value, now and then a blank that is none to it.
    const pad = fc.string({
      unit: fc.constantFrom(" ", " ", "\t", "\n", "\r", cp(0x0b), cp(0x0c), cp(0xa0)),
      maxLength: 3,
    });
    const padded = fc
      .tuple(pad, fc.oneof(...pools), pad)
      .map(([before, value, after]) => before + value + after);
    const seen = { fallback: 0, known: 0, asWritten: 0, trimmed: 0 };
    fc.assert(
      fc.property(padded, (value) => {
        const lists: readonly (readonly [readonly string[], string])[] = [
          [KNOWN_PROVIDERS, "other"],
          [KNOWN_ROLES, "unknown"],
        ];
        for (const [known, fallback] of lists) {
          const stored = normalizeOpen(value, known, fallback);
          expect(stored).toBe(byTheWords(value, known, fallback));
          expect(normalizeOpen(stored, known, fallback)).toBe(stored);
          if (stored === fallback && !known.includes(value)) seen.fallback += 1;
          else if (known.includes(stored)) seen.known += 1;
          else seen.asWritten += 1;
          if (stored.length < value.length) seen.trimmed += 1;
        }
      }),
      { numRuns: 4000, seed: 20261120 },
    );
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(100);
  });

  it("the trim is a loop: megabytes of blanks that do not end the value cost no more than their length", () => {
    // An expression of the form <class>+$ needs minutes on such a value.
    const blanks = " ".repeat(2_000_000);
    const inner = `x${blanks}y`;
    let stored = "";
    expect(elapsed(() => (stored = provider(`${blanks}${inner}${blanks}`)))).toBeLessThan(5000);
    expect(stored === inner).toBe(true);
    expect(
      elapsed(() => (stored = role(`${"\t\n".repeat(1_000_000)}User${"\r ".repeat(1_000_000)}`))),
    ).toBeLessThan(5000);
    expect(stored).toBe("user");
  });

  describe("in the reader (6.6 repair 2 is G2)", () => {
    const providerOf = (value: unknown) => firstSession(documentOf([session({ provider: value })])).provider;
    const roleOf = (value: unknown) =>
      firstSession(documentOf([session({ messages: [message(0, { role: value })] })])).messages[0]?.role;

    it("uses it for provider and for role", () => {
      expect(providerOf(" Claude\t")).toBe("claude");
      expect(providerOf("CHATGPT")).toBe("chatgpt");
      expect(providerOf("  Example Bot  ")).toBe("Example Bot");
      expect(providerOf(" \n ")).toBe("other");
      expect(roleOf("ASSISTANT\n")).toBe("assistant");
      expect(roleOf("Tool")).toBe("Tool");
      expect(roleOf("\t")).toBe("unknown");
      // Not JavaScript's trim() and not toLowerCase(): the two values below stay as written.
      expect(providerOf(`${cp(0xa0)}Claude`)).toBe(`${cp(0xa0)}Claude`);
      expect(roleOf(`UN${cp(0x212a)}NOWN`)).toBe(`UN${cp(0x212a)}NOWN`);
    });

    it("says so once per value it changed, and says nothing for a value in stored form", () => {
      const changed = read(
        documentOf([session({ provider: "Claude ", messages: [message(0, { role: "USER" }), message(1)] })]),
      );
      expect(codes(changed.repairs.items)).toEqual([
        "value_folded /sessions/0/provider",
        "value_folded /sessions/0/messages/0/role",
      ]);
      const stored = read(
        documentOf([session({ provider: "Example Bot", messages: [message(0, { role: "Tool" })] })]),
      );
      expect(stored.repairs.total).toBe(0);
    });
  });

  describe("a provider and a message role of more than 200 characters are refused before any normalisation", () => {
    const withProvider = (value: string) => documentOf([session({ provider: value })]);
    const withRole = (value: string) => documentOf([session({ messages: [message(0, { role: value })] })]);

    it("200 characters are accepted, 201 are refused", () => {
      expect(MAX_OPEN_VALUE_CHARACTERS).toBe(200);
      expect(firstSession(withProvider("p".repeat(200))).provider).toBe("p".repeat(200));
      expect(brief(refused(withProvider("p".repeat(201))))).toEqual(["limit /sessions/0/provider"]);
      expect(firstSession(withRole("r".repeat(200))).messages[0]?.role).toBe("r".repeat(200));
      expect(brief(refused(withRole("r".repeat(201))))).toEqual(["limit /sessions/0/messages/0/role"]);
    });

    it("before any normalisation: a value that trimming would make short enough is refused all the same", () => {
      // 6 letters and 194 blanks are 200 characters: accepted, and then normalised.
      expect(firstSession(withProvider(`claude${" ".repeat(194)}`)).provider).toBe("claude");
      expect(firstSession(withProvider(" ".repeat(200))).provider).toBe("other");
      // One blank more: refused, although "claude" and "other" would be left.
      expect(brief(refused(withProvider(`claude${" ".repeat(195)}`)))).toEqual([
        "limit /sessions/0/provider",
      ]);
      expect(brief(refused(withProvider(" ".repeat(201))))).toEqual(["limit /sessions/0/provider"]);
      expect(brief(refused(withRole(`${"\n".repeat(197)}user`)))).toEqual([
        "limit /sessions/0/messages/0/role",
      ]);
      expect(firstSession(withRole(`${"\n".repeat(196)}user`)).messages[0]?.role).toBe("user");
    });

    it("before any normalisation: also before string cleaning, which can shorten a value", () => {
      // 201 characters as written; removing the U+0000 (repair 5) would leave 200.
      expect(brief(refused(withProvider(`${"p".repeat(200)}${NUL}`)))).toEqual([
        "limit /sessions/0/provider",
      ]);
      expect(brief(refused(withRole(`${NUL}${"r".repeat(200)}`)))).toEqual([
        "limit /sessions/0/messages/0/role",
      ]);
      // 200 as written, 199 after cleaning: accepted.
      expect(firstSession(withProvider(`${"p".repeat(199)}${NUL}`)).provider).toBe("p".repeat(199));
    });

    it("megabytes are refused at once, whatever they hold", () => {
      for (const value of [" ".repeat(4_000_000), "x".repeat(4_000_000), `${" ".repeat(4_000_000)}claude`]) {
        let problems: readonly Problem[] = [];
        expect(elapsed(() => (problems = refused(withProvider(value))))).toBeLessThan(5000);
        expect(brief(problems)).toEqual(["limit /sessions/0/provider"]);
        expect(brief(refused(withRole(value)))).toEqual(["limit /sessions/0/messages/0/role"]);
      }
    });

    it("a writer's value is refused too: strict validation names the same limit", () => {
      const document = example();
      document.sessions[0].provider = "p".repeat(201);
      document.sessions[1].messages[0].role = "r".repeat(201);
      expect(brief(validateDocument(document).problems.items)).toEqual([
        "limit /sessions/0/provider",
        "limit /sessions/1/messages/0/role",
      ]);
      document.sessions[0].provider = "p".repeat(200);
      document.sessions[1].messages[0].role = "r".repeat(200);
      expect(validateDocument(document).ok).toBe(true);
    });

    it("only these two: a title, a model or the kind of an attachment of 300 characters is none of the reader's business", () => {
      const long = "x".repeat(300);
      const document = example();
      document.sessions[0].title = long;
      document.sessions[0].model = long;
      document.sessions[1].attachments[0].kind = long;
      document.sessions[0].messages[0].model = long;
      // An unknown property that happens to be called provider or role is not limited either.
      document.sessions[0].role = long;
      document.sessions[0].messages[0].provider = long;
      expect(read(document).doc.sessions[0]?.title).toBe(long);
    });

    // corrections.md and data-model.md 7.10 say "200 characters" and name no unit. The core counts
    // code points, which is what char_length counts in PostgreSQL (reported as an open point).
    it("a character is a code point: 200 characters outside the Basic Multilingual Plane are 200", () => {
      const face = cp(0x1f600);
      expect(face.length).toBe(2);
      expect(isOpenValueTooLong(face.repeat(200))).toBe(false);
      expect(isOpenValueTooLong(face.repeat(201))).toBe(true);
      expect(isOpenValueTooLong(`${"a".repeat(199)}${face}`)).toBe(false);
      expect(isOpenValueTooLong(`${"a".repeat(200)}${face}`)).toBe(true);
      // A surrogate without its partner counts as one character.
      expect(isOpenValueTooLong(LONE_HIGH.repeat(200))).toBe(false);
      expect(isOpenValueTooLong(LONE_HIGH.repeat(201))).toBe(true);
      expect(isOpenValueTooLong("")).toBe(false);
      expect(firstSession(withProvider(face.repeat(200))).provider).toBe(face.repeat(200));
      expect(brief(refused(withProvider(face.repeat(201))))).toEqual(["limit /sessions/0/provider"]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Point 1
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 1: parseTags is idempotent, and repair 4 is parseTags(tags.join(','))", () => {
  /** What JavaScript's trim() removes, as the rule lists it. */
  const TRIM_SET = [
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
    0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
  ];

  /** 8.2 with the formula of the rule, written out as the rule prints it. */
  function byTheFormula(input: string): string[] {
    const out: string[] = [];
    for (const part of input.split(",")) {
      // biome-ignore format: the formula as corrections.md prints it, on one line
      const tag = part.trim().toLowerCase().replace(/^[#\s]+/, "").trim();
      if (tag !== "" && !out.includes(tag)) out.push(tag);
    }
    return out;
  }

  it("the set the rule lists is the set of trim() and of \\s", () => {
    for (let code = 0; code <= 0xffff; code++) {
      const listed = TRIM_SET.includes(code);
      const character = cp(code);
      if ((character.trim() === "") !== listed || /^\s$/.test(character) !== listed) {
        throw new Error(`U+${code.toString(16)}: listed ${listed}`);
      }
    }
    expect(TRIM_SET.length).toBe(25);
  });

  it("the leading run of '#' and white space is removed, whatever its mix", () => {
    expect(parseTags("#tag")).toEqual(["tag"]);
    expect(parseTags("##tag")).toEqual(["tag"]);
    expect(parseTags("# tag")).toEqual(["tag"]);
    expect(parseTags("# #tag")).toEqual(["tag"]);
    expect(parseTags(" #\t# ## \n#tag ")).toEqual(["tag"]);
    expect(parseTags("#")).toEqual([]);
    expect(parseTags("# # #")).toEqual([]);
    // Only the LEADING run: a "#" elsewhere stays, and so does white space inside a tag.
    expect(parseTags("c#, a#b, # c #d, two  words")).toEqual(["c#", "a#b", "c #d", "two  words"]);
    for (const code of TRIM_SET) {
      const space = cp(code);
      expect(parseTags(`${space}#${space}#${space}Tag${space}`), `U+${code.toString(16)}`).toEqual(["tag"]);
    }
    // What trim() does not remove is no part of the run: U+200B, U+0085, U+180E.
    for (const code of [0x200b, 0x85, 0x180e]) {
      expect(parseTags(`#${cp(code)}#tag`), `U+${code.toString(16)}`).toEqual([`${cp(code)}#tag`]);
    }
  });

  it("lower-case is toLowerCase(), also outside ASCII", () => {
    expect(parseTags(`${cp(0xc9)}T${cp(0xc9)}`)).toEqual([`${cp(0xe9)}t${cp(0xe9)}`]);
    expect(parseTags(`${cp(0x130)}STANBUL`)).toEqual([`i${cp(0x307)}stanbul`]);
    expect(parseTags(cp(0x39f, 0x394, 0x39f, 0x3a3))).toEqual([cp(0x3bf, 0x3b4, 0x3bf, 0x3c2)]);
  });

  it("is the formula of the rule on generated fields, and applying it to its own result changes nothing", () => {
    const unit = fc.constantFrom(
      "a",
      "B",
      "c",
      "#",
      "#",
      ",",
      ",",
      " ",
      " ",
      "\t",
      "\n",
      cp(0xa0),
      cp(0x3000),
      cp(0xfeff),
      cp(0x200b),
      cp(0xc9),
      cp(0x130),
      cp(0x3a3),
      cp(0x1f600),
    );
    const seen = { several: 0, run: 0, empty: 0 };
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 24 }), (input) => {
        const tags = parseTags(input);
        expect(tags).toEqual(byTheFormula(input));
        // Idempotent: the tag field shows tags.join(", "), and reading that back gives the tags.
        expect(parseTags(tags.join(","))).toEqual(tags);
        expect(parseTags(tags.join(", "))).toEqual(tags);
        for (const tag of tags) expect(parseTags(tag)).toEqual([tag]);
        if (tags.length > 1) seen.several += 1;
        if (tags.length === 0) seen.empty += 1;
        if (/#[\s#]+[^\s#,]/.test(input)) seen.run += 1;
      }),
      { numRuns: 5000, seed: 20261120 },
    );
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(100);
  });

  it("repair 4 is parseTags(tags.join(',')): it splits an element that holds a comma and drops repeats across elements", () => {
    const tags = ["Garden", " b ,c", "#x", "garden", "# #y", "", "B", "z,,Z , #z"];
    expect(normaliseTags(tags)).toEqual(parseTags(tags.join(",")));
    expect(normaliseTags(tags)).toEqual(["garden", "b", "c", "x", "y", "z"]);
    const result = read(documentOf([session({ tags })]));
    expect(result.doc.sessions[0]?.tags).toEqual(["garden", "b", "c", "x", "y", "z"]);
    expect(codes(result.repairs.items)).toEqual(["tags_normalised /sessions/0/tags"]);
    // What the reader stored needs no repair when it is read again, and neither does the tag field.
    const again = read(result.doc);
    expect(again.repairs.total).toBe(0);
    expect(again.doc).toEqual(result.doc);
    expect(parseTags((result.doc.sessions[0]?.tags ?? []).join(", "))).toEqual(result.doc.sessions[0]?.tags);
  });

  it("on generated tag lists the reader stores exactly parseTags(tags.join(','))", () => {
    const element = fc.constantFrom(
      "a",
      " A ",
      "#a",
      "# #b",
      "b,c",
      " , ",
      "",
      "#",
      "two words",
      "C#",
      `${cp(0xa0)}d`,
    );
    fc.assert(
      fc.property(fc.array(element, { maxLength: 6 }), (tags) => {
        const stored = read(documentOf([session({ tags })])).doc.sessions[0]?.tags;
        expect(stored).toEqual(parseTags(tags.join(",")));
        expect(stored).toEqual(byTheFormula(tags.join(",")));
      }),
      { numRuns: 500, seed: 20261120 },
    );
  });

  it("needs time in proportion to the field: a million blanks inside a tag, a leading run of a million", () => {
    const inner = `a${" ".repeat(1_000_000)}b`;
    const leading = `${"# ".repeat(500_000)}c`;
    const many = Array.from({ length: 200_000 }, (_, index) => `Tag${index}`).join(",");
    let tags: string[] = [];
    expect(elapsed(() => (tags = parseTags(`${inner},${leading},${" ".repeat(1_000_000)}`)))).toBeLessThan(
      5000,
    );
    expect(tags.length).toBe(2);
    expect(tags[0] === inner).toBe(true);
    expect(tags[1]).toBe("c");
    expect(elapsed(() => (tags = parseTags(many)))).toBeLessThan(5000);
    expect(tags.length).toBe(200_000);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 2
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 2: repair 8 stands; R3 is the writer's rule and counts the destination's projects", () => {
  const OTHER_PROJECT = "aaaaaaaa-0000-4000-8000-000000000007";
  const inProject = documentOf([session({ project_id: OTHER_PROJECT })]);

  it("R3 is the writer's rule: strict validation refuses a project_id the file does not list", () => {
    expect(brief(validateDocument(inProject).problems.items)).toEqual(["R3 /sessions/0/project_id"]);
    const listed = documentOf(
      [session({ project_id: PROJECT_1 })],
      [{ id: PROJECT_1, name: "Garden", created_at: T1 }],
    );
    expect(validateDocument(listed).problems.items.filter((p) => p.rule === "R3")).toEqual([]);
  });

  it("repair 8 stands: resolving neither in the file nor in the destination vault, the project_id becomes null, with a warning", () => {
    for (const options of [undefined, {}, { destinationProjectIds: new Set([PROJECT_1]) }]) {
      const result = read(inProject, options);
      expect(result.doc.sessions[0]?.project_id).toBeNull();
      expect(codes(result.warnings.items)).toEqual(["project_missing /sessions/0/project_id"]);
    }
  });

  it("the reader checks R3 after repair 8 and counts the destination vault's projects as present", () => {
    const result = read(inProject, { destinationProjectIds: new Set([OTHER_PROJECT]) });
    expect(result.doc.sessions[0]?.project_id).toBe(OTHER_PROJECT);
    expect(result.warnings.total).toBe(0);
    expect(result.repairs.total).toBe(0);
    // Written in upper case, the id is lower-cased first (repair 1) and then found.
    const upper = documentOf([session({ project_id: OTHER_PROJECT.toUpperCase() })]);
    expect(read(upper, { destinationProjectIds: new Set([OTHER_PROJECT]) }).doc.sessions[0]?.project_id).toBe(
      OTHER_PROJECT,
    );
  });

  it("so a session whose project only the vault has is imported into that project", () => {
    const context = { now: new Date(0), newId: () => "unused" };
    const withProject = importDocument(
      emptyVault(),
      documentOf([], [{ id: OTHER_PROJECT, name: "Garden", created_at: T1 }]),
      context,
    );
    if (!withProject.ok) throw new Error("the project was not imported");
    const second = importDocument(withProject.vault, inProject, context);
    if (!second.ok) throw new Error("the session was not imported");
    expect(second.vault.sessions[0]?.project_id).toBe(OTHER_PROJECT);
    expect(second.report.warnings.total).toBe(0);
    // Into a vault without the project the same file loses the reference, with the warning.
    const alone = importDocument(emptyVault(), inProject, context);
    if (!alone.ok) throw new Error("the session was not imported");
    expect(alone.vault.sessions[0]?.project_id).toBeNull();
    expect(alone.report.warnings.counts).toEqual({ project_missing: 1 });
  });
});

// ---------------------------------------------------------------------------------------------
// Point 3
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 3: repair 5 (string cleaning) runs first, then the others in the order listed", () => {
  it("before repair 4: a tag with U+0000 between blanks is cleaned and then trimmed", () => {
    // In the listed order the tag would pass repair 4 as U+0000 + " a", lose the U+0000 in repair
    // 5 and then break R4 as " a".
    const result = read(documentOf([session({ tags: [` ${NUL} a`, `#${NUL}# b`] })]));
    expect(result.doc.sessions[0]?.tags).toEqual(["a", "b"]);
  });

  it("before repair 1: an id written in upper case with a U+0000 inside is cleaned and then lower-cased", () => {
    const id = `${SESSION_1.slice(0, 20).toUpperCase()}${NUL}${SESSION_1.slice(20).toUpperCase()}`;
    expect(id.length).toBe(37);
    expect(firstSession(documentOf([session({ id })])).id).toBe(SESSION_1);
    // The same for a hash (point 5).
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = sha256(bytes);
    const attachment = {
      kind: "file",
      sha256: `${hash.slice(0, 10).toUpperCase()}${NUL}${hash.slice(10)}`,
      media_type: "application/octet-stream",
      byte_length: 3,
    };
    expect(firstSession(documentOf([session({ attachments: [attachment] })])).attachments[0]?.sha256).toBe(
      hash,
    );
  });

  it("before repair 2: a provider and a role with U+0000 around a known name are cleaned and then normalised", () => {
    // Normalised first, U+0000 + " Claude " would be no known value and would be stored untrimmed.
    const found = firstSession(
      documentOf([
        session({ provider: `${NUL} Claude ${NUL}`, messages: [message(0, { role: `${NUL}USER\n` })] }),
      ]),
    );
    expect(found.provider).toBe("claude");
    expect(found.messages[0]?.role).toBe("user");
    // A value that is nothing but U+0000 is empty after cleaning: the fallback.
    expect(firstSession(documentOf([session({ provider: NUL.repeat(3) })])).provider).toBe("other");
  });

  it("inside repair 5, in its own order: U+0000 goes first, then CR LF and CR become LF", () => {
    // Line endings first would turn CR, U+0000, LF into two line feeds.
    const found = firstSession(
      documentOf([
        session({ messages: [message(0, { segments: [{ type: "text", text: `x\r${NUL}\ny` }] })] }),
      ]),
    );
    expect(found.messages[0]?.segments[0]?.text).toBe("x\ny");
  });

  it("before repair 7: each text segment gets its line feeds, and then the run is merged with an empty line", () => {
    // Merged first, "a" + CR and LF + "b" would meet as CR LF and give three line feeds, not four.
    const segments = [
      { type: "text", text: "a\r" },
      { type: "text", text: "\nb" },
    ];
    const found = firstSession(documentOf([session({ messages: [message(0, { segments })] })]));
    expect(found.messages[0]?.segments).toEqual([{ type: "text", text: "a\n\n\n\nb" }]);
  });

  it("repair 1 before repair 8, repair 9 and the rules that compare ids: they see lower-case ids and hashes", () => {
    const bytes = new TextEncoder().encode("three bytes and more");
    const hash = sha256(bytes);
    const document = documentOf(
      [
        session({
          project_id: PROJECT_1.toUpperCase(),
          attachments: [
            {
              kind: "image",
              sha256: hash.toUpperCase(),
              media_type: "image/png",
              byte_length: bytes.length,
              data_base64: Buffer.from(bytes).toString("base64"),
            },
          ],
          messages: [message(0, { segments: [{ type: "attachment", sha256: hash.toUpperCase() }] })],
        }),
      ],
      [{ id: PROJECT_1, name: "Garden", created_at: T1 }],
    );
    const result = read(document);
    const found = result.doc.sessions[0];
    // Repair 8 found the project, repair 9 found the bytes right, R7 found the attachment listed.
    expect(found?.project_id).toBe(PROJECT_1);
    expect(found?.attachments[0]?.sha256).toBe(hash);
    expect(found?.attachments[0]).toHaveProperty("data_base64");
    expect(found?.messages[0]?.segments[0]).toEqual({ type: "attachment", sha256: hash });
    expect(result.warnings.total).toBe(0);
    expect([...result.inlineBytes.keys()]).toEqual([hash]);
  });

  it("repair 3 before repair 4 and before the defaults that follow from other values", () => {
    const found = firstSession(documentOf([session({ tags: null, updated_at: null, attachments: null })]));
    expect(found.tags).toEqual([]);
    expect(found.updated_at).toBe(T1);
    expect(found.attachments).toEqual([]);
  });

  it("the repairs that came of cleaning are reported before all others", () => {
    const result = read(
      documentOf([
        session({
          id: SESSION_1.toUpperCase(),
          provider: "Claude",
          title: `A${NUL}B`,
          tags: ["Garden"],
          messages: [message(1), message(0, { segments: [{ type: "text", text: `half ${LONE_HIGH}` }] })],
        }),
      ]),
    );
    expect(result.repairs.items.map((notice) => notice.code)).toEqual([
      "string_cleaned",
      "string_cleaned",
      "id_lowercased",
      "value_folded",
      "tags_normalised",
      "messages_renumbered",
    ]);
    expect(result.doc.sessions[0]?.title).toBe("AB");
    expect(result.doc.sessions[0]?.messages[0]?.segments[0]?.text).toBe(`half ${REPLACEMENT}`);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 4
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 4: repair 6 sorts and renumbers only when every index is a finite number", () => {
  const withIndexes = (indexes: readonly unknown[]): Loose =>
    documentOf([
      session({
        messages: indexes.map((index, n) => {
          const made = message(n);
          if (index === undefined) delete made.index;
          else made.index = index;
          return made;
        }),
      }),
    ]);
  /** The stored order as "index:n", n being the place the message had in the file. */
  const order = (indexes: readonly unknown[]): string[] =>
    firstSession(withIndexes(indexes)).messages.map((m) => `${m.index}:${Number(m.id.slice(-2))}`);

  it("every message has a finite number: sorted by index and renumbered from 0", () => {
    expect(order([3, 1, 2, 0])).toEqual(["0:3", "1:1", "2:2", "3:0"]);
    expect(order([10, 20, 30])).toEqual(["0:0", "1:1", "2:2"]);
    expect(order([0, 1, 2])).toEqual(["0:0", "1:1", "2:2"]);
    const result = read(withIndexes([2, 0, 1]));
    expect(codes(result.repairs.items)).toEqual(["messages_renumbered /sessions/0/messages"]);
    expect(read(withIndexes([0, 1, 2])).repairs.total).toBe(0);
  });

  it("ties by array position", () => {
    expect(order([1, 0, 1, 0])).toEqual(["0:1", "1:3", "2:0", "3:2"]);
    expect(order([7, 7, 7])).toEqual(["0:0", "1:1", "2:2"]);
    expect(order([0, 0])).toEqual(["0:0", "1:1"]);
  });

  it("a fraction or a negative number sorts and is mended", () => {
    expect(order([0.5, -2, 7, 0])).toEqual(["0:1", "1:3", "2:0", "3:2"]);
    expect(order([1.25, 1.125])).toEqual(["0:1", "1:0"]);
    expect(order([-1, -1e9, 1e300, -0.001])).toEqual(["0:1", "1:0", "2:3", "3:2"]);
    for (const m of firstSession(withIndexes([2.5, -3])).messages)
      expect(Number.isInteger(m.index)).toBe(true);
  });

  it("otherwise nothing in that session is renumbered and validation refuses the document", () => {
    for (const bad of [undefined, null, "1", "", true, [], {}]) {
      // The message at place 1 has no finite number as index; the others are 2, 0 and 1.
      const problems = brief(refused(withIndexes([2, bad, 0, 1])));
      const keyword = bad === undefined ? "required" : "type";
      // Nothing was renumbered: besides the bad index itself, every index that is not its place
      // breaks R6, exactly as written.
      expect(problems, JSON.stringify(bad)).toEqual([
        `schema:${keyword} /sessions/0/messages/1/index`,
        "R6 /sessions/0/messages/0/index",
        "R6 /sessions/0/messages/2/index",
        "R6 /sessions/0/messages/3/index",
      ]);
    }
    // The others stand where they belong: only the bad index is a problem.
    expect(brief(refused(withIndexes([0, "x", 2])))).toEqual(["schema:type /sessions/0/messages/1/index"]);
  });

  it("a number that is not finite is no finite number: 1e999 in the text of a file refuses it", () => {
    const text = JSON.stringify(withIndexes([1, 0])).replace('"index":1', '"index":1e999');
    expect(text).toContain("1e999");
    const result = readDocument(text);
    expect(result.ok).toBe(false);
    for (const index of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(readDocument(withIndexes([index, 0])).ok).toBe(false);
    }
  });

  it("the rule is per session: one session is mended, and the file is refused for the other all the same", () => {
    const mendable = session({ messages: [message(0, { index: 5 }), message(1, { index: 4 })] });
    const broken = session({
      id: "5e550000-0000-4000-8000-000000000002",
      messages: [message(2, { index: "0" }), message(3, { index: 0 })],
    });
    expect(brief(refused(documentOf([mendable, broken])))).toEqual([
      "schema:type /sessions/1/messages/0/index",
      "R6 /sessions/1/messages/1/index",
    ]);
    expect(firstSession(documentOf([mendable])).messages.map((m) => m.id)).toEqual([
      messageId(1),
      messageId(0),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 5
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 5: repair 1 also lower-cases sha256 values", () => {
  const bytes = new TextEncoder().encode("the bytes of an attachment");
  const hash = sha256(bytes);
  const mixed = hash
    .split("")
    .map((character, i) => (i % 2 === 0 ? character.toUpperCase() : character))
    .join("");
  const descriptor = (changes: Loose = {}): Loose => ({
    kind: "image",
    sha256: hash,
    media_type: "image/png",
    byte_length: bytes.length,
    ...changes,
  });

  it("in attachment descriptors", () => {
    expect(mixed).not.toBe(hash);
    for (const written of [hash.toUpperCase(), mixed]) {
      const result = read(documentOf([session({ attachments: [descriptor({ sha256: written })] })]));
      expect(result.doc.sessions[0]?.attachments[0]?.sha256).toBe(hash);
      expect(codes(result.repairs.items)).toEqual(["id_lowercased /sessions/0/attachments/0/sha256"]);
    }
    expect(read(documentOf([session({ attachments: [descriptor()] })])).repairs.total).toBe(0);
  });

  it("and in attachment segments, which then name the listed attachment whatever the case of either", () => {
    const cases: [string, string][] = [
      [hash, hash.toUpperCase()],
      [hash.toUpperCase(), hash],
      [mixed, hash.toUpperCase()],
    ];
    for (const [listed, named] of cases) {
      const found = firstSession(
        documentOf([
          session({
            attachments: [descriptor({ sha256: listed })],
            messages: [message(0, { segments: [{ type: "attachment", sha256: named }] })],
          }),
        ]),
      );
      expect(found.attachments[0]?.sha256).toBe(hash);
      expect(found.messages[0]?.segments[0]).toEqual({ type: "attachment", sha256: hash });
    }
  });

  it("before the rules that compare hashes: inline bytes are judged by the lower-case hash, and two spellings of one hash are one hash", () => {
    const inline = read(
      documentOf([
        session({
          attachments: [
            descriptor({ sha256: hash.toUpperCase(), data_base64: Buffer.from(bytes).toString("base64") }),
          ],
        }),
      ]),
    );
    expect(inline.warnings.total).toBe(0);
    expect(inline.inlineBytes.get(hash)).toEqual(new Uint8Array(bytes));
    // R5: (kind, sha256) is unique within a session.
    const twice = documentOf([
      session({ attachments: [descriptor(), descriptor({ sha256: hash.toUpperCase() })] }),
    ]);
    expect(brief(refused(twice))).toEqual(["R5 /sessions/0/attachments/1"]);
  });

  it("what is no hash in any case stays a problem, and a writer must write lower case", () => {
    for (const bad of [hash.slice(1), `${hash}0`, `${hash.slice(0, 63)}g`, "", ` ${hash.slice(1)}`]) {
      expect(
        brief(refused(documentOf([session({ attachments: [descriptor({ sha256: bad })] })]))),
        JSON.stringify(bad),
      ).toEqual(["schema:pattern /sessions/0/attachments/0/sha256"]);
    }
    const upper = documentOf([
      session({ model: "", attachments: [descriptor({ sha256: hash.toUpperCase() })] }),
    ]);
    expect(
      validateDocument(upper)
        .problems.items.filter((p) => p.path.endsWith("/sha256"))
        .map((p) => `${p.rule}:${p.keyword}`),
    ).toEqual(["schema:pattern"]);
  });

  it("entry names inside a ZIP bundle stay strict (6.4)", () => {
    expect(classifyBundleEntry(`blobs/${hash}`)).toEqual({ kind: "blob", sha256: hash });
    expect(classifyBundleEntry(`blobs/${hash.toUpperCase()}`)).toBeNull();
    expect(classifyBundleEntry(`blobs/${mixed}`)).toBeNull();
    expect(classifyBundleEntry(`sessions/${SESSION_1}.json`)).toEqual({ kind: "session", id: SESSION_1 });
    expect(classifyBundleEntry(`sessions/${SESSION_1.toUpperCase()}.json`)).toBeNull();
    // And the bytes of a bundle are looked up by the lower-case hash only.
    const withoutBytes = documentOf([session({ attachments: [descriptor({ sha256: hash.toUpperCase() })] })]);
    const context = { now: new Date(0), newId: () => "unused" };
    const strictKey = importDocument(emptyVault(), withoutBytes, context, {
      bundleBlobs: new Map([[hash.toUpperCase(), new Uint8Array(bytes)]]),
    });
    expect(strictKey.ok && strictKey.vault.blobs.size).toBe(0);
    const lowerKey = importDocument(emptyVault(), withoutBytes, context, {
      bundleBlobs: new Map([[hash, new Uint8Array(bytes)]]),
    });
    expect(lowerKey.ok && [...lowerKey.vault.blobs.keys()]).toEqual([hash]);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 6
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 6: null is read as absent for every optional property of version 1", () => {
  const bytes = new Uint8Array([9, 8, 7]);
  /** Every optional property version 1 defines, with the given value, or left out for undefined. */
  function documentWith(value: null | undefined): Loose {
    const optional = (name: string): Loose => (value === undefined ? {} : { [name]: value });
    return {
      format: "sessionvault-interchange",
      version: 1,
      kind: "vault",
      exported_at: "2026-06-01T00:00:00.000Z",
      ...optional("generator"),
      projects: [{ id: PROJECT_1, name: "Garden", created_at: T1, ...optional("updated_at") }],
      sessions: [
        {
          id: SESSION_1,
          title: "A session",
          provider: "claude",
          created_at: "2026-04-01T00:00:00.000Z",
          imported_at: T1,
          ...optional("model"),
          ...optional("source_url"),
          ...optional("summary"),
          ...optional("tags"),
          ...optional("is_pinned"),
          ...optional("updated_at"),
          ...optional("project_id"),
          attachments: [
            {
              kind: "file",
              sha256: sha256(bytes),
              media_type: "application/octet-stream",
              byte_length: 3,
              ...optional("filename"),
              ...optional("created_at"),
              ...optional("data_base64"),
            },
          ],
          messages: [
            {
              id: messageId(0),
              index: 0,
              role: "user",
              segments: [{ type: "text", text: "hello" }],
              ...optional("created_at"),
              ...optional("model"),
            },
          ],
        },
        // And a session whose attachments are null or absent as a whole.
        {
          id: "5e550000-0000-4000-8000-000000000002",
          title: "",
          provider: "other",
          created_at: T1,
          imported_at: T1,
          messages: [],
          ...optional("attachments"),
        },
      ],
    };
  }

  it("the result is the same as for the property left out, and it is the default of repair 3", () => {
    const absent = read(documentWith(undefined));
    const nulls = read(documentWith(null));
    expect(nulls.doc).toEqual(absent.doc);
    expect(nulls.doc).not.toHaveProperty("generator");
    expect(nulls.doc.projects[0]).toEqual({ id: PROJECT_1, name: "Garden", created_at: T1, updated_at: T1 });
    const first = nulls.doc.sessions[0];
    expect(first).toMatchObject({
      model: "",
      source_url: "",
      summary: "",
      tags: [],
      is_pinned: false,
      updated_at: T1,
      project_id: null,
    });
    // The attachment: filename "", created_at the session's imported_at, and no bytes.
    expect(first?.attachments).toEqual([
      {
        kind: "file",
        sha256: sha256(bytes),
        media_type: "application/octet-stream",
        byte_length: 3,
        filename: "",
        created_at: T1,
      },
    ]);
    // A message's created_at and model stay absent.
    expect(first?.messages[0]).toEqual({
      id: messageId(0),
      index: 0,
      role: "user",
      segments: [{ type: "text", text: "hello" }],
    });
    expect(nulls.doc.sessions[1]?.attachments).toEqual([]);
    expect(nulls.warnings.total).toBe(0);
    expect(absent.repairs.total).toBe(0);
  });

  it("every one of them is reported as read from null, project_id excepted: null is its value", () => {
    expect(codes(read(documentWith(null)).repairs.items).sort()).toEqual(
      [
        "null_default /generator",
        "null_default /projects/0/updated_at",
        "null_default /sessions/0/model",
        "null_default /sessions/0/source_url",
        "null_default /sessions/0/summary",
        "null_default /sessions/0/tags",
        "null_default /sessions/0/is_pinned",
        "null_default /sessions/0/updated_at",
        "null_default /sessions/0/attachments/0/filename",
        "null_default /sessions/0/attachments/0/created_at",
        "null_default /sessions/0/attachments/0/data_base64",
        "null_default /sessions/0/messages/0/created_at",
        "null_default /sessions/0/messages/0/model",
        "null_default /sessions/1/attachments",
      ].sort(),
    );
  });

  it("generator and its fields included", () => {
    const fields = documentOf([], [], { generator: { app: "some-app", app_version: null, platform: null } });
    expect(read(fields).doc.generator).toEqual({ app: "some-app" });
    expect(codes(read(fields).repairs.items)).toEqual([
      "null_default /generator/app_version",
      "null_default /generator/platform",
    ]);
    expect(read(documentOf([], [], { generator: null })).doc).not.toHaveProperty("generator");
    // "app" is required inside a generator: null is no value for it.
    expect(brief(refused(documentOf([], [], { generator: { app: null } })))).toEqual([
      "schema:type /generator/app",
    ]);
  });

  it("an unknown property with the value null is kept as written, at every level", () => {
    const document = documentOf(
      [
        session({
          x_session: null,
          attachments: [
            {
              kind: "file",
              sha256: sha256(bytes),
              media_type: "text/plain",
              byte_length: 3,
              x_attachment: null,
            },
          ],
          messages: [
            message(0, {
              x_message: null,
              segments: [
                { type: "text", text: "t", x_segment: null },
                { type: "x_tool_call", input: null, nested: { deep: [null, { x: null }] } },
              ],
            }),
          ],
        }),
      ],
      [{ id: PROJECT_1, name: "Garden", created_at: T1, x_project: null }],
      { x_file: null, generator: { app: "a", x_generator: null } },
    );
    const result = read(document);
    expect(result.repairs.total).toBe(0);
    expect(result.doc).toHaveProperty("x_file", null);
    expect(result.doc.generator).toEqual({ app: "a", x_generator: null });
    expect(result.doc.projects[0]).toHaveProperty("x_project", null);
    const found = result.doc.sessions[0];
    expect(found).toHaveProperty("x_session", null);
    expect(found?.attachments[0]).toHaveProperty("x_attachment", null);
    expect(found?.messages[0]).toHaveProperty("x_message", null);
    expect(found?.messages[0]?.segments).toEqual([
      { type: "text", text: "t", x_segment: null },
      { type: "x_tool_call", input: null, nested: { deep: [null, { x: null }] } },
    ]);
  });

  it("a required property is not optional: null there is a problem", () => {
    const required: [string, (d: ReturnType<typeof example>) => void][] = [
      ["/kind", (d) => (d.kind = null)],
      ["/exported_at", (d) => (d.exported_at = null)],
      ["/projects", (d) => (d.projects = null)],
      ["/sessions", (d) => (d.sessions = null)],
      ["/projects/0/id", (d) => (d.projects[0].id = null)],
      ["/projects/0/name", (d) => (d.projects[0].name = null)],
      ["/projects/0/created_at", (d) => (d.projects[0].created_at = null)],
      ["/sessions/0/id", (d) => (d.sessions[0].id = null)],
      ["/sessions/0/title", (d) => (d.sessions[0].title = null)],
      ["/sessions/0/provider", (d) => (d.sessions[0].provider = null)],
      ["/sessions/0/created_at", (d) => (d.sessions[0].created_at = null)],
      ["/sessions/0/imported_at", (d) => (d.sessions[0].imported_at = null)],
      ["/sessions/0/messages", (d) => (d.sessions[0].messages = null)],
      ["/sessions/1/attachments/0/kind", (d) => (d.sessions[1].attachments[0].kind = null)],
      ["/sessions/1/attachments/0/sha256", (d) => (d.sessions[1].attachments[0].sha256 = null)],
      ["/sessions/1/attachments/0/media_type", (d) => (d.sessions[1].attachments[0].media_type = null)],
      ["/sessions/1/attachments/0/byte_length", (d) => (d.sessions[1].attachments[0].byte_length = null)],
      ["/sessions/0/messages/0/id", (d) => (d.sessions[0].messages[0].id = null)],
      ["/sessions/0/messages/0/index", (d) => (d.sessions[0].messages[0].index = null)],
      ["/sessions/0/messages/0/role", (d) => (d.sessions[0].messages[0].role = null)],
      ["/sessions/0/messages/0/segments", (d) => (d.sessions[0].messages[0].segments = null)],
      ["/sessions/0/messages/0/segments/0/type", (d) => (d.sessions[0].messages[0].segments[0].type = null)],
      ["/sessions/0/messages/0/segments/0/text", (d) => (d.sessions[0].messages[0].segments[0].text = null)],
    ];
    for (const [path, change] of required) {
      const document = example();
      change(document);
      expect(
        refused(document).map((p) => p.path),
        path,
      ).toContain(path);
    }
  });

  it("a writer writes no null: strict validation names each one", () => {
    const strict = validateDocument(documentWith(null));
    expect(strict.ok).toBe(false);
    // project_id may be null in a file; every other null is a breach of the schema's type.
    expect(strict.problems.items.map((p) => p.path)).not.toContain("/sessions/0/project_id");
    expect(strict.problems.items.every((p) => p.rule === "schema" && p.keyword === "type")).toBe(true);
    expect(strict.problems.total).toBe(14);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 7
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 7: repair 9 and base64", () => {
  const ABC = new TextEncoder().encode("ABC");
  const descriptorOf = (bytes: Uint8Array, data: unknown, changes: Loose = {}): Loose => ({
    kind: "file",
    sha256: sha256(bytes),
    media_type: "application/octet-stream",
    byte_length: bytes.length,
    filename: "kept.bin",
    x_note: "kept too",
    data_base64: data,
    ...changes,
  });
  const readWith = (attachment: Loose) => read(documentOf([session({ attachments: [attachment] })]));

  /** The data is removed with a warning and the descriptor stays. */
  function expectRemoved(attachment: Loose, label: string): void {
    const result = readWith(attachment);
    expect(codes(result.warnings.items), label).toEqual([
      "bytes_discarded /sessions/0/attachments/0/data_base64",
    ]);
    const kept = result.doc.sessions[0]?.attachments[0];
    expect(kept, label).not.toHaveProperty("data_base64");
    expect(kept, label).toMatchObject({ kind: "file", filename: "kept.bin", x_note: "kept too" });
    expect(result.inlineBytes.size, label).toBe(0);
  }

  it("data_base64 that is not a string is removed with a warning; the descriptor stays", () => {
    for (const data of [0, 42, true, false, [], ["QUJD"], {}, { base64: "QUJD" }]) {
      expectRemoved(descriptorOf(ABC, data), JSON.stringify(data));
    }
  });

  it("data_base64 that cannot be decoded is removed with a warning; the descriptor stays", () => {
    for (const data of [
      "Q", // the length without "=" is 1 modulo 4
      "QUJDQ",
      "QUJDQ==",
      "QUJD===", // more than two "="
      "QU=JD", // "=" that does not end the text
      "QU JD", // white space
      "QUJD\n",
      "\tQUJD",
      "QUJ-", // the URL-safe alphabet
      "QUJ_",
      "QUJD!",
      `QUJ${cp(0xe9)}`,
    ]) {
      expectRemoved(descriptorOf(ABC, data), JSON.stringify(data));
    }
  });

  it("data_base64 that does not match byte_length or sha256 is removed with a warning; the descriptor stays", () => {
    expectRemoved(descriptorOf(ABC, "QUJDRA=="), "one byte more");
    expectRemoved(descriptorOf(ABC, "QUI="), "one byte less");
    expectRemoved(descriptorOf(ABC, ""), "no bytes for three");
    expectRemoved(descriptorOf(ABC, "QUJE"), "other bytes of the same length");
    expectRemoved(descriptorOf(ABC, "QUJD", { byte_length: 4 }), "a byte_length that is not the length");
    expectRemoved(descriptorOf(ABC, "QUJD", { sha256: "0".repeat(64) }), "a sha256 that is not the hash");
  });

  it("readers accept padding as optional: with it, without it, and whatever the count of '=' up to two", () => {
    const cases: [string, string[]][] = [
      ["A", ["QQ==", "QQ", "QQ="]],
      ["AB", ["QUI=", "QUI", "QUI=="]],
      ["ABC", ["QUJD", "QUJD=", "QUJD=="]],
      ["ABCD", ["QUJDRA==", "QUJDRA", "QUJDRA="]],
      ["", ["", "=", "=="]],
    ];
    for (const [plain, spellings] of cases) {
      const bytes = new TextEncoder().encode(plain);
      for (const data of spellings) {
        const result = readWith(descriptorOf(bytes, data));
        expect(result.warnings.total, data).toBe(0);
        expect(result.doc.sessions[0]?.attachments[0]?.data_base64, data).toBe(data);
        expect(result.inlineBytes.get(sha256(bytes)), data).toEqual(new Uint8Array(bytes));
      }
    }
  });

  it("length and hash judge the bytes: bits a last character has to spare are not looked at", () => {
    // "QQ" and "QR" both decode to the one byte 0x41; "QR" has a bit set where none is used.
    expect(decodeBase64("QR")).toEqual(new Uint8Array([0x41]));
    const result = readWith(descriptorOf(new TextEncoder().encode("A"), "QR=="));
    expect(result.warnings.total).toBe(0);
    expect(result.inlineBytes.size).toBe(1);
  });

  it("the decoder admits exactly what the rule admits", () => {
    // "only the characters A-Z a-z 0-9 + /, then at most two =; without the = the length is not 1
    // modulo 4; no white space; no URL-safe alphabet"
    const admitted = (text: string): boolean => {
      const match = /^([A-Za-z0-9+/]*)(={0,2})$/.exec(text);
      return match !== null && (match[1] ?? "").length % 4 !== 1;
    };
    const unit = fc.constantFrom(..."AQz09+/", "=", "=", "-", "_", " ", "\n");
    let accepted = 0;
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 10 }), (text) => {
        const bytes = decodeBase64(text);
        expect(bytes !== null, JSON.stringify(text)).toBe(admitted(text));
        if (bytes === null) return;
        accepted += 1;
        // What was decoded is what the platform decodes from the padded form.
        const body = text.replace(/=/g, "");
        expect([...bytes]).toEqual([...Buffer.from(body, "base64")]);
      }),
      { numRuns: 6000, seed: 20261120 },
    );
    expect(accepted).toBeGreaterThan(300);
  });

  it("writers emit standard base64 with padding", () => {
    for (let length = 0; length <= 7; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => 250 - i);
      const text = encodeBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString("base64"));
      expect(text.length % 4).toBe(0);
      expect(/^[A-Za-z0-9+/]*={0,2}$/.test(text)).toBe(true);
    }
    // The exporter writes that form, whatever spelling came in.
    const bytes = new TextEncoder().encode("A");
    const context = { now: new Date(0), newId: () => "unused" };
    const imported = importDocument(
      emptyVault(),
      documentOf([session({ attachments: [descriptorOf(bytes, "QQ")] })]),
      context,
    );
    if (!imported.ok) throw new Error("not imported");
    const exported = exportDocument(
      imported.vault,
      { kind: "vault" },
      { now: new Date(0), generator: webGenerator("0") },
      { includeBytes: true },
    );
    expect(exported.ok && exported.doc.sessions[0]?.attachments[0]?.data_base64).toBe("QQ==");
  });

  it("a writer's data must be right: strict validation refuses what a reader removes", () => {
    const strictOf = (attachment: Loose): string[] =>
      brief(
        validateDocument(documentOf([session({ model: "", attachments: [attachment] })])).problems.items,
      ).filter((line) => line.endsWith("/data_base64"));
    expect(strictOf(descriptorOf(ABC, 42))).toEqual(["schema:type /sessions/0/attachments/0/data_base64"]);
    expect(strictOf(descriptorOf(ABC, "QU JD"))).toEqual([
      "schema:pattern /sessions/0/attachments/0/data_base64",
    ]);
    expect(strictOf(descriptorOf(ABC, "QUJE"))).toEqual(["R5 /sessions/0/attachments/0/data_base64"]);
    expect(strictOf(descriptorOf(ABC, "QUJD"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Point 8
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 8: timestamps", () => {
  it("digits beyond the millisecond are cut, never rounded", () => {
    const cases: [string, string][] = [
      ["2026-03-15T18:05:40.9999Z", "2026-03-15T18:05:40.999Z"],
      ["2026-03-15T18:05:40.999999999Z", "2026-03-15T18:05:40.999Z"],
      ["2026-03-15T18:05:40.0005Z", "2026-03-15T18:05:40.000Z"],
      ["2026-03-15T18:05:40.1239Z", "2026-03-15T18:05:40.123Z"],
      // Rounding would reach the next second, minute, hour, day, month and year.
      ["2026-12-31T23:59:59.9995Z", "2026-12-31T23:59:59.999Z"],
      ["9999-12-31T23:59:59.999999999Z", "9999-12-31T23:59:59.999Z"],
    ];
    for (const [written, stored] of cases) {
      const reading = parseTimestamp(written);
      expect(reading, written).toMatchObject({ ok: true, canonical: stored, lossy: true });
      if (reading.ok) expect(new Date(reading.ms).toISOString(), written).toBe(stored);
      expect(firstSession(documentOf([session({ updated_at: written })])).updated_at, written).toBe(stored);
    }
  });

  it("and cut before the value reaches a store: the instant an import stores is the cut one", () => {
    const imported = importDocument(
      emptyVault(),
      documentOf([
        session({ created_at: "2026-03-15T18:05:40.9996Z", updated_at: "2026-12-31T23:59:59.9999999Z" }),
      ]),
      { now: new Date(0), newId: () => "unused" },
    );
    if (!imported.ok) throw new Error("not imported");
    expect(imported.vault.sessions[0]?.created_at.getTime()).toBe(Date.UTC(2026, 2, 15, 18, 5, 40, 999));
    expect(imported.vault.sessions[0]?.updated_at.getTime()).toBe(Date.UTC(2026, 11, 31, 23, 59, 59, 999));
  });

  it("one repair line per document, with a count", () => {
    const document = example();
    document.exported_at = "2026-11-19T12:00:00.0001Z";
    document.projects[0].created_at = "2026-07-20T08:15:00.123456Z";
    document.sessions[0].created_at = "2026-03-14T09:30:00.0009Z";
    document.sessions[1].attachments[0].created_at = "2026-08-02T16:45:03.2501Z";
    document.sessions[2].messages[3].created_at = "2026-10-10T08:00:07.999999999Z";
    const result = read(document);
    expect(result.repairs.items).toEqual([
      { code: "timestamp_precision", path: "", message: "Cut 5 timestamps to milliseconds.", count: 5 },
    ]);
    expect(result.repairs.counts).toEqual({ timestamp_precision: 1 });
    expect(result.repairs.total).toBe(1);
    // One timestamp: one line as well, count 1.
    const one = read(documentOf([session({ imported_at: "2026-05-01T10:00:00.0001Z" })]));
    expect(one.repairs.items).toEqual([
      { code: "timestamp_precision", path: "", message: "Cut 1 timestamp to milliseconds.", count: 1 },
    ]);
  });

  it("the line counts timestamps that lost something: three digits or fewer, and zeros beyond, lose nothing", () => {
    const result = read(
      documentOf([
        session({
          created_at: "2026-05-01T10:00:00Z",
          imported_at: "2026-05-01T10:00:00.5Z",
          updated_at: "2026-05-01T10:00:00.120000000Z",
        }),
      ]),
    );
    expect(result.repairs.total).toBe(0);
    expect(result.doc.sessions[0]).toMatchObject({
      created_at: "2026-05-01T10:00:00.000Z",
      imported_at: "2026-05-01T10:00:00.500Z",
      updated_at: "2026-05-01T10:00:00.120Z",
    });
  });

  it("the line is there however many other repairs come before the list is cut", () => {
    const sessions = Array.from({ length: 40 }, (_, n) =>
      session({
        id: `5E550000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        created_at: "2026-05-01T10:00:00.1234Z",
        messages: [],
      }),
    );
    const result = read(documentOf(sessions), { limits: { maxListed: 10 } });
    expect(result.repairs.items.length).toBe(10);
    expect(result.repairs.items[0]).toMatchObject({ code: "timestamp_precision", count: 40 });
    expect(result.repairs.counts).toEqual({ timestamp_precision: 1, id_lowercased: 40 });
    expect(result.repairs.total).toBe(41);
  });

  it("hour 24 and second 60 are refused", () => {
    for (const bad of [
      "2026-01-01T24:00:00Z",
      "2026-01-01T24:00:00.000Z",
      "2026-12-31T23:59:60Z",
      "2026-06-30T23:59:60.5Z",
      "2026-01-01T12:60:00Z",
      "2026-01-01T25:00:00Z",
      "2026-01-01T00:00:61Z",
    ]) {
      expect(parseTimestamp(bad), bad).toEqual({ ok: false, reason: "calendar" });
      expect(brief(refused(documentOf([session({ created_at: bad })]))), bad).toEqual([
        "R1 /sessions/0/created_at",
      ]);
      expect(
        brief(validateDocument(documentOf([session({ created_at: bad })])).problems.items).filter((line) =>
          line.endsWith("/created_at"),
        ),
        bad,
      ).toEqual(["R1 /sessions/0/created_at"]);
    }
    // The last second of a day and the first of the next are instants.
    expect(parseTimestamp("2026-01-01T23:59:59.999Z").ok).toBe(true);
    expect(parseTimestamp("2026-01-02T00:00:00Z").ok).toBe(true);
  });

  it("the year is 0001 to 9999", () => {
    for (const bad of ["0000-01-01T00:00:00Z", "0000-06-15T12:00:00.000Z", "0000-12-31T23:59:59.999Z"]) {
      expect(parseTimestamp(bad), bad).toEqual({ ok: false, reason: "calendar" });
      expect(brief(refused(documentOf([session({ imported_at: bad })]))), bad).toEqual([
        "R1 /sessions/0/imported_at",
      ]);
    }
    const first = parseTimestamp("0001-01-01T00:00:00Z");
    expect(first).toMatchObject({ ok: true, canonical: "0001-01-01T00:00:00.000Z" });
    const last = parseTimestamp("9999-12-31T23:59:59.999Z");
    expect(last).toMatchObject({ ok: true, canonical: "9999-12-31T23:59:59.999Z" });
    // One millisecond between the year 0000 and the year 0001.
    if (first.ok) expect(new Date(first.ms - 1).toISOString()).toBe("0000-12-31T23:59:59.999Z");
    const found = firstSession(
      documentOf([session({ created_at: "0001-01-01T00:00:00Z", imported_at: "9999-12-31T23:59:59Z" })]),
    );
    expect(found.created_at).toBe("0001-01-01T00:00:00.000Z");
    expect(found.imported_at).toBe("9999-12-31T23:59:59.000Z");
    // A year of five digits, or of three, is no timestamp of the format at all.
    expect(parseTimestamp("10000-01-01T00:00:00Z")).toEqual({ ok: false, reason: "pattern" });
    expect(parseTimestamp("999-01-01T00:00:00Z")).toEqual({ ok: false, reason: "pattern" });
  });
});

// ---------------------------------------------------------------------------------------------
// Point 13
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2, point 13: a message's model of '' or null is read as absent", () => {
  const withModel = (model: unknown) => documentOf([session({ messages: [message(0, { model })] })]);

  it("'' and null are read as absent; a model is kept", () => {
    expect(firstSession(withModel("")).messages[0]).not.toHaveProperty("model");
    expect(firstSession(withModel(null)).messages[0]).not.toHaveProperty("model");
    expect(firstSession(withModel("claude-opus-5")).messages[0]).toHaveProperty("model", "claude-opus-5");
    // The three read to the same message as one that never had the property.
    const absent = firstSession(documentOf([session({ messages: [message(0)] })]));
    expect(firstSession(withModel(""))).toEqual(absent);
    expect(firstSession(withModel(null))).toEqual(absent);
    // White space is a value: only '' and null are named.
    expect(firstSession(withModel(" ")).messages[0]).toHaveProperty("model", " ");
  });

  it("a session's model is another property: '' is its value and stays", () => {
    expect(firstSession(documentOf([session({ model: "" })])).model).toBe("");
    expect(firstSession(documentOf([session()])).model).toBe("");
  });

  it("a writer never writes an empty one: the export leaves the property out, and writes a set one", () => {
    const context = { now: new Date(0), newId: () => "unused" };
    const imported = importDocument(
      emptyVault(),
      documentOf([
        session({
          messages: [
            message(0, { model: "" }),
            message(1, { model: null }),
            message(2, { model: "claude-opus-5" }),
            message(3),
          ],
        }),
      ]),
      context,
    );
    if (!imported.ok) throw new Error("not imported");
    // In the vault "not set" is the empty string, as in the table of 7.2.
    expect(imported.vault.sessions[0]?.messages.map((m) => m.model)).toEqual(["", "", "claude-opus-5", ""]);
    const exported = exportDocument(
      imported.vault,
      { kind: "vault" },
      { now: new Date(0), generator: webGenerator("0") },
      { includeBytes: false },
    );
    if (!exported.ok) throw new Error("not exported");
    const written = exported.doc.sessions[0]?.messages ?? [];
    expect(written.map((m) => Object.hasOwn(m, "model"))).toEqual([false, false, true, false]);
    expect(written[2]?.model).toBe("claude-opus-5");
    expect(JSON.stringify(exported.doc)).not.toContain('"model":""}');
    // The session's own model is written also when empty (6.8).
    expect(exported.doc.sessions[0]).toHaveProperty("model", "");
  });
});

// ---------------------------------------------------------------------------------------------
// Property names
// ---------------------------------------------------------------------------------------------

describe("corrections.md 2: a property NAME with U+0000 or a lone surrogate is dropped by the cleaning pass, with a warning", () => {
  const LONE_LOW = cp(0xdc00);
  const BAD_NAMES = [
    `x_${NUL}`,
    NUL,
    `x${NUL}y`,
    `x_${LONE_HIGH}`,
    `${LONE_LOW}x`,
    `a${LONE_LOW}${LONE_HIGH}b`,
  ];

  it("at every level of a file, with its value, whatever the value holds", () => {
    for (const name of BAD_NAMES) {
      const bag = (): Loose => ({ [name]: { deep: [`text ${NUL}`, { [name]: 1 }] }, x_kept: 1 });
      const document = documentOf(
        [
          session({
            ...bag(),
            x_nested: { inner: [bag()] },
            attachments: [
              { kind: "file", sha256: "0".repeat(64), media_type: "text/plain", byte_length: 0, ...bag() },
            ],
            messages: [
              message(0, {
                ...bag(),
                segments: [
                  { type: "text", text: "t", ...bag() },
                  { type: "x_tool", ...bag() },
                ],
              }),
            ],
          }),
        ],
        [{ id: PROJECT_1, name: "Garden", created_at: T1, ...bag() }],
        { ...bag(), generator: { app: "a", ...bag() } },
      );
      const result = read(document);
      const text = JSON.stringify(result.doc);
      // No such name is left, and nothing that was under one.
      expect(text.includes(JSON.stringify(name).slice(1, -1)), JSON.stringify(name)).toBe(false);
      expect(text).not.toContain("deep");
      // The properties beside them stay, at all nine places.
      expect(text.split('"x_kept":1').length - 1).toBe(9);
      expect(result.warnings.counts).toEqual({ property_dropped: 9 });
      // Nothing under a dropped name was cleaned: the property went as a whole.
      expect(result.repairs.total).toBe(0);
      // What is left is a document a writer may write.
      expect(validateDocument(result.doc).ok).toBe(true);
    }
  });

  it("the warning names the place by position, never by the name", () => {
    const result = read(documentOf([session({ x_a: 1, [`secret title ${NUL}`]: 2 })]));
    expect(result.warnings.items).toEqual([
      {
        code: "property_dropped",
        path: "/sessions/0/(property 8)",
        message: "Dropped a property whose name contains U+0000 or a lone surrogate.",
      },
    ]);
  });

  it("a name is not cleaned into another name: the property is not read as the one it resembles", () => {
    // "tit" + U+0000 + "le" is not the title; the session then has none and is refused.
    const untitled = session();
    delete untitled.title;
    untitled[`tit${NUL}le`] = "A session";
    expect(brief(refused(documentOf([untitled])))).toEqual(["schema:required /sessions/0/title"]);
    // Beside the real property it is simply dropped.
    const both = read(documentOf([session({ [`tit${NUL}le`]: "Another" })]));
    expect(both.doc.sessions[0]?.title).toBe("A session");
    expect(both.warnings.counts).toEqual({ property_dropped: 1 });
    // And an optional property spelled that way counts as absent.
    const model = read(documentOf([session({ [`mod${LONE_HIGH}el`]: "x" })]));
    expect(model.doc.sessions[0]?.model).toBe("");
  });

  it("a valid surrogate pair and other unusual names are names like any other", () => {
    const names = [
      cp(0x1f600),
      `x_${cp(0x1f600)}`,
      cp(0xfffd),
      cp(0xfeff),
      "",
      " ",
      "__proto__",
      "constructor",
    ];
    const extra: Loose = {};
    for (const name of names) Object.defineProperty(extra, name, { value: name.length, enumerable: true });
    const result = read(documentOf([session(extra)]));
    expect(result.warnings.total).toBe(0);
    for (const name of names)
      expect(Object.hasOwn(result.doc.sessions[0] ?? {}, name), JSON.stringify(name)).toBe(true);
  });

  it("the same file as text: an escaped U+0000 or lone surrogate in a name is the same name", () => {
    const text = JSON.stringify(documentOf([session()])).replace(
      '"title":"A session"',
      '"title":"A session","x_\\u0000":1,"x_\\ud83d":2,"x_ok":3',
    );
    expect(text).toContain("x_\\u0000");
    const result = read(text);
    expect(result.warnings.counts).toEqual({ property_dropped: 2 });
    expect(result.doc.sessions[0]).toHaveProperty("x_ok", 3);
  });

  it("a writer may not emit one: strict validation calls the name R9", () => {
    for (const name of BAD_NAMES) {
      const document = documentOf([session({ model: "", [name]: 1 })]);
      expect(
        validateDocument(document).problems.items.filter((p) => p.rule === "R9").length,
        JSON.stringify(name),
      ).toBe(1);
    }
  });

  it("what an import stores has no such name, so the export has none", () => {
    const imported = importDocument(
      emptyVault(),
      documentOf([session({ [`x_${NUL}`]: 1, x_kept: { [`y${LONE_HIGH}`]: 2, z: 3 } })]),
      { now: new Date(0), newId: () => "unused" },
    );
    if (!imported.ok) throw new Error("not imported");
    expect(imported.vault.sessions[0]?.extra).toEqual({ x_kept: { z: 3 } });
    expect(imported.report.warnings.counts).toEqual({ property_dropped: 2 });
  });
});

// ---------------------------------------------------------------------------------------------
// Composition of project names
// ---------------------------------------------------------------------------------------------

describe("the interchange folder composes with composedForm: the same values as normalize('NFC'), in bounded time", () => {
  const ACUTE = cp(0x301);
  const GRAVE_BELOW = cp(0x316);
  const CEDILLA = cp(0x327);

  it("projectNameKey returns what the function printed in data-model.md 8.4 returns", () => {
    const printed = (name: string): string => name.trim().normalize("NFC").toLowerCase();
    const samples = [
      "",
      "  Garden ",
      `Caf${cp(0xe9)}`,
      `CAFE${ACUTE}`,
      `a${ACUTE}${GRAVE_BELOW}`,
      `a${GRAVE_BELOW}${ACUTE}`,
      `${cp(0xc5)}ngstr${cp(0xf6)}m`,
      `A${cp(0x30a)}NGSTRO${cp(0x308)}M`,
      `q${(ACUTE + GRAVE_BELOW + CEDILLA).repeat(40)}`,
      `${cp(0x1100, 0x1161, 0x11a8)} ${cp(0xac01)}`,
      `${cp(0x3000)}Bike workshop${cp(0xa0)}`,
      cp(0x130),
    ];
    for (const name of samples) expect(projectNameKey(name), JSON.stringify(name)).toBe(printed(name));
    const unit = fc.constantFrom(
      "a",
      "E",
      "o",
      " ",
      ACUTE,
      GRAVE_BELOW,
      CEDILLA,
      cp(0x30a),
      cp(0x308),
      cp(0x345),
      cp(0xe9),
      cp(0x1f600),
    );
    const mark = fc.constantFrom(ACUTE, GRAVE_BELOW, CEDILLA, cp(0x30a), cp(0x308), cp(0x345), cp(0x334));
    // A name with one long run of marks in any order, where composedForm does its own ordering.
    const longRun = fc
      .tuple(
        fc.string({ unit, maxLength: 8 }),
        fc.array(mark, { minLength: 31, maxLength: 90 }),
        fc.string({ unit, maxLength: 8 }),
      )
      .map(([before, marks, after]) => `${before}E${marks.join("")}${after}`);
    let long = 0;
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit, maxLength: 120 }), longRun), (name) => {
        expect(projectNameKey(name)).toBe(printed(name));
        if (/\p{M}{31,}/u.test(name)) long += 1;
      }),
      { numRuns: 3000, seed: 20261120 },
    );
    expect(long).toBeGreaterThan(1000);
  });

  /** A file whose one project name is a letter and `marks` combining marks in the wrong order. */
  function hostileName(marks: number): { text: string; name: string } {
    const name = `a${ACUTE.repeat(marks / 2)}${GRAVE_BELOW.repeat(marks / 2)}`;
    const text = JSON.stringify(documentOf([], [{ id: PROJECT_1, name, created_at: T1, updated_at: T1 }]));
    return { text, name };
  }

  it("a 160 kB file with one such project name is read and imported in a fraction of the 3.3 s it took", () => {
    // Measured with normalize("NFC") on the whole name: 80,000 marks 3.2 s in readDocument and
    // 6.4 s in importDocument, four times as long for each doubling.
    const { text, name } = hostileName(80_000);
    // Every mark is two bytes in the UTF-8 of a file.
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(160_000);
    let result: ReturnType<typeof readDocument> | undefined;
    expect(elapsed(() => (result = readDocument(text)))).toBeLessThan(3000);
    expect(result?.ok).toBe(true);
    const context = { now: new Date(0), newId: () => "unused" };
    let imported: ReturnType<typeof importDocument> | undefined;
    expect(elapsed(() => (imported = importDocument(emptyVault(), text, context)))).toBeLessThan(3000);
    expect(imported?.ok && imported.vault.projects[0]?.name === name).toBe(true);
  });

  it("four times the marks do not take sixteen times as long: 640,000 marks, where the old way needs minutes", () => {
    // By the measured rule (3.2 s at 80,000 marks, times four per doubling) the old way needs
    // more than three minutes here.
    const { text } = hostileName(640_000);
    const context = { now: new Date(0), newId: () => "unused" };
    let first: ReturnType<typeof importDocument> | undefined;
    expect(elapsed(() => (first = importDocument(emptyVault(), text, context)))).toBeLessThan(20_000);
    if (first === undefined || !first.ok) throw new Error("not imported");
    // The merge compares the name again: against itself it is the same project, unchanged.
    let second: ReturnType<typeof importDocument> | undefined;
    const vault = first.vault;
    expect(elapsed(() => (second = importDocument(vault, text, context)))).toBeLessThan(20_000);
    expect(second?.ok && second.report.counts.projectsUnchanged).toBe(1);
  });

  it("names that differ only in the order of their marks are one project name (R11, 6.7 step 2b), also when long", () => {
    const marks = 20_000;
    const one = `Garden${ACUTE.repeat(marks)}${GRAVE_BELOW.repeat(marks)}`;
    const other = `GARDEN${GRAVE_BELOW.repeat(marks)}${ACUTE.repeat(marks)}`;
    expect(projectNameKey(one) === projectNameKey(other)).toBe(true);
    expect(projectNameKey(one) === one.normalize("NFC").toLowerCase()).toBe(true);
    const result = read(
      documentOf(
        [],
        [
          { id: PROJECT_1, name: one, created_at: T1 },
          { id: "aaaaaaaa-0000-4000-8000-000000000002", name: other, created_at: T1 },
        ],
      ),
    );
    expect(codes(result.warnings.items)).toEqual(["R11 /projects/1/name"]);
  });
});
