// Speaker markers (docs/import-rules.md 2.4, in the web form of W8): one line in, a role and
// the text that followed the marker on the same line out, or nothing.

import { trimFull, trimInline } from "./text.ts";
import type { Role } from "./types.ts";

/** 2.4: the names in the order they are tried. The longer forms come first on purpose. */
const ROLE_NAMES: readonly (readonly [name: string, role: Role])[] = [
  ["you said", "user"],
  ["claude responded", "assistant"],
  ["claude said", "assistant"],
  ["chatgpt said", "assistant"],
  ["gemini said", "assistant"],
  ["user", "user"],
  ["human", "user"],
  ["you", "user"],
  ["me", "user"],
  ["assistant", "assistant"],
  ["claude", "assistant"],
  ["chatgpt", "assistant"],
  ["gpt", "assistant"],
  ["gemini", "assistant"],
  ["ai", "assistant"],
  ["system", "system"],
];

/** 2.4: the names that are a marker without a colon. "You", "Me", "System" are ordinary words. */
const BARE_NAMES: ReadonlySet<string> = new Set([
  "user",
  "human",
  "assistant",
  "claude",
  "chatgpt",
  "gemini",
]);

/** Length of the longest name, "claude responded". */
const LONGEST_NAME = 16;

export interface RoleMarker {
  readonly role: Role;
  /** Text after the marker on the same line, inline-trimmed; "" for a bare marker. */
  readonly rest: string;
  /** The matched name in lower case, for example "claude said" (W9 counts these). */
  readonly name: string;
  /** True for a name without a colon. */
  readonly bare: boolean;
}

function stripLeadingHashes(text: string): string {
  let start = 0;
  while (start < text.length && text.charCodeAt(start) === 0x23) start++;
  return start === 0 ? text : text.slice(start);
}

function dropBold(text: string): string {
  return text.startsWith("**") ? text.slice(2) : text;
}

/**
 * W8, the web form of 2.4: same names, same order, same bare set, but "**" is removed only
 * where it decorates the label, so bold text after the label survives (D7). For lines
 * without "**" this is the Apple marker, apart from the accidents of its string library
 * that D18 says to ignore. Whether a bare marker counts is the caller's rule.
 */
export function roleMarker(line: string): RoleMarker | null {
  const trimmed = trimInline(line);
  if (trimmed === "") return null;
  const candidate = dropBold(trimInline(stripLeadingHashes(trimmed)));
  // The names are ASCII and at most 16 long, so only the start of the line is lower-cased:
  // the result is that of lower-casing the whole line, without the cost on a very long one.
  const head = candidate.slice(0, LONGEST_NAME).toLowerCase();
  for (const [name, role] of ROLE_NAMES) {
    if (!head.startsWith(name)) continue;
    const after = dropBold(candidate.slice(name.length));
    if (after === "" && BARE_NAMES.has(name)) return { role, rest: "", name, bare: true };
    if (after.startsWith(":")) return { role, rest: trimInline(dropBold(after.slice(1))), name, bare: false };
  }
  return null;
}

export interface LeadingMarker {
  readonly role: Role;
  readonly name: string;
  /** The block without its marker, full-trimmed. "" when the block is only a label (W12). */
  readonly text: string;
}

/**
 * 2.4 `splitLeadingRoleMarker`: the first line of a puller block or of a captured turn is
 * tested with the marker function alone; a bare name counts here (W8, last paragraph).
 */
export function splitLeadingRoleMarker(block: string): LeadingMarker | null {
  const lineEnd = block.indexOf("\n");
  const marker = roleMarker(lineEnd === -1 ? block : block.slice(0, lineEnd));
  if (marker === null) return null;
  let remaining = lineEnd === -1 ? "" : block.slice(lineEnd + 1);
  if (marker.rest !== "") remaining = `${marker.rest}\n${remaining}`;
  return { role: marker.role, name: marker.name, text: trimFull(remaining) };
}
