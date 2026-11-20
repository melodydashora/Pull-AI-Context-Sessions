// What an import does to a vault, on the fixtures of the importer and on the example vault file.

import { readFileSync } from "node:fs";
import { emptyVault, type Vault } from "@sessionvault/core";
import { expect, it } from "vitest";
import {
  type ImportClock,
  importOneFile,
  importPastedText,
  PASTE_TITLE,
  reviewPreview,
} from "./importing.ts";

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/import/${name}`, import.meta.url)));
const exampleVault = (): Uint8Array =>
  new Uint8Array(readFileSync(new URL("../../docs/example-vault-export.json", import.meta.url)));

/** A clock that stands still and ids that count up, so that results can be compared. */
function clock(): ImportClock {
  let n = 0;
  return {
    now: () => new Date("2026-11-20T12:00:00.000Z"),
    newId: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    },
  };
}

const CHOICES = { provider: "claude", sourceUrl: null, allowWall: false } as const;

it("imports a transcript file as sessions and leaves the vault it was given unchanged", () => {
  const before = emptyVault();
  const done = importOneFile(before, fixture("07-chatgpt-export.input.json"), "conversations.json", clock());
  expect(done.report.kind).toBe("sessions");
  expect(done.vault.sessions).toHaveLength(2);
  expect(before.sessions).toHaveLength(0);
  if (done.report.kind !== "sessions") throw new Error("not sessions");
  expect(done.report.sessions.map((session) => session.id)).toEqual(
    done.vault.sessions.map((session) => session.id),
  );
});

it("says how a file was read when it is not UTF-8", () => {
  const done = importOneFile(emptyVault(), fixture("24-utf16le-with-bom.input.txt"), "notes.txt", clock());
  expect(done.report).toMatchObject({ kind: "sessions", flags: ["decoded_as_utf_16le"] });
});

it("gives the reason when a file holds nothing to import, and changes nothing", () => {
  const vault = emptyVault();
  const empty = importOneFile(vault, fixture("18-empty-file.input.txt"), "empty.txt", clock());
  expect(empty.report).toMatchObject({ kind: "rejected", reason: "empty_input" });
  expect(empty.vault).toBe(vault);
  const unknown = importOneFile(vault, fixture("12-json-not-a-chat-export.input.json"), "data.json", clock());
  expect(unknown.report).toMatchObject({ kind: "rejected", reason: "unrecognised_json" });
  expect(unknown.vault).toBe(vault);
});

it('keeps a JSON file that is no known export as a note when asked to ("Keep as a Note")', () => {
  const done = importOneFile(
    emptyVault(),
    fixture("12-json-not-a-chat-export.input.json"),
    "data.json",
    clock(),
    true,
  );
  expect(done.report.kind).toBe("sessions");
  expect(done.vault.sessions).toHaveLength(1);
});

it("merges a vault file, and a second import of the same file changes nothing", () => {
  const first = importOneFile(emptyVault(), exampleVault(), "example-vault-export.json", clock());
  expect(first.report).toMatchObject({ kind: "vault", counts: { added: 6, projectsAdded: 3 } });
  expect(first.vault.sessions).toHaveLength(6);
  const second = importOneFile(first.vault, exampleVault(), "example-vault-export.json", clock());
  expect(second.report).toMatchObject({ kind: "vault", counts: { added: 0, unchanged: 6 } });
  expect(second.vault.sessions).toHaveLength(6);
});

it("refuses a vault file that is not valid, with a sentence and without a change", () => {
  const vault = emptyVault();
  const bytes = new TextEncoder().encode('{"format":"sessionvault-interchange","version":1}');
  const done = importOneFile(vault, bytes, "broken.json", clock());
  expect(done.report.kind).toBe("refused");
  if (done.report.kind !== "refused") throw new Error("not refused");
  expect(done.report.message.length).toBeGreaterThan(10);
  expect(done.vault).toBe(vault);
});

it("imports pasted text under the title of a paste and with the link it came from", () => {
  const done = importPastedText(
    emptyVault(),
    "User: one\n\nAssistant: two",
    { provider: "gemini", sourceUrl: "https://chatgpt.com/share/EXAMPLE", allowWall: false },
    clock(),
  );
  if (done.report.kind !== "sessions") throw new Error("not sessions");
  const session = done.report.sessions[0];
  expect(session?.title).toBe(PASTE_TITLE);
  expect(session?.source_url).toBe("https://chatgpt.com/share/EXAMPLE");
  // The host of the link decides the provider; the picker only labels what cannot be identified.
  expect(session?.provider).toBe("chatgpt");
  expect(session?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
});

it("does not import a paste that is only a link, a sign-in page, or nothing", () => {
  const vault: Vault = emptyVault();
  const link = importPastedText(vault, "  claude.ai/share/EXAMPLE-0000 \n", CHOICES, clock());
  expect(link.report).toEqual({ kind: "link", link: "https://claude.ai/share/EXAMPLE-0000" });
  const wall = new TextDecoder().decode(fixture("36-paste-sign-in-wall.input.txt"));
  expect(importPastedText(vault, wall, CHOICES, clock()).report).toEqual({
    kind: "rejected",
    reason: "sign_in_suspected",
  });
  expect(importPastedText(vault, " \n\t ", CHOICES, clock()).report).toEqual({
    kind: "rejected",
    reason: "empty_input",
  });
  expect(link.vault).toBe(vault);
});

it('imports a text that looks like a sign-in page after "Save Anyway"', () => {
  const wall = new TextDecoder().decode(fixture("36-paste-sign-in-wall.input.txt"));
  const done = importPastedText(emptyVault(), wall, { ...CHOICES, allowWall: true }, clock());
  expect(done.report.kind).toBe("sessions");
  expect(done.vault.sessions).toHaveLength(1);
});

it("shows at most 12 lines and 600 characters of a text under review", () => {
  expect(
    reviewPreview(Array.from({ length: 40 }, (_, k) => `line ${k}`).join("\r\n")).split("\n"),
  ).toHaveLength(12);
  expect(reviewPreview("x".repeat(5000))).toHaveLength(600);
  expect(reviewPreview("")).toBe("");
});
