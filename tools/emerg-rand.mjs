import { fly } from './bot.mjs';
const mk = s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const pl = ['ssj', 'a320', 'b738', 'a333', 'b77w'];
const routes = [['SVO', 'LED'], ['SVO', 'KZN'], ['LED', 'SVO']];
const stat = {};
for (let i = 0; i < 24; i++) {
  const r = mk(1000 + i), p = pl[i % 3 + (i % 5 === 0 ? 1 : 0)], rt = routes[i % 3], mode = i % 2 ? 'auto' : 'manual';
  const assist = mode === 'auto' ? { auto: true, config: true } : { auto: false, config: false };
  try {
    const { f, r: res } = fly(p, rt[0], rt[1], { emerg: 3, rnd: r, assist, taxi: i % 4 === 0, warp: 32 });
    const k = f.result.kind; stat[k] = (stat[k] || 0) + 1;
    console.log(i, p, rt.join('-'), mode.padEnd(6), k.padEnd(7), JSON.stringify(f.evLog.map(e => e.id + ':' + e.outcome)), f.result.reason.slice(0, 70));
  } catch (e) { console.log(i, 'ERR', e.stack.split('\n').slice(0, 3).join('|')); }
}
console.log(stat);
