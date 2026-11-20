# Data model, persistence, search, organisation, context packs and interchange format

> **Status (2026-11-20).** Extracted from the Apple app's source, written for one owner and one server-side API key. The parts on what the Apple app does and on its defects are ready to build from. Where the web design here assumes a single owner or a single key, `../HANDOFF.md` section 2 wins, and section 5 there lists what is being revised.

## Summary

- The Apple app stores three SwiftData entities: `Project`, `ChatSession`, `ChatMessage`. They have no explicit ids, no uniqueness rules and no "last changed" timestamp. Provider and role are plain strings backed by enums. A message is one plain string; the prose/code "segments" are computed when a message is displayed and are never stored. The only binary data is one optional PDF per session.
- Organisation is: at most one project per session, an ordered list of lower-case tag strings, and a pin flag. There are no sort options. Lists are "pinned first, then newest import first". The timeline groups by calendar month of the "original date" in the device time zone.
- Search is a case-insensitive substring test over title, summary and tags only. No tokenising, no trimming, diacritics matter, and message text is not searched.
- A context pack is a fixed Markdown template with no size limit. It is a one-way format. The app has no structured export, backup or sync today.
- For the web this document specifies: interchange JSON version 1 (`interchange-schema-v1.json` and `example-vault-export.json`, both machine-checked), a PostgreSQL schema draft with `owner_id` on every row, rules for message bodies of about 1,000,000 characters, an IndexedDB sketch for the browser-only alternative, and a note on what the Apple app needs later.
- Section 9 gives expected results for the example file (list order, search hits, timeline groups, four context packs with SHA-256). They were produced by running the app's real Swift code and are meant as golden tests.
- Main traps: `created_at` means the original conversation date and not a row timestamp; UUID letter case; timestamp fractions; NUL characters; huge messages; unknown fields must survive a round trip.

## 1. Conventions and evidence

- Sections are labelled **(A)** what the Apple app does today, **(B)** defects or accidents the web app should not copy, **(C)** what must differ because it is a web app. Sections 6 to 8 are new design.
- `file:line` references are relative to the repository root, for example `apple/SessionVault/Models.swift:52`. After the first mention a bare file name is used. All such names are files of the live app: `Models.swift`, `Importers.swift`, `ContextPack.swift`, `ClaudeAPI.swift`, `WebCapture.swift` and `SessionVaultApp.swift` are in `apple/SessionVault/`; every `...View.swift`, `ImportSheet.swift`, `PDFViewer.swift` and `ProviderStyle.swift` is in `apple/SessionVault/Views/`. Nothing here refers to `reference/session-capture-ios/`. `README.md` means the root README; the app's own is written `apple/README.md`. A reference that starts with a colon, such as `:65`, continues in the file named immediately before it.
- Non-ASCII characters inside quoted strings are written as `\uXXXX` escapes (for example `"Rename\u2026"`).
- "Verified" means: observed by compiling the repository's real Swift files (`Models.swift`, `ContextPack.swift`, `Importers.swift`) together with a small test program and running it. Toolchain: Swift 6.4 in Swift 5 language mode (the project's setting), macOS 27.2. SwiftData was only used with in-memory stores or a throw-away store. The app itself was not run and no real vault was read.
- "Inference" marks a conclusion of the author that the code does not show directly. "Not verified" marks something that could not be checked.
- Nothing in section 7 (SQL) was executed: no PostgreSQL server was available.
- The JavaScript of section 8 was executed, with the type annotations removed, in JavaScriptCore (the `jsc` shell that ships with macOS; Node was not available). It reproduced the Swift results of section 9: the four context packs byte for byte, every search result, the list order and both timelines. The same rules were also re-implemented in Python from this text alone, with the same results. `parseTags` and the project comparator contain deliberate changes and were only checked against the examples given for them. The repair, import and export rules of 6.6 to 6.8 were exercised with a small reference implementation in the same shell (9.4).
- Other handoff documents referred to: import-rules.md (parsers that produce sessions), capture.md (link capture and PDF creation), claude-api.md (continue and summarise), design.md (screens and rendering), web-platform.md (hosting, sign-in, HTTP API, browser APIs). Where one of them specifies behaviour of a flow it owns, it wins; this document wins for table, column and file-format definitions.

## 2. (A) What the Apple app stores today

### 2.1 Storage engine and lifecycle

| Fact | Evidence |
|---|---|
| One default SwiftData container for the three model types | `apple/SessionVault/SessionVaultApp.swift:10`: `.modelContainer(for: [ChatSession.self, ChatMessage.self, Project.self])` |
| On disk, autosave on, undo off | Defaults of that modifier (`inMemory: false, isAutosaveEnabled: true, isUndoEnabled: false`, read from the SDK interface). Verified: `mainContext.autosaveEnabled == true`, `undoManager == nil`. |
| No explicit save anywhere | No call to `save()` exists in `apple/SessionVault`. Every edit is a direct mutation of a model object. |
| No schema versions, no migration plan, no predicates | The only SwiftData annotations are `Models.swift:43`, `:65`, `:67` and six `@Query` properties (`RootView.swift:26-27`, `SessionListView.swift:9-10`, `SessionDetailView.swift:11`, `:16`). All filtering happens in memory. |
| Store location on the Mac | `~/Library/Application Support/default.store` with `-shm`, `-wal` and a `.default_SUPPORT` folder (`README.md:75`). On iOS it is inside the app's container (inference). |
| No sync, no backup, no sharing between devices | iCloud sync is only an idea (`apple/README.md:32`). One device, one writer. |
| No stored settings | No `UserDefaults`, `@AppStorage` or `@SceneStorage` in the sources. Search text, the selected filter and the chosen Claude model are not remembered. The API key is in the Keychain (see claude-api.md). |

The store file is an implementation detail of SwiftData (an earlier analysis reported an SQLite file with Apple-specific encodings for tags, dates and PDFs; not re-verified here). The web app never reads it. Data moves through the interchange format of section 6.

### 2.2 Entities

`Project` (`apple/SessionVault/Models.swift:38-50`)

| Field | Swift type | Default | Written by | Notes |
|---|---|---|---|---|
| `name` | `String` | `"Untitled Project"` (never used: the initialiser requires a name) | create `RootView.swift:88-96`, rename `RootView.swift:103-106` | Callers trim spaces and tabs and refuse an empty result. Duplicate names are allowed (verified). |
| `createdAt` | `Date` | now | `Models.swift:48` | Never read by any view. |
| `sessions` | `[ChatSession]` | `[]` | inverse of `ChatSession.project` | `@Relationship(deleteRule: .nullify, inverse: \ChatSession.project)` (`Models.swift:43-44`). Deleting a project keeps its sessions and clears their project (verified). |

`ChatSession` (`apple/SessionVault/Models.swift:52-95`)

| Field | Swift type | Default | Written by | Notes |
|---|---|---|---|---|
| `title` | `String` | `"Untitled"` | importer; text field `SessionDetailView.swift:165` | Live binding, no validation. Can become the empty string. |
| `providerRaw` | `String` | `"Other"` | initialiser; picker `SessionDetailView.swift:169-176`; paste fallback `ImportSheet.swift:220-222` | See 2.3. |
| `modelName` | `String` | `""` | text field `SessionDetailView.swift:186`; overwritten with the selected Claude model id after every saved reply `ContinueChatView.swift:297` | Free text. No importer sets it. |
| `sourceURL` | `String` | `""` | puller Markdown `Source:` line (`Importers.swift:244`, `:273`); link capture (`ImportSheet.swift:142`) | For link capture it is the URL the user entered, not the URL after redirects (`LinkCaptureView.swift:54` passes `initialURL`). Not editable. Shown as a link only if `URL(string:)` accepts it (`SessionDetailView.swift:199`). |
| `summary` | `String` | `""` | multi-line field `SessionDetailView.swift:196`; "Summarize" replaces it `SessionDetailView.swift:154` | Free text with line breaks. Can be long: the summarise prompt keeps code blocks verbatim. |
| `tags` | `[String]` | `[]` | only `saveTags()` `SessionDetailView.swift:220-226` | Ordered. See 3.2. |
| `isPinned` | `Bool` | `false` | toolbar `SessionDetailView.swift:74-76`, context menu `SessionListView.swift:122-124` | |
| `createdAt` | `Date` | now | `Importers.swift:443`: `parsed.createdAt ?? .now`; date picker `SessionDetailView.swift:207-211` | The "Original date". Only the ChatGPT export parser supplies a value (`create_time`, `Importers.swift:296`, `:338`); every other import gets the import time. |
| `importedAt` | `Date` | now | `Models.swift:84` only | Never changes. |
| `project` | `Project?` | `nil` | picker `SessionDetailView.swift:177-185`, context menu `SessionListView.swift:125-130` | At most one project. |
| `snapshotPDF` | `Data?` | `nil` | link capture only, `ImportSheet.swift:148` | `@Attribute(.externalStorage)` (`Models.swift:65`). See 2.7. |
| `messages` | `[ChatMessage]` | `[]` | importer, continue chat | `@Relationship(deleteRule: .cascade, inverse: \ChatMessage.session)` (`Models.swift:67-68`). Deleting a session deletes its messages (verified). Stored without order. |
| `provider` (computed) | `Provider` | | `Models.swift:87-90` | `Provider(rawValue: providerRaw) ?? .other` |
| `orderedMessages` (computed) | `[ChatMessage]` | | `Models.swift:92-94` | `messages.sorted { $0.index < $1.index }` |

`ChatMessage` (`apple/SessionVault/Models.swift:97-114`)

| Field | Swift type | Default | Written by | Notes |
|---|---|---|---|---|
| `index` | `Int` | `0` | import: position in the parsed list, starting at 0 (`Importers.swift:446-447`); continue chat: `max(index) + 1` for the user turn and `+ 2` for the reply (`ContinueChatView.swift:254-255`, `:294`) | Sole ordering key. |
| `roleRaw` | `String` | `"unknown"` | initialiser | See 2.3. |
| `text` | `String` | `""` | initialiser | Whole message as one string. Never edited after creation (no code path writes it). |
| `session` | `ChatSession?` | `nil` | set by the caller right after creation | Optional in the model, always set in practice. |
| `role` (computed) | `Role` | | `Models.swift:110-113` | `Role(rawValue: roleRaw) ?? .unknown` |

Messages have no timestamp, no model, no attachments and no id.

### 2.3 Enumerations and how the provider is represented

`Provider` (`Models.swift:4-20`). The stored string is the display name.

| Case | Raw value stored in `providerRaw` | SF Symbol (`symbolName`) | Tint (`Views/ProviderStyle.swift:5-12`) |
|---|---|---|---|
| `.claude` | `"Claude"` | `sparkle` | orange |
| `.chatgpt` | `"ChatGPT"` | `bubble.left.and.bubble.right` | teal |
| `.gemini` | `"Gemini"` | `rhombus` | blue |
| `.other` | `"Other"` | `questionmark.circle` | gray |

`Role` (`Models.swift:22-36`)

| Case | Raw value stored in `roleRaw` | Label shown (`label`) |
|---|---|---|
| `.user` | `"user"` | `User` |
| `.assistant` | `"assistant"` | `Assistant` |
| `.system` | `"system"` | `System` |
| `.unknown` | `"unknown"` | `Note` |

Verified behaviour of the string-backed design:

- Matching is exact and case-sensitive. `providerRaw = "claude"` reads as `.other`; `roleRaw = "User"` reads as `.unknown`.
- An unknown string is kept in storage and only *behaves* as `.other` / `.unknown` (`providerRaw = "Grok"` reads as Other, the stored value stays `"Grok"`). The raw value is replaced only when the user picks a provider.
- The sidebar lists `Provider.allCases` in declaration order: Claude, ChatGPT, Gemini, Other (`RootView.swift:160-170`).
- Which roles occur: `user`, `assistant` and `unknown` from all importers; `system` only from a `System:` marker in text imports; the ChatGPT export parser drops system messages and maps every other role (for example tool output) to `unknown` (`Importers.swift:324-331`). Details: import-rules.md.

