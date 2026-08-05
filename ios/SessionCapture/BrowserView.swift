import SwiftUI

struct BrowserView: View {
    @EnvironmentObject private var browser: WebViewModel
    @EnvironmentObject private var store: SessionStore
    @State private var capturing = false
    @State private var resultMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    TextField("Session or share link", text: $browser.urlString)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit { browser.loadCurrent() }
                    Button("Go") { browser.loadCurrent() }
                        .buttonStyle(.bordered)
                }
                .padding(8)

                Divider()

                WebView(webView: browser.webView)
                    .overlay(alignment: .top) {
                        if browser.isLoading {
                            ProgressView()
                                .padding(.top, 12)
                        }
                    }
            }
            .navigationTitle("Session Capture")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if capturing {
                        ProgressView()
                    } else {
                        Button {
                            Task { await capture() }
                        } label: {
                            Label("Capture", systemImage: "square.and.arrow.down")
                        }
                    }
                }
            }
            .alert(
                "Capture",
                isPresented: Binding(
                    get: { resultMessage != nil },
                    set: { if !$0 { resultMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { resultMessage = nil }
            } message: {
                Text(resultMessage ?? "")
            }
        }
    }

    @MainActor
    private func capture() async {
        capturing = true
        defer { capturing = false }
        do {
            let turns = try await browser.captureTranscript()
            let nonEmpty = turns.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            guard !nonEmpty.isEmpty else {
                resultMessage = "Nothing to capture on this page yet — make sure the conversation is visible, then try again."
                return
            }
            let title = browser.pageTitle.isEmpty
                ? (browser.webView.url?.host ?? "Session")
                : browser.pageTitle
            let session = CapturedSession(
                id: UUID(),
                title: title,
                sourceURL: browser.webView.url?.absoluteString ?? browser.urlString,
                capturedAt: Date(),
                turns: nonEmpty
            )
            store.add(session)
            resultMessage = "Saved \(nonEmpty.count) turn group\(nonEmpty.count == 1 ? "" : "s") to Library."
        } catch {
            resultMessage = "Capture failed: \(error.localizedDescription)"
        }
    }
}
