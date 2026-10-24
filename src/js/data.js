// Данные: аэропорты, самолёты, экономика. Значения приблизительные, для игры.

export const AIRPORTS = [
  { id: 'SVO', city: 'Москва', name: 'Шереметьево', lat: 55.9726, lon: 37.4146, rwy: 3700, elev: 190 },
  { id: 'DME', city: 'Москва', name: 'Домодедово', lat: 55.4088, lon: 37.9063, rwy: 3800, elev: 179 },
  { id: 'LED', city: 'Санкт-Петербург', name: 'Пулково', lat: 59.8003, lon: 30.2625, rwy: 3780, elev: 24 },
  { id: 'AER', city: 'Сочи', name: 'Адлер', lat: 43.4499, lon: 39.9566, rwy: 2890, elev: 27 },
  { id: 'KRR', city: 'Краснодар', name: 'Пашковский', lat: 45.0347, lon: 39.1705, rwy: 3000, elev: 36 },
  { id: 'KZN', city: 'Казань', name: 'Казань', lat: 55.6062, lon: 49.2787, rwy: 3750, elev: 125 },
  { id: 'GOJ', city: 'Нижний Новгород', name: 'Стригино', lat: 56.2301, lon: 43.7841, rwy: 2800, elev: 78 },
  { id: 'UFA', city: 'Уфа', name: 'Уфа', lat: 54.5575, lon: 55.8744, rwy: 3000, elev: 104 },
  { id: 'SVX', city: 'Екатеринбург', name: 'Кольцово', lat: 56.7431, lon: 60.8027, rwy: 3016, elev: 233 },
  { id: 'OVB', city: 'Новосибирск', name: 'Толмачёво', lat: 55.0126, lon: 82.6507, rwy: 3600, elev: 111 },
  { id: 'KJA', city: 'Красноярск', name: 'Емельяново', lat: 56.1729, lon: 92.4933, rwy: 3700, elev: 277 },
  { id: 'IKT', city: 'Иркутск', name: 'Иркутск', lat: 52.268, lon: 104.389, rwy: 3165, elev: 508 },
  { id: 'KHV', city: 'Хабаровск', name: 'Новый', lat: 48.528, lon: 135.188, rwy: 3500, elev: 75 },
  { id: 'VVO', city: 'Владивосток', name: 'Кневичи', lat: 43.399, lon: 132.148, rwy: 3500, elev: 10 },
  { id: 'KGD', city: 'Калининград', name: 'Храброво', lat: 54.89, lon: 20.5926, rwy: 2900, elev: 13 },
  { id: 'MMK', city: 'Мурманск', name: 'Мурманск', lat: 68.7817, lon: 32.7508, rwy: 2500, elev: 81 },
  { id: 'MSQ', city: 'Минск', name: 'Минск-2', lat: 53.8825, lon: 28.0307, rwy: 3600, elev: 204 },
  { id: 'IST', city: 'Стамбул', name: 'Стамбул', lat: 41.2753, lon: 28.7519, rwy: 4100, elev: 99 },
  { id: 'DXB', city: 'Дубай', name: 'Дубай', lat: 25.2528, lon: 55.3644, rwy: 4000, elev: 19 },
  { id: 'CDG', city: 'Париж', name: 'Шарль-де-Голль', lat: 49.0097, lon: 2.5479, rwy: 4200, elev: 119 },
  { id: 'FRA', city: 'Франкфурт', name: 'Франкфурт', lat: 50.0379, lon: 8.5622, rwy: 4000, elev: 111 },
  { id: 'LHR', city: 'Лондон', name: 'Хитроу', lat: 51.47, lon: -0.4543, rwy: 3900, elev: 25 },
  { id: 'PEK', city: 'Пекин', name: 'Столичный', lat: 40.0799, lon: 116.6031, rwy: 3800, elev: 35 },
  { id: 'HND', city: 'Токио', name: 'Ханэда', lat: 35.5494, lon: 139.7798, rwy: 3360, elev: 6 },
  { id: 'JFK', city: 'Нью-Йорк', name: 'Кеннеди', lat: 40.6413, lon: -73.7781, rwy: 4400, elev: 4 },
  { id: 'INN', city: 'Инсбрук', name: 'Инсбрук (горы)', lat: 47.2602, lon: 11.344, rwy: 2000, elev: 581 },
  { id: 'ZQN', city: 'Куинстаун', name: 'Куинстаун (горы)', lat: -45.0211, lon: 168.739, rwy: 1900, elev: 357 },
  { id: 'GIB', city: 'Гибралтар', name: 'Гибралтар (короткая)', lat: 36.1512, lon: -5.3497, rwy: 1700, elev: 5 },
  { id: 'FNC', city: 'Фуншал', name: 'Мадейра (над морем)', lat: 32.6979, lon: -16.7745, rwy: 2781, elev: 56 },
  { id: 'SXM', city: 'Синт-Мартен', name: 'Принцесса Джулиана', lat: 18.041, lon: -63.1089, rwy: 2300, elev: 4 },
  { id: 'MRV', city: 'Минеральные Воды', name: 'Минеральные Воды', lat: 44.2251, lon: 43.0819, rwy: 3900, elev: 320 },
  { id: 'GDZ', city: 'Геленджик', name: 'Геленджик', lat: 44.5656, lon: 38.0124, rwy: 2500, elev: 29 },
  { id: 'NSK', city: 'Норильск', name: 'Алыкель', lat: 69.3111, lon: 87.3322, rwy: 2700, elev: 38 },
  { id: 'YKS', city: 'Якутск', name: 'Якутск', lat: 62.0933, lon: 129.7706, rwy: 3400, elev: 100 },
  { id: 'LXA', city: 'Лхаса', name: 'Гонггар (высокогорье)', lat: 29.2978, lon: 90.9119, rwy: 4000, elev: 3570 },
  { id: 'LPB', city: 'Ла-Пас', name: 'Эль-Альто (высокогорье)', lat: -16.5133, lon: -68.1923, rwy: 4000, elev: 4061 },
  { id: 'UIO', city: 'Кито', name: 'Марискаль-Сукре', lat: -0.1292, lon: -78.3575, rwy: 4100, elev: 2400 },
  { id: 'DEN', city: 'Денвер', name: 'Денвер', lat: 39.8561, lon: -104.6737, rwy: 4800, elev: 1655 },
  { id: 'MEX', city: 'Мехико', name: 'Бенито-Хуарес', lat: 19.4363, lon: -99.0721, rwy: 3900, elev: 2230 },
  { id: 'JNB', city: 'Йоханнесбург', name: 'О. Р. Тамбо', lat: -26.1392, lon: 28.246, rwy: 4400, elev: 1694 },
  { id: 'SIN', city: 'Сингапур', name: 'Чанги', lat: 1.3644, lon: 103.9915, rwy: 4000, elev: 7 },
  { id: 'SYD', city: 'Сидней', name: 'Кингсфорд-Смит', lat: -33.9399, lon: 151.1753, rwy: 3962, elev: 6 },
  { id: 'LAX', city: 'Лос-Анджелес', name: 'Лос-Анджелес', lat: 33.9425, lon: -118.4081, rwy: 3685, elev: 38 },
  { id: 'GRU', city: 'Сан-Паулу', name: 'Гуарульюс', lat: -23.4356, lon: -46.4731, rwy: 3700, elev: 750 },
];
export const AP_BY = Object.fromEntries(AIRPORTS.map(a => [a.id, a]));

