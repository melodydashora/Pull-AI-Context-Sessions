# Web platform and hosting constraints

> **Status (revised 2026-11-20).** Extracted from the Apple app's source and from official platform documentation, then revised on 2026-11-20 for the decisions in `../HANDOFF.md` section 2: a product for many users, each with a private vault; each user's own Anthropic API key, stored encrypted on the server and never returned to a browser; an online vault in PostgreSQL plus an offline copy on each device. Sections 2 and 3 (the Apple app and its defects) are as first published, apart from corrected line references, one added behaviour (the Copy button on every message, A7) and one added defect (B11). Section 11 (security baseline) is rewritten for many users; 6.1 and 9.4 now follow capture.md 8.1 and claude-api.md C5; section 7 leaves the offline protocol to sync.md; section 10 carries what was measured in the Replit workspace. New: 7.4, 8.3, 10.11 to 10.13, 11.9 to 11.14, 13.5 and section 17. Nothing in this document was run against a published app.

## Summary

- Decided product (`../HANDOFF.md` section 2): many users from the first day, each with a private vault, sign-up by invitation at first. The PostgreSQL database on the server is the source of truth; each device keeps an offline copy in IndexedDB and queues the changes made offline (sync.md).
- Key custody: each user brings their own Anthropic API key. It is stored on the server, encrypted with a key from the platform's secret store, used only for that user's requests, never returned to a browser, and can be replaced and removed by the user. The server calls Claude; the browser never does; the published app has no Anthropic key of its own.
- A web page can do nearly everything the Apple app does, on Android, iOS, Windows, macOS and Linux, except the capture browser: a page may not load another site's page and read it.
- Capture on the web is paste, file import, an Android share target, and a server-side headless browser for public share links only, each provider switched off until it is checked and agreed. A link that needs a signed-in viewer, such as a Claude Code session link, cannot be captured by the server.
- Android Chrome is the best phone target (WebAPK install, `share_target`, storage shared with Chrome). iOS has no share target, no install prompt API, and storage isolated per Home Screen install.
- Browser storage can be evicted: browsers delete origin data under pressure, and Safari deletes script-written data after seven days without interaction outside installed apps. Eviction costs a re-download; only changes that were queued on a device and never sent are lost with it.
- Claude streaming runs browser -> own server -> Anthropic with `fetch` and a reader loop, heartbeats, an explicit terminal event and idempotent sends. The user's message and the reply are committed together (claude-api.md C5).
- Sign-in: built into the app with a maintained library is the default (an e-mail address and a password for as long as no mail provider exists). Claude Code can build it in the Shell alone. Replit Auth and Replit-managed Clerk can be set up only by Replit Agent, which the owner does not use, so they are not available; the platform's access gate is not a sign-in for this product (11.9).
- Replit today: separate development and production databases; schema reaches production through the Publish diff (no triggers or functions; a reported app-owned model is unconfirmed); no persistent filesystem; public by default; one port; `/` must answer in 5 seconds. Measured in the workspace: PostgreSQL 16.10, a headless Chromium that starts once one library path is added, and a home directory of which only `~/workspace` survives a restart.
- Privacy on this host: Replit Agent can read the production database, the logs and the secrets, and analytics record page paths. So no transcript text, titles, shared links, addresses or codes in logs or URLs; only synthetic data in the workspace; a server serves its own build output and never the workspace folder; no personal credential within reach of the published app.
- Security baseline for many users: sign-up by invitation, `__Host-` session cookie (`Secure; HttpOnly; SameSite=Strict`), `Sec-Fetch-Site` / `Origin` checks, strict CSP, escaped rendering, limits per user and for the whole service, storage quotas, account deletion, export per user, suspension by user id.
- Before sign-up is opened to strangers (phase 6): the fifteen conditions of 11.14, among them e-mail verification, a tested restore, and a privacy policy and terms that the owner supplies.
- Unconfirmed (section 15): long streams and work after a disconnect behind Replit's proxy, headless Chromium in a deployment, the client address behind the proxy, the app-owned model for schema changes, and how a hosted sign-in service behaves under the content security policy.

## 1. Conventions

- Scope: what the web platform and the hosting target (Replit) allow for a web version of SessionVault, and where the web version must differ from the Apple app. External facts were checked on 2026-11-19 (one source on 2026-11-20, marked in section 16). For the revision of 2026-11-20 the Replit pages marked in section 16 were read again or for the first time; no other site was read. Sources are listed in section 16 and cited as `[Wn]` (web platform) and `[Rn]` (Replit).
- Three kinds of statement are kept apart: (A) what the Apple app does today (section 2); (B) defects or accidents of the Apple implementation that the web app should not copy (section 3); (C) what the web app must do because it is a web app (sections 4 to 11).
- `Inference:` marks reasoning that neither the code nor a cited source states. `Unverified:` marks something that could not be confirmed from an official source; all such items are collected in section 15. `Measured:` marks a fact observed in the Replit workspace on 2026-11-20 by the session working there (10.11). `Reported:` marks a statement of that session that rests on the machine or on documentation stored on it and that docs.replit.com does not confirm (10.12).
- Words: "the owner" is the person who owns this product and operates the published service (`../HANDOFF.md`). A "user" is anyone with an account. Where sections 4 to 9 used to say "the owner" for the person in front of the app, they now say "the user".
- Code references are relative to the repository root, for example `apple/SessionVault/ClaudeAPI.swift:117`. Line numbers are those of commit `e81828a`.
- Browser versions come from MDN browser-compat-data 8.1.10 [W8] unless another source is cited. "Desktop" means Chrome and Edge on Windows, macOS and Linux; Safari and Firefox are named where they differ.
- Example origin: `https://vault.example`. Route names, header names and environment variable names in this document are proposals; where data-model.md, sync.md, claude-api.md or capture.md define a name for the same thing, theirs wins.
- Decided product (`../HANDOFF.md` sections 2 and 3). These four points were working assumptions when the document was first written; they keep their numbers because the text refers to them, now as "decision 1" to "decision 4": (1) many users, each with a private vault in managed PostgreSQL on the hosting platform, which is the source of truth, plus an offline copy on each device; sign-up by invitation at first; (2) each user brings their own Anthropic API key, which is stored on the server, encrypted with a key from the platform's secret store, used only for that user's requests and never returned to a browser; the server calls Claude and the browser never does; (3) TypeScript, React + Vite single-page app, small Node server, PostgreSQL, parsing in a pure TypeScript module (recommended by `../HANDOFF.md` section 3, not decided); (4) the Apple app continues and exchanges sessions through a versioned JSON format. Section 14 says what would change under the alternatives, among them the earlier assumption of one owner and one server-side key.

## 2. What the Apple app does today (A)

Only behaviour that touches a platform capability is listed. Parsing rules are in import-rules.md, the capture algorithm in capture.md, the API call in claude-api.md.

| # | Area | Behaviour today | Code |
|---|---|---|---|
| A1 | Storage | Local SwiftData store with three models; no account, no sync. iCloud sync is only an idea. | `apple/SessionVault/SessionVaultApp.swift:10`, `apple/SessionVault/Models.swift:38-114`, `apple/README.md:34` |
| A2 | Link capture | An in-app `WKWebView` loads the URL; the user signs in inside it if needed; the app injects JavaScript, scrolls the transcript and harvests `[data-index]` elements, with `document.body.innerText` as fallback. Logins persist in the web view's data store. | `apple/SessionVault/WebCapture.swift:14,20-36,46-98,146-186`, `apple/SessionVault/Views/LinkCaptureView.swift:41-56,66` |
| A3 | PDF original | `webView.__createPDF` of the page (frame grown to the content height, capped at 40000), stored in `snapshotPDF` with external storage, shown with PDFKit, shared as a temporary file. | `apple/SessionVault/WebCapture.swift:120-142`, `apple/SessionVault/Models.swift:65`, `apple/SessionVault/Views/PDFViewer.swift:5-26,35-45,59-65` |
| A4 | File import | System file picker, multiple selection, content types `.json`, `.plainText`, `.text` plus the `md` extension. Each file is read whole into memory. A `.json` file is first tried as a ChatGPT export; anything else must decode as UTF-8 or it yields nothing. | `apple/SessionVault/Views/ImportSheet.swift:26-30,153-159`, `apple/SessionVault/Importers.swift:24-33,455-468` |
| A5 | Drag and drop | File URLs dropped anywhere on the main window are imported. | `apple/SessionVault/Views/RootView.swift:72-74` |
| A6 | Clipboard import | One button reads the system pasteboard string directly. Empty -> `"Clipboard is empty."`. A trimmed value with no newline, no space, a `.` and fewer than 500 characters that parses as a URL with a host is treated as a link and opens capture. Otherwise it is parsed as text with the title `"Pasted session"`. | `apple/SessionVault/Views/ImportSheet.swift:195-226` |
| A7 | Copy out | Context pack, whole messages and code blocks are written to the pasteboard; the button shows a copied state for 2 s (context pack) and 1.5 s (message, code block). The button on every message exists since commit `e81828a` and copies `message.text` as stored. | `apple/SessionVault/Views/SessionDetailView.swift:228-241`, `apple/SessionVault/Views/MessageView.swift:33-41,60-66,173-178,196-202` |
| A8 | Share out | System share sheet with the context pack Markdown string; the PDF is shared as a file. | `apple/SessionVault/Views/SessionDetailView.swift:87-89`, `apple/SessionVault/Views/PDFViewer.swift:59-65` |
| A9 | Share in | None. An iOS share extension is only an idea. | `apple/README.md:35` |
| A10 | API key | Typed into the app, stored as a Keychain generic-password item, read on each use. The UI says: `"Add your Anthropic API key to continue this session live. The key is stored in your Keychain and sent only to api.anthropic.com."` | `apple/SessionVault/Views/ContinueChatView.swift:12,64-105`, `apple/SessionVault/ClaudeAPI.swift:135-170`, `apple/SessionVault/Views/SessionDetailView.swift:120-123` |
| A11 | Claude call | The device posts directly to `https://api.anthropic.com/v1/messages` with headers `x-api-key` and `anthropic-version: 2023-06-01` and a body containing `"max_tokens": 64000` and `"stream": true`. | `apple/SessionVault/ClaudeAPI.swift:56-68` |
| A12 | Stream parsing | `URLSession.shared.bytes(for:)`; only lines starting with `data: ` are parsed; handled event types are `content_block_delta` (with `text_delta`), `message_delta` (`stop_reason`), `message_stop` and `error`; everything else is ignored. Closing the consumer cancels the request. | `apple/SessionVault/ClaudeAPI.swift:78-123` |
| A13 | Chat persistence | The user message is inserted before the request. The assistant message is inserted only after the stream ends, and `session.modelName` is set to the model id. | `apple/SessionVault/Views/ContinueChatView.swift:254-257,290-298` |
| A14 | Network services of its own | None. The only network traffic is the capture web view and the Anthropic API. There is no sign-in. | all files under `apple/SessionVault/` |
| A15 | Automation hooks | Launch arguments `--capture-url <url>`, `--select-first-session`, `--open-import`. | `apple/SessionVault/Views/ImportSheet.swift:122-130`, `apple/SessionVault/Views/RootView.swift:75-85` |

## 3. Defects and accidents not to copy (B)

| # | Apple behaviour | Why it must not be copied on the web | Do instead |
|---|---|---|---|
| B1 | When the byte stream ends without a `message_stop` event, the client still reports success: after the loop it yields `.done(stopReason: stopReason)` (`apple/SessionVault/ClaudeAPI.swift:117-118`), and the view saves whatever text arrived as the assistant message (`apple/SessionVault/Views/ContinueChatView.swift:290-298`). | On the web a proxy timeout or a suspended tab closes the stream cleanly in mid-answer. The truncated text would be stored as a complete reply. | Require an explicit terminal event on both hops (section 9.3). A stream that ends without one is "interrupted", never "complete". |
| B2 | A failed stream discards the partial reply but keeps the user message: the user message is inserted at `apple/SessionVault/Views/ContinueChatView.swift:255-257` before the call; on error only `errorMessage` is set (same file, `299-301`) and `streamingText = ""` (`302`). The next send rebuilds the history from all stored messages (`259-265`), so the unanswered turn is sent again. | Dropped connections are routine on phones. The transcript would collect unanswered user turns, and a retry would duplicate them. | The server owns the turn: idempotency key per send, turn state stored on the server, retry reuses the text kept with the turn (section 9.4, claude-api.md C5). |
| B3 | No way to stop a reply: while streaming, the send button is replaced by a spinner and disabled and the text field is disabled (`apple/SessionVault/Views/ContinueChatView.swift:218,223-237`). | A reply can run for minutes; on the web the user needs a Stop control, and the server needs a defined policy for a client that goes away. | A Stop button that calls an explicit stop route (claude-api.md C6); policy in section 9.4. |
| B4 | The API key is held by the client and sent by the client (A10, A11). | The browser must not hold the key: anything stored in a browser is readable by any script that runs in the origin, and `../HANDOFF.md` section 3 reports Anthropic's own advice to call the API from a back end. | Each user's key is stored on the server, encrypted, and is never returned (data-model.md 7.8; section 11.6). The browser calls same-origin endpoints only. |
| B5 | Any string is offered as a link: `Link(destination: url)` for any `URL(string: session.sourceURL)` (`apple/SessionVault/Views/SessionDetailView.swift:199-205`), and the importer copies the `Source: ` line verbatim (`apple/SessionVault/Importers.swift:244`). | In a browser, an `href` with a `javascript:` URL runs script in the vault's origin when clicked. An imported file can therefore carry a stored cross-site-scripting payload. | Render `sourceURL` as a link only when `new URL(value).protocol` is `http:` or `https:`; otherwise show it as plain text. |
| B6 | The clipboard is read with no paste gesture from the user (`apple/SessionVault/Views/ImportSheet.swift:195-200`). | Browsers answer a programmatic read with a permission prompt, a "Paste" callout, or a rejection (section 6.1). | A paste field is the primary path; the button is an enhancement. |
| B7 | Whole file in memory and all-or-nothing JSON parsing (`apple/SessionVault/Importers.swift:26-29,461`). | Inference: a ChatGPT export can be far larger than a phone browser tab can parse on the main thread without freezing or being killed. | Check `file.size` first, parse in a Web Worker, upload one session per request (sections 6.2 and 11.5). |
| B8 | Lines are split on `"\n"` only (`apple/SessionVault/Importers.swift:109,238,360`); the repository README lists the consequence for Windows line endings as a known limit (`README.md:122`). | Files picked on Windows and text from some clipboards arrive with CRLF. | Normalise `\r\n` and `\r` to `\n` before parsing; the rule belongs to import-rules.md. Do not rely on the input control to do it. |
| B9 | The exported PDF file name only replaces `/` (`apple/SessionVault/Views/PDFViewer.swift:36`). | Download names reach Windows and Android file systems and an HTTP header. | Sanitise names for `\ / : * ? " < > \|`, control characters, trailing dots and spaces and reserved device names; send them with `Content-Disposition: attachment; filename*=UTF-8''<percent-encoded>`. |
| B10 | Summarise uses only `.text` events and ignores how the stream ended (`apple/SessionVault/Views/SessionDetailView.swift:148-155`). | Same failure as B1: a summary cut by a dropped connection or by the token limit is saved as if complete. | Apply the terminal-event rule to summaries too; details in claude-api.md. |
| B11 | The clipboard link test takes any single token under 500 characters that contains a dot for a link (A6): no newline, no space, a `.`, fewer than 500 characters, and a string that parses as a URL with a host (`apple/SessionVault/Views/ImportSheet.swift:208-216`). The word `Thanks.` opens the capture browser at `https://Thanks.` (import-rules.md D12; fixture `32-paste-single-word-with-dot`, for which the clipboard handler was transcribed into the Swift harness of the import fixtures, because view code cannot be called from a command line). | On the web a paste that is taken for a link is not imported at all, and `new URL()` does not parse like Foundation's `URL(string:)` (import-rules.md C12). | `looksLikeLink` of capture.md 8.1 (section 6.1, rule 4). |

## 4. Installable web app (C)

### 4.1 Facts

Chromium browsers (Chrome, Edge, Samsung Internet):

- Install criteria: served over HTTPS; a web app manifest with `name` or `short_name`, `icons` including a 192px and a 512px icon, `start_url`, and `display` set to one of `fullscreen`, `standalone`, `minimal-ui`, `window-controls-overlay`; `prefer_related_applications` absent or `false`. Chrome additionally waits for a click and 30 seconds of viewing before it offers its own install prompt [W1][W2].
- A service worker is not an install requirement: "While not a requirement for a PWA to be installable, many PWAs use service workers to provide an offline experience." [W2]
- The manifest is linked from every page with `<link rel="manifest" href="...">`; the response should be `Content-Type: application/manifest+json`. "If the manifest requires credentials to fetch, the `crossorigin` attribute must be set to `use-credentials`, even if the manifest file is in the same origin as the current page." [W3]
- `beforeinstallprompt` exists only in Chromium (Chrome, Edge, Samsung Internet); not in Firefox or Safari [W8]. MDN: "This is not supported on iOS." [W2]
- Chrome re-reads the manifest at most every 24 hours. On Android the installed app is updated only after its windows are closed and the device is charging and on Wi-Fi; the Android fields that trigger an update include `name`, `short_name`, `icons`, `display`, `scope`, `start_url`, `theme_color` and `web_share_target`. `about://webapks` has an "Update" button for testing. "Changes to the `start_url` require the manifest `id` to be set." [W11]

Android:

- "the only browsers that install PWAs as WebAPKs are: Chrome on devices with Google Mobile Services (GMS), and Samsung Internet on Samsung devices"; Firefox, Edge, Opera and others "add a browser-badged home-screen shortcut that opens the site in the browser" [W2].
- A WebAPK install shares Chrome's cookies, client-side storage and service worker, and registers Android intent filters so that links inside the manifest `scope` open in the installed app [W10][W13].

iOS and iPadOS:

- Install is manual: Share menu, then "Add to Home Screen". There is no install prompt [W12]. Since iOS 16.4 this also works from Chrome, Edge, Firefox and Orion [W2][W14].
- From iOS 26 (Safari 26.0, 2025-09-15) every site added to the Home Screen opens as a web app by default; the user can switch off "Open as Web App" in the add dialog. WebKit: "there are now zero requirements for 'installability' in Safari." Before iOS 26 a site opened as a web app only if its manifest `display` was `standalone` or `fullscreen`, or it carried Apple's older web-app meta tag [W14][W16].
- "Each installation has its own isolated storage and is treated as a different application." Only the `standalone` display mode is supported. Without an `apple-touch-icon` "the icon on the home screen will be a screenshot" [W12]. Safari uses manifest icons only when no `apple-touch-icon` is present [W8].
- "It's impossible to capture URLs on PWAs installed on iOS and iPadOS from Safari." [W13] Links to the vault therefore open in the browser, not in the installed app.

Desktop:

- Chrome and Edge show an install icon in the address bar on all desktop operating systems [W2][W12].
- Safari 17+ on macOS Sonoma: File > Add to Dock for any site, with or without a manifest. "Safari will copy the website's cookies to the web app" at that moment and "does not copy over any other kind of local storage" [W15].
- "Firefox does not support installing PWAs using a manifest file." [W2]

### 4.2 Consequences for this product

- The app must work fully in a normal browser tab. Installing is required only for the Android share target (section 5).
- On iOS a user signs in again inside the installed app, and an offline copy made in Safari is not visible to the installed app (isolated storage). sync.md counts the two as two devices.
- The origin is the identity of everything stored in the browser: installs, cookies, IndexedDB, service worker and passkeys all belong to one scheme + host + port [W26]. If the public address changes, every user's installs, sign-ins and offline copies are orphaned, and changes that were queued on a device and never sent are lost with them (sync.md 2.3). Replit's `*.replit.app` name "isn't guaranteed to stay the same when you unpublish and republish" [R6], and changing who can access a published app requires unpublishing it first [R2]. Decide the final address before anyone but the owner is invited (section 17, decision 2), and redirect every other host name to it.
- Manifest changes (for example to `share_target`) reach an installed Android app late. During testing, uninstall and reinstall, or use `about://webapks` [W11].
- The manifest, icons and service worker script contain nothing private and must be fetchable without credentials. Do not put them behind sign-in.

### 4.3 What to build

Manifest, served at `/manifest.webmanifest` with `Content-Type: application/manifest+json` and `Cache-Control: no-cache` (colours are placeholders; design.md decides them):

```json
{
  "id": "/",
  "name": "SessionVault",
  "short_name": "SessionVault",
  "description": "Private vault for AI chat sessions.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
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
}
```

Document head:

```html
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<meta name="theme-color" content="#ffffff">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

The `share_target` member is the same as in capture.md 8.2; keep the two in step.

Install affordance: on Chromium, keep the `beforeinstallprompt` event and call `prompt()` from an "Install app" button; where the event never fires (iOS, Firefox, Safari), show a short text instruction instead ("Share, then Add to Home Screen"). Detect an installed launch with the CSS media query `(display-mode: standalone)` [W8].

## 5. Shares in and out (C)

### 5.1 Support for receiving shares (`share_target`)

| Platform and browser | Receives shares | Source |
|---|---|---|
| Android, Chrome 76+ (installed as WebAPK) | Yes: title, text, url and files | [W5][W8][W13] |
| Android, Samsung Internet 12.0+ | Yes | [W8] |
| Android, Firefox | No: "The property parses, but has no effect." | [W8] |
| Android, browsers that install shortcuts (Edge, Opera, Brave) | Unverified. Inference: no, because they do not create WebAPKs [W2]. | section 15 |
| iOS and iPadOS, every browser | No. WebKit bug 194593 "Add support for Web Share Target API", reported 2019-02-13, status NEW, last modified 2026-05-23. | [W8][W9] |
| Windows and ChromeOS, Chrome 89+ and Edge 89+ (installed) | Yes: "now supported on ChromeOS and Windows" | [W6][W7][W8] |
| macOS and Linux, Chrome and Edge | Unverified | section 15 |
| Safari on macOS, Firefox on desktop | No | [W8] |

MDN marks the member experimental and "not Baseline" [W4].

### 5.2 Rules and limits

- Only an installed app can be a share target, and it must meet the install criteria [W4][W5][W7].
- One `share_target` per manifest. `method` is `GET` (data in the query string) or `POST`. Files require `POST` with `enctype` `multipart/form-data` and a `files` entry with `name` and `accept`; give both MIME types and extensions [W4][W5].
- A `POST` cannot be read by page script ("your app's main JavaScript code can't access the form data directly" [W49]). It is handled either by the server or by the service worker's `fetch` listener, which should answer with a `303` redirect [W4][W5][W7].
- On Android "the `url` field will be empty" because Android's share system has no such field; "URLs will often appear in the `text` field, or occasionally in the `title` field" [W5].
- Incoming data is untrusted: "there is no guarantee that other apps will share the appropriate content in the right parameter" [W5].
- A share delivers a link, a text or a file. It never delivers the content of the page behind a link (section 8).

### 5.3 What to build

capture.md section 8.2 owns the share flow: the record that is stored, its limits, and what the import page does with each shared field. This section gives the platform reasons and the shape of the handler inside the service worker of this document. Where the two listings differ, capture.md 8.2 governs.

Use `POST` (manifest in section 4.3), handled in the service worker. Reasons: a `GET` share target puts the shared link or text in the query string of a request to the vault's server, where platform traffic data and logs can record it (section 10.9); shared text can be a whole transcript; and the share creates data, which is what `POST` is for [W4].

Service worker (TypeScript, built with the `injectManifest` strategy so the worker is hand-written [W44]):

```ts
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Single-page-app navigations get the precached shell. API and share requests are excluded.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/share-target$/],
  }),
);

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === 'POST' &&
    url.origin === self.location.origin &&
    url.pathname === '/share-target'
  ) {
    event.respondWith(receiveShare(event.request));
  }
  // Nothing else is handled here. In particular /api/ goes to the network untouched.
});

