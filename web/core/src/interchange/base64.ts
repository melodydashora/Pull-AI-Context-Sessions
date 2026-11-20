// Standard base64 (RFC 4648 section 4) for attachment bytes (data-model.md 6.4), written by hand
// so that the same code runs in a browser, in a worker and in Node.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PAD = 61; // "="

/** Value of each character code below 128, or -1 when the character is not in the alphabet. */
const VALUES: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

function valueAt(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return code < 128 ? (VALUES[code] ?? -1) : -1;
}

/** Character code of each of the 64 values. */
const CODES: Uint8Array = Uint8Array.from(ALPHABET, (character) => character.charCodeAt(0));

/** Characters built per piece: 2048 groups of four. Small enough to pass as arguments in one call. */
const PIECE = 8192;

/** Bytes to base64 with padding and without line breaks: the form a writer must emit. */
export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const piece = new Uint8Array(PIECE);
  let at = 0;
  const put = (value: number): void => {
    piece[at] = CODES[value & 63] ?? PAD;
    at += 1;
  };
  const whole = bytes.length - (bytes.length % 3);
  for (let i = 0; i < whole; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    put(n >>> 18);
    put(n >>> 12);
    put(n >>> 6);
    put(n);
    if (at === PIECE) {
      parts.push(String.fromCharCode(...piece));
      at = 0;
    }
  }
  // After a full piece `at` is 0, so the last group and its padding always fit.
  const rest = bytes.length - whole;
  if (rest > 0) {
    const n = ((bytes[whole] ?? 0) << 16) | ((bytes[whole + 1] ?? 0) << 8);
    put(n >>> 18);
    put(n >>> 12);
    if (rest === 2) put(n >>> 6);
    else {
      piece[at] = PAD;
      at += 1;
    }
    piece[at] = PAD;
    at += 1;
  }
  if (at > 0) parts.push(String.fromCharCode(...piece.subarray(0, at)));
  return parts.join("");
}

/**
 * Base64 to bytes, or null when the text cannot be decoded. corrections.md 2, point 7: a reader
 * accepts padding as optional. Accepted are only the characters A-Z a-z 0-9 + /, then at most two
 * "="; without the "=" the length is not 1 modulo 4. White space, line breaks and the URL-safe
 * alphabet are refused. Whether the "=" complete a group of four is not asked, and unused bits in
 * the last character are ignored: length and hash judge the bytes (R5).
 */
export function decodeBase64(text: string): Uint8Array | null {
  let end = text.length;
  let padding = 0;
  while (padding < 2 && end > 0 && text.charCodeAt(end - 1) === PAD) {
    end -= 1;
    padding += 1;
  }
  const rest = end % 4;
  if (rest === 1) return null;
  const whole = end - rest;
  const out = new Uint8Array((whole / 4) * 3 + (rest === 0 ? 0 : rest - 1));
  let at = 0;
  for (let i = 0; i < whole; i += 4) {
    const a = valueAt(text, i);
    const b = valueAt(text, i + 1);
    const c = valueAt(text, i + 2);
    const d = valueAt(text, i + 3);
    if ((a | b | c | d) < 0) return null;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[at] = n >>> 16;
    out[at + 1] = (n >>> 8) & 255;
    out[at + 2] = n & 255;
    at += 3;
  }
  if (rest >= 2) {
    const a = valueAt(text, whole);
    const b = valueAt(text, whole + 1);
    const c = rest === 3 ? valueAt(text, whole + 2) : 0;
    if ((a | b | c) < 0) return null;
    const n = (a << 18) | (b << 12) | (c << 6);
    out[at] = n >>> 16;
    if (rest === 3) out[at + 1] = (n >>> 8) & 255;
  }
  return out;
}
