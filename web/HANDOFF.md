# SessionVault for the web: build handoff

Start here. This document says what to build, in what order, and how to know each step is done. The detail lives in `docs/` and `fixtures/` next to it.

Written 2026-11-20 from the Apple app's source (`../apple/`) by the session that consolidated this repository, and revised the same day together with the documents under `docs/`. The builder is a Claude Code session working in the Replit workspace of this repository. The Apple app cannot be built or run there; this handoff and the Swift source are the only description of its behaviour.

## 1. What this is

SessionVault keeps a person's AI chat sessions in one private vault, lets them organise and search those sessions, and carries their context into a new conversation: either as a "context pack" pasted into any model, or by continuing the session with Claude inside the app.

The Apple app does this for one person on Mac, iPhone and iPad. The web app does it for anyone, in any browser: Android, Windows, Chromebook, and Apple devices too.

**What matters most.** The owner depends above all on the context pipeline: getting a conversation in (capture and import), and getting its context out again in a form another model can use (the context pack). Accounts, sync and the Claude features exist to serve that pipeline. When priorities conflict, the pipeline wins, and it is the part that must be tested most thoroughly.

**How it is used.** A person asks free-form questions about a saved session, of a model of their choosing, and takes the answer elsewhere. That gives three rules:

- No preset questions and no forced output formats. Summarize stays as the one built-in action; nothing else rewrites or wraps what the user asks.
- The model is the user's choice. Inside the app that means Claude models: the server offers the models it knows, and also accepts any other model id that the user's own key can use (with conservative settings for an id it does not know). Models of other providers are reached by pasting a context pack; calling other providers' APIs is not in scope.
- Every message and every reply can be copied whole with one action, at every width. Code blocks keep their own copy action.

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
| Intended use | Personal use: each user's own conversations and project data, to manage complex work and to keep work that the user paid for. A saved session is not a complete record: the app does not translate or transcribe the activity of sub-agents, and agents, their subjects and the decisions or work of red or blue teams can be missing. The draft terms of use add two prohibitions that follow from this, for the owner to confirm: not to pass on other people's conversations, and not to use the app to train or distil AI models. |
| Terms of use | Users agree to terms of use when they create an account. The terms link to each AI provider's own rules on using its output to train models. `docs/terms-of-use.md` is the draft; the owner approves the final text. |

## 3. Recommended approach, and the choices left open

Recommended unless the builder finds a concrete reason against it in the Replit environment. State the reason in a commit message if you deviate.

- **TypeScript end to end.** A React + Vite single-page app, installable as a PWA and usable at phone width; a small Node server; PostgreSQL.
- **One shared core module** with no DOM and no Node dependencies: the interchange types, the import parsers and the context-pack builder. It runs in the browser and on the server and is tested against the golden files in `fixtures/`.
- **The server is the source of truth for the vault.** Every row belongs to one user. The browser keeps a copy in IndexedDB and a queue of the changes made offline; `docs/sync.md` specifies both. The first database migration already carries what sync needs (`docs/sync.md` 13.2), so that phase 5 adds the device side and changes nothing on the server.
- **Claude is called by the server with the signed-in user's own key.** Anthropic's documentation says to call the API from a back end, not from code in the browser, and refuses direct browser calls for some organisations. So each user's key is stored in the database, encrypted with a key that lives in the platform's secret store, used only for that user's requests, never sent back to the browser, and removable by the user at any time. `docs/claude-api.md` C15 specifies how a key is checked, stored, used and removed; `docs/data-model.md` 7.8 how it is encrypted.

Open choices, each with a default the builder may take without asking:

