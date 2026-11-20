// Copying text and saving it as a file. Both are called inside a click handler with text that
// is already in memory, so that no request sits between the click and the write
// (docs/web-platform.md 6.1, rule 5).

/**
 * Copy text to the clipboard. Resolves to false when the browser refuses.
 *
 * The clipboard interface comes first. Inside a frame it can be switched off by the page that
 * holds the frame (the preview pane of an editor, for example); then the older way is tried: a
 * text field that exists for a moment, is selected and copied. The text goes into the field's
 * value, never into markup.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused: try the older way below.
    }
  }
  return copyThroughSelection(text);
}

function copyThroughSelection(text: string): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  const field = document.createElement("textarea");
  field.className = "clipboard-helper";
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.tabIndex = -1;
  field.value = text;
  document.body.appendChild(field);
  let copied = false;
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    field.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  }
  return copied;
}

/** Save text as a file through the browser's download. The name must already be safe for a file system. */
export function downloadText(fileName: string, text: string, mediaType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mediaType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The browser has taken the address by now; give the memory back a little later.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
