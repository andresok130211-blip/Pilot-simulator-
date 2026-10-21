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
const surgeLev = (f, i) => f.c.split ? (i ? f.c.t2 : f.c.t1) : f.c.thr;
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
    close(f, ev, kind, out) { return kind === 'abort' ? 'ok' : out; },
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
    title: 'ОТКАЗ ГИДРАВЛИКИ', short: 'Отказ гидравлики', phases: ['cruise', 'descent'], weight: 2, group: 'cfg', spawn: 'descent',
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
    title: 'РАЗГЕРМЕТИЗАЦИЯ', short: 'Разгерметизация салона', phases: ['cruise'], weight: 2, group: 'pax', spawn: 'cruise',
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
    title: 'ОТКАЗ АВТОПИЛОТА', short: 'Отказ автопилота', phases: ['climb', 'cruise', 'descent'], weight: 2, group: 'ctl', spawn: 'cruise',
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
    title: 'ОТКАЗ АВТОМАТА ТЯГИ', short: 'Отказ автомата тяги', phases: ['climb', 'cruise', 'descent'], weight: 2, group: 'ctl', spawn: 'cruise',
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
    title: 'ПОЛОСА ЗАНЯТА', short: 'Препятствие на полосе', phases: ['final'], weight: 3, group: 'land', spawn: 'final',
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
  // ======================= новые происшествия =======================
  surge: {
    title: 'ПОМПАЖ ДВИГАТЕЛЯ', short: 'Помпаж двигателя', phases: ['climb', 'cruise'], weight: 2, group: 'eng', spawn: 'cruise',
    desc: 'Двигатель хлопает, тяга скачет. Убавьте газ именно этого двигателя (рычаги раздельно) до малого — иначе он разрушится и откажет.',
    ok: f => f.distM >= 250000,
    start(f, ev, o) {
      ev.side = o && o.side !== undefined ? o.side : pickSide(f);
      f.atLock = Math.max(f.atLock, 300); f.c.atOn = false;
      f.msg('ПОМПАЖ ДВИГАТЕЛЯ №' + (ev.side + 1) + '! Убавьте его газ');
    },
    steps(f, ev) {
      const lev = surgeLev(f, ev.side);
      return [
        { t: 'Убавьте газ двигателя №' + (ev.side + 1) + ' ниже 35% (рычаги РАЗДЕЛЬНО, сейчас ' + Math.round(lev * 100) + '%)', done: !!ev.fixed || lev < 0.35 },
        { t: 'Держите малый газ ещё ' + Math.max(0, Math.ceil(4 - (ev.lowT || 0))) + ' с', done: !!ev.fixed },
      ];
    },
    alert: (f, ev) => ev.fixed ? null : 'ПОМПАЖ ДВ' + (ev.side + 1),
    tick(f, ev, dt) {
      const i = ev.side, age = f.time - ev.t0;
      ev.low = surgeLev(f, i) < 0.35;
      ev.lowT = ev.low ? (ev.lowT || 0) + dt : 0;
      if (ev.lowT > 4) {
        f.eng[i] = 0.8; f.atLock = 0.01;
        f.resolveEvent(ev, age > 22 ? 'late' : 'ok', 'Помпаж прекратился: двигатель №' + (i + 1) + ' работает с пониженной тягой');
        return;
      }
      f.eng[i] = Math.max(0.05, 0.45 + 0.25 * Math.sin(f.time * 9));
      if (age > 35) {
        f.atLock = 0.01;
        f.resolveEvent(ev, 'fail', 'Двигатель №' + (i + 1) + ' разрушен помпажем!');
        f.startEvent('engFail', { side: i });
      }
    },
  },

  flapJam: {
    title: 'АСИММЕТРИЯ ЗАКРЫЛКОВ', short: 'Асимметрия закрылков/спойлеров', phases: ['descent'], weight: 2, group: 'cfg', spawn: 'descent',
    desc: 'Закрылки/спойлеры встали несимметрично: самолёт валит в крен, а посадочная скорость выше. Держите крыло и заходите быстрее.',
    ok: f => f.distM >= 250000,
    start(f, ev) {
      ev.dir = f.rnd() < 0.5 ? -1 : 1; f.fx.flapJam = true; f.fx.rollBias = ev.dir * 6;
      f.msg('ЗАКРЫЛКИ/СПОЙЛЕРЫ — АСИММЕТРИЯ! Крен тянет ' + (ev.dir > 0 ? 'вправо' : 'влево'));
    },
    steps(f, ev) {
      return [
        { t: 'Закрылки заклинило на ' + FL[f.c.flaps] + '. Держите крыло ровно (штурвал или А/П), крен ' + Math.round(Math.abs(f.phi) / 0.01745) + '°', done: Math.abs(f.phi) < 6 * 0.01745 },
        { t: 'Заходите быстрее: не ниже ' + kmh(f.minSpd() + 8) + ' км/ч', done: f.ias > f.minSpd() + 8 },
      ];
    },
    alert: (f, ev) => 'АСИММЕТРИЯ ЗАКРЫЛКОВ',
    tick(f, ev, dt) { if (settled(f, ev, dt, 10)) f.resolveEvent(ev, f.time - ev.t0 > 150 ? 'late' : 'ok', 'Самолёт сбалансирован, заход на повышенной скорости'); },
  },

  gearStuck: {
    title: 'ШАССИ НЕ ВЫПУСКАЕТСЯ', short: 'Невыпуск шасси', phases: ['descent'], weight: 2, group: 'cfg', spawn: 'descent',
    desc: 'Перед посадкой шасси не выходит. Нажмите ЗАПАС. ШАССИ (ручной выпуск, ~20 с) заранее — с убранными стойками посадка закончится катастрофой.',
    ok: f => f.distM >= 250000,
    start(f, ev) { f.fx.gearStuck = true; f.msg('ШАССИ НЕ ВЫПУСКАЕТСЯ! Нажмите ЗАПАС. ШАССИ'); },
    steps(f, ev) {
      const done = f.altGear && f.gearPos > 0.98;
      return [{ t: 'ЗАПАС. ШАССИ — выпуск вручную' + (f.altGear && !done ? ' (выходит…)' : !f.altGear && f.dist < 30000 ? ' — ПОРА!' : ''), done }];
    },
    alert: (f, ev) => 'ШАССИ НЕ ВЫПУЩЕНО',
    tick(f, ev, dt) { if (f.altGear && f.gearPos > 0.98) f.resolveEvent(ev, f.dist > 10000 ? 'ok' : 'late', 'Шасси выпущено и зафиксировано'); },
  },

  noRetract: {
    title: 'ШАССИ НЕ УБИРАЕТСЯ', short: 'Неубор шасси', phases: ['low', 'climb'], weight: 2, group: 'cfg', spawn: 'climb',
    desc: 'После взлёта шасси остаётся выпущенным. Нужна малая скорость и потолок ≈ 4000 м; разумнее вернуться или сесть на запасном.',
    ok: f => f.distM >= 150000,
    start(f, ev) {
      f.fx.noRetract = true; f.c.gear = true;
      f.msg('ШАССИ НЕ УБИРАЕТСЯ! Скорость не выше ' + kmh(f.p.gearLim) + ' км/ч');
    },
    steps(f, ev) {
      return [
        { t: 'Скорость не выше ' + kmh(f.p.gearLim) + ' км/ч, высота до 4200 м', done: f.ias < f.p.gearLim && f.h < 4400 },
        { t: 'Рекомендуется вернуться: ' + f.altText(), done: f.diverted, opt: true },
      ];
    },
    alert: (f, ev) => 'ШАССИ НЕ УБРАЛОСЬ',
    tick(f, ev, dt) {
      const age = f.time - ev.t0;
      if (f.diverted) { f.resolveEvent(ev, 'ok', 'Возвращаемся с выпущенным шасси — разумное решение'); return; }
      if (age > 150 && f.ias < f.p.gearLim + 5) { f.fx.noRetract = false; f.resolveEvent(ev, 'late', 'Шасси убралось со второй попытки'); }
    },
  },

  gen: {
    title: 'ОТКАЗ ГЕНЕРАТОРА / ШИНЫ ПИТАНИЯ', short: 'Отказ генератора/шины питания', phases: ['cruise'], weight: 2, group: 'ctl', spawn: 'cruise',
    desc: 'Генератор и шина питания обесточены: автопилот и автомат тяги отключаются. Запустите ВСУ и пилотируйте вручную до подачи питания.',
    ok: f => f.distM >= 250000,
    start(f, ev) {
      const c = f.c; f.fx.elec = true; f.apLock = f.atLock = 9999; c.apOn = c.atOn = c.appr = false; f.apprCap = false;
      f.msg('ОТКАЗ ГЕНЕРАТОРА! Шина обесточена — А/П и А/Т отключены');
    },
    btns: (f, ev) => ev.apu ? [] : [{ k: 'apu', t: '⚡ ЗАПУСК ВСУ' }],
    act(f, ev, k) { if (k === 'apu' && !ev.apu) { ev.apu = f.time; f.msg('ВСУ запускается… около 12 секунд'); } },
    steps(f, ev) {
      return [
        { t: 'ЗАПУСК ВСУ — нажмите кнопку', done: !!ev.apu },
        { t: 'Пилотируйте вручную: высота ' + Math.round(f.c.apAlt) + ' м, держите курс', done: !f.fx.elec },
      ];
    },
    alert: (f, ev) => 'ОТКАЗ ГЕНЕРАТОРА / ШИНЫ',
    tick(f, ev, dt) {
      const age = f.time - ev.t0;
      const back = () => { f.fx.elec = false; f.apLock = f.atLock = 0.01; };
      if (ev.apu && f.time - ev.apu > 12) { back(); f.resolveEvent(ev, ev.apu - ev.t0 < 45 ? 'ok' : 'late', 'Питание восстановлено от ВСУ'); }
      else if (!ev.apu && age > 200) { back(); f.resolveEvent(ev, 'late', 'Питание восстановлено автоматически'); }
    },
  },

  adc: {
    title: 'ПОТЕРЯ ДАННЫХ ADS/IRS', short: 'Потеря данных с датчиков ADS/IRS', phases: ['cruise'], weight: 2, group: 'ctl', spawn: 'cruise',
    desc: 'Пропали данные скорости и высоты. Автопилот отключился. Держите тангаж и тягу «как были» и переключитесь на резервные приборы.',
    ok: f => f.distM >= 250000,
    start(f, ev) {
      const c = f.c; f.fx.adc = true; f.apLock = f.atLock = 9999; c.apOn = c.atOn = c.appr = false; f.apprCap = false;
      f.msg('ПОТЕРЯ ДАННЫХ ADS/IRS! Скорость и высота недоступны');
    },
    btns: (f, ev) => ev.stby ? [] : [{ k: 'stby', t: '🛟 РЕЗЕРВНЫЕ ПРИБОРЫ' }],
    act(f, ev, k) { if (k === 'stby' && !ev.stby) { ev.stby = f.time; f.msg('Переключение на резервные приборы…'); } },
    steps(f, ev) {
      return [
        { t: 'Нет скорости и высоты: держите тангаж и тягу как были, не меняйте режим', done: !f.fx.adc },
        { t: 'РЕЗЕРВНЫЕ ПРИБОРЫ — нажмите кнопку', done: !!ev.stby },
      ];
    },
    alert: (f, ev) => 'ADS/IRS — НЕТ ДАННЫХ',
    tick(f, ev, dt) {
      const age = f.time - ev.t0, back = () => { f.fx.adc = false; f.apLock = f.atLock = 0.01; };
      if (ev.stby && f.time - ev.stby > 8) { back(); f.resolveEvent(ev, ev.stby - ev.t0 < 40 ? 'ok' : 'late', 'Резервные приборы работают'); }
      else if (!ev.stby && age > 240) { back(); f.resolveEvent(ev, 'late', 'Данные восстановились'); }
    },
  },

  indic: {
    title: 'РАСХОЖДЕНИЕ ПОКАЗАНИЙ', short: 'Ошибки индикации высоты/скорости', phases: ['cruise'], weight: 2, group: 'ctl', spawn: 'cruise',
    desc: 'Скорость и высота на основном приборе врут (заблокированы ПВД). Сверьте с резервным индикатором, не верьте ленте слепо.',
    ok: f => f.distM >= 250000,
    start(f, ev) {
      const c = f.c, s = f.rnd() < 0.5 ? 1 : -1;
      f.fx.iasErr = s * (9 + f.rnd() * 5); f.fx.altErr = -s * (100 + f.rnd() * 120);
      f.apLock = f.atLock = 9999; c.apOn = c.atOn = c.appr = false; f.apprCap = false;
      f.msg('РАСХОЖДЕНИЕ ПОКАЗАНИЙ скорости и высоты! А/П отключён');
    },
    btns: (f, ev) => ev.chk ? [] : [{ k: 'chk', t: '🔍 СВЕРИТЬ С РЕЗЕРВОМ' }],
    act(f, ev, k) { if (k === 'chk' && !ev.chk) { ev.chk = f.time; f.msg('Сверяем с резервными приборами…'); } },
    steps(f, ev) {
      return [
        { t: 'Показания расходятся (скорость на ' + Math.round(Math.abs(f.fx.iasErr) * 3.6) + ' км/ч, высота на ' + Math.round(Math.abs(f.fx.altErr)) + ' м) — не доверяйте ленте', done: !f.fx.iasErr },
        { t: 'СВЕРИТЬ С РЕЗЕРВОМ — нажмите кнопку', done: !!ev.chk },
      ];
    },
    alert: (f, ev) => 'РАСХОЖДЕНИЕ ПОКАЗАНИЙ',
    tick(f, ev, dt) {
      const age = f.time - ev.t0, back = () => { f.fx.iasErr = 0; f.fx.altErr = 0; f.apLock = f.atLock = 0.01; };
      if (ev.chk && f.time - ev.chk > 6) { back(); f.resolveEvent(ev, ev.chk - ev.t0 < 40 ? 'ok' : 'late', 'Неисправный источник отключён, показания верны'); }
      else if (!ev.chk && age > 180) { back(); f.resolveEvent(ev, 'late', 'Показания пришли в норму'); }
    },
  },

  turb: {
    title: 'СИЛЬНАЯ ТУРБУЛЕНТНОСТЬ', short: 'Сильная турбулентность', phases: ['cruise'], weight: 3, group: 'wx', spawn: 'cruise',
    desc: 'Самолёт трясёт. Включите табло «ремни», объявите пассажирам и снизьте скорость до скорости турбулентности.',
    ok: f => f.distM >= 250000,
    start(f, ev) { f.fx.turb = 1; f.fx.belts = false; f.fx.injT = 0; f.fx.injDone = false; ev.dur = 75; f.msg('СИЛЬНАЯ ТУРБУЛЕНТНОСТЬ! Включите ремни и снизьте скорость'); },
    btns: (f, ev) => f.fx.belts ? [] : [{ k: 'belts', t: '🔔 РЕМНИ / ОБЪЯВЛЕНИЕ' }],
    act(f, ev, k) { if (k === 'belts' && !f.fx.belts) { f.fx.belts = true; ev.beltT = f.time - ev.t0; f.msg('Пассажиры пристёгнуты'); } },
    steps(f, ev) {
      const tg = f.atTargetIAS();
      return [
        { t: 'РЕМНИ — нажмите кнопку', done: f.fx.belts },
        { t: 'Скорость турбулентности ≈ ' + kmh(tg) + ' км/ч (сейчас ' + kmh(f.ias) + ')', done: f.ias <= tg + 6 },
        { t: 'Зона болтанки закончится через ' + Math.max(0, Math.ceil(ev.dur - (f.time - ev.t0))) + ' с', done: false, opt: true },
      ];
    },
    alert: (f, ev) => 'ТУРБУЛЕНТНОСТЬ',
    tick(f, ev, dt) {
      if (f.time - ev.t0 > ev.dur) { f.fx.turb = 0; f.fx.belts = false; f.resolveEvent(ev, ev.beltT !== undefined && ev.beltT < 25 ? 'ok' : 'late', 'Турбулентность позади'); }
    },
  },

  ice: {
    title: 'ОБЛЕДЕНЕНИЕ', short: 'Обледенение', phases: ['climb', 'cruise', 'descent'], weight: 2, group: 'wx', spawn: 'cruise',
    desc: 'Планер и двигатели обмерзают: растёт сопротивление, падает подъёмная сила. Включите противообледенительную систему и держите скорость.',
    ok: f => f.distM >= 250000,
    spec: (r, ph) => ph === 'descent' ? { ph, d: 64000 + r() * 18000 } : null,
    start(f, ev) { f.fx.ice = 0.05; f.fx.anti = false; f.msg('ОБЛЕДЕНЕНИЕ! Включите противообледенительную систему'); },
    btns: (f, ev) => f.fx.anti ? [] : [{ k: 'anti', t: '❄ ПРОТИВООБЛЕД.' }],
    act(f, ev, k) { if (k === 'anti' && !f.fx.anti) { f.fx.anti = true; ev.antiT = f.time - ev.t0; f.msg('Противообледенительная система включена'); } },
    steps(f, ev) {
      return [
        { t: 'ПРОТИВООБЛЕД. — включите (лёд ' + Math.round(f.fx.ice * 100) + '%)', done: f.fx.anti },
        { t: 'Держите скорость не ниже ' + kmh(f.minSpd() + 10) + ' км/ч — запас до сваливания меньше', done: f.ias > f.minSpd() + 10 },
        { t: 'Лёд стаивает', done: f.fx.ice < 0.1 },
      ];
    },
    alert: (f, ev) => 'ОБЛЕДЕНЕНИЕ',
    tick(f, ev, dt) {
      const fx = f.fx;
      fx.ice = Math.max(0, Math.min(1, fx.ice + (fx.anti ? -0.05 : 0.018) * dt));
      if (fx.anti && fx.ice < 0.1) { fx.ice = 0; fx.anti = false; f.resolveEvent(ev, ev.antiT < 40 ? 'ok' : 'late', 'Лёд сошёл, самолёт чистый'); }
    },
  },

  wshear: {
    title: 'СДВИГ ВЕТРА', short: 'Гроза и сдвиг ветра на заходе', phases: ['final'], weight: 2, group: 'land', spawn: 'final',
    desc: 'На заходе в грозу — внезапный сдвиг ветра: скорость падает, самолёт проваливается. Только УХОД с взлётной тягой.',
    ok: f => true,
    start(f, ev) { f.fx.ws = 10; f.fx.flash = 1; f.msg('СДВИГ ВЕТРА! УХОД! ВЗЛЁТНЫЙ ГАЗ!'); },
    steps(f, ev) {
      return [
        { t: 'УХОД — нажмите кнопку (газ взлётный, нос вверх)', done: !!f.ga || f.gaCount > 0 },
        { t: 'Не допускайте сваливания: скорость ≥ ' + kmh(f.minSpd()) + ' км/ч', done: f.ias > f.minSpd() },
      ];
    },
    alert: (f, ev) => f.fx.ws > 0 ? 'СДВИГ ВЕТРА!' : null,
    tick(f, ev, dt) {
      if (f.fx.ws > 0 && f.rnd() < dt * 0.8) f.fx.flash = 1;
      if (f.ga || f.gaCount > 0) f.resolveEvent(ev, 'ok', 'Уход из сдвига ветра выполнен');
      else if (f.td) { f.resolveEvent(ev, 'late', 'Посадка в сдвиг ветра'); }
      else if (f.fx.ws <= 0 && f.time - ev.t0 > 16 && f.ias > f.minSpd()) f.resolveEvent(ev, 'late', 'Сдвиг ветра пройден без ухода');
    },
  },

  storm: {
    title: 'ГРОЗОВОЙ ФРОНТ', short: 'Гроза по курсу', phases: ['cruise'], weight: 2, group: 'wx', spawn: 'cruise',
    desc: 'По курсу грозовые очаги: молнии, болтанка, град. Включите ремни и обойдите грозу — кнопка ОБХОД.',
    ok: f => f.distM >= 300000,
    start(f, ev) { f.fx.turb = 1.6; f.fx.belts = false; f.fx.injT = 0; f.fx.injDone = false; ev.dur = 100; f.msg('ГРОЗОВОЙ ФРОНТ ПО КУРСУ! Обойдите грозу'); },
    btns: (f, ev) => [...(ev.avoid ? [] : [{ k: 'avoid', t: '🌩 ОБХОД ГРОЗЫ' }]), ...(f.fx.belts ? [] : [{ k: 'belts', t: '🔔 РЕМНИ' }])],
    act(f, ev, k) {
      if (k === 'belts' && !f.fx.belts) { f.fx.belts = true; f.msg('Пассажиры пристёгнуты'); }
      if (k === 'avoid' && !ev.avoid) { ev.avoid = f.time; ev.avoidT = f.time - ev.t0; f.fuel = Math.max(0, f.fuel - f.p.burnHr * 0.02); f.msg('Обходим грозу — отклонение ≈ 25 км'); }
    },
    steps(f, ev) {
      return [
        { t: 'ОБХОД ГРОЗЫ — нажмите кнопку', done: !!ev.avoid },
        { t: 'Ремни — нажмите кнопку', done: f.fx.belts },
        { t: 'Снизьте скорость до ≈ ' + kmh(f.atTargetIAS()) + ' км/ч', done: f.ias <= f.atTargetIAS() + 6, opt: true },
      ];
    },
    alert: (f, ev) => 'ГРОЗА ПО КУРСУ',
    tick(f, ev, dt) {
      if (f.rnd() < dt * 0.7) f.fx.flash = 1;
      if (ev.avoid) {
        f.fx.turb = Math.max(0, f.fx.turb - dt / 10);
        if (f.fx.turb <= 0.02) { f.fx.turb = 0; f.fx.belts = false; f.resolveEvent(ev, ev.avoidT < 35 ? 'ok' : 'late', 'Гроза обойдена'); }
      } else if (f.time - ev.t0 > ev.dur) { f.fx.turb = 0; f.fx.belts = false; f.resolveEvent(ev, 'late', 'Прошли сквозь грозовой фронт'); }
    },
  },

  fog: {
    title: 'ПЛОХАЯ ВИДИМОСТЬ / ТУМАН', short: 'Туман: видимость ниже минимума', phases: ['descent'], weight: 2, group: 'land', spawn: 'descent',
    desc: 'В аэропорту назначения густой туман: видимость 300 м, ниже минимума. Заходите по ГЛС, а на высоте принятия решения (60 м) без полосы — УХОД (или на запасной).',
    ok: f => f.distM >= 250000,
    start(f, ev) { f.fx.fog = Math.max(f.fx.fog, 0.05); f.msg('ТУМАН В АЭРОПОРТУ НАЗНАЧЕНИЯ: видимость 300 м, ниже минимума'); },
    steps(f, ev) {
      return [
        { t: 'Заход строго по ГЛС (кнопка ПОСАДКА): визуально полосы не видно', done: f.apprCap || f.ga || f.gaCount > 0 || f.diverted },
        { t: 'На ВПР (60 м) полосы нет — УХОД; или сразу на запасной: ' + f.altText(), done: f.gaCount > 0 || f.ga || f.diverted },
      ];
    },
    alert: (f, ev) => !f.td && !f.ga && f.h < 70 && f.dist > 0 && f.dist < 6000 ? 'ВПР: ПОЛОСЫ НЕ ВИДНО — УХОД!' : null,
    tick(f, ev, dt) {
      f.fx.fog = Math.min(1, f.fx.fog + dt / 40);
      if (f.diverted) { f.resolveEvent(ev, 'ok', 'Туман обойдён — идём на запасной'); return; }
      if (f.ga || f.gaCount > 0) { f.resolveEvent(ev, 'ok', 'Уход из тумана выполнен — молодец'); return; }
      if (f.td) { f.incident('fog', 'Посадка ниже минимума видимости', 10, 999); f.resolveEvent(ev, 'fail', 'Посадка вслепую вопреки минимуму'); }
    },
  },

  cabinFire: {
    title: 'ПОЖАР В САЛОНЕ / БАГАЖНИКЕ', short: 'Пожар в салоне или багажнике', phases: ['cruise'], weight: 2, group: 'pax', spawn: 'cruise',
    desc: 'Дым и огонь на борту. Тушите, быстро снижайтесь ниже 3000 м и садитесь на ближайшем аэродроме — времени мало.',
    ok: f => f.distM >= 250000,
    start(f, ev) {
      ev.res = f.rnd() < 0.65; ev.where = f.rnd() < 0.5 ? 'салоне' : 'грузовом отсеке'; f.fx.smoke = 0.15;
      f.msg('ПОЖАР В ' + (ev.where === 'салоне' ? 'САЛОНЕ' : 'ГРУЗОВОМ ОТСЕКЕ') + '! Дым в кабине');
    },
    btns: (f, ev) => ev.ext ? [] : [{ k: 'ext', t: '🧯 ТУШЕНИЕ' }],
    act(f, ev, k) {
      if (k !== 'ext' || ev.ext) return;
      ev.ext = f.time; const c = f.c;
      f.msg(ev.res ? 'Очаг потушен, но дым остаётся — садитесь' : 'Огонь не гаснет! СРОЧНО НА ПОСАДКУ');
      if (f.apLock <= 0) { c.apOn = true; c.atOn = f.atLock <= 0; c.appr = false; }
      c.apAlt = Math.min(c.apAlt, 3000);
    },
    steps(f, ev) {
      return [
        { t: 'ТУШЕНИЕ — нажмите кнопку (пожар в ' + ev.where + ')', done: !!ev.ext },
        { t: 'Снизьтесь ниже 3000 м (сейчас ' + Math.round(f.h) + ' м)', done: f.h < 3100 },
        { t: 'Срочная посадка: ' + f.altText(), done: f.diverted || f.dist < 100000 },
      ];
    },
    alert: (f, ev) => ['ДЫМ В КАБИНЕ', ...(ev.ext && !ev.res ? ['ОГОНЬ НЕ ПОТУШЕН'] : [])],
    tick(f, ev, dt) {
      const age = f.time - ev.t0;
      ev.needDiv = !!ev.ext;
      f.fx.smoke = ev.ext ? (ev.res ? 0.4 : 0.8) : Math.min(0.9, 0.15 + age * 0.006);
      if (!ev.ext && age > 90 && !ev.spread) { ev.spread = true; f.incident('cfire', 'Пожар не тушили вовремя', 10, 999); }
      if (age > 480 && !f.diverted && f.dist > 100000) { f.finish('crash', 'Пожар на борту: самолёт потерян.'); return; }
      if (f.td) { f.resolveEvent(ev, 'late', 'Посадка с пожаром на борту'); return; }
      if (settled(f, ev, dt, 3)) f.resolveEvent(ev, age > 260 ? 'late' : 'ok', 'Пожар локализован, идём на посадку');
    },
  },

  medical: {
    title: 'МЕДИЦИНСКАЯ ПРОБЛЕМА НА БОРТУ', short: 'Медицинская проблема на борту', phases: ['cruise'], weight: 2, group: 'pax', spawn: 'cruise',
    desc: 'Пассажиру плохо. Запросите врача на борту: если врача нет или состояние тяжёлое — нужна срочная посадка.',
    ok: f => f.distM >= 250000,
    start(f, ev) { ev.doc = f.rnd() < 0.7; ev.crit = f.rnd() < 0.35; f.msg('ПАССАЖИРУ ПЛОХО! Запросите врача на борту'); },
    btns: (f, ev) => ev.asked ? [] : [{ k: 'doc', t: '🩺 ВРАЧА НА БОРТ' }],
    act(f, ev, k) {
      if (k !== 'doc' || ev.asked) return;
      ev.asked = f.time;
      ev.needDiv = !ev.doc || ev.crit;
      f.msg(ev.doc ? (ev.crit ? 'Врач нашёлся, но состояние тяжёлое — нужна посадка' : 'Врач оказывает помощь — состояние стабильное') : 'Врача на борту нет! Нужна срочная посадка');
    },
    steps(f, ev) {
      const s = [{ t: 'Запросите врача на борту — кнопка', done: !!ev.asked }];
      if (ev.asked) s.push(ev.needDiv ? { t: 'Срочная посадка: ' + f.altText(), done: f.diverted || f.dist < 150000 } : { t: 'Состояние стабильное — можно лететь дальше', done: true });
      return s;
    },
    alert: (f, ev) => 'МЕДИЦИНСКАЯ ПРОБЛЕМА',
    tick(f, ev, dt) {
      const age = f.time - ev.t0;
      if (ev.asked && !ev.needDiv && f.time - ev.asked > 8) f.resolveEvent(ev, ev.asked - ev.t0 < 60 ? 'ok' : 'late', 'Пассажир стабилен, продолжаем рейс');
      else if (ev.needDiv && (f.diverted || f.dist < 150000)) f.resolveEvent(ev, age > 300 ? 'late' : 'ok', 'Идём на посадку — скорая встретит на полосе');
      else if (ev.needDiv && age > 500) { f.incident('med', 'Состояние пассажира критическое', 12, 999); f.resolveEvent(ev, 'fail', 'Слишком поздно...'); }
      else if (!ev.asked && age > 150) { f.incident('med', 'Не запросили врача вовремя', 6, 999); f.resolveEvent(ev, 'fail', 'Помощь оказана слишком поздно'); }
    },
  },

  unruly: {
    title: 'ДЕБОШИР / УГРОЗА БЕЗОПАСНОСТИ', short: 'Дебошир или угроза безопасности', phases: ['cruise'], weight: 2, group: 'pax', spawn: 'cruise',
    desc: 'В салоне агрессивный пассажир. Заприте дверь кабины, дайте сигнал тревоги; при серьёзной угрозе — садитесь на ближайшем аэродроме.',
    ok: f => f.distM >= 250000,
    start(f, ev) { ev.sev = f.rnd() < 0.45; f.msg(ev.sev ? 'УГРОЗА БЕЗОПАСНОСТИ: пассажир рвётся в кабину!' : 'ПАССАЖИР-ДЕБОШИР в салоне!'); },
    btns: (f, ev) => [...(ev.door ? [] : [{ k: 'door', t: '🔒 ЗАПЕРЕТЬ КАБИНУ' }]), ...(ev.alarm ? [] : [{ k: 'alarm', t: '🚨 ТРЕВОГА 7500' }])],
    act(f, ev, k) {
      if (k === 'door' && !ev.door) { ev.door = f.time; f.msg('Дверь кабины заперта'); }
      if (k === 'alarm' && !ev.alarm) { ev.alarm = f.time; f.msg('Сигнал тревоги передан, экипаж салона действует'); }
    },
    steps(f, ev) {
      const s = [{ t: 'ЗАПЕРЕТЬ КАБИНУ — кнопка', done: !!ev.door }, { t: 'ТРЕВОГА 7500 — сообщить диспетчеру', done: !!ev.alarm }];
      if (ev.sev) s.push({ t: 'Серьёзная угроза: садитесь на ближайшем аэродроме — ' + f.altText(), done: f.diverted || f.dist < 120000 });
      return s;
    },
    alert: (f, ev) => ev.sev ? 'УГРОЗА БЕЗОПАСНОСТИ' : 'ДЕБОШИР В САЛОНЕ',
    tick(f, ev, dt) {
      const age = f.time - ev.t0;
      ev.needDiv = !!ev.sev && !!ev.door && !!ev.alarm;
      if (!ev.door && age > 40 && !ev.warned) { ev.warned = true; f.incident('door', 'Дверь кабины не заперта вовремя', 8, 999); }
      if (ev.sev && age > 360 && !f.diverted && f.dist > 120000) { f.resolveEvent(ev, 'fail', 'Угрозу не удалось купировать'); f.incident('threat', 'Игнорирование угрозы безопасности', 12, 999); return; }
      if (ev.door && ev.alarm) {
        if (!ev.sev && f.time - Math.max(ev.door, ev.alarm) > 25) f.resolveEvent(ev, age > 90 ? 'late' : 'ok', 'Дебошир усмирён экипажем');
        else if (ev.sev && (f.diverted || f.dist < 120000)) f.resolveEvent(ev, age > 240 ? 'late' : 'ok', 'Идём на посадку, полиция встретит у трапа');
      } else if (!ev.sev && age > 150) f.resolveEvent(ev, 'late', 'Экипаж справился без вашей помощи');
    },
  },

  tcas: {
    title: 'КОНФЛИКТ С ДРУГИМ БОРТОМ (TCAS)', short: 'Конфликт с бортом (TCAS)', phases: ['cruise'], weight: 2, spawn: 'cruise',
    desc: 'Встречный борт на вашем эшелоне. TCAS даёт команду: вверх или вниз. Выполняйте немедленно вертикальной скоростью ≥ 6 м/с.',
    ok: f => f.distM >= 250000,
    extra: f => Math.abs(f.vs) < 2.5 && f.h > 4000,
    start(f, ev) {
      ev.ra = (f.h > f.ceilLim - 700 || f.rnd() < 0.5) ? -1 : 1;
      ev.hAc = f.h - ev.ra * 50;
      f.fx.traffic = { d: 8000, dh: ev.hAc - f.h, ra: 0 };
      f.msg('ТРАФИК! ТРАФИК!');
    },
    steps(f, ev) {
      const raOn = f.time - ev.t0 > 3;
      return [
        { t: 'Встречный борт ' + Math.round(Math.max(0, f.fx.traffic ? f.fx.traffic.d : 0) / 100) / 10 + ' км, на том же эшелоне', done: raOn },
        ...(raOn ? [{ t: 'TCAS: ' + (ev.ra > 0 ? 'ВВЕРХ (А/П: ВЫС +)' : 'ВНИЗ (А/П: ВЫС −)') + ' — вертикальная ≥ 6 м/с', done: f.vs * ev.ra > 5 }] : []),
      ];
    },
    alert: (f, ev) => f.time - ev.t0 > 3 ? (ev.ra > 0 ? 'TCAS: КЛИМБ! КЛИМБ!' : 'TCAS: СНИЖАЙСЯ! СНИЖАЙСЯ!') : 'TCAS: ТРАФИК',
    tick(f, ev, dt) {
      const age = f.time - ev.t0, tr = f.fx.traffic;
      if (tr) { tr.d = 8000 - 400 * age; tr.dh = ev.hAc - f.h; tr.ra = age > 3 ? ev.ra : 0; }
      if (age > 6 && !ev.auto && f.assist.auto && f.c.apOn && f.apLock <= 0) { ev.auto = true; f.c.apAlt = Math.max(300, Math.min(f.ceilLim - 250, f.h + ev.ra * 500)); f.msg('А/П выполняет команду TCAS'); }
      if (age >= 20) {
        const sep = Math.abs(f.h - ev.hAc); f.fx.traffic = null;
        if (sep >= 120) f.resolveEvent(ev, 'ok', 'Разошлись безопасно (' + Math.round(sep) + ' м по вертикали)');
        else if (sep >= 70) { f.incident('tcas', 'Опасное сближение с бортом', 4, 999); f.resolveEvent(ev, 'late', 'Разошлись впритык (' + Math.round(sep) + ' м)'); }
        else { f.incident('nmac', 'Опасное сближение (NMAC)', 15, 999); f.resolveEvent(ev, 'fail', 'Чудом разошлись: ' + Math.round(sep) + ' м'); }
      }
    },
  },

  gps: {
    title: 'СБОЙ GPS / НАВИГАЦИИ', short: 'Сбой GPS/навигации', phases: ['cruise'], weight: 2, group: 'ctl', spawn: 'cruise',
    desc: 'Пропал сигнал GPS: автопилот не знает, где ось маршрута, и самолёт сносит. Перейдите на резервную навигацию VOR/DME.',
    ok: f => f.distM >= 250000,
    start(f, ev) { f.fx.gps = true; f.fx.gpsDir = f.rnd() < 0.5 ? 1 : -1; f.c.nav = false; f.msg('СБОЙ GPS! Навигация потеряна — возможен снос'); },
    btns: (f, ev) => ev.vor ? [] : [{ k: 'vor', t: '📡 РЕЗЕРВ. НАВИГАЦИЯ' }],
    act(f, ev, k) { if (k === 'vor' && !ev.vor) { ev.vor = f.time; f.msg('Переход на VOR/DME… около 10 секунд'); } },
    steps(f, ev) {
      return [
        { t: 'GPS потерян — РЕЗЕРВ. НАВИГАЦИЯ (VOR/DME), кнопка', done: !!ev.vor },
        { t: 'Держите линию пути: снос ' + Math.round(Math.abs(f.yPos)) + ' м', done: Math.abs(f.yPos) < 3000 },
      ];
    },
    alert: (f, ev) => 'GPS — НЕТ СИГНАЛА',
    tick(f, ev, dt) {
      const age = f.time - ev.t0, back = () => { f.fx.gps = false; f.c.nav = true; };
      if (ev.vor && f.time - ev.vor > 10) { back(); f.resolveEvent(ev, ev.vor - ev.t0 < 50 ? 'ok' : 'late', 'Навигация восстановлена по VOR/DME'); }
      else if (!ev.vor && age > 200) { back(); f.resolveEvent(ev, 'late', 'Сигнал GPS вернулся'); }
    },
  },

  closure: {
    title: 'АЭРОПОРТ ЗАКРЫТ', short: 'Закрытие аэропорта', phases: ['descent'], weight: 2, group: 'land', spawn: 'descent',
    desc: 'Диспетчер: аэропорт назначения закрыт. Выберите запасной аэродром (кнопка ЗАПАСНЫЕ) и следуйте туда; садиться на закрытую полосу нельзя.',
    ok: f => f.distM >= 250000,
    start(f, ev) {
      ev.why = ['авария на полосе', 'аварийно-спасательные работы', 'закрытие по погоде', 'отказ освещения полосы'][Math.floor(f.rnd() * 4)];
      f.msg('ДИСПЕТЧЕР: АЭРОПОРТ ЗАКРЫТ (' + ev.why + ')! Следуйте на запасной');
    },
    steps(f, ev) {
      return [
        { t: 'Выберите ЗАПАСНОЙ аэродром (кнопка внизу): ' + f.altText(), done: f.diverted },
        { t: 'Не заходите на посадку в закрытый аэропорт', done: f.diverted || (!f.rwyBlocked && f.dist > 2500) },
      ];
    },
    alert: (f, ev) => f.diverted ? null : 'АЭРОПОРТ ЗАКРЫТ',
    tick(f, ev, dt) {
      const age = f.time - ev.t0; ev.needDiv = true;
      if (f.diverted) { f.rwyBlocked = false; f.resolveEvent(ev, age > 260 ? 'late' : 'ok', 'Следуем на запасной аэродром'); return; }
      if (f.dist < 2500 && !f.td && !f.rwyBlocked && !f.ga && f.gaCount === 0) { f.rwyBlocked = true; f.msg('ПОЛОСА ЗАКРЫТА! УХОД НА ВТОРОЙ КРУГ!'); }
      if (age > 700) { f.rwyBlocked = false; f.resolveEvent(ev, 'fail', 'Аэропорт открыт — но вы потеряли много времени'); }
    },
  },

  rto: {
    title: 'ПРЕРВАННЫЙ ВЗЛЁТ', short: 'Прерванный взлёт (до V1)', phases: ['roll'], weight: 2, group: 'eng', spawn: 'roll',
    desc: 'На разбеге до V1 срабатывает сигнализация (шина, пожар, дверь). Единственный верный ход: газ 0 и ТОРМОЗ — взлёт прекращён.',
    ok: f => true,
    spec: (r, ph) => ({ ph: 'roll', k: 0.5 + r() * 0.18 }),
    start(f, ev) {
      const causes = ['ЛОПНУЛА ШИНА', 'ПОЖАРНАЯ СИГНАЛИЗАЦИЯ ДВИГАТЕЛЯ', 'СИГНАЛ «ДВЕРЬ НЕ ЗАКРЫТА»', 'ВИБРАЦИЯ ДВИГАТЕЛЯ'];
      ev.cause = Math.floor(f.rnd() * causes.length); if (ev.cause === 0) f.fx.tire = f.rnd() < 0.5 ? 1 : -1;
      f.msg('СТОП! ' + causes[ev.cause] + '. Прекращайте взлёт!');
    },
    steps(f, ev) {
      return [
        { t: 'ДО V1 (' + kmh(f.v1) + ' км/ч): газ 0 и ТОРМОЗ — ПРЕРВАТЬ ВЗЛЁТ', done: f.c.brake && f.c.thr < 0.15 },
        { t: 'Держите ось полосы штурвалом влево/вправо', done: Math.abs(f.yPos) < 12 },
      ];
    },
    alert: (f, ev) => 'ПРЕРВИТЕ ВЗЛЁТ!',
    tick(f, ev, dt) {
      if (!f.airborneOnce && f.c.brake && f.v < 2 && f.maxV > 20) { f.fx.tire = 0; f.resolveEvent(ev, 'ok', 'Взлёт прерван — решение верное'); return; }
      if (f.airborneOnce) { f.fx.tire = 0; f.resolveEvent(ev, 'late', 'Решение запоздало — взлёт продолжен'); return; }
      if (f.ias > f.v1 && !f.c.brake) f.resolveEvent(ev, 'late', 'Выше V1 — взлёт продолжается');
    },
    close(f, ev, kind, out) { return kind === 'abort' ? 'ok' : out; },
  },

  goAr: {
    title: 'УХОД НА ВТОРОЙ КРУГ', short: 'Уход на второй круг', phases: ['final'], weight: 2, group: 'land', spawn: 'final',
    desc: 'Диспетчер: впереди идущий борт не освободил полосу. Команда — уход на второй круг; садиться без разрешения нельзя.',
    ok: f => true,
    start(f, ev) { f.msg('ДИСПЕТЧЕР: ПОЛОСА НЕ ОСВОБОДИЛАСЬ — УХОД НА ВТОРОЙ КРУГ!'); },
    steps(f, ev) {
      return [
        { t: 'УХОД — нажмите кнопку (газ взлётный, шасси убираются)', done: !!f.ga || f.gaCount > 0 },
        { t: 'Наберите высоту — самолёт сам зайдёт на второй круг', done: f.gaCount > 0 && !f.ga },
      ];
    },
    alert: (f, ev) => !f.ga && f.gaCount === 0 ? 'ДИСПЕТЧЕР: УХОД!' : null,
    tick(f, ev, dt) {
      if (f.ga || f.gaCount > 0) f.resolveEvent(ev, 'ok', 'Уход выполнен — повторный заход');
      else if (f.td) { f.incident('goar', 'Игнорирование команды ухода', 10, 999); f.resolveEvent(ev, 'fail', 'Посадка вопреки команде диспетчера'); }
    },
    close(f, ev, kind, out) { return f.gaCount === 0 && kind === 'ok' ? 'fail' : out; },
  },

  rwyChg: {
    title: 'СМЕНА ПОЛОСЫ', short: 'Смена полосы по команде диспетчера', phases: ['descent'], weight: 2, group: 'land', spawn: 'descent',
    desc: 'Ветер сменился: диспетчер назначает другую полосу. Подтвердите — заход пойдёт с нового направления.',
    ok: f => f.distM >= 250000,
    start(f, ev) { f.msg('ДИСПЕТЧЕР: ВЕТЕР СМЕНИЛСЯ — СМЕНА ПОЛОСЫ! Подтвердите'); },
    btns: (f, ev) => ev.ack ? [] : [{ k: 'ack', t: '📻 ПОДТВЕРДИТЬ СМЕНУ ПОЛОСЫ' }],
    act(f, ev, k) { if (k === 'ack' && !ev.ack) { ev.ack = f.time; f.msg('Подтверждаю смену полосы, разворачиваюсь на новый заход'); } },
    steps(f, ev) {
      return [
        { t: 'Подтвердите смену полосы — кнопка', done: !!ev.ack },
        { t: 'Выйдите на новую посадочную прямую (карта) и заходите по глиссаде', done: !!ev.moved },
      ];
    },
    alert: (f, ev) => ev.moved ? null : 'СМЕНА ПОЛОСЫ',
    tick(f, ev, dt) {
      const age = f.time - ev.t0;
      if (!ev.moved && ((ev.ack && f.time - ev.ack > 4) || age > 100 || f.dist < 15000)) { if (f.changeRunway()) { ev.moved = true; f.resolveEvent(ev, ev.ack && ev.ack - ev.t0 < 45 ? 'ok' : 'late', 'Новая полоса, заход выполнен'); } }
    },
  },

  slick: {
    title: 'СКОЛЬЗКАЯ ПОЛОСА / АКВАПЛАНИРОВАНИЕ', short: 'Скользкая полоса, аквапланирование', phases: ['descent', 'final'], weight: 2, group: 'land', spawn: 'descent',
    desc: 'Полоса мокрая или с шугой: тормоза почти не держат, самолёт «плывёт». Касайтесь точно в зоне, не завышайте скорость, тормозите плавно и держите ось.',
    ok: f => true,
    start(f, ev) { f.fx.slick = 1; f.msg('ДИСПЕТЧЕР: ВПП СКОЛЬЗКАЯ, ТОРМОЗНОЙ ЭФФЕКТ ПЛОХОЙ'); },
    steps(f, ev) {
      if (f.td && f.td.onDest) return [
        { t: 'Тормозите и держите ось — тормозной путь вдвое длиннее', done: f.v < 12 },
        { t: 'Остановитесь до конца полосы (осталось ' + Math.max(0, Math.round(f.rwy1.e - f.x)) + ' м)', done: f.x < f.rwy1.e },
      ];
      return [
        { t: 'Касание точно в зоне (первые 700 м) на скорости не выше Vref+10', done: false },
        { t: 'Сразу после касания: тормоз и ось, без рывков', done: false },
      ];
    },
    alert: (f, ev) => f.td ? null : 'ВПП СКОЛЬЗКАЯ',
    tick(f, ev, dt) {
      if (f.td && f.td.onDest && f.v < 12) { f.resolveEvent(ev, f.td.past < 900 && Math.abs(f.yPos) < 20 ? 'ok' : 'late', 'Остановились на мокрой полосе'); }
      else if (f.td && !f.td.onDest) f.resolveEvent(ev, 'late', '');
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
    if (now && d.spec) { const e = d.spec(r, ph); if (e && e.d) spec = { ...spec, d: 60000 }; if (e && e.k) spec = { ...spec, k: e.k }; }
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
