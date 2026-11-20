// Builders for the results of the three entry points (docs/import-rules.md section 5).

import type {
  DroppedTurn,
  ImportedResult,
  ImportFlag,
  ParsedSession,
  RejectedResult,
  RejectReason,
} from "./types.ts";

/** W12: an import that leaves nothing is `rejected` with a reason, never a success. */
export function rejected(
  reason: RejectReason,
  flags: readonly ImportFlag[] = [],
  droppedTurns: readonly DroppedTurn[] = [],
): RejectedResult {
  return { outcome: "rejected", reason, flags, sessions: [], droppedTurns };
}

/** The sessions must not be empty; callers reject first. */
export function imported(
  sessions: readonly ParsedSession[],
  flags: readonly ImportFlag[] = [],
  droppedTurns: readonly DroppedTurn[] = [],
): ImportedResult {
  return { outcome: "imported", reason: null, flags, sessions, droppedTurns };
}
