# Reference port of the importer

`importer.ts` is a TypeScript port of `apple/SessionVault/Importers.swift` and of the display splitter in `apple/SessionVault/Views/MessageView.swift`, written from `../../docs/import-rules.md`. `run.ts` runs it over case descriptors and prints results.

It has two modes:

- `apple`: the behaviour of the Apple app, defects included. This mode was compared with the real Swift importer on every fixture in `../../fixtures/import/` and on 30,000 random inputs, with no difference.
- `web`: the behaviour `import-rules.md` asks of the web app. This mode generated the `*.expected.web.json` files.

What it is not: reviewed product code. It ran under Node with type stripping only; it was never compiled with `tsc` and never run in a browser. Adopt it, rewrite it or ignore it. The fixtures are the contract, not this file.

It uses only `Intl.Segmenter`, `URL` and `TextDecoder`: no DOM and no Node modules, apart from `run.ts`, which reads a file.
