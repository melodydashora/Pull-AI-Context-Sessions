// tokens.css against the block of docs/design.md 4.2. The formatter of this workspace spells some
// values differently (hex colours in lower case, 0.1 for 0.10, long values on a line of their
// own), so the file is not the block byte for byte. This test ties the two together: the same
// custom properties, in the same order, with the same values.

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { withOccurrence } from "./components/controls.tsx";

function declarations(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const m of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const value = (m[2] as string)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => hex.toLowerCase())
      .replace(/(\d\.\d*?)0+(?![\d.])/g, "$1")
      .replace(/(\d)\.(?!\d)/g, "$1");
    found.push(`${m[1]}: ${value}`);
  }
  return found;
}

function blockOfTheDocument(): string {
  const text = readFileSync(new URL("../../docs/design.md", import.meta.url), "utf8");
  const section = text.slice(text.indexOf("\n### 4.2 Design tokens"), text.indexOf("\n### 4.3 "));
  const fence = "`".repeat(3);
  const open = section.indexOf(`${fence}css\n`);
  return section.slice(open + 7, section.indexOf(`\n${fence}`, open));
}

it("tokens.css holds the custom properties of design.md 4.2, in order, with the same values", () => {
  const file = declarations(readFileSync(new URL("./tokens.css", import.meta.url), "utf8"));
  const document = declarations(blockOfTheDocument());
  expect(document.length).toBeGreaterThan(100);
  expect(file).toEqual(document);
});

it("the comparison would see a changed value", () => {
  expect(declarations("a { --x: #ABCDEF; --y: 0.10; }")).toEqual(["--x: #abcdef", "--y: 0.1"]);
  expect(declarations("a { --y: 0.11; }")).not.toEqual(declarations("a { --y: 0.1; }"));
  expect(declarations("a { --y: 10; }")).toEqual(["--y: 10"]);
});

it("status lines with the same text get different keys", () => {
  const keys = withOccurrence(["a.md: imported", "a.md: imported", "b.md: imported"]).map(
    (entry) => entry.key,
  );
  expect(new Set(keys).size).toBe(3);
  expect(withOccurrence(["x"])).toEqual([{ line: "x", key: "0:x" }]);
});
