# Import fixtures: golden inputs and expected results

## Summary

- 61 synthetic inputs for the importer described in `import-rules.md`, each with the expected result as JSON. They are the acceptance tests of the web port.
- Every Apple-side expectation was produced by running the REAL importer: `apple/SessionVault/Importers.swift`, compiled unmodified into a command-line harness (commit `c227766`; built and run again at commit `ca37361`, see "Apple side" below). Nothing on the Apple side was written by hand.
- 23 fixtures are `parity`: one file `NN-name.expected.json`, the web app must return the same result as the Apple app.
- 35 fixtures are `defect-fix`: the Apple result is a defect. Two files: `NN-name.expected.apple.json` (what the Apple app does today, for the record) and `NN-name.expected.web.json` (what the web app must do). Only the web file is a test target.
- 3 fixtures are `web-extension`: behaviour that has no Apple counterpart (a sign-in-wall override, a paste with a source link, an optional context-pack parser). Same two files.
- Several inputs depend on exact bytes (CRLF, a byte-order mark, UTF-16, windows-1252, trailing spaces). `manifest.json` holds the SHA-256 of every input; verify it before trusting a test run.
- All content is invented (gardening, bicycle repair, bread, tea). No real conversation, link, name or path appears anywhere.

## Files

| File | Purpose |
|---|---|
| `NN-name.input.txt`, `.md`, `.json` | The input. For `file` and `paste` fixtures these are the raw bytes to import. For `capture`, `guards` and `display-segments` fixtures the input is a JSON document that describes the call (see "Input formats"). |
| `NN-name.expected.json` | Result of the Apple importer; the web app must match it. |
| `NN-name.expected.apple.json` | Result of the Apple importer where that result is a defect. Not a target. |
| `NN-name.expected.web.json` | Target for the web app where it must differ from the Apple app. |
| `manifest.json` | Index: for every fixture its kind, entry point, call parameters, input size and SHA-256, the names of the expected files, what it covers, and why Apple and web differ. Drive the test suite from this file. |
| `.gitattributes` | `* -text`: tells git to store every file in this folder byte for byte. |
| `README.md` | This file. |

Numbering groups the fixtures by entry point: file import first, then paste, then capture results, then three tables of unit cases.

## Keep the bytes exact

- The repository's root `.gitattributes` has the rule `**/fixtures/** -text`, and this folder carries its own `.gitattributes` with `* -text`. Either one is enough. If the folder is moved to a path that has no directory named `fixtures` AND the local `.gitattributes` is lost, git will rewrite CRLF to LF on commit and the CRLF fixtures silently stop testing anything.
- Checked on the day of writing in a scratch repository that used the project's root `.gitattributes`, `.gitignore` and `.editorconfig`: all 151 files were added with `attr/-text`, none was ignored, the CRLF inputs were stored as CRLF, and a checkout with `core.autocrlf=true` reproduced every input with the SHA-256 in the manifest.
- Do not open and save the input files in an editor. Editors strip byte-order marks, trailing spaces and final newlines. To change a fixture, change it deliberately and update the manifest.
- A test run should start by comparing `sha256(input bytes)` with `input_sha256` and fail loudly on a mismatch ("fixture bytes were altered"), before any parser is called.
- Expected files and the manifest are plain ASCII JSON with LF line endings. Non-ASCII characters and control characters in expected strings are written as JSON escapes (a carriage return shows as `\r`, an emoji as a surrogate pair), so nothing in them can be damaged by an editor.

Inputs that an editor or a line-ending conversion would damage (CRLF, a byte-order mark, bytes that are not UTF-8, non-ASCII characters, trailing white space, no final newline): 02, 03, 08, 14, 17, 18, 23, 24, 25, 26, 27, 28, 30, 32, 33, 34.

## How the expected results were produced

Apple side:

