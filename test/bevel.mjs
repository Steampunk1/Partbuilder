// Weld bevels drawn into the laser file.
//
// A bevel on a square-cut end of pipe, round tube or square / rect tube is part of the solid the laser gets:
// the outside edge is cut back (wall - land) x tan(angle), the land stays at the end. This suite builds such
// parts through the app, writes the IGES exactly as the app does, and then reads the FILE TEXT with the
// independent reader (bt-round-iges.mjs - its own NURBS code, no CAD kernel, no app code) and holds every
// surface and every cut edge in the file against the ideal bevelled part worked out here from first principles.
//
// Run:  node test/bevel.mjs            (about 150 parts)
//       node test/bevel.mjs --quick    (about 50)
import { loadOcc } from './_occ.mjs';
import { freshApp, Component } from './_load.mjs';
import * as occm from '../occ-solid.js';
import { trimmedFaces, igesGlobal } from './bt-round-iges.mjs';

const quick = process.argv.includes('--quick');
let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; if (fails.length < 60) fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); } };
const errs = (c) => c.calc().warns.filter((w) => w.lvl === 'err').map((w) => w.t);
const setEnd = (c, id, p) => c.setState({ ends: { ...c.state.ends, [id]: { ...c.state.ends[id], ...p } } });
const hole = (c, p) => c.setState({ wantHoles: true, groups: [{ ...c.state.groups[0], type: 'cust', ...p }] });
const rad = (d) => d * Math.PI / 180, TOL = 1e-5;
let oc = await loadOcc(), built = 0;
const engine = async () => { if (++built % 40 === 0 && oc.HEAP8.length > 500 * 1048576) oc = await loadOcc(true); return oc; };

// ------------------------------------------------------------------ the ideal part, from first principles
const endOf = (b, wall) => b ? { w: wall - b.land, c: (wall - b.land) * Math.tan(rad(b.ang)), land: b.land, tan: Math.tan(rad(b.ang)), cos: Math.cos(rad(b.ang)) } : null;
/** Signed distance from (y, z) to a rounded rectangle (half sizes h, b; corner radius r): negative inside. */
const sdRR = (y, z, h, b, r) => { const qy = Math.abs(y) - (h - r), qz = Math.abs(z) - (b - r); return Math.hypot(Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qy, qz), 0) - r; };
const dOut = (P, p) => P.kind === 'round' ? Math.hypot(p[1], p[2]) - P.ro : sdRR(p[1], p[2], P.hy, P.hz, P.rc);
/** Distance of a point from the surface of the ideal part: the nearest of the surfaces it is allowed to lie on.
 *  whole = true judges a SURFACE in the file, which may run on past the edges that trim it: each ideal surface is
 *  then taken whole (the full cylinder, the full cone, the full plane). Cut EDGES are judged with whole = false:
 *  each surface counts only where the ideal part really has it. */
function residual(P, p, whole) {
  const [x, y, z] = p, t = 2e-5; let best = 1e9; const take = (v) => { if (v < best) best = v; };
  const dO = dOut(P, p);       // signed distance to the outside and the inside surface of the section
  const dI = P.kind === 'round' ? Math.hypot(y, z) - P.ri : sdRR(y, z, P.hy - P.t, P.hz - P.t, Math.max(0, P.rc - P.t));
  const cA = P.A ? P.A.c : 0, cB = P.B ? P.B.c : 0;
  if (whole || ((P.openA || x >= cA - t) && (P.openB || x <= P.L - cB + t))) take(Math.abs(dO));
  if (whole || ((P.openA || x >= -t) && (P.openB || x <= P.L + t))) take(Math.abs(dI));
  const end = (E, xe, sg, open) => {            // sg: +1 at End A (material toward +x), -1 at End B
    if (open) return;
    const u = sg * (x - xe);                     // distance into the part from this end
    if (E) {
      if (whole || (dO >= -E.w - t && dO <= t)) take(Math.abs(u - (dO + E.w) * E.tan) * E.cos);      // the bevel: a cone / sloped plane
      if (whole || (dO <= -E.w + t && dI >= -t)) take(Math.abs(u));                                   // the land
    } else if (whole || (dO <= t && dI >= -t)) take(Math.abs(u));                                     // a plain square end
  };
  end(P.A, 0, 1, P.openA); end(P.B, P.L, -1, P.openB);
  for (const h of P.holes || []) {
    const q = [x - h.x, y - h.y0, z - h.z0], along = q[1] * h.n[1] + q[2] * h.n[2];
    if (whole || (along > 0 && dO <= t && dI >= -t)) take(Math.abs(Math.hypot(q[0], q[1] - along * h.n[1], q[2] - along * h.n[2]) - h.dia / 2));
  }
  return best;
}

