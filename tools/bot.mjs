// Автопилот-бот: проверяет, что рейс проходим (взлёт → набор → крейсер → снижение → посадка).
import { PL_BY, AP_BY, bearing, distKm, tripFuel, makeContract, recommendedCruise, PAX_KG } from '../src/js/data.js';
import { Flight, settle, DEG } from '../src/js/sim.js';

export function fly(planeId, fromId, toId, opts = {}) {
  const plane = PL_BY[planeId], from = AP_BY[fromId], to = AP_BY[toId];
  const km = distKm(from, to);
  const c0 = makeContract(plane, from, to, () => opts.load ?? 0.9);
  const f = new Flight({ plane, from, to, bearing: bearing(from, to), taxi: opts.taxi !== false, distM: km * 1000, pax: c0.pax, fuelKg: Math.min(plane.fuelCap, c0.fuel + (opts.emerg || opts.force ? plane.burnHr * 0.25 : 0)), assist: Object.assign({ taxi: true }, opts.assist || { auto: true, config: true }), recAlt: recommendedCruise(km), force: opts.force, emerg: opts.emerg || 0, rnd: opts.rnd, wx: opts.wx });
  const c = f.c;
  const dt = 1 / 60;
  let t = 0, phase = 'roll', log = [];
  const L = (s) => log.push(`t=${t.toFixed(0)} x=${(f.x / 1000).toFixed(1)}km h=${f.h.toFixed(0)} ias=${(f.ias * 3.6).toFixed(0)} ${s}`);
  const taxi = opts.taxi !== false; let started = !taxi;
  if (!taxi) { c.brake = false; c.thr = 1; }
  let guard = 0;
  let wantWarp = opts.warp ?? 32;
  while (!f.done && !(opts.stopAtTd && f.td && f.td.onDest && f.v < 24) && t < 14 * 3600 && guard++ < 5e7) {
    if (opts.y0 && f.h > 300 && !opts._y) { f.yPos = opts.y0; opts._y = 1; }
    if (taxi && !started && f.lined && f.clrTo) { c.brake = false; c.thr = 1; started = true; }
    // управление
    if (f.onGround && !f.td) {
      if (f.ias >= f.vr) c.stick = Math.max(0, Math.min(1, (12 * DEG - f.theta) * 5));
      else c.stick = 0;
    } else if (!f.airborneOnce) c.stick = 0;
    else if (!f.autoEngaged && !c.apOn) {
      // ручной набор до включения автопилота
      c.stick = Math.max(-1, Math.min(1, (10 * DEG - f.theta) * 5));
      if (c.gear && f.h > 25 && f.vs > 0) f.setGear(false);
      if (f.h > 200 && !c.apOn && !f.assist.auto) { c.apOn = true; c.atOn = true; c.apAlt = recommendedCruise(km); f.autoEngaged = true; }
    } else c.stick = 0;
    if (f.airborneOnce && !f.assist.auto && c.apOn) {
      if (f.dist < f.todDist() && c.apAlt > 1500) c.apAlt = 1500;
      if (f.dist < 46000) c.appr = true;
    }
    if (!f.assist.config && f.airborneOnce) {
      if (c.gear && f.h > 25 && f.dist > 50000) f.setGear(false);
      if (f.dist > 50000 && f.h > 600 && c.flaps > 0 && f.ias > 100) c.flaps = 0;
      if (f.dist < 17000 && c.flaps < 4) f.setFlaps(4); else if (f.dist < 26000 && c.flaps < 3) f.setFlaps(3); else if (f.dist < 34000 && c.flaps < 2) f.setFlaps(2); else if (f.dist < 42000 && c.flaps < 1) f.setFlaps(1);
      if (f.dist < 26000 && !c.gear) f.setGear(true);
    }
    if (!f.assist.auto && f.airborneOnce && !c.apOn && !f.onGround && f.dist < 9000) {
      // ручная посадка: держим глиссаду по γ, у земли выравниваем
      const vsT = f.h > 14 ? -f.v * Math.sin(3 * DEG) - 0.1 * (f.h - (f.dist + 300) * Math.tan(3 * DEG)) : -(0.4 + 0.25 * f.h);
      c.stick = Math.max(-1, Math.min(1, (vsT - f.vs) * 0.35));
    }
    if (f.td) { if (!taxi || (f.v > 24 && !f.c.taxiAuto)) c.brake = true; c.thr = 0; c.atOn = false; c.stick = 0; }
    if (f.td && opts.rev && f.v > 14 && f.td.onDest) { c.rev = f.v > 30; c.thr = c.rev ? 0.6 : 0; }
    if (opts.divert && f.airborneOnce && !f.diverted && !f.onGround && f.x > f.D * opts.divert) { const a = f.altList().find(o => o.ok); if (a) { f.divertTo(a.w); opts._div = a.label; } }
    // ---- реакции на ЧП ----
    const ev = f.ev && f.ev.id, R = opts.react !== false;
    if (R && ev) {
      if (ev === 'fire' && !f.fire.ext && f.time - f.ev.t0 > (opts.delay ?? 6)) f.extinguish();
      if (ev === 'hyd' && !f.altGear && f.time - f.ev.t0 > (opts.delay ?? 6)) f.altGearExt();
      if (ev === 'decomp' && !f.emDescent && f.time - f.ev.t0 > (opts.delay ?? 6)) f.emergDescent();
      if (ev === 'runway' && !f.ga && f.canGoAround()) f.goAround();
      if (ev === 'engRoll' && !f.airborneOnce && opts.reject && f.ias < f.v1) { c.thr = 0; c.brake = true; }
      const age = f.time - f.ev.t0, d0 = opts.delay ?? 6, E = f.ev;
      if (ev === 'rto' && !f.airborneOnce && f.ias < f.v1) { c.thr = c.t1 = c.t2 = 0; c.split = false; c.brake = true; }
      if (ev === 'surge' && age > d0) { if (!c.split) { c.t1 = c.t2 = c.thr; c.split = true; } if (E.side) c.t2 = 0.2; else c.t1 = 0.2; }
      if (ev === 'fuelLeak' && !f.xfeed && age > d0) f.evAction('xfeed');
      if (ev === 'gearStuck' && !f.altGear && age > d0) f.altGearExt();
      if (ev === 'gen' && age > d0) f.evAction('apu');
      if (ev === 'adc' && age > d0) f.evAction('stby');
      if (ev === 'indic' && age > d0) f.evAction('chk');
      if (ev === 'turb' && age > d0) f.evAction('belts');
      if (ev === 'storm' && age > d0) { f.evAction('belts'); f.evAction('avoid'); }
      if (ev === 'ice' && age > d0) f.evAction('anti');
      if (ev === 'cabinFire' && age > d0) f.evAction('ext');
      if (ev === 'medical' && age > d0) f.evAction('doc');
      if (ev === 'unruly' && age > d0) { f.evAction('door'); f.evAction('alarm'); }
      if (ev === 'gps' && age > d0) f.evAction('vor');
      if (ev === 'rwyChg' && age > d0) f.evAction('ack');
      if (ev === 'tcas' && age > 4 && !E.bot) { E.bot = 1; c.apOn = true; c.apAlt = Math.max(300, f.h + E.ra * 500); }
      if ((ev === 'wshear' || ev === 'goAr') && !f.ga && f.canGoAround()) f.goAround();
      if (ev === 'fog' && !f.ga && f.h < 75 && f.canGoAround()) f.goAround();
      if (E.needDiv && !f.diverted && age > d0 && !f.onGround) { const a = f.altList().find(o => o.ok); if (a) f.divertTo(a.w); }
      if (ev === 'noRetract' && !f.diverted && age > d0) { const a = f.altList().find(o => o.ok); if (a) f.divertTo(a.w); }
    }
    if (f.onGround && f.v > 5 && (f.eng.some(x => x < 1) || (f.wx && f.wx.spd > 1))) c.roll = Math.max(-1, Math.min(1, -f.yPos * 0.06 - f.psi * 3));
    else if (f.onGround && !f.td) c.roll = 0;
    if (opts._locked && f.apLock <= 0 && f.atLock <= 0 && !f.assist.auto && !f.td) { opts._locked = false; c.apOn = true; c.atOn = true; c.nav = true; }
    if (f.apLock > 0 || f.atLock > 0) opts._locked = true;
    if (f.apLock > 0 && !f.onGround) {
      const tgt = Math.min(c.apAlt, f.dist < f.todDist() ? 1500 : 1e9);
      const vsT = Math.max(-8, Math.min(8, (tgt - f.h) * 0.05));
      c.stick = Math.max(-1, Math.min(1, (vsT - f.vs) * 0.3));
      c.roll = Math.max(-1, Math.min(1, (-f.yPos * 0.002 - f.psi) * 2));
      if (f.dist < 46000 && f.h < 3200) { c.atOn = false; }
    } else if (!f.onGround && f.airborneOnce && !f.td && !f.ga && f.atLock <= 0) c.roll = 0;
    if (f.atLock > 0 && !f.onGround) {
      const tgt = f.atTargetIAS();
      c.thr = Math.max(0, Math.min(1, c.thr + (tgt - f.ias) * 0.0006));
    }
    if (f.ga && f.apLock <= 0) { c.stick = 0; c.roll = 0; }
    if (opts.onStep) opts.onStep(f);
    c.warp = wantWarp;
    const w = f.effectiveWarp();
    for (let i = 0; i < w && !f.done; i++) { f.step(dt); t += dt; }
    if (Math.floor(t) % 60 === 0 && Math.floor(t) !== opts._lt) { opts._lt = Math.floor(t); L(`vs=${f.vs.toFixed(1)} thr=${c.thr.toFixed(2)} fuel=${f.fuel.toFixed(0)} w=${w} cap=${f.apprCap} fl=${c.flaps}`); }
  }
  const r = settle(f, c0);
  return { f, r, log, t, c0 };
}

if (process.argv[1].endsWith('bot.mjs')) {
  const [pl = 'a320', a = 'SVO', b = 'LED'] = process.argv.slice(2);
  const { f, r, log, t } = fly(pl, a, b, { y0: +process.env.Y0 || 0, assist: { auto: process.env.MANUAL ? false : true, config: process.env.MANUAL ? false : true } });
  if (process.env.V) console.log(log.join('\n'));
  console.log(pl, a, b, 'flight time', (t / 60).toFixed(1), 'min  result', f.result, 'td', f.td && { sink: f.td.sink.toFixed(2), v: (f.td.ias * 3.6).toFixed(0), pitch: f.td.pitch.toFixed(1), past: f.td.past.toFixed(0) }, 'stop at', ((f.x - f.D)).toFixed(0), 'incidents', f.incidents.map(i => i.text), 'net', r.net, 'fuelUsed', r.fuelUsed.toFixed(0));
}
