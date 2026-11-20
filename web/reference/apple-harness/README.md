# Apple harness: the real importer on the command line

The "Apple side" of every fixture under `../../fixtures/import/` was produced by the Apple app's own code, not written by hand. This folder holds what is needed to do that again: on a Mac, whenever `apple/SessionVault/Importers.swift`, `Models.swift` or `Views/MessageView.swift` changes, or whenever someone doubts a recorded result.

| File | What it is |
|---|---|
| `main.swift` | A command-line program that reads case descriptors and prints results. It calls the app's real functions: `SessionImporter.parse(data:filename:)`, `parseText(_:title:)`, `fromCapturedTurns(_:title:sourceURL:)`, `looksLikeSignInWall(_:)`, `stripChromeTurns(_:)` and `MessageSegment.parse(_:)`. The few lines of SwiftUI view code that sit between a user and the importer cannot be called from a command line; they are transcribed in this file, each block with the lines it was taken from. |
| `MessageViewShim.swift` | One accessor function. `MessageSegment` is private to `MessageView.swift`, so the accessor is appended to a copy of that file at build time. The app's file is not edited. |
| `check.sh` | Builds the harness from the Swift files as they are in this checkout, runs the fixtures that have an Apple result, and compares with the expected files. |
| `select_cases.py` | Helper for `check.sh`. |

## Running it

Needs a Mac with Xcode and `python3`. From the top of the repository:

```sh
web/reference/apple-harness/check.sh
```

If `xcrun` reports that it requires Xcode, set `DEVELOPER_DIR` as the README at the top of the repository describes. The script writes only into a temporary work folder (or the folder given as its argument), and the harness itself runs with every file write denied.

Expected last line:

```text
apple equal 57 different 0 skipped 2
```

Fixtures 10 and 11 have no recorded Apple result and are not run: on fixture 10 the real importer never returns, and on fixture 11 the order of its result changes from run to run (`../../fixtures/import/README.md`).

## When the result differs

- A line `CHANGED <path>` at the top only says that a Swift file differs from the one the manifest names. If the comparison still ends with "equal 57 different 0", behaviour did not change: record the new commit and the new SHA-256 values in `manifest.json` under `apple_side`, in a commit of its own.
- A `DIFF` line means the Apple app now behaves differently on that fixture. Do not edit the expected file to make it pass. Find out which change in the Swift source caused it, decide whether the web target (`*.expected.web.json`) is affected, and record the evidence in the commit.

## What this is not

It is not a test of the web app, and it is not needed to build the web app. The web targets are the `*.expected.web.json` and `*.expected.json` files; `../import-port/` checks those without a Mac.

History: first run at commit `c227766` (2026-11-19). Run again at commit `ca37361` (2026-11-20) after a Copy button had been added to `MessageView.swift`: the raw output for the 55 cases was byte-identical to the first run. On 2026-11-20 ten further inputs were run at commit `cefc9ef`; two of them became fixtures 58 and 59, so 57 cases have an Apple result from then on.
