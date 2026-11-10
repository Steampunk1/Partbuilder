// Export back-test: builds a spread of real parts, writes their DXF / STEP /
// CSV exactly as the app does, then re-reads those files with independent
// parsers and compares them to textbook geometry and published section data.
// Run:  node test/export-check.mjs
import { fresh, endOf, Component, DB } from './_load.mjs';
import { parseDxf, bbox, polyArea, parseStep } from './_geom.mjs';
import { stepOf } from './_export.mjs';

let pass = 0, fail = 0; const fails = [], notes = [];
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); } };
const near = (a, b, tol, name) => ok(Math.abs(a - b) <= tol, name, (+a).toFixed(4) + ' vs ' + (+b).toFixed(4) + ' tol ' + tol);
const PI = Math.PI, rad = d => d * PI / 180;
const STEEL = 0.2836; // lb/in3

// ---------- 1. published section data ----------
{ // ASME B36.10 pipe OD and wall
  const OD = { '1/2': .840, '3/4': 1.050, '1': 1.315, '1 1/4': 1.660, '1 1/2': 1.900, '2': 2.375, '2 1/2': 2.875, '3': 3.500, '4': 4.500, '5': 5.563, '6': 6.625, '8': 8.625, '10': 10.750, '12': 12.750, '14': 14, '16': 16, '18': 18, '20': 20, '24': 24 };
  for (const k of Object.keys(DB.PIPE_OD)) ok(OD[k] !== undefined && Math.abs(DB.PIPE_OD[k] - OD[k]) < 1e-6, 'pipe OD NPS ' + k, DB.PIPE_OD[k] + ' vs ' + OD[k]);
  const W = {
    '40': { '1/2': .109, '3/4': .113, '1': .133, '1 1/4': .140, '1 1/2': .145, '2': .154, '2 1/2': .203, '3': .216, '4': .237, '5': .258, '6': .280, '8': .322, '10': .365, '12': .406, '14': .438, '16': .500, '18': .562, '20': .594, '24': .688 },
    '80': { '1/2': .147, '3/4': .154, '1': .179, '1 1/4': .191, '1 1/2': .200, '2': .218, '2 1/2': .276, '3': .300, '4': .337, '5': .375, '6': .432, '8': .500, '10': .594, '12': .688, '14': .750, '16': .844, '18': .938, '20': 1.031, '24': 1.219 },
    'STD': { '1/2': .109, '3/4': .113, '1': .133, '1 1/4': .140, '1 1/2': .145, '2': .154, '2 1/2': .203, '3': .216, '4': .237, '5': .258, '6': .280, '8': .322, '10': .365, '12': .375, '14': .375, '16': .375, '18': .375, '20': .375, '24': .375 },
    'XS': { '1/2': .147, '3/4': .154, '1': .179, '1 1/4': .191, '1 1/2': .200, '2': .218, '2 1/2': .276, '3': .300, '4': .337, '5': .375, '6': .432, '8': .500, '10': .500, '12': .500, '14': .500, '16': .500, '18': .500, '20': .500, '24': .500 },
    '160': { '1/2': .188, '3/4': .219, '1': .250, '1 1/4': .250, '1 1/2': .281, '2': .344, '2 1/2': .375, '3': .438, '4': .531, '5': .625, '6': .719, '8': .906, '10': 1.125, '12': 1.312, '14': 1.406, '16': 1.594, '18': 1.781, '20': 1.969, '24': 2.344 },
    '10': { '1/2': .083, '3/4': .083, '1': .109, '1 1/4': .109, '1 1/2': .109, '2': .109, '2 1/2': .120, '3': .120, '4': .120, '5': .134, '6': .134, '8': .148, '10': .165, '12': .180, '14': .250, '16': .250, '18': .250, '20': .250, '24': .250 }
  };
  for (const sch of Object.keys(DB.PIPE_WALL)) {
    if (!W[sch]) { notes.push('pipe schedule "' + sch + '" is in the app but not in my reference table - not checked'); continue; }
    for (const k of Object.keys(DB.PIPE_WALL[sch])) { const v = DB.PIPE_WALL[sch][k]; if (v == null) continue; ok(W[sch][k] !== undefined && Math.abs(v - W[sch][k]) < .0015, 'pipe wall ' + k + ' sch ' + sch, v + ' vs ' + W[sch][k]); }
  }
  // AISC shapes: [d, bf, tf, tw]
  const AISC = { W: { 'W8x31': [8.00, 8.00, .435, .285], 'W10x49': [9.98, 10.0, .560, .340], 'W12x26': [12.2, 6.49, .380, .230], 'W14x90': [14.0, 14.5, .710, .440], 'W16x40': [16.0, 7.00, .505, .305], 'W18x50': [18.0, 7.50, .570, .355], 'W24x68': [23.7, 8.97, .585, .415], 'W6x15': [5.99, 5.99, .260, .230], 'W8x18': [8.14, 5.25, .330, .230] },
    C: { 'C6x10.5': [6, 2.03, .343, .314], 'C8x11.5': [8, 2.26, .390, .220], 'C10x15.3': [10, 2.60, .436, .240], 'C12x20.7': [12, 2.94, .501, .282], 'C4x5.4': [4, 1.58, .296, .184] } };
  let seen = 0;
  for (const ser of Object.keys(AISC)) for (const name of Object.keys(AISC[ser])) {
    const tab = DB[ser] || {}; const key = Object.keys(tab).find(k => k.replace(/\s|×/g, m => m === '×' ? 'x' : '').toLowerCase() === name.toLowerCase());
    if (!key) continue; seen++;
    const r = tab[key], e = AISC[ser][name];
    const got = Array.isArray(r) ? r : [r.d, r.bf, r.tf, r.tw];
    for (let i = 0; i < 4; i++) ok(Math.abs(got[i] - e[i]) <= .04, name + ' ' + ['depth', 'flange width', 'flange thk', 'web thk'][i], got[i] + ' vs ' + e[i]);
  }
  notes.push('AISC shapes spot-checked: ' + seen + ' of ' + (Object.keys(AISC.W).length + Object.keys(AISC.C).length) + ' reference sizes were found in the app list');
}

