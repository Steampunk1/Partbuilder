// Independent IGES reader for checks (no CAD kernel): finds every model-space trimming curve
// (the 3D "C" curve of each type-142 curve-on-surface) and evaluates it itself.
export function parseIges(text) {
  const lines = text.split(/\r?\n/);
  const D = lines.filter(l => l[72] === 'D'), Pl = lines.filter(l => l[72] === 'P');
  const dir = new Map();                                   // DE sequence number -> { type, xform }
  for (let i = 0; i + 1 < D.length; i += 2) { const seq = parseInt(D[i].slice(73), 10); dir.set(seq, { type: parseInt(D[i].slice(0, 8), 10), xform: parseInt(D[i].slice(48, 56), 10) || 0 }); }
  const par = new Map();
  for (const l of Pl) { const de = parseInt(l.slice(64, 72), 10); par.set(de, (par.get(de) || '') + l.slice(0, 64)); }
  const ent = new Map();
  for (const [de, s] of par) { const a = s.split(';')[0].split(',').map(x => x.trim()); ent.set(de, Object.assign({ de, v: a.slice(1).map(x => parseFloat(x.replace(/D/i, 'E'))) }, dir.get(de) || { type: +a[0], xform: 0 })); }
  const G = lines.filter(l => l[72] === 'G').map(l => l.slice(0, 72)).join('');
  return { ent, global: G };
}
function nurbs(e, n) {
  const K = e.v[0], M = e.v[1], N = K + 1, A = N + M + 1;
  const knots = e.v.slice(6, 6 + A), w = e.v.slice(6 + A, 6 + A + N), cp = e.v.slice(6 + A + N, 6 + A + 4 * N), v0 = e.v[6 + A + 4 * N], v1 = e.v[7 + A + 4 * N];
  const out = [];
  for (let s = 0; s <= n; s++) {
    let u = v0 + (v1 - v0) * s / n; if (u >= knots[A - 1]) u = knots[A - 1] - 1e-12; if (u < knots[0]) u = knots[0];
    let k = M; while (k < N - 1 && u >= knots[k + 1]) k++;
    const d = []; for (let j = 0; j <= M; j++) { const i = k - M + j; d.push([cp[3 * i] * w[i], cp[3 * i + 1] * w[i], cp[3 * i + 2] * w[i], w[i]]); }
    for (let r = 1; r <= M; r++) for (let j = M; j >= r; j--) { const i = k - M + j, den = knots[i + M - r + 1] - knots[i], a = den ? (u - knots[i]) / den : 0; for (let q = 0; q < 4; q++) d[j][q] = (1 - a) * d[j - 1][q] + a * d[j][q]; }
    out.push([d[M][0] / d[M][3], d[M][1] / d[M][3], d[M][2] / d[M][3]]);
  }
  return out;
}
function curvePts(I, e, n, unknown) {
  let pts;
  if (e.type === 126) pts = nurbs(e, n);
  else if (e.type === 110) { const [x1, y1, z1, x2, y2, z2] = e.v; pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t]); } }
  else if (e.type === 100) { const [zt, cx, cy, sx, sy, ex, ey] = e.v, r = Math.hypot(sx - cx, sy - cy); let a0 = Math.atan2(sy - cy, sx - cx), a1 = Math.atan2(ey - cy, ex - cx); if (a1 <= a0 + 1e-12) a1 += 2 * Math.PI; pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), zt]); } }
  else if (e.type === 102) { pts = []; for (const de of e.v.slice(1, 1 + e.v[0])) pts = pts.concat(curvePts(I, I.ent.get(de), n, unknown)); return pts; }
  else { unknown.add(e.type); return []; }
  if (e.xform) { const m = I.ent.get(e.xform).v; pts = pts.map(p => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]]); }
  return pts;
}
/** Every model-space trimming curve in the file, sampled as polylines: { polys, curves, unknownTypes, faces }. File units. */
export function igesTrimCurves(text, n) {
  const I = parseIges(text), unknown = new Set(), polys = []; let curves = 0, faces = 0; const types = {};
  const add = (c) => { if (c.type === 102) { for (const de of c.v.slice(1, 1 + c.v[0])) add(I.ent.get(de)); return; } const p = curvePts(I, c, n, unknown); if (p.length) polys.push(p); };
  for (const e of I.ent.values()) { types[e.type] = (types[e.type] || 0) + 1; if (e.type === 144) faces++; if (e.type !== 142) continue; const c = I.ent.get(e.v[3]); if (!c) continue; curves++; add(c); }
  return { polys, curves, faces, types, unknownTypes: [...unknown], global: I.global };
}
/** Distance from point p to a set of polylines. */
export function distToPolys(p, polys) {
  let best = 1e18;
  for (const pl of polys) for (let i = 0; i + 1 < pl.length; i++) {
    const a = pl[i], b = pl[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz;
    let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = a[0] + dx * t - p[0], ey = a[1] + dy * t - p[1], ez = a[2] + dz * t - p[2], d = ex * ex + ey * ey + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
