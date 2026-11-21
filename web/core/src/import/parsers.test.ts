// The text parsers, rule by rule: what docs/import-rules.md states in 2.5 and in W5 to W8,
// W12 and W14 beyond what the golden fixtures already pin down. All content is invented.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseChatGPTExport } from "./chatgpt-export.ts";
import { cleanTranscriptLines } from "./cleaner.ts";
import { parseContextPack } from "./context-pack.ts";
import { parseGenericText } from "./generic-text.ts";
import { importCapture } from "./import-capture.ts";
import { parseText } from "./parse-text.ts";
import { parsePullerMarkdown } from "./puller-markdown.ts";
import { parseSharePageText } from "./share-page.ts";
import type { ParsedSession } from "./types.ts";

const chr = (...codes: number[]): string => String.fromCodePoint(...codes);
const VT = chr(0x0b);
const FF = chr(0x0c);
const NEL = chr(0x85);
const NBSP = chr(0xa0);
const ZWSP = chr(0x200b);
const LS = chr(0x2028);
const PS = chr(0x2029);

/**
 * corrections.md 3, point 8: the five characters the full trim removes and the inline trim keeps,
 * apart from LF and CR, which no line holds. A text of these alone is blank but not empty.
 */
const BLANK_NOT_EMPTY = [VT, FF, NEL, LS, PS, `${LS} ${NEL}${VT}`];

const lines = (text: string): string[] => text.split("\n");
const clean = (text: string): string => cleanTranscriptLines(lines(text)).join("\n");

function turns(session: ParsedSession | null | undefined): [role: string, text: string][] {
  if (session === null || session === undefined) throw new Error("no session");
  return session.messages.map((message) => [message.role, message.text]);
}

function only(sessions: readonly ParsedSession[]): ParsedSession {
  const [first, ...others] = sessions;
  if (first === undefined || others.length > 0)
    throw new Error(`expected one session, got ${sessions.length}`);
  return first;
}

describe("W7 furniture cleaner", () => {
  it("removes the five furniture words as whole lines, case-sensitively", () => {
    expect(clean("a\nReport\nCopy\nRetry\nShare\nClaude\nb")).toBe("a\nb");
    expect(clean("a\nreport\nCopy code\nClaude is here\nSHARE\nb")).toBe(
      "a\nreport\nCopy code\nClaude is here\nSHARE\nb",
    );
  });

  it("removes lines that start with a boilerplate phrase, case-sensitively", () => {
    const furniture = [
      "Shared by Example Person",
      "This is a copy of a chat between Claude and Example Person.",
      "Content may include unverified or unsafe content.",
      "Shared snapshot may contain attachments.",
      "Ask Claude your own question",
      "Claude can make mistakes. Please double-check responses.",
    ];
    expect(clean(["a", ...furniture, "b"].join("\n"))).toBe("a\nb");
    expect(clean("a\nshared by someone\nShared byExample\nb")).toBe(
      "a\nshared by someone\nShared byExample\nb",
    );
  });

  it.each(["10:42", "10:42 AM", "10:42AM", "9:05 PM", "24:99", "1:00PM", `10:42${NBSP}AM`])(
    "removes the bare time line %j",
    (line) => {
      expect(clean(`a\n${line}\nb`)).toBe("a\nb");
    },
  );

  it.each(["10:42 am", "10:42:15", "10:42  PM", "at 10:42", "123:45", "10:4", "10:42 AMx"])(
    "keeps %j, which is not a bare time",
    (line) => {
      expect(clean(`a\n${line}\nb`)).toBe(`a\n${line}\nb`);
    },
  );

  it("accepts ASCII digits only (D18): other numerals are not a time", () => {
    const arabicIndic = `${chr(0x661, 0x660)}:${chr(0x664, 0x662)}`; // the digits 1 0 : 4 2
    const fullWidth = `${chr(0xff11, 0xff10)}:${chr(0xff14, 0xff12)}`;
    expect(clean(`a\n${arabicIndic}\n${fullWidth}\nb`)).toBe(`a\n${arabicIndic}\n${fullWidth}\nb`);
  });

  it("removes a line equal to the kept line before it; blank lines in between do not matter", () => {
    expect(clean("Searched the web\nSearched the web\nnext")).toBe("Searched the web\nnext");
    expect(clean("A\n\nA\n\nA")).toBe("A");
    expect(clean("A\nB\nA")).toBe("A\nB\nA");
  });

  it("a furniture line between two equal lines does not reset the comparison", () => {
    expect(clean("A\nCopy\nA")).toBe("A");
    expect(clean("A\n10:42 AM\nA")).toBe("A");
  });

  it("collapses a run of blank lines to one and drops them at both ends", () => {
    expect(clean("\n\n  \na\n\n\n \t \nb\n\n")).toBe("a\n\nb");
    expect(clean(`\n${ZWSP}\n`)).toBe("");
    expect(clean("")).toBe("");
  });

  it("keeps indentation and removes trailing blanks (D5: the Apple app stores the trimmed line)", () => {
    expect(clean("def f():\n    return 1  \t\n\tx = 2 ")).toBe("def f():\n    return 1\n\tx = 2");
  });

  it("never removes an indented line: no furniture, time or duplicate rule applies to it", () => {
    expect(clean("x\n  Copy\n  10:42\n  y\n  y\n  y")).toBe("x\n  Copy\n  10:42\n  y\n  y\n  y");
    // An indented line still becomes the line that later ones are compared with.
    expect(clean("  y\ny")).toBe("  y\ny");
    expect(clean("y\n  y\ny")).toBe("y\n  y\ny");
  });

  it("copies a closed fenced block untouched, blank lines and trailing blanks too (fixture 54)", () => {
    const block = "```sh\nCopy\nmake build  \nmake build  \n10:30\n\n\nShare\n```";
    expect(clean(`Run these:\n${block}\nCopy\nThat is all.`)).toBe(`Run these:\n${block}\nThat is all.`);
  });

  it("the last copied line of a fenced block becomes the line to compare with", () => {
    expect(clean("make\n```\nmake\n```\nmake")).toBe("make\n```\nmake\n```\nmake");
    expect(clean("make\nmake\n```\nx\n```")).toBe("make\n```\nx\n```");
  });

  it("an unterminated fence protects nothing", () => {
    expect(clean("a\n```sh\nCopy\nmake\nmake\n10:30")).toBe("a\n```sh\nmake");
  });
});

