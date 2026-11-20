/// <reference types="node" />
// Differential test: the product importer (core/src/import) against the reference port
// (web/reference/import-port/importer.ts) in its "web" mode, the mode that generated the
// *.expected.web.json fixtures. Thousands of generated inputs go through both; the results
// must be equal, completely.
//
// Reproducible: every case is built from the seed and its own number.
//   IMPORT_DIFF_CASES   number of cases (default 6000, never fewer than 5000)
//   IMPORT_DIFF_SEED    seed (default 20261120)
//   IMPORT_DIFF_REPORT  set it to print how often each entry point, outcome and feature was reached
//
// The corpus stays clear of the places where the product departs from the port on purpose:
// the decisions of docs/corrections.md section 3 that the port does not implement, and the
// port's known defects (points 11 to 15 there). Each of those is listed, with the rule that
// decides it, in the last block of this file, which shows both behaviours on a crafted input.
// How the corpus stays clear:
//   - texts are shaped before both sides see them (`clearOfKnownDivergences`): at most one
//     leading U+FEFF, no line that is a marker only when U+0130 is lower-cased, no title or
//     header-line text that is blank without being empty, no U+2028 on a fence or Origin line;
//   - values the two sides read differently are not generated: a date in the year 0000, a
//     message time that is not finite, mapping keys that look like integers out of order,
//     links whose last path segment has white space at its ends;
//   - one input differs between the sides: the port never sees the odd last byte of UTF-16
//     text, which the product ignores (`forThePort`).
//
// All content is invented. Every special character is built from its code point, so that
// this file stays plain ASCII.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as reference from "../../reference/import-port/importer.ts";
import * as importer from "../src/import/index.ts";

const CASES = Math.max(5000, Number.parseInt(process.env.IMPORT_DIFF_CASES ?? "", 10) || 6000);
const SEED = Number.parseInt(process.env.IMPORT_DIFF_SEED ?? "", 10) || 20261120;

// ---------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------

const chr = (...codes: number[]): string => String.fromCodePoint(...codes);
const NUL = chr(0x00);
const NEL = chr(0x85);
const NBSP = chr(0xa0);
const ZWSP = chr(0x200b);
const LS = chr(0x2028);
const PS = chr(0x2029);
const BOM = chr(0xfeff);
const HIGH = chr(0xd800);
const LOW = chr(0xdc00);
const ACUTE = chr(0x301);
const E_ACUTE = chr(0xe9);
const BICYCLE = chr(0x1f6b2);
const TEA = chr(0x8336);
const I_WITH_DOT = chr(0x130);
const FULL_WIDTH_COLON = chr(0xff1a);
const ELLIPSIS = chr(0x2026);
const TICKS = "```";

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let code = from; code <= to; code++) out.push(code);
  return out;
}

/** The 19 code points of the inline trim (import-rules.md 2.3). */
const INLINE_SET = [0x09, 0x20, 0xa0, 0x1680, ...range(0x2000, 0x200b), 0x202f, 0x205f, 0x3000].map((code) =>
  chr(code),
);
/** Five of the seven more of the full trim. The importer cuts lines at none of them. */
const LINE_SEPARATORS = [0x0b, 0x0c, 0x85, 0x2028, 0x2029].map((code) => chr(code));
/** Characters that trip a careless port. */
const ODDITIES = [
  BOM,
  chr(0x200d),
  NUL,
  HIGH,
  LOW,
  ACUTE,
  E_ACUTE,
  BICYCLE,
  TEA,
  I_WITH_DOT,
  ELLIPSIS,
  ZWSP,
  NBSP,
];

// ---------------------------------------------------------------------------------------
// A small seeded generator
// ---------------------------------------------------------------------------------------

