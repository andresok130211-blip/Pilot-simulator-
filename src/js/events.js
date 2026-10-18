// Аварийные ситуации (ЧП): сценарии, расписание срабатывания и чек-листы действий пилота.
// Модуль не зависит от sim.js: всё нужное берёт из объекта полёта f.
const kmh = x => Math.round(x * 3.6);
const FL = ['0', '1', '2', '3', 'ПОЛН'];

// ---------- фазы полёта и случайные пороги ----------
function phaseSpec(ph, r) {
  switch (ph) {
    case 'roll': return { ph, k: 0.74 + r() * 0.13 };
    case 'low': return { ph, h: 70 + r() * 200 };
    case 'climb': return { ph, h: 450 + r() * 1100 };
    case 'cruise': return { ph, u: 0.3 + r() * 0.28 };
    case 'descent': return { ph, d: 40000 + r() * 22000 };
    case 'final': return { ph, d: 4300 + r() * 2300 };
  }
  return { ph };
}
// «сейчас» — для тренажёра: срабатывает сразу, как только фаза подходит
function nowSpec(ph) {
  switch (ph) {
    case 'roll': return { ph, k: 0.74, t: 4 };
    case 'low': return { ph, h: 20, t: 2 };
    case 'climb': return { ph, h: -1, t: 6 };
    case 'cruise': return { ph, u: -1, t: 6 };
    case 'descent': return { ph, d: 52000, t: 6 };
    case 'final': return { ph, d: 6500, t: 5 };
  }
  return { ph, t: 5 };
}
function phaseOk(f, s) {
  if (f.done || f.time < (s.t || 0)) return false;
  if (s.ph === 'roll') return f.onGround && !f.td && !f.airborneOnce && f.ias > 25 && f.c.thr > 0.8 && f.ias >= s.k * f.vr;
  if (f.onGround || f.td || !f.airborneOnce || f.ga) return false;
  const u = f.x / f.D;
  switch (s.ph) {
    case 'low': return f.h > s.h && f.vs > 1 && f.h < 700 && u < 0.1;
    case 'climb': return f.h > s.h && u < 0.25 && f.dist > 60000;
    case 'cruise': return u > s.u && f.dist > 90000 && f.h > Math.min(2500, f.recAlt * 0.7);
    case 'descent': return f.dist < s.d && f.dist > 32000 && f.h > 1200;
    case 'final': return f.dist < s.d && f.dist > 1800 && f.h > 60 && f.h < 700;
  }
  return false;
}

// ---------- общие шаги ----------
const engOutSteps = f => {
  const lim = f.ceilLim || Math.round(f.p.ceiling * 0.6 / 100) * 100;
  const sp = f.minSpd();
  return [
    { t: 'Держите скорость не ниже ' + kmh(sp) + ' км/ч', done: f.ias > sp },
    { t: 'Потолок на одном двигателе — ' + lim + ' м' + (f.h > lim + 150 ? ' (снижайтесь, ВЫС −)' : ''), done: f.h <= lim + 150 },
  ];
};
const allDone = st => st.filter(s => !s.opt).every(s => s.done);
// накопление времени «всё выполнено»
function settled(f, ev, dt, need) {
  const st = EVENT_DEFS[ev.id].steps(f, ev);
  ev.okT = allDone(st) ? (ev.okT || 0) + dt : 0;
  return ev.okT > need;
}
const pickSide = f => (f.rnd() < 0.5 ? 0 : 1);

