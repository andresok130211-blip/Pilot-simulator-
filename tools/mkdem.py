#!/usr/bin/env python3
# Генерация src/js/geodem.js: рельеф суши из ETOPO1 (NOAA, общественное достояние), сетка 10' из репозитория fatiando-data/earth-topography-10arcmin.
# Использование: xz -dk -c raw/etopo1.gdf.xz > etopo.gdf; python3 tools/mkdem.py etopo.gdf src/js/geodem.js
import sys, zlib, base64
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
rows = []
with open(src) as f:
    for ln in f:
        if ln.startswith('end_of_head'): break
    arr = np.loadtxt(f)
W, H = 2160, 1081
z = arr[:, 2].reshape(H, 2161)[:, :W]
z = np.maximum(z, 0)
z = np.where(z > 1500, 1500 + (z - 1500) * 1.3, z)   # сглаженная сетка занижает пики
UN = 35.0
u = np.clip(np.round(z / UN), 0, 255).astype(np.uint8)
raw = u.tobytes()
c = zlib.compressobj(9, zlib.DEFLATED, -15); d = c.compress(raw) + c.flush()
b = base64.b64encode(d).decode()
print('raw', len(raw), 'deflate', len(d), 'b64', len(b), 'max', u.max())
open(dst, 'w').write(f"""// Автогенерация: tools/mkdem.py (ETOPO1, NOAA, общественное достояние). Не править вручную.
export const DEM_W = {W};
export const DEM_H = {H};
export const DEM_UNIT = {UN};
export const DEM_DATA = '{b}';
""")
