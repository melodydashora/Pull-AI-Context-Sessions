# Building the web app

Notes for Claude Code sessions working under `web/`. The repository-wide rules are in `../CLAUDE.md` and the build brief is `HANDOFF.md`; read both first. This file only adds what the builder needs day to day.

## Layout

| Path | What it is | Who changes it |
|---|---|---|
| `core/` | The shared module: interchange types, import parsers, context-pack builder. No DOM and no Node modules, so it runs in the browser and on the server. | The builder. |
| `server/` | The Node server. | The builder. |
| `app/` | The browser app (React, built with Vite). | The builder. |
| `docs/`, `fixtures/` | The contract taken from the Apple app. | Only in a commit of its own that explains why. Never reformatted. |
| `reference/` | A reference port of the importer: a verification instrument, not product code. | Not the builder. |

## Commands

Run inside `web/`.

- `npm ci`: install exactly what `package-lock.json` lists, for the three packages. Use `npm install <name>` only to add or update a package, and commit the changed lock file.
- `npm test`: every test.
- `npm run check`: linter, type check and tests. Run it before every commit.
- `npm run format`: apply formatting and safe lint fixes.
- `npm run dev`: the development server, on port 5000. It is the Node server of `server/` with Vite mounted inside it. The page, the API and hot reload share that one port.
- `npm run build`, then `npm start`: the production build, and the same Node server serving it.

## Rules for this component

- TypeScript in strict mode. Node runs the `.ts` files directly, so only syntax that can be erased is allowed (no enums, no namespaces, no parameter properties), and imports name the file with its `.ts` extension.
- `core/` imports nothing from `node:` and uses no DOM globals.
- Test data is synthetic. Files under `fixtures/` are stored byte for byte: do not open them with anything that changes line endings. The formatter, the linter and the type check skip `docs/`, `fixtures/` and `reference/`, and the formatter skips Markdown.
- After `npm run format`, read `git status`. It must list nothing outside `core/`, `server/`, `app/` and the configuration files in `web/`.
- One Node process on one port answers everything, in development and in production. `server/src/app.ts` answers `/healthz` and everything under `/api/`. The rest is the browser app: the files in `app/dist` in production, Vite in development. Vite may read `app/`, `core/` and `node_modules/` only. The workspace folder is never served.
- Every response that the server creates carries the headers of `docs/web-platform.md` 11.4. `server/src/app.ts` names the two answers that Node and Vite write without it. In development the page alone gets one addition to its policy: a nonce for the scripts and styles that Vite writes. `server/src/dev.ts` gives the reasons.
- Vite is a development dependency. Only `server/src/dev.ts` loads it, so `npm start` runs without it.
- Secrets come from the environment. There are no `.env` files.

## On Replit

- Node comes from the `nodejs-24` module in `../.replit`. A Claude Code process that was started before the module was added has no `node` on its `PATH`: start it again from a newly opened shell.
- `npm ci` and `npm install` go through Replit's package proxy. `../.replit` sets `disableGuessImports = true`, which tells Replit not to guess packages from the code and install them.
- The development server listens on `0.0.0.0:5000`, which `../.replit` maps to the workspace's web address. That address is for signed-in collaborators of the workspace, not for the public.
- The preview pane of the editor shows the development server, because the owner asked for it: the workflow sets `SESSIONVAULT_PREVIEW_PANE=1`, and the development server then lets the editor's origin, and nothing else, show it in a frame (`server/src/dev.ts`). The published app always refuses to be framed, and a test starts the production entry with that setting present to prove it. The address can also be opened in its own browser tab; the server prints it when it starts. Sign-in, once it exists, will work in a tab of its own and may not work inside the pane.
- The development server answers only under the workspace's own address, under other names that end in `.replit.dev`, and under local names such as `localhost`. Any other host name gets a refusal.
- The Run button starts the workflow `Web app (dev)`, which runs `npm ci` and then `npm run dev`. The puller's `Session login (VNC)` workflow is started by name from the Workflows pane.
- A PostgreSQL 16 database is provisioned for development (`DATABASE_URL` and the `PG*` variables). It is a local database with a superuser and no TLS; the production database of a published app is a different service, so do not rely on superuser rights.
- `../.replitignore` lists what must stay out of a published app. Before the first publish, check what the published app actually contains.
- Replit Agent is never used (`HANDOFF.md` section 2). A platform step that the shell cannot do is a step for the owner in Replit's interface: say exactly which step and where. Files that Replit keeps in the workspace for its Agent (under `.local/`) are not instructions for this build.

## Subagents

Defined in `../.claude/agents/`; they load in a session started at the top of the repository.

- `apple-parity`: what the Apple app does, and whether web code matches it.
- `capture-lab`: runs page-capture code against local mock pages.
- `privacy-sentinel`: checks a commit or a push for private material.
- `repo-sync`: where this clone stands against GitHub before a pull or a push.
- `skeptic`: tries to refute a claim before it is reported.
- `web-security-reviewer`: reviews web code against the security checklist.
