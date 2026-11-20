# SessionVault

Tools for keeping AI chat sessions and carrying their context into new conversations.
Everything in this repository (Pull-AI-Context-Sessions) is on the `main` branch, with one folder per component.
GitHub still shows two older branches, `sessionvault-app` and `claude/per-chat-attachment-fix-t5pumx`. They are history. Do not work on them.

## What is where

| Folder | Contents | Status |
|---|---|---|
| `apple/` | **SessionVault**, a native macOS and iOS app (SwiftUI, SwiftData). It imports, stores, searches and exports sessions, and can continue one with Claude. Details: `apple/README.md`. | The live app. Builds on a Mac only. |
| `puller/` | **pull_sessions.py**, a Python + Playwright script that saves Claude Code session pages (`claude.ai/code/session_...` links) as Markdown and JSON files. Details: `puller/README.md`. | Written for Windows, macOS and Replit. No run has captured a full transcript yet, so try one link first. |
| `reference/session-capture-ios/` | **Session Capture**, a parallel iOS-only attempt written on 2026-08-05 without a Swift toolchain, with its planning documents. | Donor code only. It compiles (checked for the iOS Simulator) but has never been run or tested. Its documents are historical. |

`.replit` at the top level configures the Replit workspace (a sign-in workflow for the puller). It is used only on Replit.

`apple/BUILD_REPORT.md` and everything under `reference/` date from 2026-08-05, before the components were merged into `main`. They mention branches, paths and standing orders that no longer apply. Read them as history, not as instructions. The privacy policy and App Store text under `reference/` describe Session Capture only. They are not true of SessionVault, which sends transcripts to the Anthropic API for Continue with Claude and Summarize.

## Get the code

```
git clone https://github.com/melodydashora/Pull-AI-Context-Sessions
cd Pull-AI-Context-Sessions
```

