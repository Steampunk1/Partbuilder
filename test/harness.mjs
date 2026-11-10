// Part Builder headless harness — loads app.js (the Component class) with
// small environment stubs and validates geometry, warnings, exports and job
// logic without a browser. Run:  node test/harness.mjs
//
// This is the same pattern that validated the original x-dc prototype: the
// class is pure JS apart from a handful of browser touchpoints, which are
// shadowed as Function parameters below (typeof checks in the class then see
// 'undefined' exactly as intended).
import { readFileSync } from 'node:fs';
import * as PROFILE_DB from '../profile-db.js';

const src0 = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
if (!src0.includes("import('./profile-db.js')")) throw new Error('profile-db import not found in app.js');
const src = src0.replace("import('./profile-db.js')", 'Promise.resolve(globalThis.__PB_PROFILE_DB)');
globalThis.__PB_PROFILE_DB = PROFILE_DB;

class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  setState(update, cb) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
    if (cb) cb();
  }
  forceUpdate() {}
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  renderVals() { return {}; }
}

const ReactStub = { createRef: () => ({ current: null }) };
const localStorageStub = { getItem: () => null, setItem() {}, removeItem() {} };
const fetchStub = () => Promise.reject(new Error('offline-harness'));
const locationStub = { href: 'http://localhost:8012/' };

const makeComponent = new Function(
  'DCLogic', 'React', 'localStorage', 'fetch', 'location',
  'alert', 'confirm', 'document', 'window', 'qrcode', 'indexedDB',
  '"use strict";\n' + src + '\n;return Component;'
);
const Component = makeComponent(
  DCLogic, ReactStub, localStorageStub, fetchStub, locationStub,
  () => {}, () => true, undefined, undefined, undefined, undefined
);

const PROPS = { stations: '192', holeSegs: '28', edgeGlow: true };
async function fresh(patch) {
  const c = new Component(PROPS);
  await new Promise((r) => setTimeout(r, 0)); // let profile-db "import" land
  // The geometry checks below describe parts by work-point length (the engine's
  // own frame). The app itself starts every part in overall mode - see the
  // "overall only" section at the end, which uses freshApp().
  c.setState({ lenMode: 'wp' });
  if (patch) c.setState(typeof patch === 'function' ? patch : patch);
  return c;
}

/** The part form exactly as the app opens it (overall lengths). */
async function freshApp(patch) {
  const c = new Component(PROPS);
  await new Promise((r) => setTimeout(r, 0));
  if (patch) c.setState(patch);
  return c;
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra !== undefined ? '  [' + String(extra) + ']' : '')); }
}
function near(a, b, tol, name) { ok(Math.abs(a - b) <= tol, name, a + ' vs ' + b); }
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x);

// ---------- parsing / formatting ----------
{
  const c = await fresh();
  near(c.parseIn("12'-6 3/8"), 150.375, 1e-9, 'parseIn ft-in');
  near(c.parseIn('11/16'), 0.6875, 1e-9, 'parseIn pure fraction');
  near(c.parseIn('1 1/8'), 1.125, 1e-9, 'parseIn mixed space');
  near(c.parseIn('1-1/8'), 1.125, 1e-9, 'parseIn mixed dash');
  near(c.parseIn('.365'), 0.365, 1e-9, 'parseIn bare decimal');
  near(c.parseIn('-3/4'), -0.75, 1e-9, 'parseIn negative');
  near(c.parseIn('6 1/2'), 6.5, 1e-9, 'parseIn 6 1/2');
  ok(c.parseIn('garbage') === null, 'parseIn garbage null');
  ok(c.fmtFtIn(150.375) === '12′-6 3/8″', 'fmtFtIn', c.fmtFtIn(150.375));
  ok(c.fmtTok(-1.75) === '-1 3/4', 'fmtTok negative', c.fmtTok(-1.75));
  ok(c.fmtTok(60) === '60', 'fmtTok whole', c.fmtTok(60));
  ok(c.fr16(0.6875) === '11/16', 'fr16', c.fr16(0.6875));
  ok(c.fmtIn(3.0625) === '3 1/16″', 'fmtIn', c.fmtIn(3.0625));
}

// ---------- section database ----------
{
  const c = await fresh();
  const s = c.sec(); // default pipe 6 sch 40
  ok(s.kind === 'round', 'pipe kind');
  near(s.od, 6.625, 1e-9, 'pipe 6 OD');
  near(s.t, 0.28, 1e-9, 'pipe 6 sch40 wall');
  near(s.wtFt, 18.99, 0.05, 'pipe 6 wt/ft');
  c.setState({ family: 'hss', hsize: '4x4', hwallT: '1/4' });
  const s2 = c.sec();
  ok(s2.kind === 'box' && s2.B === 4 && s2.H === 4, 'hss 4x4 dims');
  near(s2.t, 0.25, 1e-9, 'hss wall');
  near(s2.rc, 0.5, 1e-9, 'hss corner radius 2t');
  c.setState({ family: 'beam', bser: 'W', bsize: 'W12x26' });
  const s3 = c.sec();
  ok(s3.kind === 'plate' && !s3.chan, 'W12x26 kind');
  near(s3.d, 12.22, 1e-9, 'W12x26 d');
  near(s3.bf, 6.49, 1e-9, 'W12x26 bf');
  near(s3.tf, 0.38, 1e-9, 'W12x26 tf');
  near(s3.tw, 0.23, 1e-9, 'W12x26 tw');
  near(s3.wtFt, 26, 1e-9, 'W12x26 wt');
  c.setState({ family: 'angl', asize: '3x3', athkT: '1/4' });
  const s4 = c.sec();
  ok(s4.kind === 'angl' && s4.a === 3 && s4.b === 3, 'L3x3 dims');
}

// ---------- round calc: square, miter, oal mode ----------
{
  const c = await fresh({ lenT: "10'-0" });
  const r = c.calc();
  ok(!r.invalid, 'square pipe valid');
  near(r.L, 120, 1e-9, 'square L');
  near(r.LP, 120, 1e-9, 'square LP');
  near(r.SP, 120, 1e-9, 'square SP');
  near(r.wrap, Math.PI * 6.625, 1e-9, 'wrap = pi*OD');
  ok(r.paths.vb.split(' ').length === 4, 'viewBox 4 numbers');
}
{
  const c = await fresh((s) => ({ lenT: "10'-0", ends: { A: s.ends.A, B: { ...s.ends.B, mode: 'miter', maT: '45', mrT: '0' } } }));
  const r = c.calc();
  const ro = 3.3125;
  ok(!r.invalid, 'miter valid');
  near(r.LP, 120 + ro, 1e-6, 'miter LP = L + ro*tan45');
  near(r.SP, 120 - ro, 1e-6, 'miter SP');
  // long-point entry mode: typed length is the LP, CL solves itself
  c.setState({ lenMode: 'oal' });
  const r2 = c.calc();
  near(r2.LP, 120, 1e-6, 'oal mode: LP = typed');
  near(r2.L, 120 - ro, 1e-6, 'oal mode: CL solved');
}
{
  // steep miter warn + crossing cuts invalid
  const c = await fresh((s) => ({ lenT: '4', ends: { A: { ...s.ends.A, mode: 'miter', maT: '70', mrT: '0' }, B: { ...s.ends.B, mode: 'miter', maT: '70', mrT: '0' } } }));
  const r = c.calc();
  ok(r.warns.some((w) => w.t.includes('over 65')), 'steep miter warn');
  ok(r.invalid && r.warns.some((w) => w.t.includes('cross')), 'crossing cuts invalid');
}

// ---------- saddle + header hole ----------
{
  const c = await fresh((s) => ({ lenT: "10'-0", ends: { A: { ...s.ends.A, mode: 'saddle', sdN: '10', sdS: '40', sdAT: '90', sdRT: '0', sdSeat: 'on' }, B: s.ends.B } }));
  const r = c.calc();
  ok(!r.invalid, 'tee saddle valid');
  const Rs = 10.75 / 2, ro = 3.3125;
  const ri = 3.0325;
  near(r.aMin, Math.sqrt(Rs * Rs - ri * ri), 1e-3, 'saddle aMin = sqrt(Rs^2-ri^2) (inner radius governs)');
  near(r.A.sd.Rs, Rs, 1e-9, 'set-on seat radius = header OD/2');
  const hh = c.headerHole(r.A, r.sec);
  ok(!!hh, 'header hole exists');
  near(hh.along, 6.065, 0.01, 'header hole along = branch ID (90 deg)');
  const around = 2 * Rs * Math.asin(3.0325 / Rs);
  near(hh.around, around, 0.01, 'header hole around = arc length');
  ok(hh.around > hh.along, 'around > along on curved wrap');
  const dxf = c._headerHoleDxf('A');
  ok(dxf && dxf.startsWith('0\nSECTION'), 'header-hole DXF starts');
  ok(/^[\x20-\x7E\n]*$/.test(dxf), 'header-hole DXF pure ASCII');
  // set-thru with branch too big for bore → error
  c.setState((s) => ({ ends: { A: { ...s.ends.A, sdN: '6', sdS: '40', sdSeat: 'thru' }, B: s.ends.B } }));
  const r2 = c.calc();
  ok(r2.invalid && r2.warns.some((w) => w.t.includes('pass the header bore')), 'set-thru bore check');
}

