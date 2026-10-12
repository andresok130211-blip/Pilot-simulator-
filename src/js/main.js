// Интерфейс игры: меню, выбор рейса, ангар, управление в полёте, итоги, сохранение.
import { AIRPORTS, AP_BY, PLANES, PL_BY, bearing, distKm, contractsFor, maxRangeKm, recommendedCruise, fmtRub } from './data.js';
import { Flight, settle, FLAP_NAMES } from './sim.js';
import { drawFlight, drawMap } from './render.js';

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const menu = $('menu'), ui = $('ui'), modal = $('modal'), modalBox = $('modalBox');
let W = 0, H = 0;
function resize() {
  const d = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * d); cv.height = Math.round(H * d);
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
window.addEventListener('resize', resize); resize();

// ---------- сохранение ----------
const KEY = 'pilotsim.v2';
const save = { money: 0, owned: ['ssj'], plane: 'ssj', loc: 'SVO', flights: 0, landings: 0, bestSink: null, pax: 0, assistAuto: true, assistCfg: true, hints: true, tod: 'rnd', sound: true, seenHelp: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { }
if (!AP_BY[save.loc]) save.loc = 'SVO';
if (!PL_BY[save.plane] || !save.owned.includes(save.plane)) { save.plane = save.owned[0] || 'ssj'; }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { } };

// ---------- состояние ----------
let mode = 'menu';          // menu | flight
let screen = 'hub';         // hub | select | hangar
let sel = null;             // выбранный контракт
let flight = null, contract = null, view = null;
let tNow = 0, last = 0, endTimer = 0, paused = false;
const keys = {};
const plane = () => PL_BY[save.plane];
const apLoc = () => AP_BY[save.loc];

// ---------- звук (простой, по желанию) ----------
let actx = null, eng = null, engGain = null, beepT = 0;
function audioInit() {
  if (actx || !save.sound) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    eng = actx.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 60;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    engGain = actx.createGain(); engGain.gain.value = 0;
    eng.connect(lp); lp.connect(engGain); engGain.connect(actx.destination); eng.start();
  } catch (e) { actx = null; }
}
function beep(freq, dur) {
  if (!actx || !save.sound) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.05;
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { }
}
function audioTick(f) {
  if (!actx || !engGain) return;
  const on = save.sound && mode === 'flight' && !paused;
  engGain.gain.value = on ? 0.03 + 0.07 * f.thrAct : 0;
  eng.frequency.value = 55 + 90 * f.thrAct;
  if (on && f.warnings.size && tNow - beepT > 0.6 && (f.warnings.has('stall') || f.warnings.has('pullup') || f.warnings.has('gear') || f.warnings.has('sink'))) { beepT = tNow; beep(f.warnings.has('pullup') ? 1100 : 780, 0.18); }
}

// ---------- модальное окно ----------
function showModal(html) { modalBox.innerHTML = html; modal.classList.add('on'); }
function hideModal() { modal.classList.remove('on'); }

// ---------- разметка меню ----------
function setScreen(s) { screen = s; sel = null; renderMenu(); }
const stat = (a, b) => `<span class="chip">${a} ${b}</span>`;

function renderMenu() {
  mode = 'menu'; ui.classList.remove('on'); menu.classList.add('on');
  if (screen === 'hub') renderHub();
  else if (screen === 'select') renderSelect();
  else renderHangar();
}

