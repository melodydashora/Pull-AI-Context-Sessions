# Web platform and hosting constraints

> **Status (2026-11-20).** Extracted from the Apple app's source, written for one owner and one server-side API key. The parts on what the Apple app does and on its defects are ready to build from. Where the web design here assumes a single owner or a single key, `../HANDOFF.md` section 2 wins, and section 5 there lists what is being revised.

## Summary

- A web page can do nearly everything the Apple app does, on Android, iOS, Windows, macOS and Linux, except the capture browser: a page may not load another site's page and read it.
- Capture on the web is paste, file import, an Android share target, and optionally a server-side fetch or headless browser for public share links only.
- Android Chrome is the best phone target (WebAPK install, `share_target`, storage shared with Chrome). iOS has no share target, no install prompt API, and storage isolated per Home Screen install.
- Browser storage is a cache, not a vault: browsers evict origin data, and Safari deletes script-written data after seven days without interaction outside installed apps. The server database is the source of truth.
- Claude streaming runs browser -> own server -> Anthropic with `fetch` and a reader loop, heartbeats, an explicit terminal event, idempotent sends and server-side persistence.
- Replit today: separate development and production databases; schema reaches production only through the Publish diff (no triggers or functions); no persistent filesystem; public by default; one port; `/` must answer in 5 seconds.
- Privacy on this host: Replit Agent can read the production database and the logs, and analytics record page paths. So no transcript text, titles or shared links in logs or URLs, and only synthetic data in the workspace.
- Security baseline: app-level single-owner sign-in, `__Host-` cookie (`Secure; HttpOnly; SameSite=Strict`), `Sec-Fetch-Site` / `Origin` checks, strict CSP, escaped rendering, rate limits, whole-vault export.
- Unconfirmed from official sources (section 15): long streams and work after a disconnect behind Replit's proxy, headless Chromium on Replit, PWA install behind Replit's access gates, extensions in Chrome for Android.

## 1. Conventions

- Scope: what the web platform and the hosting target (Replit) allow for a web version of SessionVault, and where the web version must differ from the Apple app. All external facts were checked on 2026-11-19 (one source on 2026-11-20, marked in section 16); sources are listed in section 16 and cited as `[Wn]` (web platform) and `[Rn]` (Replit).
- Three kinds of statement are kept apart: (A) what the Apple app does today (section 2); (B) defects or accidents of the Apple implementation that the web app should not copy (section 3); (C) what the web app must do because it is a web app (sections 4 to 11).
- `Inference:` marks reasoning that neither the code nor a cited source states. `Unverified:` marks something that could not be confirmed from an official source; all such items are collected in section 15.
- Code references are relative to the repository root, for example `apple/SessionVault/ClaudeAPI.swift:117`.
- Browser versions come from MDN browser-compat-data 8.1.10 [W8] unless another source is cited. "Desktop" means Chrome and Edge on Windows, macOS and Linux; Safari and Firefox are named where they differ.
- Example origin: `https://vault.example`. Route names, header names and environment variable names in this document are proposals; where data-model.md, claude-api.md or capture.md define a name for the same thing, theirs wins.
- Working assumptions (being confirmed with the owner): (1) one signed-in owner, vault in managed Postgres on the hosting platform; (2) the Anthropic API key is a server-side secret; (3) TypeScript, React + Vite single-page app, small Node server, Postgres, parsing in a pure TypeScript module; (4) the Apple app continues and exchanges sessions through a versioned JSON format. Section 14 says what changes under the alternatives.

## 2. What the Apple app does today (A)

Only behaviour that touches a platform capability is listed. Parsing rules are in import-rules.md, the capture algorithm in capture.md, the API call in claude-api.md.

| # | Area | Behaviour today | Code |
|---|---|---|---|
| A1 | Storage | Local SwiftData store with three models; no account, no sync. iCloud sync is only an idea. | `apple/SessionVault/SessionVaultApp.swift:10`, `apple/SessionVault/Models.swift:38-114`, `apple/README.md:32` |
| A2 | Link capture | An in-app `WKWebView` loads the URL; the user signs in inside it if needed; the app injects JavaScript, scrolls the transcript and harvests `[data-index]` elements, with `document.body.innerText` as fallback. Logins persist in the web view's data store. | `apple/SessionVault/WebCapture.swift:14,20-36,46-98,146-186`, `apple/SessionVault/Views/LinkCaptureView.swift:41-56,66` |
| A3 | PDF original | `webView.__createPDF` of the page (frame grown to the content height, capped at 40000), stored in `snapshotPDF` with external storage, shown with PDFKit, shared as a temporary file. | `apple/SessionVault/WebCapture.swift:120-142`, `apple/SessionVault/Models.swift:65`, `apple/SessionVault/Views/PDFViewer.swift:5-26,35-45,59-65` |
| A4 | File import | System file picker, multiple selection, content types `.json`, `.plainText`, `.text` plus the `md` extension. Each file is read whole into memory. A `.json` file is first tried as a ChatGPT export; anything else must decode as UTF-8 or it yields nothing. | `apple/SessionVault/Views/ImportSheet.swift:26-30,153-159`, `apple/SessionVault/Importers.swift:24-33,455-468` |
| A5 | Drag and drop | File URLs dropped anywhere on the main window are imported. | `apple/SessionVault/Views/RootView.swift:72-74` |
| A6 | Clipboard import | One button reads the system pasteboard string directly. Empty -> `"Clipboard is empty."`. A trimmed value with no newline, no space, a `.` and fewer than 500 characters that parses as a URL with a host is treated as a link and opens capture. Otherwise it is parsed as text with the title `"Pasted session"`. | `apple/SessionVault/Views/ImportSheet.swift:195-226` |
| A7 | Copy out | Context pack and code blocks are written to the pasteboard; the button shows a copied state for 2 s and 1.5 s. | `apple/SessionVault/Views/SessionDetailView.swift:228-241`, `apple/SessionVault/Views/MessageView.swift:163-174` |
| A8 | Share out | System share sheet with the context pack Markdown string; the PDF is shared as a file. | `apple/SessionVault/Views/SessionDetailView.swift:87-89`, `apple/SessionVault/Views/PDFViewer.swift:59-65` |
| A9 | Share in | None. An iOS share extension is only an idea. | `apple/README.md:33` |
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
| B2 | A failed stream discards the partial reply but keeps the user message: the user message is inserted at `apple/SessionVault/Views/ContinueChatView.swift:255-257` before the call; on error only `errorMessage` is set (same file, `299-301`) and `streamingText = ""` (`302`). The next send rebuilds the history from all stored messages (`259-265`), so the unanswered turn is sent again. | Dropped connections are routine on phones. The transcript would collect unanswered user turns, and a retry would duplicate them. | The server owns the turn: idempotency key per send, turn state stored on the server, retry reuses the same user message (section 9.4). |
| B3 | No way to stop a reply: while streaming, the send button is replaced by a spinner and disabled and the text field is disabled (`apple/SessionVault/Views/ContinueChatView.swift:218,223-237`). | A reply can run for minutes; on the web the user needs a Stop control, and the server needs a defined policy for a client that goes away. | A Stop button that calls an explicit stop route (claude-api.md C6); policy in section 9.4. |
| B4 | The API key is held by the client and sent by the client (A10, A11). | Under assumption 2 the browser must never see the key. Anything stored in a browser is readable by any script that runs in the origin. | Key only in server secrets; the browser calls same-origin endpoints (section 11). |
| B5 | Any string is offered as a link: `Link(destination: url)` for any `URL(string: session.sourceURL)` (`apple/SessionVault/Views/SessionDetailView.swift:199-205`), and the importer copies the `Source: ` line verbatim (`apple/SessionVault/Importers.swift:244`). | In a browser, an `href` with a `javascript:` URL runs script in the vault's origin when clicked. An imported file can therefore carry a stored cross-site-scripting payload. | Render `sourceURL` as a link only when `new URL(value).protocol` is `http:` or `https:`; otherwise show it as plain text. |
| B6 | The clipboard is read with no paste gesture from the user (`apple/SessionVault/Views/ImportSheet.swift:195-200`). | Browsers answer a programmatic read with a permission prompt, a "Paste" callout, or a rejection (section 6.1). | A paste field is the primary path; the button is an enhancement. |
| B7 | Whole file in memory and all-or-nothing JSON parsing (`apple/SessionVault/Importers.swift:26-29,461`). | Inference: a ChatGPT export can be far larger than a phone browser tab can parse on the main thread without freezing or being killed. | Check `file.size` first, parse in a Web Worker, upload one session per request (sections 6.2 and 11.5). |
| B8 | Lines are split on `"\n"` only (`apple/SessionVault/Importers.swift:109,238,360`); the repository README lists the consequence for Windows line endings as a known limit (`README.md:93`). | Files picked on Windows and text from some clipboards arrive with CRLF. | Normalise `\r\n` and `\r` to `\n` before parsing; the rule belongs to import-rules.md. Do not rely on the input control to do it. |
| B9 | The exported PDF file name only replaces `/` (`apple/SessionVault/Views/PDFViewer.swift:36`). | Download names reach Windows and Android file systems and an HTTP header. | Sanitise names for `\ / : * ? " < > \|`, control characters, trailing dots and spaces and reserved device names; send them with `Content-Disposition: attachment; filename*=UTF-8''<percent-encoded>`. |
| B10 | Summarise uses only `.text` events and ignores how the stream ended (`apple/SessionVault/Views/SessionDetailView.swift:148-155`). | Same failure as B1: a summary cut by a dropped connection or by the token limit is saved as if complete. | Apply the terminal-event rule to summaries too; details in claude-api.md. |

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
- On iOS the owner signs in again inside the installed app, and an offline copy made in Safari is not visible to the installed app (isolated storage).
- The origin is the identity of everything stored in the browser: installs, cookies, IndexedDB, service worker and passkeys all belong to one scheme + host + port [W26]. If the public address changes, every install and offline copy is orphaned. Replit's `*.replit.app` name "isn't guaranteed to stay the same when you unpublish and republish" [R6]. Decide the final address before the owner installs the app on phones (open question), and redirect every other host name to it.
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
    // record to the IndexedDB store "pendingShares" and returns { ok: true, id } or { ok: false, code }
    // (for example "too_large").
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

