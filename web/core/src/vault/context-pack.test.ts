/// <reference types="node" />
// The context packs of docs/data-model.md 9.3, byte for byte, and the template rules of 4.1 and 8.3.
// The figures of the document are written out below and also read from the document itself, so
// that neither a slip in this file nor a change of the document goes unnoticed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importPaste } from "../import/index.ts";
import { emptyVault, importDocument, type Vault, type VaultSession } from "../interchange/index.ts";
import {
  type ContextPackMessage,
  type ContextPackSession,
  contextPackMarkdown,
  createSession,
  openFile,
  sessionContextPack,
} from "./index.ts";

const WEB = new URL("../../../", import.meta.url);
const EXAMPLE_BYTES = new Uint8Array(readFileSync(new URL("docs/example-vault-export.json", WEB)));
const DATA_MODEL = new TextDecoder("utf-8", { fatal: true }).decode(
  readFileSync(new URL("docs/data-model.md", WEB)),
);

function importExample(): Vault {
  const opened = openFile(EXAMPLE_BYTES, "example-vault-export.json");
  if (opened.route !== "interchange") throw new Error("the example did not go to the interchange reader");
  let n = 0;
  const imported = importDocument(emptyVault(), opened.json, {
    now: new Date("2026-11-20T08:00:00.000Z"),
    newId: () => `ffffffff-ffff-4fff-8fff-${String(++n).padStart(12, "0")}`,
  });
  if (!imported.ok) throw new Error("the example was refused");
  return imported.vault;
}

const vault = importExample();

/** Session "#n" of the document: the n-th of the file, whose ids end in that number. */
function session(number: number): VaultSession {
  const found = vault.sessions.find(
    (candidate) => candidate.id === `5e550000-0000-4000-8000-00000000000${number}`,
  );
  if (found === undefined) throw new Error(`no session #${number}`);
  return found;
}

const UTC = { timeZone: "UTC" };

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function sha256(text: string): string {
  return createHash("sha256").update(utf8(text)).digest("hex");
}

/** A pack as the document prints it: the block after `heading`, with the final line feed 9.3 states. */
function printedPack(heading: string): string {
  const start = DATA_MODEL.indexOf(heading);
  const open = DATA_MODEL.indexOf("~~~~text\n", start);
  const close = DATA_MODEL.indexOf("\n~~~~\n", open);
  if (start === -1 || open === -1 || close === -1)
    throw new Error(`data-model.md has no block for ${heading}`);
  return `${DATA_MODEL.slice(open + "~~~~text\n".length, close)}\n`;
}

// data-model.md 9.3, the table: session, UTF-8 bytes, SHA-256.
const DOCUMENTED: readonly (readonly [number, number, string])[] = [
  [1, 704, "9e619a00239c79842a8ed1ea12203cf0b8cbaf8e4d1939d9034f8ac7d665b4a0"],
  [3, 776, "3940de97f9cb42468d1beded41c6992c10953f570b6ec7fe120934784de04e8a"],
  [4, 285, "63880d59e0e74ba1952b1b3e2dd0c9a33ffecaa4bd94ce398969453650b0daef"],
  [5, 507, "cdc4e104c6dcaf5f7b4c82f1da437557640a1a57df5bcd2f7e5f1d443f98684c"],
];

