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
