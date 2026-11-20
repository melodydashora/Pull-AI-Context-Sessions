// Search (docs/data-model.md 3.6, 8.1, B4): the verified examples of the table in 3.6, in the form
// the web keeps them (the query is trimmed), and the edges the examples do not reach.
import { describe, expect, it, vi } from "vitest";
import {
  buildSearchText,
  matchesSearch,
  normalizeForSearch,
  prepareQuery,
  type SearchableSession,
  searchSessions,
} from "./index.ts";

vi.setConfig({ testTimeout: 120_000 });

const cp = (...points: number[]): string => String.fromCodePoint(...points);

const E_ACUTE = cp(0xe9);
const COMBINING_ACUTE = cp(0x301);
const NO_BREAK_SPACE = cp(0xa0);

function session(title: string, summary = "", tags: readonly string[] = []): SearchableSession {
  return { title, summary, tags };
}

/** Whether the query, as typed, finds the session. */
function finds(query: string, target: SearchableSession): boolean {
  return matchesSearch(buildSearchText(target), prepareQuery(query));
}

const BICYCLE = session("Bicycle Repair", "Fix the spokes first.", ["garden", "two words"]);

describe("3.6: what is searched", () => {
  it("title, summary and each tag", () => {
    expect(finds("bicycle", BICYCLE)).toBe(true);
    expect(finds("spokes", BICYCLE)).toBe(true);
    expect(finds("garden", BICYCLE)).toBe(true);
    expect(finds("two words", BICYCLE)).toBe(true);
  });

  it("nothing else: a session is searched through these three fields only", () => {
    // Message text, model, link, provider and project are not part of what search is given.
    const stored = {
      ...BICYCLE,
      provider: "claude",
      model: "example-model-1",
      source_url: "https://share.example/EXAMPLE-0001",
      messages: [{ role: "user", text: "Which wrench fits?" }],
    };
    expect(finds("claude", stored)).toBe(false);
    expect(finds("example", stored)).toBe(false);
    expect(finds("wrench", stored)).toBe(false);
    expect(buildSearchText(stored)).toBe("bicycle repair\nfix the spokes first.\ngarden\ntwo words");
  });

  it("the search text is title, summary and tags in lower case, one per line", () => {
    expect(buildSearchText(session("A", "B", ["c", "d"]))).toBe("a\nb\nc\nd");
    expect(buildSearchText(session("A", "B"))).toBe("a\nb");
    expect(buildSearchText(session("", ""))).toBe("\n");
    expect(buildSearchText(session("", "", [""]))).toBe("\n\n");
  });
});