class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32: a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(below: number): number {
    return Math.floor(this.next() * below);
  }

  between(low: number, high: number): number {
    return low + this.int(high - low + 1);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const value = items[this.int(items.length)];
    if (value === undefined) throw new Error("pick from an empty list");
    return value;
  }

  /** Picks by weight from [weight, value] pairs. */
  weighted<T>(choices: readonly (readonly [number, T])[]): T {
    let total = 0;
    for (const [weight] of choices) total += weight;
    let roll = this.next() * total;
    for (const [weight, value] of choices) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return this.pick(choices)[1];
  }

  repeat<T>(low: number, high: number, make: () => T): T[] {
    const out: T[] = [];
    for (let count = this.between(low, high); count > 0; count--) out.push(make());
    return out;
  }

  shuffled<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let index = out.length - 1; index > 0; index--) {
      const other = this.int(index + 1);
      const held = out[index];
      const swapped = out[other];
      if (held !== undefined && swapped !== undefined) {
        out[index] = swapped;
        out[other] = held;
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------
// Words, lines, texts
// ---------------------------------------------------------------------------------------

const list = (items: string): string[] => items.split("|");

const WORDS = list(
  "bread|dough|starter|rye|flour|tulip|bulb|soil|mulch|wheel|spoke|rim|tyre|chain|tea|kettle|leaf|rope|knot|hitch|" +
    "the|a|and|is|how|long|should|I|prove|it|about|four|hours|then|fold|once|more|yes|no|why|which|works|best|in",
);
/** Words that the Apple keyword scan, the wall test or the chrome test react to. */
const LOADED_WORDS = list(
  "Claude|ChatGPT|Gemini|gpt-4|sign in|Sign In|log in|LOG IN|cookie|cookies|privacy policy|the design integrates|" +
    "AI overview|can make mistakes|terms of service|welcome back|created with|shared conversation|" +
    "conversation transcript|just a moment|verify you are human|meet gemini|google terms|your personal ai assistant",
);
const WALL_PHRASES = list(
  "Sign in|Log in|Meet Gemini|Google Terms|Terms of Service|Just a moment...|Verify you are human|Welcome back|" +
    "your personal AI assistant|cookie|Privacy Policy",
);
const HEADER_PHRASES = list(
  "Sign in|Log in|Created with Example|Conversation Transcript|Shared conversation|AI Overview",
);
const CHROME_TURNS = list(
  "Sign in|AI Overview|This assistant can make mistakes.|cookie and privacy policy|Sign in to keep your chats|" +
    "AI can make mistakes. Check important info.|We use a cookie here|Please log in|Welcome back",
);
const ROLE_NAMES = list(
  "User|Human|You|Me|Assistant|Claude|ChatGPT|GPT|Gemini|AI|System|You said|Claude responded|Claude said|" +
    "ChatGPT said|Gemini said",
);
const NEAR_NAMES = [
  ...list(
    "Users|Username|User 1|User (me)|[User]|AI assistant|GPT-4|Humans|Claudette|Geminis|Systems|Yours|Men",
  ),
  `A${I_WITH_DOT}`,
  `GEMIN${I_WITH_DOT}`,
];
const FURNITURE = [
  ...list(
    "Copy|Retry|Share|Report|Claude|copy|Copy code|Claude is here|Searched the web|Shared by Example Person|" +
      "This is a copy of a chat between Claude and Example Person.|" +
      "Content may include unverified or unsafe content.|Shared snapshot may contain attachments.|" +
      "Ask Claude your own question|Claude can make mistakes. Please double-check responses.|shared by nobody|" +
      "10:42|10:42 AM|10:42AM|9:05 PM|24:99|10:42 am|10:42:15|10:42  PM|at 10:42|1:5|123:45",
  ),
  `10:42${NBSP}AM`,
  `10:42${LS}PM`,
  `${chr(0x661, 0x660)}:${chr(0x664, 0x662)}`, // Arabic-Indic digits
];
const LINKS = [
  ...list(
    "https://claude.ai/share/EXAMPLE-0000-0000|claude.ai/share/EXAMPLE|chatgpt.com/share/EXAMPLE-RYE|" +
      "https://example.invalid/a|http://example.invalid/a?b=c#d|HTTPS://EXAMPLE.INVALID/Path|example.invalid|" +
      "notes.md|Thanks.|Hello.|v1.2|v1.2.3|3.14|a.b|someone@example.invalid|file:///tmp/x|ftp://example.invalid/x|" +
      "example.invalid.|192.168.1.1|localhost|https://3.14|one-word|sub.example.invalid:8443/x|://example.invalid|" +
      "http://localhost:3000/x|example.c|example.co1|EXAMPLE.Invalid/A|https://example.invalid/a b",
  ),
  `example.invalid/${TEA}`,
  `example.invalid/${BICYCLE}`,
];
/**
 * Links a capture or a paste can come with. Clean: the product normalises these, the port
 * does not. And none has white space at its ends, nor a last path segment that decodes to
 * text with white space at its ends: the product trims every candidate for a capture title
 * (corrections.md 3, point 6), the port only the typed name and the detected title.
 */
const SOURCE_URLS = list(
  "https://claude.ai/share/EXAMPLE-0000-0000|https://claude.ai/code/session_EXAMPLE|" +
    "https://www.claude.ai/share/EXAMPLE|http://CLAUDE.AI/Share/EXAMPLE|https://chatgpt.com/share/EXAMPLE-RYE|" +
    "https://chat.openai.com/share/EXAMPLE|https://gemini.google.com/share/EXAMPLESEEDS|" +
    "https://share.gemini.google/EXAMPLE|https://g.co/gemini/share/EXAMPLE|https://g.co/other/EXAMPLE|" +
    "https://x.g.co/gemini|https://bard.google.com/share/EXAMPLE|https://example.invalid/share/EXAMPLE|" +
    "https://example.invalid/|https://example.invalid|https://example.invalid/a/Bread%20notes|" +
    "https://example.invalid/a/%E0%A4%A|https://example.invalid/path/?q=1#frag|https://notclaude.ai/x|" +
    "https://claude.ai.example.invalid/x|claude.ai/share/EXAMPLE|not a link|ftp://claude.ai/x|" +
    "https://example.invalid/a//b///|https://example.invalid/%F0%9F%9A%B2|https://example.invalid/?from=claude.ai|" +
    "mailto:someone@example.invalid|https://chatgpt.com.example.invalid/x|https://gemini.google/EXAMPLE|" +
    "git://Claude.AI/EXAMPLE|" +
    "https://example.invalid/first/second/third|https://example.invalid/a%2Fb",
);
const FILE_STEMS = [
  ...list(
    "notes|my.session.notes|conversations|README|.notes|name.|Mr. Smith notes|tea-notes|a b|  padded  |x",
  ),
  `caf${E_ACUTE}`,
  `${BICYCLE} ride`,
];
const TEXT_EXTENSIONS = list("txt|md|markdown|TXT|bak|json |log");
const TITLES = [
  ...list("Pasted session|Pasted session|Pasted session|  My notes  || |\tTabbed\t|Chain maintenance"),
  `Bread ${E_ACUTE}`,
  `title${LS}`,
];

function words(random: Random, low: number, high: number): string {
  return random
    .repeat(low, high, () => (random.chance(0.06) ? random.pick(LOADED_WORDS) : random.pick(WORDS)))
    .join(" ");
}

function sentence(random: Random): string {
  const text = words(random, 1, 9);
  return random.chance(0.3) ? `${text}${random.pick([".", "?", "!", ":", ELLIPSIS])}` : text;
}

/** Inline white space: mostly the plain space and the tab, sometimes one of the other 17. */
function spaces(random: Random, low: number, high: number): string {
  return random
    .repeat(low, high, () => (random.chance(0.6) ? random.pick([" ", " ", "\t"]) : random.pick(INLINE_SET)))
    .join("");
}

/** Blanks at the ends of a line, and now and then an odd character in it. */
function decorate(random: Random, line: string): string {
  let out = line;
  if (random.chance(0.12)) out = spaces(random, 1, 3) + out;
  if (random.chance(0.12)) out += spaces(random, 1, 3);
  if (random.chance(0.06)) {
    const at = random.pick([0, out.length, random.int(out.length + 1)]);
    const odd = random.chance(0.5) ? random.pick(LINE_SEPARATORS) : random.pick(ODDITIES);
    out = out.slice(0, at) + odd + out.slice(at);
  }
  return out;
}

function casing(random: Random, name: string): string {
  return random.weighted([
    [6, name],
    [1, name.toUpperCase()],
    [1, name.toLowerCase()],
    [1, name.charAt(0).toLowerCase() + name.slice(1).toUpperCase()],
  ]);
}

/** A line that is, or nearly is, a speaker marker (import-rules.md 2.4, W8). */
function markerLine(random: Random): string {
  const name = casing(random, random.chance(0.1) ? random.pick(NEAR_NAMES) : random.pick(ROLE_NAMES));
  const rest = random.chance(0.15) ? "" : sentence(random);
  const line = random.weighted<string>([
    [10, `${name}: ${rest}`],
    [2, `${name}:${rest}`],
    [2, `${name}:`],
    [4, name],
    [3, `**${name}:** ${rest}`],
    [2, `**${name}**: ${rest}`],
    [1, `**${name}**`],
    [2, `## ${name}`],
    [1, `### ${name}: ${rest}`],
    [1, `#${name}: ${rest}`],
    [1, `# # ${name}: ${rest}`],
    [1, `${name} : ${rest}`],
    [1, `- ${name}: ${rest}`],
    [1, `> ${name}: ${rest}`],
    [1, `*${name}:* ${rest}`],
    [1, `${name}${FULL_WIDTH_COLON} ${rest}`],
    [2, `**${name}:** **bold** ${rest} **more**`],
    [1, `${name}: ** ${rest}`],
    [1, `${name}:** ${rest}`],
    [1, `**${name}**:** ${rest}`],
    [1, `${name.slice(0, 2)}**${name.slice(2)}: ${rest}`],
    [1, `${name}:${ACUTE} ${rest}`],
    [1, `${name}: ${name}: ${rest}`],
    [1, `${name}:${rest}${random.pick(LINE_SEPARATORS)}`],
  ]);
  return random.chance(0.15) ? spaces(random, 1, 3) + line : line;
}

/** A fenced block, well formed or not (W13). Lines inside look like markers and furniture. */
function fenceBlock(random: Random): string[] {
  const indent = random.chance(0.2) ? spaces(random, 1, 3) : "";
  const ticks = "`".repeat(
    random.weighted([
      [8, 3],
      [2, 4],
      [1, 5],
      [1, 2],
    ]),
  );
  const info = random.weighted([
    [5, ""],
    [3, "js"],
    [1, "  swift  "],
    [1, 'js title="a.js"'],
    [1, "a`b"],
    [1, `${TICKS}x`],
  ]);
  const inside = random.repeat(0, 4, () =>
    random.weighted<string>([
      [3, `    ${words(random, 1, 4)}`],
      [2, "user: deploy"],
      [1, "system: linux"],
      [1, "Assistant: inside"],
      [1, "Copy"],
      [1, "10:30"],
      [1, ""],
      [2, "make build"],
      [1, TICKS],
      [1, `${TICKS}js`],
      [1, "---"],
      [1, "You said: inside"],
      [1, "  make build  "],
    ]),
  );
  const closing = random.weighted<string[]>([
    [7, [indent + ticks + (random.chance(0.2) ? spaces(random, 1, 2) : "")]],
    [1, [`${indent}${ticks}\``]],
    [1, [`${indent}${TICKS}`]],
    [1, [`${ticks} trailing`]],
    [2, []],
  ]);
  return [`${indent}${ticks}${info}`, ...inside, ...closing];
}

/** Lines of the body of a turn: prose, blanks, indented code, repeats, furniture, fences. */
function bodyLines(random: Random, low: number, high: number): string[] {
  const out: string[] = [];
  for (let count = random.between(low, high); count > 0; count--) {
    const kind = random.weighted([
      [10, "prose"],
      [3, "blank"],
      [2, "indented"],
      [2, "repeat"],
      [3, "furniture"],
      [2, "fence"],
      [1, "code span"],
      [1, "separator"],
      [1, "link"],
    ]);
    if (kind === "prose") out.push(decorate(random, sentence(random)));
    else if (kind === "blank") out.push(random.chance(0.3) ? spaces(random, 1, 3) : "");
    else if (kind === "indented") out.push(`${random.pick(["    ", "\t", "  "])}${words(random, 1, 4)}`);
    else if (kind === "repeat") out.push(out[out.length - 1] ?? "again", ...(random.chance(0.3) ? [""] : []));
    else if (kind === "furniture") out.push(random.pick(FURNITURE));
    else if (kind === "fence") out.push(...fenceBlock(random));
    else if (kind === "code span") out.push(`${TICKS}npm test${TICKS} ${words(random, 0, 3)}`);
    else if (kind === "separator") out.push(random.pick(["---", " --- ", "----", "- - -", "***", "--"]));
    else out.push(random.pick(LINKS));
  }
  return out;
}

/** Generic text with speaker markers (W8). */
function dialogueLines(random: Random): string[] {
  const out: string[] = random.chance(0.3) ? bodyLines(random, 1, 3) : [];
  for (let turn = random.between(0, 7); turn > 0; turn--) {
    out.push(markerLine(random), ...bodyLines(random, 0, 4));
  }
  return out;
}

/** Puller Markdown, well formed or nearly (W5). */
function pullerLines(random: Random): string[] {
  const out: string[] = random.chance(0.2)
    ? random.repeat(1, 3, () => (random.chance(0.5) ? "" : spaces(random, 1, 2)))
    : [];
  const header = (): string[] => {
    const title = random.weighted<string>([
      [6, `# session_EXAMPLE${random.int(100)}`],
      [1, "# "],
      [1, "#   "],
      [1, "#title"],
      [1, " # indented"],
      [1, `# ${sentence(random)}  `],
    ]);
    const url = random.weighted<string>([
      [5, `Source: ${random.pick(SOURCE_URLS)}`],
      [1, "Source:"],
      [1, "source: lower"],
      [1, "Source:tight"],
      [1, "Source:   https://claude.ai/code/session_PADDED  "],
    ]);
    return random.chance(0.05) ? [title, "", url] : [title, url];
  };
  out.push(...header());
  if (random.chance(0.1)) return out;
  out.push("");
  const sessions = random.weighted([
    [6, 1],
    [2, 2],
    [1, 3],
  ]);
  for (let session = sessions; session > 0; session--) {
    for (let blocks = random.between(0, 5); blocks > 0; blocks--) {
      const first = random.weighted<string>([
        [6, markerLine(random)],
        [2, sentence(random)],
        [1, "Assistant"],
        [1, "User:"],
        [1, ""],
      ]);
      const separator = random.pick(["---", "---", "---", " --- ", "---\t", "----"]);
      out.push(first, ...bodyLines(random, 0, 3), "", separator, "");
    }
    if (session > 1) out.push(...(random.chance(0.7) ? ["", ""] : []), ...header(), "");
  }
  return out;
}

/** The visible text of a share page (W6, W7). */
function sharePageLines(random: Random): string[] {
  const out: string[] = random.chance(0.6)
    ? [
        sentence(random),
        "Shared by Example Person",
        "This is a copy of a chat between Claude and Example Person.",
      ]
    : [];
  const family = random.weighted([
    [5, "claude"],
    [3, "chatgpt"],
    [2, "gemini"],
    [3, "mixed"],
  ]);
  for (let turn = random.between(1, 7); turn > 0; turn--) {
    const assistant =
      family === "claude"
        ? random.pick(["Claude responded:", "Claude responded:", "Claude said:"])
        : family === "chatgpt"
          ? "ChatGPT said:"
          : family === "gemini"
            ? "Gemini said:"
            : random.pick(["Claude responded:", "ChatGPT said:", "Gemini said:", "Claude said:"]);
    const header = random.weighted<string>([
      [5, "You said:"],
      [5, assistant],
      [1, "you said:"],
      [1, "You said"],
      [1, "Gemini said"],
    ]);
    const preview = random.weighted<string>([
      [4, ""],
      [4, ` ${sentence(random)}${ELLIPSIS}`],
      [1, sentence(random)],
      [1, `  ${sentence(random)}  `],
      [1, ` ${sentence(random)}${random.pick(LINE_SEPARATORS)}`],
    ]);
    out.push((random.chance(0.1) ? spaces(random, 1, 2) : "") + header + preview);
    if (random.chance(0.8)) out.push(...bodyLines(random, 0, 4));
    if (random.chance(0.3)) out.push(random.pick(["Copy", "Retry", "10:42 AM"]));
  }
  if (random.chance(0.4)) out.push("Claude can make mistakes. Please double-check responses.");
  return out;
}

/** A page with whole-line labels, as reported for Gemini (W6, fixture 49). */
function wholeLineLabelLines(random: Random): string[] {
  const out = ["Gemini", "Conversation with Gemini"];
  const labels = random.weighted<[string, string]>([
    [6, ["You said", "Gemini said"]],
    [1, ["You said", "Gemini replied"]],
    [1, ["You asked", "Gemini said"]],
    [1, ["You said", "Gemini said:"]],
    [1, ["  You said ", "\tGemini said"]],
  ]);
  for (let turn = random.between(1, 5); turn > 0; turn--) {
    out.push(labels[0], ...bodyLines(random, 0, 2), labels[1], ...bodyLines(random, 0, 2));
  }
  return out;
}

/** A context pack, the app's own export (W14, data-model.md 4.1). */
function contextPackLines(random: Random): string[] {
  const out: string[] = random.chance(0.15) ? ["", " "] : [];
  const title = random.weighted<string>([
    [10, `# Context pack: ${sentence(random)}`],
    [1, "# Context pack: "],
    [1, "# Context pack:x"],
  ]);
  out.push(title, "");
  if (random.chance(0.9)) {
    const provider = random.pick(list("Claude|ChatGPT|Gemini|Other|claude|Mystery|  Gemini "));
    const model = random.weighted<string>([
      [4, ""],
      [3, " (model-example)"],
      [1, " (a (b) c)"],
      [1, " ()"],
      [1, " (open"],
      [1, " ( spaced )"],
    ]);
    const saved = random.weighted<string>([
      [6, ", saved Nov 19, 2026"],
      [1, ", saved 19. Nov. 2026"],
      [1, ""],
      [1, ", saved a, saved b"],
    ]);
    out.push(`Origin: ${provider}${model}${saved}`);
  }
  if (random.chance(0.6)) out.push(`Source: ${random.pick(SOURCE_URLS)}`);
  if (random.chance(0.5)) {
    const tags = random.repeat(0, 4, () => random.pick(["garden", "Roses", " bread ", "", "tea"]));
    out.push(`Tags: ${tags.join(",")}`);
  }
  out.push("");
  if (random.chance(0.5)) {
    out.push(random.chance(0.9) ? "## Summary" : "  ## Summary", "", ...bodyLines(random, 0, 3), "");
  }
  if (random.chance(0.85)) {
    out.push(
      "You are being given the transcript of an earlier conversation the user had",
      "with another AI assistant. Read it, treat its decisions and facts as established",
      "context, and continue helping from where it left off.",
      "",
    );
  }
  if (random.chance(0.95)) out.push(random.chance(0.9) ? "## Transcript" : " ## Transcript ", "");
  for (let message = random.between(0, 6); message > 0; message--) {
    const role = random.weighted<string>([
      [4, "**User:**"],
      [4, "**Assistant:**"],
      [1, "**System:**"],
      [1, "**Note:**"],
      [1, "**Other:**"],
      [1, " **User:** "],
      [1, sentence(random)],
    ]);
    out.push(role, "", ...bodyLines(random, 0, 3), "", random.chance(0.9) ? "---" : " --- ", "");
  }
  return out;
}

/** The number of user-perceived characters, as the importer counts them (W15). */
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function graphemes(text: string): number {
  let count = 0;
  for (const _unit of segmenter.segment(text)) count++;
  return count;
}

/** Fills a text up to an exact number of user-perceived characters. */
function padTo(random: Random, text: string, target: number, withSpaces = true): string {
  let out = text;
  const unit = random.weighted([
    [6, "x"],
    [2, BICYCLE],
    [1, `e${ACUTE}`],
    [1, TEA],
  ]);
  for (let missing = target - graphemes(out); missing > 0; missing--) {
    // A space now and then, so that the filler is not one endless word.
    out += withSpaces && missing > 1 && random.chance(0.15) ? " " : unit;
  }
  return out;
}

/** A length at or next to one of the thresholds of import-rules.md 2.10. */
function nearThreshold(random: Random, threshold: number): number {
  return threshold + random.pick([-2, -1, -1, 0, 0, 1]);
}

/** A page that may be a sign-in wall: some marker phrases, and a length near the thresholds. */
function wallText(random: Random): string {
  const phrases = random.repeat(0, 5, () => casing(random, random.pick(WALL_PHRASES)));
  const lines = [...phrases, ...random.repeat(0, 3, () => sentence(random))];
  const text = lines.join(random.pick(["\n", "\n", " ", ". "]));
  const target = random.weighted([
    [4, 0],
    [3, nearThreshold(random, 1200)],
    [3, nearThreshold(random, 2500)],
    [1, random.between(1300, 2400)],
    [1, 3000],
  ]);
  return target === 0 ? text : padTo(random, text, target);
}

/** A captured turn that may be page chrome: a phrase, and a length near 700. */
function chromeTurn(random: Random): string {
  const text = random.chance(0.8) ? random.pick(CHROME_TURNS) : words(random, 2, 6);
  return random.chance(0.3) ? padTo(random, `${text} `, nearThreshold(random, 700)) : text;
}

/** Header residue for the top of a first turn: phrases, blank lines, lines near 90 characters. */
function headerResidue(random: Random): string[] {
  return random.repeat(0, 14, () =>
    random.weighted<string>([
      [5, casing(random, random.pick(HEADER_PHRASES))],
      [2, ""],
      [1, " \t"],
      [2, padTo(random, `${random.pick(HEADER_PHRASES)} `, nearThreshold(random, 90))],
      [1, sentence(random)],
    ]),
  );
}

type TextKind = "dialogue" | "puller" | "share" | "labels" | "pack" | "wall" | "link" | "soup" | "blank";

const TEXT_KINDS: readonly (readonly [number, TextKind])[] = [
  [8, "dialogue"],
  [6, "puller"],
  [6, "share"],
  [2, "labels"],
  [6, "pack"],
  [2, "wall"],
  [2, "link"],
  [3, "soup"],
  [1, "blank"],
];

function linesOf(random: Random, kind: TextKind): string[] {
  switch (kind) {
    case "dialogue":
      return dialogueLines(random);
    case "puller":
      return pullerLines(random);
    case "share":
      return sharePageLines(random);
    case "labels":
      return wholeLineLabelLines(random);
    case "pack":
      return contextPackLines(random);
    case "wall":
      return wallText(random).split("\n");
    case "link":
      return [random.pick(LINKS)];
    case "blank":
      return random.repeat(0, 4, () => spaces(random, 0, 3));
    case "soup":
      return random.repeat(0, 14, () =>
        random.weighted<string>([
          [3, markerLine(random)],
          [3, sentence(random)],
          [2, random.pick(FURNITURE)],
          [1, "---"],
          [1, TICKS],
          [1, `${TICKS}js`],
          [1, "You said: x"],
          [1, "Claude responded:"],
          [1, "# title"],
          [1, "Source: somewhere"],
          [1, "## Transcript"],
          [1, "**User:**"],
          [1, random.pick(WALL_PHRASES)],
          [1, ""],
          [1, random.pick(LINKS)],
          [1, "# Context pack: soup"],
        ]),
      );
  }
}

/** Joins lines with LF, CR LF, CR or a mixture, and adds what files and clipboards add. */
function assemble(random: Random, lines: readonly string[]): string {
  const style = random.weighted([
    [10, "lf"],
    [4, "crlf"],
    [2, "cr"],
    [4, "mixed"],
  ]);
  const ending = (): string => {
    if (style === "lf") return "\n";
    if (style === "crlf") return "\r\n";
    if (style === "cr") return "\r";
    return random.pick(["\n", "\n", "\r\n", "\r"]);
  };
  let text = "";
  lines.forEach((line, index) => {
    text += index === 0 ? line : ending() + line;
  });
  if (random.chance(0.5)) text += ending();
  if (random.chance(0.1)) text += ending() + spaces(random, 0, 2);
  if (random.chance(0.08)) text = BOM + text;
  if (random.chance(0.02)) text = BOM + text;
  if (random.chance(0.03)) text = text.replace(/[a-z]/, (letter) => letter + NUL);
  return text;
}

/**
 * corrections.md 3, point 4: the product removes every leading U+FEFF, the port one for each
 * time it normalises (once to three times, depending on the entry point). A text of the
 * corpus starts with at most one, and with no U+0000 in front of it; then both remove it.
 */
function oneLeadingMark(text: string): string {
  let end = 0;
  while (end < text.length && (text[end] === BOM || text[end] === NUL)) end++;
  return text.slice(0, end).includes(BOM) ? BOM + text.slice(end) : text;
}

/** The name of the marker the port finds on a line, or null. */
function portMarkerName(line: string): string | null {
  return reference.roleMarker(line, "web")?.name ?? null;
}

/**
 * corrections.md 3, point 9: true when the port takes the line for a marker only because it
 * lower-cases U+0130 to "i" and a combining dot. The product folds A to Z and nothing else.
 */
function isMarkerOnlyByLowerCasing(line: string): boolean {
  return (
    line.includes(I_WITH_DOT) && portMarkerName(line) !== portMarkerName(line.replaceAll(I_WITH_DOT, "x"))
  );
}

/** Keeps a single line out of the divergence of point 9. */
function clearLine(line: string): string {
  return isMarkerOnlyByLowerCasing(line) ? line.replaceAll(I_WITH_DOT, "x") : line;
}

/** corrections.md 3, point 8: not empty after the inline trim, empty after the full trim. */
function isBlankButNotEmpty(text: string): boolean {
  return reference.trimInline(text) !== "" && reference.trimAll(text) === "";
}

const SHARE_HEADER_PREFIXES = [
  "You said:",
  "Claude responded:",
  "Claude said:",
  "ChatGPT said:",
  "Gemini said:",
];

/**
 * corrections.md 3, point 8: true for a share-page header line whose own text, or a puller
 * title line whose title, is blank without being empty. The port stores such a text as a
 * message, or as the title; for the product it is no message, and such a title falls back.
 */
function hasBlankHeaderTextOrTitle(line: string): boolean {
  const trimmed = reference.trimInline(line);
  for (const prefix of SHARE_HEADER_PREFIXES) {
    if (trimmed.startsWith(prefix) && isBlankButNotEmpty(trimmed.slice(prefix.length))) return true;
  }
  return line.startsWith("# ") && isBlankButNotEmpty(line.slice(2));
}

/**
 * Keeps a text out of the documented divergences (see the last block of this file):
 * - point 4: at most one leading U+FEFF;
 * - point 13: the port tests a fence opening line and an "Origin:" line with patterns whose
 *   "." stops at U+2028 and U+2029; a text that has such a line gets those two replaced;
 * - point 8: a text with a blank header-line text or title gets the five characters replaced
 *   that the full trim removes and the inline trim keeps;
 * - point 9: a text with a line that is a marker only by lower-casing U+0130 gets that
 *   character replaced.
 * Which lines a text has is asked of the port itself, after its own normalisation.
 */
function clearOfKnownDivergences(text: string): string {
  let out = oneLeadingMark(text);
  for (let pass = 0; pass < 4; pass++) {
    const lines = reference.normaliseText(out).split("\n");
    let changed = false;
    if (
      (out.includes(LS) || out.includes(PS)) &&
      lines.some((line) => reference.trimInline(line).startsWith(TICKS) || line.startsWith("Origin: "))
    ) {
      out = out.replaceAll(LS, " ").replaceAll(PS, " ");
      changed = true;
    }
    const text = out;
    if (
      LINE_SEPARATORS.some((separator) => text.includes(separator)) &&
      lines.some(hasBlankHeaderTextOrTitle)
    ) {
      for (const separator of LINE_SEPARATORS) out = out.replaceAll(separator, " ");
      changed = true;
    }
    if (out.includes(I_WITH_DOT) && lines.some(isMarkerOnlyByLowerCasing)) {
      out = out.replaceAll(I_WITH_DOT, "x");
      changed = true;
    }
    if (!changed) return out;
  }
  return out;
}

/**
 * corrections.md 3, point 1: the product ignores an odd last byte of UTF-16 text; the port
 * decodes it to U+FFFD. Where the port reads odd-length bytes as UTF-16, it is given them
 * without that byte. The product always gets all the bytes.
 */
function forThePort(bytes: Uint8Array): Uint8Array {
  if (bytes.length % 2 === 0) return bytes;
  const flag = reference.decodeBytesWeb(bytes)?.flag ?? null;
  const isUtf16 = flag === "decoded_as_utf_16le" || flag === "decoded_as_utf_16be";
  return isUtf16 ? bytes.subarray(0, bytes.length - 1) : bytes;
}

function someText(random: Random, kind: TextKind = random.weighted(TEXT_KINDS)): string {
  return clearOfKnownDivergences(assemble(random, linesOf(random, kind)));
}

// ---------------------------------------------------------------------------------------
// JSON in the shape of a ChatGPT export
// ---------------------------------------------------------------------------------------

const quote = (value: string): string => JSON.stringify(value);

/** An object written key by key, so that the order of the keys in the text is under control. */
function objectText(random: Random, entries: readonly (readonly [string, string])[]): string {
  const gap = random.chance(0.2) ? random.pick([" ", "\n", "\r\n", "\n  "]) : "";
  return `{${gap}${entries.map(([key, value]) => `${quote(key)}:${gap}${value}`).join(`,${gap}`)}${gap}}`;
}

const JUNK_VALUES = list('null|true|false|0|5|""|"text"|[]|{}|[1,2]|{"a":1}');

/** A text a message part can hold: short, with the things W1 has to deal with. */
function partText(random: Random): string {
  return random.weighted<string>([
    [8, sentence(random)],
    [2, `${sentence(random)}\n${sentence(random)}`],
    [1, `  ${sentence(random)}\r\n`],
    [1, `${sentence(random)}\r`],
    [1, ""],
    [1, " \n\t"],
    [1, `${BOM}${sentence(random)}`],
    [1, `${sentence(random)}${NUL}${HIGH}`],
    [1, `${TICKS}js\n${words(random, 1, 3)}\n${TICKS}`],
    [1, `User: ${sentence(random)}`],
    [1, `${sentence(random)}${NEL}`],
  ]);
}

function messageText(random: Random): string {
  const entries: [string, string][] = [];
  if (random.chance(0.92)) {
    const role = random.weighted<string>([
      [5, '"user"'],
      [5, '"assistant"'],
      [1, '"system"'],
      [1, '"tool"'],
      [1, '"User"'],
      [1, "5"],
      [1, "null"],
    ]);
    entries.push([
      "author",
      random.chance(0.92) ? objectText(random, [["role", role]]) : random.pick(JUNK_VALUES),
    ]);
  }
  if (random.chance(0.7)) {
    const time = random.weighted<string>([
      [6, String(random.int(4))],
      [2, String(1789000000 + random.int(1000) / 10)],
      [1, '"12"'],
      [1, "null"],
      [1, "true"],
      // Finite, and far from any date: both sides order by it. A time that is not finite (1e999)
      // counts as 0 for the product and sorts last for the port: corrections.md 3, point 5.
      [1, "1e300"],
      [1, "-3.5"],
    ]);
    entries.push(["create_time", time]);
  }
  if (random.chance(0.94)) {
    const parts = random.repeat(0, 3, () =>
      random.weighted<string>([
        [10, quote(partText(random))],
        [1, '{"asset_pointer":"file-EXAMPLE"}'],
        [1, "7"],
        [1, "null"],
        [1, '["nested"]'],
      ]),
    );
    const content = random.weighted<string>([
      [
        12,
        objectText(random, [
          ["content_type", '"text"'],
          ["parts", `[${parts.join(",")}]`],
        ]),
      ],
      [
        1,
        objectText(random, [
          ["content_type", '"code"'],
          ["text", quote(sentence(random))],
        ]),
      ],
      [1, objectText(random, [["parts", quote("not an array")]])],
      [1, random.pick(JUNK_VALUES)],
    ]);
    entries.push(["content", content]);
  }
  return objectText(random, entries);
}

const NAMED_IDS = list("root|n1|n2|n3|n4|q|a-old|a-new|aaaa1111-EXAMPLE|007|1e3|-1|x");
const INDEX_IDS = list("0|1|2|3|7|10|12");

/**
 * The ids of a mapping, in the order they are written. Ids that look like array indices
 * come first and in ascending order: for those the product follows the text and the port
 * follows JSON.parse (a documented divergence), and written this way the two orders agree.
 */
function mappingIds(random: Random): string[] {
  const named = random.shuffled(NAMED_IDS).slice(0, random.between(0, 7));
  if (!random.chance(0.2)) return named;
  const indices = INDEX_IDS.filter(() => random.chance(0.5));
  return [...indices, ...named];
}

/**
 * Seconds since 1970, some with a part below the millisecond; within the years 0001 to 9999,
 * the years for which both sides give a date (corrections.md 3, point 5). The last two are
 * the last second of the year 9999 and the first second of the year 0001.
 */
function createTime(random: Random): string {
  const seconds = 1789000000 + random.int(100000);
  return random.weighted<string>([
    [5, String(seconds)],
    [3, `${seconds}.${random.int(1000)}`],
    [3, `${seconds}.${random.int(1000000)}`],
    [1, `${seconds}.9996`],
    [1, `-${random.int(1000)}.${random.int(100000)}`],
    [1, "0"],
    [1, "253402300799"],
    [1, "-62135596800"],
  ]);
}

function nodeText(random: Random, ids: readonly string[], index: number): string {
  if (random.chance(0.05)) return random.pick(JUNK_VALUES);
  const entries: [string, string][] = [];
  if (random.chance(0.9)) {
    const message = random.weighted<string>([
      [12, messageText(random)],
      [1, "null"],
      [1, random.pick(JUNK_VALUES)],
    ]);
    entries.push(["message", message]);
  }
  if (random.chance(0.85)) {
    const parent = random.weighted<string>([
      [10, index === 0 ? "null" : quote(ids[index - 1] ?? "root")],
      [2, quote(random.pick(ids))],
      [1, quote("missing")],
      [1, quote(ids[index] ?? "root")],
      [1, "7"],
      [1, quote("__proto__")],
    ]);
    entries.push(["parent", parent]);
  }
  return objectText(random, entries);
}

function conversationText(random: Random): string {
  const ids = mappingIds(random);
  const nodes: [string, string][] = ids.map((id, index) => [id, nodeText(random, ids, index)]);
  const entries: [string, string][] = [];
  if (random.chance(0.85)) {
    const title = random.weighted<string>([
      [8, quote(sentence(random))],
      [1, '""'],
      [1, '"  "'],
      [1, "42"],
      [1, "null"],
      [1, quote(`  ${sentence(random)}\r\n`)],
      [1, quote(`a${NUL}b${HIGH}`)],
      [1, quote(`${BOM}${sentence(random)}${NEL}`)],
    ]);
    entries.push(["title", title]);
  }
  if (random.chance(0.7)) {
    const time = random.weighted<string>([
      [12, createTime(random)],
      [1, '"1789000000"'],
      [1, "true"],
      [1, "null"],
      [1, "1e999"],
    ]);
    entries.push(["create_time", time]);
  }
  if (random.chance(0.7)) {
    const current = random.weighted<string>([
      [10, quote(ids[ids.length - 1] ?? "root")],
      [3, quote(random.pick(ids.length > 0 ? ids : ["root"]))],
      [1, quote("missing")],
      [1, "null"],
      [1, "3"],
      [1, quote("constructor")],
      [1, quote("__proto__")],
    ]);
    entries.push(["current_node", current]);
  }
  entries.push(["mapping", random.chance(0.93) ? objectText(random, nodes) : random.pick(JUNK_VALUES)]);
  // The key order of a conversation carries no meaning.
  return objectText(random, random.shuffled(entries));
}

const OTHER_JSON = list(
  '{}|[]|[1,2,3]|"mapping"|42|null|true|{"conversation":[{"sender":"human","text":"hi"}]}|{"mapping":{}}|' +
    '[{"mapping":{}},{"mapping":[]}]',
);

function jsonText(random: Random): string {
  const kind = random.weighted([
    [10, "array"],
    [5, "object"],
    [2, "other"],
    [1, "cut"],
    [1, "two"],
  ]);
  if (kind === "array") {
    const items = random.repeat(0, 4, () =>
      random.chance(0.85) ? conversationText(random) : random.pick(JUNK_VALUES),
    );
    return `[${items.join(random.pick([",", ", ", ",\n"]))}]`;
  }
  if (kind === "object") return conversationText(random);
  if (kind === "cut") return conversationText(random).slice(0, -random.between(1, 20));
  if (kind === "two") return `${conversationText(random)} ${conversationText(random)}`;
  return random.pick(OTHER_JSON);
}

// ---------------------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------------------

const utf8 = (text: string): number[] => [...new TextEncoder().encode(text)];

function utf16(text: string, littleEndian: boolean): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (littleEndian) out.push(unit & 0xff, unit >> 8);
    else out.push(unit >> 8, unit & 0xff);
  }
  return out;
}

