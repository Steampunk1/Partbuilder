// File-only check (no CAD kernel): for every trimming curve (IGES 142) compare the two descriptions
// the file carries - the parameter-space curve B mapped through its NURBS surface, S(B(t)), and the
// model-space curve C. A reader is free to use either; if they disagree the cut edge depends on the reader.
import { readFileSync } from 'node:fs';
import { parseIges, distToPolys } from './_iges.mjs';
const span = (knots, deg, n, u) => { let k = deg; while (k < n - 1 && u >= knots[k + 1]) k++; return k; };
function basis(knots, deg, n, u) {            // non-zero basis functions N[k-deg..k](u)
  const last = knots[n]; if (u >= last) u = last - 1e-12; if (u < knots[deg]) u = knots[deg];
  const k = span(knots, deg, n, u), N = new Array(deg + 1).fill(0), L = [], R = []; N[0] = 1;
  for (let j = 1; j <= deg; j++) { L[j] = u - knots[k + 1 - j]; R[j] = knots[k + j] - u; let s = 0; for (let r = 0; r < j; r++) { const den = R[r + 1] + L[j - r], t = den ? N[r] / den : 0; N[r] = s + R[r + 1] * t; s = L[j - r] * t; } N[j] = s; }
  return { k, N };
}
function curve126(e) {
  const K = e.v[0], M = e.v[1], n = K + 1, A = n + M + 1, knots = e.v.slice(6, 6 + A), w = e.v.slice(6 + A, 6 + A + n), cp = e.v.slice(6 + A + n, 6 + A + 4 * n), v0 = e.v[6 + A + 4 * n], v1 = e.v[7 + A + 4 * n];
  return { v0, v1, at: (u) => { const { k, N } = basis(knots, M, n, u); let x = 0, y = 0, z = 0, ww = 0; for (let j = 0; j <= M; j++) { const i = k - M + j, b = N[j] * w[i]; x += b * cp[3 * i]; y += b * cp[3 * i + 1]; z += b * cp[3 * i + 2]; ww += b; } return [x / ww, y / ww, z / ww]; } };
}
function surf128(e) {
  const K1 = e.v[0], K2 = e.v[1], M1 = e.v[2], M2 = e.v[3], n1 = K1 + 1, n2 = K2 + 1, A = n1 + M1 + 1, B = n2 + M2 + 1; let p = 9;
  const ku = e.v.slice(p, p + A); p += A; const kv = e.v.slice(p, p + B); p += B; const w = e.v.slice(p, p + n1 * n2); p += n1 * n2; const cp = e.v.slice(p, p + 3 * n1 * n2); p += 3 * n1 * n2; const U0 = e.v[p], U1 = e.v[p + 1], V0 = e.v[p + 2], V1 = e.v[p + 3];
  const perU = e.v[7] === 1, perV = e.v[8] === 1, wrap = (x, kn, deg, n) => { const lo = kn[deg], hi = kn[n], T = hi - lo; if (T <= 0) return x; while (x > hi + 1e-9) x -= T; while (x < lo - 1e-9) x += T; return x; };
  return { U0, U1, V0, V1, at: (u, v) => { if (perU) u = wrap(u, ku, M1, n1); if (perV) v = wrap(v, kv, M2, n2); const a = basis(ku, M1, n1, u), b = basis(kv, M2, n2, v); let x = 0, y = 0, z = 0, ww = 0; for (let j = 0; j <= M2; j++) for (let i = 0; i <= M1; i++) { const ii = a.k - M1 + i, jj = b.k - M2 + j, idx = jj * n1 + ii, bb = a.N[i] * b.N[j] * w[idx]; x += bb * cp[3 * idx]; y += bb * cp[3 * idx + 1]; z += bb * cp[3 * idx + 2]; ww += bb; } return [x / ww, y / ww, z / ww]; } };
}
function pts(I, e, n, viaSurf) {
  if (!e) return [];
  if (e.type === 102) { let o = []; for (const de of e.v.slice(1, 1 + e.v[0])) o = o.concat(pts(I, I.ent.get(de), n, viaSurf)); return o; }
  if (e.type === 126) { const c = curve126(e), o = []; for (let s = 0; s <= n; s++) { const q = c.at(c.v0 + (c.v1 - c.v0) * s / n); o.push(viaSurf ? viaSurf.at(q[0], q[1]) : q); } return o; }
  if (e.type === 110) { const [x1, y1, z1, x2, y2, z2] = e.v, o = []; for (let s = 0; s <= n; s++) { const t = s / n, q = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t]; o.push(viaSurf ? viaSurf.at(q[0], q[1]) : q); } return o; }
  return null;
}
export function bVsC(file, n = 200) { return bVsCText(readFileSync(file, 'utf8'), n); }
/** Same check on the text of an IGES file. -> { rows: [{ de, role, pref, worst (inches) ... }], unk } */
export function bVsCText(text, n = 200) {
  const I = parseIges(text); const rows = []; let unk = 0;
  const outer = new Set(), inner = new Set(); for (const e of I.ent.values()) if (e.type === 144) { outer.add(e.v[3]); for (const de of e.v.slice(4, 4 + e.v[2])) inner.add(de); }
  for (const e of I.ent.values()) { if (e.type !== 142) continue;
    const S = I.ent.get(e.v[1]), Bc = I.ent.get(e.v[2]), Cc = I.ent.get(e.v[3]); if (!S || S.type !== 128 || !Bc || !Cc) { unk++; continue; }
    const sf = surf128(S), sb = pts(I, Bc, n, sf), cc = pts(I, Cc, n, null); if (!sb || !cc || !sb.length || !cc.length) { unk++; continue; }
    let w1 = 0, at1 = null; for (const p of sb) { const d = distToPolys(p, [cc]); if (d > w1) { w1 = d; at1 = p; } }
    let w2 = 0; for (const p of cc) { const d = distToPolys(p, [sb]); if (d > w2) w2 = d; }
    const bb = (P) => [0, 1, 2].map(k => [Math.min(...P.map(q => q[k])), Math.max(...P.map(q => q[k]))].map(v => +v.toFixed(3)));
    rows.push({ de: e.de, role: inner.has(e.de) ? 'inner(hole)' : outer.has(e.de) ? 'outer' : '?', pref: e.v[4], worst: Math.max(w1, w2), at: at1 && at1.map(v => +v.toFixed(3)), bboxSB: bb(sb), bboxC: bb(cc) });
  }
  return { rows, unk };
}
