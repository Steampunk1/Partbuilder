// Independent readers for the files the app writes (no app code used here).
export function parseDxf(text) {
  const ln = text.split(/\r?\n/); const pairs = [];
  for (let i = 0; i + 1 < ln.length; i += 2) pairs.push([parseInt(ln[i].trim(), 10), ln[i + 1].trim()]);
  const out = { insunits: null, polys: [], circles: [], types: {}, texts: [] };
  let cur = null, v = null, ent = null, lastVar = null;
  for (const [c, val] of pairs) {
    if (c === 9) lastVar = val;
    if (c === 70 && lastVar === '$INSUNITS' && out.insunits === null) out.insunits = parseInt(val, 10);
    if (c === 0) {
      if (v && cur) { cur.pts.push([v.x, v.y]); v = null; }
      ent = val; out.types[val] = (out.types[val] || 0) + 1;
      if (val === 'POLYLINE') { cur = { layer: '', closed: false, pts: [] }; out.polys.push(cur); }
      else if (val === 'VERTEX') { v = { x: 0, y: 0 }; }
      else if (val === 'SEQEND') { cur = null; }
      else if (val === 'TEXT') out.texts.push('');
      else if (val === 'CIRCLE') out.circles.push({ layer: '', x: 0, y: 0, r: 0 });
      continue;
    }
    if (ent === 'POLYLINE' && cur) { if (c === 8) cur.layer = val; if (c === 70) cur.closed = (parseInt(val, 10) & 1) === 1; }
    if (ent === 'VERTEX' && v) { if (c === 10) v.x = parseFloat(val); if (c === 20) v.y = parseFloat(val); }
    if (ent === 'CIRCLE') { const q = out.circles[out.circles.length - 1]; if (c === 8) q.layer = val; if (c === 10) q.x = parseFloat(val); if (c === 20) q.y = parseFloat(val); if (c === 40) q.r = parseFloat(val); }
    if (ent === 'TEXT' && c === 1) out.texts[out.texts.length - 1] = val;
  }
  return out;
}
export const bbox = (pts) => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; };
export const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
/** STEP faceted-brep reader: points, loops, solids -> volume / bbox / watertightness per solid. */
export function parseStep(text) {
  const ents = new Map();
  const body = text.slice(text.indexOf('DATA;') + 5);
  for (const m of body.matchAll(/#(\d+)\s*=\s*([A-Z_0-9]*)\s*\(([\s\S]*?)\);/g)) ents.set(+m[1], { t: m[2], a: m[3] });
  const refs = (s) => [...s.matchAll(/#(\d+)/g)].map(m => +m[1]);
  const pt = (id) => { const e = ents.get(id); const m = e.a.match(/\(([^()]*)\)\s*$/); return m[1].split(',').map(Number); };
  const solids = [];
  for (const [id, e] of ents) {
    if (e.t !== 'FACETED_BREP') continue;
    const name = (e.a.match(/'([^']*)'/) || [])[1];
    const shell = ents.get(refs(e.a)[0]);
    const tris = [];
    for (const fid of refs(shell.a)) {
      const face = ents.get(fid);
      for (const bid of refs(face.a)) {
        const b = ents.get(bid); if (!b || !/FACE_(OUTER_)?BOUND/.test(b.t)) continue;
        const loop = ents.get(refs(b.a)[0]);
        if (loop.t !== 'POLY_LOOP') throw new Error('unexpected loop ' + loop.t);
        const ids = refs(loop.a);
        for (let i = 1; i + 1 < ids.length; i++) tris.push([ids[0], ids[i], ids[i + 1]]);
      }
    }
    let vol = 0; const bb = [[1e9, -1e9], [1e9, -1e9], [1e9, -1e9]]; const edges = new Map();
    const key = (p) => p.map(v => v.toFixed(5)).join(',');
    for (const t of tris) {
      const [a, b, c] = t.map(pt);
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { bb[k][0] = Math.min(bb[k][0], p[k]); bb[k][1] = Math.max(bb[k][1], p[k]); }
      const ks = [key(a), key(b), key(c)];
      for (let i = 0; i < 3; i++) { const u = ks[i], w = ks[(i + 1) % 3]; if (u === w) continue; edges.set(u + '>' + w, (edges.get(u + '>' + w) || 0) + 1); }
    }
    let open = 0; for (const [k, n] of edges) { const [u, w] = k.split('>'); if ((edges.get(w + '>' + u) || 0) !== n) open++; }
    solids.push({ name, tris: tris.length, vol, bb, openEdges: open });
  }
  return { solids, inch: /CONVERSION_BASED_UNIT\('INCH'/.test(text), schema: (text.match(/FILE_SCHEMA\(\('([^']*)'/) || [])[1] };
}
