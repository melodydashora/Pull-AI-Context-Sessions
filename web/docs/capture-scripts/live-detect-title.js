/*
 * capture-scripts/live-detect-title.js
 *
 * Page script lifted out of this repository for the web-app handoff.
 * capture.md explains how it is used. Keep this copy unchanged as the
 * record of what the existing code does; put fixes in the web extractor.
 *
 * Source:   apple/SessionVault/WebCapture.swift, lines 103-108 (the string
 *           literal `js` in detectTitle(); its text is lines 104-107).
 * Run as:   WKWebView.evaluateJavaScript(<this text>). Swift post-processes
 *           the result on lines 109-115 (suffix stripping and a boilerplate
 *           list).
 * Returns:  a string: the trimmed innerText of the first h1 or h2 in document
 *           order, else the trimmed document.title, else "".
 * Verbatim: everything below the line "// ---- begin verbatim ----" is
 *           byte-identical to the string the source code evaluates; one
 *           trailing newline was added.
 */
// ---- begin verbatim ----
(function() {
  const h = document.querySelector('h1, h2');
  return ((h && h.innerText) || document.title || '').trim();
})()
