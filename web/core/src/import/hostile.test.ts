/// <reference types="node" />
// Hostile input (docs/import-rules.md C6, D9): the importer runs on a server shared with
// everything else, and its input comes from web pages and from strangers' files. Every call
// has to return, quickly, and without an exception, whatever it is given.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CaptureInput,
  type ImportResult,
  importCapture,
  importFile,
  importPaste,
  looksLikeLink,
  looksLikeSignInWall,
  type PasteOptions,
  parseText,
  splitDisplaySegments,
  stripChromeTurns,
  trimInline,
} from "./index.ts";

const chr = (code: number): string => String.fromCodePoint(code);

/** "Within a few seconds": every single call below must stay under this. Typical is well under one. */
const LIMIT_MS = 5_000;
/** A test makes several such calls. */
const TEST_TIMEOUT = 180_000;

const FIVE_MB = 5 * 1024 * 1024;
const MANY = 200_000;

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

// The time a call took: the smaller of the time on the clock and the processor time used. Other
// work on the same machine stretches the first, parallel test files in one process the second.
function quick<T>(label: string, run: () => T): T {
  const started = performance.now();
  const before = process.cpuUsage();
  const result = run();
  const used = process.cpuUsage(before);
  const elapsed = Math.min(performance.now() - started, (used.user + used.system) / 1000);
  expect(elapsed, `${label} took ${Math.round(elapsed)} ms`).toBeLessThan(LIMIT_MS);
  return result;
}

const PASTE: PasteOptions = { title: "Pasted session", pickerProvider: "other" };

function capture(kind: CaptureInput["kind"], turns: readonly string[], allowWall = true): CaptureInput {
  return {
    sourceUrl: "https://example.invalid/share/EXAMPLE",
    detectedTitle: null,
    typedName: "",
    kind,
    turns,
    allowWall,
  };
}

// ---------------------------------------------------------------------------------------
// What every result has to satisfy, whatever went in.
// ---------------------------------------------------------------------------------------

const REASONS = new Set([
  "empty_input",
  "undecodable",
  "unrecognised_json",
  "no_messages",
  "no_conversation_found",
  "sign_in_suspected",
]);
const FLAGS = new Set(["decoded_as_utf_16le", "decoded_as_utf_16be", "decoded_as_windows_1252"]);
const PROVIDERS = new Set(["claude", "chatgpt", "gemini", "other"]);
const ROLES = new Set(["user", "assistant", "system", "unknown"]);
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
/** With the u flag a surrogate class matches lone surrogates only. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** W1 and C5: a string that can be stored. */
function storable(value: string, what: string): void {
  if (value.includes("\r")) throw new Error(`${what} contains a CR`);
  if (value.includes(chr(0))) throw new Error(`${what} contains U+0000`);
  if (LONE_SURROGATE.test(value)) throw new Error(`${what} contains a lone surrogate`);
}

// Plain comparisons instead of one assertion per message: some results below hold 200,000 messages.
function must(condition: boolean, what: string): void {
  if (!condition) throw new Error(`malformed result: ${what}`);
}

function checkResult(result: ImportResult, restoring = false): void {
  must(["imported", "rejected", "link", "interchange"].includes(result.outcome), "an unknown outcome");
  if (result.outcome === "rejected") must(REASONS.has(result.reason), "an unknown reason");
  else must(result.reason === null, "a reason on a result that is no rejection");
  // W12: a success has sessions, everything else has none.
  if (result.outcome === "imported") must(result.sessions.length > 0, "a success without sessions");
  else must(result.sessions.length === 0, "sessions on a result that is no success");
  if (result.outcome === "link") must(result.linkUrl.startsWith("https://"), "a link that is not https");
  must(result.flags.length <= 1, "more than one flag");
  for (const flag of result.flags) must(FLAGS.has(flag), "an unknown flag");

  for (const session of result.sessions) {
    must(PROVIDERS.has(session.provider), "an unknown provider");
    must(session.title !== "", "an empty title");
    must(session.createdAt === null || TIMESTAMP.test(session.createdAt), "a date that is not RFC 3339");
    storable(session.title, "a title");
    storable(session.sourceUrl, "a source link");
    storable(session.model, "a model");
    storable(session.summary, "a summary");
    for (const tag of session.tags) {
      must(tag !== "", "an empty tag");
      storable(tag, "a tag");
    }
    // W12: no session without messages, no message with empty text.
    must(session.messages.length > 0, "a session without messages");
    for (const message of session.messages) {
      must(ROLES.has(message.role), "an unknown role");
      must(message.text !== "", "a message with empty text");
      must(trimInline(message.text) === message.text, "a message that is not trimmed");
      storable(message.text, "a message");
    }
  }

  // W10: dropped turns come from the two ends, in input order, with their positions. Without
  // `keepDropped` each end is one run without a gap; a turn that was put back leaves a gap.
  let previous = -1;
  let trailing = false;
  for (const turn of result.droppedTurns) {
    must(Number.isInteger(turn.index) && turn.index > previous, "dropped turns out of order");
    if (turn.position === "leading") {
      must(!trailing, "a leading turn after a trailing one");
      must(restoring || turn.index === previous + 1, "a leading turn that is not at the start");
    } else {
      must(turn.position === "trailing", "an unknown position");
      must(restoring || !trailing || turn.index === previous + 1, "trailing turns with a gap");
      trailing = true;
    }
    previous = turn.index;
    storable(turn.text, "a dropped turn");
  }
}

// ---------------------------------------------------------------------------------------