### 2.4 Identity and uniqueness

- No model has an id property. Identity is SwiftData's `persistentModelID`, which is local to one store file. `Identifiable.id` is that value (verified), and `RootView.swift:63` uses it as view identity.
- There is no `@Attribute(.unique)` and no duplicate check anywhere. Verified: inserting the same session twice yields two sessions; two projects can have the same name. Importing the same file twice therefore creates two sessions.
- Nothing links a session to the same session on another device.

### 2.5 Timestamps: which code sets what

| Timestamp | Set when | Changed later | Read by |
|---|---|---|---|
| `Project.createdAt` | project creation (`Models.swift:48`) | never | nothing |
| `ChatSession.createdAt` | import: `parsed.createdAt ?? .now` (`Importers.swift:443`) | user, date picker with `displayedComponents: .date` (`SessionDetailView.swift:207-211`) | timeline sort and month grouping (`SessionListView.swift:44-47`), context pack (`ContextPack.swift:13`) |
| `ChatSession.importedAt` | import: now (`Models.swift:84`) | never | default list sort (`SessionListView.swift:9`, `:37`), row label (`:167`), detail header (`SessionDetailView.swift:213`) |
| message time, any "updated" time | do not exist | | |

Not verified: whether the date-only picker keeps the time of day when the user changes the day (it is SwiftUI behaviour, not app code).

Verified: sessions inserted in one loop get strictly increasing `importedAt` values, so a batch import lists the last conversation of the file first.

### 2.6 Messages: order and segments

- Order is `index` ascending. Two code paths sort: `orderedMessages` (`Models.swift:92-94`, used by the context pack, summarise and continue chat) and the detail view's `@Query(sort: \ChatMessage.index)` over all messages of the vault, filtered in memory by session (`SessionDetailView.swift:16`, `:24-27`).
- Indexes are contiguous from 0 by construction. Nothing enforces uniqueness.
- "N turns" in the list row and the detail header is `session.messages.count`, counting every role (`SessionListView.swift:169`, `SessionDetailView.swift:213`).
- Segments are not stored. `MessageSegment.parse(message.text)` (`apple/SessionVault/Views/MessageView.swift:37-94`) splits the text into `prose(String)` and `code(language: String?, code: String)` each time a bubble is drawn. Algorithm (verified against 14 cases):

```text
segments = []; prose = []; code = []; language = null; inCode = false
for line in text.split("\n"):                       # LF only
    t = line with spaces, tabs and other Unicode space separators trimmed at both ends
    if inCode:
        if t == "```":  emit code(language, code.join("\n")); code = []; language = null; inCode = false
        else:           code.append(line)           # the untrimmed line
    else if t.startsWith("```"):
        flushProse()
        tag = t.dropFirst(3) trimmed; language = (tag == "" ? null : tag); inCode = true
    else:
        prose.append(line)
at the end: if inCode: emit code(language, code.join("\n"))   # unterminated fence still becomes code
            else: flushProse()
flushProse(): joined = prose.join("\n"); prose = []
              if joined trimmed of white space and line breaks != "": emit prose(joined)   # joined itself is not trimmed
```

- Each prose segment is then split on blank lines into paragraphs and rendered with inline-only Markdown (`MessageView.swift:110-123`); headings, lists and tables are not rendered as blocks. Rendering belongs to design.md.

### 2.7 Binary data

- Exactly one kind: `snapshotPDF`, the PDF of the captured page, created by `WebCaptureController.snapshotPDF()` (`apple/SessionVault/WebCapture.swift:120-142`; see capture.md). It is `nil` for file and clipboard imports and when PDF creation failed.
- `@Attribute(.externalStorage)` lets SwiftData keep the bytes in a side file next to the store instead of in the row. To the app it is still one in-memory `Data` value.
- Set once at capture (`ImportSheet.swift:148`), never replaced, deleted with the session.
- Shown by "View Original" only when it is not `nil` (`SessionDetailView.swift:52-58`, `:98-102`), in a PDFKit view (`Views/PDFViewer.swift`).
- There are no images, no file attachments and no per-message binary data.

## 3. (A) Organisation, lists and search today

### 3.1 Projects

- A session belongs to zero or one project. A project is only a name.
- Create: alert with one text field; the name is trimmed; an empty name does nothing; the new project becomes the selected filter (`RootView.swift:86-100`).
- Rename: same rule (`RootView.swift:101-108`). Delete: context menu, immediately, no confirmation; if it was the selected filter the filter becomes All (`RootView.swift:140-143`).
- Assign: picker in the detail header with "No Project" first (`SessionDetailView.swift:177-185`), or "Move to Project" in a row's context menu with "None" first (`SessionListView.swift:125-130`).
- Sidebar order: `@Query(sort: \Project.name)`. Verified with an offscreen SwiftUI probe: this is code-point order, not alphabetical order. Example result: `" leading space", "10 things", "2 things", "Apple", "Banana", "Zebra", "_x", "apple", "apple 10", "apple 2", "banana", "eclair", "zebra", "\u00C5ngstr\u00F6m", "\u00C9clair"`.
- Sidebar badge: `project.sessions.count` (`RootView.swift:133`).

### 3.2 Tags

- Representation: `tags: [String]` on the session. There is no tag entity. The sidebar's tag list is derived: `Array(Set(sessions.flatMap(\.tags))).sorted()` (`RootView.swift:36-38`), code-point order, hidden when empty (`RootView.swift:171`).
- Editing: one text field, "Tags (comma separated)" (`SessionDetailView.swift:190-195`). It is filled from `session.tags.joined(separator: ", ")` when the view appears (`:92-94`) and written back only on Return or when "Copy Context Pack" is pressed (`:192`, `:229`).
- Parsing (`SessionDetailView.swift:220-226`), verified:

```text
tags = field.split(",")
            .map(trim spaces, tabs and other Unicode space separators; then lowercased())
            .filter(not empty)
"Garden, Bikes ,, garden,  Two Words , #hash" -> ["garden", "bikes", "garden", "two words", "#hash"]
"a;b" -> ["a;b"]        "UPPER,upper,Upper" -> ["upper", "upper", "upper"]
```

  Order is kept. Duplicates are kept. Inner spaces are kept. A `#` typed by the user is kept, and rows display `"#" + tag`.
- Display: list rows show `tags.map { "#\($0)" }.joined(separator: "  ")` (two spaces, `SessionListView.swift:174`). The context pack prints `tags.joined(separator: ", ")`.
- Filter by tag: `$0.tags.contains(tag)`, exact string equality (`SessionListView.swift:24-25`).

### 3.3 Pinning

`isPinned` is the only favourite mechanism. Toggle from the toolbar or a row's context menu. Effects: the "Pinned" filter, a badge with the pinned count (`RootView.swift:124-126`), a pin icon on the row, and pinned sessions sort first in every list except the timeline.

### 3.4 Filters, counts and the fixed list order

`LibraryFilter` (`apple/SessionVault/Views/RootView.swift:4-22`): exactly one filter is active; the default is `.all`.

| Filter | Title | Sessions shown (`SessionListView.swift:15-26`) | Sidebar badge |
|---|---|---|---|
| `.all` | `All Sessions` | all | `sessions.count` |
| `.pinned` | `Pinned` | `isPinned` | number of pinned sessions |
| `.timeline` | `Timeline` | all, grouped (3.5) | none |
| `.project(p)` | the project's name | `session.project == p` | `p.sessions.count` |
| `.provider(p)` | the provider's raw value | `session.provider == p`; unknown stored strings count as Other | none |
| `.tag(t)` | `"#" + t` | `session.tags.contains(t)` | none |

Order of every list except the timeline (`SessionListView.swift:35-38`): pinned before unpinned, then `importedAt` descending. Sessions with equal `importedAt` have no defined order. There is no sort menu and no other filter (no date range, no "has PDF", no combination of filters).

Deleting a session: swipe (not in the timeline, `SessionListView.swift:76-80`) or context menu (`:131-133`); immediate, no confirmation, no undo; the selection is cleared if it was that session (`:137-140`).

### 3.5 Timeline

`SessionListView.swift:43-55`, `:103-115`:

1. Take the filtered, searched list (the timeline filter itself removes nothing).
2. Sort by `createdAt` descending. Pinned sessions are not moved to the top here.
3. Walk the list; group key = `createdAt.formatted(.dateTime.year().month(.wide))`; consecutive sessions with the same key form one section.
4. Section header: the key, and `"N session"` when N is 1, otherwise `"N sessions"`.

Verified: the key depends on the device's locale and time zone. In `en_US` it reads `November 2026`; in `fr_FR` `novembre 2026`; in `ja_JP` `2026\u5E7411\u6708`. The instant `2025-12-31T23:59:59Z` falls into `December 2025` in Honolulu and `January 2026` in Auckland.

### 3.6 Search

`SessionListView.swift:27-34`, prompt `"Search titles, summaries, tags"` (`:84`):

```swift
if !searchText.isEmpty {
    let needle = searchText.lowercased()
    result = result.filter {
        $0.title.lowercased().contains(needle)
            || $0.summary.lowercased().contains(needle)
            || $0.tags.contains { $0.lowercased().contains(needle) }
    }
}
```

| Aspect | Behaviour | Verified example |
|---|---|---|
| Fields | title, summary, each tag. Not: message text, model, source URL, provider, project name. | query `spoke` finds nothing although a message contains it; `claude` does not find sessions whose provider is Claude |
| Scope | applied after the active filter, so it searches inside the current filter only | |
| Case | insensitive, by `lowercased()` on both sides | `BICYCLE` finds `Bicycle Repair` |
| Tokenising | none; the whole query is one substring, inner spaces included | `cycle rep` finds `Bicycle Repair`; `repair bicycle` does not |
| Trimming | none | `" bicycle"` and `"repair "` find nothing; a single space matches every session whose title, summary or a tag contains a space |
| Diacritics | significant | `cafe` does not find `Caf\u00E9` |
| Unicode forms | canonically equivalent text matches (composed and decomposed forms are equal) | `caf\u00E9` finds `Cafe\u0301` and the reverse |
| Other folding | none | `strasse` does not find `Stra\u00DFe`; full-width letters do not match ASCII; `istanbul` does not find `\u0130stanbul` |
| Tags | the tag text only, without the displayed `#` | `#garden` does not find the tag `garden` |
| Result order | the list order of 3.4 | |

The search text is view state of the list column and is not stored.

### 3.7 What each screen reads

| Screen element | Fields read | Evidence |
|---|---|---|
| List row | provider (chip), `isPinned`, `title` (1 line), `summary` (1 line, only if not empty), `importedAt` as a relative phrase, `messages.count` as `"N turns"`, tags | `SessionListView.swift:143-196` |
| Detail header | `title`, provider, project, `modelName`, tags, `summary`, `sourceURL`, `createdAt`, `importedAt`, `messages.count`; toolbar: whether `snapshotPDF` exists, `isPinned` | `SessionDetailView.swift:50-91`, `:163-218` |
| Transcript | all messages of the session: `role`, `text`, in index order | `SessionDetailView.swift:24-45`, `Views/MessageView.swift:8-34` |
| Sidebar | counts of 3.4, project names, tag list | `RootView.swift:118-184` |
| Continue chat, summarise | all messages: `role`, `text`; writes described in 4.3 | `ContinueChatView.swift:248-305`, `SessionDetailView.swift:119-161` |

Verified sample of the relative phrase in `en_US`: `5 seconds ago`, `2 minutes ago`, `3 hours ago`, `yesterday`, `last week`, `last month`, `last year`.

## 4. (A) Context packs, exports and every write path

### 4.1 Context pack

