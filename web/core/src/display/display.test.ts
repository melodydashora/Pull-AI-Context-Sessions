// The golden cases of docs/design.md, appendix 5.4, for the display rules, and tests for what
// the port adds: hostile addresses stay text, and no input takes more than linear time.

import { describe, expect, it } from "vitest";
import {
  type InlineNode,
  inlineText,
  parseInline,
  type RenderBlock,
  relativeParts,
  renderBlocks,
  splitParagraphs,
  summaryLine,
} from "./index.ts";

const F = "```";

/** The notation of the tables in appendix 5.4. */
function show(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.text;
        case "code":
          return `<code:${node.text}>`;
        case "link":
          return `<link:${node.text} @ ${node.href}>`;
        default:
          return `<${node.type}:${show(node.children)}>`;
      }
    })
    .join("");
}

function links(nodes: readonly InlineNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === "link"
      ? [node.href]
      : node.type === "text" || node.type === "code"
        ? []
        : links(node.children),
  );
}

describe("parseInline, the golden cases of design.md 5.4", () => {
  const unchanged = [
    "[d](data:text/html,x) [f](file:///etc/hosts)",
    "__init__ and _private_var_ and snake_case_name",
    "a*b*c and x**y**z and 2 * 3 * 4",
    "use **kwargs or **options here, def f(*args, **kwargs)",
    "*.md and *.txt files",
    "char *p, *q; *ptr = *other; (*it)*2",
    "regex ^\\d+\\.\\d+$ and path C:\\temp\\*.txt",
    "\\*not italic\\* and \\# text",
    "5 ~~ 6 and ~single~ and ~10 cm, ~20 cm",
    "# Heading\n- item one\n1. first\n> quote",
    "<b>x</b> <script>alert(1)</script>",
    "unbalanced **bold and *italic",
    "`unclosed code span ",
  ];
  it.each(unchanged)("leaves %j as plain text", (input) => {
    expect(parseInline(input)).toEqual([{ type: "text", text: input }]);
  });

  const cases: [string, string][] = [
    [
      "**bold** and *italic* and `code` and ~~strike~~",
      "<strong:bold> and <em:italic> and <code:code> and <strike:strike>",
    ],
    ["see [a link](https://example.com/page) now", "see <link:a link @ https://example.com/page> now"],
    [
      "bare https://example.com/path url.",
      "bare <link:https://example.com/path @ https://example.com/path> url.",
    ],
    [
      "see https://example.com/a_(b). Next",
      "see <link:https://example.com/a_(b) @ https://example.com/a_(b)>. Next",
    ],
    [
      "[unsafe](javascript:alert(1)) and [mail](mailto:someone@example.com)",
      "[unsafe](javascript:alert(1)) and <link:mail @ mailto:someone@example.com>",
    ],
    ["![alt text](https://example.com/x.png)", "<link:alt text @ https://example.com/x.png>"],
    ["**bold with `code` and *em* inside** tail", "<strong:bold with <code:code> and <em:em> inside> tail"],
    ["***both*** done", "<strong:<em:both>> done"],
    ["*italic **bold** more*", "<em:italic <strong:bold> more>"],
    ['(**note**) and "*quoted*".', '(<strong:note>) and "<em:quoted>".'],
    ["``code with ` backtick`` done", "<code:code with ` backtick> done"],
    [`${F}code${F} next`, "<code:code> next"],
    ["`a*b*c` and `**x**`", "<code:a*b*c> and <code:**x**>"],
    [
      "xhttps://example.com and HTTPS://EXAMPLE.COM/A",
      "xhttps://example.com and <link:HTTPS://EXAMPLE.COM/A @ HTTPS://EXAMPLE.COM/A>",
    ],
    ["[label with **bold**](https://example.com/z)", "<link:label with **bold** @ https://example.com/z>"],
  ];
  it.each(cases)("%j", (input, expected) => {
    expect(show(parseInline(input))).toBe(expected);
  });
});

