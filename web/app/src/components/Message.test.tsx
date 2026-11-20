// The message view on hostile text (docs/design.md 4.7.3): whatever a transcript holds, the page
// gets text nodes and, for http, https and mailto addresses only, links.

import { textMessage } from "@sessionvault/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MessageBubble } from "./Message.tsx";

const F = "```";

function draw(text: string, role = "assistant"): string {
  const message = textMessage({ id: "00000000-0000-4000-8000-000000000001", position: 0, role, text });
  return renderToStaticMarkup(<MessageBubble message={message} onCopyFailed={() => {}} />);
}

it("draws markup characters of a transcript as text, never as elements", () => {
  const html = draw(
    '<img src=x onerror=alert(1)> <script>alert(2)</script> <a href="javascript:alert(3)">x</a> <style>*{}</style>',
  );
  expect(html).not.toMatch(/<img|<script|<style|<a /);
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
});

it("links http, https and mailto addresses only, each in a new tab without a referrer", () => {
  const html = draw(
    "[a](javascript:alert(1)) [b](data:text/html,x) [c](https://example.com/c) https://example.com/d [e](mailto:e@example.com) [f](vbscript:x)",
  );
  const links = [...html.matchAll(/<a ([^>]*)>/g)].map((match) => match[1] ?? "");
  expect(links).toHaveLength(3);
  for (const attributes of links) {
    expect(attributes).toMatch(/href="(https:\/\/example\.com\/[cd]|mailto:e@example\.com)"/);
    expect(attributes).toContain('target="_blank"');
    expect(attributes).toContain('rel="noopener noreferrer"');
  }
  expect(html).toContain("[a](javascript:alert(1))");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="data:');
});

it("keeps the quotes of an address inside the attribute", () => {
  const html = draw('[x](https://example.com/"onmouseover="alert(1))');
  expect(html).toContain('href="https://example.com/&quot;onmouseover=&quot;alert(1)"');
  expect(html).not.toMatch(/<a [^>]*\sonmouseover=/);
});

it("draws code as code, with its language and a copy button, and nothing inside it as markup", () => {
  const html = draw(
    `Before\n${F}html\n<b onclick="x()">**not bold**</b> [l](https://example.com)\n${F}\nAfter \`<i>inline</i>\``,
  );
  expect(html).toContain('<span class="code-block__language">html</span>');
  expect(html).toContain("&lt;b onclick=&quot;x()&quot;&gt;**not bold**&lt;/b&gt; [l](https://example.com)");
  expect(html).toContain('<code class="inline-code">&lt;i&gt;inline&lt;/i&gt;</code>');
  expect(html).toContain('aria-label="Copy code"');
  expect(html).not.toMatch(/<b |<i>/);
});

it("labels a message by its role and marks a user's message", () => {
  expect(draw("hello", "user")).toContain('class="bubble bubble--user"');
  expect(draw("hello", "user")).toContain(">User<");
  expect(draw("hello", "assistant")).toContain(">Assistant<");
  expect(draw("hello", "tool")).toContain(">Note<");
  expect(draw("hello", "<b>role</b>")).toContain(">Note<");
});

it("carries no style attribute and no event attribute: the content security policy would refuse them", () => {
  const html = draw(`**bold** *em* ~~gone~~ \`code\` https://example.com\n\n${F}js\nlet x = 1\n${F}`);
  expect(html).not.toMatch(/\sstyle=/);
  expect(html).not.toMatch(/\son[a-z]+=/);
});