Source: `apple/SessionVault/ContextPack.swift:7-43`. One function, `ContextPack.markdown(for:)`, builds a list of lines and joins them with `"\n"`.

Template. `<...>` are values, `[ ... ]` is a line or block that is left out when its condition is false. Every other line is literal.

~~~~text
# Context pack: <title>
(empty line)
Origin: <provider display name>[ (<modelName>)], saved <createdAt as a date>
[Source: <sourceURL>]                      only if sourceURL is not empty
[Tags: <tags joined by ", ">]              only if there is at least one tag
(empty line)
[## Summary                                only if summary is not empty: these four lines
(empty line)
<summary>
(empty line)]
You are being given the transcript of an earlier conversation the user had
with another AI assistant. Read it, treat its decisions and facts as established
context, and continue helping from where it left off.
(empty line)
## Transcript
(empty line)
then, for every message in index order, these six lines:
**<role label>:**
(empty line)
<message text>
(empty line)
---
(empty line)
~~~~

Exact rules:

- `<provider display name>` is `session.provider.rawValue`: `Claude`, `ChatGPT`, `Gemini` or `Other`. An unknown stored provider prints `Other`.
- ` (<modelName>)` appears only when `modelName` is not empty.
- `<createdAt as a date>` is `createdAt.formatted(date: .abbreviated, time: .omitted)`. It is the *original date*, printed after the word `saved`. The text depends on device locale and time zone (verified: `Nov 19, 2026` in `en_US`, `19 Nov 2026` in `en_GB`, `19. Nov. 2026` in `de_DE`).
- `<role label>` is `User`, `Assistant`, `System` or `Note` (2.3).
- Every message is included: all roles, empty texts too. Message text is inserted unchanged; nothing is escaped.
- Because the lines are joined with `"\n"` and the last element is an empty string, the result ends with exactly one line break: `...---\n`, or `## Transcript\n` when there are no messages.
- Limits and truncation: none. There is no size cap, no token budget and no shortening. A session with a 1,000,000-character message produces a pack of that size. ("Token-budgeted context packs" is only an idea, `apple/README.md:35`.)
- Not included: project, pin state, import date, ids, message count, the PDF.

Section 9.3 contains complete outputs.

How it leaves the app:

| Action | Code | What happens |
|---|---|---|
| "Copy Context Pack" | `SessionDetailView.swift:82-86`, `:228-241` | First saves the tag field, then puts the pack on the system pasteboard as plain text. The button reads "Copied!" for 2 seconds. |
| "Share Context Pack" | `SessionDetailView.swift:87-89` | `ShareLink(item: String)`: the system share sheet receives the pack as text. No file, no file name. The tag field is not saved first. |

### 4.2 Other exports and structured import or export today

| Capability | Exists today? | Detail |
|---|---|---|
| Share the PDF original | yes | "Share PDF" in the viewer writes `<name>.pdf` to the temporary folder and shares the file. `<name>` is the title with `/` replaced by `-`, or `Session` if the title is empty (`Views/PDFViewer.swift:35-45`, `:59-65`). |
| Export one session as structured data (JSON or similar) | no | |
| Export or back up the whole vault | no | |
| Export as a Markdown file, HTML, or print | no | The context pack exists only as clipboard or share-sheet text. |
| Import a context pack back | not as a round trip | Verified: `SessionImporter.parseText` turns a pack into a first `Note` message holding the header and preamble, keeps the `---` lines inside message texts, and merges a `**Note:**` turn into the turn before it. Title, tags, summary and dates are lost. |
| Structured imports | two | ChatGPT `conversations.json` and the puller's Markdown; plus generic role-marked text. See import-rules.md. All of them produce only: title, provider, source URL, optional original date, and messages (`ImportedSession`, `Importers.swift:9-16`; its `modelName` field is never filled). |
| Import of this document's interchange JSON | no | Verified: given to the current importer, an interchange file becomes one session with a single `Note` message containing the raw JSON, labelled Claude because the text contains that word. Do not point users at that route until the Apple app is updated (section 10). |

### 4.3 Every write path

| Operation | Code | Fields written |
|---|---|---|
| Import from file, drop or paste | `Importers.swift:435-452` | new session: `title`, `providerRaw`, `modelName` (always `""`), `sourceURL`, `createdAt = parsed.createdAt ?? now`, `importedAt = now`; messages with `index` 0..n-1, `roleRaw`, `text` |
| Link capture | `ImportSheet.swift:133-151` | as import, then `snapshotPDF` |
| Edit title, model label, summary | `SessionDetailView.swift:165`, `:186`, `:196` | the field, on every keystroke |
| Change provider or project | `SessionDetailView.swift:169-185`, `SessionListView.swift:125-130` | `providerRaw`, `project` |
| Edit tags | `SessionDetailView.swift:220-226` | `tags`, on Return or on "Copy Context Pack" |
| Edit original date | `SessionDetailView.swift:207-211` | `createdAt` |
| Pin or unpin | `SessionDetailView.swift:74-76`, `SessionListView.swift:122-124` | `isPinned` |
| Summarise | `SessionDetailView.swift:150-155` | `summary` replaced by the trimmed reply |
| Continue chat, send | `ContinueChatView.swift:254-257` | new message: `index = max + 1`, role `user`, trimmed input. Saved before the request is sent. |
| Continue chat, reply | `ContinueChatView.swift:293-298` | new message: `index = max + 2`, role `assistant`, trimmed reply; `session.modelName = selected model id`. On refusal, error or an empty reply no assistant message is saved and `modelName` is untouched; the user's message stays saved. |
| Delete session | `SessionListView.swift:137-140` | session and its messages |
| Create, rename, delete project | `RootView.swift:88-96`, `:103-106`, `:140-143` | project; on delete the sessions' `project` becomes `nil` |

Never written after creation: `sourceURL`, `importedAt`, `snapshotPDF`, and a message's `index`, `roleRaw`, `text`.

## 5. (B) and (C): what not to copy, and what must differ

### 5.1 (B) Defects and accidents of the Apple implementation

| # | What the Apple app does | Evidence | Do this instead |
|---|---|---|---|
| B1 | No stable ids; identity is local to one store file | 2.4 | UUID on every project, session and message. |
| B2 | No duplicate protection; two projects can share a name | 2.4, verified | Project names unique per owner, compared trimmed and case-insensitively. Session duplicates: allowed, optionally warn when `source_url` and message count match an existing session. |
| B3 | Tags: duplicates kept; saved only on Return or on Copy, so typed tags are lost when the user navigates away; a typed `#` gives `##tag` on screen; "Share" does not save pending tag edits but "Copy" does | 3.2, `SessionDetailView.swift:192`, `:229`, `:87` | `parseTags` of 8.2: trim, lower-case, drop empty, strip leading `#`, de-duplicate keeping the first. Save when the field loses focus or a tag is committed. |
| B4 | Search query is not trimmed | 3.6, verified | Trim the query; an all-white-space query means "no search". Everything else in 3.6 stays. |
| B5 | Project list in code-point order (`Zebra` before `apple`, `10 things` before `2 things`) | 3.1, verified | Case-insensitive order with natural numbers (8.4). |
| B6 | The context pack's date text depends on device locale and time zone | 4.1, verified | A pure function with a fixed `en-US` format and an explicit time zone argument (8.3). |
| B7 | Batch imports appear in reverse file order | 2.5, verified | Keep file order: give item `i` of `n` the value `batch time + (n - 1 - i)` milliseconds as `imported_at`, so the first item of the file lists first. Inference about intent; if import-rules.md says otherwise, follow it. |
| B8 | The detail view loads every message of the whole vault and filters in memory | `SessionDetailView.swift:16`, `:24-27` | Query by session id, ordered by position. |
| B9 | Deleting a session or project is immediate, with no confirmation and no undo | `SessionListView.swift:131-140`, `RootView.swift:140-143` | Confirm, or offer undo. Owner decision whether a trash is wanted. |
| B10 | An empty title can be stored | `SessionDetailView.swift:165` | Store what the user typed, but display an empty title as `Untitled`; or refuse to commit an empty title. |
| B11 | Continue chat overwrites `modelName` with the Claude model id, also for sessions that came from another provider; the pack then reads for example `Origin: ChatGPT (claude-opus-5)` | `ContinueChatView.swift:297`, `ContextPack.swift:11-12` | Record the model on the reply message (`messages.model`). Set `sessions.model` only when it is empty. claude-api.md owns this flow; the data model supports both choices. |
| B12 | "Summarize" replaces a summary the user wrote, without asking | `SessionDetailView.swift:154` | Ask before replacing a non-empty summary. Owned by claude-api.md. |
| B13 | Text is stored with whatever line endings arrived; with CR LF the code-fence parser fails (the language becomes `python\r` and the block never closes) | verified with `MessageSegment.parse` | Stored message text uses LF only. Normalise `\r\n` and lone `\r` to `\n` at the import boundary (import-rules.md) and when reading interchange files. |
| B14 | Fence parser accidents: a prose line that merely starts with three backticks swallows the rest of the message as code; four-backtick fences and `~~~` fences are not understood | verified, 2.6 | Render with a CommonMark-compliant Markdown library (design.md). The stored text is not changed. |
| B15 | PDF file name: only `/` is replaced | `Views/PDFViewer.swift:36` | Replace backslash, slash, colon, asterisk, question mark, double quote, both angle brackets, the vertical bar and control characters with `-`; trim trailing dots and spaces; cap the length; fall back to `session`. Those are the characters Windows forbids in file names. |
| B16 | No "last changed" time, so two copies of a session cannot be compared | 2.5 | `updated_at` on sessions and projects. |
| B17 | The context pack is the only export and cannot be imported back | 4.2, verified | Keep the pack as is (it is for pasting into a model). Use the interchange format for backup and transfer. |
| B18 | Row label reads `1 turns`; an empty filter or project shows the "Your Vault Is Empty" text even when the vault has sessions; a selected tag filter stays selected after its last session loses the tag | `SessionListView.swift:169`, `:86-93` | Singular form for 1; a neutral empty state per filter; fall back to All when the active tag or project no longer exists. Details: design.md. |

### 5.2 (C) Differences forced by the web

| # | Topic | What the web app must do |
|---|---|---|
| C1 | Persistence | Rows in a server database, each with `owner_id`; every query and every write is scoped to the signed-in owner. No object graph, no autosave: each edit is an explicit request (debounce text fields). |
| C2 | Identity | UUIDs created by the server (`gen_random_uuid()`) or by the client (`crypto.randomUUID()`, which needs a secure context). |
| C3 | Several devices | The same vault can be open twice. Keep `updated_at`; appending a message must be atomic on the server (7.3); last write wins per field update. |
| C4 | Lists | Never load message text for lists. Keep `message_count` and `text_bytes` on the session. Return only a short summary preview in list rows (summaries can be long). Page long lists and long transcripts. |
| C5 | Search | Runs in SQL against a normalised column, with the normalisation done in TypeScript so that server, browser and tests agree (8.1). |
| C6 | Dates | Store UTC instants. Format and group in the viewer's time zone and locale in the browser. The timeline month of a session can differ between two devices; that is expected. |
| C7 | Binary originals | Bytes in the database or in object storage, addressed by SHA-256, served through an authenticated URL. The browser shows the PDF; there is no PDFKit. Whether the web capture can create a PDF at all is decided in capture.md. |
| C8 | Sharing a context pack | Clipboard needs a secure context and a user gesture; the Web Share API is not available everywhere and share sheets can reject very large text. Always offer "Download .md" as well. Share large packs as a file. See web-platform.md. |
| C9 | Text hygiene | PostgreSQL `text` and `jsonb` reject U+0000, and `jsonb` rejects lone surrogates. Remove U+0000 and replace lone surrogates with U+FFFD in every string at the import boundary. |
| C10 | Size limits | A single message can be megabytes. HTTP body limits, JSON parsing, and database driver payload limits must be set with that in mind (7.4). |
| C11 | Transfer between apps | New feature: export and import of the interchange format (section 6). |
| C12 | Stored values are untrusted | Everything in the vault can come from an imported file or a captured page. In a browser that matters where it did not on Apple: show `source_url` as a link only when it parses as an `http:` or `https:` URL (the Apple app links any string `URL(string:)` accepts, `SessionDetailView.swift:199`); never insert message text, titles or summaries as raw HTML; serve attachment bytes inline only for an allow-list of media types (`application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`) and everything else as a download with `X-Content-Type-Options: nosniff`, because the stored `media_type` comes from the file. Headers and sanitising: web-platform.md and design.md. |

