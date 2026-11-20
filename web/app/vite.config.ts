import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version?: string;
};

/** A short commit id, so a page can say exactly which source it was built from. */
function buildId(): string {
  if (process.env.BUILD_ID) {
    return process.env.BUILD_ID;
  }
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() || "dev";
  } catch {
    return "dev";
  }
}

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version ?? "0.0.0"),
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  server: {
    // The development server is not started from this file. `npm run dev` starts the Node
    // server (server/src/dev.ts), which mounts Vite as middleware and adds the workspace's own
    // host name to allowedHosts. Used alone, this configuration answers to local names only:
    // allowedHosts is never set to true (docs/web-platform.md 13.2, rule 2).
    //
    // No cross-origin reads: like the production server, Vite sends no CORS headers.
    cors: false,
    fs: {
      // The development server may read the app, the shared core and installed packages.
      // Nothing else: not the documents, not the fixtures, and never the workspace folder.
      strict: true,
      allow: [here("."), here("../core"), here("../node_modules")],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // No asset becomes a data: URL. The content security policy has no data: source
    // (docs/web-platform.md 11.4).
    assetsInlineLimit: 0,
  },
});
