// Back-test: SQUARE / RECT TUBE (hss) and ANGLE (angl) - does the exported IGES hold exactly the part that was typed?
//
//   node test/bt-box.mjs            full sweep: every size x every wall, ~125 targeted cases, 150 seeded random parts
//                                   (about 8-10 min on a shared 4-core box)
//   node test/bt-box.mjs --quick    one wall per size + the core targeted cases + 8 random parts (about 1 min)
//   options: --seed=N  --n=N (random cases)  --only=REGEX (case ids)  --json=FILE  --verbose  --times
//            --case='{"fam":"hss","patch":{...}}'   re-run one case; add --verbose to print every check
//   Prints "N passed, M failed", lists every failure with its patch, exits 1 on any failure.
//
// How a case is applied (the exact repro for every failure printed):
//     const c = await freshApp(); c.pickFam(fam)(); c.setState(state);
//   `state` is the printed patch with each end laid over Component.defEnd() and each hole group laid over
//   Component.defGroup(id, fam) - the form's own defaults.  The fully expanded state is in the --json report.
//
// What is measured.  The part is built with buildSolid, written with writeIges, read back with readBack and sewn;
// the READ-BACK shape is then measured: probe rays through the walls (outside size, wall, corner radius), along
// the part (both end faces at 13-20 points of the section) and through every hole (centre, size both ways, a
// 45-degree diameter or the slot's end radii, clean through one wall only); bounding box; volume; and topology
// (hole count = genus of the closed shell).  The raw IGES text is also read with the repo's own text reader.
// Expected numbers come from test/bt-box-oracle.mjs, which works only from the typed text and plain geometry -
// it never calls the app's geometry.  "direct" cases (the rest of the every-size-by-every-wall sweep) skip the
// IGES round trip and measure the built solid the same way.
//
// For each part the oracle also says what the app MUST do: export it (everything is comfortably on the material),
// block it (a typed value cannot be read, the end cuts cross, a hole is off the material), or either (borderline).
// Each failure says whether the app would really have handed a file over ({FILE EXPORTED}) or refused.
//
// Tolerance 0.001 in everywhere, except: iges.extent 0.003 (the text reader samples the trim curves 40 points
// each), weight 1 %, volume 1e-5 relative.  Weight is judged on the section as modelled where the corner radius
// is not the book 2t (those size/wall combinations are listed in NOTES as a question, not a failure).
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadOcc } from './_occ.mjs';
import { freshApp, Component, DB } from './_load.mjs';
import * as occm from '../occ-solid.js';
import { parseDxf, bbox as bb2 } from './_geom.mjs';
import { parseIges, igesTrimCurves } from './_iges.mjs';
import * as O from './bt-box-oracle.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const a = argv.find(s => s.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const QUICK = flag('quick'), VERBOSE = flag('verbose'), SEED = +opt('seed', 1), ONLY = opt('only', '') ? new RegExp(opt('only', '')) : null;
const NRAND = +opt('n', QUICK ? 8 : 150);
const T0 = Date.now(), TOL = 1e-3, MM = 25.4, PI = Math.PI, SQ3 = Math.sqrt(3);

// ------------------------------------------------------------------ bookkeeping
let pass = 0, fail = 0, cur = null;
const fails = [], notes = [], stats = { cases: 0, exported: 0, blocked: 0, guard: 0, direct: 0, iges: 0, calcOnly: 0, holes: 0, engine: 0, mustExport: 0, mustBlock: 0, either: 0 };
const TITLE = { 'sec.size': 'outside dimensions as selected (probes and bounding box)', 'dxf.wrap': 'DXF band height = distance around the section (tube) / leg strips (angle)', 'dxf.extent': 'DXF outline starts and ends where the solid does', 'hole.size': 'hole size along the part and across the face', 'rt.bbox': 'IGES read-back has the bounding box of the built solid', 'end.A.plane': 'End A face lies on the typed plane', 'end.B.plane': 'End B face lies on the typed plane', 'len.wp': 'work-point length: end planes the typed length apart on the centreline / heel line', 'wt': 'weight = steel x section area x centroid length (1 %)', 'hole.onewall': 'only the one wall / leg is cut' };
function rec(id, title, ok, d) {
  if (!TITLE[id]) TITLE[id] = title;
  if (VERBOSE) console.log('   ' + (ok ? 'ok  ' : 'FAIL') + ' ' + id + ' - ' + title + (d && d.expected !== undefined ? '  expected ' + fmt(d.expected) + ' measured ' + fmt(d.measured) : '') + (d && d.note ? '  [' + d.note + ']' : ''));
  if (ok) { pass++; return true; }
  fail++; cur.nfail++;
  fails.push(Object.assign({ check: id, title, case: cur.id, fam: cur.fam, lenMode: cur.patch.lenMode || 'oal', patch: cur.patch }, d || {}));
  return false;
}
const fmt = (v) => typeof v === 'number' ? (Math.abs(v) >= 1e4 ? v.toFixed(2) : v.toFixed(5)) : String(v);
const near = (id, title, measured, expected, tol, note) => rec(id, title, Number.isFinite(measured) && Math.abs(measured - expected) <= (tol == null ? TOL : tol), { expected, measured, delta: measured - expected, tol: tol == null ? TOL : tol, note });
const truthy = (id, title, cond, note, extra) => rec(id, title, !!cond, Object.assign({ note }, extra || {}));

// ------------------------------------------------------------------ engine
let oc = await loadOcc(), K = occm.kit(oc), built = 0;
async function reloadEngine() { oc = await loadOcc(true); K = occm.kit(oc); built = 0; }
process.on('uncaughtException', (e) => { console.log('ENGINE STOPPED during ' + (cur && cur.id) + ': ' + String(e && e.message || e).slice(0, 200)); if (cur) rec('engine.abort', 'the CAD engine ran the case without stopping', false, { note: String(e && e.message || e).slice(0, 200) }); finish(); });

function sew(shape, tol) {
  const s = new oc.BRepBuilderAPI_Sewing(tol, true, true, true, false);
  s.Add(shape); s.Perform(new oc.Handle_Message_ProgressIndicator_1());
  return { shape: s.SewedShape(), free: s.NbFreeEdges(), multi: s.NbMultipleEdges() };
}
function uniq(shape, what) {
  const ex = K.mk('TopExp_Explorer', shape, oc.TopAbs_ShapeEnum[what], oc.TopAbs_ShapeEnum.TopAbs_SHAPE), buckets = new Map(); let n = 0;
  for (; ex.More(); ex.Next()) { const s = ex.Current(), h = s.HashCode(1 << 30); let b = buckets.get(h); if (!b) { b = []; buckets.set(h, b); } if (!b.some(q => q.IsSame(s))) { b.push(s); n++; } }
  return n;
}
/** Volume by adaptive integration (the kernel's quick method is only good to about 4 digits on read-back NURBS faces with holes). */
function volGK(shape) { const g = new oc.GProp_GProps_1(); oc.BRepGProp.VolumePropertiesGK_1(shape, g, 1e-6, false, false, false, false, false); return g.Mass(); }
/** Number of through-holes of a closed shell (Euler-Poincare): tube = 1, each hole through one wall adds 1. */
function genus(shape) { const V = uniq(shape, 'TopAbs_VERTEX'), E = uniq(shape, 'TopAbs_EDGE'), F = uniq(shape, 'TopAbs_FACE'), W = uniq(shape, 'TopAbs_WIRE'), S = uniq(shape, 'TopAbs_SHELL'); return S - (V - E + F - (W - F)) / 2; }

/** Probe rays through a shape.  scale = file units per inch.  x values are in the oracle frame (long point of End A = 0). */
class Meas {
  constructor(shape, scale) {
    this.s = scale; this.it = new oc.IntCurvesFace_ShapeIntersector(); this.it.Load(shape, 1e-7);
    this.bb = K.bbox(shape).map(r => r.map(v => v / scale)); this.x0 = this.bb[0][0]; this.ext = this.bb[0][1] - this.bb[0][0]; this.rays = 0;
  }
  ray(o, d) {
    const s = this.s; this.rays++;
    this.it.Perform_1(new oc.gp_Lin_3(K.pnt(o[0] * s, o[1] * s, o[2] * s), K.dir(d[0], d[1], d[2])), -1e7, 1e7);
    const a = []; for (let i = 1, n = this.it.NbPnt(); i <= n; i++) a.push(this.it.WParameter(i) / s);
    a.sort((p, q) => p - q);
    const out = []; for (const v of a) if (!out.length || v - out[out.length - 1] > 2e-6) out.push(v);
    return out;
  }
  hitsX(y, z) { return this.ray([0, y, z], [1, 0, 0]).map(v => v - this.x0); }
  hitsY(x, z) { return this.ray([x + this.x0, 0, z], [0, 1, 0]); }
  hitsZ(x, y) { return this.ray([x + this.x0, y, 0], [0, 0, 1]); }
  along(axis, x, other) { return axis === 'y' ? this.hitsY(x, other) : this.hitsZ(x, other); }
}
/** Open gaps along a ray: [lo, hi] pairs between leaving the material and entering it again. */
const gaps = (h) => { const o = []; for (let i = 1; i + 1 < h.length; i += 2) o.push([h[i], h[i + 1]]); return o; };
const nearestGap = (h, v) => { let b = null; for (const g of gaps(h)) { const d = Math.abs((g[0] + g[1]) / 2 - v); if (!b || d < b.d) b = { lo: g[0], hi: g[1], mid: (g[0] + g[1]) / 2, w: g[1] - g[0], d }; } return b; };
const rad = (e, d) => e < 2e-6 ? 0 : (e + d) + Math.sqrt(2 * e * d);     // radius of a corner arc from one probe d in from the side

// ------------------------------------------------------------------ the form
const clone = (o) => JSON.parse(JSON.stringify(o));
function expand(fam, patch) {
  const p = clone(patch);
  p.ends = { A: Object.assign(Component.defEnd(), (patch.ends || {}).A || {}), B: Object.assign(Component.defEnd(), (patch.ends || {}).B || {}) };
  if (patch.groups) p.groups = patch.groups.map(g => Object.assign(Component.defGroup(g.id, fam), g));
  return p;
}
async function formOf(fam, state) { const c = await freshApp(); c.pickFam(fam)(); c.setState(state); return c; }
const secKey = (fam, st) => fam === 'hss' ? 'hss|' + st.hsize + '|' + st.hwallT : 'angl|' + st.asize + '|' + st.athkT;

