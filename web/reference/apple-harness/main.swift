import Foundation

// SessionVault importer harness.
//
// Compiled together with the UNMODIFIED app sources
//   apple/SessionVault/Importers.swift   (SessionImporter: the real importer)
//   apple/SessionVault/Models.swift      (Provider, Role and the SwiftData model classes)
//   apple/SessionVault/Views/MessageView.swift + MessageViewShim.swift (the real MessageSegment.parse)
//
// It reads a JSON array of case descriptors and prints a JSON array of results.
// No ModelContainer is ever created, so no SwiftData store is opened or written.
//
// What is REAL (calls into the unmodified app code):
//   SessionImporter.parse(data:filename:), .parseText(_:title:), .fromCapturedTurns(_:title:sourceURL:),
//   .looksLikeSignInWall(_:), .stripChromeTurns(_:), MessageSegment.parse(_:)
// What is TRANSCRIBED GLUE (the few lines of SwiftUI view code that sit between the user
// and the importer and cannot be called from a command-line tool). Each block cites its source.

// MARK: - JSON helpers

func isoString(_ date: Date) -> String {
    let ms = (date.timeIntervalSince1970 * 1000).rounded(.down)
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    let whole = Date(timeIntervalSince1970: (ms / 1000).rounded(.down))
    let millis = Int(ms - (ms / 1000).rounded(.down) * 1000)
    return f.string(from: whole) + String(format: ".%03dZ", millis)
}

func sessionJSON(_ s: ImportedSession) -> [String: Any] {
    [
        "title": s.title,
        "provider": s.provider.rawValue,
        "modelName": s.modelName,
        "sourceURL": s.sourceURL,
        "createdAt": s.createdAt.map { isoString($0) as Any } ?? NSNull(),
        "messages": s.messages.map { m -> [String: Any] in
            ["role": m.role.rawValue, "text": m.text, "segments": harnessSegments(m.text)]
        },
    ]
}

func plural(_ n: Int) -> String { n == 1 ? "" : "s" }

// MARK: - Entry: file import
// Real call: SessionImporter.parse(data:filename:)  (Importers.swift:24-33)
// Glue: SessionImporter.importFiles counts sessions (Importers.swift:456-468);
//       ImportSheet.handleFileImport builds the status text (Views/ImportSheet.swift:183-193).
func runFile(data: Data, filename: String) -> [String: Any] {
    let sessions = SessionImporter.parse(data: data, filename: filename)
    var out: [String: Any] = ["entry": "file"]
    if sessions.isEmpty {
        out["outcome"] = "rejected"
        // parse() returns [] in exactly two situations (Importers.swift:31):
        // the bytes are not valid UTF-8, or they decode to the empty string.
        if let text = String(data: data, encoding: .utf8) {
            out["reason"] = text.isEmpty ? "empty_input" : "no_sessions_found"
        } else {
            out["reason"] = "undecodable"
        }
        out["statusMessage"] = "No sessions found in the selected files."
    } else {
        out["outcome"] = "imported"
        out["reason"] = NSNull()
        out["statusMessage"] = "Imported \(sessions.count) session\(plural(sessions.count))."
    }
    out["sessions"] = sessions.map(sessionJSON)
    return out
}

// MARK: - Entry: paste / clipboard
// Glue transcribed from ImportSheet.importFromClipboard (Views/ImportSheet.swift:195-226).
// Real call: SessionImporter.parseText(_:title:) with the title "Pasted session".
func runPaste(text: String?, pasteProvider: Provider) -> [String: Any] {
    var out: [String: Any] = ["entry": "paste"]
    guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        out["outcome"] = "rejected"
        out["reason"] = "empty_input"
        out["statusMessage"] = "Clipboard is empty."
        out["sessions"] = [Any]()
        return out
    }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.contains("\n"), !trimmed.contains(" "), trimmed.contains("."), trimmed.count < 500 {
        var candidate = trimmed
        if !candidate.contains("://") { candidate = "https://" + candidate }
        if let url = URL(string: candidate), url.host() != nil {
            out["outcome"] = "link"
            out["reason"] = NSNull()
            out["linkURL"] = url.absoluteString
            out["statusMessage"] = "That's a link — opening it in the capture browser."
            out["sessions"] = [Any]()
            return out
        }
    }
    let sessions = SessionImporter.parseText(text, title: "Pasted session")
    var stored: [ImportedSession] = []
    for var parsed in sessions {
        if parsed.provider == .other {
            parsed.provider = pasteProvider
        }
        stored.append(parsed)
    }
    out["outcome"] = "imported"
    out["reason"] = NSNull()
    out["statusMessage"] = "Imported \(sessions.count) session\(plural(sessions.count)) from clipboard."
    out["sessions"] = stored.map(sessionJSON)
    return out
}