/** One byte per character: for text of Latin-1 characters this is windows-1252, not UTF-8. */
function singleByte(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

function encode(random: Random, text: string): Uint8Array {
  const encoding = random.weighted([
    [14, "utf-8"],
    [2, "utf-8 with a mark"],
    [2, "utf-16le with a mark"],
    [1, "utf-16be with a mark"],
    [1, "utf-16le"],
    [1, "utf-16be"],
    [1, "single byte"],
    [1, "utf-8 and a stray byte"],
    [1, "utf-16le, odd length"],
  ]);
  switch (encoding) {
    case "utf-8 with a mark": {
      const second = random.chance(0.1) ? [0xef, 0xbb, 0xbf] : [];
      return new Uint8Array([0xef, 0xbb, 0xbf, ...second, ...utf8(text)]);
    }
    case "utf-16le with a mark":
      return new Uint8Array([0xff, 0xfe, ...utf16(text, true)]);
    case "utf-16be with a mark":
      return new Uint8Array([0xfe, 0xff, ...utf16(text, false)]);
    case "utf-16le":
      return new Uint8Array(utf16(text, true));
    case "utf-16be":
      return new Uint8Array(utf16(text, false));
    case "single byte":
      return new Uint8Array(singleByte(`${text} caf${E_ACUTE} ${chr(0x93)}quoted${chr(0x94)} ${chr(0x96)}`));
    case "utf-8 and a stray byte":
      return new Uint8Array([...utf8(text), random.pick([0xff, 0xe9, 0x80, 0x00, 0x1b])]);
    case "utf-16le, odd length":
      return new Uint8Array([...utf16(text, true), 0x21]);
    default:
      return new Uint8Array(utf8(text));
  }
}

/**
 * Bytes at the limits of the test for UTF-16 without a byte-order mark (W2): pairs of
 * bytes with zeros in exactly, or nearly, 40 % of one column and 5 % of the other.
 */
function bytesAtUtf16Limits(random: Random): Uint8Array {
  const pairs = random.pick([2, 3, 5, 10, 20, 40, 60, 100]);
  const many = Math.ceil((2 * pairs) / 5) + random.pick([-1, 0, 0, 1]); // around 40 %
  const few = Math.floor(pairs / 20) + random.pick([0, 0, 1]); // around 5 %
  const littleEndian = random.chance(0.5);
  const out: number[] = [];
  for (let pair = 0; pair < pairs; pair++) {
    const inManyColumn = pair < many ? 0x00 : 0x41 + (pair % 26);
    const inFewColumn = pair >= pairs - few ? 0x00 : 0x61 + (pair % 26);
    out.push(...(littleEndian ? [inFewColumn, inManyColumn] : [inManyColumn, inFewColumn]));
  }
  if (random.chance(0.3)) out.push(0x0a);
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------------------
// The two sides, brought to one shape
// ---------------------------------------------------------------------------------------

type ProviderId = importer.Provider;
const REFERENCE_PROVIDER: Record<ProviderId, reference.Provider> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  other: "Other",
};

function productSession(session: importer.ParsedSession): unknown {
  return {
    title: session.title,
    provider: session.provider,
    model: session.model,
    sourceUrl: session.sourceUrl,
    createdAt: session.createdAt,
    summary: session.summary,
    tags: [...session.tags],
    // The display segments are part of the result, as in the fixtures.
    messages: session.messages.map((message) => ({
      role: message.role,
      text: message.text,
      segments: importer.splitDisplaySegments(message.text),
    })),
  };
}

function referenceSession(session: reference.ImportedSession): unknown {
  return {
    title: session.title,
    provider: session.provider.toLowerCase(),
    model: session.modelName,
    sourceUrl: session.sourceURL,
    createdAt: session.createdAt,
    summary: session.summary ?? "",
    tags: session.tags ?? [],
    messages: session.messages.map((message) => ({
      role: message.role,
      text: message.text,
      segments: reference.splitDisplaySegments(message.text, "web"),
    })),
  };
}

function productResult(result: importer.ImportResult): unknown {
  return {
    outcome: result.outcome,
    reason: result.reason,
    flags: [...result.flags].sort(),
    linkUrl: result.outcome === "link" ? result.linkUrl : null,
    sessions: result.sessions.map(productSession),
    droppedTurns: result.droppedTurns.map((turn) => ({
      position: turn.position,
      index: turn.index,
      text: turn.text,
    })),
  };
}

function referenceResult(result: reference.ImportResult): unknown {
  return {
    outcome: result.outcome,
    reason: result.reason,
    flags: [...(result.flags ?? [])].sort(),
    linkUrl: result.linkURL ?? null,
    sessions: result.sessions.map(referenceSession),
    droppedTurns: (result.droppedTurns ?? []).map((turn) => ({
      position: turn.position,
      index: turn.index,
      text: turn.text,
    })),
  };
}

// ---------------------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------------------

interface Comparison {
  /** Which entry point or function. */
  readonly what: string;
  /** The input, for the report of a difference. */
  readonly input: unknown;
  readonly product: () => unknown;
  readonly reference: () => unknown;
  /** The product's result as the importer returns it, for the coverage count. */
  readonly result?: () => importer.ImportResult;
  /** What kind of text the input was built as, for the coverage count. */
  readonly made?: string;
  /** Further things the input reached, for the coverage count. */
  readonly notes?: () => string[];
}

const RANDOM_BYTES = [0, 9, 10, 13, 32, 65, 97, 0x1b, 0x80, 0xe9, 0xff];

function fileCase(random: Random): Comparison {
  const asJson = random.chance(0.4);
  const kind = random.weighted(TEXT_KINDS);
  const text = asJson ? jsonText(random) : someText(random, kind);
  const bytes = random.weighted<() => Uint8Array>([
    [30, () => encode(random, text)],
    [1, () => new Uint8Array(random.repeat(0, 120, () => random.pick([...RANDOM_BYTES, random.int(256)])))],
    [2, () => bytesAtUtf16Limits(random)],
  ])();
  const stem = random.pick(FILE_STEMS);
  const extension = asJson
    ? random.weighted([
        [10, "json"],
        [2, "JSON"],
        [1, "Json"],
        [1, "txt"],
        [1, ""],
      ])
    : random.weighted([
        [12, random.pick(TEXT_EXTENSIONS)],
        [1, ""],
        [1, "json"],
      ]);
  const filename = extension === "" ? stem : `${stem}.${extension}`;
  const run = (): importer.ImportResult => importer.importFile(bytes, filename);
  const portBytes = forThePort(bytes);
  return {
    what: "importFile",
    made: asJson ? "json" : kind,
    input: { filename, bytes: [...bytes] },
    product: () => productResult(run()),
    reference: () => referenceResult(reference.importFile(portBytes, filename, "web")),
    result: run,
    notes: () => (portBytes.length < bytes.length ? ["UTF-16 with an odd last byte"] : []),
  };
}

function allowWallChoice(random: Random): boolean | undefined {
  return random.weighted<boolean | undefined>([
    [4, undefined],
    [4, true],
    [1, false],
  ]);
}

function pasteCase(random: Random): Comparison {
  const kind = random.weighted(TEXT_KINDS);
  const asJson = random.chance(0.1);
  const text = asJson ? jsonText(random) : someText(random, kind);
  const title = random.pick(TITLES);
  const pickerProvider = random.pick<ProviderId>(["claude", "claude", "chatgpt", "gemini", "other"]);
  const sourceUrl = random.chance(0.3) ? random.pick([...SOURCE_URLS, "", " "]) : undefined;
  const allowWall = allowWallChoice(random);
  const options: importer.PasteOptions = {
    title,
    pickerProvider,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(allowWall === undefined ? {} : { allowWall }),
  };
  const run = (): importer.ImportResult => importer.importPaste(text, options);
  return {
    what: "importPaste",
    made: asJson ? "json" : kind,
    input: { text, options },
    product: () => productResult(run()),
    reference: () =>
      referenceResult(
        reference.importPaste(text, REFERENCE_PROVIDER[pickerProvider], "web", {
          title,
          ...(sourceUrl === undefined ? {} : { sourceURL: sourceUrl }),
          ...(allowWall === undefined ? {} : { allowWall }),
        }),
      ),
    result: run,
  };
}

/** A typed name or a detected title. Both sides apply W1 to these, so they may be dirty. */
function captureName(random: Random): string {
  return random.weighted<string>([
    [5, ""],
    [2, "  Bread notes  "],
    [1, " \t\n"],
    [1, `Typed${NUL}\r\nname`],
    [1, sentence(random)],
    [1, `${BOM}marked${LS}`],
  ]);
}

function capturedTurn(random: Random): string {
  const lines = random.weighted<() => string[]>([
    [8, () => [markerLine(random), ...bodyLines(random, 0, 4)]],
    [3, () => bodyLines(random, 1, 4)],
    [2, () => [random.pick(["Assistant", "User:", "Claude", "## Human", "**User:**"])]],
    [2, () => [chromeTurn(random)]],
    [1, () => [padTo(random, `${sentence(random)} `, random.between(650, 760))]],
    [1, () => [""]],
  ])();
  return clearOfKnownDivergences(assemble(random, lines));
}

function capturedTurns(random: Random): string[] {
  if (random.chance(0.05)) return random.repeat(0, 3, () => chromeTurn(random));
  const leading = random.repeat(0, 2, () => chromeTurn(random));
  // The first real turn often starts with residue of the page header.
  const first = random.chance(0.5)
    ? clearOfKnownDivergences(
        assemble(random, [...headerResidue(random), markerLine(random), ...bodyLines(random, 0, 3)]),
      )
    : capturedTurn(random);
  const trailing = random.repeat(0, 2, () => chromeTurn(random));
  return [...leading, first, ...random.repeat(0, 5, () => capturedTurn(random)), ...trailing];
}

const PAGE_KINDS: readonly (readonly [number, TextKind])[] = [
  [5, "share"],
  [2, "wall"],
  [2, "labels"],
  [3, "dialogue"],
  [1, "puller"],
  [1, "pack"],
  [1, "blank"],
];

function pageText(random: Random, kind: TextKind): string[] {
  if (random.chance(0.03)) return [];
  const page = [someText(random, kind)];
  // The capture layer states the kind; a page can come as several strings.
  if (random.chance(0.1)) page.push(someText(random, "dialogue"));
  return page;
}

/**
 * A `keepDropped` list (import-rules.md W10): mostly indexes of turns, some of them twice, and
 * now and then one that names no turn at all. Absent half of the time.
 */
function keepDroppedList(random: Random, turnCount: number): number[] | undefined {
  if (random.chance(0.5)) return undefined;
  const inRange = (): number => random.int(Math.max(1, turnCount));
  return random.repeat(0, 5, () =>
    random.weighted<number>([
      [10, inRange()],
      [3, 0],
      [3, turnCount - 1],
      [1, turnCount],
      [1, turnCount + 1 + random.int(100)],
      [1, -1 - random.int(3)],
      [1, inRange() + 0.5],
      [1, Number.MAX_SAFE_INTEGER],
    ]),
  );
}

function captureCase(random: Random, kind: "page-text" | "turns"): Comparison {
  const pageKind = random.weighted(PAGE_KINDS);
  const turns = kind === "page-text" ? pageText(random, pageKind) : capturedTurns(random);
  const allowWall = allowWallChoice(random);
  const plain: importer.CaptureInput = {
    sourceUrl: random.pick(SOURCE_URLS),
    detectedTitle: random.chance(0.4) ? null : captureName(random),
    typedName: captureName(random),
    kind,
    turns,
    ...(allowWall === undefined ? {} : { allowWall }),
  };
  // Given for both kinds: for whole-page text both sides have to ignore it.
  const keepDropped = keepDroppedList(random, turns.length);
  const input: importer.CaptureInput = keepDropped === undefined ? plain : { ...plain, keepDropped };
  const run = (): importer.ImportResult => importer.importCapture(input);
  return {
    what: `importCapture ${kind}`,
    made: kind === "page-text" ? pageKind : "turns",
    input,
    product: () => productResult(run()),
    reference: () =>
      referenceResult(
        reference.importCapture(
          {
            sourceURL: input.sourceUrl,
            detectedTitle: input.detectedTitle,
            typedName: input.typedName,
            kind,
            turns: [...turns],
            ...(allowWall === undefined ? {} : { allowWall }),
            ...(keepDropped === undefined ? {} : { keepDropped: [...keepDropped] }),
          },
          "web",
        ),
      ),
    result: run,
    notes: () => {
      if (keepDropped === undefined || keepDropped.length === 0) return [];
      if (kind === "page-text") return ["keepDropped given with whole-page text"];
      const without = importer.importCapture(plain).droppedTurns.length;
      const restored = without - run().droppedTurns.length;
      return [restored > 0 ? "keepDropped put a turn back" : "keepDropped named no dropped turn"];
    },
  };
}

/** The guards on their own. The port leaves W1 to its callers, as its run.ts shows; the product applies it. */
function guardCase(random: Random): Comparison {
  const turns = random.chance(0.5)
    ? random.repeat(0, 3, () => wallText(random))
    : [
        ...random.repeat(0, 3, () => chromeTurn(random)),
        clearOfKnownDivergences(
          assemble(random, [...headerResidue(random), ...(random.chance(0.8) ? [sentence(random)] : [])]),
        ),
        ...random.repeat(0, 3, () => chromeTurn(random)),
      ];
  const keepDropped = keepDroppedList(random, turns.length);
  return {
    what: "looksLikeSignInWall and stripChromeTurns",
    input: { turns, keepDropped },
    product: () => ({
      wall: importer.looksLikeSignInWall(turns),
      chrome: importer.stripChromeTurns(turns, keepDropped),
    }),
    reference: () => {
      const normal = turns.map(reference.normaliseText);
      return {
        wall: reference.looksLikeSignInWall(normal),
        chrome: reference.stripChromeTurns(normal, "web", keepDropped ?? []),
      };
    },
    notes: () => {
      if (keepDropped === undefined || keepDropped.length === 0) return [];
      const without = importer.stripChromeTurns(turns).dropped.length;
      const restored = without - importer.stripChromeTurns(turns, keepDropped).dropped.length;
      return restored > 0 ? ["stripChromeTurns put a turn back"] : [];
    },
  };
}

function displayCase(random: Random): Comparison {
  // Prose around the blocks: ordinary lines, or lines of characters that only some trims take for blank.
  const blankish = [ZWSP, NEL, BOM, NBSP, " ", "\t", chr(0x0b)];
  const prose = (): string[] =>
    random.chance(0.25)
      ? random.repeat(1, 2, () => random.repeat(1, 2, () => random.pick(blankish)).join(""))
      : bodyLines(random, 0, 4);
  const blocks = random.repeat(1, 2, () => [...fenceBlock(random), ...prose()]).flat();
  const text = clearOfKnownDivergences(assemble(random, [...prose(), ...blocks]));
  return {
    what: "splitDisplaySegments",
    input: text,
    product: () => importer.splitDisplaySegments(text),
    reference: () => reference.splitDisplaySegments(text, "web"),
  };
}

function linkCase(random: Random): Comparison {
  let text = random.pick(LINKS);
  if (random.chance(0.3))
    text = spaces(random, 0, 2) + text + random.pick(["", "\n", "\r\n", " ", LS, ZWSP, NEL]);
  if (random.chance(0.1)) text = `${text}\r\n${random.pick(LINKS)}`;
  if (random.chance(0.1)) text = BOM + text;
  if (random.chance(0.05)) text = text.replace("a", `a${random.pick([ZWSP, NEL, NBSP, BOM, "\t"])}`);
  if (random.chance(0.25))
    text = padTo(random, "https://example.invalid/", nearThreshold(random, 500), false);
  return {
    what: "looksLikeLink",
    input: text,
    product: () => importer.looksLikeLink(text),
    // The port's test expects W1-normalised text, as its importPaste gives it.
    reference: () => reference.looksLikeLink(reference.normaliseText(text)),
  };
}

function parseJson(text: string, use: (value: unknown) => unknown): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "not JSON";
  }
  return use(value);
}

