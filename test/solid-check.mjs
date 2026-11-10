// True-solid back-test: every part is built by the OpenCascade kernel, checked
// as a solid, compared point-by-point with the flat DXF geometry, then written
// to IGES + STEP and read back.  Run:  node test/solid-check.mjs
import { loadOcc } from './_occ.mjs';
import { fresh, freshApp, endOf, Component, DB } from './_load.mjs';
import { buildSolid, inspect, writeStep, writeIges, readBack } from '../occ-solid.js';
import { igesTrimCurves, distToPolys } from './_iges.mjs';

var pass = 0, fail = 0; var fails = [];
let oc = await loadOcc();
let cur = '';
process.on('uncaughtException', (e) => { console.log('ENGINE STOPPED during: ' + cur + '  (' + String(e && e.message || e).slice(0, 120) + ')'); console.log(pass + ' checks passed, ' + (fail + 1) + ' failed'); if (fails.length) console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); });
const ok = (c, name, extra) => { if (c) pass++; else { fail++; fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); } };
const near = (a, b, tol, name) => ok(Math.abs(a - b) <= tol, name, (+a).toFixed(4) + ' vs ' + (+b).toFixed(4));
const PI = Math.PI, MM = 25.4;

async function part(name, fam, patch, setup, checks) {
  cur = name;
  try { await part1(name, fam, patch, setup, checks); }
  catch (e) { ok(false, name + ': ran without an engine error', String(e && e.message || e).slice(0, 140)); }
  if (engineDown) { oc = await loadOcc(true); engineDown = false; }       // a kernel abort poisons the instance - start a clean one
}
let engineDown = false;
async function part1(name, fam, patch, setup, checks) {
  const c = await fresh(); if (fam !== 'pipe') c.pickFam(fam)(); c.setState(patch || {}); if (setup) setup(c);
  const r = c.calc(); ok(!r.invalid, name + ': part valid', r.warns.filter(w => w.lvl === 'err').map(w => w.t).join(' / '));
  if (r.invalid) return;
  let K, shape;
  try { ({ K, shape } = buildSolid(oc, c, r)); } catch (e) { engineDown = true; ok(false, name + ': solid builds', String(e.message || e).slice(0, 160)); return; }
  const i = inspect(K, shape);
  ok(i.valid, name + ': kernel says the solid is valid');
  ok(i.solids === 1 && i.shells === 1, name + ': exactly one closed solid', i.solids + ' solids ' + i.shells + ' shells');
  near(i.bbox[0][1] - i.bbox[0][0], r.LP || r.OAL || r.L, .003, name + ': overall length = long point length');
  if (checks) checks({ c, r, K, shape, i, sec: r.sec, inS: (p) => K.inside(shape, p) });
  // files
  let st, ig;
  try { st = writeStep(K, shape, name); ig = writeIges(K, shape, name); } catch (e) { engineDown = true; ok(false, name + ': files write', String(e.message || e).slice(0, 160)); return; }
  ok(/CONVERSION_BASED_UNIT\('INCH'/.test(st) && /LENGTH_MEASURE\(25\.4\)/.test(st) && !/GLOBAL_UNIT_ASSIGNED_CONTEXT\(\(#\d+,[^)]*\)\)[\s\S]*SI_UNIT\(\.MILLI\.,\.METRE\.\)\s*\)\s*;[\s\S]*$/.test(''), name + ': STEP declares inches');
  ok(/MANIFOLD_SOLID_BREP/.test(st) && !/FACETED_BREP/.test(st), name + ': STEP is a true solid, not a mesh');
  const g = ig.split('\n').filter(l => l[72] === 'G').map(l => l.slice(0, 72)).join('');
  ok(/,1,4HINCH,|,1,2HIN,/.test(g), name + ': IGES declares inches', g.slice(60, 200));
  ok((ig.match(/^\s*144\s/gm) || []).length >= i.faces, name + ': IGES holds every face as a trimmed surface', (ig.match(/^\s*144\s/gm) || []).length + ' vs ' + i.faces + ' faces');
  try {
    const rs = inspect(K, readBack(K, st, 'step'));
    ok(rs.valid && rs.solids === 1, name + ': STEP reads back as one valid solid');
    near(rs.volume / MM ** 3, i.volume, i.volume * 1e-4, name + ': STEP reads back at the same volume');
    near((rs.bbox[0][1] - rs.bbox[0][0]) / MM, i.bbox[0][1] - i.bbox[0][0], .002, name + ': STEP reads back at the same length in inches');
    // Every trimming curve stored in the IGES (read with our own parser, not the kernel) and every edge in the
    // STEP must sit on an edge of the true solid, and every true edge must be present in each file.
    const truth = K.edgePoints(shape, 400, true), TOL = 1e-3;
    const worst = (pts, polys) => { let w = 0; for (const q of pts) { const d = distToPolys(q, polys); if (d > w) w = d; } return w; };
    const tc = igesTrimCurves(ig, 200);
    ok(tc.unknownTypes.length === 0, name + ': IGES uses only curve types the checker can read', tc.unknownTypes.join(','));
    ok(!tc.types[104], name + ': IGES has no conic (ellipse) entities', JSON.stringify(tc.types));
    ok(tc.faces === i.faces, name + ': IGES has one trimmed surface per face', tc.faces + ' vs ' + i.faces);
    const igPts = tc.polys.flat().filter((_, k) => k % 5 === 0), truePts = truth.flat().filter((_, k) => k % 10 === 0);
    { const w = worst(igPts, truth); ok(igPts.length > 0 && w <= TOL, name + ': every IGES cut edge lies on a true edge within 0.001"', 'worst ' + w.toFixed(5)); }
    { const w = worst(truePts, tc.polys); ok(w <= 2 * TOL, name + ': no true edge is missing from the IGES', 'worst ' + w.toFixed(5)); }
    { const sp = K.edgePoints(readBack(K, st, 'step'), 200, true).map(g => g.map(q => q.map(v => v / MM)));
      const w1 = worst(sp.flat().filter((_, k) => k % 5 === 0), truth), w2 = worst(truePts, sp);
      ok(w1 <= TOL, name + ': every STEP edge lies on a true edge within 0.001"', 'worst ' + w1.toFixed(5)); ok(w2 <= 2 * TOL, name + ': no true edge is missing from the STEP', 'worst ' + w2.toFixed(5)); }
    const igShape = readBack(K, ig, 'iges');
    const ri = inspect(K, igShape);
    ok(ri.faces === i.faces, name + ': IGES reads back with every face', ri.faces + ' vs ' + i.faces);
    near((ri.bbox[0][1] - ri.bbox[0][0]) / MM, i.bbox[0][1] - i.bbox[0][0], .002, name + ': IGES reads back at the same length in inches');
    near((ri.bbox[1][1] - ri.bbox[1][0]) / MM, i.bbox[1][1] - i.bbox[1][0], .02, name + ': IGES reads back at the same height in inches');
  } catch (e) { engineDown = true; ok(false, name + ': files read back', String(e.message || e).slice(0, 160)); }
}

// ---------- PIPE ----------
for (const [nps, sch] of [['2', '40'], ['6', '40'], ['8', '80'], ['12', 'STD']]) {
  await part('pipe ' + nps + ' sch ' + sch + ' square', 'pipe', { pnps: nps, psch: sch, lenT: '60' }, null, ({ i, sec }) => {
    near(i.volume, PI * (sec.ro ** 2 - sec.ri ** 2) * 60, 1e-6 * 60 * 100, 'pipe ' + nps + ': volume exact');
    ok(i.types.Cylinder === 2 && i.types.Plane === 2 && i.faces === 4, 'pipe ' + nps + ': true cylinder OD + ID and two flat ends', JSON.stringify(i.types));
    near(i.bbox[1][1] - i.bbox[1][0], sec.od, 1e-4, 'pipe ' + nps + ': OD');
  });
}
const endCurveCheck = (nm, { c, r, sec, inS }) => {
  // the OUTER edge of each end must follow the same curve the flat DXF cuts
  const { fA, fB } = c.roundCutFns(sec, r.L, r.A, r.B, []);
  const rho = sec.ro - .01, eps = .004; let bad = 0, n = 0;
  for (let k = 0; k < 72; k++) { const phi = k / 72 * 2 * PI, y = rho * Math.cos(phi), z = rho * Math.sin(phi);
    // a miter is one flat plane, so off the OD it sits at tan x (probe radius); a saddle is radial (same x at every radius)
    const sc = (E) => E.mode === 'miter' ? rho / sec.ro : 1;
    const xa = fA(phi) * sc(r.A), xb = r.B.mode === 'saddle' ? r.L - fB(phi) : r.L + fB(phi) * sc(r.B);
    if (r.A.mode !== 'sq') { n += 2; if (!inS([xa + eps, y, z])) bad++; if (inS([xa - eps, y, z])) bad++; }
    if (r.B.mode !== 'sq') { n += 2; if (!inS([xb - eps, y, z])) bad++; if (inS([xb + eps, y, z])) bad++; } }
  ok(n > 0 && bad === 0, nm + ': outer edge of the end cut matches the flat DXF curve within ' + eps + '"', bad + ' of ' + n + ' probes off');
};
for (const [nps, ang, rot] of [['4', 45, 0], ['6', 22.5, 0], ['6', 30, 90], ['8', 45, 180], ['2', 15, 45]]) {
  const nm = 'pipe ' + nps + ' miter ' + ang + ' rot ' + rot;
  await part(nm, 'pipe', { pnps: nps, psch: '40', lenT: '48' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'sq' }), B: endOf(c, 'B', { mode: 'miter', maT: String(ang), mrT: String(rot) }) } }), (q) => { endCurveCheck(nm, q); ok(q.i.types.Plane === 2 && q.i.types.Cylinder === 2, nm + ': miter is a flat plane on a true cylinder', JSON.stringify(q.i.types)); });
}
{ const nm = 'pipe 6 miter both ends'; await part(nm, 'pipe', { pnps: '6', psch: '40', lenT: '48' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'miter', maT: '45', mrT: '0' }), B: endOf(c, 'B', { mode: 'miter', maT: '45', mrT: '180' }) } }), (q) => endCurveCheck(nm, q)); }
for (const [bn, hn, hs, ang, seat] of [['2', '6', '40', 90, 'on'], ['4', '8', '40', 90, 'on'], ['6', '10', '40', 90, 'on'], ['6', '6', '40', 90, 'on'], ['4', '8', '40', 45, 'on'], ['3', '12', 'STD', 60, 'on'], ['4', '10', '40', 90, 'thru']]) {
  const nm = 'saddle ' + bn + ' on ' + hn + ' @' + ang + ' ' + seat;
  await part(nm, 'pipe', { pnps: bn, psch: '40', lenT: '36' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'saddle', sdN: hn, sdS: hs, sdAT: String(ang), sdRT: '0', sdSeat: seat, sdCust: false }), B: endOf(c, 'B', { mode: 'sq' }) } }), (q) => { endCurveCheck(nm, q); ok(q.i.types.Cylinder === 2, nm + ': OD and ID stay true cylinders', JSON.stringify(q.i.types)); });
}
{ const nm = 'saddle both ends 4 on 8'; await part(nm, 'pipe', { pnps: '4', psch: '40', lenT: '36' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'saddle', sdN: '8', sdS: '40', sdAT: '90' }), B: endOf(c, 'B', { mode: 'saddle', sdN: '8', sdS: '40', sdAT: '90' }) } }), (q) => endCurveCheck(nm, q)); }
for (const [nps, type, extra, deg, x] of [['6', 'cust', { diaT: '1' }, 0, 12], ['6', 'cust', { diaT: '2' }, 90, 20], ['8', 'stub', { bnps: '4' }, 0, 24], ['6', 'stub', { bnps: '4' }, 270, 24], ['8', 'olet', { bnps: '2', bsch: '40' }, 45, 30], ['12', 'olet', { bnps: '6', bsch: '40' }, 0, 30], ['4', 'cust', { diaT: '13/16' }, 135, 6]]) {
  const nm = 'pipe ' + nps + ' hole ' + type + ' ' + JSON.stringify(extra) + ' @' + deg;
  await part(nm, 'pipe', { pnps: nps, psch: '40', lenT: '60' }, c => c.setState({ wantHoles: true, groups: [Object.assign(Component.defGroup(1, 'pipe'), { type, x0T: String(x), nT: '1', azT: String(deg), aznT: '1' }, extra)] }), ({ c, r, sec, inS }) => {
    const h = r.holes[0], wrap = PI * sec.od, rho = sec.ro - .01; let bad = 0, n = 0;
    const loop = c.pipeHolePts(h, 48, false);           // the same outline the flat DXF cuts
    for (const [px, pu] of loop) for (const [k, want] of [[.985, false], [1.015, true]]) {
      const x = h.x + (px - h.x) * k, u = h.u + (pu - h.u) * k, phi = (u / wrap) * 2 * PI - PI;
      n++; if (inS([x, rho * Math.cos(phi), rho * Math.sin(phi)]) !== want) bad++; }
    ok(bad === 0, nm + ': outer edge of the opening matches the flat DXF outline', bad + ' of ' + n + ' probes off');
    const a = h.deg * PI / 180; ok(!inS([h.x, (sec.ro - sec.t / 2) * Math.cos(a), (sec.ro - sec.t / 2) * Math.sin(a)]), nm + ': hole is open at its centre');
    ok(inS([h.x, -(sec.ro - sec.t / 2) * Math.cos(a), -(sec.ro - sec.t / 2) * Math.sin(a)]), nm + ': far wall is left uncut');
  });
}

