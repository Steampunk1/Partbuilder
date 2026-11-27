// The flat drawing's layout: labels are a fixed size on screen and sit in a margin beside the part, never
// on it, whatever the length of the part and whatever the size of the screen.
// Run:  node test/layout.mjs
import { freshApp } from './_load.mjs';

let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; if (fails.length < 40) fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); } };
const setEnd = (c, id, p) => c.setState({ ends: { ...c.state.ends, [id]: { ...c.state.ends[id], ...p } } });
const PX = 11, SUB = 9;

const parts = [
  ['pipe 12 in', (c) => c.setState({ lenT: '12' })],
  ['pipe 10 ft', (c) => c.setState({ lenT: "10'" })],
  ['pipe 42 ft', (c) => c.setState({ lenT: "42'" })],
  ['pipe 20 ft mitred', (c) => { c.setState({ lenT: "20'" }); setEnd(c, 'A', { mode: 'miter', maT: '45', mrT: '0' }); }],
  ['2 in tube 40 ft', (c) => { c.pickFam('tube')(); c.setState({ lenT: "40'", todT: '2', twallT: '.120' }); }],
  ['4x4 tube 8 in', (c) => { c.pickFam('hss')(); c.setState({ lenT: '8' }); }],
  ['10x6 tube 30 ft', (c) => { c.pickFam('hss')(); c.setState({ lenT: "30'", hsize: '10x6', hwallT: '3/8' }); }],
  ['W12x26 5 ft', (c) => { c.pickFam('beam')(); c.setState({ lenT: "5'" }); }],
  ['W8x31 40 ft', (c) => { c.pickFam('beam')(); c.setState({ lenT: "40'", bsize: 'W8x31' }); }],
  ['C6 20 ft', (c) => { c.pickFam('chan')(); c.setState({ lenT: "20'" }); }],
  ['angle 2 ft', (c) => { c.pickFam('angl')(); c.setState({ lenT: "2'" }); }],
  ['angle 40 ft', (c) => { c.pickFam('angl')(); c.setState({ lenT: "40'" }); }],
];
const boxes = [[1024, 227], [640, 200], [1900, 320], [358, 120], [260, 120], [720, 110], [720, 260], [140, 90]];

for (const [name, prep] of parts) {
  const c = await freshApp(); prep(c);
  const r = c.calc(), p = r.paths;
  ok(!c.blocked(r) && p && p.ext && Array.isArray(p.side) && p.side.length >= 2, name + ': the drawing reports its extents and its labels');
  if (!p || !p.ext) continue;
  for (const [W, H] of boxes) {
    const L = c.bandLayout(p, W, H), id = name + ' @ ' + W + 'x' + H, vb = L.vb.split(' ').map(Number), s = L.s;
    ok(vb.length === 4 && vb.every(Number.isFinite) && Math.abs(vb[2] / vb[3] - W / H) < 2e-3 * (W / H), id + ': the picture has the proportions of its box, so an inch is the same across and down');
    ok(Math.abs(vb[2] * s - W) < .05, id + ': scale matches the box');
    // the whole drawing is inside the box, with a little clear all round
    const px = (x) => (x - vb[0]) * s, py = (y) => (y - vb[1]) * s;
    ok(px(p.ext.x0) >= 7.5 && px(p.ext.x1) <= W - 7.5 && py(p.ext.y0) >= 7.5 && py(p.ext.y1) <= H - 7.5, id + ': the part is inside the box', [px(p.ext.x0), px(p.ext.x1), py(p.ext.y0), py(p.ext.y1)].map((v) => v.toFixed(1)).join(' '));
    const labs = L.labels.map((l) => { const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.eE]+)\)/.exec(l.tf); return { t: l.t, x: +m[1], y: +m[2], k: +m[3], px: l.px }; });
    for (const l of labs) {
      const h = l.k * 10 * s, wpx = l.t.length * h * .62;                       // height on screen, and about how wide
      ok(Math.abs(h - l.px) < 1e-3 && (l.px === PX || l.px === SUB), id + ': "' + l.t + '" is ' + l.px + ' px on screen', h.toFixed(3));
      ok(l.x < p.ext.x0 - 1e-9, id + ': "' + l.t + '" ends to the left of the part (right-aligned in the margin)');
      ok(px(l.x) - wpx >= -1, id + ': "' + l.t + '" starts inside the picture', (px(l.x) - wpx).toFixed(1));
    }
    for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) ok(Math.abs(labs[i].y - labs[j].y) * s >= (labs[i].px + labs[j].px) / 2 + 1, id + ': "' + labs[i].t + '" and "' + labs[j].t + '" do not touch', (Math.abs(labs[i].y - labs[j].y) * s).toFixed(1));
    if (W >= 620) ok(labs.length >= 1, id + ': a wide picture always carries at least one label');
    if (W < 620 && labs.length) ok(labs.every((l) => l.t.length <= 9), id + ': a narrow picture uses the short names', labs.map((l) => l.t).join(','));
    if (W <= 140) ok(labs.length === 0, id + ': a picture too narrow for a margin drops the labels, not the part');
  }
  // the size of the labels does not depend on the part: same box, same label height
  const a = c.bandLayout(p, 1024, 227).labels[0];
  ok(a && a.px === PX, name + ': first label is ' + PX + ' px');
}

