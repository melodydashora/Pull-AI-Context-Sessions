import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isHostAllowed } from "./app.ts";
import { createDevApp, type DevApp, developmentHosts, developmentNotice, developmentPolicy } from "./dev.ts";
import { ask, expectSecurityHeaders, HEADERS_11_4 } from "./test-support.ts";

const PRODUCTION_POLICY = HEADERS_11_4["Content-Security-Policy"] ?? "";
// A made-up name that stands for the workspace's development host.
const DEV_HOST = "workspace-dev.example";

describe("the development policy", () => {
  it("adds one nonce source to script-src and to style-src, and changes nothing else", () => {
    const nonce = "bm9uY2UtZm9yLWEtdGVzdA";
    const production = PRODUCTION_POLICY.split("; ");
    const development = developmentPolicy(nonce).split("; ");
    expect(development).toHaveLength(production.length);
    const changed = development.filter((directive, index) => directive !== production[index]);
    expect(changed).toEqual([`script-src 'self' 'nonce-${nonce}'`, `style-src 'self' 'nonce-${nonce}'`]);
    for (const kept of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ]) {
      expect(development).toContain(kept);
    }
    expect(developmentPolicy(nonce)).not.toContain("unsafe");
  });
});

describe("the development host", () => {
  it("is the exact name in REPLIT_DEV_DOMAIN", () => {
    expect(developmentHosts({ REPLIT_DEV_DOMAIN: DEV_HOST })).toEqual([DEV_HOST]);
    expect(developmentHosts({ REPLIT_DEV_DOMAIN: ` ${DEV_HOST}\n` })).toEqual([DEV_HOST]);
    expect(developmentHosts({ REPLIT_DEV_DOMAIN: "Workspace-Dev.Example" })).toEqual([DEV_HOST]);
    // On the hosting platform the suffix of its development addresses is allowed as well, so
    // that a changed workspace address is still answered. Would catch: "any host", or no suffix.
    const platformHost = "workspace-00-abc.cluster.replit.dev";
    expect(developmentHosts({ REPLIT_DEV_DOMAIN: platformHost })).toEqual([platformHost, ".replit.dev"]);
    const allowed = developmentHosts({ REPLIT_DEV_DOMAIN: platformHost });
    expect(isHostAllowed(platformHost, allowed)).toBe(true);
    expect(isHostAllowed("other-00-xyz.cluster.replit.dev:443", allowed)).toBe(true);
    for (const foreign of ["replit.dev.evil.example", "evilreplit.dev", "evil.example"]) {
      expect(isHostAllowed(foreign, allowed), foreign).toBe(false);
    }
  });

  it("is nothing when the variable is absent or is not a plain host name", () => {
    for (const value of [
      undefined,
      "",
      " ",
      ".example",
      "*.example",
      "a b.example",
      "https://x.example",
      "x.example/",
    ]) {
      const env = value === undefined ? {} : { REPLIT_DEV_DOMAIN: value };
      expect(developmentHosts(env), String(value)).toEqual([]);
    }
  });

  it("is announced as an https address, with the reason for opening it in its own tab", () => {
    const lines = developmentNotice({ REPLIT_DEV_DOMAIN: DEV_HOST, OTHER_VALUE: "OTHER-MARKER" });
    expect(lines[0]).toBe(`https://${DEV_HOST}/`);
    expect(lines[1]).toMatch(/its own browser tab/);
    expect(lines[1]).toMatch(/preview pane/);
    // The value appears once, as part of the address, and no other value appears at all.
    expect(lines.join("\n").split(DEV_HOST)).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("OTHER-MARKER");
    expect(developmentNotice({})).toEqual([]);
  });
});

