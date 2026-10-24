// Мини-распаковщик deflate (RFC 1951) — синхронный, одинаково работает в браузере и в node.
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
function mkTree(lens, n) {
  const count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(n);
  for (let i = 0; i < n; i++) count[lens[i]]++;
  count[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for (let i = 0; i < n; i++) if (lens[i]) sym[offs[lens[i]]++] = i;
  return { count, sym };
}
export function inflateRaw(src, outLen) {
  const out = new Uint8Array(outLen);
  let sp = 0, bit = 0, nb = 0, op = 0;
  const getb = n => { while (nb < n) { bit |= src[sp++] << nb; nb += 8; } const v = bit & ((1 << n) - 1); bit >>>= n; nb -= n; return v; };
  const dec = t => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= getb(1);
      const c = t.count[len];
      if (code - c < first) return t.sym[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  // фиксированные деревья
  const fl = new Uint8Array(288); for (let i = 0; i < 288; i++) fl[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
  const fixL = mkTree(fl, 288), fd = new Uint8Array(30).fill(5), fixD = mkTree(fd, 30);
  let last;
  do {
    last = getb(1); const type = getb(2);
    if (type === 0) {
      bit = 0; nb = 0; const len = src[sp] | (src[sp + 1] << 8); sp += 4;
      for (let i = 0; i < len; i++) out[op++] = src[sp++];
    } else {
      let lt, dt;
      if (type === 1) { lt = fixL; dt = fixD; }
      else {
        const hlit = getb(5) + 257, hdist = getb(5) + 1, hclen = getb(4) + 4;
        const cl = new Uint8Array(19); for (let i = 0; i < hclen; i++) cl[CLORD[i]] = getb(3);
        const ct = mkTree(cl, 19), lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const s = dec(ct);
          if (s < 16) lens[i++] = s;
          else { let prev = 0, rep; if (s === 16) { prev = lens[i - 1]; rep = 3 + getb(2); } else if (s === 17) rep = 3 + getb(3); else rep = 11 + getb(7); while (rep--) lens[i++] = prev; }
        }
        lt = mkTree(lens.subarray(0, hlit), hlit); dt = mkTree(lens.subarray(hlit), hdist);
      }
      for (;;) {
        const s = dec(lt);
        if (s < 256) out[op++] = s;
        else if (s === 256) break;
        else {
          const si = s - 257, len = LBASE[si] + getb(LEXT[si]), ds = dec(dt), dist = DBASE[ds] + getb(DEXT[ds]);
          for (let i = 0; i < len; i++) { out[op] = out[op - dist]; op++; }
        }
      }
    }
  } while (!last);
  return out;
}
