#!/usr/bin/env python3
# Генерация src/js/geodata.js из Natural Earth (public domain): суша/вода растром, реки, города.
# Использование: python3 tools/mkgeo.py /путь/к/natural-earth-vector/geojson
import json, sys, base64, math
import numpy as np
from PIL import Image, ImageDraw
src = sys.argv[1] if len(sys.argv) > 1 else '.'
RES = 0.025
W, H = int(360 / RES), int(180 / RES)

def load(n): return json.load(open(f'{src}/ne_10m_{n}.geojson'))

def polys(g):
    t = g['type']
    if t == 'Polygon': yield g['coordinates']
    elif t == 'MultiPolygon':
        for p in g['coordinates']: yield p

img = Image.new('L', (W, H), 0)
dr = ImageDraw.Draw(img)
px = lambda ring: [((x + 180) / RES, (90 - y) / RES) for x, y in ring]
for f in load('land')['features']:
    for p in polys(f['geometry']):
        dr.polygon(px(p[0]), fill=1)
        for hole in p[1:]: dr.polygon(px(hole), fill=0)
for f in load('lakes')['features']:
    if not f['geometry']: continue
    for p in polys(f['geometry']):
        dr.polygon(px(p[0]), fill=0)
        for isl in p[1:]: dr.polygon(px(isl), fill=1)
a = np.array(img, dtype=np.uint8)

def varint(n, out):
    while n >= 128: out.append((n & 127) | 128); n >>= 7
    out.append(n)
out = bytearray()
for row in a:
    # чередующиеся серии, начиная с воды
    d = np.diff(row.astype(np.int8)); idx = np.nonzero(d)[0] + 1
    bounds = [0] + idx.tolist() + [W]
    runs = [bounds[i + 1] - bounds[i] for i in range(len(bounds) - 1)]
    if row[0] == 1: runs = [0] + runs
    varint(len(runs), out)
    for r in runs: varint(r, out)
land_b64 = base64.b64encode(bytes(out)).decode()
print('land rle bytes', len(out), 'b64', len(land_b64))

# --- реки: упрощённые ломаные, квантование 0.01°, дельты ---
def dp(pts, eps):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    while st:
        i, j = st.pop(); (x1, y1), (x2, y2) = pts[i], pts[j]; dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1e-9
        m, k = -1, -1
        for q in range(i + 1, j):
            d = abs(dy * (pts[q][0] - x1) - dx * (pts[q][1] - y1)) / L
            if d > m: m, k = d, q
        if m > eps: keep[k] = True; st += [(i, k), (k, j)]
    return [p for p, kp in zip(pts, keep) if kp]
rv = bytearray(); nriv = 0; npts = 0
def zz(n): return (n << 1) ^ (n >> 63)
for f in load('rivers_lake_centerlines')['features']:
    sr = f['properties']['scalerank']
    if sr is None or sr > 9 or not f['geometry']: continue
    g = f['geometry']; lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    for ln in lines:
        pts = dp([(p[0], p[1]) for p in ln], 0.012)
        if len(pts) < 2: continue
        q = [(round(x * 100), round(y * 100)) for x, y in pts]
        varint(int(sr), rv); varint(len(q), rv)
        varint(zz(q[0][0]), rv); varint(zz(q[0][1]), rv)
        for i in range(1, len(q)): varint(zz(q[i][0] - q[i - 1][0]), rv); varint(zz(q[i][1] - q[i - 1][1]), rv)
        nriv += 1; npts += len(q)
riv_b64 = base64.b64encode(bytes(rv)).decode()
print('rivers', nriv, 'pts', npts, 'bytes', len(rv), 'b64', len(riv_b64))

# --- города: lon, lat (0.01°), население (тыс.) ---
ct = bytearray(); nc = 0
for f in load('populated_places_simple')['features']:
    p = f['properties']; pop = p.get('pop_max') or p.get('pop_min') or 0
    if pop < 30000: continue
    x, y = f['geometry']['coordinates']
    varint(round((x + 180) * 100), ct); varint(round((y + 90) * 100), ct); varint(int(pop / 1000), ct); nc += 1
ct_b64 = base64.b64encode(bytes(ct)).decode()
print('cities', nc, 'bytes', len(ct), 'b64', len(ct_b64))

js = f"""// Автогенерация: tools/mkgeo.py (данные Natural Earth, общественное достояние). Не править вручную.
export const GEO_RES = {RES};
export const GEO_W = {W};
export const GEO_H = {H};
export const GEO_LAND = '{land_b64}';
export const GEO_RIVERS = '{riv_b64}';
export const GEO_CITIES = '{ct_b64}';
"""
open(sys.argv[2] if len(sys.argv) > 2 else 'geodata.js', 'w').write(js)
print('total js', len(js))
