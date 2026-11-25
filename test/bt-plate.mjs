// Back-test of the BEAM and CHANNEL exports (calc kind 'plate').
//
//   node test/bt-plate.mjs            full sweep  (every W / S / C / MC size at least once, about 10 minutes)
//   node test/bt-plate.mjs --quick    sample      (about a minute)
//   options: --seed N   --only <text in case id>   --json <file>   --verbose
//
// What it does: fills the form the way the app does (a state patch), lets the app build the true solid and
// write the IGES, reads that file back with the kernel, and MEASURES the read-back shape with straight rays.
// Every expected number comes from this file's own model of the part (typed inputs + AISC dimensions +
// plane geometry) - never from the app's geometry functions.
//
// Conventions the model assumes (each is confirmed by measurement on every case):
//   X along the part, End A at low X. Y up, section centred on Y = 0. Beam web centred on Z = 0.
//   Channel: web centred on Z = 0 (back of channel at Z = -tw/2), toes toward +Z.
//   Work point of an end = where its cut plane crosses the line Y = 0, Z = 0.
//   End A plane: x = -y tan(v) - z tan(p).   End B plane: x = L + y tan(v) + z tan(p).   L = work point to work point.
//   'oal' length = long point to long point; hole stations count from the long points. 'wp' = from the work points.
//   Cope: length c along X from the work point of that end, depth dc down from the outside of the flange, radius r
//   in the re-entrant corner; the flange is cut square at c. Rat hole: radius rr, centred on the web end line,
//   touching the inside of the flange. Web rows: 'tos' down from top of steel, 'bos' up from the bottom,
//   'cl' down from mid-depth. Flange gauge: beam = two lines g apart about the web; channel = g from the back;
//   beam "single line at offset" = one line at z = +g.
//
// Tolerance 0.001 in everywhere except the two arcs the app draws as polylines (stated at the check).
import { loadOcc } from './_occ.mjs';
import { freshApp, Component, DB } from './_load.mjs';
import * as OCCM from '../occ-solid.js';
import { parseDxf, bbox as bbox2, polyArea } from './_geom.mjs';
import { igesTrimCurves } from './_iges.mjs';
import { rayer, sewSolid, volumeExact, genus, igesGlobal, polyScan, subtractIntervals, rng, frac16, ftIn, dec, MM } from './bt-plate-kit.mjs';
import { AISC, AISC_CONFIDENCE, J33, KDIM, WGAGE } from './bt-plate-ref.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const QUICK = args.includes('--quick'), VERBOSE = args.includes('--verbose');
const SEED = +argv('--seed', '20261125'), ONLY = argv('--only', ''), JSON_OUT = argv('--json', process.env.BT_PLATE_JSON || '');
const TOL = 0.001;
const T0 = Date.now();

// ------------------------------------------------------------------ bookkeeping
let pass = 0, fail = 0; const fails = [], notes = [];
const phase = {}; let _pt = Date.now(); const lap = (k) => { const n = Date.now(); phase[k] = (phase[k] || 0) + n - _pt; _pt = n; };
const stats = { cases: 0, built: 0, mustBlock: 0, sizes: new Set(), fillet: new Map(), arcDev: { cope: 0, rat: 0 }, worst: {}, cover: {}, sewAt: {} };
const cov = (k) => { stats.cover[k] = (stats.cover[k] || 0) + 1; };
function chk(cond, key, cs, detail, mag) { if (cond) { pass++; return true; } fail++; fails.push({ key, case: cs ? cs.id : '-', detail: String(detail == null ? '' : detail), mag: mag == null ? null : Math.abs(mag) }); if (cs) cs.failed = true; return false; }
function near(a, b, tol, key, cs, what) { const e = Math.abs(a - b); if (e <= tol && !(e <= (stats.worst[key] || 0))) stats.worst[key] = e; return chk(e <= tol, key, cs, what + ': measured ' + (+a).toFixed(5) + ', expected ' + (+b).toFixed(5) + ' (off ' + (a - b).toFixed(5) + ')', e); }
const fx = (v) => (+v).toFixed(4);

// ------------------------------------------------------------------ static table checks
{
  const cs = { id: 'tables' };
  for (const ser of ['W', 'S', 'C', 'MC']) for (const [name, rec] of Object.entries(DB[ser])) {
    const ref = AISC[ser][name];
    chk(!!ref, 'table.no-reference-value-in-this-test', cs, name);
    if (!ref) continue;
    ['depth d', 'flange width bf', 'flange thickness tf', 'web thickness tw'].forEach((lbl, i) => {
      const s = ref[i], places = (s.split('.')[1] || '').length, half = 0.5 * Math.pow(10, -places) + 1e-9;
      const tol = i >= 2 ? Math.max(half, 0.0011) : half;     // tf / tw: 0.0011 so a 3rd-decimal difference between Manual editions is not called a defect
      chk(Math.abs(rec[i] - +s) <= tol, 'table.section-dimension-vs-AISC', cs, name + ' ' + lbl + ': profile-db.js has ' + rec[i] + ', AISC Manual prints ' + s + ' (confidence ' + AISC_CONFIDENCE[ser] + ')', rec[i] - +s);
    });
    chk(Math.abs(rec[4] - +name.slice(name.indexOf('x') + 1)) < 1e-9, 'table.weight-vs-designation', cs, name + ': lb/ft in table ' + rec[4]);
  }
  for (const [b, ref] of Object.entries(J33)) {
    const r = DB.BOLT[b];
    if (!chk(!!r, 'table.bolt-hole-vs-J3.3', cs, 'bolt ' + b + ' missing from DB.BOLT')) continue;
    chk(Math.abs(r[0] - ref[0]) < 1e-9, 'table.bolt-hole-vs-J3.3', cs, b + ' standard hole: table ' + r[0] + ', J3.3 ' + ref[0]);
    chk(Math.abs(r[1] - ref[1]) < 1e-9, 'table.bolt-hole-vs-J3.3', cs, b + ' oversize hole: table ' + r[1] + ', J3.3 ' + ref[1]);
    chk(Math.abs(r[2] - ref[2][1]) < 1e-9 && Math.abs(r[0] - ref[2][0]) < 1e-9, 'table.bolt-hole-vs-J3.3', cs, b + ' short slot: table ' + r[0] + ' x ' + r[2] + ', J3.3 ' + ref[2].join(' x '));
    chk(Math.abs(r[3] - ref[3][1]) < 1e-9 && Math.abs(r[0] - ref[3][0]) < 1e-9, 'table.bolt-hole-vs-J3.3', cs, b + ' long slot: table ' + r[0] + ' x ' + r[3] + ', J3.3 ' + ref[3].join(' x '));
  }
  chk(Object.keys(DB.BOLT).every(b => J33[b]), 'table.bolt-hole-vs-J3.3', cs, 'DB.BOLT has a bolt size with no J3.3 row in this test: ' + Object.keys(DB.BOLT).filter(b => !J33[b]).join(','));
  chk(Math.abs(DB.BOLT['1'][0] - 1.125) < 1e-12, 'table.bolt-hole-vs-J3.3', cs, '1 in bolt standard hole must be 1 1/8 (AISC 360-16 and later), table has ' + DB.BOLT['1'][0]);
}

// ------------------------------------------------------------------ the part as this file understands it
const T = (deg) => Math.tan((deg || 0) * Math.PI / 180);
const is16 = (v) => Math.abs(v * 16 - Math.round(v * 16)) < 1e-9;
const q4 = (v) => +(+v).toFixed(4);                    // a value that can be typed exactly with 4 decimals
const txt = (v) => is16(v) ? frac16(v) : dec(v, 4);
/** Read a number the APP wrote into a form field (recipes, standard-gauge label): "47 1/2", "5 1/2", "2.25". */
function readTok(s) {
  s = String(s).trim(); let m;
  if ((m = /^(-?)(\d+) (\d+)\/(\d+)$/.exec(s))) return (m[1] ? -1 : 1) * (+m[2] + (+m[3]) / (+m[4]));
  if ((m = /^(-?)(\d+)\/(\d+)$/.exec(s))) return (m[1] ? -1 : 1) * (+m[2]) / (+m[3]);
  if (/^-?\d*\.?\d+$/.test(s)) return +s;
  return NaN;
}
function secOf(spec) {
  if (spec.cust) return { d: spec.cust.d, bf: spec.cust.bf, tf: spec.cust.tf, tw: spec.cust.tw, wtFt: spec.cust.wt, chan: false, name: 'CUSTOM' };
  const rec = DB[spec.ser][spec.size];
  return { d: rec[0], bf: rec[1], tf: rec[2], tw: rec[3], wtFt: rec[4], chan: spec.fam === 'chan', name: spec.size };
}
const MATF = { A36: 1, A992: 1, 'A572-50': 1, A588: 1, '304L': 1.013, '316L': 1.02, AL6061: 0.345 };
function holeDims(g) {
  const J = J33[g.bolt];
  if (g.type === 'ovs') return { dia: J[1], slotL: 0 };
  if (g.type === 'ssl') return { dia: J[2][0], slotL: J[2][1] };
  if (g.type === 'lsl') return { dia: J[3][0], slotL: J[3][1] };
  if (g.type === 'cust') return { dia: g.dia, slotL: 0 };
  return { dia: J[0], slotL: 0 };
}
/** Half opening along X on a line dv off the hole centre (null = the line misses the hole). */
function holeHalfAlong(h, dv) {
  const r = h.dia / 2, hl = h.slotL ? (h.slotL - h.dia) / 2 : 0, a = Math.abs(dv);
  if (!hl || h.ax === 'x') return a < r ? hl + Math.sqrt(r * r - a * a) : null;
  if (a <= hl) return r; if (a < hl + r) return Math.sqrt(r * r - (a - hl) ** 2); return null;
}
/** Half opening across the part on a line dx off the hole centre. */
function holeHalfAcross(h, dx) {
  const r = h.dia / 2, hl = h.slotL ? (h.slotL - h.dia) / 2 : 0, a = Math.abs(dx);
  if (!hl || h.ax !== 'x') return a < r ? hl + Math.sqrt(r * r - a * a) : null;
  if (a <= hl) return r; if (a < hl + r) return Math.sqrt(r * r - (a - hl) ** 2); return null;
}
const extAlong = (h) => (h.slotL && h.ax === 'x' ? h.slotL : h.dia) / 2;
const extAcross = (h) => (h.slotL && h.ax !== 'x' ? h.slotL : h.dia) / 2;

function buildModel(spec, stdGauge) {
  const s = secOf(spec), { d, bf, tf, tw } = s, hw = d / 2 - tf;
  const zL = s.chan ? -tw / 2 : -bf / 2, zR = s.chan ? bf - tw / 2 : bf / 2;
  const E = (e) => ({ tanv: T(e.tv), tanp: T(e.tp), ct: e.ct || null, cb: e.cb || null, rat: e.rat || 'NONE', rr: e.rr || 0 });
  const A = E(spec.ends.A), B = E(spec.ends.B);
  const corners = [[d / 2, zL], [d / 2, zR], [-d / 2, zL], [-d / 2, zR]];
  const eA = corners.map(([y, z]) => y * A.tanv + z * A.tanp), eB = corners.map(([y, z]) => y * B.tanv + z * B.tanp);
  const extA = Math.max(...eA), extB = Math.max(...eB), minA = Math.min(...eA), minB = Math.min(...eB);
  const L = spec.lenMode === 'oal' ? spec.len - extA - extB : spec.len;
  const M = { sec: s, d, bf, tf, tw, hw, zL, zR, A, B, L, LP: L + extA + extB, SP: L + minA + minB, aMin: -extA, bMax: L + extB, extA, extB, minA, minB };
  M.datum = spec.lenMode === 'oal' ? [M.aMin, M.bMax] : [0, L];
  M.coped = !!(A.ct || A.cb || B.ct || B.cb || A.rat !== 'NONE' || B.rat !== 'NONE');
  M.weight = s.wtFt * (L / 12) * (MATF[spec.mat] || 1);
  M.holes = [];
  const [d0, d1] = M.datum;
  for (const [gi, g] of (spec.groups || []).entries()) {
    const { dia, slotL } = holeDims(g);
    let xs = [];
    if (g.xs) xs = g.xs.map(v => g.refEnd === 'B' ? d1 - v : d0 + v);
    else {
      for (let i = 0; i < g.n; i++) xs.push(g.refEnd === 'B' ? d1 - g.x0 - i * g.p : d0 + g.x0 + i * g.p);
      if (g.both) for (const x of xs.slice()) { const m = d0 + d1 - x; if (!xs.some(v => Math.abs(v - m) < 1e-6)) xs.push(m); }
    }
    const put = (face, x, c) => M.holes.push({ face, x, c, dia, slotL, ax: g.ax || 'x', grp: gi });
    if (g.face === 'web') {
      const ys = [];
      for (let j = 0; j < g.ny; j++) ys.push(g.autoY ? (g.ny - 1) * g.py / 2 - j * g.py : g.wref === 'bos' ? -d / 2 + g.y0 + j * g.py : g.wref === 'cl' ? -(g.y0 + j * g.py) : d / 2 - g.y0 - j * g.py);
      for (const x of xs) for (const y of ys) put('web', x, y);
    } else {
      const std = g.autoG && stdGauge != null, gv = std ? stdGauge : g.g;
      const zs = s.chan ? [zL + gv] : (std || (g.amode || 'gauge') === 'gauge') ? [-gv / 2, gv / 2] : [gv];
      for (const face of (g.bothF ? ['tf', 'bf'] : [g.face])) for (const x of xs) for (const z of zs) put(face, x, z);
    }
  }
  return M;
}

