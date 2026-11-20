import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type AppServer,
  CONTENT_SECURITY_POLICY,
  createApp,
  createSecuredServer,
  isAppRoute,
  isHostAllowed,
  requestListener,
  resolveInside,
  SECURITY_HEADERS,
} from "./app.ts";
import { ask, exchange, expectSecurityHeaders, HEADERS_11_4 } from "./test-support.ts";

const SECRET = "must not be served";
const HTML = "text/html; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";
const IMMUTABLE = "public, max-age=31536000, immutable";

let outside: string;
let root: string;
let server: AppServer;
let port: number;

function listen(app: AppServer): Promise<number> {
  return new Promise((done) => {
    app.listen(0, "127.0.0.1", () => done((app.address() as AddressInfo).port));
  });
}

function close(app: AppServer): Promise<void> {
  return new Promise((done) => {
    app.close(() => done());
  });
}

beforeAll(async () => {
  outside = await mkdtemp(join(tmpdir(), "sessionvault-server-test-"));
  root = join(outside, "dist");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><title>entry page</title>");
  await writeFile(join(root, "assets", "app-B1gHash9.js"), "console.log('app')");
  await writeFile(join(root, "assets", "app-C2ssHash.css"), "body { margin: 0 }");
  await writeFile(join(root, "robots.txt"), "User-agent: *\nDisallow: /\n");
  await writeFile(join(root, "sw.js"), "// service worker");
  await writeFile(join(root, "manifest.webmanifest"), "{}");
  // A file next to the served folder: it must never be reachable.
  await writeFile(join(outside, "private.txt"), SECRET);
  // Symbolic links planted inside the served folder.
  await symlink(join(outside, "private.txt"), join(root, "link.txt"));
  await symlink(join(outside, "private.txt"), join(root, "link"));
  await symlink(outside, join(root, "assets", "outside"));
  await symlink(join(root, "robots.txt"), join(root, "shortcut.txt"));
  server = createApp({ staticDir: root, version: "9.8.7", build: "testbuild" });
  port = await listen(server);
});

afterAll(async () => {
  await close(server);
  await rm(outside, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the response headers of docs/web-platform.md 11.4", () => {
  it("uses the exact policy string", () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    );
    expect(SECURITY_HEADERS).toEqual(HEADERS_11_4);
  });

  it("matches the header list in the document itself", () => {
    const document = readFileSync(new URL("../../docs/web-platform.md", import.meta.url), "utf8");
    const section = document.slice(document.indexOf("### 11.4 "));
    const start = section.indexOf("```text\n") + "```text\n".length;
    const block = section.slice(start, section.indexOf("\n```", start));
    const listed = Object.fromEntries(
      block
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]),
    );
    expect(listed).toEqual(HEADERS_11_4);
  });
});

