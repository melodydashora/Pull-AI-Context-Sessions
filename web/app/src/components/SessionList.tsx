// The session list (docs/design.md 4.5.3, 4.6.3 and 4.10): a header with the filter title, the
// Import button and the search field, then one row per session, or an empty state.

import type { VaultSession } from "@sessionvault/core";
import { summaryLine } from "@sessionvault/core/display";
import { Import, Inbox, Pin, Search } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { fullDateTime, providerId, relativeTime, shownTitle, turnsLabel } from "../format.ts";
import { EmptyState, IconButton, ProviderChip } from "./controls.tsx";

/** A click that should open the session here, not a new tab or a download. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function SessionRow({
  session,
  selected,
  now,
  onOpen,
}: {
  session: VaultSession;
  selected: boolean;
  now: Date;
  onOpen: (id: string) => void;
}) {
  const summary = summaryLine(session.summary);
  return (
    <li className="rows__item">
      <a
        className="row"
        href={`/sessions/${session.id}`}
        aria-current={selected ? "page" : undefined}
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          onOpen(session.id);
        }}
      >
        <span className="row__top">
          <ProviderChip provider={providerId(session.provider)} />
          {session.is_pinned ? (
            <span className="row__pin">
              <Pin size={14} fill="currentColor" aria-hidden="true" />
              <span className="visually-hidden">Pinned</span>
            </span>
          ) : null}
        </span>
        <span className="row__title" dir="auto">
          {shownTitle(session.title)}
        </span>
        {summary !== "" ? (
          <span className="row__summary" dir="auto">
            {summary}
          </span>
        ) : null}
        <span className="row__meta">
          <time dateTime={session.imported_at.toISOString()} title={fullDateTime(session.imported_at)}>
            {relativeTime(session.imported_at, now)}
          </time>
          {" · "}
          {turnsLabel(session.message_count)}
        </span>
        {session.tags.length > 0 ? (
          <span className="row__tags" dir="auto">
            {session.tags.map((tag) => `#${tag}`).join("  ")}
          </span>
        ) : null}
      </a>
    </li>
  );
}

export function SessionList({
  sessions,
  total,
  query,
  onQuery,
  selectedId,
  now,
  onOpen,
  onImport,
  notice,
  footer,
}: {
  /** The sessions to show: already filtered, searched and in list order. */
  sessions: readonly VaultSession[];
  /** How many sessions the vault holds, whatever the search. */
  total: number;
  query: string;
  onQuery: (value: string) => void;
  selectedId: string | null;
  now: Date;
  onOpen: (id: string) => void;
  onImport: () => void;
  notice?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <nav className="list-pane" aria-label="Sessions">
      <header className="list-header">
        <div className="list-header__row">
          <h1 className="list-header__title" tabIndex={-1}>
            All Sessions
          </h1>
          <IconButton label="Import" icon={Import} onClick={onImport} />
        </div>
        <label className="search">
          <Search size={16} aria-hidden="true" className="search__icon" />
          <span className="visually-hidden">Search</span>
          <input
            className="search__field"
            type="search"
            value={query}
            placeholder="Search titles, summaries, tags"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query !== "") {
                event.preventDefault();
                onQuery("");
              }
            }}
          />
        </label>
      </header>
      {notice ?? null}
      {sessions.length > 0 ? (
        <ul className="rows">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === selectedId}
              now={now}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : total === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Your Vault Is Empty"
          description="Save AI conversations two ways: share or paste a conversation, or import .md / .json / .txt transcript files."
          action={
            <button type="button" className="button button--primary" onClick={onImport}>
              Import
            </button>
          }
        />
      ) : (
        <EmptyState
          icon={Search}
          title={`No Results for "${query.trim()}"`}
          description="Check the spelling or try a new search."
        />
      )}
      {footer ?? null}
    </nav>
  );
}