/** Material boundaries along the X line through (y, z): [in, out, in, out ...], each with what made it. */
function expX(M, y, z, withHoles) {
  const { d, hw, L, A, B } = M;
  const zone = y > hw ? 'tf' : y < -hw ? 'bf' : 'web';
  let a = { x: -y * A.tanv - z * A.tanp, kind: 'plane', end: 'A' }, b = { x: L + y * B.tanv + z * B.tanp, kind: 'plane', end: 'B' };
  const discs = [];
  for (const [E, isA] of [[A, true], [B, false]]) {
    for (const [cc, top] of [[E.ct, true], [E.cb, false]]) {
      if (!cc) continue;
      const yy = top ? y : -y, floor = d / 2 - cc.dc;
      if (yy <= floor) continue;
      let xc = cc.c, kind = 'copeEnd', arc = null;
      if (yy < hw && yy < floor + cc.r) { xc = cc.c - cc.r + Math.sqrt(Math.max(0, cc.r ** 2 - (floor + cc.r - yy) ** 2)); kind = 'copeArc'; arc = { cx: isA ? cc.c - cc.r : L - (cc.c - cc.r), cy: (top ? 1 : -1) * (floor + cc.r), r: cc.r }; }
      if (isA) { if (xc > a.x) a = { x: xc, kind, arc, end: 'A' }; } else if (L - xc < b.x) b = { x: L - xc, kind, arc, end: 'B' };
    }
    if (zone === 'web') for (const [on, top] of [[(E.rat === 'TOP' || E.rat === 'BOTH') && !E.ct, true], [(E.rat === 'BOT' || E.rat === 'BOTH') && !E.cb, false]]) {
      if (!on) continue;
      const yc = (top ? 1 : -1) * (hw - E.rr), xc = isA ? -yc * A.tanv : L + yc * B.tanv, dy = y - yc;
      if (Math.abs(dy) >= E.rr) continue;
      const sq = Math.sqrt(E.rr ** 2 - dy * dy), arc = { cx: xc, cy: yc, r: E.rr }, end = isA ? 'A' : 'B';
      discs.push([{ x: xc - sq, kind: 'rat', arc, end }, { x: xc + sq, kind: 'rat', arc, end }]);
    }
  }
  if (!(b.x > a.x)) return { zone, list: [] };
  let iv = [[a, b]];
  // a rat hole is a disc centred on the web end line: whatever of it lies inside the web is gone
  for (const [lo, hi] of discs) { const nx = []; for (const [p, q] of iv) { if (hi.x <= p.x || lo.x >= q.x) { nx.push([p, q]); continue; } if (lo.x > p.x) nx.push([p, lo]); if (hi.x < q.x) nx.push([hi, q]); } iv = nx; }
  if (withHoles !== false) for (const h of M.holes) {
    if (h.face !== zone) continue;
    const dv = (zone === 'web' ? y : z) - h.c, half = holeHalfAlong(h, dv);
    if (half == null) continue;
    const lo = { x: h.x - half, kind: 'hole', h, dv }, hi = { x: h.x + half, kind: 'hole', h, dv }, nx = [];
    for (const [p, q] of iv) { if (hi.x <= p.x || lo.x >= q.x) { nx.push([p, q]); continue; } if (lo.x > p.x) nx.push([p, lo]); if (hi.x < q.x) nx.push([hi, q]); }
    iv = nx;
  }
  return { zone, list: iv.flat() };
}
/** Does the whole hole (plus a margin) sit on material through the full thickness, clear of web and fillet? */
function holeFits(M, h, margin) {
  const { hw, d, tw, zL, zR, sec } = M, r = h.dia / 2 + margin, hl = h.slotL ? (h.slotL - h.dia) / 2 : 0;
  const guard = Math.max(0.2, 1.25 * tw + 0.12);
  const stepA = M.tf * Math.abs(M.A.tanv) + tw * Math.abs(M.A.tanp), stepB = M.tf * Math.abs(M.B.tanv) + tw * Math.abs(M.B.tanp);
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * 2 * Math.PI; let px = r * Math.cos(a), pv = r * Math.sin(a);
    if (hl) { if (h.ax === 'x') px += Math.sign(Math.cos(a)) * hl; else pv += Math.sign(Math.sin(a)) * hl; }
    const x = h.x + px, v = h.c + pv;
    if (h.face === 'web') { if (Math.abs(v) > hw - 0.01) return false; }
    else { if (v < zL + 0.01 || v > zR - 0.01) return false; if (sec.chan ? v < tw / 2 + guard : Math.abs(v) < tw / 2 + guard) return false; }
    const lines = h.face === 'web' ? [[v, -tw / 2 + 1e-6], [v, tw / 2 - 1e-6]] : [[(h.face === 'tf' ? 1 : -1) * (hw + 1e-6), v], [(h.face === 'tf' ? 1 : -1) * (d / 2 - 1e-6), v]];
    for (const [y, z] of lines) { const e = expX(M, y, z, false).list; if (e.length !== 2 || x < e[0].x + stepA || x > e[1].x - stepB) return false; }
  }
  return true;
}
function holesClear(M) {
  for (let i = 0; i < M.holes.length; i++) for (let j = i + 1; j < M.holes.length; j++) {
    const a = M.holes[i], b = M.holes[j]; if (a.face !== b.face) continue;
    if (Math.abs(a.x - b.x) < extAlong(a) + extAlong(b) + 0.08 && Math.abs(a.c - b.c) < extAcross(a) + extAcross(b) + 0.08) return false;
  }
  return true;
}

// ------------------------------------------------------------------ spec -> the form (a state patch)
const pick = (o, k, alt) => o[k + 'Text'] != null ? o[k + 'Text'] : alt;
function endState(e) {
  const o = Component.defEnd();
  o.mode = (e.tv || e.tp || e.tvText != null || e.tpText != null) ? 'ang' : 'sq';
  o.tvT = pick(e, 'tv', dec(e.tv || 0, 4)); o.tpT = pick(e, 'tp', dec(e.tp || 0, 4));
  const rat = e.rat && e.rat !== 'NONE';
  o.wantCope = !!(e.ct || e.cb || rat); o.ct = !!e.ct; o.cb = !!e.cb;
  if (e.ct) { o.tcT = pick(e.ct, 'c', txt(e.ct.c)); o.tdT = pick(e.ct, 'dc', txt(e.ct.dc)); o.trT = pick(e.ct, 'r', txt(e.ct.r)); }
  if (e.cb) { o.bcT = pick(e.cb, 'c', txt(e.cb.c)); o.bdT = pick(e.cb, 'dc', txt(e.cb.dc)); o.brT = pick(e.cb, 'r', txt(e.cb.r)); }
  o.rat = e.rat || 'NONE'; if (e.rr) o.rrT = pick(e, 'rr', txt(e.rr));
  return o;
}
function groupState(g, id, fam) {
  const o = Component.defGroup(id, fam), v = (k, dflt) => pick(g, k, txt(g[k] == null ? dflt : g[k]));
  Object.assign(o, { face: g.face, bothF: !!g.bothF, bolt: g.bolt || '3/4', type: g.type || 'std', ax: g.ax || 'x', refEnd: g.refEnd || 'A', both: !!g.both,
    x0T: v('x0', 3), pT: v('p', 3), nT: pick(g, 'n', String(g.n == null ? 1 : g.n)), xsT: pick(g, 'xs', g.xs ? g.xs.map(txt).join(', ') : ''),
    wref: g.wref || 'tos', y0T: v('y0', 3), nyT: String(g.ny == null ? 1 : g.ny), pyT: v('py', 3), autoY: !!g.autoY, amode: g.amode || 'gauge', gT: v('g', 3.5), autoG: !!g.autoG });
  if (g.type === 'cust') o.diaT = pick(g, 'dia', txt(g.dia));
  return o;
}
const lenText = (spec) => spec.lenText != null ? spec.lenText : spec.lenFmt === 'ftin' ? ftIn(spec.len) : spec.lenFmt === 'frac' ? frac16(spec.len) : dec(spec.len, 4);
function patchOf(spec) {
  const p = { family: spec.fam, lenMode: spec.lenMode, lenT: lenText(spec), mat: spec.mat || (spec.fam === 'beam' ? 'A992' : 'A36'), mark: 'BT-1',
    ends: { A: endState(spec.ends.A), B: endState(spec.ends.B) }, wantHoles: !!(spec.groups && spec.groups.length) };
  if (spec.fam !== 'beam') Object.assign(p, { cser: spec.ser, csize: spec.size });
  else if (!spec.cust) Object.assign(p, { bser: spec.ser, bsize: spec.size });
  else { const u = spec.cust; Object.assign(p, { bser: 'CUST', bsize: '', cdT: pick(u, 'd', txt(u.d)), cbT: pick(u, 'bf', txt(u.bf)), ctfT: pick(u, 'tf', txt(u.tf)), ctwT: pick(u, 'tw', txt(u.tw)), cwT: dec(u.wt, 3) }); }
  if (p.wantHoles) { p.groups = spec.groups.map((g, i) => groupState(g, i + 1, spec.fam)); p.gid = spec.groups.length + 1; }
  return p;
}
function snapshot(c) { const s = c.state, o = {}; for (const k of ['family', 'bser', 'bsize', 'cser', 'csize', 'cdT', 'cbT', 'ctfT', 'ctwT', 'cwT', 'lenT', 'lenMode', 'mat', 'mark', 'wantHoles', 'ends', 'groups', 'gid']) o[k] = s[k]; return JSON.parse(JSON.stringify(o)); }

// ------------------------------------------------------------------ engine
// A fresh kernel every 25 parts (and after any kernel abort). Each kernel instance hooks two process events, which
// would pin it - and its whole wasm heap - in memory for ever; unhook the old one so it can be collected.
const EVTS = ['uncaughtException', 'unhandledRejection'];
let gcNow = () => {}; try { v8.setFlagsFromString('--expose-gc'); gcNow = vm.runInNewContext('gc'); } catch (e) { }
let oc = null, hooks = [], sinceLoad = 0;
async function loadEngine() {
  for (const [ev, fn] of hooks) process.removeListener(ev, fn);
  oc = null; gcNow();
  const before = EVTS.map(ev => process.listeners(ev));
  oc = await loadOcc(true);
  hooks = EVTS.flatMap((ev, i) => process.listeners(ev).filter(fn => !before[i].includes(fn)).map(fn => [ev, fn]));
  sinceLoad = 0;
}
await loadEngine();
async function engine(force) { if (force || sinceLoad >= 35) await loadEngine(); sinceLoad++; return oc; }
const engineErr = (e) => typeof e === 'number' || /abort|unreachable|memory|RuntimeError/i.test(String(e && e.message || e));

// ------------------------------------------------------------------ measuring
/** Compare the measured hits of an X ray with the model. Each boundary is reported under the thing that made it. */
function cmpX(cs, M, R, y, z, why) {
  const zoneOf = (yy) => yy > M.hw ? 'tf' : yy < -M.hw ? 'bf' : 'web';
  if (zoneOf(y) === 'web') y = offFeatureLines(M, y);
  for (let k = 0; k < 4; k++) {                                  // step off any hole edge the line would only graze
    const zone = zoneOf(y), v = zone === 'web' ? y : z;
    if (!M.holes.some(h => h.face === zone && Math.abs(Math.abs(v - h.c) - extAcross(h)) < 0.05)) break;
    if (zone === 'web') y += (y > 0 ? -1 : 1) * 0.11; else z += (z > (M.zL + M.zR) / 2 ? -1 : 1) * 0.11;
  }
  const e = expX(M, y, z).list;
  let m = R.axis(0, [0, y, z]);
  if (m.length % 2) { const m2 = R.axis(0, [0, y + 2.3e-5, z + 1.7e-5]); if (m2.length % 2 === 0) m = m2; }
  const where = why + ' [X ray at y=' + fx(y) + ' z=' + fx(z) + ']', tag = M.coped ? ' (part has a cope or rat hole)' : '';
  if (m.length !== e.length) {
    const kinds = [...new Set(e.map(q => q.kind))].join('+') || 'nothing';
    return chk(false, 'end.material-where-the-model-has-' + (m.length > e.length ? 'none' : 'some') + tag, cs, where + ': measured ' + m.length + ' faces [' + m.map(fx).join(', ') + '], expected ' + e.length + ' [' + e.map(q => fx(q.x) + ':' + q.kind).join(', ') + '] (' + kinds + ')', 99);
  }
  let ok = true;
  e.forEach((q, i) => {
    let err, lo = -TOL, hi = TOL, key;
    if (q.kind === 'plane') { err = m[i] - q.x; key = 'end.plane-position' + tag; }
    else if (q.kind === 'copeEnd') { err = m[i] - q.x; key = 'cope.length'; }
    // Looser on purpose: the app draws the cope radius as a 10-chord polyline and the rat hole as 14 chords, so the
    // surface sits up to r(1 - cos 4.5 deg) = 0.0031 r (cope) / r(1 - cos 6.43 deg) = 0.0063 r (rat) inside the true arc.
    else if (q.kind === 'copeArc') { err = Math.hypot(m[i] - q.arc.cx, y - q.arc.cy) - q.arc.r; lo = -(TOL + 0.0031 * q.arc.r); key = 'cope.radius'; if (err >= lo && err <= hi) stats.arcDev.cope = Math.max(stats.arcDev.cope, Math.abs(err) / q.arc.r); }
    else if (q.kind === 'rat') { err = Math.hypot(m[i] - q.arc.cx, y - q.arc.cy) - q.arc.r; lo = -(TOL + 0.0063 * q.arc.r); key = 'rat-hole.radius'; if (err >= lo && err <= hi) stats.arcDev.rat = Math.max(stats.arcDev.rat, Math.abs(err) / q.arc.r); }
    else { const h = q.h, hl = h.slotL ? (h.slotL - h.dia) / 2 : 0; err = !hl ? Math.hypot(m[i] - h.x, q.dv) - h.dia / 2 : m[i] - q.x; key = 'hole.edge-on-a-cut-line'; }
    if (!chk(err >= lo && err <= hi, key, cs, where + ': ' + q.kind + (q.end ? ' at End ' + q.end : '') + ' measured x=' + (+m[i]).toFixed(5) + ', expected ' + q.x.toFixed(5) + ' (off ' + err.toFixed(5) + ')', err)) ok = false;
  });
  return ok;
}
/** Heights where an X ray along the web would only graze something (a cope floor, the top or bottom of a rat hole):
 *  step the line off them. */
function offFeatureLines(M, y) {
  const crit = [];
  for (const E of [M.A, M.B]) {
    if (E.ct) crit.push(M.d / 2 - E.ct.dc); if (E.cb) crit.push(-(M.d / 2 - E.cb.dc));
    if (E.rat !== 'NONE') crit.push(M.hw - 2 * E.rr, -(M.hw - 2 * E.rr));
  }
  for (let k = 0; k < 4 && crit.some(c => Math.abs(y - c) < 0.012); k++) y += 0.027;
  return Math.abs(y) < M.hw - 0.004 ? y : y - 0.06;
}
/** The opening that contains coordinate v in a hit list (material starts at hit 0). */
function voidAt(hits, v) { for (let i = 1; i + 1 < hits.length; i += 2) if (hits[i] < v && v < hits[i + 1]) return [hits[i], hits[i + 1]]; return null; }

function coverage(spec) {
  cov('mode ' + spec.lenMode); cov('family ' + spec.fam + (spec.cust ? ' CUSTOM' : ' ' + spec.ser));
  for (const id of ['A', 'B']) { const e = spec.ends[id]; cov('end ' + ((e.tv ? 'vert' : '') + (e.tp ? 'plan' : '') || 'square') + (e.ct ? '+copeT' : '') + (e.cb ? '+copeB' : '') + (e.rat && e.rat !== 'NONE' ? '+rat' + e.rat : '')); }
  for (const g of spec.groups || []) { cov('hole ' + (g.bothF ? 'both flanges' : g.face)); cov('hole type ' + (g.type || 'std')); cov('bolt ' + g.bolt); cov('hole ref ' + (g.xs ? 'list ' : '') + (g.refEnd || 'A') + (g.both ? '+both' : '')); if (g.face === 'web') cov('web rows ' + (g.autoY ? 'auto' : g.wref || 'tos')); else cov('flange ' + (g.autoG ? 'standard gauge' : g.amode || 'gauge')); }
}

