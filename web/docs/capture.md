# Capturing a conversation from a link

> **Status (revised 2026-11-20).** Extracted from the Apple app's source, then revised on 2026-11-20 for the decisions in `../HANDOFF.md` section 2: a product for many users, each with a private vault; each user's own Claude API key, stored encrypted on the server and never used by capture; an online vault in PostgreSQL plus an offline copy on each device. Sections 2 to 5 (the Apple app, the puller, the reference app and their defects) are as first published, apart from stale line references, two sentences about the puller that were completed, and a pointer to section 12 at the end of sections 4 and 5. Revised: sections 6 to 11 (the web design, the tier order, server-side capture for many users). New: 3.5, 8.3a to 8.3c, 12 (eight defects proven on mock pages), 13 (Claude Code session pages), 14 (decisions for the owner). No part of the web design has been run against a live page, and the SQL of 8.3a has not been executed.

## Summary

- The live Apple app opens the link in an in-app browser (WKWebView), the owner signs in there if needed, and a button press runs page scripts: scroll a virtualized list top to bottom keeping the longest text per `[data-index]` element, or else take the text of the whole page. It also stores a PDF "original" of the page.
- Speaker roles, the provider label and all cleaning are text heuristics applied afterwards; the live app uses no markup for roles. Role selectors and image capture exist only in the reference app, which was never run. The Python puller shares the scroll algorithm.
- A web page cannot embed and read a third-party page, so the web version captures in tiers. They are built in the order of `../HANDOFF.md` section 7: T1 (paste, files, link help) with phase 2; T3 (server-side headless capture of PUBLIC share links under strict request-forgery rules) in phase 3, each provider switched off until its selectors have been checked on one real public page and the owner has agreed for that provider; T2 (Web Share Target) with phase 5; T4 (an extension or bookmarklet in the user's own signed-in browser) later, not in the first release.
- Users: the product is for many people. Every capture belongs to the signed-in user. T3 runs one capture at a time per user, within a limit for the whole server and rate limits per user, in a new browser context each time; nothing of one user's capture is visible to another (8.3a).
- Key custody: capture never uses a Claude API key. Each user's own key is stored only on the server, encrypted (data-model.md 7.8), and the server has no Anthropic key of its own. The capture browser's process is started without any secret (8.3).
- Offline copy: the PostgreSQL vault on the server is the source of truth, and each device keeps a copy in IndexedDB (sync.md). Paste, file and share imports are made on the device and wait in its outbox while it is offline. T3 needs a connection; the server stores its result through the same import path as a paste, and devices receive it through the change feed (8.3c).
- `capture-scripts/` holds the 12 page scripts lifted verbatim (all pass `node --check`), a prototype of a shared data-driven extractor, a draft selectors file, and 13 synthetic pages with the results observed in WebKit. The session working in the Replit workspace contributes its Chromium mock pages as `web/fixtures/capture/`. The capture phase is done when both sets pass (section 11).
- Section 5 lists what not to copy: double saves, a Cancel that still saves, a sign-in guard that is wrong in both directions, a one-screen PDF, a provider guessed from keywords, and any `[data-index]` element hijacking the capture. Section 12 adds eight defects proven on mock pages in Chromium, says which extractor has each, and what the web extractor does instead. The prototype extractor shares three of them.
- Claude Code session pages (section 13): capture of the rendered text loses what the tools read and returned, and stores the first sentence of each message twice. For those sessions the complete source is the structured session JSON, the only route is the puller on the user's own machine, which is not reliable yet (3.5), and server-side capture does not apply. The import rule and its fixture are still to come.
- Selectors belong in ONE data file with fixtures. No selector in this repository has been checked against a live page for this document.
- Capture of third-party pages is fragile and may be restricted by those sites' terms. The builder must not try to get past sign-in, bot challenges or any other access control (section 10).

## 1. How to read this document

| Item | Meaning |
|---|---|
| "live app" | `apple/SessionVault` (SwiftUI, macOS and iOS). The only implementation in use. |
| "puller" | `puller/pull_sessions.py` (Python + Playwright). Per `README.md:12` not yet confirmed end to end. Line numbers for this file are those of commit `e81828a`; the script is being changed (3.5). |
| "reference app" | `reference/session-capture-ios` ("Session Capture"). Per `README.md:14` it compiles but has never been run. |
| `file:line` | Path relative to the repository root. A statement with a `file:line` reference was read in the code. |
| (run) | Observed by running unmodified code on synthetic input on 2026-11-19 and 2026-11-20: the page scripts in WebKit, or `apple/SessionVault/Importers.swift` compiled with a small driver. |
| (inference) | My reasoning. The code does not show it and it was not run. |
| (reported) | Stated by an earlier review of this project or by a document in the repository. Not re-verified. |
| (read) | Read in the code at the lines given. Not run. |
| (Chromium, mock) | Reported by the session working in the Replit workspace on 2026-11-20: observed in headless Chromium on mock pages. Not re-run for this document. The pages are to be contributed as `web/fixtures/capture/` (section 11). |
| (stub run) | Observed on 2026-11-20 by running an unmodified script from `capture-scripts/` in the JavaScriptCore shell against stub page objects with a simulated clock (12.4). It shows control flow only: there is no layout, no real `innerText` and no network. |
| (owner capture) | A pattern seen in one capture that the owner made with the Apple app on 2026-11-20, as it was described to this revision. The captured text, the link and the page were not seen (section 13). |
| "the owner", "user" | "The owner" is the person who owns this product (`../HANDOFF.md`). A "user" is anyone with an account. Sections 2 to 5 describe an app for one person and say "the owner" or "the person" for whoever uses it. |
| `\uXXXX` | Non-ASCII characters inside quoted app strings are written as escapes: `\u2014` em dash, `\u2013` en dash, `\u2026` ellipsis. |

Sections 2 to 4 are (A) what exists today. Section 5 is (B) what not to copy. Section 6 is (C) what differs because the target is a web app. Sections 7 to 9 are the web design. Section 12 lists eight more defects, proven on mock pages. Section 13 reports what one real capture of a Claude Code session page showed. Section 14 lists the decisions that are the owner's. No live provider page was loaded for this document (no network), so nothing in sections 2 to 12 says what a real page looks like today; section 13 does, at second hand.

Related handoff documents: import-rules.md (text parsers and cleaning), data-model.md (stored fields, interchange format), web-platform.md (PWA, service worker, hosting, sign-in), design.md (screens and wording), claude-api.md, sync.md (the offline copy on each device, its outbox and the six mutations).

## 2. What the Apple app does today

### 2.1 Entry points and URL handling

| Entry point | Rule | Code |
|---|---|---|
| Link field and button "Open & Capture Transcript\u2026" | Trim spaces and tabs. If the text has no `://`, prefix `https://`. If `URL(string:)` succeeds, open the capture browser at that URL. The button is disabled only while `URL(string: trimmed text) == nil`. | `apple/SessionVault/Views/ImportSheet.swift:36-51`, `:176-181` |
| "Paste Transcript" with a link on the clipboard | Trim whitespace and newlines. If the text has no newline, no space, contains `.`, is shorter than 500 characters, and (after the same `https://` prefix) parses to a URL with a host: put it in the link field, show "That's a link \u2014 opening it in the capture browser.", open the capture browser. Otherwise treat the clipboard as a transcript. | `ImportSheet.swift:195-217` |
| Launch argument `--capture-url <url>` | Test hook: opens the capture browser at that URL when the import sheet appears. Not guarded by a debug flag. | `ImportSheet.swift:122-130` |

No host or URL shape is enforced anywhere. `URL(string:)` returns nil for an empty string and for a few malformed inputs, so the button is enabled for almost any text: `"hello world"` becomes `hello%20world`, and `file:///tmp/x.html` and `ftp://...` pass this test too (run, Foundation on the macOS 27 SDK, target macOS 14). The only places where the code looks at the shape of a link:

| Check | Effect | Code |
|---|---|---|
| `linkText.contains("claude.ai") && !linkText.contains("/share/")` | Shows the tip "Tip: in Claude, tap Share on the conversation and paste that share link instead \u2014 share links capture with no sign-in at all." | `ImportSheet.swift:52-59` |
| `sourceURL.contains("claude.ai")` | Provider is Claude, otherwise Other (section 2.8) | `apple/SessionVault/Importers.swift:202` |
| Last path component of the entered URL | Fallback title | `ImportSheet.swift:134-138` |

URL shapes named in user-facing text only: the placeholder `https://claude.ai/code/session_\u2026` (`ImportSheet.swift:36`), the caption "Public share links (claude.ai/share/\u2026) capture with no login \u2014 that's the recommended flow. Press Capture Transcript once the conversation is visible, and it's saved as a formatted User/Assistant transcript." (`ImportSheet.swift:60`), "a claude.ai or ChatGPT share link" (`apple/SessionVault/Views/SessionListView.swift:92`), and `claude.ai/share` and `share.gemini.google` in `apple/BUILD_REPORT.md:19-21`.

### 2.2 Web view configuration

All of it is in `apple/SessionVault/WebCapture.swift:17-40`.

| Setting | Value | Code |
|---|---|---|
| Website data store, macOS 14 or later | `WKWebsiteDataStore(forIdentifier:)` with the fixed UUID `7A78BB2E-30D1-4E5C-9B8F-1D2E3F4A5B6C` | `:20`, `:28-30` |
| Website data store, iOS (and older macOS) | `.default()`, the app's persistent store | `:31-35` |
| User agent | Not set. No `customUserAgent` and no `applicationNameForUserAgent` anywhere under `apple/`. The page sees the WebKit default for the platform. | absence |
| Content mode, JavaScript, content blockers, user scripts | WebKit defaults. No `WKUserScript`, no rule list. | absence |
| Delegates | `navigationDelegate` only (`:39`). No navigation policy handler, so every navigation and redirect to any host is followed. No `WKUIDelegate`, so a page cannot open a second window; pop-up sign-in flows cannot complete (inference from WebKit behaviour). | `:39`, `:189-204` |
| Frame | `.zero` at creation, then sized by the sheet. Minimum 800 x 600 on macOS. | `:37`, `apple/SessionVault/Views/LinkCaptureView.swift:70` |
| Browser controls | None. The sheet has a status line, "Cancel", "Capture Transcript" and the page. No address bar, back, forward or reload. | `LinkCaptureView.swift:28-67` |
| Lifetime | One new web view per capture sheet (`@StateObject`). | `LinkCaptureView.swift:25` |

### 2.3 Navigation states and status strings

The page loads when the sheet appears (`LinkCaptureView.swift:68`). There is no waiting logic and no automatic capture: the person decides when the conversation is visible and presses the button. "Capture Transcript" is enabled when `pageLoaded && !isCapturing` (`LinkCaptureView.swift:61`).

| Event | `pageLoaded` | Status text | Code |
|---|---|---|---|
| Initial | false | "Load the session link, log in if asked, then press Capture." | `WebCapture.swift:10` |
| `didStartProvisionalNavigation` | false | "Loading page\u2026" | `:190-193` |
| `didFinish` | true | "Page loaded \u2014 sign in if needed, then press Capture once the conversation is visible." | `:195-198` |
| `didFail` | true | "Page had trouble loading \u2014 if the conversation is visible you can still press Capture." | `:200-203` |
| Failure before the page commits (`didFailProvisionalNavigation`) | unchanged | unchanged: not implemented | absence |

Status icon: spinner while capturing, green check mark when the status starts with "Captured", globe otherwise (`LinkCaptureView.swift:76-88`).

### 2.4 What the capture button does

`LinkCaptureView.swift:41-56`, then `ImportSheet.swift:133-151`:

1. `detectTitle()` (section 2.7).
2. `snapshotPDF()` (section 2.10).
3. `capture()` (section 2.5), which returns an array of strings.
4. If the array is empty: stop. The status is the one `capture()` set.
5. If `SessionImporter.looksLikeSignInWall(turns)` (section 2.9): set the status to "That looks like a sign-in or landing page \u2014 log in below (or wait for the conversation to appear), then press Capture again." and stop. The browser stays open. Nothing is saved.
6. Call back with `(turns, detectedTitle, pdf, initialURL)` and close the sheet. `initialURL` is the URL that was entered, not the URL the page ended on.
7. Title = the typed name if not empty, else the detected title, else the last path component of the entered URL (the whole URL if that is empty).
8. `SessionImporter.fromCapturedTurns(turns, title:, sourceURL:)` (section 2.8). If it yields no message: status "No conversation content captured from the page."
9. Otherwise insert the session, set `session.snapshotPDF = pdf`, and show "Captured N turns from HOST" followed by " \u2014 original saved as PDF." when a PDF exists, else "." (`ImportSheet.swift:149`; HOST falls back to "the page").

### 2.5 Scroll-and-harvest algorithm

`WebCapture.swift:146-186`. Each "run" evaluates the named file from `capture-scripts/` in the page.

```text
isCapturing = true (reset to false on every exit); captured = {}   // index -> text
status = "Capturing\u2026"
run live-scroller-scroll-to-top.js
sleep 600 ms
settled = 0
repeat at most 800 times:
    harvest()
    atBottom = run live-scroller-at-bottom.js
    if the result is not a boolean: break             // the script threw
    if atBottom:
        harvest()
        settled = settled + 1
        if settled >= 2: break
        sleep 800 ms
        continue
    settled = 0
    run live-scroller-step-down.js                    // scrollTop += clientHeight * 0.8
    sleep 450 ms
if captured is empty:
    text = run live-page-text.js
    if text is not blank: status = "Captured page text (no turn structure found)."; return [text]
    status = "Nothing captured \u2014 is the transcript visible in the page?"; return []
status = "Captured <count> turns."
return the texts in ascending index order

harvest():                                            // WebCapture.swift:75-98
    json = run live-harvest-turns.js                  // {"<index>": "<innerText>", ...}
    for each (key, text): if key parses as an integer and text is longer than the stored text: store it
```

| Constant | Value | Code |
|---|---|---|
| Pause after jumping to the top | 600 ms | `:153` |
| Step | 0.8 of the scroller's `clientHeight` | `:171` |
| Pause after a step | 450 ms | `:172` |
| "At bottom" test | `scrollTop + clientHeight >= scrollHeight - 4` | `:159` |
| Pause before re-checking the bottom | 800 ms | `:167` |
| Bottom must hold for | 2 consecutive checks | `:165-166` |
| Iteration cap | 800 (about 6 minutes at 450 ms per step, by arithmetic) | `:156` |
| Scroller must overflow by more than | 8 px | `:63` |

Which element scrolls (`WebCapture.swift:59-67`, looked up again on every script call because a re-render can replace the node): the first element in document order whose computed `overflow-y` matches `/(auto|scroll)/`, whose `scrollHeight > clientHeight + 8`, and which contains at least one `[data-index]` descendant; otherwise `document.scrollingElement`. So a page without `[data-index]` is still scrolled top to bottom before its text is taken (run, `long-static-page.html`: 8 steps).

The harvest is document-wide: every `[data-index]` element counts, wherever it is. "Longest text wins" means an empty text is never stored, and a turn whose text later gets shorter keeps its longer, older text.

### 2.6 The page scripts

| File in `capture-scripts/` | Source | What it returns |
|---|---|---|
| `live-scroller-scroll-to-top.js` | `WebCapture.swift:57-71` with the body from `:152` | `true` |
| `live-scroller-at-bottom.js` | `:57-71` with the body from `:159` | boolean |
| `live-scroller-step-down.js` | `:57-71` with the body from `:171` | `true` |
| `live-harvest-turns.js` | `:76-88` | JSON string: object, key = `parseInt(data-index)` (no radix), value = `innerText`, longest per key within the pass |
| `live-detect-title.js` | `:103-108` | trimmed `innerText` of the first `h1, h2`, else trimmed `document.title`, else `""` |
| `live-page-height.js` | `:121` | `document.body.scrollHeight` |
| `live-page-text.js` | `:176` | `document.body.innerText` |

All run through `WKWebView.evaluateJavaScript`; a script error becomes "no result" (`WebCapture.swift:46-52`). The scripts return plain text only: no role, no HTML, no images, no links. The live app has no selector that is specific to a provider: `[data-index]`, `h1, h2` and `*` are all it queries.

### 2.7 Title detection

`WebCapture.swift:102-116`. It runs before the scroll, when the button is pressed.

1. `title` = result of `live-detect-title.js`.
2. For each suffix in this order, if `title` ends with it, cut it off: `" - Claude"`, `" \u2013 Claude"`, `" | Claude"`, `" - ChatGPT"`, `" | ChatGPT"`.
3. Trim whitespace and newlines.
4. If the result is one of `""`, `"Claude"`, `"Claude Code"`, `"ChatGPT"`, `"Gemini"`, `"Just a moment..."`: no title.

### 2.8 From captured strings to a stored session

`Importers.swift:200-233`. This function is specific to capture; the parsers it calls are specified in import-rules.md. If that document and this one disagree, the Swift code decides.

```text
fallbackProvider = Claude if sourceURL contains "claude.ai", else Other

if there is exactly 1 string:                         // usually the whole-page fallback
    session = first result of parseText(string, title)      // import-rules.md: puller markdown,
                                                            // then claude.ai share text, then generic text
    session.sourceURL = sourceURL
    if session.provider is Other: session.provider = fallbackProvider
    return session

messages = []
for each string in stripChromeTurns(strings):         // section 2.9
    cleaned = cleanTranscriptLines(lines of string), joined with "\n", trimmed   // import-rules.md
    skip if empty
    if the first line carries a role marker (splitLeadingRoleMarker):
        role = that role; text = the remainder
    else:
        role = unknown                                 // displayed as "Note", apple/SessionVault/Models.swift:28-35
    append (role, text)
return session(title, provider = fallbackProvider, sourceURL, messages)
```

How roles are determined: from text only, never from markup. In the multi-string path a turn has a role only if its first line starts with a marker such as `User:` or `Assistant:`. In the one-string path the claude.ai share parser splits on lines that start with `You said:` and `Claude responded:` (`Importers.swift:93-131`), and the generic parser on role-marker lines (`:347-388`).

How the provider is determined: by the substring test above in the multi-string path; in the one-string path by the parser, which for generic text tests the whole text for "claude", then "chatgpt" or "gpt-", then "gemini" (`Importers.swift:375-379`).

Storage: one `ChatSession` and one `ChatMessage` per message, `index` = position, `createdAt` = now (`Importers.swift:435-452`). See data-model.md.

Results of the real function on synthetic input (run):

| Input | Result |
|---|---|
| 2 strings `"User: ..."`, `"Assistant: ..."`, URL on claude.ai | Claude, roles user, assistant, markers removed |
| Same strings, URL `https://chatgpt.com/share/EXAMPLE-0000-0000` | provider Other |
| 2 strings without markers | both `unknown` |
| 1 string of claude.ai share text ("You said: ...", "Claude responded: ...") | Claude, user and assistant, boilerplate and preview lines removed |
| 1 string whose first line is `Gemini`, with "You said" and "Gemini said" lines (no colon) | 1 message, role assistant; provider Gemini, or Claude if the word "Claude" occurs anywhere in the text |
| 1 string `"Gemini"` (a page that has not rendered yet) | saved: 1 message, role unknown, provider Gemini |
| A turn containing indented code and repeated lines | indentation removed; a repeated `pass` and a repeated `}` deleted |

### 2.9 Sign-in detection and the other guards

The live app does not look at the URL or the DOM to detect a sign-in page. It has one text heuristic, applied to the captured strings (`Importers.swift:133-151`):

```text
markers = "sign in", "log in", "meet gemini", "google terms", "terms of service",
          "just a moment", "verify you are human", "welcome back",
          "your personal ai assistant", "cookie", "privacy policy"

looksLikeSignInWall(strings):
    joined = strings joined with "\n"
    hits = number of markers that occur in lowercase(joined)       // each marker counts once
    if length(joined) < 1200: return hits >= 2
    if length(joined) < 2500: return hits >= 4
    return false
```

Boundaries confirmed by running the real function (run): 1199 characters with 2 markers is a wall, 1200 with 2 or 3 is not, 1200 and 2499 with 4 are, 2500 with 4 is not; a page with one marker is never a wall; a 6-character page is not a wall.

Page chrome captured as turns is removed in the multi-string path only (`Importers.swift:153-198`):

```text
isChrome(text) = length(text) < 700 and (
       lowercase(text) contains "ai overview"
    or lowercase(text) contains "can make mistakes"
    or lowercase(text) contains "sign in"
    or at least 2 of the wall markers occur in it )

stripChromeTurns(strings):
    drop strings from the front while isChrome; drop strings from the end while isChrome
    first remaining string = stripLeadingHeaderLines(it)

stripLeadingHeaderLines(text):
    drop up to 12 leading lines while the line, trimmed, is empty, or is shorter than 90 characters
        and contains one of: "sign in", "log in", "created with", "conversation transcript",
        "shared conversation", "ai overview"
    if nothing but whitespace is left: return text unchanged; else return the rest, trimmed
```

Other guards: the button is disabled until the page has loaded and while `isCapturing` (`LinkCaptureView.swift:61`); an empty capture is not saved (`LinkCaptureView.swift:46`, `ImportSheet.swift:144-145`); there is no timer and no automatic capture.

### 2.10 The PDF "original"

Creation, `WebCapture.swift:120-142`, run before the scroll-harvest (`LinkCaptureView.swift:44-45`):

1. `contentHeight` = result of `live-page-height.js` (0 if not a number).
2. If `contentHeight` is greater than the web view's height: set the frame to x 0, y 0, width `max(current width, 800)`, height `min(contentHeight, 40000)`, then sleep 700 ms.
3. `webView.__createPDF(with: .init())`, that is `createPDF` with a default `WKPDFConfiguration`. An error yields no PDF.
4. Restore the frame.

Storage: `ChatSession.snapshotPDF: Data?`, declared `@Attribute(.externalStorage)` (`Models.swift:64-65`), assigned after the session is inserted (`ImportSheet.swift:147-148`). Only link captures have one.

Viewing: a toolbar button "View Original" appears when the field is not nil (`apple/SessionVault/Views/SessionDetailView.swift:52-58`, `:98-102`). It opens `OriginalSnapshotView` (`apple/SessionVault/Views/PDFViewer.swift:28-72`): a PDFKit view with `autoScales = true`, title "Original", "Close", and "Share PDF", which shares a temporary file named after the session title with `/` replaced by `-` (or `Session.pdf`).

What the PDF contains (run, fixtures): for a page that scrolls as a whole and is 4800 px tall, one PDF page of 1000 x 4800 pt with everything on it. For a page whose transcript scrolls inside an inner pane (`virtual-list.html`, 45 turns), one PDF page of 1000 x 700 pt: the first screen only, because `document.body.scrollHeight` equals the view height there.

### 2.11 How a login persists between captures

| Implementation | Mechanism | Code |
|---|---|---|
| Live app | The sign-in happens inside the page; the app never sees credentials. Cookies and site data live in the website data store of section 2.2, which is persistent. Each capture creates a new web view on the same store, so a login survives across captures and launches. According to the comment at `:17-19`, the fixed identifier on macOS exists because an ad-hoc signed rebuild otherwise gets a new default store. There is no control to sign out or clear the store. | `WebCapture.swift:17-36` |
| Puller | A persistent Chromium profile directory, `~/.claude_session_pull_profile` by default (`--profile` overrides). `--login` opens `https://claude.ai` in a visible window and waits until the window is closed. | `puller/pull_sessions.py:34`, `:242-246`, `:258`, `:261-272` |
| Reference app | `.default()` store; one web view for the life of the app. | `reference/session-capture-ios/SessionCapture/WebView.swift:16-24` |

## 3. The puller and the reference app

### 3.1 Puller pipeline

`puller/pull_sessions.py:125-227`, per link:

1. `page.goto(url, wait_until="domcontentloaded", timeout=90_000)`.
2. `page.wait_for_load_state("networkidle", timeout=30_000)`; a timeout is ignored.
3. `time.sleep(2)`.
4. Sign-in check, warning only, the files are still written: `"login" in page.url or page.locator("input[type=password]").count() > 0` (`:150-154`).
5. `find_scroller` (`:97-122`): for each selector of `SCROLLER_SELECTORS` (`:38-42`) take up to 10 matches; return the first candidate that both scrolls (`scrollHeight > clientHeight + 4`) and contains `[data-index]`; else the first that does either; else none.
6. With a scroller: the loop of section 2.5 with the same numbers (`:185-207`). Without one: a single harvest (`:208-209`).
7. Harvest through the Playwright API, not page script (`:161-172`): every `[data-index]` element, attribute must be digits after leading `-` signs, `inner_text()`, longest per index.
8. From before the navigation until the scroll walk has ended, every response whose content type contains `json` and whose URL contains the session id, `session`, `message`, `transcript` or `events` is saved; the largest becomes `<id>.json` (`:131-141`, `:214-218`, `:226-227`). Nothing in the repository reads these files.
9. Output `<id>.md`: `# <id>`, `Source: <url>`, a blank line, then each turn followed by a blank line, `---` and a blank line (`:220-223`). The session id is `session_[A-Za-z0-9]+` from the URL; for a URL without such a part it is the last 48 characters of the URL after every run of non-word characters has been replaced by `_` (`:45-49`).

Browser: `launch_persistent_context(profile, headless=args.headless and not args.login)`, visible unless `--headless` (`:253-259`). Default viewport and user agent.

### 3.2 Reference app pipeline

- Web view: `.default()` store, `preferredContentMode = .mobile`, back and forward swipe gestures (`WebView.swift:16-24`). `https://` is prefixed unless the text starts with `http` (`:26-35`).
- Capture: `callAsyncJavaScript(CaptureEngine.script, arguments: [:], in: nil, in: .defaultClient)` (`:39-63`). The script is one async function body, `capture-scripts/reference-capture-engine.js`. Three strategies, first one that yields anything wins (`reference/session-capture-ios/SessionCapture/CaptureEngine.swift`):
  1. `[data-index]` scroll-harvest (`:67-131`), same numbers as section 2.5, scroller found by class selectors. Returns `role: null` for every turn.
  2. Four selector sets, tried in order (`:135-150`); the first set in which any selector matches a non-empty element wins; nodes are sorted in document order (`:152-179`).
  3. Whole page: `document.body.innerText` and up to 12 images (`:181-189`).
- Images (`:24-65`, `:95-98`, `:165-173`): `img` elements inside a turn; skipped when both natural dimensions are under 32 px or the source is a non-image `data:` URL; fetched with `fetch(src, { credentials: "include" })`; rejected over 4 MiB (6 MiB of text for an inline `data:image/` URL); returned as `data:` URLs; at most 24 distinct images per capture.
- After the script (`reference/session-capture-ios/SessionCapture/BrowserView.swift:94-126`): turns with blank text and no image are dropped; if none remain "Nothing to capture on this page yet \u2014 make sure the conversation is visible, then try again."; title = page title, else host, else "Session"; source = the web view's current URL. No sign-in guard. The Capture button is always enabled.
- `reference/session-capture-ios/SessionCapture/PdfExporter.swift` renders the stored transcript as HTML to PDF (off-screen 612 x 792 web view, `createPDF` 0.3 s after load). That is a clean transcript PDF, not a snapshot of the source page.

### 3.3 Selector by selector

| Aspect | Live app (`WebCapture.swift`) | Puller (`pull_sessions.py`) | Reference app (`CaptureEngine.swift`) |
|---|---|---|---|
| Scroller candidates | every element (`*`) with computed `overflow-y` auto or scroll (`:60-62`) | `.h-full.overflow-y-auto.overflow-x-hidden`, `main .overflow-y-auto`, `.overflow-y-auto`; first 10 matches each (`:38-42`, `:104-108`) | the same three class selectors, all matches (`:70-77`) |
| Scroller accepted when | overflows by more than 8 px and contains `[data-index]`; first in document order (`:63-64`) | overflows by more than 4 px and contains `[data-index]`; else first that does either (`:118-121`) | same as the puller (`:78-81`) |
| Scroller fallback | `document.scrollingElement` (`:67`) | none: one harvest, no scrolling (`:208-209`) | `document.scrollingElement`, then `document.body` (`:84`) |
| Looked up again each step | yes (`:54-55`) | yes (`:174-183`) | yes (`:108`) |
| Turn selector | `[data-index]` (`:79`) | `[data-index]` (`:162`) | `[data-index]` (`:90`) |
| Index parsing | `parseInt(attr)`, skip NaN (`:80-81`) | all digits after leading `-` (`:164-165`) | `parseInt(attr, 10)`, skip NaN (`:91-92`) |
| Turn text | `innerText` (`:82`) | `inner_text()` (`:167`) | `innerText` (`:93`) |
| Kept per index | longest; an empty text is never stored (`:83`, `:94`) | longest; an empty text is never stored (`:171`) | longest; the first sighting is stored even when empty (`:94`) |
| Step, pauses, cap | 0.8; 600, 450, 800 ms; 800 (section 2.5) | 0.8; 0.6, 0.45, 0.8 s; 800 (`:187-207`) | 0.8; 600, 450, 800 ms; 800 (`:104-119`) |
| Turn containers without an index | none | none | `[data-message-author-role="user"]` and `[data-message-author-role="assistant"]`; `user-query` and `model-response`; `[data-testid^="conversation-turn"]`; `main article` (`:135-150`) |
| Role from markup | no | no | yes, for the first two sets only; `null` for `[data-index]`, the last two sets and the whole page |
| Images | no | no | yes (section 3.2) |
| Whole-page fallback | `document.body.innerText` (`:176`) | none: writes a header-only file | `document.body.innerText` plus images (`:183-189`) |
| Title | first `h1, h2`, else `document.title` (`:105-106`) | session id from the URL (`:45-49`) | native page title, else host (`BrowserView.swift:108-110`) |
| Sign-in check | text markers after capture; refuses to save (section 2.9) | URL contains `login` or an `input[type=password]` exists; warning only (`:150-154`) | none |
| Network payloads | no | JSON responses saved (`:131-141`) | no |
| Waiting before capture | the person decides | DOM ready, network idle up to 30 s, 2 s (`:143-148`) | the person decides |
| Result | array of strings | Markdown and JSON files | array of `{text, role, images}` |
| Source URL kept | the URL entered (`LinkCaptureView.swift:54`) | the URL given (`:220`) | the URL the page ended on (`BrowserView.swift:113`) |

### 3.4 Roles, images and robustness

- Roles from markup: the reference app only, and only for its ChatGPT-style and Gemini-style sets.
- Images: the reference app only. The live app keeps none; they survive only in its PDF.
- Most robust per page type, as far as this repository can show:

| Page type | Live app | Puller | Reference app | Most robust today |
|---|---|---|---|---|
| Virtualized `[data-index]` list. The code comments describe Claude Code session pages this way, behind sign-in (`WebCapture.swift:4-7`, `pull_sessions.py:5-7`, `:156-158`). | Full harvest. Scroller found by computed style. Roles only when a turn's text starts with a marker. | Same harvest. Scroller found by class names. Also saves JSON responses. | Same harvest. Class names. Images. No roles. | The live app's scroller detection: with the pane's classes renamed, the class-based finders returned 10 of 45 turns and reported no problem (run, `virtual-list-renamed.html`). None of the three gets roles from markup. |
| claude.ai public share page | `[data-index]` if present, else whole page, then the "You said:" / "Claude responded:" text parser. | Not built for it. | Strategy 1 or 3, no roles. | The live app: the only one with share-page handling, and the only one reported as tested on such pages (`apple/BUILD_REPORT.md:19-26`). Its markup is not recorded anywhere in the repository. |
| ChatGPT share page | Whole page as one string. On a synthetic page with "You said:" lines this was then parsed by the claude.ai share parser: provider Claude, every message a user message (run). | Nothing. | `[data-message-author-role]` gives roles. Tested on mock pages only (`reference/session-capture-ios/HANDOFF.md:35-41`). | The reference app on paper. No one has recorded a test on a real page. |
| Gemini, signed-in chat layout | Whole page, one message. | Nothing. | `user-query` and `model-response` give roles (mock pages). | The reference app on paper. |
| Gemini, public share page | Whole page, one message (reported). | Nothing. | Returns the user's turns only and reports success, because that layout has no `model-response` (run on a synthetic reconstruction; layout as reported). | None. See section 7.1 for the proposed `gemini-share` set. |

### 3.5 What is known about the puller's reliability

Added on 2026-11-20. No run of the puller has been confirmed to capture a full transcript (`README.md:12`). The session working in the Replit workspace proved the following on mock pages (Chromium, mock). The right-hand column says where each finding comes from in `puller/pull_sessions.py` at commit `e81828a` (read).

| Finding | In the code |
|---|---|
| It reports success with zero turns for a page that answers 404, for a redirect to a sign-in page and for an empty scrape. | `pull_one` returns normally whatever was harvested; the caller prints `saved <id>.md (0 turn groups)` and counts the link as done (`pull_sessions.py:282-284`, `:307`). The sign-in check only prints a warning (`:150-154`). |
| The cap of 800 scroll steps cuts a long session short without a warning. | `pull_sessions.py:189`: the loop simply ends. The live app (`WebCapture.swift:156`) and the reference script have the same cap and the same silence. |
| "The largest JSON wins" can pick a payload that is not the transcript. | Every JSON response whose URL contains the id or one of four common words is a candidate, and the longest body becomes `<id>.json` (`pull_sessions.py:131-141`, `:214-218`). |
| Content that arrives late at the bottom of the list is missed. | The bottom test of section 2.5, shared with the live app (`pull_sessions.py:196-204`; M7 in section 12). |

A series of fixes for the puller is in progress in `puller/` and is not part of this document. Until it has landed and a run has been confirmed, do not describe the puller as reliable, in this repository or to users: its output can be empty or incomplete without an error, and has to be looked at before it is relied on.

## 4. Observed behaviour on synthetic pages

The pages are in `capture-scripts/fixtures/`. They are invented. They test the logic of the scripts and prove nothing about real provider markup. Full results with texts: `capture-scripts/fixtures/expected.json`. "Apple" = the live scripts driven as in section 2.5, then the unmodified `looksLikeSignInWall` and `fromCapturedTurns` with a fake source URL. "Prototype" = `capture-scripts/proposed/web-extractor.prototype.js` (section 7.2).

| Fixture | Apple (run) | Reference script (run) | Prototype (run) |
|---|---|---|---|
| `virtual-list.html` (45 virtualized turns, 5 arrive late) | 45 turns, roles from "User:" / "Assistant:" markers | 45 turns, no roles | 45 turns |
| `virtual-list-renamed.html` (same, other class names) | 45 turns | 10 turns, no warning | 45 turns |
| `virtual-list-with-sidebar.html` (same, plus a sidebar of 60 `[data-index]` items) | 60 "turns": 10 real ones, then 50 sidebar entries. It scrolled the sidebar. | 60 "turns": 45 real, then 15 sidebar entries | 45 turns, warning `several_indexed_lists` |
| `data-index-document-scroll.html` (30 turns in page flow; the only h1 is "Claude") | 30 turns; no title detected, so the title becomes the last path segment of the URL | 30 turns | 30 turns; heading "Claude", title "EXAMPLE growing beans - Claude" |
| `static-author-role.html` (author-role containers, signed-out header, legal footer) | 1 string; refused as a sign-in wall (3 markers in a short page). Without the guard: provider Claude, 2 messages, both "user". | 4 turns user, assistant, user, assistant; 1 image; the "Copy" button text is in the reply | 4 turns with roles; both code blocks fenced; no "Copy" |
| `static-custom-elements-chat.html` (`user-query`, `model-response`) | 1 message, role assistant, provider Gemini, title "Tools you need" (an h2 inside a reply) | 4 turns with roles; label lines "You said" / "Gemini said" inside the text | 4 turns with roles; the reply heading is not taken as title |
| `static-custom-elements-share.html` (`user-query`, `response-container`) | 1 string; refused as a sign-in wall | 2 turns, both user; replies lost | 4 turns with roles (`gemini-chat` fails with `one_role_only`, `gemini-share` succeeds) |
| `share-text-markers.html` (claude.ai-style share text) | 4 messages user, assistant, user, assistant; provider Claude; title "EXAMPLE tulip planting" | 1 turn, whole page | 1 turn, strategy `page-text` (the text parser then does the same as Apple) |
| `generic-articles.html` (nested `article`) | 1 string, role unknown | 3 turns: the nested article appears twice | 2 turns |
| `long-static-page.html` | 1 string after scrolling the page (8 steps) | 1 turn | 1 turn |
| `sign-in-wall.html` | refused as a sign-in wall (6 markers) | 1 turn; the reference app has no guard, so it would save it (`BrowserView.swift:100-115`) | 1 turn; `signals.passwordInputs` = 1 |
| `stray-data-index.html` (conversation plus three unrelated `[data-index]` chips) | 3 "turns": the chips. The conversation is lost. | the same 3 chips | 2 turns with roles |
| `stray-data-index-plain.html` (plain-text conversation plus the chips) | 3 "turns": the chips | the same 3 chips | 1 turn, `page-text`; the indexed strategy is rejected with `low_coverage` |

Added on 2026-11-20: section 12 reports eight defects that were proven on other mock pages, in Chromium. `expected.json` also has a `pullerEmulation` block for each page; it is the puller's Python logic restated in page script, not a run of the puller (section 11).

## 5. Defects and accidents of the Apple implementation that the web app should not copy

| # | What happens today | Evidence | Do this instead |
|---|---|---|---|
| B1 | The button stays enabled while the title and PDF steps run, because `isCapturing` is set only inside `capture()`. A second press in that window starts a second capture, and both save a session (inference from the code; not reproduced). | `LinkCaptureView.swift:43-45`, `:61`; `WebCapture.swift:147` | Disable the action for the whole sequence. Give each capture an id and make the save idempotent on it. |
| B2 | "Cancel" closes the sheet but does not cancel the running task, which still calls back and saves when it finishes (inference from the code; not reproduced). | `LinkCaptureView.swift:39-56` | Cancel aborts the job and discards its result. |
| B3 | A load that fails before the page commits (no network, unknown host) is reported by WebKit through a delegate method the app does not implement (inference). That leaves "Loading page\u2026" and a disabled button forever. | `WebCapture.swift:189-204` | Report every failure with a reason code (section 7.5). |
| B4 | "Page loaded" means the main document finished, not that the conversation is there. A page that has not rendered yet is saved as a session. | `"Gemini"` case in section 2.8 (run) | Wait for a turn selector or for the page text to stop changing; refuse a `page-text` result under 200 characters as `no_conversation_found`. |
| B5 | The sign-in guard is text only, English only, and wrong in both directions. A sign-in page with one marker passes. A real conversation under 1200 characters that mentions two markers is refused, and so is any short conversation on a page whose header and footer supply the markers. There is no override. | section 2.9; `static-author-role.html` and `static-custom-elements-share.html` in section 4 (run) | Section 7.4: decide on URL and DOM signals; keep the text heuristic as a warning with "Save anyway". |
| B6 | Every page without `[data-index]` becomes one string that includes navigation and footers. Roles then depend on luck: any text containing "You said:" is parsed as a claude.ai share. | `WebCapture.swift:175-180`; `Importers.swift:94`; section 4 | Extract turn containers with roles from markup where the page has them (section 7). |
| B7 | Any `[data-index]` element anywhere on the page counts as a turn. An unrelated widget replaces the conversation; a second indexed list is mixed into it; the wrong list may be the one that gets scrolled. | section 4, three fixtures (run) | Harvest only inside the scroller that holds the transcript; require the harvested text to account for most of the page text; prefer containers with roles. |
| B8 | The provider is Claude when the URL merely contains "claude.ai", otherwise Other in the multi-turn path, otherwise guessed from the first of "claude", "chatgpt", "gpt-", "gemini" found anywhere in the page text. A Gemini page that mentions Claude is labelled Claude. | `Importers.swift:202`, `:375-379`; section 2.8 (run) | Derive the provider from the host of the final URL through the data file. Use text only when there is no URL. |
| B9 | The title is the first `h1` or `h2` even when it is inside a message. If that heading is a boilerplate word the result is "no title" and `document.title` is never tried. No Gemini suffix is stripped. A URL ending in `/` gives the title `/`. | `WebCapture.swift:102-116`; section 4 (run); `URL.lastPathComponent` (run) | Section 7.3, title rule. |
| B10 | `stripChromeTurns` deletes a genuine first or last turn that is shorter than 700 characters and mentions "sign in" (or two markers), and it runs before the header-line stripper, so a short first turn with header residue is lost with its content. | `Importers.swift:156-173`; run: `"User: How do I sign in to my garden club forum?"` was dropped | Never drop a turn that came from a turn container. Use chrome stripping only for the `indexed` strategy and strip header lines first. |
| B11 | `cleanTranscriptLines` trims every line and removes a line equal to the previous non-empty one. Code loses its indentation and repeated lines. Lines equal to "Copy", "Share", "Report", "Retry" or "Claude", and lines that look like a clock time, are deleted wherever they occur. | `Importers.swift:56-88`; section 2.8 (run) | Fence code at extraction time (section 7.2) and make the cleaner skip fenced regions. Leave buttons out in the DOM, not by deleting text lines. See import-rules.md. |
| B12 | The PDF is taken before the scroll, sized from `document.body.scrollHeight`. For a transcript in an inner pane it is the first screen only. It is capped at 40,000 pt. | section 2.10 (run); (reported) the same on live pages | Section 8.3, pipeline step 9. Never present such a snapshot as complete. |
| B13 | The stored source is the URL that was typed, so a short link stays a short link and the real address is lost. | `LinkCaptureView.swift:54` | Store the final URL, and the requested URL when it differs. |
| B14 | No scheme or host validation; a single clipboard token containing a dot ("Hello.", "v1.2") is treated as a link. | section 2.1 (run) | `looksLikeLink` in section 8.1; https only. |
| B15 | Fixed sleeps, up to 800 iterations, no progress shown other than "Capturing\u2026", no detection that the chosen scroller does not move. | `WebCapture.swift:146-173` | A time budget, visible progress, a "scroller did not move" stop, a `partial` flag. |
| B16 | The launch-argument hook ships in release builds. | `ImportSheet.swift:122-130` | Do not port. Test through the fixtures. |
| B17 | Reference app: a selector set is accepted when any of its selectors matches, so one role is enough; nested matches are returned twice; images are fetched with `credentials: "include"`, which fails for cross-origin hosts that answer with a wildcard CORS header (inference); a button's label ends up in the turn text; no sign-in guard at all. | `CaptureEngine.swift:152-179`, `:37`; section 4 (run) | Require both roles; keep outermost matches only; take images from the network layer or not at all in the first version. |
| B18 | Puller and reference app find the scroller by Tailwind class names and fall back silently. | section 4 (run) | Computed-style detection, as in the live app. |

Added on 2026-11-20: section 12 lists eight further defects, M1 to M8, proven on mock pages. Six of them sharpen rows of this table (B7, B15, B17, B18); two are new.

## 6. What must be different because this is a web app

1. There is no embedded browser. A web page cannot load `claude.ai`, `chatgpt.com` or a Gemini page in a frame and read it: the same-origin policy forbids script access to a cross-origin frame, and such sites normally forbid framing with `X-Frame-Options` or `Content-Security-Policy: frame-ancestors` (inference; not checked against the live sites). `fetch()` from the page is blocked by CORS and would not carry the person's cookies for those sites anyway.
2. Therefore the capture step moves to one of three places: the person (copy and paste, share sheet: T1, T2), the server (headless browser, public links only: T3), or the person's own browser through an extension or bookmarklet (T4).
3. The web app never holds a login for a provider. T3 has no cookies at all. T4 uses whatever session the person's browser already has. There is no equivalent of section 2.11 and none should be built.
4. No PDF of the page as rendered in T1, T2 and T4. In the first release there is none in T3 either: stored page snapshots are out of scope (`../HANDOFF.md` section 6), and the server stores attachment descriptors without their bytes (data-model.md 7.2). So "View Original" does not exist on the web yet. A session from the Apple app keeps the descriptor of its PDF through an interchange import; the bytes are not stored.
5. Clipboard access needs a user gesture and, in some browsers, a permission prompt (general browser behaviour; see web-platform.md). Offer a text area as the primary paste target and "Paste from clipboard" (`navigator.clipboard.readText()`) as a convenience.
6. Work that the Apple app does on the device now runs on a server that also holds every user's vault and the server's secrets: the database credentials, the sign-in secret, and the keys that encrypt the users' Claude API keys (data-model.md 7.8). The server has no Anthropic key of its own. A page loaded by the server is untrusted input. Section 8.3 exists because of this.
7. In the Apple app a person looks at the page and decides when the conversation is visible (section 2.3). On the server nobody looks, so T3 needs its own readiness rule (section 8.3, pipeline step 6) and its own judgement of junk pages (section 7.4).
8. `innerText` needs a rendered page. Test extraction in a real browser engine (Playwright), not in jsdom.
9. Added on 2026-11-20. The server works for many users at once. One user's capture must not be visible to another user, must not be counted against another user, and must not hold another user up without limit (8.3a).
10. Added on 2026-11-20. The vault has an offline copy on each device (sync.md). Imports that are made on the device (T1, T2) are queued while there is no connection. T3 runs on the server and needs a connection (sync.md 14, item 5).

## 7. Building blocks shared by all web tiers

### 7.1 One selectors data file

Provider pages change without notice, and every selector in this repository came from memory or mock pages. Keep everything that depends on provider markup or URLs in ONE data file, with one fixture per entry, loaded by the server, the page code and the tests alike. A change to the file must come with a fixture change. A draft is in `capture-scripts/proposed/capture-selectors.draft.json`; it is the input that produced the prototype results in section 4.

| Field | Meaning |
|---|---|
| `schema`, `version` | `sessionvault.capture-selectors/1`; bump `version` on every edit and store it with each capture. |
| `defaults.excludeInTurn` | Selectors of descendants left out of a turn's text. Draft: `button`, `[role="button"]`. |
| `defaults.fenceCode` | Put Markdown fences around `<pre>` text. Draft: true. |
| `defaults.coverageMin` | Share of the page text that an indexed or role-less strategy must account for. Draft: 0.5. |
| `defaults.maxMs`, `defaults.timing` | Time budget of the extractor (60 s) and the numbers of section 2.5. New: `timing.quietMs`, the quiet time at the bottom of a list (12.2, M7; default 2,000 ms). |
| `defaults.signIn` | `urlSubstrings` and `selectors` that mean "this is a sign-in page" (section 7.4). |
| `defaults.titleBoilerplate` | The list of section 2.7 step 4. |
| `strategies[]` | Named strategies: `id`, `type` (`containers`, `indexed`, `page-text`), selectors, plus `source` (where the selector came from), `verified` and `fixture`. |
| `providers[]` | `id` (`claude`, `chatgpt`, `gemini`, `other`), `label`, `hosts` (hosts that belong to this provider only), `shareLinks` (`host` plus a `path` regular expression for PUBLIC share links), `navigationHosts` (hosts the main frame may visit in T3), `serverCapture` (T3 switch, draft: false everywhere; rules below), `checked` and `signedInLinks` (both new, below), `strategyOrder`, `titleSuffixes`, `roleLabels` (label lines such as "You said", for the text rules in import-rules.md; `match: "line"` means the whole line equals the text, `"line-prefix"` means the line starts with it and the rest of that line is a preview to drop, as in `Importers.swift:111-116`). |

Strategies in the draft, in the order used for an unknown host (`other`):

| `id` | Type | Selectors | Origin | Status |
|---|---|---|---|---|
| `chatgpt-author-role` | containers, roles | `[data-message-author-role="user"]`, `[data-message-author-role="assistant"]` | `CaptureEngine.swift:136-139` | mock pages only |
| `gemini-chat` | containers, roles | `user-query`, `model-response` | `CaptureEngine.swift:140-143` | mock pages only |
| `gemini-share` | containers, roles | `user-query`, `response-container` | not in the code; element names reported by an earlier review | never tested on a real page |
| `indexed-data-index` | indexed | `[data-index]`, attribute `data-index` | `WebCapture.swift:79`, `pull_sessions.py:162`, `CaptureEngine.swift:90` | used on real pages by the live app in 2026-08 per `apple/BUILD_REPORT.md`; markup not recorded |
| `chatgpt-turn-testid` | containers, no roles | `[data-testid^="conversation-turn"]` | `CaptureEngine.swift:144-146` | never |
| `generic-main-article` | containers, no roles | `main article` | `CaptureEngine.swift:147-149` | mock pages only |
| `page-text` | page-text | none | `WebCapture.swift:176` | n/a |

Per provider the draft uses: Claude `indexed-data-index`, `page-text`; ChatGPT `chatgpt-author-role`, `chatgpt-turn-testid`, `page-text`; Gemini `gemini-chat`, `gemini-share`, `page-text`.

The `shareLinks` path patterns in the draft (`/share/<id>` on `claude.ai`, `chatgpt.com`, `chat.openai.com`, `gemini.google.com`; `/gemini/share/<id>` on `g.co`; anything on `share.gemini.google`) come from general knowledge and from host names mentioned in the repository. They were not checked against real links. Tighten them after looking at one real link per provider.

Provider for a URL (replaces B8): the entry whose `hosts` contains the URL's host exactly, or one of whose `shareLinks` matches host and path; otherwise `other`.

Added on 2026-11-20. Two new fields of a provider entry:

| Field | Meaning |
|---|---|
| `checked` | `{ "date", "strategy", "fixture" }`: when the entry was checked against one real public page, which strategy won there, and the synthetic fixture that was written from it. Absent in the draft. |
| `signedInLinks` | Links of the provider that need a signed-in viewer and are therefore never captured by the server: items with `host`, a `path` regular expression and a `pageType`. Draft for Claude: `{ "host": "claude.ai", "path": "^/code/", "pageType": "claude-code-session" }` (section 13). Used by the link help of T1 and T2 and by the import module. T3 never accepts such a link. |

A provider is captured by the server only when all of this holds. A unit test checks the first two points on the data file:

1. Its entry has `serverCapture: true`.
2. Its entry has `checked`, with a date, a strategy of its `strategyOrder` and a fixture file that exists.
3. Its id is in `CAPTURE_PROVIDERS`, a comma-separated list in the configuration of the published app (default: empty). An id in that list is the owner's agreement for that provider (section 10). Only the owner sets it.
4. `CAPTURE_ENABLED` is on and a runner is available (8.3b).

The steps that lead there are in 8.3.

### 7.2 One extractor

One page function, used by T3 (through `page.evaluate`) and T4 (injected by the extension or bookmarklet), with the data file entry as its argument. A prototype that implements the steps below is in `capture-scripts/proposed/web-extractor.prototype.js`. It was run in WebKit against all fixtures (section 4) and passes `node --check`. It was not run in Chromium and never against a real page. Run against stub pages on 2026-11-20, it showed three of the eight defects of section 12 (M3, M6, M7) and a part of a fourth (M1). Port it to TypeScript with the rules of 12.2, not as it is, and own it. Its text differs on purpose from what the Apple app stores for the same page (buttons left out, code fenced), so do not expect the two apps to produce identical messages.

Until the port exists, the lifted scripts can be run as they are: the `live-*.js` files in the loop of section 2.5 for `[data-index]` pages, and `reference-capture-engine.js` for container pages, with the defects listed in section 5.

Input: `{ strategies: [...in the provider's order], excludeInTurn, fenceCode, coverageMin, maxMs, timing }`.

Output: `{ extractor, url, title, heading, strategy: {id, type} | null, turns: [{index, role, text}], partial, warnings, attempts, signals: {passwordInputs, bodyTextLength}, elapsedMs }`. `role` is `"user"`, `"assistant"` or `null`. Added on 2026-11-20 (12.2): each turn also has `images`, the number of content images in it, and the result has `imagesSeen` and `walkSteps`.

Steps:

1. For each strategy in order, run it; the first that succeeds wins. Record every attempt with its failure reason.
2. Strategy `containers`:
   1. Fail with `no_match` if no selector matches.
   2. Walk the scroller from top to bottom (step 5) so lazy content loads. If the number of matches drops during the walk, the page is virtualizing them: add the warning `turn_count_dropped_while_scrolling` and set `partial`.
   3. Collect all matches. Drop a match that lies inside another match. Read each text (step 6). Drop blank ones. Sort in document order.
   4. If the strategy assigns roles, require at least one user and one assistant turn, else fail with `one_role_only`.
   5. Require at least 2 turns, else `too_few_turns`.
   6. If the strategy assigns no roles, require the turn texts to add up to at least `coverageMin` of the length of `document.body.innerText`, else `low_coverage`.
3. Strategy `indexed`:
   1. Fail with `no_match` if nothing matches.
   2. Group the matches by their nearest scrolling ancestor (step 4). Take up to 3 groups, largest amount of text first.
   3. For each group, walk its scroller (step 5). Before every move and twice at the bottom, harvest: for each match that is not nested in another match and whose nearest scroller is this one, parse the index (base 10, skip NaN), read the text, keep it if it is longer than the stored one.
   4. Keep the group that yielded the most text. Fail with `low_coverage` if that text is less than `coverageMin` of the page text.
   5. Warn `index_gaps` if the indexes are not consecutive, `several_indexed_lists` if there was more than one group.
4. Nearest scrolling ancestor of a node: the closest ancestor below the root element whose computed `overflow-y` matches `/(auto|scroll)/` and whose `scrollHeight > clientHeight + 8`; `<body>` counts only when the root element's own `overflow-y` is not `visible`; otherwise `document.scrollingElement`.
5. Walk: the loop of section 2.5 with its numbers, plus two stops: the time budget, and "the scroller did not move on two consecutive steps" (warning `scroller_did_not_move`). Both set `partial`. Keep using the same scroller node while it is connected to the document; choose again only when it has been replaced.
6. Read a turn's text: hide the `excludeInTurn` descendants with an inline `display: none !important`, read `innerText`, fence code if enabled, restore the inline styles. All of this is synchronous, so nothing is painted in between.
7. Fence code: for each outermost `<pre>`, take the `innerText` of its `<code>` child (or of the `<pre>`), find that text in the turn text at a position where it occupies whole lines, and wrap it in three backticks, with the language from a `language-xxx` class when there is one. Only the string changes.
8. Strategy `page-text`: walk the page scroller, then return `document.body.innerText` as one turn.
9. `heading` = trimmed text of the first `h1` or `h2` that is not inside a turn. `title` = trimmed `document.title`. `signals.passwordInputs` = number of `input[type="password"]`.

Superseded in part on 2026-11-20 by 12.2, which wins where it differs: the walks of step 2.2 and step 8 (walk only when needed, M6); the bottom test inside step 5 (M7); "Drop blank ones" in step 2.3 and the empty-text rule of step 3.3 (M3); the grouping of step 3.2 (M1).

Rules for the code: one self-contained function; no imports, no `eval`, no `new Function`, no `innerHTML` (pages may enforce Trusted Types); no network requests; nothing left behind in the page except scroll position.

### 7.3 From extractor result to session

This belongs in the pure TypeScript module next to the import parsers (import-rules.md), so that it is identical on the server and in the browser and can be tested against `expected.json`.

```text
fromCapture(result, typedName):
    provider = providerForUrl(result.url)                       // section 7.1
    if result.turns is empty: fail no_conversation_found
    if result.strategy.type == "page-text":
        if length(trim(text)) < 200: fail no_conversation_found
        session = parseText(text)                               // import-rules.md, as in section 2.8
    else:
        for each turn:
            text = clean(turn.text)                             // import-rules.md; must not touch fenced code
            if turn.role is set:
                role = turn.role
                if the first line equals one of the provider's roleLabels: drop that line
            else:
                role, text = leading role marker of text, if any; else role = unknown
        if no turn has a role from markup: apply the chrome stripping of section 2.9,
            with the header-line stripping done first (B10)
    session.provider = provider
    session.sourceURL = result.url; keep the requested URL too when it differs
    session.title = first non-empty of:
        trim(typedName)
        cleanTitle(result.heading)
        cleanTitle(result.title)
        last non-empty path segment of the URL
        the URL
    record: strategy id, selectors version, extractor version, partial, warnings, capture time

cleanTitle(s): cut every titleSuffix of every provider from the end; trim;
               return nothing if empty or in titleBoilerplate
```

Stored capture metadata. data-model.md 7.6 has placed it: one object under the key `x_capture` in `sessions.extra`, with property names in `snake_case`: `method` (`paste`, `share`, `server`, `extension`, `bookmarklet`, `apple-webview`), `requested_url`, `strategy_id`, `selectors_version`, `extractor_version`, `partial`, `warnings`, `captured_at`. The names that the first version of this section suggested (`captureMethod`, `requestedUrl` and so on) are superseded. `sessions.source_url` is the final URL (B13); `requested_url` is stored only when it differs. Two properties are new here; data-model.md 7.6 lists them too: `images_seen`, the number of content images that the extractor saw and that were not stored (12.2, M5), and `page_type`, the `pageType` of the `signedInLinks` entry that the source link matches (13.4).

Added on 2026-11-20:

- A turn with blank text and `images` above 0 (12.2, M3) becomes a message. Before any cleaning, its text is set to the line `[image]`, or `[<n> images]` for more than one; this holds for turns with and without a role from markup. It is a default: the first release stores no image (`../HANDOFF.md` section 6), and a turn must not vanish. If a fixture in `web/fixtures/capture/` documents another form, the fixture wins.
- Cut the title to the limit of data-model.md 7.10 before saving.
- Every string passes W1 of import-rules.md first. For a `page-text` result, `parseText(text)` above is reached through `importCapture` of import-rules.md W10, which also owns the override for the wall test (`allow_wall`).
- Where the session is stored: for T3 in 8.3c; for T1, T2 and T4 through the outbox of the device (sync.md 6).
- The stored text is what "copy whole message" later copies, unchanged (data-model.md 7.14). A page control or a duplicated line that stays in the text is copied with it.

### 7.4 Sign-in and junk detection

| Signal | Tier | Decision |
|---|---|---|
| Final host is not in the provider's `navigationHosts` | T3 | fail `redirect_off_allowlist` (blocked earlier, section 8.3) |
| The final URL no longer matches a `shareLinks` pattern of the provider, and its host plus path contains one of `signIn.urlSubstrings`, case-insensitive | T3, T4 | fail `sign_in_required` |
| `signals.passwordInputs > 0` and the winning strategy is `page-text` | T3, T4 | fail `sign_in_required` |
| Page title is "Just a moment..." or the page text contains "verify you are human" | T3 | fail `blocked_by_site`. Do not retry with tricks (section 10). |
| Strategy `page-text` and the text is shorter than 200 characters | all | fail `no_conversation_found` |
| Strategy `page-text` and `looksLikeSignInWall` (section 2.9) is true | all | warning `sign_in_suspected`; show the text and offer "Save anyway" and "Discard". Never apply this test to a result with roles from markup. |
| Strategy `page-text` won for a provider whose entry lists container strategies with roles (ChatGPT and Gemini in the draft) | T3, T4 | warning `page_text_only`: the selectors probably no longer match the page. Log it; it is the signal to revisit the data file. For claude.ai share pages `page-text` followed by the share-text parser is the normal path, as in the Apple app. |
| Added on 2026-11-20: the link matches a `signedInLinks` entry of its provider (7.1) | T1, T2 | No capture action. The link help of 13.5. Text that is pasted with such a link is imported and marked with `page_type` (7.3). In T3 such a link never gets this far: rule 1 refuses it with `url_not_allowed`. |

### 7.5 Failure and warning codes

Failures: `url_not_allowed`, `provider_disabled`, `busy`, `rate_limited`, `navigation_failed`, `redirect_off_allowlist`, `sign_in_required`, `blocked_by_site`, `no_conversation_found`, `timeout`, `too_large`, `cancelled`, `internal_error`. Added on 2026-11-20, both answered before a browser starts: `quota_exceeded` (data-model.md 7.10; the save can also answer it) and `account_suspended` (data-model.md 7.7).

Warnings (the session can still be saved): `partial`, `sign_in_suspected`, `page_text_only`, `index_gaps`, `several_indexed_lists`, `turn_count_dropped_while_scrolling`, `scroller_did_not_move`. Added on 2026-11-20: `bottom_not_settled` (12.2, M7).

## 8. Capture in the web version, by tier

Revised on 2026-11-20. The tiers keep their names and their subsection numbers. The order of building follows the phases of `../HANDOFF.md` section 7 and is no longer the order of the numbers. This replaces "Build in this order" of the first version.

| Order | Tier | Section | Phase | State in the first release |
|---|---|---|---|---|
| 1 | T1: paste, files, link help | 8.1 | 2 | Always on. Every other tier falls back to it. |
| 2 | T3: server-side capture of public share links | 8.3 | 3 | Built, and tested on fixtures. Each provider is off until its selectors have been checked on one real public page and the owner has agreed to automated capture for that provider. |
| 3 | T2: Android share target | 8.2 | 5 | With the installable app and the offline copy. |
| 4 | T4: extension or bookmarklet | 8.4 | none | Not in the first release (`../HANDOFF.md` section 6). |

Each tier keeps working when the others are absent or switched off.

### 8.1 T1: no capture, paste and file import only

What to implement, with phase 2 (the parsers themselves are in import-rules.md):

1. A link field next to the paste area. The link is stored as the session's source URL and used for the provider (section 7.1). The app never requests the link.
2. `looksLikeLink(text)`, replacing the rule of `ImportSheet.swift:208-216`:

```text
t = trim(text)
if t is empty, has 500 or more characters, or contains whitespace: not a link
candidate = t if it contains "://", else "https://" + t
u = new URL(candidate); on error: not a link
if u.protocol is not "http:" or "https:": not a link
host = u.hostname; it must contain a ".", must not end with ".",
       and its last label must be 2 or more letters
return u with the protocol forced to https
```

3. When pasted text is only a link: do not create a session. Put it in the link field and show help: an "Open link" anchor (`target="_blank" rel="noopener noreferrer"`), then "select all, copy, come back and paste". If the link is on a known provider host but matches none of its `shareLinks`, say that it needs the person's sign-in and that a public share link is easier (the web form of the tip in `ImportSheet.swift:52-59`; wording in design.md). Added on 2026-11-20: if the link matches a `signedInLinks` entry of the provider (7.1; a Claude Code session link, for example), show the help of 13.5 instead. For that page type there is no public share link to recommend.
4. Pasted page text goes through `parseText` with the link as source. Apply section 7.4 with strategy `page-text`.
5. Title for a paste with a link: typed name, else the first line of the pasted text if it is shorter than 120 characters and not a role marker or boilerplate line (suggestion; the Apple app uses "Pasted session", `ImportSheet.swift:218`).
6. Added on 2026-11-20. The import is made on the device by the import module and stored with a `session.create` mutation (sync.md 6). From phase 5 on it therefore also works without a connection.

A Gemini text rule is worth adding to import-rules.md for this tier: lines exactly equal to "You said" and "Gemini said" (no colon) start user and assistant turns (reported layout; unverified). On the public Gemini share layout there is no reply label, so pasted text cannot be split there.

Acceptance checks:

- Entering or pasting a link causes no request to any other origin (assert in a browser test).
- Pasting only `https://claude.ai/share/EXAMPLE-0000-0000` creates no session and shows the link help.
- `looksLikeLink` rejects `Hello.`, `v1.2`, `a.b`, `file:///tmp/x`, `see https://example.invalid/x`; accepts `claude.ai/share/EXAMPLE` and `https://example.invalid/a`.
- Pasting the page text of `share-text-markers.html` (in `expected.json`, `appleScripts.turns[0]`) with a claude.ai share link gives 4 messages user, assistant, user, assistant, provider Claude.
- Pasting the text of `sign-in-wall.html` gives the warning `sign_in_suspected`, not a silent save and not a dead end.
- A paste with link `https://chatgpt.com/share/EXAMPLE-0000-0000` is labelled ChatGPT whatever words the text contains.
- Added on 2026-11-20: pasting only `https://claude.ai/code/cshk_EXAMPLE0000` creates no session and shows the help of 13.5, without the tip about a share link.

Risks: copying a long conversation by hand is clumsy on a phone, which is the reason for T2 and T4. Text copied by a person is close to `innerText` but not identical; do not expect byte equality with the Apple app.

### 8.2 T2: Web Share Target

Built in phase 5 (`../HANDOFF.md` section 7). The installed PWA appears in the Android share sheet and receives a link, text or files. Manifest member (the rest of the manifest is in web-platform.md):

```json
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "title": "title",
    "text": "text",
    "url": "url",
    "files": [
      {
        "name": "files",
        "accept": ["text/plain", "text/markdown", "text/x-markdown", "application/json",
                   ".txt", ".md", ".markdown", ".json"]
      }
    ]
  }
}
```

`POST` with `multipart/form-data` is required because files are accepted; a manifest has one `share_target`, so links and text arrive through the same form. `action` must be inside the manifest scope.

Receiving route, primary: the service worker. It needs custom code (with vite-plugin-pwa use the `injectManifest` strategy).

```js
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;
  event.respondWith((async () => {
    const form = await event.request.formData();
    const files = form.getAll("files").filter((f) => f instanceof File);
    if (files.length > 20 || files.some((f) => f.size > 25 * 1024 * 1024)) {
      return Response.redirect("/import?share_error=too_large", 303);
    }
    const id = crypto.randomUUID();
    await putPendingShare({                      // database "sessionvault-inbox", store "pendingShares"; File objects can be stored
      id,
      receivedAt: Date.now(),
      title: String(form.get("title") || ""),
      text: String(form.get("text") || ""),
      url: String(form.get("url") || ""),
      files
    });
    return Response.redirect("/import?share=" + id, 303);
  })());
});
```

Receiving route, fallback: the server answers `POST /share-target` with `303` to `/import?share_error=open_app_first`, so that a share arriving before the service worker controls the app does not end on an error page. It does not parse or keep the body.

Added on 2026-11-20. Where the pending share is kept: in the store `pendingShares` of a database of its own, `sessionvault-inbox`. It is the only database the service worker opens; the service worker never opens the copy of the vault, `sessionvault` (sync.md 8 and 9). A pending share belongs to the device, not to an account. It is deleted at sign-out, and before anything is shown when a different user signs in than the one whose copy is on the device (sync.md 2.6, rules 2 and 4).

Page `/import?share=<id>` (after sign-in if needed; the pending share stays in IndexedDB meanwhile):

1. Load the pending share; if there is none under that id, show the plain import screen. If it has files: run the file importer on each (import-rules.md) and ignore `text` and `url` unless no file yields a session.
2. Else find the link: `url` if it is a link; else `text` if `looksLikeLink(text)`; else, if `text` contains exactly one `http(s)` URL and the rest is at most 200 characters, that URL; else the same test on `title`. On Android the `url` field is usually empty and the link arrives inside `text` (general knowledge of the Android share intent; verify on a device).
3. A link with little or no other text: show the T1 link help with the link filled in, and the T3 action when there is a connection, T3 is on and the link matches an enabled provider's `shareLinks`.
4. Otherwise treat `text` as a pasted transcript, with the link (if any) as source and the shared `title` as the name suggestion.
5. Delete the pending share after import or discard. Delete pending shares older than 24 hours on start.
6. Added on 2026-11-20. The import itself is the paste or file import of T1, made on the device: it puts a `session.create` mutation into the outbox and so works without a connection (sync.md 6; sync.md 13.1 asks that a share received offline can be imported offline).

Acceptance checks:

- Chrome DevTools, Application, Manifest shows the share target without warnings.
- A test page that posts a multipart form (`title`, `text`, `url`, two `files`) to `/share-target` with the service worker active ends on `/import?share=<id>` with all parts shown.
- `curl -F text=hello https://<app>/share-target` (no service worker) gets a 303 to `/import?share_error=open_app_first`.
- On an Android phone with the PWA installed from Chrome: sharing a link from another app, sharing a `.md` file from a file manager, and sharing selected text each open the import screen with the right content. Record the device and browser version with the result.
- Sharing while signed out, then signing in, still shows the share.
- No pending share survives import, discard, or 24 hours.
- Added on 2026-11-20: with the network off, a shared text is imported, is listed as not sent, and reaches the server after reconnecting (sync.md 12.3).
- Added on 2026-11-20: a share that was received while user A's copy is on the device is not shown to user B who signs in next. Signing out removes `sessionvault-inbox`.

Risks:

- Works only for an installed PWA and only where the browser supports it: Chrome and some other Chromium browsers on Android, some desktop Chromium installs; not Safari on iOS as far as known (see web-platform.md for the support table). T1 must stay complete without it.
- Chrome re-reads the manifest of an installed app only now and then; a change to `share_target` can take a day or more to reach a device.
- The body of the POST is lost if anything redirects it (for example to a sign-in page) before the service worker handles it. That is why the service worker stores it first.
- A share is untrusted input like a paste: same size limits, same parsers, explicit save.

An alternative that was not chosen, a vault in the browser only, is in section 9.

### 8.3 T3: server-side capture of public share links

Revised on 2026-11-20. The server opens the link in a headless browser of its own, runs the extractor of section 7.2, and hands the result to the same import path as a paste (8.3c). It works only for links that open without signing in. It is built in phase 3 (`../HANDOFF.md` section 7), for many users (8.3a). It is the only tier that needs a browser binary on the server; keep it behind switches, so that every other tier works when it is off: `CAPTURE_ENABLED` for the whole tier, `serverCapture` and `CAPTURE_PROVIDERS` per provider (7.1), `CAPTURE_RUNNER` for where the browser runs (8.3b).

Switching a provider on. Every provider starts off. For one provider, in this order (this list replaces the half-hour spike of the first version):

1. The owner reads that provider's current terms and agrees to automated capture of its public share links (section 10; `../HANDOFF.md` section 9). Without a yes, nothing below is done for that provider, not even a test load.
2. The owner supplies one public share link of that provider, made for this purpose from a conversation with nothing private in it.
3. The provider's entry in the data file is checked against that page: which strategy matches the turns, whether both roles are found, what the path of a share link looks like. The check can be made in the owner's own browser, with a console probe that prints the number of matches for each selector of the entry and nothing else. Correct the entry.
4. The link is loaded once by the runner alone (8.3b), from the environment that will run T3, with no tricks, as a dry run: it reports the strategy that won, the number of turns, their roles and the warnings, and discards the text. Nothing is saved, least of all in the development database (`../HANDOFF.md` section 8). A challenge, a consent wall or a sign-in page: the provider stays off (`blocked_by_site`), and the load is not repeated in a loop.
5. Nothing of the real page is kept: no HTML, no text, no screenshot, no trace, no HAR file. What is kept is the corrected entry, the date, and a synthetic fixture written by hand with the same structure and invented text.
6. In the data file, set the entry's `checked` (7.1) and then `serverCapture: true`, and bump `version`: one commit that says what was checked.
7. The owner adds the provider id to `CAPTURE_PROVIDERS` in the configuration of the published app and captures one real public share link there. That capture is the last item of "done when" for phase 3 (`../HANDOFF.md` section 7).

Interface (names are suggestions; web-platform.md owns routing, and its rules for the signed-in user and for request forgery from other sites apply to every route here). Every route acts for the signed-in user only. The id of another user's capture answers `404 not_found`, exactly like an unknown id (data-model.md 7.12, rule I4). JSON fields are in `snake_case`, as in the rest of the API (sync.md 1); the first version of this section wrote `captureId` and returned a `result` object, and both are superseded.

- `POST /api/captures` with body `{ "url": string, "name"?: string }` and nothing else. Unknown fields are a 400. Answer `202 { "capture_id": ... }`. What is refused before any browser starts: 8.3a.
- `GET /api/captures/:id` gives `capture_id`, `status` (`queued`, `running`, `done` or `failed`), `stage` and `turns_so_far`, plus the fields of the table below. Poll every 2 s. Stages: `loading`, `waiting_for_content`, `extracting`, `processing`. The prototype extractor reports nothing while it runs; a turn counter would have to be added (for example a `window` property that the server reads).
- `DELETE /api/captures/:id` cancels a capture that is queued or running (close the browser context, discard everything) and discards a result that waits for a decision. On any other finished capture it changes nothing.
- `POST /api/captures/:id/save` is "Save" or "Save anyway" for a result that waits for a decision (8.3c). Its body is empty, or it names by input index the dropped turns to restore. It never carries text. New on 2026-11-20.
- `GET /api/capture-config` tells the page what to draw (design.md 4.15.10): `enabled` (the tier is on and a runner is available) and, for each provider, `id` and `server_capture` (true when the four conditions of 7.1 hold). Labels and link patterns come from the data file, which the page has. The server decides again on every request. New on 2026-11-20.
- A result that needs no decision is saved at once, as the Apple app does. A result needs a decision when it has a warning of 7.5, or when the import module reports something that a person has to see first (import-rules.md C8: turns dropped as page chrome, a page that could not be split). It then waits for "Save" or "Discard" (design.md 4.15.9), for at most 24 hours.

| Capture is | Further fields of the `GET` answer |
|---|---|
| queued or running | none |
| done and saved | `saved: true`, `session_id`, `turn_count`, and `duplicate_of` when the handler reported one (sync.md 6.5) |
| done and waiting for a decision | `saved: false`, `turn_count`, `warnings`, `dropped_turns` (the turns that the import module left out as page chrome, each with `position`, `index` and `text`, as in `fixtures/import/README.md`), and `preview`: the first 12 lines of the text, at most 600 characters |
| failed | `error`, in the shape of web-platform.md 13.4, with a code of 7.5 |

The full extractor result is never sent to the browser.

Pipeline:

1. Validate the URL (below). Create the job under the per-user lock and wait for a browser slot (8.3a), else `busy`.
2. New browser context for this capture only: `viewport: { width: 1280, height: 1600 }`, `serviceWorkers: "block"`, `acceptDownloads: false`, no `storageState`, no `httpCredentials`, no extra headers, no permissions. Do not set a custom user agent.
3. Install the request guard (rule 3 below) before the first navigation. Dismiss dialogs. Close any page other than the first.
4. `page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })`, then `page.waitForLoadState("networkidle", { timeout: 15000 })` ignoring a timeout, then wait 2 s. (The puller uses 90 s, 30 s and 2 s for signed-in pages, section 3.1.)
5. Check the final URL: host in the provider's `navigationHosts`; apply section 7.4.
6. Wait for content: every 500 ms for up to 15 s, stop when any selector of the provider's strategies matches or the length of `document.body.innerText` has been the same three times in a row.
7. Run the extractor with the provider's entry: `page.evaluate(sessionVaultExtract, config)`. Playwright sends the function's source to the page, so the function must not use anything from the surrounding module. If the page navigates while the extractor runs, the call rejects: report `navigation_failed` and do not retry in a loop.
8. Apply sections 7.3 and 7.4 in the pure module. Enforce the size limits. Then save, or keep the result for a decision (8.3c).
9. Not in the first release: stored page snapshots are out of scope (`../HANDOFF.md` section 6), and there is no table and no route for their bytes (data-model.md 7.2). The step is kept for the day the owner asks for them. Optional snapshot: `page.emulateMedia({ media: "screen" })` and `page.pdf({ printBackground: true })`. Store with it whether the page scrolls as a whole (`document.scrollingElement.scrollHeight > window.innerHeight + 8`). If it does not, the transcript sits in an inner pane, the PDF shows one screen only (B12), and the interface must say so. Leave this step out of the first version if in doubt.
10. Close the context in a `finally` block. Finish the job row, which releases the lock (8.3a).

Steps 2 to 7 and 10 run inside the runner (8.3b), and so would step 9. Steps 1 and 8 run in the app server.

Limits:

| Limit | Value |
|---|---|
| Captures per user at a time | 1 (a second request gets `busy`, HTTP 409) |
| Browser contexts in the whole server | `CAPTURE_MAX_CONCURRENT` per server process, default 1 (8.3a) |
| Captures waiting for a browser | `CAPTURE_MAX_QUEUED`, default 5, each for at most `CAPTURE_MAX_WAIT_MS`, default 60 s; beyond either: `busy` (8.3a) |
| Captures per user per hour | 20 (`rate_limited`) |
| Captures per user per day | 100 (`rate_limited`) (8.3a) |
| Input URL length | 2,048 characters |
| Navigation | 30 s |
| Extractor budget (`maxMs`) | 60 s |
| Whole capture, hard deadline | 120 s, then the context is closed and the result is `timeout`. The extractor's own 60 s budget makes it return what it has, flagged `partial`, before that. |
| Turns | 5,000 |
| Text per turn / per capture | 1,000,000 characters / 5,000,000 characters (`too_large`) |
| Snapshot | 20 MB, else dropped. Not in the first release (step 9). |
| Images in turns | none in the first version |
| Resource types aborted | `media`; add `font` if bandwidth matters |

Protection against server-side request forgery. Five rules, all mandatory, each enforced in code and covered by a test:

1. Allow-list of hosts. The input URL must match a `shareLinks` entry of a provider with `serverCapture: true`. Nothing else is ever opened.

```text
validateCaptureUrl(input):
    reject if longer than 2048 characters
    u = new URL(trim(input)); reject on error
    reject unless u.protocol == "https:"
    reject if u.username or u.password is set
    reject unless u.port is "" or "443"
    host = u.hostname                       // already lower-case and punycode
    reject if host is an IP literal (net.isIP after removing brackets) or ends with "."
    entry = provider with a shareLinks item where item.host == host and RegExp(item.path).test(u.pathname)
    reject (url_not_allowed) if none; fail provider_disabled if entry.serverCapture is false
    u.hash = ""
    return entry, u.href
```

2. No private or link-local addresses, for every request the browser makes, not only the first. Recommended enforcement: start the browser with a small forward proxy of your own on `127.0.0.1` and make it the only way out.
   - Launch option `proxy: { server: "http://127.0.0.1:<port>", bypass: "<-loopback>" }`. Chromium by itself sends requests for localhost directly, around a proxy; `<-loopback>` removes that exception. Recent Playwright versions may add it for you; prove it with the test below instead of assuming.
   - The proxy refuses plain HTTP. For `CONNECT host:port` it requires port 443 and a host that is not an IP literal, resolves the host with `dns.lookup(host, { all: true })`, refuses if ANY address is not public, then connects to the address it checked (not to the name again), which closes the DNS rebinding gap.
   - Not public: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`; IPv6 `::/128`, `::1/128`, `64:ff9b::/96`, `100::/64`, `2001::/23`, `2001:db8::/32`, `2002::/16`, `fc00::/7`, `fe80::/10`, `ff00::/8`, and any IPv4-mapped address (`::ffff:0:0/96`) whose IPv4 part is in the list.
   - Minimum if the proxy is not built: do the same resolution and range check inside the request guard for every new host. This leaves the rebinding gap open and does not see WebSockets.
3. No redirects to hosts off the list. A Playwright route handler alone is not enough: as far as I know Playwright does not call route handlers for the hops of an HTTP redirect, only for the first request (stated from memory of Playwright's behaviour, not tested here; the redirect test below will show it). Guard at the browser protocol level instead, where every hop is paused before it is sent:

```ts
const cdp = await context.newCDPSession(page);
const mainFrameId = (await cdp.send("Page.getFrameTree")).frameTree.frame.id;
await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
cdp.on("Fetch.requestPaused", (e) => {
  let verdict = "block";
  try {
    const u = new URL(e.request.url);
    const mainNavigation = e.resourceType === "Document" && e.frameId === mainFrameId;
    if (mainNavigation) {
      verdict = u.protocol === "https:" && provider.navigationHosts.includes(u.hostname) ? "continue" : "off-list";
    } else if (["https:", "data:", "blob:"].includes(u.protocol) && e.resourceType !== "Media") {
      verdict = "continue";
    }
  } catch {}
  if (verdict === "off-list") failCapture("redirect_off_allowlist");
  const answer = verdict === "continue"
    ? cdp.send("Fetch.continueRequest", { requestId: e.requestId })
    : cdp.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "BlockedByClient" });
  answer.catch(() => {});
});
```

   Every paused request must be answered or the page hangs. Do not combine this with `page.route` or `context.route`. This sketch is untested. If it is not built, the minimum is a `page.on("request")` listener that fails the capture and closes the context as soon as a main-frame navigation request, including a redirect hop (`request.redirectedFrom()`), targets a host off the list; by then that one request has already left, without cookies and, thanks to rule 2, only to a public address. In both cases check `page.url()` again after loading (step 5).
4. No credentials or cookies from the client. The request body is `{url, name}` only. Nothing from the client's request (cookies, `Authorization`, forwarded addresses, user agent) is passed on. Every capture uses a new context that is destroyed afterwards, so no cookie set by a provider survives. The server never shows a provider's sign-in form and never accepts a provider password, token or cookie, even if a later feature request asks for it.
5. One capture at a time per user: an in-memory lock keyed by user id if there is one server process, a Postgres advisory lock if there can be more. Stale locks expire at the hard deadline plus 30 s.

Added on 2026-11-20. The five rules are unchanged. Rule 5 with many users, and possibly more than one server process: the lock is the user's active job row (8.3a).

Also: treat share links as secrets in logs (log the capture id and the host, never the URL or anything derived from its path); start the browser process with an environment that is built from nothing, not copied and filtered (reported from the workspace: a Chromium that crashes writes a dump that contains its whole environment, so the browser also gets `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` in a throw-away folder outside the workspace, and crash reports are treated as secrets and deleted): the path of the executable, the library path that Chromium needs (8.3b) and a throw-away home directory, and none of `DATABASE_URL`, the `PG*` variables, `SESSION_SECRET`, the `USER_KEY_ENC_KEY_V<n>` secrets (data-model.md 7.8) or any other secret (web-platform.md 10.13, rule 5, asks the same for every child process); keep the browser version current; WebRTC can send UDP around a proxy, so consider the Chromium switch `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` (from memory; verify). If the platform forces `--no-sandbox`, a compromised page is one step closer to the server's files; that is a reason to keep the allow-list short.

Acceptance checks:

- Table-driven unit tests for `validateCaptureUrl`: rejects `http://`, a port, user info, `https://127.0.0.1/share/x`, `https://[::1]/share/x`, `https://claude.ai.example.invalid/share/x`, `https://example.invalid/share/x`, a claude.ai link that is not `/share/...`; accepts one well-formed link per enabled provider.
- Unit tests for the address test, one address per range above plus two public ones.
- Proxy tests: a `CONNECT` to a name that resolves to `127.0.0.1`, to `169.254.169.254`, to port 80, and to an IP literal are all refused; a public name is connected by address.
- Guard tests with a local test host injected into a test-only data file: an HTTP redirect (302) from a listed host to a host off the list, and the same done by script (`location.href = ...`), both fail with `redirect_off_allowlist`; the off-list test host records no request (with the protocol-level guard) or exactly one request without cookies (with the listener-only minimum). A page that requests `http://127.0.0.1:<port>/` as an image does not reach it.
- Two captures in a row against a test page that sets a cookie: the second request carries no cookie.
- `POST /api/captures` with an extra field (`cookies`, `headers`, `storageState`) is a 400.
- A second capture while one runs is a 409 `busy`. A page that never finishes ends as `timeout` within 125 s and leaves no browser process or context behind.
- The extractor, run through Playwright on every file in `capture-scripts/fixtures/` (served from a test host), reproduces the `prototype` blocks of `expected.json` after the documented text normalisation.
- `sign-in-wall.html` gives `sign_in_required`; nothing is stored.
- With `CAPTURE_ENABLED` off, the route answers `provider_disabled` and no browser starts.

