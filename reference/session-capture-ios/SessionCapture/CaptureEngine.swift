import Foundation

/// The capture script, ported from the desktop tool (pull_sessions.py) and
/// extended for public share pages from any vendor — no sign-in required
/// for links that are already public.
///
/// Strategy order:
/// 1. Claude-style virtualized transcripts ([data-index] turns): walk the
///    scroller top to bottom, keep the longest text per index.
/// 2. Static turn containers from known vendors (ChatGPT's
///    data-message-author-role, Gemini's user-query/model-response,
///    conversation-turn testids, plain articles) — first selector set that
///    matches wins, turns come back with user/assistant roles when the
///    markup says so.
/// 3. Full rendered page text, so capture always produces something.
///
/// Images inside turns are fetched with the page's own credentials and
/// returned as data URLs (public pages need no credentials; signed-in
/// pages still work).
enum CaptureEngine {
    static let script = """
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function goodImage(img) {
        const src = img.currentSrc || img.src;
        if (!src) return null;
        if (src.startsWith("data:") && !src.startsWith("data:image/")) return null;
        if ((img.naturalWidth || 0) < 32 && (img.naturalHeight || 0) < 32) return null;
        return src;
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

    async function resolveImages(srcLists, cap) {
        const unique = [];
        for (const list of srcLists) {
            for (const s of list) {
                if (!unique.includes(s)) unique.push(s);
            }
        }
        const bySrc = {};
        for (const src of unique.slice(0, cap)) {
            const d = await toDataURL(src);
            if (d) bySrc[src] = d;
        }
        return srcLists.map(list => list.map(s => bySrc[s]).filter(Boolean));
    }

    // ---- Strategy 1: Claude-style virtualized transcript ----

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
    function harvest() {
        for (const el of document.querySelectorAll("[data-index]")) {
            const idx = parseInt(el.getAttribute("data-index"), 10);
            if (isNaN(idx)) continue;
            const t = el.innerText || "";
            if (!(idx in turnTexts) || t.length > turnTexts[idx].length) turnTexts[idx] = t;
            for (const img of el.querySelectorAll("img")) {
                const src = goodImage(img);
                if (src) (turnImages[idx] = turnImages[idx] || new Set()).add(src);
            }
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

    const keys = Object.keys(turnTexts).map(Number).sort((a, b) => a - b);
    if (keys.length > 0) {
        const srcLists = keys.map(k => [...(turnImages[k] || [])]);
        const imgLists = await resolveImages(srcLists, 24);
        return keys.map((k, i) => ({
            text: turnTexts[k],
            role: null,
            images: imgLists[i]
        }));
    }

    // ---- Strategy 2: static turn containers (public share pages) ----

    const SELECTOR_SETS = [
        [
            { sel: '[data-message-author-role="user"]', role: "user" },
            { sel: '[data-message-author-role="assistant"]', role: "assistant" }
        ],
        [
            { sel: "user-query", role: "user" },
            { sel: "model-response", role: "assistant" }
        ],
        [
            { sel: '[data-testid^="conversation-turn"]', role: null }
        ],
        [
            { sel: "main article", role: null }
        ]
    ];

    for (const set of SELECTOR_SETS) {
        const nodes = [];
        for (const { sel, role } of set) {
            for (const node of document.querySelectorAll(sel)) {
                const text = node.innerText || "";
                if (!text.trim()) continue;
                nodes.push({ node, role, text });
            }
        }
        if (nodes.length === 0) continue;
        nodes.sort((a, b) =>
            (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1
        );
        const srcLists = nodes.map(n => {
            const srcs = [];
            for (const img of n.node.querySelectorAll("img")) {
                const src = goodImage(img);
                if (src && !srcs.includes(src)) srcs.push(src);
            }
            return srcs;
        });
        const imgLists = await resolveImages(srcLists, 24);
        return nodes.map((n, i) => ({
            text: n.text,
            role: n.role,
            images: imgLists[i]
        }));
    }

    // ---- Strategy 3: full page ----

    const pageSrcs = [];
    for (const img of document.querySelectorAll("img")) {
        const src = goodImage(img);
        if (src && !pageSrcs.includes(src)) pageSrcs.push(src);
    }
    const pageImages = (await resolveImages([pageSrcs], 12))[0];
    return [{ text: document.body.innerText || "", role: null, images: pageImages }];
    """
}
