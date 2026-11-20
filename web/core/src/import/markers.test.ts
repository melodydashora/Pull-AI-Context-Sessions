// Speaker markers: the table of observed results in docs/import-rules.md 2.4, in the web
// form of W8 ("for lines without ** the web marker is identical to the Apple one").

import { describe, expect, it } from "vitest";
import { roleMarker, splitLeadingRoleMarker } from "./markers.ts";

const chr = (code: number): string => String.fromCodePoint(code);
const NBSP = chr(0xa0);
const FULL_WIDTH_COLON = chr(0xff1a);
const COMBINING_ACUTE = chr(0x301);
const CAPITAL_I_WITH_DOT = chr(0x130);

function marker(line: string): [role: string, rest: string] | null {
  const found = roleMarker(line);
  return found === null ? null : [found.role, found.rest];
}

describe("2.4 role markers", () => {
  it.each([
    ["User: q", "user", "q"],
    ["USER: q", "user", "q"],
    ["user:q", "user", "q"],
    ["User:", "user", ""],
    ["Human: q", "user", "q"],
    ["You: q", "user", "q"],
    ["Me: q", "user", "q"],
    ["Assistant: a", "assistant", "a"],
    ["Claude: a", "assistant", "a"],
    ["ChatGPT: a", "assistant", "a"],
    ["GPT: a", "assistant", "a"],
    ["Gemini: a", "assistant", "a"],
    ["AI: a", "assistant", "a"],
    ["System: s", "system", "s"],
    ["Claude said: a", "assistant", "a"],
    ["ChatGPT said: a", "assistant", "a"],
    ["Gemini said: a", "assistant", "a"],
    ["You said: x", "user", "x"],
    ["Claude responded: x", "assistant", "x"],
  ])("%j is a marker of role %s with text %j", (line, role, rest) => {
    expect(marker(line)).toEqual([role, rest]);
    expect(roleMarker(line)?.bare).toBe(false);
  });

  it.each([
    ["User", "user"],
    ["Human", "user"],
    ["Assistant", "assistant"],
    ["Claude", "assistant"],
    ["ChatGPT", "assistant"],
    ["Gemini", "assistant"],
    ["gemini", "assistant"],
    ["  ASSISTANT  ", "assistant"],
  ])("the bare name %j is a marker", (line, role) => {
    expect(roleMarker(line)).toEqual({ role, rest: "", name: line.trim().toLowerCase(), bare: true });
  });

  it.each([
    "You",
    "Me",
    "GPT",
    "AI",
    "System",
    "You said",
    "Gemini said",
    "ChatGPT said",
    "Claude said",
    "Claude responded",
  ])("the bare word %j is NOT a marker", (line) => {
    expect(roleMarker(line)).toBeNull();
  });

  it.each([
    ["## User", "user", ""],
    ["### Human: q", "user", "q"],
    ["#User: q", "user", "q"],
    ["**User:** q", "user", "q"],
    ["**User**: q", "user", "q"],
    ["**User**", "user", ""],
    ["\tUser: q", "user", "q"],
    ["   User: q", "user", "q"],
    [`${NBSP}User: q`, "user", "q"],
    ["  ## **Assistant:**   spaced   ", "assistant", "spaced"],
    ["Assistant:a:b", "assistant", "a:b"],
    ["user: admin", "user", "admin"],
    ["system: linux", "system", "linux"],
    ["ai: true", "assistant", "true"],
    ["me: too", "user", "too"],
    ["you: there", "user", "there"],
  ])("%j is a marker of role %s with text %j", (line, role, rest) => {
    expect(marker(line)).toEqual([role, rest]);
  });

  it.each([
    "User : q",
    "User 1: q",
    "User (me): q",
    "[User]: q",
    "Users: q",
    "Username: q",
    "AI assistant: q",
    "GPT-4: a",
    "- User: q",
    "> User: q",
    "1. User: q",
    "*User:* q",
    "__User:__ q",
    "# # User: q",
    `User${FULL_WIDTH_COLON} q`,
    "",
    "   ",
    "#",
    "**",
    "Hello there",
  ])("%j is not a marker", (line) => {
    expect(roleMarker(line)).toBeNull();
  });

  it("tries the longer names first, so 'Claude said:' is not 'Claude' with a rest", () => {
    expect(roleMarker("Claude said: hi")?.name).toBe("claude said");
    expect(roleMarker("Claude: said hi")?.name).toBe("claude");
    expect(roleMarker("You said: hi")?.name).toBe("you said");
    expect(roleMarker("You: said hi")?.name).toBe("you");
    expect(roleMarker("ChatGPT: x")?.name).toBe("chatgpt");
    expect(roleMarker("GPT: x")?.name).toBe("gpt");
  });
});

