// Интерфейс игры: меню, выбор рейса, ангар, управление в полёте, итоги, сохранение.
import { ICAO } from './icao.js';
import { AIRPORTS, AP_BY, PLANES, PL_BY, bearing, distKm, contractsFor, maxRangeKm, recommendedCruise, fmtRub, makeWeather, fetchMetar, applyMetar, metarText, windComp, WX_NAMES } from './data.js';
import { Flight, settle, loadInfo, FLAP_NAMES } from './sim.js';
import { EVENT_DEFS, EVENT_IDS } from './events.js';
import { drawFlight, drawMap, setUiScale } from './render.js';

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
const save = { money: 0, owned: ['ssj'], plane: 'ssj', loc: 'SVO', flights: 0, landings: 0, bestSink: null, pax: 0, assistAuto: true, assistCfg: true, assistTaxi: true, taxiOps: true, cam: 'chase', hints: true, tod: 'rnd', sound: true, seenHelp: false, emerg: 2, wxLvl: 1, season: 0, xp: 0, evOk: 0, evLate: 0, evFail: 0, wear: {}, fatigue: 0, fuelMul: 1, crews: 0, school: {}, daily: {}, top: [], stat: { maxKm: 0, streak: 0, best: 0, min: 0 }, rep: 50, lease: {}, copilot: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { }
if (!AP_BY[save.loc]) save.loc = 'SVO';
const fleetIds = () => [...save.owned, ...Object.keys(save.lease).filter(k => save.lease[k] > 0 && !save.owned.includes(k))];
if (!PL_BY[save.plane] || !fleetIds().includes(save.plane)) { save.plane = save.owned[0] || 'ssj'; }
const wearOf = id => Math.round(save.wear[id] || 0);
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
let actx = null, eng = null, engGain = null, beepT = 0, masterG = null;
function audioInit() {
  if (actx || !save.sound) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterG = actx.createGain(); masterG.connect(actx.destination); applyVol();
    eng = actx.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 60;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    engGain = actx.createGain(); engGain.gain.value = 0;
    eng.connect(lp); lp.connect(engGain); engGain.connect(masterG); eng.start();
  } catch (e) { actx = null; }
}
function beep(freq, dur) {
  if (!actx || !save.sound) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.05;
    o.connect(g); g.connect(masterG || actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { }
}
let noiseG = null, noiseF = null, spoken = new Set(), lastVoice = 0, radioN = 0;
function say(text, pitch) {
  if (!save.sound || save.voice === false || !window.speechSynthesis) return;
  try { const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; u.rate = 1.05; u.pitch = pitch || 1; u.volume = 0.8 * (save.vol == null ? 1 : save.vol); speechSynthesis.speak(u); } catch (e) { }
}
const VOICE = { gear: 'Шасси', stall: 'Сваливание', pullup: 'Тяните вверх, земля', sink: 'Большая вертикальная скорость', flaps: 'Закрылки', over: 'Превышение скорости', terrain: 'Внимание, земля', lowfuel: 'Мало топлива' };
let vibT = 0, vibTd = null;
function vib(p) { try { if (save.sound && save.vibr !== false && navigator.vibrate) navigator.vibrate(p); } catch (e) { } }
function vibeTick(f) {
  if (mode !== 'flight' || paused) return;
  if (f.td && f.td !== vibTd) { vibTd = f.td; vib(f.td.sink > 2.4 ? [220, 80, 220] : f.td.sink > 1.4 ? 90 : 40); }
  if (!f.td) vibTd = null;
  if (tNow - vibT > 0.8) { if (f.stallWarn) { vibT = tNow; vib(120); } else if ((f.fx.turb || 0) > 0.4 && !f.onGround) { vibT = tNow; vib(35); } }
}
function audioTick(f) {
  vibeTick(f);
  if (actx && !noiseG) {
    try {
      const n = actx.sampleRate * 2, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      noiseF = actx.createBiquadFilter(); noiseF.type = 'bandpass'; noiseF.frequency.value = 900; noiseF.Q.value = 0.6;
      noiseG = actx.createGain(); noiseG.gain.value = 0; src.connect(noiseF); noiseF.connect(noiseG); noiseG.connect(masterG || actx.destination); src.start();
    } catch (e) { noiseG = null; }
  }
  if (noiseG) {
    const on = save.sound && mode === 'flight' && !paused;
    const wx = f.wx || {}, rain = f.onGround ? (wx.rain || 0) : (wx.rainD || 0);
    const air = f.onGround ? Math.min(1, f.v / 80) * 0.5 : Math.min(1, f.v / 250);
    noiseG.gain.value = on ? Math.min(0.12, 0.012 * (wx.spd || 0) / 4 + 0.05 * rain + 0.035 * air) : 0;
    noiseF.frequency.value = 500 + 900 * Math.max(rain, air);
  }
  if (save.sound && mode === 'flight' && !paused && f.radio && f.radio.length) { const r = f.radio.splice(0); for (const t of r) setTimeout(() => say(t.replace('🔊 Бортпроводник: ', ''), t.startsWith('🔊') ? 1.35 : 0.8), 400); }
  if (save.sound && mode === 'flight' && !paused && f.warnings) {
    for (const k of f.warnings) if (VOICE[k] && !spoken.has(k) && tNow - lastVoice > 1.5) { spoken.add(k); lastVoice = tNow; say(VOICE[k], 1.2); }
    for (const k of [...spoken]) if (!f.warnings.has(k)) spoken.delete(k);
  }
  if (!actx || !engGain) return;
  const on = save.sound && mode === 'flight' && !paused;
  engGain.gain.value = on ? 0.03 + 0.07 * f.thrAct : 0;
  eng.frequency.value = (55 + 90 * f.thrAct) * Math.max(0.7, Math.min(1.3, 1.3 - f.p.T0 / 1100000)) * (f.engCount === 1 ? 0.9 : 1);
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
  else if (screen === 'school') renderSchool();
  else if (screen === 'settings') renderSettings();
  else if (screen === 'records') renderRecords();
  else renderHangar();
}

function renderHub() {
  const ap = apLoc(), p = plane(), rk = rankOf(save.xp);
  menu.innerHTML = `<div class="panel">
    <h1>✈ Pilot Sim</h1>
    <div class="sub">Вы — пилот пассажирского лайнера. Берите рейсы, взлетайте, ведите самолёт и мягко садитесь. Деньги тратьте на самолёты побольше.</div>
    <div class="row">${stat('💰', fmtRub(save.money))}${stat('📍', ap.city + ' (' + ap.id + ')')}${stat('🛩', p.short)}${stat('😴 усталость', Math.round(save.fatigue || 0) + '%')}${(save.fatigue || 0) >= 25 ? '<button class="chip" id="bRest" style="color:#fff">Отдых · ' + fmtRub(40000) + '</button>' : ''}</div>
    <div class="rank"><div class="row" style="justify-content:space-between"><b>🎖 ${rk.name}</b><span class="sub" style="margin:0">${save.xp} XP${rk.next ? ' · до «' + rk.next + '» ' + (rk.to - save.xp) : ''}</span></div><div class="bar2"><i style="width:${Math.round(rk.pct * 100)}%"></i></div></div>
    <div class="row">${stat('Рейсов:', save.flights)}${stat('Пассажиров:', save.pax.toLocaleString('ru-RU'))}${save.bestSink != null ? stat('Лучшая посадка:', save.bestSink.toFixed(2) + ' м/с') : ''}</div>
    <div class="mrow"><button class="btn go big" id="bFly">Выбрать рейс</button></div>
    <div class="mrow"><button class="btn g" id="bHangar">Ангар</button><button class="btn g" id="bDrill">Тренажёр ЧП</button><button class="btn g" id="bSchool">Лётная школа</button><button class="btn g" id="bRec">Рекорды</button><button class="btn g" id="bSet">⚙ Настройки</button><button class="btn g" id="bHelp">Как играть</button><button class="btn g" id="bSnd">Звук: ${save.sound ? 'вкл' : 'выкл'}</button></div>
    <div class="sub" style="margin-top:14px;opacity:.6">Данные сохраняются на устройстве. ${save.flights ? '<a href="#" id="bReset" style="color:#ff9a9a">Сбросить прогресс</a>' : ''}</div>
  </div>`;
  $('bFly').onclick = () => { audioInit(); setScreen('select'); };
  $('bHangar').onclick = () => setScreen('hangar');
  $('bHelp').onclick = showHelp;
  $('bDrill').onclick = () => setScreen('drill');
  if ($('bRest')) $('bRest').onclick = () => { if (save.money >= 40000) { save.money -= 40000; save.fatigue = 0; persist(); renderHub(); } };
  $('bSet').onclick = () => setScreen('settings');
  $('bSchool').onclick = () => setScreen('school'); $('bRec').onclick = () => setScreen('records');
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

function optsHTML() {
  return `
      <label class="chk"><input type="checkbox" id="oAuto" ${save.assistAuto ? 'checked' : ''}> Помощник: автопилот сам набирает высоту, снижается и ведёт по глиссаде</label>
      <label class="chk"><input type="checkbox" id="oCfg" ${save.assistCfg ? 'checked' : ''}> Помощник: сам выпускает и убирает шасси и закрылки</label>
      <label class="chk"><input type="checkbox" id="oTaxiOps" ${save.taxiOps ? 'checked' : ''}> Полный цикл: старт с гейта, рулёжная дорожка, полоса, посадка и заруливание на гейт</label>
      <label class="chk"><input type="checkbox" id="oTaxi" ${save.assistTaxi ? 'checked' : ''}> Помощник: автоматическое руление (сами берёте управление кнопкой АВТО РУЛ)</label>
      <label class="chk"><input type="checkbox" id="oHint" ${save.hints ? 'checked' : ''}> Подсказки на экране</label>
      <label class="chk">Аварийные ситуации: <select id="oEm"><option value="0">выкл</option><option value="1">редко</option><option value="2">иногда</option><option value="3">часто</option></select> (за грамотные действия — премия и опыт)</label>
      <label class="chk">Погода: <select id="oWx"><option value="0">штиль</option><option value="1">обычная</option><option value="2">сложная</option></select> (ветер, видимость, дождь; перед вылетом — брифинг)</label>
      <label class="chk">Сезон: <select id="oSe"><option value="0">случайный</option><option value="1">лето</option><option value="2">зима (снег, накат)</option></select></label>
      <label class="chk">Время суток: <select id="oTod"><option value="rnd">случайное</option><option value="0">день</option><option value="1">закат</option><option value="2">ночь</option></select></label>
  `;
}
function bindOpts() {
  $('oTod') && ($('oTod').value = String(save.tod));
  $('oEm') && ($('oEm').value = String(save.emerg));
  $('oWx') && ($('oWx').value = String(save.wxLvl)); $('oSe') && ($('oSe').value = String(save.season || 0));
    $('oAuto').onchange = e => { save.assistAuto = e.target.checked; persist(); };
    $('oCfg').onchange = e => { save.assistCfg = e.target.checked; persist(); };
    $('oTaxiOps').onchange = e => { save.taxiOps = e.target.checked; persist(); };
    $('oTaxi').onchange = e => { save.assistTaxi = e.target.checked; persist(); };
    $('oHint').onchange = e => { save.hints = e.target.checked; persist(); };
    $('oTod').onchange = e => { save.tod = e.target.value; persist(); };
    $('oEm').onchange = e => { save.emerg = +e.target.value; persist(); };
    $('oWx').onchange = e => { save.wxLvl = +e.target.value; persist(); };
    $('oSe').onchange = e => { save.season = +e.target.value; persist(); };
}

// ---------- настройки ----------
function renderSettings() {
  menu.innerHTML = `<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Настройки</h1><button class="btn g" id="bBack">‹ Назад</button></div>
    <div class="sub"><b>Игра</b></div>
    <div class="grp">${optsHTML()}</div>
    <div class="sub" style="margin-top:10px"><b>Звук и отклик</b></div>
    <div class="grp">
      <label class="chk"><input type="checkbox" id="sSnd" ${save.sound ? 'checked' : ''}> Звук (двигатели, ветер, сигнализация)</label>
      <label class="chk">Громкость: <input type="range" id="sVol" min="0" max="100" value="${Math.round((save.vol == null ? 1 : save.vol) * 100)}"></label>
      <label class="chk"><input type="checkbox" id="sVoice" ${save.voice !== false ? 'checked' : ''}> Голос: диспетчер, бортпроводник, предупреждения</label>
      <label class="chk"><input type="checkbox" id="sVib" ${save.vibr !== false ? 'checked' : ''}> Вибрация (касание, сваливание, болтанка)</label>
    </div>
    <div class="sub" style="margin-top:10px"><b>Экран и управление</b></div>
    <div class="grp">
      <label class="chk">Вид по умолчанию: <select id="sCam"><option value="chase">снаружи</option><option value="cockpit">из кабины</option></select></label>
      <label class="chk">Размер интерфейса: <select id="sUi"><option value="1">обычный</option><option value="1.2">крупный</option><option value="1.4">очень крупный</option></select></label>
      <label class="chk"><input type="checkbox" id="sTrack" ${save.trackHold !== false ? 'checked' : ''}> Самолёт сам держит трассу, пока вы не трогаете штурвал</label>
      <label class="chk">Снос ветром: <select id="sDrift"><option value="1">полный</option><option value="0.5">ослаблен</option><option value="0.15">минимальный</option><option value="0">нет</option></select></label>
      <label class="chk"><input type="checkbox" id="sLeft" ${save.lefty ? 'checked' : ''}> Для левши: газ справа, штурвал слева</label>
      <label class="chk"><input type="checkbox" id="sLive" ${save.liveWx !== false ? 'checked' : ''}> Реальная погода (METAR), если есть интернет</label>
      <label class="chk"><input type="checkbox" id="sMap" ${save.mapOn !== false ? 'checked' : ''}> Показывать мини-карту</label>
      <label class="chk"><input type="checkbox" id="sSimple" ${save.simple ? 'checked' : ''}> Режим новичка: подсказки по шагам, помощник и автопосадка включены</label>
    </div>
    <div class="mrow"><button class="btn g" id="sHelp">Как играть</button><button class="btn g" id="bBack2">Готово</button></div>
  </div>`;
  bindOpts();
  $('sCam').value = save.cam; $('sUi').value = String(save.uiScale || 1);
  $('bBack').onclick = $('bBack2').onclick = () => setScreen('hub');
  $('sHelp').onclick = showHelp;
  $('sSnd').onchange = e => { save.sound = e.target.checked; persist(); if (save.sound) audioInit(); };
  $('sVol').oninput = e => { save.vol = +e.target.value / 100; persist(); applyVol(); };
  $('sVoice').onchange = e => { save.voice = e.target.checked; persist(); };
  $('sVib').onchange = e => { save.vibr = e.target.checked; persist(); };
  $('sCam').onchange = e => { save.cam = e.target.value; persist(); };
  $('sUi').onchange = e => { save.uiScale = +e.target.value; persist(); applyUi(); };
  $('sDrift').value = String(save.drift == null ? 0.5 : save.drift); $('sDrift').onchange = e => { save.drift = +e.target.value; persist(); };
  $('sTrack').onchange = e => { save.trackHold = e.target.checked; persist(); };
  $('sLive').onchange = e => { save.liveWx = e.target.checked; persist(); };
  $('sLeft').onchange = e => { save.lefty = e.target.checked; persist(); applyUi(); };
  $('sMap').onchange = e => { save.mapOn = e.target.checked; persist(); };
  $('sSimple').onchange = e => { save.simple = e.target.checked; if (e.target.checked) { save.assistAuto = true; save.assistCfg = true; save.assistTaxi = true; save.hints = true; } persist(); renderSettings(); };
}
function applyUi() { ui.classList.toggle('lefty', !!save.lefty); setUiScale(save.uiScale || 1); menu.style.fontSize = (save.uiScale || 1) > 1 ? (save.uiScale * 100) + '%' : ''; }
function applyVol() { if (masterG) masterG.gain.value = save.vol == null ? 1 : save.vol; }

function renderSelect() {
  const ap = apLoc(), p = plane();
  const list = contractsFor(p, ap.id, save.flights * 7919 + ap.id.charCodeAt(0) * 131 + ap.id.charCodeAt(2));
  list.forEach(c => { let h = save.flights * 31; for (const ch of c.to) h = (h * 33 + ch.charCodeAt(0)) % 997; c.dem = 0.8 + (h % 48) / 100; c.revenue = Math.round(c.revenue * c.dem); });
  if (sel && !list.find(c => c.to === sel.to)) sel = null;
  const owned = fleetIds().map(id => PL_BY[id]);
  menu.innerHTML = `<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Рейсы из ${ap.city}</h1><button class="btn g" id="bBack">‹ Назад</button></div>
    <div class="row">${owned.map(o => `<button class="chip" data-pl="${o.id}" style="border:${o.id === p.id ? '2px solid #7dffb0' : '1px solid rgba(255,255,255,.3)'};color:#fff">${o.short}</button>`).join('')}</div>
    <div class="sub">Цена топлива сейчас: ×${(save.fuelMul || 1).toFixed(2)} · репутация ${Math.round(save.rep)}</div>
    <div class="sub">${p.name}: до ${p.seats} пассажиров, дальность ≈ ${Math.round(maxRangeKm(p) / 100) * 100} км, полоса от ${p.minRwy} м.</div>
    <div id="list">${list.length ? list.map(c => {
      const to = AP_BY[c.to];
      return `<div class="card ${sel && sel.to === c.to ? 'sel' : ''}" data-to="${c.to}"><div><div class="t">${to.city} (${to.id})</div><div class="d">${Math.round(c.km)} км · ≈${etaMin(c.km)} мин · ${c.pax} пасс.</div></div><div class="r">≈ ${fmtRub(c.revenue)}<div class="d">${c.dem >= 1.1 ? '▲ спрос высокий' : c.dem < 0.9 ? '▼ конкуренты' : 'спрос обычный'}</div></div></div>`;
    }).join('') : '<div class="sub">С этого аэродрома для выбранного самолёта нет подходящих рейсов. Смените самолёт.</div>'}</div>
    <div class="bar" id="opts" style="${sel ? '' : 'display:none'}">
      ${optsHTML()}
      <button class="btn go big" id="bGo">Лететь ✈</button>
    </div>
  </div>`;
  $('bBack').onclick = () => setScreen('hub');
  menu.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { save.plane = b.dataset.pl; persist(); sel = null; renderSelect(); });
  menu.querySelectorAll('[data-to]').forEach(el => el.onclick = () => {
    sel = list.find(c => c.to === el.dataset.to);
    menu.querySelectorAll('.card').forEach(x => x.classList.toggle('sel', x === el));
    $('opts').style.display = '';
    const pn = menu.querySelector('.panel'); pn.scrollTo({ top: pn.scrollHeight, behavior: 'smooth' });
  });
  if ($('bGo')) {
    bindOpts();
    $('bGo').onclick = () => { if (sel) startFlight(sel); };
  }
}

function renderHangar() {
  const cur = plane();
  menu.innerHTML = `<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Ангар</h1><button class="btn g" id="bBack">‹ Назад</button></div>
    <div class="row">${stat('💰', fmtRub(save.money))}${stat('⭐ репутация', Math.round(save.rep))}<button class="chip" id="bCrew" style="color:#fff">Экипажи: ${save.crews || 0}/5 · нанять ${fmtRub(400000 + 250000 * (save.crews || 0))}</button><button class="chip" id="bCo" style="color:#fff">Второй пилот: ${save.copilot ? 'нанят (−6%)' : 'нет'}</button></div>
    ${PLANES.map(p => {
      const own = save.owned.includes(p.id), lz = save.lease[p.id] > 0;
      const w = wearOf(p.id), mc = Math.round(p.value * 0.0003 * w);
      const btn = (own || lz) ? (p.id === cur.id ? '<span class="chip">выбран</span>' : `<button class="btn" data-use="${p.id}">Выбрать</button>`) + (lz ? `<div class="d">аренда: ещё ${save.lease[p.id]} рейс.</div>` : '') + (w > 0 && own ? `<br><button class="btn g" data-mt="${p.id}" ${save.money < mc ? 'disabled' : ''}>ТО ${fmtRub(mc)}</button>` : '')
        : `<button class="btn go" data-buy="${p.id}" ${save.money < p.price ? 'disabled' : ''}>Купить<br>${fmtRub(p.price)}</button><br><button class="btn g" data-lease="${p.id}" ${save.money < Math.round(p.price * 0.12) ? 'disabled' : ''}>Аренда 5 рейсов<br>${fmtRub(Math.round(p.price * 0.12))}</button>`;
      return `<div class="card ${own ? '' : ''}"><div><div class="t">${p.name}</div><div class="d">${own ? 'Износ: ' + w + '%' + (w >= 60 ? ' ⚠ чаще отказы' : '') + ' · ' : ''}${p.seats} мест · дальность ≈ ${Math.round(maxRangeKm(p) / 100) * 100} км · полоса от ${p.minRwy} м<br>${p.desc}</div></div><div>${btn}</div></div>`;
    }).join('')}
  </div>`;
  $('bBack').onclick = () => setScreen('hub');
  menu.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { save.plane = b.dataset.use; persist(); renderHangar(); });
  $('bCrew').onclick = () => { const cst = 400000 + 250000 * (save.crews || 0); if ((save.crews || 0) < 5 && save.money >= cst) { save.money -= cst; save.crews = (save.crews || 0) + 1; persist(); renderHangar(); } };
  $('bCo').onclick = () => { save.copilot = !save.copilot; persist(); renderHangar(); };
  menu.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { const p = PL_BY[b.dataset.mt], c = Math.round(p.value * 0.0003 * wearOf(p.id)); if (save.money >= c) { save.money -= c; save.wear[p.id] = 0; persist(); renderHangar(); } });
  menu.querySelectorAll('[data-lease]').forEach(b => b.onclick = () => { const p = PL_BY[b.dataset.lease], c = Math.round(p.price * 0.12); if (save.money >= c) { save.money -= c; save.lease[p.id] = 5; save.plane = p.id; persist(); renderHangar(); } });
  menu.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
    const p = PL_BY[b.dataset.buy];
    if (save.money >= p.price) { save.money -= p.price; save.owned.push(p.id); save.plane = p.id; persist(); renderHangar(); }
  });
}