/** Hold the text of a laser file against the ideal part P. near(p): only points for which it is true are judged
 *  (used when the other end is a miter or a fish-mouth: that end has its own suites). */
function judge(name, text, P, near) {
  const g = igesGlobal(text);
  ok(g.unitFlag === 1, name + ': the file is in inches', g.unitFlag + ' ' + g.unitName);
  const T = trimmedFaces(text, 40);
  ok(T.unknown.length === 0 && T.nonFinite.length === 0, name + ': every entity in the file is one the reader understands', JSON.stringify(T.unknown));
  let worstC = 0, worstB = 0, worstS = 0, at = null, atS = null, x0 = 1e9, x1 = -1e9, nBev = { A: 0, B: 0 }, ang = { A: [], B: [] };
  const edge = { Aod: 0, Aland: 0, Bod: 0, Bland: 0 };
  for (const f of T.faces) {
    const grid = [];
    if (f.surf) { const S = f.surf; for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) grid.push(S.at(S.u0 + (S.u1 - S.u0) * i / 8, S.v0 + (S.v1 - S.v0) * j / 8)); }
    const use = grid.filter((p) => !near || near(p));
    for (const p of use) { const d = residual(P, p, true); if (d > worstS) { worstS = d; atS = p; } }
    // is this patch a bevel face? every point of it sits on the slope, and it runs from the land edge to the outside edge
    for (const k of ['A', 'B']) {
      const E = P[k]; if (!E || !grid.length) continue;
      const dOf = (p) => dOut(P, p);
      const uOf = (p) => k === 'A' ? p[0] : P.L - p[0];
      if (grid.every((p) => Math.abs(uOf(p) - (dOf(p) + E.w) * E.tan) < TOL && dOf(p) > -E.w - TOL && dOf(p) < TOL)) {
        const ds = grid.map(dOf), us = grid.map(uOf), dd = Math.max(...ds) - Math.min(...ds), du = Math.max(...us) - Math.min(...us);
        if (dd > E.w - 1e-4) { nBev[k]++; ang[k].push(Math.atan2(du, dd) * 180 / Math.PI); }
      }
    }
    for (const lp of f.loops) {
      for (const seg of lp.C) for (const p of seg) {
        if (near && !near(p)) continue;
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        const d = residual(P, p); if (d > worstC) { worstC = d; at = p; }
        const dO = dOut(P, p);
        if (P.A) { if (Math.abs(dO) < TOL && Math.abs(p[0] - P.A.c) < TOL) edge.Aod++; if (Math.abs(dO + P.A.w) < TOL && Math.abs(p[0]) < TOL) edge.Aland++; }
        if (P.B) { if (Math.abs(dO) < TOL && Math.abs(p[0] - (P.L - P.B.c)) < TOL) edge.Bod++; if (Math.abs(dO + P.B.w) < TOL && Math.abs(p[0] - P.L) < TOL) edge.Bland++; }
      }
      for (const seg of lp.SB) for (const p of seg) { if (near && !near(p)) continue; const d = residual(P, p); if (d > worstB) { worstB = d; at = p; } }
    }
  }
  ok(worstC <= TOL, name + ': every cut edge in the file lies on the ideal part', worstC.toExponential(2) + ' at ' + (at || []).map((v) => v.toFixed(4)));
  ok(worstB <= TOL, name + ': every cut edge, read the other way the file stores it, lies on the ideal part', worstB.toExponential(2));
  ok(worstS <= TOL, name + ': every surface in the file lies on the ideal part', worstS.toExponential(2) + ' at ' + (atS || []).map((v) => v.toFixed(4)));
  if (!P.openA) ok(Math.abs(x0) < 1e-6, name + ': End A long point is at 0', x0);
  if (!P.openB) ok(Math.abs(x1 - P.L) < 1e-6, name + ': End B long point is at the length asked for', x1 + ' vs ' + P.L);
  const need = P.kind === 'round' ? 1 : 8;       // one cone, or four sloped flats and four corner cones
  for (const k of ['A', 'B']) {
    const E = P[k]; if (!E) continue;
    ok(nBev[k] >= need, name + ': End ' + k + ' bevel faces are in the file', nBev[k] + ' of ' + need);
    ok(ang[k].length > 0 && ang[k].every((a) => Math.abs(a - P[k + 'ang']) < 1e-3), name + ': End ' + k + ' bevel measures ' + P[k + 'ang'] + '° in the file', ang[k].map((a) => a.toFixed(4)).join(','));
    ok(edge[k + 'od'] > 20, name + ': End ' + k + ' outside edge sits ' + E.c.toFixed(4) + ' back', edge[k + 'od']);
    ok(edge[k + 'land'] > 20, name + ': End ' + k + ' land edge is at the end', edge[k + 'land']);
  }
}

