#!/usr/bin/env python3
# Биомы из Natural Earth (общественное достояние): пустыни, тундра, ледники, болота, солончаки -> растр 0.1°, RLE.
# python3 tools/mkbiome.py /путь/к/geojson src/js/geobiome.js
import json, sys, base64
import numpy as np
from PIL import Image, ImageDraw
src = sys.argv[1]; RES = 0.1; W, H = 3600, 1800
img = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(img)
px = lambda ring: [((x + 180) / RES, (90 - y) / RES) for x, y in ring]
def polys(g):
    if not g: return
    if g['type'] == 'Polygon': yield g['coordinates']
    elif g['type'] == 'MultiPolygon':
        for p in g['coordinates']: yield p
def paint(name, val):
    for f in json.load(open(f'{src}/{name}.geojson'))['features']:
        for p in polys(f['geometry']):
            dr.polygon(px(p[0]), fill=val)
            for h in p[1:]: dr.polygon(px(h), fill=0)
regs = json.load(open(f'{src}/ne_10m_geography_regions_polys.geojson'))['features']
for cls, val in (('Wetlands', 4), ('Tundra', 2), ('Desert', 1)):
    for f in regs:
        if f['properties']['FEATURECLA'] != cls: continue
        for p in polys(f['geometry']): dr.polygon(px(p[0]), fill=val)
paint('ne_10m_playas', 5)
paint('ne_10m_glaciated_areas', 3)
a = np.array(img, dtype=np.uint8)
out = bytearray()
def varint(n):
    while n >= 128: out.append((n & 127) | 128); n >>= 7
    out.append(n)
for row in a:
    d = np.diff(row.astype(np.int16)); idx = np.nonzero(d)[0] + 1
    b = [0] + idx.tolist() + [W]
    varint(len(b) - 1)
    for i in range(len(b) - 1): varint(b[i + 1] - b[i]); varint(int(row[b[i]]))
open(sys.argv[2], 'w').write(f"// Автогенерация: tools/mkbiome.py (Natural Earth). Не править вручную.\nexport const BIO_RES = {RES};\nexport const BIO_W = {W};\nexport const BIO_H = {H};\nexport const BIO_DATA = '{base64.b64encode(bytes(out)).decode()}';\n")
print('bytes', len(out), 'classes', np.unique(a, return_counts=True))
