// What leaves for the laser is whole and true:
//  1. no two cut features run into each other, whichever hole set they came from
//  2. the cut list names only laser files that were really written
//  3. a job that cannot be written in full leaves the laser folder exactly as it was
//  4. the stick count only counts pieces that fit on a stick
// Run:  node test/release.mjs
import { loadOcc } from './_occ.mjs';
import { freshApp, Component, LASER_AS_SHIPPED } from './_load.mjs';
import * as occm from '../occ-solid.js';

let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; if (fails.length < 60) fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); } };
const errs = (c) => c.calc().warns.filter((w) => w.lvl === 'err').map((w) => w.t);
const warns = (c) => c.calc().warns.filter((w) => w.lvl !== 'err').map((w) => w.t);
const setEnd = (c, id, p) => c.setState({ ends: { ...c.state.ends, [id]: { ...c.state.ends[id], ...p } } });
/** Replace the hole sets: each entry is a patch on a fresh set of this shape. */
const sets = (c, list) => c.setState({ wantHoles: true, gid: list.length + 1, groups: list.map((p, i) => ({ ...Component.newGroup(i + 1, c.state.family), type: 'cust', nT: '1', nyT: '1', both: false, autoY: false, autoG: false, ...p })) });
const clash = (c) => errs(c).filter((t) => /run together|runs into|one opening/.test(t));
Component.LASER = LASER_AS_SHIPPED;

