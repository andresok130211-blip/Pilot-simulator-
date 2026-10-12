// Физика полёта: продольная модель материальной точки с аэродинамикой, тягой, топливом.
// Вся логика без графики — её можно гонять в node (см. tools/bot.mjs).
import { PAX_KG, FUEL_PRICE } from './data.js';

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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerpTab = (tab, f) => {
  const i = Math.min(tab.length - 2, Math.max(0, Math.floor(f)));
  return tab[i] + (tab[i + 1] - tab[i]) * (f - i);
};

export function atmos(h) {
  let T, rho;
  if (h < 11000) { T = 288.15 - 0.0065 * h; rho = 1.225 * Math.pow(T / 288.15, 4.2559); }
  else { T = 216.65; rho = 0.3639 * Math.exp(-(h - 11000) / 6341.6); }
  return { T, rho, a: Math.sqrt(1.4 * 287.05 * T), sigma: rho / 1.225 };
}
export const clmaxCfg = f => CL0 + FLAP_DCL[f] + CLA * FLAP_AS[f];
export const stallIAS = (m, f, S) => Math.sqrt(2 * m * G / (1.225 * S * clmaxCfg(f)));
export const glideH = (distToTouch) => Math.max(0, distToTouch) * GS_TAN;

export class Flight {
  constructor(o) {
    this.p = o.plane;
    this.fromAp = o.from; this.toAp = o.to;
    this.distM = o.distM;
    this.D = o.distM; // порог ВПП назначения
    this.rwy0 = { s: 0, e: o.from.rwy };
    this.rwy1 = { s: this.D, e: this.D + o.to.rwy };
    this.elev = o.from.elev;
    this.pax = o.pax;
    this.payload = o.pax * PAX_KG;
    this.fuel = o.fuelKg; this.fuel0 = o.fuelKg;
    this.K = 1 / (Math.PI * this.p.e * this.p.ar);
    this.assist = Object.assign({ auto: true, config: true, hints: true }, o.assist || {});
    this.tod = o.tod || 0; // 0 день, 1 сумерки, 2 ночь
    this.recAlt = o.recAlt || 9600;

    this.yPos = 0; this.psi = 0; this.phi = 0; this.brg = o.bearing || 0; // боковое смещение, курс и крен относительно оси ВПП
    this.x = 40; this.h = 0; this.v = 0; this.gamma = 0; this.theta = 0;
    this.thrAct = 0; this.gearPos = 1; this.flapAct = 2;
    this.onGround = true; this.airborneOnce = false;
    this.time = 0; this.simTime = 0; this.acc = 0;
    this.c = { stick: 0, thr: 0, gear: true, flaps: 2, brake: true, apOn: false, apAlt: 1500, appr: false, atOn: false, warp: 1, roll: 0, nav: true };
    this.apprCap = false; this.vsCmdS = 0; this.gHold = null;
    this.td = null; this.done = false; this.result = null;
    this.warnings = new Set(); this.incidents = []; this.msgs = [];
    this.stats = { maxG: 1, stallT: 0, overT: 0, gpws: 0, tail: false };
    this.autoDescDone = false; this.autoEngaged = false;
    this.cfgTimer = 0; this.flapMsgT = 0; this.maxV = 0;
    this._cooldown = {};
    this.updateMass();
    this.computeSpeeds();
    this.aero(); // начальные величины
  }

