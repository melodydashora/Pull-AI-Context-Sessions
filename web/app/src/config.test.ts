import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { expect, it } from "vitest";
import config from "../vite.config.ts";

it("ships a robots.txt that keeps crawlers out", () => {
  const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
  expect(robots).toBe("User-agent: *\nDisallow: /\n");
});

it("never turns an asset into a data: URL", () => {
  expect(config.build?.assetsInlineLimit).toBe(0);
});

it("lets the development server read the app, the core and the installed packages only", () => {
  expect(config.server?.fs?.strict).toBe(true);
  expect(config.server?.fs?.allow?.map((folder) => basename(folder.replace(/\/$/, "")))).toEqual([
    "app",
    "core",
    "node_modules",
  ]);
});

it("cannot start a second server that answers under any host name", () => {
  // The host check is never switched off, and no address or port is set here:
  // the Node server (server/src/dev.ts) owns both.
  expect(config.server?.allowedHosts).toBeUndefined();
  expect(config.server?.host).toBeUndefined();
  expect(config.server?.port).toBeUndefined();
  expect(config.server?.cors).toBe(false);
  expect(config.preview).toBeUndefined();
  const scripts = (
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;
  expect(Object.keys(scripts)).toEqual(["build"]);
});

it("names the public registry in the lock file, so that the packages install on any machine", () => {
  // npm writes the address it downloaded from. On Replit that is the platform's own package
  // proxy, a host that exists nowhere else: a lock file that names it installs only there.
  // With the public registry in the file, npm on Replit still goes through the proxy, because
  // it replaces that host by the configured registry (replace-registry-host, default "npmjs").
  const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8")) as {
    packages: Record<string, { resolved?: string; link?: boolean }>;
  };
  const elsewhere = Object.entries(lock.packages)
    .filter(
      ([, entry]) =>
        // A workspace package is a link to a folder of this repository, not a download.
        entry.link !== true &&
        entry.resolved !== undefined &&
        !entry.resolved.startsWith("https://registry.npmjs.org/"),
    )
    .map(([name]) => name);
  expect(elsewhere).toEqual([]);
});