// ------------------------------------------------------------------ 1. features that run into each other
{
  // the case as reported: 36 in pipe, two 1 in holes on the same wall, 6 and 6 1/2 from End A, in two hole sets
  const c = await freshApp({ lenT: '36' });
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '6 1/2', azT: '0' }]);
  ok(c.blocked(c.calc()) && clash(c).length === 1, 'two 1 in holes 1/2 in apart in two hole sets are refused', errs(c).join(' | '));
  ok(/set 1/i.test(clash(c)[0] || '') && /set 2/i.test(clash(c)[0] || '') && /6″/.test(clash(c)[0] || '') && /6 1\/2″/.test(clash(c)[0] || ''), 'the red item names both holes and both sets', clash(c)[0]);
  ok(c.calc().holes.filter((h) => h.clash).length === 2 && /M/.test(c.calc().paths.clashP || ''), 'both holes are marked on the flat drawing');
  { const rv = c.reviewInfo('part'); ok(rv.one.bad && /run together|one opening/.test(rv.one.why), 'the check card refuses it, with the reason', rv.one.why); }
  // the same two holes in ONE set were already refused
  sets(c, [{ diaT: '1', xsT: '6, 6 1/2', azT: '0' }]); ok(c.blocked(c.calc()), 'control: the same holes in one set are refused too');
  // clear of each other: fine
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '12', azT: '0' }]); ok(!c.blocked(c.calc()) && !clash(c).length, 'holes 6 in apart in two sets are fine', errs(c).join(' | '));
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '6', azT: '180' }]); ok(!clash(c).length, 'same distance, opposite sides of the pipe: fine', errs(c).join(' | '));
  // round the pipe: 6 in SCH 40 is 20.8 round, so 10 deg is 0.58 in of arc - two 1 in holes there overlap
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '6', azT: '10' }]); ok(clash(c).length === 1, 'same distance, 10° apart round a 6 in pipe: refused', errs(c).join(' | '));
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '6', azT: '30' }]); ok(!clash(c).length, 'same distance, 30° apart: fine');
  // touching counts: edge to edge leaves no metal
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '7', azT: '0' }]); ok(clash(c).length === 1, 'holes that just touch are refused', errs(c).join(' | '));
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '7 1/64', azT: '0' }]); ok(clash(c).length === 1, 'a 1/64 sliver between holes is refused (under 1/32)', errs(c).join(' | '));
  // a thin web is a caution, not a stop
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '7 1/8', azT: '0' }]);
  ok(!c.blocked(c.calc()) && warns(c).some((t) => /between/.test(t) && /wall/.test(t)), '1/8 in of metal between holes in a .280 wall: allowed, with a caution', warns(c).join(' | '));
  sets(c, [{ diaT: '1', x0T: '6', azT: '0' }, { diaT: '1', x0T: '7 1/2', azT: '0' }]); ok(!warns(c).some((t) => /between/.test(t)), '1/2 in of metal between holes: no caution');
  // a pattern that runs into a single hole from another set
  sets(c, [{ diaT: '3/4', x0T: '3', nT: '6', pT: '4', azT: '0' }, { diaT: '1', x0T: '11 1/4', azT: '0' }]); ok(clash(c).length === 1 && /11 1\/4″/.test(clash(c)[0]), 'a row of holes and one hole from another set that lands on it: refused', errs(c).join(' | '));
  // one set that overlaps itself round the pipe
  const t = await freshApp(); t.pickFam('tube')(); t.setState({ lenT: '24', todT: '2', twallT: '.120' });
  sets(t, [{ diaT: '1', x0T: '6', azT: '0', aznT: '4', azpT: '45' }]); ok(t.blocked(t.calc()) && clash(t).length >= 1, 'one set, 1 in holes 45° apart round a 2 in tube: refused', errs(t).join(' | '));
  sets(t, [{ diaT: '1/2', x0T: '6', azT: '0', aznT: '3', azpT: '90' }]); ok(!clash(t).length, 'one set, 1/2 in holes 90° apart round a 2 in tube: fine', errs(t).join(' | '));
  // both sides of the seam
  sets(c, [{ diaT: '1', x0T: '6', azT: '171.2' }, { diaT: '1', x0T: '6', azT: '188.8' }]);
  ok(c.blocked(c.calc()) && clash(c).length === 1, 'holes either side of the seam with a sliver between them across it are refused', errs(c).join(' | '));
  sets(c, [{ diaT: '1', x0T: '6', azT: '160' }, { diaT: '1', x0T: '6', azT: '200' }]);
  ok(!clash(c).length, 'holes either side of the seam, 40° apart: fine', errs(c).join(' | '));
}
{
  // square tube: slot and round hole, same face and different faces
  const h = await freshApp(); h.pickFam('hss')(); h.setState({ lenT: '36', hsize: '4x4', hwallT: '1/4' });
  sets(h, [{ type: 'slot', diaT: '9/16', sllT: '2', ax: 'x', x0T: '6', face: 'T', offT: '0' }, { type: 'cust', diaT: '3/4', x0T: '7', face: 'T', offT: '0' }]);
  ok(h.blocked(h.calc()) && clash(h).length === 1 && /slot/.test(clash(h)[0]), 'tube: a slot and a hole that land on each other are refused', errs(h).join(' | '));
  sets(h, [{ type: 'slot', diaT: '9/16', sllT: '2', ax: 'x', x0T: '6', face: 'T', offT: '0' }, { type: 'cust', diaT: '3/4', x0T: '7', face: 'R', offT: '0' }]);
  ok(!clash(h).length, 'tube: the same slot and hole on different faces are fine', errs(h).join(' | '));
  sets(h, [{ type: 'cust', diaT: '3/4', x0T: '6', face: 'T', offT: '1/2' }, { type: 'cust', diaT: '3/4', x0T: '6', face: 'T', offT: '-1/2' }]);
  ok(!clash(h).length && !h.blocked(h.calc()), 'tube: two 3/4 holes side by side 1 in apart on one face are fine', errs(h).join(' | '));
  sets(h, [{ type: 'cust', diaT: '3/4', x0T: '6', face: 'T', offT: '1/4' }, { type: 'cust', diaT: '3/4', x0T: '6', face: 'T', offT: '-1/4' }]);
  ok(clash(h).length === 1, 'tube: two 3/4 holes side by side 1/2 in apart are refused', errs(h).join(' | '));
}
{
  // beam: web against web, web against flange
  const b = await freshApp(); b.pickFam('beam')(); b.setState({ lenT: '60', bser: 'W', bsize: 'W12x26' });
  sets(b, [{ face: 'web', diaT: '13/16', x0T: '3', y0T: '3', wref: 'tos' }, { face: 'web', diaT: '13/16', x0T: '3 1/2', y0T: '3', wref: 'tos' }]);
  const cb = clash(b);
  ok(b.blocked(b.calc()) && cb.length === 1 && /web/.test(cb[0]), 'beam: two web holes 1/2 in apart in two sets are refused', errs(b).join(' | '));
  sets(b, [{ face: 'web', diaT: '13/16', x0T: '3', y0T: '3', wref: 'tos' }, { face: 'tf', diaT: '13/16', x0T: '3' }]);
  ok(!clash(b).length, 'beam: a web hole and a flange hole at the same distance are fine', errs(b).join(' | '));
  // angle
  const a = await freshApp(); a.pickFam('angl')(); a.setState({ lenT: '36', asize: '4x4', athkT: '3/8' });
  sets(a, [{ face: 'vleg', diaT: '13/16', x0T: '3' }, { face: 'vleg', diaT: '13/16', x0T: '3 1/4' }]);
  ok(a.blocked(a.calc()) && clash(a).length === 1 && /leg/.test(clash(a)[0]), 'angle: two holes in one leg 1/4 in apart in two sets are refused', errs(a).join(' | '));
  sets(a, [{ face: 'vleg', diaT: '13/16', x0T: '3' }, { face: 'hleg', diaT: '13/16', x0T: '3' }]);
  ok(!clash(a).length, 'angle: one hole in each leg at the same distance is fine', errs(a).join(' | '));
}
{
  // a hole in metal that a cope takes away
  const b = await freshApp(); b.pickFam('beam')(); b.setState({ lenT: '60', bser: 'W', bsize: 'W12x26' });
  setEnd(b, 'A', { wantCope: true, ct: true, cb: false, tcT: '4', tdT: '1 1/2', trT: '1/2' });
  ok(!b.blocked(b.calc()), 'control: a top cope by itself is fine', errs(b).join(' | '));
  sets(b, [{ face: 'tf', diaT: '13/16', x0T: '2' }]);
  ok(b.blocked(b.calc()) && errs(b).some((t) => /cope/i.test(t)), 'beam: a top flange hole inside the length of the top cope is refused', errs(b).join(' | '));
  sets(b, [{ face: 'tf', diaT: '13/16', x0T: '8' }]);
  ok(!errs(b).some((t) => /cope/i.test(t)), 'beam: a top flange hole clear of the cope is fine', errs(b).join(' | '));
  sets(b, [{ face: 'web', diaT: '13/16', x0T: '2', y0T: '1', wref: 'tos' }]);
  ok(b.blocked(b.calc()) && errs(b).some((t) => /cope/i.test(t)), 'beam: a web hole inside the coped corner is refused', errs(b).join(' | '));
  sets(b, [{ face: 'web', diaT: '13/16', x0T: '2', y0T: '6', wref: 'tos' }]);
  ok(!errs(b).some((t) => /cope/i.test(t)), 'beam: a web hole below the cope is fine', errs(b).join(' | '));
}