describe("the parent-cycle export returns (D9, W4, fixture 10)", () => {
  const node = (id: number, parent: number): string =>
    `"n${id}":{"parent":"n${parent}","message":{"author":{"role":"user"},"content":{"parts":["text ${id}"]}}}`;

  it("two nodes that name each other as parent", { timeout: TEST_TIMEOUT }, () => {
    const text = `{"current_node":"n0","mapping":{${node(0, 1)},${node(1, 0)}}}`;
    const result = quick("a cycle of two", () => importFile(utf8(text), "conversations.json"));
    expect(result.sessions[0]?.messages.map((message) => message.text)).toEqual(["text 1", "text 0"]);
  });

  it("a node that is its own parent", { timeout: TEST_TIMEOUT }, () => {
    const text = `{"current_node":"n0","mapping":{${node(0, 0)}}}`;
    const result = quick("a cycle of one", () => importFile(utf8(text), "conversations.json"));
    expect(result.sessions[0]?.messages).toHaveLength(1);
  });

  it(`a ring of ${MANY} nodes: each is visited once`, { timeout: TEST_TIMEOUT }, () => {
    const nodes: string[] = [];
    for (let id = 0; id < MANY; id++) nodes.push(node(id, (id + 1) % MANY));
    const text = `{"current_node":"n0","mapping":{${nodes.join(",")}}}`;
    const result = quick("a ring", () => importFile(utf8(text), "conversations.json"));
    expect(result.outcome).toBe("imported");
    expect(result.sessions[0]?.messages).toHaveLength(MANY);
    checkResult(result);
  });

  it("a long chain that runs into a cycle far from its start", { timeout: TEST_TIMEOUT }, () => {
    const nodes: string[] = [];
    for (let id = 0; id < MANY; id++) nodes.push(node(id, id === MANY - 1 ? MANY - 10 : id + 1));
    const text = `[{"current_node":"n0","mapping":{${nodes.join(",")}}}]`;
    const result = quick("a chain into a cycle", () => importFile(utf8(text), "conversations.json"));
    expect(result.sessions[0]?.messages).toHaveLength(MANY);
  });
});

describe("a 5 MB single line returns within a few seconds", () => {
  const lines: Record<string, string> = {
    letters: "a".repeat(FIVE_MB),
    "only blanks": " ".repeat(FIVE_MB),
    "a run of blanks between two letters": `x${" ".repeat(FIVE_MB)}x`,
    "tabs, then a letter": `${"\t".repeat(FIVE_MB)}x`,
    "zero width spaces": chr(0x200b).repeat(FIVE_MB),
    backticks: "`".repeat(FIVE_MB),
    hashes: "#".repeat(FIVE_MB),
    asterisks: "*".repeat(FIVE_MB),
    "a marker and a long text": `User: ${"a".repeat(FIVE_MB)}`,
    "a share header and a long text": `You said: ${"a".repeat(FIVE_MB)}`,
    "one character of 5 MB (a letter and combining marks)": `a${chr(0x301).repeat(FIVE_MB)}`,
    "surrogate pairs": chr(0x1f6b2).repeat(FIVE_MB / 2),
    "lone surrogates": chr(0xd800).repeat(FIVE_MB),
    "NUL characters": chr(0).repeat(FIVE_MB),
    "wall phrases": "sign in ".repeat(FIVE_MB / 8),
    "dots, like a very long link": "a.".repeat(FIVE_MB / 2),
    "digits and colons, like a clock time": `10:42${"1".repeat(FIVE_MB)}`,
    "opening brackets": "[".repeat(FIVE_MB),
    "percent escapes": "%41".repeat(Math.floor(FIVE_MB / 3)),
  };

  for (const [name, line] of Object.entries(lines)) {
    it(name, { timeout: TEST_TIMEOUT }, () => {
      const bytes = utf8(line);
      for (const filename of ["line.txt", "line.json"]) {
        checkResult(quick(`importFile ${filename}`, () => importFile(bytes, filename)));
      }
      checkResult(quick("importPaste", () => importPaste(line, PASTE)));
      checkResult(quick("importCapture page-text", () => importCapture(capture("page-text", [line]))));
      checkResult(quick("importCapture turns", () => importCapture(capture("turns", ["User: q", line]))));
      quick("splitDisplaySegments", () => splitDisplaySegments(line));
      quick("looksLikeSignInWall", () => looksLikeSignInWall([line]));
      quick("stripChromeTurns", () => stripChromeTurns([line]));
      quick("looksLikeLink", () => looksLikeLink(line));
    });
  }

  it("carriage returns: one line for the Apple app (D1), five million lines after W1", {
    timeout: TEST_TIMEOUT,
  }, () => {
    const line = "\r".repeat(FIVE_MB);
    checkResult(quick("importFile", () => importFile(utf8(line), "line.txt")));
    checkResult(quick("importPaste", () => importPaste(`User: q${line}Assistant: a`, PASTE)));
    checkResult(quick("importCapture page-text", () => importCapture(capture("page-text", [`x${line}y`]))));
    quick("splitDisplaySegments", () => splitDisplaySegments(`x${line}y`));
  });

  it("5 MB in the names and the link of a paste and of a capture", { timeout: TEST_TIMEOUT }, () => {
    const long = `https://example.invalid/${"%41".repeat(Math.floor(FIVE_MB / 3))}`;
    checkResult(
      quick("importPaste", () =>
        importPaste("User: q", { title: long, pickerProvider: "other", sourceUrl: long }),
      ),
    );
    const input: CaptureInput = {
      sourceUrl: long,
      detectedTitle: null,
      typedName: "",
      kind: "turns",
      turns: ["User: q"],
    };
    const result = quick("importCapture", () => importCapture(input));
    expect(result.sessions[0]?.title.length).toBe(Math.floor(FIVE_MB / 3));
    checkResult(quick("importFile", () => importFile(utf8("User: q"), `${"n".repeat(FIVE_MB)}.txt`)));
  });

  it("5 MB on the Origin line of a context pack (no pattern can backtrack)", {
    timeout: TEST_TIMEOUT,
  }, () => {
    const pack = `# Context pack: T\n\nOrigin: ${" (".repeat(FIVE_MB / 2)}\n\n## Transcript\n\n**User:**\n\nq\n\n---\n`;
    const result = quick("importPaste", () => importPaste(pack, PASTE));
    expect(result.sessions[0]?.messages).toEqual([{ role: "user", text: "q" }]);
  });
});

