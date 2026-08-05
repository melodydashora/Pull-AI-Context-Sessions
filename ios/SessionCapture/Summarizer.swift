import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Optional, on-demand AI over a captured transcript, using Apple's
/// on-device Foundation Models framework: no network, no API key, nothing
/// leaves the device — which matters for sensitive research. The feature
/// is only offered when the on-device model is actually available; the app
/// works fully without it.
///
/// BUILD NOTE (verify on the Mac): the Foundation Models calls follow
/// Apple's documented API but were authored without an iOS toolchain to
/// compile against. The whole file is wrapped in `#if canImport(...)`, so
/// the app still builds where the framework is absent (isAvailable returns
/// false and the UI hides the feature). If the SDK you build against uses
/// different symbol names, adjust only this file — nothing else depends on
/// it compiling with the model present.
@MainActor
final class Summarizer: ObservableObject {
    /// True only when the on-device model is present and ready on this
    /// device and OS version.
    static var isAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            if case .available = SystemLanguageModel.default.availability {
                return true
            }
        }
        #endif
        return false
    }

    /// On-device context is limited; keep input within a safe budget.
    private static let inputBudget = 8000

    func summarize(_ transcript: String) async throws -> String {
        try await run(
            "You are helping a researcher. Summarize the key findings, claims, "
            + "and open questions in this AI chat transcript. Be factual and "
            + "concise.\n\nTRANSCRIPT:\n\(Self.clip(transcript))"
        )
    }

    func extractCode(_ transcript: String) async throws -> String {
        try await run(
            "Extract only the code from this transcript, verbatim, each block in "
            + "a fenced code block labeled with its language. If there is no code, "
            + "reply \"No code found.\"\n\nTRANSCRIPT:\n\(Self.clip(transcript))"
        )
    }

    private func run(_ prompt: String) async throws -> String {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let session = LanguageModelSession()
            let response = try await session.respond(to: prompt)
            return response.content
        }
        #endif
        throw SummarizerError.unavailable
    }

    private static func clip(_ text: String) -> String {
        guard text.count > inputBudget else { return text }
        return String(text.prefix(inputBudget))
            + "\n\n[transcript truncated for on-device processing]"
    }

    enum SummarizerError: LocalizedError {
        case unavailable
        var errorDescription: String? {
            "On-device AI isn't available on this device or iOS version."
        }
    }
}
