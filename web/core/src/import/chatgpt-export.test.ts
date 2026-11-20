// The ChatGPT export parser: docs/import-rules.md 2.5.1 with the changes of W4, beyond what
// fixtures 07 to 12 pin down. All content is invented; ids are placeholders.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseChatGPTExport } from "./chatgpt-export.ts";
import { readMappingKeyOrders } from "./json-key-order.ts";
import type { ParsedSession } from "./types.ts";

const chr = (code: number): string => String.fromCodePoint(code);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function node(role: string, text: string, extra: { [key: string]: Json } = {}): Json {
  return { message: { author: { role }, content: { content_type: "text", parts: [text] } }, ...extra };
}

function texts(sessions: readonly ParsedSession[] | null): string[][] {
  if (sessions === null) throw new Error("not recognised as an export");
  return sessions.map((session) => session.messages.map((message) => message.text));
}

function turns(sessions: readonly ParsedSession[] | null): [string, string][][] {
  if (sessions === null) throw new Error("not recognised as an export");
  return sessions.map((session) => session.messages.map((message) => [message.role, message.text]));
}

/** Parses JSON text the way importFile does: the parser gets the value and the text. */
function fromText(jsonText: string): ParsedSession[] | null {
  const value: unknown = JSON.parse(jsonText);
  return parseChatGPTExport(value, jsonText);
}

describe("W4 which files are a ChatGPT export", () => {
  const mapping = { a: node("user", "hello") };

  it("an array in which at least one entry is an object with a mapping object (D9, fixture 09)", () => {
    expect(texts(parseChatGPTExport([{ mapping }]))).toEqual([["hello"]]);
    expect(
      texts(parseChatGPTExport([1, "x", null, [], { title: "no mapping" }, { mapping: 5 }, { mapping }])),
    ).toEqual([["hello"]]);
  });

  it("a single object with a mapping object", () => {
    expect(texts(parseChatGPTExport({ mapping }))).toEqual([["hello"]]);
  });

  it.each([
    ["an empty array", []],
    ["an array without any conversation", [1, { title: "x" }, { mapping: null }, { mapping: [] }]],
    ["an object without a mapping", { title: "x" }],
    ["an object whose mapping is not an object", { mapping: "x" }],
    ["an object whose mapping is an array", { mapping: [node("user", "x")] }],
    ["null", null],
    ["a number", 5],
    ["a string", "mapping"],
    ["true", true],
  ])("%s is not this format", (_name, value) => {
    expect(parseChatGPTExport(value)).toBeNull();
  });

  it("an export without any message is this format, with no session (W3: no_messages)", () => {
    expect(parseChatGPTExport([{ mapping: {} }])).toEqual([]);
    expect(parseChatGPTExport({ mapping: { a: node("system", "hidden"), b: node("user", "   ") } })).toEqual(
      [],
    );
  });

  it("skips a conversation without messages and keeps the others in file order (C9)", () => {
    const sessions = parseChatGPTExport([
      { title: "one", mapping: { a: node("user", "1") } },
      { title: "empty", mapping: {} },
      { title: "three", mapping: { a: node("user", "3") } },
    ]);
    expect(sessions?.map((session) => session.title)).toEqual(["one", "three"]);
  });
});