## 6. Interchange format, version 1

Files: `interchange-schema-v1.json` (JSON Schema, draft-07) and `example-vault-export.json` (valid example). The schema is authoritative for structure; this section adds meaning and the rules a schema cannot express.

### 6.1 Document

A document is one JSON object, UTF-8 without a byte-order mark. Property names are `snake_case`.

```json
{
  "format": "sessionvault-interchange",
  "version": 1,
  "kind": "vault",
  "exported_at": "2026-11-19T12:00:00.000Z",
  "generator": { "app": "sessionvault-web", "app_version": "0.1.0", "platform": "web" },
  "projects": [ { "id": "...", "name": "Garden", "created_at": "...", "updated_at": "..." } ],
  "sessions": [ {
    "id": "...", "title": "...", "provider": "gemini", "model": "", "source_url": "", "summary": "",
    "tags": ["garden"], "is_pinned": true,
    "created_at": "...", "imported_at": "...", "updated_at": "...",
    "project_id": "... or null",
    "attachments": [ { "kind": "original_pdf", "sha256": "...", "media_type": "application/pdf",
                       "byte_length": 616, "filename": "...", "created_at": "...", "data_base64": "..." } ],
    "messages": [ { "id": "...", "index": 0, "role": "user",
                    "segments": [ { "type": "text", "text": "..." } ] } ]
  } ]
}
```

| Property | Required | Meaning |
|---|---|---|
| `format` | yes | Always `"sessionvault-interchange"`. Check it first. |
| `version` | yes | `1`. Additive changes keep 1. A reader that sees a larger number refuses the file with a clear message and imports nothing. |
| `kind` | yes | `"vault"`: all projects (also empty ones) and all sessions of one vault. `"session"`: exactly one session and at most one project (its own). |
| `exported_at` | yes | When the file was written. |
| `generator` | no | `app` (`"sessionvault-web"` or `"sessionvault-apple"`), `app_version`, `platform`. Informational. |
| `projects`, `sessions` | yes | Arrays, possibly empty. Order carries no meaning. |

A single-session document has the same shape: `"kind": "session"`, exactly one entry in `sessions`, and in `projects` either nothing or the one project that session belongs to. Checked: the first session of the example file together with its project is a valid session document.

Field rules:

- Ids: UUID strings in canonical lower-case form. Verified trap: Swift's `UUID().uuidString` is upper-case, JavaScript's `crypto.randomUUID()` and PostgreSQL are lower-case. Writers lower-case; readers lower-case before comparing or using an id as a map key.
- Timestamps: RFC 3339, UTC, literal `Z`, optional fraction of 1 to 9 digits. Writers emit exactly 3 digits (what `Date.prototype.toISOString()` produces). Readers accept both forms. Do not compare timestamp strings; parse them.
- Strings that can be "absent" (`model`, `source_url`, `summary`, attachment `filename`) use the empty string, as the Swift model does. Writers do not emit `null` for them.
- `created_at` of a session is the original date; `imported_at` is when the session first entered any vault and is carried along unchanged when the session moves between apps; `updated_at` is the last change to the session or its message list.
- `tags`: ordered, each trimmed, lower-case, not empty, without commas, no duplicates.
- `messages`: in conversation order; `messages[i].index` equals `i`.

### 6.2 Open lists and their fallback value

`provider`, `role`, attachment `kind` and segment `type` are strings, not closed enums. For each there is a list of known values and one fallback. An unknown value is **kept as written** in storage and on export, and only **behaves** as the fallback. (This is what the Apple model already does with `providerRaw` and `roleRaw`, 2.3.)

| Property | Known values | Fallback behaviour | Swift counterpart |
|---|---|---|---|
| `provider` | `claude`, `chatgpt`, `gemini`, `other` | `other` | `Provider` case names; raw values are `Claude`, `ChatGPT`, `Gemini`, `Other` |
| `role` | `user`, `assistant`, `system`, `unknown` | `unknown` (label `Note`) | `Role` raw values, identical strings |
| attachment `kind` | `original_pdf`, `image`, `file`, `other` | `other` | `original_pdf` is `snapshotPDF`; the rest is new |
| segment `type` | `text`, `attachment` | opaque: kept, left out of the flattened text, shown as a placeholder | new |
| `model` | informative only: `claude-opus-5`, `claude-fable-5-1`, `claude-fable-5`, `claude-sonnet-5`, `claude-haiku-4-5` (`apple/SessionVault/ClaudeAPI.swift:8-14`) | none: free text, never validated | `modelName` |

Rules for readers: match known `provider` values case-insensitively and store them lower-case; store any other value trimmed and unchanged (empty becomes `other`). Same for `role` with fallback `unknown`. The "Other" provider filter must therefore be "not one of claude, chatgpt, gemini", not "equals other".

The current list of Claude model ids belongs to claude-api.md; the list above only documents what the Apple app offered.

### 6.3 Messages, segments and the flattened text

A message's content is an ordered array of segments.

| Segment | Shape | Meaning |
|---|---|---|
| text | `{ "type": "text", "text": "..." }` | Markdown source exactly as stored. May be empty. Fenced code blocks stay inside the text; they are **not** separate segments. |
| attachment | `{ "type": "attachment", "sha256": "..." }` | A binary object shown at this place. The hash must be listed in the same session's `attachments`. |
| anything else | `{ "type": "...", ... }` | Unknown to version 1. Kept unchanged. |

Why code is not a segment: the Apple model has one `text` string per message and derives prose and code at display time (2.6). Keeping the raw text makes the round trip Apple -> JSON -> Apple byte-exact and leaves exactly one source of truth.

The **flattened text** of a message is what search, context packs, the Claude API history and the Apple model's `text` field use:

```ts
function flattenText(segments: { type: string; text?: string }[]): string {
  return segments.filter(s => s.type === "text").map(s => s.text ?? "").join("\n\n");
}
```

Rules: a message has at least one segment (an empty message is one text segment with `""`); two text segments never follow each other directly (writers merge them); a message that only has text is written as exactly one text segment. The Apple exporter writes `[{ "type": "text", "text": message.text }]`; the Apple importer stores `flattenText(segments)`.

Version 1 apps only have to *keep* attachment segments and unknown segments. Showing an image attachment inline is optional.

### 6.4 Attachments and how the bytes travel

Each session lists every binary object it refers to in `attachments`: the page snapshot and anything referenced from segments. A descriptor has `kind`, `sha256` (64 lower-case hex characters, of the raw bytes), `media_type` (lower case, no parameters), `byte_length`, and optionally `filename`, `created_at`, `data_base64`.

The bytes travel in one of three ways:

| Way | How | Use |
|---|---|---|
| Inline | `data_base64` in the descriptor: standard base64 with padding, no line breaks | Single sessions and small vaults. The only form the Apple app needs at first (`JSONEncoder` writes `Data` as base64 by default, verified). |
| Omitted | no `data_base64` and no bundle entry | "Export without originals". The reader keeps the descriptor and treats the bytes as missing: no "View original" button, and the descriptor is exported again unchanged. |
| Bundle | a ZIP file | Large vaults. Optional for both apps in version 1. |

Bundle layout (optional):

```text
vault.json                 a kind "vault" document; its "sessions" array may be empty
sessions/<session-id>.json one kind "session" document per session (each lists its own project)
blobs/<sha256>             raw bytes of an attachment, no file extension
```

Reader: read `vault.json` first, then every `sessions/*.json`; treat all of them as documents to merge; resolve a descriptor without `data_base64` to `blobs/<sha256>` if that entry exists. Accept only entry names of exactly these three shapes (a hash is 64 lower-case hex characters, a session id is a canonical UUID), ignore every other entry, never write an entry to disk under its archive name, and cap the total uncompressed size. Splitting sessions into files keeps memory bounded: a vault with many megabyte-sized transcripts should not be one JSON string. Guideline (inference): use one JSON file up to about 50 MB, a bundle beyond that.

Suggested file names: `sessionvault-vault-YYYYMMDD-HHMMSS.json` and `<title made file-system safe>.session.json`. Media type `application/json`.

### 6.5 Forward compatibility