- Compiled together, unmodified, with `swiftc` from Apple Swift 6.4 (Xcode 27 beta), macOS 27.2.1, arm64: `apple/SessionVault/Importers.swift`, `apple/SessionVault/Models.swift` (the real SwiftData model file; nothing was stubbed) and `apple/SessionVault/Views/MessageView.swift`. `diff` and `cmp` report the compiled copies identical to the repository files; their SHA-256 values are in `manifest.json` under `apple_side`.
- `MessageSegment` (the prose/code splitter) is declared `private` in `MessageView.swift`. To call it, one accessor function was appended to a copy of that file; the first 6,601 bytes of the compiled file are byte-identical to the original.
- Run again on 2026-11-20 at commit `ca37361`: commit `e81828a` had added a Copy button to `MessageView.swift`, which moved the splitter down in the file without changing it. The harness was rebuilt from the three files as they are in that commit and run on the 55 fixtures that have an Apple result. Its raw output is byte-identical to the output of the first build, and equal to every expected Apple file. `manifest.json` now names that commit and the new SHA-256 of `MessageView.swift`; no input and no expected file changed.
- Fixtures 58 and 59 were added on 2026-11-20. Their Apple side was produced in the same way by the session on the Mac: the harness of `../../reference/apple-harness`, built from the checkout at commit `cefc9ef` (its own check first: apple equal 55 different 0 skipped 2), run on ten inputs with file writes denied, and its raw output for these two mapped as described under "Result format". The reference port in its "apple" mode gave the same messages for all ten.
- Fixtures 60 and 61 were added on 2026-11-20 as well, when the preview rule of W6 got its word boundary. Their Apple side: the same harness, built from the checkout at commit `442726f`, run by the session on the Mac on five inputs, and its raw output for these two mapped as described under "Result format". The reference port in its "apple" mode gave the same messages for all five.
- The importer functions called are the real ones: `SessionImporter.parse(data:filename:)`, `parseText(_:title:)`, `fromCapturedTurns(_:title:sourceURL:)`, `looksLikeSignInWall(_:)`, `stripChromeTurns(_:)`, `MessageSegment.parse(_:)`.
- What had to be transcribed, because it is SwiftUI view code that cannot be called from a command line: the clipboard handler (`Views/ImportSheet.swift:195-226`: empty check, link routing, provider picker), the capture button and its completion (`Views/LinkCaptureView.swift:41-56`, `Views/ImportSheet.swift:133-150`: empty check, sign-in guard, title precedence, status text) and the status text of the file picker (`Views/ImportSheet.swift:183-193`). The `outcome`, `reason` and `apple_status_message` fields come from this transcription; `sessions` come from the real importer.
- `dropped_turns` is bookkeeping added by the harness. The Apple app drops such turns silently. The harness finds out which ones by asking the real `stripChromeTurns` about each turn on its own, and checks the answer against the real multi-turn call.
- No SwiftData store was opened: the harness never creates a `ModelContainer`, and every run was executed under a sandbox profile that denies all file writes.
- The toolchain matters for one detail: the time-line rule of the share-page cleaner is a regular expression, and its exact matching behaviour is the operating system's. None of the fixtures depends on the corner cases (non-ASCII digits, exotic spaces).

Web side:

- The `*.expected.web.json` files state the behaviour that `import-rules.md` asks for (rules W1 to W15). They were generated by a TypeScript port of the importer written for this purpose, run in its "web" mode. The same port in its "apple" mode reproduces the real Swift importer exactly on the 57 fixtures of that day and on 30,000 randomly generated inputs (0 differences); for fixtures 58 to 61 the two were compared on 2026-11-20, with no difference. On a further 10,000 random inputs built to stay clear of the documented differences, the port's web mode equals the Swift importer except in 209 cases, all of which are one of two documented differences (the link decides the provider; the wall test is applied to whole-page text only); 0 differences are unexplained. So the web expectations differ from the Apple ones only where `import-rules.md` says they should.

## Input formats

`manifest.json` gives each fixture an `entry` and a `call` object.

### `file`

The input file is the file the user picked. Call the file importer with the raw bytes and `call.filename` (the name the importer is told; it decides the JSON path and the fallback title). The fixture's own file name is irrelevant.

### `paste`

The input file, decoded as UTF-8, is the pasted string (no paste fixture starts with a byte-order mark). Call parameters:

| `call` field | Meaning |
|---|---|
| `title` | The title the caller passes to the parser. Always `Pasted session`, the Apple constant (`Views/ImportSheet.swift:218`). If the web UI suggests a nicer name it does so outside the parser. |
| `picker_provider` | Value of the provider picker. It replaces the provider only when the parser returns `other`. |
| `source_url` | Optional, web only: the link the text was copied from (capture.md section 8.1). |
| `allow_wall` | Optional, web only: the user answered the sign-in-wall warning with "import anyway". |

### `capture`

The input is a JSON object: what the capture layer hands to the importer.

| Field | Meaning |
|---|---|
| `source_url` | The captured link. |
| `detected_title` | Title found on the page, already cleaned by the capture layer, or `null`. |
| `typed_name` | What the user typed into the name field, possibly empty. |
| `kind` | `"page-text"`: `turns` has one element, the text of the whole page (capture.md strategy type `page-text`). `"turns"`: `turns` holds one string per harvested turn block, with no roles from markup (capture.md strategy type `indexed`). The Apple app has no such field and infers the first case from `turns.length == 1`; in every fixture the two agree. |
| `allow_wall` | Optional, web only. |
| `turns` | Array of strings. Line breaks inside a turn are `\n` in the JSON. |

### `guards`

Input: `{ "cases": [ { "name", "turns": [..] } ] }`. Fixture 55 tests `looksLikeSignInWall(turns)`; fixture 56 tests `stripChromeTurns(turns)`. Results are listed in the same order under the same names.

### `display-segments`

Input: `{ "cases": [ { "name", "text" } ] }`. Each case is one message text; the result is its split into prose and code blocks.

## Result format

Every expected file has this envelope:

