// Интерфейс игры: меню, выбор рейса, ангар, управление в полёте, итоги, сохранение.
import { AIRPORTS, AP_BY, PLANES, PL_BY, bearing, distKm, contractsFor, maxRangeKm, recommendedCruise, fmtRub, makeWeather, metarText, windComp, WX_NAMES } from './data.js';
import { Flight, settle, FLAP_NAMES } from './sim.js';
import { EVENT_DEFS, EVENT_IDS } from './events.js';
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
const save = { money: 0, owned: ['ssj'], plane: 'ssj', loc: 'SVO', flights: 0, landings: 0, bestSink: null, pax: 0, assistAuto: true, assistCfg: true, assistTaxi: true, taxiOps: true, cam: 'chase', hints: true, tod: 'rnd', sound: true, seenHelp: false, emerg: 2, wxLvl: 1, xp: 0, evOk: 0, evLate: 0, evFail: 0 };
try { Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { }
if (!AP_BY[save.loc]) save.loc = 'SVO';
if (!PL_BY[save.plane] || !save.owned.includes(save.plane)) { save.plane = save.owned[0] || 'ssj'; }
const RANKS = [['Курсант', 0], ['Второй пилот', 500], ['Пилот', 1500], ['Командир', 3500], ['Капитан-инструктор', 7000], ['Легенда авиации', 15000]];
function rankOf(xp) { let i = 0; for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k][1]) i = k; const nx = RANKS[i + 1]; return { name: RANKS[i][0], i, next: nx ? nx[0] : null, from: RANKS[i][1], to: nx ? nx[1] : RANKS[i][1], pct: nx ? (xp - RANKS[i][1]) / (nx[1] - RANKS[i][1]) : 1 }; }
const EMERG_NAMES = ['выкл', 'редко', 'иногда', 'часто'];
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
  if (on && f.alerts && f.alerts.size && tNow - beepT > 0.9) { beepT = tNow; beep(950, 0.12); setTimeout(() => beep(650, 0.12), 150); }
  else if (on && f.warnings.size && tNow - beepT > 0.6 && (f.warnings.has('stall') || f.warnings.has('pullup') || f.warnings.has('gear') || f.warnings.has('sink'))) { beepT = tNow; beep(f.warnings.has('pullup') ? 1100 : 780, 0.18); }
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
  else if (screen === 'drill') renderDrill();
  else renderHangar();
}

function renderHub() {
  const ap = apLoc(), p = plane(), rk = rankOf(save.xp);
  menu.innerHTML = `<div class="panel">
    <h1>✈ Pilot Sim</h1>
    <div class="sub">Вы — пилот пассажирского лайнера. Берите рейсы, взлетайте, ведите самолёт и мягко садитесь. Деньги тратьте на самолёты побольше.</div>
    <div class="row">${stat('💰', fmtRub(save.money))}${stat('📍', ap.city + ' (' + ap.id + ')')}${stat('🛩', p.short)}</div>
    <div class="rank"><div class="row" style="justify-content:space-between"><b>🎖 ${rk.name}</b><span class="sub" style="margin:0">${save.xp} XP${rk.next ? ' · до «' + rk.next + '» ' + (rk.to - save.xp) : ''}</span></div><div class="bar2"><i style="width:${Math.round(rk.pct * 100)}%"></i></div></div>
    <div class="row">${stat('Рейсов:', save.flights)}${stat('Пассажиров:', save.pax.toLocaleString('ru-RU'))}${save.bestSink != null ? stat('Лучшая посадка:', save.bestSink.toFixed(2) + ' м/с') : ''}</div>
    <div class="mrow"><button class="btn go big" id="bFly">Выбрать рейс</button></div>
    <div class="mrow"><button class="btn g" id="bHangar">Ангар</button><button class="btn g" id="bDrill">Тренажёр ЧП</button><button class="btn g" id="bHelp">Как играть</button><button class="btn g" id="bSnd">Звук: ${save.sound ? 'вкл' : 'выкл'}</button></div>
    <div class="sub" style="margin-top:14px;opacity:.6">Данные сохраняются на устройстве. ${save.flights ? '<a href="#" id="bReset" style="color:#ff9a9a">Сбросить прогресс</a>' : ''}</div>
  </div>`;
  $('bFly').onclick = () => { audioInit(); setScreen('select'); };
  $('bHangar').onclick = () => setScreen('hangar');
  $('bHelp').onclick = showHelp;
  $('bDrill').onclick = () => setScreen('drill');
  $('bSnd').onclick = () => { save.sound = !save.sound; persist(); if (save.sound) audioInit(); renderHub(); };
  const r = $('bReset');
  if (r) r.onclick = e => { e.preventDefault(); showModal(`<h2>Сбросить прогресс?</h2><div class="sub">Деньги, самолёты и статистика будут удалены.</div><div class="mrow"><button class="btn g" id="mNo">Отмена</button><button class="btn" style="background:#a23232" id="mYes">Сбросить</button></div>`);
    $('mNo').onclick = hideModal; $('mYes').onclick = () => { try { localStorage.removeItem(KEY); } catch (e) { } location.reload(); }; };
  if (!save.seenHelp) { save.seenHelp = true; persist(); showHelp(); }
}