// MARK: - Chrome-turn bookkeeping (derived with the real stripChromeTurns as the oracle)
// The app drops chrome turns silently. To record WHICH turns it dropped, classify each turn with
// the real function on a one-element array: stripChromeTurns([t]) is [] exactly when t is chrome.
func droppedByChromeFilter(_ turns: [String]) -> (dropped: [[String: Any]], kept: [String]) {
    let kept = SessionImporter.stripChromeTurns(turns)
    func isChrome(_ t: String) -> Bool { SessionImporter.stripChromeTurns([t]).isEmpty }
    var lead = 0
    while lead < turns.count, isChrome(turns[lead]) { lead += 1 }
    var trail = 0
    while turns.count - trail > lead, isChrome(turns[turns.count - 1 - trail]) { trail += 1 }
    // Consistency check against the real multi-turn call.
    let expectedCount = turns.count - lead - trail
    precondition(kept.count == expectedCount, "chrome bookkeeping mismatch: kept \(kept.count) vs \(expectedCount)")
    if expectedCount > 1 {
        precondition(Array(kept.dropFirst()) == Array(turns[(lead + 1)..<(turns.count - trail)]), "chrome bookkeeping mismatch (tail)")
    }
    var dropped: [[String: Any]] = []
    for i in 0..<lead { dropped.append(["position": "leading", "index": i, "text": turns[i]]) }
    for i in (turns.count - trail)..<turns.count { dropped.append(["position": "trailing", "index": i, "text": turns[i]]) }
    return (dropped, kept)
}

// MARK: - Entry: capture result
// Glue transcribed from the Capture button in LinkCaptureView (Views/LinkCaptureView.swift:41-56)
// and the onCapture closure in ImportSheet (Views/ImportSheet.swift:133-150).
// Real calls: SessionImporter.looksLikeSignInWall(_:), SessionImporter.fromCapturedTurns(_:title:sourceURL:).
func runCapture(_ input: [String: Any]) -> [String: Any] {
    var out: [String: Any] = ["entry": "capture"]
    let turns = (input["turns"] as? [String]) ?? []
    let sourceURLString = (input["sourceURL"] as? String) ?? ""
    let detectedTitle = input["detectedTitle"] as? String
    let customName = (input["typedName"] as? String) ?? ""

    // LinkCaptureView.swift:46  guard !turns.isEmpty else { return }
    // (capture() has already set this status, WebCapture.swift:181)
    guard !turns.isEmpty else {
        out["outcome"] = "rejected"
        out["reason"] = "no_conversation_found"
        out["statusMessage"] = "Nothing captured — is the transcript visible in the page?"
        out["sessions"] = [Any]()
        return out
    }
    // LinkCaptureView.swift:50-53
    if SessionImporter.looksLikeSignInWall(turns) {
        out["outcome"] = "rejected"
        out["reason"] = "sign_in_suspected"
        out["statusMessage"] = "That looks like a sign-in or landing page — log in below (or wait for the conversation to appear), then press Capture again."
        out["sessions"] = [Any]()
        return out
    }
    guard let sourceURL = URL(string: sourceURLString) else {
        out["outcome"] = "error"
        out["reason"] = "harness: sourceURL is not a URL"
        return out
    }
    // ImportSheet.swift:134-138
    let fallback = sourceURL.lastPathComponent.isEmpty
        ? sourceURL.absoluteString
        : sourceURL.lastPathComponent
    let typedName = customName.trimmingCharacters(in: .whitespaces)
    let title = typedName.isEmpty ? (detectedTitle ?? fallback) : typedName
    // ImportSheet.swift:139-143
    let parsed = SessionImporter.fromCapturedTurns(
        turns,
        title: title,
        sourceURL: sourceURL.absoluteString
    )
    if turns.count > 1 {
        out["droppedTurns"] = droppedByChromeFilter(turns).dropped
    } else {
        out["droppedTurns"] = [Any]()
    }
    // ImportSheet.swift:144-150
    if parsed.messages.isEmpty {
        out["outcome"] = "rejected"
        out["reason"] = "no_conversation_found"
        out["statusMessage"] = "No conversation content captured from the page."
        out["sessions"] = [Any]()
    } else {
        out["outcome"] = "imported"
        out["reason"] = NSNull()
        // The app appends " — original saved as PDF." instead of "." when a PDF snapshot exists.
        out["statusMessage"] = "Captured \(parsed.messages.count) turns from \(sourceURL.host ?? "the page")."
        out["sessions"] = [sessionJSON(parsed)]
    }
    return out
}