// seats — пассажирских мест; oew — масса пустого, кг; fuelCap — топливо, кг; S — площадь крыла, м²
// T0 — суммарная тяга у земли, Н; flapLim — предельные скорости по IAS для положений закрылков 0..4, м/с
export const PLANES = [
  { id: 'ssj', name: 'Сухой Суперджет 100', short: 'SSJ100', seats: 98, oew: 24250, mtow: 45900, fuelCap: 15800,
    S: 83.8, T0: 2 * 77000, cd0: 0.023, ar: 9.6, e: 0.8, ceiling: 12000, cruiseM: 0.78,
    fuelPerKm: 2.6, burnHr: 1900, opPerKm: 380, price: 0, value: 2000000, minRwy: 1800,
    flapLim: [999, 112, 104, 98, 92], gearLim: 128, color: '#2f7df6',
    desc: 'Региональный лайнер. Лёгкий и послушный — отлично для обучения.' },
  { id: 'crj2', name: 'Bombardier CRJ-200', short: 'CRJ200', seats: 50, oew: 14000, mtow: 23000, fuelCap: 5800,
    S: 54.0, T0: 2 * 41000, cd0: 0.024, ar: 8.9, e: 0.78, ceiling: 12400, cruiseM: 0.74,
    fuelPerKm: 1.9, burnHr: 1400, opPerKm: 250, price: 1200000, value: 1200000, minRwy: 1500,
    flapLim: [999, 112, 104, 96, 90], gearLim: 128, color: '#e8a53a',
    desc: 'Малый региональный джет на 50 мест. Короткая полоса — не проблема, но порывистый и «быстрый».' },
  { id: 'e190', name: 'Embraer E190', short: 'E190', seats: 100, oew: 28000, mtow: 51800, fuelCap: 12900,
    S: 92.5, T0: 2 * 82000, cd0: 0.024, ar: 8.6, e: 0.8, ceiling: 12400, cruiseM: 0.78,
    fuelPerKm: 2.5, burnHr: 1900, opPerKm: 360, price: 3000000, value: 3000000, minRwy: 1700,
    flapLim: [999, 114, 106, 98, 92], gearLim: 128, color: '#2aa3a3',
    desc: 'Региональный лайнер: аккуратный, экономичный, подходит для коротких полос.' },
  { id: 'e175', name: 'Embraer E175', short: 'E175', seats: 78, oew: 21700, mtow: 38790, fuelCap: 9400,
    S: 72.7, T0: 2 * 62300, cd0: 0.0235, ar: 9.3, e: 0.8, ceiling: 12400, cruiseM: 0.78,
    fuelPerKm: 2.2, burnHr: 1650, opPerKm: 320, price: 2200000, value: 2200000, minRwy: 1600,
    flapLim: [999, 114, 106, 98, 92], gearLim: 128, color: '#3a9ad9',
    desc: 'Региональный лайнер на 78 мест: лёгкий, манёвренный, любит короткие полосы.' },
  { id: 'mc21', name: 'Иркут МС-21-300', short: 'МС-21', seats: 211, oew: 50000, mtow: 79250, fuelCap: 21000,
    S: 123.0, T0: 2 * 140000, cd0: 0.0205, ar: 11.5, e: 0.84, ceiling: 12500, cruiseM: 0.78,
    fuelPerKm: 3.3, burnHr: 2450, opPerKm: 510, price: 7500000, value: 7500000, minRwy: 2200,
    flapLim: [999, 118, 110, 100, 98], gearLim: 128, color: '#c8d4e8',
    desc: 'Российский узкофюзеляжный лайнер с большим композитным крылом: экономичный и устойчивый.' },
  { id: 't204', name: 'Ту-204-100', short: 'Ту-204', seats: 210, oew: 58300, mtow: 103000, fuelCap: 35000,
    S: 182.4, T0: 2 * 158000, cd0: 0.0225, ar: 9.0, e: 0.8, ceiling: 12100, cruiseM: 0.78,
    fuelPerKm: 4.4, burnHr: 3500, opPerKm: 700, price: 9000000, value: 9000000, minRwy: 2300,
    flapLim: [999, 120, 112, 102, 98], gearLim: 128, color: '#4a8a4a',
    desc: 'Российский среднемагистральный лайнер с мощным крылом: тяжелее и «инертнее» A320.' },
  { id: 'a320', name: 'Airbus A320', short: 'A320', seats: 180, oew: 42600, mtow: 78000, fuelCap: 19000,
    S: 122.6, T0: 2 * 111000, cd0: 0.022, ar: 9.5, e: 0.8, ceiling: 12000, cruiseM: 0.78,
    fuelPerKm: 3.3, burnHr: 2500, opPerKm: 520, price: 4500000, value: 4500000, minRwy: 2000,
    flapLim: [999, 118, 110, 100, 98], gearLim: 128, color: '#e0463a',
    desc: 'Самый массовый узкофюзеляжный лайнер мира.' },
  { id: 'b738', name: 'Boeing 737-800', short: 'B737', seats: 189, oew: 41400, mtow: 79000, fuelCap: 20800,
    S: 125.0, T0: 2 * 121000, cd0: 0.0225, ar: 9.45, e: 0.8, ceiling: 12500, cruiseM: 0.785,
    fuelPerKm: 3.2, burnHr: 2600, opPerKm: 540, price: 5500000, value: 5500000, minRwy: 2100,
    flapLim: [999, 118, 108, 100, 96], gearLim: 128, color: '#1d6bd6',
    desc: 'Надёжная рабочая лошадка с чуть большей вместимостью.' },
  { id: 'a223', name: 'Airbus A220-300', short: 'A220', seats: 145, oew: 37000, mtow: 70900, fuelCap: 17500,
    S: 112.3, T0: 2 * 105000, cd0: 0.0215, ar: 11.0, e: 0.82, ceiling: 12500, cruiseM: 0.78,
    fuelPerKm: 3.0, burnHr: 2300, opPerKm: 470, price: 6000000, value: 6000000, minRwy: 1800,
    flapLim: [999, 118, 110, 100, 96], gearLim: 128, color: '#d94f8a',
    desc: 'Современный узкофюзеляжник с большим крылом: отлично держится на малых скоростях.' },
  { id: 'a321', name: 'Airbus A321', short: 'A321', seats: 220, oew: 48500, mtow: 93500, fuelCap: 23700,
    S: 122.6, T0: 2 * 133000, cd0: 0.0225, ar: 9.5, e: 0.8, ceiling: 12000, cruiseM: 0.78,
    fuelPerKm: 3.9, burnHr: 2900, opPerKm: 600, price: 8000000, value: 8000000, minRwy: 2300,
    flapLim: [999, 118, 110, 100, 98], gearLim: 128, color: '#c4452f',
    desc: 'Удлинённый A320: больше мест, длиннее разбег и посадка.' },
  { id: 'b763', name: 'Boeing 767-300ER', short: 'B767', seats: 260, oew: 86000, mtow: 186900, fuelCap: 73000,
    S: 283.3, T0: 2 * 282000, cd0: 0.0215, ar: 8.0, e: 0.8, ceiling: 12200, cruiseM: 0.80,
    fuelPerKm: 6.3, burnHr: 5400, opPerKm: 1150, price: 22000000, value: 22000000, minRwy: 2400,
    flapLim: [999, 120, 112, 102, 98], gearLim: 128, color: '#3b6fd1',
    desc: 'Проверенный широкофюзеляжник среднего размера для дальних рейсов.' },
  { id: 'a333', name: 'Airbus A330-300', short: 'A330', seats: 300, oew: 129000, mtow: 242000, fuelCap: 97000,
    S: 361.6, T0: 2 * 300000, cd0: 0.021, ar: 10.1, e: 0.82, ceiling: 12500, cruiseM: 0.82,
    fuelPerKm: 6.8, burnHr: 5800, opPerKm: 1250, price: 32000000, value: 32000000, minRwy: 2600,
    flapLim: [999, 120, 112, 102, 98], gearLim: 128, color: '#1c9a6b',
    desc: 'Широкофюзеляжный дальнемагистральный. Рейсы через полмира.' },
  { id: 'b789', name: 'Boeing 787-9', short: 'B787', seats: 290, oew: 128000, mtow: 254000, fuelCap: 101000,
    S: 377.0, T0: 2 * 320000, cd0: 0.0195, ar: 11.0, e: 0.84, ceiling: 13100, cruiseM: 0.85,
    fuelPerKm: 6.1, burnHr: 5400, opPerKm: 1250, price: 52000000, value: 52000000, minRwy: 2500,
    flapLim: [999, 122, 114, 104, 100], gearLim: 128, color: '#33b3d6',
    desc: 'Экономичный композитный лайнер с длинным гибким крылом.' },
  { id: 'a359', name: 'Airbus A350-900', short: 'A350', seats: 325, oew: 142400, mtow: 280000, fuelCap: 110000,
    S: 442.0, T0: 2 * 374000, cd0: 0.0195, ar: 9.5, e: 0.83, ceiling: 13100, cruiseM: 0.85,
    fuelPerKm: 7.0, burnHr: 6300, opPerKm: 1400, price: 64000000, value: 64000000, minRwy: 2600,
    flapLim: [999, 122, 114, 104, 100], gearLim: 128, color: '#4bd1a0',
    desc: 'Дальнемагистральный флагман нового поколения: тихий и очень дальний.' },
  { id: 'b77w', name: 'Boeing 777-300ER', short: 'B777', seats: 370, oew: 167800, mtow: 351500, fuelCap: 145500,
    S: 427.8, T0: 2 * 513000, cd0: 0.0205, ar: 9.0, e: 0.82, ceiling: 13100, cruiseM: 0.84,
    fuelPerKm: 8.5, burnHr: 7500, opPerKm: 1600, price: 85000000, value: 85000000, minRwy: 3000,
    flapLim: [999, 122, 114, 104, 100], gearLim: 128, color: '#8a4bd1',
    desc: 'Флагман. Огромная вместимость и дальность.' },
];
export const PL_BY = Object.fromEntries(PLANES.map(p => [p.id, p]));

