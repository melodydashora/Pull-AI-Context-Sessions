# Capturing a conversation from a link

> **Status (2026-11-20).** Extracted from the Apple app's source, written for one owner and one server-side API key. The parts on what the Apple app does and on its defects are ready to build from. Where the web design here assumes a single owner or a single key, `../HANDOFF.md` section 2 wins, and section 5 there lists what is being revised.

## Summary

- The live Apple app opens the link in an in-app browser (WKWebView), the owner signs in there if needed, and a button press runs page scripts: scroll a virtualized list top to bottom keeping the longest text per `[data-index]` element, or else take the text of the whole page. It also stores a PDF "original" of the page.
- Speaker roles, the provider label and all cleaning are text heuristics applied afterwards; the live app uses no markup for roles. Role selectors and image capture exist only in the reference app, which was never run. The Python puller shares the scroll algorithm.
- A web page cannot embed and read a third-party page, so the web version captures in tiers: T1 paste and files only; T2 Web Share Target; T3 server-side headless capture of PUBLIC share links under strict request-forgery rules; T4 (later) an extension or bookmarklet in the owner's own signed-in browser.
- `capture-scripts/` holds the 12 page scripts lifted verbatim (all pass `node --check`), a prototype of a shared data-driven extractor, a draft selectors file, and 13 synthetic pages with the results observed in WebKit.
- Section 5 lists what not to copy: double saves, a Cancel that still saves, a sign-in guard that is wrong in both directions, a one-screen PDF, a provider guessed from keywords, and any `[data-index]` element hijacking the capture.
- Selectors belong in ONE data file with fixtures. No selector in this repository has been checked against a live page for this document.
- Capture of third-party pages is fragile and may be restricted by those sites' terms. The builder must not try to get past sign-in, bot challenges or any other access control (section 10).

## 1. How to read this document

| Item | Meaning |
|---|---|
| "live app" | `apple/SessionVault` (SwiftUI, macOS and iOS). The only implementation in use. |
| "puller" | `puller/pull_sessions.py` (Python + Playwright). Per `README.md:11` not yet confirmed end to end. |
| "reference app" | `reference/session-capture-ios` ("Session Capture"). Per `README.md:12` it compiles but has never been run. |
| `file:line` | Path relative to the repository root. A statement with a `file:line` reference was read in the code. |
| (run) | Observed by running unmodified code on synthetic input on 2026-11-19 and 2026-11-20: the page scripts in WebKit, or `apple/SessionVault/Importers.swift` compiled with a small driver. |
| (inference) | My reasoning. The code does not show it and it was not run. |
| (reported) | Stated by an earlier review of this project or by a document in the repository. Not re-verified. |
| `\uXXXX` | Non-ASCII characters inside quoted app strings are written as escapes: `\u2014` em dash, `\u2013` en dash, `\u2026` ellipsis. |

Sections 2 to 4 are (A) what exists today. Section 5 is (B) what not to copy. Section 6 is (C) what differs because the target is a web app. Sections 7 to 9 are the web design. No live provider page was loaded for this document (no network), so nothing here says what a real page looks like today.

Related handoff documents: import-rules.md (text parsers and cleaning), data-model.md (stored fields, interchange format), web-platform.md (PWA, service worker, hosting, sign-in), design.md (screens and wording), claude-api.md.

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

URL shapes named in user-facing text only: the placeholder `https://claude.ai/code/session_\u2026` (`ImportSheet.swift:36`), the caption "Public share links (claude.ai/share/\u2026) capture with no login \u2014 that's the recommended flow. Press Capture Transcript once the conversation is visible, and it's saved as a formatted User/Assistant transcript." (`ImportSheet.swift:60`), "a claude.ai or ChatGPT share link" (`apple/SessionVault/Views/SessionListView.swift:92`), and `claude.ai/share` and `share.gemini.google` in `apple/BUILD_REPORT.md:17-19`.

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
| Puller | A persistent Chromium profile directory, `~/.claude_session_pull_profile` by default (`--profile` overrides). `--login` opens `https://claude.ai` in a visible window and waits until the window is closed. | `puller/pull_sessions.py:34`, `:213-217`, `:227`, `:230-241` |
| Reference app | `.default()` store; one web view for the life of the app. | `reference/session-capture-ios/SessionCapture/WebView.swift:16-24` |

## 3. The puller and the reference app