describe("W6 share-page text", () => {
  const share = (text: string, title = "Pasted session") => parseSharePageText(lines(text), title);

  it("cuts at 'You said:' and 'Claude responded:' and drops the top of the page before the first header", () => {
    const session = share(
      "Page title\nShared by Example Person\nYou said: Hi\nHi there\nClaude responded: Hel...\nHello.\n",
    );
    expect(turns(session)).toEqual([
      ["user", "Hi there"],
      ["assistant", "Hello."],
    ]);
    expect(session?.provider).toBe("claude");
  });

  it("applies when a line starts with a header of the user and one with a header of an assistant", () => {
    // After an inline trim, in either order, with any of the assistant headers.
    expect(share(`  \t${NBSP}You said: a\nb\n${NBSP} Claude responded: c`)).not.toBeNull();
    expect(share("Claude responded: a\nb\nYou said: c")).not.toBeNull();
    expect(share("You said: a\nb\nChatGPT said: c")).not.toBeNull();
    // A header counts also when its turn gives no message.
    expect(turns(share("You said:\nClaude responded: x\ny"))).toEqual([["assistant", "x\ny"]]);
    // One speaker alone is no share page, however often it speaks.
    expect(share("You said: a\nb")).toBeNull();
    expect(share("Claude responded: a\nb")).toBeNull();
    expect(share("You said: a\nYou said: b")).toBeNull();
    expect(share("ChatGPT said: a\nGemini said: b")).toBeNull();
    // A header is the start of a line, in this spelling.
    expect(share("Intro. You said: a\nClaude responded: b")).toBeNull();
    expect(share("you said: a\nClaude responded: b")).toBeNull();
    expect(share("plain text")).toBeNull();
  });

  it("a text with one speaker goes on to the generic parser, which keeps what stands above", () => {
    // Read as a share page, such a text lost its first line.
    expect(
      turns(only(parseText("Notes about the tool.\nClaude responded: sample\nMore notes.", "x"))),
    ).toEqual([
      ["unknown", "Notes about the tool."],
      ["assistant", "sample\nMore notes."],
    ]);
    expect(turns(only(parseText("Draft\n\nYou said: a\nb", "x")))).toEqual([
      ["unknown", "Draft"],
      ["user", "a\nb"],
    ]);
  });

  it("also takes 'Claude said:', 'ChatGPT said:' and 'Gemini said:' as assistant headers (D6, fixture 29)", () => {
    const session = share(
      "You said:\nq1\nChatGPT said:\na1\nYou said:\nq2\nGemini said:\na2\nClaude said:\na3",
    );
    expect(turns(session)).toEqual([
      ["user", "q1"],
      ["assistant", "a1"],
      ["user", "q2"],
      ["assistant", "a2"],
      ["assistant", "a3"],
    ]);
  });

  it("takes the provider named by most assistant headers; the first seen wins a tie", () => {
    expect(share("You said:\nq\nChatGPT said:\na\nGemini said:\nb\nGemini said:\nc")?.provider).toBe(
      "gemini",
    );
    expect(share("You said:\nq\nGemini said:\na\nChatGPT said:\nb")?.provider).toBe("gemini");
    expect(share("You said:\nq\nChatGPT said:\na\nGemini said:\nb")?.provider).toBe("chatgpt");
    expect(share("You said:\nq\nClaude responded:\na\nClaude said:\nb\nGemini said:\nc")?.provider).toBe(
      "claude",
    );
    // Every assistant header names a provider and the parser asks for one, so none is "other" here.
  });

  it("uses the text on the header line when a turn has no other text (D6, fixture 30)", () => {
    const session = share(
      "You said:   Is 1:2:3 fine?  \nClaude responded: Yes\nYes, it is.\nYou said: Thanks.",
    );
    expect(turns(session)).toEqual([
      ["user", "Is 1:2:3 fine?"],
      ["assistant", "Yes, it is."],
      ["user", "Thanks."],
    ]);
  });

  it("uses the header-line text also when the body is nothing but furniture", () => {
    expect(turns(share("You said: Hi\nCopy\n10:42 AM\nClaude responded: Hello\n\n"))).toEqual([
      ["user", "Hi"],
      ["assistant", "Hello"],
    ]);
  });

  it("drops a turn that has no text at all, and does not apply when no turn is left", () => {
    expect(turns(share("You said:\nClaude responded: x\ny"))).toEqual([["assistant", "x\ny"]]);
    expect(share("You said:\n\nClaude responded:\nCopy")).toBeNull();
  });

  it("honours the whole-line labels 'You said' and 'Gemini said' only if BOTH occur (fixture 49)", () => {
    const both = share("Conversation with Gemini\nYou said\nq1\nGemini said\na1\n  You said  \nq2");
    expect(turns(both)).toEqual([
      ["user", "q1"],
      ["assistant", "a1"],
      ["user", "q2"],
    ]);
    expect(both?.provider).toBe("gemini");
    expect(share("You said\nq1\nSomething else\na1")).toBeNull();
    expect(share("Gemini said\na1")).toBeNull();
    // With colon headers present but only one whole-line label, that label is ordinary text.
    expect(turns(share("You said: q\nq\nGemini said\nstill the question\nClaude responded: a"))).toEqual([
      ["user", "q\nGemini said\nstill the question"],
      ["assistant", "a"],
    ]);
    // A whole-line label and a colon header are a pair of speakers too: a header of either kind counts.
    expect(turns(share("You said\nq\nGemini said\na\nYou said: again"))).toEqual([
      ["user", "q"],
      ["assistant", "a"],
      ["user", "again"],
    ]);
  });

  it("cleans every turn with the furniture cleaner and keeps code indentation (D5, fixture 28)", () => {
    const session = share(
      "You said: q\nq\nClaude responded: a\ndef f():\n    return 1\n    return 1\nShare\n10:30\nend",
    );
    expect(turns(session)).toEqual([
      ["user", "q"],
      ["assistant", "a\ndef f():\n    return 1\n    return 1\nend"],
    ]);
  });

  describe("the text on a speaker line (D19): the first line of the turn unless it is a preview", () => {
    const E = String.fromCodePoint(0x2026);

    it("is dropped when the first non-blank line after it begins with it (a share page's preview)", () => {
      expect(
        turns(
          share(
            `You said: How long${E}\nHow long should it prove?\nClaude responded: About four hours.\n\nAbout four hours.`,
          ),
        ),
      ).toEqual([
        ["user", "How long should it prove?"],
        ["assistant", "About four hours."],
      ]);
      // Three full stops count as the ellipsis; the white space before either is cut.
      expect(turns(share("You said: How long ...\nHow long should it prove?\nClaude responded: a"))).toEqual([
        ["user", "How long should it prove?"],
        ["assistant", "a"],
      ]);
      // The prefix test applies without an ellipsis too: what is dropped stands at the start of the next line.
      expect(
        turns(share("You said: Is it dead?\nIs it dead? It has been cold.\nClaude responded: a")),
      ).toEqual([
        ["user", "Is it dead? It has been cold."],
        ["assistant", "a"],
      ]);
    });

    it("is kept as the first line when the text after it does not begin with it (a person's own text)", () => {
      expect(
        turns(
          share(
            "You said: My starter smells odd.\n\nIt has been in the fridge.\nClaude responded: No.\nFeed it.",
          ),
        ),
      ).toEqual([
        ["user", "My starter smells odd.\n\nIt has been in the fridge."],
        ["assistant", "No.\nFeed it."],
      ]);
    });

    it("is kept, ellipsis included, when a preview is not repeated below", () => {
      expect(
        turns(share(`You said: My starter smells${E}\nIt has been in the fridge.\nClaude responded: a`)),
      ).toEqual([
        ["user", `My starter smells${E}\nIt has been in the fridge.`],
        ["assistant", "a"],
      ]);
    });

    it("is compared after the cleaner has run: furniture between the label and the repeated line does not hide a preview", () => {
      expect(turns(share("You said: q\nCopy\n10:30\nq and more\nClaude responded: a"))).toEqual([
        ["user", "q and more"],
        ["assistant", "a"],
      ]);
    });

    it("no typographic quotes are replaced for the comparison", () => {
      const curly = String.fromCodePoint(0x2019);
      expect(turns(share(`You said: it's\nit${curly}s here\nClaude responded: a`))).toEqual([
        ["user", `it's\nit${curly}s here`],
        ["assistant", "a"],
      ]);
    });

    it("cuts the white space before the ellipsis, and compares with the inline-trimmed line", () => {
      expect(turns(share(`You said: abc ${E}\nabcdef\nClaude responded: a`))).toEqual([
        ["user", "abcdef"],
        ["assistant", "a"],
      ]);
      expect(turns(share("You said: code\n    code here\nClaude responded: a"))).toEqual([
        ["user", "code here"],
        ["assistant", "a"],
      ]);
    });

    it("cuts one ellipsis only, and one form of it only", () => {
      expect(turns(share(`You said: a${E}${E}\nab\nClaude responded: a`))).toEqual([
        ["user", `a${E}${E}\nab`],
        ["assistant", "a"],
      ]);
      expect(turns(share(`You said: a...${E}\na more\nClaude responded: a`))).toEqual([
        ["user", `a...${E}\na more`],
        ["assistant", "a"],
      ]);
    });

    it("without an ellipsis, is a preview only if it ends where a word ends in the next line", () => {
      // A letter follows: "No" is no preview of "Nothing".
      expect(
        turns(
          share(
            "You said: No\nNothing works after the update.\nClaude responded: Yes\nYesterday's build is good.",
          ),
        ),
      ).toEqual([
        ["user", "No\nNothing works after the update."],
        ["assistant", "Yes\nYesterday's build is good."],
      ]);
      // A digit follows, and a combining mark follows.
      const acute = String.fromCodePoint(0x301);
      expect(
        turns(
          share(
            `You said: Version 1\nVersion 10 is out.\nClaude responded: Cafe\nCafe${acute} Central opens.`,
          ),
        ),
      ).toEqual([
        ["user", "Version 1\nVersion 10 is out."],
        ["assistant", `Cafe\nCafe${acute} Central opens.`],
      ]);
      // Punctuation follows, or the line ends there: a preview.
      expect(
        turns(share("You said: Yes\nYes, it is done.\nClaude responded: Good\nGood. Then ship it.")),
      ).toEqual([
        ["user", "Yes, it is done."],
        ["assistant", "Good. Then ship it."],
      ]);
      expect(
        turns(share("You said: Done\nDone\nClaude responded: Noted\nNoted\nThanks for telling me.")),
      ).toEqual([
        ["user", "Done"],
        ["assistant", "Noted\nThanks for telling me."],
      ]);
    });

    it("with an ellipsis, any beginning counts: a preview can be cut inside a word", () => {
      expect(
        turns(
          share(
            `You said: Nothing wor${E}\nNothing works after the update.\nClaude responded: Yesterd...\nYesterday's build is good.`,
          ),
        ),
      ).toEqual([
        ["user", "Nothing works after the update."],
        ["assistant", "Yesterday's build is good."],
      ]);
    });

    it("is the message as written when the cleaner leaves nothing of the turn", () => {
      expect(turns(share("You said: Copy\nClaude responded: 10:42"))).toEqual([
        ["user", "Copy"],
        ["assistant", "10:42"],
      ]);
    });
  });

  it("cleans the title as W8 does (D13: no empty or all-space titles)", () => {
    expect(share("You said:\nq\nClaude responded:\na", "  My title \n")?.title).toBe("My title");
    expect(share("You said:\nq\nClaude responded:\na", " \t ")?.title).toBe("Imported session");
  });
});

