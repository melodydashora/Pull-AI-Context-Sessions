// The session list (docs/design.md 4.5.3, 4.6.3 and 4.10): a header with the filter title, the
// Import button and the search field, then one row per session, or an empty state.
//
// The list is windowed (design.md 4.7.5): one import can add thousands of rows, and a page that
// holds them all stands still for seconds. The rows are cut into chunks of 50. A chunk near the
// visible part of the list is drawn; any other chunk is an empty element as high as the chunk was
// when it was last drawn, or 88 px per row until then. Three chunks are drawn wherever they are:
// the one with the open session, so that the focus can return to its row; the one that holds the
// keyboard focus; and whatever the last look found near. Which chunks are near is worked out
// again after every change of the list and whenever the list or the page is scrolled or resized
// (../windowing.ts has the arithmetic).

import type { VaultSession } from "@sessionvault/core";
import { summaryLine } from "@sessionvault/core/display";
import { Import, Inbox, Pin, Search } from "lucide-react";
import {
  type FocusEvent,
  type MouseEvent,
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fullDateTime, providerId, relativeTime, shownTitle, turnsLabel } from "../format.ts";
import {
  CHUNK_ROWS,
  type ChunkRange,
  chunkCount,
  chunkOfRow,
  chunksBetween,
  NEAR_MARGIN_PX,
  ROW_ESTIMATE_PX,
  rowsInChunk,
  sameRange,
} from "../windowing.ts";
import { EmptyState, IconButton, ProviderChip } from "./controls.tsx";

/** A click that should open the session here, not a new tab or a download. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function SessionRow({
  session,
  position,
  total,
  selected,
  now,
  onOpen,
}: {
  session: VaultSession;
  /** The place of the row in the whole list, from 1: not every row is in the page. */
  position: number;
  total: number;
  selected: boolean;
  now: Date;
  onOpen: (id: string) => void;
}) {
  const summary = summaryLine(session.summary);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the rows are grouped in chunks, which a <ul> may not hold; see Rows.
    <div className="rows__item" role="listitem" aria-setsize={total} aria-posinset={position}>
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
    </div>
  );
}

interface ChunkProps {
  index: number;
  /** The whole list; the chunk draws `count` rows of it from `start` on. */
  sessions: readonly VaultSession[];
  start: number;
  count: number;
  /** Null while the chunk is drawn. Otherwise the height of its empty place, in px. */
  placeHeight: number | null;
  selectedId: string | null;
  now: Date;
  onOpen: (id: string) => void;
}

/** A chunk that is not drawn shows nothing of the list, so only its place can change it. */
function sameChunk(before: ChunkProps, after: ChunkProps): boolean {
  if (before.index !== after.index || before.placeHeight !== after.placeHeight) return false;
  if (after.placeHeight !== null) return true;
  return (
    before.sessions === after.sessions &&
    before.start === after.start &&
    before.count === after.count &&
    before.selectedId === after.selectedId &&
    before.now === after.now &&
    before.onOpen === after.onOpen
  );
}

const RowChunk = memo(function RowChunk({
  index,
  sessions,
  start,
  count,
  placeHeight,
  selectedId,
  now,
  onOpen,
}: ChunkProps) {
  const element = useRef<HTMLDivElement>(null);
  // The one size in the app that only the page can know. It is written to the style object of the
  // element. The content security policy refuses a style attribute in markup and one set as an
  // attribute (docs/web-platform.md 11.4); a property set on the style object is allowed.
  useLayoutEffect(() => {
    const here = element.current;
    if (here === null) return;
    if (placeHeight === null) here.style.removeProperty("block-size");
    else here.style.setProperty("block-size", `${placeHeight}px`);
  }, [placeHeight]);
  return (
    <div ref={element} className="rows__chunk" role="presentation" data-chunk={index}>
      {placeHeight === null
        ? sessions
            .slice(start, start + count)
            .map((session, offset) => (
              <SessionRow
                key={session.id}
                session={session}
                position={start + offset + 1}
                total={sessions.length}
                selected={session.id === selectedId}
                now={now}
                onOpen={onOpen}
              />
            ))
        : null}
    </div>
  );
}, sameChunk);

/** The chunk an element of the list belongs to, or -1. */
function chunkOf(target: Element): number {
  const chunk = target.closest<HTMLElement>("[data-chunk]");
  const index = chunk === null ? Number.NaN : Number(chunk.dataset.chunk);
  return Number.isInteger(index) ? index : -1;
}

/** Only the first chunk, until the page has been looked at. */
const FIRST_CHUNK: ChunkRange = { first: 0, last: 0 };

