import Foundation

struct CapturedSession: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var sourceURL: String
    var capturedAt: Date
    var turns: [String]

    var markdown: String {
        var parts = [
            "# \(title)",
            "Source: \(sourceURL)",
            "Captured: \(capturedAt.formatted())",
            ""
        ]
        for turn in turns {
            parts.append(turn)
            parts.append("\n---\n")
        }
        return parts.joined(separator: "\n")
    }

    /// Writes the markdown to a shareable temporary file and returns its URL.
    func writeMarkdownToTemporaryFile() -> URL? {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " -_"))
        var safe = String(title.unicodeScalars.filter { allowed.contains($0) })
            .trimmingCharacters(in: .whitespaces)
        if safe.isEmpty { safe = "session" }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(safe)
            .appendingPathExtension("md")
        do {
            try Data(markdown.utf8).write(to: url)
            return url
        } catch {
            return nil
        }
    }
}

/// Persists captured sessions as one JSON file each in
/// Documents/CapturedSessions, newest first in memory.
@MainActor
final class SessionStore: ObservableObject {
    @Published private(set) var sessions: [CapturedSession] = []

    private let directory: URL

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        directory = docs.appendingPathComponent("CapturedSessions", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        load()
    }

    func add(_ session: CapturedSession) {
        sessions.insert(session, at: 0)
        persist(session)
    }

    func delete(at offsets: IndexSet) {
        for index in offsets {
            try? FileManager.default.removeItem(at: fileURL(for: sessions[index]))
        }
        sessions.remove(atOffsets: offsets)
    }

    private func fileURL(for session: CapturedSession) -> URL {
        directory.appendingPathComponent(session.id.uuidString).appendingPathExtension("json")
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
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: nil)) ?? []
        sessions = files
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? decoder.decode(CapturedSession.self, from: data)
            }
            .sorted { $0.capturedAt > $1.capturedAt }
    }
}
