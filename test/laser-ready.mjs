// Laser-ready checks: nothing typed is ever silently replaced, the bevel stops
// at the laser's 45 degrees, laser file names say what the operator needs, and
// a save into the linked laser folder lands where the app says it did.
// Run:  node test/laser-ready.mjs
import { loadOcc } from './_occ.mjs';
import { freshApp, Component, LASER_AS_SHIPPED } from './_load.mjs';
import { readBack, inspect, kit } from '../occ-solid.js';

let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); } };
const errs = (c) => c.calc().warns.filter((w) => w.lvl === 'err').map((w) => w.t);
const end = (c, id, p) => ({ ends: { ...c.state.ends, [id]: { ...c.state.ends[id], ...p } } });
const grp = (c, p) => ({ wantHoles: true, groups: [{ ...c.state.groups[0], ...p }] });

// ---------- 1. every typed box either reads or blocks ----------
{
  const clean = await freshApp({ lenT: '48' });
  ok(!clean.blocked(clean.calc()) && errs(clean).length === 0, 'a fresh part has nothing to fix', errs(clean).join(' | '));

  // [label, state patch builder, text the red item must contain]
  const cases = [
    ['tube OD typo', (c) => ({ family: 'tube', todT: '2x', twallT: '.120' }), 'Tube OD'],
    ['tube wall blank', (c) => ({ family: 'tube', todT: '2', twallT: '' }), 'Tube wall is blank'],
    ['tube wall thicker than the tube', (c) => ({ family: 'tube', todT: '2', twallT: '1' }), 'too thick'],
    ['miter angle blank', (c) => end(c, 'A', { mode: 'miter', maT: '' }), 'miter angle is blank'],
    ['miter angle with junk', (c) => end(c, 'A', { mode: 'miter', maT: '22-1/2' }), 'can’t read'],
    ['miter past 75', (c) => end(c, 'B', { mode: 'miter', maT: '80' }), '75° limit'],
    ['saddle angle out of range', (c) => end(c, 'A', { mode: 'saddle', sdAT: '10' }), '20° to 90°'],
    ['saddle roll junk', (c) => end(c, 'A', { mode: 'saddle', sdRT: 'x' }), 'saddle roll'],
    ['custom header wall blank', (c) => end(c, 'A', { mode: 'saddle', sdHT: 'cust', sdHodT: '10.75', sdHwT: '' }), 'header wall is blank'],
    ['bevel 60', (c) => end(c, 'A', { wantBevel: true, bvT: '60' }), '45° maximum'],
    ['bevel 45.5', (c) => end(c, 'B', { wantBevel: true, bvT: '45.5' }), '45° maximum'],
    ['bevel blank', (c) => end(c, 'A', { wantBevel: true, bvT: '' }), 'bevel angle is blank'],
    ['bevel 0', (c) => end(c, 'A', { wantBevel: true, bvT: '0' }), 'more than 0'],
    ['bevel land junk', (c) => end(c, 'A', { wantBevel: true, bvT: '30', landT: 'abc' }), 'bevel land'],
    ['hole diameter typo', (c) => grp(c, { type: 'cust', diaT: '1/', x0T: '6' }), 'diameter'],
    ['hole distance blank', (c) => grp(c, { type: 'cust', diaT: '1', x0T: '' }), 'distance from the end is blank'],
    ['hole count 0', (c) => grp(c, { type: 'cust', diaT: '1', x0T: '6', nT: '0' }), 'how many'],
    ['hole count over 60', (c) => grp(c, { type: 'cust', diaT: '1', x0T: '1', nT: '80', pT: '1/2' }), 'more than 60'],
    ['hole spacing blank', (c) => grp(c, { type: 'cust', diaT: '1', x0T: '6', nT: '3', pT: '' }), 'spacing is blank'],
    ['exact distances with a space instead of a comma', (c) => grp(c, { type: 'cust', diaT: '1', xsT: '3 9 15' }), 'exact distances'],
    ['exact distances with one bad entry', (c) => grp(c, { type: 'cust', diaT: '1', xsT: '3, 9x, 15' }), '“9x”'],
    ['degrees around junk', (c) => grp(c, { type: 'cust', diaT: '1', x0T: '6', azT: 'top' }), 'degrees around'],
    ['how many around over 24', (c) => grp(c, { type: 'cust', diaT: '1', x0T: '6', aznT: '30', azpT: '10' }), 'more than 24'],
    ['degrees apart 0', (c) => grp(c, { type: 'cust', diaT: '1', x0T: '6', azT: '45', aznT: '2', azpT: '0' }), 'must not be 0']
  ];
  for (const [label, mk, want] of cases) {
    const c = await freshApp({ lenT: '48' });
    c.setState(mk(c));
    const e = errs(c);
    ok(c.blocked(c.calc()) && e.some((t) => t.includes(want)), 'blocks: ' + label, e.join(' | ') || 'no red item');
  }

  // other shapes
  const h = await freshApp(); h.pickFam('hss')(); h.setState({ lenT: '36', hsize: '1x1', hwallT: '5/8' });
  ok(h.blocked(h.calc()) && errs(h).some((t) => t.includes('not made')), 'blocks: tube wall the size cannot have', errs(h).join(' | '));
  const h2 = await freshApp(); h2.pickFam('hss')(); h2.setState({ lenT: '36' }); h2.setState(grp(h2, { type: 'slot', diaT: '9/16', sllT: '1/4', x0T: '3' }));
  ok(h2.blocked(h2.calc()) && errs(h2).some((t) => t.includes('shorter than its width')), 'blocks: slot shorter than it is wide', errs(h2).join(' | '));
  const h3 = await freshApp(); h3.pickFam('hss')(); h3.setState(end(h3, 'A', { mode: 'ang', tvT: '', tpT: '0' })); h3.setState({ lenT: '36' });
  ok(h3.blocked(h3.calc()) && errs(h3).some((t) => t.includes('seen from the side is blank')), 'blocks: blank miter on square tube', errs(h3).join(' | '));
  const a = await freshApp(); a.pickFam('angl')(); a.setState({ lenT: '36', asize: '1x1', athkT: '1' });
  ok(a.blocked(a.calc()) && errs(a).some((t) => t.includes('not made')), 'blocks: angle thickness the size cannot have', errs(a).join(' | '));
  const b = await freshApp(); b.pickFam('beam')(); b.setState({ lenT: '60' }); b.setState(end(b, 'A', { wantCope: true, ct: true, tcT: '4', tdT: '1 1/2', trT: '3' }));
  ok(b.blocked(b.calc()) && errs(b).some((t) => t.includes('bigger than the cope')), 'blocks: cope radius bigger than the cope', errs(b).join(' | '));
  const b2 = await freshApp(); b2.pickFam('beam')(); b2.setState({ lenT: '60' }); b2.setState(end(b2, 'B', { wantCope: true, ct: true, tcT: 'four', tdT: '1 1/2', trT: '1/2' }));
  ok(b2.blocked(b2.calc()) && errs(b2).some((t) => t.includes('top cope length')), 'blocks: cope length that will not read', errs(b2).join(' | '));
  const b3 = await freshApp(); b3.pickFam('beam')(); b3.setState({ lenT: '60', bser: 'CUST', bsize: '', cdT: '12', cbT: '6.5', ctfT: '', ctwT: '1/4', cwT: '26' });
  ok(b3.blocked(b3.calc()) && errs(b3).some((t) => t.includes('flange thickness is blank')), 'blocks: blank custom beam dimension', errs(b3).join(' | '));

  // a red item is never crowded out by cautions, and blocked() still sees it past the eight shown
  const many = await freshApp({ lenT: '48' });
  many.setState({ wantHoles: true, groups: Array.from({ length: 12 }, (_, i) => ({ ...many.state.groups[0], id: i + 1, type: 'cust', diaT: '1', x0T: String(200 + i), azT: '0' })) });
  const cm = many.calc();
  ok(cm.errCount >= 12 && cm.warns.length <= 8 && cm.warns.every((w) => w.lvl === 'err') && many.blocked(cm), 'twelve faults: eight shown, all counted, part blocked', cm.errCount + ' / ' + cm.warns.length);

  // good values in every one of those boxes still pass
  const good = await freshApp({ lenT: "4'-0 1/2" });
  good.setState(end(good, 'A', { mode: 'miter', maT: '22.5', mrT: '90', wantBevel: true, bvT: '45', landT: '1/16' }));
  good.setState(grp(good, { type: 'cust', diaT: '1 1/2', xsT: '6, 12 1/2, 30', azT: '90', aznT: '2', azpT: '180' }));
  ok(!good.blocked(good.calc()), 'a correct part with a 45 degree bevel, miter and exact distances is not blocked', errs(good).join(' | '));
  ok(good.calc().A.bv === 45, 'bevel 45 is carried as 45');
}

