/// <reference types="node" />
// Conformance with docs/interchange-schema-v1.json, checked with Ajv (draft-07, as the schema
// declares), and the rules R1 to R12 of data-model.md 6.6 that the schema cannot express.
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_KEYS,
  type AttachmentSegment,
  DOCUMENT_KEYS,
  emptyVault,
  exportDocument,
  FORMAT_MARKER,
  FORMAT_VERSION,
  GENERATOR_KEYS,
  type InterchangeAttachment,
  type InterchangeDocument,
  type InterchangeGenerator,
  type InterchangeMessage,
  type InterchangeProject,
  type InterchangeSession,
  importDocument,
  MESSAGE_KEYS,
  PROJECT_KEYS,
  type Problem,
  readDocument,
  SESSION_KEYS,
  type TextSegment,
  validateDocument,
  webGenerator,
} from "./index.ts";
import {
  hasBase64Shape,
  hasFilenameShape,
  hasMediaTypeShape,
  hasTagShape,
  hasVisibleCharacter,
  isCanonicalUuid,
  isSha256Hex,
} from "./shapes.ts";
import { hasTimestampShape } from "./timestamp.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const DOCS = new URL("../../../docs/", import.meta.url);
const readText = (name: string): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(new URL(name, DOCS)));
const EXAMPLE_TEXT = readText("example-vault-export.json");
const schema = JSON.parse(readText("interchange-schema-v1.json"));
const example = () => JSON.parse(EXAMPLE_TEXT);

const ajv = new Ajv({ strict: true, allErrors: true });
const ajvValidate = ajv.compile(schema);

const NOW = new Date("2026-11-20T08:00:00.000Z");
const importContext = () => ({ now: NOW, newId: () => "ffffffff-ffff-4fff-8fff-ffffffffffff" });
const exportContext = { now: NOW, generator: webGenerator("0.0.0-test") };

const PDF_SHA = "1810cb5406ca55b31aaa3be7458db38d90a4fb0afe45831ebbaaebb3c9cd5746";
const PNG_SHA = "a0a4337e393b5dcba561013018a5261d56c20d164d4fa0be4b31456b211a3fd7";

const rules = (problems: readonly Problem[]): string[] => [
  ...new Set(problems.map((problem) => problem.rule)),
];

// Checked by the compiler: the properties each interface declares are exactly the names in its key
// list. The test "names the properties the types name" ties those lists to the schema.
type Declared<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const DECLARED_NAMES_ARE_THE_KEY_LISTS: [
  Same<Declared<InterchangeDocument>, (typeof DOCUMENT_KEYS)[number]>,
  Same<Declared<InterchangeGenerator>, (typeof GENERATOR_KEYS)[number]>,
  Same<Declared<InterchangeProject>, (typeof PROJECT_KEYS)[number]>,
  Same<Declared<InterchangeSession>, (typeof SESSION_KEYS)[number]>,
  Same<Declared<InterchangeAttachment>, (typeof ATTACHMENT_KEYS)[number]>,
  Same<Declared<InterchangeMessage>, (typeof MESSAGE_KEYS)[number]>,
  Same<Declared<TextSegment>, "type" | "text">,
  Same<Declared<AttachmentSegment>, "type" | "sha256">,
] = [true, true, true, true, true, true, true, true];

