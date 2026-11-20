// Bytes to text (docs/import-rules.md W2, C2). A browser hands over bytes, and File.text()
// would hide encoding problems, so the encoding is decided here, explicitly.

import { decodeText } from "./platform.ts";
import type { ImportFlag } from "./types.ts";

export interface DecodedText {
  /** The decoded text, not yet normalised (W1 comes next). */
  readonly text: string;
  /** The encoding that was assumed when it is not UTF-8; the user has to be told. */
  readonly flag: ImportFlag | null;
}

/** W2: how many leading bytes the test for UTF-16 without a byte-order mark looks at. */
const SAMPLE_BYTES = 4096;

type Utf16 = "utf-16le" | "utf-16be";

const UTF16_FLAG: Readonly<Record<Utf16, ImportFlag>> = {
  "utf-16le": "decoded_as_utf_16le",
  "utf-16be": "decoded_as_utf_16be",
};

// W2: mostly-Latin UTF-16 text has a zero in every second byte. Looks at the first
// min(length, 4096) bytes, rounded down to an even count, as pairs.
function utf16WithoutMark(bytes: Uint8Array): Utf16 | null {
  const sample = Math.min(bytes.length, SAMPLE_BYTES) & ~1;
  const pairs = sample / 2;
  // corrections.md 3, point 2: the test applies from two byte pairs on; one pair says nothing.
  if (pairs < 2) return null;
  let zeroFirst = 0;
  let zeroSecond = 0;
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i] === 0) zeroFirst++;
    if (bytes[i + 1] === 0) zeroSecond++;
  }
  // ">= 40 %" and "<= 5 %" in whole numbers, so that the two limits are exact.
  if (5 * zeroSecond >= 2 * pairs && 20 * zeroFirst <= pairs) return "utf-16le";
  if (5 * zeroFirst >= 2 * pairs && 20 * zeroSecond <= pairs) return "utf-16be";
  return null;
}

// W2: binary data has control bytes that text never has (allowed: 09, 0A, 0C, 0D).
function hasBinaryControlByte(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) return true;
  }
  return false;
}

function decodeUtf16(bytes: Uint8Array, encoding: Utf16): DecodedText | null {
  // corrections.md 3, point 1: UTF-16 is decoded leniently, and flagged. An odd last byte is
  // ignored: it is half a character. An unpaired surrogate becomes U+FFFD, which is what a
  // decoder that is not strict makes of it. The rule of W2 against such a decoder is about
  // UTF-8, where a failure is what tells UTF-8 from windows-1252.
  const pairs = bytes.length % 2 === 0 ? bytes : bytes.subarray(0, bytes.length - 1);
  const text = decodeText(pairs, encoding, false);
  return text === null ? null : { text, flag: UTF16_FLAG[encoding] };
}

/**
 * W2, in this order: a UTF-8 byte-order mark, a UTF-16 byte-order mark, UTF-16 without one,
 * strict UTF-8, refusal of binary data, windows-1252. A row applies when its decoding succeeds.
 * null: the bytes are not text (`undecodable`). Zero bytes give the empty text; `importFile`
 * rejects them as `empty_input` before it gets here.
 *
 * corrections.md 3, point 10: the text is returned as decoded, before W1. The decoder has
 * consumed one byte-order mark of its own encoding; a further mark, CR and U+0000 are still there.
 */
export function decodeBytes(bytes: Uint8Array): DecodedText | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const text = decodeText(bytes, "utf-8", true);
    if (text !== null) return { text, flag: null };
    // corrections.md 3, point 3: a UTF-8 mark followed by bytes that are not UTF-8 falls
    // through to the rows below with all its bytes, the three of the mark included.
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes, "utf-16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes, "utf-16be");
  const guessed = utf16WithoutMark(bytes);
  if (guessed !== null) return decodeUtf16(bytes, guessed);
  const utf8 = decodeText(bytes, "utf-8", true);
  if (utf8 !== null) return { text: utf8, flag: null };
  if (hasBinaryControlByte(bytes)) return null;
  const legacy = decodeText(bytes, "windows-1252", false); // every byte is a character: nothing is replaced
  return legacy === null ? null : { text: legacy, flag: "decoded_as_windows_1252" };
}
