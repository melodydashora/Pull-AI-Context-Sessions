# Sync: the offline copy and how it stays in step

> **Status (2026-11-20).** New document, written on 2026-11-20 for the decisions in `../HANDOFF.md` section 2: a product for many users, an online vault as the source of truth, and an offline copy on each device whose offline changes are queued and replayed. It specifies phase 5 of `../HANDOFF.md` section 7 and the part of phase 2 that phase 5 depends on (13.2). The Apple app has no sync, so nothing here describes it. Nothing was run in a browser or against PostgreSQL; the protocol rules were run as a model (12.4). Section 2.7 and a few clarifications were added on the same day after a review of the first draft; they were not run in the model.

## Summary

- The PostgreSQL vault on the server is the only source of truth, with one private vault per user. Each device also keeps a copy in IndexedDB, so that the app lists, searches and shows sessions without a network, and a queue of the changes made while offline (the outbox).
- The copy is plain text on the device, belongs to one user, holds nothing secret and is removed at sign-out. The user's Claude API key is never part of it: the key exists only on the server, encrypted (data-model.md 7.8).
- Pull: every project row and every session row carries `seq`, a number per user that the server assigns under a lock. A device asks for the changes after its cursor and receives each changed row once, in order, and a marker for each deleted row.
- Messages are not in that feed. A transcript is fetched session by session, when it is opened and in the background, and two fields of its session say whether the device has all of it: `messages_rev` and `message_count`.
- Push: six kinds of mutation (create, update and delete of a project or of a session), each with an id made on the device. The server applies a pushed batch in order, stops at the first mutation it refuses, and remembers every id, so that a repeat has no second effect.
- Conflicts are settled by the server with fixed rules (section 7): per field, the mutation that arrives last wins; a delete wins over an edit, but is refused when the session has messages the deleting device has not seen; projects created with the same name become one; the same file imported on two devices gives two sessions and a hint.
- A device shows, for every record, the newest server row it holds with its own queued mutations applied on top. It works that out when it reads and never stores the mixture. This one rule makes late, repeated and out-of-order answers harmless.
- Phase 2 already has to write `seq` and deletion markers on every change, and should already write through the six mutations. Phase 5 then adds only the device side (13.2).
- The rules of sections 3 to 7 were run as a model with simulated devices, a fake server and a faulty network: 32 named scenarios and more than 40,000 random schedules, all converged. The model found six mistakes in earlier drafts of these rules; 12.4 lists them, because each is a rule that looks optional and is not.

## 1. Conventions

- Tables and columns are those of data-model.md 7.2 and 7.9. Where a name appears here and there, data-model.md defines it.
- Routes are under `/api/` on the app's own origin and follow web-platform.md 13.4: the sign-in cookie, the cross-site checks, and the error shape `{"error": {"code", "message", "retryable"}}`. `GET /api/sessions/:id/messages` is listed there; `/api/sync/changes` and `/api/sync/push` are new.
- JSON in this document uses the column names, in `snake_case`, for rows and for the fields around them. They are the names of the interchange format too, with one exception: the place of a message is `position` here and `index` in an interchange file. Timestamps are RFC 3339 strings in UTC with three fraction digits. `seq` and all counts are JSON numbers.
- Example ids and texts are synthetic.
- "(model)" marks behaviour that was observed in the model of 12.4. "Inference" marks reasoning that was not run. "Not verified" marks what could not be checked.

| Word | Meaning |
|---|---|
| device | One browser profile, or one installed copy of the app, on one machine. An iPhone counts twice when the app is used in Safari and from the Home Screen (web-platform.md 4.1). |
| copy | The IndexedDB database of section 8 on a device. |
| server row | A project or session row as the server sent it, with its `seq`. |
| feed | The changes after a cursor (section 4). |
| cursor | The `seq` of the last change a device has applied. |
| mutation | One change that a device asks the server to make (section 6). |
| outbox | The queue of a device's mutations that have not been answered yet. |
| visible row | What the device shows for a record: the server row with its own queued mutations on top (6.3). |
| kept record | A record whose create the server refused and that stays on the device only (6.7). |

## 2. Scope: what is on a device

### 2.1 What is copied

| Data | In the copy | When |
|---|---|---|
| Projects | all | with the feed |
| Sessions: every field of the feed row (4.3), including the attachment descriptors | all | with the feed |
| Messages | whole transcripts, session by session | when a session is opened with a connection; in the background within a budget (5.4) |
| Attachment bytes | never | the first release stores none (data-model.md 7.2) |
| Claude turns in progress, text that is still streaming | never | section 11 |
| The Claude API key, or anything derived from it | never | section 10 |
| User settings (data-model.md 7.7) | the last value read, as a convenience | on load, with a connection |
| The sign-in cookie | not reachable by script (`HttpOnly`), so not in IndexedDB | |
| Shares received from other apps | in a database of their own (section 8), until imported | capture.md 8.2 |

### 2.2 Storage estimates

Inference; nothing was measured in a browser.

| Item | Estimate |
|---|---|
| One session record without messages | about 1 kB plus its summary |
| 5,000 sessions with summaries of 1 kB | about 10 MB |
| Message text | between `text_bytes` and twice `text_bytes` on disk, depending on how the browser stores strings (not verified) |
| One message of 1,000,000 characters | one record of 1 to 4 MB |
| A vault at the default quota of 1 GiB (data-model.md 7.10), copied whole | 1 to 2 GB |

Budgets are counted in `sessions.text_bytes`, which the device knows before it downloads anything. The settings screen shows the real figure from `navigator.storage.estimate()`.

### 2.3 Budget, quota errors and eviction

1. Budget for transcripts: by default the background fetch stops when the transcripts on the device add up to 256 MiB of `text_bytes`. It is a setting per device with three values: only what I open; the default; everything.
2. A session that the user opens is always stored, also beyond the budget.
3. Making room, when over budget or after a quota error, removes transcripts and never session records, in this order: not pinned and never opened on this device, oldest `imported_at` first; then opened ones, least recently opened first. Never removed: the transcript of a session whose create is still queued, or of a kept record. It exists nowhere else.
4. `QuotaExceededError` on a write:

| What was being written | What the device does |
|---|---|
| A transcript | Stop the background fetch. Make room once (rule 3) and retry once. If it fails again, leave that session without a transcript. |
| Feed rows | The copy cannot be complete. Keep the outbox, switch this device to reading from the server (2.4), tell the user. |
| An outbox entry, that is, a change made by the user | The action fails where the user can see it, and nothing is half-saved. For an import, the import screen keeps its content. |

5. Eviction. Under storage pressure a browser deletes all data of an origin at once, and Safari outside an installed app deletes script-written data after seven days without interaction (web-platform.md 7.1). The next start finds no database and begins a first sync (4.7). Synced data then costs a download. Queued changes that were never sent are lost: this is the one way this design can lose work. Against it: ask for persistent storage when the copy is switched on (`navigator.storage.persist()`), push as soon as there is a connection (2.5), and show the number of changes that are waiting.
6. Where the browser reports `navigator.connection.saveData`, do not fetch transcripts in the background.

### 2.4 Reading: from the copy or from the server

| State of the device | Lists, search, detail header | Transcript |
|---|---|---|
| Copy on, first sync finished | From the copy, with the functions of data-model.md section 8 in memory. | From the copy when it is complete there (5.1). Otherwise from the server, storing what arrives. |
| Copy on, first sync not finished | From the server (the read routes of phase 2). Without a connection: what the copy has, marked as incomplete. | As above. |
| Copy off (the setting, storage refused, or no IndexedDB) | From the server. Nothing of the vault is written to IndexedDB. Without a connection only the shell opens. | From the server. |