/** Build the part through the app exactly as "Save for the laser" does, and judge the file. */
async function run(name, c, spec, opt = {}) {
  const r = c.calc();
  if (c.blocked(r)) { ok(false, name + ': part is not blocked', errs(c).join(' | ')); return; }
  const sec = r.sec, wall = sec.kind === 'round' ? sec.ro - sec.ri : sec.t;
  const P = sec.kind === 'round' ? { kind: 'round', ro: sec.ro, ri: sec.ri, L: r.L } : { kind: 'box', hy: sec.H / 2, hz: sec.B / 2, t: sec.t, rc: sec.rc, L: r.L };   // hy, hz: half height and half width
  P.A = endOf(spec.A, wall); P.B = endOf(spec.B, wall); P.Aang = spec.A && spec.A.ang; P.Bang = spec.B && spec.B.ang; P.openA = !!opt.openA; P.openB = !!opt.openB;
  for (const k of ['A', 'B']) {
    const E = r[k], S = P[k];
    ok(!!E.bvIn === !!S, name + ': End ' + k + ' bevel is ' + (S ? '' : 'not ') + 'drawn into the file');
    if (S) ok(Math.abs(E.bvC - S.c) < 1e-12 && Math.abs(E.bvW - S.w) < 1e-12, name + ': End ' + k + ' set-back is (wall - land) x tan(angle)', E.bvC + ' vs ' + S.c);
  }
  P.holes = r.holes.filter((h) => h.ok).map((h) => sec.kind === 'round'
    ? { x: h.x, y0: 0, z0: 0, n: [0, Math.cos(rad(h.deg)), Math.sin(rad(h.deg))], dia: h.dia }
    : { x: h.x, y0: 0, z0: 0, n: [0, 1, 0], dia: h.dia });          // square tube holes in this suite: top face, on centre
  let f; const e = await engine();
  try { f = c._solidFile(e, occm, 'igs'); } catch (err) { ok(false, name + ': laser file is written', String(err.message || err).slice(0, 200)); return; }
  ok(true, name + ': laser file is written');
  const wantTag = ['A', 'B'].filter((k) => P[k]).map((k) => k + P[k + 'ang']).join('-');
  ok(f.laser.includes('_BEVELED-' + wantTag.replace(/[^\w.-]+/g, '-')), name + ': file name says BEVELED-' + wantTag, f.laser);
  // kernel facts on the same solid
  const { K, shape } = occm.buildSolid(e, c, r), i = occm.inspect(K, shape);
  ok(i.valid && i.solids === 1 && i.shells === 1, name + ': one valid closed solid', JSON.stringify([i.valid, i.solids, i.shells]));
  if (!opt.openA && !opt.openB) ok(Math.abs(i.bbox[0][0]) < 1e-6 && Math.abs(i.bbox[0][1] - r.L) < 1e-6, name + ': the solid is exactly the length asked for', i.bbox[0].join('..'));
  if (opt.volume) {
    const P0 = sec.kind === 'round' ? 2 * Math.PI * sec.ro : 2 * (sec.H - 2 * sec.rc) + 2 * (sec.B - 2 * sec.rc) + 2 * Math.PI * sec.rc;
    const ri2 = sec.kind === 'box' ? Math.max(0, sec.rc - sec.t) : 0;
    const area = sec.kind === 'round' ? Math.PI * (sec.ro ** 2 - sec.ri ** 2) : (sec.H * sec.B - (4 - Math.PI) * sec.rc ** 2) - ((sec.H - 2 * sec.t) * (sec.B - 2 * sec.t) - (4 - Math.PI) * ri2 ** 2);
    const gone = (E) => E ? E.tan * (P0 * E.w * E.w / 2 - Math.PI * E.w ** 3 / 3) : 0;      // triangle swept round the section
    const want = area * r.L - gone(P.A) - gone(P.B);
    ok(Math.abs(i.volume - want) < 1e-6 * Math.max(1, want), name + ': metal removed by the bevel is exactly the triangle swept round the section', i.volume + ' vs ' + want);
  }
  judge(name, f.text, P, opt.near);
}

