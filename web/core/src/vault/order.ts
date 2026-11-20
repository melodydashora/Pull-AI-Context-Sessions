// Comparisons that must give the same order in the browser, on the server and in SQL
// (docs/data-model.md 7.3). All of them are consistent comparison functions: they return 0 for
// equal values, so Array.prototype.sort is stable and its result does not depend on the engine.

/**
 * Ids in ascending order, the tie-break of every list (data-model.md 7.3 `ORDER BY ... id ASC`).
 * For canonical lower-case UUIDs this is the order PostgreSQL gives the `uuid` type.
 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Strings in code-point order: what `sorted()` gives in the Apple app and `COLLATE "C"` gives in
 * PostgreSQL (data-model.md 3.2, 7.3). The default order of JavaScript compares UTF-16 units
 * instead, which puts a character outside the Basic Multilingual Plane before U+E000 to U+FFFF.
 */
export function compareCodePoints(a: string, b: string): number {
  const shorter = Math.min(a.length, b.length);
  let index = 0;
  while (index < shorter) {
    // Both strings are equal up to `index`, so `index` starts a code point in both.
    const x = a.codePointAt(index) ?? 0;
    const y = b.codePointAt(index) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
    index += x > 0xffff ? 2 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/**
 * The instant of a date as a number that always compares: a date that holds no instant counts as
 * earlier than every other, so that an order built on it stays total whatever a caller hands in.
 */
export function instantOf(date: Date): number {
  const time = date.getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Later instants first; 0 when the instants are equal. */
export function compareNewestFirst(a: Date, b: Date): number {
  const x = instantOf(a);
  const y = instantOf(b);
  return x > y ? -1 : x < y ? 1 : 0;
}