```json
{
  "fixture": "NN-name",
  "source": "apple-importer ... | web-target",
  "call": { "entry": "...", "...": "..." },
  "apple_status_message": "what the Apple app shows the user (absent in web files)",
  "notes": ["what the fixture is", "why Apple and web differ, or a caveat"],
  "result": { }
}
```

Only `result` is compared. For the two fixtures where the Apple importer has no stable result (10: it never returns; 11: the order changes from run to run) the Apple file has `"result": null` and describes the behaviour in `apple_behaviour`.

`result` for `file`, `paste` and `capture`:

| Field | Type | Meaning |
|---|---|---|
| `outcome` | string | `imported`: at least one session is to be saved. `rejected`: nothing is saved; `reason` says why. `link`: the pasted text is a link, nothing is saved, `link_url` holds it. |
| `reason` | string or null | `empty_input` (no bytes, or only white space), `undecodable` (the bytes are not text), `unrecognised_json` (a `.json` file that is no known format), `no_messages` (a known format with nothing in it), `no_conversation_found` (a capture with no text, or nothing left after removing page chrome), `sign_in_suspected` (the sign-in-wall test fired; capture.md lists it as a warning: nothing is saved until the call is repeated with `allow_wall`). Capture codes are those of capture.md section 7.5. |
| `link_url` | string | Only with `outcome: link`. |
| `flags` | array of strings | Informational. Web only values: `decoded_as_utf_16le`, `decoded_as_utf_16be`, `decoded_as_windows_1252`. Compare as a set. |
| `sessions` | array | In source order (order of the conversations in the file). |
| `dropped_turns` | array | `capture` only: turns removed as page chrome, each `{ "position": "leading" or "trailing", "index": position in the input, "text" }`. The web UI must show these and let the user restore them (the input `keep_dropped`, `import-rules.md` W10). |

A session:

| Field | Meaning |
|---|---|
| `title` | As parsed. May be empty in Apple files. |
| `provider` | `claude`, `chatgpt`, `gemini` or `other`: the identifiers of data-model.md. The Apple app stores the display strings `Claude`, `ChatGPT`, `Gemini`, `Other` (`apple/SessionVault/Models.swift:4-8`). |
| `model` | Always `""` except in fixture 38. No Apple parser ever fills it. |
| `source_url` | `""` when there is none. |
| `created_at` | RFC 3339 UTC with milliseconds, or `null`. `null` means the source carries no date and the store uses the time of import (`Importers.swift:443`). |
| `summary`, `tags` | Present only in fixture 38 (web). Absent means `""` and `[]`. |
| `messages` | In order. Each has `role` (`user`, `assistant`, `system`, `unknown`), `text`, and `display_segments`. |

The names map to the Apple struct `ImportedSession` (`Importers.swift:9-16`) as `source_url` = `sourceURL`, `created_at` = `createdAt`, `model` = `modelName`; data-model.md section 8.6 turns such a result into rows.

`display_segments` is the split of `text` into `{ "type": "prose", "text" }` and `{ "type": "code", "language": string or null, "code" }` that the Apple app computes each time it draws a message (`Views/MessageView.swift:79-126`). It is never stored.

## What a test must assert

1. Required: `outcome`, `reason`, `link_url` when present, `flags` as a set, the number and order of `sessions`, and for each session `title`, `provider`, `model`, `source_url`, `created_at`, `summary` and `tags` (absent = empty), and for each message `role` and `text`, compared as exact strings. For `capture`, also `dropped_turns`. For fixture 55, `sign_in_wall` and `joined_length`; for fixture 56, `kept` and `dropped_turns`.
2. `display_segments` (inside messages, and fixture 57) is the target for the prose/code splitter (import-rules.md W13; design.md section 4.7.1 specifies the same splitter). If the web app renders with a Markdown library instead of its own splitter, use these values as a rendering checklist: every `code` segment must be shown as a code block with exactly that content.
3. Not asserted: `apple_status_message` (the Apple wording; design.md decides the web wording), `notes`, `source`, `call`.
4. The three `web-extension` fixtures (37, 38, 46) are optional in this sense: if the feature is not built, skip the fixture rather than weaken it.

Test runner sketch (TypeScript, any test framework):

```ts
const dir = "fixtures/import";
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
for (const c of manifest.cases) {
  test(c.id, () => {
    const bytes = readFileSync(`${dir}/${c.input}`);                 // Buffer, never a string
    expect(sha256Hex(bytes)).toBe(c.input_sha256);                     // fixture bytes intact
    const file = c.expected.web ?? c.expected.both;                    // never c.expected.apple
    const expected = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")).result;
    let actual;
    switch (c.entry) {
      case "file":    actual = importFile(bytes, c.call.filename); break;
      case "paste":   actual = importPaste(bytes.toString("utf8"), c.call); break;
      case "capture": actual = importCapture(JSON.parse(bytes.toString("utf8"))); break;
      case "guards":  actual = runGuardTable(JSON.parse(bytes.toString("utf8")), c.id); break;
      case "display-segments": actual = runSegmentTable(JSON.parse(bytes.toString("utf8"))); break;
    }
    expect(toFixtureShape(actual)).toEqual(expected);                  // map your types to the shape above
  });
}
```

