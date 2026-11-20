// Words and numbers as the screens show them (docs/design.md 4.6 and 4.13). Pure functions:
// the locale, the time zone and the current time are arguments.

import {
  type DocumentImportCounts,
  type ImportFlag,
  providerBehaviour,
  type RejectReason,
  roleBehaviour,
} from "@sessionvault/core";
import { relativeParts } from "@sessionvault/core/display";

export type ProviderId = "claude" | "chatgpt" | "gemini" | "other";
export const PROVIDER_IDS: readonly ProviderId[] = ["claude", "chatgpt", "gemini", "other"];

const PROVIDER_NAMES: Readonly<Record<ProviderId, string>> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  other: "Other",
};

/** design.md 4.6.1: any stored value that is not one of the four is shown as "Other". */
export function providerId(stored: string): ProviderId {
  return providerBehaviour(stored);
}

export function providerName(provider: ProviderId): string {
  return PROVIDER_NAMES[provider];
}

/** design.md 4.6.1: any stored role that is not one of the four is shown as "Note". */
export function roleName(stored: string): string {
  switch (roleBehaviour(stored)) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return "Note";
  }
}

export function isUserRole(stored: string): boolean {
  return roleBehaviour(stored) === "user";
}

/** "1 turn", otherwise "N turns" (design.md 4.6.3). */
export function turnsLabel(count: number, locale?: string): string {
  return count === 1 ? "1 turn" : `${new Intl.NumberFormat(locale).format(count)} turns`;
}

/** A title as lists show it: an empty title reads "Untitled" (design.md 4.6.3). */
export function shownTitle(title: string): string {
  return title.trim() === "" ? "Untitled" : title;
}

/** "3 hours ago", "yesterday": the relative time of a list row (design.md 4.6.3). */
export function relativeTime(then: Date, now: Date, locale?: string): string {
  const parts = relativeParts((now.getTime() - then.getTime()) / 1000);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(parts.value, parts.unit);
}

/** "Nov 12, 2026": the medium date of the counts line (design.md 4.6.4, rule 9). */
export function mediumDate(date: Date, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(
    locale,
    timeZone === undefined ? { dateStyle: "medium" } : { dateStyle: "medium", timeZone },
  ).format(date);
}

/** The full date and time, for the `title` of a relative time. */
export function fullDateTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(date);
}

/** The host of a link for the "Source: <host>" note, or null when the text is no http(s) link. */
export function linkHost(link: string): string | null {
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

/** design.md 4.7.3, rule 2: a stored source link is linked only when it is http or https. */
export function safeHttpLink(stored: string): string | null {
  const trimmed = stored.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return linkHost(trimmed) === null ? null : trimmed;
}

/** "Pasted text: 18,204 characters, 312 lines." (design.md 4.6.6). */
export function pastedSummary(text: string, locale?: string): string {
  const number = new Intl.NumberFormat(locale);
  let lines = text === "" ? 0 : 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  const characters = text.length;
  return `Pasted text: ${number.format(characters)} ${characters === 1 ? "character" : "characters"}, ${number.format(lines)} ${lines === 1 ? "line" : "lines"}.`;
}

// ---------------------------------------------------------------------------------------------
// The wording for results of the import (design.md 4.6.6; import-rules.md leaves it to that table).
// ---------------------------------------------------------------------------------------------

/** "Imported 2 sessions." For a paste: "Imported 1 session from clipboard." */
export function importedMessage(count: number, source: "files" | "clipboard"): string {
  const sessions = count === 1 ? "1 session" : `${count} sessions`;
  return source === "clipboard" ? `Imported ${sessions} from clipboard.` : `Imported ${sessions}.`;
}

/** Why one file gave no session. */
export function fileRejectedMessage(file: string, reason: RejectReason): string {
  switch (reason) {
    case "empty_input":
      return `${file} is empty.`;
    case "undecodable":
      return `${file} is not a text file.`;
    case "unrecognised_json":
      return `${file} is not a known chat export.`;
    case "no_conversation_found":
      return "No conversation content captured from the page.";
    case "sign_in_suspected":
      return "This looks like a sign-in or landing page, not a conversation.";
    default:
      return "No sessions found in the selected files.";
  }
}

/** The same reasons in the list of a report on several files. */
export function fileRejectedShort(reason: RejectReason): string {
  switch (reason) {
    case "empty_input":
      return "empty";
    case "undecodable":
      return "not a text file";
    case "unrecognised_json":
      return "not a known chat export";
    case "sign_in_suspected":
      return "looks like a sign-in or landing page";
    default:
      return "no messages found";
  }
}

/** Why a paste gave no session. */
export function pasteRejectedMessage(reason: RejectReason): string {
  switch (reason) {
    case "empty_input":
      return "There is nothing to import.";
    case "sign_in_suspected":
      return "This looks like a sign-in or landing page, not a conversation.";
    case "no_conversation_found":
      return "No conversation content captured from the page.";
    default:
      return "No sessions found in the selected files.";
  }
}

/** A note on how a file was read (import-rules.md W2). */
export function flagMessage(file: string, flag: ImportFlag): string {
  return flag === "decoded_as_windows_1252"
    ? `${file} is not UTF-8 and was read as Windows-1252. Check accented letters.`
    : `${file} was read as UTF-16.`;
}

/** What a vault file did to the vault, in one sentence. */
export function vaultFileMessage(file: string, counts: DocumentImportCounts): string {
  const parts: string[] = [];
  const say = (n: number, one: string, many: string): void => {
    if (n > 0) parts.push(n === 1 ? one : many.replace("%", String(n)));
  };
  say(counts.added, "1 session added", "% sessions added");
  say(counts.updated, "1 session updated", "% sessions updated");
  say(counts.unchanged, "1 session unchanged", "% sessions unchanged");
  say(counts.kept, "1 session kept as it was", "% sessions kept as they were");
  say(counts.projectsAdded, "1 project added", "% projects added");
  return parts.length === 0 ? `${file} holds no session.` : `${file}: ${parts.join(", ")}.`;
}
