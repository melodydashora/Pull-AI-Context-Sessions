import Foundation
import SwiftData

enum Provider: String, CaseIterable, Identifiable {
    case claude = "Claude"
    case chatgpt = "ChatGPT"
    case gemini = "Gemini"
    case other = "Other"

    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .claude: return "sparkle"
        case .chatgpt: return "bubble.left.and.bubble.right"
        case .gemini: return "rhombus"
        case .other: return "questionmark.circle"
        }
    }
}

enum Role: String {
    case user
    case assistant
    case system
    case unknown

    var label: String {
        switch self {
        case .user: return "User"
        case .assistant: return "Assistant"
        case .system: return "System"
        case .unknown: return "Note"
        }
    }
}

@Model
final class Project {
    var name: String = "Untitled Project"
    var createdAt: Date = Date()

    @Relationship(deleteRule: .nullify, inverse: \ChatSession.project)
    var sessions: [ChatSession] = []

    init(name: String) {
        self.name = name
        self.createdAt = .now
    }
}

@Model
final class ChatSession {
    var title: String = "Untitled"
    var providerRaw: String = Provider.other.rawValue
    var modelName: String = ""
    var sourceURL: String = ""
    var summary: String = ""
    var tags: [String] = []
    var isPinned: Bool = false
    var createdAt: Date = Date()
    var importedAt: Date = Date()
    var project: Project?
    /// Pixel-faithful PDF of the captured page, exactly as it rendered.
    @Attribute(.externalStorage) var snapshotPDF: Data?

    @Relationship(deleteRule: .cascade, inverse: \ChatMessage.session)
    var messages: [ChatMessage] = []

    init(
        title: String,
        provider: Provider,
        modelName: String = "",
        sourceURL: String = "",
        summary: String = "",
        createdAt: Date = .now
    ) {
        self.title = title
        self.providerRaw = provider.rawValue
        self.modelName = modelName
        self.sourceURL = sourceURL
        self.summary = summary
        self.createdAt = createdAt
        self.importedAt = .now
    }

    var provider: Provider {
        get { Provider(rawValue: providerRaw) ?? .other }
        set { providerRaw = newValue.rawValue }
    }

    var orderedMessages: [ChatMessage] {
        messages.sorted { $0.index < $1.index }
    }
}

@Model
final class ChatMessage {
    var index: Int = 0
    var roleRaw: String = Role.unknown.rawValue
    var text: String = ""
    var session: ChatSession?

    init(index: Int, role: Role, text: String) {
        self.index = index
        self.roleRaw = role.rawValue
        self.text = text
    }

    var role: Role {
        get { Role(rawValue: roleRaw) ?? .unknown }
        set { roleRaw = newValue.rawValue }
    }
}