// ------------------------------------------------------------------ measuring the cross-section
function measureSection(M, S, xs) {
  if (S.fam === 'hss') {
    const e0 = .0127, hy = M.hitsY(xs, e0), hz = M.hitsZ(xs, e0);
    if (hy.length !== 4 || hz.length !== 4) return { ok: false, why: 'through-wall probes hit ' + hy.length + ' / ' + hz.length + ' surfaces, expected 4 / 4' };
    const m = { ok: true, H: hy[3] - hy[0], B: hz[3] - hz[0], tB: hy[1] - hy[0], tT: hy[3] - hy[2], tL: hz[1] - hz[0], tR: hz[3] - hz[2], yc: (hy[0] + hy[3]) / 2, zc: (hz[0] + hz[3]) / 2 };
    const top = hy[3], bot = hy[0], right = hz[3], left = hz[0], rc = [], ri = [];
    for (const [zs, sgn] of [[right, -1], [left, 1]]) { const h = M.hitsY(xs, zs + sgn * .03); if (h.length >= 2) { rc.push(rad(top - h[h.length - 1], .03)); rc.push(rad(h[0] - bot, .03)); } }
    { const h = M.hitsY(xs, right - .06); m.rc2 = h.length >= 2 ? rad(top - h[h.length - 1], .06) : NaN; }
    for (const [zs, sgn, tw] of [[right, -1, m.tR], [left, 1, m.tL]]) { const h = M.hitsY(xs, zs + sgn * (tw + .004)); if (h.length === 4) { ri.push(rad((top - m.tT) - h[2], .004)); ri.push(rad(h[1] - (bot + m.tB), .004)); } }
    m.rcAll = rc; m.riAll = ri; m.rc = rc.length ? rc[0] : NaN; m.ri = ri.length ? ri[0] : NaN;
    m.tMin = Math.min(m.tT, m.tB, m.tL, m.tR); m.tMax = Math.max(m.tT, m.tB, m.tL, m.tR);
    return m;
  }
  const y0 = M.bb[1][0], z0 = M.bb[2][0], aM = M.bb[1][1] - y0, bM = M.bb[2][1] - z0;
  const hz1 = M.hitsZ(xs, y0 + aM - .02), hy1 = M.hitsY(xs, z0 + bM - .02);
  if (hz1.length !== 2 || hy1.length !== 2) return { ok: false, why: 'leg probes hit ' + hz1.length + ' / ' + hy1.length + ' surfaces, expected 2 / 2' };
  const m = { ok: true, y0: hy1[0], z0: hz1[0], tV: hz1[1] - hz1[0], tH: hy1[1] - hy1[0] };
  const hy2 = M.hitsY(xs, m.z0 + m.tV / 2), hz2 = M.hitsZ(xs, m.y0 + m.tH / 2);
  m.a = hy2.length === 2 ? hy2[1] - hy2[0] : NaN; m.b = hz2.length === 2 ? hz2[1] - hz2[0] : NaN;
  const rr = []; for (const d of [.004, .008]) { const h = M.hitsZ(xs, m.y0 + m.tH + d); if (h.length === 2) rr.push(rad(h[1] - (m.z0 + m.tV), d)); }
  m.rrAll = rr; m.rr = rr.length ? rr[0] : NaN; m.tMin = Math.min(m.tV, m.tH); m.tMax = Math.max(m.tV, m.tH);
  return m;
}
/** Where on the section to check the end planes: [y, z] points inside the material. */
function planePoints(S, m) {
  const p = [];
  if (S.fam === 'hss') {
    const fz = m.B / 2 - m.rc, fy = m.H / 2 - m.rc, yT = m.H / 2 - m.tT / 2, yB = -(m.H / 2 - m.tB / 2), zR = m.B / 2 - m.tR / 2, zL = -(m.B / 2 - m.tL / 2);
    for (const f of [-.8, .13, .8]) p.push([yT, f * fz], [yB, f * fz], [f * fy, zR], [f * fy, zL]);
    p.push([m.H / 2 - .004, .31 * fz], [-m.H / 2 + .004, -.31 * fz], [.31 * fy, m.B / 2 - .004], [-.31 * fy, -m.B / 2 + .004]);
    if (m.rc > .02) { const k = (m.rc - .004) / Math.SQRT2; for (const sy of [1, -1]) for (const sz of [1, -1]) p.push([sy * (m.H / 2 - m.rc + k), sz * (m.B / 2 - m.rc + k)]); }
    return p.map(q => [q[0] + m.yc, q[1] + m.zc]);
  }
  const { a, b, tV, tH } = m;
  p.push([a * .45, tV / 2], [a * .8, tV / 2], [a * .62, .004], [a * .62, tV - .004], [tH / 2, b * .45], [tH / 2, b * .8], [.004, b * .62], [tH - .004, b * .62]);
  p.push([.004, .004], [a - .004, .004], [a - .004, tV - .004], [.004, b - .004], [tH - .004, b - .004]);
  return p.map(q => [q[0] + m.y0, q[1] + m.z0]);
}
const secCache = new Map();
/** Corner radius / root fillet of a section, measured on a plain 6 in piece (cached). */
async function sectionOf(fam, st) {
  const key = secKey(fam, st); if (secCache.has(key)) return secCache.get(key);
  const c = await formOf(fam, fam === 'hss' ? { hsize: st.hsize, hwallT: st.hwallT, lenT: '6', lenMode: 'oal' } : { asize: st.asize, athkT: st.athkT, lenT: '6', lenMode: 'oal' });
  const { shape } = occm.buildSolid(oc, c, c.calc()); built++;
  const m = measureSection(new Meas(shape, 1), O.nominal(fam, st), 3); secCache.set(key, m); return m;
}

// ------------------------------------------------------------------ measuring one hole
const AX = { T: ['z', 'y'], B: ['z', 'y'], L: ['y', 'z'], R: ['y', 'z'], vleg: ['y', 'z'], hleg: ['z', 'y'] };   // [across axis, through axis]
const halfX = (h, dc) => { const r = h.r, s = h.slotL ? (h.slotL - h.d) / 2 : 0, a = Math.abs(dc); if (!h.slotL || h.along) return a < r ? s + Math.sqrt(r * r - a * a) : 0; return a <= s ? r : a < s + r ? Math.sqrt(r * r - (a - s) ** 2) : 0; };
const halfC = (h, dx) => { const r = h.r, s = h.slotL ? (h.slotL - h.d) / 2 : 0, a = Math.abs(dx); if (h.slotL && h.along) return a <= s ? r : a < s + r ? Math.sqrt(r * r - (a - s) ** 2) : 0; return a < r ? (h.slotL ? s : 0) + Math.sqrt(r * r - a * a) : 0; };
function measureHole(M, S, m, h, all, F) {
  const [acr, thr] = AX[h.face], hss = S.fam === 'hss', dl = 2.3e-4;
  const tw = hss ? { T: m.tT, B: m.tB, L: m.tL, R: m.tR }[h.face] : h.face === 'vleg' ? m.tV : m.tH;
  const P = hss ? { fam: 'hss', H: m.H, B: m.B } : S, oy = hss ? m.yc : m.y0, oz = hss ? m.zc : m.z0;
  const at = (x, c) => { const q = O.facePoint(P, h.face, x, c, tw / 2); return [q[0], q[1] + oy, q[2] + oz]; };
  const cOff = acr === 'y' ? oy : oz;                                   // model coordinate of "across = 0"
  const xray = (c) => { const q = at(0, c); return M.hitsX(q[1], q[2]); };
  const cray = (x) => { const q = at(x, 0); return M.along(acr, x, acr === 'y' ? q[2] : q[1]).map(v => v - cOff); };
  const out = { found: false };
  let gx = nearestGap(xray(h.c + dl), h.x);
  if (!gx || gx.d > Math.max(1, h.hx)) return out;
  let gc = nearestGap(cray(gx.mid + dl), h.c);
  if (!gc || gc.d > Math.max(1, h.hc)) return out;
  if (Math.abs(gc.mid - h.c) > 1e-4) { const g2 = nearestGap(xray(gc.mid + dl), gx.mid); if (g2) gx = g2; }
  Object.assign(out, { found: true, x: gx.mid, c: gc.mid, sx: gx.w, sc: gc.w, expSx: 2 * halfX(h, dl), expSc: 2 * halfC(h, dl) });
  if (!h.slotL) {
    const o = at(out.x, out.c); o[0] += M.x0;
    const hits = M.ray(o, [Math.SQRT1_2, acr === 'y' ? Math.SQRT1_2 : 0, acr === 'z' ? Math.SQRT1_2 : 0]);
    let lo = -1e9, hi = 1e9; for (const v of hits) { if (v < 0 && v > lo) lo = v; if (v > 0 && v < hi) hi = v; }
    out.diag = hi - lo > 1e6 ? Infinity : hi - lo; out.diagMid = (hi + lo) / 2;
  } else {
    const s = (h.slotL - h.d) / 2, k = s + h.r / 2, ends = [];
    for (const sg of [1, -1]) { const g = h.along ? nearestGap(cray(out.x + sg * k), out.c) : nearestGap(xray(out.c + sg * k), out.x); ends.push(g ? g.w : NaN, g ? g.mid - (h.along ? out.c : out.x) : NaN); }
    out.endW = [ends[0], ends[2]]; out.endMid = [ends[1], ends[3]];
  }
  // through one wall only
  const q0 = at(out.x, out.c), th = M.along(thr, out.x, thr === 'y' ? q0[2] : q0[1]).map(v => v - (thr === 'y' ? oy : oz));
  const nearBand = hss ? (h.face === 'T' ? [m.H / 2 - tw, m.H / 2] : h.face === 'B' ? [-m.H / 2, -m.H / 2 + tw] : h.face === 'R' ? [m.B / 2 - tw, m.B / 2] : [-m.B / 2, -m.B / 2 + tw]) : [0, tw];
  out.inNear = th.filter(v => v > nearBand[0] - .02 && v < nearBand[1] + .02).length; out.thHits = th;
  if (hss) {
    const opp = { T: 'B', B: 'T', L: 'R', R: 'L' }[h.face], two = all.some(o => o.face === opp && Math.abs(o.x - h.x) < o.hx + h.hx && Math.abs(o.c - h.c) < o.hc + h.hc);
    // the far wall is only there to be hit if this station is inside both of its end cuts
    const far = [0, S.t].map(dep => O.facePoint(S, opp, h.x, h.c, dep)), inside = far.every(q => F.xA(q[1], q[2]) + .02 < h.x && h.x < F.xB(q[1], q[2]) - .02), outside = far.every(q => h.x < F.xA(q[1], q[2]) - .02 || h.x > F.xB(q[1], q[2]) + .02);
    out.farHits = th.filter(v => v < nearBand[0] - .02 || v > nearBand[1] + .02).length; out.farExpect = two ? null : inside ? 2 : outside ? 0 : null;
  } else out.farHits = th.length - out.inNear, out.farExpect = (h.c - h.hc >= S.t + m.rr) ? 0 : null;
  return out;
}

