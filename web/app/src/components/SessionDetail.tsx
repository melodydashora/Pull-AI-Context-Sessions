// One session (docs/design.md 4.5.5, 4.6.4): a toolbar with the context pack actions, the
// header of the session, and its transcript.

import { fileSystemSafe, sessionContextPack, type VaultSession } from "@sessionvault/core";
import { ChevronLeft, Download, Link as LinkIcon, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadText } from "../clipboard.ts";
import { mediumDate, providerId, safeHttpLink, shownTitle, turnsLabel } from "../format.ts";
import { CopyButton, EmptyState, IconButton, ProviderChip } from "./controls.tsx";
import { MessageBubble, TextBlocks } from "./Message.tsx";

/** design.md 4.7.5: mount the first messages at once and the rest while the browser is idle. */
const FIRST_MESSAGES = 40;
const MESSAGES_PER_BATCH = 200;

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 50);
  return () => window.clearTimeout(handle);
}

function Transcript({ session, onCopyFailed }: { session: VaultSession; onCopyFailed: () => void }) {
  const total = session.messages.length;
  const [mounted, setMounted] = useState(() => Math.min(total, FIRST_MESSAGES));
  useEffect(() => {
    if (mounted >= total) return;
    return whenIdle(() => setMounted((count) => Math.min(total, count + MESSAGES_PER_BATCH)));
  }, [mounted, total]);

  if (total === 0) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="No Transcript"
        description="This session has no captured messages. Recapture the link or re-import the file."
      />
    );
  }
  return (
    <div className="transcript" aria-busy={mounted < total}>
      {session.messages.slice(0, mounted).map((message) => (
        <MessageBubble key={message.id} message={message} onCopyFailed={onCopyFailed} />
      ))}
    </div>
  );
}

/** The time zone of the viewer: it decides the calendar day a context pack prints (data-model.md 8.3). */
function viewerTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function SessionDetail({
  session,
  onBack,
  onCopyFailed,
}: {
  session: VaultSession;
  onBack: () => void;
  onCopyFailed: () => void;
}) {
  // The pack is built in the browser from the loaded session, inside the click, so that no
  // request sits between the click and the write (design.md 4.6.4; web-platform.md 6.1).
  const contextPack = (): string => sessionContextPack(session, { timeZone: viewerTimeZone() });
  const sourceLink = safeHttpLink(session.source_url);
  return (
    <section className="detail" aria-label="Session">
      <div className="toolbar">
        <a
          className="toolbar__back"
          href="/sessions"
          aria-label="All Sessions"
          onClick={(event) => {
            event.preventDefault();
            onBack();
          }}
        >
          <ChevronLeft size={20} aria-hidden="true" />
          <span className="toolbar__back-label">All Sessions</span>
        </a>
        <div className="toolbar__actions">
          <CopyButton
            getText={contextPack}
            label="Copy Context Pack"
            copiedLabel="Copied!"
            variant="toolbar"
            holdMs={2000}
            onFailed={onCopyFailed}
          />
          <IconButton
            label="Download Context Pack"
            icon={Download}
            onClick={() =>
              downloadText(
                `${fileSystemSafe(session.title)}.md`,
                contextPack(),
                "text/markdown;charset=utf-8",
              )
            }
          />
        </div>
      </div>
      <div className="detail__content">
        <header className="session-header">
          <h1 className="session-header__title" dir="auto">
            {shownTitle(session.title)}
          </h1>
          <p className="session-header__line">
            <ProviderChip provider={providerId(session.provider)} />
            {session.model !== "" ? (
              <span className="session-header__model" dir="auto">
                {session.model}
              </span>
            ) : null}
          </p>
          {session.tags.length > 0 ? (
            <p className="session-header__tags" dir="auto">
              {session.tags.map((tag) => `#${tag}`).join("  ")}
            </p>
          ) : null}
          {session.summary !== "" ? (
            <div className="session-header__summary">
              <h2 className="field-label">Summary</h2>
              <TextBlocks text={session.summary} onCopyFailed={onCopyFailed} />
            </div>
          ) : null}
          {sourceLink !== null ? (
            <a className="session-header__link" href={sourceLink} target="_blank" rel="noopener noreferrer">
              <LinkIcon size={16} aria-hidden="true" />
              <span className="session-header__link-text">{sourceLink}</span>
            </a>
          ) : null}
          <p className="session-header__meta">
            {`Original date ${mediumDate(session.created_at)} · imported ${mediumDate(session.imported_at)} · ${turnsLabel(session.message_count)}`}
          </p>
        </header>
        <Transcript session={session} onCopyFailed={onCopyFailed} />
      </div>
    </section>
  );
}