describe("W5 puller Markdown", () => {
  const pull = (text: string, title = "file-stem") => parsePullerMarkdown(lines(text), title);
  const header = "# session_EXAMPLE\nSource: https://claude.ai/code/session_EXAMPLE\n";

  it("requires the header pair exactly, case-sensitively", () => {
    expect(pull(`${header}\nUser: q\n\n---\n`)).not.toBeNull();
    expect(pull("#title\nSource: x\n\nq")).toBeNull();
    expect(pull("# title\nsource: x\n\nq")).toBeNull();
    expect(pull("# title\nSource:x\n\nq")).toBeNull();
    expect(pull(" # title\nSource: x\n\nq")).toBeNull();
    expect(pull("# title\n\nSource: x\n\nq")).toBeNull();
    expect(pull("# title")).toBeNull();
    expect(pull("")).toBeNull();
  });

  it("skips leading blank lines before the header (D11, fixture 35)", () => {
    expect(turns(only(pull(`\n \t\n${ZWSP}\n${header}\nUser: q\n\n---\n`) ?? []))).toEqual([["user", "q"]]);
    expect(pull(`Intro\n${header}\nUser: q\n`)).toBeNull();
  });

  it("takes title and source from the header, inline-trimmed", () => {
    const session = only(pull("#   My title  \nSource:   https://claude.ai/x  \n\nturn") ?? []);
    expect(session.title).toBe("My title");
    expect(session.sourceUrl).toBe("https://claude.ai/x");
  });

  it("cuts at lines that are exactly '---' after an inline trim, and at no other rule", () => {
    const session = only(pull(`${header}\none\n  ---\t\ntwo\n----\n- - -\n***\nstill two\n---\nthree`) ?? []);
    expect(turns(session)).toEqual([
      ["unknown", "one"],
      ["unknown", "two\n----\n- - -\n***\nstill two"],
      ["unknown", "three"],
    ]);
  });

  it("finds a role only on the first line of a block; an unlabelled block is role unknown", () => {
    const session = only(
      pull(`${header}\nUser: q\nAssistant: not a new turn\n\n---\n\nnote\n\n---\n\n## Claude\na`) ?? [],
    );
    expect(turns(session)).toEqual([
      ["user", "q\nAssistant: not a new turn"],
      ["unknown", "note"],
      ["assistant", "a"],
    ]);
  });

  it("a block that is only a label gives no message (W12)", () => {
    const session = only(
      pull(`${header}\nUser: q\n\n---\n\nAssistant\n\n---\n\nUser:\n\n---\n\nAssistant: a`) ?? [],
    );
    expect(turns(session)).toEqual([
      ["user", "q"],
      ["assistant", "a"],
    ]);
  });

  it("a header without any message gives no session, but is still puller Markdown (D8, fixture 04)", () => {
    expect(pull(header)).toEqual([]);
    expect(pull(`${header}\n---\n\n---\n`)).toEqual([]);
    expect(pull(`${header}\nAssistant\n`)).toEqual([]);
  });

  it("starts a new session at every header pair that begins a block (D11, fixture 05)", () => {
    const second = "# session_TWO\nSource: https://gemini.google.com/share/EXAMPLETWO\n";
    const sessions = pull(`${header}\nUser: q1\n\n---\n\n\n${second}\nUser: q2\n\n---\n`) ?? [];
    expect(sessions.map((session) => [session.title, session.provider, session.sourceUrl])).toEqual([
      ["session_EXAMPLE", "claude", "https://claude.ai/code/session_EXAMPLE"],
      ["session_TWO", "gemini", "https://gemini.google.com/share/EXAMPLETWO"],
    ]);
    expect(sessions.map(turns)).toEqual([[["user", "q1"]], [["user", "q2"]]]);
  });

  it("a header pair right after the previous one starts a new session; the empty one is not returned", () => {
    const sessions =
      pull(`${header}# session_TWO\nSource: https://chatgpt.com/share/EXAMPLETWO\n\nUser: q2`) ?? [];
    expect(sessions.map((session) => session.title)).toEqual(["session_TWO"]);
  });

  it("a header pair inside a block, after text, is part of that turn", () => {
    const session = only(pull(`${header}\nUser: see this\n# Heading\nSource: a book\n\n---\n`) ?? []);
    expect(turns(session)).toEqual([["user", "see this\n# Heading\nSource: a book"]]);
  });

  it("uses the caller's title, cleaned, when the '# ' line holds none", () => {
    expect(only(pull("# \nSource: x\n\nq", "  from the file  ") ?? []).title).toBe("from the file");
    expect(only(pull("#    \nSource: x\n\nq", "") ?? []).title).toBe("Imported session");
  });

  it("takes the provider from the host of the Source line, then from the labels, else other (W9)", () => {
    const provider = (source: string, body: string): string =>
      only(pull(`# t\nSource: ${source}\n\n${body}`) ?? []).provider;
    expect(provider("https://claude.ai/code/x", "Gemini: a")).toBe("claude");
    expect(provider("https://chatgpt.com/share/x", "note")).toBe("chatgpt");
    expect(provider("https://example.invalid/x", "User: q\n\n---\n\nGemini: a")).toBe("gemini");
    expect(provider("https://example.invalid/x", "User: q\n\n---\n\nAssistant: a")).toBe("other");
    // Not a URL: the Apple substring test is gone, the labels decide.
    expect(provider("claude.ai/code/x", "note")).toBe("other");
    expect(provider("a page that mentions claude.ai", "ChatGPT: a")).toBe("chatgpt");
  });
});