// ---------- лётная школа ----------
let lessonCur = null;
const LESSONS = [
  { id: 'l1', title: '1. Первый рейс с автопилотом', desc: 'Взлёт, набор, автозаход и посадка с помощником. Цель — просто долететь и сесть.', wx: 0, assist: { auto: true, config: true }, force: 'none', pass: r => r.kind === 'ok' },
  { id: 'l2', title: '2. Ручная посадка', desc: 'Автопилот выключен. Держите глиссаду и выровняйте у земли: касание не жёстче 1,6 м/с.', wx: 0, assist: { auto: false, config: true }, force: 'none', pass: r => r.kind === 'ok' && r.sink <= 1.6 },
  { id: 'l3', title: '3. Боковой ветер', desc: 'Сложная погода, ручное пилотирование. Сядьте, не жёстче 2,4 м/с.', wx: 2, assist: { auto: false, config: true }, force: 'none', pass: r => r.kind === 'ok' && r.sink <= 2.4 },
  { id: 'l4', title: '4. Отказ двигателя', desc: 'Откажет двигатель. Выполните действия по чек-листу и сядьте.', wx: 0, assist: { auto: true, config: true }, force: 'engFail', pass: r => r.kind === 'ok' && r.evOk >= 1 },
  { id: 'l5', title: '5. Заход в тумане', desc: 'Низкая видимость: заход строго по глиссаде и курсу (кнопка ПОСАДКА).', wx: 0, assist: { auto: true, config: true }, force: 'fog', pass: r => r.kind === 'ok' },
  { id: 'l6', title: '6. Экзамен', desc: 'Сложная погода, без автоматики механизации и без автопилота. Нужны 4★ и выше.', wx: 2, assist: { auto: false, config: false }, force: 'none', pass: r => r.kind === 'ok' && r.stars >= 4 },
];
function renderSchool() {
  const done = LESSONS.filter(l => save.school[l.id]).length;
  menu.innerHTML = `<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Лётная школа</h1><button class="btn g" id="bBack">‹ Назад</button></div>
    <div class="sub">Пошаговые уроки (${done}/${LESSONS.length}). Деньги в уроках не начисляются, опыт — за первое прохождение.</div>
    ${LESSONS.map((l, i) => `<div class="card" data-l="${i}"><div><div class="t">${save.school[l.id] ? '✅ ' : ''}${l.title}</div><div class="d">${l.desc}</div></div><div class="r">▶</div></div>`).join('')}
  </div>`;
  $('bBack').onclick = () => setScreen('hub');
  menu.querySelectorAll('[data-l]').forEach(el => el.onclick = () => {
    const l = LESSONS[+el.dataset.l], ap = apLoc(), p = plane();
    const list = contractsFor(p, ap.id, 777 + ap.id.charCodeAt(0));
    const c = list.find(x => x.km >= 300) || list[list.length - 1];
    if (!c) { showModal('<h2>Нет рейсов</h2><div class="sub">Смените самолёт или аэропорт.</div><div class="mrow"><button class="btn" id="mOk">Ок</button></div>'); $('mOk').onclick = hideModal; return; }
    audioInit(); lessonCur = l;
    beginFlight(c, l.force, makeWeather(Math.random, l.wx, bearing(ap, AP_BY[c.to]), 1), null);
  });
}
function startDaily() {
  const d = new Date(), key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  let h = 2166136261; for (const ch of key + plane().id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = (() => { let a = h; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const ap = apLoc(), p = plane(), list = contractsFor(p, ap.id, h % 100000);
  if (!list.length) { showModal('<h2>Нет рейсов</h2><div class="sub">Смените самолёт или аэропорт.</div><div class="mrow"><button class="btn" id="mOk">Ок</button></div>'); $('mOk').onclick = hideModal; return; }
  const c = list[h % list.length], wx = makeWeather(rnd, 2, bearing(ap, AP_BY[c.to]), 1 + (h % 2));
  audioInit(); lessonCur = null;
  beginFlight(c, null, wx, { fuel: Math.min(p.fuelCap, Math.round(c.fuel + p.burnHr * 0.5)), cg: 0.25, flex: false }, { daily: key, tod: h % 3, rnd });
}
const RIVALS = [['Капитан Иванов', 5200], ['Е. Смирнова', 3600], ['Ш. Мюллер', 2500], ['Дж. Картер', 1500], ['А. Ямада', 800], ['Новичок Петя', 150]];
function fleetHtml() {
  const own = save.owned.map(id => PL_BY[id]).filter(Boolean);
  const val = own.reduce((a, p) => a + p.value, 0);
  return `<div class="row">${stat('Самолётов:', own.length)}${stat('Стоимость флота:', fmtRub(val))}${stat('Налёт, ч:', ((save.stat && save.stat.min || 0) / 60).toFixed(1))}</div>` +
    own.map(p => `<div class="evrow"><span>${p.name}${p.id === save.plane ? ' ✔' : ''}</span><span>${p.seats} мест · износ ${Math.round((save.wear && save.wear[p.id]) || 0)}%</span></div>`).join('');
}
function leagueHtml() {
  const me = ['Вы', save.xp || 0];
  const all = [...RIVALS, me].sort((a, b) => b[1] - a[1]);
  return all.map((r, i) => `<div class="evrow"${r === me ? ' style="color:#7dffb0;font-weight:700"' : ''}><span>${i + 1}. ${r[0]}</span><span>${r[1]} XP</span></div>`).join('');
}
function renderRecords() {
  const st = save.stat, top = (save.top || []).slice(0, 10);
  const code = `Pilot Sim: ${save.flights} рейсов, ${save.landings} посадок, лучшая посадка ${save.bestSink != null ? save.bestSink.toFixed(2) : '—'} м/с, ранг ${rankOf(save.xp).name}, серия ${st.best}, самый длинный рейс ${Math.round(st.maxKm)} км`;
  menu.innerHTML = `<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Рекорды</h1><button class="btn g" id="bBack">‹ Назад</button></div>
    <div class="row">${stat('Рейсов:', save.flights)}${stat('Налёт, ч:', (st.min / 60).toFixed(1))}${stat('Лучшая серия 4★+:', st.best)}${stat('Дальше всего:', Math.round(st.maxKm) + ' км')}</div>
    <div class="sub"><b>Авиакомпания</b></div>
    ${fleetHtml()}
    <div class="sub"><b>Рейтинг пилотов</b> (соперники — виртуальные, на этом устройстве)</div>
    ${leagueHtml()}
    <div class="sub"><b>Лучшие посадки</b></div>
    ${top.length ? top.map((t, i) => `<div class="evrow"><span>${i + 1}. ${t.pl} · ${t.ap}</span><span>${t.sink.toFixed(2)} м/с</span></div>`).join('') : '<div class="sub">Пока нет посадок.</div>'}
    <div class="sub"><b>Испытание дня</b> (одинаковые условия для всех в этот день)</div>
    ${Object.keys(save.daily || {}).sort().reverse().slice(0, 7).map(k => `<div class="evrow"><span>${k}</span><span>${save.daily[k].toFixed(2)} м/с</span></div>`).join('') || '<div class="sub">Ещё не проходили.</div>'}
    <div class="mrow"><button class="btn go" id="bDaily">Испытание дня ▶</button><button class="btn g" id="bShare">Поделиться результатом</button></div>
  </div>`;
  $('bBack').onclick = () => setScreen('hub');
  $('bDaily').onclick = startDaily;
  $('bShare').onclick = () => { try { if (navigator.share) navigator.share({ text: code }); else { navigator.clipboard.writeText(code); showModal('<h2>Скопировано</h2><div class="sub">' + code + '</div><div class="mrow"><button class="btn" id="mOk">Ок</button></div>'); $('mOk').onclick = hideModal; } } catch (e) { showModal('<h2>Результат</h2><div class="sub">' + code + '</div><div class="mrow"><button class="btn" id="mOk">Ок</button></div>'); $('mOk').onclick = hideModal; } };
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
function f_msgNoMoney() { alert('Недостаточно денег на ТО'); }
async function startFlight(c, drill) {
  let live = null;
  if (!drill && save.wxLvl && save.liveWx !== false && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    const a = apLoc(), b = AP_BY[c.to];
    const [x, y] = await Promise.all([ICAO[a.id] ? fetchMetar(ICAO[a.id]) : null, ICAO[b.id] ? fetchMetar(ICAO[b.id]) : null]);
    live = { dep: x, dst: y };
  }
  return startFlight_(c, drill, live);
}
function startFlight_(c, drill, live) {
  audioInit(); lessonCur = null;
  const from = apLoc(), to = AP_BY[c.to];
  const brg = bearing(from, to);
  const wx = makeWeather(Math.random, drill ? 0 : save.wxLvl, brg, save.season);
  if (live) { applyMetar(wx, live.dep, 'dep'); applyMetar(wx, live.dst, 'dst'); }
  if (drill) return beginFlight(c, drill, wx, null);
  const p = plane(), cgAuto = 0.22 + ((c.km * 7) % 7) / 100;
  const pf = { fuel: 1, cg: 'auto', flex: false, ck: [false, false, false, false, false], defects: [] };
  { const w = wearOf(p.id), DEF = [{ t: 'нестабильна работа автопилота', ev: 'apFail' }, { t: 'замечание по генератору №2', ev: 'gen' }, { t: 'след утечки гидравлики', ev: 'hyd' }, { t: 'сомнительные датчики воздушных данных', ev: 'adc' }, { t: 'сбои индикации', ev: 'indic' }, { t: 'отказывает автомат тяги', ev: 'atFail' }];
    const n = w >= 85 ? 2 : (w >= 60 && Math.random() < 0.6) || (w >= 40 && Math.random() < 0.25) ? 1 : 0;
    while (pf.defects.length < n) { const d = DEF[Math.floor(Math.random() * DEF.length)]; if (!pf.defects.includes(d)) pf.defects.push(d); } }
  const CKL = ['Двери закрыты, трап убран', 'Топливо и загрузка проверены', 'Закрылки 2 (взлётная конфигурация)', 'Штурвал и приборы проверены', 'Аварийное оборудование, ремни'];
  const draw = () => {
    const base = Math.round(c.fuel / (1 + 0.8 * (wx.jet || 0) / 230)), fo = [base, base + p.burnHr * 0.5, base + p.burnHr * 1.0].map(v => Math.min(p.fuelCap, Math.round(v)));
    const cgv = pf.cg === 'fwd' ? 0.19 : pf.cg === 'aft' ? 0.31 : cgAuto, fuel = fo[pf.fuel], li = loadInfo(p, c, fuel, cgv);
    const flexOk = from.rwy >= p.minRwy * 1.6 && from.elev < 1200;
    if (!flexOk) pf.flex = false;
    const wc = windComp(wx, brg), hw = Math.round(wc.head), cwv = Math.round(Math.abs(wc.cross));
    const ready = pf.ck.every(Boolean) && !li.over;
    const opt = (name, k, txt) => `<button class="chip pf" data-k="${name}" data-v="${k}" style="color:#fff;border:${(name === 'fuel' ? pf.fuel === k : name === 'cg' ? pf.cg === k : pf.flex === k) ? '2px solid #7dffb0' : '1px solid rgba(255,255,255,.3)'}">${txt}</button>`;
    showModal(`<h2>Предполётная подготовка</h2>
    <div class="sub">${wx.level ? `<b>Вылет:</b> ${metarText(from, wx, 'dep')}<br><b>Назначение:</b> ${metarText(to, wx, 'dst')}<br>Ветер по маршруту: ${hw >= 0 ? 'встречный' : 'попутный'} ${Math.abs(hw)} м/с, боковой ${cwv} м/с${wc.cross > 0.5 ? ' справа' : wc.cross < -0.5 ? ' слева' : ''}.${wx.vis < 1500 || wx.visD < 1500 ? '<br>⚠ Низкая видимость: заходите по глиссаде.' : ''}<br><br>` : ''}
    ${wx.level ? `Ветер на эшелоне: ${wx.jet >= 0 ? 'попутный' : 'встречный'} ${Math.abs(wx.jet)} м/с (струйное течение). Температура ${wx.temp}°${Math.abs(p.mtow) && wx.temp > 28 ? ' — жарко, взлёт длиннее' : ''}.<br>` : ''}<b>Топливо:</b> ${fuel} кг<br>${opt('fuel', 0, 'Минимум')}${opt('fuel', 1, '+30 мин (станд.)')}${opt('fuel', 2, '+1 ч (запасной)')}<br>
    <b>Центровка:</b> ${Math.round(cgv * 100)}% САХ ${cgv < 0.2 ? '(передняя — тугой подъём носа)' : cgv > 0.3 ? '(задняя — экономичнее, чувствительный тангаж)' : '(норма)'}<br>${opt('cg', 'fwd', 'Багаж вперёд')}${opt('cg', 'auto', 'Авто')}${opt('cg', 'aft', 'Багаж назад')}<br>
    <b>Взлётная масса:</b> ${Math.round(li.mass / 100) / 10} т из ${Math.round(p.mtow / 100) / 10} т${li.over ? ' <span style="color:#ff8a7a">⚠ ПЕРЕГРУЗ — уменьшите топливо</span>' : ''}<br>
    ${pf.defects.length ? `<div style="margin:4px 0;color:#ffb36b">⚠ Замечания по технике (износ ${wearOf(p.id)}%): ${pf.defects.map(d => d.t).join('; ')}. В полёте это может отказать. <button class="chip" id="pfMt" style="color:#fff">Вызвать ТО (${fmtRub(Math.round(p.value * 0.00012 * wearOf(p.id)))}, −30% износа)</button></div>` : ''}
    <b>V1 / VR / V2:</b> ${li.v1} / ${li.vr} / ${li.v2} км/ч (закрылки 2)<br>
    <b>Взлётный режим:</b> ${opt('flex', false, 'TOGA')}${flexOk ? opt('flex', true, 'FLEX (−14% тяги, меньше износ)') : '<span class="d"> FLEX недоступен (короткая/высокогорная полоса)</span>'}<br><br>
    <b>Чек-лист:</b> <button class="chip" id="pfAll" style="color:#fff">отметить всё</button><br>${CKL.map((t, i) => `<div class="pfc" data-i="${i}" style="cursor:pointer;padding:2px 0">${pf.ck[i] ? '☑' : '☐'} ${t}</div>`).join('')}</div>
    <div class="mrow"><button class="btn g" id="mNo">Отмена</button><button class="btn go" id="mGo" ${ready ? '' : 'disabled'}>К запуску ✈</button></div>`);
    modalBox.querySelectorAll('.pf').forEach(b => b.onclick = () => { const k = b.dataset.k, v = b.dataset.v; if (k === 'fuel') pf.fuel = +v; else if (k === 'cg') pf.cg = v; else pf.flex = v === 'true'; draw(); });
    modalBox.querySelectorAll('.pfc').forEach(b => b.onclick = () => { pf.ck[+b.dataset.i] = !pf.ck[+b.dataset.i]; draw(); });
    $('pfAll').onclick = () => { pf.ck = pf.ck.map(() => true); draw(); };
    if ($('pfMt')) $('pfMt').onclick = () => { const cst = Math.round(p.value * 0.00012 * wearOf(p.id)); if (save.money < cst) { f_msgNoMoney(); return; } save.money -= cst; save.wear[p.id] = Math.max(0, (save.wear[p.id] || 0) - 30); pf.defects = []; persist(); draw(); };
    $('mNo').onclick = hideModal; $('mGo').onclick = () => beginFlight(c, drill, wx, { fuel, cg: cgv, flex: pf.flex, extraEv: pf.defects.map(d => d.ev) });
  };
  draw();
}
function beginFlight(c, drill, wx, pf, extra) {
  const from = apLoc(), to = AP_BY[c.to], p = plane();
  const tod = extra && extra.tod != null ? extra.tod : save.tod === 'rnd' ? [0, 0, 0, 1, 2][Math.floor(Math.random() * 5)] : +save.tod;
  contract = c;
  flight = new Flight({ rnd: extra && extra.rnd, wx, plane: p, from, to, bearing: bearing(from, to), distM: c.km * 1000, pax: c.pax, fuelKg: pf ? pf.fuel : Math.min(p.fuelCap, c.fuel + ((save.emerg || drill) ? p.burnHr * 0.25 : 0)), driftK: save.drift == null ? 0.5 : save.drift, trackHold: save.trackHold !== false, cold: !!pf && save.taxiOps, flex: !!(pf && pf.flex), cg: pf ? pf.cg : 0.25,
    taxi: drill ? false : save.taxiOps, drill: !!drill, force: drill ? [drill] : undefined, emerg: drill ? 0 : (save.emerg && (wearOf(p.id) >= 60 || (save.fatigue || 0) >= 60) ? Math.min(3, save.emerg + 1) : save.emerg), copilot: save.copilot, fatigue: save.fatigue || 0, extraEv: pf ? pf.extraEv : undefined, assist: { auto: save.assistAuto, config: save.assistCfg, hints: save.hints, taxi: save.assistTaxi }, tod, recAlt: recommendedCruise(c.km) });
  flight.daily = extra && extra.daily;
  flight.c.flaps = 2; flight.flapAct = 2; flight.c.brake = true; flight.c.thr = 0;
  if (drill) { flight.assist.auto = true; flight.assist.config = true; }
  if (drill && lessonCur) { flight.assist.auto = lessonCur.assist.auto; flight.assist.config = lessonCur.assist.config; }
  view = { bump: 0, turb: 0, rollKick: 0, warp: 1, cam: save.cam, map: save.mapOn !== false, mapZoom: 0 };
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
function buildRadio() {
  const f = flight; if (!f) return; const p = $('radioP');
  const L = [['taxi', 'Руление', !f.airborneOnce && f.onGround], ['to', 'Взлёт', !f.airborneOnce && f.onGround], ['climb', 'Эшелон выше', f.airborneOnce && !f.onGround], ['land', 'Посадка', f.airborneOnce && !f.onGround], ['pan', 'PAN-PAN', true, 'red'], ['may', 'MAYDAY', true, 'red']];
  p.innerHTML = L.filter(x => x[2]).map(x => `<button data-r="${x[0]}" class="${x[3] || ''}">${x[1]}</button>`).join('');
  p.querySelectorAll('button').forEach(b => b.onclick = () => { f.radioReq(b.dataset.r); p.classList.remove('on'); });
}
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
    case 'start': if (f.cold) { if (f.gate.done) f.startReq = true; else f.msg('Дождитесь окончания обслуживания'); } break;
    case 'radio': { const p = $('radioP'); p.classList.toggle('on'); if (p.classList.contains('on')) buildRadio(); break; }
    case 'rev': if (f.onGround && f.v > 15) { c.rev = !c.rev; if (c.rev) f.msg('Реверс включён: рычагами регулируйте обратную тягу'); else { c.thr = c.t1 = c.t2 = 0; c.split = false; thrSet(0, true); } } else f.msg('Реверс — только на пробеге (скорость выше 55 км/ч)'); break;
    case 'abrk': c.abrk = ((c.abrk || 0) + 1) % 4; f.msg('Автоторможение: ' + (c.abrk ? 'режим ' + c.abrk : 'выкл')); break;
    case 'taxi': if (f.onGround && f.taxiOps) c.taxiAuto = !c.taxiAuto; break;
    case 'view': save.cam = { chase: 'cockpit', cockpit: 'tower', tower: 'chase' }[save.cam] || 'chase'; view.tw = null; view.cam = save.cam; persist(); break;
    case 'altd': c.apAlt = Math.max(300, c.apAlt - (c.apAlt > 3000 ? 600 : 300)); break;
    case 'altu': c.apAlt = Math.min(f.p.ceiling - 600, c.apAlt + (c.apAlt >= 3000 ? 600 : 300)); break;
    case 'appr': if (f.apLock > 0) { f.msg('Автопилот неисправен'); break; } if (!c.apOn && !f.onGround) { c.apOn = true; c.atOn = true; } c.appr = !c.appr; if (!c.appr) f.apprCap = false; break;
  }
}
ui.querySelectorAll('#btns button, #ebtns button, #bStart').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); act(b.dataset.act); }));
$('mapzone').addEventListener('pointerdown', e => { e.preventDefault(); if (!view) return; view.mapZoom = ((view.mapZoom || 0) + 1) % 10; if (flight) flight.msg(view.mapZoom ? 'Карта: масштаб зафиксирован' : 'Карта: масштаб авто'); });
$('eact').addEventListener('pointerdown', e => { const b = e.target.closest('button'); if (!b || !flight) return; e.preventDefault(); flight.evAction(b.dataset.k); });

