// The guards (docs/import-rules.md 2.6, W10), the link test (W11, capture.md 8.1) and the
// display splitter (W13, design.md 4.7.1), beyond the tables of fixtures 55, 56 and 57.

import { describe, expect, it } from "vitest";
import { splitDisplaySegments } from "./display.ts";
import { isChromeTurn, looksLikeSignInWall, stripChromeTurns, stripLeadingHeaderLines } from "./guards.ts";
import { looksLikeLink } from "./link.ts";

const chr = (...codes: number[]): string => String.fromCodePoint(...codes);
const NUL = chr(0);
const NBSP = chr(0xa0);
const ZWSP = chr(0x200b);
const NEL = chr(0x85);
const LS = chr(0x2028);
const PS = chr(0x2029);
const BOM = chr(0xfeff);
const BICYCLE = chr(0x1f6b2);

/** Three backticks, as in the golden tables of design.md 5.4. */
const F = "```";

describe("2.6 looksLikeSignInWall", () => {
  it("a page with one marker is never a wall, and a 6-character page is not one (D3)", () => {
    expect(looksLikeSignInWall(["Sign in"])).toBe(false);
    expect(looksLikeSignInWall(["Gemini"])).toBe(false);
    expect(looksLikeSignInWall([])).toBe(false);
    expect(looksLikeSignInWall([""])).toBe(false);
  });

  it("two markers under 1200 characters are a wall; matching is by substring and ignores case", () => {
    expect(looksLikeSignInWall(["Sign in", "Privacy Policy"])).toBe(true);
    expect(looksLikeSignInWall(["The design in the blog in question"])).toBe(true);
    expect(looksLikeSignInWall(["JUST A MOMENT... verify you are human"])).toBe(true);
  });

  it("nothing is a wall at 2500 characters or more, however many markers it has", () => {
    const markers = "sign in, log in, cookie, privacy policy, welcome back. ";
    expect(looksLikeSignInWall([markers + "x".repeat(2499 - markers.length)])).toBe(true);
    expect(looksLikeSignInWall([markers + "x".repeat(2500 - markers.length)])).toBe(false);
    expect(looksLikeSignInWall([markers.repeat(1000)])).toBe(false);
  });

  it("applies W1 to each string first, like everything that enters the importer", () => {
    expect(looksLikeSignInWall([`si${NUL}gn in`, `${BOM}cookie`])).toBe(true);
    // CR LF counts as one character, before and after W1 (W15).
    const head = "Sign in to accept the cookie.\r\n";
    expect(looksLikeSignInWall([head + "x".repeat(1199 - 30)])).toBe(true);
    expect(looksLikeSignInWall([head + "x".repeat(1200 - 30)])).toBe(false);
  });
});