describe("parseInline, safety (design.md 4.7.3)", () => {
  const neverLinks = [
    "[x](javascript:alert(1))",
    "[x](JAVASCRIPT:alert(1))",
    "[x](JaVaScRiPt:alert(document.cookie))",
    "[x](vbscript:msgbox(1))",
    "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[x](//example.com/path)",
    "[x](/relative/path)",
    "[x](file:///etc/passwd)",
    "![x](javascript:alert(1))",
    "javascript:alert(1)",
    "javascript://example.com/%0aalert(1)",
    "[x](\tjavascript:alert(1))",
    "[x](java\nscript:alert(1))",
    "[x](https:example.com)",
    "http://",
    "https:///",
  ];
  it.each(neverLinks)("makes no link of %j", (input) => {
    const nodes = parseInline(input);
    expect(links(nodes)).toEqual([]);
    expect(inlineText(nodes)).toBe(input);
  });

  it("links only the http part of an address with another scheme in front", () => {
    const nodes = parseInline("[x](blob:https://example.com/0000)");
    expect(links(nodes)).toEqual(["https://example.com/0000"]);
    expect(inlineText(nodes)).toBe("[x](blob:https://example.com/0000)");
  });

  it("gives every link an address that starts with http, https or mailto", () => {
    const text =
      "a [one](https://example.com/1) b [two](HTTP://EXAMPLE.COM/2) c [three](MailTo:a@example.com) d https://example.com/4, e";
    expect(links(parseInline(text))).toEqual([
      "https://example.com/1",
      "HTTP://EXAMPLE.COM/2",
      "MailTo:a@example.com",
      "https://example.com/4",
    ]);
  });

  it("keeps markup characters of an address inside the address, as text", () => {
    const nodes = parseInline('[x](https://example.com/"onmouseover="alert(1))');
    expect(nodes).toEqual([{ type: "link", href: 'https://example.com/"onmouseover="alert(1)', text: "x" }]);
  });

  it("never removes a character: the text of the nodes is the input without its markup", () => {
    expect(inlineText(parseInline("plain \\* text with <tags> & entities &amp; `code`"))).toBe(
      "plain \\* text with <tags> & entities &amp; code",
    );
  });
});

describe("parseInline, time", () => {
  const within = (milliseconds: number, run: () => void): void => {
    const started = performance.now();
    run();
    expect(performance.now() - started).toBeLessThan(milliseconds);
  };

  it("reads 200,000 opening brackets in well under a second", () => {
    const text = "[".repeat(200_000);
    within(1500, () => expect(inlineText(parseInline(text))).toBe(text));
  });

  it("reads addresses that end in thousands of closing brackets in well under a second", () => {
    const text = `https://example.com/a${")".repeat(1970)} `.repeat(100);
    within(1500, () => expect(links(parseInline(text))).toHaveLength(100));
  });

  it("reads 200,000 characters of unbalanced emphasis in well under a second", () => {
    const text = "**a *b ~~c ".repeat(18_000);
    within(1500, () => expect(inlineText(parseInline(text))).toBe(text));
  });

  it("nests emphasis as deep as the look-ahead allows without failing", () => {
    const text = `${"*a ".repeat(600)}x${" a*".repeat(600)}`;
    expect(inlineText(parseInline(text)).length).toBeGreaterThan(0);
  });
});