function syncButtons() {
  const f = flight, c = f.c;
  const on = (id, v) => $(id).classList.toggle('on', !!v);
  $('bStart').style.display = f.cold && !f.startReq ? 'block' : 'none';
  on('bGear', c.gear); $('bGear').textContent = 'ШАССИ ' + (f.gearPos > 0.98 ? '▼' : f.gearPos < 0.02 ? '▲' : '…');
  $('bFlD').textContent = 'ЗАКР − (' + FLAP_NAMES[c.flaps] + ')'; $('bFlU').textContent = 'ЗАКР +';
  thrEls.forEach((el, i) => { el.querySelector('.lb').textContent = c.rev ? 'РЕВ' + (i + 1) : 'ДВ' + (i + 1); });
  on('bRev', c.rev); $('bRev').classList.toggle('warn', !!c.rev); $('bAbrk').textContent = 'АВТОТОРМ ' + (c.abrk ? c.abrk : '—'); on('bAbrk', c.abrk > 0);
  on('bBrake', c.brake); $('bBrake').classList.toggle('warn', c.brake && f.onGround && !f.td && f.v < 1);
  on('bAp', c.apOn); on('bAt', c.atOn); on('bNav', c.nav && c.apOn); on('bTaxi', c.taxiAuto && f.onGround); $('bTaxi').disabled = !f.onGround || !f.taxiOps;
  $('bView').textContent = { chase: 'ВИД: СНАРУЖИ', cockpit: 'ВИД: КАБИНА', tower: 'ВИД: БАШНЯ' }[save.cam] || 'ВИД: СНАРУЖИ'; on('bAppr', c.appr);
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
  const m = { KeyG: 'gear', KeyF: 'fl+', KeyV: 'fl-', KeyB: 'brake', KeyA: 'ap', KeyT: 'warp', KeyL: 'appr', BracketRight: 'altu', BracketLeft: 'altd', KeyN: 'at', KeyC: 'view', KeyR: 'taxi', KeyM: 'map', KeyU: 'rev', KeyI: 'start', KeyO: 'abrk' }[e.code];
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

function drawReplay(f, k) {
  const cv = $('rcv'); if (!cv) return; const g = cv.getContext('2d'), w = cv.width, h = cv.height, T = f.track, n = T.length;
  g.clearRect(0, 0, w, h);
  const xs = T.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1), hm = Math.max(500, ...T.map(p => p[2])), vm = Math.max(300, ...T.map(p => p[3]));
  const X = x => 30 + (x - x0) / (x1 - x0) * (w - 40), Y = a => h - 18 - a / hm * (h - 34), V = v => h - 18 - v / vm * (h - 34);
  g.strokeStyle = 'rgba(160,255,200,.2)'; g.beginPath(); g.moveTo(30, h - 18); g.lineTo(w - 8, h - 18); g.stroke();
  g.font = '10px sans-serif'; g.fillStyle = '#9fd'; g.fillText(Math.round(hm) + ' м', 2, 12); g.fillStyle = '#fc6'; g.fillText('скорость ' + Math.round(vm) + ' км/ч', w - 110, 12);
  const m = Math.max(1, Math.floor(n * k));
  g.lineWidth = 1.6; g.strokeStyle = '#7dffb0'; g.beginPath(); for (let i = 0; i < m; i++) { const p = T[i]; i ? g.lineTo(X(p[0]), Y(p[2])) : g.moveTo(X(p[0]), Y(p[2])); } g.stroke();
  g.lineWidth = 1; g.strokeStyle = '#fc6'; g.beginPath(); for (let i = 0; i < m; i++) { const p = T[i]; i ? g.lineTo(X(p[0]), V(p[3])) : g.moveTo(X(p[0]), V(p[3])); } g.stroke();
  for (const mk of f.marks) { if (mk.i > m) continue; const p = T[Math.min(mk.i, n - 1)]; g.fillStyle = mk.text === 'Касание' ? '#7dffb0' : '#ff6a6a'; g.beginPath(); g.arc(X(p[0]), Y(p[2]), 4, 0, 6.3); g.fill(); g.fillStyle = '#fff'; g.fillText(mk.text, Math.min(w - 70, X(p[0]) + 5), Math.max(24, Y(p[2]) - 6)); }
  const c = T[m - 1]; g.fillStyle = '#fff'; g.beginPath(); g.arc(X(c[0]), Y(c[2]), 3.5, 0, 6.3); g.fill();
}
function showResult() {
  const f = flight, r = settle(f, contract, { rep: save.rep, copilot: save.copilot, fuelMul: save.fuelMul || 1, crews: save.crews || 0 });
  const to = f.toAp;
  // применяем итоги
  const drill = !!f.drill;
  const rkBefore = rankOf(save.xp).i;
  if (!drill) {
    save.money = Math.max(0, save.money + r.net);
    if (r.kind !== 'abort') save.flights++;
    if (r.kind === 'ok' || r.kind === 'overrun') { save.loc = f.locAfter; }
    { const st = save.stat; st.maxKm = Math.max(st.maxKm, r.km); st.min += f.simTime / 60; if (r.kind === 'ok' && r.stars >= 4) { st.streak++; st.best = Math.max(st.best, st.streak); } else if (r.kind !== 'abort') st.streak = 0;
      if (r.kind === 'ok' && f.daily) { save.daily = save.daily || {}; if (save.daily[f.daily] == null || r.sink < save.daily[f.daily]) save.daily[f.daily] = r.sink; r.dailyBest = save.daily[f.daily]; }
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
    persist();
  }
  const rkAfter = rankOf(save.xp);
  let lessonMsg = '';
  if (lessonCur) { const ok = lessonCur.pass(r), first = ok && !save.school[lessonCur.id]; if (first) { save.school[lessonCur.id] = true; save.xp += 60; } persist(); lessonMsg = ok ? '✅ Урок пройден' + (first ? ' (+60 XP)' : '') : '❌ Урок не пройден — попробуйте ещё раз'; }
  const ttl = lessonCur ? lessonMsg : drill ? 'Тренировка окончена' : { ok: r.quality, crash: 'Катастрофа', overrun: 'Выкатились за полосу', forced: 'Рейс сорван', missed: 'Аэропорт пролетели', abort: 'Рейс отменён' }[r.kind];
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
    if (r.kind === 'ok' && r.paxStars) rows += row('Оценка пассажиров', '★'.repeat(r.paxStars) + '☆'.repeat(5 - r.paxStars), r.paxStars >= 4 ? 'pos' : r.paxStars <= 2 ? 'neg' : '');
    if (r.kind === 'ok' && r.sched) rows += row('Расписание (' + Math.round(r.tm) + ' мин, план ' + Math.round(r.expMin) + ')', (r.sched > 0 ? '+' : '−') + Math.abs(Math.round(r.sched * 100)) + '%', r.sched > 0 ? 'pos' : 'neg');
    if (r.crewInc) rows += row('Доход ваших экипажей (' + save.crews + ')', '+' + fmtRub(r.crewInc), 'pos');
    if (r.coFee) rows += row('Второй пилот', '−' + fmtRub(r.coFee), 'neg');
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
    ${r.dailyBest != null ? `<div class="sub">🏅 Испытание дня: лучшая посадка ${r.dailyBest.toFixed(2)} м/с</div>` : ''}
    ${drill ? '' : `<div class="sub">Репутация: ${Math.round(save.rep)}/100${r.repD ? ' (' + (r.repD > 0 ? '+' : '') + r.repD + ')' : ''} · износ ${f.p.short}: ${wearOf(f.p.id)}%</div>`}
    ${f.track.length > 3 ? '<canvas id="rcv" width="520" height="150" style="width:100%;max-width:520px;background:rgba(8,16,32,.6);border-radius:8px"></canvas><div class="mrow"><button class="btn g" id="bRep">▶ Повтор полёта</button><button class="btn g" id="bRepS">Скорость ×1</button></div>' : ''}
    ${evRows ? `<div class="sub" style="margin-bottom:2px"><b>Аварийные ситуации:</b></div>${evRows}` : ''}
    <table class="res">${rows}</table>
    ${drill ? '' : `<div class="sub">+${r.xp} XP · ${rkAfter.name}${rkAfter.i > rkBefore ? ' — <b style="color:#7dffb0">НОВЫЙ РАНГ!</b>' : ''}</div>`}
    ${drill ? '' : `<div class="row">${stat('💰', fmtRub(save.money))}${stat('📍', apLoc().city)}</div>`}
    <div class="mrow"><button class="btn go" id="bAgain">${drill ? 'Ещё тренировка' : 'Следующий рейс'}</button><button class="btn g" id="bHub">В меню</button></div>
  </div>`;
  mode = 'menu'; ui.classList.remove('on'); menu.classList.add('on');
  drawReplay(f, 1); $('bRep') && ($('bRep').onclick = () => { const t0 = performance.now(), n = f.track.length, dur = 9000 / (window._repSp || 1); const st = () => { const k = Math.min(1, (performance.now() - t0) / dur); drawReplay(f, k); if (k < 1 && mode === 'menu') requestAnimationFrame(st); }; st(); });
  window._repSp = 1; $('bRepS') && ($('bRepS').onclick = () => { const L = [1, 0.5, 0.25, 3]; window._repSp = L[(L.indexOf(window._repSp) + 1) % L.length]; $('bRepS').textContent = 'Скорость ×' + window._repSp; });
  const wasLesson = !!lessonCur; lessonCur = null;
  $('bAgain').onclick = () => setScreen(wasLesson ? 'school' : drill ? 'drill' : 'select');
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
applyUi(); renderMenu();

// отладка/тесты
window.__pilot = { get flight() { return flight; }, save, startFlight, setScreen, act, get mode() { return mode; } };
