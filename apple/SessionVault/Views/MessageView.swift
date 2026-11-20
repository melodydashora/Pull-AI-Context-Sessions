import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Puts plain text on the system clipboard (macOS and iOS).
private func copyToPasteboard(_ text: String) {
    #if os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    #else
    UIPasteboard.general.string = text
    #endif
}

struct MessageBubble: View {
    let message: ChatMessage
    @State private var copied = false

    private var isUser: Bool { message.role == .user }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(message.role.label)
                    .font(.caption.bold())
                    .foregroundStyle(isUser ? Color.accentColor : .secondary)
                Spacer(minLength: 0)
                // Text selection works one paragraph at a time, so a long reply could not
                // be copied in one go. This copies the whole message exactly as stored.
                Button(action: copyMessage) {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.caption2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                #if os(macOS)
                .help("Copy this whole message")
                #endif
            }
            ForEach(MessageSegment.parse(message.text)) { segment in
                switch segment.kind {
                case .prose(let text):
                    ProseView(text: text)
                case .code(let language, let code):
                    CodeBlockView(language: language, code: code)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(isUser ? Color.accentColor.opacity(0.08) : Color.secondary.opacity(0.06))
        )
    }

    private func copyMessage() {
        copyToPasteboard(message.text)
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            copied = false
        }
    }
}

/// A run of prose or one fenced code block, split out of the raw message text.
private struct MessageSegment: Identifiable {
    enum Kind {
        case prose(String)
        case code(language: String?, code: String)
    }

    let id: Int
    let kind: Kind

    static func parse(_ text: String) -> [MessageSegment] {
        var segments: [MessageSegment] = []
        var proseLines: [String] = []
        var codeLines: [String] = []
        var language: String?
        var inCode = false

        func flushProse() {
            let joined = proseLines.joined(separator: "\n")
            proseLines = []
            guard !joined.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            segments.append(MessageSegment(id: segments.count, kind: .prose(joined)))
        }
        func flushCode() {
            segments.append(MessageSegment(
                id: segments.count,
                kind: .code(language: language, code: codeLines.joined(separator: "\n"))
            ))
            codeLines = []
            language = nil
            inCode = false
        }

        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if inCode {
                if trimmed == "```" {
                    flushCode()
                } else {
                    codeLines.append(line)
                }
            } else if trimmed.hasPrefix("```") {
                flushProse()
                let tag = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                language = tag.isEmpty ? nil : tag
                inCode = true
            } else {
                proseLines.append(line)
            }
        }
        // An unterminated fence still renders as code rather than leaking backticks.
        if inCode {
            flushCode()
        } else {
            flushProse()
        }
        return segments
    }
}

private struct ProseView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                paragraphText(paragraph)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .textSelection(.enabled)
    }

    private var paragraphs: [String] {
        text.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func paragraphText(_ paragraph: String) -> Text {
        var options = AttributedString.MarkdownParsingOptions()
        options.interpretedSyntax = .inlineOnlyPreservingWhitespace
        if let attributed = try? AttributedString(markdown: paragraph, options: options) {
            return Text(attributed)
        }
        return Text(paragraph)
    }
}

private struct CodeBlockView: View {
    let language: String?
    let code: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if let language {
                    Text(language)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button(action: copy) {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.caption2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.top, 6)
            ScrollView(.horizontal) {
                Text(code)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.primary.opacity(0.06))
        )
    }

    private func copy() {
        copyToPasteboard(code)
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            copied = false
        }
    }
}
