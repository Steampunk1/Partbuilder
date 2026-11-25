// Back-test: ROUND parts (pipe + round tube) - does the exported file hold the geometry that was typed?
//
//   node test/bt-round.mjs            full sweep  (about 6 min alone on the machine, 9 min with it shared; one process)
//   node test/bt-round.mjs --quick    routine run (under about 60 s)
//   options:  --only=<text>   run only cases whose id contains <text>
//             --seed=<n>      seed of the sampler (default 20261125; the case list is deterministic per seed)
//             --json=<file>   write the machine-readable failure list there
//             --all           print every failure (default: first 30 per check, all of them go to --json)
//             --list          print the case ids and stop
//
// Oracle: test/bt-round-oracle.mjs works every expected number out from the typed inputs (ASME B36.10 table,
// trig, cylinder/cylinder intersection). No app geometry function is called to get an expected value.
// Measured: (L1) calc() numbers + the flat DXF / CSV text, (L2) the IGES the real export path writes
// (_solidFile -> writeIges), read back with readBack and measured with the kernel, plus this suite's own
// IGES reader (test/bt-round-iges.mjs).
//
// The IGES is measured two ways, because the file carries every trim edge twice (IGES 142: a model-space
// curve C and a parameter-space curve B on the surface, flagged "either may be used"):
//   rtA = readBack of the file exactly as written (the kernel's reader takes the parameter-space trims)
//   rtB = readBack of the same file with the flag set to "model-space curve preferred"
// A failing case prints the state patch that reproduces it:  c = await freshApp(); applyPatch(c, patch)
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadOcc } from './_occ.mjs';
import { freshApp, Component, DB } from './_load.mjs';
import * as occm from '../occ-solid.js';
import { parseDxf, bbox as bbox2 } from './_geom.mjs';
import * as O from './bt-round-oracle.mjs';
import * as IG from './bt-round-iges.mjs';

