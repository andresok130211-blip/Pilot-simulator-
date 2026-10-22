// Физика полёта: продольная модель материальной точки с аэродинамикой, тягой, топливом.
// Вся логика без графики — её можно гонять в node (см. tools/bot.mjs).
import { PAX_KG, FUEL_PRICE } from './data.js';
import { EVENT_DEFS, planEvents, evWhen } from './events.js';
import { buildWorld, terrainAt, toWorld, toLocal } from './terrain.js';

export const DEG = Math.PI / 180;
export const G = 9.80665;
export const FLAP_DCL = [0, 0.2, 0.45, 0.7, 0.95];
export const FLAP_CD = [0, 0.008, 0.02, 0.035, 0.055];
export const FLAP_AS = [15, 15.5, 16, 16.5, 17].map(d => d * DEG);
export const FLAP_NAMES = ['0', '1', '2', '3', 'ПОЛН'];
const CL0 = 0.15, CLA = 5.0;
export const GS_DEG = 3;
export const GS_TAN = Math.tan(GS_DEG * DEG);
export const APPR_ALT = 1500; // высота выхода на глиссаду, м
export const AIM_OFFSET = 300; // точка касания за торцом, м
const IDLE = 0.06;
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const FLARE_H = 14;

// Схема аэродрома в системе «ось X вдоль полосы, Z вправо от оси»: рулёжная дорожка z=106,
// три съезда, перрон и стоянка (гейт) перед терминалом.
export const TAXI_Z = 106, GATE_Z = 205;
export const frameOf = (x0, len) => ({ x0, len, gx: x0 + len * 0.45, gz: GATE_Z, tz: TAXI_Z, conn: [0.06, 0.5, 0.93].map(f => x0 + len * f + 12) });
const seg = (ax, az, bx, bz) => { const d = Math.hypot(bx - ax, bz - az) || 1; return [(bx - ax) / d, (bz - az) / d, d]; };
// ломаная -> путевые точки со срезанными углами
function chamfer(poly, R) {
  const out = [];
  for (let k = 1; k < poly.length; k++) {
    const P = poly[k], A = poly[k - 1];
    if (k < poly.length - 1) {
      const [ux, uz, d1] = seg(A.x, A.z, P.x, P.z), N = poly[k + 1], [wx, wz, d2] = seg(P.x, P.z, N.x, N.z);
      const r1 = Math.min(R, d1 * 0.45), r2 = Math.min(R, d2 * 0.45);
      if (Math.abs(ux * wz - uz * wx) < 0.15) out.push({ x: P.x, z: P.z, v: 11, key: k });
      else out.push({ x: P.x - ux * r1, z: P.z - uz * r1, v: 4, key: k }, { x: P.x + wx * r2, z: P.z + wz * r2, v: 4, key: k });
    } else out.push({ x: P.x, z: P.z, v: 0, key: k });
  }
  return out;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerpTab = (tab, f) => {
  const i = Math.min(tab.length - 2, Math.max(0, Math.floor(f)));
  return tab[i] + (tab[i + 1] - tab[i]) * (f - i);
};

export function atmos(h, dT = 0) {
  let T, rho;
  if (h < 11000) { T = 288.15 - 0.0065 * h; rho = 1.225 * Math.pow(T / 288.15, 4.2559); }
  else { T = 216.65; rho = 0.3639 * Math.exp(-(h - 11000) / 6341.6); }
  if (dT) { rho *= T / (T + dT); T += dT; }
  return { T, rho, a: Math.sqrt(1.4 * 287.05 * T), sigma: rho / 1.225 };
}
export const clmaxCfg = f => CL0 + FLAP_DCL[f] + CLA * FLAP_AS[f];
export const stallIAS = (m, f, S) => Math.sqrt(2 * m * G / (1.225 * S * clmaxCfg(f)));
export const glideH = (distToTouch) => Math.max(0, distToTouch) * GS_TAN;

const c0apOn = f => f.c.apOn;

export class Flight {
  constructor(o) {
    this.p = o.plane;
    this.fromAp = o.from; this.toAp = o.to;
    this.distM = o.distM;
    this.D = o.distM; // порог ВПП назначения
    this.rwy0 = { s: 0, e: o.from.rwy };
    this.rwy1 = { s: this.D, e: this.D + o.to.rwy };
    this.elev = o.from.elev; this.elevA = o.from.elev;
    this.pax = o.pax;
    this.payload = o.pax * PAX_KG;
    this.fuel = o.fuelKg; this.fuel0 = o.fuelKg; this.tk = [o.fuelKg / 2, o.fuelKg / 2]; this.xfeed = false; this.leak = 0; this.leakSide = 0;
    this.K = 1 / (Math.PI * this.p.e * this.p.ar);
    this.assist = Object.assign({ auto: true, config: true, hints: true }, o.assist || {});
    this.tod = o.tod || 0; // 0 день, 1 сумерки, 2 ночь
    this.recAlt = o.recAlt || 9600;

    this.yPos = 0; this.psi = 0; this.phi = 0; this.brg = o.bearing || 0; // боковое смещение, курс и крен относительно оси ВПП
    this.taxiOps = o.taxi !== false; // полный цикл: гейт → рулёжка → ВПП → ... → гейт
    this.fr0 = frameOf(0, o.from.rwy); this.fr1 = frameOf(this.D, o.to.rwy);
    this.x = 40; this.h = 0; this.v = 0; this.gamma = 0; this.theta = 0;
    if (this.taxiOps) { this.x = this.fr0.gx; this.yPos = GATE_Z; this.psi = -Math.PI / 2; } // стоим на гейте носом к рулёжке
    this.thrAct = 0; this.thrA = [0, 0]; this.Ti = [0, 0]; this.gearPos = 1; this.flapAct = 2;
    this.onGround = true; this.airborneOnce = false;
    this.time = 0; this.simTime = 0; this.acc = 0;
    this.c = { stick: 0, thr: 0, gear: true, flaps: 2, brake: true, rev: false, abrk: 0, split: false, t1: 0, t2: 0, apOn: false, apAlt: 1500, appr: false, atOn: false, warp: 1, roll: 0, nav: true };
    this.apprCap = false; this.vsCmdS = 0; this.gHold = null;
    this.td = null; this.done = false; this.result = null;
    this.warnings = new Set(); this.incidents = []; this.msgs = []; this.track = []; this.marks = []; this._rec = -9; this.radio = []; this.atcDone = {}; this.trf = []; this.hold = null; this.trfId = 0; this.clrTo = true; this.trfPlan = {};
    { const r = o.rnd || Math.random; this.starOff = (r() < 0.5 ? -1 : 1) * (5000 + r() * 7000); const lv = (o.wx && o.wx.level) || 0;
      this.holdPlan = !o.force && !o.drill && r() < 0.12 + 0.1 * lv; this.aheadPlan = !o.force && !o.drill && r() < 0.4; this.holdTo = !o.force && !o.drill && o.taxi !== false && r() < 0.3; this.cruiseTrf = !o.force && !o.drill && r() < 0.6; }
    this.copilot = !!o.copilot; this.cs = (o.callsign || ('RA' + (100 + Math.floor((o.km || 500) * 7) % 900)));
    this.stats = { maxG: 1, stallT: 0, overT: 0, gpws: 0, tail: false };
    this.autoDescDone = false; this.autoEngaged = false;
    this.cfgTimer = 0; this.flapMsgT = 0; this.maxV = 0;
    this.lined = false; this.parked = false; this.guide = null; this.route = null; this.ri = 0; this.routePoly = null; this.autoSteer = 0; this.autoV = 0; this._inEngaged = false; this._routeT = 0; this.inXc = undefined;
    this._cooldown = {};
    // аварийные ситуации
    this.dISA = o.wx && o.wx.level ? Math.max(-25, Math.min(25, o.wx.temp - (15 - 0.0065 * o.from.elev))) : 0; this.m0 = 0; this.scN = 0;
    this.cold = !!o.cold; this.startReq = false; this.startT = 0; this.apu = false; this.flex = !!o.flex; this.cg = o.cg || 0.25;
    this.eng = o.cold ? [0, 0] : [1, 1]; this.fire = null; this.hyd = false; this.altGear = false; this.apLock = 0; this.atLock = 0;
    this.emDescent = false; this.rwyBlocked = false; this.ga = false; this.gaCount = 0; this.fade = 0; this.fadeText = ''; this.diverted = false;
    this.fx = { ice: 0, turb: 0, rollBias: 0, adc: false, iasErr: 0, altErr: 0, gps: false, fog: 0, smoke: 0, ws: 0, slick: 0, tire: 0, gearStuck: false, noRetract: false, flapJam: false, belts: false, anti: false, traffic: null, flash: 0, elec: false };
    this.ev = null; this.evLog = []; this.alerts = new Set(); this.drill = !!o.drill;
    this.rnd = o.rnd || Math.random;
    this.wx = o.wx || { dir: o.bearing || 0, spd: 0, gust: 0, vis: 10000, visD: 10000, rain: 0, rainD: 0, temp: 14, qnh: 1013 };
    this.wl = { x: 0, z: 0 }; this.gustF = 0; this.wxNow = { vis: 10000, rain: 0 };
    this.origTo = o.to; this.divTo = null; this.tfA = 0;
    this.tf = { a: 0, c: 1, s: 0, ox: 0, oz: 0 };
    this.world = buildWorld(o.from, o.to, o.distM, o.plane);
    this._tw = 0;
    this.updateMass();
    this.computeSpeeds();
    this.aero(); // начальные величины
    this.evq = planEvents(this, o.emerg ?? 0, o.force, this.rnd, !!o.force);
    if (this.taxiOps) {
      this.c.taxiAuto = !!this.assist.taxi;
      this.setRoute(this.buildOutRoute());
      this.msg('Буксир отцепился. Отпустите тормоз и рулите на полосу');
    }
  }

  // ---------- руление ----------
  setRoute(poly) { this.routePoly = poly; this.route = chamfer(poly, 16); this.ri = 0; }
  buildOutRoute() {
    const f = this.fr0, cx = f.conn[0];
    return [{ x: this.x, z: this.yPos }, { x: f.gx, z: f.tz, label: 'Рулёжная дорожка' }, { x: cx, z: f.tz, label: 'Поворот к полосе' }, { x: cx, z: 0, label: 'Выезд на ВПП' }, { x: cx + 110, z: 0, label: 'Взлётная позиция' }];
  }
  buildInRoute() {
    const f = this.fr1, dir = Math.cos(this.psi) >= 0 ? 1 : -1, need = this.v > 10 ? 130 : 40;
    const cs = f.conn.slice(); if (dir < 0) cs.reverse();
    let Xc = this.inXc;
    if (Xc === undefined || (Xc - this.x) * dir < 15) {
      Xc = cs.find(c => (c - this.x) * dir > need);
      if (Xc === undefined) Xc = cs[cs.length - 1];
      this.inXc = Xc;
    }
    return [{ x: this.x, z: this.yPos }, { x: Xc, z: 0, label: 'Съезд с полосы' }, { x: Xc, z: f.tz, label: 'Рулёжная дорожка' }, { x: f.gx, z: f.tz, label: 'Поворот к гейту' }, { x: f.gx, z: f.gz, label: 'ГЕЙТ' }];
  }
  onPaved(x = this.x, y = this.yPos) {
    for (const f of [this.fr0, this.fr1]) {
      const ax = x - f.x0;
      if (ax >= -60 && ax <= f.len + 60 && Math.abs(y) <= 40) return true;
      if (ax >= -40 && ax <= f.len + 40 && y >= 90 && y <= 122) return true;
      if (y >= 30 && y <= 100) for (const c of f.conn) if (Math.abs(x - c) <= 22) return true;
      if (ax >= f.len * 0.28 && ax <= f.len * 0.62 && y >= 116 && y <= 235) return true;
    }
    return false;
  }
  groundNav(dt) {
    const c = this.c;
    if (!this.td && !this.airborneOnce) {
      this.lined = this.onRunway(this.x, this.yPos) && Math.abs(wrapPi(this.psi)) < 12 * DEG && Math.abs(this.yPos) < 20 && this.x > 20;
      if (this.lined && c.taxiAuto) { c.taxiAuto = false; c.brake = true; c.thr = c.t1 = c.t2 = 0; c.split = false; this.msg('Вы на полосе. Отпустите тормоз и дайте полный газ'); }
    } else if (this.td && this.td.onDest) {
      if (!this._inInit) { this._inInit = true; this.ri = 0; this._routeT = 0; }
      if (this.v < 24 && this.assist.taxi && !this._inEngaged) { this._inEngaged = true; c.taxiAuto = true; }
      // пока на полосе — подбираем ближайший съезд
      this._routeT -= dt;
      if (this._routeT <= 0 && this.ri === 0 && this.onRunway(this.x, this.yPos) && this.v < 30) { this._routeT = 0.5; const ri = this.ri, old = this.inXc; this.setRoute(this.buildInRoute()); if (old === this.inXc) this.ri = ri; }
      if (!this.parked && Math.abs(this.x - this.fr1.gx) < 12 && Math.abs(this.yPos - GATE_Z) < 12 && this.v < 0.4 && Math.abs(wrapPi(this.psi - Math.PI / 2)) < 0.45) {
        this.parked = true; this.msg('Самолёт на гейте'); this.finish('ok', ''); return;
      }
    }
    const R = this.route; if (!R) { this.guide = null; return; }
    const last = R.length - 1;
    while (this.ri < last && Math.hypot(R[this.ri].x - this.x, R[this.ri].z - this.yPos) < 14) this.ri++;
    const w = R[this.ri], dist = Math.hypot(w.x - this.x, w.z - this.yPos);
    const kp = this.routePoly[w.key];
    this.guide = { x: kp.x, z: kp.z, label: kp.label || '', dist: Math.hypot(kp.x - this.x, kp.z - this.yPos) };
    if (!c.taxiAuto || (this.td && !this.td.onDest)) return;
    const e = wrapPi(Math.atan2(w.z - this.yPos, w.x - this.x) - this.psi);
    this.autoSteer = clamp(e * 2.2, -1, 1);
    let vt = 11, d = dist;
    for (let j = this.ri; j <= last; j++) {
      if (j > this.ri) d += Math.hypot(R[j].x - R[j - 1].x, R[j].z - R[j - 1].z);
      vt = Math.min(vt, Math.sqrt(R[j].v * R[j].v + 2 * 1.1 * Math.max(0, d - (j === last ? 1.5 : 0))));
    }
    if (Math.abs(e) > 0.9) vt = Math.min(vt, 3);
    if (!this.onPaved()) vt = Math.min(vt, 6);
    if (!this.clrTo && !this.airborneOnce && Math.abs(this.yPos) <= 70 && Math.abs(this.yPos) > 28 && Math.abs(w.z) < Math.abs(this.yPos)) vt = 0;
    this.autoV = vt;
    c.thr = c.t1 = c.t2 = 0; c.split = false;
    c.brake = this.v > vt + 1.5 || (this.ri === last && dist < 3);
  }

  updateMass() { this.mass = this.p.oew + this.payload + this.fuel; }
  computeSpeeds() {
    const vs = stallIAS(this.mass, 2, this.p.S);
    const k = 1 + (0.25 - (this.cg || 0.25)) * 0.5;
    this.vr = vs * 1.15 * k; this.v1 = vs * 1.1 * k; this.v2 = vs * 1.22 * k;
  }
  atc(key, text) {
    if (this.atcDone[key]) return; this.atcDone[key] = 1;
    this.msgs.push({ t: this.time, text: '📻 ' + text }); if (this.msgs.length > 6) this.msgs.shift();
    this.radio.push(text); if (this.radio.length > 4) this.radio.shift();
  }
  startTick(dt) {
    if (!this.startReq) return;
    this.startT += dt; const t = this.startT;
    if (t > 0.1 && !this.apu) { this.apu = true; this.msg('ВСУ запущена'); }
    if (t > 5 && t <= 17) this.eng[1] = Math.min(1, (t - 5) / 12);
    if (t > 17 && t <= 29) { this.eng[1] = 1; this.eng[0] = Math.min(1, (t - 17) / 12); }
    if (t > 29) { this.eng[0] = this.eng[1] = 1; this.cold = false; this.msg('Оба двигателя запущены'); this.atc('rs', this.cs + ', запуск завершён, руление разрешено.'); }
    else if (t > 5 && t < 5.2) this.msg('Запуск двигателя 2');
    else if (t > 17 && t < 17.2) this.msg('Запуск двигателя 1');
  }
  // ---------- трафик и схема захода ----------
  starTgt(dist) { return this.diverted || !this.starOff ? 0 : this.starOff * clamp((dist - 30000) / 40000, 0, 1); }
  addTraffic(o) { const t = Object.assign({ id: ++this.trfId, x: 0, y: 0, h: 0, v: 0, dir: 1, col: ['#c8372d', '#2b6cd4', '#e8a53a', '#2ea36b', '#8a44c8'][this.trfId % 5], gone: false }, o); this.trf.push(t); return t; }
  trafficTick(dt) {
    const tl = this.trf; if (!tl.length) return;
    for (const t of tl) {
      if (t.kind === 'land0' || t.kind === 'land1') {
        const s0 = t.kind === 'land1' ? this.rwy1.s : this.rwy0.s, r = t.tLand - this.time;
        if (r > 0) { t.x = s0 - 75 * r; t.h = Math.max(0, (s0 - t.x) * 0.0524); t.v = 75; t.y = 0; t.ground = false; }
        else { const s = -r; t.ground = true; t.h = 0; t.v = Math.max(0, 70 - 2.5 * s); t.x = s0 + 70 * Math.min(s, 28) - 1.25 * Math.min(s, 28) ** 2; t.y = s > 34 ? Math.min(60, (s - 34) * 6) : 0; if (s > 120) t.gone = true; }
        t.onRwy = t.ground && -r < 40;
      } else if (t.kind === 'cruise') { t.x += t.dir * t.v * dt; if (Math.abs(t.x - this.x) > 60000 && (t.x - this.x) * t.dir > 0) t.gone = true; }
    }
    this.trf = tl.filter(t => !t.gone);
  }
  rwyBusy(kind) { return this.trf.some(t => t.kind === kind && (t.onRwy || t.tLand > this.time - 0.001 && t.tLand - this.time < 25)); }
  atcTick() {
    this.trafficTick(1 / 60);
    if (this.airborneOnce && !this.diverted && !this.ev && this.c.apOn && this.c.apAlt >= 6000 && Math.abs(this.c.apAlt - this.h) < 150 && this.dist > 160000 && this.hopt - this.c.apAlt >= 600 && this.c.apAlt + 600 <= this.ceilLim - 300) {
      const na = Math.round((this.c.apAlt + 600) / 100) * 100; this.atc('sc' + this.scN, this.cs + ', разрешаю набор эшелона ' + na + ' м.'); this.scN++;
      if (this.assist.auto) this.c.apAlt = na;
    }
    if (this.diverted && (this.trf.length || this.hold)) { this.trf = []; this.hold = null; this.starOff = 0; }
    const w = this.wx || { dir: 0, spd: 0 }, c = this.c, dist = this.dist, cs = this.cs;
    const wind = Math.round(w.dir / 10) * 10 + '° ' + Math.round(w.spd) + ' м/с';
    const rw = String(Math.round((((this.brg || 0) + 360) % 360) / 10) || 36).padStart(2, '0');
    if (this.holdTo && !this.atcDone.hto && this.onGround && !this.airborneOnce && this.guide && this.guide.label === 'Выезд на ВПП' && Math.abs(this.yPos) < 190) { this.atc('hto', cs + ', ' + this.fromAp.id + ' вышка, остановитесь перед полосой, на посадке борт.'); this.clrTo = false; this.addTraffic({ kind: 'land0', tLand: this.time + 55 }); }
    if (!this.clrTo && !this.airborneOnce) { const lt = this.trf.find(t => t.kind === 'land0'); if (lt && this.time > lt.tLand + 38 && !this.rwyBusy('land0')) { this.clrTo = true; this.atc('rel', cs + ', полоса свободна, занимайте полосу и взлёт разрешаю.'); } }
    if (!this.airborneOnce && this.onGround && this.lined && !this.td) {
      if (this.clrTo) this.atc('to', cs + ', ' + this.fromAp.id + ' вышка, ветер ' + wind + ', полоса свободна, взлёт разрешён.');
    }
    if (this.onGround && !this.airborneOnce && !this.clrTo && this.onRunway(this.x, this.yPos)) { this.incident('incur', 'Взлёт без разрешения', 12, 999); }
    if (this.onGround && !this.airborneOnce && this.trf.some(t => t.kind === 'land0' && t.ground && Math.abs(t.x - this.x) < 45 && Math.abs(t.y - this.yPos) < 40)) { this.finish('crash', 'Столкновение с садящимся самолётом на полосе.'); return; }
    // схема прибытия
    if (this.airborneOnce && dist < 115000 && dist > 70000 && !this.diverted && !this.ev) { const side = this.starOff > 0 ? 'справа' : 'слева'; this.atc('star', cs + ', схема прибытия ' + this.toAp.id + '-1A, точка IAF ' + side + ' от оси, затем ILS полоса ' + rw + '.'); }
    if (this.airborneOnce && !this.diverted && !this.ev && !this.hold) {
      if (this.holdPlan && !this.atcDone.holdS && dist < 76000 && dist > 64000 && this.h > 2400) {
        this.atcDone.holdS = 1; this.hold = { laps: 1, turned: 0, last: this.psi, t0: this.time };
        const eta = this.time + 205 + dist / 110;
        this.addTraffic({ kind: 'land1', tLand: eta - 170 });
        this.atc('holdA', cs + ', вы номер 2 на посадку, ожидайте над точкой, один правый круг.');
      } else if (this.aheadPlan && !this.atcDone.ahead && !this.holdPlan && dist < 95000 && dist > 70000) {
        this.atcDone.ahead = 1; this.addTraffic({ kind: 'land1', tLand: Math.max(this.time + 100, this.time + dist / 110 - 160) });
        this.atc('aheadA', cs + ', вы номер 2 на посадку, впереди борт на прямой.');
      }
    }
    if (this.hold) {
      const hd = this.hold; hd.turned += wrapPi(this.psi - hd.last); hd.last = this.psi;
      if (this.c.apOn && this.c.apAlt < 3000) this.c.apAlt = 3000;
      if (hd.turned >= (2 * Math.PI * hd.laps - 0.35) || this.time - hd.t0 > 420 || this.dist < 40000) {
        this.hold = null; if (this.autoDescDone && this.c.apOn) this.c.apAlt = APPR_ALT;
        this.atc('holdE', cs + ', ожидание закончено, выходите на заход, ILS полоса ' + rw + '.');
      }
    }
    if (this.cruiseTrf && this.airborneOnce && !this.diverted && !this.atcDone.cr && this.h > 5000 && dist > 150000 && this.x > 90000 && !this.ev) {
      this.atcDone.cr = 1; const dh = (this.rnd() < 0.5 ? -1 : 1) * 600, side = this.rnd() < 0.5 ? -1 : 1;
      this.addTraffic({ kind: 'cruise', x: this.x + 45000, y: this.yPos + side * (3500 + this.rnd() * 1500), h: this.h + dh, v: 235, dir: -1 });
      this.atc('cr', cs + ', встречный борт ' + (side > 0 ? 'справа' : 'слева') + ', ' + (dh > 0 ? 'выше' : 'ниже') + ' на 600 метров, сохраняйте эшелон.');
    }
    if (this.airborneOnce && this.h > 300 && dist > 60000) this.atc('dep', cs + ', набор разрешён, следуйте по маршруту.');
    if (this.airborneOnce && dist < 120000 && dist > 60000 && !this.diverted && !this.hold) this.atc('desc', cs + ', ' + this.toAp.id + ' подход, снижайтесь, ожидайте заход.');
    if (this.airborneOnce && dist < 45000 && dist > 5000 && !this.diverted) this.atc('app', cs + ', выход на посадочную прямую, ветер ' + wind + ', видимость ' + Math.round(((this.wx && this.wx.visD) || 10000) / 100) / 10 + ' км.');
    if (this.airborneOnce && dist < 9000 && dist > 0 && this.h < 900 && !this.onGround && !this.diverted && !this.rwyBlocked) this.atc('ldg', cs + ', полоса свободна, посадку разрешаю.');
    if (this.copilot) { if (this.onGround && !this.airborneOnce && this.ias >= this.vr - 1 && this.ias > 40) this.atc('co1', 'Второй пилот: Ротейт.'); if (this.airborneOnce && !this.onGround && this.h > 5 && this.vs > 2 && this.h < 80) this.atc('co2', 'Второй пилот: Положительный набор.'); if (this.airborneOnce && !this.onGround && this.dist < 8000 && this.h < 130 && this.h > 40 && this.vs < 0) this.atc('co3', 'Второй пилот: Сто футов.'); }
    if (this.td && this.v < 60) this.atc('vac', cs + ', освободите полосу, на стоянку следуйте за машиной.');
    if (this.diverted) this.atc('div', cs + ', следуйте на запасной, заход разрешён.');
  }
  msg(t) { this.msgs.push({ t: this.time, text: t }); if (this.msgs.length > 6) this.msgs.shift(); }
  incident(key, text, weight, cd = 20) {
    if (this._cooldown[key] && this.time - this._cooldown[key] < cd) return;
    this._cooldown[key] = this.time;
    this.incidents.push({ key, text, weight });
    this.msg(text);
  }

  // ---------- вспомогательные расчёты ----------
  get dist() { return this.D - this.x; } // до порога вдоль оси
  get heading() { return (((this.brg + (this.tf.a + this.psi) / DEG) % 360) + 360) % 360; }
  get locAfter() { return this.toAp.gen ? this.origTo.id : this.toAp.id; }
  get range() { return Math.hypot(this.D - this.x, this.yPos); }
  get ias() { return this.v * Math.sqrt(atmos(this.h + this.elev, this.dISA).sigma); }
  get vs() { return this.v * Math.sin(this.gamma); }
  get mach() { return this.v / atmos(this.h + this.elev, this.dISA).a; }
  get ceilLim() { const base = this.eng[0] + this.eng[1] < 1.5 ? Math.round(this.p.ceiling * 0.6 / 100) * 100 : this.p.ceiling; return this.fx.noRetract ? Math.min(base, 4200) : base; }
  get engCount() { return (this.eng[0] > 0.01 ? 1 : 0) + (this.eng[1] > 0.01 ? 1 : 0); }
  minSpd() { return 1.22 * stallIAS(this.mass, this.c.flaps, this.p.S) + 4; }
  get flapIdx() { return Math.round(this.flapAct); }

  aero() {
    const p = this.p, c = this.c;
    const A = atmos(this.h + this.elev, this.dISA);
    const v = this.v;
    this.A = A;
    const q = 0.5 * A.rho * v * v;
    const M = v / A.a;
    const dcl = lerpTab(FLAP_DCL, this.flapAct), cdf = lerpTab(FLAP_CD, this.flapAct), as = lerpTab(FLAP_AS, this.flapAct) * (1 - 0.1 * this.fx.ice);
    const alpha = this.onGround ? this.theta : this.theta - this.gamma;
    let CL;
    if (alpha <= as) CL = CL0 + dcl + CLA * alpha;
    else CL = Math.max(0.35, CL0 + dcl + CLA * as - 6 * (alpha - as));
    const spoil = c.brake;
    if (spoil) CL *= this.onGround ? 0.35 : 0.92;
    const CD = p.cd0 + cdf + 0.022 * this.gearPos + (spoil && !this.onGround ? 0.03 : 0) + (this.onGround && spoil ? 0.05 : 0)
      + 0.02 * this.fx.ice + this.K * CL * CL * (1 - 0.5 * Math.exp(-Math.max(0, this.h) / (0.5 * Math.sqrt(p.S * p.ar)))) + (M > p.cruiseM - 0.01 ? 12 * (M - p.cruiseM + 0.01) ** 2 : 0);
    this.q = q; this.alpha = alpha; this.alphaS = as; this.CL = CL; this.CD = CD;
    this.L = q * p.S * CL; this.Dr = q * p.S * CD;
    this.Tavail = this.fuel > 0 ? p.T0 * Math.pow(A.sigma, 0.85) * (1 - 0.35 * M) * (this.eng[0] + this.eng[1]) / 2 * (1 - 0.08 * this.fx.ice) * (this.flex && this.eng[0] + this.eng[1] > 1.99 ? 1 - 0.14 * clamp((900 - this.h) / 300, 0, 1) : 1) : 0;
    this.stallWarn = !this.onGround && alpha > as - 2.2 * DEG;
    this.stalled = !this.onGround && alpha > as;
    this.clmaxNow = CL0 + dcl + CLA * as;
  }

  // ---------- автоматика ----------
  setFlaps(n) {
    const c = this.c;
    n = clamp(n, 0, 4);
    if ((this.hyd || this.fx.flapJam) && n !== c.flaps) { if (this.time - this.flapMsgT > 3) { this.msg('Закрылки заклинило — гидравлика отказала'); this.flapMsgT = this.time; } return false; }
    if (n > c.flaps) {
      const lim = this.p.flapLim[n];
      if (this.ias > lim) {
        if (this.time - this.flapMsgT > 3) { this.msg('Закрылки: слишком быстро (≤ ' + Math.round(lim * 3.6) + ' км/ч)'); this.flapMsgT = this.time; }
        return false;
      }
    }
    c.flaps = n; return true;
  }
  setGear(down) {
    const c = this.c;
    if (down === c.gear) return true;
    if (down && (this.hyd || this.fx.gearStuck) && !this.altGear) { if (this.time - this.flapMsgT > 3) { this.msg('Шасси не выпускается — нажмите ЗАПАС. ШАССИ'); this.flapMsgT = this.time; } return false; }
    if (!down && this.fx.noRetract) { if (this.time - this.flapMsgT > 3) { this.msg('Шасси не убирается — неисправность'); this.flapMsgT = this.time; } return false; }
    if (!down && this.altGear) { this.msg('Шасси зафиксировано вручную — убрать нельзя'); return false; }
    if (!down) { if (this.onGround) return false; }
    else if (this.ias > this.p.gearLim) { this.msg('Шасси: слишком быстро (≤ ' + Math.round(this.p.gearLim * 3.6) + ' км/ч)'); return false; }
    c.gear = down; return true;
  }

  todDist() {
    const h = Math.max(this.c.apAlt > 3000 ? this.h : 3000, 3000);
    const d1 = (h - 3000) / 9 * (190 + 0.012 * this.elev);
    return d1 + 38000 + 29000 + 14000;
  }

  atTargetIAS() {
    const p = this.p, c = this.c, A = this.A;
    const f = c.flaps;
    const m = this.mass;
    if (c.gear && (f >= 3 || ((this.hyd || this.fx.flapJam) && this.dist < 60000))) return ((this.hyd || this.fx.flapJam) ? 1.3 : 1.24) * stallIAS(m, f, p.S) + 3;
    if (this.emDescent) return Math.min(160, p.flapLim[0] - 8);
    let sched = this.h < 3000 ? 128 : 154;
    const machIAS = p.cruiseM * A.a * Math.sqrt(A.sigma);
    sched = Math.min(sched, machIAS);
    if (this.fx.turb > 0) sched *= 0.92;
    if (this.fx.noRetract) sched = Math.min(sched, this.p.gearLim - 8);
    if (c.gear && this.h < 3000) sched = Math.min(sched, 118);
    let lim = p.flapLim[f] - 8;
    // на заходе скорость такая, чтобы следующая ступень закрылков уже разрешалась
    if (this.dist < 60000 && this.dist > 0) lim = f < 4 ? p.flapLim[f + 1] - 5 : lim;
    return Math.max(Math.min(sched, lim), 1.2 * stallIAS(m, f, p.S));
  }

  apVsCmd(dt) {
    const c = this.c, v = this.v;
    let vsCmd;
    if (this.apprCap) {
      const dd = this.D + AIM_OFFSET - this.x;
      const hGS = glideH(dd);
      const dev = this.h - hGS;
      vsCmd = -Math.max(40, v * Math.cos(this.psi) + this.wl.x) * Math.sin(GS_DEG * DEG) - 0.12 * dev;
      if (this.h < FLARE_H && this.c.gear) vsCmd = -(0.4 + 0.25 * this.h);
      vsCmd = clamp(vsCmd, -9, 3);
      this.dev = dev;
    } else {
      const err = c.apAlt - this.h;
      vsCmd = clamp(0.12 * err, this.emDescent ? -26 : -10, 13);
      if (c.appr && !this.apprCap && this.dist < 40000 && this.dist > 3500 && this.h < 3200 && c.apAlt <= APPR_ALT + 50 && Math.abs(this.yPos) < 500) {
        const gsH = glideH(this.D + AIM_OFFSET - this.x);
        if (this.h > gsH + 40) vsCmd = Math.min(vsCmd, clamp(0.08 * (gsH - 25 - this.h), -8, 0));
      }
      if (vsCmd > 0) {
        const vsCap = (this.Tavail - this.Dr) * v / (this.mass * G);
        vsCmd = Math.min(vsCmd, Math.max(0, 0.85 * vsCap));
        const vmin = 1.18 * stallIAS(this.mass, c.flaps, this.p.S);
        vsCmd = Math.min(vsCmd, Math.max(0, (this.ias - vmin) * 0.6));
        if (this.h + this.elev > this.ceilLim - 200) vsCmd = Math.min(vsCmd, 0);
      } else if (vsCmd < 0) {
        const tIdle = this.Tavail * IDLE;
        const vsIdle = (tIdle - this.Dr) * v / (this.mass * G);
        if (this.emDescent) vsCmd = Math.max(vsCmd, -26 + Math.max(0, this.ias * 1 - 150));
        else if (this.ias > this.atTargetIAS() + 3) vsCmd = Math.max(vsCmd, vsIdle * 0.85);
      }
    }
    // сглаживание
    this.vsCmdS += clamp(vsCmd - this.vsCmdS, -1.6 * dt, 1.6 * dt);
    return this.vsCmdS;
  }

  fpRate(gCmd, extra, rmax) {
    // темп изменения тангажа, чтобы выйти на траекторию gCmd
    const W = this.mass * G;
    const qs = Math.max(this.q * this.p.S, 1) * Math.max(0.6, Math.cos(this.phi));
    const as = this.alphaS;
    const dcl = lerpTab(FLAP_DCL, this.flapAct);
    const aEq = clamp((W * Math.cos(this.gamma) / qs - CL0 - dcl) / CLA, -0.06, as - 0.03);
    const thetaCmd = gCmd + aEq + (extra || 0);
    return clamp(1.2 * (thetaCmd - this.theta), -rmax, rmax);
  }

  // ---------- шаг физики ----------
  step(dt) {
    if (this.done) return;
    const p = this.p, c = this.c;
    this.time += dt; this.simTime += dt;
    this.updateMass();
    this.aero();
    this.updateWind();
    { const e1 = this.toAp.elev !== undefined ? this.toAp.elev : this.elevA; this.elev = this.elevA + (e1 - this.elevA) * clamp(this.x / Math.max(this.D, 1), 0, 1); }
    const A = this.A, v = this.v, m = this.mass;
    const ias = this.ias;
    const dist = this.dist;
    if (this.onGround && this.taxiOps) this.groundNav(dt);
    if (this.done) return;
    this.evStep(dt);
    if (this.done) return;
    this.atcTick();
    if (this.cold) this.startTick(dt);
    if (this.time - this._rec >= 3) { this._rec = this.time; this.track.push([Math.round(this.x), Math.round(this.yPos || 0), Math.round(this.h), Math.round(this.ias * 3.6), +this.vs.toFixed(1)]); if (this.track.length > 3000) this.track.shift(); }

    // актуаторы
    this.gearPos += clamp((c.gear ? 1 : 0) - this.gearPos, -dt / 7, dt / (this.altGear && this.gearPos < 0.98 ? 22 : 7));
    this.flapAct += clamp(c.flaps - this.flapAct, -dt * 0.35, dt * 0.35);

    // помощник: автоматика конфигурации и снижения
    if (!this.onGround) {
      if (this.assist.auto && !this.autoEngaged && this.h > 200 && (!c.gear || this.fx.noRetract) && ias > 1.18 * stallIAS(m, c.flaps, p.S)) {
        c.apOn = true; c.atOn = true; c.nav = true; c.apAlt = this.recAlt; this.autoEngaged = true;
        this.msg('Автопилот включён');
      }
      if (this.assist.auto && c.apOn && !this.autoDescDone && dist < this.todDist() && c.apAlt > APPR_ALT) {
        c.apAlt = APPR_ALT; this.autoDescDone = true; this.msg('Начинаем снижение');
      }
      if (this.assist.auto && c.apOn && dist < 46000 && !c.appr && (this.autoDescDone || (c.apAlt <= APPR_ALT + 50 && this.h < 3300 && this.diverted))) { c.appr = true; }
      if (this.assist.config && dist < 46000 && dist > 0 && this.h < 3200) {
        this.cfgTimer -= dt;
        if (this.cfgTimer <= 0) {
          this.cfgTimer = 1.2;
          const wantF = dist < 17000 ? 4 : dist < 26000 ? 3 : dist < 34000 ? 2 : dist < 42000 ? 1 : 0;
          if (c.flaps < wantF) this.setFlaps(c.flaps + 1);
          if (!c.gear && dist < 26000) this.setGear(true);
        }
      }
      if (this.assist.config && this.autoEngaged && c.flaps > 0 && dist > 50000 && ias > p.flapLim[c.flaps] * 0.8 + 0 && this.h > 600) {
        // уборка механизации после взлёта по скорости
        this.cfgTimer -= dt;
        if (this.cfgTimer <= 0) { this.cfgTimer = 3; c.flaps = Math.max(0, c.flaps - 1); }
      }
    }

    // захват глиссады
    if (c.appr && c.apOn && !this.apprCap && !this.onGround) {
      const dd = this.D + AIM_OFFSET - this.x;
      if (dist < 46000 && dist > 1500 && Math.abs(this.h - glideH(dd)) < 40 && this.h < 3200 && Math.abs(this.yPos) < 150 && Math.abs(this.psi) < 12 * DEG) { this.apprCap = true; this.msg('Глиссада захвачена'); }
    }
    if (!c.apOn || !c.appr) { if (this.apprCap && !c.apOn) this.apprCap = false; }
    if (this.apprCap && !this.assist.auto && this.h < 45 && c.apOn) { c.apOn = false; this.apprCap = false; this.msg('Автопилот отключён — выравнивайте вручную!'); }
    if (this.onGround) { this.apprCap = false; }

    // автомат тяги
    if (c.atOn && !this.onGround) {
      let tgt = this.atTargetIAS() / Math.sqrt(A.sigma);
      const vdot = clamp(0.25 * (tgt - v), -1.0, 1.0);
      const Treq = this.Dr + m * G * Math.sin(this.gamma) + m * vdot;
      let thr = this.Tavail > 1 ? ((Treq / this.Tavail) - IDLE) / (1 - IDLE) : 0;
      if (this.h < 12 && this.gearPos > 0.9 && c.flaps >= 3) thr = 0;
      c.thr = clamp(thr, 0, 1);
    }
    // тяга: у каждого двигателя свой рычаг и своя приёмистость
    if (c.atOn && !this.onGround) c.split = false;
    const spoolUp = 0.4, spoolDn = 0.6;
    if (c.rev && (!this.onGround || this.v < 12)) { c.rev = false; if (this.onGround) { c.thr = c.t1 = c.t2 = 0; c.split = false; } }
    const rev = !!c.rev && this.onGround;
    const tg = c.split ? [c.t1, c.t2] : [c.thr, c.thr];
    const Tb = this.fuel > 0 ? p.T0 * Math.pow(A.sigma, 0.85) * (1 - 0.35 * (v / A.a)) * (1 - 0.08 * this.fx.ice) : 0;
    for (let i = 0; i < 2; i++) {
      this.thrA[i] += clamp(tg[i] - this.thrA[i], -spoolDn * dt, spoolUp * dt);
      this.Ti[i] = Tb / 2 * this.eng[i] * (IDLE + (1 - IDLE) * this.thrA[i]);
      if (rev) this.Ti[i] = -Tb / 2 * 0.4 * this.eng[i] * this.thrA[i];
    }
    this.thrAct = (this.thrA[0] + this.thrA[1]) / 2;
    const T = this.Ti[0] + this.Ti[1];
    this.asymT = Tb > 1 ? (this.eng[1] * this.thrA[1] - this.eng[0] * this.thrA[0]) * (rev ? -1 : 1) : 0;
    this.T = T;

    // управление тангажем
    let rate = 0;
    const stick = c.stick;
    if (this.onGround) {
      const auth = clamp((ias - 0.6 * this.vr) / (0.35 * this.vr), 0, 1);
      if (stick > 0.04) rate = stick * 3 * DEG * auth;
      else rate = (0 - this.theta) * 1.0; // опускание носа на стойку
      if (this.td && stick <= 0.04) rate = Math.max(-2.5 * DEG, Math.min(rate, 0));
      this.gHold = null;
    } else if (c.apOn) {
      const vsCmd = this.apVsCmd(dt);
      const gCmd = Math.asin(clamp(vsCmd / Math.max(v, 50), -0.3, 0.3));
      const flare = this.apprCap && this.h < FLARE_H;
      rate = this.fpRate(gCmd, (flare ? 0.025 : 0.003) * (vsCmd - this.vs), flare ? 4 * DEG : 3 * DEG);
      this.gHold = null;
    } else if (Math.abs(stick) > 0.04) {
      rate = stick * (stick > 0 ? 3.2 : 2.6) * DEG * clamp((ias - 25) / 40, 0, 1);
      this.gHold = null;
    } else if (this.h > 15) {
      if (this.gHold === null) this.gHold = this.gamma;
      rate = this.fpRate(this.gHold, 0, 3 * DEG);
    } else { rate = 0; this.gHold = null; }

    if (!this.onGround) {
      // защита по углу атаки
      if (this.alpha > this.alphaS - 1 * DEG && rate > 0) rate = 0;
      if (this.alpha > this.alphaS) rate = -3 * DEG;
    }
    this.theta += rate * dt;
    this.theta = clamp(this.theta, this.onGround ? 0 : -15 * DEG, 25 * DEG);
    if (this.onGround && this.theta > 14 * DEG) this.theta = 14 * DEG;
    if (this.onGround && this.theta > 11.7 * DEG && !this.stats.tail) {
      this.stats.tail = true; this.incident('tail', 'Касание хвостом', 6, 999);
    }

    // крен и курс
    if (!this.onGround) {
      const roll = c.roll || 0;
      let phiT = 0;
      if (Math.abs(roll) > 0.04) phiT = roll * 33 * DEG;
      else if (c.apOn && c.nav) {
        const aim = this.D + AIM_OFFSET - this.x;
        let psiC;
        const ff = -this.wl.z / Math.max(v, 50);
        if (dist > 30000) psiC = Math.atan2(-(this.yPos - this.starTgt(dist)), aim) + ff;
        else { const lim = (20 + 17 * clamp((Math.abs(this.yPos) - 1500) / 2500, 0, 1)) * DEG; psiC = clamp(-this.yPos * (0.0015 + 0.004 * clamp(1 - dist / 8000, 0, 1)), -lim, lim) + ff; }
        phiT = this.hold ? 25 * DEG : clamp(2.5 * wrapPi(psiC - this.psi), -25 * DEG, 25 * DEG);
      }
      if (Math.abs(roll) <= 0.04) phiT += this.fx.rollBias * DEG * clamp(this.h / 100, 0, 1) * (c.apOn ? 0.25 : 1);
      this.phi += clamp(phiT - this.phi, -5 * DEG * dt, 5 * DEG * dt);
      this.phi = clamp(this.phi, -35 * DEG, 35 * DEG);
    } else this.phi = 0;

    // топливо
    if (!this.m0) this.m0 = this.mass;
    this.hopt = this.recAlt * (1 + Math.max(0, this.m0 - this.mass) / this.m0);
    const altF = this.h > 5000 ? 1 + clamp(0.06 * ((this.h - this.hopt) / 1000) ** 2, 0, 0.35) : 1;
    const flow = 1.6e-5 * (Math.abs(this.Ti[0]) + Math.abs(this.Ti[1])) * (1 + (0.26 - this.cg) * 0.1) * altF;
    { const tk = this.tk, sum = tk[0] + tk[1];
      if (Math.abs(sum - this.fuel) > 0.5) { if (sum > 0.01) { const s = this.fuel / sum; tk[0] *= s; tk[1] *= s; } else { tk[0] = tk[1] = this.fuel / 2; } }
      const k = flow / Math.max(1e-9, Math.abs(this.Ti[0]) + Math.abs(this.Ti[1]) || 1e9) * 1; // расход на единицу тяги
      const f0 = 1.6e-5 * Math.abs(this.Ti[0]) * (flow / (1.6e-5 * (Math.abs(this.Ti[0]) + Math.abs(this.Ti[1])) || 1)) * dt, f1 = 1.6e-5 * Math.abs(this.Ti[1]) * (flow / (1.6e-5 * (Math.abs(this.Ti[0]) + Math.abs(this.Ti[1])) || 1)) * dt;
      if (this.xfeed) { const a = tk[0] >= tk[1] ? 0 : 1; tk[a] -= f0 + f1; } else { tk[0] -= f0; tk[1] -= f1; }
      if (this.leak > 0) tk[this.leakSide] -= this.leak * dt;
      for (let i = 0; i < 2; i++) if (tk[i] < 0) { if (this.leak > 0 && i === this.leakSide) this.leak = 0; if (this.xfeed) tk[1 - i] += tk[i]; tk[i] = 0; }
      if (!this.xfeed && this.fuel > 5) for (let i = 0; i < 2; i++) if (tk[i] <= 0.01 && this.eng[i] > 0.01 && !this.cold && this.airborneOnce && (this.Ti[i] || 0) !== 0 && tk[1 - i] > 50) { this.eng[i] = 0; this.msg('ДВИГАТЕЛЬ ' + (i + 1) + ' ОСТАНОВЛЕН: БАК ПУСТ — откройте перекачку'); }
      this.fuel = Math.max(0, tk[0] + tk[1]);
      this.imb = Math.abs(tk[0] - tk[1]);
      if (this.imb > 1500) this.incident('imb', 'Сильный дисбаланс топлива', 4, 999);
    }
    if (this.fuel <= 0 && this.Tavail === 0 && !this.warnings.has('fuel0')) { this.warnings.add('fuel0'); this.msg('Топливо закончилось!'); }

    this.asym = this.asymT;
    this.applyFx(dt);
    if (this.onGround) this.stepGround(dt, T);
    else this.stepAir(dt, T);

    // предупреждения
    this.updateWarnings(dt);
  }

  // ветер в местной системе координат, видимость и дождь по маршруту
  updateWind() {
    const wx = this.wx, t = this.time, tf = this.tf;
    this.gustF = Math.max(0, Math.sin(t * 0.31) * Math.sin(t * 0.77 + 1));
    const S = wx.spd + wx.gust * this.gustF;
    if (S < 0.05) { this.wl.x = 0; this.wl.z = 0; }
    else { const th = (wx.dir + 180 - this.brg) * DEG, Wx = S * Math.cos(th), Wz = S * Math.sin(th); this.wl.x = Wx * tf.c + Wz * tf.s; this.wl.z = -Wx * tf.s + Wz * tf.c; }
    const u = clamp(this.diverted ? 1 : this.x / Math.max(this.D, 1), 0, 1), k = u < 0.5 ? 0 : (u - 0.5) * 2;
    { const hh = Math.max(0, this.h), wm = 1 + 2 * clamp((hh - 300) / 6000, 0, 1); this.wl.x *= wm; this.wl.z *= wm; if (wx.jet) this.wl.x += wx.jet * Math.exp(-(((hh - 10500) / 2800) ** 2)); }
    this.wxNow.vis = wx.vis + (wx.visD - wx.vis) * k; this.wxNow.rain = wx.rain + (wx.rainD - wx.rain) * k;
    this.fogBase = this.h < 4500 ? clamp((8000 - this.wxNow.vis) / 7000, 0, 1) * 0.85 * clamp((4500 - this.h) / 1500, 0, 1) : 0;
  }
  // эффекты ЧП: турбулентность, сдвиг ветра, снос, лопнувшая шина и т.п.
  applyFx(dt) {
    const fx = this.fx, t = this.time;
    if (fx.fog > 0 && !(this.ev && this.ev.id === 'fog')) fx.fog = Math.max(0, fx.fog - dt / 30);
    if (this.wx.gust > 1 && this.h < 1200 && !this.onGround) { const tw = clamp(this.wx.gust / 8, 0, 1) * 0.5 * this.gustF; this.gamma += tw * 0.02 * dt * Math.sin(this.time * 2.7); this.phi += tw * 3 * DEG * dt * Math.sin(this.time * 1.9 + 1); }
    if (fx.smoke > 0 && !(this.ev && this.ev.id === 'cabinFire')) fx.smoke = Math.max(0, fx.smoke - dt / 60);
    if (fx.flash > 0) fx.flash = Math.max(0, fx.flash - dt * 3);
    if (this.onGround) {
      if (fx.tire && !this.airborneOnce && this.v > 3) this.psi += fx.tire * 0.05 * dt * Math.min(1, this.v / 20);
      return;
    }
    if (fx.turb > 0) {
      const n = Math.sin(1.9 * t) * 0.6 + Math.sin(3.3 * t + 1.3) * 0.4, n2 = Math.sin(1.3 * t + 2) * 0.6 + Math.sin(2.9 * t) * 0.4, n3 = Math.sin(2.3 * t + 0.5);
      this.gamma += fx.turb * 0.03 * dt * n;
      this.phi += fx.turb * 4 * DEG * dt * n2;
      this.v = Math.max(5, this.v + fx.turb * 4 * n3 * dt);
      if (!fx.belts) { fx.injT = (fx.injT || 0) + dt * fx.turb; if (fx.injT > 25 && !fx.injDone) { fx.injDone = true; this.incident('belts', 'Пассажиры без ремней получили травмы', 8, 999); } }
    }
    if (fx.ws > 0) { fx.ws -= dt; this.v = Math.max(8, this.v - 1.6 * dt); this.h -= 5 * dt; }
    if (fx.gps) this.yPos += 3.5 * dt * (fx.gpsDir || 1);
  }
  evAction(k) {
    const ev = this.ev; if (!ev || this.done) return;
    const d = EVENT_DEFS[ev.id]; if (d.act) d.act(this, ev, k);
  }
  evBtns() {
    const ev = this.ev; if (!ev || this.done) return [];
    const d = EVENT_DEFS[ev.id]; return d.btns ? d.btns(this, ev) : [];
  }

  stepGround(dt, T) {
    const c = this.c, W = this.mass * G;
    const N = Math.max(0, W - this.L);
    const onRwy = this.onRunway(this.x);
    const paved = !this.taxiOps || this.onPaved();
    // режим руления: малая скорость и газ в нижней трети ползунка — ползунок задаёт скорость руления
    const taxiMode = this.taxiOps && this.v < 24 && c.thr < 0.35;
    if (taxiMode) {
      let vt = c.taxiAuto && !(this.td && !this.td.onDest) ? this.autoV : c.thr / 0.35 * 15;
      if (!paved) vt = Math.min(vt, 6);
      let a = c.brake ? -2.6 : clamp((vt - this.v) * 0.7, -1.8, 1.0);
      if (this.gearPos < 0.9) a = Math.min(a, -1);
      this.v = Math.max(0, this.v + a * dt);
      if (this.v < 0.05 && vt < 0.2) this.v = 0;
    } else {
      let mu = paved ? 0.02 : 0.15;
      if (this.gearPos < 0.9) mu = 0.5;
      if (!c.brake && this.td && c.abrk > 0 && this.v > 3) mu += [0.08, 0.14, 0.22][c.abrk - 1] * (this.fx.slick ? 0.55 : this.wxNow.rain > 0.3 ? 0.8 : 1);
      if (c.brake) mu += onRwy ? (this.fx.slick ? 0.15 : this.wxNow.rain > 0.3 ? 0.24 : 0.30) : 0.2;
      let F = T - this.Dr - mu * N;
      if (this.v < 0.3 && F <= 0) { this.v = 0; }
      else {
        this.v += F / this.mass * dt;
        if (this.v < 0) this.v = 0;
      }
    }
    const steer = this.taxiOps && c.taxiAuto && !(this.td && !this.td.onDest) ? this.autoSteer : (c.roll || 0);
    if (this.taxiOps) {
      if (this.v > 0.8) {
        const sc = Math.abs(steer) > 0.04 ? steer : 0;
        this.psi += sc * Math.min(this.v / 12, 0.7) * (this.v > 30 ? Math.pow(30 / this.v, 2) : 1) * dt;
        if (!sc && onRwy && this.v > 12 && Math.abs(this.psi) < 0.6) this.psi -= this.psi * 0.6 * dt;
      }
    } else if (this.v > 1) {
      if (Math.abs(steer) > 0.04) this.psi += steer * 0.25 * Math.min(1, 25 / Math.max(this.v, 5)) * dt;
      else this.psi -= this.psi * 0.6 * dt;
    }
    if (this.asym && this.v > 3 && !(this.taxiOps && c.taxiAuto)) this.psi -= this.asym * 0.06 * Math.min(1, this.v / 20) * (this.assist.auto ? 0.35 : 1) * dt;
    if (this.fx.slick && this.v > 25) this.psi += this.fx.slick * 0.02 * Math.sin(this.time * 0.8) * dt;
    if (this.v > 20 && (this.wl.x || this.wl.z)) this.psi -= this.wl.z * 0.0015 * clamp((this.v - 20) / 20, 0, 1) * (this.assist.auto ? 0.3 : 1) * dt;
    this.psi = wrapPi(this.psi);
    this.x += (this.v * Math.cos(this.psi) + (this.v > 20 ? this.wl.x * clamp((this.v - 20) / 15, 0, 1) : 0)) * dt;
    this.yPos += this.v * Math.sin(this.psi) * dt;
    this.gamma = 0; this.h = 0;
    if (this.taxiOps) {
      if (!paved && this.v > 8) this.incident('grass', 'Выезд на траву', 3, 30);
      if (paved && !onRwy && this.v > 20) this.incident('taxispeed', 'Превышение скорости руления', 2, 30);
      for (const f of [this.fr0, this.fr1]) {
        const ax = this.x - f.x0;
        if (this.yPos > 238 && ax > f.len * 0.28 && ax < f.len * 0.65 && this.v > 1) { this.finish('crash', 'Столкновение с терминалом.'); return; }
      }
    }
    // отрыв
    if (!this.td && this.v > 25 && this.L >= W && this.theta > 1.5 * DEG && this.gearPos > 0.5 && (!this.taxiOps || onRwy)) {
      this.onGround = false; this.airborneOnce = true; this.gamma = 0.0; this.h = 0.05;
      this.msg('Отрыв! Скорость ' + Math.round(this.ias * 3.6) + ' км/ч');
      return;
    }
    // заход в траву
    if (!onRwy && this.v > 30 && !this.td && (this.x > this.rwy0.e || Math.abs(this.yPos) > 32)) { this.finish('crash', Math.abs(this.yPos) > 32 ? 'Самолёт выкатился с боковой стороны полосы при взлёте.' : 'Самолёт выкатился за конец полосы при взлёте.'); return; }
    if (!onRwy && this.td && this.v > 25) { this.finish('crash', Math.abs(this.yPos) > 32 ? 'Самолёт выкатился с боковой стороны полосы.' : this.x > this.rwy1.e ? 'Самолёт выкатился за пределы полосы на большой скорости.' : 'Посадка вне полосы на большой скорости.'); return; }
    // автотормоз после касания
    if (this.td && this.assist.auto && this.v > 8 && !(this.taxiOps && c.taxiAuto && this.v < 24)) {
      c.brake = true; c.atOn = false; c.split = false;
      const autoRev = this.eng[0] > 0.9 && this.eng[1] > 0.9 && this.v > 32 && this.td.onDest;
      c.rev = autoRev; c.thr = c.t1 = c.t2 = autoRev ? 0.6 : 0;
    }
    // конец пробега
    if (this.v > this.maxV) this.maxV = this.v;
    if (this.td && this.v < 0.6 && this.time - this.td.t > 2) {
      const onDest = this.x >= this.rwy1.s - 20 && this.x <= this.rwy1.e + 20 && Math.abs(this.yPos) <= 35;
      if (this.x > this.rwy1.e && Math.abs(this.yPos) < 50) this.finish('overrun', 'Самолёт остановился за пределами полосы.');
      else if (this.taxiOps && this.td.onDest) { /* продолжаем руление до гейта */ }
      else if (onDest) this.finish('ok', '');
      else if (this.x <= this.rwy0.e + 20) this.finish('forced', 'Вынужденная посадка в аэропорту вылета. Рейс отменён.');
      else this.finish('forced', 'Остановились вне полосы назначения.');
    }
    // прерванный взлёт
    if (!this.td && !this.airborneOnce && this.maxV > 25 && this.v < 0.5) this.finish('abort', 'Взлёт прекращён.');
  }

  onRunway(x, y = this.yPos) {
    if (Math.abs(y) > 32) return false;
    return (x >= this.rwy0.s - 5 && x <= this.rwy0.e) || (x >= this.rwy1.s - 5 && x <= this.rwy1.e);
  }

  stepAir(dt, T) {
    const v = Math.max(this.v, 12), m = this.mass;
    const al = this.alpha, ca = Math.cos(al), sa = Math.sin(al);
    const dv = ((T * ca - this.Dr) / m - G * Math.sin(this.gamma)) * dt;
    const dg = ((this.L * Math.cos(this.phi) + T * sa) / (m * v) - G * Math.cos(this.gamma) / v) * dt;
    if (this.v > 20) this.psi = wrapPi(this.psi + G * Math.tan(this.phi) / this.v * dt - this.asym * 0.012 * (c0apOn(this) ? 0.1 : this.assist.auto ? 0.4 : 1) * dt);
    this.v = Math.max(5, this.v + dv);
    this.gamma = clamp(this.gamma + dg, -1.2, 1.2);
    this.x += (this.v * Math.cos(this.gamma) * Math.cos(this.psi) + this.wl.x) * dt;
    this.yPos += (this.v * Math.cos(this.gamma) * Math.sin(this.psi) + this.wl.z) * dt;
    this.h += this.v * Math.sin(this.gamma) * dt;
    // перегрузка
    const n = this.L / (m * G);
    this.nz = n;
    if (n > this.stats.maxG) this.stats.maxG = n;
    if (this.h < 1500 && this.h > 0.5 && this.airborneOnce && terrainAt(this, this.x, this.yPos) > this.h + 3) { this.finish('crash', 'Столкновение с землёй: самолёт врезался в гору.'); return; }
    if (this.h <= 0 && this.gamma <= 0.02) this.touchdown();
    else if (this.h < 0) this.h = 0;
    // пролетели
    if (!this.done && this.x > this.rwy1.e + 20000 && Math.hypot(this.x - this.D, this.yPos) > 40000) this.finish('missed', 'Вы пролетели аэропорт назначения.');
    if (!this.done && Math.abs(this.yPos) > 70000) this.finish('missed', 'Вы слишком далеко ушли от маршрута.');
  }

  touchdown() {
    const sink = -this.v * Math.sin(this.gamma);
    const tdx = this.x; this.marks.push({ i: this.track.length, text: 'Касание' });
    this.h = 0;
    const lat = Math.abs(this.yPos);
    const onDest = tdx >= this.rwy1.s - 10 && tdx <= this.rwy1.e && lat <= 32;
    const onOrig = tdx >= this.rwy0.s && tdx <= this.rwy0.e && lat <= 32;
    const ias = this.ias;
    if (this.gearPos < 0.85) { this.finish('crash', 'Посадка с невыпущенным шасси.'); return; }
    if (this.rwyBlocked && onDest) { this.finish('crash', 'Столкновение с техникой на полосе при посадке.'); return; }
    if (!onDest && !onOrig && this.v > 35) {
      this.finish('crash', lat > 32 ? 'Приземление рядом с полосой: слишком большое боковое отклонение.' : tdx < this.rwy1.s ? 'Недолёт: самолёт приземлился до полосы.' : 'Приземление за пределами полосы.');
      return;
    }
    if (Math.abs(this.phi) > 12 * DEG) { this.finish('crash', 'Касание крылом: слишком большой крен при посадке.'); return; }
    if (Math.abs(this.psi) > 15 * DEG) { this.finish('crash', 'Боковой снос: самолёт приземлился не вдоль полосы.'); return; }
    if (sink > 5.5) { this.finish('crash', 'Слишком жёсткое приземление (' + sink.toFixed(1) + ' м/с): конструкция разрушена.'); return; }
    if (ias * 3.6 > 400) { this.finish('crash', 'Слишком высокая скорость при посадке.'); return; }
    this.onGround = true; this.gamma = 0;
    this.td = { t: this.time, sink: Math.max(0, sink), v: this.v, ias, pitch: this.theta / DEG, x: tdx, onDest, onOrig, past: tdx - this.rwy1.s, lat };
    this.phi = 0;
    if (lat > 12) this.incident('lat', 'Касание не по оси полосы', 2, 999);
    if (this.theta < 0.3 * DEG) this.incident('nose', 'Касание носовой стойкой', 4, 999);
    if (this.theta > 11.7 * DEG && !this.stats.tail) { this.stats.tail = true; this.incident('tail', 'Касание хвостом', 6, 999); }
    if (sink > 3.4) this.incident('hard', 'Жёсткая посадка', 0, 999);
    this.msg(onOrig && !onDest ? 'Вынужденная посадка на аэродроме вылета' : 'Касание: ' + sink.toFixed(1) + ' м/с');
    // вынужденная посадка в аэропорту вылета — сразу завершить рейс после остановки
  }

  updateWarnings(dt) {
    const w = this.warnings;
    const set = (k, on) => { if (on) w.add(k); else w.delete(k); };
    const A = this.A, ias = this.ias;
    set('stall', this.stallWarn);
    if (this.stalled) { this.stats.stallT += dt; this.incident('stall', 'Сваливание', 5, 25); }
    const over = this.mach > this.p.cruiseM + 0.045 || ias > 175;
    set('over', over);
    if (over) { this.stats.overT += dt; if (this.stats.overT > 3) this.incident('over', 'Превышение скорости', 4, 40); }
    const sinkRate = this.vs;
    set('sink', !this.onGround && this.h < 300 && sinkRate < -9 && this.dist < 30000);
    set('pullup', !this.onGround && this.h < 80 && sinkRate < -11);
    set('gear', !this.onGround && this.h < 250 && this.dist < 8000 && this.dist > 0 && !this.c.gear);
    set('flaps', !this.onGround && this.h < 250 && this.dist < 6000 && this.dist > 0 && this.c.flaps < 3 && this.c.gear && !this.hyd);
    this._tw -= dt;
    if (this._tw <= 0) {
      this._tw = 0.5; let th = false;
      if (!this.onGround && this.airborneOnce && this.h < 1800 && !this.ga) {
        const cp = Math.cos(this.psi), sp = Math.sin(this.psi);
        for (const k of [1200, 2600, 4500]) { if (terrainAt(this, this.x + k * cp, this.yPos + k * sp) > this.h - 120 + (this.vs < -2 ? -this.vs * k / Math.max(this.v, 60) * 0.5 : 0)) { th = true; break; } }
      }
      this._terrWarn = th;
    }
    set('terrain', this._terrWarn);
    set('lowfuel', this.fuel < this.p.burnHr * 0.3 && this.fuel > 0);
    if (w.has('sink') || w.has('pullup')) { this.stats.gpws += dt; this.incident('sink', 'Опасная скорость снижения', 3, 30); }
    if (this.fuel <= 0 && this.Tavail === 0) set('fuel0', true);
  }

  finish(kind, reason) {
    if (this.done) return;
    this.done = true;
    this.result = { kind, reason };
    this.closeEvents(kind);
    this.c.brake = true;
  }

  // ---------- ускорение времени ----------
  allowedWarp() {
    const c = this.c;
    if (this.ev || this.fade > 0 || this.ga || this.rwyBlocked || this.hold || !this.clrTo) return 1;
    if (this.onGround) return this.taxiOps && c.taxiAuto && !this.warnings.size && this.v > 0.5 && !(this.td && !this.td.onDest) ? 4 : 1;
    if (!c.apOn || !c.atOn || this.warnings.size) return 1;
    if (Math.abs(c.roll || 0) > 0.04 || Math.abs(this.phi) > 6 * DEG) return 1;
    if (!c.nav && Math.abs(this.yPos) > 800) return 1;
    const dist = this.dist;
    // заход по глиссаде: если всё делает автоматика, можно слегка ускорить
    if (this.apprCap) {
      if (!(this.assist.auto && this.assist.config) || this.h < 400 || dist < 9000) return 1;
      return dist > 16000 ? 4 : 2;
    }
    if (this.h < 250) return 1;
    if (this.h < 700) return dist > 60000 ? 2 : 1;
    // без помощника по механизации игроку нужно время на закрылки — ускорение выключаем раньше
    if (dist < (this.assist.config ? 34000 : 50000)) return 1;
    let w = (dist - (this.assist.config ? 30000 : 45000)) / (Math.max(this.v, 100) * (this.assist.config ? 20 : 40));
    let r = 1; for (const k of [2, 4, 8, 16, 32]) if (w >= k) r = k;
    return r;
  }
  effectiveWarp() { return Math.min(Math.max(1, this.c.warp), this.allowedWarp()); }

  update(frameDt) {
    const w = this.effectiveWarp();
    this.acc += Math.min(frameDt, 0.05) * 60 * w;
    let n = Math.floor(this.acc); this.acc -= n;
    n = Math.min(n, 80);
    for (let i = 0; i < n && !this.done; i++) this.step(1 / 60);
    return w;
  }

  // ---------- аварийные ситуации ----------
  startEvent(id, o) {
    const d = EVENT_DEFS[id];
    const ev = { id, t0: this.time, okT: 0 };
    this.ev = ev; this.marks.push({ i: this.track.length, text: d.short });
    d.start(this, ev, o);
    return ev;
  }
  resolveEvent(ev, outcome, text) {
    if (!ev || ev.done) return;
    ev.done = true;
    this.evLog.push({ id: ev.id, outcome, title: EVENT_DEFS[ev.id].short });
    if (this.ev === ev) this.ev = null;
    if (text) this.msg(text);
  }
  closeEvents(kind) {
    const ev = this.ev; if (!ev) return;
    let out = kind === 'crash' || kind === 'overrun' ? 'fail' : 'late';
    if (ev.id === 'engRoll' && kind === 'abort') out = 'ok';
    if (this.diverted && kind === 'ok' && ev.id !== 'runway') out = 'ok';
    if (ev.id === 'runway' && this.gaCount === 0 && kind === 'ok') out = 'fail';
    const d = EVENT_DEFS[ev.id]; if (d.close) out = d.close(this, ev, kind, out);
    this.resolveEvent(ev, out, '');
  }
  evStep(dt) {
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 0.5);
    const c = this.c;
    if (this.apLock > 0) { this.apLock -= dt; c.apOn = false; c.appr = false; this.apprCap = false; if (this.apLock <= 0 && this.assist.auto) { c.apOn = true; c.atOn = c.atOn || this.atLock <= 0; } }
    if (this.atLock > 0) { this.atLock -= dt; c.atOn = false; if (this.atLock <= 0 && this.assist.auto) c.atOn = true; }
    if ((this.engCount < 2 || this.fx.noRetract) && c.apOn && c.apAlt > this.ceilLim - 250) c.apAlt = this.ceilLim - 250;
    if (this.ga) this.gaStep(dt);
    if (this.ev) EVENT_DEFS[this.ev.id].tick(this, this.ev, dt);
    else if (!this.done && this.evq) { for (const q of this.evq) if (!q.fired && evWhen(this, q)) { q.fired = true; this.startEvent(q.id, q.o); break; } }
    const a = this.alerts; a.clear();
    if (this.fire && !this.fire.ext) a.add('ПОЖАР ДВИГАТЕЛЯ №' + (this.fire.side + 1));
    if (this.decomp && this.ev && this.ev.id === 'decomp') a.add('РАЗГЕРМЕТИЗАЦИЯ');
    if (this.rwyBlocked && !this.td) a.add('ПОЛОСА ЗАНЯТА — УХОД!');
    if (this.hyd) a.add('ОТКАЗ ГИДРАВЛИКИ');
    if (this.apLock > 0) a.add('ОТКАЗ АВТОПИЛОТА');
    if (this.atLock > 0) a.add('ОТКАЗ АВТОМАТА ТЯГИ');
    if (this.ev) { const al = EVENT_DEFS[this.ev.id].alert; if (al) { const x = al(this, this.ev); if (x) for (const y of [].concat(x)) a.add(y); } }
    if (this.imb > 600 && !this.xfeed) a.add('ДИСБАЛАНС ТОПЛИВА — ПЕРЕКАЧКА');
    if (this.engCount < 2 && !this.cold && !(this.fire && !this.fire.ext)) a.add(this.engCount ? 'ДВИГАТЕЛЬ ' + (this.eng[0] < 0.01 ? 1 : 2) + ' — ОТКАЗ' : 'ОБА ДВИГАТЕЛЯ ОТКАЗАЛИ');
  }
  // ---------- запасные аэродромы ----------
  altList() {
    const out = [], p = this.p;
    for (const w of this.world) {
      if (w.id === this.toAp.id && !this.diverted) continue;
      if (this.diverted && w.id === this.divTo) continue;
      const l = toLocal(this.tf, w.wx, w.wz, { x: 0, z: 0 });
      const dx = l.x - this.x, dz = l.z - this.yPos, d = Math.hypot(dx, dz);
      if (d > 520000) continue;
      const rel0 = Math.abs(wrapPi(Math.atan2(dz, dx) - this.psi));
      const need = 8000 + 0.8 * (Math.max(0, this.h - 3000) / 9 * 190 + 81000 * Math.min(1, this.h / 3000)) + (rel0 > 1.4 ? 50000 : rel0 > 0.7 ? 15000 : 0);
      let ok = true, why = '';
      if (w.len < p.minRwy) { ok = false; why = 'полоса коротка'; }
      else if (d < need) { ok = false; why = 'слишком близко/высоко'; }
      else if (this.onGround || this.ga) { ok = false; why = ''; }
      out.push({ w, d, ok, why, lx: l.x, lz: l.z, rel: Math.atan2(dz, dx) - this.psi, label: w.gen ? w.ap.city : w.ap.city + ' (' + w.id + ')' });
    }
    out.sort((a, b) => (b.ok - a.ok) || (a.d - b.d));
    return out;
  }
  altText() { const a = this.altList().find(x => x.ok); return a ? a.label + ' — ' + Math.round(a.d / 1000) + ' км' : 'недоступен'; }
  divertTo(w) {
    const c = this.c;
    if (this.onGround || this.done) return false;
    const p = toWorld(this.tf, this.x, this.yPos, { x: 0, z: 0 });
    const dx = w.wx - p.x, dz = w.wz - p.z, d = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
    const hdgW = this.tf.a + this.psi;
    this.tf = { a, c: Math.cos(a), s: Math.sin(a), ox: p.x, oz: p.z };
    this.psi = wrapPi(hdgW - a); this.x = 0; this.yPos = 0;
    this.D = d; this.toAp = w.ap; this.rwy1 = { s: d, e: d + w.len }; this.fr1 = frameOf(d, w.len);
    this.rwy0 = { s: -1e7, e: -1e7 + 10 }; this.fr0 = frameOf(-1e7, 10);
    this.elevA = this.elev; this.diverted = true; this.divTo = w.id; this.evq = []; this.rwyBlocked = false;
    c.appr = false; this.apprCap = false; this.autoDescDone = false; this.inXc = undefined; this.gHold = null; this.vsCmdS = 0;
    if (this.ga) this.ga = false;
    if (this.apLock <= 0 && (this.assist.auto || c.apOn)) { c.apOn = true; c.nav = true; }
    this.fade = 0.8; this.fadeText = 'Курс на запасной аэродром ' + (w.gen ? w.ap.city.replace('Запасной аэродром', 'Запасной') : w.ap.id);
    this.msg('Следуем на ' + (w.gen ? w.ap.city : w.ap.city + ' (' + w.id + ')') + ', ' + Math.round(d / 1000) + ' км');
    return true;
  }
  evHint() {
    if (!this.ev || this.done) return '';
    const st = EVENT_DEFS[this.ev.id].steps(this, this.ev).filter(s => !s.opt && !s.done);
    return st.length ? '⚠ ' + st[0].t : '';
  }
  evView() {
    if (!this.ev) return null;
    const d = EVENT_DEFS[this.ev.id];
    return { title: d.title, steps: d.steps(this, this.ev) };
  }
  extinguish() {
    const fr = this.fire; if (!fr || fr.ext) return;
    fr.ext = true; fr.extAt = this.time; this.eng[fr.side] = 0;
    this.msg('Двигатель №' + (fr.side + 1) + ' остановлен, огнетушитель сработал');
  }
  altGearExt() {
    if (!(this.hyd || this.fx.gearStuck) || this.altGear) return;
    this.altGear = true; this.c.gear = true; this.msg('Запасная выпуска шасси: ~20 секунд');
  }
  emergDescent() {
    if (this.emDescent || !this.decomp) return;
    this.emDescent = true; const c = this.c;
    if (this.apLock <= 0) c.apOn = true;
    c.apAlt = 3000; c.appr = false; c.brake = true; c.atOn = this.atLock <= 0;
    this.msg('Аварийное снижение до 3000 м');
  }
  canGoAround() { return !this.onGround && !this.ga && this.airborneOnce && this.dist < 20000 && this.dist > -300 && this.h < 1500 && !this.td; }
  // смена полосы: поворачиваем ось захода вокруг аэропорта и выводим самолёт на новую прямую
  changeRunway() {
    if (this.onGround || this.done) return false;
    const c = this.c, tf = this.tf, A = toWorld(tf, this.D, 0, { x: 0, z: 0 });
    const cand = [-80, -60, -40, 40, 60, 80].map(d => d * DEG);
    // выбираем направление с лучшим встречным ветром
    let best = cand[0], bh = -1e9;
    for (const d of cand) {
      const a2 = tf.a + d, th = (this.wx.dir + 180 - this.brg) * DEG, S = this.wx.spd;
      const head = -(S * Math.cos(th - a2)) + (this.rnd() - 0.5) * 0.5; // встречная составляющая вдоль новой оси
      if (head > bh) { bh = head; best = d; }
    }
    const a2 = tf.a + best, c2 = Math.cos(a2), s2 = Math.sin(a2);
    this.tf = { a: a2, c: c2, s: s2, ox: A.x - this.D * c2, oz: A.z - this.D * s2 };
    this.ga = false; this.rwyBlocked = false;
    this.x = this.D - 36000; this.yPos = 0; this.psi = 0; this.phi = 0; this.h = clamp(this.h, 1000, 1800); this.gamma = 0; this.gHold = null; this.vsCmdS = 0;
    this.fuel = Math.max(0, this.fuel - this.p.burnHr * 0.05);
    const rw = Math.round((((this.brg + this.tf.a / DEG) % 360) + 360) % 360 / 10) || 36;
    this.rwyName = rw; this.fade = 1; this.fadeText = 'Смена полосы: заход на ВПП ' + String(rw).padStart(2, '0');
    c.flaps = this.hyd || this.fx.flapJam ? c.flaps : Math.max(c.flaps, 1); this.flapAct = c.flaps;
    c.apAlt = APPR_ALT; if (this.apLock <= 0) { c.apOn = true; c.appr = true; c.nav = true; } if (this.atLock <= 0) c.atOn = true; this.autoDescDone = true; this.apprCap = false;
    this.msg('Заход на ВПП ' + String(rw).padStart(2, '0'));
    return true;
  }
  goAround() {
    if (!this.canGoAround()) return;
    const c = this.c;
    this.ga = true; this.gaT0 = this.time;
    c.thr = c.t1 = c.t2 = 1; c.split = false; c.atOn = false; c.appr = false; this.apprCap = false; c.brake = false;
    if (this.apLock <= 0) { c.apOn = true; c.nav = true; } else this.gHold = 7 * DEG;
    c.apAlt = 1500;
    if (c.flaps > 2) this.setFlaps(2);
    this.msg('УХОД НА ВТОРОЙ КРУГ!');
  }
  gaStep(dt) {
    const c = this.c;
    c.appr = false; this.apprCap = false; c.brake = false;
    if (this.apLock <= 0 && !c.apOn) c.apOn = true;
    if (this.h > 25 && this.vs > 0 && c.gear && !this.altGear) this.setGear(false);
    if (this.h > 250 && this.atLock <= 0) c.atOn = true; else if (this.h <= 250) { c.thr = c.t1 = c.t2 = 1; c.split = false; c.atOn = false; }
    if (this.apLock > 0 && c.apAlt && this.h > 1000) this.gHold = 0;
    if (this.h > 1350 || this.time - this.gaT0 > 150) this.circuit();
  }
  circuit() {
    const c = this.c;
    this.ga = false; this.gaCount++; this.rwyBlocked = false;
    this.x = this.D - 36000; this.yPos = 0; this.psi = 0; this.phi = 0; this.h = 1500; this.gamma = 0; this.gHold = null; this.vsCmdS = 0;
    this.fuel = Math.max(0, this.fuel - this.p.burnHr * 0.06);
    this.fade = 1; this.fadeText = 'Заход по кругу…';
    c.flaps = this.hyd ? c.flaps : 1; this.flapAct = c.flaps;
    c.apAlt = APPR_ALT; if (this.apLock <= 0) { c.apOn = true; c.appr = true; c.nav = true; } c.atOn = this.atLock <= 0; this.autoDescDone = true;
    this.msg('Повторный заход');
  }

  // ---------- подсказки ----------
  hint() {
    const c = this.c, dist = this.dist, kmh = x => Math.round(x * 3.6);
    if (this.done) return '';
    if (this.cold) return this.startReq ? 'Идёт запуск двигателей…' : 'Нажмите ЗАПУСК ДВИГАТЕЛЕЙ';
    const eh = this.evHint(); if (eh) return eh;
    if (this.hold) return 'Ожидание: правый круг, крен ≈25° — осталось ' + Math.max(0, Math.round((2 * Math.PI - 0.35 - this.hold.turned) / DEG)) + '°';
    if (this.onGround && this.taxiOps && !this.clrTo && !this.airborneOnce) return 'Ждите перед полосой — садится борт, затем разрешат взлёт';
    if (this.onGround && this.taxiOps) {
      const g = this.guide, gs = g ? ' — ' + g.label + ', ' + Math.round(g.dist) + ' м' : '';
      if (this.td) {
        if (this.td.onOrig && !this.td.onDest) return '';
        if (this.v > 24 && !c.brake) return 'Нажмите ТОРМОЗ, газ на минимум';
        if (this.v > 24) return 'Торможение…';
        if (c.taxiAuto) return 'Автоматическое руление' + gs;
        if (this.v < 0.5 && c.brake) return 'Отпустите тормоз, газ 15–30% — рулим к гейту' + gs;
        return 'Рулите к гейту' + gs + '. Поворот — штурвал влево/вправо';
      }
      if (!this.airborneOnce && c.thr < 0.35 && !this.lined && this.v < 26) {
        if (c.taxiAuto) return 'Автоматическое руление' + gs;
        if (c.brake && this.v < 1) return 'Отпустите ТОРМОЗ и дайте газ 15–30% — выруливаем' + gs;
        return 'Рулите на полосу' + gs;
      }
    }
    if (this.onGround) {
      if (this.td) {
        if (!c.brake) return 'Нажмите ТОРМОЗ, газ на минимум';
        return this.v > 3 ? 'Торможение…' : '';
      }
      if (c.brake && this.v < 1) return 'Отпустите тормоз (кнопка ТОРМОЗ)';
      if (c.thr < 0.9) return 'Дайте полный газ — тяга вверх';
      if (this.ias < this.vr - 3) return 'Разгон. Скорость отрыва VR: ' + kmh(this.vr) + ' км/ч';
      return 'ТЯНИТЕ РУЧКУ ВВЕРХ — тангаж 10–12°';
    }
    if (this.h < 12 && this.apprCap === false && dist < 3000 && dist > -1500 && c.gear) return 'ВЫРАВНИВАЙТЕ: слегка тяните ручку, газ малый';
    if (this.warnings.has('stall')) return 'Малая скорость! Опустите нос, добавьте тягу';
    if (!this.airborneOnce) return '';
    if (!c.apOn && Math.abs(this.yPos) > 400 && dist < 60000 && dist > 0) return 'Вы в стороне от курса — поверните штурвал к оси полосы';
    if (c.apOn && !c.nav && Math.abs(this.yPos) > 500 && dist < 60000 && dist > 0) return 'Нажмите НАВ — автопилот вернёт самолёт на курс';
    const far = dist > this.todDist() + 20000;
    if (c.gear && this.h > 25 && this.vs > 0 && dist > 50000) return 'Уберите шасси (кнопка ШАССИ)';
    if (!c.apOn && this.h > 150 && dist > 50000) return 'Включите автопилот (А/П) и выберите высоту ВЫС ±';
    if (c.flaps > 0 && dist > 50000 && this.h > 500) return 'Уберите закрылки (ЗАКР −)';
    if (far) {
      const w = this.allowedWarp();
      if (w > 1 && c.warp <= 1) return 'Нажмите ×' + w + ' — ускорить время';
      return c.apOn ? 'Набор высоты / крейсерский полёт' : 'Включите автопилот (А/П)';
    }
    if (!this.assist.auto) {
      if (dist > 46000 && c.apAlt > APPR_ALT && dist < this.todDist() + 6000) return 'Пора снижаться: высота автопилота — ' + APPR_ALT + ' м';
    }
    if (dist < 46000 && dist > 3000) {
      if (!c.appr) return 'Нажмите ПОСАДКА — автопилот поймает глиссаду';
      if (!this.apprCap) return c.apAlt > APPR_ALT ? 'Установите высоту ' + APPR_ALT + ' м' : 'Ждём захвата глиссады';
      if (dist < 17000 && c.flaps < 4) return 'Закрылки ПОЛН';
      if (dist < 26000 && !c.gear) return 'Выпустите шасси';
      if (dist < 26000 && c.flaps < 3) return 'Закрылки 3';
      if (dist < 34000 && c.flaps < 2) return 'Закрылки 2';
      if (dist < 42000 && c.flaps < 1) return 'Закрылки 1';
      return 'Снижаемся по глиссаде';
    }
    return '';
  }
}