async function receiveShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    // storePendingShare wraps the body of the handler in capture.md 8.2: it checks the limits, writes one
    // record to the store "pendingShares" of the IndexedDB database "sessionvault-inbox" (sync.md 8) and
    // returns { ok: true, id } or { ok: false, code } (for example "too_large").
    const result = await storePendingShare(form);
    const target = result.ok ? `/import?share=${result.id}` : `/import?share_error=${result.code}`;
    return Response.redirect(target, 303);
  } catch {
    return Response.redirect('/import?share_error=failed', 303);
  }
}
```

Notes on the listing:

- The redirect carries only a random record id or an error code, never shared content. `failed` is an error code added here for the case that the form cannot be read or stored.
- Workbox routes match `GET` only unless told otherwise, and unmatched requests "go against the network as if there were no service worker present" [W45]. The plain `fetch` listener above is therefore the only code that touches the share request.
- Keep the handler to "store and redirect". Browsers stop idle or slow service workers (Chrome: idle for 30 seconds, or a `waitUntil()` promise longer than 5 minutes) [W21].
- `File` objects are stored in the record as they are. Share targets exist only in Chromium browsers, where IndexedDB accepts `File` values (not re-checked today; confirm in owner test 5 of section 13.1).
- Server fallback (capture.md 8.2): the Node server also answers `POST /share-target`, without reading or logging the body, with `303 Location: /import?share_error=open_app_first`. It is reached only when no service worker controls the navigation. This route needs no authentication and no CSRF exemption because it does nothing.
- The service worker opens the database `sessionvault-inbox` and no other. It never opens `sessionvault`, the offline copy (sync.md 9).

Platform facts the import page must respect (the rules themselves are in capture.md 8.2):

1. If nobody is signed in, show sign-in first and keep the pending record. Signing out deletes the share inbox together with the offline copy (sync.md 2.6).
2. On Android the link usually arrives in `text`, not in `url` (5.2). Treat every field as untrusted input.
3. A shared link is only a link. Getting the conversation behind it needs one of the routes in section 8.2.
4. Delete the pending record only after the import is stored: in the queue of the offline copy (sync.md 6.3) or, where the copy is off, after the server has confirmed it.

Testing without an Android phone: submit a `multipart/form-data` form with the same field names to `/share-target` from a page of the app. This exercises the service worker handler in any browser with service workers. The owner then tests on a real phone with the published address.

If the service worker path cannot be made to work, the fallback is a `GET` share target for `title`, `text` and `url` only. In that case the server and every log must drop query strings, and the app must call `history.replaceState` at once. This is a worse option, not an equivalent.

### 5.4 iOS

There is no share target in any iOS browser [W8][W9]. What works instead:

1. Copy the link or the page text in the other app, open the vault, paste (section 6.1). This is the path to build and document.
2. The native Apple app, which stays (decision 4), remains the capture tool on iPhone and iPad; captured sessions reach the web vault through the interchange format (data-model.md). A share extension for the native app is only an idea today (`apple/README.md:35`) and is not the web builder's task.
3. Optional and unverified in detail: an iOS Shortcut can be shown in the share sheet ("Show in Share Sheet") [W48] and could open the vault with the shared link. If the app offers a deep link for this, put the payload in the URL fragment, for example `https://vault.example/import#url=<percent-encoded link>`. Browsers do not send the fragment to the server, so the link cannot reach logs or platform analytics. Such a link opens in the browser, not in the Home Screen app [W13].

### 5.5 Sharing out (`navigator.share`)

The Apple app offers the context pack and the PDF to the system share sheet (A8). Web equivalent:

- `navigator.share({ title, text })` needs HTTPS and a user action [W7]. Support: Chrome for Android 61+, Safari on iOS 12.2+, Safari on macOS 12.1+, Chrome desktop 128+ (89 to 127 only on Windows and ChromeOS), Edge 93+ (81 to 92 only on Windows), Firefox for Android 79+, Firefox desktop only behind a flag [W8].
- Files: test with `navigator.canShare({ files })`; supported by Chrome for Android 76+, Safari 14+, Chrome desktop 89+ and Edge 81+; not by Firefox [W8].
- Build: show "Share" only when `navigator.share` exists; always offer "Copy" and "Download .md" beside it. Inference: a very long context pack may be refused by a receiving app as text, so prefer sharing it as a `.md` file when `canShare({ files })` is true.

## 6. Clipboard, files, drag and drop, downloads (C)

### 6.1 Clipboard

Facts:

- `navigator.clipboard` exists only in secure contexts (HTTPS) [W23][W24].
- Reading (`readText()`): Chromium shows a `clipboard-read` permission prompt when the document has focus, and remembers the grant. Firefox (125+) and Safari show a transient "Paste" control that the user must choose; it is suppressed only for content the same origin wrote. Safari rejects a read outside a user gesture, and rejects if the user taps elsewhere [W8][W23][W24].
- Writing (`writeText()`): must be called inside a user-gesture handler in Safari and Firefox; Chromium accepts a gesture or a granted permission [W8][W23][W24].
- The `paste` event with `event.clipboardData.getData('text/plain')` works in every browser and needs no permission, because the user performs the paste [W8].

Build (replaces A6):

1. Primary control: a multi-line field labelled as the paste target. On phones the user long-presses and chooses Paste; on desktop Ctrl+V or Cmd+V.
2. Handle the field's `paste` event: call `preventDefault()`, take the text from `clipboardData`, keep it in memory and show a short summary (size and line count) instead of inserting megabytes into the DOM. Inference: this avoids a frozen page when a long transcript is pasted on a phone.
3. Secondary control: a "Paste from clipboard" button that calls `navigator.clipboard.readText()` directly inside its click handler. On rejection (`NotAllowedError`) or when the API is missing, focus the field and show the instruction for manual paste. Never call `readText()` on page load.
4. Recognise a link with `looksLikeLink` of capture.md 8.1 (import-rules.md W11). The Apple rule of A6 is not kept: it takes any single token under 500 characters that contains a dot for a link (B11). In short, `looksLikeLink` takes the trimmed text; refuses it when it is empty, has 500 or more characters or contains white space; prefixes `https://` when `://` is missing; requires that it parses as a URL with the protocol `http:` or `https:` and a host that contains a dot, does not end in a dot and ends in a label of 2 or more letters; and returns the URL with the protocol forced to `https`. capture.md 8.1 is the definition and lists the checks; fixtures `31-paste-link` and `32-paste-single-word-with-dot` of `../fixtures/import/` are the tests. A paste that is only a link creates no session: it goes into the link field with the help of capture.md 8.1.
5. Copy buttons (context pack, whole message, code block): call `writeText()` synchronously in the click handler with text that is already in memory. Build the context pack in the browser from the loaded session so that no network request sits between the click and the write; a request in between can lose the user gesture in Safari [W24]. The context pack needs the complete transcript: if it is not on the device yet, fetch it first and enable the button afterwards (sync.md 5.3). A whole-message copy writes `messages.text` of that message unchanged, whatever its length: no role label, no trimming, no change of line endings (data-model.md 7.14).

### 6.2 File import

- `<input type="file" multiple accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json">` works on Android, iOS and desktop and mirrors A4. Unverified: how phone file pickers apply `accept` to `.md` and `.json`; if files appear greyed out on a test phone, offer a second input without `accept` and validate after selection.
- Decide the format from the file name extension and the content, as the Apple code does (`apple/SessionVault/Importers.swift:24-33`), not from `file.type`, which is often empty.
- Read with `file.arrayBuffer()` and `TextDecoder`, or `file.text()` (Chrome 76+, Firefox 69+, Safari 14+, iOS 14.5+ [W8]). Differences from the Apple code that the parser tests must cover (recalled from the File API and Encoding standards, not re-tested today): the web decoders never fail, they replace invalid bytes with U+FFFD, whereas the Apple code returns nothing for invalid UTF-8 (`apple/SessionVault/Importers.swift:31`); they remove a UTF-8 byte order mark; UTF-16 files decode to garbage unless the byte order mark (`FF FE` or `FE FF`) is detected and the matching decoder is used.
- Large files (B7): read `file.size` first; parse in a Web Worker; show progress; send each parsed session in a request of its own, as one `session.create` mutation (sync.md 6.4); the server refuses a session above 32 MB whatever the page did (13.4). Choose and document explicit limits (suggested starting point: warn above 50 MB, and above 10 MB of text per session ask for confirmation).
- The pure TypeScript parsing module (decision 3) must not touch `window`, `document` or Node APIs so that it runs in the worker and on the server.

### 6.3 Drag and drop

- Desktop: listen for `dragover` and `drop` on `window`, call `preventDefault()` in both, and import `event.dataTransfer.files` (supported everywhere [W8]). Without `preventDefault()` the browser navigates to the dropped file and replaces the app. This mirrors A5.
- Phones: inference: dragging files between apps is not a practical path on phones; the file picker and the share target cover it.

### 6.4 File System Access and file handling

- `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`: Chrome and Edge 86+ on desktop, Chrome for Android 132+, Samsung Internet 29+; not in Firefox, not in Safari; marked experimental [W8][W25]. Safari and Firefox support only the origin-private file system (`navigator.storage.getDirectory()`) [W8][W25].
- `file_handlers` and `launchQueue` (open a file with the installed app): Chrome and Edge 102+ on desktop only [W8].
- Recommendation: do not depend on either. The documented fallbacks are `<input type="file">` and `<a download>` [W25].

### 6.5 Downloads and the PDF original

- Exports made by the server (the whole-vault export, a single session in the interchange format and, once bytes are stored, the PDF original) are served by authenticated same-origin `GET` endpoints with `Content-Disposition: attachment` and a sanitised name (B9). `<a download>` is supported everywhere [W8]. Unverified: download behaviour inside an iOS Home Screen app; test it, and keep "Share" and "Copy" as alternatives.
- The context pack is not made by the server. It is built in the browser (6.1, rule 5) and saved from a `Blob` through `<a download>`, so that it also works without a connection for a session whose transcript is on the device. Unverified: downloads from a `blob:` address under the policy of 11.4 in every browser (item 34 in section 15); check 15 in section 13.1 covers it.
- First release: no attachment bytes are stored and no route serves them (data-model.md 7.2, `../HANDOFF.md` section 6). A PDF that arrives in an interchange file is not kept; its descriptor is. The rest of this point applies from the day the owner asks for stored originals. A web page cannot render another site's page to PDF. Only a server-side headless browser could produce the "original" (A3), and only for public pages (section 8). Sessions that arrive from the Apple app through the interchange format may carry a PDF; store it and offer "Open original" as a link to an authenticated endpoint that responds with `Content-Type: application/pdf`, `Content-Disposition: inline` and `X-Content-Type-Options: nosniff`, opened in a new tab. Check that the stored bytes begin with `%PDF-` before serving them as PDF. Unverified: inline PDF display inside an `<iframe>` on phones; a new tab avoids the question and keeps the CSP without `frame-src`.

## 7. Offline (C)

### 7.1 Facts

- Service workers require HTTPS (`localhost` is allowed); the default scope is the directory of the script; a new version waits until no page uses the old one unless it calls `skipWaiting()`; browsers stop idle workers [W21][W22].
- Recommended stores: Cache Storage for the files needed to load the app, IndexedDB for data; `localStorage` is synchronous, limited to 5 MiB and unavailable in service workers [W18][W19][W22].
- Quota per origin: Chromium up to 60% of total disk; Firefox the smaller of 10% of the disk or 10 GiB in best-effort mode; Safari 17+ around 60% of total disk for browser apps and for sites saved to the Home Screen or Dock, around 15% for other apps that embed web content [W17][W18].
- Eviction: under storage pressure browsers delete the least recently used origins, and "all of its data, not parts of it, is deleted at the same time" [W18]. Safari only: "If an origin has no user interaction, such as click or tap, in the last seven days of browser use, its data created from script will be deleted. Cookies set by server are exempt" [W18]; this "does not apply to installed PWAs that have been added to the home screen" [W19].
- `navigator.storage.persist()` asks for exemption from eviction. Chromium decides silently from engagement, install or bookmark state and notification permission; Firefox asks the user; WebKit "grants a request based on heuristics like whether the website is opened as a Home Screen Web App" [W17][W18][W20]. `navigator.storage.estimate()` reports usage and quota (Safari 17+) [W8].
- Background Sync (`SyncManager`) and Periodic Background Sync exist only in Chromium [W8][W21].
- Exceeding quota raises `QuotaExceededError` [W18][W19].
- The user can clear site data at any time, and removing an installed app "may not clear the storage" [W12].

### 7.2 What this means for a copy of the vault on a phone

The protocol, the layout of the copy on a device and the test plan are in sync.md. This section keeps what follows from the platform facts of 7.1.

- The copy on a device is a cache of the user's vault on the server (decision 1; sync.md 2). Eviction costs a re-download, not data. The one exception is the queue of changes that were made offline and not sent yet: it exists nowhere else and is lost with the copy (sync.md 2.3, rule 5).
- Text is small. Illustration only (real vault sizes are not known here): 1,000 sessions of 200 KB are 200 MB, far below any quota above. sync.md 2.2 and 2.3 give the estimates and the default budget for transcripts on a device. Attachment bytes are never part of the copy, and the first release stores none.
- The copy is plain text in IndexedDB on the device, and so is the queue. Anyone who can use the unlocked browser profile can read both. Sign-out deletes them (section 11.2; sync.md 2.6). The Claude API key is never among them (11.6).
- One device holds one user's copy. A second user who signs in on the same browser profile gets the previous copy removed first (sync.md 2.6).
- iOS: the copy lives separately in Safari and in each Home Screen install (section 4.1), and sync.md counts them as separate devices. In Safari as a tab it is subject to the seven-day rule; in the installed app it is not.
- Nothing can be sent while the app is closed: Background Sync exists only in Chromium (7.1) and sync.md does not use it. Queued changes go out the next time the app is open with a connection.

### 7.3 What to build

Points 3 and 4 are superseded by sync.md. They keep their numbers because other documents cite this list.

1. Precache the application shell (HTML, JavaScript, CSS, icons) with the service worker so the app opens offline. Serve `/sw.js` from the root with `Cache-Control: no-cache`.
2. Never put API responses in Cache Storage. The service worker ignores `/api/` (section 5.3; sync.md 9) and the server sends `Cache-Control: no-store` on every API response.
3. Superseded. The offline copy is no longer opt-in and off by default: sync.md 2 defines what is stored, and the copy is on with a switch per device (sync.md section 15, decision 1). What remains of this point: show the storage use from `navigator.storage.estimate()`, and call `navigator.storage.persist()` when the copy is switched on or its first sync starts, never at page load [W20].
4. Superseded. The app is no longer read-only offline: changes made without a connection are queued on the device and replayed (sync.md 6). What still needs a connection is listed in sync.md 14: Claude, link capture, interchange import and whole-vault export. A received share stays in the `pendingShares` store of the database `sessionvault-inbox` until it is imported (section 5.3).
5. Update flow: prefer "a new version is available - reload" over silent takeover, so that an update cannot interrupt a streaming reply. With the `injectManifest` strategy this means a `message` listener that calls `self.skipWaiting()` when the page asks for it [W44]. The reload also waits for a push request that is in flight (sync.md 9, rule 6).
6. Reconcile on return: when the page becomes visible or the browser reports `online`, start a sync run (sync.md 2.5) and ask for the state of a turn that was streaming (section 9.5).

### 7.4 Browser facilities that sync.md relies on

Added on 2026-11-20. sync.md uses the facilities below. Their browser support was not checked for this revision: the versions are recalled from browser-compat-data, not read again (item 35 in section 15). Feature-detect each one.

| Facility | Used for | Recalled support | Without it |
|---|---|---|---|
| IndexedDB, two databases: `sessionvault` and `sessionvault-inbox` | The copy and the share inbox (sync.md 8) | Every browser | The app reads from the server (sync.md 2.4, "copy off") |
| `navigator.locks`, lock name `sessionvault-sync` | One sync run at a time per device (sync.md 2.5) | Chrome 69, Firefox 96, Safari 15.4 | Run without the lock; no rule depends on it (sync.md 2.5) |
| `BroadcastChannel` | Telling other tabs that a run has ended | Chrome 54, Firefox 38, Safari 15.4 | Other tabs read the copy again when they become visible |
| `indexedDB.databases()` | The browser check that sign-out removed both databases (sync.md 12.3) | Chrome 72, Safari 14, Firefox 126 | Open each database by name and test that it is empty |
| `navigator.connection.saveData` | No background fetch on a connection the user wants to spare (sync.md 2.3) | Chromium only | Fetch as usual |
| `crypto.randomUUID()` | Ids made on the device (sync.md 3.1) | Chrome 92, Firefox 95, Safari 15.4; secure contexts only | None: required |

## 8. Capture: why a page cannot read another site (C)

### 8.1 Facts

- Two URLs have the same origin only when scheme, host and port match. Cross-origin reads "are typically disallowed" [W26].
- "`fetch()` and `XMLHttpRequest` follow the same-origin policy. This means that a web application using those APIs can only request resources from the same origin the application was loaded from unless the response from other origins includes the right CORS headers." For a request with cookies the other server must name the calling origin explicitly; a wildcard is rejected [W27].
- A document in a frame from another origin exposes only a few `Window` and `Location` members and `postMessage`; its DOM is not reachable. Sites can also forbid framing with `X-Frame-Options` [W26].
- Consequence: the vault page cannot fetch a provider's share page and read it, and it cannot show the page in a frame and run the scroll-and-harvest script on it. What the Apple app does with `evaluateJavaScript` inside its own `WKWebView` (A2) has no equivalent in a web page. Unverified, and deliberately not probed with real links: which headers the providers' pages send.

### 8.2 Alternatives

