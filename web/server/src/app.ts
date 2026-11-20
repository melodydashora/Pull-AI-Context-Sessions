// The HTTP server: one Node process on one port, in development and in production
// (docs/web-platform.md 10.3 and 13.2). It answers two kinds of request and nothing else:
//   - its own routes: /healthz and everything under /api/;
//   - the browser app: the built files in production, Vite in development (see dev.ts).
// It never serves the workspace folder or any path outside the folder it was given.

import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type RequestListener, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, resolve, sep } from "node:path";
import { describeBuild } from "@sessionvault/core";

/** The content security policy, exactly as docs/web-platform.md 11.4 writes it. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

/** The headers that every response carries (docs/web-platform.md 11.4). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=31536000",
};

// A response gets these headers at the moment it is created, so no code path can forget them:
// not an error answer, not a response that Vite writes in development, and not an answer that
// Node gives by itself (to a request without a Host header, for example).
//
// Two answers have no response object and so cannot carry them. Node writes a bare
// "400 Bad Request" for a request it cannot parse at all. In development, Vite writes the
// WebSocket handshake of hot reload straight to the connection. Neither shows anything of the app.
class SecuredResponse extends ServerResponse<IncomingMessage> {
  constructor(req: IncomingMessage) {
    super(req);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      this.setHeader(name, value);
    }
  }
}

/** An HTTP server whose responses all start with the security headers. It has no routes yet. */
export function createSecuredServer() {
  return createServer({ ServerResponse: SecuredResponse });
}

export type AppServer = ReturnType<typeof createSecuredServer>;

/** The entry page of the browser app. */
export interface Shell {
  readonly html: string | Uint8Array;
  /** Replaces the content security policy for this one response. Development only. */
  readonly policy?: string;
}

/** The browser app: everything the server answers that is not one of its own routes. */
export interface Pages {
  /** Answers the request with a file of the app. Resolves to false when it has no such file. */
  file(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>;
  /** The entry page of the app, or null when there is none. */
  shell(pathname: string): Promise<Shell | null>;
}

export interface AppOptions {
  /** Package version, shown by /api/version. */
  readonly version: string;
  /** Build id (a short commit id, or "dev"). */
  readonly build: string;
  readonly pages: Pages;
  /**
   * Development only: the host names this server answers to, besides the local ones.
   * A request under any other name is refused, as Vite refuses it for its own paths.
   */
  readonly allowedHosts?: readonly string[];
}

export interface ServerOptions {
  /** Folder holding the built browser app (index.html and its assets). */
  readonly staticDir: string;
  /** Package version, shown by /api/version. */
  readonly version: string;
  /** Build id (a short commit id, or "dev"). */
  readonly build: string;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string | Uint8Array,
  head: boolean,
): void {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  res.writeHead(status, { "Content-Length": String(bytes.byteLength), ...headers });
  res.end(head ? undefined : bytes);
}

function sendText(
  res: ServerResponse,
  status: number,
  text: string,
  head: boolean,
  headers: Record<string, string> = {},
): void {
  send(
    res,
    status,
    { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
    text,
    head,
  );
}

// Every /api/ response is JSON and is never stored, errors included (docs/web-platform.md 11.4, 13.4).
function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  head: boolean,
  headers: Record<string, string> = {},
): void {
  send(
    res,
    status,
    { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
    JSON.stringify(value),
    head,
  );
}

interface ErrorAnswer {
  readonly status: number;
  /** Stable and machine-readable. */
  readonly code: string;
  /** A fixed sentence. It never repeats anything the request contained. */
  readonly message: string;
  readonly headers?: Record<string, string>;
  readonly details?: Record<string, string>;
}

// Errors have one shape under /api/ (docs/web-platform.md 13.4, item 4) and are plain text elsewhere.
function sendError(res: ServerResponse, answer: ErrorAnswer, api: boolean, head: boolean): void {
  if (api) {
    const error = {
      code: answer.code,
      message: answer.message,
      retryable: false,
      ...(answer.details === undefined ? {} : { details: answer.details }),
    };
    sendJson(res, answer.status, { error }, head, answer.headers);
  } else {
    sendText(res, answer.status, answer.message, head, answer.headers);
  }
}

const NOT_FOUND: ErrorAnswer = { status: 404, code: "not_found", message: "Not found." };

/** The path of a request, or null when the request names no path (as in "OPTIONS *"). */
function requestPath(url: string | undefined): string | null {
  try {
    if (url?.startsWith("/")) {
      return new URL(`http://localhost${url}`).pathname;
    }
    // The absolute form, which a server has to accept as well (RFC 9112, section 3.2.2).
    const absolute = new URL(url ?? "");
    return absolute.protocol === "http:" || absolute.protocol === "https:" ? absolute.pathname : null;
  } catch {
    return null;
  }
}

/** A request path with its percent-encoding removed, or null when it cannot name a file or a route. */
function decodePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return decoded.includes("\0") || decoded.includes("\\") ? null : decoded;
}

/** The file a request path names inside `root`, or null when it would leave `root`. */
export function resolveInside(root: string, pathname: string): string | null {
  const decoded = decodePath(pathname);
  if (decoded === null) {
    return null;
  }
  const candidate = resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }
  return candidate;
}