function Rows({
  sessions,
  selectedId,
  keepId,
  query,
  now,
  onOpen,
  scroller,
}: {
  sessions: readonly VaultSession[];
  selectedId: string | null;
  keepId: string | null;
  query: string;
  now: Date;
  onOpen: (id: string) => void;
  /** The pane around the list. It scrolls on a wide window; on a small one the page scrolls. */
  scroller: { readonly current: HTMLElement | null };
}) {
  const list = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<ChunkRange>(FIRST_CHUNK);
  const [focused, setFocused] = useState(-1);
  const kept = useMemo(
    () => (keepId === null ? -1 : chunkOfRow(sessions.findIndex((session) => session.id === keepId))),
    [sessions, keepId],
  );

  // The heights that were measured belong to one list: another list has other rows in each chunk.
  const measured = useRef({ list: sessions, heights: new Map<number, number>() });
  if (measured.current.list !== sessions) {
    measured.current = { list: sessions, heights: new Map<number, number>() };
  }
  const heights = measured.current.heights;

  const total = sessions.length;
  const count = chunkCount(total);
  const isDrawn = (index: number): boolean =>
    (index >= near.first && index <= near.last) || index === kept || index === focused;
  const heightOf = (index: number): number =>
    heights.get(index) ?? rowsInChunk(total, index) * ROW_ESTIMATE_PX;

  // Look at the page: measure the chunks that are drawn, then work out which chunks are near the
  // visible part. On both layouts the visible part of the list lies inside the window, so the
  // window is what the list is compared with.
  const look = useRef<() => void>(() => {});
  look.current = () => {
    const here = list.current;
    if (here === null) return;
    const box = here.getBoundingClientRect();
    // On a small window the list is not shown while a session is open. What is drawn stays.
    if (box.width === 0 && box.height === 0) return;
    for (let index = 0; index < here.children.length; index++) {
      const chunk = here.children[index];
      // Only a chunk that is drawn has rows inside.
      if (chunk === undefined || chunk.childElementCount === 0) continue;
      const height = chunk.getBoundingClientRect().height;
      if (height > 0) heights.set(index, height);
    }
    const next = chunksBetween(
      count,
      heightOf,
      -NEAR_MARGIN_PX - box.top,
      window.innerHeight + NEAR_MARGIN_PX - box.top,
    );
    setNear((before) => (sameRange(before, next) ? before : next));
  };

  // After every change of the list, before the browser paints: a search shows its results from
  // the top, and the chunks that are near now are drawn in the same step.
  const lastQuery = useRef(query);
  useLayoutEffect(() => {
    if (lastQuery.current !== query) {
      lastQuery.current = query;
      const pane = scroller.current;
      if (pane !== null && window.getComputedStyle(pane).overflowY !== "visible") pane.scrollTop = 0;
      else window.scrollTo(0, 0);
    }
    look.current();
  });

  useEffect(() => {
    const run = (): void => look.current();
    // A scroll event does not bubble, so it is caught on its way down: the page's own and the pane's.
    const onScroll = (event: Event): void => {
      if (event.target === document || event.target === scroller.current) run();
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", run);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", run);
    };
  }, [scroller]);

  const chunks: ReactNode[] = [];
  for (let index = 0; index < count; index++) {
    chunks.push(
      <RowChunk
        key={index}
        index={index}
        sessions={sessions}
        start={index * CHUNK_ROWS}
        count={rowsInChunk(total, index)}
        placeHeight={isDrawn(index) ? null : heightOf(index)}
        selectedId={selectedId}
        now={now}
        onOpen={onOpen}
      />,
    );
  }
  // A list by its roles, not a <ul>: a <ul> may hold nothing but <li>, and the rows are grouped in
  // chunks. A chunk has no role of its own, so the rows are the items of this list; each row says
  // its place in the whole list, because only some of the rows are in the page.
  return (
    // biome-ignore lint/a11y/useSemanticElements: see the comment above.
    <div
      ref={list}
      className="rows"
      role="list"
      onFocus={(event: FocusEvent<HTMLDivElement>) => setFocused(chunkOf(event.target))}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocused(-1);
      }}
    >
      {chunks}
    </div>
  );
}

export function SessionList({
  sessions,
  total,
  query,
  onQuery,
  selectedId,
  keepId,
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
  /** A session whose row stays in the page wherever the list is scrolled to: the open one, or the one that was open last. */
  keepId: string | null;
  now: Date;
  onOpen: (id: string) => void;
  onImport: () => void;
  notice?: ReactNode;
  footer?: ReactNode;
}) {
  const pane = useRef<HTMLElement>(null);
  return (
    <nav ref={pane} className="list-pane" aria-label="Sessions">
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
        <Rows
          sessions={sessions}
          selectedId={selectedId}
          keepId={keepId}
          query={query}
          now={now}
          onOpen={onOpen}
          scroller={pane}
        />
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