export const EVENT_DEFS = {
  engRoll: {
    title: 'ОТКАЗ ДВИГАТЕЛЯ НА РАЗБЕГЕ', short: 'Отказ двигателя на разбеге', phases: ['roll'], weight: 2, group: 'eng', spawn: 'roll',
    desc: 'На скорости, близкой к V1, отказывает двигатель. До V1 — прервать взлёт тормозом, после — взлетать, удерживая ось полосы.',
    ok: f => true,
    start(f, ev) {
      ev.side = pickSide(f); f.eng[ev.side] = 0;
      f.msg('ОТКАЗ ДВИГАТЕЛЯ №' + (ev.side + 1) + ' НА РАЗБЕГЕ!');
    },
    steps(f, ev) {
      if (f.airborneOnce) return [
        { t: 'Уберите шасси', done: !f.c.gear },
        { t: 'Держите скорость не ниже ' + kmh(f.minSpd()) + ' км/ч, набирайте высоту', done: f.h > 350 && f.ias > f.minSpd() },
      ];
      const before = f.ias < f.v1;
      return [
        before ? { t: 'ДО V1 (' + kmh(f.v1) + ' км/ч): газ 0 и ТОРМОЗ — прервать взлёт', done: false }
          : { t: 'ВЫШЕ V1: ПРОДОЛЖАЙТЕ взлёт — штурвал на себя на VR (' + kmh(f.vr) + ')', done: f.airborneOnce },
        { t: 'Держите ось полосы штурвалом влево/вправо', done: Math.abs(f.yPos) < 12 },
      ];
    },
    tick(f, ev, dt) {
      if (!f.airborneOnce && f.c.brake && f.v < 2 && f.maxV > 20) f.resolveEvent(ev, 'ok', 'Взлёт прерван — решение верное');
      else if (f.airborneOnce && f.h > 350 && !f.c.gear) f.resolveEvent(ev, 'ok', 'Взлёт на одном двигателе выполнен');
    },
  },

  engFail: {
    title: 'ОТКАЗ ДВИГАТЕЛЯ', short: 'Отказ двигателя в полёте', phases: ['climb', 'cruise', 'descent'], weight: 3, group: 'eng', spawn: 'cruise',
    desc: 'Один двигатель останавливается. Держите скорость, снижайтесь до потолка на одном двигателе и решайте: вернуться или лететь дальше.',
    ok: f => true,
    start(f, ev, o) {
      ev.side = o && o.side !== undefined ? o.side : pickSide(f); f.eng[ev.side] = 0;
      f.msg('ОТКАЗ ДВИГАТЕЛЯ №' + (ev.side + 1) + '!');
    },
    steps(f, ev) {
      return [...engOutSteps(f), { t: 'ЗАПАСНОЙ — можно сесть на ближайшем аэродроме: ' + f.altText(), done: f.diverted, opt: true }];
    },
    tick(f, ev, dt) {
      if (settled(f, ev, dt, 5)) f.resolveEvent(ev, f.time - ev.t0 > 150 ? 'late' : 'ok', 'Самолёт стабилизирован на одном двигателе');
    },
  },

  fire: {
    title: 'ПОЖАР ДВИГАТЕЛЯ', short: 'Пожар двигателя', phases: ['climb', 'cruise'], weight: 2, group: 'eng', spawn: 'cruise',
    desc: 'Горит двигатель. Нужно быстро нажать ТУШЕНИЕ, пока огонь не перекинулся на крыло, а потом лететь на одном двигателе.',
    ok: f => f.distM >= 250000,
    start(f, ev) {
      const side = pickSide(f); ev.side = side;
      f.fire = { side, t0: f.time, ext: false, spread: false };
      f.eng[side] = 0.55;
      f.msg('ПОЖАР ДВИГАТЕЛЯ №' + (side + 1) + '! Нажмите ТУШЕНИЕ');
    },
    steps(f, ev) {
      const fr = f.fire;
      const left = Math.max(0, Math.ceil(35 - (f.time - fr.t0)));
      const s = [{ t: fr.ext ? 'Двигатель №' + (fr.side + 1) + ' выключен, огонь потушен' : 'ТУШЕНИЕ — нажмите кнопку (осталось ' + left + ' с)', done: fr.ext }];
      if (fr.ext) { s.push(...engOutSteps(f)); s.push({ t: 'ЗАПАСНОЙ — можно сесть на ближайшем аэродроме: ' + f.altText(), done: f.diverted, opt: true }); }
      return s;
    },
    tick(f, ev, dt) {
      const fr = f.fire, age = f.time - fr.t0;
      if (!fr.ext) {
        if (age > 35 && !fr.spread) { fr.spread = true; f.msg('ОГОНЬ ПЕРЕКИНУЛСЯ НА КРЫЛО!'); f.incident('firelate', 'Пожар не потушен вовремя', 10, 999); }
        if (age > 60) { f.finish('crash', 'Пожар двигателя не потушен: самолёт потерян.'); }
      } else if (settled(f, ev, dt, 5)) f.resolveEvent(ev, fr.extAt - fr.t0 > 20 ? 'late' : 'ok', 'Пожар потушен, самолёт управляем');
    },
  },

  bird: {
    title: 'СТОЛКНОВЕНИЕ С ПТИЦАМИ', short: 'Птицы в двигатель', phases: ['low', 'final'], weight: 3, group: 'eng', spawn: 'climb',
    desc: 'Стая птиц попала в двигатель: тяга падает, иногда двигатель отказывает совсем. Держите скорость и готовьтесь к худшему.',
    ok: f => true,
    start(f, ev, o) {
      ev.side = o && o.side !== undefined ? o.side : pickSide(f); f.eng[ev.side] = 0.4;
      ev.esc = f.rnd() < 0.4 ? f.time + 15 + f.rnd() * 25 : null;
      if (ev.esc === null && o && o.forceEsc) ev.esc = f.time + 12;
      f.msg('ПТИЦЫ! Двигатель №' + (ev.side + 1) + ' повреждён — тяга снижена');
    },
    steps(f, ev) {
      return [
        { t: 'Двигатель №' + (ev.side + 1) + ' повреждён' + (ev.esc ? ': вибрация растёт, возможен отказ' : ': тяга снижена'), done: true },
        { t: 'Держите скорость не ниже ' + kmh(f.minSpd()) + ' км/ч' + (f.h < 300 ? ', наберите безопасную высоту' : ''), done: f.ias > f.minSpd() && (f.h > 300 || f.dist < 15000) },
      ];
    },
    tick(f, ev, dt) {
      if (ev.esc && f.time > ev.esc) {
        f.resolveEvent(ev, 'ok', 'Двигатель №' + (ev.side + 1) + ' отказал!');
        f.startEvent('engFail', { side: ev.side });
        return;
      }
      if (!ev.esc && f.time - ev.t0 > 20 && settled(f, ev, dt, 5)) f.resolveEvent(ev, 'ok', 'Двигатель держится, продолжаем');
    },
  },

  hyd: {
    title: 'ОТКАЗ ГИДРАВЛИКИ', short: 'Отказ гидравлики', phases: ['cruise', 'descent'], weight: 2, spawn: 'descent',
    desc: 'Закрылки заклинило, шасси не выпускается обычным способом, штурвал тяжёлый. Выпустите шасси кнопкой ЗАПАС. ШАССИ и садитесь на повышенной скорости.',
    ok: f => f.distM >= 400000,
    start(f, ev) {
      f.hyd = true;
      f.msg('ОТКАЗ ГИДРАВЛИКИ! Закрылки заклинило в положении ' + FL[f.c.flaps]);
    },
    steps(f, ev) {
      const gearOk = f.altGear && f.gearPos > 0.98;
      return [
        { t: 'Закрылки заклинило в положении ' + FL[f.c.flaps] + ' — посадочная скорость выше', done: true },
        { t: 'ЗАПАС. ШАССИ — выпустите вручную' + (f.altGear && !gearOk ? ' (выпускается…)' : !f.altGear && f.dist < 40000 ? ' — ПОРА!' : ''), done: gearOk },
      ];
    },
    tick(f, ev, dt) {
      if (f.altGear && f.gearPos > 0.98) f.resolveEvent(ev, f.dist > 12000 ? 'ok' : 'late', 'Шасси выпущено и зафиксировано');
    },
  },

  decomp: {
    title: 'РАЗГЕРМЕТИЗАЦИЯ', short: 'Разгерметизация салона', phases: ['cruise'], weight: 2, spawn: 'cruise',
    desc: 'Давление в салоне падает. Надо нажать АВАР. СНИЖ. и быстро спуститься ниже 3500 м, пока пассажиры не потеряли сознание.',
    ok: f => f.recAlt >= 7800,
    extra: f => f.h > 6500,
    start(f, ev) {
      f.decomp = { t0: f.time };
      ev.hiT = 0;
      f.msg('РАЗГЕРМЕТИЗАЦИЯ! Кислородные маски! АВАР. СНИЖЕНИЕ!');
    },
    steps(f, ev) {
      const left = Math.max(0, Math.ceil(30 - (f.time - ev.t0)));
      return [
        { t: f.emDescent ? 'Аварийное снижение начато' : 'АВАР. СНИЖ. — нажмите кнопку' + (left > 0 ? ' (' + left + ' с)' : ' — ПОЗДНО!'), done: f.emDescent },
        { t: 'Снизьтесь ниже 3500 м (сейчас ' + Math.round(f.h) + ' м)', done: f.h < 3500 },
      ];
    },
    tick(f, ev, dt) {
      const age = f.time - ev.t0;
      if (!f.emDescent && age > 30 && !ev.late) { ev.late = true; f.incident('decomp-late', 'Запоздалое аварийное снижение', 8, 999); }
      if (f.h > 4000) ev.hiT += dt;
      if (ev.hiT > 420) { f.finish('crash', 'Экипаж и пассажиры потеряли сознание от нехватки кислорода.'); return; }
      if (f.emDescent) { if (f.h > 3300) f.c.brake = true; else f.c.brake = false; }
      if (f.h < 3500) {
        f.emDescent = false; f.c.brake = false;
        f.recAlt = 3000; if (f.c.apAlt > 3000 && !f.autoDescDone) f.c.apAlt = 3000;
        f.resolveEvent(ev, ev.late || age > 330 ? 'late' : 'ok', 'Безопасная высота достигнута');
      }
    },
  },

  apFail: {
    title: 'ОТКАЗ АВТОПИЛОТА', short: 'Отказ автопилота', phases: ['climb', 'cruise', 'descent'], weight: 2, spawn: 'cruise',
    desc: 'Автопилот отключается на полторы минуты. Пилотируйте вручную: держите высоту и курс штурвалом.',
    ok: f => f.distM >= 400000,
    spec: (r, ph) => ph === 'descent' ? { ph, d: 64000 + r() * 18000 } : null,
    start(f, ev) {
      f.apLock = 90; f.msg('ОТКЛЮЧЕНИЕ АВТОПИЛОТА! Пилотируйте вручную');
      const c = f.c; c.apOn = false; c.appr = false; f.apprCap = false;
    },
    steps(f, ev) {
      return [
        { t: 'Пилотируйте вручную: высота ' + Math.round(f.c.apAlt) + ' м, держите курс на аэродром', done: false },
        { t: 'Автопилот снова доступен через ' + Math.ceil(Math.max(0, f.apLock)) + ' с', done: f.apLock <= 0 },
      ];
    },
    tick(f, ev, dt) {
      if (f.apLock <= 0) {
        f.resolveEvent(ev, 'ok', 'Автопилот восстановлен — можно включить А/П');
      }
    },
  },

  atFail: {
    title: 'ОТКАЗ АВТОМАТА ТЯГИ', short: 'Отказ автомата тяги', phases: ['climb', 'cruise', 'descent'], weight: 2, spawn: 'cruise',
    desc: 'Автомат тяги отключается на две минуты. Держите скорость сами — ползунком ГАЗ.',
    ok: f => f.distM >= 400000,
    spec: (r, ph) => ph === 'descent' ? { ph, d: 64000 + r() * 18000 } : null,
    start(f, ev) {
      f.atLock = 120; f.c.atOn = false;
      f.msg('ОТКАЗ АВТОМАТА ТЯГИ! Управляйте тягой вручную');
    },
    steps(f, ev) {
      const tgt = f.atTargetIAS();
      return [
        { t: 'Держите скорость ≈ ' + kmh(tgt) + ' км/ч ползунком ГАЗ (сейчас ' + kmh(f.ias) + ')', done: Math.abs(f.ias - tgt) < 12 },
        { t: 'Автомат тяги вернётся через ' + Math.ceil(Math.max(0, f.atLock)) + ' с', done: f.atLock <= 0 },
      ];
    },
    tick(f, ev, dt) {
      if (f.atLock <= 0) f.resolveEvent(ev, 'ok', 'Автомат тяги восстановлен');
    },
  },

  runway: {
    title: 'ПОЛОСА ЗАНЯТА', short: 'Препятствие на полосе', phases: ['final'], weight: 3, spawn: 'final',
    desc: 'Диспетчер сообщает: на полосе техника. Единственный верный ход — УХОД на второй круг и повторный заход.',
    ok: f => true,
    start(f, ev) {
      f.rwyBlocked = true;
      f.msg('ДИСПЕТЧЕР: НА ПОЛОСЕ ТЕХНИКА! УХОД НА ВТОРОЙ КРУГ!');
    },
    steps(f, ev) {
      return [
        { t: 'УХОД — нажмите кнопку (газ взлётный, шасси убираются)', done: !!f.ga || f.gaCount > 0 },
        { t: 'Наберите высоту — самолёт сам зайдёт на второй круг', done: f.gaCount > 0 && !f.ga },
      ];
    },
    tick(f, ev, dt) {
      if (f.ga || f.gaCount > 0) f.resolveEvent(ev, 'ok', 'Уход выполнен — молодец, полоса освободится');
      else if (f.time - ev.t0 > 160 && !f.td) { f.rwyBlocked = false; f.resolveEvent(ev, 'late', 'Полоса освободилась'); }
    },
  },
};

