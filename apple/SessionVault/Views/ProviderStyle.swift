import SwiftUI

extension Provider {
    /// Accent used for badges and chips throughout the UI.
    var tint: Color {
        switch self {
        case .claude: return .orange
        case .chatgpt: return .teal
        case .gemini: return .blue
        case .other: return .gray
        }
    }
}