export function distKm(a, b) {
  const R = 6371, t = Math.PI / 180;
  const dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a, b) {
  const t = Math.PI / 180, la = a.lat * t, lb = b.lat * t, dl = (b.lon - a.lon) * t;
  const y = Math.sin(dl) * Math.cos(lb), x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dl);
  return (Math.atan2(y, x) / t + 360) % 360;
}

export const PAX_KG = 95; // пассажир с багажом
export const FUEL_PRICE = 70; // ₽ за кг

export function reserveFuel(p) { return p.burnHr * 0.75 + 500; }
export function tripFuel(p, km) { return Math.min(p.fuelCap, km * p.fuelPerKm * 1.12 + reserveFuel(p)); }
export function maxRangeKm(p) { return (p.fuelCap * 0.98 - reserveFuel(p)) / (p.fuelPerKm * 1.12); }
export function recommendedCruise(km) { return km < 450 ? 5400 : km < 900 ? 7800 : km < 1600 ? 9600 : 10800; }

// Рейсовый контракт
export function makeContract(plane, from, to, rnd) {
  const km = distKm(from, to);
  const fuel = tripFuel(plane, km);
  const maxPax = Math.floor((plane.mtow * 0.999 - plane.oew - fuel) / PAX_KG);
  const pax = Math.max(10, Math.min(maxPax, Math.round(plane.seats * (0.62 + rnd() * 0.38))));
  const rate = 14 + 2400 / (km + 150);
  return { from: from.id, to: to.id, km, pax, fuel, revenue: Math.round(pax * km * rate) };
}

