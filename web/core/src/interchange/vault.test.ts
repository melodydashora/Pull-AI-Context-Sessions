/// <reference types="node" />
// The vault model and the small rules around it: the flattened text (data-model.md 6.3), the open
// lists (6.2), the two functions of section 8 this module carries, the bundle layout and the file
// names of 6.4, and the consistency check.
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  attachmentKindBehaviour,
  checkVault,
  classifyBundleEntry,
  emptyVault,
  exportDocument,
  FALLBACK_ATTACHMENT_KIND,
  FALLBACK_PROVIDER,
  FALLBACK_ROLE,
  fileSystemSafe,
  flattenText,
  type InterchangeSegment,
  importDocument,
  isAttachmentSegment,
  isPlainText,
  isTextSegment,
  KNOWN_ATTACHMENT_KINDS,
  KNOWN_PROVIDERS,
  KNOWN_ROLES,
  KNOWN_SEGMENT_TYPES,
  makeSession,
  messageSegments,
  normaliseTags,
  parseTags,
  projectNameKey,
  providerBehaviour,
  readDocument,
  roleBehaviour,
  segmentBehaviour,
  segmentedMessage,
  splitDocument,
  suggestedFileName,
  textMessage,
  textSegment,
  utf8ByteLength,
  type Vault,
  type VaultSession,
  validateDocument,
  webGenerator,
} from "./index.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const EXAMPLE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(
  readFileSync(new URL("../../../docs/example-vault-export.json", import.meta.url)),
);
const NOW = new Date("2026-11-20T08:00:00.000Z");
const importContext = () => ({ now: NOW, newId: () => "ffffffff-ffff-4fff-8fff-ffffffffffff" });

const T1 = new Date("2026-05-01T10:00:00.000Z");
const ID = "5e550000-0000-4000-8000-000000000001";
const MESSAGE = "0e550001-0000-4000-8000-000000000000";
const SHA = "a0a4337e393b5dcba561013018a5261d56c20d164d4fa0be4b31456b211a3fd7";

describe("the flattened text (6.3)", () => {
  // The function exactly as the document gives it.
  const reference = (segments: { type: string; text?: string }[]): string =>
    segments
      .filter((s) => s.type === "text")
      .map((s) => s.text ?? "")
      .join("\n\n");

  it("joins the text segments with an empty line and leaves everything else out", () => {
    const segments: InterchangeSegment[] = [
      { type: "text", text: "Here is a photo of the jar after six hours." },
      { type: "attachment", sha256: SHA },
      { type: "text", text: "Is it ready?" },
      { type: "x_table", text: "not a text segment", rows: [] },
    ];
    expect(flattenText(segments)).toBe("Here is a photo of the jar after six hours.\n\nIs it ready?");
  });

  it("handles the edges: nothing, empty text, only other segments", () => {
    expect(flattenText([])).toBe("");
    expect(flattenText([{ type: "text", text: "" }])).toBe("");
    expect(flattenText([{ type: "attachment", sha256: SHA }])).toBe("");
    expect(
      flattenText([
        { type: "text", text: "" },
        { type: "x", a: 1 },
        { type: "text", text: "" },
      ]),
    ).toBe("\n\n");
    // A text segment without a usable text counts as empty, as `s.text ?? ""` does.
    expect(flattenText([{ type: "text" }, { type: "text", text: "b" }])).toBe("\n\nb");
  });

  it("equals the function of the document on every list of segments", () => {
    const segment = fc.oneof(
      fc.record({ type: fc.constant("text"), text: fc.string() }),
      fc.record({ type: fc.constant("attachment"), sha256: fc.constant(SHA) }),
      fc.record({ type: fc.constantFrom("x_tool", "TEXT", "Text"), text: fc.string() }),
    );
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 8 }), (segments) => {
        expect(flattenText(segments)).toBe(reference(segments));
      }),
      { numRuns: 500 },
    );
  });

  it("tells the two known segment types from the rest", () => {
    const text: InterchangeSegment = { type: "text", text: "t" };
    const attachment: InterchangeSegment = { type: "attachment", sha256: SHA };
    const other: InterchangeSegment = { type: "tool_use", text: "t", sha256: SHA };
    expect([text, attachment, other].map(isTextSegment)).toEqual([true, false, false]);
    expect([text, attachment, other].map(isAttachmentSegment)).toEqual([false, true, false]);
    expect([text, attachment, other].map((s) => segmentBehaviour(s.type))).toEqual([
      "text",
      "attachment",
      "opaque",
    ]);
    expect(isTextSegment({ type: "text", text: 5 })).toBe(false);
    expect(isAttachmentSegment({ type: "attachment" })).toBe(false);
  });
});