// ------------------------------------------------------------------ 1. pipe and round tube
{
  const sizes = quick
    ? [['pipe', '6', '40'], ['pipe', '2', '40'], ['pipe', '14', 'STD'], ['tube', '1.5', '.120']]
    : [['pipe', '1/2', '40'], ['pipe', '2', '40'], ['pipe', '3', '80'], ['pipe', '4', '40'], ['pipe', '6', '40'], ['pipe', '6', '80'], ['pipe', '8', '40'], ['pipe', '10', '40'], ['pipe', '12', 'STD'], ['pipe', '14', 'STD'], ['pipe', '14', 'XS'], ['tube', '1.5', '.120'], ['tube', '2', '.065'], ['tube', '4', '.250']];
  const angs = quick ? [30, 37.5, 45] : [10, 22.5, 30, 37.5, 45], lands = ['0', '1/16', '1/8'];
  let n = 0;
  for (const [fam, a, b] of sizes) for (const ang of angs) {
    const land = lands[n % 3], which = ['A', 'B', 'AB'][n % 3], L = ['12', '48 1/16', '6', "10'-0 3/8"][n % 4]; n++;
    const c = await freshApp({ lenT: L });
    if (fam === 'tube') { c.pickFam('tube')(); c.setState({ lenT: L, todT: a, twallT: b }); } else c.setState({ pnps: a, psch: b });
    const wall = c.calc().sec.ro - c.calc().sec.ri, lv = c.parseIn(land), useLand = lv < wall - .01 ? land : '0';
    const spec = {};
    if (which.includes('A')) { setEnd(c, 'A', { wantBevel: true, bvT: String(ang), landT: useLand }); spec.A = { ang, land: c.parseIn(useLand) }; }
    if (which.includes('B')) { const ang2 = which === 'AB' ? angs[(angs.indexOf(ang) + 1) % angs.length] : ang; setEnd(c, 'B', { wantBevel: true, bvT: String(ang2), landT: useLand }); spec.B = { ang: ang2, land: c.parseIn(useLand) }; }
    await run(fam + ' ' + a + ' ' + b + ' L' + L + ' ' + which + ' ' + ang + '° land ' + useLand, c, spec, { volume: true });
  }
  // with holes, with the other end mitred, with the other end a fish-mouth
  for (const [nm, prep, spec, opt] of [
    ['6 SCH 40, bevel both ends, 1 in holes at 0° and 90°', (c) => { setEnd(c, 'A', { wantBevel: true, bvT: '37.5', landT: '1/16' }); setEnd(c, 'B', { wantBevel: true, bvT: '37.5', landT: '1/16' }); hole(c, { diaT: '1', x0T: '6', azT: '0', aznT: '2', azpT: '90' }); }, { A: { ang: 37.5, land: 1 / 16 }, B: { ang: 37.5, land: 1 / 16 } }, {}],
    ['6 SCH 40, bevel A, hole close to the bevel', (c) => { setEnd(c, 'A', { wantBevel: true, bvT: '45', landT: '0' }); hole(c, { diaT: '1/2', x0T: '3/4', azT: '90' }); }, { A: { ang: 45, land: 0 } }, {}],
    ['6 SCH 40, bevel A, End B mitred 22.5°', (c) => { setEnd(c, 'A', { wantBevel: true, bvT: '37.5', landT: '1/16' }); setEnd(c, 'B', { mode: 'miter', maT: '22.5', mrT: '90' }); }, { A: { ang: 37.5, land: 1 / 16 } }, { openB: true, near: (p) => p[0] < 20 }],
    ['4 SCH 40, bevel B, End A fish-mouth on 8 in', (c) => { c.setState({ pnps: '4' }); setEnd(c, 'A', { mode: 'saddle', sdN: '8', sdS: '40', sdAT: '90' }); setEnd(c, 'B', { wantBevel: true, bvT: '30', landT: '1/16' }); }, { B: { ang: 30, land: 1 / 16 } }, { openA: true, near: (p) => p[0] > 20 }],
  ]) { const c = await freshApp({ lenT: '36' }); prep(c); await run(nm, c, spec, opt); }
}

