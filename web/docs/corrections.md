# Corrections and decisions not yet written into the documents

> **Status (2026-11-20).** The documents in this folder were revised on 2026-11-20 and then read by three independent checkers, and the session that builds the web app reported 33 places where a rule was not exact. The corrections that were blocking are already in the documents. Everything else that was decided is listed here, because the work of writing it into each document was cut short. The status notes of data-model.md and capture.md call some parts "as first published"; a few sentences in those parts were reworded since (2.1 and row B11 of 5.1 in data-model.md; 3.4 and row B12 in capture.md). **Where this file and another document differ, this file is right.** When an entry has been written into the document it names, delete the entry here, in the same commit.

How to read it: each entry names the document and section it changes, then the rule. "Decided" means that the session that maintains these documents decided it, not the owner of the repository: the builder may rely on it, and raises a disagreement as `../HANDOFF.md` section 8 says. Nothing here has test vectors yet; where a rule needs them, the entry says so.

## 1. Corrections to the revised documents

### 1.1 Accounts, sign-in, operations (web-platform.md)

1. **11.13, read-only mode.** `VAULT_READ_ONLY` also refuses the start of a Claude turn, the start and the save of a capture, a change of preferences and an interchange import, each with `503 read_only`. Otherwise a turn commit or a capture save still writes during a restore.
2. **11.7, after a restore of the database.** Empty the sign-in session table (sessions that were ended come back otherwise). Delete every row of `user_api_keys`: a key that a user removed must not come back, so users enter their key again. Change `SYNC_EPOCH`; every device then drops what it holds, also rows newer than the restore point.
3. **11.8, logging on routes that receive a secret.** A route that receives a key, a password or a code logs the class of an error only, never a parser or validation message, because those can quote the body.
4. **13.1, check 13.** The deny list whose matches the server logs at start also names `NODE_DEBUG`, `DEBUG`, `NODE_OPTIONS` and the proxy variables; none of them reaches a child process either (13.2, rule 24).
5. **13.4, the word `rate_limited`.** On the Claude routes `rate_limited` is the upstream code of claude-api.md C8 (Anthropic refused the request), with its own message; this app's own limit there is `app_rate_limited`. Everywhere else `rate_limited` is this app's own limit, with status `429`. A client must not choose one message by the code alone.
6. **13.4, convention 10, three exceptions to keep in mind.** `internal` (HTTP 500) and `internal_error` (a failed capture job, capture.md 7.5) are different codes. `position` and `index` of a dropped turn (`leading` or `trailing`, and the index in the input) are not the `position` of a message. `retryAfterSeconds` is camel case inside the error object of routes that otherwise use snake case.
7. **13.4, shapes that are not written down.** The request and the answer of `POST /api/sessions/query`, `GET /api/sidebar`, `GET /api/sessions/:id`, `GET /api/account` and `POST /api/import` are the builder's to define, from data-model.md 7.3 (the queries) and 6.7 (the import report). Record them in the commit that adds each route.
8. **13.4 and 11.2, changing a password.** A signed-in user changes the password with the current and the new one (`POST /api/auth/password`); every other session of that user ends. Changing the e-mail address is not in the first release.
9. **13.5, check accounts.** `CHECK_USER_IDS` (configuration, empty by default) lists the accounts that may call the check routes which the owner's dry runs need in the published app (capture.md 8.3, step 4 of the list for switching a provider on; the checks of 13.1). Those routes are the stated exception to rule 20 of 13.2.
10. **11.12, rule 3, the sweep** also clears `capture_jobs.pending` after 24 hours (capture.md 8.3a).
11. **Where tables are created before the owner has settled the model for schema changes (13.3, step 7).** Only in a scratch database of the local PostgreSQL server, never in the database that `DATABASE_URL` names. Read 10.5 (consequence 1), 10.12 (P3), 11.9 (the row on S10) and 13.2 (rule 5) here, and capture.md 8.3b, in that way: "the first table of phase 2" and "the development database" mean that scratch database until the decision is made, and "without an answer" is no reason to create a table in the other one.
12. **10.8 and capture.md 8.3b, the two Chromium builds.** Both still give the first measurement (a workflow gets an older build than an interactive shell). 10.11, M5, is right: a workflow and a newly opened shell get the build that `.replit` installs, and a process that was started earlier can still get the other one. Resolve the binary once at start, log its version, and never let two builds share a profile folder.
13. **10.2, the `.replit` fragment** still shows `guessImports = false` under `[packager.features]`. The switch that turns guessing off is the top-level `disableGuessImports = true` (13.2, rule 7).
14. **11.2, 11.10, 11.14 and 13.4, the terms of use.** `terms-of-use.md` is the draft of the owner's terms (condition G14 of 11.14 asks for them). The app serves the text from its own build at the client address `/terms`, like `/invite`, to anyone, signed in or not; it makes no request to another origin for it. The page shows the file from the heading "Terms of use" to its end, never the status note or the notes above that heading, with headings and lists drawn as such and every address as a link (`target="_blank"`, `rel="noopener noreferrer"`; 11.4). The current version is the one named in the line under that heading ("Draft 0.1 of 2026-11-20" is version `0.1`); it changes only when the owner changes that line. The sign-up request carries `terms_version`; without it, or with a version that is not the current one, the answer is `400 validation` with `details.reason` set to `terms_version`, so that the sign-up screen can say that the terms changed and show them again. `GET /api/auth/session` says whether the signed-in user has agreed to the current version, so that the page can ask again after the terms changed. Recording a later agreement is a request of its own (route and shape are the builder's to define, as in entry 7). It is not a vault write and is allowed for a suspended account. No other route depends on the agreement: export, account deletion and sign-out work without it.

