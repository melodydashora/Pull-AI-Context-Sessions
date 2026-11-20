/*
 * capture-scripts/proposed/web-extractor.prototype.js
 *
 * NOT verbatim. A prototype written for the web-app handoff, to show one
 * way of merging the three extractors of this repository into a single
 * page function driven by a selectors data file. Port it to TypeScript,
 * own it and test it; do not treat it as finished. See capture.md,
 * section 7.2.
 *
 * Where the parts come from:
 *   scroll walk and its constants   apple/SessionVault/WebCapture.swift:146-173
 *   scroller found by computed style apple/SessionVault/WebCapture.swift:58-67
 *   longest text per index           apple/SessionVault/WebCapture.swift:79-84, 92-96
 *   turn containers with roles       reference/session-capture-ios/SessionCapture/
 *                                    CaptureEngine.swift:135-179
 *   whole-page fallback              apple/SessionVault/WebCapture.swift:176
 * What is new: strategies come from data; a container strategy with roles
 * needs both roles; matches nested in other matches are dropped; an indexed
 * list must account for most of the page text; when several indexed lists
 * exist the one with the most text wins; buttons are left out of turn text;
 * the text of <pre> blocks is fenced; a heading inside a turn is not a
 * title; a time limit; a result object that says which strategy ran and
 * what was tried.
 *
 * Contract: sessionVaultExtract(config) -> Promise<result>
 *   config  = defaults of capture-selectors.draft.json merged with one
 *             provider's strategies, in that provider's order:
 *             { strategies: [...], excludeInTurn: [...], fenceCode, coverageMin,
 *               maxMs, timing: { startMs, stepMs, settleMs, maxSteps } }
 *   result  = { extractor, url, title, heading, strategy: {id, type} | null,
 *               turns: [{ index, role: "user" | "assistant" | null, text }],
 *               partial, warnings: [...], attempts: [...],
 *               signals: { passwordInputs, bodyTextLength }, elapsedMs }
 * The function runs inside the page. It imports nothing, uses no eval and
 * no innerHTML, makes no network request, and scrolls the page.
 *
 * Tested: WebKit (macOS 27.2.1, WKWebView 1000 x 700, off screen) against
 * the pages in ../fixtures on 2026-11-20; results in ../fixtures/expected.json.
 * Not tested in Chromium or Firefox, and never run against a real provider page.
 */
