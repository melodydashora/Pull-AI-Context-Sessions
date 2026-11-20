# SessionVault design handoff: screens, interaction and visual design

> **Status (revised 2026-11-20).** Extracted from the Apple app's source, then revised on 2026-11-20 for the decisions in `../HANDOFF.md` section 2: a product for many users, each with an account and a private vault; each user's own Anthropic API key, stored encrypted on the server and never sent back to the browser; an online vault plus an offline copy on each device, whose offline changes are queued and sent later. Parts 1 to 3 (the Apple app, its defects, what a web app must do differently) are as first published, apart from the per-message Copy button that the Apple app gained in commit `e81828a`, corrected line references, and the rows that spoke of one owner or one server key. In part 4 the tokens, layout rules, wireframes, components and rendering rules stand; the screens and rules that the decisions add are in section 4.15 and the open questions in 4.16; text that 4.15 replaces is marked "Superseded". Nothing in part 4 has been built or run in a browser.

## Summary

- This document describes every screen of the Apple app (SwiftUI, macOS and iOS) as the code shows it, and then specifies the same product as a responsive web app: tokens, components, layout rules, wireframes, interaction, accessibility and an icon mapping.
- The Apple app is a three-column split view (library, session list, session detail) with four sheets (import, capture browser, continue with Claude, original PDF) and three alerts. It has no settings screen, no accounts and no custom colours: everything uses SwiftUI semantic styles and the default system accent.
- Since commit `e81828a` every message bubble of the Apple app has a Copy button that copies the whole message as stored; before, only code blocks had one (section 1.10.1).
- The web app keeps the structure and the wording. At phone widths (below 600 px) the three columns become a stack of three routes; from 600 px there are two panes, from 1024 px three.
- Four things cannot be carried over and are redesigned: the in-app capture browser (a web page cannot embed and read another site, so the link section offers "open, copy, paste" and, where the server supports it, a server-side capture), the Keychain key-entry screen (each user types their own Anthropic API key into a key screen; the server stores it encrypted and never sends it back), the PDF sheet (the original opens in a new browser tab; not in the first release) and system alerts, sheets and share sheets (accessible dialogs, the Web Share API and downloads).
- Do not copy the Apple colours as text colours: measured on the screenshots, provider chip text has a contrast of 1.95:1 to 3.30:1 and secondary text 3.4:1. Section 4.2 gives tokens whose pairs were all checked against WCAG AA.
- Sessions can be very long (hundreds of turns, and single messages of several hundred thousand characters). The Apple app renders everything eagerly. Sections 4.7.4 and 4.7.5 say how to render giant messages and where windowing is required.
- Transcripts are untrusted text. The renderer must build elements, never HTML strings, and must filter link schemes (section 4.7.3). Appendix 5.4 has a tested reference implementation of the text rules.
- Web-only additions are specified in sections 4.11 and 4.15. Section 4.15 was added on 2026-11-20 and holds what the decided product needs: sign-in and sign-out, invitation entry, settings with export and account deletion, the Claude key screen, the model chooser, copying a whole message, the offline state, the import review and link capture from the server. Where 4.15 and an earlier section differ, 4.15 wins.
- Users: the web app is a product for many people. Everyone signs in to an account of their own and sees only their own vault; sign-up is by invitation at first. No screen, count, search result or message shows anything of another user (4.15.1).
- Key custody: each user enters their own Anthropic API key. It is sent once to the server, stored there encrypted, used only for that user's requests and never sent back. The interface shows whether a key is saved, its last four characters and its status, never the key (4.15.5). The browser never calls Anthropic.
- Offline copy: the online vault is the source of truth. Each device keeps a copy for reading, importing and editing without a connection; changes made offline are queued, shown as waiting and sent later; where the server settles a conflict against the user's change, a notice says so (4.15.8, sync.md).
- How it is used: free-form questions to a model of the user's choosing, with the answer taken elsewhere. The chat has no preset questions and no templates; the model chooser offers the server's list plus a field for any other model id; every message and every reply has a copy-whole-message action at every width and with the keyboard, and code blocks keep their own (4.15.6, 4.15.7). Summarize stays one explicit action.

## How to read this document

- Part 1 (A) is what the Apple app does today. Part 2 (B) lists defects and accidents of the Apple implementation that the web app should not copy. Part 3 (C) lists what must differ because it is a web app. Part 4 is the design handoff. Its section 4.15 was added on 2026-11-20 for the decided product; text that it replaces is marked "Superseded" and kept, so that references to those sections still resolve.
- Citations are `path:line` relative to the repository root. Inside a subsection that names its file, a bare `:123` means a line in that file; directly after a named file (`RootView.swift:86-100, :135`) it means a line in that same file. A file name without a folder is in apple/SessionVault/Views/, except Models.swift, ClaudeAPI.swift, ContextPack.swift, Importers.swift, WebCapture.swift and SessionVaultApp.swift, which are in apple/SessionVault/.
- In part 1 a statement is something the cited code or screenshot shows, unless it is tagged "(inference)". Inferences are mostly about how SwiftUI renders a construct on a platform for which the repository has no screenshot. Parts 2 to 4 are recommendations; facts in them that I could not check are tagged "(unverified)".
- UI strings are quoted exactly. Three non-ASCII characters are part of many strings and must be kept: the ellipsis `…` (U+2026), the em dash `—` (U+2014) and the middle dot `·` (U+00B7). The wireframes abbreviate them as `...`, `-` and `.`; the string tables are authoritative.
- `<n>`, `<title>` and similar are placeholders. All example content (titles, links, ids) is synthetic.
- Other handoff documents: data-model.md (fields, shared functions, interchange format), import-rules.md (parsers), capture.md (link capture), claude-api.md (Continue and Summarize), web-platform.md (hosting, sign-in, installable app, security), sync.md (the offline copy on each device, the queue of changes made offline, conflicts). Where this document touches their subject it describes only the interface and defers to them; section numbers of those documents are quoted as they stood when this one was finished. Section 4.15 quotes data-model.md, sync.md, claude-api.md, web-platform.md and capture.md as revised on 2026-11-20, and import-rules.md as published in commit `e81828a` (appendix 5.5).
- Evidence I produced is described in the appendix (section 5): colour samples from the three screenshots, contrast computations, and a run of the app's own message-splitting code.
- Words: "the owner" is the person who owns this product (`../HANDOFF.md`). A "user" is anyone with an account. A "device" is one browser profile or one installed copy of the app (sync.md 1).

Decided product (`../HANDOFF.md` sections 1 to 3; it replaces the working assumptions this document was first written under): accounts for many users, each with a private vault, sign-up by invitation at first; each user's own Anthropic API key, kept on the server and never sent back; an online vault with an offline copy on each device; free-form questions to a model of the user's choosing; TypeScript, React and Vite as an installable single-page app; the Apple app continues to exist. The earlier assumptions, one signed-in owner and the Anthropic key as one server secret, are now alternatives: the "If instead" notes describe them and mark them as not chosen.

---

## 1. What the Apple app does today (A)

### 1.1 Navigation structure

Scene: a single `WindowGroup` that shows `RootView` (apple/SessionVault/SessionVaultApp.swift:7-9). There is no settings scene, no menu commands and no tab bar.

`RootView` is a three-column `NavigationSplitView` (apple/SessionVault/Views/RootView.swift:41-71):

| Column | View | Navigation title |
|---|---|---|
| Sidebar | library filters (`sidebar`, RootView.swift:118-184) | "SessionVault" (RootView.swift:180) |
| Content | `SessionListView` for the current filter (RootView.swift:44) | the filter title (SessionListView.swift:85) |
| Detail | `SessionDetailView` for the selected session, else a placeholder (RootView.swift:61-70) | the session title (SessionDetailView.swift:49) |

State (RootView.swift:28-29): `filter: LibraryFilter? = .all` and `selectedSession: ChatSession? = nil`. They are independent: no code clears the selected session when the filter changes, so the detail column can show a session that is not in the visible list.

Filters and their titles (RootView.swift:4-21):

| Filter | Title shown above the list |
|---|---|
| `.all` | "All Sessions" |
| `.pinned` | "Pinned" |
| `.timeline` | "Timeline" |
| `.project(p)` | the project name |
| `.provider(p)` | "Claude", "ChatGPT", "Gemini" or "Other" (raw values, apple/SessionVault/Models.swift:5-8) |
| `.tag(t)` | `#` followed by the tag |

Modal layers:

```
RootView
  sheet  Import Sessions (ImportSheet)                RootView.swift:57-59
           sheet  capture browser (LinkCaptureView)   ImportSheet.swift:132-152
           system file picker                         ImportSheet.swift:153-159
  alert  New Project                                  RootView.swift:86-100
  alert  Rename Project                               RootView.swift:101-108
  detail column
    sheet  Continue with Claude (ContinueChatView)    SessionDetailView.swift:95-97
    sheet  Original (OriginalSnapshotView)            SessionDetailView.swift:98-102
    alert  Summarize                                  SessionDetailView.swift:103-107
```

macOS:

- Sidebar column width: minimum 180, ideal 210 points (RootView.swift:181-183). The widths of the other columns are left to the system.
- Minimum sheet sizes: Import 440 x 340 (ImportSheet.swift:160-162), capture browser 800 x 600 (LinkCaptureView.swift:69-71), Continue 580 x 540 (ContinueChatView.swift:57-59), Original 700 x 600 (PDFViewer.swift:68-70).
- The three columns sit side by side in one window, toolbar buttons show their icon only, and context menus open on right-click (inference: standard SwiftUI behaviour; the repository has no macOS screenshot).

iOS:

- On iPhone the split view collapses into a stack: sidebar, then list, then detail. Screenshot apple/screenshots/01-all-sessions-list.png shows the list with a back button labelled "SessionVault"; the app starts one level in because `filter` starts as `.all` (inference about the cause).
- Sheets use an inline title (ImportSheet.swift:114-116, ContinueChatView.swift:38-40, PDFViewer.swift:52-54). The detail screen keeps the large title (screenshot 02).
- Sheets are page sheets; the capture browser is a sheet on top of the import sheet (screenshot 03 shows the stacked edges).
- Orientations: portrait and both landscapes on iPhone, all four on iPad (apple/SessionVault.xcodeproj/project.pbxproj:190-191). On iPad the split view shows two or three columns depending on width (inference).

### 1.2 Sidebar (library)

File: apple/SessionVault/Views/RootView.swift. A `List` with single selection bound to `filter` (:119).

| Section header | Row label | SF Symbol | Trailing badge | Line |
|---|---|---|---|---|
| "Library" | "All Sessions" | `tray.full` | number of sessions | :120-123 |
| | "Pinned" | `pin` | number of pinned sessions | :124-126 |
| | "Timeline" | `calendar.day.timeline.left` | none | :127-128 |
| "Projects" | one row per project, sorted by name (:27) | `folder` | number of sessions in the project | :130-134 |
| | "New Project…" (a button: medium weight, accent colour) | `folder.badge.plus`, hierarchical rendering | none | :146-158 |
| "Providers" | "Claude", "ChatGPT", "Gemini", "Other" (always all four) | the provider symbol in the provider colour (section 1.9) | none | :160-170 |
| "Tags" (the section exists only when at least one tag exists) | one row per distinct tag across all sessions, `sorted()` | `number` | none | :36-38, :171-178 |

- A badge whose count is 0 is not drawn (inference: documented behaviour of SwiftUI `badge(_:)`).
- Project rows have a context menu (:135-144): "Rename…" opens the Rename Project alert with the current name filled in; "Delete" (destructive role) deletes at once with no confirmation. If the deleted project is the current filter, the filter becomes `.all` first. Its sessions stay in the vault without a project (delete rule `.nullify`, apple/SessionVault/Models.swift:43).
- No row for settings, account or help exists.

Alerts owned by the root view:

| Alert | Elements | Behaviour | Line |
|---|---|---|---|
| "New Project" | text field with placeholder "Project name"; buttons "Create" and "Cancel"; message "Group sessions by what you're working on — e.g. `<three example names>`." (three example names, which the web app does not use: B3) | "Create": trim spaces and tabs; if the result is not empty, insert the project and select it as the filter; clear the field. An empty name closes the alert and does nothing. No duplicate check. | :86-100 |
| "Rename Project" | text field "Project name" prefilled; buttons "Rename" and "Cancel"; no message | "Rename": trim; if not empty, set the name. | :101-108 |

### 1.3 Session list

File: apple/SessionVault/Views/SessionListView.swift.

#### 1.3.1 Which sessions are shown, and in what order

All sessions are loaded sorted by `importedAt` descending (:9). Then (:13-39):

1. Apply the filter: `.all` and `.timeline` keep everything; `.pinned` keeps `isPinned`; `.project(p)` keeps sessions whose project is `p`; `.provider(p)` keeps that provider; `.tag(t)` keeps sessions whose `tags` contain exactly `t`.
2. If the search text is not empty: `needle = searchText.lowercased()` (not trimmed). Keep a session when `title.lowercased()` contains the needle, or `summary.lowercased()` contains it, or any tag lower-cased contains it. Message text is not searched. Search works inside the current filter only.
3. Sort: pinned sessions first, then `importedAt` descending.

Timeline (`filter == .timeline`, :43-55 and :59-70):

1. Take the result above and sort by `createdAt` descending (the "Original date"; pinned sessions are not placed first).
2. Key each session with `createdAt.formatted(.dateTime.year().month(.wide))`, for example "November 2026" in an English locale.
3. Consecutive sessions with the same key form a section.
4. Section header (:103-115): the key in `title3` bold, primary colour; at the trailing edge `<n> session` or `<n> sessions` (singular when n is 1) in `caption`, secondary colour; no upper-casing; vertical padding 2.

The search field: `.searchable(text:prompt:)` with the prompt "Search titles, summaries, tags" (:84). On iPhone it is not visible in screenshot 01, so it is hidden until the list is pulled down (inference).

#### 1.3.2 Row

`SessionRow` (:143-181), a leading-aligned vertical stack with spacing 4 and vertical padding 2:

| Line | Content | Style | Shown when |
|---|---|---|---|
| 1 | provider chip (section 1.9); at the trailing edge a `pin.fill` icon | icon: `caption`, orange | chip always; icon when pinned |
| 2 | title | `headline`, one line | always (may be empty text) |
| 3 | summary | `subheadline`, secondary, one line | summary not empty |
| 4 | `<relative import time>` `·` `<n> turns` | `caption`, secondary, spacing 6 | always |
| 5 | tags as `#tag`, joined by two spaces | `caption2`, accent colour, one line | at least one tag |

- The relative time is `importedAt.formatted(.relative(presentation: .named))` (:167), for example "3 hours ago" (screenshot 01). Values printed by Foundation in an English locale (appendix 5.3): "now", "30 seconds ago", "2 minutes ago", "3 hours ago", "yesterday", "2 days ago", "last week", "3 weeks ago", "last month", "last year". It is computed when the row is drawn and does not tick.
- `<n> turns` uses the message count and is never singular: one message reads "1 turns" (:169).
- The same row is used in the timeline, so a timeline row also shows the import time, not the original date.

#### 1.3.3 Row actions

| Action | Where | Effect | Line |
|---|---|---|---|
| Select | click or tap | sets `selectedSession`; the detail column shows it | :60, :72, :120 |
| "Pin" / "Unpin" | context menu | toggles `isPinned`; the list re-sorts | :122-124 |
| "Move to Project" submenu: "None", then every project name | context menu | sets or clears the project | :125-130 |
| "Delete" (destructive role) | context menu | deletes at once, no confirmation, no undo; if it was selected, the selection is cleared first | :131-133, :137-140 |
| Delete by swipe | `.onDelete` on the flat list only; the timeline list has no `.onDelete` | same as Delete | :76-80 |

Messages are deleted with their session (cascade, apple/SessionVault/Models.swift:67-68). On iOS `.onDelete` gives swipe-to-delete and the context menu opens on long press; on macOS deletion is also reachable from the Edit menu or Delete key (inference).

#### 1.3.4 Empty states

Shown as an overlay whenever the filtered list is empty (:86-98):

| Condition | Icon | Title | Description |
|---|---|---|---|
| search text empty | `tray` | "Your Vault Is Empty" | "Save AI conversations three ways: press Import and capture a claude.ai or ChatGPT share link in the built-in browser, drop .md / .json / .txt transcript files anywhere in this window, or paste a transcript from the clipboard." |
| search text not empty | system search glyph | `ContentUnavailableView.search(text:)`: system wording, in English `No Results for "<text>"` with "Check the spelling or try a new search." (inference: system-provided, not in the repository) | |

The first state appears for any empty filter (an empty project, no pinned sessions, a provider with no sessions), not only for an empty vault.

There are no loading or error states: the data is local.

#### 1.3.5 Toolbar of the list column

One button: "Import" with symbol `square.and.arrow.down`, keyboard shortcut Command-I, opens the import sheet (RootView.swift:46-59). Screenshot 01 shows it as an icon at the top right.

### 1.4 Session detail

File: apple/SessionVault/Views/SessionDetailView.swift. One vertical scroll view with 16-point spacing and default padding: header, divider, transcript (:29-48). The header scrolls away with the transcript. The content is as wide as the column; there is no maximum line length.

With no session selected the detail column shows (RootView.swift:65-69): icon `bubble.left.and.text.bubble.right`, title "No Session Selected", description "Import a session or pick one from the list."

#### 1.4.1 Toolbar

In this order (:50-91):

| # | Label | SF Symbol | Shown / enabled | Action |
|---|---|---|---|---|
| 1 | "View Original" | `doc.richtext` | only when the session has a stored PDF | opens the Original sheet (section 1.8) |
| 2 | "Continue with Claude" | `sparkle` | always | opens the Continue sheet (section 1.7) |
| 3 | "Summarize (keeps code intact)" | `text.badge.checkmark` | disabled and replaced by a small spinner while running | starts Summarize (below) |
| 4 | "Pin" / "Unpin" | `pin` / `pin.fill` | always | toggles `isPinned` |
| 5 | "Copy Context Pack", for 2 seconds after a press "Copied!" | `doc.on.doc`, then `checkmark` | always | saves the tag field, copies the context pack to the clipboard (:228-241) |
| 6 | "Share Context Pack" | `square.and.arrow.up` | always | system share sheet with the context pack as text |

The context pack is the Markdown produced by apple/SessionVault/ContextPack.swift:7-43 (see data-model.md). On iPhone the toolbar shows the first actions as icons and moves the rest into a system overflow menu: screenshot 02 (a session without a PDF) shows `sparkle`, `text.badge.checkmark`, `pin` and an ellipsis button.

Summarize, as the user sees it (:119-161; the request itself is in claude-api.md):

| State | What is shown | Line |
|---|---|---|
| no API key saved | alert "Summarize", message "Add your Anthropic API key first — open Continue with Claude to set it up.", button "OK" | :120-123 |
| session has no messages | alert with "This session has no messages to summarize." | :127-130 |
| running | the button becomes a spinner and is disabled; nothing else changes; it cannot be cancelled | :67-73, :131 |
| success | the Summary field is overwritten with the result, silently and without asking | :150-155 |
| empty result | alert with "Claude returned no summary — it may have declined the request." | :151-152 |
| request failed | alert with the error text | :156-158 |

#### 1.4.2 Header fields

A leading-aligned stack with spacing 8 (:163-218). Every change is written to the stored session immediately through bindings, except tags.

| Field | Control | Placeholder or label | Behaviour | Line |
|---|---|---|---|---|
| Title | plain text field, `title2` bold | "Title" | saved on every keystroke; may be left empty | :165-167 |
| Provider | menu picker, label hidden; options show symbol and name | accessibility label "Provider" | options "Claude", "ChatGPT", "Gemini", "Other" | :169-176 |
| Project | menu picker, label hidden | accessibility label "Project"; first option "No Project", then each project with a `folder` symbol | sets or clears the project | :177-185 |
| Model | rounded text field, maximum width 260 | "Model (e.g. claude-fable-5-1)" | free text | :186-188 |
| Tags | rounded text field | "Tags (comma separated)" | saved only when Return is pressed (or when Copy Context Pack runs): split on `,`, trim, lower-case, drop empty items, then rewrite the field as the tags joined by `, `. Duplicates are kept. No auto-capitalisation on iOS. | :190-195, :220-226 |
| Summary | rounded text field that grows from 2 to 6 lines | "Summary — what makes this session important?" | free text, saved on every keystroke | :196-198 |
| Source link | link with a `link` symbol, `caption`, one line | the URL itself | only when `sourceURL` is not empty and parses as a URL; opens in the default browser | :199-205 |
| Original date | date picker, date only | "Original date" | edits `createdAt` | :206-212 |
| Counts | text, `caption`, secondary | "imported `<date>` · `<n>` turns", date as `Aug 5, 2026` | read-only; "1 turns" for one message | :213-215 |

Provider, Project and Model sit in one row with spacing 12; Original date and the counts share the last row (:168, :206). Screenshot 02 shows this row on an iPhone: the Model field is cut to "Model (e.g…", and the title appears twice, once as the large navigation title and once as the editable field.

#### 1.4.3 Transcript

- Messages of the session ordered by `index` (:16, :24-27), each drawn as a `MessageBubble` (section 1.10) in a plain `VStack`, so every message is built when the session opens (:31-45).
- With no messages (:34-39): icon `text.bubble`, title "No Transcript", description "This session has no captured messages. Recapture the link or re-import the file."

### 1.5 Import sheet

File: apple/SessionVault/Views/ImportSheet.swift. A grouped form titled "Import Sessions" with a "Done" button that closes the sheet (:112-121). Section headers are a symbol plus a title in `subheadline` semibold, not upper-cased (:170-174).

| Section | Element | Exact text | Notes | Line |
|---|---|---|---|---|
| "From Link" (`safari`) | text field | placeholder "https://claude.ai/code/session_…" | no auto-capitalisation, URL keyboard, no autocorrection | :36-42 |
| | text field | placeholder "Name (optional — auto-detected from the page)" | | :43-44 |
| | prominent button (`safari`) | "Open & Capture Transcript…" | disabled while `URL(string:)` of the trimmed text is nil. Checked with Foundation on macOS (appendix 5.3): that is the empty field and a few malformed strings; "hello", "hello world" and "not a url at all" all enable the button. | :45-51 |
| | tip (`lightbulb`), `caption`, orange | "Tip: in Claude, tap Share on the conversation and paste that share link instead — share links capture with no sign-in at all." | only when the link text contains `claude.ai` and does not contain `/share/` | :52-59 |
| | help text, `caption`, secondary | "Public share links (claude.ai/share/…) capture with no login — that's the recommended flow. Press Capture Transcript once the conversation is visible, and it's saved as a formatted User/Assistant transcript." | | :60-62 |
| "From Files" (`folder`) | button (`folder`) | "Import .md / .json / .txt…" | system file picker: JSON, plain text, text, `.md`; multiple selection (:26-30, :153-159) | :67-71 |
| | help text | "Supports transcripts from Pull-AI-Context-Sessions, ChatGPT data exports (conversations.json), and plain markdown." | | :72-74 |
| | hint, `caption`, tertiary | "Tip: you can also drag transcript files onto the main window." | | :75-77 |
| "From Clipboard" (`clipboard`) | picker "Provider" | "Claude", "ChatGPT", "Gemini", "Other"; default Claude | used only for pasted text whose provider was not detected (:219-222) | :82-86 |
| | button (`doc.on.clipboard`) | "Paste Transcript" | reads the clipboard and imports at once | :87-91 |
| | help text | "No need to pick first — the provider is detected automatically from links and transcript content. This picker only labels pastes that can't be identified." | | :92-94 |
| status (only when there is a message) | icon plus text in `callout` | see below | green `checkmark.circle.fill` when the message starts with "Imported" or "Captured", otherwise orange `exclamationmark.triangle.fill` (:166-168) | :98-110 |

Status messages:

| Message | When | Line |
|---|---|---|
| "Captured `<n>` turns from `<host>` — original saved as PDF." | link capture saved with a PDF (`<host>` falls back to "the page") | :149 |
| "Captured `<n>` turns from `<host>`." | link capture saved without a PDF | :149 |
| "No conversation content captured from the page." | capture returned no usable message; nothing saved | :145 |
| "Imported `<n>` session." / "Imported `<n>` sessions." | files imported (singular for 1) | :189-190 |
| "No sessions found in the selected files." | nothing parsed | :191 |
| "Import failed: `<system error text>`" | the file picker failed | :186 |
| "Clipboard is empty." | no text, or only white space | :201-204 |
| "That's a link — opening it in the capture browser." | the clipboard holds a single link (rule below) | :213 |
| "Imported `<n>` session(s) from clipboard." | pasted text imported (same singular rule) | :225 |

Flows:

1. Link (:176-181): trim the field; if it has no `://`, prefix `https://`; open the capture browser on that URL. When the browser hands back a capture (:132-152): title = typed name if not empty, else the detected page title, else the last path component of the URL (or the whole URL); save; show a status. The sheet stays open and the fields keep their text.
2. Files: every picked file goes through the importer (import-rules.md); one status line with the total.
3. Clipboard (:195-226): if the trimmed text has no line break, no space, contains a `.` and is shorter than 500 characters, and it parses as a URL with a host after adding `https://` when it has no `://`, it is treated as a link: the link field is filled and the capture browser opens. Checked with Foundation (appendix 5.3): "notes.md", "v1.2" and "3.14" are all treated as links by this rule. Otherwise the text is parsed with the title "Pasted session" and every resulting session is saved.
4. Drag and drop: files dropped anywhere on the main window are imported through the same file path (RootView.swift:72-74). Nothing is shown afterwards, whether it worked or not.

Nothing selects or opens a newly imported session.

### 1.6 Capture browser sheet

Files: apple/SessionVault/Views/LinkCaptureView.swift and apple/SessionVault/WebCapture.swift (mechanics in capture.md).

Layout (:28-67): a top bar with padding 10 on the system bar material, a divider, then a full web view showing the link. The bar holds a status icon and one line of status text (`callout`, secondary, truncated at the end), a plain "Cancel" button and a prominent "Capture Transcript" button. There is no address field and no back, forward or reload control.

| Element | State rule | Line |
|---|---|---|
| "Capture Transcript" | disabled while capturing or until the page has finished loading | LinkCaptureView.swift:61 |
| status icon | spinner while capturing; green `checkmark.circle.fill` when the status starts with "Captured"; otherwise a secondary `globe` | :76-88 |
| "Cancel" | closes the sheet; it does not stop a capture that is already running | :39-40 |

Status texts:

| Text | When | Line |
|---|---|---|
| "Load the session link, log in if asked, then press Capture." | initial | WebCapture.swift:10 |
| "Loading page…" | navigation started | WebCapture.swift:192 |
| "Page loaded — sign in if needed, then press Capture once the conversation is visible." | navigation finished | WebCapture.swift:197 |
| "Page had trouble loading — if the conversation is visible you can still press Capture." | navigation failed | WebCapture.swift:202 |
| "Capturing…" | capture running | WebCapture.swift:151 |
| "Captured `<n>` turns." | turns found | WebCapture.swift:184 |
| "Captured page text (no turn structure found)." | whole-page fallback | WebCapture.swift:178 |
| "Nothing captured — is the transcript visible in the page?" | nothing found; the sheet stays open | WebCapture.swift:181 |
| "That looks like a sign-in or landing page — log in below (or wait for the conversation to appear), then press Capture again." | the capture looks like a sign-in wall; nothing is saved and the sheet stays open | LinkCaptureView.swift:50-52 |

On success the sheet closes and the import sheet shows the status line (section 1.5). Screenshot 03 shows the bar on an iPhone: the status is cut to "Page loaded — sign…" and the prominent button wraps onto two lines.

### 1.7 Continue with Claude sheet

File: apple/SessionVault/Views/ContinueChatView.swift. Title "Continue with Claude" (:37); a "Close" button in the cancel position (:42-44). The sheet has two states, chosen by whether an API key is stored (:31-35).

#### 1.7.1 Key entry ("Connect to Claude")

Centred column, maximum width 340, spacing 14 (:64-98):

| Element | Text | Style | Line |
|---|---|---|---|
| icon | `lock.shield.fill` | 44 points, accent colour | :67-70 |
| heading | "Connect to Claude" | `title2` bold | :71-72 |
| explanation | "Add your Anthropic API key to continue this session live. The key is stored in your Keychain and sent only to api.anthropic.com." | `callout`, secondary, centred | :73-77 |
| secure field | placeholder "sk-ant-…" | rounded border; Return saves | :78-81 |
| button | "Save Key" | prominent, large, full width; disabled while the field is empty after trimming | :82-88 |
| footnote | "Create a key at console.anthropic.com." | `caption`, tertiary | :89-91 |

Saving stores the key and switches to the chat (:100-105). The format is not checked and no test request is made. No screen removes or replaces a stored key.

#### 1.7.2 Chat

| Area | Content | Line |
|---|---|---|
| toolbar | menu picker "Model": "Claude Opus 5", "Claude Fable 5.1", "Claude Fable 5", "Claude Sonnet 5", "Claude Haiku 4.5" (apple/SessionVault/ClaudeAPI.swift:8-14). It starts at `claude-opus-5` every time the sheet opens (ClaudeAPI.swift:16, ContinueChatView.swift:14). | :45-54 |
| transcript | every stored message as a `MessageBubble`, spacing 12, in a lazy stack; then, while a reply is in flight, one of the two bubbles below | :111-127 |
| thinking bubble | three pulsing dots and "Claude is thinking…" (`callout`, secondary), shown until the first text arrives | :153-162 |
| live bubble | label "Claude" (`caption` bold, secondary) and the streamed text as plain `body` text, selectable; no Markdown or code formatting until the reply is saved | :165-177 |
| error banner | red `exclamationmark.triangle.fill`, the message in `callout`, a dismiss button `xmark.circle.fill` (tooltip "Dismiss" on macOS); 10 % red fill, radius 10; slides in from the bottom with a 0.2 s ease | :142-149, :179-202 |
| composer | a line with `sparkle` and the active model name (`caption2`, tertiary); below it a text field that grows from 1 to 5 lines, placeholder "Continue the conversation…", and a send button `arrow.up.circle.fill` (30 points in a 34 x 34 frame) | :204-244 |

Behaviour:

- Send is enabled when the field has non-blank text and no reply is in flight (:24-26, :237). Return in the field sends (:217) (inference: also on iOS, where Return does not insert a line break in this kind of field).
- While a reply is in flight the field is disabled and the send button shows a small spinner (:218, :225-227). There is no stop button, and "Close" does not cancel the request.
- On send (:248-305): the field is cleared, the banner is cleared, the user's message is stored at once, the reply streams into the live bubble. When the stream ends, a non-empty reply is stored as an assistant message and the session's model field is set to the picked model id. A refusal shows the banner "Claude declined this request (safety classifiers)." and stores nothing; any other failure shows the error text in the banner. The user's message stays stored in every case.
- The view scrolls to the bottom when it opens, on every streamed chunk and whenever the message count changes (:129-140), also when the user has scrolled up.
- The dots (:309-329): 7 x 7 points, spacing 5, opacity 0.3 to 1.0, 0.6 s ease in and out, repeating, each dot delayed by 0.2 s.

### 1.8 Original (PDF) viewer

File: apple/SessionVault/Views/PDFViewer.swift.

- Opened by "View Original" when the session has a stored PDF (SessionDetailView.swift:52-58 and SessionDetailView.swift:98-102). The PDF is the snapshot of the captured page (capture.md).
- A sheet titled "Original" (:51) with a "Close" button (:56-58) and, when the PDF could be written to a temporary file, a "Share PDF" button with symbol `square.and.arrow.up` that opens the system share sheet for that file (:59-65).
- Body: a PDFKit `PDFView` with `autoScales = true` (:4-26), extending under the bottom safe area (:50). Scrolling and zooming are PDFKit defaults (inference). There are no thumbnails, no search and no page controls.
- Shared file name (:35-45): the session title with `/` replaced by `-`, plus `.pdf`; "Session.pdf" when the title is empty.

### 1.9 Provider chips and colours

Symbols: apple/SessionVault/Models.swift:12-19. Colours: apple/SessionVault/Views/ProviderStyle.swift:5-12.

| Provider (stored and displayed name) | SF Symbol | SwiftUI colour | Light value | Dark value |
|---|---|---|---|---|
| "Claude" | `sparkle` | `.orange` | #FF9500 | #FF9F0A |
| "ChatGPT" | `bubble.left.and.bubble.right` | `.teal` | #30B0C7 | #40C8E0 |
| "Gemini" | `rhombus` | `.blue` | #007AFF (measured in screenshot 01) | #0A84FF |
| "Other" | `questionmark.circle` | `.gray` | #8E8E93 | #8E8E93 |

Only the Gemini light value is measured. The other values are Apple's published system colours for iOS 17 and 18 (inference: they are not in the repository, and newer OS versions may use slightly different values).

The chip (apple/SessionVault/Views/SessionListView.swift:185-195): symbol and name with spacing 3, `caption2` semibold, in the provider colour; padding 7 horizontal and 2 vertical; background the same colour at 15 % opacity in a capsule. Measured in screenshot 01: text #007AFF on #D9EBFF.

Where the provider colour is used: the chip in list rows, and the symbol in the sidebar "Providers" rows (RootView.swift:165-166). The provider picker in the detail header applies no provider colour (SessionDetailView.swift:169-176), so it is drawn in the accent colour.

### 1.10 Message rendering

File: apple/SessionVault/Views/MessageView.swift.

#### 1.10.1 Bubble

`MessageBubble` (:18-67): a full-width, leading-aligned block with padding 12 and corner radius 10. Bubbles are not aligned left and right by speaker.

| Role (stored value) | Label (apple/SessionVault/Models.swift:28-35) | Label colour | Background |
|---|---|---|---|
| `user` | "User" | accent | accent at 8 % opacity |
| `assistant` | "Assistant" | secondary | secondary at 6 % opacity (measured: #F8F8F8 on white) |
| `system` | "System" | secondary | same |
| `unknown` | "Note" | secondary | same |

The label is `caption` bold. It is the first element of a header row (:26-42, spacing 8); a spacer pushes the Copy button described below to the trailing edge. Below the header row come the segments of the message with spacing 8.

Copy button of the bubble (:33-41 and :60-66; added in commit `e81828a`). Every bubble has it, whatever the role:

| Property | Value | Line |
|---|---|---|
| label and symbol | "Copy" with `doc.on.doc`; after a press "Copied" with `checkmark` | :34 |
| style | `caption2`, plain button style, secondary colour | :35-38 |
| tooltip | "Copy this whole message", on macOS only | :39-41 |
| action | puts `message.text` on the system pasteboard as plain text: the stored string, whole, with its code fences and without the role label | :60-61, :9-16 |
| "Copied" state | set by the press and cleared 1.5 seconds later. Each press schedules its own reset, so a second press inside that time copies again but does not keep the label beyond the first reset (read from the code) | :62-65 |
| disabled state, keyboard shortcut | none | |

The button is part of `MessageBubble`, so it appears in the detail transcript (SessionDetailView.swift:41-43) and on every stored message of the Continue sheet (ContinueChatView.swift:114-116). The thinking bubble and the live bubble of that sheet are separate views without it (ContinueChatView.swift:153-177): a reply can be copied whole only once it is stored. The commit message says that the button was built for macOS and the iOS simulator and was not clicked in a running app.

#### 1.10.2 Splitting a message into prose and code

`MessageSegment.parse` (:79-126), as ordered steps:

```
segments = []; proseLines = []; codeLines = []; language = none; inCode = false
for each line of text split on "\n":
    trimmed = line without leading and trailing spaces and tabs   (a "\r" is not removed)
    if inCode:
        if trimmed == "```":  append code(language, codeLines joined by "\n"); reset; inCode = false
        else:                 codeLines.append(line)              (the untrimmed line)
    else if trimmed starts with "```":
        flush prose
        tag = trimmed without its first 3 characters, trimmed
        language = none if tag is empty else tag
        inCode = true
    else:
        proseLines.append(line)
at the end: if inCode, append the code segment (an unterminated fence still becomes code); else flush prose

flush prose: joined = proseLines joined by "\n"; skip it when it is only white space; else append prose(joined)
```

Results of running this exact code on synthetic input (appendix 5.3):

| Input (`\n` shown as a line break marker) | Result |
|---|---|
| `Intro\n```python\nprint(1)\n```\nOutro` | prose "Intro", code (language "python") "print(1)", prose "Outro" |
| a fence that is never closed | everything after the opening line is code |
| the same text with `\r\n` line endings | the language becomes "python" plus a carriage return and the block never closes |
| a fence of four backticks | language is a single backtick; the block never closes |
| ` ```code``` ` on one line | opens a block with the language `code` followed by three backticks; the following lines are swallowed |
| a fence indented by spaces or a tab | recognised; code lines keep their indentation |
| a fence line with a tag inside an open block (` ```python `) | stays code; only a bare three-backtick line closes |
| an empty block | a code segment with empty text (an empty box with a Copy button) |
| `~~~` fences | not recognised: prose |