// the same part at 12 in and at 42 ft: labels the same size on screen (this is what went wrong before)
{
  const short = await freshApp({ lenT: '12' }), long = await freshApp({ lenT: "42'" });
  const hs = (c) => { const L = c.bandLayout(c.calc().paths, 1024, 227); return L.labels.map((l) => +/scale\(([-\d.eE]+)\)/.exec(l.tf)[1] * 10 * L.s); };
  ok(hs(short).every((h) => Math.abs(h - PX) < 1e-3) && hs(long).every((h) => Math.abs(h - PX) < 1e-3), 'a 12 in pipe and a 42 ft pipe have labels of the same height on screen', hs(short).concat(hs(long)).map((v) => v.toFixed(2)).join(','));
}
// the printed ticket uses the same layout
{
  const c = await freshApp({ lenT: "20'" }); const html = c._ticketHtml();
  ok(/text-anchor="end"/.test(html) && /vector-effect="non-scaling-stroke"/.test(html) && !/font-size="/.test(html.split('<svg')[1].split('</svg>')[0]), 'ticket drawing: labels right-aligned in the margin, lines a fixed weight');
  const vb = /<svg viewBox="([^"]+)"/.exec(html)[1].split(' ').map(Number); ok(vb.length === 4 && vb[2] / vb[3] > 2, 'ticket drawing: fitted to the width of the page', vb.join(' '));
  ok(/white-space:nowrap">B · RIGHT/.test(html), 'ticket: "B · RIGHT" stays on one line');
}
// a click on the drawing is read through the viewBox the drawing is shown with
{
  const c = await freshApp({ lenT: "10'" }); const p = c.calc().paths, L = c.bandLayout(p, 1000, 220), vb = L.vb.split(' ').map(Number);
  const el = { getBoundingClientRect: () => ({ left: 50, top: 400, width: 1000, height: 220 }), getAttribute: (k) => (k === 'viewBox' ? L.vb : null) };
  const at = (x, y) => c.bandXY({ currentTarget: el, clientX: 50 + (x - vb[0]) * L.s, clientY: 400 + (y - vb[1]) * L.s });
  const q = at(60, 10.4); ok(q && Math.abs(q.px - 60) < 1e-4 && Math.abs(q.py - 10.4) < 1e-4, 'a click at 60 in along, 10.4 in round reads back as that spot (to a ten-thousandth)', q && q.px + ',' + q.py);
}

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log(fails.join('\n')); process.exit(1); }