### 1.2 Stored data (data-model.md)

1. **7.8, checks on a user's API key.** claude-api.md C15 decides the lifecycle; 7.8 decides storage and encryption. The local checks are those of C15.2: refuse `sk-ant-admin...`; accept only `sk-ant-api...` of at least 20 characters. A check that Anthropic refuses stores nothing. A check that could not reach Anthropic stores the key with status `unknown`.
2. **7.11, and web-platform.md 11.6 (option 2), capture jobs.** `capture_jobs.pending` holds transcript text for at most 24 hours. It counts as transcript text everywhere: never logged, deleted with the account, and covered by whatever the owner decides about encryption at rest.
3. **7.2, `messages_rev`** must be able to hold a `seq` value (7.9, the row on a session created again under a deleted id): declare it `bigint`, and `claude_turns.seen_messages_rev` with it.
4. **7.8,** like claude-api.md C15.3, still says that the workspace has a throw-away wrapping key of its own. The shell cannot set a secret: tests set a synthetic value in the test process, and a development server makes one in memory at start (web-platform.md 13.5).
5. **7.7, agreement to the terms of use.** `users` gains `terms_version text` and `terms_accepted_at timestamptz`, written when the account is created and whenever the user agrees to a newer version of `terms-of-use.md`. They go with the account when it is deleted. web-platform.md 11.14, fact 1 (what is stored per user), gains: the version of the terms that was agreed to, and when.

### 1.3 Claude (claude-api.md)

1. **Conventions.** "Master key" in this document is the "wrapping key" of data-model.md 7.8 and web-platform.md 11.6: the secret `USER_KEY_ENC_KEY_V<n>`.
2. **C5, starting a turn.** The turn row is inserted in a transaction that first takes the user's write lock (data-model.md 7.9, step 1). If the session was deleted in between, the foreign key fails and the answer is `404 not_found`. State that lives in the process (abort handles, partial text, the key's model list, counters) is keyed by `(owner_id, id)`.
3. **C5, heartbeat.** A heartbeat whose update finds no row stops the turn at once: the row went with the account (data-model.md 7.11, step 1). The account-deletion test of C11 asserts that the upstream call is aborted within 3 seconds.
4. **C19 and test D3.** Decided, not proposed: an interchange import does not replace the messages of a session while a turn is running for it; it is refused with `turn_in_progress` and the import report lists the session as kept (data-model.md 7.9).
5. **C5, the numbered steps of a chat turn** were renumbered by the revision (the commit is no longer step 8). Other documents cite "the commit of a chat turn", not a step number.
6. **C15.3, the test for the published master key** ("one test asserts it") is K16 in the list of C11. The check applies in the published app and wherever the variables are set.

