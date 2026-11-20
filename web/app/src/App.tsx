// The app as it stands before accounts exist: a vault that lives in this browser tab only.
// A conversation gets in through Import (a file, or pasted text), is shown with the display
// rules of docs/design.md 4.7, and its context gets out as a context pack. Nothing is sent
// anywhere and nothing is saved: reloading the page empties the vault. Sign-in and the saved
// vault come with phase 2 of docs/../HANDOFF.md; these screens stay.

import { APP_NAME, emptyVault, formatBuildLabel, listSessions, type Vault } from "@sessionvault/core";
import { Info, MessagesSquare, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUILD } from "./build.ts";
import { EmptyState } from "./components/controls.tsx";
import { type ImportActions, ImportPanel } from "./components/ImportPanel.tsx";
import { SessionDetail } from "./components/SessionDetail.tsx";
import { SessionList } from "./components/SessionList.tsx";
import { type ImportClock, importOneFile, importPastedText } from "./importing.ts";
import { useNavigation } from "./route.ts";

const COPY_REFUSED = "Couldn't copy. Your browser blocked clipboard access.";

const CLOCK: ImportClock = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

/** The current time, refreshed so that "3 minutes ago" stays true (design.md 4.6.3). */
function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(handle);
  }, [everyMs]);
  return now;
}

/** Whether a drag carries files, as opposed to selected text or a link. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes("Files");
}

export function App({ initialPath }: { initialPath?: string }) {
  const navigation = useNavigation(initialPath);
  const { location, openSession, showList, openImport, closeImport } = navigation;

  // The vault is a value. The ref holds the newest one, so that an import can read it and say
  // what it created in the same step.
  const [vault, setVault] = useState<Vault>(emptyVault);
  const newest = useRef(vault);
  const commit = useCallback((next: Vault): void => {
    newest.current = next;
    setVault(next);
  }, []);

  const actions = useMemo<ImportActions>(
    () => ({
      importFile: (file) => {
        const done = importOneFile(newest.current, file.bytes, file.name, CLOCK);
        commit(done.vault);
        return done.report;
      },
      importFileAsNote: (file) => {
        const done = importOneFile(newest.current, file.bytes, file.name, CLOCK, true);
        commit(done.vault);
        return done.report;
      },
      importPaste: (text, choices) => {
        const done = importPastedText(newest.current, text, choices, CLOCK);
        commit(done.vault);
        return done.report;
      },
    }),
    [commit],
  );

  const [query, setQuery] = useState("");
  const now = useNow(60_000);
  const listed = useMemo(() => listSessions(vault.sessions, { kind: "all" }, query), [vault.sessions, query]);
  const selectedId = location.screen.name === "detail" ? location.screen.id : null;
  const selected =
    selectedId === null ? undefined : vault.sessions.find((session) => session.id === selectedId);

  // A short message that floats over the page and goes away by itself.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (toast === null) return;
    const handle = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(handle);
  }, [toast]);
  const copyFailed = useCallback((): void => setToast(COPY_REFUSED), []);

  // "Open" in the import panel: the panel closes first, then the session is shown.
  const openAfterClose = useRef<string | null>(null);
  const openFromImport = useCallback(
    (id: string): void => {
      openAfterClose.current = id;
      closeImport();
    },
    [closeImport],
  );
  useEffect(() => {
    const id = openAfterClose.current;
    if (location.importOpen || id === null) return;
    openAfterClose.current = null;
    openSession(id);
  }, [location.importOpen, openSession]);

  // Files dragged onto the window are imported (design.md 4.8.4; web-platform.md 6.3). Without
  // preventDefault the browser would leave the app and show the dropped file instead.
  const [dropped, setDropped] = useState<readonly File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const over = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      setDropped(files);
      openImport();
    };
    window.addEventListener("dragenter", over);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", over);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [openImport]);
  const droppedTaken = useCallback((): void => setDropped(null), []);

  return (
    <div className="shell" data-screen={location.screen.name}>
      <SessionList
        sessions={listed}
        total={vault.sessions.length}
        query={query}
        onQuery={setQuery}
        selectedId={selectedId}
        now={now}
        onOpen={openSession}
        onImport={openImport}
        notice={
          <p className="notice">
            <Info size={16} aria-hidden="true" />
            <span>
              Preview version: sessions stay in this browser tab only and are gone when the page is reloaded.
              Nothing is sent anywhere.
            </span>
          </p>
        }
        footer={
          <p className="build">
            <span className="visually-hidden">{APP_NAME}: </span>
            {formatBuildLabel(BUILD)}
          </p>
        }
      />
      <main className="detail-pane">
        {selected !== undefined ? (
          <SessionDetail key={selected.id} session={selected} onBack={showList} onCopyFailed={copyFailed} />
        ) : selectedId !== null ? (
          <EmptyState
            icon={TriangleAlert}
            title="Session Not Found"
            description="It may have been deleted on another device."
            action={
              <button type="button" className="button" onClick={showList}>
                All Sessions
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title="No Session Selected"
            description="Import a session or pick one from the list."
          />
        )}
      </main>
      <ImportPanel
        open={location.importOpen}
        onRequestClose={closeImport}
        actions={actions}
        onOpenSession={openFromImport}
        dropped={dropped}
        onDroppedTaken={droppedTaken}
      />
      {dragging ? (
        <div className="drop-overlay" aria-hidden="true">
          <p className="drop-overlay__text">Drop transcript files to import</p>
        </div>
      ) : null}
      <div className="toast-region" role="status" aria-live="polite">
        {toast !== null ? <p className="toast">{toast}</p> : null}
      </div>
    </div>
  );
}