// ---------- 1b. what the laser takes: 14 in OD, 42 ft ----------
{
  ok(LASER_AS_SHIPPED.maxOD === 14 && LASER_AS_SHIPPED.maxLen === 504, 'the app ships with the laser at 14 in OD and a 42 ft longest stick', JSON.stringify(LASER_AS_SHIPPED));
  Component.LASER = Object.assign({}, LASER_AS_SHIPPED);
  try {
    // 42 ft is the longest STICK. The chuck holds 6 in of it, so the longest piece is 41 ft 6 in.
    const p14 = await freshApp({ lenT: "41'-6", pnps: '14', psch: 'STD' });
    ok(!p14.blocked(p14.calc()), '14 in pipe, 41 ft 6 in long is allowed', errs(p14).join(' | '));
    const p16 = await freshApp({ lenT: '48', pnps: '16', psch: 'STD' });
    ok(p16.blocked(p16.calc()) && errs(p16).some((t) => /16\u2033 OD/.test(t) && /14\u2033 OD at most/.test(t)), '16 in pipe is refused', errs(p16).join(' | '));
    const long = await freshApp({ lenT: "41'-6 1/16" });
    ok(long.blocked(long.calc()) && errs(long).some((t) => /longest stick the laser takes is 42\u2032-0\u2033/.test(t) && /longest piece is 41\u2032-6\u2033/.test(t)), 'a piece 1/16 over 41 ft 6 in is refused, with the reason', errs(long).join(' | '));
    const full = await freshApp({ lenT: "42'-0" });
    ok(full.blocked(full.calc()), 'a 42 ft piece is refused: no stick is long enough once the chuck has its grip', errs(full).join(' | '));
    // the grip is the shop's own figure: with a 2 in grip the longest piece is 41 ft 10 in
    const g2 = await freshApp({ lenT: "41'-10", gripT: '2' }); ok(!g2.blocked(g2.calc()), 'with the chuck grip set to 2 in, a 41 ft 10 in piece is allowed', errs(g2).join(' | '));
    const g2b = await freshApp({ lenT: "41'-10 1/8", gripT: '2' }); ok(g2b.blocked(g2b.calc()), 'and 1/8 more is refused');
    // overall length is what counts: the long points, not what is typed centre to centre
    const mit = await freshApp({ lenT: "41'-6" }); mit.setState(end(mit, 'A', { mode: 'miter', maT: '45', mrT: '0' }));
    ok(!mit.blocked(mit.calc()) && Math.abs(mit.calc().OAL - 498) < 1e-6, 'a mitered piece typed 41 ft 6 in end to end is 41 ft 6 in overall and allowed', mit.calc().OAL);
    const t = await freshApp(); t.pickFam('tube')(); t.setState({ lenT: '48', todT: '14 1/8', twallT: '1/4' });
    ok(t.blocked(t.calc()) && errs(t).some((x) => /14\u2033 OD at most/.test(x)), 'round tube over 14 in OD is refused', errs(t).join(' | '));
    // the size list for the part itself stops at 14 in; the "fits against" list for a saddle does not
    const v = (await freshApp({ lenT: '48' })).renderVals();
    ok(!v.pipeNpsOpts.includes('16') && v.pipeNpsOpts.includes('14') && v.endSteps[0].npsOpts.includes('24'), 'pipe size list stops at 14 in; a saddle can still fit against a 24 in header', v.pipeNpsOpts.join(','));
    // an older part saved at 16 in still shows its size in the list, with the red item
    const old16 = (await freshApp({ lenT: '48', pnps: '16' })).renderVals();
    ok(old16.pipeNpsOpts.includes('16') && old16.hasErr, 'a saved 16 in part still shows its size, flagged red');
    // every other shape has to turn inside the same 14 in circle: corner to corner over 14 in is a stop
    const stop = async (fam, patch, label) => { const q = await freshApp(); q.pickFam(fam)(); q.setState(Object.assign({ lenT: '60' }, patch)); const e = errs(q); ok(q.blocked(q.calc()) && e.some((t) => /corner to corner \u2014 the laser takes 14\u2033 at most/.test(t)), label + ' is refused: over 14 in corner to corner', e.join(' | ')); };
    const fits = async (fam, patch, label) => { const q = await freshApp(); q.pickFam(fam)(); q.setState(Object.assign({ lenT: '60' }, patch)); ok(!q.blocked(q.calc()) && !q.calc().warns.some((w) => /corner to corner/.test(w.t)), label + ' fits, no size item', errs(q).join(' | ')); };
    await stop('beam', { bser: 'W', bsize: 'W16x40' }, 'W16x40 (17.4 in)');
    await stop('beam', { bser: 'W', bsize: 'W12x35' }, 'W12x35 (14.12 in)');
    await stop('beam', { bser: 'W', bsize: 'W14x22' }, 'W14x22 (14.6 in)');
    await fits('beam', { bser: 'W', bsize: 'W12x30' }, 'W12x30 (13.96 in)');
    await fits('beam', { bser: 'W', bsize: 'W12x26' }, 'W12x26 (13.84 in)');
    await stop('chan', { cser: 'C', csize: 'C15x33.9' }, 'C15x33.9 (15.4 in)');
    await fits('chan', { cser: 'C', csize: 'C12x20.7' }, 'C12x20.7 (12.4 in)');
    await stop('hss', { hsize: '12x12', hwallT: '1/2' }, '12x12 tube');
    await stop('hss', { hsize: '12x8', hwallT: '1/4' }, '12x8x1/4 tube (14.04 in with its corner radius)');
    await fits('hss', { hsize: '10x10', hwallT: '1/4' }, '10x10x1/4 tube (13.7 in with its corner radius)');
    await fits('hss', { hsize: '4x4', hwallT: '1/4' }, '4x4 tube');
    await fits('angl', { asize: '8x8', athkT: '1/2' }, '8x8 angle (11.3 in)');
    // the size lists only offer what fits; a size already on the part stays listed (flagged red)
    { const q = await freshApp(); q.pickFam('beam')(); const v2 = q.renderVals();
      ok(v2.beamSizeOpts.includes('W12x30') && v2.beamSizeOpts.includes('W8x31') && !v2.beamSizeOpts.includes('W12x35') && !v2.beamSizeOpts.some((k) => /^W(14|16|18|21|24)x/.test(k)), 'beam size list stops at what turns in 14 in', v2.beamSizeOpts.slice(-6).join(','));
      q.setState({ bsize: 'W16x40' }); ok(q.renderVals().beamSizeOpts.includes('W16x40') && q.renderVals().hasErr, 'a saved W16x40 still shows its size, flagged red');
      q.renderVals().onBser({ target: { value: 'S' } }); ok(q.state.bser === 'S' && !q.blocked(q.calc()), 'changing beam type lands on a size that fits', q.state.bsize);
      const k = await freshApp(); k.pickFam('chan')(); const v3 = k.renderVals(); ok(v3.chanSizeOpts.includes('C12x20.7') && !v3.chanSizeOpts.some((x) => /^C15x/.test(x)), 'channel size list stops at C12');
      const t = await freshApp(); t.pickFam('hss')(); const v4 = t.renderVals(); ok(v4.hssSizeOpts.includes('10x10') && v4.hssSizeOpts.includes('12x8') && !v4.hssSizeOpts.includes('12x12') && !v4.hssSizeOpts.includes('16x12') && !v4.hssSizeOpts.includes('14x10'), 'tube size list: 10x10 and 12x8 stay, 12x12 and up are gone', v4.hssSizeOpts.slice(-6).join(',')); }
    // stock: nothing longer than the bed
    { const q = await freshApp({ lenT: '120', mark: 'S-1', job: 'J1' }); q.addToJob();
      const keys = q.renderVals().nests.map((n2) => n2.key); q.setState({ stickSel: Object.fromEntries(keys.map((k2) => [k2, '576'])) });
      const nests = q.renderVals().nests; ok(keys.length === 1 && nests.every((n2) => n2.stick === '504'), 'a job saved with 48 ft stock is nested on 42 ft, the longest the laser takes', JSON.stringify(nests.map((n2) => n2.stick))); }
  } finally { Component.LASER = { maxOD: Infinity, maxLen: Infinity }; }
}