1. Unknown properties are allowed on every object. A reader that stores data and can export it again must keep the unknown properties of projects, sessions, messages, attachments and segments and write them back at the same place. In PostgreSQL that is the `extra` column (7.2); for segments it is the `segments` column.
2. Unknown top-level properties of the document describe the file, not the vault; they are not stored.
3. Property names starting with `x_` are reserved for app-specific extensions and will never get a standard meaning. Future standard fields never start with `x_`. When an app stores a value of its own in `extra`, the key must start with `x_` (7.6).
4. Unknown values of open lists: 6.2.
5. When a later app version learns a field that older versions kept in `extra`, its migration moves the value out of `extra`.
6. Builder trap: schema libraries often drop unknown keys by default (zod's `z.object` does). Use the passthrough mode, and test with the `x_` fields of the example file.
7. Builder trap: wherever code copies properties key by key (collecting `extra`, or the string-cleaning pass of 6.6), drop the names `__proto__`, `constructor` and `prototype`, or copy into objects without a prototype. Assigning `__proto__` on a plain JavaScript object replaces its prototype instead of storing a value. The first version of the reference implementation written for this handoff had exactly this bug in its cleaning pass.

### 6.6 Rules a schema cannot express

Writers must satisfy all of them. Rule numbers match the validator used for this handoff.

| Rule | Statement |
|---|---|
| R1 | Every timestamp is a real calendar instant. |
| R2 | Ids are unique: among projects, among sessions, and among all messages of the document. |
| R3 | A non-null `project_id` is the id of an entry in `projects` of the same document. |
| R4 | Tags are trimmed and lower-case. |
| R5 | Within a session, `(kind, sha256)` is unique among attachments; at most one `original_pdf`; when `data_base64` is present, its decoded length equals `byte_length` and its SHA-256 equals `sha256`. |
| R6 | `messages[i].index == i`. |
| R7 | No two text segments in a row; the `sha256` of an attachment segment is listed in the session's `attachments`. |
| R8 | A `kind: "session"` document lists no project other than the session's own. |
| R9 | No string contains U+0000 or a lone surrogate. |
| R10 | Text segments contain no carriage return. |
| R11 | Warning only: project names should be unique when trimmed and compared without case. |
| R12 | Warning only: `updated_at` should not be earlier than `imported_at`. |

Readers must be lenient. Before validating, apply this repair list and report what was repaired:

1. Lower-case all ids.
2. Fold known `provider` and `role` values to lower case.
3. Treat `null` or a missing value as the default for optional properties: `model`, `source_url`, `summary` -> `""`; `tags` -> `[]`; `is_pinned` -> `false`; `project_id` -> `null`; `attachments` -> `[]`; `updated_at` -> `imported_at` (project: `created_at`); attachment `filename` -> `""` and attachment `created_at` -> the session's `imported_at`. A message's `created_at` and `model` stay absent when absent.
4. Normalise tags with `parseTags` (8.2) applied to each element.
5. In every string remove U+0000 and replace lone surrogates with U+FFFD. In text segments turn `\r\n` and `\r` into `\n`.
6. Sort messages by `(index, original array position)` and renumber them 0..n-1.
7. Merge adjacent text segments with `"\n\n"`.
8. A `project_id` that resolves neither in the document nor in the destination vault becomes `null`, with a warning.
9. Inline bytes whose length or hash does not match the descriptor are discarded (the descriptor stays, bytes missing), with a warning.

After the repair list, a document that still violates the schema or R1 to R10 is rejected as a whole, with the list of problems.

### 6.7 Import algorithm (merge)

Import never deletes. A project or session that is absent from the file is left alone, also for `kind: "vault"`. There are no deletion markers in version 1, so this is transfer and backup, not synchronisation.

```text
importDocument(owner, document, options):
  1. parse; check format; check version == 1; repair (6.6); validate
  2. projects, each:
       a. a project of this owner with the same id exists
            -> if incoming updated_at is later: update name (and name_key); else keep
               (if the new name_key already belongs to another project: keep the old name, warn)
       b. else a project of this owner has the same name_key (8.4)
            -> use that project; remember "incoming id -> existing id" for step 3
       c. else insert it with the incoming id
  3. sessions, each in its own transaction:
       existing = session of this owner with the same id
       none                                   -> insert session, messages, attachments   ("added")
       same content (see below)               -> nothing                                 ("unchanged")
       incoming.updated_at > existing.updated_at
                                              -> replace all session fields, delete and re-insert
                                                 its messages and attachments             ("updated")
       otherwise                              -> keep the existing session               ("kept")
     keep the incoming imported_at, created_at and updated_at; never substitute the current time
  4. bytes, for every session of the document whatever step 3 decided: for each attachment that comes
     with bytes (inline or from the bundle), if the destination session lists that sha256 and no blob
     (owner, sha256) exists yet, verify length and hash and store the blob
  5. report: counts of added, updated, unchanged, kept, blobs stored, plus every warning and repair
```

- "Same content" means: the incoming session, after repair, deep-equals what the exporter would write for the existing session, ignoring `updated_at`, the presence of `data_base64`, and property order.
- Step 4 is separate on purpose: a vault first imported "without originals" gets its PDFs when the same vault is imported again with them, although every session is then "unchanged".
- "kept" with different content and equal timestamps is a conflict. Show it in the report. An optional setting may offer "replace anyway" or "import as a copy" (new ids, title suffix); the default is to keep.
- Owner scoping: look up existing rows with `WHERE owner_id = $owner AND id = $id`. If an insert then fails because the id exists under a *different* owner, give the incoming entity a fresh UUID and remap references inside the document. Never write `INSERT ... ON CONFLICT (id) DO UPDATE` without an owner condition.
- Sessions imported for the first time keep their original `imported_at`, so the default list order is the same in both apps.

### 6.8 Export algorithm

```text
exportDocument(owner, scope, options):
  kind = scope is one session ? "session" : "vault"
  projects = scope vault: all projects of the owner; scope session: its project, if any
  per session: all known fields; then the keys of extra that are not known fields
               messages ordered by position, index = array position
               segments = stored segments, or [{type:"text", text}] when none are stored
               attachments = all descriptors; data_base64 only if options.includeBytes and the bytes exist
  exported_at = now; generator = this app
```

- Projects, sessions and attachments: write every known property, also when it holds its default (`"model": ""`, `"tags": []`, `"project_id": null`, `"attachments": []`, `"filename": ""`). Messages: write `created_at` and `model` only when they are set.
- Known fields always win over a key of the same name in `extra`.
- The output must pass the schema and R1 to R10 without repair; run the validator in a test.
- A vault document can be streamed: write the opening properties and `projects`, then the sessions one at a time inside the `sessions` array, so that the whole vault is never held in memory (web-platform.md asks for a streamed download).

## 7. PostgreSQL design

### 7.1 Field mapping: Swift, JSON, PostgreSQL

Session

| Swift (`ChatSession`) | Interchange JSON (`sessions[]`) | PostgreSQL (`sessions`) | Notes |
|---|---|---|---|
| none (`persistentModelID` is store-local) | `id` | `id uuid` | New. The Apple app must add a stored UUID (section 10). |
| `title: String = "Untitled"` | `title` | `title text` | |
| `providerRaw: String = "Other"` | `provider` | `provider text` | `Claude` <-> `claude`, `ChatGPT` <-> `chatgpt`, `Gemini` <-> `gemini`, `Other` <-> `other`; unknown strings unchanged |
| `modelName: String = ""` | `model` | `model text` | |
| `sourceURL: String = ""` | `source_url` | `source_url text` | |
| `summary: String = ""` | `summary` | `summary text` | |
| `tags: [String] = []` | `tags` | `tags text[]` | ordered |
| `isPinned: Bool = false` | `is_pinned` | `is_pinned boolean` | |
| `createdAt: Date` | `created_at` | `created_at timestamptz(3)` | original date |
| `importedAt: Date` | `imported_at` | `imported_at timestamptz(3)` | |
| none | `updated_at` | `updated_at timestamptz(3)` | new |
| `project: Project?` | `project_id` | `project_id uuid` | |
| `snapshotPDF: Data?` (external storage) | `attachments[]` entry with `kind: "original_pdf"`, `media_type: "application/pdf"` | row in `attachments`, bytes in `blobs` | |
| `messages: [ChatMessage]` (cascade) | `messages[]` | rows in `messages` (`ON DELETE CASCADE`) | |
| `orderedMessages`, `provider` (computed) | none | none | derived |
| none | any unknown property | `extra jsonb` | |
| none | none | `message_count`, `text_bytes`, `search_text` | derived, maintained by the app |

Message

| Swift (`ChatMessage`) | Interchange JSON (`messages[]`) | PostgreSQL (`messages`) | Notes |
|---|---|---|---|
| none | `id` | `id uuid` | new |
| `index: Int = 0` | `index` | `position integer` | renamed in SQL only |
| `roleRaw: String = "unknown"` | `role` | `role text` | identical strings |
| `text: String = ""` | `segments` (one text segment) | `text text`, and `segments jsonb` when the message is not a single plain text segment | `text` always equals `flattenText(segments)` |
| `session: ChatSession?` | containment | `session_id uuid` | |
| none | `created_at` (optional) | `created_at timestamptz(3) NULL` | set for messages written in the app |
| none | `model` (optional) | `model text` | set for replies generated through the app |
| none | any unknown property | `extra jsonb` | |

Project

| Swift (`Project`) | Interchange JSON (`projects[]`) | PostgreSQL (`projects`) | Notes |
|---|---|---|---|
| none | `id` | `id uuid` | new |
| `name: String` | `name` | `name text`, `name_key text` | `name_key` derived (8.4) |
| `createdAt: Date` | `created_at` | `created_at timestamptz(3)` | |
| none | `updated_at` | `updated_at timestamptz(3)` | new |
| `sessions` (nullify) | derived from `sessions[].project_id` | `sessions.project_id ... ON DELETE SET NULL` | |

Attachment (new; today only `snapshotPDF` exists)

| Interchange JSON (`attachments[]`) | PostgreSQL | Notes |
|---|---|---|
| `kind` | `attachments.kind` | |
| `sha256` | `attachments.sha256`, `blobs.sha256` | |
| `media_type` | `attachments.media_type` | |
| `byte_length` | `attachments.byte_length`, `blobs.byte_length` | |
| `filename` | `attachments.filename` | |
| `created_at` | `attachments.created_at` | |
| `data_base64` | `blobs.data` (raw bytes) or `blobs.storage_key` | never stored as base64 |
| any unknown property | `attachments.extra` | |

### 7.2 Schema draft

Draft, not executed (section 1). PostgreSQL 14 or newer.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- only for the two *_trgm indexes below

-- One row per person. Sign-in columns belong to web-platform.md; if that document names
-- this table differently, use its table and keep the owner_id columns below.
CREATE TABLE owners (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (name ~ '\S'),
    name_key    text NOT NULL,                        -- app-computed, see 8.4
    created_at  timestamptz(3) NOT NULL DEFAULT now(),
    updated_at  timestamptz(3) NOT NULL DEFAULT now(),
    extra       jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT projects_owner_name_key UNIQUE (owner_id, name_key)
);

CREATE TABLE sessions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       uuid NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
    project_id     uuid REFERENCES projects (id) ON DELETE SET NULL,   -- app must check same owner
    title          text NOT NULL DEFAULT 'Untitled',
    provider       text NOT NULL DEFAULT 'other' CHECK (provider <> ''),
    model          text NOT NULL DEFAULT '',
    source_url     text NOT NULL DEFAULT '',
    summary        text NOT NULL DEFAULT '',
    tags           text[] NOT NULL DEFAULT '{}',
    is_pinned      boolean NOT NULL DEFAULT false,
    created_at     timestamptz(3) NOT NULL,              -- ORIGINAL date; deliberately no default
    imported_at    timestamptz(3) NOT NULL DEFAULT now(),
    updated_at     timestamptz(3) NOT NULL DEFAULT now(),
    message_count  integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
    text_bytes     integer NOT NULL DEFAULT 0 CHECK (text_bytes >= 0),
    search_text    text NOT NULL DEFAULT '',          -- app-computed, see 8.1
    extra          jsonb NOT NULL DEFAULT '{}'::jsonb
);
COMMENT ON COLUMN sessions.created_at  IS 'Original date of the conversation, user-editable. NOT the row creation time.';
COMMENT ON COLUMN sessions.imported_at IS 'When the session first entered a vault. Never updated. Default list order.';
COMMENT ON COLUMN sessions.updated_at  IS 'Last change to the session or its messages. Set by the application.';

CREATE INDEX sessions_list_idx     ON sessions (owner_id, is_pinned DESC, imported_at DESC, id);
CREATE INDEX sessions_timeline_idx ON sessions (owner_id, created_at DESC, id);
CREATE INDEX sessions_project_idx  ON sessions (owner_id, project_id);
CREATE INDEX sessions_provider_idx ON sessions (owner_id, provider);
CREATE INDEX sessions_tags_idx     ON sessions USING gin (tags);
CREATE INDEX sessions_search_trgm  ON sessions USING gin (search_text gin_trgm_ops);

CREATE TABLE messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
    session_id  uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    position    integer NOT NULL CHECK (position >= 0),   -- "index" in Swift and JSON
    role        text NOT NULL DEFAULT 'unknown' CHECK (role <> ''),
    text        text NOT NULL DEFAULT '',                 -- flattened text; can be megabytes
    segments    jsonb,                                    -- NULL = exactly [{"type":"text","text": text}]
    text_bytes  integer NOT NULL DEFAULT 0 CHECK (text_bytes >= 0),   -- UTF-8 length of text
    model       text NOT NULL DEFAULT '',
    created_at  timestamptz(3),                              -- NULL for imported transcripts
    extra       jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT messages_session_position_key UNIQUE (session_id, position)
);
-- No b-tree, unique or hash index may ever include messages.text (7.4).
-- Optional, see 7.5:
-- CREATE INDEX messages_text_trgm ON messages USING gin (text gin_trgm_ops);

CREATE TABLE attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     uuid NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
    session_id   uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    kind         text NOT NULL DEFAULT 'other' CHECK (kind <> ''),
    sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    media_type   text NOT NULL DEFAULT 'application/octet-stream',
    byte_length  integer NOT NULL CHECK (byte_length >= 0),
    filename     text NOT NULL DEFAULT '',
    created_at   timestamptz(3) NOT NULL DEFAULT now(),
    extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT attachments_session_kind_sha_key UNIQUE (session_id, kind, sha256)
);
CREATE INDEX attachments_owner_sha_idx ON attachments (owner_id, sha256);

