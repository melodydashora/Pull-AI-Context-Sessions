// String hygiene for interchange documents (data-model.md 5.2 C9, 6.6 R9, R10 and repair 5).

const NUL = "\u0000";
// In Unicode mode a surrogate range matches only surrogates that are not part of a pair.
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
const LONE_SURROGATES = /[\uD800-\uDFFF]/gu;

/** R9: true when the string holds U+0000 or a surrogate without its partner. */
export function hasNulOrLoneSurrogate(text: string): boolean {
  return text.includes(NUL) || LONE_SURROGATE.test(text);
}

/**
 * Repair 5: remove U+0000, then replace every lone surrogate with U+FFFD. Applying it twice changes
 * nothing.
 */
export function cleanString(text: string): string {
  const withoutNul = text.includes(NUL) ? text.replaceAll(NUL, "") : text;
  return LONE_SURROGATE.test(withoutNul) ? withoutNul.replace(LONE_SURROGATES, "\uFFFD") : withoutNul;
}

/** R10: true when the string holds a carriage return. */
export function hasCarriageReturn(text: string): boolean {
  return text.includes("\r");
}

/** Repair 5 for text segments: CR LF and lone CR become LF. */
export function normaliseLineEndings(text: string): string {
  return text.includes("\r") ? text.replaceAll("\r\n", "\n").replaceAll("\r", "\n") : text;
}

/**
 * Length of the string in UTF-8 bytes (the `text_bytes` columns of data-model.md 7.2), counted
 * without encoding it. A lone surrogate counts 3 bytes, which is what an encoder writes for U+FFFD.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