Added on 2026-11-20:

- A provider that is not in `CAPTURE_PROVIDERS`, or whose entry has `serverCapture: false`, answers `provider_disabled`. A data file in which an entry has `serverCapture: true` without `checked` fails a unit test.
- `https://claude.ai/code/cshk_EXAMPLE0000` and `https://claude.ai/code/session_EXAMPLE0000` are refused with `url_not_allowed` (section 13).
- Many users: each of the six points at the end of 8.3a has a test with two users A and B. In particular, B gets `404 not_found` for A's capture id on `GET`, `DELETE` and `save`, and A's capture is unaffected.
- A suspended user gets `403 account_suspended` and a user over a storage limit gets `413 quota_exceeded`; in both cases no browser starts.
- The save goes through the handler (8.3c): after a capture the session row has a `seq`, the user's `change_seq` has advanced, `sync_mutations` holds the capture id, and running the save step again changes nothing. The check queries of data-model.md 7.3 and 7.10 return no rows.
- The browser process has none of the named variables in its environment (on Linux, a test reads `/proc/<pid>/environ`).
- A capture row that stopped sending its heartbeat is failed after 60 s and no longer blocks its user. A `DELETE` that reaches a second server process stops a running capture within a few seconds.
- Each defect of section 12 (M1 to M8) has a test on a mock page.
- Every page under `web/fixtures/capture/` produces its documented turns and roles. Together with the `expected.json` check above, this is the extractor's part of "done when" for phase 3.