### 1.4 Capture (capture.md)

1. **7.1, two different lists.** The host list of 7.1 answers "which links may the server open". The provider label of an imported or captured session is decided by import-rules.md W9, which matches subdomains and also names `bard.google.com` and `gemini.google`.
2. **8.3 and 8.3c, restoring dropped turns.** The input is `keep_dropped`, defined in import-rules.md W10. The body of `POST /api/captures/:id/save` is empty or `{"keep_dropped": [...]}`. When nothing was ever waiting for that capture id, the route answers `404 not_found`; a capture that was already saved answers as its first save did (the replay of 8.3c), so that a repeated save stays harmless.
3. **8.3a, heartbeat.** A heartbeat whose update finds no row stops the capture at once.
4. **5, row B17.** The loss of cross-origin images is no longer an inference: section 12, M4, shows it.

### 1.5 Screens (design.md)

1. **4.7.1, step 2, and `segmentText` in 5.4: the display splitter.** import-rules.md 2.9 and W13 decide how a message is cut into prose and code blocks, and fixture 57 tests it. A fence line is trimmed with the inline trim (19 characters, import-rules.md 2.3), and prose is tested for blankness with the full trim (26 characters). design.md trims spaces and tabs only and uses `trim()`: a fence indented with U+00A0 is a fence, and prose that consists only of U+200B or U+0085 is blank. The cases of 5.4 have to be run again after the change.
2. **4.15.1, new codes.** `wrong_user` (sync.md 2.7): no message and no sign-in screen. The page does what rule 2 of 4.15.1 says for a changed user: it clears the screen at once, deletes everything the device holds of the previous user, the queue of changes and the share inbox included (sync.md 2.6, rule 4), and starts again for the user who is signed in. Nothing is kept, unlike after a `401`. `already_signed_in`: the sign-in and invitation screens say that someone is signed in on this browser and offer sign-out. `recovery_invalid`: one text for every reason (4.15.2).
3. **4.15.1, quotas.** The sentence for `quota_exceeded` is chosen by `limit`: `stored_bytes`, `sessions` or `projects`.
4. **4.15.5, the key field** is `type="password"` with `autocomplete="off"`. A browser's password manager may still offer to save it; that is outside the app's control, and the screen does not claim otherwise.
5. **4.15.6, the user's models.** The stored form is the one of claude-api.md C16: `claude_models`, the added ids as strings in the order added, and `claude_model_info`, a map from id to name, context window and output limit.
6. **4.15.8, notices.** A notice carries `other_id` (sync.md 8), so that `project_merged` can name the project that now holds the sessions and `duplicate_import` the session that looks the same. `unsupported` on an edit or a delete needs a sentence of its own.
7. **4.15.9, rule 2.** The input that restores dropped turns is `keep_dropped` (import-rules.md W10).
8. **4.6.7, "Discard".** It calls `DELETE /api/sessions/:id/turn`, and it is not offered for `confirmation_required` and `input_too_large` (claude-api.md C6).
9. **4.6.4, one session as a file.** The overflow menu of the detail view has "Export Session" (the interchange JSON of one session, web-platform.md 13.4).
10. **4.15.10, a capture that waits for review.** A new capture discards a result that still waits for review (capture.md 8.3a): disable "Capture Transcript" while a review is open.
11. **4.15.4, changing the password:** a row with the current password, the new password and the sentence "Every other device is signed out."
12. **4.15.5, the drawings** show the key text without its last sentence ("The operator of this service can technically access what is stored."). Item 2 of the screen is the wording.
13. **5.4, the reference splitter** trims with expressions of the form `<class>+$` (the line trim, the paragraph trim and the file-name trim), which take quadratic time on a long run of blanks. They run in the browser on message text of up to a million characters: trim with loops.
14. **4.4, 4.15.2, 4.15.3, 4.15.4 and 4.16 (decision 2), the terms of use.** The invitation and sign-up screen shows "By creating an account you agree to the Terms of Use." with a link to `/terms`, above the button that creates the account. The link opens in a new tab, because that screen keeps the invitation code in memory only. `/terms` joins the client addresses of 4.4 and is shown with or without a signed-in user: the sentence of 4.4 that names `/sign-in`, `/invite` and `/recover` as the only such screens now names `/terms` too. The "Terms" link at the foot of the sign-in and sign-up screens (4.15.2) and in Settings under About is shown from now on; "Privacy" stays hidden until the owner has supplied that text. "Never placeholder legal text" (4.15.2) now means that the builder writes and fills in nothing: the page shows the owner's draft as it is, with its sentences that begin with "Owner to decide". When the terms changed, a dialog shows the new version and asks for agreement before the app opens: after sign-in, and for a browser that is already signed in the next time the page receives an answer of `GET /api/auth/session` (1.1.14). Without a connection the app opens from the offline copy as before. The dialog has the button "Agree and Continue". A person who does not agree can still export the vault, delete the account and sign out: the dialog offers "Export Vault", "Delete Account" and "Sign Out" (4.15.4). The same holds for a suspended account.

