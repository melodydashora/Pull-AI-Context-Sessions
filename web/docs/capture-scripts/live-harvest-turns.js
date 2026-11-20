/*
 * capture-scripts/live-harvest-turns.js
 *
 * Page script lifted out of this repository for the web-app handoff.
 * capture.md explains how it is used. Keep this copy unchanged as the
 * record of what the existing code does; put fixes in the web extractor.
 *
 * Source:   apple/SessionVault/WebCapture.swift, lines 76-88 (the string
 *           literal `js` in harvest(); its text is lines 77-87).
 * Run as:   WKWebView.evaluateJavaScript(<this text>). Swift decodes the
 *           result on lines 89-97 and keeps, per index, the longest text seen
 *           across calls.
 * Returns:  a JSON string: an object whose keys are data-index values and
 *           whose values are the innerText of those elements (the longest one
 *           when an index occurs twice in the DOM).
 * Verbatim: everything below the line "// ---- begin verbatim ----" is
 *           byte-identical to the string the source code evaluates; one
 *           trailing newline was added.
 */
// ---- begin verbatim ----
(function() {
  const out = {};
  document.querySelectorAll('[data-index]').forEach(el => {
    const i = parseInt(el.getAttribute('data-index'));
    if (!isNaN(i)) {
      const t = el.innerText || '';
      if (!(i in out) || t.length > out[i].length) { out[i] = t; }
    }
  });
  return JSON.stringify(out);
})()