// Every class of response the production server can give, with the caching rule of 11.4.
const CLASSES: ReadonlyArray<{
  name: string;
  path: string;
  method?: string;
  status: number;
  type: string;
  cache: string;
}> = [
  { name: "the entry page", path: "/", status: 200, type: HTML, cache: "no-cache" },
  { name: "the entry page for a deep link", path: "/import", status: 200, type: HTML, cache: "no-cache" },
  {
    name: "the entry page for a longer link",
    path: "/sessions/42/",
    status: 200,
    type: HTML,
    cache: "no-cache",
  },
  { name: "index.html by name", path: "/index.html", status: 200, type: HTML, cache: "no-cache" },
  {
    name: "a script with a content hash",
    path: "/assets/app-B1gHash9.js",
    status: 200,
    type: "text/javascript; charset=utf-8",
    cache: IMMUTABLE,
  },
  {
    name: "a style sheet with a content hash",
    path: "/assets/app-C2ssHash.css",
    status: 200,
    type: "text/css; charset=utf-8",
    cache: IMMUTABLE,
  },
  { name: "robots.txt", path: "/robots.txt", status: 200, type: TEXT, cache: "no-cache" },
  {
    name: "the service worker",
    path: "/sw.js",
    status: 200,
    type: "text/javascript; charset=utf-8",
    cache: "no-cache",
  },
  {
    name: "the manifest",
    path: "/manifest.webmanifest",
    status: 200,
    type: "application/manifest+json",
    cache: "no-cache",
  },
  {
    name: "a missing file with an extension",
    path: "/missing.png",
    status: 404,
    type: TEXT,
    cache: "no-store",
  },
  { name: "a missing asset", path: "/assets/app-00000000.js", status: 404, type: TEXT, cache: "no-store" },
  { name: "the health check", path: "/healthz", status: 200, type: TEXT, cache: "no-store" },
  { name: "the version route", path: "/api/version", status: 200, type: JSON_TYPE, cache: "no-store" },
  {
    name: "an unknown path under /api/",
    path: "/api/nothing",
    status: 404,
    type: JSON_TYPE,
    cache: "no-store",
  },
  { name: "/api itself", path: "/api", status: 404, type: JSON_TYPE, cache: "no-store" },
  { name: "POST to a page", path: "/", method: "POST", status: 405, type: TEXT, cache: "no-store" },
  { name: "POST to a file", path: "/robots.txt", method: "POST", status: 405, type: TEXT, cache: "no-store" },
  {
    name: "POST under /api/",
    path: "/api/version",
    method: "POST",
    status: 405,
    type: JSON_TYPE,
    cache: "no-store",
  },
  {
    name: "DELETE under /api/",
    path: "/api/nothing",
    method: "DELETE",
    status: 405,
    type: JSON_TYPE,
    cache: "no-store",
  },
  {
    name: "a request that names no path",
    path: "*",
    method: "OPTIONS",
    status: 400,
    type: TEXT,
    cache: "no-store",
  },
];

describe("every class of response", () => {
  for (const item of CLASSES) {
    it(`${item.name}: status, every header, content type and caching`, async () => {
      const answer = await ask(port, item.path, item.method === undefined ? {} : { method: item.method });
      expect(answer.status).toBe(item.status);
      expectSecurityHeaders(answer.headers);
      expect(answer.headers["content-type"]).toBe(item.type);
      expect(answer.headers["cache-control"]).toBe(item.cache);
      expect(answer.headers["access-control-allow-origin"]).toBeUndefined();

      if (item.method === undefined) {
        // The same request with HEAD: the same headers, and no body.
        const head = await ask(port, item.path, { method: "HEAD" });
        expect(head.status).toBe(item.status);
        expect(head.body).toBe("");
        expectSecurityHeaders(head.headers);
        expect(head.headers["content-type"]).toBe(item.type);
        expect(head.headers["cache-control"]).toBe(item.cache);
        expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(answer.body)));
      }
    });
  }
});

describe("routes", () => {
  it("answers the health check", async () => {
    expect((await ask(port, "/healthz")).body).toBe("ok");
  });

  it("reports name, version and build", async () => {
    const answer = await ask(port, "/api/version");
    expect(JSON.parse(answer.body)).toEqual({ name: "SessionVault", version: "9.8.7", build: "testbuild" });
  });

  it("answers / and deep links with the entry page", async () => {
    for (const path of [
      "/",
      "/import",
      "/sessions/42",
      "/sessions/42/",
      "/index.html",
      "/import?from=share",
    ]) {
      const answer = await ask(port, path);
      expect(answer.status, path).toBe(200);
      expect(answer.body, path).toContain("entry page");
    }
  });

  it("serves the files of the app", async () => {
    expect((await ask(port, "/assets/app-B1gHash9.js")).body).toBe("console.log('app')");
    expect((await ask(port, "/robots.txt")).body).toBe("User-agent: *\nDisallow: /\n");
  });

  it("answers a missing file that has an extension with 404, never with the entry page", async () => {
    for (const path of [
      "/missing.png",
      "/assets/app-00000000.js",
      "/import.html",
      "/sessions/42/photo.jpg",
    ]) {
      const answer = await ask(port, path);
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).toBe("Not found.");
    }
  });

  it("answers unknown paths under /api/ with the JSON error shape, never with the entry page", async () => {
    for (const path of [
      "/api",
      "/api/",
      "/api/nothing",
      "/api/version/extra",
      "/api/sessions/42",
      "/api/a.png",
    ]) {
      const answer = await ask(port, path);
      expect(answer.status, path).toBe(404);
      expect(JSON.parse(answer.body), path).toEqual({
        error: { code: "not_found", message: "Not found.", retryable: false },
      });
    }
  });

  it("never repeats the request in an error message", async () => {
    const marker = "ECHO-MARKER-7f3a";
    for (const path of [`/api/${marker}`, `/${marker}.png`, `/api/${marker}?q=${marker}`]) {
      for (const method of ["GET", "POST"]) {
        const answer = await ask(port, path, { method, headers: { "X-Marker": marker } });
        expect(answer.body, `${method} ${path}`).not.toContain(marker);
      }
    }
  });

  it("refuses other methods with 405 and an Allow header", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const api = await ask(port, "/api/version", { method });
      expect(api.status, method).toBe(405);
      expect(api.headers.allow, method).toBe("GET, HEAD");
      expect(JSON.parse(api.body), method).toEqual({
        error: { code: "method_not_allowed", message: "Method not allowed.", retryable: false },
      });

      const page = await ask(port, "/import", { method });
      expect(page.status, method).toBe(405);
      expect(page.headers.allow, method).toBe("GET, HEAD");
      expect(page.body, method).toBe("Method not allowed.");
    }
  });

  it("accepts a request line in absolute form", async () => {
    const answer = await ask(port, "http://app.example/api/version");
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body).name).toBe("SessionVault");
  });
});