| # | Route | Phones | Signed-in pages | Cost and limits |
|---|---|---|---|---|
| 1 | Paste the page text: the user opens the link in their own browser, selects all, copies, pastes into the vault. The claude.ai share-page text parser exists for exactly this input (`apple/SessionVault/Importers.swift:93-131`). | Android and iOS | Yes (the user's own browser) | No infrastructure. Inference from the code comment at `apple/SessionVault/WebCapture.swift:4-7` ("only a handful exist in the DOM at once"): on pages that render only the visible turns, select-all copies an incomplete conversation. |
| 2 | File import: transcripts written by `puller/pull_sessions.py` (`# <id>` then `Source: <url>`, `puller/pull_sessions.py:220-223`), ChatGPT exports, plain Markdown or text. | Android and iOS | n/a | Already specified by the Apple importer; large files need a worker (section 6.2). |
| 3 | Interchange import from the Apple app (decision 4). | Android and iOS | n/a | The Apple app keeps doing real captures, including PDF originals. |
| 4 | Server-side fetch: the vault server requests the link over HTTP. | Any (server does the work) | No | Works only when the provider returns the conversation without a login, without script execution and without a bot check. Inference: the Apple heuristics list `"just a moment"` and `"verify you are human"` among sign-in-wall markers (`apple/SessionVault/Importers.swift:135-139`), so such interstitials have been met. Needs the SSRF defences in section 11.5. |
| 5 | Server-side headless browser (Playwright with Chromium on the server) running the extractor of capture.md 7.2; it could also make the PDF original, which the first release does not store. | Any | No. Never store a user's provider cookies on the server. | Phase 3 of `../HANDOFF.md`: public share links only, allow-listed hosts only, and each provider switched off until its selectors are checked on one real public page and the owner agrees to automated capture for it. Measured: a headless Chromium starts in the workspace (10.11); whether one starts in a deployment is not known (10.8), so the browser sits behind `CAPTURE_RUNNER` (capture.md 8.3b). capture.md 8.3 specifies it as a job that is started with a `202` answer and then polled; on Autoscale that needs server work to continue while no request is open, which is check 3 in section 13.1. If it does not, run the capture inside one streamed request (framing of 9.3) or use a Reserved VM. |
| 6 | Android share target (section 5). | Android only | n/a | Delivers the link, text or file, not the page content. A shared link still needs route 1, 4 or 5. |
| 7 | Browser extension: a content script runs in the page the user is signed in to, harvests it and posts to the vault. | Firefox for Android supports extensions [W29]; Chrome for Android unverified; Safari needs a native wrapper (unverified) | Yes | A second product: store or developer-mode install, host permissions, and a token-based API in the vault. Out of scope until the owner asks (`../HANDOFF.md` section 6). |
| 8 | Bookmarklet: a `javascript:` bookmark runs the harvest in the provider's page and hands the result to the vault (new window plus `postMessage`, the clipboard, or a download in the puller format). | Awkward (unverified) | Yes | CSP Level 3 says policy "SHOULD NOT interfere with the operation of user-agent features like addons, extensions, or bookmarklets" [W28], but real behaviour under a provider's policy is unverified. Fragile. Out of scope until the owner asks. |
| 9 | `puller/pull_sessions.py` on a desktop computer, then route 2. It keeps the login in a browser profile on that computer (`puller/pull_sessions.py:34,242-272`). | No | Yes | Exists, and is not reliable today. The repository README says that no run has captured a full transcript yet (`README.md:12`). On mock pages it reported success with zero turns for a `404`, for a sign-in redirect and for an empty scrape; it cut long sessions at 800 scroll steps without a warning; and it could save an unrelated payload as the transcript, because it keeps the largest JSON response (capture.md 3.5). It is being hardened in `puller/`. |

Order, following the phases of `../HANDOFF.md` section 7: routes 1, 2 and 3 are the baseline on every platform (phases 1 and 2); route 5 is phase 3; route 6 feeds routes 1 and 2 on Android (phase 5). Route 4 is not planned: build it only if a provider is found to answer a plain request with the whole conversation. Routes 7 and 8 are out of scope until the owner asks (`../HANDOFF.md` section 6). Route 9 stays outside the web app. Which provider hosts are accepted and how harvested text is cleaned is defined in capture.md.

Do not copy a page script of the Apple app, the puller or the reference app into route 5. Besides the defects that capture.md lists, eight defects of the reference capture script were proven on mock pages in headless Chromium (not in WebKit, not on live pages): a stray `data-index` element hijacks the capture; the wrong element is taken as the scroll container, so that only the first screen is captured; on static pages, turns that hold only an image are dropped; cross-origin images are lost; images beyond fixed limits are dropped without a word; the scroll walk always runs, also on static pages; content that arrives later than about 0.8 s after the bottom was reached is missed (the puller shares this rule); and an article nested in an article is returned twice. capture.md section 12 has the detail; `../HANDOFF.md` phase 3 requires them fixed.

### 8.3 Link types and what can capture them

Added on 2026-11-20, from one real capture that the owner made with the Apple app. It is described as a pattern only: no real link, id or text is reproduced here or anywhere in the repository. capture.md section 13 has the detail and the consequences for the import.

| Link type | Opens without sign-in | Routes that can capture it | What a capture of the rendered text holds |
|---|---|---|---|
| Public share link of a provider, for example a path under `/share/` | Yes | 1 and 5 | The conversation as the page shows it. Selectors are unverified until checked on one real public page (capture.md). |
| Claude Code session share link: a link under `claude.ai/code/` whose id starts with `cshk_` | No: it needs a signed-in viewer | 1 (paste), 9 (puller) and the Apple app. Never 5: the server signs in nowhere. | Much less than the session; see the list below. |
| Any other conversation page behind a sign-in | No | 1; later 7 or 8 | As the page shows it. |

What the rendered text of a Claude Code session page loses (seen once, in the Apple app):

1. Tool activity appears only as one-line summaries. What the tools read and returned is absent, so a context pack built from the capture lacks most of the substance of the session.
2. The first sentence of each message appears twice: once as the page's preview line (sometimes cut at about 150 characters with an ellipsis, and with straight quotes where the body has typographic ones) and once in the full text.
3. Interface events, such as "session initialised" or a message from a subagent, become separate notes.
4. The title is the link id.

The complete source for such a session is the structured transcript that the page loads as data; the puller saves it as `<id>.json`. Its format is not documented, because no real file has been examined. `../HANDOFF.md` section 5 makes importing it a required addition to phase 1 as soon as it is. Nothing in this document depends on the format: such a file is an import like any other and gets the limits of 13.4.

## 9. Streaming Claude responses (C)

### 9.1 Two ways to stream to a browser

| | `EventSource` (server-sent events API) | `fetch` with a streamed response body |
|---|---|---|
| Request | Constructor takes a URL and `withCredentials` only, so no `POST` body and no custom headers [W31] | Any method, body and headers |
| Reconnect | Automatic; the browser repeats the request and sends `Last-Event-ID` [W30][W31] | None; the code decides |
| Limits | Without HTTP/2, 6 open connections per browser and domain across all tabs [W30] | Ordinary request |
| Support | Every browser [W8] | `response.body.getReader()` in every browser (Safari 10.1+) [W8] |
| Parsing | Built in | Own parser, about 30 lines |

Decision for the "continue" and "summarise" calls: `fetch` with `POST`. A send carries a body and must not be repeated automatically, because each repetition is a new paid generation.

Trap: do not iterate the body with `for await (const chunk of response.body)`. Async iteration of `ReadableStream` arrived in Chrome 124, Firefox 110 and only in Safari 27 [W8]. Use `getReader()`.

### 9.2 Facts about intermediaries and phones

- Proxies may buffer or drop idle streams. The HTML Standard: "Legacy proxy servers are known to, in certain cases, drop HTTP connections after a short timeout. To protect against such proxy servers, authors can include a comment line (one starting with a ':' character) every 15 seconds or so." [W31]
- nginx buffers proxied responses by default; a response header `X-Accel-Buffering: no` switches that off; `proxy_read_timeout` defaults to 60 seconds between two reads [W32]. Other proxies have their own rules; the header is harmless where it is ignored.
- Compression middleware buffers output: "this module does not work out of the box with server-sent events"; either exclude the stream or call `res.flush()` after each write [W42].
- Frozen pages: when a tab is hidden a browser may freeze it, and then "JavaScript timers and fetch callbacks don't run". On phones `beforeunload`, `pagehide` and `unload` may never fire; treat the change to hidden as "the last reliable time to save app and user data" [W33].
- Inference: a phone that moves between Wi-Fi and mobile data, or loses signal, drops the connection without any event the page can rely on. Every stream must be treated as interruptible at any byte.
- Anthropic's stream may contain any number of `ping` events, may deliver an `error` event (for example `overloaded_error`) inside a `200` response, and may add new event types that clients must ignore [W35]. The Apple parser already ignores unknown types and handles `error` (A12).
- Replit does not document a request timeout or its proxy's buffering (section 15). Inference: the documentation's `.replit` example uses `deploymentTarget = "cloudrun"` [R13] and the help pages mention a Google serving-infrastructure cookie [R6], so Autoscale probably runs on Google Cloud Run, whose documented request timeout is 5 minutes by default and 60 minutes at most, after which it "closes the network connection and returns an HTTP 504 error" [W34]. The Apple request allows up to 64000 output tokens (A11). Inference: a reply of that length can outlast 5 minutes.

### 9.3 Wire format between browser and server

Proposed framing (the server controls both ends, so the format can be small and strict):

```text
POST /api/sessions/<id>/continue        Content-Type: application/json
-> 200  Content-Type: text/event-stream; charset=utf-8

event: delta
data: {"text":"..."}

: ping

event: done
data: {"stopReason":"end_turn","assistantMessage":{...}}

event: error
data: {"message":"...","retryable":true}
```

Rules:

- Every frame ends with a blank line; lines end with `\n`; `data` is one line of JSON (`JSON.stringify` never emits a raw newline).
- Exactly one terminal event, `done` or `error`, ends a stream. A stream that closes without one is interrupted (B1).
- A comment frame `: ping` is written every 15 seconds while nothing else is sent.
- What goes into `done` and `error`, how Anthropic stop reasons map to them, and any further non-terminal events (claude-api.md adds a `start` event) are defined in claude-api.md section C6. The framing rules above hold for all of them, and a parser must ignore event names it does not know.

Server side (Node; shown with Express-style objects):

```ts
res.status(200).set({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
});
res.flushHeaders(); // the browser sees the response start before the first token
const send = (event: string, data: unknown) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
res.on('close', () => {
  clearInterval(heartbeat);
  if (!res.writableEnded) {
    // The client went away before the server called res.end(): apply the disconnect policy in 9.4.
  }
});
```

Detect a lost client on the response, not on the request. Since Node 16 the request's `'close'` event "is now emitted when the request has been completed and not when the underlying socket is closed", so for a `POST` it fires as soon as the body has been read. The response's `'close'` event "Indicates that the response is completed, or its underlying connection was terminated prematurely", and `response.writableEnded` is `true` only after `response.end()` was called [W51].

Do not pass this route through compression middleware.

Browser side:

```ts
export async function postSse(
  url: string,
  body: unknown,
  onEvent: (event: string, data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sessionvault-web' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`); // in real code: a typed error carrying the status (401, 409, ...)
  const reader = res.body.getReader(); // not for-await: Safari before 27
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue; // heartbeat
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length > 0) onEvent(event, data.join('\n'));
    }
  }
}
```

The caller records whether it saw `done` or `error`. If `postSse` returns or throws without either, the turn is interrupted and the page follows 9.5.

### 9.4 Server-side rules for a turn

These replace the Apple behaviour in A13, B1, B2 and B3. They state what the platform requires: an in-flight or interrupted turn must be representable on the server. The table for turns and the exact outcome rules are in claude-api.md sections C5 and C7; where they differ from the rules below, claude-api.md governs. Rules 1, 3 and 4 were corrected on 2026-11-20 to agree with claude-api.md C5 (`../HANDOFF.md` section 5): the first version of this document stored the user's message before the reply arrived. Rule 8 was added on the same day.

1. The browser creates a random `clientTurnId` (UUID) for each send and includes it in the body. The server keeps the user's text in the turn record under that id, not in `messages`. A later request with the same id never starts a second exchange next to a stored one: while the turn runs it gets `409 turn_in_progress`; if the turn has finished and its messages were committed, the server answers with `done` at once and generates nothing; if the turn has finished without a commit, the server starts a new generation from the text kept in the turn record and ignores the text in the body. This covers a retry after a response that never arrived.
2. One generation at a time per session: a request that arrives while one is running gets `409`. Enforce this with the stored turn state, not with process memory; claude-api.md C5 uses a unique index over the running turn, which data-model.md 7.7 places on `(owner_id, session_id)`. While a generation runs, the server refreshes a timestamp on the turn every few seconds; a turn that still says "running" but whose timestamp is older than about a minute is treated as interrupted, because Autoscale instances "restart regularly by design" [R6].
3. The server starts the Anthropic stream, relays text as `delta` events and accumulates the text itself. It writes nothing to `messages` yet.
4. On Anthropic's final event the server decides the outcome (claude-api.md C7). When the outcome is a commit, it appends the user message and then the assistant message in one write transaction, which gives the session one new change sequence number (data-model.md 7.3 and 7.9); it stores the answering model on the reply (`messages.model`) and sets `sessions.model` only when that field is empty and the session's provider is `claude` (claude-api.md C5). Then it sends `done` and ends the response. On an Anthropic error (HTTP error or an `error` event in the stream), or if the Anthropic stream ends without its final event (B1), it sends `error` and commits nothing. The transcript therefore never holds an unanswered user message (B2).
5. Stop pressed: the page calls the explicit route `POST /api/sessions/<id>/stop` and the server cancels the Anthropic request. The page does not signal a stop by aborting its own request, because an abort and a dropped connection look the same to the server; it keeps reading until the terminal event arrives. What happens to the partial text is defined in claude-api.md C6 and C7.
6. Connection lost without Stop: recommended policy is to keep consuming the Anthropic stream and commit the exchange, so that the answer is there when the user returns. Unverified on Replit Autoscale: whether the server keeps getting CPU after the client's request has ended. In Cloud Run's default request-based billing, instances are charged only while they process requests, start or shut down, and background work needs the other billing mode [W34]; Replit says of Autoscale: "You only pay for CPU and memory during request processing." [R16] Check it with the test in section 13.1. If work stops after the disconnect, either accept "interrupted, retry" or use a Reserved VM (owner decision).
7. The platform may also end a long request itself (section 9.2). The same recovery applies.
8. The Anthropic client of a turn is built from the stored key of the signed-in user and from nothing else (data-model.md 7.8). The published app has no Anthropic credential of its own (13.2, rule 23); a user without a stored key gets the error that claude-api.md defines; one user's key never serves another user's turn. A turn needs a connection and a session that is already on the server (sync.md 11), and the storage quota is checked before the turn starts, never at its commit (data-model.md 7.10).

### 9.5 Browser-side rules

1. While streaming, show a Stop button (rule 5 in 9.4). The `AbortSignal` of `postSse` is only for leaving the page. The Apple placeholder between send and first token (`apple/SessionVault/Views/ContinueChatView.swift:117-123,153-162`) maps to the time between the response headers and the first `delta`.
2. On `visibilitychange` to visible, on `online`, and after an interrupted stream: ask the server for the state of the turn (claude-api.md C6 defines `GET /api/sessions/<id>/turn`) and reload the session. If the server has the complete assistant message, show it. If the turn is still running, show "still working" and poll every few seconds. If it is interrupted, offer a Retry action that sends the same `clientTurnId` again (9.4 rule 1).
3. Never mark a reply complete on the strength of the local stream alone; the `done` event carries the stored message.
4. Summarise uses the same transport. It may take minutes for a long transcript; the page can be left and the summary appears with the next sync run (sync.md 11).

## 10. Replit as documented today (C)

Everything here is from docs.replit.com as fetched on 2026-11-19. Replit's documentation changed its structure during 2026; older tutorials may not match. For the revision of 2026-11-20 the pages marked in section 16 were read again. What was measured in the workspace on that day is in 10.11, what the session there reported beyond that is in 10.12, and the rules that follow from both are in 10.13.

### 10.1 Two ways to bring a repository in

- Import the repository as a Project (import from GitHub) [R20]. A Project has the Project Editor tools described in 10.4 to 10.8: Secrets, Database, App Storage, Publishing, Shell.
- "Code with Replit" works on a connected repository in a cloud sandbox and proposes pull requests. It is described as early access, and "Your production hosting stays where it is" [R20].
- Decided (`../HANDOFF.md` section 2): the web app is built by Claude Code in the Shell of a Project, and Replit Agent is never used (the owner's rule since 2026-11-20; until that day it read "only for platform setup"). Several integrations can be set up only by Replit Agent (10.6, 10.7): they are not available. This document therefore uses what the Shell can do alone, and names every step that needs the platform's tools and therefore the owner (11.9, 13.3).

### 10.2 Configuration, packages and what persists

- Two hidden files configure a Project: `.replit` (TOML) and `replit.nix` [R13].
- `.replit` keys shown in the documentation: `run`, `entrypoint`, `modules` (for example `["nodejs-20"]`), `[nix] channel` and `packages`, `onBoot`, `[run.env]`, `[deployment] run`, `build`, `deploymentTarget`, `ignorePorts`, `[[ports]] localPort`, `externalPort`, `exposeLocalhost`, `[packager.features] guessImports`, `packageSearch`, `enabledForHosting` [R13].
- `replit.nix` lists system packages: `{ pkgs }: { deps = [ pkgs.<name> ]; }`; packages come from Nix, not from `apt` [R13].
- Language packages are installed from the Shell with `npm install` or `pnpm add`. On Run, Replit also "automatically analyzes your code for missing dependencies" and installs the latest version unless `packager.features.guessImports` is `false` [R13].
- Package Firewall is on by default and blocks installs of packages flagged as malicious or compromised for npm, yarn and pnpm [R18].
- `replit.md` in the project root is read by Replit Agent; in repository mode Replit also reads `AGENTS.md`, `CLAUDE.md` and skills under `.agents/skills` and `.claude/skills` [R20][R22].

Illustrative `.replit` fragment. Keep the `modules` and `[nix]` lines and the `[workflows]` blocks that the workspace has: the puller's workflow "Session login (VNC)" must keep working (`../HANDOFF.md` phase 0). Add the Node module next to the Python one (Measured: at first `.replit` listed only the Python module; the documentation's example name is `nodejs-20` [R13]). The development start of the web app is a second workflow, not a `run` line. The values below are examples, not verified defaults. Reported: the machine holds a JSON schema for `.replit` against which a change can be checked (10.12, P2).

```toml
[deployment]
build = "npm run build"
run = "npm start"

[[ports]]
localPort = 5000
externalPort = 80

[packager.features]
guessImports = false
```

What persists:

| Place | Persists? | Source |
|---|---|---|
| Files in the Project (workspace) | Yes. Versioned by Git; a file's earlier versions can be restored from its history; a deleted Project can be restored for a limited time. Measured: of the home directory, `~/workspace` is the only part that survives a restart | [R26], 10.11 |
| Checkpoints | "created automatically by Agent"; they capture project files, installed packages, configuration and database contents; a rollback restores the development database only when that option is selected. Inference: a builder that is not Replit Agent gets no checkpoints and must rely on Git commits | [R10][R27] |
| Development database | Yes (10.5) | [R8] |
| Development URL | No: temporary, can change | [R12] |
| Filesystem of the published app | No: "resets every time you publish"; "Avoid saving and relying on data written to a published app's filesystem" | [R4][R5] |
| Anything outside the project directory in the workspace (home directory caches, global installs, `/tmp`) | No. Measured: only `~/workspace` survives a restart; the rest of the home directory is memory-backed. That takes with it `~/.claude` (sign-in, settings and memory of Claude Code), `~/.local/bin`, `~/.cache` (where Playwright puts the browsers it downloads [W46]) and any browser profile kept in the home directory. `/tmp` was not measured; treat it as disposable | 10.11 |

A file placed in the Project can end up in a checkpoint or commit. Replit's own export guide says to download and delete a database dump "right away, before Agent or a checkpoint saves it to your project history" [R10]. Never put real exports in the workspace.

Measured: Replit's Git panel commits every file that is not ignored, and pushes, and Replit injects a personal address as the global git identity (10.11, M9). Use the command line, add files by name, and set the repository's no-reply identity in the clone (`../../CLAUDE.md`). Reported: Replit Agent's own automation stages every file that git can see before a task merge or a checkpoint (10.12, P8).

### 10.3 Ports, addresses and the health check

- A process is reachable only through an external port. The first opened port is bound to external port 80. "Autoscale and Reserved VM deployments only support a single external port being exposed, and for the corresponding internal port not to be using `localhost`." [R13]
- The server must listen on `0.0.0.0`. If `[[ports]]` entries exist, automatic detection is off and one entry must have `externalPort = 80` [R5][R13].
- "Replit passes the correct port through the `PORT` environment variable" [R6].
- "Before marking your published app as live, Replit sends an HTTP request to your app. If your homepage takes more than five seconds to respond, the health check can time out and publishing can fail at the final step." [R5]
- Development URL: `UUID.servername.replit.dev`, "only live while you actively work", "can change each time you reopen the app", and "private by default": it requires a Replit sign-in unless "Private preview" is switched off. External access tokens can reach it for API traffic only: a single-page app loads its scripts "in follow-up requests that won't carry your token, so those requests fail" [R12]. Consequence for a product with accounts: nobody but the owner and collaborators can reach the development address, so other people can try sign-up and invitations only on the published app. The builder tests two users with two browser contexts at `http://localhost:<port>` (13.2, rule 19).
- "The Preview tool renders the page inside the Project Editor", and offers "Open in a new tab" [R28]. Inference: the pane shows the app in a frame on a different site (the editor). With `frame-ancestors 'none'` (11.4) the app will not render there, and a `SameSite=Strict` cookie (11.2) is not sent from a cross-site frame, so sign-in cannot work inside the pane. Open the development URL in its own tab instead. Do not weaken the framing headers or the cookie to make the pane work.
- Predefined variables: `REPLIT_DEPLOYMENT` is `1` in a published app and unset otherwise; `REPLIT_DOMAINS` is a comma-separated list of the project's domains (republish after adding a custom domain to refresh it); `REPLIT_DEV_DOMAIN` exists only in the workspace [R11][R13][R14].
- The Public Suffix List (version 2026-11-19) contains `replit.app` and `*.replit.dev` [W50]. Each `name.replit.app` is therefore its own site: other customers' apps are cross-site for cookie purposes and cannot set cookies for a shared parent domain.

Consequences: one Node process serves the API and the built static files on one port, in development and in production. It serves the app's own build output and nothing else (10.13, rule 1). `GET /` returns the static shell without touching the database. Listen on `Number(process.env.PORT) || 5000` at `0.0.0.0`, and log the port at start-up. If the published app shows "Application failed to respond", compare the logged port with the `[[ports]]` entry (item 24 in section 15).

### 10.4 Secrets

- The Secrets tool stores values with "AES-256 encryption at rest" and exposes them as environment variables. "Configurations" in the same tool are for non-sensitive values [R11].
- Production: "To find secrets for your published project, open Publishing, select Adjust settings, and locate Production app secrets." Secrets are available to all deployment types except Static [R11].
- The documentation contradicts itself about whether development secrets reach production: "Secrets sync automatically from your development environment to your published app when you publish or republish" [R3] versus "Secrets you set in the Project Editor do not automatically carry over to your published app" [R5] and "Replit keeps development and production secrets in separate stores" [R6]. Always check Production app secrets by hand.
- Collaborators can read secret values, and a database export guide warns against saving a connection string "in Secrets, where collaborators and Agent can read it" [R10][R11].
- Measured: the workspace has `DATABASE_URL`, the `PG*` variables and a `SESSION_SECRET` variable (10.11). Reported: the Shell can read secrets and cannot set or rotate them (10.12, P5). Every secret that this document names is therefore a step for the owner in the Secrets tool (13.3, 13.5).
- Account secrets can be linked to a project and then stay in step with the account [R11]. Before the first publish, check that no linked account secret is an Anthropic credential (13.2, rule 23) or any other personal credential (10.13, rule 5).

### 10.5 Database

| Topic | Development database | Production database | Source |
|---|---|---|---|
| Created | With every Project | "when you publish", "provided your development database contains data" | [R8] |
| Engine and host | PostgreSQL 16 on Replit's own infrastructure ("Helium") since 2025-12-04. Measured: version 16.10, empty on 2026-11-20 (10.11) | Neon-hosted PostgreSQL (the docs speak of "the Neon production database" and of Neon archiving it after 24 hours without access) | [R8][R10] |
| Connection | `DATABASE_URL`, connected automatically, not shown in Secrets; "Only accessible from within your app; never exposed publicly"; no SSL ("The server does not support SSL connections" if SSL is forced). The documentation says that the `PG*` variables are not provided on the current infrastructure; Measured: this workspace has them. Use `DATABASE_URL` only | A separate `DATABASE_URL` in the published app; SSL; reachable from external SQL clients with its connection string; no pooling by default (append `-pooler` to the host for a pooled connection) | [R8] |
| Cost and limits | Free, capped at 20 GB (50 GB on Pro and Enterprise) | Billed for compute time and storage; suspends after 5 minutes idle; limit 100 GiB on paid plans, 1 GiB on Starter | [R8][R16] |
| Who can change it | The builder, Replit Agent | The published app; the owner through the Database tool ("Enable Editing"). Replit Agent "can read it through a read replica but can't change it" | [R8][R10] |
| Recovery | Rollback to an Agent checkpoint, up to 7 days | Point-in-time recovery, on by default with a 7-day window (6 hours to 7 days; 28 days on Pro and above); optional daily scheduled backups kept 7 days on Core. A point-in-time restore replaces the live data | [R10] |
| Export | n/a | Per-table download (CSV, JSON, XLSX) in the Database tool; `pg_dump` from the Shell with the production connection string | [R10] |

As documented, schema changes reach production only through Publish [R9]; 10.12 reports a second model (P3):

- During publishing Replit compares the schema of the development and production databases, generates SQL, asks about ambiguous changes (for example rename or new column), validates the SQL on a copy of production, and applies it "after your app builds and before the new version goes live". "It compares the databases themselves, not your schema file."
- Migrated: tables, columns, indexes, constraints, views, enums, sequences, row-level security policies. Not migrated: "Domains", "Functions, procedures, and triggers", "Grants"; roles only in a limited way. "Triggers and grants usually don't cause an error. Publishing succeeds, but your published app may behave differently from Preview."
- Row-level security (read on 2026-11-20): policies are copied, but "`FORCE ROW LEVEL SECURITY` isn't copied", so that "The table's owner, often the role your app connects as, then isn't restricted by the table's policies in production"; roles and functions that a policy uses are not created; and policy conditions "aren't always copied".
- "your app's build command and startup code should never change the database schema. Don't add `drizzle-kit push`, `db:push`, or `CREATE TABLE IF NOT EXISTS` statements to the deployment build command or your server's entrypoint."
- Choosing "create new" for a real rename "is the most common way to lose production data during a publish".
- The tool behind the diff is drizzle-kit.

Consequences for the builder:

1. The publish diff is the documented way for a schema to reach production, and the only one that docs.replit.com describes. 10.12 reports a second, app-owned model; which of the two is in force has to be settled before the first table of phase 2 exists (section 17, decision 3). Under the documented model: the development database is the source of the schema that Publish promotes. Either describe the schema with Drizzle ORM and apply it with `drizzle-kit push` from the Shell, or apply the SQL drafts (data-model.md 7.2, claude-api.md C5, section 11.2) to the development database with a script that runs only in the workspace. In both cases production is changed only by Publish: never migrate from the build command or at start-up. What the diff tool cannot represent may be lost on the way to production (check 4 in section 13.1).
2. Use no triggers, functions, procedures or domains. Maintain `updated_at` and any search column in application code, as data-model.md already specifies. Unverified: whether partial unique indexes (claude-api.md C5 uses one), GIN indexes, operator-class indexes, `CHECK` constraints with regular expressions and extensions survive the diff; read the generated SQL at the first publish (check 4 in section 13.1). The revised data-model.md 7.2 needs composite primary and foreign keys and `CHECK` constraints to pass, and nothing else from this list.
   - Extensions: the revised data-model.md 7.2 creates no extension and leaves the trigram and GIN indexes out. If they are added later, the extension must exist in production before the publish that creates the index (inference: an index with `gin_trgm_ops` cannot be created otherwise); the owner would run `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the production SQL console first. Whether either database offers the extension is unverified.
3. Connection code must use SSL in production and no SSL in development. The documentation's example is `ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false` [R8]. Prefer keying on `REPLIT_DEPLOYMENT === "1"`, and try certificate verification (`ssl: true`) first; fall back to the documented setting only if verification fails (unverified which is needed).
4. Use one small pool per process (for example 5 connections). Do not connect at start-up; the first query after idle time has to wake the database. With more than one machine (11.5) every machine has a pool of its own, and the production database has no pooling by default [R8].
5. The Publish step, including the review of the generated SQL, is done by the owner in Replit's interface. Write that review into the release checklist.
6. Real transcripts exist only in the production database. The development database holds synthetic data only: no real transcripts, exports or dumps (`../HANDOFF.md` section 8; 10.13). Never choose an option that copies development data to production or the reverse.
7. Row-level security protects nothing on this platform as it stands. Reported: the role of the development database is a superuser, which no policy restricts. In production `FORCE ROW LEVEL SECURITY` is not copied, so the owner of the tables is not restricted either [R9]. Isolation between users rests on the application's own rules and their tests (data-model.md 7.12); data-model.md 7.13 keeps row-level security out of the first schema and lists the checks (check 10 in section 13.1).
8. Replit Agent can read the production database through a read replica [R8]. With other people's data in it, that is a privacy fact for the owner (10.9), not a debugging aid for the builder.

### 10.6 Authentication offered by the platform

Read again on 2026-11-20 [R2][R14][R29].

- Access gate for the whole published app, no code: "Public", "Password protected" (a shared password, no Replit account needed), "Workspace only", "Invite only". "apps in your personal workspace default to Public". With the private options visitors "are prompted to sign in through Replit". "Changing access requires unpublishing your app first." [R2] A gated app gates every request, including script bundles [R12]. The gate knows no users of the app, so it cannot be the sign-in of a product with accounts.
- Contradiction: another page says access controls are "Available only for Pro and Enterprise members" [R4].
- Replit Auth: visitors sign in with Replit accounts, on a login page with Replit's branding. "The only way to implement Replit Auth is by using Agent"; "Manual implementation is not supported" [R14].
- Clerk Auth managed by Replit: a Clerk tenant of the app's own, with user accounts that are not Replit accounts. It is added by a request to Replit Agent, which creates the tenant, stores its keys, configures routes and adds middleware. It is the default when Agent adds sign-in on Starter, Core and Pro [R14][R29]. What the page says, as far as it matters here:

| Topic | Documented [R29] |
|---|---|
| What Agent changes in the app | It stores `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, "Configures a proxy", adds "Pre-built Clerk React components" and Clerk's Express middleware. "The Clerk proxy must be mounted before body parsers in your Express app". |
| Sign-in methods | E-mail address and password with e-mail verification; Google, GitHub, Apple and X. Not supported: sign-in by phone number, organisation tenants. |
| Verification mail | Sent by Clerk. No setup on a `.replit.app` name or on a domain bought through Replit; DNS records are needed for a domain managed elsewhere. |
| Environments | Development and Production are separate, with separate keys and separate user stores: an account made in the workspace does not exist in the published app. |
| Settings | Users (view, search, ban) and sign-in providers in the Users & Auth tool. Multi-factor sign-in, session lengths and further settings only in the Clerk dashboard, which is available "on the Replit Pro and Replit Enterprise plans". |
| Price | "Clerk Auth is free for now. Usage-based pricing may be introduced later". No limit on monthly active users. |
| An own Clerk account instead | Possible: "integrate your external Clerk app directly". |

