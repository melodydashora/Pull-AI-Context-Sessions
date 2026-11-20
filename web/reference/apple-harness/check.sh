#!/bin/bash
# Rebuilds the command-line harness from the app's unmodified Swift sources and checks that it
# still produces the Apple-side results recorded under web/fixtures/import/.
#
# Needs a Mac with Xcode (xcrun swiftc) and python3. It writes only into a work folder.
# Usage, from anywhere:   web/reference/apple-harness/check.sh [work-folder]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
APP="$REPO/apple/SessionVault"
PORT="$REPO/web/reference/import-port"
WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK"
echo "work folder: $WORK"

# 1. Are the three sources the ones the manifest names? A difference is not an error by itself:
#    the comparison at the end says whether behaviour changed. Update the manifest when it did not.
python3 - "$REPO" <<'PY'
import hashlib, json, os, sys
repo = sys.argv[1]
manifest = json.load(open(os.path.join(repo, "web/fixtures/import/manifest.json"), "rb"))
for path, recorded in manifest["apple_side"]["sources_sha256"].items():
    now = hashlib.sha256(open(os.path.join(repo, path), "rb").read()).hexdigest()
    print("%-9s %s" % ("same" if now == recorded else "CHANGED", path))
PY

# 2. MessageSegment is private to its file. To call it, one accessor is appended to a COPY of
#    MessageView.swift; the original is compiled as it is, as the first part of that copy.
cat "$APP/Views/MessageView.swift" "$HERE/MessageViewShim.swift" > "$WORK/MessageView+Shim.swift"

# 3. Compile the app's real Models.swift and Importers.swift together with the harness.
xcrun swiftc -O -module-cache-path "$WORK/modcache" \
  "$APP/Models.swift" "$APP/Importers.swift" "$WORK/MessageView+Shim.swift" "$HERE/main.swift" \
  -o "$WORK/importer-harness"

# 4. Case descriptors from the manifest, without the fixtures that have no Apple result.
python3 "$PORT/make_cases.py" "$REPO" "$WORK/cases-all.json" > /dev/null
python3 "$HERE/select_cases.py" "$REPO" "$WORK/cases-all.json" "$WORK/cases-apple.json" "$WORK/skipped.json"

# 5. Run. Every file write is denied: the harness can only print. No SwiftData store is opened.
sandbox-exec -p '(version 1)(allow default)(deny file-write*)' \
  "$WORK/importer-harness" "$WORK/cases-apple.json" --watchdog-ms 60000 > "$WORK/out-apple.json"

# 6. Compare with the expected files. The last line should read: apple equal 61 different 0 skipped 2
python3 "$HERE/select_cases.py" --pad "$WORK/out-apple.json" "$WORK/skipped.json" "$WORK/out-padded.json"
python3 "$PORT/compare.py" "$REPO" "$WORK/out-padded.json" apple
