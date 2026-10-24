#!/usr/bin/env python3
# Данные мира для Godot: dem.png (рельеф в метрах: R — старший байт, G — младший), bio.png (биомы, R8), coast.png (суша/вода 8192x4096).
# python3 tools/mkgodot_data.py etopo.gdf /путь/к/natural-earth-vector/geojson godot/assets
import sys, json
import numpy as np
from PIL import Image, ImageDraw
gdf, ne, out = sys.argv[1:4]
with open(gdf) as f:
    for ln in f:
        if ln.startswith('end_of_head'): break
    arr = np.loadtxt(f)
W, H = 2160, 1081
z = arr[:, 2].reshape(H, 2161)[:, :W]
z = np.maximum(z, 0); z = np.where(z > 1500, 1500 + (z - 1500) * 1.3, z)
from scipy.ndimage import gaussian_filter
z = np.maximum(gaussian_filter(z, 0.6), 0)
m = np.clip(np.round(z), 0, 65535).astype(np.uint16)
rgb = np.zeros((H, W, 3), np.uint8); rgb[..., 0] = m >> 8; rgb[..., 1] = m & 255
Image.fromarray(rgb, 'RGB').save(f'{out}/dem.png', optimize=True)
def polys(g):
    if not g: return
    if g['type'] == 'Polygon': yield g['coordinates']
    elif g['type'] == 'MultiPolygon':
        for p in g['coordinates']: yield p
def raster(W, H, layers):
    img = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(img)
    px = lambda ring: [((x + 180) / 360 * W, (90 - y) / 180 * H) for x, y in ring]
    for name, val, flt, holes in layers:
        for f in json.load(open(f'{ne}/{name}.geojson'))['features']:
            if flt and not flt(f): continue
            for p in polys(f['geometry']):
                dr.polygon(px(p[0]), fill=val)
                if holes:
                    for h in p[1:]: dr.polygon(px(h), fill=0 if holes == 'water' else 1)
    return img
# суша: land минус озёра
img = raster(8192, 4096, [('ne_10m_land', 1, None, 'water'), ('ne_10m_lakes', 0, None, 'land')])
Image.fromarray(np.array(img, dtype=np.uint8) * 255, 'L').save(f'{out}/coast.png', optimize=True)
cls = lambda c: (lambda f: f['properties']['FEATURECLA'] == c)
bio = raster(4096, 2048, [('ne_10m_geography_regions_polys', 4, cls('Wetlands'), None), ('ne_10m_geography_regions_polys', 2, cls('Tundra'), None),
                          ('ne_10m_geography_regions_polys', 1, cls('Desert'), None), ('ne_10m_playas', 5, None, None), ('ne_10m_glaciated_areas', 3, None, None)])
bio.save(f'{out}/bio.png', optimize=True)
