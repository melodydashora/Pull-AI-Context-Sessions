# Reference port of the importer

`importer.ts` is a TypeScript port of `apple/SessionVault/Importers.swift` and of the display splitter in `apple/SessionVault/Views/MessageView.swift`, written from `../../docs/import-rules.md`. `run.ts` runs it over case descriptors and prints results.

It has two modes:

- `apple`: the behaviour of the Apple app, defects included. This mode was compared with the real Swift importer on every fixture in `../../fixtures/import/` and on 30,000 random inputs, with no difference.
- `web`: the behaviour `import-rules.md` asks of the web app. This mode generated the `*.expected.web.json` files.

What it is not: reviewed product code. It ran under Node with type stripping only; it was never compiled with `tsc` and never run in a browser. Adopt it, rewrite it or ignore it. The fixtures are the contract, not this file.

It uses only `Intl.Segmenter`, `URL` and `TextDecoder`: no DOM and no Node modules, apart from `run.ts`, which reads a file.

## Running it against the fixtures

`run.ts` does not read the manifest directly: it takes a list of case descriptors in its own shape and prints results in the shape of the Swift test harness. Two small scripts bridge the gap. From the top of the repository:

```
python3 web/reference/import-port/make_cases.py . /tmp/cases.json
node web/reference/import-port/run.ts /tmp/cases.json web > /tmp/out-web.json
python3 web/reference/import-port/compare.py . /tmp/out-web.json web
```

- `make_cases.py <repository> <output file>` builds the descriptors from `web/fixtures/import/manifest.json`.
- `run.ts <cases file> <apple|web>` needs a Node that runs TypeScript files directly (type stripping). It was run on Node 25. On an older Node, compile it first or run it through the project's TypeScript tooling.
- `compare.py <repository> <results file> <apple|web>` maps the results to the fixture shape and compares them with the expected files.

Checked on 2026-11-20, after fixtures 58 to 63 were added with the preview rule of W6, its word boundary and its two readings of a turn: `web` mode gives "equal 63 different 0", `apple` mode gives "equal 61 different 0 skipped 2" (fixtures 10 and 11 have no recorded Apple result).

Added on 2026-11-20: the capture entry takes `keepDropped`, the list of dropped turns that a user restored (`import-rules.md` W10). No fixture covers it; the worked example in W10 was produced with this port. Without `keepDropped` the port behaves as before, and both checks above were run again after the change.

Corrected on 2026-11-20 in the web mode: UTF-16 with an odd last byte. `TextDecoder` turns that byte into U+FFFD; W2 (`../../docs/corrections.md`, section 3, point 1) says it is ignored. No fixture has such an input; both checks above give the same lines after the change.

## Known defects

Found on 2026-11-20 by the session that builds the web app, and not fixed yet. None of them changes the result of a fixture. `../../docs/corrections.md`, section 3, points 11 to 15, has the detail:

- Ties in the time order of a ChatGPT export follow `Object.keys`, so keys that look like integers come first; the rule asks for the order of the keys in the JSON text.
- Role lines of a context pack are looked up in a plain object, so a line `constructor` is taken for a role line.
- Two patterns use `.`, which does not match U+2028 or U+2029.
- The trim expressions are quadratic on a long run of blanks inside one line.
- It is not written for a strict compiler, and its text normalisation skips lone surrogates where `String.prototype.toWellFormed` does not exist.

Do not adopt the port as product code without fixing these.
