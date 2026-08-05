# Session Capture (iOS)

Native SwiftUI version of the desktop `pull_sessions.py` tool: a multi-model AI context session capture app. Browse to any AI chat session or share link in the built-in browser, log in if the page needs it, and tap **Capture** — the app walks the virtualized transcript with the same scroll-and-harvest logic as the desktop tool and saves it to a local library with Markdown export.

## How it works

- **Browser tab** — a WKWebView with persistent cookies (your claude.ai login sticks across launches, like the desktop tool's profile directory). Paste a session or share link — there's a one-tap paste-and-go button — and tap Capture.
- **Capture** — injects the ported capture script: finds the transcript scroller, scrolls top to bottom, keeps the longest text per `data-index` turn group, collects the images inside each turn (fetched with the page's own credentials, so signed-in content works), and requires the bottom to hold for two passes before finishing. Pages without `data-index` turns (other vendors) fall back to full-page text and images, so capture always yields something.
- **Library tab** — sessions organized into projects (create and move via context menu), stored on-device as one folder per session (JSON + image files).
- **Detail view** — the transcript as clean turn cards with inline images and selectable text.
- **Export** — two formats from the share sheet: Markdown, or a single self-contained web page with every image embedded — the file to send someone research without making them sign in anywhere.

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
