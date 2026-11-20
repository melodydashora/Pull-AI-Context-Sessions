"""Helper for check.sh.

select_cases.py <repository> <all cases> <cases with an Apple result> <ids left out>
    Keeps the cases whose expected Apple result is recorded. Two fixtures have none
    (the real importer never returns on fixture 10), so they must not be run.
select_cases.py --pad <harness output> <ids left out> <padded output>
    Adds a placeholder result for each case that was left out, so that compare.py,
    which looks up every case of the manifest, reports them as skipped.
"""
import json
import os
import sys

if sys.argv[1] == "--pad":
    out_path, skipped_path, padded_path = sys.argv[2], sys.argv[3], sys.argv[4]
    results = json.load(open(out_path))
    for case_id in json.load(open(skipped_path)):
        results.append({"id": case_id, "outcome": "error", "reason": "not run on the Apple side", "sessions": []})
    json.dump(results, open(padded_path, "w"))
    messages = sum(len(s["messages"]) for r in results for s in r.get("sessions", []))
    print("results: %d; messages run through the real MessageSegment.parse: %d" % (len(results), messages))
else:
    repo, all_path, keep_path, skipped_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    d = os.path.join(repo, "web/fixtures/import")
    manifest = json.load(open(os.path.join(d, "manifest.json"), "rb"))
    skipped = []
    for case in manifest["cases"]:
        expected = case["expected"]
        name = expected.get("both") or expected.get("apple")
        if json.load(open(os.path.join(d, name)))["result"] is None:
            skipped.append(case["id"])
    cases = [c for c in json.load(open(all_path)) if c["id"] not in skipped]
    json.dump(cases, open(keep_path, "w"))
    json.dump(skipped, open(skipped_path, "w"))
    print("cases with a recorded Apple result: %d; left out: %s" % (len(cases), ", ".join(skipped)))