describe("W6: fenced blocks and speaker lines", () => {
  const share = (text: string, title = "Pasted session") => parseSharePageText(lines(text), title);
  const F = "```";
  const BICYCLE = chr(0x1f6b2);

  describe("a block that opens on a speaker line: the turn is read twice for its fences", () => {
    it("keeps the lines of the block, whatever they say", () => {
      // Read without the text of the speaker line the turn has no closed block: the line inside
      // went as page furniture, and the closing fence passed for the text that the speaker line
      // previews, so the opening fence went too.
      const inside = ["Report", "Copy", "10:42", "Claude can make mistakes. Please double-check responses."];
      for (const line of inside) {
        expect(turns(share(`You said: ${F}\n${line}\n${F}\nClaude responded: Done.`))).toEqual([
          ["user", `${F}\n${line}\n${F}`],
          ["assistant", "Done."],
        ]);
        expect(turns(share(`You said: q\nClaude responded: ${F}\n${line}\n${F}\n`))).toEqual([
          ["user", "q"],
          ["assistant", `${F}\n${line}\n${F}`],
        ]);
      }
    });

    it("keeps the lines that either reading puts inside a closed block (fixture 63)", () => {
      const text = `You said: ${F}\n${F}\nReport\n${F}\nClaude responded: ${F}\n10:42\n${F}\nRetry\n${F}\n`;
      expect(turns(share(text))).toEqual([
        // The fence of the speaker line is a real preview of the next line here: dropped once.
        ["user", `${F}\nReport\n${F}`],
        // Each reading closes another block; the lines of both are kept, the label first.
        ["assistant", `${F}\n10:42\n${F}\nRetry\n${F}`],
      ]);
    });

    it("changes nothing for a turn whose speaker line opens no block", () => {
      // Without text on the speaker line the turn is read once.
      expect(turns(share(`You said:\n${F}\nCopy\n${F}\nCopy\nClaude responded:\na`))).toEqual([
        ["user", `${F}\nCopy\n${F}`],
        ["assistant", "a"],
      ]);
      // With text there, both readings mark the same lines.
      expect(turns(share(`You said: q\nq\nReport\n${F}\nReport\n${F}\nClaude responded: a`))).toEqual([
        ["user", `q\n${F}\nReport\n${F}`],
        ["assistant", "a"],
      ]);
    });
  });

  describe("a speaker line inside a closed fenced block is text", () => {
    it("keeps quoted speaker lines of both kinds in the turn that quotes them (fixture 64)", () => {
      const text = `You said: look\n${F}\nClaude responded: old\nYou said\nGemini said\n${F}\nClaude responded: I see`;
      expect(turns(share(text))).toEqual([
        ["user", `look\n${F}\nClaude responded: old\nYou said\nGemini said\n${F}`],
        ["assistant", "I see"],
      ]);
    });

    it("switches the whole-line labels on by all lines of the text, also by lines inside a block", () => {
      const session = share(`You said: q\n${F}\nYou said\nGemini said\n${F}\nGemini said\nanswer`);
      expect(turns(session)).toEqual([
        ["user", `q\n${F}\nYou said\nGemini said\n${F}`],
        ["assistant", "answer"],
      ]);
      expect(session?.provider).toBe("gemini");
    });

    it("leaves a text whose speaker lines are all quoted to the generic parser (fixture 65)", () => {
      const text = `**Human:** Look:\n${F}\nYou said: hi\nClaude responded: hello\n${F}\n**Assistant:** I see.`;
      expect(share(text)).toBeNull();
      expect(turns(only(parseText(text, "x")))).toEqual([
        ["user", `Look:\n${F}\nYou said: hi\nClaude responded: hello\n${F}`],
        ["assistant", "I see."],
      ]);
    });

    it("a speaker line whose text opens a block stays a header (fixture 62)", () => {
      // As written, the closing fence of the first block pairs with the next fence line, and
      // "Claude responded:" stands between the two. The second reading opens the block on the
      // speaker line, so that line is outside every block of it.
      expect(turns(share(`You said: ${F}\nReport\n${F}\nClaude responded: ${F}\nRetry\n${F}\n`))).toEqual([
        ["user", `${F}\nReport\n${F}`],
        ["assistant", `${F}\nRetry\n${F}`],
      ]);
    });

    it("with a fence that never closes, every speaker line is a header (fixture 67)", () => {
      // Without this guard the lone fence pairs with the opening fence of the later block and
      // hides the two turns between them.
      const text = `You said: Never closed.\n${F}\nlog\nClaude responded: I see.\nYou said: Second.\n${F}\ncode\n${F}\nClaude responded: Thanks.`;
      expect(turns(share(text))).toEqual([
        ["user", `Never closed.\n${F}\nlog`],
        ["assistant", "I see."],
        ["user", `Second.\n${F}\ncode\n${F}`],
        ["assistant", "Thanks."],
      ]);
    });

    it("the same when only the reading with the speaker lines' text ends inside a block", () => {
      // As written, every block closes and "You said: quoted" stands inside one. Read with the
      // text of the speaker lines, the block that opens on the second "You said:" never closes.
      const text = `${F}\nYou said: quoted\n${F}\nYou said: ${F}\nreal\nClaude responded: a`;
      expect(turns(share(text))).toEqual([
        ["unknown", F],
        ["user", `quoted\n${F}`],
        ["user", `${F}\nreal`],
        ["assistant", "a"],
      ]);
    });
  });

  describe("what stands above the first header", () => {
    const rest = "You said: q\nClaude responded: a";
    const body: [string, string][] = [
      ["user", "q"],
      ["assistant", "a"],
    ];

    it("is dropped when it is the top of a share page: few short lines, one of them a sign of a page", () => {
      const signs = [
        // Lines the cleaner of W7 removes: boilerplate and a bare time.
        "Shared by Example Person",
        "Report",
        "10:42 AM",
        // The phrases, anywhere in a line, whatever the case.
        "Please sign in",
        "LOG IN to continue",
        "Created with Example",
        "Conversation transcript",
        "A shared conversation",
        "AI Overview",
        "Skip to content",
        "Conversation with Gemini",
        // Blanks after a sign: the cleaner removes such a line too, since it tests the inline trim.
        "Report ",
        "10:42 AM\t",
      ];
      for (const sign of signs) {
        expect(turns(share(`Page title\n${sign}\n\n${rest}`)), sign).toEqual(body);
      }
    });

    it("is the first message, with role unknown, when nothing in it is a sign of a page (fixture 68)", () => {
      expect(turns(share(`Here is what happened yesterday.\n${rest}`))).toEqual([
        ["unknown", "Here is what happened yesterday."],
        ...body,
      ]);
      // It goes through the cleaner of W7 and the full trim, like a turn.
      expect(turns(share(`\n\nA note.\nA note.\n\n\nMore.  \n\n${rest}`))).toEqual([
        ["unknown", "A note.\n\nMore."],
        ...body,
      ]);
      // Nothing is added when the lines hold no text.
      expect(turns(share(`\n \t\n${rest}`))).toEqual(body);
    });

    it("is cleaned and fully trimmed like a turn when it is kept", () => {
      // U+2028 at its start and U+0085 at its end are removed by the full trim only.
      expect(turns(share(`${LS} Note\n${rest}`))).toEqual([["unknown", "Note"], ...body]);
      expect(turns(share(`Note${NEL}\n${rest}`))).toEqual([["unknown", "Note"], ...body]);
    });

    it("finds a sign outside a closed block of the lead, whatever the block holds", () => {
      expect(turns(share(`Report\n${F}\ncode\n${F}\n${rest}`))).toEqual(body);
    });

    it("a top has at most 12 lines that are not blank", () => {
      const twelve = ["Report", ...Array.from({ length: 11 }, (_, index) => `line ${index + 1}`)];
      expect(turns(share(`${twelve.join("\n\n")}\n${rest}`))).toEqual(body);
      // With a 13th line it is text: kept, without the line that the cleaner removes.
      expect(turns(share(`${twelve.join("\n")}\nline 12\n${rest}`))).toEqual([
        ["unknown", [...twelve.slice(1), "line 12"].join("\n")],
        ...body,
      ]);
    });

    it("a top has fewer than 700 user-perceived characters", () => {
      // "Report", a line feed and 692 letters are 699.
      expect(turns(share(`Report\n${"x".repeat(692)}\n${rest}`))).toEqual(body);
      expect(turns(share(`Report\n${"x".repeat(693)}\n${rest}`))).toEqual([
        ["unknown", "x".repeat(693)],
        ...body,
      ]);
      // Blank lines and the blanks around a line do not count.
      expect(turns(share(`Report\n\n\n${"x".repeat(692)}   \n${rest}`))).toEqual(body);
      // 400 bicycles are 800 UTF-16 units and 400 characters (W15).
      expect(turns(share(`Report\n${BICYCLE.repeat(400)}\n${rest}`))).toEqual(body);
      expect(turns(share(`Report\n${BICYCLE.repeat(693)}\n${rest}`))).toEqual([
        ["unknown", BICYCLE.repeat(693)],
        ...body,
      ]);
    });

    it("only a line that the cleaner could remove is a sign of a page", () => {
      // An indented line is never removed, so it is no sign, whatever it says.
      expect(turns(share(`    Report\n${rest}`))).toEqual([["unknown", "Report"], ...body]);
      expect(turns(share(`Notes\n\tPlease sign in\n${rest}`))).toEqual([
        ["unknown", "Notes\n\tPlease sign in"],
        ...body,
      ]);
      // Neither is a line inside a closed fenced block.
      expect(turns(share(`Notes\n${F}\nlog in\nCopy\n${F}\n${rest}`))).toEqual([
        ["unknown", `Notes\n${F}\nlog in\nCopy\n${F}`],
        ...body,
      ]);
      // A fence that never closes protects nothing (W7).
      expect(turns(share(`Notes\n${F}\nlog in\n${rest}`))).toEqual(body);
    });

    it("holds a quoted speaker line that stands above the first header", () => {
      expect(turns(share(`${F}\nYou said: quoted\n${F}\n${rest}`))).toEqual([
        ["unknown", `${F}\nYou said: quoted\n${F}`],
        ...body,
      ]);
    });

    it("is not looked at when no turn has text: the text is not for this parser", () => {
      expect(share("A note above.\nYou said:\nClaude responded:\nCopy")).toBeNull();
    });
  });
});

