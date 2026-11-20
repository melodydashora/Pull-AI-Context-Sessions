// Generic text (docs/import-rules.md 2.5.4 `parseGenericText`, in the web form of W8): any
// text, cut into messages at speaker-marker lines. The last parser; it takes whatever the
// others did not recognise.

import { closedFenceLines } from "./fences.ts";
import { type RoleMarker, roleMarker } from "./markers.ts";
import { providerFromLabels } from "./provider.ts";
import { cleanTitle, isBlank, trimFull } from "./text.ts";
import type { ParsedMessage, ParsedSession, Role } from "./types.ts";

// W8: the markers of the text, one entry per line. A line inside a closed fenced block is
// never a marker (D7); an unterminated fence protects nothing.
function findMarkers(lines: readonly string[]): (RoleMarker | null)[] {
  const fenced = closedFenceLines(lines);
  const markers = lines.map((line, index) => (fenced[index] === true ? null : roleMarker(line)));
  // W8: bare markers count only if the text has at least one marker of role user AND one of
  // role assistant (of either kind); otherwise every bare marker is ordinary text.
  const hasUser = markers.some((marker) => marker?.role === "user");
  const hasAssistant = markers.some((marker) => marker?.role === "assistant");
  if (hasUser && hasAssistant) return markers;
  return markers.map((marker) => (marker?.bare === true ? null : marker));
}

/**
 * W8. null when the text is only white space (W12). `text` is W1-normalised and `lines` are
 * its lines. Text before the first marker becomes a message of role `unknown`; a line that
 * starts with a marker outside code starts a message, whatever the writer meant (3.3 item 3).
 */
export function parseGenericText(
  text: string,
  lines: readonly string[],
  title: string,
): ParsedSession | null {
  if (isBlank(text)) return null;
  const markers = findMarkers(lines);

  const messages: ParsedMessage[] = [];
  const labels: string[] = [];
  let role: Role | null = null;
  let body: string[] = [];
  const flush = (): void => {
    const joined = trimFull(body.join("\n"));
    if (joined !== "") messages.push({ role: role ?? "unknown", text: joined });
    body = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const marker = markers[index] ?? null;
    if (marker === null) {
      body.push(lines[index] ?? "");
      continue;
    }
    flush();
    role = marker.role;
    labels.push(marker.name);
    if (marker.rest !== "") body.push(marker.rest);
  }
  flush();
  // 2.5.4: markers and nothing between them. The text is not blank, so the message is not empty.
  if (messages.length === 0) messages.push({ role: "unknown", text: trimFull(text) });

  return {
    title: cleanTitle(title),
    // W9: from the labels of the markers used; no keyword scan of the content.
    provider: providerFromLabels(labels) ?? "other",
    model: "",
    sourceUrl: "",
    createdAt: null,
    summary: "",
    tags: [],
    messages,
  };
}
