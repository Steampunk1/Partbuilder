// Laser-ready checks: nothing typed is ever silently replaced, the bevel stops
// at the laser's 45 degrees, laser file names say what the operator needs, and
// a save into the linked laser folder lands where the app says it did.
// Run:  node test/laser-ready.mjs
import { loadOcc } from './_occ.mjs';
import { freshApp, Component } from './_load.mjs';
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

// ---------- 2. laser file names ----------
{
  const c = await freshApp({ lenT: '48', mark: 'P-7', qty: 3 });
  ok(c.laserName(3) === 'P-7_6-SCH-40_A106B_48in - QTY 3.igs', 'name: mark, section, grade, length, quantity', c.laserName(3));
  c.setState(end(c, 'A', { wantBevel: true, bvT: '37.5' })); c.setState(end(c, 'B', { wantBevel: true, bvT: '30' }));
  ok(c.laserName(3) === 'P-7_6-SCH-40_A106B_48in_BEVEL-A37.5-B30 - QTY 3.igs', 'name carries the weld bevel of each end', c.laserName(3));
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
  ok(c.state.review === 'part' && rv.one.file === 'P-1_6-SCH-40_A106B_48in - QTY 4.igs' && rv.dest === 'Laser › JOB_2611' && /MITER 30/.test(rv.one.endB) && rv.one.qty === 4, 'review card reads the part back: file, folder, ends, quantity', JSON.stringify([rv.one.file, rv.dest, rv.one.endB]));
  await c.confirmSave();
  const jobDir = root.dirs.get('JOB_2611');
  const saved = jobDir && jobDir.files.get('P-1_6-SCH-40_A106B_48in - QTY 4.igs');
  ok(!!saved && saved.data.length > 1000 && c._dl.length === 0, 'the laser file is in the job folder and nothing went to Downloads', jobDir ? [...jobDir.files.keys()].join(' | ') : 'no job folder');
  ok(c.state.saveOk && /Saved P-1_6-SCH-40_A106B_48in - QTY 4\.igs → Laser › JOB_2611/.test(c.state.saveMsg), 'the form says exactly where it went', c.state.saveMsg);
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

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
