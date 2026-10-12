// Отрисовка: вид из кабины (псевдо-3D), HUD, карта для меню.
import { DEG, GS_TAN, GS_DEG, AIM_OFFSET, FLAP_NAMES, stallIAS, APPR_ALT } from './sim.js';
import { AIRPORTS, AP_BY } from './data.js';

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
  box(bx + 20, bx + len * 0.2, 170, 215, 12, pal.build);
  box(x0 + len * 0.18, x0 + len * 0.18 + 14, 240, 254, 48, pal.build);
  box(x0 + len * 0.18 - 6, x0 + len * 0.18 + 20, 238, 256, 8, ['#556070']);
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
  camX = f.x; camY = f.h + 5.5; camZ = f.yPos || 0; camPsi = f.psi || 0; yc = Math.cos(camPsi); ys = Math.sin(camPsi);
  const th = f.theta + (view.bump || 0) * 0.002;
  ct = Math.cos(th); st = Math.sin(th);
  const hz = f.h > 1 ? Math.sqrt(2 * Math.max(f.h, 0) / 6371000) : 0;
  const hy = CY + F * Math.tan(th + hz);
  const hi = clamp(f.h / 12000, 0, 1);

  // микрокрен и тряска
  const turb = view.turb;
  const roll = (0.006 * Math.sin(t * 0.6) + 0.004 * Math.sin(t * 1.7 + 1)) * (1 + turb * 2) + (view.rollKick || 0) - (f.phi || 0);
  let shy = 0;
  if (f.onGround && f.v > 3) shy = Math.sin(t * 38) * Math.min(1, f.v / 60) * 0.9 * U + (view.bump || 0) * 0.15;
  else shy = (view.bump || 0) * 0.15;
  c.save();
  c.translate(CX, CY + shy); c.rotate(roll); c.translate(-CX, -CY);

  drawSky(pal, hy, hi, { theta: th });
  drawMountains(pal, hy);
  drawGround(pal, hy, f);
  drawAirport(pal, f.rwy0.s, f.rwy0.e - f.rwy0.s, f.fromAp, false, f);
  drawAirport(pal, f.rwy1.s, f.rwy1.e - f.rwy1.s, f.toAp, true, f);
  drawHaze(pal, hy);
  drawLights(pal, f.rwy0.s, f.rwy0.e - f.rwy0.s, false);
  drawLights(pal, f.rwy1.s, f.rwy1.e - f.rwy1.s, true);
  let fog = 0;
  if (view.warp <= 4) fog = drawClouds(pal, f);
  c.restore();
  if (fog > 0) { c.fillStyle = `rgba(235,240,248,${fog * 0.8})`; c.fillRect(0, 0, W, H); }

  // кабина: стойки и козырёк
  drawCockpit(pal);
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

function drawHUD(f, t, view, th) {
  const c = f.c;
  const kmh = f.ias * 3.6;
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
  // предупреждения
  const ws = f.warnings; let wl = [];
  if (ws.has('pullup')) wl.push(['ВЫТЯГИВАЙТЕ!', RED]);
  else if (ws.has('gear')) wl.push(['ВЫПУСТИТЕ ШАССИ!', RED]);
  else if (ws.has('sink')) wl.push(['СЛИШКОМ БЫСТРО СНИЖАЕМСЯ', RED]);
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