describe("the open lists and their fallback (6.2)", () => {
  it("lists the known values of the document", () => {
    expect(KNOWN_PROVIDERS).toEqual(["claude", "chatgpt", "gemini", "other"]);
    expect(KNOWN_ROLES).toEqual(["user", "assistant", "system", "unknown"]);
    expect(KNOWN_ATTACHMENT_KINDS).toEqual(["original_pdf", "image", "file", "other"]);
    expect(KNOWN_SEGMENT_TYPES).toEqual(["text", "attachment"]);
    expect([FALLBACK_PROVIDER, FALLBACK_ROLE, FALLBACK_ATTACHMENT_KIND]).toEqual([
      "other",
      "unknown",
      "other",
    ]);
  });

  it("a provider behaves as a known one when it is one, trimmed and without case; otherwise as other", () => {
    for (const provider of KNOWN_PROVIDERS) expect(providerBehaviour(provider)).toBe(provider);
    // As the context pack of 8.3 looks a provider up.
    expect(providerBehaviour("Claude")).toBe("claude");
    expect(providerBehaviour(" ChatGPT ")).toBe("chatgpt");
    expect(providerBehaviour("examplebot")).toBe("other");
    expect(providerBehaviour("Grok")).toBe("other");
    expect(providerBehaviour("")).toBe("other");
  });

  it("a role behaves as a known one only when written exactly; otherwise as unknown", () => {
    for (const role of KNOWN_ROLES) expect(roleBehaviour(role)).toBe(role);
    // As the Apple model reads roleRaw (2.3): "User" is not "user".
    expect(roleBehaviour("User")).toBe("unknown");
    expect(roleBehaviour("tool")).toBe("unknown");
    expect(roleBehaviour("")).toBe("unknown");
  });

  it("names that every object has do not count as known values", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(providerBehaviour(name)).toBe("other");
      expect(roleBehaviour(name)).toBe("unknown");
      expect(attachmentKindBehaviour(name)).toBe("other");
      expect(segmentBehaviour(name)).toBe("opaque");
    }
  });

  it("an attachment kind behaves as a known one when written exactly; otherwise as other", () => {
    for (const kind of KNOWN_ATTACHMENT_KINDS) expect(attachmentKindBehaviour(kind)).toBe(kind);
    expect(attachmentKindBehaviour("Original_PDF")).toBe("other");
    expect(attachmentKindBehaviour("x_recording")).toBe("other");
  });
});