### 3.1 Puller pipeline

`puller/pull_sessions.py:98-198`, per link:

1. `page.goto(url, wait_until="domcontentloaded", timeout=90_000)`.
2. `page.wait_for_load_state("networkidle", timeout=30_000)`; a timeout is ignored.
3. `time.sleep(2)`.
4. Sign-in check, warning only, the files are still written: `"login" in page.url or page.locator("input[type=password]").count() > 0` (`:123-127`).
5. `find_scroller` (`:70-95`): for each selector of `SCROLLER_SELECTORS` (`:38-42`) take up to 10 matches; return the first candidate that both scrolls (`scrollHeight > clientHeight + 4`) and contains `[data-index]`; else the first that does either; else none.
6. With a scroller: the loop of section 2.5 with the same numbers (`:158-180`). Without one: a single harvest (`:181-182`).
7. Harvest through the Playwright API, not page script (`:134-145`): every `[data-index]` element, attribute must be digits after leading `-` signs, `inner_text()`, longest per index.
8. While the page loads, every response whose content type contains `json` and whose URL contains the session id, `session`, `message`, `transcript` or `events` is saved; the largest becomes `<id>.json` (`:104-114`, `:185-189`). Nothing in the repository reads these files.
9. Output `<id>.md`: `# <id>`, `Source: <url>`, a blank line, then each turn followed by a blank line, `---` and a blank line (`:191-194`). The session id is `session_[A-Za-z0-9]+` from the URL (`:45-49`).

Browser: `launch_persistent_context(profile, headless=args.headless and not args.login)`, visible unless `--headless` (`:224-228`). Default viewport and user agent.

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
| Scroller candidates | every element (`*`) with computed `overflow-y` auto or scroll (`:60-62`) | `.h-full.overflow-y-auto.overflow-x-hidden`, `main .overflow-y-auto`, `.overflow-y-auto`; first 10 matches each (`:38-42`, `:77-81`) | the same three class selectors, all matches (`:70-77`) |
| Scroller accepted when | overflows by more than 8 px and contains `[data-index]`; first in document order (`:63-64`) | overflows by more than 4 px and contains `[data-index]`; else first that does either (`:91-94`) | same as the puller (`:78-81`) |
| Scroller fallback | `document.scrollingElement` (`:67`) | none: one harvest, no scrolling (`:181-182`) | `document.scrollingElement`, then `document.body` (`:84`) |
| Looked up again each step | yes (`:54-55`) | yes (`:147-156`) | yes (`:108`) |
| Turn selector | `[data-index]` (`:79`) | `[data-index]` (`:135`) | `[data-index]` (`:90`) |
| Index parsing | `parseInt(attr)`, skip NaN (`:80-81`) | all digits after leading `-` (`:137-138`) | `parseInt(attr, 10)`, skip NaN (`:91-92`) |
| Turn text | `innerText` (`:82`) | `inner_text()` (`:140`) | `innerText` (`:93`) |
| Kept per index | longest; an empty text is never stored (`:83`, `:94`) | longest; an empty text is never stored (`:144`) | longest; the first sighting is stored even when empty (`:94`) |
| Step, pauses, cap | 0.8; 600, 450, 800 ms; 800 (section 2.5) | 0.8; 0.6, 0.45, 0.8 s; 800 (`:160-180`) | 0.8; 600, 450, 800 ms; 800 (`:104-119`) |
| Turn containers without an index | none | none | `[data-message-author-role="user"]` and `[data-message-author-role="assistant"]`; `user-query` and `model-response`; `[data-testid^="conversation-turn"]`; `main article` (`:135-150`) |
| Role from markup | no | no | yes, for the first two sets only; `null` for `[data-index]`, the last two sets and the whole page |
| Images | no | no | yes (section 3.2) |
| Whole-page fallback | `document.body.innerText` (`:176`) | none: writes a header-only file | `document.body.innerText` plus images (`:183-189`) |
| Title | first `h1, h2`, else `document.title` (`:105-106`) | session id from the URL (`:45-49`) | native page title, else host (`BrowserView.swift:108-110`) |
| Sign-in check | text markers after capture; refuses to save (section 2.9) | URL contains `login` or an `input[type=password]` exists; warning only (`:123-127`) | none |
| Network payloads | no | JSON responses saved (`:104-114`) | no |
| Waiting before capture | the person decides | DOM ready, network idle up to 30 s, 2 s (`:116-121`) | the person decides |
| Result | array of strings | Markdown and JSON files | array of `{text, role, images}` |
| Source URL kept | the URL entered (`LinkCaptureView.swift:54`) | the URL given (`:191`) | the URL the page ended on (`BrowserView.swift:113`) |