function primitiveCase(random: Random): Comparison {
  const text = someText(random);
  const line = clearLine(
    random.weighted<string>([
      [5, markerLine(random)],
      [2, decorate(random, sentence(random))],
      [1, random.pick(FURNITURE)],
    ]),
  );
  // Every character of the two trim sets at the ends, and some that only look like blanks.
  const blank = [...INLINE_SET, ...LINE_SEPARATORS, "\n", "\r", BOM, NUL, ZWSP];
  const blanks = (): string => random.repeat(0, 4, () => random.pick(blank)).join("");
  const padded = oneLeadingMark(`${blanks()}${words(random, 0, 3)}${blanks()}`);
  const filename = `${random.pick(FILE_STEMS)}${random.pick(["", ".txt", ".JSON", ".", ". md", ".tar.gz", ".a b"])}`;
  const url = random.pick(SOURCE_URLS);
  const bytes = random.chance(0.2) ? bytesAtUtf16Limits(random) : encode(random, text);
  const portBytes = forThePort(bytes);
  const json = jsonText(random);
  const title = random.pick(TITLES);
  return {
    what: "the building blocks",
    input: { text, line, padded, filename, url, json, title, bytes: [...bytes] },
    product: () => {
      const marker = importer.roleMarker(line);
      const name = importer.splitFileName(filename);
      const decoded = importer.decodeBytes(bytes);
      return {
        normal: [importer.normaliseText(text), importer.normaliseText(padded)],
        trimInline: [importer.trimInline(line), importer.trimInline(padded)],
        trimFull: [importer.trimFull(text), importer.trimFull(padded)],
        count: [importer.countGraphemes(line), importer.countGraphemes(padded)],
        fewer: [importer.hasFewerGraphemesThan(line, 5), importer.hasFewerGraphemesThan(line, 90)],
        lines: importer.splitLines(text).length,
        marker:
          marker === null
            ? null
            : { role: marker.role, rest: marker.rest, name: marker.name, bare: marker.bare },
        name: { stem: name.stem, extension: name.extension },
        provider: importer.providerForUrl(url),
        decoded: decoded === null ? null : { text: decoded.text, flag: decoded.flag },
        sessions: importer.parseText(text, title).map(productSession),
        // Without the JSON text the product orders nodes as JSON.parse does, like the port.
        chatgpt: parseJson(json, (value) => importer.parseChatGPTExport(value)?.map(productSession) ?? null),
      };
    },
    reference: () => {
      const marker = reference.roleMarker(line, "web");
      const name = reference.splitExtension(filename);
      const decoded = reference.decodeBytesWeb(portBytes);
      return {
        normal: [reference.normaliseText(text), reference.normaliseText(padded)],
        trimInline: [reference.trimInline(line), reference.trimInline(padded)],
        trimFull: [reference.trimAll(text), reference.trimAll(padded)],
        count: [reference.countGraphemes(line), reference.countGraphemes(padded)],
        fewer: [reference.fewerGraphemesThan(line, 5), reference.fewerGraphemesThan(line, 90)],
        lines: text.split("\n").length,
        marker:
          marker === null
            ? null
            : { role: marker.role, rest: marker.rest, name: marker.name, bare: marker.bare },
        name: { stem: name.stem, extension: name.ext },
        provider: reference.providerFromURL(url)?.toLowerCase() ?? null,
        decoded: decoded === null ? null : { text: decoded.text, flag: decoded.flag },
        sessions: reference.parseText(text, title, "web").map(referenceSession),
        chatgpt: parseJson(
          json,
          (value) => reference.parseChatGPTExport(value, "web")?.map(referenceSession) ?? null,
        ),
      };
    },
    notes: () => (portBytes.length < bytes.length ? ["UTF-16 with an odd last byte"] : []),
  };
}