// ---------- 1c. common parts: one tap, a valid part, read back in plain words ----------
{
  for (const fam of ['pipe', 'tube', 'hss', 'beam', 'chan', 'angl']) {
    const c = await freshApp(); c.pickFam(fam)(); c.setState({ lenT: '60' });
    const names = c.renderVals().starters.map((x) => x.l);
    ok(names.length >= 3 && names[0] === 'Straight cut', fam + ': common parts are offered, straight cut first', names.join(' | '));
    for (const nm of names) {
      const d = await freshApp(); d.pickFam(fam)(); d.setState({ lenT: '60' });
      d.renderVals().starters.find((x) => x.l === nm).go();
      ok(!d.blocked(d.calc()) && !d.markIssue(), fam + ' \u201C' + nm + '\u201D gives a part that can be saved as it stands', errs(d).join(' | '));
    }
  }
  const pick = async (fam, nm, patch) => { const d = await freshApp(); d.pickFam(fam)(); d.setState(Object.assign({ lenT: '60' }, patch)); d.renderVals().starters.find((x) => x.l === nm).go(); return d; };
  const br = await pick('pipe', 'Branch / stub-in'), rb = br.calc();
  ok(rb.A.mode === 'saddle' && rb.B.mode === 'sq' && br.endWords(rb.A, rb.sec) === 'Fish-mouth to sit on 6\u2033 SCH 40 pipe, square to it (a tee)' && br.endWords(rb.B, rb.sec) === 'Square cut', 'pipe branch: saddle on End A, read back in plain words', br.endWords(rb.A, rb.sec));
  const fr = await pick('hss', 'Frame side \u2014 45\u00B0 both ends'), rf = fr.calc();
  ok(Math.abs(rf.OAL - 60) < 1e-9 && Math.abs(rf.SP - 52) < 1e-9 && fr.endWords(rf.A, rf.sec) === 'Miter 45\u00B0 seen from the side, top is the long side', '4x4 frame side: 60 long point to long point, 52 short side, top long', rf.OAL + ' / ' + rf.SP + ' / ' + fr.endWords(rf.A, rf.sec));
  const cb = await pick('beam', 'Coped beam \u2014 web bolts'), rc = cb.calc();
  ok(!!rc.A.ct && !!rc.B.ct && rc.holes.filter((h) => h.ok).length === 6 && /top flange coped 4\u2033 long \u00D7 1 1\/2\u2033 deep/.test(cb.endWords(rc.A, rc.sec)), 'coped beam: both ends coped, six web bolts', cb.endWords(rc.A, rc.sec));
  const hp = await pick('tube', 'Handrail post'), rh = hp.calc();
  ok(rh.B.mode === 'saddle' && rh.B.sd.custom && Math.abs(rh.B.sd.hod - 2) < 1e-9, 'handrail post: top fish-mouthed to a rail of the same 2 in tube');
  // a common part replaces what was on the form (after asking), and keeps size, grade and length
  const w = await freshApp({ lenT: '72', pnps: '4', psch: '80', mat: '304L' }); w.setState(end(w, 'A', { mode: 'miter', maT: '30' })); w.setState(grp(w, { type: 'cust', diaT: '1', x0T: '6' }));
  w.renderVals().starters[0].go();
  ok(w.state.ends.A.mode === 'sq' && !w.state.wantHoles && w.state.pnps === '4' && w.state.psch === '80' && w.state.mat === '304L' && w.state.lenT === '72', 'Straight cut clears the ends and holes and keeps size, grade and length');
  // long side of a pipe miter in words
  const m = await freshApp({ lenT: '48' }); m.setState(end(m, 'B', { mode: 'miter', maT: '45', mrT: '90' }));
  ok(/long side on the right/.test(m.endWords(m.calc().B, m.calc().sec)), 'miter turned 90: long side on the right');
  m.setState(end(m, 'B', { mode: 'miter', maT: '-45', mrT: '90' }));
  ok(/long side on the left/.test(m.endWords(m.calc().B, m.calc().sec)), 'a minus miter angle flips the long side');
}

