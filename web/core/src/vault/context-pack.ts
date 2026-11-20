// The context pack (docs/data-model.md 4.1, 8.3): one session as Markdown, made to be pasted into
// a new conversation with any model. A fixed template with no size limit; nothing is escaped,
// shortened or left out. It is a one-way format: backup and transfer use the interchange format.
//
// The test vectors of data-model.md 9.3 fix the output byte for byte.

/** What the pack prints of a session. `created_at` is the ORIGINAL date of the conversation. */
export interface ContextPackSession {
  readonly title: string;
  readonly provider: string;
  readonly model: string;
  readonly source_url: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly created_at: Date;
}

/** One message of the pack: its role and its flattened text (data-model.md 6.3). */
export interface ContextPackMessage {
  readonly role: string;
  readonly text: string;
}

export interface ContextPackOptions {
  /** IANA time zone of the viewer, for example "Europe/Berlin". It decides the calendar day printed. */
  readonly timeZone: string;
}

// Maps, not object lookups: a role named "constructor" in a foreign file cannot hit a built-in property.
const PROVIDER_LABEL: ReadonlyMap<string, string> = new Map([
  ["claude", "Claude"],
  ["chatgpt", "ChatGPT"],
  ["gemini", "Gemini"],
  ["other", "Other"],
]);
const ROLE_LABEL: ReadonlyMap<string, string> = new Map([
  ["user", "User"],
  ["assistant", "Assistant"],
  ["system", "System"],
  ["unknown", "Note"],
]);

/**
 * data-model.md 8.3: the context pack of a session.
 *
 * `messages` are in conversation order and `text` is the flattened text. Every message is printed,
 * whatever its role and also when its text is empty. A provider is matched trimmed and without
 * regard to case and prints as Claude, ChatGPT, Gemini or Other; a role is matched exactly and
 * prints as User, Assistant, System or Note. The date is the original date in the fixed form
 * "Mar 14, 2026" (B6: the Apple app prints it in the device's locale and time zone).
 *
 * The result ends with exactly one line feed. Its size is the size of the session: there is no
 * truncation (a caller may warn, using `text_bytes`, but must not shorten).
 *
 * Throws a RangeError when `timeZone` names no time zone or `created_at` holds no instant, and a
 * TypeError when no time zone is given: the zone of the machine is never used in its place.
 */
export function contextPackMarkdown(
  session: ContextPackSession,
  messages: readonly ContextPackMessage[],
  options: ContextPackOptions,
): string {
  const timeZone = options.timeZone;
  // B6: an explicit zone. Without this check a missing one would silently mean "this machine's".
  if (typeof timeZone !== "string") throw new TypeError("contextPackMarkdown needs a time zone.");
  const saved = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(session.created_at);
  const lines: string[] = [`# Context pack: ${session.title}`, ""];
  let origin = `Origin: ${PROVIDER_LABEL.get(session.provider.trim().toLowerCase()) ?? "Other"}`;
  if (session.model !== "") origin += ` (${session.model})`;
  lines.push(`${origin}, saved ${saved}`);
  if (session.source_url !== "") lines.push(`Source: ${session.source_url}`);
  if (session.tags.length > 0) lines.push(`Tags: ${session.tags.join(", ")}`);
  lines.push("");
  if (session.summary !== "") lines.push("## Summary", "", session.summary, "");
  lines.push(
    "You are being given the transcript of an earlier conversation the user had",
    "with another AI assistant. Read it, treat its decisions and facts as established",
    "context, and continue helping from where it left off.",
    "",
    "## Transcript",
    "",
  );
  for (const m of messages) lines.push(`**${ROLE_LABEL.get(m.role) ?? "Note"}:**`, "", m.text, "", "---", "");
  return lines.join("\n");
}

/** A stored session with its messages, as the vault holds it. */
export interface ContextPackSource extends ContextPackSession {
  readonly messages: readonly (ContextPackMessage & { readonly position: number })[];
}

/**
 * The context pack of a session of the vault: its messages by position (data-model.md 2.6), each
 * with its flattened text. Segments that are not text (attachments, unknown types) are not part
 * of that text and so not part of the pack (9.3, pack #5).
 */
export function sessionContextPack(session: ContextPackSource, options: ContextPackOptions): string {
  // Stable, as in the export (6.8): messages with equal positions keep their order.
  const ordered = [...session.messages].sort((a, b) => a.position - b.position);
  return contextPackMarkdown(session, ordered, options);
}
