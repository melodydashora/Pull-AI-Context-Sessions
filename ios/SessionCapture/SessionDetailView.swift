import SwiftUI
import UIKit

struct SessionDetailView: View {
    let session: CapturedSession
    @EnvironmentObject private var store: SessionStore
    @State private var markdownURL: URL?
    @State private var htmlURL: URL?

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
                Menu {
                    if let url = htmlURL {
                        ShareLink(item: url) {
                            Label("Share as Web Page (with images)", systemImage: "safari")
                        }
                    }
                    if let url = markdownURL {
                        ShareLink(item: url) {
                            Label("Share as Markdown", systemImage: "doc.plaintext")
                        }
                    }
                } label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                }
            }
        }
        .onAppear {
            markdownURL = store.exportMarkdown(session)
            htmlURL = store.exportHTML(session)
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