// MARK: - Entry: guard table (unit cases for the two guard functions)
func runGuards(_ input: [String: Any]) -> [String: Any] {
    let cases = (input["cases"] as? [[String: Any]]) ?? []
    var results: [[String: Any]] = []
    for c in cases {
        let turns = (c["turns"] as? [String]) ?? []
        let joined = turns.joined(separator: "\n")
        let (dropped, kept) = droppedByChromeFilter(turns)
        results.append([
            "name": (c["name"] as? String) ?? "",
            "joinedLength": joined.count,
            "signInWall": SessionImporter.looksLikeSignInWall(turns),
            "stripChromeTurns": kept,
            "droppedTurns": dropped,
        ])
    }
    return ["entry": "guards", "results": results]
}

// MARK: - Entry: segment table (how one message text is split into prose and code for display)
func runSegments(_ input: [String: Any]) -> [String: Any] {
    let cases = (input["cases"] as? [[String: Any]]) ?? []
    var results: [[String: Any]] = []
    for c in cases {
        let text = (c["text"] as? String) ?? ""
        results.append(["name": (c["name"] as? String) ?? "", "segments": harnessSegments(text)])
    }
    return ["entry": "segments", "results": results]
}

// MARK: - Driver

func run(_ descriptor: [String: Any]) -> [String: Any] {
    let entry = (descriptor["entry"] as? String) ?? ""
    let data = Data(base64Encoded: (descriptor["inputBase64"] as? String) ?? "") ?? Data()
    var result: [String: Any]
    switch entry {
    case "file":
        result = runFile(data: data, filename: (descriptor["filename"] as? String) ?? "input.txt")
    case "paste":
        let provider = Provider(rawValue: (descriptor["pasteProvider"] as? String) ?? "Claude") ?? .claude
        // The pasted string is the fixture bytes decoded as UTF-8, with no BOM handling.
        result = runPaste(text: String(decoding: data, as: UTF8.self), pasteProvider: provider)
    case "capture", "guards", "segments":
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return ["id": descriptor["id"] ?? "", "outcome": "error", "reason": "harness: input is not a JSON object"]
        }
        switch entry {
        case "capture": result = runCapture(obj)
        case "guards": result = runGuards(obj)
        default: result = runSegments(obj)
        }
    default:
        result = ["outcome": "error", "reason": "harness: unknown entry \(entry)"]
    }
    result["id"] = descriptor["id"] ?? ""
    return result
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write(Data("usage: harness <cases.json>   (array of {id, entry, inputBase64, filename?, pasteProvider?})\n".utf8))
    exit(2)
}
// Optional watchdog: `harness <cases.json> --watchdog-ms 300` exits with code 99 if the run
// does not finish in time. Used once, to confirm a non-terminating loop in the real importer.
if let i = args.firstIndex(of: "--watchdog-ms"), i + 1 < args.count, let ms = Int(args[i + 1]) {
    let thread = Thread {
        Thread.sleep(forTimeInterval: Double(ms) / 1000)
        FileHandle.standardError.write(Data("WATCHDOG: importer did not return within \(ms) ms\n".utf8))
        exit(99)
    }
    thread.start()
}
let casesData = try Data(contentsOf: URL(fileURLWithPath: args[1]))
guard let cases = (try JSONSerialization.jsonObject(with: casesData)) as? [[String: Any]] else {
    FileHandle.standardError.write(Data("cases file must be a JSON array of objects\n".utf8))
    exit(2)
}
let results = cases.map(run)
let outData = try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes])
FileHandle.standardOutput.write(outData)
FileHandle.standardOutput.write(Data("\n".utf8))
