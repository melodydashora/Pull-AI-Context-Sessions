import SwiftUI
import UIKit

private struct ShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

private struct AIResult: Identifiable {
    let id = UUID()
    let title: String
    let text: String
}

struct SessionDetailView: View {
    let session: CapturedSession
    @EnvironmentObject private var store: SessionStore
    @StateObject private var summarizer = Summarizer()

    @State private var shareItem: ShareItem?
    @State private var aiResult: AIResult?
    @State private var working: String?
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                header
                ForEach(Array(session.turns.enumerated()), id: \.offset) { index, turn in
                    TurnCard(sessionID: session.id, index: index, turn: turn)
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                HStack {
                    if Summarizer.isAvailable {
                        aiMenu
                    }
                    exportMenu
                }
            }
        }
        .overlay {
            if let working {
                ProgressView(working)
                    .padding(20)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .sheet(item: $shareItem) { item in
            ActivityView(items: [item.url])
        }
        .sheet(item: $aiResult) { result in
            AIResultView(result: result)
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(session.sourceURL)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text("Captured \(session.capturedAt.formatted(date: .abbreviated, time: .shortened)) · \(session.turns.count) turns")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var exportMenu: some View {
        Menu {
            Button {
                Task { await makePDF() }
            } label: {
                Label("Save as PDF", systemImage: "doc.richtext")
            }
            Button {
                if let url = store.exportHTML(session) { shareItem = ShareItem(url: url) }
            } label: {
                Label("Web Page (with images)", systemImage: "safari")
            }
            Button {
                if let url = store.exportMarkdown(session) { shareItem = ShareItem(url: url) }
            } label: {
                Label("Markdown", systemImage: "doc.plaintext")
            }
        } label: {
            Label("Export", systemImage: "square.and.arrow.up")
        }
    }

    private var aiMenu: some View {
        Menu {
            Button {
                Task { await runAI("Summary", { try await summarizer.summarize(fullText) }) }
            } label: {
                Label("Summarize", systemImage: "text.append")
            }
            Button {
                Task { await runAI("Extracted Code", { try await summarizer.extractCode(fullText) }) }
            } label: {
                Label("Extract Code", systemImage: "chevron.left.forwardslash.chevron.right")
            }
        } label: {
            Label("AI", systemImage: "sparkles")
        }
    }

    private var fullText: String {
        session.turns.map { turn in
            if let label = turn.roleLabel { return "\(label): \(turn.text)" }
            return turn.text
        }.joined(separator: "\n\n")
    }

    @MainActor
    private func makePDF() async {
        working = "Making PDF…"
        defer { working = nil }
        do {
            let url = try await PDFExporter().export(
                html: store.htmlString(session), title: session.title)
            shareItem = ShareItem(url: url)
        } catch {
            errorMessage = "Couldn't make the PDF: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func runAI(_ title: String, _ work: @escaping () async throws -> String) async {
        working = "Thinking…"
        defer { working = nil }
        do {
            let text = try await work()
            aiResult = AIResult(title: title, text: text)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct TurnCard: View {
    let sessionID: UUID
    let index: Int
    let turn: CapturedTurn

    private var isUser: Bool { turn.role == "user" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(turn.roleLabel ?? "Turn \(index + 1)")
                .font(.caption.smallCaps().weight(.semibold))
                .foregroundStyle(isUser ? Color.accentColor : Color.secondary)
            if !turn.text.isEmpty {
                Text(turn.text)
                    .font(.callout)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(turn.imageFiles, id: \.self) { file in
                if let image = UIImage(
                    contentsOfFile: SessionStore.imageURL(sessionID: sessionID, file: file).path
                ) {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(isUser
                    ? AnyShapeStyle(Color.accentColor.opacity(0.10))
                    : AnyShapeStyle(Color(.secondarySystemGroupedBackground)))
        )
    }
}

private struct AIResultView: View {
    let result: AIResult
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(result.text)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle(result.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        UIPasteboard.general.string = result.text
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                }
            }
        }
    }
}

private struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
