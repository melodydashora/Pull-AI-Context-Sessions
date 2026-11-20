// Creating sessions from parser results (docs/data-model.md 8.6): the step between the transcript
// importer and the vault, the equivalent of SessionImporter.insert in the Apple app.
//
// corrections.md section 2, G1: this is a write path, so what it creates goes through the one
// normalising constructor of the core (normaliseSession) and is in the form the interchange reader
// gives a session, whatever the strings of the parser result hold: such a session can always be
// stored (C9) and exported, and reading the export back changes nothing. On what the importer
// returns none of this changes a character.

import type { ParsedSession } from "../import/index.ts";
import {
  formatTimestamp,
  normaliseSession,
  parseTimestamp,
  type SessionDraft,
  type Vault,
  type VaultSession,
} from "../interchange/index.ts";
import { isCanonicalUuid } from "../interchange/shapes.ts";

/** What creating a session needs from outside: the clock and the source of ids. */
export interface NewSessionContext {
  /** The current time. For several parser results in one call it is the time of the batch (B7). */
  readonly now: Date;
  /**
   * Gives a new random UUID, for example `() => crypto.randomUUID()`. It is called once for each
   * session and then once for each of its messages, in order.
   */
  readonly newId: () => string;
}

/** Ids no new session or message may take. */
interface TakenIds {
  readonly sessions: Set<string>;
  readonly messages: Set<string>;
}

/** How often the generator is asked again before a call gives up. */
const ID_ATTEMPTS = 16;

/** A new id in canonical lower-case form (6.1) that is not in `taken`; it is added to `taken`. */
function drawId(newId: () => string, taken: Set<string>): string {
  // A generator that keeps returning used or malformed ids must not hold the import up.
  for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
    const candidate: unknown = newId();
    const id = typeof candidate === "string" ? candidate.toLowerCase() : "";
    if (isCanonicalUuid(id) && !taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  throw new Error("The id generator gave no unused UUID; no session was created.");
}

/**
 * The size of a parser result is the size of the text it was parsed from, so the reader's bound
 * on the number of values (made for files that claim more than they hold) does not apply.
 */
const WHOLE_RESULT = { maxNodes: Number.MAX_SAFE_INTEGER };

/** The original date a parser found, in milliseconds; undefined when it found none (import-rules.md 2.7). */
function originalDate(createdAt: string | null): number | undefined {
  if (typeof createdAt !== "string") return undefined;
  const reading = parseTimestamp(createdAt);
  return reading.ok ? reading.ms : undefined;
}

function build(
  parsed: readonly ParsedSession[],
  context: NewSessionContext,
  taken: TakenIds,
): VaultSession[] {
  const count = parsed.length;
  const batchTime = context.now.getTime();
  // 6.1: a stored instant is one that a timestamp with a four-digit year can express.
  if (formatTimestamp(batchTime) === null || formatTimestamp(batchTime + Math.max(count - 1, 0)) === null) {
    throw new RangeError("The current time is not a date a session can hold; no session was created.");
  }
  return parsed.map((item, i) => {
    // B7: item i of n gets "batch time + (n - 1 - i)" milliseconds, so that the first item of the
    // file is the newest and lists first.
    const now = batchTime + (count - 1 - i);
    const id = drawId(context.newId, taken.sessions);
    const draft: SessionDraft = {
      id,
      title: item.title,
      provider: item.provider,
      // 8.6 was written when no parser set these three; the context pack parser does (W14).
      model: item.model,
      summary: item.summary,
      // W14 neither trims as 8.2 does nor drops repeats; the constructor applies parseTags.
      tags: item.tags,
      source_url: item.sourceUrl,
      created_at: new Date(originalDate(item.createdAt) ?? now),
      imported_at: new Date(now),
      updated_at: new Date(now),
      messages: item.messages.map((message) => ({
        id: drawId(context.newId, taken.messages),
        role: message.role,
        text: message.text,
      })),
    };
    // G1: the form the reader produces (strings cleaned, provider and roles by G2, tags by 8.2,
    // LF line endings); the importer's W1 has done the cleaning already.
    const normalised = normaliseSession(draft, { limits: WHOLE_RESULT });
    if (!normalised.ok) {
      const first = normalised.problems.items[0];
      const where = first === undefined ? "" : `: ${first.rule} at "${first.path}"`;
      throw new RangeError(
        `A parser result holds a value no session can store${where}; no session was created.`,
      );
    }
    return normalised.session;
  });
}

/**
 * data-model.md 8.6: the sessions for the results of one import, in the order given.
 *
 * Every session gets a new id, as does every message; messages keep the parser's order as
 * positions 0, 1, 2 and so on, with their role and text. Title, provider, link, and what a context
 * pack carries besides (model, summary, tags) come from the parser. A session is not pinned and
 * has no project. Its original date is the parser's, or the import time when the source had none.
 *
 * One call is one batch (B7): the parser results keep their order in the list, because item i of
 * n is given the import time `now + (n - 1 - i)` milliseconds. The first item of a file therefore
 * lists first, where the Apple app lists the last one first. Several files picked together are
 * one batch when their sessions are handed over in one call; `updated_at`, and the original date
 * of a source without one, are that same time (8.6 defines `now` by B7).
 *
 * Nothing is dropped here: the importer never returns a session without messages or a message
 * without text (W12). No attachment is made; the page snapshot of a capture is out of scope.
 *
 * Throws a RangeError when `now` is not a date a session can hold, or when a parser result holds
 * a value the reader refuses (G2: a provider or a role of more than 200 characters, which no
 * importer returns), and an Error when the generator gives no unused UUID in 16 tries.
 */
export function createSessions(parsed: readonly ParsedSession[], context: NewSessionContext): VaultSession[] {
  return build(parsed, context, { sessions: new Set(), messages: new Set() });
}

/** data-model.md 8.6 for one parser result: its import time is `now`. */
export function createSession(parsed: ParsedSession, context: NewSessionContext): VaultSession {
  const created = createSessions([parsed], context)[0];
  if (created === undefined) throw new Error("No session was created.");
  return created;
}

/** What adding parser results to a vault gave. */
export interface AddedSessions {
  /** The vault with the new sessions after the ones it had. The vault handed in is not changed. */
  readonly vault: Vault;
  /** The new sessions, in the order of the parser results. */
  readonly sessions: readonly VaultSession[];
}

/**
 * Create the sessions of one import (8.6, one batch) and add them to a vault. No new id repeats
 * one the vault already uses for a session or for a message (6.6 R2). Projects, stored bytes and
 * the sessions the vault had are untouched: importing the same file twice gives two sessions, as
 * in the Apple app (B2).
 */
export function addParsedSessions(
  vault: Vault,
  parsed: readonly ParsedSession[],
  context: NewSessionContext,
): AddedSessions {
  const taken: TakenIds = { sessions: new Set(), messages: new Set() };
  for (const session of vault.sessions) {
    taken.sessions.add(session.id);
    for (const message of session.messages) taken.messages.add(message.id);
  }
  const sessions = build(parsed, context, taken);
  return {
    vault: { projects: vault.projects, sessions: [...vault.sessions, ...sessions], blobs: vault.blobs },
    sessions,
  };
}
