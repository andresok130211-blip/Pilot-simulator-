// Автопилот-бот: проверяет, что рейс проходим (взлёт → набор → крейсер → снижение → посадка).
import { PL_BY, AP_BY, bearing, distKm, tripFuel, makeContract, recommendedCruise, PAX_KG } from '../src/js/data.js';
import { Flight, settle, DEG } from '../src/js/sim.js';

export function fly(planeId, fromId, toId, opts = {}) {
  const plane = PL_BY[planeId], from = AP_BY[fromId], to = AP_BY[toId];
  const km = distKm(from, to);
  const c0 = makeContract(plane, from, to, () => opts.load ?? 0.9);
  const f = new Flight({ plane, from, to, bearing: bearing(from, to), distM: km * 1000, pax: c0.pax, fuelKg: c0.fuel, assist: opts.assist || { auto: true, config: true }, recAlt: recommendedCruise(km) });
  const c = f.c;
  const dt = 1 / 60;
  let t = 0, phase = 'roll', log = [];
  const L = (s) => log.push(`t=${t.toFixed(0)} x=${(f.x / 1000).toFixed(1)}km h=${f.h.toFixed(0)} ias=${(f.ias * 3.6).toFixed(0)} ${s}`);
  c.brake = false; c.thr = 1;
  let guard = 0;
  let wantWarp = opts.warp ?? 32;
  while (!f.done && t < 14 * 3600 && guard++ < 5e7) {
    if (opts.y0 && f.h > 300 && !opts._y) { f.yPos = opts.y0; opts._y = 1; }
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
    if (f.td) { c.brake = true; c.thr = 0; c.atOn = false; c.stick = 0; }
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