const CASE_KINDS: readonly (readonly [number, (random: Random) => Comparison])[] = [
  [24, fileCase],
  [22, pasteCase],
  [10, (random) => captureCase(random, "page-text")],
  [16, (random) => captureCase(random, "turns")],
  [6, guardCase],
  [6, displayCase],
  [5, linkCase],
  [11, primitiveCase],
];

function caseNumber(seed: number, index: number): Comparison {
  const random = new Random((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  return random.weighted(CASE_KINDS)(random);
}

/** Runs one side; an exception is a result too, so that it shows up as a difference. */
function outcomeOf(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    return JSON.stringify({ threw: String(error) });
  }
}

function clip(text: string, limit = 1500): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}... (${text.length} characters)`;
}

/** What the corpus has to reach, each at least five times, or equality means little. */
const REQUIRED = list(
  "importFile|importPaste|importCapture page-text|importCapture turns|looksLikeSignInWall and stripChromeTurns|" +
    "splitDisplaySegments|looksLikeLink|the building blocks|" +
    "importFile: imported|importFile: empty_input|importFile: undecodable|importFile: unrecognised_json|" +
    "importFile: no_messages|importPaste: imported|importPaste: link|importPaste: empty_input|" +
    "importPaste: sign_in_suspected|importPaste: no_messages|importCapture page-text: imported|" +
    "importCapture page-text: sign_in_suspected|importCapture page-text: no_conversation_found|" +
    "importCapture turns: imported|importCapture turns: no_conversation_found|" +
    "decoded_as_utf_16le|decoded_as_utf_16be|decoded_as_windows_1252|dropped leading|dropped trailing|" +
    "several sessions|provider claude|provider chatgpt|provider gemini|provider other|a date|a summary|tags|" +
    "a model|a source link|role user|role assistant|role system|role unknown|a code segment|" +
    // Every parser, through every entry point that leads to it.
    "importFile of json text: imported|importFile of dialogue text: imported|importFile of puller text: imported|" +
    "importFile of share text: imported|importFile of labels text: imported|importFile of pack text: imported|" +
    "importPaste of dialogue text: imported|importPaste of puller text: imported|importPaste of share text: imported|" +
    "importPaste of labels text: imported|importPaste of pack text: imported|importPaste of wall text: imported|" +
    "importPaste of wall text: sign_in_suspected|importPaste of link text: link|" +
    "importCapture page-text of share text: imported|importCapture page-text of labels text: imported|" +
    "importCapture page-text of dialogue text: imported|importCapture page-text of puller text: imported|" +
    "importCapture page-text of pack text: imported|importCapture page-text of wall text: sign_in_suspected|" +
    "importCapture turns of turns text: imported|" +
    // W10 keep_dropped, on both functions that take it, and where it must change nothing.
    "keepDropped put a turn back|keepDropped named no dropped turn|keepDropped given with whole-page text|" +
    "stripChromeTurns put a turn back|" +
    // corrections.md 3, point 1: the product on all the bytes, the port without the odd last one.
    "UTF-16 with an odd last byte",
);

// ---------------------------------------------------------------------------------------

describe("import differential: product against the reference port in web mode", () => {
  it(`${CASES} generated inputs give exactly the same results (seed ${SEED})`, { timeout: 300_000 }, () => {
    const differences: string[] = [];
    const seen = new Map<string, number>();
    const count = (key: string): void => {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    };

    for (let index = 0; index < CASES; index++) {
      const comparison = caseNumber(SEED, index);
      const mine = outcomeOf(comparison.product);
      const theirs = outcomeOf(comparison.reference);
      count(comparison.what);
      if (mine !== theirs) {
        const where = `case ${index} (${comparison.what})`;
        differences.push(
          differences.length >= 5
            ? where
            : `${where}\n  input:     ${clip(JSON.stringify(comparison.input))}\n` +
                `  product:   ${clip(mine)}\n  reference: ${clip(theirs)}`,
        );
        continue;
      }

      // What the inputs reached, counted on the product's own result.
      if (mine.includes('"threw"')) count("an exception on both sides");
      if (mine.includes('"type":"code"')) count("a code segment");
      for (const note of comparison.notes?.() ?? []) count(note);
      const result = comparison.result?.();
      if (result === undefined) continue;
      const outcome = result.outcome === "rejected" ? result.reason : result.outcome;
      count(`${comparison.what}: ${outcome}`);
      if (comparison.made !== undefined) count(`${comparison.what} of ${comparison.made} text: ${outcome}`);
      for (const flag of result.flags) count(flag);
      for (const turn of result.droppedTurns) count(`dropped ${turn.position}`);
      if (result.sessions.length > 1) count("several sessions");
      for (const session of result.sessions) {
        count(`provider ${session.provider}`);
        if (session.createdAt !== null) count("a date");
        if (session.summary !== "") count("a summary");
        if (session.tags.length > 0) count("tags");
        if (session.model !== "") count("a model");
        if (session.sourceUrl !== "") count("a source link");
        for (const message of session.messages) count(`role ${message.role}`);
      }
    }

    if (process.env.IMPORT_DIFF_REPORT) {
      const lines = [...seen]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, times]) => `${String(times).padStart(6)}  ${key}`);
      console.info(
        `import differential, seed ${SEED}, ${CASES} cases, ${differences.length} differ\n${lines.join("\n")}`,
      );
    }
    expect(
      differences,
      `${differences.length} of ${CASES} cases differ:\n${differences.join("\n")}\n`,
    ).toEqual([]);
    const missing = REQUIRED.filter((key) => (seen.get(key) ?? 0) < 5);
    expect(missing, "the generated inputs reached these fewer than five times").toEqual([]);
    expect(seen.get("an exception on both sides") ?? 0, "inputs on which both sides threw").toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// The documented divergences
//
// Where the product departs from the reference port on purpose. The corpus above avoids
// these inputs; each is shown here once, with both results and the rule that decides.
// If the port or the product changes on one of them, this block says so.
//
// Three groups: what docs/corrections.md section 3 decided after the port was written
// (points 1 to 10; points 2 and 3 are what the port does too), the port's known defects
// (points 11 to 15, also listed in reference/import-port/README.md), and one detail of the
// product's own interface.
// ---------------------------------------------------------------------------------------

const REPLACEMENT = chr(0xfffd);
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** One node of a ChatGPT export, as JSON text; `time` is written as given, so 1e999 can be. */
function exportNode(text: string, time?: string): string {
  const createTime = time === undefined ? "" : `"create_time":${time},`;
  return `{"message":{"author":{"role":"user"},${createTime}"content":{"parts":[${JSON.stringify(text)}]}}}`;
}

interface Messages {
  readonly sessions: readonly {
    readonly messages: readonly { readonly role: string; readonly text: string }[];
  }[];
}
const textsOf = (result: Messages): string[] =>
  result.sessions.flatMap((session) => session.messages.map((message) => message.text));
const turnsOf = (result: Messages): [string, string][] =>
  result.sessions.flatMap((session) =>
    session.messages.map((message): [string, string] => [message.role, message.text]),
  );

/** The same capture for both sides: one turn "User: q" unless stated otherwise. */
function captureBoth(
  sourceUrl: string,
  turns: readonly string[] = ["User: q"],
): { readonly mine: importer.ImportResult; readonly theirs: reference.ImportResult } {
  return {
    mine: importer.importCapture({ sourceUrl, detectedTitle: null, typedName: "", kind: "turns", turns }),
    theirs: reference.importCapture(
      { sourceURL: sourceUrl, detectedTitle: null, typedName: "", kind: "turns", turns: [...turns] },
      "web",
    ),
  };
}

/** Processor time of the fastest of three runs, in milliseconds: other work on the machine does not count. */
function processorTime(run: () => unknown): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = process.cpuUsage();
    run();
    const used = process.cpuUsage(before);
    best = Math.min(best, (used.user + used.system) / 1000);
  }
  return best;
}

describe("documented divergences: decided after the port was written (corrections.md 3, points 1 to 10)", () => {
  it("point 1: an odd last byte of UTF-16 text is ignored; the port decodes it to U+FFFD", () => {
    const odd = new Uint8Array([0xff, 0xfe, ...utf16("User: q", true), 0x21]);
    expect(importer.decodeBytes(odd)).toEqual({ text: "User: q", flag: "decoded_as_utf_16le" });
    expect(reference.decodeBytesWeb(odd)).toEqual({
      text: `User: q${REPLACEMENT}`,
      flag: "decoded_as_utf_16le",
    });
    expect(textsOf(importer.importFile(odd, "a.txt"))).toEqual(["q"]);
    expect(textsOf(reference.importFile(odd, "a.txt", "web"))).toEqual([`q${REPLACEMENT}`]);
    // Without a mark the two agree on what the bytes are, and differ in the same way.
    const bare = new Uint8Array([...utf16("User: q", false), 0x21]);
    expect(importer.decodeBytes(bare)).toEqual({ text: "User: q", flag: "decoded_as_utf_16be" });
    expect(reference.decodeBytesWeb(bare)?.text).toBe(`User: q${REPLACEMENT}`);
    // Given the bytes without the odd one, the port gives the product's result: that is how
    // the corpus above compares such input.
    expect(reference.decodeBytesWeb(forThePort(odd))).toEqual(importer.decodeBytes(odd));
    expect(forThePort(odd).length).toBe(odd.length - 1);
  });

  it("point 4: W1 removes every leading U+FEFF; the port removes one each time it normalises", () => {
    expect(importer.normaliseText(`${BOM}${BOM}${BOM}x`)).toBe("x");
    expect(reference.normaliseText(`${BOM}${BOM}${BOM}x`)).toBe(`${BOM}${BOM}x`);
    // The port normalises a captured turn once: a second mark stays and hides the marker.
    const turn = `${BOM}${BOM}User: q`;
    const captured = captureBoth("https://example.invalid/share/EXAMPLE", [turn]);
    expect(turnsOf(captured.mine)).toEqual([["user", "q"]]);
    expect(turnsOf(captured.theirs)).toEqual([["unknown", `${BOM}User: q`]]);
    // It normalises a file three times (the decoder, importFile, parseText): a fourth mark stays.
    const file = bytesOf(`${BOM}${BOM}${BOM}${BOM}User: q`);
    expect(turnsOf(importer.importFile(file, "a.txt"))).toEqual([["user", "q"]]);
    expect(turnsOf(reference.importFile(file, "a.txt", "web"))).toEqual([["unknown", `${BOM}User: q`]]);
    // And a U+0000 in front of a mark hides the mark from one pass of the port.
    expect(importer.normaliseText(`${NUL}${BOM}x`)).toBe("x");
    expect(reference.normaliseText(`${NUL}${BOM}x`)).toBe(`${BOM}x`);
    expect(reference.normaliseText(reference.normaliseText(`${NUL}${BOM}x`))).toBe("x");
    // The product's W1 is idempotent, the port's is not.
    const twice = importer.normaliseText(importer.normaliseText(`${BOM}${BOM}x`));
    expect(twice).toBe(importer.normaliseText(`${BOM}${BOM}x`));
    expect(reference.normaliseText(reference.normaliseText(`${BOM}${BOM}x`))).not.toBe(
      reference.normaliseText(`${BOM}${BOM}x`),
    );
  });

  it("point 5: create_time gives a date only for the years 0001 to 9999; the port prints whatever Date prints", () => {
    const dateOf = (seconds: string): [string | null | undefined, string | null | undefined] => {
      const file = bytesOf(`{"create_time":${seconds},"mapping":{"a":${exportNode("x")}}}`);
      return [
        importer.importFile(file, "c.json").sessions[0]?.createdAt,
        reference.importFile(file, "c.json", "web").sessions[0]?.createdAt,
      ];
    };
    // The first second of the year 10000.
    expect(dateOf("253402300800")).toEqual([null, "+010000-01-01T00:00:00.000Z"]);
    // The first second of the year 0000, and the last one: no timestamp of the interchange format has that year.
    expect(dateOf("-62167219200")).toEqual([null, "0000-01-01T00:00:00.000Z"]);
    expect(dateOf("-62135596801")).toEqual([null, "0000-12-31T23:59:59.000Z"]);
    // Inside the range the two agree, at both ends.
    expect(dateOf("-62135596800")).toEqual(["0001-01-01T00:00:00.000Z", "0001-01-01T00:00:00.000Z"]);
    expect(dateOf("253402300799")).toEqual(["9999-12-31T23:59:59.000Z", "9999-12-31T23:59:59.000Z"]);
  });

  it("point 5: for the order of nodes a time counts when it is finite; the port also sorts by one that is not", () => {
    // JSON.parse reads 1e999 as Infinity.
    const file = bytesOf(
      `{"mapping":{"a":${exportNode("not finite", "1e999")},"b":${exportNode("five", "5")},"c":${exportNode("zero", "0")}}}`,
    );
    // The product: not finite counts as 0, so the node keeps its place among the zeros.
    expect(textsOf(importer.importFile(file, "c.json"))).toEqual(["not finite", "zero", "five"]);
    expect(textsOf(reference.importFile(file, "c.json", "web"))).toEqual(["zero", "five", "not finite"]);
    // A finite time far from any date orders the nodes on both sides.
    const finite = bytesOf(
      `{"mapping":{"a":${exportNode("huge", "1e300")},"b":${exportNode("five", "5")},"c":${exportNode("zero", "0")}}}`,
    );
    expect(textsOf(importer.importFile(finite, "c.json"))).toEqual(["zero", "five", "huge"]);
    expect(textsOf(reference.importFile(finite, "c.json", "web"))).toEqual(["zero", "five", "huge"]);
  });

  it("point 6: every candidate for a capture title goes through W1 and the full trim; the last is 'Captured session'", () => {
    const titles = (sourceUrl: string): [string | undefined, string | undefined] => {
      const both = captureBoth(sourceUrl);
      return [both.mine.sessions[0]?.title, both.theirs.sessions[0]?.title];
    };
    // The last path segment, percent-decoded: the port takes it as decoded.
    expect(titles("https://example.invalid/a/%20Bread%20notes%20")).toEqual(["Bread notes", " Bread notes "]);
    // Decoded, it can hold what a title must not: U+0000 and CR.
    expect(titles("https://example.invalid/a%00b%0Dc")).toEqual(["ab\nc", `a${NUL}b\rc`]);
    // A segment that is empty after decoding and the trim does not count: the link is next.
    const blankSegment = "https://example.invalid/a/%20%09";
    expect(titles(blankSegment)).toEqual([blankSegment, " \t"]);
    // The link itself is a candidate like the others.
    expect(titles("  not a link \n")).toEqual(["not a link", "  not a link \n"]);
    // And when every candidate is empty, the constant. The port returns the blank link.
    expect(titles(" ")).toEqual(["Captured session", " "]);
    expect(titles("")).toEqual(["Captured session", ""]);
  });

  it("point 7: W1 applies to every stored string: the caller's title, the link, the file name", () => {
    const dirty = `a${NUL}b\r\nc${HIGH}`;
    const clean = `ab\nc${REPLACEMENT}`;
    const mine = importer.importPaste("note", { title: dirty, pickerProvider: "other", sourceUrl: dirty });
    const theirs = reference.importPaste("note", "Other", "web", { title: dirty, sourceURL: dirty });
    expect([mine.sessions[0]?.title, mine.sessions[0]?.sourceUrl]).toEqual([clean, clean]);
    expect([theirs.sessions[0]?.title, theirs.sessions[0]?.sourceURL]).toEqual([dirty, dirty]);

    expect(importer.importFile(bytesOf("note"), `${dirty}.txt`).sessions[0]?.title).toBe(clean);
    expect(reference.importFile(bytesOf("note"), `${dirty}.txt`, "web").sessions[0]?.title).toBe(dirty);

    const link = `https://claude.ai/share/E${NUL}XAMPLE`;
    const captured = captureBoth(link);
    expect(captured.mine.sessions[0]?.sourceUrl).toBe("https://claude.ai/share/EXAMPLE");
    expect(captured.theirs.sessions[0]?.sourceURL).toBe(link);
  });

  it("point 8: a header-line text or a title that is blank without being empty counts as empty; the port stores it", () => {
    // U+2028 survives the inline trim of the header line. The turn has no other text.
    const share = `You said: ${LS}\nClaude responded: a\nb`;
    expect(turnsOf({ sessions: importer.parseText(share, "t") })).toEqual([["assistant", "a\nb"]]);
    expect(turnsOf({ sessions: reference.parseText(share, "t", "web") })).toEqual([
      ["user", LS],
      ["assistant", "a\nb"],
    ]);
    // The same for the title line of puller Markdown.
    const puller = `# ${LS}\nSource: https://claude.ai/code/EXAMPLE\n\nUser: q\n`;
    expect(importer.parseText(puller, "from the caller")[0]?.title).toBe("from the caller");
    expect(reference.parseText(puller, "from the caller", "web")[0]?.title).toBe(LS);
  });

  it("point 9: marker words are matched with ASCII case folding only; the port lower-cases U+0130 into a marker", () => {
    const line = `A${I_WITH_DOT}: x`;
    expect(importer.roleMarker(line)).toBeNull();
    expect(reference.roleMarker(line, "web")).toEqual({
      role: "assistant",
      rest: "x",
      name: "ai",
      bare: false,
    });
    expect(importer.roleMarker(`GEMIN${I_WITH_DOT}`)).toBeNull();
    expect(reference.roleMarker(`GEMIN${I_WITH_DOT}`, "web")).toEqual({
      role: "assistant",
      rest: "",
      name: "gemini",
      bare: true,
    });
    // In a text the port cuts a message at such a line and names a provider after it.
    const text = `User: q\nGemin${I_WITH_DOT}: a`;
    const mine = importer.parseText(text, "t")[0];
    const theirs = reference.parseText(text, "t", "web")[0];
    expect([mine?.provider, turnsOf({ sessions: mine === undefined ? [] : [mine] })]).toEqual([
      "other",
      [["user", `q\nGemin${I_WITH_DOT}: a`]],
    ]);
    expect([theirs?.provider, turnsOf({ sessions: theirs === undefined ? [] : [theirs] })]).toEqual([
      "Gemini",
      [
        ["user", "q"],
        ["assistant", "a"],
      ],
    ]);
    // The corpus keeps such lines out: the test for it recognises exactly these.
    expect(isMarkerOnlyByLowerCasing(line)).toBe(true);
    expect(isMarkerOnlyByLowerCasing(`AI: ${I_WITH_DOT}x`)).toBe(false);
  });

  it("point 10 and W3: an interchange file is the fourth outcome; the port leaves that format out by its own statement", () => {
    const file = bytesOf(
      '{"format":"sessionvault-interchange","version":1,"kind":"vault","projects":[],"sessions":[]}',
    );
    const mine = importer.importFile(file, "vault.json");
    expect(mine.outcome).toBe("interchange");
    expect(mine.reason).toBeNull();
    expect(reference.importFile(file, "vault.json", "web").reason).toBe("unrecognised_json");
  });
});

