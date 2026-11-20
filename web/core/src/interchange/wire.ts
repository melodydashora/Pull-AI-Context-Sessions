// What the exporter writes for each part of a vault (data-model.md 6.8), as plain JSON values.
// Nothing here is checked: the export runs the result through the validator, and the import uses
// it to decide whether an incoming session has the same content as the stored one (6.7).

import { assemble, type JsonObject, type JsonValue, unknownProperties } from "./json.ts";
import { dateToTimestamp } from "./timestamp.ts";
import { ATTACHMENT_KEY_SET, MESSAGE_KEY_SET, PROJECT_KEY_SET, SESSION_KEY_SET } from "./types.ts";
import {
  messageSegments,
  type VaultAttachment,
  type VaultMessage,
  type VaultProject,
  type VaultSession,
} from "./vault.ts";

/** A stored date as interchange text. A date no document can hold becomes "", which the validator refuses. */
function stamp(date: Date): string {
  return dateToTimestamp(date) ?? "";
}

/** 6.8: every known property, then the keys of `extra` that are not known properties. */
export function projectValue(project: VaultProject): JsonObject {
  return assemble<JsonObject>(
    {
      id: project.id,
      name: project.name,
      created_at: stamp(project.created_at),
      updated_at: stamp(project.updated_at),
    },
    unknownProperties(project.extra, PROJECT_KEY_SET),
  );
}

/** 6.8: `filename` is written also when empty; `data_base64` only when the bytes travel inline. */
export function attachmentValue(attachment: VaultAttachment, data: string | undefined): JsonObject {
  return assemble<JsonObject>(
    {
      kind: attachment.kind,
      sha256: attachment.sha256,
      media_type: attachment.media_type,
      byte_length: attachment.byte_length,
      filename: attachment.filename,
      created_at: stamp(attachment.created_at),
      ...(data === undefined ? {} : { data_base64: data }),
    },
    unknownProperties(attachment.extra, ATTACHMENT_KEY_SET),
  );
}

/** 6.8: `created_at` and `model` only when they are set; stored segments, or one text segment. */
export function messageValue(message: VaultMessage, index: number): JsonObject {
  const segments: readonly JsonValue[] = messageSegments(message);
  return assemble<JsonObject>(
    {
      id: message.id,
      index,
      role: message.role,
      segments,
      ...(message.created_at === null ? {} : { created_at: stamp(message.created_at) }),
      ...(message.model === "" ? {} : { model: message.model }),
    },
    unknownProperties(message.extra, MESSAGE_KEY_SET),
  );
}

/**
 * 6.8: all known properties also when they hold their default, messages ordered by position with
 * `index` their place in the array. `dataFor` gives the base64 text of an attachment's bytes, or
 * undefined to write the descriptor alone.
 */
export function sessionValue(
  session: VaultSession,
  dataFor: (attachment: VaultAttachment, index: number) => string | undefined,
): JsonObject {
  // Stable: messages with equal positions keep their order.
  const ordered = [...session.messages].sort((a, b) => a.position - b.position);
  return assemble<JsonObject>(
    {
      id: session.id,
      title: session.title,
      provider: session.provider,
      model: session.model,
      source_url: session.source_url,
      summary: session.summary,
      tags: session.tags,
      is_pinned: session.is_pinned,
      created_at: stamp(session.created_at),
      imported_at: stamp(session.imported_at),
      updated_at: stamp(session.updated_at),
      project_id: session.project_id,
      attachments: session.attachments.map((attachment, i) =>
        attachmentValue(attachment, dataFor(attachment, i)),
      ),
      messages: ordered.map(messageValue),
    },
    unknownProperties(session.extra, SESSION_KEY_SET),
  );
}
