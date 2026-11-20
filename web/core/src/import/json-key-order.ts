// The order of object keys as written in a JSON text (docs/import-rules.md W4).
//
// W4 breaks ties in the time order of a ChatGPT export by "the order of the keys in the JSON
// text". JSON.parse keeps that order, except that it moves keys that look like array indices
// ("0", "7", "12") to the front in numeric order; section 5 lists relying on that as a mistake.
// This reads the order back from the text for the `mapping` object of each conversation.

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/** What a container on the stack is. */
const ARRAY = 0;
const OBJECT = 1;
/** An element of the top-level array, or the top-level object itself. */
const CONVERSATION = 2;
/** The value of the key "mapping" of a conversation. */
const MAPPING = 3;

// Index of the quote that closes the string starting at `open`; the text length when none does.
function closingQuote(text: string, open: number): number {
  let index = open + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === QUOTE) return index;
    index += code === BACKSLASH ? 2 : 1;
  }
  return text.length;
}

// The value of the string literal text[open..close], quotes included.
function stringValue(text: string, open: number, close: number): string {
  const literal = text.slice(open, close + 1);
  if (!literal.includes("\\")) return literal.slice(1, -1);
  try {
    const value: unknown = JSON.parse(literal);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/**
 * For each conversation of a ChatGPT export, the keys of its `mapping` in the order of the
 * text: a key written twice stands where it was written first, and of several `mapping`
 * members the last one counts, as in JSON.parse. Conversations are numbered by their index
 * in the top-level array; a top-level object is conversation 0.
 *
 * `jsonText` must be a text JSON.parse accepted. One pass, no recursion: the depth of the
 * text only grows a list. The caller checks the keys against the parsed object before use.
 */
export function readMappingKeyOrders(jsonText: string): Map<number, string[]> {
  const orders = new Map<number, string[]>();
  const kinds: number[] = [];
  const expectsKey: boolean[] = [];
  let element = 0; // index of the current element of the top-level array
  let conversation = 0;
  let conversationKey = ""; // the key last read in the open conversation
  let keys: string[] = [];

  let index = 0;
  // Every pass moves `index` forward by at least one character.
  while (index < jsonText.length) {
    const code = jsonText.charCodeAt(index);
    const top = kinds.length - 1;
    if (code === QUOTE) {
      const close = closingQuote(jsonText, index);
      const kind = kinds[top];
      if (kind !== undefined && kind !== ARRAY && expectsKey[top] === true) {
        expectsKey[top] = false;
        if (kind === CONVERSATION) conversationKey = stringValue(jsonText, index, close);
        else if (kind === MAPPING) keys.push(stringValue(jsonText, index, close));
      }
      index = close + 1;
      continue;
    }
    if (code === OPEN_BRACE) {
      let kind = OBJECT;
      if (top === -1 || (top === 0 && kinds[0] === ARRAY)) {
        kind = CONVERSATION;
        conversation = top === -1 ? 0 : element;
        conversationKey = "";
      } else if (kinds[top] === CONVERSATION && conversationKey === "mapping") {
        kind = MAPPING;
        keys = [];
      }
      kinds.push(kind);
      expectsKey.push(true);
    } else if (code === OPEN_BRACKET) {
      kinds.push(ARRAY);
      expectsKey.push(false);
    } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
      if (kinds.pop() === MAPPING) orders.set(conversation, keys);
      expectsKey.pop();
    } else if (code === COMMA) {
      if (kinds[top] === ARRAY) {
        if (top === 0) element++;
      } else if (top >= 0) {
        expectsKey[top] = true;
      }
    }
    index++;
  }
  return orders;
}
