import SwiftUI
import SwiftData

/// Continue a saved session live with Claude. The stored transcript is sent as
/// conversation history; new turns stream in and are appended to the vault, so
/// the journey keeps accumulating in one place.
struct ContinueChatView: View {
    @Bindable var session: ChatSession
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var apiKey: String? = KeychainStore.loadAPIKey()
    @State private var keyInput = ""
    @State private var modelID = ClaudeModel.defaultID
    @State private var input = ""
    @State private var streamingText = ""
    @State private var isStreaming = false
    @State private var errorMessage: String?

    private var activeModelName: String {
        ClaudeModel.all.first { $0.id == modelID }?.name ?? modelID
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Group {
                if apiKey == nil {
                    keyEntry
                } else {
                    chat
                }
            }
            .navigationTitle("Continue with Claude")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                if apiKey != nil {
                    ToolbarItem {
                        Picker("Model", selection: $modelID) {
                            ForEach(ClaudeModel.all) { model in
                                Text(model.name).tag(model.id)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 580, minHeight: 540)
        #endif
    }

    // MARK: - API key entry

    private var keyEntry: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor)
                .padding(.bottom, 4)
            Text("Connect to Claude")
                .font(.title2.bold())
            Text("Add your Anthropic API key to continue this session live. The key is stored in your Keychain and sent only to api.anthropic.com.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            SecureField("sk-ant-…", text: $keyInput)
                .textFieldStyle(.roundedBorder)
                .onSubmit(saveKey)
                .padding(.top, 8)
            Button(action: saveKey) {
                Text("Save Key")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(keyInput.trimmingCharacters(in: .whitespaces).isEmpty)
            Text("Create a key at console.anthropic.com.")
                .font(.caption)
                .foregroundStyle(.tertiary)
            Spacer()
            Spacer()
        }
        .frame(maxWidth: 340)
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func saveKey() {
        let key = keyInput.trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty else { return }
        KeychainStore.saveAPIKey(key)
        apiKey = key
    }

    // MARK: - Chat

    private var chat: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(session.orderedMessages) { message in
                            MessageBubble(message: message)
                        }
                        if isStreaming {
                            if streamingText.isEmpty {
                                thinkingBubble
                            } else {
                                liveBubble
                            }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding()
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: streamingText) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
                .onChange(of: isStreaming) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
                .onChange(of: session.messages.count) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
                .onAppear {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            if let errorMessage {
                errorBanner(errorMessage)
            }
            Divider()
                .padding(.top, 8)
            composer
        }
        .animation(.easeInOut(duration: 0.2), value: errorMessage)
    }

    /// Placeholder shown between sending and the first streamed token.
    private var thinkingBubble: some View {
        HStack(spacing: 8) {
            ThinkingDots()
            Text("Claude is thinking…")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.06)))
    }

    /// Live bubble for in-flight text, styled to match MessageBubble's assistant look.
    private var liveBubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Claude")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            Text(streamingText)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.06)))
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.callout)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                errorMessage = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            #if os(macOS)
            .help("Dismiss")
            #endif
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.red.opacity(0.1)))
        .padding(.horizontal)
        .padding(.top, 6)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var composer: some View {
        VStack(spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "sparkle")
                Text(activeModelName)
            }
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .padding(.top, 6)
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Continue the conversation…", text: $input, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .onSubmit(send)
                    .disabled(isStreaming)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 18).fill(Color.secondary.opacity(0.08)))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.secondary.opacity(0.15), lineWidth: 1))
                Button(action: send) {
                    Group {
                        if isStreaming {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 30))
                                .foregroundStyle(canSend ? Color.accentColor : Color.secondary.opacity(0.5))
                        }
                    }
                    .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .disabled(isStreaming || !canSend)
                .animation(.easeInOut(duration: 0.15), value: canSend)
            }
            .padding(.horizontal)
            .padding(.bottom, 12)
            .padding(.top, 2)
        }
    }

    // MARK: - Sending

    private func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming, let apiKey else { return }
        input = ""
        errorMessage = nil

        let nextIndex = (session.messages.map(\.index).max() ?? -1) + 1
        let userMessage = ChatMessage(index: nextIndex, role: .user, text: text)
        userMessage.session = session
        modelContext.insert(userMessage)

        var apiMessages: [[String: String]] = []
        for message in session.orderedMessages where !message.text.isEmpty {
            apiMessages.append([
                "role": message.role == .assistant ? "assistant" : "user",
                "content": message.text,
            ])
        }
        if apiMessages.first?["role"] != "user" {
            apiMessages.insert(["role": "user", "content": "(Earlier transcript follows.)"], at: 0)
        }

        isStreaming = true
        streamingText = ""
        Task {
            do {
                let system = """
                You are continuing an important conversation from the user's session vault. \
                The conversation history may come from an earlier session with another AI assistant. \
                Treat its facts and decisions as established context and continue helping from where it left off.
                """
                var stopReason: String?
                for try await event in ClaudeClient.stream(
                    apiKey: apiKey, model: modelID, system: system, messages: apiMessages
                ) {
                    switch event {
                    case .text(let chunk):
                        streamingText += chunk
                    case .done(let reason):
                        stopReason = reason
                    }
                }
                let reply = streamingText.trimmingCharacters(in: .whitespacesAndNewlines)
                if stopReason == "refusal" && reply.isEmpty {
                    errorMessage = "Claude declined this request (safety classifiers)."
                } else if !reply.isEmpty {
                    let assistantMessage = ChatMessage(index: nextIndex + 1, role: .assistant, text: reply)
                    assistantMessage.session = session
                    modelContext.insert(assistantMessage)
                    session.modelName = modelID
                }
            } catch {
                errorMessage = error.localizedDescription
            }
            streamingText = ""
            isStreaming = false
        }
    }
}

/// Three softly pulsing dots used while waiting for the first streamed token.
private struct ThinkingDots: View {
    @State private var animating = false

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(.secondary)
                    .frame(width: 7, height: 7)
                    .opacity(animating ? 1 : 0.3)
                    .animation(
                        .easeInOut(duration: 0.6)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.2),
                        value: animating
                    )
            }
        }
        .onAppear { animating = true }
    }
}
