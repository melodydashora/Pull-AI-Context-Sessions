import Foundation
import Security

struct ClaudeModel: Identifiable, Hashable {
    let id: String
    let name: String

    static let all: [ClaudeModel] = [
        ClaudeModel(id: "claude-opus-5", name: "Claude Opus 5"),
        ClaudeModel(id: "claude-fable-5-1", name: "Claude Fable 5.1"),
        ClaudeModel(id: "claude-fable-5", name: "Claude Fable 5"),
        ClaudeModel(id: "claude-sonnet-5", name: "Claude Sonnet 5"),
        ClaudeModel(id: "claude-haiku-4-5", name: "Claude Haiku 4.5"),
    ]

    static let defaultID = "claude-opus-5"

    /// Models whose safety classifiers can decline a request with
    /// `stop_reason: "refusal"`, and which therefore opt in to server-side
    /// fallbacks. Anthropic selects the fallback target by refusal category,
    /// so no target list belongs here. Membership is explicit rather than a
    /// prefix match so an unverified future ID fails closed (no fallbacks)
    /// instead of open (a 400 from an unsupported combination).
    private static let fallbackCapableIDs: Set<String> = [
        "claude-opus-5", "claude-fable-5", "claude-fable-5-1",
    ]

    static func supportsServerSideFallbacks(_ id: String) -> Bool {
        fallbackCapableIDs.contains(id)
    }
}

struct ClaudeAPIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum ClaudeStreamEvent {
    case text(String)
    case done(stopReason: String?)
}

/// Minimal raw-HTTP client for the Anthropic Messages API (there is no official
/// Swift SDK). Streams via SSE; thinking is left at each model's default.
enum ClaudeClient {

    static func stream(
        apiKey: String,
        model: String,
        system: String,
        messages: [[String: String]]
    ) -> AsyncThrowingStream<ClaudeStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
                    request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

                    var body: [String: Any] = [
                        "model": model,
                        "max_tokens": 64000,
                        "stream": true,
                        "system": system,
                        "messages": messages,
                    ]
                    // Server-side refusal fallbacks (recommended default for these models):
                    // a safety-classifier decline is re-served by Anthropic's recommended
                    // fallback model inside the same call.
                    if ClaudeModel.supportsServerSideFallbacks(model) {
                        request.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta")
                        body["fallbacks"] = "default"
                    }
                    request.httpBody = try JSONSerialization.data(withJSONObject: body)

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                        var errorBody = ""
                        for try await line in bytes.lines { errorBody += line }
                        let message = Self.errorMessage(from: errorBody) ?? "HTTP \(http.statusCode)"
                        throw ClaudeAPIError(message: message)
                    }

                    var stopReason: String?
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let payload = String(line.dropFirst(6))
                        guard let data = payload.data(using: .utf8),
                              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let type = json["type"] as? String else { continue }

                        switch type {
                        case "content_block_delta":
                            if let delta = json["delta"] as? [String: Any],
                               delta["type"] as? String == "text_delta",
                               let text = delta["text"] as? String {
                                continuation.yield(.text(text))
                            }
                        case "message_delta":
                            if let delta = json["delta"] as? [String: Any],
                               let reason = delta["stop_reason"] as? String {
                                stopReason = reason
                            }
                        case "message_stop":
                            continuation.yield(.done(stopReason: stopReason))
                            continuation.finish()
                            return
                        case "error":
                            let message = (json["error"] as? [String: Any])?["message"] as? String
                            throw ClaudeAPIError(message: message ?? "Stream error")
                        default:
                            break
                        }
                    }
                    continuation.yield(.done(stopReason: stopReason))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func errorMessage(from body: String) -> String? {
        guard let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = json["error"] as? [String: Any] else { return nil }
        return error["message"] as? String
    }
}

/// Keychain-backed storage for the user's Anthropic API key.
enum KeychainStore {
    private static let service = "com.melodydashora.SessionVault"
    private static let account = "anthropic-api-key"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func saveAPIKey(_ key: String) {
        SecItemDelete(baseQuery as CFDictionary)
        guard let data = key.data(using: .utf8), !key.isEmpty else { return }
        var query = baseQuery
        query[kSecValueData as String] = data
        SecItemAdd(query as CFDictionary, nil)
    }

    static func loadAPIKey() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let key = String(data: data, encoding: .utf8), !key.isEmpty else { return nil }
        return key
    }

    static func deleteAPIKey() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
