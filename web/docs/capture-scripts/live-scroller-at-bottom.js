/*
 * capture-scripts/live-scroller-at-bottom.js
 *
 * Page script lifted out of this repository for the web-app handoff.
 * capture.md explains how it is used. Keep this copy unchanged as the
 * record of what the existing code does; put fixes in the web extractor.
 *
 * Source:   apple/SessionVault/WebCapture.swift, lines 57-71 (the string
 *           literal in scrollerEval(_:); its text is lines 58-70), with the
 *           Swift interpolation \(body) on line 69 replaced by the string
 *           literal on line 159.
 * Run as:   WKWebView.evaluateJavaScript(<this text>); the value of the call
 *           expression is the result. The scroller is looked up again on every
 *           call (source lines 59-67).
 * Returns:  a boolean: true when the scroller is within 4 px of its bottom.
 * Verbatim: everything below the line "// ---- begin verbatim ----" is
 *           byte-identical to the string the Swift code builds at run time;
 *           one trailing newline was added.
 */
// ---- begin verbatim ----
(function() {
  let scroller = null;
  for (const el of document.querySelectorAll('*')) {
    const st = getComputedStyle(el);
    if (!/(auto|scroll)/.test(st.overflowY)) continue;
    if (el.scrollHeight > el.clientHeight + 8 && el.querySelectorAll('[data-index]').length > 0) {
      scroller = el; break;
    }
  }
  if (!scroller) { scroller = document.scrollingElement; }
  const el = scroller;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
})()
