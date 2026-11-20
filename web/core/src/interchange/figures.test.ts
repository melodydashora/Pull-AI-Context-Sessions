/// <reference types="node" />
// The figures of data-model.md 9.1 for docs/example-vault-export.json, read from the vault the
// import builds. #1 to #6 are the sessions in file order.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  attachmentKindBehaviour,
  emptyVault,
  flattenText,
  importDocument,
  messageSegments,
  providerBehaviour,
  roleBehaviour,
  segmentBehaviour,
  utf8ByteLength,
  type VaultSession,
} from "./index.ts";

// The property tests and the large inputs need more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const EXAMPLE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(
  readFileSync(new URL("../../../docs/example-vault-export.json", import.meta.url)),
);
const encoder = new TextEncoder();

const imported = importDocument(emptyVault(), EXAMPLE_TEXT, {
  now: new Date("2026-11-20T08:00:00.000Z"),
  newId: () => "ffffffff-ffff-4fff-8fff-ffffffffffff",
});
if (!imported.ok) throw new Error("the example must import");
const vault = imported.vault;

/** Session #n of 9.1 (1-based, file order). */
function session(n: number): VaultSession {
  const found = vault.sessions.find(
    (candidate) => candidate.id === `5e550000-0000-4000-8000-00000000000${n}`,
  );
  if (found === undefined) throw new Error(`session #${n} is missing`);
  return found;
}

const projectName = (id: string | null): string =>
  id === null ? "none" : (vault.projects.find((project) => project.id === id)?.name ?? "missing");