  updateMass() { this.mass = this.p.oew + this.payload + this.fuel; }
  computeSpeeds() {
    const vs = stallIAS(this.mass, 2, this.p.S);
    this.vr = vs * 1.15; this.v1 = vs * 1.1; this.v2 = vs * 1.22;
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
  get heading() { return (((this.brg + this.psi / DEG) % 360) + 360) % 360; }
  get range() { return Math.hypot(this.D - this.x, this.yPos); }
  get ias() { return this.v * Math.sqrt(atmos(this.h + this.elev).sigma); }
  get vs() { return this.v * Math.sin(this.gamma); }
  get mach() { return this.v / atmos(this.h + this.elev).a; }
  get flapIdx() { return Math.round(this.flapAct); }

  aero() {
    const p = this.p, c = this.c;
    const A = atmos(this.h + this.elev);
    const v = this.v;
    this.A = A;
    const q = 0.5 * A.rho * v * v;
    const M = v / A.a;
    const dcl = lerpTab(FLAP_DCL, this.flapAct), cdf = lerpTab(FLAP_CD, this.flapAct), as = lerpTab(FLAP_AS, this.flapAct);
    const alpha = this.onGround ? this.theta : this.theta - this.gamma;
    let CL;
    if (alpha <= as) CL = CL0 + dcl + CLA * alpha;
    else CL = Math.max(0.35, CL0 + dcl + CLA * as - 6 * (alpha - as));
    const spoil = c.brake;
    if (spoil) CL *= this.onGround ? 0.35 : 0.92;
    const CD = p.cd0 + cdf + 0.022 * this.gearPos + (spoil && !this.onGround ? 0.03 : 0) + (this.onGround && spoil ? 0.05 : 0)
      + this.K * CL * CL + (M > p.cruiseM - 0.01 ? 12 * (M - p.cruiseM + 0.01) ** 2 : 0);
    this.q = q; this.alpha = alpha; this.alphaS = as; this.CL = CL; this.CD = CD;
    this.L = q * p.S * CL; this.Dr = q * p.S * CD;
    this.Tavail = this.fuel > 0 ? p.T0 * Math.pow(A.sigma, 0.85) * (1 - 0.35 * M) : 0;
    this.stallWarn = !this.onGround && alpha > as - 2.2 * DEG;
    this.stalled = !this.onGround && alpha > as;
    this.clmaxNow = CL0 + dcl + CLA * as;
  }

  // ---------- автоматика ----------
  setFlaps(n) {
    const c = this.c;
    n = clamp(n, 0, 4);
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
    if (!down) { if (this.onGround) return false; }
    else if (this.ias > this.p.gearLim) { this.msg('Шасси: слишком быстро (≤ ' + Math.round(this.p.gearLim * 3.6) + ' км/ч)'); return false; }
    c.gear = down; return true;
  }

  todDist() {
    const h = Math.max(this.c.apAlt > 3000 ? this.h : 3000, 3000);
    const d1 = (h - 3000) / 9 * 190;
    return d1 + 38000 + 29000 + 14000;
  }

  atTargetIAS() {
    const p = this.p, c = this.c, A = this.A;
    const f = c.flaps;
    const m = this.mass;
    if (c.gear && f >= 3) return 1.24 * stallIAS(m, f, p.S) + 3;
    let sched = this.h < 3000 ? 128 : 154;
    const machIAS = p.cruiseM * A.a * Math.sqrt(A.sigma);
    sched = Math.min(sched, machIAS);
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
      vsCmd = -v * Math.sin(GS_DEG * DEG) - 0.12 * dev;
      if (this.h < FLARE_H && this.c.gear) vsCmd = -(0.4 + 0.25 * this.h);
      vsCmd = clamp(vsCmd, -9, 3);
      this.dev = dev;
    } else {
      const err = c.apAlt - this.h;
      vsCmd = clamp(0.12 * err, -10, 13);
      if (vsCmd > 0) {
        const vsCap = (this.Tavail - this.Dr) * v / (this.mass * G);
        vsCmd = Math.min(vsCmd, Math.max(0, 0.85 * vsCap));
        const vmin = 1.18 * stallIAS(this.mass, c.flaps, this.p.S);
        vsCmd = Math.min(vsCmd, Math.max(0, (this.ias - vmin) * 0.6));
        if (this.h + this.elev > this.p.ceiling - 200) vsCmd = Math.min(vsCmd, 0);
      } else if (vsCmd < 0) {
        const tIdle = this.Tavail * IDLE;
        const vsIdle = (tIdle - this.Dr) * v / (this.mass * G);
        if (this.ias > this.atTargetIAS() + 3) vsCmd = Math.max(vsCmd, vsIdle * 0.85);
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
    const A = this.A, v = this.v, m = this.mass;
    const ias = this.ias;
    const dist = this.dist;

    // актуаторы
    this.gearPos += clamp((c.gear ? 1 : 0) - this.gearPos, -dt / 7, dt / 7);
    this.flapAct += clamp(c.flaps - this.flapAct, -dt * 0.35, dt * 0.35);

    // помощник: автоматика конфигурации и снижения
    if (!this.onGround) {
      if (this.assist.auto && !this.autoEngaged && this.h > 200 && !c.gear && ias > 1.18 * stallIAS(m, c.flaps, p.S)) {
        c.apOn = true; c.atOn = true; c.nav = true; c.apAlt = this.recAlt; this.autoEngaged = true;
        this.msg('Автопилот включён');
      }
      if (this.assist.auto && c.apOn && !this.autoDescDone && dist < this.todDist() && c.apAlt > APPR_ALT) {
        c.apAlt = APPR_ALT; this.autoDescDone = true; this.msg('Начинаем снижение');
      }
      if (this.assist.auto && c.apOn && dist < 46000 && !c.appr && this.autoDescDone) { c.appr = true; }
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
    // тяга
    const spoolUp = 0.4, spoolDn = 0.6;
    this.thrAct += clamp(c.thr - this.thrAct, -spoolDn * dt, spoolUp * dt);
    const T = this.Tavail * (IDLE + (1 - IDLE) * this.thrAct);
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
        if (dist > 30000) psiC = Math.atan2(-this.yPos, aim);
        else psiC = clamp(-this.yPos * 0.0015, -20 * DEG, 20 * DEG);
        phiT = clamp(2.5 * wrapPi(psiC - this.psi), -25 * DEG, 25 * DEG);
      }
      this.phi += clamp(phiT - this.phi, -5 * DEG * dt, 5 * DEG * dt);
      this.phi = clamp(this.phi, -35 * DEG, 35 * DEG);
    } else this.phi = 0;

    // топливо
    const flow = 1.6e-5 * T;
    this.fuel = Math.max(0, this.fuel - flow * dt);
    if (this.fuel <= 0 && this.Tavail === 0 && !this.warnings.has('fuel0')) { this.warnings.add('fuel0'); this.msg('Топливо закончилось!'); }

    if (this.onGround) this.stepGround(dt, T);
    else this.stepAir(dt, T);

    // предупреждения
    this.updateWarnings(dt);
  }

  stepGround(dt, T) {
    const c = this.c, W = this.mass * G;
    const N = Math.max(0, W - this.L);
    const onRwy = this.onRunway(this.x);
    let mu = onRwy ? 0.02 : 0.15;
    if (this.gearPos < 0.9) mu = 0.5;
    if (c.brake) mu += onRwy ? 0.30 : 0.2;
    let F = T - this.Dr - mu * N;
    if (this.v < 0.3 && F <= 0) { this.v = 0; }
    else {
      this.v += F / this.mass * dt;
      if (this.v < 0) this.v = 0;
    }
    const steer = c.roll || 0;
    if (this.v > 1) {
      if (Math.abs(steer) > 0.04) this.psi += steer * 0.25 * Math.min(1, 25 / Math.max(this.v, 5)) * dt;
      else this.psi -= this.psi * 0.6 * dt;
    }
    this.psi = wrapPi(this.psi);
    this.x += this.v * Math.cos(this.psi) * dt;
    this.yPos += this.v * Math.sin(this.psi) * dt;
    this.gamma = 0; this.h = 0;
    // отрыв
    if (!this.td && this.v > 25 && this.L >= W && this.theta > 1.5 * DEG && this.gearPos > 0.5) {
      this.onGround = false; this.airborneOnce = true; this.gamma = 0.0; this.h = 0.05;
      this.msg('Отрыв! Скорость ' + Math.round(this.ias * 3.6) + ' км/ч');
      return;
    }
    // заход в траву
    if (!onRwy && this.v > 30 && !this.td && (this.x > this.rwy0.e || Math.abs(this.yPos) > 32)) { this.finish('crash', Math.abs(this.yPos) > 32 ? 'Самолёт выкатился с боковой стороны полосы при взлёте.' : 'Самолёт выкатился за конец полосы при взлёте.'); return; }
    if (!onRwy && this.td && this.v > 25) { this.finish('crash', Math.abs(this.yPos) > 32 ? 'Самолёт выкатился с боковой стороны полосы.' : this.x > this.rwy1.e ? 'Самолёт выкатился за пределы полосы на большой скорости.' : 'Посадка вне полосы на большой скорости.'); return; }
    // автотормоз
    if (this.td && this.assist.auto && this.v > 8) { c.brake = true; c.thr = 0; c.atOn = false; }
    // конец пробега
    if (this.v > this.maxV) this.maxV = this.v;
    if (this.td && this.v < 0.6 && this.time - this.td.t > 2) {
      const onDest = this.x >= this.rwy1.s - 20 && this.x <= this.rwy1.e + 20 && Math.abs(this.yPos) <= 35;
      if (this.x > this.rwy1.e) this.finish('overrun', 'Самолёт остановился за пределами полосы.');
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
    if (this.v > 20) this.psi = wrapPi(this.psi + G * Math.tan(this.phi) / this.v * dt);
    this.v = Math.max(5, this.v + dv);
    this.gamma = clamp(this.gamma + dg, -1.2, 1.2);
    this.x += this.v * Math.cos(this.gamma) * Math.cos(this.psi) * dt;
    this.yPos += this.v * Math.cos(this.gamma) * Math.sin(this.psi) * dt;
    this.h += this.v * Math.sin(this.gamma) * dt;
    // перегрузка
    const n = this.L / (m * G);
    this.nz = n;
    if (n > this.stats.maxG) this.stats.maxG = n;
    if (this.h <= 0 && this.gamma <= 0.02) this.touchdown();
    else if (this.h < 0) this.h = 0;
    // пролетели
    if (!this.done && this.x > this.rwy1.e + 20000 && Math.hypot(this.x - this.D, this.yPos) > 40000) this.finish('missed', 'Вы пролетели аэропорт назначения.');
    if (!this.done && Math.abs(this.yPos) > 70000) this.finish('missed', 'Вы слишком далеко ушли от маршрута.');
  }

  touchdown() {
    const sink = -this.v * Math.sin(this.gamma);
    const tdx = this.x;
    this.h = 0;
    const lat = Math.abs(this.yPos);
    const onDest = tdx >= this.rwy1.s - 10 && tdx <= this.rwy1.e && lat <= 32;
    const onOrig = tdx >= this.rwy0.s && tdx <= this.rwy0.e && lat <= 32;
    const ias = this.ias;
    if (this.gearPos < 0.85) { this.finish('crash', 'Посадка с невыпущенным шасси.'); return; }
    if (!onDest && !onOrig && this.v > 35) {
      this.finish('crash', lat > 32 ? 'Приземление рядом с полосой: слишком большое боковое отклонение.' : tdx < this.rwy1.s ? 'Недолёт: самолёт приземлился до полосы.' : 'Приземление за пределами полосы.');
      return;
    }
    if (Math.abs(this.phi) > 12 * DEG) { this.finish('crash', 'Касание крылом: слишком большой крен при посадке.'); return; }
    if (Math.abs(this.psi) > 12 * DEG) { this.finish('crash', 'Боковой снос: самолёт приземлился не вдоль полосы.'); return; }
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
    set('flaps', !this.onGround && this.h < 250 && this.dist < 6000 && this.dist > 0 && this.c.flaps < 3 && this.c.gear);
    set('lowfuel', this.fuel < this.p.burnHr * 0.3 && this.fuel > 0);
    if (w.has('sink') || w.has('pullup')) { this.stats.gpws += dt; this.incident('sink', 'Опасная скорость снижения', 3, 30); }
    if (this.fuel <= 0 && this.Tavail === 0) set('fuel0', true);
  }

  finish(kind, reason) {
    if (this.done) return;
    this.done = true;
    this.result = { kind, reason };
    this.c.brake = true;
  }

  // ---------- ускорение времени ----------
  allowedWarp() {
    const c = this.c;
    if (!c.apOn || !c.atOn || this.onGround || this.warnings.size) return 1;
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

  // ---------- подсказки ----------
  hint() {
    const c = this.c, dist = this.dist, kmh = x => Math.round(x * 3.6);
    if (this.done) return '';
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
export function settle(f, contract) {
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
    revenue = Math.round(contract.revenue * mq * (1 - pen) * (1 + bonus));
    out.quality = q; out.sink = s; out.stars = st; out.pen = pen; out.bonus = bonus; out.mq = mq;
  } else if (res.kind === 'crash') {
    repair = Math.round(p.value * 0.15);
  } else if (res.kind === 'overrun') {
    revenue = Math.round(contract.revenue * 0.4); repair = Math.round(p.value * 0.02);
  } else if (res.kind === 'forced' || res.kind === 'missed') {
    revenue = 0;
  }
  out.revenue = revenue; out.fuelCost = fuelCost; out.ops = ops; out.fee = fee; out.repair = repair;
  if (res.kind === 'abort') { out.fuelCost = 0; out.ops = 0; out.fee = 0; out.net = 0; }
  else if (res.kind === 'crash') { out.ops = 0; out.fee = 0; out.fuelCost = 0; out.net = -repair; }
  else out.net = revenue - fuelCost - ops - fee - repair;
  return out;
}
