// Собирает src/ в один файл www/index.html (удобно для загрузки на GitHub с телефона).
import fs from 'fs';
const R = p => fs.readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
let out = '';
for (const m of ['data', 'sim', 'render', 'main']) {
  let s = R(`js/${m}.js`);
  const names = [];
  s = s.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/(\w+)\.js';?$/gm, (_, list, mod) => `const {${list}} = __m.${mod};`);
  s = s.replace(/^export\s+(const|let|function|class)\s+(\w+)/gm, (_, k, n) => { names.push(n); return `${k} ${n}`; });
  out += `__m.${m} = (function(){\n${s}\nreturn {${names.join(',')}};\n})();\n`;
}
let html = R('index.html')
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${R('css/style.css')}</style>`)
  .replace('<script type="module" src="js/main.js"></script>', `<script>\nconst __m = {};\n${out}</script>`);
fs.mkdirSync(new URL('../www/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../www/index.html', import.meta.url), html);
console.log('www/index.html', html.length, 'bytes');
