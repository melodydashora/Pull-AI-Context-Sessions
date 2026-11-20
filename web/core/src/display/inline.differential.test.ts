// parseInline against the parser as first written (inline-first-written.test-support.ts).
//
// On 2026-11-20 a security review of the first screens measured the first parser on hostile text:
// 1 MB of "(*a" repeated took 11.7 s, ".*a" 10.2 s, " **a" 4.2 s, "http:///" 2.7 s, and 497
// opening brackets followed by "](" 2.3 s. inline.ts was changed so that these cost a step each.
// This file proves two things about that change: no result differs, and time grows with the
// length of the text, not with its square.

import { describe, expect, it } from "vitest";
import { parseInline, parseInlineWith } from "./inline.ts";
import { parseInline as first, parseInlineWith as firstWith } from "./inline-first-written.test-support.ts";

/** A small generator with a seed, so that a failure can be repeated. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BS = String.fromCharCode(92);
const PIECES: readonly string[] = [
  "*",
  "**",
  "***",
  "****",
  "~",
  "~~",
  "~~~",
  "`",
  "``",
  BS,
  BS + BS,
  "[",
  "]",
  "(",
  ")",
  "![",
  "](",
  "]()",
  "[]",
  "()",
  "((",
  "))",
  " ",
  "  ",
  "\n",
  "\t",
  "a",
  "b",
  "Z",
  "9",
  ".",
  ",",
  "!",
  "?",
  ":",
  "'",
  '"',
  "<",
  ">",
  "/",
  "http://",
  "https://",
  "HTTP://",
  "http:///",
  "https://example.com/a",
  "http://a.b",
  "mailto:a@b.c",
  "javascript:x",
  "h",
  "http",
  "://",
  String.fromCharCode(0xe9),
  String.fromCharCode(0x2028),
  String.fromCharCode(0xd83d),
  "x".repeat(7),
  "y".repeat(499),
  "z".repeat(501),
  "q".repeat(1990),
  "(w)".repeat(700),
];

function text(next: () => number, pieces: number): string {
  let out = "";
  for (let k = 0; k < pieces; k++) out += PIECES[Math.floor(next() * PIECES.length)];
  return out;
}

describe("parseInline gives what the parser as first written gave", () => {
  it("on 30,000 short texts made of markup pieces", () => {
    const next = random(20261120);
    for (let n = 0; n < 30_000; n++) {
      const s = text(next, 1 + Math.floor(next() * 14));
      expect(parseInline(s), JSON.stringify(s)).toEqual(first(s));
    }
  });

  it("on 1,500 longer texts, past every look-ahead and window", () => {
    const next = random(1120);
    for (let n = 0; n < 1_500; n++) {
      const s = text(next, 20 + Math.floor(next() * 120));
      expect(parseInline(s), `seed 1120, text ${n}`).toEqual(first(s));
    }
  });

  it.each([3, 4, 5, 7, 9, 12])(
    "on 20,000 short texts with a look-ahead of %i, which they reach",
    (lookahead) => {
      const next = random(lookahead);
      for (let n = 0; n < 20_000; n++) {
        const s = text(next, 1 + Math.floor(next() * 14));
        expect(parseInlineWith(s, lookahead), JSON.stringify(s)).toEqual(firstWith(s, lookahead));
      }
    },
  );

  it.each([
    ["a label of 500 characters", `[${"l".repeat(500)}](http://a)`],
    ["a label of 501 characters", `[${"l".repeat(501)}](http://a)`],
    ["a line break in the label", "[a\nb](http://a)"],
    ["a destination of 2,000 pieces", `[a](http://${"d".repeat(1993)})`],
    ["a destination of 2,001 pieces", `[a](http://${"d".repeat(1994)})`],
    [
      "a link that ends on the last place of the window",
      `[${"l".repeat(497)}](http://${"(dd)".repeat(523)})`,
    ],
    ["a link one character longer than the window", `[${"l".repeat(498)}](http://${"(dd)".repeat(523)})`],
    ["many opening brackets before one link", `${"[".repeat(400)}a](https://a.b/c) [b](http://d)`],
    ["an image mark before each bracket", "![![a](http://a)](http://b)"],
    ["a closing run exactly at the look-ahead", `*a${"b".repeat(1997)}* *c${"d".repeat(1998)}*`],
    ["backslashes before closing runs", `*a${BS}* b${BS}${BS}* c* **d${BS}** e**`],
    ["an address without a host", "http:/// https:// http://. http://.a http://<a"],
  ])("on %s", (_name, s) => {
    expect(parseInline(s)).toEqual(first(s));
  });
});

describe("parseInline, time: hostile text costs little more than plain text", () => {
  // Each pattern was among the slowest for the parser as first written, which was not quadratic
  // in the length of the text: it searched 2,000 characters again for every opening run without
  // a closing one, so four times the text took four times as long, and a ratio between two
  // lengths would pass while the page hangs. The measure is therefore plain text of the same
  // length. Measured on 2026-11-20 on 4 processors: plain words 15 ms for 1 MB, the patterns at
  // most 87 ms (the parser as first written: 2 to 12 s; the reference of design.md 5.4 on an
  // Apple M3: 200 times plain words). The floor of 300 ms is room for a busy machine.
  const LENGTH = 1_000_000;
  const measure = (s: string): number => {
    const started = performance.now();
    parseInline(s);
    return performance.now() - started;
  };
  const fill = (unit: string): string => unit.repeat(Math.ceil(LENGTH / unit.length));
  const plain = fill("plain words and nothing else ");

  it.each([
    "(*a",
    ".*a",
    " *a",
    " **a",
    " ~~a",
    " ***a",
    "(***a",
    "http:///",
    "http://.",
    `${"[".repeat(497)}](`,
    "[",
    `${"[".repeat(400)}](${"d".repeat(2100)}`,
    "![",
    `[a](${"(".repeat(3)}`,
    "`a``b",
    `*a${BS}*`,
    `http://a${")".repeat(1992)} `,
    `http://a${"]".repeat(1992)} `,
  ])("for %s repeated", (unit) => {
    const hostile = fill(unit);
    parseInline(hostile.slice(0, 100_000)); // warm up
    const base = Math.min(measure(plain), measure(plain));
    const took = Math.min(measure(hostile), measure(hostile));
    expect(took, `plain text took ${base.toFixed(0)} ms`).toBeLessThan(Math.max(300, 40 * base));
  });
});