describe(`${MANY} short lines return within a few seconds`, () => {
  const header = "# t\nSource: https://claude.ai/code/EXAMPLE\n\n";
  const texts: Record<string, string> = {
    "a dialogue": "User: a\nAssistant: b\n".repeat(MANY / 2),
    "puller Markdown that is all separators": header + "---\n".repeat(MANY),
    "puller Markdown with a turn per line pair": header + "User: q\n---\n".repeat(MANY / 2),
    "puller header pairs and nothing else": "# a\nSource: b\n".repeat(MANY / 2),
    "fence lines": "```\n".repeat(MANY),
    "fence opening lines that never close": "```x\n".repeat(MANY),
    "four-backtick and three-backtick lines in turn": "````\n```\n".repeat(MANY / 2),
    "closed fences full of markers": "```a\nUser: x\n```\n".repeat(Math.floor(MANY / 3)),
    "share headers": "You said: x\n".repeat(MANY),
    "share headers with bodies": "You said: x\nbody\nClaude responded: y\nbody\n".repeat(MANY / 4),
    "whole-line labels": "You said\nq\nGemini said\na\n".repeat(MANY / 4),
    "blank lines": "\n".repeat(MANY),
    furniture: "Copy\n10:42 AM\n".repeat(MANY / 2),
    "one repeated line": "same\n".repeat(MANY),
    "bare names": "Claude\nUser\n".repeat(MANY / 2),
    "a context pack with a message per block": `# Context pack: T\n\n## Transcript\n\n${"**User:**\n\nq\n\n---\n\n".repeat(MANY / 6)}`,
    "a context pack that is all separators and blank runs": `# Context pack: T\n\n## Transcript\n\n${`---\n${"\n".repeat(49)}`.repeat(MANY / 50)}`,
    "wall phrases": "sign in\nlog in\n".repeat(MANY / 2),
    "header lines": "Created with example\n".repeat(MANY),
    "CR LF line endings": "User: a\r\nAssistant: b\r\n".repeat(MANY / 2),
  };

  for (const [name, text] of Object.entries(texts)) {
    it(name, { timeout: TEST_TIMEOUT }, () => {
      checkResult(quick("importFile", () => importFile(utf8(text), "lines.md")));
      checkResult(quick("importPaste", () => importPaste(text, { ...PASTE, allowWall: true })));
      checkResult(quick("importCapture page-text", () => importCapture(capture("page-text", [text]))));
      checkResult(quick("importCapture turns", () => importCapture(capture("turns", ["User: q", text]))));
      quick("splitDisplaySegments", () => splitDisplaySegments(text));
      quick("parseText", () => parseText(text, "t"));
    });
  }

  it.each([
    ["turns with a marker", "User: x"],
    ["chrome turns", "sign in"],
    ["label-only turns", "Assistant"],
    ["blank turns", " \n "],
    ["turns that start with header lines", "Sign in\nReal text"],
    ["turns that are a fenced block", "```\nCopy\n```"],
  ])(`${MANY} captured strings: %s`, { timeout: TEST_TIMEOUT }, (_name, turn) => {
    const turns = new Array<string>(MANY).fill(turn);
    checkResult(quick("importCapture turns", () => importCapture(capture("turns", turns))));
    checkResult(quick("importCapture page-text", () => importCapture(capture("page-text", turns))));
    quick("stripChromeTurns", () => stripChromeTurns(turns));
    quick("looksLikeSignInWall", () => looksLikeSignInWall(turns));
  });
});

describe("W6, fences and a long lead around speaker lines, return within a few seconds", () => {
  const turns = "You said: q\nClaude responded: a\n";
  const sixth = Math.floor(MANY / 6);
  const texts: Record<string, string> = {
    "speaker lines whose text opens a block":
      "You said: ```\ncode\n```\nClaude responded: ```\ncode\n```\n".repeat(sixth),
    "speaker lines quoted inside closed blocks":
      "You said: q\n```\nYou said: x\nClaude responded: y\n```\nClaude responded: a\n".repeat(sixth),
    "speaker lines after one fence that never closes": `\`\`\`\n${turns.repeat(MANY / 2)}`,
    "speaker lines that open four-backtick blocks, which three backticks never close": `${"You said: ````\n```\n".repeat(MANY / 2)}Claude responded: a\n`,
    [`${MANY} lines above the first speaker line`]: `${"a note\n".repeat(MANY)}${turns}`,
    [`${MANY} blank lines and one sign of a page above the first speaker line`]: `Report\n${"\n".repeat(MANY)}${turns}`,
    "a 5 MB line above the first speaker line": `${"a".repeat(FIVE_MB)}\n${turns}`,
    "one character of 5 MB above the first speaker line": `a${chr(0x301).repeat(FIVE_MB)}\n${turns}`,
    "twelve lines of 400 KB of phrases above the first speaker line": `${`${"sign in ".repeat(50_000)}\n`.repeat(12)}${turns}`,
  };

  for (const [name, text] of Object.entries(texts)) {
    it(name, { timeout: TEST_TIMEOUT }, () => {
      checkResult(quick("importPaste", () => importPaste(text, { ...PASTE, allowWall: true })));
      checkResult(quick("importCapture page-text", () => importCapture(capture("page-text", [text]))));
      quick("parseText", () => parseText(text, "t"));
    });
  }
});