### 1.6 Import rules (import-rules.md)

1. **C4.** "Authoritative import on the server" now means capture results only. Paste and file imports are parsed on the device and arrive as `session.create` (sync.md 6.1); the server validates and normalises them and does not parse them again.
2. **C10.** Duplicates are no longer detected by source link and message count. The server computes `import_hash` (data-model.md 7.9) and answers a second import of the same transcript with `duplicate_of` (sync.md 7, case 10).
3. **Section 7, decision 6.** Importing the puller's `<id>.json` is wanted (`../HANDOFF.md` section 5). It waits only for the format to be documented.

## 2. Interchange format: sixteen points (data-model.md 5.1, 6 and 8)

Reported by the builder while implementing the reader, the merge and the writer. Decided as follows. Section 6 of data-model.md still has the earlier text, and section 9 has no vectors for these rules yet.

Two general rules:

- **G1, storage invariant.** Whatever is stored is in the form the reader produces, so the exporter's output passes the schema and R1 to R10 without repair. Every write path (interchange import, transcript import, capture, edits through the API or through sync) runs the same normalisation before storing. A second import of the app's own export reports every project and session as unchanged.
- **G2, open values.** `provider` and `role` are normalised by one function: trim; an empty result becomes the fallback (`other`, `unknown`); if the value equals a known value when only the ASCII letters A to Z are folded, the known lower-case value is stored; otherwise the trimmed value is stored as written. "Trim" here removes only U+0020, U+0009, U+000A, U+000B, U+000C and U+000D, and the fold is ASCII only, so that JavaScript, Swift and SQL give the same result. A CHECK constraint that states this in SQL uses `translate()` for the fold and `btrim(value, <that list>)` for the trim, never `lower()` or a bare `btrim()`.

```ts
const isOpenValueSpace = (c: number): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d);
function normalizeOpen(value: string, known: readonly string[], fallback: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isOpenValueSpace(value.charCodeAt(start))) start++;
  while (end > start && isOpenValueSpace(value.charCodeAt(end - 1))) end--;
  const v = value.slice(start, end);
  if (v === "") return fallback;
  const folded = v.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
  return known.includes(folded) ? folded : v;
}
```

The trim is a loop on purpose: an expression of the form `<class>+$` takes quadratic time on a long run of blanks that does not end the string (section 3, point 14), and a hostile value can be megabytes long. For the same reason `provider` and a message `role` are limited to 200 characters each, checked before any normalisation (data-model.md 7.10).

