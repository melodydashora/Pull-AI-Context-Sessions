// Entry point for pasted or shared text (docs/import-rules.md W11; C1, C3).

import { isSignInWall } from "./guards.ts";
import { linkOf } from "./link.ts";
import { parseText } from "./parse-text.ts";
import { providerForUrl } from "./provider.ts";
import { imported, rejected } from "./result.ts";
import { normaliseText, trimFull } from "./text.ts";
import type { ParsedSession, PasteImportResult, PasteOptions, Provider } from "./types.ts";

const PROVIDERS: ReadonlySet<string> = new Set(["claude", "chatgpt", "gemini", "other"]);

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && PROVIDERS.has(value);
}

/**
 * Imports pasted text. W11, in this order:
 * 1. W1; only white space: `empty_input`.
 * 2. The text is just a link: outcome `link` with that URL; nothing is imported.
 * 3. The text looks like a sign-in or landing page and `allowWall` is not set:
 *    `sign_in_suspected`, a warning the user answers with "import anyway" (D3, fixture 36).
 * 4. The text parsers; nothing to store: `no_messages`.
 * 5. For each session: a given `sourceUrl` is stored and, if its host is a known provider,
 *    decides the provider (W9); then the picker replaces `other`.
 */
export function importPaste(text: string, options: PasteOptions): PasteImportResult {
  // Callers outside the type system: text that is no string is no input.
  if (typeof text !== "string") return rejected("empty_input");
  const normal = normaliseText(text);
  const trimmed = trimFull(normal);
  if (trimmed === "") return rejected("empty_input");

  const linkUrl = linkOf(trimmed);
  if (linkUrl !== null) {
    return { outcome: "link", reason: null, linkUrl, flags: [], sessions: [], droppedTurns: [] };
  }
  if (options?.allowWall !== true && isSignInWall([normal])) return rejected("sign_in_suspected");

  const title = typeof options?.title === "string" ? options.title : "";
  // W1 on the link too: it is stored with the session (C5).
  const sourceUrl = typeof options?.sourceUrl === "string" ? normaliseText(options.sourceUrl) : "";
  const hostProvider = sourceUrl === "" ? null : providerForUrl(sourceUrl);
  const pickerProvider: Provider = isProvider(options?.pickerProvider) ? options.pickerProvider : "other";

  const sessions = parseText(normal, title).map((session): ParsedSession => {
    let provider = session.provider;
    if (hostProvider !== null) provider = hostProvider;
    if (provider === "other") provider = pickerProvider;
    return { ...session, provider, sourceUrl: sourceUrl === "" ? session.sourceUrl : sourceUrl };
  });
  if (sessions.length === 0) return rejected("no_messages");
  return imported(sessions);
}
