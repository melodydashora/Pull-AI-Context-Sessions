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

Checked on 2026-11-20: `web` mode gives "equal 57 different 0", `apple` mode gives "equal 55 different 0 skipped 2" (fixtures 10 and 11 have no recorded Apple result).
