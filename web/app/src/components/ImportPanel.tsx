// Import Sessions (docs/design.md 4.5.6 and 4.6.6): From Link, From Files, From Clipboard, one
// status line that each new result replaces, and "Done". A dialog on wide screens, a full page on
// narrow ones. Files and pasted text are parsed in the browser (corrections.md 1.6.1).
//
// Not in this version: "Capture Transcript" (the server-side capture of a share link comes
// with phase 3), and parsing in a worker; a file above 50 MB is refused instead.

import { looksLikeLink, type Provider } from "@sessionvault/core";
import {
  Clipboard,
  ClipboardPaste,
  Compass,
  ExternalLink,
  Folder,
  Info,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fileRejectedMessage,
  fileRejectedShort,
  flagMessage,
  importedMessage,
  linkHost,
  PROVIDER_IDS,
  pastedSummary,
  pasteRejectedMessage,
  providerName,
  vaultFileMessage,
} from "../format.ts";
import { type FileReport, type PasteChoices, type PasteReport, reviewPreview } from "../importing.ts";
import { IconButton, type Status, StatusNotice } from "./controls.tsx";

export interface PickedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface ImportActions {
  /** Import one file as one batch and say what came of it. */
  importFile(file: PickedFile): FileReport;
  /** "Keep as a Note": import the text of a `.json` file that is no known export, as it is. */
  importFileAsNote(file: PickedFile): FileReport;
  importPaste(text: string, choices: PasteChoices): PasteReport;
}

/** Larger files are refused in this version: they would be parsed on the page's own thread. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPT = ".md,.markdown,.txt,.json,text/plain,text/markdown,application/json";

/** How many sessions a file added to the vault: its transcripts, or what a vault file added. */
function sessionsOf(report: FileReport): number {
  if (report.kind === "sessions") return report.sessions.length;
  return report.kind === "vault" ? report.counts.added : 0;
}

function fileLine(report: FileReport): string {
  switch (report.kind) {
    case "sessions":
      return `${report.file}: ${report.sessions.length === 1 ? "1 session" : `${report.sessions.length} sessions`}`;
    case "vault":
      return vaultFileMessage(report.file, report.counts);
    case "rejected":
      return `${report.file}: ${fileRejectedShort(report.reason)}`;
    default:
      return `${report.file}: ${report.message}`;
  }
}

function notesOf(report: FileReport): string[] {
  return report.kind === "refused" ? [] : report.flags.map((flag) => flagMessage(report.file, flag));
}

/** The one session an import created, when it created exactly one. */
function onlySession(reports: readonly FileReport[]): string | null {
  const created = reports.flatMap((report) => (report.kind === "sessions" ? report.sessions : []));
  const only = created.length === 1 ? created[0] : undefined;
  return only === undefined ? null : only.id;
}

