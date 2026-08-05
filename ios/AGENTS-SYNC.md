# AGENTS-SYNC v2 — cloud ↔ Mac coordination (updated after reading the Mac transcript)

The cloud architect has now READ the Mac session transcript (via a context
pack from the owner). This file replaces v1 and reflects what the cloud
side knows about SessionVault. Mac Claude: read this on every pull.

## What the cloud side now knows about SessionVault (so don't re-explain)

Confirmed working on the Mac (macOS app + iOS simulator build):
- Capture browser with persistent sign-in; share-first import flow with a
  live tip steering users from private /code/session_ links to public
  share links (no-sign-in principle adopted).
- Role parser handling "You said:" / "Claude responded:" prefixes; bare
  headings no longer misread as speakers; provider auto-detected from
  link/content — no manual model pre-selection needed.
- Reopen fix shipped: live DB query per open, fresh view identity,
  honest "No Transcript" empty state.
- PDF ORIGINALS ALREADY EXIST in SessionVault: pixel-faithful page
  snapshot stored beside the parsed transcript, "View Original" button,
  zoomable, shareable. (Cloud's SessionCapture PdfExporter renders
  transcript-HTML→PDF — a different, complementary artifact: keep
  BOTH: "original as shown" + "clean transcript PDF".)
- Projects, markdown transcript rendering, Continue-with-Claude with
  model switching at send time.

Known open issues on the Mac side (as of the transcript):
- Launch crash traced toward a dylib / "poison link" in WebCapture.swift
  (fix was in progress; verify resolved before merging anything).
- Phantom auto-capture timer firing without user action (fix in
  progress; verify).
- Junk test sessions cleanup underway.
- Toolchain churn: old Xcode deleted; Xcode 27 beta 4 + CLT 27 beta —
  builds must route through the beta toolchain explicitly.

## Standing orders (unchanged, still unmet)

1. PUSH SESSIONVAULT SOURCE to this branch (e.g. `ios-vault/`). It still
   exists only on one machine, one disk-crisis away from gone — and the
   recent 683MB-free episode proves the risk is real. This outranks every
   feature task.
2. Push `ios/BUILD_REPORT.md` (state, fixes, test outcomes) with every
   working session. The owner relaying context packs works, but the repo
   is the durable channel.

## Division of labor (updated)

SessionVault is canonical; SessionCapture (cloud) is a donor library:
- `SessionCapture/CaptureEngine.swift` — Chromium-TESTED multi-vendor
  capture JS: Claude virtualized transcripts (longest-text-per-index,
  settled-bottom), ChatGPT `data-message-author-role`, Gemini
  `user-query`/`model-response`, generic fallback; per-turn image
  collection as data URLs with page credentials. Graft wherever
  SessionVault's harvester is weaker; roles come out user/assistant in
  document order.
- Cloud-authored transcript-PDF export, HTML-with-embedded-images
  export, on-device Summarizer scaffold — take if useful.
- `PrivacyInfo.xcprivacy`, shared scheme, Xcode Cloud + submission
  checklist (HANDOFF.md).
- NEW: `ios/APPSTORE_KIT.md` (listing copy, keywords, review notes,
  privacy answers) and `ios/privacy-policy.html` (ready to host after
  filling [CONTACT-EMAIL]) — being added by the cloud side now.

Cloud side owns: capture-engine correctness, merge plan, App Store
copy/compliance text, fixing anything BUILD_REPORT flags.
Mac side owns: SessionVault code, compiling, simulator/device truth,
Xcode Cloud hookup, TestFlight, submission mechanics.
The owner presses Submit — app is Session Capture, $0.99 Tier 1, paid
up front, Data Not Collected.