describe("W6 and W8 together: no line of a pasted text is stored nowhere", () => {
  // The Apple parser takes every text with a speaker line for a share page and drops what
  // stands above the first one (D6); a block that opened on a speaker line lost its lines. Here
  // every line of the text carries a word of its own, and every such word must be in a message,
  // whatever speaker lines, labels and fences stand around it. No line is page furniture, so
  // nothing above the first speaker line is the top of a page (W6).
  const F = "```";
  const kinds = fc.oneof(
    { weight: 6, arbitrary: fc.constant("text") },
    { weight: 1, arbitrary: fc.constant("indented") },
    { weight: 3, arbitrary: fc.constant("speaker with text") },
    { weight: 2, arbitrary: fc.constant("speaker with a fence") },
    { weight: 1, arbitrary: fc.constant("speaker alone") },
    { weight: 1, arbitrary: fc.constant("whole-line label") },
    { weight: 3, arbitrary: fc.constant("fence") },
    { weight: 1, arbitrary: fc.constant("longer fence") },
    { weight: 1, arbitrary: fc.constant("blank") },
  );
  const headers = fc.constantFrom(
    "You said:",
    "Claude responded:",
    "Claude said:",
    "ChatGPT said:",
    "Gemini said:",
  );

  it("for any mixture of text, speaker lines, labels and fence lines", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(kinds, headers, fc.boolean()), { maxLength: 30 }), (spec) => {
        const words: string[] = [];
        const written = spec.map(([kind, header, flag], index) => {
          const word = `w${String(index).padStart(3, "0")}x`;
          switch (kind) {
            case "text":
              words.push(word);
              return `${word} and more`;
            case "indented":
              words.push(word);
              return `    ${word}`;
            case "speaker with text":
              words.push(word);
              return `${header} ${word}`;
            case "speaker with a fence":
              return `${header} ${F}${flag ? "js" : ""}`;
            case "speaker alone":
              return header;
            case "whole-line label":
              return flag ? "You said" : "Gemini said";
            case "fence":
              return F;
            case "longer fence":
              return "````";
            default:
              return "";
          }
        });
        const stored = parseText(written.join("\n"), "t")
          .flatMap((session) => session.messages.map((message) => message.text))
          .join("\n");
        for (const word of words) {
          if (!stored.includes(word)) throw new Error(`${word} is lost from ${JSON.stringify(written)}`);
        }
      }),
      { numRuns: 4000, seed: 20261120 },
    );
  });
});