describe("3.6: how the query is compared", () => {
  it("case: BICYCLE finds 'Bicycle Repair'", () => {
    expect(finds("BICYCLE", BICYCLE)).toBe(true);
    expect(finds("bIcYcLe RePaIr", BICYCLE)).toBe(true);
  });

  it("no tokenising: 'cycle rep' finds it, 'repair bicycle' does not", () => {
    expect(finds("cycle rep", BICYCLE)).toBe(true);
    expect(finds("repair bicycle", BICYCLE)).toBe(false);
    // The inner space is part of the query: two spaces are not one.
    expect(finds("cycle  rep", BICYCLE)).toBe(false);
  });

  it("B4, the one change from the Apple app: the query is trimmed", () => {
    // In the Apple app ' bicycle' and 'repair ' find nothing.
    expect(finds(" bicycle", BICYCLE)).toBe(true);
    expect(finds("repair ", BICYCLE)).toBe(true);
    expect(finds(`\t${NO_BREAK_SPACE} bicycle \n`, BICYCLE)).toBe(true);
  });

  it("B4: a query of white space only means no search and finds every session", () => {
    const untitled = session("Untitled");
    for (const query of [
      "",
      " ",
      "   ",
      "\t",
      "\n",
      "\r\n",
      NO_BREAK_SPACE,
      cp(0x3000),
      cp(0x2028),
      cp(0xfeff),
    ]) {
      expect(prepareQuery(query)).toBe("");
      expect(finds(query, untitled)).toBe(true);
      expect(finds(query, session("", ""))).toBe(true);
    }
  });

  it("diacritics are significant: 'cafe' does not find the title with e acute", () => {
    expect(finds("cafe", session(`Caf${E_ACUTE}`))).toBe(false);
    expect(finds(`caf${E_ACUTE}`, session("Cafe"))).toBe(false);
  });

  it("composed and decomposed forms are equal, in both directions", () => {
    const composed = `Caf${E_ACUTE}`;
    const decomposed = `Cafe${COMBINING_ACUTE}`;
    expect(composed).not.toBe(decomposed);
    expect(finds(`caf${E_ACUTE}`, session(decomposed))).toBe(true);
    expect(finds(`cafe${COMBINING_ACUTE}`, session(composed))).toBe(true);
    expect(finds(`CAFE${COMBINING_ACUTE}`, session(composed))).toBe(true);
    expect(buildSearchText(session(decomposed))).toBe(buildSearchText(session(composed)));
  });

  it("no other folding: sharp s, full-width letters and the dotted capital I stay what they are", () => {
    expect(finds("strasse", session(`Stra${cp(0xdf)}e`))).toBe(false);
    expect(finds("bicycle", session(cp(0xff22, 0xff49, 0xff43, 0xff59, 0xff43, 0xff4c, 0xff45)))).toBe(false);
    expect(finds("istanbul", session(`${cp(0x130)}stanbul`))).toBe(false);
    // Each finds itself.
    expect(finds(`STRA${cp(0xdf)}E`, session(`Stra${cp(0xdf)}e`))).toBe(true);
    expect(finds(`${cp(0x130)}STANBUL`, session(`${cp(0x130)}stanbul`))).toBe(true);
  });

  it("letters outside ASCII are compared without regard to case too", () => {
    const title = `${cp(0xdc)}bung ${cp(0x3a9)}mega ${cp(0x416, 0x423, 0x41a)}`; // U-umlaut, Omega, Cyrillic
    expect(finds(`${cp(0xfc)}bung`, session(title))).toBe(true);
    expect(finds(`${cp(0x3c9)}MEGA`, session(title))).toBe(true);
    expect(finds(cp(0x436, 0x443, 0x43a), session(title))).toBe(true);
  });

  it("tags are searched as stored, without the '#' that rows display", () => {
    expect(finds("#garden", BICYCLE)).toBe(false);
    expect(finds("garden", BICYCLE)).toBe(true);
    // A tag stored with a '#' (the Apple app can hold one) is found with it.
    expect(finds("#hash", session("t", "", ["#hash"]))).toBe(true);
  });

  it("8.1, the two known differences from Swift: a mark without composed form, and the final sigma", () => {
    // x with acute has no composed form; the bare letter still finds it here.
    expect(finds("x", session(`x${COMBINING_ACUTE}yz`))).toBe(true);
    // Lower case of a word-final capital sigma is the final form in JavaScript.
    const word = cp(0x39f, 0x394, 0x39f, 0x3a3);
    expect(normalizeForSearch(word)).toBe(cp(0x3bf, 0x3b4, 0x3bf, 0x3c2));
    expect(finds(word, session(word))).toBe(true);
    expect(finds(cp(0x3c3), session(word))).toBe(false);
  });
});

describe("8.1: a match never spans two fields", () => {
  it("title and summary, summary and tag, tag and tag", () => {
    const target = session("garden", "tools", ["bike", "shed"]);
    expect(finds("garden tools", target)).toBe(false);
    expect(finds("gardentools", target)).toBe(false);
    expect(finds("tools bike", target)).toBe(false);
    expect(finds("bikeshed", target)).toBe(false);
    expect(finds("bike shed", target)).toBe(false);
  });

  it("a line break in the query becomes one space, so it cannot stand for the joint either", () => {
    const target = session("garden", "tools");
    expect(prepareQuery("garden\ntools")).toBe("garden tools");
    expect(prepareQuery("garden\r\ntools")).toBe("garden tools");
    expect(prepareQuery("garden\r\n\r\n\ntools")).toBe("garden tools");
    expect(prepareQuery("garden\rtools")).toBe("garden tools");
    expect(finds("garden\ntools", target)).toBe(false);
    // The same words on one line of a summary are found.
    expect(finds("garden\ntools", session("x", "My garden tools."))).toBe(true);
  });

  it("a summary of several lines is searched line by line", () => {
    const target = session("x", "first line\nsecond line");
    expect(finds("first line", target)).toBe(true);
    expect(finds("line second", target)).toBe(false);
    expect(finds("line\nsecond", target)).toBe(false);
  });

  it("other line separators in the query are kept and trimmed only at the ends", () => {
    expect(prepareQuery(`a${cp(0x2028)}b`)).toBe(`a${cp(0x2028)}b`);
    expect(prepareQuery(`${cp(0x2028)}a b${cp(0x2029)}`)).toBe("a b");
    expect(prepareQuery("a\tb")).toBe("a\tb");
  });
});