describe("the schema", () => {
  it("declares draft-07 and compiles in Ajv's strict mode", () => {
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(typeof ajvValidate).toBe("function");
  });

  it("accepts the example file", () => {
    expect(ajvValidate(example())).toBe(true);
    expect(ajvValidate.errors).toBeNull();
  });

  it("accepts the first session with its project as a session document (6.1)", () => {
    const document = example();
    document.kind = "session";
    document.sessions = [document.sessions[0]];
    document.projects = [document.projects[0]];
    expect(ajvValidate(document)).toBe(true);
    expect(validateDocument(document)).toMatchObject({ ok: true });
  });

  it("names the properties the types name, in the same order", () => {
    const names = (definition: { properties: object }): string[] => Object.keys(definition.properties);
    expect(names(schema)).toEqual([...DOCUMENT_KEYS]);
    expect(names(schema.definitions.generator)).toEqual([...GENERATOR_KEYS]);
    expect(names(schema.definitions.project)).toEqual([...PROJECT_KEYS]);
    expect(names(schema.definitions.session)).toEqual([...SESSION_KEYS]);
    expect(names(schema.definitions.attachment)).toEqual([...ATTACHMENT_KEYS]);
    expect(names(schema.definitions.message)).toEqual([...MESSAGE_KEYS]);
    expect(names(schema.definitions.segment)).toEqual(["type"]);
    expect(schema.properties.format.const).toBe(FORMAT_MARKER);
    expect(schema.properties.version.const).toBe(FORMAT_VERSION);
    expect(schema.properties.kind.enum).toEqual(["vault", "session"]);
  });

  it("accepts a document written out against the TypeScript types, every property present", () => {
    expect(DECLARED_NAMES_ARE_THE_KEY_LISTS.every(Boolean)).toBe(true);
    // The compiler checks this literal against the types; Ajv checks it against the schema.
    const sample = {
      format: "sessionvault-interchange",
      version: 1,
      kind: "session",
      exported_at: "2026-11-19T12:00:00.000Z",
      generator: { app: "sessionvault-web", app_version: "0.1.0", platform: "web" },
      projects: [
        {
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          name: "Garden",
          created_at: "2026-07-20T08:15:00.000Z",
          updated_at: "2026-09-02T12:00:00.000Z",
        },
      ],
      sessions: [
        {
          id: "5e550000-0000-4000-8000-000000000002",
          title: "Tomato blight on the balcony",
          provider: "gemini",
          model: "",
          source_url: "https://share.example/EXAMPLE-0002",
          summary: "",
          tags: ["garden"],
          is_pinned: true,
          created_at: "2026-08-02T16:45:00.000Z",
          imported_at: "2026-08-02T16:45:03.250Z",
          updated_at: "2026-08-03T07:10:00.000Z",
          project_id: "aaaaaaaa-0000-4000-8000-000000000002",
          attachments: [
            {
              kind: "image",
              sha256: PNG_SHA,
              media_type: "image/png",
              byte_length: 73,
              filename: "starter-jar-EXAMPLE.png",
              created_at: "2026-11-18T19:20:31.000Z",
              data_base64: String(example().sessions[2].attachments[0].data_base64),
            },
          ],
          messages: [
            {
              id: "0e55a9e0-0002-4000-8000-000000000000",
              index: 0,
              role: "user",
              segments: [
                { type: "text", text: "A photo:" },
                { type: "attachment", sha256: PNG_SHA },
                { type: "x_note", anything: ["goes", 1, null] },
              ],
              created_at: "2026-11-18T19:20:31.000Z",
              model: "claude-opus-5",
            },
          ],
        },
      ],
    } satisfies InterchangeDocument;
    expect(ajvValidate(sample)).toBe(true);
    expect(validateDocument(sample)).toMatchObject({ ok: true, problems: { total: 0 } });
    const read = readDocument(sample);
    expect(read.ok && read.repairs.total).toBe(0);
    expect(read.ok && read.doc).toEqual(sample);
  });

  it("requires exactly the properties the strict validator requires", () => {
    // For every object of the format: leaving out a property is refused exactly when the schema requires it.
    const targets: {
      name: string;
      required: string[];
      pick: (document: ReturnType<typeof example>) => object;
    }[] = [
      { name: "document", required: schema.required, pick: (d) => d },
      { name: "generator", required: schema.definitions.generator.required, pick: (d) => d.generator },
      { name: "project", required: schema.definitions.project.required, pick: (d) => d.projects[1] },
      { name: "session", required: schema.definitions.session.required, pick: (d) => d.sessions[2] },
      {
        name: "attachment",
        required: schema.definitions.attachment.required,
        pick: (d) => d.sessions[2].attachments[0],
      },
      {
        name: "message",
        required: schema.definitions.message.required,
        pick: (d) => d.sessions[2].messages[3],
      },
      {
        name: "text segment",
        required: ["type", "text"],
        pick: (d) => d.sessions[2].messages[2].segments[0],
      },
      {
        name: "attachment segment",
        required: ["type", "sha256"],
        pick: (d) => d.sessions[2].messages[2].segments[1],
      },
    ];
    for (const target of targets) {
      for (const key of Object.keys(target.pick(example()))) {
        const document = example();
        Reflect.deleteProperty(target.pick(document), key);
        const strict = validateDocument(document);
        const structural = strict.problems.items.filter((p) =>
          ["schema", "format", "version"].includes(p.rule),
        );
        const label = `${target.name}.${key}`;
        expect(ajvValidate(document), label).toBe(!target.required.includes(key));
        expect(structural.length === 0, label).toBe(!target.required.includes(key));
        if (target.required.includes(key) && key !== "format" && key !== "version") {
          expect(structural[0], label).toMatchObject({ rule: "schema", keyword: "required" });
          expect(structural[0]?.path.endsWith(`/${key}`), label).toBe(true);
        }
      }
    }
  });
});