function renderHub() {
  const ap = apLoc(), p = plane();
  menu.innerHTML = `<div class="panel">
    <h1>✈ Pilot Sim</h1>
    <div class="sub">Вы — пилот пассажирского лайнера. Берите рейсы, взлетайте, ведите самолёт и мягко садитесь. Деньги тратьте на самолёты побольше.</div>
    <div class="row">${stat('💰', fmtRub(save.money))}${stat('📍', ap.city + ' (' + ap.id + ')')}${stat('🛩', p.short)}</div>
    <div class="row">${stat('Рейсов:', save.flights)}${stat('Пассажиров:', save.pax.toLocaleString('ru-RU'))}${save.bestSink != null ? stat('Лучшая посадка:', save.bestSink.toFixed(2) + ' м/с') : ''}</div>
    <div class="mrow"><button class="btn go big" id="bFly">Выбрать рейс</button></div>
    <div class="mrow"><button class="btn g" id="bHangar">Ангар</button><button class="btn g" id="bHelp">Как играть</button><button class="btn g" id="bSnd">Звук: ${save.sound ? 'вкл' : 'выкл'}</button></div>
    <div class="sub" style="margin-top:14px;opacity:.6">Данные сохраняются на устройстве. ${save.flights ? '<a href="#" id="bReset" style="color:#ff9a9a">Сбросить прогресс</a>' : ''}</div>
  </div>`;
  $('bFly').onclick = () => { audioInit(); setScreen('select'); };
  $('bHangar').onclick = () => setScreen('hangar');
  $('bHelp').onclick = showHelp;
  $('bSnd').onclick = () => { save.sound = !save.sound; persist(); if (save.sound) audioInit(); renderHub(); };
  const r = $('bReset');
  if (r) r.onclick = e => { e.preventDefault(); showModal(`<h2>Сбросить прогресс?</h2><div class="sub">Деньги, самолёты и статистика будут удалены.</div><div class="mrow"><button class="btn g" id="mNo">Отмена</button><button class="btn" style="background:#a23232" id="mYes">Сбросить</button></div>`);
    $('mNo').onclick = hideModal; $('mYes').onclick = () => { try { localStorage.removeItem(KEY); } catch (e) { } location.reload(); }; };
  if (!save.seenHelp) { save.seenHelp = true; persist(); showHelp(); }
}

function showHelp() {
  showModal(`<h2>Как играть</h2>
  <div class="sub"><b>Слева — газ</b> (ползунок вверх — больше тяги). <b>Справа — ручка</b>: вверх — нос вверх, вниз — нос вниз; отпустили — самолёт сам держит траекторию.<br><br>
  <b>1. Взлёт.</b> Отпустите ТОРМОЗ, газ на максимум, на скорости VR плавно тяните ручку вверх (тангаж 10–12°). Над землёй уберите ШАССИ.<br>
  <b>2. Полёт.</b> Включите А/П (автопилот), ВЫС ± задаёт высоту. Когда самолёт в крейсере, жмите ×2…×32 — время ускоряется.<br>
  <b>3. Посадка.</b> ПОСАДКА включает заход по глиссаде: выпускайте закрылки и шасси по подсказкам. У земли слегка потяните ручку на себя и сбросьте газ. После касания — ТОРМОЗ.<br><br>
  Чем мягче касание и чище полёт, тем больше платят. Галочки «Помощник» перед рейсом включают автоматику снижения и механизации — а без неё доплата выше.</div>
  <div class="mrow"><button class="btn" id="mOk">Понятно</button></div>`);
  $('mOk').onclick = hideModal;
}

function etaMin(km) { return Math.round(km / 760 * 60 + 22); }

