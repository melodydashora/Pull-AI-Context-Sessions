import SwiftUI
import PDFKit

#if os(macOS)
private struct PDFKitView: NSViewRepresentable {
    let data: Data
    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.document = PDFDocument(data: data)
        view.autoScales = true
        return view
    }
    func updateNSView(_ nsView: PDFView, context: Context) {}
}
#else
private struct PDFKitView: UIViewRepresentable {
    let data: Data
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.document = PDFDocument(data: data)
        view.autoScales = true
        return view
    }
    func updateUIView(_ uiView: PDFView, context: Context) {}
}
#endif

/// Shows the pixel-faithful PDF snapshot of a captured page — the original,
/// exactly as it rendered in the capture browser.
struct OriginalSnapshotView: View {
    let title: String
    let pdfData: Data
    @Environment(\.dismiss) private var dismiss

    private var exportURL: URL? {
        let safeName = title.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(safeName.isEmpty ? "Session" : safeName).pdf")
        do {
            try pdfData.write(to: url)
            return url
        } catch {
            return nil
        }
    }

    var body: some View {
        NavigationStack {
            PDFKitView(data: pdfData)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Original")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                    if let exportURL {
                        ToolbarItem {
                            ShareLink(item: exportURL) {
                                Label("Share PDF", systemImage: "square.and.arrow.up")
                            }
                        }
                    }
                }
        }
        #if os(macOS)
        .frame(minWidth: 700, minHeight: 600)
        #endif
    }
}
