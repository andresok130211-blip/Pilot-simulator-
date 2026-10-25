// Собирает логику без графики (data, geo, events, terrain, sim, api) в один файл godot/assets/sim.js для встроенного JS-движка.
import fs from 'fs';
const R = p => fs.readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
let out = `var __m = {};
if (typeof atob === 'undefined') { var atob = function (s) { var T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = '', b = 0, n = 0; for (var i = 0; i < s.length; i++) { var k = T.indexOf(s[i]); if (k < 0) continue; b = (b << 6) | k; n += 6; if (n >= 8) { n -= 8; o += String.fromCharCode((b >> n) & 255); } } return o; }; }
`;
const exp = [];
for (const m of ['data', 'icao', 'geodata', 'inflate', 'geodem', 'geobiome', 'geo', 'events', 'terrain', 'sim', 'api']) {
  let s = R(`js/${m}.js`);
  const names = [];
  s = s.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/(\w+)\.js';?$/gm, (_, list, mod) => `const {${list}} = __m.${mod};`);
  s = s.replace(/^export\s+(const|let|async function|function|class)\s+(\w+)/gm, (_, k, n) => { names.push(n); return `${k} ${n}`; });
  out += `__m.${m} = (function(){\n${s}\nreturn {${names.join(',')}};\n})();\n`;
  if (m === 'api') for (const n of names) exp.push(n);
}
out += exp.map(n => `var ${n} = __m.api.${n};`).join('\n') + '\n';
fs.writeFileSync(new URL('../godot/assets/sim.js', import.meta.url), out);
console.log('godot/assets/sim.js', out.length, 'bytes');
