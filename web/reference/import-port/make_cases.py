# Build the descriptor list run.ts expects from manifest.json (mapping worked out by reading run.ts and importer.ts).
import json, base64, os, sys
root, out = sys.argv[1], sys.argv[2]
d = os.path.join(root, 'web/fixtures/import')
m = json.load(open(os.path.join(d, 'manifest.json'), 'rb'))
PROV = {'claude': 'Claude', 'chatgpt': 'ChatGPT', 'gemini': 'Gemini', 'other': 'Other'}
cases = []
for c in m['cases']:
    b = open(os.path.join(d, c['input']), 'rb').read()
    desc = {'id': c['id'], 'entry': c['entry']}
    call = c['call']
    if c['entry'] == 'file':
        desc['filename'] = call['filename']
    elif c['entry'] == 'paste':
        desc['title'] = call['title']
        desc['pasteProvider'] = PROV[call['picker_provider']]
        if 'source_url' in call: desc['sourceURL'] = call['source_url']
        if 'allow_wall' in call: desc['allowWall'] = call['allow_wall']
    elif c['entry'] == 'capture':
        j = json.loads(b.decode('utf-8'))
        conv = {'sourceURL': j['source_url'], 'detectedTitle': j.get('detected_title'), 'typedName': j.get('typed_name', ''), 'kind': j['kind'], 'turns': j['turns']}
        if 'allow_wall' in j: conv['allowWall'] = j['allow_wall']
        extra = set(j.keys()) - {'source_url', 'detected_title', 'typed_name', 'kind', 'turns', 'allow_wall'}
        if extra: print('capture input extra keys', c['id'], extra)
        b = json.dumps(conv, ensure_ascii=False).encode('utf-8')
    elif c['entry'] == 'display-segments':
        desc['entry'] = 'segments'
    desc['inputBase64'] = base64.b64encode(b).decode('ascii')
    cases.append(desc)
json.dump(cases, open(out, 'w'))
print('wrote', len(cases))
