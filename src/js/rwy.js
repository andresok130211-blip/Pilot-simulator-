// Настоящая ориентация полос: выбор конца по ветру, пороги в широте/долготе.
import { RWY } from './rwydata.js';
import { bearing, distKm } from './data.js';
const D2R = Math.PI / 180;
export function rwyEnd(ap, wdir, centerOnly) {
  const r = RWY[ap.id]; if (!r) return null;
  let h = r[2];
  if (wdir != null && Math.cos((wdir - (h + 180)) * D2R) > Math.cos((wdir - h) * D2R)) h = (h + 180) % 360;
  const half = ap.rwy / 2;
  return { clat: r[0], clon: r[1], hd: h, lat: r[0] - half * Math.cos(h * D2R) / 110574, lon: r[1] - half * Math.sin(h * D2R) / (111320 * Math.cos(r[0] * D2R)) };
}
// { from, to, bearing, distM, hd0, hd1 } для рейса с настоящими полосами; null — если данных нет
export function realFlight(from, to, wdir) {
  const e0 = rwyEnd(from, wdir), e1 = rwyEnd(to, wdir);
  if (!e0 || !e1) return null;
  const f2 = Object.assign({}, from, { lat: e0.lat, lon: e0.lon }), t2 = Object.assign({}, to, { lat: e1.lat, lon: e1.lon });
  return { from: f2, to: t2, bearing: bearing(f2, t2), distM: distKm(f2, t2) * 1000, hd0: e0.hd, hd1: e1.hd };
}
