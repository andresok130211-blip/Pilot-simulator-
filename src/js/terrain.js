// Ландшафт: процедурная высота местности, запасные аэродромы вдоль маршрута.
// Мировая плоскость (метры): точка вылета — начало координат, ось X — вдоль маршрута, Z — вправо.
// Система координат самолёта (локальная) связана с мировой поворотом/сдвигом f.tf (меняется при уходе на запасной).
import { AIRPORTS, distKm, bearing } from './data.js';
import { makeGeo } from './geo.js';

const smooth = t => t * t * (3 - 2 * t);
export const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hs(i, j, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, z, s) {
  const i = Math.floor(x), j = Math.floor(z), fx = smooth(x - i), fz = smooth(z - j);
  const a = hs(i, j, s), b = hs(i + 1, j, s), c = hs(i, j + 1, s), d = hs(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function fbm(x, z, oct, s) {
  let v = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { v += a * vnoise(x, z, s + o * 17); n += a; x = x * 2.03 + 11.7; z = z * 2.03 - 5.3; a *= 0.5; }
  return v / n;
}
export const worldHash = hs;

// ---- аэродромы мира (в мировой системе координат) ----
export function buildWorld(from, to, D, plane) {
  const brg0 = bearing(from, to) * Math.PI / 180;
  const list = [];
  try { list.geo = makeGeo(from, bearing(from, to), D); } catch (e) { list.geo = null; }
  list.ref = wx => from.elev + (to.elev - from.elev) * Math.max(0, Math.min(1, wx / D)); // «нулевой» уровень по маршруту (м над морем)
  const push = (id, ap, wx, wz, len, gen) => list.push({ id, ap, wx, wz, len, gen: !!gen });
  push(from.id, from, 0, 0, from.rwy, false);
  push(to.id, to, D, 0, to.rwy, false);
  // реальные аэродромы рядом с маршрутом
  for (const a of AIRPORTS) {
    if (a.id === from.id || a.id === to.id) continue;
    const d = distKm(from, a) * 1000, ang = bearing(from, a) * Math.PI / 180 - brg0;
    const wx = d * Math.cos(ang), wz = d * Math.sin(ang);
    const t = Math.max(0, Math.min(D, wx));
    if (Math.hypot(wx - t, wz) > 260000) continue;
    push(a.id, a, wx, wz, a.rwy, false);
  }
  // запасные аэродромы вдоль трассы
  const minLen = Math.max(2400, (plane ? plane.minRwy : 2000) + 300);
  let seed = 0; for (const ch of from.id + to.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const alts = [];
  const gen = (t, side, k) => {
    const lat = (14000 + hs(k, 1, seed) * 26000) * side;
    alts.push({ x: t, z: lat, len: Math.round((minLen + hs(k, 2, seed) * 900) / 50) * 50 });
  };
  const near = Math.min(55000, D * 0.2);
  gen(near, hs(1, 1, seed) < 0.5 ? 1 : -1, 1);
  gen(D - near, hs(2, 1, seed) < 0.5 ? 1 : -1, 2);
  const n = Math.floor((D - 2 * near) / 130000);
  for (let k = 0; k < n; k++) gen(near + (k + 0.5) * (D - 2 * near) / n, (k % 2 ? 1 : -1) * (hs(k, 3, seed) < 0.5 ? 1 : -1), 3 + k);
  // запасные — только на суше
  if (list.geo) for (const a of alts) { for (const m of [1, -1, 0.5, -0.5, 0.25, -0.25]) { if (list.geo.landQ(a.x, a.z * m) > 0.95 && list.geo.landQ(a.x, a.z * m * 1.4) > 0.9) { a.z *= m; a.ok = true; break; } } }
  const altsOk = list.geo ? alts.filter(a => a.ok) : alts;
  altsOk.forEach((a, i) => {
    const code = 'Z' + (i + 1);
    push(code, { id: code, city: 'Запасной аэродром ' + (i + 1), name: 'Запасной аэродром ' + (i + 1), rwy: a.len, elev: 0, gen: true }, a.x, a.z, a.len, true);
  });
  return list;
}

// ---- высота рельефа в мировой точке ----
export function heightW(world, wx, wz) {
  let dMin = 1e9;
  for (let i = 0; i < world.length; i++) {
    const a = world[i], d = Math.hypot(wx - a.wx, wz - a.wz);
    if (d < dMin) dMin = d;
  }
  const geo = world.geo;
  if (geo && dMin > 4500 && geo.landQ(wx, wz) < 0.5) return -400; // море
  const flat = sstep(8000, 26000, dMin), mt = sstep(30000, 85000, dMin);
  if (flat <= 0) return 0;
  if (geo && dMin > 4500 && geo.river(wx, wz) > 0.3) return -400; // реки
  if (geo) {
    // реальный рельеф (ETOPO1) + мелкие холмы и хребты; аэродромы стоят в долинах/на равнинах — к ним рельеф плавно сходит на нет
    const msl = geo.elevQ(wx, wz), base = msl - world.ref(wx);
    const n1 = fbm(wx / 26000, wz / 26000, 4, 5);
    const ridge = 1 - Math.abs(2 * fbm(wx / 9000, wz / 9000, 4, 77) - 1);
    const amp = Math.max(0, Math.min(700, 0.1 * msl - 40));
    let T = base + (n1 - 0.45) * Math.min(260, 40 + 0.06 * msl) + (ridge * ridge - 0.35) * amp;
    if (dMin > 6000) T = Math.max(T, 0.9); // суша ниже «нулевой» плоскости маршрута — всё равно суша, а не вода
    T = Math.min(T, 0.045 * Math.max(0, dMin - 6000));
    return Math.max(0, T) * flat;
  }
  const n1 = fbm(wx / 26000, wz / 26000, 4, 5);
  if (!geo && flat > 0.7 && mt < 0.3 && Math.abs(fbm(wx / 24000, wz / 24000, 3, 200) - 0.5) < 0.0085) return -400; // реки
  const hill = (n1 - 0.38) * 520;
  let r = 0;
  if (mt > 0) {
    const m = sstep(0.42, 0.68, fbm(wx / 100000, wz / 100000, 2, 41));
    if (m > 0) { const q = 1 - Math.abs(2 * fbm(wx / 14000, wz / 14000, 4, 77) - 1); r = m * (q * q * 1250 + 120 * (n1 - 0.4)); }
  }
  const T = flat * hill + mt * r;
  return T;
}
// локальные координаты -> мировые
export function toWorld(tf, x, z, out) {
  out.x = tf.ox + x * tf.c - z * tf.s; out.z = tf.oz + x * tf.s + z * tf.c; return out;
}
export function toLocal(tf, wx, wz, out) {
  const dx = wx - tf.ox, dz = wz - tf.oz;
  out.x = dx * tf.c + dz * tf.s; out.z = -dx * tf.s + dz * tf.c; return out;
}
const _w = { x: 0, z: 0 };
export function terrainAt(f, x, z) { toWorld(f.tf, x, z, _w); return Math.max(0, heightW(f.world, _w.x, _w.z)); }
// «сырая» высота (может быть отрицательной — озёра)
export function rawAt(f, x, z) { toWorld(f.tf, x, z, _w); return heightW(f.world, _w.x, _w.z); }
// влажность/растительность в мировой точке: 0..1
export function wetAt(wx, wz) { return fbm(wx / 9000, wz / 9000, 3, 23); }
