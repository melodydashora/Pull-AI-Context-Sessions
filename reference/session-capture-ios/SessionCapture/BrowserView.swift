import SwiftUI
import UIKit

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
                    Button {
                        if let pasted = UIPasteboard.general.string {
                            browser.urlString = pasted
                            browser.loadCurrent()
                        }
                    } label: {
                        Image(systemName: "doc.on.clipboard")
                    }
                    .buttonStyle(.bordered)
                    .help("Paste link and go")
                    Button("Go") { browser.loadCurrent() }
                        .buttonStyle(.borderedProminent)
                }
                .padding(10)

                Divider()

                WebView(webView: browser.webView)
                    .overlay(alignment: .top) {
                        if browser.isLoading {
                            ProgressView()
                                .padding(.top, 12)
                        }
                    }
                    .overlay {
                        if !browser.hasLoadedPage {
                            startHint
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

    private var startHint: some View {
        VStack(spacing: 12) {
            Image(systemName: "link.badge.plus")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("Paste any public AI chat share link")
                .font(.headline)
            Text("Claude, ChatGPT, Gemini and more — public links need no sign-in. Load the page, then tap Capture to save the full transcript with images.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }

    @MainActor
    private func capture() async {
        capturing = true
        defer { capturing = false }
        do {
            let raw = try await browser.captureTranscript()
            let nonEmpty = raw.filter {
                !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || !$0.imageDataURLs.isEmpty
            }
            guard !nonEmpty.isEmpty else {
                resultMessage = "Nothing to capture on this page yet — make sure the conversation is visible, then try again."
                return
            }
            let title = browser.pageTitle.isEmpty
                ? (browser.webView.url?.host ?? "Session")
                : browser.pageTitle
            let session = store.add(
                title: title,
                sourceURL: browser.webView.url?.absoluteString ?? browser.urlString,
                rawTurns: nonEmpty
            )
            let images = session.imageCount
            var message = "Saved \(session.turns.count) turn group\(session.turns.count == 1 ? "" : "s")"
            if images > 0 {
                message += " and \(images) image\(images == 1 ? "" : "s")"
            }
            message += " to Library (\(SessionStore.defaultProject))."
            resultMessage = message
        } catch {
            resultMessage = "Capture failed: \(error.localizedDescription)"
        }
    }
}