describe("large and deeply nested JSON returns within a few seconds", () => {
  const message = (text: string, time: number): string =>
    `{"message":{"author":{"role":"user"},"create_time":${time},"content":{"parts":["${text}"]}}}`;

  it(`${MANY} nodes without current_node: the time order`, { timeout: TEST_TIMEOUT }, () => {
    const nodes: string[] = [];
    for (let id = 0; id < MANY; id++) nodes.push(`"n${id}":${message(`text ${id}`, id % 7)}`);
    const result = quick("importFile", () => importFile(utf8(`{"mapping":{${nodes.join(",")}}}`), "c.json"));
    expect(result.sessions[0]?.messages).toHaveLength(MANY);
    checkResult(result);
  });

  it(`${MANY} node ids that look like array indices, written in descending order`, {
    timeout: TEST_TIMEOUT,
  }, () => {
    const nodes: string[] = [];
    for (let id = MANY; id > 0; id--) nodes.push(`"${id}":${message(`text ${id}`, 0)}`);
    const result = quick("importFile", () => importFile(utf8(`{"mapping":{${nodes.join(",")}}}`), "c.json"));
    const texts = result.sessions[0]?.messages.map((entry) => entry.text) ?? [];
    expect(texts).toHaveLength(MANY);
    // The order of the text, not the numeric order JSON.parse gives (W4).
    expect(texts.slice(0, 3)).toEqual([`text ${MANY}`, `text ${MANY - 1}`, `text ${MANY - 2}`]);
  });

  it(`${MANY / 2} conversations in one export`, { timeout: TEST_TIMEOUT }, () => {
    const conversation = `{"title":"t","mapping":{"2":${message("x", 0)},"1":${message("y", 0)}}}`;
    const text = `[${new Array<string>(MANY / 2).fill(conversation).join(",")}]`;
    const result = quick("importFile", () => importFile(utf8(text), "c.json"));
    expect(result.sessions).toHaveLength(MANY / 2);
    expect(result.sessions[0]?.messages.map((entry) => entry.text)).toEqual(["x", "y"]);
  });

  it.each([
    ["a million nested arrays", `${"[".repeat(1_000_000)}${"]".repeat(1_000_000)}`, "unrecognised_json"],
    [
      "half a million nested objects",
      `${'{"a":'.repeat(500_000)}1${"}".repeat(500_000)}`,
      "unrecognised_json",
    ],
    [
      "half a million nested mappings",
      `${'{"mapping":'.repeat(500_000)}{}${"}".repeat(500_000)}`,
      "no_messages",
    ],
    ["5 MB of opening brackets", "[".repeat(FIVE_MB), "unrecognised_json"],
    ["5 MB of numbers in one array", `[${"1,".repeat(FIVE_MB / 2)}1]`, "unrecognised_json"],
    ["a 5 MB string", `"${"a".repeat(FIVE_MB)}"`, "unrecognised_json"],
  ])("%s", { timeout: TEST_TIMEOUT }, (_name, text, reason) => {
    const bytes = utf8(text);
    const result = quick("importFile .json", () => importFile(bytes, "deep.json"));
    expect([result.outcome, result.reason]).toEqual(["rejected", reason]);
    checkResult(quick("importFile .txt", () => importFile(bytes, "deep.txt")));
    checkResult(
      quick("importFile .json as plain text", () => importFile(bytes, "deep.json", { asPlainText: true })),
    );
  });

  it("deep nesting inside the parts of a message, in an export that needs the key order", {
    timeout: TEST_TIMEOUT,
  }, () => {
    const deep = `${"[".repeat(500_000)}${"]".repeat(500_000)}`;
    const text =
      `{"mapping":{"2":{"message":{"author":{"role":"user"},"content":{"parts":[${deep},"x"]}}},` +
      `"1":${message("y", 0)}}}`;
    const result = quick("importFile", () => importFile(utf8(text), "c.json"));
    expect(result.sessions[0]?.messages.map((entry) => entry.text)).toEqual(["x", "y"]);
  });

  it("a deeply nested interchange file is handed over without being walked", {
    timeout: TEST_TIMEOUT,
  }, () => {
    const text = `{"format":"sessionvault-interchange","x":${"[".repeat(500_000)}${"]".repeat(500_000)}}`;
    expect(quick("importFile", () => importFile(utf8(text), "v.json")).outcome).toBe("interchange");
  });

  it("a 5 MB message in an export is kept whole: nothing is truncated (2.10)", {
    timeout: TEST_TIMEOUT,
  }, () => {
    const text = `{"mapping":{"a":${message("a".repeat(FIVE_MB), 0)}}}`;
    const result = quick("importFile", () => importFile(utf8(text), "c.json"));
    expect(result.sessions[0]?.messages[0]?.text.length).toBe(FIVE_MB);
  });
});

// ---------------------------------------------------------------------------------------
// No exception escapes, for any input.
// ---------------------------------------------------------------------------------------

const list = (items: string): string[] => items.split("|");

/** Pieces that make the parsers and guards take every branch when they are thrown together. */
const FRAGMENTS = [
  ...["\n", "\n", "\n", "\r\n", "\r", " ", "  ", "\t"],
  // White space of the two trim sets, U+FEFF, U+0000, lone surrogates, an emoji, combining marks.
  ...[
    0xa0, 0x200b, 0x85, 0x2028, 0x2029, 0xfeff, 0x00, 0x0b, 0x0c, 0xd800, 0xdc00, 0x1f6b2, 0x301, 0x130,
  ].map(chr),
  ...list(
    "User|User:|Human:|You:|Me:|Assistant|Assistant:|Claude|Claude:|ChatGPT|GPT:|Gemini|AI:|System:|You said:|" +
      "You said|Claude responded:|Claude said:|ChatGPT said:|Gemini said:|Gemini said|**|#|##|:|---|----|```|````|" +
      "```js|~~~|# |Source: |https://claude.ai/share/EXAMPLE|chatgpt.com/share/EXAMPLE|example.invalid|.|" +
      "# Context pack: |## Transcript|## Summary|Origin: |Tags: |**User:**|**Assistant:**|**Note:**|, saved | (|)|" +
      "You are being given the transcript of an earlier conversation|Copy|Retry|Share|Report|Shared by |" +
      "Claude can make mistakes|10:42 AM|10:42|sign in|log in|cookie|privacy policy|ai overview|can make mistakes|" +
      "created with|shared conversation|conversation transcript|welcome back|word|a longer line of words|" +
      "constructor|__proto__|toString",
  ),
];

const WORDS = list("bread|tea|wheel|tulip|knot|the|a|is|prove|Claude|Gemini|sign in|cookie");
const sentence = fc
  .array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 7 })
  .map((words) => words.join(" "));

/** What a line can start with so that a parser reacts to it. */
const LINE_STARTS = list(
  "User|Human|You|Me|Assistant|Claude|ChatGPT|GPT|Gemini|AI|System|You said|Claude responded|Claude said|" +
    "ChatGPT said|Gemini said|**User|**Assistant|## Human|### Claude|#User|  Assistant|\tUser|# |Source: |" +
    "Origin: |Tags: |Shared by |Created with |```|````|  ```",
);

/** Lines that mean something as a whole. Some hold two lines, so that header pairs occur. */
const WHOLE_LINES = list(
  "|| |---| --- |----|```|```js|````|~~~|User|Assistant|Claude|Gemini|ChatGPT|You said|Gemini said|Copy|Retry|" +
    "Share|Report|10:42 AM|9:05|Searched the web|Sign in|AI Overview|This assistant can make mistakes.|" +
    "Privacy policy and cookie notice|Shared conversation|Conversation Transcript|Welcome back|**User:**|" +
    "**Assistant:**|**System:**|**Note:**|## Transcript|## Summary|" +
    "You are being given the transcript of an earlier conversation the user had|" +
    "# session_TWO\nSource: https://chatgpt.com/share/EXAMPLE-TWO|# other\nSource: not a link|" +
    "    indented code|\tindented|https://example.invalid/a",
);

const line = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .tuple(
        fc.constantFrom(...LINE_STARTS),
        fc.constantFrom("", ":", ": ", ":** ", "**: ", " "),
        fc.oneof(sentence, fc.constant("")),
      )
      .map((parts) => parts.join("")),
  },
  { weight: 4, arbitrary: fc.constantFrom(...WHOLE_LINES) },
  { weight: 3, arbitrary: sentence },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 12, size: "max" }) },
  {
    weight: 1,
    arbitrary: fc
      .array(fc.constantFrom(...FRAGMENTS), { maxLength: 6, size: "max" })
      .map((parts) => parts.join("")),
  },
);

