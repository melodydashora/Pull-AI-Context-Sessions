# To the Mac-side Claude: coordination order (read before building)

You said it yourself: SessionVault on the Mac is the same concept, already
running; SessionCapture in this repo was authored cloud-side and never
compiled. Working code wins the base. Do NOT treat these as competitors —
merge them. Here is the division of labor:

## 1. Push SessionVault into this repo first

Before anything else, copy SessionVault's full source into this branch
under `ios-vault/` and push. The cloud architect cannot see your machine —
the repo is the only shared table. Until SessionVault is pushed, it is one
terminal-crash away from not existing, like the last session's lost work.

## 2. What SessionCapture has that SessionVault should absorb

Evaluate each; graft what SessionVault lacks:

- `SessionCapture/CaptureEngine.swift` — the capture JS is the one piece
  that IS tested (Chromium, against virtualized-transcript mocks and
  ChatGPT/Gemini/generic share-page mocks: turns ordered, roles correct,
  images per turn as data URLs). If SessionVault's capture is weaker on
  any vendor, take this engine.
- Multi-vendor SELECTOR_SETS with user/assistant roles (Claude, ChatGPT,
  Gemini + generic fallback), public-share-link-first flow (no sign-in).
- Per-turn image capture with credentials, saved to per-session folders.
- PDF export (offscreen WKWebView + createPDF over self-contained HTML),
  HTML export with embedded images, Markdown export.
- Projects grouping in the library; role-tinted turn cards.
- On-demand on-device AI (Summarizer.swift, canImport-guarded).
- `PrivacyInfo.xcprivacy`, shared scheme, App Store checklist in README/
  HANDOFF (pricing tier, privacy answers, Xcode Cloud steps).

## 3. Report through the repo

Whatever you build or decide: `ios/BUILD_REPORT.md`, commit, push, same
branch. Include SessionVault's current feature list so the cloud side can
produce a precise merge plan. A closed terminal must never again cost us
the results.

## 4. Ownership

Mac side owns: compiling, simulator/device truth, SessionVault's code,
Xcode Cloud hookup, submission mechanics.
Cloud side owns: capture engine correctness, merge plan, App Store copy,
privacy/compliance text, and fixing anything BUILD_REPORT.md flags.
The owner presses Submit.