describe("characters that are special in regular expressions, in LIKE patterns and in replacements", () => {
  const TITLE = "C++ (draft) [v2.0] $100 ^start| end? a.b*c \\path {x} 50%_off $& $1";
  const target = session(TITLE);

  it.each([
    "c++",
    "(draft)",
    "[v2.0]",
    "$100",
    "^start|",
    "end?",
    "a.b*c",
    "\\path",
    "{x}",
    "50%_off",
    "$&",
    "$1",
    "+",
    "(",
    ")",
    "[",
    "]",
    "\\",
    "|",
    "?",
    "*",
    ".",
    "^",
    "$",
    "{",
    "}",
    "%",
    "_",
  ])("%j is found as the characters it is", (query) => {
    expect(finds(query, target)).toBe(true);
    expect(finds(query, session("plain words only"))).toBe(false);
  });

  it.each([
    ["a.b", "axb"],
    [".*", "anything"],
    ["a*", "aaa"],
    ["[abc]", "b"],
    ["a|b", "a"],
    ["^a", "a"],
    ["a$", "a"],
    ["\\d", "7"],
    ["a{2}", "aa"],
    ["(a)", "a"],
    ["a?", "a"],
    ["%", "anything"],
    ["_", "x"],
    ["a_c", "abc"],
    ["a%c", "abbbc"],
  ])("%j is no pattern: it does not find %j", (query, title) => {
    expect(finds(query, session(title))).toBe(false);
  });

  it("no query makes the search throw", () => {
    for (const query of [
      "(",
      "[",
      "\\",
      "*",
      "+",
      "?",
      "{",
      "(?<",
      "\\u",
      "[z-a]",
      "$`",
      cp(0xd800),
      cp(0),
    ]) {
      expect(() => finds(query, target)).not.toThrow();
    }
  });
});

describe("titles and tags with odd white space and characters outside ASCII", () => {
  it("white space inside a field is compared as it is: a no-break space is not a space", () => {
    const target = session(`Two${NO_BREAK_SPACE}Words`, "tab\there", [`thin${cp(0x2009)}space`]);
    expect(finds("two words", target)).toBe(false);
    expect(finds(`two${NO_BREAK_SPACE}words`, target)).toBe(true);
    expect(finds("tab here", target)).toBe(false);
    expect(finds("tab\there", target)).toBe(true);
    expect(finds(`thin${cp(0x2009)}space`, target)).toBe(true);
  });

  it("white space at the ends of a field stays in the search text; only the query is trimmed", () => {
    expect(buildSearchText(session("  Padded  ", " s "))).toBe("  padded  \n s ");
    expect(finds("padded", session("  Padded  "))).toBe(true);
    expect(finds("  padded  ", session("Padded"))).toBe(true);
  });

  it("emoji and other characters outside the Basic Multilingual Plane", () => {
    const grin = cp(0x1f600);
    const target = session(`Party ${grin} plan`, "", [`tag${grin}`]);
    expect(finds(grin, target)).toBe(true);
    expect(finds(`party ${grin}`, target)).toBe(true);
    expect(finds(cp(0x1f601), target)).toBe(false);
    // Deseret letters have case: the capital finds the small one.
    expect(finds(cp(0x10400), session(cp(0x10428)))).toBe(true);
  });

  it("a title with U+0000 or a lone surrogate is searched as it is", () => {
    expect(finds("a", session(`a${cp(0)}b`))).toBe(true);
    expect(finds("ab", session(`a${cp(0)}b`))).toBe(false);
    expect(finds("x", session(`${cp(0xd800)}x`))).toBe(true);
  });

  it("a query of combining marks alone finds text that carries them uncomposed", () => {
    expect(finds(COMBINING_ACUTE, session(`x${COMBINING_ACUTE}`))).toBe(true);
    // In the composed letter there is no separate mark to find.
    expect(finds(COMBINING_ACUTE, session(E_ACUTE))).toBe(false);
  });
});

