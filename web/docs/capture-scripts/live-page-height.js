/*
 * capture-scripts/live-page-height.js
 *
 * Page script lifted out of this repository for the web-app handoff.
 * capture.md explains how it is used. Keep this copy unchanged as the
 * record of what the existing code does; put fixes in the web extractor.
 *
 * Source:   apple/SessionVault/WebCapture.swift, line 121 (string literal in
 *           snapshotPDF()).
 * Run as:   WKWebView.evaluateJavaScript(<this text>), before the PDF
 *           snapshot.
 * Returns:  a number: the scroll height of <body> in CSS pixels.
 * Verbatim: everything below the line "// ---- begin verbatim ----" is
 *           byte-identical to the string the source code evaluates; one
 *           trailing newline was added.
 */
// ---- begin verbatim ----
document.body.scrollHeight
