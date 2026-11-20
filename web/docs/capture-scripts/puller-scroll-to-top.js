/*
 * capture-scripts/puller-scroll-to-top.js
 *
 * Page script lifted out of this repository for the web-app handoff.
 * capture.md explains how it is used. Keep this copy unchanged as the
 * record of what the existing code does; put fixes in the web extractor.
 *
 * Source:   puller/pull_sessions.py, line 159 (a Python string literal).
 *           These are the lines and the text of commit 146257c. The puller
 *           changes; this copy records that commit and is not updated with it.
 * Run as:   Playwright (Python) Locator.evaluate(<this text>) on the scroller,
 *           through scroll_eval(js), lines 147-156.
 * Returns:  undefined.
 * Verbatim: everything below the line "// ---- begin verbatim ----" is
 *           byte-identical to the Python string value; one trailing newline
 *           was added. The text is a function expression that takes the
 *           element as `el`. Playwright for Python calls such a string as a
 *           function. Playwright for Node does not: there, pass a real
 *           function or call the text yourself.
 */
// ---- begin verbatim ----
el => { el.scrollTop = 0 }
