// Two functions of data-model.md section 8 that the reader and the import cannot work without.
// They are that section's code, unchanged. The rest of section 8 (search, context pack, timeline,
// project order) is built on top of this module and should take these two from here.

/**
 * data-model.md 8.2: the tags of a comma-separated field. Trim, lower-case, strip leading "#", drop
 * empties and repeats.
 */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const part of input.split(",")) {
    const tag = part.trim().toLowerCase().replace(/^#+/, "").trim();
    if (tag !== "" && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** data-model.md 8.4: the value two project names are compared by (`projects.name_key`). */
export function projectNameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

// "#" and white space at the start, in any mix. \s is exactly the set String.prototype.trim removes.
const LEADING_HASHES_AND_SPACE = /^[\s#]+/u;

/**
 * data-model.md 6.6 repair 4: the tags of a session as the reader stores them. Every element goes
 * through the steps of parseTags until they change nothing more, in one pass; repeats are dropped
 * across the whole list, keeping the first.
 *
 * Departure from data-model.md 6.6, which says "parseTags applied to each element": one application
 * is not always enough. It turns "# #a" into "#a", and "#a" into "a", so stopping there would store
 * a tag that the next reading of the app's own export changes.
 */
export function normaliseTags(elements: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    for (const part of element.split(",")) {
      const tag = part.toLowerCase().replace(LEADING_HASHES_AND_SPACE, "").trimEnd();
      if (tag !== "" && !seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
  }
  return out;
}