describe("9.3: the context packs of the example sessions, with timeZone UTC", () => {
  it.each(DOCUMENTED)("pack #%i has %i UTF-8 bytes and the documented SHA-256", (number, bytes, hash) => {
    const pack = sessionContextPack(session(number), UTC);
    expect(utf8(pack).length).toBe(bytes);
    expect(sha256(pack)).toBe(hash);
    // The same through the function of 8.3 itself, with the messages handed over separately.
    const stored = session(number);
    expect(contextPackMarkdown(stored, stored.messages, UTC)).toBe(pack);
  });

  it("the document still states exactly these figures", () => {
    const rows = [...DATA_MODEL.matchAll(/^\| #([0-9]) \| ([0-9]+) \| `([0-9a-f]{64})` \|$/gm)].map((row) => [
      Number(row[1]),
      Number(row[2]),
      row[3],
    ]);
    expect(rows).toEqual(DOCUMENTED.map((row) => [...row]));
  });

  it("pack #1 is the text the document prints: every optional part, all four role labels", () => {
    const pack = sessionContextPack(session(1), UTC);
    expect(pack).toBe(printedPack("Pack #1 ("));
    for (const label of ["**User:**", "**Assistant:**", "**System:**", "**Note:**"])
      expect(pack).toContain(label);
    expect(pack).toContain("Origin: ChatGPT (example-model-1), saved Mar 14, 2026\n");
  });

  it("pack #4 is the text the document prints: nothing optional, no messages, the last line is '## Transcript'", () => {
    const pack = sessionContextPack(session(4), UTC);
    expect(pack).toBe(printedPack("Pack #4 ("));
    expect(pack.endsWith("\n## Transcript\n")).toBe(true);
    expect(pack).toContain("Origin: Other, saved Jan 5, 2026\n");
  });

  it("pack #5 is the text the document prints: unknown provider Other, unknown role Note, the unknown segment left out", () => {
    const pack = sessionContextPack(session(5), UTC);
    expect(pack).toBe(printedPack("Pack #5 ("));
    expect(session(5).provider).toBe("examplebot");
    expect(session(5).messages.map((message) => message.role)).toEqual(["user", "tool", "assistant"]);
    // The x_table segment of the last message is stored and is not part of the pack.
    expect(session(5).messages[2]?.segments?.map((segment) => segment.type)).toEqual(["text", "x_table"]);
    expect(pack).not.toContain("x_table");
    expect(pack).not.toContain("carrot\n");
  });

  it("in pack #3 the third turn is the two text segments joined by an empty line", () => {
    const pack = sessionContextPack(session(3), UTC);
    expect(pack).toContain(
      "**User:**\n\nHere is a photo of the jar after six hours.\n\nIs it ready?\n\n---\n",
    );
    // The attachment between the two texts leaves no trace.
    expect(session(3).messages[2]?.segments?.map((segment) => segment.type)).toEqual([
      "text",
      "attachment",
      "text",
    ]);
    expect(pack).not.toContain("a0a4337e");
  });

  it("every pack ends with exactly one line feed after its last line", () => {
    for (const number of [1, 2, 3, 4, 5, 6]) {
      const pack = sessionContextPack(session(number), UTC);
      expect(pack.endsWith("\n")).toBe(true);
      expect(pack.endsWith("\n\n")).toBe(false);
      expect(pack.endsWith(session(number).messages.length === 0 ? "## Transcript\n" : "\n---\n")).toBe(true);
    }
  });

  it("packs #2 and #6, which the document does not list: values of this implementation, kept against change", () => {
    // Not contract figures. They are produced by the same code as the four documented packs.
    const two = sessionContextPack(session(2), UTC);
    expect(utf8(two).length).toBe(542);
    expect(sha256(two)).toBe("180313c5cf33edbde108f54c22b83e22eaf16dc6a591626b1d81324ce335c4f1");
    const six = sessionContextPack(session(6), UTC);
    expect(utf8(six).length).toBe(470);
    expect(sha256(six)).toBe("0b3fbdb197d9b3862cba3aaaa9afcdcc5c4809e631c17bdbe704b9da61b03133");
    // #6 has a non-ASCII title: the pack is longer in bytes than in UTF-16 units.
    expect(six.length).toBe(467);
    expect(
      six.startsWith("# Context pack: Caf\u{E9} menu translation\n\nOrigin: Claude, saved Dec 31, 2025\n"),
    ).toBe(true);
  });
});

describe("a fifth golden pack: the input of import fixture 38", () => {
  // The fixture input is a pack as ContextPack.swift writes it. Imported and stored with the date
  // it names, the session must give back the same bytes.
  const FIXTURE = readFileSync(new URL("fixtures/import/38-paste-context-pack.input.md", WEB));
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(FIXTURE);

  it("is reproduced byte for byte from the session the importer makes of it", () => {
    const imported = importPaste(text, { title: "Pasted session", pickerProvider: "claude" });
    expect(imported.outcome).toBe("imported");
    const parsed = imported.sessions[0];
    if (parsed === undefined) throw new Error("fixture 38 gave no session");
    let n = 0;
    const stored = createSession(parsed, {
      now: new Date("2026-08-05T12:00:00.000Z"),
      newId: () => `eeeeeeee-eeee-4eee-8eee-${String(++n).padStart(12, "0")}`,
    });
    const pack = sessionContextPack(stored, UTC);
    expect(pack).toBe(text);
    expect(Buffer.from(utf8(pack)).equals(FIXTURE)).toBe(true);
    expect(pack).toContain("Origin: Gemini (gemini-example-model), saved Aug 5, 2026\n");
  });
});