-- The bytes, stored once per owner and hash. No foreign key from attachments on purpose:
-- a descriptor may exist while its bytes are missing (6.4).
CREATE TABLE blobs (
    owner_id     uuid NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
    sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    byte_length  integer NOT NULL CHECK (byte_length >= 0),
    data         bytea,              -- the bytes, or NULL when they live in object storage
    storage_key  text,               -- object-storage key when data is NULL
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, sha256),
    CHECK (data IS NOT NULL OR storage_key IS NOT NULL)
);
```

Notes on the draft:

- Design choices that are the author's (inference, not derived from the Apple app): single-column UUID primary keys with owner scoping done in queries; `''` instead of `NULL` for absent strings (mirrors the Swift defaults and removes a three-state problem); `search_text`, `message_count` and `text_bytes` maintained by the application in the same transaction as the change they depend on; `position` as the SQL name for the message index.
- Timestamps that travel in interchange files are `timestamptz(3)`: millisecond precision, so that the database, a JavaScript `Date` and the JSON text hold exactly the same instant. With the default microsecond precision a value written by `now()` would no longer equal itself after a round trip through the browser.
- `segments` is `NULL` for every message that is one plain text segment, which is all data that exists today. When it is not `NULL` it holds the complete segment array including the text, and `text` holds `flattenText(segments)`.
- `updated_at` is set by the application on every change of a session row or of its messages or attachments, and on every project change. Imports write the value from the file. A database trigger would overwrite imported values, so do not use one.
- Where to keep the bytes (`bytea` or object storage) is a hosting decision for web-platform.md. `bytea` keeps everything in one backup and is reasonable for PDFs of a few megabytes; set a hard upload limit (suggestion: 50 MB per object). PDFs are already compressed: `ALTER TABLE blobs ALTER COLUMN data SET STORAGE EXTERNAL;` avoids pointless compression attempts and makes `substring(data FROM x FOR n)` cheap, which is enough to serve HTTP range requests.
- After sessions are deleted, remove unreferenced bytes: `DELETE FROM blobs b WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.owner_id = b.owner_id AND a.sha256 = b.sha256);`
- Optional hardening when more owners exist: row-level security on every table with `owner_id`, and composite foreign keys `(owner_id, project_id)` so that a session cannot reference another owner's project.

### 7.3 Queries that define behaviour

List (3.4), with the tie-break the Apple app lacks:

```sql
SELECT s.id, s.title, s.provider, s.model, left(s.summary, 300) AS summary_preview, s.tags, s.is_pinned,
       s.created_at, s.imported_at, s.updated_at, s.project_id, s.message_count,
       EXISTS (SELECT 1 FROM attachments a JOIN blobs b ON b.owner_id = a.owner_id AND b.sha256 = a.sha256
               WHERE a.session_id = s.id AND a.kind = 'original_pdf') AS has_original
FROM sessions s
WHERE s.owner_id = $1
  -- one of, depending on the active filter:
  --   AND s.is_pinned
  --   AND s.project_id = $2
  --   AND s.provider = $2                                        (claude, chatgpt, gemini)
  --   AND s.provider NOT IN ('claude', 'chatgpt', 'gemini')      (the "Other" filter)
  --   AND s.tags @> ARRAY[$2]::text[]                            (@> uses the GIN index; = ANY does not)
  -- and, when a search is active (8.1):
  --   AND s.search_text LIKE '%' || $3 || '%' ESCAPE '\'
ORDER BY s.is_pinned DESC, s.imported_at DESC, s.id ASC;
```

Timeline: same filters and search, `ORDER BY s.created_at DESC, s.id ASC`, no pinned-first. The browser groups by month in its own time zone (8.5).

Sidebar:

```sql
SELECT count(*) AS all_count, count(*) FILTER (WHERE is_pinned) AS pinned_count
FROM sessions WHERE owner_id = $1;

SELECT p.id, p.name, count(s.id) AS session_count
FROM projects p LEFT JOIN sessions s ON s.project_id = p.id
WHERE p.owner_id = $1 GROUP BY p.id;                 -- sort in the app with 8.4

SELECT t AS tag, count(*) AS session_count
FROM sessions s CROSS JOIN LATERAL unnest(s.tags) AS t
WHERE s.owner_id = $1 GROUP BY t ORDER BY t COLLATE "C";   -- code-point order, as the Apple app
```

Transcript of one session, never `SELECT *` from a list:

```sql
SELECT id, position, role, text, segments, model, created_at
FROM messages WHERE owner_id = $1 AND session_id = $2 ORDER BY position;
```

Appending a message (continue chat) so that two devices cannot produce the same position:

```sql
BEGIN;
SELECT 1 FROM sessions WHERE id = $1 AND owner_id = $2 FOR UPDATE;      -- one appender per session at a time
INSERT INTO messages (id, owner_id, session_id, position, role, text, text_bytes, model, created_at)
VALUES ($3, $2, $1,
        (SELECT COALESCE(MAX(position), -1) + 1 FROM messages WHERE session_id = $1),
        $4, $5, $6, $7, now())
RETURNING position;
UPDATE sessions SET message_count = message_count + 1, text_bytes = text_bytes + $6, updated_at = now()
WHERE id = $1 AND owner_id = $2;
COMMIT;
```

Consistency check for tests (must return no rows):

```sql
SELECT s.id FROM sessions s
LEFT JOIN (SELECT session_id, count(*) AS c, COALESCE(sum(text_bytes), 0) AS b FROM messages GROUP BY session_id) m
       ON m.session_id = s.id
WHERE s.message_count <> COALESCE(m.c, 0) OR s.text_bytes <> COALESCE(m.b, 0);
```

Driver note: node-postgres returns `bigint` (for example `count(*)`) as a string. Cast counts to `integer` in SQL or convert in code.

### 7.4 Large message bodies

Real captures have produced single messages of about 1,000,000 characters (a whole shared page stored as one message). In UTF-8 that is 1 MB for ASCII and up to 4 MB otherwise. Consequences (PostgreSQL facts from its documentation, not executed here):

| Topic | What happens | Rule |
|---|---|---|
| Row size | A value above roughly 2 kB is compressed and moved out of the row into the table's TOAST storage in chunks of about 2 kB. The row keeps an 18-byte pointer. The field limit is 1 GB. | Store the body in `messages.text`. No separate table and no chunking are needed for storage. |
| Reading | Selecting the column fetches and decompresses the whole value. Not selecting it costs nothing. | Never `SELECT *` on `messages`, never include `text` in list queries. ORMs select all columns by default: name the columns. Use `text_bytes` to decide before loading. |
| Updating | An update that does not change `text` does not rewrite the TOAST data. | Metadata edits stay cheap. Messages are immutable anyway. |
| B-tree, unique, hash indexes | A b-tree entry is limited to about 2,700 bytes; larger values fail the insert with `index row size ... exceeds btree version 4 maximum 2704`. Small values pass and large ones fail, so the error appears late. | Never put `text` in a b-tree or unique index. To detect identical bodies store a hash column. |
| `tsvector` | A `tsvector` is limited to 1 MB (`string is too long for tsvector`), keeps at most 256 positions per word and no position above 16,383. | Never define a generated `tsvector` column over `text`: one huge message would make the insert fail. See 7.5. |
| Trigram GIN index | No per-value limit. Size is in the order of the text for short messages and much less for very long ones (estimate). | Acceptable; optional (7.5). |
| `jsonb` | A string inside `jsonb` is limited to about 255 MB; any update rewrites the whole value. | Fine for `segments` of the rare non-plain message. Do not keep bodies only in `jsonb`. |
| Compression | Default `pglz`; `lz4` is faster where the server supports it: `ALTER TABLE messages ALTER COLUMN text SET COMPRESSION lz4;` | Optional. |
| HTTP and JSON | One message can be a 1 to 4 MB JSON string; a session can be much more. Express's JSON body parser defaults to 100 kB. Some serverless database drivers cap request size. | Raise body limits for import routes or upload as a file; insert large sessions in batches inside one transaction; page transcripts by bytes (for example stop a page when the sum of `text_bytes` passes 1 MB). Limits and routes: web-platform.md. |
| Browser | Rendering 1,000,000 characters as one text node, or re-parsing Markdown on every keystroke, freezes the page. | Chunked or virtualised rendering: design.md. |
| Claude API | Such a session is hundreds of thousands of tokens. | Token budgeting and warnings: claude-api.md. `text_bytes / 4` is a rough token estimate. |

### 7.5 Search in PostgreSQL

Parity search (title, summary, tags): section 8.1 defines `search_text` and the needle; the SQL is the `LIKE` line in 7.3. Notes:

- Lower-casing and Unicode normalisation happen in TypeScript, never with SQL `lower()` or `ILIKE`: their handling of non-ASCII letters depends on the database's locale settings, and a database created with the `C` locale folds ASCII only.
- `LIKE` on a pre-lower-cased column with the `gin_trgm_ops` index gives substring semantics, which is what the Apple app has. For a vault of a few thousand sessions the index is not even needed; it is there for growth. If the hosting platform does not offer `pg_trgm`, drop the two trigram indexes; results stay correct.
- Escape the needle for `LIKE`: prefix `\`, `%` and `_` with `\`.
- Do not build `search_text` in SQL as a generated column or index expression: `array_to_string` is not immutable, so the definition is rejected, and `lower()` has the locale problem above. Compute the column in the application.

Transcript search (new; the Apple app cannot search message text; owner decision, section 12):

```sql
SELECT m.session_id, m.id AS message_id, m.position,
       substr(m.text, greatest(1, strpos(lower(m.text), lower($2)) - 60), 200) AS snippet
FROM messages m
WHERE m.owner_id = $1 AND m.text ILIKE '%' || $3 || '%' ESCAPE '\'     -- $2 raw needle, $3 LIKE-escaped needle
ORDER BY m.session_id, m.position
LIMIT 200;
```

- Without an index this reads every message body of the owner. Estimate: about a second per 100 MB of text. Run it on submit, not on every keystroke, and start without an index.
- Add `messages_text_trgm` when the vault's text grows beyond roughly 100 MB and the plan has the disk space. The index supports `ILIKE`. With more than one owner, add the `btree_gin` extension and index `(owner_id, text gin_trgm_ops)`.
- `ILIKE` here inherits the locale caveat above; for ASCII it is always case-insensitive.
- Word-based full-text search (`tsvector`, `websearch_to_tsquery`) is an alternative with ranking, but it matches whole words, not substrings, so `cycle` would no longer find `bicycle`, and code identifiers split unpredictably. If it is ever added: fill a plain `tsvector` column from the application with `to_tsvector('simple', left(text, 100000))` or per chunk, and catch the size error.

### 7.6 Where values from the other documents are stored

App-specific values that are not part of the interchange standard go into the `extra` column of the row they describe, under a key that starts with `x_`. They then travel in interchange files as an extension property of that object and are kept by any reader (6.5). No new columns are needed. If a value must later be filtered or sorted in SQL, promote it to a column in a migration.

| Value | Defined in | Stored at | In an interchange file |
|---|---|---|---|
| Capture metadata: method, requested URL, strategy id, selectors version, extractor version, partial flag, warnings, capture time | capture.md 7.3 | `sessions.extra`, key `x_capture`, one object; property names in `snake_case` (`method`, `requested_url`, `strategy_id`, `selectors_version`, `extractor_version`, `partial`, `warnings`, `captured_at`) | session property `x_capture` (the example file's session 5 has one) |
| Details about a page snapshot (for example whether the page scrolled as a whole) | capture.md | `attachments.extra`, key `x_capture` | attachment property `x_capture` |
| Marker of an incomplete assistant reply | claude-api.md C5 | `messages.extra`, key `x_claude`. That document writes the key as `claude`; use `x_claude` so that the rule above holds. | message property `x_claude` |

`sessions.source_url` stays the one link shown to the user. capture.md decides which URL that is on the web (the requested or the final one); the other one belongs in `x_capture`.

## 8. Shared pure functions (TypeScript)

These belong in the pure module (no DOM, no Node) so that browser, server and tests share them. The function bodies were executed in JavaScriptCore and reproduced the Swift results (section 1); they have not been through a TypeScript compiler.

### 8.1 Search

```ts
export function normalizeForSearch(s: string): string {
  return s.normalize("NFC").toLowerCase();
}
/** Value of sessions.search_text. Recompute whenever title, summary or tags change. */
export function buildSearchText(s: { title: string; summary: string; tags: string[] }): string {
  return [s.title, s.summary, ...s.tags].map(normalizeForSearch).join("\n");
}
/** "" means: no search. */
export function prepareQuery(raw: string): string {
  return normalizeForSearch(raw.replace(/[\r\n]+/g, " ").trim());
}
export function matchesSearch(searchText: string, preparedQuery: string): boolean {
  return preparedQuery === "" || searchText.includes(preparedQuery);
}
```

- This is the Apple behaviour of 3.6 with one change: the query is trimmed (B4). Fields are joined with `"\n"`, which a single-line query cannot contain, so a match cannot span two fields.
- Known tiny differences from Swift, acceptable: Swift compares whole characters, so a base letter followed by a combining mark that has no composed form does not match the bare letter, while `includes` after NFC does; JavaScript's `toLowerCase()` writes a final Greek sigma as `\u03C2` where Swift's `lowercased()` writes `\u03C3` (both sides verified).
- Not part of parity, owner decision: ignoring diacritics, and treating several words as "all must match".

### 8.2 Tags

```ts
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const part of input.split(",")) {
    const tag = part.trim().toLowerCase().replace(/^#+/, "").trim();
    if (tag !== "" && !out.includes(tag)) out.push(tag);
  }
  return out;
}
```

Same as the Apple parser of 3.2 plus two deliberate changes (B3): the leading `#` is removed and duplicates are dropped. Display the tag field as `tags.join(", ")`. The tag list for the sidebar is the distinct tags in code-point order.

