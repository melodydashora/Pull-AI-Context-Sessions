/*
 * capture-scripts/puller-scroller-probe.js
 *
 * Page script lifted out of this repository for the web-app handoff.
 * capture.md explains how it is used. Keep this copy unchanged as the
 * record of what the existing code does; put fixes in the web extractor.
 *
 * Source:   puller/pull_sessions.py, lines 86-87 (a Python string literal; two
 *           adjacent pieces that Python joins into one string).
 *           These are the lines and the text of commit 146257c. The puller
 *           changes; this copy records that commit and is not updated with it.
 * Run as:   Playwright (Python) Locator.evaluate(<this text>) on each scroller
 *           candidate inside find_scroller(page), lines 70-95.
 * Returns:  an object {scrolls: boolean, turns: number}.
 * Verbatim: everything below the line "// ---- begin verbatim ----" is
 *           byte-identical to the Python string value; one trailing newline
 *           was added. The text is a function expression that takes the
 *           element as `el`. Playwright for Python calls such a string as a
 *           function. Playwright for Node does not: there, pass a real
 *           function or call the text yourself.
 */
// ---- begin verbatim ----
el => ({scrolls: el.scrollHeight > el.clientHeight + 4, turns: el.querySelectorAll('[data-index]').length})