// A session with every optional part, for the rules below.
const FULL: ContextPackSession = {
  title: "Compost bin plan",
  provider: "claude",
  model: "example-model-9",
  source_url: "https://share.example/EXAMPLE-0009",
  summary: "Three bays.\nTurn weekly.",
  tags: ["garden", "two words"],
  created_at: new Date("2026-03-14T09:30:00.000Z"),
};
const BARE: ContextPackSession = { ...FULL, model: "", source_url: "", summary: "", tags: [] };
const TURNS: readonly ContextPackMessage[] = [
  { role: "user", text: "How many bays?" },
  { role: "assistant", text: "Three." },
];

const PREAMBLE =
  "You are being given the transcript of an earlier conversation the user had\n" +
  "with another AI assistant. Read it, treat its decisions and facts as established\n" +
  "context, and continue helping from where it left off.\n";

describe("4.1 and 8.3: the template", () => {
  it("prints every part in the documented order", () => {
    expect(contextPackMarkdown(FULL, TURNS, UTC)).toBe(
      "# Context pack: Compost bin plan\n" +
        "\n" +
        "Origin: Claude (example-model-9), saved Mar 14, 2026\n" +
        "Source: https://share.example/EXAMPLE-0009\n" +
        "Tags: garden, two words\n" +
        "\n" +
        "## Summary\n" +
        "\n" +
        "Three bays.\nTurn weekly.\n" +
        "\n" +
        PREAMBLE +
        "\n" +
        "## Transcript\n" +
        "\n" +
        "**User:**\n\nHow many bays?\n\n---\n" +
        "\n" +
        "**Assistant:**\n\nThree.\n\n---\n",
    );
  });

  it("leaves out the model, the Source line, the Tags line and the four summary lines when they are empty", () => {
    expect(contextPackMarkdown(BARE, [], UTC)).toBe(
      `# Context pack: Compost bin plan\n\nOrigin: Claude, saved Mar 14, 2026\n\n${PREAMBLE}\n## Transcript\n`,
    );
  });

  it.each([
    ["model", { model: "m-1" }, "Origin: Claude (m-1), saved Mar 14, 2026\n\nYou are"],
    ["source_url", { source_url: "x" }, "saved Mar 14, 2026\nSource: x\n\nYou are"],
    ["tags", { tags: ["a"] }, "saved Mar 14, 2026\nTags: a\n\nYou are"],
    ["summary", { summary: "s" }, "saved Mar 14, 2026\n\n## Summary\n\ns\n\nYou are"],
  ])("each optional part appears alone when only %s is set", (_name, part, expected) => {
    expect(contextPackMarkdown({ ...BARE, ...part }, [], UTC)).toContain(expected);
  });

  it("a pack with messages is the pack without them plus one block for each message", () => {
    const head = contextPackMarkdown(FULL, [], UTC);
    const block = (label: string, text: string): string => `\n**${label}:**\n\n${text}\n\n---\n`;
    expect(contextPackMarkdown(FULL, TURNS, UTC)).toBe(
      head + block("User", "How many bays?") + block("Assistant", "Three."),
    );
  });

  it.each([
    ["claude", "Claude"],
    ["chatgpt", "ChatGPT"],
    ["gemini", "Gemini"],
    ["other", "Other"],
    ["examplebot", "Other"],
    ["", "Other"],
    // 8.3 matches the provider trimmed and without regard to case.
    ["Claude", "Claude"],
    ["  CHATGPT\n", "ChatGPT"],
    ["\u{A0}Gemini\u{2028}", "Gemini"],
    // Names of built-in properties are ordinary unknown providers.
    ["constructor", "Other"],
    ["__proto__", "Other"],
    ["toString", "Other"],
    // Only ASCII letters fold onto the known names.
    ["\u{FF43}\u{FF4C}\u{FF41}\u{FF55}\u{FF44}\u{FF45}", "Other"],
    ["claude ai", "Other"],
  ])("provider %j prints as %s", (provider, label) => {
    expect(contextPackMarkdown({ ...BARE, provider }, [], UTC)).toContain(`\nOrigin: ${label}, saved `);
  });

  it.each([
    ["user", "User"],
    ["assistant", "Assistant"],
    ["system", "System"],
    ["unknown", "Note"],
    ["tool", "Note"],
    ["", "Note"],
    // Roles are matched exactly: the reader stores known roles in lower case.
    ["User", "Note"],
    ["ASSISTANT", "Note"],
    [" user", "Note"],
    ["constructor", "Note"],
    ["__proto__", "Note"],
    ["hasOwnProperty", "Note"],
  ])("role %j prints as %s", (role, label) => {
    expect(contextPackMarkdown(BARE, [{ role, text: "t" }], UTC)).toContain(`\n**${label}:**\n\nt\n\n---\n`);
  });

  it("prints every message, also one whose text is empty", () => {
    const pack = contextPackMarkdown(
      BARE,
      [
        { role: "user", text: "" },
        { role: "assistant", text: "a" },
      ],
      UTC,
    );
    expect(pack.endsWith("## Transcript\n\n**User:**\n\n\n\n---\n\n**Assistant:**\n\na\n\n---\n")).toBe(true);
  });

  it("inserts title, model, link, tags, summary and message text unchanged: nothing is escaped or trimmed", () => {
    const odd = "  $& $1 $$ \\n <b>*x*</b> `code` ---\n**User:**\n\n---\n\t";
    const pack = contextPackMarkdown(
      { ...FULL, title: odd, model: odd, source_url: odd, summary: odd, tags: [odd, "b"] },
      [{ role: "user", text: odd }],
      UTC,
    );
    expect(pack).toBe(
      `# Context pack: ${odd}\n\nOrigin: Claude (${odd}), saved Mar 14, 2026\nSource: ${odd}\nTags: ${odd}, b\n\n` +
        `## Summary\n\n${odd}\n\n${PREAMBLE}\n## Transcript\n\n**User:**\n\n${odd}\n\n---\n`,
    );
  });

  it("an empty title leaves the heading with its trailing space (B10 is a matter of display)", () => {
    expect(
      contextPackMarkdown({ ...BARE, title: "" }, [], UTC).startsWith("# Context pack: \n\nOrigin:"),
    ).toBe(true);
  });

  it("does not change what it is given", () => {
    const frozenSession = Object.freeze({ ...FULL, tags: Object.freeze([...FULL.tags]) });
    const frozenTurns = Object.freeze(TURNS.map((turn) => Object.freeze({ ...turn })));
    expect(contextPackMarkdown(frozenSession, frozenTurns, Object.freeze({ timeZone: "UTC" }))).toBe(
      contextPackMarkdown(FULL, TURNS, UTC),
    );
  });
});

