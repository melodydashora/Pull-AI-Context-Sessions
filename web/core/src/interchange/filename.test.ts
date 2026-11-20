// docs/corrections.md section 2, point 16: the one function that makes a file name of a title.
// One describe per clause of the rule; the expected values come from the words of the rule, and
// a second implementation written from those words is compared with the product on generated text.
//
// How two of the rule's phrases are read here (both are reported as doubts, not decided here):
// - "trailing dots and spaces": the trailing run of dots and white space, in any mixture. Read
//   narrowly (first white space, then only "." and U+0020) a name could end in U+00A0.
// - "put _ in front" comes after the cut, so a name of 120 bytes that starts with a device name
//   has 121 bytes afterwards.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { fileSystemSafe, type InterchangeDocument, suggestedFileName } from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

/** Characters by code point: the sources of this folder are plain ASCII. */
const cp = (...points: number[]): string => String.fromCodePoint(...points);
const E_ACUTE = cp(0xe9); // 2 bytes in UTF-8
const EURO = cp(0x20ac); // 3 bytes
const FACE = cp(0x1f600); // 4 bytes, two UTF-16 units
const NBSP = cp(0xa0);
const SUPERSCRIPTS = [cp(0xb9), cp(0xb2), cp(0xb3)]; // superscript 1, 2, 3

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;
const isWellFormed = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};

const FORBIDDEN = ["\\", "/", ":", "*", "?", '"', "<", ">", "|"];
/** The control characters of Unicode (general category Cc): U+0000 to U+001F and U+007F to U+009F. */
const CONTROLS: string[] = [];
for (let code = 0; code <= 0x1f; code++) CONTROLS.push(cp(code));
for (let code = 0x7f; code <= 0x9f; code++) CONTROLS.push(cp(code));

/** What JavaScript's trim() removes (corrections.md 2, point 1 lists the set). */
const WHITE_SPACE = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
].map((code) => cp(code));
/** White space that is no control character: what is still white space after the first clause. */
const SPACES = WHITE_SPACE.filter((ch) => !CONTROLS.includes(ch));

/** The device names as point 16 lists them. */
const DEVICE_NAMES: string[] = ["CON", "PRN", "AUX", "NUL"];
for (const stem of ["COM", "LPT"]) {
  for (let digit = 0; digit <= 9; digit++) DEVICE_NAMES.push(`${stem}${digit}`);
  for (const superscript of SUPERSCRIPTS) DEVICE_NAMES.push(`${stem}${superscript}`);
}

/** ASCII letters only: "any letter case" of names that are written in ASCII letters. */
const asciiUpper = (text: string): string =>
  text.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
const asciiLower = (text: string): string =>
  text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** Point 16, clause by clause, written from its words for short inputs. */
function byTheWords(title: string): string {
  const stripTrailing = (text: string): string => {
    let out = text;
    while (out !== "" && (out.endsWith(".") || out.trimEnd() !== out)) {
      out = out.endsWith(".") ? out.slice(0, -1) : out.trimEnd();
    }
    return out;
  };
  // "replace \ / : * ? " < > | and control characters by -" (a lone surrogate too: no name holds one)
  let name = "";
  for (const ch of title) {
    const lone = ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff;
    name += FORBIDDEN.includes(ch) || CONTROLS.includes(ch) || lone ? "-" : ch;
  }
  // "trim white space at both ends and trailing dots and spaces"
  name = stripTrailing(name.trim());
  // "cut to at most 120 UTF-8 bytes without splitting a code point"
  let cut = "";
  for (const ch of name) {
    if (utf8Length(cut + ch) > 120) break;
    cut += ch;
  }
  // "then trim trailing dots and spaces again"
  name = stripTrailing(cut);
  // "an empty result becomes session"
  if (name === "") name = "session";
  // "if the part before the first dot is a Windows device name in any letter case, put _ in front"
  const stem = name.split(".")[0] ?? "";
  return DEVICE_NAMES.includes(asciiUpper(stem)) ? `_${name}` : name;
}

