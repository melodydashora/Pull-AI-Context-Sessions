// The development entry: `npm run dev`. It starts the same Node server as production (app.ts) on
// the same single port, with the Vite development server mounted as middleware. The page, the
// API and the hot-reload connection then share one origin, exactly as in production
// (docs/web-platform.md 10.3 and 13.2, rules 1 and 2).
//
// Vite is a development dependency. It is loaded in this file only, with a dynamic import, so
// `npm start` never needs it.

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AppServer,
  CONTENT_SECURITY_POLICY,
  createSecuredServer,
  type Pages,
  requestListener,
  SECURITY_HEADERS,
} from "./app.ts";
import { buildOptions, closeOnSignal, type Environment, listen, listenTarget, startupLine } from "./start.ts";

const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));

// Vite writes this text wherever a nonce belongs; each page response replaces it with its own.
const NONCE_PLACEHOLDER = "SESSIONVAULT-CSP-NONCE";

/**
 * The content security policy of the development page: the production policy with one source
 * added to two directives. Every other directive and every other header stays as it is.
 *
 * Found by test in a browser, with the two Chromium builds of the workspace. Under the production
 * policy the development page reports one violation and stays empty; with these two additions
 * it reports none, also while the error overlay is open.
 *
 *   script-src: the React plugin adds its Fast Refresh preamble to the page as an inline module
 *     script. When it is blocked, the page stops with "$RefreshSig$ is not defined".
 *   style-src: Vite's client adds <style> elements at run time, for its error overlay and for
 *     every style sheet that a module imports. When they are blocked, those styles are missing.
 *
 * The added source is a nonce: a random value made for one response. Vite puts it on the script
 * and style tags of the page (html.cspNonce), and its client puts it on the <style> elements it
 * adds later. Anything inline that lacks the nonce stays blocked. Only the page gets this
 * policy; modules, style sheets and the API keep the production policy. The hot-reload socket
 * needs nothing: it is same-origin, which connect-src 'self' covers.
 */
export function developmentPolicy(nonce: string, base: string = CONTENT_SECURITY_POLICY): string {
  const source = `'nonce-${nonce}'`;
  return base
    .replace("script-src 'self'", `script-src 'self' ${source}`)
    .replace("style-src 'self'", `style-src 'self' ${source}`);
}

// The suffix of every development address the platform hands out. An entry that starts with a
// dot covers the names below it (docs/web-platform.md 13.2, rule 2, names this suffix).
const REPLIT_DEV_SUFFIX = ".replit.dev";

/**
 * The host names the development server answers to, besides the local ones that Vite always
 * allows ("localhost", names under ".localhost", IP addresses). On Replit that is the workspace's
 * own development host, first in the list, and the platform's development suffix: the address
 * of a workspace can change while the server runs, and the new one must still be answered
 * (docs/web-platform.md 10.3 and 13.2, rule 2). Never "any host".
 */
export function developmentHosts(env: Environment): string[] {
  // Browsers send host names in lower case, and the check compares exactly.
  const host = env.REPLIT_DEV_DOMAIN?.trim().toLowerCase() ?? "";
  // A plain host name only: a value that starts with a dot would allow every name below it.
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) {
    return [];
  }
  return host.endsWith(REPLIT_DEV_SUFFIX) ? [host, REPLIT_DEV_SUFFIX] : [host];
}

// The one site that may show the development server inside a frame: the editor of the hosting
// platform, whose preview pane is such a frame. An exact origin, never a pattern.
const EDITOR_ORIGIN = "https://replit.com";

/**
 * The origins that may show the development server in a frame, or none.
 *
 * The app refuses to be framed (docs/web-platform.md 11.4), and the published app always does.
 * The owner asked on 2026-11-20 that the preview pane of the workspace works. So the
 * development server, and only it, lets the editor frame it when all of this holds: the
 * workflow asks for it (SESSIONVAULT_PREVIEW_PANE is "1"), the server runs in the workspace
 * (a development host is known), and it is not a published app (REPLIT_DEPLOYMENT is not "1").
 * The workspace holds no real data, and this is the only place where the app is ever framed.
 */
export function previewPaneAncestors(env: Environment): string[] {
  const inWorkspace = developmentHosts(env).length > 0 && env.REPLIT_DEPLOYMENT !== "1";
  return inWorkspace && env.SESSIONVAULT_PREVIEW_PANE === "1" ? [EDITOR_ORIGIN] : [];
}

/**
 * The headers of a development server that the given origins may frame. Three of the eight
 * headers change, the other five stay as they are:
 *   Content-Security-Policy: frame-ancestors names the origins in place of 'none'.
 *   X-Frame-Options: left out. It can only say "nobody" or "same site".
 *   Cross-Origin-Resource-Policy: left out. With "same-origin" a page on another site that
 *     isolates itself cannot embed this one.
 */
