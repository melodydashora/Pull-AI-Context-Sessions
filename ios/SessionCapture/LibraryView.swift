import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var store: SessionStore
    @State private var movingSession: CapturedSession?
    @State private var newProjectName = ""

    private var grouped: [(project: String, items: [CapturedSession])] {
        Dictionary(grouping: store.sessions, by: \.project)
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            .map { (project: $0.key, items: $0.value) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if store.sessions.isEmpty {
                    emptyState
                } else {
                    List {
                        ForEach(grouped, id: \.project) { group in
                            Section {
                                ForEach(group.items) { session in
                                    NavigationLink(value: session) {
                                        SessionRow(session: session)
                                    }
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) {
                                            store.delete(session)
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                                    .contextMenu {
                                        moveMenu(for: session)
                                    }
                                }
                            } header: {
                                Label(group.project, systemImage: "folder")
                            }
                        }
                    }
                }
            }
            .navigationTitle("Library")
            .navigationDestination(for: CapturedSession.self) { session in
                SessionDetailView(session: session)
            }
            .alert(
                "New Project",
                isPresented: Binding(
                    get: { movingSession != nil },
                    set: { if !$0 { movingSession = nil } }
                )
            ) {
                TextField("Project name", text: $newProjectName)
                Button("Move") {
                    if let session = movingSession {
                        store.move(session, toProject: newProjectName)
                    }
                    movingSession = nil
                    newProjectName = ""
                }
                Button("Cancel", role: .cancel) {
                    movingSession = nil
                    newProjectName = ""
                }
            } message: {
                Text("Sessions grouped in a project stay together in the Library.")
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No captured sessions yet")
                .font(.headline)
            Text("Open a session in the Browser tab and tap Capture.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }

    @ViewBuilder
    private func moveMenu(for session: CapturedSession) -> some View {
        Menu("Move to Project") {
            ForEach(store.projectNames, id: \.self) { name in
                Button {
                    store.move(session, toProject: name)
                } label: {
                    if name == session.project {
                        Label(name, systemImage: "checkmark")
                    } else {
                        Text(name)
                    }
                }
            }
            Divider()
            Button("New Project…") {
                newProjectName = ""
                movingSession = session
            }
        }
    }
}

private struct SessionRow: View {
    let session: CapturedSession

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(session.title)
                .font(.headline)
                .lineLimit(1)
            HStack(spacing: 6) {
                Text("\(session.turns.count) turns")
                if session.imageCount > 0 {
                    Label("\(session.imageCount)", systemImage: "photo")
                }
                Text(session.capturedAt.formatted(date: .abbreviated, time: .shortened))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
