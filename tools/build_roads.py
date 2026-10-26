import json
import math
import os
import sys
import urllib.parse
import urllib.request

BBOX = (34.87, 139.05, 36.13, 140.6)
CLASSES = {'motorway': 0, 'trunk': 1, 'primary': 2}
TOLERANCE_M = 25
QUERY = '[out:json][timeout:180];way["highway"~"^(motorway|trunk|primary)$"](%s,%s,%s,%s);out geom qt;' % BBOX


def to_xy(lon, lat):
    return lon * 111320 * math.cos(math.radians(35.5)), lat * 110574


def simplify(points, tol):
    if len(points) < 3:
        return points
    ax, ay = to_xy(*points[0])
    bx, by = to_xy(*points[-1])
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy) or 1
    best, index = 0, 0
    for i in range(1, len(points) - 1):
        px, py = to_xy(*points[i])
        d = abs(dy * px - dx * py + bx * ay - by * ax) / length
        if d > best:
            best, index = d, i
    if best <= tol:
        return [points[0], points[-1]]
    return simplify(points[:index + 1], tol)[:-1] + simplify(points[index:], tol)


def fetch():
    body = urllib.parse.urlencode({'data': QUERY}).encode()
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=body, headers={'User-Agent': 'TokyoObserver/2.0'})
    with urllib.request.urlopen(req, timeout=300) as res:
        return json.load(res)


def main(source=None):
    if source:
        with open(source, encoding='utf-8') as fh:
            data = json.load(fh)
    else:
        data = fetch()
    roads = []
    for el in data['elements']:
        tags = el.get('tags', {})
        cls = CLASSES.get(tags.get('highway'))
        geom = el.get('geometry')
        if cls is None or not geom or tags.get('tunnel', 'no') != 'no':
            continue
        pts = simplify([(g['lon'], g['lat']) for g in geom], TOLERANCE_M)
        flat = [cls]
        for lon, lat in pts:
            flat += [round(lon, 4), round(lat, 4)]
        roads.append(flat)
    out = os.path.join(os.path.dirname(__file__), '..', 'data', 'roads.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump({'attribution': '(c) OpenStreetMap contributors, ODbL', 'roads': roads}, fh, separators=(',', ':'))
    print(len(roads), 'roads', os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