async function sessionVaultExtract(config) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const t0 = Date.now();
  const deadline = t0 + (config.maxMs || 60000);
  const timing = Object.assign({ startMs: 600, stepMs: 450, settleMs: 800, maxSteps: 800 }, config.timing || {});
  const exclude = (config.excludeInTurn || []).join(",");
  const coverageMin = config.coverageMin == null ? 0.5 : config.coverageMin;
  const warnings = [];
  const attempts = [];

  const pageScroller = () => document.scrollingElement || document.documentElement;
  const bodyTextLength = () => ((document.body && document.body.innerText) || "").trim().length;

  // Puts a Markdown fence around the text of every <pre> inside `node`, so
  // that later text cleaning can leave code alone. Only the string changes;
  // the DOM is not touched. A block whose text cannot be found on its own
  // lines in `text` is left as it is.
  function fenceCode(node, text) {
    let cursor = 0;
    let out = "";
    for (const pre of node.querySelectorAll("pre")) {
      if (pre.parentElement && pre.parentElement.closest("pre")) continue;
      const codeEl = pre.querySelector("code") || pre;
      const code = (codeEl.innerText || "").replace(/\n+$/, "");
      if (!code.trim()) continue;
      const ownLines = (at) =>
        (at === 0 || text[at - 1] === "\n") && (at + code.length === text.length || text[at + code.length] === "\n");
      let at = text.indexOf(code, cursor);
      while (at >= 0 && !ownLines(at)) at = text.indexOf(code, at + 1);
      if (at < 0) continue;
      const language = ((codeEl.getAttribute("class") || "").match(/(?:^|\s)language-([A-Za-z0-9_+#-]+)/) || [])[1] || "";
      out += text.slice(cursor, at) + "```" + language + "\n" + code + "\n```";
      cursor = at + code.length;
    }
    return out + text.slice(cursor);
  }

  // innerText of `node`, with the excluded descendants hidden for the read.
  function readText(node) {
    const saved = [];
    if (exclude) {
      for (const el of node.querySelectorAll(exclude)) {
        saved.push([el, el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")]);
        el.style.setProperty("display", "none", "important");
      }
    }
    let text = node.innerText || "";
    if (config.fenceCode) text = fenceCode(node, text);
    for (const [el, value, priority] of saved) {
      if (value) el.style.setProperty("display", value, priority);
      else el.style.removeProperty("display");
    }
    return text;
  }

  // Nearest ancestor that scrolls vertically, else the page scroller. <body>
  // only counts when its overflow is not handed to the viewport, which is the
  // case when the root element's own overflow is not `visible`.
  function scrollerOf(node) {
    const root = document.documentElement;
    for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
      if (el === document.body && getComputedStyle(root).overflowY === "visible") break;
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 8) return el;
    }
    return pageScroller();
  }

  // Scroll containers that hold elements matching `selector`, ordered by the
  // amount of matching text they show right now (largest first).
  function rankScrollers(selector) {
    const mass = new Map();
    for (const node of document.querySelectorAll(selector)) {
      const s = scrollerOf(node);
      mass.set(s, (mass.get(s) || 0) + (node.innerText || "").length + 1);
    }
    return [...mass.entries()].sort((a, b) => b[1] - a[1]).map((entry) => entry[0]);
  }

  // Top-to-bottom walk with the constants of WebCapture.swift:146-173.
  // `start` is the scroller; `repick()` is asked for a replacement only when
  // that node has left the document (a re-render can replace it).
  // `onStep(scroller)` runs before every move and twice at the bottom.
  // Returns true when the bottom was reached and stayed put.
  async function scrollThrough(start, repick, onStep) {
    let current = start;
    const resolve = () => (current && current.isConnected ? current : (current = repick()));
    let el = resolve();
    el.scrollTop = 0;
    await sleep(timing.startMs);
    let settled = 0;
    let stuck = 0;
    for (let i = 0; i < timing.maxSteps; i++) {
      if (Date.now() > deadline) return false;
      el = resolve();
      onStep(el);
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
        onStep(el);
        settled += 1;
        if (settled >= 2) return true;
        await sleep(timing.settleMs);
        continue;
      }
      settled = 0;
      const before = el.scrollTop;
      el.scrollTop += el.clientHeight * 0.8;
      stuck = el.scrollTop === before ? stuck + 1 : 0;
      if (stuck >= 2) {
        warnings.push("scroller_did_not_move");
        return false;
      }
      await sleep(timing.stepMs);
    }
    return false;
  }

  const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});

  // Strategy "indexed": turns carry an index attribute and may be
  // virtualized. A page can hold more than one such list (a sidebar, for
  // instance), each in its own scroll container. Every list, up to
  // `maxLists`, is walked on its own and the one that yields the most text
  // is taken as the transcript.
  async function indexed(strategy) {
    const selector = strategy.selector;
    const attribute = strategy.indexAttribute || "data-index";
    if (!document.querySelector(selector)) return fail("no_match");
    const lists = rankScrollers(selector).slice(0, strategy.maxLists || 3);
    let best = null;
    for (let rank = 0; rank < lists.length; rank++) {
      const texts = new Map();
      const harvest = (scroller) => {
        for (const el of document.querySelectorAll(selector)) {
          if (el.parentElement && el.parentElement.closest(selector)) continue;
          if (scrollerOf(el) !== scroller) continue;
          const index = parseInt(el.getAttribute(attribute), 10);
          if (isNaN(index)) continue;
          const text = readText(el);
          if (text.length > (texts.get(index) || "").length) texts.set(index, text);
        }
      };
      const repick = () => rankScrollers(selector)[rank] || pageScroller();
      const complete = await scrollThrough(lists[rank], repick, harvest);
      let total = 0;
      for (const text of texts.values()) total += text.length;
      if (best === null || total > best.total) best = { texts, total, complete };
    }
    const keys = [...best.texts.keys()].sort((a, b) => a - b);
    if (keys.length === 0) return fail("no_text");
    if (best.total < coverageMin * bodyTextLength()) return fail("low_coverage", { turns: keys.length });
    if (keys[keys.length - 1] - keys[0] + 1 !== keys.length) warnings.push("index_gaps");
    if (lists.length > 1) warnings.push("several_indexed_lists");
    return {
      ok: true,
      partial: !best.complete,
      turns: keys.map((k) => ({ index: k, role: null, text: best.texts.get(k) })),
      turnSelector: selector,
    };
  }

  // Strategy "containers": turn elements that are all in the DOM at once.
  // `selectors` items are {sel, role}; role is "user", "assistant" or null.
  async function containers(strategy) {
    const union = strategy.selectors.map((s) => s.sel).join(",");
    if (!document.querySelector(union)) return fail("no_match");
    const pick = () => rankScrollers(union)[0] || pageScroller();
    let before = document.querySelectorAll(union).length;
    let dropped = false;
    const complete = await scrollThrough(pick(), pick, () => {
      const now = document.querySelectorAll(union).length;
      if (now < before) dropped = true;
      before = now;
    });
    let items = [];
    for (const { sel, role } of strategy.selectors) {
      for (const node of document.querySelectorAll(sel)) {
        if (!items.some((it) => it.node === node)) items.push({ node, role: role || null });
      }
    }
    // Keep outermost matches only: a match inside another match is a part of
    // that turn, not a turn of its own.
    const nodes = items.map((it) => it.node);
    items = items.filter((it) => !nodes.some((other) => other !== it.node && other.contains(it.node)));
    items = items.map((it) => Object.assign(it, { text: readText(it.node) })).filter((it) => it.text.trim());
    items.sort((a, b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const roles = new Set(items.map((it) => it.role));
    const needBoth = strategy.requireBothRoles !== false && strategy.selectors.some((s) => s.role);
    if (needBoth && !(roles.has("user") && roles.has("assistant"))) {
      return fail("one_role_only", { turns: items.length });
    }
    if (items.length < (strategy.minTurns || 2)) return fail("too_few_turns", { turns: items.length });
    if (!needBoth) {
      const total = items.reduce((n, it) => n + it.text.length, 0);
      if (total < coverageMin * bodyTextLength()) return fail("low_coverage", { turns: items.length });
    }
    if (dropped) warnings.push("turn_count_dropped_while_scrolling");
    return {
      ok: true,
      partial: !complete || dropped,
      turns: items.map((it, i) => ({ index: i, role: it.role, text: it.text })),
      turnSelector: union,
    };
  }

  // Strategy "page-text": the rendered text of the whole page as one block.
  async function pageText() {
    const complete = await scrollThrough(pageScroller(), pageScroller, () => {});
    const text = (document.body && document.body.innerText) || "";
    if (!text.trim()) return fail("empty_page");
    return { ok: true, partial: !complete, turns: [{ index: 0, role: null, text }], turnSelector: null };
  }

  let chosen = null;
  let strategyUsed = null;
  for (const strategy of config.strategies) {
    const mark = warnings.length;
    let outcome;
    try {
      if (strategy.type === "indexed") outcome = await indexed(strategy);
      else if (strategy.type === "containers") outcome = await containers(strategy);
      else if (strategy.type === "page-text") outcome = await pageText();
      else outcome = fail("unknown_type");
    } catch (error) {
      outcome = fail("error", { message: String(error && error.message ? error.message : error) });
    }
    attempts.push({
      id: strategy.id,
      type: strategy.type,
      ok: outcome.ok,
      reason: outcome.reason || null,
      turns: outcome.ok ? outcome.turns.length : outcome.turns || 0,
    });
    if (outcome.ok) {
      chosen = outcome;
      strategyUsed = { id: strategy.id, type: strategy.type };
      break;
    }
    warnings.length = mark; // warnings of a strategy that failed do not describe the result
    if (Date.now() > deadline) break;
  }

  // First h1/h2 that is not part of a turn.
  let heading = null;
  for (const h of document.querySelectorAll("h1, h2")) {
    if (chosen && chosen.turnSelector && h.closest(chosen.turnSelector)) continue;
    const text = (h.innerText || "").trim();
    if (text) {
      heading = text;
      break;
    }
  }

  return {
    extractor: "sessionvault-extract/0.1",
    url: location.href,
    title: (document.title || "").trim(),
    heading,
    strategy: strategyUsed,
    turns: chosen ? chosen.turns : [],
    partial: chosen ? chosen.partial : false,
    warnings,
    attempts,
    signals: {
      passwordInputs: document.querySelectorAll('input[type="password"]').length,
      bodyTextLength: bodyTextLength(),
    },
    elapsedMs: Date.now() - t0,
  };
}