describe("searchSessions", () => {
  const sessions = [
    session("Bicycle Repair"),
    session("Garden plan", "with a bicycle shed"),
    session("Untitled"),
    session("Bread", "", ["bicycle"]),
  ];

  it("returns the sessions that match, in the order given", () => {
    expect(searchSessions(sessions, "bicycle")).toEqual([sessions[0], sessions[1], sessions[3]]);
    expect(searchSessions(sessions, " BICYCLE ")).toEqual([sessions[0], sessions[1], sessions[3]]);
    expect(searchSessions(sessions, "nothing")).toEqual([]);
  });

  it("returns every session for an empty query, as a new array", () => {
    const all = searchSessions(sessions, "  ");
    expect(all).toEqual(sessions);
    expect(all).not.toBe(sessions);
    expect(searchSessions([], "x")).toEqual([]);
  });
});

describe("the work is bounded on input built to be slow", () => {
  const LIMIT_MS = 10_000;
  function elapsed(run: () => void): number {
    const started = performance.now();
    run();
    return performance.now() - started;
  }

  it("a long query that nearly occurs everywhere (the platform's own search took 31 s for this)", () => {
    const text = "a".repeat(2_000_000);
    const query = `${"a".repeat(50_000)}b${"a".repeat(50_000)}`;
    let found = true;
    expect(elapsed(() => (found = matchesSearch(text, query)))).toBeLessThan(LIMIT_MS);
    expect(found).toBe(false);
    // The same query is found when the text holds it, at the very end.
    expect(matchesSearch(`${text}${query}`, query)).toBe(true);
    expect(matchesSearch(`${text}b${"a".repeat(49_999)}`, query)).toBe(false);
  });

  it("queries just below and just above the length at which this folder searches itself", () => {
    const text = `${"ab".repeat(1000)}c${"ab".repeat(1000)}`;
    for (const length of [1, 2, 63, 64, 65, 66, 127, 128, 129, 1999]) {
      const occurring = text.slice(1001 - Math.floor(length / 2), 1001 - Math.floor(length / 2) + length);
      expect(occurring.length).toBe(length);
      expect(matchesSearch(text, occurring)).toBe(true);
      expect(matchesSearch(text, occurring)).toBe(text.includes(occurring));
      const missing = `${occurring.slice(0, -1)}d`;
      expect(matchesSearch(text, missing)).toBe(false);
    }
    expect(matchesSearch(text, text)).toBe(true);
    expect(matchesSearch(text, `${text}a`)).toBe(false);
    expect(matchesSearch("", "a".repeat(100))).toBe(false);
  });

  it("5,000,000 line breaks in a query, and a summary of 5,000,000 characters", () => {
    let prepared = "x";
    expect(elapsed(() => (prepared = prepareQuery("\r\n".repeat(2_500_000))))).toBeLessThan(LIMIT_MS);
    expect(prepared).toBe("");
    const summary = "Word ".repeat(1_000_000);
    let text = "";
    expect(elapsed(() => (text = buildSearchText(session("t", summary, ["tag"]))))).toBeLessThan(LIMIT_MS);
    expect(text.length).toBe(1 + 1 + 5_000_000 + 1 + 3);
    expect(matchesSearch(text, "word word")).toBe(true);
  });

  it("a session with 200,000 tags", () => {
    const tags = Array.from({ length: 200_000 }, (_, index) => `tag${index}`);
    let text = "";
    expect(elapsed(() => (text = buildSearchText(session("t", "s", tags))))).toBeLessThan(LIMIT_MS);
    expect(text.startsWith("t\ns\ntag0\ntag1\n")).toBe(true);
    expect(matchesSearch(text, "tag199999")).toBe(true);
  });
});