describe("corrections.md 2, point 16: forbidden and control characters become -", () => {
  it('each of the nine characters \\ / : * ? " < > |', () => {
    expect(FORBIDDEN.length).toBe(9);
    for (const ch of FORBIDDEN) {
      expect(fileSystemSafe(`a${ch}b`), ch).toBe("a-b");
      expect(fileSystemSafe(ch), ch).toBe("-");
      expect(fileSystemSafe(`${ch}${ch}x${ch}`), ch).toBe("--x-");
    }
    expect(fileSystemSafe(`plan${FORBIDDEN.join("")}end`)).toBe("plan---------end");
  });

  it("each of the 65 control characters, also at the ends: they are replaced, not trimmed", () => {
    expect(CONTROLS.length).toBe(65);
    for (const ch of CONTROLS) {
      const code = ch.charCodeAt(0);
      expect(fileSystemSafe(`a${ch}b`), `U+${code.toString(16)}`).toBe("a-b");
      // Tab and line feed are white space to trim(), but the replacement comes first.
      expect(fileSystemSafe(`${ch}a${ch}`), `U+${code.toString(16)}`).toBe("-a-");
    }
  });

  it("nothing else is replaced", () => {
    const kept = [
      "plain words",
      "a-b_c(d)[e]{f}",
      "50% & more + less = same; yes! #1 @home ~ ^ ' ` $ ,",
      `caf${E_ACUTE} ${EURO}5 ${FACE}`,
      `inner${NBSP}space`,
      cp(0x65e5, 0x672c, 0x8a9e),
      cp(0xfffd),
      cp(0xa1), // the first character after the controls
      "x.y.z",
      ".hidden",
    ];
    for (const title of kept) expect(fileSystemSafe(title), title).toBe(title);
    // Every code unit that is neither named by the rule nor white space, a dot or a surrogate
    // comes back as written.
    for (let code = 0; code <= 0xffff; code++) {
      const ch = String.fromCharCode(code);
      const special =
        FORBIDDEN.includes(ch) ||
        CONTROLS.includes(ch) ||
        SPACES.includes(ch) ||
        ch === "." ||
        (code >= 0xd800 && code <= 0xdfff);
      if (special) continue;
      if (fileSystemSafe(`a${ch}b`) !== `a${ch}b`) throw new Error(`U+${code.toString(16)} was changed`);
    }
  });

  it("a surrogate without its partner becomes - as well; a pair is kept", () => {
    expect(fileSystemSafe(`lone ${cp(0xd83d)} high`)).toBe("lone - high");
    expect(fileSystemSafe(`lone ${cp(0xde00)} low`)).toBe("lone - low");
    expect(fileSystemSafe(`${cp(0xde00)}${cp(0xd83d)}`)).toBe("--");
    expect(fileSystemSafe(`pair ${FACE}`)).toBe(`pair ${FACE}`);
  });
});

describe("corrections.md 2, point 16: trimming", () => {
  it("white space goes at both ends; inside it stays", () => {
    expect(SPACES.length).toBe(20);
    for (const ch of SPACES) {
      const code = ch.charCodeAt(0).toString(16);
      expect(fileSystemSafe(`${ch}${ch}two${ch}words${ch}`), `U+${code}`).toBe(`two${ch}words`);
    }
    expect(fileSystemSafe(`${SPACES.join("")}name${SPACES.join("")}`)).toBe("name");
  });

  it("trailing dots and spaces go; leading and inner dots stay", () => {
    expect(fileSystemSafe("report.")).toBe("report");
    expect(fileSystemSafe("report...")).toBe("report");
    expect(fileSystemSafe("report. . .")).toBe("report");
    expect(fileSystemSafe("report .")).toBe("report");
    expect(fileSystemSafe("report. ")).toBe("report");
    expect(fileSystemSafe(`report.${NBSP}.`)).toBe("report");
    expect(fileSystemSafe(".profile")).toBe(".profile");
    expect(fileSystemSafe("...and so on")).toBe("...and so on");
    expect(fileSystemSafe("  .profile.  ")).toBe(".profile");
    expect(fileSystemSafe("v1.2.3")).toBe("v1.2.3");
    // A replaced character is no dot and no space: it ends the run.
    expect(fileSystemSafe("what?.")).toBe("what-");
    expect(fileSystemSafe("line\n. ")).toBe("line-");
  });
});