describe("W8 generic text", () => {
  const generic = (text: string, title = "notes") => parseGenericText(text, lines(text), title);

  it("gives no session for text that is only white space (D8, W12)", () => {
    expect(generic("")).toBeNull();
    expect(generic(` \n\t\n${ZWSP}${LS}\n`)).toBeNull();
  });

  it("text without any marker is one message of role unknown, full-trimmed", () => {
    const session = generic("\n  Plain notes.\nSecond line.  \n\n");
    expect(turns(session)).toEqual([["unknown", "Plain notes.\nSecond line."]]);
    expect(session?.provider).toBe("other");
    expect(session?.title).toBe("notes");
  });

  it("text before the first marker is a message of role unknown; the system role is kept", () => {
    expect(turns(generic("Intro.\nUser: q\nSystem: s\nAssistant: a"))).toEqual([
      ["unknown", "Intro."],
      ["user", "q"],
      ["system", "s"],
      ["assistant", "a"],
    ]);
  });

  it("a marker with no text before the next marker produces nothing", () => {
    expect(turns(generic("User:\nAssistant: a\nUser:\n\n"))).toEqual([["assistant", "a"]]);
  });

  it("markers and nothing else: the whole text becomes one note, never an empty message (W12)", () => {
    expect(turns(generic("User:\nAssistant:\n"))).toEqual([["unknown", "User:\nAssistant:"]]);
  });

  it("keeps the raw lines of a message and trims only its ends (fixture 34)", () => {
    expect(turns(generic("User:   q   \n   indented\n\nAssistant:\ta  \n"))).toEqual([
      ["user", "q\n   indented"],
      ["assistant", "a"],
    ]);
  });

  it("never takes a line inside a closed fenced block for a marker (D7, fixture 20)", () => {
    const text = "User: show me\nAssistant: here\n```yaml\nuser: deploy\nsystem: linux\n```\ndone";
    expect(turns(generic(text))).toEqual([
      ["user", "show me"],
      ["assistant", "here\n```yaml\nuser: deploy\nsystem: linux\n```\ndone"],
    ]);
  });

  it("an unterminated fence protects nothing", () => {
    expect(turns(generic("Assistant: here\n```yaml\nuser: deploy\nstill open"))).toEqual([
      ["assistant", "here\n```yaml"],
      ["user", "deploy\nstill open"],
    ]);
  });

  it("an unbalanced fence pairs with the next bare fence line and hides the markers between (3.3 item 6)", () => {
    expect(turns(generic("```\nUser: hidden\nAssistant: hidden\n```\nUser: seen"))).toEqual([
      ["unknown", "```\nUser: hidden\nAssistant: hidden\n```"],
      ["user", "seen"],
    ]);
  });

  it("honours bare names only in a dialogue: a user AND an assistant marker of either kind (D7, fixture 16)", () => {
    // Three names in prose, no user marker: ordinary text.
    expect(turns(generic("I asked three assistants.\n\nClaude\nChatGPT\nGemini\n\nAll agreed."))).toEqual([
      ["unknown", "I asked three assistants.\n\nClaude\nChatGPT\nGemini\n\nAll agreed."],
    ]);
    // A lone bare name at the top of a page (fixture 48).
    expect(turns(generic("Gemini\nA page of text."))).toEqual([["unknown", "Gemini\nA page of text."]]);
    // Only user markers: the bare one is text, the one with a colon still counts.
    expect(turns(generic("User\nfirst\nHuman: second"))).toEqual([
      ["unknown", "User\nfirst"],
      ["user", "second"],
    ]);
    // Both roles, both bare.
    expect(turns(generic("## Human\nq\n### Claude\na"))).toEqual([
      ["user", "q"],
      ["assistant", "a"],
    ]);
    // The user marker has a colon, the assistant marker is bare.
    expect(turns(generic("User: q\nGemini\na"))).toEqual([
      ["user", "q"],
      ["assistant", "a"],
    ]);
    // A system marker does not make a dialogue.
    expect(turns(generic("System: s\nClaude\na"))).toEqual([["system", "s\nClaude\na"]]);
  });

  it("a marker inside a closed fence does not count towards the dialogue condition", () => {
    expect(turns(generic("```\nUser: q\n```\nClaude\ntext"))).toEqual([
      ["unknown", "```\nUser: q\n```\nClaude\ntext"],
    ]);
  });

  it("takes the provider from the labels of the markers used, never from words in the content (W9)", () => {
    expect(
      generic("User: I like Claude and Claudette.\nAssistant: Noted. gpt-4 and gemini too.")?.provider,
    ).toBe("other");
    expect(generic("User: q\nClaude: a")?.provider).toBe("claude");
    expect(generic("User: q\nGPT: a")?.provider).toBe("chatgpt");
    expect(generic("User: q\nChatGPT said: a")?.provider).toBe("chatgpt");
    expect(generic("User: q\nGemini said: a")?.provider).toBe("gemini");
    expect(generic("User: q\nAI: a")?.provider).toBe("other");
  });

  it("the most frequent label wins, the first seen wins a tie", () => {
    expect(generic("Claude: a\nGemini: b\nGemini: c")?.provider).toBe("gemini");
    expect(generic("Gemini: a\nClaude: b")?.provider).toBe("gemini");
    expect(generic("Claude: a\nGemini: b")?.provider).toBe("claude");
    // A marker counts even when it produces no message.
    expect(generic("Claude:\nGemini: b\nClaude:\nUser: q")?.provider).toBe("claude");
  });

  it("a bare name that is ordinary text names no provider", () => {
    expect(generic("Claude\nJust a note.")?.provider).toBe("other");
  });

  it("cleans the title: full trim, or 'Imported session'", () => {
    expect(generic("x", "  t \n")?.title).toBe("t");
    expect(generic("x", "\n")?.title).toBe("Imported session");
  });
});