describe("parseTags (8.2)", () => {
  it("gives the documented results", () => {
    // 3.2 with the two deliberate changes of 8.2: the leading # goes, repeats go.
    expect(parseTags("Garden, Bikes ,, garden,  Two Words , #hash")).toEqual([
      "garden",
      "bikes",
      "two words",
      "hash",
    ]);
    expect(parseTags("a;b")).toEqual(["a;b"]);
    expect(parseTags("UPPER,upper,Upper")).toEqual(["upper"]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags(" , ,, ")).toEqual([]);
    expect(parseTags("##double, # spaced, c#")).toEqual(["double", "spaced", "c#"]);
    expect(parseTags("tag")).toEqual(["tag"]);
  });

  it("is the function of the document with the formula of corrections.md 2, point 1, character for character", () => {
    // data-model.md 8.2 as printed, with the one expression that point 1 replaces.
    const reference = (input: string): string[] => {
      const out: string[] = [];
      for (const part of input.split(",")) {
        const tag = part
          .trim()
          .toLowerCase()
          .replace(/^[#\s]+/, "")
          .trim();
        if (tag !== "" && !out.includes(tag)) out.push(tag);
      }
      return out;
    };
    const unit = fc.constantFrom(..."ab#, \tA\u00C9\u00A0\n");
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 30 }), (input) => {
        expect(parseTags(input)).toEqual(reference(input));
      }),
      { numRuns: 1000 },
    );
  });
});