async function runCase(cs) {
  stats.cases++;
  const spec = cs.spec;
  cs.patch = cs.patch || patchOf(spec);
  const c = await freshApp(cs.patch);
  if (cs.after) { cs.after(c); cs.patch = snapshot(c); }
  const r = c.calc();
  const errs = r.warns.filter(w => w.lvl === 'err').map(w => w.t), blocked = c.blocked(r);
  cs.warns = r.warns.map(w => w.lvl + ': ' + w.t);
  if (cs.expect === 'blocked') {
    stats.mustBlock++;
    if (!chk(blocked, cs.key || 'app.bad-input-not-stopped', cs, cs.why + ' - the form shows: ' + (cs.warns.join(' | ') || 'no warning at all'))) {
      const f = fails[fails.length - 1];
      if (QUICK || cs.noExport) { f.detail += QUICK ? '  (quick run: export path not exercised)' : ''; return; }
      let wrote = false; try { c._solidFile(await engine(), OCCM, 'igs'); wrote = true; } catch (e) { if (engineErr(e)) await engine(true); }
      f.detail += wrote ? '  => THE IGES IS WRITTEN' : '  => (the kernel refuses the file at export, with no reason on the form)';
      if (wrote && cs.evidence) { try { f.detail += ';  ' + await cs.evidence(c, r); } catch (e) { if (engineErr(e)) await engine(true); } }
    }
    return;
  }
  if (cs.appOnly) { await cs.appOnly(c, r, cs); return; }
  // the standard gauge the FORM shows (what the fitter reads) for groups left on "Standard gauge"
  let stdGauge = null;
  if ((spec.groups || []).some(g => g.autoG)) {
    const rv = c.renderVals().groups.find((g, i) => spec.groups[i] && spec.groups[i].autoG && g.showAutoG);
    if (rv) { const m = /Standard gauge (.+?)″/.exec(rv.autoGLbl); if (m) stdGauge = readTok(m[1]); }
  }
  const M = buildModel(spec, stdGauge);
  cs.M = M; coverage(spec);
  // The form now refuses a hole that runs into the web/flange fillet (it used to export a file whose faces did not close).
  // The random size sweep places some holes there; those parts are correctly stopped, not "good parts refused".
  if (blocked && errs.length && errs.every((e) => /flange fillet \(k-zone\)|over the web or its fillet/.test(e))) { chk(true, 'app.fillet-hole-stopped', cs, ''); return; }
  if (!chk(!blocked, 'app.good-part-refused-by-the-form', cs, 'export is blocked: ' + (errs.join(' | ') || 'invalid'))) return;
  await measure(c, r, M, cs);
}

async function measure(c, r, M, cs) {
  const spec = cs.spec, { d, tf, tw, hw, zL, zR, L } = M, opt = cs.opt || {};
  const eng = await engine(); lap('other');
  // ---- 1. the solid, before the file
  let K, shape;
  try { ({ K, shape } = OCCM.buildSolid(eng, c, r)); } catch (e) { chk(false, 'export.refused-only-by-the-kernel (nothing on the form says why)', cs, 'the solid builder threw: ' + String(e && e.message || e).slice(0, 120) + '  => no file is written'); await engine(true); return; }
  stats.built++; lap('build');
  const v0 = K.valid(shape), ns = K.count(shape, 'TopAbs_SOLID'), nsh = K.count(shape, 'TopAbs_SHELL'), nf = K.count(shape, 'TopAbs_FACE'), vol0 = volumeExact(K, shape);
  const bb0 = K.bbox(shape), len0 = bb0[0][1] - bb0[0][0]; lap('inspect');
  // the app's own last guard (app.js _solidFile): valid, one solid, one shell, length within 0.01 of calc().LP
  if (!v0 || ns !== 1 || nsh !== 1 || Math.abs(len0 - (r.LP || r.OAL || r.L)) > 0.01) {
    let threw = null; try { c._solidFile(eng, OCCM, 'igs'); } catch (e) { threw = e; if (engineErr(e)) await engine(true); }
    chk(false, 'export.refused-only-by-the-kernel (nothing on the form says why)', cs, 'solid valid ' + v0 + ', ' + ns + ' solids, ' + nsh + ' shells, ' + len0.toFixed(4) + ' long vs calc().LP ' + (+r.LP).toFixed(4) + ' (model ' + M.LP.toFixed(4) + '); export ' + (threw ? 'throws "' + String(threw.message || threw).slice(0, 90) + '"  => no file is written' : 'STILL WRITES A FILE'));
    if (threw) return;
  }
  chk(v0, 'solid.valid-before-export', cs, 'kernel check failed');
  chk(ns === 1 && nsh === 1, 'solid.one-solid-one-shell-before-export', cs, ns + ' solids, ' + nsh + ' shells');
  // ---- 2. the file
  let ig;
  try { ig = OCCM.writeIges(K, shape, 'bt'); } catch (e) { chk(false, 'iges.write-failed', cs, String(e && e.message || e).slice(0, 160)); await engine(true); return; }
  lap('writeIges');
  const G = igesGlobal(ig);
  chk(G[14] === '1' && /^(INCH|IN)$/.test(G[15]) && Math.abs(+G[13] - 1) < 1e-12, 'file.iges-declares-inches', cs, 'global section: model scale ' + G[13] + ', unit flag ' + G[14] + ', unit name ' + G[15]);
  chk(!/nan|inf/i.test(ig.split('\n').filter(l => l[72] === 'P' || l[72] === 'D').join('\n')), 'file.iges-no-NaN', cs, 'NaN / Infinity in the IGES data');
  near(+G[20], Math.max(Math.abs(M.aMin), Math.abs(M.bMax), d / 2, Math.abs(zL), Math.abs(zR)), 0.002, 'file.iges-largest-coordinate', cs, 'largest coordinate declared in the file header');
  // extents straight from the file text with the independent reader (no kernel): every model-space trimming curve
  {
    const tc = igesTrimCurves(ig, 6), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const pl of tc.polys) for (const q of pl) for (let k = 0; k < 3; k++) { if (q[k] < lo[k]) lo[k] = q[k]; if (q[k] > hi[k]) hi[k] = q[k]; }
    chk(tc.unknownTypes.length === 0 && tc.polys.length > 0, 'file.iges-readable-without-the-kernel', cs, 'curve types the independent reader does not know: ' + tc.unknownTypes.join(','));
    near(hi[0] - lo[0], M.LP, TOL, 'file.iges-extents-by-independent-reader', cs, 'overall length read from the file text, in file units (inches)');
    near(lo[0], M.aMin, TOL, 'file.iges-extents-by-independent-reader', cs, 'low X in the file'); near(hi[1] - lo[1], d, TOL, 'file.iges-extents-by-independent-reader', cs, 'depth in the file'); near(hi[2] - lo[2], zR - zL, TOL, 'file.iges-extents-by-independent-reader', cs, 'width in the file');
  }
  let rb;
  try { rb = OCCM.readBack(K, ig, 'iges'); } catch (e) { chk(false, 'iges.read-back-failed', cs, String(e && e.message || e).slice(0, 160)); await engine(true); return; }
  lap('readBack');
  // ---- 3. after the round trip: the file's loose faces must sew shut into one valid solid.
  // Tried at 0.005 mm first (nearly every part closes there), then at 0.0254 mm = 0.001 in (the tolerance of this test);
  // 0.1 and 0.25 mm only to say how far apart the faces are when they do not.
  let sw = null, closeAt = null;
  for (const t of [0.005, 0.0254, 0.1, 0.25]) { sw = sewSolid(K, rb, t); if (sw.free === 0 && sw.shells === 1) { closeAt = t; break; } }
  stats.sewAt[closeAt || 'never'] = (stats.sewAt[closeAt || 'never'] || 0) + 1; lap('sew');
  const R = rayer(K, rb, MM);
  const bb = K.bbox(rb).map(a => a.map(v => v / MM)); lap('bbox');

  // ---- 4. overall length, and where the part sits about its work points
  near(bb[0][1] - bb[0][0], M.LP, TOL, 'length.overall', cs, 'overall length (long point to long point), typed ' + JSON.stringify(cs.patch.lenT) + ' in ' + spec.lenMode + ' mode');
  near(bb[0][0], M.aMin, TOL, 'length.long-point-A-from-work-point', cs, 'long point of End A measured from work point A');
  near(bb[0][1], M.bMax, TOL, 'length.long-point-B-from-work-point', cs, 'long point of End B measured from work point A');
  near(r.LP, M.LP, 1e-6, 'app.reported-overall-length', cs, 'calc().LP');
  near(r.L, M.L, 1e-6, 'app.reported-work-point-length', cs, 'calc().L');
  // ---- 5. cross-section
  near(bb[1][0], -d / 2, TOL, 'section.depth', cs, 'bottom of steel'); near(bb[1][1], d / 2, TOL, 'section.depth', cs, 'top of steel');
  near(bb[2][0], zL, TOL, 'section.flange-width', cs, M.sec.chan ? 'back of channel' : 'flange tip -Z'); near(bb[2][1], zR, TOL, 'section.flange-width', cs, M.sec.chan ? 'flange toe' : 'flange tip +Z');
  // a station that has the full section and no hole near it
  const reach = (E) => Math.max(E.ct ? E.ct.c : 0, E.cb ? E.cb.c : 0, E.rat !== 'NONE' ? E.rr + hw * Math.abs(E.tanv) : 0);
  const body = [Math.max(-M.minA, reach(M.A)) + 0.05, Math.min(L + M.minB, L - reach(M.B)) - 0.05];
  let xs = null, clr = -1;
  if (body[1] > body[0]) for (let k = 0; k <= 60; k++) { const x = body[0] + (body[1] - body[0]) * (0.31 + 0.38 * k / 60), q = Math.min(9, ...M.holes.map(h => Math.abs(h.x - x) - extAlong(h))); if (q > clr) { clr = q; xs = x; } }
  const mTip = Math.min(0.15, (zR - zL) / 10);
  let rrCase = null;
  if (xs != null && clr > 0.04) {
    const hy = R.axis(1, [xs, 0, zR - mTip]);
    if (chk(hy.length === 4, 'section.flange-thickness', cs, 'Y ray through the flanges at x=' + fx(xs) + ' z=' + fx(zR - mTip) + ' met ' + hy.length + ' faces [' + hy.map(fx).join(', ') + '], expected 4')) {
      near(hy[0], -d / 2, TOL, 'section.depth', cs, 'bottom flange outside face'); near(hy[3], d / 2, TOL, 'section.depth', cs, 'top flange outside face');
      near(hy[1] - hy[0], tf, TOL, 'section.flange-thickness', cs, 'bottom flange thickness'); near(hy[3] - hy[2], tf, TOL, 'section.flange-thickness', cs, 'top flange thickness');
    }
    const hz = R.axis(2, [xs, 0.0137 * d, 0]);
    if (chk(hz.length === 2, 'section.web-thickness', cs, 'Z ray through the web met ' + hz.length + ' faces [' + hz.map(fx).join(', ') + ']')) { near(hz[0], -tw / 2, TOL, 'section.web-thickness', cs, 'web face -Z'); near(hz[1], tw / 2, TOL, 'section.web-thickness', cs, 'web face +Z'); }
    for (const sgn of [1, -1]) {
      const hf = R.axis(2, [xs, sgn * (d / 2 - tf / 2), 0]);
      if (chk(hf.length === 2, 'section.flange-width', cs, 'Z ray along the ' + (sgn > 0 ? 'top' : 'bottom') + ' flange met ' + hf.length + ' faces [' + hf.map(fx).join(', ') + ']')) { near(hf[0], zL, TOL, 'section.flange-width', cs, 'flange edge -Z'); near(hf[1], zR, TOL, 'section.flange-width', cs, 'flange edge +Z'); }
    }
    // modelled root fillet (reported, not judged): from the sharp inside corner toward the fillet centre
    const dg = R.cast([xs, hw - 1e-4, tw / 2 + 1e-4], [0, -Math.SQRT1_2, Math.SQRT1_2]).filter(v => v > 1e-6);
    if (dg.length) { rrCase = dg[0] / (Math.SQRT2 - 1); stats.fillet.set(M.sec.name === 'CUSTOM' ? 'CUSTOM ' + d + 'x' + M.bf + 'x' + tf + 'x' + tw : M.sec.name, { d, bf: M.bf, tf, tw, chan: M.sec.chan, rr: rrCase }); }
  }
  {
    const clip = rrCase == null ? 0 : M.holes.filter(h => h.face === 'web' && Math.abs(h.c) + extAcross(h) > hw - rrCase).length;
    const hint = clip ? '  [' + clip + ' web hole(s) cut into the modelled root fillet, radius ' + fx(rrCase) + ']' : '';
    chk(closeAt != null && closeAt <= 0.0254, 'iges.faces-do-not-close-within-0.001in-after-round-trip', cs, (closeAt == null ? sw.free + ' open edges are still left at 0.25 mm (0.0098 in)' : 'the faces in the file only close when sewn at ' + closeAt + ' mm (' + (closeAt / MM).toFixed(4) + ' in)') + hint, closeAt || 1);
    if (sw.solid) {
      chk(sw.valid && sw.solids === 1, 'iges.one-valid-solid-after-round-trip', cs, 'valid ' + sw.valid + ', solids ' + sw.solids);
      chk(Math.abs(sw.volume / MM ** 3 - vol0) <= Math.max(2e-6 * vol0, 0.002), 'iges.volume-changes-in-the-round-trip', cs, 'volume ' + (sw.volume / MM ** 3).toFixed(5) + ' after vs ' + vol0.toFixed(5) + ' before (' + (sw.volume / MM ** 3 - vol0).toFixed(5) + ')' + hint, sw.volume / MM ** 3 - vol0);
    }
    chk(sw.faces === nf, 'iges.face-count-after-round-trip', cs, sw.faces + ' vs ' + nf);
  }
  // ---- 6. end cuts, copes, rat holes: X rays along the web and both flanges
  const lines = [], zw = 0.35 * tw;
  for (const y of [0.0137 * d, hw - 0.06, -(hw - 0.06)]) lines.push([y, zw, 'web end line']);
  for (const sgn of [1, -1]) for (const fr of [0.12, 0.5, 0.88]) for (const z of [zL + mTip, zR - mTip]) lines.push([sgn * (hw + fr * tf), z, (sgn > 0 ? 'top' : 'bottom') + ' flange end']);
  for (const [E, nm] of [[M.A, 'A'], [M.B, 'B']]) {
    for (const [cc, top] of [[E.ct, true], [E.cb, false]]) {
      if (!cc) continue; const sg = top ? 1 : -1, floor = d / 2 - cc.dc, w = top ? 'top' : 'bottom';
      lines.push([sg * (floor - 0.03), zw, 'web just below the ' + w + ' cope floor at ' + nm]);
      for (const t of [0.12, 0.3, 0.5, 0.62, 0.8, 0.93]) if (floor + cc.r * t < hw - 0.005) lines.push([sg * (floor + cc.r * t), zw, w + ' cope radius at ' + nm]);
      if (hw - (floor + cc.r) > 0.03) lines.push([sg * ((floor + cc.r + hw) / 2), zw, w + ' cope end in the web at ' + nm]);
      lines.push([sg * (hw + 0.004), (zL + zR) / 2 + 0.31 * (zR - zL), 'underside of the coped ' + w + ' flange at ' + nm]);
    }
    for (const [on, top] of [[(E.rat === 'TOP' || E.rat === 'BOTH') && !E.ct, true], [(E.rat === 'BOT' || E.rat === 'BOTH') && !E.cb, false]]) {
      if (!on) continue; const yc = (top ? 1 : -1) * (hw - E.rr), w = top ? 'top' : 'bottom';
      for (const t of [-0.9, -0.55, -0.2, 0.07, 0.4, 0.7, 0.9]) lines.push([yc + E.rr * t, zw, w + ' rat hole at ' + nm]);
      lines.push([yc - (top ? 1 : -1) * (E.rr + 0.04), zw, 'web just clear of the ' + w + ' rat hole at ' + nm]);
    }
  }
  for (const [y, z, why] of lines) cmpX(cs, M, R, y, z, why);
  // cope depth by a vertical ray (square coped ends; with an angle the X rays above carry it)
  for (const [E, nm, isA] of [[M.A, 'A', true], [M.B, 'B', false]]) for (const [cc, top] of [[E.ct, true], [E.cb, false]]) {
    if (!cc || E.tanv || E.tanp) continue;
    const xq = isA ? (cc.c - cc.r) * 0.47 : L - (cc.c - cc.r) * 0.47;
    if (M.holes.some(h => h.face === 'web' && Math.abs(h.x - xq) < extAlong(h) + 0.05)) continue;
    const hy = R.axis(1, [xq, 0, 0.21 * tw]);
    if (!chk(hy.length >= 2 && hy.length % 2 === 0, 'cope.depth', cs, 'Y ray in the cope at ' + nm + ' met ' + hy.length + ' faces')) continue;
    if (top) near(hy[hy.length - 1], d / 2 - cc.dc, TOL, 'cope.depth', cs, 'top cope floor at End ' + nm + ' (typed depth ' + cc.dc + ' from top of steel)');
    else near(hy[0], -d / 2 + cc.dc, TOL, 'cope.depth', cs, 'bottom cope floor at End ' + nm + ' (typed depth ' + cc.dc + ' from bottom of steel)');
    if (!(top ? E.cb : E.ct)) { if (top) near(hy[0], -d / 2, TOL, 'cope.depth', cs, 'bottom of steel under the top cope at ' + nm); else near(hy[hy.length - 1], d / 2, TOL, 'cope.depth', cs, 'top of steel over the bottom cope at ' + nm); }
  }
  lap('rays-ends');
  // ---- 7. holes
  const want = M.holes.length, okN = r.holes.filter(h => h.ok).length;
  chk(r.holes.length === want, 'hole.count-the-app-lists', cs, 'app lists ' + r.holes.length + ' holes, the form asks for ' + want);
  chk(okN === r.holes.length, 'hole.skipped-without-blocking', cs, (r.holes.length - okN) + ' of ' + r.holes.length + ' holes were skipped and the export is not blocked');
  if (sw.solid && !opt.skipGenus) { const g = genus(K, sw.sewn); chk(g === want, 'hole.count-in-the-file', cs, 'the file has ' + g + ' through-holes, the form asks for ' + want); }
  const pickN = QUICK ? 8 : 16, step = Math.max(1, Math.ceil(want / pickN));
  M.holes.forEach((h, idx) => {
    if (idx % step && idx !== want - 1) return;
    const r0 = h.dia / 2, hl = h.slotL ? (h.slotL - h.dia) / 2 : 0, dOff = 0.11 * r0;
    const yF = (h.face === 'tf' ? 1 : -1) * (d / 2 - tf / 2), nm = h.face + ' hole #' + (idx + 1) + ' (group ' + (h.grp + 1) + ')';
    const vA = voidAt(R.axis(0, h.face === 'web' ? [0, h.c + dOff, 0.13 * tw] : [0, yF, h.c + dOff]), h.x);
    if (!chk(!!vA, 'hole.missing-in-the-file', cs, nm + ': no opening at x=' + fx(h.x) + ' across=' + fx(h.c))) return;
    near((vA[0] + vA[1]) / 2, h.x, TOL, 'hole.station', cs, nm + ' station from work point A (datum: ' + (spec.lenMode === 'oal' ? 'long point' : 'work point') + ' of End ' + ((spec.groups[h.grp] || {}).refEnd || 'A') + ')');
    near(vA[1] - vA[0], 2 * holeHalfAlong(h, dOff), TOL, hl && h.ax === 'x' ? 'hole.slot-length' : 'hole.diameter', cs, nm + ' opening along the part (chord ' + fx(dOff) + ' off centre)');
    const xOff = hl && h.ax === 'x' ? 0.37 * hl : dOff;
    const vC = voidAt(R.axis(h.face === 'web' ? 1 : 2, h.face === 'web' ? [h.x + xOff, 0, 0.13 * tw] : [h.x + xOff, yF, 0]), h.c);
    if (!chk(!!vC, 'hole.missing-in-the-file', cs, nm + ': no opening on the cross ray')) return;
    near((vC[0] + vC[1]) / 2, h.c, TOL, 'hole.position-across', cs, nm + (h.face === 'web' ? ' height above mid-depth' : ' distance from the web centre line'));
    near(vC[1] - vC[0], 2 * holeHalfAcross(h, xOff), TOL, hl && h.ax !== 'x' ? 'hole.slot-length' : 'hole.diameter', cs, nm + ' opening across the part');
  });
  lap('holes');
  // ---- 8. the flat DXF against the same file
  if (!opt.skipDxf) checkDxf(c, r, M, cs, R);
  lap('dxf');
  // ---- 9. weight
  near(r.wt, M.weight, 1e-6 * Math.max(1, M.weight), 'weight', cs, 'weight = table lb/ft x work-point length x material factor');
  if (cs.extra) await cs.extra({ c, r, M, cs, R, K, shape, rb, bb, sw });
}