Both ways of reading must give the same lists: the vectors of data-model.md 9.2 are run against both. Writing goes through the outbox whenever the copy is on, with or without a connection, so that there is one write path (6.3). With the copy off, the same mutations are sent at once from memory and a failure is shown at once.

### 2.5 When sync runs

A run is: push everything in the outbox, then pull to the end. A run starts when the app starts, when the browser reports `online`, when the page becomes visible, right after the user makes a change, after a Claude turn, an import route or a capture that saved a session has answered, and every 60 seconds while the page is visible. No run starts before the check of 2.7, rule 4.

One run at a time per device: a run holds the Web Lock `sessionvault-sync` (`navigator.locks`). A tab that does not get the lock skips its run and reads the copy again when the other tab announces the end of its run on a `BroadcastChannel`. The lock only avoids duplicate work; no rule depends on it (4.4, 6.7).

Nothing runs while the app is closed. Background Sync exists only in Chromium (web-platform.md 7.1) and is not used.

### 2.6 Sign-in, sign-out and other users of the same device

1. The copy belongs to one user, named in `meta.owner_id`. One device holds at most one user's copy.
2. Sign-out by the user. If the outbox is not empty and there is a connection, push first. If entries remain, ask before going on ("3 changes have not been sent and will be lost"). Then end the sign-in session on the server and delete the database `sessionvault` and the share inbox from script. Do not rely on a `Clear-Site-Data` header alone. Without a connection the server session cannot be ended and script cannot remove an `HttpOnly` cookie: delete the local data, remember that a sign-out is pending (a flag, nothing secret), and end the session with the first request that gets through, before anything else is loaded.
3. The server answers `401 not_signed_in` to a request: the sign-in session ran out, the user signed out everywhere, or the account was deleted. Stop the run. At once, delete every server row and every transcript that came from the server and set the cursor to 0. Keep the outbox and what it needs: the queued creates, their messages, and kept records. Show sign-in, with the number of waiting changes and a way to discard them.
4. After sign-in the app asks the server who is signed in; the answer of `GET /api/auth/session` (web-platform.md 13.4) therefore has to carry the user id. The same user as `meta.owner_id`: start a run; its pull is a first sync (4.7). Another user: delete everything, the outbox and the share inbox included, before anything is shown; then start a run. The previous user's unsent changes are lost in that case: they can neither be shown to someone else nor sent as someone else.
5. Account deletion asked from this device: as rule 2, without the question.
6. Switching the copy off in the settings: push, then delete the database as in rule 2. The app goes on in the "copy off" way of 2.4.

On a shared computer, anyone who can use the unlocked browser profile can read the copy with the browser's developer tools. The copy is on by default (section 15, decision 1); the settings say so and offer the switch, and sign-out always removes the copy. Separate operating-system accounts and separate browser profiles have separate storage.

### 2.7 The user a sync request is for

Added on 2026-11-20 after a review. Without this section a device's queued changes could be sent under another user's sign-in: a run starts on a timer, a push named no user, and the cookie can become another person's while the first person's copy and outbox are still on the device (after a `401` the outbox is kept, and an invitation link creates a new sign-in session whatever was signed in before).

1. Both sync requests name the user the copy belongs to, `meta.owner_id`: the query parameter `user` of `GET /api/sync/changes`, and the property `user_id` in the body of `POST /api/sync/push`. With the copy off (2.4), and in phase 2 before the copy exists, the value is the user id that `GET /api/auth/session` returned to this page.
2. The server compares that value with the user of the sign-in session. If they differ it answers `409` with code `wrong_user`, applies nothing and returns nothing of anyone's vault. The value never selects whose data is read or written; it can only cause this refusal (data-model.md 7.12, I2).
3. A device that receives `wrong_user` stops the run and follows 2.6, rule 4, as after a sign-in by another user.
4. No run starts until the page holds an answer of `GET /api/auth/session` whose user id equals `meta.owner_id`, obtained after the page was loaded and after the last `401`, sign-in or sign-up. This holds in every tab.
5. A device that has no copy yet first asks who is signed in, stores that id as `meta.owner_id`, and only then sends its first sync request.
6. The sign-in and sign-up routes answer `409` with code `already_signed_in` while the request carries a valid sign-in session (web-platform.md 13.4). A second person on the same browser therefore has to go through sign-out, which removes the first person's copy (2.6, rule 2).

Tests: P30 in 12.1, check 7 in 12.2, and the last step of check 5 in 12.3.

## 3. Identity and ordering

### 3.1 Ids

Projects, sessions, messages and mutations get their ids on the device that creates them: `crypto.randomUUID()`, lower case, canonical form. The server refuses any other form with `validation`. Ids are unique per user, not across the server (data-model.md 7.7), so no id that a device makes can collide with another user's row or reveal that it exists.

### 3.2 The change sequence

`seq` is a whole number per user. The server gives the next one to every project row and session row it changes and to every deletion marker it writes, inside a transaction that holds a lock on the user's counter (data-model.md 7.9). What a device may rely on:

1. Within one user, a row that was committed later has a higher `seq`. No change can appear below a number that the device has already passed.
2. A row carries only the number of its latest change. A device that is far behind receives each row once, in its present state, and no history.
3. The numbers of different users have nothing to do with each other.

### 3.3 Time

| Value | Set by | Used for |
|---|---|---|
| `updated_at` | The server, when it accepts a change. An interchange import keeps the value of the file (data-model.md 6.7). | Display; which copy wins between the Apple app and the web (data-model.md 6.7). |
| `imported_at` and `created_at` of a session that a device creates | The device (data-model.md 8.6 and B7), so that the list does not reorder itself after sync. The server replaces an `imported_at` that lies in its future by its own time. | List order, timeline. |
| `at` in a mutation | The device. | Shown in notices; nothing else. |

No rule in this document compares clocks. Order is `seq` and nothing else.

### 3.4 Deletion markers

Deleting a project or a session leaves a row in `tombstones`: kind, id, `seq` and time (data-model.md 7.2). The feed delivers it as a deletion. A marker carries nothing of the deleted content. In the first release markers are kept as long as the account exists; a new device receives all of them with its first sync and ignores those for ids it does not hold. Messages have no markers of their own (5.1). Forgetting markers is left out on purpose (section 14).

### 3.5 Epoch

`SYNC_EPOCH` is a configuration string of the server, `1` at first. Every feed answer carries it. The owner changes it after the database has been restored from a backup or from point-in-time history, because numbers may then have been used twice, and whenever every device should start again. A device that holds another epoch starts again (4.8).

## 4. Pull: the change feed

### 4.1 Request

`GET /api/sync/changes?since=<n>&limit=<k>&epoch=<e>&user=<id>`

| Parameter | Value |
|---|---|
| `since` | The cursor: a whole number, 0 for a device that has not pulled yet. |
| `limit` | 1 to 500; default 200. |
| `epoch` | The epoch of the last answer. Left out while the device has none. |
| `user` | The user the copy belongs to (`meta.owner_id`). The server only compares it with the user of the sign-in session (2.7). |

### 4.2 Answer

```json
{
  "epoch": "1",
  "changes": [
    { "seq": 41, "entity": "project", "op": "upsert",
      "row": { "id": "00000000-0000-4000-8000-0000000000b1", "name": "Garden", "name_key": "garden",
               "created_at": "2026-11-20T10:00:00.000Z", "updated_at": "2026-11-20T10:00:00.000Z",
               "seq": 41, "extra": {} } },
    { "seq": 42, "entity": "session", "op": "upsert",
      "row": { "id": "00000000-0000-4000-8000-0000000000c1", "seq": 42 } },
    { "seq": 43, "entity": "session", "op": "delete", "id": "00000000-0000-4000-8000-0000000000c7" }
  ],
  "next": 43,
  "more": false,
  "latest": 43
}
```

