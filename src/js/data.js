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
  { id: 'a333', name: 'Airbus A330-300', short: 'A330', seats: 300, oew: 129000, mtow: 242000, fuelCap: 97000,
    S: 361.6, T0: 2 * 300000, cd0: 0.021, ar: 10.1, e: 0.82, ceiling: 12500, cruiseM: 0.82,
    fuelPerKm: 6.8, burnHr: 5800, opPerKm: 1250, price: 32000000, value: 32000000, minRwy: 2600,
    flapLim: [999, 120, 112, 102, 98], gearLim: 128, color: '#1c9a6b',
    desc: 'Широкофюзеляжный дальнемагистральный. Рейсы через полмира.' },
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
