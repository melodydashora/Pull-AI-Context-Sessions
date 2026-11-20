// Start-up shared by the two entry files: main.ts (`npm start`) and dev.ts (`npm run dev`).
// Configuration comes from the environment only; nothing secret is read from a file.
//   PORT       port to listen on (default 5000; the hosting platform passes its own)
//   HOST       address to bind (default 0.0.0.0, which the hosting platform requires)
//   BUILD_ID   identifies the source this copy was built from (default "dev")

import { readFileSync, statSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { APP_NAME, describeBuild, formatBuildLabel } from "@sessionvault/core";

/** The environment variables of the process, or a stand-in for them in a test. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** Where to listen (docs/web-platform.md 10.3). */
export function listenTarget(env: Environment): { port: number; host: string } {
  return { port: Number(env.PORT) || 5000, host: env.HOST || "0.0.0.0" };
}

/** The version of this package and the build id, for /api/version. */
export function buildOptions(env: Environment): { version: string; build: string } {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version?: string;
  };
  return { version: packageJson.version ?? "0.0.0", build: env.BUILD_ID || "dev" };
}

/**
 * A tripwire for what a published app must never contain (docs/web-platform.md 10.13, rule 3).
 * The puller writes private transcripts into a folder `sessions` at the top of the repository,
 * and a published app is built from the files on disk. Returns the reason why this copy must
 * not start, or null. It looks only in a published app (REPLIT_DEPLOYMENT is "1" there).
 */
export function publishedImageProblem(env: Environment, repositoryTop: string): string | null {
  if (env.REPLIT_DEPLOYMENT !== "1") {
    return null;
  }
  let found = false;
  try {
    found = statSync(join(repositoryTop, "sessions")).isDirectory();
  } catch {
    found = false;
  }
  return found
    ? "Not starting: a folder named sessions lies at the top of the published files. The puller writes private transcripts there, and it must never be part of a published app. Keep it out with the platform's ignore list (.replitignore) and publish again."
    : null;
}

/** Start listening. Resolves with the port in use once the server accepts connections. */
export function listen(server: Server, target: { port: number; host: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(target.port, target.host, () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/**
 * The line written at start-up. The port is there to be compared with the platform's port
 * mapping (docs/web-platform.md 10.3). Production also names its build. Development names no
 * value of the environment besides the port.
 */
export function startupLine(
  info: { version: string; build: string },
  port: number,
  development: boolean,
): string {
  const what = development
    ? `${APP_NAME} ${info.version} (development)`
    : formatBuildLabel(describeBuild(info.version, info.build));
  return `${what} is listening on port ${port}`;
}

/** Stop cleanly when the process is asked to end. */
export function closeOnSignal(close: () => Promise<void>): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      // A connection that stays open must not keep the process alive.
      setTimeout(() => process.exit(0), 3000).unref();
      close().finally(() => process.exit(0));
    });
  }
}