const check = (name, c, fn) => {
  const r = c.calc();
  ok(!r.invalid, name + ': part is valid');
  const dxfT = c._dxfText(), stepT = stepOf(c), csvT = c._csvText();
  const d = parseDxf(dxfT), s = parseStep(stepT);
  ok(d.insunits === 1, name + ': DXF units are inches');
  ok(/^[\x20-\x7E\n]*$/.test(dxfT) && dxfT.trimEnd().endsWith('EOF'), name + ': DXF is clean ASCII and complete');
  ok(d.polys.every(p => p.closed && p.layer === 'CUT') && d.circles.every(q => q.layer === 'CUT'), name + ': every DXF entity is a closed cut loop on CUT layer');
  ok(d.polys.every(p => p.pts.every(q => isFinite(q[0]) && isFinite(q[1]))), name + ': no NaN coordinates in DXF');
  ok(s.inch, name + ': STEP units are inches');
  ok(s.solids.length >= 1 && s.solids.every(o => o.openEdges === 0), name + ': STEP solids are watertight', s.solids.map(o => o.openEdges).join(','));
  ok(s.solids.every(o => o.vol > 0), name + ': STEP solids have positive volume');
  const okHoles = r.holes.filter(h => h.ok).length;
  const csvRows = csvT.split('\n').filter(l => /^\d/.test(l) || /^[0-9]+,/.test(l)).length;
  const dxfHoles = d.circles.length + d.polys.length - (r.kind === 'plate' ? 3 : r.kind === 'angl' ? 2 : 1);
  ok(dxfHoles === okHoles, name + ': DXF hole count matches the part', dxfHoles + ' vs ' + okHoles);
  fn({ r, d, s, csvT, sec: r.sec, vol: s.solids.reduce((a, o) => a + o.vol, 0) });
};
const outline = (d) => d.polys.reduce((a, p) => Math.abs(polyArea(p.pts)) > Math.abs(polyArea(a.pts)) ? p : a);