// ------------------------------------------------------------------ 2. square and rectangular tube
{
  const sizes = quick ? [['4x4', '1/4'], ['6x2', '3/16'], ['2x2', '1/8']] : [['1x1', '1/8'], ['2x2', '1/8'], ['2x2', '1/4'], ['3x3', '3/8'], ['4x2', '3/16'], ['4x4', '1/4'], ['6x4', '3/8'], ['6x2', '3/16'], ['8x8', '1/2'], ['10x10', '5/8'], ['10x6', '1/2']];
  const angs = quick ? [30, 45] : [15, 30, 37.5, 45], lands = ['0', '1/16', '1/8'];
  let n = 0;
  for (const [size, wallT] of sizes) for (const ang of angs) {
    const land = lands[n % 3], which = ['AB', 'A', 'B'][n % 3], L = ['12', '30 3/8', '8'][n % 3]; n++;
    const c = await freshApp(); c.pickFam('hss')(); c.setState({ lenT: L, hsize: size, hwallT: wallT });
    const wall = c.calc().sec.t, lv = c.parseIn(land), useLand = lv < wall - .01 ? land : '0', spec = {};
    if (which.includes('A')) { setEnd(c, 'A', { wantBevel: true, bvT: String(ang), landT: useLand }); spec.A = { ang, land: c.parseIn(useLand) }; }
    if (which.includes('B')) { setEnd(c, 'B', { wantBevel: true, bvT: String(ang), landT: useLand }); spec.B = { ang, land: c.parseIn(useLand) }; }
    await run('tube ' + size + 'x' + wallT + ' L' + L + ' ' + which + ' ' + ang + '° land ' + useLand, c, spec, { volume: true });
  }
  for (const [nm, prep, spec, opt] of [
    ['4x4x1/4, bevel both ends, 3/4 holes in the top', (c) => { setEnd(c, 'A', { wantBevel: true, bvT: '30', landT: '1/16' }); setEnd(c, 'B', { wantBevel: true, bvT: '30', landT: '1/16' }); hole(c, { diaT: '3/4', x0T: '3', nT: '3', pT: '6', face: 'T', offT: '0' }); }, { A: { ang: 30, land: 1 / 16 }, B: { ang: 30, land: 1 / 16 } }, {}],
    ['4x4x1/4, bevel A, End B mitred 45° seen from the side', (c) => { setEnd(c, 'A', { wantBevel: true, bvT: '45', landT: '0' }); setEnd(c, 'B', { mode: 'ang', tvT: '45', tpT: '0' }); }, { A: { ang: 45, land: 0 } }, { openB: true, near: (p) => p[0] < 12 }],
    ['6x4x3/8, bevel B, End A mitred 30° seen from above', (c) => { c.setState({ hsize: '6x4', hwallT: '3/8' }); setEnd(c, 'A', { mode: 'ang', tvT: '0', tpT: '30' }); setEnd(c, 'B', { wantBevel: true, bvT: '37.5', landT: '1/16' }); }, { B: { ang: 37.5, land: 1 / 16 } }, { openA: true, near: (p) => p[0] > 12 }],
  ]) { const c = await freshApp(); c.pickFam('hss')(); c.setState({ lenT: '24', hsize: '4x4', hwallT: '1/4' }); prep(c); await run(nm, c, spec, opt); }
}

