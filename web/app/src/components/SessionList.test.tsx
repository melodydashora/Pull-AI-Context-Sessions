// The session list is windowed (docs/design.md 4.7.5): without a page to look at, it draws the
// first chunk of 50 rows and the chunk of the session that has to stay, and nothing else.

import { emptyVault, listSessions, type VaultSession } from "@sessionvault/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { type ImportClock, importPastedText } from "../importing.ts";
import { SessionList } from "./SessionList.tsx";

/** `count` sessions in list order, made by pasting `count` small transcripts. */
function sessions(count: number): VaultSession[] {
  let n = 0;
  const clock: ImportClock = {
    now: () => new Date(Date.UTC(2026, 10, 20, 12, 0, n)),
    newId: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    },
  };
  let vault = emptyVault();
  for (let k = 0; k < count; k++) {
    const text = `User: question ${k}\n\nAssistant: answer ${k}\n`;
    vault = importPastedText(
      vault,
      text,
      { provider: "claude", sourceUrl: null, allowWall: false },
      clock,
    ).vault;
  }
  expect(vault.sessions).toHaveLength(count);
  return listSessions(vault.sessions, { kind: "all" }, "");
}

function draw(list: readonly VaultSession[], selectedId: string | null, keepId: string | null): string {
  return renderToStaticMarkup(
    <SessionList
      sessions={list}
      total={list.length}
      query=""
      onQuery={() => {}}
      selectedId={selectedId}
      keepId={keepId}
      now={new Date("2026-11-20T13:00:00.000Z")}
      onOpen={() => {}}
      onImport={() => {}}
    />,
  );
}

const count = (html: string, piece: string): number => html.split(piece).length - 1;

it("draws the first 50 rows of a long list and a place for every other chunk", () => {
  const list = sessions(120);
  const html = draw(list, null, null);
  expect(count(html, 'role="list"')).toBe(1);
  expect(count(html, 'role="listitem"')).toBe(50);
  expect(count(html, 'class="rows__chunk"')).toBe(3);
  expect(html).toContain('data-chunk="2"');
  // Each row says its place in the whole list.
  expect(count(html, 'aria-setsize="120"')).toBe(50);
  expect(html).toContain('aria-posinset="1"');
  expect(html).toContain('aria-posinset="50"');
  expect(html).not.toContain('aria-posinset="51"');
  expect(html).toContain(`href="/sessions/${list[0]?.id}"`);
  expect(html).not.toContain(`href="/sessions/${list[50]?.id}"`);
});

it("draws the chunk of the session that has to stay in the page, wherever it is", () => {
  const list = sessions(120);
  const kept = list[110]?.id ?? null;
  const html = draw(list, kept, kept);
  expect(count(html, 'role="listitem"')).toBe(70);
  expect(html).toContain('aria-posinset="101"');
  expect(html).toContain('aria-posinset="120"');
  expect(html).not.toContain('aria-posinset="51"');
  expect(count(html, 'aria-current="page"')).toBe(1);
  expect(html).toMatch(new RegExp(`href="/sessions/${kept}" aria-current="page"`));
});

it("draws a short list whole, and no markup of it carries a style attribute", () => {
  const html = draw(sessions(7), null, null);
  expect(count(html, 'role="listitem"')).toBe(7);
  expect(count(html, 'class="rows__chunk"')).toBe(1);
  expect(html).not.toMatch(/\sstyle=/);
  expect(draw(sessions(120), null, null)).not.toMatch(/\sstyle=/);
});
