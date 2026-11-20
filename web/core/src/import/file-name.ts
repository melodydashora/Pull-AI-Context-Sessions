// File names (docs/import-rules.md 2.1): the format is decided by the extension alone (C2),
// and the name without its extension is the fallback title.

export interface FileNameParts {
  /** The name without its extension: the title the text parsers are given. */
  readonly stem: string;
  /** The extension without the dot, in the letter case of the name; "" when there is none. */
  readonly extension: string;
}

/**
 * 2.1, as `NSString.pathExtension` and `deletingPathExtension`: the extension is the text after
 * the last dot, provided the dot is not the first character and the text after it is not empty
 * and contains no space. `.notes`, `name.` and `Mr. Smith notes` have none.
 */
export function splitFileName(filename: string): FileNameParts {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { stem: filename, extension: "" };
  const extension = filename.slice(dot + 1);
  if (extension === "" || extension.includes(" ")) return { stem: filename, extension: "" };
  return { stem: filename.slice(0, dot), extension };
}