// ---------- TUBE ----------
for (const size of DB.HSS_SIZES.filter(z => Math.min(...String(z).split(/[xX×]/).map(Number)) >= 2).filter((_, i) => i % 3 === 0).slice(0, 6)) {
  const nm = 'tube ' + size;
  await part(nm, 'hss', { hsize: size, lenT: '72' }, c => c.setState({ wantHoles: true, groups: [Object.assign(Component.defGroup(1, 'hss'), { face: 'T', type: 'cust', diaT: '9/16', x0T: '3', nT: '2', pT: '6', offT: '0' }), Object.assign(Component.defGroup(2, 'hss'), { face: 'R', type: 'slot', diaT: '9/16', sllT: '1 1/2', ax: 'x', x0T: '10', nT: '1', offT: '0' }), Object.assign(Component.defGroup(3, 'hss'), { face: 'L', type: 'cust', diaT: '9/16', x0T: '20', nT: '1', offT: '0' })] }), ({ r, i, sec, inS }) => {
    const { H, B, t, rc } = sec, area = (H * B - (4 - PI) * rc * rc) - ((H - 2 * t) * (B - 2 * t) - (4 - PI) * Math.max(0, rc - t) ** 2);
    const holes = 4 * (PI / 4) * .5625 ** 2 * t + (.9375 * .5625) * t;   // 3 round holes + one slot (two half-rounds + a rectangle)
    near(i.volume, area * 72 - holes, .02, nm + ': volume = section x length minus the openings');
    near(i.bbox[1][1] - i.bbox[1][0], H, 1e-4, nm + ': height'); near(i.bbox[2][1] - i.bbox[2][0], B, 1e-4, nm + ': width');
    const y = H / 2 - t / 2, z = B / 2 - t / 2;
    ok(!inS([3, y, 0]) && !inS([9, y, 0]) && inS([6, y, 0]), nm + ': top holes at 3 and 9');
    ok(inS([3, -y, 0]), nm + ': bottom wall under the top hole is left uncut');
    ok(!inS([10, 0, z]) && !inS([10.7, 0, z]) && inS([10.8, 0, z]) && inS([10, .3, z]), nm + ': slot on the right face is 1 1/2 long x 9/16 wide');
    ok(!inS([20, 0, -z]) && inS([20, 0, z]), nm + ': left-face hole is on the left face only');
  });
}
await part('tube frame miter', 'hss', { lenT: '48' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'ang', tpT: '0', tvT: '45' }), B: endOf(c, 'B', { mode: 'ang', tpT: '0', tvT: '45' }) } }), ({ r, i, sec, inS }) => {
  near(i.bbox[0][1] - i.bbox[0][0] - r.SP, 2 * sec.H, .01, 'tube frame miter: long - short = 2 x height');
  const y = sec.H / 2 - sec.t / 2; ok(inS([-y * 1 + .01, y, 0]) && !inS([-y * 1 - .01, y, 0]), 'tube frame miter: End A face lies on the 45 degree plane');
});
await part('tube one square one miter', 'hss', { lenT: '48' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'sq' }), B: endOf(c, 'B', { mode: 'ang', tpT: '30', tvT: '0' }) } }), ({ i }) => near(i.bbox[0][0], 0, 1e-6, 'tube sq + miter: square end sits at 0'));

