// Tags (docs/data-model.md 3.2, 8.2): an ordered list of lower-case strings on each session.

import { compareCodePoints } from "./order.ts";

// data-model.md 8.2 with corrections.md 2, point 1: the tags of the comma-separated tag field.
// Trim, lower-case, strip the leading run of "#" and white space, drop empty tags and repeats
// (B3); the order of first appearance is kept. The core has one parseTags: the reader's repair 4
// and the tag field of the screens use the same function, so a stored tag is one the field gives.
export { parseTags } from "../interchange/shared.ts";

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
