// Программный интерфейс для Godot: вся логика (sim.js, events.js, data.js) остаётся прежней,
// Godot вызывает эти функции через встроенный JS-движок и рисует результат.
import { AIRPORTS, AP_BY, PLANES, PL_BY, bearing, distKm, contractsFor, makeContract, makeWeather, tripFuel, maxRangeKm } from './data.js';
import { Flight, DEG, FLAP_NAMES } from './sim.js';
import { EVENT_DEFS, EVENT_IDS } from './events.js';
import { toWorld } from './terrain.js';

let F = null;
const _w = { x: 0, z: 0 }, _ll = { lat: 0, lon: 0 };
const r1 = v => Math.round(v * 10) / 10;

export function sim_data() {
  return {
    airports: AIRPORTS.map(a => ({ id: a.id, city: a.city, name: a.name, lat: a.lat, lon: a.lon, rwy: a.rwy, elev: a.elev })),
    planes: PLANES.map(p => ({ id: p.id, name: p.name, short: p.short, seats: p.seats, color: p.color, minRwy: p.minRwy, range: Math.round(maxRangeKm(p)) })),
    events: EVENT_IDS.map(id => ({ id, title: EVENT_DEFS[id].title, short: EVENT_DEFS[id].short, desc: EVENT_DEFS[id].desc })),
  };
}
export function sim_routes(planeId, fromId, seed) {
  return contractsFor(PL_BY[planeId], fromId, seed || 1);
}
// o: { plane, from, to, tod (0..2), wx (0..2 уровень погоды), emerg (0..3), taxi, force: [id], seed }
export function sim_start(o) {
  const p = PL_BY[o.plane], from = AP_BY[o.from], to = AP_BY[o.to];
  let s = (o.seed || 12345) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const c = makeContract(p, from, to, rnd);
  const brg = bearing(from, to);
  const wx = makeWeather(rnd, o.wx == null ? 1 : o.wx, brg, o.season || 0);
  F = new Flight({
    rnd, wx, plane: p, from, to, bearing: brg, distM: c.km * 1000, pax: c.pax, fuelKg: Math.min(p.fuelCap, c.fuel + p.burnHr * 0.25),
    tod: o.tod || 0, taxi: o.taxi !== false, emerg: o.emerg || 0, force: o.force && o.force.length ? o.force : undefined, drill: !!(o.force && o.force.length),
    assist: { auto: o.auto !== false, config: o.config !== false, hints: true, taxi: !!o.autotaxi }, km: c.km, cg: 0.25,
  });
  F.c.flaps = 2; F.flapAct = 2; F.c.brake = true; F.c.thr = 0;
  return { km: c.km, pax: c.pax, fuel: Math.round(F.fuel), brg, from: from.id, to: to.id };
}
export function sim_step(dt) {
  if (!F || F.done) return 1;
  return F.update(dt);
}
// ввод: { stick, roll, thr, t1, t2, split, brake, rev, ... } — прямая запись в органы управления
export function sim_ctl(o) {
  if (!F) return;
  const c = F.c;
  for (const k in o) c[k] = o[k];
  if (o.thr != null && !o.split) { c.t1 = c.t2 = o.thr; c.split = false; }
}
export function sim_act(a) {
  if (!F || F.done) return;
  const f = F, c = f.c;
  switch (a) {
    case 'gear': f.setGear(!c.gear); break;
    case 'fl-': f.setFlaps(c.flaps - 1); break;
    case 'fl+': f.setFlaps(c.flaps + 1); break;
    case 'brake': c.brake = !c.brake; break;
    case 'ap': if (f.apLock > 0) { f.msg('Автопилот неисправен'); break; } c.apOn = !c.apOn; if (c.apOn) { c.apAlt = Math.max(300, Math.round(f.h / 100) * 100); } else c.appr = false; break;
    case 'at': if (f.atLock > 0) { f.msg('Автомат тяги неисправен'); break; } c.atOn = !c.atOn; break;
    case 'appr': if (f.apLock > 0) { f.msg('Автопилот неисправен'); break; } if (!c.apOn && !f.onGround) { c.apOn = true; c.atOn = true; } c.appr = !c.appr; if (!c.appr) f.apprCap = false; break;
    case 'altu': c.apAlt = Math.min(f.p.ceiling - 600, c.apAlt + (c.apAlt >= 3000 ? 600 : 300)); break;
    case 'altd': c.apAlt = Math.max(300, c.apAlt - (c.apAlt > 3000 ? 600 : 300)); break;
    case 'rev': if (f.onGround && f.v > 15) { c.rev = !c.rev; if (!c.rev) { c.thr = c.t1 = c.t2 = 0; c.split = false; } } else f.msg('Реверс — только на пробеге'); break;
    case 'abrk': c.abrk = ((c.abrk || 0) + 1) % 4; f.msg('Автоторможение: ' + (c.abrk ? 'режим ' + c.abrk : 'выкл')); break;
    case 'taxi': if (f.onGround && f.taxiOps) c.taxiAuto = !c.taxiAuto; break;
    case 'start': if (f.cold) { if (f.gate.done) f.startReq = true; else f.msg('Дождитесь окончания обслуживания'); } break;
    case 'warp': { const w = [1, 2, 4, 8, 16, 32]; const i = w.indexOf(c.warp); c.warp = w[(i + 1) % w.length]; if (c.warp > f.allowedWarp()) c.warp = 1; break; }
    case 'ga': f.goAround(); break;
    case 'ext': f.extinguish(); break;
    case 'altgear': f.altGearExt(); break;
    case 'emdesc': f.emergDescent(); break;
    default: if (a.indexOf('radio:') === 0) f.radioReq(a.slice(6)); else if (a.indexOf('ev:') === 0) f.evAction(a.slice(3));
  }
}
export function sim_alts() { return F ? F.altList().slice(0, 5).map((o, i) => ({ i, label: o.label, d: Math.round(o.d), ok: !!o.ok, rel: o.rel })) : []; }
export function sim_divert(i) { if (!F) return false; const o = F.altList().slice(0, 5)[i]; return !!(o && F.divertTo(o.w)); }