// Список доступных рейсов из аэропорта для самолёта
export function contractsFor(plane, fromId, seed) {
  const from = AP_BY[fromId];
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const list = [];
  for (const a of AIRPORTS) {
    if (a.id === from.id) continue;
    const km = distKm(from, a);
    if (km < 250 || km > maxRangeKm(plane)) continue;
    if (a.rwy < plane.minRwy || from.rwy < plane.minRwy) continue;
    list.push(makeContract(plane, from, a, rnd));
  }
  list.sort((x, y) => x.km - y.km);
  return list;
}

export const fmtRub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';

// ---------- погода на рейс ----------
// dir — откуда дует (истинный курс, °), spd/gust — м/с, vis/visD — видимость в аэропорту вылета/назначения, м, rain/rainD — дождь 0..1
export const WX_NAMES = ['штиль', 'обычная', 'сложная'];
export function makeWeather(rnd, level, brg, season) {
  const L = level | 0;
  const w = makeWeather0(rnd, level, brg);
  if (!L) return w;
  const winter = season === 2 || (!season && rnd() < 0.3);
  if (winter) { w.winter = true; w.temp = Math.round(-26 + rnd() * 28); w.snow = true; w.snowG = true; if (w.temp > 1) w.temp = 1; }
  return w;
}
function makeWeather0(rnd, level, brg) {
  const L = level | 0;
  if (L <= 0) return { dir: brg || 0, spd: 0, gust: 0, vis: 10000, visD: 10000, rain: 0, rainD: 0, temp: 14, qnh: 1013, level: 0 };
  const cfg = L === 1 ? { s: [2, 8], g: [0, 4], bad: 0.15, rain: 0.2 } : { s: [6, 13], g: [3, 8], bad: 0.45, rain: 0.5 };
  let spd = cfg.s[0] + rnd() * (cfg.s[1] - cfg.s[0]), gust = cfg.g[0] + rnd() * (cfg.g[1] - cfg.g[0]);
  const rel = (rnd() * 2 - 1) * 100;
  const cw = Math.abs(Math.sin(rel * Math.PI / 180)) * (spd + gust);
  if (cw > 9) { const k = 9 / cw; spd *= k; gust *= k; }
  const vis = () => (rnd() < cfg.bad ? 700 + rnd() * 3300 : 6000 + rnd() * 4000);
  const rn = () => (rnd() < cfg.rain ? 0.3 + rnd() * 0.7 : 0);
  return { dir: ((brg || 0) + rel + 360) % 360, spd, gust, vis: vis(), visD: vis(), rain: rn(), rainD: rn(), temp: Math.round(-12 + rnd() * 47), qnh: Math.round(1000 + rnd() * 25), level: L, jet: Math.round((rnd() < 0.5 ? -1 : 1) * (6 + rnd() * (L > 1 ? 18 : 10))) };
}
// текст метеосводки для брифинга; headwind > 0 — встречный, cross > 0 — ветер справа
export function metarText(ap, wx, which) {
  const dep = which === 'dep', vis = dep ? wx.vis : wx.visD, rain = dep ? wx.rain : wx.rainD;
  const w = wx.spd < 1 ? 'штиль' : `${String(Math.round(wx.dir / 10) * 10 % 360).padStart(3, '0')}° / ${Math.round(wx.spd)} м/с` + (wx.gust > 1.5 ? `, порывы до ${Math.round(wx.spd + wx.gust)}` : '');
  const v = vis >= 9000 ? 'более 9 км' : vis >= 1000 ? (vis / 1000).toFixed(1).replace('.0', '') + ' км' : Math.round(vis / 50) * 50 + ' м';
  return `${ap.id}${dep && wx.live ? ' (реальная погода)' : ''}: ветер ${w}; видимость ${v}${rain > 0.6 ? (wx.snow ? '; сильный снегопад' : '; сильный дождь') : rain > 0.1 ? (wx.snow ? '; снег' : '; дождь') : ''}${wx.snowG ? '; полоса со снежным накатом' : ''}; QNH ${wx.qnh}, t ${wx.temp}°`;
}
export function windComp(wx, brg) {
  const rel = (wx.dir - brg) * Math.PI / 180, S = wx.spd + wx.gust * 0.5;
  return { head: Math.cos(rel) * S, cross: Math.sin(rel) * S }; // cross > 0: ветер справа
}