The points, by the builder's numbers:

1. **`parseTags` is idempotent** (8.2). The leading run of `#` and white space is removed: `part.trim().toLowerCase().replace(/^[#\s]+/, "").trim()`. Repair 4 of 6.6 is `tags = parseTags(tags.join(","))`, which also splits an element that contains a comma and drops duplicates across elements. For tags, "trimmed" means what JavaScript's `trim()` removes (U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF; the same set as `\s`), and "lower-case" is `toLowerCase()`.
2. **R3 and repair 8** (6.6). Repair 8 stands. R3 is the writer's rule; a reader checks it after repair 8 and counts the destination vault's projects of the same user as present.
3. **Order of repairs** (6.6). Repair 5 (string cleaning) runs first, then the others in the order listed. The numbers stay.
4. **Repair 6** (6.6) sorts and renumbers only when every message of the session has a finite number as `index` (ties by array position; a fraction or a negative number sorts and is mended). Otherwise nothing in that session is renumbered and validation refuses the document.
5. **Repair 1** (6.6) also lower-cases `sha256` values, in attachment descriptors and in attachment segments. Entry names inside a ZIP bundle stay strict (6.4).
6. **Repairs 2 and 3** (6.6). `null` is read as absent for every optional property that version 1 defines, `generator` and its fields and `data_base64` included; an unknown property with the value `null` is kept as written. Repair 2 is G2.
7. **Repair 9** (6.6). `data_base64` that is not a string, cannot be decoded, or does not match `byte_length` or `sha256` is removed with a warning; the descriptor stays. Writers emit standard base64 with padding. Readers accept padding as optional: only the characters `A-Z a-z 0-9 + /`, then at most two `=`; without the `=` the length is not 1 modulo 4; no white space; no URL-safe alphabet. Length and hash judge the bytes.
8. **Timestamps** (6.1, R1). Digits beyond the millisecond are cut, never rounded, and cut before the value reaches PostgreSQL (`timestamptz(3)` rounds). One repair line per document with a count. Hour 24 and second 60 are refused. The year is 0001 to 9999.
9. **Projects in a merge** (6.7, step 2). Same id: equal content is "unchanged"; a later `updated_at` replaces the whole project (name, name key, `created_at`, `updated_at`, unknown properties); an equal or earlier `updated_at` with different content is "kept" and reported, as for sessions. If the incoming name's key already belongs to another project of the user, nothing of the project is changed and a warning is given.
10. **Message ids** (6.7). An incoming message id that a message of another session of the same user already holds gets a fresh id, with one warning per session. With the keys of 7.2 (`PRIMARY KEY (owner_id, id)`) an id held by another user never collides: two users can hold the same ids, and nobody gets a fresh id because of another user.
11. **"Same content"** (6.7). Both sides are compared in reader form: the incoming session after repair, and the exporter's output for the existing session passed through the same repair. Ignored: `updated_at`, the presence of `data_base64`, message ids, the order of properties.
12. **Order in a file** (6.8). Writers emit projects and sessions in id order. The order of properties inside an object carries no meaning: tests compare parsed values, never bytes, except the context packs of 9.3. The order of attachments is not decided yet; keep the order of the imported array until it is.
13. **A message's `model`** (6.8). `""` or `null` is read as absent; a writer never writes an empty one.
14. **How a stored provider behaves** (8.3 against 7.3). Settled by G1 and G2: a stored `Claude` cannot exist, so the context pack and the list filter agree. The tolerance inside `contextPackMarkdown` stays only because it is a pure function that can be called with foreign values. The packs of 9.3 do not change.
15. **Signatures** (8.3, 8.5) take `readonly` arrays.
16. **File names** (5.1, B15). One function: replace `\ / : * ? " < > |` and control characters by `-`; trim white space at both ends and trailing dots and spaces; cut to at most 120 UTF-8 bytes without splitting a code point, then trim trailing dots and spaces again; an empty result becomes `session`; if the part before the first dot is a Windows device name in any letter case, put `_` in front. The device names are those of Microsoft's page "Naming Files, Paths, and Namespaces"; the builder recalls that it lists `CON`, `PRN`, `AUX`, `NUL`, `COM0` to `COM9`, `LPT0` to `LPT9` and the forms with a superscript 1, 2 or 3. That list was not read again for this file.

