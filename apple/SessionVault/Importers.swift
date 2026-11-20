import Foundation
import SwiftData

struct ImportedMessage {
    var role: Role
    var text: String
}

struct ImportedSession {
    var title: String
    var provider: Provider
    var modelName: String = ""
    var sourceURL: String = ""
    var createdAt: Date?
    var messages: [ImportedMessage]
}

/// Turns files and pasted text into `ImportedSession`s. Supported inputs:
/// - Markdown written by Pull-AI-Context-Sessions (`# session_…` + `Source:` + `---`-separated turns)
/// - ChatGPT data-export `conversations.json` (array of conversations with a `mapping` tree)
/// - Generic markdown/plain text, split on `User:` / `Assistant:`-style role markers
enum SessionImporter {

    static func parse(data: Data, filename: String) -> [ImportedSession] {
        let ext = (filename as NSString).pathExtension.lowercased()
        if ext == "json",
           let obj = try? JSONSerialization.jsonObject(with: data),
           let sessions = parseChatGPTExport(obj) {
            return sessions
        }
        guard let text = String(data: data, encoding: .utf8), !text.isEmpty else { return [] }
        return parseText(text, title: (filename as NSString).deletingPathExtension)
    }

    static func parseText(_ text: String, title: String) -> [ImportedSession] {
        if let pulled = parsePullSessionsMarkdown(text) {
            return [pulled]
        }
        if let shared = parseClaudeShareText(text, title: title) {
            return [shared]
        }
        return [parseGenericText(text, title: title)]
    }

    // MARK: - claude.ai share-page text

    private static let boilerplatePrefixes = [
        "Shared by ",
        "This is a copy of a chat",
        "Content may include unverified",
        "Shared snapshot may contain",
        "Ask Claude your own question",
        "Claude can make mistakes",
    ]

    private static let boilerplateExactLines: Set<String> = [
        "Report", "Copy", "Retry", "Share", "Claude",
    ]

    private static func isBoilerplateLine(_ line: String) -> Bool {
        if boilerplateExactLines.contains(line) { return true }
        return boilerplatePrefixes.contains { line.hasPrefix($0) }
    }