Risks:

- Providers may answer a data-centre browser with a challenge or a consent page. Then this tier does not work for that provider and must say so plainly (`blocked_by_site`). The Apple code already lists "Just a moment..." and "verify you are human" as things it has to recognise (`WebCapture.swift:114`, `Importers.swift:137`).
- A headless browser needs memory (plan for 1 GB) and system libraries. In the Replit workspace the system Chromium starts once the folder of `libatomic.so.1` is on the library path; for a deployment nothing is known yet (8.3b).
- Added on 2026-11-20: many users share one browser budget. With the default of one context for the whole server, one user's slow page holds everyone else up for as long as the hard deadline. The waiting limits of 8.3a turn that into `busy`, not into a pile of work.
- Markup drift: a capture that silently returns less is worse than one that fails. Keep `attempts`, `warnings` and `partial` visible in the interface and in logs.
- The draft selectors are unverified. Do not enable a provider until its strategy has been checked against a real page and a fixture made from what was learned (a synthetic one: never commit a copy of a real page or conversation).
- Long conversations: the extractor budget is 60 s. Raise it per provider only with evidence.

Alternatives that were not chosen (a vault in the browser only, the key in the browser) are in section 9.

#### 8.3a Many users: the job record, locks and limits

Added on 2026-11-20. With one owner, T3 needed one lock and one browser. With many users it has to say whose capture runs, how many run at once, and how often one person may ask. That state lives in PostgreSQL, not in the memory of a server process: a published app restarts, and it can run on more than one machine (web-platform.md 10.8 and 11.5).

