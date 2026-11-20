import Foundation
import WebKit

/// Drives a WKWebView showing a shared session page (e.g. claude.ai/code/session_…)
/// and scroll-harvests the rendered transcript, mirroring pull_sessions.py:
/// virtualized turn groups are `[data-index]` elements, only a handful exist in the
/// DOM at once, so we walk the scroller and keep the longest text seen per index.
@MainActor
final class WebCaptureController: NSObject, ObservableObject {
    @Published var status = "Load the session link, log in if asked, then press Capture."
    @Published var isCapturing = false
    @Published var pageLoaded = false

    let webView: WKWebView
    private var capturedTurns: [Int: String] = [:]

    /// Fixed identifier so the browser's cookies survive rebuilds — ad-hoc dev
    /// signing gives each build a fresh app identity, which resets the default
    /// store's logins (verified: Google sign-outs began exactly at a rebuild).
    private static let dataStoreID = UUID(uuidString: "7A78BB2E-30D1-4E5C-9B8F-1D2E3F4A5B6C")!

    override init() {
        let configuration = WKWebViewConfiguration()
        // Identifier-keyed store on macOS only: it fixes login loss across
        // ad-hoc-signed rebuilds there, but its Swift-overlay symbol is missing
        // from the iOS 18.4 simulator runtime (dyld crash at launch). iOS app
        // identity is stable, so the default store is correct on that side.
        #if os(macOS)
        if #available(macOS 14.0, *) {
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: Self.dataStoreID)
        } else {
            configuration.websiteDataStore = .default()
        }
        #else
        configuration.websiteDataStore = .default()
        #endif
        self.webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
    }

    func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    private func evaluate(_ js: String) async -> Any? {
        await withCheckedContinuation { continuation in
            webView.evaluateJavaScript(js) { result, _ in
                continuation.resume(returning: result)
            }
        }
    }

    /// Runs `body` with `el` bound to the transcript scroller. The scroller is
    /// re-resolved on every call: virtualized re-renders can replace the node.
    private func scrollerEval(_ body: String) async -> Any? {
        let js = """
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
          \(body)
        })()
        """
        return await evaluate(js)
    }

    private func harvest() async {
        let js = """
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
        """
        guard let json = await evaluate(js) as? String,
              let data = json.data(using: .utf8),
              let dict = try? JSONDecoder().decode([String: String].self, from: data) else { return }
        for (key, text) in dict {
            guard let index = Int(key) else { continue }
            if text.count > (capturedTurns[index]?.count ?? 0) {
                capturedTurns[index] = text
            }
        }
    }

    /// Best-effort session title from the page: first heading, else document title,
    /// with boilerplate suffixes stripped.
    func detectTitle() async -> String? {
        let js = """
        (function() {
          const h = document.querySelector('h1, h2');
          return ((h && h.innerText) || document.title || '').trim();
        })()
        """
        guard var title = await evaluate(js) as? String else { return nil }
        for suffix in [" - Claude", " – Claude", " | Claude", " - ChatGPT", " | ChatGPT"] {
            if title.hasSuffix(suffix) { title = String(title.dropLast(suffix.count)) }
        }
        title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let boilerplate = ["", "Claude", "Claude Code", "ChatGPT", "Gemini", "Just a moment..."]
        return boilerplate.contains(title) ? nil : title
    }

    /// Renders the full page into a PDF exactly as displayed — the webview is
    /// temporarily grown to the page's full content height so nothing is cut off.
    func snapshotPDF() async -> Data? {
        let contentHeight = (await evaluate("document.body.scrollHeight") as? Double) ?? 0
        let oldFrame = webView.frame
        if contentHeight > oldFrame.height {
            webView.frame = CGRect(
                x: 0, y: 0,
                width: max(oldFrame.width, 800),
                height: min(contentHeight, 40000)
            )
            try? await Task.sleep(nanoseconds: 700_000_000)
        }
        // The Result-typed createPDF wrapper lives in WebKit's Swift overlay
        // (libswiftWebKit), which the iOS 18.4 simulator runtime doesn't ship —
        // linking it aborts the whole app at launch. The underscored ObjC
        // import carries no overlay dependency and behaves identically.
        let data: Data? = await withCheckedContinuation { continuation in
            webView.__createPDF(with: .init()) { pdfData, _ in
                continuation.resume(returning: pdfData)
            }
        }
        webView.frame = oldFrame
        return data
    }

    /// Scrolls the transcript container top-to-bottom, harvesting as it goes.
    /// Returns the turn texts in order, or a single whole-page text as fallback.
    func capture() async -> [String] {
        isCapturing = true
        capturedTurns = [:]
        defer { isCapturing = false }

        status = "Capturing…"
        _ = await scrollerEval("el.scrollTop = 0; return true;")
        try? await Task.sleep(nanoseconds: 600_000_000)

        var settled = 0
        for _ in 0..<800 {
            await harvest()
            guard let atBottom = await scrollerEval(
                "return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;"
            ) as? Bool else { break }
            if atBottom {
                // Late-loading content can grow scrollHeight after we hit bottom;
                // only stop once the bottom stays put for two passes.
                await harvest()
                settled += 1
                if settled >= 2 { break }
                try? await Task.sleep(nanoseconds: 800_000_000)
                continue
            }
            settled = 0
            _ = await scrollerEval("el.scrollTop += el.clientHeight * 0.8; return true;")
            try? await Task.sleep(nanoseconds: 450_000_000)
        }

        if capturedTurns.isEmpty {
            if let text = await evaluate("document.body.innerText") as? String,
               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                status = "Captured page text (no turn structure found)."
                return [text]
            }
            status = "Nothing captured — is the transcript visible in the page?"
            return []
        }
        status = "Captured \(capturedTurns.count) turns."
        return capturedTurns.sorted { $0.key < $1.key }.map(\.value)
    }
}

extension WebCaptureController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        pageLoaded = false
        status = "Loading page…"
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoaded = true
        status = "Page loaded — sign in if needed, then press Capture once the conversation is visible."
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        pageLoaded = true
        status = "Page had trouble loading — if the conversation is visible you can still press Capture."
    }
}
