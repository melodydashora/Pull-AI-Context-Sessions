// Helpers for the server's tests. Not part of the running server.
//
// The tests send their requests with node:http and node:net, not with fetch: fetch tidies an
// address before it sends it (it removes "..", for example), so the server would never see the
// requests that the tests are about.

import { type IncomingHttpHeaders, request } from "node:http";
import { connect } from "node:net";
import { expect } from "vitest";

/** The header list of docs/web-platform.md 11.4, written out again here on purpose. */
export const HEADERS_11_4: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=31536000",
};

export interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface AskOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Send one request. `path` goes on the wire exactly as written. */
export function ask(port: number, path: string, options: AskOptions = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: { ...options.headers },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Write raw bytes to the server and return everything it sends back until it closes. */
export function exchange(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.setTimeout(5000, () => socket.destroy());
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
    socket.on("error", reject);
    socket.write(Buffer.from(text, "latin1"));
  });
}

/**
 * Assert that a response carries every header of 11.4 with exactly the documented value.
 * `policy` is given when the response is the development page, whose policy has a nonce.
 */
export function expectSecurityHeaders(
  headers: IncomingHttpHeaders,
  policy = HEADERS_11_4["Content-Security-Policy"],
): void {
  const expected: Record<string, string | undefined> = {};
  const actual: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(HEADERS_11_4)) {
    expected[name] = name === "Content-Security-Policy" ? policy : value;
    actual[name] = headers[name.toLowerCase()];
  }
  expect(actual).toEqual(expected);
}