describe("the schema's patterns as predicates", () => {
  const pattern = (source: string): RegExp => new RegExp(source, "u");
  const definitions = schema.definitions;
  const cases: {
    name: string;
    regex: RegExp;
    predicate: (text: string) => boolean;
    alphabet: string;
    samples: string[];
  }[] = [
    {
      name: "uuid",
      regex: pattern(definitions.uuid.pattern),
      predicate: isCanonicalUuid,
      alphabet: "0123456789abcdefABCDEFg-",
      samples: [
        "aaaaaaaa-0000-4000-8000-000000000001",
        "AAAAAAAA-0000-4000-8000-000000000001",
        "",
        "aaaaaaaa-0000-4000-8000-00000000000",
        "aaaaaaaa-0000-4000-8000-000000000001\n",
        "aaaaaaaa00004000800000000000000100000",
      ],
    },
    {
      name: "sha256",
      regex: pattern(definitions.sha256.pattern),
      predicate: isSha256Hex,
      alphabet: "0123456789abcdefAg",
      samples: [PDF_SHA, PDF_SHA.toUpperCase(), PDF_SHA.slice(1), `${PDF_SHA}0`, ""],
    },
    {
      name: "timestamp",
      regex: pattern(definitions.timestamp.pattern),
      predicate: hasTimestampShape,
      alphabet: "0123456789-:.TZtz ",
      samples: [
        "2026-11-19T12:00:00Z",
        "2026-11-19T12:00:00.000Z",
        "2026-11-19T12:00:00.123456789Z",
        "2026-11-19T12:00:00.1234567890Z",
        "2026-99-99T99:99:99Z",
        "2026-11-19T12:00:00.Z",
        "2026-11-19T12:00:00",
      ],
    },
    {
      name: "project name",
      regex: pattern(definitions.project.properties.name.pattern),
      predicate: hasVisibleCharacter,
      alphabet: " \t\n\r\u00A0\u2028\u3000\uFEFFa\u200B",
      samples: ["Garden", " ", "", "\u00A0\u2003", " x ", "\u200B"],
    },
    {
      name: "tag",
      regex: pattern(definitions.session.properties.tags.items.pattern),
      predicate: hasTagShape,
      alphabet: "ab, \n",
      samples: ["garden", "two words", "a,b", "", ",", "a\nb"],
    },
    {
      name: "media type",
      regex: pattern(definitions.attachment.properties.media_type.pattern),
      predicate: hasMediaTypeShape,
      alphabet: "az09!#$&^_.+-/A ;=",
      samples: [
        "application/pdf",
        "image/png",
        "Image/PNG",
        "text/plain; charset=utf-8",
        "a/b/c",
        "/pdf",
        "application/",
        "",
        "a",
        "application/vnd.x+json",
      ],
    },
    {
      name: "filename",
      regex: pattern(definitions.attachment.properties.filename.pattern),
      predicate: hasFilenameShape,
      alphabet: "ab./\\ \n",
      samples: ["", "page.pdf", "a/b.pdf", "a\\b.pdf", "..", "line\nbreak"],
    },
    {
      name: "base64",
      regex: pattern(definitions.attachment.properties.data_base64.pattern),
      predicate: hasBase64Shape,
      alphabet: "ABab01+/=-_ \n",
      samples: ["", "AAAA", "AA==", "AAA=", "A===", "=", "==", "===", "AA=A", "AA\n", "A-_A"],
    },
  ];

  for (const { name, regex, predicate, alphabet, samples } of cases) {
    it(`${name}: the predicate decides as the schema's pattern does`, () => {
      for (const sample of samples)
        expect(predicate(sample), JSON.stringify(sample)).toBe(regex.test(sample));
      // Both outcomes occur among the samples.
      expect(new Set(samples.map((sample) => regex.test(sample))).size).toBe(2);
      const unit = fc.constantFrom(...alphabet);
      fc.assert(
        fc.property(
          fc.string({ unit, maxLength: 70 }),
          fc.constantFrom(...samples),
          fc.nat(70),
          (noise, sample, at) => {
            expect(predicate(noise)).toBe(regex.test(noise));
            // A valid sample with one character changed, removed or added.
            const cut = Math.min(at, sample.length);
            for (const variant of [
              sample.slice(0, cut) + noise.slice(0, 1) + sample.slice(cut + 1),
              sample.slice(0, cut) + sample.slice(cut + 1),
              sample.slice(0, cut) + noise.slice(0, 1) + sample.slice(cut),
            ]) {
              expect(predicate(variant), JSON.stringify(variant)).toBe(regex.test(variant));
            }
          },
        ),
        { numRuns: 1500 },
      );
    });
  }
});