function showHelp() {
  showModal(`<h2>Как играть</h2>
  <div class="sub"><b>Слева — газ</b> (ползунок вверх — больше тяги). <b>Справа — ручка</b>: вверх — нос вверх, вниз — нос вниз; отпустили — самолёт сам держит траекторию.<br><br>
  <b>0. Руление.</b> Вы стоите на гейте. Отпустите ТОРМОЗ и поднимите газ до 15–30% (нижняя треть ползунка — скорость руления). Штурвал вправо/влево поворачивает. Следуйте за жёлтой меткой на рулёжную дорожку и на полосу. Кнопка АВТО РУЛ включает автоматическое руление. После посадки сверните на рулёжную дорожку и заруливайте на гейт — рейс засчитывается, когда самолёт встал на стоянку. Кнопка ВИД переключает вид снаружи и из кабины.<br>
  <b>1. Взлёт.</b> На полосе отпустите ТОРМОЗ, газ на максимум, на скорости VR плавно тяните ручку вверх (тангаж 10–12°). Над землёй уберите ШАССИ.<br>
  <b>2. Полёт.</b> Включите А/П (автопилот), ВЫС ± задаёт высоту. Когда самолёт в крейсере, жмите ×2…×32 — время ускоряется.<br>
  <b>3. Посадка.</b> ПОСАДКА включает заход по глиссаде: выпускайте закрылки и шасси по подсказкам. У земли слегка потяните ручку на себя и сбросьте газ. После касания — ТОРМОЗ.<br><br>
  <b>ЧП.</b> В полёте случаются отказы: двигатель, пожар, птицы, гидравлика, разгерметизация, отказ автопилота и автомата тяги, техника на полосе. Справа вверху — чек-лист действий, внизу красные кнопки (ТУШЕНИЕ, ЗАПАС. ШАССИ, АВАР. СНИЖ., УХОД). Правильные действия дают премию и опыт — растёт ваш ранг. Ускорение времени при ЧП выключено. Потренироваться можно в «Тренажёре ЧП».<br><br>
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
      <label class="chk"><input type="checkbox" id="oTaxiOps" ${save.taxiOps ? 'checked' : ''}> Полный цикл: старт с гейта, рулёжная дорожка, полоса, посадка и заруливание на гейт</label>
      <label class="chk"><input type="checkbox" id="oTaxi" ${save.assistTaxi ? 'checked' : ''}> Помощник: автоматическое руление (сами берёте управление кнопкой АВТО РУЛ)</label>
      <label class="chk"><input type="checkbox" id="oHint" ${save.hints ? 'checked' : ''}> Подсказки на экране</label>
      <label class="chk">Аварийные ситуации: <select id="oEm"><option value="0">выкл</option><option value="1">редко</option><option value="2">иногда</option><option value="3">часто</option></select> (за грамотные действия — премия и опыт)</label>
      <label class="chk">Погода: <select id="oWx"><option value="0">штиль</option><option value="1">обычная</option><option value="2">сложная</option></select> (ветер, видимость, дождь; перед вылетом — брифинг)</label>
      <label class="chk">Время суток: <select id="oTod"><option value="rnd">случайное</option><option value="0">день</option><option value="1">закат</option><option value="2">ночь</option></select></label>
      <button class="btn go big" id="bGo">Лететь ✈</button>
    </div>
  </div>`;
  $('oTod') && ($('oTod').value = String(save.tod));
  $('oEm') && ($('oEm').value = String(save.emerg));
  $('oWx') && ($('oWx').value = String(save.wxLvl));
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
    $('oTaxiOps').onchange = e => { save.taxiOps = e.target.checked; persist(); };
    $('oTaxi').onchange = e => { save.assistTaxi = e.target.checked; persist(); };
    $('oHint').onchange = e => { save.hints = e.target.checked; persist(); };
    $('oTod').onchange = e => { save.tod = e.target.value; persist(); };
    $('oEm').onchange = e => { save.emerg = +e.target.value; persist(); };
    $('oWx').onchange = e => { save.wxLvl = +e.target.value; persist(); };
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

function renderDrill() {
  menu.innerHTML = `<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Тренажёр ЧП</h1><button class="btn g" id="bBack">‹ Назад</button></div>
    <div class="sub">Выберите аварийную ситуацию — она случится в нужный момент короткого рейса. Деньги и опыт в тренировке не начисляются. Самолёт: ${plane().short}.</div>
    ${EVENT_IDS.map(id => `<div class="card" data-ev="${id}"><div><div class="t">${EVENT_DEFS[id].short}</div><div class="d">${EVENT_DEFS[id].desc}</div></div><div class="r">▶</div></div>`).join('')}
  </div>`;
  $('bBack').onclick = () => setScreen('hub');
  menu.querySelectorAll('[data-ev]').forEach(el => el.onclick = () => {
    const ap = apLoc(), p = plane();
    const list = contractsFor(p, ap.id, 777 + ap.id.charCodeAt(0));
    const c = list.find(x => x.km >= 500) || list[list.length - 1];
    if (!c) { showModal('<h2>Нет рейсов</h2><div class="sub">Смените самолёт или аэропорт.</div><div class="mrow"><button class="btn" id="mOk">Ок</button></div>'); $('mOk').onclick = hideModal; return; }
    startFlight(c, el.dataset.ev);
  });
}

// ---------- запуск рейса ----------
function startFlight(c, drill) {
  audioInit();
  const from = apLoc(), to = AP_BY[c.to];
  const brg = bearing(from, to);
  const wx = makeWeather(Math.random, drill ? 0 : save.wxLvl, brg);
  if (drill || !wx.level) return beginFlight(c, drill, wx);
  const wc = windComp(wx, brg), hw = Math.round(wc.head), cwv = Math.round(Math.abs(wc.cross));
  showModal(`<h2>Брифинг перед вылетом</h2>
    <div class="sub"><b>Вылет:</b> ${metarText(from, wx, 'dep')}<br><b>Назначение:</b> ${metarText(to, wx, 'dst')}<br><br>
    Для полосы по маршруту: ${hw >= 0 ? 'встречный' : 'попутный'} ветер ${Math.abs(hw)} м/с, боковой ${cwv} м/с${wc.cross > 0.5 ? ' справа' : wc.cross < -0.5 ? ' слева' : ''}.
    ${wx.vis < 1500 || wx.visD < 1500 ? '<br>⚠ Низкая видимость: заходите по глиссаде (кнопка ПОСАДКА).' : ''}${wx.spd + wx.gust > 12 ? '<br>⚠ Сильный ветер и порывы: держите курс на заходе, возможен снос.' : ''}</div>
    <div class="mrow"><button class="btn g" id="mNo">Отмена</button><button class="btn go" id="mGo">Лететь ✈</button></div>`);
  $('mNo').onclick = hideModal; $('mGo').onclick = () => beginFlight(c, drill, wx);
}
function beginFlight(c, drill, wx) {
  const from = apLoc(), to = AP_BY[c.to], p = plane();
  const tod = save.tod === 'rnd' ? [0, 0, 0, 1, 2][Math.floor(Math.random() * 5)] : +save.tod;
  contract = c;
  flight = new Flight({ wx, plane: p, from, to, bearing: bearing(from, to), distM: c.km * 1000, pax: c.pax, fuelKg: Math.min(p.fuelCap, c.fuel + ((save.emerg || drill) ? p.burnHr * 0.25 : 0)),
    taxi: drill ? false : save.taxiOps, drill: !!drill, force: drill ? [drill] : undefined, emerg: drill ? 0 : save.emerg, assist: { auto: save.assistAuto, config: save.assistCfg, hints: save.hints, taxi: save.assistTaxi }, tod, recAlt: recommendedCruise(c.km) });
  flight.c.flaps = 2; flight.flapAct = 2; flight.c.brake = true; flight.c.thr = 0;
  if (drill) { flight.assist.auto = true; flight.assist.config = true; }
  view = { bump: 0, turb: 0, rollKick: 0, warp: 1, cam: save.cam, map: true, mapZoom: 0 };
  stick.value = 0; stick.roll = 0; setYoke(); thrSet(0, true);
  endTimer = 0; paused = false; lastMsgCount = 0;
  mode = 'flight'; menu.classList.remove('on'); ui.classList.add('on'); $('log').innerHTML = ''; toggleAlt(false);
  hideModal();
}

// ---------- ввод: газ и ручка ----------
const yokeEl = $('yoke'), yokeG = $('yokeG');
const stick = { value: 0, roll: 0, id: null };
const thrEls = [$('thr1'), $('thr2')];
let thrLinked = true;
function thrPaint(v1, v2) {
  [v1, v2].forEach((v, i) => { thrEls[i].querySelector('.tf').style.height = (v * 100) + '%'; thrEls[i].querySelector('.tv').textContent = Math.round(v * 100) + '%'; });
}
// idx: 0/1 — один двигатель, -1 — оба
function thrSet(v, silent, idx = -1) {
  v = Math.max(0, Math.min(1, v));
  const f = flight;
  if (f) {
    const c = f.c;
    if (idx < 0 || thrLinked) { c.t1 = c.t2 = c.thr = v; c.split = false; }
    else { if (!c.split) { c.t1 = c.t2 = c.thr; c.split = true; } if (idx === 0) c.t1 = v; else c.t2 = v; c.thr = (c.t1 + c.t2) / 2; }
    if (!silent) c.atOn = false;
    thrPaint(c.split ? c.t1 : c.thr, c.split ? c.t2 : c.thr);
  } else thrPaint(v, v);
}
thrEls.forEach((el, i) => {
  const mv = e => { const r = el.getBoundingClientRect(); thrSet(1 - (e.clientY - r.top) / r.height, false, i); };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); mv(e); });
  el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) mv(e); });
});
$('thrlink').onclick = () => {
  thrLinked = !thrLinked;
  $('thrlink').classList.toggle('on', thrLinked); $('thrlink').textContent = thrLinked ? 'СВЯЗАНЫ' : 'РАЗДЕЛЬНО';
  if (thrLinked && flight) { const c = flight.c; const m = (c.split ? (c.t1 + c.t2) / 2 : c.thr); thrSet(m, true); }
};
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

