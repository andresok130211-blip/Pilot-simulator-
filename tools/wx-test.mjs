import { fly } from './bot.mjs';
import { makeWeather, PL_BY, AP_BY, bearing } from '../src/js/data.js';
const mk = s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const routes = [['SVO', 'LED'], ['SVO', 'KZN'], ['LED', 'SVO'], ['KRR', 'SVO']];
const stat = {};
const N = +process.argv[2] || 16, LV = +process.argv[3] || 2;
for (let i = 0; i < N; i++) {
  const r = mk(500 + i), rt = routes[i % 4], pl = ['a320', 'ssj', 'b738'][i % 3], mode = i % 2 ? 'auto' : 'manual';
  const wx = makeWeather(r, LV, bearing(AP_BY[rt[0]], AP_BY[rt[1]]));
  const assist = mode === 'auto' ? { auto: true, config: true } : { auto: false, config: false };
  try {
    const { f } = fly(pl, rt[0], rt[1], { wx, assist, taxi: i % 4 === 0, warp: 32 });
    const k = f.result.kind; stat[k] = (stat[k] || 0) + 1;
    console.log(i, pl, rt.join('-'), mode.padEnd(6), k.padEnd(7), `wind ${wx.dir.toFixed(0)}/${wx.spd.toFixed(0)}+${wx.gust.toFixed(0)} vis ${wx.visD.toFixed(0)} rain ${wx.rainD.toFixed(1)}`, f.td ? `td ${f.td.sink.toFixed(1)} lat ${f.td.lat.toFixed(0)} past ${f.td.past.toFixed(0)}` : '', f.result.reason.slice(0, 60), f.incidents.map(i => i.key).join());
  } catch (e) { console.log(i, 'ERR', e.stack.split('\n').slice(0, 3).join('|')); }
}
console.log(stat);