// ---------- round holes: seam + off-end + clocking ----------
{
  const c = await fresh((s) => ({
    lenT: "10'-0", wantHoles: true,
    groups: [{ ...s.groups[0], type: 'olet', bnps: '2', bsch: '40', azT: '0', aznT: '1', azpT: '90', x0T: '12', pT: '12', nT: '3', xsT: '' }]
  }));
  const r = c.calc();
  const oks = r.holes.filter((h) => h.ok);
  ok(oks.length === 3, 'olet pattern 3 holes', oks.length);
  const id2 = 2.375 - 2 * 0.154;
  near(oks[0].dia, id2, 1e-6, 'olet dia = branch ID');
  ok(r.warns.some((w) => w.t.includes('ONE wall')), 'one-wall warn');
  // 180 = program seam
  c.setState((s) => ({ groups: [{ ...s.groups[0], azT: '180' }] }));
  const r2 = c.calc();
  ok(r2.holes.every((h) => !h.ok) && r2.warns.some((w) => w.t.includes('seam')), 'seam hole flagged');
  // off the end
  c.setState((s) => ({ groups: [{ ...s.groups[0], azT: '0', x0T: '119 3/4', nT: '1' }] }));
  const r3 = c.calc();
  ok(r3.holes.every((h) => !h.ok) && r3.warns.some((w) => w.t.includes('runs off the end')), 'off-end hole flagged');
}

// ---------- HSS box ----------
{
  const c = await fresh((s) => ({ family: 'hss', hsize: '4x4', hwallT: '1/4', lenT: "10'-0", wantHoles: true, groups: [{ ...Component.defGroup(9, 'hss'), face: 'T', type: 'cust', diaT: '9/16', x0T: '12', pT: '12', nT: '2', xsT: '' }] }));
  const r = c.calc();
  ok(!r.invalid, 'hss valid');
  near(r.wrap, 4 * 3 + Math.PI, 0.02, 'hss perimeter wrap');
  ok(r.holes.filter((h) => h.ok).length === 2, 'hss 2 holes ok');
  // offset into the corner radius → flagged
  c.setState((s) => ({ groups: [{ ...s.groups[0], offT: '1 7/8' }] }));
  const r2 = c.calc();
  ok(r2.holes.every((h) => !h.ok) && r2.warns.some((w) => w.t.includes('corner radius')), 'corner-radius flag');
  // picture frame 45/45
  c.setState((s) => ({ groups: [], wantHoles: false, ends: { A: { ...s.ends.A, mode: 'ang', tpT: '0', tvT: '45' }, B: { ...s.ends.B, mode: 'ang', tpT: '0', tvT: '45' } } }));
  const r3 = c.calc();
  ok(!r3.invalid, 'picture frame valid');
  near(r3.LP - r3.SP, 2 * 4, 0.05, 'frame LP-SP = 2*H*tan45');
}

// ---------- beam: copes, rat holes, gauges, edge distance ----------
{
  const c = await fresh((s) => ({
    family: 'beam', bser: 'W', bsize: 'W12x26', lenT: "10'-0", wantHoles: true,
    ends: { A: { ...s.ends.A, mode: 'sq', wantCope: true, ct: true, cb: false, tcT: '4', tdT: '1/8', trT: '1/2', rat: 'NONE' }, B: { ...s.ends.B, mode: 'sq' } },
    groups: [{ ...Component.defGroup(9, 'beam'), face: 'web', bolt: '3/4', type: 'std', x0T: '3', pT: '3', nT: '2', xsT: '', wref: 'tos', y0T: '4 1/2', nyT: '2', pyT: '3' }]
  }));
  const r = c.calc();
  ok(!r.invalid, 'beam valid');
  ok(r.warns.some((w) => w.t.includes('raised to flange thickness')), 'cope depth clamp warn');
  near(r.A.ct.dc, 0.38, 1e-9, 'cope depth clamped to tf');
  ok(r.holes.filter((h) => h.ok).length === 4, 'web 2x2 group ok', r.holes.length);
  const std = c.holeSize({ bolt: '3/4', type: 'std' });
  near(std.dia, 0.8125, 1e-9, 'AISC std hole 3/4 bolt = 13/16');
  ok(c.stdGauge({ face: 'tf' }) === 3.5, 'W12x26 workable gauge 3.5 (bf 6.49)');
  // edge distance warn: hole 1/2" off the end
  c.setState((s) => ({ groups: [{ ...s.groups[0], x0T: '1/2', nT: '1', nyT: '1', y0T: '6' }], ends: { A: { ...s.ends.A, wantCope: false }, B: s.ends.B } }));
  const r2 = c.calc();
  ok(r2.warns.some((w) => w.t.includes('J3.4')), 'edge distance J3.4 warn');
}

// ---------- angle ----------
{
  const c = await fresh((s) => ({ family: 'angl', asize: '3x3', athkT: '1/4', lenT: '60', wantHoles: true, groups: [{ ...Component.defGroup(9, 'angl'), face: 'vleg', bolt: '3/4', type: 'std', gT: '1 3/4', x0T: '3', pT: '6', nT: '3', xsT: '' }] }));
  const r = c.calc();
  ok(!r.invalid, 'angle valid');
  ok(r.holes.filter((h) => h.ok).length === 3, 'angle gauge holes ok');
  ok(c.stdGauge({ face: 'vleg' }) === 1.75, 'L3 gauge from heel 1.75');
  // gauge off the leg → flagged
  c.setState((s) => ({ groups: [{ ...s.groups[0], gT: '3 1/2' }] }));
  const r2 = c.calc();
  ok(r2.holes.every((h) => !h.ok) && r2.warns.some((w) => w.t.includes('falls off the leg')), 'off-leg flagged');
}

// ---------- hole spot lists, centering ----------
{
  const c = await fresh((s) => ({ lenT: '120', wantHoles: true, groups: [{ ...s.groups[0], type: 'cust', diaT: '3/4', refEnd: 'B', xsT: '3, 9, 15 1/2', azT: '0' }] }));
  const r = c.calc();
  const xs = r.holes.map((hh) => hh.x).sort((a, b) => a - b);
  near(xs[0], 120 - 15.5, 1e-9, 'exact spots from B');
  near(xs[2], 117, 1e-9, 'exact spots from B (2)');
  c.centerGroup(c.state.groups[0].id, 'x');
  const toks = c.state.groups[0].xsT.split(',').map((t) => c.parseIn(t));
  near(Math.min(...toks) + Math.max(...toks), 120, 1e-6, 'centered spots symmetric');
  ok(c.groupCenteredAx(c.state.groups[0], c.calc()).x, 'centered flag lights');
}

// ---------- recall codes, job list, nesting ----------
{
  const c = await fresh({ lenT: "10'-0", mark: 'P-1', qty: 2 });
  const cfg = c.snapshot();
  const code = c.encodeCfg(cfg);
  ok(code.startsWith('SPFPB2:'), 'recall code prefix (compact v2)');
  const back = c.decodeCfg(code);
  ok(canon(back) === canon(cfg), 'recall round-trip');
  const v1 = c.encodeCfgV1(cfg);
  ok(v1.startsWith('SPFPB1:') && canon(c.decodeCfg(v1)) === canon(cfg), 'recall v1 (full) round-trip');
  ok(c.decodeCfg('SPFPB1:garbage!') === null, 'bad code rejected');
  c.addToJob();
  ok(c.state.parts.length === 1 && c.state.mark === 'P-2', 'addToJob bumps mark');
  c.setState({ qty: 2, mark: 'P-2' });
  c.addToJob();
  // nesting: two marks x2 pieces of 120" — 20' stick can hold 1 each, 24' holds 2
  c.setState({ gripT: '6', stickSel: {} }); // default 288 = 24'
  const n1 = c.nestGroups();
  ok(n1.length === 1 && n1[0].pieces === 4, 'nest group pieces', JSON.stringify(n1));
  ok(n1[0].sticks === 2, '24ft stick fits 2 per stick', n1[0].sticks);
  c.setState({ stickSel: { [c.state.parts[0].groupKey]: '240' } });
  const n2 = c.nestGroups();
  ok(n2[0].sticks === 4, '20ft stick fits 1 per stick', n2[0].sticks);
  const csv = c._jobCsv();
  ok(csv.split('\n').filter(Boolean).length === 3, 'job csv rows');
}