// ---------- BEAM / CHANNEL ----------
const pick = (ser, want) => Object.keys(DB[ser]).find(k => k.toLowerCase().replace('×', 'x') === want.toLowerCase());
for (const [fam, ser, want] of [['beam', 'W', 'W8x31'], ['beam', 'W', 'W10x49'], ['beam', 'W', 'W12x26'], ['beam', 'W', 'W16x40'], ['beam', 'W', 'W24x68'], ['chan', 'C', 'C8x11.5'], ['chan', 'C', 'C10x15.3'], ['chan', 'C', 'C12x20.7']]) {
  const key = pick(ser, want), nm = key;
  await part(nm, fam, fam === 'beam' ? { bser: ser, bsize: key, lenT: '96' } : { cser: ser, csize: key, lenT: '96' }, c => { const d = c.calc().sec.d, ny = d >= 12 ? 3 : d >= 8 ? 2 : 1; c.setState({ wantHoles: true, groups: [Object.assign(Component.newGroup(1, fam), { face: 'web', both: true, x0T: '2', nT: '1', nyT: String(ny), pyT: '3' }), Object.assign(Component.newGroup(2, fam), { face: 'tf', bothF: true, both: true, x0T: '2', nT: '2', pT: '3' })] }); }, ({ r, i, sec, inS }) => {
    ok(r.holes.every(h => h.ok), nm + ': every hole is on the material');
    near(i.volume * .2836, r.wt, r.wt * .03, nm + ': solid weighs within 3% of the book weight (fillets included)');
    near(i.bbox[1][1] - i.bbox[1][0], sec.d, 1e-4, nm + ': depth'); near(i.bbox[2][1] - i.bbox[2][0], sec.bf, 1e-4, nm + ': flange width');
    let bad = 0;
    for (const h of r.holes) { const p = h.face === 'web' ? [h.x, h.c, 0] : [h.x, (h.face === 'tf' ? 1 : -1) * (sec.d / 2 - sec.tf / 2), h.c]; const q = p.slice(); q[0] += h.dia / 2 + .03; if (inS(p)) bad++; if (!inS(q)) bad++; }
    ok(bad === 0, nm + ': all ' + r.holes.length + ' bolt holes are open and the right size', bad + ' probes off');
    ok(inS([48, 0, 0]) && inS([48, sec.d / 2 - sec.tf / 2, 0]), nm + ': web and flange are solid at mid-length');
  });
}
await part('beam cope + 30 miter', 'beam', { lenT: '96' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'sq', wantCope: true, ct: true, cb: false, tcT: '4', tdT: '1 1/2', trT: '1/2', rat: 'NONE' }), B: endOf(c, 'B', { mode: 'ang', tpT: '0', tvT: '30', wantCope: false }) } }), ({ sec, inS }) => {
  const yf = sec.d / 2 - sec.tf / 2;
  ok(!inS([2, yf, 1]) && inS([4.2, yf, 1]), 'beam cope: top flange removed for 4 in, present after');
  ok(!inS([2, sec.d / 2 - 1, 0]) && inS([2, sec.d / 2 - 1.7, 0]), 'beam cope: web removed 1 1/2 down, present below');
  ok(inS([2, -yf, 1]), 'beam cope: bottom flange untouched');
});
await part('beam cope both + rat holes', 'beam', { lenT: '96' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'sq', wantCope: true, ct: true, cb: true, tcT: '4', tdT: '1 1/2', trT: '1/2', bcT: '3', bdT: '1 1/4', brT: '1/2', rat: 'BOTH', rrT: '3/4' }), B: endOf(c, 'B', { mode: 'sq', wantCope: true, ct: true, cb: false, tcT: '4', tdT: '1 1/2', trT: '1/2', rat: 'NONE' }) } }));
await part('beam plan miter 45', 'beam', { lenT: '96' }, c => c.setState({ ends: { A: endOf(c, 'A', { mode: 'ang', tpT: '45', tvT: '0' }), B: endOf(c, 'B', { mode: 'sq' }) } }));