// ---------- запасные аэродромы ----------
let altOpen = false, altT = 0;
function toggleAlt(force) {
  altOpen = force !== undefined ? force : !altOpen;
  $('altp').classList.toggle('on', altOpen);
  if (altOpen) { altT = 0; renderAlt(); }
}
function renderAlt() {
  const f = flight; if (!f) return;
  const list = f.altList().slice(0, 5), box = $('altp');
  const arrow = a => { let d = ((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; return `<span style="display:inline-block;transform:rotate(${(d * 180 / Math.PI).toFixed(0)}deg)">➤</span>`; };
  const desc = f.ev ? '<div class="d" style="margin-bottom:4px;color:#ffb3ab">Аварийная ситуация — можно сесть на ближайшем подходящем аэродроме (рейс будет оплачен частично).</div>' : '';
  box.innerHTML = `<h3>Запасные аэродромы</h3>${desc}` + (list.length ? list.map((o, i) => `<div class="it ${o.ok ? 'ok' : 'no'}" data-i="${i}"><div class="ar">${arrow(o.rel)}</div><div><div class="t">${o.label}</div><div class="d">${Math.round(o.d / 1000)} км · ВПП ${o.w.len} м${o.ok ? '' : ' · ' + (o.why || 'сейчас недоступен')}</div></div></div>`).join('') : '<div class="d">Поблизости аэродромов нет.</div>') + '<button class="cl" id="altX">Закрыть</button>';
  box.querySelectorAll('.it.ok').forEach(el => el.onclick = () => { const o = list[+el.dataset.i]; if (o && f.divertTo(o.w)) toggleAlt(false); });
  $('altX').onclick = () => toggleAlt(false);
}

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
    case 'altp': toggleAlt(); break;
    case 'ext': f.extinguish(); break;
    case 'altgear': f.altGearExt(); break;
    case 'emdesc': f.emergDescent(); break;
    case 'ga': f.goAround(); break;
    case 'ap':
      if (f.apLock > 0) { f.msg('Автопилот неисправен — пилотируйте вручную'); break; }
      if (c.apOn) { c.apOn = false; c.appr = false; f.apprCap = false; c.atOn = false; }
      else if (!f.onGround) { c.apOn = true; c.atOn = true; if (f.h < 3000 && !c.appr) c.apAlt = f.dist < 60000 ? 1500 : f.recAlt; if (f.dist >= 60000) c.apAlt = f.recAlt; }
      break;
    case 'at': if (f.atLock > 0) { f.msg('Автомат тяги неисправен — управляйте газом'); break; } c.atOn = !c.atOn; break;
    case 'nav': if (f.fx.gps) { f.msg('GPS потерян — навигация недоступна'); break; } c.nav = !c.nav; break;
    case 'map': view.map = view.map === false; break;
    case 'rev': if (f.onGround && f.v > 15) { c.rev = !c.rev; if (c.rev) f.msg('Реверс включён: рычагами регулируйте обратную тягу'); else { c.thr = c.t1 = c.t2 = 0; c.split = false; thrSet(0, true); } } else f.msg('Реверс — только на пробеге (скорость выше 55 км/ч)'); break;
    case 'abrk': c.abrk = ((c.abrk || 0) + 1) % 4; f.msg('Автоторможение: ' + (c.abrk ? 'режим ' + c.abrk : 'выкл')); break;
    case 'taxi': if (f.onGround && f.taxiOps) c.taxiAuto = !c.taxiAuto; break;
    case 'view': save.cam = save.cam === 'chase' ? 'cockpit' : 'chase'; view.cam = save.cam; persist(); break;
    case 'altd': c.apAlt = Math.max(300, c.apAlt - (c.apAlt > 3000 ? 600 : 300)); break;
    case 'altu': c.apAlt = Math.min(f.p.ceiling - 600, c.apAlt + (c.apAlt >= 3000 ? 600 : 300)); break;
    case 'appr': if (f.apLock > 0) { f.msg('Автопилот неисправен'); break; } if (!c.apOn && !f.onGround) { c.apOn = true; c.atOn = true; } c.appr = !c.appr; if (!c.appr) f.apprCap = false; break;
  }
}
ui.querySelectorAll('#btns button, #ebtns button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); act(b.dataset.act); }));
$('mapzone').addEventListener('pointerdown', e => { e.preventDefault(); if (!view) return; view.mapZoom = ((view.mapZoom || 0) + 1) % 10; if (flight) flight.msg(view.mapZoom ? 'Карта: масштаб зафиксирован' : 'Карта: масштаб авто'); });
$('eact').addEventListener('pointerdown', e => { const b = e.target.closest('button'); if (!b || !flight) return; e.preventDefault(); flight.evAction(b.dataset.k); });

function syncButtons() {
  const f = flight, c = f.c;
  const on = (id, v) => $(id).classList.toggle('on', !!v);
  on('bGear', c.gear); $('bGear').textContent = 'ШАССИ ' + (f.gearPos > 0.98 ? '▼' : f.gearPos < 0.02 ? '▲' : '…');
  $('bFlD').textContent = 'ЗАКР − (' + FLAP_NAMES[c.flaps] + ')'; $('bFlU').textContent = 'ЗАКР +';
  thrEls.forEach((el, i) => { el.querySelector('.lb').textContent = c.rev ? 'РЕВ' + (i + 1) : 'ДВ' + (i + 1); });
  on('bRev', c.rev); $('bRev').classList.toggle('warn', !!c.rev); $('bAbrk').textContent = 'АВТОТОРМ ' + (c.abrk ? c.abrk : '—'); on('bAbrk', c.abrk > 0);
  on('bBrake', c.brake); $('bBrake').classList.toggle('warn', c.brake && f.onGround && !f.td && f.v < 1);
  on('bAp', c.apOn); on('bAt', c.atOn); on('bNav', c.nav && c.apOn); on('bTaxi', c.taxiAuto && f.onGround); $('bTaxi').disabled = !f.onGround || !f.taxiOps;
  $('bView').textContent = save.cam === 'chase' ? 'ВИД: СНАРУЖИ' : 'ВИД: КАБИНА'; on('bAppr', c.appr);
  $('bAltD').textContent = 'ВЫС − ' + (c.apOn ? Math.round(c.apAlt) : '');
  $('bAltU').textContent = 'ВЫС +';
  const w = f.effectiveWarp(); $('bWarp').textContent = '×' + c.warp + (w !== c.warp ? ' (' + w + ')' : ''); on('bWarp', c.warp > 1);
  const ev = f.evView(), evp = $('evp');
  if (ev) { evp.style.display = 'block'; const hh = `<b>⚠ ${ev.title}</b>` + ev.steps.map(st => `<div class="${st.done ? 'ok' : 'no'}">${st.done ? '✓' : '•'} ${st.t}</div>`).join(''); if (hh !== evp._h) { evp._h = hh; evp.innerHTML = hh; } }
  else { evp.style.display = 'none'; evp._h = ''; }
  { const mz = $('mapzone'), r = view.mapRect; if (r) { mz.style.display = 'block'; mz.style.left = r.x + 'px'; mz.style.top = r.y + 'px'; mz.style.width = r.s + 'px'; mz.style.height = r.s + 'px'; } else mz.style.display = 'none'; }
  const sh = (id, v) => $(id).classList.toggle('show', !!v);
  sh('eExt', f.fire && !f.fire.ext);
  sh('eGear', (f.hyd || f.fx.gearStuck) && !f.altGear);
  { const eb = f.evBtns(), key = eb.map(b => b.k).join('|'), ea = $('eact'); if (key !== ea._k) { ea._k = key; ea.innerHTML = eb.map(b => `<button data-k="${b.k}">${b.t}</button>`).join(''); } }
  if (f.ev && f.ev.id === 'surge' && thrLinked && !f.ev._unl) { f.ev._unl = true; $('thrlink').onclick(); }
  sh('eDesc', f.decomp && f.ev && f.ev.id === 'decomp' && !f.emDescent);
  sh('eAlt', !f.onGround && f.airborneOnce && !f.td);
  $('eAlt').classList.toggle('urgent', !!f.ev && f.ev.id !== 'runway' && f.ev.id !== 'apFail' && f.ev.id !== 'atFail');
  if (altOpen) { altT -= 0.016; if (altT <= 0) { altT = 0.7; renderAlt(); } if (f.onGround || f.done) toggleAlt(false); }
  sh('eGa', f.canGoAround() && (f.rwyBlocked || f.dist < 9000));
  $('hint').classList.toggle('alert', !!f.ev);
  if (c.atOn || !c.split) thrPaint(c.thr, c.thr);
}

// ---------- клавиатура ----------
addEventListener('keydown', e => {
  if (mode !== 'flight' || !flight) return;
  keys[e.code] = true;
  const m = { KeyG: 'gear', KeyF: 'fl+', KeyV: 'fl-', KeyB: 'brake', KeyA: 'ap', KeyT: 'warp', KeyL: 'appr', BracketRight: 'altu', BracketLeft: 'altd', KeyN: 'at', KeyC: 'view', KeyR: 'taxi', KeyM: 'map', KeyU: 'rev', KeyO: 'abrk' }[e.code];
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
  // раздельно: Q/Z — левый двигатель, E/X — правый (при несвязанных рычагах)
  let d1 = 0, d2 = 0; if (keys.KeyQ) d1 += 0.4; if (keys.KeyZ) d1 -= 0.4; if (keys.KeyE) d2 += 0.4; if (keys.KeyX) d2 -= 0.4;
  if (d1 || d2) { const c = f.c; const a = c.split ? c.t1 : c.thr, b = c.split ? c.t2 : c.thr; const was = thrLinked; thrLinked = false; if (d1) thrSet(a + d1 * dt, false, 0); if (d2) thrSet((c.split ? c.t2 : b) + d2 * dt, false, 1); thrLinked = was; }
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
  const drill = !!f.drill;
  const rkBefore = rankOf(save.xp).i;
  if (!drill) {
    save.money = Math.max(0, save.money + r.net);
    if (r.kind !== 'abort') save.flights++;
    if (r.kind === 'ok' || r.kind === 'overrun') { save.loc = f.locAfter; }
    if (r.kind === 'ok') { save.landings++; save.pax += r.pax; if (save.bestSink == null || r.sink < save.bestSink) save.bestSink = r.sink; }
    save.xp += r.xp; save.evOk += r.evOk; save.evLate += r.evLate; save.evFail += r.evFail;
    persist();
  }
  const rkAfter = rankOf(save.xp);
  const ttl = drill ? 'Тренировка окончена' : { ok: r.quality, crash: 'Катастрофа', overrun: 'Выкатились за полосу', forced: 'Рейс сорван', missed: 'Аэропорт пролетели', abort: 'Рейс отменён' }[r.kind];
  const row = (a, v, cls) => `<tr><td>${a}</td><td class="${cls || ''}">${v}</td></tr>`;
  let rows = '';
  if (r.kind !== 'abort' && !drill) {
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
  if (r.kind === 'abort' && r.evPrem && !drill) rows += row('Премия за верное решение при ЧП', '+' + fmtRub(r.evPrem), 'pos');
  if (r.kind === 'ok' && r.evBonus > 0 && !drill) rows += row('Премия за действия при ЧП', '+' + Math.round(r.evBonus * 100) + '%', 'pos');
  const evTxt = { ok: '✓ отлично', late: '⚠ с опозданием', fail: '✕ провал' };
  const evRows = r.evLog.map(e => `<div class="evrow"><span>${e.title}</span><span class="${e.outcome}">${evTxt[e.outcome]}</span></div>`).join('');
  const inc = f.incidents.map(i => i.text);
  menu.innerHTML = `<div class="panel wide">
    <h1>${ttl}</h1>
    ${r.kind === 'ok' ? `<div class="stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>` : ''}
    ${r.reason ? `<div class="sub">${r.reason}</div>` : ''}
    ${inc.length ? `<div class="sub">Замечания: ${[...new Set(inc)].join(', ')}</div>` : ''}
    ${evRows ? `<div class="sub" style="margin-bottom:2px"><b>Аварийные ситуации:</b></div>${evRows}` : ''}
    <table class="res">${rows}</table>
    ${drill ? '' : `<div class="sub">+${r.xp} XP · ${rkAfter.name}${rkAfter.i > rkBefore ? ' — <b style="color:#7dffb0">НОВЫЙ РАНГ!</b>' : ''}</div>`}
    ${drill ? '' : `<div class="row">${stat('💰', fmtRub(save.money))}${stat('📍', apLoc().city)}</div>`}
    <div class="mrow"><button class="btn go" id="bAgain">${drill ? 'Ещё тренировка' : 'Следующий рейс'}</button><button class="btn g" id="bHub">В меню</button></div>
  </div>`;
  mode = 'menu'; ui.classList.remove('on'); menu.classList.add('on');
  $('bAgain').onclick = () => setScreen(drill ? 'drill' : 'select');
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
        view.warp = w; view.cam = save.cam;
        if (!wasTd && f.td) { view.bump = Math.min(14, 2 + f.td.sink * 3.5); }
        if (!wasAir && f.airborneOnce) view.bump = 1.5;
        view.bump *= Math.pow(0.02, dt);
        view.turb = (f.h > 20 && f.h < 3500 ? 0.4 : f.h >= 3500 ? 0.15 : 0) + f.fx.turb * 1.6;
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
    const fd = $('fade');
    if (f.fade > 0) { fd.style.display = 'flex'; fd.style.opacity = Math.min(1, f.fade * 2); fd.textContent = f.fadeText; } else if (fd.style.display !== 'none') fd.style.display = 'none';
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
