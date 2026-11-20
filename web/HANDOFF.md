# SessionVault for the web: build handoff

Start here. This document says what to build, in what order, and how to know each step is done. The detail lives in `docs/` and `fixtures/` next to it.

Written 2026-11-20 from the Apple app's source (`../apple/`) by the session that consolidated this repository. The builder is a Claude Code session working in the Replit workspace of this repository. The Apple app cannot be built or run there; this handoff and the Swift source are the only description of its behaviour.

## 1. What this is

SessionVault keeps a person's AI chat sessions in one private vault, lets them organise and search those sessions, and carries their context into a new conversation: either as a "context pack" pasted into any model, or by continuing the session with Claude inside the app.

The Apple app does this for one person on Mac, iPhone and iPad. The web app does it for anyone, in any browser: Android, Windows, Chromebook, and Apple devices too.

**What matters most.** The owner depends above all on the context pipeline: getting a conversation in (capture and import), and getting its context out again in a form another model can use (the context pack). Accounts, sync and the Claude features exist to serve that pipeline. When priorities conflict, the pipeline wins, and it is the part that must be tested most thoroughly.

**How it is used.** The owner asks free-form questions about a saved session, of a model of her choosing, and takes the answer elsewhere. So: no preset questions and no forced output formats; the model list is the user's choice, not a fixed menu; and every message and every reply can be copied whole with one action, not only code blocks.

## 2. Decisions already made by the owner

These are settled. Do not reopen them; build for them. Where a document under `docs/` disagrees with this section, this section wins (see section 5).

| Decision | Choice |
|---|---|
| Audience | A product for other people from day one: accounts, each person with a private vault. |
| Claude API key | Each user brings their own Anthropic API key. The owner does not pay for anyone's usage. |
| Where sessions live | An online vault (so a session saved on one device appears on the others) plus an offline copy on each device. |
| Repository | Public on GitHub while this work is in progress; the owner will make it private later. Treat everything committed as public and permanent. |
| Builder | Claude Code in the Replit shell. Replit Agent is used only for platform setup such as provisioning the database. |
| Apple app | Stays. It remains the native version; the two exchange sessions through the JSON interchange format in `docs/data-model.md`. |

## 3. Recommended approach, and the choices left open

Recommended unless the builder finds a concrete reason against it in the Replit environment. State the reason in a commit message if you deviate.

- **TypeScript end to end.** A React + Vite single-page app, installable as a PWA and usable at phone width; a small Node server; PostgreSQL.
- **One shared core module** with no DOM and no Node dependencies: the interchange types, the import parsers and the context-pack builder. It runs in the browser and on the server and is tested against the golden files in `fixtures/`.
- **The server is the source of truth for the vault.** Every row belongs to one user. The browser keeps a copy in IndexedDB for offline reading and queues changes made offline (phase 5).
- **Claude is called by the server with the signed-in user's own key.** Anthropic's documentation says to call the API from a back end, not from code in the browser, and refuses direct browser calls for some organisations. So each user's key is stored on the server, encrypted with a key that lives in the platform's secret store, used only for that user's requests, never sent back to the browser, and removable by the user at any time. `docs/claude-api.md` describes the server side in detail for a single key; the per-user variant is one of the revisions listed in section 5.

Open choices, each with a default the builder may take without asking:

1. **Sign-in method.** Default: e-mail sign-in through a maintained library or hosted provider; never hand-written password storage. `docs/web-platform.md` compares what the platform offers, and notes which options only Replit Agent can set up.
2. **Who may sign up at first.** Default: invitation only (an allow-list of e-mail addresses or invitation codes held in configuration) until the owner opens sign-up. The app must be safe for strangers before that switch is flipped (phase 6).
3. **How link capture runs in deployment** (phase 3). Capture of public share links is part of the product, not an extra. The workspace can launch a headless Chromium today; whether a deployed app can is not yet known. If it cannot, keep the capture code behind one interface and say so, so that it can run somewhere that can.

Facts about the Replit workspace, measured on 2026-11-20 by the session working there:

- PostgreSQL 16 is provisioned and empty. It is exposed as `DATABASE_URL` and the standard `PG*` variables. A `SESSION_SECRET` variable exists.
- Node is not installed yet: `.replit` lists only the Python module. Adding the Node module is the first step of phase 0.
- Python 3.12, Python Playwright and Chromium are present (they serve the puller). Chromium starts only when the folder of `libatomic.so.1` is on `LD_LIBRARY_PATH`; `../puller/README.md` shows the command. Whether Playwright for Node needs the same is unknown.
- `command -v chromium` gives a different Chromium build inside a workflow than in an interactive shell. Both start. Do not let the two share one browser profile.
- 4 CPUs and 8 GiB of memory. Only `~/workspace` survives a restart.