describe("files outside the served folder", () => {
  it("never answers a traversal attempt with a file", async () => {
    const absolute = join(outside, "private.txt");
    const attempts = [
      // dot segments
      "/../private.txt",
      "/./../private.txt",
      "/assets/../../private.txt",
      "/assets/../../../../../../private.txt",
      "//..//private.txt",
      "/....//private.txt",
      "/..;/private.txt",
      // percent-encoded dot segments
      "/%2e%2e/private.txt",
      "/%2E%2E/private.txt",
      "/.%2e/private.txt",
      "/%2e./private.txt",
      "/assets/%2e%2e/%2e%2e/private.txt",
      // percent-encoded slashes
      "/..%2fprivate.txt",
      "/..%2Fprivate.txt",
      "/assets/..%2f..%2fprivate.txt",
      "/%2e%2e%2fprivate.txt",
      "/assets%2f..%2f..%2fprivate.txt",
      // double encoding
      "/%252e%252e/private.txt",
      "/%252e%252e%252fprivate.txt",
      "/..%252fprivate.txt",
      "/%25252e%25252e/private.txt",
      // backslashes
      "/..\\private.txt",
      "/assets\\..\\..\\private.txt",
      "/..%5cprivate.txt",
      "/..%5Cprivate.txt",
      "/assets%5c..%5c..%5cprivate.txt",
      // a null byte
      "/%00",
      "/private.txt%00",
      "/..%2fprivate.txt%00.txt",
      "/assets/app-B1gHash9.js%00/../../private.txt",
      // an absolute path
      absolute,
      `/${absolute}`,
      `/%2F${absolute.slice(1)}`,
      `/assets/${absolute}`,
      // bad encoding
      "/%E0%A4%A/private.txt",
      "/%/private.txt",
    ];
    for (const path of attempts) {
      const answer = await ask(port, path);
      expect(answer.body, path).not.toContain(SECRET);
      expect(answer.status, path).toBe(404);
      expectSecurityHeaders(answer.headers);
    }
  });

  // docs/web-platform.md 10.13, rule 1, names these six. Would catch: a server that falls back
  // to the folder above its build output.
  it("answers the six paths of the workspace rule with the entry page or 404, never the file", async () => {
    const planted = [
      ".replit",
      "package.json",
      ".git/config",
      "puller/pull_sessions.py",
      "sessions/session_EXAMPLE.md",
      "web/docs/web-platform.md",
    ];
    for (const name of planted) {
      await mkdir(join(outside, name, ".."), { recursive: true });
      await writeFile(join(outside, name), SECRET);
    }
    for (const path of [
      "/.replit",
      "/.git/config",
      "/package.json",
      "/puller/pull_sessions.py",
      "/sessions/",
      "/web/docs/web-platform.md",
    ]) {
      const answer = await ask(port, path);
      expect([200, 404], path).toContain(answer.status);
      if (answer.status === 200) {
        expect(answer.headers["content-type"], path).toBe(HTML);
        expect(answer.body, path).toContain("entry page");
      }
      expect(answer.body, path).not.toContain(SECRET);
    }
  });

  it("does not answer a raw null byte with a file", async () => {
    const reply = await exchange(port, "GET /\0/../private.txt HTTP/1.1\r\nHost: localhost\r\n\r\n");
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect(reply).not.toContain(SECRET);
  });

  it("does not follow a symbolic link that leaves the folder", async () => {
    // A link to a file outside, with and without an extension, and a link to a folder outside.
    const file = await ask(port, "/link.txt");
    expect(file.status).toBe(404);
    expect(file.body).not.toContain(SECRET);

    const route = await ask(port, "/link");
    expect(route.status).toBe(200);
    expect(route.body).toContain("entry page");
    expect(route.body).not.toContain(SECRET);

    const folder = await ask(port, "/assets/outside/private.txt");
    expect(folder.status).toBe(404);
    expect(folder.body).not.toContain(SECRET);
  });

  it("still serves a symbolic link that stays inside the folder", async () => {
    const answer = await ask(port, "/shortcut.txt");
    expect(answer.status).toBe(200);
    expect(answer.body).toBe("User-agent: *\nDisallow: /\n");
  });

  it("refuses the entry page itself when it is a link to a file outside", async () => {
    const other = await mkdtemp(join(tmpdir(), "sessionvault-server-test-"));
    try {
      await mkdir(join(other, "dist"));
      await writeFile(join(other, "private.html"), SECRET);
      await symlink(join(other, "private.html"), join(other, "dist", "index.html"));
      const app = createApp({ staticDir: join(other, "dist"), version: "1.0.0", build: "t" });
      const otherPort = await listen(app);
      try {
        for (const path of ["/", "/index.html", "/import"]) {
          const answer = await ask(otherPort, path);
          expect(answer.status, path).toBe(404);
          expect(answer.body, path).not.toContain(SECRET);
        }
      } finally {
        await close(app);
      }
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("resolves request paths inside the folder only", () => {
    expect(resolveInside(root, "/")).toBe(root);
    expect(resolveInside(root, "/assets/app-B1gHash9.js")).toBe(join(root, "assets", "app-B1gHash9.js"));
    expect(resolveInside(root, "/assets/../index.html")).toBe(join(root, "index.html"));
    for (const path of [
      "/../private.txt",
      "/%2e%2e/private.txt",
      "/..%2fprivate.txt",
      "/assets/..%2f..%2fprivate.txt",
      "/..%5cprivate.txt",
      "/..\\private.txt",
      "/%00",
      "/%E0%A4%A",
    ]) {
      expect(resolveInside(root, path), path).toBeNull();
    }
  });
});

describe("unexpected failures", () => {
  const DETAIL = "SECRET-DETAIL in /home/someone/private/file.txt";
  let failing: AppServer;
  let failingPort: number;

  beforeAll(async () => {
    failing = createSecuredServer();
    failing.on(
      "request",
      requestListener({
        build: "testbuild",
        get version(): string {
          throw new Error(DETAIL);
        },
        pages: {
          file: async () => {
            throw new TypeError(DETAIL);
          },
          shell: async () => null,
        },
      }),
    );
    failingPort = await listen(failing);
  });

  afterAll(async () => {
    await close(failing);
  });

  it("answers 500 in the JSON error shape under /api/, with a request id that is also logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const answer = await ask(failingPort, "/api/version?token=QUERY-MARKER");
    expect(answer.status).toBe(500);
    expectSecurityHeaders(answer.headers);
    expect(answer.headers["content-type"]).toBe(JSON_TYPE);
    expect(answer.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(answer.body) as { error: { details: { requestId: string } } };
    const requestId = body.error.details.requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      error: {
        code: "internal",
        message: `Internal error. Request id: ${requestId}`,
        retryable: false,
        details: { requestId },
      },
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual([`request ${requestId} failed: GET api Error`]);
  });

  it("answers 500 as plain text elsewhere", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const answer = await ask(failingPort, "/import?token=QUERY-MARKER");
    expect(answer.status).toBe(500);
    expectSecurityHeaders(answer.headers);
    expect(answer.headers["content-type"]).toBe(TEXT);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(answer.body).toMatch(/^Internal error\. Request id: [0-9a-f-]{36}$/);
    expect(log.mock.calls[0]?.[0]).toMatch(/^request [0-9a-f-]{36} failed: GET page TypeError$/);

    const head = await ask(failingPort, "/import", { method: "HEAD" });
    expect(head.status).toBe(500);
    expect(head.body).toBe("");
    expectSecurityHeaders(head.headers);
  });

  it("never shows an error message, a stack trace or the request, in the answer or in the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const path of ["/api/version?token=QUERY-MARKER", "/import/PATH-MARKER?token=QUERY-MARKER"]) {
      const answer = await ask(failingPort, path, { headers: { Cookie: "session=COOKIE-MARKER" } });
      const seen = `${answer.body}\n${JSON.stringify(answer.headers)}\n${JSON.stringify(log.mock.calls)}`;
      for (const forbidden of ["SECRET-DETAIL", "/home/someone", "MARKER", "    at ", ".ts:"]) {
        expect(seen, `${path}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("answers that Node gives by itself", () => {
  it("carry the headers too (a request without a Host header)", async () => {
    const reply = await exchange(port, "GET / HTTP/1.1\r\n\r\n");
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    for (const [name, value] of Object.entries(HEADERS_11_4)) {
      expect(reply).toContain(`${name}: ${value}\r\n`);
    }
  });

  it("are a bare status line with no content when the request cannot be parsed at all", async () => {
    // The one answer of the production server without the headers: Node writes it straight to
    // the connection, before any response object exists.
    for (const garbage of ["NOT HTTP AT ALL\r\n\r\n", "GET /\0 HTTP/1.1\r\nHost: localhost\r\n\r\n"]) {
      const reply = await exchange(port, garbage);
      expect(reply).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/);
      expect(reply.slice(reply.indexOf("\r\n\r\n") + 4)).toBe("");
    }
  });
});

describe("isAppRoute", () => {
  it("accepts plain paths without a file extension", () => {
    for (const path of ["/", "/import", "/sessions/42", "/sessions/42/", "/a.b/c", "/.well-known/thing"]) {
      expect(isAppRoute(path), path).toBe(true);
    }
  });

  it("refuses paths with a file extension and paths that cannot name a route", () => {
    for (const path of [
      "/app.js",
      "/a/b.png",
      "/name.",
      "/%2e%2e%2fsecret",
      "/a/..%2f..%2fb",
      "/%zz",
      "/a%00",
      "/a%5cb",
    ]) {
      expect(isAppRoute(path), path).toBe(false);
    }
  });
});

describe("isHostAllowed", () => {
  const allowed = ["workspace-dev.example"];

  it("always accepts local names and IP addresses, as Vite does", () => {
    for (const host of [
      "localhost",
      "localhost:5000",
      "app.localhost",
      "a.b.localhost:8080",
      "127.0.0.1",
      "127.0.0.1:5000",
      "10.1.2.3:80",
      "[::1]",
      "[::1]:5000",
    ]) {
      expect(isHostAllowed(host, []), host).toBe(true);
    }
    expect(isHostAllowed(undefined, [])).toBe(true);
  });

  it("accepts a listed name exactly, with or without a port", () => {
    for (const host of ["workspace-dev.example", "workspace-dev.example:443", " workspace-dev.example "]) {
      expect(isHostAllowed(host, allowed), host).toBe(true);
    }
  });

  it("refuses every other name", () => {
    for (const host of [
      "evil.example",
      "sub.workspace-dev.example",
      "workspace-dev.example.evil.example",
      "evil-workspace-dev.example",
      "notlocalhost",
      "localhost.evil.example",
      "127.0.0.1.evil.example",
      "[::1",
      "[not-an-address]",
      "",
    ]) {
      expect(isHostAllowed(host, allowed), host).toBe(false);
    }
  });

  it("lets an entry that starts with a dot cover the name and the names below it", () => {
    expect(isHostAllowed("a.platform.example", [".platform.example"])).toBe(true);
    expect(isHostAllowed("a.b.platform.example:443", [".platform.example"])).toBe(true);
    expect(isHostAllowed("platform.example", [".platform.example"])).toBe(true);
    expect(isHostAllowed("evilplatform.example", [".platform.example"])).toBe(false);
  });
});