// ---------- расчёт итогов рейса ----------
export function loadInfo(p, c, fuel, cg) {
  const mass = p.oew + c.pax * PAX_KG + fuel, vs = stallIAS(mass, 2, p.S), k = 1 + (0.25 - cg) * 0.5;
  return { mass, over: mass > p.mtow, v1: Math.round(vs * 1.1 * k * 3.6), vr: Math.round(vs * 1.15 * k * 3.6), v2: Math.round(vs * 1.22 * k * 3.6) };
}
export function settle(f, contract, career) {
  career = career || {};
  const p = f.p, km = f.distM / 1000;
  const fuelUsed = f.fuel0 - f.fuel;
  const res = f.result || { kind: 'abort', reason: '' };
  const out = { kind: res.kind, reason: res.reason, km, pax: f.pax, fuelUsed, lines: [], quality: '', stars: 0 };
  const fuelCost = Math.round(fuelUsed * FUEL_PRICE);
  const ops = Math.round(km * p.opPerKm);
  const fee = Math.round(1200 * p.mtow / 1000);
  let revenue = 0, repair = 0, mult = 1;
  if (res.kind === 'ok') {
    const s = f.td.sink;
    let q, mq, st;
    if (s <= 0.9) { q = 'Мастерская посадка'; mq = 1.2; st = 5; }
    else if (s <= 1.6) { q = 'Отличная посадка'; mq = 1.1; st = 5; }
    else if (s <= 2.4) { q = 'Хорошая посадка'; mq = 1.0; st = 4; }
    else if (s <= 3.4) { q = 'Жёсткая посадка'; mq = 0.8; st = 3; repair = Math.round(p.value * 0.01); }
    else { q = 'Очень жёсткая посадка'; mq = 0.55; st = 2; repair = Math.round(p.value * 0.04); }
    const pen = Math.min(0.5, f.incidents.reduce((a, i) => a + i.weight, 0) / 100);
    st = Math.max(1, st - Math.floor(pen * 8));
    let bonus = 0;
    if (!f.assist.auto) bonus += 0.25;
    if (!f.assist.config) bonus += 0.10;
    const evOk = f.evLog.filter(e => e.outcome === 'ok').length, evLate = f.evLog.filter(e => e.outcome === 'late').length;
    const evB = Math.min(0.35, evOk * 0.12 + evLate * 0.04);
    out.evBonus = evB;
    const expMin = km / 12.5 + (f.taxiOps ? 30 : 12), tm = f.simTime / 60;
    const sched = tm <= expMin ? 0.06 : tm > expMin * 1.4 ? -0.08 : 0;
    out.sched = sched; out.tm = tm; out.expMin = expMin;
    const repM = 0.9 + (career.rep == null ? 50 : career.rep) / 500;
    out.repM = repM;
    revenue = Math.round(contract.revenue * mq * (1 - pen * (career.copilot ? 0.75 : 1)) * (1 + bonus + evB + sched) * repM * (f.diverted ? 0.4 : 1));
    if (career.copilot) out.coFee = Math.round(revenue * 0.06);
    out.diverted = !!f.diverted;
    out.quality = q; out.sink = s; out.stars = st; out.pen = pen; out.bonus = bonus; out.mq = mq;
  } else if (res.kind === 'crash') {
    repair = Math.round(p.value * 0.15);
  } else if (res.kind === 'overrun') {
    revenue = Math.round(contract.revenue * 0.4); repair = Math.round(p.value * 0.02);
  } else if (res.kind === 'forced' || res.kind === 'missed') {
    revenue = 0;
  }
  out.evLog = f.evLog;
  const evOkN = f.evLog.filter(e => e.outcome === 'ok').length, evLateN = f.evLog.filter(e => e.outcome === 'late').length, evFailN = f.evLog.filter(e => e.outcome === 'fail').length;
  out.evOk = evOkN; out.evLate = evLateN; out.evFail = evFailN;
  out.xp = res.kind === 'ok' ? Math.round(20 + out.stars * 12 + 80 * evOkN + 25 * evLateN + Math.min(60, km / 15)) : (res.kind === 'abort' && evOkN ? 60 : 0);
  out.revenue = revenue; out.fuelCost = fuelCost; out.ops = ops; out.fee = fee; out.repair = repair;
  if (res.kind === 'abort') { out.fuelCost = 0; out.ops = 0; out.fee = 0; out.net = evOkN ? Math.round(contract.revenue * 0.08) : 0; out.evPrem = out.net; }
  else if (res.kind === 'crash') { out.ops = 0; out.fee = 0; out.fuelCost = 0; out.net = -repair; }
  else out.net = revenue - fuelCost - ops - fee - repair - (out.coFee || 0);
  return out;
}