`toFixtureShape` is where the web app's own types are mapped to the field names above (and where `display_segments` is dropped if rule 2 applies).

## The fixtures

Kinds: P = parity, F = defect-fix, X = web-extension.

| Fixture | Entry | Kind | Input | What it covers |
|---|---|---|---|---|
| `01-puller-markdown-lf` | file | P | 412 bytes | A transcript exactly as puller/pull_sessions.py writes it, LF line endings. Covers: puller markdown detection; --- separators; role from the first line of a block; unlabelled block becomes role unknown; bold and heading markers; provider from the Source line; title from the # line. |
| `02-puller-markdown-crlf` | file | F | 440 bytes | The same transcript with CRLF line endings (what a text-mode writer produces on Windows; the puller wrote such files before commit `34e84d3`). Covers: CRLF. |
| `03-puller-markdown-bom` | file | P | 415 bytes | The same transcript with a UTF-8 byte-order mark in front. Covers: byte-order mark. |
| `04-puller-markdown-header-only` | file | F | 75 bytes | What the puller writes when it harvested no turns: the two header lines and nothing else. Covers: zero messages. |
| `05-puller-markdown-combined` | file | F | 383 bytes | Two sessions in one file, as written by the puller's --combine option (files joined by a blank line). Covers: all_sessions.md; several sessions in one file. |
| `06-puller-markdown-other-host` | file | F | 180 bytes | Puller-shaped markdown whose Source line is not a claude.ai link. Covers: provider from the link host. |
| `07-chatgpt-export` | file | P | 6446 bytes | A ChatGPT data export (conversations.json) with three conversations. Covers: current_node branch walk; abandoned branch left out; system messages skipped; unknown author role kept as role unknown; non-string parts dropped; parts joined with a newline and trimmed; create_time becomes the session date; fallback order by message create_time; empty title fallback; conversation without messages skipped. |
| `08-chatgpt-single-conversation` | file | P | 778 bytes | A single conversation object (not wrapped in an array) with a mapping; the file starts with a UTF-8 byte-order mark. Covers: single-object JSON shape; integer create_time; byte-order mark in front of JSON (JSON.parse rejects it unless it is removed). |
| `09-chatgpt-one-entry-without-mapping` | file | F | 886 bytes | An export array in which one entry has no mapping. Covers: all-or-nothing detection. |
| `10-chatgpt-parent-cycle` | file | F | 845 bytes | A malformed export in which two nodes name each other as parent. Covers: parent cycle; the importer must terminate. |
| `11-chatgpt-no-current-node-no-times` | file | F | 2186 bytes | A conversation with no current_node and no message timestamps. Covers: fallback order with equal timestamps. |
| `12-json-not-a-chat-export` | file | F | 271 bytes | A .json file that is not a ChatGPT export. Stand-in for the puller's <id>.json payload, whose real schema is not documented in the repository. Covers: puller JSON; unknown JSON. |
| `13-generic-markers-lf` | file | P | 461 bytes | Plain text with every kind of speaker marker, LF line endings. Covers: text before the first marker; Name: markers with text on the same line; **bold** markers; heading markers; bare-name markers; Me / AI / System markers; code block inside a message; provider from a speaker label. |
| `14-generic-markers-crlf` | file | F | 481 bytes | The same text with CRLF line endings (a file saved by Windows Notepad). Covers: CRLF. |
| `15-plain-text-single-speaker` | file | P | 118 bytes | Plain notes with no speaker markers at all. Covers: single-speaker text; one message of role unknown; title from the file name; provider other. |
| `16-text-that-mentions-assistants` | file | F | 188 bytes | A note that names assistants, each on its own line, but is not a dialogue. Covers: provider keyword scan; bare-name markers in prose. |
| `17-whitespace-only-file` | file | F | 7 bytes | A file that contains only spaces, a tab and newlines. Covers: whitespace-only input. |
| `18-empty-file` | file | P | 0 bytes | A zero-byte file. Covers: empty input. |
| `19-code-blocks` | file | P | 488 bytes | Fenced code blocks in every shape the display splitter handles: language, no language, indented fence, empty block, unterminated block. Covers: code blocks; display segments; indentation kept inside code; unterminated fence. |
| `20-role-marker-inside-code-block` | file | F | 150 bytes | A code block whose lines look like speaker markers. Covers: role markers inside fenced code. |
| `21-bold-after-marker` | file | F | 124 bytes | Bold text on the same line as a speaker marker. Covers: ** removal on marker lines. |
| `22-very-long-turn` | file | P | 3369 bytes | One assistant turn of more than 3,000 characters between two short turns. Covers: one very long turn; no length limit; no truncation. |
| `23-non-ascii-and-emoji` | file | P | 395 bytes | Accented Latin (composed and decomposed), Japanese, Arabic, Cyrillic, emoji including a joined family sequence, a marker preceded by a no-break space, a full-width colon, and two lines that end in a zero width space followed by a line holding only U+0085. Covers: non-ASCII text; emoji; no Unicode normalisation of stored text; no-break space before a marker; full-width colon is not a marker; exact trim sets: U+200B and U+0085 are removed at the ends, which JavaScript trim() does not do. |
| `24-utf16le-with-bom` | file | F | 146 bytes | UTF-16 little-endian text with a byte-order mark and CRLF (what Windows PowerShell 5 writes with `>`). Covers: UTF-16; byte-order mark; CRLF. |
| `25-windows-1252` | file | F | 56 bytes | Windows-1252 (ANSI) text with an accented letter, an en dash and curly quotes. Covers: legacy single-byte encoding. |
| `26-paste-share-page-claude` | paste | P | 631 bytes | The visible text of a claude.ai share page (synthetic), pasted. Covers: share-page parser; text before the first header dropped; header-line preview dropped; boilerplate lines removed; bare time lines removed; consecutive duplicate lines removed; blank-line collapsing; provider claude. |
| `27-paste-share-page-claude-crlf` | paste | F | 656 bytes | The same share-page text with CRLF line endings. Covers: CRLF. |
| `28-paste-share-page-code-damage` | paste | F | 431 bytes | Share-page text whose answer contains indented code, repeated lines, and lines that look like page furniture. Covers: share-page cleaning damages code. |
| `29-paste-share-page-chatgpt-headers` | paste | F | 217 bytes | Page text with 'You said:' and 'ChatGPT said:' headers (synthetic). Covers: share-page parser fires on any 'You said:'; provider always Claude. |
| `30-paste-share-header-line-only-turn` | paste | F | 182 bytes | Share-page text in which two turns have text only on their header line. Covers: header-line text is always discarded. |
| `31-paste-link` | paste | P | 47 bytes | The clipboard holds a single link. Covers: link routing. |
| `32-paste-single-word-with-dot` | paste | F | 7 bytes | The clipboard holds one word that ends in a full stop. Covers: link routing false positive. |
| `33-paste-whitespace-only` | paste | P | 5 bytes | The clipboard holds only white space. Covers: empty input. |
| `34-paste-leading-trailing-whitespace` | paste | P | 120 bytes | A short dialogue surrounded and interleaved with blank lines, spaces and tabs; the provider picker is set to Gemini. Covers: leading and trailing whitespace; trimming of messages; inner indentation kept; picker labels an unidentified paste. |
| `35-paste-puller-markdown-leading-blank-lines` | paste | F | 177 bytes | Puller markdown pasted with two blank lines in front of the header. Covers: leading whitespace defeats format detection. |
| `36-paste-sign-in-wall` | paste | F | 222 bytes | The text of a signed-out landing page, pasted. Covers: sign-in wall guard on pasted text. |
| `37-paste-with-source-link` | paste | X | 228 bytes | Pasted page text together with the link it was copied from (the link field of capture.md section 8.1). Covers: paste with a source link; provider from the link host. |
| `38-paste-context-pack` | paste | X | 668 bytes | A context pack, the Apple app's own export (ContextPack.swift), pasted back in. One message contains a '---' line of its own. Covers: context pack round trip. |
| `39-capture-turns-claude` | capture | P | 391 bytes | Four harvested turn blocks from a claude.ai page, with a title detected on the page. Covers: multi-turn capture; role from a leading marker; unlabelled turn becomes role unknown; furniture cleaning inside turns; provider from the link; detected title. |
| `40-capture-turns-chatgpt-url` | capture | F | 236 bytes | Two harvested turn blocks from a chatgpt.com link, no title detected and none typed. Covers: provider from the link host; title falls back to the last path component. |
| `41-capture-header-residue-long-first-turn` | capture | P | 1113 bytes | The first turn (more than 700 characters) starts with page-header lines; the last turn is a page footer. Covers: page-header residue stripped from the first turn; trailing chrome turn dropped; dropped turns reported. |
| `42-capture-header-residue-short-first-turn` | capture | F | 355 bytes | The same shape with a short first turn (under 700 characters). Covers: chrome test runs before header stripping. |
| `43-capture-real-turns-dropped-as-chrome` | capture | P | 334 bytes | A conversation whose first and last turns are short and happen to contain the letters 'sign in'. Covers: real turns dropped silently; substring matching ('design integrates' contains 'sign in'). |
| `44-capture-sign-in-wall` | capture | P | 388 bytes | The whole-page text of a signed-out landing page. Covers: sign-in wall guard; nothing is saved. |
| `45-capture-short-conversation-flagged-as-wall` | capture | P | 462 bytes | A whole-page capture of a short, real conversation that mentions 'sign in' and 'log in'. Covers: sign-in wall false positive. |
| `46-capture-wall-override` | capture | X | 484 bytes | The same capture again, after the user answered the warning with 'import anyway' (allow_wall is true). Covers: sign-in wall override. |
| `47-capture-page-text-claude-share` | capture | P | 552 bytes | A whole-page capture (one block) of a claude.ai share page; the user typed a name. Covers: single-block capture runs the text parsers; typed name wins over the detected title; source link stored. |
| `48-capture-page-text-gemini-unsplit` | capture | F | 464 bytes | A whole-page capture from a Gemini link: no speaker labels at all, the first line is the word 'Gemini', and the conversation mentions Claude. Covers: unsplit single-message capture; wrong provider label. |
| `49-capture-page-text-gemini-labels` | capture | F | 437 bytes | The same conversation with the label lines 'You said' and 'Gemini said' (no colon) that an earlier review reported for Gemini chat pages. Unverified against a live page. Covers: Gemini label lines without a colon; unsplit single-message capture; wrong provider label. |
| `50-capture-all-chrome` | capture | P | 204 bytes | Every harvested block is page chrome. Covers: nothing left after chrome stripping. |
| `51-capture-nothing` | capture | P | 147 bytes | The capture returned no text at all. Covers: empty capture. |
| `52-capture-marker-only-turns` | capture | F | 251 bytes | Two of the four blocks consist of a speaker label and nothing else. Covers: empty messages. |
| `53-capture-code-in-turns` | capture | F | 334 bytes | A harvested turn that contains indented code with a repeated line. Covers: furniture cleaning damages code in captured turns. |
| `54-capture-fenced-code-in-turns` | capture | F | 298 bytes | A harvested turn with a fenced code block whose lines look like page furniture (capture.md fences code at extraction time). Covers: furniture cleaning inside fenced code. |
| `55-guards-sign-in-wall-table` | guards | P | 20759 bytes | Unit cases for looksLikeSignInWall: both length thresholds, both hit thresholds, how markers are counted, and that length is counted in user-perceived characters. Covers: looksLikeSignInWall thresholds; grapheme counting. |
| `56-guards-chrome-turns-table` | guards | F | 11053 bytes | Unit cases for stripChromeTurns: the 700-character limit, each chrome condition, the header-line rules (90 characters, 12 lines), and the order of the two steps. Covers: stripChromeTurns; stripLeadingHeaderLines thresholds. |
| `57-display-segments-table` | display-segments | F | 2405 bytes | Unit cases for the display splitter that turns one message text into prose and code blocks. Covers: display segments. |
| `58-paste-share-text-on-header-line` | paste | F | 176 bytes | Text in the share-page shape as a person types it: a sentence on each speaker line, a blank line, more text. Covers: text on a speaker line is the first line of the turn; the blank line after it is kept. |
| `59-paste-share-preview-not-repeated` | paste | F | 138 bytes | Share-page text whose speaker lines end in an ellipsis like a preview, while the text after them does not repeat it. Covers: a preview that the next line does not begin with is kept; the ellipsis is cut for the comparison only. |
| `60-paste-share-label-starts-a-longer-word` | paste | F | 107 bytes | Share-page text whose speaker lines hold one short word that the next line begins a longer word with: 'No' before 'Nothing', 'Yes' before 'Yesterday'. Covers: without an ellipsis, text on a speaker line is a preview only if it ends where a word ends; a short first line that begins the next line's first word is kept. |
| `61-paste-share-label-before-digit-or-mark` | paste | F | 92 bytes | Share-page text whose speaker-line text is followed in the next line by a digit ('Version 1' before 'Version 10') and by a combining mark ('Cafe' before 'Cafe' with U+0301). Covers: a digit after the repeated text means it is not a preview; a combining mark after the repeated text means it is not a preview. |