function checkDxf(c, r, M, cs, R) {
  const { d, hw, zL, zR } = M, text = c._dxfText();
  if (!chk(typeof text === 'string' && text.length > 0, 'dxf.written', cs, 'no DXF text')) return;
  chk(!/nan|infinity/i.test(text), 'dxf.no-NaN', cs, 'NaN / Infinity in the DXF');
  const dx = parseDxf(text);
  chk(dx.insunits === 1, 'dxf.declares-inches', cs, '$INSUNITS = ' + dx.insunits + ' (1 = inches)');
  const big = dx.polys.map(p => ({ p, bb: bbox2(p.pts), area: Math.abs(polyArea(p.pts)) })).sort((a, b) => b.area - a.area);
  if (!chk(big.length >= 3, 'dxf.three-views', cs, big.length + ' outlines')) return;
  const [bfV, webV, tfV] = big.slice(0, 3).sort((a, b) => a.bb.y0 - b.bb.y0);
  const Wb = zR - zL, gap = (tfV.bb.y0 - Wb - d) / 2, oWeb = Wb + gap, oTf = tfV.bb.y0;
  chk(Math.abs(bfV.bb.y0) < 1e-6 && Math.abs(bfV.bb.h - Wb) < TOL && Math.abs(tfV.bb.h - Wb) < TOL && gap > 0, 'dxf.three-views', cs, 'flange views are not the flange width: ' + fx(bfV.bb.h) + ' / ' + fx(tfV.bb.h) + ' vs ' + fx(Wb));
  // each view in model coordinates [x, across]; bottom flange is drawn from below (mirrored)
  const views = { tf: { pts: tfV.p.pts.map(q => [q[0], zL + (q[1] - oTf)]), holes: [], y: d / 2 - 6e-5 }, web: { pts: webV.p.pts.map(q => [q[0], q[1] - oWeb - d / 2]), holes: [] }, bf: { pts: bfV.p.pts.map(q => [q[0], zR - q[1]]), holes: [], y: -d / 2 + 6e-5 } };
  const vOf = (Y) => Y >= oTf - 1e-6 ? 'tf' : Y >= oWeb - 1e-6 ? 'web' : 'bf';
  const toModel = (n, X, Y) => n === 'tf' ? [X, zL + (Y - oTf)] : n === 'web' ? [X, Y - oWeb - d / 2] : [X, zR - Y];
  for (const q of dx.circles) { const n = vOf(q.y), p = toModel(n, q.x, q.y); views[n].holes.push({ face: n, x: p[0], c: p[1], dia: 2 * q.r, slotL: 0, ax: 'x' }); }
  for (const o of big.slice(3)) { const n = vOf(o.bb.cy), p = toModel(n, o.bb.cx, o.bb.cy); views[n].holes.push({ face: n, x: p[0], c: p[1], dia: Math.min(o.bb.w, o.bb.h), slotL: Math.max(o.bb.w, o.bb.h), ax: o.bb.w >= o.bb.h ? 'x' : 'y' }); }
  const nDxf = views.tf.holes.length + views.web.holes.length + views.bf.holes.length;
  chk(nDxf === M.holes.length, 'dxf.hole-count', cs, 'DXF has ' + nDxf + ' holes, the form asks for ' + M.holes.length);
  for (const h of M.holes) {
    const q = views[h.face].holes.find(q2 => Math.abs(q2.x - h.x) < 0.02 && Math.abs(q2.c - h.c) < 0.02);
    if (!chk(!!q, 'dxf.hole-position', cs, 'no DXF hole at ' + h.face + ' x=' + fx(h.x) + ' across=' + fx(h.c))) continue;
    near(q.x, h.x, TOL, 'dxf.hole-position', cs, 'DXF ' + h.face + ' hole station'); near(q.c, h.c, TOL, 'dxf.hole-position', cs, 'DXF ' + h.face + ' hole across');
    near(q.dia, h.dia, TOL, 'dxf.hole-size', cs, 'DXF ' + h.face + ' hole diameter / slot width');
    if (h.slotL) { near(q.slotL, h.slotL, TOL, 'dxf.hole-size', cs, 'DXF slot length'); chk(q.ax === h.ax, 'dxf.hole-size', cs, 'DXF slot runs ' + q.ax + ', form says ' + h.ax); }
  }
  const eW = bbox2(views.web.pts), eTf = bbox2(views.tf.pts);
  near(eW.y0, -hw, TOL, 'dxf.view-extents', cs, 'web view bottom (inside of bottom flange)'); near(eW.y1, hw, TOL, 'dxf.view-extents', cs, 'web view top (inside of top flange)');
  near(eTf.y0, zL, TOL, 'dxf.view-extents', cs, 'top flange view edge'); near(eTf.y1, zR, TOL, 'dxf.view-extents', cs, 'top flange view edge');
  // the DXF outline and holes against the solid in the file, scan line by scan line
  const scan = (name, v) => {
    if (name === 'web') v = offFeatureLines(M, v);
    const V = views[name], cuts = [];
    for (const h of V.holes) { const half = holeHalfAlong(h, v - h.c); if (half != null) cuts.push([h.x - half, h.x + half]); }
    const iv = subtractIntervals(polyScan(V.pts, v), cuts), p = name === 'web' ? [0, v, 0] : [0, V.y, v];
    let m = R.axis(0, p); if (m.length % 2) { const m2 = R.axis(0, [0, p[1] + 1.3e-5, p[2] + 1.1e-5]); if (m2.length % 2 === 0) m = m2; }
    const where = name + ' view, line across=' + fx(v);
    if (!chk(m.length === iv.length, 'dxf.outline-vs-file', cs, where + ': DXF has ' + iv.length + ' edges [' + iv.map(fx).join(', ') + '], the solid ' + m.length + ' [' + m.map(fx).join(', ') + ']', 99)) return;
    iv.forEach((q, i) => near(m[i], q, i === 0 || i === iv.length - 1 ? TOL : 2 * TOL, i === 0 || i === iv.length - 1 ? 'dxf.view-extents-vs-file' : 'dxf.outline-vs-file', cs, where + ' edge ' + (i + 1)));
  };
  const clearOf = (n, v) => !views[n].holes.some(h => Math.abs(Math.abs(v - h.c) - extAcross(h)) < 0.05);
  const mT = Math.min(0.12, Wb / 12);
  for (const v of [-hw + 0.045, 0.0137 * d, hw - 0.045]) if (clearOf('web', v)) scan('web', v);
  for (const n of ['tf', 'bf']) for (const v of [zL + mT, zR - mT]) if (clearOf(n, v)) scan(n, v);
  const rows = { tf: new Set(), web: new Set(), bf: new Set() };
  for (const h of M.holes) rows[h.face].add((h.c + 0.09 * h.dia).toFixed(4));
  for (const n of ['tf', 'web', 'bf']) [...rows[n]].slice(0, 5).forEach(v => { if (clearOf(n, +v)) scan(n, +v); });
  for (const E of [M.A, M.B]) for (const [cc, top] of [[E.ct, true], [E.cb, false]]) if (cc) { const fl = d / 2 - cc.dc, v = (top ? 1 : -1) * (fl + Math.min(cc.r * 0.5, (hw - fl) * 0.5)); if (Math.abs(v) < hw && clearOf('web', v)) scan('web', v); }
}

// ------------------------------------------------------------------ building cases
const cases = [];
const G_DEF = { bolt: '3/4', type: 'std', ax: 'x', refEnd: 'A', x0: 3, p: 3, n: 1, wref: 'tos', y0: 3, ny: 1, py: 3, amode: 'gauge', g: 3.5 };
const add = (id, spec, more) => { spec.groups = (spec.groups || []).map(g => Object.assign({}, G_DEF, g)); const cs = Object.assign({ id, spec }, more || {}); cases.push(cs); return cs; };
const SQ = () => ({ tv: 0, tp: 0, rat: 'NONE' });
const base = (fam, ser, size, len, mode, more) => Object.assign({ fam, ser, size, len, lenMode: mode || 'oal', lenFmt: 'frac', ends: { A: SQ(), B: SQ() }, groups: [] }, more || {});
const beam = (size, len, mode, more) => base('beam', size[0], size, len, mode, Object.assign({ lenFmt: is16(len) ? 'frac' : 'dec' }, more));
const chan = (size, len, mode, more) => base('chan', size.startsWith('MC') ? 'MC' : 'C', size, len, mode, Object.assign({ lenFmt: is16(len) ? 'frac' : 'dec' }, more));
const r16 = (v) => Math.round(v * 16) / 16;
const ANG = [0.5, 1, 2.5, 5, 10, 15, 22.5, 30, 37.3, 45, 52.75, 60, 67.5, 75];