describe("corrections.md 2, point 16: at most 120 UTF-8 bytes, never a split code point", () => {
  it("one-byte characters: 120 stay, the 121st goes", () => {
    expect(fileSystemSafe("a".repeat(119))).toBe("a".repeat(119));
    expect(fileSystemSafe("a".repeat(120))).toBe("a".repeat(120));
    expect(fileSystemSafe("a".repeat(121))).toBe("a".repeat(120));
    expect(fileSystemSafe("a".repeat(100_000))).toBe("a".repeat(120));
  });

  it("two-, three- and four-byte characters are kept whole or not at all", () => {
    // 60 characters of two bytes are 120 bytes.
    expect(fileSystemSafe(E_ACUTE.repeat(60))).toBe(E_ACUTE.repeat(60));
    expect(fileSystemSafe(E_ACUTE.repeat(61))).toBe(E_ACUTE.repeat(60));
    // One byte, then two-byte characters: the 60th would end at byte 121.
    expect(fileSystemSafe(`a${E_ACUTE.repeat(60)}`)).toBe(`a${E_ACUTE.repeat(59)}`);
    expect(utf8Length(fileSystemSafe(`a${E_ACUTE.repeat(60)}`))).toBe(119);
    // 40 characters of three bytes.
    expect(fileSystemSafe(EURO.repeat(41))).toBe(EURO.repeat(40));
    expect(fileSystemSafe(`a${EURO.repeat(41)}`)).toBe(`a${EURO.repeat(39)}`);
    expect(fileSystemSafe(`ab${EURO.repeat(41)}`)).toBe(`ab${EURO.repeat(39)}`);
    // 30 characters of four bytes; each is two UTF-16 units, and no half of one is left.
    expect(fileSystemSafe(FACE.repeat(31))).toBe(FACE.repeat(30));
    for (const lead of ["a", "ab", "abc"]) {
      const safe = fileSystemSafe(`${lead}${FACE.repeat(31)}`);
      expect(safe).toBe(`${lead}${FACE.repeat(29)}`);
      expect(isWellFormed(safe)).toBe(true);
    }
  });

  it("the cut is counted after the replacement and after the leading trim", () => {
    // A control character of two bytes in UTF-8 (U+0085) becomes "-", one byte: 120 of them fit.
    expect(fileSystemSafe(cp(0x85).repeat(130))).toBe("-".repeat(120));
    // Leading white space does not use up the 120 bytes.
    expect(fileSystemSafe(`${" ".repeat(500)}${"a".repeat(121)}`)).toBe("a".repeat(120));
  });

  it("then trailing dots and spaces are trimmed again", () => {
    expect(fileSystemSafe(`${"a".repeat(119)}. tail`)).toBe("a".repeat(119));
    expect(fileSystemSafe(`${"a".repeat(119)} tail`)).toBe("a".repeat(119));
    expect(fileSystemSafe(`${"a".repeat(110)}. . . . . . tail`)).toBe("a".repeat(110));
    expect(fileSystemSafe(`${"a".repeat(118)}${NBSP}tail`)).toBe("a".repeat(118));
    // Nothing but dots up to the cut: the empty result of the next clause.
    expect(fileSystemSafe(`${".".repeat(120)}tail`)).toBe("session");
  });
});

describe("corrections.md 2, point 16: an empty result becomes session", () => {
  it("the empty text, white space, dots, and mixtures of the two", () => {
    for (const title of [
      "",
      " ",
      "   ",
      ".",
      "...",
      " . . ",
      ". .",
      `${NBSP}`,
      SPACES.join(""),
      `${SPACES.join(".")}.`,
    ]) {
      expect(fileSystemSafe(title), JSON.stringify(title)).toBe("session");
    }
  });

  it("replaced characters are not empty", () => {
    expect(fileSystemSafe("?")).toBe("-");
    expect(fileSystemSafe("???")).toBe("---");
    expect(fileSystemSafe("\t\n")).toBe("--");
    expect(fileSystemSafe(cp(0))).toBe("-");
  });
});