/** How a text can begin: nothing special, puller Markdown, a context pack. */
const TEXT_HEADS = [
  "",
  "",
  "",
  "",
  "\n\n",
  chr(0xfeff),
  "# session_EXAMPLE\nSource: https://claude.ai/code/session_EXAMPLE\n\n",
  "\n \n# notes\nSource: https://gemini.google.com/share/EXAMPLE\n",
  "# \nSource: somewhere\n\n",
  "# Context pack: Notes\n\nOrigin: Gemini (model-x), saved Nov 19, 2026\nSource: https://example.invalid/x\n" +
    "Tags: a, B\n\n## Summary\n\nshort summary\n\nYou are being given the transcript of an earlier conversation\n\n" +
    "## Transcript\n\n**User:**\n\n",
  "# Context pack: T\n\n## Transcript\n\n",
  "Page title\nYou said: preview\n",
];

const structuredText = fc
  .tuple(
    fc.constantFrom(...TEXT_HEADS),
    fc.array(line, { maxLength: 30, size: "max" }),
    fc.constantFrom("\n", "\n", "\r\n", "\r"),
  )
  .map(([head, lines, ending]) => (head + lines.join("\n")).replaceAll("\n", ending));

/** Any text: mostly built from lines, sometimes a link, sometimes nothing but noise. */
const anyText = fc.oneof(
  { weight: 8, arbitrary: structuredText },
  {
    weight: 2,
    arbitrary: fc
      .array(fc.oneof(fc.constantFrom(...FRAGMENTS), fc.string({ unit: "binary", maxLength: 6 })), {
        maxLength: 60,
        size: "max",
      })
      .map((parts) => parts.join("")),
  },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 200, size: "max" }) },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 100, size: "max" }) },
  { weight: 1, arbitrary: fc.jsonValue().map((value) => JSON.stringify(value)) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      "https://claude.ai/share/EXAMPLE",
      " chatgpt.com/share/EXAMPLE\r\n",
      "example.invalid",
      " \n\t ",
    ),
  },
);

/** JSON in the shape of a ChatGPT export, with cycles, missing and mistyped fields. */
const junk = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double(),
  fc.string({ maxLength: 5 }),
  fc.constant([]),
  fc.constant({}),
);
/** Mostly the value it should be; sometimes a wrong type; sometimes missing (JSON drops undefined). */
function mostly<T>(arbitrary: fc.Arbitrary<T>): fc.Arbitrary<unknown> {
  return fc.oneof(
    { weight: 10, arbitrary: arbitrary },
    { weight: 1, arbitrary: junk },
    { weight: 1, arbitrary: fc.constant(undefined) },
  );
}
const nodeId = fc.constantFrom(
  "a",
  "b",
  "c",
  "d",
  "e",
  "1",
  "2",
  "10",
  "__proto__",
  "constructor",
  "missing",
);
const exportNode = mostly(
  fc.record({
    parent: mostly(nodeId),
    message: mostly(
      fc.record({
        author: mostly(fc.record({ role: mostly(fc.constantFrom("user", "assistant", "system", "tool")) })),
        create_time: mostly(fc.oneof(fc.integer({ min: 0, max: 5 }), fc.double({ noNaN: true }))),
        content: mostly(
          fc.record({ parts: mostly(fc.array(fc.oneof(sentence, anyText, junk), { maxLength: 3 })) }),
        ),
      }),
    ),
  }),
);
const exportConversation = mostly(
  fc.record({
    title: mostly(fc.oneof(sentence, anyText)),
    create_time: mostly(fc.oneof(fc.integer({ min: 0, max: 2_000_000_000 }), fc.double({ noNaN: true }))),
    current_node: mostly(nodeId),
    mapping: mostly(fc.dictionary(nodeId, exportNode, { maxKeys: 6 })),
    format: fc.constantFrom(undefined, undefined, undefined, undefined, "other", "sessionvault-interchange"),
  }),
);
const exportText = fc
  .oneof(exportConversation, fc.array(exportConversation, { maxLength: 4, size: "max" }))
  .map((value) => JSON.stringify(value) ?? "null");

function utf16(text: string, littleEndian: boolean, mark: boolean): Uint8Array {
  const out: number[] = mark ? (littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (littleEndian) out.push(unit & 0xff, unit >> 8);
    else out.push(unit >> 8, unit & 0xff);
  }
  return new Uint8Array(out);
}

const anyBytes = fc.oneof(
  fc.uint8Array({ maxLength: 300 }),
  fc.oneof(anyText, exportText).map(utf8),
  fc
    .tuple(anyText, fc.boolean(), fc.boolean())
    .map(([text, littleEndian, mark]) => utf16(text, littleEndian, mark)),
  fc
    .tuple(anyText, fc.uint8Array({ maxLength: 4 }))
    .map(([text, extra]) => new Uint8Array([...utf8(text), ...extra])),
  fc
    .tuple(fc.uint8Array({ maxLength: 4 }), exportText)
    .map(([extra, text]) => new Uint8Array([...extra, ...utf8(text)])),
);

const anyFilename = fc.oneof(
  fc.constantFrom(
    "a.txt",
    "a.md",
    "a.json",
    "a.JSON",
    "conversations.json",
    ".json",
    "noext",
    "name.",
    "a b.c d",
    "",
  ),
  fc.string({ unit: "binary", maxLength: 12 }),
);

const anyLink = fc.oneof(
  fc.constantFrom(
    "https://claude.ai/share/EXAMPLE",
    "https://chatgpt.com/share/EXAMPLE",
    "https://gemini.google.com/share/EXAMPLE",
    "https://g.co/gemini/share/EXAMPLE",
    "https://example.invalid/",
    "https://example.invalid/a/%20",
    "https://example.invalid/a/%00%0D",
    "https://example.invalid/%E0%A4%A",
    "",
    "not a link",
  ),
  anyText,
);

const provider = fc.constantFrom<PasteOptions["pickerProvider"]>("claude", "chatgpt", "gemini", "other");

const anyPasteOptions = fc.record(
  { title: anyText, pickerProvider: provider, sourceUrl: anyLink, allowWall: fc.boolean() },
  { requiredKeys: ["title", "pickerProvider"] },
);