function renderSelect() {
  const ap = apLoc(), p = plane();
  const list = contractsFor(p, ap.id, save.flights * 7919 + ap.id.charCodeAt(0) * 131 + ap.id.charCodeAt(2));
  if (sel && !list.find(c => c.to === sel.to)) sel = null;
  const owned = save.owned.map(id => PL_BY[id]);
  menu.innerHTML = `<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Рейсы из ${ap.city}</h1><button class="btn g" id="bBack">‹ Назад</button></div>
    <div class="row">${owned.map(o => `<button class="chip" data-pl="${o.id}" style="border:${o.id === p.id ? '2px solid #7dffb0' : '1px solid rgba(255,255,255,.3)'};color:#fff">${o.short}</button>`).join('')}</div>
    <div class="sub">${p.name}: до ${p.seats} пассажиров, дальность ≈ ${Math.round(maxRangeKm(p) / 100) * 100} км, полоса от ${p.minRwy} м.</div>
    <div id="list">${list.length ? list.map(c => {
      const to = AP_BY[c.to];
      return `<div class="card ${sel && sel.to === c.to ? 'sel' : ''}" data-to="${c.to}"><div><div class="t">${to.city} (${to.id})</div><div class="d">${Math.round(c.km)} км · ≈${etaMin(c.km)} мин · ${c.pax} пасс.</div></div><div class="r">≈ ${fmtRub(c.revenue)}</div></div>`;
    }).join('') : '<div class="sub">С этого аэродрома для выбранного самолёта нет подходящих рейсов. Смените самолёт.</div>'}</div>
    <div class="bar" id="opts" style="${sel ? '' : 'display:none'}">
      <label class="chk"><input type="checkbox" id="oAuto" ${save.assistAuto ? 'checked' : ''}> Помощник: автопилот сам набирает высоту, снижается и ведёт по глиссаде</label>
      <label class="chk"><input type="checkbox" id="oCfg" ${save.assistCfg ? 'checked' : ''}> Помощник: сам выпускает и убирает шасси и закрылки</label>
      <label class="chk"><input type="checkbox" id="oHint" ${save.hints ? 'checked' : ''}> Подсказки на экране</label>
      <label class="chk">Время суток: <select id="oTod"><option value="rnd">случайное</option><option value="0">день</option><option value="1">закат</option><option value="2">ночь</option></select></label>
      <button class="btn go big" id="bGo">Лететь ✈</button>
    </div>
  </div>`;
  $('oTod') && ($('oTod').value = String(save.tod));
  $('bBack').onclick = () => setScreen('hub');
  menu.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { save.plane = b.dataset.pl; persist(); sel = null; renderSelect(); });
  menu.querySelectorAll('[data-to]').forEach(el => el.onclick = () => {
    sel = list.find(c => c.to === el.dataset.to);
    menu.querySelectorAll('.card').forEach(x => x.classList.toggle('sel', x === el));
    $('opts').style.display = '';
    const pn = menu.querySelector('.panel'); pn.scrollTo({ top: pn.scrollHeight, behavior: 'smooth' });
  });
  if ($('bGo')) {
    $('oAuto').onchange = e => { save.assistAuto = e.target.checked; persist(); };
    $('oCfg').onchange = e => { save.assistCfg = e.target.checked; persist(); };
    $('oHint').onchange = e => { save.hints = e.target.checked; persist(); };
    $('oTod').onchange = e => { save.tod = e.target.value; persist(); };
    $('bGo').onclick = () => { if (sel) startFlight(sel); };
  }
}

function renderHangar() {
  const cur = plane();
  menu.innerHTML = `<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Ангар</h1><button class="btn g" id="bBack">‹ Назад</button></div>
    <div class="row">${stat('💰', fmtRub(save.money))}</div>
    ${PLANES.map(p => {
      const own = save.owned.includes(p.id);
      const btn = own ? (p.id === cur.id ? '<span class="chip">выбран</span>' : `<button class="btn" data-use="${p.id}">Выбрать</button>`)
        : `<button class="btn go" data-buy="${p.id}" ${save.money < p.price ? 'disabled' : ''}>Купить<br>${fmtRub(p.price)}</button>`;
      return `<div class="card ${own ? '' : ''}"><div><div class="t">${p.name}</div><div class="d">${p.seats} мест · дальность ≈ ${Math.round(maxRangeKm(p) / 100) * 100} км · полоса от ${p.minRwy} м<br>${p.desc}</div></div><div>${btn}</div></div>`;
    }).join('')}
  </div>`;
  $('bBack').onclick = () => setScreen('hub');
  menu.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { save.plane = b.dataset.use; persist(); renderHangar(); });
  menu.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
    const p = PL_BY[b.dataset.buy];
    if (save.money >= p.price) { save.money -= p.price; save.owned.push(p.id); save.plane = p.id; persist(); renderHangar(); }
  });
}

// ---------- запуск рейса ----------
function startFlight(c) {
  audioInit();
  const from = apLoc(), to = AP_BY[c.to], p = plane();
  const tod = save.tod === 'rnd' ? [0, 0, 0, 1, 2][Math.floor(Math.random() * 5)] : +save.tod;
  contract = c;
  flight = new Flight({ plane: p, from, to, bearing: bearing(from, to), distM: c.km * 1000, pax: c.pax, fuelKg: c.fuel,
    assist: { auto: save.assistAuto, config: save.assistCfg, hints: save.hints }, tod, recAlt: recommendedCruise(c.km) });
  flight.c.flaps = 2; flight.flapAct = 2; flight.c.brake = true; flight.c.thr = 0;
  view = { bump: 0, turb: 0, rollKick: 0, warp: 1 };
  stick.value = 0; stick.roll = 0; setYoke(); thrSet(0, true);
  endTimer = 0; paused = false; lastMsgCount = 0;
  mode = 'flight'; menu.classList.remove('on'); ui.classList.add('on'); $('log').innerHTML = '';
  hideModal();
}