// ---------- ANGLE ----------
for (const size of DB.ANGLE_SIZES.filter(z => Math.min(...String(z).split(/[xX×]/).map(Number)) >= 3).filter((_, i) => i % 2 === 0).slice(0, 5)) {
  const nm = 'angle ' + size;
  await part(nm, 'angl', { asize: size, lenT: '48' }, c => { const g = c.stdGaugeFor(c.calc().sec, 'angl', 'vleg') || 1; c.setState({ wantHoles: true, groups: [Object.assign(Component.defGroup(1, 'angl'), { face: 'vleg', both: true, x0T: '1 1/2', nT: '2', pT: '3', gT: String(g) })] }); }, ({ c, r, i, sec, inS }) => {
    const g = c.stdGaugeFor(sec, 'angl', 'vleg') || 1;
    ok(r.holes.length === 4 && r.holes.every(h => h.ok), nm + ': 4 holes on the material');
    near(i.bbox[1][1] - i.bbox[1][0], sec.a, 1e-4, nm + ': vertical leg'); near(i.bbox[2][1] - i.bbox[2][0], sec.b, 1e-4, nm + ': horizontal leg');
    ok(!inS([1.5, g, sec.t / 2]) && !inS([4.5, g, sec.t / 2]) && !inS([43.5, g, sec.t / 2]) && !inS([46.5, g, sec.t / 2]) && inS([3, g, sec.t / 2]), nm + ': holes on the gauge line at 1 1/2 and 4 1/2 from each end');
    near(i.volume * .2836, r.wt, r.wt * .04, nm + ': solid weighs within 4% of book weight');
  });
}