// ------------------------------------------------------------------ what should the app do with this part?
function classify(S, F, HO, m) {
  if (!F.readable) return { must: 'block', why: 'the typed length or end angle cannot be read' };
  if (HO.bad.length) return { must: 'block', why: 'typed value cannot be read - ' + HO.bad.join('; ') };
  if ([F.A, F.B].some((E) => Math.abs(E.dv || 0) > 75 || Math.abs(E.dp || 0) > 75)) return { must: 'block', why: 'end angle past the 75 degree limit the form states' };
  if (!(F.Lwp > 0) || F.minChord <= 0) return { must: 'block', why: 'end cuts cross (shortest fibre ' + (F.minChord || 0).toFixed(3) + ')' };
  // rules the form now states and enforces (they used to be silent clamps or silent truncation)
  if (S.fam === 'hss' ? S.t > Math.min(S.H, S.B) / 2.5 + 1e-9 : S.t > Math.min(S.a, S.b) / 2 + 1e-9) return { must: 'block', why: 'that wall or thickness is not made in this size' };
  if (F.Lt != null && F.Lt < .25) return { must: 'block', why: 'cut length under 1/4 in' };
  { const per = {}; for (const h of HO.holes) per[h.g] = (per[h.g] || 0) + 1; if (Object.values(per).some((n) => n > 60)) return { must: 'block', why: 'more than 60 holes asked of one set' }; }
  let comfy = F.minChord >= .02, off = null;
  for (const h of HO.holes) {
    const cl = O.clearance(S, F, h, m); h.cl = cl;
    const isOff = cl.end < -.002 || cl.edge < -.002 || cl.inner < -.002;
    if (isOff && !off) off = 'hole (group ' + h.g + ', ' + h.face + ', ' + h.dist + ' from End ' + h.ref + ') is off the material: room to the end cut ' + cl.end.toFixed(3) + ', to the ' + (S.fam === 'hss' ? 'corner radius ' : 'toe ') + cl.edge.toFixed(3) + (S.fam === 'angl' ? ', to the other leg ' + cl.inner.toFixed(3) : '');
    if (!(cl.end >= .35 && cl.edge >= (S.fam === 'hss' ? .07 : .02) && cl.fillet >= .002 && cl.seam >= .005)) comfy = false;
  }
  return off ? { must: 'block', why: off } : { must: comfy ? 'export' : 'either', why: '' };
}