1. **Sign-in method.** Default (`docs/web-platform.md` 11.9): sign-in built into the app with a maintained library, an e-mail address as the sign-in name and a password, with sessions and credentials in the app's own database. No mail is sent until the owner has set up a mail provider; until then a forgotten password is recovered through the owner. Never hand-written password storage. The hosted alternatives need Replit Agent or accounts that only the owner can create, so they are the owner's call (section 9).
2. **Who may sign up at first.** Default: invitation only, until the owner opens sign-up (`docs/web-platform.md` 11.10). An invitation is a random code; only hashes of the codes are kept, in the platform's secret store, never in the repository. The app must be safe for strangers before that switch is flipped (phase 6).
3. **How link capture runs in deployment** (phase 3). Capture of public share links is part of the product, not an extra. The workspace can launch a headless Chromium today; whether a deployed app can is not yet known. The capture code therefore sits behind one interface (`docs/capture.md` 8.3b), so that it can run somewhere that can.
4. **How schema changes reach production.** Reported by the session in the workspace, from documentation on the machine: the platform has two models for this and does not support changing the model later (`docs/web-platform.md` 10.12, P3). Both sessions recommend the model in which the app runs its own migrations, because checks and constraints then travel with the schema. The choice is made in Replit's interface before the first table exists, so it is a step for the owner (section 9). It holds nothing up: until the owner has answered, write migrations as numbered SQL files with one runner, and create tables only in a scratch database of the local PostgreSQL server that the tests create and drop, never in the database that `DATABASE_URL` names.