Also decided: a property NAME that contains U+0000 or a lone surrogate cannot be stored in PostgreSQL `jsonb`; the cleaning pass drops such a property, with a warning.

## 3. Importer: seventeen points (import-rules.md, the reference port, design.md, capture.md)

Reported by the builder while implementing the transcript importer. The 57 fixtures and their expected files do not change. Points 16 and 17 are entries 1.5.1 and 1.4.1 above.

Rules (import-rules.md):

1. **W2, UTF-16** is decoded leniently: an odd last byte is ignored, and an unpaired surrogate becomes U+FFFD. The rule against a non-fatal decoder is about UTF-8, where a failure is what tells UTF-8 from windows-1252.
2. **W2, UTF-16 without a mark** needs at least two byte pairs before the zero-byte test applies.
3. **W2, a UTF-8 mark followed by invalid UTF-8** falls through to the rows below with all its bytes. The user then sees the windows-1252 flag, and the three mark bytes as characters at the start, in the review step.
4. **W1 is idempotent.** Step 1 removes every leading U+FEFF, not one. Every entry point applies W1, and `parseText` applies it again; twice changes nothing.
5. **W4, `create_time`** gives a date only when it is a finite number whose instant lies in the years 0001 to 9999. For the order of nodes the number is used whenever it is finite.
6. **W10, a capture title** is never blank and never holds U+0000. Every candidate goes through W1 and the full trim; the first that is not empty wins: typed name, detected title, the last non-empty path segment of the link (percent-decoded; if decoding fails, as written), the link itself, and last the constant `Captured session`.
7. **W1 applies to every stored string**, also the title passed by the caller, the source link and the file-name stem.
8. **"Empty" means empty after the full trim** wherever a W rule tests a title or a message for emptiness. A message of only U+000B, U+000C, U+0085, U+2028 or U+2029 is no message, and such a title falls back. What is stored for a message that is not empty does not change.
9. **W8, marker words** are matched with ASCII case folding only. The claim about the Apple app becomes "identical for ASCII text". What Swift does for the builder's example (a marker spelled with U+0130) was not measured for this file.
10. **`importFile` has a fourth outcome, `interchange`,** that carries the parsed document for a file whose `format` is `sessionvault-interchange`; the caller hands it to the interchange reader. It is never reported as `unrecognised_json`. `decodeBytes` returns the text as decoded, before W1.

Known defects of the reference port (`../reference/import-port/importer.ts`), not fixed yet:

11. Time-order ties follow `Object.keys`, so mapping keys that look like integers come first; W4 asks for the order of the keys in the JSON text.
12. Role lines of a context pack are looked up in a plain object, so a line that is the name of something every object inherits (`constructor`, `toString`, `__proto__`) after `---` is taken for a role line. Look roles up in a `Map`.
13. Two patterns use `.`, which does not match U+2028 or U+2029, so a fence line or an Origin line that contains one is not recognised, although lines are cut at LF only (2.3).
14. The trim expressions are quadratic on a long run of blanks inside a line (one line of 160,000 spaces took 10.6 s in the builder's measurement), and the Origin pattern on repeated " (". On a server this is a way to stall the process with one hostile page or file: trim with loops, not with expressions of the form `<class>+$`.
15. It is not written for a strict compiler, and its W1 skips the lone-surrogate step on a platform without `String.prototype.toWellFormed`.

Do not adopt the port as product code without fixing these. The product importer has a test for each, among them one line of 1,000,000 blanks that must be parsed within a second.