// ---------- 2. laser file names ----------
{
  const c = await freshApp({ lenT: '48', mark: 'P-7', qty: 3 });
  ok(c.laserName(3) === 'P-7_6-SCH-40_A106B_48in - QTY 3.igs', 'name: mark, section, grade, length, quantity', c.laserName(3));
  c.setState(end(c, 'A', { wantBevel: true, bvT: '37.5' })); c.setState(end(c, 'B', { wantBevel: true, bvT: '30' }));
  ok(c.laserName(3) === 'P-7_6-SCH-40_A106B_48in_BEVELED-A37.5-B30 - QTY 3.igs', 'name carries the weld bevel of each end (BEVELED: it is drawn in the file)', c.laserName(3));
  const d = await freshApp({ lenT: '48.03', mark: ' my part #1/2 ', mat: '304L' });
  ok(d.laserName(1) === 'my-part-1-2_6-SCH-40_304L_48.03in - QTY 1.igs', 'name: true length to the thousandth, no characters Windows or OneDrive refuse', d.laserName(1));
  for (const fam of ['pipe', 'tube', 'hss', 'beam', 'chan', 'angl']) {
    const f = await freshApp(); f.pickFam(fam)(); f.setState({ lenT: "10'-6 3/8", mark: 'X-1' });
    const n = f.laserName(12);
    ok(/^[A-Za-z0-9._-]+ - QTY 12\.igs$/.test(n) && n.length < 120 && n.startsWith('X-1_'), fam + ': laser file name is plain and short', n);
  }
}