describe("W8 the web form: ** is removed only around the label (D7, fixture 21)", () => {
  it("keeps bold text after the label, where the Apple app deletes every **", () => {
    expect(marker("**Assistant:** Use **bold** now")).toEqual(["assistant", "Use **bold** now"]);
    expect(marker("**User:** Which tyre pressure for **wet** roads?")).toEqual([
      "user",
      "Which tyre pressure for **wet** roads?",
    ]);
    expect(marker("**Assistant:** **Lower it slightly.** About 10 percent less.")).toEqual([
      "assistant",
      "**Lower it slightly.** About 10 percent less.",
    ]);
  });

  it("removes ** in exactly three places: before the name, after it, and after the colon", () => {
    expect(marker("**User**:** q")).toEqual(["user", "q"]);
    expect(marker("User:** q")).toEqual(["user", "q"]);
    expect(marker("User**: q")).toEqual(["user", "q"]);
    expect(marker("User: ** q")).toEqual(["user", "** q"]);
    expect(roleMarker("Us**er: q")).toBeNull();
    expect(roleMarker("****User: q")).toBeNull();
    expect(marker("## **Claude**")).toEqual(["assistant", ""]);
  });
});

describe("D18 accidents of the string library are not copied", () => {
  it("finds a marker that is followed by a combining mark, which the Apple app misses", () => {
    expect(marker(`User:${COMBINING_ACUTE} q`)).toEqual(["user", `${COMBINING_ACUTE} q`]);
  });

  it("looks only at the start of a very long line", () => {
    const long = `User: ${"x".repeat(100_000)}`;
    expect(roleMarker(long)?.rest.length).toBe(100_000);
    expect(roleMarker(`${"x".repeat(100_000)} User: q`)).toBeNull();
  });
});

