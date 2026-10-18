// Отрисовка: вид из кабины (псевдо-3D), HUD, карта для меню.
import { DEG, GS_TAN, GS_DEG, AIM_OFFSET, FLAP_NAMES, stallIAS, APPR_ALT } from './sim.js';
import { AIRPORTS, AP_BY } from './data.js';
import { heightW, toWorld, toLocal, wetAt, sstep, worldHash, fbm } from './terrain.js';

const PAL = [
  { // день
    skyTop: [44, 116, 209], skyHor: [189, 228, 255], skyHi: [8, 40, 100],
    ground: ['#5a8240', '#6c9446', '#86884f', '#4c7536', '#7a6c46', '#6f8f58'], base: '#5e8645',
    haze: [189, 228, 255], runway: '#3c3f46', mark: '#f2f2f2', apron: '#5a5d65', build: ['#aab3c4', '#8e98ac', '#cfd5e2'], night: 0,
  },
  { // закат
    skyTop: [40, 48, 112], skyHor: [255, 154, 94], skyHi: [10, 16, 48],
    ground: ['#3b5438', '#47623b', '#5c5b3f', '#35512f', '#534b39', '#40583a'], base: '#3f5a3a',
    haze: [224, 144, 122], runway: '#2e3037', mark: '#e6dccf', apron: '#43454d', build: ['#8f8795', '#756e80', '#aaa0ac'], night: 0.35,
  },
  { // ночь
    skyTop: [2, 5, 13], skyHor: [26, 42, 82], skyHi: [1, 3, 10],
    ground: ['#0c170f', '#0e1b12', '#111b15', '#0a140d', '#13180f', '#0d1a14'], base: '#0d170f',
    haze: [26, 42, 82], runway: '#17181d', mark: '#a9a9a9', apron: '#1b1c21', build: ['#252a36', '#1d212c', '#2d3340'], night: 1,
  },
];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function hash2(i, j, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- состояние камеры ----
let ctx, W, H, F, CX, CY, camX, camY, camZ = 0, yc = 1, ys = 0, camPsi = 0, ct, st, NEAR = 1.2, U = 1;
const bF = new Float64Array(40), bU = new Float64Array(40), bZ = new Float64Array(40);
const oF = new Float64Array(40), oU = new Float64Array(40), oZ = new Float64Array(40);
const P = new Float64Array(60);

let seam = false;
function polyFlat(pts, n, fill) {
  for (let i = 0; i < n; i++) {
    const dx0 = pts[3 * i] - camX, dy = pts[3 * i + 1] - camY, dz0 = pts[3 * i + 2] - camZ;
    const dx = dx0 * yc + dz0 * ys; // вперёд с учётом курса
    bF[i] = dx * ct + dy * st; bU[i] = -dx * st + dy * ct; bZ[i] = -dx0 * ys + dz0 * yc;
  }
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, fa = bF[i], fb = bF[j];
    const ia = fa >= NEAR, ib = fb >= NEAR;
    if (ia) { oF[m] = fa; oU[m] = bU[i]; oZ[m] = bZ[i]; m++; }
    if (ia !== ib) { const t = (NEAR - fa) / (fb - fa); oF[m] = NEAR; oU[m] = bU[i] + (bU[j] - bU[i]) * t; oZ[m] = bZ[i] + (bZ[j] - bZ[i]) * t; m++; }
  }
  if (m < 3) return false;
  ctx.beginPath();
  for (let k = 0; k < m; k++) {
    const sx = CX + F * oZ[k] / oF[k], sy = CY - F * oU[k] / oF[k];
    if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
  }
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (seam) { ctx.strokeStyle = fill; ctx.lineWidth = 1; ctx.stroke(); }
  return true;
}
function rect(x0, z0, x1, z1, fill, y = 0) {
  P[0] = x0; P[1] = y; P[2] = z0; P[3] = x1; P[4] = y; P[5] = z0; P[6] = x1; P[7] = y; P[8] = z1; P[9] = x0; P[10] = y; P[11] = z1;
  return polyFlat(P, 4, fill);
}
function toScreen(X, Y, Z, out) {
  const dx0 = X - camX, dy = Y - camY, dz0 = Z - camZ;
  const dx = dx0 * yc + dz0 * ys, rz = -dx0 * ys + dz0 * yc;
  const f = dx * ct + dy * st, u = -dx * st + dy * ct;
  if (f < NEAR) return false;
  out.x = CX + F * rz / f; out.y = CY - F * u / f; out.f = f; return true;
}
const SP = { x: 0, y: 0, f: 0 };
function box(x0, x1, z0, z1, hgt, cols) {
  // грани: ближняя по x, верх, боковые
  const faces = [
    [[x0, 0, z0], [x0, 0, z1], [x0, hgt, z1], [x0, hgt, z0]], // перед (x0)
    [[x1, 0, z0], [x1, 0, z1], [x1, hgt, z1], [x1, hgt, z0]], // зад (x1)
    [[x0, 0, z0], [x1, 0, z0], [x1, hgt, z0], [x0, hgt, z0]], // бок z0
    [[x0, 0, z1], [x1, 0, z1], [x1, hgt, z1], [x0, hgt, z1]], // бок z1
    [[x0, hgt, z0], [x1, hgt, z0], [x1, hgt, z1], [x0, hgt, z1]], // крыша
  ];
  const nrm = [[-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0]];
  const cz = (z0 + z1) / 2, cxm = (x0 + x1) / 2;
  const shade = [0.78, 0.9, 1.0, 0.7, 1.12];
  for (let i = 0; i < 5; i++) {
    const n = nrm[i];
    const fx = i === 0 ? x0 : i === 1 ? x1 : cxm, fy = i === 4 ? hgt : hgt / 2, fz = i === 2 ? z0 : i === 3 ? z1 : cz;
    if (n[0] * (camX - fx) + n[1] * (camY - fy) + n[2] * (camZ - fz) <= 0) continue;
    for (let k = 0; k < 4; k++) { P[3 * k] = faces[i][k][0]; P[3 * k + 1] = faces[i][k][1]; P[3 * k + 2] = faces[i][k][2]; }
    const c = cols[i % cols.length];
    polyFlat(P, 4, shadeCol(c, shade[i]));
  }
}
const shadeCache = new Map();
function shadeCol(hex, k) {
  const key = hex + k;
  let r = shadeCache.get(key);
  if (!r) {
    const n = parseInt(hex.slice(1), 16);
    r = `rgb(${clamp(((n >> 16) & 255) * k, 0, 255) | 0},${clamp(((n >> 8) & 255) * k, 0, 255) | 0},${clamp((n & 255) * k, 0, 255) | 0})`;
    shadeCache.set(key, r);
  }
  return r;
}

