// The ZIP bundle of data-model.md 6.4. Reading and writing ZIP files is not part of this module;
// here are the two rules whoever handles the archive needs: which entries count, and how one
// document becomes the documents of a bundle. Bytes found under blobs/<sha256> go to
// importDocument as `bundleBlobs`.

import { assemble, unknownProperties } from "./json.ts";
import { isCanonicalUuid, isSha256Hex } from "./shapes.ts";
import { DOCUMENT_KEY_SET, type InterchangeDocument, type InterchangeProject } from "./types.ts";

/** What an entry of a bundle is. */
export type BundleEntry =
  | { readonly kind: "vault" }
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "blob"; readonly sha256: string };

/**
 * Classify the name of a bundle entry. Only three shapes count: `vault.json`,
 * `sessions/<canonical UUID>.json` and `blobs/<64 lower-case hex characters>`. Every other entry
 * gives null and must be ignored. Never use an entry name as a path on disk.
 */
export function classifyBundleEntry(name: string): BundleEntry | null {
  if (name === "vault.json") return { kind: "vault" };
  if (name.startsWith("sessions/") && name.endsWith(".json")) {
    const id = name.slice("sessions/".length, -".json".length);
    return isCanonicalUuid(id) ? { kind: "session", id } : null;
  }
  if (name.startsWith("blobs/")) {
    const sha256 = name.slice("blobs/".length);
    return isSha256Hex(sha256) ? { kind: "blob", sha256 } : null;
  }
  return null;
}

/** One document as the documents of a bundle. */
export interface DocumentParts {
  /** `vault.json`: kind "vault", every project of the document, no session. */
  readonly vault: InterchangeDocument;
  /** `sessions/<id>.json`: kind "session", one per session, each with its own project. */
  readonly sessions: readonly InterchangeDocument[];
}

/**
 * Split a document into small ones (6.4): one for the projects and one per session. Imported in
 * that order, the parts give what the whole document gives, so a large vault can be sent or
 * stored one session at a time. Give it a document the reader has returned.
 */
export function splitDocument(doc: InterchangeDocument): DocumentParts {
  const part = (
    kind: InterchangeDocument["kind"],
    projects: InterchangeDocument["projects"],
    sessions: InterchangeDocument["sessions"],
  ): InterchangeDocument =>
    assemble<InterchangeDocument>(
      {
        format: doc.format,
        version: doc.version,
        kind,
        exported_at: doc.exported_at,
        ...(doc.generator === undefined ? {} : { generator: doc.generator }),
        projects,
        sessions,
      },
      // What else the document says about itself stays with every part.
      unknownProperties(doc, DOCUMENT_KEY_SET),
    );
  const projectById = new Map<string, InterchangeProject>();
  for (const project of doc.projects) projectById.set(project.id, project);
  return {
    vault: part("vault", doc.projects, []),
    sessions: doc.sessions.map((session) => {
      const project = session.project_id === null ? undefined : projectById.get(session.project_id);
      return part("session", project === undefined ? [] : [project], [session]);
    }),
  };
}