export const EVENT_IDS = Object.keys(EVENT_DEFS);

// запуск по расписанию: фаза + условие
export function evWhen(f, q) {
  const d = EVENT_DEFS[q.id];
  return phaseOk(f, q.spec) && (!d.extra || d.extra(f));
}

// расписание ЧП на рейс
export function planEvents(f, level, force, r, now) {
  const list = [];
  const mk = id => {
    const d = EVENT_DEFS[id];
    const ph = d.phases[Math.floor(r() * d.phases.length)];
    let spec = now ? nowSpec(ph) : (d.spec && d.spec(r, ph)) || phaseSpec(ph, r);
    if (now && d.spec) { const e = d.spec(r, ph); if (e && e.d) spec = { ...spec, d: 60000 }; }
    return { id, spec, fired: false };
  };
  if (force) { for (const id of [].concat(force)) if (EVENT_DEFS[id]) list.push(mk(id)); return list; }
  if (!level) return list;
  const P = [[0.65, 0.35, 0], [0.3, 0.5, 0.2], [0.05, 0.45, 0.5]][Math.min(3, level) - 1];
  const x = r();
  const n = x < P[0] ? 0 : x < P[0] + P[1] ? 1 : 2;
  const pool = EVENT_IDS.filter(id => EVENT_DEFS[id].ok(f));
  const chosen = [];
  for (let k = 0; k < n; k++) {
    const cands = pool.filter(id => !chosen.includes(id) && !(EVENT_DEFS[id].group && chosen.some(c => EVENT_DEFS[c].group === EVENT_DEFS[id].group)));
    if (!cands.length) break;
    const tot = cands.reduce((a, id) => a + EVENT_DEFS[id].weight, 0);
    let y = r() * tot, pick = cands[0];
    for (const id of cands) { y -= EVENT_DEFS[id].weight; if (y <= 0) { pick = id; break; } }
    chosen.push(pick);
  }
  return chosen.map(mk);
}