// ---------- 2. PIPE ----------
const PIPES = [['2', '40'], ['4', '40'], ['6', '40'], ['8', '80'], ['12', 'STD']];
for (const [nps, sch] of PIPES) {
  const c = await fresh({ pnps: nps, psch: sch, lenT: '60' });
  check('pipe ' + nps + ' sch ' + sch + ' square', c, ({ r, d, s, sec, vol }) => {
    const b = bbox(outline(d).pts);
    near(b.w, 60, .002, 'pipe ' + nps + ' square: flat length = 60');
    near(b.h, PI * sec.od, .002, 'pipe ' + nps + ' square: flat height = pi x OD');
    near(vol, PI * (sec.ro ** 2 - sec.ri ** 2) * 60, PI * (sec.ro ** 2 - sec.ri ** 2) * 60 * .004, 'pipe ' + nps + ' square: STEP volume = wall area x length');
    near(s.solids[0].bb[0][1] - s.solids[0].bb[0][0], 60, .002, 'pipe ' + nps + ' square: STEP length');
    near(s.solids[0].bb[1][1] - s.solids[0].bb[1][0], sec.od, .01, 'pipe ' + nps + ' square: STEP OD');
  });
}
// miters: end curve must be x = ro*tan(a)*cos(theta - rot) about the work point
for (const [nps, ang, rot] of [['4', 45, 0], ['6', 22.5, 0], ['6', 30, 90], ['8', 45, 180], ['2', 15, 45]]) {
  const c = await fresh({ pnps: nps, psch: '40', lenT: '48' });
  c.setState({ ends: { A: endOf(c, 'A', { mode: 'sq' }), B: endOf(c, 'B', { mode: 'miter', maT: String(ang), mrT: String(rot) }) } });
  check('pipe ' + nps + ' miter ' + ang + ' rot ' + rot, c, ({ r, d, sec }) => {
    const pts = outline(d).pts.filter(p => p[0] > 24), wrap = PI * sec.od;
    let worst = 0, n = 0;
    for (const [x, u] of pts) { const th = (u / wrap) * 2 * PI - PI; const exp = 48 + sec.ro * Math.tan(rad(ang)) * Math.cos(th - rad(rot)); worst = Math.max(worst, Math.abs(x - exp)); n++; }
    ok(n > 50, 'miter ' + nps + '/' + ang + ': curve has enough points', n);
    near(worst, 0, .003, 'miter ' + nps + '/' + ang + '/rot' + rot + ': every point on the cut matches the true miter curve');
    near(r.LP - r.SP, sec.od * Math.tan(rad(ang)), .003, 'miter ' + nps + '/' + ang + ': long point - short point = OD x tan(angle)');
    near(r.LP, 48 + sec.ro * Math.tan(rad(ang)), .003, 'miter ' + nps + '/' + ang + ': long point length');
  });
}
// saddles: branch ID projected onto the header OD (set-on) or header ID (set-through)
for (const [bn, hn, hs, ang, seat] of [['2', '6', '40', 90, 'on'], ['4', '8', '40', 90, 'on'], ['6', '10', '40', 90, 'on'], ['6', '6', '40', 90, 'on'], ['4', '8', '40', 45, 'on'], ['3', '12', 'STD', 60, 'on'], ['4', '10', '40', 90, 'thru']]) {
  const c = await fresh({ pnps: bn, psch: '40', lenT: '36' });
  c.setState({ ends: { A: endOf(c, 'A', { mode: 'saddle', sdN: hn, sdS: hs, sdAT: String(ang), sdRT: '0', sdSeat: seat, sdCust: false }), B: endOf(c, 'B', { mode: 'sq' }) } });
  check('saddle ' + bn + ' on ' + hn + ' @' + ang + ' ' + seat, c, ({ r, d, sec }) => {
    const hod = DB.PIPE_OD[hn], hw = DB.PIPE_WALL[hs][hn];
    const R = seat === 'on' ? hod / 2 : hod / 2 - hw;
    const pts = outline(d).pts.filter(p => p[0] < 18), wrap = PI * sec.od, al = rad(ang);
    // A square radial cut has one length per angle, so the cut must clear the header across the whole wall:
    // take the longest requirement between the branch ID and OD. At 90 degrees the ID always governs.
    const sAt = (rho, th, sg) => (Math.sqrt(Math.max(0, R * R - (rho * Math.sin(th)) ** 2)) + sg * rho * Math.cos(th) * Math.cos(al)) / Math.sin(al);
    const fitS = (sg) => { let w = 0; for (const [x, u] of pts) { const th = (u / wrap) * 2 * PI - PI; let m = -1e9; for (let k = 0; k <= 60; k++) m = Math.max(m, sAt(sec.ri + (sec.ro - sec.ri) * k / 60, th, sg)); w = Math.max(w, Math.abs(x - m)); } return w; };
    const fitR = (rho) => { let w = 0; for (const [x, u] of pts) { const th = (u / wrap) * 2 * PI - PI; w = Math.max(w, Math.abs(x - sAt(rho, th, 1))); } return w; };
    const eID = Math.min(fitS(1), fitS(-1)), eOD = ang === 90 ? fitR(sec.ro) : 9;
    ok(pts.length > 50, 'saddle ' + bn + 'x' + hn + ': curve has enough points');
    near(Math.min(eID, eOD), 0, .004, 'saddle ' + bn + ' on ' + hn + ' @' + ang + ' ' + seat + ': every point matches the true saddle curve');
    if (!notes.some(n => n.startsWith('Saddle curve'))) notes.push('Saddle curve clears the header across the whole wall (branch ' + (eID <= eOD ? 'ID' : 'OD') + ' governs at 90 deg), max error ' + Math.min(eID, eOD).toFixed(4) + '"');
    if (ang === 90) { const hh = c.headerHole(r.A, sec); const br = seat === 'on' ? sec.ri : sec.ro; if (hh) { near(hh.along, 2 * br, .01, 'header hole ' + bn + ' on ' + hn + ': length along header = branch ' + (seat === 'on' ? 'ID' : 'OD')); near(hh.around, 2 * (hod / 2) * Math.asin(br / (hod / 2)), .01, 'header hole ' + bn + ' on ' + hn + ': distance around header'); } }
  });
}
// wall holes: must measure the stated diameter straight across the pipe
for (const [nps, type, extra, deg, x] of [['6', 'cust', { diaT: '1' }, 0, 12], ['6', 'cust', { diaT: '2' }, 90, 20], ['8', 'stub', { bnps: '4' }, 0, 24], ['6', 'stub', { bnps: '4' }, 270, 24], ['8', 'olet', { bnps: '2', bsch: '40' }, 45, 30], ['12', 'olet', { bnps: '6', bsch: '40' }, 0, 30], ['4', 'cust', { diaT: '13/16' }, 135, 6]]) {
  const c = await fresh({ pnps: nps, psch: '40', lenT: '60' });
  c.setState({ wantHoles: true, groups: [Object.assign(Component.defGroup(1, 'pipe'), { type, x0T: String(x), nT: '1', azT: String(deg), aznT: '1' }, extra)] });
  const nm = 'pipe ' + nps + ' hole ' + type + ' ' + JSON.stringify(extra) + ' @' + deg;
  check(nm, c, ({ r, d, s, sec, vol }) => {
    const want = type === 'cust' ? c.parseIn(extra.diaT) : type === 'stub' ? DB.PIPE_OD[extra.bnps] : DB.PIPE_OD[extra.bnps] - 2 * DB.PIPE_WALL[extra.bsch][extra.bnps];
    const hp = d.polys.filter(p => p !== outline(d)); ok(hp.length === 1 && d.circles.length === 0, nm + ': one hole outline');
    if (!hp.length) return;
    const b = bbox(hp[0].pts), wrap = PI * sec.od;
    near(b.w, want, .002, nm + ': hole length along the pipe = diameter');
    near(b.cx, x, .002, nm + ': hole distance from End A');
    near(b.cy, wrap * (((deg + 180) % 360) / 360), .002, nm + ': hole position around the pipe');
    const rho = type === 'stub' ? sec.ri : sec.ro;
    const across = 2 * rho * Math.sin((b.h / 2) / sec.ro);
    near(across, want, .003, nm + ': hole measures its diameter straight across the pipe (' + (type === 'stub' ? 'at the ID so the branch passes' : 'at the OD') + ')');
    const solid = PI * (sec.ro ** 2 - sec.ri ** 2) * 60;
    ok(vol < solid - .5 * (PI / 4) * want * want * sec.t && vol > solid - 1.6 * (PI / 4) * want * want * sec.t, nm + ': STEP solid has the opening cut out (volume drops by about one hole)', (solid - vol).toFixed(2) + ' vs ' + ((PI / 4) * want * want * sec.t).toFixed(2));
  });
}

