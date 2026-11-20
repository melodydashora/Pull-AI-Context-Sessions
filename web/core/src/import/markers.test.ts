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

  it("matches the names without regard to case, as lower-casing the whole line does", () => {
    expect(marker("cLaUdE rEsPoNdEd: x")).toEqual(["assistant", "x"]);
    // "I with dot above" lower-cases to "i" plus a combining dot: the match is the "ignore the rest" of D18.
    expect(marker(`A${CAPITAL_I_WITH_DOT}: x`)).toEqual(["assistant", "x"]);
  });

  it("looks only at the start of a very long line", () => {
    const long = `User: ${"x".repeat(100_000)}`;
    expect(roleMarker(long)?.rest.length).toBe(100_000);
    expect(roleMarker(`${"x".repeat(100_000)} User: q`)).toBeNull();
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