describe("normaliseTags (6.6 repair 4)", () => {
  /** parseTags applied to every tag again and again until nothing changes. */
  const untilStable = (elements: readonly string[]): string[] => {
    let tags = [...new Set(elements.flatMap((element) => parseTags(element)))];
    for (let round = 0; round < 100; round++) {
      const next = [...new Set(tags.flatMap((tag) => parseTags(tag)))];
      if (next.length === tags.length && next.every((tag, i) => tag === tags[i])) return next;
      tags = next;
    }
    throw new Error("parseTags did not settle");
  };

  it("applies parseTags to each element", () => {
    expect(normaliseTags(["Garden", " Bikes ", "", "garden", "#hash", "a,b"])).toEqual([
      "garden",
      "bikes",
      "hash",
      "a",
      "b",
    ]);
    expect(normaliseTags([])).toEqual([]);
    expect(normaliseTags(["two words"])).toEqual(["two words"]);
  });

  it("needs one application only: parseTags is idempotent (corrections.md 2, point 1)", () => {
    // As printed in 8.2, "# #a" gave "#a" and the next reading "a".
    expect(parseTags("# #a")).toEqual(["a"]);
    expect(normaliseTags(["# #a"])).toEqual(["a"]);
    expect(normaliseTags(["#\t# # b#", "# #"])).toEqual(["b#"]);
  });

  it("is what repeating parseTags until it settles gives, and settles in one go", () => {
    const unit = fc.constantFrom(..."ab#, \tA\u00C9\u00A0\n");
    fc.assert(
      fc.property(fc.array(fc.string({ unit, maxLength: 16 }), { maxLength: 5 }), (elements) => {
        const tags = normaliseTags(elements);
        // Repair 4 as corrections.md words it.
        expect(tags).toEqual(parseTags(elements.join(",")));
        expect(tags).toEqual(untilStable(elements));
        expect(normaliseTags(tags)).toEqual(tags);
        for (const tag of tags) {
          expect(parseTags(tag)).toEqual([tag]);
          expect(tag).toBe(tag.trim());
          expect(tag).toBe(tag.toLowerCase());
          expect(tag).not.toContain(",");
        }
        expect(new Set(tags).size).toBe(tags.length);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("projectNameKey (8.4)", () => {
  it("trims, composes and lower-cases", () => {
    expect(projectNameKey("  Garden ")).toBe("garden");
    expect(projectNameKey("GARDEN")).toBe("garden");
    expect(projectNameKey("Cafe\u0301")).toBe("caf\u00E9");
    expect(projectNameKey("CAF\u00C9")).toBe("caf\u00E9");
    expect(projectNameKey("apple pie ideas")).toBe("apple pie ideas");
    expect(projectNameKey("10 things")).not.toBe(projectNameKey("2 things"));
  });
});

describe("the bundle layout (6.4)", () => {
  it("knows exactly three shapes of entry names", () => {
    expect(classifyBundleEntry("vault.json")).toEqual({ kind: "vault" });
    expect(classifyBundleEntry(`sessions/${ID}.json`)).toEqual({ kind: "session", id: ID });
    expect(classifyBundleEntry(`blobs/${SHA}`)).toEqual({ kind: "blob", sha256: SHA });
  });

  it("ignores every other entry", () => {
    for (const name of [
      "",
      "Vault.json",
      "./vault.json",
      "/vault.json",
      "vault.json/",
      "dir/vault.json",
      "sessions/",
      "sessions/.json",
      `sessions/${ID}`,
      `sessions/${ID.toUpperCase()}.json`,
      `sessions/${ID}.JSON`,
      `sessions/../${ID}.json`,
      `sessions/${ID}.json/x`,
      `sessions/sub/${ID}.json`,
      `sessions\\${ID}.json`,
      `blobs/${SHA}.pdf`,
      `blobs/${SHA.toUpperCase()}`,
      `blobs/${SHA.slice(1)}`,
      `blobs/${SHA}/`,
      `blobs/../blobs/${SHA}`,
      "blobs/",
      "__MACOSX/vault.json",
      "../../etc/passwd",
      `blobs/${SHA}\u0000`,
    ]) {
      expect(classifyBundleEntry(name), JSON.stringify(name)).toBeNull();
    }
  });

  it("never throws and never accepts a name with a path trick in it", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom("vault.json", `sessions/${ID}.json`, `blobs/${SHA}`)),
        (name) => {
          const entry = classifyBundleEntry(name);
          if (entry !== null)
            expect(name).toMatch(/^(vault\.json|sessions\/[0-9a-f-]{36}\.json|blobs\/[0-9a-f]{64})$/);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("a document as the documents of a bundle (6.4)", () => {
  const read = readDocument(EXAMPLE_TEXT);
  if (!read.ok) throw new Error("the example must read");
  const parts = splitDocument(read.doc);

  it("gives one vault document with every project and no session", () => {
    expect(parts.vault.kind).toBe("vault");
    expect(parts.vault.projects).toEqual(read.doc.projects);
    expect(parts.vault.sessions).toEqual([]);
    expect(parts.vault.exported_at).toBe(read.doc.exported_at);
    expect(parts.vault.generator).toEqual(read.doc.generator);
    expect(validateDocument(parts.vault).ok).toBe(true);
  });

  it("gives one session document per session, each with its own project", () => {
    expect(parts.sessions.length).toBe(6);
    parts.sessions.forEach((part, i) => {
      const session = read.doc.sessions[i];
      expect(part.kind).toBe("session");
      expect(part.sessions).toEqual([session]);
      expect(part.projects.map((project) => project.id)).toEqual(
        session?.project_id == null ? [] : [session.project_id],
      );
      expect(validateDocument(part)).toMatchObject({ ok: true, problems: { total: 0 } });
      // The first session with its project is the valid session document 6.1 speaks of.
      expect(Object.keys(part)).toEqual(Object.keys(read.doc));
    });
  });

  it("imported in that order, the parts give what the whole document gives", () => {
    const whole = importDocument(emptyVault(), read.doc, importContext());
    let vault = emptyVault();
    for (const part of [parts.vault, ...parts.sessions]) {
      const next = importDocument(vault, part, importContext());
      if (!next.ok) throw new Error("a part must import");
      vault = next.vault;
    }
    expect(whole.ok && whole.vault).toEqual(vault);
  });

  it("splits a session document into the same two kinds of part", () => {
    const single = parts.sessions[0];
    if (single === undefined) throw new Error("no part");
    const again = splitDocument(single);
    expect(again.vault.kind).toBe("vault");
    expect(again.vault.projects.length).toBe(1);
    expect(again.sessions).toEqual([single]);
  });
});

describe("suggested file names (6.4)", () => {
  const read = readDocument(EXAMPLE_TEXT);
  if (!read.ok) throw new Error("the example must read");

  it("a vault document is named after the time of its export", () => {
    expect(suggestedFileName(read.doc)).toBe("sessionvault-vault-20261119-120000.json");
    const exported = exportDocument(
      emptyVault(),
      { kind: "vault" },
      { now: new Date("2027-01-02T03:04:05.678Z"), generator: webGenerator("1") },
      { includeBytes: false },
    );
    expect(exported.ok && suggestedFileName(exported.doc)).toBe("sessionvault-vault-20270102-030405.json");
  });

  it("a session document is named after its title", () => {
    const names = splitDocument(read.doc).sessions.map(suggestedFileName);
    expect(names).toEqual([
      "Truing a bicycle wheel.session.json",
      "Tomato blight on the balcony.session.json",
      "Sourdough starter schedule.session.json",
      "Untitled.session.json",
      "Seed order comparison.session.json",
      "Caf\u00E9 menu translation.session.json",
    ]);
  });

  it("makes a title safe for file systems (5.1 B15)", () => {
    expect(fileSystemSafe('a\\b/c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(fileSystemSafe("tab\there\nand\u0000there\u007F\u0085")).toBe("tab-here-and-there--");
    expect(fileSystemSafe("ends with dots... ")).toBe("ends with dots");
    expect(fileSystemSafe(" loses leading space")).toBe("loses leading space");
    expect(fileSystemSafe("")).toBe("session");
    expect(fileSystemSafe(" . . ")).toBe("session");
    expect(fileSystemSafe("..")).toBe("session");
    expect(fileSystemSafe("/")).toBe("-");
    expect(fileSystemSafe("caf\u00E9 \u{1F600}")).toBe("caf\u00E9 \u{1F600}");
    expect(fileSystemSafe("lone \uD800 half")).toBe("lone - half");
  });

  it("caps the length without cutting a character in two", () => {
    expect(fileSystemSafe("a".repeat(500))).toBe("a".repeat(120));
    const euros = fileSystemSafe("\u20AC".repeat(100));
    expect(euros).toBe("\u20AC".repeat(40));
    const faces = fileSystemSafe("\u{1F600}".repeat(100));
    expect(faces).toBe("\u{1F600}".repeat(30));
    expect(fileSystemSafe(`${"a".repeat(119)}. tail`)).toBe("a".repeat(119));
  });

  it("never gives a name with a path separator, a control character or more than 120 bytes of title", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: "binary" })), (title) => {
        const safe = fileSystemSafe(title);
        expect(safe.length).toBeGreaterThan(0);
        // 120 bytes, and one more for the "_" in front of a Windows device name (point 16).
        expect(utf8ByteLength(safe)).toBeLessThanOrEqual(safe.startsWith("_") ? 121 : 120);
        for (const character of safe) {
          const code = character.codePointAt(0) ?? 0;
          expect(code >= 0x20 && (code < 0x7f || code > 0x9f)).toBe(true);
          expect('\\/:*?"<>|').not.toContain(character);
          // No half of a surrogate pair is left behind.
          expect(code < 0xd800 || code > 0xdfff).toBe(true);
        }
        expect(safe.endsWith(".") || safe.endsWith(" ")).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("building vault values", () => {
  it("an empty vault has nothing in it", () => {
    const vault = emptyVault();
    expect(vault.projects).toEqual([]);
    expect(vault.sessions).toEqual([]);
    expect(vault.blobs.size).toBe(0);
    expect(emptyVault()).not.toBe(vault);
    expect(checkVault(vault)).toEqual({
      ok: true,
      problems: { items: [], total: 0 },
      warnings: { items: [], total: 0, counts: {} },
    });
  });

  it("a text message is what a transcript importer makes (8.6)", () => {
    const message = textMessage({ id: MESSAGE, position: 0, role: "user", text: "caf\u00E9" });
    expect(message).toEqual({
      id: MESSAGE,
      position: 0,
      role: "user",
      text: "caf\u00E9",
      segments: null,
      text_bytes: 5,
      model: "",
      created_at: null,
      extra: {},
    });
    expect(messageSegments(message)).toEqual([{ type: "text", text: "caf\u00E9" }]);
  });

  it("a message from segments derives its text and stores segments only when they say more", () => {
    const plain = segmentedMessage({
      id: MESSAGE,
      position: 0,
      role: "user",
      segments: [{ type: "text", text: "plain" }],
    });
    expect(plain.segments).toBeNull();
    expect(plain.text).toBe("plain");

    const empty = segmentedMessage({ id: MESSAGE, position: 0, role: "user", segments: [] });
    expect([empty.segments, empty.text, empty.text_bytes]).toEqual([null, "", 0]);
    expect(messageSegments(empty)).toEqual([{ type: "text", text: "" }]);

    const segments: InterchangeSegment[] = [
      { type: "text", text: "Looking at the file." },
      { type: "tool_use", id: "toolu_EXAMPLE", name: "read_file", input: { path: "notes.md" } },
    ];
    const rich = segmentedMessage({
      id: MESSAGE,
      position: 3,
      role: "assistant",
      segments,
      model: "m",
      created_at: T1,
      extra: { x_claude: {} },
    });
    expect(rich.segments).toBe(segments);
    expect(rich.text).toBe("Looking at the file.");
    expect(rich.text_bytes).toBe(20);
    expect(rich).toMatchObject({ position: 3, model: "m", created_at: T1, extra: { x_claude: {} } });

    // A text segment with a property of its own is more than plain text.
    const annotated = segmentedMessage({
      id: MESSAGE,
      position: 0,
      role: "user",
      segments: [{ type: "text", text: "t", x_lang: "en" }],
    });
    expect(annotated.segments).toEqual([{ type: "text", text: "t", x_lang: "en" }]);
    // A message with nothing but a tool result has no text at all.
    const toolOnly = segmentedMessage({
      id: MESSAGE,
      position: 0,
      role: "tool",
      segments: [{ type: "tool_result", content: "42" }],
    });
    expect([toolOnly.text, toolOnly.text_bytes, toolOnly.segments?.length]).toEqual(["", 0, 1]);
  });

  it("isPlainText is true for exactly one text segment with nothing else on it", () => {
    expect(isPlainText([{ type: "text", text: "" }])).toBe(true);
    expect(isPlainText([textSegment("x")])).toBe(true);
    expect(isPlainText([])).toBe(false);
    expect(
      isPlainText([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe(false);
    expect(isPlainText([{ type: "text", text: "a", x: 1 }])).toBe(false);
    expect(isPlainText([{ type: "attachment", sha256: SHA }])).toBe(false);
    expect(isPlainText([{ type: "text" }])).toBe(false);
  });

  it("a session takes the defaults of 8.6 and derives its counts", () => {
    const messages = [
      textMessage({ id: MESSAGE, position: 0, role: "user", text: "caf\u00E9" }),
      textMessage({ id: MESSAGE.replace(/0$/, "1"), position: 1, role: "assistant", text: "ok" }),
    ];
    const session = makeSession({
      id: ID,
      title: "Untitled",
      provider: "other",
      created_at: T1,
      imported_at: T1,
      updated_at: T1,
      messages,
    });
    expect(session).toEqual({
      id: ID,
      project_id: null,
      title: "Untitled",
      provider: "other",
      model: "",
      source_url: "",
      summary: "",
      tags: [],
      is_pinned: false,
      created_at: T1,
      imported_at: T1,
      updated_at: T1,
      message_count: 2,
      text_bytes: 7,
      extra: {},
      attachments: [],
      messages,
    });
    expect(checkVault({ projects: [], sessions: [session], blobs: new Map() }).ok).toBe(true);
  });
});

describe("checkVault", () => {
  const messages = [
    textMessage({ id: MESSAGE, position: 0, role: "user", text: "question" }),
    textMessage({ id: MESSAGE.replace(/0$/, "1"), position: 1, role: "assistant", text: "answer" }),
  ];
  const good = (): VaultSession =>
    makeSession({
      id: ID,
      title: "T",
      provider: "claude",
      created_at: T1,
      imported_at: T1,
      updated_at: T1,
      messages,
    });
  const check = (session: VaultSession, rest: Partial<Vault> = {}): string[] =>
    checkVault({ projects: [], sessions: [session], blobs: new Map(), ...rest }).problems.items.map(
      (p) => `${p.rule}${p.keyword === undefined ? "" : `:${p.keyword}`} ${p.path}`,
    );

  it("accepts a sound vault", () => {
    expect(check(good())).toEqual([]);
  });

  it("finds derived values that are wrong", () => {
    expect(check({ ...good(), message_count: 3 })).toEqual(["vault /sessions/0/message_count"]);
    expect(check({ ...good(), text_bytes: 1 })).toEqual(["vault /sessions/0/text_bytes"]);
    const first = messages[0];
    if (first === undefined) throw new Error("no message");
    expect(check({ ...good(), messages: [{ ...first, text_bytes: 99 }, ...messages.slice(1)] })).toEqual([
      "vault /sessions/0/messages/0/text_bytes",
      "vault /sessions/0/text_bytes",
    ]);
    expect(
      check({ ...good(), messages: [{ ...first, text: "other", text_bytes: 5 }, ...messages.slice(1)] }),
    ).toEqual(["vault /sessions/0/text_bytes"]);
    const mismatched = {
      ...first,
      segments: [
        { type: "text", text: "segments say this" },
        { type: "x", a: 1 },
      ],
    };
    expect(check({ ...good(), messages: [mismatched, ...messages.slice(1)] })).toEqual([
      "vault /sessions/0/messages/0/text",
    ]);
    expect(check({ ...good(), messages: [{ ...first, position: 5 }, ...messages.slice(1)] })).toEqual([
      "vault /sessions/0/messages/0/position",
    ]);
  });

  it("finds what the format forbids, with the rule", () => {
    expect(check({ ...good(), id: ID.toUpperCase() })).toEqual(["schema:pattern /sessions/0/id"]);
    expect(check({ ...good(), tags: ["Upper"] })).toEqual(["R4 /sessions/0/tags/0"]);
    expect(check({ ...good(), project_id: "aaaaaaaa-0000-4000-8000-000000000009" })).toEqual([
      "R3 /sessions/0/project_id",
    ]);
    expect(check({ ...good(), title: "nul\u0000" })).toEqual(["R9 /sessions/0/title"]);
    expect(check({ ...good(), created_at: new Date(Number.NaN) })).toEqual([
      "schema:pattern /sessions/0/created_at",
    ]);
    expect(check({ ...good(), provider: "" })).toEqual(["schema:minLength /sessions/0/provider"]);
    const twice = checkVault({ projects: [], sessions: [good(), good()], blobs: new Map() });
    expect(twice.problems.items.map((p) => p.rule)).toEqual(["R2", "R2", "R2"]);
  });

  it("finds bytes stored under the wrong hash", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(check(good(), { blobs: new Map([[SHA, bytes]]) })).toEqual([`vault /blobs/${SHA}`]);
    expect(check(good(), { blobs: new Map([["not a hash", bytes]]) })).toEqual(["vault /blobs"]);
  });

  it("gives R11 and R12 as warnings, not as problems", () => {
    const projects = [
      {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        name: "Garden",
        created_at: T1,
        updated_at: T1,
        extra: {},
      },
      {
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        name: " garden",
        created_at: T1,
        updated_at: T1,
        extra: {},
      },
    ];
    const session = { ...good(), updated_at: new Date("2026-04-30T00:00:00.000Z") };
    const result = checkVault({ projects, sessions: [session], blobs: new Map() });
    expect(result.ok).toBe(true);
    expect(result.warnings.items.map((w) => `${w.code} ${w.path}`)).toEqual([
      "R11 /projects/1/name",
      "R12 /sessions/0/updated_at",
    ]);
  });
});