    private static func isTimestampLine(_ line: String) -> Bool {
        line.range(of: #"^\d{1,2}:\d{2}\s?(AM|PM)?$"#, options: .regularExpression) != nil
    }

    /// Removes share-page furniture from a run of lines: boilerplate, bare
    /// timestamps, and consecutive duplicate lines (share pages repeat preview
    /// text and tool-action chips like "Searched the web" twice).
    private static func cleanTranscriptLines(_ lines: [String]) -> [String] {
        var kept: [String] = []
        var lastNonEmpty = ""
        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                if kept.last?.isEmpty == false { kept.append("") }
                continue
            }
            if isBoilerplateLine(line) || isTimestampLine(line) { continue }
            if line == lastNonEmpty { continue }
            lastNonEmpty = line
            kept.append(line)
        }
        while kept.last?.isEmpty == true { kept.removeLast() }
        return kept
    }

    /// Parses the rendered text of a claude.ai shared-chat page. Turn headers are
    /// "You said: …" / "Claude responded: …" — their remainders are truncated
    /// previews of the full text that follows, so they are dropped.
    private static func parseClaudeShareText(_ text: String, title: String) -> ImportedSession? {
        guard text.contains("You said:") || text.contains("Claude responded:") else { return nil }

        var messages: [ImportedMessage] = []
        var currentRole: Role?
        var currentLines: [String] = []

        func flush() {
            let cleaned = cleanTranscriptLines(currentLines).joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let role = currentRole, !cleaned.isEmpty {
                messages.append(ImportedMessage(role: role, text: cleaned))
            }
            currentLines = []
        }

        for rawLine in text.components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("You said:") {
                flush()
                currentRole = .user
            } else if line.hasPrefix("Claude responded:") {
                flush()
                currentRole = .assistant
            } else if currentRole != nil {
                currentLines.append(rawLine)
            }
            // Anything before the first turn header is page furniture — skipped.
        }
        flush()

        guard !messages.isEmpty else { return nil }
        return ImportedSession(
            title: title,
            provider: .claude,
            createdAt: nil,
            messages: messages
        )
    }

    /// Markers of signed-out landing/consent pages. A capture dominated by
    /// these is a wall, not a conversation.
    private static let signInWallMarkers = [
        "sign in", "log in", "meet gemini", "google terms", "terms of service",
        "just a moment", "verify you are human", "welcome back",
        "your personal ai assistant", "cookie", "privacy policy",
    ]

    /// True when captured turns look like a sign-in wall or unhydrated landing
    /// page rather than a conversation. Conservative: real conversations are
    /// long, walls are short and marker-dense.
    static func looksLikeSignInWall(_ turns: [String]) -> Bool {
        let joined = turns.joined(separator: "\n")
        let lowered = joined.lowercased()
        let hits = signInWallMarkers.filter { lowered.contains($0) }.count
        if joined.count < 1200 { return hits >= 2 }
        if joined.count < 2500 { return hits >= 4 }
        return false
    }

    /// Drops leading/trailing turns that are page chrome rather than
    /// conversation — nav banners, sign-in strips, "AI can make mistakes"
    /// footers scraped as turns on some share pages.
    static func stripChromeTurns(_ turns: [String]) -> [String] {
        func isChrome(_ text: String) -> Bool {
            guard text.count < 700 else { return false }
            let lowered = text.lowercased()
            let hits = signInWallMarkers.filter { lowered.contains($0) }.count
            return lowered.contains("ai overview")
                || lowered.contains("can make mistakes")
                || (hits >= 1 && lowered.contains("sign in"))
                || hits >= 2
        }
        var result = turns[...]
        while let first = result.first, isChrome(first) { result = result.dropFirst() }
        while let last = result.last, isChrome(last) { result = result.dropLast() }
        var cleaned = Array(result)
        if let first = cleaned.first {
            cleaned[0] = stripLeadingHeaderLines(first)
        }
        return cleaned
    }

    /// The first harvested turn often starts with page-header residue ("Sign in",
    /// the page title, "Created with…", "Conversation Transcript") before the
    /// real content. Drop those leading lines — conservatively, max 12.
    private static func stripLeadingHeaderLines(_ text: String) -> String {
        let headerMarkers = [
            "sign in", "log in", "created with", "conversation transcript",
            "shared conversation", "ai overview",
        ]
        var lines = text.components(separatedBy: "\n")[...]
        var dropped = 0
        while let line = lines.first, dropped < 12 {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let lowered = trimmed.lowercased()
            let isHeaderish = trimmed.isEmpty
                || (trimmed.count < 90 && headerMarkers.contains { lowered.contains($0) })
            guard isHeaderish else { break }
            lines = lines.dropFirst()
            dropped += 1
        }
        // If everything matched, the heuristic misfired — keep the original.
        let stripped = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return stripped.isEmpty ? text : stripped
    }

    /// Builds a session from turn blocks harvested live out of a shared-session web page.
    static func fromCapturedTurns(_ turns: [String], title: String, sourceURL: String) -> ImportedSession {
        let fallbackProvider: Provider = sourceURL.contains("claude.ai") ? .claude : .other

        // A single block usually means the whole-page fallback fired — run the
        // full text parsers (share-page cleaner included) over it.
        if turns.count == 1 {
            var single = parseText(turns[0], title: title).first
                ?? parseGenericText(turns[0], title: title)
            single.sourceURL = sourceURL
            if single.provider == .other { single.provider = fallbackProvider }
            return single
        }

        var messages: [ImportedMessage] = []
        for block in stripChromeTurns(turns) {
            let cleaned = cleanTranscriptLines(block.components(separatedBy: "\n"))
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty else { continue }
            if let (role, stripped) = splitLeadingRoleMarker(cleaned) {
                messages.append(ImportedMessage(role: role, text: stripped))
            } else {
                messages.append(ImportedMessage(role: .unknown, text: cleaned))
            }
        }
        return ImportedSession(
            title: title,
            provider: fallbackProvider,
            sourceURL: sourceURL,
            createdAt: nil,
            messages: messages
        )
    }

    // MARK: - Pull-AI-Context-Sessions markdown

    private static func parsePullSessionsMarkdown(_ text: String) -> ImportedSession? {
        let lines = text.components(separatedBy: "\n")
        guard lines.count >= 2,
              lines[0].hasPrefix("# "),
              lines[1].hasPrefix("Source: ") else { return nil }

        let title = String(lines[0].dropFirst(2)).trimmingCharacters(in: .whitespaces)
        let source = String(lines[1].dropFirst("Source: ".count)).trimmingCharacters(in: .whitespaces)
        let provider: Provider = source.contains("claude.ai") ? .claude : .other

        var blocks: [String] = []
        var currentBlock: [String] = []
        for line in lines.dropFirst(2) {
            if line.trimmingCharacters(in: .whitespaces) == "---" {
                blocks.append(currentBlock.joined(separator: "\n"))
                currentBlock = []
            } else {
                currentBlock.append(line)
            }
        }
        blocks.append(currentBlock.joined(separator: "\n"))
        blocks = blocks
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        var messages: [ImportedMessage] = []
        for block in blocks {
            if let (role, stripped) = splitLeadingRoleMarker(block) {
                messages.append(ImportedMessage(role: role, text: stripped))
            } else {
                messages.append(ImportedMessage(role: .unknown, text: block))
            }
        }
        return ImportedSession(
            title: title,
            provider: provider,
            sourceURL: source,
            createdAt: nil,
            messages: messages
        )
    }

    // MARK: - ChatGPT data export (conversations.json)

    private static func parseChatGPTExport(_ obj: Any) -> [ImportedSession]? {
        let conversations: [[String: Any]]
        if let array = obj as? [[String: Any]] {
            conversations = array
        } else if let single = obj as? [String: Any], single["mapping"] != nil {
            conversations = [single]
        } else {
            return nil
        }
        guard conversations.allSatisfy({ $0["mapping"] is [String: Any] }) else { return nil }

        var sessions: [ImportedSession] = []
        for convo in conversations {
            guard let mapping = convo["mapping"] as? [String: Any] else { continue }
            let title = (convo["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "ChatGPT conversation"
            let created = (convo["create_time"] as? Double).map { Date(timeIntervalSince1970: $0) }

            // Walk the branch that ends at current_node; fall back to create_time order.
            var nodes: [[String: Any]] = []
            if let currentID = convo["current_node"] as? String {
                var cursor: String? = currentID
                while let id = cursor, let node = mapping[id] as? [String: Any] {
                    nodes.append(node)
                    cursor = node["parent"] as? String
                }
                nodes.reverse()
            } else {
                nodes = mapping.values.compactMap { $0 as? [String: Any] }.sorted {
                    let a = (($0["message"] as? [String: Any])?["create_time"] as? Double) ?? 0
                    let b = (($1["message"] as? [String: Any])?["create_time"] as? Double) ?? 0
                    return a < b
                }
            }

            var messages: [ImportedMessage] = []
            for node in nodes {
                guard let message = node["message"] as? [String: Any],
                      let author = message["author"] as? [String: Any],
                      let roleRaw = author["role"] as? String,
                      let content = message["content"] as? [String: Any] else { continue }
                let parts = (content["parts"] as? [Any])?.compactMap { $0 as? String } ?? []
                let text = parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                let role: Role
                switch roleRaw {
                case "user": role = .user
                case "assistant": role = .assistant
                case "system": role = .system
                default: role = .unknown
                }
                if role == .system { continue }
                messages.append(ImportedMessage(role: role, text: text))
            }
            guard !messages.isEmpty else { continue }
            sessions.append(ImportedSession(
                title: title,
                provider: .chatgpt,
                createdAt: created,
                messages: messages
            ))
        }
        return sessions.isEmpty ? nil : sessions
    }

    // MARK: - Generic markdown / plain text

    private static func parseGenericText(_ text: String, title: String) -> ImportedSession {
        var messages: [ImportedMessage] = []
        var currentRole: Role?
        var currentLines: [String] = []

        func flush() {
            let body = currentLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !body.isEmpty {
                messages.append(ImportedMessage(role: currentRole ?? .unknown, text: body))
            }
            currentLines = []
        }

        for line in text.components(separatedBy: "\n") {
            if let (role, rest) = roleMarker(in: line) {
                flush()
                currentRole = role
                if !rest.isEmpty { currentLines.append(rest) }
            } else {
                currentLines.append(line)
            }
        }
        flush()

        if messages.isEmpty {
            messages = [ImportedMessage(role: .unknown, text: text.trimmingCharacters(in: .whitespacesAndNewlines))]
        }

        var provider = Provider.other
        let lowered = text.lowercased()
        if lowered.contains("claude") { provider = .claude }
        else if lowered.contains("chatgpt") || lowered.contains("gpt-") { provider = .chatgpt }
        else if lowered.contains("gemini") { provider = .gemini }

        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return ImportedSession(
            title: cleanTitle.isEmpty ? "Imported session" : cleanTitle,
            provider: provider,
            createdAt: nil,
            messages: messages
        )
    }

    /// Matches lines like `User:`, `**Assistant:**`, `## Human`, `Claude: hello` and
    /// returns the role plus any text that followed the marker on the same line.
    private static func roleMarker(in line: String) -> (Role, String)? {
        var candidate = line.trimmingCharacters(in: .whitespaces)
        guard !candidate.isEmpty else { return nil }
        while candidate.hasPrefix("#") { candidate = String(candidate.dropFirst()) }
        candidate = candidate.trimmingCharacters(in: .whitespaces)
        candidate = candidate.replacingOccurrences(of: "**", with: "")

        let roleNames: [(String, Role)] = [
            ("you said", .user), ("claude responded", .assistant), ("claude said", .assistant),
            ("chatgpt said", .assistant), ("gemini said", .assistant),
            ("user", .user), ("human", .user), ("you", .user), ("me", .user),
            ("assistant", .assistant), ("claude", .assistant), ("chatgpt", .assistant),
            ("gpt", .assistant), ("gemini", .assistant), ("ai", .assistant),
            ("system", .system),
        ]
        // Bare names (no colon) only count for unambiguous conversational labels —
        // words like "System", "You", or "Me" appear as ordinary headings in prose.
        let bareNames: Set<String> = ["user", "human", "assistant", "claude", "chatgpt", "gemini"]
        for (name, role) in roleNames {
            let lowered = candidate.lowercased()
            if lowered == name, bareNames.contains(name) {
                return (role, "")
            }
            if lowered.hasPrefix(name + ":") {
                let rest = candidate.dropFirst(name.count + 1).trimmingCharacters(in: .whitespaces)
                return (role, rest)
            }
        }
        return nil
    }

    private static func splitLeadingRoleMarker(_ block: String) -> (Role, String)? {
        guard let firstLine = block.components(separatedBy: "\n").first,
              let (role, rest) = roleMarker(in: firstLine) else { return nil }
        var remaining = block.components(separatedBy: "\n").dropFirst().joined(separator: "\n")
        if !rest.isEmpty {
            remaining = rest + "\n" + remaining
        }
        return (role, remaining.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // MARK: - Persistence

    @MainActor
    @discardableResult
    static func insert(_ parsed: ImportedSession, into context: ModelContext) -> ChatSession {
        let session = ChatSession(
            title: parsed.title,
            provider: parsed.provider,
            modelName: parsed.modelName,
            sourceURL: parsed.sourceURL,
            createdAt: parsed.createdAt ?? .now
        )
        context.insert(session)
        for (index, message) in parsed.messages.enumerated() {
            let stored = ChatMessage(index: index, role: message.role, text: message.text)
            stored.session = session
            context.insert(stored)
        }
        return session
    }

    /// Shared handler for dropped or picked file URLs. Returns how many sessions landed.
    @MainActor
    static func importFiles(_ urls: [URL], into context: ModelContext) -> Int {
        var imported = 0
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            for parsed in parse(data: data, filename: url.lastPathComponent) {
                insert(parsed, into: context)
                imported += 1
            }
        }
        return imported
    }
}