// ---------- 3. SQUARE / RECT TUBE ----------
for (const size of DB.HSS_SIZES.filter(z => Math.min(...String(z).split(/[xX×]/).map(Number)) >= 2).filter((_, i) => i % 3 === 0).slice(0, 6)) {
  const c = await fresh(); c.pickFam('hss')(); c.setState({ hsize: size, lenT: '72' });
  c.setState({ wantHoles: true, groups: [Object.assign(Component.defGroup(1, 'hss'), { face: 'T', type: 'cust', diaT: '9/16', x0T: '3', nT: '2', pT: '6', offT: '0' }), Object.assign(Component.defGroup(2, 'hss'), { face: 'R', type: 'slot', diaT: '9/16', sllT: '1 1/2', ax: 'x', x0T: '10', nT: '1', offT: '0' })] });
  check('tube ' + size, c, ({ r, d, s, sec, vol }) => {
    const b = bbox(outline(d).pts), { H, B, t, rc } = sec;
    near(b.w, 72, .002, 'tube ' + size + ': flat length');
    near(b.h, 2 * (H + B) - 8 * rc + 2 * PI * rc, .02, 'tube ' + size + ': flat height = outside perimeter');
    const area = (H * B - (4 - PI) * rc * rc) - ((H - 2 * t) * (B - 2 * t) - (4 - PI) * Math.max(0, rc - t) ** 2);
    near(vol, area * 72, area * 72 * .02, 'tube ' + size + ': STEP volume = section area x length');
    near(s.solids[0].bb[1][1] - s.solids[0].bb[1][0], H, .01, 'tube ' + size + ': STEP height'); near(s.solids[0].bb[2][1] - s.solids[0].bb[2][0], B, .01, 'tube ' + size + ': STEP width');
    ok(d.circles.length === 2 && d.circles.every(q => Math.abs(q.r - .28125) < 1e-4), 'tube ' + size + ': two 9/16 round holes');
    near(Math.min(...d.circles.map(q => q.x)), 3, .001, 'tube ' + size + ': first hole 3 from End A'); near(Math.max(...d.circles.map(q => q.x)), 9, .001, 'tube ' + size + ': second hole 6 further');
    const sl = d.polys.filter(p => p !== outline(d)); ok(sl.length === 1, 'tube ' + size + ': one slot'); if (sl.length) { const sb = bbox(sl[0].pts); near(sb.w, 1.5, .002, 'tube ' + size + ': slot length'); near(sb.h, .5625, .002, 'tube ' + size + ': slot width'); near(sb.cx, 10, .002, 'tube ' + size + ': slot position'); }
  });
}
{ const c = await fresh(); c.pickFam('hss')(); c.setState({ lenT: '48' }); c.setState({ ends: { A: endOf(c, 'A', { mode: 'ang', tpT: '0', tvT: '45' }), B: endOf(c, 'B', { mode: 'ang', tpT: '0', tvT: '45' }) } });
  check('tube 45 frame miter', c, ({ r, sec }) => { near(r.LP - r.SP, 2 * sec.H * Math.tan(rad(45)), .01, 'tube frame miter: long - short = 2 x height x tan(45)'); }); }