/** Whether a path can be a route of the single-page app: a plain path whose last part has no file extension. */
export function isAppRoute(pathname: string): boolean {
  const decoded = decodePath(pathname);
  return decoded !== null && !decoded.split("/").includes("..") && extname(decoded) === "";
}

/**
 * Whether a Host header names this server. The rule is the one Vite applies to its own paths
 * (server.allowedHosts): "localhost", names under ".localhost" and IP addresses always pass;
 * any other name must be on the list, where an entry that starts with a dot also covers subdomains.
 */
export function isHostAllowed(header: string | undefined, allowed: readonly string[]): boolean {
  if (header === undefined) {
    // No name to check. A browser always sends one, and the check is about browsers.
    return true;
  }
  const host = header.trim();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 && isIP(host.slice(1, end)) === 6;
  }
  const colon = host.indexOf(":");
  const name = colon === -1 ? host : host.slice(0, colon);
  if (isIP(name) === 4 || name === "localhost" || name.endsWith(".localhost")) {
    return true;
  }
  return allowed.some(
    (entry) => entry === name || (entry.startsWith(".") && (entry.slice(1) === name || name.endsWith(entry))),
  );
}

async function respond(
  req: IncomingMessage,
  res: ServerResponse,
  options: AppOptions,
  pathname: string | null,
  api: boolean,
  head: boolean,
): Promise<void> {
  if (pathname === null) {
    sendError(res, { status: 400, code: "bad_request", message: "Bad request." }, false, head);
    return;
  }
  if (options.allowedHosts !== undefined && !isHostAllowed(req.headers.host, options.allowedHosts)) {
    const message =
      "The development server does not answer to that host name. If the address of the workspace has changed, start the server again.";
    sendError(res, { status: 403, code: "host_not_allowed", message }, api, head);
    return;
  }
  if (req.method !== "GET" && !head) {
    const message = "Method not allowed.";
    sendError(
      res,
      { status: 405, code: "method_not_allowed", message, headers: { Allow: "GET, HEAD" } },
      api,
      false,
    );
    return;
  }

  // The server's own routes. None of them waits for anything: the hosting platform's health
  // check asks for "/" and gives up after five seconds (docs/web-platform.md 10.3).
  if (pathname === "/healthz") {
    sendText(res, 200, "ok", head);
    return;
  }
  if (pathname === "/api/version") {
    sendJson(res, 200, describeBuild(options.version, options.build), head);
    return;
  }
  if (api) {
    // An unknown path under /api/ is a JSON 404, never the entry page.
    sendError(res, NOT_FOUND, true, head);
    return;
  }

  // Everything else belongs to the browser app.
  if (await options.pages.file(req, res, pathname)) {
    return;
  }
  // A path whose last part has no file extension is a route of the single-page app and gets its
  // entry page, so that a deep link such as /import works. A path with a file extension that
  // names no file answers 404: a missing script or image must not answer 200 with HTML
  // (docs/web-platform.md 13.2, rule 3).
  const shell =
    pathname === "/index.html" || isAppRoute(pathname) ? await options.pages.shell(pathname) : null;
  if (shell === null) {
    sendError(res, NOT_FOUND, false, head);
    return;
  }
  // The entry page is always checked again with the server, also when it answers a deep link.
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  };
  if (shell.policy !== undefined) {
    headers["Content-Security-Policy"] = shell.policy;
  }
  send(res, 200, headers, shell.html, head);
}