## Why the Apple and web results differ

One entry per fixture that has two expected files. Rule numbers (W1 to W15) and defect numbers (D1 to D19) refer to `import-rules.md`.

- `02-puller-markdown-crlf` (D1, W1): Apple splits on LF only and its inline trim does not remove CR: no separator is recognised, all turns merge into one message, the title and the source URL end in a carriage return, and the code block never closes. The web app normalises line endings first and must return exactly the result of the LF fixture.
- `04-puller-markdown-header-only` (D8, W5, W12): Apple saves a session with zero messages and reports success. The web app must not save it.
- `05-puller-markdown-combined` (D11, W5): Apple reads the file as one session: the second header and its first turn become a single message of role unknown. The web app starts a new session at every header pair that begins a block.
- `06-puller-markdown-other-host` (D2, D11, W9): Apple knows one host only (claude.ai) and labels everything else Other. The web app maps the link host to a provider.
- `09-chatgpt-one-entry-without-mapping` (D9, W4): Apple rejects the whole array as a ChatGPT export and then imports the raw JSON text as one Note. The web app imports the valid conversations and skips the others.
- `10-chatgpt-parent-cycle` (D9, W4): Apple follows `parent` links with no cycle check: the importer never returns and its node list grows without bound (confirmed with a watchdog: no result after 400 ms, while the same data without the cycle returns in about 20 ms). The web app stops at the first node it has already visited.
- `11-chatgpt-no-current-node-no-times` (D9, W4): Without current_node Apple sorts the mapping's values by message create_time. The values come from a dictionary with no defined order and the sort is not stable, so messages with equal or missing times come out in a different order on every run. The web app uses a stable sort and keeps the order of the keys in the JSON text for ties.
- `12-json-not-a-chat-export` (D9, W3): Apple imports the raw JSON text as one message of role unknown and labels it Claude because the text contains that word. The web app refuses it with a clear reason and lets the user choose to keep it as a plain-text note.
- `14-generic-markers-crlf` (D1, W1): Apple misses every marker that has no colon (the line ends in a carriage return), leaves CR characters inside the stored text, and the code block never closes when the message is displayed. The web app must return exactly the result of the LF fixture.
- `16-text-that-mentions-assistants` (D2, D7, W8, W9): Apple treats the three name lines as speaker markers (the last paragraph becomes an assistant message) and labels the session Claude because the word occurs in the text. The web app ignores bare names unless the text has both a user and an assistant marker, and never guesses the provider from words in the content.
- `17-whitespace-only-file` (D8, W2, W12): Apple saves a session that holds one empty message. The web app rejects the file as empty.
- `20-role-marker-inside-code-block` (D7, W8): Apple splits the assistant's message at `user:`, `system:` and `ai:` inside the code block, producing five messages and a broken block. The web app does not look for markers inside a closed fenced block.
- `21-bold-after-marker` (D7, W8): Apple deletes every `**` on a marker line, so bold markup after the label is lost. The web app removes `**` only where it decorates the label itself.
- `24-utf16le-with-bom` (D10, W2): Apple decodes files as UTF-8 only; this file yields no session and the message 'No sessions found in the selected files.' The web app detects the byte-order mark, decodes UTF-16 and imports the transcript, flagging the encoding it used.
- `25-windows-1252` (D10, W2): Not valid UTF-8, so Apple imports nothing. The web app falls back to windows-1252 for text that is not UTF-8 and flags it.
- `27-paste-share-page-claude-crlf` (D1, W1): With CR left at the end of every line Apple no longer recognises the exact-match furniture (Copy, Retry), blank lines or the '10:42 AM' time lines, and keeps CR characters in the text. The web app must return exactly the result of the LF fixture.
- `28-paste-share-page-code-damage` (D5, W7): Apple trims every line (indentation is lost) and drops any line equal to the previous non-empty one (a repeated statement disappears). The web app keeps indentation and never removes an indented line. Still removed in both, by design of the heuristic: the second unindented `print` line, the line `Share` and the line `10:30`.
- `29-paste-share-page-chatgpt-headers` (D6, W6): Apple's share parser knows only 'You said:' and 'Claude responded:'. Every answer is appended to the question before it, all messages are user messages, and the session is labelled Claude. The web app also accepts 'ChatGPT said:', 'Gemini said:' and 'Claude said:' as assistant headers and takes the provider from the header family.
- `30-paste-share-header-line-only-turn` (D6, W6): Apple discards the text after 'You said:' as a preview. A turn with nothing else vanishes: here both user turns are lost. The web app falls back to the header-line text when a turn has no body.
- `32-paste-single-word-with-dot` (D12, W11): Apple treats any single token under 500 characters that contains a dot as a link and opens the capture browser at https://Thanks. The web app uses `looksLikeLink` of capture.md section 8.1 (the host must contain a dot, must not end in a dot, and must end in a label of two or more letters); this text is not a link and is imported as a note.
- `35-paste-puller-markdown-leading-blank-lines` (D11, W5): Apple requires the header on the very first line. Here detection fails, the generic parser takes over, the header becomes a Note, every message keeps a trailing '---', and the title is 'Pasted session'. The web app skips leading blank lines.
- `36-paste-sign-in-wall` (D3, W11): In the Apple app the sign-in-wall guard exists only on the capture path: pasted wall text is saved as a session. The web app applies the same test to pasted text and answers `sign_in_suspected`; the user may then choose to import anyway.
- `37-paste-with-source-link` (W9, W11): The Apple paste path has no link: the session gets the picker's provider and an empty source URL. In the web app the link becomes the source URL and its host decides the provider, whatever the picker says.
- `38-paste-context-pack` (D15, W14): Apple has no parser for its own export: the header block becomes a Note, every message keeps a trailing '---', the '**Note:**' turn is glued to the previous message, and title, link, tags and summary are lost. OPTIONAL for the web app (data-model.md prefers the interchange format for transfers): a parser that reads the format back into title, provider, model, link, tags, summary and clean messages.
- `40-capture-turns-chatgpt-url` (D2, W9): Apple labels every multi-turn capture that is not from claude.ai as Other. The web app maps the link host to a provider.
- `42-capture-header-residue-short-first-turn` (D4, W10): Apple tests the raw first turn for chrome before it strips header lines. A turn under 700 characters that contains 'sign in' is dropped whole, so the user's question is lost. The web app strips the header lines first and judges what is left.
- `46-capture-wall-override` (D3, W10): The Apple app has no override: the capture stays refused. In the web app the guard only warns; with allow_wall the capture is imported normally.
- `48-capture-page-text-gemini-unsplit` (D2, W8, W9): This reproduces how a whole page becomes one mislabelled message. Apple: the first line is a bare-name marker, so the whole page becomes ONE message of role assistant, and the keyword scan finds 'claude' before 'gemini', so the session is labelled Claude although the link is a Gemini link. The web app takes the provider from the link host, does not honour a lone bare name, and keeps the page as one message of role unknown for the user to review. Nothing in this text allows a split.
- `49-capture-page-text-gemini-labels` (D2, W6, W9): Apple knows these labels only with a colon, so the result is the same single assistant message labelled Claude. The web app accepts the two whole-line labels when BOTH occur in the text and splits the page into turns. The rule is built on a reported page layout, not on an observed one; if real pages differ it simply does not fire and the previous fixture applies.
- `52-capture-marker-only-turns` (D8, W12): Apple stores a message with empty text for each label-only block. The web app never stores an empty message.
- `53-capture-code-in-turns` (D5, W7): Every captured turn goes through the share-page cleaner. Apple flattens the indentation and deletes the repeated call. The web app keeps indented lines exactly.
- `54-capture-fenced-code-in-turns` (D5, W7): Apple applies the furniture rules inside the fence too: the lines `Copy`, `10:30` and `Share`, the repeated `make build` and one of the two blank lines disappear from the code. The web app copies a closed fenced block untouched; the `Copy` line after the block is still removed.
- `56-guards-chrome-turns-table` (D4, W10): Only the two cases whose name starts with ORDER differ. Apple judges the raw first turn, so header residue condemns the whole turn. The web app strips header lines first. The second ORDER case shows the price: a page name that used to be dropped with its 'Sign in' line now survives as a short turn.
- `57-display-segments-table` (D1, D16, W13): Only the four cases whose name starts with DIFFERENT differ. Apple: CR breaks every fence; a line that starts with three backticks always opens a block, even when it is a one-line code span; fences are exactly three backticks, so a four-backtick fence is mis-split. The web app normalises line endings and follows the CommonMark fence rules for backtick fences.
- `58-paste-share-text-on-header-line` (D19, W6): Apple discards the text after 'You said:' and 'Claude responded:' whenever more text follows: the first sentence of both turns is lost. The web app keeps it as the first line of the turn, because the line after it does not begin with it.
- `59-paste-share-preview-not-repeated` (D19, W6): Apple discards the text after the header as a preview. Here the next line does not begin with it, so the words exist nowhere else and are lost. The web app drops such text only when the first non-blank line after it begins with it, after one trailing ellipsis has been cut for the comparison; otherwise it keeps the text as the first line of the turn, ellipsis included.
- `60-paste-share-label-starts-a-longer-word` (D19, W6): Apple discards the text after the header whenever more text follows: 'No' and 'Yes' are lost. The web app takes such text for a preview only when the next line begins with it and, no ellipsis having been cut, the text ends where a word ends. 'Nothing' continues 'No' with a letter, so 'No' is kept as the first line of the turn.
- `61-paste-share-label-before-digit-or-mark` (D19, W6): Apple discards the text after the header whenever more text follows. The web app keeps it here: the next line begins with it, but continues with a digit in one turn and with a combining mark in the other, so the text does not end where a word ends and is the first line of the turn.