export function ImportPanel({
  open,
  onRequestClose,
  actions,
  onOpenSession,
  dropped,
  onDroppedTaken,
}: {
  open: boolean;
  onRequestClose: () => void;
  actions: ImportActions;
  /** Close the panel and show this session. */
  onOpenSession: (id: string) => void;
  /** Files dropped on the window: imported as soon as the panel is open. */
  dropped: readonly File[] | null;
  onDroppedTaken: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const pasteBox = useRef<HTMLTextAreaElement>(null);
  const unknownJson = useRef<PickedFile | null>(null);

  const [link, setLink] = useState("");
  const [provider, setProvider] = useState<Provider>("claude");
  const [typed, setTyped] = useState("");
  /** Pasted text, kept in memory and never put into the field (design.md 4.6.6). */
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [review, setReview] = useState<{ text: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const sourceUrl = looksLikeLink(link);
  const sourceHost = sourceUrl === null ? null : linkHost(sourceUrl);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      setStatus(null);
      setReview(null);
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const openAction = useCallback(
    (id: string | null): Status["action"] | undefined =>
      id === null ? undefined : { label: "Open", run: () => onOpenSession(id) },
    [onOpenSession],
  );

  const statusForFiles = useCallback(
    (reports: readonly FileReport[]): Status => {
      const action = openAction(onlySession(reports));
      const notes = reports.flatMap(notesOf);
      const only = reports.length === 1 ? reports[0] : undefined;
      if (only !== undefined) {
        const details = notes.length > 0 ? { details: notes } : {};
        switch (only.kind) {
          case "sessions":
            return {
              kind: "success",
              text: importedMessage(only.sessions.length, "files"),
              ...details,
              ...(action === undefined ? {} : { action }),
            };
          case "vault":
            return { kind: "success", text: vaultFileMessage(only.file, only.counts), ...details };
          case "rejected": {
            const kept = unknownJson.current;
            return {
              kind: "error",
              text: fileRejectedMessage(only.file, only.reason),
              ...details,
              ...(only.reason === "unrecognised_json" && kept !== null
                ? {
                    action: {
                      label: "Keep as a Note",
                      run: () => {
                        unknownJson.current = null;
                        setStatus(statusForFiles([actions.importFileAsNote(kept)]));
                      },
                    },
                  }
                : {}),
            };
          }
          default:
            return { kind: "error", text: `${only.file} can't be imported. ${only.message}` };
        }
      }
      const sessions = reports.reduce((sum, report) => sum + sessionsOf(report), 0);
      const vaultFiles = reports.filter((report) => report.kind === "vault").length;
      const failed = reports.filter(
        (report) => report.kind === "rejected" || report.kind === "refused",
      ).length;
      const text =
        sessions > 0
          ? importedMessage(sessions, "files")
          : vaultFiles > 0
            ? vaultFiles === 1
              ? "Imported 1 vault file."
              : `Imported ${vaultFiles} vault files.`
            : "No sessions found in the selected files.";
      return {
        kind: failed === 0 ? "success" : sessions > 0 || vaultFiles > 0 ? "warning" : "error",
        text,
        details: [...reports.map(fileLine), ...notes],
        ...(action === undefined ? {} : { action }),
      };
    },
    [actions, openAction],
  );

  const runFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (files.length === 0) return;
      setBusy(true);
      setReview(null);
      unknownJson.current = null;
      const reports: FileReport[] = [];
      let index = 0;
      for (const file of files) {
        index += 1;
        setStatus({ kind: "progress", text: `Importing ${index} of ${files.length}…` });
        if (file.size > MAX_FILE_BYTES) {
          reports.push({
            kind: "refused",
            file: file.name,
            message: "It is larger than 50 MB, which this version does not import.",
          });
          continue;
        }
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await file.arrayBuffer());
        } catch {
          reports.push({ kind: "refused", file: file.name, message: "It could not be read." });
          continue;
        }
        const picked: PickedFile = { name: file.name, bytes };
        const report = actions.importFile(picked);
        if (report.kind === "rejected" && report.reason === "unrecognised_json" && files.length === 1) {
          unknownJson.current = picked;
        }
        reports.push(report);
      }
      setBusy(false);
      setStatus(statusForFiles(reports));
    },
    [actions, statusForFiles],
  );

  useEffect(() => {
    if (!open || dropped === null) return;
    onDroppedTaken();
    void runFiles(dropped);
  }, [open, dropped, onDroppedTaken, runFiles]);

  const takePaste = (text: string): void => {
    setPending(text);
    setTyped("");
    setReview(null);
    setStatus(null);
  };

  const clearPaste = (): void => {
    setPending(null);
    setTyped("");
    setReview(null);
  };

  const readClipboard = (): void => {
    const refuse = (): void => {
      pasteBox.current?.focus();
      setStatus({
        kind: "info",
        text: "Your browser didn't allow clipboard access. Paste into the box instead.",
      });
    };
    if (typeof navigator === "undefined" || navigator.clipboard?.readText === undefined) {
      refuse();
      return;
    }
    navigator.clipboard.readText().then((text) => {
      if (text === "") setStatus({ kind: "error", text: "Clipboard is empty." });
      else takePaste(text);
    }, refuse);
  };

  const runPaste = (text: string, allowWall: boolean): void => {
    const report = actions.importPaste(text, { provider, sourceUrl, allowWall });
    if (report.kind === "sessions") {
      clearPaste();
      const only = report.sessions.length === 1 ? report.sessions[0] : undefined;
      const action = openAction(only === undefined ? null : only.id);
      setStatus({
        kind: "success",
        text: importedMessage(report.sessions.length, "clipboard"),
        ...(action === undefined ? {} : { action }),
      });
    } else if (report.kind === "link") {
      clearPaste();
      setLink(report.link);
      setStatus({ kind: "info", text: "That's a link — it's now in the From Link field." });
      linkField.current?.focus();
    } else if (report.reason === "sign_in_suspected") {
      setStatus(null);
      setReview({ text, preview: reviewPreview(text) });
    } else {
      setStatus({ kind: "error", text: pasteRejectedMessage(report.reason) });
    }
  };

  const textToImport = pending ?? typed;
  return (
    <dialog
      ref={dialog}
      className="dialog dialog--import"
      aria-labelledby="import-title"
      onClose={onRequestClose}
    >
      <header className="dialog__header">
        <h2 id="import-title" className="dialog__title">
          Import Sessions
        </h2>
        <IconButton label="Close" icon={X} onClick={onRequestClose} />
      </header>
      <div className="dialog__body">
        <section className="import-section" aria-labelledby="import-link">
          <h3 id="import-link" className="import-section__title">
            <Compass size={16} aria-hidden="true" />
            From Link
          </h3>
          <input
            ref={linkField}
            className="field"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://claude.ai/share/…"
            aria-label="Link"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          {link.trim() !== "" && sourceUrl === null ? (
            <p className="help help--warning">
              <TriangleAlert size={16} aria-hidden="true" />
              That doesn't look like a link.
            </p>
          ) : null}
          {sourceUrl !== null ? (
            <p>
              <a className="button" href={sourceUrl} target="_blank" rel="noopener noreferrer">
                Open Link
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            </p>
          ) : null}
          <p className="help">
            Or open the link, copy the whole conversation and paste it below. The link is saved with it.
          </p>
        </section>

        <section className="import-section" aria-labelledby="import-files">
          <h3 id="import-files" className="import-section__title">
            <Folder size={16} aria-hidden="true" />
            From Files
          </h3>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            multiple
            accept={ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void runFiles(files);
            }}
          />
          <p>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Import .md / .json / .txt…
            </button>
          </p>
          <p className="help">
            Supports transcripts from Pull-AI-Context-Sessions, ChatGPT data exports (conversations.json), and
            plain markdown.
          </p>
          <p className="help help--pointer">Tip: you can also drag transcript files onto the window.</p>
        </section>

        <section className="import-section" aria-labelledby="import-clipboard">
          <h3 id="import-clipboard" className="import-section__title">
            <Clipboard size={16} aria-hidden="true" />
            From Clipboard
          </h3>
          <label className="field-row">
            <span className="field-label">Provider</span>
            <select
              className="field field--select"
              value={provider}
              onChange={(event) => {
                const chosen = PROVIDER_IDS.find((id) => id === event.target.value);
                if (chosen !== undefined) setProvider(chosen);
              }}
            >
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {providerName(id)}
                </option>
              ))}
            </select>
          </label>
          {pending === null ? (
            <textarea
              ref={pasteBox}
              className="field field--paste"
              rows={3}
              placeholder="Paste a transcript here"
              aria-label="Paste a transcript here"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text/plain");
                if (text === "") return;
                event.preventDefault();
                takePaste(text);
              }}
            />
          ) : (
            <p className="help help--info">
              <Info size={16} aria-hidden="true" />
              <span>
                {pastedSummary(pending)}
                {sourceHost !== null ? ` Source: ${sourceHost}` : ""}
              </span>
            </p>
          )}
          <p className="button-row">
            {textToImport !== "" ? (
              <>
                <button type="button" className="button" onClick={clearPaste}>
                  Clear
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => runPaste(textToImport, false)}
                >
                  Import Pasted Text
                </button>
              </>
            ) : (
              <button type="button" className="button" onClick={readClipboard}>
                <ClipboardPaste size={16} aria-hidden="true" />
                Paste Transcript
              </button>
            )}
          </p>
          <p className="help">
            The provider is detected from the transcript when possible. This picker only labels pastes that
            can't be identified.
          </p>
        </section>

        {review !== null ? (
          <section className="review" aria-label="Review before saving">
            <p className="review__warning">
              <TriangleAlert size={16} aria-hidden="true" />
              This looks like a sign-in or landing page, not a conversation.
            </p>
            <pre className="review__preview">{review.preview}</pre>
            <p className="button-row">
              <button type="button" className="button" onClick={clearPaste}>
                Discard
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => runPaste(review.text, true)}
              >
                Save Anyway
              </button>
            </p>
          </section>
        ) : status !== null ? (
          <StatusNotice status={status} />
        ) : null}
      </div>
      <footer className="dialog__footer">
        <button type="button" className="button button--primary" onClick={onRequestClose}>
          Done
        </button>
      </footer>
    </dialog>
  );
}
