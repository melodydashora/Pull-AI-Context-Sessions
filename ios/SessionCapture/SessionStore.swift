import Foundation

/// One transcript turn: its text plus the filenames of any images captured
/// with it (stored in the session's own folder).
struct CapturedTurn: Codable, Hashable {
    var text: String
    var role: String?
    var imageFiles: [String]

    var roleLabel: String? {
        switch role {
        case "user": return "You"
        case "assistant": return "Assistant"
        default: return nil
        }
    }
}

struct CapturedSession: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var sourceURL: String
    var capturedAt: Date
    var project: String
    var turns: [CapturedTurn]

    var imageCount: Int { turns.reduce(0) { $0 + $1.imageFiles.count } }

    var markdown: String {
        var parts = [
            "# \(title)",
            "Source: \(sourceURL)",
            "Captured: \(capturedAt.formatted())",
            ""
        ]
        for turn in turns {
            if let label = turn.roleLabel {
                parts.append("**\(label):**\n")
            }
            parts.append(turn.text)
            for file in turn.imageFiles {
                parts.append("\n![captured image](\(file))")
            }
            parts.append("\n---\n")
        }
        return parts.joined(separator: "\n")
    }
}

/// A turn as it arrives from the capture script, before images are written
/// to disk.
struct RawTurn {
    let text: String
    let role: String?
    let imageDataURLs: [String]
}

/// Persists captured sessions, one folder each under
/// Documents/CapturedSessions: session.json plus its image files.
@MainActor
final class SessionStore: ObservableObject {
    @Published private(set) var sessions: [CapturedSession] = []

    static let defaultProject = "Inbox"