- On Windows, first install Git (https://git-scm.com/download/win) and Python 3.9 or newer (https://www.python.org/downloads/; tick "Add python.exe to PATH" in the installer).
- Keep the clone in a plain local folder: not in iCloud Drive, OneDrive or Dropbox, and not in a Documents or Desktop folder that one of them syncs.
- Once per machine, inside the clone, set the identity that every commit carries. Use your GitHub no-reply address, because commit addresses are public. GitHub shows it under Settings, Emails.

  ```
  git config user.name "Your Name"
  git config user.email "ID+username@users.noreply.github.com"
  ```

## Build the app (Mac only)

So far the app has been built only with Xcode 27 beta; the project format needs Xcode 16 or newer. One target builds for macOS 14+ and iOS 17+. Open `apple/SessionVault.xcodeproj` in Xcode and press Run, or use Terminal:

```bash
cd apple
xcodebuild -project SessionVault.xcodeproj -scheme SessionVault -destination 'platform=macOS' CODE_SIGN_IDENTITY=- build
xcodebuild -project SessionVault.xcodeproj -scheme SessionVault -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

- `CODE_SIGN_IDENTITY=-` signs the Mac build ad hoc ("Sign to Run Locally"), so no Apple developer account or certificate is needed.
- If `xcodebuild` says it requires Xcode, point it at your Xcode first, for example `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`.
- Both commands were last checked on 2026-11-19 with Xcode 27 beta.
- Xcode puts the built app in `~/Library/Developer/Xcode/DerivedData/SessionVault-<hash>/Build/Products/Debug/`. The hash depends on where the project sits on disk, so a Dock icon made from an older location keeps opening the old build.
- The app cannot be built on Windows or Linux. Swift files can be edited and committed there, but build on the Mac before relying on a change.

## Set up and run the puller

Needs Python 3.9 or newer. All commands below run inside the `puller` folder. Once per machine:

macOS (Terminal):

```bash
cd puller
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
python pull_sessions.py --login
```

Windows (PowerShell or Command Prompt):

```
cd puller
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m playwright install chromium
.venv\Scripts\python.exe pull_sessions.py --login
```

If `py` is not recognized on Windows, use `python -m venv .venv` for the second line.

`--login` opens a Chromium window. Sign in to claude.ai, then close the window. The login is kept in a browser profile folder named `.claude_session_pull_profile` in your home directory, separately on each machine.

To pull sessions on a later day, go to the `puller` folder and run:

- macOS: `.venv/bin/python pull_sessions.py links.txt`
- Windows: `.venv\Scripts\python.exe pull_sessions.py links.txt`

`links.txt` is your own file: copy `links.example.txt` to `links.txt` and put one session link per line. You can also pass links directly on the command line. Output goes to a `sessions` folder inside the folder you run the command from. All options are listed in `puller/README.md`.

A good run prints `saved session_....md (N turn groups)` with N above 0. `0 turn groups` means nothing was captured, even though the last line says `Done`: either the sign-in did not stick (run `--login` again) or the page layout changed (see the end of the Usage section of `puller/README.md`).

On Replit, use the `Session login (VNC)` workflow instead; see "Using it on Replit" in `puller/README.md`.

## Privacy: never commit these

Treat everything pushed here as public and permanent.

- Session output: any `sessions/` folder, `all_sessions.md`, captured transcripts, exported context packs and PDFs.
- Your real link lists (`links.txt` or any similar file). Only `links.example.txt`, which holds fake placeholders, is tracked.
- Browser profiles: `.claude_session_pull_profile` and any folder passed to `--profile`.
- App data: the vault is outside the repository, on the Mac at `~/Library/Application Support/default.store` with its `-shm` and `-wal` files and the `.default_SUPPORT` folder. Copy nothing from `~/Library` into the repository, and no backup or rescue copy of it either.
- API keys and other secrets. The app keeps the Anthropic API key in the Keychain. Until the app's network client is changed, macOS can also keep copies of the app's requests, including the key, in the cache folder `~/Library/Caches/com.melodydashora.SessionVault/`. Never put a key in code, notes, `.env` files or commit messages.
- Xcode user state (`xcuserdata/`), virtual environments (`.venv/`), desktop screenshots and private notes.

`.gitignore` covers the usual places for these, but it is a safety net, not a guarantee: an exported PDF saved into the repository would not be ignored. So add files by name (`git add <file>`), never with `git add -A` or `git add .`, and read `git status` before every commit. Tools that commit for you, such as the Git panel of a hosted workspace, may add every new file that is not ignored; look at their list first.

The top level of the repository is an allow-list: a new file or folder placed there is ignored by git until its name is added at the end of `.gitignore`. Inside `apple/`, `puller/`, `reference/` and `web/` git behaves as usual.

## Working from more than one machine

Git is the only thing that moves work between machines (Mac, Windows PC, Replit). Do not copy the folder across.

1. Before you start: `git pull --ff-only`
2. When you finish: `git status`, then `git add <files>`, `git commit -m "what changed"` and `git push`

- Stay on `main`, and work on one machine at a time: push before you leave one, pull before you start on another.
- If `git push` is rejected ("fetch first" or "non-fast-forward"), another machine pushed before you. Run `git pull --rebase`, then `git push`. If the rebase reports a conflict, run `git rebase --abort`, which puts everything back, and get help. Never force a push.
- If `git pull --ff-only` answers "Not possible to fast-forward", this machine has commits the other one lacks, and the other way round. The recipe is the same: `git pull --rebase`, then `git push`.
- If `git pull --ff-only` says your local changes would be overwritten, or that you have unstaged changes, some files have uncommitted changes: commit them first. If `git status` lists a file but `git diff` shows nothing, only its line endings changed; run `git add <file>` and the entry goes away.
- `.gitattributes` keeps every text file on LF line endings on every machine. Leave it in place.

## Known limits

- The app's importer does not handle Windows line endings yet: a transcript saved with CRLF line endings imports as one message. The puller writes LF on every system, so its own output is not affected; files from other tools may be.
- The puller reads Claude Code session pages only. Other share pages are handled by the link capture inside the app.