describe("corrections.md 3, point 9: marker words are matched with ASCII case folding only", () => {
  /** The names of 2.4, in the order they are tried. */
  const NAMES = [
    "you said",
    "claude responded",
    "claude said",
    "chatgpt said",
    "gemini said",
    "user",
    "human",
    "you",
    "me",
    "assistant",
    "claude",
    "chatgpt",
    "gpt",
    "gemini",
    "ai",
    "system",
  ];

  it("folds the letters A to Z, in any mixture", () => {
    expect(marker("cLaUdE rEsPoNdEd: x")).toEqual(["assistant", "x"]);
    expect(marker("YOU SAID: x")).toEqual(["user", "x"]);
    expect(roleMarker("GEMINI")).toEqual({ role: "assistant", rest: "", name: "gemini", bare: true });
    for (const name of NAMES) {
      expect(roleMarker(`${name.toUpperCase()}: q`)?.name, name).toBe(name);
      expect(roleMarker(`${name}: q`)?.name, name).toBe(name);
    }
  });

  it("U+0130 is part of no marker, although toLowerCase() makes an 'i' and a combining dot of it", () => {
    // What a port that lower-cases the line matches: the reference port takes all of these for markers.
    expect(`A${CAPITAL_I_WITH_DOT}: x`.toLowerCase().startsWith("ai")).toBe(true);
    expect(roleMarker(`A${CAPITAL_I_WITH_DOT}: x`)).toBeNull();
    expect(roleMarker(`a${CAPITAL_I_WITH_DOT}:`)).toBeNull();
    expect(roleMarker(`GEMIN${CAPITAL_I_WITH_DOT}`)).toBeNull();
    expect(roleMarker(`Gemin${CAPITAL_I_WITH_DOT}: x`)).toBeNull();
    expect(roleMarker(`**Gemin${CAPITAL_I_WITH_DOT}**`)).toBeNull();
    expect(roleMarker(`## A${CAPITAL_I_WITH_DOT}: x`)).toBeNull();
    // Behind a marker it is ordinary text.
    expect(marker(`AI: ${CAPITAL_I_WITH_DOT}zmir`)).toEqual(["assistant", `${CAPITAL_I_WITH_DOT}zmir`]);
    // So a block or a captured turn that starts with such a line has no role.
    expect(splitLeadingRoleMarker(`GEMIN${CAPITAL_I_WITH_DOT}\nthe answer`)).toBeNull();
  });

  it("no character outside ASCII stands in for a letter of a name", { timeout: 120_000 }, () => {
    // Every character that any case mapping or compatibility mapping turns into ASCII letters:
    // the Kelvin sign, the long s, the dotless i, full-width and mathematical letters, ligatures.
    const lookalikes: string[] = [];
    for (let code = 0x80; code <= 0x10ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const character = String.fromCodePoint(code);
      const mapped = character.toLowerCase() + character.toUpperCase() + character.normalize("NFKC");
      if (/[A-Za-z]/.test(mapped)) lookalikes.push(character);
    }
    expect(lookalikes.length).toBeGreaterThan(1000);
    expect(lookalikes).toContain(CAPITAL_I_WITH_DOT);
    expect(lookalikes).toContain(chr(0x212a)); // KELVIN SIGN
    expect(lookalikes).toContain(chr(0x17f)); // LATIN SMALL LETTER LONG S
    let tried = 0;
    for (const character of lookalikes) {
      for (const name of NAMES) {
        for (let position = 0; position < name.length; position++) {
          if (name.charAt(position) === " ") continue;
          const spelled = name.slice(0, position) + character + name.slice(position + 1);
          tried++;
          if (roleMarker(`${spelled}: q`) !== null || roleMarker(spelled) !== null) {
            throw new Error(
              `U+${character.codePointAt(0)?.toString(16)} at ${position} of "${name}" is a marker`,
            );
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(100_000);
  });

  it("for ASCII lines the result is that of lower-casing the whole line (2.4)", () => {
    // The Apple rule of 2.4 in the web form of W8, written with toLowerCase().
    const lowerCased = (line: string): string | null => {
      const candidate = line.trim().replace(/^#+/, "").trim().replace(/^\*\*/, "");
      const lowered = candidate.toLowerCase();
      for (const name of NAMES) {
        if (!lowered.startsWith(name)) continue;
        const after = candidate.slice(name.length).replace(/^\*\*/, "");
        if (after === "" && ["user", "human", "assistant", "claude", "chatgpt", "gemini"].includes(name))
          return name;
        if (after.startsWith(":")) return name;
      }
      return null;
    };
    const mixedCase = (name: string, pattern: number): string =>
      Array.from(name, (letter, index) => ((pattern >> index) & 1 ? letter.toUpperCase() : letter)).join("");
    let markers = 0;
    for (const name of [...NAMES, "users", "ai assistant", "gemin", "a"]) {
      for (let pattern = 0; pattern < 64; pattern++) {
        for (const line of [
          `${mixedCase(name, pattern * 37)}: q`,
          mixedCase(name, pattern * 41),
          `## **${mixedCase(name, pattern * 43)}:** q`,
        ]) {
          const found = roleMarker(line)?.name ?? null;
          expect(found, line).toBe(lowerCased(line));
          if (found !== null) markers++;
        }
      }
    }
    expect(markers).toBeGreaterThan(1000);
  });
});

describe("2.4 splitLeadingRoleMarker", () => {
  it("takes the role from the first line and joins the rest of that line to the block", () => {
    expect(splitLeadingRoleMarker("**Human:** And daffodils?\nIs it the same rule?")).toEqual({
      role: "user",
      name: "human",
      text: "And daffodils?\nIs it the same rule?",
    });
    expect(splitLeadingRoleMarker("## Assistant\nYes, the same rule works.")).toEqual({
      role: "assistant",
      name: "assistant",
      text: "Yes, the same rule works.",
    });
  });

  it("full-trims what is left, which may be nothing at all (D8; the caller applies W12)", () => {
    expect(splitLeadingRoleMarker("Assistant")).toEqual({ role: "assistant", name: "assistant", text: "" });
    expect(splitLeadingRoleMarker("User:")).toEqual({ role: "user", name: "user", text: "" });
    expect(splitLeadingRoleMarker("User:\n\n  text  \n\n")).toEqual({
      role: "user",
      name: "user",
      text: "text",
    });
  });

  it("finds a role only on the first line of a block", () => {
    expect(splitLeadingRoleMarker("Planted 24 bulbs.\nUser: later")).toBeNull();
    expect(splitLeadingRoleMarker("")).toBeNull();
  });

  it("counts a bare name here without any dialogue condition (W8, fixtures 01 and 52)", () => {
    expect(splitLeadingRoleMarker("Gemini\nthe answer")).toEqual({
      role: "assistant",
      name: "gemini",
      text: "the answer",
    });
  });
});
