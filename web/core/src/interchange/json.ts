// JSON values as the interchange module holds them.
//
// Every object this module builds from foreign input has no prototype, so a key named
// "__proto__", "constructor" or "prototype" is stored like any other key and can never reach
// Object.prototype (data-model.md 6.5 item 7).

/** Any JSON value. Unknown properties of interchange objects are kept as JSON values. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

/** A JSON object. Read it with Object.keys or by key; objects made here have no prototype. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A JSON object while it is being filled. */
export type MutableJsonObject = { [key: string]: JsonValue };

/** A new object without a prototype: assigning any key, also "__proto__", stores a plain value. */
export function newObject(): MutableJsonObject {
  return Object.create(null);
}

/** An object without a prototype that holds `known` first and then `extras` (6.8: known fields first). */
export function assemble<T extends JsonObject>(known: T, extras: JsonObject): T {
  return Object.assign(newObject(), known, extras);
}

/** The shared empty bag of unknown properties. Frozen, so sharing it is safe. */
export const EMPTY_OBJECT: JsonObject = Object.freeze(newObject());

export function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The properties of `source` whose names are not in `known`, in the order of `source`. */
export function unknownProperties(source: JsonObject, known: ReadonlySet<string>): JsonObject {
  let out: MutableJsonObject | null = null;
  for (const key of Object.keys(source)) {
    if (known.has(key)) continue;
    const value = source[key];
    if (value === undefined) continue;
    out ??= newObject();
    out[key] = value;
  }
  return out ?? EMPTY_OBJECT;
}

/**
 * Deep equality of two JSON values. Property order is ignored, array order is not.
 * Works through an explicit stack, so the depth of the values cannot exhaust the call stack.
 */
export function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  const pending: [JsonValue, JsonValue][] = [[left, right]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [a, b] = pair;
    if (a === b) continue;
    if (isJsonArray(a)) {
      if (!isJsonArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (x === undefined || y === undefined) return false;
        pending.push([x, y]);
      }
    } else if (isJsonObject(a)) {
      if (!isJsonObject(b)) return false;
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) return false;
      for (const key of keys) {
        const x = a[key];
        const y = Object.hasOwn(b, key) ? b[key] : undefined;
        if (x === undefined || y === undefined) return false;
        pending.push([x, y]);
      }
    } else {
      // Two different primitives, or a primitive beside a container.
      return false;
    }
  }
  return true;
}
