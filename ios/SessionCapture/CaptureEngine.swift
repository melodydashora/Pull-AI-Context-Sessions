import Foundation

/// The capture script, ported from the desktop tool (pull_sessions.py).
///
/// Chat transcripts on claude.ai are virtualized — only a handful of turn
/// groups exist in the DOM at once — so the script walks the scroller from
/// top to bottom and keeps the longest text seen for each data-index. Pages
/// without data-index turns (other vendors' share pages) fall back to the
/// full rendered page text, so capture always produces something.
enum CaptureEngine {
    static let script = """
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function findScroller() {
        const sels = [
            ".h-full.overflow-y-auto.overflow-x-hidden",
            "main .overflow-y-auto",
            ".overflow-y-auto"
        ];
        let best = null;
        for (const sel of sels) {
            for (const el of document.querySelectorAll(sel)) {
                const scrolls = el.scrollHeight > el.clientHeight + 4;
                const turns = el.querySelectorAll("[data-index]").length > 0;
                if (scrolls && turns) return el;
                if (!best && (scrolls || turns)) best = el;
            }
        }
        return best || document.scrollingElement || document.body;
    }

    const turns = {};
    function harvest() {
        for (const el of document.querySelectorAll("[data-index]")) {
            const idx = parseInt(el.getAttribute("data-index"), 10);
            if (isNaN(idx)) continue;
            const t = el.innerText || "";
            if (!(idx in turns) || t.length > turns[idx].length) turns[idx] = t;
        }
    }

    let el = findScroller();
    el.scrollTop = 0;
    await sleep(600);
    let settled = 0;
    for (let i = 0; i < 800; i++) {
        harvest();
        el = findScroller();
        if (!el) break;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
            harvest();
            settled += 1;
            if (settled >= 2) break;
            await sleep(800);
            continue;
        }
        settled = 0;
        el.scrollTop += el.clientHeight * 0.8;
        await sleep(450);
    }

    const keys = Object.keys(turns).map(Number).sort((a, b) => a - b);
    if (keys.length > 0) return keys.map(k => turns[k]);
    return [document.body.innerText || ""];
    """
}