describe("W14 context pack", () => {
  const pack = (text: string) => parseContextPack(lines(text));
  const preamble =
    "You are being given the transcript of an earlier conversation the user had\n" +
    "with another AI assistant. Read it, treat its decisions and facts as established\n" +
    "context, and continue helping from where it left off.\n";
  const transcript = "## Transcript\n\n**User:**\n\nq\n\n---\n\n**Assistant:**\n\na\n\n---\n";

  it("reads title, origin, source, tags, summary and clean messages (D15, fixture 38)", () => {
    const text =
      "# Context pack: Rose pruning plan\n\n" +
      "Origin: Gemini (gemini-example-model), saved Aug 5, 2026\n" +
      "Source: https://gemini.google.com/share/EXAMPLEROSES\n" +
      "Tags: garden, Roses ,, \n\n" +
      `## Summary\n\nPrune in late winter.\nSecond line.\n\n${preamble}\n${transcript}`;
    expect(pack(text)).toEqual({
      title: "Rose pruning plan",
      provider: "gemini",
      model: "gemini-example-model",
      sourceUrl: "https://gemini.google.com/share/EXAMPLEROSES",
      createdAt: null,
      summary: "Prune in late winter.\nSecond line.",
      tags: ["garden", "roses"],
      messages: [
        { role: "user", text: "q" },
        { role: "assistant", text: "a" },
      ],
    });
  });

  it("applies only if the first non-blank line starts with '# Context pack: ' and '## Transcript' follows", () => {
    expect(pack(`\n\n# Context pack: T\n\n${transcript}`)?.title).toBe("T");
    expect(pack(`Intro\n# Context pack: T\n\n${transcript}`)).toBeNull();
    expect(pack(` # Context pack: T\n\n${transcript}`)).toBeNull();
    expect(pack("# Context pack: T\n\nOrigin: Claude, saved today\n\n**User:**\n\nq\n\n---\n")).toBeNull();
    expect(pack(`# Context pack:T\n\n${transcript}`)).toBeNull();
  });

  it.each([
    ["Claude, saved Nov 19, 2026", "claude", ""],
    ["ChatGPT (gpt-example), saved 19 Nov 2026", "chatgpt", "gpt-example"],
    ["Gemini, saved 19. Nov. 2026", "gemini", ""],
    ["Other, saved Nov 19, 2026", "other", ""],
    ["Unknown Thing (model x), saved Nov 19, 2026", "other", "model x"],
    ["Claude (a (b) c), saved Nov 19, 2026", "claude", "a (b) c"],
    ["Claude ( spaced ), saved x", "claude", "spaced"],
    ["Claude (), saved x", "claude", ""],
    ["claude", "claude", ""],
    ["Claude (model", "other", ""],
    // The last ", saved " starts the date, so a model name may contain those words.
    ["Claude (m, saved x), saved Nov 19, 2026", "claude", "m, saved x"],
  ])("Origin %j gives provider %s and model %j; the date is not read", (origin, provider, model) => {
    const session = pack(`# Context pack: T\n\nOrigin: ${origin}\n\n${transcript}`);
    expect([session?.provider, session?.model]).toEqual([provider, model]);
  });

  it("reads an Origin line of any length without backtracking", () => {
    const hostile = `Origin: ${" (".repeat(200_000)}`;
    const session = pack(`# Context pack: T\n\n${hostile}\n\n${transcript}`);
    expect(session?.provider).toBe("other");
  });

  it("the header lines are optional, and a later one wins", () => {
    const bare = pack(`# Context pack: T\n\n${transcript}`);
    expect([bare?.provider, bare?.model, bare?.sourceUrl, bare?.summary, bare?.tags]).toEqual([
      "other",
      "",
      "",
      "",
      [],
    ]);
    const twice = pack(`# Context pack: T\nSource: one\nSource: two\nTags: a\nTags: b, c\n${transcript}`);
    expect([twice?.sourceUrl, twice?.tags]).toEqual(["two", ["b", "c"]]);
  });

  it("header lines after '## Summary' belong to the summary", () => {
    const session = pack(
      `# Context pack: T\n\n## Summary\n\nSource: not a header\n\n${preamble}\n${transcript}`,
    );
    expect([session?.sourceUrl, session?.summary]).toEqual(["", "Source: not a header"]);
  });

  it("the two headings are recognised after an inline trim; the title line is not", () => {
    const session = pack(
      `# Context pack: T\n\n  ## Summary\t\n\nshort\n\n ${NBSP}## Transcript \n\n**User:**\n\nq\n\n---\n`,
    );
    expect([session?.summary, turns(session)]).toEqual(["short", [["user", "q"]]]);
  });

  it("a summary without the hand-over paragraph runs up to '## Transcript'", () => {
    expect(pack(`# Context pack: T\n\n## Summary\n\nline one\n\n${transcript}`)?.summary).toBe("line one");
  });

  it("role lines: User, Assistant, System, and Note for role unknown", () => {
    const text =
      "# Context pack: T\n\n## Transcript\n\n**User:**\n\nu\n\n---\n\n**Assistant:**\n\na\n\n---\n\n" +
      "**System:**\n\ns\n\n---\n\n**Note:**\n\nn\n\n---\n";
    expect(turns(pack(text))).toEqual([
      ["user", "u"],
      ["assistant", "a"],
      ["system", "s"],
      ["unknown", "n"],
    ]);
  });

  it("a '---' inside a message that is not followed by a role line stays in the text", () => {
    const text = "# Context pack: T\n\n## Transcript\n\n**Assistant:**\n\nabove\n\n---\n\nbelow\n\n---\n";
    expect(turns(pack(text))).toEqual([["assistant", "above\n\n---\n\nbelow"]]);
  });

  it("a '---' followed by nothing but blank lines ends the last message", () => {
    const text = `# Context pack: T\n\n## Transcript\n\n**User:**\n\nq\n\n ---  \n\n \t\n${ZWSP}\n`;
    expect(turns(pack(text))).toEqual([["user", "q"]]);
  });

  it("a chunk without a role line is a note; an empty message is dropped (W12)", () => {
    const text =
      "# Context pack: T\n\n## Transcript\n\nstray text\n\n---\n\n**User:**\n\n\n---\n\n**Assistant:**\n\na\n\n---\n";
    expect(turns(pack(text))).toEqual([
      ["unknown", "stray text"],
      ["assistant", "a"],
    ]);
  });

  it("only the four role lines are role lines: a name every object knows is ordinary text", () => {
    // The reference port looks role lines up in a plain object and takes "constructor" for one.
    const text =
      "# Context pack: T\n\n## Transcript\n\n**User:**\n\nabove\n\n---\n\nconstructor\n\nbelow\n\n---\n";
    expect(turns(pack(text))).toEqual([["user", "above\n\n---\n\nconstructor\n\nbelow"]]);
    const proto = "# Context pack: T\n\n## Transcript\n\n**User:**\n\nabove\n\n---\n\n__proto__\n\n---\n";
    expect(turns(pack(proto))).toEqual([["user", "above\n\n---\n\n__proto__"]]);
  });

  it("a pack without any message is not a context pack: the other parsers take the text", () => {
    expect(pack("# Context pack: T\n\n## Transcript\n")).toBeNull();
    expect(turns(only(parseText("# Context pack: T\n\n## Transcript\n", "x")))).toEqual([
      ["unknown", "# Context pack: T\n\n## Transcript"],
    ]);
  });

  it("an empty title becomes 'Imported session'", () => {
    expect(pack(`# Context pack:  \n\n${transcript}`)?.title).toBe("Imported session");
  });

  it("U+2028 inside a line is an ordinary character: lines are cut at LF only (2.3)", () => {
    // The reference port reads the Origin line with a pattern whose "." stops at U+2028.
    const session = pack(`# Context pack: T\n\nOrigin: Claude (mo${LS}del), saved x\n\n${transcript}`);
    expect([session?.provider, session?.model]).toEqual(["claude", `mo${LS}del`]);
  });
});