The session row is cut short here; 4.3 lists its fields.

| Field | Meaning |
|---|---|
| `epoch` | 3.5. |
| `changes` | In ascending `seq`. `entity` is `project` or `session`. `op` is `upsert`, with `row`, or `delete`, with `id`. |
| `next` | The cursor to store: the `seq` of the last change in this answer, or `since` when `changes` is empty. |
| `more` | True when the answer was cut short: ask again with `since` set to `next`. |
| `latest` | The user's `change_seq` when the answer was made. For a progress display only. Do not wait for `next` to reach it: after a deletion or a second change to a row, some numbers no longer belong to anything. |

A page ends after `limit` changes or when the rows in it pass 1 MB, whichever comes first; it always holds at least one change if there is one. The server reads a page in one snapshot (data-model.md 7.9).

| Status | Code | When |
|---|---|---|
| 400 | `validation` | A parameter is not a whole number in range, or `user` is missing or not a canonical UUID. |
| 401 | `not_signed_in` | 2.6, rule 3. |
| 409 | `resync_required` | The `epoch` sent is not the server's, or `since` is above the user's `change_seq` (4.8). |
| 409 | `wrong_user` | The `user` sent is not the user of the sign-in session (2.7). |

### 4.3 Rows

| Row | Fields |
|---|---|
| project | `id`, `name`, `name_key`, `created_at`, `updated_at`, `seq`, `extra` |
| session | `id`, `project_id`, `title`, `provider`, `model`, `source_url`, `summary`, `tags`, `is_pinned`, `created_at`, `imported_at`, `updated_at`, `message_count`, `text_bytes`, `messages_rev`, `seq`, `extra`, `attachments` |
| attachment descriptor, inside its session | `id`, `kind`, `sha256`, `media_type`, `byte_length`, `filename`, `created_at`, `extra`, `has_bytes` (always false in the first release) |

Not sent: `owner_id`, `search_text` (the device computes it with `buildSearchText`, data-model.md 8.1), `import_hash`, `stored_bytes`. The whole `summary` is sent: the detail view and the context pack need it without a connection.

### 4.4 Applying a page

In one IndexedDB transaction: each change in order, then the cursor.

1. `upsert`: if the device holds a server row for that id with a higher `seq`, ignore the change. Otherwise the row replaces the server row held. For a session, compare `messages_rev` with the transcript on the device (5.1); if they differ, drop that transcript.
2. `delete`: if the device holds a server row for that id with a higher `seq`, ignore the change: an import has created the record again. Otherwise, if the outbox holds a create for that id that still awaits its answer, only forget the server row; that answer settles the matter (6.7). Otherwise remove the record, its transcript and every outbox entry for that id; if those entries held work of the user's, that is, anything but a delete of the same record, leave a notice (7, case 4).
3. A `delete` for an id that the device neither holds nor has entries for is ignored.
4. Store `next` as `meta.cursor` and the epoch as `meta.epoch`.

Rule 1 is also the rule for a row that comes back in a push answer (6.7). Applying a page twice, or after a newer answer, changes nothing (model).

### 4.5 Paging and resuming

The device asks again while `more` is true. If a request fails, or the app is closed between two pages, the next run continues from `meta.cursor`. Nothing has to be undone, because the cursor is stored in the same transaction as the rows of its page.

### 4.6 How deletions arrive

As `delete` changes in the feed, in `seq` order with everything else. A deleted project arrives after the sessions it was cleared from: the server gives those sessions their new numbers first (data-model.md 7.9). A session that names a project which the device does not show is shown without a project (6.3, rule 7); no other clean-up is needed.

### 4.7 The first sync

The same request, with `since=0` and no `epoch`. Nothing differs on the server. In particular, deletion markers are sent from cursor 0 as well: a device can hold server rows before its first pull, from the answers to its own pushes, and leaving the markers out of the first page lost a deletion in the model. What differs is on the device:

1. It reads from the server (2.4) until `more` is false for the first time. Then it sets `meta.first_sync_done` and reads from the copy.
2. It shows progress from `next` and `latest`.
3. It asks for persistent storage (2.3, rule 5).
4. The background fetch of transcripts (5.4) starts only after the first sync has finished.

### 4.8 `resync_required`

The device forgets every server row and every transcript that came from the server. It keeps the outbox, what the outbox needs (a record with a queued create, and its messages) and kept records. It sets the cursor to 0 and the epoch to none, and pulls from the start. Records with queued updates show again, with those updates, as soon as their server rows have come back (model).

## 5. Message bodies

### 5.1 The state of a transcript on a device

Per session the device keeps `rev` and `count`: the `messages_rev` that its stored messages belong to, and how many it has, counted from position 0 without a gap. The transcript is complete when `rev` equals the session's `messages_rev` and `count` equals its `message_count`. Messages are never edited or deleted one by one (data-model.md 2.2 and 4.3), so two numbers are enough:

| What happened on the server | What the device sees in the session row | What it does |
|---|---|---|
| Messages were appended (a Claude turn) | `message_count` grew | Fetch from position `count` on. |
| The message list was replaced (interchange import, outcome "updated") | `messages_rev` grew | Drop the transcript; fetch from position 0. |
| Nothing | Both unchanged | Nothing. |

A session created on this device has its messages on the device from the start, with `rev` 1. A session that was deleted and then created again by an interchange import starts with a `messages_rev` above every earlier one of that id (data-model.md 7.9), so a device that still holds the old transcript drops it.

### 5.2 Request and answer

`GET /api/sessions/:id/messages?after=<position>` (web-platform.md 13.4). `after` is left out for the first page.

```json
{
  "session_id": "00000000-0000-4000-8000-0000000000c1",
  "messages_rev": 1,
  "message_count": 4,
  "messages": [
    { "id": "00000000-0000-4000-8000-0000000000a0", "position": 0, "role": "user",
      "text": "My rear wheel wobbles.", "segments": null, "model": "", "created_at": null, "extra": {} }
  ],
  "more": true
}
```

Messages come in `position` order. A page ends once the `text_bytes` in it pass 1 MB (data-model.md 7.4), so a message of 1,000,000 characters is a page of its own. `404 not_found` means that this user has no such session.

### 5.3 Fetching

```text
state = the device's { rev, count } for the session; if none: { rev: messages_rev of the session row, count: 0 }
repeat:
    page = GET ...?after=<count - 1>            (no "after" when count is 0)
    404                        -> stop; the feed will deliver the deletion
    page.messages_rev != rev   -> drop the stored messages; rev = page.messages_rev; count = 0; repeat
    store page.messages and { rev, count + number of messages in the page } in one transaction
until page.more is false
```

Copying a message (data-model.md 7.14) needs that message on the device. The context pack and transcript search need the complete transcript: with an incomplete one and no connection, the interface says so and does not produce a partial pack.

### 5.4 Background fetch

After the first sync, and after every run while there is a connection: take the sessions whose transcript is not complete, pinned ones first, then in list order (`imported_at` descending), and fetch them one at a time until the budget of 2.3 is reached. Skip a session that alone would exceed what is left of the budget. Pause while a Claude turn is streaming on this device. Keep below the read limit of web-platform.md 11.5, and pause when a request is answered with 429.

## 6. Push: the outbox

### 6.1 Mutations

Six types. A device never changes messages: a transcript arrives whole inside `session.create`, and replies are appended by the server (section 11).