Platform facts the import page must respect (the rules themselves are in capture.md 8.2):

1. If the owner is not signed in, show sign-in first and keep the pending record.
2. On Android the link usually arrives in `text`, not in `url` (5.2). Treat every field as untrusted input.
3. A shared link is only a link. Getting the conversation behind it needs one of the routes in section 8.2.
4. Delete the pending record only after the server has confirmed the import.

Testing without an Android phone: submit a `multipart/form-data` form with the same field names to `/share-target` from a page of the app. This exercises the service worker handler in any browser with service workers. The owner then tests on a real phone with the published address.

If the service worker path cannot be made to work, the fallback is a `GET` share target for `title`, `text` and `url` only. In that case the server and every log must drop query strings, and the app must call `history.replaceState` at once. This is a worse option, not an equivalent.

### 5.4 iOS

There is no share target in any iOS browser [W8][W9]. What works instead:

1. Copy the link or the page text in the other app, open the vault, paste (section 6.1). This is the path to build and document.
2. The native Apple app, which stays (assumption 4), remains the capture tool on iPhone and iPad; captured sessions reach the web vault through the interchange format (data-model.md). A share extension for the native app is only an idea today (`apple/README.md:33`) and is not the web builder's task.
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
4. Keep the Apple link rule for pasted text: if the trimmed text has no newline, no space, contains `.`, is shorter than 500 characters and parses as a URL with a host (prefix `https://` when `://` is missing), treat it as a link, not as a transcript (`apple/SessionVault/Views/ImportSheet.swift:206-216`).
5. Copy buttons (context pack, code blocks): call `writeText()` synchronously in the click handler with text that is already in memory. Build the context pack in the browser from the loaded session so that no network request sits between the click and the write; a request in between can lose the user gesture in Safari [W24].

### 6.2 File import

- `<input type="file" multiple accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json">` works on Android, iOS and desktop and mirrors A4. Unverified: how phone file pickers apply `accept` to `.md` and `.json`; if files appear greyed out on a test phone, offer a second input without `accept` and validate after selection.
- Decide the format from the file name extension and the content, as the Apple code does (`apple/SessionVault/Importers.swift:24-33`), not from `file.type`, which is often empty.
- Read with `file.arrayBuffer()` and `TextDecoder`, or `file.text()` (Chrome 76+, Firefox 69+, Safari 14+, iOS 14.5+ [W8]). Differences from the Apple code that the parser tests must cover (recalled from the File API and Encoding standards, not re-tested today): the web decoders never fail, they replace invalid bytes with U+FFFD, whereas the Apple code returns nothing for invalid UTF-8 (`apple/SessionVault/Importers.swift:31`); they remove a UTF-8 byte order mark; UTF-16 files decode to garbage unless the byte order mark (`FF FE` or `FE FF`) is detected and the matching decoder is used.
- Large files (B7): read `file.size` first; parse in a Web Worker; show progress; upload parsed sessions one per request. Choose and document explicit limits (suggested starting point: warn above 50 MB, and above 10 MB of text per session ask for confirmation).
- The pure TypeScript parsing module (assumption 3) must not touch `window`, `document` or Node APIs so that it runs in the worker and on the server.

### 6.3 Drag and drop

- Desktop: listen for `dragover` and `drop` on `window`, call `preventDefault()` in both, and import `event.dataTransfer.files` (supported everywhere [W8]). Without `preventDefault()` the browser navigates to the dropped file and replaces the app. This mirrors A5.
- Phones: inference: dragging files between apps is not a practical path on phones; the file picker and the share target cover it.

### 6.4 File System Access and file handling

- `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`: Chrome and Edge 86+ on desktop, Chrome for Android 132+, Samsung Internet 29+; not in Firefox, not in Safari; marked experimental [W8][W25]. Safari and Firefox support only the origin-private file system (`navigator.storage.getDirectory()`) [W8][W25].
- `file_handlers` and `launchQueue` (open a file with the installed app): Chrome and Edge 102+ on desktop only [W8].
- Recommendation: do not depend on either. The documented fallbacks are `<input type="file">` and `<a download>` [W25].

### 6.5 Downloads and the PDF original

- Exports (context pack, whole-vault export, PDF original) are served by authenticated same-origin `GET` endpoints with `Content-Disposition: attachment` and a sanitised name (B9). `<a download>` is supported everywhere [W8]. Unverified: download behaviour inside an iOS Home Screen app; test it, and keep "Share" and "Copy" as alternatives.
- A web page cannot render another site's page to PDF. Only a server-side headless browser could produce the "original" (A3), and only for public pages (section 8). Sessions that arrive from the Apple app through the interchange format may carry a PDF; store it and offer "Open original" as a link to an authenticated endpoint that responds with `Content-Type: application/pdf`, `Content-Disposition: inline` and `X-Content-Type-Options: nosniff`, opened in a new tab. Check that the stored bytes begin with `%PDF-` before serving them as PDF. Unverified: inline PDF display inside an `<iframe>` on phones; a new tab avoids the question and keeps the CSP without `frame-src`.

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

- Under assumption 1 the phone copy is a cache of the server vault. Eviction costs a re-download, not data.
- Text is small. Illustration only (the real vault size is not known here): 1,000 sessions of 200 KB are 200 MB, far below any quota above. Inference: PDF originals are much larger than the text; do not cache them offline by default.
- The offline copy is plain text in IndexedDB on the device. Anyone who can use the unlocked browser profile can read it. Sign-out must delete it (section 11.2).
- iOS: the copy lives separately in Safari and in each Home Screen install (section 4.1). In Safari as a tab it is subject to the seven-day rule; in the installed app it is not.
- Without Background Sync on iOS and Firefox, queued changes can be sent only while the app is open.

### 7.3 What to build

1. Precache the application shell (HTML, JavaScript, CSS, icons) with the service worker so the app opens offline. Serve `/sw.js` from the root with `Cache-Control: no-cache`.
2. Never put API responses in Cache Storage. The service worker ignores `/api/` (section 5.3) and the server sends `Cache-Control: no-store` on every API response.
3. Offline data is an explicit, opt-in IndexedDB cache written by application code: default off; when on, store the session list and the sessions the owner opened or pinned; show the storage use from `navigator.storage.estimate()`; call `navigator.storage.persist()` when the owner switches the option on (not at page load [W20]).
4. Version 1 is read-only offline. Writes (import, edits, continue) need a connection and say so. The one exception is a received share, which stays in the `pendingShares` store until it can be imported.
5. Update flow: prefer "a new version is available - reload" over silent takeover, so that an update cannot interrupt a streaming reply. With the `injectManifest` strategy this means a `message` listener that calls `self.skipWaiting()` when the page asks for it [W44].
6. Reconcile on return: when the page becomes visible or the browser reports `online`, refetch what is on screen (section 9.5).

## 8. Capture: why a page cannot read another site (C)

### 8.1 Facts

- Two URLs have the same origin only when scheme, host and port match. Cross-origin reads "are typically disallowed" [W26].
- "`fetch()` and `XMLHttpRequest` follow the same-origin policy. This means that a web application using those APIs can only request resources from the same origin the application was loaded from unless the response from other origins includes the right CORS headers." For a request with cookies the other server must name the calling origin explicitly; a wildcard is rejected [W27].
- A document in a frame from another origin exposes only a few `Window` and `Location` members and `postMessage`; its DOM is not reachable. Sites can also forbid framing with `X-Frame-Options` [W26].
- Consequence: the vault page cannot fetch a provider's share page and read it, and it cannot show the page in a frame and run the scroll-and-harvest script on it. What the Apple app does with `evaluateJavaScript` inside its own `WKWebView` (A2) has no equivalent in a web page. Unverified, and deliberately not probed with real links: which headers the providers' pages send.

### 8.2 Alternatives

