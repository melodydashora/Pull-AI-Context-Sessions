/// <reference types="node" />
// W10 `keep_dropped` (docs/import-rules.md W10, "restore"; capture.md 8.3c; corrections.md 1.4.2
// and 1.5.7): the user sees the turns that were dropped as page chrome and puts some of them
// back. import-rules.md gives a worked example and says "there is no fixture file for it yet,
// so turn these lines into tests". These are those tests: the turns are the ones of fixtures
// 43, 50 and 41, read as bytes and checked against the manifest before anything is parsed.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type CaptureImportResult,
  type CaptureInput,
  importCapture,
  normaliseText,
  stripChromeTurns,
} from "./index.ts";

const FIXTURE_DIR = new URL("../../../fixtures/import/", import.meta.url);

const chr = (...codes: number[]): string => String.fromCodePoint(...codes);
const NUL = chr(0);
const BOM = chr(0xfeff);

interface ManifestCase {
  readonly id: string;
  readonly input: string;
  readonly input_sha256: string;
}

function manifestCase(id: string): ManifestCase {
  const manifest: { cases: ManifestCase[] } = JSON.parse(
    readFileSync(new URL("manifest.json", FIXTURE_DIR), "utf8"),
  );
  const found = manifest.cases.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no fixture ${id}`);
  return found;
}

/** The bytes of a fixture input, refused when they are not the bytes the manifest names. */
function fixtureBytes(id: string): Uint8Array {
  const item = manifestCase(id);
  const bytes = new Uint8Array(readFileSync(new URL(item.input, FIXTURE_DIR)));
  if (createHash("sha256").update(bytes).digest("hex") !== item.input_sha256) {
    throw new Error(`FIXTURE BYTES WERE ALTERED: ${id}`);
  }
  return bytes;
}

/** The capture input a fixture describes (README "Input formats"), with `keepDropped` when given. */
function fixtureInput(id: string, keepDropped?: readonly number[]): CaptureInput {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(fixtureBytes(id));
  const input: {
    source_url: string;
    detected_title: string | null;
    typed_name: string;
    kind: "page-text" | "turns";
    turns: string[];
  } = JSON.parse(text);
  return {
    sourceUrl: input.source_url,
    detectedTitle: input.detected_title,
    typedName: input.typed_name,
    kind: input.kind,
    turns: input.turns,
    ...(keepDropped === undefined ? {} : { keepDropped }),
  };
}

const F43 = "43-capture-real-turns-dropped-as-chrome";
const F50 = "50-capture-all-chrome";
const F41 = "41-capture-header-residue-long-first-turn";

/** Outcome, the messages as role and text, and the dropped turns as position and index. */
function shape(result: CaptureImportResult): {
  outcome: string;
  reason: string | null;
  messages: [string, string][];
  dropped: [string, number][];
} {
  return {
    outcome: result.outcome,
    reason: result.reason,
    messages: (result.sessions[0]?.messages ?? []).map((message) => [message.role, message.text]),
    dropped: result.droppedTurns.map((turn) => [turn.position, turn.index]),
  };
}

function capture(
  turns: readonly string[],
  keepDropped?: readonly number[],
  overrides: Partial<CaptureInput> = {},
): CaptureImportResult {
  const input: CaptureInput = {
    sourceUrl: "https://example.invalid/share/EXAMPLE",
    detectedTitle: null,
    typedName: "",
    kind: "turns",
    turns,
    ...overrides,
    ...(keepDropped === undefined ? {} : { keepDropped }),
  };
  return importCapture(input);
}

/** The same call with a `keepDropped` of any type at all: a caller outside the type system. */
function captureWithAny(turns: readonly string[], keepDropped: unknown): CaptureImportResult {
  const input = {
    sourceUrl: "https://example.invalid/share/EXAMPLE",
    detectedTitle: null,
    typedName: "",
    kind: "turns",
    turns,
    keepDropped,
  };
  // @ts-expect-error a caller outside the type system
  return importCapture(input);
}

beforeAll(() => {
  // Before any parser runs: the three inputs are the ones the manifest names.
  for (const id of [F43, F50, F41]) fixtureBytes(id);
});

describe("W10 keep_dropped: the worked example of import-rules.md", () => {
  const T43 = {
    first: "The new design integrates a rear rack mount. Is it strong enough?",
    last: "How do I sign in to the forum to post it?",
  };

  it("the four turns of fixture 43: absent or [] is fixture 43 itself", () => {
    const plain = importCapture(fixtureInput(F43));
    expect(shape(plain)).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["assistant", "Yes, if the bolts are steel."],
        ["user", "Good."],
      ],
      dropped: [
        ["leading", 0],
        ["trailing", 3],
      ],
    });
    expect(importCapture(fixtureInput(F43, []))).toEqual(plain);
  });

  it("fixture 43 with [0]: unknown (turn 0), assistant, user; dropped: trailing 3", () => {
    const result = importCapture(fixtureInput(F43, [0]));
    expect(shape(result)).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["unknown", T43.first],
        ["assistant", "Yes, if the bolts are steel."],
        ["user", "Good."],
      ],
      dropped: [["trailing", 3]],
    });
    expect(result.droppedTurns).toEqual([{ position: "trailing", index: 3, text: T43.last }]);
  });

  it("fixture 43 with [3]: assistant, user, unknown (turn 3); dropped: leading 0", () => {
    const result = importCapture(fixtureInput(F43, [3]));
    expect(shape(result)).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["assistant", "Yes, if the bolts are steel."],
        ["user", "Good."],
        ["unknown", T43.last],
      ],
      dropped: [["leading", 0]],
    });
    expect(result.droppedTurns).toEqual([{ position: "leading", index: 0, text: T43.first }]);
  });

  it("fixture 43 with [0, 3]: unknown, assistant, user, unknown; dropped: none", () => {
    expect(shape(importCapture(fixtureInput(F43, [0, 3])))).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["unknown", T43.first],
        ["assistant", "Yes, if the bolts are steel."],
        ["user", "Good."],
        ["unknown", T43.last],
      ],
      dropped: [],
    });
  });

  it.each([[[1]], [[99]]])("fixture 43 with %j: as without it, the index names no dropped turn", (list) => {
    expect(importCapture(fixtureInput(F43, list))).toEqual(importCapture(fixtureInput(F43)));
  });

  it("nothing but the messages and the dropped turns changes: title, provider and link stay", () => {
    const plain = importCapture(fixtureInput(F43)).sessions[0];
    const restored = importCapture(fixtureInput(F43, [0, 3])).sessions[0];
    expect(restored).toEqual({ ...plain, messages: restored?.messages });
    expect(restored).toMatchObject({
      title: "EXAMPLE-0000-RACK",
      provider: "claude",
      sourceUrl: "https://claude.ai/share/EXAMPLE-0000-RACK",
    });
  });

  it("the two turns of fixture 50: both are chrome, the result is rejected with no_conversation_found", () => {
    expect(shape(importCapture(fixtureInput(F50)))).toEqual({
      outcome: "rejected",
      reason: "no_conversation_found",
      messages: [],
      dropped: [
        ["leading", 0],
        ["leading", 1],
      ],
    });
  });

  it("fixture 50 with [0]: imported, one message, unknown, 'AI Overview'; dropped: leading 1", () => {
    const result = importCapture(fixtureInput(F50, [0]));
    expect(shape(result)).toEqual({
      outcome: "imported",
      reason: null,
      messages: [["unknown", "AI Overview"]],
      dropped: [["leading", 1]],
    });
    expect(result.droppedTurns).toEqual([
      { position: "leading", index: 1, text: "This assistant can make mistakes." },
    ]);
    expect(result.sessions[0]).toMatchObject({
      title: "EXAMPLECHROME",
      provider: "other",
      sourceUrl: "https://example.com/share/EXAMPLECHROME",
    });
  });

  it("fixture 50 with [0, 1]: imported, two messages, both unknown; dropped: none", () => {
    expect(shape(importCapture(fixtureInput(F50, [0, 1])))).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["unknown", "AI Overview"],
        ["unknown", "This assistant can make mistakes."],
      ],
      dropped: [],
    });
  });

  it("the three turns of fixture 41 with [2]: user, assistant, unknown; dropped: none", () => {
    const plain = importCapture(fixtureInput(F41));
    expect(shape(plain).dropped).toEqual([["trailing", 2]]);
    const result = shape(importCapture(fixtureInput(F41, [2])));
    expect(result.messages.map(([role]) => role)).toEqual(["user", "assistant", "unknown"]);
    // The first turn has lost its header lines, with or without the restore.
    expect(result.messages.slice(0, 2)).toEqual(shape(plain).messages);
    expect(result.messages[0]?.[1].startsWith("I am planning a week of bicycle touring")).toBe(true);
    expect(result.messages[2]).toEqual(["unknown", "This assistant can make mistakes."]);
    expect(result.dropped).toEqual([]);
  });
});

describe("W10 keep_dropped: what the rule says beyond the example", () => {
  const TURNS_43 = (): readonly string[] => fixtureInput(F43).turns;

  it("an index that names no dropped turn is ignored: a kept turn, or no turn at all", () => {
    const plain = capture(TURNS_43());
    for (const list of [[1], [2], [1, 2], [4], [99], [4, 5, 6]]) {
      expect(capture(TURNS_43(), list), JSON.stringify(list)).toEqual(plain);
    }
    // Next to one that does name a dropped turn, it changes nothing either.
    expect(capture(TURNS_43(), [99, 0, 1])).toEqual(capture(TURNS_43(), [0]));
  });

  it("duplicates count once, and the order of the list does not matter", () => {
    const both = capture(TURNS_43(), [0, 3]);
    expect(capture(TURNS_43(), [0, 0, 0, 3, 3])).toEqual(both);
    expect(capture(TURNS_43(), [3, 0])).toEqual(both);
    expect(capture(TURNS_43(), [3, 0, 3, 0])).toEqual(both);
    expect(capture(TURNS_43(), [0, 0])).toEqual(capture(TURNS_43(), [0]));
  });

  it("a negative index names no turn: -1 is not 'the last one'", () => {
    const plain = capture(TURNS_43());
    for (const list of [[-1], [-4], [-3, -1], [-99], [Number.MIN_SAFE_INTEGER], [Number.NEGATIVE_INFINITY]]) {
      expect(capture(TURNS_43(), list), JSON.stringify(list)).toEqual(plain);
    }
  });

  it("a huge index names no turn", () => {
    const plain = capture(TURNS_43());
    const huge = [Number.MAX_SAFE_INTEGER, 2 ** 53, 2 ** 32, 2 ** 32 + 3, 1e308, Number.POSITIVE_INFINITY];
    for (const index of huge) expect(capture(TURNS_43(), [index]), String(index)).toEqual(plain);
    expect(capture(TURNS_43(), huge)).toEqual(plain);
  });

  it("a number that is no whole number names no turn", () => {
    const plain = capture(TURNS_43());
    for (const list of [[0.5], [2.999], [3.0000001], [Number.NaN], [Number.EPSILON]]) {
      expect(capture(TURNS_43(), list), JSON.stringify(list)).toEqual(plain);
    }
  });

  it("a long list costs one pass: 200,000 entries, most of them naming nothing", () => {
    const list: number[] = [];
    for (let index = 0; index < 200_000; index++) list.push(index % 7 === 0 ? 3 : index + 10);
    const started = performance.now();
    const result = capture(TURNS_43(), list);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result).toEqual(capture(TURNS_43(), [3]));
  });

  it("anything that is no list of numbers is ignored, and nothing throws", () => {
    const plain = capture(TURNS_43());
    const wrong: unknown[] = ["0", "0,3", 0, 3, true, null, {}, { 0: true, length: 1 }, new Set([0, 3])];
    for (const value of wrong) expect(captureWithAny(TURNS_43(), value), String(value)).toEqual(plain);
    // A list is read entry by entry: what is no number names nothing.
    expect(captureWithAny(TURNS_43(), ["0", null, [0], { index: 0 }, true, "3"])).toEqual(plain);
    expect(captureWithAny(TURNS_43(), ["0", 3, null])).toEqual(capture(TURNS_43(), [3]));
    // The exported guard takes the same care.
    const turns = [...TURNS_43()];
    // @ts-expect-error a caller outside the type system
    expect(stripChromeTurns(turns, "0")).toEqual(stripChromeTurns(turns));
    // @ts-expect-error a caller outside the type system
    expect(stripChromeTurns(turns, ["0", 3])).toEqual(stripChromeTurns(turns, [3]));
  });

  it("applies to kind 'turns' only: for whole-page text it is ignored", () => {
    const page = (keepDropped?: readonly number[]): CaptureImportResult =>
      capture(TURNS_43(), keepDropped, { kind: "page-text", allowWall: true });
    expect(page([0, 3])).toEqual(page());
    expect(page([0, 3]).droppedTurns).toEqual([]);
    // The strings of fixture 50 as page text: one note, nothing dropped, whatever the list says.
    const chromePage = (keepDropped?: readonly number[]): CaptureImportResult =>
      importCapture({ ...fixtureInput(F50, keepDropped), kind: "page-text" });
    expect(chromePage([0])).toEqual(chromePage());
    expect(shape(chromePage([0])).messages).toEqual([
      ["unknown", "AI Overview\nThis assistant can make mistakes."],
    ]);
  });

  it("a restored turn is treated like any kept turn: the cleaner, the full trim, the leading marker", () => {
    const turns = ["  **Assistant:** this can make mistakes  \nCopy\n10:42 AM\n   indented stays", "User: q"];
    expect(shape(capture(turns)).dropped).toEqual([["leading", 0]]);
    expect(shape(capture(turns, [0]))).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["assistant", "this can make mistakes\n   indented stays"],
        ["user", "q"],
      ],
      dropped: [],
    });
  });

  it("so a restored turn that holds nothing but furniture lines still gives no message", () => {
    const furniture = "Claude can make mistakes. Please double-check responses.";
    expect(shape(capture([furniture, "User: q", "Assistant: a"]))).toMatchObject({
      dropped: [["leading", 0]],
    });
    expect(shape(capture([furniture, "User: q", "Assistant: a"], [0]))).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["user", "q"],
        ["assistant", "a"],
      ],
      dropped: [],
    });
    // Alone, it leaves nothing: rejected, and `dropped` holds only the turns that stay dropped.
    expect(shape(capture([furniture], [0]))).toEqual({
      outcome: "rejected",
      reason: "no_conversation_found",
      messages: [],
      dropped: [],
    });
    // A restored turn that is a label and furniture gives no message either (W12); its label counts (W9).
    const labelled = [`Gemini\n${furniture}`, "User: q"];
    expect(capture(labelled).sessions[0]?.provider).toBe("other");
    const restored = capture(labelled, [0]);
    expect(shape(restored)).toMatchObject({ messages: [["user", "q"]], dropped: [] });
    expect(restored.sessions[0]?.provider).toBe("gemini");
  });

  it("one dropped from the front goes back as stripLeadingHeaderLines left it, one from the end as it is", () => {
    const turn = "Conversation Transcript\nThis page can make mistakes.";
    const turns = [turn, "User: q", "Assistant: a", turn];
    expect(capture(turns).droppedTurns).toEqual([
      { position: "leading", index: 0, text: turn },
      { position: "trailing", index: 3, text: turn },
    ]);
    expect(shape(capture(turns, [0, 3]))).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["unknown", "This page can make mistakes."],
        ["user", "q"],
        ["assistant", "a"],
        ["unknown", turn],
      ],
      dropped: [],
    });
    expect(stripChromeTurns(turns, [0, 3]).kept).toEqual([
      "This page can make mistakes.",
      "User: q",
      "Assistant: a",
      turn,
    ]);
  });

  it("when every turn is chrome, all were dropped from the front: position and form follow that", () => {
    const turn = "Conversation Transcript\nThis page can make mistakes.";
    const result = capture(["AI Overview", turn], [1]);
    expect(shape(result)).toEqual({
      outcome: "imported",
      reason: null,
      messages: [["unknown", "This page can make mistakes."]],
      dropped: [["leading", 0]],
    });
    expect(shape(importCapture(fixtureInput(F50, [1])))).toEqual({
      outcome: "imported",
      reason: null,
      messages: [["unknown", "This assistant can make mistakes."]],
      dropped: [["leading", 0]],
    });
  });

  it("does not change the two scans: what is dropped and what the first kept turn loses stay the same", () => {
    const turns = ["AI Overview", "Sign in\nUser: q", "Assistant: a", "Please sign in", "Sign in"];
    expect(shape(capture(turns))).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["user", "q"],
        ["assistant", "a"],
      ],
      dropped: [
        ["leading", 0],
        ["trailing", 3],
        ["trailing", 4],
      ],
    });
    // The last one only: the one before it stays dropped, although it now stands between kept turns.
    expect(shape(capture(turns, [4]))).toEqual({
      outcome: "imported",
      reason: null,
      messages: [
        ["user", "q"],
        ["assistant", "a"],
        ["unknown", "Sign in"],
      ],
      dropped: [
        ["leading", 0],
        ["trailing", 3],
      ],
    });
    // The first one: the first turn the scan kept still loses its header line.
    expect(shape(capture(turns, [0])).messages).toEqual([
      ["unknown", "AI Overview"],
      ["user", "q"],
      ["assistant", "a"],
    ]);
  });

  it("the label of a restored turn counts for the provider (W9)", () => {
    const turns = ["Gemini: sign in to see more", "User: q"];
    expect(capture(turns).sessions[0]?.provider).toBe("other");
    const restored = capture(turns, [0]);
    expect(restored.sessions[0]?.provider).toBe("gemini");
    expect(shape(restored).messages).toEqual([
      ["assistant", "sign in to see more"],
      ["user", "q"],
    ]);
    // The host of the link still comes first.
    const withHost = capture(turns, [0], { sourceUrl: "https://chatgpt.com/share/EXAMPLE" });
    expect(withHost.sessions[0]?.provider).toBe("chatgpt");
  });

  it("stripChromeTurns takes the same list: positions are those of the input, texts are W1-normalised", () => {
    const turns = ["Sign in", "AI overview", "one", "sign in", "two", "can make mistakes", "sign in"];
    expect(stripChromeTurns(turns, [1, 5])).toEqual({
      kept: ["AI overview", "one", "sign in", "two", "can make mistakes"],
      dropped: [
        { position: "leading", index: 0, text: "Sign in" },
        { position: "trailing", index: 6, text: "sign in" },
      ],
    });
    expect(stripChromeTurns(turns, [])).toEqual(stripChromeTurns(turns));
    expect(stripChromeTurns(turns, [2, 3, 4, 99, -1])).toEqual(stripChromeTurns(turns));
    expect(stripChromeTurns([`${BOM}Sign${NUL} in\r\n`, "KEEP\r\n"], [0])).toEqual({
      kept: ["Sign in\n", "KEEP"],
      dropped: [],
    });
    expect(stripChromeTurns([], [0])).toEqual({ kept: [], dropped: [] });
  });
});

describe("W10 keep_dropped: for any turns and any list", () => {
  const CHROME = ["Sign in", "AI Overview", "This assistant can make mistakes.", "cookie and privacy policy"];
  const REAL = [
    "User: q",
    "Assistant: a",
    "a note",
    "Gemini\nthe answer",
    "Shared conversation\nUser: after a header",
  ];
  const FURNITURE = [
    "Claude can make mistakes. Please double-check.",
    "Conversation Transcript\nSign in",
    "",
  ];
  const turn = fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(...CHROME) },
    { weight: 4, arbitrary: fc.constantFrom(...REAL) },
    { weight: 2, arbitrary: fc.constantFrom(...FURNITURE) },
  );
  const turnList = fc.array(turn, { maxLength: 9 });
  const index = fc.oneof(
    { weight: 8, arbitrary: fc.integer({ min: 0, max: 9 }) },
    { weight: 1, arbitrary: fc.integer({ min: -3, max: 20 }) },
    { weight: 1, arbitrary: fc.constantFrom(0.5, Number.NaN, 1e9, Number.POSITIVE_INFINITY, -1) },
  );
  const indexList = fc.array(index, { maxLength: 8 });

  it("the dropped turns are those of the plain run minus the ones named; nothing else moves", () => {
    let restoredSome = 0;
    fc.assert(
      fc.property(turnList, indexList, (turns, list) => {
        const plain = stripChromeTurns(turns);
        const restored = stripChromeTurns(turns, list);
        const named = new Set(list);
        // Every turn is either kept or dropped, in input order.
        expect(restored.kept.length + restored.dropped.length).toBe(turns.length);
        expect(restored.dropped).toEqual(plain.dropped.filter((item) => !named.has(item.index)));
        if (restored.dropped.length < plain.dropped.length) restoredSome++;
        // The turns the scans kept are all still there, in their order and their form.
        let from = 0;
        for (const kept of plain.kept) {
          const at = restored.kept.indexOf(kept, from);
          expect(at).toBeGreaterThanOrEqual(from);
          from = at + 1;
        }
        // The same list twice, in any order, with repeats: the same result.
        expect(stripChromeTurns(turns, [...list, ...list].reverse())).toEqual(restored);
      }),
      { seed: 20261120, numRuns: 3000 },
    );
    expect(restoredSome).toBeGreaterThan(300);
  });

  it("naming every index leaves nothing dropped, and naming only kept ones changes nothing", () => {
    fc.assert(
      fc.property(turnList, (turns) => {
        const plain = stripChromeTurns(turns);
        const all = turns.map((_turn, position) => position);
        const everything = stripChromeTurns(turns, all);
        expect(everything.dropped).toEqual([]);
        expect(everything.kept.length).toBe(turns.length);
        const droppedIndexes = new Set(plain.dropped.map((item) => item.index));
        const keptIndexes = all.filter((position) => !droppedIndexes.has(position));
        expect(stripChromeTurns(turns, keptIndexes)).toEqual(plain);
        expect(capture(turns, keptIndexes)).toEqual(capture(turns));
      }),
      { seed: 20261120, numRuns: 1500 },
    );
  });

  it("importCapture reports exactly what stripChromeTurns reports, and stores no blank message", () => {
    let imported = 0;
    let rejected = 0;
    fc.assert(
      fc.property(turnList, indexList, (turns, list) => {
        const result = capture(turns, list);
        if (turns.length === 0) {
          expect(shape(result)).toMatchObject({ outcome: "rejected", dropped: [] });
          return;
        }
        expect(result.droppedTurns).toEqual(stripChromeTurns(turns, list).dropped);
        for (const message of result.sessions[0]?.messages ?? []) {
          expect(message.text).not.toBe("");
          expect(normaliseText(message.text)).toBe(message.text);
        }
        if (result.outcome === "imported") imported++;
        else rejected++;
        expect(capture(turns, list)).toEqual(result); // a pure function
      }),
      { seed: 20261120, numRuns: 3000 },
    );
    expect(imported).toBeGreaterThan(500);
    expect(rejected).toBeGreaterThan(100);
  });
});