describe("the development server", () => {
  let app: DevApp;
  let port: number;
  let cacheDir: string;

  beforeAll(async () => {
    // Vite reads this variable by itself. The test decides the list of hosts alone.
    delete process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS;
    cacheDir = await mkdtemp(join(tmpdir(), "sessionvault-dev-test-"));
    app = await createDevApp({ version: "9.8.7", build: "testbuild", hosts: [DEV_HOST], cacheDir });
    port = await new Promise<number>((done) => {
      app.server.listen(0, "127.0.0.1", () => done((app.server.address() as AddressInfo).port));
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }, 60_000);

  function nonceOf(policy: string | undefined): string {
    const match = /script-src 'self' 'nonce-([A-Za-z0-9+/]{24})'/.exec(policy ?? "");
    expect(match, "the page policy has a nonce").not.toBeNull();
    return match?.[1] ?? "";
  }

  it("serves the page with every header and a policy that differs by one nonce only", async () => {
    const page = await ask(port, "/");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["cache-control"]).toBe("no-cache");
    const policy = String(page.headers["content-security-policy"]);
    const nonce = nonceOf(policy);
    // Without the nonce source, the page's policy is the production policy, character for character.
    expect(policy.split(` 'nonce-${nonce}'`)).toHaveLength(3);
    expect(policy.replaceAll(` 'nonce-${nonce}'`, "")).toBe(PRODUCTION_POLICY);
    expect(policy).toBe(developmentPolicy(nonce));
    expectSecurityHeaders(page.headers, developmentPolicy(nonce));

    // Vite's page: its client, the entry module, and the nonce on every tag that needs one.
    expect(page.body).toContain('src="/@vite/client"');
    expect(page.body).toContain('src="/src/main.tsx"');
    const tags = page.body.match(/<(script|style|link rel="stylesheet")\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(3);
    for (const tag of tags) {
      expect(tag, tag).toContain(`nonce="${nonce}"`);
    }
    expect(page.body).toContain(`<meta property="csp-nonce" nonce="${nonce}">`);
    expect(page.body).not.toContain("SESSIONVAULT-CSP-NONCE");
  }, 60_000);

  it("makes a new nonce for every page response", async () => {
    const first = nonceOf(String((await ask(port, "/")).headers["content-security-policy"]));
    const second = nonceOf(String((await ask(port, "/")).headers["content-security-policy"]));
    expect(first).not.toBe(second);
  }, 60_000);

  it("answers deep links with the page and a missing file with 404, as in production", async () => {
    for (const path of ["/import", "/sessions/42", "/index.html"]) {
      const answer = await ask(port, path);
      expect(answer.status, path).toBe(200);
      expect(answer.body, path).toContain('src="/src/main.tsx"');
      expectSecurityHeaders(
        answer.headers,
        developmentPolicy(nonceOf(String(answer.headers["content-security-policy"]))),
      );
    }
    const head = await ask(port, "/import", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    for (const path of ["/missing.png", "/src/missing.ts", "/assets/app-00000000.js"]) {
      const answer = await ask(port, path);
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).toBe("Not found.");
      expectSecurityHeaders(answer.headers);
    }
  }, 60_000);

  it("answers its own routes itself, with the production policy", async () => {
    const version = await ask(port, "/api/version");
    expect(version.status).toBe(200);
    expect(JSON.parse(version.body)).toEqual({ name: "SessionVault", version: "9.8.7", build: "testbuild" });
    expect(version.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(version.headers["cache-control"]).toBe("no-store");
    expectSecurityHeaders(version.headers);

    const missing = await ask(port, "/api/nothing.js");
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body)).toEqual({
      error: { code: "not_found", message: "Not found.", retryable: false },
    });
    expect(missing.headers["cache-control"]).toBe("no-store");
    expectSecurityHeaders(missing.headers);

    const health = await ask(port, "/healthz");
    expect(health.status).toBe(200);
    expect(health.body).toBe("ok");
    expectSecurityHeaders(health.headers);

    const post = await ask(port, "/src/main.tsx", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    expectSecurityHeaders(post.headers);
  }, 60_000);

  it("lets Vite serve a module, a style sheet and a public file, with the headers", async () => {
    const module = await ask(port, "/src/build.ts");
    expect(module.status).toBe(200);
    expect(module.headers["content-type"]).toBe("text/javascript");
    expect(module.body).toContain("describeBuild");
    expectSecurityHeaders(module.headers);

    const client = await ask(port, "/@vite/client");
    expect(client.status).toBe(200);
    expectSecurityHeaders(client.headers);

    const style = await ask(port, "/src/app.css", { headers: { Accept: "text/css" } });
    expect(style.status).toBe(200);
    expect(style.headers["content-type"]).toBe("text/css");
    expectSecurityHeaders(style.headers);

    const robots = await ask(port, "/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.body).toBe("User-agent: *\nDisallow: /\n");
    expectSecurityHeaders(robots.headers);

    // No cross-origin reads, as in production.
    const cross = await ask(port, "/src/build.ts", { headers: { Origin: "http://localhost:3000" } });
    expect(cross.headers["access-control-allow-origin"]).toBeUndefined();
  }, 60_000);

  it("opens the hot-reload connection on the same port", async () => {
    const client = await ask(port, "/@vite/client");
    const token = /const wsToken = "([^"]+)"/.exec(client.body)?.[1];
    expect(token).toBeTruthy();
    // The client builds its address from the page's own host and port.
    expect(client.body).toContain("const hmrPort = null;");
    const first = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`, "vite-hmr");
      const timer = setTimeout(() => reject(new Error("no message from the hot-reload socket")), 20_000);
      socket.addEventListener("message", (event) => {
        clearTimeout(timer);
        socket.close();
        resolve(String(event.data));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("the hot-reload socket failed"));
      });
    });
    expect(JSON.parse(first)).toEqual({ type: "connected" });
  }, 60_000);

  it("refuses to read files outside the app, the core and the installed packages", async () => {
    const outside: Array<{ file: string; content: string }> = [];
    for (const file of [
      fileURLToPath(new URL("../../docs/web-platform.md", import.meta.url)),
      fileURLToPath(new URL("../../HANDOFF.md", import.meta.url)),
      fileURLToPath(new URL("./app.ts", import.meta.url)),
      fileURLToPath(new URL("../../../.replit", import.meta.url)),
      "/etc/hostname",
    ]) {
      if (existsSync(file)) {
        outside.push({ file, content: readFileSync(file, "utf8").slice(0, 200).trim() });
      }
    }
    expect(outside.length).toBeGreaterThanOrEqual(3);
    for (const { file, content } of outside) {
      expect(content.length, file).toBeGreaterThan(0);
      for (const query of [
        "",
        "?raw",
        "?import&raw",
        "?url",
        "?import&url",
        "?inline",
        "?import&inline",
        "?raw??",
        "?import&raw??",
      ]) {
        const path = `/@fs${file}${query}`;
        const answer = await ask(port, path);
        expect(answer.status, path).toBe(403);
        expect(answer.body, path).not.toContain(content);
        expectSecurityHeaders(answer.headers);
        // The same request as a browser sends it for a script.
        const script = await ask(port, path, { headers: { "Sec-Fetch-Dest": "script" } });
        expect(script.status, path).toBe(403);
        expect(script.body, path).not.toContain(content);
      }
    }
    // Paths that try to climb out of the app folder.
    const document = readFileSync(new URL("../../docs/web-platform.md", import.meta.url), "utf8")
      .slice(0, 200)
      .trim();
    for (const path of [
      "/../docs/web-platform.md",
      "/../docs/web-platform.md?raw",
      "/..%2fdocs/web-platform.md?raw",
      "/src/../../docs/web-platform.md?import&raw",
      "/@fs/../docs/web-platform.md",
    ]) {
      const answer = await ask(port, path);
      expect(answer.status, path).not.toBe(200);
      expect(answer.body, path).not.toContain(document);
    }
  }, 60_000);

  it("still reads the shared core, which is on the allow list", async () => {
    const core = fileURLToPath(new URL("../../core/src/index.ts", import.meta.url));
    const answer = await ask(port, `/@fs${core}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toContain("APP_NAME");
  }, 60_000);

  it("refuses a request under a foreign host name, on its own routes and on Vite's", async () => {
    for (const path of [
      "/",
      "/import",
      "/healthz",
      "/api/version",
      "/api/nothing",
      "/src/build.ts",
      "/@vite/client",
    ]) {
      for (const host of [
        "evil.example",
        `evil.example:${port}`,
        `sub.${DEV_HOST}`,
        `${DEV_HOST}.evil.example`,
      ]) {
        const answer = await ask(port, path, { headers: { Host: host } });
        expect(answer.status, `${host} ${path}`).toBe(403);
        expect(answer.body, `${host} ${path}`).not.toContain("evil");
        expect(answer.body, `${host} ${path}`).not.toContain("describeBuild");
        expect(answer.body, `${host} ${path}`).not.toContain("SessionVault");
        expect(answer.headers["cache-control"]).toBe("no-store");
        expectSecurityHeaders(answer.headers);
      }
    }
    const api = await ask(port, "/api/version", { headers: { Host: "evil.example" } });
    expect(api.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(api.body).error.code).toBe("host_not_allowed");
    expect(JSON.parse(api.body).error.retryable).toBe(false);
  }, 60_000);

  it("answers under the local names and under the development host", async () => {
    for (const host of [
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
      DEV_HOST,
      `${DEV_HOST}:443`,
    ]) {
      for (const path of ["/", "/api/version", "/src/build.ts"]) {
        const answer = await ask(port, path, { headers: { Host: host } });
        expect(answer.status, `${host} ${path}`).toBe(200);
      }
    }
  }, 60_000);

  it("refuses the hot-reload connection under a foreign host name", async () => {
    const upgrade = (host: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = request({
          host: "127.0.0.1",
          port,
          path: "/",
          agent: false,
          headers: {
            Host: host,
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": Buffer.from("0123456789abcdef").toString("base64"),
            "Sec-WebSocket-Protocol": "vite-hmr",
          },
        });
        req.on("upgrade", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        req.on("response", (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
    expect(await upgrade(`127.0.0.1:${port}`)).toBe(101);
    expect(await upgrade(DEV_HOST)).toBe(101);
    expect(await upgrade("evil.example")).toBe(400);
  }, 60_000);
});