describe("2.6 isChrome and stripLeadingHeaderLines", () => {
  it("chrome: under 700 characters with 'ai overview', 'can make mistakes', 'sign in', or two markers", () => {
    expect(isChromeTurn("AI Overview")).toBe(true);
    expect(isChromeTurn("This assistant can make mistakes.")).toBe(true);
    expect(isChromeTurn("The new design integrates a rack mount.")).toBe(true); // "deSIGN INtegrates" (D4)
    expect(isChromeTurn("cookie and privacy policy")).toBe(true);
    expect(isChromeTurn("We use a cookie here")).toBe(false);
    expect(isChromeTurn("Please log in")).toBe(false);
    expect(isChromeTurn("")).toBe(false);
    expect(isChromeTurn(`sign in ${"x".repeat(691)}`)).toBe(true); // 699 characters
    expect(isChromeTurn(`sign in ${"x".repeat(692)}`)).toBe(false); // 700 characters
  });

  it("the 700 is counted in user-perceived characters (W15)", () => {
    const bicycles = BICYCLE.repeat(691); // 1382 UTF-16 units
    expect(isChromeTurn(`sign in ${bicycles}`)).toBe(true);
    expect(isChromeTurn(`sign in ${bicycles}x`)).toBe(false);
  });

  it("removes leading header lines and full-trims the rest", () => {
    expect(stripLeadingHeaderLines("Sign in\n\n  Shared conversation \nReal text\nmore")).toBe(
      "Real text\nmore",
    );
    expect(stripLeadingHeaderLines("  Real text \n")).toBe("Real text");
    expect(stripLeadingHeaderLines("Real text\nSign in")).toBe("Real text\nSign in");
  });

  it("returns the text unchanged when every line is a header line or nothing is left", () => {
    expect(stripLeadingHeaderLines("Sign in\nLog in")).toBe("Sign in\nLog in");
    expect(stripLeadingHeaderLines(" \n \n")).toBe(" \n \n");
    expect(stripLeadingHeaderLines("")).toBe("");
    expect(stripLeadingHeaderLines("Sign in\n")).toBe("Sign in\n");
  });

  it("removes at most 12 lines, blank ones included, and no line of 90 characters or more", () => {
    const thirteen = Array.from({ length: 13 }, (_, index) => `Created with example ${index}`);
    expect(stripLeadingHeaderLines([...thirteen, "text"].join("\n"))).toBe("Created with example 12\ntext");
    expect(stripLeadingHeaderLines(`${"\n".repeat(12)}Created with x\ntext`)).toBe("Created with x\ntext");
    const line89 = `Created with ${"x".repeat(76)}`;
    const line90 = `Created with ${"x".repeat(77)}`;
    expect(stripLeadingHeaderLines(`${line89}\ntext`)).toBe("text");
    expect(stripLeadingHeaderLines(`${line90}\ntext`)).toBe(`${line90}\ntext`);
  });
});

describe("W10 stripChromeTurns, web form", () => {
  it("strips the header lines first and judges what is left (D4, fixture 42)", () => {
    expect(stripChromeTurns(["Sign in\nShared conversation\n\nUser: a real question?", "KEEP"])).toEqual({
      kept: ["User: a real question?", "KEEP"],
      dropped: [],
    });
  });

  it("never drops the first kept turn from the end, even if its raw text is chrome", () => {
    expect(stripChromeTurns(["Sign in\nA real question?"])).toEqual({
      kept: ["A real question?"],
      dropped: [],
    });
    expect(stripChromeTurns(["Sign in\nA real question?", "AI Overview"])).toEqual({
      kept: ["A real question?"],
      dropped: [{ position: "trailing", index: 1, text: "AI Overview" }],
    });
  });

  it("drops chrome from both ends, keeps it in the middle, and reports positions in the input", () => {
    expect(
      stripChromeTurns(["Sign in", "AI overview", "one", "sign in", "two", "can make mistakes", "sign in"]),
    ).toEqual({
      kept: ["one", "sign in", "two"],
      dropped: [
        { position: "leading", index: 0, text: "Sign in" },
        { position: "leading", index: 1, text: "AI overview" },
        { position: "trailing", index: 5, text: "can make mistakes" },
        { position: "trailing", index: 6, text: "sign in" },
      ],
    });
  });

  it("when every turn is chrome, all of them are reported as leading (fixture 50)", () => {
    expect(stripChromeTurns(["Sign in", "can make mistakes"])).toEqual({
      kept: [],
      dropped: [
        { position: "leading", index: 0, text: "Sign in" },
        { position: "leading", index: 1, text: "can make mistakes" },
      ],
    });
    expect(stripChromeTurns([])).toEqual({ kept: [], dropped: [] });
  });

  it("full-trims the first kept turn even when no line is removed, and touches no other turn", () => {
    expect(stripChromeTurns(["  first  \n", "  second  \n"])).toEqual({
      kept: ["first", "  second  \n"],
      dropped: [],
    });
  });

  it("applies W1 to each string first; the dropped texts are the normalised ones", () => {
    expect(stripChromeTurns([`${BOM}Sign${NUL} in\r\n`, "KEEP\r\n"])).toEqual({
      kept: ["KEEP"],
      dropped: [{ position: "leading", index: 0, text: "Sign in\n" }],
    });
  });
});