describe("documented divergences: the known defects of the port (corrections.md 3, points 11 to 15)", () => {
  it("point 11: ties among node ids that look like integers follow the JSON text; the port follows Object.keys", () => {
    // JSON.parse moves such keys to the front in numeric order; W4 asks for the order of the text.
    const file = bytesOf(
      `{"mapping":{"10":${exportNode("ten")},"b":${exportNode("b")},"2":${exportNode("two")}}}`,
    );
    expect(textsOf(importer.importFile(file, "c.json"))).toEqual(["ten", "b", "two"]);
    expect(textsOf(reference.importFile(file, "c.json", "web"))).toEqual(["two", "ten", "b"]);
  });

  it("point 12: only the four role lines of a context pack are role lines; the port finds 'constructor' in a plain object", () => {
    const pack =
      "# Context pack: T\n\n## Transcript\n\n**User:**\n\nabove\n\n---\n\nconstructor\n\nbelow\n\n---\n";
    expect(importer.parseText(pack, "t")[0]?.messages).toEqual([
      { role: "user", text: "above\n\n---\n\nconstructor\n\nbelow" },
    ]);
    const theirs = reference.parseText(pack, "t", "web")[0]?.messages ?? [];
    expect(theirs.map((message) => message.text)).toEqual(["above", "below"]);
    // The role of the port's second message is the constructor function of every object.
    expect(typeof theirs[1]?.role).toBe("function");
  });

  it("point 13: U+2028 and U+2029 are ordinary characters of a fence opening line; the port's '.' stops at them", () => {
    const text = `${TICKS}js${LS}x\ncode\n${TICKS}`;
    expect(importer.splitDisplaySegments(text)).toEqual([
      { type: "code", language: `js${LS}x`, code: "code" },
    ]);
    expect(reference.splitDisplaySegments(text, "web")).toEqual([
      { type: "prose", text: `${TICKS}js${LS}x\ncode` },
      { type: "code", language: null, code: "" },
    ]);
  });

  it("point 13: the same on the Origin line of a context pack", () => {
    const pack = `# Context pack: T\n\nOrigin: Claude (mo${PS}del), saved x\n\n## Transcript\n\n**User:**\n\nq\n\n---\n`;
    const mine = importer.parseText(pack, "t")[0];
    const theirs = reference.parseText(pack, "t", "web")[0];
    expect([mine?.provider, mine?.model]).toEqual(["claude", `mo${PS}del`]);
    expect([theirs?.provider, theirs?.modelName]).toEqual(["Other", ""]);
  });

  it("point 14: the port's trim takes four times as long for twice the blanks inside a line; the product's is linear", {
    timeout: 120_000,
  }, () => {
    const line = (blanks: number): string => `x${" ".repeat(blanks)}x`;
    // Both leave such a line as it is: the run of blanks is inside it.
    expect(reference.trimInline(line(100))).toBe(line(100));
    expect(importer.trimInline(line(100))).toBe(line(100));
    const portShort = processorTime(() => reference.trimInline(line(10_000)));
    const portLong = processorTime(() => reference.trimInline(line(20_000)));
    const product = processorTime(() => importer.trimInline(line(1_000_000)));
    // Quadratic: twice the input, about four times the time (measured: 40 ms and 159 ms).
    // Linear would be a factor of 2; the bound leaves room for a noisy measurement.
    expect(portLong / portShort).toBeGreaterThan(2.8);
    // The product trims fifty times as many blanks in a fraction of that time (measured: under 1 ms).
    expect(product).toBeLessThan(portLong / 10);
  });

  it("point 14: the same for the port's pattern on an Origin line with ' (' repeated", {
    timeout: 120_000,
  }, () => {
    const pack = (pairs: number): string =>
      `# Context pack: T\n\nOrigin: ${" (".repeat(pairs)}\n\n## Transcript\n\n**User:**\n\nq\n\n---\n`;
    expect(turnsOf({ sessions: reference.parseText(pack(10), "t", "web") })).toEqual([["user", "q"]]);
    expect(turnsOf({ sessions: importer.parseText(pack(10), "t") })).toEqual([["user", "q"]]);
    const portShort = processorTime(() => reference.parseText(pack(8_000), "t", "web"));
    const portLong = processorTime(() => reference.parseText(pack(16_000), "t", "web"));
    const product = processorTime(() => importer.parseText(pack(500_000), "t"));
    // Measured: 54 ms and about 220 ms for the port, 2 ms for the product on thirty times as much.
    // Linear would be a factor of 2; the bound leaves room for a noisy measurement.
    expect(portLong / portShort).toBeGreaterThan(2.8);
    expect(product).toBeLessThan(portLong / 10);
  });

  it("point 15: the product compiles under the strict settings of web/tsconfig.base.json; the port does not", {
    timeout: 300_000,
  }, () => {
    const web = new URL("../../", import.meta.url);
    const read = ts.readConfigFile(fileURLToPath(new URL("tsconfig.base.json", web)), ts.sys.readFile);
    const settings: unknown = read.config?.compilerOptions;
    const { options, errors } = ts.convertCompilerOptionsFromJson(settings, fileURLToPath(web));
    expect(errors).toEqual([]);
    expect(options.strict).toBe(true);
    // The number of errors the compiler reports for some files, without the types of any platform.
    const errorsIn = (files: readonly string[]): number =>
      ts.getPreEmitDiagnostics(ts.createProgram({ rootNames: files, options: { ...options, types: [] } }))
        .length;
    const folder = new URL("core/src/import/", web);
    const product = readdirSync(folder)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => fileURLToPath(new URL(name, folder)));
    expect(product.length).toBeGreaterThanOrEqual(20);
    expect(errorsIn(product)).toBe(0);
    const port = fileURLToPath(new URL("reference/import-port/importer.ts", web));
    expect(errorsIn([port])).toBeGreaterThan(10);
  });

  it("point 15: without String.prototype.toWellFormed the port's W1 leaves a lone surrogate; the product replaces it", () => {
    const sample = `a${HIGH}b`;
    const original = Object.getOwnPropertyDescriptor(String.prototype, "toWellFormed");
    expect(original).toBeDefined();
    // With the method, as on this platform, the two agree.
    expect(reference.normaliseText(sample)).toBe(`a${REPLACEMENT}b`);
    expect(importer.normaliseText(sample)).toBe(`a${REPLACEMENT}b`);
    try {
      Reflect.deleteProperty(String.prototype, "toWellFormed");
      expect(reference.normaliseText(sample)).toBe(sample);
      expect(importer.normaliseText(sample)).toBe(`a${REPLACEMENT}b`);
    } finally {
      if (original !== undefined) Object.defineProperty(String.prototype, "toWellFormed", original);
    }
    expect(reference.normaliseText(sample)).toBe(`a${REPLACEMENT}b`);
  });
});

describe("documented divergences: a detail of the product's own interface", () => {
  it("W15: 'fewer than 0 characters' is false for every text, the empty one included", () => {
    expect(importer.hasFewerGraphemesThan("", 0)).toBe(false);
    expect(reference.fewerGraphemesThan("", 0)).toBe(true);
  });
});
