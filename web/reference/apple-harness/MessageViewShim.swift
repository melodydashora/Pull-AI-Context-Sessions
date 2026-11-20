
// ---------------------------------------------------------------------------
// HARNESS SHIM. Everything above this line is the unmodified
// apple/SessionVault/Views/MessageView.swift (byte-identical prefix: check.sh
// appends this file to an unchanged copy). `MessageSegment` is declared `private` at file scope, so the
// only way to call the real `MessageSegment.parse` without editing the source
// is to append an accessor to the same compilation unit. This shim adds one
// function and changes nothing else.
// ---------------------------------------------------------------------------
import Foundation

func harnessSegments(_ text: String) -> [[String: Any]] {
    MessageSegment.parse(text).map { segment -> [String: Any] in
        switch segment.kind {
        case .prose(let prose):
            return ["type": "prose", "text": prose]
        case .code(let language, let code):
            return ["type": "code", "language": language.map { $0 as Any } ?? NSNull(), "code": code]
        }
    }
}