- Not stated on the pages read: whether sign-up in a Replit-managed tenant can be limited to invited people; which cookies Clerk sets and with which attributes; which scripts, styles and hosts its components need (items 36 and 37 in section 15).
- Recommendation in section 11.9: sign-in built into the app; publish as "Public".

### 10.7 App Storage (object storage)

- Backed by Google Cloud Storage; buckets "are always private"; no lifecycle rules, versioning or retention policies; JavaScript SDK `@replit/object-storage` (`import { Client } from "@replit/object-storage"`) or the Google Cloud Storage client [R15].
- A bucket belongs to one project and "lets you share data between the development and production environments of the same Replit App" [R15]. Code running in the workspace can therefore read objects written by the published app.
- Buckets are created in the App Storage tool or by Agent [R15].
- Decision asked for by data-model.md 7.2 ("Where to keep the bytes ... is a hosting decision for web-platform.md"): the first release stores no attachment bytes at all. `blobs` is not created, and no route stores or serves bytes (data-model.md 7.2; `../HANDOFF.md` section 6). From the day the owner asks for stored originals: keep the bytes in PostgreSQL (`blobs.data`, type `bytea`), not in App Storage. Reasons: objects in App Storage are reachable from the workspace; a bucket has to be created through Replit's tool or by Agent, which the builder cannot do from the Shell; and with `bytea` one export and one point-in-time history cover everything. Costs: database storage is billed at a higher rate than App Storage (10.8), and bytes count towards point-in-time history. Rules: never select the `data` column in list or transcript queries; serve bytes only through the authenticated endpoint in 6.5; enforce data-model.md's per-object size limit; count the bytes per user and give them a limit of their own (data-model.md 7.10, rule 5); run check 9 in section 13.1 before relying on large uploads. Revisit if the stored originals grow beyond a few gigabytes.

### 10.8 Publishing, limits, headless Chromium

| Topic | Documented fact | Source |
|---|---|---|
| Deployment types | Autoscale (default; "scales to zero when idle"), Static (no backend), Reserved VM ("never sleeps"), Scheduled (runs a command on a schedule) | [R1] |
| Autoscale behaviour | Goes idle after 15 minutes of inactivity; first request after idle "can take a few seconds"; "restart regularly by design" (`SIGTERM`); "Max machines" caps scaling | [R3][R6][R16] |
| Filesystem | "The file system in published apps is not persistent and resets every time you publish." App size limit 8 GB for Autoscale and Reserved VM | [R4][R5] |
| Isolation and region | Published apps run in a single-tenant Google Cloud project per customer; geography is chosen at publish on Core and above and "is permanent" | [R4][R18][R32] |
| Address | `<name>.replit.app`; custom domains need an `A` and a `TXT` record, the `TXT` record must stay, Cloudflare-proxied records are not supported; the `.replit.app` name can change after unpublish and republish | [R6][R21] |
| Releases | Publish again to update; deploy logs name the build id, deployment id and Git commit, and Replit adds a "Published your App" commit. "You are responsible for keeping track of your releases". Going back: one help page says to redeploy an earlier version from Publishing > History, another says "Replit no longer supports rolling a published app back to a previous version" and to restore the project state and publish again. Tag each released commit in Git. | [R3][R6][R26] |
| Logs | "Replit retains deployment logs for 30 days"; "Ask Agent to investigate, and it reads the logs for you" | [R7] |
| Monitoring | Uptime checks with mail alerts on paid plans. A monitoring agent can be set up for "automatic fixes and republishing"; leave that off (10.9) | [R7] |
| Plans | Starter: one published app that "will automatically go down after 30 days"; Core: unlimited published apps. SSH and Replit AI Integrations need a paid plan | [R16][R19][R23] |
| Prices (from 2026-08-01) | Autoscale: base fee of 1 or 2 USD per month (two pages disagree), 0.60 USD per million compute units, 0.40 USD per million requests. Reserved VM: 15 USD per month for 0.5 vCPU and 2 GB shared; 35 USD for 1 vCPU and 4 GB dedicated. Production database: 0.16 USD per compute hour, 0.35 USD per GiB-month. Prices change; read them again before deciding | [R16] |
| Resource limits | CPU, RAM and storage "determined by plan"; 20 concurrent apps; a limit on concurrent outgoing connections exists; no numbers on the docs pages read | [R17] |
| Cookie added by the platform | `GAESA`, a routing cookie from Google's serving infrastructure, without `Secure` or `HttpOnly`; the app cannot change it. Oversized request headers (many cookies) are rejected with `403` at the edge | [R6] |
| Analytics and add-ons | Default analytics use traffic data and show "Top Pages"; with "Enable analytics" Replit "adds the analytics tracker to your published app"; a feedback widget and, on Starter, a "Made with Replit" badge can be added to the app | [R3][R16][R24] |
| Shared responsibility | Replit: TLS, encryption of platform-stored data at rest, edge DDoS and WAF protection, backups of managed databases. You: sign-in, access control, application-layer encryption, logging, security testing | [R18] |
| Headless Chromium | Nothing in the official documentation (searched again on 2026-11-20). Replit Agent's own "App Testing" uses a browser, but that is not a facility for apps. Measured in the workspace: see below | [R25], 10.11 |

Headless Chromium, what is known from other sources:

- Playwright officially supports Debian 12 and 13 and Ubuntu 22.04, 24.04 and 26.04 on Linux, and Node.js 22, 24 or 26 [W46]. Replit environments are configured through Nix (10.2).
- `npx playwright install --with-deps` installs operating-system packages; `--only-shell` downloads only the headless shell; browsers are cached in `~/.cache/ms-playwright` unless `PLAYWRIGHT_BROWSERS_PATH` is set; `PLAYWRIGHT_BROWSERS_PATH=0` puts them under `node_modules` [W46].
- On NixOS, browsers downloaded by Playwright "will not function due to missing dependencies"; the Nix package `playwright-driver.browsers` is used with `PLAYWRIGHT_BROWSERS_PATH`, and "the version of Playwright in Nixpkgs and your node developer environment ... must match" [W47] (community wiki, not an official Playwright or Replit source).
- A second community-reported route is a Chromium installed through Nix and handed to Playwright by path; the browser must fit the Playwright version. The puller already has an option for an external binary (`--browser-exe`, `puller/pull_sessions.py:237-241`).
- Machine size for a published app (CPU and memory) is set under Publishing > Adjust settings > Machine configuration [R3]. capture.md plans for about 1 GB of memory for the browser.
- Measured (10.11, M4 and M5): in the workspace a headless Chromium launches, but only with the folder of `libatomic.so.1` on `LD_LIBRARY_PATH`. The browser is the one that the Nix configuration provides, found with `command -v chromium`; `.replit` also lists `playwright-driver`. Inside a workflow that name resolves to an older build (138) than in an interactive shell (155), and a profile opened by the newer build crashes the older one. So: resolve the binary once at start and log its version; give every launch a fresh temporary profile; never let a workflow and a shell share a profile folder. Whether Playwright for Node needs the same library path is not known (`../HANDOFF.md` section 3).
- Browsers that Playwright downloads go to `~/.cache/ms-playwright` [W46], which does not survive a restart of the workspace (10.2). Use the browser that Nix provides, by path.
- Not known: whether a deployed app can start a headless browser at all, how much memory the default machine of a deployment has, and whether Nix packages such as Chromium exist at run time in a deployment. Reported: a headless browser fits a Reserved VM, not Autoscale (10.12, P9). Until check 6 in section 13.1 is answered, capture stays behind one interface (`../HANDOFF.md` section 3). capture.md 8.3b defines it: `CAPTURE_RUNNER` is `local`, `remote` or `none`, and `none` in a deployment until the check has passed there (section 17, decision 9).
- The connector catalogue lists a managed headless-browser service [R30]. It was not evaluated. It would send every captured link and page to a third party through a connection that belongs to an account; not without the owner's decision.

### 10.9 Privacy consequences of the platform

With many users, the data below belongs to other people. The owner's privacy text has to say what this section establishes (11.14); the builder writes none of it.

1. Replit Agent can read the production database through a read replica, can read deployment logs, and can read Secrets (10.4, 10.5, 10.8). Whoever works in the workspace can read the development database and App Storage objects (10.7).
2. The platform records request paths ("Top Pages") and counts the client addresses that reach the app [R7][R24]. Keep private data out of URLs: use opaque ids in paths, never titles; carry shared links, invitation codes and one-time tokens in a `POST` body or in a URL fragment (sections 5.3, 5.4, 11.10 and 11.11).
3. Leave "Enable analytics", the feedback widget and the automatic fixes of the monitoring agent off for this app (10.8). The first two add third-party script to a private vault; the third lets an agent change and republish a service that holds other people's data.
4. Real data enters only through the published app's own interface. The workspace, its database, its logs and its files hold synthetic data only (10.13).
5. Asking Replit Agent to investigate the production database or the deployment logs gives it whatever they contain: with plain-text storage the transcripts of every user, and in any case their e-mail addresses (see 11.6 for field encryption). Once anyone but the owner has an account, do not do it (section 17, decision 11).
6. Whoever can read both the production secrets and the production database can decrypt every stored Claude API key (11.6). On this platform that is the owner's Replit account, every collaborator of the project, and Replit Agent when it is asked to work on the project. Keep the project without collaborators.
7. The region of a published app is chosen at the first publish and cannot be changed afterwards; the free plan publishes to North America [R18][R32]. App, database and object storage are placed together. Another page says that all published apps are hosted in the United States [R4]; look at the Publishing tool. The owner chooses the region knowingly (13.3).
8. For a published app the owner is responsible for how users sign in, access control, privacy notices and consent, the sub-processors the app uses, security testing of the app and incidents that start in the app; the platform is responsible for its infrastructure [R18].

### 10.10 Replit AI Integrations (alternative to an own Anthropic key)

Not used. Replit can supply Anthropic access with its own credentials, billed to Replit credits, set up by Agent, on Core and above [R19]. Under decision 2 each user brings their own Anthropic API key and the owner pays for nobody's usage, so the app needs no model access of its own. Do not switch this integration on for the project: 13.2 rule 23 forbids an Anthropic credential in the app's environment (inference: the page does not name the variables that the integration sets). For the record: its model list on 2026-11-20 includes `claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4-5` but no Fable model, which the Apple app offers (`apple/SessionVault/ClaudeAPI.swift:8-14`). Which models a user sees is that user's choice; claude-api.md covers it.

### 10.11 Measured in the workspace on 2026-11-20

Added on 2026-11-20. Measured by the Claude Code session that works in the Replit workspace of this repository; some of it is also in `../HANDOFF.md` section 3 and `../../CLAUDE.md`. A workspace is not a deployment: nothing here says what a published app can do.

| # | Measured | Where it matters |
|---|---|---|
| M1 | PostgreSQL 16.10 is provisioned and empty. It is exposed as `DATABASE_URL` and the `PG*` variables. `psql` is on `PATH`. | 10.5; data-model.md 7.2 can be applied to a scratch database of that server (M13; 13.3, step 7) |
| M2 | A `SESSION_SECRET` variable exists. | 10.4, 13.5 |
| M3 | At the time of measurement Node was not installed: `.replit` listed only the Python module. Python 3.12, Python Playwright and Chromium were present. | 10.2; phase 0 |
| M4 | Headless Chromium launches, but only with the folder of `libatomic.so.1` on `LD_LIBRARY_PATH`. | 10.8; check 6 in 13.1; 13.2 rule 19 |
| M5 | `command -v chromium` can resolve to two builds (138 and 155 were seen). Measured later the same day: a workflow and a newly opened shell both get the build that `.replit` installs; a process that was started earlier keeps the `PATH` it was started with and can resolve the name to the other build. A profile opened by the newer build crashes the older one. | 10.8 |
| M6 | 4 CPUs and 8 GiB of memory. | The workspace only |
| M7 | Only `~/workspace` survives a restart. The rest of the home directory is memory-backed. | 10.2 |
| M8 | An anonymous request for the workspace returns "not found", so the workspace appears to be private. The owner has been asked to confirm it in Replit's interface. | Item 28 in section 15; 13.3 |
| M9 | Replit's Git panel commits every file that is not ignored, and pushes. Replit injects a personal address as the global git identity. | 10.2, 10.13 |
| M10 | Replit adds a `[[ports]]` entry to `.replit` by itself when a process opens a port. For a test server bound to `127.0.0.1:5173` it wrote `externalPort = 6000` with `exposeLocalhost = true`. A port bound to localhost is therefore not private in the workspace. | 10.3; read the diff of `.replit` before committing it |
| M11 | A Chromium that crashes writes a dump under the workspace's `.config/chromium/Crash Reports/` that contains the whole process environment, the database password included. | capture.md 8.3; 13.2, rule 24 |
| M12 | The formatter of the web workspace reflows Markdown tables unless Markdown files are excluded. | 13.2, rule 27 |
| M13 | The development role may create databases: creating one took 0.6 s and dropping it 0.2 s; tables made in a scratch database did not appear in the database that `DATABASE_URL` names; the server holds no other project's data. Not checkable from the shell: whether the platform's database pane, checkpoints or publish step look at other databases of that server. | 13.3, step 7 |
| M14 | A process that was started before Replit rebuilt the environment keeps the old session of the git sign-in helper (`GIT_ASKPASS`). GitHub then answers its pushes with "Invalid username or token", while a newly opened Shell pushes without trouble. Seen with a Claude Code session that ran for hours: its pushes worked at 06:15 UTC and failed from 09:55 UTC on, and the owner pushed the same commits from a new Shell tab. | `../../CLAUDE.md`, "On Replit": start a long-running session again from a newly opened Shell after `.replit` changed, or push from a new Shell |
| M15 | The `[[ports]]` section of `.replit` is Replit's own: it replaced a hand-written entry `5000 -> 80` twice within ten seconds by an entry for 5173 that it remembered, accepted `5000 -> 80` only once a process was listening on port 5000, and then added its entry for 5173 beside it. | M10; expect that section to differ from git, and do not fight it. A stale entry is removed by the owner in Replit's Networking tool |
| M16 | `npm install` writes into `package-lock.json` the address it downloaded each package from. On Replit that is the platform's package proxy (`http://package-firewall.replit.internal/npm/`), a host that exists nowhere else: a lock file that names it installs only on Replit. With `https://registry.npmjs.org/` in the file, `npm ci` on Replit still goes through the proxy, because npm replaces that host by the configured registry (`replace-registry-host`, default `npmjs`): run here with all 96 packages. | After adding a package on Replit, rewrite the new `resolved` address; a test in `web/app/src/config.test.ts` keeps the file that way |
| M17 | Replit's own runner executed the workflow `Web app (dev)` of `.replit` (its log shows the server's start-up line), and the page answered under the workspace address. The owner nevertheless reported that Replit's interface showed no workflow or setup for a preview. The cause is not known. By the owner's decision of the same day the preview is looked at later. | 13.2; nothing relies on the preview pane |

### 10.12 Reported by the workspace session, not confirmed here

Added on 2026-11-20. A second report of the same session. Its sources are the machine and documentation stored on it. Nothing in this table was found on docs.replit.com on that day (the pages of [R8], [R9], [R11], [R13] and [R30] and the change logs from 2026-08-07 to 2026-11-13 were searched), and nothing was checked from outside the workspace. Treat each row as a lead to confirm, not as a fact to build on.

| # | Reported | What the official pages say | Consequence |
|---|---|---|---|
| P1 | Node 24, 22 and 20, pnpm and bun are on the machine; a module name in `.replit` puts one on `PATH`. npm installs go through Replit's package proxy. Phase 0 was built there with Node 24. | The example module name is `nodejs-20` [R13]. | 13.2 rule 8 |
| P2 | The machine holds a JSON schema for `.replit`. | Not mentioned. | Check changes to `.replit` against it. |
| P3 | There are two models for schema changes, and changing the model later is not supported. Publish-managed: the diff of 10.5. App-owned: a variable `REPLIT_DATABASE_MIGRATIONS=app` is declared before the first table exists, and the app then runs additive migrations at start under an advisory lock. Only Replit Agent or Replit's interface can set that variable. Replit Agent is not used (10.13, rule 7), so setting it is the owner's step in Replit's interface; where the interface offers it has not been seen. | Only the publish-managed model, with the instruction that the build command and start-up code "should never change the database schema" [R9]. | Settle it before the first table of phase 2 (section 17, decision 3). |
| P4 | The development database is a local PostgreSQL with a superuser role and no TLS. | "The server does not support SSL connections" if SSL is forced [R8]. The role is not described. | 10.5, consequences 3 and 7 |
| P5 | The Shell can read secrets and cannot set or rotate them. `SESSION_SECRET` was created by the platform. | The Users & Auth tool lists "the session secret" among its settings [R14]. | Every secret is a step for the owner (13.3). |
| P6 | Connectors that are attached to a Replit account can be reached by server code in a workspace of that account, and in a deployment made from it, through the platform's identity. | "Connections are tied to your Replit account and persist across all your apps"; credentials and tokens "are managed by the platform, not stored in individual apps"; each connection lists its "Connected apps" [R30]. Identity tokens for outside secrets managers "are available only in development environments and the workspace"; the pages do not say the same of connectors [R31]. | 10.13, rule 5 |
| P7 | A published image is built from the files on disk. Only `.replitignore` or an ignore list under `[deployment]` keeps a file out of it; `.gitignore` does not. | Publishing "saves a snapshot of your Replit App to the cloud", and "A snapshot captures the current state of the files in your Replit App" [R4]. No ignore list is described on the pages read. | 10.13, rule 3 |
| P8 | Replit Agent's own automation stages every file that git can see before a task merge or a checkpoint. | Checkpoints capture project files [R27]. | 10.13, rule 6 |
| P9 | A headless browser fits a Reserved VM, not Autoscale. Whether Nix packages such as Chromium exist at run time in a deployment is not stated in the documentation on the machine. | Nothing. | 10.8; check 6 in 13.1 |
| P10 | The workspace has no mail service for the product. | A mail service is added as a connector, which saves an API key as a secret of the project [R26]. | 11.11 |

### 10.13 Rules for the workspace and for what is published

Added on 2026-11-20. Rules 1 and 2 are rules of `../HANDOFF.md` section 8. The others follow from 10.11 and 10.12.