### 3.4 Roles, images and robustness

- Roles from markup: the reference app only, and only for its ChatGPT-style and Gemini-style sets.
- Images: the reference app only. The live app keeps none; they survive only in its PDF.
- Most robust per page type, as far as this repository can show:

| Page type | Live app | Puller | Reference app | Most robust today |
|---|---|---|---|---|
| Virtualized `[data-index]` list. The code comments describe Claude Code session pages this way, behind sign-in (`WebCapture.swift:4-7`, `pull_sessions.py:5-7`, `:129-131`). | Full harvest. Scroller found by computed style. Roles only when a turn's text starts with a marker. | Same harvest. Scroller found by class names. Also saves JSON responses. | Same harvest. Class names. Images. No roles. | The live app's scroller detection: with the pane's classes renamed, the class-based finders returned 10 of 45 turns and reported no problem (run, `virtual-list-renamed.html`). None of the three gets roles from markup. |
| claude.ai public share page | `[data-index]` if present, else whole page, then the "You said:" / "Claude responded:" text parser. | Not built for it. | Strategy 1 or 3, no roles. | The live app: the only one with share-page handling, and the only one reported as tested on such pages (`apple/BUILD_REPORT.md:17-24`). Its markup is not recorded anywhere in the repository. |
| ChatGPT share page | Whole page as one string. On a synthetic page with "You said:" lines this was then parsed by the claude.ai share parser: provider Claude, every message a user message (run). | Nothing. | `[data-message-author-role]` gives roles. Tested on mock pages only (`reference/session-capture-ios/HANDOFF.md:35-41`). | The reference app on paper. No one has recorded a test on a real page. |
| Gemini, signed-in chat layout | Whole page, one message. | Nothing. | `user-query` and `model-response` give roles (mock pages). | The reference app on paper. |
| Gemini, public share page | Whole page, one message (reported). | Nothing. | Returns the user's turns only and reports success, because that layout has no `model-response` (run on a synthetic reconstruction; layout as reported). | None. See section 7.1 for the proposed `gemini-share` set. |

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
| B12 | The PDF is taken before the scroll, sized from `document.body.scrollHeight`. For a transcript in an inner pane it is the first screen only. It is capped at 40,000 pt. | section 2.10 (run); (reported) the same on live pages | Section 8.3, step 9. Never present such a snapshot as complete. |
| B13 | The stored source is the URL that was typed, so a short link stays a short link and the real address is lost. | `LinkCaptureView.swift:54` | Store the final URL, and the requested URL when it differs. |
| B14 | No scheme or host validation; a single clipboard token containing a dot ("Hello.", "v1.2") is treated as a link. | section 2.1 (run) | `looksLikeLink` in section 8.1; https only. |
| B15 | Fixed sleeps, up to 800 iterations, no progress shown other than "Capturing\u2026", no detection that the chosen scroller does not move. | `WebCapture.swift:146-173` | A time budget, visible progress, a "scroller did not move" stop, a `partial` flag. |
| B16 | The launch-argument hook ships in release builds. | `ImportSheet.swift:122-130` | Do not port. Test through the fixtures. |
| B17 | Reference app: a selector set is accepted when any of its selectors matches, so one role is enough; nested matches are returned twice; images are fetched with `credentials: "include"`, which fails for cross-origin hosts that answer with a wildcard CORS header (inference); a button's label ends up in the turn text; no sign-in guard at all. | `CaptureEngine.swift:152-179`, `:37`; section 4 (run) | Require both roles; keep outermost matches only; take images from the network layer or not at all in the first version. |
| B18 | Puller and reference app find the scroller by Tailwind class names and fall back silently. | section 4 (run) | Computed-style detection, as in the live app. |

## 6. What must be different because this is a web app