// ---------- реальная погода (METAR) ----------
// Пробуем получить сводку с aviationweather.gov; при любой ошибке/таймауте возвращаем null — игра берёт случайную погоду.
export async function fetchMetar(icao, ms = 3000) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    const r = await fetch('https://aviationweather.gov/api/data/metar?format=json&ids=' + icao, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json(), m = Array.isArray(j) ? j[0] : null;
    if (!m || m.wspd == null) return null;
    const kt = 0.5144, vis = String(m.visib == null ? '10+' : m.visib), miles = parseFloat(vis) * (vis.includes('+') ? 1 : 1);
    const wxs = String(m.wxString || '');
    const out = { dir: (m.wdir === 'VRB' || m.wdir == null) ? 0 : +m.wdir, spd: m.wspd * kt, gust: Math.max(0, ((m.wgst || m.wspd) - m.wspd) * kt),
      vis: Math.min(10000, Math.round(miles * 1609)), rain: /TS|\+RA|\+SN/.test(wxs) ? 0.9 : /RA|SN|DZ|SH/.test(wxs) ? 0.4 : 0,
      snow: /SN|SG|PL/.test(wxs), temp: Math.round(m.temp ?? 14), qnh: Math.round(m.altim > 800 ? m.altim : 1013) };
    return out;
  } catch (e) { return null; }
}
// накладывает живую сводку на случайную погоду (which: 'dep' | 'dst'); ветер берём из вылета, ограничиваем боковую составляющую
export function applyMetar(wx, live, which) {
  if (!live) return;
  if (which === 'dep') { wx.dir = live.dir; wx.spd = Math.min(live.spd, 14); wx.gust = Math.min(live.gust, 8); wx.temp = live.temp; wx.qnh = live.qnh; wx.vis = Math.max(500, live.vis); wx.rain = live.rain; if (live.snow && live.rain) { wx.snow = true; wx.snowG = true; } wx.live = true; }
  else { wx.visD = Math.max(500, live.vis); wx.rainD = live.rain; }
}