const argv = process.argv.slice(2), arg = (k, d) => { const a = argv.find(s => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const QUICK = argv.includes('--quick'), ALL = argv.includes('--all'), LIST = argv.includes('--list'), ONLY = arg('only', ''), SEED = parseInt(arg('seed', '20261125'), 10), JSON_OUT = arg('json', '');
const { PI, RAD } = O, TOL = 1e-3, T0 = Date.now();
// Saddle cuts get 0.002 in: the solid's saddle curve is a smooth B-spline through 361 points (1 deg apart) of a cut
// function that has a slope break where the governing wall radius switches from bore to OD; the spline rounds that
// break off (worst seen 0.0015 in on a 24 in pipe saddled at 20 deg). Everything else is held to 0.001 in.
const STOL = 2e-3;

// ------------------------------------------------------------------ bookkeeping
let pass = 0, fail = 0; const fails = [], byCheck = {}, notes = [], stats = {};
let cur = null;                                           // the case being run
function rec(id, ok, d) {
  const b = byCheck[id] || (byCheck[id] = { pass: 0, fail: 0 });
  if (ok) { pass++; b.pass++; return true; }
  fail++; b.fail++;
  fails.push(Object.assign({ check: id, case: cur ? cur.id : '-', level: cur ? cur.level : '-', patch: cur ? cur.patch : null }, d || {}));
  return false;
}
const near = (id, measured, expected, tol, what) => rec(id, Number.isFinite(measured) && Math.abs(measured - expected) <= tol, { what, expected: +(+expected).toFixed(6), measured: Number.isFinite(measured) ? +(+measured).toFixed(6) : String(measured), tol });
const stat = (k, v) => { const s = stats[k] || (stats[k] = { n: 0, max: -Infinity, at: '' }); s.n++; if (v > s.max) { s.max = v; s.at = cur ? cur.id : ''; } };
const f4 = (v) => (+v).toFixed(4), f5 = (v) => (+v).toFixed(5);

// ------------------------------------------------------------------ spec -> what gets typed into the form
function endPatch(e) {
  if (!e || e.mode === 'sq') return { mode: 'sq' };
  if (e.mode === 'miter') return { mode: 'miter', maT: e.angT != null ? e.angT : String(e.ang), mrT: e.rotT != null ? e.rotT : String(e.rot) };
  const p = { mode: 'saddle', sdSeat: e.seat, sdAT: e.angT != null ? e.angT : String(e.ang), sdRT: String(e.roll) };
  if (e.hdr) Object.assign(p, { sdHT: 'nps', sdN: e.hdr.nps, sdS: e.hdr.sch }); else Object.assign(p, { sdHT: 'cust', sdHodT: e.hodT, sdHwT: e.hwT });
  return p;
}
function groupPatch(g) {
  const st = g.style || 'frac', T = (v) => O.typed(v, Number.isInteger(v * 16) ? st : 'dec');
  const p = { type: g.type, refEnd: g.ref, both: !!g.both, azT: String(g.az0), aznT: String(g.azn), azpT: String(g.azp) };
  if (g.type === 'cust') p.diaT = g.diaT != null ? g.diaT : T(g.dia); else { p.bnps = g.bnps; p.bsch = g.bsch || 'STD'; }
  if (g.xs && g.xs.length) p.xsT = g.xsT != null ? g.xsT : g.xs.map(T).join(', '); else { p.xsT = ''; p.x0T = T(g.x0); p.pT = T(g.pitch); p.nT = String(g.n); }
  return p;
}
function toPatch(spec) {
  const p = { family: spec.fam, lenMode: spec.lenMode, lenT: spec.lenT != null ? spec.lenT : O.typed(spec.len, spec.lenStyle || 'dec') };
  if (spec.fam === 'pipe') { p.pnps = spec.nps; p.psch = spec.sch; } else { p.todT = spec.odT; p.twallT = spec.wallT; }
  if (spec.mat) p.mat = spec.mat;
  p.ends = { A: endPatch(spec.A), B: endPatch(spec.B) };
  if (spec.holes && spec.holes.length) { p.wantHoles = true; p.groups = spec.holes.map(groupPatch); }
  return p;
}
/** Put a patch on a form: scalars as typed, each end and each hole group over the app's own defaults. */
function applyPatch(c, p) {
  const { ends, groups, ...flat } = p;
  c.setState(flat);
  if (ends) c.setState((s) => ({ ends: { A: Object.assign({}, s.ends.A, ends.A), B: Object.assign({}, s.ends.B, ends.B) } }));
  if (groups) c.setState({ groups: groups.map((g, i) => Object.assign(Component.defGroup(i + 1, p.family || 'pipe'), g)) });
  return c;
}
const MATF = { A106B: 1, A53B: 1, A500B: 1, '304L': 1.013, '316L': 1.02, AL6061: 0.345 };
function finishSpec(spec) {
  if (spec.fam === 'pipe') { spec.od = O.B36_OD[spec.nps]; spec.t = O.B36_WALL[spec.sch][spec.nps]; }
  for (const k of ['A', 'B']) { const e = spec[k]; if (e && e.mode === 'saddle' && e.hdr) { e.hod = O.B36_OD[e.hdr.nps]; e.hw = O.B36_WALL[e.hdr.sch][e.hdr.nps]; } }
  spec.matF = MATF[spec.mat || 'A106B'] || 1;
  return spec;
}

// ------------------------------------------------------------------ L1: calc() + flat DXF + CSV against the oracle
function checkBlock(c, r, ex) {
  const blocked = c.blocked(r), errs = (r.warns || []).filter(w => w.lvl === 'err').map(w => w.t);
  if (ex.mustBlock) {
    rec('block.missing', blocked, { what: 'part that cannot be cut as typed must be blocked with a red item (' + ex.reasons.concat(ex.holes.filter(h => h.why.length).map(h => 'hole x=' + f4(h.x) + ' az=' + h.az + ': ' + h.why.join(','))).slice(0, 3).join('; ') + ')', expected: 'blocked', measured: 'not blocked' });
  } else if (blocked) {
    rec('block.unexpected', ex.mayBlock, { what: 'a part the oracle finds cuttable is blocked', expected: 'exportable', measured: 'blocked: ' + errs.join(' / ') });
  }
  return blocked;
}
function checkCalc(c, r, ex, spec) {
  const sec = ex.sec, N = r.N;
  near('sec.od', r.sec.od, sec.od, 1e-9, 'section OD used by calc'); near('sec.id', 2 * r.sec.ri, sec.id, 1e-9, 'section ID used by calc');
  near('len.oal', r.OAL, ex.OAL, TOL, 'overall (long point) length'); near('len.wp', r.L, ex.L, TOL, 'work-point length');
  near('len.endA', r.aMin, ex.xA0, TOL, 'long point of End A'); near('len.endB', r.bMax, ex.xB1, TOL, 'long point of End B');
  stat('calc: short-point label error (in) - display only, sampled at 192 stations', Math.abs(r.SP - ex.SPod)); near('len.sp', r.SP, ex.SPod, .01, 'short point length shown on the form (on the OD; display value, 0.01 in)');
  if (spec.lenMode === 'oal') near('len.typed', r.OAL, spec.len, 1e-6, 'overall length = the typed length (calc)');
  let wa = 0, wb = 0, wi = 0;
  // shape of each cut, measured from that end's own work point (the length itself is checked by len.*)
  for (let i = 0; i < N; i++) { const phi = i / N * 2 * PI; const da = Math.abs(r.a[i] - ex.xA(sec.ro, phi)), db = Math.abs((r.b[i] - r.L) - (ex.xB(sec.ro, phi) - ex.L)); if (da > wa) { wa = da; wi = i; } if (db > wb) wb = db; }
  stat('calc: end-cut station error (in)', Math.max(wa, wb));
  rec('cut.stations', wa <= TOL && wb <= TOL, { what: 'end-cut stations a[]/b[] vs oracle curve on the OD, each from its own work point (worst at station ' + wi + ')', expected: 0, measured: +Math.max(wa, wb).toFixed(6), tol: TOL });
  // Weight follows the steel: area x the average cut length round the pipe (for square and mitered ends that is the
  // work-point length; for a saddle it stops at the header surface instead of running on to the header centreline).
  { let mean = 0; const MM = 1440; for (let i = 0; i < MM; i++) { const phi = i / MM * 2 * PI; mean += ex.xB(sec.ro, phi) - ex.xA(sec.ro, phi); } mean /= MM;
    near('wt.rule', r.wt, sec.area * mean * O.DENSITY * (spec.matF || 1), sec.area * .01 * O.DENSITY * (spec.matF || 1) + 1e-9, 'weight = area x average cut length round the pipe x 0.2836 x material factor (tolerance = 0.01 in of pipe)'); }
  // holes
  const got = r.holes.filter(h => h.ok);
  rec('hole.count', got.length === ex.holes.length && r.holes.length === ex.holes.length, { what: 'holes kept by calc', expected: ex.holes.length, measured: got.length + ' ok of ' + r.holes.length });
  let wx = 0, wd = 0, waz = 0, miss = 0;
  for (const h of ex.holes) { let best = null, bd = 1e9; for (const g of got) { const d = Math.abs(g.x - h.x) + Math.abs(((g.deg - h.az + 540) % 360) - 180) * RAD * sec.ro; if (d < bd) { bd = d; best = g; } }
    if (!best || bd > .05) { miss++; continue; } wx = Math.max(wx, Math.abs(best.x - h.x)); wd = Math.max(wd, Math.abs(best.dia - h.dia)); waz = Math.max(waz, Math.abs(((best.deg - h.az + 540) % 360) - 180)); }
  if (ex.holes.length) rec('hole.calc', !miss && wx <= TOL && wd <= TOL && waz * RAD * sec.ro <= TOL, { what: 'hole station / diameter / clock angle in calc', expected: 'all ' + ex.holes.length + ' at the typed place', measured: miss + ' missing, worst x ' + f5(wx) + ' dia ' + f5(wd) + ' az ' + f5(waz) + ' deg', tol: TOL });
}
function checkDxf(c, r, ex) {
  const sec = ex.sec, t = c._dxfText();
  if (!rec('dxf.text', !!t && !/nan|infinity|undefined/i.test(t), { what: 'flat DXF is written and holds no NaN / Infinity' }) || !t) return;
  const d = parseDxf(t), cut = d.polys.filter(p => p.layer === 'CUT' && p.closed);
  rec('dxf.units', d.insunits === 1, { what: 'DXF declares inches ($INSUNITS)', expected: 1, measured: d.insunits });
  if (!rec('dxf.outline', cut.length >= 1 && cut[0].pts.length > 100, { what: 'DXF has the wrap outline' })) return;
  const bb = bbox2(cut[0].pts);
  near('dxf.wrap', bb.h, ex.wrap, 2e-5, 'DXF wrap height = pi x OD'); near('dxf.wrap0', bb.y0, 0, 1e-6, 'DXF wrap starts at 0');
  near('dxf.x0', bb.x0, ex.xA0, TOL, 'DXF left extent = long point of End A'); near('dxf.x1', bb.x1, ex.xB1, TOL, 'DXF right extent = long point of End B');
  let w = 0; for (const [x, y] of cut[0].pts) { const phi = 2 * PI * y / ex.wrap + PI; w = Math.max(w, Math.min(Math.abs(x - ex.xA(sec.ro, phi)), Math.abs(x - ex.xB(sec.ro, phi)))); }
  stat('dxf: outline error vs oracle (in)', w);
  rec('dxf.cut', w <= TOL, { what: 'every DXF outline vertex lies on the oracle end-cut curve (OD)', expected: 0, measured: +w.toFixed(6), tol: TOL });
  const hp = cut.slice(1).map(p => bbox2(p.pts));
  rec('dxf.holes', hp.length === ex.holes.length && d.circles.length === 0, { what: 'DXF hole outlines', expected: ex.holes.length, measured: hp.length + ' outlines, ' + d.circles.length + ' circles' });
  let bad = 0, worst = 0;
  for (const h of ex.holes) { let best = null, bd = 1e9; for (const q of hp) { const dd = Math.hypot(q.cx - h.x, q.cy - h.u); if (dd < bd) { bd = dd; best = q; } }
    if (!best) { bad++; continue; } const e = Math.max(Math.abs(best.cx - h.x), Math.abs(best.cy - h.u), Math.abs(best.w - h.dia), Math.abs(best.h - 2 * h.uh)); worst = Math.max(worst, e); if (e > TOL) bad++; }
  if (ex.holes.length) rec('dxf.holepos', bad === 0, { what: 'DXF hole centre x, centre around (from the 180 deg seam), width = dia, height = true-diameter arc', expected: 0, measured: bad + ' off, worst ' + f5(worst), tol: TOL });
  // CSV
  const csv = c._csvText(); const rows = csv ? csv.split('\n').filter(l => l && !l.startsWith('#') && !l.startsWith('grp,')) : [];
  rec('csv.rows', rows.length === ex.holes.length && rows.every(l => /,OK$/.test(l)) && !/nan|undefined/i.test(csv || ''), { what: 'hole CSV rows', expected: ex.holes.length, measured: rows.length });
  // file name carries the overall length to 1/16
  const fb = c.fileBase(), want = String(Math.round(ex.OAL * 16) / 16).replace(/[^\w.-]+/g, '-') + 'in';
  rec('file.name', fb.endsWith('_' + want), { what: 'file name ends with the overall length', expected: want, measured: fb });
}

// ------------------------------------------------------------------ kernel helpers (measuring only)
let oc = null, nBuilt = 0;
const P3 = (x, r, phi) => [x, r * Math.cos(phi), r * Math.sin(phi)];
function sew(K, shp, tol) {
  const s = new oc.BRepBuilderAPI_Sewing(tol, true, true, true, false); s.Add(shp); s.Perform(new oc.Handle_Message_ProgressIndicator_1());
  const out = s.SewedShape(); return { shape: out, free: s.NbFreeEdges(), shells: K.count(out, 'TopAbs_SHELL'), faces: K.count(out, 'TopAbs_FACE') };
}
function solidOf(K, sewn) { const ex = K.mk('TopExp_Explorer', sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); if (!ex.More()) return null; return K.mk('BRepBuilderAPI_MakeSolid', K.stat('TopoDS', 'Shell', ex.Current())).Solid(); }
// adaptive integration (the plain Gauss rule is ~0.8 % off on the rational NURBS cylinders an IGES holds)
function volAdaptive(K, s) { const g = new oc.GProp_GProps_1(); oc.BRepGProp.VolumeProperties_2(s, g, 1e-5, false, false); return g.Mass(); }
function classifier(K, solid, flip) {
  const cl = new oc.BRepClass3d_SolidClassifier_2(solid), IN = oc.TopAbs_State.TopAbs_IN.value, OUT = oc.TopAbs_State.TopAbs_OUT.value;
  return (p) => { cl.Perform(K.pnt(p[0], p[1], p[2]), 1e-7); const v = cl.State().value; return v === IN ? (flip ? 'OUT' : 'IN') : v === OUT ? (flip ? 'IN' : 'OUT') : 'ON'; };
}
/** Edges of a shape grouped by face: [{ rmin, rmax, edges: [[pt...]...] }] */
function faceEdges(K, shp, n) {
  const out = [], fex = K.mk('TopExp_Explorer', shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; fex.More(); fex.Next()) { const f = fex.Current(), edges = []; let rmin = 1e9, rmax = -1e9;
    const eex = K.mk('TopExp_Explorer', f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; eex.More(); eex.Next()) { let a; try { a = K.mk('BRepAdaptor_Curve', K.stat('TopoDS', 'Edge', eex.Current())); } catch (e) { continue; } const u0 = a.FirstParameter(), u1 = a.LastParameter(); if (!isFinite(u0) || !isFinite(u1)) continue;
      const g = []; for (let i = 0; i <= n; i++) { const p = a.Value(u0 + (u1 - u0) * i / n); const q = [p.X(), p.Y(), p.Z()]; g.push(q); const rr = Math.hypot(q[1], q[2]); if (rr < rmin) rmin = rr; if (rr > rmax) rmax = rr; } edges.push(g); }
    out.push({ rmin, rmax, edges }); }
  return out;
}
function circleFit(pts) {                                  // algebraic (Kasa) fit: exact for points on a circle
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = pts.length;
  for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [sxz, syz, sz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A); if (Math.abs(D) < 1e-18) return null;
  const col = (k) => A.map((rw, i) => rw.map((v, j) => j === k ? B[i] : v));
  const a = det(col(0)) / D, b = det(col(1)) / D, cc = det(col(2)) / D, cx = a / 2, cy = b / 2;
  return { cx, cy, r: Math.sqrt(Math.max(0, cc + cx * cx + cy * cy)) };
}
/** Measure every expected hole on the OUTER surface of a read-back shape from its edges: centre station, clock angle, diameter. */
function measureHoles(FE, ex) {
  const sec = ex.sec, od = FE.filter(f => Math.abs(f.rmin - sec.ro) < 2e-3 && Math.abs(f.rmax - sec.ro) < 2e-3);
  const res = [];
  for (const h of ex.holes) {
    if (h.tooBig) continue;
    const a = h.az * RAD, pts = [];
    for (const f of od) for (const e of f.edges) { let inside = true; const loc = [];
      if (e.every(q => Math.abs(q[1] - e[0][1]) < 1e-6 && Math.abs(q[2] - e[0][2]) < 1e-6) || e.every(q => Math.abs(q[0] - e[0][0]) < 1e-6)) continue;   // a seam stub or a square end circle, not a hole edge
      for (const q of e) { const dx = q[0] - h.x, w = -q[1] * Math.sin(a) + q[2] * Math.cos(a), nn = q[1] * Math.cos(a) + q[2] * Math.sin(a); if (nn <= 0 || Math.abs(dx) > h.rx + .3 || Math.abs(w) > h.ry + .3) { inside = false; break; } loc.push([dx, w / h.wide]); }
      if (inside && loc.length) for (const q of loc) pts.push(q); }
    if (pts.length < 12) { res.push({ h, found: false }); continue; }
    const fit = circleFit(pts); if (!fit) { res.push({ h, found: false }); continue; }
    let round = 0; const bins = new Set(); for (const [x, y] of pts) { round = Math.max(round, Math.abs(Math.hypot(x - fit.cx, y - fit.cy) - fit.r)); bins.add(Math.floor(((Math.atan2(y - fit.cy, x - fit.cx) / RAD) + 360) % 360 / 15)); }
    // worst distance of any edge point from the EXPECTED opening (what a cut along this edge would be off by)
    let dev = 0; for (const [x, y] of pts) dev = Math.max(dev, Math.abs(Math.hypot(x, y) - h.rad));
    res.push({ h, found: true, x: h.x + fit.cx, across: fit.cy * h.wide, azErr: Math.asin(Math.max(-1, Math.min(1, fit.cy * h.wide / sec.ro))) / RAD, dia: 2 * fit.r, round, cover: bins.size * 15, dev, n: pts.length });
  }
  return res;
}
/** Residual of the end-cut edges (OD face and ID face of a read-back shape) against the oracle cut. */
function measureEnds(FE, ex, spec) {
  const sec = ex.sec, out = {};
  for (const [nm, E, xc, lo, hi] of [['A', ex.A, ex.xA, ex.xA0, ex.xAfull], ['B', ex.B, ex.xB, ex.xBfull, ex.xB1]]) {
    let worst = 0, n = 0, wgap = 0; const bins = new Set();
    for (const [r0, tag] of [[sec.ro, 'od'], [sec.ri, 'id']]) for (const f of FE) { if (Math.abs(f.rmin - r0) > 2e-3 || Math.abs(f.rmax - r0) > 2e-3) continue;
      for (const e of f.edges) { if (!e.every(q => q[0] >= lo - .05 && q[0] <= hi + .05)) continue;
        const ph = e.map(q => Math.atan2(q[2], q[1])); if (e.every(q => Math.abs(q[1] - e[0][1]) < 1e-6 && Math.abs(q[2] - e[0][2]) < 1e-6)) continue;      // a seam stub, not a cut edge
        if (ex.holes.some(h => !h.tooBig && e.every(q => Math.abs(q[0] - h.x) < h.rx + .3 && Math.abs(((Math.atan2(q[2], q[1]) / RAD - h.az + 540) % 360) - 180) * RAD * r0 < h.ry + .3))) continue;   // a hole edge
        for (let i = 0; i < e.length; i++) { const q = e[i], d = Math.abs(q[0] - xc(r0, ph[i])); if (d > worst) worst = d; n++; if (tag === 'od') bins.add(Math.floor(((ph[i] / RAD) + 360) % 360 / 10));
          if (E.mode === 'saddle') { const g = Math.abs(O.saddleGap(sec, E.sd, nm === 'A' ? q[0] : ex.L - q[0], ph[i])); if (g > wgap) wgap = g; } } } }
    out[nm] = { worst, n, cover: bins.size * 10, gap: wgap, mode: E.mode };
  }
  return out;
}

/** The surfaces and model-space trim curves stored in the IGES, evaluated by this suite's own reader (no kernel):
 *  OD / ID radius, each end face on the expected cut surface, each hole wall on the typed opening, overall length. */
function fileSurfaces(T, ex, spec) {
  const sec = ex.sec, tolOf = (E) => E.mode === 'saddle' ? STOL : TOL;
  let odErr = -1, idErr = -1; const endRes = { A: { w: 0, n: 0 }, B: { w: 0, n: 0 } }, holeRes = ex.holes.map(() => ({ w: 1e9, faces: 0 }));
  for (const f of T.faces) { const S = f.surf; if (!S) continue; const pts = [], nu = 180, nv = 6;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) pts.push(S.at(S.u0 + (S.u1 - S.u0) * i / nu, S.v0 + (S.v1 - S.v0) * j / nv));
    const rr = pts.map(q => Math.hypot(q[1], q[2])), dOd = Math.max(...rr.map(v => Math.abs(v - sec.ro))), dId = Math.max(...rr.map(v => Math.abs(v - sec.ri)));
    if (dOd < 1e-3) { odErr = Math.max(odErr, dOd); continue; } if (dId < 1e-3) { idErr = Math.max(idErr, dId); continue; }
    // a hole wall: every point of the surface lies on the typed opening (round tool, or the wider ellipse of a set-thru stub)
    let hit = -1, hw = 1e9, floor = false; ex.holes.forEach((h, k) => { if (h.tooBig) return; const a = h.az * RAD; let w = 0, side = 0, flat = 0;
      for (const q of pts) { const dx = q[0] - h.x, lat = -q[1] * Math.sin(a) + q[2] * Math.cos(a), nn = q[1] * Math.cos(a) + q[2] * Math.sin(a); side += nn; flat = Math.max(flat, Math.abs(nn)); w = Math.max(w, Math.abs(Math.hypot(dx, lat / h.wide) - h.rad)); }
      // an opening wider than the bore is drilled from the pipe centreline, so its tool also leaves a flat floor on the centre plane
      if (flat < 1e-6 && h.ry > sec.ri && pts.every(q => Math.abs(q[0] - h.x) < h.rx + 4)) floor = true;
      if (side > 0 && w < hw) { hw = w; hit = k; } });
    if (floor) continue;
    if (hit >= 0 && hw < .02) { holeRes[hit].w = Math.min(holeRes[hit].w, hw); holeRes[hit].faces++; continue; }
    // an end face: the part of the surface inside the wall
    const inWall = pts.filter((q, k) => rr[k] > sec.ri + 1e-4 && rr[k] < sec.ro - 1e-4); if (inWall.length < 10) continue;
    const res = (xc) => Math.max(...inWall.map(q => Math.abs(q[0] - xc(Math.hypot(q[1], q[2]), Math.atan2(q[2], q[1]))))), ra = res(ex.xA), rb = res(ex.xB), nm = ra <= rb ? 'A' : 'B';
    endRes[nm].w = Math.max(endRes[nm].w, Math.min(ra, rb)); endRes[nm].n += inWall.length; }
  stat('file: OD / ID surface radius error (in)', Math.max(odErr, idErr));
  rec('file.od', odErr >= 0 && odErr <= 1e-6, { what: 'IGES: the outer surface is a cylinder of the table OD (every sampled surface point)', expected: sec.od, measured: odErr < 0 ? 'no OD surface found' : 'radius off by ' + odErr.toExponential(2) });
  rec('file.id', idErr >= 0 && idErr <= 1e-6, { what: 'IGES: the bore surface is a cylinder of the table ID (every sampled surface point)', expected: +sec.id.toFixed(4), measured: idErr < 0 ? 'no ID surface found' : 'radius off by ' + idErr.toExponential(2) });
  for (const [nm, E] of [['A', ex.A], ['B', ex.B]]) { const q = endRes[nm]; stat('file: ' + E.mode + ' end face error (in)', q.w);
    rec('file.end.' + E.mode, q.n >= 10 && q.w <= tolOf(E), { what: 'IGES: End ' + nm + ' ' + E.mode + ' cut face - sampled surface points inside the wall lie on the expected ' + (E.mode === 'saddle' ? 'saddle surface' : 'plane'), expected: 0, measured: +q.w.toFixed(5) + ' (' + q.n + ' pts)', tol: tolOf(E) }); }
  if (ex.holes.length) { const miss = holeRes.filter((q, k) => !ex.holes[k].tooBig && !q.faces).length, w = Math.max(0, ...holeRes.filter(q => q.faces).map(q => q.w)); stat('file: hole wall surface error (in)', w);
    rec('file.hole', miss === 0 && w <= TOL, { what: 'IGES: every requested hole has a wall surface, and it lies on the typed opening (diameter, station, clock angle)', expected: ex.holes.length + ' holes, 0 off', measured: (ex.holes.length - miss) + ' found, worst ' + w.toFixed(5), tol: TOL }); }
  // overall length straight from the model-space trim curves
  const [x0, x1] = IG.modelExtentX(T);
  near('file.oal', x1 - x0, ex.OAL, TOL, 'IGES: overall length from the model-space trim curves'); if (spec.lenMode === 'oal') near('file.typed', x1 - x0, spec.len, TOL, 'IGES: overall length = the typed length');
}

// ------------------------------------------------------------------ L2: the exported IGES
function checkIges(c, r, ex, spec) {
  const sec = ex.sec, cap = {};
  const m = { buildSolid: (...a) => { const o = occm.buildSolid(...a); cap.K = o.K; cap.shape = o.shape; return o; }, inspect: (...a) => (cap.info = occm.inspect(...a)), writeIges: occm.writeIges, writeStep: occm.writeStep };
  let f; const t0 = Date.now();
  try { f = c._solidFile(oc, m, 'igs'); } catch (e) { rec('export.runs', false, { what: 'the export path (_solidFile) writes a file', expected: 'IGES text', measured: String(e && e.message || e).slice(0, 160) }); if (!(e instanceof Error) || !/^(The solid|Fix the items)/.test(e.message)) throw e; return; }
  rec('export.runs', true); nBuilt++;
  const K = cap.K, i0 = cap.info, text = f.text; cur.ms.export = Date.now() - t0;
  // 1. the solid before it is written
  rec('solid.valid', i0.valid && i0.solids === 1 && i0.shells === 1, { what: 'built solid: valid, exactly 1 solid / 1 shell', expected: 'valid 1/1', measured: 'valid ' + i0.valid + ' solids ' + i0.solids + ' shells ' + i0.shells });
  near('solid.oal', i0.bbox[0][1] - i0.bbox[0][0], ex.OAL, TOL, 'built solid: overall length (bbox X)');
  if (spec.lenMode === 'oal') near('solid.typed', i0.bbox[0][1] - i0.bbox[0][0], spec.len, TOL, 'built solid: overall length = the typed length');
  let volS = NaN; { const tv = Date.now(); try { volS = Math.abs(volAdaptive(K, cap.shape)); } catch (e) { } cur.ms.volS = Date.now() - tv; }
  // tolerance: 0.001 in of pipe length (the length tolerance) + what the integration resolves
  const volTol = sec.area * TOL + ex.vol * 5e-6;
  if (ex.volExact) { stat('built solid: volume error (in of pipe length)', Math.abs(volS - ex.vol) / sec.area); near('solid.volume', volS, ex.vol, volTol, 'volume of the built solid vs analytic (square / miter exact, saddle integrated, holes subtracted)'); }
  if (ex.volExact && !ex.holes.length && ex.A.mode !== 'saddle' && ex.B.mode !== 'saddle') near('wt.volume', r.wt, volS * O.DENSITY * (spec.matF || 1), sec.area * TOL * O.DENSITY + r.wt * 1e-5, 'weight (c.wt) = volume x 0.2836 lb/in3');
  const clsS = classifier(K, cap.shape, false);
  // 8. file level, with this suite's own reader
  const g = IG.igesGlobal(text);
  rec('iges.units', g.unitFlag === 1 && /^(INCH|IN)$/.test(g.unitName || '') && Math.abs(g.scale - 1) < 1e-12, { what: 'IGES global section: unit flag 1 (inches), name INCH, model scale 1', expected: '1 / INCH / 1', measured: g.unitFlag + ' / ' + g.unitName + ' / ' + g.scale });
  const T = IG.trimmedFaces(text, 24), tcn = IG.trimConsistency(T);
  rec('iges.finite', !/nan|inf/i.test(T.I.pText.replace(/\d+H[^,;]*/g, '')) && T.nonFinite.length === 0, { what: 'IGES holds no NaN / Infinity', measured: T.nonFinite.length + ' entities' });
  rec('iges.faces', T.faces.length === i0.faces && T.unknown.length === 0, { what: 'IGES holds one trimmed surface (144 on a 128 NURBS) per face', expected: i0.faces, measured: T.faces.length + ' faces, unreadable entity types [' + T.unknown.join(',') + ']' });
  stat('iges: parameter-space trim vs model-space trim (in)', tcn.worst);
  rec('iges.trim2d', tcn.worst <= TOL, { what: 'IGES 142 trim loops: the parameter-space curve mapped through its surface must be the same edge as the model-space curve (file says either may be used)', expected: 0, measured: +tcn.worst.toFixed(5), tol: TOL, loopsOff: tcn.badLoops + ' of ' + tcn.loops });
  fileSurfaces(T, ex, spec);
  const outside = Math.max(0, ...T.faces.map(q => q.outside));
  rec('iges.domain', outside <= 1e-9, { what: 'IGES 128 surfaces: declared U/V range lies inside the knot domain', expected: 0, measured: +outside.toFixed(5) });
  // ---- rtB: the same file, model-space curve preferred
  let t1 = Date.now();
  const pf = IG.setTrimPreference(text, 2);
  const rbB = K.scale(occm.readBack(K, pf.text, 'iges'), 1 / 25.4), sB = sew(K, rbB, TOL);
  const closedB = rec('rtB.closed', pf.n > 0 && sB.free === 0 && sB.shells === 1 && sB.faces >= i0.faces, { what: 'model-space trims: faces sew (0.001 in) into exactly 1 closed shell', expected: '0 free edges, 1 shell, ' + i0.faces + ' faces', measured: sB.free + ' free edges, ' + sB.shells + ' shell(s), ' + sB.faces + ' faces' });
  const solid = closedB ? solidOf(K, sB.shape) : null;
  const shpB = solid || rbB, bb = K.bbox(shpB);
  near('rtB.oal', bb[0][1] - bb[0][0], ex.OAL, TOL, 'overall length (bbox X) of the read-back solid');
  if (spec.lenMode === 'oal') near('rtB.typed', bb[0][1] - bb[0][0], spec.len, TOL, 'read-back overall length = the typed length');
  near('rtB.x0', bb[0][0], ex.xA0, TOL, 'long point of End A sits where expected (work point A at x = 0)'); near('rtB.x1', bb[0][1], ex.xB1, TOL, 'long point of End B sits where expected');
  near('rtB.od', Math.max(bb[1][1] - bb[1][0], bb[2][1] - bb[2][0]), sec.od, TOL, 'OD (bbox Y/Z)'); near('rtB.odmin', Math.min(bb[1][1] - bb[1][0], bb[2][1] - bb[2][0]), sec.od, 2 * TOL, 'OD (smaller of bbox Y/Z)');
  const feB = faceEdges(K, shpB, 48), hB = measureHoles(feB, ex), eB = measureEnds(feB, ex, spec);
  holeVerdict('rtB', hB, ex); endVerdict('rtB', eB, ex);
  if (solid) {
    const vi = occm.inspect(K, solid);
    rec('rtB.valid', vi.valid && vi.solids === 1 && vi.shells === 1, { what: 'read-back solid: valid, exactly 1 solid / 1 shell', measured: 'valid ' + vi.valid + ' solids ' + vi.solids + ' shells ' + vi.shells });
    let vol = NaN; const tv = Date.now(); try { vol = volAdaptive(K, solid); } catch (e) { } cur.ms.vol = Date.now() - tv;
    const flip = vol < 0; vol = Math.abs(vol);
    // The kernel's IGES reader re-fits each trim on the NURBS surface and reports how far off that fit is (edge
    // tolerance). The read-back volume and point probes cannot be sharper than that near an opening.
    let etol = 0; try { etol = new oc.ShapeAnalysis_ShapeTolerance().Tolerance(solid, 1, oc.TopAbs_ShapeEnum.TopAbs_EDGE); } catch (e) { } stat('rtB: reader edge tolerance (in)', etol);
    // (with a saddle end the kernel's volume of the read-back wanders by up to 0.3 in of pipe although every face and edge of
    //  that read-back is on the oracle - so the read-back volume is judged on square / miter ended parts only; saddle
    //  parts have their volume checked on the built solid, 'solid.volume')
    const flatEnds = ex.A.mode !== 'saddle' && ex.B.mode !== 'saddle';
    if (ex.volExact) { const allow = etol > 1e-4 ? etol * sec.t * ex.holes.reduce((a, h) => a + 4 * PI * (h.ry || 0), 0) : 0; stat('rtB: volume error, ' + (flatEnds ? 'square / miter ends' : 'saddle end (not judged)') + ' (in of pipe length)', Math.abs(vol - ex.vol) / sec.area);
      if (flatEnds) near('rtB.volume', vol, ex.vol, sec.area * TOL + ex.vol * 2e-5 + allow, 'volume of the read-back solid vs analytic (square / miter ended parts)'); }
    probes('rtB', classifier(K, solid, flip), ex, clsS);
  }
  probes('solid', clsS, ex, null);
  cur.ms.rtB = Date.now() - t1;
  // ---- rtA: the file exactly as written
  t1 = Date.now();
  let t2 = Date.now(); const rbA = K.scale(occm.readBack(K, text, 'iges'), 1 / 25.4); cur.ms.rtA_read = Date.now() - t2; t2 = Date.now(); const bbA = K.bbox(rbA); cur.ms.rtA_bbox = Date.now() - t2;
  rec('rtA.faces', K.count(rbA, 'TopAbs_FACE') >= i0.faces, { what: 'as written: every face reads back', expected: i0.faces, measured: K.count(rbA, 'TopAbs_FACE') });
  near('rtA.oal', bbA[0][1] - bbA[0][0], ex.OAL, TOL, 'as written: overall length (bbox X)');
  const feA = faceEdges(K, rbA, 48), hA = measureHoles(feA, ex), eA = measureEnds(feA, ex, spec);
  holeVerdict('rtA', hA, ex); endVerdict('rtA', eA, ex);
  // Closed shell? Sewing is the test, but the kernel's sewing can take minutes on a shape that will not close. Where the
  // read-back already shows a trim edge more than 0.005 in away from where the adjoining face has it, the 0.001 in sew
  // cannot close and is not run; a mismatched file with a very large edge count and no usable edge measurement is not attempted.
  { const worstOf = (H, Ee) => Math.max(0, ...H.filter(q => q.found).map(q => q.dev), Ee.A.n ? Ee.A.worst : 0, Ee.B.n ? Ee.B.worst : 0), off = worstOf(hA, eA), offB = worstOf(hB, eB), nE = K.count(rbA, 'TopAbs_EDGE');
    if (tcn.worst > TOL && off > 5 * TOL && off > offB + 4 * TOL) rec('rtA.closed', false, { what: 'as written: faces sew (0.001 in) into exactly 1 closed shell', expected: '0 free edges, 1 shell', measured: 'cannot close: a trim edge sits ' + off.toFixed(4) + ' in from the edge of the face it should join' });
    else if (tcn.worst > TOL && nE > 300) rec('rtA.closed', false, { what: 'as written: faces sew (0.001 in) into exactly 1 closed shell', expected: '0 free edges, 1 shell', measured: 'not attempted: the file\'s two trim descriptions differ by ' + tcn.worst.toFixed(4) + ' in and the read-back has ' + nE + ' edge pieces' });
    else { const sA = sew(K, rbA, TOL); rec('rtA.closed', sA.free === 0 && sA.shells === 1, { what: 'as written: faces sew (0.001 in) into exactly 1 closed shell', expected: '0 free edges, 1 shell', measured: sA.free + ' free edges, ' + sA.shells + ' shell(s)' }); } }
  cur.ms.rtA = Date.now() - t1;
}
function holeVerdict(tag, H, ex) {
  if (!ex.holes.length) return;
  const sec = ex.sec; let nf = 0, wx = 0, wa = 0, wd = 0, wdev = 0, open = 0;
  for (const q of H) { if (!q.found) { nf++; continue; } wx = Math.max(wx, Math.abs(q.x - q.h.x)); wa = Math.max(wa, Math.abs(q.across)); wd = Math.max(wd, Math.abs(q.dia - q.h.dia)); wdev = Math.max(wdev, q.dev); if (q.cover < 345) open++; }
  stat(tag + ': hole outer-edge deviation (in)', wdev);
  rec(tag + '.hole.count', nf === 0 && H.length === ex.holes.length, { what: tag + ': every requested hole has an outer edge on the OD', expected: ex.holes.length, measured: (H.length - nf) + ' found' });
  rec(tag + '.hole.closed', open === 0, { what: tag + ': each hole edge is a closed loop (not broken out through an end)', expected: 0, measured: open + ' open' });
  rec(tag + '.hole.station', wx <= TOL, { what: tag + ': hole centre station along the pipe', expected: 0, measured: +wx.toFixed(5), tol: TOL });
  rec(tag + '.hole.clock', wa <= TOL, { what: tag + ': hole centre clock position (shift around the OD, in)', expected: 0, measured: +wa.toFixed(5), tol: TOL });
  rec(tag + '.hole.dia', wd <= TOL, { what: tag + ': hole diameter (fitted)', expected: 0, measured: +wd.toFixed(5), tol: TOL });
  rec(tag + '.hole.edge', wdev <= TOL, { what: tag + ': worst distance of the hole outer edge from the typed opening', expected: 0, measured: +wdev.toFixed(5), tol: TOL });
}
function endVerdict(tag, E, ex) {
  for (const nm of ['A', 'B']) { const q = E[nm];
    stat(tag + ': ' + q.mode + ' end edge error (in)', q.worst);
    const tl = q.mode === 'saddle' ? STOL : TOL;
    rec(tag + '.end.' + q.mode, q.n > 20 && q.cover >= 300 && q.worst <= tl, { what: tag + ': End ' + nm + ' ' + q.mode + ' cut edge (OD + ID) vs oracle', expected: 0, measured: +q.worst.toFixed(5) + ' (' + q.n + ' pts, ' + q.cover + ' deg covered)', tol: tl });
    if (q.mode === 'saddle') { stat(tag + ': saddle header-surface gap (in)', q.gap); rec(tag + '.end.fit', q.gap <= STOL, { what: tag + ': End ' + nm + ' saddle seats on the header surface (cylinder/cylinder), worst gap or penetration', expected: 0, measured: +q.gap.toFixed(5), tol: STOL }); } }
}
/** Point probes 0.001 in (0.0005 in for the section) either side of every expected surface.
 *  tag 'solid' = the built solid (exact analytic surfaces).  tag 'rtB' = the read-back solid: there the reader's own
 *  edge tolerance makes a probe near an edge come back "ON" (undecided); such a probe is settled on the built solid.
 *  The kernel's point classifier is not infallible next to a spline face (it was caught calling points 0.03 in outside
 *  a saddle face "inside" while the face itself, sampled directly, was exact), so: saddle faces are NOT probed (they are
 *  verified by sampling the face and its edges instead), and any other probe that comes back wrong is asked again at
 *  two nearby points that must give the same answer; only a wrong answer at all three counts. */
function probes(tag, cls, ex, clsExact) {
  const sec = ex.sec, rng = O.mulberry32(SEED ^ (cur.n * 7919)), e5 = 5e-4, rm = (sec.ro + sec.ri) / 2; let undecided = 0, retried = 0;
  const ask1 = (p, want) => { let got = cls(p); if (got === 'ON' && clsExact) { undecided++; got = clsExact(p); } return got === want ? '' : got; };
  // mk(k) gives the probe point for attempt k (k = 0 the nominal point, 1 and 2 nearby points with the same expected answer)
  const ask = (mk, want) => { const g0 = ask1(mk(0), want); if (!g0) return ''; retried++; if (!ask1(mk(1), want) || !ask1(mk(2), want)) return ''; return g0; };
  // 3. cross-section: just inside / outside the OD and the bore
  { let bad = 0, n = 0, first = '';
    for (let k = 0, tries = 0; k < 6 && tries < 400; tries++) { const phi = rng() * 2 * PI; const lo = Math.max(ex.xA(sec.ro, phi), ex.xA(sec.ri, phi)) + .05, hi = Math.min(ex.xB(sec.ro, phi), ex.xB(sec.ri, phi)) - .05; if (hi <= lo) continue; const x = lo + rng() * (hi - lo);
      if (!O.clearOfHoles(ex, x, sec.ro, phi, .1) || !O.clearOfHoles(ex, x, sec.ri, phi, .1)) continue; k++;
      for (const [rr, want] of [[sec.ro - e5, 'IN'], [sec.ro + e5, 'OUT'], [sec.ri + e5, 'IN'], [sec.ri - e5, 'OUT']]) { n++; const got = ask((j) => P3(x + j * .013, rr, phi + j * .002), want); if (got) { bad++; if (!first) first = 'r=' + f4(rr) + ' x=' + f4(x) + ' phi=' + (phi / RAD).toFixed(1) + ' is ' + got; } } }
    rec(tag + '.section', n >= 8 && bad === 0, { what: tag + ': OD and ID by point probes 0.0005 in either side of each surface', expected: 'OD ' + sec.od + ' ID ' + f4(sec.id), measured: bad + ' of ' + n + ' probes wrong' + (first ? ' (' + first + ')' : '') }); }
  // 5. flat end cuts (square / miter): 0.001 in either side of the expected plane
  for (const [nm, E, xc, dir] of [['A', ex.A, ex.xA, 1], ['B', ex.B, ex.xB, -1]]) {
    if (E.mode === 'saddle') continue;
    let bad = 0, n = 0, first = ''; const phis = [];
    if (E.mode === 'miter') phis.push(E.rot, E.rot + PI, E.rot + PI / 2, E.rot - PI / 2);
    while (phis.length < 10) phis.push(rng() * 2 * PI);
    phis.forEach((phi, k) => { const rr = E.mode === 'miter' ? (k % 2 ? sec.ri + .2 * sec.t : sec.ro - .2 * sec.t) : (k % 3 === 0 ? rm : k % 3 === 1 ? sec.ro - .2 * sec.t : sec.ri + .2 * sec.t);
      const at = (j, off) => { const ph = phi + j * .004, x = xc(rr, ph); return P3(x + off, rr, ph); }, x0 = xc(rr, phi);
      if (!O.clearOfHoles(ex, x0, rr, phi, .1) || (dir > 0 ? ex.xB(rr, phi) - x0 : x0 - ex.xA(rr, phi)) < .01) return;
      n += 2; const a = ask((j) => at(j, dir * TOL), 'IN'), b = ask((j) => at(j, -dir * TOL), 'OUT');
      if (a) { bad++; if (!first) first = 'phi ' + (phi / RAD).toFixed(1) + ': 0.001 inside the cut is ' + a; } if (b) { bad++; if (!first) first = 'phi ' + (phi / RAD).toFixed(1) + ': 0.001 outside the cut is ' + b; } });
    rec(tag + '.probe.' + E.mode, n >= 8 && bad === 0, { what: tag + ': End ' + nm + ' ' + E.mode + ' cut face - material 0.001 in inside the expected plane, none 0.001 in outside (incl. long / short point)', expected: 0, measured: bad + ' of ' + n + ' probes wrong' + (first ? ' (' + first + ')' : '') });
  }
  // 7. holes: open at the centre, far wall uncut, 0.001 in either side of the opening
  if (ex.holes.length) { let bad = 0, n = 0, first = ''; const rr = tag === 'solid' ? sec.ro - Math.min(.01, sec.t / 3) : rm, full = ex.holes.length <= 8 ? ex.holes : ex.holes.filter((_, i) => i < 4 || i >= ex.holes.length - 4);
    for (const h of ex.holes) { if (h.tooBig) continue; const a = h.az * RAD; n++; const got = ask((j) => P3(h.x + j * h.rx * .1, rm, a), 'OUT'); if (got) { bad++; if (!first) first = 'hole x=' + f4(h.x) + ' az=' + h.az + ' centre is ' + got; }
      if (O.isMaterial(ex, h.x, rm, a + PI, .05)) { n++; const g2 = ask((j) => P3(h.x + j * .01, rm, a + PI), 'IN'); if (g2) { bad++; if (!first) first = 'far wall behind hole x=' + f4(h.x) + ' is ' + g2; } } }
    for (const h of full) { if (h.tooBig) continue; const a = h.az * RAD;
      for (let k = 0; k < 8; k++) { const ps0 = k / 8 * 2 * PI + .2; for (const [sg, want] of [[-1, 'OUT'], [1, 'IN']]) {
        const at = (j) => { const ps = ps0 + j * .01, dx = (h.rx + sg * TOL) * Math.cos(ps), w = (h.ry + sg * TOL) * Math.sin(ps); return { x: h.x + dx, w, phi: a + Math.asin(Math.max(-1, Math.min(1, w / rr))) }; };
        if ([0, 1, 2].some(j => Math.abs(at(j).w) >= rr || (want === 'IN' && !isMat1(ex, h, at(j).x, rr, at(j).phi)))) continue;
        n++; const got = ask((j) => { const q = at(j); return P3(q.x, rr, q.phi); }, want); if (got) { bad++; if (!first) first = 'hole x=' + f4(h.x) + ' az=' + h.az + ': 0.001 ' + (sg < 0 ? 'inside' : 'outside') + ' the edge is ' + got; } } } }
    rec(tag + '.probe.hole', bad === 0, { what: tag + ': holes - open at centre, far wall solid, 0.001 in inside the opening is open and 0.001 in outside is wall', expected: 0, measured: bad + ' of ' + n + ' probes wrong' + (first ? ' (' + first + ')' : '') }); }
  if (clsExact) stat('rtB: probes the read-back could not decide (ON), settled on the built solid', undecided);
  stat(tag + ': probes asked again after a first wrong answer', retried);
}
// material test for a point just outside hole h: every OTHER reason it might not be material
function isMat1(ex, h, x, r, phi) { if (x < ex.xA(r, phi) + 5e-4 || x > ex.xB(r, phi) - 5e-4) return false; for (const o of ex.holes) { if (o === h || o.tooBig) continue; const d = ((phi / RAD - o.az + 540) % 360) - 180; if (Math.abs(d) >= 90) continue; const w = r * Math.sin(d * RAD), dx = x - o.x; if ((dx * dx) / ((o.rx + .002) ** 2) + (w * w) / ((o.ry + .002) ** 2) < 1) return false; } return true; }

// ------------------------------------------------------------------ one case
async function runCase(cs) {
  cur = cs; cs.ms = {};
  const spec = cs.spec; let c, r, ex;
  try {
    c = await freshApp(); applyPatch(c, cs.patch); if (cs.after) cs.after(c);
    r = c.calc(); ex = O.expectedPart(cs.expect ? cs.expect(c) : spec);
  } catch (e) { rec('case.setup', false, { what: 'case sets up', measured: String(e && e.stack || e).slice(0, 200) }); return; }
  const blocked = checkBlock(c, r, ex);
  if (blocked) {                                             // nothing may be exported
    if (cs.level === 2 && oc) { let threw = false; try { c._solidFile(oc, occm, 'igs'); } catch (e) { threw = true; } rec('block.export', threw, { what: 'a blocked part writes no IGES', expected: 'throws', measured: 'file written' }); }
    return;
  }
  if (!ex.mustBlock) { try { checkCalc(c, r, ex, spec); checkDxf(c, r, ex); } catch (e) { rec('case.calc', false, { what: 'calc / DXF checks run', measured: String(e && e.stack || e).slice(0, 240) }); } }
  if (cs.level === 2) {
    try { checkIges(c, r, ex, spec); }
    catch (e) { rec('case.engine', false, { what: 'IGES checks run without a kernel error', measured: String(e && e.message || e).slice(0, 200) }); oc = await loadOcc(true); nBuilt = 0; }
    if (oc.HEAP8.length > 400 * 1048576) { oc = await loadOcc(true); nBuilt = 0; }       // kernel objects are never freed and a big wasm heap gets slow: start a clean engine now and then
  }
}

// ------------------------------------------------------------------ the sweep (deterministic per seed)
const rng = O.mulberry32(SEED), pick = (a) => a[Math.floor(rng() * a.length)], rnd = (a, b) => a + rng() * (b - a), r16 = (v) => Math.round(v * 16) / 16, r3 = (v) => Math.round(v * 1000) / 1000;
const MITERS = [0.5, 15, 22.5, 30, 45, 60, 75, -15, -30, -45, -60, 37.5, 7], ROTS = [0, 45, 90, 180, 270], ODD_ROTS = [10, 27, 133, 200.5, 301];
const LEN_STYLES = ['frac', 'ftin', 'ftinq', 'ftsp', 'fracdash', 'in'];
const hdrsFor = (od) => O.NPS.filter(n => O.B36_OD[n] >= od - 1e-9);
const cases = [];
function add(level, group, id, spec, extra) { finishSpec(spec); const cs = Object.assign({ level, group, id: group + '/' + id, spec, patch: toPatch(spec), n: cases.length }, extra || {}); cases.push(cs); return cs; }
const mkMiter = (odd) => ({ mode: 'miter', ang: pick(MITERS), rot: odd ? pick(ODD_ROTS) : pick(ROTS) });
function mkSaddle(od, opt) {
  opt = opt || {}; const hn = opt.hdr || pick(hdrsFor(od)), hs = opt.sch || pick(O.SCHEDS), hod = O.B36_OD[hn], hw = O.B36_WALL[hs][hn];
  const thruOk = od <= hod - 2 * hw - 1e-9, seat = opt.seat || (thruOk && rng() < .35 ? 'thru' : 'on');
  return { mode: 'saddle', hdr: { nps: hn, sch: hs }, ang: opt.ang != null ? opt.ang : pick([90, 90, 60, 45, 30, 75, 20, 37.5]), roll: opt.roll != null ? opt.roll : pick([0, 0, 0, 15, 45, 90, 180, 270]), seat: seat === 'thru' && !thruOk ? 'on' : seat };
}
/** A typed length for these ends: kind 'short' (barely longer than the cuts), 'mid', 'long' (up to 40 ft). */
function mkLen(spec, kind, style) {
  finishSpec(spec); const sec = O.section(spec.od, spec.t), A = O.endModel(spec.A, sec), B = O.endModel(spec.B, sec);
  const minWp = A.full + B.full;                                             // work-point length at which the short point reaches 0
  const wp = kind === 'short' ? minWp + rnd(.3, 1.2) : kind === 'long' ? rnd(240, 470) : kind === 'max' ? 480 - (spec.lenMode === 'oal' ? 0 : A.ext + B.ext) : Math.max(minWp + 1.5, rnd(6, 96));
  let len = spec.lenMode === 'oal' ? wp + A.ext + B.ext : wp;
  if (kind === 'max') len = spec.lenMode === 'oal' ? 480 : wp;
  if (style === 'dec') { spec.len = r3(len) + (kind === 'short' ? .001 : 0); spec.lenStyle = 'dec'; } else { spec.len = Math.ceil(len * 16) / 16; spec.lenStyle = style; }
  return spec;
}
const END_COMBOS = [['sq', 'sq'], ['miter', 'sq'], ['sq', 'miter'], ['miter', 'miter'], ['saddle', 'sq'], ['sq', 'saddle'], ['saddle', 'miter'], ['miter', 'saddle'], ['saddle', 'saddle']];
const mkEnd = (kind, od, odd) => kind === 'sq' ? { mode: 'sq' } : kind === 'miter' ? mkMiter(odd) : mkSaddle(od);

// ---- L1: wide and cheap (calc + DXF + CSV only)
{ let k = 0;
  for (const nps of O.NPS) for (const sch of O.SCHEDS) for (let v = 0; v < (QUICK ? 1 : 9); v++, k++) {      // every size x schedule x every end combination
    const combo = END_COMBOS[(k + v) % 9], od = O.B36_OD[nps], spec = { fam: 'pipe', nps, sch, lenMode: k % 2 ? 'oal' : 'wp', A: mkEnd(combo[0], od, k % 5 === 0), B: mkEnd(combo[1], od, k % 7 === 0) };
    mkLen(spec, ['mid', 'short', 'long', 'mid', 'max'][k % 5], k % 3 === 0 ? 'dec' : LEN_STYLES[k % 6]);
    if (v % 3 === 2) spec.holes = mkHoles(spec, 1 + (k % 3));
    add(1, 'L1-pipe', nps.replace(/ /g, '_') + '-' + sch + '-' + combo.join('+') + '-' + k, spec);
  }
  // every header size >= branch, set-on and set-thru, angle 20..90, roll
  for (const bn of O.NPS) for (const hn of hdrsFor(O.B36_OD[bn])) for (const seat of ['on', 'thru']) {
    const bs = pick(O.SCHEDS), hs = pick(O.SCHEDS), od = O.B36_OD[bn], hod = O.B36_OD[hn], hw = O.B36_WALL[hs][hn];
    if (seat === 'thru' && od > hod - 2 * hw) continue;
    for (let v = 0; v < (QUICK ? 1 : 3); v++, k++) { const sd = { mode: 'saddle', hdr: { nps: hn, sch: hs }, ang: v === 0 ? 90 : pick([20, 25, 30, 37.5, 45, 52, 60, 67.5, 75, 82, 88]), roll: v === 2 ? pick([10, 27, 45, 90, 133, 180, 270]) : 0, seat };
      const spec = { fam: 'pipe', nps: bn, sch: bs, lenMode: k % 2 ? 'oal' : 'wp', A: k % 3 === 0 ? { mode: 'sq' } : sd, B: k % 3 === 0 ? sd : k % 3 === 1 ? { mode: 'sq' } : Object.assign({}, sd, { roll: 0 }) };
      mkLen(spec, k % 4 === 0 ? 'short' : 'mid', k % 2 ? 'frac' : 'dec');
      add(1, 'L1-saddle', bn.replace(/ /g, '_') + '.' + bs + '-' + seat + '-' + hn.replace(/ /g, '_') + '.' + hs + '-' + sd.ang + '-' + k, spec); }
  }
  // round tube: OD and wall typed as decimals and as fractions; custom header saddles
  const TOD = [.5, .75, 1, 1.25, 1.5, 1.75, 2, 2.375, 2.5, 3, 3.5, 4, 4.5, 5, 6, 8, 10], TW = [.035, .049, .065, .083, .095, .109, .12, .125, .134, .1875, .25, .3125, .375, .5];
  for (const od of TOD) for (const t of TW) { if (t > od / 2 - .05) continue; k++; if (QUICK && k % 6) continue;
    const combo = END_COMBOS[k % 9], fracOd = Number.isInteger(od * 16) && k % 2 === 0, fracT = Number.isInteger(t * 16);
    const sd = () => { const hod = r3(od + pick([0, .5, 1.125, 2.75, 6])), hw = pick([.065, .12, .25, .375]); return { mode: 'saddle', hod, hw: Math.min(hw, r3(hod / 4)), hodT: Number.isInteger(hod * 16) && rng() < .5 ? O.typed(hod, 'frac') : String(hod), hwT: null, ang: pick([90, 60, 45, 30]), roll: pick([0, 0, 90]), seat: 'on' }; };
    const mk = (kind) => { if (kind !== 'saddle') return mkEnd(kind, od, k % 4 === 0); const e = sd(); e.hwT = Number.isInteger(e.hw * 16) ? O.typed(e.hw, 'frac') : O.typed(e.hw, 'dec0'); if (rng() < .3 && od <= e.hod - 2 * e.hw) e.seat = 'thru'; return e; };
    const spec = { fam: 'tube', od, t, odT: fracOd ? O.typed(od, 'frac') : String(od), wallT: fracT && k % 3 ? O.typed(t, 'frac') : O.typed(t, k % 2 ? 'dec0' : 'dec'), lenMode: k % 2 ? 'oal' : 'wp', A: mk(combo[0]), B: mk(combo[1]) };
    mkLen(spec, ['mid', 'short', 'long'][k % 3], k % 2 ? 'dec' : LEN_STYLES[k % 6]);
    if (k % 4 === 1) spec.holes = mkHoles(spec, 2);
    add(1, 'L1-tube', od + 'x' + t + '-' + combo.join('+') + '-' + k, spec);
  }
  // holes on pipe, every pattern feature
  for (let i = 0; i < (QUICK ? 40 : 500); i++, k++) { const nps = pick(O.NPS), sch = pick(O.SCHEDS), combo = END_COMBOS[k % 9], od = O.B36_OD[nps];
    const spec = { fam: 'pipe', nps, sch, lenMode: k % 2 ? 'oal' : 'wp', A: mkEnd(combo[0], od, false), B: mkEnd(combo[1], od, false) };
    mkLen(spec, i % 6 === 0 ? 'long' : 'mid', i % 2 ? 'frac' : 'dec'); spec.holes = mkHoles(spec, 1 + (i % 4), i % 5 === 0 ? 'many' : null);
    add(1, 'L1-holes', nps.replace(/ /g, '_') + '-' + sch + '-' + combo.join('+') + '-' + k, spec); }
}
/** Hole groups that fit this part (oracle-checked: clear of the ends, the seam and each other). */
function mkHoles(spec, nGroups, flavour) {
  finishSpec(spec); const base = Object.assign({}, spec, { holes: [] }), sec = O.section(spec.od, spec.t), out = [];
  const ex0 = O.expectedPart(base), span = ex0.xBfull - ex0.xAfull;
  for (let gi = 0, tries = 0; gi < nGroups && tries < 40; tries++) {
    const type = pick(['cust', 'cust', 'olet', 'stub']); const g = { type, ref: pick(['A', 'B']), both: false, style: pick(['frac', 'frac', 'dec']) };
    if (type === 'cust') g.dia = pick([.25, .375, .5, .5625, .8125, 1, 1.25, 1.5, 2, 3, .201, 1.049, 4.026].filter(d => d < sec.od * .8)) || r3(sec.od * .3);
    else { const ok = O.NPS.filter(n => (type === 'stub' ? O.B36_OD[n] < 2 * sec.ri * .92 : O.B36_OD[n] < sec.od * .9)); if (!ok.length) continue; g.bnps = pick(ok); g.bsch = pick(O.SCHEDS); }
    const dia = type === 'cust' ? g.dia : O.B36_OD[g.bnps];
    if (span < dia + 1) continue;
    const half = Math.asin(Math.min(.999, (dia / 2) / (type === 'stub' ? sec.ri : sec.ro))) / RAD;
    const azPat = pick(flavour === 'few' ? ['one', 'one', 'pair', 'seam', 'odd'] : ['one', 'one', 'pair', 'three', 'four', 'seam', 'odd']);
    if (azPat === 'one') { g.az0 = pick([0, 90, 270, 150, 210, 45, 315, 30]); g.azn = 1; g.azp = 90; }
    else if (azPat === 'pair') { g.az0 = 90; g.azn = 2; g.azp = 180; }
    else if (azPat === 'three') { g.az0 = pick([0, 60]); g.azn = 3; g.azp = 120; if (g.az0 === 60) g.az0 = 300; }      // 300, 60, 180 would hit the seam: 300,420=60,540=180 -> use 0,120,240
    else if (azPat === 'four') { g.az0 = 45; g.azn = 4; g.azp = 90; }
    else if (azPat === 'seam') { g.az0 = r3(180 + (rng() < .5 ? 1 : -1) * (half + rnd(.3, 3))); g.azn = 1; g.azp = 90; }       // just clear of the 180 deg seam
    else { g.az0 = r3(rnd(-170, 170)); g.azn = pick([1, 2]); g.azp = pick([33, 72.5, 180]); }
    if (g.azn === 3 && g.az0 === 300) { g.az0 = 0; }
    const room = span - dia - .5, lead = ex0.xAfull - ex0.xA0, tail = ex0.xB1 - ex0.xBfull, off = (g.ref === 'A' ? (spec.lenMode === 'oal' ? lead : ex0.xAfull) : (spec.lenMode === 'oal' ? tail : ex0.L - ex0.xBfull)) + dia / 2 + .25;
    const snap = (v) => g.style === 'dec' ? r3(v) : Math.ceil(v * 16) / 16;
    const pat = flavour === 'many' ? 'pattern' : pick(['single', 'pattern', 'list', 'both', 'nearend']);
    if (pat === 'single') { g.x0 = snap(off + rnd(0, room)); g.pitch = 12; g.n = 1; }
    else if (pat === 'nearend') { g.x0 = snap(off - .25 + .11 + rnd(0, .05)); g.pitch = 12; g.n = 1; }                       // 0.11-0.16 in of land beyond the app's 0.1 in rule at the deepest point of the cut
    else if (pat === 'pattern') { const n = flavour === 'many' ? 2 + Math.floor(rng() * 10) : flavour === 'few' ? 2 : 2 + Math.floor(rng() * 3), p = snap(Math.max(dia + .25, Math.min(room / n, rnd(dia + .25, 12)))); g.n = Math.max(1, Math.min(n, Math.floor(room / p) + 1)); g.pitch = p; g.x0 = snap(off); }
    else if (pat === 'list') { const n = 1 + Math.floor(rng() * 3); g.xs = []; let x = off; for (let i = 0; i < n && x < off + room; i++) { x = snap(x + (i ? dia + .25 + rnd(0, room / 4) : rnd(0, room / 4))); if (x <= off + room) g.xs.push(x); } if (!g.xs.length) g.xs = [snap(off)]; }
    else { g.both = true; g.x0 = snap(off + rnd(0, Math.max(0, room / 2 - dia))); g.pitch = snap(dia + .5); g.n = 1; }
    const trial = Object.assign({}, spec, { holes: out.concat([g]) }), ex = O.expectedPart(trial);
    if (ex.mustBlock || ex.holes.some(h => h.overlap || h.endClearCentre < .1 + 2e-3 || h.endClear < .02 || h.seamClear < .01)) continue;
    out.push(g); gi++;
  }
  return out;
}

// ---- L2: the exported IGES (sampled: every pipe size x schedule, every end type, every hole feature)
{ let k = 0; const Q = (i, every) => i % every === 0;
  // every NPS x schedule once
  for (const nps of O.NPS) for (const sch of O.SCHEDS) { k++; const od = O.B36_OD[nps], sadd = k % 9 === 4, combo = sadd ? (k % 2 ? ['saddle', 'sq'] : ['sq', 'saddle']) : [['sq', 'sq'], ['miter', 'sq'], ['sq', 'miter'], ['miter', 'miter']][k % 4];
    const spec = { fam: 'pipe', nps, sch, lenMode: k % 2 ? 'oal' : 'wp', A: mkEnd(combo[0], od, k % 6 === 1), B: mkEnd(combo[1], od, k % 6 === 3) };
    if (k % 19 === 7) spec.mat = pick(['304L', 'AL6061', '316L']);
    mkLen(spec, ['mid', 'short', 'long', 'mid', 'max', 'short'][k % 6], k % 3 === 0 ? 'dec' : LEN_STYLES[k % 6]);
    add(2, 'L2-pipe', nps.replace(/ /g, '_') + '-' + sch + '-' + combo.join('+'), spec, { quick: k % 13 === 5 }); }
  // round tube
  { const T = [[.5, .065, '1/2', '.065'], [.75, .049, '.75', '.049'], [1, .083, '1', '.083'], [1.25, .12, '1 1/4', '.120'], [1.5, .1875, '1.5', '3/16'], [1.75, .134, '1 3/4', '.134'], [2, .25, '2', '1/4'], [2.375, .154, '2 3/8', '0.154'], [2.5, .3125, '2-1/2', '5/16'], [3, .375, '3', '3/8'], [3.5, .109, '3.5', '.109'], [4, .5, '4', '1/2'], [5, .25, '5', '.25'], [6, .1875, '6', '.1875'], [8, .375, '8', '.375'], [10, .5, '10', '1/2'], [1.315, .133, '1.315', '.133'], [4.75, .22, '4 3/4', '.22']];
    T.forEach(([od, t, odT, wallT], i) => { k++; const combo = END_COMBOS[[0, 1, 2, 3, 0, 3, 1, 5, 2, 4, 3, 1, 8, 2, 6, 3, 7, 0][i]];
      const mk = (kind) => { if (kind !== 'saddle') return mkEnd(kind, od, i % 5 === 2); const hod = r3(od + [0, 1.125, 2.75][i % 3]), hw = [.12, .25, .375][i % 3]; return { mode: 'saddle', hod, hw, hodT: String(hod), hwT: O.typed(hw, i % 2 && Number.isInteger(hw * 16) ? 'frac' : 'dec0'), ang: [90, 60, 45][i % 3], roll: [0, 90, 0][i % 3], seat: i % 4 === 3 && od <= hod - 2 * hw ? 'thru' : 'on' }; };
      const spec = { fam: 'tube', od, t, odT, wallT, lenMode: i % 2 ? 'wp' : 'oal', A: mk(combo[0]), B: mk(combo[1]) };
      mkLen(spec, ['mid', 'short', 'long'][i % 3], i % 2 ? 'dec' : LEN_STYLES[i % 6]);
      add(2, 'L2-tube', odT.replace(/[ /]/g, '_') + 'x' + wallT.replace(/\//g, '_') + '-' + combo.join('+'), spec, { quick: i === 1 || i === 7 }); }); }
  // saddles: every header size appears, set-on / set-thru, 20..90 deg, roll, both ends, with a miter
  O.NPS.forEach((hn, i) => { k++; const cand = O.NPS.filter(n => O.B36_OD[n] <= O.B36_OD[hn]), bn = cand[Math.floor(rng() * cand.length)], bs = pick(['10', 'STD', '40', 'XS', '80', '160']), od = O.B36_OD[bn];
    const sd = mkSaddle(od, { hdr: hn, ang: [90, 45, 60, 30, 75, 20, 90, 37.5][i % 8], roll: [0, 0, 90, 0, 45, 0, 180, 15][i % 8], seat: i % 3 === 1 ? 'thru' : 'on' });
    const other = [{ mode: 'sq' }, mkMiter(false), { mode: 'sq' }, null][i % 4];
    const spec = { fam: 'pipe', nps: bn, sch: bs, lenMode: i % 2 ? 'oal' : 'wp', A: i % 2 ? sd : (other || Object.assign({}, sd, { roll: 0 })), B: i % 2 ? (other || Object.assign({}, sd, { ang: 90 })) : sd };
    mkLen(spec, i % 3 === 0 ? 'short' : 'mid', i % 2 ? 'frac' : 'dec');
    add(2, 'L2-saddle', bn.replace(/ /g, '_') + '.' + bs + '-to-' + hn.replace(/ /g, '_') + '.' + sd.hdr.sch + '-' + sd.ang + 'deg-' + sd.seat + (sd.roll ? '-roll' + sd.roll : ''), spec, { quick: i === 0 || i === 14 }); });
  for (const [bn, bs, hn, hs, ang, seat, roll] of [['2', '40', '2', '40', 90, 'on', 0], ['6', '40', '6', '40', 90, 'on', 0], ['24', '10', '24', '10', 90, 'on', 10], ['1', '80', '24', 'XS', 20, 'on', 0], ['3', '40', '4', '10', 90, 'thru', 0], ['8', '10', '10', '10', 60, 'thru', 27]]) {
    k++; const spec = { fam: 'pipe', nps: bn, sch: bs, lenMode: k % 2 ? 'oal' : 'wp', A: { mode: 'saddle', hdr: { nps: hn, sch: hs }, ang, roll, seat }, B: { mode: 'sq' } };
    mkLen(spec, 'mid', 'frac'); add(2, 'L2-saddle', 'pick-' + bn + '.' + bs + '-to-' + hn + '.' + hs + '-' + ang + 'deg-' + seat + (roll ? '-roll' + roll : ''), spec, { quick: bn === '6' }); }
  // holes
  const H = (id, base, holes, extra) => { const spec = Object.assign({ fam: 'pipe', nps: '6', sch: '40', lenMode: 'oal', A: { mode: 'sq' }, B: { mode: 'sq' }, len: 48, lenStyle: 'frac' }, base, { holes }); add(2, 'L2-holes', id, spec, extra); };
  const g1 = (o) => Object.assign({ type: 'cust', dia: 1, ref: 'A', both: false, x0: 12, pitch: 6, n: 1, az0: 0, azn: 1, azp: 90 }, o);
  H('cust-1in-top', {}, [g1({})], { quick: true });
  H('cust-1in-3oclock', {}, [g1({ az0: 90 })]);
  H('cust-1in-45', {}, [g1({ az0: 45 })], { quick: true });
  H('cust-1in-150-210', {}, [g1({ az0: 150 }), g1({ az0: 210, x0: 20 })]);
  H('cust-2in-9oclock-refB', { lenMode: 'wp' }, [g1({ dia: 2, az0: 270, ref: 'B', x0: 9.5 })]);
  H('cust-3+9-both-sides', {}, [g1({ dia: .8125, az0: 90, azn: 2, azp: 180, x0: 8 })]);
  H('cust-4-around-45', {}, [g1({ dia: .5625, az0: 45, azn: 4, azp: 90, x0: 10 })]);
  H('cust-list-xs', {}, [g1({ dia: .75, xs: [4.5, 11.0625, 30.3125], az0: 30 })]);
  H('cust-both-ends', {}, [g1({ dia: 1, both: true, x0: 6, az0: 0 })]);
  H('cust-near-seam', {}, [g1({ dia: 1, az0: 190.5, x0: 10 }), g1({ dia: 1, az0: 169.5, x0: 16 })]);
  H('cust-near-sq-end', {}, [g1({ dia: 1, x0: .625, az0: 0 }), g1({ dia: 1, x0: .625, az0: 90, ref: 'B' })]);
  H('olet-1-STD', { nps: '8', sch: '40' }, [g1({ type: 'olet', bnps: '1', bsch: 'STD', az0: 0, x0: 15.375 })], { quick: true });
  H('olet-2-80-and-stub-2', { nps: '8', sch: '80' }, [g1({ type: 'olet', bnps: '2', bsch: '80', az0: 90, x0: 10 }), g1({ type: 'stub', bnps: '2', az0: 270, x0: 22 })]);
  H('stub-4-on-8', { nps: '8', sch: '40' }, [g1({ type: 'stub', bnps: '4', az0: 0, x0: 24 })], { quick: true });
  H('stub-3-on-4-xs', { nps: '4', sch: 'XS' }, [g1({ type: 'stub', bnps: '3', az0: 30, x0: 20 })]);
  H('olet-6-on-12', { nps: '12', sch: 'STD' }, [g1({ type: 'olet', bnps: '6', bsch: '40', az0: 0, x0: 20 })]);
  H('big-hole-5in-on-6', {}, [g1({ dia: 5, az0: 0, x0: 20 })]);
  H('hole-wider-than-bore-6.2-on-6', {}, [g1({ dia: 6.2, az0: 0, x0: 20 })]);
  H('small-hole-on-24', { nps: '24', sch: 'STD', len: 60 }, [g1({ dia: .5, az0: 0, x0: 10 }), g1({ dia: 2, az0: 45, x0: 20 }), g1({ dia: 4, az0: 300, x0: 40 })]);
  H('half-in-pipe-hole', { nps: '1/2', sch: '80', len: 12 }, [g1({ dia: .25, az0: 0, x0: 3 }), g1({ dia: .375, az0: 90, x0: 6 })]);
  H('miterA-oal-refA+refB', { A: { mode: 'miter', ang: 45, rot: 0 } }, [g1({ x0: 9, az0: 0 }), g1({ x0: 8, az0: 90, ref: 'B' })], { quick: true });
  H('miterA-wp-refA', { lenMode: 'wp', A: { mode: 'miter', ang: 30, rot: 90 } }, [g1({ x0: 9, az0: 0 }), g1({ x0: 14.3125, az0: 270 })]);
  H('miter-both-oal-list', { A: { mode: 'miter', ang: 22.5, rot: 0 }, B: { mode: 'miter', ang: 22.5, rot: 180 }, len: 60.4375 }, [g1({ dia: .5625, xs: [6, 30.21875, 54.4375], az0: 90 })]);
  H('saddleA-oal-refA', { nps: '4', sch: '40', A: { mode: 'saddle', hdr: { nps: '8', sch: '40' }, ang: 90, roll: 0, seat: 'on' }, len: 36 }, [g1({ x0: 6, az0: 0, dia: .75 })], { quick: true });
  H('saddleB-wp-refB', { nps: '4', sch: '40', lenMode: 'wp', B: { mode: 'saddle', hdr: { nps: '10', sch: '40' }, ang: 60, roll: 0, seat: 'on' }, len: 36 }, [g1({ x0: 12, az0: 45, dia: .75, ref: 'B' })]);
  H('tube-holes', { fam: 'tube', od: 2, t: .12, odT: '2', wallT: '.120', len: 24 }, [g1({ dia: .5, x0: 4, az0: 0, n: 3, pitch: 4 })]);
  H('many-9', { len: 96 }, [g1({ dia: .5625, x0: 6, pitch: 12.5, n: 3, az0: 60, azn: 3, azp: 120, style: 'dec' })]);
  for (let i = 0; i < 4; i++) { k++; const nps = pick(['2', '3', '4', '6', '8', '10', '12', '16']), sch = pick(O.SCHEDS), combo = END_COMBOS[[1, 3, 4, 5][i]], od = O.B36_OD[nps];
    const spec = { fam: 'pipe', nps, sch, lenMode: i % 2 ? 'wp' : 'oal', A: mkEnd(combo[0], od, false), B: mkEnd(combo[1], od, false) }; mkLen(spec, 'mid', i % 2 ? 'dec' : 'frac'); spec.holes = mkHoles(spec, 1, 'few');
    add(2, 'L2-holes', 'rand' + i + '-' + nps + '-' + sch + '-' + combo.join('+'), spec); }
}

// ---- parts that must NOT export (and parts near those limits that must)
{ const N = (id, base, extra) => { const spec = Object.assign({ fam: 'pipe', nps: '6', sch: '40', lenMode: 'oal', A: { mode: 'sq' }, B: { mode: 'sq' }, len: 48, lenStyle: 'dec' }, base); add(2, 'L2-limits', id, spec, Object.assign({ quick: true }, extra)); };
  const g1 = (o) => Object.assign({ type: 'cust', dia: 1, ref: 'A', both: false, x0: 12, pitch: 6, n: 1, az0: 0, azn: 1, azp: 90 }, o);
  N('hole-on-seam', { holes: [g1({ az0: 180 })] });
  N('hole-edge-over-seam', { holes: [g1({ az0: 172 })] });
  N('hole-off-sq-end', { holes: [g1({ x0: .25 })] });
  N('hole-as-wide-as-pipe', { holes: [g1({ dia: 6.625 })] });
  N('stub-as-wide-as-bore', { nps: '4', holes: [g1({ type: 'stub', bnps: '4' })] });
  N('branch-bigger-than-header', { nps: '8', A: { mode: 'saddle', hdr: { nps: '6', sch: '40' }, ang: 90, roll: 0, seat: 'on' } });
  N('set-thru-will-not-pass', { nps: '6', A: { mode: 'saddle', hdr: { nps: '6', sch: '40' }, ang: 90, roll: 0, seat: 'thru' } });
  N('miters-cross', { lenMode: 'wp', len: 4, A: { mode: 'miter', ang: 60, rot: 0 }, B: { mode: 'miter', ang: 60, rot: 0 } });
  N('oal-shorter-than-cuts', { len: 5, A: { mode: 'miter', ang: 45, rot: 0 }, B: { mode: 'miter', ang: 45, rot: 180 } });
  // the hole clears the end cut at its own centre line but not across its width (miter turned 90 deg from the hole)
  N('hole-breaks-miter-off-centre', { lenMode: 'wp', A: { mode: 'miter', ang: 45, rot: 90 }, holes: [g1({ dia: 2, x0: 1.125, az0: 0 })] });
  { const sdl = { mode: 'saddle', hdr: { nps: '8', sch: '40' }, ang: 45, roll: 0, seat: 'on' }, sec = O.pipeSection('4', '40'), S90 = O.saddleFn(sec, { hod: 8.625, hw: .322, ang: 45, roll: 0, seat: 'on' }).S(PI / 2);
    N('hole-breaks-45deg-saddle-off-centre', { nps: '4', lenMode: 'wp', A: sdl, holes: [g1({ dia: 2, x0: r3(S90 + 1 + .125), az0: 90, style: 'dec' })] }, { quick: false }); }
  N('hole-1in-clear-of-miter-long-side', { A: { mode: 'miter', ang: 45, rot: 0 }, holes: [g1({ dia: 1, x0: 1, az0: 0 })] });
}

// ------------------------------------------------------------------ direct checks (tables, typed-value handling, rolling offset)
async function directChecks() {
  cur = { id: 'direct/tables', level: 0, patch: null };
  for (const n of O.NPS) rec('table.od', DB.PIPE_OD[n] === O.B36_OD[n], { what: 'profile-db PIPE_OD ' + n + ' vs ASME B36.10', expected: O.B36_OD[n], measured: DB.PIPE_OD[n] });
  for (const s of O.SCHEDS) for (const n of O.NPS) rec('table.wall', DB.PIPE_WALL[s] && DB.PIPE_WALL[s][n] === O.B36_WALL[s][n], { what: 'profile-db PIPE_WALL sch ' + s + ' NPS ' + n + ' vs ASME B36.10', expected: O.B36_WALL[s][n], measured: DB.PIPE_WALL[s] && DB.PIPE_WALL[s][n] });
  rec('table.keys', Object.keys(DB.PIPE_OD).length === O.NPS.length && DB.PIPE_SCHEDS.length === O.SCHEDS.length && Object.keys(DB.PIPE_WALL).length === O.SCHEDS.length, { what: 'profile-db has exactly the sizes / schedules the oracle covers', expected: O.NPS.length + ' x ' + O.SCHEDS.length, measured: Object.keys(DB.PIPE_OD).length + ' x ' + DB.PIPE_SCHEDS.length });
  // ---- typed lengths: every way a fitter writes 37 7/16 and friends must give that number
  for (const [txt, want] of [['37 7/16', 37.4375], ['37-7/16', 37.4375], ['37.4375', 37.4375], ["3'-1 7/16", 37.4375], ["3'-1 7/16\"", 37.4375], ["3' 1 7/16", 37.4375], ['37 7/16"', 37.4375], ["3'1-7/16", 37.4375], ["40'", 480], ["40'-0", 480], ["40'-0\"", 480], ['480', 480], ['.5', .5], ['0.5', .5], ['1/2', .5], ['11/16', .6875], ["0'-11/16", .6875], ["10'-0 1/16", 120.0625], ['120 1/16', 120.0625], ["12'-6 3/8", 150.375], ["3' 1.4375", 37.4375], ['37 14/32', 37.4375], ["3'-1 7/16 ", 37.4375], [' 37.4375 ', 37.4375], ["6 1/2'", 78], ["3.5'", 42], ['3ft 1 7/16', 37.4375], ['37 7/16 in', 37.4375], ['37,4375', 37.4375], ["3'-1 7/16''", 37.4375], ['951mm', 37.4409]]) {
    cur = { id: 'direct/length "' + txt + '"', level: 0, patch: { family: 'pipe', lenMode: 'oal', lenT: txt } };
    const c = await freshApp(); applyPatch(c, cur.patch); const r = c.calc(), bl = c.blocked(r);
    // either the typed length is the part's overall length, or the part is blocked - never a different length without a red item
    rec('typed.length', bl || Math.abs(r.OAL - want) <= 1e-6, { what: 'typed length "' + txt + '" must give ' + want + ' in or be refused', expected: want, measured: bl ? 'blocked' : +r.OAL.toFixed(4) });
    if (bl) notes.push('length "' + txt + '" is refused (red item) - not read as ' + want);
  }
  // ---- typed values the form accepts: the cut must be what was typed, or a red item must say it is not
  const E0 = { mode: 'sq' };
  const silent = async (id, patch, describe, measure, want, tol) => { cur = { id: 'direct/' + id, level: 0, patch }; const c = await freshApp(); applyPatch(c, patch); const r = c.calc(), bl = c.blocked(r); let got = NaN; try { got = measure(r, c); } catch (e) { }
    const warned = (r.warns || []).some(w => w.lvl === 'warn' && !/ONE wall|over 65/.test(w.t));
    rec('typed.value', bl || Math.abs(got - want) <= (tol || 1e-6), { what: describe + ' - used as typed, or refused with a red item', expected: want, measured: bl ? 'blocked' : +(+got).toFixed(5) + (warned ? ' (with a caution)' : ' (no warning at all)') }); };
  const angOf = (r, k) => Math.atan(r[k].tanm) / RAD;
  await silent('miter-80', { ends: { A: { mode: 'miter', maT: '80', mrT: '0' }, B: E0 } }, 'miter typed 80 deg', (r) => angOf(r, 'A'), 80);
  await silent('miter--80', { ends: { A: E0, B: { mode: 'miter', maT: '-80', mrT: '0' } } }, 'miter typed -80 deg', (r) => angOf(r, 'B'), -80);
  await silent('miter-22 1/2', { ends: { A: { mode: 'miter', maT: '22 1/2', mrT: '0' }, B: E0 } }, 'miter typed "22 1/2" deg', (r) => angOf(r, 'A'), 22.5);
  await silent('miter-rot-22 1/2', { ends: { A: { mode: 'miter', maT: '30', mrT: '22 1/2' }, B: E0 } }, 'miter rotation typed "22 1/2" deg', (r) => r.A.mr / RAD, 22.5);
  await silent('saddle-angle-37 1/2', { ends: { A: { mode: 'saddle', sdN: '10', sdS: '40', sdAT: '37 1/2' }, B: E0 } }, 'saddle branch angle typed "37 1/2" deg', (r) => r.A.sd.alpha / RAD, 37.5);
  await silent('saddle-roll-junk', { ends: { A: { mode: 'saddle', sdN: '10', sdS: '40', sdAT: '60', sdRT: 'x' }, B: E0 } }, 'saddle roll typed "x"', (r) => r.A.sd.roll / RAD, NaN);
  await silent('miter-blank', { ends: { A: { mode: 'miter', maT: '', mrT: '0' }, B: E0 } }, 'miter angle left blank (cuts square)', (r) => angOf(r, 'A'), NaN);
  await silent('miter-45deg-text', { ends: { A: { mode: 'miter', maT: '45°', mrT: '0' }, B: E0 } }, 'miter typed "45°"', (r) => angOf(r, 'A'), 45);
  await silent('saddle-angle-10', { ends: { A: { mode: 'saddle', sdN: '10', sdS: '40', sdAT: '10' }, B: E0 } }, 'saddle branch angle typed 10 deg', (r) => r.A.sd.alpha / RAD, 10);
  await silent('saddle-angle-120', { ends: { A: { mode: 'saddle', sdN: '10', sdS: '40', sdAT: '120' }, B: E0 } }, 'saddle branch angle typed 120 deg', (r) => r.A.sd.alpha / RAD, 120);
  await silent('saddle-angle-blank', { ends: { A: { mode: 'saddle', sdN: '10', sdS: '40', sdAT: '' }, B: E0 } }, 'saddle branch angle left blank (cuts 90)', (r) => r.A.sd.alpha / RAD, NaN);
  await silent('saddle-cust-wall-junk', { ends: { A: { mode: 'saddle', sdHT: 'cust', sdHodT: '10.75', sdHwT: 'x', sdSeat: 'thru' }, B: E0 } }, 'custom header wall typed "x" (set-thru seat radius depends on it)', (r) => r.A.sd.hw, NaN);
  await silent('saddle-cust-wall-too-thick', { ends: { A: { mode: 'saddle', sdHT: 'cust', sdHodT: '8', sdHwT: '5', sdSeat: 'thru' }, B: E0 } }, 'custom header wall typed 5 on an 8 OD header', (r) => r.A.sd.hw, 5);
  await silent('saddle-cust-od-junk', { ends: { A: { mode: 'saddle', sdHT: 'cust', sdHodT: 'ten', sdHwT: '.365' }, B: E0 } }, 'custom header OD typed "ten"', (r) => r.A.sd.hod, NaN);
  await silent('tube-od-junk', { family: 'tube', todT: 'x', twallT: '.120' }, 'tube OD typed "x"', (r) => r.sec.od, NaN);
  await silent('tube-od-zero', { family: 'tube', todT: '0', twallT: '.120' }, 'tube OD typed 0', (r) => r.sec.od, 0);
  await silent('tube-od-2.5in-mark', { family: 'tube', todT: '2 1/2"', twallT: '.120' }, 'tube OD typed 2 1/2"', (r) => r.sec.od, 2.5);
  await silent('tube-wall-junk', { family: 'tube', todT: '2', twallT: 'abc' }, 'tube wall typed "abc"', (r) => r.sec.t, NaN);
  await silent('tube-wall-zero', { family: 'tube', todT: '2', twallT: '0' }, 'tube wall typed 0', (r) => r.sec.t, 0);
  await silent('tube-wall-too-thick', { family: 'tube', todT: '2', twallT: '1.5' }, 'tube wall typed 1.5 on a 2 OD tube', (r) => r.sec.t, 1.5);
  await silent('tube-wall-14ga', { family: 'tube', todT: '2', twallT: '14 GA' }, 'tube wall typed "14 GA" (0.083)', (r) => r.sec.t, .083);
  const G = (o) => [Object.assign({ type: 'cust', diaT: '1', refEnd: 'A', x0T: '12', pT: '6', nT: '1', azT: '0', aznT: '1', azpT: '90', xsT: '' }, o)];
  const hx = (r) => r.holes.filter(h => h.ok).map(h => h.x), HP = (o) => ({ lenT: '48', wantHoles: true, groups: G(o) });
  await silent('hole-dia-junk', HP({ diaT: 'abc' }), 'hole diameter typed "abc"', (r) => r.holes[0].dia, NaN);
  await silent('hole-dia-zero', HP({ diaT: '0' }), 'hole diameter typed 0', (r) => r.holes[0].dia, 0);
  await silent('hole-dia-13/16in', HP({ diaT: '13/16"' }), 'hole diameter typed 13/16"', (r) => r.holes[0].dia, .8125);
  await silent('hole-x0-junk', HP({ x0T: 'abc' }), 'first-hole distance typed "abc"', (r) => hx(r)[0], NaN);
  await silent('hole-x0-blank', HP({ x0T: '' }), 'first-hole distance left blank', (r) => hx(r)[0], NaN);
  await silent('hole-pitch-junk', HP({ nT: '3', pT: 'abc' }), 'hole spacing typed "abc" (3 holes)', (r) => hx(r)[1] - hx(r)[0], NaN);
  await silent('hole-qty-0', HP({ nT: '0' }), 'hole quantity typed 0', (r) => hx(r).length, 0);
  await silent('hole-qty-61', Object.assign(HP({ nT: '61', pT: '1', x0T: '2', diaT: '1/2' }), { lenT: '96' }), 'hole quantity typed 61', (r) => hx(r).length, 61);
  await silent('hole-qty-2.5', HP({ nT: '2.5' }), 'hole quantity typed 2.5', (r) => hx(r).length, 2.5);
  await silent('hole-list-bad-token', HP({ xsT: '6, 1o, 20' }), 'exact-spots list "6, 1o, 20" (3 holes asked for)', (r) => hx(r).length, 3);
  await silent('hole-list-space-separated', HP({ xsT: '6 12 20' }), 'exact-spots list "6 12 20" (3 holes asked for)', (r) => hx(r).length, 3);
  await silent('hole-list-61', Object.assign(HP({ diaT: '1/4', xsT: Array.from({ length: 61 }, (_, i) => String(2 + i)).join(',') }), { lenT: '96' }), 'exact-spots list with 61 entries', (r) => hx(r).length, 61);
  await silent('hole-az-22 1/2', HP({ azT: '22 1/2' }), 'clock angle typed "22 1/2" deg', (r) => r.holes[0].deg, 22.5);
  await silent('hole-az-junk', HP({ azT: 'top' }), 'clock angle typed "top"', (r) => r.holes[0].deg, NaN);
  await silent('hole-az-count-25', HP({ diaT: '1/4', azT: '5', aznT: '25', azpT: '14' }), '25 holes around asked for', (r) => r.holes.length, 25);
  await silent('hole-az-pitch-0', HP({ aznT: '2', azpT: '0', azT: '10' }), 'holes around: 2 at 0 deg apart (second = first)', (r) => r.holes[1].deg, 10);
  await silent('hole-both-centred', HP({ both: true, x0T: '24' }), 'both ends, hole at mid-length (one hole expected)', (r) => hx(r).length, 1);
  await silent('hole-both-1/64-off-centre', HP({ both: true, x0T: '23.99' }), 'both ends, 23.99 from each end of a 48 in part (two holes 0.02 apart asked for)', (r) => hx(r).length, 2);

  // ---- rolling offset: set / roll / advance -> length + both miters (handler: renderVals().endSteps[1].roApply)
  for (const [S, R, A, mode] of [[24, 12, 60, 'oal'], [24, 12, 60, 'wp'], [10, 0, 40, 'oal'], [18, 18, 36, 'wp']]) {
    const patch = { family: 'pipe', pnps: '6', psch: '40', lenMode: mode, ends: { A: { mode: 'sq' }, B: { mode: 'miter', roST: String(S), roRT: String(R), roAT: String(A) } } };
    cur = { id: 'direct/rolling-offset S' + S + ' R' + R + ' A' + A + ' ' + mode, level: 0, patch: Object.assign({ then: 'renderVals().endSteps[1].roApply()' }, patch) };
    const c = await freshApp(); applyPatch(c, patch); c.renderVals().endSteps[1].roApply(); const r = c.calc(), sec = O.pipeSection('6', '40');
    const travel = Math.hypot(S, R, A), th = Math.atan2(Math.hypot(S, R), A) / RAD, tw = Math.atan2(R, S) / RAD;
    rec('ro.blocked', !c.blocked(r), { what: 'rolling offset applies to a cuttable part' });
    if (c.blocked(r)) continue;
    near('ro.miter', Math.atan(r.A.tanm) / RAD, th / 2, .05 + 1e-9, 'each end is mitered half the offset angle (form rounds to 0.1 deg)'); near('ro.miterB', Math.atan(r.B.tanm) / RAD, th / 2, .05 + 1e-9, 'End B miter');
    near('ro.twistA', r.A.mr / RAD, tw, .5 + 1e-9, 'End A long point at the twist angle (form rounds to 1 deg)'); near('ro.twistB', r.B.mr / RAD, tw + 180, .5 + 1e-9, 'End B long point opposite');
    // the travel piece is a centre-to-centre (work point to work point) length
    near('ro.travel', r.L, travel, 1 / 32 + 1e-9, 'work-point length of the piece = travel sqrt(S^2+R^2+A^2) (form rounds to 1/16)');
    stat('rolling offset: twist rounding moves the long point around the OD by (in)', Math.abs(r.A.mr / RAD - tw) * RAD * sec.ro);
  }
}

// ------------------------------------------------------------------ run
let list = cases.filter(cs => (!QUICK || cs.level === 1 || cs.quick) && (!ONLY || cs.id.includes(ONLY)));
if (LIST) { for (const cs of list) console.log('L' + cs.level, cs.id); console.log(list.length + ' cases'); process.exit(0); }
process.on('uncaughtException', (e) => { console.log('STOPPED during ' + (cur && cur.id) + ': ' + String(e && e.message || e).slice(0, 200)); finish(1); });
const tGroup = {};
if (!ONLY) await directChecks();
const l1 = list.filter(cs => cs.level === 1), l2 = list.filter(cs => cs.level === 2);
for (const cs of l1) { const t = Date.now(); await runCase(cs); tGroup[cs.group] = (tGroup[cs.group] || 0) + Date.now() - t; }
if (l2.length) { oc = await loadOcc();
  for (const cs of l2) { const t = Date.now(); await runCase(cs); tGroup[cs.group] = (tGroup[cs.group] || 0) + Date.now() - t; if (argv.includes('--verbose')) console.log(((Date.now() - t) / 1000).toFixed(1).padStart(6) + 's  ' + cs.id + '  ' + JSON.stringify(cs.ms) + '  heap ' + (oc.HEAP8.length / 1048576).toFixed(0) + ' MB'); } }
finish();

function finish(forceCode) {
  const secs = (Date.now() - T0) / 1000, nCases = l1.length + l2.length;
  console.log('\nROUND-PART BACK-TEST  seed ' + SEED + (QUICK ? '  (quick)' : '') + '   cases: ' + l1.length + ' calc/DXF + ' + l2.length + ' IGES   runtime ' + secs.toFixed(0) + ' s');
  console.log('time by group (s): ' + Object.entries(tGroup).map(([k, v]) => k + ' ' + (v / 1000).toFixed(0)).join(', '));
  console.log('\nworst measured (all cases):'); for (const [k, s] of Object.entries(stats)) console.log('  ' + k.padEnd(62) + s.max.toFixed(5).padStart(10) + '   n=' + s.n + '   at ' + s.at);
  if (notes.length) { console.log('\nnotes:'); for (const n of [...new Set(notes)]) console.log('  ' + n); }
  console.log('\nby check:'); for (const [k, b] of Object.entries(byCheck).sort()) console.log('  ' + k.padEnd(22) + String(b.pass).padStart(7) + ' passed' + (b.fail ? String(b.fail).padStart(7) + ' FAILED' : ''));
  if (fails.length) { console.log('\nFAILURES (each with the state patch that reproduces it):'); const shown = {};
    for (const f of fails) { shown[f.check] = (shown[f.check] || 0) + 1; if (!ALL && shown[f.check] > 30) continue;
      console.log('  [' + f.check + '] ' + f.case + '\n      ' + (f.what || '') + '\n      expected ' + JSON.stringify(f.expected) + '  measured ' + JSON.stringify(f.measured) + (f.tol != null ? '  tol ' + f.tol : '') + (f.loopsOff ? '  loops off ' + f.loopsOff : '') + '\n      patch ' + JSON.stringify(f.patch)); }
    for (const [k, n] of Object.entries(shown)) if (!ALL && n > 30) console.log('  [' + k + '] ... ' + (n - 30) + ' more (use --all, or read the --json file)'); }
  if (JSON_OUT) { try { mkdirSync(path.dirname(JSON_OUT), { recursive: true }); writeFileSync(JSON_OUT, JSON.stringify({ suite: 'bt-round', seed: SEED, quick: QUICK, only: ONLY || null, runtime_s: +secs.toFixed(1), cases: { calc_dxf: l1.length, iges: l2.length, total: nCases }, checks: { passed: pass, failed: fail }, by_check: byCheck, worst_measured: stats, notes: [...new Set(notes)], how_to_reproduce: 'import { freshApp } from "./_load.mjs"; import { applyPatch } from "./bt-round.mjs" (or: c = await freshApp(); c.setState(scalars); merge patch.ends.A/B over c.state.ends; groups over Component.defGroup(i+1, family)); r = c.calc()', failures: fails }, null, 1)); console.log('\nfailure list written to ' + JSON_OUT); } catch (e) { console.log('could not write ' + JSON_OUT + ': ' + e.message); } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(forceCode || (fail ? 1 : 0));
}
