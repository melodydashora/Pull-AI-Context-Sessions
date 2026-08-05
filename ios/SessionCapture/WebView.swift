import SwiftUI
import WebKit

/// Owns the single WKWebView for the app. The default (persistent) website
/// data store keeps the user's claude.ai / gemini login across launches,
/// playing the role of the desktop tool's browser profile directory.
@MainActor
final class WebViewModel: NSObject, ObservableObject {
    let webView: WKWebView

    @Published var urlString: String = "https://claude.ai"
    @Published var isLoading: Bool = false
    @Published var pageTitle: String = ""

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
    }

    func loadCurrent() {
        var text = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if !text.lowercased().hasPrefix("http") {
            text = "https://" + text
        }
        guard let url = URL(string: text) else { return }
        urlString = text
        webView.load(URLRequest(url: url))
    }

    /// Runs the capture script in the page and returns the transcript turns.
    func captureTranscript() async throws -> [String] {
        try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                CaptureEngine.script,
                arguments: [:],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: (value as? [String]) ?? [])
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

extension WebViewModel: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        urlString = webView.url?.absoluteString ?? urlString
        pageTitle = webView.title ?? ""
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        isLoading = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        isLoading = false
    }
}

struct WebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView {
        webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