describe("what the writer produces", () => {
  const imported = importDocument(emptyVault(), EXAMPLE_TEXT, importContext());
  if (!imported.ok) throw new Error("the example must import");
  const vault = imported.vault;

  it("validates against the schema: the whole vault, with and without bytes", () => {
    for (const includeBytes of [true, false]) {
      const exported = exportDocument(vault, { kind: "vault" }, exportContext, { includeBytes });
      expect(exported.ok).toBe(true);
      if (!exported.ok) continue;
      expect(ajvValidate(exported.doc)).toBe(true);
      expect(ajvValidate.errors).toBeNull();
      // 6.8: the output must pass the schema and R1 to R10 without repair.
      expect(validateDocument(exported.doc)).toMatchObject({ ok: true, problems: { total: 0 } });
      expect(readDocument(exported.doc)).toMatchObject({ ok: true, repairs: { total: 0 } });
      expect(exported.warnings.total).toBe(0);
    }
  });

  it("validates against the schema: every session on its own", () => {
    for (const session of vault.sessions) {
      const exported = exportDocument(vault, { kind: "session", id: session.id }, exportContext, {
        includeBytes: true,
      });
      expect(exported.ok).toBe(true);
      if (!exported.ok) continue;
      expect(ajvValidate(exported.doc)).toBe(true);
      expect(validateDocument(exported.doc)).toMatchObject({ ok: true, problems: { total: 0 } });
    }
  });

  it("validates as text too", () => {
    const exported = exportDocument(vault, { kind: "vault" }, exportContext, { includeBytes: true });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const reparsed = JSON.parse(JSON.stringify(exported.doc));
    expect(ajvValidate(reparsed)).toBe(true);
    expect(reparsed).toEqual(exported.doc);
  });
});