// ------------------------------------------------------------------ a laser folder that can be made to fail
const mkDir = (name, opt = {}) => {
  const files = new Map(), dirs = new Map(), log = [];
  const d = {
    kind: 'directory', name, files, dirs, log, failOn: opt.failOn || null, dead: false, truncate: opt.truncate || null,
    async getDirectoryHandle(n, o) { if (d.dead) throw new Error('NotAllowedError'); if (!dirs.has(n)) { if (!o || !o.create) throw new Error('NotFoundError'); dirs.set(n, mkDir(n, opt.sub || {})); } return dirs.get(n); },
    async getFileHandle(n, o) {
      if (d.dead) throw new Error('NotAllowedError');
      if (!files.has(n)) { if (!o || !o.create) throw new Error('NotFoundError'); files.set(n, { data: '', fresh: true }); }
      const rec = files.get(n);
      return { kind: 'file', name: n,
        async createWritable() { let buf = ''; return { async write(t) { buf = t; }, async close() {
          if (d.dead) throw new Error('NotAllowedError');
          if (d.failOn && d.failOn(n, log)) { if (rec.fresh) files.delete(n); if (d.dieAfterFail) d.dead = true; throw new Error('NoModificationAllowedError'); }
          rec.data = d.truncate && d.truncate(n) && typeof buf === 'string' ? buf.slice(0, Math.floor(buf.length / 2)) : buf; rec.fresh = false; log.push(n); } }; },
        async getFile() { if (d.dead) throw new Error('NotAllowedError'); return { size: new TextEncoder().encode(rec.data).length, async text() { return rec.data; } }; } };
    },
    async removeEntry(n) { if (d.dead) throw new Error('NotAllowedError'); if (!files.delete(n)) throw new Error('NotFoundError'); log.push('-' + n); },
    async *entries() { for (const [n] of files) yield [n, { kind: 'file', name: n }]; for (const [n, x] of dirs) yield [n, x]; },
    async requestPermission() { return 'granted'; }, async queryPermission() { return 'granted'; }
  };
  return d;
};
const oc = await loadOcc();
const link = (c, dir, answers) => { c._fsDir = dir; c.setState({ fsName: dir.name, fsPerm: 'granted' }); c._occ = async () => ({ oc, m: occm }); c._dl = []; c._download = (data, name) => { c._dl.push({ name, data }); }; c._asked = []; c._confirm = (msg) => { c._asked.push(msg); return answers && answers.length ? answers.shift() : true; }; c._alert = (msg) => { c._asked.push('ALERT ' + msg); }; };
const threeParts = async (job) => { const j = await freshApp({ lenT: '48', mark: 'P-1', qty: 3, job }); j.addToJob(); j.pickFam('hss')(); j.setState({ lenT: '36', qty: 2, mark: 'H-1' }); j.addToJob(); j.pickFam('angl')(); j.setState({ lenT: '30', qty: 5, mark: 'A-1' }); j.addToJob(); return j; };
const csvFiles = (csv) => csv.trim().split('\n').slice(1).map((l) => { const m = /,"([^"]*(?:""[^"]*)*)"\s*$/.exec(l); return m ? m[1].replace(/""/g, '"') : ''; });
const snapshot = (dir) => JSON.stringify([...dir.files.entries()].map(([n, r]) => [n, r.data]).sort());
const MARK = /NOT READY/i;

// ------------------------------------------------------------------ 2. the cut list names only files that exist
{
  // the normal case: three parts, three files, and the cut list names exactly those three
  const j = await threeParts('3001'); const root = mkDir('Laser'); link(j, root);
  await j.dlJobFiles();
  const jd = root.dirs.get('JOB_3001'), names = [...jd.files.keys()].sort(), igs = names.filter((n) => /\.igs$/.test(n));
  const listed = csvFiles(jd.files.get('cut list.csv').data);
  ok(igs.length === 3 && listed.length === 3 && listed.every((n) => igs.includes(n)) && igs.every((n) => listed.includes(n)), 'whole job: the cut list names exactly the three files in the folder', listed.join(' | ') + ' // ' + igs.join(' | '));
  ok(!names.some((n) => MARK.test(n)) && j._dl.length === 0, 'whole job: no "not ready" marker left behind, nothing sent to Downloads', names.join(' | '));
  ok(jd.log.filter((n) => !/^-/.test(n) && !MARK.test(n)).pop() === 'cut list.csv', 'the cut list is written last, after every laser file', jd.log.join(' > '));

  // one part fails while its laser file is being made
  const mk = async (answers) => { const k = await threeParts('3002'); const r = mkDir('Laser'); link(k, r, answers); const real = k._solidFile.bind(k); k._solidFile = (o, m, kind) => { if (k.state.mark === 'H-1') throw new Error('IGES: a cut edge in the file could not be verified.'); return real(o, m, kind); }; return { k, r }; };
  { const { k, r } = await mk([false]);        // asked "save the other two without it?" -> No
    await k.dlJobFiles();
    const d2 = r.dirs.get('JOB_3002');
    ok((!d2 || d2.files.size === 0) && k._dl.length === 0, 'a part fails and the answer is No: nothing is written, nothing is downloaded', d2 ? [...d2.files.keys()].join(' | ') : 'no folder');
    ok(k._asked.length === 1 && /H-1/.test(k._asked[0]) && /could not be verified/.test(k._asked[0]), 'the question names the part that failed and why', (k._asked[0] || '').slice(0, 160));
    ok(k.state.saveOk === false && /H-1/.test(k.state.saveMsg) && /nothing/i.test(k.state.saveMsg), 'the save line says nothing was saved and names the part', k.state.saveMsg); }
  { const { k, r } = await mk([true]);         // -> Yes, release a part job
    await k.dlJobFiles();
    const d2 = r.dirs.get('JOB_3002'), names2 = [...d2.files.keys()].sort(), igs2 = names2.filter((n) => /\.igs$/.test(n)), csv = d2.files.get('cut list.csv').data, listed2 = csvFiles(csv);
    ok(igs2.length === 2 && !igs2.some((n) => /^H-1_/.test(n)), 'a part fails and the answer is Yes: the two good files are written', igs2.join(' | '));
    ok(listed2.filter((n) => /\.igs$/.test(n)).every((n) => igs2.includes(n)) && listed2.filter((n) => /\.igs$/.test(n)).length === 2, 'the cut list names no file that is not there', listed2.join(' | '));
    ok(listed2.some((n) => /^NOT SAVED/.test(n) && /could not be verified/.test(n)) && /"H-1"/.test(csv), 'the cut list says H-1 was not saved, and why', listed2.join(' | '));
    ok(/2 of 3/.test(k.state.saveMsg) && /H-1/.test(k.state.saveMsg), 'the save line says 2 of 3 and names the part left out', k.state.saveMsg); }
  // a part already red in the job list: the cut list has said NOT SAVED for it all along; it still does
  { const k = await threeParts('3003'); const r = mkDir('Laser'); link(k, r, [true]); k.setState((s) => ({ parts: s.parts.map((p, i) => (i === 2 ? { ...p, qty: null } : p)) }));
    await k.dlJobFiles();
    const d2 = r.dirs.get('JOB_3003'), listed3 = csvFiles(d2.files.get('cut list.csv').data), igs3 = [...d2.files.keys()].filter((n) => /\.igs$/.test(n));
    ok(igs3.length === 2 && listed3.filter((n) => /\.igs$/.test(n)).every((n) => igs3.includes(n)) && listed3.filter((n) => /^NOT SAVED/.test(n)).length === 1, 'a part with a blank quantity: left out, and the cut list says so', listed3.join(' | '));
    ok(k._asked.length === 0 && /2 of 3/.test(k.state.saveMsg) && k.state.saveOk === false, 'that part was already shown as left out on the check card, so there is no second question - and the save line still says 2 of 3', k._asked.length + ' ' + k.state.saveMsg);
    const rv = k.reviewInfo('job'); ok(rv.out === 1 && rv.n === 2, 'the check card had shown it as left out'); }
}

// ------------------------------------------------------------------ 3. all of a job, or none of it
{
  // a folder that already holds a good release of this job
  const prior = async (dir) => { const j0 = await threeParts('3010'); link(j0, dir); await j0.dlJobFiles(); return snapshot(dir.dirs.get('JOB_3010')); };
  const changed = async () => { const j = await threeParts('3010'); j.setState((s) => ({ parts: s.parts.map((p) => ({ ...p, qty: p.qty + 1 })) })); return j; };   // new quantities: new file names, new cut list

  // the second file will not write: everything is put back
  { const root = mkDir('Laser'); const before = await prior(root); const jd = root.dirs.get('JOB_3010'); let n = 0;
    jd.failOn = (name) => /\.igs$/.test(name) && ++n === 2;
    const j = await changed(); link(j, root);
    await j.dlJobFiles();
    ok(snapshot(jd) === before, 'second file will not write: the folder is exactly as it was before the save', [...jd.files.keys()].sort().join(' | '));
    ok(![...jd.files.keys()].some((x) => MARK.test(x)), 'and no "not ready" marker is left, because nothing changed');
    ok(j._dl.length === 1 && /\.zip$/.test(j._dl[0].name) && j.state.saveOk === false && /as it was/i.test(j.state.saveMsg), 'the whole job goes to Downloads as a zip and the save line says the folder was left as it was', j.state.saveMsg); }
  // the cut list will not write (the last step): same
  { const root = mkDir('Laser'); const before = await prior(root); const jd = root.dirs.get('JOB_3010'); let armed = false;
    const j = await changed(); link(j, root); jd.failOn = (name) => armed && name === 'cut list.csv'; armed = true;
    await j.dlJobFiles();
    ok(snapshot(jd) === before, 'cut list will not write: the folder is exactly as it was', [...jd.files.keys()].sort().join(' | ')); }
  // a file that reads back different from what was sent (cut short by a sync) counts as not written
  { const root = mkDir('Laser'); const before = await prior(root); const jd = root.dirs.get('JOB_3010'); let n = 0;
    const j = await changed(); link(j, root); jd.truncate = (name) => /\.igs$/.test(name) && ++n === 3;
    await j.dlJobFiles();
    ok(snapshot(jd) === before && j.state.saveOk === false, 'a file that reads back cut short: treated as a failed save, folder put back', j.state.saveMsg); }
  // the folder dies part way and cannot be put back: it is left MARKED not ready
  { const root = mkDir('Laser'); await prior(root); const jd = root.dirs.get('JOB_3010'); let n = 0;
    const j = await changed(); link(j, root); jd.dieAfterFail = true; jd.failOn = (name) => /\.igs$/.test(name) && ++n === 2;
    await j.dlJobFiles();
    ok([...jd.files.keys()].some((x) => MARK.test(x)), 'folder lost part way through and could not be put back: a NOT READY file is left in it', [...jd.files.keys()].sort().join(' | '));
    ok(j.state.saveOk === false && /NOT READY|do not cut/i.test(j.state.saveMsg) && j._dl.length === 1, 'the save line says not to cut from that folder, and the job is in Downloads', j.state.saveMsg); }
  // a later good save clears an old marker
  { const root = mkDir('Laser'); await prior(root); const jd = root.dirs.get('JOB_3010'); jd.files.set('NOT READY - save in progress - DO NOT CUT.txt', { data: 'x' });
    const j = await changed(); link(j, root); await j.dlJobFiles();
    ok(![...jd.files.keys()].some((x) => MARK.test(x)) && j.state.saveOk === true, 'a good save clears a NOT READY marker left by an earlier failed one', [...jd.files.keys()].sort().join(' | ')); }
  // single part into the folder still works, and a failed single write changes nothing
  { const root = mkDir('Laser'); const c = await freshApp({ lenT: '48', mark: 'P-1', qty: 4, job: '3011' }); link(c, root); await c.dlSolid('igs');
    const d1 = root.dirs.get('JOB_3011'); ok(d1 && d1.files.size === 1 && c.state.saveOk === true, 'one part: saved into the job folder', d1 ? [...d1.files.keys()].join(' | ') : '');
    const before = snapshot(d1); d1.failOn = () => true; c.setState({ qty: 4 }); await c.dlSolid('igs');
    ok(snapshot(d1) === before && c.state.saveOk === false, 'one part, folder refuses the write: the file already there is untouched', c.state.saveMsg); }
}

// ------------------------------------------------------------------ 4. the stick count
{
  const j = await freshApp({ lenT: '500', mark: 'LONG-1', qty: 1, job: '3020' }); j.addToJob();
  const key = j.state.parts[0].groupKey;
  j.setState({ stickSel: { [key]: '504' }, gripT: '6' });
  let n = j.nestGroups()[0];
  ok(n.unplaced.length === 1 && n.sticks === 0 && n.util === 0 && n.drop === 0, 'the case as reported: 500 in piece, 504 in stick, 6 in grip - not placed, no stick counted, no 100.4 %, no negative drop', JSON.stringify({ u: n.unplaced, s: n.sticks, util: n.util, drop: n.drop }));
  ok(n.unplaced[0].mark === 'LONG-1' && Math.abs(n.unplaced[0].len - 500) < 1e-9 && Math.abs(n.cap - 498) < 1e-9, 'the piece that will not fit is named, with the 498 in that is usable');
  const v = j.renderVals(); ok(v.nests[0].unplacedTxt && /LONG-1/.test(v.nests[0].unplacedTxt) && /498/.test(v.nests[0].unplacedTxt) && !/100\.4|-2/.test(v.nests[0].chip), 'job list: says which piece will not fit and why', v.nests[0].chip + ' // ' + v.nests[0].unplacedTxt);
  ok(/0 STICKS/.test(v.roSticks), 'job total: 0 sticks, not 1', v.roSticks);
  const rv = j.reviewInfo('job'); ok(rv.cautions.some((t) => /LONG-1/.test(t) && /will not fit/i.test(t)), 'job check card: warns before the job is released', rv.cautions.join(' | '));
  // on the form, before it ever reaches the job list
  const f = await freshApp({ lenT: '500', gripT: '6' }); ok(!f.blocked(f.calc()) && warns(f).some((t) => /grip/i.test(t) && /506/.test(t)), 'on the form: a 500 in piece carries a caution that it needs a 506 in stick with the 6 in grip', warns(f).join(' | '));
  const g = await freshApp({ lenT: '498', gripT: '6' }); ok(!warns(g).some((t) => /grip/i.test(t)), 'a 498 in piece: no such caution');
  // mixed group: the pieces that fit are nested, the one that does not is set aside
  const m = await freshApp({ lenT: '500', mark: 'LONG-1', qty: 1, job: '3021' }); m.addToJob(); m.setState({ lenT: '100', mark: 'S-1', qty: 4 }); m.addToJob();
  m.setState({ stickSel: { [m.state.parts[0].groupKey]: '504' }, gripT: '6' }); n = m.nestGroups()[0];
  ok(n.unplaced.length === 1 && n.placed === 4 && n.sticks === 1 && n.util > 0 && n.util <= 1 && n.drop >= 0, 'mixed: four 100 in pieces on one stick, the 500 in piece set aside, utilisation at or under 100 %', JSON.stringify({ s: n.sticks, util: +n.util.toFixed(3), drop: +n.drop.toFixed(2) }));
  // a stock length is offered that fits, when the user has not picked one
  const d = await freshApp({ lenT: '300', mark: 'M-1', qty: 2, job: '3022' }); d.addToJob(); n = d.nestGroups()[0];
  ok(n.stickIn === 480 && n.unplaced.length === 0 && n.sticks === 2, 'no stock picked and a 300 in piece: the list starts on 40 ft, not on a 24 ft stick it cannot come out of', JSON.stringify({ stick: n.stickIn, s: n.sticks }));
  ok(d.renderVals().nests[0].stick === '480', 'and the stock box shows 40 ft');
  const e = await freshApp({ lenT: '120', mark: 'M-2', qty: 2, job: '3023' }); e.addToJob(); ok(e.nestGroups()[0].stickIn === 288, 'no stock picked and 10 ft pieces: still 24 ft, as before');
  d.setState({ stickSel: { [d.state.parts[0].groupKey]: '288' } }); n = d.nestGroups()[0];
  ok(n.stickIn === 288 && n.unplaced.length === 2 && n.sticks === 0, 'a stock picked by hand is kept even when it is too short - and the pieces show as not placed', JSON.stringify({ stick: n.stickIn, u: n.unplaced.length }));
}

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log(fails.join('\n')); process.exit(1); }