export function previewPaneHeaders(ancestors: readonly string[]): Record<string, string> {
  for (const origin of ancestors) {
    // An https origin and nothing else: this text goes into a header.
    if (!/^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/.test(origin)) {
      throw new Error("a frame ancestor must be an https origin");
    }
  }
  if (ancestors.length === 0) {
    return { ...SECURITY_HEADERS };
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === "X-Frame-Options" || name === "Cross-Origin-Resource-Policy") {
      continue;
    }
    headers[name] =
      name === "Content-Security-Policy"
        ? value.replace("frame-ancestors 'none'", `frame-ancestors ${ancestors.join(" ")}`)
        : value;
  }
  return headers;
}

/** What to tell the person who started the server: where the app can be opened. */
export function developmentNotice(env: Environment): string[] {
  const [host] = developmentHosts(env);
  if (host === undefined) {
    return [];
  }
  const pane =
    previewPaneAncestors(env).length > 0
      ? "The preview pane of the editor shows this address. It can also be opened in its own browser tab. The published app refuses to be displayed inside a frame."
      : "Open this address in its own browser tab: the preview pane inside the editor cannot show the app, because the app refuses on purpose to be displayed inside a frame.";
  return [`https://${host}/`, pane];
}

export interface DevOptions {
  /** Package version, shown by /api/version. */
  readonly version: string;
  /** Build id (a short commit id, or "dev"). */
  readonly build: string;
  /** Host names to answer to, besides the local ones (see developmentHosts). */
  readonly hosts: readonly string[];
  /** Where Vite keeps its cache. A test passes a temporary folder; the default is Vite's own. */
  readonly cacheDir?: string;
  /** Origins that may show this server in a frame (see previewPaneAncestors). Default: none. */
  readonly frameAncestors?: readonly string[];
}

export interface DevApp {
  readonly server: AppServer;
  /** Stops Vite (its file watcher and hot-reload connections) and then the server. */
  close(): Promise<void>;
}

/** Create the development server. The caller decides the port and when to listen. */
export async function createDevApp(options: DevOptions): Promise<DevApp> {
  const { createServer } = await import("vite");
  const headers = previewPaneHeaders(options.frameAncestors ?? []);
  const basePolicy = headers["Content-Security-Policy"] ?? CONTENT_SECURITY_POLICY;
  const server = createSecuredServer(headers);
  const vite = await createServer({
    root: APP_DIR,
    configFile: join(APP_DIR, "vite.config.ts"),
    ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
    // Vite answers for files only. The entry page is sent by this server (`shell` below), so
    // that each response can carry its own nonce and a missing file answers 404 as in production.
    appType: "custom",
    // Keep the start-up lines on the screen.
    clearScreen: false,
    html: { cspNonce: NONCE_PLACEHOLDER },
    server: {
      middlewareMode: true,
      // Hot reload uses this HTTP server, and so this port: the platform maps one port only.
      // (Older versions of Vite call this option server.hmr.server; this version marks that
      // name as deprecated.)
      ws: { server },
      allowedHosts: [...options.hosts],
    },
  });

  // Vite may add names of its own to the list. Our routes use the list it ends up with, so the
  // two always agree. A configuration that switches the check off is refused.
  const allowedHosts = vite.config.server.allowedHosts;
  if (allowedHosts === true) {
    await vite.close();
    throw new Error("server.allowedHosts is true: the development server would answer under any host name");
  }

  const pages: Pages = {
    // Modules, style sheets and public files: Vite answers. It hands back what it has no file for.
    // A failure of its own (a module that does not compile) goes to its overlay and to the
    // terminal, and the request is then handed back in the same way.
    file: (req, res) =>
      new Promise<boolean>((done, failed) => {
        res.once("close", () => done(true));
        vite.middlewares(req, res, (error?: unknown) => {
          if (error === undefined || error === null) {
            done(false);
          } else {
            failed(error);
          }
        });
      }),
    async shell(pathname) {
      const nonce = randomBytes(18).toString("base64");
      const template = await readFile(join(APP_DIR, "index.html"), "utf8");
      const html = await vite.transformIndexHtml("/index.html", template, pathname);
      return {
        html: html.replaceAll(NONCE_PLACEHOLDER, nonce),
        policy: developmentPolicy(nonce, basePolicy),
      };
    },
  };
  server.on(
    "request",
    requestListener({ version: options.version, build: options.build, pages, allowedHosts }),
  );

  // A hot-reload connection stays open for as long as the page does. Closing must not wait for it.
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  return {
    server,
    async close() {
      await vite.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        for (const socket of sockets) {
          socket.destroy();
        }
      });
    },
  };
}

// Start the server when this file is run (`npm run dev`), not when a test imports it.
// import.meta.main exists from Node 24.2 on.
if (import.meta.main) {
  const { version, build } = buildOptions(process.env);
  const app = await createDevApp({
    version,
    build,
    hosts: developmentHosts(process.env),
    frameAncestors: previewPaneAncestors(process.env),
  });
  const port = await listen(app.server, listenTarget(process.env));
  console.log(startupLine({ version, build }, port, true));
  for (const line of developmentNotice(process.env)) {
    console.log(line);
  }
  closeOnSignal(() => app.close());
}