// ---------- ввод: газ и ручка ----------
const thrEl = $('thr'), yokeEl = $('yoke'), yokeG = $('yokeG');
const stick = { value: 0, roll: 0, id: null };
function thrSet(v, silent) {
  v = Math.max(0, Math.min(1, v));
  if (flight) { flight.c.thr = v; if (!silent) flight.c.atOn = false; }
  $('thrfill').style.height = (v * 100) + '%';
  $('thrv').textContent = Math.round(v * 100) + '%';
}
thrEl.addEventListener('pointerdown', e => { thrEl.setPointerCapture(e.pointerId); thrMove(e); });
thrEl.addEventListener('pointermove', e => { if (thrEl.hasPointerCapture(e.pointerId)) thrMove(e); });
function thrMove(e) { const r = thrEl.getBoundingClientRect(); thrSet(1 - (e.clientY - r.top) / r.height); }
function setYoke() { yokeG.setAttribute('transform', `translate(0 ${(-stick.value * 16).toFixed(1)}) rotate(${(stick.roll * 75).toFixed(1)})`); }
function yokeMove(e) {
  const r = yokeEl.getBoundingClientRect(), R = r.width * 0.36;
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  stick.roll = Math.max(-1, Math.min(1, dx / R)); stick.value = Math.max(-1, Math.min(1, -dy / R)); setYoke();
}
yokeEl.addEventListener('pointerdown', e => { yokeEl.setPointerCapture(e.pointerId); stick.id = e.pointerId; yokeMove(e); });
yokeEl.addEventListener('pointermove', e => { if (stick.id === e.pointerId) yokeMove(e); });
const yokeUp = e => { if (stick.id === e.pointerId) { stick.id = null; stick.value = 0; stick.roll = 0; setYoke(); } };
yokeEl.addEventListener('pointerup', yokeUp); yokeEl.addEventListener('pointercancel', yokeUp);