describe("2.5.1 and W4: which nodes, in which order", () => {
  it("walks the branch that ends at current_node and leaves an abandoned branch out", () => {
    const mapping = {
      root: { message: null, parent: null },
      q: node("user", "question", { parent: "root" }),
      "a-old": node("assistant", "abandoned answer", { parent: "q" }),
      "a-new": node("assistant", "kept answer", { parent: "q" }),
    };
    expect(texts(parseChatGPTExport({ mapping, current_node: "a-new" }))).toEqual([
      ["question", "kept answer"],
    ]);
  });

  it("stops at the first node it has already visited (D9, fixture 10)", () => {
    const two = { a: node("user", "A", { parent: "b" }), b: node("assistant", "B", { parent: "a" }) };
    expect(texts(parseChatGPTExport({ mapping: two, current_node: "b" }))).toEqual([["A", "B"]]);
    const self = { a: node("user", "A", { parent: "a" }) };
    expect(texts(parseChatGPTExport({ mapping: self, current_node: "a" }))).toEqual([["A"]]);
  });

  it("ends the walk at a parent that is missing, not a string, or not an object", () => {
    const mapping = {
      a: node("user", "A", { parent: "gone" }),
      b: node("assistant", "B", { parent: 7 }),
      c: node("assistant", "C", { parent: "notanode" }),
      notanode: "text",
    };
    expect(texts(parseChatGPTExport({ mapping, current_node: "a" }))).toEqual([["A"]]);
    expect(texts(parseChatGPTExport({ mapping, current_node: "b" }))).toEqual([["B"]]);
    expect(texts(parseChatGPTExport({ mapping, current_node: "c" }))).toEqual([["C"]]);
  });

  it("uses the time order when the walk from current_node collects nothing", () => {
    const mapping = { a: node("user", "A"), b: node("assistant", "B") };
    expect(texts(parseChatGPTExport({ mapping, current_node: "missing" }))).toEqual([["A", "B"]]);
    expect(texts(parseChatGPTExport({ mapping, current_node: "" }))).toEqual([["A", "B"]]);
  });

  it("uses the time order when current_node is not a string", () => {
    const mapping = { a: node("user", "A"), b: node("assistant", "B") };
    for (const currentNode of [null, 3, true, ["a"], { id: "a" }]) {
      expect(texts(parseChatGPTExport({ mapping, current_node: currentNode }))).toEqual([["A", "B"]]);
    }
    expect(texts(parseChatGPTExport({ mapping }))).toEqual([["A", "B"]]);
  });

  it("a walk that finds nodes but no message does not fall back: the conversation is empty", () => {
    const mapping = { a: node("system", "hidden"), b: node("user", "elsewhere") };
    expect(parseChatGPTExport({ mapping, current_node: "a" })).toEqual([]);
  });

  it("a name that only the prototype of an object knows is not a node id", () => {
    const mapping = { a: node("user", "A") };
    for (const currentNode of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(texts(parseChatGPTExport({ mapping, current_node: currentNode }))).toEqual([["A"]]);
    }
    // As a key written in the file it is an id like any other.
    const text = '{"current_node":"__proto__","mapping":{"__proto__":PROTO,"other":OTHER}}'
      .replace("PROTO", JSON.stringify(node("user", "from proto")))
      .replace("OTHER", JSON.stringify(node("user", "other")));
    expect(texts(fromText(text))).toEqual([["from proto"]]);
  });

  it("time order: by message.create_time, a missing or non-numeric time counting as 0", () => {
    const at = (time: Json, text: string): Json => ({
      message: { author: { role: "user" }, create_time: time, content: { parts: [text] } },
    });
    const mapping = {
      late: at(30, "third"),
      text: at("5", "a string is not a time"),
      early: at(10.5, "second"),
      none: node("user", "no time"),
      negative: at(-1, "first"),
    };
    expect(texts(parseChatGPTExport({ mapping }))).toEqual([
      ["first", "a string is not a time", "no time", "second", "third"],
    ]);
  });

  it("time order: equal times keep the order of the keys in the JSON text (D9, fixture 11)", () => {
    const ids = ["m", "c", "x", "a", "k", "b", "z", "d", "y", "e", "w", "f"];
    const mapping: { [key: string]: Json } = {};
    for (const id of ids) mapping[id] = node("user", id);
    expect(texts(parseChatGPTExport({ mapping }))).toEqual([ids]);
  });

  it("time order: an infinite time sorts last and ties among them keep the key order", () => {
    const text =
      '{"mapping":{"a":{"message":{"author":{"role":"user"},"create_time":1e999,"content":{"parts":["inf a"]}}},' +
      '"b":{"message":{"author":{"role":"user"},"create_time":5,"content":{"parts":["five"]}}},' +
      '"c":{"message":{"author":{"role":"user"},"create_time":1e999,"content":{"parts":["inf c"]}}}}}';
    expect(texts(fromText(text))).toEqual([["five", "inf a", "inf c"]]);
  });
});

