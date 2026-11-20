// The shared core of SessionVault for the web.
//
// Everything exported from this package must run unchanged in a browser and on the
// server: no DOM, no Node modules. The import parsers, the context-pack builder and
// the interchange types (web/HANDOFF.md, phase 1) live here.

/** The product name as people see it. */
export const APP_NAME = "SessionVault";

/** Version of the JSON interchange format (docs/data-model.md, section 6). */
export const INTERCHANGE_VERSION = 1;

/** What a running copy of the app is: shown on the start page and by the server. */
export interface BuildInfo {
  readonly name: string;
  readonly version: string;
  readonly build: string;
}

/**
 * Describe a build. `version` is the package version; `build` identifies the exact
 * source it was built from (a short commit id, or "dev" when that is unknown).
 */
export function describeBuild(version: string, build: string): BuildInfo {
  return {
    name: APP_NAME,
    version: version.trim() || "0.0.0",
    build: build.trim() || "dev",
  };
}

/** One line for people: "SessionVault 0.1.0 (build abc1234)". */
export function formatBuildLabel(info: BuildInfo): string {
  return `${info.name} ${info.version} (build ${info.build})`;
}
