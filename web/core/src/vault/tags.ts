// Tags (docs/data-model.md 3.2, 8.2): an ordered list of lower-case strings on each session.

import { compareCodePoints } from "./order.ts";

/**
 * data-model.md 8.2: the tags of the comma-separated tag field. Trim, lower-case, strip leading
 * "#", drop empty tags and repeats (B3); the order of first appearance is kept.
 *
 * The results are those of the function printed in 8.2, which interchange/shared.ts holds
 * unchanged. That one looks every tag up in the list built so far and needs time quadratic in the
 * number of different tags; this one remembers them in a Set, so a long field costs linear time.
 */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of input.split(",")) {
    const tag = part.trim().toLowerCase().replace(/^#+/, "").trim();
    if (tag !== "" && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** data-model.md 8.2: what the tag field shows for stored tags, `tags.join(", ")`. */
export function formatTags(tags: readonly string[]): string {
  return tags.join(", ");
}

/**
 * data-model.md 8.2, 7.3: the tag list of the sidebar, the distinct tags of all sessions in
 * code-point order. Tags are compared as stored, without the "#" that rows display.
 */
export function tagList(sessions: readonly { readonly tags: readonly string[] }[]): string[] {
  const distinct = new Set<string>();
  for (const session of sessions) {
    for (const tag of session.tags) distinct.add(tag);
  }
  return [...distinct].sort(compareCodePoints);
}