// ---------- 4. BEAM / CHANNEL ----------
const faceBands = (d) => d.polys.filter(p => p.pts.length <= 40 && Math.abs(polyArea(p.pts)) > 50).map(p => bbox(p.pts)).sort((a, b) => a.y0 - b.y0);
const pick = (ser, want) => Object.keys(DB[ser]).find(k => k.toLowerCase().replace('×', 'x') === want.toLowerCase());
const PL = [['beam', 'W', 'W8x31'], ['beam', 'W', 'W10x49'], ['beam', 'W', 'W12x26'], ['beam', 'W', 'W16x40'], ['beam', 'W', 'W24x68'], ['chan', 'C', 'C8x11.5'], ['chan', 'C', 'C10x15.3'], ['chan', 'C', 'C12x20.7']].filter(q => pick(q[1], q[2]));
ok(PL.length === 8, 'all 8 reference beam/channel sizes exist in the app', PL.length);
for (const [fam, ser, want] of PL) {
  const key = pick(ser, want);
  const c = await fresh(); c.pickFam(fam)(); c.setState(fam === 'beam' ? { bser: ser, bsize: key, lenT: '96' } : { cser: ser, csize: key, lenT: '96' });
  const sec0 = c.calc().sec, ny = sec0.d >= 12 ? 3 : sec0.d >= 8 ? 2 : 1;
  c.setState({ wantHoles: true, groups: [Object.assign(Component.newGroup(1, fam), { face: 'web', both: true, x0T: '2', nT: '1', nyT: String(ny), pyT: '3' }), Object.assign(Component.newGroup(2, fam), { face: 'tf', bothF: true, both: true, x0T: '2', nT: '2', pT: '3' })] });
  const nm = key;
  check(nm, c, ({ r, d, s, sec, vol }) => {
    const bands = faceBands(d); ok(bands.length === 3, nm + ': three face outlines (bottom flange, web, top flange)', bands.length);
    if (bands.length !== 3) return;
    const [bf, web, tf] = bands;
    for (const b of bands) near(b.w, 96, .002, nm + ': face length = 96');
    near(tf.h, sec.bf, .005, nm + ': flange outline = flange width'); near(web.h, sec.d - 2 * sec.tf, .01, nm + ': web outline = clear depth between flanges');
    const inBand = (b) => d.circles.filter(q => q.y > b.y0 && q.y < b.y1);
    const wh = inBand(web), th = inBand(tf), bh = inBand(bf), okN = r.holes.filter(h => h.ok).length;
    ok(wh.length + th.length + bh.length === okN, nm + ': every good hole is drawn inside a face', (wh.length + th.length + bh.length) + ' vs ' + okN);
    ok(d.circles.every(q => Math.abs(q.r - .40625) < 1e-4), nm + ': 3/4 bolt holes are 13/16 diameter');
    const xs = [...new Set(wh.map(q => q.x.toFixed(3)))].map(Number).sort((a, b) => a - b);
    ok(xs.length === 2 && Math.abs(xs[0] - 2) < .001 && Math.abs(xs[1] - 94) < .001, nm + ': web bolts 2 in from each end', xs.join(','));
    const ys = [...new Set(wh.map(q => q.y.toFixed(3)))].map(Number).sort((a, b) => a - b);
    ok(ys.length === ny, nm + ': ' + ny + ' bolt rows down the web', ys.length);
    near((ys[0] + ys[ys.length - 1]) / 2, web.cy, .002, nm + ': web bolts centered on the depth');
    for (let i = 1; i < ys.length; i++) near(ys[i] - ys[i - 1], 3, .002, nm + ': web rows 3 apart');
    ok(th.length === bh.length, nm + ': both flanges carry the same holes', th.length + ' vs ' + bh.length);
    const fx = [...new Set(th.map(q => q.x.toFixed(3)))].map(Number).sort((a, b) => a - b);
    ok(fx.length === 4 && Math.abs(fx[0] - 2) < .001 && Math.abs(fx[1] - 5) < .001 && Math.abs(fx[2] - 91) < .001 && Math.abs(fx[3] - 94) < .001, nm + ': flange bolts at 2 and 5 from each end', fx.join(','));
    const fy = [...new Set(th.map(q => q.y.toFixed(3)))].map(Number).sort((a, b) => a - b);
    const g = c.stdGaugeFor(sec, fam, 'tf');
    if (fam === 'beam' && g != null) { ok(fy.length === 2, nm + ': two flange hole lines'); near(fy[1] - fy[0], g, .002, nm + ': flange gauge = standard ' + g); near((fy[0] + fy[1]) / 2, tf.cy, .002, nm + ': flange lines centered on the flange'); ok(g + .8125 + 2 * .75 <= sec.bf + .51, nm + ': standard gauge leaves edge distance on the flange', 'gauge ' + g + ' bf ' + sec.bf); }
    if (fam === 'chan' && g != null) { ok(fy.length === 1, nm + ': one flange hole line'); ok(g > .40625 + sec.tw && g < sec.bf - .40625, nm + ': channel flange line sits on the flange, clear of the web', 'gauge ' + g + ' bf ' + sec.bf + ' tw ' + sec.tw); }
    const names = s.solids.map(o => o.name).join(','); ok(s.solids.length === 3, nm + ': STEP holds web + 2 flanges', names);
    const holeVol = wh.length * (PI / 4) * .8125 ** 2 * sec.tw + (th.length + bh.length) * (PI / 4) * .8125 ** 2 * sec.tf;
    const plate = (fam === 'beam' ? 2 * sec.bf * sec.tf + (sec.d - 2 * sec.tf) * sec.tw : 2 * sec.bf * sec.tf + (sec.d - 2 * sec.tf) * sec.tw) * 96;
    near(vol, plate - holeVol, plate * .03, nm + ': STEP volume = plates minus holes');
    const X = s.solids.map(o => o.bb[0][1] - o.bb[0][0]); ok(X.every(v => Math.abs(v - 96) < .002), nm + ': STEP length 96');
    const dY = Math.max(...s.solids.map(o => o.bb[1][1])) - Math.min(...s.solids.map(o => o.bb[1][0])); near(dY, sec.d, .01, nm + ': STEP depth');
    near(r.wt, sec.wtFt * 8, sec.wtFt * 8 * .001, nm + ': weight = lb/ft x length');
    near(vol * STEEL, r.wt, r.wt * .12, nm + ': STEP steel weight within 12% of book weight (model has no fillets)');
  });
}
{ // cope + miter on a beam
  const c = await fresh(); c.pickFam('beam')(); c.setState({ lenT: '96' });
  c.setState({ ends: { A: endOf(c, 'A', { mode: 'sq', wantCope: true, ct: true, cb: false, tcT: '4', tdT: '1 1/2', trT: '1/2', rat: 'NONE' }), B: endOf(c, 'B', { mode: 'ang', tpT: '0', tvT: '30', wantCope: false }) } });
  check('beam cope + 30 miter', c, ({ r, d, sec }) => {
    const bands = d.polys.map(p => bbox(p.pts)).sort((a, b) => a.y0 - b.y0); const tf = bands[bands.length - 1];
    near(tf.x0, 4, .01, 'beam cope: top flange starts 4 in from End A (cope length)');
    near(r.LP - r.SP, sec.d * Math.tan(rad(30)), .02, 'beam 30 miter: long - short = depth x tan(30)');
  });
}