#### 1.10.3 Prose

`ProseView` (:129-157):

1. Split the prose on the exact sequence `\n\n`, trim each part, drop empty parts. A line holding only spaces does not end a paragraph.
2. Each paragraph is parsed with `AttributedString(markdown:)` and the option `.inlineOnlyPreservingWhitespace`; if parsing throws, the plain text is shown.
3. Paragraphs are stacked with spacing 8, `body` font, full width, text selection enabled.

What that option does, verified by running it (appendix 5.3):

| Syntax in the paragraph | Rendered as |
|---|---|
| `**bold**`, `*italic*`, `***both***`, `_under_` | bold, italic |
| `` `code` `` | inline code |
| `~~strike~~` | strikethrough |
| `[text](https://example.com)` and bare `https://…` | link |
| `[text](javascript:…)` | a link run with that URL is produced too |
| `# Heading`, `- item`, `1. item`, `> quote`, tables, `---`, four-space indents | literal text, unchanged |
| single line breaks, tabs, runs of spaces | preserved |
| `__init__` | the underscores disappear and "init" is bold |
| `\*`, `\#` | the backslash disappears |
| `<b>x</b>` | kept as text runs marked as inline HTML (shown as text, inference) |
| `![alt](url)` | only "alt" remains, marked with the image URL (no image is loaded, inference) |
| unbalanced `**` or `*` | literal text |

#### 1.10.4 Code block

`CodeBlockView` (:159-203):

- A full-width box, corner radius 8, filled with the primary colour at 6 % opacity.
- Header row (padding 10 horizontal, 6 top): the language tag when present (`caption2`, secondary), a spacer, and a plain button "Copy" with symbol `doc.on.doc` (`caption2`, secondary).
- Copy puts the code on the clipboard; the button reads "Copied" with a `checkmark` for 1.5 seconds (:196-202).
- The code is one `Text` in the monospaced `callout` font with padding 10, selectable, inside a horizontal scroll view: lines never wrap. No syntax colouring, no line numbers, no height limit.

#### 1.10.5 Long messages and copy actions

- There is no long-message handling: no collapsing, no "show more", no truncation. A message of any length is laid out in full, and the detail view builds all messages at once (SessionDetailView.swift:31-45). Only the Continue sheet uses a lazy stack (ContinueChatView.swift:113).
- Copy actions that exist: per message (section 1.10.1, since commit `e81828a`), per code block (above) and the whole session as a context pack (section 1.4.1). Text can also be selected (`.textSelection(.enabled)`, :140 and :185); the comment at :31-32 says that selection works one paragraph at a time and gives that as the reason for the per-message button.

### 1.11 Keyboard, pointer and other inputs

| Input | Effect | Line |
|---|---|---|
| Command-I | opens the import sheet | RootView.swift:52 |
| Return in the tags field | saves the tags | SessionDetailView.swift:192 |
| Return in the API key field | saves the key | ContinueChatView.swift:80 |
| Return in the chat field | sends | ContinueChatView.swift:217 |
| drop files on the window | imports them | RootView.swift:72-74 |
| context menu (right-click or long press) | project rows and session rows | RootView.swift:135-144, SessionListView.swift:121-134 |
| interactive keyboard dismissal by dragging the chat transcript (iOS) | | ContinueChatView.swift:128 |

Three launch arguments exist for test automation only (`--select-first-session`, `--open-import`, `--capture-url <url>`: RootView.swift:75-85, ImportSheet.swift:122-130). They are not user features and have no web counterpart.

### 1.12 Typography, spacing and colour as used

