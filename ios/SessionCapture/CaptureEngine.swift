import Foundation

/// The capture script, ported from the desktop tool (pull_sessions.py).
///
/// Chat transcripts on claude.ai are virtualized — only a handful of turn
/// groups exist in the DOM at once — so the script walks the scroller from
/// top to bottom and keeps the longest text seen for each data-index, along
/// with the images that appear inside each turn. Pages without data-index
/// turns (other vendors' share pages) fall back to the full rendered page
/// text and its images, so capture always produces something.
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

    const turnTexts = {};
    const turnImages = {};
    function noteImage(idx, img) {
        const src = img.currentSrc || img.src;
        if (!src) return;
        if (src.startsWith("data:") && !src.startsWith("data:image/")) return;
        if ((img.naturalWidth || 0) < 32 && (img.naturalHeight || 0) < 32) return;
        (turnImages[idx] = turnImages[idx] || new Set()).add(src);
    }
    function harvest() {
        for (const el of document.querySelectorAll("[data-index]")) {
            const idx = parseInt(el.getAttribute("data-index"), 10);
            if (isNaN(idx)) continue;
            const t = el.innerText || "";
            if (!(idx in turnTexts) || t.length > turnTexts[idx].length) turnTexts[idx] = t;
            for (const img of el.querySelectorAll("img")) noteImage(idx, img);
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

    async function toDataURL(src) {
        if (src.startsWith("data:image/")) {
            return src.length <= 6 * 1024 * 1024 ? src : null;
        }
        try {
            const resp = await fetch(src, { credentials: "include" });
            if (!resp.ok) return null;
            const blob = await resp.blob();
            if (blob.size > 4 * 1024 * 1024 || !blob.type.startsWith("image/")) return null;
            return await new Promise(resolve => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = () => resolve(null);
                fr.readAsDataURL(blob);
            });
        } catch (e) {
            return null;
        }
    }

    const keys = Object.keys(turnTexts).map(Number).sort((a, b) => a - b);
    if (keys.length > 0) {
        const srcs = [];
        for (const k of keys) {
            for (const s of (turnImages[k] || [])) {
                if (!srcs.includes(s)) srcs.push(s);
            }
        }
        const dataBySrc = {};
        for (const src of srcs.slice(0, 24)) {
            const d = await toDataURL(src);
            if (d) dataBySrc[src] = d;
        }
        return keys.map(k => ({
            text: turnTexts[k],
            images: [...(turnImages[k] || [])].map(s => dataBySrc[s]).filter(Boolean)
        }));
    }

    const pageSrcs = [];
    for (const img of document.querySelectorAll("img")) {
        const src = img.currentSrc || img.src;
        if (src && (img.naturalWidth || 0) >= 32 && !pageSrcs.includes(src)) pageSrcs.push(src);
    }
    const pageImages = [];
    for (const src of pageSrcs.slice(0, 12)) {
        const d = await toDataURL(src);
        if (d) pageImages.push(d);
    }
    return [{ text: document.body.innerText || "", images: pageImages }];
    """
}