// ---------- 5. ANGLE ----------
for (const size of DB.ANGLE_SIZES.filter(z => Math.min(...String(z).split(/[xX×]/).map(Number)) >= 3).filter((_, i) => i % 2 === 0).slice(0, 5)) {
  const c = await fresh(); c.pickFam('angl')(); c.setState({ asize: size, lenT: '48' });
  const sec0 = c.calc().sec, g = c.stdGaugeFor(sec0, 'angl', 'vleg') || 1;
  c.setState({ wantHoles: true, groups: [Object.assign(Component.defGroup(1, 'angl'), { face: 'vleg', both: true, x0T: '1 1/2', nT: '2', pT: '3', gT: String(g) })] });
  check('angle ' + size, c, ({ r, d, s, sec, vol }) => {
    const b = d.polys.map(p => bbox(p.pts)); ok(b.length === 2 && b.every(q => Math.abs(q.w - 48) < .002), 'angle ' + size + ': two leg outlines, 48 long');
    ok(d.circles.length === 4, 'angle ' + size + ': 4 holes', d.circles.length);
    const xs = d.circles.map(q => q.x).sort((a, b) => a - b); ok(Math.abs(xs[0] - 1.5) < .001 && Math.abs(xs[1] - 4.5) < .001 && Math.abs(xs[2] - 43.5) < .001 && Math.abs(xs[3] - 46.5) < .001, 'angle ' + size + ': holes 1 1/2 and 4 1/2 from each end', xs.join(','));
    const leg = b.find(q => d.circles.every(k => k.y > q.y0 && k.y < q.y1)); ok(!!leg, 'angle ' + size + ': holes sit inside one leg');
    if (leg && d.circles.length) ok(Math.abs(Math.abs(d.circles[0].y - leg.y0) - g) < .002 || Math.abs(Math.abs(leg.y1 - d.circles[0].y) - g) < .002, 'angle ' + size + ': holes on the gauge line ' + g + ' from the heel', (d.circles[0].y - leg.y0).toFixed(3) + ' / ' + (leg.y1 - d.circles[0].y).toFixed(3));
    const area = (sec.a + sec.b - sec.t) * sec.t; near(vol, area * 48 - 4 * (PI / 4) * .8125 ** 2 * sec.t, area * 48 * .01, 'angle ' + size + ': STEP volume = legs minus holes');
  });
}

console.log(pass + ' checks passed, ' + fail + ' failed');
if (fails.length) console.log('FAILED:\n  ' + fails.join('\n  '));
if (notes.length) console.log('NOTES:\n  ' + notes.join('\n  '));
process.exit(fail ? 1 : 0);