const anyCaptureInput = fc.record(
  {
    sourceUrl: anyLink,
    detectedTitle: fc.oneof(fc.constant(null), anyText),
    typedName: anyText,
    kind: fc.constantFrom<CaptureInput["kind"]>("page-text", "turns"),
    turns: fc.array(anyText, { maxLength: 8 }),
    allowWall: fc.boolean(),
  },
  { requiredKeys: ["sourceUrl", "detectedTitle", "typedName", "kind", "turns"] },
);

/** Reproducible runs: the same inputs every time. */
const SEED = 20261120;

/** Counts what the generated inputs led to, so that a run that reaches too little fails. */
class Tally {
  private readonly counts = new Map<string, number>();

  add(key: string): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  result(result: ImportResult): void {
    this.add(result.outcome === "rejected" ? `rejected: ${result.reason}` : result.outcome);
    for (const flag of result.flags) this.add(flag);
    for (const turn of result.droppedTurns) this.add(`dropped ${turn.position}`);
    if (result.sessions.length > 1) this.add("several sessions");
    for (const session of result.sessions) {
      this.add(`provider ${session.provider}`);
      if (session.createdAt !== null) this.add("a date");
      if (session.summary !== "" || session.tags.length > 0 || session.model !== "")
        this.add("context pack fields");
      for (const message of session.messages) this.add(`role ${message.role}`);
    }
  }

  expectAll(keys: readonly string[]): void {
    const missing = keys.filter((key) => !this.counts.has(key));
    expect(missing, "the generated inputs never led to these").toEqual([]);
  }
}

