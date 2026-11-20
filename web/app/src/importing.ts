// What an import does to a vault, as pure functions over the core module: no DOM, no clock of
// its own. A file goes through openFile (a transcript or a vault file), pasted text through
// importPaste (docs/import-rules.md W11). Nothing here is saved anywhere: the vault is a value.

import {
  addParsedSessions,
  type DocumentImportCounts,
  type ImportFlag,
  importDocument,
  importPaste,
  openFile,
  type Provider,
  type RejectReason,
  type Vault,
  type VaultSession,
} from "@sessionvault/core";

/** The Apple constant: the title the parsers get for pasted text (import-rules.md W11). */
export const PASTE_TITLE = "Pasted session";

export interface ImportClock {
  readonly now: () => Date;
  readonly newId: () => string;
}

export type FileReport =
  | {
      readonly kind: "sessions";
      readonly file: string;
      readonly sessions: readonly VaultSession[];
      readonly flags: readonly ImportFlag[];
    }
  | {
      readonly kind: "vault";
      readonly file: string;
      readonly counts: DocumentImportCounts;
      readonly flags: readonly ImportFlag[];
    }
  | {
      readonly kind: "rejected";
      readonly file: string;
      readonly reason: RejectReason;
      readonly flags: readonly ImportFlag[];
    }
  /** A vault file that the reader refuses as a whole. `message` is the reader's, and quotes no value of the file. */
  | { readonly kind: "refused"; readonly file: string; readonly message: string };

export interface FileImport {
  readonly vault: Vault;
  readonly report: FileReport;
}

/**
 * Import the bytes of one picked or dropped file. `asPlainText` is the answer "Keep as a Note"
 * to a `.json` file that is no known export (import-rules.md W3).
 */
export function importOneFile(
  vault: Vault,
  bytes: Uint8Array,
  file: string,
  clock: ImportClock,
  asPlainText = false,
): FileImport {
  const opened = openFile(bytes, file, asPlainText ? { asPlainText: true } : {});
  if (opened.route === "interchange") {
    const merged = importDocument(vault, opened.json, { now: clock.now(), newId: clock.newId });
    if (!merged.ok) {
      const first = merged.problems.items[0];
      return {
        vault,
        report: { kind: "refused", file, message: first?.message ?? "The file is not a valid vault file." },
      };
    }
    return {
      vault: merged.vault,
      report: { kind: "vault", file, counts: merged.report.counts, flags: opened.flags },
    };
  }
  const result = opened.result;
  if (result.outcome === "rejected") {
    return { vault, report: { kind: "rejected", file, reason: result.reason, flags: result.flags } };
  }
  const added = addParsedSessions(vault, result.sessions, { now: clock.now(), newId: clock.newId });
  return {
    vault: added.vault,
    report: { kind: "sessions", file, sessions: added.sessions, flags: result.flags },
  };
}

export type PasteReport =
  | { readonly kind: "sessions"; readonly sessions: readonly VaultSession[] }
  /** The text was only a link: nothing is imported, the link goes into the link field. */
  | { readonly kind: "link"; readonly link: string }
  | { readonly kind: "rejected"; readonly reason: RejectReason };

export interface PasteImport {
  readonly vault: Vault;
  readonly report: PasteReport;
}

export interface PasteChoices {
  /** The provider picker: it labels only pastes that cannot be identified. */
  readonly provider: Provider;
  /** The link the text was copied from, when the link field holds one. */
  readonly sourceUrl: string | null;
  /** The answer "Save Anyway" to the warning about a sign-in or landing page. */
  readonly allowWall: boolean;
}

/** Import pasted text. */
export function importPastedText(
  vault: Vault,
  text: string,
  choices: PasteChoices,
  clock: ImportClock,
): PasteImport {
  const result = importPaste(text, {
    title: PASTE_TITLE,
    pickerProvider: choices.provider,
    ...(choices.sourceUrl === null ? {} : { sourceUrl: choices.sourceUrl }),
    ...(choices.allowWall ? { allowWall: true } : {}),
  });
  if (result.outcome === "link") return { vault, report: { kind: "link", link: result.linkUrl } };
  if (result.outcome === "rejected") return { vault, report: { kind: "rejected", reason: result.reason } };
  const added = addParsedSessions(vault, result.sessions, { now: clock.now(), newId: clock.newId });
  return { vault: added.vault, report: { kind: "sessions", sessions: added.sessions } };
}

/** The first lines of a text for the review block: at most 12 lines and 600 characters (design.md 4.6.6). */
export function reviewPreview(text: string): string {
  const normal = text.slice(0, 4000).replace(/\r\n?/g, "\n");
  const lines = normal.split("\n").slice(0, 12).join("\n");
  return lines.length > 600 ? lines.slice(0, 600) : lines;
}