The app sets no custom font, colour or size apart from the few numbers below. The accent colour asset is empty (apple/SessionVault/Assets.xcassets/AccentColor.colorset/Contents.json), so the accent is the system default: blue on iOS (measured #007AFF in all three screenshots) and the user's own accent colour on macOS. The app icon set lists 11 slots and contains no image (apple/SessionVault/Assets.xcassets/AppIcon.appiconset/Contents.json): there is no icon artwork.

Text styles used (sizes are Apple's defaults at the standard text size; they are not in the repository):

| SwiftUI style | iOS pt | macOS pt | Used for |
|---|---|---|---|
| `title2` bold | 22 | 17 | session title field (SessionDetailView.swift:166); "Connect to Claude" (ContinueChatView.swift:72) |
| `title3` bold | 20 | 15 | timeline month header (SessionListView.swift:106) |
| `headline` | 17 semibold | 13 bold | row title (SessionListView.swift:158) |
| `body` | 17 | 13 | prose (MessageView.swift:136); live reply (ContinueChatView.swift:171) |
| `callout` | 16 | 12 | status and error texts (ImportSheet.swift:102, LinkCaptureView.swift:33, ContinueChatView.swift:74, :157, :184) |
| `callout`, monospaced | 16 | 12 | code (MessageView.swift:184) |
| `subheadline` | 15 | 11 | row summary (SessionListView.swift:162); import section headers, semibold (ImportSheet.swift:172) |
| `caption` | 12 | 10 | row meta line, timeline count, source link, counts, help texts (SessionListView.swift:110, :171; SessionDetailView.swift:202, :214; ImportSheet.swift:57, :61, :73, :76, :93) |
| `caption` bold | 12 | 10 | role label (MessageView.swift:28) |
| `caption2` | 11 | 10 | row tags, code language, both Copy buttons, composer model line (SessionListView.swift:175; MessageView.swift:35, :169, :175; ContinueChatView.swift:210) |
| `caption2` semibold | 11 | 10 | provider chip (SessionListView.swift:190) |
| system 44 / 30 | | | key-entry icon (ContinueChatView.swift:68) / send icon (:230) |

Spacing and radii (points):

| Where | Values | Line |
|---|---|---|
| list row | stack spacing 4; chip row and meta row spacing 6; vertical padding 2 | SessionListView.swift:147-180 |
| provider chip | inner spacing 3; padding 7 x 2; capsule | SessionListView.swift:186-194 |
| detail | stack spacing 16; default padding (16); header spacing 8; field rows spacing 12 | SessionDetailView.swift:31, :46, :164, :168 |
| message bubble | spacing 8; header row spacing 8; padding 12; radius 10 | MessageView.swift:25, :26, :53-56 |
| paragraphs | spacing 8 | MessageView.swift:133 |
| code block | header padding 10 and 6; code padding 10; radius 8 | MessageView.swift:180-186, :191 |
| chat | message spacing 12; banner padding 12, radius 10; composer field padding 14 x 9, radius 18, 1-point border; send button 34 x 34 | ContinueChatView.swift:113, :197-198, :219-222, :234 |
| capture bar | spacing 12; padding 10 | LinkCaptureView.swift:29, :63 |
| key entry | spacing 14; maximum width 340 | ContinueChatView.swift:65, :95 |

Colours as used:

| SwiftUI colour | Where | Measured light value |
|---|---|---|
| primary | titles, body | #000000 |
| secondary | meta lines, role labels, help texts, status text | #8A8A8E on white in the detail (screenshot 02), #7F7F7F in list rows (screenshot 01) |
| tertiary | faint hints (ImportSheet.swift:77, ContinueChatView.swift:91, :211) | not in a screenshot; placeholder text measures #C5C5C7 |
| accent | user role label and bubble, tags in rows, "New Project…", prominent buttons, links, toolbar icons, pickers | #007AFF |
| orange | pinned icon in rows (SessionListView.swift:154), the claude.ai tip (ImportSheet.swift:58), failure status icon (ImportSheet.swift:107), Claude chip | not in a screenshot |
| green | success status icons (ImportSheet.swift:107, LinkCaptureView.swift:83) | not in a screenshot |
| red | error banner icon and its 10 % fill (ContinueChatView.swift:182, :198) | not in a screenshot |
| secondary at 6 % | assistant, system and note bubbles, thinking and live bubbles | #F8F8F8 |
| accent at 8 % | user bubble | not in a screenshot |
| primary at 6 % | code block | not in a screenshot |
| secondary at 8 % with a 15 % border | chat field (ContinueChatView.swift:221-222) | not in a screenshot |
| separator (system) | list separators, divider | #C6C6C8 |
| bar material | capture bar | about #F7F8F7 |

Dark mode: nothing in the code is specific to it; all colours are semantic and adapt automatically (inference: there is no dark screenshot).

Motion: banner 0.2 s ease in and out (ContinueChatView.swift:149); send button colour 0.15 s (:238); thinking dots as in section 1.7.2; "Copied!" for 2 s (SessionDetailView.swift:238) and "Copied" for 1.5 s (MessageView.swift:63, :199).

Text size: all text uses system text styles, so it follows the user's text-size setting on iOS (inference).

---

## 2. Defects and accidents of the Apple app that the web app should not copy (B)

Each row gives the evidence and what to do instead. "Measured" refers to appendix 5.

### 2.1 Wording and counts

| # | What the Apple app does | Evidence | Web app instead |
|---|---|---|---|
| B1 | Writes "1 turns". | SessionListView.swift:169; SessionDetailView.swift:213 | "1 turn", otherwise "`<n>` turns". |
| B2 | Shows "Your Vault Is Empty" for every empty filter, and its text refers to "the built-in browser" and "this window". | SessionListView.swift:86-93 | One empty state per situation (section 4.10). |
| B3 | The New Project message hard-codes example project names. | RootView.swift:99 | "Group sessions by what you're working on." |
| B4 | The link placeholder shows a `claude.ai/code/session_…` link while the help text below recommends share links. | ImportSheet.swift:36, :60 | Placeholder "https://claude.ai/share/…". |
| B5 | Says the provider "is detected automatically from links and transcript content", which the importer does only in part (import-rules.md). | ImportSheet.swift:92 | Wording that promises less (section 4.13). |
| B6 | A reply is labelled "Claude" and shown as plain text while it streams, then becomes an "Assistant" bubble with code blocks once saved. | ContinueChatView.swift:165-177; Models.swift:31 | Same label and same renderer while streaming and after. |
| B7 | Decides whether a status is a success by testing whether its text starts with "Imported" or "Captured". | ImportSheet.swift:166-168; LinkCaptureView.swift:81 | Status objects carry a kind (`success`, `warning`, `error`, `info`, `progress`) and a message. |

### 2.2 Layout

| # | What the Apple app does | Evidence | Web app instead |
|---|---|---|---|
| B8 | On iPhone the session title appears twice (navigation title and editable field). | SessionDetailView.swift:49, :165; screenshot 02 | Show the title once, as the editable field. |
| B9 | Provider, Project and Model stay in one row on a phone; the Model field is cut off. | SessionDetailView.swift:168-189; screenshot 02 | Fields stack in one column when the pane is narrow (section 4.3). |
| B10 | Capture status and guidance are limited to one truncated line; on a phone the instruction cannot be read. | LinkCaptureView.swift:33-36; screenshot 03 | Status and guidance texts always wrap. |
| B11 | Transcript lines run the full width of a wide window. | SessionDetailView.swift:46-47 | Maximum text width 46rem (section 4.3). |
| B12 | On iPhone the search field is hidden until the list is pulled down (inference from screenshot 01). | SessionListView.swift:84 | The search field is always visible at the top of the list. |
| B13 | Model, Tags and Summary are identified only by placeholder text, which disappears once the field has a value. | SessionDetailView.swift:186-198 | Small visible labels above the fields (section 4.6.4). |
| B14 | Timeline sections are grouped by original date, but each row shows the relative import time. | SessionListView.swift:44-47, :167 | Timeline rows show the original date. |
| B15 | The list shows the raw first line of the summary; a summary written by Summarize may begin with Markdown syntax. | SessionListView.swift:160-165 | Show the first non-blank line with leading `#`, `>`, `-`, `*` and spaces removed. |

### 2.3 Colour

| # | What the Apple app does | Evidence | Web app instead |
|---|---|---|---|
| B16 | In the light appearance, coloured text is below WCAG AA (4.5:1): chip text 1.95:1 (Claude), 2.25:1 (ChatGPT), 3.30:1 (Gemini), 2.81:1 (Other); secondary text 3.44:1; placeholder-level text 1.72:1; orange pin and green status icons 2.2:1 (below the 3:1 needed for icons). | Measured and computed (appendix 5.1, 5.2) | The tokens of section 4.2. Never use the Apple hex values as text colours. |

### 2.4 Behaviour

| # | What the Apple app does | Evidence | Web app instead |
|---|---|---|---|
| B17 | Deletes sessions and projects at once: no confirmation, no undo. | SessionListView.swift:76-80, :131-140; RootView.swift:140-143 | A confirmation dialog for both (section 4.13), unless the owner prefers otherwise (decision 4 of data-model.md). |
| B18 | Tags are saved only on Return or when the context pack is copied; leaving the screen loses typed tags. Duplicates are kept. | SessionDetailView.swift:190-192, :220-229 | Save on Enter and on blur, with `parseTags` of data-model.md 8.2. |
| B19 | The title can be saved empty, which leaves a row with no title. | SessionDetailView.swift:165-167 | Store what was typed; display an empty title as "Untitled" everywhere (the same rule as the interchange schema). |
| B20 | Summarize replaces an existing summary without asking and cannot be cancelled. | SessionDetailView.swift:150-155 | Ask before replacing a non-empty summary; the running state can be cancelled; a saved summary can be undone (section 4.6.7). |
| B21 | Dropping files on the window gives no feedback, whether zero or many sessions were imported. | RootView.swift:72-74 | A drop overlay while dragging and a result message afterwards. |
| B22 | After a link capture the URL and Name fields keep their text (a typed name is silently reused for the next capture), and nothing offers to open the new session. | ImportSheet.swift:132-151 | Clear both fields on success; the status line has an "Open" action. |
| B23 | The capture button is enabled for almost any text ("hello world"). | ImportSheet.swift:51; appendix 5.3 | Link actions appear only when `looksLikeLink` of capture.md 8.1 accepts the text. |
| B24 | "Cancel" in the capture browser does not stop a running capture; the session is saved anyway when it finishes. | LinkCaptureView.swift:39-56 | Cancel aborts the request; nothing is saved. |
| B25 | The capture button stays enabled during the first steps of a capture, so a second press starts a second capture and a duplicate session. | LinkCaptureView.swift:43-45, :61; WebCapture.swift:147 | Disable the button from the press until the request has settled. |
| B26 | A streaming reply cannot be stopped, and the view jumps to the bottom on every chunk even when the user has scrolled up. | ContinueChatView.swift:129-140, :225-227 | A Stop control; follow the output only while the user is at the bottom. What is stored after a stop is defined in claude-api.md. |
| B27 | The model choice is not remembered. | ContinueChatView.swift:14 | The choice is remembered: the user's default model is an account setting, and the chat remembers the last pick on the device (section 4.15.6). |
| B28 | A stored API key can never be removed or replaced from the UI. | apple/SessionVault/ClaudeAPI.swift:167-169 is never called | The key screen offers Replace Key and Remove Key for the user's own stored key (section 4.15.5). (Superseded on 2026-11-20: "Not applicable with a server-side key.") |
| B29 | The timeline list has no delete gesture although the flat list has one. | SessionListView.swift:59-81 | The same row menu in every list. |
| B30 | The shared PDF file name only replaces `/`; a title containing a colon, question mark, quote, asterisk, angle bracket, vertical bar or backslash gives a name that is invalid on Windows. | PDFViewer.swift:36-38 | `safeFileName` in appendix 5.4 (the same rule as data-model.md B15 and web-platform.md B9). |

### 2.5 Rendering

| # | What the Apple app does | Evidence | Web app instead |
|---|---|---|---|
| B31 | Builds every message when a session opens, and loads every message in the vault before filtering to the session. | SessionDetailView.swift:16, :24-27, :31-45 | Load one session's messages; render as described in sections 4.7.4 and 4.7.5. |
| B32 | Code fences break with Windows line endings, with fences longer than three backticks and with one-line fences. | MessageView.swift:102-118; table in section 1.10.2 | The fence rules of section 4.7.1. |
| B33 | Inline Markdown changes technical text: `__init__` loses its underscores and turns bold, backslashes before punctuation vanish, and `[x](javascript:…)` becomes a link. | MessageView.swift:149-156; appendix 5.3 | The inline grammar of section 4.7.2 and the safety rules of 4.7.3. |
| B34 | An empty fenced block is drawn as an empty box with a Copy button. | MessageView.swift:92-96 | Skip code blocks whose text is empty or only white space. |
| B35 | A paragraph ends only at exactly two consecutive line breaks; a line holding spaces does not end it. | MessageView.swift:143-147 | A blank line may contain spaces and tabs. |
| B36 | A summary written by Summarize is long and contains code blocks (its prompt asks for every code block verbatim), but it is shown as raw text in a field of two to six lines. | SessionDetailView.swift:134-140, :196-198 | A reading state that draws the summary like a message, and an editing state (section 4.6.4, rule 6). |

### 2.6 Not user features

| # | What the Apple app does | Evidence | Web app instead |
|---|---|---|---|
| B37 | Three launch arguments for automation are compiled into the app. | RootView.swift:75-85; ImportSheet.swift:122-130 | Nothing. Tests navigate to routes. |

### 2.7 Added on 2026-11-20

| # | What the Apple app does | Evidence | Web app instead |
|---|---|---|---|
| B38 | The Copy button of a message and the Copy button of each code block inside it carry the same label, "Copy"; only macOS adds a tooltip to the first. A screen reader announces the same name for both (inference: not tested with VoiceOver). | MessageView.swift:34, :39-41, :174 | The visible label stays "Copy" on both; the accessible names are "Copy message" and "Copy code" (section 4.15.7). |
| B39 | A reply can be copied whole only after it is stored: the live bubble has no Copy button, and the text of a reply whose request fails is cleared from the screen. | ContinueChatView.swift:165-177, :299-303 | Text that arrived before a failure stays on screen and can be copied (section 4.6.7; section 4.15.7, rule 9). |

---

## 3. What the web app must do differently because it is a web app (C)

| # | Apple app | Web app | Where specified |
|---|---|---|---|
| C1 | A capture browser sheet shows the page; the user signs in inside it and presses Capture. | A web page cannot embed another site and read its content, so there is no capture browser. The link section always offers "open the link, copy, paste"; where the server supports it (capture.md, tier T3) it also offers a server-side capture of public share links with progress, review and failure states. | 4.5.6, 4.6.6 |
| C2 | The API key is typed into the app and kept in the Keychain. | Each user types their own Anthropic API key into a key screen. The server checks it, stores it encrypted and never sends it back; the screen shows only whether a key is saved, its last four characters and its status, and offers Replace and Remove. A user without a key gets a "Connect to Claude" block in place of the composer, and a dialog when Summarize is pressed; both lead to the key screen. (Superseded on 2026-11-20: "The key is a server secret: no key-entry screen.") | 4.15.5, 4.6.7 |
| C3 | Data is local: no loading, saving or failure states. | The vault is on the server. With the offline copy (the default) lists and sessions are read from the copy on the device, and every change goes into a queue that is sent in the background: states "not sent yet" and "not saved", and notices. Without the copy, and until its first sync has finished, every read crosses the network: skeletons, retry, a failure path, refresh when the window becomes visible again. | 4.10, 4.15.8 |
| C4 | No accounts. | Accounts for many users: sign-in and sign-out, an invitation step while sign-up is by invitation, account deletion. An expired session returns to sign-in and then back to where the user was. | 4.15.2, 4.15.3, 4.15.4 |
| C5 | Navigation state lives in the view. | Every screen has a URL; browser Back and the Android back gesture go up one level and close dialogs. Paths carry only opaque ids: no title, tag, search text or link may appear in a path or query string (web-platform.md 13.2). | 4.4 |
| C6 | System alerts, sheets, context menus, swipe actions. | Accessible dialogs and menus built from web primitives. No swipe actions (they collide with the browser's own back gesture). Every row has a visible "more" button; right-click is an extra on desktop. | 4.6.9, 4.8 |
| C7 | "Paste Transcript" reads the clipboard freely. | Reading the clipboard needs a user gesture and a permission or paste prompt (web-platform.md 6.1). A paste box is the main control and the button an extra; pasted text is held in memory and imported with a second press. | 4.6.6 |
| C8 | System share sheet for the context pack and the PDF. | `navigator.share` where it exists (not in desktop Firefox); "Download Context Pack" always. | 4.6.4 |
| C9 | PDFKit shows the stored original in a sheet. | "View Original" opens the PDF in a new browser tab; the browser's own viewer shows it. | 4.6.8 |
| C10 | Files can be dropped on the window on macOS and iPadOS. | Drag and drop only with a fine pointer. The page must cancel the browser's default handling of dropped files, or a stray drop navigates away from the app. | 4.8.4 |
| C11 | Command-I. | Ctrl+I on Windows, Linux and Android keyboards, Command-I on Apple keyboards. | 4.8.1 |
| C12 | System text styles follow the OS text size. | Sizes in `rem`; the layout must survive 200 % zoom and a larger default font. | 4.2, 4.9 |
| C13 | Semantic system colours and the system accent. | Explicit tokens for light and dark, switched by `prefers-color-scheme`, in static style sheets (the Content-Security-Policy of web-platform.md 11.4 forbids styles created at run time). | 4.2 |
| C14 | Native lists cope with eager rendering up to a point. | Browsers do not: windowing for the session list and chunked rendering for transcripts. | 4.7.4, 4.7.5 |
| C15 | Dates use the system locale through Foundation. | `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` with the browser locale. | 4.6.3 |
| C16 | The OS handles the notch and the keyboard. | `100dvh`, `env(safe-area-inset-*)`, a composer that stays above the on-screen keyboard, and 16 px inputs so iOS Safari does not zoom on focus. | 4.3, 4.8.5 |
| C17 | One app on one device. | The same vault can be open in several tabs and on several devices. Each device follows the server through the change feed of sync.md; lists and details follow each sync run. Where two devices disagree, the server decides by fixed rules, and the device whose change lost says so in a notice. | 4.10, 4.15.8 |
| C18 | Not applicable. | Installable app, share target, the offline copy and its indicators, update notice, settings, accounts and invitations, the Claude key screen, the model chooser. | 4.11, 4.15 |
| C19 | Not applicable. | Browser find-in-page, text selection and printing are expected to work in a transcript; the rendering technique is chosen to keep them. | 4.7.5 |
| C20 | The device calls Anthropic itself; a reply is lost if the request fails. | The server runs each Claude request with the signed-in user's own API key (claude-api.md): the interface needs a first-use notice, a confirmation for large requests, Stop, and states for replies that are still running, were cut off or were interrupted. | 4.6.7 |
| C21 | Added on 2026-11-20. A Copy button on every message bubble copies the stored text (section 1.10.1). | The same action on every message and every reply, in every layout, with the keyboard and from the offline copy; the clipboard is written inside the click handler. Code blocks keep their own button. | 4.15.7 |
| C22 | Added on 2026-11-20. One person's data on that person's own devices. | Many users on one server: every screen shows the signed-in user's vault only, and a record of another user looks exactly like one that does not exist. | 4.15.1 |
| C23 | Added on 2026-11-20. The models offered are a fixed list in the code (section 1.7.2). | The list comes from the server, and the user may type any other model id. | 4.15.6 |

Alternatives. `../HANDOFF.md` section 2 has decided against the first three; they are kept for the record and must not be built.

If instead there were one owner and one server-side key (what this document first assumed; not chosen): there would be no invitation step, no account deletion, no key screen and no model list of the user's own; sign-in would be the one-owner screen of 4.5.1 and 4.11.1; a missing key would be a matter of server set-up, shown as the "Claude Isn't Set Up" block that 4.5.7 used to draw. The offline copy and its notices would stay, because one person with several devices needs them just the same.

If instead the vault is stored only in the browser (IndexedDB, no server; not chosen): drop the sign-in screen; C3 shrinks to short local waits; the offline indicator only concerns Claude and link capture; "Export Vault" becomes the only backup, so settings must show when the last export was made and say that clearing site data deletes the vault.

If instead the key is kept in the browser (not chosen: each user's key is kept on the server, encrypted): keep the "Connect to Claude" screen of section 1.7.1 with one sentence changed ("The key is stored in this browser and sent only to api.anthropic.com."), and add Replace and Remove to settings. What this note asked for is now part of the main design in another form: a key screen with Replace Key and Remove Key (4.15.5).

If instead another front-end stack is chosen: nothing in part 4 depends on React. The tokens are plain CSS custom properties and the reference implementation in appendix 5.4 is plain JavaScript.

If instead the Apple app is retired: nothing changes here, except that "the same words as the Apple app" stops being a constraint.

---

## 4. Design handoff for the web app

Everything in this part is a specification written for the web app. It follows part 1 wherever the feature is the same, applies the corrections of part 2 and the constraints of part 3, and adds the web-only screens. Section 4.15 holds the screens and rules added on 2026-11-20 for the decided product (`../HANDOFF.md` section 2); where it differs from an earlier section of this part, 4.15 wins.

### 4.1 Principles

1. Content first. The transcript is the page; chrome is thin, neutral and stays out of the way. One accent colour. Provider colours appear only in chips and in the library's provider icons.
2. Quiet. No gradients, no decorative shadows, no borders around cards. Hairline separators, neutral washes for bubbles, shadows only on things that float (menus, dialogs).
3. Native-feeling. System fonts, the platform's own form controls (`<select>`, `<input type="date">`, the file picker), the OS light or dark appearance, the platform's back behaviour.
4. Same words. Where a feature is the same as in the Apple app, use its strings unchanged (part 1), including Title Case for titles and buttons. New strings follow the same style (section 4.13).
5. Nothing blocks reading. Imports, saves and Claude requests report progress in place; only destructive confirmations are modal.
6. No features beyond the Apple app except those listed in sections 4.11 and 4.15.
7. Free-form. The user asks their own questions of a model of their own choosing and takes the answer elsewhere. No preset questions, no prompt templates, no suggested replies, no output format imposed by the interface. Summarize is the one prepared action, and it runs only when it is pressed.
8. Everything can be copied whole. Every message, every reply and every code block has a copy action in every layout, by pointer, touch and keyboard.
9. Private by construction. A user sees their own vault and nothing else: no screen, count, search result, suggestion or error text depends on another user's data. A saved API key is never displayed.

### 4.2 Design tokens

All colour, type, spacing, radius and shadow values used by components come from these custom properties. Components contain no literal colours.

```css
:root {
  color-scheme: light dark;

  /* Fonts */
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Roboto Mono", "Liberation Mono", monospace;

  /* Type scale: font-size and line-height (weights are in the role table below) */
  --text-title: 1.375rem;      --leading-title: 1.25;     /* 22 px */
  --text-section: 1.25rem;     --leading-section: 1.3;    /* 20 px */
  --text-headline: 1rem;       --leading-headline: 1.35;  /* 16 px */
  --text-body: 1rem;           --leading-body: 1.55;      /* 16 px */
  --text-callout: 0.9375rem;   --leading-callout: 1.45;   /* 15 px */
  --text-subhead: 0.875rem;    --leading-subhead: 1.4;    /* 14 px */
  --text-caption: 0.8125rem;   --leading-caption: 1.35;   /* 13 px */
  --text-caption2: 0.75rem;    --leading-caption2: 1.3;   /* 12 px */
  --text-code: 0.875rem;       --leading-code: 1.5;       /* 14 px */

  /* Spacing */
  --space-0-5: 2px;
  --space-1: 4px;
  --space-1-5: 6px;
  --space-2: 8px;
  --space-2-5: 10px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  /* Radii */
  --radius-xs: 6px;      /* inline code, small controls */
  --radius-sm: 8px;      /* code blocks, inputs, buttons, menu items */
  --radius-md: 10px;     /* message bubbles, banners */
  --radius-lg: 14px;     /* dialogs, menus, cards */
  --radius-xl: 18px;     /* chat field */
  --radius-pill: 999px;  /* chips, round buttons */

  /* Sizes */
  --size-touch: 44px;        /* minimum hit area on touch screens */
  --size-control: 36px;      /* control height with a fine pointer */
  --size-control-lg: 48px;   /* large primary buttons */
  --size-topbar: 52px;
  --width-sidebar: 210px;    /* the Apple ideal width */
  --width-list: 320px;
  --width-drawer: 280px;
  --width-measure: 46rem;    /* maximum width of header and transcript */
  --width-dialog-sm: 400px;
  --width-dialog-md: 520px;
  --width-dialog-lg: 720px;

  /* Motion */
  --duration-fast: 150ms;
  --duration-base: 200ms;
  --ease-standard: cubic-bezier(0.42, 0, 0.58, 1);

  /* Layers */
  --z-sticky: 10;
  --z-drawer: 30;
  --z-dialog: 40;
  --z-menu: 50;
  --z-toast: 60;

  /* Colour roles: light */
  --color-bg: #FFFFFF;               /* list and detail panes, pages */
  --color-bg-sidebar: #F2F2F7;       /* library, backdrop of the sign-in card */
  --color-bar: rgba(255, 255, 255, 0.86);  /* sticky bars, with backdrop blur */
  --color-surface: #FFFFFF;          /* inputs on a pane */
  --color-surface-raised: #FFFFFF;   /* dialogs, menus, toasts */
  --color-hover: #F4F4F7;
  --color-selected: #E9E9EE;         /* selected row, active library item */
  --color-text: #1D1D1F;
  --color-text-secondary: #636366;
  --color-text-tertiary: #6E6E73;    /* hints and placeholders; only on bg, surface, surface-raised, field-bg */
  --color-text-disabled: #A1A1A6;
  --color-text-on-accent: #FFFFFF;
  --color-separator: #D8D8DC;        /* hairlines between rows and panes */
  --color-border-control: #87878C;   /* outlines of inputs and selects (3:1) */
  --color-accent: #0066CC;           /* links, accent text and icons */
  --color-accent-fill: #0066CC;      /* primary button background */
  --color-accent-fill-hover: #005BB8;
  --color-focus: #0066CC;            /* focus ring */
  --color-bubble-user: #EBF3FB;
  --color-bubble-other: #F7F7F8;     /* assistant, system, note, thinking */
  --color-code-bg: rgba(0, 0, 0, 0.06);    /* overlay on whatever bubble is below */
  --color-field-bg: #F5F5F7;         /* chat field, search field */
  --color-fill-neutral: #EFEFF0;     /* secondary buttons, date control */
  --color-danger: #D70015;
  --color-danger-fill: #D70015;
  --color-danger-wash: #FFEBEA;      /* error banner background */
  --color-success: #1F7A36;
  --color-warning: #A44A00;
  --color-pin: #C46200;
  --color-scrim: rgba(0, 0, 0, 0.32);
  --color-skeleton: #ECECEF;

  --provider-claude-fg: #A44A00;   --provider-claude-bg: #FFEFD9;
  --provider-chatgpt-fg: #006E82;  --provider-chatgpt-bg: #E0F3F7;
  --provider-gemini-fg: #0058B8;   --provider-gemini-bg: #D9EBFF;
  --provider-other-fg: #5F5F64;    --provider-other-bg: #EEEEEF;

  /* Elevation */
  --shadow-menu: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 6px 24px rgba(0, 0, 0, 0.14);
  --shadow-dialog: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 18px 60px rgba(0, 0, 0, 0.22);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #121214;
    --color-bg-sidebar: #1A1A1D;
    --color-bar: rgba(18, 18, 20, 0.86);
    --color-surface: #1C1C1F;
    --color-surface-raised: #242428;
    --color-hover: #1F1F23;
    --color-selected: #2E2E33;
    --color-text: #F5F5F7;
    --color-text-secondary: #A1A1A6;
    --color-text-tertiary: #98989D;
    --color-text-disabled: #636366;
    --color-text-on-accent: #FFFFFF;
    --color-separator: #38383D;
    --color-border-control: #75757A;
    --color-accent: #5AA9FF;
    --color-accent-fill: #0071E3;
    --color-accent-fill-hover: #0066CC;
    --color-focus: #5AA9FF;
    --color-bubble-user: #11243A;
    --color-bubble-other: #1E1E22;
    --color-code-bg: rgba(255, 255, 255, 0.08);
    --color-field-bg: #1C1C1F;
    --color-fill-neutral: #2A2A2F;
    --color-danger: #FF6961;
    --color-danger-fill: #D63030;
    --color-danger-wash: #381A1A;
    --color-success: #30D158;
    --color-warning: #FF9F0A;
    --color-pin: #FF9F0A;
    --color-scrim: rgba(0, 0, 0, 0.56);
    --color-skeleton: #26262A;

    --provider-claude-fg: #FF9F0A;   --provider-claude-bg: #463112;
    --provider-chatgpt-fg: #40C8E0;  --provider-chatgpt-bg: #1C3A41;
    --provider-gemini-fg: #5AA9FF;   --provider-gemini-bg: #102B48;
    --provider-other-fg: #AEAEB2;    --provider-other-bg: #2D2D30;

    --shadow-menu: 0 0 0 1px rgba(255, 255, 255, 0.10), 0 8px 28px rgba(0, 0, 0, 0.55);
    --shadow-dialog: 0 0 0 1px rgba(255, 255, 255, 0.10), 0 20px 64px rgba(0, 0, 0, 0.65);
  }
}
```

Notes on the tokens:

- The provider hues are the Apple ones (orange, teal, blue, grey; section 1.9). The light chip backgrounds are exactly what the Apple app draws (the system colour at 15 % over white); the light text colours are darkened until they reach 4.5:1 on those backgrounds. The dark values are Apple's dark system colours, except Gemini, which uses the lighter accent blue.
- Every text pair and every icon or outline pair listed in appendix 5.2 passes WCAG 2 AA (4.5:1 and 3:1). The lowest text ratio is 4.60:1 (accent on a selected row, light) and the lowest non-text ratio 3.18:1 (danger button on a raised surface, dark). Re-run the check if a value changes.
- `--color-text-tertiary` passes only on the backgrounds named in its comment. On a selected row or in the library use `--color-text-secondary`.
- The theme follows `prefers-color-scheme`. The Apple app has no appearance switch, so the web app has none either. Set `<meta name="theme-color">` to `#FFFFFF` (light) and `#121214` (dark) with `media` attributes.
- Under `forced-colors: active` (Windows high contrast) backgrounds disappear: give bubbles, chips, code blocks, banners and buttons a `1px solid transparent` border so that they keep an outline.
- A non-default root font size must scale everything: sizes are `rem`, widths that hold text are `rem` or fluid.
- Section 4.15 adds no token. The colour pairs it uses that were not part of the first check are computed in appendix 5.6.

Type roles:

| Role | Size and line-height tokens | Weight | Apple style | Used for |
|---|---|---|---|---|
| title | `--text-title` | 700 | `title2` bold | session title field, empty-state titles, sign-in name, dialog titles |
| section | `--text-section` | 700 | `title3` bold | timeline month headers, settings section headers |
| headline | `--text-headline` | 600 | `headline` | row titles, top-bar titles |
| body | `--text-body` | 400 | `body` | prose, inputs, library items, menu items, button labels |
| callout | `--text-callout` | 400 | `callout` | status and error texts, empty-state descriptions, thinking text |
| subhead | `--text-subhead` | 400 (600 for import section headers) | `subheadline` | row summary, import section headers |
| caption | `--text-caption` | 400 (700 for role labels, 600 for library section headers and field labels) | `caption` | meta lines, help texts, field labels, role labels, badges |
| caption2 | `--text-caption2` | 400 (600 in chips) | `caption2` | chips, row tags, code language, Copy, composer model line |
| code | `--text-code`, `--font-mono` | 400 | monospaced `callout` | code blocks and inline code |

Nothing is smaller than 12 px. Inputs, selects and text areas use `--text-body` (16 px) at every width; a smaller size makes iOS Safari zoom the page when a field gets focus.

Colour roles by use:

| Element | Tokens |
|---|---|
| primary text, titles | `--color-text` |
| meta lines, help texts, role labels of non-user messages, badges | `--color-text-secondary` |
| hints, placeholders, composer model line | `--color-text-tertiary` |
| links, row tags, "New Project…", accent icons, the User role label | `--color-accent` |
| primary button | `--color-accent-fill` with `--color-text-on-accent`; hover `--color-accent-fill-hover` |
| secondary button, date control | `--color-fill-neutral` with `--color-text` |
| plain button | transparent with `--color-accent` (or `--color-text` for "Cancel") |
| destructive menu item | `--color-danger` text; destructive dialog button `--color-danger-fill` with `--color-text-on-accent` |
| user bubble / other bubbles | `--color-bubble-user` / `--color-bubble-other` |
| code block and inline code background | `--color-code-bg` |
| input outline | `1px solid var(--color-border-control)` on `--color-surface`; chat and search fields use `--color-field-bg` with the same outline |
| focus | `outline: 2px solid var(--color-focus); outline-offset: 2px` on `:focus-visible` |
| pinned icon | `--color-pin` |
| tip text and warning icons | `--color-warning` |
| success icons | `--color-success` |
| error banner | `--color-danger-wash` background, `--color-danger` icon, `--color-text` text |
| provider chip | `--provider-<name>-bg` background, `--provider-<name>-fg` text and icon |
| library provider icon | `--provider-<name>-fg` |

Elevation:

| Level | Used for | Treatment |
|---|---|---|
| 0 | panes, rows, bubbles, cards in a page | no shadow; separation by `--color-separator` hairlines or a wash |
| 1 | sticky top bars, the composer bar | `--color-bar` with `backdrop-filter: saturate(180%) blur(20px)` (solid `--color-bg` where unsupported) and a hairline that appears once content has scrolled under it |
| 2 | menus, toasts | `--color-surface-raised`, `--radius-lg`, `--shadow-menu` |
| 3 | dialogs, the tablet drawer | `--color-surface-raised`, `--radius-lg`, `--shadow-dialog`, over `--color-scrim` |

Motion: transitions use `--duration-fast` for colour and opacity, `--duration-base` for things that move (banner, drawer, dialog). Under `prefers-reduced-motion: reduce` remove movement and the pulsing of the thinking dots (show three static dots) and keep only opacity changes.

### 4.3 Layout and responsive rules

| Layout | Condition | Panes | Library | Session list | Detail | Import, Continue |
|---|---|---|---|---|---|---|
| compact | width below 600 px, or height below 480 px | 1 | its own screen | its own screen | its own screen | full-screen pages |
| medium | width 600 to 1023 px and height at least 480 px | 2 | a drawer `--width-drawer` wide over the list, opened by a button in the list header | `--width-list` | the rest | centred dialogs |
| expanded | width at least 1024 px and height at least 480 px | 3 | `--width-sidebar`, always visible | `--width-list` | the rest | centred dialogs |

Rules:

1. Compact is stack navigation: library, then list, then detail, one route each (section 4.4). The app opens on the list for "All Sessions", one level in, as the Apple app does on iPhone. The top bar's leading control goes up one level and is labelled with the parent's title ("SessionVault" on the list, the list title on the detail); below 360 px only the chevron is shown.
2. The shell is `100dvh` high. In medium and expanded layouts each pane scrolls on its own (`overflow-y: auto; overscroll-behavior: contain`) and panes are divided by a 1 px `--color-separator` line. In the compact layout the document scrolls, except in the chat, which is a fixed-height column with its own scroller.
3. The detail content (header and transcript) has a maximum width of `--width-measure` and is centred in its pane when the pane is wider. Padding is `--space-4` in compact and `--space-6` otherwise.
4. The detail header adapts to the width of the detail pane, not of the window: use a container query on the pane. At 560 px and more, Provider, Project and Model share one row (Model at most 260 px wide, as in the Apple app) and Original date shares a row with the counts; below 560 px every field is on its own row.
5. Sticky elements: the list header (title, Import, search field) at the top of the list; the detail toolbar at the top of the detail; timeline month headers directly below the list header; the composer at the bottom of the chat.
6. Safe areas: add `env(safe-area-inset-top)` to top bars, `env(safe-area-inset-bottom)` to the composer and to the last element of each page, and the left and right insets to pane paddings. The viewport meta tag needs `viewport-fit=cover`.
7. The detail toolbar shows as many actions as fit, in the order of section 4.6.4, and moves the rest into an overflow menu from the end. Compact: Continue, Summarize, Pin, then overflow (as in screenshot 02). Expanded: all of them, with Download Context Pack in the overflow menu.
8. Dialog widths: New, Rename, confirmations `--width-dialog-sm`; Import `--width-dialog-md`; Continue `--width-dialog-lg`. A dialog never exceeds the viewport minus 32 px in either direction; its body scrolls. The dialogs added in section 4.15 name their size there.
9. Every layout must work at 320 px width and at 200 % browser zoom without horizontal scrolling of the page. Code blocks scroll horizontally inside themselves.
10. Right-to-left: use logical properties (`margin-inline`, `padding-inline`, `inset-inline`) throughout, and `dir="auto"` on message text and on the title, summary and tag fields.

### 4.4 Screen map and routes

The routes below are a suggestion that matches the layouts; where web-platform.md or capture.md fix a path (`/import`, `/share-target`), theirs is used. What matters to the design is that each line is a distinct address and that addresses carry nothing private: web-platform.md 13.2 allows only opaque ids in paths, because the hosting platform records request paths.

| Route | Screen | Compact | Medium and expanded |
|---|---|---|---|
| `/sign-in` | sign-in (4.15.2) | page | centred card |
| `/invite` | invitation entry and account creation (4.15.3; web-platform.md 11.10). A code that arrives in a link is in the fragment, `/invite#code=<code>`, never in the path or the query string. | page | centred card |
| `/recover` | setting a new password with a recovery code (4.15.2), in the same way: `/recover#code=<code>` | page | centred card |
| `/library` | library | page | redirects to `/sessions` (the library is a pane or drawer) |
| `/sessions` | session list. Query parameters select the filter: none, `view=pinned`, `view=timeline`, `project=<id>`, `provider=<claude, chatgpt, gemini or other>`. The tag filter and the search text are user content and go into the fragment, which is never sent to the server: `#tag=<tag>&q=<search text>`, both percent-encoded. | page | list pane; the detail pane shows "No Session Selected" |
| `/sessions/<id>` (the same query and fragment are kept) | session detail | page | detail pane beside the list |
| `/sessions/<id>/continue` | Continue with Claude | page | dialog over the detail |
| `/import` | Import Sessions; after a share from another app the same screen with the shared content first (4.11.3) | page | dialog over the current screen |
| `/settings` | settings | page | replaces list and detail panes |
| `/settings/claude-key` | the user's Anthropic API key (4.15.5) | page | dialog over settings |
| `/notices` | notices of the offline copy (4.15.8) | page | dialog over the current screen |

```
compact:   /library  ->  /sessions?...  ->  /sessions/<id>  ->  /continue
                              |
                              +->  /import        /library -> /settings

expanded:  [ library | /sessions?... | /sessions/<id> ]   dialogs: /import, /continue

signed out:  /sign-in  <->  /invite        /recover -> /sign-in
signed in:   /settings -> /settings/claude-key        any screen -> /notices
```

- Browser Back, the Android back gesture and Escape close a dialog route and return to the screen below it; on compact, Back goes up the stack. Opening a dialog pushes a history entry; closing it with its own button goes back one entry instead of pushing another.
- New Project, Rename Project and confirmation dialogs are not routes. "View Original" is a link to a file, not a screen (section 4.6.8).
- Typing in the search field replaces the current history entry; it does not add one per keystroke.
- Selecting a filter keeps the open session (as in section 1.1) and keeps the search text.
- When a screen needs sign-in, remember the requested address and return to it afterwards.
- Restore the list's scroll position and focus the row that was opened when the user comes back from a detail.
- `/sign-in`, `/invite` and `/recover` are the only screens shown without a signed-in user; every other route leads to `/sign-in` first (4.15.2).
- `/settings/claude-key` and `/notices` are dialog routes like `/import`: Back closes them.

### 4.5 Wireframes

Legend:

```
[imp] [pin] [...]      icon button (names in section 4.12)       [ Text ]      button
(spk Claude)           provider chip                              [Text     v]  native select
[Text             ]    text field with its placeholder or value   (Q)           search glyph
(ok) (!) (i) (o)       status icons: success, warning or error, information, spinner
```

Icon abbreviations: `tray` all sessions, `pin`, `cal` timeline, `dir` folder, `dir+` new project, `spk` sparkle, `msg` two bubbles, `dia` diamond, `?` other, `#` tag, `gear` settings, `imp` import, `doc` view original, `sum` summarize, `copy`, `share`, `...` more, `<` back, `x` close, `(^)` send.

Phone frames are about 360 px wide, desktop frames 1280 px. The wireframes show structure and reading order, not exact sizes; sizes come from the tokens. Strings are abbreviated with ASCII; the exact strings are in part 1 and section 4.13.

Added on 2026-11-20: `[Copy]` on the first line of a bubble is the copy-whole-message button of 4.15.7 (the `[Copy]` inside a code block copies the code only), and `(Copy)` is that button while it is disabled. Further icon abbreviations used in 4.15: `key` API key, `up` changes waiting to be sent, `bell` notices, `off` no connection.

#### 4.5.1 Sign-in

> **Superseded (2026-11-20)** by section 4.15.2, which has the sign-in for many users and its wireframes. The drawings below show the sign-in for one owner (a passphrase and an optional one-time code) that this document first assumed. Do not build from them. They are kept so that references to 4.5.1 still resolve; the card, its width and its place on the screen are unchanged.

Phone:

```
+----------------------------------------+
|                                        |
|                                        |
|               [app icon]               |
|              SessionVault              |
|     Your AI sessions, in one vault.    |
|                                        |
|  Passphrase                            |
|  [..............................    ]  |
|  Code                                  |
|  [123456                            ]  |
|  [             Sign In              ]  |
|                                        |
|  (!) That didn't work. Check your      |
|      details and try again.            |
|                                        |
+----------------------------------------+
```

Desktop: the same block as a card 360 px wide, centred horizontally and vertically on `--color-bg-sidebar`:

```
+--------------------------------------------------------------------------------------------+
|                                                                                            |
|                          +--------------------------------------+                          |
|                          |              [app icon]              |                          |
|                          |             SessionVault             |                          |
|                          |    Your AI sessions, in one vault.   |                          |
|                          |                                      |                          |
|                          |  Passphrase                          |                          |
|                          |  [..............................  ]  |                          |
|                          |  Code                                |                          |
|                          |  [123456                          ]  |                          |
|                          |  [            Sign In             ]  |                          |
|                          |                                      |                          |
|                          |  (!) error text when sign-in fails   |                          |
|                          +--------------------------------------+                          |
|                                                                                            |
+--------------------------------------------------------------------------------------------+
```

The Code field exists only when the server requires a one-time code (web-platform.md 11.1).

#### 4.5.2 Library (its own screen only on phones)

```
+----------------------------------------+
| SessionVault                           |
+----------------------------------------+
| Library                                |
| [tray] All Sessions                128 |
| [pin]  Pinned                        4 |
| [cal]  Timeline                        |
|                                        |
| Projects                               |
| [dir]  Bicycle repair          3 [...] |
| [dir]  Garden planning        12 [...] |
| [dir+] New Project...                  |
|                                        |
| Providers                              |
| [spk]  Claude                          |
| [msg]  ChatGPT                         |
| [dia]  Gemini                          |
| [ ? ]  Other                           |
|                                        |
| Tags                                   |
| [ # ]  compost                         |
| [ # ]  gears                           |
+----------------------------------------+
| [gear] Settings                        |
+----------------------------------------+
```

On desktop the library is the left column of 4.5.3. The Tags section is absent when no tag exists. A count of 0 shows no badge.

#### 4.5.3 Session list

Phone:

```
+----------------------------------------+
| [<] SessionVault  All Sessions   [imp] |
| [(Q) Search titles, summaries, tags  ] |
+----------------------------------------+
| (spk Claude)                [pin]      |
| Compost bin layout               [...] |
| Three-bay plan and turning schedule    |
| 3 hours ago . 42 turns                 |
| #compost  #garden                      |
+----------------------------------------+
| (dia Gemini)                           |
| Rear derailleur indexing         [...] |
| yesterday . 8 turns                    |
+----------------------------------------+
| (msg ChatGPT)                          |
| Seed starting calendar           [...] |
| 2 days ago . 1 turn                    |
+----------------------------------------+
|                                        |
+----------------------------------------+
```

Desktop (three panes; the list is the middle column, a selected session is shown at the right):

```
+--------------------------+--------------------------------+--------------------------------------------------------+
| SessionVault             | All Sessions             [imp] |       [doc] [spk] [sum] [pin] [copy] [share] [...]     |
|                          | [(Q) Search titles, summar..]  |--------------------------------------------------------|
| Library                  |--------------------------------| Compost bin layout                                     |
| [tray] All Sessions  128 | (spk Claude)          [pin]    |                                                        |
| [pin]  Pinned          4 | Compost bin layout       [...] | Provider        Project             Model              |
| [cal]  Timeline          | Three-bay plan and turning...  | [spk Claude  v] [Garden planning v] [claude-opus-5-5 ] |
|                          | 3 hours ago . 42 turns         | Tags                                                   |
| Projects                 | #compost  #garden              | [compost, garden                                     ] |
| [dir]  Bicycle repair  3 |--------------------------------| Summary                                        [edit]  |
| [dir]  Garden plann.. 12 | (dia Gemini)                   | Three-bay plan and turning schedule                    |
| [dir+] New Project...    | Rear derailleur indexi.. [...] |                                                        |
|                          | yesterday . 8 turns            | (link) https://claude.ai/share/EXAMPLE-0000            |
| Providers                |--------------------------------| Original date [11/12/2026]                             |
| [spk]  Claude            | (msg ChatGPT)                  | imported Nov 12, 2026 . 42 turns                       |
| [msg]  ChatGPT           | Seed starting calendar   [...] |--------------------------------------------------------|
| [dia]  Gemini            | 2 days ago . 1 turn            | +--------------------------------------------------+   |
| [ ? ]  Other             |--------------------------------| | User                                      [Copy] |   |
|                          |                                | | How big should each bay be?                      |   |
| Tags                     |                                | +--------------------------------------------------+   |
| [ # ]  compost           |                                | +--------------------------------------------------+   |
| [ # ]  gears             |                                | | Assistant                                 [Copy] |   |
|                          |                                | | About one cubic metre each works well.           |   |
|                          |                                | | +----------------------------------------------+ |   |
|                          |                                | | | text                                  [Copy] | |   |
|                          |                                | | | bay = 1.0 x 1.0 x 1.0                        | |   |
|                          |                                | | +----------------------------------------------+ |   |
|--------------------------|                                | +--------------------------------------------------+   |
| [gear] Settings          |                                |                                                        |
+--------------------------+--------------------------------+--------------------------------------------------------+
```

The row "more" button `[...]` opens: Pin or Unpin, Move to Project, Delete. The selected row and the active library item use `--color-selected`.

Tablet (600 to 1023 px): list and detail side by side; the library is a drawer opened by the button at the left of the list header:

```
+--------------------------------+----------------------------------------+
| [lib] All Sessions       [imp] |          [doc] [spk] [sum] [pin] [...] |
| [(Q) Search titles, summar..]  |----------------------------------------|
|--------------------------------| Compost bin layout                     |
| (spk Claude)          [pin]    | Provider                               |
| Compost bin layout       [...] | [spk Claude                        v]  |
| 3 hours ago . 42 turns         | Project                                |
|--------------------------------| [Garden planning                   v]  |
| (dia Gemini)                   | ...                                    |
| Rear derailleur indexi.. [...] |----------------------------------------|
| yesterday . 8 turns            | +-----------------------------------+  |
|--------------------------------| | User                       [Copy] |  |
+--------------------------------+----------------------------------------+
```

#### 4.5.4 Timeline

Phone:

```
+----------------------------------------+
| [<] SessionVault    Timeline     [imp] |
| [(Q) Search titles, summaries, tags  ] |
+----------------------------------------+
| November 2026              2 sessions  |
+----------------------------------------+
| (spk Claude)                [pin]      |
| Compost bin layout               [...] |
| Three-bay plan and turning schedule    |
| Nov 12 . 42 turns                      |
+----------------------------------------+
| (msg ChatGPT)                          |
| Seed starting calendar           [...] |
| Nov 3 . 1 turn                         |
+----------------------------------------+
| August 2026                 1 session  |
+----------------------------------------+
| (dia Gemini)                           |
| Rear derailleur indexing         [...] |
| Aug 5 . 8 turns                        |
+----------------------------------------+
```

Desktop (middle column only; the other columns are as in 4.5.3):

```
+--------------------------------+
| Timeline                 [imp] |
| [(Q) Search titles, summar..]  |
+--------------------------------+
| November 2026      2 sessions  |
+--------------------------------+
| (spk Claude)          [pin]    |
| Compost bin layout       [...] |
| Three-bay plan and turning...  |
| Nov 12 . 42 turns              |
+--------------------------------+
| (msg ChatGPT)                  |
| Seed starting calendar   [...] |
| Nov 3 . 1 turn                 |
+--------------------------------+
| August 2026         1 session  |
+--------------------------------+
| (dia Gemini)                   |
| Rear derailleur indexi.. [...] |
| Aug 5 . 8 turns                |
+--------------------------------+
```

Month headers stick below the search field while their section scrolls. Rows show the original date (B14).

#### 4.5.5 Session detail

Phone:

```
+----------------------------------------+
| [<] All Sessions   [spk][sum][pin][...]|
+----------------------------------------+
| Compost bin layout                     |
|                                        |
| Provider                               |
| [spk Claude                         v] |
| Project                                |
| [Garden planning                    v] |
| Model                                  |
| [claude-opus-5-5                     ] |
| Tags                                   |
| [compost, garden                     ] |
| Summary                         [edit] |
| Three-bay plan and turning schedule    |
|                                        |
| (link) https://claude.ai/share/EXAM... |
| Original date             [11/12/2026] |
| imported Nov 12, 2026 . 42 turns       |
+----------------------------------------+
| +------------------------------------+ |
| | User                        [Copy] | |
| | How big should each bay be?        | |
| +------------------------------------+ |
| +------------------------------------+ |
| | Assistant                   [Copy] | |
| | About one cubic metre each works   | |
| | well.                              | |
| | +------------------------------+   | |
| | | text                  [Copy] |   | |
| | | bay = 1.0 x 1.0 x 1.0        |   | |
| | +------------------------------+   | |
| +------------------------------------+ |
+----------------------------------------+
```

The `[...]` overflow holds, in this order: View Original (only when an original exists), Copy Context Pack, Share Context Pack (only where sharing exists), Download Context Pack. The header scrolls away with the transcript; the top bar stays.

Desktop: the right column of 4.5.3. With nothing selected the pane shows the block drawn in 4.5.13.

#### 4.5.6 Import

Phone (a full-screen page):

```
+----------------------------------------+
| Import Sessions                 [Done] |
+----------------------------------------+
| [compass] From Link                    |
| [https://claude.ai/share/...         ] |
| [Name (optional - auto-detected fr..]  |
| [         Capture Transcript         ] |
| [Open Link]  Or open the link, copy    |
| the whole conversation and paste it    |
| below. The link is saved with it.      |
|                                        |
| [folder] From Files                    |
| [    Import .md / .json / .txt...    ] |
| Supports transcripts from Pull-AI-     |
| Context-Sessions, ChatGPT data exports |
| (conversations.json), and plain        |
| markdown.                              |
|                                        |
| [clipboard] From Clipboard             |
| Provider             [Claude        v] |
| +------------------------------------+ |
| | Paste a transcript here            | |
| |                                    | |
| +------------------------------------+ |
| [          Paste Transcript          ] |
| The provider is detected from the      |
| transcript when possible. This picker  |
| only labels pastes that can't be       |
| identified.                            |
|                                        |
| (ok) Imported 2 sessions.              |
+----------------------------------------+
```

Desktop (a dialog 520 px wide over the dimmed app):

```
        +------------------------------------------------------------+
        | Import Sessions                                        [x] |
        +------------------------------------------------------------+
        | [compass] From Link                                        |
        | [https://claude.ai/share/...                             ] |
        | [Name (optional - auto-detected from the page)           ] |
        | [ Capture Transcript ]  [ Open Link ]                      |
        | Or open the link, copy the whole conversation and paste    |
        | it below. The link is saved with it.                       |
        |                                                            |
        | [folder] From Files                                        |
        | [ Import .md / .json / .txt... ]                           |
        | Supports transcripts from Pull-AI-Context-Sessions, ChatGPT|
        | data exports (conversations.json), and plain markdown.     |
        | Tip: you can also drag transcript files onto the window.   |
        |                                                            |
        | [clipboard] From Clipboard                                 |
        | Provider [Claude v]                                        |
        | +--------------------------------------------------------+ |
        | | Paste a transcript here                                | |
        | +--------------------------------------------------------+ |
        | [ Paste Transcript ]                                       |
        | The provider is detected from the transcript when          |
        | possible. This picker only labels pastes that can't be     |
        | identified.                                                |
        |                                                            |
        | (ok) Captured 42 turns from claude.ai.              [Open] |
        +------------------------------------------------------------+
        |                                                   [ Done ] |
        +------------------------------------------------------------+
```

"Capture Transcript" exists only where capture.md's server-side capture is switched on for the link's site; "Open Link" and its instruction exist always, once the field holds a link.

After a paste, the paste box is replaced by a summary; a result that needs a decision is shown as a review block in place of the status line:

```
+----------------------------------------+   +----------------------------------------+
| [clipboard] From Clipboard             |   | (!) This looks like a sign-in or       |
| Provider             [Claude        v] |   |     landing page, not a conversation.  |
| (i) Pasted text: 18,204 characters,    |   | +------------------------------------+ |
|     312 lines. Source: claude.ai       |   | | Welcome back                       | |
| [ Clear ]      [ Import Pasted Text ]  |   | | Sign in to continue                | |
+----------------------------------------+   | | ...                                | |
                                             | +------------------------------------+ |
                                             | [ Discard ]            [ Save Anyway ] |
                                             +----------------------------------------+
```

States of the From Link section (the status line appears under the buttons; all texts wrap):

```
 empty      no buttons, only the help text
 link       [ Open Link ] and the instruction; [ Capture Transcript ] where server capture is on
 not a link (!) That doesn't look like a link.
 tip        (i) Tip: in Claude, tap Share on the conversation and paste that share link
                instead - share links capture with no sign-in at all.
 working    (o) Loading page...                                              [ Cancel ]
 working    (o) Capturing... 18 turns so far                                 [ Cancel ]
 saved      (ok) Captured 42 turns from claude.ai - original saved as PDF.     [ Open ]
 review     the review block above, with the warning text of the capture
 failed     (!) <message for the failure code>                            [ Try Again ]
```

There is no capture browser screen in the web app (C1).

#### 4.5.7 Continue with Claude

Phone (a full-screen page; the composer stays above the on-screen keyboard):

```
+----------------------------------------+
| [x]  Continue with Claude   [model v]  |
+----------------------------------------+
| +------------------------------------+ |
| | User                        [Copy] | |
| | How big should each bay be?        | |
| +------------------------------------+ |
| +------------------------------------+ |
| | Assistant                   [Copy] | |
| | About one cubic metre each works   | |
| | well.                              | |
| +------------------------------------+ |
| +------------------------------------+ |
| | User                        [Copy] | |
| | And how often should I turn it?    | |
| +------------------------------------+ |
| +----------------------------+         |
| | ooo  Claude is thinking... |         |
| +----------------------------+         |
| (!) <error text>      [Try Again] [x]  |
+----------------------------------------+
|         [spk] Claude Opus 5.5          |
| [Continue the conversation...   ] (^)  |
+----------------------------------------+
```

Desktop (a dialog 720 px wide, height `min(88dvh, 900px)`):

```
    +----------------------------------------------------------------------+
    | Continue with Claude                 Model [Claude Opus 5.5 v]    [x]|
    +----------------------------------------------------------------------+
    | +------------------------------------------------------------------+ |
    | | User                                                      [Copy] | |
    | | How big should each bay be?                                      | |
    | +------------------------------------------------------------------+ |
    | +------------------------------------------------------------------+ |
    | | Assistant                                                 [Copy] | |
    | | About one cubic metre each works well.                           | |
    | +------------------------------------------------------------------+ |
    | +------------------------------------------------------------------+ |
    | | User                                                      [Copy] | |
    | | And how often should I turn it?                                  | |
    | +------------------------------------------------------------------+ |
    | +----------------------------+                                       |
    | | ooo  Claude is thinking... |                                       |
    | +----------------------------+                                       |
    | (!) <error text>                                    [Try Again] [x]  |
    +----------------------------------------------------------------------+
    |                         [spk] Claude Opus 5.5                        |
    | [Continue the conversation...                                ]  (^)  |
    +----------------------------------------------------------------------+
```

While a reply streams, the thinking bubble is replaced by a normal Assistant bubble that grows, and `(^)` becomes a Stop button. The error banner appears above the composer only when there is an error.

Variants of the last bubble, and the block that takes the composer's place while the signed-in user has no API key saved (both widths). The block was redrawn on 2026-11-20 (4.15.5). It supersedes the block titled "Claude Isn't Set Up", which told of a missing server key ("Claude is not set up on this server. Add an Anthropic API key to the server's secrets."). The bubble of a reply that was cut off lost its "Continue" button on the same day (4.6.7):

```
+----------------------------------------+   +----------------------------------------+
| +------------------------------------+ |   | +------------------------------------+ |
| | Assistant                   [Copy] | |   | | Assistant                   [Copy] | |
| | Turn it every two weeks, and       | |   | | ...and then cover the              | |
| | Stopped                            | |   | | This reply was cut off by the      | |
| +------------------------------------+ |   | | length limit.                      | |
+----------------------------------------+   | +------------------------------------+ |
                                             +----------------------------------------+

+----------------------------------------+
|                 [key]                  |
|           Connect to Claude            |
|     Add your Anthropic API key in      |
|        Settings to use Claude.         |
|            [ Add API Key ]             |
+----------------------------------------+
```

#### 4.5.8 Original (PDF)

The web app has no PDF screen of its own. "View Original" is a link that opens the stored PDF in a new browser tab, where the browser's own viewer provides scrolling, zoom, search, download and sharing (section 4.6.8). There is nothing to draw at either width. First release: no original is stored (`../HANDOFF.md` section 6; data-model.md 7.2), so the action does not appear yet.

#### 4.5.9 Dialogs and menus

The same at both widths: a card 400 px wide, or the screen width minus 32 px on a phone.

```
+----------------------------------+   +----------------------------------+   +----------------------------------+
| New Project                      |   | Rename Project                   |   | Summarize                        |
| Group sessions by what you're    |   | [Garden planning               ] |   | Replace the existing summary?    |
| working on.                      |   |            [ Cancel ] [ Rename ] |   |           [ Cancel ] [ Replace ] |
| [Project name                  ] |   +----------------------------------+   +----------------------------------+
| (!) A project with this name     |
|     already exists.              |
|            [ Cancel ] [ Create ] |
+----------------------------------+

+----------------------------------+   +----------------------------------+   +----------------------------------+
| Delete Session?                  |   | Delete Project?                  |   | Send a Large Request?            |
| "Compost bin layout" and its     |   | "Garden planning" will be        |   | This sends about 412,000 tokens  |
| transcript will be removed from  |   | removed. Its 12 sessions stay in |   | to Claude Opus 5.5 (roughly      |
| the vault. This can't be undone. |   | the vault with no project.       |   | $1.65).                          |
|            [ Cancel ] [ Delete ] |   |            [ Cancel ] [ Delete ] |   |              [ Cancel ] [ Send ] |
+----------------------------------+   +----------------------------------+   +----------------------------------+
```

The project-name error line appears only after the name was refused. The other confirmations (first use of Claude, a summary that was cut off, the fresh sign-in check before an export or an account deletion, signing out with unsent changes, removing the API key, deleting the account) have the same shape; their texts are in sections 4.13 and 4.15.

Menus (anchored to the button that opened them; on desktop the session and project menus also open on right-click):

```
 session row [...]            Move to Project >           project row [...]      detail [...] (narrow panes)
+--------------------------+   +----------------------+   +----------------+   +-----------------------+
| Pin                      |   | None                 |   | Rename...      |   | View Original         |
| Move to Project        > |   | Bicycle repair       |   | Delete         |   | Copy Context Pack     |
| Delete                   |   | Garden planning  (v) |   |                |   | Share Context Pack    |
|                          |   |                      |   |                |   | Download Context Pack |
+--------------------------+   +----------------------+   +----------------+   +-----------------------+
```

"Delete" is drawn in `--color-danger`. `(v)` marks the current project. "Pin" reads "Unpin" for a pinned session.

#### 4.5.10 Settings

> **Superseded (2026-11-20)** by section 4.15.4, which has the settings screen of the decided product and its wireframes. The drawings below show the first design: a key held by the server ("Claude is ready."), an offline copy that is off by default, and no account deletion. Do not build from them. They are kept so that references to 4.5.10 still resolve.

Phone:

```
+----------------------------------------+
| [<] SessionVault      Settings         |
+----------------------------------------+
| Claude                                 |
| (ok) Claude is ready.                  |
| Model              [Claude Opus 5.5 v] |
| Summarize uses Claude Opus 5.5.        |
|                                        |
| Offline                                |
| Keep an Offline Copy            ( o)   |
| Using 12 MB on this device.            |
|                                        |
| Export                                 |
| [           Export Vault            ]  |
| Downloads every session as one file.   |
|                                        |
| Install                                |
| [       Install SessionVault        ]  |
|                                        |
| About                                  |
| SessionVault for the web               |
| Version 0.1.0 (abc1234)                |
| Source code                      [ext] |
|                                        |
| Account                                |
| This device . active now               |
| Android phone . 2 days ago             |
| [        Sign Out Everywhere        ]  |
| [             Sign Out              ]  |
+----------------------------------------+
```

Desktop (the library stays; settings replace the list and detail panes, content 40rem wide):

```
+--------------------------+-----------------------------------------------------------------------------------------+
| SessionVault             | Settings                                                                                |
|                          |                                                                                         |
| Library                  | Claude                                                                                  |
| [tray] All Sessions  128 | (ok) Claude is ready.                                                                   |
| [pin]  Pinned          4 | Model                [Claude Opus 5.5    v]                                             |
| [cal]  Timeline          | Summarize uses Claude Opus 5.5.                                                         |
|                          |                                                                                         |
| Projects                 | Offline                                                                                 |
| [dir]  Bicycle repair  3 | Keep an Offline Copy on This Device   ( o)    Using 12 MB on this device.               |
| [dir]  Garden plann.. 12 |                                                                                         |
| [dir+] New Project...    | Export                                                                                  |
|                          | [ Export Vault ]   Downloads every session as one file.                                 |
| Providers                |                                                                                         |
| [spk]  Claude            | Install                                                                                 |
| [msg]  ChatGPT           | [ Install SessionVault ]                                                                |
| [dia]  Gemini            |                                                                                         |
| [ ? ]  Other             | About                                                                                   |
|                          | SessionVault for the web . Version 0.1.0 (abc1234) . Source code [ext]                  |
| Tags                     |                                                                                         |
| [ # ]  compost           | Account                                                                                 |
| [ # ]  gears             | This device . active now          Android phone . 2 days ago                            |
|                          | [ Sign Out Everywhere ]   [ Sign Out ]                                                  |
|                          |                                                                                         |
+--------------------------+-----------------------------------------------------------------------------------------+
```

#### 4.5.11 Share-target landing

A share from another app opens the Import screen with a first block "Shared to SessionVault". Phone, one variant per kind of shared content:

```
+----------------------------------------+   +----------------------------------------+
| Import Sessions                 [Done] |   | Import Sessions                 [Done] |
+----------------------------------------+   +----------------------------------------+
| [share] Shared to SessionVault         |   | [share] Shared to SessionVault         |
| https://claude.ai/share/EXAMPLE-0000   |   | Shared text: 18,204 characters,        |
| [Name (optional - auto-detected fr..]  |   | 312 lines                              |
| [         Capture Transcript         ] |   | +------------------------------------+ |
| [Open Link]  Or open the link, copy    |   | | User: How big should each bay be?  | |
| the whole conversation and paste it    |   | | Assistant: About one cubic metre.. | |
| below. The link is saved with it.      |   | | ...                                | |
| [ Discard ]                            |   | +------------------------------------+ |
+----------------------------------------+   | [Name (optional)                     ] |
| [compass] From Link                    |   | Provider             [Claude        v] |
| ...                                    |   | [ Discard ]      [ Import Shared Text] |
+----------------------------------------+   +----------------------------------------+
                                             | [compass] From Link                    |
                                             | ...                                    |
                                             +----------------------------------------+

+----------------------------------------+
| Import Sessions                 [Done] |
+----------------------------------------+
| [share] Shared to SessionVault         |
| 3 files                                |
| compost-notes.md              14 KB    |
| gear-ratios.txt                3 KB    |
| conversations.json           2.1 MB    |
| [ Discard ]         [ Import 3 Files ] |
+----------------------------------------+
| [compass] From Link                    |
| ...                                    |
+----------------------------------------+
```

Desktop: the same block at the top of the Import dialog of 4.5.6:

```
        +------------------------------------------------------------+
        | Import Sessions                                        [x] |
        +------------------------------------------------------------+
        | [share] Shared to SessionVault                             |
        | https://claude.ai/share/EXAMPLE-0000                       |
        | [Name (optional - auto-detected from the page)           ] |
        | [ Capture Transcript ]  [ Open Link ]          [ Discard ] |
        | Or open the link, copy the whole conversation and paste    |
        | it below. The link is saved with it.                       |
        +------------------------------------------------------------+
        | [compass] From Link                                        |
        | ...                                                        |
        +------------------------------------------------------------+
```

#### 4.5.12 Offline indicator, install prompt, update notice, drop overlay

Phone (the offline bar sits under the top bar of every screen; the install row sits at the bottom of the library; the update notice is a toast):

```
+----------------------------------------+   +----------------------------------------+
| [<] SessionVault  All Sessions   [imp] |   | ...                                    |
+----------------------------------------+   +----------------------------------------+
| (off) You're offline. Showing what was |   | Install SessionVault                   |
|       loaded before.                   |   | Add it to your home screen for         |
+----------------------------------------+   | quicker access.                        |
| [(Q) Search titles, summaries, tags  ] |   |              [ Not Now ] [ Install ]   |
| ...                                    |   +----------------------------------------+
+----------------------------------------+   | [gear] Settings                        |
                                             +----------------------------------------+

+----------------------------------------+
| A new version is available. [Reload]   |
+----------------------------------------+
```

Desktop (offline bar across the top of the window; install row above Settings in the library; drop overlay over the whole window while files are dragged over it):

```
+--------------------------------------------------------------------------------------------------------------------+
| (off) You're offline. Showing what was loaded before; changes can't be saved until you're back online.             |
+--------------------------------------------------------------------------------------------------------------------+

+--------------------------+-----------------------------------------------------------------------------------------+
| ...                      |                                                                                         |
|--------------------------|   + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +   |
| Install SessionVault     |   |                              Drop Files to Import                               |   |
| [ Not Now ] [ Install ]  |   |                           .md, .json or .txt transcripts                        |   |
|--------------------------|   + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +   |
| [gear] Settings          |                                                                                         |
+--------------------------+-----------------------------------------------------------------------------------------+
```

The place and shape of the bar, the install row and the drop overlay stand. The wording of the bar is superseded by section 4.15.8 (2026-11-20): changes made offline are saved on the device and sent later, so the bar no longer says that they cannot be saved.

#### 4.5.13 Empty, loading and error states

Phone, empty vault (first run):

```
+----------------------------------------+
| [<] SessionVault  All Sessions   [imp] |
| [(Q) Search titles, summaries, tags  ] |
+----------------------------------------+
|                                        |
|                [tray]                  |
|          Your Vault Is Empty           |
|  Save AI conversations three ways:     |
|  share or paste a conversation, import |
|  .md / .json / .txt transcript files,  |
|  or capture a public share link.       |
|                                        |
|              [ Import ]                |
|                                        |
+----------------------------------------+
```

Desktop, empty vault (first run):

```
+--------------------------+--------------------------------+--------------------------------------------------------+
| SessionVault             | All Sessions             [imp] |                                                        |
|                          | [(Q) Search titles, summar..]  |                                                        |
| Library                  |--------------------------------|                                                        |
| [tray] All Sessions      |                                |                        [msg]                           |
| [pin]  Pinned            |             [tray]             |                 No Session Selected                    |
| [cal]  Timeline          |      Your Vault Is Empty       |     Import a session or pick one from the list.        |
|                          |  Save AI conversations three   |                                                        |
| Projects                 |  ways: share or paste a        |                                                        |
| [dir+] New Project...    |  conversation, import files,   |                                                        |
|                          |  or capture a share link.      |                                                        |
| Providers                |                                |                                                        |
| [spk]  Claude            |           [ Import ]           |                                                        |
+--------------------------+--------------------------------+--------------------------------------------------------+
```

Other states use the same centred block in the same place (texts in section 4.10):

```
 list, no search results      (Q)     No Results for "<query>"        Check the spelling or try a new search.
 list, empty filter           [pin]   No Pinned Sessions              ...
 list, loading                six skeleton rows (grey bars in the shape of a row), no text
 list, failed                 (!)     Couldn't Load Sessions          ...                    [ Try Again ]
 detail, loading              skeleton title, skeleton fields, three skeleton bubbles
 detail, no messages          [msg]   No Transcript                   ...
 detail, not found            (!)     Session Not Found               ...                    [ All Sessions ]
```

### 4.6 Component inventory

Names are suggestions. Props are written in TypeScript form; field names follow the Apple model in camelCase and must be mapped to the names of data-model.md (its interchange schema uses `model`, `source_url`, `is_pinned`, `created_at` for the original date, `imported_at`, `project_id`).

Dialogs: prefer the native `<dialog>` element with `showModal()`, which gives a focus trap, Escape and an inert page without a library. Any component library must work under the Content-Security-Policy of web-platform.md 11.4, which forbids `<style>` elements created at run time: test dialogs, menus and tooltips against the production build with the policy enforced. All visuals come from the tokens, in static CSS files.

Components, types and props added on 2026-11-20 for section 4.15 are listed in 4.15.11.

#### 4.6.1 Shared types

```ts
type ProviderId = "claude" | "chatgpt" | "gemini" | "other"; // any other stored value is shown as "other"
type Role = "user" | "assistant" | "system" | "unknown";      // any other stored value is shown as "unknown" ("Note")

type Filter =
  | { kind: "all" } | { kind: "pinned" } | { kind: "timeline" }
  | { kind: "project"; projectId: string }
  | { kind: "provider"; provider: ProviderId }
  | { kind: "tag"; tag: string };

interface SessionListItem {
  id: string; title: string; provider: ProviderId; summaryPreview: string; tags: string[];
  isPinned: boolean; createdAt: string; importedAt: string; messageCount: number;
  projectId: string | null; hasOriginal: boolean;
}

interface Status {
  kind: "success" | "warning" | "error" | "info" | "progress";
  text: string;
  action?: { label: string; run(): void };
}
```

Display names: providers "Claude", "ChatGPT", "Gemini", "Other"; roles "User", "Assistant", "System", "Note" (sections 1.9 and 1.10.1).

#### 4.6.2 Shell and navigation

| Component | Props | States and behaviour |
|---|---|---|
| AppShell | `layout: "compact" \| "medium" \| "expanded"`, `online: boolean`, `sync: SyncSummary`, `account: "active" \| "suspended"`, `notices: Notice[]` | Arranges panes per section 4.3. Hosts the status bar of 4.15.8 (it takes the place of the offline bar), the drop overlay, toasts and dialogs. Owns the window-level drag handlers (section 4.8.4). |
| TopBar | `title?: string`, `leading?: { label: string; href: string } \| "drawer"`, `actions: Action[]` | Sticky, `--size-topbar` high. A hairline appears once content is scrolled under it. Actions that do not fit move into an overflow menu. |
| LibraryNav | `counts: { all: number; pinned: number }`, `projects: { id; name; sessionCount }[]`, `tags: string[]`, `active: Filter` | Sections, order, icons and badges of section 1.2. Projects in the order of `projectComparator` (data-model.md 8.4), tags in the order the server returns. A badge of 0 is not drawn. The Tags section is omitted when there is no tag. If the active project is deleted or the active tag no longer exists, the filter becomes All Sessions. Loading: three skeleton rows under Projects. Failed: one line "Couldn't load." with "Try Again". Footer: the sync row when it has something to say (4.15.8), the install row when eligible (4.11.2), then "Settings". |
| LibraryItem | `icon`, `label`, `badge?: number`, `active: boolean`, `iconColor?`, `menu?: MenuItem[]` | Height `--size-control` with a fine pointer, `--size-touch` otherwise. States: default, hover (`--color-hover`), focus-visible, active (`--color-selected`, `aria-current="page"`), pressed. Project items have a "more" button (and the same menu on right-click) with "Rename…" and "Delete". "New Project…" is a button that looks like an item, in `--color-accent`, weight 500. A project that has not been sent yet or was not saved carries the marker of 4.15.8. |

#### 4.6.3 Session list

| Component | Props | States and behaviour |
|---|---|---|
| SessionList | `filter: Filter`, `query: string`, `items: SessionListItem[]`, `status: "loading" \| "ready" \| "loadingMore" \| "error"`, `hasMore: boolean`, `selectedId?: string` | Filter, search and order rules of section 1.3.1 as data-model.md implements them (query trimmed; data-model.md 8.1). Timeline variant: `timelineGroups` of data-model.md 8.5. Windowed (section 4.7.5). States in section 4.10. |
| ListHeader | `title: string`, `onImport()` | The filter title (table in section 1.1), the Import icon button (tooltip and label "Import") and the search field. In the medium layout a leading button opens the library drawer. |
| SearchField | `value`, `onChange(value)`, `placeholder = "Search titles, summaries, tags"` | `type="search"`. A clear button when not empty; Escape clears. Wait 200 ms after the last keystroke before asking the server, and keep the previous results visible until the new ones arrive. With the offline copy the search runs on the device and needs no request (sync.md 2.4). |
| SessionRow | `item: SessionListItem`, `variant: "default" \| "timeline"`, `selected: boolean` | Lines of section 1.3.2 with four changes: an empty title shows "Untitled"; the summary line is `summaryLine(summaryPreview)` (appendix 5.4); the meta line is "`<relative import time>` · `<n>` turn(s)" in the default variant and "`<original date>` · `<n>` turn(s)" in the timeline, the date from `{ day: "numeric", month: "short" }`; "1 turn" is singular. The relative time comes from `relativeParts` (appendix 5.4), sits in a `<time datetime>` element with the full date as its `title`, and is refreshed once a minute. The whole row is one link; the "more" button is a sibling of the link, never inside it. Minimum height 64 px. States: default, hover, focus-visible, selected (`--color-selected`), pressed. A session that has not been sent yet or was not saved carries the marker of 4.15.8 at the end of its meta line. |
| ProviderChip | `provider: ProviderId` | Icon (12 px) and name, gap 3 px, padding 2 px by 7 px, `--radius-pill`, caption2 at weight 600, colours from the provider tokens. Not interactive. |
| TimelineHeader | `label: string`, `count: number` | Label in the section role, "`<n>` session" or "`<n>` sessions" in caption, secondary, at the trailing edge. Sticky. |
| EmptyState | `icon`, `title`, `description?`, `action?` | Centred block: icon 40 px in `--color-text-tertiary`, title in the title role, description in callout, secondary, at most 22rem wide, optional button. |

#### 4.6.4 Session detail

| Component | Props | States and behaviour |
|---|---|---|
| DetailToolbar | `hasOriginal: boolean`, `isPinned: boolean`, `summarize: "idle" \| "running"`, `copied: boolean`, `canShare: boolean`, `claudeConfigured: boolean` | Actions in this order: View Original (a link, only with an original; section 4.6.8), Continue with Claude, Summarize (keeps code intact), Pin or Unpin, Copy Context Pack, Share Context Pack (only when sharing is possible), Download Context Pack (always in the overflow menu). Icon buttons whose `aria-label` and tooltip are these labels. Pin has `aria-pressed`. Summarize states: section 4.6.7. Copy shows a check and the label "Copied!" for 2 s. `claudeConfigured` is true when the signed-in user has an API key saved (4.15.5). |
| SessionHeader | `session`, `projects: { id; name }[]` | The fields of section 1.4.2. Title has no visible label (`aria-label="Title"`, placeholder "Title"). Provider, Project, Model, Tags, Summary and Original date have a small visible label above the control (B13). Rules below. |
| Transcript | `messages`, `pending?: { phase: "thinking" \| "streaming"; text: string }` | Bubbles in index order with `--space-3` between them (the Apple detail uses 16 points and the Apple chat 12; use 12 px in both so that they look the same). Empty: the "No Transcript" state. Rendering rules in section 4.7. |

Rules for SessionHeader:

1. Title, Model and Summary are saved 600 ms after the last keystroke and on blur. Provider, Project and Original date are saved on change. Tags are saved on Enter and on blur with `parseTags` of data-model.md 8.2 (trim, lower-case, drop a leading `#`, drop empties and repeats), then the field is rewritten as the tags joined by `, `.
2. The screen changes at once (optimistic). With the offline copy (the default) the change is written to the queue on the device in the same step and sent in the background: it is not lost when a request fails, and the cases in which the server refuses it are told in a notice (4.15.8). Without the copy, a failed save shows an error banner at the top of the detail, "Couldn't save your changes." with "Try Again", and the typed values stay. When the device cannot store the change, the text of 4.15.8, part (g), is shown instead.
3. Pending saves are flushed when the route changes and on `pagehide`.
4. An empty title is stored as typed and displayed as "Untitled" in lists.
5. Original date is an `<input type="date">`. Build the new instant from the picked local year, month and day plus the time of day of the old value. Never pass the "YYYY-MM-DD" string to `new Date()`: that is midnight UTC and shows the previous day west of Greenwich.
6. Summary has a reading state and an editing state, because Summarize writes long text with code blocks into it (B36):
   - empty: a text area two lines high with the placeholder; typing saves as in rule 1;
   - not empty and not being edited: the text is drawn with the rules of section 4.7 (paragraphs, inline markup, code blocks) in a box clipped to six lines, with "Show More" and "Show Less" when it is longer, and, beside the label, an "Edit Summary" icon button and a Copy button named "Copy summary" (4.15.7, rule 10);
   - editing (after "Edit Summary", or a click on the text): a text area that grows from two lines to 40dvh; leaving it saves and returns to the reading state.
7. The source link is shown only when the stored value parses as a URL with the scheme http or https; it opens in a new tab with `rel="noopener noreferrer"`, on one line with an ellipsis.
8. Provider is a native select with the four names; the provider icon in its colour sits before it. Project is a native select: "No Project", then the projects in library order.
9. The counts line reads "imported `<date>` · `<n>` turn(s)", the date from `Intl.DateTimeFormat(locale, { dateStyle: "medium" })`.

Context pack actions (the text is `contextPackMarkdown` of data-model.md 8.3, built in the browser from the loaded session):

| Action | Behaviour |
|---|---|
| Copy Context Pack | Call `navigator.clipboard.writeText` inside the click handler, with no request in between (web-platform.md 6.1). On failure show the toast "Couldn't copy. Your browser blocked clipboard access." |
| Share Context Pack | Shown only when `navigator.share` exists. Share a file named `context-pack.md` when `navigator.canShare({ files })` accepts it; if not, try the same text as `context-pack.txt`; if neither is accepted, share as `{ title, text }` only when the pack has at most 100,000 characters; otherwise hide the action. A cancelled share (`AbortError`) is not an error. (Chromium is believed to refuse `.md` files in shares, and Android share targets to fail on very long text; both unverified.) |
| Download Context Pack | Always available: saves `safeFileName(title, ".md")` (appendix 5.4). |

Without a connection the three actions need the whole transcript on the device; otherwise they are disabled with "Connect to load the whole transcript first." (4.15.8).

#### 4.6.5 Messages

| Component | Props | States and behaviour |
|---|---|---|
| MessageBubble | `role: Role`, `text: string`, `segments`, `streaming?: boolean`, `incomplete?: "truncated" \| "cancelled"` | Full width, padding `--space-3`, `--radius-md`. Label and background by role (section 1.10.1): User in `--color-accent` on `--color-bubble-user`; the others in `--color-text-secondary` on `--color-bubble-other`. The label shares a header row with the Copy button of the message, which copies `text` whole (4.15.7). Blocks inside are separated by `--space-2`. A reply that claude-api.md marks as incomplete has a last line in caption, secondary: "Stopped" for `cancelled`, "This reply was cut off by the length limit." for `truncated`. |
| ProseBlock | `paragraphs: { text: string; continues: boolean }[]` | Each paragraph is built from `parseInline(text)`. `white-space: pre-wrap; overflow-wrap: anywhere; dir="auto"`. Body role. Gap `--space-2` between paragraphs, no gap before a piece with `continues`. |
| CodeBlock | `language: string \| null`, `code: string` | Header (padding 6 px top, 10 px sides): the language in caption2, secondary, and a "Copy" button (caption2, secondary, icon `copy`). Body: `<pre><code>` in `--font-mono` at `--text-code`, padding `--space-2-5`, no wrapping, horizontal scrolling, `tabindex="0"`. Background `--color-code-bg`, `--radius-sm`. After a press the button reads "Copied" with a check for 1.5 s. Its accessible name is "Copy code" (4.15.7). No syntax colouring. |
| InlineCode | | `--font-mono`, 0.9em, `--color-code-bg`, `--radius-xs`, padding 0 by 4 px. |
| AttachmentBlock | `attachment` | data-model.md allows segments of type `attachment`; the Apple app never creates them. Image types on its allow-list: an `<img>` with `max-width: 100%`, `loading="lazy"` and the file name as `alt`, loaded only from the app's own origin. Other types: one row with a file icon, the file name, the size and a download link. |
| UnsupportedBlock | `type: string` | A segment of an unknown type: one muted line "Unsupported content (`<type>`)". |

#### 4.6.6 Import

The Import screen keeps the Apple structure (three sections, a status line, "Done"). What each section does on the web follows capture.md (tiers T1 to T3), web-platform.md 6 and import-rules.md.

| Component | Props | States and behaviour |
|---|---|---|
| ImportPanel | `pendingShares`, `capture: CaptureConfig`, `onDone()` | Title "Import Sessions"; an optional first block for shared content (4.11.3); the three sections; one status line at the bottom that each new result replaces; "Done". Leaving the panel cancels a running capture. |
| From Link section | | Link field: `type="url"`, `inputmode="url"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`, placeholder "https://claude.ai/share/…". Name field. The field holds a link when `looksLikeLink` of capture.md 8.1 accepts it. Then: "Open Link" (an anchor to the link, new tab, `rel="noopener noreferrer"`) with the instruction "Or open the link, copy the whole conversation and paste it below. The link is saved with it."; the link becomes the source link of the next paste, and a "Source: `<host>`" note appears in the paste summary. The app itself never requests the link. Where server capture is switched on for the link's provider: also a primary button "Capture Transcript" (states below and in 4.15.10, which adds the "not enabled" state and the wording for Claude Code session links). The tip of section 1.5 appears when the link belongs to a known provider but is not one of its public share links (data file of capture.md 7.1); for Claude it is the Apple sentence, for others "Tip: share the conversation in `<Provider>` and paste that share link instead — share links need no sign-in." |
| Server capture (inside From Link) | `captureId`, `status`, `stage`, `turnsSoFar` | Press: the button is disabled at once (B25) and a progress line appears with "Cancel". Progress text by stage of capture.md 8.3: queued "Waiting to start…"; `loading` "Loading page…"; `waiting_for_content` "Waiting for the conversation…"; `extracting` "Capturing… `<n>` turns so far"; `processing` "Cleaning up…". "Cancel" deletes the capture; nothing is saved (B24). Done without warnings: saved at once, status "Captured `<n>` turns from `<host>`." (with " — original saved as PDF." when a snapshot was stored, and " — original saved as PDF (first screen only)." when capture.md reports that the snapshot is not the whole page), action "Open", both fields cleared. Done with warnings: the review block. Failed: the message of the table below, with "Try Again" for `busy`, `rate_limited`, `navigation_failed`, `timeout` and `internal_error`. First release: no snapshot is stored (`../HANDOFF.md` section 6), so the two endings about a PDF are not used. The states "not enabled", "needs sign-in" and "connection lost" are in 4.15.10. |
| From Files section | | The button opens `<input type="file" multiple accept=".md,.markdown,.txt,.json,text/plain,text/markdown,application/json">`. While files are read and saved: "Importing `<k>` of `<n>`…" with "Cancel". Size warnings as web-platform.md 6.2 proposes: a confirmation "This transcript is very large (`<size>`). Import it anyway?" before a session above its text limit. Result texts as in section 1.5. The drag hint is shown only with a fine pointer. A vault file in the interchange format is imported here too (data-model.md). Without a connection the sessions are saved on the device and marked "Not sent yet"; a vault file needs a connection (4.15.8). |
| From Clipboard section | | Provider select (default Claude). A paste box (a text area three lines high, label and placeholder "Paste a transcript here") is the main control; "Paste Transcript" calls `navigator.clipboard.readText()` and is an extra (web-platform.md 6.1). Both lead to the same state: the text is kept in memory, never put into the field, and the box is replaced by the summary "Pasted text: `<n>` characters, `<m>` lines." (plus "Source: `<host>`" when the link field holds a link), with "Clear" and the primary button "Import Pasted Text". A paste that is only a link is not imported: it is put into the link field, the From Link section gets focus, and the info status says so. If the clipboard cannot be read: focus the paste box and show "Your browser didn't allow clipboard access. Paste into the box instead." |
| ReviewBlock | `warnings: string[]`, `droppedTurns: DroppedTurn[]`, `preview: string`, `turnCount: number` | For a result that needs a decision (import-rules.md C8, capture.md 7.4): the warning sentences (tables below), a read-only preview of the first 12 lines (at most 600 characters), "`<n>` turn(s)", and the buttons "Discard" and "Save Anyway". Nothing is stored until "Save Anyway" (for `sign_in_suspected` it repeats the import with the override that import-rules.md defines). A result without warnings is saved at once, as in the Apple app. 4.15.9 extends the block: turns that the importer left out are listed and can be restored before the save. |
| ImportReport | `files: { name; sessions?: number; reason?: string; notes?: string[] }[]` | After an import of several files (import-rules.md C9): the status line gives the total, and a "Details" disclosure lists each file with "`<n>` session(s)" or its reason, plus any note. For one file the status line alone is enough. Files that wait for a review: 4.15.9. |
| StatusNotice | `status: Status` | Icon by kind: success `circle-check` in `--color-success`; warning `triangle-alert` in `--color-warning`; error `triangle-alert` in `--color-danger`; info `lightbulb` in `--color-warning`; progress a spinner. Text in callout, wrapping. `role="status"`, or `role="alert"` for errors. The action "Open" is offered when exactly one session was created. |

Wording for the results of the import module (import-rules.md leaves wording to this document). `<file>` is the file name; for a paste the sentence starts without it.

| Outcome or reason | Message |
|---|---|
| imported | "Imported `<n>` session." / "Imported `<n>` sessions."; for a paste "... from clipboard." (the Apple strings) |
| `link` | "That's a link — it's now in the From Link field." |
| `empty_input` | file: "`<file>` is empty."; paste: "Clipboard is empty." (the Apple string) or "There is nothing to import." |
| `undecodable` | "`<file>` is not a text file." |
| `unrecognised_json` | "`<file>` is not a known chat export." with the action "Keep as a Note", which imports the text as it is |
| `no_messages` | one file or a paste: "No sessions found in the selected files." (the Apple string); in a report: "no messages found" |
| `no_conversation_found` | "No conversation content captured from the page." (the Apple string, ImportSheet.swift:145) |
| `sign_in_suspected` | the review block with "This looks like a sign-in or landing page, not a conversation." |

| Note on a result | Sentence |
|---|---|
| `decoded_as_utf_16le`, `decoded_as_utf_16be` | "`<file>` was read as UTF-16." |
| `decoded_as_windows_1252` | "`<file>` is not UTF-8 and was read as Windows-1252. Check accented letters." |
| `dropped_turns` | Superseded on 2026-11-20: no longer a note after saving ("`<n>` turn(s) at the start or end looked like page furniture and were left out." with a "Show" disclosure). A result with dropped turns is reviewed before it is saved, and each turn can be restored (4.15.9). |
| a possible duplicate (import-rules.md C10) | Superseded on 2026-11-20: no longer shown in the review block ("A session from this link with the same number of turns is already in the vault."). Both sessions are kept, and the notice `duplicate_import` of 4.15.8 says so after the save, with a way to delete the new one (sync.md 7, case 10). |

Wording for the codes of capture.md 7.5 (capture.md leaves the wording to this document):

| Failure code | Message |
|---|---|
| `url_not_allowed` | "This link can't be captured from here. Open it and paste the conversation instead." |
| `provider_disabled` | "Capture isn't switched on for `<Provider>` links yet. Open the link and paste the conversation instead." (the "not enabled" state of 4.15.10) |
| `busy` | "Another capture is still running. Wait for it to finish." |
| `rate_limited` | "Too many captures. Try again later." |
| `navigation_failed` | "The page couldn't be loaded." |
| `redirect_off_allowlist` | "The link led to a different site, so the capture was stopped." |
| `sign_in_required` | "That link needs a sign-in, so nothing was saved. Use a public share link, or open it yourself and paste the conversation." |
| `blocked_by_site` | "The site refused an automated visit. Open the link yourself and paste the conversation." |
| `no_conversation_found` | "No conversation content captured from the page." (the Apple string, ImportSheet.swift:145) |
| `timeout` | "The capture took too long and was stopped." |
| `too_large` | "The page is too large to capture." |
| `cancelled` | no message |
| `internal_error` | "Capture failed. Try again." |

| Warning code | Sentence in the review block |
|---|---|
| `sign_in_suspected` | "This looks like a sign-in or landing page, not a conversation." |
| `page_text_only` | "No turn structure was found; the page text will be saved as one block." |
| `partial` | "The capture may be incomplete." |
| `index_gaps` | "Some turns may be missing." |
| `several_indexed_lists` | "The page had several lists; the largest one was used." |
| `turn_count_dropped_while_scrolling` | "The page unloads turns while scrolling; some may be missing." |
| `scroller_did_not_move` | "The page did not scroll; later turns may be missing." |
| `bottom_not_settled` (added on 2026-11-20; capture.md 7.5) | "The page was still changing when the capture ended; the last turns may be missing." |

#### 4.6.7 Continue with Claude and Summarize

claude-api.md defines the requests, the outcomes (its C7) and the error codes with their fixed messages (its C8). This section defines only how they look. Every request runs with the signed-in user's own API key (4.15.5). The models offered are the server's list plus any model id the user has typed (4.15.6); the wireframes use "Claude Opus 5.5" as an example.

| Component | Props | States and behaviour |
|---|---|---|
| ContinueChat | `session`, `config: { configured; models; defaultModel }` | Body: Transcript with the pending bubble, notices, the composer. Opens scrolled to the end. States in the table below. |
| ModelSelect | `models: { id: string; name: string }[]`, `value`, `onChange` | Superseded on 2026-11-20 by the ModelChooser of 4.15.6: the same native select labelled "Model", with a last option "Other Model…" that takes any model id. Its first value and what is remembered are defined there. |
| Composer | `value`, `streaming: boolean`, `modelName: string` | Model line: `sparkle` and the model name, caption2, tertiary, centred. Text area growing from 1 to 5 lines, placeholder "Continue the conversation…", `--color-field-bg`, 1 px `--color-border-control`, `--radius-xl`, padding 9 px by 14 px. Send button: round, 34 px visible in a 44 px hit area, `--color-accent-fill` with a white `arrow-up` when there is text, `--color-text-disabled` otherwise. While a reply is in flight it is a Stop button (icon `square`, label "Stop") and the field stays editable but cannot send. The field is free-form: no preset questions, no suggestions, no templates (4.1, principle 7). |
| ThinkingBubble | `text = "Claude is thinking…"` | Three dots (7 px, gap 5 px, opacity 0.3 to 1, 600 ms ease in and out, 200 ms stagger) and the text in callout, secondary, on `--color-bubble-other`. |
| ErrorBanner | `text: string`, `details?: string`, `onDismiss()`, `action?` | `--color-danger-wash`, `--radius-md`, padding `--space-3`: a `triangle-alert` icon in `--color-danger`, the text in callout (wrapping), an optional "Details" disclosure with the upstream message and request id, an optional action, a dismiss button labelled "Dismiss". `role="alert"`. Enters with opacity and an 8 px rise over `--duration-base`. |

Chat states:

| State | From claude-api.md | What is shown |
|---|---|---|
| not set up | `configured` is false: the signed-in user has no API key saved | The transcript stays. The "Connect to Claude" block of 4.15.5 takes the composer's place: the title "Connect to Claude", the `not_configured` message of claude-api.md C8 and the button "Add API Key", which opens the key screen. (Superseded on 2026-11-20: the block titled "Claude Isn't Set Up", which told of a server without a key.) |
| key rejected | `keyStatus` is `rejected`, or a request fails with `auth_failed` | Before sending: a warning notice above the composer, "Anthropic rejected your API key the last time it was used.", with "Check Again" and "Replace Key"; the composer stays usable (claude-api.md C15.5). After a failed request: the error banner with the `auth_failed` message of claude-api.md C8 and the same two actions; the user's text returns to the composer. |
| first use on this device | its decision "Disclosure" | Once, before the first Continue or Summarize: a dialog "Send This Session to Claude?" with the text of section 4.13 and "Cancel" and "Continue". The acceptance is remembered in `localStorage` for the signed-in user only: sign-out removes it, so it never carries over to another user of the same browser (claude-api.md C14). |
| idle | | Composer enabled. |
| large request | `confirmation_required` | Dialog "Send a Large Request?": "This sends about `<n>` tokens to `<model name>`", plus " (roughly $`<x>`)" when an estimate is given. "Cancel", "Send". Confirmed once per open chat. |
| waiting | sent, no text yet | The user's bubble at once, then the thinking bubble. Stop is available. |
| streaming | `delta` events | An Assistant bubble that grows, drawn with the rules of 4.7 (B6), re-rendered at most once per animation frame. |
| another model answered | `fallback` event | An info notice above the composer until the next send: "`<to model>` answered instead of `<from model>`." |
| saved | outcome `saved` | The stored messages replace the pending bubbles. |
| cut off | outcome `truncated` | The stored bubble with the line "This reply was cut off by the length limit." The user writes the next message. (Superseded on 2026-11-20: a button "Continue" that sent "Please continue from where you left off." claude-api.md C17 allows no message that the user did not type.) |
| stopped | outcome `cancelled` | With text: the stored bubble with the line "Stopped". Without text: nothing is stored and the user's text returns to the composer. |
| refused or empty | outcomes `refused`, `empty` | The error banner with the text claude-api.md gives for the outcome; the user's bubble is removed and its text returns to the composer. |
| failed | `error` event or an error response | The error banner with the fixed message for the code, "Details", and "Try Again" when the error is retryable. The user's bubble is removed and its text returns to the composer; "Try Again" sends it again unchanged (the same turn id). Text that had arrived stays on screen under the label "Interrupted" until "Try Again" or "Dismiss"; it is not stored. A send that is refused because a turn is already running shows the `turn_in_progress` message and switches to "still working". |
| still working | the turn route reports `running` when the chat opens, or the stream was lost | The pending user bubble and a thinking bubble with "Claude is still working…"; the app polls as claude-api.md describes. |
| unfinished earlier | the turn route reports `failed` or `interrupted` | A banner "The last reply didn't finish." with "Retry" and "Discard". |
| offline | | The composer is disabled with "You're offline." |
| not sent yet | the session's create still waits in the queue, or the session is a kept record (sync.md 11, rule 4) | The composer is disabled with "Available once this session has been sent." |

Other chat rules:

1. Follow the output only while the user is within 80 px of the end. If the user scrolls up, stop following until they come back to the end.
2. Leaving the chat does not stop the reply (claude-api.md C5); the detail behind the chat shows the new turns when they are stored.
3. Stop calls the stop route and keeps reading until the final event.
4. The chat is free-form. There are no preset questions, no prompt templates, no suggestion chips, no follow-up buttons that send text, and no output format imposed by the interface. The app never sends a message that the user did not type (claude-api.md C17).
5. Every stored message of the chat has the Copy button of 4.15.7, the reply included as soon as it is stored.

Summarize states (toolbar button and detail pane):

| State | From claude-api.md | What is shown |
|---|---|---|
| not set up | `configured` is false: the signed-in user has no API key saved | The button stays enabled. A press opens a dialog titled "Summarize" with the `not_configured` message of claude-api.md C8, "Cancel" and "Add API Key", which opens the key screen (4.15.5). (Superseded on 2026-11-20: a disabled button.) |
| key rejected | a request fails with `auth_failed` | The error banner at the top of the detail with the `auth_failed` message of claude-api.md C8, "Check Again" and "Replace Key" (4.15.5). The action stays available while the key's status is `rejected`. |
| replace? | `summary_exists` | Dialog titled "Summarize" with "Replace the existing summary?", "Cancel" and "Replace" (B20). |
| large request | `confirmation_required` | The same dialog as in the chat. |
| running | | A spinner replaces the icon, `aria-busy="true"`, the label becomes "Cancel Summarize" and a press stops it. The state survives leaving the session: on return the turn route says whether it is still running. |
| saved | outcome `saved` | The Summary field shows the new text; a toast "Summary updated." with "Undo", which restores the previous text. If the answer carries a previous summary that the user was not asked about (another device changed the summary while Claude worked; claude-api.md C5), the toast reads "Summary updated. An earlier summary was replaced.", with the same "Undo". |
| cut off | outcome `truncated` | Dialog titled "Summarize": "The summary was cut off by the length limit. Keep the partial summary?" with "Discard" and "Keep", and the plain button "Copy Draft" (4.15.7, rule 10). |
| refused, empty, failed | | An error banner at the top of the detail with the text claude-api.md gives ("This session has no messages to summarize." and "Claude returned no summary." are among them). |
| offline, or not sent yet | no connection; or the session is not on the server yet (sync.md 11, rule 4) | The button is disabled; tooltip and accessible description "You're offline." or "Available once this session has been sent." |

#### 4.6.8 Original

First release: attachment bytes are not stored and there are no byte routes (`../HANDOFF.md` section 6; data-model.md 7.2), so no session has an original yet and "View Original" does not appear. What follows is the design for when they are.

- "View Original" is an anchor with `target="_blank"` to the authenticated file address of web-platform.md 6.5, which serves the PDF inline. The browser's own viewer shows it. There is no in-app viewer: the Content-Security-Policy of web-platform.md 11.4 allows no frames, and phones do not reliably show PDFs in frames.
- If testing shows that the new tab is not signed in (an app installed to an iPhone home screen has its own cookies), fetch the file inside the app and hand it to `navigator.share({ files })` or to a download link instead.
- Do not draw these PDFs on a canvas with a JavaScript PDF library. The Apple app stores the whole page as one very tall page, up to 40,000 points (apple/SessionVault/WebCapture.swift:120-128), which is beyond canvas size limits (inference about the single page; unverified).
- The action exists only for sessions that have an original: server captures that stored a snapshot (capture.md 8.3) and Apple sessions whose PDF travelled through the interchange format (attachment kind `original_pdf`). When capture.md marks a snapshot as "first screen only", the tooltip reads "View Original (first screen only)".

#### 4.6.9 Overlays and controls

| Component | Props | States and behaviour |
|---|---|---|
| Dialog | `title`, `size: "sm" \| "md" \| "lg"`, `onClose()`, `footer?` | Modal over `--color-scrim`, `--shadow-dialog`, `--radius-lg`. Focus is trapped; the rest of the page is inert. Escape and the close button close it; a click on the scrim closes it unless a request is running inside. In the compact layout Import and Continue are full-screen pages with a top bar instead. |
| PromptDialog | `title`, `message?`, `placeholder`, `initialValue`, `confirmLabel` | New Project and Rename Project. The field has focus (its text selected for Rename). Enter confirms. The confirm button is disabled while the trimmed value is empty (the Apple alert closes and does nothing). A name that already exists, compared as data-model.md 8.4 defines, is refused with "A project with this name already exists." under the field. |
| ConfirmDialog | `title`, `message`, `confirmLabel`, `destructive: boolean` | `role="alertdialog"`. Focus starts on "Cancel". A destructive confirm button uses `--color-danger-fill`. |
| Menu | `items: { label; icon?; destructive?; checked?; submenu? }[]` | Anchored to its button, `--shadow-menu`, `--radius-lg`; items 36 px high (44 px on touch), at most 60 % of the viewport height, then scrolling. Arrow keys, Home, End, typeahead, Escape. "Move to Project" opens a second level with "None" and the projects, the current one checked. |
| Toast | `status: Status` | Bottom centre, above the composer and the safe area. Leaves after 4 s; a toast with an action stays 8 s; error toasts stay until dismissed. |
| Button | `variant: "primary" \| "secondary" \| "plain" \| "danger"`, `size: "default" \| "large"`, `busy?`, `disabled?` | Height `--size-control` with a fine pointer, `--size-touch` otherwise, large `--size-control-lg`; `--radius-sm`; body role at weight 500. States: default, hover, focus-visible, pressed (opacity 0.85), disabled (opacity 0.5), busy (a spinner replaces the icon, `aria-busy`, no second activation). |
| IconButton | `icon`, `label`, `pressed?` | Square, 36 px with a fine pointer, 44 px otherwise. `aria-label` and tooltip are the label. |
| TextField, TextArea, Select, DateField, Switch | `label`, `value`, `placeholder?`, `error?` | Visible label above (caption, weight 600, secondary). Text 16 px. 1 px `--color-border-control`, `--radius-sm`, background `--color-surface`. States: default, hover, focus-visible, disabled, invalid (outline and message in `--color-danger`, `aria-invalid`, `aria-describedby`). The switch is a native checkbox with `role="switch"`. |
| Skeleton | `shape` | Bars in `--color-skeleton` in the shape of the content; `aria-hidden`; no shimmer under reduced motion. |

### 4.7 Message rendering rules

Appendix 5.4 holds a tested reference implementation of 4.7.1, 4.7.2 and 4.7.4. The rules are stated here; where they differ from the Apple app the reason is the B item named.

data-model.md (its B14) and import-rules.md (its W13) mention a CommonMark library for this; web-platform.md 11.4 allows either a library or a small custom renderer; all three leave the choice to this document. The choice is the small renderer below. Reason: CommonMark's inline rules alter technical text that is not Markdown (the cases in the table of 4.7.2 were observed with Apple's CommonMark parser), and captured pages are plain text, not Markdown. A library may be used only if it is configured to produce exactly the golden results of appendix 5.4. The splitter of 4.7.1 is the fence rule of import-rules.md W13; `segmentText` reproduces all 22 cases of its fixture `fixtures/import/57-display-segments-table`.

#### 4.7.1 Splitting a text into prose and code

A message is a list of segments (data-model.md 6.3). For each text segment:

1. Replace `\r\n` and lone `\r` by `\n` (B32). Stored text should already be clean (data-model.md B13); the renderer must still tolerate it.
2. Walk the lines. A line that, after trimming spaces and tabs, consists of three or more backticks followed by text without any backtick opens a code block. Remember the number of backticks. The rest of the line, trimmed, is the language tag, or none; the label that is drawn is the first word of the tag.
3. Inside a block, a line that after trimming consists only of backticks, at least as many as the opening fence, closes it. Every other line is code, kept unchanged.
4. An unterminated block runs to the end of the text.
5. A block whose code is empty or only white space is still a segment, but it is not drawn (B34).
6. Lines outside blocks form prose. Prose that is only white space is dropped.
7. Paragraphs: a blank line (it may contain spaces and tabs) ends a paragraph (B35). Leading indentation of a paragraph is kept.

Differences from the Apple result for the inputs of section 1.10.2: Windows line endings and four-backtick fences work; a one-line fence stays prose (and becomes an inline code span); the label drawn for ` ```python title="a.py" ` is "python"; an empty block is not drawn. Everything else is identical, including that `~~~` fences are not recognised.

#### 4.7.2 Inline grammar for a paragraph

Scan the paragraph from left to right. At each position apply the first rule that matches; otherwise the character is plain text.

| # | Rule | Result |
|---|---|---|
| 1 | A backslash followed by one of `` ` * ~ [ ] \ `` | Both characters are shown as they are, and the second one cannot start or end markup. Nothing is ever removed from the text. |
| 2 | A run of n backticks, then text, then the next run of exactly n backticks (within 2,000 characters) | Inline code. One leading and one trailing space are removed when both exist. Nothing inside is markup. Without a closing run the backticks are text. |
| 3 | `[label](destination)` or `![label](destination)`; label at most 500 characters without `]` or a line break; destination without spaces, with at most one level of parentheses | A link when the destination starts with `http://`, `https://` or `mailto:` (any letter case). The label is plain text; an empty label shows the destination. An image is never loaded: it becomes a link. Any other scheme: the whole sequence stays text. |
| 4 | `http://` or `https://` not preceded by a letter or digit, up to the next white space, `<` or `>` | A link. Trailing `. , ; : ! ? ' "` and an unbalanced closing `)` or `]` are not part of it. |
| 5 | `***text***`, `**text**`, `*text*`, `~~text~~`: the opening run is not preceded by a letter or digit and not followed by white space; the closing run (the same character, the same length, within 2,000 characters) is not preceded by white space and not followed by a letter or digit | Bold and italic, bold, italic, strikethrough. The text inside is scanned again with these rules. Without a valid closing run the characters are text. |
| 6 | Underscores, single tildes, `#`, `>`, `-`, numbers, vertical bars, HTML tags | Always plain text. |

The paragraph is displayed with `white-space: pre-wrap`, so single line breaks, tabs and runs of spaces are kept (as in the Apple app).

How this differs from the Apple app, and why (all Apple results verified in appendix 5.3):

| Input | Apple app | Web app | Reason |
|---|---|---|---|
| `__init__`, `_private_var_` | "init" bold, "private_var" italic, underscores gone | unchanged text | identifiers in transcripts (B33) |
| `a*b*c`, `x**y**z` | italic b, bold y | unchanged text | expressions in transcripts |
| `~10 cm, ~20 cm`, `~single~` | struck through | unchanged text | single tildes mean "about" |
| `^\d+\.\d+$`, `C:\temp\*.txt` | backslashes before `.` and `*` removed | unchanged text | never alter technical text |
| `\*not italic\*` | "*not italic*" | `\*not italic\*`, not italic | the same rule, kept lossless |
| `[x](javascript:alert(1))` | a link with that address | plain text | safety (4.7.3) |
| `![alt](https://example.com/x.png)` | "alt" as text | "alt" as a link | nothing is loaded either way |
| `[label with **bold**](https://example.com/z)` | link "label with bold" | link "label with **bold**" | labels are plain text |
| `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, links, bare addresses, headings, lists, tables, HTML | as in section 1.10.3 | the same | |

Block-level Markdown (headings, lists, tables, quotes) stays literal, exactly as in the Apple app. Whether to render it is an owner decision.

#### 4.7.3 Safety rules

Transcripts, titles, summaries, tags, project names and model labels are text from other people's web pages and files. They are untrusted. These rules repeat web-platform.md 11.4 and data-model.md C12 for the renderer.

1. Build elements from the node lists. Never assign transcript-derived strings to `innerHTML`, `dangerouslySetInnerHTML`, `srcdoc`, `style` or an event attribute. Text that looks like HTML is displayed as text.
2. A link is created only for `http:`, `https:` and `mailto:` addresses, tested on the trimmed, lower-cased start of the value. This applies to links in messages and to the session's source link (http and https only). Every link gets `target="_blank"` and `rel="noopener noreferrer"`.
3. Nothing named by a transcript is ever fetched: no images, no previews, no favicons, no embeds.
4. Attachment images are loaded only from the app's own origin.
5. File names offered for download go through `safeFileName`.

#### 4.7.4 Long messages

The Apple app has no long-message handling (section 1.10.5). A capture that falls back to whole-page text is stored as one message (apple/SessionVault/WebCapture.swift:175-180), and such a message can be several hundred thousand characters long, up to about a million (data-model.md 7.4). The web app must not put that into one element.

1. `renderBlocks(text)` (appendix 5.4) turns a text into blocks: code blocks, and prose chunks of at most 6,000 characters made of whole paragraphs.
2. A paragraph longer than 6,000 characters is cut at line breaks into pieces; pieces after the first are marked `continues` and drawn directly under the previous piece without a paragraph gap, as `<div>` blocks, so that the look and the copied text do not change.
3. A single line longer than 50,000 characters is cut every 50,000 characters. Copying across such a cut adds a line break; nothing else is affected.
4. Nothing is collapsed, truncated or hidden behind "show more". Reading, selecting, copying and searching always cover the whole message.
5. Measured with the reference implementation on a desktop JavaScript engine: a message of 1,037,500 characters becomes 174 blocks in a few milliseconds, and all of its inline markup is parsed in about 15 ms.

#### 4.7.5 Where windowing is required

| List | Requirement | Technique |
|---|---|---|
| Session list (flat and timeline) | Windowed: only rows near the viewport exist in the page. A ChatGPT export creates one session per conversation (apple/SessionVault/Importers.swift:292-341), so one import can add thousands of rows. | A windowing library with measured row heights (rows are 64 to about 110 px; estimate 88 px) and, for the timeline, sticky group headers (for example react-virtuoso or TanStack Virtual). Load list items in pages; they carry no message text (data-model.md C4). Counts and the tag list come from their own queries, not from the loaded rows. Keyboard focus is tracked by item id, not by element. |
| Transcript (detail and chat) | Opening a session must never lay out, paint or parse the whole transcript in one step. Find-in-page, selection across messages and printing must keep working. | Default: put every block in the page, but give each block (prose chunk, code block, attachment) `content-visibility: auto; contain-intrinsic-size: auto 12rem`, so the browser skips layout and paint of blocks that are off screen while their text stays searchable and selectable. Mount the first 40 blocks at once and the rest in idle-time batches of 200. |
| Library, menus, project lists | No windowing. They scroll. | |

- `content-visibility` is supported by Chrome and Edge 85, Firefox 125 and Safari 18 (from memory, unverified). Older browsers ignore it and are slower but correct.
- Test with a synthetic stress session: 1,500 messages totalling 4,000,000 characters, one message of 1,000,000 characters without blank lines, one code block of 5,000 lines. Targets on a mid-range Android phone: first messages visible within 1 s of the data arriving, and no frame longer than 200 ms while scrolling. These targets are a proposal and were not measured.
- If the targets are missed, window the transcript too (the same library as the list, one item per block). That costs browser find-in-page and selection across distant messages; say so in the release notes.
- Scrolling the chat to the end on open: off-screen blocks have estimated heights, so set the scroll position to the end, then again on the next two animation frames (or scroll an end marker into view after each resize).
- The transcript of a very long session arrives in pages (data-model.md 7.4); show the skeleton until the first page arrives and append the rest.

#### 4.7.6 A reply that is still streaming

- The growing text goes through the same `renderBlocks` and `parseInline` once per animation frame. An unterminated fence is already a code block (rule 4 of 4.7.1), so code does not flicker between prose and code while it arrives.
- Only the last block changes between frames; keep the earlier blocks' elements.
- Announce to assistive technology only "Claude is thinking…" at the start and "Claude replied." at the end (section 4.9).
- The Copy button of the growing reply is disabled until the final event (4.15.7, rules 7 and 8).

### 4.8 Interaction notes

#### 4.8.1 Keyboard

| Keys | Where | Effect |
|---|---|---|
| Ctrl+I, or Command-I on Apple keyboards | anywhere outside a dialog | Opens Import. Call `preventDefault()`. |
| Escape | dialog, menu, drawer | Closes it. In the search field: clears the text. |
| Up, Down, Home, End | library, session list | Moves focus between items. Each of these lists is one Tab stop (roving `tabindex`). |
| Enter or Space | library item, session row | Opens it. |
| Delete or Backspace | focused session row | Opens the Delete Session confirmation. |
| Shift+F10 or the Menu key | focused row | Opens the row menu. |
| Enter | tags field | Saves the tags. |
| Enter | New Project, Rename Project | Confirms. |
| Enter and Shift+Enter | chat field, hardware keyboard | Send and new line. |
| Enter | chat field, on-screen keyboard | New line; the send button sends. |
| Tab, then Enter or Space | the Copy button of a message | Copies the whole message (4.15.7). The button is the first Tab stop inside each message. |
| Enter | sign-in, invitation, recovery, API key and "Model ID" fields | Submits the form. |
| Escape | "Model ID" row of the model chooser | Closes the row and restores the previous model. |

- Never send or confirm on Enter while an input method is composing (`event.isComposing`).
- There are no single-key shortcuts. Ctrl+F stays the browser's find.
- Treat a device as having an on-screen keyboard when `(pointer: coarse)` matches.

#### 4.8.2 Focus order

Expanded layout:

1. "Skip to content" link (visible only when focused; jumps to the detail).
2. Library (one stop), then "Settings".
3. List header: "Import", then the search field.
4. Session list (one stop). From a focused row, Tab reaches its "more" button.
5. Detail toolbar, left to right.
6. Title, Provider, Project, Model, Tags, Summary, source link, Original date.
7. Transcript in document order. Inside each message: its Copy button first, then links, the Copy buttons of code blocks and scrollable code blocks, then the repeated Copy button of a long message (4.15.7).

Compact layout: the top bar's leading control, the top bar's actions, then the content in the same order.

Dialogs: focus moves inside when they open (the first field; "Cancel" in confirmations; the chat field on desktop, the chat title on touch devices so that the keyboard does not open by itself). Tab cycles inside. On close, focus returns to the control that opened the dialog.

After an action: deleting a row moves focus to the next row (or the previous one, or the empty state). A route change in the compact layout moves focus to the new screen's heading.

#### 4.8.3 Touch

- With `(pointer: coarse)`, and always in the compact and medium layouts, every control has a hit area of at least 44 by 44 px: rows, library items, icon buttons, menu items, selects, the Copy buttons of messages and of code blocks (pad their hit areas), the send button. Chips are not interactive. Links inside running text are exempt.
- Keep at least 8 px between neighbouring targets.
- Nothing is available only on hover: tooltips repeat `aria-label`s, and row "more" buttons are always visible.
- No swipe actions and no long-press-only actions.
- Buttons that start a request are disabled until it settles (B25).

#### 4.8.4 Drag and drop

- On `dragenter` and `dragover` at window level: if `dataTransfer.types` contains `"Files"`, call `preventDefault()` and show the drop overlay.
- On `drop`: call `preventDefault()`, hide the overlay, import the files, then show a toast with the result ("Imported `<n>` session(s)." or "No sessions found in the dropped files.").
- Call `preventDefault()` for file drags in every state of the app, also on the sign-in screen and while a dialog is open. Otherwise the browser opens the dropped file and the app is gone.
- Only with a fine pointer.

#### 4.8.5 Phone browsers

- Viewport meta tag: `width=device-width, initial-scale=1, viewport-fit=cover` as in web-platform.md 4.3. Adding `interactive-widget=resizes-content` makes Chrome and Firefox shrink the layout when the on-screen keyboard opens (unverified version support); Safari ignores it, so also set the chat's height from `window.visualViewport.height` while the keyboard is open. The composer must stay visible and keep focus after a send.
- Use `dvh`, never `vh`, for full-height layouts.
- Inputs are 16 px (section 4.2).
- Set `-webkit-tap-highlight-color: transparent` and give pressed states instead.
- Leave pull-to-refresh to the browser in the document-scrolling screens; panes use `overscroll-behavior: contain`.
- On Android some file pickers grey out `.md` files when `accept` lists extensions (unverified). If that happens in testing, remove `accept` and check the extension after selection.

#### 4.8.6 Scrolling

- The detail opens at the top; the chat opens at the end.
- Returning from a detail restores the list position.
- Sticky bars must not cover focused elements: set `scroll-padding-top` to the bar height.

### 4.9 Accessibility requirements

Target: WCAG 2.2 level AA.

1. Structure. One `<main>` per screen. The library is `<nav aria-label="Library">`. The list pane is a `<section aria-label="Sessions">` with the search field in a `<search>` element or `role="search"`. Every screen has one `<h1>`: "SessionVault" (library), the filter title (list), the session title (detail; visually hidden, because the visible title is an input), "Import Sessions", "Continue with Claude", "Settings", "Anthropic API Key", "Notices", and "SessionVault" on the sign-in, invitation and recovery screens. Timeline months are `<h2>`. The transcript is a `<section aria-label="Transcript">`; each message is an `<article>` whose role label is an `<h2>` styled as the small label, so that screen-reader users can jump from turn to turn.
2. Names. Every icon-only control has an `aria-label` equal to its label: "Import", "View Original", "Continue with Claude", "Summarize (keeps code intact)", "Pin" or "Unpin", "Copy Context Pack", "Share Context Pack", "Edit Summary", "Copy message", "Copy code" and "Copy summary" (the visible label of each is "Copy"; 4.15.7), "Stop", "Dismiss", "Close"; row menus "More actions for `<title>`". The pinned icon in a row has the text alternative "Pinned". A badge is read as "`<n>` sessions". Decorative icons are `aria-hidden`.
3. States. `aria-current="page"` on the active library item and the selected row; `aria-pressed` on Pin; `aria-busy` on running buttons; `aria-expanded` and `aria-haspopup` on menu buttons; `aria-invalid` and `aria-describedby` on invalid fields.
4. Announcements. One polite live region for "Copied", "Summary updated.", import results and "Claude replied."; `role="alert"` for errors. The growing reply is not a live region. Section 4.15 adds "API key saved.", "API key removed." and "Model set to `<name or id>`." to the polite region; the status bar of 4.15.8 is a polite region of its own.
5. Focus. A visible ring on `:focus-visible` from the tokens; outlines are never removed; the order of section 4.8.2; dialogs trap focus and restore it.
6. Contrast. Use the tokens as paired in section 4.2. Do not dim text with opacity, except in disabled controls.
7. Not colour alone. Chips carry the provider name; status icons differ in shape and come with text; destructive items say "Delete".
8. Motion. Honour `prefers-reduced-motion` (section 4.2).
9. Zoom and reflow. Usable at 200 % zoom and at 320 px width without horizontal page scrolling; no fixed heights on containers that hold text.
10. Target size: section 4.8.3.
11. Language. `<html lang="en">`; `dir="auto"` on user content.
12. Forms. Visible labels; placeholders are hints only; errors are text next to the field.
13. Dialogs. `role="dialog"` or `role="alertdialog"`, `aria-modal="true"`, labelled by their title; the page behind is inert.
14. Code blocks. `<pre><code>` inside a focusable region (`tabindex="0"`, `role="region"`, `aria-label="Code"` plus the language) so that keyboard users can scroll them sideways.
15. Time. `<time datetime>`; relative times carry the full date in `title`.
16. Loading. Skeletons are `aria-hidden`; the pane has `aria-busy="true"` and a visually hidden "Loading".
17. High contrast. The transparent borders of section 4.2 keep shapes visible under `forced-colors`.
18. Page titles. `document.title` names the screen: "`<session title>` - SessionVault", "All Sessions - SessionVault" and so on.
19. The screens of section 4.15 carry their own accessibility notes. They add to this list and relax none of it.

### 4.10 Empty, first-run, loading and error states

List pane:

| Situation | Icon | Title | Description | Action |
|---|---|---|---|---|
| The vault has no session (filter All Sessions or Timeline, no search text) | `inbox` | "Your Vault Is Empty" | "Save AI conversations three ways: share or paste a conversation, import .md / .json / .txt transcript files, or capture a public share link." | "Import" |
| Pinned is empty | `pin` | "No Pinned Sessions" | "Pin a session to keep it at the top of every list." | none |
| A project is empty | `folder` | "No Sessions in This Project" | "Move sessions here from a session's menu or its Project field." | none |
| A provider has no session | the provider icon | "No `<Provider>` Sessions" | "Sessions from `<Provider>` will appear here." | none |
| The search finds nothing | `search` | `No Results for "<query>"` | "Check the spelling or try a new search." | none |
| First page loading | six skeleton rows | | | |
| More rows loading | a spinner row at the end | | | |
| Loading failed | `triangle-alert` | "Couldn't Load Sessions" | "Check your connection and try again." | "Try Again" |

Before phase 3, or while no provider is switched on for server capture (4.15.10), the first description reads "Save AI conversations two ways: share or paste a conversation, or import .md / .json / .txt transcript files."

Detail pane:

| Situation | Icon | Title | Description | Action |
|---|---|---|---|---|
| Nothing selected (medium and expanded) | `messages-square` | "No Session Selected" | "Import a session or pick one from the list." | none |
| Loading | skeleton title, fields and three bubbles | | | |
| The session has no message | `message-square-text` | "No Transcript" | "This session has no captured messages. Recapture the link or re-import the file." | none |
| The session does not exist | `triangle-alert` | "Session Not Found" | "It may have been deleted on another device." | "All Sessions" |
| Loading failed | `triangle-alert` | "Couldn't Load This Session" | "Check your connection and try again." | "Try Again" |
| A save failed | error banner | | "Couldn't save your changes." | "Try Again" |
| The transcript is not on this device and there is no connection (4.15.8) | `cloud-off` | "Transcript Not on This Device" | "Connect to the internet to load it." | none |

First run (first sign-in, empty vault): the list shows "Your Vault Is Empty" with "Import"; the library shows its three fixed rows without badges, "New Project…", the four providers and no Tags section; the detail pane shows "No Session Selected". There is no tour and no sample data. The install row is not shown yet (4.11.2). No screen asks for an API key at first run: the key is asked for when Claude is first used (4.15.5).

Other rules:

- Signed out in the middle of work: any request answered as "not signed in" leads to the sign-in screen in its "session ended" state (4.15.2), which also says how many changes wait on the device; afterwards the user returns to the same URL and the waiting changes are sent. If another user signs in on the device, everything of the first user is deleted from it first (sync.md 2.6).
- Stale data: with the offline copy a sync run starts when the app starts, when the connection returns, when the window becomes visible, after every change and every 60 seconds (sync.md 2.5); the list, the counts and the open session follow its result. Without the copy, refresh them at the same moments (web-platform.md 7.3). Do not move the scroll position or the focus. If the open session was deleted elsewhere, show "Session Not Found".
- Deleting the selected session shows "No Session Selected" (expanded) or goes back to the list (compact).

### 4.11 Web-only additions

#### 4.11.1 Sign-in screen

> **Superseded (2026-11-20)** by section 4.15.2 (sign-in and sign-out for many users) and 4.15.3 (invitation entry). The first paragraph and the table below describe the sign-in for one owner that this document first assumed: one passphrase and no registration. Do not build from them. Two things stand: the strings "That didn't work. Check your details and try again.", "Too many attempts. Wait a few minutes and try again.", "Can't reach the server. Check your connection." and "Your session ended. Sign in again to continue.", which 4.15.2 reuses; and the paragraph on the icon placeholder.

Wireframe 4.5.1. web-platform.md 11.1 recommends a sign-in built into the app: one passphrase, optionally a one-time code, no registration and no set-up page. Content: the app icon, "SessionVault", "Your AI sessions, in one vault.", the field "Passphrase" (`type="password"`, `autocomplete="current-password"`), the field "Code" only when the server requires it (`inputmode="numeric"`, `autocomplete="one-time-code"`), a large full-width primary button "Sign In", and one line for a message.

| State | What is shown |
|---|---|
| idle | the form; the first field has focus |
| submitting | the button is busy and cannot be pressed again |
| failed | "That didn't work. Check your details and try again." in `--color-danger` with `role="alert"` (the same text whichever field was wrong) |
| throttled | "Too many attempts. Wait a few minutes and try again." |
| unreachable | "Can't reach the server. Check your connection." |
| not set up | "Sign-in isn't set up on this server yet." (the server has no credentials configured) |
| session ended | above the form: "Your session ended. Sign in again to continue." |

After success go to the URL the user came from, else to the session list.

The repository has no icon artwork (section 1.12). Until the owner supplies one, use a placeholder: a rounded square in `--color-accent-fill` with the `inbox` glyph in white, at the sizes the manifest of web-platform.md 4.3 names. Manifest colours: `background_color` `#FFFFFF`; `theme_color` `#FFFFFF`, with the dark value `#121214` in a second `<meta name="theme-color">` tag.

Not chosen: if the vault were stored only in the browser, this screen would not exist.

#### 4.11.2 Install prompt

Only Chromium browsers (Chrome, Edge, Samsung Internet) fire `beforeinstallprompt`; Firefox and Safari do not (browser-compat-data 8.1.10; web-platform.md 4).

- Never a modal dialog and never on the sign-in screen.
- Show the install row at the bottom of the library (wireframe 4.5.12) only when all of these hold: the event was received; the app is not running installed (`(display-mode: standalone)` does not match); the vault has at least one session; the user has not pressed "Not Now" in the last 30 days (remember that in `localStorage`).
- Row: "Install SessionVault", then "Add it to your home screen for quicker access." on touch devices or "Add it to your desktop for quicker access." otherwise; buttons "Not Now" and "Install". "Install" calls the saved event's `prompt()`.
- Settings has an Install section with the same button when the event is available. Where it is not: on iPhone and iPad show "To install on iPhone or iPad: tap Share, then Add to Home Screen."; when the app is already installed show "SessionVault is installed on this device."; otherwise hide the section.

#### 4.11.3 Share-target landing

An installed app can receive links, text and files from the system share sheet: Chrome for Android 76, desktop Chrome and Edge 89 on Windows and ChromeOS, Samsung Internet 12; not Safari, not Firefox (web-platform.md 5.1). The Apple README names an iOS share extension as an idea for later (apple/README.md:35); this is the web counterpart. The service worker stores the share and redirects to the Import screen; web-platform.md 5.3 and capture.md 8.2 define that mechanism and the rule that decides whether a share is files, a link or text.

The landing is the Import screen with a first block "Shared to SessionVault" (wireframes 4.5.11):

| The share is | Block content |
|---|---|
| files | The file names and sizes; "Import `<n>` File(s)"; "Discard". The same importer and status texts as From Files. |
| a link | The link, the Name field (filled with the suggested title when the share brought one; the user can clear it), "Open Link" with its instruction, and "Capture Transcript" where server capture is on for that site; "Discard". It behaves like the From Link section. |
| text | "Shared text: `<n>` characters, `<m>` lines", a read-only preview of the first 12 lines (at most 600 characters), the Name field, the Provider select, "Import Shared Text", "Discard". It behaves like a paste; a result with warnings shows the review block. |
| nothing usable | Status "The share did not contain a link, text or files." |

- Several shares waiting: show the oldest first with "1 of `<n>`" beside the block title; after "Import" or "Discard" show the next.
- Not signed in: the share waits in the browser, in the database `sessionvault-inbox` (sync.md 8), and the block appears after sign-in. Signing out deletes waiting shares together with the offline copy (sync.md 2.6).
- Offline: shared text and shared files can be imported at once; the session is saved on the device and marked "Not sent yet" (4.15.8). For a shared link, "Open Link" stays and "Capture Transcript" is disabled with "You're offline." (Superseded on 2026-11-20: "its buttons are disabled" for every kind of share.)
- Errors the redirect can carry: too large "The shared files are too large to import this way."; not ready "Open SessionVault once so that it can receive shares, then share again."; other "The shared content could not be read. Try sharing again."
- After success the status line offers "Open"; "Done" goes to the session list.

#### 4.11.4 Offline indicator and update notice

> **Superseded (2026-11-20)** by section 4.15.8, except for the paragraph on the update notice, which stands. The first two paragraphs below describe a first version that was read-only without a connection. The decided product keeps an offline copy on each device and queues the changes made offline (sync.md), so edits, imports and deletions work offline. The bar keeps its place and look; its text and the list of what is disabled are in 4.15.8.

A bar under the top bar (compact) or across the top of the window (wireframe 4.5.12): icon `cloud-off`, text "You're offline. Showing what was loaded before; changes can't be saved until you're back online.", caption role on `--color-fill-neutral`, `role="status"`, not dismissible. It is shown while `navigator.onLine` is false or the last request failed for lack of a connection, and it disappears when a request succeeds again; then data is refreshed.

The first version is read-only while offline (web-platform.md 7.3). What can be read is what is in memory, plus the optional offline copy of section 4.11.5. Controls that need the server are disabled and explain why in their tooltip and accessible description ("You're offline."): capture, saving an import, Continue with Claude, Summarize, every edit, delete, New Project, Export. Copy Context Pack, Download Context Pack and the Copy buttons of code blocks keep working for a loaded session.

Update notice: when a new version of the app is ready, a toast "A new version is available." with "Reload" (web-platform.md 7.3). It is not shown while a reply is streaming or a capture is running, and it never reloads by itself. The reload also waits for a push of queued changes that is in flight (sync.md 9, rule 6).

Not chosen: if the vault were stored only in the browser, only capture, Continue and Summarize would be disabled while offline.

#### 4.11.5 Settings

> **Superseded (2026-11-20)** by sections 4.15.4 (settings, account, export, account deletion), 4.15.5 (the user's API key), 4.15.6 (models) and 4.15.8 (the offline copy). The table below describes the first design: a key held by the server and only reported on, a model choice kept on the device, an offline copy that is off by default, an export behind a passphrase check, and no account deletion. Do not build from it. Its Install row still points to 4.11.2.

Wireframe 4.5.10. Reached from the "Settings" item at the bottom of the library. Sections:

| Section | Content |
|---|---|
| Claude | A status line from the server's Claude configuration (claude-api.md C2 and C6): "Claude is ready." (key accepted); the `auth_failed` message (key rejected); "The server's Anthropic API key has not been checked yet." (unknown); the `not_configured` message (no key). The key itself is never shown. Select "Model": the model Continue with Claude starts with on this device; it is the same remembered choice as the chat's picker. One line "Summarize uses `<model name>`." for the server's Summarize model. |
| Offline | Switch "Keep an Offline Copy on This Device", off by default (web-platform.md 7.3). Help text: "Stores the session list and the sessions you open or pin on this device, so that you can read them without a connection. Signing out deletes the copy." While on: "Using `<size>` on this device." |
| Export | Button "Export Vault": downloads the whole vault in the interchange format of data-model.md. If the last passphrase check is too old (web-platform.md 11.2), a dialog "Confirm Your Passphrase" asks for it first. While the file is prepared the button is busy ("Preparing export…"); afterwards a toast "Export saved."; a failure shows an error banner. One line of help: "Downloads every session as one file." A vault file is imported through Import, From Files. |
| Install | Section 4.11.2. |
| About | "SessionVault for the web", the version and commit, a "Source code" link to the repository, and one sentence on privacy to be confirmed against web-platform.md and claude-api.md: "Your sessions are stored in this app's own database. Their text is sent to Anthropic only when you use Continue with Claude or Summarize." |
| Account | The signed-in browsers as web-platform.md 11.2 proposes: one line each with the device label and "active now" or the relative time last seen, the current one marked "This device"; "Sign Out Everywhere"; "Sign Out". Both sign out at once and show the sign-in screen. |

Not chosen (`../HANDOFF.md` section 2). If instead the key is kept in the browser: the Claude section has the key field of section 1.7.1 with "Save Key", "Replace" and "Remove". If instead the vault is stored only in the browser: the Offline and Account sections do not exist, and Export also shows the date of the last export and the sentence "This browser holds the only copy of your vault. Clearing site data deletes it."

### 4.12 Icon mapping

Lucide (https://lucide.dev), an open icon set of 24-pixel outline icons that use `currentColor`. Names are kebab-case; the React components of `lucide-react` are the same names in PascalCase (`messages-square` is `MessagesSquare`). Several icons were renamed over time; the older name is given in brackets and still works as an alias in most releases. The names were written from memory without access to the package (unverified): a wrong name fails at build time, so check each import once.

Sizes: 12 px in chips, 16 px in rows and buttons with text, 20 px in toolbars, 40 px in empty states. Stroke width 2 (1.75 at 40 px). SF Symbols with `.fill` have no filled Lucide twin: use the outline icon, except where noted. Bundle the icons with the app; the Content-Security-Policy allows no icon fonts or images from other sites.

| SF Symbol | Used for | Lucide icon |
|---|---|---|
| `square.and.arrow.down` | Import (RootView.swift:50) | `import` |
| `tray.full` | All Sessions (RootView.swift:121) | `inbox` |
| `tray` | empty vault (SessionListView.swift:90) | `inbox` |
| `pin` | Pinned filter, Pin action (RootView.swift:124; SessionDetailView.swift:79) | `pin` |
| `pin.fill` | pinned row marker, Unpin action (SessionListView.swift:152; SessionDetailView.swift:79) | `pin` with `fill="currentColor"`; for the Unpin action `pin-off` is also acceptable |
| `calendar.day.timeline.left` | Timeline (RootView.swift:127) | `calendar-days` |
| `folder` | project, From Files (RootView.swift:132; ImportSheet.swift:70, :79; SessionDetailView.swift:180) | `folder` |
| `folder.badge.plus` | New Project… (RootView.swift:153) | `folder-plus` |
| `number` | tag (RootView.swift:174) | `hash` |
| `sparkle` | Claude provider, Continue with Claude, composer model line (Models.swift:14; SessionDetailView.swift:62; ContinueChatView.swift:207) | `sparkle` |
| `bubble.left.and.bubble.right` | ChatGPT provider (Models.swift:15) | `messages-square` |
| `rhombus` | Gemini provider (Models.swift:16) | `diamond` |
| `questionmark.circle` | Other provider (Models.swift:17) | `circle-help` (`help-circle`; newest releases: `circle-question-mark`) |
| `bubble.left.and.text.bubble.right` | No Session Selected (RootView.swift:67) | `messages-square` |
| `text.bubble` | No Transcript (SessionDetailView.swift:37) | `message-square-text` |
| `doc.richtext` | View Original (SessionDetailView.swift:56) | `file-text` |
| `text.badge.checkmark` | Summarize (SessionDetailView.swift:70) | `list-check` |
| `doc.on.doc` | Copy Context Pack, Copy (SessionDetailView.swift:85; MessageView.swift:34, :174) | `copy` |
| `checkmark` | Copied (SessionDetailView.swift:85; MessageView.swift:34, :174) | `check` |
| `square.and.arrow.up` | Share Context Pack, Share PDF (SessionDetailView.swift:88; PDFViewer.swift:62) | `share` |
| `link` | source link (SessionDetailView.swift:201) | `link` |
| `safari` | From Link, Open and Capture (ImportSheet.swift:48, :64) | `compass` |
| `lightbulb` | tip (ImportSheet.swift:55) | `lightbulb` |
| `doc.on.clipboard` | Paste Transcript (ImportSheet.swift:90) | `clipboard-paste` |
| `clipboard` | From Clipboard (ImportSheet.swift:96) | `clipboard` |
| `checkmark.circle.fill` | success status (ImportSheet.swift:105; LinkCaptureView.swift:82) | `circle-check` (`check-circle-2`) |
| `exclamationmark.triangle.fill` | failure status, error banner (ImportSheet.swift:106; ContinueChatView.swift:181) | `triangle-alert` (`alert-triangle`) |
| `globe` | capture status while browsing (LinkCaptureView.swift:85); not needed on the web | `globe` |
| `lock.shield.fill` | Connect to Claude (ContinueChatView.swift:67); on the web the "Connect to Claude" block and the key screen (4.15.5) | `key-round` |
| `xmark.circle.fill` | dismiss the error banner (ContinueChatView.swift:189) | `x` |
| `arrow.up.circle.fill` | send (ContinueChatView.swift:229) | `arrow-up` in white on a round `--color-accent-fill` button |

Symbols the system adds on Apple platforms, and icons for the web-only parts:

| Purpose | Lucide icon |
|---|---|
| back | `chevron-left` |
| overflow and row "more" | `ellipsis` (`more-horizontal`) |
| select indicator, where a custom one is drawn | `chevrons-up-down` |
| search field | `search` |
| close | `x` |
| open the library drawer | `panel-left` |
| settings | `settings` |
| sign out | `log-out` |
| offline | `cloud-off` |
| install | `monitor-smartphone` |
| export, download | `download` |
| shared content block | `share-2` |
| edit the summary, rename in menus | `pencil` |
| delete, in menus | `trash-2` |
| stop a reply | `square` |
| open a link in a new tab | `external-link` |
| retry | `rotate-cw` |
| file row | `file` |
| spinner | `loader-circle` (`loader-2`) with a rotation, or a CSS spinner |

Icons for the parts added on 2026-11-20 are listed in 4.15.11.

### 4.13 Strings changed or added for the web

Every string of part 1 is used unchanged unless it appears here. Strings that another handoff document fixes (the outcome and error messages of claude-api.md C7 and C8) are not repeated.

Changed:

| Apple string | Web string | Why |
|---|---|---|
| "`<n>` turns" | "1 turn" / "`<n>` turns" | B1 |
| "Your Vault Is Empty" description (section 1.3.4) | section 4.10 | B2, C1 |
| New Project message | "Group sessions by what you're working on." | B3 |
| "https://claude.ai/code/session_…" | "https://claude.ai/share/…" | B4 |
| "Open & Capture Transcript…" | "Capture Transcript" (only where server capture exists), and always "Open Link" with "Or open the link, copy the whole conversation and paste it below. The link is saved with it." | C1 |
| "Public share links (claude.ai/share/…) capture with no login — that's the recommended flow. Press Capture Transcript once the conversation is visible, and it's saved as a formatted User/Assistant transcript." | With at least one provider switched on for server capture: "Public share links from `<the providers that are switched on>` capture with no login. For anything else, open the link, copy the conversation and paste it below." (4.15.10; it supersedes the sentence that named claude.ai/share only). With none: "A web page can't open another site for you. Open the link yourself, copy the conversation and paste it below." | C1 |
| "That looks like a sign-in or landing page — log in below (or wait for the conversation to appear), then press Capture again." | the `sign_in_required` and `sign_in_suspected` texts of section 4.6.6 | C1 |
| "Tip: you can also drag transcript files onto the main window." | "Tip: you can also drag transcript files onto the window." (fine pointer only) | C10 |
| "No need to pick first — the provider is detected automatically from links and transcript content. This picker only labels pastes that can't be identified." | "The provider is detected from the transcript when possible. This picker only labels pastes that can't be identified." | B5 |
| "That's a link — opening it in the capture browser." | "That's a link — it's now in the From Link field." | C1 |
| "Add your Anthropic API key first — open Continue with Claude to set it up." | the `not_configured` message of claude-api.md C8, in a dialog with the button "Add API Key" (4.6.7, 4.15.5) | C2 |
| "Claude declined this request (safety classifiers)." and "Claude returned no summary — it may have declined the request." | the outcome texts of claude-api.md C7 | claude-api.md |
| live reply label "Claude" | "Assistant" | B6 |
| "Share PDF" | not used; the browser's PDF viewer shares | C9 |
| "Model (e.g. claude-fable-5-1)", "Tags (comma separated)", "Summary — what makes this session important?" | labels "Model", "Tags", "Summary" with the placeholders "e.g. claude-fable-5-1", "comma separated", "What makes this session important?" | B13 |
| "Connect to Claude" screen (section 1.7.1) | The title "Connect to Claude" is kept for the block in the chat. The key itself is entered on the key screen (4.15.5), which keeps "Save Key" and the placeholder "sk-ant-…". "The key is stored in your Keychain and sent only to api.anthropic.com." becomes "The key is stored encrypted on this app's server, used only for your own requests and never shown again. The operator of this service can technically access what is stored." "Create a key at console.anthropic.com." becomes the advice of 4.15.5. | C2 |
| capture browser status texts (section 1.6) | the stage texts of section 4.6.6 | C1 |

Added. Most new strings are quoted where they are used (sections 4.6.3 to 4.6.9, 4.8.4, 4.10 and 4.11). The ones that appear nowhere else:

| Where | String |
|---|---|
| field labels | "Provider", "Project", "Model", "Tags", "Summary", "Original date" |
| link field, text that is not a link | "That doesn't look like a link." |
| drop overlay | "Drop Files to Import", ".md, .json or .txt transcripts" |
| delete session | "Delete Session?", "“`<title>`” and its transcript will be removed from the vault. This can't be undone.", "Cancel", "Delete" |
| delete project | "Delete Project?", "“`<name>`” will be removed. Its `<n>` session(s) stay in the vault with no project.", "Cancel", "Delete" |
| Claude, first use | title "Send This Session to Claude?"; text "Continue with Claude and Summarize send the whole stored transcript of the session, including sessions that came from other providers, to Anthropic through this app's server, with your own API key."; "Cancel", "Continue" |
| export, account deletion | "Confirm It's You", "Sign in again to continue.", "Cancel" (4.15.4). Superseded on 2026-11-20: "Confirm Your Passphrase", "Enter your passphrase to export the vault." |

The curly quotes around `<title>` and `<name>` in the two delete messages are U+201C and U+201D.

The strings added on 2026-11-20 are quoted in section 4.15, each in the table of its screen, and are not repeated here.

### 4.14 Acceptance checklist

1. At 360 px, 768 px and 1280 px the layouts match section 4.3, and nothing scrolls sideways except code blocks.
2. Browser Back closes dialogs and walks up the compact stack; every screen of section 4.4 can be reloaded on its own URL; no search text, tag, title or link ever appears in a path or query string.
3. Light and dark follow the OS setting; no literal colour appears outside the token file; the contrast check of appendix 5.2 passes for the shipped values.
4. All strings of part 1 appear unchanged except those in section 4.13; "1 turn" is singular.
5. The golden cases of appendix 5.4 pass in the shared TypeScript module.
6. A message containing `<img src=x onerror=alert(1)>` and `[x](javascript:alert(1))` shows both as text; no request leaves the page when a transcript is displayed; the app runs without violations under the Content-Security-Policy of web-platform.md.
7. The stress session of section 4.7.5 opens and scrolls within the targets, and browser find-in-page finds a word in its last message.
8. Every action works with the keyboard alone; focus is always visible; dialogs trap and restore focus.
9. With a screen reader, each turn is reachable by heading navigation and icon buttons announce the labels of section 4.9.
10. Deleting a session or a project asks first; Summarize asks before replacing a summary.
11. A double press on Capture, Import, Save Anyway or Send starts one request.
12. Dropping a file anywhere never navigates away from the app.
13. Typing tags and leaving the field saves them; typing a title and closing the tab at once does not lose it.
14. Offline: the bar appears; lists, transcripts that are on the device, copying, imports and edits work; what was done offline is marked as waiting and arrives on a second device after reconnecting; Claude, link capture, export and the key screen are disabled with an explanation (4.15.8).
15. On a phone the chat composer stays visible above the on-screen keyboard, and focusing a field does not zoom the page.
16. Two users on one server: nothing of one is ever visible to the other, in any list, count, search, notice or error text; a session id of the other user opens "Session Not Found"; signing in as a second user on the same device shows nothing of the first at any moment.
17. Sign-up needs an invitation. A refused invitation code and a failed sign-in each have one text, which does not tell whether a code or an address exists.
18. Every stored message has a Copy button at 320 px, 768 px and 1280 px. It puts exactly the stored text on the clipboard, also for a message of 1,000,000 characters and without a connection, and it can be reached and used with the keyboard alone. The button of a code block copies only its code.
19. A saved API key is never shown: no response, element of the page, storage area, address or log line of a test run contains the test key. The key screen shows whether a key is saved, its last four characters and its status; Check Again, Replace Key and Remove Key work; a key cannot be entered or changed without a connection.
20. The model chooser offers the registry models and the user's own, and accepts any other model id. An id that the user's key cannot use is refused when it is added, with the `model_unavailable` message; a request that fails with that code leaves the typed text in the composer.
21. The chat offers no preset question, suggestion or template, and no button sends text that the user did not type. Summarize runs only when it is pressed.
22. A change made offline raises the count of waiting changes; a session created offline shows "Not sent yet"; a create that the server refused shows "Not saved" with "Try Again".
23. Each case of sync.md section 7 that tells the user something produces its notice of 4.15.8, and none is raised for a deletion the device asked for itself.
24. A capture with dropped turns is not saved before the review. A restored turn is in the saved session; a turn that was left out is not.
25. A provider that is switched off for server capture shows the "not enabled" line and no capture button. A running capture shows its stage and can be cancelled.
26. Deleting the account asks for the typed word, removes the copy on the device and ends on the sign-in screen. Signing out with unsent changes asks first.
27. A code in `/invite#code=...` or `/recover#code=...` never appears in a request URL, and the fragment is gone from the address after the page has loaded.

### 4.15 Screens and rules added for the decided product

Added on 2026-11-20 for `../HANDOFF.md` sections 1 to 3: accounts with a private vault each, sign-up by invitation, each user's own Anthropic API key kept on the server, an offline copy on each device, free-form questions to a model of the user's choosing, and a copy action on every message. Every screen below has its states, its exact strings, a phone and a desktop wireframe, and its accessibility notes. Legend, tokens, components and layout rules are those of 4.2 to 4.6; nothing is restyled. Where this section and an earlier one differ, this section wins.

The routes, codes and fixed messages quoted here are those of data-model.md, sync.md, claude-api.md, web-platform.md and capture.md as revised on 2026-11-20. Where one of them words a message, its wording wins; this section quotes such a message only to show what the user sees.

#### 4.15.1 Rules that hold on every screen

What this section replaces:

| Earlier text | Now |
|---|---|
| 4.5.1 and 4.11.1: sign-in for one owner with a passphrase | 4.15.2, 4.15.3 |
| 4.5.10 and 4.11.5: settings; the key as a server secret; "Confirm Your Passphrase" | 4.15.4, 4.15.5, 4.15.6 |
| 4.6.7: ModelSelect; the "Claude Isn't Set Up" block; the "Continue" button after a cut-off reply | 4.15.6; the "Connect to Claude" block (4.6.7, 4.15.5); no such button |
| 4.5.12 and 4.11.4: offline bar, "read-only while offline" | 4.15.8 |
| 4.6.6: dropped turns as a note after saving | 4.15.9 |
| 4.6.6: server capture, in part | 4.15.10 adds states; the rest of 4.6.6 stands |

Rules:

1. One user at a time in one browser profile. Every screen shows the signed-in user's vault and nothing else. The server answers a record of another user exactly like one that does not exist (data-model.md 7.12, rule I4), so the interface has one state for both, "Session Not Found" (4.10). No list, count, search result, suggestion or message depends on, names or hints at another user.
2. A page that finds that the signed-in user is no longer the one it was loaded for (the `user_id` that `GET /api/auth/session` returns has changed; sync.md 2.6, rule 4) clears the screen at once and starts again. Nothing of one user is ever drawn under another user's session.
3. Secrets are write-only. An API key or a password is typed and sent once. It is never displayed again, never stored in the browser, never queued and never logged (4.15.5).
4. Nothing private goes into a path or a query string: an invitation or recovery code travels in the fragment or in a request body, an API key and a password only in a request body, and paths carry opaque ids (4.4; web-platform.md 13.4, convention 6).
5. A control that cannot work in the present state is disabled, stays focusable (`aria-disabled="true"`), and gives the reason in its tooltip and accessible description. Without a connection the reason is "You're offline." unless a longer sentence is given.
6. Sign-in is built into the app with a maintained library; while no mail provider is configured, with an e-mail address and a password (web-platform.md 11.9). If the owner later chooses another method (its section 17, decision 1), only the method block of 4.15.2 and step 2 of 4.15.3 change.
7. Strings follow principle 4 of 4.1: the Apple strings where the feature is the same, Title Case for titles and buttons. The ellipsis in a string is U+2026 and the quotation marks around a title are U+201C and U+201D, as in 4.13.

Answers that can arrive on any screen (web-platform.md 13.4; data-model.md 7.7 and 7.10; sync.md 4.2 and 6.6):

| Code | Text or effect |
|---|---|
| `not_signed_in` (401) | No message. The sign-in screen in its "session ended" state (4.15.2); what the user typed and the queue of changes are kept. |
| `account_suspended` (403) | The status bar of 4.15.8: "Your account is suspended. You can read and export your sessions, but not add or change anything." Controls that add or change are disabled with "Your account is suspended." |
| `reauth_required` (403) | The dialog "Confirm It's You" of 4.15.4; then the request is sent again. |
| `quota_exceeded` (413, or the code of one pushed change) | By the limit the answer names (data-model.md 7.10): "Your vault has reached its storage limit.", "Your vault has reached its limit of `<n>` sessions." or "You've reached the limit of `<n>` projects."; when it names none, "Your vault is full." Each is followed by "Delete or export what you no longer need, then try again." |
| `read_only` (503) | The status bar of 4.15.8: "The vault is read-only for maintenance. Changes are kept on this device and sent later." |
| `rate_limited` (429) | "Too many requests. Wait a moment and try again." On the sign-in screens the text of their "throttled" state. |
| `resync_required` (409) | No message. The copy is filled again (sync.md 4.8) and the sync row shows "Setting up the offline copy…". |
| `not_found` (404) | "Session Not Found" (4.10). |
| `internal` (500) | "Something went wrong on the server. Try again.", with the request id in a "Details" line. |

#### 4.15.2 Sign-in and sign-out

Route `/sign-in`. Replaces 4.11.1 and wireframe 4.5.1; the card, its width and the icon rule of 4.11.1 stand. web-platform.md 11.9 to 11.11 define accounts, invitations and mail; its 11.2 defines the session.

Frame, top to bottom: the app icon; "SessionVault" as the `<h1>`; "Your AI sessions, in one vault."; a note line (only in the states that have one); the method block; a message line; the links. The links "Terms" and "Privacy" appear at the foot of the sign-in and sign-up screens and in Settings once the owner has supplied those texts, and not before: never placeholder legal text (`../HANDOFF.md` phase 6; web-platform.md 11.14, G14).

Method block. web-platform.md 11.9 cites the blocks by these names:

| Method | Step 1 | Step 2 |
|---|---|---|
| Password or passkey through a maintained library. The default to build for as long as no mail provider is configured (web-platform.md 11.9, option 1). | Fields "Email" (`type="email"`, `autocomplete="username"`, `inputmode="email"`, `autocapitalize="off"`, `spellcheck="false"`) and "Password" (`type="password"`, `autocomplete="current-password"`); primary button "Sign In" (`POST /api/auth/login`). Under it, while no mail is configured, the line "Forgot your password? Ask the person who invited you for a recovery code."; with mail configured, the link "Forgot Password?" in its place (the reset screens of web-platform.md 11.11 use this frame and are not specified yet). Where passkeys are offered, a secondary button "Sign In with a Passkey". | Only for an account with a second factor (web-platform.md 11.14, G6): field "Code" (`inputmode="numeric"`, `autocomplete="one-time-code"`), button "Sign In". |
| E-mail with a typed code. The owner's choice once mail exists (web-platform.md 11.9, option 3). | Field "Email", primary button "Continue". | Heading "Check Your Email"; text "If `<address>` can sign in, a code is on its way."; field "Code"; primary button "Sign In"; plain buttons "Send a New Code" and "Use a Different Email". The code is typed, not followed as a link: an app installed on an iPhone or iPad does not receive links (web-platform.md 4.1). |
| Hosted provider. The owner's alternative (web-platform.md section 17, decision 1). | One primary button "Sign In" that goes to the provider's own page. The app draws no credential field. | On return: "Signing you in…" with a spinner. |

Under the block, in every form: the link "Have an Invitation Code?" to `/invite` (4.15.3).

States:

| State | What is shown |
|---|---|
| idle | The method block. The first field has focus. |
| submitting | The primary button is busy and cannot be pressed again (B25). |
| failed (`invalid_credentials`) | "That didn't work. Check your details and try again." in `--color-danger`, `role="alert"`. The same text for an unknown address and for a wrong password. |
| code refused (a typed code, a second factor) | "That code didn't work. Check it, or send a new one." |
| new code sent (a typed code) | "A new code is on its way." "Send a New Code" is disabled for 30 seconds after each send. |
| throttled (`rate_limited`) | "Too many attempts. Wait a few minutes and try again." |
| unreachable | "Can't reach the server. Check your connection." |
| offline | The form is disabled: "You're offline. Connect to sign in." |
| session ended | Note line: "Your session ended. Sign in again to continue." When changes wait on the device (sync.md 2.6, rule 3), a second line: "`<n>` change made on this device is waiting to be sent." or "`<n>` changes made on this device are waiting to be sent.", and the plain button "Discard Them", which asks first (below). |
| password changed | Note line, after a recovery or a reset: "Your password was changed. Sign in with the new one." |
| account deleted | Note line, once, on the device that asked for the deletion: "Your account and its data were deleted." |

After a successful sign-in:

1. Ask the server who is signed in: `GET /api/auth/session` returns `user_id` (web-platform.md 11.2; sync.md 2.6, rule 4).
2. The same user as the copy on this device: go to the address the user came from, else to the session list. The waiting changes are sent.
3. Another user: show only a spinner and "Preparing your vault…" until everything of the previous user, the waiting changes included, is deleted from the device.
4. A first sign-in on a device starts the first sync (4.15.8). There is no tour and no sample data (4.10), and no screen asks for an API key before Claude is used.

Sign-out, from the Account section of 4.15.4:

| Step | What happens (sync.md 2.6, rule 2) | What is shown |
|---|---|---|
| 1 | "Sign Out" is pressed. With a connection the waiting changes are sent first. | The button is busy: "Signing Out…" |
| 2 | Changes remain that could not be sent. | Dialog "Sign Out and Lose Changes?": "`<n>` change(s) made on this device have not been sent. Signing out deletes them.", "Cancel", "Sign Out Anyway" (destructive). Focus starts on "Cancel". |
| 3 | The sign-in session is ended on the server. The offline copy, the share inbox, the model remembered on this device (4.15.6) and the first-use acceptance of 4.6.7 are deleted. | The sign-in screen, idle, without a note. |
| 4 | Without a connection: the local data is deleted now, and the session is ended with the first request that gets through. | The same. |

"Sign Out Everywhere" ends the user's other sign-in sessions (`DELETE /api/auth/sessions`) and then signs this browser out as above; each other device shows "session ended" the next time it reaches the server.

"Discard Them" opens the dialog "Discard Unsent Changes?": "`<n>` change(s) made on this device were never sent. Discarding deletes them for good.", "Cancel", "Discard" (destructive).

Recovery, only while no mail is configured (web-platform.md 11.10, rule 8). Route `/recover`; the owner gives the person a link `/recover#code=<code>`. The frame, with the fields "Recovery Code" (filled from the fragment, which is then removed from the address), "Email" and "New Password" (`autocomplete="new-password"`, help "At least 12 characters."), and the button "Set New Password" (`POST /api/auth/recover`):

| Answer | What is shown |
|---|---|
| accepted | Every session of that user is ended. The sign-in screen in its "password changed" state. |
| refused | "That recovery code isn't valid for this address or has already been used." One text for every reason. |
| `validation` | Under the field: "Use at least 12 characters." |
| throttled, unreachable, offline | As on the sign-in screen. |

Phone: sign-in with the default block, in the "session ended" state after a failed attempt; and the recovery screen:

```
+----------------------------------------+   +----------------------------------------+
|                                        |   |                                        |
|               [app icon]               |   |               [app icon]               |
|              SessionVault              |   |              SessionVault              |
|    Your AI sessions, in one vault.     |   |    Your AI sessions, in one vault.     |
|                                        |   |                                        |
|  Your session ended. Sign in again to  |   |  Recovery Code                         |
|  continue.                             |   |  [EXAMPLE-0000-0000                 ]  |
|  3 changes made on this device are     |   |  Email                                 |
|  waiting to be sent.  [Discard Them]   |   |  [sam@example.com                   ]  |
|                                        |   |  New Password                          |
|  Email                                 |   |  [..............                    ]  |
|  [sam@example.com                   ]  |   |  At least 12 characters.               |
|  Password                              |   |  [         Set New Password         ]  |
|  [..............                    ]  |   |                                        |
|  [              Sign In             ]  |   |  (!) That recovery code isn't valid    |
|                                        |   |      for this address or has already   |
|  (!) That didn't work. Check your      |   |      been used.                        |
|      details and try again.            |   |                                        |
|                                        |   |                                        |
|  Forgot your password? Ask the person  |   |                                        |
|  who invited you for a recovery code.  |   |                                        |
|        Have an Invitation Code?        |   |                                        |
|            Terms . Privacy             |   |            Terms . Privacy             |
+----------------------------------------+   +----------------------------------------+
```

Desktop: the same block as a card 360 px wide, centred on `--color-bg-sidebar` (as 4.5.1):

```
+--------------------------------------------------------------------------------------------+
|                                                                                            |
|                          +--------------------------------------+                          |
|                          |              [app icon]              |                          |
|                          |             SessionVault             |                          |
|                          |   Your AI sessions, in one vault.    |                          |
|                          |                                      |                          |
|                          |  Email                               |                          |
|                          |  [sam@example.com                 ]  |                          |
|                          |  Password                            |                          |
|                          |  [..............                  ]  |                          |
|                          |  [            Sign In             ]  |                          |
|                          |                                      |                          |
|                          |  (!) message line, when there is one |                          |
|                          |                                      |                          |
|                          |  Forgot your password? Ask the       |                          |
|                          |  person who invited you for a        |                          |
|                          |  recovery code.                      |                          |
|                          |       Have an Invitation Code?       |                          |
|                          |           Terms . Privacy            |                          |
|                          +--------------------------------------+                          |
|                                                                                            |
+--------------------------------------------------------------------------------------------+
```

The two dialogs (both widths):

```
+------------------------------------+   +------------------------------------+
| Sign Out and Lose Changes?         |   | Discard Unsent Changes?            |
| 3 changes made on this device have |   | 3 changes made on this device were |
| not been sent. Signing out deletes |   | never sent. Discarding deletes     |
| them.                              |   | them for good.                     |
|     [ Cancel ] [ Sign Out Anyway ] |   |             [ Cancel ] [ Discard ] |
+------------------------------------+   +------------------------------------+
```

Accessibility:

- One `<main>`; `document.title` is "Sign In - SessionVault" ("Reset Password - SessionVault" on `/recover`). Every field has a visible label. The message line is `role="alert"`; the note line is ordinary text above the form, read in order.
- Password managers must work: real `<form>` elements, the `autocomplete` values given above, no blocking of paste.
- Step 2 of a method moves focus to its "Code" field. A code field is one field that accepts paste and autofill, never one box per digit. "Send a New Code" stays focusable while it is disabled.
- The busy state sets `aria-busy`; nothing is announced twice.
- The card works at 320 px and at 200 % zoom; nothing is fixed in height.

#### 4.15.3 Invitation entry

Route `/invite` (web-platform.md 11.10): creating an account takes an invitation code while `SIGNUP_MODE` is `invite`. `closed` refuses every sign-up. The owner sets `open` only when the list of web-platform.md 11.14 holds; then step 1 is skipped.

Step 1, the code. The frame of 4.15.2; the text "SessionVault is invitation-only for now. Enter your invitation code to create an account."; the field "Invitation Code" (`autocomplete="off"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`); the primary button "Continue" (`POST /api/auth/invitation/check`, which only says whether the code is valid and uses nothing up); the link "Already Have an Account? Sign In".

Step 2, the account. The note "Invitation accepted. Create your account."; then, for the default method of 4.15.2, the fields "Email" (as there) and "Password" (`type="password"`, `autocomplete="new-password"`, help "At least 12 characters.") and the primary button "Create Account" (`POST /api/auth/signup` with the address, the password and the code). While no mail is configured, one more line in caption, secondary: "There is no password reset by mail yet. If you forget your password, the person who invited you can give you a recovery code." With another method of 4.15.2, its first step takes the place of the two fields.

A code that arrives in a link is in the fragment: `/invite#code=<code>`. The page reads it, fills the field and removes the fragment from the address with `history.replaceState`. Between the two steps the page keeps the code in memory and nowhere else, so a reload in step 2 leads back to step 1. A code is never put into a path or a query string, because the hosting platform records those, and it is never stored in the browser (web-platform.md 11.10, rules 5 and 6).

| State | What is shown |
|---|---|
| idle | Step 1. The field has focus; it is filled from the fragment when there is one. |
| checking, submitting | The button is busy. |
| accepted | Step 2. |
| `invitation_invalid`, in either step | "That invitation code isn't valid or has already been used.", `role="alert"`. One text for an unknown, a used and an expired code; it says nothing about any address. From step 2 it leads back to step 1. |
| `email_taken` | "That address already has an account. Sign in instead.", with the link to `/sign-in`. The code stays unused. |
| `signup_closed` | "Sign-up is closed at the moment." |
| `validation` | Under the field concerned: "Enter an e-mail address." or "Use at least 12 characters." |
| throttled (`rate_limited`) | "Too many attempts. Wait a few minutes and try again." |
| unreachable | "Can't reach the server. Check your connection." |
| offline | The form is disabled: "You're offline. Connect to continue." |
| created | The person is signed in and sees the first-run state of 4.10. |

Phone: step 1 in its "refused" state; and step 2:

```
+----------------------------------------+   +----------------------------------------+
|                                        |   |                                        |
|               [app icon]               |   |               [app icon]               |
|              SessionVault              |   |              SessionVault              |
|    Your AI sessions, in one vault.     |   |    Your AI sessions, in one vault.     |
|                                        |   |                                        |
|  SessionVault is invitation-only for   |   |  Invitation accepted. Create your      |
|  now. Enter your invitation code to    |   |  account.                              |
|  create an account.                    |   |                                        |
|                                        |   |  Email                                 |
|  Invitation Code                       |   |  [sam@example.com                   ]  |
|  [EXAMPLE-0000-0000                 ]  |   |  Password                              |
|  [             Continue             ]  |   |  [..............                    ]  |
|                                        |   |  At least 12 characters.               |
|  (!) That invitation code isn't valid  |   |  [          Create Account          ]  |
|      or has already been used.         |   |                                        |
|                                        |   |  There is no password reset by mail    |
|                                        |   |  yet. If you forget your password,     |
|                                        |   |  the person who invited you can give   |
|                                        |   |  you a recovery code.                  |
|                                        |   |                                        |
|                                        |   |                                        |
|    Already Have an Account? Sign In    |   |    Already Have an Account? Sign In    |
|            Terms . Privacy             |   |            Terms . Privacy             |
+----------------------------------------+   +----------------------------------------+
```

Desktop, step 1:

```
+--------------------------------------------------------------------------------------------+
|                                                                                            |
|                          +--------------------------------------+                          |
|                          |              [app icon]              |                          |
|                          |             SessionVault             |                          |
|                          |   Your AI sessions, in one vault.    |                          |
|                          |                                      |                          |
|                          |  SessionVault is invitation-only for |                          |
|                          |  now. Enter your invitation code to  |                          |
|                          |  create an account.                  |                          |
|                          |                                      |                          |
|                          |  Invitation Code                     |                          |
|                          |  [EXAMPLE-0000-0000               ]  |                          |
|                          |  [            Continue            ]  |                          |
|                          |                                      |                          |
|                          |   Already Have an Account? Sign In   |                          |
|                          |           Terms . Privacy            |                          |
|                          +--------------------------------------+                          |
|                                                                                            |
+--------------------------------------------------------------------------------------------+
```

Accessibility: as 4.15.2. `document.title` is "Invitation - SessionVault" in step 1 and "Create Account - SessionVault" in step 2; step 2 moves focus to its first field. A refusal is tied to its field with `aria-describedby`, and the field gets `aria-invalid`. The password help is tied to the password field in the same way.

#### 4.15.4 Settings, account, export and account deletion

Route `/settings`. Replaces 4.11.5 and wireframe 4.5.10. It is reached from "Settings" at the foot of the library. Sections, in this order:

| Section | Content |
|---|---|
| Claude | The key line of 4.15.5 with its buttons. Under it the model rows of 4.15.6. |
| Offline Copy | 4.15.8, part (g). |
| Export | Button "Export Vault": the server builds the whole vault in the interchange format of data-model.md and the browser downloads it, so it needs a connection and the fresh sign-in check below. Help: "Downloads every session as one file. Your API key is never part of it." While changes wait: "`<n>` change(s) not sent yet are not in the file." Busy text "Preparing export…"; then the toast "Export saved."; on failure an error banner "Couldn't export the vault. Try again." A suspended account can still export (data-model.md 7.7). A vault file is imported through Import, From Files. |
| Install | 4.11.2. |
| About | "SessionVault for the web"; version and commit; a "Source code" link, only when the owner has configured an address for it (`ABOUT_SOURCE_URL`, web-platform.md 13.5); the links "Terms" and "Privacy" once they exist; one privacy sentence, to be confirmed by the owner together with the privacy policy: "Your sessions are stored in your private vault on this app's server and in the offline copy on your devices. Their text is sent to Anthropic only when you use Continue with Claude or Summarize, with your own API key. The operator of this service can technically access what is stored." |
| Account | From `GET /api/account` (web-platform.md 13.4), read with a connection and not written to the device: "Signed in as `<address>`", followed by " · not verified" while the address is unverified; "Account ID `<user id>`" with a "Copy" button, because the owner needs that id to issue a recovery code (web-platform.md 11.10, rule 8); "`<n>` session(s) · `<used>` of `<limit>` used". Then the signed-in browsers (`GET /api/auth/sessions`): one line each with the device label and "active now" or the relative time last seen, the current one marked "This device", the others with a "Sign Out" button. Then "Sign Out Everywhere" and "Sign Out" (4.15.2). Last, set apart: "Delete Account…". Changing the password or the address belongs here once web-platform.md has routes for it, behind the same fresh check. |

Fresh sign-in check (web-platform.md 11.2): export, account deletion and any change of password or address need the password again unless it was given within the last 10 minutes. A request that lacks it answers `reauth_required`; then the dialog "Confirm It's You" opens: "Enter your password to continue.", the field "Password" (`autocomplete="current-password"`), "Cancel" and "Continue" (`POST /api/auth/reauth`). A wrong password: "That didn't work. Try again." After "Continue" the first request is sent again.

Account deletion (`DELETE /api/account`, web-platform.md 11.12; data-model.md 7.11 and its decision 11: at once and for good, after the fresh check and a typed confirmation):

| Step | What is shown |
|---|---|
| 1. Start | "Delete Account…" is a plain button in `--color-danger`, the last control of the screen. Without a connection it is disabled. A suspended account can still delete itself. |
| 2. Fresh check | "Confirm It's You", when the server asks for it. |
| 3. Confirm | Dialog "Delete Your Account?" (`role="alertdialog"`, `--width-dialog-md`). Text: "This deletes your account, every session and project in your vault, and your stored API key. It can't be undone." In caption, secondary: "Not deleted: files you exported or downloaded, sessions in the SessionVault app on your Apple devices, and your key at Anthropic (revoke it in the Claude Console). Backup copies kept by the hosting service expire on their own schedule. Your other devices remove their offline copy the next time they connect. Changes that were never sent from them stay there until you discard them." While changes wait: "`<n>` change(s) not sent yet will be lost." A plain button "Export Vault First". The field "Type DELETE to confirm". Buttons "Cancel" and "Delete Account" (destructive); the second is disabled until the field holds exactly `DELETE` after trimming. Focus starts on "Cancel". |
| 4. Deleting | Field and buttons are disabled; a spinner with "Deleting your account…". It cannot be cancelled. |
| 5. Done | The offline copy, the waiting changes and the share inbox are deleted from the device without a further question (sync.md 2.6, rule 5). The sign-in screen shows "Your account and its data were deleted." |
| 6. Failed | The dialog stays, with "Couldn't delete your account. Try again." If the answer was lost, the next request tells: `not_signed_in` means the deletion went through. |

Phone:

```
+----------------------------------------+
| [<] SessionVault      Settings         |
+----------------------------------------+
| Claude                                 |
| (ok) API key ending in 1111 is         |
|      working.                          |
| [ Replace Key ]  [ Remove Key ]        |
| Default Model      [Claude Opus 5.5 v] |
| Summarize uses Claude Opus 5.5.        |
| Your Models                            |
| Example Model 1 . price not known  [x] |
|   example-model-1                      |
| [ Add Model ]                          |
| Prompt Cache                [1 Hour v] |
| Let Another Model Answer After    (o ) |
| a Refusal                              |
|                                        |
| Offline Copy                           |
| Keep an Offline Copy            (o )   |
| Download Transcripts  [Up to 256 MB v] |
| Using 12 MB on this device.            |
| Everything is sent.         [Sync Now] |
|                                        |
| Export                                 |
| [           Export Vault            ]  |
| Downloads every session as one file.   |
| Your API key is never part of it.      |
|                                        |
| Install                                |
| [       Install SessionVault        ]  |
|                                        |
| About                                  |
| SessionVault for the web               |
| Version 0.1.0 (abc1234)                |
| Terms . Privacy                        |
|                                        |
| Account                                |
| Signed in as sam@example.com           |
| . not verified                         |
| Account ID 00000000-0000-40...  [Copy] |
| 128 sessions . 42 MB of 1 GB used      |
| This device . active now               |
| Android phone . 2 days ago  [Sign Out] |
| [        Sign Out Everywhere        ]  |
| [             Sign Out              ]  |
|                                        |
| Delete Account...                      |
+----------------------------------------+
```

Desktop (the library stays; settings replace the list and detail panes, content 40rem wide; the row above "Settings" is the sync row of 4.15.8):

```
+--------------------------+-----------------------------------------------------------------------------------------+
| SessionVault             | Settings                                                                                |
|                          |                                                                                         |
| Library                  | Claude                                                                                  |
| [tray] All Sessions  128 | (ok) API key ending in 1111 is working.       [ Replace Key ]  [ Remove Key ]           |
| [pin]  Pinned          4 | Default Model        [Claude Opus 5.5    v]   Summarize uses Claude Opus 5.5.           |
| [cal]  Timeline          | Your Models          Example Model 1 . example-model-1 . price not known    [x]         |
|                          |                      [ Add Model ]                                                      |
| Projects                 | Prompt Cache         [1 Hour             v]                                             |
| [dir]  Bicycle repair  3 | Let Another Model Answer After a Refusal   (o )                                         |
| [dir]  Garden plann.. 12 |                                                                                         |
| [dir+] New Project...    | Offline Copy                                                                            |
|                          | Keep an Offline Copy on This Device   (o )    Using 12 MB on this device.               |
| Providers                | Download Transcripts [Up to 256 MB      v]   Everything is sent.  [ Sync Now ]          |
| [spk]  Claude            |                                                                                         |
| [msg]  ChatGPT           | Export                                                                                  |
| [dia]  Gemini            | [ Export Vault ]  Downloads every session as one file. Your API key is never part of it.|
| [ ? ]  Other             |                                                                                         |
|                          | Install                                                                                 |
| Tags                     | [ Install SessionVault ]                                                                |
| [ # ]  compost           |                                                                                         |
| [ # ]  gears             | About                                                                                   |
|                          | SessionVault for the web . Version 0.1.0 (abc1234) . Terms . Privacy                    |
|                          |                                                                                         |
|                          | Account                                                                                 |
|                          | Signed in as sam@example.com . not verified                                             |
|                          | Account ID 00000000-0000-4000-8000-0000000000aa [Copy]   128 sessions . 42 MB of 1 GB   |
|--------------------------| This device . active now          Android phone . 2 days ago [Sign Out]                 |
| [up] 2 changes waiting   | [ Sign Out Everywhere ]   [ Sign Out ]                                                  |
|      to be sent          |                                                                                         |
|--------------------------| Delete Account...                                                                       |
| [gear] Settings          |                                                                                         |
+--------------------------+-----------------------------------------------------------------------------------------+
```

The deletion dialog, phone and desktop (`...` stands for the rest of the text):

```
+--------------------------------------+   +------------------------------------------------------------+
| Delete Your Account?                 |   | Delete Your Account?                                       |
| This deletes your account, every     |   | This deletes your account, every session and project in    |
| session and project in your vault,   |   | your vault, and your stored API key. It can't be undone.   |
| and your stored API key. It can't be |   |                                                            |
| undone.                              |   | Not deleted: files you exported or downloaded, sessions in |
|                                      |   | the SessionVault app on your Apple devices, and your key   |
| Not deleted: files you exported or   |   | at Anthropic (revoke it in the Claude Console). ...        |
| downloaded, sessions in the          |   |                                                            |
| SessionVault app on your Apple       |   | [Export Vault First]                                       |
| devices, and your key at Anthropic   |   |                                                            |
| (revoke it in the Claude Console).   |   | Type DELETE to confirm                                     |
| ...                                  |   | [DELETE                                                  ] |
| 2 changes not sent yet will be lost. |   |                              [ Cancel ] [ Delete Account ] |
| [Export Vault First]                 |   +------------------------------------------------------------+
|                                      |
| Type DELETE to confirm               |
| [                                  ] |
|        [ Cancel ] [ Delete Account ] |
+--------------------------------------+
```

The fresh-check dialog (both widths):

```
+------------------------------------+
| Confirm It's You                   |
| Enter your password to continue.   |
| Password                           |
| [..............                  ] |
|            [ Cancel ] [ Continue ] |
+------------------------------------+
```

Accessibility:

- `<h1>` "Settings"; each section title is an `<h2>`; the sections are in the reading and focus order of the table.
- "Delete Account…" comes last and is not next to "Sign Out": at least `--space-6` apart.
- The deletion dialog is labelled by its title and described by its first paragraph. The typed field has a visible label, `autocomplete="off"` and `autocapitalize="characters"`. The disabled confirm button names the field as its reason (`aria-describedby`).
- Destructive actions are told by their words, not by colour alone.
- The account id is selectable text in `--font-mono`; its "Copy" button is named "Copy account ID".
- After an export the toast is announced politely; a failed export is `role="alert"`.

#### 4.15.5 Claude key screen

Each user brings their own Anthropic API key (`../HANDOFF.md` sections 2 and 3). The server checks it, stores it encrypted, uses it only for that user's requests and never sends it back. data-model.md 7.8 defines the stored form; claude-api.md C15 defines the routes, the checks and what is shown; its C8 words the messages. This screen takes the place of the Apple key entry of section 1.7.1 and adds what the Apple app lacks: checking, replacing and removing (B28).

What the page knows about the signed-in user's key comes from `GET /api/claude/config` (claude-api.md C6), and that is all there is: `configured`; `keyStatus` (`ok`, `unknown`, `rejected`); `key.last4`, the last four characters; and the times `savedAt`, `checkedAt` and `lastUsedAt`.

Key line, shown in Settings and on the key screen (a StatusNotice, 4.6.6):

| Key | Icon | Line | Buttons beside it |
|---|---|---|---|
| none saved | `key-round`, `--color-text-secondary` | "No API key saved." | "Add API Key" |
| `ok` | `circle-check`, `--color-success` | "API key ending in `<last4>` is working." | "Replace Key", "Remove Key" |
| `unknown` | `triangle-alert`, `--color-warning` | "API key ending in `<last4>` is saved but has not been checked yet." | "Check Again", "Replace Key", "Remove Key" |
| `rejected` | `triangle-alert`, `--color-danger` | "API key ending in `<last4>` was rejected by Anthropic. It may be wrong, disabled or expired." | "Check Again", "Replace Key", "Remove Key" |

Second line, in caption, secondary: "Saved `<date>`", then " · checked `<relative time>`" and " · last used `<relative time>`" for the times that exist. If the owner prefers not to show the last four characters (data-model.md, decision 13), the lines read "An API key is saved and working." and so on.

The key screen: route `/settings/claude-key`; a page in the compact layout, a dialog `--width-dialog-md` over Settings otherwise. It is opened from Settings, from the "Connect to Claude" block of the chat and from the Summarize dialog (4.6.7). Closing it returns to where it was opened. Content, top to bottom:

1. Title "Anthropic API Key".
2. Text: "Continue with Claude and Summarize use your own Anthropic API key, and Anthropic bills the account it belongs to. The key is stored encrypted on this app's server, used only for your own requests and never shown again. The operator of this service can technically access what is stored." What users are told about their key is the owner's text in the end; claude-api.md C15.1 lists the facts it has to match.
3. Advice, in caption, secondary, which claude-api.md C15.2 asks this screen to give: "Create a key for this app alone, in a workspace of its own, and set a spend limit for that workspace in the Claude Console. You can remove the key here at any time; deleting it in the Console is what makes it useless everywhere." "Claude Console" is a link to the address claude-api.md gives for keys (`platform.claude.com/settings/keys`), opened in a new tab with `rel="noopener noreferrer"`.
4. The key line.
5. The form, only while entering or replacing: field "API Key" ("New API Key" when replacing), placeholder "sk-ant-…" (the Apple placeholder), `type="password"`, `autocomplete="off"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`; primary button "Save Key" (the Apple label), disabled while the field is empty after trimming; "Cancel" when replacing.

States:

| State | What is shown |
|---|---|
| no key | Text, advice, the key line "No API key saved.", the form. |
| checking | After "Save Key" (`PUT /api/claude/key`): the button is busy and reads "Checking…"; the field is read-only. It is one request: the server tests the value, checks it with Anthropic and stores it only then. |
| saved | The answer holds the status and the last four characters, nothing else. The form closes and the field is emptied; the key line shows the status; toast "API key saved." With `unknown`, one more line: "Anthropic could not be reached to check it. It is checked the first time you use Claude." |
| refused by a test of the value | `validation` with a reason (claude-api.md C15.2), shown under the field. `too_long`, `bad_characters`: "That doesn't look like an API key. Paste the key alone, without spaces or line breaks." `not_an_api_key`: "That doesn't look like an Anthropic API key." `admin_key`: the message of claude-api.md C8 ("This is an Admin API key. Create an ordinary API key for one workspace instead."). The browser itself tests only that the field is not empty; the other rules live in one place, on the server. The field is emptied. |
| not accepted by Anthropic | `key_rejected` or `key_unusable`: the message of claude-api.md C8 under the field ("Anthropic did not accept this key. Nothing was saved."; "This key cannot be used here.", with what Anthropic said in a "Details" line). Nothing was saved, and a key that was saved before stays as it was. The field is emptied, as after every answer (claude-api.md C15.2); the user pastes the key again. |
| failed | `key_service_unavailable`, `app_rate_limited`, `server_busy`: the message of claude-api.md C8 under the field. No answer at all: "Couldn't save the key. Try again."; only in that case does the field keep its text, so that a second try needs no second paste. |
| key saved | Text, advice, the key line and its buttons. No field. |
| checking again | "Check Again" (`POST /api/claude/key/check`): the button is busy; then the key line shows the status. If Anthropic could not be asked: "Anthropic could not be reached. Try again later." |
| replacing | "Replace Key" opens the form with the label "New API Key". The saved key keeps working until the new one is accepted; a replacement that is refused changes nothing. |
| removing | "Remove Key" opens the dialog "Remove Your API Key?": "Continue with Claude and Summarize stop working until you add a key again. Replies that Claude is still writing are stopped; what has arrived is kept. Removing the key here does not switch it off at Anthropic: delete it in the Claude Console if it should stop working everywhere.", "Cancel", "Remove Key" (destructive). Then (`DELETE /api/claude/key`) the toast "API key removed." and the "no key" state. |
| offline | Field and buttons are disabled: "You're offline. Connect to change your API key." The request is never queued (sync.md 10, rule 2). |
| account suspended | Removing stays possible; adding, replacing and checking are disabled with "Your account is suspended." (claude-api.md C6). |

What the interface never does:

1. It never shows a saved key or any part of it except the last four characters: no reveal control, no copy control, no prefilled field.
2. The typed key lives only in the field until the answer has arrived. It is not written to `localStorage`, `sessionStorage`, IndexedDB, the outbox, a URL, a log or an error report. The field is emptied when the answer arrives, when the screen closes and on `pagehide`.
3. The key is sent once, in the body of one same-origin request. No answer carries it back.
4. No other screen takes a key. The chat, Summarize and Settings lead here.

In the chat and for Summarize (4.6.7):

| Key | Chat | Summarize |
|---|---|---|
| none saved | The "Connect to Claude" block takes the composer's place: icon `key-round`, the title "Connect to Claude" (the Apple heading), the `not_configured` message of claude-api.md C8 ("Add your Anthropic API key in Settings to use Claude.") and the button "Add API Key", which opens the key screen. | A press opens a dialog titled "Summarize" with the same message, "Cancel" and "Add API Key". |
| `rejected` | A warning notice above the composer: "Anthropic rejected your API key the last time it was used.", with "Check Again" and "Replace Key". The composer stays usable: a key that works again is found out by using it (claude-api.md C15.5). A request that fails shows the error banner with the `auth_failed` message and the same two actions. | The action stays available. A failure shows the same banner at the top of the detail. |
| `key_unreadable` on a request | The error banner with the message of claude-api.md C8 and the action "Replace Key". | The same banner at the top of the detail. |

Phone: no key, after Anthropic did not accept a value; and a saved key:

```
+----------------------------------------+   +----------------------------------------+
| [<] Settings   Anthropic API Key       |   | [<] Settings   Anthropic API Key       |
+----------------------------------------+   +----------------------------------------+
| Continue with Claude and Summarize     |   | Continue with Claude and Summarize     |
| use your own Anthropic API key, and    |   | use your own Anthropic API key, and    |
| Anthropic bills the account it         |   | Anthropic bills the account it         |
| belongs to. The key is stored          |   | belongs to. The key is stored          |
| encrypted on this app's server, used   |   | encrypted on this app's server, used   |
| only for your own requests and never   |   | only for your own requests and never   |
| shown again.                           |   | shown again.                           |
| Create a key for this app alone, in a  |   | Create a key for this app alone, in a  |
| workspace of its own, and set a spend  |   | workspace of its own, and set a spend  |
| limit ... (the advice)                 |   | limit ... (the advice)                 |
|                                        |   |                                        |
| (key) No API key saved.                |   | (!) API key ending in 1111 is saved    |
|                                        |   |     but has not been checked yet.      |
| API Key                                |   |     Saved Nov 12, 2026                 |
| [sk-ant-...                          ] |   |                                        |
| [              Save Key              ] |   | [ Check Again ]                        |
|                                        |   | [ Replace Key ]         [ Remove Key ] |
| (!) Anthropic did not accept this      |   |                                        |
|     key. Nothing was saved.            |   |                                        |
|                                        |   |                                        |
+----------------------------------------+   +----------------------------------------+
```

Desktop: replacing a rejected key, and the removal dialog (`...` stands for the rest of a text):

```
+------------------------------------------------------------+   +-------------------------------+
| Anthropic API Key                                      [x] |   | Remove Your API Key?          |
+------------------------------------------------------------+   | Continue with Claude and      |
| Continue with Claude and Summarize use your own Anthropic  |   | Summarize stop working until  |
| API key, and Anthropic bills the account it belongs to.    |   | you add a key again. ...      |
| The key is stored encrypted on this app's server, used     |   |     [ Cancel ] [ Remove Key ] |
| only for your own requests and never shown again.          |   +-------------------------------+
| Create a key for this app alone, in a workspace of its     |
| own, and set a spend limit ... (the advice)                |
|                                                            |
| (!) API key ending in 1111 was rejected by Anthropic. It   |
|     may be wrong, disabled or expired.                     |
|     Saved Nov 12, 2026 . checked 5 minutes ago             |
|                                                            |
| New API Key                                                |
| [....................................................    ] |
|                                    [ Cancel ] [ Save Key ] |
+------------------------------------------------------------+
```

The "Connect to Claude" block (both widths):

```
+----------------------------------------+
|                 [key]                  |
|           Connect to Claude            |
|     Add your Anthropic API key in      |
|        Settings to use Claude.         |
|            [ Add API Key ]             |
+----------------------------------------+
```

Accessibility:

- The title is the `<h1>` of the page or labels the dialog; `document.title` is "Anthropic API Key - SessionVault".
- The field has a visible label. Its message is tied to it with `aria-describedby`, sets `aria-invalid` and is `role="alert"`.
- The key line is `role="status"`. After saving or removing, focus moves to the title and the polite region says "API key saved." or "API key removed."
- `<last4>` is marked up so that a screen reader reads it character by character.
- Unverified: whether browsers offer to save a `type="password"` value as a site password here. If they do in testing, use a text field instead.

#### 4.15.6 Model chooser

The user asks a model of their own choosing (`../HANDOFF.md` section 1): the list is the user's, not a fixed menu. claude-api.md C16 defines the registry, what a key can use and the user's own model ids; this section defines the controls.

| What | Route (claude-api.md C6) | Used for |
|---|---|---|
| The effective list, `models`: the registry models, then the model ids the user added; each with `id`, `name`, `inRegistry` and `priceClass`. Also `defaultModel`, `summarizeModel` and what the user chose, `preferences`. | `GET /api/claude/config` | the picker, Settings |
| Every registry model and every model that Anthropic lists for the user's key, as last read, each with `inList`, `available` and `lifecycle` | `GET /api/claude/models` | suggestions when a model is added |
| A change of the user's own ids, of the default or of the two switches | `PUT /api/claude/preferences`; the answer is the new configuration | |

Client code holds no model id of its own (claude-api.md C2).

ModelChooser, in the chat header. It replaces ModelSelect of 4.6.7:

1. A native `<select>` labelled "Model". Options: the effective list in its order, by `name`; last, "Other Model…".
2. First value: the model remembered on this device if it is still in the list, else `defaultModel` (claude-api.md C16). The remembered model is one model id in `localStorage`; sign-out removes it.
3. "Other Model…" shows a row directly under the select: field "Model ID" (`autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`), help "Any model ID your API key can use.", buttons "Use Model" and "Cancel". The field offers as suggestions (a `<datalist>`) the models of `GET /api/claude/models` that are not in the list. Its placeholder is "e.g. " followed by `defaultModel`.
4. "Use Model" first tests the shape that claude-api.md C16 requires of a model id (at most 200 characters, no spaces); otherwise: "Enter a model ID without spaces." Then it adds the id to the user's own ids (`PUT /api/claude/preferences`). The button is busy and reads "Checking…" while the server asks Anthropic whether the key can use the model.
5. Accepted: the model is in the list from now on, on every device, and is selected. The key cannot use it (`validation` with the reason `model_unavailable`): the `model_unavailable` message of claude-api.md C8 under the field, and nothing is added. "Cancel" and Escape restore the previous selection and return focus to the select.
6. A request can still fail with `model_unavailable` later: the list decides what is offered, and the first real request decides in the end (claude-api.md C16). The error banner then has the action "Choose Another Model", which moves focus to the select. The id stays in the list until the user removes it in Settings.
7. A model outside the registry has no price in the app. The "Send a Large Request?" dialog then reads "This sends about `<n>` tokens to `<model name>`. The app does not know this model's price." The model line of the composer shows the model's `name` and its price class in words.
8. An empty list (`defaultModel` is null): the composer cannot send; a notice above it says "Choose a model in Settings first.", with the button "Open Settings".

Settings, Claude section, under the key line:

| Row | Content |
|---|---|
| "Default Model" | The chooser: a registry model or one of the user's own. Help: "Continue with Claude starts with this model." |
| Summarize | One line, "Summarize uses `<model name>`.": `summarizeModel` of the configuration. |
| "Your Models" | Only when the user has added ids: one row per id with its `name`, its id in caption, "price not known", and an icon button "Remove" (`aria-label` "Remove `<name>`"). Removing the default falls back to the server's default. Registry models are always offered and are not listed here. Under the rows, or alone when there are none, the button "Add Model", which opens the "Model ID" row of the chooser. |
| "Prompt Cache" | Select "1 Hour", "5 Minutes", "Off" (`cacheTtl`). Help: "With caching, the first message of a chat costs more and later ones much less. For single questions, Off is cheapest." |
| "Fallback Model" | Switch "Let Another Model Answer After a Refusal" (`fallbacks`). Help: "Off: only the model you chose ever answers." |

A registry model's price class follows its name in words ("lowest price", "low price", "medium price", "high price") on the model line of the composer, under the "Default Model" select and in the suggestions; a model outside the registry gets "price not known". In the suggestions a model that Anthropic lists as deprecated is marked "deprecated". "Check Again" on the key line (4.15.5) also reads the key's models again. claude-api.md C6 allows a release without the last two rows; the server defaults then apply. This document includes them, because the cache setting decides what a single question costs (claude-api.md C14).

| State | What is shown |
|---|---|
| loading | The select is disabled and shows a skeleton. |
| failed | "Couldn't load the model list." with "Try Again". |
| offline | Changing the default, the list or the switches is disabled: "You're offline." |
| no key saved | The registry models are shown and the default can be chosen. A model cannot be added: "Add your API key first." |

Phone: the row for another model id, and the opened select:

```
+----------------------------------------+   +----------------------------------------+
| [x]  Continue with Claude    [model v] |   | [model v] opened:                      |
+----------------------------------------+   |                                        |
| Model ID                               |   |   Claude Opus 5.5              (v)     |
| [e.g. claude-opus-5-5                ] |   |   Claude Fable 5.2                     |
| Any model ID your API key can use.     |   |   Claude Sonnet 5.5                    |
|               [ Cancel ] [ Use Model ] |   |   Claude Haiku 5.5                     |
+----------------------------------------+   |   Example Model 1                      |
| +------------------------------------+ |   |   Other Model...                       |
| | User                        [Copy] | |   +----------------------------------------+
| | How big should each bay be?        | |
| +------------------------------------+ |
| ...                                    |
+----------------------------------------+
|         [spk] Example Model 1          |
| [Continue the conversation...   ]  (^) |
+----------------------------------------+
```

Desktop:

```
    +----------------------------------------------------------------------+
    | Continue with Claude                Model [Other Model...  v]    [x] |
    +----------------------------------------------------------------------+
    | Model ID [e.g. claude-opus-5-5           ]  [ Cancel ] [ Use Model ] |
    | Any model ID your API key can use.                                   |
    +----------------------------------------------------------------------+
    | +------------------------------------------------------------------+ |
    | | User                                                      [Copy] | |
    | | How big should each bay be?                                      | |
    | +------------------------------------------------------------------+ |
    | ...                                                                  |
    +----------------------------------------------------------------------+
    |                        [spk] Claude Opus 5.5                         |
    | [Continue the conversation...                                ]  (^)  |
    +----------------------------------------------------------------------+
```

Accessibility:

- The selects are native, so keyboard and screen-reader behaviour come with them.
- The "Model ID" row follows the select in the DOM and gets focus when it appears. Its help and its error are tied to the field with `aria-describedby`.
- A change is announced in the polite region: "Model set to `<name>`."
- Remove buttons are named with their model. Nothing is told by colour.

#### 4.15.7 Copying a whole message

`../HANDOFF.md` section 1: every message and every reply can be copied whole with one action, not only code blocks. The Apple app has this button since commit `e81828a` (section 1.10.1). data-model.md 7.14 defines what is copied; claude-api.md C18 adds the rules for replies.

| # | Rule |
|---|---|
| 1 | Every stored message has a Copy button: every role, in the session detail and in the chat, in every layout and at every width down to 320 px. The thinking bubble has none. |
| 2 | Place: the trailing end of the bubble's header row, on the line of the role label, as in the Apple app. A message whose text is longer than 1,500 characters repeats the button at the end of the bubble, at the trailing edge, so that it is at hand after reading. Both do the same. |
| 3 | Look: icon `copy` and the visible label "Copy", caption2, `--color-text-secondary`, plain. The label is never reduced to the icon. After a press: `check` and "Copied" for 1.5 s (the Apple strings and time); a second press copies again and starts the 1.5 s anew. Tooltip with a fine pointer: "Copy this whole message" (the Apple tooltip). |
| 4 | What is copied: `messages.text` of that message, unchanged (data-model.md 7.14). No role label, no model name, no trimming, no rendering; code fences as stored; the whole text whatever its length. It is the string held in memory, never the text of the page: the display rules of 4.7 consume markup, and a line over 50,000 characters is drawn in pieces. A message with segments that are not text copies its text segments, joined as `flattenText` joins them. |
| 5 | How: `navigator.clipboard.writeText(text)` inside the click handler, with no request in between (web-platform.md 6.1, rule 5). If the browser refuses: the toast "Couldn't copy. Your browser blocked clipboard access." and the label does not change. |
| 6 | Code blocks keep their own button (4.6.5). It copies the code of that block only. |
| 7 | A reply that is still arriving cannot be copied whole yet: its text is not final, and a refusal can still discard all of it (claude-api.md C18). Its button is there but disabled, with the description "Available when the reply is complete." Selecting by hand stays possible. |
| 8 | From the `done` event on, the user's message and the reply are stored messages and the button works. It copies the texts of the event (`userMessage.text`, `assistantMessage.text`), never the text put together from `delta` events. A reply that was cut off or stopped copies its stored text; the lines "This reply was cut off by the length limit." and "Stopped" are not part of the copy. |
| 9 | Text left on screen under "Interrupted" (4.6.7) is not stored. Its button copies the text exactly as it was received, so that a long reply is not lost with the connection (claude-api.md C18). |
| 10 | The summary can be copied whole (claude-api.md C18): in its reading state (4.6.4) an icon button beside "Edit Summary", named "Copy summary", copies the summary as stored; the dialog for a summary that was cut off (4.6.7) has the plain button "Copy Draft". |
| 11 | Without a connection it works for every message whose text is on the device (sync.md 5.3), with the same result. |
| 12 | Selecting text, find-in-page and printing are unaffected. |

Keyboard path:

1. Tab and Shift+Tab move through the transcript in document order. Inside each message the first stop is its Copy button.
2. Enter or Space copies. Focus stays on the button.
3. With a screen reader: go to the turn by heading (each role label is an `<h2>`, 4.9), then press Tab once.
4. There is no single-key shortcut (4.8.1). Ctrl+C and Command-C keep their meaning: they copy the selection.

Phone: a message with a code block and a message just copied; a long message with the repeated button, a reply that is still arriving (`(Copy)` is the disabled button) and text left after an interruption:

```
+----------------------------------------+   +----------------------------------------+
| +------------------------------------+ |   | +------------------------------------+ |
| | Assistant                   [Copy] | |   | | Assistant                   [Copy] | |
| | About one cubic metre each works   | |   | | Turn the pile when the middle is   | |
| | well.                              | |   | | hot and the edges are not ...      | |
| | +------------------------------+   | |   | | (a long reply, many screens)       | |
| | | text                  [Copy] |   | |   | | ... and cover it before rain.      | |
| | | bay = 1.0 x 1.0 x 1.0        |   | |   | |                             [Copy] | |
| | +------------------------------+   | |   | +------------------------------------+ |
| +------------------------------------+ |   | +------------------------------------+ |
| +------------------------------------+ |   | | Assistant                   (Copy) | |
| | User                      [Copied] | |   | | Still arriving ...                 | |
| | And how often should I turn it?    | |   | +------------------------------------+ |
| +------------------------------------+ |   | +------------------------------------+ |
+----------------------------------------+   | | Interrupted                 [Copy] | |
                                             | | Text that arrived before the       | |
                                             | | connection was lost ...            | |
                                             | +------------------------------------+ |
                                             +----------------------------------------+
```

Desktop:

```
    +------------------------------------------------------+
    | +--------------------------------------------------+ |
    | | Assistant                                 [Copy] | |
    | | About one cubic metre each works well.           | |
    | | +--------------------------------------------+   | |
    | | | text                                [Copy] |   | |
    | | | bay = 1.0 x 1.0 x 1.0                      |   | |
    | | +--------------------------------------------+   | |
    | | ... (a long reply) ...                           | |
    | |                                           [Copy] | |
    | +--------------------------------------------------+ |
    +------------------------------------------------------+
```

Accessibility:

- Accessible names: "Copy message" for the buttons of a bubble, "Copy code" for the button of a code block, "Copy summary" for the summary. Each contains the visible word "Copy". Each "Copy message" button is described by the role heading of its message (`aria-describedby`).
- The name stays the same while the label shows "Copied"; the polite region of 4.9 says "Copied" once.
- The disabled button stays focusable, so that its reason can be read.
- Touch: a hit area of at least 44 by 44 px by padding (4.8.3); the drawn size stays small.
- Colour pairs: `--color-text-secondary` on both bubble colours, checked in appendix 5.2.

Tests: a browser test copies a message of 1,000,000 characters and one with a fenced block, and compares the clipboard with the stored string by length and hash; no request leaves the page during a copy.

#### 4.15.8 Offline state: the copy, waiting changes and notices

sync.md defines what a device stores and how it stays in step with the server. This section defines what the user sees. It replaces 4.11.4, the wording of the bar in wireframe 4.5.12, and the Offline row of 4.11.5. The offline copy is on by default on every device (sync.md 15, decision 1).

(a) What works without a connection:

| Feature | Without a connection |
|---|---|
| Opening the app | Yes, once the app has been opened on this device before. |
| Lists, filters, timeline, the detail header, search in titles, summaries and tags | Yes, from the copy. Before the first sync has finished: what has arrived, under the line "Still loading your vault. This list is not complete yet." |
| A transcript | Yes when it is complete on the device: opened here before, or fetched in the background within the budget of part (g). Otherwise the states of part (f). |
| Copying a message or a code block | Yes, for what is on the device. |
| Context pack: copy, share, download | Only with the complete transcript on the device. Otherwise the three actions are disabled: "Connect to load the whole transcript first." A partial pack is never produced (sync.md 5.3). |
| Import by paste, by file, by drop, and of shared text or files | Yes. The session is saved on the device, marked "Not sent yet", and sent later. |
| Editing fields, pinning, tags, moving to a project, new, renamed and deleted projects, deleting sessions | Yes. Each change waits in the queue. |
| Continue with Claude, Summarize | No: "You're offline." Also not for a session that the server does not have yet: "Available once this session has been sent." (sync.md 11, rule 4) |
| Link capture, importing a vault file, Export Vault | No. They run on the server (sync.md 14, item 5). A vault file picked offline answers "Vault files can be imported only with a connection." |
| API key, model list, account, sign-in | No. |

(b) Status bar. It is the bar of 4.11.4: same place, same look, `role="status"`, not dismissible. It shows the first row that applies:

| Condition | Icon | Text | Action |
|---|---|---|---|
| No connection, copy on | `cloud-off` | "You're offline. Changes are saved on this device and sent when you're back online." While changes wait, it goes on: "`<n>` waiting." | none |
| No connection, copy off | `cloud-off` | "You're offline. Connect to load your sessions." | none |
| The server is in read-only mode (`read_only`; web-platform.md 11.13) | `triangle-alert`, `--color-warning` | "The vault is read-only for maintenance. Changes are kept on this device and sent later." | none |
| Connected, but sending has failed for more than a minute (no answer, a 5xx or a 429 answer; sync.md 6.8) | `triangle-alert`, `--color-warning` | "Changes can't be sent right now. They are kept on this device and sent automatically." | "Try Now" |
| The account is suspended | `triangle-alert`, `--color-warning` | "Your account is suspended. You can read and export your sessions, but not add or change anything." | none |
| Notices wait to be read | `bell` | "`<n>` notice to review." or "`<n>` notices to review." | "Review" |

"No connection" means, as before: `navigator.onLine` is false, or the last request failed for lack of a connection. The row goes away when a request succeeds again.

(c) Sync row, at the foot of the library above the install row (in the compact layout at the foot of the library screen). It is drawn only when it has something to say:

| State | Icon | Text |
|---|---|---|
| The first sync is running | spinner | "Setting up the offline copy…" with a `<progress>` from `next` and `latest` of the feed (sync.md 4.2). Remove it when the feed says there is no more, whatever the value: `next` need not reach `latest`. |
| Changes wait | `cloud-upload` | "`<n>` change waiting to be sent" or "`<n>` changes waiting to be sent" |

`<n>` is the number of entries in the outbox (sync.md 6). When nothing waits there is no row; Settings says "Everything is sent."

(d) Markers on records:

| Record | Marker | Where |
|---|---|---|
| A session or project made on this device whose create has not been answered | Icon `cloud-upload` and the text "Not sent yet", caption, `--color-text-secondary` | Session: at the end of the row's meta line after a middle dot, and under the counts in the detail header. Project: the icon in place of the badge, the text as its tooltip and in its accessible name. |
| A kept record: the server refused its create (sync.md 6.7) | Icon `triangle-alert` in `--color-danger` and the text "Not saved" in `--color-text`, weight 600 | The same places. The text is not in the danger colour: on a selected row that pair is below 4.5:1 (appendix 5.6). |

A record with waiting edits only has no marker; the count is enough.

The detail of a kept session shows an error banner under the toolbar: "This session is only on this device.", then the reason, then "Try Again", "Download Context Pack" and "Delete". Reasons: for `quota_exceeded` the sentence of 4.15.1; for `validation` "The server didn't accept it."; for `unsupported` "This version of the app is too old to send it. Reload to update." "Try Again" queues a new create for the same record (sync.md 6.7). A kept project has "Try Again" and "Delete" in its row menu.

(e) Notices. sync.md 6.7 and 7 say when a device raises one. The store keeps `{ code, entity, id, at }` until the user has seen it, so the text is built when it is shown: the title or name is looked up by `id`. When the record no longer exists, the quoted title is replaced by "A session" or "A project".

| Code | sync.md | Text | Actions |
|---|---|---|---|
| `deleted_elsewhere`, a session | 7, cases 4 and 14 | "A session you changed on this device was deleted on another device. Your changes to it were not saved." | none |
| `deleted_elsewhere`, a project | 7, case 7 | "A project you changed on this device was deleted on another device. Its sessions have no project now." | none |
| `unseen_messages` | 7, case 5 | "“`<title>`” has new messages from another device, so it was not deleted." | "Open" |
| `turn_in_progress` | 7, case 6 | "Claude is still answering in “`<title>`”, so it was not deleted." | "Open" |
| `project_merged` | 7, case 9 | "“`<name>`” already existed on another device. Your sessions are in that project now." | none |
| `name_taken`, on a rename | 7, case 11 | "That project name is already used. “`<name>`” keeps its name." | none |
| `duplicate_import` | 7, case 10 | "“`<title>`” looks the same as a session you already have." | "Open", "Delete the New One" |
| `quota_exceeded`, `validation` or `unsupported`, on a create | 6.7 | "“`<title>`” was not saved to your vault. It is kept on this device." | "Open" |
| `validation`, on an edit | 6.7 | "A change to “`<title>`” was not accepted and has been undone." | "Open" |

How notices are shown:

1. Raised while the app is open: a toast with the text and its first action; it stays until dismissed. Several raised by one sync run are one toast: "`<n>` notices to review." with "Review".
2. Until read, they are counted in the status bar.
3. "Review" opens "Notices": a dialog `--width-dialog-md`, a page in the compact layout. Newest first; each notice has its text, the relative time of `at`, its actions and "Dismiss"; at the foot "Dismiss All". Dismissing a notice or using its action removes it from the store.
4. "Delete the New One" runs the ordinary delete with its confirmation (4.13).
5. A device never shows "deleted on another device" for a deletion it asked for itself (sync.md 7).
6. There is no screen for settling a conflict by hand: every case has one outcome (sync.md 14, item 8).

(f) States of the transcript in the detail pane, in addition to 4.10:

| Situation | What is shown |
|---|---|
| The transcript is not on the device and there is no connection | Icon `cloud-off`, title "Transcript Not on This Device", description "Connect to the internet to load it." |
| Part of it is on the device and there is no connection | The messages that are there, then one line in caption, secondary: "`<k>` more message(s) are not on this device yet." |
| With a connection | The skeleton of 4.10, then the messages as they arrive. |

(g) Settings, section "Offline Copy":

| Element | Content |
|---|---|
| Switch | "Keep an Offline Copy on This Device", on by default. |
| Help | "Keeps your sessions on this device so that you can read, import and edit without a connection. Changes made offline are sent when you're back online. Anyone who can use this browser profile can read the copy. Signing out deletes it." |
| Select "Download Transcripts" | "Only What I Open", "Up to 256 MB" (the default), "Everything" (sync.md 2.3, rule 1). Help: "Sessions you open are always kept." |
| Storage line | "Using `<size>` on this device.", from `navigator.storage.estimate()`. |
| Sync line | "Everything is sent. Last synced `<relative time>`." or the text of the sync row, with the button "Sync Now". |

Switching the copy off sends the waiting changes and then deletes the copy (sync.md 2.6, rule 6). If changes remain: dialog "Turn Off and Lose Changes?": "`<n>` change(s) made on this device have not been sent. Turning the offline copy off deletes them.", "Cancel", "Turn Off Anyway" (destructive). Switching it on asks for persistent storage (sync.md 2.3, rule 5) and starts the first sync.

| Situation | What is shown |
|---|---|
| The browser has no IndexedDB or refuses storage (sync.md 2.4) | The switch is off and disabled: "This browser doesn't allow an offline copy here." The app reads from the server. |
| Storage ran out while the copy was being filled (sync.md 2.3, rule 4) | A toast and the same line in Settings: "This device is out of storage, so the offline copy is paused. Your sessions are safe in your online vault." |
| Storage ran out while saving a change (sync.md 2.3, rule 4) | At the action: "Couldn't save on this device: storage is full." An import keeps its content on the import screen. |
| The open of the database is blocked by another tab (sync.md 8, rule 5) | A bar in the place of the status bar: "Close the other SessionVault tabs to finish updating." |
| The browser asks to save data (sync.md 2.3, rule 6) | In Settings: "Data saver is on: transcripts are downloaded only when you open them." |

Phone: the list without a connection with one session not sent and one not saved; and a detail whose transcript is not on the device, with the banner of a kept session below it:

```
+----------------------------------------+   +----------------------------------------+
| [<] SessionVault  All Sessions   [imp] |   | [<] All Sessions   [spk][sum][pin][...]|
+----------------------------------------+   +----------------------------------------+
| (off) You're offline. Changes are      |   | (off) You're offline. ...              |
|       saved on this device and sent    |   +----------------------------------------+
|       when you're back online.         |   | Rear derailleur indexing               |
|       3 waiting.                       |   | ...                                    |
+----------------------------------------+   | imported Nov 12, 2026 . 8 turns        |
| [(Q) Search titles, summaries, tags  ] |   +----------------------------------------+
+----------------------------------------+   |                                        |
| (spk Claude)                           |   |                 [off]                  |
| Seed order comparison            [...] |   |     Transcript Not on This Device      |
| now . 6 turns . [up] Not sent yet      |   |  Connect to the internet to load it.   |
+----------------------------------------+   |                                        |
| (msg ChatGPT)                          |   +----------------------------------------+
| Tool shed inventory              [...] |   | In the detail of a kept session:       |
| 2 hours ago . 18 turns . (!) Not saved |   | (!) This session is only on this       |
+----------------------------------------+   |     device. Your vault has reached     |
| (dia Gemini)                [pin]      |   |     its storage limit.                 |
| Rear derailleur indexing         [...] |   |     [Try Again] [Delete]               |
| yesterday . 8 turns                    |   |     [Download Context Pack]            |
+----------------------------------------+   +----------------------------------------+
```

Phone: "Notices" as a page:

```
+----------------------------------------+
| [<] All Sessions       Notices         |
+----------------------------------------+
| "Compost bin layout" has new messages  |
| from another device, so it was not     |
| deleted.                               |
| 5 minutes ago         [Open] [Dismiss] |
+----------------------------------------+
| "Garden planning" already existed on   |
| another device. Your sessions are in   |
| that project now.                      |
| 5 minutes ago                [Dismiss] |
+----------------------------------------+
| A session you changed on this device   |
| was deleted on another device. Your    |
| changes to it were not saved.          |
| yesterday                    [Dismiss] |
+----------------------------------------+
|                        [ Dismiss All ] |
+----------------------------------------+
```

Desktop: the status bar with waiting notices; the sync row above "Settings"; the markers; the "Notices" dialog:

```
+--------------------------------------------------------------------------------------------------------------------+
| [bell] 2 notices to review.                                                                             [ Review ] |
+--------------------------------------------------------------------------------------------------------------------+

+--------------------------+--------------------------------+--------------------------------------------------------+
| SessionVault             | All Sessions             [imp] |                                                        |
|                          | [(Q) Search titles, summar..]  |        +--------------------------------------+        |
| Library                  |--------------------------------|        | Notices                          [x] |        |
| [tray] All Sessions  128 | (spk Claude)                   |        +--------------------------------------+        |
| [pin]  Pinned          4 | Seed order comparison    [...] |        | "Compost bin layout" has new         |        |
| [cal]  Timeline          | now . 6 turns . [up] Not sent  |        | messages from another device, so it  |        |
|                          |--------------------------------|        | was not deleted.                     |        |
| Projects                 | (msg ChatGPT)                  |        | 5 minutes ago       [Open] [Dismiss] |        |
| [dir]  Bicycle repair  3 | Tool shed inventory      [...] |        +--------------------------------------+        |
| [dir]  Seedlings    [up] | 2 hours ago . (!) Not saved    |        | "Seed order comparison" looks the    |        |
| [dir+] New Project...    |--------------------------------|        | same as a session you already have.  |        |
|                          |                                |        | now      [Open] [Delete the New One] |        |
| ...                      |                                |        |                            [Dismiss] |        |
|--------------------------|                                |        +--------------------------------------+        |
| [up] 2 changes waiting   |                                |        |                      [ Dismiss All ] |        |
|      to be sent          |                                |        +--------------------------------------+        |
|--------------------------|                                |                                                        |
| [gear] Settings          |                                |                                                        |
+--------------------------+--------------------------------+--------------------------------------------------------+
```

Accessibility:

- The status bar is one `role="status"` region. A change of row is announced once; the count inside a row changes without an announcement.
- Markers are words, not only icons. "Not sent yet" and "Not saved" are part of the accessible name of the row.
- "Notices" is labelled by its title; the notices are a list; each action is named with the title it concerns, for example "Open “`<title>`”".
- The toast of a notice is `role="status"`: it reports, it does not interrupt.
- The `<progress>` of the first sync is labelled "Setting up the offline copy".
- Relative times are `<time datetime>` elements with the full date in `title` (4.9).
- New colour pairs are in appendix 5.6.

#### 4.15.9 Import review: warnings, left-out turns and the report per file

import-rules.md section 4 (C8, C9, C10) says what a person has to see before or with a save. `fixtures/import/README.md` says of the turns that the importer removed as page chrome: the interface must show them and let the user restore them. This section extends ReviewBlock and ImportReport of 4.6.6.

A result is reviewed before anything is stored when one of these holds:

| Trigger | Comes from | Sentence |
|---|---|---|
| `sign_in_suspected` | paste, share, capture | "This looks like a sign-in or landing page, not a conversation." |
| A warning of capture.md 7.5 | capture | The sentences of 4.6.6. |
| A capture that could not be split: one message of role `unknown` | import-rules.md C8 | "No turn structure was found; the page text will be saved as one block." |
| `dropped_turns` is not empty | capture | The "left out" list below. |

A result with none of these is saved at once, as in the Apple app. An assumed encoding stays a note on the saved result, and `unrecognised_json` stays a result line with the action "Keep as a Note" (both 4.6.6). A possible duplicate is no reason to hold a result back: both sessions are kept, and the notice `duplicate_import` of 4.15.8 says so after the save, with a way to delete the new one (sync.md 7, case 10; import-rules.md C10).

Review block, top to bottom:

1. Heading "Review Before Saving" and the source: the host, the file name, or "Pasted text".
2. The warnings, one sentence each, with the warning icon.
3. Only with dropped turns, the list: heading "`<n>` turn left out" or "`<n>` turns left out"; text "These turns at the start or end looked like page furniture, not conversation. Restore any that belong to it. Turns you leave out are not kept."; then one item per dropped turn in input order: its place ("Start" for `leading`, "End" for `trailing`), the first three lines of its text (at most 300 characters, with "Show All" for more), and a toggle button "Restore", which reads "Restored" while it is on. With two or more items, a plain button "Restore All".
4. What will be saved: "Will be saved: `<n>` turn(s)" and a read-only preview of the first 12 lines (at most 600 characters). Both follow the toggles at once.
5. Buttons "Discard" and "Save". The second reads "Save Anyway" when a warning is shown.

Rules:

1. Restoring happens before the save, because a stored transcript is never changed message by message (sync.md 6.1). After the save the turns that were left out are gone.
2. A restored turn goes back to its place in the input (`index`) and is then treated like a turn that was kept: the steps of import-rules.md W10 that follow the chrome test. The import module needs an input for this, a list of input indexes that the chrome test must keep; import-rules.md owns its name and its rule, and capture.md 8.3c passes it on from `POST /api/captures/:id/save`.
3. "Save Anyway" for `sign_in_suspected` repeats the import with the override that import-rules.md defines (`allow_wall`).
4. Leaving the Import screen with a review open asks first: dialog "Discard This Import?": "It has not been saved.", "Keep Reviewing", "Discard" (destructive).
5. Several results to review: one at a time, with "`<k>` of `<n>`" beside the heading. "Discard" and "Save" go on to the next.
6. Without a connection "Save" stores the session on the device, marked "Not sent yet" (4.15.8).
7. The words stay modest. The tests behind `sign_in_suspected` and behind the dropped turns match substrings and were never checked against a live provider page (import-rules.md 3.3). The interface says "looks like" and leaves the decision to the user.

Report per file (import-rules.md C9), after an import of more than one file:

| Part | Content |
|---|---|
| Status line | The Apple total, "Imported `<n>` session." or "Imported `<n>` sessions."; then, when files failed or wait for review, "`<k>` file needs a look." or "`<k>` files need a look.", and the "Details" list opens by itself. |
| One line per file | The file name; then "`<n>` session(s)", or the reason sentence of 4.6.6, or "Waiting for review" with the button "Review"; then its notes (an assumed encoding). |

Phone: a capture with a warning and two dropped turns, the second restored:

```
+----------------------------------------+
| Review Before Saving            1 of 2 |
| share.example.invalid                  |
|                                        |
| (!) The capture may be incomplete.     |
|                                        |
| 2 turns left out                       |
| These turns at the start or end        |
| looked like page furniture, not        |
| conversation. Restore any that belong  |
| to it. Turns you leave out are not     |
| kept.                                  |
| +------------------------------------+ |
| | Start                    [Restore] | |
| | Garden notes                       | |
| | Sign in to save this chat          | |
| +------------------------------------+ |
| +------------------------------------+ |
| | End                     [Restored] | |
| | The new design integrates a third  | |
| | bay for finished compost.          | |
| +------------------------------------+ |
| [Restore All]                          |
|                                        |
| Will be saved: 9 turns                 |
| +------------------------------------+ |
| | User: How big should each bay be?  | |
| | Assistant: About one cubic metre.. | |
| | ...                                | |
| +------------------------------------+ |
| [ Discard ]            [ Save Anyway ] |
+----------------------------------------+
```

Desktop, inside the Import dialog:

```
        +------------------------------------------------------------+
        | Import Sessions                                        [x] |
        +------------------------------------------------------------+
        | [compass] From Link                                        |
        | ...                                                        |
        +------------------------------------------------------------+
        | Review Before Saving . share.example.invalid        1 of 2 |
        | (!) The capture may be incomplete.                         |
        |                                                            |
        | 2 turns left out                                           |
        | These turns at the start or end looked like page furniture,|
        | not conversation. Restore any that belong to it. Turns you |
        | leave out are not kept.                                    |
        | +--------------------------------------------------------+ |
        | | Start  Garden notes / Sign in to save this.. [Restore] | |
        | | End    The new design integrates a third..  [Restored] | |
        | +--------------------------------------------------------+ |
        | [Restore All]                       Will be saved: 9 turns |
        | +--------------------------------------------------------+ |
        | | User: How big should each bay be?                      | |
        | | Assistant: About one cubic metre each works well.      | |
        | +--------------------------------------------------------+ |
        |                               [ Discard ]  [ Save Anyway ] |
        +------------------------------------------------------------+
        |                                                   [ Done ] |
        +------------------------------------------------------------+
```

The report per file (both widths; on a phone each file takes two lines):

```
        +--------------------------------------------------------------+
        | (ok) Imported 12 sessions. 2 files need a look.  [Details ^] |
        +--------------------------------------------------------------+
        | compost-notes.md       1 session                             |
        | conversations.json     11 sessions                           |
        | gear-ratios.txt        Waiting for review           [Review] |
        | notes-old.txt          1 session . read as Windows-1252      |
        | export.json            not a known chat export               |
        |                                             [Keep as a Note] |
        +--------------------------------------------------------------+
```

Accessibility:

- The review block is a `<section>` labelled by its heading. Focus moves to the heading when the block appears, and to the status line after "Save" or "Discard".
- Warnings and dropped turns are lists. Each toggle is a button with `aria-pressed`, named with its place and number, for example "Restore turn 1 of 2, start".
- The turn count is in the polite region, so that a toggle is confirmed by "9 turns".
- The preview is text, never HTML (4.7.3), with `dir="auto"`.
- The report is a list; "Review" and "Keep as a Note" name their file.

#### 4.15.10 Link capture from the server

capture.md 8.3 (tier T3): the server opens a public share link in a headless browser of its own and hands the result to the import path. Public share links only, allow-listed hosts only, never a sign-in. Every provider is switched off until its selectors were checked on one real public page and the owner has agreed to automated capture for it (`../HANDOFF.md` phase 3). This section adds states to the From Link section of 4.5.6 and 4.6.6, whose stage texts and failure messages stand.

What the page knows: `GET /api/capture-config` (capture.md 8.3) says whether capture is on (`enabled`) and, for each provider, whether the server captures its links (`server_capture`). Labels and link patterns come from the selectors data file, which the page has (capture.md 7.1). The page uses this only to decide what to draw. The server decides again on every request. On the wire the fields are in `snake_case` (`capture_id`, `turns_so_far`); the component props of 4.6.6 keep their names.

| State | Condition | What is shown |
|---|---|---|
| empty | The field is empty. | The help text only. |
| not a link | `looksLikeLink` (capture.md 8.1) refuses the text. | "That doesn't look like a link." |
| link, no capture for it | Server capture is not built yet (before phase 3) or is switched off, or the host belongs to no known provider. | "Open Link" and its instruction (4.6.6). |
| not enabled | The link is a public share link of a known provider whose switch is off. | "Open Link" and its instruction, with the info line "Capture isn't switched on for `<Provider>` links yet. Open the link and paste the conversation instead." There is no "Capture Transcript" button, neither enabled nor disabled. |
| needs sign-in | The link belongs to a known provider but is not one of its public share links. | The tip of 4.6.6, "Open Link" and its instruction. For a link that matches `signedInLinks` of its provider (capture.md 7.1 and 13.5; today, Claude Code session links) the tip is: "Claude Code session links need your own sign-in, so they can't be captured from here. You can open the link, copy the conversation and paste it below, but the result will be incomplete: only what is on screen is copied, and what tools read and returned is missing. A complete import of these sessions is not available yet." |
| ready | A public share link of a provider that is switched on. | The primary button "Capture Transcript", then "Open Link". |
| running | queued, `loading`, `waiting_for_content`, `extracting`, `processing` (capture.md 8.3) | A progress line: spinner, the stage text of 4.6.6, "Cancel". Under it in caption: "This can take up to two minutes." The count in "Capturing… `<n>` turns so far" appears only if the server reports one; otherwise "Capturing…". |
| connection lost | Polling fails. | "Lost the connection. The capture may still be running." with "Check Again". |
| saved | Done, nothing to review. | "Captured `<n>` turns from `<host>`." ("1 turn" is singular) with "Open". Both fields are cleared (B22). |
| review | Done, with a warning of capture.md 7.5 or with dropped turns. | The review block of 4.15.9, fed by `warnings`, `dropped_turns`, `preview` and `turn_count` of the answer. "Save" is `POST /api/captures/:id/save`, which names the turns to restore by their input index; "Discard" is `DELETE /api/captures/:id`. The server keeps a waiting result for 24 hours (capture.md 8.3). |
| failed | A failure code of capture.md 7.5. | Its message in 4.6.6; "Try Again" for `busy`, `rate_limited`, `navigation_failed`, `timeout` and `internal_error`. |
| cancelled | "Cancel" was pressed. | No message; back to "ready"; nothing is saved (B24). |
| offline | No connection. | "Capture Transcript" is disabled: "You're offline." |

Other answers: `provider_disabled` although the page offered the button (the switch has changed) gives the "not enabled" line. `quota_exceeded`, `account_suspended` and `not_signed_in` are in 4.15.1; the link stays in the field.

Rules:

1. One capture at a time per user (capture.md 8.3). While one runs, the button is disabled; a second request answers `busy`.
2. Closing Import cancels a running capture (4.6.6). A reload or a lost connection does not: the page finds the capture again by its id, which it keeps in `sessionStorage`.
3. The help text under the fields names what can be captured. With at least one provider switched on: "Public share links from `<the providers that are switched on>` capture with no login. For anything else, open the link, copy the conversation and paste it below." With none: "A web page can't open another site for you. Open the link yourself, copy the conversation and paste it below."
4. A result is never called complete. The status says how many turns were captured; warnings say what may be missing.
5. First release: no page snapshot is stored (`../HANDOFF.md` section 6), so the endings about a PDF in 4.6.6 are not used.
6. The interface never asks for a provider's password, cookie or token and never offers to sign in to a provider (capture.md 8.3, rule 4, and section 10).
7. The wording for Claude Code session links rests on one capture made by the owner with the Apple app on 2026-11-20 and reported as a pattern: tool activity appeared only as one-line summaries, and the link needed a signed-in viewer (capture.md 13). Nothing was verified for pasted text. The complete source for such a session is the structured transcript that the page loads as data; it cannot be imported yet (`../HANDOFF.md` section 5). When that import exists, the last sentence of the tip names it.
8. Notes on a saved session, from its capture record (`x_capture`, capture.md 7.3), shown in caption with the info icon under the counts of the detail header. When `page_type` is set: "Captured as page text from a signed-in page. What tools read and returned is not included." When `images_seen` is above 0: "`<n>` image was not stored." or "`<n>` images were not stored."; the same sentence follows the status line after the capture.

Phone: "not enabled" and "running":

```
+----------------------------------------+   +----------------------------------------+
| [compass] From Link                    |   | [compass] From Link                    |
| [https://share.example.invalid/sh.. ]  |   | [https://claude.ai/share/EXAMPLE-0..]  |
| [Name (optional - auto-detected fr..]  |   | [Name (optional - auto-detected fr..]  |
| (i) Capture isn't switched on for      |   | [         Capture Transcript         ] |
|     Gemini links yet. Open the link    |   | (o) Waiting for the conversation...    |
|     and paste the conversation         |   |                               [Cancel] |
|     instead.                           |   | This can take up to two minutes.       |
| [Open Link]  Or open the link, copy    |   | [Open Link]  Or open the link, copy    |
| the whole conversation and paste it    |   | the whole conversation and paste it    |
| below. The link is saved with it.      |   | below. The link is saved with it.      |
+----------------------------------------+   +----------------------------------------+
```

Phone: "failed", and a Claude Code session link (`...` stands for the rest of the text):

```
+----------------------------------------+   +----------------------------------------+
| [compass] From Link                    |   | [compass] From Link                    |
| [https://claude.ai/share/EXAMPLE-0..]  |   | [https://claude.ai/code/EXAMPLE-00..]  |
| [Name (optional - auto-detected fr..]  |   | [Name (optional - auto-detected fr..]  |
| [         Capture Transcript         ] |   | (i) Claude Code session links need     |
| (!) The page couldn't be loaded.       |   |     your own sign-in, so they can't    |
|                            [Try Again] |   |     be captured from here. Open the    |
| [Open Link]  Or open the link, copy    |   |     link, copy the conversation and    |
| the whole conversation and paste it    |   |     paste it below. ...                |
| below. The link is saved with it.      |   | [Open Link]                            |
+----------------------------------------+   +----------------------------------------+
```

Desktop, inside the Import dialog, with the three other status lines listed below the running one:

```
        +--------------------------------------------------------------+
        | Import Sessions                                          [x] |
        +--------------------------------------------------------------+
        | [compass] From Link                                          |
        | [https://claude.ai/share/EXAMPLE-0000                      ] |
        | [Name (optional - auto-detected from the page)             ] |
        | [ Capture Transcript ]  [ Open Link ]                        |
        | (o) Capturing... 18 turns so far                  [ Cancel ] |
        | This can take up to two minutes.                             |
        | Public share links from Claude capture with no login. For    |
        | anything else, open the link, copy the conversation and      |
        | paste it below.                                              |
        |                                                              |
        | not enabled:  (i) Capture isn't switched on for Gemini       |
        |                   links yet. Open the link and paste the     |
        |                   conversation instead.        [ Open Link ] |
        | failed:       (!) The page couldn't be loaded. [ Try Again ] |
        | saved:        (ok) Captured 42 turns from claude.ai.  [Open] |
        +--------------------------------------------------------------+
        | [folder] From Files                                          |
        | ...                                                          |
        +--------------------------------------------------------------+
```

Accessibility:

- The progress line is `role="status"`. A change of stage is announced once; the turn count changes without an announcement. The spinner is `aria-hidden`.
- "Cancel" follows the progress line in the focus order.
- A failure is `role="alert"`. The info line of "not enabled" and the tips are tied to the link field with `aria-describedby`.
- Icon shape and text carry the state, never colour alone.

#### 4.15.11 Components, types and icons added

Names are suggestions, as in 4.6.

```ts
// The key part of GET /api/claude/config (claude-api.md C6); null when no key is saved.
type KeyState = null | {
  status: "ok" | "unknown" | "rejected";
  last4: string;
  savedAt: string; checkedAt: string | null; lastUsedAt: string | null;
};

type RecordSync = "sent" | "unsent" | "kept";             // 4.15.8 (d)

interface Notice { n: number; code: string; entity: "project" | "session"; id: string; at: string }   // sync.md 8

interface SyncSummary {
  online: boolean;
  copy: "on" | "off" | "unavailable";
  firstSync: { next: number; latest: number } | null;     // null when it has finished
  waiting: number;                                         // entries in the outbox
  failingSince: string | null;
  readOnly: boolean;                                       // the server answered read_only
  lastSyncedAt: string | null;
}

interface CaptureConfig { enabled: boolean; providers: { id: ProviderId; label: string; serverCapture: boolean }[] }

interface DroppedTurn { position: "leading" | "trailing"; index: number; text: string }   // fixtures/import/README.md
```

`SessionListItem` of 4.6.1 gains `sync: RecordSync`; project items gain the same field.

| Component | Props | Defined in |
|---|---|---|
| AuthFrame | `note?: string`, `message?: Status`, `children` | 4.15.2: icon, name, tagline, note line, message line, links |
| SignInForm, RecoverForm | `method`, `onDone()` | 4.15.2 |
| InviteForm | `initialCode?: string` | 4.15.3: both steps |
| ReauthDialog | `onConfirmed()` | 4.15.4: "Confirm It's You" |
| DeleteAccountDialog | `waiting: number` | 4.15.4 |
| KeyLine | `state: KeyState` | 4.15.5 |
| KeyForm | `replacing: boolean`, `onSaved(state: KeyState)` | 4.15.5 |
| ConnectToClaude | `onAdd()` | 4.15.5, 4.6.7: the block in the chat |
| ModelChooser | `models: { id; name; inRegistry; priceClass }[]`, `value`, `onChange(id)`, `onAdd(id)` | 4.15.6 |
| CopyMessageButton | `getText(): string`, `disabledReason?: string`, `describedBy: string` | 4.15.7 |
| StatusBar | `sync: SyncSummary`, `account: "active" \| "suspended"`, `noticeCount: number` | 4.15.8 (b); it takes the place of the offline bar |
| SyncRow | `sync: SyncSummary` | 4.15.8 (c) |
| SyncMarker | `state: RecordSync` | 4.15.8 (d) |
| NoticeList | `notices: Notice[]`, `onDismiss(n)`, `onAction(n, action)` | 4.15.8 (e) |
| DroppedTurnList | `turns: DroppedTurn[]`, `restored: number[]`, `onToggle(index)` | 4.15.9 |

Icons added to 4.12 (Lucide names from memory, unverified like the others):

| Purpose | Lucide icon |
|---|---|
| API key, the "Connect to Claude" block | `key-round` |
| changes waiting, "Not sent yet" | `cloud-upload` (`upload-cloud`) |
| notices | `bell` |
| restore a turn that was left out | `undo-2` |
| account | `circle-user` (`user-circle`) |
| remove one of the user's models | `x` |

### 4.16 Decisions for the owner

Build the default until the owner answers. The first two need the owner before strangers can sign up (`../HANDOFF.md` section 9); the others can wait. Questions that another document already lists are named with their place and not asked twice.

| # | Question | Default |
|---|---|---|
| 1 | Which sign-in method (web-platform.md section 17, decision 1)? Only the method block of 4.15.2 and step 2 of 4.15.3 depend on it. | Built into the app: e-mail address and password while no mail provider is configured; invitation codes. |
| 2 | The terms and privacy texts (web-platform.md 11.14, G14). With them: the privacy sentence in Settings and the "not deleted" text of the account deletion dialog (4.15.4), and what the key screen says about how a key is kept (4.15.5; claude-api.md C14). | The links stay hidden until the texts exist; the sentences as written here. |
| 3 | The app icon artwork (4.11.1). | The placeholder. |
| 4 | Show the last four characters of a saved API key (data-model.md, decision 13)? | Yes. |
| 5 | Account deletion at once after a typed confirmation, or with some days to change one's mind (data-model.md, decision 11)? | At once. |
| 6 | Ask before deleting a session or a project (B17; data-model.md, decision 4)? | Ask. |
| 7 | Always show an import before saving it, or save clean results at once (import-rules.md, decision 4)? | Save clean results at once; review what was flagged or had turns left out. |
| 8 | Repeat the Copy button at the end of long messages (4.15.7, rule 2)? | Yes, above 1,500 characters. |
| 9 | Offer the "Prompt Cache" and "Fallback Model" settings in the first release (4.15.6)? | Yes. The cache setting decides what a single question costs. |
| 10 | After a reply was cut off: nothing ready-made, or a "Continue" button that sends one fixed sentence? The first version of this document had the button. | Nothing ready-made: the user writes the next message (claude-api.md C7 and C17). |
| 11 | Draw block-level Markdown (headings, lists, tables) in transcripts (4.7.2)? | No, as in the Apple app. |
| 12 | May the copy on a device be on by default (sync.md, decision 1)? | Yes, with the sentence in Settings that anyone using the browser profile can read it. |

---

## 5. Appendix: evidence

Scratch material stays outside the repository; the commands and results are summarised here so that the claims can be re-checked.

### 5.1 Colours measured in the screenshots

The three PNG files in apple/screenshots/ (1206 x 2622, sRGB, iOS simulator, light appearance) were decoded and the most frequent colours of small rectangles were read.

| Screenshot | Element | Colour | Matches |
|---|---|---|---|
| 01 | chip text, back button, Import icon | #007AFF | system blue (light) |
| 01 | chip background | #D9EBFF | #007AFF at 15 % over white |
| 01 | row meta text | #7F7F7F | |
| 01, 02 | separators, divider | #C6C6C8 | system separator over white |
| 02 | bubble of a "Note" message | #F8F8F8 | secondary label colour at 6 % over white |
| 02 | role label on that bubble | #87878B | secondary label colour over #F8F8F8 |
| 02 | "imported … · 3 turns" | #8A8A8E | secondary label colour over white |
| 02 | placeholder text | #C5C5C7 | |
| 02 | date control background | #EFEFF0 | |
| 02 | title, body text | #000000 | |
| 03 | prominent button | #007AFF with white text | |
| 03 | capture bar background | about #F7F8F7 | bar material |
| 03 | status text and globe | about #868886 | secondary |

### 5.2 Contrast

Computed with the WCAG 2 relative-luminance formula; translucent colours were first composited over their background in sRGB.

Apple app, light appearance (the dark values were not measured, only computed from Apple's published colours):

| Pair | Ratio |
|---|---|
| Claude chip: #FF9500 on #FFEFD9 | 1.95:1 |
| ChatGPT chip: #30B0C7 on #E0F3F7 | 2.25:1 |
| Gemini chip: #007AFF on #D9EBFF | 3.30:1 |
| Other chip: #8E8E93 on #EEEEEF | 2.81:1 |
| secondary text #8A8A8E on white | 3.44:1 |
| list meta text #7F7F7F on white | 4.00:1 |
| role label #87878B on #F8F8F8 | 3.37:1 |
| placeholder-level text #C5C5C7 on white | 1.72:1 |
| accent text #007AFF on white; white on #007AFF | 4.02:1 |
| orange pin icon #FF9500 on white | 2.20:1 |
| green status icon #34C759 on white | 2.22:1 |

Tokens of section 4.2 (text needs 4.5:1, icons and outlines 3:1). Lowest ratios found:

| Theme | Lowest text pair | Lowest non-text pair |
|---|---|---|
| light | `--color-accent` on `--color-selected`: 4.60:1 | `--color-border-control` on `--color-bg-sidebar`: 3.20:1 |
| dark | `--color-text-on-accent` on `--color-accent-fill`: 4.70:1 | `--color-danger-fill` on `--color-surface-raised`: 3.18:1 |

Pairs checked in both themes: text on bg, sidebar, raised surface, hover, selected, both bubbles, field, neutral fill and danger wash; secondary text on the same except danger wash; tertiary text on bg, surface, raised surface and field; accent on bg, sidebar, raised surface, hover, selected and the user bubble; white on the accent and danger fills; danger, success and warning on bg and raised surface; each provider text colour on its chip background, and as an icon on the sidebar and on a selected row; control borders, focus ring and pin icon on the surfaces they sit on; text and secondary text on a code block over each bubble.

### 5.3 Behaviour checked by running Apple's frameworks

Compiled with `xcrun swiftc` on macOS and run on synthetic input only.

1. The body of `MessageSegment.parse` and the paragraph rule, copied verbatim from apple/SessionVault/Views/MessageView.swift:79-126 and :143-147 (line numbers as of commit `e81828a`, which moved this code without changing it): the table in section 1.10.2.
2. `AttributedString(markdown:options:)` with `.inlineOnlyPreservingWhitespace`, the call at MessageView.swift:149-156: the tables in sections 1.10.3 and 4.7.2. Further results: `a*b*c` gives an italic b; `x**y**z` a bold y; `use **kwargs or **options here` and `*.md and *.txt files` stay literal; `~single~` is struck through; a link destination with one level of parentheses works; markup inside a link label is applied.
3. `URL(string:)` as used at apple/SessionVault/Views/ImportSheet.swift:51: nil for the empty string and for `ht!tp://x`; not nil for "hello", "hello world", "not a url at all", "http://", "%%%".
4. The clipboard link rule of ImportSheet.swift:205-217: true for a share link with and without scheme, and also for "notes.md", "hello.", "v1.2", "3.14" and a `mailto:` address; false for "User: hi", "one-word" and text with a line break.
5. `Date.RelativeFormatStyle(presentation: .named)` in an English locale for 0 s, 30 s, 90 s, 3 h, 26 h, 2 d, 8 d, 20 d, 45 d and 400 d: "now", "30 seconds ago", "2 minutes ago", "3 hours ago", "yesterday", "2 days ago", "last week", "3 weeks ago", "last month", "last year". `relativeParts` in appendix 5.4 gives the same ten strings through `Intl.RelativeTimeFormat`.
6. The month key format gives "November 2026"; the abbreviated date format gives "Nov 1, 2026".

### 5.4 Reference implementation of the display rules

Plain JavaScript without DOM or Node dependencies; add types when moving it into the shared TypeScript module. It was run with the JavaScriptCore shell against the golden cases below and against fixture 57 of import-rules.md; all passed. It has not been through a TypeScript compiler or a browser.

````js
// ---- 4.7.1 prose and code segments -------------------------------------------------------
// Gives the results of fixture 57 in import-rules.md (fixtures/import/57-display-segments-table).
function segmentText(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let prose = [], code = [], language = null, fence = 0;
  const flushProse = () => {
    const joined = prose.join("\n");
    prose = [];
    if (joined.trim() !== "") out.push({ type: "prose", text: joined });
  };
  const flushCode = () => {
    out.push({ type: "code", language, code: code.join("\n") });
    code = []; language = null; fence = 0;
  };
  for (const line of lines) {
    const t = line.replace(/^[ \t]+|[ \t]+$/g, "");
    if (fence > 0) {
      const close = /^`{3,}$/.test(t) && t.length >= fence;
      if (close) flushCode(); else code.push(line);
      continue;
    }
    const open = /^(`{3,})([^`]*)$/.exec(t);
    if (open) {
      flushProse();
      fence = open[1].length;
      const info = open[2].trim();
      language = info === "" ? null : info;
    } else {
      prose.push(line);
    }
  }
  if (fence > 0) flushCode(); else flushProse();
  return out;
}

// A blank line (it may hold spaces or tabs) ends a paragraph. Indentation is kept.
function splitParagraphs(prose) {
  return prose
    .split(/\n(?:[ \t]*\n)+/)
    .map((p) => p.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, ""))
    .filter((p) => p.trim() !== "");
}

// ---- 4.7.2 inline grammar ----------------------------------------------------------------
const LOOKAHEAD = 2000;
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;
const INERT_AFTER_BACKSLASH = "`*~[]\\";
const isWord = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch) => ch === undefined || /\s/.test(ch);
const count = (s, ch) => s.split(ch).length - 1;

function findBackticks(s, from, n) {
  const end = Math.min(s.length, from + LOOKAHEAD);
  for (let j = from; j < end; j++) {
    if (s[j] !== "`") continue;
    let run = 1;
    while (s[j + run] === "`") run++;
    if (run === n) return j;
    j += run - 1;
  }
  return -1;
}

function findCloser(s, from, delim) {
  const end = Math.min(s.length, from + LOOKAHEAD);
  const c = delim[0];
  for (let j = from; j < end; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] !== c) continue;
    let run = 1;
    while (s[j + run] === c) run++;
    if (run === delim.length && j > from && !isSpace(s[j - 1]) && !isWord(s[j + run])) return j;
    j += run - 1;
  }
  return -1;
}

function parseInline(s) {
  const out = [];
  let buf = "";
  const push = (node) => {
    if (buf !== "") { out.push({ type: "text", text: buf }); buf = ""; }
    if (node) out.push(node);
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // 1. A backslash makes the next delimiter character inert. Nothing is removed.
    if (ch === "\\" && i + 1 < s.length && INERT_AFTER_BACKSLASH.includes(s[i + 1])) {
      buf += ch + s[i + 1]; i += 2; continue;
    }
    // 2. Code span: a run of n backticks up to the next run of exactly n backticks.
    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n++;
      const close = findBackticks(s, i + n, n);
      if (close !== -1) {
        let text = s.slice(i + n, close);
        if (text.length > 2 && text[0] === " " && text[text.length - 1] === " " && text.trim() !== "") text = text.slice(1, -1);
        push({ type: "code", text });
        i = close + n; continue;
      }
      buf += s.slice(i, i + n); i += n; continue;
    }
    // 3. [label](destination) and ![label](destination): a link, only for safe schemes.
    if (ch === "[" || (ch === "!" && s[i + 1] === "[")) {
      const start = ch === "!" ? i + 1 : i;
      const m = /^\[([^\]\n]{0,500})\]\(((?:[^\s()]|\([^\s()]*\)){1,2000})\)/.exec(s.slice(start, start + 2600));
      if (m && SAFE_LINK.test(m[2])) {
        push({ type: "link", href: m[2], text: m[1] === "" ? m[2] : m[1] });
        i = start + m[0].length; continue;
      }
    }
    // 4. Bare http and https addresses.
    if ((ch === "h" || ch === "H") && !isWord(s[i - 1]) && /^https?:\/\//i.test(s.substr(i, 8))) {
      const m = /^https?:\/\/[^\s<>]+/i.exec(s.slice(i, i + LOOKAHEAD));
      if (m) {
        let url = m[0];
        for (;;) {
          const last = url[url.length - 1];
          if (".,;:!?'\"".includes(last)) { url = url.slice(0, -1); continue; }
          if (last === ")" && count(url, "(") < count(url, ")")) { url = url.slice(0, -1); continue; }
          if (last === "]" && count(url, "[") < count(url, "]")) { url = url.slice(0, -1); continue; }
          break;
        }
        if (/^https?:\/\/[^\s\/]/i.test(url)) {
          push({ type: "link", href: url, text: url });
          i += url.length; continue;
        }
      }
    }
    // 5. ***strong emphasis***, **strong**, *emphasis*, ~~strikethrough~~. Underscores are never markup.
    if (ch === "*" || ch === "~") {
      let run = 1;
      while (s[i + run] === ch) run++;
      const delim = ch === "*" ? (run <= 3 ? ch.repeat(run) : null) : (run === 2 ? "~~" : null);
      if (delim && !isSpace(s[i + run]) && !isWord(s[i - 1])) {
        const close = findCloser(s, i + run, delim);
        if (close !== -1) {
          const children = parseInline(s.slice(i + run, close));
          const node = delim === "~~" ? { type: "strike", children }
            : delim === "*" ? { type: "em", children }
            : delim === "**" ? { type: "strong", children }
            : { type: "strong", children: [{ type: "em", children }] };
          push(node);
          i = close + run; continue;
        }
      }
      buf += s.slice(i, i + run); i += run; continue;
    }
    buf += ch; i++;
  }
  push(null);
  return out;
}

// ---- 4.7.4 blocks for long messages ------------------------------------------------------
// Turns one message text into the blocks that are drawn: code blocks (blank ones are left out,
// the label is the first word of the language tag), and prose chunks of at most maxChars
// characters. A paragraph longer than maxChars is cut at line breaks; a single line longer than
// maxLine is cut at maxLine. Pieces after the first carry continues: true and are drawn
// directly under the previous piece with no paragraph gap.
function renderBlocks(text, maxChars = 6000, maxLine = 50000) {
  const blocks = [];
  for (const seg of segmentText(text)) {
    if (seg.type === "code") {
      const label = seg.language === null ? null : seg.language.split(/\s+/)[0];
      if (seg.code.trim() !== "") blocks.push({ type: "code", language: label, code: seg.code });
      continue;
    }
    let chunk = [], size = 0;
    const flush = () => {
      if (chunk.length) { blocks.push({ type: "prose", paragraphs: chunk }); chunk = []; size = 0; }
    };
    for (const paragraph of splitParagraphs(seg.text)) {
      splitLong(paragraph, maxChars, maxLine).forEach((piece, k) => {
        if (size > 0 && size + piece.length > maxChars) flush();
        chunk.push({ text: piece, continues: k > 0 });
        size += piece.length;
      });
    }
    flush();
  }
  return blocks;
}

function splitLong(paragraph, maxChars, maxLine) {
  if (paragraph.length <= maxChars) return [paragraph];
  const pieces = [];
  let current = null;
  const flush = () => { if (current !== null) { pieces.push(current); current = null; } };
  for (const line of paragraph.split("\n")) {
    if (line.length > maxLine) {
      flush();
      for (let k = 0; k < line.length; k += maxLine) pieces.push(line.slice(k, k + maxLine));
      continue;
    }
    if (current !== null && current.length + 1 + line.length > maxChars) flush();
    current = current === null ? line : current + "\n" + line;
  }
  flush();
  return pieces;
}

// ---- small display helpers ---------------------------------------------------------------
// First non-blank line of a summary for list rows, without Markdown markers (B15).
function summaryLine(summary) {
  for (const line of summary.replace(/\r\n?/g, "\n").split("\n")) {
    const t = line.replace(/^(?:[\s#>*-]|\d+\.\s)+/, "").replace(/\*\*|`/g, "").trim();
    if (t !== "") return t;
  }
  return "";
}

// Download name for a session's PDF or context pack (B30; the same rule as data-model.md B15
// and web-platform.md B9).
function safeFileName(title, extension) {
  let base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/[. ]+$/, "").slice(0, 120).trim();
  if (base === "") base = "session";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = "_" + base;
  return base + extension;
}

// Relative time for list rows: format the result with
// new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit).
function relativeParts(secondsAgo) {
  const d = Math.max(0, secondsAgo);
  const DAY = 86400, MONTH = 30.44 * DAY, YEAR = 365.25 * DAY;
  if (d < 1) return { value: 0, unit: "second" };
  if (Math.round(d) < 60) return { value: -Math.round(d), unit: "second" };
  if (Math.round(d / 60) < 60) return { value: -Math.round(d / 60), unit: "minute" };
  if (Math.round(d / 3600) < 24) return { value: -Math.round(d / 3600), unit: "hour" };
  if (Math.round(d / DAY) < 7) return { value: -Math.round(d / DAY), unit: "day" };
  if (d < MONTH) return { value: -Math.max(1, Math.round(d / (7 * DAY))), unit: "week" };
  if (Math.round(d / MONTH) < 12) return { value: -Math.round(d / MONTH), unit: "month" };
  return { value: -Math.max(1, Math.round(d / YEAR)), unit: "year" };
}
````

Golden cases (all pass). `F` stands for three backticks, `\n` for a line break. In the result column, `code[lang]` is a code block and `<strong:…>`, `<em:…>`, `<strike:…>`, `<code:…>`, `<link:text @ address>` are inline nodes.

`segmentText`:

| Input | Result |
|---|---|
| `Intro line\nFpython\nprint(1)\nF\nOutro line` | prose "Intro line"; code[python] "print(1)"; prose "Outro line" |
| `Before\nFsh\nls -la\nstill code` | prose "Before"; code[sh] "ls -la\nstill code" |
| `Before\r\nFpython\r\nprint(1)\r\nF\r\nAfter` | prose "Before"; code[python] "print(1)"; prose "After" |
| four backticks, `code`, four backticks, `after` | code[none] "code"; prose "after" |
| `FcodeF\nnext line` | one prose segment, unchanged |
| two spaces + `Fjs`, `  let x = 1`, two spaces + `F`, `tail` | code[js] "  let x = 1"; prose "tail" |
| `F\nF` | code[none] with empty text (`renderBlocks` leaves it out) |
| `Fmd\nFpython\nx = 1\nF\nrest` | code[md] "Fpython\nx = 1"; prose "rest" |
| `~~~\ncode\n~~~` | one prose segment, unchanged |
| `F python title="a.py"\nx\nF` | code[python title="a.py"] "x" (`renderBlocks` labels it "python") |
| four backticks + `md`, `Fjs`, `x`, `F`, four backticks, `end` | code[md] "Fjs\nx\nF"; prose "end" |
| `a\rF\rb\rF\rc` (lone carriage returns) | prose "a"; code[none] "b"; prose "c" |

`splitParagraphs`:

| Input | Result |
|---|---|
| `one\n\ntwo\n\n\nthree\n \nfour` | "one", "two", "three", "four" |
| `def f():\n    return 1\n\n    indented start` | "def f():\n    return 1", "    indented start" |

`parseInline`:

| Input | Result |
|---|---|
| ``**bold** and *italic* and `code` and ~~strike~~`` | `<strong:bold> and <em:italic> and <code:code> and <strike:strike>` |
| `see [a link](https://example.com/page) now` | `see <link:a link @ https://example.com/page> now` |
| `bare https://example.com/path url.` | `bare <link:https://example.com/path @ https://example.com/path> url.` |
| `see https://example.com/a_(b). Next` | the link ends after `(b)`; `. Next` is text |
| `[unsafe](javascript:alert(1)) and [mail](mailto:someone@example.com)` | `[unsafe](javascript:alert(1)) and <link:mail @ mailto:someone@example.com>` |
| `[d](data:text/html,x) [f](file:///etc/hosts)` | unchanged text |
| `![alt text](https://example.com/x.png)` | `<link:alt text @ https://example.com/x.png>` |
| `__init__ and _private_var_ and snake_case_name` | unchanged text |
| `a*b*c and x**y**z and 2 * 3 * 4` | unchanged text |
| `use **kwargs or **options here, def f(*args, **kwargs)` | unchanged text |
| `*.md and *.txt files` | unchanged text |
| `char *p, *q; *ptr = *other; (*it)*2` | unchanged text |
| `regex ^\d+\.\d+$ and path C:\temp\*.txt` | unchanged text |
| `\*not italic\* and \# text` | unchanged text |
| `5 ~~ 6 and ~single~ and ~10 cm, ~20 cm` | unchanged text |
| `# Heading\n- item one\n1. first\n> quote` | unchanged text |
| `<b>x</b> <script>alert(1)</script>` | unchanged text |
| ``**bold with `code` and *em* inside** tail`` | ``<strong:bold with <code:code> and <em:em> inside> tail`` |
| `***both*** done` | `<strong:<em:both>> done` |
| `*italic **bold** more*` | `<em:italic <strong:bold> more>` |
| `(**note**) and "*quoted*".` | `(<strong:note>) and "<em:quoted>".` |
| `unbalanced **bold and *italic` | unchanged text |
| two backticks, `code with`, one backtick, `backtick`, two backticks, `done` | one code node whose text contains the single backtick, then the text " done" |
| `` `unclosed code span `` | unchanged text |
| `FcodeF next` | `<code:code> next` |
| `` `a*b*c` and `**x**` `` | `<code:a*b*c> and <code:**x**>` |
| `xhttps://example.com and HTTPS://EXAMPLE.COM/A` | the first stays text; the second is a link |
| `[label with **bold**](https://example.com/z)` | `<link:label with **bold** @ https://example.com/z>` |

Other helpers:

| Call | Result |
|---|---|
| `summaryLine("\n## Summary\n\nThree-bay plan")` | "Summary" |
| ``summaryLine("- **Goal**: build a `bin`\n- next")`` | "Goal: build a bin" |
| `safeFileName("Bay 1/2: what \"size\"? <draft>.", ".pdf")` | "Bay 1-2- what -size-- -draft-.pdf" |
| `safeFileName(" .. ", ".md")` | "session.md" |
| `safeFileName("NUL", ".pdf")` | "_NUL.pdf" |
| `renderBlocks` on 120,000 characters without a line break | three prose blocks of 50,000, 50,000 and 20,000 characters, the last two marked `continues` |
| `renderBlocks` on "intro", a 400-line paragraph of 19,889 characters, a code block, "outro" | four prose blocks, one code block, one prose block; no chunk above 6,000 characters; joining the pieces gives back the text |
| `relativeParts` for 59.6 s, 3,580 s, 84,960 s, 570,240 s, 2,591,000 s, 30,000,000 s | "1 minute ago", "1 hour ago", "yesterday", "last week", "4 weeks ago", "11 months ago" |

Speed, on a desktop JavaScript engine: a 1,037,500-character message gives 174 blocks in a few milliseconds and 75,000 inline nodes in about 15 ms; a 260,000-character input made only of unbalanced markup takes 20 to 40 ms.

### 5.5 What was not verified

- How the Apple app looks on macOS, on iPad and in the dark appearance: there are three iPhone screenshots in the light appearance and nothing else. Statements about those are marked as inferences.
- System-provided wording (`ContentUnavailableView.search`), the hidden badge at 0, Return in the chat field on iOS.
- Lucide icon names (no copy of the package was available).
- Browser support figures given "from memory": `content-visibility`, `interactive-widget`. The figures for the clipboard, Web Share, share target and install prompt come from browser-compat-data 8.1.10 as collected for web-platform.md.
- The rendering performance of the transcript technique in a real browser on a phone. Only the pure functions were timed.
- Which files Chromium accepts in a share, the size limit for shared text on Android, and the behaviour of Android file pickers with `accept`.
- Whether a new tab opened from an app installed on an iPhone home screen is signed in (section 4.6.8).
- That the Apple app's PDF is a single tall page.
- Whether dialogs, menus and windowing libraries run under the Content-Security-Policy of web-platform.md without changes.
- The other handoff documents were written at the same time. This document was aligned with data-model.md, claude-api.md, web-platform.md, capture.md and import-rules.md as they stood shortly before it was finished. Where they differ from this document on their own subject, they win.
- Added on 2026-11-20: nothing in sections 4.15 and 4.16 was built or run. Their strings, states and wireframes are a specification.
- The Copy button of the Apple app (section 1.10.1) was read in the source at commit `e81828a`. According to the commit message it was built and not clicked in a running app.
- No sign-in library is chosen yet (web-platform.md 11.9), so 4.15.2 to 4.15.4 were written without one to check them against.
- For section 4.15, data-model.md and sync.md were read as revised on 2026-11-20. claude-api.md, web-platform.md and capture.md were read in their revisions of the same day, which appeared while this section was being written and may have moved afterwards. import-rules.md was read as published in commit `e81828a`; no revision of it was seen. Where one of them names a route, a code or a message differently, it wins on its own subject and the wording here follows.
- Whether browsers offer to store the value of the API key field as a site password (4.15.5).
- The wording for Claude Code session links (4.15.10) rests on one reported capture, not on a page that was looked at for this document.
- The Lucide names added in 4.15.11.

### 5.6 Contrast of the pairs added on 2026-11-20

Section 4.15 adds no token. It uses the pairs below, which the check of 5.2 did not cover. They were computed with the same formula from the values of 4.2 (text needs 4.5:1, icons 3:1):

| Pair | Used for | Light | Dark |
|---|---|---|---|
| `--color-accent` on `--color-fill-neutral` | the action of the status bar | 4.84:1 | 5.82:1 |
| `--color-warning` on `--color-fill-neutral` | the warning icon of the status bar | 5.14:1 | 6.95:1 |
| `--color-danger` on `--color-hover` | the "Not saved" icon in a row under the pointer | 4.90:1 | 5.82:1 |
| `--color-danger` on `--color-selected` | the "Not saved" icon in a selected row | 4.45:1 | 4.79:1 |
| `--color-danger` on `--color-bg-sidebar` | the "Not saved" icon on a project | 4.83:1 | 6.16:1 |

`--color-danger` on `--color-selected` is 4.45:1 in the light theme: enough for an icon, not for text. That is why the words "Not saved" are drawn in `--color-text` (4.15.8). `--color-success` on `--color-selected` is 4.46:1 in the light theme and is not used. Every other pair of section 4.15 is in the list of 5.2.
