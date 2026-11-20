// Project names (docs/data-model.md 3.1, 8.4). A project is only a name; names are unique in a
// vault when trimmed and compared without regard to case (B2), and the list is in dictionary
// order with natural numbers (B5: the Apple app lists by code point, "Zebra" before "apple").

import { projectNameKey } from "../interchange/shared.ts";
import { cleanString } from "../interchange/text.ts";
import { compareIds } from "./order.ts";

/** What the order and the name rule look at in a project. */
export interface NamedProject {
  readonly id: string;
  readonly name: string;
}

// data-model.md 8.4: the value two project names are compared by (`projects.name_key`): trimmed,
// in composed form, in lower case. The core has one projectNameKey: the merge of an interchange
// file (6.7 step 2) and the rule for creating and renaming a project compare by the same function.
export { projectNameKey };

/**
 * data-model.md 8.4: the order of the project list. Names are compared by the rules of `locale`
 * (the viewer's locale in the browser; "en" in tests) without regard to case and accents and with
 * digit runs as numbers; names that this leaves equal are ordered by their UTF-16 units, and
 * projects with one name by id.
 *
 * Throws a RangeError when `locale` is not a language tag, and a TypeError when none is given:
 * the locale of the machine is never used in its place.
 */
export function projectComparator(locale: string): (a: NamedProject, b: NamedProject) => number {
  if (typeof locale !== "string") throw new TypeError("projectComparator needs a locale.");
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  // The comparator printed in 8.4 ends in `a.id < b.id ? -1 : 1` and so never answers 0, not even
  // for a project and itself; ECMAScript then leaves the order of a sort to the engine. Here equal ids give 0.
  return (a, b) =>
    collator.compare(a.name, b.name) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    compareIds(a.id, b.id);
}

/** The projects in the order of the project list (8.4). The array handed in is not changed. */
export function sortProjects<T extends NamedProject>(projects: readonly T[], locale: string): T[] {
  return [...projects].sort(projectComparator(locale));
}

/** Why a project name cannot be used, or the name and key to store. */
export type ProjectNameCheck =
  | {
      readonly ok: true;
      /** The name to store: trimmed, and without what no store can hold (C9). */
      readonly name: string;
      /** Its key (`projects.name_key`). */
      readonly key: string;
    }
  | {
      readonly ok: false;
      /** "empty": nothing is left after trimming. "taken": another project has a name with the same key. */
      readonly reason: "empty" | "taken";
      /** For "taken": the id of the project that holds the name. */
      readonly takenBy: string | null;
    };

/**
 * data-model.md 8.4, creating and renaming a project: trim; refuse an empty name; refuse a name
 * whose key already belongs to another project of the vault (the user is told, B2).
 * `renamedId` is the id of the project being renamed, which may keep or respell its own name.
 */
export function checkProjectName(
  name: string,
  projects: readonly NamedProject[],
  renamedId: string | null = null,
): ProjectNameCheck {
  // C9, as the reader does it (6.6 repair 5): U+0000 goes, a lone surrogate becomes U+FFFD.
  const trimmed = cleanString(name).trim();
  if (trimmed === "") return { ok: false, reason: "empty", takenBy: null };
  const key = projectNameKey(trimmed);
  // 6.1: ids are compared in their canonical lower-case form.
  const own = renamedId === null ? null : renamedId.toLowerCase();
  for (const project of projects) {
    if (project.id !== own && projectNameKey(project.name) === key) {
      return { ok: false, reason: "taken", takenBy: project.id };
    }
  }
  return { ok: true, name: trimmed, key };
}