## 4. What exists to build from

| Path | What it is |
|---|---|
| `docs/import-rules.md` | Every import path and parser rule of the Apple app, the guards against importing a sign-in page, 18 defects that the web app must not copy, and the rules it follows instead. |
| `fixtures/import/` | 57 synthetic inputs with the outputs the real Apple importer produces for them, and the corrected outputs where the Apple behaviour is a defect. `manifest.json` drives the suite; `README.md` explains the format. These are the acceptance tests of the parser port. |
| `reference/import-port/` | A TypeScript port of the importer written from `import-rules.md`. In its "apple" mode it equals the real Swift importer on every fixture and on 30,000 random inputs; its "web" mode generated the corrected outputs. It is a verification instrument, not reviewed product code: adopt it, rewrite it or ignore it. The fixtures are the contract. |
| `docs/data-model.md` | Every entity and field of the Apple app, search and sort rules, the context-pack template, the interchange JSON (version 1) and a PostgreSQL schema draft. |
| `docs/interchange-schema-v1.json`, `docs/example-vault-export.json` | The interchange format as a JSON Schema, and a synthetic example that validates against it. |
| `docs/capture.md`, `docs/capture-scripts/` | How the Apple app captures a conversation from a link; the page scripts lifted verbatim out of the app, the puller and the reference app; 13 synthetic pages with observed results; a draft selectors file and a prototype extractor; and the tiered plan for the web. |
| `docs/claude-api.md` | Exactly how the app calls Claude (requests, prompts, streaming, refusals), checked against the current API documentation, and the server-side design for the web. |
| `docs/design.md` | Every screen, string, state and action of the Apple app; design tokens; components; wireframes at phone and desktop width; the web-only screens. |
| `docs/web-platform.md` | What browsers and the hosting platform allow, with sources: installability, share target, offline storage, streaming, security baseline, and a list of things that could not be verified. |
| `../apple/SessionVault/` | The Swift source. When a document and the code disagree, the code is right about what the Apple app does; say so in a commit that fixes the document. |
| `../apple/screenshots/` | Three screenshots of the app on an iPhone simulator. |

Section, rule and fixture numbers are cited across the documents (for example `import-rules.md` C8 or W13, `data-model.md` 9.3). Do not renumber them.

## 5. Status of the documents

The documents were extracted from the Swift source before the owner's decisions in section 2 were final. They were written for one owner and one server-side API key. Each document has three parts: what the Apple app does, which of its defects not to copy, and what the web must do differently. The first two parts do not depend on the decisions and are ready to build from. The third part is being revised where the decisions change it.

| Needed for | Ready now | Being revised (do not build from these parts yet) |
|---|---|---|
| Phases 0 and 1 | `import-rules.md`, `fixtures/import/`, `reference/import-port/`; in `data-model.md` the interchange format, the context pack and the shared pure functions; in `design.md` the message rendering rules | nothing |
| Phase 2 | In every document, the parts about the Apple app and its defects | `data-model.md`: user accounts and the fields that sync needs. `web-platform.md`: the sign-in and security baseline assume a single owner. `design.md`: sign-up and invitation screens. |
| Phase 3 | `capture.md` sections on the Apple pipeline and its defects; `capture-scripts/` | `capture.md`: eight further defects proven on mock pages by the Replit session are being added; the tier order follows section 6 of this file, not the document's own recommendation. |
| Phase 4 | `claude-api.md` parts A and B, the prompt module, the outcome rules and the test plan | `claude-api.md` part C: one stored key per user instead of one server key. |
| Phase 5 | `web-platform.md` on installability, share target and browser storage | The sync protocol for the offline copy: a new document, `docs/sync.md`, is to come. |

Known disagreements between the documents, until the revision lands:

- `web-platform.md` 6.1 keeps the Apple rule for recognising a link on the clipboard; `capture.md` 8.1 (`looksLikeLink`), `design.md` and fixture 32 replace it. Follow `capture.md` 8.1.
- `web-platform.md` 9.4 stores the user's chat message before the reply arrives; `claude-api.md` C5 commits the user message and the reply together. Follow `claude-api.md` C5.
- `data-model.md` and `claude-api.md` differ on when a session's model label is filled. Follow `claude-api.md`.

### A gap seen on a real page (2026-11-20)

The owner captured a Claude Code session share link with the Apple app and built a context pack from it. The result shows what capture of rendered text loses on that page type:

