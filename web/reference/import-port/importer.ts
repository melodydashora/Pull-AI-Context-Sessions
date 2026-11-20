// Reference port of apple/SessionVault/Importers.swift (+ the display splitter in Views/MessageView.swift).
//
// Purpose: a verification instrument for import-rules.md, not a shipped deliverable.
//   mode "apple": bug-for-bug behaviour of the Apple app. Checked against the real Swift importer
//                 (the harness) on every fixture and on randomised inputs.
//   mode "web"  : the behaviour import-rules.md asks the web app to have. It generates the
//                 *.expected.web.json files.
//
// Pure TypeScript with erasable types only. Ambient dependencies: Intl.Segmenter, URL, TextDecoder
// (all standard in browsers and in Node 18+). No DOM, no Node modules.

export type Mode = "apple" | "web";
export type Provider = "Claude" | "ChatGPT" | "Gemini" | "Other"; // Apple raw values (Models.swift:4-8)
export type Role = "user" | "assistant" | "system" | "unknown";

export interface ImportedMessage { role: Role; text: string }
export interface ImportedSession {
  title: string;
  provider: Provider;
  modelName: string;
  sourceURL: string;
  createdAt: string | null; // RFC 3339 UTC with milliseconds, or null when the source has no date
  messages: ImportedMessage[];
  summary?: string;  // only the web context-pack parser sets these two
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// CharacterSet.whitespaces: 19 scalars (verified by testing every Unicode scalar).
const INLINE_WS = "\\t \\u00A0\\u1680\\u2000-\\u200B\\u202F\\u205F\\u3000";
// CharacterSet.whitespacesAndNewlines: the 19 above plus LF, VT, FF, CR, NEL, LS, PS.
const ALL_WS = INLINE_WS + "\\n\\u000B\\f\\r\\u0085\\u2028\\u2029";
const RE_TRIM_INLINE = new RegExp("^[" + INLINE_WS + "]+|[" + INLINE_WS + "]+$", "g");
const RE_TRIM_ALL = new RegExp("^[" + ALL_WS + "]+|[" + ALL_WS + "]+$", "g");
const RE_RTRIM_INLINE = new RegExp("[" + INLINE_WS + "]+$");

/** Swift: s.trimmingCharacters(in: .whitespaces) */
export function trimInline(s: string): string { return s.replace(RE_TRIM_INLINE, ""); }
/** Swift: s.trimmingCharacters(in: .whitespacesAndNewlines) */
export function trimAll(s: string): string { return s.replace(RE_TRIM_ALL, ""); }

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Swift: s.count (extended grapheme clusters; "\r\n" counts as one). */
export function countGraphemes(s: string): number {
  let n = 0;
  for (const _ of SEGMENTER.segment(s)) n++;
  return n;
}
/** Swift: s.count < limit, without walking a very long string. */
export function fewerGraphemesThan(s: string, limit: number): boolean {
  if (s.length < limit) return true; // every grapheme has at least one UTF-16 unit
  let n = 0;
  for (const _ of SEGMENTER.segment(s)) { if (++n >= limit) return false; }
  return true;
}

/** Web only (W1): one leading BOM removed, CRLF and lone CR become LF, NUL removed. */
export function normaliseText(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  // Lone surrogates cannot be stored as UTF-8 text; String.prototype.toWellFormed (ES2024) turns them into U+FFFD.
  const wf = (s as unknown as { toWellFormed?: () => string }).toWellFormed;
  return typeof wf === "function" ? wf.call(s) : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Role markers (Importers.swift:392-431)
// ---------------------------------------------------------------------------

const ROLE_NAMES: [string, Role][] = [
  ["you said", "user"], ["claude responded", "assistant"], ["claude said", "assistant"],
  ["chatgpt said", "assistant"], ["gemini said", "assistant"],
  ["user", "user"], ["human", "user"], ["you", "user"], ["me", "user"],
  ["assistant", "assistant"], ["claude", "assistant"], ["chatgpt", "assistant"],
  ["gpt", "assistant"], ["gemini", "assistant"], ["ai", "assistant"],
  ["system", "system"],
];
const BARE_NAMES = new Set(["user", "human", "assistant", "claude", "chatgpt", "gemini"]);

export interface Marker { role: Role; rest: string; name: string; bare: boolean }

function roleMarkerApple(line: string): Marker | null {
  let candidate = trimInline(line);
  if (candidate === "") return null;
  while (candidate.startsWith("#")) candidate = candidate.slice(1);
  candidate = trimInline(candidate);
  candidate = candidate.split("**").join(""); // every "**" on the line is removed
  const lowered = candidate.toLowerCase();
  for (const [name, role] of ROLE_NAMES) {
    if (lowered === name && BARE_NAMES.has(name)) return { role, rest: "", name, bare: true };
    if (lowered.startsWith(name + ":")) {
      return { role, rest: trimInline(candidate.slice(name.length + 1)), name, bare: false };
    }
  }
  return null;
}

// Web: same label grammar, but "**" is removed only where it decorates the label,
// so bold text after the label survives.
function roleMarkerWeb(line: string): Marker | null {
  let candidate = trimInline(line);
  if (candidate === "") return null;
  candidate = trimInline(candidate.replace(/^#+/, ""));
  if (candidate.startsWith("**")) candidate = candidate.slice(2);
  const lowered = candidate.toLowerCase();
  for (const [name, role] of ROLE_NAMES) {
    if (!lowered.startsWith(name)) continue;
    let after = candidate.slice(name.length);
    if (after.startsWith("**")) after = after.slice(2);
    if (after === "" && BARE_NAMES.has(name)) return { role, rest: "", name, bare: true };
    if (after.startsWith(":")) {
      let rest = after.slice(1);
      if (rest.startsWith("**")) rest = rest.slice(2);
      return { role, rest: trimInline(rest), name, bare: false };
    }
  }
  return null;
}

export function roleMarker(line: string, mode: Mode): Marker | null {
  return mode === "apple" ? roleMarkerApple(line) : roleMarkerWeb(line);
}

function splitLeadingRoleMarker(block: string, mode: Mode): { role: Role; text: string; name: string } | null {
  const lines = block.split("\n");
  const marker = roleMarker(lines[0], mode);
  if (!marker) return null;
  let remaining = lines.slice(1).join("\n");
  if (marker.rest !== "") remaining = marker.rest + "\n" + remaining;
  return { role: marker.role, text: trimAll(remaining), name: marker.name };
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/** Web (W9): provider from the host of a URL. null when the host is not a known provider. */
export function providerFromURL(url: string): Provider | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const under = (domain: string) => host === domain || host.endsWith("." + domain);
  if (under("claude.ai")) return "Claude";
  if (under("chatgpt.com") || under("chat.openai.com")) return "ChatGPT";
  if (under("gemini.google.com") || under("gemini.google") || under("bard.google.com")) return "Gemini";
  if (under("g.co") && parsed.pathname.startsWith("/gemini")) return "Gemini";
  return null;
}

function providerOfLabel(name: string): Provider | null {
  if (name.startsWith("claude")) return "Claude";
  if (name.startsWith("chatgpt") || name === "gpt") return "ChatGPT";
  if (name.startsWith("gemini")) return "Gemini";
  return null;
}

/** Web (W9): the provider named most often by speaker labels; first seen wins a tie. */
function providerFromLabels(names: string[]): Provider | null {
  const counts = new Map<Provider, number>();
  for (const name of names) {
    const p = providerOfLabel(name);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: Provider | null = null;
  for (const [p, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = p;
  return best;
}

/** Apple: keyword scan over the whole text (Importers.swift:375-379). */
function providerFromKeywordsApple(text: string): Provider {
  const lowered = text.toLowerCase();
  if (lowered.includes("claude")) return "Claude";
  if (lowered.includes("chatgpt") || lowered.includes("gpt-")) return "ChatGPT";
  if (lowered.includes("gemini")) return "Gemini";
  return "Other";
}

// ---------------------------------------------------------------------------
// Share-page furniture (Importers.swift:47-88)
// ---------------------------------------------------------------------------

const BOILERPLATE_PREFIXES = [
  "Shared by ", "This is a copy of a chat", "Content may include unverified",
  "Shared snapshot may contain", "Ask Claude your own question", "Claude can make mistakes",
];
const BOILERPLATE_EXACT = new Set(["Report", "Copy", "Retry", "Share", "Claude"]);

function isBoilerplateLine(line: string): boolean {
  if (BOILERPLATE_EXACT.has(line)) return true;
  return BOILERPLATE_PREFIXES.some((p) => line.startsWith(p));
}

// Apple: ^\d{1,2}:\d{2}\s?(AM|PM)?$ as evaluated by String.range(of:options:.regularExpression)
// on macOS 27: "$" is the true end of the string and \d accepts any Unicode decimal digit.
const RE_TIMESTAMP_APPLE = new RegExp("^\\p{Nd}{1,2}:\\p{Nd}{2}[\\t\\n\\u000B\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]?(AM|PM)?$", "u");
// Web: ASCII digits. Lines never contain CR or LF here.
const RE_TIMESTAMP_WEB = /^[0-9]{1,2}:[0-9]{2}\s?(AM|PM)?$/;

function isTimestampLine(line: string, mode: Mode): boolean {
  return (mode === "apple" ? RE_TIMESTAMP_APPLE : RE_TIMESTAMP_WEB).test(line);
}

function cleanTranscriptLinesApple(lines: string[]): string[] {
  const kept: string[] = [];
  let lastNonEmpty = "";
  for (const raw of lines) {
    const line = trimInline(raw);
    if (line === "") {
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (isBoilerplateLine(line) || isTimestampLine(line, "apple")) continue;
    if (line === lastNonEmpty) continue;
    lastNonEmpty = line;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return kept;
}

// Web: the same three removal rules, but a kept line keeps its indentation, and an indented
// line (preformatted text, in practice code) is never removed.
function cleanTranscriptLinesWeb(lines: string[]): string[] {
  const fenced = new Array<boolean>(lines.length).fill(false);
  for (const f of scanFences(lines)) {
    if (f.close === null) continue;
    for (let k = f.open; k <= f.close; k++) fenced[k] = true;
  }
  const kept: string[] = [];
  let lastNonEmpty = "";
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    if (fenced[k]) { // a closed fenced code block is copied untouched, blank lines included
      kept.push(raw);
      lastNonEmpty = raw;
      continue;
    }
    const probe = trimInline(raw);
    if (probe === "") {
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    const line = raw.replace(RE_RTRIM_INLINE, ""); // indentation kept, trailing blanks removed
    const indented = line !== probe;
    if (!indented) {
      if (isBoilerplateLine(probe) || isTimestampLine(probe, "web")) continue;
      if (line === lastNonEmpty) continue;
    }
    lastNonEmpty = line;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return kept;
}

function cleanTranscriptLines(lines: string[], mode: Mode): string[] {
  return mode === "apple" ? cleanTranscriptLinesApple(lines) : cleanTranscriptLinesWeb(lines);
}

// ---------------------------------------------------------------------------
// Share-page text (Importers.swift:93-131)
// ---------------------------------------------------------------------------

function parseShareTextApple(text: string, title: string): ImportedSession | null {
  if (!(text.includes("You said:") || text.includes("Claude responded:"))) return null;
  const messages: ImportedMessage[] = [];
  let currentRole: Role | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    const cleaned = trimAll(cleanTranscriptLinesApple(currentLines).join("\n"));
    if (currentRole !== null && cleaned !== "") messages.push({ role: currentRole, text: cleaned });
    currentLines = [];
  };
  for (const rawLine of text.split("\n")) {
    const line = trimInline(rawLine);
    if (line.startsWith("You said:")) { flush(); currentRole = "user"; }
    else if (line.startsWith("Claude responded:")) { flush(); currentRole = "assistant"; }
    else if (currentRole !== null) currentLines.push(rawLine);
  }
  flush();
  if (messages.length === 0) return null;
  return { title, provider: "Claude", modelName: "", sourceURL: "", createdAt: null, messages };
}

const SHARE_HEADERS: { prefix: string; role: Role; provider: Provider | null }[] = [
  { prefix: "You said:", role: "user", provider: null },
  { prefix: "Claude responded:", role: "assistant", provider: "Claude" },
  { prefix: "Claude said:", role: "assistant", provider: "Claude" },
  { prefix: "ChatGPT said:", role: "assistant", provider: "ChatGPT" },
  { prefix: "Gemini said:", role: "assistant", provider: "Gemini" },
];

// Whole-line labels without a colon. Reported for Gemini pages by an earlier review; never checked
// against a live page. Honoured only when BOTH lines occur in the text.
const SHARE_BARE_HEADERS: { line: string; role: Role; provider: Provider | null }[] = [
  { line: "You said", role: "user", provider: null },
  { line: "Gemini said", role: "assistant", provider: "Gemini" },
];

// W6: the text after a speaker header is a preview exactly when the first non-blank line of the
// turn begins with it, after one trailing U+2026 or "..." and the white space before it have been
// cut from it, and one of these holds: an ellipsis was cut; the line ends where the text ends; or
// what follows in the line is not a letter, a digit or a combining mark (categories L, N and M).
// Without an ellipsis the text must end where a word ends: "No" is no preview of "Nothing works.".
function isPreviewOf(label: string, body: string[]): boolean {
  let stem = label;
  let ellipsisCut = true;
  if (stem.endsWith("\u2026")) stem = stem.slice(0, -1);
  else if (stem.endsWith("...")) stem = stem.slice(0, -3);
  else ellipsisCut = false;
  stem = trimInline(stem);
  const first = body.find((line) => trimInline(line) !== "");
  if (first === undefined) return false;
  const line = trimInline(first);
  if (!line.startsWith(stem)) return false;
  return ellipsisCut || !/^[\p{L}\p{N}\p{M}]/u.test(line.slice(stem.length));
}

function parseShareTextWeb(text: string, title: string): ImportedSession | null {
  const lines = text.split("\n");
  const trimmedLines = lines.map(trimInline);
  const bareEnabled = SHARE_BARE_HEADERS.every((h) => trimmedLines.includes(h.line));
  const triggered = bareEnabled || trimmedLines.some((t) => t.startsWith("You said:") || t.startsWith("Claude responded:"));
  if (!triggered) return null;
  const messages: ImportedMessage[] = [];
  const families: Provider[] = [];
  let currentRole: Role | null = null;
  let headerRemainder = "";
  let currentLines: string[] = [];
  const flush = () => {
    let kept = cleanTranscriptLinesWeb(currentLines);
    // W6 (defect D19): the text on a speaker line is the first line of its turn, unless it is a
    // preview of what follows. Apple drops it whenever more text follows.
    if (headerRemainder !== "" && !isPreviewOf(headerRemainder, kept)) {
      kept = cleanTranscriptLinesWeb([headerRemainder, ...currentLines]);
    }
    let cleaned = trimAll(kept.join("\n"));
    // A turn whose only text sits on its header line is kept instead of vanishing.
    if (cleaned === "") cleaned = headerRemainder;
    if (currentRole !== null && cleaned !== "") messages.push({ role: currentRole, text: cleaned });
    currentLines = [];
  };
  for (const rawLine of lines) {
    const line = trimInline(rawLine);
    const header = SHARE_HEADERS.find((h) => line.startsWith(h.prefix));
    const bare = header || !bareEnabled ? undefined : SHARE_BARE_HEADERS.find((h) => line === h.line);
    if (header || bare) {
      flush();
      currentRole = (header ?? bare)!.role;
      headerRemainder = header ? trimInline(line.slice(header.prefix.length)) : "";
      const family = (header ?? bare)!.provider;
      if (family) families.push(family);
    } else if (currentRole !== null) {
      currentLines.push(rawLine);
    }
  }
  flush();
  if (messages.length === 0) return null;
  const counts = new Map<Provider, number>();
  for (const p of families) counts.set(p, (counts.get(p) ?? 0) + 1);
  let provider: Provider = "Other";
  let bestCount = 0;
  for (const [p, n] of counts) if (n > bestCount) { provider = p; bestCount = n; }
  return { title: cleanTitle(title), provider, modelName: "", sourceURL: "", createdAt: null, messages };
}

function cleanTitle(title: string): string {
  const t = trimAll(title);
  return t === "" ? "Imported session" : t;
}

// ---------------------------------------------------------------------------
// Puller markdown (Importers.swift:237-277)
// ---------------------------------------------------------------------------

function parsePullerMarkdownApple(text: string): ImportedSession | null {
  const lines = text.split("\n");
  if (!(lines.length >= 2 && lines[0].startsWith("# ") && lines[1].startsWith("Source: "))) return null;
  const title = trimInline(lines[0].slice(2));
  const source = trimInline(lines[1].slice("Source: ".length));
  const provider: Provider = source.includes("claude.ai") ? "Claude" : "Other";
  let blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines.slice(2)) {
    if (trimInline(line) === "---") { blocks.push(current.join("\n")); current = []; }
    else current.push(line);
  }
  blocks.push(current.join("\n"));
  blocks = blocks.map(trimAll).filter((b) => b !== "");
  const messages: ImportedMessage[] = [];
  for (const block of blocks) {
    const split = splitLeadingRoleMarker(block, "apple");
    if (split) messages.push({ role: split.role, text: split.text }); // text may be ""
    else messages.push({ role: "unknown", text: block });
  }
  return { title, provider, modelName: "", sourceURL: source, createdAt: null, messages };
}

/** Web: null when the text is not puller markdown; otherwise 0..n sessions (0 = header but no turns). */
function parsePullerMarkdownWeb(text: string, fallbackTitle: string): ImportedSession[] | null {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && trimInline(lines[start]) === "") start++;
  const isHeaderAt = (i: number) =>
    i + 1 < lines.length && lines[i].startsWith("# ") && lines[i + 1].startsWith("Source: ");
  if (!isHeaderAt(start)) return null;

  const sessions: ImportedSession[] = [];
  let title = "";
  let source = "";
  let blocks: string[] = [];
  let current: string[] = [];
  let currentHasText = false;
  const closeSession = () => {
    blocks.push(current.join("\n"));
    const messages: ImportedMessage[] = [];
    const labels: string[] = [];
    for (const block of blocks.map(trimAll).filter((b) => b !== "")) {
      const split = splitLeadingRoleMarker(block, "web");
      if (split) {
        labels.push(split.name);
        if (split.text !== "") messages.push({ role: split.role, text: split.text });
      } else {
        messages.push({ role: "unknown", text: block });
      }
    }
    if (messages.length > 0) {
      const provider = providerFromURL(source) ?? providerFromLabels(labels) ?? "Other";
      const t = title === "" ? cleanTitle(fallbackTitle) : title;
      sessions.push({ title: t, provider, modelName: "", sourceURL: source, createdAt: null, messages });
    }
  };
  let i = start;
  let open = false;
  while (i < lines.length) {
    // A header pair at the start of a block (nothing but blank lines since the last
    // separator or header) starts a session. This is how `--combine` files are split.
    if (!currentHasText && isHeaderAt(i)) {
      if (open) closeSession();
      open = true;
      title = trimInline(lines[i].slice(2));
      source = trimInline(lines[i + 1].slice("Source: ".length));
      blocks = [];
      current = [];
      currentHasText = false;
      i += 2;
      continue;
    }
    const line = lines[i];
    if (trimInline(line) === "---") {
      blocks.push(current.join("\n"));
      current = [];
      currentHasText = false;
    } else {
      current.push(line);
      if (trimInline(line) !== "") currentHasText = true;
    }
    i++;
  }
  if (open) closeSession();
  return sessions;
}

// ---------------------------------------------------------------------------
// Fences (shared by the web generic parser and the web display splitter)
// ---------------------------------------------------------------------------

interface Fence { open: number; close: number | null; info: string; ticks: number }

/** Web: CommonMark-style backtick fences. close === null means the fence runs to the end. */
function scanFences(lines: string[]): Fence[] {
  const fences: Fence[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = trimInline(lines[i]);
    const m = /^(`{3,})(.*)$/.exec(t);
    if (m && !m[2].includes("`")) {
      const ticks = m[1].length;
      let j = i + 1;
      while (j < lines.length) {
        const c = trimInline(lines[j]);
        if (/^`{3,}$/.test(c) && c.length >= ticks) break;
        j++;
      }
      if (j < lines.length) {
        fences.push({ open: i, close: j, info: trimInline(m[2]), ticks });
        i = j + 1;
        continue;
      }
      fences.push({ open: i, close: null, info: trimInline(m[2]), ticks });
      break;
    }
    i++;
  }
  return fences;
}

// ---------------------------------------------------------------------------
// Generic text (Importers.swift:347-388)
// ---------------------------------------------------------------------------

function parseGenericTextApple(text: string, title: string): ImportedSession {
  let messages: ImportedMessage[] = [];
  let currentRole: Role | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    const body = trimAll(currentLines.join("\n"));
    if (body !== "") messages.push({ role: currentRole ?? "unknown", text: body });
    currentLines = [];
  };
  for (const line of text.split("\n")) {
    const marker = roleMarkerApple(line);
    if (marker) {
      flush();
      currentRole = marker.role;
      if (marker.rest !== "") currentLines.push(marker.rest);
    } else {
      currentLines.push(line);
    }
  }
  flush();
  if (messages.length === 0) messages = [{ role: "unknown", text: trimAll(text) }]; // may be ""
  const clean = trimAll(title);
  return {
    title: clean === "" ? "Imported session" : clean,
    provider: providerFromKeywordsApple(text),
    modelName: "", sourceURL: "", createdAt: null, messages,
  };
}

/** Web: null when the text holds nothing but white space. */
function parseGenericTextWeb(text: string, title: string): ImportedSession | null {
  if (trimAll(text) === "") return null;
  const lines = text.split("\n");
  // 1. Lines inside a CLOSED fenced code block are never role markers.
  const inFence = new Array<boolean>(lines.length).fill(false);
  for (const f of scanFences(lines)) {
    if (f.close === null) continue; // an unterminated fence protects nothing
    for (let k = f.open; k <= f.close; k++) inFence[k] = true;
  }
  const markers: (Marker | null)[] = lines.map((l, k) => (inFence[k] ? null : roleMarkerWeb(l)));
  // 2. Bare names (no colon) count only when the text is visibly a dialogue.
  const hasUser = markers.some((m) => m !== null && m.role === "user");
  const hasAssistant = markers.some((m) => m !== null && m.role === "assistant");
  if (!(hasUser && hasAssistant)) {
    for (let k = 0; k < markers.length; k++) if (markers[k]?.bare) markers[k] = null;
  }
  // 3. Same assembly as the Apple parser.
  let messages: ImportedMessage[] = [];
  const labels: string[] = [];
  let currentRole: Role | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    const body = trimAll(currentLines.join("\n"));
    if (body !== "") messages.push({ role: currentRole ?? "unknown", text: body });
    currentLines = [];
  };
  lines.forEach((line, k) => {
    const marker = markers[k];
    if (marker) {
      flush();
      currentRole = marker.role;
      labels.push(marker.name);
      if (marker.rest !== "") currentLines.push(marker.rest);
    } else {
      currentLines.push(line);
    }
  });
  flush();
  if (messages.length === 0) messages = [{ role: "unknown", text: trimAll(text) }];
  return {
    title: cleanTitle(title),
    provider: providerFromLabels(labels) ?? "Other", // no keyword scan of the content
    modelName: "", sourceURL: "", createdAt: null, messages,
  };
}

// ---------------------------------------------------------------------------
// Context pack (the Apple app's own export, ContextPack.swift:7-43). Web only: the Apple
// importer has no parser for it and re-imports its own export badly.
// ---------------------------------------------------------------------------

const CONTEXT_PACK_HEADERS: Record<string, Role> = {
  "**User:**": "user", "**Assistant:**": "assistant", "**System:**": "system", "**Note:**": "unknown",
};
const CONTEXT_PACK_PREAMBLE = "You are being given the transcript of an earlier conversation";

function parseContextPackWeb(text: string): ImportedSession | null {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && trimInline(lines[start]) === "") start++;
  const TITLE = "# Context pack: ";
  if (start >= lines.length || !lines[start].startsWith(TITLE)) return null;
  let transcript = -1;
  for (let k = start + 1; k < lines.length; k++) if (trimInline(lines[k]) === "## Transcript") { transcript = k; break; }
  if (transcript < 0) return null;

  let provider: Provider = "Other";
  let model = "";
  let source = "";
  let tags: string[] = [];
  let summary = "";
  let k = start + 1;
  for (; k < transcript; k++) {
    const line = lines[k];
    if (trimInline(line) === "## Summary") break;
    if (line.startsWith("Origin: ")) {
      let origin = line.slice("Origin: ".length);
      const cut = origin.lastIndexOf(", saved ");
      if (cut >= 0) origin = origin.slice(0, cut);
      const m = /^(.*?)(?: \((.*)\))?$/.exec(origin);
      const name = trimInline(m ? m[1] : origin).toLowerCase();
      model = m && m[2] ? trimInline(m[2]) : "";
      provider = name === "claude" ? "Claude" : name === "chatgpt" ? "ChatGPT" : name === "gemini" ? "Gemini" : "Other";
    } else if (line.startsWith("Source: ")) {
      source = trimInline(line.slice("Source: ".length));
    } else if (line.startsWith("Tags: ")) {
      tags = line.slice("Tags: ".length).split(",").map((t) => trimInline(t).toLowerCase()).filter((t) => t !== "");
    }
  }
  if (k < transcript) { // a "## Summary" section: everything up to the hand-off preamble
    const collected: string[] = [];
    for (k = k + 1; k < transcript; k++) {
      if (lines[k].startsWith(CONTEXT_PACK_PREAMBLE)) break;
      collected.push(lines[k]);
    }
    summary = trimAll(collected.join("\n"));
  }

  // A message ends at a "---" line that is followed (after blank lines) by a role header or by nothing.
  const body = lines.slice(transcript + 1);
  const nextNonBlank = (from: number): string | null => {
    for (let j = from; j < body.length; j++) { const t = trimInline(body[j]); if (t !== "") return t; }
    return null;
  };
  const messages: ImportedMessage[] = [];
  let chunk: string[] = [];
  const closeChunk = () => {
    let j = 0;
    while (j < chunk.length && trimInline(chunk[j]) === "") j++;
    if (j < chunk.length) {
      const role = CONTEXT_PACK_HEADERS[trimInline(chunk[j])];
      const content = trimAll((role === undefined ? chunk.slice(j) : chunk.slice(j + 1)).join("\n"));
      if (content !== "") messages.push({ role: role ?? "unknown", text: content });
    }
    chunk = [];
  };
  for (let j = 0; j < body.length; j++) {
    if (trimInline(body[j]) === "---") {
      const next = nextNonBlank(j + 1);
      if (next === null || CONTEXT_PACK_HEADERS[next] !== undefined) { closeChunk(); continue; }
    }
    chunk.push(body[j]);
  }
  closeChunk();
  if (messages.length === 0) return null;
  const session: ImportedSession = {
    title: cleanTitle(lines[start].slice(TITLE.length)), provider, modelName: model, sourceURL: source, createdAt: null, messages,
  };
  if (summary !== "") session.summary = summary;
  if (tags.length > 0) session.tags = tags;
  return session;
}

// ---------------------------------------------------------------------------
// parseText (Importers.swift:35-43)
// ---------------------------------------------------------------------------

export function parseText(text: string, title: string, mode: Mode): ImportedSession[] {
  if (mode === "apple") {
    const pulled = parsePullerMarkdownApple(text);
    if (pulled) return [pulled];
    const shared = parseShareTextApple(text, title);
    if (shared) return [shared];
    return [parseGenericTextApple(text, title)];
  }
  text = normaliseText(text);
  const pack = parseContextPackWeb(text);
  if (pack) return [pack];
  const pulled = parsePullerMarkdownWeb(text, title);
  if (pulled) return pulled; // possibly empty: header found but no turns
  const shared = parseShareTextWeb(text, title);
  if (shared) return [shared];
  const generic = parseGenericTextWeb(text, title);
  return generic ? [generic] : [];
}

// ---------------------------------------------------------------------------
// ChatGPT data export (Importers.swift:281-343)
// ---------------------------------------------------------------------------

function isoFromEpochSeconds(seconds: number): string | null {
  const ms = Math.floor(seconds * 1000);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseChatGPTExport(obj: unknown, mode: Mode): ImportedSession[] | null {
  let conversations: unknown[];
  if (Array.isArray(obj)) {
    if (mode === "apple" && !obj.every(isPlainObject)) return null;
    conversations = obj;
  } else if (isPlainObject(obj) && obj["mapping"] !== undefined) {
    conversations = [obj];
  } else {
    return null;
  }
  if (mode === "apple") {
    // All-or-nothing: one entry without a mapping object rejects the whole file.
    if (!conversations.every((c) => isPlainObject((c as Record<string, unknown>)["mapping"]))) return null;
  } else {
    conversations = conversations.filter((c) => isPlainObject(c) && isPlainObject(c["mapping"]));
    if (conversations.length === 0) return null;
  }

  const sessions: ImportedSession[] = [];
  for (const c of conversations) {
    const convo = c as Record<string, unknown>;
    const mapping = convo["mapping"] as Record<string, unknown>;
    let title: string;
    if (mode === "apple") {
      title = typeof convo["title"] === "string" && convo["title"] !== "" ? convo["title"] : "ChatGPT conversation";
    } else {
      const t = typeof convo["title"] === "string" ? trimAll(normaliseText(convo["title"])) : "";
      title = t === "" ? "ChatGPT conversation" : t;
    }
    const ct = convo["create_time"];
    let created: string | null = null;
    if (typeof ct === "number") created = isoFromEpochSeconds(ct);
    else if (mode === "apple" && typeof ct === "boolean") created = isoFromEpochSeconds(ct ? 1 : 0); // NSNumber bridging

    const timeOf = (node: Record<string, unknown>): number => {
      const m = node["message"];
      const t = isPlainObject(m) ? m["create_time"] : undefined;
      if (typeof t === "number") return t;
      if (mode === "apple" && typeof t === "boolean") return t ? 1 : 0;
      return 0;
    };
    const byTime = (): Record<string, unknown>[] =>
      // Apple: Dictionary.values has no defined order and sorted() is not stable, so ties come out
      // in a different order on every run. Web: stable sort, ties keep the order of the JSON keys.
      Object.keys(mapping).map((k) => mapping[k]).filter(isPlainObject)
        .map((node, index) => ({ node, index }))
        .sort((a, b) => timeOf(a.node) - timeOf(b.node) || a.index - b.index)
        .map((x) => x.node);

    let nodes: Record<string, unknown>[] = [];
    if (typeof convo["current_node"] === "string") {
      let cursor: unknown = convo["current_node"];
      const seen = new Set<string>();
      while (typeof cursor === "string" && Object.prototype.hasOwnProperty.call(mapping, cursor) && isPlainObject(mapping[cursor])) {
        if (seen.has(cursor)) {
          if (mode === "apple") throw new Error("apple: parent cycle, the Swift importer never returns");
          break; // web: stop at the first repeated id
        }
        seen.add(cursor);
        const node = mapping[cursor] as Record<string, unknown>;
        nodes.push(node);
        cursor = node["parent"];
      }
      nodes.reverse();
      if (mode === "web" && nodes.length === 0) nodes = byTime(); // dangling current_node
    } else {
      nodes = byTime();
    }

    const messages: ImportedMessage[] = [];
    for (const node of nodes) {
      const message = node["message"];
      if (!isPlainObject(message)) continue;
      const author = message["author"];
      if (!isPlainObject(author) || typeof author["role"] !== "string") continue;
      const content = message["content"];
      if (!isPlainObject(content)) continue;
      const parts = Array.isArray(content["parts"]) ? content["parts"].filter((p): p is string => typeof p === "string") : [];
      let text = parts.join("\n");
      if (mode === "web") text = normaliseText(text);
      text = trimAll(text);
      if (text === "") continue;
      const raw = author["role"];
      const role: Role = raw === "user" ? "user" : raw === "assistant" ? "assistant" : raw === "system" ? "system" : "unknown";
      if (role === "system") continue;
      messages.push({ role, text });
    }
    if (messages.length === 0) continue;
    sessions.push({ title, provider: "ChatGPT", modelName: "", sourceURL: "", createdAt: created, messages });
  }
  // Apple: nil, so the caller falls back to importing the raw JSON text. Web: recognised, but empty.
  return sessions.length === 0 ? (mode === "apple" ? null : []) : sessions;
}

// ---------------------------------------------------------------------------
// File names (NSString.pathExtension / deletingPathExtension, Importers.swift:25,32)
// ---------------------------------------------------------------------------

export function splitExtension(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { stem: filename, ext: "" }; // no dot, or a leading dot (hidden file)
  const ext = filename.slice(dot + 1);
  if (ext === "" || ext.includes(" ")) return { stem: filename, ext: "" };
  return { stem: filename.slice(0, dot), ext };
}

// ---------------------------------------------------------------------------
// Bytes to text
// ---------------------------------------------------------------------------

function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; } // strips one BOM
}

export interface Decoded { text: string; flag: string | null }

/** Web (W2). null = not text. */
export function decodeBytesWeb(bytes: Uint8Array): Decoded | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    const t = decodeUtf8Strict(b);
    if (t !== null) return { text: t, flag: null };
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(b), flag: "decoded_as_utf_16le" };
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(b), flag: "decoded_as_utf_16be" };
  // UTF-16 without a BOM: mostly-Latin text has a zero in every second byte.
  const n = Math.min(b.length, 4096) & ~1;
  const pairs = n / 2;
  if (pairs >= 2) {
    let zeroEven = 0, zeroOdd = 0;
    for (let i = 0; i < n; i += 2) { if (b[i] === 0) zeroEven++; if (b[i + 1] === 0) zeroOdd++; }
    if (zeroOdd >= 0.4 * pairs && zeroEven <= 0.05 * pairs) return { text: new TextDecoder("utf-16le").decode(b), flag: "decoded_as_utf_16le" };
    if (zeroEven >= 0.4 * pairs && zeroOdd <= 0.05 * pairs) return { text: new TextDecoder("utf-16be").decode(b), flag: "decoded_as_utf_16be" };
  }
  const utf8 = decodeUtf8Strict(b);
  if (utf8 !== null) return { text: utf8, flag: null };
  // Not UTF-8. Binary data has control bytes that text never has.
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0c && c !== 0x0d) return null;
  }
  return { text: new TextDecoder("windows-1252").decode(b), flag: "decoded_as_windows_1252" };
}

// ---------------------------------------------------------------------------
// Entry: file (Importers.swift:24-33, 456-468; Views/ImportSheet.swift:183-193)
// ---------------------------------------------------------------------------

export interface ImportResult {
  entry: string;
  outcome: "imported" | "rejected" | "link";
  reason: string | null;
  statusMessage?: string;
  sessions: ImportedSession[];
  flags?: string[];
  linkURL?: string;
  droppedTurns?: { position: "leading" | "trailing"; index: number; text: string }[];
}

const plural = (n: number) => (n === 1 ? "" : "s");

function parseJSONLikeApple(bytes: Uint8Array): unknown {
  // JSONSerialization detects UTF-8/16/32 with or without a BOM and refuses top-level scalars.
  let text: string | null = null;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le").decode(bytes);
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder("utf-16be").decode(bytes);
  else text = decodeUtf8Strict(bytes);
  if (text === null) return undefined;
  try {
    const v = JSON.parse(text);
    return typeof v === "object" && v !== null ? v : undefined;
  } catch { return undefined; }
}

export function importFile(bytes: Uint8Array, filename: string, mode: Mode): ImportResult {
  const { stem, ext } = splitExtension(filename);
  if (mode === "apple") {
    let sessions: ImportedSession[] = [];
    let handled = false;
    if (ext.toLowerCase() === "json") {
      const obj = parseJSONLikeApple(bytes);
      const parsed = obj === undefined ? null : parseChatGPTExport(obj, "apple");
      if (parsed) { sessions = parsed; handled = true; }
    }
    let reason: string | null = null;
    if (!handled) {
      const text = decodeUtf8Strict(bytes);
      if (text === null) reason = "undecodable";
      else if (text === "") reason = "empty_input";
      else sessions = parseText(text, stem, "apple");
    }
    return sessions.length === 0
      ? { entry: "file", outcome: "rejected", reason, statusMessage: "No sessions found in the selected files.", sessions: [] }
      : { entry: "file", outcome: "imported", reason: null, statusMessage: `Imported ${sessions.length} session${plural(sessions.length)}.`, sessions };
  }

  const reject = (reason: string, flags: string[] = []): ImportResult => ({ entry: "file", outcome: "rejected", reason, sessions: [], flags });
  if (bytes.length === 0) return reject("empty_input");
  const decoded = decodeBytesWeb(bytes);
  if (decoded === null) return reject("undecodable");
  const flags = decoded.flag ? [decoded.flag] : [];
  const text = normaliseText(decoded.text);
  if (trimAll(text) === "") return reject("empty_input", flags);
  if (ext.toLowerCase() === "json") {
    let obj: unknown;
    try { obj = JSON.parse(text); } catch { return reject("unrecognised_json", flags); }
    // (The interchange format of data-model.md is recognised here, before anything else. Not part of this port.)
    const sessions = parseChatGPTExport(obj, "web");
    if (!sessions) return reject("unrecognised_json", flags);
    if (sessions.length === 0) return reject("no_messages", flags);
    return { entry: "file", outcome: "imported", reason: null, sessions, flags };
  }
  const sessions = parseText(text, stem, "web");
  if (sessions.length === 0) return reject("no_messages", flags);
  return { entry: "file", outcome: "imported", reason: null, sessions, flags };
}

// ---------------------------------------------------------------------------
// Entry: paste (Views/ImportSheet.swift:195-226)
// ---------------------------------------------------------------------------

function hostOrNull(candidate: string): URL | null {
  try { const u = new URL(candidate); return u.hostname === "" ? null : u; } catch { return null; }
}

export interface PasteOptions { title?: string; sourceURL?: string; allowWall?: boolean }

export function importPaste(text: string, pasteProvider: Provider, mode: Mode, options: PasteOptions = {}): ImportResult {
  if (mode === "apple") {
    const trimmed = trimAll(text);
    if (trimmed === "") return { entry: "paste", outcome: "rejected", reason: "empty_input", statusMessage: "Clipboard is empty.", sessions: [] };
    // Swift's contains() works on grapheme clusters: "\r\n" is one Character, so a CRLF pair is
    // NOT found by contains("\n"). Only a lone LF is.
    const hasLoneLF = /(^|[^\r])\n/.test(trimmed);
    if (!hasLoneLF && !trimmed.includes(" ") && trimmed.includes(".") && countGraphemes(trimmed) < 500) {
      let candidate = trimmed;
      if (!candidate.includes("://")) candidate = "https://" + candidate;
      // Foundation's URL(string:) and the WHATWG URL parser disagree on odd inputs; this branch is
      // exact only for ordinary http(s) links, which is all the fixtures use.
      const url = hostOrNull(candidate);
      if (url) {
        return { entry: "paste", outcome: "link", reason: null, linkURL: candidate, statusMessage: "That's a link — opening it in the capture browser.", sessions: [] };
      }
    }
    const sessions = parseText(text, "Pasted session", "apple").map((s) => (s.provider === "Other" ? { ...s, provider: pasteProvider } : s));
    return { entry: "paste", outcome: "imported", reason: null, statusMessage: `Imported ${sessions.length} session${plural(sessions.length)} from clipboard.`, sessions };
  }

  const normal = normaliseText(text);
  const trimmed = trimAll(normal);
  if (trimmed === "") return { entry: "paste", outcome: "rejected", reason: "empty_input", sessions: [], flags: [] };
  const link = looksLikeLink(trimmed);
  if (link) return { entry: "paste", outcome: "link", reason: null, linkURL: link, sessions: [], flags: [] };
  // The sign-in-wall test is a warning the user can override, not a dead end.
  if (looksLikeSignInWall([normal]) && !options.allowWall) {
    return { entry: "paste", outcome: "rejected", reason: "sign_in_suspected", sessions: [], flags: [] };
  }
  const urlProvider = options.sourceURL ? providerFromURL(options.sourceURL) : null;
  const sessions = parseText(normal, options.title ?? "Pasted session", "web").map((s) => {
    const out = { ...s };
    if (options.sourceURL) {
      out.sourceURL = options.sourceURL;          // the link the text was copied from
      if (urlProvider) out.provider = urlProvider; // the link decides, whatever words the text contains
    }
    if (out.provider === "Other") out.provider = pasteProvider;
    return out;
  });
  if (sessions.length === 0) return { entry: "paste", outcome: "rejected", reason: "no_messages", sessions: [], flags: [] };
  return { entry: "paste", outcome: "imported", reason: null, sessions, flags: [] };
}

/** Web: `looksLikeLink` of capture.md section 8.1. Returns the https URL, or null. */
export function looksLikeLink(text: string): string | null {
  const t = trimAll(text);
  if (t === "" || !fewerGraphemesThan(t, 500) || /\s/.test(t)) return null;
  const candidate = t.includes("://") ? t : "https://" + t;
  let u: URL;
  try { u = new URL(candidate); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname;
  if (!host.includes(".") || host.endsWith(".")) return null;
  if (!/^[a-z]{2,}$/i.test(host.slice(host.lastIndexOf(".") + 1))) return null;
  u.protocol = "https:";
  return u.href;
}

// ---------------------------------------------------------------------------
// Guards (Importers.swift:133-198)
// ---------------------------------------------------------------------------

const SIGN_IN_WALL_MARKERS = [
  "sign in", "log in", "meet gemini", "google terms", "terms of service",
  "just a moment", "verify you are human", "welcome back",
  "your personal ai assistant", "cookie", "privacy policy",
];

export function looksLikeSignInWall(turns: string[]): boolean {
  const joined = turns.join("\n");
  const lowered = joined.toLowerCase();
  const hits = SIGN_IN_WALL_MARKERS.filter((m) => lowered.includes(m)).length;
  if (fewerGraphemesThan(joined, 1200)) return hits >= 2;
  if (fewerGraphemesThan(joined, 2500)) return hits >= 4;
  return false;
}

function isChromeTurn(text: string): boolean {
  if (!fewerGraphemesThan(text, 700)) return false;
  const lowered = text.toLowerCase();
  const hits = SIGN_IN_WALL_MARKERS.filter((m) => lowered.includes(m)).length;
  return lowered.includes("ai overview")
    || lowered.includes("can make mistakes")
    || (hits >= 1 && lowered.includes("sign in"))
    || hits >= 2;
}

const HEADER_MARKERS = ["sign in", "log in", "created with", "conversation transcript", "shared conversation", "ai overview"];

function stripLeadingHeaderLines(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  let dropped = 0;
  while (i < lines.length && dropped < 12) {
    const trimmed = trimInline(lines[i]);
    const lowered = trimmed.toLowerCase();
    const headerish = trimmed === "" || (fewerGraphemesThan(trimmed, 90) && HEADER_MARKERS.some((m) => lowered.includes(m)));
    if (!headerish) break;
    i++;
    dropped++;
  }
  const stripped = trimAll(lines.slice(i).join("\n"));
  return stripped === "" ? text : stripped; // everything matched: keep the original
}

export interface ChromeResult { kept: string[]; dropped: { position: "leading" | "trailing"; index: number; text: string }[] }

export function stripChromeTurns(turns: string[], mode: Mode, keepDropped: readonly number[] = []): ChromeResult {
  const dropped: ChromeResult["dropped"] = [];
  let lead = 0;
  let firstStripped: string | null = null;
  if (mode === "apple") {
    // The chrome test sees the RAW first turn, so header residue can condemn a real turn.
    while (lead < turns.length && isChromeTurn(turns[lead])) lead++;
  } else {
    // Web: remove header residue first, then judge what is left.
    while (lead < turns.length) {
      const stripped = stripLeadingHeaderLines(turns[lead]);
      if (!isChromeTurn(stripped)) { firstStripped = stripped; break; }
      lead++;
    }
  }
  let end = turns.length;
  while (end > lead && isChromeTurn(turns[end - 1])) {
    if (mode === "web" && end - 1 === lead) break; // the first kept turn was already judged
    end--;
  }
  if (mode === "web" && keepDropped.length > 0) {
    // import-rules.md W10, "restore": the two scans above are unchanged. A dropped turn whose input index is
    // named goes back to its place: one dropped from the front in the form the scan judged (header lines
    // stripped), one dropped from the end as it is. An index that names no dropped turn is ignored.
    const restore = new Set(keepDropped);
    const keptAfterRestore: string[] = [];
    for (let i = 0; i < turns.length; i++) {
      if (i >= lead && i < end) keptAfterRestore.push(i === lead ? (firstStripped ?? stripLeadingHeaderLines(turns[i])) : turns[i]);
      else if (restore.has(i)) keptAfterRestore.push(i < lead ? stripLeadingHeaderLines(turns[i]) : turns[i]);
      else dropped.push({ position: i < lead ? "leading" : "trailing", index: i, text: turns[i] });
    }
    return { kept: keptAfterRestore, dropped };
  }
  for (let i = 0; i < lead; i++) dropped.push({ position: "leading", index: i, text: turns[i] });
  for (let i = end; i < turns.length; i++) dropped.push({ position: "trailing", index: i, text: turns[i] });
  const kept = turns.slice(lead, end);
  if (kept.length > 0) kept[0] = firstStripped ?? stripLeadingHeaderLines(kept[0]);
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Entry: capture result (Importers.swift:201-233; Views/LinkCaptureView.swift:41-56; Views/ImportSheet.swift:133-150)
// ---------------------------------------------------------------------------

export interface CaptureInput {
  sourceURL: string;
  detectedTitle?: string | null;
  typedName?: string;
  kind?: "turns" | "page-text"; // web: stated by the capture layer. Apple infers it from turns.length === 1.
  turns: string[];
  allowWall?: boolean; // web: the user chose "import anyway" after the sign-in-wall warning
  keepDropped?: number[]; // web: input indexes of dropped turns that the user restored (import-rules.md W10)
}

function fromCapturedTurnsApple(turns: string[], title: string, sourceURL: string): ImportedSession {
  const fallbackProvider: Provider = sourceURL.includes("claude.ai") ? "Claude" : "Other";
  if (turns.length === 1) {
    const single = parseText(turns[0], title, "apple")[0];
    single.sourceURL = sourceURL;
    if (single.provider === "Other") single.provider = fallbackProvider;
    return single;
  }
  const messages: ImportedMessage[] = [];
  for (const block of stripChromeTurns(turns, "apple").kept) {
    const cleaned = trimAll(cleanTranscriptLinesApple(block.split("\n")).join("\n"));
    if (cleaned === "") continue;
    const split = splitLeadingRoleMarker(cleaned, "apple");
    if (split) messages.push({ role: split.role, text: split.text }); // text may be ""
    else messages.push({ role: "unknown", text: cleaned });
  }
  return { title, provider: fallbackProvider, modelName: "", sourceURL, createdAt: null, messages };
}

function captureTitleFallbackWeb(sourceURL: string): string {
  try {
    const u = new URL(sourceURL);
    const segments = u.pathname.split("/").filter((s) => s !== "");
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      try { return decodeURIComponent(last); } catch { return last; }
    }
    return sourceURL; // no path segment: the URL itself (capture.md 7.3)
  } catch { return sourceURL; }
}

export function importCapture(input: CaptureInput, mode: Mode): ImportResult {
  const base = { entry: "capture" };
  if (mode === "apple") {
    const turns = input.turns;
    if (turns.length === 0) return { ...base, outcome: "rejected", reason: "no_conversation_found", statusMessage: "Nothing captured — is the transcript visible in the page?", sessions: [] };
    if (looksLikeSignInWall(turns)) return { ...base, outcome: "rejected", reason: "sign_in_suspected", statusMessage: "That looks like a sign-in or landing page — log in below (or wait for the conversation to appear), then press Capture again.", sessions: [] };
    // Foundation: lastPathComponent is "" for a URL with no path and "/" for a bare trailing slash.
    const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(input.sourceURL);
    const path = m ? m[1] : "";
    let fallback: string;
    if (path === "") fallback = input.sourceURL;
    else {
      const segs = path.split("/").filter((s) => s !== "");
      fallback = segs.length === 0 ? "/" : decodeURIComponent(segs[segs.length - 1]);
    }
    const typedName = trimInline(input.typedName ?? "");
    const title = typedName === "" ? (input.detectedTitle ?? fallback) : typedName;
    const parsed = fromCapturedTurnsApple(turns, title, input.sourceURL);
    const droppedTurns = turns.length > 1 ? stripChromeTurns(turns, "apple").dropped : [];
    let host = "the page";
    try { host = new URL(input.sourceURL).hostname || host; } catch { /* keep */ }
    if (parsed.messages.length === 0) return { ...base, outcome: "rejected", reason: "no_conversation_found", statusMessage: "No conversation content captured from the page.", sessions: [], droppedTurns };
    return { ...base, outcome: "imported", reason: null, statusMessage: `Captured ${parsed.messages.length} turns from ${host}.`, sessions: [parsed], droppedTurns };
  }

  const turns = input.turns.map(normaliseText);
  if (turns.length === 0) return { ...base, outcome: "rejected", reason: "no_conversation_found", sessions: [], flags: [], droppedTurns: [] };
  const kind = input.kind ?? (turns.length === 1 ? "page-text" : "turns");
  // capture.md 7.4: the text heuristic is applied to whole-page text only, and it is a warning with an override.
  if (kind === "page-text" && looksLikeSignInWall(turns) && !input.allowWall) {
    return { ...base, outcome: "rejected", reason: "sign_in_suspected", sessions: [], flags: [], droppedTurns: [] };
  }
  const typed = trimAll(normaliseText(input.typedName ?? ""));
  const detected = trimAll(normaliseText(input.detectedTitle ?? ""));
  const title = typed !== "" ? typed : detected !== "" ? detected : captureTitleFallbackWeb(input.sourceURL);
  const urlProvider = providerFromURL(input.sourceURL);
  let session: ImportedSession | null = null;
  let droppedTurns: ChromeResult["dropped"] = [];
  if (kind === "page-text") {
    const parsed = parseText(turns.join("\n"), title, "web");
    if (parsed.length > 0) {
      session = parsed[0];
      session.title = title; // the capture title always wins over anything found in the page text
      session.sourceURL = input.sourceURL;
      if (urlProvider) session.provider = urlProvider; // the link decides, not the words on the page
    }
  } else {
    const chrome = stripChromeTurns(turns, "web", input.keepDropped ?? []);
    droppedTurns = chrome.dropped;
    const messages: ImportedMessage[] = [];
    const labels: string[] = [];
    for (const block of chrome.kept) {
      const cleaned = trimAll(cleanTranscriptLinesWeb(block.split("\n")).join("\n"));
      if (cleaned === "") continue;
      const split = splitLeadingRoleMarker(cleaned, "web");
      if (split) {
        labels.push(split.name);
        if (split.text !== "") messages.push({ role: split.role, text: split.text });
      } else {
        messages.push({ role: "unknown", text: cleaned });
      }
    }
    if (messages.length > 0) {
      session = { title, provider: urlProvider ?? providerFromLabels(labels) ?? "Other", modelName: "", sourceURL: input.sourceURL, createdAt: null, messages };
    }
  }
  if (!session || session.messages.length === 0) return { ...base, outcome: "rejected", reason: "no_conversation_found", sessions: [], flags: [], droppedTurns };
  return { ...base, outcome: "imported", reason: null, sessions: [session], flags: [], droppedTurns };
}

// ---------------------------------------------------------------------------
// Display splitter (Views/MessageView.swift:79-126). Not part of import: it runs when a message is shown.
// ---------------------------------------------------------------------------

export type DisplaySegment = { type: "prose"; text: string } | { type: "code"; language: string | null; code: string };

export function splitDisplaySegments(text: string, mode: Mode): DisplaySegment[] {
  const segments: DisplaySegment[] = [];
  let proseLines: string[] = [];
  const flushProse = () => {
    const joined = proseLines.join("\n");
    proseLines = [];
    if (trimAll(joined) === "") return;
    segments.push({ type: "prose", text: joined });
  };
  if (mode === "apple") {
    let codeLines: string[] = [];
    let language: string | null = null;
    let inCode = false;
    const flushCode = () => {
      segments.push({ type: "code", language, code: codeLines.join("\n") });
      codeLines = []; language = null; inCode = false;
    };
    for (const line of text.split("\n")) {
      const trimmed = trimInline(line);
      if (inCode) {
        if (trimmed === "```") flushCode(); else codeLines.push(line);
      } else if (trimmed.startsWith("```")) {
        flushProse();
        const tag = trimInline(trimmed.slice(3));
        language = tag === "" ? null : tag;
        inCode = true;
      } else {
        proseLines.push(line);
      }
    }
    if (inCode) flushCode(); else flushProse();
    return segments;
  }
  const lines = normaliseText(text).split("\n");
  const fences = scanFences(lines);
  let next = 0;
  for (const f of fences) {
    for (let k = next; k < f.open; k++) proseLines.push(lines[k]);
    flushProse();
    const end = f.close === null ? lines.length : f.close;
    segments.push({ type: "code", language: f.info === "" ? null : f.info, code: lines.slice(f.open + 1, end).join("\n") });
    next = f.close === null ? lines.length : f.close + 1;
  }
  for (let k = next; k < lines.length; k++) proseLines.push(lines[k]);
  flushProse();
  return segments;
}