// ---------- кнопки ----------
function act(a) {
  if (!flight || flight.done) return;
  const f = flight, c = f.c;
  switch (a) {
    case 'gear': f.setGear(!c.gear); break;
    case 'fl-': f.setFlaps(c.flaps - 1); break;
    case 'fl+': f.setFlaps(c.flaps + 1); break;
    case 'brake': c.brake = !c.brake; break;
    case 'warp': { const w = [1, 2, 4, 8, 16, 32]; const i = w.indexOf(c.warp); c.warp = w[(i + 1) % w.length]; if (c.warp > f.allowedWarp()) c.warp = 1; if (c.warp === 1 && f.allowedWarp() === 1 && i === 0) f.msg('Ускорение доступно в крейсерском полёте на автопилоте'); break; }
    case 'ap':
      if (c.apOn) { c.apOn = false; c.appr = false; f.apprCap = false; c.atOn = false; }
      else if (!f.onGround) { c.apOn = true; c.atOn = true; if (f.h < 3000 && !c.appr) c.apAlt = f.dist < 60000 ? 1500 : f.recAlt; if (f.dist >= 60000) c.apAlt = f.recAlt; }
      break;
    case 'at': c.atOn = !c.atOn; break;
    case 'nav': c.nav = !c.nav; break;
    case 'altd': c.apAlt = Math.max(300, c.apAlt - (c.apAlt > 3000 ? 600 : 300)); break;
    case 'altu': c.apAlt = Math.min(f.p.ceiling - 600, c.apAlt + (c.apAlt >= 3000 ? 600 : 300)); break;
    case 'appr': if (!c.apOn && !f.onGround) { c.apOn = true; c.atOn = true; } c.appr = !c.appr; if (!c.appr) f.apprCap = false; break;
  }
}
ui.querySelectorAll('#btns button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); act(b.dataset.act); }));

function syncButtons() {
  const f = flight, c = f.c;
  const on = (id, v) => $(id).classList.toggle('on', !!v);
  on('bGear', c.gear); $('bGear').textContent = 'ШАССИ ' + (f.gearPos > 0.98 ? '▼' : f.gearPos < 0.02 ? '▲' : '…');
  $('bFlD').textContent = 'ЗАКР − (' + FLAP_NAMES[c.flaps] + ')'; $('bFlU').textContent = 'ЗАКР +';
  on('bBrake', c.brake); $('bBrake').classList.toggle('warn', c.brake && f.onGround && !f.td && f.v < 1);
  on('bAp', c.apOn); on('bAt', c.atOn); on('bNav', c.nav && c.apOn); on('bAppr', c.appr);
  $('bAltD').textContent = 'ВЫС − ' + (c.apOn ? Math.round(c.apAlt) : '');
  $('bAltU').textContent = 'ВЫС +';
  const w = f.effectiveWarp(); $('bWarp').textContent = '×' + c.warp + (w !== c.warp ? ' (' + w + ')' : ''); on('bWarp', c.warp > 1);
  if (c.atOn) { $('thrfill').style.height = (c.thr * 100) + '%'; $('thrv').textContent = Math.round(c.thr * 100) + '%'; }
}

// ---------- клавиатура ----------
addEventListener('keydown', e => {
  if (mode !== 'flight' || !flight) return;
  keys[e.code] = true;
  const m = { KeyG: 'gear', KeyF: 'fl+', KeyV: 'fl-', KeyB: 'brake', KeyA: 'ap', KeyT: 'warp', KeyL: 'appr', BracketRight: 'altu', BracketLeft: 'altd', KeyN: 'at' }[e.code];
  if (m && !e.repeat) act(m);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
function keyboardInput(dt) {
  const f = flight;
  let ks = 0, kr = 0;
  if (keys.ArrowUp || keys.KeyW) ks += 1; if (keys.ArrowDown || keys.KeyS) ks -= 1;
  if (keys.ArrowRight || keys.KeyD) kr += 1; if (keys.ArrowLeft) kr -= 1;
  if (ks !== 0 || kr !== 0) { stick.value = ks; stick.roll = kr; setYoke(); keys._kb = true; }
  else if (keys._kb && stick.id === null) { stick.value = 0; stick.roll = 0; setYoke(); keys._kb = false; }
  let dthr = 0; if (keys.ShiftLeft || keys.ShiftRight) dthr += 0.4; if (keys.ControlLeft || keys.ControlRight) dthr -= 0.4;
  if (dthr) thrSet(f.c.thr + dthr * dt);
}

// ---------- выход / завершение ----------
$('quit').onclick = () => {
  if (!flight || flight.done) return;
  paused = true;
  showModal(`<h2>Пауза</h2><div class="sub">Прервать рейс? ${flight.airborneOnce ? 'В воздухе это считается срывом рейса: вы оплатите топливо и обслуживание.' : 'Пока вы на земле, это бесплатно.'}</div>
  <div class="mrow"><button class="btn go" id="mCont">Продолжить</button><button class="btn" style="background:#a23232" id="mQuit">Прервать рейс</button></div>`);
  $('mCont').onclick = () => { paused = false; hideModal(); };
  $('mQuit').onclick = () => { paused = false; hideModal(); flight.finish(flight.airborneOnce ? 'forced' : 'abort', flight.airborneOnce ? 'Рейс прерван экипажем.' : 'Рейс отменён до взлёта.'); };
};
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'flight' && flight && !flight.done && !modal.classList.contains('on')) $('quit').click(); });

