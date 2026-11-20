# SessionVault

Tools for keeping AI chat sessions and carrying their context into new conversations.
Everything in this repository (Pull-AI-Context-Sessions) lives on one branch, `main`, with one folder per component.

## What is where

| Folder | Contents | Status |
|---|---|---|
| `apple/` | **SessionVault**, a native macOS and iOS app (SwiftUI, SwiftData). It imports, stores, searches and exports sessions, and can continue one with Claude. Details: `apple/README.md`. | The live app. Builds on a Mac only. |
| `puller/` | **pull_sessions.py**, a Python + Playwright script that saves Claude Code session pages (`claude.ai/code/session_...` links) as Markdown and JSON files. Details: `puller/README.md`. | Cross-platform (Windows and macOS). Not yet confirmed end to end, so try one link first. |
| `reference/session-capture-ios/` | **Session Capture**, an earlier iOS-only app written on 2026-08-05 without a Swift toolchain, with its planning documents. | Donor code only. It compiles (checked for the iOS Simulator) but has never been run or tested. Its documents are historical. |

`apple/BUILD_REPORT.md` and everything under `reference/` date from 2026-08-05, before the components were merged into `main`. They mention branches, paths and standing orders that no longer apply. Read them as history, not as instructions.

## Build the app (Mac only)

Needs Xcode 16 or newer. One target builds for macOS 14+ and iOS 17+. Open `apple/SessionVault.xcodeproj` in Xcode and press Run, or use Terminal:

```bash
cd apple
xcodebuild -project SessionVault.xcodeproj -scheme SessionVault -destination 'platform=macOS' CODE_SIGN_IDENTITY=- build
xcodebuild -project SessionVault.xcodeproj -scheme SessionVault -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

- `CODE_SIGN_IDENTITY=-` signs the Mac build ad hoc ("Sign to Run Locally"), so no Apple developer account or certificate is needed.
- If `xcodebuild` says it requires Xcode, point it at your Xcode first, for example `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`.
- Both commands were last checked on 2026-11-19 with Xcode 27 beta.
- Xcode puts the built app in `~/Library/Developer/Xcode/DerivedData/SessionVault-<hash>/Build/Products/Debug/`. The hash depends on where the project sits on disk, so a Dock icon made from an older location keeps opening the old build.
- The app cannot be built on Windows. Swift files can be edited and committed there, but build on the Mac before relying on a change.

## Set up and run the puller (Windows and macOS)

Needs Python 3.9 or newer. Once per machine:

macOS (Terminal):

```bash
cd puller
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
python pull_sessions.py --login
```

Windows (PowerShell):

```powershell
cd puller
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install chromium
python pull_sessions.py --login
```

`--login` opens a Chromium window. Sign in to claude.ai, then close the window. The login is kept in a browser profile folder named `.claude_session_pull_profile` in your home directory, separately on each machine. If PowerShell refuses to run `Activate.ps1`, use Command Prompt and `.venv\Scripts\activate.bat` instead.

To pull sessions, activate the environment again (`source .venv/bin/activate` or `.venv\Scripts\Activate.ps1`) and run:

```
python pull_sessions.py links.txt
```

`links.txt` is your own file: copy `links.example.txt` to `links.txt` and put one session link per line. You can also pass links directly on the command line. Output goes to a `sessions` folder inside the folder you run the command from. All options are listed in `puller/README.md`.

## Privacy: never commit these

Treat everything pushed here as public and permanent.

- Session output: any `sessions/` folder, `all_sessions.md`, captured transcripts, exported context packs and PDFs.
- Your real link lists (`links.txt` or any other file named `links*.txt`). Only `links.example.txt`, which holds fake placeholders, is tracked.
- Browser profiles: `.claude_session_pull_profile` and any folder passed to `--profile`.
- App data: the vault is outside the repository, on the Mac at `~/Library/Application Support/default.store` with its `-shm` and `-wal` files and the `.default_SUPPORT` folder. Copy nothing from `~/Library` into the repository.
- API keys and other secrets. The app keeps the Anthropic API key in the Keychain. Never put a key in code, notes, `.env` files or commit messages.
- Xcode user state (`xcuserdata/`), virtual environments (`.venv/`) and desktop screenshots.

`.gitignore` covers the usual places for most of these, but not everything: an exported PDF or a screenshot saved into the repository would not be ignored. So add files by name (`git add <file>`) instead of `git add -A`, and read `git status` before every commit.

## Working from two machines

Git is the only thing that moves work between the Mac and the Windows PC. Do not copy the folder across, and keep the clone out of iCloud Drive, OneDrive and Dropbox.

1. Before you start: `git pull --ff-only`
2. When you finish: `git status`, then `git add <files>`, `git commit -m "what changed"` and `git push`

- Stay on `main`. If `git pull --ff-only` refuses, the two machines have diverged; sort that out before doing anything else.
- `.gitattributes` keeps every text file on LF line endings on both machines. Leave it in place.

## Known limits

- Transcripts the puller writes on Windows have Windows line endings, which the app's importer does not handle yet (all turns merge into one message). Until that is fixed, pull on the Mac or convert the files to LF before importing.
- The puller reads Claude Code session pages only. Other share pages are handled by the link capture inside the app.
