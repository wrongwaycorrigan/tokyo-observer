import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

BBOX = (35.38, 139.60, 35.70, 140.12)
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
QUERY = f"""
[out:json][timeout:150];
(
  way["building"="warehouse"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["building"="ferry_terminal"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["amenity"="ferry_terminal"]["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out tags geom;
"""
MIN_AREA_M2 = 600
LEVEL_M = 6
DEFAULT_LEVELS = 2


def fetch(path):
    if path:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    for attempt in range(4):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': QUERY}).encode(), headers={'User-Agent': 'tokyo-observer-build'})
                with urllib.request.urlopen(req, timeout=200) as res:
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


def rect(geom):
    lat0 = sum(p['lat'] for p in geom) / len(geom)
    lon0 = sum(p['lon'] for p in geom) / len(geom)
    k = math.cos(math.radians(lat0))
    pts = [((p['lon'] - lon0) * 111_320 * k, (p['lat'] - lat0) * 110_574) for p in geom]
    best = None
    for deg in range(90):
        a = math.radians(deg)
        c, s = math.cos(a), math.sin(a)
        u = [x * c + y * s for x, y in pts]
        v = [-x * s + y * c for x, y in pts]
        area = (max(u) - min(u)) * (max(v) - min(v))
        if best is None or area < best[0]:
            cu, cv = (max(u) + min(u)) / 2, (max(v) + min(v)) / 2
            best = (area, deg, max(u) - min(u), max(v) - min(v), cu * c - cv * s, cu * s + cv * c)
    area, deg, w, d, cx, cy = best
    return lat0 + cy / 110_574, lon0 + cx / (111_320 * k), w, d, deg, area


def main(path=None):
    out = []
    for el in fetch(path)['elements']:
        geom = el.get('geometry') or []
        if len(geom) < 4:
            continue
        tags = el.get('tags', {})
        lat, lon, w, d, rot, area = rect(geom)
        if area < MIN_AREA_M2:
            continue
        h = num(tags.get('height')) or (num(tags.get('building:levels')) or DEFAULT_LEVELS) * LEVEL_M
        kind = 1 if 'ferry' in (tags.get('building', '') + tags.get('amenity', '')) else 0
        out.append([round(lon, 6), round(lat, 6), round(w), round(d), rot, round(min(h, 40)), kind])
    dest = os.path.join(os.path.dirname(__file__), '..', 'data', 'port_buildings.json')
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump({'attribution': '(c) OpenStreetMap contributors, ODbL', 'fields': ['lon', 'lat', 'w', 'd', 'rot', 'h', 'ferry'], 'buildings': out}, fh, separators=(',', ':'))
    print(f'{len(out)} buildings ({sum(b[6] for b in out)} ferry) -> {os.path.normpath(dest)}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
