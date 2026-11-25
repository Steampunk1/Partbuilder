// Part Builder — input / human-error audit.
//
//   node test/bt-inputs.mjs [--strict] [--no-kernel] [--configs=300] [--solids=2] [--seed=20261125] [--json=FILE]
//
// The question this file asks: can a typo, an out-of-range value or a setting left over from the last
// part produce a valid-looking file with the wrong dimension, instead of a red message and no file?
//
//   GROUP A  "must hold today"  Recall codes and the job list give back the same part. File names are
//                               legal on Windows / OneDrive and two different parts never share one.
//                               An error is never hidden. Nothing invisible is left over from an
//                               earlier part. A FAILURE HERE IS A DEFECT and sets the exit code.
//
//   GROUP B  "should block"     Every place a bad entry is swallowed and replaced by a default, a clamp
//                               or a dropped value. Each check types the bad value the way the form
//                               does and asserts the part is then blocked (an error-level warning, so
//                               blocked(c) is true and no file can be written) - or, where a number was
//                               clearly meant (22 1/2), that it is read as that number. These are
//                               expected to fail at the baseline commit: they print as KNOWN GAP and
//                               do not count toward the exit code unless run with --strict.
//
// Last line:  "N passed, M failed, G known gaps".  Case tables live in bt-inputs-cases.mjs.
//
// Each check states the outcome a fabricator needs, not how to get there. Where a fix reaches the same
// outcome another way (for example the folder writer refusing to overwrite instead of the name changing,
// or a box greyed out instead of the part being blocked), change that one assertion with the fix.
// The kernel sections build about 30 solids (1-2 minutes); --no-kernel skips them.
import { writeFileSync } from 'node:fs';
import { fresh, freshApp, Component, DB } from './_load.mjs';
import { PARSER, PARSER_REJECTED_COMMON, FIELDS, rng, randomCfg, setEnd, setG } from './bt-inputs-cases.mjs';

const arg = (name, def) => { const a = process.argv.find((x) => x === '--' + name || x.startsWith('--' + name + '=')); return a === undefined ? def : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const STRICT = !!arg('strict', false), KERNEL = !arg('no-kernel', false), N_CFG = +arg('configs', 300), N_SOLID = +arg('solids', 2), SEED = +arg('seed', 20261125), JSON_OUT = arg('json', '');

// ------------------------------------------------------------------ bookkeeping
const results = { A: [], B: [], notes: [] };
let pass = 0, fail = 0, gaps = 0;
const short = (v, n = 150) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s == null ? '' : s.length > n ? s.slice(0, n) + '…' : s; };
/** Group A: must hold. */
function A(id, name, ok, detail) { results.A.push({ id, name, ok: !!ok, detail: ok ? undefined : short(detail, 400) }); if (ok) pass++; else fail++; }
/** Group B: should block. A miss is a known gap (a failure only with --strict). */
function B(id, name, ok, detail, meta) { results.B.push(Object.assign({ id, name, ok: !!ok, detail: short(detail, 300) }, meta || {})); if (ok) pass++; else if (STRICT) fail++; else gaps++; }
const note = (t) => results.notes.push(t);

// ------------------------------------------------------------------ helpers
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x);
const clone = (v) => JSON.parse(JSON.stringify(v));
const rnd = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x);
/** A form of one family as the app opens it. */
async function app(fam, patch) { const c = await freshApp(); if (fam && fam !== 'pipe') c.pickFam(fam)(); if (patch) c.setState(patch); return c; }
/** A form that already holds a quite different part: anything a recall fails to overwrite shows up. */
async function dirtyApp() {
  const c = await freshApp(); c.pickFam('beam')();
  c.setState({ lenT: '13', qty: 77, mark: 'DIRTY', heat: 'zz', mat: 'AL6061', bser: 'CUST', bsize: '', hwallT: '5/8', todT: '9', twallT: '1/2', pnps: '24', psch: '160', asize: '8x8', lenMode: 'wp', wantHoles: true });
  setEnd(c, 'A', { mode: 'ang', tpT: '33', tvT: '12', wantCope: true, rat: 'BOTH', sdRT: '40', maT: '61', mrT: '77' }); setEnd(c, 'B', { mode: 'ang', tpT: '-33', wantBevel: true });
  return c;
}
/** Everything occ-solid.js buildSolid() reads from calc(): two parts with the same key are the same solid. */
function solidKey(c) {
  const r = c.calc(); if (r.invalid) return 'INVALID';
  const rp = (a) => (a || []).map((p) => p.map(rnd)), s = r.sec;
  const en = (e) => (e ? { mode: e.mode, tanm: rnd(e.tanm), mr: rnd(e.mr), tanv: rnd(e.tanv), tanp: rnd(e.tanp), sd: e.mode === 'saddle' && e.sd ? [e.sd.Rs, rnd(e.sd.alpha), rnd(e.sd.roll)] : 0, ct: e.ct || 0, cb: e.cb || 0, rat: e.rat && e.rat !== 'NONE' ? [e.rat, rnd(e.rr)] : 0 } : 0);
  return JSON.stringify({ kind: r.kind, sec: [s.od, s.ro, s.ri, s.B, s.H, s.t, s.rc, s.a, s.b, s.d, s.bf, s.tf, s.tw, s.chan].map(rnd), L: rnd(r.L), LP: rnd(r.LP), A: en(r.A), B: en(r.B),
    cut: r.kind === 'round' ? [rnd(Math.min(...r.a)), rnd(Math.max(...r.b))] : 0, web: rp(r.web), tfO: rp(r.tfO), bfO: rp(r.bfO),
    holes: r.holes.filter((h) => h.ok).map((h) => [h.face, rnd(h.x), rnd(h.c), rnd(h.u), rnd(h.deg), rnd(h.dia), rnd(h.slotL), h.ax, rnd(h.rho), rnd(h.ro)]) });
}
/** Same solid to a ten-thousandth of an inch, holes in any order. A saved center-to-center part is
 *  re-stated end to end when it is loaded (same piece, numbers rounded to 0.00001), so the RECALL
 *  path is compared this way rather than digit for digit. */