// ------------------------------------------------------------------ one case
async function runCase(cs) {
  cur = cs; cs.nfail = 0; stats.cases++;
  if (VERBOSE) console.log('\n== ' + cs.id + '  fam=' + cs.fam + '  patch=' + JSON.stringify(cs.patch));
  const fam = cs.fam, st = expand(fam, cs.patch); cs.state = st;
  const c = await formOf(fam, st), r = c.calc(), blocked = c.blocked(r), errs = (r.warns || []).filter(w => w.lvl === 'err').map(w => w.t);
  const S = O.nominal(fam, st);
  const F0 = O.frame(S, st, 2 * (S.t || 0)), H0 = F0.readable ? O.holesOf(S, F0, st) : { holes: [], bad: [] };
  const appOk = (r.holes || []).filter(h => h.ok).length;
  cs.appHoles = appOk; cs.label = r.sec && r.sec.label;

  // ---- typed values the oracle cannot read: the app must stop, not substitute something
  if (!F0.readable || H0.bad.length) {
    const why = !F0.readable ? 'length "' + st.lenT + '" / end angles' : H0.bad.join('; ');
    truthy('input.unreadable', 'a typed value that cannot be read blocks the export (no silent default)', blocked, why + '  -> app: not blocked, ' + appOk + ' hole(s) in the part' + (r.L ? ', length ' + r.L : ''), { exported: !blocked });
    if (blocked) stats.blocked++; else stats.exported++;
    return;
  }
  if (cs.calcOnly) {                      // big hole counts: the part list is enough, no solid needed
    stats.calcOnly++;
    truthy('hole.count.calc', 'every hole asked for is in the part, or the export is blocked', blocked || appOk === H0.holes.length, 'asked for ' + H0.holes.length + ', part has ' + appOk + ', blocked ' + blocked, { expected: H0.holes.length, measured: appOk, exported: !blocked });
    return;
  }
  // corner radius / root fillet of this section: needed up front only when there are holes to judge or a compound cut on a tube
  const compound = fam === 'hss' && ((F0.A.tv && F0.A.tp) || (F0.B.tv && F0.B.tp));
  let msec = { ok: false };
  if (H0.holes.length || compound || blocked) { try { msec = await sectionOf(fam, st); } catch (e) { stats.engine++; rec('solid.build', 'the solid builds', false, { note: 'section probe: ' + String(e && e.message || e).slice(0, 160) }); await reloadEngine(); return; } }
  const rc0 = fam === 'hss' ? (msec.ok ? msec.rc : 2 * S.t) : 0;
  let F = O.frame(S, st, rc0), HO = O.holesOf(S, F, st);
  const cls = msec.ok || !HO.holes.length ? classify(S, F, HO, fam === 'hss' ? { rc: msec.rc } : { rr: msec.rr }) : { must: 'either', why: '' };
  if (cs.expect) cls.must = cs.expect;
  cs.must = cls.must; stats[cls.must === 'export' ? 'mustExport' : cls.must === 'block' ? 'mustBlock' : 'either']++;

  if (blocked) {
    stats.blocked++;
    truthy('block.unjustified', 'a part that is fully on the material is not refused', cls.must !== 'export', 'app refused: ' + errs.join(' | '), { exported: false });
    let threw = false; try { c._solidFile(oc, occm, 'igs'); } catch (e) { threw = true; }
    truthy('block.enforced', 'a blocked part writes no IGES', threw, '', { exported: !threw });
    return;
  }
  truthy('block.missing', 'a part that cannot be cut as typed is blocked', cls.must !== 'block', cls.why + '  -> app: no error, export offered', { exported: true });

  // ---- build, export, read back
  let shape, text = null, M, info = {};
  try {
    ({ shape } = occm.buildSolid(oc, c, r)); built++;
    info.valid = K.valid(shape); info.solids = K.count(shape, 'TopAbs_SOLID'); info.shells = K.count(shape, 'TopAbs_SHELL'); info.faces = K.count(shape, 'TopAbs_FACE');
    info.bb = K.bbox(shape); info.vol = K.volume(shape);
  } catch (e) { stats.engine++; rec('solid.build', 'the solid builds', false, { note: String(e && e.message || e).slice(0, 200) }); await reloadEngine(); return; }
  truthy('solid.valid', 'built solid: valid, 1 solid, 1 shell', info.valid && info.solids === 1 && info.shells === 1, 'valid ' + info.valid + ', solids ' + info.solids + ', shells ' + info.shells);
  // the app's own last-ditch guard in _solidFile(): refuses when the solid is not the length calc() expects
  const appLen = r.LP || r.OAL || r.L, gotLen = info.bb[0][1] - info.bb[0][0];
  cs.refuse = !(info.valid && info.solids === 1 && info.shells === 1) ? 'The solid did not pass its own check' : Math.abs(gotLen - appLen) > .01 ? 'The solid came out ' + gotLen.toFixed(3) + ' long, expected ' + appLen.toFixed(3) : '';
  if (cs.refuse) stats.guard++;
  let gen = null;
  if (cs.level === 'iges') {
    stats.iges++;
    try {
      text = occm.writeIges(K, shape, c.fileBase());
      const G = O.igesGlobal(text);
      truthy('iges.units', 'IGES global section: inches, model scale 1', G.unitFlag === 1 && /^(INCH|IN)$/.test(G.unitName) && G.scale === 1, 'flag ' + G.unitFlag + ' name ' + G.unitName + ' scale ' + G.scale);
      const body = text.split('\n').filter(l => l[72] === 'P').map(l => l.slice(0, 64)).join('\n');
      truthy('iges.nan', 'IGES has no NaN / Infinity', !/nan|inf/i.test(body));
      const I = parseIges(text); let f144 = 0, inner = 0; for (const e of I.ent.values()) if (e.type === 144) { f144++; inner += e.v[2]; }
      truthy('iges.faces', 'IGES holds one trimmed surface per face of the solid', f144 === info.faces, f144 + ' vs ' + info.faces);
      info.inner = inner;
      const tc = igesTrimCurves(text, 40); let lo = 1e18, hi = -1e18; for (const pl of tc.polys) for (const q of pl) { if (q[0] < lo) lo = q[0]; if (q[0] > hi) hi = q[0]; }
      info.rawExt = hi - lo;
      const rb = occm.readBack(K, text, 'iges');
      let sw = sew(rb, .01);
      const shells = K.count(sw.shape, 'TopAbs_SHELL'), facesRb = K.count(rb, 'TopAbs_FACE');
      let note = 'free edges ' + sw.free + ', shells ' + shells + ' at 0.01 mm';
      if (sw.free) { const s2 = sew(rb, .0254); note += '; at 0.001 in: free ' + s2.free; }
      truthy('rt.faces', 'IGES reads back with every face', facesRb === info.faces, facesRb + ' vs ' + info.faces);
      const closed = truthy('rt.watertight', 'IGES read-back sews into one closed shell (no free edges)', sw.free === 0 && shells === 1, note);
      let solidOk = false, volRb = NaN;
      if (closed) {
        const ex = K.mk('TopExp_Explorer', sw.shape, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        const sol = K.mk('BRepBuilderAPI_MakeSolid', K.stat('TopoDS', 'Shell', ex.Current())).Solid();
        solidOk = K.valid(sol) && K.count(sol, 'TopAbs_SOLID') === 1 && K.count(sol, 'TopAbs_SHELL') === 1; volRb = Math.abs(volGK(sol)) / MM ** 3;
        truthy('rt.valid', 'IGES read-back: valid, 1 solid, 1 shell', solidOk);
        near('rt.volume', 'IGES read-back has the volume of the built solid', volRb, info.vol, Math.max(1e-6, info.vol * 2e-6));
        gen = genus(sw.shape);
      }
      M = new Meas(closed ? sw.shape : rb, MM);
      for (let k = 0; k < 3; k++) near('rt.bbox', 'IGES read-back has the bounding box of the built solid (axis ' + 'XYZ'[k] + ')', M.bb[k][1] - M.bb[k][0], info.bb[k][1] - info.bb[k][0], 2e-5);
      info.volM = closed ? volRb : info.vol;
    } catch (e) { stats.engine++; rec('iges.roundtrip', 'IGES writes and reads back', false, { note: String(e && e.message || e).slice(0, 200) }); await reloadEngine(); return; }
  } else { stats.direct++; M = new Meas(shape, 1); gen = genus(shape); info.volM = info.vol; }
  stats.exported++;

  // ---- cross-section
  const span = [F.XA + O.sup(S, -F.A.tv, -F.A.tp, rc0), F.XB - O.sup(S, -F.B.tv, -F.B.tp, rc0)];   // stretch where the section is whole
  let xs = null;
  for (const f of [.5, .37, .63, .25, .75, .12, .88, .44, .56, .31, .69, .18, .82, .06, .94]) { const x = span[0] + (span[1] - span[0]) * f; if (span[1] - span[0] > .04 && HO.holes.every(h => Math.abs(h.x - x) > h.hx + .03)) { xs = x; break; } }
  let m = xs != null ? measureSection(M, S, xs) : null;
  if (m && !m.ok) { rec('sec.probe', 'the cross-section can be probed', false, { note: m.why }); m = null; }
  if (m) {
    if (fam === 'hss') {
      near('sec.size', 'outside height as selected', m.H, S.H); near('sec.size', 'outside width as selected', m.B, S.B);
      near('sec.size', 'bounding box height = selected', M.bb[1][1] - M.bb[1][0], S.H); near('sec.size', 'bounding box width = selected', M.bb[2][1] - M.bb[2][0], S.B);
      const worst = [m.tT, m.tB, m.tL, m.tR].reduce((a, v) => Math.abs(v - S.t) > Math.abs(a - S.t) ? v : a, m.tT);
      near('sec.wall', 'wall thickness in the solid = the wall on the label', worst, S.t, TOL, 'label "' + cs.label + '"; walls T/B/L/R ' + [m.tT, m.tB, m.tL, m.tR].map(v => v.toFixed(4)).join(' / '));
      truthy('sec.center', 'section is centred on the X axis', Math.abs(m.yc) < TOL && Math.abs(m.zc) < TOL, m.yc + ', ' + m.zc);
      truthy('sec.corner', 'all four corners share one true radius, outside and inside', m.rcAll.length === 4 && Math.max(...m.rcAll) - Math.min(...m.rcAll) < 1e-4 && Math.abs(m.rc2 - m.rc) < 1e-4 && (m.riAll.length !== 4 || Math.max(...m.riAll) - Math.min(...m.riAll) < 1e-4), 'outside ' + m.rcAll.map(v => v.toFixed(4)).join(',') + ' / ' + (+m.rc2).toFixed(4) + '  inside ' + m.riAll.map(v => v.toFixed(4)).join(','));
      secCache.set(secKey(fam, st), m);
    } else {
      near('sec.size', 'vertical leg as selected', m.a, S.a); near('sec.size', 'horizontal leg as selected', m.b, S.b);
      near('sec.size', 'bounding box height = vertical leg', M.bb[1][1] - M.bb[1][0], S.a); near('sec.size', 'bounding box width = horizontal leg', M.bb[2][1] - M.bb[2][0], S.b);
      const worst = Math.abs(m.tV - S.t) > Math.abs(m.tH - S.t) ? m.tV : m.tH;
      near('sec.wall', 'leg thickness in the solid = the thickness on the label', worst, S.t, TOL, 'label "' + cs.label + '"; legs V/H ' + m.tV.toFixed(4) + ' / ' + m.tH.toFixed(4));
      truthy('sec.center', 'heel sits on the X axis', Math.abs(m.y0) < TOL && Math.abs(m.z0) < TOL, m.y0 + ', ' + m.z0);
      secCache.set(secKey(fam, st), m);
    }
  } else { if (!msec.ok) { try { msec = await sectionOf(fam, st); } catch (e) { msec = { ok: false }; await reloadEngine(); } } m = msec.ok ? msec : null; }
  if (!m) { rec('sec.probe', 'the cross-section can be probed', false, { note: 'no section data' }); return; }
  cs.meas = m;
  if (fam === 'hss' && Math.abs(m.rc - rc0) > 1e-9) { F = O.frame(S, st, m.rc); HO = O.holesOf(S, F, st); }

  // ---- length and end planes
  if (st.lenMode === 'oal') near('len.oal', 'overall length (long point to long point) = the typed length', M.ext, F.Lt);
  else near('len.lp', 'overall length = work-point length + what each end cut adds', M.ext, F.OAL);
  if (text) near('iges.extent', 'raw IGES coordinates (own text reader, no kernel) span the same length in inches as the read-back solid', info.rawExt, M.ext, .003);
  { let wA = 0, wB = 0, wL = 0, pA = null, pB = null, n = 0, miss = 0;
    for (const [y, z] of planePoints(S, m)) {
      const h = M.hitsX(y, z); if (h.length < 2) { miss++; continue; } n++;
      const yy = y - (fam === 'hss' ? m.yc : m.y0), zz = z - (fam === 'hss' ? m.zc : m.z0), gA = yy * F.A.tv + zz * F.A.tp, gB = yy * F.B.tv + zz * F.B.tp;
      const dA = h[0] - (F.supA - gA), dB = (M.ext - h[h.length - 1]) - (F.supB - gB), dL = (h[h.length - 1] - h[0] - gA - gB) - F.Lwp;
      if (Math.abs(dA) > Math.abs(wA)) { wA = dA; pA = [yy, zz]; } if (Math.abs(dB) > Math.abs(wB)) { wB = dB; pB = [yy, zz]; } if (Math.abs(dL) > Math.abs(wL)) wL = dL;
    }
    truthy('end.probe', 'every end-plane probe finds both ends', miss === 0 && n > 0, miss + ' probes missed');
    near('end.A.plane', 'End A face lies on the typed plane (worst of ' + n + ' probes, measured from its long point)', wA, 0, TOL, pA ? 'worst at y ' + pA[0].toFixed(3) + ' z ' + pA[1].toFixed(3) + '; typed side ' + F.A.dv + ' deg, above ' + F.A.dp + ' deg' : '');
    near('end.B.plane', 'End B face lies on the typed plane (worst of ' + n + ' probes, measured from its long point)', wB, 0, TOL, pB ? 'worst at y ' + pB[0].toFixed(3) + ' z ' + pB[1].toFixed(3) + '; typed side ' + F.B.dv + ' deg, above ' + F.B.dp + ' deg' : '');
    near('sp', 'short point reported by the app = the shortest fibre of the piece', r.SP, F.minChord);
    if (st.lenMode !== 'oal') near('len.wp', 'work-point length: the two end planes are the typed length apart on the ' + (fam === 'hss' ? 'tube centreline' : 'heel line'), F.Lwp + wL, F.Lwp);
  }

  // ---- holes
  const tips = { A: st.lenMode === 'oal' ? 0 : F.supA, B: M.ext - (st.lenMode === 'oal' ? 0 : F.supB) };
  const base = fam === 'hss' ? 1 : 0, found = [];
  if (gen != null) near('hole.count', 'number of holes in the solid (topology) = number asked for', gen - base, HO.holes.length, 0, 'app part list: ' + appOk);
  if (text && cls.must === 'export') near('iges.loops', 'IGES inner trim loops = 2 per hole' + (fam === 'hss' ? ' + 2 end rings' : ''), info.inner, 2 * HO.holes.length + (fam === 'hss' ? 2 : 0), 0);
  stats.holes += HO.holes.length;
  for (const h of HO.holes) {
    const tag = 'group ' + h.g + ' ' + h.face + ' ' + (h.slotL ? 'slot ' + h.d + ' x ' + h.slotL + (h.along ? ' along' : ' across') : 'dia ' + h.d) + ', ' + h.dist + ' from End ' + h.ref + ', across ' + h.c;
    const q = measureHole(M, S, m, h, HO.holes, F);
    if (!truthy('hole.present', 'a hole is open in the wall where one was asked for', q.found, tag)) continue;
    found.push({ h, q });
    near('hole.x', 'hole centre: distance along from its reference end', h.ref === 'A' ? q.x - tips.A : tips.B - q.x, h.dist, TOL, tag);
    near('hole.across', 'hole centre: position across the face', q.c, h.c, TOL, tag);
    near('hole.size', 'hole size along the part', q.sx, q.expSx, TOL, tag); near('hole.size', 'hole size across the face', q.sc, q.expSc, TOL, tag);
    if (!h.slotL) truthy('hole.round', 'round hole: the 45-degree diameter matches too', Math.abs(q.diag - h.d) <= TOL && Math.abs(q.diagMid) <= TOL, tag + ' diag ' + q.diag, { expected: h.d, measured: q.diag });
    else truthy('hole.slot.ends', 'slot: both ends are true half-rounds of the slot width', q.endW.every(w => Math.abs(w - h.r * SQ3) <= TOL) && q.endMid.every(v => Math.abs(v) <= TOL), tag + ' end chords ' + q.endW.map(v => (+v).toFixed(4)).join(' / '), { expected: h.r * SQ3, measured: q.endW[0] });
    truthy('hole.through', 'hole goes clean through its wall', q.inNear === 0, tag + ' hits ' + q.thHits.map(v => v.toFixed(3)).join(','));
    if (q.farExpect != null) truthy('hole.onewall', fam === 'hss' ? 'the opposite wall is left uncut' : 'nothing else is cut behind the hole', q.farHits === q.farExpect, tag + ' hits ' + q.thHits.map(v => v.toFixed(3)).join(','));
  }

  // ---- volume (square ends, holes clear of radius and fillet) and weight
  const sqEnds = F.A.sq && F.B.sq;
  const holeVol = (h) => (PI * h.r * h.r + (h.slotL ? (h.slotL - h.d) * h.d : 0)) * (fam === 'hss' ? { T: m.tT, B: m.tB, L: m.tL, R: m.tR }[h.face] : h.face === 'vleg' ? m.tV : m.tH);
  if (sqEnds && cls.must === 'export' && found.length === HO.holes.length) {
    const A = fam === 'hss' ? O.hssArea({ H: m.H, B: m.B, t: m.tT }, m.rc, m.ri) : O.angArea({ a: m.a, b: m.b, t: m.tV }, m.rr), V = A * M.ext - HO.holes.reduce((s, h) => s + holeVol(h), 0);
    near('vol', 'volume = measured section x length - holes', info.volM, V, Math.max(2e-4, V * 1e-5));
  }
  { let Lc = F.Lwp;                                                     // length of the centroid fibre
    if (fam === 'angl') { const A1 = S.a * S.t, A2 = (S.b - S.t) * S.t, yb = (A1 * S.a / 2 + A2 * S.t / 2) / (A1 + A2), zb = (A1 * S.t / 2 + A2 * (S.t + (S.b - S.t) / 2)) / (A1 + A2); Lc += yb * (F.A.tv + F.B.tv) + zb * (F.A.tp + F.B.tp); }
    const noBook = fam === 'hss' && Math.abs(m.rc - 2 * S.t) > 1e-3;        // corner radius is not the book 2t (see NOTES): judge the weight on the section as modelled
    const Abook = fam === 'hss' ? (noBook ? O.hssArea({ H: m.H, B: m.B, t: m.tT }, m.rc, m.ri) : O.hssBookArea(S)) : O.angArea(S, 0), W = O.STEEL * Abook * Lc;
    near('wt', 'weight = steel x ' + (noBook ? 'measured' : 'book') + ' area x centroid length (1 %)', r.wt, W, Math.max(.02, W * .01)); }

  // ---- flat DXF, hole CSV and file name against the solid (cases that went through the IGES round trip)
  if (!text) return finishCase(cs, c);
  try {
    const dt = c._dxfText(), d = parseDxf(dt), nOut = fam === 'hss' ? 1 : 2;
    truthy('dxf.file', 'DXF: inches, no NaN / Infinity', d.insunits === 1 && !/NaN|Infinity/.test(dt) && d.polys.length >= nOut);
    const ents = d.circles.map(q => ({ x: q.x, y: q.y, w: 2 * q.r, h: 2 * q.r })).concat(d.polys.slice(nOut).map(p => { const b = bb2(p.pts); return { x: b.cx, y: b.cy, w: b.w, h: b.h }; }));
    const outs = d.polys.slice(0, nOut).map(p => bb2(p.pts)), dx0 = Math.min(...outs.map(b => b.x0)), dx1 = Math.max(...outs.map(b => b.x1));
    near('dxf.extent', 'DXF outline starts where the solid starts (End A long point)', dx0, M.bb[0][0]); near('dxf.extent', 'DXF outline ends where the solid ends (End B long point)', dx1, M.bb[0][1]);
    if (fam === 'hss') near('dxf.wrap', 'DXF band height = distance around the measured section', outs[0].h, O.wrapLen({ H: m.H, B: m.B }, m.rc));
    else { near('dxf.wrap', 'DXF vertical-leg strip = leg height', outs[0].h, m.a); near('dxf.wrap', 'DXF horizontal-leg strip = leg - thickness', outs[1].h, m.b - m.tV); }
    near('dxf.count', 'DXF hole count = holes asked for', ents.length, HO.holes.length, 0);
    let wp = 0, wsz = 0, wtag = '';
    for (const { h, q } of found) {
      const ex = q.x + M.x0, ey = fam === 'hss' ? outs[0].y0 + O.wrapU({ H: m.H, B: m.B }, m.rc, h.face, q.c) : h.face === 'vleg' ? outs[0].y0 + q.c : outs[1].y0 + q.c - m.tV;
      let b = null; for (const e of ents) { const dd = Math.hypot(e.x - ex, e.y - ey); if (!b || dd < b.dd) b = { e, dd }; }
      if (!b) continue;
      if (b.dd > wp) { wp = b.dd; wtag = h.face + ' at ' + h.dist; }
      wsz = Math.max(wsz, Math.abs(b.e.w - 2 * h.hx), Math.abs(b.e.h - 2 * h.hc));
    }
    if (found.length) { near('dxf.hole.pos', 'DXF hole centres sit where the solid has them (worst)', wp, 0, TOL, wtag); near('dxf.hole.size', 'DXF hole sizes = the sizes asked for (worst)', wsz, 0, TOL); }
  } catch (e) { rec('dxf.file', 'DXF writes', false, { note: String(e && e.message || e).slice(0, 160) }); }

  // ---- hole CSV and file name
  try {
    const rows = c._csvText().split('\n').filter(l => l && l[0] !== '#').slice(1).map(l => l.split(','));
    near('csv.rows', 'hole CSV lists every hole asked for', rows.length, HO.holes.length, 0);
    let w = 0; for (const { h, q } of found) { let b = 1e9; for (const row of rows) if (row[1] === h.face) b = Math.min(b, Math.max(Math.abs(+row[7] - (q.x + M.x0)), Math.abs(+row[4] - h.d), Math.abs(+row[8] - q.c), Math.abs(+row[5] - (h.slotL || 0)), row[10] === 'OK' ? 0 : 9)); w = Math.max(w, b); }
    if (found.length) near('csv.holes', 'hole CSV rows match the solid (x, size, across; worst)', w, 0, TOL + 6e-5);
    const nm = c.fileBase(), mm = nm.match(/_(\d+(?:\.\d+)?)in$/);
    truthy('name.len', 'file name carries the overall length of the solid (to 1/16)', mm && Math.abs(+mm[1] - M.ext) <= 1 / 32 + 1e-6, nm + ' vs ' + M.ext.toFixed(4));
  } catch (e) { rec('csv.rows', 'hole CSV writes', false, { note: String(e && e.message || e).slice(0, 160) }); }

  finishCase(cs, c);
}
/** Would the app really have handed this file over?  _solidFile() refuses a blocked part, a solid that fails the kernel check,
 *  and a solid whose length is more than 0.01 in from calc()'s long-point length.  Those three facts are already known here;
 *  on the targeted cases the real _solidFile() is run as well and has to agree. */
function finishCase(cs, c) {
  const ex = !cs.refuse;
  if (cs.id.startsWith('T-') || cs.id === 'CASE') {
    let real = true, msg = ''; try { c._solidFile(oc, occm, 'igs'); built++; } catch (e) { real = false; msg = String(e && e.message || e); }
    truthy('guard.model', 'the back-test predicts correctly whether the app hands the file over', real === ex, 'app ' + (real ? 'exports' : 'refuses: ' + msg) + ', predicted ' + (ex ? 'export' : 'refusal'));
    if (!real) cs.refuse = msg;
  }
  for (const f of fails) if (f.case === cs.id && f.exported === undefined) { f.exported = !cs.refuse; if (cs.refuse) f.refusal = cs.refuse; }
}

// ------------------------------------------------------------------ cases
const ang = (tv, tp) => ({ mode: 'ang', tvT: String(tv), tpT: String(tp) }), SQE = { mode: 'sq' };
const hg = (id, o) => Object.assign({ id, face: 'T', type: 'cust', ax: 'x', refEnd: 'A', x0T: '3', pT: '3', nT: '1', xsT: '', offT: '0', diaT: '9/16', sllT: '1 1/2', both: false }, o);
const ag = (id, o) => Object.assign({ id, face: 'vleg', type: 'std', bolt: '3/4', ax: 'x', refEnd: 'A', x0T: '3', pT: '3', nT: '1', xsT: '', gT: '1 3/4', diaT: '13/16', both: false }, o);
const LENS = ['12', '6 1/2', "1'-0 1/16", '9.37', '24', "2'", '7 15/16', '10.003', '18 3/8', "1' 3 5/16", '8-1/4', '11.119'];

function sectionCases() {
  const out = [];
  DB.HSS_SIZES.forEach((sz, i) => DB.HSS_WALLS.forEach((w, j) => { const mine = j === i % DB.HSS_WALLS.length; if (QUICK && !mine) return; out.push({ id: 'S-hss-' + sz + '-' + w, fam: 'hss', level: mine && (!QUICK || i % 10 === 0) ? 'iges' : 'direct', patch: { hsize: sz, hwallT: w, lenT: LENS[(i + j) % LENS.length], lenMode: (i + j) % 2 ? 'wp' : 'oal' } }); }));
  DB.ANGLE_SIZES.forEach((sz, i) => DB.ANGLE_THKS.forEach((w, j) => { const mine = j === i % DB.ANGLE_THKS.length; if (QUICK && !mine) return; out.push({ id: 'S-angl-' + sz + '-' + w, fam: 'angl', level: 'iges', patch: { asize: sz, athkT: w, lenT: LENS[(i + 2 * j) % LENS.length], lenMode: (i + j) % 2 ? 'wp' : 'oal' } }); }));
  return out;
}

function targetedCases() {
  const T = [], add = (id, fam, patch, o) => T.push(Object.assign({ id: 'T-' + id, fam, level: 'iges', patch }, o || {}));
  const q = { quick: true };
  // -- baseline sanity
  add('hss-plain-holes', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { face: 'T', x0T: '3', nT: '2', pT: '6' }), hg(2, { face: 'R', type: 'slot', ax: 'y', x0T: '10', offT: '0.25' }), hg(3, { face: 'L', type: 'slot', ax: 'x', refEnd: 'B', x0T: '7 1/2', offT: '-3/8' }), hg(4, { face: 'B', x0T: '20', offT: '1', diaT: '3/8' })] }, q);
  add('angl-plain-holes', 'angl', { asize: '4x3', athkT: '3/8', lenT: "3'-0", lenMode: 'oal', wantHoles: true, groups: [ag(1, { face: 'vleg', gT: '2 1/2', x0T: '1 1/2', nT: '2', pT: '3', both: true }), ag(2, { face: 'hleg', type: 'ssl', bolt: '5/8', ax: 'y', gT: '1 3/4', x0T: '12' }), ag(3, { face: 'hleg', type: 'lsl', bolt: '1/2', ax: 'x', refEnd: 'B', gT: '1 3/4', xsT: '8, 14 1/2' })] }, q);
  // -- end-cut angles, one at a time and together, both signs, both ends, both length modes
  for (const mode of ['oal', 'wp']) for (const end of ['A', 'B']) {
    const e = (x) => end === 'A' ? { A: x, B: SQE } : { A: SQE, B: x };
    for (const [tv, tp] of [[45, 0], [-45, 0], [0, 45], [0, -45], [30, 30], [-30, 20], [0, -2], [0.5, 0], [0, 0.5], [75, 0], [0, -75]]) {
      add('angl-3x3-' + mode + '-' + end + '-v' + tv + 'p' + tp, 'angl', { asize: '3x3', athkT: '1/4', lenT: '24', lenMode: mode, ends: e(ang(tv, tp)) }, tp === -45 && end === 'A' ? q : null);
      if ([0.5, 75].includes(Math.abs(tv)) || [2, 75].includes(Math.abs(tp)) || (tv === -45)) continue;                 // tube builds are slower: a thinner sweep
      add('hss-4x4-' + mode + '-' + end + '-v' + tv + 'p' + tp, 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: mode, ends: e(ang(tv, tp)) }, tv === 30 && tp === 30 && end === 'A' && mode === 'oal' ? q : null);
    }
  }
  add('angl-6x6x1-oal-A-p-1', 'angl', { asize: '6x6', athkT: '1', lenT: '24', lenMode: 'oal', ends: { A: ang(0, -1), B: SQE } }, q);
  add('angl-6x4-oal-both-p', 'angl', { asize: '6x4', athkT: '1/2', lenT: '30', lenMode: 'oal', ends: { A: ang(0, -30), B: ang(0, -30) } });
  add('hss-12x12x5/8-oal-compound-both', 'hss', { hsize: '12x12', hwallT: '5/8', lenT: '60', lenMode: 'oal', ends: { A: ang(45, 45), B: ang(45, 45) } }, q);
  add('hss-6x6x3/8-oal-compound-A', 'hss', { hsize: '6x6', hwallT: '3/8', lenT: '60', lenMode: 'oal', ends: { A: ang(45, 45), B: SQE } });
  add('hss-6x4x3/8-wp-compound-both', 'hss', { hsize: '6x4', hwallT: '3/8', lenT: '40', lenMode: 'wp', ends: { A: ang(-22.5, 60), B: ang(37.5, -15) } });
  add('hss-2x1x1/8-oal-compound', 'hss', { hsize: '2x1', hwallT: '1/8', lenT: '12', lenMode: 'oal', ends: { A: ang(15, -45), B: ang(-60, 5) } });
  // -- an angle over 75 degrees
  add('hss-angle-80', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '60', lenMode: 'wp', ends: { A: ang(80, 0), B: SQE } }, q);
  add('angl-angle-80', 'angl', { asize: '3x3', athkT: '1/4', lenT: '60', lenMode: 'oal', ends: { A: SQE, B: ang(80, 0) } });
  // -- lengths: barely longer than the end cuts, crossing, 40 ft
  add('hss-barely', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '8.1', lenMode: 'oal', ends: { A: ang(45, 0), B: ang(45, 0) } });
  add('hss-ends-cross', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '7.9', lenMode: 'oal', ends: { A: ang(45, 0), B: ang(45, 0) } });
  add('hss-oal-shorter-than-cuts', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '3', lenMode: 'oal', ends: { A: ang(45, 0), B: ang(45, 0) } });
  add('angl-barely-wp', 'angl', { asize: '4x4', athkT: '3/8', lenT: '4 1/16', lenMode: 'wp', ends: { A: ang(-45, 0), B: ang(0, 0) } });
  add('angl-ends-cross-wp', 'angl', { asize: '4x4', athkT: '3/8', lenT: '3 15/16', lenMode: 'wp', ends: { A: ang(-45, 0), B: SQE } });
  add('angl-parallel-miters-short', 'angl', { asize: '3x3', athkT: '1/4', lenT: '2', lenMode: 'wp', ends: { A: ang(45, 0), B: ang(-45, 0) } }, q);
  add('angl-parallel-miters-long', 'angl', { asize: '3x3', athkT: '1/4', lenT: '24', lenMode: 'oal', ends: { A: ang(45, 0), B: ang(-45, 0) } });
  add('hss-parallel-miters-short', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '2', lenMode: 'wp', ends: { A: ang(45, 0), B: ang(-45, 0) } });
  add('hss-40ft', 'hss', { hsize: '16x12', hwallT: '5/8', lenT: "40'", lenMode: 'oal', ends: { A: ang(0, 30), B: SQE }, wantHoles: true, groups: [hg(1, { face: 'T', diaT: '1 1/4', x0T: "12'-6 3/8", refEnd: 'B' }), hg(2, { face: 'L', type: 'slot', diaT: '13/16', sllT: '2', ax: 'y', x0T: "39'-0 1/16", offT: '-2 1/2' })] });
  add('angl-40ft', 'angl', { asize: '8x8', athkT: '1', lenT: "40'-0", lenMode: 'wp', wantHoles: true, groups: [ag(1, { face: 'vleg', bolt: '1', gT: '4 1/2', x0T: '2', nT: '2', pT: '3', both: true }), ag(2, { face: 'hleg', bolt: '1 1/4', type: 'ovs', gT: '4 1/2', xsT: "20'-0, 39'-6 7/16" })] });
  add('hss-len-decimal', 'hss', { hsize: '3x2', hwallT: '3/16', lenT: '37.413', lenMode: 'wp', ends: { A: ang(0, 22.5), B: ang(-22.5, 0) } });
  // -- hole lists
  add('hss-list-spaces', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { xsT: '3 9 15' })] }, q);
  add('hss-list-typo', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { xsT: '3, 9, 15 1/2x' })] }, q);
  add('angl-list-unit', 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, { xsT: '6, 12, 18x' })] });   // ("18in" is now read as 18 inches, so the unreadable entry is 18x)
  add('hss-list-ok', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { xsT: '3; 9 1/2, 15-1/4 ,20.125, 2\'-6"', both: true })] });
  add('hss-31-both', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: "20'", lenMode: 'oal', wantHoles: true, groups: [hg(1, { x0T: '2', pT: '1 1/2', nT: '31', both: true })] }, { calcOnly: QUICK, quick: true });
  add('hss-61-list', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: "20'", lenMode: 'oal', wantHoles: true, groups: [hg(1, { xsT: Array.from({ length: 61 }, (_, i) => String(3 + 2 * i)).join(', ') })] }, { calcOnly: true, quick: true });
  add('angl-35-both', 'angl', { asize: '3x3', athkT: '1/4', lenT: "20'", lenMode: 'oal', wantHoles: true, groups: [ag(1, { x0T: '2', pT: '2', nT: '35', both: true })] }, { calcOnly: true });
  add('hss-61-count', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: "20'", lenMode: 'oal', wantHoles: true, groups: [hg(1, { x0T: '2', pT: '2', nT: '61' })] }, { calcOnly: true });
  // -- blank / unreadable boxes
  const blanks = [['x0-blank', { x0T: '' }], ['x0-text', { x0T: 'abc' }], ['spacing-text', { nT: '3', pT: 'x' }], ['dia-blank', { diaT: '' }], ['dia-zero', { diaT: '0' }], ['offset-text', { offT: 'left' }], ['slotlen-blank', { type: 'slot', sllT: '' }], ['count-zero', { nT: '0' }], ['count-blank', { nT: '' }], ['slot-shorter-than-wide', { type: 'slot', diaT: '1', sllT: '1/2' }]];
  for (const [nm, o] of blanks) add('hss-' + nm, 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, o)] }, nm === 'x0-blank' ? q : null);
  for (const [nm, o] of [['gauge-blank', { gT: '' }], ['gauge-text', { gT: 'std' }], ['custdia-blank', { type: 'cust', diaT: '' }], ['x0-blank', { x0T: '' }]]) add('angl-' + nm, 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, o)] });
  for (const [nm, L] of [['blank', ''], ['text', 'abc'], ['zero', '0'], ['negative', '-5']]) add('hss-len-' + nm, 'hss', { hsize: '4x4', hwallT: '1/4', lenT: L, lenMode: 'oal' });
  // -- holes at the limits
  add('hss-hole-into-plan-miter', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', ends: { A: ang(0, 60), B: SQE }, wantHoles: true, groups: [hg(1, { face: 'T', x0T: '3.05', offT: '1/2' })] }, q);
  add('hss-hole-into-side-miter', 'hss', { hsize: '6x4', hwallT: '1/4', lenT: '36', lenMode: 'wp', ends: { A: SQE, B: ang(-45, 0) }, wantHoles: true, groups: [hg(1, { face: 'R', refEnd: 'B', diaT: '1', x0T: '0.62', offT: '0' })] });
  add('hss-hole-clear-of-plan-miter', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', ends: { A: ang(0, 60), B: SQE }, wantHoles: true, groups: [hg(1, { face: 'T', x0T: '3 3/4', offT: '1/2' })] });
  add('angl-hole-into-miter', 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', ends: { A: ang(45, 0), B: SQE }, wantHoles: true, groups: [ag(1, { face: 'vleg', gT: '1 3/4', x0T: '1.74' })] }, q);
  add('angl-hole-clear-of-miter', 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', ends: { A: ang(45, 0), B: SQE }, wantHoles: true, groups: [ag(1, { face: 'vleg', gT: '1 3/4', x0T: '2 1/2' })] });
  add('angl-vleg-hole-in-heel', 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, { face: 'vleg', gT: '1/2', x0T: '3' })] }, q);
  add('angl-hleg-hole-in-heel', 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, { face: 'hleg', gT: '1/2', x0T: '3' })] });
  add('angl-vleg-hole-in-fillet', 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, { face: 'vleg', gT: '3/4', x0T: '3' })] });
  add('angl-hole-off-toe', 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, { face: 'vleg', gT: '2 3/4', x0T: '3' })] });
  add('hss-hole-near-radius', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { face: 'T', offT: '1.16' }), hg(2, { face: 'L', offT: '-1.16', x0T: '9' })] });
  add('hss-hole-in-radius', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { face: 'T', offT: '1 5/16' })] });
  add('hss-seam-centre', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { face: 'B', offT: '0' })] });
  add('hss-seam-beside', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { face: 'B', offT: '0.2913' }), hg(2, { face: 'B', offT: '-0.2913', x0T: '8' }), hg(3, { face: 'B', type: 'slot', ax: 'y', offT: '0.8', x0T: '14', sllT: '1' })] });
  add('hss-near-end', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { face: 'T', x0T: '0.4', both: true }), hg(2, { face: 'R', type: 'slot', ax: 'x', x0T: '0.86', refEnd: 'B' })] });
  add('hss-through-pairs', 'hss', { hsize: '6x4', hwallT: '5/16', lenT: '30', lenMode: 'wp', wantHoles: true, groups: [hg(1, { face: 'L', x0T: '1 1/2', both: true }), hg(2, { face: 'R', x0T: '1 1/2', both: true }), hg(3, { face: 'T', x0T: '15', offT: '3/4', diaT: '1' }), hg(4, { face: 'B', x0T: '15', offT: '3/4', diaT: '1' })] });
  add('hss-side-holes-thick-wall', 'hss', { hsize: '8x8', hwallT: '5/8', lenT: '24', lenMode: 'oal', wantHoles: true, groups: [hg(1, { face: 'L', x0T: '6', diaT: '13/16' }), hg(2, { face: 'R', x0T: '6', diaT: '13/16' }), hg(3, { face: 'T', x0T: '12', diaT: '13/16' }), hg(4, { face: 'B', x0T: '12', diaT: '13/16', offT: '1' })] });
  add('hss-both-centre', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { x0T: '18', both: true })] });
  add('angl-amode-flags-ignored', 'angl', { asize: '4x4', athkT: '3/8', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, { x0T: '5', gT: '2 1/2', amode: 'off', autoG: true, autoY: true })] });
  add('hss-bothF-ignored', 'hss', { hsize: '4x4', hwallT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [hg(1, { x0T: '5', bothF: true })] });
  add('angl-bothF-ignored', 'angl', { asize: '3x3', athkT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, { x0T: '5', bothF: true })] });
  add('hss-dia-forms', 'hss', { hsize: '8x8', hwallT: '3/8', lenT: '48', lenMode: 'oal', wantHoles: true, groups: [hg(1, { diaT: '0.531', x0T: '4' }), hg(2, { diaT: '17/32', x0T: '8', face: 'R' }), hg(3, { diaT: '.75', x0T: '12', face: 'L' }), hg(4, { diaT: '1-1/4', x0T: '16', offT: '-1 1/2' }), hg(5, { diaT: '2"', x0T: '24', face: 'B', offT: '2.25' })] });
  // -- AISC J3.3 bolt holes on an angle: every bolt, every hole type
  const bolts = ['1/2', '5/8', '3/4', '7/8', '1', '1 1/8', '1 1/4'];
  add('angl-j33-std-ovs', 'angl', { asize: '8x8', athkT: '1/2', lenT: '72', lenMode: 'oal', wantHoles: true, groups: bolts.map((b, i) => ag(i + 1, { face: 'vleg', bolt: b, type: 'std', gT: '4 1/2', x0T: String(4 + 4.5 * i) })).concat(bolts.map((b, i) => ag(i + 8, { face: 'hleg', bolt: b, type: 'ovs', gT: '4 1/2', x0T: String(4 + 4.5 * i), refEnd: 'B' }))) });
  add('angl-j33-slots', 'angl', { asize: '8x8', athkT: '1/2', lenT: '72', lenMode: 'oal', wantHoles: true, groups: bolts.map((b, i) => ag(i + 1, { face: 'vleg', bolt: b, type: i % 2 ? 'ssl' : 'lsl', ax: i % 3 ? 'x' : 'y', gT: '4 1/2', x0T: String(5 + 9 * i) })).concat(bolts.map((b, i) => ag(i + 8, { face: 'hleg', bolt: b, type: i % 2 ? 'lsl' : 'ssl', ax: i % 3 ? 'y' : 'x', gT: '4 1/2', x0T: String(5 + 9 * i) }))) });
  return T.filter(t => !QUICK || t.quick);
}

