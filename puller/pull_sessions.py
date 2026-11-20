#!/usr/bin/env python3
"""
pull_sessions.py — pull shared Claude Code sessions (claude.ai/code/session_... links) into files.

Strategy: drive a real, logged-in Chromium via Playwright. Session pages are
client-rendered behind auth, so this works for ANY link you can open in your
own browser — your sessions or anyone else's, from any model.

Outputs per link (in ./sessions):
  <id>.md       scroll-scraped rendered transcript (guaranteed output)
  <id>.json     largest JSON payload captured from the page's network calls
                (usually the full structured transcript)
  raw/<id>/     every candidate JSON response, for inspection

Setup (once):
  pip install playwright
  playwright install chromium
  python pull_sessions.py --login     # log in to claude.ai in the window, then close it

Run:
  python pull_sessions.py links.txt             # file with one URL per line
  python pull_sessions.py URL1 URL2 ...         # or pass URLs directly
  python pull_sessions.py links.txt --combine   # also write sessions/all_sessions.md
"""

import argparse
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

PROFILE_DIR = Path.home() / ".claude_session_pull_profile"

# The transcript scroller selector as of early 2026; falls back to broader matches
# if the UI changes. If .md files come out near-empty, this is the first thing to fix.
SCROLLER_SELECTORS = [
    ".h-full.overflow-y-auto.overflow-x-hidden",
    "main .overflow-y-auto",
    ".overflow-y-auto",
]


def sid_from(url: str) -> str:
    m = re.search(r"(session_[A-Za-z0-9]+)", url)
    if m:
        return m.group(1)
    return re.sub(r"\W+", "_", url).strip("_")[-48:]


def expand(name: str) -> Path:
    """Expand a leading "~" ourselves: Command Prompt and PowerShell do not.

    A name that only looks like a home reference is returned as given.
    """
    try:
        return Path(name).expanduser()
    except RuntimeError:
        return Path(name)


def read_text_file(p: Path) -> str:
    """Decode a links file: UTF-8 with or without a byte-order mark, or UTF-16.

    Notepad writes a byte-order mark, and "> file" in Windows PowerShell writes UTF-16.
    """
    data = p.read_bytes()
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    return data.decode("utf-8-sig")


def read_links(inputs) -> list[str]:
    links = []
    for a in inputs:
        p = expand(a)
        if p.is_file():
            try:
                text = read_text_file(p)
            except UnicodeDecodeError:
                print(f"!! skipping {a!r}: cannot read it; save it as UTF-8", file=sys.stderr)
                continue
            links += [
                line.strip()
                for line in text.splitlines()
                if line.strip().startswith("http")
            ]
        elif a.startswith("http"):
            links.append(a)
        else:
            print(f"!! skipping {a!r}: not a file and not a URL", file=sys.stderr)
    seen = set()
    return [x for x in links if not (x in seen or seen.add(x))]


def find_scroller(page):
    """Pick the element that actually scrolls the transcript.

    Prefer a candidate that both overflows and contains the virtualized turn
    elements; a bare class match can hit a non-scrolling wrapper, which makes
    the scrape silently stop after one screenful.
    """
    candidates = []
    for sel in SCROLLER_SELECTORS:
        loc = page.locator(sel)
        for i in range(min(loc.count(), 10)):
            candidates.append(loc.nth(i))
    best = None
    for cand in candidates:
        try:
            info = cand.evaluate(
                "el => ({scrolls: el.scrollHeight > el.clientHeight + 4,"
                " turns: el.querySelectorAll('[data-index]').length})"
            )
        except Exception:
            continue
        if info["scrolls"] and info["turns"] > 0:
            return cand
        if best is None and (info["scrolls"] or info["turns"] > 0):
            best = cand
    return best


