import SwiftUI
import SwiftData

struct SessionListView: View {
    var filter: LibraryFilter
    @Binding var selection: ChatSession?

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \ChatSession.importedAt, order: .reverse) private var sessions: [ChatSession]
    @Query(sort: \Project.name) private var projects: [Project]
    @State private var searchText = ""

    private var filtered: [ChatSession] {
        var result = sessions
        switch filter {
        case .all, .timeline:
            break
        case .pinned:
            result = result.filter(\.isPinned)
        case .project(let project):
            result = result.filter { $0.project == project }
        case .provider(let provider):
            result = result.filter { $0.provider == provider }
        case .tag(let tag):
            result = result.filter { $0.tags.contains(tag) }
        }
        if !searchText.isEmpty {
            let needle = searchText.lowercased()
            result = result.filter {
                $0.title.lowercased().contains(needle)
                    || $0.summary.lowercased().contains(needle)
                    || $0.tags.contains { $0.lowercased().contains(needle) }
            }
        }
        return result.sorted { a, b in
            if a.isPinned != b.isPinned { return a.isPinned }
            return a.importedAt > b.importedAt
        }
    }

    /// Sessions grouped by month for the Timeline view — the whole journey,
    /// newest first, across every provider.
    private var timelineGroups: [(key: String, sessions: [ChatSession])] {
        let sorted = filtered.sorted { $0.createdAt > $1.createdAt }
        var groups: [(key: String, sessions: [ChatSession])] = []
        for session in sorted {
            let key = session.createdAt.formatted(.dateTime.year().month(.wide))
            if groups.last?.key == key {
                groups[groups.count - 1].sessions.append(session)
            } else {
                groups.append((key, [session]))
            }
        }
        return groups
    }

    var body: some View {
        Group {
            if filter == .timeline {
                List(selection: $selection) {
                    ForEach(timelineGroups, id: \.key) { group in
                        Section {
                            ForEach(group.sessions) { session in
                                row(for: session)
                            }
                        } header: {
                            timelineHeader(for: group)
                        }
                    }
                }
            } else {
                List(selection: $selection) {
                    ForEach(filtered) { session in
                        row(for: session)
                    }
                    .onDelete { offsets in
                        for offset in offsets {
                            delete(filtered[offset])
                        }
                    }
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search titles, summaries, tags")
        .navigationTitle(filter.title)
        .overlay {
            if filtered.isEmpty {
                if searchText.isEmpty {
                    ContentUnavailableView {
                        Label("Your Vault Is Empty", systemImage: "tray")
                    } description: {
                        Text("Save AI conversations three ways: press Import and capture a claude.ai or ChatGPT share link in the built-in browser, drop .md / .json / .txt transcript files anywhere in this window, or paste a transcript from the clipboard.")
                    }
                } else {
                    ContentUnavailableView.search(text: searchText)
                }
            }
        }
    }

    /// A timeline section header that reads like a chapter of the journey —
    /// the month front and center, the session count as a quiet footnote.
    private func timelineHeader(for group: (key: String, sessions: [ChatSession])) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(group.key)
                .font(.title3.bold())
                .foregroundStyle(.primary)
            Spacer()
            Text("\(group.sessions.count) session\(group.sessions.count == 1 ? "" : "s")")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .textCase(nil)
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func row(for session: ChatSession) -> some View {
        SessionRow(session: session)
            .tag(session)
            .contextMenu {
                Button(session.isPinned ? "Unpin" : "Pin") {
                    session.isPinned.toggle()
                }
                Menu("Move to Project") {
                    Button("None") { session.project = nil }
                    ForEach(projects) { project in
                        Button(project.name) { session.project = project }
                    }
                }
                Button("Delete", role: .destructive) {
                    delete(session)
                }
            }
    }

    private func delete(_ session: ChatSession) {
        if selection == session { selection = nil }
        modelContext.delete(session)
    }
}

private struct SessionRow: View {
    let session: ChatSession

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                providerChip
                if session.isPinned {
                    Spacer()
                    Image(systemName: "pin.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
            Text(session.title)
                .font(.headline)
                .lineLimit(1)
            if !session.summary.isEmpty {
                Text(session.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack(spacing: 6) {
                Text(session.importedAt.formatted(.relative(presentation: .named)))
                Text("·")
                Text("\(session.messages.count) turns")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if !session.tags.isEmpty {
                Text(session.tags.map { "#\($0)" }.joined(separator: "  "))
                    .font(.caption2)
                    .foregroundStyle(.tint)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    /// The provider as a small tinted capsule — symbol and name in the
    /// provider's accent color over a low-opacity wash of the same tint.
    private var providerChip: some View {
        HStack(spacing: 3) {
            Image(systemName: session.provider.symbolName)
            Text(session.provider.rawValue)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(session.provider.tint)
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(session.provider.tint.opacity(0.15), in: Capsule())
    }
}
