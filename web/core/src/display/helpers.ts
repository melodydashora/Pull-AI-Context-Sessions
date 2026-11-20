// Small display helpers of docs/design.md, appendix 5.4: the summary line of a list row and the
// relative time of an import. Typed ports with the same results for the golden cases.

const SPACE = /\s/;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/** A line without the Markdown markers at its start: white space, #, >, *, - and "1. ". */
function withoutLeadingMarkers(line: string): string {
  let i = 0;
  for (;;) {
    const ch = line[i];
    if (ch === undefined) break;
    if (ch === "#" || ch === ">" || ch === "*" || ch === "-" || SPACE.test(ch)) {
      i++;
      continue;
    }
    let j = i;
    while (isDigit(line[j])) j++;
    const after = line[j + 1];
    if (j > i && line[j] === "." && after !== undefined && SPACE.test(after)) {
      i = j + 2;
      continue;
    }
    break;
  }
  return line.slice(i);
}

/**
 * The first non-blank line of a summary for a list row, without Markdown markers (design.md B15).
 * "" when the summary has no such line.
 */
export function summaryLine(summary: string): string {
  for (const line of summary.replace(/\r\n?/g, "\n").split("\n")) {
    const text = withoutLeadingMarkers(line).replaceAll("**", "").replaceAll("`", "").trim();
    if (text !== "") return text;
  }
  return "";
}

/** A value and a unit for Intl.RelativeTimeFormat. */
export interface RelativeParts {
  readonly value: number;
  readonly unit: "second" | "minute" | "hour" | "day" | "week" | "month" | "year";
}

/**
 * Relative time for list rows. Format the result with
 * `new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit)`.
 * A time in the future counts as now.
 */
export function relativeParts(secondsAgo: number): RelativeParts {
  const d = Number.isFinite(secondsAgo) ? Math.max(0, secondsAgo) : 0;
  const DAY = 86400;
  const MONTH = 30.44 * DAY;
  const YEAR = 365.25 * DAY;
  if (d < 1) return { value: 0, unit: "second" };
  if (Math.round(d) < 60) return { value: -Math.round(d), unit: "second" };
  if (Math.round(d / 60) < 60) return { value: -Math.round(d / 60), unit: "minute" };
  if (Math.round(d / 3600) < 24) return { value: -Math.round(d / 3600), unit: "hour" };
  if (Math.round(d / DAY) < 7) return { value: -Math.round(d / DAY), unit: "day" };
  if (d < MONTH) return { value: -Math.max(1, Math.round(d / (7 * DAY))), unit: "week" };
  if (Math.round(d / MONTH) < 12) return { value: -Math.round(d / MONTH), unit: "month" };
  return { value: -Math.max(1, Math.round(d / YEAR)), unit: "year" };
}
