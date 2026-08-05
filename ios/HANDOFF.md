# Handoff: Mac-side build & polish for Session Capture

This briefing is for the Claude Code CLI running on the owner's Mac, which
has Xcode and simulators this cloud session does not. The repo is the
source of truth; design and capture-engine work happens here, build/test/
submission happens on the Mac.

## FIRST RULE — report through the repo, not the terminal

Terminal sessions on the Mac get closed and lose everything. Your findings
must survive that, so as you work, and ALWAYS before you finish:

1. Write `ios/BUILD_REPORT.md` with: build result (clean/errors), every
   change you made and why, each test-checklist item as PASS/FAIL with
   one line of detail, and anything the cloud session must fix.
2. `git add -A && git commit -m "Mac build report + fixes" && git push`
   on this same branch.

Push even a partial report if you hit a blocker — a pushed failure is
worth infinitely more than a lost success. The cloud-side architect reads
this branch and will fix anything you flag at the source.

## State of the project

- `ios/SessionCapture.xcodeproj` — complete SwiftUI app, iOS 16+, no
  external dependencies. The pbxproj and shared scheme were authored by
  hand off-Mac: if Xcode refuses to open the project or the scheme doesn't
  appear, that's the first thing to fix (recreating the project file in
  Xcode and re-adding the 8 sources + assets + PrivacyInfo.xcprivacy is an
  acceptable repair — keep the file contents).
- The capture JavaScript in `CaptureEngine.swift` is tested against mock
  pages in Chromium: the Claude virtualized path (40 turns + images in
  order), and the multi-model static-page paths — ChatGPT
  (`data-message-author-role`), Gemini (`user-query`/`model-response`),
  and generic articles — all returning turns with correct roles in
  document order. Treat the script as known-good; if capture misbehaves
  on-device the suspect is the WKWebView integration, not the logic.
- REAL-PAGE TUNING (do this on the Mac): the vendor selectors are based
  on public markup as of authoring and WILL drift. Test against actual
  public share links (the two in `links.txt`, plus a real ChatGPT and
  Gemini share). If a vendor's turns come back as one blob or with wrong
  roles, update `SELECTOR_SETS` in `CaptureEngine.swift` — the fix is a
  CSS selector change, self-contained, and safe to iterate on. Add new
  vendors by appending a selector set.
- Swift sources have NOT been compiled yet (no Swift/iOS toolchain in the
  cloud environment). Expect the possibility of small compile errors —
  fix trivial ones (typos, API signature mismatches) directly and note
  what changed; bounce anything structural back.

## Two files need on-device verification

Everything else was tested in Chromium; these two could not be (no iOS
toolchain in the authoring environment):

- `PdfExporter.swift` — renders the session HTML to PDF via an offscreen
  WKWebView + `createPDF`. Confirm the PDF paginates the FULL transcript
  (not just the first screen) and that embedded images appear. If long
  sessions clip, set the web view frame height to the content height
  before `createPDF`, or page through with `WKPDFConfiguration.rect`.
- `Summarizer.swift` — Apple Foundation Models (on-device, optional). It's
  wrapped in `#if canImport(FoundationModels)`, so the app builds with or
  without the framework; when absent, `Summarizer.isAvailable` is false and
  the AI menu is hidden. VERIFY the symbol names against the SDK you build
  against (`SystemLanguageModel.default.availability`, `LanguageModelSession`,
  `session.respond(to:)`, `response.content`) and the `iOS 26.0` availability
  floor. Adjust only this file if they differ — nothing else depends on it.

## Build steps

1. `git checkout claude/per-chat-attachment-fix-t5pumx` (or `main` once merged).
2. Open `ios/SessionCapture.xcodeproj`, select your team under Signing &
   Capabilities. Bundle ID `com.melodydashora.SessionCapture`.
3. Build & run on an iPhone simulator.

## Test checklist (in the simulator)

1. Browser tab shows the paste-a-link hint on first launch; pasting a
   PUBLIC share link loads it with no sign-in required.
2. Paste a session/share link (paste button next to the URL field), tap
   Capture — expect a "Saved N turn groups" alert.
3. Test with the links in `links.txt` at the repo root (a Gemini share and
   a Claude share), plus a real public ChatGPT share link — confirm turns
   come back with correct You/Assistant roles. Tune SELECTOR_SETS if not.
4. Library: session appears under Inbox; context menu → Move to Project →
   New Project works; swipe-to-delete works.
5. Detail view: turn cards render, images display inline, text selectable.
6. Export menu → "Save as PDF": produces a PDF of the whole transcript
   with images; open it to confirm all turns and images are present.
   Also confirm "Web Page" and "Markdown" exports.
7. If on-device AI is available on the test device (iOS 26+): the "AI"
   menu appears; Summarize and Extract Code return text in a sheet. On
   devices without it, the AI menu is absent (expected).
8. Take screenshots of Browser, Library, and a detail view with images —
   these become the App Store screenshots (6.9" and 6.5" sizes).

## Polish expected on the Mac side

- App icon: generate/drop a 1024×1024 PNG into
  `Assets.xcassets/AppIcon.appiconset` (slot is ready).
- If SwiftUI previews or the simulator reveal spacing/typography issues,
  tune freely — keep the card-based transcript design.

## Ship steps

1. App Store Connect: create the app record (matching bundle ID).
   Pricing: Tier 1 ($0.99), paid up-front. Availability: all regions or
   owner's choice.
2. Privacy questionnaire: "Data Not Collected" (all captures stay
   on-device; PrivacyInfo.xcprivacy already declares no tracking).
   Privacy policy URL required — a one-paragraph static page saying all
   data stays on the user's device is sufficient.
3. Xcode: Integrate → Create Workflow to hook Xcode Cloud to this GitHub
   repo, scheme `SessionCapture` (shared). Archive → TestFlight → submit.
4. Review notes for Apple: personal capture/export utility; users log in
   to their own AI accounts in the in-app browser; no server-side
   scraping; no credentials stored by the app (cookies live in the system
   WKWebView store); captured content never leaves the device except via
   the user's own share-sheet exports.