// ---------- 3. part marks ----------
{
  const c = await freshApp({ lenT: '48', mark: '' });
  ok(/Give this part a mark/.test(c.markIssue()), 'a blank mark is called out');
  c.addToJob(); ok(c.state.parts.length === 0, 'a part with no mark is not added to the job');
  c.setState({ mark: 'P-1' }); ok(c.markIssue() === '', 'a mark clears it');
  c.addToJob(); ok(c.state.parts.length === 1 && c.state.mark === 'P-2', 'added; the form moves to the next mark');
  c.setState({ mark: 'p-1' });
  ok(/already in the job list/.test(c.markIssue()) && /Next free: p-2/.test(c.markIssue()), 'a repeated mark (any letter case) is called out with the next free one', c.markIssue());
  c.addToJob(); ok(c.state.parts.length === 1, 'a second part with the same mark is not added');
  c.renderVals().jobParts[0].load(); ok(c.state.editId != null && c.markIssue() === '', 'opening the part to edit it does not trip on its own mark');
  c.addToJob(); ok(c.state.parts.length === 1, 'saving the edit keeps one part');
}

// ---------- 4. saving into the linked laser folder ----------
const fakeDir = (name) => {
  const files = new Map(), dirs = new Map();
  return {
    kind: 'directory', name, files, dirs, short: false,
    async getDirectoryHandle(n, o) { if (!dirs.has(n)) { if (!o || !o.create) throw new Error('NotFoundError'); dirs.set(n, fakeDir(n)); } return dirs.get(n); },
    async getFileHandle(n, o) {
      const self = this;
      if (!files.has(n)) { if (!o || !o.create) throw new Error('NotFoundError'); files.set(n, { data: '' }); }
      const rec = files.get(n);
      return { kind: 'file', name: n, async createWritable() { let buf = ''; return { async write(t) { buf = t; }, async close() { rec.data = self.short && typeof buf === 'string' ? buf.slice(0, Math.floor(buf.length / 2)) : buf; } }; }, async getFile() { return { size: new TextEncoder().encode(rec.data).length }; } };
    },
    async removeEntry(n) { if (!files.delete(n)) throw new Error('NotFoundError'); },
    async *entries() { for (const [n] of files) yield [n, { kind: 'file', name: n }]; for (const [n, d] of dirs) yield [n, d]; },
    async requestPermission() { return 'granted'; }, async queryPermission() { return 'granted'; }
  };
};
try {
  const oc = await loadOcc(), occm = await import('../occ-solid.js'), K = kit(oc);
  const link = (c, dir) => { c._fsDir = dir; c.setState({ fsName: dir.name, fsPerm: 'granted' }); c._occ = async () => ({ oc, m: occm }); c._dl = []; c._download = (data, name) => { c._dl.push(name); }; };

  // one part
  const c = await freshApp({ lenT: '48', mark: 'P-1', qty: 4, job: '2611' });
  c.setState(end(c, 'B', { mode: 'miter', maT: '30', mrT: '0' }));
  const root = fakeDir('Laser'); link(c, root);
  c.askSave('part');
  const rv = c.reviewInfo('part');
  ok(c.state.review === 'part' && rv.one.file === 'P-1_6-SCH-40_A106B_48in - QTY 4.igs' && rv.dest === 'Laser › JOB_2611' && rv.one.endB === 'Miter 30\u00B0 off square, long side on top' && rv.one.qty === 4, 'review card reads the part back: file, folder, ends, quantity', JSON.stringify([rv.one.file, rv.dest, rv.one.endB]));
  await c.confirmSave();
  const jobDir = root.dirs.get('JOB_2611');
  const saved = jobDir && jobDir.files.get('P-1_6-SCH-40_A106B_48in - QTY 4.igs');
  ok(!!saved && saved.data.length > 1000 && c._dl.length === 0, 'the laser file is in the job folder and nothing went to Downloads', jobDir ? [...jobDir.files.keys()].join(' | ') : 'no job folder');
  ok(c.state.saveOk && /Saved P-1_6-SCH-40_A106B_48in - QTY 4\.igs → Laser › JOB_2611/.test(c.state.saveMsg), 'the form says exactly where it went', c.state.saveMsg);
  ok(c.renderVals().hasSaveMsg === true, 'the Saved line shows for the part that was just saved');
  c.setState({ lenT: '47 3/4' });
  ok(c.renderVals().hasSaveMsg === false, 'the Saved line goes away the moment the form changes (an old "Saved" never covers an edited part)');
  c.setState({ lenT: '48' });
  if (saved) {
    // the reader hands back millimetres for a file that declares inches
    const info = inspect(K, readBack(K, saved.data, 'iges')), lenIn = (info.bbox[0][1] - info.bbox[0][0]) / 25.4;
    ok(info.valid && Math.abs(lenIn - 48) < 1e-3, 'the file in the folder reads back as a valid solid exactly 48.000 long', lenIn);
  }
  // revise the part: the superseded file is found and removed
  c.setState({ lenT: '47 1/2' });
  c.askSave('part'); await c.confirmSave();
  const names = [...jobDir.files.keys()];
  ok(names.length === 1 && names[0] === 'P-1_6-SCH-40_A106B_47.5in - QTY 4.igs' && /1 older file removed/.test(c.state.saveMsg), 'saving a revised part removes the superseded laser file', names.join(' | ') + ' :: ' + c.state.saveMsg);
  // another mark's file is never touched by a single-part save
  jobDir.files.set('P-10_6-SCH-40_A106B_12in - QTY 1.igs', { data: 'x' });
  c.setState({ lenT: '47' }); c.askSave('part'); await c.confirmSave();
  ok(jobDir.files.has('P-10_6-SCH-40_A106B_12in - QTY 1.igs') && !jobDir.files.has('P-1_6-SCH-40_A106B_47.5in - QTY 4.igs'), 'only that mark’s older files are removed', [...jobDir.files.keys()].join(' | '));

  // a write that does not read back whole falls back to a download and says so
  const c2 = await freshApp({ lenT: '24', mark: 'P-2', qty: 1, job: '2611' });
  const bad = fakeDir('Laser'); bad.dirs.set('JOB_2611', Object.assign(fakeDir('JOB_2611'), { short: true })); link(c2, bad);
  c2.askSave('part'); await c2.confirmSave();
  ok(c2._dl.length === 1 && /Downloads/.test(c2.state.saveMsg), 'a file that does not read back whole is not trusted: it is downloaded instead', c2._dl.join(' | ') + ' :: ' + c2.state.saveMsg);

  // whole job
  const j = await freshApp({ lenT: '48', mark: 'P-1', qty: 3, job: '2612' });
  const rj = fakeDir('Laser'); link(j, rj);
  j.addToJob();
  j.pickFam('hss')(); j.setState({ lenT: '36', qty: 2 }); j.addToJob();
  j.pickFam('angl')(); j.setState({ lenT: '30', qty: 5 }); j.addToJob();
  rj.dirs.set('JOB_2612', fakeDir('JOB_2612')); rj.dirs.get('JOB_2612').files.set('OLD-9_2x2_A36_10in - QTY 1.igs', { data: 'x' });
  j.askSave('job');
  const rvj = j.reviewInfo('job');
  ok(rvj.rows.length === 3 && rvj.n === 3 && rvj.out === 0 && rvj.dest === 'Laser › JOB_2612', 'job review lists every part and where it goes');
  await j.confirmSave();
  const jd = rj.dirs.get('JOB_2612'), jn = [...jd.files.keys()].sort();
  ok(jn.length === 4 && jn.includes('cut list.csv') && jn.filter((n) => /\.igs$/.test(n)).length === 3 && !jn.some((n) => /^OLD-9/.test(n)) && j._dl.length === 0, 'job save: three laser files and the cut list in the job folder, the leftover file removed, no zip', jn.join(' | '));
  ok(jn.some((n) => /^P-1_.* - QTY 3\.igs$/.test(n)) && jn.some((n) => /^H-2_.* - QTY 2\.igs$/.test(n)) && jn.some((n) => /^L-3_.* - QTY 5\.igs$/.test(n)), 'job save: each file carries its mark and quantity', jn.join(' | '));
  ok(/"P-1",3/.test(jd.files.get('cut list.csv').data), 'job save: the cut list in the folder lists the parts');

  // no folder linked: the old zip path still works
  const z = await freshApp({ lenT: '48', mark: 'P-1', qty: 1 });
  z._occ = async () => ({ oc, m: occm }); z._dl = []; z._download = (data, name) => { z._dl.push(name); };
  z.addToJob(); z.askSave('job'); await z.confirmSave();
  ok(z._dl.length === 1 && /laser files\.zip$/.test(z._dl[0]) && /Unzip it into the laser folder/.test(z.state.saveMsg), 'no laser folder: one zip is downloaded and the form says what to do with it', z._dl.join(' | '));
} catch (e) { fail++; fails.push('folder save: threw ' + (e && e.stack ? e.stack : e)); }

