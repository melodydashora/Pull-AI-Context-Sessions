// The production entry: `npm start`. It serves the built browser app (app/dist) and the server's
// own routes from one process on one port. Vite is not loaded here; development starts from dev.ts.
// The environment variables it reads are listed in start.ts.

import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import {
  buildOptions,
  closeOnSignal,
  listen,
  listenTarget,
  publishedImageProblem,
  startupLine,
} from "./start.ts";

// A published copy that holds the puller's private output does not start at all.
const problem = publishedImageProblem(process.env, fileURLToPath(new URL("../../..", import.meta.url)));
if (problem !== null) {
  console.error(problem);
  process.exit(1);
}

const { version, build } = buildOptions(process.env);
// Only the browser app's build output is served, never the workspace folder.
const staticDir = fileURLToPath(new URL("../../app/dist", import.meta.url));

const server = createApp({ staticDir, version, build });
const port = await listen(server, listenTarget(process.env));
console.log(startupLine({ version, build }, port, false));

closeOnSignal(() => new Promise((done) => server.close(() => done())));