- Tool activity is collapsed on the page into one-line summaries (for example "Used a tool 5 times" or "Ran a command"). What the tools read and returned is not in the captured text, so the context pack lacks most of the substance of the session.
- The first sentence of each message is captured twice: once as the page's preview line and once in the full text.
- Housekeeping lines (session initialised, messages from subagents) are captured as separate notes, and the title is the link id.
- This link form needs a signed-in viewer. The server-side capture of phase 3 is for public pages only, so it cannot fetch such a link. For Claude Code sessions the capture route stays the puller, which drives a signed-in browser on the user's own machine, until the product has a signed-in path of its own.

What this means for the build:

- For Claude Code sessions the complete source is the structured transcript that the page loads as data (the puller saves it as `<id>.json`), not the rendered text. No real file of that kind has been examined yet, so its format is not documented and `import-rules.md` refuses it today as unrecognised JSON.
- Importing that structured file is a required addition to phase 1 as soon as its format is documented. Until then, do not design tables or types that cannot hold tool calls, tool results and subagent messages. The interchange format's open roles and open segment types already allow them.
- Nothing from a real session may be used as a fixture. When the format is known, the fixture is written by hand in the same shape.

## 6. Scope of the first release

In scope:

- Accounts and a private vault per user.
- Import by paste and by file; capture of public share links; export and import of the interchange JSON; whole-vault export.
- Session list, detail view, projects, tags, pinning, timeline, search.
- Context pack: copy, download, share.
- Continue with Claude and Summarize, with the user's own key.
- Installable app; offline copy; receiving shared text and links on Android.
- Account deletion that removes the user's data.

Out of scope until the owner asks:

- Payments, plans, usage metering.
- Shared or team vaults; any way for one user to see another's sessions.
- End-to-end encryption of transcripts.
- A browser extension or bookmarklet; capture of private (signed-in) conversations.
- Stored page snapshots ("View Original" PDFs) and images inside transcripts.
- Any change to the Apple app.

## 7. Phases

Each phase ends with something that runs and with tests that pass. Do not start a phase before the previous one meets its "done when" list. Keep `main` working after every push.

### Phase 0: workspace

- Folder layout inside `web/`: `core/` (shared module), `server/`, `app/` (browser), plus the existing `docs/`, `fixtures/` and `reference/`.
- Add the Node module to `.replit`. TypeScript in strict mode, one formatter, one linter, one test runner, a single command that runs all tests.
- A second workflow in `.replit` that starts the web app in development. The existing "Session login (VNC)" workflow of the puller must keep working.
- The database connection string and every other secret come only from the platform's secret store, never from a file.

Done when: the test command passes on a clean checkout; the development workflow serves a page that shows the app name and build version; the puller workflow still starts.

### Phase 1: core module (the context pipeline without a server)

- Interchange types generated from or checked against `docs/interchange-schema-v1.json`.
- Import parsers ported from `docs/import-rules.md`, driven by `fixtures/import/manifest.json`.
- Context-pack builder ported from `docs/data-model.md`.

Done when: the test runner first verifies the SHA-256 of every fixture input against the manifest; every fixture passes against its target (`.expected.web.json` where one exists, otherwise `.expected.json`; never `.expected.apple.json`); `docs/example-vault-export.json` round-trips through parse and serialise without loss, including its unknown properties; the context packs for the example sessions match the hashes in `docs/data-model.md` section 9.3 byte for byte.

### Phase 2: accounts and the online vault

- Sign-in, sign-out, session cookies, invitation gate.
- Database schema and migrations; an API for sessions, messages, projects and tags; every query scoped to the signed-in user.
- Import by paste and by file with the per-file report and warnings of `import-rules.md` section 4; JSON export and import; whole-vault export; account deletion.
- The screens in `docs/design.md`: list, detail, import, organise, search, context pack, settings.

Done when: the isolation tests pass (section 8); a new user can sign in, import each fixture by paste and by file, find it by search, organise it, copy its context pack, export it, and delete the account, at phone width and at desktop width.

### Phase 3: link capture

As `docs/capture.md`, tier T3: the server opens a public share link in a headless browser, runs the extraction, and hands the result to the same import path as a paste. Public share links only, allow-listed hosts only, never a sign-in.

- Every provider is switched off in configuration until two things are true: its selectors have been checked against one real public page, and the owner has agreed to automated capture for that provider after reading its terms (section 9).
- Fix, do not copy, the defects listed in `capture.md` and the eight proven on mock pages: a stray `data-index` element hijacking the capture, the wrong scroll container, image-only turns dropped, cross-origin images lost, silent limits on images, a scroll walk on static pages, content that arrives late, and nested articles returned twice.
- The Replit session contributes its mock pages and harness as `fixtures/capture/`.