Facts about the Replit workspace are in `docs/web-platform.md`: 10.11 (measured there on 2026-11-20), 10.12 (reported, not confirmed by the platform's public documentation) and 10.13 (the rules that follow). The ones that shape daily work:

- Only `~/workspace` survives a restart.
- PostgreSQL 16 is provisioned for development, exposed as `DATABASE_URL` and the standard `PG*` variables. A `SESSION_SECRET` variable exists. The shell can read secrets and cannot set them: every secret is a step for the owner.
- Chromium starts only when the folder of `libatomic.so.1` is on `LD_LIBRARY_PATH`; `../puller/README.md` shows the command. `command -v chromium` resolves to the build that `.replit` installs in a workflow and in a newly opened shell, but a process started earlier can still resolve it to a different build: never let two builds share one browser profile.
- A crashing Chromium writes a dump that contains its whole environment. Start the capture browser with a minimal environment and with its configuration and cache folders outside the workspace (`docs/capture.md` 8.3).
- Replit adds a `[[ports]]` entry to `.replit` by itself when a process opens a port, also for a process bound to localhost. A port bound to localhost is therefore not private there. Check `.replit` before every commit.
- Reported by the session in the workspace, not confirmed by the platform's public documentation (`docs/web-platform.md` 10.12, P7): a published app is built from the files on disk, and only the platform's ignore list (`.replitignore`) keeps a file out of it; `.gitignore` does not. Check 17 of `docs/web-platform.md` 13.1 shows what a published image really holds.

## 4. What exists to build from

| Path | What it is |
|---|---|
| `docs/import-rules.md` | Every import path and parser rule of the Apple app, the guards against importing a sign-in page, 18 defects that the web app must not copy, and the rules it follows instead. |
| `fixtures/import/` | 57 synthetic inputs with the outputs the real Apple importer produces for them, and the corrected outputs where the Apple behaviour is a defect. `manifest.json` drives the suite; `README.md` explains the format. These are the acceptance tests of the parser port. |
| `reference/import-port/` | A TypeScript port of the importer written from `import-rules.md`, with two small scripts that feed it the manifest and compare its output with the expected files. In its "web" mode it equals all 57 targets; in its "apple" mode it equals the real Swift importer on every fixture and on 30,000 random inputs. It is a verification instrument, not reviewed product code: use it for checking, rewrite it, or adopt it once the defects listed in its README are fixed. The fixtures are the contract. |
| `reference/apple-harness/` | The command-line harness around the Apple app's real importer that produced the Apple side of the import fixtures, with a script to run it again on a Mac. Not needed to build the web app. |
| `docs/data-model.md` | Every entity and field of the Apple app, search and sort rules, the context-pack template, the interchange JSON (version 1) with its reader and writer rules and test vectors, and the PostgreSQL design for many users: tables, the write transaction, the user's stored API key, storage limits, account deletion and the isolation rules I1 to I12. |
| `docs/corrections.md` | What was decided after the revision and is not in the other documents yet (section 5). It wins where it differs. |
| `docs/terms-of-use.md` | The draft of the owner's terms of use, with links to each AI provider's rules, a table that says how each link was checked on 2026-11-20 (the OpenAI pages could not be opened), and notes on where the app shows it. |
| `docs/interchange-schema-v1.json`, `docs/example-vault-export.json` | The interchange format as a JSON Schema, and a synthetic example that validates against it. |
| `docs/sync.md` | The offline copy and how it stays in step: the change feed, the queue of changes made offline, sixteen conflict cases with one rule each, the IndexedDB layout, the service worker boundary, and a test plan whose protocol tests need no browser. Its rules were run as a model before they were written down, except section 2.7 (the user a sync request is for), which was added after a review and has not been run. |
| `docs/capture.md`, `docs/capture-scripts/` | How the Apple app captures a conversation from a link; the page scripts lifted verbatim out of the app, the puller and the reference app; 13 synthetic pages with observed results; a draft selectors file and a prototype extractor; eight defects proven on mock pages; the server-side capture with its job table and limits; and what is known about Claude Code session pages. |
| `docs/claude-api.md` | Exactly how the app calls Claude (requests, prompts, streaming, refusals), checked against the current API documentation; and the server-side design for the web: the turn, the routes, the user's key from entry to removal, the model list, limits, and the test tables. |
| `docs/design.md` | Every screen, string, state and action of the Apple app; design tokens; components; wireframes at phone and desktop width; and the screens that only the web has (section 4.15): sign-in, invitation, settings, the key screen, the model chooser, copying, the offline states, import review and server capture. |
| `docs/web-platform.md` | What browsers and the hosting platform allow, with sources: installability, share target, offline storage, streaming, the security baseline, accounts and sign-in, the HTTP conventions and route map, configuration names, and a list of things that could not be verified. |
| `../apple/SessionVault/` | The Swift source. When a document and the code disagree, the code is right about what the Apple app does; say so in a commit that fixes the document. |
| `../apple/screenshots/` | Three screenshots of the app on an iPhone simulator. |

Section, rule and fixture numbers are cited across the documents (for example `import-rules.md` C8 or W13, `data-model.md` 9.3). Do not renumber them. Line numbers that the documents cite into files of this repository are exact at commit `e81828a`. A file that changed after that commit is cited as it was then (`git show e81828a:<path>`); the puller in particular is being reworked.

## 5. Status of the documents

All documents were extracted from the Swift source on 2026-11-19 and 2026-11-20, at first for one owner and one server-side API key. On 2026-11-20 they were revised for the decisions of section 2, and `docs/sync.md` was added. `docs/import-rules.md` did not depend on those decisions; it received corrections only.

How to read a revised document:

- It starts with a status note that says what was revised. No section, rule, defect or test number was renumbered or removed; new material has new numbers.
- Each document still has three parts: what the Apple app does, which of its defects not to copy, and what the web app does. The first two do not depend on the decisions.
- Text that the decisions overtook was kept for the record where a number or a drawing had to stay, under a note that starts with "Superseded" and names its replacement. Never build from text under such a note. Alternatives that were considered and not chosen are in the sections called "If instead".
- Evidence is marked: run, measured, reported, inference, not verified. Nothing about a published app, a real provider page or a real Anthropic request has been run. `docs/web-platform.md` 13.1 lists the checks to make before building on such a statement.

Which document decides what. When two documents disagree, the one named here is right. Fix the other document in a commit of its own that states the evidence (section 8).

| Topic | Decided by |
|---|---|
| What is in scope, the order of work, the rules of section 8 | this file |
| Import: parsers, guards, the result of an import | `import-rules.md` and `fixtures/import/` |
| Interchange format; tables, columns and constraints; the write transaction; limits; account deletion; isolation rules | `data-model.md` |
| The change feed, the queue of offline changes, conflicts, what a device stores | `sync.md` |
| Claude: routes, the turn, the user's key, the model list, prompts, error codes of the Claude routes | `claude-api.md` |
| HTTP conventions, the route map, request limits, sign-in and sessions, security headers, configuration names, the platform | `web-platform.md` |
| The capture pipeline, the extractor, the capture routes and their job table | `capture.md` |
| Screens, wording, states, components, accessibility | `design.md`; the fixed messages of the Claude routes stay with `claude-api.md` C8 |

What to read for each phase:

| Phase | Read |
|---|---|
| 0 | Section 7 of this file; `web-platform.md` 13.2 (build rules) and 10.11 to 10.13. |
| 1 | `import-rules.md`, `fixtures/import/`, `reference/import-port/`; `data-model.md` sections 6, 8 and 9; `design.md` 4.7 (rendering rules). |
| 2 | `data-model.md` section 7; `sync.md` 13.2 and section 6 (the six mutations are the write path from the first day); `web-platform.md` sections 11 and 13; `design.md` section 4. |
| 3 | `capture.md` sections 7, 8, 12 and 13; `capture-scripts/`. |
| 4 | `claude-api.md` part C; `web-platform.md` section 9 (the stream); `data-model.md` 7.8; `design.md` 4.15.5 to 4.15.7. |
| 5 | `sync.md`; `web-platform.md` sections 4, 5 and 7; `capture.md` 8.2; `design.md` 4.15.8. |
| 6 | `web-platform.md` 11.14 and section 17. |

Two disagreements of the first version are still in the text and are settled by the first table: reading files (`web-platform.md` 6.2 mentions `file.text()` and deciding the format from the content; follow `import-rules.md` W2 and W3) and rendering (`data-model.md` 5.1, B14, names a CommonMark library; follow `design.md` 4.7). Known gap: `looksLikeLink` (`capture.md` 8.1) still takes a bare file name such as `notes.md` and an e-mail address for a link.

### Corrections that are not in the documents yet

`docs/corrections.md` lists what was decided after the revision and is not written into the documents yet: corrections from three independent checks of the revised documents, and the decisions on 33 points that the builder reported (sixteen on the interchange format, seventeen on the importer). Where it differs from another document, it is right. Read it before each phase. An entry leaves that file in the commit that writes it into the document it names.

### Claude Code session pages (2026-11-20)

The owner captured a Claude Code session share link with the Apple app and built a context pack from it. The result shows what capture of rendered text loses on that page type; `docs/capture.md` section 13 has the detail. In short:

- Tool activity is collapsed on the page into one-line summaries. What the tools read and returned is not in the captured text, so the context pack lacks most of the substance of the session.
- The first sentence of each message is captured twice, housekeeping lines are captured as separate notes, and the title is the link id.
- This link form needs a signed-in viewer. The server-side capture of phase 3 is for public pages only, so it cannot fetch such a link. For Claude Code sessions the capture route stays the puller, run by the owner on a Mac, on a Windows PC or in the Replit workspace, until the owner asks for a capture that runs in the user's own browser. The server never signs in to a provider.

What this means for the build:

- For Claude Code sessions the complete source is the structured transcript that the page loads as data (the puller saves it as `<id>.json`), not the rendered text. No real file of that kind has been examined yet, so its format is not documented and `import-rules.md` refuses it today as unrecognised JSON.
- Importing that structured file is a required addition to phase 1 as soon as its format is documented. Until then, do not design tables or types that cannot hold tool calls, tool results and subagent messages. The interchange format's open roles and open segment types already allow them, and so does the `session.create` mutation of `sync.md`.
- Nothing from a real session may be used as a fixture. When the format is known, the fixture is written by hand in the same shape.

## 6. Scope of the first release

In scope:

- Accounts and a private vault per user.
- Import by paste and by file; capture of public share links; export and import of the interchange JSON; whole-vault export.
- Session list, detail view, projects, tags, pinning, timeline, search.
- Context pack: copy, download, share. A copy action on every message.
- Continue with Claude and Summarize, with the user's own key and a model of the user's choice.
- Installable app; offline copy; receiving shared text and links on Android.
- Account deletion that removes the user's data.

Out of scope until the owner asks:

- Payments, plans, usage metering.
- Shared or team vaults; any way for one user to see another's sessions.
- End-to-end encryption of transcripts.
- A browser extension or bookmarklet; capture of private (signed-in) conversations; calling the APIs of providers other than Anthropic.
- Page snapshots ("View Original" PDFs) and images inside transcripts: none are created, stored or shown. The description of an attachment that arrives in an interchange import is kept and exported again; its bytes are not stored, and the import report says so (`docs/data-model.md` 7.2).
- Any change to the Apple app.

## 7. Phases

Each phase ends with something that runs and with tests that pass. Do not start a phase before the previous one meets its "done when" list. A criterion that only the owner can meet (a real exchange with a real key, a real public link, a check on a phone, a restore from backup) goes on the release checklist of `docs/web-platform.md` 13.3 and does not hold up the next phase. Keep `main` working after every push.

### Phase 0: workspace

- Folder layout inside `web/`: `core/` (shared module), `server/`, `app/` (browser), plus the existing `docs/`, `fixtures/` and `reference/`. The package files (`package.json` and the like) live inside `web/`: the top level of the repository is an allow-list, and a file placed there is invisible to git until its name is added at the end of `.gitignore`.
- Add the Node module to `.replit`; use a current long-term-support version. TypeScript in strict mode, one formatter, one linter, one test runner, a single command that runs all tests. The formatter and the linter skip `docs/`, `fixtures/`, `reference/` and every Markdown file (a formatter that reflows Markdown tables would rewrite the documents), and `reference/` is not part of the strict TypeScript project.
- A second workflow in `.replit` that starts the web app in development. Whether it joins the "Project" run group is the builder's choice. The "Session login (VNC)" workflow of the puller stays as it is.
- The server follows the build rules of `docs/web-platform.md` 13.2 from the first commit: one process, the security headers, the error shape, and never the workspace folder.
- The database connection string and every other secret of the app come only from the platform's secret store, never from a file.

Done when: the test command passes on a clean checkout; the development workflow serves a page that shows the app name and build version; the "Session login (VNC)" block in `.replit` is unchanged.

### Phase 1: core module (the context pipeline without a server)

- Interchange types generated from or checked against `docs/interchange-schema-v1.json`; the reader (the rules R1 to R12 and the repair list of `docs/data-model.md` 6.6, and the import algorithm of 6.7) and the writer (the export algorithm of 6.8). Sixteen points of sections 5.1, 6 and 8 that the builder reported are decided in `docs/corrections.md`, section 2: follow them where they differ from section 6.
- Import parsers ported from `docs/import-rules.md`, driven by `fixtures/import/manifest.json`. Ten rule points that the builder reported are decided in `docs/corrections.md`, section 3.
- The shared pure functions of `docs/data-model.md` section 8 (context-pack builder, search and ordering helpers) with the test vectors of section 9.
- Two entry points for files: a `.json` file whose `format` is `"sessionvault-interchange"` goes to the interchange reader; every other file goes to the transcript importer of `import-rules.md`.

Done when:

- The test runner first verifies the SHA-256 of every fixture input against the manifest.
- Every fixture passes against its target: `.expected.web.json` where one exists, otherwise `.expected.json`; never `.expected.apple.json`. Fixtures 37, 38 and 46 cover optional extensions and may be skipped if the extension is not built; say so in the test output.
- `docs/example-vault-export.json` round-trips as the first test vector of `data-model.md` section 9 describes: imported, exported, and equal to the original after sorting arrays by id and ignoring `exported_at`, `generator` and the document-level `x_note` (top-level unknown properties describe the file and are not stored, 6.5). Every other unknown property survives.
- The context packs for the example sessions match the sizes and hashes in `docs/data-model.md` section 9.3 byte for byte.

### Phase 2: accounts and the online vault

- Sign-in, sign-out, session cookies and the invitation gate, as `docs/web-platform.md` 11.2, 11.9 and 11.10 specify. Creating an account includes agreeing to the terms of use (`docs/terms-of-use.md`; `docs/corrections.md` 1.1.14, 1.2.5 and 1.5.14).
- The database schema of `docs/data-model.md` 7.2. The first migration already has the columns and tables that sync needs (`docs/sync.md` 13.2). Every change to the vault goes through the write transaction of `docs/data-model.md` 7.9; recommended: build `POST /api/sync/push` now and let the page send every change through its six mutations, so that phase 5 only puts a queue in front. Every query is scoped to the signed-in user.
- Import by paste and by file with the per-file report and warnings of `import-rules.md` section 4; JSON export and import; whole-vault export; account deletion (`docs/data-model.md` 7.11).
- The screens in `docs/design.md`: list, detail, import, organise, search, context pack, settings. Every message has a copy action.

Done when: the isolation tests pass (section 8; `docs/data-model.md` 7.12); and an invited new user can sign in, import each file fixture through the file picker and each paste fixture through the paste field with the outcome its web target states (sessions, a rejection with its reason, or a link), find an imported session by a word of its title, organise it, copy a whole message and its context pack, export it, and delete the account, at phone width and at desktop width.

### Phase 3: link capture

As `docs/capture.md`, tier T3: the server opens a public share link in a headless browser, runs the extraction, and hands the result to the capture entry of the importer (`importCapture` in `import-rules.md`; whole-page text then goes the same way as a paste). Public share links only, allow-listed hosts only, never a sign-in. `docs/capture.md` 8.3 to 8.3c specify the routes, the job table, the limits and the interface behind which the browser runs.

- Every provider is switched off until two things have happened, in this order: the owner has agreed to automated capture for that provider after reading its terms (section 9); then its selectors are checked against one real public page. That check is made by the owner, or on the published app with nothing stored or committed. It is never made in the workspace.
- Fix, do not copy, the defects listed in `capture.md` and the eight proven on mock pages (`docs/capture.md` section 12): a stray `data-index` element hijacking the capture, the wrong scroll container, image-only turns dropped, cross-origin images lost, silent limits on images, a scroll walk on static pages, content that arrives late, and nested articles returned twice. Images themselves stay out of scope: "fix" means that a turn is never dropped silently. It is kept with a placeholder and a warning.
- The builder's own Chromium mock pages and harness, kept outside git until now, go into `fixtures/capture/`. The pages under `docs/capture-scripts/fixtures/` were recorded in WebKit only; compare after the normalisation that `capture.md` describes and expect small differences between engines.
- The capture browser starts with a minimal environment and with its configuration and cache folders outside the workspace (section 3).

Done when: every page under `fixtures/capture/` and `docs/capture-scripts/fixtures/` produces the documented turns and roles; the protections in `capture.md` are covered by tests, including refused hosts, refused redirects and refused private addresses; a sign-in page gives the documented warning or refusal; and, for each provider the owner has switched on, the owner has captured one real public share link on the published app.

### Phase 4: Claude features

- Each user enters their own key in settings; it is checked, stored encrypted, and can be replaced or removed (`docs/claude-api.md` C15).
- Continue with Claude (streaming) and Summarize; refusals, truncation, errors and Stop handled as `docs/claude-api.md` specifies. Every reply has a copy action.
- The model chooser offers the models the server knows (a server-side registry with each model's properties, using the current model ids given in `docs/claude-api.md`, not the Apple app's list) and accepts any other model id the user's key can use (`docs/claude-api.md` C16).

Done when: with a scripted fake upstream, the test tables of `docs/claude-api.md` C11 pass; no response of this server ever contains a key and keys are unreadable in a database dump (tests assert both); one user's key is never used for another user's request (a test asserts it); a reply can be copied whole; and the owner has made one real exchange with a real key on the published app, never in the workspace.

### Phase 5: installable, offline, share target

As `docs/sync.md`, with `docs/web-platform.md` sections 4, 5 and 7 for what browsers allow.

- Web app manifest and service worker; the app shell loads without a network.
- An IndexedDB copy of the user's vault, filled by a "changes since" request; reading works offline.
- Changes made offline are queued and replayed in order; each carries an identifier so that a replay is harmless. Signing out with unsent changes warns first or sends them first; it never drops them silently.
- Android share target: text, links and files shared from another app open the import screen with the content filled in.

Done when: the automated checks pass (the manifest is valid and installable by the browser's own criteria, the service worker serves the shell offline and never handles `/api/` requests except the share target, the protocol tests of `docs/sync.md` 12.1 pass with two simulated devices); and the owner has confirmed on real devices that an installed app opens offline, lists and shows sessions synced earlier, accepts an import that appears on a second device after reconnecting, receives a share from another Android app, and that signing out removes the local copy. `docs/sync.md` 13.1 maps each of these items to its test.

### Phase 6: ready for strangers

Before the invitation gate is opened: rate limits, per-user storage limits (the value is an owner decision), the conditions G1 to G15 of `docs/web-platform.md` 11.14 verified one by one, and a privacy policy and the final terms of use from the owner (`docs/terms-of-use.md` is the owner's draft of the terms. On 2026-11-20 the owner asked the building session to improve its wording, which gave draft 0.2; the open legal choices in it are still hers. Beyond what she asks for, do not write or change legal text on your own; ask).

Done when: each condition has a test or a recorded manual check; a restore from backup has been carried out by the owner in the platform's interface and the restored data verified; the owner has supplied the policy and terms and has said in writing that sign-up may open.

## 8. Rules that hold in every phase

Privacy and security:

- **Isolation.** No request may read or change another user's data. Every endpoint has a test in which user A asks for user B's record and is refused. This is mandatory from the first migration, not later hardening. `docs/data-model.md` 7.12 states the rules I1 to I12.
- **No transcript text, titles, API keys, cookies or e-mail addresses in logs, error reports or analytics.** Log identifiers and sizes only.
- **Transcripts are untrusted text.** Render them as text or through the rendering rules in `docs/design.md`. Never inject them as HTML, never fetch anything a transcript names, and link only `http`, `https` and `mailto`. Set a content security policy that forbids inline and third-party scripts.
- **Secrets.** The app's own secrets live only in the platform's secret store: nothing secret in the repository, in `.replit`, in client code or in a URL (one stated exception: a single-use invitation or recovery code in the fragment of a link, `docs/web-platform.md` 11.10). Users' API keys are stored in the database, encrypted with a key from the secret store. The published app holds no Anthropic credential of its own.
- **The server opens a user-supplied URL only for link capture** (phase 3), and only under the rules in `docs/capture.md`.
- **Never serve the workspace folder.** A development or production server serves the app's own build output and nothing else. A static server started at the top of the workspace would publish every file there, including ignored ones such as puller output and local notes.
- **What is published is what is on disk.** A published app is built from the files in the workspace, and `.gitignore` does not keep a file out of it: the platform's ignore list does. Puller output, browser profiles and local notes are listed there. A service for other people does not run with anybody's personal credentials within reach: before the first publish the owner checks that no personal connector and no personal account secret is attached to the project that is published (`docs/web-platform.md` 10.13).
- **Child processes get a minimal environment**: no database address, no key material, no session secret. A browser that crashes writes its environment into a dump.
- **No real data in the workspace or the development database**: no real transcripts, exports or database dumps. Use the fixtures. Never ask for, load or keep a real session file there, not even to learn a format: the session on the Mac documents formats and writes the fixture by hand. The one exception is the puller's own output when the owner runs the puller in the workspace; it stays outside `web/`, is ignored by git, is kept out of the published app, and is never served.
- **No assistant or agent is pointed at production data.** Do not ask Replit Agent or any other tool to look into the production database or its logs: with other people's vaults that hands their transcripts to a third party. This also goes into the privacy policy of phase 6.
- **Deleting means deleting**: account deletion removes rows, stored keys and files, and the local copies on a device are removed at sign-out.

Fidelity to the Apple app:

- Reproduce documented behaviour unless a document lists it as a defect. For each listed defect, implement the documented web behaviour instead.
- Fixtures are the contract. If a fixture seems wrong, do not edit it to make a test pass: raise it in a commit of its own that explains the evidence.
- Heuristics that were never checked against a live provider page are marked as such in the documents. Do not present them to users as reliable.

Working in this repository (also in `../CLAUDE.md`):

- Work only under `web/`, plus `.replit`, the platform's ignore list and the web rules in `.gitignore` when needed. `puller/` belongs to the same Replit session by separate agreement; leave `apple/` and `reference/` alone.
- `docs/`, `fixtures/` and this file are the contract. When one of them is wrong or silent, say what you found and what your code does meanwhile, and change the document in a commit of its own that states the evidence; never change it only to make code pass. While a second session works on this repository, agree such a change with it first. What the Apple app does can only be measured on a Mac: a statement about the Apple app that was changed without one is marked as not measured again.
- No formatter, linter fix or editor setting rewrites `docs/`, `fixtures/`, `reference/` or any Markdown file.
- The top level of the repository is an allow-list (see the end of `.gitignore`): a new top-level file or folder is ignored until its name is added there.
- All test data must be synthetic. Never commit a real conversation, a real link, an invited person's address or anything exported from a real vault.
- Add files by name, read `git status` before every commit, never force a push. The workspace's Git panel commits every file that is not ignored: keep the working folder clean and use the command line. Read the diff of `.replit` before committing it: the platform adds port entries to it by itself.
- Use the GitHub no-reply address as the commit identity.
- Another session works on this repository from a Mac. Pull with `--ff-only` before you start, and announce a push to `main` to the other session first, through the channel the owner has set up between the sessions.

## 9. What to ask the owner

Every document ends with a list of decisions for the owner, each with the default to build until the owner answers: `import-rules.md` section 7, `data-model.md` section 12, `sync.md` section 15, `claude-api.md` C14, `capture.md` section 14, `design.md` 4.16 and `web-platform.md` section 17. Build the default and go on; do not wait for an answer, and do not reopen what section 2 decides.

A few steps cannot be undone later, or cannot be done from the shell. They need the owner at the moment named; `docs/web-platform.md` 13.3 has the full checklist.

| Needed before | What the owner does or decides |
|---|---|
| The first table in the database that `DATABASE_URL` names | How schema changes reach production (section 3, choice 4). It is set in Replit's interface and cannot be changed afterwards. Until then the builder works in a scratch database. |
| Anyone else is invited | The final address of the app: a custom domain or the platform's name. A changed address orphans every installed copy and every sign-in. |
| The first publish | Plan, region (permanent) and deployment type; the check that no personal connector and no personal account secret is attached to the project; the production secrets set (the key that wraps users' API keys, the invitation hashes). |
| Capture is switched on for a provider | For each of Claude, ChatGPT and Gemini: whether automated capture of public share links may be switched on, after reading that provider's terms; then one public link of the owner's own to check the selectors. |
| The import of Claude Code session files is specified | Whether one real session may be looked at once, on the owner's own machine, to write down the shape of its files. Nothing of it is committed. |
| Sign-up opens beyond invitations | The privacy policy, the final terms of use (`docs/terms-of-use.md` is the draft) and a contact address; whether transcripts are also encrypted by the app (`docs/web-platform.md` 11.6); the limits per user; and the owner's word, in writing, that sign-up may open. |

Also the owner's, at any time: a different sign-in method than the default, and any wish to add something from "out of scope".

Two defaults are fixed here because they decide what is stored: the original input (pasted text, file bytes, captured strings) is not kept beside the imported session, because it would store more private text than the product needs; and an import that carries a warning, or that had turns left out, shows a review step before it is saved. Where a document states no default, choose the option that is easiest to reverse and record the choice in the commit message.
