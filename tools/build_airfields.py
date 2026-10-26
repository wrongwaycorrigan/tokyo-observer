import json
import os
import sys
import time
import urllib.parse
import urllib.request

BBOX = (34.5, 138.8, 36.5, 140.9)
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
ICAO = 'RJAA|RJAH|RJTA|RJTC|RJTE|RJTF|RJTJ|RJTK|RJTL|RJTO|RJTT|RJTY'
QUERY = f"""
[out:json][timeout:120];
(
  way["aeroway"="aerodrome"]["icao"~"^({ICAO})$"];
  relation["aeroway"="aerodrome"]["icao"~"^({ICAO})$"];
);
out geom;
"""
SIMPLIFY_M = 25


def fetch(path):
    if path:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    for attempt in range(3):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': QUERY}).encode(), headers={'User-Agent': 'tokyo-observer-build'})
                with urllib.request.urlopen(req, timeout=180) as res:
                    return json.load(res)
            except Exception as ex:
                print(url, ex, file=sys.stderr)
        time.sleep(5)
    raise SystemExit('overpass unavailable')


def simplify(ring):
    out = [ring[0]]
    for p in ring[1:]:
        q = out[-1]
        if abs(p[0] - q[0]) * 90_500 + abs(p[1] - q[1]) * 111_000 >= SIMPLIFY_M:
            out.append(p)
    return out if len(out) >= 4 else ring


def rings(el):
    if el['type'] == 'way':
        return [[[round(p['lon'], 5), round(p['lat'], 5)] for p in el['geometry']]]
    out = []
    for m in el.get('members', []):
        if m.get('role') == 'outer' and m.get('geometry'):
            out.append([[round(p['lon'], 5), round(p['lat'], 5)] for p in m['geometry']])
    return out


def main(path=None):
    fields = []
    for el in fetch(path)['elements']:
        tags = el.get('tags', {})
        if not (tags.get('icao') or tags.get('iata')):
            continue
        rs = [simplify(r) for r in rings(el) if len(r) >= 4]
        if rs:
            fields.append({'icao': tags.get('icao', ''), 'name': tags.get('name:en') or tags.get('name', ''), 'rings': rs})
    dest = os.path.join(os.path.dirname(__file__), '..', 'data', 'airfields.json')
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump({'attribution': '(c) OpenStreetMap contributors, ODbL', 'airfields': fields}, fh, ensure_ascii=False, separators=(',', ':'))
    for f in fields:
        print(f"{f['icao'] or '----'} {sum(len(r) for r in f['rings']):>4} pts  {f['name']}")
    print(f'{len(fields)} airfields -> {os.path.normpath(dest)}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
