// Runs the reference port over the same case descriptors the Swift harness takes and prints
// results in the harness's raw shape, so the two can be compared field by field.
//   node run.ts <cases.json> <apple|web>
import { readFileSync } from "node:fs";
import {
  importFile, importPaste, importCapture, looksLikeSignInWall, stripChromeTurns,
  splitDisplaySegments, countGraphemes, normaliseText,
} from "./importer.ts";
import type { Mode, Provider, ImportResult, CaptureInput } from "./importer.ts";

const [casesPath, modeArg] = process.argv.slice(2);
const mode = modeArg as Mode;
if (!casesPath || (mode !== "apple" && mode !== "web")) {
  console.error("usage: node run.ts <cases.json> <apple|web>");
  process.exit(2);
}

function withSegments(result: ImportResult): Record<string, unknown> {
  const out: Record<string, unknown> = { ...result };
  out.sessions = result.sessions.map((s) => ({
    ...s,
    messages: s.messages.map((m) => ({ ...m, segments: splitDisplaySegments(m.text, mode) })),
  }));
  return out;
}

function run(descriptor: Record<string, any>): Record<string, unknown> {
  const bytes = new Uint8Array(Buffer.from(descriptor.inputBase64 ?? "", "base64"));
  let result: Record<string, unknown>;
  switch (descriptor.entry) {
    case "file":
      result = withSegments(importFile(bytes, descriptor.filename ?? "input.txt", mode));
      break;
    case "paste": {
      // The pasted string is the fixture bytes decoded as UTF-8 with no BOM handling.
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      result = withSegments(importPaste(text, (descriptor.pasteProvider ?? "Claude") as Provider, mode,
        { title: descriptor.title, sourceURL: descriptor.sourceURL, allowWall: descriptor.allowWall }));
      break;
    }
    case "capture": {
      const input = JSON.parse(Buffer.from(bytes).toString("utf8")) as CaptureInput;
      result = withSegments(importCapture(input, mode));
      break;
    }
    case "guards": {
      const input = JSON.parse(Buffer.from(bytes).toString("utf8"));
      result = {
        entry: "guards",
        results: (input.cases as any[]).map((c) => {
          const turns: string[] = mode === "web" ? c.turns.map(normaliseText) : c.turns;
          const chrome = stripChromeTurns(turns, mode);
          return {
            name: c.name,
            joinedLength: countGraphemes(turns.join("\n")),
            signInWall: looksLikeSignInWall(turns),
            stripChromeTurns: chrome.kept,
            droppedTurns: chrome.dropped,
          };
        }),
      };
      break;
    }
    case "segments": {
      const input = JSON.parse(Buffer.from(bytes).toString("utf8"));
      result = {
        entry: "segments",
        results: (input.cases as any[]).map((c) => ({ name: c.name, segments: splitDisplaySegments(c.text, mode) })),
      };
      break;
    }
    default:
      result = { outcome: "error", reason: "unknown entry " + descriptor.entry };
  }
  result.id = descriptor.id;
  return result;
}

const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Record<string, any>[];
const results = cases.map((c) => {
  try { return run(c); } catch (e) { return { id: c.id, outcome: "error", reason: String(e) }; }
});
process.stdout.write(JSON.stringify(results, null, 2) + "\n");
