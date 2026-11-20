# Map run.ts output (harness raw shape) to the fixture result shape and compare with expected files.
import json, os, sys
root, outfile, mode = sys.argv[1], sys.argv[2], sys.argv[3]
d = os.path.join(root, 'web/fixtures/import')
m = json.load(open(os.path.join(d, 'manifest.json'), 'rb'))
res = {r['id']: r for r in json.load(open(outfile))}
def seg(s):
    return s
def shape(c, r):
    e = c['entry']
    if e in ('file', 'paste', 'capture'):
        if r.get('outcome') == 'error':
            return {'ERROR': r.get('reason')}
        o = {'outcome': r['outcome'], 'reason': r['reason']}
        if 'linkURL' in r: o['link_url'] = r['linkURL']
        o['flags'] = sorted(r.get('flags') or [])
        ss = []
        for s in r['sessions']:
            x = {'title': s['title'], 'provider': s['provider'].lower(), 'model': s['modelName'], 'source_url': s['sourceURL'], 'created_at': s['createdAt']}
            if 'summary' in s: x['summary'] = s['summary']
            if 'tags' in s: x['tags'] = s['tags']
            x['messages'] = [{'role': mm['role'], 'text': mm['text'], 'display_segments': mm['segments']} for mm in s['messages']]
            ss.append(x)
        o['sessions'] = ss
        if e == 'capture': o['dropped_turns'] = r.get('droppedTurns') or []
        return o
    if e == 'guards':
        if c['id'].startswith('55'):
            return {'results': [{'name': x['name'], 'joined_length': x['joinedLength'], 'sign_in_wall': x['signInWall']} for x in r['results']]}
        return {'results': [{'name': x['name'], 'kept': x['stripChromeTurns'], 'dropped_turns': x['droppedTurns']} for x in r['results']]}
    if e == 'display-segments':
        return {'results': [{'name': x['name'], 'display_segments': x['segments']} for x in r['results']]}
ok = bad = skipped = 0
for c in m['cases']:
    exp = c['expected']
    fn = exp.get('both') or exp.get(mode)
    expected = json.load(open(os.path.join(d, fn)))['result']
    actual = shape(c, res[c['id']])
    if expected is None:
        skipped += 1
        print('SKIP (expected result null)', c['id'], '-> actual', json.dumps(actual)[:160])
        continue
    if isinstance(expected, dict) and 'flags' in expected: expected = dict(expected, flags=sorted(expected['flags']))
    if actual == expected:
        ok += 1
    else:
        bad += 1
        print('DIFF', c['id'], fn)
        print('   expected', json.dumps(expected)[:700])
        print('   actual  ', json.dumps(actual)[:700])
print(mode, 'equal', ok, 'different', bad, 'skipped', skipped)
