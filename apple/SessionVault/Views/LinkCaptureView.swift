import SwiftUI
import WebKit

#if os(macOS)
private struct WebViewRepresentable: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#else
private struct WebViewRepresentable: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif

/// In-app browser for shared session links: the user logs in as themselves,
/// then Capture scroll-harvests the rendered transcript into turn blocks.
struct LinkCaptureView: View {
    let initialURL: URL
    var onCapture: ([String], String?, Data?, URL) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var controller = WebCaptureController()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    statusIcon
                    Text(controller.status)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.plain)
                Button {
                    Task {
                        let detectedTitle = await controller.detectTitle()
                        let pdf = await controller.snapshotPDF()
                        let turns = await controller.capture()
                        guard !turns.isEmpty else { return }
                        // Save-guard: never persist a sign-in wall or unhydrated
                        // landing page as a session — keep the browser open so the
                        // user can log in or wait, then try again.
                        if SessionImporter.looksLikeSignInWall(turns) {
                            controller.status = "That looks like a sign-in or landing page — log in below (or wait for the conversation to appear), then press Capture again."
                            return
                        }
                        onCapture(turns, detectedTitle, pdf, initialURL)
                        dismiss()
                    }
                } label: {
                    Text("Capture Transcript")
                }
                .buttonStyle(.borderedProminent)
                .disabled(controller.isCapturing || !controller.pageLoaded)
            }
            .padding(10)
            .background(.bar)
            Divider()
            WebViewRepresentable(webView: controller.webView)
        }
        .onAppear { controller.load(initialURL) }
        #if os(macOS)
        .frame(minWidth: 800, minHeight: 600)
        #endif
    }

    /// Small leading glyph mirroring capture state: spinner while capturing,
    /// checkmark once the status reports a capture, globe while browsing.
    @ViewBuilder
    private var statusIcon: some View {
        if controller.isCapturing {
            ProgressView()
                .controlSize(.small)
        } else if controller.status.hasPrefix("Captured") {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        } else {
            Image(systemName: "globe")
                .foregroundStyle(.secondary)
        }
    }
}
