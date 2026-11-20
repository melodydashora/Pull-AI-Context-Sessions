// The top bar of a session is one line high at every width (docs/corrections.md 1.5, the
// compact top bar). The test suite has no browser, so this holds the rules that make it so;
// the heights themselves were measured in headless Chromium at 320, 359, 390 and 600 px
// (52 px each, the bar's own height; no horizontal scroll).

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule with exactly this selector list, inside `scope`. */
function rule(scope: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/,\s*/g, ",\\s*");
  const found = new RegExp(`(?:^|[}{\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(scope);
  expect(found, `no rule for ${selector}`).not.toBeNull();
  return (found?.[1] ?? "").replace(/\s+/g, " ");
}

/** The body of the media block that starts with this condition and holds this selector. */
function media(condition: string, selector: string): string {
  let from = 0;
  for (;;) {
    const at = css.indexOf(`@media ${condition} {`, from);
    expect(at, `no media block ${condition} with ${selector}`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = at;
    for (let i = css.indexOf("{", at); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const body = css.slice(css.indexOf("{", at) + 1, end);
    if (body.includes(selector)) return body;
    from = end;
  }
}

const COMPACT = "(max-width: 599.98px), (max-height: 479.98px)";

it("no control of the top bar wraps, and the back label is cut with an ellipsis first", () => {
  expect(rule(css, ".toolbar__back, .button--toolbar")).toContain("white-space: nowrap");
  expect(rule(css, ".toolbar__back")).toContain("min-inline-size: 0");
  const label = rule(css, ".toolbar__back-label");
  expect(label).toContain("overflow: hidden");
  expect(label).toContain("text-overflow: ellipsis");
  expect(rule(css, ".toolbar__actions")).toContain("flex: none");
  expect(rule(css, ".toolbar")).not.toContain("flex-wrap");
});

it("below 600 px the actions are icons with their names kept for assistive technology", () => {
  const compact = media(COMPACT, ".button--toolbar .button__label");
  const label = rule(compact, ".button--toolbar .button__label");
  expect(label).toContain("position: absolute");
  expect(label).toContain("clip-path: inset(50%)");
  expect(label).not.toContain("display: none");
  expect(rule(compact, ".toolbar__back")).toContain("display: inline-flex");
});

it("below 360 px the back control is the chevron alone (design.md 4.3, rule 1)", () => {
  const narrow = media("(max-width: 359.98px)", ".toolbar__back-label");
  expect(rule(narrow, ".toolbar__back-label")).toContain("display: none");
});