/** Random valid parts: every end-cut kind and sign, both length modes, holes on every face. */
function randomCase(k, rnd) {
  const fam = k % 2 ? 'angl' : 'hss', sizes = fam === 'hss' ? DB.HSS_SIZES : DB.ANGLE_SIZES, walls = fam === 'hss' ? DB.HSS_WALLS : DB.ANGLE_THKS, j = Math.floor(k / 2);
  const size = sizes[(j * 7 + 3) % sizes.length]; let wall = walls[(j * 3 + 1) % walls.length];
  const mk = (w) => fam === 'hss' ? { hsize: size, hwallT: w } : { asize: size, athkT: w };
  // keep the random parts on real stock (the section sweep covers the walls the form clamps)
  let S = O.nominal(fam, mk(wall));
  while (walls.indexOf(wall) > 0 && (fam === 'hss' ? S.t > Math.min(S.H, S.B) / 6 : S.t > Math.min(S.a, S.b) / 4)) { wall = walls[walls.indexOf(wall) - 1]; S = O.nominal(fam, mk(wall)); }
  const p = Object.assign(mk(wall), { lenMode: (j + (k >> 3)) % 2 ? 'wp' : 'oal' });
  const ANGS = [.5, 5, 10, 15, 22.5, 30, 37.5, 45, 60, 67.5, 75], KINDS = ['sq', 'v', 'p', 'vp'];
  const mkEnd = (kind, n) => { const a1 = ANGS[(n * 5 + j) % ANGS.length] * (rnd.chance(.5) ? 1 : -1), a2 = ANGS[(n * 3 + 2 * j + 4) % ANGS.length] * (rnd.chance(.5) ? 1 : -1); return kind === 'sq' ? { mode: 'sq' } : kind === 'v' ? ang(a1, 0) : kind === 'p' ? ang(0, a1) : ang(a1, a2); };
  p.ends = { A: mkEnd(KINDS[j % 4], j), B: mkEnd(KINDS[(j >> 2) % 4], j + 5) };
  const rcG = fam === 'hss' ? 2 * S.t : 0;
  let F = O.frame(S, Object.assign({ lenT: '100' }, p), rcG);
  const cls = ['short', 'medium', 'barely', 'medium', 'long', 'medium', 'short', 'xlong'][(j + (k >> 4)) % 8];
  const D = F.Lwp - F.minChord, minChord = cls === 'barely' ? rnd.range(.08, .4) : cls === 'short' ? rnd.range(1.5, 6) : cls === 'medium' ? rnd.range(8, 60) : cls === 'long' ? rnd.range(80, 240) : 0;
  let typed = cls === 'xlong' ? (rnd.chance(.5) ? 480 : 479.9375) : (p.lenMode === 'oal' ? minChord + D + F.supA + F.supB : minChord + D);
  if (cls === 'xlong' && p.lenMode === 'wp') typed -= Math.ceil(F.supA + F.supB);
  typed = Math.min(typed, 480);
  const form = rnd.int(7);
  if (form === 2) p.lenT = (Math.ceil(typed * 1000) / 1000).toFixed(3); else if (form === 4) p.lenT = (Math.ceil(typed * 10000 - 1e-6) / 10000).toFixed(4);
  else { const v = Math.ceil(typed * 16 - 1e-9) / 16; p.lenT = form === 1 ? O.ftin(v) : form === 5 ? O.ftin(v).replace("'-", "' ") : form === 6 ? O.fr(v) + '"' : form === 3 ? O.fr(v).replace(' ', '-') : O.fr(v); }
  F = O.frame(S, p, rcG);
  // ---- holes
  if (cls !== 'barely' && rnd.chance(.72)) {
    const groups = [], placed = [], want = rnd.chance(.65) ? 1 : 2, faces = fam === 'hss' ? ['T', 'B', 'L', 'R'] : ['vleg', 'hleg'];
    const num = (v) => rnd.chance(.6) ? O.fr(v) : String(+v.toFixed(3));
    for (let gi = 0, tries = 0; groups.length < want && tries < 14 && placed.length < 5; tries++) {
      const face = faces[(j + gi + tries) % faces.length], g = { id: groups.length + 1, face, refEnd: rnd.chance(.5) ? 'A' : 'B', ax: rnd.chance(.5) ? 'x' : 'y' };
      let d, slotL = 0, c, lo, hi;
      if (fam === 'hss') {
        const W = face === 'T' || face === 'B' ? S.B : S.H, hw = W / 2 - 2 * S.t - .08; if (hw < .14) continue;
        const ds = [.25, .3125, .375, .4375, .5625, .6875, .8125, 1, 1.25, .531, 2].filter(v => v / 2 <= hw - .02); d = rnd.pick(ds);
        g.type = rnd.chance(.3) ? 'slot' : 'cust'; g.diaT = d === .531 ? '0.531' : O.fr(d);
        if (g.type === 'slot') { slotL = d + rnd.pick([.25, .5, .9375, 1.5]); if (g.ax === 'y' && slotL / 2 > hw - .02) g.ax = 'x'; g.sllT = O.fr(slotL); }
        const hc = slotL && g.ax === 'y' ? slotL / 2 : d / 2, room = hw - hc;
        if (face === 'B') { if (room < hc + .04) continue; const mag = Math.ceil(rnd.range(hc + .04, room) * 16) / 16; if (mag > room) continue; c = mag * (rnd.chance(.5) ? 1 : -1); }
        else c = Math.trunc(rnd.range(-room, room) * 16) / 16;
        g.offT = O.fr(c);
      } else {
        const leg = face === 'vleg' ? S.a : S.b; lo = S.t + .75 * S.t + .125 + .03; hi = leg - .06; const wz = hi - lo; if (wz < .22) continue;
        const opts = [];
        for (const b of Object.keys(O.J33)) for (const [ty, ix] of [['std', 0], ['std', 0], ['ovs', 1], ['ovs', 1], ['ssl', 2], ['lsl', 3]]) { const dd = ix < 2 ? O.J33[b][ix] : O.J33[b][0], sl = ix >= 2 ? O.J33[b][ix] : 0; for (const ax of ['x', 'y']) { const hc = sl && ax === 'y' ? sl / 2 : dd / 2; if (2 * hc <= wz) opts.push({ b, ty, ax, dd, sl }); } }
        if (opts.length && rnd.chance(.85)) { const o = rnd.pick(opts); g.type = o.ty; g.bolt = o.b; g.ax = o.ax; d = o.dd; slotL = o.sl; }
        else { d = Math.max(.1875, Math.floor(wz * .6 * 16) / 16); if (d > wz) continue; g.type = 'cust'; g.diaT = O.fr(d); }
        const hc = slotL && g.ax === 'y' ? slotL / 2 : d / 2, std = O.ANGLE_GAGE[leg];
        if (std && std - hc >= lo && std + hc <= hi && rnd.chance(.35)) c = std; else { c = Math.ceil(rnd.range(lo + hc, hi - hc) * 16) / 16; if (c + hc > hi) c = lo + hc + (hi - hc - lo - hc) / 2; }
        g.gT = Number.isInteger(c * 16) ? O.fr(c) : String(+c.toFixed(4));
      }
      const hx = slotL && g.ax === 'x' ? slotL / 2 : d / 2, hc = slotL && g.ax === 'y' ? slotL / 2 : d / 2;
      // stretch of this face that is clear of both end cuts
      let zlo = -1e9, zhi = 1e9;
      for (const cc of [c - hc, c + hc]) for (const dep of [0, S.t]) { const q0 = O.facePoint(S, face, 0, cc, dep); zlo = Math.max(zlo, F.xA(q0[1], q0[2])); zhi = Math.min(zhi, F.xB(q0[1], q0[2])); }
      zlo += hx + .45; zhi -= hx + .45; if (zhi - zlo < .2) continue;
      const fromA = g.refEnd === 'A', dlo = Math.max(fromA ? zlo - F.dA : F.dB - zhi, .25), dhi = fromA ? zhi - F.dA : F.dB - zlo; if (dhi - dlo < .1) continue;
      let ds;
      if (rnd.chance(.3)) {                                            // exact spots
        ds = []; let v = Math.ceil(rnd.range(dlo, dlo + (dhi - dlo) * .4) * 16) / 16; const n = Math.min(1 + rnd.int(3), 5 - placed.length);
        for (let i = 0; i < n && v <= dhi; i++) { ds.push(v); v += Math.ceil((2 * hx + rnd.range(.5, 6)) * 16) / 16; }
        if (!ds.length) continue; g.xsT = ds.map(num).join(rnd.chance(.3) ? '; ' : ', ');
      } else {
        const x0 = Math.ceil(rnd.range(dlo, dlo + (dhi - dlo) * .35) * 16) / 16, sp = Math.ceil((2 * hx + rnd.range(.5, 8)) * 8) / 8; let n = Math.min(1 + rnd.int(3), 5 - placed.length);
        while (n > 1 && x0 + (n - 1) * sp > dhi) n--; if (x0 > dhi) continue;
        ds = Array.from({ length: n }, (_, i) => x0 + i * sp); g.x0T = num(x0); g.pT = O.fr(sp); g.nT = String(n); g.xsT = '';
        // same pattern from both ends when it fits without the two sets meeting
        const olo = Math.max(fromA ? F.dB - zhi : zlo - F.dA, .25), ohi = fromA ? F.dB - zlo : zhi - F.dA, last = ds[ds.length - 1];
        if (rnd.chance(.35) && 2 * n + placed.length <= 6 && x0 >= olo && last <= ohi && last + hx + .4 < (F.dB - F.dA) / 2) g.both = true;
      }
      const xsA = ds.map(v => fromA ? F.dA + v : F.dB - v), xs = g.both ? xsA.concat(xsA.map(x => F.dA + F.dB - x)) : xsA;
      if (xs.some(x => placed.some(q => (fam === 'angl' || q.face === face) && Math.abs(q.x - x) < q.hx + hx + .35 && Math.abs(q.c - c) < q.hc + hc + .35))) continue;
      for (const x of xs) placed.push({ face, x, c, hx, hc });
      groups.push(fam === 'hss' ? hg(g.id, g) : ag(g.id, g)); gi++;
    }
    if (groups.length) { p.wantHoles = true; p.groups = groups; }
  }
  return { id: 'R-' + String(k).padStart(3, '0') + '-' + fam + '-' + size + 'x' + wall + '-' + cls, fam, level: 'iges', patch: p, expect: undefined };
}

