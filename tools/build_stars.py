import gzip
import json
import os
import sys
import urllib.request

URL = 'https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz'
MAG_LIMIT = 5.5


def num(s):
    try:
        return float(s)
    except ValueError:
        return None


def lines(path):
    if path:
        with open(path, 'rb') as fh:
            raw = fh.read()
    else:
        with urllib.request.urlopen(URL, timeout=120) as res:
            raw = res.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return raw.decode('latin-1').splitlines()


def main(path=None):
    out = []
    for line in lines(path):
        line = line.ljust(114)
        mag = num(line[102:107])
        rah, ram, ras = num(line[75:77]), num(line[77:79]), num(line[79:83])
        ded, dem, des = num(line[84:86]), num(line[86:88]), num(line[88:90])
        if mag is None or mag > MAG_LIMIT or None in (rah, ram, ras, ded, dem, des):
            continue
        ra = (rah + ram / 60 + ras / 3600) * 15
        dec = ded + dem / 60 + des / 3600
        if line[83] == '-':
            dec = -dec
        bv = num(line[109:114])
        out.append([round(ra, 3), round(dec, 3), round(mag, 2), round(bv if bv is not None else 0.6, 2)])
    out.sort(key=lambda s: s[2])
    dest = os.path.join(os.path.dirname(__file__), '..', 'data', 'stars.json')
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump({'source': 'Yale Bright Star Catalogue 5th ed. (CDS V/50), J2000', 'stars': out}, fh, separators=(',', ':'))
    print(f'{len(out)} stars -> {os.path.normpath(dest)}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