1. There is no embedded browser. A web page cannot load `claude.ai`, `chatgpt.com` or a Gemini page in a frame and read it: the same-origin policy forbids script access to a cross-origin frame, and such sites normally forbid framing with `X-Frame-Options` or `Content-Security-Policy: frame-ancestors` (inference; not checked against the live sites). `fetch()` from the page is blocked by CORS and would not carry the person's cookies for those sites anyway.
2. Therefore the capture step moves to one of three places: the person (copy and paste, share sheet: T1, T2), the server (headless browser, public links only: T3), or the person's own browser through an extension or bookmarklet (T4).
3. The web app never holds a login for a provider. T3 has no cookies at all. T4 uses whatever session the person's browser already has. There is no equivalent of section 2.11 and none should be built.
4. No PDF of the page as rendered in T1, T2 and T4. "View Original" exists only for sessions that carry a snapshot: T3 captures, and Apple sessions if the interchange format carries the PDF (data-model.md decides).
5. Clipboard access needs a user gesture and, in some browsers, a permission prompt (general browser behaviour; see web-platform.md). Offer a text area as the primary paste target and "Paste from clipboard" (`navigator.clipboard.readText()`) as a convenience.
6. Work that the Apple app does on the device now runs on a server shared with secrets (database credentials, the Anthropic key). A page loaded by the server is untrusted input. Section 8.3 exists because of this.
7. In the Apple app a person looks at the page and decides when the conversation is visible (section 2.3). On the server nobody looks, so T3 needs its own readiness rule (section 8.3, step 6) and its own judgement of junk pages (section 7.4).
8. `innerText` needs a rendered page. Test extraction in a real browser engine (Playwright), not in jsdom.

## 7. Building blocks shared by all web tiers

### 7.1 One selectors data file

Provider pages change without notice, and every selector in this repository came from memory or mock pages. Keep everything that depends on provider markup or URLs in ONE data file, with one fixture per entry, loaded by the server, the page code and the tests alike. A change to the file must come with a fixture change. A draft is in `capture-scripts/proposed/capture-selectors.draft.json`; it is the input that produced the prototype results in section 4.

| Field | Meaning |
|---|---|
| `schema`, `version` | `sessionvault.capture-selectors/1`; bump `version` on every edit and store it with each capture. |
| `defaults.excludeInTurn` | Selectors of descendants left out of a turn's text. Draft: `button`, `[role="button"]`. |
| `defaults.fenceCode` | Put Markdown fences around `<pre>` text. Draft: true. |
| `defaults.coverageMin` | Share of the page text that an indexed or role-less strategy must account for. Draft: 0.5. |
| `defaults.maxMs`, `defaults.timing` | Time budget of the extractor (60 s) and the numbers of section 2.5. |
| `defaults.signIn` | `urlSubstrings` and `selectors` that mean "this is a sign-in page" (section 7.4). |
| `defaults.titleBoilerplate` | The list of section 2.7 step 4. |
| `strategies[]` | Named strategies: `id`, `type` (`containers`, `indexed`, `page-text`), selectors, plus `source` (where the selector came from), `verified` and `fixture`. |
| `providers[]` | `id` (`claude`, `chatgpt`, `gemini`, `other`), `label`, `hosts` (hosts that belong to this provider only), `shareLinks` (`host` plus a `path` regular expression for PUBLIC share links), `navigationHosts` (hosts the main frame may visit in T3), `serverCapture` (T3 switch, draft: false everywhere), `strategyOrder`, `titleSuffixes`, `roleLabels` (label lines such as "You said", for the text rules in import-rules.md; `match: "line"` means the whole line equals the text, `"line-prefix"` means the line starts with it and the rest of that line is a preview to drop, as in `Importers.swift:111-116`). |

Strategies in the draft, in the order used for an unknown host (`other`):

| `id` | Type | Selectors | Origin | Status |
|---|---|---|---|---|
| `chatgpt-author-role` | containers, roles | `[data-message-author-role="user"]`, `[data-message-author-role="assistant"]` | `CaptureEngine.swift:136-139` | mock pages only |
| `gemini-chat` | containers, roles | `user-query`, `model-response` | `CaptureEngine.swift:140-143` | mock pages only |
| `gemini-share` | containers, roles | `user-query`, `response-container` | not in the code; element names reported by an earlier review | never tested on a real page |
| `indexed-data-index` | indexed | `[data-index]`, attribute `data-index` | `WebCapture.swift:79`, `pull_sessions.py:135`, `CaptureEngine.swift:90` | used on real pages by the live app in 2026-08 per `apple/BUILD_REPORT.md`; markup not recorded |
| `chatgpt-turn-testid` | containers, no roles | `[data-testid^="conversation-turn"]` | `CaptureEngine.swift:144-146` | never |
| `generic-main-article` | containers, no roles | `main article` | `CaptureEngine.swift:147-149` | mock pages only |
| `page-text` | page-text | none | `WebCapture.swift:176` | n/a |

