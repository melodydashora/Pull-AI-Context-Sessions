import UIKit
import WebKit

/// Renders a session's self-contained HTML (transcript + embedded images)
/// to a PDF file using an offscreen WKWebView. Because the images are data
/// URIs inside the HTML, the resulting PDF is a single portable document —
/// the whole context window, saved, no sign-in needed to open it.
@MainActor
final class PDFExporter: NSObject, WKNavigationDelegate {
    private var webView: WKWebView?
    private var continuation: CheckedContinuation<URL, Error>?
    private var outputURL: URL?

    enum ExportError: Error { case renderFailed }

    func export(html: String, title: String) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            self.continuation = cont
            self.outputURL = Self.tempURL(title: title)
            // US Letter at 72 dpi; createPDF paginates the full content.
            let frame = CGRect(x: 0, y: 0, width: 612, height: 792)
            let wv = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
            wv.navigationDelegate = self
            self.webView = wv
            wv.loadHTMLString(html, baseURL: nil)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Let layout settle a beat before capturing.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self else { return }
            webView.createPDF(configuration: WKPDFConfiguration()) { result in
                switch result {
                case .success(let data):
                    if let url = self.outputURL {
                        do {
                            try data.write(to: url)
                            self.finish(.success(url))
                        } catch {
                            self.finish(.failure(error))
                        }
                    } else {
                        self.finish(.failure(ExportError.renderFailed))
                    }
                case .failure(let error):
                    self.finish(.failure(error))
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(.failure(error))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(.failure(error))
    }

    private func finish(_ result: Result<URL, Error>) {
        guard let cont = continuation else { return }
        continuation = nil
        webView = nil
        switch result {
        case .success(let url): cont.resume(returning: url)
        case .failure(let error): cont.resume(throwing: error)
        }
    }

    private static func tempURL(title: String) -> URL {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " -_"))
        var safe = String(title.unicodeScalars.filter { allowed.contains($0) })
            .trimmingCharacters(in: .whitespaces)
        if safe.isEmpty { safe = "session" }
        return FileManager.default.temporaryDirectory
            .appendingPathComponent(safe)
            .appendingPathExtension("pdf")
    }
}
