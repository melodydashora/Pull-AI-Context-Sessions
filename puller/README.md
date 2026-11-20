# Pull-AI-Context-Sessions

This tool aims to improve how AI models handle context sessions, making it easier to copy and paste specific code snippets across different environments.

`pull_sessions.py` pulls shared Claude Code sessions (`claude.ai/code/session_...` links) into local files by driving a real, logged-in Chromium via Playwright. Session pages are client-rendered behind auth, so this works for any link you can open in your own browser.

## Outputs

For each link (written to `./sessions` by default):

| File | Contents |
|------|----------|
| `<id>.md` | scroll-scraped rendered transcript (guaranteed output) |
| `<id>.json` | largest JSON payload captured from the page's network calls (usually the full structured transcript) |
| `raw/<id>/` | every candidate JSON response, for inspection |

## Setup (once)

```bash
pip install -r requirements.txt
playwright install chromium
python pull_sessions.py --login     # log in to claude.ai in the window, then close it
```

## Usage

```bash
python pull_sessions.py links.txt             # file with one URL per line
python pull_sessions.py URL1 URL2 ...         # or pass URLs directly
python pull_sessions.py links.txt --combine   # also write sessions/all_sessions.md
```

Options:

- `--out DIR` — output directory (default: `sessions`)
- `--headless` — run without a visible browser window
- `--combine` — also concatenate everything into `all_sessions.md`
- `--browser-exe PATH` — use an existing Chromium binary instead of the one from `playwright install chromium`
- `--profile DIR` — browser profile directory holding the login (default: `~/.claude_session_pull_profile`)

If `.md` files come out near-empty, either you aren't logged in (the script warns about login redirects — rerun `--login`) or the claude.ai transcript layout changed; in the latter case, update `SCROLLER_SELECTORS` at the top of the script.

## Using it on Replit

The `Session login (VNC)` workflow opens Chromium in Replit's streamed desktop. Start it when you need to sign in to `claude.ai`, then close the browser window to finish login setup. The script stores the persistent browser profile in `~/.claude_session_pull_profile`; do not share that profile.

After logging in, export an authorized session from the Replit Shell, in the workspace's top folder, with:

```bash
LD_LIBRARY_PATH="$(dirname "$(gcc -print-file-name=libatomic.so.1)")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
python puller/pull_sessions.py --headless --browser-exe "$(command -v chromium)" URL
```

Replace `URL` with a session link you are authorized to access. Exports are written to `sessions/` in that folder, which is excluded from Git.
