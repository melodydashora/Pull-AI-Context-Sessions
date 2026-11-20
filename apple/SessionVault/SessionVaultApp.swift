import SwiftUI
import SwiftData

@main
struct SessionVaultApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(for: [ChatSession.self, ChatMessage.self, Project.self])
    }
}
