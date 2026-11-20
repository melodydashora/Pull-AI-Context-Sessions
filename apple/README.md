# SessionVault

A native Apple app (macOS + iOS, one SwiftUI codebase) for saving your important AI sessions across models — Claude, ChatGPT, Gemini, or anything you can paste — and carrying their context into a new conversation with any model. Think of it as the journey of everything you've done with AI over the years, in one vault.

Part of the [Pull-AI-Context-Sessions](https://github.com/melodydashora/Pull-AI-Context-Sessions) repository, folder `apple/`. The puller in `../puller/` writes `.md` transcripts that import directly.

## What it does

- **Vault** — sessions stored locally with SwiftData. Browse by project folder (Vecto, Med, …), provider, tag, or pinned; search titles, summaries, and tags. A **Timeline** view shows every session grouped by month across all models, and each session's original date is editable.
- **Import** — four paths:
  - **From Link**: paste a shared session URL (e.g. `claude.ai/code/session_…`), log in as yourself in the built-in browser, press Capture — the app scroll-harvests the whole conversation and cleans it into a role-labeled transcript. claude.ai share pages get dedicated cleaning: boilerplate, truncated previews, duplicate lines, and timestamps are stripped, and "You said: / Claude responded:" headers become proper User/Assistant roles.
  - `.md` files written by `pull_sessions.py`
  - ChatGPT data exports (`conversations.json`)
  - Any markdown/plain text via file drag-and-drop or clipboard
- **Re-inject** — every session exports as a **context pack** (self-describing markdown with origin, summary, tags, transcript, and a hand-off preamble). Copy or share it into any model.
- **Continue with Claude** — pick a saved session, pick a model (Opus 5 by default; Fable 5.1, Fable 5, Sonnet 5, Haiku 4.5), and keep the conversation going live inside the app via the Anthropic API. New turns stream in and are saved back into the vault. Your API key lives in the Keychain; Opus 5, Fable 5.1 and Fable 5 requests enable server-side refusal fallbacks. A reply that ends as a refusal is not saved, including text that had already streamed.
- **Summarize (keeps code intact)** — one click condenses the conversation into the session's summary field. Prose is compressed aggressively; code blocks, commands, and identifiers are preserved verbatim.

## Building

Open `SessionVault.xcodeproj` in Xcode 16 or newer and press Run — the same target builds for macOS (14+) and iOS (17+). Or from the terminal, in this `apple/` folder:

```bash
xcodebuild -scheme SessionVault -destination 'platform=macOS' build
xcodebuild -scheme SessionVault -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

If `xcodebuild` says it requires Xcode, see the README at the top of the repository.

The project uses a file-system-synchronized group, so new files dropped into `SessionVault/` are picked up automatically.

## Ideas for later

- iCloud sync (SwiftData + CloudKit) so the vault follows you between Mac and iPhone
- iOS share extension to capture transcripts straight from other apps
- Gemini Takeout importer; stripping inline citation chips from captured share pages
- Token-budgeted context packs (summarize down to a target size before re-injection)