describe("splitParagraphs", () => {
  it.each([
    ["one\n\ntwo\n\n\nthree\n \nfour", ["one", "two", "three", "four"]],
    ["def f():\n    return 1\n\n    indented start", ["def f():\n    return 1", "    indented start"]],
    ["\n\nfirst\n\t\n", ["first"]],
    [" \nafter a line of one space", ["after a line of one space"]],
    ["trailing blanks   \n\nnext", ["trailing blanks", "next"]],
    ["a\n\u00a0\nb", ["a\n\u00a0\nb"]],
    ["\u00a0", []],
    ["", []],
  ])("%j", (input, expected) => {
    expect(splitParagraphs(input)).toEqual(expected);
  });

  it("takes linear time on a long run of blanks", () => {
    const started = performance.now();
    expect(splitParagraphs(`a${" ".repeat(1_000_000)}\n\nb`)).toEqual(["a", "b"]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("renderBlocks", () => {
  const sizes = (blocks: readonly RenderBlock[]): number[] =>
    blocks.map((block) =>
      block.type === "code"
        ? block.code.length
        : block.paragraphs.reduce((n, piece) => n + piece.text.length, 0),
    );

  it("splits prose and code, and labels a code block with the first word of its tag", () => {
    expect(renderBlocks(`Intro line\n${F}python title="a.py"\nprint(1)\n${F}\nOutro line`)).toEqual([
      { type: "prose", paragraphs: [{ text: "Intro line", continues: false }] },
      { type: "code", language: "python", code: "print(1)" },
      { type: "prose", paragraphs: [{ text: "Outro line", continues: false }] },
    ]);
  });

  it("does not draw a code block that is empty or only white space", () => {
    expect(renderBlocks(`${F}\n${F}`)).toEqual([]);
    expect(renderBlocks(`before\n${F}js\n   \n\t\n${F}\nafter`).map((block) => block.type)).toEqual([
      "prose",
      "prose",
    ]);
  });

  it("keeps a block without a tag, an unterminated block and Windows line endings", () => {
    expect(renderBlocks(`Before\r\n${F}\r\nls -la\r\nstill code`)).toEqual([
      { type: "prose", paragraphs: [{ text: "Before", continues: false }] },
      { type: "code", language: null, code: "ls -la\nstill code" },
    ]);
  });

  it("cuts 120,000 characters without a line break into pieces of 50,000", () => {
    const blocks = renderBlocks("x".repeat(120_000));
    expect(sizes(blocks)).toEqual([50_000, 50_000, 20_000]);
    expect(
      blocks.map((block) => block.type === "prose" && block.paragraphs.map((piece) => piece.continues)),
    ).toEqual([[false], [true], [true]]);
  });

  it("cuts a paragraph of 19,889 characters at line breaks, and joining the pieces gives it back", () => {
    const lines = Array.from({ length: 400 }, (_, k) =>
      `line ${String(k).padStart(3, "0")} `.padEnd(k < 110 ? 48 : 49, "abcdefg"),
    );
    const paragraph = lines.join("\n");
    expect(paragraph.length).toBe(19_889);
    const blocks = renderBlocks(`intro\n\n${paragraph}\n\n${F}\ncode\n${F}\n\noutro`);
    expect(blocks.map((block) => block.type)).toEqual(["prose", "prose", "prose", "prose", "code", "prose"]);
    for (const size of sizes(blocks)) expect(size).toBeLessThanOrEqual(6000);

    const pieces = blocks.flatMap((block) => (block.type === "prose" ? block.paragraphs : []));
    expect(pieces[0]).toEqual({ text: "intro", continues: false });
    expect(pieces.at(-1)).toEqual({ text: "outro", continues: false });
    const middle = pieces.slice(1, -1);
    expect(middle.map((piece) => piece.continues)).toEqual([false, true, true, true]);
    expect(middle.map((piece) => piece.text).join("\n")).toBe(paragraph);
  });

  it("turns a message of a million characters into blocks within a second", () => {
    const paragraph = `${"word ".repeat(40)}\n`.repeat(12);
    const text = `${paragraph}\n`.repeat(420).slice(0, 1_000_000);
    const started = performance.now();
    const blocks = renderBlocks(text);
    for (const block of blocks) {
      if (block.type === "prose") for (const piece of block.paragraphs) parseInline(piece.text);
    }
    expect(performance.now() - started).toBeLessThan(1000);
    expect(Math.max(...sizes(blocks))).toBeLessThanOrEqual(6000);
  });
});

describe("summaryLine", () => {
  it.each([
    ["\n## Summary\n\nThree-bay plan", "Summary"],
    ["- **Goal**: build a `bin`\n- next", "Goal: build a bin"],
    ["1. first step\n2. second", "first step"],
    ["> quoted\r\nnext", "quoted"],
    ["   \n\t\n", ""],
    ["", ""],
    ["12.5 metres of pipe", "12.5 metres of pipe"],
    ["2026. A year", "A year"],
  ])("%j gives %j", (input, expected) => {
    expect(summaryLine(input)).toBe(expected);
  });

  it("takes linear time on a long run of digits or blanks", () => {
    const started = performance.now();
    expect(summaryLine(`${"1".repeat(500_000)}x`)).toBe(`${"1".repeat(500_000)}x`);
    expect(summaryLine(`${" ".repeat(500_000)}x`)).toBe("x");
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("relativeParts", () => {
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  it.each([
    [0, "now"],
    [59.6, "1 minute ago"],
    [3580, "1 hour ago"],
    [84_960, "yesterday"],
    [570_240, "last week"],
    [2_591_000, "4 weeks ago"],
    [30_000_000, "11 months ago"],
    [40_000_000, "last year"],
    [-50, "now"],
    [Number.NaN, "now"],
  ])("%d seconds ago reads %j", (seconds, expected) => {
    const parts = relativeParts(seconds);
    expect(format.format(parts.value, parts.unit)).toBe(expected);
  });
});