function randEnd(R, s, kind) {
  const e = SQ(), hw = s.d / 2 - s.tf;
  const ang = () => { const m = R.pick(['v', 'v', 'p', 'p', 'vp']); if (m !== 'p') e.tv = R.pick(ANG) * (R.chance(0.3) ? -1 : 1); if (m !== 'v') e.tp = R.pick(ANG) * (R.chance(0.3) ? -1 : 1); };
  const mk = () => {
    let r = R.pick([0.125, 0.25, 0.375, 0.5, 0.75, 1]); const dcMax = s.d / 2 - 0.6;
    while (r > 0.125 && s.tf + r + 0.0625 > dcMax) r = r / 2;
    if (s.tf + r + 0.0625 > dcMax) return null;
    const dc = r16(R.range(s.tf + r + 0.0625, Math.min(dcMax, s.tf + r + 3))), c = r16(R.range(Math.max(1.5, r + 0.25), 8));
    return dc >= s.tf + r + 0.06 && dc <= dcMax ? { c, dc, r } : null;
  };
  const cope = () => { const w = R.pick(['t', 't', 'b', 'tb']); if (w !== 'b') e.ct = mk(); if (w !== 't') e.cb = mk(); };
  const rat = () => { let rr = R.pick([0.375, 0.5, 0.75, 1]); while (rr > 0.25 && 2 * rr > hw - 0.02) rr = rr / 2; if (2 * rr > hw - 0.02) return; e.rr = rr; e.rat = R.pick(['TOP', 'BOT', 'BOTH']); };
  if (kind.includes('ang')) ang(); if (kind.includes('cope')) cope(); if (kind.includes('rat')) rat();
  return e;
}
/** Smallest work-point length this file treats as a sane part: the end cuts and copes all stay clear of each other. */
function minWpLen(spec) {
  const M = buildModel(Object.assign({}, spec, { len: 1000, lenMode: 'wp', groups: [] }));
  const cl = (E) => Math.max(E.ct ? E.ct.c : 0, E.cb ? E.cb.c : 0, E.rat !== 'NONE' ? E.rr : 0);
  return { M, min: Math.max(-M.minA - M.minB + 0.6, cl(M.A) - M.minB + 0.9, cl(M.B) - M.minA + 0.9, cl(M.A) + cl(M.B) + 1.5, 3) };
}
function pickLen(R, spec, cat) {
  const { M, min } = minWpLen(spec);
  const wp = cat === 'short' ? min + R.range(0.4, 5) : cat === 'long' ? R.range(240, 470) : R.range(Math.max(min + 6, 20), 230);
  let typed = spec.lenMode === 'oal' ? wp + M.extA + M.extB : wp;
  const fmt = R.pick(['ftin', 'ftin', 'frac', 'dec', 'dec']);
  typed = fmt === 'dec' ? Math.ceil(typed * 1000 + R.int(0, 9)) / 1000 : Math.ceil(typed * 16) / 16;
  if (typed > 480) typed = 480;
  spec.len = typed; spec.lenFmt = fmt;
}
// The standard gauge is whatever the FORM shows for the section; ask the form once per section.
const stdShown = new Map();
const stdKey = (spec) => spec.fam + '/' + (spec.cust ? JSON.stringify(spec.cust) : spec.size);
async function primeStdGauge(spec) {
  const k = stdKey(spec); if (stdShown.has(k)) return stdShown.get(k);
  const probe = Object.assign({}, spec, { len: 120, lenMode: 'oal', lenFmt: 'dec', lenText: null, ends: { A: SQ(), B: SQ() }, groups: [{ face: 'tf', bolt: '3/4', type: 'std', autoG: true, x0: 3, n: 1, p: 3, g: 3.5 }] });
  const c = await freshApp(patchOf(probe)), rv = c.renderVals().groups[0]; let v = null;
  if (rv && rv.showAutoG) { const m = /Standard gauge (.+?)″/.exec(rv.autoGLbl); if (m) v = readTok(m[1]); }
  stdShown.set(k, v); return v;
}
/** One random hole group that sits on the material of this part (null if the dice never land). */
function randGroup(R, spec, existing, cap) {
  const s = secOf(spec), hw = s.d / 2 - s.tf, std = stdShown.get(stdKey(spec));
  const M0 = buildModel(Object.assign({}, spec, { groups: [] })), span = M0.datum[1] - M0.datum[0];
  for (let tryN = 0; tryN < 40; tryN++) {
    const face = R.pick(['web', 'web', 'web', 'tf', 'bf', 'both']);
    const g = { face: face === 'both' ? 'tf' : face, bothF: face === 'both', bolt: R.pick(Object.keys(J33)), type: R.pick(['std', 'std', 'std', 'ovs', 'ssl', 'lsl', 'cust']), ax: R.pick(['x', 'x', 'y']), refEnd: R.pick(['A', 'A', 'B']), both: R.chance(0.3) };
    if (g.type === 'cust') g.dia = R.pick([0.4375, 0.5625, 0.6875, 0.75, 0.8125, 1, 1.0625, 0.531, 0.9063]);
    if (R.chance(0.2)) { const n = R.int(1, 2), xs = new Set(); while (xs.size < n) xs.add(r16(R.range(0.75, Math.max(1.5, Math.min(span - 0.75, 60))))); g.xs = [...xs].sort((a, b) => a - b); g.both = false; }
    else { g.n = R.int(1, 2); g.p = R.pick([1.5, 2, 2.5, 3, 3, 4, 6, 12, 2.375, 3.3125]); g.x0 = R.chance(0.25) ? +R.range(0.8, Math.max(1, Math.min(14, span / 3))).toFixed(3) : r16(R.range(0.8, Math.max(1, Math.min(14, span / 3)))); }
    const hd = holeDims(g);
    if (g.face === 'web') {
      g.ny = R.int(1, Math.max(1, Math.min(3, Math.floor((2 * hw - 1.2) / 2)))); g.py = R.pick([2, 2.5, 3, 3, 4, 2.25]);
      if (R.chance(0.3)) g.autoY = true; else { g.wref = R.pick(['tos', 'tos', 'cl', 'bos']); g.y0 = g.wref === 'cl' ? r16(R.range(-(hw - 1), 1)) : r16(R.range(s.tf + hd.dia / 2 + 0.1, Math.max(s.tf + hd.dia / 2 + 0.2, s.d - s.tf - 1))); }
    } else {
      if (!s.chan && std != null && R.chance(0.35)) g.autoG = true;
      g.amode = !s.chan && R.chance(0.2) ? 'off' : 'gauge';
      g.g = s.chan ? r16(R.range(s.tw + 0.5, s.bf - 0.3)) : g.amode === 'off' ? r16(R.range(s.tw / 2 + 0.6, Math.max(s.tw / 2 + 0.7, s.bf / 2 - 0.4))) * (R.chance(0.3) ? -1 : 1) : R.pick([2.25, 2.75, 3, 3.5, 4, 5.5, r16(R.range(1.5, Math.max(1.6, s.bf - 1.2)))]);
    }
    const M = buildModel(Object.assign({}, spec, { groups: existing.concat([g]) }), std);
    if (M.holes.length > cap || !M.holes.every(h => holeFits(M, h, 0.04)) || !holesClear(M)) continue;
    return g;
  }
  return null;
}
async function randomCase(id, fam, ser, size, R, opt) {
  opt = opt || {};
  const spec = base(fam, ser, size, 120, R.chance(0.6) ? 'oal' : 'wp', opt.cust ? { cust: opt.cust } : null);
  await primeStdGauge(spec);
  const s = secOf(spec), kinds = ['sq', 'sq', 'sq', 'ang', 'ang', 'ang', 'cope', 'cope', 'rat', 'cope+rat'];
  const [ka, kb] = opt.endKinds || [R.pick(kinds), R.pick(kinds)];
  spec.ends = { A: randEnd(R, s, ka), B: randEnd(R, s, kb) };
  spec.mat = R.pick(fam === 'beam' ? ['A992', 'A992', 'A36', 'A572-50', '304L', 'AL6061'] : ['A36', 'A36', '316L', 'AL6061']);
  pickLen(R, spec, opt.lenCat || R.pick(['short', 'typ', 'typ', 'typ', 'long']));
  const nG = opt.groups != null ? opt.groups : R.pick([0, 0, 1, 1, 1, 2]), groups = [];
  for (let k = 0; k < nG; k++) { const g = randGroup(R, spec, groups, opt.holeCap || 3); if (g) groups.push(g); }
  spec.groups = groups;
  return add(id, spec, opt.more);
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const everyNth = (arr, n, off) => QUICK ? arr.filter((_, i) => i % n === (off || 0)) : arr;

// ------------------------------------------------------------------ the sweep
async function buildCases() {
  // ===== A. every table size once, each with its own random ends / length mode / length / holes
  const every = (ser, fam) => Object.keys(DB[ser]).map(size => [fam, ser, size]);
  const sizes = everyNth([...every('W', 'beam'), ...every('S', 'beam'), ...every('C', 'chan'), ...every('MC', 'chan')], 27, 3);
  for (const [fam, ser, size] of sizes) await randomCase('size ' + size, fam, ser, size, rng(SEED ^ hash(size)));

  // ===== B. CUSTOM beam, a range of typed d / bf / tf / tw
  const CUST = [[12, 6.5, 0.375, 0.25, 26], [8, 4, 0.25, 0.1875, 12], [10.125, 5.0625, 0.4375, 0.3125, 24], [24, 12, 1, 0.625, 120], [6, 6, 0.5, 0.5, 30], [36, 16.5, 1.25, 0.75, 230], [4, 2, 0.1875, 0.125, 5], [14.37, 7.413, 0.531, 0.287, 40.2], [18, 3, 0.75, 0.375, 45], [5.5, 9, 0.3125, 0.25, 22]];
  for (const [i, u] of everyNth(CUST, 5).entries()) await randomCase('custom beam ' + u.slice(0, 4).join(' x '), 'beam', 'CUST', '', rng(SEED + 77 * i), { cust: { d: u[0], bf: u[1], tf: u[2], tw: u[3], wt: u[4] } });

  // ===== C. end angles: plan and vertical, apart and together, both signs, 0.5 to 75 degrees, both length modes
  {
    const secs = everyNth([['beam', 'W12x26'], ['chan', 'C8x11.5'], ['beam', 'S12x31.8']], 3);
    let k = 0;
    for (const [fam, size] of secs) for (const a of everyNth(ANG, 5, 1)) {
      if (!QUICK && ((size === 'S12x31.8' && ANG.indexOf(a) % 3) || (size === 'C8x11.5' && ANG.indexOf(a) % 2))) continue;
      const b = ANG[(ANG.indexOf(a) + 5) % ANG.length], pat = k++ % 6, sg = (pat & 1) ? -1 : 1;
      const A = SQ(), B = SQ();
      if (pat < 2) { A.tv = sg * a; B.tp = b; } else if (pat < 4) { A.tp = sg * a; B.tv = -b; } else { A.tv = a; A.tp = sg * a; B.tv = sg * b; B.tp = -a; }
      const spec = base(fam, size[0], size, 0, k % 2 ? 'oal' : 'wp', { ends: { A, B } });
      const { M, min } = minWpLen(spec), wp = min + 40 + 3 * k;
      spec.len = r16(spec.lenMode === 'oal' ? wp + M.extA + M.extB : wp); spec.lenFmt = k % 3 ? 'ftin' : 'frac';
      add('angle ' + size + ' A(v' + (A.tv || 0) + ' p' + (A.tp || 0) + ') B(v' + (B.tv || 0) + ' p' + (B.tp || 0) + ') ' + spec.lenMode, spec);
    }
  }
  // ===== D. copes: top / bottom / both, each end and both ends, a range of length / depth / radius
  {
    const C = (c, dc, r) => ({ c, dc, r });
    const list = [
      ['W12x26', { A: { ct: C(4, 1.5, 0.5) } }], ['W12x26', { B: { cb: C(3.25, 1.25, 0.25) } }], ['W12x26', { A: { ct: C(6, 2, 0.75), cb: C(2.5, 1.125, 0.375) }, B: { ct: C(4, 1.5, 0.5) } }],
      ['W21x44', { A: { ct: C(8, 3, 1), cb: C(8, 3, 1) }, B: { ct: C(5.5625, 1.4375, 0.5), cb: C(5.5625, 1.4375, 0.5) } }], ['W21x44', { A: { cb: C(1.5, 0.875, 0.125) }, B: { ct: C(12, 4.5, 1) } }],
      ['W8x31', { A: { ct: C(3, 1.25, 0.5) }, B: { cb: C(3, 1.25, 0.5) } }], ['S8x18.4', { A: { ct: C(2.75, 1.3125, 0.375) }, B: { ct: C(2.75, 1.3125, 0.375) } }],
      ['C10x15.3', { A: { ct: C(3, 1.25, 0.5) } }], ['C10x15.3', { A: { ct: C(4.5, 2, 0.75), cb: C(2, 1, 0.25) }, B: { cb: C(3.125, 1.5, 0.5) } }], ['MC12x31', { B: { ct: C(5, 2.5, 1), cb: C(5, 2.5, 1) } }],
      ['W12x26', { A: { ct: C(4.137, 1.613, 0.4) } }], ['W30x90', { A: { ct: C(10, 4, 1) }, B: { ct: C(10, 4, 1), cb: C(6, 2, 0.5) } }]
    ];
    for (const [i, [size, ends]] of everyNth(list, 6, 2).entries()) {
      const spec = (size[0] === 'C' || size.startsWith('MC') ? chan : beam)(size, [48, 96.5, 30.0625, 137.413][i % 4], i % 2 ? 'wp' : 'oal', { ends: { A: Object.assign(SQ(), ends.A), B: Object.assign(SQ(), ends.B) } });
      add('cope ' + size + ' #' + (i + 1), spec);
    }
  }
  // ===== E. rat holes: each mode, each end, with and without a cope on the other corner, on a square and an angled end
  {
    const list = [['W12x26', { A: { rat: 'TOP', rr: 0.75 } }], ['W12x26', { A: { rat: 'BOT', rr: 0.5 } }], ['W12x26', { A: { rat: 'BOTH', rr: 0.75 }, B: { rat: 'BOTH', rr: 1 } }], ['W18x50', { B: { rat: 'TOP', rr: 1 } }],
      ['C8x11.5', { A: { rat: 'BOTH', rr: 0.75 } }], ['C8x11.5', { B: { rat: 'BOT', rr: 0.375 } }], ['S12x31.8', { A: { rat: 'BOTH', rr: 0.625 }, B: { rat: 'TOP', rr: 0.5 } }],
      ['W12x26', { A: { rat: 'BOT', rr: 0.75, ct: { c: 4, dc: 1.5, r: 0.5 } } }], ['W16x40', { B: { rat: 'TOP', rr: 0.75, cb: { c: 3, dc: 1.5, r: 0.5 } } }],
      ['W12x26', { A: { rat: 'BOTH', rr: 0.75, tv: 30 } }], ['W12x26', { B: { rat: 'TOP', rr: 0.5, tv: -15 } }], ['C10x15.3', { A: { rat: 'BOT', rr: 0.5, tv: 22.5 } }]];
    for (const [i, [size, ends]] of everyNth(list, 6, 2).entries()) add('rat ' + size + ' #' + (i + 1), (size[0] === 'C' ? chan : beam)(size, 60 + 7.3125 * i, i % 2 ? 'oal' : 'wp', { ends: { A: Object.assign(SQ(), ends.A), B: Object.assign(SQ(), ends.B) } }));
  }
  // ===== F. every bolt size x every hole type, web and flanges, slots both ways (AISC J3.3 by measurement)
  {
    const bolts = Object.keys(J33);
    for (const [i, bolt] of everyNth(bolts, 7, 4).entries()) {
      const g = [], sp = (x) => 6 + 7 * x;                   // W24x104: wide flange and deep web, room for every size
      g.push({ face: 'web', bolt, type: 'std', x0: sp(0), n: 1, p: 3, ny: 2, py: 4, autoY: true });
      g.push({ face: 'web', bolt, type: 'ovs', x0: sp(1), n: 1, p: 3, ny: 1, wref: 'tos', y0: 6 });
      g.push({ face: 'web', bolt, type: 'ssl', ax: 'x', x0: sp(2), n: 1, p: 3, ny: 1, wref: 'bos', y0: 7 });
      g.push({ face: 'web', bolt, type: 'lsl', ax: 'y', x0: sp(3), n: 1, p: 3, ny: 1, wref: 'cl', y0: 0 });
      g.push({ face: 'tf', bolt, type: 'std', x0: sp(0), n: 1, p: 3, amode: 'gauge', g: 7 });
      g.push({ face: 'bf', bolt, type: 'ovs', x0: sp(1), n: 1, p: 3, amode: 'off', g: 3.5 });
      g.push({ face: 'tf', bolt, type: 'lsl', ax: 'x', x0: sp(2), n: 1, p: 3, amode: 'off', g: -4 });
      g.push({ face: 'bf', bolt, type: 'ssl', ax: 'y', x0: sp(3), n: 1, p: 3, amode: 'off', g: -3.25 });
      add('bolt ' + bolt + ' all hole types W24x104', beam('W24x104', 40 + i, i % 2 ? 'wp' : 'oal', { groups: g }));
      if (!QUICK && i % 2 === 0) add('bolt ' + bolt + ' channel web + flange', chan('MC18x42.7', 36, 'oal', { groups: [{ face: 'web', bolt, type: 'lsl', ax: 'x', refEnd: 'B', x0: 5, n: 1, ny: 2, py: 6, autoY: true }, { face: 'web', bolt, type: 'ssl', ax: 'y', x0: 6, n: 1, ny: 1, wref: 'tos', y0: 4 }, { face: 'tf', bothF: true, bolt, type: bolt === '1 1/4' || bolt === '1 1/8' ? 'std' : 'ovs', x0: 12, n: 1, g: 2.25 }] }));
    }
    if (!QUICK) add('custom hole diameters', beam('W16x40', 48, 'oal', { groups: [{ face: 'web', bolt: '3/4', type: 'cust', dia: 0.531, x0: 4, n: 2, p: 5.5, ny: 1, autoY: true }, { face: 'web', bolt: '3/4', type: 'cust', dia: 2.5, x0: 20, n: 1, ny: 1, wref: 'tos', y0: 8 }, { face: 'tf', bolt: '1/2', type: 'cust', dia: 0.4375, x0: 4, n: 1, g: 3.5 }] }));
  }
  // ===== G. where the holes are measured from: reference end, both ends, exact-spot lists, each web reference, in both length modes with angled ends
  {
    const A30 = () => Object.assign(SQ(), { tv: 30 }), P45 = () => Object.assign(SQ(), { tp: 45 }), Vn20 = () => Object.assign(SQ(), { tv: -20 });
    const web = (o) => Object.assign({ face: 'web', bolt: '3/4', type: 'std', x0: 6, n: 2, p: 3, ny: 2, py: 3, wref: 'tos', y0: 3 }, o);
    const list = [
      ['ref A oal, 30 vert at A', beam('W12x26', 72, 'oal', { ends: { A: A30(), B: SQ() }, groups: [web({ refEnd: 'A' })] })],
      ['ref B oal, 30 vert at A, plan 45 at B', beam('W12x26', 84.3125, 'oal', { ends: { A: A30(), B: P45() }, groups: [web({ refEnd: 'B', x0: 9.5 })] })],
      ['ref A wp, 30 vert at A', beam('W12x26', 72, 'wp', { ends: { A: A30(), B: SQ() }, groups: [web({ refEnd: 'A' })] })],
      ['ref B wp, plan 45 at B', beam('W12x26', 72, 'wp', { ends: { A: SQ(), B: P45() }, groups: [web({ refEnd: 'B', x0: 9.5 })] })],
      ['both ends oal, angled both', beam('W16x40', 96, 'oal', { ends: { A: A30(), B: Vn20() }, groups: [web({ both: true, x0: 12, n: 1, ny: 3, wref: 'bos', y0: 4 })] })],
      ['both ends wp, angled both', beam('W16x40', 96, 'wp', { ends: { A: A30(), B: Vn20() }, groups: [web({ both: true, x0: 12, n: 1, ny: 3, wref: 'cl', y0: -3 })] })],
      ['exact spots from A oal', beam('W12x26', 60, 'oal', { ends: { A: P45(), B: SQ() }, groups: [web({ xs: [6, 9.5, 21.0625], ny: 1, autoY: true })] })],
      ['exact spots from B wp', chan('C10x15.3', 60, 'wp', { ends: { A: SQ(), B: A30() }, groups: [web({ refEnd: 'B', xs: [7, 13.375, 30], ny: 1, wref: 'tos', y0: 5 })] })],
      ['flange holes ref B oal, vertical miter at B', beam('W12x26', 72, 'oal', { ends: { A: SQ(), B: A30() }, groups: [{ face: 'tf', bothF: true, bolt: '3/4', type: 'std', refEnd: 'B', x0: 9, n: 2, p: 3, autoG: true, g: 3.5 }] })],
      ['channel flange, both ends, gauge from back', chan('C12x20.7', 48, 'oal', { ends: { A: Object.assign(SQ(), { tp: 30 }), B: SQ() }, groups: [{ face: 'tf', bothF: true, bolt: '5/8', type: 'std', both: true, x0: 5, n: 1, g: 1.75 }] })],
      ['channel flange "single line at offset" is the same gauge from the back', chan('C10x15.3', 36, 'oal', { groups: [{ face: 'bf', bolt: '1/2', type: 'std', x0: 4, n: 2, p: 3, amode: 'off', g: 1.5 }] })],
      ['beam flange single line at offset, both signs', beam('W14x90', 40, 'oal', { groups: [{ face: 'tf', bolt: '7/8', type: 'std', x0: 6, n: 2, p: 4, amode: 'off', g: 4.5 }, { face: 'bf', bolt: '7/8', type: 'std', x0: 20, n: 2, p: 4, amode: 'off', g: -5.25 }] })],
      ['web rows 4 deep, auto centred, odd pitch', beam('W24x68', 30, 'oal', { groups: [web({ x0: 3, n: 1, ny: 4, py: 3.5, autoY: true }), web({ refEnd: 'B', x0: 3, n: 2, p: 2.625, ny: 3, py: 4.3125, wref: 'tos', y0: 5.5 })] })]
    ];
    for (const [nm, spec] of everyNth(list, 6, 1)) { await primeStdGauge(spec); add('datum ' + nm, spec); }
  }
  // ===== H. every one-click recipe, as the form writes it (the groups are read back from the form, not assumed)
  {
    const setups = everyNth([['beam', 'W12x26', 60, 'oal', null], ['beam', 'W18x50', 54.5, 'wp', { A: { tv: 5 }, B: { tp: 20 } }], ['chan', 'C8x11.5', 60, 'oal', null], ['chan', 'C12x20.7', 50.625, 'wp', { A: { tv: -15 } }]], 4);
    for (const [fam, size, len, mode, ends] of setups) {
      const n = fam === 'beam' ? 5 : 4;
      for (let i = 0; i < n; i++) {
        if (QUICK && i % 2) continue;
        const spec = (fam === 'beam' ? beam : chan)(size, len, mode, ends ? { ends: { A: Object.assign(SQ(), ends.A), B: Object.assign(SQ(), ends.B) } } : null);
        await primeStdGauge(spec);
        add('recipe ' + fam + ' #' + i + ' on ' + size + ' ' + mode, spec, { recipe: i });
      }
    }
  }
  // ===== I. holes hard up against things: a cope, the k-zone, the flange edge, an end cut
  {
    const list = [
      ['web hole 1/8 past a cope end and 1/8 under its floor', beam('W16x40', 48, 'oal', { ends: { A: Object.assign(SQ(), { ct: { c: 4, dc: 2.5, r: 0.5 } }), B: SQ() }, groups: [{ face: 'web', bolt: '3/4', type: 'std', x0: q4(4 + 0.40625 + 0.125), n: 1, ny: 1, wref: 'tos', y0: 1.5 }, { face: 'web', bolt: '3/4', type: 'std', x0: 1.5, n: 1, ny: 1, wref: 'tos', y0: q4(2.5 + 0.40625 + 0.125) }] })],
      ['web hole edge 1/16 from the inside of the flange (k-zone)', beam('W14x90', 36, 'oal', { groups: [{ face: 'web', bolt: '3/4', type: 'std', x0: 6, n: 2, p: 3, ny: 1, wref: 'tos', y0: q4(0.71 + 0.40625 + 0.0625) }, { face: 'web', bolt: '3/4', type: 'std', x0: 20, n: 1, ny: 1, wref: 'bos', y0: q4(0.71 + 0.40625 + 0.0625) }] })],
      ['flange hole edge 1/8 from the flange tip', beam('W12x26', 36, 'oal', { groups: [{ face: 'tf', bothF: true, bolt: '3/4', type: 'std', x0: 6, n: 2, p: 3, amode: 'gauge', g: q4(6.49 - 2 * (0.40625 + 0.125)) }] })],
      ['channel flange hole 1/8 from the toe', chan('C15x33.9', 36, 'oal', { groups: [{ face: 'tf', bothF: true, bolt: '1/2', type: 'std', x0: 6, n: 2, p: 3, g: q4(3.4 - 0.28125 - 0.125) }] })],
      ['hole edge 1/8 from a square end, both ends', beam('W12x26', 36, 'oal', { groups: [{ face: 'web', bolt: '3/4', type: 'std', both: true, x0: q4(0.40625 + 0.125), n: 1, ny: 2, py: 3, autoY: true }, { face: 'tf', bolt: '3/4', type: 'ssl', ax: 'x', both: true, x0: 0.625, n: 1, autoG: true, g: 3.5 }] })],
      ['web hole that cuts into the root fillet as modelled, with no k-zone warning on the form', beam('W16x67', 48, 'oal', { groups: [{ face: 'web', bolt: '1 1/4', type: 'std', x0: 6, n: 1, ny: 1, wref: 'tos', y0: 14.625 }] })],
      ['web hole 1/2 in from a 45 vertical miter, long-point datum', beam('W12x26', 48, 'oal', { ends: { A: Object.assign(SQ(), { tv: 45 }), B: SQ() }, groups: [{ face: 'web', bolt: '3/4', type: 'std', x0: q4(6.11 + 5 + 0.40625 + 0.5), n: 1, ny: 1, wref: 'bos', y0: 1.11 }] })]
    ];
    for (const [nm, spec, more] of everyNth(list, 6)) { await primeStdGauge(spec); add('near ' + nm, spec, more); }
  }
  // ===== J. lengths: barely longer than the end cuts, 40 ft, sixteenths and odd decimals, both modes
  {
    const V45 = () => Object.assign(SQ(), { tv: 45 });
    const list = [
      ['40 ft exactly, oal', beam('W30x116', 480, 'oal', { lenText: "40'-0" })], ['39 ft 11 15/16, wp, mitered', beam('W24x68', 479.9375, 'wp', { lenFmt: 'ftin', ends: { A: V45(), B: Object.assign(SQ(), { tp: -30 }) } })],
      ['2 1/16 long, square', beam('W8x31', 2.0625, 'oal')], ['odd decimal 137.413', chan('C10x15.3', 137.413, 'oal')],
      ['short point 1/2 in: 45/45 frame miter, oal', beam('W12x26', q4(2 * 12.22 + 0.5), 'oal', { ends: { A: V45(), B: V45() } })],
      ['short point 3/4 in: 60 plan one end, wp', chan('C8x11.5', q4(0.75 + (2.26 - 0.11) * Math.tan(Math.PI / 3)), 'wp', { ends: { A: Object.assign(SQ(), { tp: -60 }), B: SQ() } })],
      ['40 ft with 75 deg vertical both ends, oal', beam('W12x26', 480, 'oal', { lenText: "40'", ends: { A: Object.assign(SQ(), { tv: 75 }), B: Object.assign(SQ(), { tv: 75 }) } })]
    ];
    for (const [nm, spec] of everyNth(list, 4, 1)) add('length ' + nm, spec);
    // the same length typed several ways must be the same part
    for (const [t, v] of [["10'-6 3/8", 126.375], ["10' 6 3/8\"", 126.375], ['126 3/8', 126.375], ['126.375', 126.375], ["10'6 3/8", 126.375], ["10.5'", 126], ['126-3/8', 126.375], ["0'-11 1/16", 11.0625], ["10'", 120], [".5'", 6]])
      add('length text ' + JSON.stringify(t), beam('W12x26', v, 'oal', { lenText: t }), { appOnly: (c, r, cs) => { chk(!c.blocked(r), 'length.text-not-accepted', cs, 'typed ' + t + ': ' + r.warns.map(w => w.t).join(' | ')); near(r.LP, v, 1e-9, 'length.text-read-wrong', cs, 'typed ' + JSON.stringify(t) + ' read as overall length'); } });
  }
  if (!QUICK) add('60 holes in one part (5 x 4 web + 10 x 2 x 2 flange)', beam('W21x62', 96, 'oal', { groups: [{ face: 'web', bolt: '3/4', type: 'std', x0: 6, n: 5, p: 6, ny: 4, py: 4, autoY: true }, { face: 'tf', bothF: true, bolt: '3/4', type: 'std', x0: 40, n: 10, p: 4.5, amode: 'gauge', g: 5.5 }] }));

  edgeCases();
}

// ------------------------------------------------------------------ recipes: what each button promises, checked on the model built from the form
function recipeSetup(cs) {
  cs.after = (c) => {
    const rec = c.renderVals().recipes[cs.recipe]; cs.recipeLabel = rec.l; rec.go();
    // read the groups the button wrote into the form, with this file's own reader
    cs.spec.groups = c.state.groups.map(g => {
      const o = { face: g.face, bothF: !!g.bothF, bolt: g.bolt, type: g.type, ax: g.ax, refEnd: g.refEnd, both: !!g.both, x0: readTok(g.x0T), p: readTok(g.pT), n: +g.nT, wref: g.wref, y0: readTok(g.y0T), ny: +g.nyT, py: readTok(g.pyT), autoY: !!g.autoY, amode: g.amode, g: readTok(g.gT), autoG: !!g.autoG };
      if (String(g.xsT || '').trim()) o.xs = g.xsT.split(',').map(readTok);
      if (g.type === 'cust') o.dia = readTok(g.diaT);
      return o;
    });
  };
  cs.extra = ({ M, cs: k }) => {
    const mid = (M.datum[0] + M.datum[1]) / 2, by = (f) => M.holes.filter(h => h.face === f), xsOf = (hs) => [...new Set(hs.map(h => +h.x.toFixed(6)))].sort((a, b) => a - b);
    const lbl = cs.recipeLabel, std = stdShown.get(stdKey(cs.spec));
    if (/Web bolts/.test(lbl)) {
      const w = by('web'), x = xsOf(w), ny = M.d >= 18 ? 4 : M.d >= 12 ? 3 : M.d >= 8 ? 2 : 1, ys = [...new Set(w.map(h => +h.c.toFixed(6)))].sort((a, b) => a - b);
      chk(ys.length === ny, 'recipe.web-bolts', k, lbl + ': ' + ys.length + ' rows, tip says ' + ny);
      near((ys[0] + ys[ys.length - 1]) / 2, 0, TOL, 'recipe.web-bolts', k, lbl + ': rows centred on the web');
      for (let i = 1; i < ys.length; i++) near(ys[i] - ys[i - 1], 3, TOL, 'recipe.web-bolts', k, lbl + ': rows 3 apart');
      near(x[0] - M.datum[0], 2, TOL, 'recipe.web-bolts', k, lbl + ': 2 in from the end');
      chk(x.length === (/both/.test(lbl) ? 2 : 1), 'recipe.web-bolts', k, lbl + ': ' + x.length + ' stations');
      if (/both/.test(lbl) && x.length === 2) near(M.datum[1] - x[1], 2, TOL, 'recipe.web-bolts', k, lbl + ': 2 in from the other end');
      chk(w.every(h => Math.abs(h.dia - 13 / 16) < 1e-9), 'recipe.web-bolts', k, lbl + ': 13/16 holes for 3/4 bolts');
    } else if (/Flange bolts/.test(lbl)) {
      const f = by('tf'), x = xsOf(f), zs = [...new Set(f.map(h => +h.c.toFixed(6)))].sort((a, b) => a - b);
      chk(f.length === 8 && by('bf').length === 0, 'recipe.flange-bolts', k, lbl + ': ' + f.length + ' top-flange holes (4 each end)');
      chk(x.length === 4 && Math.abs(x[0] - M.datum[0] - 2) < TOL && Math.abs(x[1] - x[0] - 3) < TOL, 'recipe.flange-bolts', k, lbl + ': 2 and 5 in from each end, got ' + x.map(fx).join(', '));
      if (std != null) near(zs[zs.length - 1] - zs[0], std, TOL, 'recipe.flange-bolts', k, lbl + ': on the standard gauge the form shows');
    } else if (/every 12/.test(lbl)) {
      const hs = /Web/.test(lbl) ? by('web') : by('tf'), x = xsOf(hs);
      if (x.length) near((x[0] + x[x.length - 1]) / 2, mid, TOL + 1 / 32, 'recipe.every-12', k, lbl + ': pattern centred on the length (to the nearest 1/16 the form can show)');
      for (let i = 1; i < x.length; i++) near(x[i] - x[i - 1], 12, TOL, 'recipe.every-12', k, lbl + ': pitch');
      chk(x.length >= 1 && x[0] - M.datum[0] >= 6 - 1 / 16 - 1e-9 && x[0] - M.datum[0] < 12 + 1e-9, 'recipe.every-12', k, lbl + ': first hole ' + fx(x[0] - M.datum[0]) + ' from the end (6 to 12 expected)');
      if (/Web/.test(lbl)) chk(hs.every(h => Math.abs(h.c) < 1e-9), 'recipe.every-12', k, lbl + ': on the web centre line');
    }
  };
}

// ------------------------------------------------------------------ edge cases: things the form accepts that must either cut right or be stopped
function edgeCases() {
  const W = 'W12x26', dW = 12.22, tfW = 0.38, hwW = dW / 2 - tfW;
  const E = (o) => Object.assign(SQ(), o);
  const webG = (o) => Object.assign({ face: 'web', bolt: '3/4', type: 'std', x0: 6, n: 1, p: 3, ny: 1, autoY: true, py: 3 }, o);
  const B = (more) => beam(W, 96, 'oal', more);
  const must = (id, spec, why, key, evidence, more) => add('edge ' + id, spec, Object.assign({ expect: 'blocked', why, key, evidence }, more));
  const rayOf = async (c, r) => { const eng = await engine(), { K, shape } = OCCM.buildSolid(eng, c, r); return { K, shape, R: rayer(K, shape, 1) }; };

  // ---- 1. holes and cuts that are off the part must stop the export
  must('hole inside a cope', B({ ends: { A: E({ ct: { c: 4, dc: 3, r: 0.5 } }), B: SQ() }, groups: [webG({ x0: 2, wref: 'tos', autoY: false, y0: 2 })] }), 'a web hole inside the cope cannot be cut');
  must('hole off the end', B({ groups: [webG({ x0: 0.25 })] }), 'a hole hanging off the end cannot be cut');
  must('flange hole past the flange edge', B({ groups: [{ face: 'tf', bolt: '3/4', type: 'std', x0: 6, n: 1, amode: 'gauge', g: 6 }] }), 'flange holes at gauge 6 on a 6.49 flange hang off the edge');
  must('web hole into the flange', B({ groups: [webG({ autoY: false, wref: 'tos', y0: 0.625 })] }), 'a web hole 5/8 below top of steel runs into the flange');
  must('hole beyond a mitered end (long-point datum)', beam(W, 96, 'oal', { ends: { A: E({ tv: 45 }), B: SQ() }, groups: [webG({ x0: 3, autoY: false, wref: 'bos', y0: 2 })] }), 'the web is cut away here by the 45 degree end');
  must('cope deeper than the web', B({ ends: { A: E({ ct: { c: 4, dc: 12, r: 0.5 } }), B: SQ() } }), 'a 12 in deep cope severs a 12.22 beam');
  must('copes longer than the piece', beam(W, 7, 'oal', { ends: { A: E({ ct: { c: 4, dc: 1.5, r: 0.5 } }), B: E({ ct: { c: 4, dc: 1.5, r: 0.5 } }) } }), 'two 4 in copes on a 7 in piece');
  must('overall length shorter than the end cuts', beam(W, 3, 'oal', { ends: { A: E({ tv: 45 }), B: E({ tv: 45 }) } }), 'a 45/45 miter on a 12 in beam cannot be 3 in overall');
  must('flange thicker than half the depth (custom)', beam('', 96, 'oal', { cust: { d: 12, bf: 6, tf: 6, tw: 0.25, wt: 26 } }), 'no web left');
  for (const t of ['126,5', '10 6', "10'-6'", 'abc', '', '0', '-96']) must('length text ' + JSON.stringify(t), B({ lenText: t }), 'length ' + JSON.stringify(t) + ' is not a length', 'input.length-text-misread');

  // ---- 2. holes the form silently drops or moves
  must('more than 60 holes: 40 from each end', beam(W, 480, 'oal', { lenText: "40'", groups: [webG({ both: true, x0: 2, p: 3, n: 40 })] }), 'the form asks for 40 holes from each end = 80; the app keeps 60 and says nothing',
    'hole.dropped-silently (more than 60 in a group)', async (c, r) => 'calc() lists ' + r.holes.length + ' holes, all "ok"; the last 20 of the End B set are missing');
  must('100 holes typed', beam(W, 480, 'oal', { lenText: "40'", groups: [webG({ x0: 2, p: 3, n: 100 })] }), 'the form asks for 100 holes at 3 in; the app keeps 60 and says nothing', 'hole.dropped-silently (more than 60 in a group)', null, { noExport: true });
  must('exact spots typed with spaces "3 9 15"', B({ groups: [webG({ xs: [3, 9, 15], xsText: '3 9 15' })] }), 'three spots typed without commas: the app makes NO holes for the group and says nothing', 'hole.dropped-silently (exact-spots text not understood)', async (c, r) => 'calc() lists ' + r.holes.length + ' holes');
  must('exact spots with one bad token "3, 9x, 15"', B({ groups: [webG({ xs: [3, 9, 15], xsText: '3, 9x, 15' })] }), 'one of three spots is mistyped: the app drops that hole and says nothing', 'hole.dropped-silently (exact-spots text not understood)', async (c, r) => 'calc() lists ' + r.holes.length + ' holes at ' + r.holes.map(h => fx(h.x)).join(', '));
  must('first-hole distance left blank', B({ groups: [webG({ x0Text: '' })] }), 'a blank distance', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'hole cut at ' + fx(r.holes[0].x) + ' from End A');
  must('spacing "x"', B({ groups: [webG({ n: 2, pText: 'x' })] }), 'spacing is not a number', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'holes at ' + r.holes.map(h => fx(h.x)).join(', '));
  must('flange gauge "2,75"', B({ groups: [{ face: 'tf', bolt: '3/4', type: 'std', x0: 6, n: 1, amode: 'gauge', g: 2.75, gText: '2,75' }] }), 'gauge typed with a comma', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'gauge cut ' + fx(Math.abs(r.holes[0].c) * 2) + ' (typed 2,75)');
  must('hole count "0"', B({ groups: [webG({ nText: '0' })] }), 'zero holes asked for in an active group', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'calc() lists ' + r.holes.length + ' hole(s)');

  // ---- 3. angles
  must('angle typed as a fraction "22 1/2"', beam(W, 96, 'wp', { ends: { A: E({ tv: 22.5, tvText: '22 1/2' }), B: SQ() } }), 'every other box on the form takes "22 1/2"; the angle box reads it as 22', 'input.angle-fraction-ignored',
    async (c, r) => { const { R } = await rayOf(c, r), a = R.axis(0, [0, dW / 2 - 1e-4, 1])[0], b = R.axis(0, [0, -dW / 2 + 1e-4, 1])[0]; return 'end cut measured ' + (Math.atan((b - a) / (dW - 2e-4)) * 180 / Math.PI).toFixed(3) + ' deg; long point at ' + fx(a) + ' vs ' + fx(-dW / 2 * T(22.5)) + ' for 22.5 deg (short by ' + fx(a + dW / 2 * T(22.5)) + ')'; });
  must('angle typed "22,5"', beam(W, 96, 'wp', { ends: { A: E({ tv: 22.5, tvText: '22,5' }), B: SQ() } }), 'decimal comma: read as 22', 'input.angle-fraction-ignored', async (c, r) => 'calc() uses ' + r.A.tv + ' deg');
  must('angle typed 80 (limit is 75)', beam(W, 96, 'wp', { ends: { A: E({ tv: 80, tvText: '80' }), B: SQ() } }), 'the app cuts 75 degrees instead and says nothing', 'input.value-clamped-silently', async (c, r) => 'calc() uses ' + r.A.tv + ' deg; long point ' + fx(r.aMin) + ' vs ' + fx(-dW / 2 * T(80)) + ' for 80 deg');
  must('angle typed "abc" with the end set to Angled', beam(W, 96, 'wp', { ends: { A: E({ tvText: 'abc', tpText: '' }), B: SQ() } }), 'the end is marked angled but nothing readable is typed: it is cut square', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'calc() uses ' + r.A.tv + ' / ' + r.A.tp + ' deg');

  // ---- 4. copes and rat holes the form changes
  must('cope length typed 0', B({ ends: { A: E({ ct: { c: 0, dc: 1.5, r: 0.5, cText: '0' } }), B: SQ() } }), 'a zero-length cope becomes a 4 in cope', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'cope cut ' + r.A.ct.c + ' long');
  must('cope radius typed 0', B({ ends: { A: E({ ct: { c: 4, dc: 1.5, r: 0, rText: '0' } }), B: SQ() } }), 'a square-cornered cope (radius 0) becomes radius 1/2', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'cope radius cut ' + r.A.ct.r);
  must('cope radius larger than the cope', B({ ends: { A: E({ ct: { c: 4, dc: 1.5, r: 2 } }), B: SQ() } }), 'radius 2 in a 1 1/2 deep cope: the app cuts 0.9 x 1.5 = 1.35 and says nothing', 'input.value-clamped-silently', async (c, r) => 'cope radius cut ' + fx(r.A.ct.r) + ' (typed 2)');
  must('cope depth typed 1/8 (less than the flange)', B({ ends: { A: E({ ct: { c: 4, dc: 0.125, r: 0.25 } }), B: SQ() } }), 'a 1/8 deep cope is not possible on a 0.38 flange: the app raises it to the flange thickness and only warns', 'input.value-changed-with-a-warning-only', async (c, r) => 'cope cut ' + fx(r.A.ct.dc) + ' deep, radius ' + fx(r.A.ct.r) + ' (typed 1/8 and 1/4)');
  must('rat hole radius larger than the web allows', B({ ends: { A: E({ rat: 'BOTH', rr: 3 }), B: SQ() } }), 'rat radius 3 on a 12 in beam: the app cuts ' + fx(hwW / 2.2) + ' and says nothing', 'input.value-clamped-silently', async (c, r) => 'rat radius cut ' + fx(r.A.rr) + ' (typed 3)');
  must('rat hole radius typed 0', B({ ends: { A: E({ rat: 'TOP', rr: 0.75, rrText: '0' }), B: SQ() } }), 'radius 0 becomes 3/4', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'rat radius cut ' + r.A.rr);

  // ---- 5. custom beam boxes and the length box
  must('custom beam: depth left blank', beam('', 96, 'oal', { cust: { d: 12, bf: 6, tf: 0.375, tw: 0.25, wt: 26, dText: '' } }), 'no depth typed: a 12 in deep beam is exported', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'section cut d=' + r.sec.d + ' bf=' + r.sec.bf + ' tf=' + r.sec.tf + ' tw=' + r.sec.tw);
  must('custom beam: flange thickness "1/2in", web "0"', beam('', 96, 'oal', { cust: { d: 10, bf: 5, tf: 0.5, tw: 0.3125, wt: 26, tfText: '1/2in', twText: '0' } }), 'unreadable thicknesses fall back to 3/8 and 1/4', 'input.unreadable-number-replaced-by-a-default', async (c, r) => 'section cut tf=' + r.sec.tf + ' tw=' + r.sec.tw + ' (typed 1/2in and 0)');
  must('custom beam: web wider than the flange', beam('', 96, 'oal', { cust: { d: 12, bf: 0.25, tf: 0.375, tw: 0.5, wt: 26 } }), 'web 1/2 thick on a 1/4 wide flange is not a beam');
  must('stale size after a series change (bser S, bsize W12x26)', beam(W, 96, 'oal'), 'series S with a W size still selected: the app exports the first S size', 'input.unknown-size-replaced-by-first-in-table', async (c, r) => 'section exported: d=' + r.sec.d + ' bf=' + r.sec.bf + ' (S3x5.7)', { patch: Object.assign(patchOf(beam(W, 96, 'oal')), { bser: 'S' }) });
  must('length with a letter O for zero "1O\'-6"', B({ lenText: "1O'-6" }), 'typed 1O\'-6 (letter O): read as 1 ft 6 in', 'input.length-text-misread', async (c, r) => 'part exported ' + fx(r.LP) + ' long');
  must('length "1 0\'-6"', B({ lenText: "1 0'-6" }), 'a stray space in the feet: read as 1 ft 6 in', 'input.length-text-misread', async (c, r) => 'part exported ' + fx(r.LP) + ' long');

  // ---- 6. holes the form accepts that cannot be cut as drawn
  must('flange hole over the web (single line, offset 1/4)', B({ groups: [{ face: 'tf', bolt: '3/4', type: 'std', x0: 6, n: 1, amode: 'off', g: 0.25 }] }), 'a 13/16 hole through the top flange directly over the web', 'hole.flange-hole-over-the-web-not-flagged',
    async (c, r) => { const { R, K, shape } = await rayOf(c, r), y = R.axis(1, [6, 0, 0]); return 'the solid has the web cut down to y=' + fx(y[y.length - 1]) + ' under the hole (inside of flange is ' + fx(hwW) + '), ' + genus(K, shape) + ' through-openings for 1 hole'; });
  must('flange gauge 1 in (holes on the web fillets)', B({ groups: [{ face: 'tf', bolt: '3/4', type: 'std', x0: 6, n: 1, amode: 'gauge', g: 1 }] }), 'two 13/16 holes 1 in apart straddle a 0.23 web: both cut into the web and its fillets', 'hole.flange-hole-over-the-web-not-flagged', async (c, r) => 'holes at z = ' + r.holes.map(h => fx(h.c)).join(', ') + ', hole edge ' + fx(0.5 - 0.40625) + ' from the web centre line');
  must('web hole clipping the radius of a cope', beam('W16x40', 48, 'oal', { ends: { A: E({ ct: { c: 4, dc: 3, r: 0.5 } }), B: SQ() }, groups: [webG({ autoY: false, x0: 4.0625, wref: 'tos', y0: 3.0625 })] }), 'the hole overlaps the cope corner by about 1/8 (the app tests only 5 points of the hole)', 'hole.partly-in-a-cope-not-flagged',
    async (c, r) => { const { K, shape } = await rayOf(c, r); return 'hole marked ok; the solid has ' + genus(K, shape) + ' closed holes (the opening runs into the cope)'; });
  must('web hole clipping a 45 degree mitered end', beam(W, 48, 'wp', { ends: { A: E({ tv: 45 }), B: SQ() }, groups: [webG({ autoY: false, x0: 0.5, wref: 'cl', y0: 0 })] }), 'the hole crosses the mitered edge between its test points', 'hole.partly-off-a-mitered-end-not-flagged',
    async (c, r) => { const { K, shape } = await rayOf(c, r); return 'hole marked ok; the solid has ' + genus(K, shape) + ' closed holes'; });
  must('single cope longer than the piece', B({ ends: { A: E({ ct: { c: 200, dc: 1.5, r: 0.5 } }), B: SQ() } }), 'a 200 in cope on a 96 in beam');
  must('cope reaches past the short side of the other end\'s plan miter', beam('W16x50', 10.6875, 'wp', { ends: { A: E({ tp: 52.75 }), B: E({ ct: { c: 7.0625, dc: 2.875, r: 0.75 } }) } }), 'the top flange outline crosses itself');

  // ---- 7. cope and angle together, and compound angles: measured against plane geometry like any other part
  must('cope + miter same end, top short (v -45)', B({ ends: { A: E({ tv: -45, ct: { c: 4, dc: 1.5, r: 0.5 } }), B: SQ() } }), 'a cope and a miter on the same end is refused by the form', 'app.bad-input-not-stopped');
  must('cope + miter same end, top long (v +30)', B({ ends: { A: E({ tv: 30, ct: { c: 4, dc: 1.5, r: 0.5 } }), B: SQ() } }), 'a cope and a miter on the same end is refused by the form', 'app.bad-input-not-stopped');
  must('cope + plan miter same end (p 30)', B({ ends: { A: E({ tp: 30, cb: { c: 5, dc: 1.5, r: 0.5 } }), B: SQ() } }), 'a cope and a miter on the same end is refused by the form', 'app.bad-input-not-stopped');
  must('channel web hole 3/16 above the bottom flange (in the modelled fillet)', chan('MC6x18', 36, 'oal', { groups: [{ face: 'web', bolt: '3/4', type: 'std', x0: 10, n: 1, ny: 1, wref: 'bos', y0: 1.0625 }] }), 'a web hole in the flange fillet is refused by the form', 'app.bad-input-not-stopped');
  add('edge cope at A, 30 vertical miter at B', B({ ends: { A: E({ ct: { c: 4, dc: 1.5, r: 0.5 } }), B: E({ tv: 30 }) } }));
  add('edge cope at A, 45 plan miter at B', B({ ends: { A: E({ ct: { c: 4, dc: 1.5, r: 0.5 } }), B: E({ tp: 45 }) } }));
  add('edge rat hole at A, 45 plan miter at B (channel)', chan('C10x15.3', 60, 'oal', { ends: { A: E({ rat: 'BOT', rr: 0.5 }), B: E({ tp: 45 }) } }));
  add('edge same miters, no cope (control for the three above)', B({ ends: { A: SQ(), B: E({ tp: 45, tv: 30 }) } }));
  must('cope radius 1/2 in a 3/4 deep cope (radius does not fit under the flange)', B({ ends: { A: E({ ct: { c: 4, dc: 0.75, r: 0.5 } }), B: SQ() } }), 'a cope radius that cannot fit below the flange is refused by the form', 'app.bad-input-not-stopped');
  must('thick web: hole 1/32 under the flange (in the fillet)', beam('S24x121', 24, 'oal', { groups: [{ face: 'web', bolt: '3/4', type: 'std', x0: 6, n: 1, ny: 1, wref: 'tos', y0: q4(1.09 + 0.40625 + 0.03) }] }), 'a web hole in the flange fillet is refused by the form', 'app.bad-input-not-stopped');
  add('edge cope exactly one flange thick (flange strip)', B({ ends: { A: E({ ct: { c: 4, dc: tfW, r: 0.25 } }), B: SQ() } }));
  if (QUICK) return;
  add('edge compound 75 / 75 on W30x116 (both ends, wp)', beam('W30x116', 480, 'wp', { lenText: "40'", ends: { A: E({ tv: 75, tp: 75 }), B: E({ tv: 75, tp: 75 }) } }));
  add('edge compound 75 / -75 on W12x26 (one end, oal)', beam(W, 240, 'oal', { ends: { A: E({ tv: 75, tp: -75 }), B: SQ() } }));
  add('edge compound 60 / 60 on W24x68', beam('W24x68', 240, 'oal', { ends: { A: E({ tv: 60, tp: 60 }), B: E({ tv: -60, tp: 60 }) } }));
}

// ------------------------------------------------------------------ run
async function main() {
  await buildCases();
  for (const cs of cases) if (cs.recipe != null) recipeSetup(cs);
  const list = ONLY ? cases.filter(c => c.id.includes(ONLY)) : cases;
  for (const cs of list) {
    const t = Date.now(); _pt = t;
    try { await runCase(cs); }
    catch (e) { chk(false, 'engine.error', cs, String(e && e.stack || e).slice(0, 300)); try { await engine(true); } catch (e2) { } }
    cs.ms = Date.now() - t;
    if (cs.spec && !cs.spec.cust && cs.spec.size && cs.M) stats.sizes.add(cs.spec.size);
    if (VERBOSE) console.log((cs.failed ? 'FAIL ' : 'ok   ') + cs.id + '  ' + cs.ms + ' ms');
  }
  finalNotes();
  report(list);
}

/** Things measured along the way that are reported, not judged. */
function finalNotes() {
  const rows = [];
  for (const [name, k] of Object.entries(KDIM)) {
    const f = stats.fillet.get(name); if (!f) continue;
    const kMod = f.tf + f.rr, k1Mod = f.tw / 2 + f.rr;
    rows.push({ name, modelledR: +f.rr.toFixed(4), modelledK: +kMod.toFixed(4), aiscK: k[0], kDiff: +(kMod - k[0]).toFixed(4), modelledK1: +k1Mod.toFixed(4), aiscK1: k.length > 1 ? k[1] : null, k1Diff: k.length > 1 ? +(k1Mod - k[1]).toFixed(4) : null });
  }
  stats.filletVsAisc = rows;
  if (rows.length) {
    const w = rows.filter(q => q.aiscK1 != null), o = rows.filter(q => q.aiscK1 == null);
    const span = (a) => a.length ? Math.min(...a).toFixed(3) + ' to ' + Math.max(...a).toFixed(3) : '-';
    notes.push('root fillet as modelled vs AISC (' + rows.length + ' sample shapes measured in this run): W shapes, modelled k minus k_des = ' + span(w.map(q => q.kDiff)) + ' in, modelled k1 minus k1 = ' + span(w.map(q => q.k1Diff)) + ' in; S / C / MC (tapered flanges), modelled k minus k = ' + span(o.map(q => q.kDiff)) + ' in');
  }
  const bad = [];
  for (const [name, g] of Object.entries(WGAGE)) { const shown = stdShown.get('beam/' + name); if (shown !== undefined && shown !== g) bad.push(name + ': form ' + shown + ', AISC ' + g); }
  if (bad.length) notes.push('"Standard gauge" on the form differs from the AISC workable gage (advisory, medium confidence) - ' + bad.join('; '));
  notes.push('faces of the read-back file sewn shut at: ' + Object.entries(stats.sewAt).map(([k, v]) => v + ' part(s) at ' + (k === 'never' ? 'no tolerance up to 0.25 mm' : k + ' mm')).join(', '));
  notes.push('cope radius is drawn as 10 chords and the rat hole as 14: largest measured shortfall from the true arc = ' + stats.arcDev.cope.toFixed(5) + ' x r (cope), ' + stats.arcDev.rat.toFixed(5) + ' x r (rat hole); those two checks use 0.001 + 0.0031 r and 0.001 + 0.0063 r');
}

function report(list) {
  const secs = ((Date.now() - T0) / 1000).toFixed(1);
  const byKey = new Map();
  for (const f of fails) { if (!byKey.has(f.key)) byKey.set(f.key, []); byKey.get(f.key).push(f); }
  const caseById = new Map(list.map(c => [c.id, c]));
  if (fails.length) {
    console.log('FAILED CHECKS (' + fails.length + '), grouped by kind, then by case (largest readings first):');
    for (const [k, v] of [...byKey].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      const per = new Map(); for (const f of v) { if (!per.has(f.case)) per.set(f.case, []); per.get(f.case).push(f); }
      console.log('\n  [' + k + ']  ' + v.length + ' failed check(s) in ' + per.size + ' case(s)');
      for (const [id, fs] of per) {
        if (id === 'tables') { for (const f of fs) console.log('    - ' + f.detail); continue; }
        const top = fs.slice().sort((a, b) => (b.mag || 0) - (a.mag || 0)).slice(0, 3);
        console.log('    - ' + id + (fs.length > 1 ? ' (' + fs.length + ' checks; the ' + top.length + ' largest shown, all are in the --json file)' : '') + ': ' + top[0].detail);
        for (const f of top.slice(1)) console.log('        ' + f.detail);
      }
    }
    console.log('\nSTATE PATCH FOR EACH FAILING CASE   (repro:  import { freshApp } from \'./test/_load.mjs\';  const c = await freshApp(PATCH);  c.calc())');
    for (const id of [...new Set(fails.map(f => f.case))]) { const cs = caseById.get(id); if (cs && cs.patch) console.log('  ' + id + '\n    ' + JSON.stringify(cs.patch)); }
  }
  if (notes.length) console.log('\nNOTES:\n  ' + notes.join('\n  '));
  if (VERBOSE) { console.log('coverage: ' + JSON.stringify(stats.cover)); console.log('time by phase (ms): ' + JSON.stringify(phase)); console.log('largest error among PASSING checks: ' + JSON.stringify(Object.fromEntries(Object.entries(stats.worst).map(([k, v]) => [k, +v.toExponential(2)])))); }
  const all = new Set([...Object.keys(DB.W), ...Object.keys(DB.S), ...Object.keys(DB.C), ...Object.keys(DB.MC)]);
  console.log('\n' + stats.cases + ' cases (' + stats.built + ' solids built, written to IGES and read back; ' + stats.mustBlock + ' must-stop cases), ' + stats.sizes.size + ' of ' + all.size + ' table sizes measured, ' + secs + ' s' + (QUICK ? ' [quick]' : ''));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (JSON_OUT) {
    mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify({ suite: 'bt-plate', quick: QUICK, seed: SEED, seconds: +secs, cases: stats.cases, solidsBuilt: stats.built, mustStopCases: stats.mustBlock, passed: pass, failed: fail, tableSizesMeasured: stats.sizes.size, tableSizes: all.size,
      failuresByKind: [...byKey].map(([k, v]) => ({ kind: k, count: v.length, cases: [...new Set(v.map(f => f.case))] })).sort((a, b) => a.kind < b.kind ? -1 : 1),
      failures: fails.map(f => ({ kind: f.key, case: f.case, detail: f.detail, offBy: f.mag, patch: (caseById.get(f.case) || {}).patch || null })),
      coverage: stats.cover, measured: { largestErrorAmongPassingChecks: stats.worst, arcShortfallOverRadius: stats.arcDev, rootFilletVsAisc: stats.filletVsAisc || [], modelledRootFillet: [...stats.fillet].map(([name, f]) => ({ name, rr: +f.rr.toFixed(4) })) }, notes }, null, 1));
  }
  process.exit(fail ? 1 : 0);
}

await main();