describe("corrections.md 2, point 16: Windows device names get _ in front", () => {
  it("the list: CON, PRN, AUX, NUL, COM0 to COM9, LPT0 to LPT9 and the superscript forms", () => {
    expect(DEVICE_NAMES.length).toBe(30);
    expect(DEVICE_NAMES).toContain("COM0");
    expect(DEVICE_NAMES).toContain("LPT0");
    expect(DEVICE_NAMES).toContain(`COM${cp(0xb9)}`);
    expect(DEVICE_NAMES).toContain(`LPT${cp(0xb3)}`);
    for (const name of DEVICE_NAMES) expect(fileSystemSafe(name), name).toBe(`_${name}`);
  });

  it("in any letter case", () => {
    for (const name of DEVICE_NAMES) {
      const lower = asciiLower(name);
      const mixed = `${name.slice(0, 1)}${asciiLower(name.slice(1, 2))}${name.slice(2)}`;
      const other = `${asciiLower(name.slice(0, 2))}${name.slice(2)}`;
      for (const spelling of [lower, mixed, other])
        expect(fileSystemSafe(spelling), spelling).toBe(`_${spelling}`);
    }
    expect(fileSystemSafe("cOn")).toBe("_cOn");
    expect(fileSystemSafe("nUL")).toBe("_nUL");
  });

  it("the part before the FIRST dot decides", () => {
    for (const name of DEVICE_NAMES) {
      expect(fileSystemSafe(`${name}.txt`), name).toBe(`_${name}.txt`);
      expect(fileSystemSafe(`${asciiLower(name)}.tar.gz`), name).toBe(`_${asciiLower(name)}.tar.gz`);
      // Not before the first dot: no device name.
      expect(fileSystemSafe(`notes.${name}`), name).toBe(`notes.${name}`);
      expect(fileSystemSafe(`.${name}`), name).toBe(`.${name}`);
    }
    // The earlier clauses run first: what they leave is what is tested.
    expect(fileSystemSafe("nul.")).toBe("_nul");
    expect(fileSystemSafe("  aux  ")).toBe("_aux");
    expect(fileSystemSafe("con...")).toBe("_con");
    expect(fileSystemSafe(`prn.${"a".repeat(300)}`)).toBe(`_prn.${"a".repeat(116)}`);
  });

  it("names that only look like one stay as they are", () => {
    const free = [
      "CONSOLE",
      "CO",
      "COM",
      "LPT",
      "COM10",
      "LPT00",
      "COMA",
      `COM${cp(0x2074)}`, // superscript four
      `COM${cp(0x660)}`, // an Arabic-Indic digit
      "XCON",
      "_CON",
      "CON-",
      "CON_",
      "NULL",
      "AUXILIARY",
      "PRNT",
      "CON txt",
      cp(0xff23, 0xff2f, 0xff2e), // full-width C O N
      `C${cp(0x41e)}N`, // a Cyrillic O
      "NU L",
    ];
    for (const title of free) expect(fileSystemSafe(title), title).toBe(title);
    // A forbidden character after the name is replaced first, so the stem is no device name.
    expect(fileSystemSafe("con:")).toBe("con-");
    expect(fileSystemSafe("aux?.txt")).toBe("aux-.txt");
  });

  it("the result with _ in front is no device name, and the function leaves it alone", () => {
    for (const name of DEVICE_NAMES) {
      const safe = fileSystemSafe(name);
      expect(fileSystemSafe(safe)).toBe(safe);
    }
  });
});