Done when: every page under `fixtures/capture/` and `docs/capture-scripts/fixtures/` produces the documented turns and roles; the protections in `capture.md` are covered by tests, including refused hosts, refused redirects and refused private addresses; a sign-in page gives the documented warning or refusal; and, for each provider the owner has switched on, the owner has captured one real public share link.

### Phase 4: Claude features

- Each user enters their own key in settings; it is validated, stored encrypted, and can be replaced or removed.
- Continue with Claude (streaming) and Summarize; refusals, truncation, errors and Stop handled as `docs/claude-api.md` specifies.
- The model list comes from server configuration, not from client code, and uses the current model ids given in `docs/claude-api.md`, not the Apple app's list.

Done when: with a scripted fake upstream, the cases in `docs/claude-api.md` C11 pass; no response of this server ever contains a key and keys are unreadable in a database dump (tests assert both); one user's key is never used for another user's request (a test asserts it); the owner has made one real exchange with a real key.

### Phase 5: installable, offline, share target

- Web app manifest and service worker; the app shell loads without a network.
- An IndexedDB copy of the user's vault, filled by a "changes since" request; reading works offline.
- Changes made offline are queued and replayed in order; each carries an identifier so that a replay is harmless.
- Android share target: text, links and files shared from another app open the import screen with the content filled in.

Done when: with the network off, an installed app opens, lists and shows sessions synced earlier, and accepts an import that appears on a second device after reconnecting; signing out removes the local copy.

### Phase 6: ready for strangers

Before the invitation gate is opened: rate limits, per-user storage limits, the security baseline in `docs/web-platform.md` verified item by item, backups tested by a restore, and a privacy policy and terms supplied by the owner (do not write legal text on your own; ask).

## 8. Rules that hold in every phase

Privacy and security:

- **Isolation.** No request may read or change another user's data. Every endpoint has a test in which user A asks for user B's record and is refused.
- **No transcript text, titles, API keys, cookies or e-mail addresses in logs, error reports or analytics.** Log identifiers and sizes only.
- **Transcripts are untrusted text.** Render them as text or through the rendering rules in `docs/design.md`. Never inject them as HTML, never fetch anything a transcript names, and link only `http`, `https` and `mailto`. Set a content security policy that forbids inline and third-party scripts.
- **Secrets** only in the platform's secret store. Nothing secret in the repository, in `.replit`, in client code or in a URL.
- **The server opens a URL only for link capture** (phase 3), and only under the rules in `docs/capture.md`.
- **Never serve the workspace folder.** A development or production server serves the app's own build output and nothing else. A static server started at the top of the workspace would publish every file there, including ignored ones such as puller output and local notes.
- **No real data in the workspace or the development database**: no real transcripts, exports or database dumps. Use the fixtures.
- **Deleting means deleting**: account deletion removes rows, stored keys and files, and the local copies on a device are removed at sign-out.

Fidelity to the Apple app:

- Reproduce documented behaviour unless a document lists it as a defect. For each listed defect, implement the documented web behaviour instead.
- Fixtures are the contract. If a fixture seems wrong, do not edit it to make a test pass: raise it in a commit of its own that explains the evidence.
- Heuristics that were never checked against a live provider page are marked as such in the documents. Do not present them to users as reliable.

Working in this repository (also in `../CLAUDE.md`):

- Work only under `web/`, plus `.replit` and the web rules in `.gitignore` when needed. `puller/` belongs to the same Replit session by separate agreement; leave `apple/` and `reference/` alone.
- The top level of the repository is an allow-list (see the end of `.gitignore`): a new top-level file or folder is ignored until its name is added there.
- All test data must be synthetic. Never commit a real conversation, a real link or anything exported from a real vault.
- Add files by name, read `git status` before every commit, never force a push. The workspace's Git panel commits every file that is not ignored: keep the working folder clean and use the command line.
- Use the GitHub no-reply address as the commit identity.
- Another session works on this repository from a Mac. Pull with `--ff-only` before you start, and announce a push to `main` to the other session first.

## 9. What to ask the owner

Only these need the owner. Each document ends with its own list of smaller decisions and the default to build until they are answered; take those defaults without asking.

- The sign-in method, if none of the platform's options is clearly best, and the hosting plan and address (`docs/web-platform.md`).
- For each provider (Claude, ChatGPT, Gemini): whether automated capture of public share links may be switched on, after reading that provider's terms.
- When to open sign-up beyond invitations.
- Privacy policy and terms, before phase 6.
- Any wish to add something from "out of scope".