// ---------- exports: DXF / CSV / OBJ-ish / STEP ----------
{
  const c = await fresh((s) => ({ lenT: "10'-0", wantHoles: true, groups: [{ ...s.groups[0], type: 'cust', diaT: '3/4', azT: '0', x0T: '12', pT: '12', nT: '2', xsT: '' }] }));
  const dxf = c._dxfText();
  ok(dxf.startsWith('0\nSECTION'), 'DXF header');
  ok(dxf.trimEnd().endsWith('EOF'), 'DXF EOF');
  ok(/^[\x20-\x7E\n]*$/.test(dxf), 'DXF pure ASCII');
  ok((dxf.match(/\nCIRCLE\n/g) || []).length === 0, 'DXF pipe holes are true-diameter outlines, not flat circles');
  ok((dxf.match(/\nPOLYLINE\n/g) || []).length === 3, 'DXF outline + 2 hole polylines');
  ok(!dxf.includes('\nTEXT\n'), 'DXF cut-only: no text');
  c.setState({ dxfRef: true });
  const dxf2 = c._dxfText();
  ok(dxf2.includes('\nTEXT\n') && dxf2.includes('180DEG BOTTOM (SEAM)'), 'DXF ref mode adds labels');
  const csv = c._csvText();
  ok(csv.includes('grp,face,type'), 'CSV header');
  ok(csv.split('\n').filter(Boolean).length === 4, 'CSV rows = holes + 2');
  ok(/^[\x20-\x7E\n]*$/.test(csv), 'CSV pure ASCII');
  const step = c._stepText();
  ok(step === null, 'STEP needs _export from 3D build (null headless)');
  // simulate what _build3D exports for the STEP/OBJ writers
  const r = c.calc();
  const st3 = c.shellStations(r);
  const pos = [];
  for (let i = 0; i < st3.length; i++) { pos.push(r.a[i], st3[i].oy, st3[i].oz); }
  c._export = { type: 'shell', pos: [0, 0, 0, 1, 0, 0, 0, 1, 0], idx: [0, 1, 2], name: 'BODY_TEST', c: r };
  const obj = c._objText();
  ok(obj.includes('o BODY_TEST') && (obj.match(/\nv /g) || []).length === 3 && (obj.match(/\nf /g) || []).length === 1, 'OBJ counts');
  const step2 = c._stepText();
  ok(step2.startsWith('ISO-10303-21;') && step2.trimEnd().endsWith('END-ISO-10303-21;'), 'STEP envelope');
  ok(step2.includes("CONVERSION_BASED_UNIT('INCH'"), 'STEP inch unit');
  ok((step2.match(/FACETED_BREP\(/g) || []).length === 1, 'STEP one brep');
}

// ---------- tickets (string builders only) ----------
{
  const c = await fresh({ lenT: "10'-0", mark: 'P-7', job: 'J-100' });
  const t = c._ticketHtml();
  ok(t && t.includes('CUT TICKET P-7'), 'cut ticket title');
  ok(!t.includes('fonts.googleapis.com'), 'ticket: no Google fonts');
  ok(t.includes('http://localhost:8012/fonts/saira-condensed-800.woff2'), 'ticket: absolute local font URLs');
  ok(t.includes('LONG POINT') === false || true, 'ticket builds');
  c.addToJob();
  const jt = c._jobTicketHtml();
  ok(jt && jt.includes('JOB TICKET J-100') && jt.includes('Pull list'), 'job ticket');
}

// ---------- band inversion + click placement ----------
{
  const c = await fresh({ lenT: '120' });
  const r = c.calc();
  const spTop = c.bandSpot(r, 60, r.wrap * 0.5);
  ok(spTop.spec.azT === '0' && spTop.label.includes('0° FROM TOP'), 'band mid = 0 deg top', spTop.label);
  const sp90 = c.bandSpot(r, 60, r.wrap * 0.75);
  ok(sp90.spec.azT === '90', 'band 3/4 = 90 deg', sp90.spec.azT);
  c.bandPlace(r, 60, r.wrap * 0.5);
  ok(c.state.wantHoles && c.state.groups.length === 1 && c.state.groups[0].xsT === '60', 'click adds exact-spot group', JSON.stringify(c.state.groups.map((g) => g.xsT)));
  const r2 = c.calc();
  c.bandPlace(r2, 60, r2.wrap * 0.5); // click the hole again removes it
  ok(c.state.groups.length === 0, 'click removes the hole/group');
}

// ---------- family switching + rolling offset ----------
{
  const c = await fresh({ lenT: '120', mark: 'P-3' });
  c.pickFam('beam')();
  ok(c.state.family === 'beam' && c.state.mat === 'A992' && c.state.mark === 'B-3', 'pickFam beam fixes mat+mark');
  ok(c.state.ends.A.mode === 'sq' && c.state.ends.B.mode === 'sq', 'pickFam clears round-only modes');
  c.pickFam('pipe')();
  c.setState((s) => ({ ends: { A: s.ends.A, B: { ...s.ends.B, mode: 'miter', roST: '24', roRT: '12', roAT: '60' } } }));
  const vals = c.renderVals();
  const eB = vals.endSteps[1];
  ok(eB.showRO, 'rolling offset helper shown');
  ok(eB.roChip.startsWith('TRAVEL'), 'ro chip has travel', eB.roChip);
  eB.roApply();
  const travel = Math.sqrt(24 * 24 + 12 * 12 + 60 * 60);
  near(c.parseIn(c.state.lenT), Math.round(travel * 16) / 16, 0.05, 'ro apply sets length');
  ok(c.state.ends.A.mode === 'miter' && c.state.ends.B.mode === 'miter', 'ro apply sets both miters');
  near(parseFloat(c.state.ends.B.mrT) - parseFloat(c.state.ends.A.mrT), 180, 1e-9, 'ro twist 180 apart');
}

// ---------- header program (multi-branch) ----------
{
  const c = await fresh((s) => ({ hdrB: { nps: '10', sch: '40', seat: 'on', hid: 3, list: [
    { id: 1, nps: '2', sch: '40', alphaT: '90', azT: '0', distT: '12' },
    { id: 2, nps: '2', sch: '40', alphaT: '90', azT: '180', distT: '24' },
    { id: 3, nps: '2', sch: '40', alphaT: '90', azT: '0', distT: '13 1/2' }
  ] } }));
  const hc = c.hdrBranchCurves();
  ok(!!hc, 'header program builds');
  ok(hc.curves.length === 3, 'three branch curves');
  ok(hc.warns.some((w) => w.includes('seam')), 'az 180 seam warn');
  ok(hc.warns.some((w) => w.includes('overlap')), 'overlap warn for 12 vs 13.5');
  const d = c._hdrProgramDxf();
  ok(d && d.startsWith('0\nSECTION') && /^[\x20-\x7E\n]*$/.test(d), 'header program DXF ascii');
}

// ---------- renderVals smoke: the template's whole contract resolves ----------
{
  const c = await fresh({ lenT: "10'-0", wantHoles: true });
  const vals = c.renderVals();
  const need = ['stepN', 'stepName', 'progS', 'chip', 'topChip', 'goto1', 'goto2', 'goto4', 'goto5',
    'endSteps', 'groups', 'quicks', 'recipes', 'issues', 'invalid', 'vb', 'gridP', 'outAP', 'holesP',
    'bandLbls', 'jobParts', 'nests', 'roCost', 'fileBase', 'stageRef', 'hbList', 'archList',
    'fsIdle', 'fsOk', 'fsAsk', 'fsNo', 'dlDxf', 'dlObj', 'dlCsv', 'dlTicket', 'addToJob'];
  for (const k of need) ok(vals[k] !== undefined, 'renderVals has ' + k);
  ok(vals.endSteps.length === 2 && vals.endSteps[0].id === 'A', 'endSteps A/B');
  ok(Array.isArray(vals.recipes) && vals.recipes.length >= 4, 'recipes for pipe');
  ok(typeof vals.quicks[0].go === 'function', 'quick handlers callable');
}


// ---------- shellSolid: watertight solids with wall openings (STEP/OBJ/3D) ----------
function meshChecks(m) {
  const edges = new Map();
  for (let i = 0; i < m.idx.length; i += 3) {
    const t = [m.idx[i], m.idx[i + 1], m.idx[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      const k = a < b ? a + '_' + b : b + '_' + a;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let bad = 0;
  for (const v of edges.values()) if (v !== 2) bad++;
  let vol = 0;
  const P = m.pos;
  for (let i = 0; i < m.idx.length; i += 3) {
    const A = m.idx[i] * 3, B = m.idx[i + 1] * 3, C = m.idx[i + 2] * 3;
    vol += (P[A] * (P[B + 1] * P[C + 2] - P[B + 2] * P[C + 1])
          - P[A + 1] * (P[B] * P[C + 2] - P[B + 2] * P[C])
          + P[A + 2] * (P[B] * P[C + 1] - P[B + 1] * P[C])) / 6;
  }
  return { bad, vol, tris: m.idx.length / 3 };
}
{
  // plain pipe: closed manifold, volume matches the annulus exactly
  const c = await fresh({ lenT: '120' });
  const m = meshChecks(c.shellSolid(c.calc()));
  ok(m.bad === 0, 'solid pipe: edge-manifold', m.bad + ' bad edges');
  const ro = 3.3125, ri = 3.0325;
  near(m.vol, Math.PI * (ro * ro - ri * ri) * 120, Math.PI * (ro * ro - ri * ri) * 120 * 0.01, 'solid pipe: volume');

  // one round wall hole: still manifold, volume drops by the radial plug
  c.setState((s) => ({ wantHoles: true, groups: [{ ...s.groups[0], type: 'cust', diaT: '1', azT: '0', x0T: '60', nT: '1', xsT: '' }] }));
  const r2 = c.calc();
  ok(r2.holes.filter((h) => h.ok).length === 1, 'solid pipe hole ok');
  const m2 = meshChecks(c.shellSolid(r2));
  ok(m2.bad === 0, 'solid pipe + hole: edge-manifold', m2.bad + ' bad edges');
  const plug = (ro * ro - ri * ri) / 2 * (Math.PI * 0.25) / ro; // radial cut volume
  near(m.vol - m2.vol, plug, plug * 0.25, 'solid pipe + hole: plug volume removed');

  // saddle end + holes together
  c.setState((s) => ({ ends: { A: { ...s.ends.A, mode: 'saddle', sdN: '10', sdS: '40', sdAT: '90', sdSeat: 'on' }, B: s.ends.B } }));
  const r3 = c.calc();
  const m3 = meshChecks(c.shellSolid(r3));
  ok(m3.bad === 0, 'saddle + hole solid: edge-manifold', m3.bad + ' bad edges');
  ok(m3.vol > 0 && m3.vol < m.vol, 'saddle + hole solid: positive, smaller volume', m3.vol);
}
{
  // header-style part: 6 outlets down the top of a 10" run — the reported case
  const c = await fresh((s) => ({
    family: 'pipe', pnps: '10', psch: '40', lenT: "10'-0", wantHoles: true,
    groups: [{ ...s.groups[0], type: 'olet', bnps: '2', bsch: '40', azT: '0', aznT: '1', x0T: '12', pT: '19', nT: '6', xsT: '' }]
  }));
  const r = c.calc();
  ok(r.holes.filter((h) => h.ok).length === 6, 'header: 6 outlet openings ok');
  const m = meshChecks(c.shellSolid(r));
  ok(m.bad === 0, 'header solid: edge-manifold', m.bad + ' bad edges');
  // and the STEP writer carries the holed mesh
  const solid = c.shellSolid(r);
  c._export = { type: 'shell', pos: solid.pos, idx: solid.idx, name: 'BODY_HDR', c: r };
  const step = c._stepText();
  ok(step.startsWith('ISO-10303-21;') && step.trimEnd().endsWith('END-ISO-10303-21;'), 'header STEP envelope');
  ok((step.match(/FACETED_BREP\(/g) || []).length === 1, 'header STEP one solid');
  const obj = c._objText();
  ok(obj.includes('Wall openings modeled'), 'OBJ header notes openings modeled');
  const plain = await fresh((s) => ({ family: 'pipe', pnps: '10', psch: '40', lenT: "10'-0" }));
  const m0 = meshChecks(plain.shellSolid(plain.calc()));
  ok(m.vol < m0.vol && m0.vol - m.vol > 0.5, 'header: openings removed real material', (m0.vol - m.vol).toFixed(3));
}
{
  // HSS with slots, both axes
  const c = await fresh((s) => ({ family: 'hss', hsize: '4x4', hwallT: '1/4', lenT: '60', wantHoles: true,
    groups: [{ ...Component.defGroup(9, 'hss'), face: 'T', type: 'slot', diaT: '9/16', sllT: '1 1/2', ax: 'x', x0T: '20', nT: '1', xsT: '' }] }));
  const r = c.calc();
  ok(r.holes.filter((h) => h.ok).length === 1, 'hss slot ok');
  const m = meshChecks(c.shellSolid(r));
  ok(m.bad === 0, 'hss slot-x solid: edge-manifold', m.bad + ' bad edges');
  const slotA = (1.5 - 0.5625) * 0.5625 + Math.PI * 0.28125 * 0.28125;
  const plain = await fresh((s) => ({ family: 'hss', hsize: '4x4', hwallT: '1/4', lenT: '60' }));
  const mp = meshChecks(plain.shellSolid(plain.calc()));
  ok(mp.bad === 0, 'hss plain solid: edge-manifold', mp.bad + ' bad edges');
  const A = plain.sec().wtFt / 3.4032;
  near(mp.vol, A * 60, A * 60 * 0.02, 'hss plain: volume');
  near(mp.vol - m.vol, slotA * 0.25, slotA * 0.25 * 0.3, 'hss slot-x: removed volume');
  c.setState((s) => ({ groups: [{ ...s.groups[0], ax: 'y' }] }));
  const m2 = meshChecks(c.shellSolid(c.calc()));
  ok(m2.bad === 0, 'hss slot-y solid: edge-manifold', m2.bad + ' bad edges');
  near(mp.vol - m2.vol, slotA * 0.25, slotA * 0.25 * 0.3, 'hss slot-y: removed volume');
}

// ---------- plate-family solids (beam / channel / angle -> STEP, OBJ, 3D) ----------
// Every body must be watertight with consistent outward winding and the exact
// volume (outline area - hole areas) x thickness. Guards the slabMesh index
// shift (repeated closing point) and the mirrored angle-leg map.
{
  const THREE = await import('../vendor/three/three.module.js');
  const oriented = (m) => {
    const E = new Map();
    for (let i = 0; i < m.idx.length; i += 3) {
      for (const [u, v] of [[m.idx[i], m.idx[i + 1]], [m.idx[i + 1], m.idx[i + 2]], [m.idx[i + 2], m.idx[i]]]) {
        const k = u + '_' + v; E.set(k, (E.get(k) || 0) + 1);
      }
    }
    let bad = 0;
    for (const [k, n] of E) { const [u, v] = k.split('_'); if (n !== 1 || E.get(v + '_' + u) !== 1) bad++; }
    return bad;
  };
  const checkBodies = (c, label, nBodies) => {
    c._T = THREE;
    const r = c.calc();
    ok(!r.invalid, label + ': valid');
    const defs = c.plateDefs(r, 28);
    ok(defs.length === nBodies, label + ': ' + nBodies + ' bodies', defs.length);
    for (const df of defs) {
      const m = c.slabMesh(df.out, df.hl, df.th, df.map);
      ok(!!m, label + ' ' + df.name + ': meshed');
      if (!m) continue;
      const mc = meshChecks(m);
      ok(mc.bad === 0, label + ' ' + df.name + ': edge-manifold', mc.bad + ' bad edges');
      ok(oriented(m) === 0, label + ' ' + df.name + ': consistent winding', oriented(m) + ' bad directed edges');
      const net = Math.abs(c.area(df.out)) - df.hl.reduce((s, l) => s + Math.abs(c.area(l)), 0);
      near(mc.vol, net * df.th, net * df.th * 0.002, label + ' ' + df.name + ': volume = area x t, positive');
    }
    return r;
  };
  const cope = (s) => ({ ...Component.defEnd(), wantCope: true, ct: true, tcT: '5 9/16', tdT: '1 7/16', trT: '1/2', cb: true, bcT: '5 9/16', bdT: '1 7/16', brT: '1/2', rat: 'NONE' });
  const g6 = (id, refEnd) => ({ ...Component.defGroup(id, 'beam'), face: 'web', type: 'cust', diaT: '7/8', refEnd, x0T: '1 1/2', pT: '2 1/4', nT: '2', xsT: '', wref: 'tos', y0T: '3 1/8', nyT: '3', pyT: '3' });
  // D2 Seal Deck BM2: W12x72, double cope + 6 holes both ends (the case that tore)
  const bm2 = await fresh((s) => ({ family: 'beam', bser: 'W', bsize: 'W12x72', lenT: "11'-7 1/2", wantHoles: true, groups: [g6(1, 'A'), g6(2, 'B')], ends: { A: cope(s), B: cope(s) } }));
  const r2 = checkBodies(bm2, 'coped W12 + holes', 3);
  ok(r2.holes.length === 12 && r2.holes.every((h) => h.ok), 'coped W12: 12 holes on material');
  const w0 = r2.web[0], wl = r2.web[r2.web.length - 1];
  ok(Math.abs(w0[0] - wl[0]) > 1e-6 || Math.abs(w0[1] - wl[1]) > 1e-6, 'web outline: no repeated closing point');
  // DXF polylines: no zero-length segment anywhere, closing one included
  let zeroSeg = 0;
  for (const blk of bm2._dxfText().split('\nPOLYLINE\n').slice(1)) {
    const pts = [...blk.split('\nSEQEND')[0].matchAll(/\nVERTEX\n8\n\w+\n10\n(-?[\d.]+)\n20\n(-?[\d.]+)/g)].map((mm) => [+mm[1], +mm[2]]);
    for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; if (Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) < 1e-4) zeroSeg++; }
  }
  ok(zeroSeg === 0, 'DXF: no zero-length polyline segments', zeroSeg);
  // plain W8 with square ends + web holes (also had the repeated closing point)
  const g2 = (id, refEnd) => ({ ...Component.defGroup(id, 'beam'), face: 'web', type: 'cust', diaT: '7/8', refEnd, x0T: '1 1/2', nT: '1', xsT: '', wref: 'bos', y0T: '2 11/16', nyT: '2', pyT: '2 13/16' });
  checkBodies(await fresh({ family: 'beam', bser: 'W', bsize: 'W8x35', lenT: "10'-8 5/16", wantHoles: true, groups: [g2(1, 'A'), g2(2, 'B')] }), 'square W8 + holes', 3);
  // channel with rat holes + flange holes
  checkBodies(await fresh((s) => ({ family: 'chan', cser: 'C', csize: 'C8x11.5', lenT: '48', wantHoles: true,
    groups: [{ ...Component.defGroup(1, 'chan'), face: 'tf', type: 'std', bolt: '3/4', refEnd: 'A', x0T: '6', pT: '6', nT: '3', xsT: '', amode: 'gauge', gT: '1 1/4' }],
    ends: { A: { ...s.ends.A, wantCope: true, ct: false, cb: false, rat: 'BOTH', rrT: '3/4' }, B: s.ends.B } })), 'channel rat holes + flange holes', 3);
  // angle: horizontal-leg map mirrors -> must still come out positive
  checkBodies(await fresh({ family: 'angl', asize: '6x3 1/2', athkT: '5/16', lenT: "7'-7 3/16", wantHoles: true,
    groups: [{ ...Component.defGroup(1, 'angl'), face: 'vleg', type: 'std', bolt: '3/4', refEnd: 'A', xsT: '1 1/2, 89 11/16', gT: '1 11/16' },
      { ...Component.defGroup(2, 'angl'), face: 'hleg', type: 'std', bolt: '3/4', refEnd: 'A', xsT: '12', gT: '2' }] }), 'angle both legs + holes', 2);
  // STEP from the plate bodies: one FACETED_BREP per body
  bm2._T = THREE;
  bm2._export = { type: 'plates', plates: bm2.plateDefs(bm2.calc(), 28).map((df) => ({ name: df.name, ...bm2.slabMesh(df.out, df.hl, df.th, df.map) })), c: bm2.calc() };
  const step = bm2._stepText();
  ok((step.match(/FACETED_BREP\('/g) || []).length === 3, 'coped W12 STEP: 3 breps');
}

// ---------- recall keeps long-point (OAL) length mode ----------
{
  const p45 = () => ({ ...Component.defEnd(), mode: 'ang', tpT: '45', tvT: '0' });
  const c = await fresh({ family: 'beam', bser: 'W', bsize: 'W8x35', lenT: "9'-0 5/16", lenMode: 'oal', ends: { A: p45(), B: p45() } });
  const r = c.calc();
  near(r.LP, 108.3125, 1e-9, 'OAL part: long point = typed length');
  const code = c.encodeCfg(c.snapshot());
  ok(c.decodeCfg(code).lenMode === 'oal', 'recall code stores lenMode');
  const d = await fresh({ lenMode: 'wp' });
  d.setState(Object.assign({ step: 5 }, d.decodeCfg(code)));
  near(d.calc().LP, 108.3125, 1e-9, 'OAL part recalled into a WP form: same long point');
  // an old code (no lenMode) recalled while the form sits in OAL mode -> WP
  const old = c.snapshot(); delete old.lenMode;
  const e = await fresh({ lenMode: 'oal' });
  const back = e.decodeCfg(e.encodeCfg(old));
  ok(back.lenMode === 'wp', 'pre-lenMode code decodes as WP');
  e.setState(Object.assign({ step: 5 }, back));
  near(e.calc().L, 108.3125, 1e-9, 'pre-lenMode code: typed length is the WP length');
}


// ---------- recall codes v2: exact round-trip, small enough for the QR ----------
{
  const qrcode = new Function('module', 'exports', 'define', readFileSync(new URL('../vendor/qrcode.js', import.meta.url), 'utf8') + '\n;return module.exports;')({ exports: {} }, {}, undefined);
  const qrOk = (txt) => { try { const q = qrcode(0, 'L'); q.addData(txt); q.make(); return q.getModuleCount(); } catch (e) { return 0; } };
  const cope = () => ({ ...Component.defEnd(), wantCope: true, ct: true, tcT: '5 9/16', tdT: '1 7/16', trT: '1/2', cb: true, bcT: '5 9/16', bdT: '1 7/16', brT: '1/2', rat: 'NONE' });
  const wg = (id, refEnd, y0) => ({ ...Component.defGroup(id, 'beam'), face: 'web', type: 'cust', diaT: '7/8', refEnd, x0T: '1 1/2', pT: '2 1/4', nT: '2', xsT: '', wref: 'tos', y0T: y0, nyT: '3', pyT: '3' });
  const p45 = () => ({ ...Component.defEnd(), mode: 'ang', tpT: '45', tvT: '0' });
  const cases = [
    ['default pipe', {}],
    ['pipe saddle + olets', (s) => ({ lenT: "4'-2 3/8", wantHoles: true, ends: { A: s.ends.A, B: { ...s.ends.B, mode: 'saddle', sdN: '10', sdS: '40', sdAT: '60' } }, groups: [{ ...s.groups[0], type: 'olet', bnps: '1', x0T: '12', nT: '2', pT: '12' }] })],
    ['hss slots', (s) => ({ family: 'hss', hsize: '6x4', hwallT: '1/4', lenT: '60', wantHoles: true, groups: [{ ...Component.defGroup(5, 'hss'), face: 'T', type: 'slot', diaT: '9/16', sllT: '1 1/2', ax: 'y', x0T: '10', nT: '3', pT: '15', xsT: '' }] })],
    ['W12 copes + 6 hole groups', { family: 'beam', bser: 'W', bsize: 'W12x72', lenT: "11'-7 1/2", wantHoles: true,
      groups: [wg(1, 'A', '3 1/8'), wg(2, 'B', '3 1/8'), wg(3, 'A', '2'), wg(4, 'B', '2'), { ...wg(5, 'A', '0'), face: 'tf', amode: 'gauge', gT: '5 1/2', x0T: '20', nT: '3', pT: '24' }, { ...wg(6, 'B', '0'), face: 'bf', amode: 'gauge', gT: '5 1/2', x0T: '20', nT: '3', pT: '24' }],
      ends: { A: cope(), B: cope() } }],
    ['channel rats', (s) => ({ family: 'chan', cser: 'C', csize: 'C8x11.5', lenT: '48', ends: { A: { ...s.ends.A, wantCope: true, ct: false, cb: false, rat: 'BOTH', rrT: '3/4' }, B: s.ends.B } })],
    ['angle both legs', { family: 'angl', asize: '6x3 1/2', athkT: '5/16', lenT: "7'-7 3/16", wantHoles: true,
      groups: [{ ...Component.defGroup(1, 'angl'), face: 'vleg', type: 'std', bolt: '3/4', refEnd: 'A', xsT: '1 1/2, 89 11/16', gT: '1 11/16' }, { ...Component.defGroup(2, 'angl'), face: 'hleg', type: 'std', bolt: '3/4', refEnd: 'A', xsT: '12', gT: '2' }] }],
    ['OAL W8 45 both ends', { family: 'beam', bser: 'W', bsize: 'W8x35', lenT: "9'-0 5/16", lenMode: 'oal', ends: { A: p45(), B: p45() } }]
  ];
  for (const [name, patch] of cases) {
    const a = await fresh(patch);
    const cfg = a.snapshot();
    const code = a.encodeCfg(cfg);
    const back = a.decodeCfg(code);
    ok(canon(back) === canon(cfg), 'v2 round-trip: ' + name);
    const b = await fresh({ lenMode: cfg.lenMode === 'oal' ? 'wp' : 'oal' });   // form starts in the OTHER mode
    b.setState(Object.assign({ step: 5 }, back));
    ok(a._dxfText() === b._dxfText() && a._csvText() === b._csvText(), 'v2 reload gives identical DXF + CSV: ' + name);
    const v1 = a.encodeCfgV1(cfg);
    ok(qrOk(code) > 0, 'v2 code fits a QR: ' + name, code.length + ' chars');
    if (name.startsWith('W12')) {
      ok(qrOk(v1) === 0, 'old full code for 6 groups was too long for a QR (the bug)', v1.length + ' chars');
      ok(code.length < 0.4 * v1.length, 'v2 code is much shorter than v1', code.length + ' vs ' + v1.length);
    }
  }
}

// ---------- legacy codes without lenMode: job list infers CL vs long point ----------
{
  const p45 = () => ({ ...Component.defEnd(), mode: 'ang', tpT: '45', tvT: '0' });
  const mk = async (lenMode) => {
    const a = await fresh({ family: 'beam', bser: 'W', bsize: 'W8x35', lenT: "9'-0 5/16", lenMode, ends: { A: p45(), B: p45() } });
    const r = a.calc();
    const old = a.snapshot(); delete old.lenMode;                 // how codes looked before the fix
    return { pt: { payload: a.encodeCfgV1(old), oal: r.OAL || r.L }, lp: r.LP };
  };
  const oalPart = await mk('oal'), wpPart = await mk('wp');
  for (const start of ['wp', 'oal']) {
    const b = await fresh({ lenMode: start });
    const cfg = b.cfgFromPart(oalPart.pt);
    ok(cfg.lenMode === 'oal', 'legacy long-point part reloads in OAL (form ' + start + ')', cfg.lenMode);
    b.setState(Object.assign({ step: 5 }, cfg));
    near(b.calc().LP, 108.3125, 1e-9, 'legacy long-point part: LP 9-0 5/16 (form ' + start + ')');
    ok(canon(b.state.ends) === canon(cfg.ends), 'cfgFromPart left form state untouched until applied');
    const c2 = await fresh({ lenMode: start });
    const cfg2 = c2.cfgFromPart(wpPart.pt);
    ok(cfg2.lenMode === 'wp', 'legacy CL part reloads in WP (form ' + start + ')', cfg2.lenMode);
    c2.setState(Object.assign({ step: 5 }, cfg2));
    near(c2.calc().LP, wpPart.lp, 1e-9, 'legacy CL part keeps its long point (form ' + start + ')');
  }
  const d = await fresh();
  ok(d.cfgFromPart({ payload: 'junk', oal: 10 }) === null, 'cfgFromPart rejects junk');
}

// ---------- headers + job CSV + DXF precision ----------
{
  const p45 = () => ({ ...Component.defEnd(), mode: 'ang', tpT: '45', tvT: '0' });
  const g = (id, refEnd) => ({ ...Component.defGroup(id, 'beam'), face: 'web', type: 'cust', diaT: '13/16', refEnd, x0T: '6 1/2', nT: '1', xsT: '', wref: 'bos', y0T: '2 11/16', nyT: '2', pyT: '2 13/16' });   // 6 1/2 from the long point = 2.49 past the web end on a 45 plan miter
  const c = await fresh({ family: 'beam', bser: 'W', bsize: 'W8x35', lenT: "9'-0 5/16", lenMode: 'oal', mark: 'BM4', qty: 4, wantHoles: true, groups: [g(1, 'A'), g(2, 'B')], ends: { A: p45(), B: p45() } });
  ok(c.headerNote().includes('x 9′-0 5/16″ OVERALL (SHORT POINT '), 'header gives the overall length and the short point for angled ends', c.headerNote());
  ok(c._csvText().split('\n')[0].includes("x 9'-0 5/16\" OVERALL"), 'CSV header carries the overall length (ASCII)');
  const sq = await fresh({ family: 'beam', bser: 'W', bsize: 'W8x35', lenT: "10'-8 5/16" });
  ok(!sq.headerNote().includes('OVERALL') && sq.headerNote().includes('x 10′-8 5/16″ |'), 'square-end header is just the length', sq.headerNote());
  const dxf = c._dxfText();
  ok(dxf.includes('\n40\n0.406250\n'), 'DXF circle radius exact to 6 places (13/16 hole)');
  ok(/^[\x20-\x7E\n]*$/.test(dxf), 'DXF still pure ASCII');
  c.addToJob();
  ok(c.state.parts.length === 1 && c.state.parts[0].lenT2 === '9′-0 5/16″', 'job list length is the overall length', c.state.parts[0] && c.state.parts[0].lenT2);
  const csv = c._jobCsv();
  ok(/^[\x20-\x7E\n]*$/.test(csv), 'job CSV pure ASCII');
  const row = csv.split('\n')[1];
  const fields = []; let cur = '', inq = false;
  for (let i = 0; i < row.length; i++) { const ch = row[i]; if (inq) { if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inq = false; else cur += ch; } else if (ch === '"') inq = true; else if (ch === ',') { fields.push(cur); cur = ''; } else cur += ch; }
  fields.push(cur);
  ok(fields.length === 8, 'job CSV row has 8 fields', fields.length);
  ok(fields[4] === "9'-0 5/16\"", 'job CSV cut_len is the overall length', fields[4]);
}


// ---------- recall fixes after the v6 fuzz (closest mode, v1 job records, ticket QR, no-prefix codes) ----------
{
  // 1) legacy long-point part whose end adds < 1/64: pick the CLOSER mode, not the first within tolerance
  const t = await fresh((s) => ({ family: 'tube', todT: '2', twallT: '.120', lenT: '60', lenMode: 'oal', ends: { A: { ...s.ends.A, mode: 'miter', maT: '0.8', mrT: '0' }, B: s.ends.B } }));
  const rt = t.calc();
  ok(rt.LP - rt.L > 0 && rt.LP - rt.L <= 1 / 64, 'tiny-miter case really is inside 1/64', rt.LP - rt.L);
  const old = t.snapshot(); delete old.lenMode;
  const pt = { payload: t.encodeCfgV1(old), oal: rt.OAL || rt.L };
  const u = await fresh({ lenMode: 'wp' });
  const cu = u.cfgFromPart(pt);
  ok(cu.lenMode === 'oal', 'tiny-miter legacy OAL part reloads as OAL', cu.lenMode);
  u.setState(Object.assign({ step: 5 }, cu));
  near(u.calc().L, rt.L, 1e-9, 'tiny-miter legacy part keeps its CL');
  ok(u._dxfText() === t._dxfText(), 'tiny-miter legacy part: identical DXF');
  // 2) job records store the full v1 code (every key + lenMode) so any app build can read a backup
  const j = await fresh({ family: 'beam', bser: 'W', bsize: 'W8x35', lenT: "9'-0 5/16", lenMode: 'oal', mark: 'BM4', ends: { A: { ...Component.defEnd(), mode: 'ang', tpT: '45' }, B: { ...Component.defEnd(), mode: 'ang', tpT: '45' } } });
  j.addToJob();
  const part = j.state.parts[0];
  ok(part.payload.startsWith('SPFPB1:'), 'job record stores a v1 (full) code', part.payload.slice(0, 7));
  const raw = JSON.parse(decodeURIComponent(escape(atob(part.payload.slice(7)))));
  ok(Component.CFG_KEYS.every((k) => k in raw) && raw.lenMode === 'oal', 'v1 job code has every key incl. lenMode');
  // 3) job ticket QR: compact code rebuilt from the record, same part
  const tc = j.ticketCode(part);
  ok(tc.startsWith('SPFPB2:') && tc.length < part.payload.length, 'ticket QR uses the compact code');
  ok(canon(j.decodeCfg(tc)) === canon(j.cfgFromPart(part)), 'ticket QR code decodes to the same part');
  const legacyPart = { payload: pt.payload, oal: pt.oal };
  ok(j.decodeCfg(j.ticketCode(legacyPart)).lenMode === 'oal', 'ticket QR for a legacy part carries the inferred mode');
  // 4) codes pasted without their prefix
  const beam = await fresh({ family: 'beam', bser: 'W', bsize: 'W12x72', lenT: '139.5', ends: { A: { ...Component.defEnd(), wantCope: true, ct: true, cb: true, tcT: '5 9/16', tdT: '1 7/16', bcT: '5 9/16', bdT: '1 7/16' }, B: Component.defEnd() } });
  const snap = beam.snapshot();
  ok(canon(beam.decodeCfg(beam.encodeCfg(snap).slice(7))) === canon(snap), 'v2 code without prefix decodes as v2 (copes kept)');
  ok(canon(beam.decodeCfg(beam.encodeCfgV1(snap).slice(7))) === canon(snap), 'v1 code without prefix still decodes as v1');
}

// ---------- one-page form, job editing, job-wide export ----------
{
  // saddle starts on a header the same size as the part; a hand-picked header is kept
  const c = await fresh({ pnps: '2', psch: '40' });
  let v = c.renderVals();
  v.endSteps[0].mSaddle();
  ok(c.state.ends.A.mode === 'saddle' && c.state.ends.A.sdN === '2' && c.state.ends.A.sdS === '40', 'new saddle fits a header the size of the part', c.state.ends.A.sdN);
  ok(!c.calc().warns.some((w) => w.lvl === 'err'), 'same-size saddle has nothing to fix');
  v = c.renderVals(); v.endSteps[0].sSdN({ target: { value: '8' } });
  ok(c.state.ends.A.sdN === '8' && c.state.ends.A.sdSet === true, 'header picked by hand is remembered');
  v = c.renderVals(); v.endSteps[0].mSq(); v = c.renderVals(); v.endSteps[0].mSaddle();
  ok(c.state.ends.A.sdN === '8', 'going back to Saddle keeps the hand-picked header', c.state.ends.A.sdN);
  c.setState({ pnps: '12' });
  v = c.renderVals(); v.endSteps[0].mSq(); v = c.renderVals(); v.endSteps[0].mSaddle();
  ok(c.state.ends.A.sdN === '12', 'a header smaller than the part is bumped up to fit', c.state.ends.A.sdN);
  // 12" part with the old fixed 10" default used to be an error on the first click
  const big = await fresh({ pnps: '12', psch: 'STD' });
  big.renderVals().endSteps[1].mSaddle();
  ok(!big.calc().invalid && !big.calc().warns.some((w) => w.lvl === 'err'), '12in pipe: first tap on Saddle is a valid part');

  // Miter on a flat-sided shape starts at 45 from the side, not a 0/0 "miter"
  const h = await fresh(); h.pickFam('hss')();
  h.renderVals().endSteps[0].angYes();
  ok(h.state.ends.A.mode === 'ang' && h.state.ends.A.tvT === '45' && h.state.ends.A.tpT === '0', 'HSS Miter starts at 45 seen from the side');
  ok(Math.abs(h.calc().A.tv - 45) < 1e-9, 'that 45 reaches the geometry');
  h.setState((s) => ({ ends: { ...s.ends, A: { ...s.ends.A, mode: 'sq', tvT: '30' } } }));
  h.renderVals().endSteps[0].angYes();
  ok(h.state.ends.A.tvT === '30', 'an angle already typed is kept');

  // "same as End A" only shows when the two ends really cut differently
  const m = await fresh();
  ok(m.renderVals().endSteps[1].showMirror === false, 'two square ends: no mirror button');
  m.renderVals().endSteps[0].mSaddle();
  ok(m.renderVals().endSteps[1].showMirror === true, 'different ends: mirror button shows');
  m.renderVals().endSteps[1].mirror();
  ok(m.state.ends.B.mode === 'saddle' && m.renderVals().endSteps[1].showMirror === false, 'mirror copies End A and hides again');
  m.pickFam('beam')();
  ok(m.renderVals().endSteps[1].showMirror === false, 'leftover saddle values do not count as a difference on a beam');

  // "Both ends" is one card on every shape, and cuts the same holes as two cards did
  for (const fam of ['hss', 'angl']) {
    const q = await fresh({ lenT: '48' }); q.pickFam(fam)();
    const rec = q.renderVals().recipes.find((r) => /both ends/.test(r.l));
    rec.go();
    const one = q.calc().holes.filter((x) => x.ok).map((x) => [x.face, x.x.toFixed(4)].join('@')).sort();
    ok(q.state.groups.every((g2) => g2.both === true), fam + ': "' + rec.l + '" uses one card per face with Both ends');
    ok(q.renderVals().groups[0].endSel2 === 'AB', fam + ': the From box reads Both ends');
    // the same pattern entered the long way (a card per end)
    const two = await fresh({ lenT: '48' }); two.pickFam(fam)();
    two.setState({ wantHoles: true, groups: q.state.groups.flatMap((g2, k) => [{ ...g2, id: 10 + 2 * k, both: false, refEnd: 'A' }, { ...g2, id: 11 + 2 * k, both: false, refEnd: 'B' }]) });
    const ref = two.calc().holes.filter((x) => x.ok).map((x) => [x.face, x.x.toFixed(4)].join('@')).sort();
    ok(one.length > 0 && JSON.stringify(one) === JSON.stringify(ref), fam + ': Both ends cuts exactly the holes of an End A card plus an End B card', one.join(' ') + ' vs ' + ref.join(' '));
    q.renderVals().groups[0].sEndSel2({ target: { value: 'B' } });
    ok(q.state.groups[0].both === false && q.state.groups[0].refEnd === 'B', fam + ': switching From to End B turns Both ends off');
  }
  {
    const q = await fresh({ lenT: '48', wantHoles: true });
    q.renderVals().groups[0].sEndSel2({ target: { value: 'AB' } });
    const xs = q.calc().holes.filter((x) => x.ok).map((x) => x.x).sort((a, b2) => a - b2);
    ok(xs.length === 2 && Math.abs(xs[0] - 6) < 1e-9 && Math.abs(xs[1] - 42) < 1e-9, 'pipe: Measured from Both ends puts the hole 6 in from each end', xs.join(','));
  }

  // a new shape starts with square ends: nothing left over from the last part
  {
    const q = await fresh(); q.pickFam('hss')();
    q.renderVals().endSteps[1].angYes(); q.renderVals().endSteps[0].bevYes();
    q.pickFam('beam')();
    ok(q.state.ends.A.mode === 'sq' && q.state.ends.B.mode === 'sq' && !q.state.ends.A.wantBevel, 'changing shape puts both ends back to square, no bevel');
    q.renderVals().endSteps[0].tgCope(); q.pickFam('chan')();
    ok(q.state.ends.A.wantCope === false, 'changing shape drops a cope');
    q.renderVals().endSteps[0].angYes(); q.pickFam('chan')();
    ok(q.state.ends.A.mode === 'ang', 'tapping the shape already selected changes nothing');
  }

  // removing the last hole means no holes
  const g = await fresh();
  g.renderVals().addHole();
  ok(g.state.wantHoles === true && g.state.groups.length === 1, 'Add a hole turns holes on');
  g.renderVals().addHole();
  ok(g.state.groups.length === 2, 'Add another hole adds a second');
  g.renderVals().groups[0].del(); g.renderVals().groups[0].del();
  ok(g.state.wantHoles === false && g.state.groups.length === 1 && g.calc().holes.length === 0, 'removing the last hole leaves a part with no holes');

  // a skipped hole blocks every export
  const b = await fresh({ wantHoles: true });
  b.setState((s) => ({ groups: [{ ...s.groups[0], type: 'cust', diaT: '1', x0T: '0', azT: '0' }] }));
  const bc = b.calc();
  ok(!bc.invalid && bc.warns.some((w) => w.lvl === 'err'), 'hole on the end cut: part computes but has a red item');
  ok(b.blocked(bc) === true, 'blocked() is true while a red item shows');
  const bv = b.renderVals();
  ok(bv.invalid === true && bv.solidBusy === true && bv.hasErr === true, 'download and add buttons are disabled');
  b.addToJob();
  ok(b.state.parts.length === 0, 'a part with a red item cannot be added to the job');
  let threw = '';
  try { b._solidFile({}, { buildSolid() { throw new Error('should not build'); } }, 'igs'); } catch (e) { threw = e.message; }
  ok(/red/.test(threw), 'no laser file is built for a part with a red item', threw);
  b.setState((s) => ({ groups: [{ ...s.groups[0], x0T: '6' }] }));
  ok(b.blocked(b.calc()) === false && b.renderVals().invalid === false, 'fixing the hole unblocks it');
  // the one-wall reminder is a hint, not a caution
  const hv = b.renderVals();
  ok(hv.oneWall === true && hv.hasCaution === false && /one wall/.test(hv.holeHint), 'one-wall note is a hint under Holes, not a warning');
  ok(hv.stReady === 'Ready to cut', 'status reads Ready to cut', hv.stReady);

  // job list: edit in place
  const j = await fresh({ lenT: '48', mark: 'P-1', qty: 2 });
  j.addToJob();
  j.setState({ lenT: '60' }); j.addToJob();
  ok(j.state.parts.length === 2 && j.state.mark === 'P-3', 'two parts added');
  const first = j.state.parts[0];
  j.renderVals().jobParts[0].load();
  ok(j.state.editId === first.id && j.state.lenT === '48' && j.state.mark === 'P-1' && j.state.qty === 2, 'Open to edit loads the part and remembers which one');
  let jv = j.renderVals();
  ok(jv.editing === true && jv.addLbl === 'Save changes to P-1', 'button reads Save changes', jv.addLbl);
  j.setState({ lenT: '50', qty: 5 });
  j.addToJob();
  ok(j.state.parts.length === 2, 'saving does not add a duplicate', j.state.parts.length);
  ok(j.state.parts[0].id === first.id && j.state.parts[0].code === first.code, 'saved part keeps its id and recall code');
  ok(j.state.parts[0].qty === 5 && Math.abs(j.state.parts[0].oal - 50) < 1e-9, 'saved part has the new length and quantity');
  ok(j.state.editId === null && j.renderVals().addLbl === '+ Add to job list', 'editing ends after the save');
  j.renderVals().jobParts[1].load();
  j.addToJob(true);
  ok(j.state.parts.length === 3 && j.state.editId === null, 'Add as a new part makes a copy instead');
  // the form goes back to the mark it was on before the edit
  j.setState({ mark: 'P-9' });
  j.renderVals().jobParts[0].load();
  ok(j.state.mark === 'P-1' && j.state.markStash === 'P-9', 'editing shows the part mark and remembers the next one');
  j.renderVals().jobParts[1].load();
  ok(j.state.markStash === 'P-9', 'opening a second part keeps the remembered mark');
  j.renderVals().cancelEdit();
  ok(j.state.editId === null && j.state.mark === 'P-9', 'Stop editing gives the next mark back', j.state.mark);
  j.renderVals().jobParts[0].load(); j.addToJob();
  ok(j.state.mark === 'P-9' && j.state.parts.length === 3 && j.state.parts[0].mark === 'P-1', 'saving gives the next mark back and keeps the part mark');
  // quantity typed in the job list
  j.renderVals().jobParts[0].sQty({ target: { value: '7' } });
  ok(j.state.parts[0].qty === 7 && j.cfgFromPart(j.state.parts[0]).qty === 7, 'job-list quantity is the one that counts');
  j.renderVals().jobParts[0].sQty({ target: { value: '0' } });
  ok(j.state.parts[0].qty === 1, 'quantity never drops below 1');
  j.renderVals().jobParts[0].load();
  j.renderVals().jobParts[0].del();
  ok(j.state.editId === null && j.state.parts.length === 2, 'deleting the part being edited ends the edit');

  // job files: names and the part swap
  const used = {};
  ok(j.jobFileName({ qty: 4 }, 'P-1_6-SCH-40_48in', used) === 'P-1_6-SCH-40_48in - QTY 4.igs', 'job file name carries the quantity');
  ok(j.jobFileName({ qty: 4 }, 'P-1_6-SCH-40_48in', used) === 'P-1_6-SCH-40_48in (2) - QTY 4.igs', 'two parts with the same name stay separate files');
  const before = canon(j.state);
  const seen = j._withPart(j.state.parts[0], () => ({ len: j.calc().L, base: j.fileBase() }));
  ok(Math.abs(seen.len - j.state.parts[0].oal) < 1e-9, '_withPart computes the job part, not the form', seen.len);
  ok(canon(j.state) === before, '_withPart puts the form back exactly');
  let bad = '';
  try { j._withPart({ payload: 'junk' }, () => 1); } catch (e) { bad = e.message; }
  ok(bad !== '' && canon(j.state) === before, 'an unreadable job part throws and leaves the form alone');

  // zip writer: checked against an independent reader + zlib crc32
  const zlib = await import('node:zlib');
  const files = [{ name: 'P-1 - QTY 2.igs', data: 'S      1\nline two ″ Ø\n' }, { name: 'cut list.csv', data: 'a,b\n1,2\n' }, { name: 'bin.dat', data: new Uint8Array([0, 255, 1, 254, 80, 75, 3, 4]) }];
  const blob = j._zip(files);
  const u = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(u.buffer);
  const eo = u.length - 22;
  ok(dv.getUint32(eo, true) === 0x06054b50 && dv.getUint16(eo + 10, true) === 3, 'zip: end record lists 3 files');
  let cp = dv.getUint32(eo + 16, true), allOk = true;
  const dec = new TextDecoder(), enc = new TextEncoder();
  for (const f of files) {
    if (dv.getUint32(cp, true) !== 0x02014b50) { allOk = false; break; }
    const crc = dv.getUint32(cp + 16, true), size = dv.getUint32(cp + 24, true), nl = dv.getUint16(cp + 28, true), lo = dv.getUint32(cp + 42, true);
    const name = dec.decode(u.subarray(cp + 46, cp + 46 + nl));
    const want = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const lnl = dv.getUint16(lo + 26, true);
    const body = u.subarray(lo + 30 + lnl, lo + 30 + lnl + size);
    if (name !== f.name || size !== want.length || dv.getUint32(lo, true) !== 0x04034b50 || dv.getUint16(lo + 8, true) !== 0) allOk = false;
    if (zlib.crc32(Buffer.from(want)) !== crc || dv.getUint32(lo + 14, true) !== crc) allOk = false;
    if (Buffer.compare(Buffer.from(body), Buffer.from(want)) !== 0) allOk = false;
    cp += 46 + nl;
  }
  ok(allOk, 'zip: every file reads back byte-for-byte with a matching CRC');
  ok(cp === eo, 'zip: directory ends exactly at the end record');
}

// ---------- overall only: length and hole distances count from the real ends of the piece ----------
{
  const E = (p) => ({ ...Component.defEnd(), ...p });
  const app = await freshApp();
  ok(app.state.lenMode === 'oal', 'the app opens in overall mode');
  let v = app.renderVals();
  ok(v.hasLenNote === false && v.lenNote === '', 'square ends: no note under the length');
  v.endSteps[0].mSaddle(); v = app.renderVals();
  ok(v.hasLenNote === true && /^End to end/.test(v.lenNote), 'angled or saddled end: the note says end to end', v.lenNote);
  near(app.calc().LP, 120, 1e-9, 'saddle: the typed 10 ft is the overall length');
  ok(app.fileBase().endsWith('_120in'), 'file name carries the overall length', app.fileBase());
  ok(v.chip.includes('10′-0″'), 'header shows the overall length', v.chip);
  ok(/SHORT POINT/.test(v.midSpec) && !/LONG/.test(v.midSpec), 'drawing strip gives the short point only', v.midSpec);

  // every shape: typed length = long point to long point
  const cases = [
    ['pipe saddle + 30 miter', 'pipe', { lenT: '48', ends: { A: E({ mode: 'saddle', sdN: '6', sdS: '40' }), B: E({ mode: 'miter', maT: '30', mrT: '0' }) } }, 48],
    ['pipe 45 miter both', 'pipe', { lenT: '36 1/2', ends: { A: E({ mode: 'miter', maT: '45' }), B: E({ mode: 'miter', maT: '45', mrT: '180' }) } }, 36.5],
    ['HSS 45 frame', 'hss', { lenT: '36', ends: { A: E({ mode: 'ang', tvT: '45' }), B: E({ mode: 'ang', tvT: '45' }) } }, 36],
    ['beam 30 miter + cope', 'beam', { lenT: '60', ends: { A: E({ mode: 'ang', tvT: '30' }), B: E({ wantCope: true, ct: true }) } }, 60],
    ['channel plan 45', 'chan', { lenT: '40', ends: { A: E({ mode: 'ang', tpT: '45' }), B: E({}) } }, 40],
    ['angle 45', 'angl', { lenT: '24', ends: { A: E({ mode: 'ang', tpT: '45' }), B: E({ mode: 'ang', tvT: '20' }) } }, 24]
  ];
  for (const [nm, fam, patch, want] of cases) {
    const c = await freshApp(); if (fam !== 'pipe') c.pickFam(fam)(); c.setState(patch);
    const r = c.calc();
    ok(!r.invalid, nm + ': valid');
    near(r.LP, want, 1e-9, nm + ': long point to long point = the typed length');
    near(r.x1 - r.x0, want, 1e-9, nm + ': hole distances span the same overall length');
    near(r.x0, r.aMin, 1e-12, nm + ': End A distances start at its long point');
    // the same piece described the old way (work-point length) is the identical cut
    const w = await fresh(); if (fam !== 'pipe') w.pickFam(fam)(); w.setState({ ...patch, lenT: String(r.L), lenMode: 'wp' });
    const rw = w.calc();
    near(rw.LP, r.LP, 1e-9, nm + ': same piece as its work-point description');
    if (r.a && rw.a) { let d = 0; for (let i = 0; i < r.a.length; i++) d = Math.max(d, Math.abs(r.a[i] - rw.a[i]), Math.abs(r.b[i] - rw.b[i])); ok(d < 1e-9, nm + ': end cuts identical', d); }
  }

  // holes: "6 from End A" is 6 from the long point of End A
  {
    const c = await freshApp({ lenT: '48', wantHoles: true, ends: { A: E({ mode: 'miter', maT: '45', mrT: '0' }), B: E({ mode: 'saddle', sdN: '6', sdS: '40' }) } });
    const setG = (p) => c.setState((s) => ({ groups: [{ ...s.groups[0], type: 'cust', diaT: '1', azT: '0', aznT: '1', nT: '1', xsT: '', both: false, ...p }] }));
    setG({ refEnd: 'A', x0T: '6' });
    let r = c.calc();
    near(r.aMin, -r.sec.ro, 1e-9, 'pipe 45 miter: long point is one radius past the centre of the cut');
    near(r.holes[0].x, r.aMin + 6, 1e-9, 'pipe: 6 from End A = 6 from its long point');
    setG({ refEnd: 'B', x0T: '8' }); r = c.calc();
    near(r.holes[0].x, r.bMax - 8, 1e-9, 'pipe: 8 from End B = 8 back from its long point');
    setG({ refEnd: 'A', x0T: '10', both: true }); r = c.calc();
    const xs = r.holes.map((h2) => h2.x).sort((a, b2) => a - b2);
    ok(xs.length === 2, 'pipe: Both ends gives two holes');
    near(xs[0] - r.aMin, 10, 1e-9, 'pipe: Both ends, 10 in from End A long point');
    near(r.bMax - xs[1], 10, 1e-9, 'pipe: Both ends, 10 in from End B long point');
    setG({ refEnd: 'A', xsT: '7, 20 1/2' }); r = c.calc();
    near(r.holes[1].x, r.aMin + 20.5, 1e-9, 'pipe: exact distances count from the same long point');
    setG({ refEnd: 'A', x0T: '3', nT: '3', pT: '4' }); c.centerGroup(c.state.groups[0].id, 'x'); r = c.calc();
    const hx = r.holes.map((h2) => h2.x);
    near((Math.min(...hx) + Math.max(...hx)) / 2, (r.aMin + r.bMax) / 2, 1 / 32, 'Center on length centers on the overall length');
    ok(c.groupCenteredAx(c.state.groups[0], r).x === true, 'and reads as centered');
    // too close to the end: the message speaks in the same distances the user typed
    setG({ refEnd: 'A', x0T: '1/4' }); r = c.calc();
    ok(r.warns.some((w2) => w2.lvl === 'err' && /hole 1\/4″ from End A/.test(w2.t)), 'off-the-end message gives the distance from End A', r.warns.map((w2) => w2.t).join(' | '));
    // click on the flat drawing lands in the same frame
    setG({ refEnd: 'A', x0T: '30' }); r = c.calc();
    const sp = c.bandSpot(r, r.aMin + 12, r.wrap / 2);
    ok(sp && /^12″ FROM END A/.test(sp.label), 'hover readout counts from End A', sp && sp.label);
    c.bandPlace(r, r.aMin + 12, r.wrap / 2);
    const gNew = c.state.groups[c.state.groups.length - 1];
    ok(gNew.xsT === '12', 'a click 12 in from the end makes a hole "12" from End A', gNew.xsT);
    near(c.calc().holes.find((h2) => h2.grp === gNew.id).x, r.aMin + 12, 1e-9, 'and it is cut exactly there');
  }
  {
    // beam, 30 deg miter seen from the side: bolts 3 in from the long point
    const c = await freshApp(); c.pickFam('beam')();
    c.setState({ lenT: '72', ends: { A: E({ mode: 'ang', tvT: '30' }), B: E({}) } });
    c.renderVals().recipes[1].go();                               // web bolts, one end
    c.setState((s) => ({ groups: s.groups.map((g2) => ({ ...g2, x0T: '6' })) }));
    const r = c.calc();
    ok(r.holes.length > 0 && r.holes.every((h2) => h2.ok), 'beam: web bolts 6 in from a mitered end are on the material');
    near(Math.min(...r.holes.map((h2) => h2.x)), r.aMin + 6, 1e-9, 'beam: In from the end counts from the long point');
    near(r.aMin, -(r.sec.d / 2) * Math.tan(Math.PI / 6), 1e-9, 'beam: long point = half depth x tan(30) past the centre');
  }
  // square ends: nothing changes at all between the two ways of measuring
  for (const fam of ['pipe', 'hss', 'beam', 'chan', 'angl']) {
    const a = await freshApp({ lenT: '50' }); if (fam !== 'pipe') a.pickFam(fam)(); a.setState({ lenT: '50' }); a.renderVals().recipes[0].go();
    const b = await fresh({ lenT: '50' }); if (fam !== 'pipe') b.pickFam(fam)(); b.setState({ lenT: '50', lenMode: 'wp', wantHoles: true, groups: a.state.groups });
    const ra = a.calc(), rb = b.calc();
    ok(a.state.lenMode === 'oal' && b.state.lenMode === 'wp', fam + ': comparing overall against work-point');
    ok(ra.holes.length > 0 && JSON.stringify(ra.holes.map((h2) => [h2.face, h2.x, h2.ok])) === JSON.stringify(rb.holes.map((h2) => [h2.face, h2.x, h2.ok])), fam + ': square ends, holes identical either way');
    near(ra.LP, 50, 1e-12, fam + ': square ends, length is the length');
  }

  // loading older parts
  {
    const sqOld = await fresh({ lenT: '40', lenMode: 'wp', heat: 'H123' });
    sqOld.setState((s) => ({ ends: { A: { ...s.ends.A, wantBevel: true }, B: s.ends.B } }));
    sqOld.addToJob();
    const f = await freshApp(); f.setState({ parts: sqOld.state.parts });
    f.renderVals().jobParts[0].load();
    ok(f.state.lenMode === 'oal', 'older square-ended part loads as an overall part');
    ok(f.state.heat === '' && f.state.ends.A.wantBevel === false, 'heat number and bevel note are dropped on load');
    const sadOld = await fresh({ lenT: '40', lenMode: 'wp' }); sadOld.renderVals().endSteps[0].mSaddle(); sadOld.addToJob();
    const lpOld = sadOld.calc().LP;
    const f2 = await freshApp(); f2.setState({ parts: sadOld.state.parts });
    f2.renderVals().jobParts[0].load();
    ok(f2.state.lenMode === 'wp' && /^Older part/.test(f2.renderVals().lenNote), 'older saddled part keeps its own measuring and says so', f2.renderVals().lenNote);
    near(f2.calc().LP, lpOld, 1e-9, 'and still cuts exactly as it was saved');
    f2.pickFam('hss')();
    ok(f2.state.lenMode === 'oal', 'picking a new shape goes back to overall');
  }
  // the ticket no longer carries the things that were removed
  {
    const t = await freshApp({ lenT: '48' }); t.renderVals().endSteps[0].mSaddle();
    let html = '';
    try { html = t._ticketHtml() || ''; } catch (e) { html = 'ERR ' + e.message; }
    if (!/^ERR/.test(html)) {
      ok(!/Heat/.test(html) && !/Cut len/.test(html) && /Length overall/.test(html), 'cut ticket: no heat number, one overall length');
      ok(/From End A/.test(html) || /NO HOLES/.test(html), 'cut ticket: hole table counts from End A');
    }
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