// ---- вспомогательные элементы сцены ----
function drawSky(pal, hy, hi, f) {
  const top = mixc(pal.skyTop, pal.skyHi, hi);
  const hor = mixc(pal.skyHor, mixc(pal.skyHor, pal.skyTop, 0.5), hi * 0.6);
  const m = H;
  const g = ctx.createLinearGradient(0, hy - H * 1.4, 0, hy);
  g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(hor));
  ctx.fillStyle = g; ctx.fillRect(-W, -H * 1.5, W * 3, hy + H * 1.5 + 2);
  // звёзды
  const starA = pal.night > 0.8 ? 1 : clamp(hi * 1.2 - 0.3, 0, 0.8) + pal.night * 0.3;
  if (starA > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${starA})`;
    for (let i = 0; i < 90; i++) {
      const sx = hash2(i, 1, 9) * W * 1.2 - W * 0.1, sy = hash2(i, 2, 9) * Math.max(10, hy - 4);
      const r = hash2(i, 3, 9) < 0.15 ? 1.8 : 1;
      ctx.fillRect(sx, sy, r, r);
    }
  }
  // солнце / луна
  const sunEl = pal === PAL[0] ? 38 : pal === PAL[1] ? 2.5 : 28;
  const sy = CY + F * Math.tan(f.theta - sunEl * DEG), sx = W * 0.72 - F * camPsi;
  if (sy > -F && sy < H + F) {
    if (pal.night < 0.8) {
      const r = (pal === PAL[1] ? 90 : 60) * U;
      const gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
      gg.addColorStop(0, pal === PAL[1] ? 'rgba(255,200,130,.95)' : 'rgba(255,255,230,.9)');
      gg.addColorStop(0.15, pal === PAL[1] ? 'rgba(255,170,100,.55)' : 'rgba(255,250,210,.35)');
      gg.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = gg; ctx.fillRect(sx - r * 3, sy - r * 3, r * 6, r * 6);
      ctx.fillStyle = pal === PAL[1] ? '#ffe0b0' : '#fffff0';
      ctx.beginPath(); ctx.arc(sx, sy, 11 * U, 0, 6.3); ctx.fill();
    } else {
      ctx.fillStyle = '#eef2ff'; ctx.beginPath(); ctx.arc(sx, sy, 9 * U, 0, 6.3); ctx.fill();
      ctx.fillStyle = rgb(top); ctx.beginPath(); ctx.arc(sx + 4 * U, sy - 2 * U, 8 * U, 0, 6.3); ctx.fill();
    }
  }
}
function drawMountains(pal, hy, f) {
  const haze = pal.haze;
  for (let layer = 0; layer < 2; layer++) {
    const amp = H * (layer ? 0.045 : 0.075), base = layer ? 0.35 : 0.55;
    const col = mixc(mixc(haze, [60, 80, 80], layer ? 0.5 : 0.25), pal.night > 0.5 ? [6, 10, 16] : [30, 50, 50], pal.night * 0.7);
    ctx.fillStyle = rgb(col);
    ctx.beginPath(); ctx.moveTo(-W, hy + 2);
    for (let x = -W; x <= W * 2; x += 14) {
      const k = (x + F * camPsi) / W * 6.28 * (layer ? 2.3 : 1.4);
      const v = 0.5 + 0.28 * Math.sin(k + layer * 2.1) + 0.2 * Math.sin(k * 2.7 + 1.3 + layer) + 0.12 * Math.sin(k * 6.1 + layer * 4);
      ctx.lineTo(x, hy - amp * v * base * 1.8);
    }
    ctx.lineTo(W * 2, hy + 2); ctx.closePath(); ctx.fill();
  }
}

const cellI = new Int32Array(2000), cellJ = new Int32Array(2000), cellD = new Float64Array(2000);
function drawGround(pal, hy, f) {
  ctx.fillStyle = pal.base;
  ctx.fillRect(-W, hy, W * 3, H * 2.2);
  const hh = Math.max(camY, 25);
  const lv = Math.log2(hh / 30), k = Math.floor(lv), fr = lv - k;
  const sA = 60 * Math.pow(2, k), sB = sA * 2;
  const tanH = Math.hypot(W, H) / 2 / F * 1.1;
  const layer = (s, alpha) => {
    if (alpha < 0.03) return;
    ctx.globalAlpha = alpha;
    const iseed = Math.round(s), R = 20;
    const ci = Math.floor(camX / s), cj = Math.floor(camZ / s);
    let n = 0;
    for (let di = -R; di <= R; di++) {
      for (let dj = -R; dj <= R; dj++) {
        const dx = (ci + di + 0.5) * s - camX, dz = (cj + dj + 0.5) * s - camZ;
        const fw = dx * yc + dz * ys, rt = -dx * ys + dz * yc;
        if (fw < -s * 1.5 || fw > R * s) continue;
        if (Math.abs(rt) > fw * tanH + s * 1.8) continue;
        cellI[n] = ci + di; cellJ[n] = cj + dj; cellD[n] = fw; n++;
      }
    }
    const order = new Array(n);
    for (let k = 0; k < n; k++) order[k] = k;
    order.sort((a, b) => cellD[b] - cellD[a]);
    for (let q = 0; q < n; q++) {
      const k = order[q], i = cellI[k], j = cellJ[k];
      const hv = hash2(i, j, iseed);
      rect(i * s, j * s, (i + 1) * s, (j + 1) * s, pal.ground[(hv * 6) | 0]);
      if (pal.night > 0.5 && cellD[k] < 11 * s && hash2(i, j, 77) < 0.06 && camY < 6000) {
        if (toScreen(i * s + s / 2, 0, (j + 0.5) * s, SP) && SP.y > hy) {
          ctx.fillStyle = hv > 0.5 ? '#ffd890' : '#fff0c0';
          const r = Math.max(1, Math.min(3, 600 * U / SP.f * 3));
          ctx.fillRect(SP.x, SP.y, r, r);
        }
      }
    }
    ctx.globalAlpha = 1;
  };
  layer(sB, 1);
  layer(sA, 1 - fr);
}

// ---- ландшафт: сетки разной детализации вокруг камеры, от дальней к ближней ----
const LVN = 16, LVS = [150, 450, 1350, 4050];
const HV = new Float32Array((2 * LVN + 2) * (2 * LVN + 2));
const tA = new Int16Array(1100), tB = new Int16Array(1100), tD = new Float64Array(1100), tOrd = new Array(1100);
const FIELD = [[132, 152, 72], [152, 144, 80], [112, 140, 66], [98, 128, 60], [162, 152, 102], [128, 114, 72], [140, 156, 84], [120, 134, 70]];
const _wp = { x: 0, z: 0 };
let apLocal = [];
const SUN = (() => { const l = Math.hypot(-0.45, 0.8, 0.35); return [-0.45 / l, 0.8 / l, 0.35 / l]; })();
function drawTerrain(pal, hy, f) {
  const hz = pal.haze, night = pal.night;
  const tint = night > 0.6 ? [0.075, 0.1, 0.17] : night > 0.1 ? [0.92, 0.72, 0.64] : [1, 1, 1];
  const fogMix = (c, k) => [c[0] + (hz[0] - c[0]) * k, c[1] + (hz[1] - c[1]) * k, c[2] + (hz[2] - c[2]) * k];
  const bc = fogMix([94 * tint[0], 134 * tint[1], 70 * tint[2]], 0.82);
  ctx.fillStyle = rgb(bc); ctx.fillRect(-W, hy - 1, W * 3, H * 2.2);
  // местные координаты аэродромов
  apLocal.length = 0;
  for (const a of f.world) { toLocal(f.tf, a.wx, a.wz, _wp); apLocal.push(_wp.x, _wp.z); }
  const tanH = Math.hypot(W, H) / 2 / F * 1.15;
  const D0 = 52000 + 5 * Math.max(0, camY);
  const drawn = [false, false, false, false];
  for (let li = 0; li < 4; li++) drawn[li] = !((li === 0 && camY > 6000) || (li === 1 && camY > 16000));
  for (let li = 3; li >= 0; li--) {
    if (!drawn[li]) continue;
    const s = LVS[li], n = LVN, N = 2 * n + 2, ci = Math.floor(camX / s), cj = Math.floor(camZ / s);
    HV.fill(NaN, 0, N * N);
    const getH = (a, b) => {
      const k = a * N + b; let v = HV[k];
      if (v !== v) { toWorld(f.tf, (ci + a - n) * s, (cj + b - n) * s, _wp); v = heightW(f.world, _wp.x, _wp.z); HV[k] = v; }
      return v;
    };
    let m = 0;
    const inner = li > 0 && drawn[li - 1] ? LVS[li - 1] * n - s * 0.6 : -1;
    for (let a = 0; a < 2 * n; a++) {
      for (let b = 0; b < 2 * n; b++) {
        const dx = (ci + a - n + 0.5) * s - camX, dz = (cj + b - n + 0.5) * s - camZ;
        if (inner > 0 && Math.abs(dx) < inner && Math.abs(dz) < inner) continue;
        const fw = dx * yc + dz * ys, rt = -dx * ys + dz * yc;
        if (fw < -s * 1.6 || Math.abs(rt) > Math.max(fw, 0) * tanH + s * 1.9) continue;
        tA[m] = a; tB[m] = b; tD[m] = fw; tOrd[m] = m; m++;
      }
    }
    tOrd.length = m; tOrd.sort((p, q) => tD[q] - tD[p]);
    const patch = Math.max(s, 700);
    for (let q = 0; q < m; q++) {
      const k = tOrd[q], a = tA[k], b = tB[k];
      const h00 = getH(a, b), h10 = getH(a + 1, b), h11 = getH(a + 1, b + 1), h01 = getH(a, b + 1);
      const avg = (h00 + h10 + h11 + h01) / 4;
      const x0 = (ci + a - n) * s, z0 = (cj + b - n) * s, x1 = x0 + s, z1 = z0 + s;
      const water = avg < 0.5;
      const y00 = water ? 0 : Math.max(0, h00), y10 = water ? 0 : Math.max(0, h10), y11 = water ? 0 : Math.max(0, h11), y01 = water ? 0 : Math.max(0, h01);
      const fw = tD[k];
      let r, g, bl;
      toWorld(f.tf, x0 + s / 2, z0 + s / 2, _wp);
      const hv = worldHash(Math.floor(x0 / s), Math.floor(z0 / s), 5 + li);
      let town = 0;
      if (water) {
        const sh = 0.94 + hv * 0.12;
        r = 40 * sh; g = 88 * sh; bl = 126 * sh;
        if (fw < 60000) { const kk = 0.25 * (1 - fw / 60000); r += (hz[0] - r) * kk; g += (hz[1] - g) * kk; bl += (hz[2] - bl) * kk; }
      } else {
        const wet = wetAt(_wp.x, _wp.z);
        const dxs = (h10 + h11 - h00 - h01) / (2 * s), dzs = (h01 + h11 - h00 - h10) / (2 * s);
        const slope = Math.hypot(dxs, dzs);
        const f1 = fbm(_wp.x / 3200, _wp.z / 3200, 3, 61), f2 = fbm(_wp.x / 1500 + 7, _wp.z / 1500, 2, 67);
        r = 104 + 40 * f1; g = 134 + 22 * f1; bl = 62 + 14 * f1;
        const ky = sstep(0.52, 0.66, f2); r += (166 - r) * ky * 0.8; g += (150 - g) * ky * 0.7; bl += (92 - bl) * ky * 0.6;
        const kp = sstep(0.28, 0.2, f2); r += (124 - r) * kp * 0.4; g += (108 - g) * kp * 0.4; bl += (66 - bl) * kp * 0.4;
        const lowFlat = avg > 2 && avg < 110 && slope < 0.18 && wet < 0.6;
        if (wet > 0.52 && avg < 760) { const kf = sstep(0.52, 0.62, wet) * (1 - sstep(520, 760, avg)); r += (38 - r) * kf; g += (80 - g) * kf; bl += (44 - bl) * kf; }
        if (avg < 6 && avg > 0.5) { const kb = 0.55; r += (192 - r) * kb; g += (180 - g) * kb; bl += (138 - bl) * kb; }
        const kr = Math.max(sstep(430, 760, avg), sstep(0.35, 0.7, slope));
        if (kr > 0) { r += (118 - r) * kr; g += (110 - g) * kr; bl += (100 - bl) * kr; }
        const ks = sstep(820, 980, avg - slope * 120);
        if (ks > 0) { r += (240 - r) * ks; g += (243 - g) * ks; bl += (248 - bl) * ks; }
        const sh = 0.975 + hv * 0.05; r *= sh; g *= sh; bl *= sh;
        // освещение по склону
        const ex = dxs * 2.6, ez = dzs * 2.6, nl = Math.hypot(ex, 1, ez), dif = Math.max(0, (-ex * SUN[0] + SUN[1] - ez * SUN[2]) / nl);
        const lk = 0.34 + 0.8 * dif; r *= lk; g *= lk; bl *= lk;
        // города
        if (lowFlat && li <= 2 && li >= 0) {
          let tw = false; const ts = 450;
          if (li <= 1) tw = worldHash(Math.floor((x0 + s / 2) / ts), Math.floor((z0 + s / 2) / ts), 99) < 0.014;
          else { const bi = Math.floor(x0 / ts), bj = Math.floor(z0 / ts); for (let u = 0; u < 3 && !tw; u++) for (let v = 0; v < 3; v++) if (worldHash(bi + u, bj + v, 99) < 0.014) { tw = true; break; } }
          if (tw) {
            let near = true; const cx = x0 + s / 2, cz = z0 + s / 2;
            for (let i = 0; i < apLocal.length; i += 2) if (Math.hypot(apLocal[i] - cx, apLocal[i + 1] - cz) < 5200) { near = false; break; }
            if (near) { town = 1; r = r * 0.45 + 150 * lk * 0.55; g = g * 0.45 + 146 * lk * 0.55; bl = bl * 0.45 + 140 * lk * 0.55; }
          }
        }
      }
      r *= tint[0]; g *= tint[1]; bl *= tint[2];
      const fg = Math.min(0.94, 1 - Math.exp(-fw / D0));
      r += (hz[0] - r) * fg; g += (hz[1] - g) * fg; bl += (hz[2] - bl) * fg;
      P[0] = x0; P[1] = y00; P[2] = z0; P[3] = x1; P[4] = y10; P[5] = z0; P[6] = x1; P[7] = y11; P[8] = z1; P[9] = x0; P[10] = y01; P[11] = z1;
      seam = true; const okp = polyFlat(P, 4, `rgb(${r | 0},${g | 0},${bl | 0})`); seam = false;
      if (!okp) continue;
      // детали вблизи: деревья, дома, огни
      if (li === 0 && fw < 2300 && camY < 900 && !water) {
        const cx = x0 + s / 2, cz = z0 + s / 2;
        if (town) {
          if (hv < 0.6) box(cx - 25, cx + 25, cz - 20, cz + 20, 8 + hv * 20, [pal.build[(hv * 3) | 0], pal.build[1], '#8b7f78']);
          if (night > 0.5 && toScreen(cx, avg + 6, cz, SP)) { ctx.fillStyle = '#ffd890'; ctx.fillRect(SP.x, SP.y, 2, 2); }
        } else if (g < r + 2 * (r - bl) * 0 + 0 && false) { /* зарезервировано */ }
        else if (hv > 0.35 && (g * 1.0 < 120 && r < 90)) {
          for (let t = 0; t < 3; t++) {
            const tx = x0 + worldHash(a, b, 21 + t) * s, tz = z0 + worldHash(a, b, 31 + t) * s, ty = avg;
            if (toScreen(tx, ty + 14, tz, SP)) { const sx = SP.x, sy = SP.y; if (toScreen(tx, ty, tz, SP)) { const w2 = Math.max(1.2, 7 * F / SP.f); ctx.fillStyle = `rgb(${(26 * tint[0] + hz[0] * fg * 0.6) | 0},${(66 * tint[1] + hz[1] * fg * 0.6) | 0},${(34 * tint[2] + hz[2] * fg * 0.6) | 0})`; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(SP.x + w2, SP.y); ctx.lineTo(SP.x - w2, SP.y); ctx.closePath(); ctx.fill(); } }
          }
        }
      } else if (town && night > 0.5 && fw < 25000 && toScreen(x0 + s / 2, avg + 3, z0 + s / 2, SP)) {
        ctx.fillStyle = '#ffcf7a'; const rr = Math.max(1.2, Math.min(5, 300 * F / SP.f / 12));
        for (let t = 0; t < 4; t++) ctx.fillRect(SP.x + (worldHash(a, b, 41 + t) - 0.5) * s * F / SP.f * 0.7, SP.y + (worldHash(a, b, 51 + t) - 0.5) * 3, rr, rr * 0.8);
      }
    }
  }
}

function drawHaze(pal, hy) {
  const hz = pal.haze;
  const g = ctx.createLinearGradient(0, hy - H * 0.05, 0, hy + H * 0.34);
  g.addColorStop(0, rgb(hz, 0.0));
  g.addColorStop(0.12, rgb(hz, 0.92));
  g.addColorStop(1, rgb(hz, 0));
  ctx.fillStyle = g; ctx.fillRect(-W, hy - H * 0.05, W * 3, H * 0.4 + 2);
}

function lightDot(x, y, z, col, size, minf = 8) {
  if (!toScreen(x, y, z, SP)) return;
  if (SP.f > 14000) return;
  const r = clamp(size * F / SP.f, 0.7, 7 * U);
  ctx.fillStyle = col; ctx.fillRect(SP.x - r / 2, SP.y - r / 2, r, r);
}

function drawAirport(pal, x0, len, ap, isDest, f) {
  const far = 14000;
  if (x0 + len + 600 < camX - 200 || x0 - far > camX) return;
  const night = pal.night;
  // руление и перрон
  rect(x0 - 40, 96, x0 + len + 40, 116, pal.apron);
  for (const fx of [0.06, 0.5, 0.93]) rect(x0 + len * fx, 30, x0 + len * fx + 24, 100, pal.apron);
  rect(x0 + len * 0.28, 116, x0 + len * 0.62, 235, pal.apron);
  {
    const Y = pal.night > 0.5 ? '#8a7a22' : '#d8b930', gx = x0 + len * 0.45;
    rect(x0 - 40, 105.6, x0 + len + 40, 106.4, Y);
    for (const fc of [0.06, 0.5, 0.93]) rect(x0 + len * fc + 11.6, 30, x0 + len * fc + 12.4, 106, Y);
    rect(gx - 0.4, 106, gx + 0.4, 205, Y);
    rect(gx - 11, 204.4, gx + 11, 205.4, Y);
    rect(gx - 11, 204.4, gx - 10.2, 226, Y); rect(gx + 10.2, 204.4, gx + 11, 226, Y);
  }
  // ВПП с торцевыми "обочинами"
  rect(x0 - 60, -34, x0 + len + 60, 34, mixc2(pal.runway, 1.12));
  rect(x0, -30, x0 + len, 30, pal.runway);
  const m = pal.mark;
  // осевая
  const camRel = camX - x0;
  const startK = Math.max(0, Math.floor((camRel - 80) / 60));
  const endK = Math.min(Math.floor(len / 60) - 1, Math.floor((camRel + 7000) / 60));
  for (let k = startK; k <= endK; k++) {
    const xs = x0 + 30 + k * 60;
    rect(xs, -0.5, xs + 30, 0.5, m);
  }
  // боковые линии
  rect(x0 + 6, -29, x0 + len - 6, -28.4, m); rect(x0 + 6, 28.4, x0 + len - 6, 29, m);
  // порог
  for (let i = -5; i <= 5; i++) { if (i === 0) continue; rect(x0 + 8, i * 2.6 - 0.8, x0 + 38, i * 2.6 + 0.8, m); rect(x0 + len - 38, i * 2.6 - 0.8, x0 + len - 8, i * 2.6 + 0.8, m); }
  // зона приземления и точка прицеливания
  for (const d of [150, 300, 450, 600]) {
    const w = d === 300 ? 0 : 1;
    if (d !== 300) { rect(x0 + d, -11, x0 + d + 22, -8, m); rect(x0 + d, 8, x0 + d + 22, 11, m); rect(x0 + d, -15, x0 + d + 22, -12, m); rect(x0 + d, 12, x0 + d + 22, 15, m); }
  }
  rect(x0 + 300, -12, x0 + 345, -8, m); rect(x0 + 300, 8, x0 + 345, 12, m);
  // здания
  const bx = x0 + len * 0.3;
  box(bx, bx + len * 0.22, 250, 300, 22, pal.build);
  box(x0 + len * 0.45 - 2.5, x0 + len * 0.45 + 2.5, 228, 250, 5, ['#8e98ac']);
  box(x0 + len * 0.18, x0 + len * 0.18 + 14, 240, 254, 48, pal.build);
  box(x0 + len * 0.18 - 6, x0 + len * 0.18 + 20, 238, 256, 8, ['#556070']);
  if (isDest && f && f.rwyBlocked && !f.td) {
    const tx = x0 + len * 0.38;
    box(tx, tx + 11, -3.2, 3.2, 3.4, ['#ffcc00', '#d9a400', '#b88a00']);
    box(tx + 2, tx + 5, -1.3, 1.3, 5.2, ['#fff4b0']);
    if (Math.floor(f.time * 3) % 2 === 0) box(tx + 3, tx + 4, -0.5, 0.5, 6.4, ['#ff3b30']);
  }
  box(x0 + len * 0.7, x0 + len * 0.7 + 90, 280, 340, 18, pal.build);
  box(x0 + len * 0.78, x0 + len * 0.78 + 70, 150, 190, 10, pal.build);
  // припаркованные самолёты (упрощённые коробки)
  for (let i = 0; i < 5; i++) box(bx + 40 + i * 70, bx + 40 + i * 70 + 36, 128, 136, 7, ['#dfe4ee', '#c9d0de']);
}
function mixc2(hex, k) { return shadeCol(hex, k); }

function drawLights(pal, x0, len, isDest) {
  if (pal.night < 0.3) {
    // днём — только PAPI
  }
  const night = pal.night;
  const camRel = camX - x0;
  if (x0 - 14000 > camX || x0 + len + 800 < camX - 100) return;
  const glow = night > 0.3 ? 1 : 0.55;
  if (night > 0.3) {
    // кромка ВПП
    const k0 = Math.max(0, Math.floor((camRel - 100) / 60)), k1 = Math.min(Math.floor(len / 60), Math.floor((camRel + 12000) / 60));
    for (let k = k0; k <= k1; k++) {
      const x = x0 + k * 60;
      const col = x > x0 + len - 600 ? '#ffb040' : '#fff6dd';
      lightDot(x, 0.3, -31, col, 0.7); lightDot(x, 0.3, 31, col, 0.7);
      if (k % 1 === 0) lightDot(x + 30, 0.2, 0, '#ffffff', 0.4);
    }
    // порог и торец
    for (let i = -10; i <= 10; i++) { lightDot(x0, 0.3, i * 3.1, '#40ff70', 0.8); lightDot(x0 + len, 0.3, i * 3.1, '#ff3030', 0.8); }
    // подходные огни
    for (let i = 1; i <= 30; i++) {
      const x = x0 - i * 30;
      lightDot(x, 0.4, 0, '#ffffff', 1.0);
      if (i % 5 === 0) for (let z = -9; z <= 9; z += 3) if (z) lightDot(x, 0.4, z, '#ffffff', 0.7);
    }
    // рулёжка
    for (let k = 0; k < 20; k++) lightDot(x0 + 20 + k * 160, 0.2, 117, '#4080ff', 0.6);
    // здания: окна
  }
  // PAPI (слева от ВПП)
  const px = x0 + 300;
  if (isDest) {
    const dxp = px - camX;
    const ang = dxp > 50 ? Math.atan2(camY - 3, dxp) / DEG : 99;
    const th = [2.5, 2.83, 3.17, 3.5];
    for (let i = 0; i < 4; i++) {
      const white = ang > th[i];
      lightDot(px, 1.2, -42 - i * 9, white ? '#ffffff' : '#ff2a1a', 1.8);
    }
  }
}

function drawClouds(pal, f) {
  const base = Math.floor(camX / 6000);
  const list = [];
  for (let ci = base - 1; ci < base + 9; ci++) {
    for (let k = 0; k < 3; k++) {
      const hs = (a) => hash2(ci, k, a);
      if (hs(5) < 0.25) continue;
      const alt = 1700 + hs(2) * 2600 + (hs(8) < 0.2 ? 3500 : 0);
      const size = 450 + hs(3) * 900;
      const X = ci * 6000 + hs(1) * 6000, Z = (hs(4) - 0.5) * 12000;
      const dx = (X - camX) * yc + (Z - camZ) * ys, dy = alt - camY;
      const fz = dx * ct + dy * st;
      if (fz < size * 0.4 || fz > 38000) continue;
      list.push([fz, X, alt, Z, size, hs(6)]);
    }
  }
  list.sort((a, b) => b[0] - a[0]);
  const lite = pal.night > 0.8 ? [70, 84, 120] : pal === PAL[1] ? [255, 190, 160] : [255, 255, 255];
  const dark = pal.night > 0.8 ? [40, 50, 80] : pal === PAL[1] ? [160, 110, 120] : [176, 190, 212];
  const A = pal.night > 0.8 ? 0.5 : 0.92;
  let fog = 0;
  for (const c of list) {
    if (!toScreen(c[1], c[2], c[3], SP)) continue;
    const R = F * c[4] / SP.f;
    if (SP.x < -R * 2 || SP.x > W + R * 2 || SP.y < -R || SP.y > H + R) continue;
    const fadeFar = clamp((38000 - c[0]) / 12000, 0, 1);
    ctx.globalAlpha = A * fadeFar;
    ctx.fillStyle = rgb(dark);
    ctx.beginPath(); ctx.ellipse(SP.x, SP.y + R * 0.12, R * 1.05, R * 0.34, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = rgb(lite);
    const sc = [[0, 0, 1, 0.38], [-0.55, -0.1, 0.62, 0.3], [0.55, -0.08, 0.66, 0.3], [-0.2, -0.22, 0.6, 0.34], [0.25, -0.26, 0.5, 0.3]];
    for (const s of sc) { ctx.beginPath(); ctx.ellipse(SP.x + s[0] * R, SP.y + s[1] * R, R * s[2], R * s[3], 0, 0, 6.3); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (Math.abs(c[2] - camY) < c[4] * 0.35 && c[0] < c[4] * 1.1) fog = Math.max(fog, 0.75);
  }
  return fog;
}

// ---- HUD ----
const GREEN = '#8dffb4', CYAN = '#5fd4ff', AMBER = '#ffc247', RED = '#ff5a4d', WHITE = '#e6f0ff';
function txt(s, x, y, col, size, align = 'left', weight = '700') {
  ctx.font = `${weight} ${size}px system-ui,Roboto,sans-serif`;
  ctx.fillStyle = col; ctx.textAlign = align; ctx.fillText(s, x, y);
}
function panel(x, y, w, h, a = 0.45, r = 6) {
  ctx.fillStyle = `rgba(6,12,26,${a})`;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r * U) : ctx.rect(x, y, w, h); ctx.fill();
}
function drawTape(x, side, valuePx, ppu, minor, major, value, fmt, bugs) {
  const h = H * 0.5, y0 = CY - h / 2 + H * 0.02;
  const cyT = CY + H * 0.02;
  const w = 50 * U;
  const xl = side < 0 ? x - w : x, xr = side < 0 ? x : x + w;
  panel(xl, y0, w, h, 0.38);
  ctx.save(); ctx.beginPath(); ctx.rect(xl, y0, w, h); ctx.clip();
  const span = h / 2 / ppu;
  const v0 = Math.floor((value - span) / minor) * minor;
  ctx.strokeStyle = 'rgba(220,255,235,.85)'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let v = v0; v <= value + span + minor; v += minor) {
    const y = cyT - (v - value) * ppu;
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    const len = isMajor ? 12 * U : 6 * U;
    if (side < 0) { ctx.moveTo(xr, y); ctx.lineTo(xr - len, y); } else { ctx.moveTo(xl, y); ctx.lineTo(xl + len, y); }
    if (isMajor && v >= 0) {
      ctx.save(); ctx.restore();
    }
  }
  ctx.stroke();
  for (let v = v0; v <= value + span + minor; v += minor) {
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    if (!isMajor || v < 0) continue;
    const y = cyT - (v - value) * ppu;
    txt(fmt(v), side < 0 ? xr - 15 * U : xl + 15 * U, y + 4 * U, 'rgba(230,255,240,.9)', 10 * U, side < 0 ? 'right' : 'left', '600');
  }
  for (const b of bugs) {
    let y = cyT - (b.v - value) * ppu;
    const off = y < y0 + 6 || y > y0 + h - 6;
    y = clamp(y, y0 + 8, y0 + h - 8);
    ctx.fillStyle = b.col;
    ctx.beginPath();
    if (side < 0) { ctx.moveTo(xr, y); ctx.lineTo(xr - 11 * U, y - 6 * U); ctx.lineTo(xr - 11 * U, y + 6 * U); }
    else { ctx.moveTo(xl, y); ctx.lineTo(xl + 11 * U, y - 6 * U); ctx.lineTo(xl + 11 * U, y + 6 * U); }
    ctx.closePath(); ctx.fill();
    if (b.label && !b.hideLabel) txt(b.label, side < 0 ? xl + 4 * U : xr - 4 * U, y + 3 * U, b.col, 9 * U, side < 0 ? 'left' : 'right');
  }
  ctx.restore();
  // окошко текущего значения
  const bw = w + 8 * U, bh = 22 * U;
  const bx = side < 0 ? xl - 8 * U : xl, by = cyT - bh / 2;
  ctx.fillStyle = 'rgba(2,8,18,.92)'; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
  txt(fmt(value, true), bx + bw / 2, by + bh / 2 + 5.5 * U, GREEN, 15 * U, 'center', '800');
}

export function drawFlight(c, w, h, f, t, view) {
  ctx = c; W = w; H = h;
  U = Math.max(0.75, Math.min(H / 380, W / 720));
  F = H * 1.15; CX = W / 2; CY = H * 0.46;
  const pal = PAL[f.tod];
  const chase = view.cam === 'chase';
  camX = f.x; camY = f.h + 5.5; camZ = f.yPos || 0; camPsi = f.psi || 0; yc = Math.cos(camPsi); ys = Math.sin(camPsi);
  let th = f.theta + (view.bump || 0) * 0.002;
  if (chase) {
    // камера сзади-сверху, смотрит на самолёт
    const span = Math.sqrt(f.p.S * f.p.ar), D = span * 1.45, hc = span * 0.3 + 2;
    camX = f.x - D * yc; camZ = (f.yPos || 0) - D * ys; camY = f.h + hc;
    th = -Math.atan((hc - 3) / D) + clamp(f.gamma || 0, -0.3, 0.3) * 0.25 + (view.bump || 0) * 0.001;
  }
  ct = Math.cos(th); st = Math.sin(th);
  const hz = f.h > 1 ? Math.sqrt(2 * Math.max(f.h, 0) / 6371000) : 0;
  const hy = CY + F * Math.tan(th + hz);
  const hi = clamp(f.h / 12000, 0, 1);

  // микрокрен и тряска
  const turb = view.turb;
  const roll = (0.006 * Math.sin(t * 0.6) + 0.004 * Math.sin(t * 1.7 + 1)) * (1 + turb * 2) + (view.rollKick || 0) - (chase ? 0 : (f.phi || 0));
  let shy = 0;
  if (f.onGround && f.v > 3) shy = Math.sin(t * 38) * Math.min(1, f.v / 60) * 0.9 * U + (view.bump || 0) * 0.15;
  else shy = (view.bump || 0) * 0.15;
  c.save();
  c.translate(CX, CY + shy); c.rotate(roll); c.translate(-CX, -CY);

  drawSky(pal, hy, hi, { theta: th });
  drawMountains(pal, hy);
  drawTerrain(pal, hy, f);
  // прочие аэродромы (запасные и соседние)
  for (let i = 0; i < f.world.length; i++) {
    const a = f.world[i];
    if (a.id === f.toAp.id || (a.id === f.fromAp.id && f.rwy0.s > -1e6)) continue;
    const lx = apLocal[2 * i], lz = apLocal[2 * i + 1];
    if (lx > camX + 16000 || lx < camX - 6000 || Math.abs(lz - camZ) > 16000) continue;
    const sz = camZ; camZ -= lz; drawAirport(pal, lx - a.len / 2, a.len, a.ap, false, f); camZ = sz;
  }
  drawAirport(pal, f.rwy0.s, f.rwy0.e - f.rwy0.s, f.fromAp, false, f);
  drawAirport(pal, f.rwy1.s, f.rwy1.e - f.rwy1.s, f.toAp, true, f);
  drawHaze(pal, hy);
  drawLights(pal, f.rwy0.s, f.rwy0.e - f.rwy0.s, false);
  drawLights(pal, f.rwy1.s, f.rwy1.e - f.rwy1.s, true);
  if (pal.night > 0.3) for (let i = 0; i < f.world.length; i++) {
    const a = f.world[i];
    if (a.id === f.toAp.id || a.id === f.fromAp.id) continue;
    const lx = apLocal[2 * i], lz = apLocal[2 * i + 1];
    if (lx > camX + 16000 || lx < camX - 6000 || Math.abs(lz - camZ) > 16000) continue;
    const sz = camZ; camZ -= lz; drawLights(pal, lx - a.len / 2, a.len, false); camZ = sz;
  }
  let fog = 0;
  if (view.warp <= 4) fog = drawClouds(pal, f);
  if (chase) drawAircraft(f, pal, t);
  c.restore();
  drawGuide(f);
  if (fog > 0) { c.fillStyle = `rgba(235,240,248,${fog * 0.8})`; c.fillRect(0, 0, W, H); }

  // кабина: стойки и козырёк
  if (!chase) drawCockpit(pal);
  drawHUD(f, t, view, th);
}

function drawCockpit(pal) {
  const nightK = pal.night;
  // козырёк и потолок
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.075);
  top.addColorStop(0, 'rgba(8,10,14,.95)'); top.addColorStop(1, 'rgba(8,10,14,0)');
  ctx.fillStyle = top; ctx.fillRect(0, 0, W, H * 0.075);
  // передний обзор: левая и правая стойки, средняя стойка
  ctx.fillStyle = 'rgba(10,13,18,.97)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.05, 0); ctx.lineTo(W * 0.022, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W * 0.95, 0); ctx.lineTo(W * 0.978, H); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(10,13,18,.92)';
  ctx.fillRect(W * 0.5 - 3 * U, 0, 6 * U, H * 0.085);
  // блики на стойках
  ctx.strokeStyle = 'rgba(120,140,170,.25)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(W * 0.05, 0); ctx.lineTo(W * 0.022, H); ctx.moveTo(W * 0.95, 0); ctx.lineTo(W * 0.978, H); ctx.stroke();
  // приборная доска (глярешилд) снизу
  const dy = H * 0.885;
  const dash = ctx.createLinearGradient(0, dy, 0, H);
  dash.addColorStop(0, '#171c26'); dash.addColorStop(0.12, '#0c1017'); dash.addColorStop(1, '#06080c');
  ctx.fillStyle = dash;
  ctx.beginPath(); ctx.moveTo(0, H * 0.93); ctx.quadraticCurveTo(W * 0.5, dy - H * 0.03, W, H * 0.93); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(150,170,200,.35)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, H * 0.93); ctx.quadraticCurveTo(W * 0.5, dy - H * 0.03, W, H * 0.93); ctx.stroke();
  // индикаторные лампочки на панели
  const cols = ['#3ddc84', '#ffc247', '#5fd4ff', '#ff5a4d'];
  for (let i = 0; i < 10; i++) { const x = W * (0.3 + i * 0.045); ctx.fillStyle = cols[i % 4]; ctx.globalAlpha = 0.35 + 0.35 * nightK; ctx.beginPath(); ctx.arc(x, H * 0.905 + Math.abs(i - 4.5) * 0.6 * U, 1.6 * U, 0, 6.3); ctx.fill(); }
  ctx.globalAlpha = 1;
  // лёгкое отражение стекла
  const gl = ctx.createLinearGradient(0, 0, W * 0.5, H * 0.6);
  gl.addColorStop(0, 'rgba(255,255,255,.05)'); gl.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
}

const FLN = ['0', '1', '2', '3', 'ПОЛН'];
function drawHUD(f, t, view, th) {
  const c = f.c, chase = view.cam === 'chase';
  const kmh = f.ias * 3.6;
  if (!chase) {
  // шкала тангажа (вращается вместе с горизонтом)
  ctx.save(); ctx.translate(CX, CY); ctx.rotate(-(f.phi || 0)); ctx.translate(-CX, -CY);
  ctx.save();
  ctx.strokeStyle = 'rgba(160,255,200,.8)'; ctx.lineWidth = 1.3; ctx.fillStyle = 'rgba(160,255,200,.9)';
  ctx.beginPath(); ctx.rect(0, H * 0.14, W, H * 0.64); ctx.clip();
  for (let p = -20; p <= 30; p += 5) {
    if (p === 0) continue;
    const y = CY + F * Math.tan(th - p * DEG);
    if (y < H * 0.15 || y > H * 0.77) continue;
    const half = (p % 10 === 0 ? 34 : 20) * U;
    ctx.beginPath();
    if (p > 0) { ctx.moveTo(CX - half, y); ctx.lineTo(CX - half * 0.35, y); ctx.moveTo(CX + half * 0.35, y); ctx.lineTo(CX + half, y); }
    else { for (let s = -1; s <= 1; s += 2) { ctx.moveTo(CX + s * half * 0.35, y); ctx.lineTo(CX + s * half, y); } }
    ctx.stroke();
    if (p % 10 === 0) { txt(String(Math.abs(p)), CX - half - 5 * U, y + 3.5 * U, GREEN, 9 * U, 'right', '600'); txt(String(Math.abs(p)), CX + half + 5 * U, y + 3.5 * U, GREEN, 9 * U, 'left', '600'); }
  }
  ctx.restore();
  // вектор пути
  if (!f.onGround || f.v > 8) {
    const gy = CY + F * Math.tan(th - f.gamma);
    ctx.strokeStyle = GREEN; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, gy, 7 * U, 0, 6.3);
    ctx.moveTo(CX - 7 * U, gy); ctx.lineTo(CX - 17 * U, gy); ctx.moveTo(CX + 7 * U, gy); ctx.lineTo(CX + 17 * U, gy); ctx.moveTo(CX, gy - 7 * U); ctx.lineTo(CX, gy - 13 * U);
    ctx.stroke();
  }
  ctx.restore();
  // шкала крена
  { const R = H * 0.27, ph = f.phi || 0;
    ctx.strokeStyle = 'rgba(160,255,200,.8)'; ctx.lineWidth = 1.4; ctx.beginPath();
    for (const a of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) { const r = a * DEG, l = (a % 30 === 0 ? 9 : 5) * U; ctx.moveTo(CX + Math.sin(r) * R, CY - Math.cos(r) * R); ctx.lineTo(CX + Math.sin(r) * (R + l), CY - Math.cos(r) * (R + l)); }
    ctx.stroke();
    const pr = -ph; ctx.fillStyle = Math.abs(ph) > 30 * DEG ? RED : GREEN; ctx.beginPath();
    ctx.moveTo(CX + Math.sin(pr) * (R - 2 * U), CY - Math.cos(pr) * (R - 2 * U));
    ctx.lineTo(CX + Math.sin(pr - 0.06) * (R - 11 * U), CY - Math.cos(pr - 0.06) * (R - 11 * U));
    ctx.lineTo(CX + Math.sin(pr + 0.06) * (R - 11 * U), CY - Math.cos(pr + 0.06) * (R - 11 * U)); ctx.closePath(); ctx.fill(); }
  // ось самолёта
  ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(CX - 10 * U, CY); ctx.lineTo(CX - 3 * U, CY); ctx.moveTo(CX + 10 * U, CY); ctx.lineTo(CX + 3 * U, CY); ctx.moveTo(CX, CY - 3 * U); ctx.lineTo(CX, CY + 3 * U); ctx.stroke();

  }
  // лента скорости
  const vbugs = [];
  const tgt = f.atTargetIAS() * 3.6;
  if (c.atOn) vbugs.push({ v: tgt, col: CYAN, label: '' });
  const vsNow = stallIAS(f.mass, f.flapIdx, f.p.S) * 3.6;
  vbugs.push({ v: vsNow, col: RED, label: 'Vs' });
  if (f.onGround && !f.td) vbugs.push({ v: f.vr * 3.6, col: AMBER, label: 'VR' });
  const sx = W * 0.215;
  drawTape(sx, -1, 0, 1.25 * U, 10, 20, kmh, (v, big) => String(Math.round(v)), vbugs);
  txt('км/ч', sx - 25 * U, CY + H * 0.02 - H * 0.25 - 4 * U, 'rgba(230,255,240,.7)', 9 * U, 'center', '600');
  txt('M ' + f.mach.toFixed(2).replace(/^0/, ''), sx - 25 * U, CY + H * 0.02 + H * 0.25 + 12 * U, WHITE, 10 * U, 'center');
  // лента высоты
  const abugs = [];
  if (c.apOn && !f.apprCap) abugs.push({ v: c.apAlt, col: CYAN, label: '' });
  const ax = W * 0.785;
  drawTape(ax, 1, 0, 0.30 * U, 20, 100, f.h, (v, big) => big ? String(Math.round(f.h)) : String(Math.round(v)), abugs);
  txt('м', ax + 25 * U, CY + H * 0.02 - H * 0.25 - 4 * U, 'rgba(230,255,240,.7)', 9 * U, 'center', '600');
  // цель АП и вертикальная скорость
  const vs = f.vs;
  txt((vs >= 0 ? '+' : '−') + Math.abs(vs).toFixed(1) + ' м/с', ax + 25 * U, CY + H * 0.02 - H * 0.25 - 17 * U, f.warnings.has('sink') ? RED : WHITE, 10 * U, 'center');
  if (c.apOn && !f.apprCap) txt('▸' + Math.round(c.apAlt), ax + 55 * U, CY + H * 0.02 - 8 * U, CYAN, 10 * U, 'left');
  if (f.h < 250) {
    const rc = f.h < 30 ? AMBER : WHITE;
    txt('РВ ' + Math.max(0, Math.round(f.h)), CX, CY + H * 0.3, rc, (f.h < 30 ? 18 : 13) * U, 'center', '800');
  }
  // глиссада
  if (!f.onGround && f.dist < 52000 && f.dist > 150 && f.h < 3500) {
    const dd = f.D + AIM_OFFSET - f.x;
    const ang = Math.atan2(f.h, dd) / DEG;
    const dev = clamp((ang - GS_DEG) / 0.7, -2.4, 2.4);
    const gx = W * 0.665, gy0 = CY + H * 0.02, step = 17 * U;
    panel(gx - 9 * U, gy0 - 2.6 * step, 18 * U, 5.2 * step, 0.38);
    ctx.fillStyle = 'rgba(230,255,240,.85)';
    for (let i = -2; i <= 2; i++) { if (i === 0) { ctx.fillRect(gx - 7 * U, gy0 - 1, 14 * U, 2); } else { ctx.beginPath(); ctx.arc(gx, gy0 + i * step, 2.6 * U, 0, 6.3); ctx.fill(); } }
    const dy = gy0 + dev * step;
    ctx.fillStyle = Math.abs(dev) < 0.5 ? GREEN : AMBER;
    ctx.beginPath(); ctx.moveTo(gx, dy - 8 * U); ctx.lineTo(gx + 7 * U, dy); ctx.lineTo(gx, dy + 8 * U); ctx.lineTo(gx - 7 * U, dy); ctx.closePath(); ctx.fill();
    txt('ГЛС', gx, gy0 - 2.6 * step - 5 * U, CYAN, 9 * U, 'center');
    // курсовой маяк (боковое отклонение от оси полосы)
    const ly = gy0 + 2.6 * step + 12 * U;
    const lat = Math.atan2(f.yPos || 0, Math.max(dd, 300)) / DEG;
    const ld = clamp(-lat / 0.9, -2.4, 2.4);
    panel(gx - 2.6 * step, ly - 9 * U, 5.2 * step, 18 * U, 0.38);
    ctx.fillStyle = 'rgba(230,255,240,.85)';
    for (let i = -2; i <= 2; i++) { if (i === 0) ctx.fillRect(gx - 1, ly - 7 * U, 2, 14 * U); else { ctx.beginPath(); ctx.arc(gx + i * step, ly, 2.6 * U, 0, 6.3); ctx.fill(); } }
    ctx.fillStyle = Math.abs(ld) < 0.5 ? GREEN : AMBER;
    const lx = gx + ld * step; ctx.beginPath(); ctx.moveTo(lx, ly - 8 * U); ctx.lineTo(lx + 7 * U, ly); ctx.lineTo(lx, ly + 8 * U); ctx.lineTo(lx - 7 * U, ly); ctx.closePath(); ctx.fill();
    txt('КУРС', gx - 2.6 * step - 4 * U, ly + 3 * U, CYAN, 8 * U, 'right');
  }
  // верхняя панель
  const tw = Math.min(W * 0.52, 430 * U), tx = CX - tw / 2, ty = 6 * U, thh = 26 * U;
  panel(tx, ty, tw, thh, 0.5);
  const distKm = Math.max(0, f.dist / 1000);
  const eta = f.v > 30 && f.dist > 0 ? f.dist / Math.max(f.v, 60) / 60 : 0;
  txt(f.fromAp.id + ' → ' + f.toAp.id, tx + 10 * U, ty + 17 * U, WHITE, 12 * U);
  txt(distKm >= 10 ? Math.round(distKm) + ' км' : distKm.toFixed(1) + ' км', CX, ty + 17 * U, GREEN, 13 * U, 'center', '800');
  txt('⏱' + (eta >= 60 ? Math.floor(eta / 60) + ' ч ' + Math.round(eta % 60) + ' мин' : Math.round(eta) + ' мин'), tx + tw - 10 * U, ty + 17 * U, WHITE, 11 * U, 'right', '600');
  // топливо и режимы
  const fy = ty + thh + 4 * U;
  txt('Топливо ' + Math.round(f.fuel).toLocaleString('ru-RU') + ' кг', 14 * U + W * 0.045, 22 * U, f.warnings.has('lowfuel') ? RED : 'rgba(230,240,255,.9)', 11 * U, 'left', '600');
  txt('Масса ' + Math.round(f.mass / 100) / 10 + ' т', 14 * U + W * 0.045, 36 * U, 'rgba(230,240,255,.7)', 10 * U, 'left', '600');
  { const hd = Math.round(f.heading !== undefined ? f.heading : 0) % 360; txt('Курс ' + String(hd).padStart(3, '0') + '°', 14 * U + W * 0.045, 50 * U, CYAN, 11 * U, 'left', '700'); }
  const modes = [['А/П', c.apOn], ['НАВ', c.apOn && c.nav], ['А/Т', c.atOn], ['ГЛС', f.apprCap]];
  let mx = W - 14 * U - W * 0.045;
  for (let i = modes.length - 1; i >= 0; i--) { txt(modes[i][0], mx, 22 * U, modes[i][1] ? GREEN : 'rgba(200,210,230,.4)', 11 * U, 'right', '800'); mx -= 36 * U; }
  const warpTxt = view.warp > 1 ? '×' + view.warp : '';
  if (warpTxt) txt('УСКОРЕНИЕ ' + warpTxt, W - 14 * U - W * 0.045, 36 * U, AMBER, 10 * U, 'right', '800');
  // состояние двигателей
  if (f.eng[0] < 1 || f.eng[1] < 1) {
    const col = i => f.eng[i] > 0.99 ? GREEN : f.eng[i] > 0.01 ? AMBER : RED;
    txt('ДВ1', 14 * U + W * 0.045, 64 * U, col(0), 10 * U, 'left', '800');
    txt('ДВ2', 14 * U + W * 0.045 + 34 * U, 64 * U, col(1), 10 * U, 'left', '800');
  }
  if (f.hyd) txt('ЗАКР: заклинило ' + FLN[f.c.flaps], 14 * U + W * 0.045, 78 * U, AMBER, 10 * U, 'left', '700');
  // аварийные сообщения (ЧП)
  if (f.alerts.size && !f.done) {
    const al = [...f.alerts].slice(0, 3), flash = Math.floor(t * 2.5) % 2 === 0;
    for (let i = 0; i < al.length; i++) {
      const w2 = ctx.measureText(al[i]).width;
      ctx.font = `800 ${15 * U}px system-ui,sans-serif`;
      const bw = ctx.measureText(al[i]).width + 22 * U;
      ctx.fillStyle = flash ? 'rgba(200,20,20,.88)' : 'rgba(90,10,10,.8)';
      ctx.fillRect(CX - bw / 2, H * 0.16 + i * 26 * U, bw, 22 * U);
      txt(al[i], CX, H * 0.16 + i * 26 * U + 16 * U, '#fff', 15 * U, 'center', '800');
    }
  }
  // предупреждения
  const ws = f.warnings; let wl = [];
  if (ws.has('pullup')) wl.push(['ВЫТЯГИВАЙТЕ!', RED]);
  else if (ws.has('gear')) wl.push(['ВЫПУСТИТЕ ШАССИ!', RED]);
  else if (ws.has('sink')) wl.push(['СЛИШКОМ БЫСТРО СНИЖАЕМСЯ', RED]);
  if (ws.has('terrain')) wl.push(['ЗЕМЛЯ ВПЕРЕДИ! НАБЕРИТЕ ВЫСОТУ', RED]);
  if (ws.has('stall')) wl.push(['МАЛАЯ СКОРОСТЬ!', RED]);
  if (ws.has('over')) wl.push(['ПРЕВЫШЕНИЕ СКОРОСТИ', AMBER]);
  if (ws.has('flaps') && !ws.has('gear')) wl.push(['ЗАКРЫЛКИ!', AMBER]);
  if (ws.has('fuel0')) wl.push(['ТОПЛИВО ЗАКОНЧИЛОСЬ', RED]);
  else if (ws.has('lowfuel')) wl.push(['МАЛО ТОПЛИВА', AMBER]);
  if (wl.length && Math.floor(t * 3) % 2 === 0) {
    ctx.font = `800 ${17 * U}px system-ui,sans-serif`;
    for (let i = 0; i < Math.min(2, wl.length); i++) txt(wl[i][0], CX, H * 0.24 + i * 22 * U, wl[i][1], 17 * U, 'center', '800');
  }
}

// ---- метка маршрута руления ----
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function drawGuide(f) {
  const g = f.guide;
  if (!g || !f.onGround || f.done) return;
  const label = (g.label ? g.label + '  ' : '') + Math.round(g.dist) + ' м';
  const ok = toScreen(g.x, 14, g.z, SP) && SP.x > 30 && SP.x < W - 30 && SP.y > 40 && SP.y < H - 40;
  ctx.save();
  if (ok) {
    const s = clamp(F * 3.2 / SP.f, 6 * U, 13 * U), x = SP.x, y = SP.y;
    ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x - s * 0.8, y - s * 0.5); ctx.lineTo(x + s * 0.8, y - s * 0.5); ctx.closePath(); ctx.stroke(); ctx.fill();
    const w = ctx.measureText(label).width;
    ctx.font = `700 ${11 * U}px system-ui,sans-serif`;
    const tw = ctx.measureText(label).width + 12 * U;
    ctx.fillStyle = 'rgba(6,12,26,.7)'; ctx.fillRect(x - tw / 2, y - s * 0.5 - 20 * U, tw, 17 * U);
    txt(label, x, y - s * 0.5 - 7 * U, '#ffd24a', 11 * U, 'center', '700');
  } else {
    const ang = wrapA(Math.atan2(g.z - camZ, g.x - camX) - camPsi);
    const right = ang > 0, x = right ? W - 70 * U : 70 * U, y = CY;
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath(); if (right) { ctx.moveTo(x + 14 * U, y); ctx.lineTo(x - 6 * U, y - 12 * U); ctx.lineTo(x - 6 * U, y + 12 * U); } else { ctx.moveTo(x - 14 * U, y); ctx.lineTo(x + 6 * U, y - 12 * U); ctx.lineTo(x + 6 * U, y + 12 * U); }
    ctx.closePath(); ctx.fill();
    txt(label, x, y + 28 * U, '#ffd24a', 11 * U, 'center', '700');
  }
  ctx.restore();
}

// ---- модель самолёта для вида от третьего лица ----
const modelCache = {};
function buildModel(p) {
  const span = Math.sqrt(p.S * p.ar), L = span * (p.seats >= 300 ? 1.12 : 1.07), r = L * 0.052;
  const gh = r + 1.5;
  const faces = [];
  const add = (pts, col, kind) => faces.push({ pts, col, kind: kind || '' });
  const st = [[0.5, 0.10, 0.0], [0.46, 0.60, -0.05], [0.40, 0.90, -0.02], [0.30, 1, 0], [-0.16, 1, 0], [-0.33, 0.72, 0.28], [-0.5, 0.16, 0.5]];
  const rings = st.map(([xf, k, dy]) => { const rr = r * k, cy = dy * r, ring = []; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; ring.push([xf * L, cy + rr * Math.sin(a), rr * Math.cos(a)]); } return ring; });
  for (let q = 0; q < rings.length - 1; q++) for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    let col = i < 4 ? '#eef2f8' : '#aeb7c8';
    if (q <= 1 && (i === 1 || i === 2)) col = '#1c2433';
    else if ((q === 2 || q === 3) && (i === 0 || i === 3)) col = p.color;
    add([rings[q][i], rings[q][j], rings[q + 1][j], rings[q + 1][i]], col);
  }
  const half = span / 2, wy = -0.5 * r;
  for (const sg of [-1, 1]) {
    const le = 0.06 * L - 0.5 * half, te = le - 0.07 * L;
    add([[0.06 * L, wy, sg * r * 0.9], [-0.14 * L, wy, sg * r * 0.9], [te, wy + 0.07 * half, sg * half], [le, wy + 0.07 * half, sg * half]], '#d3d9e6', 'wing');
    add([[-0.40 * L, 0.2 * r, sg * r * 0.4], [-0.49 * L, 0.25 * r, sg * r * 0.4], [-0.50 * L, 0.3 * r, sg * half * 0.36], [-0.45 * L, 0.3 * r, sg * half * 0.36]], '#cfd5e2', 'wing');
    // двигатель
    const ez = sg * span * 0.17, re = L * 0.031, ey = wy - re * 1.1, ex1 = 0.1 * L, ex0 = -0.02 * L;
    const er = [], er0 = [];
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; er.push([ex1, ey + re * Math.sin(a), ez + re * Math.cos(a)]); er0.push([ex0, ey + re * 0.9 * Math.sin(a), ez + re * 0.9 * Math.cos(a)]); }
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; add([er[i], er[j], er0[j], er0[i]], i < 3 ? '#c4ccdb' : '#8e98ab'); }
    add(er, '#12161e', 'eng');
    // ножки шасси и колёса
    const mz = sg * span * 0.11, mx = -0.05 * L, wh = 1.15;
    add([[mx - 0.12, -gh + wh, mz], [mx + 0.12, -gh + wh, mz], [mx + 0.12, wy, mz], [mx - 0.12, wy, mz]], '#2b323f', 'gear');
    add([[mx - 0.65, -gh, mz], [mx + 0.65, -gh, mz], [mx + 0.65, -gh + wh, mz], [mx - 0.65, -gh + wh, mz]], '#0f1218', 'gear');
  }
  add([[-0.38 * L, 0.7 * r, 0], [-0.5 * L, 0.7 * r, 0], [-0.535 * L, 0.7 * r + 0.15 * L, 0], [-0.455 * L, 0.7 * r + 0.15 * L, 0]], p.color, 'fin');
  const nx = 0.33 * L;
  add([[nx - 0.1, -gh + 0.8, 0], [nx + 0.1, -gh + 0.8, 0], [nx + 0.1, -r * 0.8, 0], [nx - 0.1, -r * 0.8, 0]], '#2b323f', 'gear');
  add([[nx - 0.55, -gh, 0], [nx + 0.55, -gh, 0], [nx + 0.55, -gh + 0.8, 0], [nx - 0.55, -gh + 0.8, 0]], '#0f1218', 'gear');
  return { faces, L, r, span, gh, half };
}
const MP = [], MQ = [];
function drawAircraft(f, pal, t) {
  const p = f.p, M = modelCache[p.id] || (modelCache[p.id] = buildModel(p));
  const th = f.theta, ph = f.phi || 0, ps = f.psi || 0;
  const cT = Math.cos(th), sT = Math.sin(th), cP = Math.cos(ph), sP = Math.sin(ph);
  const X0 = f.x, Z0 = f.yPos || 0, Y0 = f.h + M.gh;
  const tr = (x, y, z, out) => {
    const x1 = x * cT - y * sT, y1 = x * sT + y * cT;
    const y2 = y1 * cP - z * sP, z2 = y1 * sP + z * cP;
    out[0] = X0 + x1 * yc - z2 * ys; out[1] = Y0 + y2; out[2] = Z0 + x1 * ys + z2 * yc;
  };
  const gearDown = f.gearPos > 0.5;
  // тень на земле
  const fade = clamp(1 - f.h / 1800, 0, 1);
  if (fade > 0.02) {
    const sh = `rgba(0,0,0,${0.3 * fade * (1 - pal.night * 0.6)})`;
    const gp = (x, z) => { const c1 = Math.cos(ps), s1 = Math.sin(ps); return [X0 + x * c1 - z * s1, 0.07, Z0 + x * s1 + z * c1]; };
    const poly = pts => { for (let i = 0; i < pts.length; i++) { const g = gp(pts[i][0], pts[i][1]); P[3 * i] = g[0]; P[3 * i + 1] = g[1]; P[3 * i + 2] = g[2]; } polyFlat(P, pts.length, sh); };
    poly([[M.L / 2, -M.r * 0.5], [M.L / 2, M.r * 0.5], [-M.L / 2, M.r * 0.4], [-M.L / 2, -M.r * 0.4]]);
    for (const sg of [-1, 1]) {
      const le = 0.06 * M.L - 0.5 * M.half, te = le - 0.07 * M.L;
      poly([[0.06 * M.L, sg * M.r], [-0.14 * M.L, sg * M.r], [te, sg * M.half], [le, sg * M.half]]);
      poly([[-0.40 * M.L, sg * M.r * 0.4], [-0.49 * M.L, sg * M.r * 0.4], [-0.50 * M.L, sg * M.half * 0.36], [-0.45 * M.L, sg * M.half * 0.36]]);
    }
  }
  // грани: преобразование, сортировка по глубине
  const list = [];
  const LX = -0.4, LY = 0.85, LZ = 0.35, ln = Math.hypot(LX, LY, LZ);
  for (const fc of M.faces) {
    if (fc.kind === 'gear' && !gearDown) continue;
    const n = fc.pts.length, w = [];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { const o = [0, 0, 0]; tr(fc.pts[i][0], fc.pts[i][1], fc.pts[i][2], o); w.push(o); cx += o[0]; cy += o[1]; cz += o[2]; }
    cx /= n; cy /= n; cz /= n;
    const dx0 = cx - camX, dz0 = cz - camZ, dy = cy - camY;
    const fw = (dx0 * yc + dz0 * ys) * ct + dy * st;
    // нормаль
    const ux = w[1][0] - w[0][0], uy = w[1][1] - w[0][1], uz = w[1][2] - w[0][2], vx = w[2][0] - w[0][0], vy = w[2][1] - w[0][1], vz = w[2][2] - w[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nx * (camX - cx) + ny * (camY - cy) + nz * (camZ - cz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const dif = Math.max(0, (nx * LX + ny * LY + nz * LZ) / ln);
    let k = 0.5 + 0.55 * dif;
    if (pal.night > 0.3) k *= 1 - 0.45 * pal.night;
    list.push({ w, fw, k: Math.round(k * 20) / 20, col: fc.col });
  }
  list.sort((a, b) => b.fw - a.fw);
  for (const o of list) {
    const n = o.w.length;
    for (let i = 0; i < n; i++) { P[3 * i] = o.w[i][0]; P[3 * i + 1] = o.w[i][1]; P[3 * i + 2] = o.w[i][2]; }
    polyFlat(P, n, shadeCol(o.col, o.k));
  }
  // пожар двигателя: пламя и дым
  if (f.fire && !f.fire.ext) {
    const sg = f.fire.side === 0 ? -1 : 1, o = [0, 0, 0], span = M.span, re = M.L * 0.031, wy = -0.5 * M.r;
    for (let k = 0; k < 7; k++) {
      const back = k * M.L * 0.035 + Math.sin(t * 17 + k) * M.L * 0.01;
      tr(-0.03 * M.L - back, wy - re * 1.1 + Math.sin(t * 23 + k * 2) * re * 0.4, sg * span * 0.17, o);
      if (toScreen(o[0], o[1], o[2], SP)) {
        const r0 = Math.max(3 * U, F * re * (1.6 - k * 0.12) / SP.f);
        const g = ctx.createRadialGradient(SP.x, SP.y, 0, SP.x, SP.y, r0);
        g.addColorStop(0, k < 3 ? 'rgba(255,230,120,.95)' : 'rgba(255,120,30,.8)'); g.addColorStop(1, 'rgba(120,20,0,0)');
        ctx.fillStyle = g; ctx.fillRect(SP.x - r0, SP.y - r0, r0 * 2, r0 * 2);
      }
    }
    for (let k = 0; k < 6; k++) {
      tr(-0.25 * M.L - k * M.L * 0.07, wy + k * re * 0.4, sg * span * 0.17, o);
      if (toScreen(o[0], o[1], o[2], SP)) {
        const r0 = Math.max(4 * U, F * re * (2 + k * 0.5) / SP.f);
        const g = ctx.createRadialGradient(SP.x, SP.y, 0, SP.x, SP.y, r0);
        g.addColorStop(0, 'rgba(40,40,40,.5)'); g.addColorStop(1, 'rgba(40,40,40,0)');
        ctx.fillStyle = g; ctx.fillRect(SP.x - r0, SP.y - r0, r0 * 2, r0 * 2);
      }
    }
  }
  // ходовые огни
  if (pal.night > 0.2 || f.h > 10) {
    const o = [0, 0, 0], le = 0.06 * M.L - 0.5 * M.half;
    const lamp = (x, y, z, col, r0) => { tr(x, y, z, o); if (toScreen(o[0], o[1], o[2], SP)) { const g = ctx.createRadialGradient(SP.x, SP.y, 0, SP.x, SP.y, r0 * 3); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(SP.x - r0 * 3, SP.y - r0 * 3, r0 * 6, r0 * 6); } };
    lamp(le, -0.5 * M.r + 0.07 * M.half, -M.half, 'rgba(255,50,40,.95)', 3.2 * U);
    lamp(le, -0.5 * M.r + 0.07 * M.half, M.half, 'rgba(60,255,120,.95)', 3.2 * U);
    if (Math.floor(t * 1.6) % 4 === 0) lamp(-0.5 * M.L, M.r * 0.7, 0, 'rgba(255,255,255,1)', 5 * U);
  }
}

// ---- карта для меню ----
export function drawMap(c, w, h, t, opt) {
  // радар-стиль: сетка, точки аэропортов, маршрут
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#071428'); g.addColorStop(1, '#0d2a4a');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const mx = w * (opt.left ?? 0.03), mw = w * (opt.width ?? 0.62), my = h * (opt.top ?? 0.2), mh = h * (opt.height ?? 0.5);
  const X = lon => mx + (lon + 85) / 240 * mw, Y = lat => my + (74 - lat) / 58 * mh;
  c.strokeStyle = 'rgba(120,170,230,.16)'; c.lineWidth = 1;
  c.beginPath();
  for (let lon = -60; lon <= 150; lon += 30) { c.moveTo(X(lon), my); c.lineTo(X(lon), my + mh); }
  for (let lat = 20; lat <= 70; lat += 10) { c.moveTo(mx, Y(lat)); c.lineTo(mx + mw, Y(lat)); }
  c.stroke();
  // дальность
  const from = AP_BY[opt.from];
  const to = opt.to ? AP_BY[opt.to] : null;
  const sweep = (t / 4000) % 1;
  c.font = '600 10px system-ui,sans-serif';
  for (const a of AIRPORTS) {
    const x = X(a.lon), y = Y(a.lat);
    const act = a === from || a === to;
    c.fillStyle = act ? '#ffd24a' : 'rgba(150,200,255,.75)';
    c.beginPath(); c.arc(x, y, act ? 4.2 : 2.6, 0, 6.3); c.fill();
    c.fillStyle = act ? '#ffe9a0' : 'rgba(170,205,245,.55)';
    c.textAlign = 'left'; c.fillText(a.id, x + 6, y + 3);
  }
  if (from) {
    const x = X(from.lon), y = Y(from.lat), r = 6 + 10 * ((t / 1200) % 1);
    c.strokeStyle = `rgba(255,210,74,${1 - ((t / 1200) % 1)})`; c.lineWidth = 1.5;
    c.beginPath(); c.arc(x, y, r, 0, 6.3); c.stroke();
  }
  if (from && to) {
    const x1 = X(from.lon), y1 = Y(from.lat), x2 = X(to.lon), y2 = Y(to.lat);
    const mxp = (x1 + x2) / 2, myp = Math.min(y1, y2) - Math.hypot(x2 - x1, y2 - y1) * 0.22;
    c.strokeStyle = '#7dffb0'; c.lineWidth = 2; c.setLineDash([6, 5]); c.lineDashOffset = -t / 60;
    c.beginPath(); c.moveTo(x1, y1); c.quadraticCurveTo(mxp, myp, x2, y2); c.stroke(); c.setLineDash([]);
    const k = (t / 3000) % 1, bx = (1 - k) * (1 - k) * x1 + 2 * (1 - k) * k * mxp + k * k * x2, by = (1 - k) * (1 - k) * y1 + 2 * (1 - k) * k * myp + k * k * y2;
    c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by, 3, 0, 6.3); c.fill();
  }
}