Per provider the draft uses: Claude `indexed-data-index`, `page-text`; ChatGPT `chatgpt-author-role`, `chatgpt-turn-testid`, `page-text`; Gemini `gemini-chat`, `gemini-share`, `page-text`.

The `shareLinks` path patterns in the draft (`/share/<id>` on `claude.ai`, `chatgpt.com`, `chat.openai.com`, `gemini.google.com`; `/gemini/share/<id>` on `g.co`; anything on `share.gemini.google`) come from general knowledge and from host names mentioned in the repository. They were not checked against real links. Tighten them after looking at one real link per provider.

Provider for a URL (replaces B8): the entry whose `hosts` contains the URL's host exactly, or one of whose `shareLinks` matches host and path; otherwise `other`.

### 7.2 One extractor

One page function, used by T3 (through `page.evaluate`) and T4 (injected by the extension or bookmarklet), with the data file entry as its argument. A prototype that implements the steps below is in `capture-scripts/proposed/web-extractor.prototype.js`. It was run in WebKit against all fixtures (section 4) and passes `node --check`. It was not run in Chromium and never against a real page. Port it to TypeScript and own it. Its text differs on purpose from what the Apple app stores for the same page (buttons left out, code fenced), so do not expect the two apps to produce identical messages.

Until the port exists, the lifted scripts can be run as they are: the `live-*.js` files in the loop of section 2.5 for `[data-index]` pages, and `reference-capture-engine.js` for container pages, with the defects listed in section 5.

Input: `{ strategies: [...in the provider's order], excludeInTurn, fenceCode, coverageMin, maxMs, timing }`.

Output: `{ extractor, url, title, heading, strategy: {id, type} | null, turns: [{index, role, text}], partial, warnings, attempts, signals: {passwordInputs, bodyTextLength}, elapsedMs }`. `role` is `"user"`, `"assistant"` or `null`.

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

Suggested stored capture metadata, for data-model.md to place: `captureMethod` (`paste`, `share`, `server`, `extension`, `bookmarklet`, `apple-webview`), `requestedUrl`, `strategyId`, `selectorsVersion`, `extractorVersion`, `partial`, `warnings`, `capturedAt`.

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

### 7.5 Failure and warning codes

Failures: `url_not_allowed`, `provider_disabled`, `busy`, `rate_limited`, `navigation_failed`, `redirect_off_allowlist`, `sign_in_required`, `blocked_by_site`, `no_conversation_found`, `timeout`, `too_large`, `cancelled`, `internal_error`.

Warnings (the session can still be saved): `partial`, `sign_in_suspected`, `page_text_only`, `index_gaps`, `several_indexed_lists`, `turn_count_dropped_while_scrolling`, `scroller_did_not_move`.

## 8. Capture in the web version, by tier

Build in this order. Each tier keeps working when the next one is absent or switched off.

### 8.1 T1: no capture, paste and file import only

What to implement (the parsers themselves are in import-rules.md):

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

3. When pasted text is only a link: do not create a session. Put it in the link field and show help: an "Open link" anchor (`target="_blank" rel="noopener noreferrer"`), then "select all, copy, come back and paste". If the link is on a known provider host but matches none of its `shareLinks`, say that it needs the person's sign-in and that a public share link is easier (the web form of the tip in `ImportSheet.swift:52-59`; wording in design.md).
4. Pasted page text goes through `parseText` with the link as source. Apply section 7.4 with strategy `page-text`.
5. Title for a paste with a link: typed name, else the first line of the pasted text if it is shorter than 120 characters and not a role marker or boilerplate line (suggestion; the Apple app uses "Pasted session", `ImportSheet.swift:218`).

A Gemini text rule is worth adding to import-rules.md for this tier: lines exactly equal to "You said" and "Gemini said" (no colon) start user and assistant turns (reported layout; unverified). On the public Gemini share layout there is no reply label, so pasted text cannot be split there.

Acceptance checks:

