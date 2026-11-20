import SwiftUI
import SwiftData

enum LibraryFilter: Hashable {
    case all
    case pinned
    case timeline
    case project(Project)
    case provider(Provider)
    case tag(String)

    var title: String {
        switch self {
        case .all: return "All Sessions"
        case .pinned: return "Pinned"
        case .timeline: return "Timeline"
        case .project(let p): return p.name
        case .provider(let p): return p.rawValue
        case .tag(let t): return "#\(t)"
        }
    }
}

struct RootView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var sessions: [ChatSession]
    @Query(sort: \Project.name) private var projects: [Project]
    @State private var filter: LibraryFilter? = .all
    @State private var selectedSession: ChatSession?
    @State private var showingImport = false
    @State private var showingNewProject = false
    @State private var newProjectName = ""
    @State private var projectToRename: Project?
    @State private var renameText = ""

    private var allTags: [String] {
        Array(Set(sessions.flatMap(\.tags))).sorted()
    }

    var body: some View {
        NavigationSplitView {
            sidebar
        } content: {
            SessionListView(filter: filter ?? .all, selection: $selectedSession)
                .toolbar {
                    ToolbarItem {
                        Button {
                            showingImport = true
                        } label: {
                            Label("Import", systemImage: "square.and.arrow.down")
                        }
                        .keyboardShortcut("i", modifiers: .command)
                    }
                }
                // Attached to the column that owns the toolbar button — sheet
                // presentation from the split-view root proved flaky on macOS.
                .sheet(isPresented: $showingImport) {
                    ImportSheet()
                }
        } detail: {
            if let session = selectedSession {
                SessionDetailView(session: session)
                    .id(session.persistentModelID)
            } else {
                ContentUnavailableView(
                    "No Session Selected",
                    systemImage: "bubble.left.and.text.bubble.right",
                    description: Text("Import a session or pick one from the list.")
                )
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            SessionImporter.importFiles(urls, into: modelContext) > 0
        }
        .onAppear {
            // Test hooks: let automation open a stored session or the import
            // sheet directly, so flows can be exercised without GUI clicks.
            let args = ProcessInfo.processInfo.arguments
            if args.contains("--select-first-session") {
                selectedSession = sessions.first
            }
            if args.contains("--open-import") {
                showingImport = true
            }
        }
        .alert("New Project", isPresented: $showingNewProject) {
            TextField("Project name", text: $newProjectName)
            Button("Create") {
                let name = newProjectName.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty {
                    let project = Project(name: name)
                    modelContext.insert(project)
                    filter = .project(project)
                }
                newProjectName = ""
            }
            Button("Cancel", role: .cancel) { newProjectName = "" }
        } message: {
            Text("Group sessions by what you're working on — e.g. Work, Research, Home.")
        }
        .alert("Rename Project", isPresented: renameAlertBinding, presenting: projectToRename) { project in
            TextField("Project name", text: $renameText)
            Button("Rename") {
                let name = renameText.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { project.name = name }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in }
    }

    private var renameAlertBinding: Binding<Bool> {
        Binding(
            get: { projectToRename != nil },
            set: { if !$0 { projectToRename = nil } }
        )
    }

    private var sidebar: some View {
        List(selection: $filter) {
            Section("Library") {
                Label("All Sessions", systemImage: "tray.full")
                    .badge(sessions.count)
                    .tag(LibraryFilter.all)
                Label("Pinned", systemImage: "pin")
                    .badge(sessions.filter(\.isPinned).count)
                    .tag(LibraryFilter.pinned)
                Label("Timeline", systemImage: "calendar.day.timeline.left")
                    .tag(LibraryFilter.timeline)
            }
            Section("Projects") {
                ForEach(projects) { project in
                    Label(project.name, systemImage: "folder")
                        .badge(project.sessions.count)
                        .tag(LibraryFilter.project(project))
                        .contextMenu {
                            Button("Rename…") {
                                renameText = project.name
                                projectToRename = project
                            }
                            Button("Delete", role: .destructive) {
                                if filter == .project(project) { filter = .all }
                                modelContext.delete(project)
                            }
                        }
                }
                Button {
                    showingNewProject = true
                } label: {
                    Label {
                        Text("New Project…")
                            .fontWeight(.medium)
                    } icon: {
                        Image(systemName: "folder.badge.plus")
                            .symbolRenderingMode(.hierarchical)
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.tint)
            }
            Section("Providers") {
                ForEach(Provider.allCases) { provider in
                    Label {
                        Text(provider.rawValue)
                    } icon: {
                        Image(systemName: provider.symbolName)
                            .foregroundStyle(provider.tint)
                    }
                    .tag(LibraryFilter.provider(provider))
                }
            }
            if !allTags.isEmpty {
                Section("Tags") {
                    ForEach(allTags, id: \.self) { tag in
                        Label(tag, systemImage: "number")
                            .tag(LibraryFilter.tag(tag))
                    }
                }
            }
        }
        .navigationTitle("SessionVault")
        #if os(macOS)
        .navigationSplitViewColumnWidth(min: 180, ideal: 210)
        #endif
    }
}

#Preview {
    RootView()
        .modelContainer(for: [ChatSession.self, ChatMessage.self, Project.self], inMemory: true)
}
