// Программный интерфейс для Godot: вся логика (sim.js, events.js, data.js) остаётся прежней,
// Godot вызывает эти функции через встроенный JS-движок и рисует результат.
import { AIRPORTS, AP_BY, PLANES, PL_BY, bearing, distKm, contractsFor, makeContract, makeWeather, tripFuel, maxRangeKm, recommendedCruise, fmtRub } from './data.js';
import { Flight, DEG, FLAP_NAMES, settle, loadInfo } from './sim.js';
import { EVENT_DEFS, EVENT_IDS } from './events.js';
import { toWorld } from './terrain.js';
import { geoCities } from './geo.js';

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
  const g = F.world.geo, q = { lat: 0, lon: 0 };
  const aps = F.world.map((w, i) => {
    const start = i < 2 ? w.wx : w.wx - w.len / 2;
    g.ll(start, w.wz, q);
    return { id: w.id, lat: q.lat, lon: q.lon, len: w.len, elev: i < 2 || !w.gen ? w.ap.elev : Math.round(F.world.ref(w.wx)), gen: !!w.gen, name: w.ap.name || w.ap.city };
  });
  return { km: c.km, pax: c.pax, fuel: Math.round(F.fuel), brg, from: from.id, to: to.id, aps };
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
  toWorld(f.tf, f.x, f.yPos, _w); const ref = f.world.ref(_w.x);
  const rw0 = llOf(f, 0, 0), rw1 = llOf(f, f.D, 0);
  const ev = f.evView();
  return {
    t: f.time, done: f.done, res: f.result, td: f.td ? { sink: f.td.sink, onDest: !!f.td.onDest } : null,
    lat: p[0], lon: p[1], hdg: f.heading, alt: f.h + ref, ref: ref, h: f.h, x: f.x, y: f.yPos, D: f.D, dist: f.dist, brg: f.brg,
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
// города (lon,lat,pop) в прямоугольнике вокруг маршрута — для рендера застройки
export function sim_cities(o) { const out = []; for (const c of geoCities()) if (c.lon >= o.lo0 && c.lon <= o.lo1 && c.lat >= o.la0 && c.lat <= o.la1 && c.pop >= 40000) out.push([c.lon, c.lat, c.pop]); return out; }
export function sim_ll(x, z) { return F ? llOf(F, x, z) : null; }
// отладка: поставить самолёт в воздух (для скриншотов и тестов)
export function sim_debug(o) {
  const f = F; if (!f) return;
  f.onGround = false; f.airborneOnce = true; f.cold = false; f.eng = [1, 1];
  f.h = o.h; f.v = o.v || 150; f.x = o.x != null ? o.x : f.x; f.gearPos = o.gear ? 1 : 0; f.c.gear = !!o.gear; f.theta = o.theta || 0.03; f.c.brake = false;
  f.c.thr = 0.7; f.c.t1 = f.c.t2 = 0.7;
  for (let i = 0; i < 5; i++) f.step(1 / 30);
}

// ======================= карьера (то же, что в main.js, без DOM) =======================
const RANKS = [['Курсант', 0], ['Второй пилот', 500], ['Пилот', 1500], ['Командир', 3500], ['Капитан-инструктор', 7000], ['Легенда авиации', 15000]];
function rankOf(xp) { let i = 0; for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k][1]) i = k; const nx = RANKS[i + 1]; return { name: RANKS[i][0], i, next: nx ? nx[0] : null, from: RANKS[i][1], to: nx ? nx[1] : RANKS[i][1], pct: nx ? (xp - RANKS[i][1]) / (nx[1] - RANKS[i][1]) : 1 }; }
const save = { money: 0, owned: ['ssj'], plane: 'ssj', loc: 'SVO', flights: 0, landings: 0, bestSink: null, pax: 0, assistAuto: true, assistCfg: true, assistTaxi: true, taxiOps: false, cam: 0, hints: true, sat: true, tod: 'rnd', sound: true, emerg: 2, wxLvl: 1, season: 0, xp: 0, evOk: 0, evLate: 0, evFail: 0, wear: {}, fatigue: 0, fuelMul: 1, crews: 0, school: {}, daily: {}, top: [], stat: { maxKm: 0, streak: 0, best: 0, min: 0 }, rep: 50, lease: {}, copilot: false };
let contractCur = null, lastResult = null, applied = false;
const wearOf = id => Math.round(save.wear[id] || 0);
const fleetIds = () => [...save.owned, ...Object.keys(save.lease).filter(k => save.lease[k] > 0 && !save.owned.includes(k))];
const etaMin = km => Math.round(km / 760 * 60 + 22);
export function game_load(json) {
  try { Object.assign(save, JSON.parse(json || '{}')); } catch (e) { }
  save.stat = Object.assign({ maxKm: 0, streak: 0, best: 0, min: 0 }, save.stat || {});
  if (!AP_BY[save.loc]) save.loc = 'SVO';
  if (!PL_BY[save.plane] || !fleetIds().includes(save.plane)) save.plane = save.owned[0] || 'ssj';
  return true;
}
export function game_dump() { return save; }
export function game_hub() {
  const ap = AP_BY[save.loc], p = PL_BY[save.plane];
  return { money: save.money, moneyText: fmtRub(save.money), loc: ap.id, city: ap.city, locName: ap.name, plane: p.id, planeName: p.name, short: p.short, flights: save.flights, landings: save.landings, pax: save.pax,
    bestSink: save.bestSink, rank: rankOf(save.xp), xp: save.xp, fatigue: Math.round(save.fatigue || 0), rep: Math.round(save.rep), crews: save.crews || 0, copilot: !!save.copilot, fuelMul: save.fuelMul || 1,
    opts: { assistAuto: save.assistAuto, assistCfg: save.assistCfg, taxiOps: save.taxiOps, hints: save.hints, sat: save.sat !== false, emerg: save.emerg, wxLvl: save.wxLvl, tod: save.tod, season: save.season },
    stat: save.stat, top: (save.top || []).slice(0, 10), fleet: fleetIds().map(id => ({ id, short: PL_BY[id].short, name: PL_BY[id].name })) };
}
export function game_opt(k, v) { save[k] = v; return true; }
export function game_set_plane(id) { if (fleetIds().includes(id)) save.plane = id; return save.plane; }
export function game_rest() { if (save.money >= 40000) { save.money -= 40000; save.fatigue = 0; return true; } return false; }
export function game_contracts() {
  const ap = AP_BY[save.loc], p = PL_BY[save.plane];
  const list = contractsFor(p, ap.id, save.flights * 7919 + ap.id.charCodeAt(0) * 131 + ap.id.charCodeAt(2));
  list.forEach(c => { let h = save.flights * 31; for (const ch of c.to) h = (h * 33 + ch.charCodeAt(0)) % 997; c.dem = 0.8 + (h % 48) / 100; c.revenue = Math.round(c.revenue * c.dem); });
  return { from: ap.id, plane: p.short, range: Math.round(maxRangeKm(p) / 100) * 100, minRwy: p.minRwy, seats: p.seats,
    list: list.map(c => ({ to: c.to, city: AP_BY[c.to].city, name: AP_BY[c.to].name, km: Math.round(c.km), eta: etaMin(c.km), pax: c.pax, revenue: c.revenue, revenueText: fmtRub(c.revenue), fuel: Math.round(c.fuel) })) };
}
export function game_hangar() {
  const cur = save.plane;
  return { money: save.money, rep: Math.round(save.rep), crews: save.crews || 0, crewCost: 400000 + 250000 * (save.crews || 0), copilot: !!save.copilot,
    planes: PLANES.map(p => { const own = save.owned.includes(p.id), lz = (save.lease[p.id] || 0) > 0, w = wearOf(p.id);
      return { id: p.id, name: p.name, short: p.short, seats: p.seats, range: Math.round(maxRangeKm(p) / 100) * 100, minRwy: p.minRwy, desc: p.desc, price: p.price, lease: Math.round(p.price * 0.12), own, leased: lz, leaseLeft: save.lease[p.id] || 0, wear: w, maint: Math.round(p.value * 0.0003 * w), cur: p.id === cur }; }) };
}
export function game_buy(id) { const p = PL_BY[id]; if (p && !save.owned.includes(id) && save.money >= p.price) { save.money -= p.price; save.owned.push(id); save.plane = id; return true; } return false; }
export function game_lease(id) { const p = PL_BY[id], c = p ? Math.round(p.price * 0.12) : 0; if (p && save.money >= c) { save.money -= c; save.lease[id] = 5; save.plane = id; return true; } return false; }
export function game_maint(id) { const p = PL_BY[id], c = p ? Math.round(p.value * 0.0003 * wearOf(id)) : 0; if (p && save.money >= c) { save.money -= c; save.wear[id] = 0; return true; } return false; }
export function game_crew() { const c = 400000 + 250000 * (save.crews || 0); if ((save.crews || 0) < 5 && save.money >= c) { save.money -= c; save.crews = (save.crews || 0) + 1; return true; } return false; }
export function game_copilot() { save.copilot = !save.copilot; return save.copilot; }
// запуск рейса по контракту (drill — id аварии для тренажёра)
const LESSONS = [
  { id: 'l1', title: '1. Первый рейс с автопилотом', desc: 'Взлёт, набор, автозаход и посадка с помощником. Цель — просто долететь и сесть.', wx: 0, auto: true, config: true, pass: r => r.kind === 'ok' },
  { id: 'l2', title: '2. Ручная посадка', desc: 'Автопилот выключен. Держите глиссаду и выровняйте у земли: касание не жёстче 1,6 м/с.', wx: 0, auto: false, config: true, pass: r => r.kind === 'ok' && r.sink <= 1.6 },
  { id: 'l3', title: '3. Боковой ветер', desc: 'Сложная погода, ручное пилотирование. Сядьте, не жёстче 2,4 м/с.', wx: 2, auto: false, config: true, pass: r => r.kind === 'ok' && r.sink <= 2.4 },
  { id: 'l4', title: '4. Отказ двигателя', desc: 'Откажет двигатель. Выполните действия по чек-листу и сядьте.', wx: 0, auto: true, config: true, force: 'engFail', pass: r => r.kind === 'ok' && r.evOk >= 1 },
  { id: 'l5', title: '5. Заход в тумане', desc: 'Низкая видимость: заход строго по глиссаде и курсу (кнопка ПОСАДКА).', wx: 0, auto: true, config: true, force: 'fog', pass: r => r.kind === 'ok' },
  { id: 'l6', title: '6. Экзамен', desc: 'Сложная погода, без автоматики механизации и без автопилота. Нужны 4★ и выше.', wx: 2, auto: false, config: false, pass: r => r.kind === 'ok' && r.stars >= 4 },
];
let lessonCur = null, dailyKey = null;
export function game_lessons() { return LESSONS.map(l => ({ id: l.id, title: l.title, desc: l.desc, done: !!save.school[l.id] })); }
export function game_daily_info() { const k = dailyInfo(); return { key: k.key, best: save.daily[k.key] == null ? null : save.daily[k.key], days: Object.keys(save.daily).sort().reverse().slice(0, 7).map(d => [d, save.daily[d]]) }; }
function dailyInfo() {
  const d = new Date(), key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  let h = 2166136261; for (const ch of key + save.plane) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return { key, h };
}
function mkRnd(h) { let a = h; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function game_begin(to, drill, kind, id) {
  const from = AP_BY[save.loc], p = PL_BY[save.plane];
  let c, wx, o = {}; lessonCur = null; dailyKey = null;
  const brgTo = c2 => bearing(from, AP_BY[c2.to]);
  if (kind === 'lesson') {
    lessonCur = LESSONS.find(l => l.id === id); drill = lessonCur.force || 'none';
    const list = contractsFor(p, from.id, 777 + from.id.charCodeAt(0)); c = list.find(x => x.km >= 300) || list[list.length - 1]; if (!c) return null;
    wx = makeWeather(Math.random, lessonCur.wx, brgTo(c), 1);
  } else if (kind === 'daily') {
    const di = dailyInfo(), rnd = mkRnd(di.h), list = contractsFor(p, from.id, di.h % 100000); if (!list.length) return null;
    c = list[di.h % list.length]; wx = makeWeather(rnd, 2, brgTo(c), 1 + (di.h % 2));
    dailyKey = di.key; o = { tod: di.h % 3, rnd, fuel: Math.min(p.fuelCap, Math.round(c.fuel + p.burnHr * 0.5)) };
  } else if (drill) {
    const list = contractsFor(p, from.id, 777 + from.id.charCodeAt(0)); c = list.find(x => x.km >= 500) || list[list.length - 1]; if (!c) return null;
    wx = makeWeather(Math.random, 0, brgTo(c), save.season);
  } else {
    c = game_contracts_raw().find(x => x.to === to); if (!c) return null;
    wx = makeWeather(Math.random, save.wxLvl, brgTo(c), save.season);
  }
  const to2 = AP_BY[c.to], brg = bearing(from, to2);
  const tod = o.tod != null ? o.tod : save.tod === 'rnd' ? [0, 0, 0, 1, 2][Math.floor(Math.random() * 5)] : +save.tod;
  const emerg = drill ? 0 : (save.emerg && (wearOf(p.id) >= 60 || (save.fatigue || 0) >= 60) ? Math.min(3, save.emerg + 1) : save.emerg);
  contractCur = c; lastResult = null; applied = false;
  F = new Flight({ rnd: o.rnd || Math.random, wx, plane: p, from, to: to2, bearing: brg, distM: c.km * 1000, pax: c.pax, fuelKg: o.fuel != null ? o.fuel : Math.min(p.fuelCap, c.fuel + ((save.emerg || drill) ? p.burnHr * 0.25 : 0)),
    driftK: 0.5, trackHold: true, cold: false, flex: false, cg: 0.25, emerg, taxi: drill ? false : !!save.taxiOps, drill: !!drill, force: drill ? [drill] : undefined,
    copilot: save.copilot, fatigue: save.fatigue || 0, assist: { auto: drill ? true : save.assistAuto, config: drill ? true : save.assistCfg, hints: save.hints, taxi: save.assistTaxi }, tod, recAlt: recommendedCruise(c.km) });
  if (lessonCur) { F.assist.auto = lessonCur.auto; F.assist.config = lessonCur.config; }
  F.daily = dailyKey;
  F.flaps0 = 2; F.c.flaps = 2; F.flapAct = 2; F.c.brake = true; F.c.thr = 0;
  const g = F.world.geo, q = { lat: 0, lon: 0 };
  const aps = F.world.map((w, i) => { const start = i < 2 ? w.wx : w.wx - w.len / 2; g.ll(start, w.wz, q);
    return { id: w.id, lat: q.lat, lon: q.lon, len: w.len, elev: i < 2 || !w.gen ? w.ap.elev : Math.round(F.world.ref(w.wx)), gen: !!w.gen, name: w.ap.name || w.ap.city }; });
  return { km: c.km, pax: c.pax, fuel: Math.round(F.fuel), brg, from: from.id, to: to2.id, aps, tod };
}
function game_contracts_raw() {
  const ap = AP_BY[save.loc], p = PL_BY[save.plane];
  const list = contractsFor(p, ap.id, save.flights * 7919 + ap.id.charCodeAt(0) * 131 + ap.id.charCodeAt(2));
  list.forEach(c => { let h = save.flights * 31; for (const ch of c.to) h = (h * 33 + ch.charCodeAt(0)) % 997; c.dem = 0.8 + (h % 48) / 100; c.revenue = Math.round(c.revenue * c.dem); });
  return list;
}
// подведение итогов рейса: применяет деньги, опыт, износ; возвращает отчёт (повторный вызов вернёт тот же)
export function game_finish() {
  const f = F; if (!f) return null;
  if (applied && lastResult) return lastResult;
  const r = settle(f, contractCur, { rep: save.rep, copilot: save.copilot, fuelMul: save.fuelMul || 1, crews: save.crews || 0 });
  const drill = !!f.drill, rkBefore = rankOf(save.xp).i;
  if (!drill) {
    save.money = Math.max(0, save.money + r.net);
    if (r.kind !== 'abort') save.flights++;
    if (r.kind === 'ok' || r.kind === 'overrun') save.loc = f.locAfter;
    { const st = save.stat; st.maxKm = Math.max(st.maxKm, r.km); st.min += f.simTime / 60; if (r.kind === 'ok' && r.stars >= 4) { st.streak++; st.best = Math.max(st.best, st.streak); } else if (r.kind !== 'abort') st.streak = 0;
      if (r.kind === 'ok') { save.top.push({ sink: r.sink, ap: f.toAp.id, pl: f.p.short }); save.top.sort((a, b) => a.sink - b.sink); save.top = save.top.slice(0, 10); } }
    if (r.kind === 'ok') { save.landings++; save.pax += r.pax; if (save.bestSink == null || r.sink < save.bestSink) save.bestSink = r.sink; }
    if (r.kind !== 'abort') {
      const id = f.p.id;
      save.wear[id] = Math.min(100, (save.wear[id] || 0) + (r.km / 60) * (f.flex ? 0.75 : 1) + (r.sink > 2.4 ? 8 : 0) + r.evFail * 5 + (r.kind === 'crash' ? 30 : 0));
      const dr = r.kind === 'ok' ? (r.stars - 3) * 2 + (r.sched > 0 ? 1 : r.sched < 0 ? -2 : 0) : r.kind === 'crash' ? -15 : r.kind === 'overrun' ? -6 : -4;
      save.fatigue = Math.min(100, (save.fatigue || 0) + 3 + (f.simTime / 60) * 0.3 * (save.copilot ? 0.6 : 1)); save.fuelMul = Math.max(0.8, Math.min(1.5, (save.fuelMul || 1) + (Math.random() - 0.5) * 0.25));
      r.repD = dr; save.rep = Math.max(0, Math.min(100, save.rep + dr));
      if (save.lease[id] > 0 && !save.owned.includes(id)) { save.lease[id]--; if (!save.lease[id]) { delete save.lease[id]; if (save.plane === id) save.plane = save.owned[0]; } }
    }
    save.xp += r.xp; save.evOk += r.evOk; save.evLate += r.evLate; save.evFail += r.evFail;
  }
  let extra = '';
  if (lessonCur) { const ok = lessonCur.pass(r), first = ok && !save.school[lessonCur.id]; if (first) { save.school[lessonCur.id] = true; save.xp += 60; } extra = ok ? 'Урок пройден' + (first ? ' (+60 XP)' : '') : 'Урок не пройден — попробуйте ещё раз'; }
  if (f.daily && r.kind === 'ok') { if (save.daily[f.daily] == null || r.sink < save.daily[f.daily]) save.daily[f.daily] = r.sink; extra = 'Испытание дня: лучшая посадка ' + save.daily[f.daily].toFixed(2) + ' м/с'; }
  const rk = rankOf(save.xp);
  const title = drill ? 'Тренировка окончена' : { ok: r.quality, crash: 'Катастрофа', overrun: 'Выкатились за полосу', forced: 'Рейс сорван', missed: 'Аэропорт пролетели', abort: 'Взлёт прерван' }[r.kind] || r.kind;
  lastResult = { title, drill, kind: r.kind, reason: r.reason, stars: r.stars || 0, sink: r.sink == null ? null : r.sink, revenue: r.revenue, fuelCost: r.fuelCost, ops: r.ops, fee: r.fee, repair: r.repair, net: r.net, netText: fmtRub(r.net),
    xp: r.xp, km: Math.round(r.km), pax: r.pax, fuelUsed: Math.round(r.fuelUsed), paxStars: r.paxStars || 0, evLog: (r.evLog || []).map(e => ({ title: e.title, outcome: e.outcome })), crewInc: r.crewInc || 0, bonus: r.bonus || 0, pen: r.pen || 0,
    rankUp: rk.i > rkBefore ? rk.name : '', extra, money: save.money, moneyText: fmtRub(save.money) };
  applied = true;
  return lastResult;
}
export function game_drills() { return EVENT_IDS.map(id => ({ id, short: EVENT_DEFS[id].short, desc: EVENT_DEFS[id].desc })); }
export function game_dump_json() { return JSON.stringify(save); }