- Entering or pasting a link causes no request to any other origin (assert in a browser test).
- Pasting only `https://claude.ai/share/EXAMPLE-0000-0000` creates no session and shows the link help.
- `looksLikeLink` rejects `Hello.`, `v1.2`, `a.b`, `file:///tmp/x`, `see https://example.invalid/x`; accepts `claude.ai/share/EXAMPLE` and `https://example.invalid/a`.
- Pasting the page text of `share-text-markers.html` (in `expected.json`, `appleScripts.turns[0]`) with a claude.ai share link gives 4 messages user, assistant, user, assistant, provider Claude.
- Pasting the text of `sign-in-wall.html` gives the warning `sign_in_suspected`, not a silent save and not a dead end.
- A paste with link `https://chatgpt.com/share/EXAMPLE-0000-0000` is labelled ChatGPT whatever words the text contains.

Risks: copying a long conversation by hand is clumsy on a phone, which is the reason for T2 and T4. Text copied by a person is close to `innerText` but not identical; do not expect byte equality with the Apple app.

### 8.2 T2: Web Share Target

The installed PWA appears in the Android share sheet and receives a link, text or files. Manifest member (the rest of the manifest is in web-platform.md):

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
    await putPendingShare({                      // IndexedDB store "pendingShares"; File objects can be stored
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

Page `/import?share=<id>` (after sign-in if needed; the pending share stays in IndexedDB meanwhile):

1. Load the pending share; if there is none under that id, show the plain import screen. If it has files: run the file importer on each (import-rules.md) and ignore `text` and `url` unless no file yields a session.
2. Else find the link: `url` if it is a link; else `text` if `looksLikeLink(text)`; else, if `text` contains exactly one `http(s)` URL and the rest is at most 200 characters, that URL; else the same test on `title`. On Android the `url` field is usually empty and the link arrives inside `text` (general knowledge of the Android share intent; verify on a device).
3. A link with little or no other text: show the T1 link help with the link filled in, and the T3 action when that tier exists and the link matches an enabled provider's `shareLinks`.
4. Otherwise treat `text` as a pasted transcript, with the link (if any) as source and the shared `title` as the name suggestion.
5. Delete the pending share after import or discard. Delete pending shares older than 24 hours on start.

Acceptance checks:

- Chrome DevTools, Application, Manifest shows the share target without warnings.
- A test page that posts a multipart form (`title`, `text`, `url`, two `files`) to `/share-target` with the service worker active ends on `/import?share=<id>` with all parts shown.
- `curl -F text=hello https://<app>/share-target` (no service worker) gets a 303 to `/import?share_error=open_app_first`.
- On an Android phone with the PWA installed from Chrome: sharing a link from another app, sharing a `.md` file from a file manager, and sharing selected text each open the import screen with the right content. Record the device and browser version with the result.
- Sharing while signed out, then signing in, still shows the share.
- No pending share survives import, discard, or 24 hours.

Risks:

- Works only for an installed PWA and only where the browser supports it: Chrome and some other Chromium browsers on Android, some desktop Chromium installs; not Safari on iOS as far as known (see web-platform.md for the support table). T1 must stay complete without it.
- Chrome re-reads the manifest of an installed app only now and then; a change to `share_target` can take a day or more to reach a device.
- The body of the POST is lost if anything redirects it (for example to a sign-in page) before the service worker handles it. That is why the service worker stores it first.
- A share is untrusted input like a paste: same size limits, same parsers, explicit save.

If the vault were browser-only (IndexedDB, no server): this tier is unchanged except that the fallback route does not exist on a static host.

### 8.3 T3: server-side capture of public share links

The server opens the link in a headless browser of its own, runs the extractor of section 7.2, and stores the result. It works only for links that open without signing in. It is the only tier that needs a browser binary on the server; keep it behind a switch (`CAPTURE_ENABLED`, plus `serverCapture` per provider) so that T1 and T2 ship without it.

Before building it, spend half an hour on a spike from the real hosting environment: load one public share link per provider with plain Playwright and no tricks, and note whether the conversation or a challenge page comes back. A provider that challenges the server stays `serverCapture: false`. The owner must also have decided the terms question (section 10).

Interface (names are suggestions; web-platform.md owns routing, and its rules for the signed-in owner and for request forgery from other sites apply to every route here):

- `POST /api/captures` with body `{ "url": string, "name"?: string }` and nothing else. Unknown fields are a 400. Answer `202 { "captureId": ... }`.
- `GET /api/captures/:id` gives `{ status: "queued" | "running" | "done" | "failed", stage, result?, error? }`. Poll every 2 s. Stages: `loading`, `waiting_for_content`, `extracting`, `processing`. The prototype extractor reports nothing while it runs; a turn counter would have to be added (for example a `window` property that the server reads).
- `DELETE /api/captures/:id` cancels: close the browser context, discard everything.
- A result without warnings is saved at once, as the Apple app does. A result with warnings is returned for review with "Save anyway" and "Discard" (suggestion; design.md).

Pipeline:

1. Validate the URL (below). Take the per-user lock and the global browser slot, else `busy`.
2. New browser context for this capture only: `viewport: { width: 1280, height: 1600 }`, `serviceWorkers: "block"`, `acceptDownloads: false`, no `storageState`, no `httpCredentials`, no extra headers, no permissions. Do not set a custom user agent.
3. Install the request guard (rule 3 below) before the first navigation. Dismiss dialogs. Close any page other than the first.
4. `page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })`, then `page.waitForLoadState("networkidle", { timeout: 15000 })` ignoring a timeout, then wait 2 s. (The puller uses 90 s, 30 s and 2 s for signed-in pages, section 3.1.)
5. Check the final URL: host in the provider's `navigationHosts`; apply section 7.4.
6. Wait for content: every 500 ms for up to 15 s, stop when any selector of the provider's strategies matches or the length of `document.body.innerText` has been the same three times in a row.
7. Run the extractor with the provider's entry: `page.evaluate(sessionVaultExtract, config)`. Playwright sends the function's source to the page, so the function must not use anything from the surrounding module. If the page navigates while the extractor runs, the call rejects: report `navigation_failed` and do not retry in a loop.
8. Apply sections 7.3 and 7.4 in the pure module. Enforce the size limits.
9. Optional snapshot: `page.emulateMedia({ media: "screen" })` and `page.pdf({ printBackground: true })`. Store with it whether the page scrolls as a whole (`document.scrollingElement.scrollHeight > window.innerHeight + 8`). If it does not, the transcript sits in an inner pane, the PDF shows one screen only (B12), and the interface must say so. Leave this step out of the first version if in doubt.
10. Close the context in a `finally` block. Release the lock.

Limits:

| Limit | Value |
|---|---|
| Captures per user at a time | 1 (a second request gets `busy`, HTTP 409) |
| Browser contexts in the whole server | 1 |
| Captures per user per hour | 20 (`rate_limited`) |
| Input URL length | 2,048 characters |
| Navigation | 30 s |
| Extractor budget (`maxMs`) | 60 s |
| Whole capture, hard deadline | 120 s, then the context is closed and the result is `timeout`. The extractor's own 60 s budget makes it return what it has, flagged `partial`, before that. |
| Turns | 5,000 |
| Text per turn / per capture | 1,000,000 characters / 5,000,000 characters (`too_large`) |
| Snapshot | 20 MB, else dropped |
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

Also: treat share links as secrets in logs (log the host and a hash of the path, not the URL); start the browser process with an environment that does not contain the database URL or API keys; keep the browser version current; WebRTC can send UDP around a proxy, so consider the Chromium switch `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` (from memory; verify). If the platform forces `--no-sandbox`, a compromised page is one step closer to the server's files; that is a reason to keep the allow-list short.

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

Risks:

- Providers may answer a data-centre browser with a challenge or a consent page. Then this tier does not work for that provider and must say so plainly (`blocked_by_site`). The Apple code already lists "Just a moment..." and "verify you are human" as things it has to recognise (`WebCapture.swift:114`, `Importers.swift:137`).
- A headless browser needs memory (plan for 1 GB) and system libraries. On Replit the browser that Playwright downloads may not start, and a system Chromium referenced by path may be needed (inference; see web-platform.md). Settle this in the spike.
- Markup drift: a capture that silently returns less is worse than one that fails. Keep `attempts`, `warnings` and `partial` visible in the interface and in logs.
- The draft selectors are unverified. Do not enable a provider until its strategy has been checked against a real page and a fixture made from what was learned (a synthetic one: never commit a copy of a real page or conversation).
- Long conversations: the extractor budget is 60 s. Raise it per provider only with evidence.

If the vault were browser-only: there is no place to run this tier. Either a separate small capture service is added just for it, or T3 is dropped and T4 covers public links as well. If the Anthropic key were kept in the browser instead of on the server: no change to capture, but the server then exists only for this tier, which weakens the case for it.

### 8.4 T4 (later): extension or bookmarklet for private chats

The same extractor runs in the person's own browser, on the page they are looking at, signed in as themselves. The vault never sees a provider credential. It reads only what the page already shows to that person. The statements about extensions, bookmarklets and page security policies in this section are general knowledge of browser behaviour; none was tested for this document.

Common to both forms:

- Payload: `{ schema: "sessionvault.capture/1", result: <extractor output>, selectorsVersion }`. The vault treats it like a paste: validate the shape, enforce the T3 size limits, run sections 7.3 and 7.4, show a preview, save on confirmation.
- The provider entry is chosen in the page from `location.hostname`; unknown hosts use `other`.
- The tab must stay in front while the extractor scrolls; browsers slow timers in background tabs.

Extension (Manifest V3), the more reliable form on desktop:

- Permissions: `activeTab`, `scripting`, `storage`. No host permissions, no content scripts that run by themselves. The extension can read a page only after the person clicks its button on that tab.
- On click: `chrome.scripting.executeScript({ target: { tabId }, func: sessionVaultExtract, args: [config] })`, which runs in the isolated world and is not subject to the page's script policy. Then open `https://<vault>/import/receive` in a new tab and hand the payload to it (a content script limited to the vault origin, or `externally_connectable` for that origin).
- The vault origin is a setting of the extension. Distribution for one owner: load unpacked, or an unlisted store entry.

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

| Assumption changed | Effect on capture |
|---|---|
| Vault in the browser only (IndexedDB), no server vault | T1, T2, T4 unchanged apart from where the result is stored. T3 has nowhere to run (section 8.3). |
| Anthropic key kept in the browser | No effect on capture. The server remains necessary for T3 only. |
| Another stack | The extractor is plain page JavaScript and the post-processing is pure TypeScript; neither depends on React, Vite or Node. T3 needs any server that can drive a headless Chromium. |
| No interchange with the Apple app | The capture metadata of section 7.3 stays useful on its own. With interchange: the Apple app has only `sourceURL` and `snapshotPDF`; the other fields are absent on Apple sessions, and a PDF original is large (data-model.md decides whether it travels). |

## 10. Fragility, terms of use, and what the builder must not do

- Capturing third-party pages is fragile. The selectors here were never checked against a live page, the pages change without notice, and a capture can come back wrong or shorter without any error. Build every tier so that failure is visible and T1 always works.
- Automated access to these pages may be restricted by the sites' terms of use, and that can apply to T3 and to T4. Whether to enable a provider is the owner's decision, per provider, after reading that provider's current terms. Default: off.
- The builder must not attempt to get past sign-in or any other access control. In particular: no stored or forwarded cookies, tokens or passwords for a provider; no automated sign-in; no solving, skipping or outsourcing of CAPTCHAs or "verify you are human" pages; no "stealth" plug-ins, user-agent spoofing or header tricks to look like a person; no proxy or address rotation to avoid a block; no retries in a loop against a page that refused. When a page asks for sign-in or challenges the browser, the result is `sign_in_required` or `blocked_by_site`, and the person is pointed to T1 or T4.
- Capture only what the owner asks for, one link at a time, at human pace. No crawling, no following links, no scheduled re-capture.
- Never commit a real captured page, link or conversation as a fixture. Fixtures are written by hand from what was learned.

## 11. Files in capture-scripts and how they were checked

Verbatim scripts. Each has a header naming its source file and lines. The text below the marker line `// ---- begin verbatim ----` is the script.

| File | Source |
|---|---|
| `live-scroller-scroll-to-top.js`, `live-scroller-at-bottom.js`, `live-scroller-step-down.js` | `apple/SessionVault/WebCapture.swift:57-71` with the bodies from `:152`, `:159`, `:171` |
| `live-harvest-turns.js` | `WebCapture.swift:76-88` |
| `live-detect-title.js` | `WebCapture.swift:103-108` |
| `live-page-height.js`, `live-page-text.js` | `WebCapture.swift:121`, `:176` |
| `puller-scroller-probe.js` | `puller/pull_sessions.py:86-87` |
| `puller-scroll-to-top.js`, `puller-at-bottom.js`, `puller-step-down.js` | `pull_sessions.py:159`, `:165`, `:179` |
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