// ------------------------------------------------------------------ the standard-gauge button (angle)
async function gaugeButton() {
  cur = { id: 'G-angle-std-gauge', fam: 'angl', patch: {}, nfail: 0 };
  const seen = new Set(), missing = [];
  for (const sz of DB.ANGLE_SIZES) for (const face of ['vleg', 'hleg']) {
    const S = O.angNominal({ asize: sz, athkT: '1/4' }), leg = face === 'vleg' ? S.a : S.b; if (seen.has(leg + face)) continue; seen.add(leg + face);
    const patch = { asize: sz, athkT: '1/4', lenT: '36', lenMode: 'oal', wantHoles: true, groups: [ag(1, { face, gT: '9' })] }; cur.patch = patch;
    const c = await formOf('angl', expand('angl', patch)), v = c.renderVals().groups[0];
    if (!v.hasStdG) { missing.push(leg); continue; }
    v.setStdG();
    near('gauge.std', 'the "Std" gauge button sets the AISC workable gauge for a ' + leg + ' in ' + face, O.num(c.state.groups[0].gT), O.ANGLE_GAGE[leg], 1e-9);
  }
  if (missing.length) notes.push('Angle "Std" gauge button is not offered for legs ' + [...new Set(missing)].join(', ') + ' in (AISC Table 1-7A lists ' + [...new Set(missing)].map(l => O.fr(O.ANGLE_GAGE[l])).join(', ') + ').');
}