Draft, not executed. It follows the rules that data-model.md 7.7 gives for tables of other documents: `owner_id` first in the key, and no extension, trigger, function, procedure or domain.

```sql
-- One row per server-side capture: the per-user lock, the progress that is polled, and the state of the rate limits.
CREATE TABLE capture_jobs (
    owner_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id                uuid NOT NULL DEFAULT gen_random_uuid(),   -- the capture id; also the mutation_id of the save (8.3c)
    status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    stage             text NOT NULL DEFAULT '',                  -- loading, waiting_for_content, extracting, processing
    provider          text NOT NULL,                             -- provider id of the selectors file
    turns_so_far      integer NOT NULL DEFAULT 0,
    turn_count        integer NOT NULL DEFAULT 0,                -- when done
    warnings          text[] NOT NULL DEFAULT '{}',              -- warning codes of 7.5, when done
    error_code        text NOT NULL DEFAULT '',                  -- failure code of 7.5, when failed
    pending           jsonb,                                     -- ONLY while a result waits for a decision: extractor result and typed name
    saved_session_id  uuid,                                      -- the session this capture wrote; deliberately not a foreign key
    cancel_requested  boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    heartbeat_at      timestamptz NOT NULL DEFAULT now(),        -- refreshed every 2 s while queued or running
    finished_at       timestamptz,
    PRIMARY KEY (owner_id, id)
);
CREATE UNIQUE INDEX capture_jobs_one_active_per_user ON capture_jobs (owner_id) WHERE status IN ('queued', 'running');
CREATE INDEX capture_jobs_owner_created_idx ON capture_jobs (owner_id, created_at);
```

