import SwiftUI

@main
struct SessionCaptureApp: App {
    @StateObject private var browser = WebViewModel()
    @StateObject private var store = SessionStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(browser)
                .environmentObject(store)
        }
    }
}