describe("W4 ties follow the JSON text even for ids that look like array indices", () => {
  // JavaScript moves such keys to the front of an object in numeric order (import-rules.md 5).
  const entry = (id: string): string => `${JSON.stringify(id)}:${JSON.stringify(node("user", `text ${id}`))}`;
  const exportOf = (ids: readonly string[]): string => `{"mapping":{${ids.map(entry).join(",")}}}`;
  const labels = (ids: readonly string[]): string[][] => [ids.map((id) => `text ${id}`)];

  it("keeps the order of the text when the parser is given the text", () => {
    const ids = ["10", "9", "b", "2", "a", "0"];
    expect(texts(fromText(exportOf(ids)))).toEqual(labels(ids));
  });

  it("without the text, the order is that of JSON.parse: index-like ids first", () => {
    const ids = ["10", "9", "b", "2", "a", "0"];
    const value: unknown = JSON.parse(exportOf(ids));
    expect(texts(parseChatGPTExport(value))).toEqual(labels(["0", "2", "9", "10", "b", "a"]));
  });

  it("still sorts by time first; only ties follow the text", () => {
    const at = (id: string, time: number): string =>
      `${JSON.stringify(id)}:${JSON.stringify({
        message: { author: { role: "user" }, create_time: time, content: { parts: [`text ${id}`] } },
      })}`;
    const text = `{"mapping":{${[at("7", 2), at("3", 1), at("5", 2), at("1", 1)].join(",")}}}`;
    expect(texts(fromText(text))).toEqual(labels(["3", "1", "7", "5"]));
  });

  it("works for every conversation of an array, each with its own mapping", () => {
    const text = `[${exportOf(["2", "1"])},"junk",{"title":"no mapping"},${exportOf(["x", "3", "0"])}]`;
    expect(texts(fromText(text))).toEqual([...labels(["2", "1"]), ...labels(["x", "3", "0"])]);
  });

  it("reads keys written with escapes, and keys inside nested values do not count", () => {
    const text =
      '{"title":"mapping","other":{"mapping":{"9":1,"8":2}},"mapping":{' +
      `${entry("5")},"\\u0034":${JSON.stringify(node("user", "text 4"))},` +
      '"skip":{"mapping":{"1":{},"0":{}},"list":[{"3":1},"}{"]},' +
      `${entry("1")}}}`;
    expect(texts(fromText(text))).toEqual(labels(["5", "4", "1"]));
  });

  it("a key written twice stands where it was written first and has its last value, as in JSON.parse", () => {
    const text = `{"mapping":{${entry("2")},${entry("1")},"2":${JSON.stringify(node("user", "second 2"))}}}`;
    expect(texts(fromText(text))).toEqual([["second 2", "text 1"]]);
  });

  it("of several mapping members the last one counts, as in JSON.parse", () => {
    const text = `{"mapping":{${entry("9")},${entry("8")}},"mapping":{${entry("2")},${entry("1")}}}`;
    expect(texts(fromText(text))).toEqual(labels(["2", "1"]));
  });

  it("ignores a text that does not belong to the value", () => {
    const value: unknown = JSON.parse(exportOf(["2", "1"]));
    expect(texts(parseChatGPTExport(value, exportOf(["7", "1"])))).toEqual(labels(["1", "2"]));
    expect(texts(parseChatGPTExport(value, "not json at all {"))).toEqual(labels(["1", "2"]));
  });

  it("the walk from current_node does not depend on key order at all", () => {
    const text =
      '{"current_node":"2","mapping":{"2":' +
      `${JSON.stringify(node("assistant", "answer", { parent: "10" }))},"10":${JSON.stringify(node("user", "question"))}}}`;
    expect(texts(fromText(text))).toEqual([["question", "answer"]]);
  });

  it("the key reader agrees with JSON.parse on the keys of any mapping", () => {
    const key = fc.oneof(
      fc.integer({ min: 0, max: 30 }).map(String),
      fc.string({ maxLength: 4 }),
      fc.constantFrom("__proto__", "constructor", "mapping", "007", "1e3", "-1", '"', "\\", "{", "]"),
    );
    const mappingText = fc
      .array(fc.tuple(key, fc.jsonValue()), { maxLength: 8 })
      .map(
        (entries) => `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",")}}`,
      );
    const conversation = fc
      .tuple(mappingText, fc.jsonValue(), fc.boolean())
      .map(([mapping, other, first]) =>
        first
          ? `{"mapping":${mapping},"other":${JSON.stringify(other)}}`
          : `{"other":${JSON.stringify(other)}, "mapping" : ${mapping}}`,
      );
    fc.assert(
      fc.property(
        fc.array(conversation, { minLength: 1, maxLength: 4 }),
        fc.boolean(),
        (conversations, asArray) => {
          const text = asArray ? `[${conversations.join(" ,\n")}]` : (conversations[0] ?? "{}");
          const parsed: unknown = JSON.parse(text);
          const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
          const orders = readMappingKeyOrders(text);
          list.forEach((item, index) => {
            const mapping: unknown = Reflect.get(Object(item), "mapping");
            const own = Object.keys(Object(mapping));
            const fromTextOrder = [...new Set(orders.get(index) ?? [])];
            // The same keys; and exactly the order of JSON.parse once the index-like keys are set aside.
            expect([...fromTextOrder].sort()).toEqual([...own].sort());
            const named = (keys: string[]): string[] => keys.filter((k) => !/^(0|[1-9][0-9]*)$/.test(k));
            expect(named(fromTextOrder)).toEqual(named(own));
          });
        },
      ),
      { seed: 20261120, numRuns: 500 },
    );
  });
});

