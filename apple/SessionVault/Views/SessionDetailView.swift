import SwiftUI
import SwiftData
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct SessionDetailView: View {
    @Bindable var session: ChatSession
    @Query(sort: \Project.name) private var projects: [Project]
    // Driven by a live query rather than the in-memory relationship so the
    // transcript always renders, including when a session is reopened later.
    // Filtered in memory — a store-level predicate on persistentModelID can
    // silently match nothing on some OS versions.
    @Query(sort: \ChatMessage.index) private var allMessages: [ChatMessage]
    @State private var tagText = ""
    @State private var copied = false
    @State private var showingContinueChat = false
    @State private var showingOriginal = false
    @State private var isSummarizing = false
    @State private var summarizeError: String?

    private var storedMessages: [ChatMessage] {
        let sessionID = session.persistentModelID
        return allMessages.filter { $0.session?.persistentModelID == sessionID }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                Divider()
                if storedMessages.isEmpty {
                    ContentUnavailableView(
                        "No Transcript",
                        systemImage: "text.bubble",
                        description: Text("This session has no captured messages. Recapture the link or re-import the file.")
                    )
                } else {
                    ForEach(storedMessages) { message in
                        MessageBubble(message: message)
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(session.title)
        .toolbar {
            ToolbarItemGroup {
                if session.snapshotPDF != nil {
                    Button {
                        showingOriginal = true
                    } label: {
                        Label("View Original", systemImage: "doc.richtext")
                    }
                }
                Button {
                    showingContinueChat = true
                } label: {
                    Label("Continue with Claude", systemImage: "sparkle")
                }
                Button {
                    summarize()
                } label: {
                    if isSummarizing {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Summarize (keeps code intact)", systemImage: "text.badge.checkmark")
                    }
                }
                .disabled(isSummarizing)
                Button {
                    session.isPinned.toggle()
                } label: {
                    Label(
                        session.isPinned ? "Unpin" : "Pin",
                        systemImage: session.isPinned ? "pin.fill" : "pin"
                    )
                }
                Button {
                    copyContextPack()
                } label: {
                    Label(copied ? "Copied!" : "Copy Context Pack", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                ShareLink(item: ContextPack.markdown(for: session)) {
                    Label("Share Context Pack", systemImage: "square.and.arrow.up")
                }
            }
        }
        .onAppear {
            tagText = session.tags.joined(separator: ", ")
        }
        .sheet(isPresented: $showingContinueChat) {
            ContinueChatView(session: session)
        }
        .sheet(isPresented: $showingOriginal) {
            if let pdf = session.snapshotPDF {
                OriginalSnapshotView(title: session.title, pdfData: pdf)
            }
        }
        .alert("Summarize", isPresented: summarizeErrorBinding) {
            Button("OK") {}
        } message: {
            Text(summarizeError ?? "")
        }
    }

    private var summarizeErrorBinding: Binding<Bool> {
        Binding(
            get: { summarizeError != nil },
            set: { if !$0 { summarizeError = nil } }
        )
    }

    /// Condenses the conversation into the summary field via Claude — prose is
    /// compressed aggressively, but code blocks are preserved verbatim.
    private func summarize() {
        guard let apiKey = KeychainStore.loadAPIKey() else {
            summarizeError = "Add your Anthropic API key first — open Continue with Claude to set it up."
            return
        }
        let transcript = session.orderedMessages
            .map { "\($0.role.label):\n\($0.text)" }
            .joined(separator: "\n\n---\n\n")
        guard !transcript.isEmpty else {
            summarizeError = "This session has no messages to summarize."
            return
        }
        isSummarizing = true
        Task {
            do {
                let system = """
                You summarize saved AI conversation transcripts for the user's session vault. \
                Produce a concise summary of the conversation's goals, decisions, and outcomes. \
                Preserve every code block, command, file path, and identifier exactly as written — \
                complete and verbatim, in fenced code blocks. Never truncate, paraphrase, or omit code. \
                Compress the prose, never the code.
                """
                var result = ""
                for try await event in ClaudeClient.stream(
                    apiKey: apiKey,
                    model: ClaudeModel.defaultID,
                    system: system,
                    messages: [["role": "user", "content": transcript]]
                ) {
                    if case .text(let chunk) = event { result += chunk }
                }
                let summary = result.trimmingCharacters(in: .whitespacesAndNewlines)
                if summary.isEmpty {
                    summarizeError = "Claude returned no summary — it may have declined the request."
                } else {
                    session.summary = summary
                }
            } catch {
                summarizeError = error.localizedDescription
            }
            isSummarizing = false
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Title", text: $session.title)
                .font(.title2.bold())
                .textFieldStyle(.plain)
            HStack(spacing: 12) {
                Picker("Provider", selection: $session.provider) {
                    ForEach(Provider.allCases) { provider in
                        Label(provider.rawValue, systemImage: provider.symbolName)
                            .tag(provider)
                    }
                }
                .labelsHidden()
                .fixedSize()
                Picker("Project", selection: $session.project) {
                    Text("No Project").tag(nil as Project?)
                    ForEach(projects) { project in
                        Label(project.name, systemImage: "folder")
                            .tag(Optional(project))
                    }
                }
                .labelsHidden()
                .fixedSize()
                TextField("Model (e.g. claude-fable-5-1)", text: $session.modelName)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 260)
            }
            TextField("Tags (comma separated)", text: $tagText)
                .textFieldStyle(.roundedBorder)
                .onSubmit(saveTags)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
            TextField("Summary — what makes this session important?", text: $session.summary, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2...6)
            if !session.sourceURL.isEmpty, let url = URL(string: session.sourceURL) {
                Link(destination: url) {
                    Label(session.sourceURL, systemImage: "link")
                        .font(.caption)
                        .lineLimit(1)
                }
            }
            HStack(spacing: 12) {
                DatePicker(
                    "Original date",
                    selection: $session.createdAt,
                    displayedComponents: .date
                )
                .fixedSize()
                Text("imported \(session.importedAt.formatted(date: .abbreviated, time: .omitted)) · \(session.messages.count) turns")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func saveTags() {
        session.tags = tagText
            .components(separatedBy: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
        tagText = session.tags.joined(separator: ", ")
    }

    private func copyContextPack() {
        saveTags()
        let pack = ContextPack.markdown(for: session)
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pack, forType: .string)
        #else
        UIPasteboard.general.string = pack
        #endif
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            copied = false
        }
    }
}