Notes on the draft:

- The partial unique index is the lock of rule 5 below: a second active capture of the same user fails on insert. If the hosting platform's schema tooling cannot keep a partial index (web-platform.md 13.1, check 4), the row lock of step 2.1 already puts one user's requests in a queue; test for an active row inside that transaction.
- The row holds no link, no name and no page text. The one exception is `pending`. It is transcript text: treat it like `messages.text` for logging and for encryption, and set it to NULL when the result is saved, discarded, replaced by a newer capture of the same user, or 24 hours old.
- `saved_session_id` is not a foreign key on purpose. The row is the state of the rate limits and must outlive the session: with `ON DELETE CASCADE` a user could reset the hourly limit by deleting captured sessions. A dangling id is harmless; the session route answers `404 not_found`.
- Every statement on this table names `owner_id` (data-model.md 7.12, rule I3). Two maintenance statements cross users by design and carry nothing out: the stale sweep at server start, and the clearing of `pending` values that are 24 hours old.
- Finished rows may be deleted after 30 days. Account deletion removes all of a user's rows (data-model.md 7.11 already names capture jobs in step 3).

What `POST /api/captures` does, in order. Nothing in steps 1 and 2 starts a browser.

1. Check the body and validate the URL (rule 1 below): `url_not_allowed`, `provider_disabled`. If this server process already has `CAPTURE_MAX_QUEUED` captures waiting: `409 busy`.
2. In one transaction:
   1. `SELECT change_seq, session_count, stored_bytes FROM users WHERE id = $1 AND status = 'active' FOR NO KEY UPDATE`, the statement of data-model.md 7.9, step 1. No row: `403 account_suspended` (data-model.md 7.7).
   2. Over `VAULT_MAX_SESSIONS` or `VAULT_MAX_STORED_BYTES`: `413 quota_exceeded`. A quota is checked before work starts (data-model.md 7.10, rule 1).
   3. Fail this user's stale rows (table below).
   4. An active row is left: `409 busy`, with its id in `error.details.capture_id`, so that the page can go on polling it.
   5. Count this user's rows created in the last hour and in the last 24 hours. Over a limit: `429 rate_limited` with `Retry-After`. Every accepted capture counts, whatever its outcome: a capture that failed has also loaded the provider's page.
   6. Set `pending` to NULL on this user's other rows: a new capture discards a result that was still waiting for a decision.
   7. Insert the row with status `queued`.