function sameSolid(k1, k2) {
  if (k1 === k2) return true;
  if (k1 === 'INVALID' || k2 === 'INVALID') return false;
  const a = JSON.parse(k1), b = JSON.parse(k2);
  const ord = (o) => { o.holes = (o.holes || []).slice().sort((p, q) => String(p[0]).localeCompare(String(q[0])) || (p[1] - q[1]) || ((p[4] || 0) - (q[4] || 0)) || ((p[2] || 0) - (q[2] || 0))); return o; };
  const eq = (x, y) => { if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < 1e-4; if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => eq(v, y[i])); if (x && y && typeof x === 'object' && typeof y === 'object') { const kx = Object.keys(x), ky = Object.keys(y); return kx.length === ky.length && kx.every((k) => eq(x[k], y[k])); } return x === y; };
  return eq(ord(a), ord(b));
}
const errsOf = (r) => r.warns.filter((w) => w.lvl === 'err').map((w) => w.t);
const cautionsOf = (r) => r.warns.filter((w) => w.lvl !== 'err' && !/ONE wall/.test(w.t)).map((w) => w.t);
const igesBody = (t) => t.replace(/15H\d{8}\.\d{6}/g, '15H<time>');           // the only thing that differs between two writes of one solid
function unzip(u8) {                                                            // stored zip -> [{ name, text }]
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder(), out = []; let p = 0;
  while (p < u8.length - 4 && dv.getUint32(p, true) === 0x04034b50) { const n = dv.getUint16(p + 26, true), sz = dv.getUint32(p + 18, true); out.push({ name: dec.decode(u8.subarray(p + 30, p + 30 + n)), text: dec.decode(u8.subarray(p + 30 + n, p + 30 + n + sz)) }); p += 30 + n + sz; }
  return out;
}
// Windows + OneDrive file-name rules
const ILLEGAL = /["*:<>?/\\|\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
function nameProblems(name) {
  const p = [];
  if (ILLEGAL.test(name)) p.push('illegal character');
  if (/^[ .]/.test(name)) p.push('starts with a space or dot');
  if (/[ .]$/.test(name)) p.push('ends with a space or dot');
  if (RESERVED.test(name.split('.')[0].trim())) p.push('reserved device name ' + name.split('.')[0]);   // CON.anything is still the console on Windows 10
  if (name.startsWith('~$')) p.push('starts with ~$');
  if (name.toLowerCase() === 'desktop.ini' || name.toLowerCase() === '.lock' || /_vti_/i.test(name)) p.push('OneDrive reserved');
  return p;
}

/** A stand-in for the linked (OneDrive) folder: same calls the app makes on the File System Access API, kept in a Map.
 *  A write replaces a file of the same name; app.js _fsWrite never removes one. */
function fakeFolder() {
  const root = new Map();
  const dir = (m) => ({ getDirectoryHandle: async (n) => { if (!m.has(n)) m.set(n, new Map()); return dir(m.get(n)); }, getFileHandle: async (n) => ({ createWritable: async () => ({ write: async (t) => { m.set(n, typeof t === 'string' ? t : '<blob>'); }, close: async () => {} }) }),
    removeEntry: async (n) => { m.delete(n); }, keys: async function* () { yield* m.keys(); }, entries: async function* () { for (const [k, v] of m) yield [k, v instanceof Map ? Object.assign(dir(v), { kind: 'directory' }) : { kind: 'file', name: k }]; } });   // (unused by the app today; here so a fix that tidies the folder can run)
  return { handle: dir(root), files: () => [...root.values()].flatMap((m) => [...m.keys()]), text: (name) => { for (const m of root.values()) if (m.has(name)) return m.get(name); return null; } };
}
/** Link form c to a fake folder and give it a stand-in kernel whose "file" is just a fingerprint of the part - enough to see which part a name holds. */
function linkFolder(c) {
  const f = fakeFolder(); c._fsDir = f.handle; c.setState({ fsPerm: 'granted', fsName: 'LASER' });
  c._occ = async () => ({ oc: null, m: { buildSolid: (o, comp, r) => ({ K: { r, comp }, shape: null }), inspect: (K) => ({ valid: true, solids: 1, shells: 1, bbox: [[0, K.r.LP || K.r.OAL || K.r.L]] }), writeIges: (K) => 'PART ' + solidKey(K.comp) } });
  c._download = (text, name, mime, noFolderCopy) => (noFolderCopy ? null : c._fsWrite(name, text));       // app.js _download: browser download + folder copy
  return f;
}
const settle = () => new Promise((r) => setTimeout(r, 5));                       // the app does not wait for its folder writes

let oc = null, occm = null;
async function kernel(freshOne) { const { loadOcc } = await import('./_occ.mjs'); if (!occm) occm = await import('../occ-solid.js'); oc = await loadOcc(!!freshOne); return oc; }
/** The laser file of the part now on form c - or { err } when the app refuses to write one. */
async function laserFile(c) { try { const f = c._solidFile(oc, occm, 'igs'); return { name: f.laser || f.name, text: f.text }; } catch (e) { const blockedByApp = e instanceof Error; if (!blockedByApp) await kernel(true); return { err: blockedByApp ? e.message : 'kernel stopped (' + String(e).slice(0, 40) + ')' }; } }

// ====================================================================================================
// GROUP A — must hold today
// ====================================================================================================

// ---------- A1  recall codes and the job list give back the same part (seeded random valid parts) ----------
const R = rng(SEED), valid = [], everyCfg = [];
{
  let tries = 0;
  while (valid.length < N_CFG && tries < N_CFG * 20) { tries++; const cfg = randomCfg(R); everyCfg.push(cfg); const c = await freshApp(); c.setState(clone(cfg)); if (!c.blocked(c.calc())) valid.push(cfg); }
  const fams = {}; for (const v of valid) fams[v.family] = (fams[v.family] || 0) + 1;
  note('random valid parts: ' + valid.length + ' (seed ' + SEED + ', ' + tries + ' drawn) ' + JSON.stringify(fams));
  A('A1.0', 'the generator found ' + N_CFG + ' valid parts across all six families', valid.length === N_CFG && Object.keys(fams).length === 6, JSON.stringify(fams));
  const bad = { v2state: [], v1state: [], v2load: [], v1load: [], recall: [], job: [], meta: [] };
  for (let i = 0; i < valid.length; i++) {
    const cfg = valid[i], c = await freshApp(); c.setState(clone(cfg));
    const snap = c.snapshot(), key = solidKey(c), name = c.fileBase(), tag = '#' + i + ' ' + cfg.family + ' mark ' + JSON.stringify(cfg.mark);
    const code2 = c.encodeCfg(snap), code1 = c.encodeCfgV1(snap), v2 = c.decodeCfg(code2), v1 = c.decodeCfg(code1);
    if (canon(v2) !== canon(snap)) bad.v2state.push(tag + ' keys ' + Object.keys(snap).filter((k) => canon(v2 && v2[k]) !== canon(snap[k])));
    if (canon(v1) !== canon(snap)) bad.v1state.push(tag);
    for (const [which, d, code] of [['v2', v2, code2], ['v1', v1, code1]]) {
      const t = await dirtyApp(); t.setState(clone(d));                                  // decoded config over a different part
      if (solidKey(t) !== key || t.fileBase() !== name) bad[which + 'load'].push(tag);
      const t2 = await dirtyApp(); t2.setState({ recallT: code }); t2.renderVals().doRecall();   // the RECALL box itself
      if (!sameSolid(solidKey(t2), key) || t2.fileBase() !== name) bad.recall.push(tag + ' ' + which + ' ' + t2.fileBase() + ' vs ' + name);
      if (t2.state.mark !== snap.mark || t2.state.qty !== snap.qty || t2.state.mat !== snap.mat) bad.meta.push(tag + ' ' + which);
    }
    const nBefore = c.state.parts.length; c.addToJob(); const pt = c.state.parts[c.state.parts.length - 1];
    if (c.state.parts.length === nBefore) continue;   // the app now refuses a blank, over-long or repeated mark: nothing to compare
    const j = await dirtyApp(); j.setState({ parts: [clone(pt)] });
    const got = j._withPart(j.state.parts[0], () => ({ key: solidKey(j), name: j.fileBase(), qty: j.state.qty }));
    if (got.key !== key || got.name !== name || got.qty !== snap.qty || pt.qty !== snap.qty || pt.mark !== (snap.mark || '-') || Math.abs(pt.oal - c.calc().OAL) > 1e-9) bad.job.push(tag + ' ' + got.name + ' vs ' + name);
  }
  const n = valid.length;
  A('A1.1', 'SPFPB2 code (QR / RECALL box) decodes to the same form, every key (' + n + ' parts)', !bad.v2state.length, bad.v2state.slice(0, 3).join(' | '));
  A('A1.2', 'SPFPB1 code (job records, backups) decodes to the same form, every key (' + n + ' parts)', !bad.v1state.length, bad.v1state.slice(0, 3).join(' | '));
  A('A1.3', 'SPFPB2 loaded over a different part gives the same solid and file name (' + n + ' parts)', !bad.v2load.length, bad.v2load.slice(0, 3).join(' | '));
  A('A1.4', 'SPFPB1 loaded over a different part gives the same solid and file name (' + n + ' parts)', !bad.v1load.length, bad.v1load.slice(0, 3).join(' | '));
  A('A1.5', 'RECALL box, both code versions, over a different part: same solid and file name (' + n + ' parts)', !bad.recall.length, bad.recall.slice(0, 3).join(' | '));
  A('A1.6', 'RECALL box keeps mark, quantity and grade (' + n + ' parts)', !bad.meta.length, bad.meta.slice(0, 3).join(' | '));
  A('A1.7', 'Add to job list, then build from the job record: same solid, file name, quantity, mark, overall length (' + n + ' parts)', !bad.job.length, bad.job.slice(0, 3).join(' | '));
}

// ---------- A2  the laser files themselves: form == recalled == "Download all laser files" ----------
if (KERNEL) {
  await kernel();
  const picks = [], per = {};
  for (const cfg of valid) { if ((per[cfg.family] || 0) >= N_SOLID) continue; const c = await freshApp(); c.setState(clone(cfg)); if (c.calc().holes.length > 8) continue; per[cfg.family] = (per[cfg.family] || 0) + 1; picks.push(cfg); }
  const built = []; let refused = 0;
  for (const cfg of picks) {
    const c = await freshApp(); c.setState(clone(cfg));
    const f = await laserFile(c);
    if (f.err) { refused++; note('kernel refused a part the form calls valid (' + cfg.family + ' ' + cfg.lenT + '): ' + f.err); continue; }
    const t = await dirtyApp(); t.setState({ recallT: c.encodeCfg(c.snapshot()) }); t.renderVals().doRecall();
    const f2 = await laserFile(t);
    c.addToJob();
    built.push({ cfg, form: f, recall: f2, pt: clone(c.state.parts[c.state.parts.length - 1]), qty: c.state.parts[c.state.parts.length - 1].qty });   // (the form's own quantity goes back to 1 after a part is added)
  }
  A('A2.0', 'kernel built a laser file for every picked valid part (' + picks.length + ' parts, ' + N_SOLID + ' per family)', built.length === picks.length && refused === 0, refused + ' refused');
  const recallBad = built.filter((b) => b.recall.err || igesBody(b.recall.text) !== igesBody(b.form.text) || b.recall.name !== b.form.name);
  A('A2.1', 'IGES written after a RECALL is identical to the IGES of the original form (' + built.length + ' files)', !recallBad.length, recallBad.map((b) => b.cfg.family + ' ' + (b.recall.err || 'differs')).join(' | '));
  // whole job through "Download all laser files"
  const j = await dirtyApp(); j.setState({ parts: built.map((b) => b.pt), job: '22-104' });
  const formOf = (st) => canon(Object.assign({}, st, { saveMsg: '', saveOk: true }));   // the "Saved ..." status line is expected to change
  const before = formOf(j.state);
  j._occ = async () => ({ oc, m: occm }); let got = null; j._download = (blob, name) => { got = { blob, name }; };
  await j.dlJobFiles();
  A('A2.2', 'Download all laser files hands over one zip and leaves the form as it was', !!got && /^JOB-22-104 - laser files\.zip$/.test(got.name) && formOf(j.state) === before, got && got.name);
  const entries = got ? unzip(new Uint8Array(await got.blob.arrayBuffer())) : [];
  const used = {}, zipBad = [], nameBad = [];
  for (const b of built) {
    const want = j.jobFileName(b.pt, b.form.name, used), e = entries.find((x) => x.name === want);
    if (!e || igesBody(e.text) !== igesBody(b.form.text)) zipBad.push(b.cfg.family + ' ' + want + (e ? ' differs' : ' missing'));
    if (!want.endsWith(' - QTY ' + b.qty + '.igs') || !want.startsWith(b.form.name)) nameBad.push(want);
  }
  A('A2.3', 'every IGES in the job zip is identical to the IGES the form wrote for that part (' + built.length + ' files)', entries.length === built.length + 1 && !zipBad.length, zipBad.join(' | ') + ' entries ' + entries.length);
  A('A2.4', 'every job file name ends "- QTY n.igs" with the part\'s own quantity', !nameBad.length, nameBad.join(' | '));
  const csv = (entries.find((x) => x.name === 'cut list.csv') || {}).text || '';
  const rows = csv.trim().split('\n').slice(1), csvBad = built.filter((b, i) => !rows[i] || !rows[i].includes(',' + b.qty + ',') || !rows[i].includes('"' + j.ascii(b.pt.mark).replace(/"/g, '""') + '"') || !rows[i].includes(j.ascii(j.matRec.call({ D: j.D, state: { mat: b.cfg.mat } }).label)));
  A('A2.5', 'cut list in the zip has one row per part with its mark, quantity and grade', rows.length === built.length && !csvBad.length, csvBad.map((b) => b.pt.mark).join(' | ') + ' rows ' + rows.length);
  // A part the form calls "Ready to cut" must also come out of the kernel. Found by the random parts above:
  // an angle whose "seen from above" angle is negative (or compound) is measured by calc() at the leg
  // mid-thickness (app.js:816), the solid at its true corners - the lengths differ and the download is refused.
  const an = await app('angl', { lenT: '54' }); setEnd(an, 'A', { mode: 'ang', tvT: '0', tpT: '-30' });
  const fa = await laserFile(an);
  A('A2.6', 'angle 3x3x1/4, 54 in, End A mitered -30 seen from above: the form says "' + an.renderVals().stReady + '" and the laser file is written', !an.blocked(an.calc()) && !fa.err, 'download refused: ' + fa.err);
} else note('kernel sections skipped (--no-kernel)');

// ---------- A3  file names are legal on Windows and OneDrive ----------
const FAM_SAMPLES = [['pipe', {}], ['pipe', { pnps: '1 1/2', psch: 'STD' }], ['pipe', { pnps: '1/2', psch: '160' }], ['tube', {}], ['tube', { todT: '1 1/2', twallT: '.065' }], ['hss', {}], ['hss', { hsize: '2 1/2x1 1/2', hwallT: '3/16' }],
  ['beam', {}], ['beam', { bser: 'S', bsize: Object.keys(DB.S)[0] }], ['beam', { bser: 'CUST', bsize: '' }], ['chan', {}], ['chan', { cser: 'MC', csize: Object.keys(DB.MC)[0] }], ['angl', {}], ['angl', { asize: '2 1/2x2', athkT: '5/16' }]];
const MARKS = ['', ' ', 'P-1', 'P 1', 'p-1', 'B-1/A', 'B-1\\A', 'A:B', 'A*B', 'A?B', 'A<B>', 'A|B', 'TRUSS "A"', "O'Neil", 'A&B', 'P-1 ', ' P-1', 'P-1.', '.P-1', '..', '~$P-1', 'Ø-1', 'P-1\n2', 'P-1\t', '日本', 'CON', 'con', 'NUL', 'PRN', 'AUX', 'COM1', 'LPT1', 'CON.', 'NUL.1', 'AUX.2', 'COM1.A', 'lpt9.x', 'desktop.ini', '_vti_x'];
{
  const all = [];
  for (const [fam, p] of FAM_SAMPLES) for (const mark of MARKS) { const c = await app(fam, Object.assign({ lenT: "10'-6 3/8", mark, qty: 4 }, p)); const base = c.fileBase(); all.push({ fam, mark, base, single: base + ' - SOLID.igs', job: c.jobFileName({ qty: 4 }, base, {}) }); }
  const probs = (pred) => all.filter((x) => [x.single, x.job, x.base + '.dxf', x.base + '_ticket.html'].some((n) => nameProblems(n).some(pred))).map((x) => JSON.stringify(x.mark) + ' -> ' + x.single);
  const uniq = (a) => [...new Set(a)];
  let p;
  p = probs((q) => q === 'illegal character'); A('A3.1', 'no file name holds a character Windows or OneDrive refuses  " * : < > ? / \\ |  (' + all.length + ' names)', !p.length, uniq(p).slice(0, 4).join(' | '));
  p = probs((q) => /space or dot/.test(q)); A('A3.2', 'no file name starts or ends with a space or a dot', !p.length, uniq(p).slice(0, 4).join(' | '));
  p = probs((q) => /reserved device|OneDrive reserved/.test(q)); A('A3.3', 'no file name is a reserved name (CON, PRN, AUX, NUL, COM1, LPT1 - also "CON.anything")', !p.length, uniq(p).slice(0, 5).join(' | '));
  p = probs((q) => /~\$/.test(q)); A('A3.4', 'no file name starts with ~$', !p.length, uniq(p).slice(0, 4).join(' | '));
  const c = await app('hss', { hsize: '2 1/2x1 1/2', hwallT: '3/16', lenT: "10'-6 3/8", mark: 'M'.repeat(120), qty: 4 });
  const longName = c.jobFileName({ qty: 4 }, c.fileBase(), {});
  A('A3.5', 'a 120-character part mark still gives a file name of 150 characters or less (Windows path limit with the OneDrive folder in front)', longName.length <= 150, longName.length + ' characters');
  // job folder and zip names
  const folders = [];
  for (const job of ['', '22-104', '22-104.', 'A/B', ' 12 ', '.', '..', 'CON', 'job: "east"']) {
    const j = await freshApp({ job }); let seen = null;
    j._fsDir = { getDirectoryHandle: async (n) => { seen = n; return { getFileHandle: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) }) }; } };
    j.setState({ fsPerm: 'granted', fsName: 'LASER' }); await j._fsWrite('x.igs', 'x');
    folders.push({ job, folder: seen });
  }
  const fb = folders.filter((f) => !f.folder || nameProblems(f.folder).length);
  A('A3.6', 'the job folder made in the linked folder has a legal name for any job number typed', !fb.length, fb.map((f) => JSON.stringify(f.job) + ' -> ' + JSON.stringify(f.folder) + ' (' + nameProblems(f.folder || '').join(', ') + ')').join(' | '));
}

// ---------- A4  two different parts never share a file name ----------
{
  // (a) marks that differ only in characters the name strips
  const sets = [['P-1', 'P 1', 'P/1', 'P#1'], ['B-1/A', 'B-1 A'], ['G1', 'G-1', 'G.1', 'G_1'], ['P-1', 'p-1'], ['日本', ' ']];
  const clash = [];
  for (const set of sets) {
    const c = await app('pipe', { lenT: '60', mark: set[0] }); const taken = [];
    for (const mark of set) { c.setState({ mark }); if (c.markIssue()) continue; c.addToJob(); taken.push(mark); }   // refused marks never reach the job
    const names = c.state.parts.map((pt) => c._withPart(pt, () => c.laserBase().toLowerCase()));
    if (new Set(names).size !== names.length) clash.push(JSON.stringify(taken) + ' -> ' + [...new Set(names)].join(' , '));
  }
  A('A4.1', 'marks that differ only by a space, slash, # or letter case never end up as one file name: the second one is refused at the job list', !clash.length, clash.join(' | '));
  // (b) same mark, section and length - different cut
  const a = await app('pipe', { lenT: '60', mark: 'P-1' }), b = await app('pipe', { lenT: '60', mark: 'P-1', wantHoles: true }), d = await app('pipe', { lenT: '60', mark: 'P-1' }); setEnd(d, 'B', { mode: 'miter', maT: '30' });
  // what that does in the linked folder: plain pipe downloaded, then the same mark with a hole downloaded
  const s0 = await app('pipe', { lenT: '60', mark: 'P-1' }), f0 = linkFolder(s0);
  await s0.dlSolid('igs'); await settle(); const firstText = f0.text(f0.files()[0]);
  s0.setState({ wantHoles: true }); await s0.dlSolid('igs'); await settle();
  const replaced = f0.files().length === 1 && f0.text(f0.files()[0]) !== firstText;
  A('A4.2', 'one mark is one part: saving the same mark again with a different cut replaces its laser file (one file, the newest), it never leaves two', new Set([solidKey(a), solidKey(b), solidKey(d)]).size === 3 && replaced && f0.files().filter((n) => /\.igs$/.test(n)).length === 1, [a, b, d].map((x) => x.fileBase() + ' - SOLID.igs').join(' , ') + (replaced ? ' ; in the linked folder the second download silently replaced the first (' + f0.files().length + ' file left)' : ''));
  // (c) inside one job download
  const j = await app('pipe', { lenT: '60', mark: 'P-1', qty: 2 }); j.addToJob(); j.setState({ mark: 'p-1', wantHoles: true }); j.addToJob(); j.setState({ mark: 'P 1', wantHoles: false }); setEnd(j, 'A', { mode: 'miter', maT: '45' }); j.addToJob();
  const used = {}, names = j.state.parts.map((pt) => j._withPart(pt, () => j.jobFileName(pt, j.fileBase(), used)));
  A('A4.3', 'three parts marked P-1, p-1 and "P 1": only the first gets into the job, the other two are refused', j.state.parts.length === 1 && new Set(names).size === 1, names.join(' , '));
  { const legacy = await app('pipe', { lenT: '60', mark: 'P-1', qty: 2 }); legacy.addToJob(); legacy.setState((st) => ({ parts: st.parts.concat([Object.assign({}, st.parts[0], { id: 2, mark: 'p-1' }), Object.assign({}, st.parts[0], { id: 3, mark: 'P 1' })]) }));
    const u2 = {}, n2 = legacy.state.parts.map((pt) => legacy._withPart(pt, () => legacy.jobFileName(pt, legacy.laserBase(), u2)));
    A('A4.4', 'an older job that already holds three parts under one mark still gets three file names', new Set(n2).size === 3, n2.join(' , ')); }
  { // a part keeps its file name from one download to the next
    const s = await app('pipe', { lenT: '60', mark: 'P-1', qty: 2, job: '22-104' }), f = linkFolder(s);
    s.addToJob(); s.setState({ mark: 'P-1', wantHoles: true }); s.addToJob();                       // two different parts, both marked P-1
    await s.dlJobFiles(); await settle(); const holeFile = f.files().find((n) => /"holes":\[\[/.test(f.text(n))), plainFile = f.files().find((n) => n !== holeFile);
    s.renderVals().jobParts[0].del(); await s.dlJobFiles(); await settle();                          // the plain one is taken out of the job, files downloaded again
    const nowIn = f.text(plainFile);
    A('A4.9', 'two parts with one mark, the first is removed from the job, files downloaded again: the name that held the removed part is not re-used for the other part', nowIn == null || !/"holes":\[\[/.test(nowIn), JSON.stringify(plainFile) + ' now holds the part with the hole; ' + JSON.stringify(holeFile) + ' is still in the folder too');
  }
  // (d) the section text in the name tells sections apart
  const tn = {}; for (const w of ['.065', '.083', '.095', '.120', '.125', '.134']) { const t = await app('tube', { lenT: '60', todT: '2', twallT: w }); (tn[t.fileBase()] = tn[t.fileBase()] || []).push(w); }
  A('A4.5', 'round tube: six different walls give six different file names and cut-list descriptions', Object.keys(tn).length === 6, JSON.stringify(tn));
  const c1 = await app('beam', { bser: 'CUST', bsize: '', lenT: '60', cbT: '6', ctfT: '3/8' }), c2 = await app('beam', { bser: 'CUST', bsize: '', lenT: '60', cbT: '10', ctfT: '3/4' });
  A('A4.6', 'custom beam: two different flanges on the same depth give different file names', solidKey(c1) !== solidKey(c2) && c1.fileBase() !== c2.fileBase(), c1.fileBase() + ' , ' + c2.fileBase());
  c1.addToJob(); c2.setState({ parts: c1.state.parts, mark: 'B-2' }); c2.addToJob();
  A('A4.7', 'custom beam: two different sections are not nested on the same stick in the pull list', c2.nestGroups().length === 2, c2.nestGroups().map((n) => n.key + ' x' + n.pieces).join(' , '));
  // (e) what the name is built from
  const h = await app('hss', { hsize: '1x1', hwallT: '5/8', lenT: '60' });
  A('A4.8', 'the wall named in the file is the wall in the solid (1x1 tube picked with 5/8 wall)', Math.abs(h.calc().sec.t - .625) < 1e-9 || h.blocked(h.calc()) || !/5-8/.test(h.fileBase()), h.fileBase() + ' built with wall ' + h.calc().sec.t);
}

// ---------- A5  an error is never hidden: a skipped hole always blocks the export ----------
{
  let offenders = 0, seen = 0;
  for (const cfg of everyCfg) { const c = await freshApp(); c.setState(clone(cfg)); const r = c.calc(); if (r.holes.some((h) => h.ok === false)) { seen++; if (!c.blocked(r)) offenders++; } }
  A('A5.1', 'random parts: whenever a hole is skipped the part is blocked (' + seen + ' parts with a skipped hole)', offenders === 0, offenders + ' not blocked');
  // W12x26, 10 ft: web holes every 12 in, 1 in below the top flange. Nine fit and each earns a yellow
  // k-zone note; the tenth lands on the end. calc() keeps the first 8 warnings only (app.js:350).
  const c = await app('beam', { lenT: "10'-0", wantHoles: true });
  setG(c, { face: 'web', both: false, autoY: false, wref: 'tos', y0T: '1', nyT: '1', x0T: '12', pT: '12', nT: '10', xsT: '' });
  const r = c.calc(), skipped = r.holes.filter((h) => !h.ok).length;
  A('A5.2', 'beam, ten web holes of which the tenth runs off the end: the part is blocked', skipped >= 1 && c.blocked(r), 'asked ' + r.holes.length + ', skipped ' + skipped + ', blocked ' + c.blocked(r) + ', errors shown ' + errsOf(r).length + ', warnings shown ' + r.warns.length + ', status "' + c.renderVals().stReady + '"');
  if (KERNEL) {
    const f = await laserFile(c);
    const nine = await app('beam', { lenT: "10'-0", wantHoles: true }); setG(nine, { face: 'web', both: false, autoY: false, wref: 'tos', y0T: '1', nyT: '1', x0T: '12', pT: '12', nT: '9', xsT: '' });
    const g = f.err ? null : await laserFile(nine);
    A('A5.3', 'kernel: no laser file is written for that part (today a 9-hole file is written under the 10-hole request)', !!f.err, f.err ? '' : 'file ' + f.name + ' written; identical to the 9-hole part: ' + (g && !g.err && igesBody(g.text) === igesBody(f.text)));
  }
}

// ---------- A6  nothing invisible is left over from an earlier part ----------
{
  // NEW JOB
  const c = await app('beam', { lenT: '77', qty: 9, mark: 'ZZ-4', job: 'J1' }); setEnd(c, 'A', { mode: 'ang', tpT: '20' }); setEnd(c, 'B', { wantCope: true, rat: 'BOTH' }); c.setState({ wantHoles: true }); c.addToJob(); c.renderVals().jobParts[0].load(); c.renderVals().newJob();
  const f0 = await freshApp();
  A('A6.1', 'Finish & new job puts every part setting back to the factory part', canon(c.snapshot()) === canon(f0.snapshot()) && c.state.parts.length === 0 && c.state.editId === null && c.state.job === '', '');
  // another shape and back
  const diffs = [];
  for (const [f1, f2] of [['pipe', 'beam'], ['beam', 'pipe'], ['hss', 'angl'], ['chan', 'hss'], ['angl', 'beam']]) {
    const x = await app(f1, { lenT: '77' });
    if (f1 === 'pipe') { setEnd(x, 'A', { mode: 'saddle', sdRT: '15', sdAT: '60', sdSeat: 'thru' }); setEnd(x, 'B', { mode: 'miter', maT: '33', mrT: '90' }); }
    else { setEnd(x, 'A', { mode: 'ang', tpT: '20', tvT: '10', wantCope: true, ct: true, cb: true, tcT: '5', rat: 'BOTH', rrT: '1' }); setEnd(x, 'B', { mode: 'ang', tpT: '-20', tvT: '5' }); }
    x.setState({ wantHoles: true }); setG(x, { xsT: '5, 9', both: true, nT: '7' });
    x.pickFam(f2)(); x.pickFam(f1)();
    const y = await app(f1, { lenT: '77' });
    if (solidKey(x) !== solidKey(y) || x.fileBase() !== y.fileBase()) diffs.push(f1 + '>' + f2 + '>' + f1);
  }
  A('A6.2', 'pick another shape and come back: the part on the form is the same solid as a fresh form of that shape', !diffs.length, diffs.join(' , '));
  // ...but tapping the same button again brings hidden values back
  const s1 = await app('pipe', { lenT: '48' }); s1.renderVals().endSteps[0].mSaddle(); setEnd(s1, 'A', { sdRT: '30' }); s1.addToJob();
  s1.pickFam('hss')(); s1.pickFam('pipe')(); s1.setState({ lenT: '48' }); s1.renderVals().endSteps[0].mSaddle();
  const s2 = await app('pipe', { lenT: '48' }); s2.renderVals().endSteps[0].mSaddle();
  A('A6.3', 'saddle rolled 30 on one part, another shape, back to pipe, tap Saddle: same cut as Saddle on a fresh form (the Roll box is inside a closed "Odd size or rolled")', solidKey(s1) === solidKey(s2), 'form shows "' + s1.renderVals().endASpec + '" , fresh shows "' + s2.renderVals().endASpec + '"');
  const b1 = await app('beam', { lenT: '60' }); b1.renderVals().endSteps[0].tgCope(); setEnd(b1, 'A', { rat: 'BOTH', rrT: '1', ct: false }); b1.addToJob();
  b1.pickFam('chan')(); b1.pickFam('beam')(); b1.setState({ lenT: '60' }); b1.renderVals().endSteps[0].tgCope();
  const b2 = await app('beam', { lenT: '60' }); b2.renderVals().endSteps[0].tgCope();
  A('A6.4', 'beam with weld-access holes, another shape, back to beam, tap Cope: same cut as Cope on a fresh form (the access-hole boxes are inside a closed section)', solidKey(b1) === solidKey(b2), 'form shows "' + b1.renderVals().endASpec + '" , fresh shows "' + b2.renderVals().endASpec + '"');
  // RECALL while a job part is open for editing
  const e = await app('pipe', { lenT: '48' }); e.addToJob(); e.setState({ lenT: '30' }); e.addToJob();
  const orig = canon(e.state.parts[0]);
  e.renderVals().jobParts[0].load();
  const other = await app('hss', { lenT: '99', mark: 'H-9' }); e.setState({ recallT: other.encodeCfg(other.snapshot()) }); e.renderVals().doRecall(); e.addToJob();
  A('A6.5', 'open job part P-1 to edit, RECALL a different part, press the save button: P-1 is still in the job as it was', e.state.parts.some((p) => canon(p) === orig), 'job is now ' + e.state.parts.map((p) => p.mark + ' ' + p.desc.split(' · ')[1] + ' ' + p.lenT2).join(' , '));
  // open to edit, save, nothing touched
  const k = await fresh({ lenT: '48', heat: 'HT-7781', qty: 3 }); setEnd(k, 'B', { wantBevel: true, bvT: '37.5' }); k.addToJob();
  const cfgBefore = k.cfgFromPart(k.state.parts[0]), noteBefore = k._withPart(k.state.parts[0], () => k.headerNote());
  k.renderVals().jobParts[0].load(); k.addToJob();
  const cfgAfter = k.cfgFromPart(k.state.parts[0]), noteAfter = k._withPart(k.state.parts[0], () => k.headerNote());
  const lost = Object.keys(cfgBefore).filter((key) => key !== 'lenMode' && canon(cfgBefore[key]) !== canon(cfgAfter[key]));
  A('A6.6', 'open a job part to edit and save it untouched: the stored part is unchanged', !lost.length && noteBefore === noteAfter, 'changed: ' + lost.map((key) => key + ' ' + short(cfgBefore[key], 60) + ' -> ' + short(cfgAfter[key], 60)).join(' ; ') + (noteBefore !== noteAfter ? ' ; ticket line lost "' + noteBefore.split(' | ').filter((x) => !noteAfter.includes(x)).join(' | ') + '"' : ''));
}

// ---------- A7  the same typed numbers give the same part, whatever was on the form before ----------
{
  const typeIt = (c) => { c.setState({ lenT: '48', wantHoles: true, groups: [Object.assign(Component.defGroup(1, 'pipe'), { x0T: '12', refEnd: 'A', azT: '0' })] }); setEnd(c, 'A', { mode: 'miter', maT: '45', mrT: '0' }); setEnd(c, 'B', { mode: 'sq' }); };
  const seeIt = (c) => { const r = c.calc(); return { LP: rnd(r.LP), hole: rnd(r.holes[0].x - r.aMin), file: c.fileBase(), blocked: c.blocked(r) }; };
  const a = await freshApp(); typeIt(a); const want = seeIt(a);
  A('A7.0', 'fresh form: 48 with a 45 miter at End A and a hole 12 from End A is 48 overall, hole 12 from the long point', want.LP === 48 && want.hole === 12 && !want.blocked, JSON.stringify(want));
  // an older center-to-center part (code without lenMode) comes in first
  const old = await fresh({ lenT: '30' }); setEnd(old, 'B', { mode: 'miter', maT: '30' });
  const cfgOld = old.snapshot(); delete cfgOld.lenMode; const codeOld = old.encodeCfgV1(cfgOld);
  const same = (g) => g.blocked || (g.LP === want.LP && g.hole === want.hole);
  const b = await freshApp(); b.setState({ recallT: codeOld }); b.renderVals().doRecall(); typeIt(b); const gb = seeIt(b);
  A('A7.1', 'RECALL an older mitered part, then type the same numbers: same part as the fresh form (or blocked until the length mode is settled)', same(gb), 'got ' + JSON.stringify(gb) + ' want ' + JSON.stringify(want));
  const d = await freshApp(); d.setState({ recallT: codeOld }); d.renderVals().doRecall(); setEnd(d, 'B', { mode: 'sq' });
  const hiddenNote = d.renderVals().hasLenNote; typeIt(d); const gd = seeIt(d);
  A('A7.2', 'same, with both ends set square in between (the "older part" note is then off the screen): same part as the fresh form', same(gd), 'note visible while square: ' + hiddenNote + ' ; got ' + JSON.stringify(gd));
  const e = await freshApp(); e.setState({ parts: [{ id: 1, code: 'SPF-OLD1', mark: 'P-7', desc: 'x', lenT2: 'x', oal: old.calc().OAL, wt: 10, qty: 1, cat: 'carbon', groupKey: 'k', groupLabel: 'l', payload: codeOld }] });
  e.renderVals().jobParts[0].load(); e.renderVals().cancelEdit(); typeIt(e); const ge = seeIt(e);
  A('A7.3', 'open an older job part, press Stop editing, then type the same numbers: same part as the fresh form', same(ge), 'got ' + JSON.stringify(ge));
  // a job record whose stored overall length matches neither reading of its code
  const o = await freshApp({ lenT: '48' }); setEnd(o, 'B', { mode: 'miter', maT: '45' }); const cfgO = o.snapshot(); delete cfgO.lenMode;
  const j = await freshApp(), pt = { payload: o.encodeCfgV1(cfgO), oal: 48.02, qty: 1, mark: 'P-1' };
  let builtLen = null, refusedMsg = ''; try { builtLen = j._withPart(pt, () => (j.blocked(j.calc()) ? null : j.calc().LP)); } catch (er) { refusedMsg = er.message; }
  A('A7.4', 'old job record (no length mode saved) listed at 48.02 overall: it is built at the listed length or refused, never at another length', builtLen == null || Math.abs(builtLen - pt.oal) < 1 / 16, 'job list says ' + pt.oal + ', file would be ' + rnd(builtLen) + ' long');
}

// ---------- A8  a saved part does not depend on what happens to be on the form ----------
{
  const src = await app('hss', { lenT: '36', hwallT: '3/8' });
  const partial = src.snapshot(); delete partial.hwallT; delete partial.lenT;            // a record written by a build that did not have these keys yet
  const code = src.encodeCfgV1(partial), pt = { payload: code, oal: 36, qty: 1, mark: 'H-1' };
  const k = await app('hss', { hwallT: '1/8', lenT: '99' }); const s1 = k._withPart(pt, () => solidKey(k));
  k.setState({ hwallT: '1/2', lenT: '20' }); const s2 = k._withPart(pt, () => solidKey(k));
  A('A8.1', 'job record missing two keys (written by another build): Download all laser files builds the same solid whatever is on the form', s1 === s2, 'two different solids from one record');
  const r1 = await app('hss', { hwallT: '1/8', lenT: '99' }); r1.setState({ recallT: code }); r1.renderVals().doRecall();
  const r2 = await freshApp(); r2.setState({ recallT: code }); r2.renderVals().doRecall();
  A('A8.2', 'the same code in the RECALL box gives the same part on two different forms', solidKey(r1) === solidKey(r2), r1.fileBase() + ' vs ' + r2.fileBase());
}

// ====================================================================================================
// GROUP B — should block
// ====================================================================================================

// ---------- B1  every typed or selected value that reaches the cut ----------
const inventory = [];
for (const F of FIELDS) {
  const mk = async () => { const c = await app(F.fam); F.prep(c); return c; };
  const ctl = await mk(); F.set(ctl, F.good); const rc = ctl.calc();
  A('B1.' + F.id + '.control', F.label + ': good value ' + JSON.stringify(F.good) + ' is a valid part with nothing flagged', !ctl.blocked(rc) && !cautionsOf(rc).length, errsOf(rc).concat(cautionsOf(rc)).join(' | '));
  const goodSee = (() => { try { return F.see(rc, ctl); } catch (e) { return '?'; } })();
  const row = { id: F.id, key: F.key, label: F.label, ui: F.ui, family: F.fam, where: F.where, risk: F.risk, bites: F.bites, rule: F.rule, good: F.good, goodUses: goodSee, cases: [] };
  for (const [v, why, want] of F.bad) {
    const c = await mk(); let r, used, threw = '';
    try { F.set(c, v); r = c.calc(); used = F.see(r, c); } catch (e) { threw = e.message; }
    const blocked = !threw && c.blocked(r);
    const readAsMeant = !threw && want != null && (typeof want === 'string' ? String(used).replace(/\s/g, '') === want : typeof used === 'number' ? Math.abs(used - want) < 1e-9 : String(used).split(',').every((x) => Math.abs(parseFloat(x) - want) < 1e-9));
    const cls = threw ? 'CRASHES' : blocked ? 'BLOCKS' : cautionsOf(r).length ? 'WARNS' : 'SILENT';
    row.cases.push({ typed: v, why, meant: want == null ? null : want, uses: threw ? 'calc() throws: ' + threw : used, class: cls, message: blocked ? errsOf(r)[0] : cautionsOf(r || { warns: [] })[0] || '' });
    B('B1.' + F.id, F.label + ': ' + JSON.stringify(v) + ' (' + why + ')', blocked || readAsMeant,
      threw ? 'calc() throws: ' + threw : cls + ' - the cut uses ' + short(used, 60) + (want != null ? ', meant ' + want : '') + (cls === 'WARNS' ? ' ; yellow note only: ' + cautionsOf(r)[0] : ''), { field: F.key, typed: v, class: cls, risk: F.risk, where: F.where });
  }
  inventory.push(row);
}

// ---------- B2  the length parser ----------
const parserTable = [];
{
  const c = await freshApp();
  for (const [s, mean, why] of PARSER) {
    const v = c.parseIn(s), okRead = mean != null && v != null && Math.abs(v - mean) < 1e-9, okRefused = v == null;
    const cls = okRead ? 'reads right' : (v == null ? (mean == null ? 'refused (right)' : 'refused (annoying, safe)') : 'WRONG NUMBER, NO ERROR');
    parserTable.push({ typed: s, parsed: v, meant: mean, class: cls, note: why || '' });
    if (cls === 'WRONG NUMBER, NO ERROR') B('B2.parse', 'parseIn(' + JSON.stringify(s) + ') must be refused or read as ' + (mean == null ? 'nothing' : mean) + (why ? ' - ' + why : ''), false, 'reads ' + rnd(v) + ' in (' + c.fmtFtIn(v) + ')', { field: 'parseIn', typed: s, class: 'SILENT', risk: 'high', where: 'app.js:77-106' });
    else if (okRead || (okRefused && mean == null)) A('B2.parse.ok', 'parseIn(' + JSON.stringify(s) + ') ' + (okRead ? '= ' + mean : 'is refused'), true);
    else note('parseIn(' + JSON.stringify(s) + ') is refused; a fabricator means ' + mean);
  }
  for (const [s, mean, why] of PARSER_REJECTED_COMMON) {
    const v = c.parseIn(s), right = v != null && Math.abs(v - mean) < 1e-9;
    parserTable.push({ typed: s, parsed: v, meant: mean, class: right ? 'reads right' : v == null ? 'refused (annoying, safe)' : 'WRONG NUMBER, NO ERROR', note: why || '' });
    if (v != null && !right) B('B2.parse', 'parseIn(' + JSON.stringify(s) + ') must be refused or read as ' + mean, false, 'reads ' + rnd(v), { field: 'parseIn', typed: s, class: 'SILENT', risk: 'high', where: 'app.js:77-106' });
  }
}

// ---------- B3  traps that are not a typed number ----------
{
  // the "At" drop-down says Both ends while the exact-spots list (inside closed More options) cuts one end only
  const c = await app('beam', { lenT: '60' }); c.renderVals().recipes[0].go();                       // Web bolts - both ends
  c.renderVals().groups[0].sXs({ target: { value: '2, 5' } });
  const v = c.renderVals(), xsNow = [...new Set(c.calc().holes.map((h) => h.x))], mirrored = xsNow.some((x) => x > 30);
  B('B3.both-ends', 'beam hole group: when the "At" box shows Both ends, holes are cut at both ends (or the part is blocked)', v.groups[0].endSel !== 'AB' || mirrored || c.blocked(c.calc()), 'box shows ' + v.groups[0].endSel + ', holes only at x = ' + xsNow.join(', ') + ' on a 60 in beam', { field: 'groups[].both + xsT', class: 'SILENT', risk: 'high', where: 'app.js:215, 2489' });
  const before = canon(c.calc().holes.map((h) => h.x));
  c.renderVals().groups[0].sX0({ target: { value: '10' } });
  B('B3.list-overrides', 'beam hole group: typing a new "In from the end" moves the holes (or the box is blocked/flagged while Exact spots is in use)', canon(c.calc().holes.map((h) => h.x)) !== before || c.blocked(c.calc()), 'typed 10 in the visible box, holes stay at ' + xsNow.join(', ') + ' - the Exact spots list is inside closed More options', { field: 'groups[].xsT', class: 'SILENT', risk: 'high', where: 'app.js:204-214' });
  // a setting with no control on the form
  const d = await freshApp({ lenT: '48', dxfRef: true }); const linesOn = (d._dxfText().match(/\nLINE\n/g) || []).length; d.renderVals().newJob();
  B('B3.dxf-ref', 'Flat DXF "reference lines and labels" setting (no control on this form, restored from the browser store): Finish & new job turns it off', d.state.dxfRef === false, 'still on after a new job; the flat DXF then carries ' + linesOn + ' extra LINEs and as many TEXTs for a CAM that cuts every line', { field: 'dxfRef', class: 'SILENT', risk: 'medium', where: 'app.js:67, 1478, 1950' });
  // linked folder: a write that fails says nothing
  const j = await freshApp({ lenT: '48' });
  j._fsDir = { getDirectoryHandle: async () => ({ getFileHandle: async () => { throw new Error('file is open in another program'); } }) }; j.setState({ fsPerm: 'granted', fsName: 'LASER', archMsg: '' });
  j._download = () => {};
  const rr = await j._deliver('P-1_6-SCH-40_48in - QTY 1.igs', 'x', 'model/iges'); await j._saved(['P-1_6-SCH-40_48in - QTY 1.igs'], rr, ['P-1']);
  const wrote = rr.to === 'folder';
  B('B3.folder-write', 'linked folder: when a file cannot be written (open in TubesT, OneDrive lock) the form says so', wrote === false && !j.state.saveOk && /Could not write/.test(j.state.saveMsg), 'write failed, message on screen: ' + JSON.stringify(j.state.archMsg) + ' - the old file with the same name stays in the folder', { field: 'linked folder', class: 'SILENT', risk: 'high', where: 'app.js:1526-1541, 1753, 1820' });
  // linked folder: a changed part leaves its old file behind under a name that looks current
  { const s = await app('pipe', { lenT: '60', mark: 'P-1', qty: 4, job: '22-104' }), f = linkFolder(s); s.addToJob(); await s.dlJobFiles(); await settle();
    s.renderVals().jobParts[0].sQty({ target: { value: '6' } }); await s.dlJobFiles(); await settle();
    B('B3.stale-qty', 'linked folder: job part P-1 changed from 4 to 6 pieces and downloaded again - one laser file for P-1 in the folder', f.files().filter((n) => /\.igs$/.test(n)).length === 1, f.files().join('  +  '), { field: 'qty', class: 'SILENT', risk: 'high', where: 'app.js:1729-1734, 1753' });
    const t = await app('pipe', { lenT: '60', mark: 'P-1', qty: 4, job: '22-104' }), g2 = linkFolder(t); t.addToJob(); await t.dlJobFiles(); await settle();
    t.renderVals().jobParts[0].load(); t.setState({ lenT: '59 1/2' }); t.addToJob(); await t.dlJobFiles(); await settle();
    B('B3.stale-length', 'linked folder: job part P-1 shortened from 60 to 59 1/2 and downloaded again - one laser file for P-1 in the folder', g2.files().filter((n) => /\.igs$/.test(n)).length === 1, g2.files().join('  +  '), { field: 'lenT', class: 'SILENT', risk: 'high', where: 'app.js:1054-1057, 1753' });
    const u = await app('pipe', { lenT: '60', mark: 'P-1', qty: 2, job: '22-104' }), g3 = linkFolder(u); await u.dlSolid('igs'); u.addToJob(); await u.dlJobFiles(); await settle();
    B('B3.stale-single', 'linked folder: a part downloaded on its own and then with the job is one laser file, not two', g3.files().filter((n) => /\.igs$/.test(n)).length === 1, g3.files().join('  +  '), { field: 'file name', class: 'SILENT', risk: 'medium', where: 'app.js:1697, 1729-1734' });
  }
  // what the operator can read off the file
  // (the "Download for the laser" button itself, with a stand-in for the kernel so only the name is exercised)
  const p = await freshApp({ lenT: '48', qty: 12, mat: '304L' }); let single = '';
  p._occ = async () => ({ oc: null, m: { buildSolid: () => ({ K: null, shape: null }), inspect: () => ({ valid: true, solids: 1, shells: 1, bbox: [[0, p.calc().LP]] }), writeIges: () => 'x' } });
  p._download = (text, name) => { single = name; }; await p.dlSolid('igs');
  const extra = single.replace('P-1_6-SCH-40_48in', '');
  B('B3.name-qty', 'single-part laser file: the quantity typed next to the mark is in the file name', /12/.test(extra), JSON.stringify(single) + ' for a quantity of 12', { field: 'qty', class: 'SILENT', risk: 'medium', where: 'app.js:1054-1057, 1697' });
  B('B3.name-grade', 'laser file name carries the grade (304L and A106-B pipe of one size are the same file name today)', /304/.test(single), JSON.stringify(single) + ' for 304L', { field: 'mat', class: 'SILENT', risk: 'medium', where: 'app.js:1054-1057' });
  const tk = await freshApp({ lenT: '48', heat: 'HT-7781' });
  B('B3.heat', 'heat number: it is in the saved code, so it reaches the cut ticket', /HT-7781/.test(tk._ticketHtml() || ''), 'not on the ticket, the cut list or any file; there is no box for it on the form', { field: 'heat', class: 'SILENT', risk: 'low', where: 'app.js:28, 1558, 1713' });
  // quantity
  const q = await freshApp(); q.setState({ qty: 5 }); q.renderVals().onQty({ target: { value: '2.5' } }); const q1 = q.state.qty; q.setState({ qty: 5 }); q.renderVals().onQty({ target: { value: '12 ea' } }); const q2 = q.state.qty;
  B('B3.qty-fraction', 'quantity 2.5 is refused, not rounded', q1 !== 3 && q1 !== 2, 'becomes ' + q1, { field: 'qty', typed: '2.5', class: 'SILENT', risk: 'medium', where: 'app.js:2728, 2566' });
  B('B3.qty-junk', 'quantity "12 ea" is read as 12 or refused, not turned into 1', q2 === 12 || q2 === 5 || (typeof q2 !== 'number' && !!q.qtyIssue()), 'becomes ' + q2, { field: 'qty', typed: '12 ea', class: 'SILENT', risk: 'medium', where: 'app.js:2728, 2566' });
  // grade
  const m = await freshApp(); m.setState({ mat: 'A53-B' });
  B('B3.grade-unknown', 'a grade the list does not have (older code) blocks the part instead of becoming the first grade in the list', m.blocked(m.calc()), 'shown and listed as ' + m.matRec().label, { field: 'mat', typed: 'A53-B', class: 'SILENT', risk: 'medium', where: 'app.js:228' });
  const g = await freshApp(); g.setState({ mat: '304L' }); g.pickFam('pipe')();
  B('B3.grade-reset', 'tapping the shape button that is already selected leaves the grade alone', g.state.mat === '304L', '304L became ' + g.state.mat, { field: 'mat', class: 'SILENT', risk: 'medium', where: 'app.js:2313, 2337' });
  // header program (the separate DXF of every branch opening in a header)
  const hp = await freshApp();
  const hdr = (b) => { hp.setState({ hdrB: { nps: '10', sch: '40', seat: 'on', hid: 9, list: [Object.assign({ id: 1, nps: '2', sch: '40', alphaT: '60', azT: '90', distT: '12' }, b)] } }); const h = hp.hdrBranchCurves(); return h ? { warned: h.warns.length > 0, cut: h.curves.length, az: h.curves[0] && h.curves[0].az, len: h.curves[0] && rnd(h.curves[0].x1 - h.curves[0].x0) } : { warned: false, cut: 0 }; };
  const hGood = hdr({});
  A('B3.header.control', 'header program: one 2 in branch at 60 deg, 90 deg round, 12 in along is cut with nothing flagged', hGood.cut === 1 && !hGood.warned, JSON.stringify(hGood));
  for (const [id, b, why, meant] of [['alpha-junk', { alphaT: 'abc' }, 'angle that will not read is cut as a 90 tee', null], ['alpha-low', { alphaT: '15' }, 'angle 15 is cut at 20', null], ['alpha-fraction', { alphaT: '22 1/2' }, 'angle 22 1/2 is cut at 22', { alphaT: '22.5' }], ['az-junk', { azT: 'abc' }, 'clock position that will not read is cut on top (0)', null], ['dist-neg', { distT: '-5' }, 'negative distance along the header is accepted', null]]) {
    const h = hdr(b), asMeant = meant ? hdr(meant) : null;
    B('B3.header.' + id, 'header program: ' + why + ' - the branch must be flagged' + (meant ? ' or read as ' + Object.values(meant)[0] : '') + ', not cut as it is', h.warned || h.cut === 0 || (asMeant && asMeant.len === h.len && asMeant.az === h.az), 'cut ' + h.cut + ' opening, ' + rnd(h.len) + ' long at ' + h.az + ' deg, nothing flagged', { field: 'hdrB.list[].' + Object.keys(b)[0], typed: Object.values(b)[0], class: 'SILENT', risk: 'medium', where: 'app.js:2127-2129' });
  }
}

// ====================================================================================================
const failed = results.A.filter((x) => !x.ok).concat(STRICT ? results.B.filter((x) => !x.ok) : []);
const known = STRICT ? [] : results.B.filter((x) => !x.ok);
if (results.notes.length) console.log('NOTES\n  ' + results.notes.join('\n  '));
if (known.length) console.log('\nKNOWN GAP (group B - should block, does not)\n  ' + known.map((x) => 'KNOWN GAP  ' + x.id + '  ' + x.name + '  [' + x.detail + ']').join('\n  '));
if (failed.length) console.log('\nFAILED (' + (STRICT ? 'group A defects and group B gaps' : 'group A - defects') + ')\n  ' + failed.map((x) => 'FAIL  ' + x.id + '  ' + x.name + (x.detail ? '  [' + x.detail + ']' : '')).join('\n  '));
console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + gaps + ' known gaps');
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ suite: 'test/bt-inputs.mjs', args: { strict: STRICT, kernel: KERNEL, configs: N_CFG, solids: N_SOLID, seed: SEED }, summary: { passed: pass, failed: fail, knownGaps: gaps },
    groupA: results.A, groupB: results.B, inventory, parser: parserTable, notes: results.notes }, null, 1));
  console.log('results written to ' + JSON_OUT);
}
process.exit(fail ? 1 : 0);