    static var rootDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CapturedSessions", isDirectory: true)
    }

    static func directory(for id: UUID) -> URL {
        rootDirectory.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    static func imageURL(sessionID: UUID, file: String) -> URL {
        directory(for: sessionID).appendingPathComponent(file)
    }

    var projectNames: [String] {
        var names = Array(Set(sessions.map(\.project))).sorted()
        if !names.contains(Self.defaultProject) {
            names.insert(Self.defaultProject, at: 0)
        }
        return names
    }

    init() {
        try? FileManager.default.createDirectory(
            at: Self.rootDirectory, withIntermediateDirectories: true)
        load()
    }

    /// Builds a session from raw captured turns, writing images to disk.
    func add(title: String, sourceURL: String, rawTurns: [RawTurn]) -> CapturedSession {
        let id = UUID()
        let dir = Self.directory(for: id)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var turns: [CapturedTurn] = []
        var imageIndex = 0
        for raw in rawTurns {
            var files: [String] = []
            for dataURL in raw.imageDataURLs {
                if let file = Self.writeImage(dataURL: dataURL, index: imageIndex, in: dir) {
                    files.append(file)
                    imageIndex += 1
                }
            }
            turns.append(CapturedTurn(text: raw.text, role: raw.role, imageFiles: files))
        }

        let session = CapturedSession(
            id: id,
            title: title,
            sourceURL: sourceURL,
            capturedAt: Date(),
            project: Self.defaultProject,
            turns: turns
        )
        sessions.insert(session, at: 0)
        persist(session)
        return session
    }

    func move(_ session: CapturedSession, toProject project: String) {
        guard let index = sessions.firstIndex(where: { $0.id == session.id }) else { return }
        let name = project.trimmingCharacters(in: .whitespacesAndNewlines)
        sessions[index].project = name.isEmpty ? Self.defaultProject : name
        persist(sessions[index])
    }

    func delete(_ session: CapturedSession) {
        sessions.removeAll { $0.id == session.id }
        try? FileManager.default.removeItem(at: Self.directory(for: session.id))
    }

    /// Writes the markdown to a shareable temporary file.
    func exportMarkdown(_ session: CapturedSession) -> URL? {
        writeExport(session.markdown.data(using: .utf8), title: session.title, ext: "md")
    }

    /// Writes a self-contained HTML file with images embedded as data URIs —
    /// one file that can be shared anywhere and opened without signing in.
    func exportHTML(_ session: CapturedSession) -> URL? {
        writeExport(htmlString(session).data(using: .utf8), title: session.title, ext: "html")
    }

    /// The full transcript as a self-contained HTML string, with every image
    /// embedded as a data URI. Used for the HTML export and as the source
    /// the PDF exporter renders.
    func htmlString(_ session: CapturedSession) -> String {
        var body = """
        <!DOCTYPE html>
        <html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>\(Self.escape(session.title))</title>
        <style>
        body { font-family: -apple-system, system-ui, sans-serif; margin: 0 auto;
               max-width: 44rem; padding: 1.5rem; line-height: 1.5; color: #111; }
        .turn { border: 1px solid #ddd; border-radius: 12px; padding: 1rem;
                margin: 1rem 0; white-space: pre-wrap; overflow-wrap: break-word; }
        .meta { color: #777; font-size: 0.85rem; }
        img { max-width: 100%; border-radius: 8px; margin-top: 0.6rem; }
        </style></head><body>
        <h1>\(Self.escape(session.title))</h1>
        <p class="meta">Source: \(Self.escape(session.sourceURL))<br>
        Captured: \(Self.escape(session.capturedAt.formatted()))</p>
        """
        for turn in session.turns {
            body += "<div class=\"turn\">"
            if let label = turn.roleLabel {
                body += "<p class=\"meta\"><strong>\(label)</strong></p>"
            }
            body += Self.escape(turn.text)
            for file in turn.imageFiles {
                let url = Self.imageURL(sessionID: session.id, file: file)
                if let data = try? Data(contentsOf: url) {
                    let mime = file.hasSuffix(".png") ? "image/png"
                        : file.hasSuffix(".gif") ? "image/gif"
                        : file.hasSuffix(".webp") ? "image/webp"
                        : "image/jpeg"
                    body += "<img src=\"data:\(mime);base64,\(data.base64EncodedString())\">"
                }
            }
            body += "</div>\n"
        }
        body += "</body></html>"
        return body
    }

    // MARK: - Private

    private func writeExport(_ data: Data?, title: String, ext: String) -> URL? {
        guard let data else { return nil }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " -_"))
        var safe = String(title.unicodeScalars.filter { allowed.contains($0) })
            .trimmingCharacters(in: .whitespaces)
        if safe.isEmpty { safe = "session" }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(safe)
            .appendingPathExtension(ext)
        do {
            try data.write(to: url)
            return url
        } catch {
            return nil
        }
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    /// Decodes a data: URL and writes it into the session folder, returning
    /// the filename.
    private static func writeImage(dataURL: String, index: Int, in directory: URL) -> String? {
        guard dataURL.hasPrefix("data:image/"),
              let commaRange = dataURL.range(of: ","),
              let data = Data(base64Encoded: String(dataURL[commaRange.upperBound...]))
        else { return nil }
        let header = dataURL[..<commaRange.lowerBound]
        let ext = header.contains("image/png") ? "png"
            : header.contains("image/gif") ? "gif"
            : header.contains("image/webp") ? "webp"
            : "jpg"
        let file = "img\(index).\(ext)"
        do {
            try data.write(to: directory.appendingPathComponent(file))
            return file
        } catch {
            return nil
        }
    }

    private func fileURL(for session: CapturedSession) -> URL {
        Self.directory(for: session.id).appendingPathComponent("session.json")
    }

    private func persist(_ session: CapturedSession) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(session) {
            try? data.write(to: fileURL(for: session))
        }
    }

    private func load() {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let dirs = (try? FileManager.default.contentsOfDirectory(
            at: Self.rootDirectory, includingPropertiesForKeys: nil)) ?? []
        sessions = dirs
            .compactMap { dir -> CapturedSession? in
                let file = dir.appendingPathComponent("session.json")
                guard let data = try? Data(contentsOf: file) else { return nil }
                return try? decoder.decode(CapturedSession.self, from: data)
            }
            .sorted { $0.capturedAt > $1.capturedAt }
    }
}