describe("B6: the date is the original date, in a fixed form and in the zone that is passed", () => {
  const at = (iso: string, timeZone: string): string => {
    const pack = contextPackMarkdown({ ...BARE, created_at: new Date(iso) }, [], { timeZone });
    const line = pack.split("\n")[2] ?? "";
    return line.slice("Origin: Claude, saved ".length);
  };

  it.each([
    // The instant of example session #6, at the end of a year.
    ["2025-12-31T23:59:59.000Z", "UTC", "Dec 31, 2025"],
    ["2025-12-31T23:59:59.000Z", "Europe/Berlin", "Jan 1, 2026"],
    ["2025-12-31T23:59:59.000Z", "Pacific/Honolulu", "Dec 31, 2025"],
    ["2025-12-31T23:59:59.000Z", "Pacific/Auckland", "Jan 1, 2026"],
    // The instant of example session #5, at the end of a month.
    ["2026-10-31T23:30:00.000Z", "UTC", "Oct 31, 2026"],
    ["2026-10-31T23:30:00.000Z", "Europe/Berlin", "Nov 1, 2026"],
    ["2026-10-31T23:30:00.000Z", "America/New_York", "Oct 31, 2026"],
    // A leap day, a single-digit day, and the first and last months.
    ["2024-02-29T12:00:00.000Z", "UTC", "Feb 29, 2024"],
    ["2026-01-05T12:00:00.000Z", "UTC", "Jan 5, 2026"],
    ["2026-09-09T00:00:00.000Z", "UTC", "Sep 9, 2026"],
    ["2026-05-01T00:00:00.000Z", "UTC", "May 1, 2026"],
    ["2026-12-25T00:00:00.000Z", "UTC", "Dec 25, 2026"],
    // The zone with the largest offset, and the epoch seen from the west.
    ["2026-06-30T10:00:00.000Z", "Pacific/Kiritimati", "Jul 1, 2026"],
    ["1970-01-01T00:00:00.000Z", "America/Los_Angeles", "Dec 31, 1969"],
    // The last instant an interchange timestamp can express.
    ["9999-12-31T23:59:59.999Z", "UTC", "Dec 31, 9999"],
  ])("%s in %s is 'saved %s'", (iso, timeZone, expected) => {
    expect(at(iso, timeZone)).toBe(expected);
  });

  it("uses the Gregorian calendar and Latin digits of en-US, whatever the machine prefers", () => {
    const options = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).resolvedOptions();
    expect([options.locale, options.calendar, options.numberingSystem]).toEqual(["en-US", "gregory", "latn"]);
  });

  it("gives the documented bytes on a machine whose own locale and time zone are different", () => {
    // A second process with a French locale in the zone furthest ahead of UTC.
    const script = `
      import { createHash } from "node:crypto";
      import { readFileSync } from "node:fs";
      const interchange = await import(${JSON.stringify(new URL("core/src/interchange/index.ts", WEB).href)});
      const vault = await import(${JSON.stringify(new URL("core/src/vault/index.ts", WEB).href)});
      const text = readFileSync(${JSON.stringify(fileURLToPath(new URL("docs/example-vault-export.json", WEB)))}, "utf8");
      let n = 0;
      const imported = interchange.importDocument(interchange.emptyVault(), text, {
        now: new Date(0),
        newId: () => "ffffffff-ffff-4fff-8fff-" + String(++n).padStart(12, "0"),
      });
      const hashes = {};
      for (const session of imported.vault.sessions) {
        const pack = vault.sessionContextPack(session, { timeZone: "UTC" });
        hashes[session.id.slice(-1)] = createHash("sha256").update(pack, "utf8").digest("hex");
      }
      const own = new Intl.DateTimeFormat().resolvedOptions();
      const local = new Date(Date.UTC(2026, 0, 1, 12)).getDate();
      console.log(JSON.stringify({ locale: own.locale, timeZone: own.timeZone, local, hashes }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      env: { ...process.env, TZ: "Pacific/Kiritimati", LC_ALL: "fr_FR.UTF-8", LANG: "fr_FR.UTF-8" },
    });
    const result: unknown = JSON.parse(output);
    expect(result).toMatchObject({
      // The other process really lives elsewhere: noon of 1 January in UTC is 2 January there.
      locale: "fr-FR",
      timeZone: "Pacific/Kiritimati",
      local: 2,
      hashes: Object.fromEntries(DOCUMENTED.map(([number, , hash]) => [String(number), hash])),
    });
  }, 60_000);
});

describe("what the builder refuses", () => {
  it("a time zone that does not exist: RangeError", () => {
    expect(() => contextPackMarkdown(BARE, [], { timeZone: "Not/AZone" })).toThrow(RangeError);
    expect(() => contextPackMarkdown(BARE, [], { timeZone: "" })).toThrow(RangeError);
  });

  it("no time zone at all: TypeError, never the zone of the machine", () => {
    expect(() => Reflect.apply(contextPackMarkdown, undefined, [BARE, [], {}])).toThrow(TypeError);
    expect(() => Reflect.apply(contextPackMarkdown, undefined, [BARE, [], { timeZone: undefined }])).toThrow(
      TypeError,
    );
    expect(() => Reflect.apply(contextPackMarkdown, undefined, [BARE, [], { timeZone: null }])).toThrow(
      TypeError,
    );
  });

  it("a date that holds no instant: RangeError", () => {
    expect(() => contextPackMarkdown({ ...BARE, created_at: new Date(Number.NaN) }, [], UTC)).toThrow(
      RangeError,
    );
  });
});

describe("very long transcripts: no limit, no truncation (4.1)", () => {
  // 1,000,000 characters, and 4,000,000 UTF-8 bytes in 2,000,000 UTF-16 units (data-model.md 7.4, 9.4).
  const million = `${"0123456789".repeat(99_999)}123456789\n`;
  const fourMegabytes = "\u{1F600}".repeat(1_000_000);
  const small = Array.from({ length: 20_000 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `turn ${index}`,
  }));
  const messages: readonly ContextPackMessage[] = [
    { role: "unknown", text: million },
    ...small,
    { role: "assistant", text: fourMegabytes },
  ];
  const label = (role: string): string =>
    role === "user" ? "User" : role === "assistant" ? "Assistant" : role === "system" ? "System" : "Note";

  it("the sizes are what the test means them to be", () => {
    expect(million.length).toBe(1_000_000);
    expect(fourMegabytes.length).toBe(2_000_000);
    expect(utf8(fourMegabytes).length).toBe(4_000_000);
  });

  it("the pack holds every message whole, in order, and is built in linear time", () => {
    const started = performance.now();
    const pack = contextPackMarkdown(FULL, messages, UTC);
    const elapsed = performance.now() - started;
    const expected =
      contextPackMarkdown(FULL, [], UTC) +
      messages.map((message) => `\n**${label(message.role)}:**\n\n${message.text}\n\n---\n`).join("");
    expect(pack.length).toBe(expected.length);
    expect(pack === expected).toBe(true);
    expect(pack.endsWith(`\n\n${fourMegabytes}\n\n---\n`)).toBe(true);
    // Milliseconds on any machine; the bound only catches an accidental quadratic step.
    expect(elapsed).toBeLessThan(5_000);
  });

  it("twice the messages take about twice the size, not more", () => {
    const once = contextPackMarkdown(BARE, small, UTC).length;
    const twice = contextPackMarkdown(BARE, [...small, ...small], UTC).length;
    const head = contextPackMarkdown(BARE, [], UTC).length;
    expect(twice - head).toBe(2 * (once - head));
  });

  it("a stored session with such messages gives the same pack through sessionContextPack", () => {
    let n = 0;
    const stored = createSession(
      {
        title: "Long",
        provider: "other",
        model: "",
        sourceUrl: "",
        createdAt: "2026-03-14T09:30:00.000Z",
        summary: "",
        tags: [],
        messages: [
          { role: "user", text: million.trimEnd() },
          { role: "assistant", text: fourMegabytes },
        ],
      },
      {
        now: new Date("2026-11-20T08:00:00.000Z"),
        newId: () => `dddddddd-dddd-4ddd-8ddd-${String(++n).padStart(12, "0")}`,
      },
    );
    expect(stored.text_bytes).toBe(999_999 + 4_000_000);
    const pack = sessionContextPack(stored, UTC);
    expect(
      pack.endsWith(
        `\n**User:**\n\n${million.trimEnd()}\n\n---\n\n**Assistant:**\n\n${fourMegabytes}\n\n---\n`,
      ),
    ).toBe(true);
    expect(utf8(pack).length).toBeGreaterThan(stored.text_bytes);
  });
});

describe("sessionContextPack", () => {
  it("prints the messages by position, whatever order the array has", () => {
    const stored = session(1);
    const shuffled = { ...stored, messages: [...stored.messages].reverse() };
    expect(sessionContextPack(shuffled, UTC)).toBe(sessionContextPack(stored, UTC));
    expect(shuffled.messages[0]?.position).toBe(3);
  });

  it("keeps the order of messages that share a position, as the export does", () => {
    const pack = sessionContextPack(
      {
        ...BARE,
        messages: [
          { role: "user", text: "first", position: 0 },
          { role: "user", text: "second", position: 0 },
        ],
      },
      UTC,
    );
    expect(pack.indexOf("first")).toBeLessThan(pack.indexOf("second"));
  });

  it("does not change the session or its message list", () => {
    const stored = session(3);
    const before = stored.messages.map((message) => message.id);
    sessionContextPack(stored, UTC);
    expect(stored.messages.map((message) => message.id)).toEqual(before);
  });
});