function llOf(f, x, z) {
  toWorld(f.tf, x, z, _w); f.world.geo.ll(_w.x, _w.z, _ll); return [_ll.lat, _ll.lon];
}
export function sim_state() {
  const f = F; if (!f) return null;
  const c = f.c, g = f.world.geo, p = llOf(f, f.x, f.yPos);
  const rw0 = llOf(f, 0, 0), rw1 = llOf(f, f.D, 0);
  const ev = f.evView();
  return {
    t: f.time, done: f.done, res: f.result, td: f.td ? { sink: f.td.sink, onDest: !!f.td.onDest } : null,
    lat: p[0], lon: p[1], hdg: f.heading, alt: f.h + f.elev, h: f.h, x: f.x, y: f.yPos, D: f.D, dist: f.dist, brg: f.brg,
    psi: f.psi, phi: f.phi, theta: f.theta, gamma: f.gamma, v: f.v, ias: f.ias, vs: f.vs, mach: f.mach,
    gear: f.gearPos, flaps: f.flapAct, flapsCmd: c.flaps, flapName: FLAP_NAMES[c.flaps], thr: f.thrAct, eng: f.eng,
    onGround: f.onGround, air: f.airborneOnce, fuel: f.fuel, mass: f.mass, vr: f.vr, v1: f.v1, v2: f.v2,
    c: { stick: c.stick, thr: c.thr, brake: c.brake, rev: c.rev, apOn: c.apOn, atOn: c.atOn, apAlt: c.apAlt, appr: c.appr, nav: c.nav, taxiAuto: c.taxiAuto, gear: c.gear, flaps: c.flaps, warp: c.warp, abrk: c.abrk },
    warnings: [...f.warnings], alerts: [...f.alerts], msgs: f.msgs.slice(-5).map(m => m.text), hint: f.assist.hints && !f.done ? f.hint() : '',
    ev: ev ? { title: ev.title, steps: ev.steps.map(s => ({ t: s.t, done: !!s.done })) } : null, evBtns: f.evBtns().map(b => ({ k: b.k, t: b.t })),
    wx: { dir: f.wx.dir, spd: f.wx.spd, vis: f.wx.vis, rain: f.wx.rain, temp: f.wx.temp, qnh: f.wx.qnh },
    rw0: { lat: rw0[0], lon: rw0[1], len: f.fromAp.rwy, id: f.fromAp.id }, rw1: { lat: rw1[0], lon: rw1[1], len: f.toAp.rwy, id: f.toAp.id },
    tod: f.tod, cs: f.cs, plane: f.p.id, fade: f.fade, fadeText: f.fadeText,
    ground: { gx: f.fr0.gx, taxiZ: f.fr0.tz }, // схема аэродрома для отрисовки
    hold: !!f.hold, ga: f.ga,
  };
}
// положение точки локальной системы (x вдоль оси, z вправо) в широте/долготе — для отрисовки аэродромов
export function sim_ll(x, z) { return F ? llOf(F, x, z) : null; }
