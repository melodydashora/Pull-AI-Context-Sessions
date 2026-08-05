import SwiftUI

struct SessionDetailView: View {
    let session: CapturedSession
    @State private var exportURL: URL?

    var body: some View {
        ScrollView {
            Text(session.markdown)
                .font(.system(.footnote, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle(session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if let url = exportURL {
                    ShareLink(item: url) {
                        Label("Export", systemImage: "square.and.arrow.up")
                    }
                }
            }
        }
        .onAppear {
            exportURL = session.writeMarkdownToTemporaryFile()
        }
    }
}
