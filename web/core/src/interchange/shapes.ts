// The `pattern` keywords of docs/interchange-schema-v1.json as predicates.
//
// A regular expression is used only where the length of the string is checked first or where it
// looks at one character at a time; everything that could meet a string of megabytes is a plain
// scan. schema.test.ts compares every predicate with the schema's own pattern.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const UUID_ANY_CASE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA256_ANY_CASE = /^[0-9a-fA-F]{64}$/u;
const NON_WHITE_SPACE = /[^\s]/u;

/** definitions.uuid: canonical lower-case form, any UUID version. */
export function isCanonicalUuid(text: string): boolean {
  return text.length === 36 && UUID.test(text);
}

/** A UUID written with letters of either case: what repair 1 lower-cases. */
export function isUuidOfAnyCase(text: string): boolean {
  return text.length === 36 && UUID_ANY_CASE.test(text);
}

/** definitions.sha256: 64 lower-case hexadecimal characters. */
export function isSha256Hex(text: string): boolean {
  return text.length === 64 && SHA256.test(text);
}

/** A SHA-256 written with letters of either case: what repair 1 lower-cases (corrections.md 2, point 5). */
export function isSha256HexOfAnyCase(text: string): boolean {
  return text.length === 64 && SHA256_ANY_CASE.test(text);
}

/** project.name: holds at least one character that is not white space. */
export function hasVisibleCharacter(text: string): boolean {
  return NON_WHITE_SPACE.test(text);
}

/** session.tags items: not empty and without a comma. */
export function hasTagShape(text: string): boolean {
  return text.length > 0 && !text.includes(",");
}

function isMediaTypeCharacter(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x21 || // !
    code === 0x23 || // #
    code === 0x24 || // $
    code === 0x26 || // &
    code === 0x5e || // ^
    code === 0x5f || // _
    code === 0x2e || // .
    code === 0x2b || // +
    code === 0x2d // -
  );
}

/** attachment.media_type: lower-case "type/subtype" without parameters. */
export function hasMediaTypeShape(text: string): boolean {
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) return false;
  for (let i = 0; i < text.length; i++) {
    if (i !== slash && !isMediaTypeCharacter(text.charCodeAt(i))) return false;
  }
  return true;
}

/** attachment.filename: no slash and no backslash. */
export function hasFilenameShape(text: string): boolean {
  return !text.includes("/") && !text.includes("\\");
}

function isBase64Character(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x2b || // +
    code === 0x2f // /
  );
}

/** attachment.data_base64: base64 characters, then at most two "=". */
export function hasBase64Shape(text: string): boolean {
  let end = text.length;
  for (let padding = 0; padding < 2 && end > 0 && text.charCodeAt(end - 1) === 0x3d; padding++) end -= 1;
  for (let i = 0; i < end; i++) {
    if (!isBase64Character(text.charCodeAt(i))) return false;
  }
  return true;
}
