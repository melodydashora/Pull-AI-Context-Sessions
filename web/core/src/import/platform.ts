// The two platform features of docs/import-rules.md C4 that are not part of the language:
// the URL parser and the text decoder. Browsers, workers and Node all have them as globals.
// The core is compiled without the type libraries of either platform, so their shape is
// stated here, limited to the members this module uses, and visible in this file only.

/** The members of a parsed URL that the importer reads. `protocol` can be assigned. */
export interface ParsedUrl {
  protocol: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly href: string;
}

declare const URL: new (input: string) => ParsedUrl;

declare const TextDecoder: new (
  label: string,
  options?: { readonly fatal?: boolean },
) => { decode(input: Uint8Array): string };

/** The labels C4 allows. */
export type DecoderLabel = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/** Parses an absolute URL as the platform does. null when it is not one. */
export function parseUrl(input: string): ParsedUrl | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

/**
 * Decodes bytes; a byte-order mark of the same encoding at the start is consumed.
 * With `fatal`, invalid input gives null instead of U+FFFD. null also when the platform
 * refuses the text, for example because it is too long to be one string.
 */
export function decodeText(bytes: Uint8Array, label: DecoderLabel, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/** Percent-decodes one URL path segment. null when the escapes are not valid UTF-8. */
export function percentDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