1. A development or production server serves the app's own build output and nothing else. Static files come from one build folder; there is no directory listing and no fallback to the workspace folder or the repository root. A static server started at the top of the workspace would publish every file there, including files that git ignores, such as puller output and local notes. Test: requests for `/.replit`, `/.git/config`, `/package.json`, `/puller/pull_sessions.py`, `/sessions/` and `/web/docs/web-platform.md` are answered with the application shell or with `404`, never with the file.
2. No real data in the workspace or in the development database: no real transcripts, no exports, no database dumps, no screenshots of real conversations. Use the fixtures. Real data enters through the published app only.
3. What is on disk can be published (P7). The puller writes private output into the workspace by design (by default into `sessions/` at the top of the repository), and a browser profile that holds a sign-in is a credential (`../../CLAUDE.md`). Before every publish, keep both out of the image with the platform's ignore list. As a tripwire, the server refuses to start in production when a folder `sessions/` lies at the top of its working tree.
4. Secrets live in the platform's secret store, never in `.replit`, in a file, in client code or in a URL. A variable with the prefix `VITE_` is compiled into the browser bundle (claude-api.md C1): no secret gets that prefix.
5. A service for other people does not run with anybody's personal credentials within reach (P6). Before the first publish the owner checks that no personal connector and no personal account secret is attached to the project that is published. The server starts the capture browser and every other child process with a minimal environment: no `DATABASE_URL`, no `USER_KEY_ENC_KEY_*`, no `SESSION_SECRET`, and no variable that the platform sets for its own identity.
6. Commits are made from the command line, with files added by name and the repository's no-reply identity set in the clone; the Git panel is not used (M9). Replit Agent is not used either (rule 7); if the owner ever starts it herself, everything is committed and pushed first (P8).
7. Replit Agent is never used, for anything (`../HANDOFF.md` section 2: the owner's rule since 2026-11-20, which replaces "for platform setup only"). A platform step that the Shell cannot do is a step for the owner in Replit's interface, and what only Replit Agent can set up is not available. Files that Replit keeps in the workspace for its Agent are not instructions for the builder.

## 11. Security baseline (C)

The service holds private transcripts and Claude API keys of many people and is reachable from the internet. The Apple app has no server and no sign-in (A14), so everything here is new.

Revised on 2026-11-20 for many users. 11.1 is superseded by 11.9 to 11.11. 11.2 to 11.8 are revised in place. 11.9 to 11.14 are new. "No user can see or change another user's data" is written as twelve testable rules, I1 to I12, in data-model.md 7.12; this section adds what sign-in, the HTTP layer and the hosting platform have to do. It contains no legal text: the privacy policy and the terms come from the owner (11.14).

### 11.1 Sign-in for one owner

Superseded on 2026-11-20 by 11.9 (accounts and sign-in), 11.10 (invitations) and 11.11 (e-mail). The design that stood here served one owner: one passphrase hash and an optional TOTP secret in production secrets, no accounts and no registration. Section 14 keeps it as an alternative. What carries over:

- No first-run setup page. A setup page that lets the first visitor claim the instance is a known failure. The owner's own account starts with an invitation like every other (11.10).
- The floor for password hashing, whichever library does it: Argon2id at or above the OWASP minimum (19 MiB memory, 2 iterations, parallelism 1) or scrypt with N=2^17, r=8, p=1 [W37]. Node has both built in: `crypto.argon2('argon2id', { message, nonce, parallelism: 1, tagLength: 32, memory: 19456, passes: 2 }, cb)` since Node 24.7.0, and `crypto.scrypt`, whose `maxmem` default of `32 * 1024 * 1024` must be raised because "It is an error when (approximately) `128 * N * r > maxmem`" (N=2^17, r=8 needs 128 MiB) [W40]. Compare with `crypto.timingSafeEqual`. Hashing costs memory: bound the number of verifications that run at the same time.
- Passkeys: a credential is bound to its relying-party id, which "needs to equal the origin's effective domain, or a domain suffix thereof" [W39], and `replit.app` is a public suffix (10.3), so passkeys are tied to the exact host name and break if it changes.

### 11.2 Session cookie

One kind of session for every user. The offline copy depends on it: sync authenticates with this cookie alone, and no token of any kind is kept in browser storage (sync.md 10).

- On successful sign-in or sign-up create 32 random bytes with `crypto.randomBytes`, send them base64url-encoded as the cookie value, and store only the SHA-256 of the value in a server-side row with `created_at`, `last_seen_at`, `expires_at` and a device label. OWASP: at least 64 bits of entropy from a CSPRNG, the id "must simply be an identifier on the client side", renew it "after any privilege level change" [W37]. A sign-in library that does the same is used as it is (11.9); this point stays the requirement.
- Cookie: `Set-Cookie: __Host-sv_session=<value>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`. A `__Host-` cookie must be `Secure`, must have `Path=/` and must not have `Domain`, which "guarantees that such cookies are only sent to the host that set them" [W38]. OWASP recommends `SameSite=Strict` or `Lax`, `HttpOnly`, and the `__Host-` prefix [W37].
- `SameSite=Strict` costs nothing here: the HTML shell is public and static, and every authenticated request is a same-origin `fetch` started by the app's own pages. That also holds for a person who arrives through an invitation link or a link in a mail: the navigation loads the public shell without the cookie, and the requests that the shell then makes are same-site.
- A new session at every sign-in and sign-up and after a password change. A password change, a password reset and "sign out everywhere" end every other session of that user.
- Lifetime: OWASP's examples (idle timeouts of minutes, absolute timeouts of hours) are for shared workplaces [W37]. For a personal vault on a person's own devices, with an offline copy that is meant to stay usable, this document proposes a sliding 30 days and an absolute 90 days, a visible list of signed-in browsers with "sign out everywhere", and a fresh sign-in check (the password again, within the last 10 minutes) before whole-vault export, account deletion and any change of password or e-mail address. A request that needs the check and lacks it gets `403 reauth_required`. The durations are the owner's call (section 17, decision 6).
- On every request the server takes the user id from the session row and from nowhere else: not from a path, a query string, a header or a body (data-model.md 7.7 rule 2; I2). It reads `users.status` with it: a `suspended` user may read and export but not write (`403 account_suspended`; claude-api.md C6 names the Claude routes that stay open); for a user in `deleting` the session counts as ended (data-model.md 7.7).
- `GET /api/auth/session` answers `200 {"user_id", "status", "expires_at", "reauth_at"}` for a signed-in browser and `401 not_signed_in` otherwise. A device compares `user_id` with the owner of its offline copy before it shows anything (sync.md 2.6, rule 4). The address for a "Signed in as" line comes from `GET /api/account`; it is read with a connection and never written to the device (design.md 4.15.4).
- Sign-out follows sync.md 2.6, rule 2. In short: send queued changes first, or ask; end the server-side session; expire the cookie; send `Clear-Site-Data: "cache", "storage"` (Chrome 61+, Firefox 63+, Safari 17+ [W8]); and delete the databases `sessionvault` and `sessionvault-inbox` from script as well, because the header alone is not relied on. Without a connection script cannot remove an `HttpOnly` cookie: delete the local data, remember that a sign-out is pending, and end the session with the first request that gets through.
- A request answered with `401 not_signed_in` means that the session ran out, was ended elsewhere, or the account was deleted. The device follows sync.md 2.6, rule 3.
- Behind Replit's proxy the Node process sees plain HTTP. With Express, set `trust proxy` so that `req.protocol` reflects `X-Forwarded-Proto`; prefer a hop count over `true`, because with `true` "the client's IP address is understood as the left-most entry in the `X-Forwarded-For` header", which a client can forge unless the proxy overwrites it [W41]. Unverified: the number of proxy hops on Replit.
- Tests over `http://localhost`: Safari does not send `Secure` cookies to `http://localhost` [W8], and prefix rules on plain HTTP are unverified. Make the cookie name and the `Secure` flag configurable for the test environment only.

Tables of the sign-in area. data-model.md 7.7 leaves e-mail addresses, credentials, sign-in sessions and invitation records to the sign-in library, in tables of its own that are linked to `users` through `users.auth_subject`. Give them the prefix `auth_` where the library allows it, so that the catalog test of I1 can exempt exactly `users` and the `auth_` tables; the key rules of I1 are for vault tables, not for these. The shapes below say what the app needs. They are created as written only where the library has no table of its own for the purpose.

```sql
-- One row per signed-in browser. The cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE auth_sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- made by the server; shown in the session list, used to end one session
    token_sha256  text NOT NULL UNIQUE,             -- 64 lower-case hex characters; never sent to the browser
    owner_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,             -- sliding; never later than created_at + the absolute limit
    reauth_at     timestamptz NOT NULL DEFAULT now(), -- last password check, for the fresh-check rule
    device_label  text NOT NULL DEFAULT ''          -- short text derived from the User-Agent, for the session list
);
CREATE INDEX auth_sessions_owner_idx ON auth_sessions (owner_id, last_seen_at);

-- Attempts, for the limits of 11.5. No password, no code, and no address in plain form.
CREATE TABLE auth_attempts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    kind         text NOT NULL,                     -- 'sign_in' | 'sign_up' | 'recover' | 'reauth' | 'reset' | 'verify' | 'mail' | 'key_check'
    client_key   text NOT NULL,                     -- keyed hash of the client address
    subject_key  text NOT NULL DEFAULT '',          -- keyed hash of the normalised e-mail address; '' when none was sent
    owner_id     uuid REFERENCES users (id) ON DELETE CASCADE,  -- the signed-in user, when there is one
    succeeded    boolean NOT NULL
);
CREATE INDEX auth_attempts_time_idx ON auth_attempts (occurred_at);

-- One row per invitation or recovery code that was used (11.10). The code itself is never stored.
CREATE TABLE auth_codes_used (
    code_sha256  text PRIMARY KEY,                  -- 64 lower-case hex characters
    used_at      timestamptz NOT NULL DEFAULT now(),
    used_by      uuid REFERENCES users (id) ON DELETE SET NULL  -- NULL once the account is deleted; the row stays
);
```

- The `users` row is inserted by the server-side sign-in hook when a person signs up with a valid invitation (data-model.md 7.7, rule 1). Nothing that a browser sends chooses its `id`.
- The keyed hashes are HMAC-SHA-256 with `SESSION_SECRET` as the key (13.5).
- A second factor, if one is added, is the sign-in library's business and gets no column in `users` (data-model.md 7.7).
- Delete expired `auth_sessions` rows and `auth_attempts` rows older than a day while handling sign-in requests; no scheduled job is needed.
- These tables are created like all others (10.5). Under the publish-managed model the library must not migrate on its own at start. Under any model it must not create, alter or migrate `users` (data-model.md 7.7).
- Account deletion removes a user's sessions and credentials. The `auth_codes_used` row stays without its user, or the code would work a second time (11.10, rule 9).

### 11.3 Cross-site request forgery

- State changes only through `POST`, `PUT`, `PATCH`, `DELETE`. "Do not use GET requests for state changing operations." [W37]
- For every state-changing request the server requires `Sec-Fetch-Site: same-origin` (Chrome 76+, Firefox 90+, Safari 16.4+ [W8]). If the header is absent it requires an `Origin` header equal to one of the app's own origins (from `REPLIT_DOMAINS` or a configured value). If neither check passes, reject. OWASP: "a fallback to standard origin verification headers is a mandatory requirement for any Fetch Metadata implementation", and when no header establishes the origin, "reject" [W37]. Require `same-origin`, not `same-site`.
- API requests carry JSON and a fixed custom header (proposed `X-Requested-With: sessionvault-web`); "requests with custom headers are automatically subject to the same-origin policy" [W37]. The server refuses a state-changing request under `/api/` that carries a body of any type other than `application/json`, and it sends no CORS headers at all.
- Sign-in, sign-up, recovery, the fresh sign-in check, password reset and sign-out get the same checks. For sign-in this also stops "login CSRF": a hostile page that signs the victim's browser into the attacker's account, so that the victim saves sessions into the attacker's vault (inference).
- `POST /api/sync/push` changes state and gets the checks; `GET /api/sync/changes` changes nothing (sync.md 10).
- The checks do not depend on who is signed in. A failed check answers `403` with the code `cross_site_request` and changes nothing.
- "Cross-Site Scripting (XSS) can defeat all CSRF mitigation techniques" [W37]; section 11.4 is the more important defence.

### 11.4 Content security policy and rendering untrusted text

Transcripts are untrusted input: they come from web pages, from model output and from imported files. Nothing that one user stores is ever shown to another user (`../HANDOFF.md` section 6), so a hostile transcript reaches a person only when that person imports or captures it. Script that ran in the origin could then read that person's whole offline copy and act with their session (sync.md 10). That is why the rules below are not relaxed for anything, a sign-in service included (11.9).

Response headers for the HTML shell (and, harmlessly, for everything else):

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Robots-Tag: noindex, nofollow
Strict-Transport-Security: max-age=31536000
```

Rules that keep this policy workable:

- No inline scripts and no `<style>` elements created at run time. Use static CSS files (CSS modules or a build-time utility framework); avoid CSS-in-JS libraries that inject style tags. Register the service worker from application code, not from an inline script. Check the production build with the policy enforced: violations are reported in the browser console.
- The build must not inline assets as `data:` URLs (in Vite set `build.assetsInlineLimit` to `0`), or `img-src` and `font-src` need `data:`.
- `connect-src 'self'`: the browser talks only to the vault's own origin. It never contacts `api.anthropic.com`: the server calls Claude with the signed-in user's stored key (decision 2).
- The Vite development server uses inline scripts and injected styles, so the policy cannot be enforced in development mode. Run the automated browser tests against the production build served by the Node server.
- Rendering: put transcript text into React text nodes. Never use `dangerouslySetInnerHTML` with it. If a Markdown library is used, raw HTML must stay disabled and link targets must be limited to `http:`, `https:` and `mailto:`. The Apple renderer supports only inline Markdown and fenced code blocks (`apple/SessionVault/Views/MessageView.swift:79-127,149-156`), which a small custom renderer without HTML can match; design.md and import-rules.md own the details.
- Do not load remote images that appear in transcripts. `img-src 'self'` blocks them; this also prevents an imported transcript from revealing when and from where it is read.
- Links out of the vault: `rel="noopener noreferrer"` and `target="_blank"`; apply rule B5 to `sourceURL`.
- Serve stored files (PDF originals, exports) only with a fixed, non-script content type and `nosniff` (section 6.5).
- `robots.txt` with `Disallow: /` in addition to the header.
- Caching: `Cache-Control: no-store` on every `/api/` response; `no-cache` on `index.html`, `sw.js` and the manifest; long-lived `immutable` caching only for content-hashed static assets.
- Inference: the service worker serves the precached shell with the response headers it had when it was cached, so a change to these headers reaches installed clients only with a build that changes `index.html`. Decide the headers before the first release.

### 11.5 Server-side requests, limits and abuse

Server-side requests:

- Server-side capture (section 8, route 5) opens a URL that a user chose. Use an allow-list of provider host names (defined in capture.md), accept only `https:`, and "disable the support for redirection in the web client", or re-check every redirect target against the list. OWASP: "Deny-lists are bypass-prone. Prefer allow-lists." Never allow loopback, RFC 1918, link-local or cloud metadata addresses such as `169.254.169.254` [W37]. capture.md 8.3 has the five rules and their tests. With many users, every one of them can make the server open a page: the limits below are part of the defence, and each provider stays switched off until its selectors are checked and the owner has agreed (`../HANDOFF.md` phase 3).
- The server opens a URL for nothing else (`../HANDOFF.md` section 8): not for a link in a transcript, not for an image, not for an icon.

Limits. The values are starting points proposed by this document, not measurements, and they are configuration (13.5). "Per user" means per `users.id` of the session. sync.md 10 leaves the limits of its two routes to this section.

| What | Per user | Per client address, nobody signed in | Whole service | State |
|---|---|---|---|---|
| Sign-in failures | 10 in 15 minutes per account, then a delay that doubles up to 15 minutes; never a permanent lock | 20 in 15 minutes | Every sign-in is slowed down after 200 failures in an hour | PostgreSQL |
| Sign-up and recovery attempts | | 5 an hour | 50 an hour; `MAX_USERS` accounts in total | PostgreSQL |
| Fresh sign-in check | 5 failures in 15 minutes, then the session ends | | | PostgreSQL |
| Mail for verification or reset (11.11) | 3 an hour per address | 5 an hour | 200 a day | PostgreSQL |
| Claude key saves and checks; model lookups | claude-api.md C9: 10 and 30 an hour | | claude-api.md C9: 120 key checks an hour | PostgreSQL; claude-api.md C9 asks this section for the limiter |
| Claude turns | claude-api.md C9: one per session at a time; turns in flight, attempts in 10 minutes and in a day, attempts per turn | | claude-api.md C9: 20 turns in flight, 60 attempts a minute | `claude_turns` |
| Link capture | capture.md 8.3: 1 at a time, 20 an hour, 100 a day | | capture.md 8.3a: 1 browser context per server process (`CAPTURE_MAX_CONCURRENT`); at most 5 waiting (`CAPTURE_MAX_QUEUED`) | `capture_jobs` (capture.md 8.3a) |
| `POST /api/sync/push` | 120 requests a minute; one `session.create` in flight | | At most 4 bodies above 1 MB being read per process | Memory |
| `GET /api/sync/changes`, transcript pages, lists | 240 requests a minute | | | Memory |
| Whole-vault export | 1 at a time; 10 an hour | | 2 exports streaming per process | Memory |
| `POST /api/import` (one session document per request, 13.4) | 1 in flight; 120 requests a minute, as `POST /api/sync/push`. No hourly cap: a vault file is one request per session, and the quotas of data-model.md 7.10 bound the total | | Counted with the bodies above 1 MB of the push row | Memory |
| Any `/api/` request without a session | | 60 a minute | | Memory |

1. A refused request answers `429` with a `Retry-After` header and a code (13.4). It changes nothing. On the Claude routes a limit for the whole service answers `503 server_busy` (claude-api.md C8).
2. Limits that guard money, mail or credentials are kept in PostgreSQL, so that a restart, scale-to-zero or a second machine does not reset them (10.8): one row per attempt, keyed by user and action, in `auth_attempts` (11.2) or in the library's own table. The others may live in the memory of one process; with more than one machine they multiply by the number of machines.
3. "Max machines" starts at 1. Raise it only after the limits kept in memory and the single capture slot have been made exact for several machines.
4. The client address comes from `X-Forwarded-For`, whose handling by the platform is unverified (11.2; check 12 in 13.1). Until that check is done, a limit per address may slow requests down but must not be the only thing that stops an attack, and must never lock out everybody behind one address. Store and log a keyed hash of the address, not the address (11.8).
5. A limit on failures per account lets a stranger delay a victim's sign-in. Hence delays and no locks, and the delay follows wrong passwords only.
6. A device polls once a minute (sync.md 2.5), so the read limits leave a wide margin. More than a few requests per second from one user is a fault or an attack (sync.md 10).

Storage quotas. data-model.md 7.10 defines them and their counters: `VAULT_MAX_STORED_BYTES` (1 GiB), `VAULT_MAX_SESSIONS` (10,000) and `VAULT_MAX_PROJECTS` (500) per user. A quota is checked before work starts. Over it, `quota_exceeded` is HTTP `413` on a route that creates one thing and a per-mutation code inside a push, and everything that adds no data keeps working. For the whole service: the production database is limited to 100 GiB on paid plans and to 1 GiB on Starter, and its storage is billed to the owner (10.5). `MAX_USERS` times the quota per user has to fit, or the owner overcommits knowingly (section 17, decision 7). The sum of `users.stored_bytes` belongs in the operator's figures (data-model.md section 12, decision 12).

Request size:

- Server frameworks ship with small default limits for JSON bodies, so a long transcript is rejected unless the limit is raised. Give the import routes an explicit, higher limit and send one session per request (13.4). Read the body of a request only after the session and the limits above have been checked, so that nobody without an account can make the server buffer 32 MB. Unverified: the platform's own request size limit (check 9 in section 13.1).
- Validate every imported document, including the interchange format, against a schema with size limits before storing it. The server trusts nothing that a device computed (sync.md 10).

Abuse handling is 11.13.

### 11.6 Encryption at rest

Always encrypted by the application, whatever is chosen for transcripts: each user's Claude API key. data-model.md 7.8 defines the stored form: AES-256-GCM; a wrapping key from the platform's secret store (`USER_KEY_ENC_KEY_V<n>`, the version in use in `USER_KEY_ENC_VERSION`); a random 12-byte nonce for every encryption; and the associated data `sessionvault:user-api-key:` followed by the `owner_id`, so that a row copied to another user does not decrypt. The key is typed once and sent once over HTTPS. It is never returned to a browser, never logged, never exported and never part of the offline copy, and the user can replace or remove it. The published app has no Anthropic key of its own (13.2, rule 23).

| Who | Can read a stored Claude key? |
|---|---|
| Someone who holds a database dump, a backup, the point-in-time history, a leaked connection string or the Agent read replica, but not the production secrets | No |
| Another user, through any route | No (I9) |
| Someone who can read the production secrets and the database: the owner's Replit account, a collaborator, Replit Agent working on the project (10.9) | Yes |
| Code that runs in the server process | Yes, while a request of that user is served |

For transcripts the choice is open:

| Option | Protects against | Does not protect against | Cost |
|---|---|---|---|
| 1. Platform encryption only (Replit lists "encryption of platform-stored data" as its responsibility [R18]) | Loss of storage media | Anyone with access to the database: the owner's Replit account, collaborators, Replit Agent's read replica, a leaked connection string, exports and backups | None |
| 2. Field encryption in the server: AES-256-GCM for message text and every other column that holds transcript text (including the text columns of the turn table in claude-api.md C5 and, if they are ever stored, attachment bytes), with a data key in production secrets that is handled like the wrapping key of data-model.md 7.8 (one secret per version; proposed `VAULT_DATA_KEY_V<n>`), a random 96-bit nonce per value, the owner id and the row id as associated data, and a key version column for rotation. Title, summary, tags and the `search_text` column of data-model.md stay in plain text so that its SQL search keeps working | Database browsing, the Agent read replica, exports, backups, point-in-time history, a leaked connection string, as far as the encrypted columns go | A compromised app server; whoever can read production secrets; titles, summaries and tags | No SQL search over message text: the optional transcript search of data-model.md 7.5 would have to decrypt and scan one user's messages in the application (the Apple app searches only title, summary and tags, `apple/SessionVault/Views/SessionListView.swift:27-34`). Losing the key loses every user's transcripts, so the key must be backed up outside Replit |
| 3. End-to-end encryption in the browser (key derived from a passphrase with Web Crypto; the server stores ciphertext) | Everything on the server side at rest | The server still sees plain text in memory for every Claude call (decision 2) | High: key entry on every device, no server-side capture or search, loss of passphrase loses the vault. Out of scope (`../HANDOFF.md` section 6) |

Decision for the owner, before sign-up is opened to strangers at the latest (section 17, decision 8): option 1 or option 2. With other people's transcripts in the database, option 2 is what keeps them unreadable in the database tool, for the Agent read replica, in exports and in backups; it costs transcript search in SQL and makes one key the single point of loss. Build option 1 until the owner answers, and read and write the text columns through one small codec module, so that option 2 can be added or rotated without touching the rest of the code; adding it later means rewriting every message row once. data-model.md 11.4 and sync.md 10 say what option 2 changes elsewhere. Option 3 is out of scope.

### 11.7 Backup and export

For each user:

- A whole-vault export in the versioned interchange format (data-model.md 6.8), produced by the server as a streamed download, behind the fresh sign-in check (11.2). It holds that user's rows only (I7), never the Claude key, and in the first release attachment descriptors without bytes. It is the copy that a person can take away, and the bridge to the Apple app (decision 4).
- Import of that file is idempotent, so that a repeated import does not duplicate sessions (data-model.md 6.7).
- Deleting the account is 11.12.

For the service (the owner's steps are in 13.3):

- Platform recovery (10.5) lives in the same account as the data: point-in-time recovery within 7 days (28 on Pro), and daily scheduled backups on Core and above once they are switched on. Switch them on.
- "Backups tested by a restore" is a condition of phase 6 (`../HANDOFF.md` section 7). A point-in-time restore replaces the live data [R10]: test it before real users exist, or in an announced maintenance window, and write the steps down.
- After any restore of the production database: change `SYNC_EPOCH`, because change sequence numbers may have been used twice (sync.md 3.5); delete again every account whose deletion happened after the restore point (11.12 keeps the list for that); and expect stored Claude keys and sign-in sessions to be those of the restore point.
- A copy outside the platform exists only if the owner makes one (`pg_dump` with the production connection string [R10]). Such a dump holds every user's transcripts. It never enters the workspace or the repository (10.13), and where it is kept is the owner's decision.
- Unverified: what happens to the production database when a Starter-plan app expires after 30 days. A durable service needs Core or above.

### 11.8 Logging hygiene

Never write to any log, error message, analytics event or URL: transcript text, titles, summaries, tags, project names, shared links or texts, request or response bodies, mutation payloads, query strings, cookies, `Authorization` headers, any user's Claude API key or its last four characters, a wrapping key, `DATABASE_URL`, passwords, invitation and recovery codes, verification and reset tokens, session tokens, e-mail addresses, client addresses in plain form, or payloads sent to or received from Anthropic. OWASP lists session identifiers, access tokens, passwords, database connection strings, encryption keys and sensitive personal data among data to exclude [W37].

Log instead: time, method, route template (for example `/api/sessions/:id`), status, duration, a request id, the user id, row ids, counts and byte sizes, mutation types and result codes (sync.md 10), and the error class and message of the app's own errors. Log sign-in successes and failures, rejected requests, suspensions and account deletions, by user id [W37]. `../HANDOFF.md` section 8 says it in one line: identifiers and sizes only. I12 in data-model.md 7.12 is the test.

Why it matters on this host: deployment logs are kept for 30 days and Replit Agent reads them on request (10.8). With many users they are logs about other people.

Typical leaks to remove:

- HTTP request loggers that print the full URL with its query string.
- `console.error(err)` where the error object carries user input or an upstream response.
- ORM or driver query logging that prints parameters.
- SDK debug logging (the Anthropic SDKs log requests when their debug environment variable is set); never enable it in production, and switch SDK logging and tracing off in code as claude-api.md C4 says, not only by leaving a variable unset.
- Error responses that echo input or stack traces to the client. Return a generic message and the request id.
- Third-party error trackers or analytics in the page. `connect-src 'self'` blocks them; do not add them.
- A route that receives a Claude key, a password or a code logs no body at all.

### 11.9 Accounts and sign-in for many users

New on 2026-11-20. `../HANDOFF.md` section 3 leaves the sign-in method open and takes its default from this section; never hand-written password storage. The owner's rule is that Replit Agent is never used (10.13, rule 7). This section says who can set up which option, and which one to build.

What the rest of the design needs from sign-in, whoever provides it:

| # | Requirement | Needed by |
|---|---|---|
| S1 | One stable id per person, stored once as `users.auth_subject`. | data-model.md 7.7 |
| S2 | A server-side session behind an `HttpOnly` cookie that script cannot read; no token in browser storage. | 11.2; sync.md 10 |
| S3 | The app shell and the offline copy open with no network and with no script from another origin. | Section 7; 11.4 |
| S4 | `GET /api/auth/session` returns the user id. | sync.md 2.6 |
| S5 | Sign-up only with an invitation, checked on the server. | 11.10 |
| S6 | The server can end one session, and all sessions of a user. | 11.2, 11.12, 11.13 |
| S7 | A fresh sign-in check. | 11.2 |
| S8 | Everything it holds about a person can be deleted. | data-model.md 7.11, step 4 |
| S9 | Its tables live in the app's PostgreSQL and are created by the same path as all others; it never creates, alters or migrates `users`. | 10.5; data-model.md 7.7 |
| S10 | Two users can be tested in the workspace, with synthetic accounts and no outside service. | 13.2, rule 19 |

Who can set up which option:

| # | Option | Who sets it up | Verdict |
|---|---|---|---|
| 1 | Sign-in built into the app with a maintained sign-in library: e-mail address and password, with sessions and credentials in the app's own PostgreSQL. In design.md 4.15.2 this is the block "Password or passkey through a maintained library" | Claude Code in the Shell, alone. No Replit Agent, no platform tool, no outside account. | The default to build, for as long as no mail provider is configured. |
| 2 | Option 1 with mail switched on: verification, password reset, notices (11.11) | The code: Claude Code in the Shell, alone. Steps for the owner: an account with a mail provider for this product, a sender domain with its DNS records, and the API key as a production secret. | As soon as the owner has taken those steps; required before sign-up is opened to strangers (11.14). |
| 3 | Sign-in built into the app, with a one-time code that is mailed and typed, and no password. In design.md 4.15.2 this is the block "E-mail with a typed code" | The code: Claude Code in the Shell, alone. It can sign nobody in until the owner has taken the steps of option 2. | The owner's choice once mail exists (section 17, decision 1). No password is stored, the address is verified by construction, and recovery is built in; in exchange every sign-in depends on a mail arriving. The code is typed and not followed as a link, because an installed app on iOS does not receive links (4.1). |
| 4 | Option 1 plus sign-in through an outside identity provider (OpenID Connect) | The code: Claude Code in the Shell. Steps for the owner: register a client for the final address at that provider; two production secrets. | A possible later addition. The redirect inside an installed app is untested. |
| 5 | The owner's own account at a hosted sign-in service (the documentation names an own Clerk account [R29]) | The code: Claude Code in the Shell. Steps for the owner: the account, its keys as production secrets, its domain settings. | Not recommended; see the next table. |
| 6 | Clerk Auth managed by Replit | Replit Agent only: it creates the tenant, stores the keys, configures a proxy and adds components, routes and middleware to the app [R29]. Later settings in the Users & Auth tool, some only in the Clerk dashboard on Pro and Enterprise. | Not available: the owner does not use Replit Agent (10.13, rule 7). |
| 7 | Replit Auth | Replit Agent only: "The only way to implement Replit Auth is by using Agent"; "Manual implementation is not supported" [R14]. | Not available: the owner does not use Replit Agent. It would not fit either: every user would need a Replit account. |
| 8 | Replit's access gate (10.6) | The Publishing tool only; no code [R2]. | Not a sign-in: it knows no users of the app. Publish as "Public". |

Stated plainly: options 1 to 5 are built by Claude Code in the Shell. Option 1 needs nothing else. Options 2 to 5 also need steps that only the owner can take: a mail provider, an outside identity provider or a hosted service. Options 6 and 7 can be set up only by Replit Agent and are therefore not available. Option 8 needs only the platform's interface, and it is not a sign-in.

For as long as no mail provider is configured, build option 1; design.md 4.15.2 has both blocks and marks the first as the default. Reason: Reported: the workspace has no mail service for the product (10.12, P10); mail needs an account, a sender domain and DNS records that only the owner can supply; and until they exist option 3 would let nobody sign in on the published app, the owner included. Option 1 works with the database alone.

Why option 1 and not a hosted service (options 5 and 6):

| Topic | Option 1 | A hosted service |
|---|---|---|
| The owner's rule: Replit Agent is never used | Met | Option 6 breaks it, so it is not available; option 5 meets it |
| S2 and S3: an `HttpOnly` session, nothing from another origin, opens offline | Met by construction | Not stated on the pages read: which cookies the service sets, which scripts and styles its components load, and whether they start without a network (items 36 and 37 in section 15). Inference: a service that draws its own components in the page needs entries in `script-src`, `style-src` and `connect-src` that 11.4 does not have. |
| S5: invitations | Built here (11.10) | Not stated for the Replit-managed tenant |
| S8: one place for a person's records | The app's own database | A second system that holds every e-mail address, and a sub-processor for the owner's privacy text to name [R18] |
| S10: testable in the workspace | Yes, against the development database | Development and production have separate user stores [R29] |
| Verification mail without a step for the owner | No: it needs a mail key (11.11) | Yes on a `.replit.app` name [R29] |
| Defence against automated sign-up and password guessing; a second factor | Built here: 11.5, and a second factor before strangers (11.14) | Part of the service |

The last two rows are the price of option 1. The builder pays it with the limits of 11.5 and by using a library, not by writing credential handling by hand.

The default to build in phase 2, until the owner decides otherwise:

1. A maintained sign-in library provides password hashing, credential storage and sessions. No password hashing, token comparison or session handling is written by hand where the library offers it (`../HANDOFF.md` section 3).
2. A person is identified by an e-mail address, normalised by trimming and lower-casing, and proves it with a password of at least 12 characters and at most 1,024 bytes, hashed by the library at or above the floor of 11.1.
3. Sign-up needs an invitation (11.10). There is no open registration route and no first-run page.
4. The session is the cookie of 11.2.
5. No mail is sent until a mail provider is configured (11.11). Until then the address is a sign-in name that the invitation vouches for; it is marked as unverified; and a forgotten password is recovered through the owner with a recovery code (11.10, rule 8). The sign-in page says so.
6. Failure messages do not tell whether an address has an account: sign-in answers `invalid_credentials` for an unknown address and for a wrong password alike.

Choosing the library is the builder's first task of phase 2. No library documentation was read for this revision (network access was limited to docs.replit.com), so none is named here. Record the choice and these checks in the commit that adds it:

| Check | Passes when |
|---|---|
| Maintained | A release within the last six months; security fixes are announced; the licence permits this use |
| S1 to S10 | Each is met, or the gap is closed by a small module of the app that the commit names |
| Hashing | scrypt or Argon2id with parameters at or above 11.1, and re-hashing at sign-in when the parameters are raised |
| Cookie | Name, `Secure`, `HttpOnly`, `SameSite` and `Path` can be set as in 11.2; if the `__Host-` prefix is not possible, the cookie still has no `Domain` |
| Schema | Its tables can be created from SQL that the builder has read; it does not migrate on its own at start under the publish-managed model (10.5) |
| Quiet | No request to any other host at run time; no telemetry |
| Policy | Its client code, if it has any, runs under the policy of 11.4 without changes |

If no maintained library passes, stop and ask the owner (section 17, decision 1). Do not fall back to hand-written password storage.

### 11.10 Sign-up by invitation

New on 2026-11-20. `../HANDOFF.md` section 3: invitation only until the owner opens sign-up, and the app must be safe for strangers before that switch is flipped (11.14).

1. `SIGNUP_MODE` is `invite` (the default), `closed` or `open`. `closed` refuses every sign-up with `signup_closed`. `open` is set by the owner, and only after 11.14.
2. An invitation is a random code of at least 128 bits. A script in the repository makes it and prints it once, together with its SHA-256. The server only ever sees hashes. A code works once and has a last day.
3. First release: the valid hashes are configuration. The production secret `INVITE_CODE_HASHES` holds entries of the form `<sha256>:<last day as YYYY-MM-DD>`, separated by commas. The owner adds an entry and publishes again. There is no operator screen and no route that creates invitations, so the app holds nothing that a stolen session could use to invite people or to take over accounts. The owner's own account starts with an invitation like every other.
4. That a code was used is recorded in the database, in the transaction that creates the account (`auth_codes_used`, 11.2), so that it cannot be used twice: not on another machine and not after a restart.
5. The code travels in the fragment of a link, `https://vault.example/invite#code=<code>` (the screen is design.md 4.15.3). The page reads the fragment and removes it from the address bar with `history.replaceState`. A fragment is not sent to the server, so the code reaches no log and no traffic statistic (10.9). Never put a code in a path or a query string, and never store it in the browser. This is the one deliberate exception to "nothing secret in a URL" (`../HANDOFF.md` section 8): a single-use code in a fragment.
6. Two requests carry the code, both in the body. `POST /api/auth/invitation/check` only says whether the code is valid; it uses nothing up. The sign-up request then carries the e-mail address, the password and the same code, which the page has kept in memory and nowhere else: this is how an accepted invitation is carried into sign-up. The server checks the limits of 11.5 first, then the code again, then the rest. An unknown, used or expired code answers `invitation_invalid` in both requests and says nothing about any address. With a valid code, an address that already has an account answers `email_taken` and leaves the code unused.
7. On success, in one transaction: the sign-in records, the `users` row (data-model.md 7.7, rule 1), the mark that the code was used, and the check against `MAX_USERS`. Then a new session (11.2).
8. Recovery while no mail is configured (11.9, default 5). The owner issues a recovery code for one account, as an entry `<user id>:<sha256>:<last day>` in the production secret `RECOVERY_CODE_HASHES`. The person opens `https://vault.example/recover#code=<code>` (the screen is in design.md 4.15.2) and gives the account's e-mail address and a new password. The account is the one named in the entry: an address that is not that account's address is refused exactly like an unknown code, with `recovery_invalid`, and uses nothing up. Otherwise the server sets the password, ends every session of that user and records the code as used. The owner finds the user id through the person's address in the production database tool; the settings screen shows it too, for a person who is still signed in on some device. Once mail is configured, recovery goes through 11.11 and this secret is emptied.
9. Deleting an account does not make its invitation valid again: the mark that the code was used stays, without the user (11.2).
10. Before strangers (11.14) this mechanism is replaced or extended: invitations bound to an address and sent by mail, or open sign-up with verification. Neither is part of the first release.

Tests: a code works once; a used, an unknown, an expired and a malformed code get the same answer; two sign-ups with one code at the same moment create one account; sign-up without a code is refused in `invite` mode, and every sign-up in `closed` mode; no response, log line or URL of the run contains a code. A recovery code issued for one account and used with another account's address changes neither account; a used and an expired recovery code are refused; after an account is deleted, the invitation code it used is still refused.

### 11.11 E-mail: verification, reset and notices

New on 2026-11-20. These rules hold whenever the app sends mail or relies on an e-mail address.

1. Product mail goes through an account with a mail provider that the owner opens for this product, with a sender address of the product. Its API key is a production secret (proposed `MAIL_API_KEY`, with `MAIL_FROM` as configuration). Without the key the app sends nothing, and everything in this section is switched off. Never send through a connector or an account that is somebody's personal mailbox (10.12, P6 and P10).
2. Verification. An address counts as verified only after its holder has used a single-use link or code that was sent to it. With mail configured, a sign-up is complete only then: the account becomes usable at verification and not before. Accounts made before mail was configured are asked to verify at their next sign-in.
3. Nothing but the verification mail itself is sent to an unverified address, and no reset mail is sent to an address that has no account.
4. Tokens: at least 128 random bits, single use, stored only as a hash, bound to one purpose and one address. Proposed lifetimes: 24 hours for a verification, 1 hour for a reset.
5. A link carries its token in the fragment, as in 11.10 rule 5. Opening the link only shows a page; the token is used by the `POST` that the page sends when the person presses a button. Inference: a program that fetches the links of a mail in order to scan them then uses nothing up.
6. Reset: the request gets the same answer whether or not the address has an account. A completed reset sets the password, ends every session of that user and sends a notice. It signs no other device in.
7. Changing the address: verify the new address before it replaces the old one, and send a notice to the old one.
8. Notices that the app should be able to send once mail exists: sign-in from a new browser, password changed, address changed, Claude key replaced or removed, account deleted. They hold no transcript text, no title and no key, and they link only to the canonical origin.
9. The limits of 11.5 apply before any mail is sent. They also protect the standing of the sender address.
10. The mail provider receives every user's address. It is a sub-processor that the owner's privacy text names (10.9). The sender domain needs DNS records that only the owner can add; the provider's documentation lists them (not read for this document).
11. In tests the mailer is a fake that keeps messages in memory. No test sends mail.

### 11.12 Account deletion and export

New on 2026-11-20. `../HANDOFF.md` section 8: deleting means deleting. data-model.md 7.11 owns what is removed and in which order; this section owns the route and the platform side.

1. `DELETE /api/account`, after a fresh sign-in check (11.2) and with a typed confirmation in the body. The screen offers the whole-vault export first (11.7).
2. The request does step 1 of data-model.md 7.11 at once: it sets `users.status` to `deleting` and ends every session of the user. It answers when that is done. The device then removes its copy (sync.md 2.6, rule 5).
3. The remaining steps can outlast one request for a large vault. Run them in the same request as far as the deadline of 13.4 allows, and finish them with a sweep that looks for rows in `deleting` at server start and at most once a minute while requests are being served. Do not rely on a timer that fires between requests on Autoscale (check 3 in 13.1). Every step can be repeated.
4. Log one line per deletion: the user id and the time, nothing else. After a restore of the database, the accounts deleted after the restore point are deleted again from that list (11.7). The line ages out with the logs (10.8).
5. What deletion cannot reach is listed in data-model.md 7.11: copies in the platform's history and backups until they age out (7 days by default, up to 28 on Pro; 10.5), the key itself at Anthropic, files that the user exported, and offline copies on devices that never come back. The app says so where the account is deleted, and tells the user to revoke the key in the Claude Console.
6. The owner deletes an account in the same way, by user id (11.13).
7. A suspended user can still export and delete (data-model.md 7.7).

Tests: those of data-model.md 7.11, run through this route. In addition: the route refuses without the fresh check; a second user is unchanged (I11); after the deletion the old cookie gets `401`, and the same address can be invited again.

### 11.13 Abuse handling

New on 2026-11-20. The design removes most ways to harm another user: nothing is shared between users, and nothing that one user stores is shown to another (`../HANDOFF.md` section 6). What remains is abuse of the service itself.

| Abuse | Defence |
|---|---|
| Guessing passwords, trying leaked ones | The limits of 11.5; delays per account; notices (11.11); a second factor before strangers (11.14) |
| Mass sign-up | Invitations (11.10); `MAX_USERS`; the sign-up limits |
| Filling the database | Quotas per user (data-model.md 7.10); the ceiling of 11.5 |
| Making the server fetch pages | Allow-list, public share links only, capture limits per user and for the service, one switch per provider and one for all capture (capture.md 8.3) |
| Spending somebody's Claude budget with a stolen session | Turn limits per user (claude-api.md C9); the key is never shown, so it cannot be carried off; the user's own spend limit in the Claude Console |
| Reaching another user's data | The isolation rules I1 to I12 and their tests |
| Content that the service must not hold | The owner cannot see transcripts in the app and gets no screen for it. A report leads to suspension or deletion by user id. What has to be removed, and when, is a matter for the owner's terms. |

What the owner can do in the first release, and how:

| Action | How | Effect |
|---|---|---|
| Suspend a user | Set `users.status` to `suspended` for that id in the production SQL console, with editing switched on [R8] | The user can sign in, read and export. Every write, capture and Claude request gets `403 account_suspended` (data-model.md 7.7) |
| End a user's sessions | Delete that user's session rows in the same console | Every device of the user gets `401` on its next request |
| Delete an account | 11.12, by user id | |
| Stop sign-up | `SIGNUP_MODE=closed`, publish | |
| Stop capture | `CAPTURE_ENABLED` off, or a provider taken out of `CAPTURE_PROVIDERS`, publish (capture.md 8.3) | |
| Stop writes for everyone | `VAULT_READ_ONLY=1`, publish | Every state-changing vault route answers `503 read_only` with `Retry-After`; reading, export and sign-out keep working. Devices keep their queued changes and try again (sync.md 6.8). For an incident or a restore (11.7) |
| End every session of every user | Empty the session table | For a leaked database or session secret |
| Replace the wrapping key | data-model.md 7.8, "Rotate the wrapping key" | For leaked production secrets; users are told to revoke their Claude keys |

- The server reads `users.status` on every request (11.2), so a change made in the console applies at once.
- An operator screen is not part of the first release. Every action above goes through the platform's tools, by user id. data-model.md section 12, decision 12 proposes a script that lists user id, status, session count and stored bytes, and nothing else.
- A published address for reports about security and abuse is a condition of 11.14. The owner supplies it.
- An incident that concerns users' data is the owner's to lead [R18]. Telling users needs verified addresses (11.11).

### 11.14 Before sign-up is opened to strangers

New on 2026-11-20. This is phase 6 of `../HANDOFF.md`. `SIGNUP_MODE=open`, or invitations to people whom the owner does not know, only when every row holds. Each row says how it is shown; "published" means on the published app, not in the workspace.

| # | Must be true | Shown by |
|---|---|---|
| G1 | The isolation rules I1 to I12 hold for every route, including every route added since phase 2. | The isolation tests of data-model.md 7.12 pass, and a list of routes generated from the server matches the list that the tests cover. |
| G2 | The baseline of 11.2 to 11.4 and 11.8 to 11.10 is in place, published. | One check per item: the cookie's attributes; a cross-site `POST` is refused; the policy header is present and the production build runs under it without a violation; no CORS headers; `no-store` on API answers; the captured log of a test run holds none of the strings of I12; the library checks of 11.9; the tests of 11.10. |
| G3 | Every limit of 11.5 is enforced. | One test per row of the table that reaches the limit and gets `429`. |
| G4 | Quotas are decided and enforced, and `MAX_USERS` times the quota fits the database plan. | The tests of data-model.md 7.10; the owner's numbers (section 17, decision 7). |
| G5 | Mail works: verification, reset, notices (11.11). | Tests with the fake mailer; one real mail to the owner, published. |
| G6 | Recovery does not depend on the owner (`RECOVERY_CODE_HASHES` is empty), and a user can add a second factor: a passkey or a one-time code. The owner may waive the second factor (section 17, decision 5). | Tests. |
| G7 | Account deletion and export work end to end, also with a restart in the middle. | The tests of data-model.md 7.11 through 11.12; once published, with a synthetic account. |
| G8 | Scheduled backups are on, and one restore has been done and written down. | 11.7; the owner. |
| G9 | Abuse handling works: suspend, end sessions, delete by user id, and each switch of 11.13. | Each action tried once, published, on a synthetic account. |
| G10 | The owner can see usage per user without seeing content. | The figures of data-model.md section 12, decision 12. |
| G11 | The question of transcript encryption is answered (11.6). | Section 17, decision 8. |
| G12 | Platform settings: the final address is in place; the app is published as "Public"; analytics, feedback widget and automatic fixes are off; the region was chosen knowingly; the project has no collaborators; no personal connector or account secret is attached; no Anthropic credential is in the environment; the production secrets are complete (13.3, 13.5). | The owner's checklist of 13.3, gone through again. |
| G13 | Dependencies have no known issue of high severity, and the code for sign-in and for key handling has been reviewed by someone other than its author. Security testing of the app is the owner's side of the platform's split of responsibilities [R18]. | Audit output; a review note in the repository. |
| G14 | A privacy policy and terms exist and are linked from the sign-up page and the settings, and a contact for reports about security and abuse is published. | Supplied by the owner. The builder does not write them; ask. |
| G15 | For every capture provider that is switched on: its selectors were checked on one real public page, and the owner has agreed (`../HANDOFF.md` phase 3). | capture.md. |

Facts that the owner's privacy text has to cover. This list is input for the owner, not wording:

1. What is stored per user: sessions and transcripts, projects and tags, an e-mail address and a password hash, an encrypted Claude API key, storage counters, sign-in sessions with a device label, and logs with ids and sizes.
2. Where: in the hosting platform's database and deployment, in the region chosen at the first publish (10.9).
3. Who else processes it: the hosting platform and its database provider (10.5); the mail provider (11.11); Anthropic, when a user uses Continue or Summarize, with that user's own key (claude-api.md); and the site behind a public share link, which receives a request from the server when a user captures the link (capture.md).
4. Who can technically reach it: the owner, through the platform's tools; an agent of the platform, if the owner asks it to (10.9); the platform itself, under its own terms, which were not read for this document; no other user and no other party by the design of the app.
5. How long: until the user deletes it; copies in the platform's history and backups for up to 7 or 28 days after that (10.5); logs for 30 days (10.8).
6. What is on a user's devices: an offline copy in the browser, removed at sign-out (sync.md 2.6).
7. What the service does not do: it shows no user's data to another user, and it runs no analytics and no third-party script in the page (11.4).

## 12. Constraints table

"Yes" means supported in current versions; numbers are the first supporting version.

| Feature | Android (Chrome) | iOS and iPadOS (Safari) | Desktop (Chrome, Edge) | Notes |
|---|---|---|---|---|
| Use in a browser tab | Yes | Yes | Yes | Also Firefox and Safari on desktop |
| Install | Yes: WebAPK from Chrome on GMS devices and from Samsung Internet; other browsers add a shortcut | Yes, manually: Share, Add to Home Screen; any browser since iOS 16.4; from iOS 26 every added site opens as a web app | Yes: install icon. Safari 17+: Add to Dock. Firefox: no | [W2][W12][W15][W16] |
| Install prompt from the page (`beforeinstallprompt`) | Yes | No | Yes; not Safari, not Firefox | [W2][W8] |
| Installed app shares cookies and storage with the browser | Yes | No, isolated per install | Safari: cookies copied once at Add to Dock, other storage separate. Chromium: unverified | [W10][W12][W15] |
| Links to the vault open in the installed app | Yes (WebAPK, within scope) | No | Experimental | [W13] |
| Receive shared links and text | Yes, Chrome 76+, Samsung Internet 12+, installed only | No | Windows and ChromeOS, Chrome and Edge 89+; macOS and Linux unverified | [W5][W6][W8][W9] |
| Receive shared files | Yes | No | As the row above | [W4][W5] |
| Share out (`navigator.share`) | Yes, 61+; files 76+ | Yes, 12.2+; files 14+ | Chrome 128+ (89 to 127 Windows and ChromeOS only), Edge 93+; Safari 12.1+; Firefox no | User gesture, HTTPS [W7][W8] |
| Read clipboard from a button (`readText`) | Yes, permission prompt | Yes, user must tap a "Paste" callout | Chrome and Edge: permission prompt. Firefox 125+, Safari: paste prompt | [W8][W23][W24] |
| Paste into a field (`paste` event) | Yes | Yes | Yes | No prompt [W8] |
| Copy (`writeText`) | Yes, in a user gesture | Yes, in a user gesture | Yes, in a user gesture | [W8][W23] |
| File picker, multiple files | Yes | Yes | Yes | `accept` on phones unverified |
| Drag and drop of files | Not practical (inference) | Not practical on iPhone (inference) | Yes | [W8] |
| File System Access pickers | Chrome 132+ | No | Chrome and Edge 86+; not Firefox, not Safari | Experimental; do not depend on it [W8][W25] |
| Open files with the installed app (`file_handlers`) | No | No | Chrome and Edge 102+ | [W8] |
| Download a file | Yes | Yes; inside a Home Screen app unverified | Yes | [W8] |
| Service worker and Cache Storage | Yes | Yes | Yes | [W8][W22] |
| IndexedDB quota per origin | Up to 60% of disk | About 60% of disk (Safari 17+) | Chromium 60%; Firefox min(10% of disk, 10 GiB) | [W17][W18] |
| Eviction | Least recently used origin under storage pressure | Same, plus 7 days without interaction in the browser; installed apps exempt | As Android; Safari as iOS | [W18][W19] |
| `navigator.storage.persist()` | Decided silently | Decided silently (15.2+), favours Home Screen apps | Chromium silent; Firefox asks | [W17][W18][W20] |
| Background Sync | Yes | No | Chromium yes; Firefox and Safari no | [W8] |
| Streaming with `fetch` and `getReader()` | Yes | Yes | Yes | [W8] |
| `for await` over `response.body` | Chrome 124+ | Safari 27+ only | Chrome and Edge 124+, Firefox 110+, Safari 27+ | Do not use [W8] |
| `EventSource` | Yes | Yes | Yes | `GET` only, reconnects by itself [W30][W31] |
| Read another site's page from the vault page | No | No | No | Same-origin policy [W26][W27] |
| Capture by browser extension | Firefox only; Chrome unverified | Unverified (needs a native wrapper) | Chrome, Edge, Firefox | Separate project [W29] |
| Passkeys (WebAuthn) | Yes, 70+ | Yes, 13+ | Yes | Bound to the host name [W8][W39] |
| `Sec-Fetch-Site` request header | 76+ | 16.4+ | Chrome 76+, Firefox 90+, Safari 16.4+ | Fall back to `Origin` [W8] |

## 13. Recommendations for the builder

### 13.1 Checks to run before building on an assumption

Each check is small, uses synthetic data, and decides a design question that the documentation leaves open. Record the results in the repository. Checks 1 to 9 keep their numbers; 10 to 17 were added on 2026-11-20. With many users, an endpoint that exists only for a check is open to test accounts named in configuration and to nobody else, and it is removed when the check is done (13.2, rule 20).

| # | Question | How to check | If the answer is bad |
|---|---|---|---|
| 1 | Does the published proxy pass a stream through unbuffered? | A signed-in-only endpoint that writes one frame per second for 30 seconds; watch arrival times in the browser on the published address | Try without compression and with `X-Accel-Buffering: no`; if still buffered, fall back to polling a stored turn |
| 2 | How long may one request last? | The same endpoint for 10 minutes with 15-second heartbeats | Rely on the stored-turn recovery in 9.4 and 9.5; keep answers shorter or resumable |
| 3 | Does server work continue after the client disconnects on Autoscale? | Start a 2-minute timer job that writes a row at the end; close the tab after 5 seconds; look for the row | Use "interrupted, retry", or ask the owner about a Reserved VM |
| 4 | Does the publish diff keep the schema features in use (partial unique indexes, GIN and operator-class indexes, `CHECK` constraints, index sort order, any extension)? | Read the SQL shown at the first publish and compare it with the development schema | Replace the feature with application code (for the partial unique index, claude-api.md C5 names the fallback) |
| 5 | Does the app install and receive a share on an Android phone at the published address? | Owner test: install from Chrome, share a link from another app, share a text file | Fix the manifest or the service worker; remember that manifest changes arrive late (4.1) |
| 6 | Does headless Chromium start in a deployment? In the workspace it does (Measured, 10.11: only with the folder of `libatomic.so.1` on `LD_LIBRARY_PATH`, and with the browser that Nix provides). | In the published app, behind an endpoint that only a signed-in test account can call: launch, open `about:blank`, close; log the browser version and nothing else | Run capture in a deployment of its own (Reported: a Reserved VM), or ship without server-side capture; the interface stays the same (10.8) |
| 7 | Which sharing options and which production secrets does the owner's plan actually show? | Owner looks at the Publishing tool | Follow 11.9, option 1, regardless, and publish as "Public" |
| 8 | Does TLS verification to the production database succeed with `ssl: true`? | Connect once from the published app and log only success or the error class | Use the documented `rejectUnauthorized: false` |
| 9 | How large may one request body and one response be through the published proxy? | Upload and download synthetic bodies of 1, 10 and 40 MB through a signed-in-only endpoint | Split uploads (one session or one attachment per request, large attachments in parts) and stream downloads |
| 10 | Which role does `DATABASE_URL` name in each database, and do row-level security policies restrict it? | The two queries and the test of data-model.md 7.13, in the workspace and after the first publish | Leave row-level security out, which is the default (10.5) |
| 11 | Which model for schema changes is in force: publish-managed or app-owned (10.12, P3)? | The owner, in Replit's interface, before any table exists in the database that `DATABASE_URL` names (13.3, step 7) | Until the owner has answered, tables exist only in a scratch database (13.3, step 7). If the platform does not confirm the app-owned model: the documented publish-managed model of 10.5 |
| 12 | Does the published proxy hand the app a client address that it can trust, and through how many hops? | A signed-in-only endpoint that returns the `X-Forwarded-For` header it received; call it from two networks, and once with a forged header | Limits per address only slow down and never block (11.5) |
| 13 | Is a personal credential within reach of the published app: a connector, a linked account secret, an Anthropic variable? | The owner reads the project's Connectors and Secrets views. At start the server logs the names, never the values, of environment variables that match a deny list | Detach, unlink, or publish from a project without them (10.13) |
| 14 | Does the chosen sign-in library pass the checks of 11.9 under the policy of 11.4? | Browser tests against the production build | Choose another library, or ask the owner |
| 15 | Does a download from a `Blob` work under the policy of 11.4 in the browsers that matter, also offline and inside an installed app? | Browser test; the owner on a phone | Serve the context pack from a server route when there is a connection, and offer Copy without one |
| 16 | Are the facilities of 7.4 present in the browsers that matter? | Feature tests in the browser suite; phones (the owner's check) | The fallbacks of 7.4 |
| 17 | What ends up in the published image? | Once at start in production, the server logs the names and sizes of the top-level entries of its working tree | Fix the ignore list (10.13, rule 3) |

### 13.2 Build rules

Rules 1 to 20 keep their numbers; 21 to 28 were added on 2026-11-20.

Hosting and process:

1. One Node process on one port (`Number(process.env.PORT) || 5000`, address `0.0.0.0`) serves the API and the built single-page app. In development, mount the Vite development server as middleware in the same process (`server.middlewareMode` [W43]) so that API, cookies and origin are identical to production.
2. Vite refuses requests for unknown host names; add the development host suffix to `server.allowedHosts` (a leading dot allows subdomains, for example `.replit.dev`) rather than setting it to `true` [W43].
3. `GET /` serves the static shell and never waits for the database (5-second health check). A `GET` or `HEAD` for any other path that is outside `/api/` and whose last segment has no file extension also returns the shell, so that deep links such as `/import` work without the service worker. Every other path that does not exist answers `404`: a missing file with an extension gets no HTML, and an unknown `/api/` path gets the JSON error of 13.4, never the shell. The shell and every static file are public and the same for every user: nothing about a user is rendered into them.
4. Nothing is written to the local filesystem at run time. Data goes to Postgres. The first release uses no App Storage (10.7).
5. Schema changes are applied to the development database only and reach production through Publish; no triggers, functions or start-up migrations (10.5). The one exception would be the app-owned model, if the platform confirms it and the owner chooses it (10.12, P3; section 17, decision 3).
6. Database SSL on when `REPLIT_DEPLOYMENT === "1"`, off otherwise.
7. Set `disableGuessImports = true` at the top level of `.replit`; commit the lock file; do not work around Package Firewall blocks. Reported from the schema file for `.replit` on the machine: `disableGuessImports` is the opt-out of guessing dependencies during package installation, while `[packager.features] guessImports` only says whether the packager supports the guess command for a language.
8. Use Node 22 or newer if Playwright is used [W46]; the Anthropic TypeScript SDK needs Node 20 or newer [W36]. Reported: the workspace offers Node 24, 22 and 20, and phase 0 was built there with Node 24 (10.12, P1).

Page and service worker:

9. Manifest, icons and head tags as in 4.3. Hand-written service worker with the `injectManifest` strategy [W44]; it precaches the shell, handles `POST /share-target`, and leaves `/api/` alone. The only database it opens is `sessionvault-inbox` (sync.md 9).
10. Import screen with three inputs that work everywhere: paste field, file picker, and (desktop) window-wide drop. The clipboard button and the share target are enhancements on top.
11. All stream reading through `getReader()`; one terminal event; idempotent sends (section 9).
12. Offline: the shell comes from the service worker; the copy of the vault and the queue of changes are built as sync.md specifies (section 7).
13. Feature-detect every optional API (`navigator.share`, `navigator.clipboard`, `beforeinstallprompt`, `navigator.storage`, `navigator.locks`, `BroadcastChannel`) and keep a path that works without it (7.4).

Security:

14. Sign-in, cookie, cross-site checks, headers and rendering rules exactly as in section 11. No open registration route and no first-run page: sign-up needs an invitation (11.10).
15. No private data in URLs or logs (10.9, 11.8). Opaque ids in paths.
16. The workspace never holds real transcripts, and neither does the development database. No real exports or database dumps either. Tests and fixtures are synthetic (10.13, rule 2).
17. Redirect every non-canonical host name to the canonical origin once the owner has chosen it.

Testing:

18. Parser unit tests run in Node against golden files (import-rules.md).
19. Browser tests run against the production build with the CSP enforced: sign-up with an invitation, sign-in, import by paste and by file, a simulated share (`multipart/form-data` post to `/share-target`), a stream that ends normally, a stream cut by the server in mid-answer, a duplicate send with the same `clientTurnId`, two users in two browser contexts who never see each other's data, and the offline checks of sync.md 12.3. They address the server at `http://localhost:<port>` inside the workspace; the development URL requires a Replit sign-in (10.3). Measured: a headless Chromium starts in the workspace with the library path of 10.11; use one browser build for one profile (10.8). If it stops starting, run the same tests in a continuous-integration job on Ubuntu, which Playwright supports [W46], with synthetic data and test-only credentials.
20. The Apple launch arguments (A15) have no web equivalent in production. Any test-only route must be disabled when `REPLIT_DEPLOYMENT === "1"`.

Added on 2026-11-20:

21. A server serves the app's own build output only, in development and in production, and never the workspace folder (10.13, rule 1).
22. The user of a request is the user of its session. No route takes a user id from anywhere else (the two sync requests name a user only to be refused on a mismatch, sync.md 2.7), every vault query names it, and another user's row answers `404 not_found` exactly like a row that does not exist (data-model.md 7.12: I2, I3, I4).
23. No Anthropic credential in the published app: no environment variable whose name starts with `ANTHROPIC_`, no stored Anthropic profile, no managed Anthropic integration (10.10; data-model.md 7.8; claude-api.md C15.7). The Claude client is built only from the signed-in user's stored key. If such a variable exists at start in the published app, the Claude routes stay off and the log names the variable, never its value, as claude-api.md C15.7 defines.
24. Child processes get a minimal environment (10.13, rule 5). A browser that crashes writes its whole environment into a dump (10.11, M11), so the capture browser also gets its configuration and cache folders outside the workspace (capture.md 8.3).
25. Every limit of 11.5 and every quota of data-model.md 7.10 is read from configuration at start (13.5) and has a test that reaches it.
26. Required configuration that is missing in production stops the server at start, with a message that names what is missing: `DATABASE_URL` and `APP_ORIGIN`. A missing optional value switches its feature off and says so once in the log: mail (11.11), capture (capture.md 8.3), and the wrapping key that `USER_KEY_ENC_VERSION` names, without which the key routes answer as claude-api.md C15 defines.
27. The formatter and the linter skip every Markdown file and `docs/`, `fixtures/` and `reference/` (10.11, M12). A formatter that reflows one Markdown table changes hundreds of lines that other documents cite by number.
28. From phase 2 on, the test suite fails when a registered `/api/` route is in none of the lists of isolation tests for I2, I4 and I7 of data-model.md 7.12. Before strangers this is condition G1 of 11.14; it is cheaper to have it from the first route.

### 13.3 Steps only the owner can do

The builder cannot perform these from the Shell (10.12, P5); put them in a release checklist. A criterion that only the owner can meet does not hold up the builder's next phase (`../HANDOFF.md` section 7). Names are those of 13.5, data-model.md and sync.md. Steps 1 to 6 keep their numbers; 7 to 12 were added on 2026-11-20.

1. Import the repository as a Replit Project and choose the plan (Core or above for a durable published app). The workspace of this repository exists; confirm in Replit's interface that the project is private (10.11, M8).
2. Set production secrets, and check "Production app secrets" by hand (10.4): `USER_KEY_ENC_KEY_V1` (32 random bytes in base64, made outside the workspace, for example with `openssl rand -base64 32` on the owner's own computer), `INVITE_CODE_HASHES`, and later `MAIL_API_KEY`. Set the configuration values of 13.5 that differ from their defaults, at least `USER_KEY_ENC_VERSION=1` and `APP_ORIGIN`. There is no Anthropic key to set: confirm that neither the production secrets nor a linked account secret holds one (13.2, rule 23).
3. First publish: deployment type (Autoscale with "Max machines" 1 to start), geography (permanent), access "Public", analytics off, feedback widget off, badge off, automatic fixes of the monitoring agent off. Read the generated database SQL before approving (10.5).
4. Decide the address (custom domain or `*.replit.app`) before anyone else is invited (4.2).
5. Install on each of the owner's devices, sign up with an invitation, run check 5 in 13.1.
6. Switch on scheduled backups. Do one restore before real users exist, and write the steps down (11.7).
7. Before the first publish, and before any table exists in the database that `DATABASE_URL` names: settle the model for schema changes (10.12, P3; check 11 in 13.1). It takes Replit's interface, so it is a step for the owner (Replit Agent is not used: 10.13, rule 7). It does not hold up the builder: migrations are numbered SQL files with one runner, and until the decision the tests and development create the tables in a scratch database of the local PostgreSQL server (a fixed name prefix; created and dropped by the test run; 10.11, M13), and the test runner refuses the database that `DATABASE_URL` names. Once the decision is made, that database is deliberately brought to the state the chosen model needs, by the same numbered files: the platform creates the production database at the first publish only if the development database contains data, and its publish step compares the two (10.5).
8. Before the first publish: check that no personal connector and no personal account secret is attached to the project that is published (10.13, rule 5; check 13 in 13.1 says what to do if one is). Keep the project without collaborators (10.9).
9. Invite people: run the script that makes an invitation code, add the hash to `INVITE_CODE_HASHES`, publish, and send the link through a channel of the owner's choice (11.10).
10. Answer the questions of section 17, above all the sign-in method if the default is not wanted, the mail provider, the limits, and transcript encryption.
11. Supply the privacy policy, the terms and a contact address for reports before sign-up is opened to strangers (11.14). The builder writes none of them.
12. Operate: suspend or delete by user id through the platform's tools (11.13); change `SYNC_EPOCH` after any restore of the database (sync.md 3.5); rotate the wrapping key as data-model.md 7.8 describes.

### 13.4 HTTP API conventions, route map and limits

The other handoff documents leave routing and request limits to this document (data-model.md 7.4, capture.md 8.3, sync.md 1). Paths below are proposals, with four exceptions that sync.md relies on by name: `GET /api/sync/changes`, `POST /api/sync/push`, `GET /api/sessions/:id/messages` and `GET /api/auth/session`. Request and response bodies, and the behaviour of a flow, are defined by the document named in the last column.

Conventions. 1 to 8 keep their numbers; 9 and 10 were added on 2026-11-20.

1. Everything the page calls is under `/api/` on the same origin. The browser contacts no other origin.
2. Requests are JSON with `Content-Type: application/json` and the fixed header of 11.3. Exception: the share-target form. Responses are JSON with `Cache-Control: no-store`. Exceptions: event streams (9.3) and file downloads (6.5).
3. Every `/api/` route requires the session cookie, except the routes for sign-up, sign-in, recovery and reset and `GET /api/auth/session`. Without a valid session the answer is `401` with code `not_signed_in`; the page shows sign-in and keeps unsent input and the queue of changes (sync.md 2.6, rule 3).
4. Errors have one shape on every route, the one claude-api.md C6 uses: `{"error": {"code": "...", "message": "...", "retryable": false}}`, optionally with `retryAfterSeconds` and `details`. `code` is stable and machine-readable. `message` never echoes input and never says anything about another user. Unexpected failures answer `500` with code `internal` and a request id that is also logged.
5. Status codes: `400` validation, `401` not signed in, `403` refused (a failed cross-site check, a suspended account, a missing fresh sign-in check, a refused sign-up), `404` unknown id, `409` conflict or busy, `413` body too large or quota exceeded, `429` rate limited with a `Retry-After` header, `503` read-only mode; other `5xx` codes as the owning document defines them. The table after this list gives the code for each.
6. Identifiers in paths are UUIDs. Titles, tags, search text, e-mail addresses, shared links, codes and tokens never appear in a path or a query string (10.9); they travel in request bodies or, for a link that a person opens, in the fragment. Query strings carry only ids, positions, counts, cursors and fixed keywords.
7. `GET` never changes state (11.3).
8. Every request that is not a stream has a server-side deadline (suggested: 30 seconds). Longer work is a stream (9.3) or a polled job (see check 3 in 13.1 before relying on jobs).
9. The user of a request is the user of its session. No route takes a user id from a path, a query string, a header or a body (I2). The `user` and `user_id` of the two sync requests are the one exception: the server only compares them with the session's user and answers `409 wrong_user` on a mismatch (sync.md 2.7). A row of another user answers `404 not_found`, with the same body as a row that does not exist (I4).
10. JSON of the vault, sync and capture routes uses `snake_case`, with the column names of data-model.md; the place of a message is `position` (sync.md 1; capture.md 8.3). The Claude routes keep the names of claude-api.md C6.

Error codes by status:

| Status | Codes | Notes |
|---|---|---|
| 400 | `validation` | |
| 401 | `not_signed_in`; `invalid_credentials` on sign-in | |
| 403 | `cross_site_request` (11.3); `account_suspended` (data-model.md 7.7); `reauth_required` (11.2); `invitation_invalid`, `signup_closed`, `recovery_invalid` (11.10) | |
| 404 | `not_found` | Also for another user's row (convention 9) |
| 409 | `turn_in_progress` (claude-api.md C8); `resync_required` (sync.md 4.8); `wrong_user` and `already_signed_in` (sync.md 2.7); `email_taken` (11.10); `busy` (capture.md 8.3) | |
| 413 | `body_too_large`; `quota_exceeded` on a route that creates one thing (data-model.md 7.10) | A `413` without a JSON body comes from the platform and is read as `body_too_large` |
| 429 | `rate_limited`; `app_rate_limited` on Claude routes (claude-api.md C8) | With a `Retry-After` header (11.5) |
| 503 | `read_only` (11.13), with a `Retry-After` header; `server_busy` and the key codes of claude-api.md C8 on Claude routes | |
| 500 | `internal` | With the request id |

Inside a `200` answer of `POST /api/sync/push` every mutation has a result code of its own: `validation`, `unsupported`, `gone`, `not_found`, `name_taken`, `quota_exceeded`, `unseen_messages` or `turn_in_progress` (sync.md 6.6).

Route map:

| Route | Purpose | Defined in |
|---|---|---|
| `GET /manifest.webmanifest`, `GET /sw.js`, `GET /icons/...`, `GET /robots.txt` | Public static files | 4.3, 7.3, 11.4 |
| `GET` any other path outside `/api/` | The application shell, the same for everyone. The page addresses are design.md's (4.4, 4.15), among them `/sign-in`, `/invite` and `/import`; `/recover` is added by 11.10 | 13.2 rule 3 |
| `POST /share-target` | Share target: service worker, with a server fallback | 5.3, capture.md 8.2 |
| `POST /api/auth/invitation/check` | Body: invitation code. `204`, or `403 invitation_invalid`. Uses nothing up | 11.10, rule 6 |
| `POST /api/auth/signup` | Body: e-mail address, password, invitation code. `204` with the cookie, or `invitation_invalid`, `email_taken`, `signup_closed`, `validation`, `429`; `409 already_signed_in` while the request carries a valid session (sync.md 2.7) | 11.9, 11.10 |
| `POST /api/auth/login` | Body: e-mail address, password. `204` with the cookie, `401 invalid_credentials`, or `429`; `409 already_signed_in` while the request carries a valid session (sync.md 2.7) | 11.9, 11.2 |
| `POST /api/auth/logout` | Ends this browser's session | 11.2; sync.md 2.6 |
| `GET /api/auth/session` | `200 {"user_id", "status", "expires_at", "reauth_at"}` or `401 not_signed_in` | 11.2; sync.md 2.6 |
| `POST /api/auth/reauth` | Fresh sign-in check; updates `reauth_at` | 11.2 |
| `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `DELETE /api/auth/sessions` | List signed-in browsers, end one, end all others | 11.2 |
| `POST /api/auth/recover` | Body: e-mail address, new password, recovery code. `204`; `403 recovery_invalid` for every reason a code is refused; `400 validation` for the new password; `429`. Only while no mail is configured | 11.10, rule 8 |
| `POST /api/auth/verify`, `POST /api/auth/reset/request`, `POST /api/auth/reset` | E-mail verification and password reset. They exist only when mail is configured | 11.11 |
| `GET /api/account` | The signed-in user's id, address, verification state, status, `session_count`, `stored_bytes` and the limits that apply. Read with a connection; not kept in the offline copy | 11.9; data-model.md 7.10 |
| `DELETE /api/account` | Account deletion, after the fresh sign-in check | 11.12; data-model.md 7.11 |
| `GET /api/sync/changes?since=<n>&limit=<k>&epoch=<e>&user=<id>` | The change feed of the signed-in user. `409 wrong_user` when `user` is not that user | sync.md 4, 2.7 |
| `POST /api/sync/push` | Mutations of six types: `project.create`, `project.update`, `project.delete`, `session.create`, `session.update`, `session.delete`. The body names the user in `user_id`; `409 wrong_user` when it is not the signed-in user | sync.md 6, 2.7 |
| `GET /api/sessions/:id/messages?after=<position>` | One page of the transcript, with `messages_rev`, `message_count` and `more` | sync.md 5.2; data-model.md 7.4 |
| `POST /api/sessions/query`, `GET /api/sidebar`, `GET /api/sessions/:id` | Reading from the server: list or timeline (filter and search text in the body), counts, one session. Used while a device has no complete copy (sync.md 2.4) | data-model.md 7.3 |
| `POST /api/sessions`; `PATCH`, `DELETE /api/sessions/:id`; `GET`, `POST /api/projects`; `PATCH`, `DELETE /api/projects/:id` | Optional. `POST /api/sync/push` carries the same six operations; if these routes are built, they call the same handlers | sync.md 13.2 |
| `POST /api/import` | Merge one interchange document; the page splits a vault file into one document per session | data-model.md 6.7 |
| `GET /api/export` with `scope=vault`, or `scope=session` and `id=<uuid>` | Streamed interchange export; vault scope needs the fresh sign-in check | data-model.md 6.8; section 11.7 |
| `PUT /api/claude/key`, `POST /api/claude/key/check`, `DELETE /api/claude/key` | The user's own Claude API key: save or replace, check again, remove. No route ever returns the key | claude-api.md C6, C15; stored form in data-model.md 7.8 |
| `GET /api/claude/models`, `PUT /api/claude/preferences` | The models that the user's key can use; the user's own model list and default model, kept in `user_settings.data`. Read and written with a connection; not part of the change feed | claude-api.md C6, C16; data-model.md 7.7 |
| `GET /api/claude/config`; `POST /api/sessions/:id/continue`, `/summarize`, `/stop`; `GET`, `DELETE /api/sessions/:id/turn` | Claude | claude-api.md C6 |
| `GET /api/capture-config`; `POST /api/captures`; `GET`, `DELETE /api/captures/:id`; `POST /api/captures/:id/save` | Server-side capture of public share links (phase 3): what the page may offer, start, state, cancel or discard, save after a decision | capture.md 8.3 |
| Not in the first release: `GET /api/sessions/:id/attachments/:sha256`, `PUT /api/blobs/:sha256` | Attachment bytes. None are stored (data-model.md 7.2) | data-model.md 6.4, 6.7 |

Limits (suggested; lower them to what check 9 in 13.1 measures, minus a margin):

| Request | Limit |
|---|---|
| Ordinary JSON bodies, sign-in bodies included | 256 kB; 2 MB for `PATCH /api/sessions/:id` if it is built, because a summary may be 1 MiB (data-model.md 7.10) |
| `POST /api/sync/push` | 50 mutations and 256 kB; a `session.create` travels alone, up to 32 MB, and any other entry that is larger than 256 kB by itself travels alone, up to 2 MB (sync.md 6.4) |
| Claude routes | 512 kB on the turn routes, 2 kB on the key route (claude-api.md C9) |
| `POST /api/import`, and `POST /api/sessions` if it is built | 32 MB; one session per request |
| A page of `GET /api/sync/changes` | `limit` changes (1 to 500, default 200) or 1 MB of rows, whichever comes first (sync.md 4.2) |
| Transcript page | A page ends once the sum of `text_bytes` passes 1 MB (data-model.md 7.4) |
| Share-target form | capture.md 8.2 |
| Fields of a session or a project; messages per session | data-model.md 7.10 |
| Storage per user | `VAULT_MAX_STORED_BYTES`, `VAULT_MAX_SESSIONS`, `VAULT_MAX_PROJECTS` (data-model.md 7.10) |
| Rates for sign-in, sync, capture and Claude calls | 11.5, capture.md 8.3, claude-api.md C9 |

### 13.5 Configuration and secrets

Added on 2026-11-20. One table of the names that this document uses, next to the names that data-model.md and sync.md define. "Secret" values are set by the owner in the platform's secret store (13.3). "Configuration" values are non-sensitive settings in the same tool [R11]. A name marked "proposal" is this document's; the builder may change it in a commit that changes this table too.

| Name | Kind | Default | Meaning | Defined in |
|---|---|---|---|---|
| `DATABASE_URL` | Set by the platform | | The development database in the workspace, the production database in the published app | 10.5 |
| `PORT`, `REPLIT_DEPLOYMENT`, `REPLIT_DOMAINS` | Set by the platform | | Port to listen on; `1` in a published app; the project's domains | 10.3 |
| `SESSION_SECRET` | Secret; exists in the workspace (10.11, M2) | | Key for the keyed hashes of 11.2 and for whatever the sign-in library signs. Check that production has a value of its own | 11.2 |
| `USER_KEY_ENC_KEY_V<n>` | Secret | None; without it no key can be saved or used | Wrapping key number n for stored Claude keys: 32 random bytes, base64. Tests set a synthetic value inside the test process; a development server that finds none while `REPLIT_DEPLOYMENT` is unset makes a throw-away value at start and keeps it in memory. Neither is written to a file or to `.replit`. A published app never takes this path: there a missing key answers `key_service_unavailable` (13.2, rule 26; claude-api.md C15.3) | data-model.md 7.8 |
| `USER_KEY_ENC_VERSION` | Configuration | `1` | The version used for new encryptions | data-model.md 7.8 |
| `SYNC_EPOCH` | Configuration | `1` | Changed by the owner after a restore of the database | sync.md 3.5 |
| `VAULT_MAX_STORED_BYTES`, `VAULT_MAX_SESSIONS`, `VAULT_MAX_PROJECTS` | Configuration | 1 GiB; 10,000; 500 | Limits per user | data-model.md 7.10 |
| `APP_ORIGIN` (proposal) | Configuration | None; required in production | The canonical origin: for the checks of 11.3, for redirects (13.2, rule 17) and for links in mail | 11.3 |
| `SIGNUP_MODE` (proposal) | Configuration | `invite` | `invite`, `closed` or `open` | 11.10 |
| `INVITE_CODE_HASHES` (proposal) | Secret | Empty | Hashes of valid invitation codes, each with its last day. Tests set hashes of codes made in the test, inside the test process | 11.10 |
| `RECOVERY_CODE_HASHES` (proposal) | Secret | Empty | Recovery codes, while no mail is configured | 11.10 |
| `MAX_USERS` (proposal) | Configuration | 25 | Accounts in total while sign-up is by invitation | 11.5 |
| `MAIL_API_KEY`, `MAIL_FROM` (proposal) | Secret; configuration | None | The mail provider. Without the key no mail is sent | 11.11 |
| `VAULT_READ_ONLY` (proposal) | Configuration | Unset | Refuse every state-changing vault route | 11.13 |
| `ABOUT_SOURCE_URL` (proposal) | Configuration | Unset | Address of the "Source code" link in Settings. Without it the link is not shown (design.md 4.15.4) | 13.5 |
| `CAPTURE_ENABLED`, `CAPTURE_PROVIDERS`, `CAPTURE_RUNNER` and the capture limits | Configuration | Off; no provider; `none` in a deployment | Server-side capture: on or off, the providers that are switched on, where the browser runs | capture.md 8.3, 8.3a, 8.3b |
| The `CLAUDE_...` settings | Configuration | | Defaults and limits for Claude calls | claude-api.md C2 |
| The limits of 11.5 | Configuration | The table of 11.5 | One name per row, chosen by the builder | 11.5 |

Must not exist in the published app: any variable whose name starts with `ANTHROPIC_`, a stored Anthropic profile or a managed Anthropic integration (13.2, rule 23; claude-api.md C15.7); `OWNER_PASSWORD_HASH` and `OWNER_TOTP_SECRET` of the superseded single-owner design; any personal credential (10.13, rule 5). No secret has the prefix `VITE_`.

## 14. If instead ...

Revised on 2026-11-20. The main text now describes the decided product (section 1). The third note keeps what this document first assumed, as the alternative that it has become.

- If instead the vault lived only in the browser (IndexedDB, no server vault; not chosen, `../HANDOFF.md` section 2): browser storage becomes the only copy, so eviction, the Safari seven-day rule, a cleared browser or an uninstalled app lose data (section 7.1); there is no copy shared between devices, and on iOS not even between Safari and the installed app; `navigator.storage.persist()`, a storage meter and insistent export reminders become mandatory; the share target can write straight into IndexedDB from the service worker; accounts, sign-in, invitations, sessions and the cross-site defences disappear, but a server is still needed to call Claude unless decision 2 also changes; a Static deployment would be enough only if both change.
- If instead each user's Anthropic key were kept in the browser (not chosen, `../HANDOFF.md` section 3): the browser calls `https://api.anthropic.com` directly, so `connect-src` must list it; the Anthropic TypeScript SDK refuses to run in a browser unless `dangerouslyAllowBrowser` is set, and describes the default as protection against "exposing your secret API credentials" [W36]; the key is readable by any script in the origin and by anyone with the device, and cannot be an `HttpOnly` cookie; the stream no longer passes the hosting proxy, but nothing persists a reply when the tab is suspended, so B1 and B2 return; the server-side limits on Claude calls do not apply; `user_api_keys`, the wrapping key and the first table of 11.6 would not exist. Whether Anthropic's API accepts cross-origin browser requests, and with which headers, is covered in claude-api.md and was not verified here.
- If instead there were one owner and one server-side key (what this document first assumed): sections 4 to 10 stay as they are. `users` has one row, and invitations, quotas, abuse handling and the conditions for strangers have nothing to do (11.10, 11.13, 11.14). Sign-in is the design that 11.1 used to hold: no registration route and no first-run page; a generated passphrase (5 or more random words, or 20 or more random characters) whose Argon2id or scrypt hash is a production secret (`OWNER_PASSWORD_HASH`), produced by a script that reads the passphrase without echo; optionally a TOTP code (secret in `OWNER_TOTP_SECRET`; the current step plus or minus one is accepted and a step that was already used is refused); a lost passphrase is replaced by setting a new hash and publishing again. The Anthropic key is one production secret, the owner pays for every request, and rule 23 of 13.2 is reversed. The offline copy and sync.md are unchanged: one person with several devices needs them just the same.
- If instead a different stack were chosen (alternative to decision 3): nothing in sections 4 to 9 and 11 depends on React. Frameworks that render on the server change where the manifest, the service worker and the streaming route are defined, and Replit's publish-time database diff still expects the development database to hold the schema (10.5).
- If instead the Apple app were retired (alternative to decision 4): the interchange format is still needed as the export and backup format (11.7), and iOS loses its only share-sheet capture path (5.4).
- If instead a Reserved VM were used: scale-to-zero, cold starts and the open questions about work after a disconnect go away (10.8, 9.4), at a fixed monthly price. Reported: it is also the deployment type that fits a headless browser (10.12, P9).
- Not available since 2026-11-20 (10.13, rule 7), kept for the record: if instead sign-in came from a hosted service that Replit Agent sets up (11.9, option 6): 11.2 would describe that service's session and not a cookie of the app; S2 and S3 of 11.9 would have to be checked against the service; the policy of 11.4 would gain entries for it; `users.auth_subject` would hold the service's user id; development and production would have separate users; and deleting an account would have to delete the person in the service as well.

## 15. Unverified

Could not be confirmed from an official source on 2026-11-19, or on 2026-11-20 where an item says so. Each item names where it matters. Items keep their numbers. Where something has been measured in the workspace since, the item says what was found.

Web platform:

1. Web Share Target on macOS and Linux desktop Chromium (5.1). Official text names only ChromeOS and Windows.
2. Web Share Target in Android browsers that install shortcuts instead of WebAPKs (5.1).
3. Cookie and `Sec-Fetch-Site` behaviour of the share-target navigation when it reaches the server (reason the share is handled in the service worker, 5.3).
4. Whether cookies carry from Safari to a newly added Home Screen app on iOS. Assume they do not (4.1 states isolated storage).
5. Storage sharing between a desktop Chromium install and the browser profile (12).
6. `accept` filtering for `.md` and `.json` in phone file pickers (6.2).
7. File downloads and blob URLs inside an iOS Home Screen app (6.5).
8. Inline PDF display in frames on phones (6.5).
9. Text decoding details: byte-order-mark removal by `Blob.text()` and `TextDecoder`, replacement of invalid bytes (6.2). Recalled from the standards, not re-tested today; cover with fixtures.
10. Bookmarklets under a provider's content security policy, and bookmarklets on phones (8.2).
11. Extensions in Chrome for Android (press coverage only says a desktop-style Android build is in development) and packaging of Safari web extensions (Apple's page could not be read by the tool) (8.2).
12. Which CORS and framing headers the AI providers' share pages send, and whether they answer non-browser clients from data-centre addresses. Deliberately not probed with real links (8.1, 8.2).
13. `__Host-` and `Secure` cookies over `http://localhost` in each browser (11.2).
14. Details of using an iOS Shortcut to open the vault with a shared link; only "Show in Share Sheet" is confirmed (5.4).

Replit:

15. Request timeout of published apps and whether the proxy buffers streamed responses (9.2). The Cloud Run figures are an inference.
16. Whether server work continues after the client disconnects on Autoscale (9.4).
17. Headless Chromium in a deployment; the memory of the default machine of a deployment; whether Nix packages exist at run time in a deployment (10.8). Measured since: in the workspace a headless Chromium launches once the folder of `libatomic.so.1` is on `LD_LIBRARY_PATH`, and `~/.cache` does not survive a restart (10.11).
18. PWA install, manifest fetch, service worker and share target behind "Password protected" or private access, and behind the private development URL (10.3, 10.6).
19. Which access options exist on Core; the two documentation pages disagree (10.6).
20. Whether development secrets are copied to production automatically; the pages disagree (10.4).
21. What persists in the workspace outside the project directory. Measured since: only `~/workspace` survives a restart; the rest of the home directory is memory-backed (10.11, M7). No longer open for the workspace.
22. Whether partial unique indexes, GIN and operator-class indexes, `CHECK` constraints with regular expressions and extensions pass the publish-time diff, and whether either database offers `pg_trgm` (10.5). The revised data-model.md 7.2 needs composite primary and foreign keys and `CHECK` constraints to pass, and no extension.
23. The exact meaning of "provided your development database contains data" for the automatic creation of the production database (10.5).
24. Whether `PORT` is set, and to what, in a deployment when `[[ports]]` is present (10.3).
25. Whether the production database's certificate verifies with Node's default trust store (10.5).
26. Number of proxy hops and handling of `X-Forwarded-For` (11.2); whether the platform already sends HSTS; the platform's request body size limit (11.5).
27. How the analytics tracker, feedback widget and badge are inserted into pages and how they interact with a strict CSP (10.8). Recommended setting is off.
28. Default visibility of a personal Project's files (public or private). One help page says a project's privacy can be set to public so that "anyone with the link can view it". Measured since: an anonymous request for the workspace returns "not found" (10.11, M8). The owner still has to confirm in Replit's interface that the Project is private.
29. Which Node versions and `modules` names the workspace offers (10.2). Reported since: Node 24, 22 and 20 (10.12, P1). The `modules` names were not confirmed here.
30. What happens to the production database when a Starter-plan published app expires (11.7).
31. That the Preview pane embeds the app as a cross-site frame (10.3). The documentation says only that it "renders the page inside the Project Editor".

Added on 2026-11-20:

32. Whether the app-owned model for schema changes exists as reported, how it is switched on, and what it changes at publish (10.12, P3). It was not found on docs.replit.com on 2026-11-20.
33. Whether code in a published app can reach the credentials of a connector that is attached to its project, and how an ignore list for the published image is written (10.12, P6 and P7).
34. Downloads from a `blob:` address under the policy of 11.4: per browser, without a connection, and inside an installed app (6.5).
35. Browser support for the facilities of 7.4. The versions there are recalled, not read again.
36. For a hosted sign-in service (11.9, options 5 and 6): which cookies it sets and with which attributes, and whether sign-up can be limited to invited people in a tenant that Replit manages.
37. For the same: which scripts, styles and hosts its components need under a content security policy, and whether they start without a network.
38. Which role `DATABASE_URL` names in production, and whether that role owns the tables (10.5; data-model.md 7.13).
39. Whether passkeys work inside an installed app on iOS and on Android as they do in the browser (11.14, G6).
40. What the platform uses the "session secret" of the Users & Auth tool for, and whether a published app gets a `SESSION_SECRET` of its own (10.4, 13.5).
41. Which sign-in library meets 11.9. No library documentation was read for this revision.
42. Whether the rule of 11.11 (token in the fragment, used only by a button) keeps mail scanners from using up links in practice.
43. Whether the Replit-managed Anthropic integration sets environment variables that an Anthropic client would pick up (10.10).

## 16. Sources

All checked on 2026-11-19 unless an entry says otherwise. Page dates are given where the page shows one. For the revision of 2026-11-20 only Replit pages were read; the web platform entries are as they were.

Web platform:

- [W1] web.dev, "What does it take to be installable?": https://web.dev/articles/install-criteria
- [W2] MDN, "Making PWAs installable" (modified 2026-10-06): https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- [W3] MDN, "Web application manifest" (modified 2025-08-08): https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest
- [W4] MDN, "share_target" (modified 2026-08-27): https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target
- [W5] Chrome for Developers, "Receiving shared data with the Web Share Target API": https://developer.chrome.com/docs/capabilities/web-apis/web-share-target
- [W6] Chrome for Developers, "New in Chrome 89": https://developer.chrome.com/blog/new-in-chrome-89/
- [W7] Microsoft Edge documentation, "Share content with other apps" (updated 2026-09-02): https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/share
- [W8] MDN browser-compat-data 8.1.10 through its API, `https://bcd.developer.mozilla.org/bcd/api/v0/current/<key>.json`. Keys used: `manifests.webapp.share_target`, `manifests.webapp.icons`, `manifests.webapp.display`, `manifests.webapp.file_handlers`, `api.Navigator.share`, `api.Navigator.canShare`, `api.Clipboard.readText`, `api.Clipboard.writeText`, `api.ClipboardEvent.clipboardData`, `api.Window.showOpenFilePicker`, `api.Window.showSaveFilePicker`, `api.Window.showDirectoryPicker`, `api.StorageManager.persist`, `api.StorageManager.estimate`, `api.StorageManager.getDirectory`, `api.SyncManager`, `api.PeriodicSyncManager`, `api.BeforeInstallPromptEvent`, `api.LaunchQueue`, `api.EventSource`, `api.Response.body`, `api.ReadableStream.@@asyncIterator`, `api.Blob.text`, `api.DataTransfer.files`, `api.HTMLAnchorElement.download`, `api.PublicKeyCredential`, `api.ServiceWorkerContainer.register`, `css.at-rules.media.display-mode`, `http.headers.Sec-Fetch-Site`, `http.headers.Clear-Site-Data`, `http.headers.Set-Cookie`.
- [W9] WebKit Bugzilla 194593: https://bugs.webkit.org/show_bug.cgi?id=194593
- [W10] web.dev, "WebAPKs on Android": https://web.dev/articles/webapks
- [W11] web.dev, "How Chrome handles updates to the web app manifest": https://web.dev/articles/manifest-updates
- [W12] web.dev Learn PWA, "Installation": https://web.dev/learn/pwa/installation
- [W13] web.dev Learn PWA, "OS integration": https://web.dev/learn/pwa/os-integration
- [W14] WebKit blog, "Web Push for Web Apps on iOS and iPadOS" (2023-02-16): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- [W15] WebKit blog, "WebKit Features in Safari 17.0" (2023-09-18): https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
- [W16] WebKit blog, "WebKit Features in Safari 26.0" (2025-09-15): https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- [W17] WebKit blog, "Updates to Storage Policy" (2023-08-10): https://webkit.org/blog/14403/updates-to-storage-policy/
- [W18] MDN, "Storage quotas and eviction criteria" (modified 2026-01-05): https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- [W19] web.dev, "Storage for the web": https://web.dev/articles/storage-for-the-web
- [W20] web.dev, "Persistent storage": https://web.dev/articles/persistent-storage
- [W21] MDN, "Offline and background operation" (modified 2026-09-13): https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
- [W22] MDN, "Using Service Workers" (modified 2026-09-25): https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- [W23] MDN, "Clipboard API" (modified 2026-10-20): https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
- [W24] WebKit blog, "Async Clipboard API" (2020-06-23): https://webkit.org/blog/10855/async-clipboard-api/
- [W25] Chrome for Developers, "The File System Access API" (published 2024-08-19): https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- [W26] MDN, "Same-origin policy" (modified 2026-09-17): https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- [W27] MDN, "Cross-Origin Resource Sharing (CORS)" (modified 2026-10-28): https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- [W28] W3C, "Content Security Policy Level 3", Working Draft 2026-10-27, section 9.1: https://www.w3.org/TR/CSP3/
- [W29] Mozilla Extension Workshop, "Developing extensions for Firefox for Android" (updated 2026-10-18): https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- [W30] MDN, "Using server-sent events" (modified 2026-09-03): https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- [W31] WHATWG HTML Standard, "Server-sent events": https://html.spec.whatwg.org/multipage/server-sent-events.html
- [W32] nginx, `ngx_http_proxy_module`: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- [W33] Chrome for Developers, "Page Lifecycle API" (updated 2026-10-16): https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- [W34] Google Cloud Run documentation: request timeout https://docs.cloud.google.com/run/docs/configuring/request-timeout ; billing settings https://docs.cloud.google.com/run/docs/configuring/billing-settings ; WebSockets https://docs.cloud.google.com/run/docs/triggering/websockets
- [W35] Anthropic, "Streaming messages": https://platform.claude.com/docs/en/build-with-claude/streaming
- [W36] Anthropic TypeScript SDK, README: https://github.com/anthropics/anthropic-sdk-typescript
- [W37] OWASP Cheat Sheet Series: Cross-Site Request Forgery Prevention, Session Management, Logging, Server-Side Request Forgery Prevention, Password Storage: https://cheatsheetseries.owasp.org/
- [W38] MDN, "Set-Cookie" (modified 2026-09-01): https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- [W39] MDN, "PublicKeyCredentialCreationOptions" (modified 2026-09-17): https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions
- [W40] Node.js documentation, `crypto` (`scrypt`, `argon2`, `timingSafeEqual`): https://nodejs.org/api/crypto.html
- [W41] Express, "Express behind proxies": https://expressjs.com/en/guide/behind-proxies.html
- [W42] expressjs/compression, README, "Server-Sent Events": https://github.com/expressjs/compression
- [W43] Vite, "Server Options": https://vite.dev/config/server-options
- [W44] vite-plugin-pwa documentation (v1.2.0), guide and "injectManifest": https://vite-pwa-org.netlify.app/guide/inject-manifest.html
- [W45] Chrome for Developers, "workbox-routing": https://developer.chrome.com/docs/workbox/modules/workbox-routing
- [W46] Playwright, "Installation" and "Browsers": https://playwright.dev/docs/intro , https://playwright.dev/docs/browsers
- [W47] NixOS Wiki, "Playwright" (community wiki): https://wiki.nixos.org/wiki/Playwright
- [W48] Apple Support, Shortcuts User Guide, "Launch a shortcut from another app": https://support.apple.com/guide/shortcuts/launch-a-shortcut-from-another-app-apd163eb9f95/ios
- [W49] MDN, "Share data between apps" (modified 2025-06-30): https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Share_data_between_apps
- [W50] Public Suffix List, version 2026-11-19: https://publicsuffix.org/list/public_suffix_list.dat
- [W51] Node.js documentation, `http` (`IncomingMessage` and `ServerResponse` events, `response.writableEnded`), checked 2026-11-20: https://nodejs.org/api/http.html

Replit (https://docs.replit.com/ followed by the path; each page is also available as Markdown by appending `.md`): Entries marked "read again" were fetched as Markdown on 2026-11-20. The statements that rest on them were not all checked again one by one; where a page now says something else, the text says so.

- [R1] `features/publishing/deployment-types`. Read again.
- [R2] `features/publishing/private-deployments` ("Who can access your app"). Read again.
- [R3] `features/publishing/overview`, `features/publishing/after-you-publish`, `features/publishing/machine-configuration`. Read again.
- [R4] `learn/projects-and-artifacts/replit-deployments`. Read again.
- [R5] `build/troubleshooting` ("Troubleshoot publishing"). Read again.
- [R6] `help/deployment-and-publishing`, `help/networking-and-app-errors`. Read again.
- [R7] `features/publishing/monitoring-a-deployment`. Read again.
- [R8] `features/data-and-storage/sql-database`, `features/data-and-storage/development-and-production`, `features/data-and-storage/connection-details`. Read again.
- [R9] `features/data-and-storage/publish-database-changes`, `help/troubleshooting/databases`. Read again.
- [R10] `features/data-and-storage/data-recovery`, `features/data-and-storage/work-with-your-data`. Read again: the first page.
- [R11] `core-concepts/project-editor/app-setup/secrets`. Read again.
- [R12] `core-concepts/project-editor/app-setup/development-urls`, `features/deployment-customization/external-access-tokens`. Read again: the first page.
- [R13] `features/project-setup/configuration`, `features/project-setup/dependency-management`, `features/project-setup/ports`. Read again: the first page.
- [R14] `features/auth-and-identity/overview`, `features/auth-and-identity/authentication`, `learn/projects-and-artifacts/auth`. Read again.
- [R15] `features/data-and-storage/object-storage`, `features/sdks/object-storage-javascript-sdk`
- [R16] `billing/plans/starter-plan`, `billing/plans/replit-core`, `billing/deployment-pricing`, `billing/about-usage-based-billing`, `billing/aug-cloud-billing-updates`. Read again: the first three pages.
- [R17] `legal-and-security-info/usage`. Read again.
- [R18] `features/security/shared-responsibility-model`, `features/security/package-firewall`, `features/security/geography`. Read again: the first page.
- [R19] `features/integrations/replit-ai-integrations`. Read again.
- [R20] `build/code/code-with-replit`, `build/code/working-with-code`, `build/import-from-providers`
- [R21] `features/publishing/custom-domains`
- [R22] `features/project-setup/replit-dot-md`
- [R23] `features/workspace-tools/shell`, `features/workspace-tools/ssh`
- [R24] `features/publishing/project-analytics`. Read again.
- [R25] `features/agent/app-testing`. Read again.
- [R26] `help/projects-and-files`. Read again.
- [R27] `features/version-control/checkpoints-and-rollbacks`
- [R28] `features/editor/preview`
- [R29] `features/auth-and-identity/clerk-auth`, `features/auth-and-identity/single-sign-on`, `features/auth-and-identity/custom-auth-migration`, `help/troubleshooting/auth`. First read on 2026-11-20.
- [R30] `features/integrations/overview`, `replitai/managing-connectors`, `teams/connector-governance`. First read on 2026-11-20.
- [R31] `build/code/adding-secrets-to-environments`. First read on 2026-11-20.
- [R32] `features/publishing/project-geography`. First read on 2026-11-20.

Also used on 2026-11-20: the page index (`llms.txt` and `_llms/en/features/features.txt`), and the change logs `updates/<year>/<month>/<day>/changelog` from 2026-08-07 to 2026-11-13, which were searched for the terms of 10.12.

Workspace (not web pages):

- 10.11: measured on 2026-11-20 by the Claude Code session working in the Replit workspace of this repository. Most of it is also in `../HANDOFF.md` section 3 and `../../CLAUDE.md`.
- 10.12: a second report of the same session on the same day. It is not part of the repository.

## 17. Decisions for the owner

Added on 2026-11-20. Build the default until the owner answers. `../HANDOFF.md` section 9 says which questions need the owner at all. Questions about the offline copy are in sync.md section 15, questions about stored data in data-model.md section 12.

| # | Question | Default | Where |
|---|---|---|---|
| 1 | Sign-in: built into the app with a maintained library, which Claude Code can do alone. (The hosted service that only Replit Agent can set up is not available: 10.13, rule 7.) A password, or a mailed code once mail exists? | Built into the app: e-mail address and password, invitation codes | 11.9 |
| 2 | The final address: a custom domain, or the `*.replit.app` name? | Decided before anyone else is invited. A custom domain if the owner has or wants one, because the `replit.app` name can change | 4.2 |
| 3 | The model for schema changes: publish-managed, or app-owned if the platform confirms that it exists? | Both sessions that work on this repository recommend app-owned if it is confirmed. Without confirmation: publish-managed | 10.5, 10.12 |
| 4 | Mail: through which provider account does product mail go, and from which address? | None yet: no mail is sent, and recovery goes through the owner | 11.11 |
| 5 | When sign-up opens to strangers, is a second factor required of users, offered, or left out? | Offered | 11.14, G6 |
| 6 | How long does a sign-in last, and how fresh must the sign-in check be? | 30 days sliding, 90 days at most; a check within the last 10 minutes | 11.2 |
| 7 | How many accounts, and how much storage for each? (data-model.md section 12, decision 9) | 25 accounts; 1 GiB, 10,000 sessions and 500 projects each | 11.5 |
| 8 | Are transcripts encrypted by the application before they reach the database? | No (option 1); asked again before strangers | 11.6 |
| 9 | Where does link capture run if a deployed app cannot start a browser: in a service of its own, or not at all? (capture.md section 14, decision 7) | Not at all until check 6 of 13.1 is answered; paste stays | 10.8 |
| 10 | Which plan, which region and which deployment type? | Core or above; the region is chosen at the first publish and is permanent; Autoscale with one machine | 10.8, 13.3 |
| 11 | May Replit Agent be asked to look at production data or logs once other people have accounts? | No. Decided more widely on 2026-11-20: Replit Agent is never used (10.13, rule 7) | 10.9 |
| 12 | When does sign-up open beyond invitations, and with which privacy policy, terms and contact address? | Not before every row of 11.14 holds | 11.14 |
