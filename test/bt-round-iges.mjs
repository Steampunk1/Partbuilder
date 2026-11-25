// Independent IGES evaluation for the round-part back-test (no CAD kernel, no app code).
// Reads the file the app exports and evaluates, with its own NURBS code:
//   - the global section (units)
//   - every trimmed surface (144): its surface (128 rational B-spline) and each trim loop (142) as BOTH
//     descriptions the file carries: the model-space curve C and the parameter-space curve B pushed
//     through the surface, S(B(t)).  A reader may use either one, so both must describe the same edge.
export function parseIges(text) {
  const lines = text.split(/\r?\n/);
  const D = lines.filter(l => l[72] === 'D'), P = lines.filter(l => l[72] === 'P');
  const dir = new Map();
  for (let i = 0; i + 1 < D.length; i += 2) { const seq = parseInt(D[i].slice(73), 10); dir.set(seq, { type: parseInt(D[i].slice(0, 8), 10), xform: parseInt(D[i].slice(48, 56), 10) || 0 }); }
  const par = new Map();
  for (const l of P) { const de = parseInt(l.slice(64, 72), 10); par.set(de, (par.get(de) || '') + l.slice(0, 64)); }
  const ent = new Map();
  for (const [de, s] of par) { const a = s.split(';')[0].split(',').map(x => x.trim()); ent.set(de, Object.assign({ de, raw: a.slice(1), v: a.slice(1).map(x => parseFloat(x.replace(/D/i, 'E'))) }, dir.get(de) || { type: +a[0], xform: 0 })); }
  return { ent, globalText: lines.filter(l => l[72] === 'G').map(l => l.slice(0, 72)).join(''), nP: P.length, pText: P.map(l => l.slice(0, 64)).join('\n') };
}
/** Global section -> array of parameters (Hollerith strings decoded), 1-based index like the IGES spec. */
export function igesGlobal(text) {
  const g = text.split(/\r?\n/).filter(l => l[72] === 'G').map(l => l.slice(0, 72)).join('');
  const out = [null]; let i = 0, pd = ',', rd = ';';
  const first = g.match(/^1H(.)/); if (first) { pd = first[1]; }
  while (i < g.length) {
    const m = g.slice(i).match(/^\s*(\d+)H/);
    if (m) { const n = +m[1], st = i + m[0].length; out.push(g.slice(st, st + n)); i = st + n; if (g[i] === rd) break; i++; continue; }
    let j = i; while (j < g.length && g[j] !== pd && g[j] !== rd) j++;
    out.push(g.slice(i, j).trim()); if (g[j] === rd || j >= g.length) break; i = j + 1;
  }
  return { p: out, scale: parseFloat(out[13]), unitFlag: parseInt(out[14], 10), unitName: out[15], minRes: parseFloat(out[19]), maxCoord: parseFloat(out[20]) };
}
function deBoor(knots, deg, ctrl, u, wrap) {            // ctrl: homogeneous [xw, yw, zw, w]
  const n = ctrl.length, lo = knots[deg], hi = knots[n];
  if (wrap && hi > lo) { const per = hi - lo; if (u < lo || u > hi) u = lo + ((((u - lo) % per) + per) % per); }
  if (u >= hi) u = hi - 1e-13 * Math.max(1, Math.abs(hi)); if (u < lo) u = lo;
  let k = deg; while (k < n - 1 && u >= knots[k + 1]) k++;
  const d = []; for (let j = 0; j <= deg; j++) d.push(ctrl[k - deg + j].slice());
  for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) { const i = k - deg + j, den = knots[i + deg - r + 1] - knots[i], a = den ? (u - knots[i]) / den : 0; for (let q = 0; q < 4; q++) d[j][q] = (1 - a) * d[j - 1][q] + a * d[j][q]; }
  return d[deg];
}
export function curve126(e) {
  const K = e.v[0], M = e.v[1], N = K + 1, A = N + M + 1;
  const knots = e.v.slice(6, 6 + A), w = e.v.slice(6 + A, 6 + A + N), cp = e.v.slice(6 + A + N, 6 + A + 4 * N), v0 = e.v[6 + A + 4 * N], v1 = e.v[7 + A + 4 * N];
  const ctrl = []; for (let i = 0; i < N; i++) ctrl.push([cp[3 * i] * w[i], cp[3 * i + 1] * w[i], cp[3 * i + 2] * w[i], w[i]]);
  return { v0, v1, deg: M, n: N, finite: e.v.slice(0, 8 + A + 4 * N).every(Number.isFinite), at: (u) => { const h = deBoor(knots, M, ctrl, u, false); return [h[0] / h[3], h[1] / h[3], h[2] / h[3]]; } };
}
export function surface128(e) {
  const K1 = e.v[0], K2 = e.v[1], M1 = e.v[2], M2 = e.v[3]; const n1 = K1 + 1, n2 = K2 + 1, A = K1 + M1 + 2, Bn = K2 + M2 + 2, C = n1 * n2;
  let o = 9; const ku = e.v.slice(o, o + A); o += A; const kv = e.v.slice(o, o + Bn); o += Bn; const w = e.v.slice(o, o + C); o += C; const cp = e.v.slice(o, o + 3 * C); o += 3 * C;
  const u0 = e.v[o], u1 = e.v[o + 1], v0 = e.v[o + 2], v1 = e.v[o + 3];
  const closedU = e.v[4] === 1 || e.v[7] === 1, closedV = e.v[5] === 1 || e.v[8] === 1;
  const H = (i, j) => { const q = j * n1 + i; return [cp[3 * q] * w[q], cp[3 * q + 1] * w[q], cp[3 * q + 2] * w[q], w[q]]; };
  const domU = [ku[M1], ku[n1]], domV = [kv[M2], kv[n2]];
  return { u0, u1, v0, v1, M1, M2, n1, n2, domU, domV, closedU, closedV, finite: e.v.slice(0, o + 4).every(Number.isFinite),
    outside: Math.max(domU[0] - u0, u1 - domU[1], domV[0] - v0, v1 - domV[1]),          // > 0: declared range leaves the knot domain
    at: (u, v) => { const rowp = []; for (let j = 0; j < n2; j++) { const col = []; for (let i = 0; i < n1; i++) col.push(H(i, j)); rowp.push(deBoor(ku, M1, col, u, closedU)); } const h = deBoor(kv, M2, rowp, v, closedV); return [h[0] / h[3], h[1] / h[3], h[2] / h[3]]; } };
}
function xf(I, e, p) { if (!e.xform) return p; const m = I.ent.get(e.xform).v; return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]]; }
/** Sample a curve entity (126 / 110 / 100 / 102 composite) -> array of segments, each an array of points. */
export function sampleCurve(I, e, n, unknown, bad) {
  if (!e) return [];
  if (e.type === 102) { let out = []; for (const de of e.v.slice(1, 1 + e.v[0])) out = out.concat(sampleCurve(I, I.ent.get(de), n, unknown, bad)); return out; }
  let pts = [];
  if (e.type === 126) { const c = curve126(e); if (!c.finite && bad) bad.push(e.de); for (let i = 0; i <= n; i++) pts.push(c.at(c.v0 + (c.v1 - c.v0) * i / n)); }
  else if (e.type === 110) { const [x1, y1, z1, x2, y2, z2] = e.v; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t]); } }
  else if (e.type === 100) { const [zt, cx, cy, sx, sy, ex, ey] = e.v, r = Math.hypot(sx - cx, sy - cy); let a0 = Math.atan2(sy - cy, sx - cx), a1 = Math.atan2(ey - cy, ex - cx); if (a1 <= a0 + 1e-12) a1 += 2 * Math.PI; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), zt]); } }
  else { if (unknown) unknown.add(e.type); return []; }
  return [pts.map(p => xf(I, e, p))];
}
/** Every trimmed face of the file: { faces:[{ loops:[{ C, SB, pref }] , outside }], unknown, nonFinite, types } in FILE units. */
export function trimmedFaces(text, n) {
  const I = parseIges(text), unknown = new Set(), bad = [], faces = [], types = {};
  for (const e of I.ent.values()) types[e.type] = (types[e.type] || 0) + 1;
  for (const e of I.ent.values()) {
    if (e.type !== 144) continue;
    const se = I.ent.get(e.v[0]); const loops = []; const ids = [e.v[3]].concat(e.v.slice(4, 4 + e.v[2])).filter(d => d > 0);
    let S = null; if (se && se.type === 128) { S = surface128(se); if (!S.finite) bad.push(se.de); } else if (se) unknown.add(se.type);
    for (const id of ids) { const b = I.ent.get(id); if (!b || b.type !== 142) { unknown.add(b ? b.type : -1); continue; }
      const C = sampleCurve(I, I.ent.get(b.v[3]), n, unknown, bad), Bp = sampleCurve(I, I.ent.get(b.v[2]), n, unknown, bad);
      loops.push({ pref: b.v[4], C, B: Bp, SB: S ? Bp.map(seg => seg.map(q => S.at(q[0], q[1]))) : [] }); }
    faces.push({ de: e.de, surf: S, outside: S ? S.outside : 0, loops });
  }
  return { I, faces, unknown: [...unknown], nonFinite: bad, types };
}
export function distToPolys(p, polys) {
  let best = 1e300;
  for (const pl of polys) for (let i = 0; i + 1 < pl.length; i++) {
    const a = pl[i], b = pl[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz;
    let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = a[0] + dx * t - p[0], ey = a[1] + dy * t - p[1], ez = a[2] + dz * t - p[2], d = ex * ex + ey * ey + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
/** Largest distance between the two descriptions of each trim loop: { worst, loops, worstFace } (file units). */
export function trimConsistency(T) {
  let worst = 0, loops = 0, worstFace = -1, badLoops = 0;
  T.faces.forEach((f, fi) => { for (const lp of f.loops) { if (!lp.C.length || !lp.SB.length) continue; loops++; let w = 0;
    for (const seg of lp.SB) for (const q of seg) { const d = distToPolys(q, lp.C); if (d > w) w = d; }
    for (const seg of lp.C) for (const q of seg) { const d = distToPolys(q, lp.SB); if (d > w) w = d; }
    lp.dev = w; if (w > 1e-3) badLoops++; if (w > worst) { worst = w; worstFace = fi; } } });
  return { worst, loops, worstFace, badLoops };
}
/** Rewrite the "preferred representation" flag of every curve-on-surface (142): 1 = S(B), 2 = C, 3 = either. */
export function setTrimPreference(text, v) {
  let n = 0;
  const out = text.split('\n').map(l => { if (l[72] === 'P' && /^142,/.test(l)) { const m = l.slice(0, 64).match(/^(142,\s*-?\d+,\s*\d+,\s*\d+,\s*\d+,)\s*(\d)\s*;/); if (m) { n++; return (m[1] + v + ';').padEnd(64, ' ') + l.slice(64); } } return l; }).join('\n');
  return { text: out, n };
}
/** Exact X extent of every model-space trim curve (C of each 142): coarse scan, then a golden-section search at each extreme. */
export function modelExtentX(T) {
  const I = T.I; let x0 = 1e300, x1 = -1e300;
  const one = (e) => { if (!e) return;
    if (e.type === 102) { for (const de of e.v.slice(1, 1 + e.v[0])) one(I.ent.get(de)); return; }
    if (e.type === 110) { for (const p of [xf(I, e, e.v.slice(0, 3)), xf(I, e, e.v.slice(3, 6))]) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; } return; }
    if (e.type !== 126) return;
    const c = curve126(e), f = (u) => xf(I, e, c.at(u))[0], n = 96, du = (c.v1 - c.v0) / n, gr = (Math.sqrt(5) - 1) / 2;
    for (const sg of [1, -1]) { let best = 1e300, bi = 0; for (let i = 0; i <= n; i++) { const v = sg * f(c.v0 + du * i); if (v < best) { best = v; bi = i; } }
      let lo = Math.max(c.v0, c.v0 + du * (bi - 1)), hi = Math.min(c.v1, c.v0 + du * (bi + 1));
      for (let k = 0; k < 60; k++) { const m1 = hi - gr * (hi - lo), m2 = lo + gr * (hi - lo); if (sg * f(m1) < sg * f(m2)) hi = m2; else lo = m1; }
      best = Math.min(best, sg * f((lo + hi) / 2)); if (sg > 0) { if (best < x0) x0 = best; } else if (-best > x1) x1 = -best; } };
  for (const e of I.ent.values()) if (e.type === 142) one(I.ent.get(e.v[3]));
  return [x0, x1];
}