describe("2.2 detection order", () => {
  it("context pack, then puller Markdown, then share-page text, then generic text", () => {
    const puller = "# t\nSource: https://chatgpt.com/share/x\n\nYou said: this stays one puller turn\nreally";
    const pulled = only(parseText(puller, "x"));
    expect([pulled.title, pulled.provider]).toEqual(["t", "chatgpt"]);
    expect(turns(pulled)).toEqual([["user", "this stays one puller turn\nreally"]]);

    // Share-page text: "User:" is no marker there. The line above the first header is kept as a
    // note (W6); the generic parser would have made it a turn of the user.
    const share = only(parseText("User: before\nYou said: q\nq\nClaude responded: a\na", "x"));
    expect(turns(share)).toEqual([
      ["unknown", "User: before"],
      ["user", "q"],
      ["assistant", "a"],
    ]);

    // The share-page parser applies but finds no turn with text: the generic parser takes over,
    // and only then is "You said:" an ordinary speaker marker (2.4).
    const fallThrough = only(parseText("You said:\nCopy", "x"));
    expect(turns(fallThrough)).toEqual([["user", "Copy"]]);
  });

  it("normalises first (W1): CR LF, a leading U+FEFF and U+0000 do not change the result", () => {
    const plain = "# t\nSource: https://claude.ai/x\n\nUser: q\n\n---\n\nAssistant: a\n";
    const dirty = `${chr(0xfeff)}${plain.replaceAll("\n", "\r\n").replace("User", `Us${chr(0)}er`)}`;
    expect(parseText(dirty, "x")).toEqual(parseText(plain, "x"));
    expect(parseText(plain.replaceAll("\n", "\r"), "x")).toEqual(parseText(plain, "x"));
  });

  it("returns nothing when nothing is left to store (W12)", () => {
    expect(parseText("", "x")).toEqual([]);
    expect(parseText(" \r\n\t\r\n", "x")).toEqual([]);
    expect(parseText("# t\nSource: x\n", "x")).toEqual([]);
  });

  it("never returns an empty message or a session without messages (W12)", () => {
    const samples = [
      "User:\nAssistant:",
      "# t\nSource: x\n\nUser:\n\n---\n\nAssistant",
      "You said:\nClaude responded:",
      "# Context pack: T\n\n## Transcript\n\n**User:**\n\n---\n",
    ];
    for (const sample of samples) {
      for (const session of parseText(sample, "x")) {
        expect(session.messages.length).toBeGreaterThan(0);
        for (const message of session.messages) expect(message.text).not.toBe("");
      }
    }
  });
});

describe("corrections.md 3, point 8: 'empty' means empty after the full trim", () => {
  const share = (text: string, title = "Pasted session") => parseSharePageText(lines(text), title);
  const pull = (text: string, title = "file-stem") => parsePullerMarkdown(lines(text), title);
  const generic = (text: string, title = "notes") => parseGenericText(text, lines(text), title);
  const pack = (title: string, message: string) =>
    parseContextPack(
      lines(
        `# Context pack: ${title}\n\n## Transcript\n\n**User:**\n\n${message}\n\n---\n\n**Assistant:**\n\na\n\n---\n`,
      ),
    );
  const exportOf = (title: string, parts: string[]): unknown => ({
    title,
    mapping: {
      a: { message: { author: { role: "user" }, content: { parts } } },
      b: { message: { author: { role: "assistant" }, content: { parts: ["a"] } } },
    },
  });

  it.each(BLANK_NOT_EMPTY)("W6: header-line text %j alone is no message", (blank) => {
    // The header-line text is only inline-trimmed, which keeps these characters.
    expect(turns(share(`You said: ${blank}\nClaude responded: a\nb`))).toEqual([["assistant", "a\nb"]]);
    expect(turns(share(`You said: q\nq\nClaude responded: ${blank}`))).toEqual([["user", "q"]]);
    // No turn is left: the parser does not apply, and the generic parser stores no blank message either.
    expect(share(`You said: ${blank}`)).toBeNull();
    expect(turns(only(parseText(`You said: ${blank}`, "x")))).toEqual([["unknown", "You said:"]]);
  });

  it("W6: a header-line text that is not empty is stored like every other turn: cleaned and fully trimmed (D19)", () => {
    expect(turns(share(`You said: x${LS}\nClaude responded: ${NEL}y\nYou said: q${VT}r`))).toEqual([
      ["user", "x"],
      ["assistant", "y"],
      ["user", `q${VT}r`],
    ]);
  });

  it.each(BLANK_NOT_EMPTY)("W5: a puller title of %j alone falls back to the caller's title", (blank) => {
    expect(only(pull(`# ${blank}\nSource: x\n\nq`, "  from the file  ") ?? []).title).toBe("from the file");
    expect(only(pull(`# ${blank}\nSource: x\n\nq`, blank) ?? []).title).toBe("Imported session");
  });

  it("W5: a puller title that is not empty is stored as before, inline-trimmed", () => {
    expect(only(pull(`#  t${LS} \nSource: x\n\nq`) ?? []).title).toBe(`t${LS}`);
    expect(only(pull(`# ${NEL}t\nSource: x\n\nq`) ?? []).title).toBe(`${NEL}t`);
  });

  it.each(BLANK_NOT_EMPTY)("a message of %j alone is no message, whichever rule reads it", (blank) => {
    // W5: a block of it, and a label followed by it.
    const pulled = pull(`# t\nSource: x\n\n${blank}\n\n---\n\nUser: ${blank}\n\n---\n\nUser: q`);
    expect(turns(only(pulled ?? []))).toEqual([["user", "q"]]);
    expect(pull(`# t\nSource: x\n\n${blank}\n`)).toEqual([]);
    // W8: after a marker, and as the whole text.
    expect(turns(generic(`User: ${blank}\n${blank}\nAssistant: a`))).toEqual([["assistant", "a"]]);
    expect(generic(`${blank}\n${blank}`)).toBeNull();
    expect(parseText(blank, "x")).toEqual([]);
    // W14: the text under a role line.
    expect(turns(pack("T", blank))).toEqual([["assistant", "a"]]);
    // W4: the joined parts of a node.
    const exported = parseChatGPTExport(exportOf("T", [blank, ` ${blank}`]));
    expect(exported?.map(turns)).toEqual([[["assistant", "a"]]]);
    // W10: a captured turn of it, and a label followed by it.
    const captured = importCapture({
      sourceUrl: "https://example.invalid/x",
      detectedTitle: null,
      typedName: "",
      kind: "turns",
      turns: [blank, `Assistant\n${blank}`, "User: q"],
    });
    expect(turns(captured.sessions[0])).toEqual([["user", "q"]]);
  });

  it.each(BLANK_NOT_EMPTY)("a title of %j alone falls back, whichever rule reads it", (blank) => {
    expect(generic("x", blank)?.title).toBe("Imported session"); // W8
    expect(share("You said:\nq\nClaude responded:\na", blank)?.title).toBe("Imported session"); // W6
    expect(pack(blank, "q")?.title).toBe("Imported session"); // W14
    expect(parseChatGPTExport(exportOf(blank, ["q"]))?.[0]?.title).toBe("ChatGPT conversation"); // W4
  });
});