// ------------------------------------------------------------------ 3. the rules round it
{
  const c = await freshApp({ lenT: '48', mark: 'P-7', qty: 3 });
  const plain = c.calc();
  setEnd(c, 'A', { wantBevel: true, bvT: '37.5', landT: '1/16' }); setEnd(c, 'B', { wantBevel: true, bvT: '37.5', landT: '1/16' });
  const r = c.calc(), wall = r.sec.ro - r.sec.ri, back = (wall - 1 / 16) * Math.tan(rad(37.5));
  ok(Math.abs(r.OAL - 48) < 1e-12 && Math.abs(plain.OAL - r.OAL) < 1e-12, 'a bevel does not move the long point: 48 in is still 48 in', r.OAL);
  ok(Math.abs(r.A.bvC - back) < 1e-12 && Math.abs(back - 0.16689) < 1e-4, '6 in SCH 40, 37.5° x 1/16 land: outside edge 0.167 in back', r.A.bvC);
  ok(c.laserName(3) === 'P-7_6-SCH-40_A106B_48in_BEVELED-A37.5-B37.5 - QTY 3.igs', 'file name: BEVELED and the angle of each end', c.laserName(3));
  ok(/cut by the laser \(outside edge 0\.167″ back/.test(c.endWords(r.A, r.sec)), 'check card says the laser cuts it and how far back the outside edge is', c.endWords(r.A, r.sec));
  ok(/IN LASER FILE/.test(c.endSpecText(r.A, r.sec)), 'cut list and ticket say IN LASER FILE', c.endSpecText(r.A, r.sec));
  const rv = c.reviewInfo('part'); ok(rv.bevelIn === true && rv.bevelAdd === false, 'check card: bevel is in the file, nothing for the operator to add');

  // a bevel the app cannot draw is never passed off as drawn
  setEnd(c, 'B', { mode: 'miter', maT: '22.5', mrT: '0' });
  const m = c.calc();
  ok(m.A.bvIn && !m.B.bvIn, 'a mitred end keeps its bevel out of the file');
  ok(c.laserName(1) === 'P-7_6-SCH-40_A106B_' + (+m.OAL.toFixed(3)) + 'in_BEVELED-A37.5_ADD-BEVEL-B37.5 - QTY 1.igs', 'file name: BEVELED for the end in the file, ADD-BEVEL for the end the operator adds', c.laserName(1));
  ok(/NOT in the laser file/.test(c.endWords(m.B, m.sec)) && /OPERATOR ADDS/.test(c.endSpecText(m.B, m.sec)), 'check card, cut list and ticket say the operator adds it');
  const rv2 = c.reviewInfo('part'); ok(rv2.bevelIn === true && rv2.bevelAdd === true, 'check card shows both notes');
  setEnd(c, 'B', { mode: 'saddle', sdN: '10', sdS: '40', sdAT: '90' }); ok(!c.calc().B.bvIn, 'a fish-mouth end keeps its bevel out of the file');
  for (const fam of ['beam', 'chan', 'angl']) { const b = await freshApp(); b.pickFam(fam)(); b.setState({ lenT: '60' }); setEnd(b, 'A', { wantBevel: true, bvT: '30', landT: '1/16' }); const q = b.calc(); ok(!b.blocked(q) && !q.A.bvIn && /_ADD-BEVEL-A30$/.test(b.laserBase()), fam + ': bevel stays a callout for the operator (ADD-BEVEL)', b.laserBase() + ' ' + errs(b).join('|')); }
  { const h = await freshApp(); h.pickFam('hss')(); h.setState({ lenT: '24' }); setEnd(h, 'A', { mode: 'ang', tvT: '45', tpT: '0', wantBevel: true, bvT: '30', landT: '1/16' }); ok(!h.calc().A.bvIn && /_ADD-BEVEL-A30$/.test(h.laserBase()), 'square tube: a bevel on a mitred end stays a callout', h.laserBase()); }

  // the mitred-end solid is the same solid with or without the callout bevel
  { const a = await freshApp({ lenT: '24' }); setEnd(a, 'B', { mode: 'miter', maT: '30', mrT: '0' }); const e = await engine();
    const v0 = occm.inspect(...Object.values(occm.buildSolid(e, a, a.calc()))).volume; setEnd(a, 'B', { wantBevel: true, bvT: '30', landT: '1/16' });
    const v1 = occm.inspect(...Object.values(occm.buildSolid(e, a, a.calc()))).volume; ok(Math.abs(v0 - v1) < 1e-9, 'a callout bevel changes nothing in the solid', v0 + ' ' + v1); }

  // red items
  const bad = async (prep, re, name) => { const b = await freshApp({ lenT: '48' }); prep(b); const e2 = errs(b); ok(b.blocked(b.calc()) && e2.some((t) => re.test(t)), name, e2.join(' | ')); };
  await bad((b) => setEnd(b, 'A', { wantBevel: true, bvT: '37.5', landT: '5/16' }), /as thick as the wall/, 'land thicker than the wall is refused');
  await bad((b) => setEnd(b, 'A', { wantBevel: true, bvT: '37.5', landT: '.280' }), /as thick as the wall/, 'land equal to the wall is refused');
  await bad((b) => setEnd(b, 'A', { wantBevel: true, bvT: '46', landT: '1/16' }), /45° maximum/, 'bevel over 45° is refused');
  await bad((b) => { b.setState({ lenT: '1/2' }); setEnd(b, 'A', { wantBevel: true, bvT: '45', landT: '0' }); setEnd(b, 'B', { wantBevel: true, bvT: '45', landT: '0' }); }, /too short for its weld bevels/, 'a piece shorter than its two bevels is refused');
  await bad((b) => { b.pickFam('beam')(); b.setState({ lenT: '60' }); setEnd(b, 'A', { wantBevel: true, bvT: '30', landT: '1', app: 'WEB' }); }, /as thick as the steel/, 'beam: land thicker than the web is refused');
  // a hole that would break into the bevel
  { const b = await freshApp({ lenT: '48' }); hole(b, { diaT: '1/2', x0T: '.45', azT: '0' }); ok(!b.blocked(b.calc()), 'a 1/2 hole .45 from a plain square end is allowed', errs(b).join('|'));
    setEnd(b, 'A', { wantBevel: true, bvT: '37.5', landT: '1/16' }); ok(b.blocked(b.calc()) && errs(b).some((t) => /runs off the end cut/.test(t)), 'the same hole is refused once that end has a bevel drawn on it (it would break into the bevel)', errs(b).join('|')); }
  // the switch: every bevel a callout
  { const b = await freshApp({ lenT: '48', mark: 'X' }); setEnd(b, 'A', { wantBevel: true, bvT: '37.5', landT: '1/16' });
    Component.BEVEL_IN_FILE = false; b._c = null; b.setState({ lenT: '48.0' });
    try { const q = b.calc(); ok(!q.A.bvIn && /_ADD-BEVEL-A37\.5$/.test(b.laserBase()), 'with BEVEL_IN_FILE off every bevel is name-only', b.laserBase()); } finally { Component.BEVEL_IN_FILE = true; } }
  // STEP of a bevelled part, and the second build path
  { const b = await freshApp({ lenT: '12', mark: 'S' }); setEnd(b, 'B', { wantBevel: true, bvT: '37.5', landT: '1/16' }); const e = await engine();
    let st = ''; try { st = b._solidFile(e, occm, 'step').text; } catch (err) { st = 'ERR ' + err.message; } ok(/CONICAL_SURFACE/.test(st) && /INCH/.test(st), 'STEP of a bevelled pipe carries the cone, in inches', st.slice(0, 80));
    const r0 = b.calc(), first = occm.buildSolid(e, b, r0); b._nurbsFirst = true; let second; try { second = occm.buildSolid(e, b, r0); } finally { b._nurbsFirst = undefined; }
    ok(occm.sameEdges(first.K, first.shape, second.shape, 1e-4) && occm.sameEdges(first.K, second.shape, first.shape, 1e-4), 'the fallback build of a bevelled pipe is the same piece'); }
}

// ------------------------------------------------------------------ 4. the judge itself can tell a wrong bevel
{
  const c = await freshApp({ lenT: '12' }); setEnd(c, 'A', { wantBevel: true, bvT: '37.5', landT: '1/16' });
  const r = c.calc(), text = c._solidFile(await engine(), occm, 'igs').text, wall = r.sec.ro - r.sec.ri;
  const caught = (spec, plainText) => { const p0 = pass, f0 = fail, n0 = fails.length; const P = { kind: 'round', ro: r.sec.ro, ri: r.sec.ri, L: r.L, A: endOf(spec, wall), B: null, Aang: spec && spec.ang, holes: [] }; judge('self-test', plainText || text, P); const hit = fail > f0; pass = p0; fail = f0; fails.length = n0; return hit; };
  ok(!caught({ ang: 37.5, land: 1 / 16 }), 'self-test: the file passes against the bevel that was asked for');
  ok(caught({ ang: 37, land: 1 / 16 }), 'self-test: a bevel half a degree off is caught');
  ok(caught({ ang: 37.5, land: 1 / 16 + 1 / 64 }), 'self-test: a land 1/64 off is caught');
  ok(caught(null), 'self-test: a bevelled file is not mistaken for a square end');
  const sq = await freshApp({ lenT: '12' }); const plain = sq._solidFile(await engine(), occm, 'igs').text;
  ok(caught({ ang: 37.5, land: 1 / 16 }, plain), 'self-test: a square-cut file is not mistaken for a bevelled one');
}

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log(fails.join('\n')); process.exit(1); }
