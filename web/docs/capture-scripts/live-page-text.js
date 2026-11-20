/*
 * capture-scripts/live-page-text.js
 *
 * Page script lifted out of this repository for the web-app handoff.
 * capture.md explains how it is used. Keep this copy unchanged as the
 * record of what the existing code does; put fixes in the web extractor.
 *
 * Source:   apple/SessionVault/WebCapture.swift, line 176 (string literal in
 *           capture()).
 * Run as:   WKWebView.evaluateJavaScript(<this text>), only when no
 *           [data-index] turn was harvested (whole-page fallback).
 * Returns:  a string: the rendered text of the whole page.
 * Verbatim: everything below the line "// ---- begin verbatim ----" is
 *           byte-identical to the string the source code evaluates; one
 *           trailing newline was added.
 */
// ---- begin verbatim ----
document.body.innerText