describe("no exception escapes, and every result is well formed", () => {
  it("importFile, for any bytes and any file name", { timeout: TEST_TIMEOUT }, () => {
    const tally = new Tally();
    fc.assert(
      fc.property(anyBytes, anyFilename, fc.boolean(), (bytes, filename, asPlainText) => {
        const result = importFile(bytes, filename, { asPlainText });
        checkResult(result);
        tally.result(result);
        expect(result.droppedTurns).toEqual([]);
        expect(importFile(bytes, filename, { asPlainText })).toEqual(result); // a pure function
      }),
      { seed: SEED, numRuns: 3000 },
    );
    tally.expectAll([
      "imported",
      "interchange",
      "rejected: empty_input",
      "rejected: undecodable",
      "rejected: unrecognised_json",
      "rejected: no_messages",
      "decoded_as_utf_16le",
      "decoded_as_utf_16be",
      "decoded_as_windows_1252",
      "provider claude",
      "provider chatgpt",
      "provider gemini",
      "provider other",
      "role user",
      "role assistant",
      "role system",
      "role unknown",
    ]);
  });

  it("importFile, for ChatGPT-shaped JSON with cycles, missing and mistyped fields", {
    timeout: TEST_TIMEOUT,
  }, () => {
    const tally = new Tally();
    fc.assert(
      fc.property(exportText, (text) => {
        const result = importFile(utf8(text), "conversations.json");
        checkResult(result);
        tally.result(result);
        for (const session of result.sessions) expect(session.provider).toBe("chatgpt");
      }),
      { seed: SEED, numRuns: 3000 },
    );
    tally.expectAll([
      "imported",
      "interchange",
      "rejected: unrecognised_json",
      "rejected: no_messages",
      "several sessions",
      "a date",
      "role user",
      "role assistant",
      "role unknown",
    ]);
  });

  it("importPaste, for any text and any options", { timeout: TEST_TIMEOUT }, () => {
    const tally = new Tally();
    fc.assert(
      fc.property(fc.oneof(anyText, exportText), anyPasteOptions, (text, options) => {
        const result = importPaste(text, options);
        checkResult(result);
        tally.result(result);
        expect(result.droppedTurns).toEqual([]);
        expect(result.flags).toEqual([]);
        expect(importPaste(text, options)).toEqual(result);
      }),
      { seed: SEED, numRuns: 3000 },
    );
    tally.expectAll([
      "imported",
      "link",
      "rejected: empty_input",
      "rejected: sign_in_suspected",
      "rejected: no_messages",
      "several sessions",
      "context pack fields",
      "provider claude",
      "provider chatgpt",
      "provider gemini",
      "provider other",
      "role user",
      "role assistant",
      "role system",
      "role unknown",
    ]);
  });

  it("importCapture, for any strings of both kinds", { timeout: TEST_TIMEOUT }, () => {
    const tally = new Tally();
    fc.assert(
      fc.property(anyCaptureInput, (input) => {
        const result = importCapture(input);
        checkResult(result);
        tally.result(result);
        expect(result.flags).toEqual([]);
        expect(result.sessions.length).toBeLessThanOrEqual(1);
        if (input.kind === "page-text") expect(result.droppedTurns).toEqual([]);
        for (const turn of result.droppedTurns) expect(turn.index).toBeLessThan(input.turns.length);
        expect(importCapture(input)).toEqual(result);
      }),
      { seed: SEED, numRuns: 3000 },
    );
    tally.expectAll([
      "imported",
      "rejected: no_conversation_found",
      "rejected: sign_in_suspected",
      "dropped leading",
      "dropped trailing",
      "provider claude",
      "provider chatgpt",
      "provider gemini",
      "provider other",
      "role user",
      "role assistant",
      "role system",
      "role unknown",
    ]);
  });

  it("the three entry points, for values of any type at all", { timeout: TEST_TIMEOUT }, () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), fc.anything(), (first, second, third) => {
        // @ts-expect-error callers outside the type system
        checkResult(importFile(first, second, third));
        // @ts-expect-error callers outside the type system
        checkResult(importPaste(first, second));
        // @ts-expect-error callers outside the type system
        checkResult(importCapture(first));
        // @ts-expect-error callers outside the type system
        checkResult(importCapture({ kind: "turns", turns: first, sourceUrl: second, typedName: third }));
        // @ts-expect-error callers outside the type system
        checkResult(importPaste("User: q", first));
        // @ts-expect-error callers outside the type system
        checkResult(importFile(utf8("User: q"), first, second));
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("the display splitter and the guards, for any text", { timeout: TEST_TIMEOUT }, () => {
    let codeSegments = 0;
    let links = 0;
    let droppedTurns = 0;
    fc.assert(
      fc.property(anyText, fc.array(anyText, { maxLength: 6 }), (text, turns) => {
        for (const segment of splitDisplaySegments(text)) {
          if (segment.type === "code") {
            codeSegments++;
            // W13: the language is the inline-trimmed text after the backticks, and has none itself.
            expect(segment.language).not.toBe("");
            if (segment.language !== null) {
              expect(segment.language.includes("`")).toBe(false);
              expect(trimInline(segment.language)).toBe(segment.language);
            }
          }
        }
        expect(typeof looksLikeSignInWall(turns)).toBe("boolean");
        const { kept, dropped } = stripChromeTurns(turns);
        expect(kept.length + dropped.length).toBe(turns.length);
        droppedTurns += dropped.length;
        const link = looksLikeLink(text);
        if (link !== null) {
          links++;
          expect(link.startsWith("https://")).toBe(true);
        }
      }),
      { seed: SEED, numRuns: 3000 },
    );
    expect(codeSegments).toBeGreaterThan(50);
    expect(droppedTurns).toBeGreaterThan(50);
    expect(links).toBeGreaterThan(0);
  });

  it("W1: any text with CR LF or CR line endings gives exactly the result of its LF twin (D1, C3)", {
    timeout: TEST_TIMEOUT,
  }, () => {
    fc.assert(
      fc.property(anyText, anyPasteOptions, fc.constantFrom("\r\n", "\r"), (text, options, ending) => {
        const lf = text.replaceAll("\r", "");
        const other = lf.replaceAll("\n", ending);
        expect(importPaste(other, options)).toEqual(importPaste(lf, options));
        const turns = (value: string): CaptureInput => capture("turns", [value, value], false);
        expect(importCapture(turns(other))).toEqual(importCapture(turns(lf)));
        const page = (value: string): CaptureInput => capture("page-text", [value], false);
        expect(importCapture(page(other))).toEqual(importCapture(page(lf)));
        expect(splitDisplaySegments(other)).toEqual(splitDisplaySegments(lf));
        // As files: without U+0000, so that both byte sequences are read as UTF-8 (W2 looks at bytes).
        const file = (value: string): ImportResult => importFile(utf8(value.replaceAll(chr(0), "")), "t.md");
        expect(file(other)).toEqual(file(lf));
      }),
      { seed: SEED, numRuns: 1500 },
    );
  });
});

// ---------------------------------------------------------------------------------------
// W10 keep_dropped: the list comes from a request body, so it is hostile input too.
// ---------------------------------------------------------------------------------------

describe("keepDropped (W10 keep_dropped): results stay well formed, whatever the list holds", () => {
  /** Turns that the chrome test drops, so that there is something to put back. */
  const chromeTurn = fc.constantFrom(
    "Sign in",
    "AI Overview",
    "This assistant can make mistakes.",
    "cookie and privacy policy",
    "Conversation Transcript\nSign in",
    `Sign in${chr(0)}\r\n`,
    `${chr(0xfeff)}${chr(0xfeff)}Log in`,
    "Copy",
    "",
    "Assistant",
  );
  const turnsWithChrome = fc
    .tuple(
      fc.array(chromeTurn, { maxLength: 3 }),
      fc.array(fc.oneof(anyText, chromeTurn), { maxLength: 5 }),
      fc.array(chromeTurn, { maxLength: 3 }),
    )
    .map(([leading, middle, trailing]) => [...leading, ...middle, ...trailing]);
  /** An entry of the list: mostly an index of a turn, sometimes a number that names none. */
  const entry = fc.oneof(
    { weight: 10, arbitrary: fc.integer({ min: 0, max: 10 }) },
    { weight: 2, arbitrary: fc.integer({ min: -5, max: 40 }) },
    {
      weight: 2,
      arbitrary: fc.constantFrom(
        0.5,
        -0,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_SAFE_INTEGER,
        2 ** 32,
        2 ** 53,
        -1,
        1e300,
      ),
    },
  );
  const anyList = fc.array(entry, { maxLength: 12 });
  const captureWithChrome = fc.record(
    {
      sourceUrl: anyLink,
      detectedTitle: fc.oneof(fc.constant(null), anyText),
      typedName: anyText,
      kind: fc.constantFrom<CaptureInput["kind"]>("turns", "turns", "turns", "page-text"),
      turns: turnsWithChrome,
      allowWall: fc.boolean(),
    },
    { requiredKeys: ["sourceUrl", "detectedTitle", "typedName", "kind", "turns"] },
  );

  it("importCapture, for any capture and any list of numbers", { timeout: TEST_TIMEOUT }, () => {
    const tally = new Tally();
    let putBack = 0;
    let namedNothing = 0;
    let rescued = 0;
    fc.assert(
      fc.property(captureWithChrome, anyList, (plainInput, keepDropped) => {
        const input: CaptureInput = { ...plainInput, keepDropped };
        const plain = importCapture(plainInput);
        const result = importCapture(input);
        checkResult(plain);
        checkResult(result, true);
        tally.result(result);
        expect(result.flags).toEqual([]);
        expect(result.sessions.length).toBeLessThanOrEqual(1);
        expect(importCapture(input)).toEqual(result); // a pure function
        expect(keepDropped, "the list is not changed").toEqual([...keepDropped]);

        // Whole-page text has no dropped turns: the list changes nothing.
        if (input.kind === "page-text") {
          expect(result).toEqual(plain);
          return;
        }
        // Exactly the named turns leave the dropped list; the others stay as they were.
        const named = new Set(keepDropped);
        expect(result.droppedTurns).toEqual(plain.droppedTurns.filter((turn) => !named.has(turn.index)));
        for (const turn of result.droppedTurns) expect(turn.index).toBeLessThan(input.turns.length);
        if (result.droppedTurns.length < plain.droppedTurns.length) putBack++;
        else {
          namedNothing++;
          expect(result).toEqual(plain);
        }
        // Putting turns back never loses a message: those of the plain run are all there, in order.
        const before = plain.sessions[0]?.messages ?? [];
        const after = result.sessions[0]?.messages ?? [];
        let from = 0;
        for (const message of before) {
          let at = from;
          while (at < after.length && !(after[at]?.role === message.role && after[at]?.text === message.text))
            at++;
          must(at < after.length, "a message of the plain run is gone after a restore");
          from = at + 1;
        }
        // A capture that was all chrome can become a session, never the other way round.
        if (plain.outcome === "imported") expect(result.outcome).toBe("imported");
        else if (result.outcome === "imported") rescued++;
        // Title and link do not depend on the list.
        if (plain.outcome === "imported" && result.outcome === "imported") {
          expect(result.sessions[0]?.title).toBe(plain.sessions[0]?.title);
          expect(result.sessions[0]?.sourceUrl).toBe(plain.sessions[0]?.sourceUrl);
        }
      }),
      { seed: SEED, numRuns: 4000 },
    );
    expect(putBack).toBeGreaterThan(500);
    expect(namedNothing).toBeGreaterThan(200);
    expect(rescued).toBeGreaterThan(20);
    tally.expectAll([
      "imported",
      "rejected: no_conversation_found",
      "rejected: sign_in_suspected",
      "dropped leading",
      "dropped trailing",
      "role user",
      "role assistant",
      "role unknown",
    ]);
  });

  it("stripChromeTurns, for any turns and any list of numbers", { timeout: TEST_TIMEOUT }, () => {
    let putBack = 0;
    fc.assert(
      fc.property(turnsWithChrome, anyList, (turns, keepDropped) => {
        const plain = stripChromeTurns(turns);
        const { kept, dropped } = stripChromeTurns(turns, keepDropped);
        expect(kept.length + dropped.length).toBe(turns.length);
        const named = new Set(keepDropped);
        expect(dropped).toEqual(plain.dropped.filter((turn) => !named.has(turn.index)));
        if (dropped.length < plain.dropped.length) putBack++;
        for (const text of kept) storable(text, "a kept turn");
        for (const turn of dropped) storable(turn.text, "a dropped turn");
        // The session of the capture is built from exactly these.
        checkResult(importCapture({ ...capture("turns", turns), keepDropped }), true);
      }),
      { seed: SEED, numRuns: 3000 },
    );
    expect(putBack).toBeGreaterThan(500);
  });

  it("a list of any type at all: no exception, and what is no index of a turn changes nothing", {
    timeout: TEST_TIMEOUT,
  }, () => {
    let lists = 0;
    fc.assert(
      fc.property(turnsWithChrome, fc.oneof(fc.anything(), fc.array(fc.anything())), (turns, anything) => {
        const plainInput = capture("turns", turns);
        // @ts-expect-error callers outside the type system
        const input: CaptureInput = { ...plainInput, keepDropped: anything };
        const result = importCapture(input);
        checkResult(result, true);
        // Only whole numbers that are entries of a real list name a turn.
        const numbers = Array.isArray(anything)
          ? anything.filter((value): value is number => typeof value === "number")
          : [];
        if (Array.isArray(anything)) lists++;
        expect(result).toEqual(importCapture({ ...plainInput, keepDropped: numbers }));
        // @ts-expect-error callers outside the type system
        expect(stripChromeTurns(turns, anything)).toEqual(stripChromeTurns(turns, numbers));
        // And for whole-page text nothing at all depends on it.
        // @ts-expect-error callers outside the type system
        const page: CaptureInput = { ...capture("page-text", turns), keepDropped: anything };
        expect(importCapture(page)).toEqual(importCapture(capture("page-text", turns)));
      }),
      { seed: SEED, numRuns: 2000 },
    );
    expect(lists).toBeGreaterThan(500);
  });

  it(`${MANY} chrome turns, all put back, return within a few seconds`, { timeout: TEST_TIMEOUT }, () => {
    const all: number[] = [];
    for (let index = 0; index < MANY; index++) all.push(index);
    for (const turn of ["sign in", "Conversation Transcript\nSign in", "Assistant", "Copy", " \n "]) {
      const turns = new Array<string>(MANY).fill(turn);
      const plain = quick("importCapture", () => importCapture(capture("turns", turns)));
      const result = quick("importCapture with keepDropped", () =>
        importCapture({ ...capture("turns", turns), keepDropped: all }),
      );
      checkResult(result, true);
      expect(result.droppedTurns).toEqual([]);
      const { kept, dropped } = quick("stripChromeTurns", () => stripChromeTurns(turns, all));
      expect([kept.length, dropped.length]).toEqual([MANY, 0]);
      // Every second one put back: the other half stays dropped, in order.
      const half = quick("importCapture with every second index", () =>
        importCapture({ ...capture("turns", turns), keepDropped: all.filter((index) => index % 2 === 0) }),
      );
      checkResult(half, true);
      expect(half.droppedTurns.length).toBe(
        plain.droppedTurns.length - Math.ceil(plain.droppedTurns.length / 2),
      );
    }
  });

  it("a list of 2,000,000 entries costs one pass", { timeout: TEST_TIMEOUT }, () => {
    const turns = ["Sign in", "User: q", "Assistant: a", "AI Overview"];
    const shapes: Record<string, number[]> = {
      "the same index": new Array<number>(2_000_000).fill(3),
      "indexes that name no turn": Array.from({ length: 2_000_000 }, (_unused, index) => index + 4),
      "numbers that are no index": new Array<number>(2_000_000).fill(Number.NaN),
      "every kind in turn": Array.from(
        { length: 2_000_000 },
        (_unused, index) => [0, 3, -1, 0.5, 1e300][index % 5] ?? 0,
      ),
    };
    for (const [name, keepDropped] of Object.entries(shapes)) {
      const result = quick(name, () => importCapture({ ...capture("turns", turns), keepDropped }));
      checkResult(result, true);
      const expected = name === "the same index" ? [3] : name === "every kind in turn" ? [0, 3] : [];
      expect(result, name).toEqual(importCapture({ ...capture("turns", turns), keepDropped: expected }));
      quick(`stripChromeTurns, ${name}`, () => stripChromeTurns(turns, keepDropped));
    }
  });

  it("restored turns of 5 MB: a turn too long to be chrome is never dropped, and the list changes nothing", {
    timeout: TEST_TIMEOUT,
  }, () => {
    const long = `sign in ${" ".repeat(FIVE_MB)}cookie`;
    const turns = ["Sign in", long, "User: q", long, "AI Overview"];
    const plain = quick("importCapture", () => importCapture(capture("turns", turns)));
    expect(plain.droppedTurns.map((turn) => turn.index)).toEqual([0, 4]);
    const result = quick("importCapture with keepDropped", () =>
      importCapture({ ...capture("turns", turns), keepDropped: [0, 1, 2, 3, 4] }),
    );
    checkResult(result, true);
    expect(result.droppedTurns).toEqual([]);
    expect(result.sessions[0]?.messages.length).toBe((plain.sessions[0]?.messages.length ?? 0) + 2);
  });
});
