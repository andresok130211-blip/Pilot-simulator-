// Выгружает данные мира из JS-модулей в двоичные файлы для Godot-версии (godot/data)
import fs from 'fs'; import zlib from 'zlib';
const g = await import('../src/js/geodata.js'), d = await import('../src/js/geodem.js'), b = await import('../src/js/geobiome.js');
const out = 'godot/data/';
const w = (n, buf) => { fs.writeFileSync(out + n, buf); console.log(n, buf.length); };
w('land.bin', Buffer.from(g.GEO_LAND, 'base64'));
w('rivers.bin', Buffer.from(g.GEO_RIVERS, 'base64'));
w('cities.bin', Buffer.from(g.GEO_CITIES, 'base64'));
w('bio.bin', Buffer.from(b.BIO_DATA, 'base64'));
w('dem.bin', zlib.inflateRawSync(Buffer.from(d.DEM_DATA, 'base64')));
console.log(JSON.stringify({ GEO_RES: g.GEO_RES, GEO_W: g.GEO_W, GEO_H: g.GEO_H, DEM_W: d.DEM_W, DEM_H: d.DEM_H, DEM_UNIT: d.DEM_UNIT, BIO_RES: b.BIO_RES, BIO_W: b.BIO_W, BIO_H: b.BIO_H }));