function showResult() {
  const f = flight, r = settle(f, contract);
  const to = f.toAp;
  // применяем итоги
  save.money = Math.max(0, save.money + r.net);
  if (r.kind !== 'abort') save.flights++;
  if (r.kind === 'ok' || r.kind === 'overrun') { save.loc = to.id; }
  if (r.kind === 'ok') { save.landings++; save.pax += r.pax; if (save.bestSink == null || r.sink < save.bestSink) save.bestSink = r.sink; }
  persist();
  const ttl = { ok: r.quality, crash: 'Катастрофа', overrun: 'Выкатились за полосу', forced: 'Рейс сорван', missed: 'Аэропорт пролетели', abort: 'Рейс отменён' }[r.kind];
  const row = (a, v, cls) => `<tr><td>${a}</td><td class="${cls || ''}">${v}</td></tr>`;
  let rows = '';
  if (r.kind !== 'abort') {
    if (r.kind === 'ok') rows += row('Скорость снижения при касании', r.sink.toFixed(2) + ' м/с');
    if (r.revenue) rows += row('Выручка', '+' + fmtRub(r.revenue), 'pos');
    if (r.kind === 'ok' && r.bonus) rows += row('Бонус за ручное управление', '+' + Math.round(r.bonus * 100) + '%', 'pos');
    if (r.kind === 'ok' && r.pen > 0) rows += row('Штраф за нарушения', '−' + Math.round(r.pen * 100) + '%', 'neg');
    if (r.fuelCost) rows += row('Топливо (' + Math.round(r.fuelUsed) + ' кг)', '−' + fmtRub(r.fuelCost), 'neg');
    if (r.ops) rows += row('Обслуживание', '−' + fmtRub(r.ops), 'neg');
    if (r.fee) rows += row('Аэропортовые сборы', '−' + fmtRub(r.fee), 'neg');
    if (r.repair) rows += row('Ремонт самолёта', '−' + fmtRub(r.repair), 'neg');
    rows += row('<b>Итого</b>', (r.net >= 0 ? '+' : '−') + fmtRub(Math.abs(r.net)), r.net >= 0 ? 'pos' : 'neg');
  }
  const inc = f.incidents.map(i => i.text);
  menu.innerHTML = `<div class="panel wide">
    <h1>${ttl}</h1>
    ${r.kind === 'ok' ? `<div class="stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>` : ''}
    ${r.reason ? `<div class="sub">${r.reason}</div>` : ''}
    ${inc.length ? `<div class="sub">Замечания: ${[...new Set(inc)].join(', ')}</div>` : ''}
    <table class="res">${rows}</table>
    <div class="row">${stat('💰', fmtRub(save.money))}${stat('📍', apLoc().city)}</div>
    <div class="mrow"><button class="btn go" id="bAgain">Следующий рейс</button><button class="btn g" id="bHub">В меню</button></div>
  </div>`;
  mode = 'menu'; ui.classList.remove('on'); menu.classList.add('on');
  $('bAgain').onclick = () => setScreen('select');
  $('bHub').onclick = () => setScreen('hub');
  flight = null;
}

// ---------- главный цикл ----------
let lastMsgCount = 0, lastMsgKey = '';
function updateLog() {
  const f = flight, box = $('log');
  const fresh = f.msgs.filter(m => f.time - m.t < 6);
  const key = fresh.map(m => m.t).join(',');
  if (key !== lastMsgKey) { lastMsgKey = key; box.innerHTML = fresh.map(m => `<div>${m.text}</div>`).join(''); }
}
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts; tNow = ts / 1000;
  if (mode === 'flight' && flight) {
    const f = flight;
    if (!paused) {
      keyboardInput(dt);
      if (!f.done) {
        f.c.stick = stick.value; f.c.roll = stick.roll;
        const wasTd = !!f.td, wasAir = f.airborneOnce;
        const w = f.update(dt);
        view.warp = w;
        if (!wasTd && f.td) { view.bump = Math.min(14, 2 + f.td.sink * 3.5); }
        if (!wasAir && f.airborneOnce) view.bump = 1.5;
        view.bump *= Math.pow(0.02, dt);
        view.turb = f.h > 20 && f.h < 3500 ? 0.4 : f.h >= 3500 ? 0.15 : 0;
        view.rollKick = (view.rollKick || 0) * Math.pow(0.1, dt);
      } else {
        endTimer += dt;
        if (endTimer > 1.6) { showResult(); return; }
      }
    }
    drawFlight(ctx, W, H, f, tNow, view);
    syncButtons(); updateLog(); audioTick(f);
    const h = $('hint'), t = f.assist.hints && !f.done ? f.hint() : '';
    h.style.display = t ? 'block' : 'none'; if (t) h.textContent = t;
    if (f.done && f.result && f.result.kind !== 'ok') { ctx.fillStyle = 'rgba(160,0,0,.25)'; ctx.fillRect(0, 0, W, H); }
  } else {
    const pick = sel ? sel.to : null;
    drawMap(ctx, W, H, ts, { from: save.loc, to: pick, left: 0.02, width: 0.62, top: 0.2, height: 0.55 });
  }
}
requestAnimationFrame(loop);
renderMenu();

// отладка/тесты
window.__pilot = { get flight() { return flight; }, save, startFlight, setScreen, act, get mode() { return mode; } };