| # | Route | Phones | Signed-in pages | Cost and limits |
|---|---|---|---|---|
| 1 | Paste the page text: the owner opens the link in their own browser, selects all, copies, pastes into the vault. The claude.ai share-page text parser exists for exactly this input (`apple/SessionVault/Importers.swift:93-131`). | Android and iOS | Yes (the owner's own browser) | No infrastructure. Inference from the code comment at `apple/SessionVault/WebCapture.swift:4-7` ("only a handful exist in the DOM at once"): on pages that render only the visible turns, select-all copies an incomplete conversation. |
| 2 | File import: transcripts written by `puller/pull_sessions.py` (`# <id>` then `Source: <url>`, `puller/pull_sessions.py:191-194`), ChatGPT exports, plain Markdown or text. | Android and iOS | n/a | Already specified by the Apple importer; large files need a worker (section 6.2). |
| 3 | Interchange import from the Apple app (assumption 4). | Android and iOS | n/a | The Apple app keeps doing real captures, including PDF originals. |
| 4 | Server-side fetch: the vault server requests the link over HTTP. | Any (server does the work) | No | Works only when the provider returns the conversation without a login, without script execution and without a bot check. Inference: the Apple heuristics list `"just a moment"` and `"verify you are human"` among sign-in-wall markers (`apple/SessionVault/Importers.swift:135-139`), so such interstitials have been met. Needs the SSRF defences in section 11.5. |
| 5 | Server-side headless browser (Playwright with Chromium on the server) running the same scroll-and-harvest script; can also make the PDF original. | Any | No. Never store the owner's provider cookies on the server. | Parity with the Apple capture for public share links only. Unverified on Replit (section 10.8). capture.md 8.3 specifies it as a job that is started with a `202` answer and then polled; on Autoscale that needs server work to continue while no request is open, which is check 3 in section 13.1. If it does not, run the capture inside one streamed request (framing of 9.3) or use a Reserved VM. |
| 6 | Android share target (section 5). | Android only | n/a | Delivers the link, text or file, not the page content. A shared link still needs route 1, 4 or 5. |
| 7 | Browser extension: a content script runs in the page the owner is signed in to, harvests it and posts to the vault. | Firefox for Android supports extensions [W29]; Chrome for Android unverified; Safari needs a native wrapper (unverified) | Yes | A second product: store or developer-mode install, host permissions, and a token-based API in the vault. Later phase. |
| 8 | Bookmarklet: a `javascript:` bookmark runs the harvest in the provider's page and hands the result to the vault (new window plus `postMessage`, the clipboard, or a download in the puller format). | Awkward (unverified) | Yes | CSP Level 3 says policy "SHOULD NOT interfere with the operation of user-agent features like addons, extensions, or bookmarklets" [W28], but real behaviour under a provider's policy is unverified. Fragile. Later phase, if at all. |
| 9 | `puller/pull_sessions.py` on a desktop computer, then route 2. It keeps the login in a browser profile on that computer (`puller/pull_sessions.py:34,223-241`). | No | Yes | Exists today; the repository README says it is not yet confirmed end to end (`README.md:11`). |

Recommended order: routes 1, 2 and 3 are the required baseline on every platform; route 6 feeds them on Android; route 4, then 5, only for public share links and only after the Replit checks in section 13.1; routes 7 and 8 are out of scope for the first version. Which provider hosts are accepted and how harvested text is cleaned is defined in capture.md.

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

These replace the Apple behaviour in A13, B1, B2 and B3. They state what the platform requires: an in-flight or interrupted turn must be representable on the server. The table for turns, the exact outcome rules and the refinements of rules 1, 3 and 4 (where the user's text lives until there is a reply, and which model label is stored) are in claude-api.md section C5; where that section differs from the rules below, it governs.

1. The browser creates a random `clientTurnId` (UUID) for each send and includes it in the body. The server stores the user message together with that id. A later request with the same id never creates a second user message: if the reply is already stored, the server answers with `done` at once; if the earlier attempt failed or was interrupted, it starts a new generation for the stored user message. This covers a retry after a response that never arrived.
2. One generation at a time per session: a request that arrives while one is running gets `409`. Enforce this with the stored turn state, not with process memory. While a generation runs, the server refreshes a timestamp on the turn every few seconds; a turn that still says "running" but whose timestamp is older than about a minute is treated as interrupted, because Autoscale instances "restart regularly by design" [R6].
3. The server inserts the user message, starts the Anthropic stream, relays text as `delta` events and accumulates the text itself.
4. On Anthropic's final event the server inserts the assistant message and updates the session's model name in one transaction, then sends `done` and ends the response. On an Anthropic error (HTTP error or an `error` event in the stream), or if the Anthropic stream ends without its final event (B1), it sends `error` and stores nothing as a complete reply.
5. Stop pressed: the page calls the explicit route `POST /api/sessions/<id>/stop` and the server cancels the Anthropic request. The page does not signal a stop by aborting its own request, because an abort and a dropped connection look the same to the server; it keeps reading until the terminal event arrives. What happens to the partial text is defined in claude-api.md C6 and C7.
6. Connection lost without Stop: recommended policy is to keep consuming the Anthropic stream and save the reply, so that the answer is there when the owner returns. Unverified on Replit Autoscale: whether the server keeps getting CPU after the client's request has ended. In Cloud Run's default request-based billing, instances are charged only while they process requests, start or shut down, and background work needs the other billing mode [W34]; Replit says of Autoscale: "You only pay for CPU and memory during request processing." [R16] Check it with the test in section 13.1. If work stops after the disconnect, either accept "interrupted, retry" or use a Reserved VM (owner decision).
7. The platform may also end a long request itself (section 9.2). The same recovery applies.

### 9.5 Browser-side rules

1. While streaming, show a Stop button (rule 5 in 9.4). The `AbortSignal` of `postSse` is only for leaving the page. The Apple placeholder between send and first token (`apple/SessionVault/Views/ContinueChatView.swift:117-123,153-162`) maps to the time between the response headers and the first `delta`.
2. On `visibilitychange` to visible, on `online`, and after an interrupted stream: ask the server for the state of the turn (claude-api.md C6 defines `GET /api/sessions/<id>/turn`) and reload the session. If the server has the complete assistant message, show it. If the turn is still running, show "still working" and poll every few seconds. If it is interrupted, offer a Retry action that sends the same `clientTurnId` again (9.4 rule 1).
3. Never mark a reply complete on the strength of the local stream alone; the `done` event carries the stored message.
4. Summarise uses the same transport. It may take minutes for a long transcript; the page can be left and the summary appears on the next fetch.

## 10. Replit as documented today (C)

Everything here is from docs.replit.com as fetched on 2026-11-19. Replit's documentation changed its structure during 2026; older tutorials may not match.

### 10.1 Two ways to bring a repository in

- Import the repository as a Project (import from GitHub) [R20]. A Project has the Project Editor tools described in 10.4 to 10.8: Secrets, Database, App Storage, Publishing, Shell.
- "Code with Replit" works on a connected repository in a cloud sandbox and proposes pull requests. It is described as early access, and "Your production hosting stays where it is" [R20].
- Inference: hosting the web app on Replit (assumption 1) needs a Project. Who does the building also matters: several integrations are set up only by Replit Agent (10.6, 10.7), not by another agent working in the Shell.

### 10.2 Configuration, packages and what persists

- Two hidden files configure a Project: `.replit` (TOML) and `replit.nix` [R13].
- `.replit` keys shown in the documentation: `run`, `entrypoint`, `modules` (for example `["nodejs-20"]`), `[nix] channel` and `packages`, `onBoot`, `[run.env]`, `[deployment] run`, `build`, `deploymentTarget`, `ignorePorts`, `[[ports]] localPort`, `externalPort`, `exposeLocalhost`, `[packager.features] guessImports`, `packageSearch`, `enabledForHosting` [R13].
- `replit.nix` lists system packages: `{ pkgs }: { deps = [ pkgs.<name> ]; }`; packages come from Nix, not from `apt` [R13].
- Language packages are installed from the Shell with `npm install` or `pnpm add`. On Run, Replit also "automatically analyzes your code for missing dependencies" and installs the latest version unless `packager.features.guessImports` is `false` [R13].
- Package Firewall is on by default and blocks installs of packages flagged as malicious or compromised for npm, yarn and pnpm [R18].
- `replit.md` in the project root is read by Replit Agent; in repository mode Replit also reads `AGENTS.md`, `CLAUDE.md` and skills under `.agents/skills` and `.claude/skills` [R20][R22].

Illustrative `.replit` fragment (keep the `modules` and `[nix]` lines the workspace generated; the values below are examples, not verified defaults):

```toml
run = "npm run dev"

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
| Files in the Project (workspace) | Yes. Versioned by Git; a file's earlier versions can be restored from its history; a deleted Project can be restored for a limited time | [R26] |
| Checkpoints | "created automatically by Agent"; they capture project files, installed packages, configuration and database contents; a rollback restores the development database only when that option is selected. Inference: a builder that is not Replit Agent gets no checkpoints and must rely on Git commits | [R10][R27] |
| Development database | Yes (10.5) | [R8] |
| Development URL | No: temporary, can change | [R12] |
| Filesystem of the published app | No: "resets every time you publish"; "Avoid saving and relying on data written to a published app's filesystem" | [R4][R5] |
| Anything outside the project directory in the workspace (home directory caches, global installs, `/tmp`) | Not documented on the pages read. Treat it as disposable | section 15 |

A file placed in the Project can end up in a checkpoint or commit. Replit's own export guide says to download and delete a database dump "right away, before Agent or a checkpoint saves it to your project history" [R10]. Never put real exports in the workspace.

### 10.3 Ports, addresses and the health check

- A process is reachable only through an external port. The first opened port is bound to external port 80. "Autoscale and Reserved VM deployments only support a single external port being exposed, and for the corresponding internal port not to be using `localhost`." [R13]
- The server must listen on `0.0.0.0`. If `[[ports]]` entries exist, automatic detection is off and one entry must have `externalPort = 80` [R5][R13].
- "Replit passes the correct port through the `PORT` environment variable" [R6].
- "Before marking your published app as live, Replit sends an HTTP request to your app. If your homepage takes more than five seconds to respond, the health check can time out and publishing can fail at the final step." [R5]
- Development URL: `UUID.servername.replit.dev`, "only live while you actively work", "can change each time you reopen the app", and "private by default": it requires a Replit sign-in unless "Private preview" is switched off. External access tokens can reach it for API traffic only: a single-page app loads its scripts "in follow-up requests that won't carry your token, so those requests fail" [R12].
- "The Preview tool renders the page inside the Project Editor", and offers "Open in a new tab" [R28]. Inference: the pane shows the app in a frame on a different site (the editor). With `frame-ancestors 'none'` (11.4) the app will not render there, and a `SameSite=Strict` cookie (11.2) is not sent from a cross-site frame, so sign-in cannot work inside the pane. Open the development URL in its own tab instead. Do not weaken the framing headers or the cookie to make the pane work.
- Predefined variables: `REPLIT_DEPLOYMENT` is `1` in a published app and unset otherwise; `REPLIT_DOMAINS` is a comma-separated list of the project's domains (republish after adding a custom domain to refresh it); `REPLIT_DEV_DOMAIN` exists only in the workspace [R11][R13][R14].
- The Public Suffix List (version 2026-11-19) contains `replit.app` and `*.replit.dev` [W50]. Each `name.replit.app` is therefore its own site: other customers' apps are cross-site for cookie purposes and cannot set cookies for a shared parent domain.

Consequences: one Node process serves the API and the built static files on one port, in development and in production. `GET /` returns the static shell without touching the database. Listen on `Number(process.env.PORT) || 5000` at `0.0.0.0`, and log the port at start-up. If the published app shows "Application failed to respond", compare the logged port with the `[[ports]]` entry (item 24 in section 15).

### 10.4 Secrets

- The Secrets tool stores values with "AES-256 encryption at rest" and exposes them as environment variables. "Configurations" in the same tool are for non-sensitive values [R11].
- Production: "To find secrets for your published project, open Publishing, select Adjust settings, and locate Production app secrets." Secrets are available to all deployment types except Static [R11].
- The documentation contradicts itself about whether development secrets reach production: "Secrets sync automatically from your development environment to your published app when you publish or republish" [R3] versus "Secrets you set in the Project Editor do not automatically carry over to your published app" [R5] and "Replit keeps development and production secrets in separate stores" [R6]. Always check Production app secrets by hand.
- Collaborators can read secret values, and a database export guide warns against saving a connection string "in Secrets, where collaborators and Agent can read it" [R10][R11].

### 10.5 Database

| Topic | Development database | Production database | Source |
|---|---|---|---|
| Created | With every Project | "when you publish", "provided your development database contains data" | [R8] |
| Engine and host | PostgreSQL 16 on Replit's own infrastructure ("Helium") since 2025-12-04 | Neon-hosted PostgreSQL (the docs speak of "the Neon production database" and of Neon archiving it after 24 hours without access) | [R8][R10] |
| Connection | `DATABASE_URL`, connected automatically, not shown in Secrets; "Only accessible from within your app; never exposed publicly"; no SSL ("The server does not support SSL connections" if SSL is forced) | A separate `DATABASE_URL` in the published app; SSL; reachable from external SQL clients with its connection string; no pooling by default (append `-pooler` to the host for a pooled connection) | [R8] |
| Cost and limits | Free, capped at 20 GiB | Billed for compute time and storage; suspends after 5 minutes idle; limit 100 GiB on paid plans, 1 GiB on Starter | [R8][R16] |
| Who can change it | The builder, Replit Agent | The published app; the owner through the Database tool ("Enable Editing"). Replit Agent "can read it through a read replica but can't change it" | [R8][R10] |
| Recovery | Rollback to an Agent checkpoint, up to 7 days | Point-in-time recovery, on by default with a 7-day window (6 hours to 7 days; 28 days on Pro and above); optional daily scheduled backups kept 7 days on Core | [R10] |
| Export | n/a | Per-table download (CSV, JSON, XLSX) in the Database tool; `pg_dump` from the Shell with the production connection string | [R10] |

Schema changes reach production only through Publish [R9]:

- During publishing Replit compares the schema of the development and production databases, generates SQL, asks about ambiguous changes (for example rename or new column), validates the SQL on a copy of production, and applies it "after your app builds and before the new version goes live". "It compares the databases themselves, not your schema file."
- Migrated: tables, columns, indexes, constraints, views, enums, sequences, row-level security policies. Not migrated: "Domains", "Functions, procedures, and triggers", "Grants"; roles only in a limited way. "Triggers and grants usually don't cause an error. Publishing succeeds, but your published app may behave differently from Preview."
- "your app's build command and startup code should never change the database schema. Don't add `drizzle-kit push`, `db:push`, or `CREATE TABLE IF NOT EXISTS` statements to the deployment build command or your server's entrypoint."
- Choosing "create new" for a real rename "is the most common way to lose production data during a publish".
- The tool behind the diff is drizzle-kit.

Consequences for the builder:

1. The development database is the source of the schema that Publish promotes. Either describe the schema with Drizzle ORM and apply it with `drizzle-kit push` from the Shell, or apply the SQL drafts (data-model.md 7.2, claude-api.md C5, section 11.2) to the development database with a script that runs only in the workspace. In both cases production is changed only by Publish: never migrate from the build command or at start-up. What the diff tool cannot represent may be lost on the way to production (check 4 in section 13.1).
2. Use no triggers, functions, procedures or domains. Maintain `updated_at` and any search column in application code, as data-model.md already specifies. Unverified: whether partial unique indexes (claude-api.md C5 uses one), GIN indexes, operator-class indexes, `CHECK` constraints with regular expressions and extensions survive the diff; read the generated SQL at the first publish (check 4 in section 13.1).
   - Extensions: data-model.md 7.2 drafts `CREATE EXTENSION pg_trgm` for two optional trigram indexes and says results stay correct without them. Start without the extension and without those indexes. If they are added later, the extension must exist in production before the publish that creates the index (inference: an index with `gin_trgm_ops` cannot be created otherwise); the owner would run `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the production SQL console first. Whether either database offers the extension is unverified.
3. Connection code must use SSL in production and no SSL in development. The documentation's example is `ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false` [R8]. Prefer keying on `REPLIT_DEPLOYMENT === "1"`, and try certificate verification (`ssl: true`) first; fall back to the documented setting only if verification fails (unverified which is needed).
4. Use one small pool per process (for example 5 connections). Do not connect at start-up; the first query after idle time has to wake the database.
5. The Publish step, including the review of the generated SQL, is done by the owner in Replit's interface. Write that review into the release checklist.
6. Real transcripts exist only in the production database. The development database holds synthetic data only. Never choose an option that copies development data to production or the reverse.

### 10.6 Authentication offered by the platform

- Access gate for the whole published app, no code: "Public", "Password protected" (a shared password, no Replit account needed), "Workspace only", "Invite only". "apps in your personal workspace default to Public". With the private options visitors "are prompted to sign in through Replit". "Changing access requires unpublishing your app first." [R2] A gated app gates every request, including script bundles [R12].
- Contradiction: another page says access controls are "Available only for Pro and Enterprise members" [R4].
- Replit Auth: visitors sign in with Replit accounts. "The only way to implement Replit Auth is by using Agent"; "Manual implementation is not supported" [R14].
- Clerk Auth: a Clerk tenant provisioned by Agent; the default when Agent adds sign-in on Starter, Core and Pro [R14].
- Recommendation in section 11.1: implement sign-in in the app; publish as Public.

### 10.7 App Storage (object storage)

- Backed by Google Cloud Storage; buckets "are always private"; no lifecycle rules, versioning or retention policies; JavaScript SDK `@replit/object-storage` (`import { Client } from "@replit/object-storage"`) or the Google Cloud Storage client [R15].
- A bucket belongs to one project and "lets you share data between the development and production environments of the same Replit App" [R15]. Code running in the workspace can therefore read objects written by the published app.
- Buckets are created in the App Storage tool or by Agent [R15].
- Decision asked for by data-model.md 7.2 ("Where to keep the bytes ... is a hosting decision for web-platform.md"): for the first version keep attachment bytes in PostgreSQL (`blobs.data`, type `bytea`), not in App Storage. Reasons: objects in App Storage are reachable from the workspace; a bucket has to be created through Replit's tool or by Agent, which the builder cannot do from the Shell; and with `bytea` one export and one point-in-time history cover everything. Costs: database storage is billed at a higher rate than App Storage (10.8), and bytes count towards point-in-time history. Rules: never select the `data` column in list or transcript queries; serve bytes only through the authenticated endpoint in 6.5; enforce data-model.md's per-object size limit; run check 9 in section 13.1 before relying on large uploads. Revisit if the stored originals grow beyond a few gigabytes.

### 10.8 Publishing, limits, headless Chromium

| Topic | Documented fact | Source |
|---|---|---|
| Deployment types | Autoscale (default; "scales to zero when idle"), Static (no backend), Reserved VM ("never sleeps"), Scheduled (runs a command on a schedule) | [R1] |
| Autoscale behaviour | Goes idle after 15 minutes of inactivity; first request after idle "can take a few seconds"; "restart regularly by design" (`SIGTERM`); "Max machines" caps scaling | [R3][R6][R16] |
| Filesystem | "The file system in published apps is not persistent and resets every time you publish." App size limit 8 GB for Autoscale and Reserved VM | [R4][R5] |
| Isolation and region | Published apps run in a single-tenant Google Cloud project per customer; geography is chosen at publish on Core and above and "is permanent" | [R4][R18] |
| Address | `<name>.replit.app`; custom domains need an `A` and a `TXT` record, the `TXT` record must stay, Cloudflare-proxied records are not supported; the `.replit.app` name can change after unpublish and republish | [R6][R21] |
| Releases | Publish again to update; deploy logs name the build id, deployment id and Git commit, and Replit adds a "Published your App" commit. "You are responsible for keeping track of your releases". Going back: one help page says to redeploy an earlier version from Publishing > History, another says "Replit no longer supports rolling a published app back to a previous version" and to restore the project state and publish again. Tag each released commit in Git. | [R3][R6][R26] |
| Logs | "Replit retains deployment logs for 30 days"; "Ask Agent to investigate, and it reads the logs for you" | [R7] |
| Plans | Starter: one published app that "will automatically go down after 30 days"; Core: unlimited published apps. SSH and Replit AI Integrations need a paid plan | [R16][R19][R23] |
| Prices (from 2026-08-01) | Autoscale: base fee of 1 or 2 USD per month (two pages disagree), 0.60 USD per million compute units, 0.40 USD per million requests. Reserved VM: 15 USD per month for 0.5 vCPU and 2 GB shared; 35 USD for 1 vCPU and 4 GB dedicated. Production database: 0.16 USD per compute hour, 0.35 USD per GiB-month. Prices change; read them again before deciding | [R16] |
| Resource limits | CPU, RAM and storage "determined by plan"; 20 concurrent apps; a limit on concurrent outgoing connections exists; no numbers on the docs pages read | [R17] |
| Cookie added by the platform | `GAESA`, a routing cookie from Google's serving infrastructure, without `Secure` or `HttpOnly`; the app cannot change it. Oversized request headers (many cookies) are rejected with `403` at the edge | [R6] |
| Analytics and add-ons | Default analytics use traffic data and show "Top Pages"; with "Enable analytics" Replit "adds the analytics tracker to your published app"; a feedback widget and, on Starter, a "Made with Replit" badge can be added to the app | [R3][R16][R24] |
| Shared responsibility | Replit: TLS, encryption of platform-stored data at rest, edge DDoS and WAF protection, backups of managed databases. You: sign-in, access control, application-layer encryption, logging, security testing | [R18] |
| Headless Chromium | Nothing in the official documentation. Replit Agent's own "App Testing" uses a browser, but that is not a facility for apps | [R25] |

Headless Chromium, what is known from other sources:

- Playwright officially supports Debian 12 and 13 and Ubuntu 22.04, 24.04 and 26.04 on Linux, and Node.js 22, 24 or 26 [W46]. Replit environments are configured through Nix (10.2).
- `npx playwright install --with-deps` installs operating-system packages; `--only-shell` downloads only the headless shell; browsers are cached in `~/.cache/ms-playwright` unless `PLAYWRIGHT_BROWSERS_PATH` is set; `PLAYWRIGHT_BROWSERS_PATH=0` puts them under `node_modules` [W46].
- On NixOS, browsers downloaded by Playwright "will not function due to missing dependencies"; the Nix package `playwright-driver.browsers` is used with `PLAYWRIGHT_BROWSERS_PATH`, and "the version of Playwright in Nixpkgs and your node developer environment ... must match" [W47] (community wiki, not an official Playwright or Replit source).
- A second community-reported route is a Chromium installed through Nix and handed to Playwright by path; the browser must fit the Playwright version. The puller already has an option for an external binary (`--browser-exe`, `puller/pull_sessions.py:208-212`).
- Machine size for a published app (CPU and memory) is set under Publishing > Adjust settings > Machine configuration [R3]. capture.md plans for about 1 GB of memory for the browser.
- Unverified for Replit: whether Chromium starts in the workspace, whether it starts in a deployment, how much memory the default machine has, and whether files under `~/.cache` are part of the published snapshot. Treat server-side capture as an optional feature behind check 6 in section 13.1.

### 10.9 Privacy consequences of the platform

1. Replit Agent can read the production database through a read replica, can read deployment logs, and can read Secrets (10.4, 10.5, 10.8). Whoever works in the workspace can read the development database and App Storage objects (10.7).
2. The platform records request paths ("Top Pages") [R24]. Keep private data out of URLs: use opaque ids in paths, never titles; carry shared links and text in a `POST` body or in a URL fragment (sections 5.3 and 5.4).
3. Leave "Enable analytics" and the feedback widget off for this app. They add third-party script to a private vault.
4. Real data enters only through the published app's own interface. The workspace, its database, its logs and its files hold synthetic data only.
5. Asking Replit Agent to investigate the production database or the deployment logs gives it whatever they contain. With plain-text storage that is the transcripts themselves (see 11.6 for field encryption).

### 10.10 Replit AI Integrations (alternative to an own Anthropic key)

Replit can supply Anthropic access with its own credentials, billed to Replit credits, set up by Agent, on Core and above. The model list on 2026-11-19 includes `claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4-5` but not `claude-fable-5-1` or `claude-fable-5`, which the Apple app offers (`apple/SessionVault/ClaudeAPI.swift:8-14`) [R19]. Assumption 2 (the owner's own key in Secrets) keeps the model list under the owner's control; claude-api.md covers the call.

## 11. Security baseline (C)

The vault holds private transcripts and is reachable from the internet. The Apple app has no server and no sign-in (A14), so everything here is new.

### 11.1 Sign-in for one owner

Options:

| Option | For | Against |
|---|---|---|
| 1. Sign-in implemented in the app (recommended) | Works the same on any host; testable by the builder; manifest, icons and service worker stay public so install and share target work | The builder must get it right |
| 2. Replit access gate ("Password protected" or a private option) with no app sign-in | No code | Unverified with PWA install, manifest fetch, service worker and share target; plan availability unclear (10.6); cannot be tested by the builder; ties the app to Replit; unknown session and rate-limit properties |
| 3. Replit Auth or Clerk | Managed accounts | Only Replit Agent can set them up (10.6); built for many users, not one owner |
| 4. Sign-in with an external identity provider, restricted to one account id | Password and second factor handled elsewhere | Needs an OAuth client registered for the final address; redirect flows inside installed apps need testing |

Design for option 1:

- No registration route and no first-run setup page. A setup page that lets the first visitor claim the instance is a known failure. Credentials are configured out of band as secrets; if they are missing the app refuses every sign-in.
- Passphrase: generated, long (for example 5 or more random words or 20 or more random characters). Only its hash is stored, in a secret (proposed name `OWNER_PASSWORD_HASH`), produced by a script that reads the passphrase without echo. Hash with Argon2id at or above the OWASP minimum (19 MiB memory, 2 iterations, parallelism 1) or scrypt with N=2^17, r=8, p=1 [W37]. Node has both built in: `crypto.argon2('argon2id', { message, nonce, parallelism: 1, tagLength: 32, memory: 19456, passes: 2 }, cb)` since Node 24.7.0, and `crypto.scrypt`, whose `maxmem` default of `32 * 1024 * 1024` must be raised because "It is an error when (approximately) `128 * N * r > maxmem`" (N=2^17, r=8 needs 128 MiB) [W40]. Compare with `crypto.timingSafeEqual`. Run one verification at a time.
- Second factor: support a TOTP code (secret in `OWNER_TOTP_SECRET`, accept the current step plus or minus one, refuse a step that was already used). Whether it is required is the owner's decision. Passkeys are possible later; a credential is bound to its relying-party id, which "needs to equal the origin's effective domain, or a domain suffix thereof" [W39], and `replit.app` is a public suffix (10.3), so passkeys are tied to the exact host name and break if it changes.
- Losing the passphrase is recoverable: the owner sets a new hash in Production app secrets and publishes again.

### 11.2 Session cookie

- On successful sign-in create 32 random bytes with `crypto.randomBytes`, send them base64url-encoded as the cookie value, and store only the SHA-256 of the value in a server-side table with `created_at`, `last_seen_at`, `expires_at` and a device label. OWASP: at least 64 bits of entropy from a CSPRNG, the id "must simply be an identifier on the client side", renew it "after any privilege level change" [W37].
- Cookie: `Set-Cookie: __Host-sv_session=<value>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`. A `__Host-` cookie must be `Secure`, must have `Path=/` and must not have `Domain`, which "guarantees that such cookies are only sent to the host that set them" [W38]. OWASP recommends `SameSite=Strict` or `Lax`, `HttpOnly`, and the `__Host-` prefix [W37].
- `SameSite=Strict` costs nothing here: the HTML shell is public and static, and every authenticated request is a same-origin `fetch` or a navigation started by the app's own pages.
- Lifetime: OWASP's examples (idle timeouts of minutes, absolute timeouts of hours) are for shared workplaces [W37]. For a personal vault on the owner's own devices this document proposes a sliding 30 days and an absolute 90 days, a visible list of active sessions with "sign out everywhere", and a fresh passphrase check (within the last 10 minutes) before whole-vault export and bulk delete. The durations are the owner's call.
- Sign-out: delete the server-side row, expire the cookie, send `Clear-Site-Data: "cache", "storage"` (Chrome 61+, Firefox 63+, Safari 17+ [W8]), and delete the app's IndexedDB databases from script as well.
- Behind Replit's proxy the Node process sees plain HTTP. With Express, set `trust proxy` so that `req.protocol` reflects `X-Forwarded-Proto`; prefer a hop count over `true`, because with `true` "the client's IP address is understood as the left-most entry in the `X-Forwarded-For` header", which a client can forge unless the proxy overwrites it [W41]. Unverified: the number of proxy hops on Replit.
- Tests over `http://localhost`: Safari does not send `Secure` cookies to `http://localhost` [W8], and prefix rules on plain HTTP are unverified. Make the cookie name and the `Secure` flag configurable for the test environment only.

Tables for sign-in (proposal; data-model.md 7.2 leaves sign-in storage to this document and defines `owners`):

```sql
-- One row per signed-in browser. The cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE auth_sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- shown in the session list, used to end one session
    token_sha256  text NOT NULL UNIQUE,             -- 64 lower-case hex characters; never sent to the browser
    owner_id      uuid NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,             -- sliding; never later than created_at + the absolute limit
    reauth_at     timestamptz NOT NULL DEFAULT now(), -- last passphrase check, for the fresh-check rule
    device_label  text NOT NULL DEFAULT ''          -- short text derived from the User-Agent, for the session list
);
CREATE INDEX auth_sessions_owner_idx ON auth_sessions (owner_id, last_seen_at);

-- Sign-in attempts, for rate limiting (11.5). No passphrase, no code, no raw client address.
CREATE TABLE auth_attempts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    client_key   text NOT NULL,                     -- keyed hash of the client address
    succeeded    boolean NOT NULL
);
CREATE INDEX auth_attempts_time_idx ON auth_attempts (occurred_at);
```

- The single `owners` row is inserted on the first successful sign-in if the table is empty; this version never creates a second one. Every data row carries that `owner_id` (data-model.md).
- If TOTP is used, add `totp_last_step bigint NOT NULL DEFAULT 0` to `owners` and reject any code whose time step is not greater than it.
- Delete expired `auth_sessions` rows and `auth_attempts` rows older than a day during sign-in; no scheduled job is needed.
- These tables are created like all others: through the schema in the development database and the Publish diff (10.5), never at start-up.

### 11.3 Cross-site request forgery

- State changes only through `POST`, `PUT`, `PATCH`, `DELETE`. "Do not use GET requests for state changing operations." [W37]
- For every state-changing request the server requires `Sec-Fetch-Site: same-origin` (Chrome 76+, Firefox 90+, Safari 16.4+ [W8]). If the header is absent it requires an `Origin` header equal to one of the app's own origins (from `REPLIT_DOMAINS` or a configured value). If neither check passes, reject. OWASP: "a fallback to standard origin verification headers is a mandatory requirement for any Fetch Metadata implementation", and when no header establishes the origin, "reject" [W37]. Require `same-origin`, not `same-site`.
- API requests carry JSON and a fixed custom header (proposed `X-Requested-With: sessionvault-web`); "requests with custom headers are automatically subject to the same-origin policy" [W37]. The server sends no CORS headers at all.
- The sign-in request gets the same checks.
- "Cross-Site Scripting (XSS) can defeat all CSRF mitigation techniques" [W37]; section 11.4 is the more important defence.

### 11.4 Content security policy and rendering untrusted text

Transcripts are untrusted input: they come from web pages, from model output and from imported files.

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
- `connect-src 'self'`: the browser talks only to the vault's own origin. Under assumption 2 it never contacts `api.anthropic.com`.
- The Vite development server uses inline scripts and injected styles, so the policy cannot be enforced in development mode. Run the automated browser tests against the production build served by the Node server.
- Rendering: put transcript text into React text nodes. Never use `dangerouslySetInnerHTML` with it. If a Markdown library is used, raw HTML must stay disabled and link targets must be limited to `http:`, `https:` and `mailto:`. The Apple renderer supports only inline Markdown and fenced code blocks (`apple/SessionVault/Views/MessageView.swift:46-94,116-123`), which a small custom renderer without HTML can match; design.md and import-rules.md own the details.
- Do not load remote images that appear in transcripts. `img-src 'self'` blocks them; this also prevents an imported transcript from revealing when and from where it is read.
- Links out of the vault: `rel="noopener noreferrer"` and `target="_blank"`; apply rule B5 to `sourceURL`.
- Serve stored files (PDF originals, exports) only with a fixed, non-script content type and `nosniff` (section 6.5).
- `robots.txt` with `Disallow: /` in addition to the header.
- Caching: `Cache-Control: no-store` on every `/api/` response; `no-cache` on `index.html`, `sw.js` and the manifest; long-lived `immutable` caching only for content-hashed static assets.
- Inference: the service worker serves the precached shell with the response headers it had when it was cached, so a change to these headers reaches installed clients only with a build that changes `index.html`. Decide the headers before the first release.

### 11.5 Server-side requests, limits and abuse

- Server-side capture (section 8, routes 4 and 5) fetches a URL chosen by the user. Use an allow-list of provider host names (defined in capture.md), accept only `http:` and `https:`, and "disable the support for redirection in the web client", or re-check every redirect target against the list. OWASP: "Deny-lists are bypass-prone. Prefer allow-lists." Never allow loopback, RFC 1918, link-local or cloud metadata addresses such as `169.254.169.254` [W37].
- Rate limits (suggested starting values): sign-in, 5 failures per 15 minutes per client address plus a global slow-down after 50 failures per hour; capture, one at a time and a daily cap; Claude calls, one generation per session at a time and a configurable daily cap, since a stolen session could otherwise spend the Anthropic budget.
- Keep limiter state in Postgres, not in process memory. Autoscale instances restart and scale to zero (10.8), which would reset in-memory counters. Set "Max machines" to 1 for a single-owner app.
- Body size: server frameworks ship with small default limits for JSON bodies, so a long transcript is rejected unless the limit is raised. Give the import endpoints an explicit, higher limit and upload one session per request. Unverified: the platform's own request size limit (check 9 in section 13.1).
- Validate every imported document, including the interchange format, against a schema with size limits before storing it.

### 11.6 Encryption at rest

| Option | Protects against | Does not protect against | Cost |
|---|---|---|---|
| 1. Platform encryption only (Replit lists "encryption of platform-stored data" as its responsibility [R18]) | Loss of storage media | Anyone with access to the database: the owner's Replit account, collaborators, Replit Agent's read replica, a leaked connection string, exports and backups | None |
| 2. Field encryption in the server: AES-256-GCM for message text and every other column that holds transcript text (including the text columns of the turn table in claude-api.md C5 and, if wanted, attachment bytes), with a key in production secrets (proposed `VAULT_DATA_KEY`), a random 96-bit nonce per value, the row id as associated data, and a key id column for rotation. Title, summary, tags and the `search_text` column of data-model.md stay in plain text so that its SQL search keeps working | Database browsing, the Agent read replica, exports, backups, point-in-time history, a leaked connection string, as far as the encrypted columns go | A compromised app server; whoever can read production secrets; titles, summaries and tags | No SQL search over message text: the optional transcript search of data-model.md 7.5 would have to decrypt and scan in the application (acceptable for one owner's data volume; the Apple app searches only title, summary and tags, `apple/SessionVault/Views/SessionListView.swift:27-34`). Losing the key loses the transcripts, so the key must be backed up outside Replit |
| 3. End-to-end encryption in the browser (key derived from a passphrase with Web Crypto; the server stores ciphertext) | Everything on the server side at rest | The server still sees plain text in memory for every Claude call under assumption 2 | High: key entry on every device, no server-side capture or search, loss of passphrase loses the vault |

Recommendation: decide between options 1 and 2 before the schema is fixed (open question). Whichever is chosen, read and write the text columns through one small codec module so that option 2 can be added or rotated without touching the rest of the code. Option 3 is not recommended for the first version.

### 11.7 Backup and export

- The app needs a whole-vault export in the versioned interchange format (data-model.md), produced by the server as a streamed download, behind the fresh-passphrase check. It is the only backup that leaves the platform, and it is also the bridge to the Apple app (assumption 4).
- Import of that file must be idempotent so that a restore or a repeated import does not duplicate sessions (data-model.md).
- Platform recovery (10.5) covers mistakes inside a 7-day window only and lives in the same account as the data. Switch on scheduled backups as well on Core.
- Show the date of the last export in the app. Automating off-platform backups can come later.
- Unverified: what happens to the production database when a Starter-plan app expires after 30 days. A durable vault needs Core.

### 11.8 Logging hygiene

Never write to any log, error message, analytics event or URL: transcript text, titles, summaries, tags, shared links or texts, request or response bodies, query strings, cookies, `Authorization` headers, the Anthropic key, `DATABASE_URL`, passphrases, TOTP codes, session tokens, or payloads sent to or received from Anthropic. OWASP lists session identifiers, access tokens, passwords, database connection strings, encryption keys and sensitive personal data among data to exclude [W37].

Log instead: time, method, route template (for example `/api/sessions/:id`), status, duration, a request id, counts and byte sizes, and the error class and message of the app's own errors. Log sign-in successes and failures and rejected requests [W37].

Why it matters on this host: deployment logs are kept for 30 days and Replit Agent reads them on request (10.8).

Typical leaks to remove:

- HTTP request loggers that print the full URL with its query string.
- `console.error(err)` where the error object carries user input or an upstream response.
- ORM or driver query logging that prints parameters.
- SDK debug logging (the Anthropic SDKs log requests when their debug environment variable is set); never enable it in production.
- Error responses that echo input or stack traces to the client. Return a generic message and the request id.
- Third-party error trackers or analytics in the page. `connect-src 'self'` blocks them; do not add them.

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

Each check is small, uses synthetic data, and decides a design question that the documentation leaves open. Record the results in the repository.

| # | Question | How to check | If the answer is bad |
|---|---|---|---|
| 1 | Does the published proxy pass a stream through unbuffered? | A signed-in-only endpoint that writes one frame per second for 30 seconds; watch arrival times in the browser on the published address | Try without compression and with `X-Accel-Buffering: no`; if still buffered, fall back to polling a stored turn |
| 2 | How long may one request last? | The same endpoint for 10 minutes with 15-second heartbeats | Rely on the stored-turn recovery in 9.4 and 9.5; keep answers shorter or resumable |
| 3 | Does server work continue after the client disconnects on Autoscale? | Start a 2-minute timer job that writes a row at the end; close the tab after 5 seconds; look for the row | Use "interrupted, retry", or ask the owner about a Reserved VM |
| 4 | Does the publish diff keep the schema features in use (partial unique indexes, GIN and operator-class indexes, `CHECK` constraints, index sort order, any extension)? | Read the SQL shown at the first publish and compare it with the development schema | Replace the feature with application code (for the partial unique index, claude-api.md C5 names the fallback) |
| 5 | Does the app install and receive a share on the owner's Android phone at the published address? | Owner test: install from Chrome, share a link from another app, share a text file | Fix the manifest or the service worker; remember that manifest changes arrive late (4.1) |
| 6 | Does headless Chromium start in the workspace, and in a deployment? | `npx playwright install chromium --only-shell`, launch, open `about:blank`; then the same behind a signed-in-only endpoint in the published app | Add Nix packages as in [W47] and retry; if it still fails, ship without server-side browser capture |
| 7 | Which sharing options and which production secrets does the owner's plan actually show? | Owner looks at the Publishing tool | Follow 11.1 option 1 regardless |
| 8 | Does TLS verification to the production database succeed with `ssl: true`? | Connect once from the published app and log only success or the error class | Use the documented `rejectUnauthorized: false` |
| 9 | How large may one request body and one response be through the published proxy? | Upload and download synthetic bodies of 1, 10 and 40 MB through a signed-in-only endpoint | Split uploads (one session or one attachment per request, large attachments in parts) and stream downloads |

### 13.2 Build rules

Hosting and process:

1. One Node process on one port (`Number(process.env.PORT) || 5000`, address `0.0.0.0`) serves the API and the built single-page app. In development, mount the Vite development server as middleware in the same process (`server.middlewareMode` [W43]) so that API, cookies and origin are identical to production.
2. Vite refuses requests for unknown host names; add the development host suffix to `server.allowedHosts` (a leading dot allows subdomains, for example `.replit.dev`) rather than setting it to `true` [W43].
3. `GET /` serves the static shell and never waits for the database (5-second health check). Every other `GET` path that is not under `/api/` and not a static file also returns the shell, so that deep links such as `/import` work without the service worker; unknown `/api/` paths return a JSON `404`, never the shell.
4. Nothing is written to the local filesystem at run time. Data goes to Postgres (and App Storage only if data-model.md says so).
5. Schema changes are applied to the development database only and reach production through Publish; no triggers, functions or start-up migrations (10.5).
6. Database SSL on when `REPLIT_DEPLOYMENT === "1"`, off otherwise.
7. Set `guessImports = false`; commit the lock file; do not work around Package Firewall blocks.
8. Use Node 22 or newer if Playwright is used [W46]; the Anthropic TypeScript SDK needs Node 20 or newer [W36]. Unverified: which Node versions the workspace offers.

Page and service worker:

9. Manifest, icons and head tags as in 4.3. Hand-written service worker with the `injectManifest` strategy [W44]; it precaches the shell, handles `POST /share-target`, and leaves `/api/` alone.
10. Import screen with three inputs that work everywhere: paste field, file picker, and (desktop) window-wide drop. The clipboard button and the share target are enhancements on top.
11. All stream reading through `getReader()`; one terminal event; idempotent sends (section 9).
12. Offline: shell only by default; opt-in data cache; read-only (section 7.3).
13. Feature-detect every optional API (`navigator.share`, `navigator.clipboard`, `beforeinstallprompt`, `navigator.storage`) and keep a path that works without it.

Security:

14. Sign-in, cookie, CSRF checks, headers and rendering rules exactly as in section 11. No registration route.
15. No private data in URLs or logs (10.9, 11.8). Opaque ids in paths.
16. The workspace never holds real transcripts. Tests and fixtures are synthetic.
17. Redirect every non-canonical host name to the canonical origin once the owner has chosen it.

Testing:

18. Parser unit tests run in Node against golden files (import-rules.md).
19. Browser tests run against the production build with the CSP enforced: sign-in, import by paste and by file, a simulated share (`multipart/form-data` post to `/share-target`), a stream that ends normally, a stream cut by the server in mid-answer, and a duplicate send with the same `clientTurnId`. They address the server at `http://localhost:<port>` inside the workspace; the development URL requires a Replit sign-in (10.3). If Chromium does not start in the workspace (check 6 in 13.1), run the same tests in a continuous-integration job on Ubuntu, which Playwright supports [W46], with synthetic data and test-only credentials.
20. The Apple launch arguments (A15) have no web equivalent in production. Any test-only route must be disabled when `REPLIT_DEPLOYMENT === "1"`.

### 13.3 Steps only the owner can do

The builder cannot perform these from the Shell; put them in a release checklist.

1. Import the repository as a Replit Project and choose the plan (Core or above for a durable published app).
2. Set production secrets: the Anthropic key, the passphrase hash, the TOTP secret if used, the data key if field encryption is chosen. Check "Production app secrets" by hand (10.4).
3. First publish: deployment type (Autoscale with "Max machines" 1 to start), geography (permanent), access "Public", analytics off, feedback widget off, badge off. Read the generated database SQL before approving.
4. Decide the address (custom domain or `*.replit.app`) before installing on phones.
5. Install on each device, sign in, run check 5 in 13.1.
6. Switch on scheduled backups; make a first export and store it outside Replit.

### 13.4 HTTP API conventions, route map and limits

The other handoff documents leave routing and request limits to this document (data-model.md 7.4, capture.md 8.3). Paths below are proposals. Request and response bodies, and the behaviour of a flow, are defined by the document named in the last column.

Conventions:

1. Everything the page calls is under `/api/` on the same origin. The browser contacts no other origin.
2. Requests are JSON with `Content-Type: application/json` and the fixed header of 11.3. Exceptions: raw binary uploads of attachments and the share-target form. Responses are JSON with `Cache-Control: no-store`. Exceptions: event streams (9.3) and file downloads (6.5).
3. Every `/api/` route requires the session cookie, except `POST /api/auth/login` and `GET /api/auth/session`. Without a valid session the answer is `401` with code `not_signed_in`; the page shows sign-in and keeps unsent input.
4. Errors have one shape on every route, the one claude-api.md C6 uses: `{"error": {"code": "...", "message": "...", "retryable": false}}`, optionally with `retryAfterSeconds` and `details`. `code` is stable and machine-readable. `message` never echoes input. Unexpected failures answer `500` with code `internal` and a request id that is also logged.
5. Status codes: `400` validation, `401` not signed in, `403` failed cross-site check (11.3), `404` unknown id, `409` conflict or busy, `413` body too large, `429` rate limited with a `Retry-After` header; `5xx` codes as the owning document defines them.
6. Identifiers in paths are UUIDs, or the SHA-256 of an attachment. Titles, tags, search text and shared links never appear in a path or a query string (10.9); they travel in request bodies. Query strings carry only ids, positions, counts and fixed keywords.
7. `GET` never changes state (11.3).
8. Every request that is not a stream has a server-side deadline (suggested: 30 seconds). Longer work is a stream (9.3) or a polled job (see check 3 in 13.1 before relying on jobs).

Route map:

| Route | Purpose | Defined in |
|---|---|---|
| `GET /manifest.webmanifest`, `GET /sw.js`, `GET /icons/...`, `GET /robots.txt` | Public static files | 4.3, 7.3, 11.4 |
| `GET` any other path outside `/api/` | The application shell | 13.2 rule 3 |
| `POST /share-target` | Share target: service worker, with a server fallback | 5.3, capture.md 8.2 |
| `POST /api/auth/login` | Body `{"passphrase", "totp"}` (`totp` only when enabled). `204` with the cookie, `401 invalid_credentials`, or `429` | 11.1, 11.2 |
| `POST /api/auth/logout` | Ends this browser's session | 11.2 |
| `GET /api/auth/session` | `200 {"expiresAt", "reauthAt"}` or `401` | 11.2 |
| `POST /api/auth/reauth` | Fresh passphrase check; updates `reauth_at` | 11.2 |
| `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `DELETE /api/auth/sessions` | List signed-in browsers, end one, end all others | 11.2 |
| `POST /api/sessions/query` | List or timeline; filter and search text in the body | data-model.md 7.3 |
| `GET /api/sidebar` | Counts, projects, tags | data-model.md 7.3 |
| `POST /api/sessions` | Create one session from a parser result | data-model.md 8.6, import-rules.md |
| `GET`, `PATCH`, `DELETE /api/sessions/:id` | Read fields, edit fields, delete | data-model.md |
| `GET /api/sessions/:id/messages?after=<position>` | One page of the transcript | data-model.md 7.3, 7.4 |
| `GET`, `POST /api/projects`; `PATCH`, `DELETE /api/projects/:id` | Projects | data-model.md |
| `GET /api/sessions/:id/attachments/:sha256` | Attachment bytes (6.5) | data-model.md 6.4 |
| `PUT /api/blobs/:sha256` | Upload attachment bytes as a raw body; the server checks length and hash | data-model.md 6.4, 6.7 |
| `POST /api/import` | Merge one interchange document; the page splits a vault file into one document per session | data-model.md 6.7 |
| `GET /api/export` with `scope=vault`, or `scope=session` and `id=<uuid>` | Streamed interchange export; vault scope needs the fresh passphrase check | data-model.md 6.8, section 11.7 |
| `GET /api/claude/config`; `POST /api/sessions/:id/continue`, `/summarize`, `/stop`; `GET /api/sessions/:id/turn` | Claude | claude-api.md C6 |
| `POST /api/captures`; `GET`, `DELETE /api/captures/:id` | Server-side capture, if it is built | capture.md 8.3 |

Limits (suggested; lower them to what check 9 in 13.1 measures, minus a margin):

| Request | Limit |
|---|---|
| Ordinary JSON bodies | 256 kB |
| Claude routes | 512 kB (claude-api.md C9) |
| `POST /api/sessions`, `POST /api/import` | 32 MB; one session per request |
| `PUT /api/blobs/:sha256` | The per-object limit of data-model.md 7.2; upload in parts if the platform allows less |
| Share-target form | capture.md 8.2 |
| Transcript page | A page ends once the sum of `text_bytes` passes 1 MB (data-model.md 7.4) |
| Sign-in attempts, capture, Claude calls | 11.5, capture.md 8.3, claude-api.md C9 |

## 14. If instead ...

- If instead the vault lived only in the browser (IndexedDB, no server vault; alternative to assumption 1): browser storage becomes the only copy, so eviction, the Safari seven-day rule, a cleared browser or an uninstalled app lose data (section 7.1); there is no copy shared between devices, and on iOS not even between Safari and the installed app; `navigator.storage.persist()`, a storage meter and insistent export reminders become mandatory; the share target can write straight into IndexedDB from the service worker; sign-in, sessions and CSRF defences disappear, but a server is still needed for the Claude proxy unless assumption 2 also changes; a Static deployment would be enough only if both assumptions change.
- If instead the Anthropic key were a bring-your-own key kept in the browser (alternative to assumption 2): the browser calls `https://api.anthropic.com` directly, so `connect-src` must list it; the Anthropic TypeScript SDK refuses to run in a browser unless `dangerouslyAllowBrowser` is set, and describes the default as protection against "exposing your secret API credentials" [W36]; the key is readable by any script in the origin and by anyone with the device, and cannot be an `HttpOnly` cookie; the stream no longer passes the hosting proxy, but nothing persists a reply when the tab is suspended, so B1 and B2 return; server-side rate limits and spend caps do not apply. Whether Anthropic's API accepts cross-origin browser requests, and with which headers, is covered in claude-api.md and was not verified here.
- If instead a different stack were chosen (alternative to assumption 3): nothing in sections 4 to 9 and 11 depends on React. Frameworks that render on the server change where the manifest, the service worker and the streaming route are defined, and Replit's publish-time database diff still expects the development database to hold the schema (10.5).
- If instead the Apple app were retired (alternative to assumption 4): the interchange format is still needed as the export and backup format (11.7), and iOS loses its only share-sheet capture path (5.4).
- If instead a Reserved VM were used: scale-to-zero, cold starts and the open questions about work after a disconnect go away (10.8, 9.4), at a fixed monthly price.

## 15. Unverified

Could not be confirmed from an official source on 2026-11-19. Each item names where it matters.

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
17. Headless Chromium in the workspace and in deployments; memory of the default machine; whether `~/.cache` is part of a published snapshot (10.8).
18. PWA install, manifest fetch, service worker and share target behind "Password protected" or private access, and behind the private development URL (10.3, 10.6).
19. Which access options exist on Core; the two documentation pages disagree (10.6).
20. Whether development secrets are copied to production automatically; the pages disagree (10.4).
21. What persists in the workspace outside the project directory (global installs, caches, `/tmp`). The pages read cover only project files, checkpoints and the development database.
22. Whether partial unique indexes, GIN and operator-class indexes, `CHECK` constraints with regular expressions and extensions pass the publish-time diff, and whether either database offers `pg_trgm` (10.5).
23. The exact meaning of "provided your development database contains data" for the automatic creation of the production database (10.5).
24. Whether `PORT` is set, and to what, in a deployment when `[[ports]]` is present (10.3).
25. Whether the production database's certificate verifies with Node's default trust store (10.5).
26. Number of proxy hops and handling of `X-Forwarded-For` (11.2); whether the platform already sends HSTS; the platform's request body size limit (11.5).
27. How the analytics tracker, feedback widget and badge are inserted into pages and how they interact with a strict CSP (10.8). Recommended setting is off.
28. Default visibility of a personal Project's files (public or private). One help page says a project's privacy can be set to public so that "anyone with the link can view it". Confirm that the Project is private.
29. Which Node versions and `modules` names the workspace offers (10.2).
30. What happens to the production database when a Starter-plan published app expires (11.7).
31. That the Preview pane embeds the app as a cross-site frame (10.3). The documentation says only that it "renders the page inside the Project Editor".

## 16. Sources

All checked on 2026-11-19 unless an entry says otherwise. Page dates are given where the page shows one.

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

Replit (https://docs.replit.com/ followed by the path; each page is also available as Markdown by appending `.md`):

- [R1] `features/publishing/deployment-types`
- [R2] `features/publishing/private-deployments` ("Who can access your app")
- [R3] `features/publishing/overview`, `features/publishing/after-you-publish`, `features/publishing/machine-configuration`
- [R4] `learn/projects-and-artifacts/replit-deployments`
- [R5] `build/troubleshooting` ("Troubleshoot publishing")
- [R6] `help/deployment-and-publishing`, `help/networking-and-app-errors`
- [R7] `features/publishing/monitoring-a-deployment`
- [R8] `features/data-and-storage/sql-database`, `features/data-and-storage/development-and-production`, `features/data-and-storage/connection-details`
- [R9] `features/data-and-storage/publish-database-changes`, `help/troubleshooting/databases`
- [R10] `features/data-and-storage/data-recovery`, `features/data-and-storage/work-with-your-data`
- [R11] `core-concepts/project-editor/app-setup/secrets`
- [R12] `core-concepts/project-editor/app-setup/development-urls`, `features/deployment-customization/external-access-tokens`
- [R13] `features/project-setup/configuration`, `features/project-setup/dependency-management`, `features/project-setup/ports`
- [R14] `features/auth-and-identity/overview`, `features/auth-and-identity/authentication`, `learn/projects-and-artifacts/auth`
- [R15] `features/data-and-storage/object-storage`, `features/sdks/object-storage-javascript-sdk`
- [R16] `billing/plans/starter-plan`, `billing/plans/replit-core`, `billing/deployment-pricing`, `billing/about-usage-based-billing`, `billing/aug-cloud-billing-updates`
- [R17] `legal-and-security-info/usage`
- [R18] `features/security/shared-responsibility-model`, `features/security/package-firewall`, `features/security/geography`
- [R19] `features/integrations/replit-ai-integrations`
- [R20] `build/code/code-with-replit`, `build/code/working-with-code`, `build/import-from-providers`
- [R21] `features/publishing/custom-domains`
- [R22] `features/project-setup/replit-dot-md`
- [R23] `features/workspace-tools/shell`, `features/workspace-tools/ssh`
- [R24] `features/publishing/project-analytics`
- [R25] `features/agent/app-testing`
- [R26] `help/projects-and-files`
- [R27] `features/version-control/checkpoints-and-rollbacks`
- [R28] `features/editor/preview`