describe("W11 looksLikeLink (capture.md 8.1)", () => {
  it.each([
    ["claude.ai/share/EXAMPLE", "https://claude.ai/share/EXAMPLE"],
    ["https://example.invalid/a", "https://example.invalid/a"],
    ["https://claude.ai/share/EXAMPLE-0000-0000-0000\n", "https://claude.ai/share/EXAMPLE-0000-0000-0000"],
    ["http://example.invalid/a?b=c#d", "https://example.invalid/a?b=c#d"],
    ["HTTPS://Example.INVALID/Path", "https://example.invalid/Path"],
    ["  \t example.invalid \n", "https://example.invalid/"],
    ["sub.example.invalid:8443/x", "https://sub.example.invalid:8443/x"],
  ])("%j is the link %s", (text, link) => {
    expect(looksLikeLink(text)).toBe(link);
  });

  it.each([
    "Hello.",
    "Thanks.",
    "v1.2",
    "v1.2.3",
    "a.b",
    "3.14",
    "file:///tmp/x",
    "see https://example.invalid/x",
    "https://example.invalid/a b",
    "User: hi",
    "one-word",
    "localhost",
    "http://localhost:3000/x",
    "example.invalid.",
    "192.168.1.1",
    "https://3.14",
    "ftp://example.invalid/x",
    "javascript://example.invalid/%0Aalert(1)",
    "https://",
    "://example.invalid",
    "",
    "   ",
  ])("%j is not a link", (text) => {
    expect(looksLikeLink(text)).toBeNull();
  });

  it("known gap (HANDOFF.md section 5): a bare file name and an e-mail address still pass", () => {
    expect(looksLikeLink("notes.md")).toBe("https://notes.md/");
    expect(looksLikeLink("someone@example.invalid")).toBe("https://someone@example.invalid/");
  });

  it("two links separated by a line break are not one link (D12)", () => {
    expect(looksLikeLink("https://example.invalid/a\r\nhttps://example.invalid/b")).toBeNull();
    expect(looksLikeLink("https://example.invalid/a\nhttps://example.invalid/b")).toBeNull();
  });

  it("applies W1 and the full trim first", () => {
    expect(looksLikeLink(`${BOM}https://example.invalid/a`)).toBe("https://example.invalid/a");
    expect(looksLikeLink(`${ZWSP}${NEL}example.invalid/a${LS}${PS}`)).toBe("https://example.invalid/a");
    expect(looksLikeLink(`exa${NUL}mple.invalid/a`)).toBe("https://example.invalid/a");
  });

  it("under 500 characters, counted in user-perceived characters (W15)", () => {
    const base = "https://example.invalid/";
    expect(looksLikeLink(base + "a".repeat(499 - base.length))).not.toBeNull();
    expect(looksLikeLink(base + "a".repeat(500 - base.length))).toBeNull();
    // 499 characters, but 950 UTF-16 units.
    const bicycles = BICYCLE.repeat(499 - base.length);
    expect((base + bicycles).length).toBe(974);
    expect(looksLikeLink(base + bicycles)).not.toBeNull();
    expect(looksLikeLink(`${base}${bicycles}a`)).toBeNull();
  });
});