3. Answer `202` with the id and hand the capture to the runner queue of this process.

Running, cancelling, finishing:

| Event | Statement or rule |
|---|---|
| A browser slot is free | `UPDATE capture_jobs SET status = 'running', started_at = now(), heartbeat_at = now() WHERE owner_id = $1 AND id = $2 AND status = 'queued' AND NOT cancel_requested`. No row changed: the capture was cancelled while it waited. |
| Every 2 s while queued or running | `UPDATE capture_jobs SET heartbeat_at = now(), stage = $3, turns_so_far = $4 WHERE owner_id = $1 AND id = $2 RETURNING cancel_requested`. True: abort the runner, close the context, finish as failed with `cancelled`. |
| `DELETE /api/captures/:id` | Active row: set `cancel_requested`; if the capture lives in this process, abort it at once. Because of the heartbeat statement, cancelling also works when another process received the request. Finished row with `pending`: set `pending` to NULL. |
| No slot within `CAPTURE_MAX_WAIT_MS` | Finish as failed with `busy`. |
| Finish | One statement sets `status`, an empty `stage`, `turn_count`, `warnings` or `error_code`, `saved_session_id`, `pending` and `finished_at`. This releases the lock. |
| Stale row | A `queued` or `running` row whose `heartbeat_at` is older than 60 s belongs to a process that is gone (the same test as for a running turn in claude-api.md C5). Set it to `failed` with `internal_error`: in step 2.3, when `GET` reads it, and at server start. A capture whose process is alive is ended by the hard deadline of the limits table. |

Limits. The names are proposals, and the values are suggested defaults for the invitation phase (section 14).

| Limit | Default | Meaning |
|---|---|---|
| One active capture per user | fixed | Rule 5. |
| `CAPTURE_MAX_CONCURRENT` | 1 | Browser contexts per server process: the limit for the whole server. With the default the server opens one provider page at a time, which is also the "human pace" of section 10. Raise it only with the memory for it (about 1 GB per context). |
| `CAPTURE_MAX_QUEUED` | 5 | Captures waiting for a slot in one process. |
| `CAPTURE_MAX_WAIT_MS` | 60,000 | Longest wait for a slot. |
| `CAPTURE_PER_USER_PER_HOUR` | 20 | As in the first version. |
| `CAPTURE_PER_USER_PER_DAY` | 100 | A daily cap, new in this revision. |

The limit on browser contexts counts per process, because a browser's memory belongs to one machine. With more than one machine the total is the limit times the number of machines: keep the platform's maximum number of machines at 1 while the browser runs inside the app, or use a remote runner, which enforces its own limit (8.3b).

What one user must never get from another:

1. A capture id of another user answers `404 not_found` on every route, like an unknown id (data-model.md 7.12, rule I4).
2. One user's active capture never makes another user's request fail with the per-user `busy`. The other user waits for a slot like anyone else.
3. One user's captures never use up another user's rate limit.
4. Every capture gets a new browser context (pipeline step 2), so no cookie, cache entry, stored value or service worker passes from one user's capture to the next.
5. The saved session is written with the `owner_id` of the job and appears in that user's change feed only.
6. Logs carry the user id, the capture id, the provider id, the host, stages, counts, durations and codes. Never the path of the link, the typed name or page text (`../HANDOFF.md` section 8).

#### 8.3b The runner: one interface, and what is known about Replit

Added on 2026-11-20. Whether a published app can run a headless browser is not known. So everything that needs a browser sits behind one interface, and the rest of T3 does not depend on where the browser is.

```ts
// Names are suggestions.
interface CaptureRunner {
  // Can a capture run here, and with which browser? Called at start and before a provider is switched on.
  probe(): Promise<{ available: boolean; reason?: string; browserVersion?: string }>;
  // Steps 2 to 7 and 10 of the pipeline, for one URL that passed rule 1. Rejects with a failure code of 7.5.
  run(job: {
    url: string;
    provider: ProviderEntry;                          // the data file entry: navigationHosts, strategies
    config: ExtractorConfig;                          // 7.2
    limits: CaptureLimits;                            // the limits table
    signal: AbortSignal;                              // cancel
    onProgress(stage: string, turnsSoFar: number): void;
  }): Promise<ExtractorResult>;                       // 7.2
}
```

| `CAPTURE_RUNNER` | Runner | Use |
|---|---|---|
| `local` | Starts Chromium from the server process. | The workspace today. |
| `remote` | The same runner code as a small service of its own, on a machine that can run a browser. The app server calls it over HTTPS with a shared secret from the secret store. | Only if the app's own deployment cannot run a browser, and only after the owner has agreed (section 14). |
| `none` | Answers `provider_disabled`. | The default in a deployment. |

| Side | Always there |
|---|---|
| App server | Rule 1, the job row, the locks and limits of 8.3a, sections 7.3 and 7.4, saving (8.3c). |
| Runner | Rule 1 once more (it trusts no caller), rules 2 to 4, the new context, the deadlines. It receives the URL, the provider entry, the extractor configuration and the limits. It never receives a user id, a name, a cookie, a database address or any secret other than its own, and it returns the extractor result and nothing else. |

Facts measured in the Replit workspace on 2026-11-20 by the session working there (web-platform.md 10.11 has the whole list), and what follows for T3:

| Fact | Consequence |
|---|---|
| Headless Chromium starts in the workspace, but only with the folder of `libatomic.so.1` on `LD_LIBRARY_PATH` (`puller/README.md` shows the command). | The local runner sets that variable for the browser process, as part of the environment it builds from nothing (the paragraph after rule 5). Whether Playwright for Node needs the same is not known (`../HANDOFF.md` section 3): `probe()` is the first thing to build. |
| `command -v chromium` is an older build inside a workflow (138) than in an interactive shell (155). A profile opened by the newer build crashes the older one. | Resolve the binary once at start and log its version. T3 keeps no profile: every browser start gets a new, empty user-data directory that is deleted afterwards and shared with nobody, not with the puller and not between the two builds. Run the T3 tests where the server runs, in the workflow: that is the build that serves requests. |
| Whether a deployed app can run a headless browser is not known. | `CAPTURE_RUNNER` is `none` in a deployment until check 6 of web-platform.md 13.1 has passed there. The app is complete without T3. |
| 4 CPUs and 8 GiB of memory in the workspace. | One context fits easily. A deployed machine can be much smaller (web-platform.md 10.8). |
| Only `~/workspace` survives a restart; the rest of the home directory is memory-backed. | The browser's temporary profile and cache use memory and are gone after a restart. T3 needs nothing to survive one. Do not move them into `~/workspace`. |
| Replit's Git panel commits every file that is not ignored, and pushes. | T3 writes nothing into the workspace folder: no screenshot, trace, HAR file, video or saved page, in tests either. |
| PostgreSQL 16.10 is provisioned and empty (`DATABASE_URL`, the `PG*` variables); a `SESSION_SECRET` variable exists; `psql` is on the path. | `capture_jobs` can be created and checked there. These variables are exactly what the browser process must not inherit. |

Two more things are not known for a deployment: whether work goes on after the `202` answer while no request is open (web-platform.md 13.1, check 3; if it does not, run the capture inside one streamed request, or on a machine that does not sleep, web-platform.md 8.2), and how much memory the machine has.

#### 8.3c Saving: the same import path as a paste

Added on 2026-11-20. A paste becomes a session in two steps: the import module turns text into a parsed session (import-rules.md), and the `session.create` handler stores it (sync.md 6.5). A capture result takes the same two steps. T3 has no insert of its own.

1. Normalise every captured string with W1 of import-rules.md. Build the parsed session with `fromCapture` (7.3) in the shared module. For a `page-text` result this is `importCapture` of import-rules.md W10 with kind `page-text`: the parsers a pasted text goes through.
2. Decide with 7.4, 7.5 and import-rules.md C8. A failure ends the capture. Something to decide (a warning, turns dropped as page chrome, a page that could not be split): store the extractor result and the typed name in `pending`, finish as `done`, and answer `saved: false`. Otherwise go on.
3. Build one `session.create` mutation (sync.md 6.1). `mutation_id` is the capture id. The session id and the message ids are new UUIDs made by the server. `title` (cut to the limit of data-model.md 7.10), `provider`, `source_url` and `extra.x_capture` come from 7.3; `model` and `summary` are empty, `tags` is empty, `is_pinned` is false, `project_id` is null; `created_at` and `imported_at` are the time of the capture. Each message has `role` (`unknown` for a turn without one) and `text`.
4. Give it to the `session.create` handler for the user of the job. The handler does what it does for a paste: the limits and quotas of data-model.md 7.10, `import_hash` and `duplicate_of`, the write transaction of data-model.md 7.9 with the next `seq`, and the record in `sync_mutations` under the capture id. That record makes a repeated save a replay, which is the idempotent save that B1 asks for.
5. `applied`: finish as `done` with `saved: true`, the session id and `duplicate_of`. `rejected`: finish as `failed` with the handler's code (`quota_exceeded`, `validation`); nothing is kept.
6. The page that polled starts a sync run when it sees `saved: true` (sync.md 2.5). The session reaches every device of the user through the change feed, and its transcript through the transcript route (sync.md 4 and 5). The capture itself writes nothing to IndexedDB.

"Save" after a review (`POST /api/captures/:id/save`): take `pending`; repeat step 1 with the overrides that import-rules.md defines, `allow_wall` for the wall test and, if the request names dropped turns to restore, the input that keeps them (design.md 4.15.9; import-rules.md owns its name); then steps 3 to 5; set `pending` to NULL. The request carries indexes at most: what is saved is what the server captured, never text that a browser sends.

T3 needs a connection, like every route that runs on the server (sync.md 14, item 5), and is refused for a suspended user (data-model.md 7.7).

### 8.4 T4 (later): extension or bookmarklet for private chats

Not in the first release: a browser extension, a bookmarklet and capture of signed-in conversations are out of scope until the owner asks (`../HANDOFF.md` section 6). The design is kept for that day. It is also where a signed-in path for Claude Code session pages would live (section 13).

The same extractor runs in the person's own browser, on the page they are looking at, signed in as themselves. The vault never sees a provider credential. It reads only what the page already shows to that person. The statements about extensions, bookmarklets and page security policies in this section are general knowledge of browser behaviour; none was tested for this document.

Common to both forms:

- Payload: `{ schema: "sessionvault.capture/1", result: <extractor output>, selectorsVersion }`. The vault treats it like a paste: validate the shape, enforce the T3 size limits, run sections 7.3 and 7.4, show a preview, save on confirmation. With accounts, the receiving page belongs to whoever is signed in in that browser: it shows which account will receive the capture, and it saves through the outbox like a paste (sync.md 6).
- The provider entry is chosen in the page from `location.hostname`; unknown hosts use `other`.
- The tab must stay in front while the extractor scrolls; browsers slow timers in background tabs.

Extension (Manifest V3), the more reliable form on desktop:

- Permissions: `activeTab`, `scripting`, `storage`. No host permissions, no content scripts that run by themselves. The extension can read a page only after the person clicks its button on that tab.
- On click: `chrome.scripting.executeScript({ target: { tabId }, func: sessionVaultExtract, args: [config] })`, which runs in the isolated world and is not subject to the page's script policy. Then open `https://<vault>/import/receive` in a new tab and hand the payload to it (a content script limited to the vault origin, or `externally_connectable` for that origin).
- The vault origin is a setting of the extension. Distribution: for the owner alone, load unpacked or an unlisted store entry; for other users it needs a store listing.

Bookmarklet, the form that also works where extensions do not (Chrome on Android):

- Generated by the vault's settings page with the extractor and the data file inlined and the vault origin baked in. It cannot load code from the vault at run time: provider pages restrict script sources.
- Delivery, in this order: (1) `window.open("https://<vault>/import/receive")`, wait up to 3 s for a `sessionvault-ready` message from that window, then `postMessage(payload, "https://<vault>")`; (2) if no window handle or no answer (some sites isolate their pop-ups), download the payload as `sessionvault-capture-<time>.json` through a blob link, to be imported as a file or shared to the PWA through T2; (3) offer "copy to clipboard".
- `/import/receive` accepts exactly one message, only from `window.opener`, only with the expected `schema`.

Acceptance checks:

- On every fixture page served locally, extension and bookmarklet produce the same extractor result as T3.
- On a test page with `Content-Security-Policy: default-src 'self'; require-trusted-types-for 'script'` the extension still works; the bookmarklet result is recorded per browser.
- The extension manifest contains no host permission and the extension makes no network request of its own.
- A payload with a wrong schema, an oversized payload, and a message from a window that is not the opener are all refused by `/import/receive`.
- Nothing is saved without the preview being confirmed.

Risks: bookmarklets are blocked by some browsers on pages with a strict content security policy; bookmark length limits; pop-up isolation; no extension support in Chrome on Android; images cannot be fetched across origins from page script (leave them out); the extractor scrolls the person's page and briefly changes inline styles while it reads; the terms question of section 10 applies here as well, even though the person is using their own session.

## 9. If the owner chooses differently

Revised on 2026-11-20. The owner has chosen (`../HANDOFF.md` section 2). This section first says what the decisions mean for capture, and then keeps the alternatives that were not chosen, for the record. The first version of this document assumed one owner and one server-side API key; that assumption is now the first of the alternatives.

| Decided | Effect on capture |
|---|---|
| A product for other people from the first day: accounts, a private vault per user, sign-up by invitation at first | Every capture, every pending result and every saved session belongs to the signed-in user. T3 has a lock per user, a limit for the whole server, limits per user and a new browser context for every capture (8.3a). The capture routes are part of the isolation tests (data-model.md 7.12). |
| Each user brings their own Anthropic API key, stored encrypted on the server | No effect on what is captured or how. Capture never uses a Claude API key, and the capture browser is started without any secret (8.3). The server has no Anthropic key of its own. |
| An online vault in PostgreSQL plus an offline copy on each device | T1 and T2 import on the device and go through its outbox, so they work without a connection (sync.md 6). T3 runs on the server, needs a connection, and saves through the same handler; devices receive the session through the change feed (8.3c). Pending shares are kept in `sessionvault-inbox` (8.2). |
| Free-form questions about a saved session, the answer taken elsewhere, every message copyable whole | The stored message text is what is copied and packed. Capture must not leave page controls or duplicated lines in it (7.2, 7.3, section 13). |
| The context pipeline (capture, import, context pack) matters most | Capture is tested on two fixture sets (section 11), and a failure is always visible (section 10). |
| The Apple app stays; the two apps exchange sessions as interchange JSON, version 1 | A session captured by the Apple app arrives with its source link and the descriptor of its PDF; the bytes are not stored in the first release (data-model.md 7.2), and it has no `x_capture`. |
| The phases of `../HANDOFF.md` section 7 | The order of section 8: T1 with phase 2, T3 in phase 3, T2 with phase 5, T4 later. |

| Not chosen | Effect on capture, had it been chosen |
|---|---|
| One owner and one server-side API key (the assumption of the first version) | T3 needs one in-memory lock and one browser; 8.3a shrinks to "one capture at a time" and the job table is not needed. Everything else is unchanged. |
| Vault in the browser only (IndexedDB), no server vault | T1, T2, T4 unchanged apart from where the result is stored; the server fallback route of T2 does not exist on a static host. T3 has nowhere to run (section 8.3): either a separate small capture service is added just for it, or T3 is dropped and T4 covers public links as well. |
| Anthropic key kept in the browser | No effect on capture. |
| Another stack | The extractor is plain page JavaScript and the post-processing is pure TypeScript; neither depends on React, Vite or Node. T3 needs any server that can drive a headless Chromium. |
| No interchange with the Apple app | The capture metadata of section 7.3 stays useful on its own. |

## 10. Fragility, terms of use, and what the builder must not do

- Capturing third-party pages is fragile. The selectors here were never checked against a live page, the pages change without notice, and a capture can come back wrong or shorter without any error. Build every tier so that failure is visible and T1 always works.
- Automated access to these pages may be restricted by the sites' terms of use, and that can apply to T3 and to T4. Whether to enable a provider is the owner's decision, per provider, after reading that provider's current terms. Default: off. With many users the server makes these requests for other people, from one address; the owner decides with that in mind (section 14).
- The builder must not attempt to get past sign-in or any other access control. In particular: no stored or forwarded cookies, tokens or passwords for a provider; no automated sign-in; no solving, skipping or outsourcing of CAPTCHAs or "verify you are human" pages; no "stealth" plug-ins, user-agent spoofing or header tricks to look like a person; no proxy or address rotation to avoid a block; no retries in a loop against a page that refused. When a page asks for sign-in or challenges the browser, the result is `sign_in_required` or `blocked_by_site`, and the person is pointed to T1 (and to T4 once it exists).
- Capture only what a signed-in user asks for, one link at a time per user, at human pace: by default the whole server opens one provider page at a time (8.3a). No crawling, no following links, no scheduled re-capture.
- Added on 2026-11-20: the server never signs in to a provider, for any user. A user's own signed-in pages, Claude Code session pages for example (section 13), are captured on that user's own machine.
- Never commit a real captured page, link or conversation as a fixture. Fixtures are written by hand from what was learned.

## 11. Files in capture-scripts and how they were checked

Verbatim scripts. Each has a header naming its source file and lines. The text below the marker line `// ---- begin verbatim ----` is the script.

| File | Source |
|---|---|
| `live-scroller-scroll-to-top.js`, `live-scroller-at-bottom.js`, `live-scroller-step-down.js` | `apple/SessionVault/WebCapture.swift:57-71` with the bodies from `:152`, `:159`, `:171` |
| `live-harvest-turns.js` | `WebCapture.swift:76-88` |
| `live-detect-title.js` | `WebCapture.swift:103-108` |
| `live-page-height.js`, `live-page-text.js` | `WebCapture.swift:121`, `:176` |
| `puller-scroller-probe.js` | `puller/pull_sessions.py:113-114` |
| `puller-scroll-to-top.js`, `puller-at-bottom.js`, `puller-step-down.js` | `pull_sessions.py:186`, `:192`, `:206` |
| `reference-capture-engine.js` | `reference/session-capture-ios/SessionCapture/CaptureEngine.swift:21-190` |

Notes for use:

- The puller's harvest and scroller search are Python, not page script (section 3.1), so there is no file for them.
- The four puller files are function expressions that take the element. Playwright for Python calls such a string; Playwright for Node evaluates a string without calling it.
- `reference-capture-engine.js` is an async function body in the source (top-level `await` and `return`). The file wraps it in `async function sessionCaptureReferenceEngine() { ... }`; those two wrapper lines are not in the Swift source.

Not verbatim, written for this handoff:

| File | What it is |
|---|---|
| `proposed/web-extractor.prototype.js` | Prototype of the extractor of section 7.2 |
| `proposed/capture-selectors.draft.json` | Draft of the data file of section 7.1 |
| `fixtures/*.html` | 13 synthetic pages |
| `fixtures/expected.json` | Observed results for those pages (section 4), with the text normalisation to apply before comparing |

Checks performed on 2026-11-19 and 2026-11-20:

| Check | Result |
|---|---|
| Verbatim text against the Swift compiler: the four multi-line literals (the scroller template with each of its three bodies, harvest, title, reference engine) were copied byte for byte into a small Swift program, compiled with `swiftc` 6.4, and its output compared with the extracted text | identical for all 6 resulting files. The two one-line literals (`live-page-height.js`, `live-page-text.js`) contain no escapes and were matched as text. |
| Verbatim text of the puller files: taken from Python's own parser (`ast`) | 4 of 4 |
| `node --check` (Node v25.6.1) on all 12 verbatim files and on the prototype | all pass. A second engine (JavaScriptCore `checkSyntax`) agrees. |
| Execution in WebKit (WKWebView, macOS 27.2.1) against the 13 fixtures: live scripts, reference script, prototype | ran without script errors; results in `expected.json` |
| Post-processing: unmodified `apple/SessionVault/Models.swift` and `Importers.swift` compiled with a driver and run on synthetic input | results quoted in sections 2.8, 2.9, 4 and 5 |

Not checked: anything against a live provider page; Chromium or Firefox; the puller itself (its Python logic was only re-stated in page script for the comparison); the reference app's Swift side; behaviour on iOS.

Added on 2026-11-20.

The headers of the four `puller-*.js` files, `fixtures/expected.json` (`howEachBlockWasProduced.pullerEmulation`) and `proposed/capture-selectors.draft.json` still give line numbers of the puller as it was before commit `34e84d3`. The files were left as they are; the table at the top of this section has the lines of commit `e81828a`.

Fixtures for the capture phase. There are two sets, and the phase is done when both pass (`../HANDOFF.md` section 7, phase 3):

| Set | Where | What it is | Target for the web extractor |
|---|---|---|---|
| WebKit set | `capture-scripts/fixtures/`. It stays where it is. | The 13 synthetic pages above with `expected.json`, observed in WebKit. | The `prototype` block of each page: strategy, number of turns, roles, and texts after the documented normalisation. |
| Chromium set | `web/fixtures/capture/` (from this folder: `../fixtures/capture/`) | The mock pages and the harness of the session working in the Replit workspace, on which the defects of section 12 were proven. That session contributes them; they are not in the commit this revision was written against. | The turns and roles documented with each page. |

Rules for both sets: synthetic content only. A fixture that seems wrong is not edited to make a test pass; it is raised in a commit of its own (`../HANDOFF.md` section 8). A page that is added because of something learned from a real provider page is written by hand, never copied. A fixture for Claude Code session pages does not exist yet and cannot be written before a real shape has been examined (13.6).

Checks performed for the revision of 2026-11-20:

| Check | Result |
|---|---|
| Every `file:line` reference of this document against the clone of commit `e81828a` | The references to Swift files are right. 36 references to `README.md`, `apple/BUILD_REPORT.md` and `puller/pull_sessions.py` were stale and are corrected. |
| The eight defects of section 12, traced in the lifted scripts and in the puller | 12.1 |
| `reference-capture-engine.js` (verbatim body) and `proposed/web-extractor.prototype.js`, both unmodified, in the JavaScriptCore shell against stub page objects with a simulated clock | 12.1 and 12.4 |

Not checked for the revision: anything in Chromium or WebKit; the mock pages of the Replit session, which were described to this revision and not seen; any live page; the SQL of 8.3a; Playwright for Node; the raw strings and the session JSON of a Claude Code session.

## 12. Eight defects proven on mock pages

Added on 2026-11-20. The session working in the Replit workspace ran `capture-scripts/reference-capture-engine.js` in headless Chromium against mock pages and proved eight defects (Chromium, mock): not in WebKit, and not on live pages. Its pages and its harness are to be contributed as `web/fixtures/capture/` (section 11). For this revision each defect was traced in the lifted scripts and in the puller, and the reference script and the prototype were run against stub pages (12.4). The numbers M1 to M8 follow the order of `../HANDOFF.md` section 7, phase 3.

Line numbers in this section are lines of the files in `capture-scripts/` (for the reference script: the line in `CaptureEngine.swift` plus 5), of `apple/SessionVault/WebCapture.swift`, and of `puller/pull_sessions.py` at commit `e81828a`. In the table of 12.1 a bare `:n` is a line of the file named in the heading of its column.

### 12.1 Which extractor has which defect

| # | Defect | Reference script (`reference-capture-engine.js`) | Live app (`live-*.js`, `WebCapture.swift`) | Puller (`pull_sessions.py`, `puller-*.js`) | Prototype (`proposed/web-extractor.prototype.js`) | In section 5 |
|---|---|---|---|---|---|---|
| M1 | Any element with `data-index`, anywhere on the page, is taken as a turn and ends the capture. | Yes. The harvest is document-wide (`:94-105`) and the script returns as soon as one index was harvested (`:127-136`), so its strategies 2 and 3 never run. Stub run: three unrelated chips came back, two role containers were lost. | Yes. Document-wide harvest (`live-harvest-turns.js:23`); the page text is taken only when nothing was harvested (`WebCapture.swift:175`). Section 4, two fixtures (run). | Yes. Document-wide (`pull_sessions.py:162`), and it has no other strategy: the stray elements become turns of the `.md` file (read). | Handled on the two stray fixtures of section 4: a strategy with roles wins first, or the index strategy is rejected for low coverage (run). Not handled when stray indexed elements share the scroll container of an indexed transcript: three chips in the same pane came back as turns, with only `index_gaps` (stub run). | B7 |
| M2 | The first element that overflows or contains turns is taken as the scroll container. An unrelated sidebar is scrolled, the transcript is not, and only its first screen is captured. | Yes. `findScroller` (`:74-90`) prefers a class match that both overflows and holds `[data-index]`; failing that, it takes the first match that does either (`:86`). Stub run: the sidebar was scrolled, 10 of 45 turns came back, no warning. | Not in this form: one element must both overflow and hold `[data-index]` (`live-scroller-*.js:23-29`), so a sidebar without indexed items cannot win. Its own form is B7: the first such element in document order wins, so an indexed sidebar is scrolled (`virtual-list-with-sidebar.html`, run). | Yes, the same rule (`pull_sessions.py:118-121`, `puller-scroller-probe.js`), over the first 10 matches per selector. With no candidate it does not scroll at all (`:208-209`). | No. The scroll container is derived from the matched turns (`:99-117`). | B18, B7 |
| M3 | A turn that holds only an image is dropped on static pages. | Yes. Strategy 2 skips a container with blank text before it looks at its images (`:161-162`; images at `:170-177`). Stub run: 3 containers, 2 turns. In strategy 1 the same turn is kept, with empty text and its image (stub run). | Yes, on every page type: no image is ever read, and a turn without text is never stored (`WebCapture.swift:94`). | Yes, the same (`pull_sessions.py:171`). | Yes. Blank containers are dropped (`:223`), an empty indexed text is never stored (`:178`), and images are not read. Stub run: 4 containers gave 3 turns and no warning; an indexed list of 3 gave 2 turns and `index_gaps`. | Not listed |
| M4 | Images on another origin are lost, because they are fetched with credentials included. | Yes. `fetch(src, { credentials: "include" })` (`:42`); a failed request yields nothing (`:52-54`) and the image is left out without a trace. The stub run confirms only the credentials mode; the loss itself was proven in Chromium. | No image code. | No image code. | No image code, and no network request at all (7.2). | B17, there as an inference |
| M5 | Images after the 24th are dropped silently, and an image over 4 MiB is downloaded and then discarded. | Yes. Only the first 24 distinct sources of a capture are requested (`:65`, called at `:130` and `:178`; 12 for the whole page, `:193`), and the result has no field for the rest. The size test comes after the body was read (`:44-45`). Stub run: 31 sources, 24 requests, 24 bodies read, 23 images returned, one of 5 MiB read in full and discarded. | No image code. | No image code. | No image code. | Not listed |
| M6 | The scroll walk always runs, also on static pages. | Yes. `:107-125` run before any strategy is chosen. Stub run: a static page that fits the screen costs 1,400 ms of waiting; one that is 10 screens tall costs 6,800 ms and is left scrolled to the bottom. | Yes (`WebCapture.swift:152-173`; section 2.5; `long-static-page.html`: 8 steps, run). | Only when a class match overflows or holds an indexed element (`pull_sessions.py:185`); otherwise one harvest. | Yes, once per strategy that matches: `containers` (`:208`) and `page-text` (`:246`) always walk. Stub run: 1,400 ms and 6,800 ms as above, and 13,600 ms when a first strategy fails after its walk and a second one succeeds. | 2.5; B15 in part |
| M7 | Content that arrives later than about 0.8 s after the bottom was reached is missed. | Yes. The loop ends when two bottom checks 800 ms apart both find the scroller at its bottom (`:115-121`); the first check comes 450 ms after the last step. Stub run: rows added 900 ms after that step were captured, rows added after 1,500 ms were not. | Yes, the same numbers (`WebCapture.swift:161-169`). | Yes, the same numbers (`pull_sessions.py:196-204`) (Chromium, mock). | Yes, the same numbers (`:136-141`), and the result says `partial: false`. Stub run: rows added after 1,500 ms and after 3,000 ms were missed. | B15 in part |
| M8 | An article nested in an article is returned twice. | Yes. Strategy 2 keeps every match, also one that lies inside another match (`:157-165`). Stub run, and `generic-articles.html` (run): 3 turns for 2 articles. | No container selectors. Its indexed harvest has no nesting test either (`live-harvest-turns.js:23-29`): an indexed element inside another one with a different index would be a second turn (read; not run). | As the live app (`pull_sessions.py:162-172`). | No. Outermost matches only (`:222`); an indexed match inside another one is skipped (`:173`). `generic-articles.html`: 2 turns (run). | B17 |

The fixed pause of M7 also applies between steps (450 ms): a row whose text arrives later than that after it was mounted, and which has left the rendered window by then, keeps its placeholder text (inference from the loop; not run).

### 12.2 What the web extractor does instead

These rules complete section 7.2; where a step of 7.2 says otherwise, this table wins. Each rule is tested on its mock page in `web/fixtures/capture/`; where a page of `capture-scripts/fixtures/` already covers a rule, it is named.