### 8.3 Context pack

```ts
const PROVIDER_LABEL = new Map([["claude", "Claude"], ["chatgpt", "ChatGPT"], ["gemini", "Gemini"], ["other", "Other"]]);
const ROLE_LABEL = new Map([["user", "User"], ["assistant", "Assistant"], ["system", "System"], ["unknown", "Note"]]);

export function contextPackMarkdown(
  session: { title: string; provider: string; model: string; source_url: string; summary: string;
             tags: string[]; created_at: Date },
  messages: { role: string; text: string }[],          // ordered by position; text is the flattened text
  options: { timeZone: string },                       // IANA zone of the viewer
): string {
  const saved = new Intl.DateTimeFormat("en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: options.timeZone }).format(session.created_at);
  const lines: string[] = [`# Context pack: ${session.title}`, ""];
  let origin = `Origin: ${PROVIDER_LABEL.get(session.provider.trim().toLowerCase()) ?? "Other"}`;
  if (session.model !== "") origin += ` (${session.model})`;
  lines.push(`${origin}, saved ${saved}`);
  if (session.source_url !== "") lines.push(`Source: ${session.source_url}`);
  if (session.tags.length > 0) lines.push(`Tags: ${session.tags.join(", ")}`);
  lines.push("");
  if (session.summary !== "") lines.push("## Summary", "", session.summary, "");
  lines.push(
    "You are being given the transcript of an earlier conversation the user had",
    "with another AI assistant. Read it, treat its decisions and facts as established",
    "context, and continue helping from where it left off.",
    "", "## Transcript", "");
  for (const m of messages) lines.push(`**${ROLE_LABEL.get(m.role) ?? "Note"}:**`, "", m.text, "", "---", "");
  return lines.join("\n");
}
```

- With `timeZone: "UTC"` and the example file this must reproduce the four packs of 9.3 byte for byte. `Mar 14, 2026` is the `en_US` output of the Apple app; fixing the locale is the deliberate change B6.
- Maps are used instead of object lookups so that a role named `constructor` in a foreign file cannot hit a built-in property.
- No truncation. The web app may warn about size before copying (use `text_bytes`), but must not shorten silently.
- Copy: clipboard as plain text. Share: as a file `context-pack.md` when the browser can share files, as text only for small packs. Always offer a download. Details: web-platform.md.

### 8.4 Project names

```ts
export function projectNameKey(name: string): string {      // value of projects.name_key
  return name.trim().normalize("NFC").toLowerCase();
}
/** locale: the viewer's locale in the browser; "en" in tests. */
export function projectComparator(locale: string) {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return (a: { name: string; id: string }, b: { name: string; id: string }): number =>
    collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1);
}
```

Create and rename: trim; refuse an empty name; refuse a name whose key already exists for this owner (tell the user). Import: 6.7 step 2 merges by key. Sort the project list in the browser, not in SQL.

### 8.5 Timeline

```ts
export function timelineGroups<T extends { id: string; created_at: Date }>(sessions: T[], locale: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone });
  const sorted = [...sessions].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? -1 : 1));
  const groups: { key: string; sessions: T[] }[] = [];
  for (const s of sorted) {
    const key = fmt.format(s.created_at);                 // "November 2026" in en-US
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.sessions.push(s); else groups.push({ key, sessions: [s] });
  }
  return groups;
}
```

Header count: `1 session`, otherwise `N sessions`. Editing the original date with a date-only control: keep the stored time of day in the viewer's time zone and replace the calendar date (inference about the Apple control, 2.5).

### 8.6 Creating a session from a parser result

Equivalent of `SessionImporter.insert` (`apple/SessionVault/Importers.swift:435-452`). Input is what import-rules.md calls a parsed session: `title`, `provider`, `sourceURL`, optional `createdAt`, and `messages` of `{ role, text }`.

```text
now = current time (for a batch of n items: B7)
session: id = new UUID; title, provider, source_url from the parser; model = ""; summary = ""; tags = [];
         is_pinned = false; project_id = null;
         created_at = parsed.createdAt ?? now; imported_at = now; updated_at = now
messages: for i, m in parsed.messages: id = new UUID; position = i; role = m.role; text = m.text;
          segments = NULL; text_bytes = UTF-8 length of m.text; created_at = NULL; model = ""
session.message_count = n; session.text_bytes = sum; session.search_text = buildSearchText(session)
link capture only: one attachment kind "original_pdf" if a PDF was produced
all in one transaction
```

## 9. Test vectors

All values below come from `example-vault-export.json` and were produced by the Apple app's real code (the list logic of `SessionListView.swift:13-55` copied verbatim, `ContextPack.markdown` unchanged), then reproduced by an independent implementation of sections 6 and 8. `#1` to `#6` are the sessions in file order.

### 9.1 The example file

| # | Title | Provider | Pinned | Project | Tags | `created_at` | `imported_at` | Messages | `text_bytes` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Truing a bicycle wheel | chatgpt | no | Bike workshop | bikes, repair | 2026-03-14T09:30:00.000Z | 2026-03-15T18:02:11.482Z | 4 | 166 |
| 2 | Tomato blight on the balcony | gemini | yes | Garden | garden | 2026-08-02T16:45:00.000Z | 2026-08-02T16:45:03.250Z | 1 | 162 |
| 3 | Sourdough starter schedule | claude | no | none | baking, bread | 2026-10-10T08:00:00.000Z | 2026-10-10T08:00:00.000Z | 4 | 283 |
| 4 | Untitled | other | no | none | none | 2026-01-05T12:00:00.000Z | 2026-01-05T12:00:00.000Z | 0 | 0 |
| 5 | Seed order comparison | examplebot (unknown) | no | Garden | garden, shopping | 2026-10-31T23:30:00.000Z | 2026-11-01T10:00:00.000Z | 3 | 111 |
| 6 | Caf\u00E9 menu translation | claude | no | none | travel, two words | 2025-12-31T23:59:59.000Z | 2026-11-01T10:00:00.000Z | 2 | 59 |

What the file exercises on purpose:

- an unknown provider (`examplebot`), an unknown role (`tool` in #5) and an unknown segment type (`x_table` in #5);
- unknown properties at six levels: document `x_note`, project `x_color`, session `x_capture`, attachment `x_pages`, message `x_rating`, and the `x_table` segment's own properties;
- an inline PDF (#2, 616 bytes, one page, opens in PDFKit), a PDF descriptor without bytes (#5), an inline 2 x 2 PNG referenced from a message (#3);
- a message with the segments text, attachment, text (#3, index 2): its flattened text is `"Here is a photo of the jar after six hours.\n\nIs it ready?"`, 57 bytes;
- a session with no messages (#4); a project with no sessions (`apple pie ideas`);
- two sessions with the same `imported_at` (#5 and #6); two sessions at a month and year boundary (#5 and #6);
- a non-ASCII title (#6, U+00E9): its messages are 58 UTF-16 code units but 59 UTF-8 bytes.

### 9.2 Lists, filters, search, timeline

| Check | Expected |
|---|---|
| All Sessions | #2 #5 #6 #3 #1 #4 (#5 before #6 by the id tie-break; the Apple app leaves that pair undefined) |
| Pinned | #2 |
| Provider Claude / ChatGPT / Gemini / Other | #6 #3 / #1 / #2 / #5 #4 |
| Project Bike workshop / Garden / apple pie ideas | #1 / #2 #5 / none |
| Tag list | baking, bikes, bread, garden, repair, shopping, travel, two words |
| Tag `garden` | #2 #5 |
| Project order, Apple today (code points) | Bike workshop, Garden, apple pie ideas |
| Project order, web (8.4) | apple pie ideas, Bike workshop, Garden |
| Row label counts | 4, 1, 4, 0, 3, 2 |
| `search_text` of #2 | `"tomato blight on the balcony\n\ngarden"` |
| `search_text` of #6 | `"caf\u00E9 menu translation\nmenu terms for a bicycle caf\u00E9.\ntravel\ntwo words"` |

Search within All Sessions:

| Query | Apple today | Web (query trimmed) |
|---|---|---|
| `bicycle` | #6 #1 | same |
| `BREAD` | #3 | same |
| `cafe` | none | none |
| `caf\u00E9`, `CAF\u00C9`, `cafe\u0301` | #6 | same |
| `garden` | #2 #5 | same |
| `wo wo` | #6 | same |
| `quarter` | #1 (summary) | same |
| `spoke` | none (only in a message) | none |
| `claude`, `example` | none (provider, model and URL are not searched) | none |
| `untitled` | #4 | same |
| one space | #2 #5 #6 #3 #1 | all six (empty query) |
| `" garden "` | none | #2 #5 |
| `garden` while the Pinned filter is active | #2 | same |

Timeline (`en-US` month names):

| Time zone | Groups in order |
|---|---|
| UTC | October 2026 (2 sessions: #5 #3), August 2026 (1 session: #2), March 2026 (1 session: #1), January 2026 (1 session: #4), December 2025 (1 session: #6) |
| Europe/Berlin | November 2026 (1 session: #5), October 2026 (1 session: #3), August 2026 (1 session: #2), March 2026 (1 session: #1), January 2026 (2 sessions: #4 #6) |

### 9.3 Context packs

`contextPackMarkdown` with `timeZone: "UTC"` must return exactly these bytes. Each pack ends with one line feed after its last line.

| Session | UTF-8 bytes | SHA-256 |
|---|---|---|
| #1 | 704 | `9e619a00239c79842a8ed1ea12203cf0b8cbaf8e4d1939d9034f8ac7d665b4a0` |
| #3 | 776 | `3940de97f9cb42468d1beded41c6992c10953f570b6ec7fe120934784de04e8a` |
| #4 | 285 | `63880d59e0e74ba1952b1b3e2dd0c9a33ffecaa4bd94ce398969453650b0daef` |
| #5 | 507 | `cdc4e104c6dcaf5f7b4c82f1da437557640a1a57df5bcd2f7e5f1d443f98684c` |

Pack #1 (every optional part present, all four role labels):

~~~~text
# Context pack: Truing a bicycle wheel

Origin: ChatGPT (example-model-1), saved Mar 14, 2026
Source: https://chat.example/share/EXAMPLE-0001
Tags: bikes, repair

## Summary

Wheel wobble fixed by quarter turns.
Second summary line.

You are being given the transcript of an earlier conversation the user had
with another AI assistant. Read it, treat its decisions and facts as established
context, and continue helping from where it left off.

## Transcript

**User:**

My rear wheel wobbles. How do I true it?

---

**Assistant:**

Tighten the spoke on the side you want the rim to move toward.

```sh
echo quarter-turn
```

---

**System:**

System text.

---

**Note:**

A note with no speaker.

---
~~~~

Pack #4 (nothing optional, no messages; the last line is `## Transcript`):

~~~~text
# Context pack: Untitled

Origin: Other, saved Jan 5, 2026

You are being given the transcript of an earlier conversation the user had
with another AI assistant. Read it, treat its decisions and facts as established
context, and continue helping from where it left off.

## Transcript
~~~~

Pack #5 (unknown provider prints `Other`, unknown role prints `Note`, the unknown segment is left out):

~~~~text
# Context pack: Seed order comparison

Origin: Other (examplebot-2), saved Oct 31, 2026
Tags: garden, shopping

You are being given the transcript of an earlier conversation the user had
with another AI assistant. Read it, treat its decisions and facts as established
context, and continue helping from where it left off.

## Transcript

**User:**

Compare carrot and beet seed prices for a 2 m bed.

---

**Note:**

lookup: seed catalogue, 2 results

---

**Assistant:**

Carrots are cheaper per row.

---
~~~~

In pack #3 the third turn is `Here is a photo of the jar after six hours.`, an empty line, `Is it ready?` (two text segments joined by the flattening rule).

### 9.4 Round-trip tests the builder should add

1. Import the example, export the vault, compare with the example after sorting arrays by id and ignoring `exported_at`, `generator` and the document-level `x_note`: equal, including every other `x_` property, the `tool` role, the `examplebot` provider, the `x_table` segment and the PDF descriptor without bytes.
2. Import the example twice: the second run reports 6 unchanged and creates nothing.
3. Change one title and `updated_at` to a later time in a copy, import: 1 updated. Import the original again: 1 kept.
4. Mutate the example in each way listed in 6.6 (R1 to R10) and check that validation fails; apply the repair list to an upper-case-id, CR LF, unsorted copy and check that it then validates.
5. Insert a synthetic message of 1,000,000 characters and one of 4,000,000 bytes: insert succeeds, the list query does not slow down, export and import work.

Tests 1 to 4 are known to be satisfiable: a compact reference implementation of 6.6 to 6.8 over in-memory tables shaped like 7.2 was run in JavaScriptCore. It passed tests 1 to 3 and the repair half of test 4 (the rejection half was run with the validator described below), plus: bytes filled in by a later import, project merge by name, a dangling `project_id`, a `__proto__` property, corrupt inline bytes, and a version 2 file. Its export validated against the schema. Test 5 needs a real database and was not run. The reference implementation is not part of the repository; the builder writes the real one.

How the two JSON files were checked: with a Python script written for this handoff (standard library only: the draft-07 keywords the schema uses, plus R1 to R12). It is not part of the repository. It accepted the example, rejected 69 deliberately broken variants (at least one per rule R1 to R10 and for nearly every schema constraint), and accepted two valid variants (a derived single-session document, and a document with extra unknown properties and unknown provider, role and segment type).

Not done: the schema has not been run through Ajv or any other JSON Schema library (none was available). Checked instead: every `pattern` in it compiles as a Unicode-mode ECMAScript regular expression (`new RegExp(p, "u")`, which is how Ajv compiles patterns) and accepts and rejects the intended sample values. The schema uses only draft-07 keywords: `type`, `const`, `enum`, `required`, `properties`, `additionalProperties`, `items`, `minItems`, `maxItems`, `uniqueItems`, `minLength`, `minimum`, `pattern`, `anyOf`, `allOf`, `if`/`then`, `$ref` to `#/definitions/...`, and the annotation `contentEncoding`. No validation keyword sits next to a `$ref`. If a library's strict mode objects to something, relax the mode; do not change what the schema accepts.

## 10. Note for a later task: what the Apple app has to add

This section is not for the web builder.

Verified facts that shape the work:

- Adding `var uuid: UUID = UUID()` to an existing model gives **every existing row the same UUID** after SwiftData's automatic migration (experiment: 3 rows, 1 distinct value; rows created later were distinct). Add `var uuid: UUID?` instead, fill missing values in a one-time pass at launch or before export, and let the exporter refuse to run if two objects share a UUID.
- `providerRaw` and `roleRaw` are matched case-sensitively: the importer must map `claude` to `Claude` and so on, and may store unknown strings unchanged (they then read as Other / Note).
- `UUID.uuidString` is upper-case: lower-case on export; `UUID(uuidString:)` accepts both.
- Dates: `JSONEncoder` with `.iso8601` writes whole seconds without a fraction. On macOS 27 the `.iso8601` decoding strategy and `Date.ISO8601FormatStyle(includingFractionalSeconds: true)` accepted both forms, while `ISO8601DateFormatter` with `.withFractionalSeconds` rejected strings without a fraction. Behaviour on the minimum targets (macOS 14, iOS 17) was not verified: use an explicit parser that tries both.
- A Swift `Date` is finer than a millisecond; interchange timestamps are milliseconds. Compare timestamps at millisecond precision, otherwise a session that comes back unchanged looks older than the stored copy.
- Do not use `.convertFromSnakeCase`: it would look for `sourceUrl`, not `sourceURL`. Use explicit coding keys or `JSONSerialization` dictionaries. Dictionaries also make it easy to keep unknown properties.
- Today's importer turns an interchange file into one junk session (4.2). The format check must run before the ChatGPT branch in `SessionImporter.parse(data:filename:)` (`apple/SessionVault/Importers.swift:24-33`).
- There is no "last changed" time. Without one, 6.7 cannot tell which copy is newer: an exporter that writes the export time as `updated_at` would overwrite newer web edits, and one that writes `importedAt` would never deliver Apple edits. `updatedAt` must be stored and stamped on every edit.

| File | Change | Rough size |
|---|---|---|
| `apple/SessionVault/Models.swift` | `uuid: UUID?` on all three models; `updatedAt: Date?` on session and project; `extraJSON: Data?` on all three (unknown properties); optionally `createdAt`/`modelName` on messages; the one-time id pass | 40 lines |
| `apple/SessionVault/Interchange.swift` (new) | Build and read the document with `JSONSerialization`; provider and role mapping; tolerant date parsing; lower-case ids; SHA-256 with CryptoKit; inline base64 for `snapshotPDF`; the repair list; merge by id per 6.7; `flattenText` | 350 to 450 lines |
| `apple/SessionVault/Importers.swift` | Detect `"format": "sessionvault-interchange"` first and hand over to the interchange importer | 15 lines |
| `apple/SessionVault/Views/RootView.swift` | "Export Vault..." (file exporter), import result message | 40 lines |
| `apple/SessionVault/Views/SessionDetailView.swift` | "Export Session (JSON)"; stamp `updatedAt` on edits | 30 lines |
| `apple/SessionVault/Views/ContinueChatView.swift`, `SessionListView.swift` | stamp `updatedAt` on append, pin, project change | 10 lines |
| tests (no test target exists today) | round trip of `example-vault-export.json`, the packs of 9.3 | new target |

Total about 500 to 600 lines (estimate). Limits to accept at first: only the inline and omitted forms of 6.4 (Foundation has no ZIP reader); attachments other than `original_pdf` and unknown segments can only be preserved if they are parked in `extraJSON`; a whole-vault export with inline PDFs is built in memory, so offer "without originals" on the iPhone.

## 11. Alternatives

### 11.1 If instead the vault lives only in the browser (IndexedDB)

Sections 6, 8 and 9 stay unchanged. Section 7 is replaced by one IndexedDB database, for example `sessionvault`, version 1. There is no `owner_id`.

| Object store | Key path | Indexes | Holds |
|---|---|---|---|
| `projects` | `id` | `name_key` (unique) | project fields, `extra` |
| `sessions` | `id` | `imported_at_ms`, `created_at_ms`, `project_id`, `provider`, `tags` (multiEntry) | all session fields except messages; `message_count`, `text_bytes`, `search_text` |
| `messages` | `id` | `session_position` on `[session_id, position]` (unique) | `role`, `text`, `segments`, `model`, `created_at`, `extra` |
| `attachments` | `[session_id, kind, sha256]` | `sha256` | descriptor fields |
| `blobs` | `sha256` | none | `byte_length`, `media_type`, `bytes` (a `Blob`) |
| `meta` | `key` | none | schema version, last export time |

- Keep message text out of the `sessions` store so that listing never loads transcripts. Read one session's messages with a key range on `[session_id, 0]` to `[session_id, Infinity]`.
- Index timestamps as numbers (milliseconds since the epoch), not as strings: strings with different fraction lengths do not sort correctly. Booleans and `null` are not valid index keys: filter `is_pinned` in memory, and a session without a project simply does not appear in the `project_id` index.
- A few thousand session records fit in memory: load them once and apply section 8 in memory, as the Apple app does. Transcript search is a cursor scan; run it in a worker.
- No foreign keys: delete a session, its messages and its attachments in one read-write transaction over all stores, then remove unreferenced blobs.
- The data then exists in one browser profile on one device and can be evicted by the browser. Ask for persistent storage, show the storage estimate, and make "Export vault" prominent with a reminder, because the interchange file is the only backup. Quotas and eviction rules: web-platform.md.
- "Same sessions on every device" is lost; moving between devices is export and import.

### 11.2 If instead the API key is kept in the browser

No table changes. The key is browser-local state, never a column and never part of an interchange file. The `model` fields are unaffected.

### 11.3 If instead a different stack is chosen

The interchange format, the rules of section 6, the functions of section 8 (as specifications) and the vectors of section 9 are independent of TypeScript and PostgreSQL. In another SQL database, re-check 7.4 and 7.5; they are PostgreSQL-specific.

### 11.4 If message text is encrypted in the server

web-platform.md 11.6 offers, as an option, encrypting message text in the application before it reaches the database. If the owner chooses it:

- `messages.text`, and the text inside `messages.segments`, hold ciphertext. Title, summary, tags and `search_text` stay plain, so the parity search of 7.5 is unchanged.
- SQL cannot search message text: drop the optional `messages_text_trgm` index and run transcript search by decrypting and scanning in the application.
- `text_bytes` remains the UTF-8 length of the plain text; compute it before encrypting.
- Ciphertext does not compress: compress before encrypting if size matters, and the TOAST compression notes of 7.4 no longer help.
- Interchange files are plain text by definition. Export decrypts and import encrypts; an export is then the most sensitive artefact the app can produce.
- Sections 6, 8 and 9 are unchanged.

## 12. Decisions for the owner

1. Should search also look inside message text? Today it does not. Recommendation: yes, as an explicit "also search transcripts" option.
2. When the same session was changed in both apps, which copy wins on import? Proposed default: the later `updated_at`; equal times keep the existing copy and report a conflict.
3. Is it acceptable that projects with the same name (ignoring case) become one project when vaults are merged?
4. Should deleting ask for confirmation or go to a trash? The Apple app deletes at once.
5. Should the web app keep and show PDF originals that came from the Apple app (binary storage on the server), and should exports include them by default?
6. Should "Continue with Claude" keep replacing the session's model label, or only fill it when empty (recommended)?
7. Are diacritic-insensitive search (`cafe` finds `Caf\u00E9`) and multi-word "all words" search wanted? Both would differ from the Apple app.
8. Which app is the main copy? Version 1 offers manual export and import with merge, not live synchronisation; deletions do not travel.