describe("W13 display segments", () => {
  const prose = (text: string) => ({ type: "prose", text });
  const code = (language: string | null, text: string) => ({ type: "code", language, code: text });

  // The golden cases of design.md 5.4 for the same splitter.
  it.each([
    [
      `Intro line\n${F}python\nprint(1)\n${F}\nOutro line`,
      [prose("Intro line"), code("python", "print(1)"), prose("Outro line")],
    ],
    [`Before\n${F}sh\nls -la\nstill code`, [prose("Before"), code("sh", "ls -la\nstill code")]],
    [
      `Before\r\n${F}python\r\nprint(1)\r\n${F}\r\nAfter`,
      [prose("Before"), code("python", "print(1)"), prose("After")],
    ],
    ["````\ncode\n````\nafter", [code(null, "code"), prose("after")]],
    [`${F}code${F}\nnext line`, [prose(`${F}code${F}\nnext line`)]],
    [`  ${F}js\n  let x = 1\n  ${F}\ntail`, [code("js", "  let x = 1"), prose("tail")]],
    [`${F}\n${F}`, [code(null, "")]],
    [`${F}md\n${F}python\nx = 1\n${F}\nrest`, [code("md", `${F}python\nx = 1`), prose("rest")]],
    ["~~~\ncode\n~~~", [prose("~~~\ncode\n~~~")]],
    [`${F} python title="a.py"\nx\n${F}`, [code('python title="a.py"', "x")]],
    [`${F}\`md\n${F}js\nx\n${F}\n${F}\`\nend`, [code("md", `${F}js\nx\n${F}`), prose("end")]],
    [`a\r${F}\rb\r${F}\rc`, [prose("a"), code(null, "b"), prose("c")]],
  ])("design.md golden case %j", (text, segments) => {
    expect(splitDisplaySegments(text)).toEqual(segments);
  });

  it("an opening line is 3 or more backticks followed by text that contains no backtick", () => {
    expect(splitDisplaySegments("``\ncode\n``")).toEqual([prose("``\ncode\n``")]);
    expect(splitDisplaySegments("`````\ncode\n`````")).toEqual([code(null, "code")]);
    expect(splitDisplaySegments(`${F}a\`b\ncode\n${F}`)).toEqual([prose(`${F}a\`b\ncode`), code(null, "")]);
    expect(splitDisplaySegments(`x ${F}\ncode\n${F}`)).toEqual([prose(`x ${F}\ncode`), code(null, "")]);
  });

  it("a closing line is only backticks, at least as many as the opening line has", () => {
    expect(splitDisplaySegments("````\na\n```\nb\n````\nc")).toEqual([code(null, "a\n```\nb"), prose("c")]);
    expect(splitDisplaySegments("```\na\n`````\nc")).toEqual([code(null, "a"), prose("c")]);
    expect(splitDisplaySegments("```\na\n``` \t\nc")).toEqual([code(null, "a"), prose("c")]);
    expect(splitDisplaySegments("```\na\n```x\nc")).toEqual([code(null, "a\n```x\nc")]);
  });

  it("the fence lines are tested after an inline trim (the Swift rule), which removes more than spaces and tabs", () => {
    // design.md 4.7.1 trims "spaces and tabs" only; import-rules.md W13 and the Swift source say inline trim.
    expect(splitDisplaySegments(`${NBSP}${F}sh${ZWSP}\nls\n${ZWSP}${F}${NBSP}`)).toEqual([code("sh", "ls")]);
  });

  it("prose is dropped when its full trim is empty, and is otherwise kept untrimmed", () => {
    // design.md 5.4 uses JavaScript trim() here; import-rules.md 2.9 and the Swift source say full trim.
    expect(splitDisplaySegments(`${ZWSP}\n${NEL}\n${F}\nx\n${F}`)).toEqual([code(null, "x")]);
    expect(splitDisplaySegments(`${BOM}x`)).toEqual([prose("x")]); // W1 removes one leading U+FEFF
    expect(splitDisplaySegments(`a\n${BOM}\n${F}\nx\n${F}`)).toEqual([prose(`a\n${BOM}`), code(null, "x")]);
    expect(splitDisplaySegments("\n\nText\n\n")).toEqual([prose("\n\nText\n\n")]);
  });

  it("U+2028 and U+2029 are ordinary characters of a line: lines are cut at LF only (2.3)", () => {
    // The reference port tests the opening line with a pattern whose "." stops at these two.
    expect(splitDisplaySegments(`${F}js${LS}x\ncode\n${F}`)).toEqual([code(`js${LS}x`, "code")]);
    expect(splitDisplaySegments(`${F}${PS}\ncode\n${F}`)).toEqual([code(PS, "code")]);
    expect(splitDisplaySegments(`a${LS}${F}\nb`)).toEqual([prose(`a${LS}${F}\nb`)]);
  });

  it("gives no segment for empty or blank text", () => {
    expect(splitDisplaySegments("")).toEqual([]);
    expect(splitDisplaySegments(" \n\t\n")).toEqual([]);
  });
});
