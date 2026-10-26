import json
import math
import os
import struct
import sys
import time
import urllib.request

try:
    import DracoPy
    import numpy as np
except ImportError:
    raise SystemExit('needs: python -m pip install DracoPy numpy')

ASSETS = 'https://assets.cms.plateau.reearth.io/assets/'
SITES = [
    {'name': 'skytree', 'lat': 35.71006, 'lon': 139.81070, 'match': '東京スカイツリー', 'target': 1500,
     'tileset': ASSETS + 'f8/3a75b8-f75a-4ec0-9e56-da7eb661b399/13107_sumida-ku_pref_2025_citygml_1_op_bldg_3dtiles_13107_sumida-ku_lod3_no_texture/tileset.json'},
    {'name': 'tokyoTower', 'lat': 35.65858, 'lon': 139.74543, 'match': None, 'target': 1200,
     'tileset': ASSETS + 'c7/1aabcb-eb54-4cfe-9b75-3a6458c9d29e/13103_minato-ku_pref_2025_citygml_1_op_bldg_3dtiles_13103_minato-ku_lod2_no_texture/tileset.json'},
]
SEARCH_M = 150
MARGIN_RAD = 0.00008
A = 6378137.0
E2 = 6.69437999014e-3


def fetch(url):
    cache = os.environ.get('PLATEAU_CACHE')
    path = os.path.join(cache, url.replace(ASSETS, '').replace('/', '_')) if cache else None
    if path and os.path.exists(path):
        return open(path, 'rb').read()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'tokyo-observer-build'}), timeout=120) as r:
                data = r.read()
            break
        except OSError as ex:
            print('retry', attempt + 1, ex, file=sys.stderr)
            time.sleep(5)
    else:
        raise SystemExit(f'download failed: {url}')
    if path:
        os.makedirs(cache, exist_ok=True)
        open(path, 'wb').write(data)
    return data


def containing(node, lat, lon, depth=0, out=None):
    out = [] if out is None else out
    w, s, e, n = node['boundingVolume']['region'][:4]
    m = MARGIN_RAD
    if not (w - m <= math.radians(lon) <= e + m and s - m <= math.radians(lat) <= n + m):
        return out
    if 'content' in node:
        out.append((depth, node['content']['uri']))
    for c in node.get('children', []):
        containing(c, lat, lon, depth + 1, out)
    return out


def ecef(lat, lon, h=0.0):
    p, l = math.radians(lat), math.radians(lon)
    nn = A / math.sqrt(1 - E2 * math.sin(p) ** 2)
    return np.array([(nn + h) * math.cos(p) * math.cos(l), (nn + h) * math.cos(p) * math.sin(l), (nn * (1 - E2) + h) * math.sin(p)])


def enu_matrix(lat, lon):
    p, l = math.radians(lat), math.radians(lon)
    return np.array([
        [-math.sin(l), math.cos(l), 0],
        [-math.sin(p) * math.cos(l), -math.sin(p) * math.sin(l), math.cos(p)],
        [math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p)],
    ])


def read_tile(data):
    _, _, _, ftj, ftb, btj, btb = struct.unpack('<4sIIIIII', data[:28])
    o = 28 + ftj + ftb
    batch = json.loads(data[o:o + btj]) if btj else {}
    glb = data[o + btj + btb:]
    jlen = struct.unpack('<I', glb[12:16])[0]
    gj = json.loads(glb[20:20 + jlen])
    bo = 20 + jlen
    blen = struct.unpack('<I', glb[bo:bo + 4])[0]
    return batch, gj, glb[bo + 8:bo + 8 + blen]


def decode(gj, bin_chunk):
    rtc = np.array(gj.get('extensions', {}).get('CESIUM_RTC', {}).get('center', [0, 0, 0]))
    pts, faces, ids = [], [], []
    base = 0
    for mesh in gj['meshes']:
        for prim in mesh['primitives']:
            ext = prim['extensions']['KHR_draco_mesh_compression']
            bv = gj['bufferViews'][ext['bufferView']]
            off = bv.get('byteOffset', 0)
            m = DracoPy.decode(bin_chunk[off:off + bv['byteLength']])
            p = np.asarray(m.points, dtype=np.float64).reshape(-1, 3)
            bid = np.asarray(m.get_attribute_by_unique_id(ext['attributes']['_BATCHID'])['data']).reshape(-1)
            pts.append(np.column_stack([p[:, 0], -p[:, 2], p[:, 1]]) + rtc)
            faces.append(np.asarray(m.faces, dtype=np.int64).reshape(-1, 3) + base)
            ids.append(bid.astype(np.int64))
            base += len(p)
    return np.vstack(pts), np.vstack(faces), np.concatenate(ids)


