// Реальная география (Natural Earth): суша/вода, реки, города. Данные — geodata.js.
import { GEO_RES, GEO_W, GEO_H, GEO_LAND, GEO_RIVERS, GEO_CITIES } from './geodata.js';
import { inflateRaw } from './inflate.js';
import { DEM_W, DEM_H, DEM_UNIT, DEM_DATA } from './geodem.js';

const R_EARTH = 6371000, D2R = Math.PI / 180;
const b64 = s => { const t = atob(s), a = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return a; };

// ---- суша: построчные серии (вода, суша, вода, ...) ----
let rowOff = null, runs = null;
function initLand() {
  if (rowOff) return;
  const a = b64(GEO_LAND); let p = 0;
  const rd = () => { let v = 0, sh = 0, b; do { b = a[p++]; v |= (b & 127) << sh; sh += 7; } while (b & 128); return v; };
  rowOff = new Int32Array(GEO_H + 1); const tmp = [];
  for (let r = 0; r < GEO_H; r++) { rowOff[r] = tmp.length; const n = rd(); let c = 0; for (let i = 0; i < n; i++) { c += rd(); tmp.push(c); } }
  rowOff[GEO_H] = tmp.length; runs = Int32Array.from(tmp);
}
// 1 — суша, 0 — вода (ячейка растра)
function cell(col, row) {
  if (row < 0) row = 0; else if (row >= GEO_H) row = GEO_H - 1;
  col = ((col % GEO_W) + GEO_W) % GEO_W;
  let lo = rowOff[row], hi = rowOff[row + 1];
  const s = lo;
  while (lo < hi) { const m = (lo + hi) >> 1; if (runs[m] <= col) lo = m + 1; else hi = m; }
  return (lo - s) & 1;
}
// сглаженная «сухость» 0..1 (билинейно по 4 ячейкам)
export function landF(lon, lat) {
  initLand();
  const x = (lon + 180) / GEO_RES - 0.5, y = (90 - lat) / GEO_RES - 0.5;
  const c = Math.floor(x), r = Math.floor(y), fx = x - c, fy = y - r;
  const a = cell(c, r), b = cell(c + 1, r), d = cell(c, r + 1), e = cell(c + 1, r + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
}
export function isLand(lon, lat) { initLand(); return cell(Math.floor((lon + 180) / GEO_RES), Math.floor((90 - lat) / GEO_RES)) === 1; }

// ---- рельеф суши (ETOPO1, сетка 10'), метры над уровнем моря ----
let dem = null;
function initDem() {
  if (dem) return;
  const a = b64(DEM_DATA); dem = inflateRaw(a, DEM_W * DEM_H);
}
export function demF(lon, lat) {
  initDem();
  const x = (lon + 180) * 6, y = (90 - lat) * 6, c = Math.floor(x), r = Math.floor(y), fx = x - c, fy = y - r;
  const g = (cc, rr) => dem[Math.max(0, Math.min(DEM_H - 1, rr)) * DEM_W + (((cc % DEM_W) + DEM_W) % DEM_W)];
  const v = (g(c, r) * (1 - fx) + g(c + 1, r) * fx) * (1 - fy) + (g(c, r + 1) * (1 - fx) + g(c + 1, r + 1) * fx) * fy;
  return v * DEM_UNIT;
}

// ---- реки и города (общие списки) ----
let RIV = null, CITY = null;
function initVec() {
  if (RIV) return;
  const rd0 = a => { let p = 0; return () => { let v = 0, sh = 0, b; do { b = a[p++]; v |= (b & 127) << sh; sh += 7; } while (b & 128); return v; }; };
  const unzz = n => (n >>> 1) ^ -(n & 1);
  const ra = b64(GEO_RIVERS), rd = rd0(ra); RIV = [];
  let pos = 0; const len = ra.length;
  // rd0 хранит свой индекс; для длины используем отдельный счётчик через чтение до конца
  const rr = (() => { let p = 0; return { more: () => p < len, n: () => { let v = 0, sh = 0, b; do { b = ra[p++]; v |= (b & 127) << sh; sh += 7; } while (b & 128); return v; } }; })();
  while (rr.more()) {
    const sr = rr.n(), n = rr.n(), lon = new Float64Array(n), lat = new Float64Array(n);
    let x = unzz(rr.n()), y = unzz(rr.n()); lon[0] = x / 100; lat[0] = y / 100;
    for (let i = 1; i < n; i++) { x += unzz(rr.n()); y += unzz(rr.n()); lon[i] = x / 100; lat[i] = y / 100; }
    RIV.push({ sr, lon, lat });
  }
  const ca = b64(GEO_CITIES), cl = ca.length; CITY = [];
  const cr = (() => { let p = 0; return { more: () => p < cl, n: () => { let v = 0, sh = 0, b; do { b = ca[p++]; v |= (b & 127) << sh; sh += 7; } while (b & 128); return v; } }; })();
  while (cr.more()) { const lo = cr.n() / 100 - 180, la = cr.n() / 100 - 90, pop = cr.n() * 1000; CITY.push({ lon: lo, lat: la, pop }); }
}

// полуширина реки (м) по рангу: заметнее реальной, чтобы читалась с высоты
const RW = [1200, 1200, 1100, 800, 650, 520, 420, 340, 270, 220];
// радиус города (м) по населению
const cityR = pop => 1100 + 8200 * Math.sqrt(pop / 1e6);

// ---- контекст рейса: локальные мировые координаты <-> широта/долгота ----
// мировая система: начало — аэропорт вылета, ось X — на пункт назначения (курс brg0), Z — вправо
export function makeGeo(from, brg0deg, D) {
  initLand(); initVec();
  const la1 = from.lat * D2R, lo1 = from.lon * D2R, b0 = brg0deg * D2R, sla = Math.sin(la1), cla = Math.cos(la1);
  const g = {};
  // мировая точка -> широта/долгота (градусы)
  g.ll = (wx, wz, out) => {
    const d = Math.hypot(wx, wz) / R_EARTH, th = b0 + Math.atan2(wz, wx), sd = Math.sin(d), cd = Math.cos(d);
    const la2 = Math.asin(sla * cd + cla * sd * Math.cos(th));
    const lo2 = lo1 + Math.atan2(Math.sin(th) * sd * cla, cd - sla * Math.sin(la2));
    out.lat = la2 / D2R; out.lon = ((lo2 / D2R + 540) % 360) - 180; return out;
  };
  // широта/долгота -> мировая точка
  g.xy = (lon, lat, out) => {
    const la = lat * D2R, dl = lon * D2R - lo1;
    const sdla = Math.sin((la - la1) / 2), sdlo = Math.sin(dl / 2);
    const h = sdla * sdla + cla * Math.cos(la) * sdlo * sdlo, d = 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
    const y = Math.sin(dl) * Math.cos(la), x = cla * Math.sin(la) - sla * Math.cos(la) * Math.cos(dl);
    const th = Math.atan2(y, x) - b0;
    out.x = d * Math.cos(th); out.z = d * Math.sin(th); return out;
  };
  const tmp = { lat: 0, lon: 0 }, o2 = { x: 0, z: 0 };
  g.land = (wx, wz) => { g.ll(wx, wz, tmp); return landF(tmp.lon, tmp.lat); };
  // то же с кэшем по клеткам 400 м (рельеф опрашивается очень часто)
  const lc = new Map();
  g.landQ = (wx, wz) => {
    const i = Math.floor(wx / 400), j = Math.floor(wz / 400), k = i * 100003 + j; let v = lc.get(k);
    if (v === undefined) { v = g.land((i + 0.5) * 400, (j + 0.5) * 400); if (lc.size > 250000) lc.clear(); lc.set(k, v); }
    return v;
  };
  // высота над уровнем моря (м), кэш по клеткам 1 км
  const ec = new Map();
  g.elevQ = (wx, wz) => {
    const i = Math.floor(wx / 1000), j = Math.floor(wz / 1000), k = i * 100003 + j; let v = ec.get(k);
    if (v === undefined) { g.ll((i + 0.5) * 1000, (j + 0.5) * 1000, tmp); v = demF(tmp.lon, tmp.lat); if (ec.size > 250000) ec.clear(); ec.set(k, v); }
    return v;
  };
  // коридор интереса: вдоль трассы ±450 км
  const inCorr = (x, z) => x > -150000 && x < D + 150000 && Math.abs(z) < 450000;
  // реки -> отрезки в мировых координатах, сетка 8 км
  const CS = 8000, grid = new Map(), segs = [];
  const key = (i, j) => i * 100003 + j;
  for (const rv of RIV) {
    let any = false; const n = rv.lon.length, px = new Float64Array(n), pz = new Float64Array(n);
    for (let i = 0; i < n; i++) { g.xy(rv.lon[i], rv.lat[i], o2); px[i] = o2.x; pz[i] = o2.z; if (!any && inCorr(o2.x, o2.z)) any = true; }
    if (!any) continue;
    const hw = RW[Math.min(9, rv.sr)];
    for (let i = 0; i + 1 < n; i++) {
      const x1 = px[i], z1 = pz[i], x2 = px[i + 1], z2 = pz[i + 1];
      if (!inCorr(x1, z1) && !inCorr(x2, z2)) continue;
      const k = segs.length; segs.push(x1, z1, x2, z2, hw);
      const i0 = Math.floor((Math.min(x1, x2) - hw) / CS), i1 = Math.floor((Math.max(x1, x2) + hw) / CS), j0 = Math.floor((Math.min(z1, z2) - hw) / CS), j1 = Math.floor((Math.max(z1, z2) + hw) / CS);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue;
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const kk = key(a, b); let L = grid.get(kk); if (!L) grid.set(kk, L = []); L.push(k); }
    }
  }
  // 1 — река (по центру), 0 — вне русла
  g.river = (wx, wz) => {
    const L = grid.get(key(Math.floor(wx / CS), Math.floor(wz / CS))); if (!L) return 0;
    let best = 0;
    for (let q = 0; q < L.length; q++) {
      const s = L[q] * 5, x1 = segs[s], z1 = segs[s + 1], dx = segs[s + 2] - x1, dz = segs[s + 3] - z1, hw = segs[s + 4];
      const l2 = dx * dx + dz * dz; let t = l2 > 0 ? ((wx - x1) * dx + (wz - z1) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(wx - x1 - t * dx, wz - z1 - t * dz);
      if (d < hw) { const v = 1 - d / hw; if (v > best) best = v; }
    }
    return best;
  };
  // города: сетка 40 км
  const cities = [], CG = 40000, cgrid = new Map();
  for (const c of CITY) {
    g.xy(c.lon, c.lat, o2); if (!inCorr(o2.x, o2.z)) continue;
    const r = cityR(c.pop), k = cities.length; cities.push({ x: o2.x, z: o2.z, r, pop: c.pop });
    const i0 = Math.floor((o2.x - r) / CG), i1 = Math.floor((o2.x + r) / CG), j0 = Math.floor((o2.z - r) / CG), j1 = Math.floor((o2.z + r) / CG);
    for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const kk = key(a, b); let L = cgrid.get(kk); if (!L) cgrid.set(kk, L = []); L.push(k); }
  }
  g.cities = cities;
  // плотность застройки 0..1 (центр города — 1, к краю падает)
  g.city = (wx, wz) => {
    const L = cgrid.get(key(Math.floor(wx / CG), Math.floor(wz / CG))); if (!L) return 0;
    let best = 0;
    for (let q = 0; q < L.length; q++) { const c = cities[L[q]], d = Math.hypot(wx - c.x, wz - c.z) / c.r; if (d < 1) { const v = 1 - d * d * 0.85; if (v > best) best = v; } }
    return best;
  };
  return g;
}