describe("what the reader accepts", () => {
  it("validates against the schema after repair, where the input did not", () => {
    const document = example();
    // Repairs 1 to 7 at once: ids in upper case, folded provider and role, nulls, loose tags,
    // a NUL, CR LF, unsorted messages, adjacent text segments.
    document.projects[0].id = document.projects[0].id.toUpperCase();
    document.sessions[0].project_id = document.sessions[0].project_id.toUpperCase();
    document.sessions[0].id = document.sessions[0].id.toUpperCase();
    document.sessions[0].provider = " ChatGPT ";
    document.sessions[0].model = null;
    document.sessions[0].attachments = null;
    document.sessions[0].tags = ["Bikes", "bikes", " #Repair "];
    document.sessions[0].title = "Truing a bicycle\u0000 wheel";
    document.sessions[0].messages.reverse();
    document.sessions[0].messages[0].role = "UNKNOWN";
    document.sessions[0].messages[1].segments = [
      { type: "text", text: "line one\r\nline two" },
      { type: "text", text: "second segment" },
    ];
    expect(ajvValidate(document)).toBe(false);
    expect(validateDocument(document).ok).toBe(false);

    const read = readDocument(document);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(ajvValidate(read.doc)).toBe(true);
    expect(ajvValidate.errors).toBeNull();
    expect(validateDocument(read.doc)).toMatchObject({ ok: true });
    expect(Object.keys(read.repairs.counts).sort()).toEqual([
      "id_lowercased",
      "line_endings",
      "messages_renumbered",
      "null_default",
      "segments_merged",
      "string_cleaned",
      "tags_normalised",
      "value_folded",
    ]);
    const session = read.doc.sessions[0];
    expect(session).toMatchObject({
      id: "5e550000-0000-4000-8000-000000000001",
      project_id: "aaaaaaaa-0000-4000-8000-000000000001",
      provider: "chatgpt",
      model: "",
      attachments: [],
      tags: ["bikes", "repair"],
      title: "Truing a bicycle wheel",
    });
    expect(session?.messages.map((message) => [message.index, message.role])).toEqual([
      [0, "user"],
      [1, "assistant"],
      [2, "system"],
      [3, "unknown"],
    ]);
    expect(session?.messages[2]?.segments).toEqual([
      { type: "text", text: "line one\nline two\n\nsecond segment" },
    ]);
  });
});