## Parity fixtures with a caveat

The result is identical on both sides, but the web app must behave differently around it.

- `31-paste-link` (W11): Nothing is imported. The Apple app opens its capture browser at `link_url`; the web app shows the link help of capture.md section 8.1 (and offers server capture where that tier exists).
- `43-capture-real-turns-dropped-as-chrome` (D4): Both real turns are classified as chrome and dropped, in the Apple app and by the same test in the web app. This weakness of the heuristic is kept on purpose (see import-rules.md, defect D4). What must change is outside this result: the Apple app drops silently, the web app must show `dropped_turns` to the user and let them be restored before saving.
- `44-capture-sign-in-wall` (D3, W10): The guard function must give the same answer. In the Apple app nothing is saved and a one-line status asks the user to log in and capture again. The web app reports `sign_in_suspected` as a warning and must also offer 'import anyway' (allow_wall).
- `45-capture-short-conversation-flagged-as-wall` (D3, W10): A false positive of the guard: under 1,200 characters with two marker phrases. The function result is kept identical. The Apple app gives the user no way to save this conversation; the web app must offer 'import anyway' (next fixture).

## Changing or regenerating fixtures

- The Apple side cannot be regenerated on Linux: it needs a Mac with a Swift toolchain. Treat the `*.expected.json` and `*.expected.apple.json` files as recorded facts.
- The web side is a specification. If a rule in `import-rules.md` is changed on purpose, change the affected `*.expected.web.json` in the same commit and say why in the commit message. Do not edit an expected file to make a failing test pass.
- New fixtures: follow the naming scheme, add the entry to `manifest.json` with the SHA-256 of the input, keep the content synthetic.