// ---------- OVERALL ONLY: the app's own way of measuring, checked on the solid ----------
try {
  cur = 'overall pipe';
  {
    const c = await freshApp({ pnps: '6', psch: '40', lenT: '48', wantHoles: true });
    c.setState((s) => ({ ends: { A: endOf(c, 'A', { mode: 'miter', maT: '45', mrT: '0' }), B: endOf(c, 'B', { mode: 'sq' }) },
      groups: [Object.assign({}, s.groups[0], { id: 1, type: 'cust', diaT: '1', refEnd: 'A', x0T: '6', azT: '0', aznT: '1', nT: '1', xsT: '' }), Object.assign({}, s.groups[0], { id: 2, type: 'cust', diaT: '1', refEnd: 'B', x0T: '8', azT: '90', aznT: '1', nT: '1', xsT: '' })] }));
    const r = c.calc(), nm = 'overall pipe 45 miter';
    ok(c.state.lenMode === 'oal' && !r.invalid && r.holes.length === 2 && r.holes.every((h) => h.ok), nm + ': valid, both holes on the pipe');
    const { K, shape } = buildSolid(oc, c, r); const i = inspect(K, shape), sec = r.sec, rm = (sec.ro + sec.ri) / 2;
    ok(i.valid && i.solids === 1, nm + ': one valid solid');
    near(i.bbox[0][1] - i.bbox[0][0], 48, .003, nm + ': the solid is the typed 48 in long, tip to end');
    const tip = i.bbox[0][0], endB = i.bbox[0][1], inS = (p) => K.inside(shape, p);
    near(tip, r.aMin, .003, nm + ': the long point of End A is where the app says');
    ok(!inS([tip + 6, rm, 0]) && inS([tip + 6 + .8, rm, 0]) && inS([tip + 6 - .8, rm, 0]), nm + ': hole on top is 6 in from the tip of End A');
    ok(!inS([endB - 8, 0, rm]) && inS([endB - 8 - .8, 0, rm]) && inS([endB - 8 + .8, 0, rm]), nm + ': hole at 90 deg is 8 in back from End B');
    const ig = writeIges(K, shape, 'overall'); const ri = inspect(K, readBack(K, ig, 'iges'));
    near((ri.bbox[0][1] - ri.bbox[0][0]) / MM, 48, .003, nm + ': IGES reads back 48 in long');
  }
  cur = 'overall saddle';
  {
    const c = await freshApp({ pnps: '2', psch: '40', lenT: '30' });
    c.renderVals().endSteps[0].mSaddle(); c.renderVals().endSteps[1].mirror();     // 2 in saddled both ends on 2 in
    const r = c.calc(), nm = 'overall 2in saddle both ends';
    ok(!r.invalid && r.A.mode === 'saddle' && r.B.mode === 'saddle', nm + ': valid');
    const { K, shape } = buildSolid(oc, c, r); const i = inspect(K, shape);
    ok(i.valid && i.solids === 1, nm + ': one valid solid');
    near(i.bbox[0][1] - i.bbox[0][0], 30, .003, nm + ': the solid is the typed 30 in, ear tip to ear tip');
  }
  cur = 'overall hss';
  {
    const c = await freshApp(); c.pickFam('hss')();
    c.setState({ lenT: '36', ends: { A: endOf(c, 'A', { mode: 'ang', tpT: '0', tvT: '45' }), B: endOf(c, 'B', { mode: 'ang', tpT: '0', tvT: '45' }) } });
    c.renderVals().recipes[1].go();                                                // through holes, both ends
    c.setState((s) => ({ groups: s.groups.map((g) => Object.assign({}, g, { x0T: '5' })) }));
    const r = c.calc(), nm = 'overall HSS 45 frame', sec = r.sec;
    ok(!r.invalid && r.holes.length === 4 && r.holes.every((h) => h.ok), nm + ': valid, 4 holes on the tube', r.warns.map((w) => w.t).join(' / '));
    const { K, shape } = buildSolid(oc, c, r); const i = inspect(K, shape), inS = (p) => K.inside(shape, p);
    ok(i.valid && i.solids === 1, nm + ': one valid solid');
    near(i.bbox[0][1] - i.bbox[0][0], 36, .003, nm + ': the solid is the typed 36 in, long point to long point');
    const x0 = i.bbox[0][0], x1 = i.bbox[0][1], zw = sec.B / 2 - sec.t / 2;
    for (const z of [zw, -zw]) ok(!inS([x0 + 5, 0, z]) && inS([x0 + 5.6, 0, z]) && !inS([x1 - 5, 0, z]) && inS([x1 - 5.6, 0, z]), nm + ': side-wall holes are 5 in from each long point (z ' + z.toFixed(2) + ')');
  }
} catch (e) { ok(false, 'overall section ran to the end (' + cur + ')', String(e && e.message || e).slice(0, 200)); if (typeof e === 'number' || /abort|unreachable/i.test(String(e))) oc = await loadOcc(true); }