describe("the rules a schema cannot express (6.6)", () => {
  type Case = {
    readonly name: string;
    /** Changes the example into the case. */
    readonly change: (document: ReturnType<typeof example>) => void;
    /** Where the strict validator must point; undefined for an accepted case. */
    readonly path?: string;
  };

  const sessionDocument = (document: ReturnType<typeof example>): void => {
    document.kind = "session";
    document.sessions = [document.sessions[0]];
    document.projects = [document.projects[0]];
  };

  /** For every rule: documents that keep it, and documents that break it and nothing else. */
  const table = {
    R1: {
      accepted: [
        {
          name: "29 February of a leap year",
          change: (d) => {
            d.sessions[0].created_at = "2024-02-29T23:59:59Z";
          },
        },
        {
          name: "nine fraction digits",
          change: (d) => {
            d.exported_at = "2026-11-19T12:00:00.123456789Z";
          },
        },
      ],
      rejected: [
        {
          name: "30 February",
          change: (d) => {
            d.sessions[0].created_at = "2026-02-30T00:00:00.000Z";
          },
          path: "/sessions/0/created_at",
        },
        {
          name: "29 February of a common year",
          change: (d) => {
            d.projects[0].updated_at = "2026-02-29T00:00:00Z";
          },
          path: "/projects/0/updated_at",
        },
        {
          name: "month 13",
          change: (d) => {
            d.exported_at = "2026-13-01T00:00:00Z";
          },
          path: "/exported_at",
        },
        {
          name: "hour 24",
          change: (d) => {
            d.sessions[2].attachments[0].created_at = "2026-11-18T24:00:00.000Z";
          },
          path: "/sessions/2/attachments/0/created_at",
        },
        {
          name: "second 60",
          change: (d) => {
            d.sessions[2].messages[2].created_at = "2026-11-18T19:20:60.000Z";
          },
          path: "/sessions/2/messages/2/created_at",
        },
      ],
    },
    R2: {
      accepted: [
        // Uniqueness is per kind: a project and a session may carry the same UUID.
        {
          name: "a session with the id of a project",
          change: (d) => {
            d.sessions[3].id = d.projects[0].id;
          },
        },
      ],
      rejected: [
        {
          name: "two projects with one id",
          change: (d) => {
            d.projects[2].id = d.projects[0].id;
          },
          path: "/projects/2/id",
        },
        {
          name: "two sessions with one id",
          change: (d) => {
            d.sessions[5].id = d.sessions[0].id;
          },
          path: "/sessions/5/id",
        },
        {
          name: "two messages of one session with one id",
          change: (d) => {
            d.sessions[0].messages[3].id = d.sessions[0].messages[0].id;
          },
          path: "/sessions/0/messages/3/id",
        },
        {
          name: "two messages of different sessions with one id",
          change: (d) => {
            d.sessions[5].messages[0].id = d.sessions[0].messages[0].id;
          },
          path: "/sessions/5/messages/0/id",
        },
      ],
    },
    R3: {
      accepted: [
        {
          name: "a session moved to another listed project",
          change: (d) => {
            d.sessions[3].project_id = d.projects[2].id;
          },
        },
      ],
      rejected: [
        {
          name: "a project_id no project has",
          change: (d) => {
            d.sessions[3].project_id = "aaaaaaaa-0000-4000-8000-00000000ffff";
          },
          path: "/sessions/3/project_id",
        },
      ],
    },
    R4: {
      accepted: [
        {
          name: "tags with inner spaces and a hash",
          change: (d) => {
            d.sessions[0].tags = ["two words", "#hash", "\u00E9t\u00E9"];
          },
        },
      ],
      rejected: [
        {
          name: "an upper-case tag",
          change: (d) => {
            d.sessions[0].tags = ["Bikes"];
          },
          path: "/sessions/0/tags/0",
        },
        {
          name: "a tag with outer white space",
          change: (d) => {
            d.sessions[0].tags = ["bikes", " repair"];
          },
          path: "/sessions/0/tags/1",
        },
      ],
    },
    R5: {
      accepted: [
        {
          name: "one hash under two kinds",
          change: (d) => {
            d.sessions[2].attachments.push({ ...d.sessions[2].attachments[0], kind: "file" });
          },
        },
        {
          name: "an original_pdf beside an image",
          change: (d) => {
            d.sessions[2].attachments.push({ ...d.sessions[1].attachments[0] });
          },
        },
      ],
      rejected: [
        {
          name: "the same kind and hash twice",
          change: (d) => {
            d.sessions[2].attachments.push({ ...d.sessions[2].attachments[0] });
          },
          path: "/sessions/2/attachments/1",
        },
        {
          name: "two original_pdf",
          change: (d) => {
            d.sessions[1].attachments.push({ ...d.sessions[4].attachments[0] });
          },
          path: "/sessions/1/attachments/1",
        },
        {
          name: "inline bytes of another length",
          change: (d) => {
            d.sessions[1].attachments[0].byte_length = 617;
          },
          path: "/sessions/1/attachments/0/data_base64",
        },
        {
          name: "inline bytes with another hash",
          change: (d) => {
            d.sessions[2].attachments[0].data_base64 = d.sessions[2].attachments[0].data_base64.replace(
              "iVBOR",
              "iVBOS",
            );
          },
          path: "/sessions/2/attachments/0/data_base64",
        },
        {
          name: "inline data that is not a whole number of base64 groups",
          change: (d) => {
            d.sessions[2].attachments[0].data_base64 = "A";
          },
          path: "/sessions/2/attachments/0/data_base64",
        },
      ],
    },
    R6: {
      accepted: [
        {
          name: "a message removed from the end",
          change: (d) => {
            d.sessions[0].messages.pop();
          },
        },
      ],
      rejected: [
        {
          name: "an index that skips",
          change: (d) => {
            d.sessions[0].messages[3].index = 4;
          },
          path: "/sessions/0/messages/3/index",
        },
        {
          name: "messages out of order",
          change: (d) => {
            d.sessions[5].messages.reverse();
          },
          path: "/sessions/5/messages/0/index",
        },
        {
          name: "an index used twice",
          change: (d) => {
            d.sessions[5].messages[1].index = 0;
          },
          path: "/sessions/5/messages/1/index",
        },
      ],
    },
    R7: {
      accepted: [
        {
          name: "text, unknown segment, text",
          change: (d) => {
            d.sessions[4].messages[2].segments.push({ type: "text", text: "after the table" });
          },
        },
      ],
      rejected: [
        {
          name: "two text segments in a row",
          change: (d) => {
            d.sessions[0].messages[0].segments.push({ type: "text", text: "again" });
          },
          path: "/sessions/0/messages/0/segments/1",
        },
        {
          name: "an attachment segment whose hash is not listed",
          change: (d) => {
            d.sessions[2].messages[2].segments[1].sha256 = PDF_SHA;
          },
          path: "/sessions/2/messages/2/segments/1/sha256",
        },
      ],
    },
    R8: {
      accepted: [
        { name: "a session document with the session's own project", change: sessionDocument },
        {
          name: "a session document without projects for a session without project",
          change: (d) => {
            d.kind = "session";
            d.sessions = [d.sessions[3]];
            d.projects = [];
          },
        },
      ],
      rejected: [
        {
          name: "a session document that lists another project",
          change: (d) => {
            sessionDocument(d);
            d.projects = [example().projects[2]];
            d.sessions[0].project_id = null;
          },
          path: "/projects/0",
        },
      ],
    },
    R9: {
      accepted: [
        {
          name: "a pair of surrogates",
          change: (d) => {
            d.sessions[0].title = "wheel \u{1F6B2}";
          },
        },
      ],
      rejected: [
        {
          name: "U+0000 in a title",
          change: (d) => {
            d.sessions[0].title = "a\u0000b";
          },
          path: "/sessions/0/title",
        },
        {
          name: "a lone surrogate in a message",
          change: (d) => {
            d.sessions[0].messages[0].segments[0].text = "half \uD83D";
          },
          path: "/sessions/0/messages/0/segments/0/text",
        },
        {
          name: "U+0000 in an unknown property",
          change: (d) => {
            d.sessions[4].x_capture.note = "\u0000";
          },
          path: "/sessions/4/(property 13)/(property 2)",
        },
        {
          name: "U+0000 in a property name",
          change: (d) => {
            d.projects[1]["x_\u0000"] = 1;
          },
          path: "/projects/1/(property 6)",
        },
      ],
    },
    R10: {
      accepted: [
        {
          name: "line feeds in a text segment",
          change: (d) => {
            d.sessions[0].messages[0].segments[0].text = "a\nb\n\nc";
          },
        },
        // R10 is about text segments only.
        {
          name: "a carriage return in a summary",
          change: (d) => {
            d.sessions[0].summary = "one\r\ntwo";
          },
        },
      ],
      rejected: [
        {
          name: "CR LF in a text segment",
          change: (d) => {
            d.sessions[0].messages[0].segments[0].text = "a\r\nb";
          },
          path: "/sessions/0/messages/0/segments/0/text",
        },
        {
          name: "a lone CR in a text segment",
          change: (d) => {
            d.sessions[5].messages[1].segments[0].text = "a\rb";
          },
          path: "/sessions/5/messages/1/segments/0/text",
        },
      ],
    },
  } satisfies Record<string, { accepted: Case[]; rejected: Case[] }>;

  for (const [rule, { accepted, rejected }] of Object.entries(table)) {
    for (const item of accepted) {
      it(`${rule} accepts ${item.name}`, () => {
        const document = example();
        item.change(document);
        expect(validateDocument(document)).toMatchObject({ ok: true, problems: { items: [] } });
        expect(readDocument(document).ok).toBe(true);
        expect(ajvValidate(document)).toBe(true);
      });
    }
    for (const item of rejected) {
      it(`${rule} rejects ${item.name}`, () => {
        const document = example();
        item.change(document);
        const strict = validateDocument(document);
        expect(strict.ok).toBe(false);
        // The rule is named, with the place, and it is the only rule broken.
        expect(rules(strict.problems.items)).toEqual([rule]);
        expect(strict.problems.items.map((problem) => problem.path)).toContain(item.path);
        // It is a rule the schema cannot express: Ajv still accepts the document.
        expect(ajvValidate(document)).toBe(true);
      });
    }
  }

  it("covers R1 to R10", () => {
    expect(Object.keys(table)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"]);
  });

  it("rejects, in the reader too, what its repair list does not mend: R1, R2, R5 (uniqueness) and R8", () => {
    const unrepairable: [string, Case][] = [
      ...table.R1.rejected.map((item): [string, Case] => ["R1", item]),
      ...table.R2.rejected.map((item): [string, Case] => ["R2", item]),
      ...table.R5.rejected.slice(0, 2).map((item): [string, Case] => ["R5", item]),
      ...table.R8.rejected.map((item): [string, Case] => ["R8", item]),
    ];
    for (const [rule, item] of unrepairable) {
      const document = example();
      item.change(document);
      const read = readDocument(document);
      expect(read.ok, item.name).toBe(false);
      if (read.ok) continue;
      expect(rules(read.problems.items), item.name).toEqual([rule]);
      expect(read.problems.items.map((problem) => problem.path)).toContain(item.path);
    }
  });

  it("mends, in the reader, what its repair list covers: R3, R4, R5 (bytes), R6, R7 (text), R9, R10", () => {
    // Every rejected case of these rules, with the one notice the reader gives for it.
    const mended: [string, Case[], string][] = [
      ["R3", table.R3.rejected, "project_missing"],
      ["R4", table.R4.rejected, "tags_normalised"],
      ["R5", table.R5.rejected.slice(2), "bytes_discarded"],
      ["R6", table.R6.rejected, "messages_renumbered"],
      ["R7", table.R7.rejected.slice(0, 1), "segments_merged"],
      ["R9", table.R9.rejected, "string_cleaned"],
      ["R10", table.R10.rejected, "line_endings"],
    ];
    for (const [rule, items, code] of mended) {
      expect(items.length, rule).toBeGreaterThan(0);
      for (const item of items) {
        const document = example();
        item.change(document);
        const read = readDocument(document);
        expect(read.ok, `${rule}: ${item.name}`).toBe(true);
        if (!read.ok) continue;
        const notices = [...read.repairs.items, ...read.warnings.items].map((notice) => notice.code);
        expect(notices, `${rule}: ${item.name}`).toEqual([code]);
        expect(validateDocument(read.doc).ok).toBe(true);
        expect(ajvValidate(read.doc)).toBe(true);
      }
    }
  });

  it("R7: the reader cannot mend an attachment segment whose hash is not listed", () => {
    const document = example();
    table.R7.rejected[1]?.change(document);
    const read = readDocument(document);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(rules(read.problems.items)).toEqual(["R7"]);
  });

  describe("R11 (warning only): project names differ when trimmed and compared without case", () => {
    it("accepts distinct names without a warning", () => {
      const strict = validateDocument(example());
      expect(strict).toMatchObject({ ok: true, warnings: { total: 0 } });
    });

    it("names R11 for equal names and still accepts the document", () => {
      const document = example();
      document.projects[2].name = "  GARDEN ";
      for (const result of [validateDocument(document), readDocument(document)]) {
        expect(result.ok).toBe(true);
        if (!("warnings" in result)) continue;
        expect(result.warnings.items).toEqual([
          expect.objectContaining({ code: "R11", path: "/projects/2/name" }),
        ]);
        expect(result.warnings.counts).toEqual({ R11: 1 });
      }
      expect(ajvValidate(document)).toBe(true);
    });
  });

  describe("R12 (warning only): updated_at is not earlier than imported_at", () => {
    it("accepts updated_at equal to imported_at without a warning", () => {
      const document = example();
      document.sessions[0].updated_at = document.sessions[0].imported_at;
      expect(validateDocument(document)).toMatchObject({ ok: true, warnings: { total: 0 } });
    });

    it("names R12 for an earlier updated_at and still accepts the document", () => {
      const document = example();
      document.sessions[0].updated_at = "2026-03-15T18:02:11.481Z";
      for (const result of [validateDocument(document), readDocument(document)]) {
        expect(result.ok).toBe(true);
        if (!("warnings" in result)) continue;
        expect(result.warnings.items).toEqual([
          expect.objectContaining({ code: "R12", path: "/sessions/0/updated_at" }),
        ]);
      }
      expect(ajvValidate(document)).toBe(true);
    });

    it("compares instants, not text", () => {
      const document = example();
      // The same instant written with one fraction digit less: not earlier.
      document.sessions[1].imported_at = "2026-08-02T16:45:03.25Z";
      document.sessions[1].updated_at = "2026-08-02T16:45:03.250Z";
      expect(validateDocument(document)).toMatchObject({ ok: true, warnings: { total: 0 } });
    });
  });
});

describe("the hashes of the example", () => {
  it("are the ones the tests above rely on", () => {
    const document = example();
    expect(document.sessions[1].attachments[0].sha256).toBe(PDF_SHA);
    expect(document.sessions[2].attachments[0].sha256).toBe(PNG_SHA);
  });
});