| # | Rule | Check |
|---|---|---|
| M1 | As B7 and 7.2 step 3: harvest inside one list only, require coverage of the page text, try strategies with roles first. In addition: a list is the set of index matches that share the nearest scroll container and the same chain of tag names from that container down to the match. Other index matches in the same container are not turns. More than one list: take the one with the most text and warn `several_indexed_lists`. An index strategy that is rejected never ends the capture; the next strategy runs. | `stray-data-index.html`: 2 turns with roles. `stray-data-index-plain.html`: `page-text`. A page with chips inside the transcript pane: the chips are not returned. |
| M2 | As 7.2 step 4: the scroll container is always derived from the turn elements (their nearest scrolling ancestor, by computed style). No class names, and never a container that does not hold the turns it is walked for. A walk that did not end at a quiet bottom (M7), or a container that did not move, sets `partial`. | `virtual-list-renamed.html` and `virtual-list-with-sidebar.html`: 45 turns. The sidebar page of the Chromium set: every turn. |
| M3 | A turn with blank text is kept when it holds at least one content image: an `img` whose natural width or height is 32 px or more, the size test of the reference script. Every turn carries `images`, the number of content images in it. A turn is dropped only when it has neither text nor a content image. What becomes of such a turn when it is stored: 7.3. | A static page and an indexed list, each with an image-only turn: the turn comes back with its role, an empty `text` and `images` 1. |
| M4 | The extractor requests nothing (7.2), so no image can be lost to a failed request; it only counts them (M3, M5). When images come into scope: T3 takes the bytes from the browser's own network layer, where neither credentials nor cross-origin rules apply; page script (T4) never sends credentials to another origin (`credentials: "same-origin"`) and reports every image it could not read. | On a mock page that requests nothing after it has loaded, the request guard of T3 sees no request while the extractor runs. |
| M5 | No silent limit. The result says how many content images were seen (`imagesSeen`), and the interface says that they were not stored. First release: none is stored (`../HANDOFF.md` section 6). When images come into scope: a count limit and a size limit are reported with the number left out for each reason; the size is tested before the body is read and enforced while it is read. | A page with 30 images: `imagesSeen` is 30 and nothing is downloaded. |
| M6 | Walk only when needed. (1) A scroll container that does not overflow (`scrollHeight <= clientHeight + 8`) is never walked: no wait at all. (2) `containers` and `page-text` probe first: note the number of matches, the length of the page text and the scroll height; jump to the bottom once; apply the bottom rule of M7; compare. Nothing grew and no match disappeared: the page is static and is read as it stands. Otherwise walk from the top. (3) `indexed` walks, subject to (1). (4) One walk per scroll container per capture; a later strategy reuses it. (5) A strategy that can be refused without a walk is refused before it: `no_match`, and on a static page also `one_role_only` and `too_few_turns`. (6) The result reports `walkSteps`. | `long-static-page.html`: `walkSteps` is 0 (Apple: 8 steps). A static page 10 screens tall on which two strategies match: one probe and no step, not 13,600 ms. |
| M7 | The bottom rule, in place of "two checks 800 ms apart". At the bottom, harvest, then wait until the page has been quiet for `timing.quietMs` (default 2,000 ms): the scroll height did not change, no turn element was added or removed, no harvested text grew and, where the caller can tell (T3), no request is in flight. Any change restarts the wait; if the scroll height grew, the walk goes on. The time budget still ends the wait: then the result is `partial` with the warning `bottom_not_settled`. | The late-content page of the Chromium set: every turn. A list that grows 1,500 ms after the bottom was reached: every turn (reference script and prototype: missed). A list that never stops growing: `partial` and `bottom_not_settled`, within the budget. |
| M8 | As 7.2 steps 2.3 and 3.3: a match inside another match is part of that turn. Outermost matches only, for containers and for indexed elements. | `generic-articles.html`: 2 turns. |

For the "no request in flight" condition of M7, T3 can count requests from Playwright's `request`, `requestfinished` and `requestfailed` events and let the extractor ask through a function made available with `page.exposeFunction`. The page can call such a function too, so it returns a number and does nothing else (suggestion; not run). `quietMs` belongs to `defaults.timing` of the data file. It has to be longer than the delay of the late-content page of the Chromium set, unless that page loads its late part with a request.

### 12.3 The prototype is not the corrected extractor

The prototype of 7.2 fixes M2 and M8 and most of M1. It shares M3, M6 and M7 and a part of M1, and it has no image code, so M4 and M5 cannot occur in it. Port it with the rules of 12.2, not as it is.

`expected.json` stays valid. None of the rules of 12.2 changes the turns, roles or texts recorded there for the 13 pages. They change how long the extractor takes, what it reports, and what it returns on pages that the 13 do not cover.

### 12.4 How this was checked

| Evidence | What it covers |
|---|---|
| (Chromium, mock) | The eight defects, for the reference script, and M7 for the puller. Reported by the session working in the Replit workspace; not re-run here. Its pages were not seen for this revision. |
| (read) | Every cell of 12.1: the code was read at the lines given. |
| (stub run) | The verbatim body of `reference-capture-engine.js` (12 scenarios) and the unmodified prototype with the draft selectors file (11 scenarios), in the JavaScriptCore shell (`jsc`, macOS 27.2.1). The pages are stub objects: elements with text, attributes, given scroll sizes and a simulated clock. There is no layout engine, `innerText` is the joined text of the stub, and cross-origin rules are not modelled, so the loss of M4 is not confirmed by it. The harness is not part of the repository. |
| (run) | The WebKit results of section 4, as first published. |

Not done for this revision: any run in Chromium or WebKit, any run of the live scripts or of the puller, any live page.

## 13. Claude Code session pages

Added on 2026-11-20. Source: one capture that the owner made with the Apple app, of a Claude Code session share link, described to this revision as a pattern (owner capture). The captured text, the link and the page were not seen for this document. Nobody has yet examined the raw strings that the page scripts returned, or the structured data behind the page. So this section can say what is lost and what follows, but not yet how to import such a session: that rule and its fixture are still to come (13.6). What goes beyond the reported pattern is read from the code and marked.

### 13.1 The page type and its links

| Fact | Evidence |
|---|---|
| The link is under `claude.ai/code/` and its id starts with `cshk_`. | (owner capture) |
| A second link form exists in the repository: `claude.ai/code/session_...`. | `apple/SessionVault/Views/ImportSheet.swift:36`, `README.md:12`, `puller/pull_sessions.py:3`. Neither form was checked against the site. |
| The link needs a signed-in viewer. It is not a public share link. | (owner capture); the code comments say the same of session pages (`WebCapture.swift:4-7`, `pull_sessions.py:5-7`). |
| The page is a virtualized list of `[data-index]` "turn groups". | Code comments only (`WebCapture.swift:4-7`, `pull_sessions.py:156-158`). |
| In the Apple app such a page takes the multi-string path of 2.8: one string per group, cleaned line by line, a role only where the first line is a speaker marker, otherwise a "Note". | `Importers.swift:214-225` |

In the selectors data file these links are listed in `signedInLinks` of the Claude entry (7.1), never in `shareLinks`.

### 13.2 What capture of the rendered text loses

| Seen in the capture (owner capture) | What the code shows about it | Effect |
|---|---|---|
| Tool activity appears only as one-line summaries. What the tools read and what they returned is absent. | The scripts read `innerText`: what the page does not render is not there. | The context pack lacks most of the substance of the session (`../HANDOFF.md` section 5). |
| The first sentence of each message is stored twice: once as a preview line, once in the full text (13.3). | The Apple cleaner removes a line only when it equals the kept line before it (`Importers.swift:82`). | The duplicate is in the stored text, in the context pack, and in what "copy whole message" copies (data-model.md 7.14; the Apple app has that button since commit `e81828a`). |
| Interface events, such as "the session was initialised" or "a message came from a subagent", are stored as separate notes. | Each `[data-index]` element becomes one message; without a speaker marker its role is `unknown`, shown as "Note" (`Importers.swift:223`, `Models.swift:28-35`). | Notes that are not conversation sit between the turns. |
| The title is the id of the link. | The fallback of 2.4, step 7, for a capture without a detected title (B9 lists how that happens; which heading the page has is not recorded). | The user has to rename the session. |

Every route that reads the rendered page has these losses: the Apple capture, a paste of the page text (T1), and the `<id>.md` file of the puller.

### 13.3 The duplicated first sentence

Shapes (owner capture). The examples are invented.

| Shape | Preview paragraph | Paragraph that follows it |
|---|---|---|
| The first sentence | `The gate hinge is loose.` | `The gate hinge is loose. Tighten the two top screws first.` |
| Cut at about 150 characters, with an ellipsis | `Start by checking that the hinge pin is seated, then tighten the two top screws a quarter turn each, and after that open and close the gate five times\u2026` | `Start by checking that the hinge pin is seated, then tighten the two top screws a quarter turn each, and after that open and close the gate five times to see whether it still drags on the latch side.` |
| Straight quotes where the body has typographic ones | `It's the "top" hinge.` | `It\u2019s the \u201Ctop\u201D hinge. Replace its pin.` |

The shapes combine. A preview that equals the whole following line is already removed by the Apple cleaner, so the stored capture cannot show whether that shape occurs (inference from `Importers.swift:82`).

The rule: a paragraph is dropped when it is a prefix of the following paragraph after normalising quotes, apostrophes, white space and a trailing ellipsis. Precisely:

```text
paragraph         a maximal run of non-blank lines of one message. A blank line is a line that is empty
                  after removing white space. Paragraphs inside a closed code fence (import-rules.md W13)
                  are never compared and never dropped.

norm(p):          1. replace U+2018 and U+2019 by '  and  U+201C and U+201D by "
                  2. replace every run of white space (space, tab, U+00A0, line break) by one space;
                     trim both ends
                  3. remove a trailing ellipsis: U+2026, or three or more full stops; trim the end again

isPreview(p, q):  a = norm(p); b = norm(q)
                  return a is not empty and b starts with a          // equal texts count as a prefix

per message:      drop paragraph i when isPreview(paragraph i, paragraph i + 1)
                  // each paragraph is compared with the next one as it stands in the input;
                  // the last paragraph of a message is never dropped
```

The comparison is by code point, case-sensitive, without Unicode normalisation (as import-rules.md W1).

Scope: only text that comes from a rendered Claude Code session page, that is, a capture or a paste whose source link matches `signedInLinks`, and puller Markdown whose `Source:` line does. The rule has to run on the puller path as well: the Apple parser for puller Markdown applies no line cleaning at all (`Importers.swift:237-277`), so there even an exact duplicate survives.

The rule is not final. It is written from a description, not from the strings. Open until the raw strings have been looked at:

1. Whether a blank line separates the preview from the body. If it does not, preview and body are one paragraph, and the unit has to be the line.
2. False positives. As stated, the rule also drops a short heading that is followed by a paragraph beginning with the same words (`Hinges` before `Hinges wear first at the top.`). Guards to consider: apply it only to the first paragraph of a message; require a minimum length.
3. Whether other characters need normalising, for example other quote forms or dashes.
4. Where it runs in the cleaning order of import-rules.md (before or after the furniture cleaner, W7).

The rule belongs to the import module. It gets its number in import-rules.md when it is written there, together with a fixture pair: the Apple result with the duplicate, the web result without it.

### 13.4 Activity summaries and interface events

| Kind | Reported form | Rule today |
|---|---|---|
| Activity summary | One line that stands for a group of tool uses, for example "Used a tool 5 times" or "Ran a command". These are the examples that the first version of `../HANDOFF.md` section 5 gave; the exact wording was not verified. | Keep the line where it is: it is the only trace that tools ran. Never present it as the output of a tool. There is no matcher, and none is written before the raw strings are known. |
| Interface event | A line or block of the interface itself: the session was initialised; a message arrived from a subagent. | It stays a message of role `unknown`, as in the Apple app. Whether such notes are dropped, merged or given another role is decided with the raw strings: dropping needs a matcher, and a matcher needs the real wording. |

What can be done without the strings: a session whose source link matches `signedInLinks` records the page type (`x_capture.page_type`, 7.3), and the interface says on such a session that it was captured as rendered text and that the inputs and outputs of tools are not included (wording: design.md).

### 13.5 Consequences

1. The complete source. For these sessions the complete source is the structured transcript that the page loads as data, not the rendered text. The puller tries to save it as `<id>.json`. Its format is not documented, because no real file has been examined. Until it is, such a file is refused as `unrecognised_json` (import-rules.md W3), and nothing may be designed that could not hold tool calls, tool results and subagent messages (`../HANDOFF.md` section 5). The open roles and segment types of data-model.md 6.2 and the `session.create` mutation of sync.md 6.1 already allow them.
2. What `<id>.json` is today (read in `puller/pull_sessions.py` at commit `e81828a`; not run). It is the longest body among the JSON responses whose URL contains the id or one of the words `session`, `message`, `transcript`, `events`, seen from before the navigation until the scroll walk has ended (`:131-141`, `:214-218`). Every candidate is also kept under `raw/<id>/`. For a link without a `session_...` part, the id is a cleaned-up tail of the link (`:45-49`); no response URL contains that, so only the four words select candidates. If the page loads the transcript in parts, the longest part is not the whole transcript (inference). The choice can also pick a payload that is not the transcript at all (3.5).
3. The capture route. It is the puller, on the user's own machine, driving a browser in which that user is signed in. It is the only route that exists, and it is not reliable yet (3.5). Its output is private and stays on that machine until the user imports it.
4. Server-side capture does not apply. T3 opens public share links only. `validateCaptureUrl` refuses these links with `url_not_allowed`; they are never added to `shareLinks`; and the server never signs in to a provider for anyone (section 10).
5. Until the product has a signed-in path of its own (T4, or whatever the format work makes possible), the web app treats such a link like this: no capture action; a help text which says that the page needs the user's own sign-in, that pasted page text will be incomplete (only what is on screen is rendered, and tool details are missing), and that the complete route is the puller's file once its import exists (wording: design.md 4.15.10).

| Route | Reaches the page | Yields |
|---|---|---|
| Apple app capture | Yes: the person signs in inside the app. | Rendered text, with the losses of 13.2. |
| Paste of the page text (T1) | Yes: the user's own browser. | Rendered text of what is on screen only (web-platform.md 8.2, route 1: an inference from the code comment), with the losses of 13.2. |
| Share target (T2) | No. | The link. |
| Server-side capture (T3) | No, and it must not. | Nothing: `url_not_allowed`. |
| Puller, `<id>.md` | Yes: the user's own signed-in browser profile. | Rendered text, with the losses of 13.2. |
| Puller, `<id>.json` | Yes. | A candidate for the complete transcript. It cannot be imported yet. |
| Extension or bookmarklet (T4) | Later. | Not designed for this page type yet. |

### 13.6 Still to come, in this order

1. With the owner's agreement (section 14), look at one real session on the owner's own machine: the raw strings that the capture returned for a few turn groups, and the `<id>.json` and `raw/<id>/` files of the same session. Nothing of them leaves that machine.
2. Write down the shape only. For the strings: how preview, body, activity summary and interface event are laid out. For the JSON: the field names, the nesting, where text lives, how tool calls, tool results and subagent messages appear, and whether the transcript comes in one response or in several.
3. Write the rules: the de-duplication rule of 13.3 and any matcher of 13.4 in import-rules.md; the import of the session JSON as an addition to phase 1 (`../HANDOFF.md` section 5).
4. Write the fixtures by hand, in the same shape, with invented content: at least one rendered-text pair and one synthetic session JSON. Nothing from a real session may be used as a fixture.
5. Only then build and switch on the import.

## 14. Decisions for the owner

Added on 2026-11-20. Build the default until the owner answers. Items 1 to 3 need the owner before the work they gate can start.

| # | Question | Default |
|---|---|---|
| 1 | For each provider (Claude, ChatGPT, Gemini): may automated capture of its public share links be switched on, after reading that provider's current terms? With many users the server makes these requests for other people (section 10; `../HANDOFF.md` section 9). | Off for every provider. T3 is built and tested on fixtures only. |
| 2 | For each provider that gets a yes: one public share link, made by the owner for this purpose from a conversation with nothing private in it. And where may that page be looked at: only in the owner's own browser, or also once from the server's headless browser, with nothing stored (8.3)? | The owner's own browser first, with a probe that prints counts and no text; then one dry run from the server. |
| 3 | Claude Code sessions (section 13): may one real session be examined once on the owner's own machine, that is, the captured strings and the JSON file that the puller saved, to write down their shape? Nothing of it would be committed; the fixtures are written by hand with invented content. | Not examined. The import of that JSON stays refused, and the de-duplication rule of 13.3 stays a draft. |
| 4 | For other users a Claude Code session link has no capture route in the first release: the puller is a script on one's own computer. Is it enough that the web app says so and offers paste? | Yes. |
| 5 | Limits for server-side capture (8.3a): one page at a time for the whole server; per user 20 an hour and 100 a day. | These values. |
| 6 | A capture result that needs a decision ("Save anyway" or "Discard") is kept on the server for up to 24 hours and then discarded. The alternative keeps nothing, and the user captures again. | 24 hours. |
| 7 | If the published app cannot run a headless browser: add a second small service that can, which may cost money, or ship without server-side capture? | Ship without it, and ask before adding anything. |
| 8 | Images are not stored in the first release (`../HANDOFF.md` section 6). A turn that holds only an image is kept as the line `[image]`, and the session says how many images were seen (7.3). Acceptable until images are wanted? | Yes. |