// ------------------------------------------------------------------ run
function selfTest() {
  cur = { id: 'oracle-self-test', fam: '-', patch: {}, nfail: 0 };
  const ok = (a, b) => Math.abs(a - b) < 1e-12;
  truthy('oracle.self', 'the oracle reads and writes shop dimensions consistently', ok(O.num("12'-6 3/8"), 150.375) && ok(O.num('1-1/2'), 1.5) && ok(O.num('.375'), .375) && ok(O.num("40'"), 480) && ok(O.num('2\'-6"'), 30) && O.num('3 9 15') === null && O.num('18in') === null && O.num('') === null && O.fr(2.4375) === '2 7/16' && O.ftin(150.375) === "12'-6 3/8" && ok(O.num(O.ftin(479.9375)), 479.9375) && ok(O.sup({ fam: 'hss', H: 4, B: 4 }, 1, 0, .5), 2) && ok(O.sup({ fam: 'angl', a: 3, b: 3, t: .25 }, 0, -1, 0), 0) && ok(O.sup({ fam: 'angl', a: 3, b: 3, t: .25 }, 1, 1, 0), 3.25));
}
let cases = [];
if (opt('case', '')) { const j = JSON.parse(opt('case', '')); cases = [Object.assign({ id: 'CASE', level: 'iges' }, j)]; }
else {
  const rnd = O.rng(SEED);
  cases = sectionCases().concat(targetedCases()); for (let k = 0; k < NRAND; k++) cases.push(randomCase(k, rnd));
  if (ONLY) cases = cases.filter(c => ONLY.test(c.id));
}
function finish() {
  const secs = (Date.now() - T0) / 1000, by = new Map();
  for (const f of fails) { if (!by.has(f.check)) by.set(f.check, []); by.get(f.check).push(f); }
  console.log('\nbt-box  ' + (QUICK ? 'quick' : 'full') + '  seed ' + SEED + '  ' + secs.toFixed(0) + ' s');
  console.log('oracle verdicts: ' + stats.mustExport + ' must export, ' + stats.mustBlock + ' must be blocked, ' + stats.either + ' borderline (either is acceptable)');
  console.log('cases ' + stats.cases + ': ' + stats.exported + ' built and measured (' + stats.iges + ' through the IGES round trip, ' + stats.direct + ' on the built solid), ' + stats.blocked + ' refused up front by the app, ' + stats.calcOnly + ' part-list only; ' + stats.guard + ' of the built parts would be refused by the app\'s own length guard; ' + stats.holes + ' holes probed' + (stats.engine ? '; ' + stats.engine + ' engine errors' : ''));
  if (fails.length) {
    console.log('\nFAILURES (' + fails.length + ') - grouped by check.  Repro: c = await freshApp(); c.pickFam(fam)(); c.setState(patch laid over defEnd()/defGroup(), see file header)');
    for (const [id, list] of by) {
      console.log('\n[' + id + '] ' + list.length + ' failure(s)');
      for (const f of list) {
        const num = f.expected !== undefined ? '  expected ' + fmt(f.expected) + '  measured ' + fmt(f.measured) + (typeof f.delta === 'number' ? '  (' + (f.delta >= 0 ? '+' : '') + f.delta.toFixed(5) + ')' : '') : '';
        console.log('  ' + f.case + ': ' + f.title + num + (f.note ? '  [' + f.note + ']' : '') + (f.exported === true ? '  {FILE EXPORTED}' : f.exported === false ? '  {no file: ' + (f.refusal || 'blocked') + '}' : ''));
        console.log('      fam=' + f.fam + ' patch=' + JSON.stringify(f.patch));
      }
    }
  }
  if (flag('times')) { console.log('\nSLOWEST CASES'); for (const c of cases.slice().sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 25)) console.log('  ' + String(c.ms).padStart(6) + ' ms  ' + c.id); const tot = {}; for (const c of cases) { const k = c.id.slice(0, 1) + '-' + c.fam; tot[k] = (tot[k] || 0) + (c.ms || 0); } console.log('  by group (ms): ' + JSON.stringify(tot)); }
  if (notes.length) { console.log('\nNOTES'); for (const n of notes) console.log('  - ' + n); }
  const jf = opt('json', '');
  if (jf) { mkdirSync(path.dirname(jf), { recursive: true }); writeFileSync(jf, JSON.stringify({ suite: 'bt-box', mode: QUICK ? 'quick' : 'full', seed: SEED, seconds: Math.round(secs), stats, passed: pass, failed: fail, repro: "c = await freshApp(); c.pickFam(fam)(); c.setState(state)", failures: fails.map(f => Object.assign({}, f, { state: expand(f.fam === '-' ? 'hss' : f.fam, f.patch) })), notes }, null, 1)); }
  if (by.size) { console.log('\nFAILED CHECKS (count, of which file exported / refused by the app)'); for (const [id, list] of [...by].sort((a, b) => b[1].length - a[1].length)) console.log('  ' + String(list.length).padStart(4) + '  ' + String(list.filter(f => f.exported === true).length).padStart(4) + ' / ' + String(list.filter(f => f.exported === false).length).padEnd(4) + ' ' + id.padEnd(18) + TITLE[id]); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

selfTest();
let done = 0;
for (const cs of cases) {
  const t1 = Date.now();
  try { await runCase(cs); } catch (e) { stats.engine++; rec('case.crash', 'the case runs to the end', false, { note: String(e && e.stack || e).slice(0, 300) }); if (/abort|unreachable|memory|BindingError|RuntimeError/i.test(String(e))) await reloadEngine(); }
  cs.state = cs.meas = undefined; cs.ms = Date.now() - t1;
  if (built > 400) await reloadEngine();                               // the kernel never frees; start clean now and then
  if (++done % 50 === 0 && !VERBOSE) process.stderr.write('  ' + done + '/' + cases.length + ' cases, ' + ((Date.now() - T0) / 1000).toFixed(0) + ' s, ' + fail + ' failed\n');
}
if (!opt('case', '') && !ONLY) await gaugeButton();
// corner radius / fillet rule seen across the sweep (a question for the shop, not a pass/fail)
{ const odd = [], rr = [];
  for (const [k, m] of secCache) { if (!m || !m.ok) continue; const [fam, size, wall] = k.split('|'), t = O.num(wall);
    if (fam === 'hss') { if (Math.abs(m.rc - 2 * t) > 1e-3 && Math.abs(Math.min(m.tT, m.tB) - t) < 1e-3) odd.push(size + 'x' + wall + ': R ' + m.rc.toFixed(3) + ' = ' + (m.rc / t).toFixed(2) + 't' + (m.ri < 1e-3 ? ', inside corner SHARP' : ', inside r ' + m.ri.toFixed(3))); }
    else rr.push(m.rr / m.tV); }
  const nh = [...secCache.keys()].filter(k => k.startsWith('hss')).length;
  if (nh) notes.push('HSS outside corner radius: 2.00 x wall on ' + (nh - odd.length) + ' of ' + nh + ' size/wall combinations measured; inside radius = outside - wall.' + (odd.length ? ' Not 2t on: ' + odd.join('; ') : ''));
  if (rr.length) notes.push('Angle root fillet in the solid: ' + Math.min(...rr).toFixed(2) + ' to ' + Math.max(...rr).toFixed(2) + ' x thickness; toes and heel are sharp.'); }
finish();
