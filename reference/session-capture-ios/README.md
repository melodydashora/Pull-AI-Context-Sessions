# Session Capture (iOS)

> **Historical copy, 2026-08-05.** Session Capture was never run or released and is superseded by SessionVault in `apple/`. Do not follow instructions in this folder; `HANDOFF.md` and `AGENTS-SYNC.md` are void. The privacy and App Store text describes Session Capture only. See the README at the top of the repository.

Native SwiftUI multi-model AI context capture app. Paste any **public** AI chat share link — Claude, ChatGPT, Gemini, and more — and tap **Capture**. The app renders the page in a built-in browser, walks the transcript (structured turns with user/assistant roles where the page exposes them, images included), and saves it to an on-device library. Export a session as a single self-contained web page so anyone can open the full research — images and all — **without signing in to anything**.

Public share links need no login, which is the whole point: the person you send the exported page to, or the next model you feed it into, sees the complete context immediately instead of you copying it across a day. (Signed-in pages also work, since the browser keeps your login — but nothing about the app requires an account with any vendor.)

## How it works

- **Browser tab** — a WKWebView with persistent cookies (your claude.ai login sticks across launches, like the desktop tool's profile directory). Paste a session or share link — there's a one-tap paste-and-go button — and tap Capture.
- **Capture** — tries three strategies in order so it works across vendors: (1) Claude-style virtualized transcripts, scrolled top to bottom keeping the longest text per turn; (2) static turn containers from known public share pages — ChatGPT (`data-message-author-role`), Gemini (`user-query`/`model-response`), generic conversation-turn and article layouts — returning turns with user/assistant roles in document order; (3) full-page text as a last resort. Images inside turns are fetched with the page's own credentials and embedded, so capture always yields the complete context.
- **Library tab** — sessions organized into projects (create and move via context menu), stored on-device as one folder per session (JSON + image files).
- **Detail view** — the transcript as clean turn cards with inline images and selectable text.
- **Export** — from the share sheet: **Save as PDF** (the full context window as one portable document with images baked in), a self-contained web page, or Markdown. Any of them opens with no sign-in — the file to hand a colleague or feed to another model without making them log in.
- **AI (optional, on-demand)** — when Apple's on-device model is available, a Summarize or Extract Code action runs entirely on-device (no network, no API key, nothing leaves the phone). It's never automatic: the raw transcript is the product; the AI is there only when you want a summary or want the code pulled out. The app works fully without it.

## Building (on your Mac)

1. Open `ios/SessionCapture.xcodeproj` in Xcode 15 or newer.
2. In the target's **Signing & Capabilities**, pick your team. The bundle ID is `com.melodydashora.SessionCapture` — change it if you prefer.
3. Run on a simulator or device.

## Xcode Cloud (build in Apple's cloud from this repo)

1. In Xcode: **Integrate → Create Workflow** (or in App Store Connect → your app → Xcode Cloud).
2. Sign in and grant Xcode Cloud access to the `Pull-AI-Context-Sessions` GitHub repo when prompted.
3. Select the `SessionCapture` scheme (it's shared, so Xcode Cloud can see it).
4. Default workflow: build on every push to `main`, archive, and deliver to TestFlight. Let Xcode Cloud manage signing certificates and profiles.

## App Store submission checklist

- **App record**: create the app in App Store Connect with the matching bundle ID.
- **Privacy**: the app collects nothing and sends nothing anywhere — captured transcripts live only on-device, and the privacy manifest (`PrivacyInfo.xcprivacy`) declares no tracking, no collected data. In the App Privacy questionnaire, answer "Data Not Collected."
- **Privacy policy URL**: still required by Apple; a one-paragraph "all data stays on your device" page is sufficient.
- **App icon**: drop a 1024×1024 PNG into `Assets.xcassets/AppIcon.appiconset` (the slot is ready).
- **Screenshots**: 6.9" and 6.5" iPhone sizes minimum; capture from the simulator.
- **Export compliance**: standard HTTPS only — answer exempt.
- **Review notes**: mention the app is a personal capture/export utility where users log in to their own AI accounts through the in-app browser; nothing is scraped server-side and no credentials are stored by the app itself (cookies live in the system WKWebView store).
