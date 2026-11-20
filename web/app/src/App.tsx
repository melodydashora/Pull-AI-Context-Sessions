// The app as it stands before accounts exist: a vault that lives in this browser tab only.
// A conversation gets in through Import (a file, or pasted text), is shown with the display
// rules of docs/design.md 4.7, and its context gets out as a context pack. Nothing is sent
// anywhere and nothing is saved: reloading the page empties the vault. Sign-in and the saved
// vault come with phase 2 of docs/../HANDOFF.md; these screens stay.

import { APP_NAME, emptyVault, formatBuildLabel, listSessions, type Vault } from "@sessionvault/core";
import { Info, MessagesSquare, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

  // The session that is open, or the one that was open last. The list is windowed, and the row of
  // this session stays in the page wherever the list is scrolled to.
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  if (selectedId !== null && selectedId !== lastOpened) setLastOpened(selectedId);

  // On a small window the list and the open session are one screen at a time and share the
  // scroll position of the page (app.css). A session opens at its top, and the list comes back
  // where it was (design.md 4.4). The browser's own restoring is switched off: it would run after
  // the screen has changed, on a page of another height.
  const shell = useRef<HTMLDivElement>(null);
  const detailPane = useRef<HTMLElement>(null);
  const listScroll = useRef(0);
  const shownScreen = useRef(location.screen.name);
  useEffect(() => {
    window.history.scrollRestoration = "manual";
    const remember = (): void => {
      if (shownScreen.current === "list") listScroll.current = window.scrollY;
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, []);

  // Leaving a session for the list: the focus goes to the row of that session, or to the title
  // of the list if the row is not there, instead of being lost on the page.
  const left = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = left.current;
    left.current = selectedId;
    shownScreen.current = selectedId === null ? "list" : "detail";
    if (before === selectedId) return;
    const oneScreen = shell.current !== null && window.getComputedStyle(shell.current).display === "block";
    if (selectedId !== null) {
      // Another session: it is shown from its top.
      if (oneScreen) window.scrollTo(0, 0);
      else detailPane.current?.scrollTo(0, 0);
      return;
    }
    if (oneScreen) {
      window.scrollTo(0, listScroll.current);
      // The list hears of it now, not a frame later, and draws the rows of that place before the
      // browser paints.
      document.dispatchEvent(new Event("scroll"));
    }
    if (before === null) return;
    const row = [...document.querySelectorAll<HTMLElement>("a.row")].find(
      (link) => link.getAttribute("href") === `/sessions/${before}`,
    );
    (row ?? document.querySelector<HTMLElement>(".list-header__title"))?.focus();
  }, [selectedId]);

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
  // An open modal dialog is drawn above everything else in the page, so while Import is open the
  // hint is drawn inside the dialog.
  const dropHint = dragging ? (
    <div className="drop-overlay" aria-hidden="true">
      <p className="drop-overlay__text">Drop transcript files to import</p>
    </div>
  ) : null;

  return (
    <div ref={shell} className="shell" data-screen={location.screen.name}>
      <SessionList
        sessions={listed}
        total={vault.sessions.length}
        query={query}
        onQuery={setQuery}
        selectedId={selectedId}
        keepId={selectedId ?? lastOpened}
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
      <main ref={detailPane} className="detail-pane">
        {selected !== undefined ? (
          <SessionDetail key={selected.id} session={selected} onBack={showList} onCopyFailed={copyFailed} />
        ) : selectedId !== null ? (
          <EmptyState
            icon={TriangleAlert}
            title="Session Not Found"
            description="Until accounts exist, the vault is kept in this tab only: it starts empty after a reload."
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
        overlay={location.importOpen ? dropHint : null}
      />
      {location.importOpen ? null : dropHint}
      <div className="toast-region" role="status" aria-live="polite">
        {toast !== null ? <p className="toast">{toast}</p> : null}
      </div>
    </div>
  );
}
