import json
import os
import sys
import time
import urllib.parse
import urllib.request

BBOX = (34.87, 139.05, 36.13, 140.59)
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
QUERY = f"""
[out:json][timeout:120];
(
  way["aeroway"="terminal"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  relation["aeroway"="terminal"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["building"="terminal"]["aeroway"!="terminal"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out geom;
"""
LEVEL_M = 4.5
DEFAULT_LEVELS = 3
MIN_AREA_M2 = 400


def fetch(path):
    if path:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    for attempt in range(4):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': QUERY}).encode(), headers={'User-Agent': 'tokyo-observer-build'})
                with urllib.request.urlopen(req, timeout=180) as res:
                    return json.load(res)
            except Exception as ex:
                print(url, ex, file=sys.stderr)
        time.sleep(8)
    raise SystemExit('overpass unavailable')


def num(v):
    try:
        return float(str(v).replace('m', '').split(';')[0])
    except (TypeError, ValueError):
        return None


def area(ring):
    k = 90_500 * 111_000
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))) / 2 * k


def rings(el):
    if el['type'] == 'way':
        return [[[round(p['lon'], 6), round(p['lat'], 6)] for p in el['geometry']]]
    return [[[round(p['lon'], 6), round(p['lat'], 6)] for p in m['geometry']] for m in el.get('members', []) if m.get('role') == 'outer' and m.get('geometry')]


def main(path=None):
    out = []
    for el in fetch(path)['elements']:
        tags = el.get('tags', {})
        height = num(tags.get('height')) or (num(tags.get('building:levels')) or DEFAULT_LEVELS) * LEVEL_M
        for r in rings(el):
            if r[0] == r[-1]:
                r = r[:-1]
            if len(r) < 3 or area(r) < MIN_AREA_M2:
                continue
            out.append({'name': tags.get('name:en') or tags.get('name', ''), 'height': round(height, 1), 'ring': r})
    dest = os.path.join(os.path.dirname(__file__), '..', 'data', 'terminals.json')
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump({'attribution': '(c) OpenStreetMap contributors, ODbL', 'terminals': out}, fh, ensure_ascii=False, separators=(',', ':'))
    for t in out:
        print(f"{t['height']:>5}m {len(t['ring']):>4} pts  {t['name']}")
    print(f'{len(out)} terminals -> {os.path.normpath(dest)}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