// ---------- WHOLE JOB: "Download all laser files" ----------
try {
  cur = 'job export';
  const occm = await import('../occ-solid.js');
  const { writeFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const j = await freshApp({ lenT: '48', mark: 'P-1', qty: 3 });   // the form as the app opens it: overall lengths
  j.renderVals().endSteps[0].mSaddle(); j.addToJob();                                   // pipe, same-size saddle
  j.pickFam('hss')(); j.setState({ lenT: '36', qty: 2 }); j.renderVals().endSteps[1].angYes(); j.addToJob();   // HSS, 45 miter
  j.pickFam('beam')(); j.setState({ lenT: '60', qty: 1 }); j.renderVals().recipes[0].go(); j.addToJob();       // beam, web bolts both ends
  j.pickFam('pipe')(); j.setState((s) => ({ lenT: '24', qty: 6, wantHoles: true, groups: [Object.assign({}, s.groups[0], { type: 'cust', diaT: '1', x0T: '6', azT: '0' })] })); j.addToJob();
  // one job part that cannot be exported: its hole sits on the end cut
  j.setState((s) => ({ parts: s.parts.concat([Object.assign({}, s.parts[3], { id: 99, mark: 'BAD-1', payload: j.encodeCfgV1(Object.assign(j.cfgFromPart(s.parts[3]), { groups: [Object.assign({}, j.cfgFromPart(s.parts[3]).groups[0], { x0T: '0' })] })) })]) }));
  ok(j.state.parts.length === 5, 'job export: 5 parts in the job');
  const formBefore = JSON.stringify(j.state);
  j._occ = async () => ({ oc, m: occm });
  let got = null; j._download = (blob, name) => { got = { blob, name }; };
  await j.dlJobFiles();
  ok(!!got && /laser files\.zip$/.test(got.name), 'job export: one zip is handed over', got && got.name);
  ok(JSON.stringify(j.state) === formBefore, 'job export: the form is exactly as it was afterwards');
  if (got) {
    const u = new Uint8Array(await got.blob.arrayBuffer()), dv = new DataView(u.buffer), dec = new TextDecoder();
    const zp = (await import('node:path')).join((await import('node:os')).tmpdir(), 'pb_job_export_check_' + process.pid + '.zip');
    writeFileSync(zp, u);
    let unzipOk = false, listing = '';
    try { listing = execFileSync('unzip', ['-t', zp], { encoding: 'utf8' }); unzipOk = /No errors detected/.test(listing); } catch (e) { listing = String(e.stdout || e.message); }
    ok(unzipOk, 'job export: the system unzip tool tests the zip clean', listing.slice(-160));
    const entries = []; let pz = 0;
    while (pz < u.length - 4 && dv.getUint32(pz, true) === 0x04034b50) { const n = dv.getUint16(pz + 26, true), sz = dv.getUint32(pz + 18, true); entries.push({ name: dec.decode(u.subarray(pz + 30, pz + 30 + n)), text: dec.decode(u.subarray(pz + 30 + n, pz + 30 + n + sz)) }); pz += 30 + n + sz; }
    const names = entries.map((e) => e.name);
    ok(entries.length === 5, 'job export: 4 good parts + the cut list, the bad part left out', names.join(' | '));
    ok(!names.some((n) => /BAD-1/.test(n)), 'job export: the part with a red item is not in the zip');
    ok(names.includes('cut list.csv') && /BAD-1/.test(entries.find((e) => e.name === 'cut list.csv').text), 'job export: cut list is included and still lists every part');
    const K = occm.kit(oc);
    for (let k = 0; k < 4; k++) {
      const pt = j.state.parts[k], e = entries[k], nm = 'job export ' + pt.mark;
      ok(new RegExp('^' + pt.mark + '_.* - QTY ' + pt.qty + '\\.igs$').test(e.name), nm + ': file name has the mark and quantity', e.name);
      const g = e.text.split('\n').filter((l) => l[72] === 'G').map((l) => l.slice(0, 72)).join('');
      ok(/,1,4HINCH,|,1,2HIN,/.test(g), nm + ': IGES declares inches');
      const tc = igesTrimCurves(e.text, 60);
      ok(tc.faces > 3 && tc.unknownTypes.length === 0 && !tc.types[104], nm + ': IGES is trimmed surfaces with readable curves', tc.faces + ' faces');
      try {
        const ri = inspect(K, readBack(K, e.text, 'iges'));
        near((ri.bbox[0][1] - ri.bbox[0][0]) / MM, pt.oal, .003, nm + ': file reads back at the job part\'s overall length');
        // the same part built on its own must give the identical file
        const solo = j._withPart(pt, () => j._solidFile(oc, occm, 'igs'));
        ok(solo.text === e.text, nm + ': identical to that part downloaded on its own');
      } catch (er) { ok(false, nm + ': reads back', String(er.message || er).slice(0, 140)); }
    }
    try { (await import('node:fs')).unlinkSync(zp); } catch (e) { }
  }
} catch (e) { ok(false, 'job export: section ran to the end', String(e && e.message || e).slice(0, 200)); }

console.log(pass + ' checks passed, ' + fail + ' failed');
if (fails.length) console.log('FAILED:\n  ' + fails.join('\n  '));
process.exit(fail ? 1 : 0);
