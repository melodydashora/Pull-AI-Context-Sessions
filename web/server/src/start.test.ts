import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOptions, listenTarget, publishedImageProblem, startupLine } from "./start.ts";
import { ask, expectSecurityHeaders } from "./test-support.ts";

describe("start-up", () => {
  it("listens on PORT, or on 5000, at 0.0.0.0 unless HOST is set", () => {
    expect(listenTarget({})).toEqual({ port: 5000, host: "0.0.0.0" });
    expect(listenTarget({ PORT: "8123" })).toEqual({ port: 8123, host: "0.0.0.0" });
    expect(listenTarget({ PORT: "", HOST: "" })).toEqual({ port: 5000, host: "0.0.0.0" });
    expect(listenTarget({ PORT: "not a number" })).toEqual({ port: 5000, host: "0.0.0.0" });
    expect(listenTarget({ PORT: "8123", HOST: "127.0.0.1" })).toEqual({ port: 8123, host: "127.0.0.1" });
  });

  it("takes the build id from BUILD_ID and the version from package.json", () => {
    expect(buildOptions({ BUILD_ID: "abc1234" }).build).toBe("abc1234");
    expect(buildOptions({}).build).toBe("dev");
    expect(buildOptions({}).version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("writes the port in its start-up line", () => {
    const info = { version: "1.2.3", build: "abc1234" };
    expect(startupLine(info, 8123, false)).toBe(
      "SessionVault 1.2.3 (build abc1234) is listening on port 8123",
    );
    // Development names no value of the environment besides the port.
    expect(startupLine(info, 8123, true)).toBe("SessionVault 1.2.3 (development) is listening on port 8123");
  });
});

// docs/web-platform.md 10.13, rule 3. Would catch: a published app that starts although the
// puller's private output is part of its files, or a workspace that refuses to start because
// the owner pulled sessions there.
describe("the tripwire for private files in a published app", () => {
  it("refuses a published copy with a sessions folder at the top, and nothing else", async () => {
    const top = await mkdtemp(join(tmpdir(), "sessionvault-top-"));
    try {
      expect(publishedImageProblem({ REPLIT_DEPLOYMENT: "1" }, top)).toBeNull();
      await writeFile(join(top, "sessions"), "a file of that name is not the puller's folder");
      expect(publishedImageProblem({ REPLIT_DEPLOYMENT: "1" }, top)).toBeNull();
      await rm(join(top, "sessions"));
      await mkdir(join(top, "sessions"));
      const problem = publishedImageProblem({ REPLIT_DEPLOYMENT: "1" }, top);
      expect(problem).toContain("sessions");
      expect(problem).toContain(".replitignore");
      // The message names no path of the machine.
      expect(problem).not.toContain(top);
      // In the workspace, where the owner may run the puller, the folder is allowed.
      expect(publishedImageProblem({}, top)).toBeNull();
      expect(publishedImageProblem({ REPLIT_DEPLOYMENT: "0" }, top)).toBeNull();
    } finally {
      await rm(top, { recursive: true, force: true });
    }
  });

  it("is checked by the production entry before anything listens", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const check = source.indexOf("publishedImageProblem(process.env");
    expect(check).toBeGreaterThan(-1);
    expect(source.indexOf("process.exit(1)")).toBeGreaterThan(check);
    expect(source.indexOf("createApp(")).toBeGreaterThan(source.indexOf("process.exit(1)"));
  });
});

/** A port that was free a moment ago. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

describe("the production entry", () => {
  it("starts on PORT without loading Vite, and logs the port", async () => {
    const port = await freePort();
    // The child stops with an error if anything asks for the package "vite".
    const guard =
      'import { registerHooks } from "node:module";' +
      "registerHooks({ resolve(specifier, context, next) {" +
      '  if (specifier === "vite" || specifier.startsWith("vite/")) throw new Error("vite was loaded");' +
      "  return next(specifier, context);" +
      "} });";
    const child = spawn(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(guard)}`,
        fileURLToPath(new URL("./main.ts", import.meta.url)),
      ],
      {
        // Only what the server reads. Nothing else of this machine's environment reaches the child.
        env: { PATH: process.env.PATH ?? "", PORT: String(port), HOST: "127.0.0.1", BUILD_ID: "entrytest" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const exited = new Promise<void>((done) => {
      child.once("exit", () => done());
    });
    try {
      const started = Date.now();
      while (
        !output.includes("is listening on port") &&
        child.exitCode === null &&
        Date.now() - started < 30_000
      ) {
        await new Promise((tick) => setTimeout(tick, 50));
      }
      expect(output).toMatch(
        new RegExp(
          `^SessionVault \\d+\\.\\d+\\.\\d+ \\(build entrytest\\) is listening on port ${port}$`,
          "m",
        ),
      );

      const version = await ask(port, "/api/version");
      expect(version.status).toBe(200);
      expect(JSON.parse(version.body)).toMatchObject({ name: "SessionVault", build: "entrytest" });
      expectSecurityHeaders(version.headers);
      expect((await ask(port, "/healthz")).body).toBe("ok");
      // "/" answers at once, with or without a build in app/dist.
      expect([200, 404]).toContain((await ask(port, "/")).status);
    } finally {
      child.kill("SIGTERM");
      await exited;
    }
    expect(output).not.toContain("vite was loaded");
    expect(child.exitCode).toBe(0);
  }, 60_000);
});
