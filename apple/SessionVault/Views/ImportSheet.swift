import SwiftUI
import SwiftData
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct ImportSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var showingFilePicker = false
    @State private var statusMessage = ""
    @State private var pasteProvider: Provider = .claude
    @State private var linkText = ""
    @State private var customName = ""
    @State private var captureTarget: CaptureTarget?

    private struct CaptureTarget: Identifiable {
        let id = UUID()
        let url: URL
    }

    private static let importTypes: [UTType] = {
        var types: [UTType] = [.json, .plainText, .text]
        if let md = UTType(filenameExtension: "md") { types.append(md) }
        return types
    }()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://claude.ai/code/session_…", text: $linkText)
                        .textFieldStyle(.roundedBorder)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .autocorrectionDisabled()
                    TextField("Name (optional — auto-detected from the page)", text: $customName)
                        .textFieldStyle(.roundedBorder)
                    Button {
                        openLinkCapture()
                    } label: {
                        Label("Open & Capture Transcript…", systemImage: "safari")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(URL(string: linkText.trimmingCharacters(in: .whitespaces)) == nil)
                    if linkText.contains("claude.ai"), !linkText.contains("/share/") {
                        Label(
                            "Tip: in Claude, tap Share on the conversation and paste that share link instead — share links capture with no sign-in at all.",
                            systemImage: "lightbulb"
                        )
                        .font(.caption)
                        .foregroundStyle(.orange)
                    }
                    Text("Public share links (claude.ai/share/…) capture with no login — that's the recommended flow. Press Capture Transcript once the conversation is visible, and it's saved as a formatted User/Assistant transcript.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } header: {
                    sectionHeader("From Link", systemImage: "safari")
                }
                Section {
                    Button {
                        showingFilePicker = true
                    } label: {
                        Label("Import .md / .json / .txt…", systemImage: "folder")
                    }
                    Text("Supports transcripts from Pull-AI-Context-Sessions, ChatGPT data exports (conversations.json), and plain markdown.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Tip: you can also drag transcript files onto the main window.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                } header: {
                    sectionHeader("From Files", systemImage: "folder")
                }
                Section {
                    Picker("Provider", selection: $pasteProvider) {
                        ForEach(Provider.allCases) { provider in
                            Text(provider.rawValue).tag(provider)
                        }
                    }
                    Button {
                        importFromClipboard()
                    } label: {
                        Label("Paste Transcript", systemImage: "doc.on.clipboard")
                    }
                    Text("No need to pick first — the provider is detected automatically from links and transcript content. This picker only labels pastes that can't be identified.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } header: {
                    sectionHeader("From Clipboard", systemImage: "clipboard")
                }
                if !statusMessage.isEmpty {
                    Section {
                        Label {
                            Text(statusMessage)
                                .font(.callout)
                        } icon: {
                            Image(systemName: statusIndicatesSuccess
                                ? "checkmark.circle.fill"
                                : "exclamationmark.triangle.fill")
                                .foregroundStyle(statusIndicatesSuccess ? Color.green : Color.orange)
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Import Sessions")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                // Test hook: drive the capture browser at a URL hands-off.
                let args = ProcessInfo.processInfo.arguments
                if let i = args.firstIndex(of: "--capture-url"), i + 1 < args.count,
                   let url = URL(string: args[i + 1]) {
                    linkText = args[i + 1]
                    captureTarget = CaptureTarget(url: url)
                }
            }
        }
        .sheet(item: $captureTarget) { target in
            LinkCaptureView(initialURL: target.url) { turns, detectedTitle, pdf, sourceURL in
                let fallback = sourceURL.lastPathComponent.isEmpty
                    ? sourceURL.absoluteString
                    : sourceURL.lastPathComponent
                let typedName = customName.trimmingCharacters(in: .whitespaces)
                let title = typedName.isEmpty ? (detectedTitle ?? fallback) : typedName
                let parsed = SessionImporter.fromCapturedTurns(
                    turns,
                    title: title,
                    sourceURL: sourceURL.absoluteString
                )
                if parsed.messages.isEmpty {
                    statusMessage = "No conversation content captured from the page."
                } else {
                    let session = SessionImporter.insert(parsed, into: modelContext)
                    session.snapshotPDF = pdf
                    statusMessage = "Captured \(parsed.messages.count) turns from \(sourceURL.host ?? "the page")\(pdf != nil ? " — original saved as PDF." : ".")"
                }
            }
        }
        .fileImporter(
            isPresented: $showingFilePicker,
            allowedContentTypes: Self.importTypes,
            allowsMultipleSelection: true
        ) { result in
            handleFileImport(result)
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 340)
        #endif
    }

    /// Simple wording heuristic: our success messages start with "Imported"/"Captured".
    private var statusIndicatesSuccess: Bool {
        statusMessage.hasPrefix("Imported") || statusMessage.hasPrefix("Captured")
    }

    private func sectionHeader(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.subheadline.weight(.semibold))
            .textCase(nil)
    }

    private func openLinkCapture() {
        var text = linkText.trimmingCharacters(in: .whitespaces)
        if !text.contains("://") { text = "https://" + text }
        guard let url = URL(string: text) else { return }
        captureTarget = CaptureTarget(url: url)
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            statusMessage = "Import failed: \(error.localizedDescription)"
        case .success(let urls):
            let imported = SessionImporter.importFiles(urls, into: modelContext)
            statusMessage = imported > 0
                ? "Imported \(imported) session\(imported == 1 ? "" : "s")."
                : "No sessions found in the selected files."
        }
    }

    private func importFromClipboard() {
        #if os(macOS)
        let text = NSPasteboard.general.string(forType: .string)
        #else
        let text = UIPasteboard.general.string
        #endif
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            statusMessage = "Clipboard is empty."
            return
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // A pasted link isn't a transcript — route it to the capture browser
        // instead of saving a one-line session containing just the URL.
        if !trimmed.contains("\n"), !trimmed.contains(" "), trimmed.contains("."), trimmed.count < 500 {
            var candidate = trimmed
            if !candidate.contains("://") { candidate = "https://" + candidate }
            if let url = URL(string: candidate), url.host() != nil {
                linkText = trimmed
                statusMessage = "That's a link — opening it in the capture browser."
                captureTarget = CaptureTarget(url: url)
                return
            }
        }
        let sessions = SessionImporter.parseText(text, title: "Pasted session")
        for var parsed in sessions {
            if parsed.provider == .other {
                parsed.provider = pasteProvider
            }
            SessionImporter.insert(parsed, into: modelContext)
        }
        statusMessage = "Imported \(sessions.count) session\(sessions.count == 1 ? "" : "s") from clipboard."
    }
}

#Preview {
    ImportSheet()
        .modelContainer(for: [ChatSession.self, ChatMessage.self], inMemory: true)
}