// ---------- 5. every cut edge in the laser file is described the same way twice ----------
// An IGES trimmed surface carries each edge as a 3D curve and as a curve in the surface's own
// coordinates; a reader may use either. They must be the same edge. (Before the repair in
// occ-solid.js agreeEdges() a 1 in hole on 6 in pipe differed by 0.135 in between the two.)
try {
  const { bVsCText } = await import('./_iges-bc.mjs');
  const oc = await loadOcc(), occm = await import('../occ-solid.js');
  const worstOf = (c) => { const r0 = c.calc(); if (c.blocked(r0)) return 'blocked: ' + errs(c).join(' | '); const { K, shape } = occm.buildSolid(oc, c, r0); const q = bVsCText(occm.writeIges(K, shape, 'x')); return q.rows.length ? Math.max(...q.rows.map((x) => x.worst)) : 'no trimming curves read'; };
  const hole = (c, p) => c.setState((st) => ({ wantHoles: true, groups: [{ ...st.groups[0], type: 'cust', diaT: '1', x0T: '12', azT: '0', ...p }] }));
  const list = [];
  for (const az of ['0', '30', '60', '90', '120', '150', '210', '300']) list.push(['6 in pipe, 1 in hole at ' + az + ' deg', async () => { const c = await freshApp({ lenT: '24' }); hole(c, { azT: az }); return c; }]);
  for (const [nps, dia] of [['2', '3/4'], ['12', '2'], ['24', '4']]) list.push([nps + ' in pipe, ' + dia + ' in hole at 120 deg', async () => { const c = await freshApp({ lenT: '36', pnps: nps, psch: 'STD' }); hole(c, { azT: '120', diaT: dia }); return c; }]);
  list.push(['6 in pipe, branch-through hole (2 in SCH 40) x 3 round', async () => { const c = await freshApp({ lenT: '24' }); hole(c, { type: 'stub', bnps: '2', bsch: '40', azT: '45', aznT: '3', azpT: '100' }); return c; }]);
  list.push(['6 in pipe saddled onto 10 in, sits on it', async () => { const c = await freshApp({ lenT: '24' }); c.renderVals().endSteps[0].mSaddle(); c.setState(end(c, 'A', { sdN: '10', sdS: '40' })); return c; }]);
  list.push(['6 in pipe saddled onto 10 in at 45 deg, goes through it, other end mitered 30', async () => { const c = await freshApp({ lenT: '36' }); c.renderVals().endSteps[0].mSaddle(); c.setState(end(c, 'A', { sdN: '10', sdS: '40', sdAT: '45', sdSeat: 'thru' })); c.setState(end(c, 'B', { mode: 'miter', maT: '30', mrT: '90' })); return c; }]);
  list.push(['6 in pipe, saddle both ends + holes', async () => { const c = await freshApp({ lenT: '48' }); c.renderVals().endSteps[0].mSaddle(); c.renderVals().endSteps[1].mSaddle(); hole(c, { x0T: '24', azT: '90', aznT: '2', azpT: '180' }); return c; }]);
  list.push(['2 in OD x .120 round tube, miter + hole', async () => { const c = await freshApp(); c.pickFam('tube')(); c.setState({ lenT: '30', todT: '2', twallT: '.120' }); c.setState(end(c, 'B', { mode: 'miter', maT: '45', mrT: '0' })); hole(c, { diaT: '9/16', x0T: '6', azT: '90' }); return c; }]);
  list.push(['4x4x1/4 tube, compound miter + side holes', async () => { const c = await freshApp(); c.pickFam('hss')(); c.setState({ lenT: '36' }); c.setState(end(c, 'A', { mode: 'ang', tvT: '30', tpT: '20' })); c.setState((st) => ({ wantHoles: true, groups: [{ ...st.groups[0], face: 'L', type: 'cust', diaT: '9/16', x0T: '8', nT: '2', pT: '3' }] })); return c; }]);
  list.push(['W12x26, top cope + web bolts', async () => { const c = await freshApp(); c.pickFam('beam')(); c.setState({ lenT: '60' }); c.setState(end(c, 'A', { wantCope: true, ct: true })); c.renderVals().recipes[0].go(); return c; }]);
  list.push(['L3x3x1/4, plan miter + 2 bolts', async () => { const c = await freshApp(); c.pickFam('angl')(); c.setState({ lenT: '24' }); c.setState(end(c, 'A', { mode: 'ang', tvT: '0', tpT: '-45' })); c.setState((st) => ({ wantHoles: true, groups: [{ ...st.groups[0], face: 'vleg', type: 'std', bolt: '3/4', gT: '1 3/4', refEnd: 'B', x0T: '1 1/2', nT: '2', pT: '3' }] })); return c; }]);
  list.push(['6 in pipe saddled onto 6 in (same size, the steepest saddle) + a hole on top', async () => { const c = await freshApp({ lenT: '48' }); c.renderVals().endSteps[0].mSaddle(); hole(c, { x0T: '6', azT: '0' }); return c; }]);
  list.push(['6 in pipe saddled onto 6 in + 45 miter + hole', async () => { const c = await freshApp({ lenT: '48' }); c.renderVals().endSteps[0].mSaddle(); c.setState(end(c, 'B', { mode: 'miter', maT: '45', mrT: '0' })); hole(c, { x0T: '6', azT: '0' }); return c; }]);
  // the gate itself: the same pipe written WITHOUT the repair is caught by the file check the app runs before saving
  {
    const { edgeAgreement } = await import('../iges-check.js');
    const c = await freshApp({ lenT: '24' }); hole(c, { azT: '120' });
    const { K, shape } = occm.buildSolid(oc, c, c.calc());
    const raw = K.done(K.mk('BRepBuilderAPI_NurbsConvert', shape, true)), w = K.mk('IGESControl_Writer', 'IN', 0);
    K.call(w, 'AddShape', K.scale(raw, 25.4)); w.ComputeModel(); K.call(w, 'Write', '/raw.igs', false);
    const bad = edgeAgreement(oc.FS.readFile('/raw.igs', { encoding: 'utf8' })), good = edgeAgreement(occm.writeIges(K, shape, 'x'));
    ok(bad.worst > .05 && bad.curves > 0, 'file check: an unrepaired pipe-with-hole file is caught (its edge descriptions differ by more than 1/20 in)', bad.worst.toFixed(4));
    ok(good.worst < 5e-4 && good.unreadable === 0 && good.curves === bad.curves, 'file check: the file the app writes passes, every edge readable', good.worst.toFixed(6) + ' / ' + good.unreadable);
  }
  for (const [name, mk] of list) { let w; try { w = worstOf(await mk()); } catch (e) { w = 'threw: ' + (e && e.message ? e.message : e); } ok(typeof w === 'number' && w < 5e-4, 'laser file edges agree: ' + name, typeof w === 'number' ? w.toFixed(6) + ' in' : w); }
} catch (e) { fail++; fails.push('edge agreement: threw ' + (e && e.stack ? e.stack : e)); }

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