describe("corrections.md 2, point 16: one function, on any text", () => {
  const piece = fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom("a", "b", "Z", "0", "9", "-", "_", E_ACUTE, EURO, FACE) },
    { weight: 3, arbitrary: fc.constantFrom(".", " ", NBSP, cp(0x3000), cp(0xfeff), "\t", "\n") },
    {
      weight: 2,
      arbitrary: fc.constantFrom(...FORBIDDEN, cp(0), cp(0x7f), cp(0x85), cp(0xd83d), cp(0xdc00)),
    },
    { weight: 2, arbitrary: fc.constantFrom(...DEVICE_NAMES, "con", "nul", "lpt1", "com0") },
    {
      weight: 1,
      arbitrary: fc.constantFrom("a".repeat(57), EURO.repeat(19), FACE.repeat(14), ".".repeat(60)),
    },
  );
  const titles = fc.array(piece, { maxLength: 12 }).map((pieces) => pieces.join(""));

  it("equals the rule written out clause by clause, on generated titles", () => {
    const seen = { cut: 0, session: 0, device: 0, replaced: 0, plain: 0 };
    fc.assert(
      fc.property(titles, (title) => {
        const safe = fileSystemSafe(title);
        expect(safe).toBe(byTheWords(title));
        if (safe === "session" && title !== "session") seen.session += 1;
        else if (safe.startsWith("_") && !title.trimStart().startsWith("_")) seen.device += 1;
        else if (utf8Length(title.trim()) > 120) seen.cut += 1;
        else if (safe !== title) seen.replaced += 1;
        else seen.plain += 1;
      }),
      { numRuns: 6000, seed: 20261120 },
    );
    // The generator reached every clause.
    for (const [clause, count] of Object.entries(seen)) expect(count, clause).toBeGreaterThan(20);
  });

  it("what comes out is a file name: bounded, well formed, free of the forbidden, never empty, a fixed point", () => {
    fc.assert(
      fc.property(fc.oneof(titles, fc.string({ unit: "binary", maxLength: 200 })), (title) => {
        const safe = fileSystemSafe(title);
        expect(safe).not.toBe("");
        expect(isWellFormed(safe)).toBe(true);
        // 120 bytes, and one more for the _ in front of a device name.
        expect(utf8Length(safe)).toBeLessThanOrEqual(safe.startsWith("_") ? 121 : 120);
        for (const ch of safe) {
          expect(FORBIDDEN.includes(ch) || CONTROLS.includes(ch), JSON.stringify(ch)).toBe(false);
        }
        expect(safe.endsWith(".")).toBe(false);
        expect(safe.trim()).toBe(safe);
        expect(DEVICE_NAMES.includes(asciiUpper(safe.split(".")[0] ?? ""))).toBe(false);
        // Making a name of a name changes nothing, except for the one name of 121 bytes (the
        // next test shows it).
        if (utf8Length(safe) <= 120) expect(fileSystemSafe(safe)).toBe(safe);
      }),
      { numRuns: 6000, seed: 20261120 },
    );
  });

  it("the clauses in the order written: _ comes after the cut, so a device name of 120 bytes gives 121", () => {
    // Reported as a doubt: "at most 120 UTF-8 bytes" holds for every name but this kind, and for
    // this kind the function is not a fixed point (the second pass cuts the last byte).
    const title = `CON.${"a".repeat(300)}`;
    const safe = fileSystemSafe(title);
    expect(safe).toBe(`_CON.${"a".repeat(116)}`);
    expect(utf8Length(safe)).toBe(121);
    expect(fileSystemSafe(safe)).toBe(`_CON.${"a".repeat(115)}`);
    // One byte shorter and both hold.
    const shorter = fileSystemSafe(`CON.${"a".repeat(115)}`);
    expect(utf8Length(shorter)).toBe(120);
    expect(fileSystemSafe(shorter)).toBe(shorter);
  });

  it("the work does not grow with what lies behind the cut, and a long run of blanks or dots is no trap", () => {
    // Measured alone on 4 processors under a load average below 1: each of these calls took
    // under 15 ms. The limit is generous on purpose: a quadratic trim of two million characters
    // would take minutes, not seconds.
    const cases: [string, string][] = [
      [`${" ".repeat(2_000_000)}x`, "x"],
      [`x${" ".repeat(2_000_000)}y`, "x"],
      [`x${".".repeat(2_000_000)}y`, "x"],
      [`x${" .".repeat(1_000_000)}y`, "x"],
      [`${"a".repeat(2_000_000)}`, "a".repeat(120)],
      [`${FACE.repeat(1_000_000)}`, FACE.repeat(30)],
      [`${" ".repeat(2_000_000)}`, "session"],
    ];
    for (const [title, expected] of cases) {
      const started = performance.now();
      expect(fileSystemSafe(title)).toBe(expected);
      expect(performance.now() - started).toBeLessThan(5000);
    }
  });

  it("the suggested name of a session file is made with it", () => {
    const doc = (title: string): InterchangeDocument => ({
      format: "sessionvault-interchange",
      version: 1,
      kind: "session",
      exported_at: "2026-06-01T00:00:00.000Z",
      projects: [],
      sessions: [
        {
          id: "5e550000-0000-4000-8000-000000000001",
          title,
          provider: "claude",
          model: "",
          source_url: "",
          summary: "",
          tags: [],
          is_pinned: false,
          created_at: "2026-05-01T10:00:00.000Z",
          imported_at: "2026-05-01T10:00:00.000Z",
          updated_at: "2026-05-01T10:00:00.000Z",
          project_id: null,
          attachments: [],
          messages: [],
        },
      ],
    });
    expect(suggestedFileName(doc("Plan: a/b?"))).toBe("Plan- a-b-.session.json");
    expect(suggestedFileName(doc(" ... "))).toBe("session.session.json");
    expect(suggestedFileName(doc("aux"))).toBe("_aux.session.json");
    expect(utf8Length(suggestedFileName(doc(EURO.repeat(500))))).toBe(120 + ".session.json".length);
  });
});