| `type` | Payload | Notes |
|---|---|---|
| `project.create` | `project`: `id`, `name` | |
| `project.update` | `id`; `fields`: `name` | Rename. |
| `project.delete` | `id` | |
| `session.create` | `session`: `id`, `title`, `provider`, `model`, `source_url`, `summary`, `tags`, `is_pinned`, `project_id`, `created_at`, `imported_at`, and optionally `extra`; `messages`: a list of `id`, `role`, `text`, and optionally `segments`, `model`, `created_at`, `extra` | An import made on the device (data-model.md 8.6). The message at place `i` of the list gets position `i`. `role` is any non-empty string and `segments` any segment list of data-model.md 6.3, so that a transcript with tool calls, tool results and subagent messages can travel (`../HANDOFF.md` section 5). Today's importers send plain text only. |
| `session.update` | `id`; `fields`: any of `title`, `provider`, `model`, `summary`, `tags`, `is_pinned`, `project_id`, `created_at` | Only the fields that are named are written. |
| `session.delete` | `id`, `seen_message_count`, `seen_messages_rev` | The `message_count` and `messages_rev` of the server row that the device holds when the user deletes, not the number of messages it has downloaded. For a record whose create was sent and not yet answered: the number of messages in that create, and 1. |

Every mutation also has `mutation_id` (a UUID made once, when the user acts; it is the idempotency key), `v` (the number 1) and `at` (the device's time, 3.3).

### 6.2 Example

```json
{ "user_id": "00000000-0000-4000-8000-00000000000a",
  "mutations": [
  { "mutation_id": "00000000-0000-4000-8000-00000000d001", "v": 1, "type": "session.update",
    "at": "2026-11-20T10:00:00.000Z", "id": "00000000-0000-4000-8000-0000000000c1",
    "fields": { "title": "Truing a wheel", "is_pinned": true } },
  { "mutation_id": "00000000-0000-4000-8000-00000000d002", "v": 1, "type": "project.create",
    "at": "2026-11-20T10:00:05.000Z",
    "project": { "id": "00000000-0000-4000-8000-0000000000b2", "name": "Bike workshop" } }
] }
```

### 6.3 Rules on the device

1. One transaction per user action: the outbox entry, and for an import its messages, are written together. Nothing else changes; in particular the server row held for the record is not touched.
2. What the device shows for a record is worked out every time it is read: the server row held for it or, if there is none, the queued create (or the kept record); then every queued update for it, in queue order, each overwriting the fields it names; a queued delete hides the record. The result is not stored (a cache in memory is fine). Section 7 rests on this rule.
3. An entry is complete in itself. It carries the values as they were when it was queued, not a pointer to the record. The one exception is the message list of a `session.create`, which is read from the copy when the entry is sent; messages never change, so nothing is lost by that.
4. Folding. A new change may be merged into an existing entry only if that entry is the last one in the outbox, concerns the same record, is a create or an update, and has never been sent. In every other case a new entry is appended. Merging into an entry further up changes the order of effects and loses work (model).
5. Before an entry is sent for the first time, its counter `attempts` is raised and stored. An entry with `attempts` above 0 may already have been applied, so it never takes in a later change (model).
6. Deleting a record whose create has never been sent, or a kept record, removes its entries, its messages and the record, and queues nothing. Deleting any other record queues a delete.
7. A session whose `project_id` matches no project that the device shows is shown as having no project. The stored value is left alone: the project may arrive with the next pull.
8. A project name that another project shown on the device already has (compared with `projectNameKey`, data-model.md 8.4) is refused on the device, before anything is queued. The server checks again (7, cases 9 and 11).
9. The order of the outbox is the order in which the user acted. It is never changed.

### 6.4 Request

`POST /api/sync/push` with a body as in 6.2. The body names the user the copy belongs to in `user_id` (2.7). The device sends the entries from the front of the outbox, in order, one request at a time.

| Batch | Limit |
|---|---|
| Entries other than `session.create` | up to 50 in one request; 256 kB. An entry that is larger than that by itself (a `session.update` with a long summary, which may be 1 MiB, data-model.md 7.10) travels alone, up to 2 MB; a larger one ends as `rejected` (6.8, rule 4) and does not block the queue |
| `session.create` | alone in its request; 32 MB, the limit of an import (web-platform.md 13.4) |

### 6.5 What the server does with one mutation

Each mutation is one write transaction (data-model.md 7.9). The server takes the mutations in the order of the request and stops after the first one it refuses; the ones after it are not looked at and get no result.

1. If `(owner_id, mutation_id)` is in `sync_mutations`: answer with the stored outcome and `replayed: true`. Nothing else happens.
2. Otherwise go through the row for its type, statement by statement. The first refusal ends it, and so does the first "applied" that says that nothing changes or that there is nothing to do.
3. Record the outcome, applied or refused, in `sync_mutations` in the same transaction.

| Type | Outcome |
|---|---|
| any | `v` or `type` unknown: refused, `unsupported`. An id that is not a canonical UUID: refused, `validation`. |
| `project.create` | The name is empty after trimming or over the limit of data-model.md 7.10: refused, `validation`. A project with this id exists: applied, nothing changes. A deletion marker for this id exists: refused, `gone`. Another project has the same `name_key`: refused, `name_taken`, with `existing_id`. Too many projects: refused, `quota_exceeded`. Else insert. |
| `project.update` | No such project: refused, `gone` if a marker exists, else `not_found`. The name is not valid: refused, `validation`. Another project has the same `name_key`: refused, `name_taken`, with `existing_id`. The name is already this one: applied, no new `seq`. Else write. |
| `project.delete` | No such project: applied, nothing to do. Else clear the project from its sessions, delete it and write the marker (data-model.md 7.9). |
| `session.create` | A session with this id exists: applied, nothing changes, whatever the payload says. A marker for this id exists: refused, `gone`. The payload is not valid: refused, `validation`. That covers the limits of data-model.md 7.10, a message id used twice or already used by this user, and text with U+0000, a lone surrogate or a carriage return, none of which the import module produces. Over a storage limit: refused, `quota_exceeded`. Else insert the session and its messages as data-model.md 8.6 says, with these differences: the ids and `imported_at` come from the payload (3.3); a `project_id` that names no project of this user is stored as null; tags are normalised as in data-model.md 8.2, and `provider` and every message `role` as in data-model.md 6.2, so that nothing is stored that is not in the form the interchange reader produces; where a message has `segments`, they are stored and its `text` is derived from them with `flattenText` (data-model.md 6.3), whatever `text` was sent; `import_hash` is computed. If other sessions of the user have the same `import_hash`, add `duplicate_of` with up to five of their ids. |
| `session.update` | No such session: refused, `gone` if a marker exists, else `not_found`. A field that is not in the list of 6.1, or a value over a limit: refused, `validation`. A `project_id` that names no project of this user is stored as null. `tags` and `provider` are normalised as for a create. No field ends up different: applied, no new `seq`. Else write the fields, `search_text`, `updated_at` and a new `seq`. |
| `session.delete` | No such session: applied, nothing to do. A Claude turn is running for it: refused, `turn_in_progress`. `messages_rev` differs from `seen_messages_rev`, or `message_count` is above `seen_message_count`: refused, `unseen_messages`. Else delete and write the marker. |

A device can therefore never bring back a record that was deleted: a create for an id that has a marker is refused. Only an interchange import does that (data-model.md 7.9).

### 6.6 Answer

Status 200 whenever the request itself was acceptable, also when a mutation was refused:

```json
{
  "results": [
    { "mutation_id": "00000000-0000-4000-8000-00000000d001", "status": "applied", "replayed": false,
      "entity": "session", "id": "00000000-0000-4000-8000-0000000000c1",
      "row": { "id": "00000000-0000-4000-8000-0000000000c1", "seq": 57 } },
    { "mutation_id": "00000000-0000-4000-8000-00000000d002", "status": "rejected", "code": "name_taken",
      "replayed": false, "entity": "project", "id": "00000000-0000-4000-8000-0000000000b2",
      "existing_id": "00000000-0000-4000-8000-0000000000b1", "row": null }
  ],
  "latest": 57
}
```

| Field | Meaning |
|---|---|
| `results` | One entry per mutation the server looked at, in order. Shorter than the request when the server stopped. |
| `status` | `applied` or `rejected`. |
| `code` | With `rejected`: `validation`, `unsupported`, `gone`, `not_found`, `name_taken`, `quota_exceeded`, `unseen_messages` or `turn_in_progress`. |
| `replayed` | True when the outcome comes from `sync_mutations`. |
| `row` | The record as it is on the server at this moment, in the shape of 4.3, or null if it does not exist. Also in a replay it is the row of this moment, not the row of the first time. Null after a delete. |
| `existing_id` | With `name_taken`: the project that has the name. |
| `limit` | With `quota_exceeded`: which quota was hit: `stored_bytes`, `sessions` or `projects` (data-model.md 7.10). |
| `duplicate_of` | With an applied `session.create`: 6.5. |

| Status | Code | When | The device |
|---|---|---|---|
| 400 | `validation` | The body is not shaped as in 6.2. | 6.8, rule 3. |
| 401 | `not_signed_in` | | 2.6, rule 3. |
| 409 | `wrong_user` | The `user_id` sent is not the user of the sign-in session. | Stop the run; 2.7, rule 3. |
| 403 | `account_suspended`, or the cross-site check of web-platform.md 11.3 | | Stop pushing, keep the outbox, tell the user. |
| 413 | | The request is over its limit. | 6.8, rule 4. |
| 429, 5xx, no answer | | | 6.8, rule 1. |

### 6.7 What the device does with an answer

One IndexedDB transaction per result, in order. A result for an entry that is no longer in the outbox is skipped. After a `rejected` result the device stops reading this answer and starts a new request.

| Result | The device |
|---|---|
| `applied`, create or update, `row` not null | Remove the entry. Take the row as the server row (4.4, rule 1). With `duplicate_of`: notice (7, case 10). |
| `applied`, create or update, `row` null | The record was deleted after this mutation had been applied. Remove the record, its transcript and every entry for it. Notice, unless the device itself has a delete queued for that record (7, case 14). |
| `applied`, delete | Remove the entry, every other entry for the record, the record and its transcript. |
| `rejected`, `gone` or `not_found` | As "`row` null" above. |
| `rejected`, `name_taken`, on `project.create` | Use the project that has the name: put `existing_id` in place of the refused project's id in every queued `session.update` and `session.create` and in kept records; then remove the refused project and its entries. Notice (7, case 9). The sessions show their project as soon as the existing project has arrived with a pull. |
| `rejected`, `validation`, `quota_exceeded` or `unsupported`, on a create | If the user has deleted the record meanwhile: remove it and its entries. Otherwise make it a kept record: store the values as last shown, with the code, and remove its entries. Notice. A kept record is shown as not saved. The user can try again (a new create with a new `mutation_id` and the same record id), edit it, export its text, or delete it. |
| `rejected`, anything else: `name_taken` on a rename, `validation` on an update, `unseen_messages`, `turn_in_progress` | Remove the entry and take `row` as the server row. That is the whole undo: what is shown is worked out from server row and outbox (6.3, rule 2), so the old name is back, or the session is visible again. Notice. |

### 6.8 Failure and retry

1. No answer, a 5xx status or 429: keep everything and try again: after 1 second, doubling up to 5 minutes, with some randomness, and at once when the browser reports `online`. A `Retry-After` header is honoured. The request may be repeated as it is.
2. An answer that arrives late, arrives twice, or arrives after a newer pull is processed like any other. The rules of 4.4 and 6.7 make that safe (model).
3. 400 for a batch: send its first entry alone. If that entry alone gets 400, treat it as `rejected` with `validation`. One bad entry never blocks the queue.
4. 413 for a request that holds one entry: treat that entry as `rejected` with `validation` (a `session.create` becomes a kept record). 413 for a batch: send its first entry alone, as in rule 3. No entry stays at the front of the queue after a 413.
5. Rows of `sync_mutations` may be removed after 90 days. A mutation that is repeated after that is looked at as a new one: a create finds its record or its marker and changes nothing, and a delete finds nothing to do. Only an update is applied a second time, and could then overwrite a newer value of the same fields. It takes a device that held an unanswered update for 90 days.
6. The server keeps accepting a mutation version for at least 90 days after the last release that produced it, so that an entry queued by an old release is never stranded.

## 7. Conflicts

All conflicts are settled on the server, by the order in which mutations reach it. Devices never compare versions. "Later" means: applied later by the server.

| # | Case | Rule | What the user sees |
|---|---|---|---|
| 1 | Two devices change different fields of a session. | Both changes stay: a mutation writes only the fields it names. | Both, on both devices, after their next run. |
| 2 | Two devices change the same field. | The later mutation wins. `tags` is one field: the later list replaces the earlier one. | The later value everywhere. No message. |
| 3 | A device has a queued change, and a newer server row arrives. | The queued change stays visible (6.3, rule 2) and wins when it is pushed, because it is then the later one. | Their own change, all the time. |
| 4 | One device deletes a session, another changes its fields. | The delete wins, in either order. A change that arrives after the delete is refused with `gone`. | The session disappears. On the device whose change was lost: "This session was deleted on another device." |
| 5 | A device deletes a session that has messages it has not seen, because a reply was added through another device. | The delete is refused: `unseen_messages`. | The session is back in the list, with "This session has new messages, so it was not deleted." |
| 6 | A session is deleted while Claude is answering in it. | The delete is refused: `turn_in_progress`. | The session is back, with "Claude is still answering in this session." |
| 7 | One device deletes a project, another renames it or puts sessions into it. | The delete wins. The rename is refused with `gone`. For the sessions see case 8. | The project is gone; its sessions have no project. |
| 8 | A session is moved into a project that does not exist for this user: deleted meanwhile, never accepted by the server, or another user's. | The session is stored without a project. The other fields of the same mutation are applied. The outcome does not depend on the order of arrival. | The session has no project. |
| 9 | Two devices create a project with the same name (compared without case and outer spaces). | One project: the one that arrives first. The second create is refused with `name_taken`, and the second device moves its sessions to the first project (6.7). | One project with all the sessions. On the second device: "Merged with the project of the same name." |
| 10 | Two devices import the same file, or one device imports it twice. | Two sessions. Nothing is merged or refused. The second create is answered with `duplicate_of`. | Both sessions. Where the second one was imported: "This looks the same as a session you already have", with a way to delete the new one. |
| 11 | A project is renamed to a name that another project has taken meanwhile. | The rename is refused: `name_taken`. | The old name again, with "That name is already used." |
| 12 | Two devices add messages to the same session. | Cannot happen. Only the server appends, one Claude turn at a time per session (claude-api.md C5), and Claude is not available offline. | |
| 13 | A reply is appended while another device changes fields of the session. | Independent: the append changes the message list and the counters, the mutation its fields. | Both. |
| 14 | A create was applied but its answer was lost; the record is then deleted from another device; the first device sends the create again. | The record stays deleted. The repeat is answered from `sync_mutations` with `row` null or, after 90 days, refused with `gone`. | The record disappears from the first device, with "deleted on another device". |
| 15 | An interchange import replaces a session that a device has queued changes for. | The import writes the values of the file. The queued changes are applied afterwards, on top, when they arrive. While a Claude turn is running for the session, the import does not replace its messages (data-model.md 7.9). | The imported session, with their own later changes. |
| 16 | The same mutation reaches the server twice. | One effect. The second gets the stored outcome. | Nothing. |

The sentences in quotation marks say what a notice has to convey; design.md words them. A device never reports "deleted on another device" for a deletion it asked for itself, also when the answer to that deletion was lost (model).

## 8. IndexedDB layout

Database `sessionvault`, version 1.

| Store | Key | Record |
|---|---|---|
| `meta` | `key` | `{ key, value }` for: `owner_id`, `epoch`, `cursor`, `first_sync_done`, `copy_budget_bytes`, `last_pull_at`, `last_push_at` |
| `projects` | `id` | `{ id, server, kept }`. `server` is the server row or null. `kept` is null, or `{ row, error }` for a kept record (6.7). |
| `sessions` | `id` | `{ id, server, kept, opened_at_ms }` |
| `bodies` | `session_id` | `{ session_id, rev, count, text_bytes }`: the state of 5.1 |
| `messages` | `[session_id, position]` | `{ session_id, position, id, role, text, segments, model, created_at, extra }` |
| `outbox` | `n`, auto-increment | `{ n, mutation_id, v, type, id, at, attempts }` and the payload of 6.1, without the messages of a `session.create` |
| `notices` | `n`, auto-increment | `{ n, code, entity, id, other_id, at }`, until the user has seen it. `code` is `deleted_elsewhere`, `project_merged`, `duplicate_import`, or a result code of 6.6 (`unseen_messages`, `turn_in_progress`, `name_taken`, `quota_exceeded`, `validation`, `unsupported`); design.md 4.15.8 words them. `other_id` is the project that now holds the sessions for `project_merged` (the `existing_id` of the refused create) and the first id of `duplicate_of` for `duplicate_import`; otherwise null |

A record that was created on this device and has not been answered yet has `server` null and `kept` null; what is shown for it comes from its queued create (6.3, rule 2).

One index: `mutation_id` on `outbox`, unique. No others are needed in the first version. All project and session records are read into memory at start (about 10 MB at 5,000 sessions, 2.2), where the functions of data-model.md section 8 filter, search and sort them. A transcript is read with the key range from `[session_id, 0]` to `[session_id, Infinity]`. Beyond roughly 10,000 sessions, add indexes on numeric copies of `imported_at` and `created_at` and read in windows.

A second database, `sessionvault-inbox`, holds the store `pendingShares` of capture.md 8.2. It is the only database that the service worker opens.

Transactions: a user action writes `outbox` and, for an import, `messages` and `bodies`. Applying a feed page writes `projects`, `sessions`, `bodies`, `messages`, `outbox`, `notices` and `meta`. Handling one push result writes the same stores.

Schema version and upgrade:

1. The version is the whole number given to `indexedDB.open`. It goes up by one with every release that adds a store or changes the shape of a record.
2. `onupgradeneeded` runs the steps for every version between the old and the new one, in order.
3. A step may empty `projects`, `sessions`, `bodies`, `messages` and `notices` and set the cursor to 0: the server fills them again. It must carry over the `outbox`, the messages of every queued `session.create`, and every kept record. A release that cannot do that must not ship.
4. `versionchange` on an open connection: close it and reload the page; another tab is running a newer release.
5. `blocked` when opening: ask the user to close the other tabs of the app.
6. `VersionError` when opening: the page is older than the data. Reload to take the waiting service worker. Never delete the database for this reason.

## 9. Service worker boundary

1. The service worker never handles a request whose path starts with `/api/`: no `respondWith`, no cache, no retry, no queue of its own. Such requests reach the network as if there were no service worker (the listing in web-platform.md 5.3).
2. The one request with a body that it does handle is `POST /share-target` (web-platform.md 5.3, capture.md 8.2): it stores the share in `sessionvault-inbox` and answers with a redirect.
3. It never opens the database `sessionvault`. So an upgrade of that database can never be blocked by a service worker, and vault data is read and written by pages only.
4. Sync runs in a page, or in a worker that a page started. There is no Background Sync and no periodic sync (2.5).
5. Cache Storage holds the files of the app shell and nothing else: never an API answer, never vault data (web-platform.md 7.3).
6. The "new version available, reload" step of web-platform.md 7.3 waits for a push request that is in flight. At any other moment a reload is safe, because the outbox is on disk.

## 10. Security

1. The copy is plain text on the device: titles, summaries, tags, links, and the transcripts that were fetched. So is the outbox, which holds what the user imported or typed. Anyone who can use the unlocked browser profile can read both. They are removed at sign-out, and the synced part also when the server says that the browser is no longer signed in (2.6).
2. Nothing secret is in IndexedDB. Not the Claude API key or any part of it: the key is typed into a form, sent once over HTTPS and never comes back (data-model.md 7.8), and the request that saves it is not a mutation and is never queued. Not the sign-in cookie: it is `HttpOnly`. No other token: sync authenticates with that cookie alone. The user id in `meta.owner_id` is an identifier, not a credential.
3. One device holds one user's copy; another user who signs in gets the previous copy removed first (2.6, rule 4).
4. A script that runs in the app's origin can read the whole copy. The content security policy and the rendering rules of web-platform.md 11.4 are therefore part of protecting it: transcripts are shown as text, never as HTML.
5. The server trusts nothing that a device computed. From a mutation it takes ids, texts and the fields of 6.1; it computes `seq`, `updated_at`, `message_count`, `text_bytes`, `search_text`, `name_key`, `import_hash` and the counters itself, and applies the limits of data-model.md 7.10.
6. Both sync routes take the user from the sign-in session and read and write that user's rows only (data-model.md 7.12, rules I7 and I8). A `mutation_id` is looked up together with the user id.
7. `POST /api/sync/push` changes state and gets the cross-site checks of web-platform.md 11.3. `GET /api/sync/changes` changes nothing.
8. Logs of both routes hold the user id, the cursor, counts, byte sizes, mutation types and result codes. Never a title, a name, a tag, a text or a mutation payload (`../HANDOFF.md` section 8).
9. Rate limits for both routes belong to phase 6 (web-platform.md 11.5). A device polls once a minute, so more than a few requests per second from one user is a fault or an attack.
10. Encrypting message text in the server (web-platform.md 11.6) would not change this document: the server decrypts before it answers, and the copy is plain text either way.
11. A sync request names the user it is for, and the server refuses a mismatch before it reads or writes anything (2.7).

## 11. Interplay with Claude turns

claude-api.md owns the turn. This is where it meets sync.

1. The commit of a turn (claude-api.md C5, the commit of a chat turn) is a write transaction of data-model.md 7.9: it appends the user message and the reply and gives the session a new `seq`. Other devices see `message_count` grow in the feed and fetch the two messages (5.1). Nothing else is needed for a reply to appear on them.
2. The device that ran the turn starts a run when `done` arrives. It may store the two messages from `done` itself if they continue its transcript (same `messages_rev`, positions `count` and `count + 1`); otherwise the fetch brings them.
3. Turns in progress are not synced. `claude_turns` is not in the feed, and text that is streaming is never written to IndexedDB. Another device learns of a running turn only by asking `GET /api/sessions/:id/turn` when it opens the session with a connection (claude-api.md C6).
4. Continue and Summarize need a connection, and they need the session to be on the server: they are not offered for a session whose create is still queued, or for a kept record.
5. Summarize writes `sessions.summary` on the server, which is an ordinary change in the feed. A queued summary edit that arrives later replaces it (7, case 2). One that arrives earlier is the existing summary that claude-api.md asks about before it replaces.
6. `sessions.model`, when the commit sets it (claude-api.md C5), travels in the same session row.
7. A reply cannot be lost to a delete from a device that has not seen it (7, cases 5 and 6).
8. A storage quota is checked before a turn starts, never at its commit (data-model.md 7.10).

## 12. Test plan

### 12.1 Protocol tests without a browser

Write the device side (4.4, 5.3, 6.3, 6.7, 6.8) as plain TypeScript against two interfaces: a store (in memory for tests, IndexedDB in the app) and a transport (a fake server for tests, `fetch` in the app). Write the fake server as a second, small implementation of 4.2 and 6.5 in memory. These tests need neither a browser nor a database and run in milliseconds. The transport of the tests can lose a request, lose an answer, deliver an answer late and deliver it twice.

Each row is one test. A and B are two devices of one user unless the row says otherwise.

| # | Given and when | Then |
|---|---|---|
| P1 | A is offline, imports a session, goes online; B syncs. | B has the session and its messages. |
| P2 | A pushes a create; the answer is lost; A pushes again. | One session on the server; the second push is a replay. |
| P3 | Offline, A changes the title and B the tags of one session; both sync. | Both changes on both. |
| P4 | A and B change the same title; B's push arrives first, then A's. | A's title everywhere. |
| P5 | B changes title and pin and syncs; A, with a queued title change, only pulls. | A shows its own title and B's pin. After A pushes: A's title everywhere. |
| P6 | A deletes a session, B changes it; A's push arrives first. | Deleted; B has a notice. |
| P7 | As P6, but B's push arrives first. | Deleted. |
| P8 | A reply is appended on the server; A, which has not seen it, deletes the session. | Not deleted; visible again on A, with a notice; four messages. |
| P9 | A turn is running; A deletes the session. | Not deleted; notice. |
| P10 | Offline, A and B import the same messages. | Two sessions; only the second device gets `duplicate_of`. |
| P11 | Offline, A creates the project "Garden"; B creates "garden ", moves a session into it and imports another into it; A syncs first. | One project, A's. Both of B's sessions are in it. B's project is gone. Notice on B. |
| P12 | A renames a project to "Three"; B renames another to "three"; A syncs first. | B's rename is refused; B shows the old name. |
| P13 | B deletes a project that has a session. | The session has no project on the server and on A; the project is gone on A. |
| P14 | A deletes a project; B moves a session into it; A syncs first. | The session has no project. |
| P15 | Offline: import, edit and delete the same session. | The outbox is empty, nothing is stored, nothing is ever sent. |
| P16 | Offline: import, then edit the title. | One entry; the server gets the edited title. |
| P17 | A create is sent and its answer lost; then the title is edited. | Two entries; the edited title reaches the server. |
| P18 | A reply is appended on the server. | B fetches two more messages. |
| P19 | The message list is replaced on the server. | Both devices drop the transcript and fetch the new one; `messages_rev` is 2. |
| P20 | The epoch changes while B has a queued import and a queued edit. | B starts again and still shows both; both reach the server. |
| P21 | The server refuses a create because of a quota. | Kept on the device and marked; the queue is empty; the entries behind it were not blocked. After room was made, "try again" stores it. |
| P22 | Eleven records, pages of three. | Everything arrives once. |
| P23 | A's create is applied and its answer lost; B deletes the session; A pulls, then pushes again. | Deleted everywhere; nothing is left on A. |
| P24 | A second user pushes a delete and an update for the id of the first user's session and asks for the feed. | The first user's session is unchanged; the second user's feed holds nothing of the first. |
| P25 | A pushes a create and never pulls; B deletes the record; A pulls. | Gone on A. This fails if deletions are left out of the page from cursor 0. |
| P26 | Queue: create the project "Garden"; delete the project "Bikes"; rename "Garden" to "Bikes". | Three entries in that order; the new project is "Bikes"; no notice. This fails if the rename is folded into the create. |
| P27 | A edits and deletes a session; both are applied and the answer is lost; A pulls, then pushes again. | No "deleted on another device" notice. |
| P28 | Queue: import a session; create a project; move the session into it. | The session is in the project. This fails if the move is folded into the create. |
| P29 | A's push answer is held back; B changes the same session; A pulls; then the held answer is processed. | A shows B's newer value and its own change. |
| P30 | A second user's sign-in session sends a push that carries the first user's `user_id` and the first user's queued import, and asks for the feed with the first user's id. | Both requests are answered with `wrong_user`; nothing is applied and nothing of either vault is returned; the device deletes the first user's copy and outbox before anything is shown (2.7). |

Random schedules. From a seed, generate 120 steps for two or three devices of one user: the user actions of 6.1, with a small set of names and files so that collisions are common; runs, pushes alone, pulls alone, transcript fetches, late and repeated answers, retries of kept records; and on the server: appended replies, replaced transcripts, a running-turn flag, forgotten mutation records, a new epoch. A share of the requests and answers is lost. Then make the network reliable and let every device run until nothing changes. Check:

1. Every device shows exactly what the server holds: the same projects and sessions with the same fields and, after fetching, the same messages.
2. Every outbox is empty. No device holds a record without a server row, other than kept records, and no transcript without its session.
3. On the server: no `seq` twice, none above the counter, `message_count` and positions right, no session with a project that does not exist, counters equal to the sums (the checks of data-model.md 7.3 and 7.10).
4. With one device alone: the server ends with exactly what that device showed, no mutation was refused, and no notice was raised.

### 12.2 Server tests with PostgreSQL

Against a scratch database of the workspace's PostgreSQL server (web-platform.md 13.3, step 7), with synthetic data:

1. The tests of 12.1 again, through HTTP against the real server in place of the fake one. The two must agree.
2. Two writers for one user at once. Start a transaction that holds the user's lock (data-model.md 7.9, step 1) and has written a row; start a second write; read the feed in between. The second write waits and the feed shows neither row. After the first commits, both rows appear, with ascending `seq`.
3. The feed is read in one snapshot. Commit a project and a session that refers to it while a feed request is between its reads (with a hook in the test build): the page holds both or neither.
4. Every check query of data-model.md 7.3 and 7.10 returns no rows after the whole suite.
5. Isolation: data-model.md 7.12, rules I2, I4, I7 and I8, for `/api/sync/changes`, `/api/sync/push` and `/api/sessions/:id/messages`.
6. Size: a `session.create` of 32 MB with one message of 4,000,000 bytes is stored; the feed page with its session row stays small; its transcript arrives in pages.
7. Whose request: with the second user's cookie, send a push whose `user_id` is the first user's, and a feed request with the first user's id as `user`. Both answer `409 wrong_user`, and no row of either user changes (2.7).

### 12.3 Browser checks

With the production build served by the Node server, in the workspace's headless Chromium (web-platform.md 13.2, rule 19), and two browser contexts as two devices:

1. Sync a vault. Switch the network off and reload: the shell opens, the list shows, a session whose transcript was fetched shows it, and copying a whole message works.
2. Still offline: import a transcript by paste. It is in the list, marked as not sent. Switch the network on: it appears in the second context.
3. Offline: rename, pin, tag, move and delete. Switch the network on: the second context follows.
4. Sign out: `indexedDB.databases()` lists neither `sessionvault` nor `sessionvault-inbox` (in a browser without that function, use the fallback of web-platform.md 7.4). Sign in as a second user in the same context: nothing of the first user is shown at any moment.
5. Let the sign-in session run out on the server while a change is queued: the copy is emptied, the sign-in screen shows one waiting change, and after sign-in as the same user the change is sent. Then the same with a different user signing in: nothing is sent, and the waiting change is deleted before anything is shown (2.7).
6. Two tabs: a change in one shows in the other without a reload, and only one of them syncs at a time.
7. Open the database with a higher version from a second tab: the first tab reloads, and the outbox is intact.
8. With all requests recorded: no `/api/` request was answered by the service worker, and Cache Storage holds no `/api/` entry.
9. IndexedDB, `localStorage`, Cache Storage and every response body of the run contain neither the value of the session cookie nor the test API key.

By the owner, once, on real devices: checks 1 to 3 on an Android phone with the installed app, with the offline import made through the share target; checks 1 and 2 on an iPhone from the Home Screen; and that the app recovers with a first sync after its storage was cleared.

### 12.4 What was run for this document

A model of sections 3 to 7 in plain JavaScript, executed in JavaScriptCore (`jsc`, macOS 27.2.1): the server rules of 4.2 and 6.5, the device rules of 4.4, 5.3, 6.3, 6.7 and the first two rules of 6.8, and a network that loses requests and answers, delivers answers late and delivers them twice. It is a verification instrument, not product code, and not part of the repository. 12.1 describes the tests the builder writes.

- 32 named scenarios pass. They are tests P1 to P29 of 12.1 (P21 is two scenarios) and two about rules that are not in the first version: one for item 1 of section 14, and one that shows the loss described in 4.7.
- Random schedules as in 12.1, all converged: 20,000 schedules of 120 steps with two or three devices and 20,000 with one device (about 820,000 mutations applied, 148,000 refused and 79,000 repeated), and 2,000 of each kind with 400 steps.
- Each of seven deliberately broken rules made at least one named scenario fail: no record of mutation ids; no stop at the first refusal; folding into an entry that is not the last; folding into an entry that was already sent; a create sent with the values shown now and not those queued; an older row taken over a newer one; a feed page that misses a row which a later read includes.

Six mistakes of earlier drafts that the model found. Each is now a rule above:

1. Deletion markers were left out of the page from cursor 0. A device that had pushed before it ever pulled then kept a record that had been deleted (4.7).
2. A later edit was folded into an earlier, unsent create, and a create was sent with the record's present values. A project created before another one was deleted took that one's name too early, was merged into it, and was deleted with it (6.3, rules 3 and 4).
3. A restart from cursor 0 dropped a record whose create had been applied and pulled but not yet answered, although the outbox still needed it (4.8).
4. A create that was refused after the user had already deleted the record left a hidden record behind (6.7).
5. A device reported its own deletion as "deleted on another device" when the answer to that deletion was lost and the feed delivered it first (section 7, last paragraph).
6. Refusing every cursor below a floor of forgotten deletion markers made a first sync loop forever (section 14, item 1).

Not run: any SQL, any browser, IndexedDB, the service worker, real network timing; and P30 with the rules of 2.7, which were added after these runs.

## 13. Done when

### 13.1 Phase 5

The "done when" of phase 5 in `../HANDOFF.md` section 7, item by item:

| `../HANDOFF.md` | Done when |
|---|---|
| The app shell loads without a network. | 12.3, check 1. |
| An IndexedDB copy of the user's vault, filled by a "changes since" request; reading works offline. | 12.1 passes. 12.3, check 1. A first sync of a vault of 2,000 synthetic sessions finishes, and can be interrupted and resumed. |
| Changes made offline are queued and replayed in order; each carries an identifier so that a replay is harmless. | The tests and the random schedules of 12.1 pass. 12.2, check 1. |
| With the network off, an installed app opens, lists and shows sessions synced earlier. | 12.3, check 1, and the owner's check on a phone. |
| It accepts an import that appears on a second device after reconnecting. | 12.3, check 2. |
| Signing out removes the local copy. | 12.3, checks 4 and 5. |
| Android share target. | web-platform.md 5.3 and capture.md 8.2. From this document only: a share received offline can be imported offline (the owner's check). |

And: the service worker boundary holds (12.3, check 8); nothing secret is in browser storage (12.3, check 9); the isolation rules hold for the sync routes (12.2, check 5).

### 13.2 What earlier phases must already do

So that phase 5 adds a device side and changes nothing on the server:

| Phase | Requirement |
|---|---|
| 2 | The first migration has `seq`, `messages_rev`, `import_hash`, `tombstones`, `sync_mutations` and `users.change_seq` (data-model.md 7.2). |
| 2 | Every write to the vault tables goes through the write transaction of data-model.md 7.9. No route changes a row without a new `seq`, and no delete goes without its marker. The check queries run in the test suite from the first day. |
| 2 | Browsers make the ids of projects, sessions and messages and send a `mutation_id` with every change. Recommended: build `POST /api/sync/push` in phase 2 and let the page call it for every change, at once and from memory. Build it with `user_id` from the start (2.7). The write routes of web-platform.md 13.4 (`POST /api/sessions`, `PATCH` and `DELETE /api/sessions/:id`, and the project routes) are then not needed; if they are built anyway, they call the same six handlers. Phase 5 then only puts the outbox in front. |
| 2 | `GET /api/sync/changes` may wait for phase 5. It is one query (data-model.md 7.9). |
| 3 | A capture result is stored through the same write transaction, like an import. |
| 4 | The commit of a turn is a write transaction (section 11). |

## 14. Left out of the first version

1. Forgetting deletion markers. They are tiny and are kept as long as the account exists. Forgetting them safely needs three more rules, each of which the model showed to be necessary: the feed returns a floor (the highest number of a forgotten marker) and the device sends back the last floor it saw; the server answers `resync_required` only when the cursor is below a floor that the device has not seen; and a device that starts from cursor 0 first drops the server rows it holds. The obvious rule, "refuse every cursor below the floor", makes a first sync loop forever.
2. A push channel. Devices poll (2.5): a change made elsewhere shows within a minute, or at once when the app is opened.
3. Background Sync, and anything else that runs while the app is closed.
4. Claude without a connection, and Claude for a session that is not on the server yet.
5. Interchange import, whole-vault export and link capture without a connection. They run on the server. Paste and file import work offline, because the import module also runs in the browser (import-rules.md C4).
6. Attachment bytes in the copy.
7. Merging of tag lists or of text. A field is replaced as a whole (7, case 2).
8. A screen for resolving conflicts by hand. Every case of section 7 has one outcome.
9. Editing or deleting single messages. If that is ever added, the simplest correct rule is to raise `messages_rev`.
10. Encryption of the copy on the device, or a passphrase to open it.
11. Sync of settings through the feed. `user_settings` is read with a connection.
12. Sync with the Apple app. The two apps exchange interchange files by hand (data-model.md section 6), and deletions do not travel between them.
13. Indexes in IndexedDB and lists read in windows (section 8).
14. Search in transcripts that are not on the device.

## 15. Decisions for the owner

Build the default until the owner answers.

| # | Question | Default |
|---|---|---|
| 1 | Is the offline copy on for every device a user signs in on, or only where the user switches it on? | On, with a switch per device in the settings and a line saying that sign-out removes the copy. `../HANDOFF.md` section 2 says "an offline copy on each device". |
| 2 | How much transcript text is fetched in the background? | 256 MiB per device, and on top of that everything the user opens. |
| 3 | A session got new messages elsewhere, and a device that has not seen them deletes it: refuse the delete, or delete? | Refuse (7, case 5). A reply that was paid for is not lost to a stale list. |
| 4 | The same transcript imported twice: keep both, merge, or refuse? | Keep both and say so (7, case 10). It is what the Apple app does, minus the silence. |
| 5 | May deletion markers (kind, id and time of a deleted record, nothing of its content) be kept as long as the account exists? | Yes. Account deletion removes them. |
| 6 | When a sign-in session runs out, the synced data is removed from the device and downloaded again after sign-in. Acceptable? | Yes. The alternative keeps the data on the device behind the sign-in screen, where developer tools can still read it. |
| 7 | How soon must a change show on another open device? | Within a minute, by polling. Sooner needs a push channel (section 14). |
| 8 | A change that was queued on a device that stayed offline for days replaces a newer value of the same field from another device, without a notice (7, cases 2 and 3). Acceptable? | Yes. The alternative is a notice whenever a pushed change replaced a value that the device had not seen. |
