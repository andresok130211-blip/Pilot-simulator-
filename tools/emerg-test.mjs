import { fly } from './bot.mjs';
import { EVENT_IDS } from '../src/js/events.js';
const route = process.argv[2] ? process.argv[2].split('-') : ['SVO', 'LED'];
const plane = process.argv[3] || 'a320';
const only = process.argv[4] ? process.argv[4].split(',') : EVENT_IDS;
for (const id of only) for (const mode of ['auto', 'manual']) {
  const assist = mode === 'auto' ? { auto: true, config: true } : { auto: false, config: false };
  try {
    const { f, r, t } = fly(plane, route[0], route[1], { force: [id], assist, taxi: false, warp: 32 });
    console.log(id.padEnd(9), mode.padEnd(6), f.result.kind.padEnd(7), 'ev', JSON.stringify(f.evLog.map(e => e.id + ':' + e.outcome)), 'fuel', f.fuel.toFixed(0), 'td', f.td ? f.td.sink.toFixed(1) : '-', 'min', (t / 60).toFixed(0), f.result.reason.slice(0, 60), 'xp', r.xp, 'inc', f.incidents.map(i => i.key).join());
  } catch (e) { console.log(id, mode, 'ERR', e.stack.split('\n').slice(0, 3).join(' | ')); }
}
