// Addresses of the screens (docs/design.md 4.4): /sessions, /sessions/<id> and /import, which
// is a dialog over the screen it was opened from. An address carries nothing but an opaque id.

import { useCallback, useEffect, useRef, useState } from "react";

export type Screen = { readonly name: "list" } | { readonly name: "detail"; readonly id: string };

export interface AppLocation {
  readonly screen: Screen;
  readonly importOpen: boolean;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIST: Screen = { name: "list" };

function screenOf(pathname: string): Screen {
  const match = /^\/sessions\/([^/]+)\/?$/.exec(pathname);
  const id = match?.[1];
  return id !== undefined && SESSION_ID.test(id) ? { name: "detail", id } : LIST;
}

export function pathOf(screen: Screen): string {
  return screen.name === "detail" ? `/sessions/${screen.id}` : "/sessions";
}

/** What a history entry remembers besides its address. */
interface EntryState {
  /** For /import: the address of the screen below the dialog. */
  readonly under?: string;
  /** The entry was reached from inside the app, so "back" leads to the screen it came from. */
  readonly inApp?: boolean;
}

function entryState(value: unknown): EntryState {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.under === "string" ? { under: record.under } : {}),
    ...(record.inApp === true ? { inApp: true } : {}),
  };
}

/** The location an address and its history entry stand for. Anything unknown is the list. */
export function parseLocation(pathname: string, state: unknown): AppLocation {
  if (/^\/import\/?$/.test(pathname)) {
    return { screen: screenOf(entryState(state).under ?? "/sessions"), importOpen: true };
  }
  return { screen: screenOf(pathname), importOpen: false };
}

export interface Navigation {
  readonly location: AppLocation;
  openSession(id: string): void;
  showList(): void;
  openImport(): void;
  closeImport(): void;
}

/**
 * The location of the app, kept in the browser's history so that Back closes the dialog and goes
 * up from a session to the list. `initialPath` is used where there is no window (tests).
 */
export function useNavigation(initialPath = "/sessions"): Navigation {
  const read = (): AppLocation =>
    typeof window === "undefined"
      ? parseLocation(initialPath, null)
      : parseLocation(window.location.pathname, window.history.state);
  const [location, setLocation] = useState<AppLocation>(read);
  const current = useRef(location);
  current.current = location;
  // True from the moment the app asks the browser to go back until the browser has done it, so
  // that a second request in between (a button and then the dialog's own close event) does not
  // go back twice.
  const leaving = useRef(false);

  useEffect(() => {
    const onPop = (): void => {
      leaving.current = false;
      setLocation(parseLocation(window.location.pathname, window.history.state));
    };
    window.addEventListener("popstate", onPop);
    // An address the app does not know becomes the list, without a new history entry.
    const here = parseLocation(window.location.pathname, window.history.state);
    const canonical = here.importOpen ? "/import" : pathOf(here.screen);
    if (window.location.pathname !== canonical) {
      window.history.replaceState(window.history.state, "", canonical);
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const back = useCallback((): void => {
    leaving.current = true;
    window.history.back();
  }, []);

  const go = useCallback((path: string, state: EntryState, replace: boolean): void => {
    if (replace) window.history.replaceState(state, "", path);
    else window.history.pushState(state, "", path);
    setLocation(parseLocation(path, state));
  }, []);

  const openSession = useCallback(
    (id: string): void => {
      if (!SESSION_ID.test(id) || leaving.current) return;
      const now = current.current;
      if (now.screen.name === "detail" && now.screen.id === id && !now.importOpen) return;
      // From the list a new entry, so that Back returns to it; from another session the entry is
      // replaced, so that Back does not walk through every session that was looked at.
      const fromDetail = now.screen.name === "detail" && !now.importOpen;
      const state = fromDetail ? entryState(window.history.state) : { inApp: true };
      go(`/sessions/${id}`, state, fromDetail);
    },
    [go],
  );

  const showList = useCallback((): void => {
    const now = current.current;
    if (leaving.current || (now.screen.name === "list" && !now.importOpen)) return;
    if (!now.importOpen && entryState(window.history.state).inApp === true) back();
    else go("/sessions", {}, true);
  }, [go, back]);

  const openImport = useCallback((): void => {
    const now = current.current;
    if (now.importOpen || leaving.current) return;
    go("/import", { under: pathOf(now.screen), inApp: true }, false);
  }, [go]);

  const closeImport = useCallback((): void => {
    const now = current.current;
    if (!now.importOpen || leaving.current) return;
    if (entryState(window.history.state).inApp === true) back();
    else go(pathOf(now.screen), {}, true);
  }, [go, back]);

  return { location, openSession, showList, openImport, closeImport };
}
