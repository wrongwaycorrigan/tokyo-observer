import csv
import io
import json
import os
import sys
import urllib.request

BASE = 'https://davidmegginson.github.io/ourairports-data/'
BBOX = (34.5, 138.8, 36.5, 140.9)
TYPES = {'large_airport', 'medium_airport', 'small_airport'}
FT = 0.3048


def rows(name, folder):
    if folder:
        with open(os.path.join(folder, name), encoding='utf-8') as fh:
            return list(csv.DictReader(fh))
    with urllib.request.urlopen(BASE + name, timeout=120) as res:
        return list(csv.DictReader(io.StringIO(res.read().decode('utf-8'))))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main(folder=None):
    airports = {}
    for a in rows('airports.csv', folder):
        lat, lon = num(a['latitude_deg']), num(a['longitude_deg'])
        if a['type'] in TYPES and lat and lon and BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]:
            airports[a['ident']] = a['name']
    out = []
    for r in rows('runways.csv', folder):
        if r['airport_ident'] not in airports or r['closed'] == '1':
            continue
        ends = [num(r[k]) for k in ('le_latitude_deg', 'le_longitude_deg', 'he_latitude_deg', 'he_longitude_deg')]
        if None in ends:
            continue
        out.append({
            'airport': r['airport_ident'],
            'name': airports[r['airport_ident']],
            'ident': f"{r['le_ident']}/{r['he_ident']}",
            'ends': [round(e, 6) for e in ends],
            'width': round((num(r['width_ft']) or 100) * FT, 1),
            'surface': r['surface'],
            'lighted': r['lighted'] == '1',
            'displaced': [round((num(r['le_displaced_threshold_ft']) or 0) * FT), round((num(r['he_displaced_threshold_ft']) or 0) * FT)],
        })
    path = os.path.join(os.path.dirname(__file__), '..', 'data', 'runways.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump({'attribution': 'OurAirports (public domain)', 'runways': out}, fh, separators=(',', ':'))
    print(len(out), 'runways at', len({r['airport'] for r in out}), 'airports')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
