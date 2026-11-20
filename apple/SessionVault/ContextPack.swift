import Foundation

/// Renders a saved session as a self-describing markdown "context pack" that can be
/// pasted into a fresh conversation with any model to carry the context over.
enum ContextPack {

    static func markdown(for session: ChatSession) -> String {
        var lines: [String] = []
        lines.append("# Context pack: \(session.title)")
        lines.append("")
        var origin = "Origin: \(session.provider.rawValue)"
        if !session.modelName.isEmpty { origin += " (\(session.modelName))" }
        origin += ", saved \(session.createdAt.formatted(date: .abbreviated, time: .omitted))"
        lines.append(origin)
        if !session.sourceURL.isEmpty {
            lines.append("Source: \(session.sourceURL)")
        }
        if !session.tags.isEmpty {
            lines.append("Tags: \(session.tags.joined(separator: ", "))")
        }
        lines.append("")
        if !session.summary.isEmpty {
            lines.append("## Summary")
            lines.append("")
            lines.append(session.summary)
            lines.append("")
        }
        lines.append("You are being given the transcript of an earlier conversation the user had")
        lines.append("with another AI assistant. Read it, treat its decisions and facts as established")
        lines.append("context, and continue helping from where it left off.")
        lines.append("")
        lines.append("## Transcript")
        lines.append("")
        for message in session.orderedMessages {
            lines.append("**\(message.role.label):**")
            lines.append("")
            lines.append(message.text)
            lines.append("")
            lines.append("---")
            lines.append("")
        }
        return lines.joined(separator: "\n")
    }
}