// An unexpected failure answers 500 with a fixed sentence and a request id, and the same id goes
// to the log (docs/web-platform.md 13.4, item 4). Neither holds the request's address, anything
// else the client sent, an error message or a stack trace (11.8).
function fail(req: IncomingMessage, res: ServerResponse, error: unknown, api: boolean, head: boolean): void {
  const requestId = randomUUID();
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`request ${requestId} failed: ${req.method} ${api ? "api" : "page"} ${kind}`);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const message = `Internal error. Request id: ${requestId}`;
  sendError(res, { status: 500, code: "internal", message, details: { requestId } }, api, head);
}

/** The request handler, shared by production (createApp) and development (dev.ts). */
export function requestListener(options: AppOptions): RequestListener {
  return (req, res) => {
    const head = req.method === "HEAD";
    const pathname = requestPath(req.url);
    const api = pathname !== null && (pathname === "/api" || pathname.startsWith("/api/"));
    respond(req, res, options, pathname, api, head).catch((error: unknown) => {
      fail(req, res, error, api, head);
    });
  };
}

/**
 * `path` as a file inside `root` after symbolic links are followed, or null when it is not a
 * file or when its real location is outside the folder. `name` is its place inside the folder.
 */
async function fileInside(root: string, path: string): Promise<{ path: string; name: string } | null> {
  try {
    const [realRoot, real] = await Promise.all([realpath(root), realpath(path)]);
    if (!real.startsWith(realRoot + sep) || !(await stat(real)).isFile()) {
      return null;
    }
    return { path: real, name: real.slice(realRoot.length + 1) };
  } catch {
    return null;
  }
}

/** The browser app in production: the files of one folder, the build output of app/. */
function staticPages(staticDir: string): Pages {
  const root = resolve(staticDir);
  return {
    async file(req, res, pathname) {
      const target = resolveInside(root, pathname);
      const found = target === null ? null : await fileInside(root, target);
      if (found === null) {
        return false;
      }
      const type = CONTENT_TYPES[extname(found.path).toLowerCase()] ?? "application/octet-stream";
      // The build writes only files with a content hash in their name to assets/, so those may be
      // kept for a long time. Everything else (the entry page, sw.js, the manifest, robots.txt)
      // is checked again with the server on every use (docs/web-platform.md 11.4).
      const cache = found.name.startsWith(`assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      const headers = { "Content-Type": type, "Cache-Control": cache };
      send(res, 200, headers, await readFile(found.path), req.method === "HEAD");
      return true;
    },
    async shell() {
      const found = await fileInside(root, resolve(root, "index.html"));
      return found === null ? null : { html: await readFile(found.path) };
    },
  };
}

/** Create the production server. The caller decides the port and when to listen. */
export function createApp(options: ServerOptions): AppServer {
  const server = createSecuredServer();
  server.on(
    "request",
    requestListener({
      version: options.version,
      build: options.build,
      pages: staticPages(options.staticDir),
    }),
  );
  return server;
}
