// The link test for pasted text (docs/import-rules.md W11 and C12, capture.md 8.1). It
// replaces the Apple test, which takes any single token with a dot for a link (D12).

import { parseUrl } from "./platform.ts";
import { hasFewerGraphemesThan, normaliseText, trimFull } from "./text.ts";

/** 2.10: the longest text treated as a link, in user-perceived characters (W15). */
const LINK_LIMIT = 500;

// capture.md 8.1: a label of two or more letters, A to Z in either case. A loop, not a pattern.
function isTwoOrMoreLetters(label: string): boolean {
  if (label.length < 2) return false;
  for (let index = 0; index < label.length; index++) {
    const code = label.charCodeAt(index) | 0x20; // folds A to Z onto a to z
    if (code < 0x61 || code > 0x7a) return false;
  }
  return true;
}

/**
 * capture.md 8.1 on text that is W1-normalised and full-trimmed: no white space, under 500
 * characters, parses as an http(s) URL (after prefixing "https://" when there is no "://"),
 * and the host contains a dot, does not end with one, and ends in a label of two or more
 * letters. Returns the link with the scheme forced to https, or null.
 */
export function linkOf(trimmed: string): string | null {
  // The length test comes first, so that a long text is never searched or parsed.
  if (trimmed === "" || !hasFewerGraphemesThan(trimmed, LINK_LIMIT) || /\s/.test(trimmed)) return null;
  const url = parseUrl(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (url === null) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname;
  if (!host.includes(".") || host.endsWith(".")) return null;
  if (!isTwoOrMoreLetters(host.slice(host.lastIndexOf(".") + 1))) return null;
  url.protocol = "https:";
  return url.href;
}

/**
 * W11 `looksLikeLink`: the link a text consists of, or null when the text is not just a link.
 * W1 and the full trim are applied first. Known gap (HANDOFF.md section 5): a bare file name
 * such as `notes.md` and an e-mail address still pass.
 */
export function looksLikeLink(text: string): string | null {
  return linkOf(trimFull(normaliseText(text)));
}