describe("9.1: the example file", () => {
  // | # | Title | Provider | Pinned | Project | Tags | created_at | imported_at | Messages | text_bytes |
  const table: [number, string, string, boolean, string, string[], string, string, number, number][] = [
    [
      1,
      "Truing a bicycle wheel",
      "chatgpt",
      false,
      "Bike workshop",
      ["bikes", "repair"],
      "2026-03-14T09:30:00.000Z",
      "2026-03-15T18:02:11.482Z",
      4,
      166,
    ],
    [
      2,
      "Tomato blight on the balcony",
      "gemini",
      true,
      "Garden",
      ["garden"],
      "2026-08-02T16:45:00.000Z",
      "2026-08-02T16:45:03.250Z",
      1,
      162,
    ],
    [
      3,
      "Sourdough starter schedule",
      "claude",
      false,
      "none",
      ["baking", "bread"],
      "2026-10-10T08:00:00.000Z",
      "2026-10-10T08:00:00.000Z",
      4,
      283,
    ],
    [4, "Untitled", "other", false, "none", [], "2026-01-05T12:00:00.000Z", "2026-01-05T12:00:00.000Z", 0, 0],
    [
      5,
      "Seed order comparison",
      "examplebot",
      false,
      "Garden",
      ["garden", "shopping"],
      "2026-10-31T23:30:00.000Z",
      "2026-11-01T10:00:00.000Z",
      3,
      111,
    ],
    [
      6,
      "Caf\u00E9 menu translation",
      "claude",
      false,
      "none",
      ["travel", "two words"],
      "2025-12-31T23:59:59.000Z",
      "2026-11-01T10:00:00.000Z",
      2,
      59,
    ],
  ];

  for (const [
    n,
    title,
    provider,
    pinned,
    project,
    tags,
    createdAt,
    importedAt,
    messages,
    textBytes,
  ] of table) {
    it(`#${n}: ${messages} messages, text_bytes ${textBytes}`, () => {
      const s = session(n);
      expect(s.message_count).toBe(messages);
      expect(s.messages.length).toBe(messages);
      expect(s.text_bytes).toBe(textBytes);
      // text_bytes is the UTF-8 length of the flattened texts, counted two independent ways.
      expect(s.messages.reduce((sum, message) => sum + encoder.encode(message.text).length, 0)).toBe(
        textBytes,
      );
      expect(s.messages.reduce((sum, message) => sum + message.text_bytes, 0)).toBe(textBytes);
      expect(s.title).toBe(title);
      expect(s.provider).toBe(provider);
      expect(s.is_pinned).toBe(pinned);
      expect(projectName(s.project_id)).toBe(project);
      expect(s.tags).toEqual(tags);
      expect(s.created_at.toISOString()).toBe(createdAt);
      expect(s.imported_at.toISOString()).toBe(importedAt);
      s.messages.forEach((message, i) => {
        expect(message.position).toBe(i);
      });
    });
  }

  it("has the projects Bike workshop, Garden and the empty apple pie ideas", () => {
    expect(vault.projects.map((project) => project.name).sort()).toEqual([
      "Bike workshop",
      "Garden",
      "apple pie ideas",
    ]);
    const empty = vault.projects.find((project) => project.name === "apple pie ideas");
    expect(vault.sessions.filter((s) => s.project_id === empty?.id)).toEqual([]);
  });

  it("#3, index 2: text, attachment, text flattens to the two texts joined by an empty line, 57 bytes", () => {
    const message = session(3).messages[2];
    expect(message?.segments?.map((segment) => segment.type)).toEqual(["text", "attachment", "text"]);
    expect(message?.text).toBe("Here is a photo of the jar after six hours.\n\nIs it ready?");
    expect(message?.text_bytes).toBe(57);
    expect(encoder.encode(message?.text).length).toBe(57);
    expect(flattenText(message?.segments ?? [])).toBe(
      "Here is a photo of the jar after six hours.\n\nIs it ready?",
    );
  });

  it("#6: the messages are 58 UTF-16 code units and 59 UTF-8 bytes", () => {
    const s = session(6);
    expect(s.title).toContain("\u00E9");
    expect(s.messages.reduce((sum, message) => sum + message.text.length, 0)).toBe(58);
    expect(s.text_bytes).toBe(59);
    expect(s.messages.map((message) => [message.text.length, message.text_bytes])).toEqual([
      [44, 45],
      [14, 14],
    ]);
    expect(utf8ByteLength("caf\u00E9")).toBe(5);
  });

  it("#5: the unknown provider, role and segment type are kept as written and behave as their fallback", () => {
    const s = session(5);
    expect(s.provider).toBe("examplebot");
    expect(providerBehaviour(s.provider)).toBe("other");
    expect(s.messages[1]?.role).toBe("tool");
    expect(roleBehaviour(s.messages[1]?.role ?? "")).toBe("unknown");
    const segments = s.messages[2]?.segments ?? [];
    expect(segments.map((segment) => segmentBehaviour(segment.type))).toEqual(["text", "opaque"]);
    // The unknown segment is left out of the flattened text (context pack #5 of 9.3).
    expect(s.messages[2]?.text).toBe("Carrots are cheaper per row.");
    expect(s.messages.map((message) => message.text)).toEqual([
      "Compare carrot and beet seed prices for a 2 m bed.",
      "lookup: seed catalogue, 2 results",
      "Carrots are cheaper per row.",
    ]);
  });

  it("keeps unknown properties in the extra of the object they belong to", () => {
    expect(vault.projects.find((project) => project.name === "Garden")?.extra).toEqual({ x_color: "green" });
    expect(session(5).extra).toEqual({
      x_capture: { method: "paste", note: "unknown field, must survive a round trip" },
    });
    expect(session(5).messages[2]?.extra).toEqual({ x_rating: 5 });
    expect(session(2).attachments[0]?.extra).toEqual({ x_pages: 1 });
    expect(session(1).extra).toEqual({});
  });

  it("stores segments only for messages that are more than one plain text", () => {
    const stored = vault.sessions.flatMap((s) =>
      s.messages.filter((message) => message.segments !== null).map((message) => message.id),
    );
    expect(stored).toEqual(["0e55a9e0-0003-4000-8000-000000000002", "0e55a9e0-0005-4000-8000-000000000002"]);
    const plain = session(1).messages[0];
    expect(plain?.segments).toBeNull();
    expect(plain === undefined ? [] : messageSegments(plain)).toEqual([
      { type: "text", text: "My rear wheel wobbles. How do I true it?" },
    ]);
  });

  it("has an inline PDF (#2), a PDF descriptor without bytes (#5) and an inline PNG (#3)", () => {
    const pdf = session(2).attachments[0];
    expect(pdf).toMatchObject({ kind: "original_pdf", media_type: "application/pdf", byte_length: 616 });
    expect(vault.blobs.get(pdf?.sha256 ?? "")?.length).toBe(616);
    expect(new TextDecoder().decode(vault.blobs.get(pdf?.sha256 ?? "")?.subarray(0, 8))).toBe("%PDF-1.4");
    const missing = session(5).attachments[0];
    expect(missing).toMatchObject({ kind: "original_pdf", byte_length: 623 });
    expect(vault.blobs.has(missing?.sha256 ?? "")).toBe(false);
    const png = session(3).attachments[0];
    expect(png).toMatchObject({ kind: "image", media_type: "image/png", byte_length: 73 });
    expect([...(vault.blobs.get(png?.sha256 ?? "")?.subarray(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(attachmentKindBehaviour(png?.kind ?? "")).toBe("image");
    expect(vault.blobs.size).toBe(2);
  });

  it("carries message dates and models only where the file has them", () => {
    const dated = session(3).messages.map((message) => [
      message.created_at?.toISOString() ?? null,
      message.model,
    ]);
    expect(dated).toEqual([
      [null, ""],
      [null, ""],
      ["2026-11-18T19:20:31.000Z", ""],
      ["2026-11-18T19:21:05.000Z", "claude-opus-5"],
    ]);
  });

  it("has two sessions with the same imported_at (#5 and #6)", () => {
    expect(session(5).imported_at.getTime()).toBe(session(6).imported_at.getTime());
  });
});