def pull_one(page, url: str, out: Path):
    sid = sid_from(url)
    raw = out / "raw" / sid
    raw.mkdir(parents=True, exist_ok=True)
    captured: list[tuple[str, str]] = []

    def on_response(resp):
        try:
            if "json" not in resp.headers.get("content-type", ""):
                return
            u = resp.url
            if any(k in u for k in (sid, "session", "message", "transcript", "events")):
                captured.append((u, resp.text()))
        except Exception:
            pass

    page.on("response", on_response)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=90_000)
        try:
            page.wait_for_load_state("networkidle", timeout=30_000)
        except Exception:
            pass
        time.sleep(2)

        if "login" in page.url or page.locator("input[type=password]").count() > 0:
            print(
                "   !! redirected to a login page — run `python pull_sessions.py --login` first",
                file=sys.stderr,
            )

        # ---- scroll-scrape the virtualized transcript ----
        # Only ~7-13 turn groups exist in the DOM at once, so we walk the whole
        # scroller and keep the longest text seen for each data-index.
        turns: dict[int, str] = {}

        def harvest():
            for el in page.query_selector_all("[data-index]"):
                try:
                    idx = el.get_attribute("data-index")
                    if idx is None or not idx.lstrip("-").isdigit():
                        continue
                    txt = el.inner_text() or ""
                except Exception:
                    continue  # element unmounted mid-read; the next pass catches it
                i = int(idx)
                if len(txt) > len(turns.get(i, "")):
                    turns[i] = txt

        def scroll_eval(js):
            # Re-resolve the scroller every time: virtualized re-renders can
            # replace the node and stale handles throw.
            scroller = find_scroller(page)
            if scroller is None:
                return None
            try:
                return scroller.evaluate(js)
            except Exception:
                return None

        if find_scroller(page) is not None:
            scroll_eval("el => { el.scrollTop = 0 }")
            time.sleep(0.6)
            settled = 0
            for _ in range(800):  # safety cap for very long sessions
                harvest()
                at_bottom = scroll_eval(
                    "el => el.scrollTop + el.clientHeight >= el.scrollHeight - 4"
                )
                if at_bottom is None:
                    break
                if at_bottom:
                    # Late-loading content can grow scrollHeight after we hit
                    # bottom; only stop once the bottom stays put for two passes.
                    harvest()
                    settled += 1
                    if settled >= 2:
                        break
                    time.sleep(0.8)
                    continue
                settled = 0
                scroll_eval("el => { el.scrollTop += el.clientHeight * 0.8 }")
                time.sleep(0.45)
        else:
            harvest()  # best effort if layout changed entirely

        # ---- write outputs ----
        # Bytes are written directly: on Windows the text-mode writer turns "\n"
        # into "\r\n", and SessionVault then imports the transcript as one message.
        for i, (u, body) in enumerate(captured):
            (raw / f"{i:02d}.json").write_bytes(body.encode("utf-8"))
        if captured:
            biggest = max(captured, key=lambda t: len(t[1]))
            (out / f"{sid}.json").write_bytes(biggest[1].encode("utf-8"))

        md_parts = [f"# {sid}", f"Source: {url}", ""]
        for i in sorted(turns):
            md_parts += [turns[i], "", "---", ""]
        (out / f"{sid}.md").write_bytes("\n".join(md_parts).encode("utf-8"))

        return sid, len(turns), len(captured)
    finally:
        page.remove_listener("response", on_response)


def main():
    ap = argparse.ArgumentParser(description="Pull shared Claude Code sessions into files.")
    ap.add_argument("inputs", nargs="*", help="links.txt and/or session URLs")
    ap.add_argument("--login", action="store_true", help="open a browser to log in once")
    ap.add_argument("--combine", action="store_true", help="also write all_sessions.md")
    ap.add_argument("--out", default="sessions", help="output directory (default: sessions)")
    ap.add_argument("--headless", action="store_true", help="run without a visible window")
    ap.add_argument(
        "--browser-exe",
        default=None,
        help="path to a Chromium binary (if `playwright install chromium` isn't an option)",
    )
    ap.add_argument(
        "--profile",
        default=str(PROFILE_DIR),
        help=f"browser profile dir holding the login (default: {PROFILE_DIR})",
    )
    args = ap.parse_args()

    out = expand(args.out)
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        launch_kw = {"headless": args.headless and not args.login}
        if args.browser_exe:
            launch_kw["executable_path"] = args.browser_exe
        # An empty --profile keeps its Playwright meaning: a temporary profile.
        profile = str(expand(args.profile)) if args.profile else ""
        ctx = pw.chromium.launch_persistent_context(profile, **launch_kw)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        if args.login:
            page.goto("https://claude.ai")
            print("Log in to claude.ai in the window, then close the browser.")
            try:
                page.wait_for_event("close", timeout=0)
            except Exception:
                pass
            try:
                ctx.close()
            except Exception:
                pass
            return

        links = read_links(args.inputs)
        if not links:
            sys.exit("No links found. Pass URLs or a links.txt with one URL per line.")

        done = []
        for url in links:
            print(f"-> {url}")
            try:
                sid, n_turns, n_json = pull_one(page, url, out)
                print(f"   saved {sid}.md ({n_turns} turn groups), {n_json} JSON payloads")
                done.append(sid)
            except Exception as e:
                print(f"   FAILED: {e}")
                # A botched navigation can leave the tab wedged (e.g. pointing
                # at chrome-error://) and interrupt the next goto — start fresh.
                try:
                    page.close()
                except Exception:
                    pass
                page = ctx.new_page()

        try:
            ctx.close()
        except Exception:
            pass

    if args.combine and done:
        combined = "\n\n".join(
            (out / f"{s}.md").read_text(encoding="utf-8") for s in done
        )
        (out / "all_sessions.md").write_bytes(combined.encode("utf-8"))
        print(f"Combined -> {out / 'all_sessions.md'}")

    print(f"Done. {len(done)}/{len(links)} sessions in {out}/")


if __name__ == "__main__":
    main()
