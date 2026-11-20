import { expect, it } from "vitest";
import {
  fileRejectedMessage,
  flagMessage,
  importedMessage,
  linkHost,
  pastedSummary,
  pasteRejectedMessage,
  providerId,
  providerName,
  relativeTime,
  roleName,
  safeHttpLink,
  shownTitle,
  turnsLabel,
  vaultFileMessage,
} from "./format.ts";

it("shows a stored provider or role that it does not know as Other and Note", () => {
  expect(
    ["claude", " ChatGPT ", "GEMINI", "other", "perplexity", ""].map((value) =>
      providerName(providerId(value)),
    ),
  ).toEqual(["Claude", "ChatGPT", "Gemini", "Other", "Other", "Other"]);
  expect(["user", "assistant", "system", "unknown", "tool", "User", "constructor"].map(roleName)).toEqual([
    "User",
    "Assistant",
    "System",
    "Note",
    "Note",
    "Note",
    "Note",
  ]);
});

it("counts turns and names an empty title", () => {
  expect([0, 1, 2, 1500].map((count) => turnsLabel(count, "en"))).toEqual([
    "0 turns",
    "1 turn",
    "2 turns",
    "1,500 turns",
  ]);
  expect(shownTitle("")).toBe("Untitled");
  expect(shownTitle("   ")).toBe("Untitled");
  expect(shownTitle("Compost bin layout")).toBe("Compost bin layout");
});

it("says how long ago something was imported", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  expect(relativeTime(new Date("2026-11-20T09:00:00Z"), now, "en")).toBe("3 hours ago");
  expect(relativeTime(new Date("2026-11-19T12:00:00Z"), now, "en")).toBe("yesterday");
  expect(relativeTime(new Date("2026-11-21T12:00:00Z"), now, "en")).toBe("now");
});

it("links a stored source link only when it is http or https", () => {
  expect(safeHttpLink("https://claude.ai/share/EXAMPLE-0000")).toBe("https://claude.ai/share/EXAMPLE-0000");
  expect(safeHttpLink("  HTTP://example.com/a  ")).toBe("HTTP://example.com/a");
  for (const unsafe of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.com",
    "ftp://example.com",
    "",
    "https://",
    "mailto:a@example.com",
  ]) {
    expect(safeHttpLink(unsafe)).toBeNull();
  }
  expect(linkHost("https://chatgpt.com/share/EXAMPLE")).toBe("chatgpt.com");
  expect(linkHost("not a link")).toBeNull();
});

it("uses the wording of design.md 4.6.6", () => {
  expect(importedMessage(1, "files")).toBe("Imported 1 session.");
  expect(importedMessage(3, "files")).toBe("Imported 3 sessions.");
  expect(importedMessage(1, "clipboard")).toBe("Imported 1 session from clipboard.");
  expect(fileRejectedMessage("a.txt", "empty_input")).toBe("a.txt is empty.");
  expect(fileRejectedMessage("a.bin", "undecodable")).toBe("a.bin is not a text file.");
  expect(fileRejectedMessage("a.json", "unrecognised_json")).toBe("a.json is not a known chat export.");
  expect(fileRejectedMessage("a.md", "no_messages")).toBe("No sessions found in the selected files.");
  expect(pasteRejectedMessage("empty_input")).toBe("There is nothing to import.");
  expect(pasteRejectedMessage("sign_in_suspected")).toBe(
    "This looks like a sign-in or landing page, not a conversation.",
  );
  expect(flagMessage("a.txt", "decoded_as_utf_16be")).toBe("a.txt was read as UTF-16.");
  expect(flagMessage("a.txt", "decoded_as_windows_1252")).toBe(
    "a.txt is not UTF-8 and was read as Windows-1252. Check accented letters.",
  );
  expect(pastedSummary("one\ntwo\nthree", "en")).toBe("Pasted text: 13 characters, 3 lines.");
  expect(pastedSummary("x", "en")).toBe("Pasted text: 1 character, 1 line.");
});

it("says in one sentence what a vault file did", () => {
  const none = {
    added: 0,
    updated: 0,
    unchanged: 0,
    kept: 0,
    conflicts: 0,
    copies: 0,
    blobsStored: 0,
    projectsAdded: 0,
    projectsMerged: 0,
    projectsUpdated: 0,
    projectsUnchanged: 0,
    projectsKept: 0,
  };
  expect(vaultFileMessage("v.json", { ...none, added: 6, projectsAdded: 3 })).toBe(
    "v.json: 6 sessions added, 3 projects added.",
  );
  expect(vaultFileMessage("v.json", { ...none, added: 1, unchanged: 5 })).toBe(
    "v.json: 1 session added, 5 sessions unchanged.",
  );
  expect(vaultFileMessage("v.json", none)).toBe("v.json holds no session.");
});
