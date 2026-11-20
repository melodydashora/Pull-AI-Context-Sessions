// A consistency check for vaults, for tests and for code that builds vault values by other means
// than the import (data-model.md 7.3 has the same check for the database).

import { assemble, EMPTY_OBJECT, type JsonObject, jsonEqual } from "./json.ts";
import {
  type CappedList,
  createProblemLog,
  type Limits,
  type NoticeList,
  type Problem,
  resolveLimits,
} from "./problems.ts";
import { sha256Hex } from "./sha256.ts";
import { isSha256Hex } from "./shapes.ts";
import { utf8ByteLength } from "./text.ts";
import {
  ATTACHMENT_KEY_SET,
  FORMAT_MARKER,
  FORMAT_VERSION,
  MESSAGE_KEY_SET,
  PROJECT_KEY_SET,
  SESSION_KEY_SET,
} from "./types.ts";
import { checkDocument, checkProjectAlone, checkSessionAlone } from "./validate.ts";
import { flattenText, messageSegments, type Vault } from "./vault.ts";
import { projectValue, sessionValue } from "./wire.ts";

export interface VaultCheck {
  /** True when the vault can be exported as it is and its derived values are right. */
  readonly ok: boolean;
  /**
   * What is wrong. Rule "vault": a derived value, an `extra` bag or a blob is inconsistent, or a
   * project or session is not in the form the reader produces (corrections.md 2, G1); the path
   * points into the vault value. Any other rule: what the vault would export breaks that rule of the
   * format; the path points into a document that lists projects and sessions in the vault's order.
   */
  readonly problems: CappedList<Problem>;
  /** R11 and R12 for what the vault would export. */
  readonly warnings: NoticeList;
}

/** The project or session a problem path lies in: "/projects/3", "/sessions/12". Paths are made here, never by a file. */
const PART_OF_PATH = /^\/(?:projects|sessions)\/[0-9]+(?=\/|$)/u;

function hasKnownKey(extra: JsonObject, known: ReadonlySet<string>): boolean {
  return Object.keys(extra).some((key) => known.has(key));
}

/**
 * Check a vault against its own rules: ids, references, tags, text and the like as the format
 * demands them (strictly, without repair), plus the values the vault keeps beside the data
 * (`text`, `text_bytes`, `message_count`, `position`) and the hashes of the stored bytes; and the
 * storage invariant of corrections.md 2, G1: every project and session is in the form the reader
 * produces, so that reading the vault's own export back repairs nothing.
 * Never changes the vault and never throws.
 */
export function checkVault(vault: Vault, options?: { readonly limits?: Partial<Limits> }): VaultCheck {
  const limits = resolveLimits(options?.limits);
  const problems = createProblemLog(limits.maxListed);
  const wrong = (path: string, message: string): void => problems.add({ rule: "vault", path, message });
  try {
    vault.projects.forEach((project, p) => {
      if (hasKnownKey(project.extra, PROJECT_KEY_SET)) {
        wrong(`/projects/${p}/extra`, "extra holds a known property name; the export would drop it.");
      }
    });
    vault.sessions.forEach((session, s) => {
      const at = `/sessions/${s}`;
      if (hasKnownKey(session.extra, SESSION_KEY_SET)) {
        wrong(`${at}/extra`, "extra holds a known property name; the export would drop it.");
      }
      if (session.message_count !== session.messages.length) {
        wrong(`${at}/message_count`, "message_count is not the number of messages.");
      }
      let textBytes = 0;
      session.messages.forEach((message, m) => {
        const here = `${at}/messages/${m}`;
        textBytes += message.text_bytes;
        if (message.position !== m) wrong(`${here}/position`, "position is not the place in the array.");
        if (message.text !== flattenText(messageSegments(message))) {
          wrong(`${here}/text`, "text is not the flattened text of the segments.");
        }
        if (message.text_bytes !== utf8ByteLength(message.text)) {
          wrong(`${here}/text_bytes`, "text_bytes is not the UTF-8 length of text.");
        }
        if (hasKnownKey(message.extra, MESSAGE_KEY_SET)) {
          wrong(`${here}/extra`, "extra holds a known property name; the export would drop it.");
        }
      });
      if (session.text_bytes !== textBytes) {
        wrong(`${at}/text_bytes`, "text_bytes is not the sum over the messages.");
      }
      session.attachments.forEach((attachment, a) => {
        if (hasKnownKey(attachment.extra, ATTACHMENT_KEY_SET)) {
          wrong(
            `${at}/attachments/${a}/extra`,
            "extra holds a known property name; the export would drop it.",
          );
        }
      });
    });
    for (const [sha256, bytes] of vault.blobs) {
      // The key is only quoted when it has the shape of a hash.
      const at = isSha256Hex(sha256) ? `/blobs/${sha256}` : "/blobs";
      if (!isSha256Hex(sha256) || sha256Hex(bytes) !== sha256)
        wrong(at, "The bytes do not have the SHA-256 they are stored under.");
    }

    const projectValues = vault.projects.map(projectValue);
    const sessionValues = vault.sessions.map((session) => sessionValue(session, () => undefined));
    const value = assemble<JsonObject>(
      {
        format: FORMAT_MARKER,
        version: FORMAT_VERSION,
        kind: "vault",
        exported_at: "1970-01-01T00:00:00.000Z",
        projects: projectValues,
        sessions: sessionValues,
      },
      EMPTY_OBJECT,
    );
    const strict = checkDocument(value, { mode: "strict", limits });
    for (const problem of strict.problems.items) problems.add(problem);

    // G1: what the vault would write must be what the reader makes of it. A project or session
    // that already breaks a rule above is not named a second time; and when the list above was
    // cut short, which parts it covers is not known.
    if (strict.problems.total === strict.problems.items.length) {
      const named = new Set<string>();
      for (const problem of strict.problems.items) {
        const part = PART_OF_PATH.exec(problem.path);
        if (part !== null) named.add(part[0]);
      }
      projectValues.forEach((written, p) => {
        if (named.has(`/projects/${p}`)) return;
        const read = checkProjectAlone(written, limits).value;
        if (read !== null && !jsonEqual(written, read)) {
          wrong(`/projects/${p}`, "The project is not in the form the reader produces (G1).");
        }
      });
      sessionValues.forEach((written, s) => {
        if (named.has(`/sessions/${s}`)) return;
        const read = checkSessionAlone(written, limits).value;
        if (read !== null && !jsonEqual(written, read)) {
          wrong(`/sessions/${s}`, "The session is not in the form the reader produces (G1).");
        }
      });
    }
    const listed = problems.list();
    const total = listed.total + (strict.problems.total - strict.problems.items.length);
    return { ok: total === 0, problems: { items: listed.items, total }, warnings: strict.warnings };
  } catch {
    problems.add({ rule: "internal", path: "", message: "The vault could not be checked." });
    return { ok: false, problems: problems.list(), warnings: { items: [], total: 0, counts: {} } };
  }
}