describe("2.5.1 and W4: messages, titles and dates", () => {
  it("skips nodes whose message, author or content is not an object or whose role is not a string", () => {
    const mapping = {
      a: { message: null },
      b: { message: "text" },
      c: { message: { author: "user", content: { parts: ["x"] } } },
      d: { message: { author: { role: 5 }, content: { parts: ["x"] } } },
      e: { message: { author: { role: "user" }, content: "x" } },
      f: { message: { author: { role: "user" }, content: ["x"] } },
      g: { message: { author: { role: "user" } } },
      h: "not a node",
      i: node("user", "the only one"),
    };
    expect(texts(parseChatGPTExport({ mapping }))).toEqual([["the only one"]]);
  });

  it("keeps only the string parts, joins them with a newline, and full-trims", () => {
    const parts: Json = ["  first ", { asset_pointer: "file-EXAMPLE" }, 7, null, ["nested"], "second\n\n"];
    const mapping = { a: { message: { author: { role: "user" }, content: { parts } } } };
    expect(texts(parseChatGPTExport({ mapping }))).toEqual([["first \nsecond"]]);
  });

  it("content without string parts contributes nothing", () => {
    const mapping = {
      a: { message: { author: { role: "assistant" }, content: { content_type: "code", text: "print(1)" } } },
      b: { message: { author: { role: "assistant" }, content: { parts: "not an array" } } },
      c: { message: { author: { role: "assistant" }, content: { parts: [{ image: true }] } } },
      d: { message: { author: { role: "assistant" }, content: { parts: [] } } },
      e: node("user", "kept"),
    };
    expect(texts(parseChatGPTExport({ mapping }))).toEqual([["kept"]]);
  });

  it("applies W1 to the joined parts before the full trim", () => {
    const parts: Json = [`${chr(0xfeff)}one\r`, `two\rthree${chr(0)}`, `x${chr(0xd800)}y\r\n`];
    const mapping = { a: { message: { author: { role: "user" }, content: { parts } } } };
    // "one\r" joined with "\n" is a CR LF pair: one line break, not two.
    expect(texts(parseChatGPTExport({ mapping }))).toEqual([[`one\ntwo\nthree\nx${chr(0xfffd)}y`]]);
  });

  it("maps user, assistant and system; any other author is role unknown; system is skipped", () => {
    const mapping = {
      a: node("system", "hidden"),
      b: node("user", "u"),
      c: node("assistant", "a"),
      d: node("tool", "t"),
      e: node("User", "case matters"),
      f: node("", "empty role"),
    };
    expect(turns(parseChatGPTExport({ mapping }))).toEqual([
      [
        ["user", "u"],
        ["assistant", "a"],
        ["unknown", "t"],
        ["unknown", "case matters"],
        ["unknown", "empty role"],
      ],
    ]);
  });

  it("title: W1 and a full trim, then the fallback 'ChatGPT conversation'", () => {
    const mapping = { a: node("user", "x") };
    const title = (value: Json): string | undefined =>
      parseChatGPTExport({ title: value, mapping })?.[0]?.title;
    expect(title("  Bread notes \n")).toBe("Bread notes");
    expect(title(`a${chr(0)}b\r\nc`)).toBe("ab\nc");
    expect(title("")).toBe("ChatGPT conversation");
    expect(title(" \t\n")).toBe("ChatGPT conversation");
    expect(title(null)).toBe("ChatGPT conversation");
    expect(title(42)).toBe("ChatGPT conversation");
    expect(parseChatGPTExport({ mapping })?.[0]?.title).toBe("ChatGPT conversation");
  });

  it("every session is labelled ChatGPT and has no link, model, summary or tags", () => {
    expect(parseChatGPTExport({ mapping: { a: node("user", "x") } })).toEqual([
      {
        title: "ChatGPT conversation",
        provider: "chatgpt",
        model: "",
        sourceUrl: "",
        createdAt: null,
        summary: "",
        tags: [],
        messages: [{ role: "user", text: "x" }],
      },
    ]);
  });

  it.each([
    [0, "1970-01-01T00:00:00.000Z"],
    [1789000000, "2026-09-10T00:26:40.000Z"],
    [1789000000.5, "2026-09-10T00:26:40.500Z"],
    [1789000000.0009, "2026-09-10T00:26:40.000Z"],
    [-1.5, "1969-12-31T23:59:58.500Z"],
    [-62167219200, "0000-01-01T00:00:00.000Z"],
    [253402300799.999, "9999-12-31T23:59:59.999Z"],
  ])("create_time %d is the date %s (seconds since 1970, milliseconds kept)", (seconds, expected) => {
    const sessions = parseChatGPTExport({ create_time: seconds, mapping: { a: node("user", "x") } });
    expect(sessions?.[0]?.createdAt).toBe(expected);
  });

  it.each([
    ["a string", "1789000000"],
    ["true", true],
    ["null", null],
    ["an object", { seconds: 1 }],
  ])("create_time given as %s is no date", (_name, value) => {
    const sessions = parseChatGPTExport({ create_time: value, mapping: { a: node("user", "x") } });
    expect(sessions?.[0]?.createdAt).toBeNull();
  });

  it("a create_time that is not finite is no date", () => {
    const text =
      '{"create_time":1e999,"mapping":{"a":{"message":{"author":{"role":"user"},"content":{"parts":["x"]}}}}}';
    expect(fromText(text)?.[0]?.createdAt).toBeNull();
    expect(fromText(text.replace("1e999", "-1e999"))?.[0]?.createdAt).toBeNull();
  });

  it("a create_time outside the years 0000 to 9999 has no RFC 3339 form and is no date", () => {
    const date = (seconds: number): string | null | undefined =>
      parseChatGPTExport({ create_time: seconds, mapping: { a: node("user", "x") } })?.[0]?.createdAt;
    expect(date(253402300800)).toBeNull(); // the first second of the year 10000
    expect(date(-62167219200.001)).toBeNull(); // the last millisecond of the year -1
    expect(date(1e15)).toBeNull();
    expect(date(1e300)).toBeNull();
    expect(date(-1e300)).toBeNull();
  });

  it("every date it returns has the form the interchange schema demands", () => {
    const form = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (seconds) => {
        const sessions = parseChatGPTExport({ create_time: seconds, mapping: { a: node("user", "x") } });
        const createdAt = sessions?.[0]?.createdAt;
        if (createdAt !== null && createdAt !== undefined) expect(createdAt).toMatch(form);
      }),
      { seed: 20261120, numRuns: 1000 },
    );
  });
});