def pick(site, local, faces, ids, batch):
    names = batch.get('gml:name') or []
    if site['match']:
        for i, n in enumerate(names):
            if n and site['match'] in n:
                return i
    best, best_h = None, -1
    for b in np.unique(ids):
        sel = local[ids == b]
        cx, cz = sel[:, 0].mean(), sel[:, 1].mean()
        if math.hypot(cx, cz) > SEARCH_M:
            continue
        h = sel[:, 2].max() - sel[:, 2].min()
        if h > best_h:
            best, best_h = int(b), h
    return best


def simplify(pos, tris, target):
    cell = 0.5
    while True:
        keys = np.floor(pos / cell).astype(np.int64)
        uniq, inv = np.unique(keys, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        cent = np.zeros((len(uniq), 3))
        np.add.at(cent, inv, pos)
        cent /= np.bincount(inv, minlength=len(uniq))[:, None]
        t = inv[tris]
        t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]
        _, first = np.unique(np.sort(t, axis=1), axis=0, return_index=True)
        t = t[np.sort(first)]
        if len(t) <= target:
            used, remap = np.unique(t, return_inverse=True)
            return cent[used], remap.reshape(-1, 3), cell
        cell *= 1.25


def main():
    out = {}
    for site in SITES:
        tileset = json.loads(fetch(site['tileset']))
        tiles = containing(tileset['root'], site['lat'], site['lon'])
        top = max(d for d, _ in tiles)
        found = None
        for depth, uri in sorted(tiles, reverse=True):
            if depth < top - 1:
                break
            batch, gj, bin_chunk = read_tile(fetch(site['tileset'].rsplit('/', 1)[0] + '/' + uri))
            world, faces, ids = decode(gj, bin_chunk)
            enu = (world - ecef(site['lat'], site['lon'])) @ enu_matrix(site['lat'], site['lon']).T
            b = pick(site, enu, faces, ids, batch)
            if b is None:
                continue
            h = np.ptp(enu[ids == b][:, 2])
            if found is None or h > found[0]:
                found = (h, uri, enu, faces, ids, b)
        if found is None:
            print(site['name'], 'not found')
            continue
        _, uri, enu, faces, ids, b = found
        keep = faces[(ids[faces] == b).all(axis=1)]
        used, remap = np.unique(keep, return_inverse=True)
        local = enu[used]
        local[:, 2] -= local[:, 2].min()
        pos = np.column_stack([local[:, 0], local[:, 2], -local[:, 1]])
        top = pos[:, 1] > pos[:, 1].max() - 30
        cx, cz = pos[top, 0].mean(), pos[top, 2].mean()
        pos[:, 0] -= cx
        pos[:, 2] -= cz
        low, tris, cell = simplify(pos, remap.reshape(-1, 3), site['target'])
        height = float(pos[:, 1].max())
        print(f"{site['name']}: tile {uri}, batch {b}, {len(keep)} -> {len(tris)} tris (cell {cell:.1f} m), height {height:.0f} m, offset {cx:.0f},{cz:.0f}")
        out[site['name']] = {
            'height': round(height, 1),
            'offset': [round(cx, 1), round(cz, 1)],
            'positions': [round(float(v), 1) for v in low.reshape(-1)],
            'indices': [int(i) for i in tris.reshape(-1)],
        }
    dest = os.path.join(os.path.dirname(__file__), '..', 'data', 'plateau_landmarks.json')
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump({'attribution': 'PLATEAU (MLIT Japan), CC BY 4.0', 'models': out}, fh, separators=(',', ':'))
    print('->', os.path.normpath(dest), os.path.getsize(dest), 'bytes')


if __name__ == '__main__':
    main()
