# BUILD_REPORT — SessionVault (Mac CLI Claude, Aug 5, 2026 evening)

> **Historical snapshot, 2026-08-05.** Since 2026-11-19 the app lives in `apple/` on `main`, and `sessionvault-app` is a frozen branch. Paths that start with `ios/` are now under `reference/session-capture-ios/`. Nothing below is an instruction.

*For the cloud session and Cowork Claude. This closes the loop from ios/HANDOFF.md —
with one big change of plan explained below.*

## The headline

**SessionVault supersedes SessionCapture.** While the cloud session was building the
`ios/SessionCapture` scaffold blind, the Mac-side CLI (with real Xcode and a live
simulator) built, tested, and hardened a complete multiplatform app — same concept,
same product goals, further along. It compiles clean on macOS and the iOS simulator,
runs on both, and has survived a full GUI test matrix (Cowork Round 3: all-pass).
This branch (`sessionvault-app`) contains its complete source.

## What the app does today

- **Capture from public share links** (the no-sign-in front door: claude.ai/share,
  share.gemini.google) via an in-app browser with a scroll-and-harvest engine ported
  from pull_sessions.py — plus private-link capture after an in-browser login.
- **PDF originals**: every link capture also stores a pixel-faithful PDF of the page
  ("View Original"), exportable/shareable — the "send research without sign-in" flow.
- **Guards** (verified hands-off, screenshots in `screenshots/`): capture disabled
  until page load; sign-in-wall captures refused with guidance instead of saved;
  page-chrome turns stripped.
- **Vault**: projects, tags, pins, timeline, editable dates, summaries, full-text
  transcript rendering with markdown/code blocks; import from files/clipboard;
  context-pack export (used in production today — Melody moved an entire cloud
  session into the CLI's head with one paste).
- **Continue with Claude**: any archived session resumes live against the Anthropic
  API (key in Keychain).

## Verified fixes this session

1. Reopen-blank-transcript bug: fixed (live query + per-session view identity).
2. Phantom auto-capture: no timer existed; defenses added; 50 s hands-off E2E on the
   signed-out Gemini link → zero saves (screenshot 03).
3. Login loss across rebuilds: identifier-keyed WKWebsiteDataStore (macOS).
4. **Sim launch crash (dyld)**: iOS 18.4 sim runtime lacks `libswiftWebKit.dylib`;
   Swift-overlay WebKit APIs (Result-typed `createPDF`, `forIdentifier:` store) abort
   at launch. Fixed via `__createPDF(with:)` + `#if os(macOS)` store gating. Anyone
   building iOS WebKit code on this toolchain: check `otool -L` for `swiftWebKit`.

## Ship track (P2) — open items

- Melody: add Apple ID to Xcode → create Apple Development cert (zero identities on
  the Mac today; blocks stable signing and App Store).
- App icon (Icon Composer installed), privacy manifest, App Sandbox entitlements,
  review notes (user-initiated archival of user's own conversations).
- Final submission build must use release Xcode, not the 27 beta.
- P3 from Cowork: first-turn header residue on captures — queued.

## Repo layout note

This branch is an orphan root (the app), separate from `main` (the Python puller).
Keep both, or split the app into its own repo before App Store CI — either works;
`main` was not touched.
